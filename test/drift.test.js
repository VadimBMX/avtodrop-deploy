import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-20T10:00:00Z');
  const clock = { now: () => t, add: (ms) => (t += ms) };
  const g = createGame(db, { now: clock.now, notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e9, level = 99, level_seen = 99 WHERE id = 1').run();
  const car = g.giveCar(1, 'vaz-2107').id;
  return { db, g, clock, car, call: (name, body = {}) => g.api[name](1, body) };
}

test('drift: three rivals with rising targets, prize as in drag races', () => {
  const { call, car } = setup();
  const { list, model } = call('drift/rivals', { carId: car });
  assert.deepEqual(list.map((r) => r.id), ['easy', 'mid', 'hard']);
  assert.ok(list[0].target < list[1].target && list[1].target < list[2].target && list[2].target < S.DRIFT_MAX);
  assert.equal(list[2].prize, S.raceMoney(S.OPPONENTS[2], S.MODELS['vaz-2107'].price).prize);
  assert.ok(model.zone[0] < S.DRIFT.center && model.zone[1] > S.DRIFT.center && model.zone[1] < model.spin);
  assert.deepEqual(call('drift/rivals', { carId: car }).list, list, 'same rivals all day');
});

test('drift: a run pays the prize when the score beats the target, uses fuel, counts as a race', () => {
  const { call, car, clock } = setup();
  const before = call('me');
  const st = call('drift/start', { carId: car, rival: 'easy' });
  assert.equal(call('me').fuel, before.fuel - 1);
  assert.throws(() => call('drift/finish', { runId: st.runId, score: 9999 }), /ще не закінчився/);
  clock.add(S.DRIFT_MS);
  const r = call('drift/finish', { runId: st.runId, score: st.rival.target + 100, clean: 4, spins: 1 });
  assert.equal(r.win, true);
  const me = call('me');
  assert.equal(me.balance, before.balance + st.rival.prize);
  assert.equal(me.stats.races, before.stats.races + 1);
  assert.throws(() => call('drift/finish', { runId: st.runId, score: 1 }), /завершено/);
});

test('drift: the score is capped at a perfect run; a low score loses the entry', () => {
  const { call, car, clock } = setup();
  const st = call('drift/start', { carId: car, rival: 'hard' });
  clock.add(S.DRIFT_MS);
  assert.equal(call('drift/finish', { runId: st.runId, score: 1e9 }).score, S.DRIFT_MAX);
  const before = call('me').balance;
  const st2 = call('drift/start', { carId: car, rival: 'hard' });
  clock.add(S.DRIFT_MS);
  const r = call('drift/finish', { runId: st2.runId, score: 10 });
  assert.equal(r.win, false);
  assert.equal(call('me').balance, before - st2.rival.entry);
});

test('drift: grip from tuning widens the green zone, power sharpens the slide', () => {
  const base = S.driftModel({ hp: 100, kg: 1000, grip: 0.35 });
  const tuned = S.driftModel({ hp: 100, kg: 1000, grip: 0.7 });
  const strong = S.driftModel({ hp: 800, kg: 1000, grip: 0.35 });
  assert.ok(tuned.zone[1] - tuned.zone[0] > base.zone[1] - base.zone[0]);
  assert.ok(strong.turn > base.turn);
});
