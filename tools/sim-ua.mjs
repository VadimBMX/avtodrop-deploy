// The «Україна/СРСР» case and its gold (A) Soviet rarities: how often they drop, what it costs to get each one and to
// finish the Ukrainian collection, and what open-and-sell pays.
//   node tools/sim-ua.mjs                 — exact odds + fast collection sim (seconds)
//   node tools/sim-ua.mjs api [opens=100000] [seeds=2]   — also open-and-sell through the real API (≈1 ms per open)
// «exact»: class odds with the hidden boost (throw twice, keep the better class), then the guarantees (gold after
// the case's steps S.pitySteps, highest first); the losing-streak save and the player's own luck are left out (the
// API run has them). The collection sim draws opens with the same odds and the gold guarantee picking a missing car.
import * as S from '../public/shared.js';
import { runCase, findTime } from './sim-events.mjs';

const cs = S.CASE_BY_ID['c-ua'];
const fmt = (n) => S.short(Math.round(n));

// Per-open class chances: boost first, then the gold guarantee, then the blue one (as the server rolls them).
export function uaOdds(c = cs, boost = S.BOOST) {
  const tw = Object.values(c.weights).reduce((a, b) => a + b, 0);
  const cl = S.CLASS_ORDER.filter((k) => c.weights[k]);
  const p = {};
  let F = 0, prev = 0;
  for (const k of cl) {
    F += c.weights[k] / tw;
    const B = (1 - boost) * F + boost * F * F;
    p[k] = B - prev;
    prev = B;
  }
  const lift = (g, n) => {
    const up = cl.filter((k) => S.rankOf(k) >= S.rankOf(g)), dn = cl.filter((k) => S.rankOf(k) < S.rankOf(g));
    const q = up.reduce((s, k) => s + p[k], 0), extra = q / (1 - Math.pow(1 - q, n)) - q;
    for (const k of dn) p[k] -= (extra * p[k]) / (1 - q);
    p[g] += extra;
  };
  for (const st of [...S.pitySteps(c)].sort((a, b) => S.rankOf(b.cls) - S.rankOf(a.cls))) lift(st.cls, st.n);
  return p;
}
// Instant-sale return of one paid open (free opens from key fragments counted), exact apart from save/luck.
export function uaSell(c = cs, { price = c.price, boost = S.BOOST, frag = true } = {}) {
  const p = uaOdds(c, boost);
  let sell = 0, below = 0;
  for (const k of Object.keys(p)) {
    const list = c.pool(k), w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
    list.forEach((m, i) => {
      sell += (p[k] * w[i] * S.sellPriceOf(m.id)) / sw;
      if (m.price < price) below += (p[k] * w[i]) / sw;
    });
  }
  return (sell * (1 + (frag ? below / S.FRAGMENTS_PER_KEY : 0))) / price;
}
// Fast collection sim: opens until every UA car is in the collection; returns opens to each gold car and to all.
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
export function collectionRun(seed, c = cs, cap = 2e6) {
  const R = lcg(seed);
  const cl = S.CLASS_ORDER.filter((k) => c.weights[k]), W = cl.map((k) => [k, c.weights[k]]);
  const tw = W.reduce((s, [, w]) => s + w, 0);
  const roll = () => { let x = R() * tw; for (const [k, w] of W) if ((x -= w) < 0) return k; return W[W.length - 1][0]; };
  const pools = Object.fromEntries(cl.map((k) => [k, c.pool(k)]));
  const pick = (list) => { const w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0); let x = R() * sw; for (let i = 0; i < list.length; i++) if ((x -= w[i]) < 0) return list[i].id; return list[list.length - 1].id; };
  const need = new Set(S.countryModels('UA').map((m) => m.id)), got = new Set(), first = {};
  const steps = S.pitySteps(c), since = steps.map(() => 0);
  let n = 0;
  while (got.size < need.size && n < cap) {
    n++;
    let k = roll(), due = -1;
    if (R() < S.BOOST) { const k2 = roll(); if (S.rankOf(k2) > S.rankOf(k)) k = k2; }
    for (let i = steps.length - 1; i >= 0; i--) if (S.rankOf(k) < S.rankOf(steps[i].cls) && since[i] + 1 >= steps[i].n) { k = steps[i].cls; due = i; break; }
    const miss = steps.map((s) => (s.missing ? pools[s.cls].filter((m) => !got.has(m.id)) : []));
    const id = pick(due >= 0 && steps[due].missing && miss[due].length ? miss[due] : pools[k]);
    // As on the server: a { missing } step is reset only by a new car of its class while some are missing.
    steps.forEach((s, i) => { since[i] = S.rankOf(k) >= S.rankOf(s.cls) && (!s.missing || !miss[i].length || miss[i].some((m) => m.id === id)) ? 0 : since[i] + 1; });
    if (!got.has(id)) { got.add(id); first[id] = n; }
  }
  return { all: n, first };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = uaOdds();
  const gold = cs.pool('A');
  console.log(`case ${cs.id}: price ${cs.price}, weights ${JSON.stringify(cs.weights)}, guarantees ${S.pitySteps(cs).map((s) => `${s.cls}@${s.n}${s.missing ? ' (a missing car)' : ''}`).join(', ') || 'none'}`);
  console.log(`per open: D ${(p.D * 100).toFixed(2)}% · C ${(p.C * 100).toFixed(2)}% · gold A ${(p.A * 100).toFixed(3)}% = 1 in ${(1 / p.A).toFixed(0)} opens`);
  console.log(`open-and-sell (exact, no save/luck): ${uaSell().toFixed(3)}; country of the week (−15%, no boost/fragments): ${uaSell(cs, { price: Math.round(cs.price * 0.85 / 1000) * 1000, boost: 0, frag: false }).toFixed(3)}`);
  const w = S.modelWeights(gold), sw = w.reduce((a, b) => a + b, 0);
  console.log('\ngold car | value | instant sale | in-class | per open | opens on average (first, no guarantee pick) | money');
  gold.forEach((m, i) => {
    const q = (p.A * w[i]) / sw;
    console.log([m.name, fmt(m.price), fmt(S.sellPriceOf(m.id)), ((w[i] / sw) * 100).toFixed(1) + '%', (q * 100).toFixed(4) + '%', (1 / q).toFixed(0), fmt(cs.price / q)].join(' | '));
  });
  const runs = 2000, res = Array.from({ length: runs }, (_, i) => collectionRun(i + 1));
  const avg = (f) => res.reduce((s, r) => s + f(r), 0) / runs;
  const pctl = (f, q) => res.map(f).sort((a, b) => a - b)[Math.floor(q * (runs - 1))];
  console.log(`\ncollection sim (${runs} players, fast model): opens until the car is in the collection — mean / median / 90%`);
  for (const m of gold) console.log(`  ${m.name}: ${avg((r) => r.first[m.id]).toFixed(0)} / ${pctl((r) => r.first[m.id], 0.5)} / ${pctl((r) => r.first[m.id], 0.9)}`);
  console.log(`  all four gold = whole UA collection: ${avg((r) => r.all).toFixed(0)} / ${pctl((r) => r.all, 0.5)} / ${pctl((r) => r.all, 0.9)} opens; money ≈ ${fmt(avg((r) => r.all) * cs.price)} spent, ≈ ${fmt(avg((r) => r.all) * cs.price * Math.max(0, 1 - uaSell()))} lost after selling every drop`);

  // Other cases: chance per open of the top class (with boost and guarantees) and its value against the case price.
  console.log('\ncase | price | top class | per open | 1 in | avg top value / price | gold A or better: 1 in');
  for (const c of S.CASES.filter((x) => !x.starter)) {
    const sh = S.effectiveWeights(c), cl = S.CLASS_ORDER.filter((k) => sh[k]), top = cl[cl.length - 1];
    let qTop = c.id === cs.id ? p.A : (() => { const F = 1 - sh[top]; return 1 - ((1 - S.BOOST) * F + S.BOOST * F * F); })();
    const list = c.pool(top), ww = S.modelWeights(list), s2 = ww.reduce((a, b) => a + b, 0);
    const avgTop = list.reduce((s, m, i) => s + (m.price * ww[i]) / s2, 0);
    const Fa = cl.filter((k) => S.rankOf(k) < S.rankOf('A')).reduce((s, k) => s + sh[k], 0);
    const qA = c.id === cs.id ? p.A : 1 - ((1 - S.BOOST) * Fa + S.BOOST * Fa * Fa);
    console.log([c.id, fmt(c.price), top, (qTop * 100).toFixed(3) + '%', (1 / qTop).toFixed(0), (avgTop / c.price).toFixed(0) + '×', (1 / qA).toFixed(0)].join(' | '));
  }

  if (process.argv[2] === 'api') {
    const N = Number(process.argv[3] || 100000), seeds = Number(process.argv[4] || 2);
    const t0 = findTime((fx, date) => fx.topMult === 1 && !fx.countries.includes('UA'));
    let paid = 0, sell = 0, opens = 0, keyOpens = 0, golds = 0;
    for (let s = 0; s < seeds; s++) {
      const r = runCase(cs, t0, N, null, 'ua' + s);
      paid += r.paid; sell += r.sell; opens += r.opens; keyOpens += r.keyOpens; golds += r.classes.A || 0;
    }
    console.log(`\nAPI (${seeds}×${N} paid opens, real rolls with boost, luck, streak save, fragments): open-and-sell ${(sell / paid).toFixed(3)}, free keys ${((keyOpens / opens) * 100).toFixed(1)}%, gold ${golds} = 1 in ${(opens / Math.max(1, golds)).toFixed(0)} paid opens`);
  }
}
