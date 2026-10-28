// «Заїзд дня» (audit §4 feature 1, ideas 6.1): every Kyiv day one stock car for everyone, three free drag runs, the
// best time goes on the board; prizes at Kyiv midnight for the day before. The rules shared by the server
// (src/dayrace.js) and the app (the «Гонки» tile and the day's screen): the car of a day, the prizes for a place.
import { MODELS, seededRand, carStats, humanRun, raceTime, DRIVERS, RIVAL_AI, START, SHIFTS } from './shared.js';

export const DAYRACE = {
  attempts: 3, // free runs a day; no fuel, and more are never sold
  fragCase: 'city', // everyone who finished gets one fragment of this case's key
  topShare: 0.1, topKey: 'city', // the top 10% of the field: a key of this case
  podium: 3, podiumKey: 'sport', // the top 3: a key of this case and the «Заїзд дня: №N» badge
  minField: 5, // place prizes (top 10%, top 3) only when at least this many finished that day
  remindHour: 19, // Kyiv hour of the bot reminder for players who haven't raced yet (src/reminders.js limits apply)
  flagMargin: 0.03, // a time within this of the car's best possible run is flagged for the admins to look at
  ghostMin: 3, // finishers needed before the first run's ghost is the board's median (else the car's typical time)
  keepDays: 30, // an unclaimed prize stays in the rewards center this long
  // Ghosts (owner decision, crit4 §3 №8): while fewer than `below` players have a time today, the board also shows `n`
  // clearly marked ghosts — times only, to have something to beat. They are not players: no place, no prize, not in
  // the field size, the rewards, club points, channel posts or ratings. Times come from yesterday's real runs when
  // yesterday's car was of the same class (scaled to today's car, anonymous), the rest from the game's driver model.
  ghosts: { n: 5, below: 5 },
};

// ~30 iconic cars across classes and countries: D is the classic street, S the hypercars. Order doesn't matter, the
// days go through a shuffle of the list (dayCar).
export const CARS = [
  // D
  'vaz-2106', 'zaz-968m-zaporozhets', 'vaz-2101-kopiika', 'haz-24-volha', 'volkswagen-golf-ii', 'honda-civic-ek', 'audi-100-c3-syhara',
  // C
  'toyota-corolla-ae86', 'mercedes-benz-e500-w124-vovchok', 'bmw-750i-e38-bumer', 'mitsubishi-lancer-evolution-vi', 'subaru-impreza-wrx-gc8',
  'ford-mustang-gt-2005', 'vaz-2105-vfts', 'peugeot-205-gti',
  // B
  'toyota-supra-a80', 'nissan-skyline-gt-r-r34', 'mazda-rx-7-fd', 'bmw-m3-e46', 'dodge-charger-r-t-1970', 'honda-nsx-na1', 'xiaomi-su7-max',
  'tesla-model-3-performance',
  // A
  'nissan-gt-r-r35', 'porsche-911-turbo-s', 'ferrari-testarossa', 'lamborghini-countach-lp5000-qv', 'chevrolet-corvette-c8', 'mclaren-570s',
  // S
  'ferrari-f40', 'bugatti-veyron-16-4', 'koenigsegg-agera-rs', 'lexus-lfa',
].filter((id) => MODELS[id] && !MODELS[id].secret);

const dayNum = (day) => Math.round(Date.parse(day + 'T00:00:00Z') / 86400e3);
export const addDays = (day, n) => new Date((dayNum(day) + n) * 86400e3).toISOString().slice(0, 10);
export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;

// One shuffle of the list per cycle of list.length days (Fisher–Yates on a seeded generator, its first outputs dropped).
function rawCycle(c, list) {
  const rand = seededRand((Math.imul(c + 7, 2654435761) ^ 0x5bd1e995) >>> 0);
  for (let k = 0; k < 5; k++) rand();
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Every car once per cycle, in a new order each cycle; the first day of a cycle never repeats the day before it
// (positions 0 and 1 swap then — the last place of a cycle is never moved, so this needs no look further back).
export function cycleOrder(c, list = CARS) {
  const a = rawCycle(c, list);
  if (a.length > 2 && a[0] === rawCycle(c - 1, list)[a.length - 1]) [a[0], a[1]] = [a[1], a[0]];
  return a;
}
// The car of a Kyiv day ('YYYY-MM-DD') by the schedule alone — the same on every server, for every player.
export function scheduledCar(day, list = CARS) {
  const n = list.length, d = dayNum(day);
  const c = Math.floor(d / n);
  return cycleOrder(c, list)[d - c * n];
}
// With the admins' choices and the frozen days (meta, see src/dayrace.js): { day: { model, by } }.
export function dayCar(day, ov = {}) {
  const o = ov?.[day];
  return o && MODELS[o.model] && !MODELS[o.model].secret ? o.model : scheduledCar(day);
}

// What a place brings at midnight. Everyone who finished: a fragment; the top 10% (at least the winner) a key of
// topKey; the top 3 a key of podiumKey and the badge — the place prizes only from minField finishers up.
export function prizeOf(place, field) {
  const p = { fragments: 1, caseId: DAYRACE.fragCase };
  if (field >= DAYRACE.minField && place >= 1) {
    if (place <= Math.max(1, Math.floor(field * DAYRACE.topShare))) p.topKey = DAYRACE.topKey;
    if (place <= DAYRACE.podium) (p.podiumKey = DAYRACE.podiumKey), (p.badge = place);
  }
  return p;
}
export const topCount = (field) => (field >= DAYRACE.minField ? Math.max(1, Math.floor(field * DAYRACE.topShare)) : 0);
export const badgeTitle = (place) => `Заїзд дня: №${place}`;
export const badgeTier = (place) => (place === 1 ? 3 : place === 2 ? 2 : 1);

// ---------- ghosts ----------
// The driver-model ghosts of a day: one run each of the game's own drivers (shared.js DRIVERS and the solo rivals' AI)
// in the day's stock car, on a generator seeded by the day and the car — the same five for everyone all day.
export const GHOST_DRIVERS = [
  { d: 'perfect', label: 'профі' },
  { d: 'good', label: 'досвідчений' },
  { d: 'rival', label: 'вуличний' },
  { d: 'average', label: 'аматор' },
  { d: 'average', label: 'новачок' },
];
export function aiGhosts(day, model, n = DAYRACE.ghosts.n) {
  const st = carStats({ model });
  const stats = { base: st.base, shift: 0 };
  const rand = seededRand((Math.imul(dayNum(day) + 101, 2246822519) ^ model.length * 7919) >>> 0);
  for (let k = 0; k < 3; k++) rand();
  const times = GHOST_DRIVERS.map((g) => {
    const drv = g.d === 'rival' ? RIVAL_AI : DRIVERS[g.d];
    // a ghost that jumped the light is no target: one more go (same generator, still deterministic)
    let t = humanRun(stats, drv, rand);
    for (let k = 0; k < 3 && t > stats.base * START.jumpPenalty; k++) t = humanRun(stats, drv, rand);
    return t;
  }).sort((a, b) => a - b);
  // the labels follow the times (one run each is noisy: a «новачок» faster than a «вуличний» would read wrong);
  // with fewer than five, the slowest ones are dropped (yesterday's real times take the top of the list)
  return times.slice(0, n).map((t, i) => ({ ghost: true, src: 'ai', name: `Привид · ${GHOST_DRIVERS[i].label}`, time: t }));
}
// Yesterday's real times moved to today's car: time × today's base / yesterday's base, never under today's best possible run.
export function scaleGhost(time, fromModel, toModel) {
  const a = carStats({ model: fromModel }), b = carStats({ model: toModel });
  const ideal = raceTime({ base: b.base, shift: 0 }, START.minReaction, Array(SHIFTS).fill('perfect'));
  return Math.max(ideal + 0.01, Math.round(((time * b.base) / a.base) * 1000) / 1000);
}
// Up to n of a sorted list, spread from the best to the slowest.
export function spread(list, n) {
  if (list.length <= n) return list.slice();
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}
// How many ghosts a time beats (strictly faster).
export const ghostsBeaten = (ghosts, time) => (time == null ? 0 : (ghosts || []).filter((g) => time < g.time).length);

// 12.1041 → '12,104'; 99 (a run left hanging) → '—'.
export const fmtTime = (t) => (t == null || !(t < 99) ? '—' : Number(t).toFixed(3).replace('.', ','));
// '2026-10-22' → '22.10'.
export const dayLabel = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
// «38-й», «1-й» — the place as the board says it.
export const placeText = (n) => `${n}-й`;
