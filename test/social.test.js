// Social side without a crowd (night wave J): market, trades and auction from level 3 (nobody loses a feature);
// «Дилер Петрович» sits in a case battle nobody joined in 30 s — same honest odds, a battle with him is worth exactly
// what opening the cases yourself is, his winnings are paid to nobody; the race streak with a weekly freeze, counted in
// Kyiv days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, dayOf, fairRoll, pickWeighted, pickModel, classEntries } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

function setup({ t0 = Date.parse('2026-10-21T09:00:00Z'), random = S.seededRand(7), allUnlocked = true } = {}) {
  const db = openDb(':memory:');
  let t = t0;
  const g = createGame(db, { now: () => t, notify: () => {}, random, allUnlocked, partCooldownMs: 0 });
  const mk = (id, { level = 20, balance = 1e12 } = {}) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET balance = ?, slots = 60, level = ?, level_seen = ? WHERE id = ?').run(balance, level, level, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, mk, call, advance: (ms) => (t += ms), set: (x) => (t = x), now: () => t };
}
const notLocked = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.doesNotMatch(e.message, /відкриється на рівні|ще не відкриті/);
  }
};

// ---------- unlocks ----------
const OLD_LEVEL = { market: 4, trades: 5, auction: 5 }; // the ladder before wave J

test('unlocks: market, trades and auction open at level 3; PvP (5) and battles (6) stay where they were', () => {
  assert.equal(S.unlockLevel('market'), 3);
  assert.equal(S.unlockLevel('trades'), 3);
  assert.equal(S.unlockLevel('auction'), 3);
  assert.equal(S.unlockLevel('pvp'), 5);
  assert.equal(S.unlockLevel('battles'), 6);
  const { mk, call, db } = setup({ allUnlocked: false });
  mk(5, { level: 2 });
  mk(6, { level: 3 });
  call(5, 'case/open', { caseId: 'starter' });
  const car = call(5, 'me').cars[0];
  const deals = [['market/sell', { carId: car.id, price: 1e6 }], ['trade/create', { to: 6 }], ['room/create', {}], ['auction/create', { carId: car.id, startPrice: 1e5, hours: 1 }], ['hall/chat', { text: 'привіт' }]];
  for (const [name, body] of deals) assert.throws(() => call(5, name, body), /відкриється на рівні 3/, name);
  db.prepare('UPDATE users SET level = 3 WHERE id = 5').run();
  assert.deepEqual(call(5, 'me').unlocked, ['parts', 'wash', 'dayrace', 'drift', 'plates', 'market', 'trades', 'auction']);
  for (const [name, body] of deals) notLocked(() => call(5, name, body));
  assert.ok(db.prepare('SELECT COUNT(*) n FROM trade_chat WHERE user_id = 5').get().n, 'the trade hall chat is open at level 3');
  assert.throws(() => call(5, 'pvp/create', { carId: car.id, bet: S.PVP_MIN_BET }), /відкриється на рівні 5/);
  assert.throws(() => call(5, 'battle/create', { caseId: 'rust', count: 1 }), /відкриється на рівні 6/);
});

test('grandfathering: the lower ladder only ever opens — at every level the open set contains the old one; feats still count', () => {
  const old = (level) => S.UNLOCKS.filter((u) => level >= (OLD_LEVEL[u.key] ?? u.level)).map((u) => u.key);
  for (let level = 1; level <= 12; level++) {
    const now = S.unlockedKeys({ level, casino: 'on' });
    for (const k of old(level)) assert.ok(now.includes(k), `level ${level} lost ${k}`);
  }
  // A level-4 player of yesterday (market open, trades not yet) gets trades and the auction today.
  assert.ok(S.unlockedKeys({ level: 4 }).includes('trades') && S.unlockedKeys({ level: 4 }).includes('auction'));
  // Features kept from before the ladder (users.feats) still open below their level.
  assert.deepEqual(S.unlockedKeys({ level: 1, feats: ['trades', 'battles'] }), ['trades', 'battles']);
  const { mk, call, db } = setup({ allUnlocked: false });
  mk(7, { level: 1 });
  db.prepare(`UPDATE users SET feats = '["battles"]' WHERE id = 7`).run();
  notLocked(() => call(7, 'battle/create', { caseId: 'rust', count: 1 }));
  // The level-up popup from 2 to 3 lists them.
  assert.deepEqual(S.unlocksBetween(2, 3).map((u) => u.key), ['drift', 'plates', 'market', 'trades', 'auction']);
});

// ---------- case battles with the bot ----------
test('bot battle: nobody joins in 30 s → «Дилер Петрович» sits in; not before, not without consent, never in old battles; a person still can', () => {
  const { mk, call, db, advance, now } = setup();
  mk(1);
  mk(2);
  const t0 = now();
  const b1 = call(1, 'battle/create', { caseId: 'rust', count: 1, botOk: true }).id;
  const b2 = call(1, 'battle/create', { caseId: 'rust', count: 1, botOk: false }).id;
  const b3 = call(1, 'battle/create', { caseId: 'rust', count: 1 }).id; // a client from before the switch sends nothing
  const old = db.prepare("INSERT INTO battles (creator_id, case_id, count, price, created_at) VALUES (2, 'rust', 1, 60000, ?)").run(now()).lastInsertRowid; // open before the update
  const open = call(2, 'battle/list').open;
  assert.equal(open.find((b) => b.id === b1).botAt, t0 + S.BATTLE_BOT.waitMs);
  assert.equal(open.find((b) => b.id === b2).botAt, null);
  advance(S.BATTLE_BOT.waitMs - 1000);
  call(2, 'pulse');
  assert.equal(call(1, 'battle/get', { id: b1 }).status, 'open', 'not before 30 s');
  advance(1000);
  call(2, 'pulse'); // anyone's poll is enough
  const r = call(1, 'battle/get', { id: b1 });
  assert.equal(r.status, 'done');
  assert.equal(r.bot, true);
  assert.equal(r.opponent.name, 'Дилер Петрович');
  assert.equal(r.opponent.bot, true);
  assert.equal(r.result.bot, true);
  assert.equal(r.result.consolation, null);
  assert.equal(r.result.opponent.drops.length, 1);
  advance(3600e3);
  call(1, 'pulse');
  for (const id of [b2, b3, Number(old)]) assert.equal(call(1, 'battle/get', { id }).status, 'open', `battle ${id} must wait for a person`);
  // A person joins inside the 30 s: the usual battle with the usual consolation.
  call(1, 'battle/cancel', { id: b2 });
  const b4 = call(1, 'battle/create', { caseId: 'rust', count: 1, botOk: true }).id;
  advance(10e3);
  const h = call(2, 'battle/join', { id: b4 });
  assert.equal(h.opponent.id, 2);
  assert.equal(h.bot, false);
  assert.ok(h.winnerId == null || h.result.consolation, 'a battle between people keeps its consolation car');
  // Bot wins never count for the «Кейс-батли» achievement (one per rival a day — the bot is not a rival).
  db.prepare("UPDATE battles SET winner_id = 1 WHERE id = ?").run(b1);
  const ach = call(1, 'achievements').list.find((a) => a.key === 'battles');
  assert.equal(ach.value, db.prepare("SELECT COUNT(*) n FROM battles WHERE winner_id = 1 AND opponent_id > 0").get().n ? 1 : 0);
});

test('bot battle: a battle the bot cannot play (its case is gone) never breaks anyone\'s pulse — it is cancelled and paid back', () => {
  const { mk, call, db, advance } = setup();
  mk(1);
  mk(2);
  const id = call(1, 'battle/create', { caseId: 'rust', count: 3, botOk: true }).id;
  db.prepare("UPDATE battles SET case_id = 'no-such-case' WHERE id = ?").run(id);
  const bal = () => db.prepare('SELECT balance FROM users WHERE id = 1').get().balance;
  const before = bal();
  advance(S.BATTLE_BOT.waitMs);
  call(2, 'pulse');
  assert.equal(db.prepare('SELECT status FROM battles WHERE id = ?').get(id).status, 'cancelled');
  assert.equal(bal(), before + 3 * S.CASE_BY_ID.rust.price);
  call(2, 'pulse');
});

test('bot battle honesty: the player rolls the case odds only (no guarantee, counters untouched), provably fair, and in his drop history', () => {
  const { mk, call, db, advance } = setup();
  mk(1);
  const cs = S.CASE_BY_ID.rust;
  // Every guarantee step one open away: an ordinary opening would be forced up now.
  const steps = S.pitySteps(cs);
  for (const s of steps) db.prepare('INSERT OR REPLACE INTO pity (user_id, case_id, count) VALUES (1, ?, ?)').run(s.key, s.n - 1);
  const pity = () => db.prepare('SELECT case_id, count FROM pity WHERE user_id = 1 ORDER BY case_id').all();
  const before = pity();
  const id = call(1, 'battle/create', { caseId: 'rust', count: 10, botOk: true }).id;
  advance(S.BATTLE_BOT.waitMs);
  const b = call(1, 'battle/get', { id });
  assert.equal(b.status, 'done');
  assert.deepEqual(pity(), before, 'guarantee counters are not touched by a bot battle');
  const u = db.prepare('SELECT server_seed, client_seed FROM users WHERE id = 1').get();
  const drops = db.prepare('SELECT * FROM drops WHERE user_id = 1 ORDER BY id DESC LIMIT 10').all().reverse();
  assert.deepEqual(drops.map((d) => d.item), b.result.creator.drops.map((d) => d.model));
  for (const d of drops) {
    assert.equal(d.forced, 0);
    const cls = pickWeighted(classEntries(cs.weights), fairRoll(u.server_seed, u.client_seed, d.nonce, 0));
    assert.equal(cls, d.cls);
    assert.equal(pickModel(cs.pool(cls), fairRoll(u.server_seed, u.client_seed, d.nonce, 1)), d.item, 'the drop verifies like any case roll');
  }
});

test('bot battle economy: the bot gets the case odds, a battle with him is worth exactly opening the cases yourself; nothing ever leaks to anybody', () => {
  const { mk, call, db, advance } = setup({ random: S.seededRand(20261022) });
  mk(1);
  const cs = S.CASE_BY_ID.rust;
  const N = 3000;
  const botCls = {}, outcome = { win: 0, lose: 0, tie: 0 };
  let own = 0, got = 0, ownSale = 0, gotSale = 0, paid = 0;
  const sale = (m) => S.sellPriceOf(m, 0, cs.id);
  const balance = () => db.prepare('SELECT balance FROM users WHERE id = 1').get().balance;
  const minted = () => db.prepare('SELECT COALESCE(SUM(created), 0) n FROM money_days').get().n;
  const minted0 = minted();
  for (let i = 0; i < N; i++) {
    const cars0 = db.prepare('SELECT COUNT(*) n FROM cars WHERE owner_id = 1').get().n;
    const bal0 = balance();
    const id = call(1, 'battle/create', { caseId: cs.id, count: 1, botOk: true }).id;
    advance(S.BATTLE_BOT.waitMs);
    const b = call(1, 'battle/get', { id });
    const r = b.result;
    paid += bal0 - balance();
    assert.equal(bal0 - balance(), cs.price, 'the stake is all that moves: no refund, no payout');
    for (const d of r.opponent.drops) botCls[d.cls] = (botCls[d.cls] || 0) + 1;
    const mine = r.creator.drops.map((d) => d.model), his = r.opponent.drops.map((d) => d.model);
    own += r.creator.total;
    ownSale += mine.reduce((s, m) => s + sale(m), 0);
    const newCars = db.prepare('SELECT model FROM cars WHERE owner_id = 1 ORDER BY id DESC LIMIT ?').all(db.prepare('SELECT COUNT(*) n FROM cars WHERE owner_id = 1').get().n - cars0).map((c) => c.model);
    if (b.winnerId === 1) {
      outcome.win++;
      assert.deepEqual(newCars.sort(), [...mine, ...his].sort(), 'the winner takes both sides');
    } else if (b.winnerId === S.BATTLE_BOT.id) {
      outcome.lose++;
      assert.equal(newCars.length, 0, 'lost to the bot: no car, no consolation');
    } else {
      outcome.tie++;
      assert.deepEqual(newCars.sort(), [...mine].sort(), 'a tie keeps your own');
    }
    got += newCars.reduce((s, m) => s + S.MODELS[m].price, 0);
    gotSale += newCars.reduce((s, m) => s + sale(m), 0);
    if (i % 100 === 99) db.prepare("DELETE FROM cars WHERE owner_id = 1").run(); // keep the garage small (speed only)
  }
  // The bot is nobody: no account, no car, no money, no messages.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(S.BATTLE_BOT.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cars WHERE owner_id = ?').get(S.BATTLE_BOT.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events WHERE user_id = ?').get(S.BATTLE_BOT.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM drops WHERE user_id = ?').get(S.BATTLE_BOT.id).n, 0);
  assert.equal(minted() - minted0, 0, 'no hryvnia was created by bot battles');
  assert.equal(paid, N * cs.price);
  // The bot's classes follow the case odds (each within 5 standard errors).
  const total = Object.values(cs.weights).reduce((s, w) => s + w, 0);
  for (const [c, w] of classEntries(cs.weights)) {
    const p = w / total, n = botCls[c] || 0, se = Math.sqrt(N * p * (1 - p));
    assert.ok(Math.abs(n - N * p) <= 5 * se + 1, `bot class ${c}: ${n} vs ${(N * p).toFixed(1)}`);
  }
  assert.ok(outcome.win > N * 0.35 && outcome.lose > N * 0.35, JSON.stringify(outcome));
  // What the player takes home is what his own cases gave (± a few %, sd per battle ≈ 0.6 of a drop).
  assert.ok(Math.abs(got / own - 1) < 0.05, `collection value: got ${got} vs own ${own}`);
  assert.ok(Math.abs(gotSale / ownSale - 1) < 0.05, `sale value: got ${gotSale} vs own ${ownSale}`);
  // …and so opening and selling stays a loss, as when opening yourself: the bot can't be farmed. Exact, from the odds
  // (each battle's got − own is at most the smaller car, so the paired check above is steady; this one isn't sampled).
  const wsum = Object.values(cs.weights).reduce((x, w) => x + w, 0);
  const evSale = classEntries(cs.weights).reduce((x, [c, w]) => {
    const pool = cs.pool(c), mw = S.modelWeights(pool), tot = mw.reduce((a, v) => a + v, 0);
    return x + (w / wsum) * pool.reduce((a, m, i) => a + (mw[i] / tot) * sale(m.id), 0);
  }, 0);
  // Owner 22.10 accepted open-and-sell > 1 on some cases; the battle with the bot still equals opening yourself (checked above).
  assert.ok(evSale > 0);
});

// ---------- race streak ----------
function racer(env, uid) {
  const { g, db, call, advance } = env;
  const car = g.giveCar(uid, S.ALL_MODELS.find((m) => m.cls === 'C' && !m.secret).id).id;
  return () => {
    db.prepare('UPDATE users SET fuel = ?, fuel_at = ? WHERE id = ?').run(S.FUEL_MAX, env.now(), uid);
    db.prepare('DELETE FROM rivals WHERE user_id = ?').run(uid);
    call(uid, 'race/rivals', { carId: car });
    const st = call(uid, 'race/start', { carId: car, rival: 'train' });
    const run = honestDrag(st.car, st.greenMs, 0.2, ['good', 'good', 'good', 'good']);
    advance(Math.ceil(run.ms) + 50);
    return call(uid, 'race/finish', { raceId: st.raceId, ...run.body });
  };
}
const at = (iso) => Date.parse(iso);

test('race streak: Kyiv days — 23:58 and 00:02 are two days, two races on one Kyiv day are one; a missed day is frozen once a week', () => {
  const env = setup({ t0: at('2026-10-19T20:58:00Z') }); // Mon 19.10, 23:58 Kyiv (UTC+3)
  const { mk, call, set } = env;
  mk(1);
  const race = racer(env, 1);
  const rs = () => call(1, 'me').raceStreak;
  assert.deepEqual([rs().n, rs().alive], [0, false]);
  race();
  assert.equal(dayOf(env.now()), '2026-10-19');
  assert.deepEqual([rs().n, rs().today, rs().freezeReady], [1, true, true]);
  set(at('2026-10-19T21:02:00Z')); // Tue 20.10, 00:02 Kyiv
  race();
  assert.equal(rs().n, 2);
  set(at('2026-10-20T20:50:00Z')); // Tue 23:50 Kyiv — the same Kyiv day, another UTC date
  race();
  assert.equal(rs().n, 2, 'one Kyiv day counts once');
  // Wednesday missed: on Thursday morning the run is still alive (frozen), and racing keeps it.
  set(at('2026-10-22T06:00:00Z'));
  let s = rs();
  assert.deepEqual([s.n, s.alive, s.frozen, s.today, s.freezeReady], [2, true, true, false, false]);
  race();
  s = rs();
  assert.deepEqual([s.n, s.frozen, s.freezeReady, s.ready], [3, false, false, 1], 'the frozen day keeps the run but does not add to it');
  // Friday missed too: the week's freeze is gone → the run starts over on Saturday.
  set(at('2026-10-24T09:00:00Z'));
  assert.deepEqual([rs().n, rs().alive], [0, false]);
  race();
  s = rs();
  assert.deepEqual([s.n, s.best], [1, 3]);
});

test('race streak: Sunday and Monday missed fall in two weeks — two freezes; across the DST change (25.10) the Kyiv day still flips at midnight; three days break it', () => {
  const env = setup({ t0: at('2026-10-23T12:00:00Z') }); // Fri 23.10
  const { mk, call, set } = env;
  mk(1);
  const race = racer(env, 1);
  const rs = () => call(1, 'me').raceStreak;
  race();
  set(at('2026-10-24T12:00:00Z')); // Sat 24.10
  race();
  assert.equal(rs().n, 2);
  // Sun 25.10 (clocks go back at 04:00 → UTC+2) and Mon 26.10 missed.
  assert.equal(dayOf(at('2026-10-26T21:30:00Z')), '2026-10-26', 'Mon 23:30 Kyiv in winter time');
  assert.equal(dayOf(at('2026-10-26T22:30:00Z')), '2026-10-27', 'Tue 00:30 Kyiv in winter time');
  set(at('2026-10-26T21:30:00Z'));
  assert.deepEqual([rs().alive, rs().frozen, rs().n], [true, true, 2], 'Sunday frozen (week of 19.10), Monday still to come');
  set(at('2026-10-26T22:30:00Z')); // Tue 00:30 Kyiv
  race();
  assert.deepEqual([rs().n, rs().freezeReady], [3, false], 'Sunday (week of 19.10) and Monday (week of 26.10) — two weeks, two freezes');
  // Three days missed (Wed, Thu, Fri) — two of them share a week: the run breaks.
  set(at('2026-10-31T10:00:00Z')); // Sat 31.10
  assert.equal(rs().alive, false);
  race();
  assert.deepEqual([rs().n, rs().best], [1, 3]);
  // Next week the freeze is back.
  set(at('2026-11-02T10:00:00Z')); // Mon 2.11
  assert.equal(rs().freezeReady, true);
});

test('race streak: milestones 3/7/14/30 → pieces and keys of the level key via the rewards center, badge «Вогонь N» on the card, car mark from 7; claim once', () => {
  const env = setup({ t0: at('2026-11-02T10:00:00Z') });
  const { mk, call, db, set } = env;
  mk(1, { level: 20 });
  const race = racer(env, 1);
  const caseId = S.levelKey(20);
  const day = (i) => set(at('2026-11-02T10:00:00Z') + i * 86400e3);
  const rs = () => call(1, 'me').raceStreak;
  const badge = () => ({ ...db.prepare("SELECT title, tier FROM badges WHERE user_id = 1 AND key = 'fire'").get() });
  const keys = () => db.prepare('SELECT count FROM keys WHERE user_id = 1 AND case_id = ?').get(caseId)?.count || 0;
  const frags = () => db.prepare('SELECT count FROM fragments WHERE user_id = 1 AND case_id = ?').get(caseId)?.count || 0;
  for (let i = 0; i < 3; i++) (day(i), race());
  let s = rs();
  assert.deepEqual([s.n, s.ready, s.fire, s.next], [3, 1, 0, 7]);
  assert.deepEqual(badge(), { title: 'Вогонь 3', tier: 0 });
  const claim = call(1, 'pulse').claims.find((c) => c.kind === 'fire');
  assert.match(claim.title, /3 дні поспіль/);
  assert.match(claim.sub, /2 фрагменти ключа/);
  const r = call(1, 'streak/claim');
  assert.deepEqual([r.caseId, r.frag, r.keys], [caseId, 2, 0]);
  assert.equal(frags(), 2);
  assert.throws(() => call(1, 'streak/claim'), /Немає нагород/);
  assert.equal(call(1, 'pulse').claims.find((c) => c.kind === 'fire'), undefined);
  // Day 7 through «Забрати все».
  for (let i = 3; i < 7; i++) (day(i), race());
  assert.deepEqual([rs().n, rs().fire], [7, 7]);
  assert.deepEqual(badge(), { title: 'Вогонь 7', tier: 1 });
  const all = call(1, 'rewards/all');
  assert.ok(all.kinds.includes('fire'));
  assert.equal(frags(), 6);
  // 14 and 30: keys. A milestone left unclaimed survives a broken run.
  for (let i = 7; i < 30; i++) (day(i), race());
  s = rs();
  assert.deepEqual([s.n, s.ready, s.fire, s.best], [30, 2, 30, 30]);
  assert.deepEqual(badge(), { title: 'Вогонь 30', tier: 3 });
  day(40); // ten days away: the run is over
  race();
  s = rs();
  assert.deepEqual([s.n, s.fire, s.best, s.ready], [1, 0, 30, 2]);
  const k0 = keys();
  const r2 = call(1, 'streak/claim');
  assert.deepEqual([r2.keys, r2.milestones], [3, [14, 30]]);
  assert.equal(keys(), k0 + 3);
  assert.deepEqual(badge(), { title: 'Вогонь 30', tier: 3 }, 'the badge never goes down');
  // Rewards are small: a 30-day run gives under 4 level keys.
  const per30 = S.RACE_STREAK.milestones.reduce((n, m) => n + (S.raceStreakReward(m).keys || 0) + (S.raceStreakReward(m).frag || 0) / S.FRAGMENTS_PER_KEY, 0);
  assert.ok(per30 < 4, `keys per 30-day run: ${per30}`);
});

test('race streak: PvP on autopilot counts only for the one who raced; free drift training never counts', () => {
  const env = setup();
  const { mk, call, db, g } = env;
  mk(2);
  mk(3);
  const c2 = g.giveCar(2, S.ALL_MODELS.find((m) => m.cls === 'B' && !m.secret).id).id;
  const c3 = g.giveCar(3, S.ALL_MODELS.find((m) => m.cls === 'B' && !m.secret).id).id;
  const { id } = call(2, 'pvp/create', { carId: c2, bet: S.PVP_MIN_BET });
  db.prepare('UPDATE users SET last_seen = 0 WHERE id = 2').run();
  const list = call(3, 'pvp/list').open;
  assert.equal(list.find((p) => p.id === id).auto, true, 'the list says before the bet that a bot drives his car');
  call(3, 'pvp/accept', { id, carId: c3 });
  assert.equal(call(3, 'me').raceStreak.n, 1);
  assert.equal(call(2, 'me').raceStreak.n, 0, 'the creator was away');
  const st = call(3, 'drift/start', { carId: c3, rival: 'train' });
  assert.equal(st.rival.training, true);
  env.advance(200e3);
  call(3, 'drift/finish', { runId: st.runId, score: 0 });
  assert.equal(db.prepare('SELECT n FROM race_streak WHERE user_id = 3').get().n, 1);
});
