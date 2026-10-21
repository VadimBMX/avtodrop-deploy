// Server-side checks of drag and drift runs: honest runs keep exactly the result the player saw, forged ones are
// corrected or rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { clientDrag, honestDrag, clientDrift } from './race-helpers.js';

function setup() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-21T10:00:00Z');
  const clock = { now: () => t, add: (ms) => (t += ms) };
  const g = createGame(db, { now: clock.now, notify: () => {} });
  const mk = (id) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET balance = 1e9, level = 99, level_seen = 99, slots = 40 WHERE id = ?').run(id);
    return g.giveCar(id, 'vaz-2107').id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, clock, mk, call };
}
const all = (q) => Array(S.SHIFTS).fill(q);
const lcg = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

// ---------- drag: the replay ----------
test('drag replay: random honest runs at 30–144 fps get exactly the shifts and time the player saw', () => {
  const rnd = lcg(42);
  for (let i = 0; i < 1500; i++) {
    const stats = { base: 9 + rnd() * 9, shift: rnd() * 0.6 };
    let t = 0;
    const taps = Array.from({ length: 4 }, () => (t += 150 + rnd() * 1600));
    const c = clientDrag(stats, 2200 + Math.floor(rnd() * 1200), { reactMs: -300 + rnd() * 1900, taps, fps: [30, 60, 90, 120, 144][i % 5] });
    const rep = S.dragReplay(stats, c.reaction, c.body.shiftAt, c.body.shifts);
    assert.deepEqual(rep.shifts, c.shifts);
    assert.equal(rep.corrected, 0);
    assert.equal(S.raceTime(stats, c.reaction, rep.shifts), c.time);
    assert.ok(rep.endMs <= c.ms - c.body.launch + 1e-6, 'the run cannot end later than the player saw it end');
  }
});

test('drag: an honest solo race gives the same result as before (old formula on the same reaction and shifts)', () => {
  const { mk, call, clock } = setup();
  const car = mk(1);
  for (const [react, qs] of [[0.12, all('perfect')], [0.3, ['good', 'late', 'early', 'perfect']], [-1, all('late')], [0.45, all('good')]]) {
    const st = call(1, 'race/start', { carId: car, rival: 'easy' });
    const run = honestDrag(st.car, st.greenMs, react, qs);
    clock.add(run.ms + 20);
    const r = call(1, 'race/finish', { raceId: st.raceId, ...run.body });
    assert.deepEqual(r.shifts, qs);
    assert.equal(r.time, S.raceTime(st.car, react, qs));
    assert.equal(r.perfectStart, react === 0.12);
    assert.equal(r.jump, react < 0);
    assert.equal(r.corrected, 0);
    clock.add(60e3);
  }
});

test('drag: the rival\'s exact time is not sent at the start, only a value rounded to 0.1 s', () => {
  const { mk, call, clock } = setup();
  const car = mk(1);
  const st = call(1, 'race/start', { carId: car, rival: 'hard' });
  assert.equal(st.rival.coarse, true);
  assert.equal(st.rival.me, undefined);
  const run = honestDrag(st.car, st.greenMs, 0.3, all('good'));
  clock.add(run.ms + 20);
  const r = call(1, 'race/finish', { raceId: st.raceId, ...run.body });
  assert.equal(st.rival.time, Math.round(r.rivalTime * 10) / 10);
  if (Math.round(r.rivalTime * 10) / 10 !== r.rivalTime) assert.ok(!JSON.stringify(st).includes(String(r.rivalTime)), 'exact time leaked');
});

test('drag: a forged reaction is recomputed from the launch tap; under 0.1 s after green gets no perfect start', () => {
  const { mk, call, clock } = setup();
  const car = mk(1);
  // Claims a 0.12 s reaction but launched 0.4 s after green.
  let st = call(1, 'race/start', { carId: car, rival: 'easy' });
  let run = honestDrag(st.car, st.greenMs, 0.4, all('good'));
  clock.add(run.ms + 20);
  let r = call(1, 'race/finish', { raceId: st.raceId, ...run.body, reaction: 0.12 });
  assert.equal(r.reaction, 0.4);
  assert.equal(r.perfectStart, false);
  clock.add(60e3);
  // A script tapping 50 ms after green: a lucky guess, no bonus (but no false start either).
  st = call(1, 'race/start', { carId: car, rival: 'easy' });
  run = honestDrag(st.car, st.greenMs, 0.05, all('good'));
  clock.add(run.ms + 20);
  r = call(1, 'race/finish', { raceId: st.raceId, ...run.body });
  assert.equal(r.perfectStart, false);
  assert.equal(r.jump, false);
  assert.equal(r.time, S.raceTime(st.car, 0.05, all('good')));
  assert.ok(r.time > Math.round((st.car.base * S.START.perfectBonus + 0.05) * 1000) / 1000, 'no bonus applied');
});

test('drag: claimed perfect shifts at the wrong moments are corrected to what the taps really were', () => {
  const { mk, call, clock } = setup();
  const car = mk(1);
  const st = call(1, 'race/start', { carId: car, rival: 'easy' });
  const run = honestDrag(st.car, st.greenMs, 0.3, all('early'));
  clock.add(run.ms + 20);
  const r = call(1, 'race/finish', { raceId: st.raceId, ...run.body, shifts: all('perfect') });
  assert.deepEqual(r.shifts, all('early'));
  assert.equal(r.corrected, 4);
  assert.equal(r.time, S.raceTime(st.car, 0.3, all('early')));
});

test('drag: impossible shift timings are rejected', () => {
  const { mk, call, clock } = setup();
  const car = mk(1);
  const st = call(1, 'race/start', { carId: car, rival: 'easy' });
  const run = honestDrag(st.car, st.greenMs, 0.3, all('good'));
  clock.add(run.ms + 20);
  const at = run.body.shiftAt;
  for (const shiftAt of [[at[1], at[0], at[2], at[3]], [-5, ...at.slice(1)], [...at.slice(0, 3), 1e6], [NaN, 1, 2, 3], [1, 2, 3, 4, 5], 'x']) {
    assert.throws(() => call(1, 'race/finish', { raceId: st.raceId, ...run.body, shiftAt }), /Некоректні/);
  }
  assert.throws(() => call(1, 'race/finish', { raceId: st.raceId, ...run.body, launch: -1 }), /Некоректний старт/);
  assert.equal(call(1, 'race/finish', { raceId: st.raceId, ...run.body }).corrected, 0, 'the honest report still goes through');
});

test('drag: a shift long after the limiter point counts as the limiter shift', () => {
  const stats = { base: 12, shift: 0.2 };
  const c = honestDrag(stats, 2500, 0.3, ['good', 'late', 'good', 'good']);
  // Move the second (limiter) shift 600 ms later and call it 'good'.
  const shiftAt = [c.body.shiftAt[0], c.body.shiftAt[1] + 600]; // the rest: not reported, the limiter shifts
  const rep = S.dragReplay(stats, c.reaction, shiftAt, ['good', 'good', 'good', 'good']);
  assert.equal(rep.shifts[1], 'late');
  assert.ok(rep.corrected >= 1);
});

test('drag: finishing sooner than the run takes is rejected; ~300 ms of network slack is allowed', () => {
  const { mk, call, clock } = setup();
  const car = mk(1);
  const st = call(1, 'race/start', { carId: car, rival: 'easy' });
  const run = honestDrag(st.car, st.greenMs, 0.2, all('good'));
  clock.add(run.ms - 1000);
  assert.throws(() => call(1, 'race/finish', { raceId: st.raceId, ...run.body }), /ще не закінчився/);
  clock.add(1000 - 250); // 250 ms early on the server's clock (the request was quick, the phone's clock slightly off)
  assert.equal(call(1, 'race/finish', { raceId: st.raceId, ...run.body }).time, run.time);
});

test('drag: an old client (reaction/shifts only) gets no perfect start and no perfect shifts', () => {
  const { mk, call, clock } = setup();
  const car = mk(1);
  const st = call(1, 'race/start', { carId: car, rival: 'easy' });
  assert.throws(() => call(1, 'race/finish', { raceId: st.raceId, reaction: 0.12, shifts: all('perfect') }), /ще не закінчився/);
  clock.add(20e3);
  const r = call(1, 'race/finish', { raceId: st.raceId, reaction: 0.12, shifts: all('perfect') });
  assert.equal(r.perfectStart, false);
  assert.deepEqual(r.shifts, all('good'));
  assert.ok(r.reaction > S.START.perfectWindow);
});

test('drag: at most 10 race starts a minute', () => {
  const { mk, call, clock, g } = setup();
  const cars = [mk(1), g.giveCar(1, 'vaz-2107').id, g.giveCar(1, 'vaz-2107').id];
  for (let i = 0; i < 10; i++) call(1, 'race/start', { carId: cars[Math.floor(i / 4)], rival: 'train' });
  assert.throws(() => call(1, 'race/start', { carId: cars[2], rival: 'train' }), /Забагато заїздів/);
  clock.add(61e3);
  assert.ok(call(1, 'race/start', { carId: cars[2], rival: 'train' }).raceId);
});

// ---------- live PvP ----------
function livePair() {
  const ctx = setup();
  const { mk, call } = ctx;
  const c1 = mk(1), c2 = mk(2);
  const { id } = call(1, 'pvp/create', { carId: c1, bet: 100000 });
  call(1, 'pulse');
  call(2, 'pvp/request', { id, carId: c2 });
  const live = call(1, 'pvp/answer', { id, yes: true });
  return { ...ctx, id, live, greenMs: live.greenAt - live.startAt };
}
test('live PvP: honest runs keep their result; a forged perfect race and an early finish are not accepted', () => {
  const { call, clock, id, live, greenMs } = livePair();
  const cheat = honestDrag(live.me.car, greenMs, 0.6, all('early'));
  const fair = honestDrag(live.rival.car, greenMs, 0.25, all('good'));
  // Before the run could be over on the shared clock: rejected.
  clock.add(live.startAt + greenMs + 500 - clock.now());
  assert.throws(() => call(1, 'pvp/finish', { id, ...cheat.body }), /ще не закінчився/);
  clock.add(live.startAt + Math.max(cheat.ms, fair.ms) + 20 - clock.now());
  // The creator claims a 0.12 s start and four perfect shifts; the taps say otherwise.
  call(1, 'pvp/finish', { id, ...cheat.body, reaction: 0.12, shifts: all('perfect') });
  const s = call(2, 'pvp/finish', { id, ...fair.body });
  assert.equal(s.status, 'done');
  assert.deepEqual(s.rival.run.shifts, all('early'));
  assert.equal(s.rival.run.reaction, 0.6);
  assert.equal(s.rival.run.time, S.raceTime(live.me.car, 0.6, all('early')));
  assert.equal(s.me.run.time, fair.time);
  assert.equal(s.win, fair.time < s.rival.run.time);
});
test('live PvP: launching before the shared green is a false start, whatever reaction is claimed', () => {
  const { call, clock, id, live, greenMs } = livePair();
  const run = honestDrag(live.me.car, greenMs, -1, all('good'));
  clock.add(live.startAt + run.ms + 20 - clock.now());
  call(1, 'pvp/finish', { id, ...run.body, reaction: 0.13 });
  clock.add(60e3);
  const s = call(1, 'pvp/state', { id });
  assert.equal(s.me.run.jump, true);
  assert.equal(s.me.run.perfectStart, false);
});

// ---------- drift ----------
function driftSetup() {
  const ctx = setup();
  const car = ctx.mk(1);
  return { ...ctx, car, start: (rival = 'hard') => ctx.call(1, 'drift/start', { carId: car, rival }) };
}
test('drift: an honest run gets exactly the score and corner breakdown the player saw (replayed from the gas log)', () => {
  const { call, clock, start } = driftSetup();
  for (const [fps, skill] of [[30, 0.4], [60, 0.8], [120, 0.6], [144, 1]]) {
    const st = start('easy');
    assert.ok(Number.isSafeInteger(st.seed) && Number.isSafeInteger(st.track) && st.step === S.DRIFT_STEP);
    const run = clientDrift(st, { fps, skill });
    clock.add(S.DRIFT_COUNT_MS + run.ms + 50);
    const r = call(1, 'drift/finish', { runId: st.runId, ...run });
    assert.equal(r.score, run.score);
    assert.equal(r.clean, run.clean);
    assert.equal(r.spins, run.spins);
    assert.equal(r.check, 'ok');
    assert.equal(r.corners.length, S.DRIFT.corners);
    assert.equal(r.corners.reduce((a, c) => a + c.pts, 0), r.score);
    assert.equal(r.rival.seed, undefined);
    clock.add(60e3);
  }
});
test('drift: same seed → same run on the client and the server, at any frame rate and skill', () => {
  const rnd = lcg(7);
  for (let i = 0; i < 120; i++) {
    const model = S.driftModel({ hp: 50 + rnd() * 1500, kg: 900 + rnd() * 1200, grip: 0.35 + rnd() * 0.5 });
    // The model goes through JSON on its way to the client and into the run row, as in the app.
    const st = { model: JSON.parse(JSON.stringify(model)), seed: Math.floor(rnd() * 2 ** 31), track: Math.floor(rnd() * 2 ** 32) };
    const fps = [24, 30, 60, 90, 120, 144][i % 6];
    const run = clientDrift(st, { fps, skill: rnd(), rs: i + 1 });
    const rep = S.driftReplay(model, S.driftTrack(st.track), st.seed, run.log);
    assert.equal(rep.score, run.score);
    assert.equal(rep.clean, run.clean);
    assert.equal(rep.spins, run.spins);
    assert.equal(rep.ms, run.ms);
    // A second replay is identical too (no hidden state between runs).
    assert.deepEqual(S.driftReplay(model, S.driftTrack(st.track), st.seed, run.log), rep);
  }
});
test('drift: the finish must wait for the countdown and the replayed run (less 300 ms of network)', () => {
  const { call, clock, start } = driftSetup();
  const st = start('easy');
  const run = clientDrift(st);
  clock.add(S.DRIFT_COUNT_MS + run.ms - S.DRAG_TOL.wall - 100);
  assert.throws(() => call(1, 'drift/finish', { runId: st.runId, ...run }), /ще не закінчився/);
  clock.add(100);
  assert.equal(call(1, 'drift/finish', { runId: st.runId, ...run }).check, 'ok');
});
test('drift: the audit script (score 1e9, no log) never wins; it must still wait out a run', () => {
  const { call, clock, start } = driftSetup();
  let wins = 0;
  for (const rival of ['easy', 'mid', 'hard', 'easy', 'hard']) {
    const st = start(rival);
    clock.add(15000);
    assert.throws(() => call(1, 'drift/finish', { runId: st.runId, score: 1e9 }), /ще не закінчився/);
    clock.add(S.DRIFT_COUNT_MS + 6000);
    const r = call(1, 'drift/finish', { runId: st.runId, score: 1e9 });
    assert.equal(r.check, 'legacy');
    assert.ok(r.score <= st.rival.target * 0.6);
    wins += r.win;
    clock.add(60e3);
  }
  assert.equal(wins, 0);
});
test('drift: a forged score with a gas log is replaced by the replayed one; a broken log is rejected', () => {
  const { call, clock, start } = driftSetup();
  const st = start('hard');
  const run = clientDrift(st, { target: 5 }); // barely sliding: a low score
  clock.add(S.DRIFT_COUNT_MS + S.DRIFT_MS);
  const bad = [[5, 3], [-1], [1.5], [S.DRIFT_MS / S.DRIFT_STEP + 1], 'x', { 0: 1 }, Array(20001).fill(0)];
  for (const log of bad) assert.throws(() => call(1, 'drift/finish', { runId: st.runId, score: 1e9, log }), /Некоректні/);
  const r = call(1, 'drift/finish', { runId: st.runId, ...run, score: 1e9, clean: 7 });
  assert.equal(r.score, run.score);
  assert.equal(r.clean, run.clean);
  assert.equal(r.check, 'replayed');
  assert.equal(r.win, false);
});
test('drift: forged logs gain nothing — random taps score low, a great run on another seed or track is replayed as what it does here', () => {
  const rnd = lcg(99);
  const st = { model: S.driftModel({ hp: 72, kg: 1030, grip: 0.35 }), seed: 1234, track: 777 };
  const track = S.driftTrack(st.track), par = S.driftPar(st.model, track);
  for (let i = 0; i < 40; i++) {
    let t = 0;
    const log = Array.from({ length: 50 + Math.floor(rnd() * 400) }, () => (t += 1 + Math.floor(rnd() * 60)));
    assert.ok(S.driftReplay(st.model, track, st.seed, log.filter((x) => x <= S.DRIFT_MS / S.DRIFT_STEP)).score < par * 0.75, 'random taps lose to the easy rival');
  }
  // The log of a near-perfect run, sent for a run with another noise seed or another track, is just a worse run there.
  const best = clientDrift(st, { skill: 1 });
  const other = S.driftReplay(st.model, track, st.seed + 1, best.log), otherTrack = S.driftReplay(st.model, S.driftTrack(778), st.seed, best.log);
  assert.ok(other.score < best.score && otherTrack.score < best.score);
});
test('drift: no replayed run beats the car\'s cap on its track; the cap is below the global maximum', () => {
  const rnd = lcg(5);
  for (const stats of [{ hp: 80, kg: 1000, grip: 0.35 }, { hp: 400, kg: 1400, grip: 0.6 }, { hp: 1600, kg: 1500, grip: 0.95 }]) {
    const m = S.driftModel(stats);
    for (let k = 1; k <= 8; k++) {
      const st = { model: m, seed: k * 977, track: k * 31337 }, cap = S.driftCap(m, S.driftTrack(st.track));
      assert.ok(cap < S.DRIFT_MAX);
      for (const opt of [{ skill: 1 }, { skill: 0.9, fps: 144 }, { skill: rnd() }, { target: 30 }, { target: 40 }, { target: 50 }]) {
        assert.ok(clientDrift(st, opt).score <= cap);
      }
    }
  }
});
test('drift: a run started before «Дрифт 2.0» (no track in the run) is finished as a legacy run', () => {
  const { call, clock, start, db } = driftSetup();
  const st = start('easy');
  const row = db.prepare('SELECT rival FROM drift_runs WHERE id = ?').get(st.runId);
  const { track, ...old } = JSON.parse(row.rival);
  db.prepare('UPDATE drift_runs SET rival = ? WHERE id = ?').run(JSON.stringify({ ...old, model: { turn: 50, recover: 70, zone: [23, 47], ideal: [31, 39], spin: 70 } }), st.runId);
  clock.add(S.DRIFT_COUNT_MS + 30000);
  const r = call(1, 'drift/finish', { runId: st.runId, ...clientDrift(st) });
  assert.equal(r.check, 'legacy');
  assert.equal(r.win, false);
});
test('drift: a run left for minutes scores nothing; at most 4 drift starts a minute', () => {
  const { call, clock, start, g } = driftSetup();
  const st = start('easy');
  const run = clientDrift(st);
  clock.add(4 * 60e3);
  const r = call(1, 'drift/finish', { runId: st.runId, ...run });
  assert.equal(r.score, 0);
  assert.equal(r.check, 'timeout');
  const other = g.giveCar(1, 'vaz-2107').id;
  for (let i = 0; i < 4; i++) call(1, 'drift/start', { carId: i < 3 ? other : st.car.id, rival: 'easy' });
  assert.throws(() => call(1, 'drift/start', { carId: st.car.id, rival: 'easy' }), /Забагато заїздів/);
});
