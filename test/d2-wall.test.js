// d2-wall (05.11, sim-report «стіна першої сесії»): a newcomer's first long session ran dry at ~8 min. Boosts only for a
// young account (users.created_at, ECON.newbie): two free full tanks in the first 24 h, the reward case every 20 min in
// the first 2 h, and levels 2–3 for 200 / 450 xp. A veteran (old account) never gets any of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const MIN = 60e3, H = 3600e3, D = 86400e3;

function setup() {
  const clock = { t: Date.parse('2026-11-06T10:00:00Z') };
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => clock.t, random: () => 0.5, notify: () => {} });
  const mk = (id, age = 0) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(clock.t - age, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const empty = (id) => db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = ?').run(clock.t, id);
  return { db, g, clock, mk, call, empty, add: (ms) => (clock.t += ms) };
}

test('rules: 2 refills in 24 h, reward case every 20 min in the first 2 h; L2 200 xp, L3 450 xp, L4+ unchanged', () => {
  assert.deepEqual(S.NEWBIE_BOOST, { fuelRefills: 2, fuelHours: 24, rcaseMin: 20, rcaseHours: 2 });
  assert.deepEqual([1, 2, 3, 4].map(S.xpForLevel), [200, 450, 1100, 1600]);
  const c = 1e12;
  assert.equal(S.newbieFuelLeft({ created_at: c, newbie_fuel: 0 }, c + 23 * H), 2);
  assert.equal(S.newbieFuelLeft({ created_at: c, newbie_fuel: 1 }, c + H), 1);
  assert.equal(S.newbieFuelLeft({ created_at: c, newbie_fuel: 0 }, c + 25 * H), 0, 'only the first day');
  assert.equal(S.rewardCaseNext({ created_at: c, reward_case_at: c + H }), c + H + 20 * MIN);
  assert.equal(S.rewardCaseNext({ created_at: c, reward_case_at: c + 2 * H }), c + 6 * H, 'from the 2nd hour on: 4 h');
  assert.equal(S.rewardCaseNext({ created_at: c, reward_case_at: 0 }), 4 * H, 'never taken: ready at once');
});

test('free refill: a newcomer fills an empty tank twice; not on a tank with fuel; never for a veteran', () => {
  const { call, mk, empty, add } = setup();
  const nb = mk(1), vet = mk(2, 30 * D);
  assert.equal(call(nb, 'me').newbieFuel, 2);
  assert.equal(call(vet, 'me').newbieFuel, 0);
  assert.throws(() => call(nb, 'fuel/newbie'), /не порожній/);
  empty(nb);
  assert.equal(call(nb, 'fuel/newbie').fuel, 15);
  assert.equal(call(nb, 'me').fuel, 15);
  empty(nb);
  assert.equal(call(nb, 'fuel/newbie').left, 0);
  empty(nb);
  assert.throws(() => call(nb, 'fuel/newbie'), /новачків/);
  empty(vet);
  assert.throws(() => call(vet, 'fuel/newbie'), /новачків/);
  const late = mk(3);
  add(25 * H);
  empty(late);
  assert.equal(call(late, 'me').newbieFuel, 0, 'gone after the first 24 h');
  assert.throws(() => call(late, 'fuel/newbie'), /новачків/);
});

test('reward case: every 20 min in the first 2 h of the account, then every 4 h; a veteran waits 4 h', () => {
  const { call, mk, add } = setup();
  const nb = mk(1), vet = mk(2, 30 * D);
  call(nb, 'rewards/case');
  call(vet, 'rewards/case');
  add(19 * MIN);
  assert.throws(() => call(nb, 'rewards/case'), /не готовий/);
  add(MIN);
  assert.ok(call(nb, 'rewards/case').reward, 'a newcomer: 20 min later');
  assert.throws(() => call(vet, 'rewards/case'), /не готовий/);
  assert.equal(call(nb, 'me').rewardCaseAt, Date.parse('2026-11-06T10:40:00Z'));
  let n = 2;
  for (let i = 0; i < 20; i++) {
    add(20 * MIN);
    try { call(nb, 'rewards/case'); n++; } catch {}
  }
  assert.equal(n, 8, 'taken at 0, 20, …, 120 min (7), then the 4-hour gap from the one at 2:00 → one more at 6:00 by 7:00');
  add(4 * H);
  assert.ok(call(vet, 'rewards/case').reward);
});
