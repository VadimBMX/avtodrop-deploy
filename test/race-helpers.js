// Honest-client simulators for race tests: they run the same steps public/app.js runs on a phone.
import * as S from '../public/shared.js';

const r1 = (x) => Math.round(x * 10) / 10;

// A drag run as runRace() plays it: launch `reactMs` after green, taps at `taps` (ms after launch), frames at `fps`;
// the limiter shifts by itself. Returns the finish payload, what the player saw, and how long it took (ms from the
// start of the lights to the finish line).
export function clientDrag(stats, greenMs, { reactMs, taps = [], fps = 60 }) {
  const launch = r1(greenMs + reactMs);
  const reaction = S.reactionOf(launch, greenMs);
  const shifts = [], shiftAt = [];
  let seg = 0, k = 0, ms = 0;
  const shift = (q, u, at) => (shiftAt.push(at), shifts.push(q), (seg = u));
  for (let f = 1; f < 1e5; f++) {
    ms = r1((f * 1000) / fps);
    while (k < taps.length && taps[k] <= ms) {
      const at = r1(taps[k++]);
      if (shifts.length >= S.SHIFTS) continue;
      const u = S.dragU(stats, reaction, shifts, S.msToTau(at));
      if (u >= 1) continue;
      shift(S.tapQuality(S.shiftRpm(shifts.length, seg, u)), u, at);
    }
    const u = S.dragU(stats, reaction, shifts, S.msToTau(ms));
    if (u < 1 && shifts.length < S.SHIFTS && S.shiftRpm(shifts.length, seg, u) >= S.SHIFT_AUTO_RPM) shift('late', u, ms);
    if (u >= 1) break;
  }
  const claims = [...shifts, ...Array(S.SHIFTS - shifts.length).fill('late')];
  return { body: { reaction, shifts: claims, launch, shiftAt }, reaction, shifts: claims, time: S.raceTime(stats, reaction, claims), ms: launch + ms };
}

// Taps (ms after launch) aimed at the middle of the wanted quality bands ('perfect' / 'good' / 'early'); 'late'
// waits for the limiter.
export function honestDrag(stats, greenMs, reactionS, wanted, fps = 60) {
  const reaction = reactionS < 0 ? -1 : reactionS;
  // 'late' shifts come from the limiter: plan the taps of the others with the limiter shifts in between.
  const plan = [];
  const shifts = [];
  let seg = 0;
  for (let i = 0; i < wanted.length; i++) {
    const { react, drive } = S.dragDrive(stats, reaction, shifts);
    const span = Math.max(0.03, S.SHIFT_POINTS[i] - seg);
    if (wanted[i] === 'late') {
      shifts.push('late');
      seg = seg + ((S.SHIFT_AUTO_RPM - 0.3) / 0.58) * span;
      continue;
    }
    const rpm = { perfect: 0.88, good: 0.76, early: 0.5 }[wanted[i]];
    const u = seg + ((rpm - 0.3) / 0.58) * span;
    plan.push(((react + u * drive) / S.RACE_SPEED) * 1000);
    shifts.push(wanted[i]);
    seg = u;
  }
  return clientDrag(stats, greenMs, { reactMs: reactionS < 0 ? -300 : reactionS * 1000, taps: plan, fps });
}

// A drift run by a simple driver (gas below the target angle, off above it) on the shared simulation, with frames
// at `fps`. Returns the gas log and the score the player saw.
export function clientDrift(model, seed, { target = (model.ideal[0] + model.ideal[1]) / 2, fps = 60 } = {}) {
  const sim = S.driftSim(model, seed);
  for (let f = 1; !sim.done; f++) {
    sim.input(sim.ang < target);
    sim.advance((f * 1000) / fps);
  }
  return { log: sim.log, score: Math.floor(sim.score), clean: sim.clean, spins: sim.spins };
}
