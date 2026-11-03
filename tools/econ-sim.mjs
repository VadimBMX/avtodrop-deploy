// Season 2 economy simulator: player archetypes play the REAL engine (src/game.js on an in-memory DB, fast-forwarded
// clock) for N days. Every action costs play time (seconds below), so the curves are per minute of ACTIVE play — the
// unit of the owner's goal («за 2–3 години гри — купа мільйонів») — as well as per day.
//   node tools/econ-sim.mjs [--days 14] [--bots 6] [--label s2] [--out dir] [--seed 1]
// Archetypes (minutes of play a day, sessions):
//   casual  — 20 min/day in 2 sessions: claims, collects, races, opens the dearest case it can with 60% of its money;
//   active  — 150 min/day in 3 sessions: the same at 80%, buys slots, income storage, businesses, opens ×6;
//   whale   — the active player who also pays: starter pack + 150 ⭐ pack + VIP on day 1, 500 ⭐ packs on days 3 and 8;
//   grinder — 180 min/day «trader»: opens the dearest case, pushes every spare car through the upgrade (target ≈ 2×
//             the stake) and sells what it doesn't keep — the S1 top players' loop (open → upgrade → sell).
// Output: <out>/econ-sim-<label>.json (timeline per bot, medians per archetype, milestones, money flow by source).
// Works on any checkout with the same API (the before/after runs use the same script).
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from '../test/race-helpers.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('days', 14)), PER = Number(arg('bots', 6)), LABEL = arg('label', 'run'), OUT = arg('out', 'reports');
let seed = Number(arg('seed', 1));
// Deterministic Math.random (the engine's own provably fair rolls use crypto seeds; this fixes the bots' choices).
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const COST = { open: 7, openMany: 10, sell: 3, claim: 4, collect: 2, race: 8, upgrade: 8, biz: 4, buy: 3, key: 6 }; // s; a race adds its run
const ARCH = {
  casual: { sessions: [[9, 10], [21, 10]], share: 0.6, many: false },
  active: { sessions: [[10, 50], [15, 50], [21, 50]], share: 0.8, many: true, biz: true },
  whale: { sessions: [[10, 50], [15, 50], [21, 50]], share: 0.85, many: true, biz: true, pays: true },
  grinder: { sessions: [[9, 60], [14, 60], [20, 60]], share: 0.95, many: true, biz: true, upgrades: true },
};
const START = Date.parse('2026-11-09T00:00:00Z'); // a Monday, after the Season 2 start
const db = openDb(':memory:');
let t = START;
const g = createGame(db, { now: () => t, notify: () => {} });
const bots = [];
let nid = 900000;
for (const [kind, a] of Object.entries(ARCH)) for (let i = 0; i < PER; i++) {
  const id = nid++;
  g.ensureUser({ id, first_name: kind + i });
  bots.push({ id, kind, a, mins: 0, play: 0, idle: 0, line: [], ms: {}, paidStars: 0 });
}
const flow = {};
const call = (b, name, body) => g.api[name](b.id, body);
const tryCall = (b, name, body) => { try { return call(b, name, body); } catch { return null; } };
const spendTime = (b, sec) => { t += sec * 1000; b.mins += sec / 60; b.left -= sec / 60; };
function booked(b, cat, fn) {
  const before = call(b, 'me').balance;
  const r = fn();
  flow[cat] = (flow[cat] || 0) + call(b, 'me').balance - before;
  return r;
}
const worthOf = (me) => me.balance + me.stats.value;
const value = (c) => c.value ?? S.MODELS[c.model].price;

function claims(b) {
  booked(b, 'rewards', () => tryCall(b, 'rewards/all'));
  spendTime(b, COST.claim);
  // Keys from rewards (daily, level, pass, fragments): open them all (never pays — keyOnly).
  for (let guard = 0; guard < 20; guard++) {
    const me = call(b, 'me');
    const k = Object.entries(me.keys || {}).find(([id, n]) => n > 0 && S.CASE_BY_ID[id]);
    if (!k) break;
    if (!makeRoom(b, 1)) break;
    booked(b, 'keys (free opens)', () => tryCall(b, 'case/open', { caseId: k[0], count: 1, keyOnly: true }));
    spendTime(b, COST.key);
  }
}
function race(b) {
  for (let n = 0; n < 40 && b.left > 1; n++) {
    const me = call(b, 'me');
    if (me.fuel < 1) return;
    const car = me.cars.filter((c) => c.status === 'garage').sort((x, y) => value(y) - value(x))[0];
    if (!car) return;
    const rv = tryCall(b, 'race/rivals', { carId: car.id });
    if (!rv) return;
    const r = rv.list.map((x) => ({ ...x, ev: (x.chance / 100) * x.prize - (1 - x.chance / 100) * x.entry })).sort((x, y) => y.ev - x.ev)[0];
    if (!r || r.ev <= 0 || r.entry > me.balance) return;
    booked(b, 'races', () => {
      const st = call(b, 'race/start', { carId: car.id, rival: r.id });
      const reaction = 0.18 + Math.random() * 0.2;
      const shifts = Array.from({ length: S.SHIFTS }, () => (Math.random() < 0.35 ? 'perfect' : Math.random() < 0.85 ? 'good' : 'late'));
      const run = honestDrag(st.car, st.greenMs, reaction, shifts);
      t += Math.ceil(run.ms) + 50;
      b.mins += run.ms / 60000; b.left -= run.ms / 60000;
      call(b, 'race/finish', { raceId: st.raceId, ...run.body });
    });
    spendTime(b, COST.race);
  }
}
// Sell the weakest cars (never secret, never the last one) until `free` places are open.
function makeRoom(b, free) {
  const me = call(b, 'me');
  const need = me.used + free - me.slots;
  if (need <= 0) return true;
  const cars = me.cars.filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret && c.sell != null).sort((x, y) => value(x) - value(y));
  const sell = cars.slice(0, need).map((c) => c.id);
  if (sell.length < need || me.cars.length - sell.length < 1) return false;
  booked(b, 'instant sale', () => call(b, 'sell', { carIds: sell }));
  spendTime(b, COST.sell);
  return true;
}
function buyStuff(b) {
  for (let guard = 0; guard < 12; guard++) {
    const me = call(b, 'me');
    if (me.slots < S.MAX_SLOTS && S.slotCost(me.slots) < me.balance * 0.15) { booked(b, 'garage slots', () => tryCall(b, 'buy-slot')); spendTime(b, COST.buy); continue; }
    const capNext = S.CAP_LEVELS[me.capLevel + 1];
    if (capNext && capNext.cost < me.balance * 0.1) { booked(b, 'income storage', () => tryCall(b, 'upgrade-cap')); spendTime(b, COST.buy); continue; }
    if (b.a.biz && g.api.biz) {
      const list = call(b, 'biz').list;
      const nb = list.find((x) => !x.owned && x.unlocked && x.price <= me.balance * 0.6);
      if (nb) { booked(b, 'businesses (buy)', () => tryCall(b, 'biz/buy', { id: nb.id })); spendTime(b, COST.biz); continue; }
      const up = list.filter((x) => x.owned).flatMap((x) => Object.entries(x.next || {}).filter(([, c]) => c != null).map(([br, c]) => ({ id: x.id, br, c })))
        .concat(list.filter((x) => x.owned && x.build?.ready && x.build.cost).map((x) => ({ id: x.id, br: 'build', c: x.build.cost })))
        .sort((p, q) => p.c - q.c)[0];
      if (up && up.c <= me.balance * 0.25) { booked(b, 'businesses (upgrades)', () => tryCall(b, 'biz/upgrade', { id: up.id, branch: up.br })); spendTime(b, COST.biz); continue; }
    }
    return;
  }
}
function cases(b) {
  for (let guard = 0; guard < 400 && b.left > 0.2; guard++) {
    const me = call(b, 'me');
    const budget = me.balance * b.a.share;
    const cs = S.CASES.filter((c) => !c.starter && c.price <= budget).sort((x, y) => y.price - x.price)[0];
    if (!cs) return;
    const n = (b.a.many ? [6, 3, 1] : [3, 1]).find((k) => cs.price * k <= budget);
    if (!makeRoom(b, n)) return;
    const r = booked(b, 'cases', () => tryCall(b, 'case/open', { caseId: cs.id, count: n }));
    if (!r) return;
    spendTime(b, n > 1 ? COST.openMany : COST.open);
    if (b.a.upgrades) upgrades(b);
  }
}
// The grinder: every spare gold (A) car or better (not among the 3 most valuable) goes into the upgrade for a target ≈ 2× its
// value and a won car is sold at once — the S1 top players' loop (an Еліта gold sold for 22 %, the red it became for 45 %).
function upgrades(b) {
  const me = call(b, 'me');
  const cars = me.cars.filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret && !S.MODELS[c.model].homeOnly && !S.MODELS[c.model].edition).sort((x, y) => value(y) - value(x));
  for (const c of cars.slice(3)) {
    const m = S.MODELS[c.model];
    if (S.rankOf(m.cls) < S.rankOf('A')) continue;
    const target = S.ALL_MODELS.filter((x) => !x.secret && !x.edition && !x.homeOnly && x.price >= m.price * 2).sort((x, y) => x.price - y.price)[0];
    if (!target) continue;
    const r = booked(b, 'upgrade (win sold)', () => {
      const u = tryCall(b, 'upgrade', { carIds: [c.id], target: target.id });
      if (u?.win && u.car) tryCall(b, 'sell', { carIds: [u.car.id] });
      return u;
    });
    spendTime(b, COST.upgrade);
    if (!r) continue;
  }
}
function pay(b, day) {
  if (!b.a.pays) return;
  const buy = (packId, stars) => { booked(b, 'Stars packs', () => g.creditPayment({ chargeId: `sim-${b.id}-${packId}-${day}-${t}`, userId: b.id, packId, stars })); b.paidStars += stars; };
  const item = (itemId, stars) => { booked(b, 'Stars items', () => g.creditItem({ chargeId: `sim-${b.id}-${itemId}-${day}-${t}`, userId: b.id, itemId, stars })); b.paidStars += stars; };
  if (day === 0 && !b.paidD0) { b.paidD0 = true; item('starter', 39); buy('p2', 150); item('vip', 300); }
  if ((day === 2 || day === 7) && !b['paid' + day]) { b['paid' + day] = true; buy('p3', 500); }
}
function snapshot(b, day, h) {
  const me = call(b, 'me');
  const w = worthOf(me);
  const sellable = me.balance + me.cars.reduce((s, c) => s + (c.sell || 0), 0);
  b.line.push({ day: +(day + h / 24).toFixed(3), mins: Math.round(b.play), acted: Math.round(b.mins), idle: +(b.idle / Math.max(1, b.play)).toFixed(3), balance: me.balance, worth: w, sellable, level: me.level, incomeH: Math.round(me.income?.rate || 0), cars: me.cars.length, slots: me.slots });
  for (const [k, x] of [['1M', 1e6], ['10M', 1e7], ['100M', 1e8], ['1B', 1e9]]) {
    if (b.ms['bal' + k] == null && me.balance >= x) b.ms['bal' + k] = Math.round(b.play);
    if (b.ms['worth' + k] == null && w >= x) b.ms['worth' + k] = Math.round(b.play);
  }
}
const t0 = Date.now();
for (let day = 0; day < DAYS; day++) {
  for (let h = 0; h < 24; h++) {
    for (const b of bots) {
      const s = b.a.sessions.find(([sh]) => sh === h);
      if (!s) continue;
      t = Math.max(t, START + (day * 24 + h) * 3600e3 + (b.id % 7) * 60e3);
      b.left = s[1];
      if (call(b, 'me').keys?.starter) { tryCall(b, 'case/open', { caseId: 'starter', count: 1 }); spendTime(b, COST.open); }
      pay(b, day);
      claims(b);
      booked(b, 'garage income', () => tryCall(b, 'collect'));
      if (g.api['biz/collect']) booked(b, 'businesses (income)', () => tryCall(b, 'biz/collect', { all: true }));
      spendTime(b, COST.collect);
      race(b);
      claims(b);
      buyStuff(b);
      cases(b);
      buyStuff(b);
      // Session time: the player is in the game for the whole session; minutes with nothing to do (no money for a case,
      // no fuel) are idle — the «drain / dead end» signal. Milestones count session minutes (b.play).
      b.play += s[1];
      b.idle += Math.max(0, b.left);
      snapshot(b, day, h);
      t += 60e3;
    }
  }
}
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length >= Math.ceil(a.length / 2) ? s[Math.floor((a.length - 1) / 2)] : null; };
const summary = {};
for (const kind of Object.keys(ARCH)) {
  const bs = bots.filter((b) => b.kind === kind);
  const ms = {};
  for (const k of ['bal1M', 'bal10M', 'bal100M', 'bal1B', 'worth1M', 'worth10M', 'worth100M', 'worth1B']) ms[k] = med(bs.map((b) => b.ms[k]));
  const n = bs[0].line.length;
  const perSession = Array.from({ length: n }, (_, i) => ({
    day: bs[0].line[i].day, mins: med(bs.map((b) => b.line[i].mins)), balance: med(bs.map((b) => b.line[i].balance)), worth: med(bs.map((b) => b.line[i].worth)),
    sellable: med(bs.map((b) => b.line[i].sellable)), level: med(bs.map((b) => b.line[i].level)), incomeH: med(bs.map((b) => b.line[i].incomeH)),
    idle: med(bs.map((b) => b.line[i].idle)), acted: med(bs.map((b) => b.line[i].acted)),
  }));
  summary[kind] = { milestones: ms, curve: perSession, stars: med(bs.map((b) => b.paidStars)) };
}
const out = { label: LABEL, days: DAYS, perArch: PER, generated: new Date().toISOString(), runMs: Date.now() - t0, summary, flow, bots: bots.map((b) => ({ id: b.id, kind: b.kind, ms: b.ms, line: b.line })) };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `econ-sim-${LABEL}.json`), JSON.stringify(out));
const f = (n) => (n == null ? '—' : S.short(n).replace(' ₴', ''));
const fm = (m) => (m == null ? '—' : m < 120 ? m + ' хв' : (m / 60).toFixed(1) + ' год');
console.log(`${LABEL}: ${DAYS} days × ${PER} bots per archetype, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('archetype | cash 1M | 10M | 100M | 1B | worth 1M | 10M | 100M | 1B   (median minutes in the game)');
for (const [k, v] of Object.entries(summary)) console.log([k.padEnd(8), ...['bal1M', 'bal10M', 'bal100M', 'bal1B', 'worth1M', 'worth10M', 'worth100M', 'worth1B'].map((x) => fm(v.milestones[x]))].join(' | '));
for (const [k, v] of Object.entries(summary)) {
  const pick = v.curve.filter((r, i) => [0, 1, 2, 5, 8, 11, 17, 20, 29, 41].includes(i) || i === v.curve.length - 1);
  console.log(`\n${k}: day | in game | cash | worth | cash+sale | level | income/h | idle share`);
  for (const r of pick) console.log(`  ${r.day.toFixed(2).padStart(6)} | ${fm(r.mins).padStart(8)} | ${f(r.balance).padStart(8)} | ${f(r.worth).padStart(8)} | ${f(r.sellable).padStart(8)} | ${String(r.level).padStart(3)} | ${f(r.incomeH).padStart(8)} | ${Math.round(r.idle * 100)}%`);
}
console.log('\nmoney flow, all bots:');
for (const [k, v] of Object.entries(flow).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${S.short(v).padStart(14)}`);
