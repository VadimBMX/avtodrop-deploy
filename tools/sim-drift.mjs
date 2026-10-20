// Drift difficulty check: a virtual player with human reaction time drives the same physics as the app
// (public/app.js runDrift) and we see what scores real players can reach with different cars.
//   node tools/sim-drift.mjs
import * as S from '../public/shared.js';

// skill: how close to the zone centre the player aims; react: reaction delay in ms.
function run(model, { react = 150, noise = 0.15 } = {}) {
  const C = S.DRIFT.cornerMs, ST = S.DRIFT.straightMs, dt = 1 / 60;
  let ang = 0, score = 0, combo = 1, hold = false, spinUntil = 0, corner = -1, zoneMs = 0, spun = false, clean = 0, spins = 0;
  const seed = Math.random() * 10, seen = [];
  for (let t = 0; t < S.DRIFT_MS; t += dt * 1000) {
    const i = Math.floor(t / (C + ST)), inCorner = t - i * (C + ST) < C;
    if (inCorner && i !== corner) { corner = i; zoneMs = 0; spun = false; }
    if (!inCorner && corner === i && zoneMs >= 0) {
      if (!spun && zoneMs >= C * S.DRIFT.clean) { clean++; combo = Math.min(S.DRIFT.comboMax, combo + 1); } else if (!spun) combo = 1;
      zoneMs = -1;
    }
    // The player sees the angle `react` ms late and aims for the middle of the zone, a bit off each time.
    seen.push(ang);
    const look = seen[Math.max(0, seen.length - 1 - Math.round(react / (dt * 1000)))];
    const aim = S.DRIFT.center * (1 + (Math.random() - 0.5) * noise);
    hold = look < aim;
    if (inCorner && t > spinUntil) {
      ang += (hold ? model.turn : -model.recover) * dt;
      ang += (Math.sin(t / 230 + seed) * 22 + (Math.random() - 0.5) * 30) * dt;
      ang = Math.max(0, ang);
      if (ang >= model.spin) { spins++; combo = 1; spun = true; spinUntil = t + 700; ang = 0; }
      if (ang >= model.zone[0] && ang <= model.zone[1]) {
        score += S.DRIFT.pps * combo * (ang >= model.ideal[0] && ang <= model.ideal[1] ? S.DRIFT.idealBonus : 1) * dt;
        if (zoneMs >= 0) zoneMs += dt * 1000;
      }
    } else if (!inCorner) ang = Math.max(0, ang - model.recover * 1.5 * dt);
  }
  return { score: Math.round(score), clean, spins };
}
const cars = [
  ['ВАЗ-2107 stock', { hp: 72, kg: 1030, grip: 0.35 }],
  ['ВАЗ-2107 tuned (grip .65)', { hp: 80, kg: 1000, grip: 0.65 }],
  ['Supra stock', { hp: 280, kg: 1500, grip: 0.35 }],
  ['Bugatti stock', { hp: 1850, kg: 1995, grip: 0.35 }],
  ['Bugatti tuned (grip .7)', { hp: 2200, kg: 1900, grip: 0.7 }],
];
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)];
console.log(`max ${S.DRIFT_MAX}; targets ≈ ${S.DRIFT_RIVALS.map((r) => `${r.name} ${Math.round(S.DRIFT_MAX * r.share)}`).join(', ')}`);
for (const [name, st] of cars) {
  const m = S.driftModel(st);
  for (const [who, opt] of [['good player', { react: 120, noise: 0.1 }], ['average player', { react: 200, noise: 0.25 }]]) {
    const runs = Array.from({ length: 300 }, () => run(m, opt));
    const sc = runs.map((r) => r.score);
    const beat = S.DRIFT_RIVALS.map((r) => `${r.name} ${Math.round((sc.filter((s) => s >= S.DRIFT_MAX * r.share).length / sc.length) * 100)}%`).join('  ');
    console.log(`${name.padEnd(26)} ${who.padEnd(15)} zone ${Math.round(m.zone[1] - m.zone[0])}° turn ${m.turn}  median ${pct(sc, 0.5)}  wins: ${beat}  spins ${pct(runs.map((r) => r.spins), 0.5)}`);
  }
}
