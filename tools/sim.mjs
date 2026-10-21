// Economy simulation: ~300 bots with 4 behaviour profiles play the real game API (in-memory DB, faked clock) for N days.
//   node tools/sim.mjs [players=300] [days=14] [seed=1] [label=base]
// Profiles:
//   casual    — 2 sessions/day (misses ~20% of days): claims rewards, collects income, 2 races, opens ≤2 cases it can
//               easily afford (price ≤ ⅓ balance), keeps cars, sells the cheapest when the garage is full.
//   grinder   — 6 sessions/day: opens case after case (dearest with price ≤ ¼ balance, else the cheapest it can pay)
//               until broke, sells every drop instantly (keeps only its single best car), races.
//   collector — 4 sessions/day: keeps cars, buys garage slots, races until fuel is out, opens the affordable case
//               (price ≤ ½ balance) with the most missing models, sells duplicates.
//   whale     — 5 sessions/day: opens the dearest case it can afford until broke, keeps cars, buys slots.
// Writes a JSON with all metrics to reports/sim-<label>.json (next to the scratchpad reports dir) and prints tables.
import { openDb } from '../src/db.js';
import { createGame, dayOf } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from '../test/race-helpers.js';
import fs from 'node:fs';
import path from 'node:path';

const N = Number(process.argv[2] || 300), DAYS = Number(process.argv[3] || 14), SEED = Number(process.argv[4] || 1);
const LABEL = process.argv[5] || 'base';
const OUT = process.env.SIM_OUT || path.resolve(import.meta.dirname, '../../reports');

// Seeded RNG for bot decisions and the game's non-case randomness (cases use per-user crypto seeds).
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const R = lcg(SEED * 7919), GR = lcg(SEED * 104729);
const db = openDb(':memory:');
const T0 = S.SEASON.start + 3600e3; // 20.10 00:00 Kyiv + 1h, inside season 1
let t = T0;
const g = createGame(db, { now: () => t, notify: () => {}, random: GR });
const q = db.q;

const PROFILES = {
  casual: { share: 0.3, hours: [9, 21], skip: 0.2 },
  grinder: { share: 0.3, hours: [8, 11, 14, 17, 20, 23], skip: 0.05 },
  collector: { share: 0.25, hours: [8, 13, 18, 22], skip: 0.05 },
  whale: { share: 0.15, hours: [9, 13, 17, 21, 23], skip: 0.05 },
};
const PNAMES = Object.keys(PROFILES);
const CAR_CASES = S.CASES.filter((c) => !c.starter);
const CHEAPEST = Math.min(...CAR_CASES.map((c) => c.price));

const players = [];
{
  let i = 0;
  for (const pn of PNAMES) {
    const n = pn === PNAMES[PNAMES.length - 1] ? N - players.length : Math.round(N * PROFILES[pn].share);
    for (let k = 0; k < n; k++, i++) {
      const id = 1000 + i;
      g.ensureUser({ id, first_name: 'bot' + i });
      players.push({ id, prof: pn, bal: S.START_BALANCE, firstA: null, firstS: null, opens: [], skipDay: -1 });
    }
  }
}

// ---------- bookkeeping ----------
const flows = {}; // flows[prof][cat] = money total (all days)
const flowsDay = []; // flowsDay[d][cat] = money total across all players
const carFlows = {}; // garage value that arrived from rewards (cars, keys) by category
const caseStats = {}; // per case: paid opens, keys opens, value, sell value, below price
let day = 0;
function book(p, cat, v) {
  if (!v) return;
  ((flows[p.prof] ||= {})[cat] = (flows[p.prof][cat] || 0) + v);
  ((flowsDay[day] ||= {})[cat] = (flowsDay[day][cat] || 0) + v);
}
function bookCar(p, cat, v) {
  if (!v) return;
  ((carFlows[p.prof] ||= {})[cat] = (carFlows[p.prof][cat] || 0) + v);
}
const st = (id) => q('SELECT balance, level, total_value FROM users WHERE id = ?').get(id);
// Runs one API call; the balance change goes to `cat`, level-up money (paid inside xp()) to 'level'.
function act(p, cat, name, body = {}, carCat = null) {
  const a = st(p.id);
  let r;
  try {
    r = g.api[name](p.id, body);
  } catch (e) {
    if (!(e?.constructor?.name === 'GameError')) throw e;
    return null;
  }
  const b = st(p.id);
  let lvl = 0;
  for (let l = a.level + 1; l <= b.level; l++) lvl += S.levelReward(l).money;
  book(p, cat, b.balance - a.balance - lvl);
  book(p, 'level', lvl);
  if (carCat) bookCar(p, carCat, b.total_value - a.total_value);
  p.bal = b.balance;
  return r;
}
const cars = (id) => q("SELECT id, model, status FROM cars WHERE owner_id = ? ORDER BY id").all(id);
const keysOf = (id) => Object.fromEntries(q('SELECT case_id, count FROM keys WHERE user_id = ? AND count > 0').all(id).map((r) => [r.case_id, r.count]));
const slotsOf = (id) => q('SELECT slots FROM users WHERE id = ?').get(id).slots;
const collectionOf = (id) => new Set(q('SELECT model FROM collection WHERE user_id = ?').all(id).map((r) => r.model));
const price = (m) => S.MODELS[m].price;

// ---------- actions ----------
const CLAIM_CAT = { daily: 'daily', rcase: 'rewardCase', newbie: 'newbie', quest: 'quests', coll: 'milestones', rescue: 'rescue', ach: 'achievements', achAll: 'achievements', pass: 'seasonPass' };
function claimAll(p) {
  const pl = act(p, 'other', 'pulse');
  if (!pl) return;
  for (const c of pl.claims) {
    const cat = CLAIM_CAT[c.kind];
    if (!cat) continue;
    if (c.kind === 'daily') act(p, cat, 'rewards/daily', {}, cat);
    else if (c.kind === 'rcase') act(p, cat, 'rewards/case', {}, cat);
    else if (c.kind === 'newbie') act(p, cat, 'newbie/claim');
    else if (c.kind === 'quest') act(p, cat, 'quests/claim', { key: c.id });
    else if (c.kind === 'coll') act(p, cat, 'collection/claim', { key: c.id }, cat);
    else if (c.kind === 'rescue') act(p, cat, 'rescue/claim');
    else if (c.kind === 'pass') act(p, cat, 'season/claim', {}, cat);
    else act(p, cat, 'ach/claim', c.kind === 'ach' ? { key: c.id } : {});
  }
}
function sellCars(p, ids) {
  if (ids.length) act(p, 'sales', 'sell', { carIds: ids });
}
// Frees one garage slot: sells the cheapest sellable car (duplicates first for the collector).
function freeSlot(p, need = 1) {
  let list = cars(p.id).filter((c) => c.status === 'garage');
  const slots = slotsOf(p.id);
  if (list.length + need <= slots) return true;
  if (p.prof !== 'grinder' && buySlot(p)) return freeSlot(p, need);
  const sellable = list.filter((c) => !S.MODELS[c.model].secret);
  const seen = new Map();
  for (const c of sellable) seen.set(c.model, (seen.get(c.model) || 0) + 1);
  sellable.sort((a, b) => (p.prof === 'collector' ? (seen.get(b.model) > 1) - (seen.get(a.model) > 1) : 0) || price(a.model) - price(b.model));
  const k = list.length + need - slots;
  if (sellable.length <= k) return false;
  sellCars(p, sellable.slice(0, k).map((c) => c.id));
  return true;
}
function buySlot(p) {
  const share = { collector: 0.2, whale: 0.1, casual: 0.05 }[p.prof];
  if (!share) return false;
  const s = slotsOf(p.id);
  if (s >= S.MAX_SLOTS || S.slotCost(s) > p.bal * share) return false;
  return !!act(p, 'slots', 'buy-slot');
}
// Opens one case (a key of it first). Returns the dropped model or null.
function openOne(p, cs) {
  if (!freeSlot(p)) return null;
  const k = keysOf(p.id)[cs.id] || 0;
  const pr = k ? 0 : S.casePrice(cs, dayOf(t));
  if (pr > p.bal) return null;
  const r = act(p, k ? 'keys' : 'cases', 'case/open', { caseId: cs.id });
  if (!r) return null;
  const model = r.results[0].car.model;
  const v = price(model), sv = S.sellPriceOf(model);
  const s = (caseStats[cs.id] ||= { paid: 0, spent: 0, value: 0, sell: 0, below: 0, loss: 0, keys: 0, keyValue: 0, ratios: [] });
  if (k) {
    s.keys++;
    s.keyValue += v;
    bookCar(p, 'keys', v);
  } else {
    s.paid++;
    s.spent += pr;
    s.value += v;
    s.sell += sv;
    if (v < pr) (s.below++, (s.loss += pr - v));
    s.ratios.push(v / pr);
    if (p.opens.length < 20) p.opens.push(v / pr);
  }
  return { model, carId: r.results[0].car.id, key: !!k };
}
function useKeys(p) {
  for (let guard = 0; guard < 30; guard++) {
    const ks = keysOf(p.id);
    const id = Object.keys(ks).find((c) => S.CASE_BY_ID[c]);
    if (!id) return;
    const d = openOne(p, S.CASE_BY_ID[id]);
    if (!d) return;
    if (p.prof === 'grinder') grinderSell(p);
  }
}
const affordable = (p, maxShare) => CAR_CASES.filter((c) => S.casePrice(c, dayOf(t)) <= p.bal * maxShare);
const dearest = (list) => list.sort((a, b) => b.price - a.price)[0];
function grinderSell(p) {
  const list = cars(p.id).filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret).sort((a, b) => price(b.model) - price(a.model));
  sellCars(p, list.slice(1).map((c) => c.id));
}
function race(p, n, hardness) {
  for (let i = 0; i < n; i++) {
    const list = cars(p.id).filter((c) => c.status === 'garage').sort((a, b) => price(b.model) - price(a.model));
    let done = false;
    for (const c of list.slice(0, 6)) {
      const rv = act(p, 'races', 'race/rivals', { carId: c.id });
      if (!rv) continue;
      const opts = rv.list.filter((x) => x.id !== 'train');
      let pick = hardness === 'mid' ? opts.find((x) => x.id === 'mid' && x.chance >= 55) : null;
      pick ||= opts.find((x) => x.id === 'easy');
      if (pick.entry > p.bal) pick = rv.list.find((x) => x.id === 'train');
      const s = act(p, 'races', 'race/start', { carId: c.id, rival: pick.id });
      if (!s) continue;
      const reaction = R() < 0.05 ? -0.1 : Math.max(0.1, Math.min(0.8, 0.28 + (R() + R() + R() - 1.5) * 0.15));
      const wanted = Array.from({ length: S.SHIFTS }, () => {
        const x = R();
        return x < 0.25 ? 'perfect' : x < 0.7 ? 'good' : x < 0.9 ? 'late' : 'early';
      });
      // An honest client run (same steps as the app), and the clock moves by the time the run takes.
      const d = honestDrag(s.car, s.greenMs, reaction, wanted);
      t += Math.ceil(d.ms) + 300;
      act(p, 'races', 'race/finish', { raceId: s.raceId, ...d.body });
      done = true;
      break;
    }
    if (!done) return;
  }
}
// Newbie chain: one part case, an install, a plate, a merge — every profile does the tutorial once.
function tutorial(p) {
  if (p.tutorialDone) return;
  p.tutorialDone = true;
  act(p, 'parts', 'parts/open', { caseId: 'scrap', type: 'body', count: 3 });
  const inv = q("SELECT type, tier, count FROM parts WHERE user_id = ? AND count > 0").all(p.id);
  const c = cars(p.id).find((x) => !S.MODELS[x.model].ev && S.MODELS[x.model].cls === 'D');
  const part = inv.find((x) => x.tier === 'stock' && x.type !== 'motor' && x.type !== 'battery' && x.type !== 'reducer');
  if (c && part) act(p, 'parts', 'parts/install', { carId: c.id, type: part.type, tier: part.tier });
  act(p, 'plates', 'plate/generate', { gen: 'basic' });
  const m = q("SELECT type, tier FROM parts WHERE user_id = ? AND count >= 3 AND tier <> 'race'").get(p.id);
  if (m) act(p, 'parts', 'parts/merge', m);
}

function session(p) {
  const s0 = st(p.id);
  book(p, 'other', s0.balance - p.bal); // money that came between sessions (weekly prizes)
  p.bal = s0.balance;
  if (!p.started) {
    p.started = true;
    act(p, 'cases', 'case/open', { caseId: 'starter' });
  }
  claimAll(p);
  act(p, 'income', 'collect');
  tutorial(p);
  const prof = p.prof;
  if (prof === 'casual') race(p, 2, 'easy');
  else if (prof === 'collector') race(p, 15, 'mid');
  else race(p, prof === 'grinder' ? 6 : 3, 'mid');
  useKeys(p);
  if (prof === 'casual') {
    for (let i = 0; i < 2; i++) {
      const cs = dearest(affordable(p, 1 / 3));
      if (!cs || !openOne(p, cs)) break;
    }
  } else if (prof === 'grinder') {
    for (let i = 0; i < 60; i++) {
      const cs = dearest(affordable(p, 1 / 4)) || CAR_CASES.filter((c) => S.casePrice(c, dayOf(t)) <= p.bal).sort((a, b) => a.price - b.price)[0];
      if (!cs || !openOne(p, cs)) break;
      grinderSell(p);
      useKeys(p);
    }
  } else if (prof === 'collector') {
    buySlot(p);
    for (let i = 0; i < 30; i++) {
      const have = collectionOf(p.id);
      const list = affordable(p, 1 / 2);
      if (!list.length) break;
      // Score: chance that a drop is a missing model.
      const score = (cs) => {
        const sh = S.effectiveWeights(cs);
        let v = 0;
        for (const [cls, w] of Object.entries(sh)) {
          const pool = cs.pool(cls), mw = S.modelWeights(pool), sw = mw.reduce((a, b) => a + b, 0);
          pool.forEach((m, j) => { if (!have.has(m.id)) v += (w * mw[j]) / sw; });
        }
        return v * Math.sqrt(cs.price);
      };
      const cs = list.sort((a, b) => score(b) - score(a))[0];
      if (!openOne(p, cs)) break;
      // Sell duplicates beyond one copy.
      const seen = new Set(), dup = [];
      for (const c of cars(p.id).filter((x) => x.status === 'garage').sort((a, b) => a.id - b.id)) {
        if (seen.has(c.model) && !S.MODELS[c.model].secret) dup.push(c.id);
        seen.add(c.model);
      }
      if (dup.length) sellCars(p, dup);
    }
  } else {
    buySlot(p);
    for (let i = 0; i < 40; i++) {
      const cs = dearest(affordable(p, 1));
      if (!cs || !openOne(p, cs)) break;
    }
  }
  // Firsts.
  const have = collectionOf(p.id);
  const hrs = (t - T0) / 3600e3;
  const top = Math.max(...[...have].map((m) => S.rankOf(S.MODELS[m].cls)));
  if (p.firstA == null && top >= S.rankOf('A')) p.firstA = hrs;
  if (p.firstS == null && top >= S.rankOf('S')) p.firstS = hrs;
}

// ---------- metrics ----------
const pct = (arr, k) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(k * (a.length - 1) + 0.5))];
};
const daily = [];
function snapshot(d) {
  const by = {};
  for (const p of players) {
    const me = g.api.me(p.id);
    const garage = me.cars.reduce((s, c) => s + c.value, 0);
    const sellable = me.cars.filter((c) => !S.MODELS[c.model].secret).map((c) => S.sellPriceOf(c.model)).sort((a, b) => b - a);
    const liquid = me.balance + sellable.slice(1).reduce((a, b) => a + b, 0);
    const keys = Object.entries(me.keys).filter(([k]) => S.CASE_BY_ID[k] && !S.CASE_BY_ID[k].starter).reduce((a, [, n]) => a + n, 0);
    for (const key of [p.prof, 'all']) {
      const b = (by[key] ||= { bal: [], garage: [], income: [], net: [], level: [], coll: [], broke: 0, brokeHard: 0, n: 0 });
      b.n++;
      b.bal.push(me.balance);
      b.garage.push(garage);
      b.income.push(me.income.rate);
      b.net.push(me.balance + garage);
      b.level.push(me.level);
      b.coll.push(me.collection.length);
      if (me.balance < CHEAPEST && !keys) b.broke++;
      if (liquid < CHEAPEST && !keys) b.brokeHard++;
    }
  }
  const out = {};
  for (const [k, b] of Object.entries(by)) {
    out[k] = {
      balP10: pct(b.bal, 0.1), balMed: pct(b.bal, 0.5), balP90: pct(b.bal, 0.9),
      garMed: pct(b.garage, 0.5), garP90: pct(b.garage, 0.9), netMed: pct(b.net, 0.5),
      incMed: pct(b.income, 0.5), incP90: pct(b.income, 0.9), lvlMed: pct(b.level, 0.5), collMed: pct(b.coll, 0.5),
      broke: b.broke / b.n, brokeHard: b.brokeHard / b.n,
    };
  }
  daily.push({ day: d + 1, ...out });
}

// ---------- run ----------
const started = Date.now();
for (day = 0; day < DAYS; day++) {
  for (const p of players) p.skipDay = R() < PROFILES[p.prof].skip ? day : -1;
  for (let h = 0; h < 24; h++) {
    let k = 0;
    for (const p of players) {
      if (p.skipDay === day || !PROFILES[p.prof].hours.includes(h)) continue;
      t = T0 + day * 86400e3 + h * 3600e3 + (k++ % 3000) * 1000;
      session(p);
    }
  }
  t = T0 + day * 86400e3 + 23.9 * 3600e3;
  snapshot(day);
  process.stderr.write(`day ${day + 1} done (${((Date.now() - started) / 1000).toFixed(0)}s)\n`);
}

// ---------- report ----------
const fmtM = (n) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(Math.round(n)));
const firsts = {};
for (const pn of [...PNAMES, 'all']) {
  const ps = players.filter((p) => pn === 'all' || p.prof === pn);
  const a = ps.filter((p) => p.firstA != null).map((p) => p.firstA), s = ps.filter((p) => p.firstS != null).map((p) => p.firstS);
  firsts[pn] = { aShare: a.length / ps.length, aMedH: pct(a, 0.5), sShare: s.length / ps.length, sMedH: pct(s, 0.5) };
}
const caseOut = {};
for (const cs of CAR_CASES) {
  const s = caseStats[cs.id];
  caseOut[cs.id] = {
    price: cs.price, staticEv: cs.ev / cs.price, staticSell: cs.sellEv / cs.price,
    paid: s?.paid || 0, ev: s?.paid ? s.value / s.spent : null, sellEv: s?.paid ? s.sell / s.spent : null,
    belowShare: s?.paid ? s.below / s.paid : null, avgLossWhenBelow: s?.below ? s.loss / s.below / (s.spent / s.paid) : null,
    p10: s?.paid ? pct(s.ratios, 0.1) : null, med: s?.paid ? pct(s.ratios, 0.5) : null, p90: s?.paid ? pct(s.ratios, 0.9) : null,
    keys: s?.keys || 0,
  };
}
const beginner = {};
for (const pn of PNAMES) {
  const r = players.filter((p) => p.prof === pn).flatMap((p) => p.opens.slice(0, 10));
  beginner[pn] = { n: r.length, mean: r.reduce((a, b) => a + b, 0) / (r.length || 1), p10: pct(r, 0.1), med: pct(r, 0.5), below: r.filter((x) => x < 1).length / (r.length || 1) };
}
const result = { label: LABEL, players: N, days: DAYS, seed: SEED, daily, flows, carFlows, flowsDay, firsts, cases: caseOut, beginner, secs: (Date.now() - started) / 1000 };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `sim-${LABEL}.json`), JSON.stringify(result, null, 1));

console.log(`# sim ${LABEL}: ${N} players × ${DAYS} days, seed ${SEED}, ${result.secs.toFixed(0)}s\n`);
console.log('## day | balance p10/med/p90 (all) | broke % | broke-hard % | garage med | income/h med | level med | coll med');
for (const d of daily) {
  const a = d.all;
  console.log(`${d.day} | ${fmtM(a.balP10)}/${fmtM(a.balMed)}/${fmtM(a.balP90)} | ${(a.broke * 100).toFixed(0)} | ${(a.brokeHard * 100).toFixed(0)} | ${fmtM(a.garMed)} | ${fmtM(a.incMed)} | ${a.lvlMed} | ${a.collMed}`);
}
console.log('\n## per profile at days 1, 3, 7, 14: balMed | broke% | garMed | net med | inc/h med');
for (const pn of PNAMES) {
  console.log(pn + ': ' + [1, 3, 7, 14].filter((x) => x <= DAYS).map((x) => {
    const d = daily[x - 1][pn];
    return `d${x} ${fmtM(d.balMed)} | ${(d.broke * 100).toFixed(0)}% | ${fmtM(d.garMed)} | ${fmtM(d.netMed)} | ${fmtM(d.incMed)}`;
  }).join('  ||  '));
}
console.log('\n## cases: price | static EV | static sell | sim EV | sim sell | below% | loss when below | p10/med/p90 | paid opens | key opens');
for (const [id, c] of Object.entries(caseOut)) {
  const f = (x) => (x == null ? '-' : x.toFixed(2));
  console.log(`${id} | ${fmtM(c.price)} | ${f(c.staticEv)} | ${f(c.staticSell)} | ${f(c.ev)} | ${f(c.sellEv)} | ${c.belowShare == null ? '-' : (c.belowShare * 100).toFixed(0) + '%'} | ${f(c.avgLossWhenBelow)} | ${f(c.p10)}/${f(c.med)}/${f(c.p90)} | ${c.paid} | ${c.keys}`);
}
console.log('\n## first A / S: share reached, median hours');
for (const [k, v] of Object.entries(firsts)) console.log(`${k}: A ${(v.aShare * 100).toFixed(0)}% @${v.aMedH.toFixed(0)}h, S ${(v.sShare * 100).toFixed(0)}% @${v.sMedH.toFixed(0)}h`);
console.log('\n## money flows per player over the run (by profile)');
for (const pn of PNAMES) {
  const n = players.filter((p) => p.prof === pn).length;
  const f = flows[pn] || {};
  console.log(pn + ': ' + Object.entries(f).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmtM(v / n)}`).join(', '));
  const c = carFlows[pn] || {};
  console.log('   car value in: ' + Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmtM(v / n)}`).join(', '));
}
console.log('\n## beginner: first 10 paid opens, value/price');
for (const [k, v] of Object.entries(beginner)) console.log(`${k}: mean ${v.mean.toFixed(2)}, p10 ${v.p10.toFixed(2)}, med ${v.med.toFixed(2)}, below ${(v.below * 100).toFixed(0)}%`);
