// d2-wall (05.11, sim-report «стіна першої сесії»): a newcomer's first long session ran dry at ~8 min. Boosts only for a
// young account (users.created_at, ECON.newbie): free full tanks in the first 24 h, a faster reward case in the first
// hours, and levels 2–3 for 250 / 600 xp (r4-ux; d2-wall had 200 / 450). A veteran (old account) never gets any of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const MIN = 60e3, H = 3600e3, D = 86400e3;
const NB = S.NEWBIE_BOOST;

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

test('rules: the numbers the sim was run with (1 refill, reward case every 30 min for 1.5 h); L2 250 xp, L3 600 xp', () => {
  // Tuned on tools/sim-newbies.mjs (3 seeds): 2 refills + every 20 min for 2 h made the long-session personas 22–37%
  // richer in earned income by day 7 — over the 15% the owner allows.
  assert.deepEqual(NB, { fuelRefills: 1, fuelHours: 24, rcaseMin: 30, rcaseHours: 1.5 });
  assert.deepEqual([1, 2, 3, 4].map(S.xpForLevel), [250, 600, 650, 800]); // r15: 3→4 / 4→5 cut (were 1100 / 1600)
  const c = 1e12;
  assert.equal(S.newbieFuelLeft({ created_at: c, newbie_fuel: 0 }, c + 23 * H), NB.fuelRefills);
  assert.equal(S.newbieFuelLeft({ created_at: c, newbie_fuel: NB.fuelRefills }, c + H), 0);
  assert.equal(S.newbieFuelLeft({ created_at: c, newbie_fuel: 0 }, c + 25 * H), 0, 'only the first day');
  assert.equal(S.rewardCaseNext({ created_at: c, reward_case_at: c + 0.5 * H }), c + 0.5 * H + NB.rcaseMin * MIN);
  assert.equal(S.rewardCaseNext({ created_at: c, reward_case_at: c + NB.rcaseHours * H }), c + (NB.rcaseHours + 4) * H, 'after the first hours: 4 h');
  assert.equal(S.rewardCaseNext({ created_at: c, reward_case_at: 0 }), 4 * H, 'never taken: ready at once');
});

test('free refill: a newcomer fills an empty tank fuelRefills times; not on a tank with fuel; never for a veteran', () => {
  const { call, mk, empty, add } = setup();
  const nb = mk(1), vet = mk(2, 30 * D);
  assert.equal(call(nb, 'me').newbieFuel, NB.fuelRefills);
  assert.equal(call(vet, 'me').newbieFuel, 0);
  assert.throws(() => call(nb, 'fuel/newbie'), /не порожній/);
  for (let i = NB.fuelRefills - 1; i >= 0; i--) {
    empty(nb);
    const r = call(nb, 'fuel/newbie');
    assert.equal(r.fuel, 15);
    assert.equal(r.left, i);
    assert.equal(call(nb, 'me').fuel, 15);
  }
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

test('reward case: every rcaseMin in the account\'s first rcaseHours, then every 4 h; a veteran waits 4 h', () => {
  const { call, mk, add, clock } = setup();
  const nb = mk(1), vet = mk(2, 30 * D);
  const t0 = clock.t;
  call(nb, 'rewards/case');
  call(vet, 'rewards/case');
  add(NB.rcaseMin * MIN - MIN);
  assert.throws(() => call(nb, 'rewards/case'), /не готовий/);
  add(MIN);
  assert.ok(call(nb, 'rewards/case').reward, 'a newcomer: rcaseMin later');
  assert.throws(() => call(vet, 'rewards/case'), /не готовий/);
  assert.equal(call(nb, 'me').rewardCaseAt, t0 + 2 * NB.rcaseMin * MIN);
  // Every rcaseMin until a case is taken at or after rcaseHours, then the 4-hour gap.
  let n = 2;
  const end = t0 + (NB.rcaseHours + 4) * H + NB.rcaseMin * MIN;
  while (clock.t + NB.rcaseMin * MIN < end) {
    add(NB.rcaseMin * MIN);
    try { call(nb, 'rewards/case'); n++; } catch {}
  }
  const fast = Math.floor((NB.rcaseHours * 60) / NB.rcaseMin) + 1; // at 0, rcaseMin, …, rcaseHours
  assert.equal(n, fast + 1, `${fast} in the first hours, then one 4 h later`);
  assert.ok(call(vet, 'rewards/case').reward, 'the veteran: 4 h after his first');
});
