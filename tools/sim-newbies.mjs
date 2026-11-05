// Newbie personas on the REAL engine (src/game.js on an in-memory DB, fast-forwarded clock): many fresh players start from
// 0 and play N days in their own style. The same bot moves as tools/econ-sim.mjs (casual/active/whale/grinder are kept
// as they are there) plus newbie personas; every action costs play time, idle = minutes in a session with nothing to do.
//   node tools/sim-newbies.mjs [--days 7] [--bots 6] [--seed 1] [--personas casual,lazy,…] [--label x] [--out dir]
// One run = one seed; tools/sim-newbies-report.mjs merges many runs (medians, P10/P90) into a report.
// Personas (sessions [UTC hour, minutes] a day):
//   casual     2×10 — claims, collect, races, the dearest case with 60% of the money (econ-sim);
//   active     3×50 — 80%, ×6 opens, slots, businesses (econ-sim);
//   whale      active + starter pack, 150 ⭐ pack, VIP on day 1, 500 ⭐ packs on days 3 and 8 (econ-sim);
//   grinder    3×60 — opens the dearest case, upgrades every spare A+ car to ≈2× and sells the win (econ-sim);
//   casesOnly  «тільки кейси» 2×30 — no races, opens with all the money and sells every car but the best one;
//   collector  «колекціонер» 2×30 — keeps cars: buys garage places, sells only duplicates (then the cheapest);
//   racer      «гонщик» 6×12 — races every drop of fuel, buys tanks, cases with 40%;
//   bizman     «бізнесмен» 3×30 — a business as soon as it is affordable, upgrades with 60%, cases with what is left;
//   lazy       «лінивий» 2×10 — no races: claims, collect, one case at a time with 90%;
//   hardcore   «хардкор» 5×60 — active + upgrades + tanks;
//   smallDonor «донатер-малий» 2×30 — casual-plus who buys one 50 ⭐ pack on day 1.
// Every persona follows «Перші кроки» the way the app leads (installs one part when that step comes).
// After the first pass of a session (money and fuel spent) a bot checks back every CHECK minutes until the session ends:
// claims (reward case, keys), races on fuel that came back, cases. «wall» = the minute the first session's first pass ended.
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { ECON } from '../public/econ.js';
import { honestDrag } from '../test/race-helpers.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('days', 7)), PER = Number(arg('bots', 6)), SEED = Number(arg('seed', 1));
const LABEL = arg('label', 'newbies'), OUT = arg('out', 'reports');
let seed = SEED * 7919 + 13;
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const CHECK = 5; // minutes between check-backs inside a session
const COST = { open: 7, openMany: 10, sell: 3, claim: 4, collect: 2, race: 8, upgrade: 8, biz: 4, buy: 3, key: 6, part: 8 };
const ALL = {
  casual: { sessions: [[9, 10], [21, 10]], share: 0.6, many: false },
  active: { sessions: [[10, 50], [15, 50], [21, 50]], share: 0.8, many: true, biz: true },
  whale: { sessions: [[10, 50], [15, 50], [21, 50]], share: 0.85, many: true, biz: true, pays: 'whale' },
  grinder: { sessions: [[9, 60], [14, 60], [20, 60]], share: 0.95, many: true, biz: true, upgrades: true },
  casesOnly: { sessions: [[12, 30], [20, 30]], share: 1, many: true, races: false, sellAll: true },
  collector: { sessions: [[10, 30], [20, 30]], share: 0.7, many: false, collector: true },
  racer: { sessions: [[7, 12], [10, 12], [13, 12], [16, 12], [19, 12], [21, 12]], share: 0.4, many: false, tanks: true },
  bizman: { sessions: [[9, 30], [13, 30], [20, 30]], share: 0.5, many: true, biz: true, bizRush: true },
  lazy: { sessions: [[8, 10], [20, 10]], share: 0.9, many: false, races: false },
  hardcore: { sessions: [[8, 60], [11, 60], [14, 60], [17, 60], [20, 60]], share: 0.85, many: true, biz: true, upgrades: true, tanks: true },
  smallDonor: { sessions: [[9, 30], [21, 30]], share: 0.7, many: false, pays: 'small' },
};
const ARCH = Object.fromEntries((arg('personas', Object.keys(ALL).join(','))).split(',').map((k) => [k, ALL[k]]));
const START = Date.parse('2026-11-09T00:00:00Z');
const db = openDb(':memory:');
let t = START;
const g = createGame(db, { now: () => t, notify: () => {} });
const bots = [];
let nid = 900000 + SEED * 1000;
for (const [kind, a] of Object.entries(ARCH)) for (let i = 0; i < PER; i++) {
  const id = nid++;
  g.ensureUser({ id, first_name: kind + i });
  bots.push({
    id, kind, a, mins: 0, play: 0, idle: 0, sess: 0, left: 0, paidStars: 0,
    samples: [], marks: {}, days: [], flow: {}, flowDay: {}, firstCls: {}, biz: [], spends: [], inflows: [],
    capLost: 0, capPot: 0, capSessions: 0, xpOver: 0, empty: 0, emptyRun: 0, emptyMax: 0, broke: 0, brokeRun: 0, brokeMax: 0,
    sessions: 0, newbieDone: null, lastMe: null, acted: false,
  });
}
const MARKS = [5, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800];
const minCase = Math.min(...S.CASES.filter((c) => !c.starter).map((c) => c.price));
const call = (b, name, body) => g.api[name](b.id, body);
const tryCall = (b, name, body) => { try { return call(b, name, body); } catch { return null; } };
const gameMin = (b) => b.play + (b.sess - b.left);
const value = (c) => c.value ?? S.MODELS[c.model].price;
const worthOf = (me) => me.balance + me.stats.value;
const clsRank = (cls) => ['D', 'C', 'B', 'A', 'S', 'X'].indexOf(cls);
const bestCls = (me) => me.cars.reduce((m, c) => { const k = S.MODELS[c.model]?.cls; return clsRank(k) > clsRank(m) ? k : m; }, null);
function state(b, me = call(b, 'me')) {
  return { min: Math.round(gameMin(b)), day: +((t - START) / 86400e3).toFixed(3), balance: me.balance, worth: worthOf(me), level: me.level,
    cases: me.stats.cases, races: me.stats.races, cars: me.cars.length, best: bestCls(me), newbie: me.newbie ? me.newbie.step : 'done', biz: b.biz.length };
}
function observe(b, me) {
  b.lastMe = me;
  const m = gameMin(b);
  const best = bestCls(me);
  for (const c of ['D', 'C', 'B', 'A', 'S']) if (clsRank(best) >= clsRank(c) && !b.firstCls[c]) b.firstCls[c] = { min: Math.round(m), day: +((t - START) / 86400e3).toFixed(2) };
  if (!me.newbie && b.newbieDone == null) b.newbieDone = { min: Math.round(m), day: +((t - START) / 86400e3).toFixed(2) };
  const last = b.samples[b.samples.length - 1];
  if (!last || m - last[0] >= 1) b.samples.push([+m.toFixed(1), me.balance, worthOf(me), clsRank(best)]);
  for (const k of MARKS) if (b.marks[k] == null && m >= k) b.marks[k] = state(b, me);
}
const spendTime = (b, sec) => { t += sec * 1000; b.mins += sec / 60; b.left -= sec / 60; };
function addFlow(b, cat, v) {
  if (!v) return;
  b.flow[cat] = (b.flow[cat] || 0) + v;
  b.flowDay[cat] = (b.flowDay[cat] || 0) + v;
}
// Every call through here books its money by category; level-up money and «Перші кроки» money are split out of it.
const userQ = db.prepare('SELECT balance, level, newbie_step, total_value FROM users WHERE id = ?');
const nbStep = (u) => Math.min(u.newbie_step, S.NEWBIE_TASKS.length);
function booked(b, cat, fn) {
  const before = userQ.get(b.id);
  const r = fn();
  const after = userQ.get(b.id);
  let d = after.balance - before.balance;
  let lv = 0;
  for (let L = before.level + 1; L <= after.level; L++) lv += S.levelReward(L).money;
  let nb = 0;
  for (let s = nbStep(before); s < nbStep(after); s++) nb += S.NEWBIE_TASKS[s].money;
  if (lv) { addFlow(b, 'level rewards', lv); d -= lv; b.inflows.push([gameMin(b), lv, after.balance, 'level']); }
  if (nb) { addFlow(b, 'Перші кроки', nb); d -= nb; b.inflows.push([gameMin(b), nb, after.balance, 'newbie']); }
  addFlow(b, cat, d);
  if (d < 0) b.acted = true;
  // The full /me (cars, class, «Перші кроки») once a minute in the game and at every mark; the cheap row in between.
  const m = gameMin(b), last = b.samples[b.samples.length - 1];
  if (!last || m - last[0] >= 1 || MARKS.some((k) => b.marks[k] == null && m >= k)) observe(b, call(b, 'me'));
  return r;
}

function claims(b) {
  booked(b, 'rewards', () => tryCall(b, 'rewards/all'));
  spendTime(b, COST.claim);
  for (let guard = 0; guard < 20; guard++) {
    const me = call(b, 'me');
    const k = Object.entries(me.keys || {}).find(([id, n]) => n > 0 && S.CASE_BY_ID[id]);
    if (!k) break;
    if (!makeRoom(b, 1)) break;
    booked(b, 'keys (free opens)', () => tryCall(b, 'case/open', { caseId: k[0], count: 1, keyOnly: true }));
    spendTime(b, COST.key);
  }
}
// «Перші кроки» asks to install a part: buy the cheapest part case once and put the best part on the best car.
function newbieParts(b) {
  let me = call(b, 'me');
  if (me.newbie?.key !== 'install' || me.newbie.lockedTill || me.newbie.ready) return;
  const cars = me.cars.filter((c) => c.status === 'garage').sort((x, y) => value(x) - value(y));
  booked(b, 'parts', () => {
    for (const pc of ['scrap', 'atelier']) {
      tryCall(b, 'parts/open', { caseId: pc, count: 1 });
      t += 10500; // the part-case pause (S.PART_COOLDOWN_MS)
      me = call(b, 'me');
      for (const p of me.parts || []) for (const c of cars) if (p.available > 0 && tryCall(b, 'parts/install', { carId: c.id, type: p.type, tier: p.tier })) return;
    }
  });
  spendTime(b, COST.part);
  claims(b);
}
function race(b) {
  for (let n = 0; n < 60 && b.left > 1; n++) {
    const me = call(b, 'me');
    // A persona that does not race still follows «Перші кроки» through its race steps (the app leads there).
    if (b.a.races === false && !['race', 'win'].includes(me.newbie?.key)) return;
    if (me.fuel < 1) {
      // d2-wall: a newcomer's free refill (fuel/newbie; the app offers it on the empty-tank card). Absent in older code.
      if (me.newbieFuel > 0 && tryCall(b, 'fuel/newbie')) { spendTime(b, COST.claim); continue; }
      return;
    }
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
function makeRoom(b, free) {
  const me = call(b, 'me');
  const need = me.used + free - me.slots;
  if (need <= 0) return true;
  if (b.a.collector && me.slots < S.MAX_SLOTS && S.slotCost(me.slots) < me.balance * 0.5) {
    booked(b, 'garage slots', () => tryCall(b, 'buy-slot')); spendTime(b, COST.buy);
    return makeRoom(b, free);
  }
  let cars = me.cars.filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret && c.sell != null).sort((x, y) => value(x) - value(y));
  if (b.a.collector) { // duplicates first (a second copy of a model), then the cheapest
    const seen = new Set(), dup = [];
    for (const c of [...cars].reverse()) { if (seen.has(c.model)) dup.push(c); seen.add(c.model); }
    cars = [...dup.reverse(), ...cars.filter((c) => !dup.includes(c))];
  }
  const sell = cars.slice(0, need).map((c) => c.id);
  if (sell.length < need || me.cars.length - sell.length < 1) return false;
  booked(b, 'instant sale', () => call(b, 'sell', { carIds: sell }));
  spendTime(b, COST.sell);
  return true;
}
function sellAllButBest(b) {
  const me = call(b, 'me');
  const cars = me.cars.filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret && c.sell != null).sort((x, y) => value(y) - value(x));
  const ids = cars.slice(1).map((c) => c.id);
  if (!ids.length) return;
  booked(b, 'instant sale', () => tryCall(b, 'sell', { carIds: ids }));
  spendTime(b, COST.sell);
}
function bizBuy(b, me) {
  if (!b.a.biz || !g.api.biz) return false;
  const list = call(b, 'biz').list;
  const nb = list.find((x) => !x.owned && x.unlocked && x.price <= me.balance * (b.a.bizRush ? 1 : 0.6));
  if (nb) {
    const r = booked(b, 'businesses (buy)', () => tryCall(b, 'biz/buy', { id: nb.id }));
    spendTime(b, COST.biz);
    if (r) b.biz.push({ id: nb.id, min: Math.round(gameMin(b)), day: +((t - START) / 86400e3).toFixed(2), level: me.level });
    return !!r;
  }
  const up = list.filter((x) => x.owned).flatMap((x) => Object.entries(x.next || {}).filter(([, c]) => c != null).map(([br, c]) => ({ id: x.id, br, c })))
    .concat(list.filter((x) => x.owned && x.build?.ready && x.build.cost).map((x) => ({ id: x.id, br: 'build', c: x.build.cost })))
    .sort((p, q) => p.c - q.c)[0];
  if (up && up.c <= me.balance * (b.a.bizRush ? 0.6 : 0.25)) {
    const r = booked(b, 'businesses (upgrades)', () => tryCall(b, 'biz/upgrade', { id: up.id, branch: up.br }));
    spendTime(b, COST.biz);
    return !!r;
  }
  return false;
}
function buyStuff(b) {
  for (let guard = 0; guard < 16; guard++) {
    const me = call(b, 'me');
    if (b.a.bizRush && bizBuy(b, me)) continue;
    if (!b.a.sellAll && me.slots < S.MAX_SLOTS && S.slotCost(me.slots) < me.balance * 0.15) { if (booked(b, 'garage slots', () => tryCall(b, 'buy-slot'))) { spendTime(b, COST.buy); continue; } }
    if (b.a.tanks) {
      const nx = ECON.fuel.tanks[me.tankLvl || 0];
      if (nx && me.level >= nx.level && nx.cost <= me.balance * 0.5) { if (booked(b, 'fuel tanks', () => tryCall(b, 'tank/upgrade'))) { spendTime(b, COST.buy); continue; } }
    }
    if (!b.a.bizRush && bizBuy(b, me)) continue;
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
    if (b.a.sellAll) sellAllButBest(b);
    if (b.a.upgrades) upgrades(b);
  }
}
function upgrades(b) {
  const me = call(b, 'me');
  const cars = me.cars.filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret && !S.MODELS[c.model].homeOnly && !S.MODELS[c.model].edition).sort((x, y) => value(y) - value(x));
  for (const c of cars.slice(3)) {
    const m = S.MODELS[c.model];
    if (S.rankOf(m.cls) < S.rankOf('A')) continue;
    const target = S.ALL_MODELS.filter((x) => !x.secret && !x.edition && !x.homeOnly && x.price >= m.price * 2).sort((x, y) => x.price - y.price)[0];
    if (!target) continue;
    booked(b, 'upgrade (win sold)', () => {
      const u = tryCall(b, 'upgrade', { carIds: [c.id], target: target.id });
      if (u?.win && u.car) tryCall(b, 'sell', { carIds: [u.car.id] });
      return u;
    });
    spendTime(b, COST.upgrade);
  }
}
function pay(b, day) {
  if (!b.a.pays) return;
  const buy = (packId, stars) => { booked(b, 'Stars packs', () => g.creditPayment({ chargeId: `sim-${b.id}-${packId}-${day}-${t}`, userId: b.id, packId, stars })); b.paidStars += stars; };
  const item = (itemId, stars) => { booked(b, 'Stars items', () => g.creditItem({ chargeId: `sim-${b.id}-${itemId}-${day}-${t}`, userId: b.id, itemId, stars })); b.paidStars += stars; };
  if (b.a.pays === 'small') { if (day === 0 && !b.paidD0) { b.paidD0 = true; buy('p1', 50); } return; }
  if (day === 0 && !b.paidD0) { b.paidD0 = true; item('starter', 39); buy('p2', 150); item('vip', 300); }
  if ((day === 2 || day === 7) && !b['paid' + day]) { b['paid' + day] = true; buy('p3', 500); }
}
// Garage cash box: what the hours since the last collect would have paid without the cap vs what is there.
// Measured at the very start of a session, before anything banks the income.
function capMeasure(b) {
  const me = call(b, 'me');
  const inc = me.income || {};
  const hours = Math.max(0, (t - (inc.since || t)) / 3600e3);
  const pot = (inc.rate || 0) * hours + (inc.banked || 0);
  const got = (inc.pending || 0);
  if (pot > 0) { b.capPot += pot; b.capLost += Math.max(0, pot - got); }
}
function collect(b) {
  booked(b, 'garage income', () => tryCall(b, 'collect'));
  if (g.api['biz/collect']) booked(b, 'businesses (income)', () => tryCall(b, 'biz/collect', { all: true }));
  spendTime(b, COST.collect);
}
const t0 = Date.now();
for (let day = 0; day < DAYS; day++) {
  for (const b of bots) b.flowDay = {};
  for (let h = 0; h < 24; h++) {
    for (const b of bots) {
      const s = b.a.sessions.find(([sh]) => sh === h);
      if (!s) continue;
      // Every bot has its own clock: a session starts on its own schedule (the old shared clock drifted by the sum of
      // every bot's play — 7 days became 9.4). Players don't share state here, so the clock may step back between bots.
      t = START + (day * 24 + h) * 3600e3 + (b.id % 7) * 60e3;
      b.sess = s[1]; b.left = s[1]; b.acted = false;
      capMeasure(b);
      if (call(b, 'me').keys?.starter) { booked(b, 'starter', () => tryCall(b, 'case/open', { caseId: 'starter', count: 1 })); spendTime(b, COST.open); }
      pay(b, day);
      claims(b);
      collect(b);
      claims(b);
      race(b);
      claims(b);
      newbieParts(b);
      race(b);
      claims(b);
      const startBal = call(b, 'me').balance;
      buyStuff(b);
      cases(b);
      buyStuff(b);
      // The first pass is over: everything the money and the tank allowed. In the first session that is «the wall».
      if (b.sessions === 0) b.wall = Math.round(gameMin(b));
      // d2-wall: a player who stays checks back every CHECK minutes — fuel that came back, the reward case, keys — and
      // races / opens again. Waiting time is idle.
      while (b.left > CHECK) {
        t += CHECK * 60e3; b.mins += CHECK; b.left -= CHECK; b.idle += CHECK;
        const before = userQ.get(b.id).balance;
        claims(b);
        race(b);
        claims(b);
        cases(b);
        if (userQ.get(b.id).balance !== before) b.lastAct = Math.round(gameMin(b));
      }
      const me = call(b, 'me');
      // An «empty» session: nothing bought or opened (only claims / races). «Broke»: even before spending, the money
      // could not pay the cheapest case at the persona's share.
      const empty = !b.acted, broke = startBal * b.a.share < minCase;
      b.sessions++;
      if (empty) { b.empty++; b.emptyRun++; b.emptyMax = Math.max(b.emptyMax, b.emptyRun); } else b.emptyRun = 0;
      if (broke) { b.broke++; b.brokeRun++; b.brokeMax = Math.max(b.brokeMax, b.brokeRun); } else b.brokeRun = 0;
      if (me.levelCap?.capped || me.levelCap?.over > 0) { b.capSessions++; b.xpOver = Math.max(b.xpOver, me.levelCap.over || 0); }
      b.idle += Math.max(0, b.left);
      b.left = 0;
      observe(b, me);
      if (b.sessions === 1) b.s1 = { level: me.level, worth: worthOf(me), balance: me.balance, xp: me.xp, idle: +(b.idle / s[1]).toFixed(3) };
      b.play += s[1]; b.sess = 0;
      observe(b, me);
      t += 60e3;
    }
  }
  for (const b of bots) b.days.push({ ...state(b), flow: b.flowDay, idle: +(b.idle / Math.max(1, b.play)).toFixed(3) });
}
// Money explosions: the garage worth ×10 within 60 minutes in the game (from at least 200 тис).
function explosions(b) {
  const ev = [], s = b.samples;
  for (let i = 0; i < s.length; i++) {
    if (s[i][2] < 2e5) continue;
    let j = i + 1;
    for (; j < s.length && s[j][0] - s[i][0] <= 60; j++) if (s[j][2] >= 10 * s[i][2]) break;
    if (j < s.length && s[j][0] - s[i][0] <= 60) { ev.push({ min: s[i][0], from: s[i][2], to: s[j][2], cls: s[j][3] > s[i][3] ? 'new class' : 'same' }); i = j; }
  }
  return ev;
}
// How long the money of a reward stays: in-game minutes until the balance is back under (balance after it − reward).
function spendLag(b) {
  return b.inflows.map(([m, amt, bal, kind]) => {
    const k = b.samples.find((x) => x[0] >= m && x[1] <= bal - amt * 0.9);
    return { kind, amt, lag: k ? +(k[0] - m).toFixed(1) : null };
  });
}
const out = {
  label: LABEL, seed: SEED, days: DAYS, perArch: PER, runMs: Date.now() - t0,
  bots: bots.map((b) => ({
    id: b.id, kind: b.kind, wall: b.wall, s1: b.s1, marks: b.marks, days: b.days, flow: b.flow, firstCls: b.firstCls, biz: b.biz, newbieDone: b.newbieDone,
    idle: +(b.idle / Math.max(1, b.play)).toFixed(3), play: b.play, acted: Math.round(b.mins), paidStars: b.paidStars,
    capLostShare: b.capPot ? +(b.capLost / b.capPot).toFixed(3) : 0, capSessions: b.capSessions, xpOver: b.xpOver, sessions: b.sessions,
    empty: b.empty, emptyMax: b.emptyMax, broke: b.broke, brokeMax: b.brokeMax, explosions: explosions(b), spend: spendLag(b),
    hourly: b.samples.filter((x, i, a) => i === 0 || Math.floor(x[0] / 30) !== Math.floor(a[i - 1][0] / 30)).map((x) => [x[0], x[1], x[2]]),
  })),
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `newbies-${LABEL}-s${SEED}.json`), JSON.stringify(out));
console.log(`${LABEL} seed ${SEED}: ${Object.keys(ARCH).length} personas × ${PER} bots × ${DAYS} days, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
