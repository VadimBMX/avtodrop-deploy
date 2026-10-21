// Expected effort to finish each collection set from zero (S.SETS), by Monte Carlo: node tools/sim-sets.mjs [runs]
// Strategy: while cars are missing, take the missing car with the lowest expected spend (price / chance) and open its
// best case; every drop that belongs to the set counts. Pity is folded into the class shares (effectiveWeights);
// boost, luck, keys, dealer and trade-in are ignored (they only make it cheaper).
// Prints per set: mean opens, mean spend, mean net loss (spend − instant-sale value of every drop), the hardest car,
// the reward's instant-sale value and its share of the net loss; then the total against the collection milestones.
import * as S from '../public/shared.js';

const RUNS = Number(process.argv[2] || 400);
const prep = new Map();
for (const cs of S.CASES.filter((c) => !c.starter)) {
  const ew = S.effectiveWeights(cs);
  const classes = Object.keys(ew).filter((c) => cs.pool(c).length);
  const tot = classes.reduce((s, c) => s + ew[c], 0);
  const p = {};
  const pools = Object.fromEntries(classes.map((c) => {
    const list = cs.pool(c), mw = S.modelWeights(list), sw = mw.reduce((a, b) => a + b, 0);
    let acc = 0;
    list.forEach((m, i) => (p[m.id] = (ew[c] / tot) * (mw[i] / sw)));
    return [c, { list, cum: mw.map((w) => (acc += w / sw)) }];
  }));
  let acc = 0;
  prep.set(cs.id, { cs, classes, cumC: classes.map((c) => (acc += ew[c] / tot)), pools, p });
}
const best = {};
for (const m of S.ALL_MODELS) {
  for (const [id, x] of prep) {
    const p = x.p[m.id];
    if (p && (!best[m.id] || x.cs.price / p < best[m.id].cost)) best[m.id] = { cs: id, p, cost: x.cs.price / p };
  }
}
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (cum) => {
  const r = rnd(), i = cum.findIndex((v) => r < v);
  return i < 0 ? cum.length - 1 : i;
};
function simulate(models) {
  let opens = 0, spend = 0, back = 0;
  for (let run = 0; run < RUNS; run++) {
    const miss = new Set(models);
    while (miss.size) {
      const target = [...miss].sort((a, b) => best[a].cost - best[b].cost)[0];
      const x = prep.get(best[target].cs);
      const pl = x.pools[x.classes[pick(x.cumC)]];
      const m = pl.list[pick(pl.cum)];
      opens++;
      spend += x.cs.price;
      back += S.sellPriceOf(m.id);
      miss.delete(m.id);
    }
  }
  return { opens: opens / RUNS, spend: spend / RUNS, net: (spend - back) / RUNS };
}
let total = 0;
console.log('set | tier | cars | opens | spend | net loss | hardest car | reward | reward/net');
for (const set of S.SETS) {
  const r = simulate(set.models);
  const hard = set.models.map((id) => [id, best[id]]).sort((a, b) => b[1].cost - a[1].cost)[0];
  const v = S.setRewardValue(set);
  total += v;
  console.log([set.id, S.SET_TIERS[set.tier].name, set.models.length, Math.round(r.opens), S.short(r.spend), S.short(r.net),
    `${hard[0]} (${hard[1].cs}, 1/${Math.round(1 / hard[1].p)})`, S.short(v), ((v / r.net) * 100).toFixed(2) + '%'].join(' | '));
}
console.log('all sets', S.short(total), '· collection milestones (cash)', S.short(S.COLLECTION_MILESTONES.reduce((a, m) => a + m.money, 0)));
