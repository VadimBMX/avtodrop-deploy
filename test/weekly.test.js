import { clientDrift } from './race-helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, weekOf, dayOf } from '../src/game.js';
import * as S from '../public/shared.js';

const H = 3600e3, D = 86400e3;
// Wednesday 2026-10-14, 13:00 in Kyiv (summer time, UTC+3). Its week starts on Monday 2026-10-12.
const T0 = Date.parse('2026-10-14T10:00:00Z');

function setup(t0 = T0) {
  const db = openDb(':memory:');
  const clock = { t: t0 };
  const g = createGame(db, { now: () => clock.t, random: () => 0.5, allUnlocked: true });
  const mk = (id) => (g.ensureUser({ id, username: 'u' + id, first_name: 'U' + id }), id);
  const user = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const set = (id, sql, ...args) => db.prepare(`UPDATE users SET ${sql} WHERE id = ?`).run(...args, id);
  const keys = (id, caseId) => db.prepare('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(id, caseId)?.count || 0;
  const frags = (id, caseId) => db.prepare('SELECT count FROM fragments WHERE user_id = ? AND case_id = ?').get(id, caseId)?.count || 0;
  // Replace this week's tasks with known ones (the real pick depends on the player id).
  const tasks = (id, list) => {
    const week = g.api.weekly(id).week;
    db.prepare('DELETE FROM weekly_quests WHERE user_id = ? AND week = ?').run(id, week);
    for (const [key, target, progress = 0] of list) db.prepare('INSERT INTO weekly_quests (user_id, week, key, target, progress) VALUES (?, ?, ?, ?, ?)').run(id, week, key, target, progress);
    return week;
  };
  // Mark a day as having `claimed` of its daily tasks claimed.
  const dayQuests = (id, day, claimed) => {
    ['open', 'race', 'win'].forEach((k, i) => db.prepare('INSERT OR REPLACE INTO quests (user_id, day, key, target, progress, reward, claimed) VALUES (?, ?, ?, 1, 1, 1000, ?)').run(id, day, k, i < claimed ? 1 : 0));
  };
  return { db, g, clock, mk, user, set, keys, frags, tasks, dayQuests };
}

test('week starts on Monday 00:00 Kyiv; four tasks from the pool, the same on every call, new ones next week', () => {
  const { g, clock, mk } = setup();
  const id = mk(101);
  const w = g.api.weekly(id);
  assert.equal(w.week, '2026-10-12');
  assert.equal(w.list.length, S.WEEKLY_COUNT);
  assert.equal(new Set(w.list.map((x) => x.key)).size, S.WEEKLY_COUNT);
  for (const x of w.list) {
    const [lo, hi] = S.WEEKLY_QUESTS[x.key].range;
    assert.ok(x.target >= lo && x.target <= hi, x.key);
    assert.equal(x.progress, 0);
  }
  assert.deepEqual(g.api.weekly(id).list, w.list);
  assert.equal(w.days.length, 7);
  assert.equal(w.days[0].day, '2026-10-12');
  assert.equal(w.days[6].day, '2026-10-18');
  // The week ends at Monday 00:00 Kyiv = Sunday 21:00 UTC in summer time.
  assert.equal(w.endsAt, Date.parse('2026-10-18T21:00:00Z'));
  clock.t = Date.parse('2026-10-18T20:59:00Z'); // Sunday 23:59 Kyiv
  assert.equal(g.api.weekly(id).week, '2026-10-12');
  clock.t = Date.parse('2026-10-18T21:00:00Z'); // Monday 00:00 Kyiv
  const w2 = g.api.weekly(id);
  assert.equal(w2.week, '2026-10-19');
  assert.equal(w2.list.length, S.WEEKLY_COUNT);
  assert.ok(w2.list.every((x) => x.progress === 0 && !x.claimed));
  assert.equal(w2.active, 0);
  // Winter time (UTC+2) after the clocks go back on 25 October.
  clock.t = Date.parse('2026-10-28T10:00:00Z');
  assert.equal(g.api.weekly(id).endsAt, Date.parse('2026-11-01T22:00:00Z'));
});

test('progress: cases, country cases, income collection and drift runs count; capped at the target', () => {
  const { g, clock, mk, set, tasks } = setup();
  const id = mk(102);
  set(id, 'balance = ?', 1e9);
  tasks(id, [['open', 3], ['country', 2], ['collect', 1], ['drift', 5]]);
  g.api['case/open'](id, { caseId: 'c-ua', count: 1 });
  g.api['case/open'](id, { caseId: 'rust', count: 1 });
  let w = g.api.weekly(id);
  const p = (k) => w.list.find((x) => x.key === k).progress;
  assert.equal(p('open'), 2);
  assert.equal(p('country'), 1);
  g.api['case/open'](id, { caseId: 'c-ua', count: 3 });
  w = g.api.weekly(id);
  assert.equal(p('open'), 3, 'capped at target');
  assert.equal(p('country'), 2);
  clock.t += H;
  g.api.collect(id);
  w = g.api.weekly(id);
  assert.equal(p('collect'), 1);
  // A drift run counts once it is finished, not when it starts or fails.
  const car = g.api.me(id).cars[0];
  const riv = g.api['drift/rivals'](id, { carId: car.id }).list[0];
  const run = g.api['drift/start'](id, { carId: car.id, rival: riv.id });
  assert.throws(() => g.api['drift/finish'](id, { runId: run.runId, score: 0 }));
  assert.equal(g.api.weekly(id).list.find((x) => x.key === 'drift').progress, 0);
  clock.t += S.DRIFT_COUNT_MS + S.DRIFT_MS;
  g.api['drift/finish'](id, { runId: run.runId, ...clientDrift(run) });
  assert.equal(g.api.weekly(id).list.find((x) => x.key === 'drift').progress, 1);
  // Progress from last week does not carry over.
  clock.t = Date.parse('2026-10-19T08:00:00Z');
  assert.ok(g.api.weekly(id).list.every((x) => x.progress === 0));
});

test('a finished task pays WEEKLY_FRAG fragments of the level key exactly once; a full set becomes a key', () => {
  const { db, g, mk, set, keys, frags, tasks } = setup();
  const id = mk(103);
  set(id, 'level = ?', 12); // tuning key
  assert.equal(S.levelKey(12), 'tuning');
  tasks(id, [['open', 3, 3], ['win', 12, 5], ['collect', 8, 8], ['merge', 4, 4]]);
  assert.throws(() => g.api['weekly/claim'](id, { key: 'win' }), /ще не виконано/);
  assert.throws(() => g.api['weekly/claim'](id, { key: 'nope' }), /не знайдено/);
  const xp0 = db.prepare('SELECT xp, level FROM users WHERE id = ?').get(id);
  const r = g.api['weekly/claim'](id, { key: 'open' });
  assert.deepEqual([r.caseId, r.frag, r.newKeys], ['tuning', S.WEEKLY_FRAG, 0]);
  assert.equal(frags(id, 'tuning'), 2);
  assert.ok(db.prepare('SELECT xp FROM users WHERE id = ?').get(id).xp > xp0.xp);
  assert.throws(() => g.api['weekly/claim'](id, { key: 'open' }), /вже отримано/);
  assert.equal(frags(id, 'tuning'), 2);
  // 6 + 2 = 8 fragments → one key, fragments back to 0.
  db.prepare('UPDATE fragments SET count = 6 WHERE user_id = ? AND case_id = ?').run(id, 'tuning');
  const r2 = g.api['weekly/claim'](id, { key: 'collect' });
  assert.equal(r2.newKeys, 1);
  assert.equal(keys(id, 'tuning'), 1);
  assert.equal(frags(id, 'tuning'), 0);
  // The banner list offers finished, unclaimed tasks only.
  const pulse = g.api.pulse(id).claims.filter((c) => c.kind === 'weekly').map((c) => c.id);
  assert.deepEqual(pulse, ['merge']);
});

test('chests: active day = 2 of 3 daily tasks claimed; 3/5/7 days; each chest opens once per week', () => {
  const { db, g, clock, mk, set, keys, frags, dayQuests, user } = setup(Date.parse('2026-10-18T10:00:00Z')); // Sunday
  const id = mk(104);
  set(id, 'level = ?', 7); // city key, stock parts
  dayQuests(id, '2026-10-11', 3); // last week's Sunday: does not count
  dayQuests(id, '2026-10-12', 2);
  dayQuests(id, '2026-10-13', 1); // one task only: not active
  dayQuests(id, '2026-10-14', 3);
  let w = g.api.weekly(id);
  assert.equal(w.active, 2);
  assert.deepEqual(w.days.map((d) => d.active), [true, false, true, false, false, false, false]);
  assert.throws(() => g.api['weekly/chest'](id, { days: 3 }), /3 активних/);
  dayQuests(id, '2026-10-15', 2);
  w = g.api.weekly(id);
  assert.equal(w.active, 3);
  assert.deepEqual(w.chests.map((c) => c.ready), [true, false, false]);
  assert.ok(g.api.pulse(id).claims.some((c) => c.kind === 'wchest' && c.id === 3));
  const parts0 = db.prepare('SELECT COALESCE(SUM(count), 0) n FROM parts WHERE user_id = ?').get(id).n;
  const r = g.api['weekly/chest'](id, { days: 3 });
  assert.equal(r.items.length, 5);
  assert.ok(r.items.every((p) => p.tier === 'stock'));
  assert.equal(db.prepare('SELECT COALESCE(SUM(count), 0) n FROM parts WHERE user_id = ?').get(id).n, parts0 + 5);
  assert.throws(() => g.api['weekly/chest'](id, { days: 3 }), /вже відкрито/);
  assert.ok(!g.api.pulse(id).claims.some((c) => c.kind === 'wchest'));
  assert.throws(() => g.api['weekly/chest'](id, { days: 4 }), /Немає такої/);
  assert.throws(() => g.api['weekly/chest'](id, { days: 5 }), /5 активних/);
  for (const d of ['2026-10-16', '2026-10-17']) dayQuests(id, d, 2);
  set(id, 'fuel = 0, fuel_at = ?', clock.t);
  const r5 = g.api['weekly/chest'](id, { days: 5 });
  assert.equal(r5.frag, 2);
  assert.equal(frags(id, 'city'), 2);
  assert.equal(user(id).fuel, S.FUEL_MAX);
  assert.throws(() => g.api['weekly/chest'](id, { days: 7 }), /7 активних/);
  for (const d of ['2026-10-13', '2026-10-18']) dayQuests(id, d, 2);
  const r7 = g.api['weekly/chest'](id, { days: 7 });
  assert.equal(r7.keys, 1);
  assert.equal(keys(id, 'city'), 1);
  assert.throws(() => g.api['weekly/chest'](id, { days: 7 }), /вже відкрито/);
  // Next week the chests start over.
  clock.t = Date.parse('2026-10-19T10:00:00Z');
  w = g.api.weekly(id);
  assert.equal(w.active, 0);
  assert.ok(w.chests.every((c) => !c.ready && !c.claimed));
});

test('active days come from claiming real daily tasks', () => {
  const { db, g, mk } = setup();
  const id = mk(105);
  g.api.quests(id);
  db.prepare('UPDATE quests SET progress = target WHERE user_id = ?').run(id);
  const ks = db.prepare('SELECT key FROM quests WHERE user_id = ? AND day = ?').all(id, dayOf(T0)).map((r) => r.key);
  g.api['quests/claim'](id, { key: ks[0] });
  assert.equal(g.api.weekly(id).active, 0);
  g.api['quests/claim'](id, { key: ks[1] });
  assert.equal(g.api.weekly(id).active, 1);
  assert.equal(g.api.weekly(id).days.find((d) => d.day === dayOf(T0)).active, true);
});

test('comeback: 3+ days away at level 5+ → full tanks and a small key, shown once as a gift', () => {
  const { db, g, clock, mk, set, keys, user } = setup();
  const id = mk(106);
  set(id, 'level = 5, created_at = ?, fuel = 0, fuel_at = ?', T0 - 30 * D, T0);
  const car = g.giveCar(id, S.ALL_MODELS.find((m) => m.cls === 'D').id);
  db.prepare('UPDATE cars SET tank = 0, tank_at = ? WHERE id = ?').run(T0, car.id);
  clock.t = T0 + 3 * D - H; // not quite three days
  mk(id);
  assert.equal(g.api.pulse(id).gifts.length, 0);
  clock.t += 3 * D + H; // three days after the last visit above
  set(id, 'fuel = 0, fuel_at = ?', clock.t - 60e3); // tank drained while away (regen math aside)
  db.prepare('UPDATE cars SET tank = 0, tank_at = ? WHERE id = ?').run(clock.t - 60e3, car.id);
  mk(id);
  const u = user(id);
  assert.equal(u.fuel, S.FUEL_MAX);
  assert.equal(db.prepare('SELECT tank FROM cars WHERE id = ?').get(car.id).tank, S.CAR_TANK);
  assert.equal(keys(id, 'rust'), 1);
  assert.equal(u.comeback_cap_until, 0, 'no longer cap under 7 days');
  const gifts = g.api.pulse(id).gifts;
  assert.equal(gifts.length, 1);
  assert.equal(gifts[0].kind, 'comeback');
  assert.equal(gifts[0].data.days, 3);
  assert.deepEqual(gifts[0].data.keys, [{ caseId: 'rust', count: 1 }]);
  g.api['gifts/seen'](id, { ids: [gifts[0].id] });
  assert.equal(g.api.pulse(id).gifts.length, 0);
  // Coming back again: last_seen moved, and the cooldown holds even after another long break.
  mk(id);
  g.api.me(id);
  clock.t += 10 * D;
  mk(id);
  assert.equal(keys(id, 'rust'), 1, 'cooldown of 14 days');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gifts WHERE user_id = ? AND kind = 'comeback'").get(id).n, 1);
  clock.t += 15 * D;
  g.api.me(id); // the api path checks too (no sign-in in between)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gifts WHERE user_id = ? AND kind = 'comeback'").get(id).n, 2);
});

test('comeback gates: level under 5, a young account or a banned one gets nothing', () => {
  const { db, g, clock, mk, set } = setup();
  const low = mk(107), young = mk(108), banned = mk(109);
  set(low, 'level = 4, created_at = ?', T0 - 30 * D);
  set(young, 'level = 8, created_at = ?', T0 - D); // 6 days old at the return
  set(banned, 'level = 8, created_at = ?, banned = 1', T0 - 30 * D);
  clock.t = T0 + 5 * D;
  for (const id of [low, young, banned]) mk(id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gifts WHERE kind = 'comeback'").get().n, 0);
});

test('comeback after 7+ days: level key too and a longer income cap for 24 h that never pays for the time away', () => {
  const { db, g, clock, mk, set, keys } = setup();
  const id = mk(110);
  set(id, 'level = 12, created_at = ?', T0 - 60 * D);
  g.giveCar(id, S.ALL_MODELS.find((m) => m.cls === 'C').id);
  set(id, 'income_at = ?, banked = 0', T0);
  const capH = S.CAP_LEVELS[0].hours;
  clock.t = T0 + 8 * D;
  mk(id);
  assert.equal(keys(id, 'city'), 1);
  assert.equal(keys(id, 'tuning'), 1);
  let m = g.api.me(id);
  assert.equal(m.income.capH, capH + S.COMEBACK.capHours);
  assert.equal(m.income.comebackUntil, clock.t + S.COMEBACK.capFor * H);
  // What waited at the return is the normal cap's worth, not the longer one's.
  assert.ok(Math.abs(m.income.pending - Math.floor(m.income.rate * capH)) <= 1, `${m.income.pending} vs ${m.income.rate * capH}`);
  const gift = g.api.pulse(id).gifts[0];
  assert.equal(gift.data.capHours, S.COMEBACK.capHours);
  assert.equal(gift.data.keys.length, 2);
  // Collected, then 10 h away: the longer cap lets 8 h build up.
  g.api.collect(id);
  clock.t += 10 * H;
  m = g.api.me(id);
  assert.ok(Math.abs(m.income.pending - Math.floor(m.income.rate * (capH + S.COMEBACK.capHours))) <= 1);
  // VIP does not add on top: the larger extra counts.
  set(id, 'vip_until = ?', clock.t + 30 * D);
  assert.equal(g.api.me(id).income.capH, capH + Math.max(S.VIP.extraHours, S.COMEBACK.capHours));
  set(id, 'vip_until = 0');
  // After the 24 h and a fresh collection the cap is back to normal.
  clock.t += 20 * H;
  g.api.collect(id);
  assert.equal(g.api.me(id).income.capH, capH);
  assert.equal(g.api.me(id).income.comebackUntil, 0);
});

test('comeback keys by level: 5–9 → rust + city after 7+ days; under 5 → nothing', () => {
  const { g, clock, mk, set, keys } = setup();
  const id = mk(111);
  set(id, 'level = 6, created_at = ?', T0 - 60 * D);
  clock.t = T0 + 7 * D;
  mk(id);
  // level 6: small key rust, level key city.
  assert.equal(keys(id, 'rust'), 1);
  assert.equal(keys(id, 'city'), 1);
  const id2 = mk(112);
  set(id2, 'level = 3, created_at = ?', T0 - 60 * D); // under level 5: nothing at all
  clock.t += 8 * D;
  mk(id2);
  assert.equal(keys(id2, 'rust'), 0);
  void g;
});

test('balance: a 7/7 week stays under 25% of what the week’s daily tasks pay, at every level', () => {
  const keyN = (S.WEEKLY_COUNT * S.WEEKLY_FRAG + S.WEEK_CHEST.reduce((s, c) => s + (c.frag || 0), 0)) / S.FRAGMENTS_PER_KEY + S.WEEK_CHEST.reduce((s, c) => s + (c.key || 0), 0);
  const partsN = S.WEEK_CHEST.reduce((s, c) => s + (c.parts || 0), 0);
  // From level 3: levels 1–2 last about a day, nobody makes a 7/7 week there (and the rust key is worth ~40 k).
  for (let lvl = 3; lvl <= 60; lvl++) {
    const q = Object.values(S.QUESTS);
    const daily = 21 * q.reduce((s, k) => s + Math.round((8000 + 4000 * (k.range[0] + k.range[1]) / 2) * Math.pow(lvl, 1.3) / 100) * 100, 0) / q.length;
    const week = keyN * S.CASE_BY_ID[S.levelKey(lvl)].sellEv + partsN * S.TIER_BY_ID[S.levelPartTier(lvl)].price * S.PART_SELL_RATE;
    assert.ok(week / daily < 0.25, `level ${lvl}: ${(week / daily * 100).toFixed(1)}%`);
  }
  // The comeback gift holds no money.
  assert.equal(weekOf(T0), '2026-10-12');
});
