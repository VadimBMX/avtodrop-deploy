// fix5 (night 28.10, crit4 №3/6/7/9 + qa4 leftovers): the newcomer's buyer and the night window, the texts pack
// (car count, count-up, raceWhy, VIP prestige hint, the market goal), the canister reserve, the idle-cash line, the
// 3-line bot bundle and the beta sheet after a bug reward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { reminderText, BUNDLE } from '../src/reminders.js';
import * as S from '../public/shared.js';
import * as B from '../public/buyer.js';
import * as P from '../public/prestige.js';
import { markNumber } from '../public/intro-fx.js';
import { idleCapHours } from '../public/garage-calm.js';

const K = (s) => Date.parse(s + '+02:00'); // Kyiv wall clock (UTC+2 after 25.10)
const H = 3600e3, D = 86400e3;
const src = (p) => fs.readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

function setup({ t0 = K('2026-10-29T12:00:00'), seed = 'cd'.repeat(32), allUnlocked = false } = {}) {
  let t = t0;
  const db = openDb(':memory:');
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('buyer_seed', seed);
  const g = createGame(db, { now: () => t, random: () => 0.5, admins: [1], notify: () => {}, allUnlocked });
  const mk = (id, level = 5, balance = 1e6) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ?, slots = 40 WHERE id = ?').run(level, level, balance, id);
    db.prepare('DELETE FROM cars WHERE owner_id = ?').run(id);
    return id;
  };
  const car = (uid, model) => g.giveCar(uid, model).id;
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, mk, car, call, set: (x) => (t = x), add: (ms) => (t += ms), at: () => t };
}
const D_IDS = B.BUYABLE.filter((m) => m.cls === 'D').map((m) => m.id);
const A_IDS = B.BUYABLE.filter((m) => m.cls === 'A').map((m) => m.id);

// ---------- 1. the buyer for a newcomer ----------
test('buyer, newcomer: only a «reach» for a D–C model from the cheapest affordable cases — no own, stretch or hypercar', () => {
  let h = 11;
  const rnd = () => ((h = (h * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const balance of [0, 6e4, 3e5, 1e6, 1e8]) {
    const cases = B.newbieCases(balance);
    assert.ok(cases.length >= 1 && cases.length <= B.BUYER.newbieCases);
    const pool = new Set(cases.flatMap((cs) => B.BUYER.newbieClasses.flatMap((c) => cs.pool(c).map((m) => m.id))));
    for (let i = 0; i < 400; i++) {
      const r = B.pickRequest(rnd, { own: A_IDS.slice(0, 2), balance, newbie: true });
      if (!r) continue;
      assert.equal(r.kind, 'reach');
      assert.ok(r.req.model, 'one model, no «class + country»');
      assert.ok(['D', 'C'].includes(S.MODELS[r.req.model].cls), r.req.model);
      assert.ok(pool.has(r.req.model), `${r.req.model} comes from the cheapest cases`);
      assert.ok(r.prem >= B.BUYER.minPrem && r.prem <= B.premCap(r.req) + 1e-9);
    }
  }
  // the cheapest affordable cases, cheapest first; with no money still the cheapest one
  assert.deepEqual(B.newbieCases(0).map((c) => c.id), [S.CASES.filter((c) => !c.starter).sort((a, b) => a.price - b.price)[0].id]);
  assert.ok(B.isNewbie({ level: 4, cars: 10 }) && B.isNewbie({ level: 20, cars: 2 }) && !B.isNewbie({ level: 5, cars: 3 }));
});

test('buyer, server: level 3 with 2 cars gets a cheap reach; level 5 with 3 cars the normal mix; no request → a calm hint', () => {
  const x = setup();
  for (let id = 10; id < 40; id++) {
    x.mk(id, 3, 1e9);
    x.car(id, D_IDS[0]);
    x.car(id, A_IDS[0]);
    const o = x.call(id, 'me').buyer;
    assert.ok(o, 'a newcomer has an offer');
    assert.equal(o.kind, 'reach');
    assert.ok(['D', 'C'].includes(S.MODELS[o.req.model].cls), `${id}: ${o.req.model}`);
  }
  const kinds = new Set();
  for (let id = 40; id < 120; id++) {
    x.mk(id, 8, 1e9);
    for (const m of [D_IDS[0], A_IDS[0], A_IDS[1]]) x.car(id, m);
    kinds.add(x.call(id, 'me').buyer.kind);
  }
  assert.ok(kinds.has('own') && kinds.has('stretch'), [...kinds].join());
  // nothing sensible (no case drops the classes asked) → no offer; under 3 cars the «Сьогодні» line instead
  const was = B.BUYER.newbieClasses;
  B.BUYER.newbieClasses = ['X'];
  try {
    x.mk(200, 3);
    x.car(200, D_IDS[0]);
    assert.deepEqual(x.call(200, 'me').buyer, { hint: B.NEWBIE_HINT });
    assert.equal(x.db.prepare('SELECT COUNT(*) n FROM buyer_offers WHERE user_id = 200').get().n, 0);
    x.mk(201, 3);
    for (const m of [D_IDS[0], D_IDS[1], A_IDS[0]]) x.car(201, m);
    assert.equal(x.call(201, 'me').buyer, null, '3 cars: no hint, just nothing');
  } finally {
    B.BUYER.newbieClasses = was;
  }
  assert.match(B.NEWBIE_HINT, /Покупець з’явиться, коли в гаражі буде 3 машини/);
  const ui = src('buyer-ui.js');
  assert.match(ui, /o\.hint \? !!today/, 'the hint is drawn only inside «Сьогодні», never as a card of its own');
});

test('buyer, night: an offer made 00:00–08:00 Kyiv runs 3 h from 08:00; a day offer from its own moment', () => {
  assert.equal(B.windowOf(K('2026-10-29T02:30:00')).expires, K('2026-10-29T11:00:00'));
  assert.equal(B.windowOf(K('2026-10-29T00:00:00')).start, K('2026-10-29T08:00:00'));
  assert.equal(B.windowOf(K('2026-10-29T12:10:00')).expires, K('2026-10-29T15:10:00'));
  assert.equal(B.windowOf(K('2026-07-15T03:00:00') - H).expires, Date.parse('2026-07-15T11:00:00+03:00'), 'summer time too');
  const x = setup({ t0: K('2026-10-29T01:15:00') });
  x.mk(5, 8, 1e9);
  for (const m of [D_IDS[0], A_IDS[0], A_IDS[1]]) x.car(5, m);
  const o = x.call(5, 'me').buyer;
  assert.equal(o.expiresAt, K('2026-10-29T11:00:00'));
  x.set(K('2026-10-29T10:30:00'));
  assert.ok(x.call(5, 'me').buyer, 'still there for the morning visit');
  x.set(K('2026-10-29T11:01:00'));
  assert.equal(x.call(5, 'me').buyer, null);
});

// ---------- 2. texts ----------
test('texts: the car count matches the collection; small numbers don\'t count up; the starter drop keeps its header', () => {
  const secret = S.ALL_MODELS.filter((m) => m.secret).length, open = S.ALL_MODELS.length - secret;
  assert.equal(S.carCountText(), `${open} справжніх авто і ще ${secret} секретних`);
  assert.match(S.INTRO_STORY.slides[0].text, new RegExp(S.carCountText()));
  assert.match(S.INTRO_STORY.slides[2].text, new RegExp(`бонус на ${S.DAILY_BONUS.length} днів`));
  assert.equal(markNumber('Щоденний бонус на 14 днів'), 'Щоденний бонус на 14 днів', 'a day count is never caught mid-count');
  assert.match(markNumber('Збирай: 169 справжніх авто'), /data-to="169"/);
  const app = src('app.js');
  assert.match(app, /const fromStarter = onDrop && S\.CASE_BY_ID\[state\.dropCase\]\?\.starter/);
  assert.match(app, /Подарунок новачку · відкрито/);
});

test('raceWhy: a good start and clean shifts are not blamed — «Суперник-профі цього разу був швидшим»', () => {
  const byPw = [...S.ALL_MODELS].filter((m) => !m.secret).sort((a, b) => b.hp / b.kg - a.hp / a.kg);
  const fast = byPw[5], slow = byPw[60];
  const me = { model: fast.id, parts: {} }, rival = { model: slow.id, parts: {} };
  assert.deepEqual(S.raceWhy(me, rival, { time: 10, rivalTime: 9.9, reaction: 0.22, shifts: ['perfect', 'perfect', 'good', 'perfect'] }), [S.RACE_WHY_PRO]);
  assert.match(S.RACE_WHY_PRO, /Суперник-профі цього разу був швидшим — таке рідко, спробуй ще/);
  assert.match(S.raceWhy(me, rival, { time: 10, rivalTime: 9.9, reaction: 0.22, shifts: ['perfect', 'late', 'good', 'perfect'] })[0], /старті й передачах/);
  assert.match(S.raceWhy(me, rival, { time: 10, rivalTime: 9.9, reaction: -1, shifts: ['perfect', 'perfect', 'perfect', 'perfect'] })[0], /старті й передачах/, 'a false start');
  assert.match(S.raceWhy(me, rival, { time: 10, rivalTime: 9.9 })[0], /старті й передачах/, 'no data: as before');
  assert.match(src('app.js'), /reaction: r\.jump \? -1 : r\.reaction, shifts: r\.shifts/);
});

test('prestige: a VIP whose cash already holds the next level is not offered «каса на 6 год»', () => {
  const o = { balance: 1e12, slots: S.MAX_SLOTS, capLevel: 0 };
  assert.equal(P.firstOffer({ ...o, capH: S.CAP_LEVELS[0].hours + S.VIP.extraHours }), null);
  assert.deepEqual(P.firstOffer({ ...o, capH: S.CAP_LEVELS[0].hours }), { kind: 'cap', cost: S.CAP_LEVELS[1].cost, hours: S.CAP_LEVELS[1].hours });
  assert.equal(P.firstOffer(o)?.kind, 'cap', 'old callers: as before');
  assert.match(src('prestige-ui.js'), /capH: m\.income\?\.capH/);
});

test('goals: «Купи або продай авто на ринку» never for a player with one car', () => {
  assert.equal(S.QUESTS.market.minCars, 2);
  const x = setup({ allUnlocked: true });
  let seenWith2 = false;
  for (let id = 300; id < 360; id++) {
    x.mk(id, 6);
    x.car(id, D_IDS[0]);
    const one = x.db.prepare('SELECT key FROM quests WHERE user_id = ?');
    x.call(id, 'quests');
    assert.ok(!one.all(id).some((r) => r.key === 'market'), `${id}: one car`);
  }
  for (let id = 400; id < 460 && !seenWith2; id++) {
    x.mk(id, 6);
    x.car(id, D_IDS[0]);
    x.car(id, D_IDS[1]);
    x.call(id, 'quests');
    seenWith2 = x.db.prepare('SELECT key FROM quests WHERE user_id = ?').all(id).some((r) => r.key === 'market');
  }
  assert.ok(seenWith2, 'two cars: the goal can come');
});

// ---------- 3. the canister reserve ----------
test('canister: on a full tank it waits «в запасі» (max 3) and the next starts use it first; the card redraws', () => {
  const x = setup({ allUnlocked: true });
  const u = x.mk(7, 16, 1e9);
  const car = x.car(u, 'vaz-2107');
  x.db.prepare('UPDATE users SET fuel = 15, fuel_at = ? WHERE id = ?').run(x.at(), u);
  assert.equal(x.call(u, 'rewards/daily').reward.canister, 3);
  let me = x.call(u, 'me');
  assert.deepEqual([me.fuel, me.fuelSpare, me.fuelMax], [15, 3, 15]);
  x.call(u, 'race/start', { carId: car, rival: 'easy' });
  me = x.call(u, 'me');
  assert.deepEqual([me.fuel, me.fuelSpare, me.fuelNext], [15, 2, null], 'the reserve goes first, the tank stays full');
  x.add(5 * 60e3);
  x.call(u, 'drift/start', { carId: car, rival: 'easy' });
  x.add(5 * 60e3);
  x.call(u, 'drift/start', { carId: car, rival: 'easy' });
  me = x.call(u, 'me');
  assert.deepEqual([me.fuel, me.fuelSpare], [15, 0]);
  x.add(5 * 60e3);
  x.call(u, 'race/start', { carId: car, rival: 'easy' });
  me = x.call(u, 'me');
  assert.deepEqual([me.fuel, me.fuelSpare], [14, 0]);
  assert.ok(me.fuelNext, 'now the tank refills');
  // never above 3 in reserve
  x.db.prepare('UPDATE users SET fuel = 17, fuel_at = ? WHERE id = ?').run(x.at(), u);
  assert.equal(x.call(u, 'me').fuelSpare, 2);
  x.db.prepare('UPDATE users SET fuel = 30, fuel_at = ? WHERE id = ?').run(x.at(), u);
  assert.equal(x.call(u, 'me').fuelSpare, S.CANISTER.spare);
  // the client spends the reserve first too, and redraws the tank after «Забрати все» / the daily bonus
  const app = src('app.js');
  assert.match(app, /function spendFuelLocal\(\) \{\n  if \(me\.fuelSpare > 0\) me\.fuelSpare--;/);
  assert.equal((app.match(/me\.fuel--/g) || []).length, 1, 'only inside spendFuelLocal');
  assert.equal((app.match(/^  fuelSync\(f0, s0\);$/gm) || []).length, 2, "claimAll and claimDaily");
});

// ---------- 4. the idle cash line ----------
test('idle cash: until level 5, «Каса стояла повна N год» after hours away; nothing for a full minute or level 5', () => {
  const next = S.nextCapOffer(0, 4);
  const income = { rate: 1000, capH: 4, since: K('2026-10-29T00:00:00'), banked: 0 };
  assert.equal(idleCapHours({ level: 2, income, now: K('2026-10-29T21:00:00'), next }), 17);
  assert.equal(idleCapHours({ level: 2, income, now: K('2026-10-29T04:30:00'), next }), 0, 'full for 30 min');
  assert.equal(idleCapHours({ level: 5, income, now: K('2026-10-29T21:00:00'), next }), 0);
  assert.equal(idleCapHours({ level: 2, income: { ...income, banked: 2000 }, now: K('2026-10-29T05:00:00'), next }), 3, 'banked money fills it sooner');
  assert.equal(idleCapHours({ level: 2, income, now: K('2026-10-29T21:00:00'), next: null }), 0, 'no upgrade left');
  const app = src('app.js');
  assert.match(app, /Каса стояла повна \$\{idle\} год — <a data-act="upgradeCap" class="txtlink">збільш її до \$\{nextCap\.hours\} год за \$\{S\.short\(nextCap\.cost\)\}<\/a>/);
});

// ---------- 5. qa4 leftovers ----------
test('bot bundle: at most 3 lines, the most important first, «…і ще N — у грі» for the rest', () => {
  const it = (kind) => ({ kind, text: `<${kind}>` });
  const t = reminderText(['event', 'dayrace', 'goals', 'buyer', 'barn', 'daily', 'income', 'fuel'].map(it));
  const lines = t.split('\n\n')[0].split('\n');
  assert.equal(lines.length, BUNDLE.lines + 1);
  assert.deepEqual(lines, ['<event>', '<goals>', '<daily>', '…і ще 5 — у грі']);
  assert.equal(reminderText([it('fuel'), it('daily')]).split('\n\n')[0], '<fuel>\n<daily>', 'short bundles as before');
  assert.match(t, /Налаштувати: Меню → Налаштування в грі/);
});

test('beta sheet: not for a player who already has the tester badge (a rewarded bug)', () => {
  const app = src('app.js');
  assert.match(app, /const bugRewarded = \(\) => !!me\?\.badges\?\.some\(\(b\) => b\.key === 'tester'\)/);
  const fn = app.slice(app.indexOf('function bugAskOnce'), app.indexOf('H.bugAskGo'));
  assert.ok(fn.indexOf('bugRewarded()') > 0 && fn.indexOf('bugRewarded()') < fn.indexOf("sheet('Бета-тест'"));
});
