// The price table of the whole economy: every car (now + the 58 coming, tools/econ-coming-cars.mjs) with its S1 and S2
// value, class, cases and drop odds; every case with its S1/S2 price, EV, open-and-sell and class odds; the country
// collections (cost and secret car). Writes CSV + one readable HTML.
//   node tools/econ-table.mjs --base <checkout of the S1 code> --out <dir>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as S from '../public/shared.js';
import { allDays } from './econ-audit.mjs';
import { COMING, comingPrice } from './econ-coming-cars.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = path.resolve(arg('base', '.')), OUT = path.resolve(arg('out', 'reports/econ'));
const imp = (p) => import(pathToFileURL(path.join(BASE, p)).href);
const S1 = await imp('public/shared.js');
const A1 = await imp('tools/econ-audit.mjs');
const N = Number(arg('opens', 40000));
fs.mkdirSync(OUT, { recursive: true });

// Drop chance of every model from every case: class share (guarantees folded in) × the model's 1/√price share in its pool.
function oddsOf(Sx) {
  const out = {};
  for (const cs of Sx.CASES) {
    const sh = cs.starter ? { D: 1 } : Sx.effectiveWeights(cs);
    for (const [cls, w] of Object.entries(sh)) {
      const list = cs.pool(cls), mw = Sx.modelWeights(list), sw = mw.reduce((a, b) => a + b, 0);
      list.forEach((m, i) => ((out[m.id] ||= {})[cs.id] = (w * mw[i]) / sw));
    }
  }
  return out;
}
const odds1 = oddsOf(S1), odds2 = oddsOf(S);
const pct = (p) => (p >= 0.01 ? (p * 100).toFixed(2) : p >= 0.0001 ? (p * 100).toFixed(4) : (p * 100).toExponential(1)) + '%';
const caseList = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([c, p]) => `${c} ${pct(p)}`).join('; ');
const csv = (rows) => {
  const cols = Object.keys(rows[0]);
  const q = (v) => (v == null ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n') + '\n';
};

// ---------- cars now ----------
const ids = [...new Set([...S1.ALL_MODELS, ...S.ALL_MODELS].map((m) => m.id))];
const cars = ids.map((id) => {
  const a = S1.MODELS[id], b = S.MODELS[id], m = b || a;
  return {
    id, name: m.name, country: m.country, class: m.cls, year: m.year, kind: m.secret ? (m.season ? 'season car' : 'secret') : m.homeOnly ? 'UA collector' : 'regular',
    value_s1: a?.price ?? '', value_s2: b?.price ?? '', change: a && b ? +(b.price / a.price).toFixed(3) : '',
    sale_s1: a && !a.secret ? S1.sellPriceOf(id) : '', sale_s2: b && !b.secret ? S.sellPriceOf(id) : '',
    cases_s2: caseList(odds2[id]), cases_s1: caseList(odds1[id]),
  };
}).sort((x, y) => S.rankOf(x.class) - S.rankOf(y.class) || (x.value_s2 || 0) - (y.value_s2 || 0));
fs.writeFileSync(path.join(OUT, 'cars.csv'), csv(cars));

// ---------- coming cars (virtual) ----------
// Pools with the coming cars added: which S2 cases a coming car would fall into and its odds there.
const comingRows = COMING.map((c) => ({ ...c, price: comingPrice(c) }));
function virtualOdds(c) {
  const out = {};
  if (c.cls === 'X') return out;
  for (const cs of S.CASES.filter((x) => !x.starter)) {
    const sh = S.effectiveWeights(cs);
    if (!sh[c.cls]) continue;
    const base = cs.poolPrice ?? cs.price;
    const lo = base * (cs.lo ?? (cs.country ? 0 : S.CASE_CORRIDOR.lo)), hi = base * (cs.hi || S.CASE_CORRIDOR.hi);
    if (cs.country ? cs.country !== c.country : false) continue;
    if (c.price < lo || c.price > hi) continue;
    const list = [...cs.pool(c.cls), ...comingRows.filter((x) => x.cls === c.cls && x.price >= lo && x.price <= hi && (!cs.country || x.country === cs.country))];
    const sw = list.reduce((s, m) => s + 1 / Math.sqrt(m.price), 0);
    out[cs.id] = (sh[c.cls] * (1 / Math.sqrt(c.price))) / sw;
  }
  return out;
}
const coming = comingRows.map((c) => ({
  n: c.n, id: c.id, name: c.name, country: c.country, class_david: c.clsDavid, class_s2: c.cls, class_changed: c.cls !== c.clsDavid ? 'yes' : '', year: c.year,
  hp: c.hp, kg: c.kg, value_s2: c.price, sale_s2: c.cls === 'X' ? '' : Math.floor(c.price * S.SELL_RATES[c.cls]), cases_s2: c.cls === 'X' ? 'not in a case (reward)' : caseList(virtualOdds(c)) || 'no case (dealer / rewards)', why: c.why,
}));
fs.writeFileSync(path.join(OUT, 'coming-cars.csv'), csv(coming));

// ---------- cases ----------
const caseRow = (Sx, Ax, cs) => {
  if (!cs) return null;
  const sh = Sx.effectiveWeights(cs);
  const all = Object.keys(cs.weights).flatMap((c) => cs.pool(c));
  const lo = all.reduce((a, b) => (a.price < b.price ? a : b)), hi = all.reduce((a, b) => (a.price > b.price ? a : b));
  const d = Ax.allDays(cs, N, 7);
  return { price: cs.price, ev: cs.ev, evx: cs.ev / cs.price, plain: d.plain, deal: d.deal, max: d.max, n: all.length,
    floorV: lo.price / cs.price, floorS: Sx.sellPriceOf(lo.id, Infinity, cs.id) / cs.price, floorCar: lo.name, top: hi.price / cs.price,
    odds: Sx.CLASS_ORDER.filter((c) => sh[c]).map((c) => `${c} ${pct(sh[c])}`).join(' · ') };
};
const caseIds = [...new Set([...S1.CASES, ...S.CASES].filter((c) => !c.starter).map((c) => c.id))];
const cases = caseIds.map((id) => {
  const a = caseRow(S1, A1, S1.CASE_BY_ID[id]), b = caseRow(S, { allDays }, S.CASE_BY_ID[id]);
  const cs = S.CASE_BY_ID[id];
  return { id, name: cs.name, group: cs.group, price_s1: a.price, price_s2: b.price, price_changed: a.price !== b.price ? 'yes' : '',
    ev_value_s1: a.ev, ev_value_s2: b.ev, ev_x_s1: +a.evx.toFixed(2), ev_x_s2: +b.evx.toFixed(2),
    open_and_sell_s1: +a.plain.toFixed(3), open_and_sell_s2: +b.plain.toFixed(3), worst_day_s1: +a.max.toFixed(3), worst_day_s2: +b.max.toFixed(3),
    cheapest_drop_value_x_s1: +a.floorV.toFixed(2), cheapest_drop_value_x_s2: +b.floorV.toFixed(2), cheapest_drop_sale_x_s1: +a.floorS.toFixed(2), cheapest_drop_sale_x_s2: +b.floorS.toFixed(2),
    top_drop_x_s1: +a.top.toFixed(1), top_drop_x_s2: +b.top.toFixed(1), cars_s1: a.n, cars_s2: b.n, odds_s1: a.odds, odds_s2: b.odds };
});
fs.writeFileSync(path.join(OUT, 'cases.csv'), csv(cases));

// ---------- HTML ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (n) => (n === '' || n == null ? '—' : S.short(n).replace(' ₴', ''));
const CLS = { D: '#9aa4b2', C: '#3b82f6', B: '#a855f7', A: '#ff8a3d', S: '#ef4444', X: '#22d3ee' };
const chip = (c) => `<span class="cls" style="--c:${CLS[c] || '#888'}">${c}</span>`;
const table = (head, rows, id) => `<div class="wrap"><table id="${id}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const caseHtml = cases.map((c) => `<tr><td><b>${esc(c.name)}</b><br><span class="mut">${c.id}</span></td><td class="num">${money(c.price_s1)}</td><td class="num ${c.price_changed ? 'chg' : ''}">${money(c.price_s2)}</td>
  <td class="num">×${c.ev_x_s1}</td><td class="num">×${c.ev_x_s2}</td><td class="num">${c.open_and_sell_s1}</td><td class="num">${c.open_and_sell_s2}</td><td class="num">${c.worst_day_s1}</td><td class="num">${c.worst_day_s2}</td>
  <td class="num">×${c.cheapest_drop_sale_x_s1}</td><td class="num">×${c.cheapest_drop_sale_x_s2}</td><td class="num">×${c.top_drop_x_s2}</td><td class="sm">${esc(c.odds_s1)}</td><td class="sm">${esc(c.odds_s2)}</td></tr>`);
const carHtml = cars.map((c) => `<tr data-cls="${c.class}"><td>${chip(c.class)}</td><td>${esc(c.name)}<br><span class="mut">${c.country} · ${c.year} · ${c.kind}</span></td><td class="num">${money(c.value_s1)}</td><td class="num ${c.change && c.change !== 1 ? 'chg' : ''}">${money(c.value_s2)}</td><td class="num">${money(c.sale_s1)}</td><td class="num">${money(c.sale_s2)}</td><td class="sm">${esc(c.cases_s2)}</td></tr>`);
const comingHtml = coming.map((c) => `<tr data-cls="${c.class_s2}"><td class="num">${c.n}</td><td>${chip(c.class_david)}${c.class_changed ? ' → ' + chip(c.class_s2) : ''}</td><td>${esc(c.name)}<br><span class="mut">${c.country} · ${c.year} · ${c.hp} к.с. / ${c.kg} кг</span></td><td class="num">${money(c.value_s2)}</td><td class="num">${money(c.sale_s2)}</td><td class="sm">${esc(c.cases_s2)}</td><td class="sm">${esc(c.why)}</td></tr>`);
const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>АВТОДРОП — ціни Сезону 2</title>
<style>
:root{--bg:#f6f6f4;--fg:#16181d;--mut:#6b7280;--line:#e2e2de;--card:#fff;--accent:#c99a00;--chg:#fff4c2}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0e0f12;--fg:#e9eaee;--mut:#9aa0ab;--line:#262931;--card:#16181d;--accent:#ffd400;--chg:#3a3110}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 64px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px;border-bottom:2px solid var(--accent);padding-bottom:4px}
p{max-width:820px}.mut{color:var(--mut);font-size:12px}.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:760px}th,td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
th{position:sticky;top:0;background:var(--card);font-size:12px;color:var(--mut);font-weight:600;cursor:pointer}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sm{font-size:12px;color:var(--mut);max-width:360px}.chg{background:var(--chg);font-weight:600}.cls{display:inline-block;min-width:18px;text-align:center;border-radius:4px;padding:0 4px;font-weight:700;color:#fff;background:var(--c)}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.bar button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:4px 10px;cursor:pointer}.bar button.on{border-color:var(--accent);box-shadow:inset 0 -2px var(--accent)}
</style></head><body><main>
<h1>АВТОДРОП — ціни Сезону 2</h1><p class="mut">Згенеровано ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC з public/econ.js (S2) і коду Сезону 1. Жовтим — що змінилось. «Відкрити й продати» — Монте-Карло ${N} відкриттів на звичайний день (удача, гарантія, фрагменти, рятівний кидок враховані), «найгірший день» — максимум по днях знижок / подій / батлів.</p>
<h2>Кейси</h2>${table(['Кейс', 'Ціна S1', 'Ціна S2', 'Сер. вартість S1', 'S2', 'Відкрити й продати S1', 'S2', 'Найгірший день S1', 'S2', 'Найдешевший дроп, продаж ×ціни S1', 'S2', 'Найдорожчий дроп ×ціни S2', 'Шанси класів S1', 'Шанси класів S2'], caseHtml, 'cases')}
<h2>Машини в грі (${cars.length})</h2><div class="bar" id="f1">${['усі', 'D', 'C', 'B', 'A', 'S', 'X'].map((c, i) => `<button data-c="${c}" class="${i ? '' : 'on'}">${c}</button>`).join('')}</div>
${table(['Клас', 'Модель', 'Вартість S1', 'Вартість S2', 'Продаж S1', 'Продаж S2', 'Кейси S2 і шанс за відкриття'], carHtml, 'cars')}
<h2>Нові машини 183–240 (віртуально, ще не в грі)</h2><p class="mut">Ціна — між сусідами класу за потужністю/вагою і престижем (як LATE_RAW), жодна наявна машина не дешевшає. Клас «→» — моя пропозиція замість класу з завдання для Давида; причина праворуч. Шанс — у пулі разом з усіма новими машинами.</p>
${table(['№', 'Клас', 'Модель', 'Вартість S2', 'Продаж', 'Кейси S2 і шанс', 'Чому клас інший'], comingHtml, 'coming')}
</main><script>
document.querySelectorAll('#f1 button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#f1 button').forEach(x=>x.classList.toggle('on',x===b));const c=b.dataset.c;document.querySelectorAll('#cars tbody tr').forEach(r=>r.style.display=c==='усі'||r.dataset.cls===c?'':'none')});
document.querySelectorAll('th').forEach((th,i)=>th.onclick=()=>{const tb=th.closest('table').tBodies[0];const rows=[...tb.rows];const k=th.cellIndex;const num=(t)=>{const m=t.replace(/[×\\s]/g,'').replace(',','.').match(/^-?[\\d.]+/);if(!m)return NaN;let v=parseFloat(m[0]);if(/млрд/.test(t))v*=1e9;else if(/млн/.test(t))v*=1e6;else if(/тис/.test(t))v*=1e3;return v};const dir=th.dataset.d=th.dataset.d==='1'?'-1':'1';rows.sort((a,b)=>{const x=a.cells[k].innerText,y=b.cells[k].innerText;const p=num(x),q=num(y);return (isNaN(p)||isNaN(q)?x.localeCompare(y,'uk'):p-q)*dir});rows.forEach(r=>tb.appendChild(r))});
</script></body></html>`;
fs.writeFileSync(path.join(OUT, 'price-table.html'), html);
console.log(`wrote ${OUT}/cars.csv (${cars.length}), coming-cars.csv (${coming.length}), cases.csv (${cases.length}), price-table.html`);
