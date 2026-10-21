// «Дрифт 2.0» balance check: virtual drivers of different skill (S.driftBot — reaction lag, aim error, dead band,
// braking for corners) drive the same shared physics as the app and the server, on many daily tracks and cars.
// Prints each skill's win rate against the three rivals (targets = par × share × daily jitter, as in src/game.js)
// and the score/par quantiles used to tune S.DRIFT_RIVALS.
//   node tools/sim-drift.mjs [runsPerTrack=40] [tracks=12]
import * as S from '../public/shared.js';

const RUNS = Number(process.argv[2]) || 40, TRACKS = Number(process.argv[3]) || 12;
const cars = [
  ['ВАЗ-2107 stock', { hp: 72, kg: 1030, grip: 0.35 }],
  ['ВАЗ-2107 tuned grip .65', { hp: 80, kg: 1000, grip: 0.65 }, { hp: 72, kg: 1030, grip: 0.35 }],
  ['Golf GTI stock', { hp: 220, kg: 1400, grip: 0.35 }],
  ['Supra stock', { hp: 340, kg: 1500, grip: 0.35 }],
  ['Ferrari stock', { hp: 720, kg: 1400, grip: 0.35 }],
  ['Bugatti stock', { hp: 1500, kg: 1995, grip: 0.35 }],
  ['Bugatti tuned grip .7', { hp: 1800, kg: 1900, grip: 0.7 }, { hp: 1500, kg: 1995, grip: 0.35 }],
];
const skills = [0.2, 0.35, 0.5, 0.65, 0.8, 1];
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);
let rnd = 12345;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const t0 = Date.now();
const all = Object.fromEntries(skills.map((k) => [k, { wins: [0, 0, 0], n: 0, ratio: [] }]));
console.log(`shares ${S.DRIFT_RIVALS.map((r) => `${r.id} ${r.share}`).join(', ')}; ${RUNS} runs × ${TRACKS} tracks per car and skill`);
for (const [name, st, stock = st] of cars) {
  const m = S.driftModel(st), m0 = S.driftModel(stock);
  const row = Object.fromEntries(skills.map((k) => [k, { wins: [0, 0, 0], n: 0, ratio: [], spins: 0, wides: 0, clean: 0, ms: 0 }]));
  for (let tr = 0; tr < TRACKS; tr++) {
    const track = S.driftTrack(1000 + tr * 7777);
    const par = S.driftPar(m0, track);
    const targets = S.DRIFT_RIVALS.map((r) => Math.round((par * r.share * (0.96 + 0.08 * rand())) / 10) * 10);
    for (const k of skills) {
      const R = row[k];
      for (let i = 0; i < RUNS; i++) {
        const r = S.driftBot(m, track, Math.floor(rand() * 2 ** 31), { skill: k, rs: Math.floor(rand() * 1e9), fps: rand() < 0.3 ? 30 : 60 });
        R.n++;
        R.ratio.push(r.score / par);
        targets.forEach((t, j) => (R.wins[j] += r.score >= t ? 1 : 0));
        R.spins += r.spins;
        R.wides += r.wides;
        R.clean += r.clean;
        R.ms += r.ms;
        if (r.score > S.driftCap(m, track)) throw new Error('cap broken');
      }
    }
  }
  console.log(`\n${name}  turn ${m.turn} rec ${m.recover} zone ±${m.half} vmax ${m.vmax} acc ${m.acc} lat ${m.lat}`);
  for (const k of skills) {
    const R = row[k];
    if (stock !== st) continue; // tuned cars are shown below, the totals are for stock cars
    all[k].n += R.n;
    R.wins.forEach((w, j) => (all[k].wins[j] += w));
    all[k].ratio.push(...R.ratio);
  }
  for (const k of skills) {
    const R = row[k];
    console.log(`  skill ${k.toFixed(2)}  win easy ${pct(R.wins[0] / R.n)} mid ${pct(R.wins[1] / R.n)} hard ${pct(R.wins[2] / R.n)}  score/par p10 ${q(R.ratio, 0.1).toFixed(2)} p50 ${q(R.ratio, 0.5).toFixed(2)} p90 ${q(R.ratio, 0.9).toFixed(2)}  clean ${(R.clean / R.n).toFixed(1)}/${S.DRIFT.corners} spins ${(R.spins / R.n).toFixed(2)} wide ${(R.wides / R.n).toFixed(2)} ${(R.ms / R.n / 1000).toFixed(1)} s`);
  }
}
console.log('\nALL STOCK CARS');
for (const k of skills) {
  const A = all[k];
  console.log(`  skill ${k.toFixed(2)}  win easy ${pct(A.wins[0] / A.n)} mid ${pct(A.wins[1] / A.n)} hard ${pct(A.wins[2] / A.n)}  score/par p10 ${q(A.ratio, 0.1).toFixed(3)} p45 ${q(A.ratio, 0.45).toFixed(3)} p80 ${q(A.ratio, 0.8).toFixed(3)}`);
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
