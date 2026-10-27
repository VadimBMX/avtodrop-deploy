// «Сарайна знахідка»: is restoring free money? Per find model: what the four stages cost (money + parts at what they
// cost to get: a part case sells parts at ~0,6 of tier price, the dealer buys them back at 0,5 — we take 0,55), what
// the «R» is worth (×1,6 value), what the dealer pays for it, and the extra garage income it brings over the plain car.
// Usage: node tools/sim-barn.mjs [--all]
import * as S from '../public/shared.js';
import * as B from '../public/barn.js';

const PART_COST = 0.55;
const all = process.argv.includes('--all');
const rows = S.BARN_MODELS.map((id) => {
  const m = S.MODELS[id], r = S.MODELS[S.R_OF[id]];
  const money = B.totalMoney(id);
  const parts = B.partsCount() * S.TIER_BY_ID[B.partTierOf(id)].price * PART_COST;
  const cost = money + parts;
  const sale = S.sellPriceOf(r.id), plainSale = S.sellPriceOf(id);
  const incPlain = S.carIncomeOf({ model: id, parts: {} }), incR = S.carIncomeOf({ model: r.id, parts: {} });
  return { id, cls: m.cls, base: m.price, money, parts, cost, value: r.price, sale, plainSale, incPlain, incR, payH: cost / (incR - incPlain) };
});
const f = (x) => S.short(Math.round(x));
const p = (x) => x.toFixed(2).replace('.', ',');
console.log('клас | машина | база | гроші | деталі | витрати/база | R/база | дилер за R/база | продати одразу | +дохід/год | окупність доп. доходом');
const show = (r) => console.log([r.cls, r.id, f(r.base), f(r.money), f(r.parts), p(r.cost / r.base), p(r.value / r.base), p(r.sale / r.base), f(r.sale - r.cost), f(r.incR - r.incPlain), `${Math.round(r.payH)} год`].join(' | '));
if (all) rows.forEach(show);
for (const cls of ['D', 'C', 'B', 'A', 'S']) {
  const L = rows.filter((r) => r.cls === cls);
  if (!L.length) continue;
  const avg = (k) => L.reduce((s, r) => s + r[k], 0) / L.length;
  const minC = Math.min(...L.map((r) => r.cost / r.base)), maxC = Math.max(...L.map((r) => r.cost / r.base));
  console.log(`${cls} (${L.length} моделей): база ${f(avg('base'))}, витрати ${p(minC)}–${p(maxC)} бази (гроші ${f(avg('money'))} + деталі ${f(avg('parts'))}), ` +
    `R = ${p(S.R_MULT)} бази, дилер за R ${p(avg('sale') / avg('base'))} → «відреставрував і продав» ${f(avg('sale') - avg('cost'))} (${p(avg('sale') / avg('cost'))} від витрат), ` +
    `+${f(avg('incR') - avg('incPlain'))}/год доходу, окупність ${Math.round(avg('payH'))} год`);
}
// Weekly free finds: the expected base value and cost by level band.
for (const o of B.WEEKLY_ODDS) {
  let ev = 0, evCost = 0, evSale = 0;
  const tot = Object.values(o.w).reduce((a, b) => a + b, 0);
  for (const [cls, w] of Object.entries(o.w)) {
    const L = rows.filter((r) => r.cls === cls);
    for (const r of L) {
      ev += (w / tot / L.length) * r.base;
      evCost += (w / tot / L.length) * r.cost;
      evSale += (w / tot / L.length) * r.sale;
    }
  }
  console.log(`Щотижнева знахідка з рівня ${o.level}: база в середньому ${f(ev)}, реставрація ${f(evCost)}, дилер за R ${f(evSale)} (${p(evSale / evCost)} від витрат)`);
}
const rushAll = (id) => B.STAGES.reduce((s, x) => s + B.rushCost(id, x.hours * 3600e3), 0);
console.log(`Прискорення всіх 4 етапів (${B.STAGE_HOURS} год): ${p(rushAll('vaz-2101-kopiika') / S.MODELS['vaz-2101-kopiika'].price)} бази зверху — лише гривні`);
