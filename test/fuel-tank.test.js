// «Більший бак» (S.TANK_UPGRADES, users.tank_lvl) and «Каністра» (S.CANISTER): the shared tank's max is the player's
// own everywhere fuel is capped or refilled — regen, race/drift starts, the empty-tank error, «бак повний» reminders,
// full-tank rewards, the comeback gift, the star refuel, clubs' fuel, the fuel event; earned fuel never goes above it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { PUSH } from '../src/reminders.js';
import * as S from '../public/shared.js';
import * as M from '../src/metrics.js';

const MIN = 60e3, H = 3600e3, D = 86400e3;
const K = (s) => Date.parse(s + '+02:00'); // Kyiv wall clock in winter time

function setup({ t0 = K('2026-11-06T12:00:00'), random = () => 0.5 } = {}) {
  const clock = { t: t0 };
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => clock.t, random, admins: [1], notify: () => {}, allUnlocked: true });
  const mk = (id, level = 16, balance = 1e9) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ?, slots = 40 WHERE id = ?').run(level, level, balance, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const user = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const set = (id, sql, ...a) => db.prepare(`UPDATE users SET ${sql} WHERE id = ?`).run(...a, id);
  const tank = (id, lvl, fuel, at = clock.t) => set(id, 'tank_lvl = ?, fuel = ?, fuel_at = ?', lvl, fuel, at);
  return { db, g, clock, mk, call, user, set, tank, add: (ms) => (clock.t += ms) };
}

test('rules: three steps 18 / 21 / 25 for 2 / 10 / 50 млн ₴ from levels 5 / 10 / 15; no star item for it', () => {
  assert.deepEqual(S.TANK_UPGRADES.map((u) => [u.max, u.cost, u.level]), [[18, 2e6, 5], [21, 10e6, 10], [25, 50e6, 15]]);
  assert.deepEqual([0, 1, 2, 3, 9].map(S.fuelMaxOf), [15, 18, 21, 25, 25]);
  assert.equal(S.nextTank(0).max, 18);
  assert.equal(S.nextTank(3), null);
  assert.ok(!S.SHOP_ITEMS.some((i) => /tank|бак/i.test(i.id)), 'the tank is not sold for stars');
  assert.equal(S.VIP.extraTank, undefined, 'VIP gives no tank');
  assert.deepEqual(S.CANISTER, { daily: 3, quest: 1, spare: 3 });
});

test('tank/upgrade: level gate, ₴ only, in order, keeps the fuel; me reports the max; nothing past 25', () => {
  const { mk, call, user, set, db } = setup();
  mk(1, 4, 100e6);
  assert.equal(call(1, 'me').fuelMax, 15);
  assert.equal(call(1, 'me').tankLvl, 0);
  assert.throws(() => call(1, 'tank/upgrade'), /з 5-го рівня/);
  set(1, 'level = 5, balance = 1999999');
  assert.throws(() => call(1, 'tank/upgrade'), /Недостатньо/);
  set(1, 'balance = 100000000');
  assert.deepEqual(call(1, 'tank/upgrade'), { tankLvl: 1, fuelMax: 18 });
  assert.equal(user(1).balance, 98e6);
  const me = call(1, 'me');
  assert.equal(me.fuelMax, 18);
  assert.equal(me.fuel, 15, 'what was in the tank stays');
  assert.ok(me.fuelNext, 'a full 15 now refills towards 18');
  assert.throws(() => call(1, 'tank/upgrade'), /з 10-го рівня/);
  set(1, 'level = 15');
  call(1, 'tank/upgrade');
  call(1, 'tank/upgrade');
  assert.equal(user(1).tank_lvl, 3);
  assert.equal(user(1).balance, 100e6 - 62e6);
  assert.throws(() => call(1, 'tank/upgrade'), /найбільший/);
  // The money left as a sink: garage upkeep in the owner metrics, not «other».
  assert.equal(M.groupOf('tank/upgrade'), 'upkeep');
  assert.ok(db.prepare('SELECT destroyed FROM money_days').get().destroyed >= 62e6);
});

test('regen fills up to the own max (not 15) and stops there; the fuel event doubles it up to the own max', () => {
  const s = setup();
  s.mk(1);
  s.tank(1, 1, 15);
  s.add(59 * MIN);
  assert.equal(s.call(1, 'me').fuel, 17);
  s.add(MIN);
  assert.equal(s.call(1, 'me').fuel, 18);
  assert.equal(s.call(1, 'me').fuelNext, null);
  s.add(5 * H);
  assert.equal(s.call(1, 'me').fuel, 18);
  // «Подвійне пальне» (Thursday 29.10 00:00–24:00): +1 every 10 minutes, all the way to 25.
  const e = setup({ t0: K('2026-10-29T10:00:00') });
  assert.ok(S.activeEvents(e.clock.t).some((x) => x.id === 'fuel'), 'the fuel event runs then');
  e.mk(2);
  e.tank(2, 3, 10);
  e.add(100 * MIN);
  assert.equal(e.call(2, 'me').fuel, 20);
  e.add(60 * MIN);
  assert.equal(e.call(2, 'me').fuel, 25);
  assert.equal(e.call(2, 'me').fuelNext, null);
});

test('race and drift starts take one from the own tank; a full big tank starts its clock; the empty card says n/max', () => {
  const s = setup();
  s.mk(1);
  const car = s.g.giveCar(1, 'vaz-2107').id;
  s.tank(1, 1, 18, s.clock.t - 3 * H);
  s.call(1, 'race/start', { carId: car, rival: 'easy' });
  let u = s.user(1);
  assert.equal(u.fuel, 17);
  assert.equal(u.fuel_at, s.clock.t, 'from full, the regen clock starts now');
  s.add(2 * MIN);
  s.call(1, 'drift/start', { carId: car, rival: 'easy' });
  assert.equal(s.call(1, 'me').fuel, 16);
  // 19 of 21 after a while: a start keeps the regen clock.
  s.tank(1, 2, 19, s.clock.t - 5 * MIN);
  s.add(2 * MIN);
  s.call(1, 'race/start', { carId: car, rival: 'easy' });
  u = s.user(1);
  assert.equal(u.fuel, 18);
  assert.equal(u.fuel_at, s.clock.t - 7 * MIN);
  s.tank(1, 1, 0);
  s.add(2 * MIN);
  assert.throws(() => s.call(1, 'race/start', { carId: car, rival: 'easy' }), /Пальне 0\/18 — \+1 через \d+ хв/);
});

test('boss start: the own tank too', () => {
  const s = setup();
  s.mk(1, 99);
  const b = S.BOSSES[0];
  const model = S.ALL_MODELS.filter((m) => !m.secret && S.bossFits(b, m.id))[0].id;
  const car = s.g.giveCar(1, model).id;
  s.tank(1, 3, 25, s.clock.t - H);
  s.call(1, 'boss/start', { carId: car, boss: b.id });
  assert.equal(s.user(1).fuel, 24);
  assert.equal(s.user(1).fuel_at, s.clock.t);
});

test('«бак повний» reminder only at the own max', () => {
  const s = setup();
  s.mk(1);
  s.set(1, 'last_seen = ?', s.clock.t - 3 * H);
  s.tank(1, 1, 15, s.clock.t); // 15 of 18: not full
  const ready = () => s.g.pushCandidates(PUSH).find((c) => c.uid === 1)?.ready.map((r) => r.kind) || [];
  assert.ok(!ready().includes('fuel'));
  s.add(H); // +3 → 18
  assert.ok(ready().includes('fuel'));
  s.set(1, 'tank_lvl = 0, fuel = 15'); // a plain tank at 15 is full
  assert.ok(ready().includes('fuel'));
});

test('full-tank refills give the own max: reward case, star refuel, comeback gift', () => {
  // The reward case: x = 0.85 lands on «повний бак» (money 0.5 + part 0.3 < 0.85 < + fuel 0.12).
  const s = setup({ random: () => 0.85 });
  s.mk(1);
  s.tank(1, 2, 3);
  s.set(1, 'reward_case_at = 0');
  const r = s.call(1, 'rewards/case');
  assert.equal(r.reward.fuel, true);
  assert.equal(s.call(1, 'me').fuel, 21);
  s.tank(1, 2, 3);
  s.set(1, 'stars = 100');
  s.call(1, 'shop/stars', { item: 'refuel' });
  assert.equal(s.call(1, 'me').fuel, 21);
  // Comeback: three days away at level 5+ → the own full tank.
  const c = setup();
  c.mk(2, 6);
  c.set(2, 'created_at = ?', c.clock.t - 30 * D);
  c.add(3 * D + H);
  c.tank(2, 1, 0, c.clock.t - MIN);
  c.mk(2, 6); // ensureUser = the visit
  assert.equal(c.user(2).fuel, 18);
});

test('clubs «Клубна заправка»: tops up to the own max only', () => {
  const s = setup({ t0: K('2026-10-28T12:00:00') });
  s.mk(1);
  s.g.giveCar(1, 'vaz-2107');
  s.call(1, 'club/create', { tag: 'БАКИ', name: 'Баки' });
  s.call(1, 'club/donate', { amount: 50000000 });
  s.call(1, 'club/perk', { perk: 'fuel' });
  s.add(25 * H);
  s.tank(1, 1, 16);
  assert.equal(s.call(1, 'club/claim', { kind: 'fuel' }).fuel, 2, '16 → 18, not +3 and not capped at 15');
  assert.equal(s.user(1).fuel, 18);
});

test('«Каністра»: +3 with the daily bonus, +1 per daily quest, never above the own max; rewards/all reports it', () => {
  const s = setup();
  s.mk(1);
  s.tank(1, 0, 5);
  let d = s.call(1, 'rewards/daily');
  assert.equal(d.reward.canister, 3);
  assert.equal(s.call(1, 'me').fuel, 8);
  // Next day, 17 of 18: 1 goes in, 2 wait in the reserve (fix5: a canister on a full tank isn't lost).
  s.add(D);
  s.tank(1, 1, 17);
  d = s.call(1, 'rewards/daily');
  assert.equal(d.reward.canister, 3);
  assert.equal(s.call(1, 'me').fuel, 18);
  assert.equal(s.call(1, 'me').fuelSpare, 2);
  // Quests: +1 each; a full tank takes nothing (the money still comes).
  const day = () => s.db.prepare('SELECT day FROM quests WHERE user_id = 1 ORDER BY day DESC LIMIT 1').get().day;
  s.call(1, 'quests');
  s.db.prepare('UPDATE quests SET progress = target WHERE user_id = 1 AND day = ?').run(day());
  const keys = s.db.prepare('SELECT key FROM quests WHERE user_id = 1 AND day = ?').all(day()).map((r) => r.key);
  s.tank(1, 1, 10);
  const q1 = s.call(1, 'quests/claim', { key: keys[0] });
  assert.equal(q1.canister, 1);
  assert.equal(s.call(1, 'me').fuel, 11);
  s.tank(1, 1, 21); // 18 + a full reserve of 3: nothing more goes in (the money still comes)
  const q2 = s.call(1, 'quests/claim', { key: keys[1] });
  assert.equal(q2.canister, 0);
  assert.ok(q2.got > 0);
  assert.equal(s.call(1, 'me').fuel, 18);
  assert.equal(s.call(1, 'me').fuelSpare, 3);
  // «Забрати все» next day: daily +3 and the quests +1 each, told apart from a full-tank reward.
  s.add(D);
  s.call(1, 'quests');
  s.db.prepare('UPDATE quests SET progress = target WHERE user_id = 1 AND day = ?').run(day());
  const n = s.db.prepare('SELECT COUNT(*) n FROM quests WHERE user_id = 1 AND day = ?').get(day()).n;
  s.tank(1, 3, 2);
  s.set(1, 'reward_case_at = ?', s.clock.t); // the reward case not ready (it could give a full tank)
  const all = s.call(1, 'rewards/all');
  assert.equal(all.canister, 3 + n);
  assert.equal(all.fuel, false, 'no «повний бак» for canister fuel');
  assert.equal(s.call(1, 'me').fuel, 2 + 3 + n);
});

test('admin reset takes the big tank away with the rest', () => {
  const s = setup();
  s.mk(1);
  s.mk(5);
  s.tank(5, 2, 20);
  s.g.adminCall('tg:1', 'reset', { id: 5, reason: 'тест', confirm: true });
  assert.equal(s.user(5).tank_lvl, 0);
  assert.equal(s.call(5, 'me').fuelMax, 15);
  assert.equal(s.call(5, 'me').fuel, 15);
});
