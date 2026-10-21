// Drag-race economy audit: real rivals from the game API (in-memory DB), real server replay of every run.
//   node tools/sim-race.mjs [runs=2000] [rivalSets=12]
// For a set of cars in every class (stock, with a few parts of the class's minimum tier, with a full set of it) and
// three human drivers (perfect / good / average: reaction time and tap-timing noise in real milliseconds), prints for
// every rival tier: the rival car and shown hp vs its real hp, the shown chance, the real win rate, prize, entry, EV
// per race and money per hour of fuel (shared tank: 60 / FUEL_REGEN_MIN races an hour), next to the car's garage
// income per hour and the case price for its class.
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const RUNS = Number(process.argv[2] || 2000), SETS = Number(process.argv[3] || 12);

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

// The rival's run as the server draws it (S.rivalRun since race2; before that a private copy in src/game.js).
function oldRivalRun(rand, base) {
  const reaction = 0.15 + rand() * 0.2;
  const shifts = Array.from({ length: S.SHIFTS }, () => {
    const x = rand();
    return x < 0.25 ? 'perfect' : x < 0.85 ? 'good' : 'early';
  });
  return S.raceTime({ base, shift: 0 }, reaction, shifts);
}
const rivalTime = (rand, r) => (S.rivalRun ? S.rivalRun(rand, r) : oldRivalRun(rand, r.base));

// Human drivers. reaction: seconds after green (real time); jump: share of false starts; sd: tap-timing noise (ms,
// real time) around the middle of the perfect zone; bias: a habit of tapping late (ms).
const LOCAL_DRIVERS = {
  perfect: { react: [0.13, 0.015], jump: 0, sd: 15, bias: 0 },
  good: { react: [0.2, 0.035], jump: 0.02, sd: 45, bias: 10 },
  average: { react: [0.28, 0.06], jump: 0.05, sd: 90, bias: 35 },
};
// One run by driver d, scored exactly as the server scores it (S.dragReplay + S.raceTime).
function localHumanRun(stats, d, rand) {
  const reaction = rand() < d.jump ? -1 : Math.max(0.1, d.react[0] + gauss(rand) * d.react[1]);
  const shiftAt = [], claims = [], shifts = [];
  let seg = 0;
  for (let i = 0; i < S.SHIFTS; i++) {
    const { react, drive } = S.dragDrive(stats, reaction, shifts);
    const span = Math.max(0.03, S.SHIFT_POINTS[i] - seg);
    const uAim = seg + ((0.88 - 0.3) / 0.58) * span;
    const uLate = seg + ((S.SHIFT_AUTO_RPM - 0.3) / 0.58) * span;
    let ms = ((react + uAim * drive) / S.RACE_SPEED) * 1000 + d.bias + gauss(rand) * d.sd;
    const lateMs = ((react + uLate * drive) / S.RACE_SPEED) * 1000;
    let u;
    if (ms >= lateMs) ((ms = lateMs), (u = uLate));
    else u = Math.max(seg, (S.msToTau(ms) - react) / drive);
    ms = Math.max(ms, shiftAt.at(-1) ?? 0);
    const q = ms >= lateMs ? 'late' : S.tapQuality(S.shiftRpm(i, seg, u));
    shiftAt.push(Math.round(ms * 10) / 10);
    claims.push(q);
    shifts.push(q);
    seg = u;
  }
  const rep = S.dragReplay(stats, reaction, shiftAt, claims);
  if (rep.error) throw new Error(rep.error);
  return S.raceTime(stats, reaction, rep.shifts);
}

// Since race2 the same drivers live in shared.js (the server uses them for the odds); the copies above are for
// auditing older builds.
const DRIVERS = S.DRIVERS || LOCAL_DRIVERS, humanRun = S.humanRun || localHumanRun;
const db = openDb(':memory:');
let t = Date.parse('2026-10-21T09:00:00Z');
const R = lcg(7);
const g = createGame(db, { now: () => t, notify: () => {}, random: R });
g.ensureUser({ id: 1, first_name: 'sim' });
db.prepare('UPDATE users SET balance = 1e15, slots = 40, level = 99, level_seen = 99 WHERE id = 1').run();

const minTier = (cls) => S.TIERS[S.minTierFor(cls)].id;
function makeCar(model, kit) {
  const id = g.giveCar(1, model).id;
  const keys = S.partKeysOf(model);
  const use = kit === 'stock' ? [] : kit === 'some' ? keys.filter((k) => ['eng', 'motor', 'turbo', 'battery', 'gearbox', 'reducer', 'wheels'].includes(k)).slice(0, 3) : keys;
  for (const k of use) {
    g.addPart(1, k, minTier(S.MODELS[model].cls), 1);
    g.api['parts/install'](1, { carId: id, type: k, tier: minTier(S.MODELS[model].cls) });
  }
  return id;
}
const perHour = 60 / S.FUEL_REGEN_MIN;
const CLASS_CASE = { D: 'rust', C: 'city', B: 'sport', A: 'premium', S: 'elite' };

function pick(cls) {
  const l = S.ALL_MODELS.filter((m) => m.cls === cls && !m.secret).sort((a, b) => a.price - b.price);
  return [l[0], l[l.length >> 1], l[l.length - 1]];
}
const fmt = (x) => (Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.abs(x) >= 1e4 ? Math.round(x / 1e3) + 'k' : String(Math.round(x)));
const out = [];
const extra = (process.env.CARS || '').split(',').filter(Boolean);
for (const cls of ['D', 'C', 'B', 'A', 'S']) {
  const models = [...pick(cls), ...extra.map((id) => S.MODELS[id]).filter((m) => m?.cls === cls)];
  for (const m of models) {
    for (const kit of ['stock', 'some', 'full']) {
      const carId = makeCar(m.id, kit);
      const me = g.api.me(1).cars.find((c) => c.id === carId);
      const stats = { base: me.base, shift: me.shift };
      const tiers = {};
      for (let s = 0; s < SETS; s++) {
        db.prepare('DELETE FROM rivals').run();
        const { list } = g.api['race/rivals'](1, { carId });
        for (const r of list) {
          const T = (tiers[r.id] ??= { label: r.label, shown: [], realHp: [], hp: [], model: {}, chance: [], prize: r.prize, entry: r.entry, wins: {}, faster: 0, n: 0 });
          T.shown.push(r.hp);
          T.realHp.push(S.carStats({ model: r.model }).hp);
          T.model[S.MODELS[r.model].name] = 1;
          T.chance.push(r.chance);
          T.n++;
          if (r.base < S.carStats({ model: m.id }).base) T.faster++;
          const rand = lcg(1000 + s * 7 + r.id.length);
          for (const [dn, d] of Object.entries(DRIVERS)) {
            let w = 0;
            for (let i = 0; i < RUNS / SETS; i++) if (humanRun(stats, d, rand) < rivalTime(rand, r)) w++;
            T.wins[dn] = (T.wins[dn] || 0) + w / (RUNS / SETS);
          }
        }
      }
      const cs = S.CASE_BY_ID[CLASS_CASE[cls]];
      const row = { cls, model: m.name, price: m.price, kit, hp: me.hp, et: me.et, income: me.income, case: cs.price, tiers: {} };
      console.log(`\n${cls} ${m.name} ${fmt(m.price)} [${kit}] ${me.hp} hp, base ${me.base}s · garage ${fmt(me.income)}/h · ${cs.name} ${fmt(cs.price)}`);
      for (const [id, T] of Object.entries(tiers)) {
        const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        const p = Object.fromEntries(Object.entries(T.wins).map(([k, v]) => [k, v / SETS]));
        const ev = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v * T.prize - (1 - v) * T.entry]));
        row.tiers[id] = { shownHp: avg(T.shown), realHp: avg(T.realHp), faster: T.faster / T.n, chance: avg(T.chance), p, prize: T.prize, entry: T.entry, ev };
        console.log(`  ${T.label.padEnd(10)} shown ${Math.round(avg(T.shown))} hp (real ${Math.round(avg(T.realHp))}) faster-than-stock ${Math.round((T.faster / T.n) * 100)}% · label ${Math.round(avg(T.chance))}% · real P/G/A ${Object.values(p).map((x) => Math.round(x * 100)).join('/')}% · +${fmt(T.prize)} / −${fmt(T.entry)} · EV P/G/A ${Object.values(ev).map(fmt).join(' / ')} · /h(good) ${fmt(ev.good * perHour)}  e.g. ${Object.keys(T.model).slice(0, 2).join(', ')}`);
      }
      out.push(row);
      t += 3600e3;
    }
  }
}
if (process.env.JSON) (await import('node:fs')).writeFileSync(process.env.JSON, JSON.stringify(out, null, 1));
