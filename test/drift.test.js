import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { clientDrift } from './race-helpers.js';

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
const lcg = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

test('drift: a track of the day and three rivals with rising targets from its par; prize as in drag races', () => {
  const { call, car } = setup();
  const { list, model, track, par } = call('drift/rivals', { carId: car });
  assert.deepEqual(list.map((r) => r.id), ['easy', 'mid', 'hard']);
  assert.ok(list[0].target < list[1].target && list[1].target < list[2].target && list[2].target < S.DRIFT_MAX);
  assert.equal(par, S.driftPar(S.driftModel(S.carStats({ model: 'vaz-2107' })), S.driftTrack(track)));
  list.forEach((r, i) => assert.ok(Math.abs(r.target / (par * S.DRIFT_RIVALS[i].share) - 1) <= 0.05));
  assert.equal(list[2].prize, S.raceMoney(S.OPPONENTS[2], S.MODELS['vaz-2107'].price).prize);
  assert.ok(model.zone[0] < S.DRIFT.center && model.zone[1] > S.DRIFT.center && model.zone[1] < model.spin);
  const again = call('drift/rivals', { carId: car });
  assert.deepEqual(again.list, list, 'same rivals all day');
  assert.equal(again.track, track, 'same track all day');
});

test('drift: tracks have 7 corners of every kind and both directions, laid out the same from the same seed', () => {
  let left = 0, right = 0;
  for (let seed = 1; seed < 200; seed++) {
    const t = S.driftTrack(seed * 104729);
    const corners = t.segs.filter((g) => g.kind !== 'straight');
    assert.equal(corners.length, S.DRIFT.corners);
    assert.ok(corners.some((g) => g.kind === 'hair') && corners.some((g) => g.kind === 'fast'));
    corners.forEach((g, i) => assert.equal(g.corner, i));
    assert.equal(t.segs.at(-1).to, t.length);
    for (const g of corners) g.dir > 0 ? right++ : left++;
    assert.deepEqual(S.driftTrack(seed * 104729), t);
  }
  assert.ok(left > 300 && right > 300);
});

test('drift: a run pays the prize when the score beats the target, uses fuel, counts as a race', () => {
  const { call, car, clock } = setup();
  const before = call('me');
  const st = call('drift/start', { carId: car, rival: 'easy' });
  assert.equal(call('me').fuel, before.fuel - 1);
  assert.throws(() => call('drift/finish', { runId: st.runId, score: 9999 }), /ще не закінчився/);
  const run = clientDrift(st, { skill: 0.9 });
  clock.add(S.DRIFT_COUNT_MS + run.ms);
  assert.ok(run.score > st.rival.target, 'a good driver beats the easy rival');
  const r = call('drift/finish', { runId: st.runId, ...run });
  assert.equal(r.win, true);
  assert.equal(r.score, run.score);
  assert.equal(r.check, 'ok');
  const me = call('me');
  assert.equal(me.balance, before.balance + st.rival.prize);
  assert.equal(me.stats.races, before.stats.races + 1);
  assert.throws(() => call('drift/finish', { runId: st.runId, score: 1 }), /завершено/);
});

test('drift: a score without a gas log is capped below the target; a low score loses the entry', () => {
  const { call, car, clock } = setup();
  const st = call('drift/start', { carId: car, rival: 'hard' });
  clock.add(S.DRIFT_COUNT_MS + S.DRIFT_MS);
  const capped = call('drift/finish', { runId: st.runId, score: 1e9 });
  assert.equal(capped.score, Math.floor(st.rival.target * 0.6));
  assert.equal(capped.win, false);
  const before = call('me').balance;
  const st2 = call('drift/start', { carId: car, rival: 'hard' });
  clock.add(S.DRIFT_COUNT_MS + S.DRIFT_MS);
  const r = call('drift/finish', { runId: st2.runId, ...clientDrift(st2, { target: 3 }) });
  assert.equal(r.win, false);
  assert.equal(call('me').balance, before - st2.rival.entry);
});

test('drift: per-corner scoring — combo grows with clean corners in a row, breaks on a dirty one, a spin halves the corner', () => {
  const rnd = lcg(3);
  let seenSpin = false, seenWide = false, seenCombo = false;
  for (let i = 0; i < 60; i++) {
    const model = S.driftModel({ hp: 60 + rnd() * 1200, kg: 1000 + rnd() * 800, grip: 0.35 + rnd() * 0.4 });
    const track = S.driftTrack(i * 99991);
    const r = S.driftBot(model, track, i * 7 + 1, { skill: rnd(), rs: i + 3 });
    let streak = 0;
    for (const c of r.corners) {
      const clean = c.grade === 'perfect' || c.grade === 'clean';
      streak = clean ? streak + 1 : 0;
      assert.equal(c.mult, clean ? S.driftMult(streak) : 1);
      assert.equal(c.pts, Math.floor(c.base * c.mult));
      if (c.grade === 'spin') seenSpin = true;
      if (c.grade === 'wide') seenWide = true;
      if (c.mult >= 2) seenCombo = true;
    }
    assert.equal(r.corners.reduce((a, c) => a + c.pts, 0), r.score);
    assert.equal(r.clean, r.corners.filter((c) => c.grade === 'perfect' || c.grade === 'clean').length);
  }
  assert.ok(seenSpin && seenWide && seenCombo);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(S.driftMult), [1, 1.5, 2, 2.5, 3, 3, 3]);
});

test('drift: car stats matter — grip widens the zone and holds the line, power adds speed; a tuned car scores more', () => {
  const base = S.driftModel({ hp: 100, kg: 1000, grip: 0.35 });
  const tuned = S.driftModel({ hp: 100, kg: 1000, grip: 0.7 });
  const strong = S.driftModel({ hp: 800, kg: 1000, grip: 0.35 });
  assert.ok(tuned.zone[1] - tuned.zone[0] > base.zone[1] - base.zone[0]);
  assert.ok(tuned.lat < base.lat && tuned.recover > base.recover);
  assert.ok(strong.turn > base.turn && strong.vmax > base.vmax && strong.acc > base.acc);
  let a = 0, b = 0, fa = 0, fb = 0;
  for (let k = 1; k <= 30; k++) {
    const track = S.driftTrack(k * 4242);
    const ra = S.driftBot(base, track, k, { skill: 0.5, rs: k }), rb = S.driftBot(tuned, track, k, { skill: 0.5, rs: k });
    a += ra.score;
    b += rb.score;
    fa += ra.ms;
    fb += S.driftBot(strong, track, k, { skill: 0.5, rs: k }).ms;
  }
  assert.ok(b > a * 1.15, `grip parts pay off (${b} vs ${a})`);
  assert.ok(fb < fa, 'a stronger car laps faster');
});

// Rival targets are tuned with tools/sim-drift.mjs; this keeps the tuning honest on a smaller sample.
test('drift (owner 23.10, harder): an average driver beats easy ~80%, medium ~25%, hard rarely; a good one beats hard ~45%', () => {
  const rnd = lcg(2026);
  const cars = [{ hp: 72, kg: 1030, grip: 0.35 }, { hp: 220, kg: 1400, grip: 0.35 }, { hp: 720, kg: 1400, grip: 0.35 }];
  const wins = [0, 0, 0], good = [0, 0, 0], weak = [0, 0, 0];
  let n = 0;
  for (const stats of cars) {
    const m = S.driftModel(stats);
    for (let tr = 0; tr < 20; tr++) {
      const track = S.driftTrack(50000 + tr * 1231);
      const par = S.driftPar(m, track);
      const targets = S.DRIFT_RIVALS.map((r) => Math.round((par * r.share * (0.96 + 0.08 * rnd())) / 10) * 10);
      for (let i = 0; i < 8; i++) {
        const seed = Math.floor(rnd() * 2 ** 31), rs = Math.floor(rnd() * 1e9);
        const avg = S.driftBot(m, track, seed, { skill: 0.5, rs }).score;
        const pro = S.driftBot(m, track, seed, { skill: 0.8, rs }).score;
        const nub = S.driftBot(m, track, seed, { skill: 0.25, rs }).score;
        targets.forEach((t, j) => ((wins[j] += avg >= t), (good[j] += pro >= t), (weak[j] += nub >= t)));
        n++;
      }
    }
  }
  const [easy, mid, hard] = wins.map((w) => w / n);
  assert.ok(easy >= 0.75 && easy <= 0.98, `easy ${easy}`);
  assert.ok(mid >= 0.1 && mid <= 0.4, `mid ${mid}`);
  assert.ok(hard <= 0.08, `hard ${hard}`);
  assert.ok(good[2] / n >= 0.25 && good[2] / n <= 0.65, `a good driver beats the hard rival sometimes: ${good[2] / n}`);
  assert.ok(weak[1] / n <= 0.1 && weak[0] / n >= 0.1, 'a beginner can still beat the easy rival sometimes');
});
