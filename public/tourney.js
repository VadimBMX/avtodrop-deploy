// «Турнір вихідних»: a weekly drag tournament (owner's week plan, wave 2 S-tourney). The rules shared by the server
// (src/tourney.js: brackets, rounds, deadlines, prizes) and the app (public/tourney-ui.js: the tile, the screen).
//
// Week (Kyiv time): registration Fri 18:00 → Sat 12:00 (free, one car, the car's class is the bracket); at 12:00 the
// brackets of 16 (or 32 above 16 players) are drawn, empty seats go to bots; then one round per slot below, each with a
// deadline; the final is on Sunday at 20:00. Every match is asynchronous: each side gets TOURNEY.tries drag runs in the
// round's window, the best time counts, and each run is raced against the GHOST of the other side's best run so far
// (a bot's time is fixed when the match opens). A side without a time at the deadline loses (both without: the higher
// seed goes on). Tournament runs burn no fuel: the round window is the limit, not the tank.
import { MODELS, CLASSES, raceEv, kyivMidnightOf, kyivMondayOf } from './shared.js';

export const TOURNEY = {
  minLevel: 2, // the level a player needs to register
  tries: 2, // drag runs per side per match (counted at the start; an abandoned run is used up)
  sizes: [16, 32], // a bracket of 16 up to 16 players, else 32; more than 32 players of a class → several brackets
  regOpen: [0, 18], // [days after Friday, Kyiv hour]
  regClose: [1, 12],
  // Round windows counted from the final (0 = the final): [days after Friday, from hour, to hour (the deadline)].
  stages: [[2, 20, 23], [2, 16, 19], [1, 18, 21], [1, 15, 18], [1, 12, 15]],
  runMs: 3 * 60e3, // a run left hanging longer than this counts as nothing
  // Money: × raceEv of the class's typical car (S.raceEv, «a race's worth») by place; `play` for everyone who raced.
  money: { 1: 12, 2: 6, 3: 3, 5: 1.5, play: 0.5 },
  // Keys by class: [finalist's key, champion's extra key]; the champion takes both.
  keys: { D: ['rust', 'city'], C: ['city', 'tuning'], B: ['sport', 'premium'], A: ['premium', 'elite'], S: ['elite', 'elite'] },
  frame: 'cos:e:tr-champ', // the champions' plate frame (S.EVENT_COSMETICS), never sold
  botSkill: [0.3, 0.7], // bot drivers from «Новачок» (the weakest seed) to «Профі» (the strongest)
  // A bot's car: its base time this much above the entrants' median base (the strongest seed's car is about as quick as
  // theirs, the weakest one's 6% slower) — so a good driver goes through the early rounds and meets a real rival late.
  botSlow: [-0.005, 0.06],
  hall: 30, // champions shown in the hall
};

export const BADGE = { 1: ['Чемпіон Турніру вихідних', 3], 2: ['Фіналіст Турніру вихідних', 2], 3: ['Півфіналіст Турніру вихідних', 1] };

const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' });
const dayNum = (day) => Math.round(Date.parse(day + 'T00:00:00Z') / 86400e3);
export const addDays = (day, n) => new Date((dayNum(day) + n) * 86400e3).toISOString().slice(0, 10);
export const isTid = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v && new Date(v + 'T00:00:00Z').getUTCDay() === 5;
// hh:00 Kyiv time of a date, right across the summer-time switches.
const atCache = new Map(); // (date, hour) → time: the same every call
export function kyivAt(date, hour) {
  const key = `${date}|${hour}`;
  if (atCache.has(key)) return atCache.get(key);
  let t = kyivMidnightOf(date) + hour * 3600e3;
  const h = Number(HOUR.format(new Date(t)));
  if (h !== hour) t += ((((hour - h) % 24) + 36) % 24 - 12) * 3600e3;
  if (atCache.size > 500) atCache.clear();
  atCache.set(key, t);
  return t;
}
// The tournament of the Kyiv week of t: its Friday ('YYYY-MM-DD') is its id.
export const tidOf = (t) => addDays(kyivMondayOf(t), 4);
export const at = (tid, [d, h]) => kyivAt(addDays(tid, d), h);
export const regOpenOf = (tid) => at(tid, TOURNEY.regOpen);
export const regCloseOf = (tid) => at(tid, TOURNEY.regClose);
export const roundsOf = (size) => Math.round(Math.log2(size));
export const stageOf = (size, round) => roundsOf(size) - 1 - round; // 0 = the final
export function windowOf(tid, size, round) {
  const [d, h0, h1] = TOURNEY.stages[stageOf(size, round)];
  return { opens: kyivAt(addDays(tid, d), h0), deadline: kyivAt(addDays(tid, d), h1) };
}
export const endOf = (tid) => kyivAt(addDays(tid, TOURNEY.stages[0][0]), TOURNEY.stages[0][2]);
// 'soon' (before registration), 'reg', 'run' (rounds), 'done' (after the final's deadline).
export function phaseAt(tid, t) {
  if (t < regOpenOf(tid)) return 'soon';
  if (t < regCloseOf(tid)) return 'reg';
  if (t < endOf(tid)) return 'run';
  return 'done';
}
// The tournament a screen shows at t: this week's from its registration on, last week's before it.
export function shownTid(t) {
  const tid = tidOf(t);
  return t < regOpenOf(tid) ? addDays(tid, -7) : tid;
}
export const sizeFor = (n) => (n <= TOURNEY.sizes[0] ? TOURNEY.sizes[0] : TOURNEY.sizes[1]);
// The class a car races in: secret cars (X) race the hypercars.
export const bracketCls = (cls) => (cls === 'X' ? 'S' : cls);
// Standard seeding: seed 1 meets the last seed, and seeds 1 and 2 can meet only in the final.
export function seedOrder(n) {
  let o = [1];
  while (o.length < n) {
    const m = o.length * 2;
    o = o.flatMap((s) => [s, m + 1 - s]);
  }
  return o;
}
export function roundName(size, round) {
  const st = stageOf(size, round);
  return st === 0 ? 'Фінал' : st === 1 ? 'Півфінал' : `1/${2 ** st} фіналу`;
}
// Place of a player who lost in `round` (0-based) of a bracket of `size`: the final's loser is 2nd, the semis' 3rd…
export const placeOfLoss = (size, round) => 2 ** stageOf(size, round) + 1;
export const placeText = (p) => (p === 1 ? 'Чемпіон' : p === 2 ? 'Фінал' : p === 3 ? 'Півфінал' : p === 5 ? '1/4 фіналу' : p === 9 ? '1/8 фіналу' : '1/16 фіналу');
// The typical value of a class (geometric middle of its price range): what the money prizes scale with.
export const classValue = (cls) => Math.sqrt(CLASSES[cls].lo * CLASSES[cls].hi);
export function prizeFor(cls, place, played = true) {
  const k = TOURNEY.money[place] ?? (played ? TOURNEY.money.play : 0);
  const money = k ? Math.max(1000, Math.round((k * raceEv(classValue(cls))) / 1000) * 1000) : 0;
  const [k0, k1] = TOURNEY.keys[cls] || TOURNEY.keys.D;
  const keys = place === 1 ? [k1, k0] : place === 2 ? [k0] : [];
  return { money, keys, badge: BADGE[place] ? place : 0, frame: place === 1 };
}
export const fmtTime = (t) => Number(t).toFixed(3).replace('.', ',');
export const carName = (id) => MODELS[id]?.name || id;
