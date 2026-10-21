// Guarantee (pity) Monte Carlo per case: a player opens one case over and over and sells every drop at once.
// The roll copies src/game.js rollCase/openCase: class odds, hidden boost (S.BOOST: throw twice, keep the better),
// the player's luck from fading sums (S.luckChance), the guarantee steps, the losing-streak save (S.LUCK.streak /
// hardStreak) and key fragments (S.FRAGMENTS_PER_KEY → a free open). Plain day: no case of the day, no events,
// not a newcomer, not broke. Pure JS (no DB), so millions of opens run in seconds; test/pity.test.js checks the
// game itself against the same steps.
//   node tools/sim-cases.mjs [opens=2000000] [caseId,caseId...] [scan]
// Prints, per case, the current steps (S.pitySteps) and open-and-sell on a plain day, on its deal day and on the luck
// weekend (target, reports/caseev.md: 0.85–0.95 plain, under 1 on any deal day); `scan` prints it at 0.8–1.2 × price:
//   step     — class and n; nat — natural chance of that class or better per open (with the boost);
//   wait     — average opens between two cars of that class or better (with the guarantee);
//   fires    — share of those waits that end by the guarantee; spent — 30 × price, the money until the 1st step fires;
//   sell     — open-and-sell: instant sale of all drops (free opens from fragments included) / money paid;
//   noPity   — the same with no guarantee at all, so sell − noPity is what the guarantee costs.
import * as S from '../public/shared.js';
import { pickWeighted, pickModel, classEntries } from '../src/game.js';

// The rule before reports/pity.md: the case's second class after 30 opens (PITY2 never applied to any case).
export const oldSteps = (cs) => {
  const cl = S.CLASS_ORDER.filter((c) => cs.weights[c]);
  return cl[1] ? [{ cls: cl[1], n: 30, key: cs.id }] : [];
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One player opening `cs` `paidOpens` times with the guarantee `steps`. `deal` (S.caseDeal) sets the price paid, the
// hidden boost, fragments and the streak save — e.g. the case of the day; default: a plain day.
export function simCase(cs, steps, paidOpens = 1e6, seed = 1, deal = { price: cs.price, boost: S.BOOST, fragments: true, save: true }) {
  const R = rng(seed);
  const classes = classEntries(cs.weights);
  const expected = Math.round(caseEVof(cs, steps));
  const pools = Object.fromEntries(classes.map(([c]) => [c, cs.pool(c)]));
  // Average sale value and price of a car of each class: added instead of the drawn car's own (same expectation, far
  // less noise from the rare jackpots), except when the losing-streak save replaced the car.
  const avg = (c, f) => { const l = pools[c], w = S.modelWeights(l), sw = w.reduce((a, b) => a + b, 0); return l.reduce((s, m, i) => s + (f(m) * w[i]) / sw, 0); };
  // Instant sale of a car from this case (its buy-back share S.ORIGIN_SELL included).
  const sellOf = (id) => S.sellPriceOf(id, Infinity, cs.id);
  const avgSell = Object.fromEntries(classes.map(([c]) => [c, avg(c, (m) => sellOf(m.id))]));
  const avgPrice = Object.fromEntries(classes.map(([c]) => [c, avg(c, (m) => m.price)]));
  const cheapestWin = classes.flatMap(([c]) => pools[c]).filter((m) => m.price >= cs.price).sort((a, b) => a.price - b.price)[0];
  const cnt = steps.map(() => 0);
  const st = steps.map(() => ({ hits: 0, forced: 0, waits: 0 }));
  let spent = 0, got = 0, streak = 0, frags = 0, keys = 0;
  let paid = 0, opens = 0, sell = 0, value = 0, forcedOpens = 0;
  const byCls = {};
  while (paid < paidOpens) {
    const isPaid = keys === 0;
    if (isPaid) paid++;
    else keys--;
    opens++;
    const luck = 1 - (1 - deal.boost) * (1 - S.luckChance(spent, got));
    let cls = pickWeighted(classes, R());
    if (luck > 0 && R() < luck) {
      const again = pickWeighted(classes, R());
      if (S.rankOf(again) > S.rankOf(cls)) cls = again;
    }
    // The highest step that is due lifts the roll (same order as the game).
    let forced = false;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (S.rankOf(cls) < S.rankOf(steps[i].cls) && cnt[i] + 1 >= steps[i].n) {
        cls = steps[i].cls;
        forced = true;
        st[i].forced++;
        break;
      }
    }
    if (forced) forcedOpens++;
    steps.forEach((s, i) => {
      if (S.rankOf(cls) >= S.rankOf(s.cls)) {
        st[i].hits++;
        cnt[i] = 0;
      } else cnt[i]++;
    });
    let model = S.MODELS[pickModel(pools[cls], R())];
    const drawn = model;
    if (deal.save && streak >= S.LUCK.streak && model.price < cs.price) {
      for (let i = 0; i < S.LUCK.tries && model.price < cs.price; i++) {
        const c2 = pickWeighted(classes, R());
        const m2 = S.MODELS[pickModel(pools[c2], R())];
        if (m2.price > model.price) model = m2;
      }
      if (streak >= S.LUCK.hardStreak && model.price < cs.price && cheapestWin) model = cheapestWin;
    }
    byCls[model.cls] = (byCls[model.cls] || 0) + 1;
    spent = spent * S.LUCK.decay + expected;
    got = got * S.LUCK.decay + model.price;
    streak = model.price >= cs.price ? 0 : streak + 1;
    if (isPaid && deal.fragments && model.price < deal.price && ++frags >= S.FRAGMENTS_PER_KEY) {
      frags -= S.FRAGMENTS_PER_KEY;
      keys++;
    }
    sell += model === drawn ? avgSell[cls] : sellOf(model.id);
    value += model === drawn ? avgPrice[cls] : model.price;
  }
  return {
    sell: sell / (paid * deal.price), value: value / (paid * deal.price), opens, paid, forcedShare: forcedOpens / opens,
    steps: steps.map((s, i) => ({ ...s, wait: opens / Math.max(1, st[i].hits), fires: st[i].forced / Math.max(1, st[i].hits) })),
    byCls: Object.fromEntries(Object.entries(byCls).map(([c, k]) => [c, k / opens])),
  };
}
// The case's average drop value with the given steps (what cs.ev would be with them).
function caseEVof(cs, steps) {
  const sh = S.effectiveWeights(cs, steps);
  let v = 0;
  for (const [c, p] of Object.entries(sh)) {
    const l = cs.pool(c), w = S.modelWeights(l), sw = w.reduce((a, b) => a + b, 0);
    l.forEach((m, i) => (v += (p * m.price * w[i]) / sw));
  }
  return v;
}
// Deal days of a case (S.caseDeal): its case of the day (rarity) or country of the week (country), and for a rarity
// case the luck weekend (top class ×1.3, no hidden boost; simCase rolls cs.weights, so the weights are swapped in).
export function dayOf(id) {
  for (let i = 0; i < 400; i++) {
    const day = S.kyivDateOf(Date.parse('2026-11-02T12:00:00Z') + i * 864e5);
    if (S.caseOfDay(day) === id) return day;
  }
}
// Open-and-sell of one case on a plain day, on its deal day and on the luck weekend (rarity only); fixed seed.
// The price can be overridden (`price`) to scan for cliffs.
export function caseReturns(cs0, N = 2e5, seed = 7, price = cs0.price) {
  const cs = { ...cs0, price };
  const steps = S.pitySteps(cs);
  const normal = simCase(cs, steps, N, seed).sell;
  const deal = cs.group === 'country'
    ? S.caseDeal(cs, '2026-11-02', S.eventEffects([{ id: 'country', country: cs.country }]))
    : S.caseDeal(cs, dayOf(cs.id));
  const out = { normal, deal: simCase(cs, steps, N, seed, deal).sell, dealWhy: deal.why, dealPrice: deal.price };
  if (cs.group === 'rarity') {
    const ld = S.caseDeal(cs, dayOf(cs.id), S.eventEffects([{ id: 'luck' }]));
    const lcs = { ...cs, weights: ld.weights };
    out.luck = simCase(lcs, S.pitySteps(lcs), N, seed, ld).sell;
  }
  return out;
}

// Natural chance per open of `cls` or better with the hidden boost (no luck, no guarantee).
export function natural(cs, cls) {
  const tw = Object.values(cs.weights).reduce((a, b) => a + b, 0);
  const q = Object.entries(cs.weights).filter(([c]) => S.rankOf(c) >= S.rankOf(cls)).reduce((s, [, w]) => s + w / tw, 0);
  return 1 - ((1 - S.BOOST) * (1 - q) + S.BOOST * (1 - q) ** 2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const N = Number(process.argv[2] || 2e6);
  const ONLY = process.argv[3] && process.argv[3] !== 'scan' ? process.argv[3].split(',') : null;
  const pct = (x) => (x * 100).toFixed(x < 0.01 ? 2 : 1) + '%';
  const list = S.CASES.filter((c) => !c.starter && (!ONLY || ONLY.includes(c.id)));
  // `scan`: open-and-sell at 0.8–1.2 × the price, to see how far the price can move and where a cliff is.
  if (process.argv.includes('scan')) {
    for (const cs of list) {
      const row = [0.8, 0.9, 1, 1.1, 1.2].map((k) => { const p = Math.round((cs.price * k) / 1e3) * 1e3; return `${S.short(p)} ${caseReturns(cs, N, 7, p).normal.toFixed(3)}`; });
      console.log(cs.id, '|', row.join(' | '));
    }
    process.exit(0);
  }
  const stepTx = (r, cs) => r.steps.map((s) => `${s.cls}@${s.n} nat ${pct(natural(cs, s.cls))} wait ${s.wait.toFixed(1)} fires ${pct(s.fires)}`).join(' ; ') || '—';
  console.log(`paid opens per run: ${N.toLocaleString('en')}; sell = instant sale of every drop (free opens included) / money paid`);
  console.log('case | price ×buy-back share (S.ORIGIN_SELL) | guarantee | sell plain day (no guarantee) | deal day (case of the day / country of the week) | luck weekend | forced drops');
  for (const cs of list) {
    const n = simCase(cs, S.pitySteps(cs), N, 7), z = simCase(cs, [], N, 7), r = caseReturns(cs, N, 7);
    console.log([cs.id, `${S.short(cs.price)} ×${S.originSellOf(cs.id)}`, stepTx(n, cs), `${n.sell.toFixed(3)} (${z.sell.toFixed(3)})`,
      `${r.dealWhy} ${S.short(r.dealPrice)} ${r.deal.toFixed(3)}`, r.luck != null ? r.luck.toFixed(3) : '—', pct(n.forcedShare)].join(' | '));
  }
}
