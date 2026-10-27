// «Причал» — container auction (design: reports/containers.md). Rules and pure functions shared by the server
// (src/containers.js), the app and the tests. A lot is one closed container with one car nobody knows — not the
// players, not the bots. Everyone sees the same honest hints (each is a true fact about the car) and the same exact
// «Можливий вміст» list with its percentages; the bots value the lot from that list only (posterior expected SALE ×
// their personal k, never below 1.02), so «win and sell» returns ≈ 0.8 of the price paid on average: a soft sink.
import * as S from './shared.js';

export const CONTAINER_TIERS = [
  { id: 'odesa', name: 'Порт Одеса', short: 'Одеса', level: 3, w: { D: 80, C: 17, B: 3 }, junk: 0.1, ed: 0.03, countries: null, color: '#3b82f6' },
  { id: 'customs', name: 'Митниця', short: 'Митниця', level: 6, w: { C: 70, B: 27, A: 3 }, junk: 0.08, ed: 0.04, countries: null, color: '#a855f7' },
  { id: 'japan', name: 'Контейнер з Японії', short: 'Японія', level: 10, w: { B: 78, A: 19, S: 3 }, junk: 0.06, ed: 0.05, countries: ['JP'], color: '#ef4444' },
];
export const TIER_BY = Object.fromEntries(CONTAINER_TIERS.map((t) => [t.id, t]));
// Event lots (public/halloween.js): on the pier only while their event runs. Their own pool (`bodies`: muscle cars,
// coupés and sedans), their own edition (`edModel` with the share `edP` of the non-flooded lots; the ordinary editions
// stay out) and the same honesty, bots and ≈ 0.8 return as the three tiers above (test/halloween.test.js).
export const EVENT_TIERS = [
  { id: 'ghost', event: 'halloween', skin: 'ghost', name: 'Контейнер з привидом', short: 'Привид', level: 5, w: { C: 55, B: 40, A: 5 }, junk: 0.08, ed: 0,
    edModel: 'ford-mustang-gt-2005--hw13', edP: 0.05, bodies: ['muscle', 'coupe', 'sedan'], countries: null, color: '#ff7a1a' },
];
for (const t of EVENT_TIERS) TIER_BY[t.id] = t;
// «Вечірній аукціон» (Контейнери 2.0): one dear lot a day for everyone at once. It comes up EVENING.warnMin before
// EVENING.hour (Kyiv) in status 'soon' — hints, the list and the expert are there, bids are not — and goes live at
// 20:00 sharp for EVENING.liveMs (+ the usual extensions, 5 min at most), people and bots together. No flooded cars,
// dearer classes and a bigger share of editions; the same honesty, bots and ≈ 0.8 return as every other lot.
export const EVENING_TIER = { id: 'evening', special: 'evening', skin: 'evening', name: 'Вечірній аукціон', short: 'Вечір', level: 6, w: { B: 35, A: 52, S: 13 }, junk: 0, ed: 0.5, countries: null, color: '#ff6b8b' };
TIER_BY[EVENING_TIER.id] = EVENING_TIER;
export const EVENING = { hour: 20, warnMin: 30, liveMs: 180e3, lateMs: 15 * 60e3 };
// hour:00 Kyiv time on a calendar date ('YYYY-MM-DD'), right across the summer-time switch.
const KYIV_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', hourCycle: 'h23', hour: 'numeric' });
export function kyivAt(date, hour) {
  const t = S.kyivMidnightOf(date) + hour * 3600e3;
  return t + (hour - (Number(KYIV_HOUR.format(new Date(t))) % 24)) * 3600e3;
}
// Today's evening start (Kyiv) and the next one whose lot can still come up (a server that was down at 20:00 puts
// it up until EVENING.lateMs after the start, live at once).
export const eveningStart = (t) => kyivAt(S.kyivDateOf(t), EVENING.hour);
export function nextEvening(t) {
  const s = eveningStart(t);
  return t < s + EVENING.lateMs ? s : kyivAt(S.kyivDateOf(S.kyivMidnightOf(S.kyivDateOf(t), 1)), EVENING.hour);
}

// The resellers. k: how far over the expected sale they go (mean ± sd, clamped to RULES.k); delay: seconds to answer;
// step: their raise over the current bid. Liza answers only in the last seconds (late) and pays a little more when an
// edition is possible; Жора plays only the cheap port and passes on a flooded car.
export const CONTAINER_BOTS = [
  { id: 'petrovych', name: 'Дилер Петрович', short: 'Петрович', k: 1.15, sd: 0.07, delay: [5, 9], step: [0.05, 0.06], line: 'Петрович: не моя ціна, пас' },
  { id: 'vasya', name: 'Вася Перекуп', short: 'Вася', k: 1.2, sd: 0.14, delay: [1, 3], step: [0.05, 0.09], line: 'Вася: дорого, пас' },
  { id: 'liza', name: 'Колекціонерка Ліза', short: 'Ліза', k: 1.13, sd: 0.08, edBonus: 0.25, late: true, delay: [1, 2], step: [0.05, 0.07], line: 'Ліза: я пас, сонечко' },
  { id: 'zhora', name: 'Жора Брухт', short: 'Жора', k: 1.09, sd: 0.05, tiers: ['odesa'], noJunk: true, delay: [2, 5], step: [0.05, 0.05], line: 'Жора: брухт не беру, пас' },
];
// A bot in the database is a negative bidder id: −(index + 1).
export const botCode = (id) => -(CONTAINER_BOTS.findIndex((b) => b.id === id) + 1);
export const botOf = (code) => (code < 0 ? CONTAINER_BOTS[-code - 1] || null : null);

export const CONTAINER_RULES = {
  liveMs: 90e3, // the first human bid starts 90 s of live bidding
  extendMs: 15e3, // a bid in the last 15 s puts the end 15 s after it
  maxLiveMs: 5 * 60e3, // …but live bidding never lasts longer than 5 min
  waitMs: 30 * 60e3, // a lot nobody bid on is taken by the leading bot after 30 min
  step: 0.05, minStep: 1000, // next bid ≥ +5% and ≥ +1 000 ₴
  maxShare: 0.5, // one bid ≤ 50% of (balance + own bid on this lot): no all-in
  maxLeading: 2, // lead in at most 2 lots at once
  winsPerDay: 15, // at most 15 won lots in 24 h
  bidGapMs: 1000, // one bid a second
  k: [1.02, 1.6], // a bot never stops below 1.02 × the expected sale
  start: [0.45, 0.6], // the bots' warm-up bid before any human: 45–60% of the expected sale
  showCls: 0.4, showDec: 0.35, // how often the class colour and the decade are shown
  kgBand: 600, tare: 2200, // weight hint: the car's kg in a 600 kg band, plus the container's 2.2 t
  junkCount: 5, // the flooded car is one of the 5 cheapest of the class below the tier
};
const R = CONTAINER_RULES;

export const BODY_NAMES = { sedan: 'седан', hatch: 'хетчбек', coupe: 'купе', super: 'суперкар', suv: 'позашляховик', muscle: 'мускул-кар', wagon: 'універсал' };
export const decadeOf = (year) => Math.floor(year / 10) * 10;
export const decadeText = (d) => `${String(d).slice(2)}-ті`;
export const kgBandOf = (kg) => Math.floor(kg / R.kgBand) * R.kgBand;
export const weightText = (band) => `${((band + R.tare) / 1000).toFixed(1).replace('.', ',')}–${((band + R.kgBand + R.tare) / 1000).toFixed(1).replace('.', ',')} т`;

// Small seeded RNG (mulberry32) and a string → seed hash, so a lot's whole life follows from its seed.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

// What the car sells for to the dealer (an edition: S.EDITION_SELL of its price) and its collection price.
export const saleOfModel = (model) => S.sellPriceOf(model);
const baseOf = (model) => S.MODELS[S.MODELS[model].base || model];

// Every possible content of a tier with its probability: class by the tier's weights → model ∝ 1/√price (like the
// cases) → its edition with the tier's `ed` chance (when the model has one); a `junk` share is a flooded car instead.
const outCache = {};
export function tierOutcomes(tierId) {
  if (outCache[tierId]) return outCache[tierId];
  const t = TIER_BY[tierId];
  const ok = (m) => !m.secret && !m.homeOnly && (!t.countries || t.countries.includes(m.country)) && (!t.bodies || t.bodies.includes(m.body));
  const tw = Object.values(t.w).reduce((a, b) => a + b, 0);
  const out = [];
  const edP = t.edModel && S.MODELS[t.edModel] ? t.edP : 0;
  for (const cls of S.CLASS_ORDER.filter((c) => t.w[c])) {
    const list = S.ALL_MODELS.filter((m) => m.cls === cls && ok(m));
    const ws = S.modelWeights(list), sw = ws.reduce((a, b) => a + b, 0);
    list.forEach((m, i) => {
      const p = (1 - t.junk) * (1 - edP) * (t.w[cls] / tw) * (ws[i] / sw);
      const ed = t.event ? null : S.EDITION_OF[m.id];
      out.push({ model: m.id, ed: false, junk: false, p: ed ? p * (1 - t.ed) : p });
      if (ed) out.push({ model: ed, ed: true, junk: false, p: p * t.ed });
    });
  }
  if (edP) out.push({ model: t.edModel, ed: true, junk: false, p: (1 - t.junk) * edP });
  const floorCls = S.CLASS_ORDER[Math.max(0, S.rankOf(S.CLASS_ORDER.find((c) => t.w[c])) - 1)];
  const junk = S.ALL_MODELS.filter((m) => m.cls === floorCls && ok(m)).sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1)).slice(0, R.junkCount);
  if (t.junk) junk.forEach((m) => out.push({ model: m.id, ed: false, junk: true, p: t.junk / junk.length }));
  return (outCache[tierId] = out);
}
// The hints of a content: true facts about its car. Class and decade are shown only sometimes (r decides).
// A lot must keep a mystery (owner 23.10: no «1 варіант» lots). The car is drawn at the tier's odds; which facts are
// shown is rolled (class, decade, weight, body each with its own chance) and re-rolled until the hints leave at least
// MIN_OPTIONS cars (a flooded car keeps its first roll — its short list is the point). A car whose every roll is too
// narrow shows only its country. posterior() weighs each listed car by the exact chance it would show these hints.
export const MIN_OPTIONS = 3;
const SHOW = { kg: 0.6, body: 0.85 };
const FIELDS = [['cls', () => R.showCls], ['dec', () => R.showDec], ['kg', () => SHOW.kg], ['body', () => SHOW.body]];
function fullHints(o) {
  const m = baseOf(o.model);
  return { country: m.country, body: m.body, cls: m.cls, dec: decadeOf(m.year), kg: kgBandOf(m.kg), junk: o.junk };
}
const masked = (o, show) => { const h = fullHints(o); FIELDS.forEach(([k], i) => { if (!show[i]) h[k] = null; }); return h; };
const countMatch = (tierId, h) => tierOutcomes(tierId).reduce((n, x) => n + (matches(x, h) ? 1 : 0), 0);
const accOk = (tierId, o, h) => o.junk || countMatch(tierId, h) >= MIN_OPTIONS;
// Chance one roll of hints for this car is accepted (0: the car falls back to country-only hints).
const accCache = {};
function accOf(tierId, o) {
  const key = `${tierId}:${o.model}:${o.junk ? 1 : 0}`;
  if (key in accCache) return accCache[key];
  let a = 0;
  for (let mask = 0; mask < 16; mask++) {
    const show = FIELDS.map((_, i) => !!(mask & (1 << i)));
    const p = FIELDS.reduce((q, [, f], i) => q * (show[i] ? f() : 1 - f()), 1);
    if (accOk(tierId, o, masked(o, show))) a += p;
  }
  return (accCache[key] = a);
}
export function hintsOf(o, r, tierId = null) {
  for (let tries = 0; tries < 200; tries++) {
    const show = FIELDS.map(([, f]) => r() < f());
    const h = masked(o, show);
    if (!tierId || accOk(tierId, o, h)) return h;
    if (accOf(tierId, o) === 0) break;
  }
  return masked(o, [false, false, false, false]);
}
// P(this car shows exactly hints h).
function likelihood(tierId, o, h) {
  const a = accOf(tierId, o);
  if (a === 0) return ['cls', 'dec', 'kg', 'body'].every((k) => h[k] == null) ? 1 : 0;
  return FIELDS.reduce((q, [k, f]) => q * (h[k] != null ? f() : 1 - f()), 1) / a;
}
export function matches(o, h) {
  const m = baseOf(o.model);
  return o.junk === !!h.junk && m.country === h.country && (h.body == null || m.body === h.body) && (h.cls == null || m.cls === h.cls) && (h.dec == null || decadeOf(m.year) === h.dec) && (h.kg == null || kgBandOf(m.kg) === h.kg);
}
// «Можливий вміст»: everything that fits the hints with its real chance, the expected sale (what the bots value) and
// the 10–90th percentile of the collection price (the «оцінка» on the card).
export function posterior(tierId, h) {
  const all = tierOutcomes(tierId).filter((o) => matches(o, h)).map((o) => ({ o, w: o.p * likelihood(tierId, o, h) })).filter((x) => x.w > 0);
  const P = all.reduce((s, x) => s + x.w, 0) || 1;
  return statsOf(all.map(({ o, w }) => ({ model: o.model, ed: o.ed, junk: o.junk, p: w / P, sale: saleOfModel(o.model), value: S.MODELS[o.model].price })));
}
function statsOf(list) {
  const rows = list.sort((a, b) => b.p - a.p || b.value - a.value);
  const ev = rows.reduce((s, x) => s + x.p * x.sale, 0);
  const edP = rows.filter((x) => x.ed).reduce((s, x) => s + x.p, 0);
  const byVal = [...rows].sort((a, b) => a.value - b.value);
  const pctl = (q) => {
    let acc = 0;
    for (const x of byVal) if ((acc += x.p) >= q - 1e-9) return x.value;
    return byVal.at(-1)?.value || 0;
  };
  return { rows, ev, edP, lo: pctl(0.1), hi: pctl(0.9) };
}
// «Огляд експерта» (Контейнери 2.0): a paid hint for one player. The expert opens one more TRUE fact about the car —
// its class, decade or weight band, whichever of them the lot keeps hidden — to the buyer only. The bots never get it
// (their limits are fixed when the lot is made). The fact doesn't depend on which hints were rolled, so the buyer's
// honest list is the public one cut to the cars with that fact, renormalised (narrow). Price: EXPERT.share of the
// lot's expected collection price, ≥ EXPERT.min; the money is destroyed (a sink). One expert per lot and player.
export const EXPERT = { share: 0.03, min: 1000, fields: ['cls', 'dec', 'kg'] };
export const EXPERT_NAMES = { cls: 'клас', dec: 'десятиліття', kg: 'вага' };
export const factOf = (model, field) => { const h = fullHints({ model, junk: false }); return h[field]; };
export const expertFields = (h) => EXPERT.fields.filter((f) => h[f] == null);
export function expertPrice(post) {
  const v = post.rows.reduce((s, x) => s + x.p * x.value, 0);
  return roundUp(Math.max(EXPERT.min, v * EXPERT.share));
}
export function narrow(post, facts) {
  const keep = post.rows.filter((x) => Object.entries(facts).every(([f, v]) => factOf(x.model, f) === v));
  const P = keep.reduce((s, x) => s + x.p, 0) || 1;
  return statsOf(keep.map((x) => ({ ...x, p: x.p / P })));
}
export const factText = (field, v) => (field === 'cls' ? `клас ${v} · ${S.CLASSES[v].name.toLowerCase()}` : field === 'dec' ? decadeText(v) : weightText(v));

// Bids are rounded to a unit that fits their size.
export const unitOf = (x) => (x < 100e3 ? 500 : x < 1e6 ? 1000 : x < 10e6 ? 10e3 : 100e3);
const roundUp = (x) => Math.ceil(x / unitOf(x)) * unitOf(x);
export const minNext = (top) => roundUp(Math.max(Math.ceil(top * (1 + R.step)), top + R.minStep));

// A new lot of a tier from its seed: the content, the hints, 2–3 bots with their limits (server only) and the warm-up.
export function spawnLot(tierId, seed) {
  const t = TIER_BY[tierId], r = rng(seed);
  const outs = tierOutcomes(tierId);
  const total = outs.reduce((s, o) => s + o.p, 0);
  let x = r() * total, o = outs[outs.length - 1];
  for (const y of outs) if ((x -= y.p) < 0) { o = y; break; }
  const hints = hintsOf(o, r, tierId);
  const post = posterior(tierId, hints);
  const pool = CONTAINER_BOTS.filter((b) => !b.tiers || b.tiers.includes(t.id));
  const n = Math.min(pool.length, 2 + (r() < 0.5 ? 1 : 0));
  const picked = pool.map((b) => [b, r()]).sort((a, b) => a[1] - b[1]).slice(0, n).map(([b]) => b);
  const bots = picked.map((b) => {
    const k = Math.min(R.k[1], Math.max(R.k[0], b.k + b.sd * gauss(r) + (b.edBonus || 0) * post.edP * 5));
    return { id: b.id, max: b.noJunk && hints.junk ? 0 : Math.floor(post.ev * k), passed: false };
  });
  const start = Math.max(1000, Math.round((post.ev * (R.start[0] + (R.start[1] - R.start[0]) * r())) / unitOf(post.ev)) * unitOf(post.ev));
  const can = bots.filter((b) => b.max >= start);
  const leader = can.length ? can[Math.floor(r() * can.length)].id : bots[0].id;
  return { tier: t.id, model: o.model, ed: o.ed, junk: o.junk, hints, bots, start, leader, ev: post.ev };
}

// The bots' answer to the lot as it stands at time t: which bots give up now (passes) and which one bids next, when and
// how much. Only one answer is pending at a time; any new bid recomputes it. state: { top, leader (bidder code),
// endsAt, liveAt, bots: [{ id, max, passed }] }. r: the lot's RNG for this step (seeded by the server).
export function botMove(state, t, r) {
  const next = minNext(state.top);
  const passes = state.bots.filter((b) => !b.passed && botCode(b.id) !== state.leader && b.max < next).map((b) => b.id);
  const can = state.bots.filter((b) => botCode(b.id) !== state.leader && b.max >= next);
  let best = null;
  for (const b of can) {
    const bot = CONTAINER_BOTS.find((x) => x.id === b.id);
    const d = (bot.delay[0] + (bot.delay[1] - bot.delay[0]) * r()) * 1000;
    let at = bot.late ? Math.max(t + d, state.endsAt - 1500 - 3000 * r()) : t + d;
    if (at >= state.endsAt - 300) at = state.endsAt - 300;
    if (at <= t) continue;
    const raise = bot.step[0] + (bot.step[1] - bot.step[0]) * r();
    let amount = Math.min(b.max, roundUp(state.top * (1 + raise)));
    if (amount < next) amount = next;
    if (!best || at < best.at) best = { bot: b.id, at: Math.round(at), amount };
  }
  return { passes, action: best };
}
// The end after a bid at `at`: a bid in the last extendMs moves it to at + extendMs, never past liveAt + maxLiveMs.
export const extendEnd = (endsAt, at, liveAt) => (endsAt - at < R.extendMs ? Math.max(endsAt, Math.min(at + R.extendMs, liveAt + R.maxLiveMs)) : endsAt);
// The biggest bid a player may place: half of the balance plus what he already has on this lot.
export const maxBidOf = (balance, ownOnLot = 0) => Math.floor((balance + ownOnLot) * R.maxShare);
// The commitment shown before bidding: sha256 of these exact fields; after the lot ends the salt is revealed.
export const commitText = (id, model, ed, junk, salt) => `${id}|${model}|${ed ? 1 : 0}|${junk ? 1 : 0}|${salt}`;
