// Before / after report of tools/econ-sim.mjs runs: CSV of the median curves and milestones + one HTML page with SVG charts
// (garage + cash per minute in the game, log scale, per archetype).
//   node tools/econ-sim-report.mjs <before.json> <after.json> <out dir>
import fs from 'node:fs';
import path from 'node:path';

const [bf, af, out] = process.argv.slice(2);
const runs = { before: JSON.parse(fs.readFileSync(bf, 'utf8')), after: JSON.parse(fs.readFileSync(af, 'utf8')) };
fs.mkdirSync(out, { recursive: true });
const KINDS = Object.keys(runs.after.summary);
const rows = [];
for (const [label, r] of Object.entries(runs)) for (const k of KINDS) for (const p of r.summary[k].curve) rows.push({ run: label, archetype: k, day: p.day, minutes: p.mins, cash: p.balance, worth: p.worth, cash_plus_sale: p.sellable, level: p.level, income_h: p.incomeH, idle_share: p.idle });
const toCsv = (rs) => [Object.keys(rs[0]).join(','), ...rs.map((r) => Object.values(r).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(out, 'sim-curves.csv'), toCsv(rows));
const MS = ['worth1M', 'worth10M', 'worth100M', 'worth1B', 'bal1M', 'bal10M'];
const ms = [];
for (const k of KINDS) for (const [label, r] of Object.entries(runs)) ms.push({ archetype: k, run: label, ...Object.fromEntries(MS.map((m) => [m + '_min', r.summary[k].milestones[m] ?? ''])) });
fs.writeFileSync(path.join(out, 'sim-milestones.csv'), toCsv(ms));
fs.writeFileSync(path.join(out, 'sim-flow.csv'), toCsv(Object.keys({ ...runs.before.flow, ...runs.after.flow }).map((k) => ({ source: k, before: Math.round(runs.before.flow[k] || 0), after: Math.round(runs.after.flow[k] || 0) }))));

const short = (n) => (n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + ' млрд' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тис' : String(Math.round(n)));
const fm = (m) => (m === '' || m == null ? '—' : m < 120 ? m + ' хв' : (m / 60).toFixed(1) + ' год');
function chart(kind) {
  const W = 560, H = 300, L = 56, R = 12, T = 16, Bm = 34;
  const pts = Object.fromEntries(Object.entries(runs).map(([l, r]) => [l, r.summary[kind].curve.map((p) => [p.mins, Math.max(1e5, p.worth)])]));
  const xmax = Math.max(...Object.values(pts).flat().map((p) => p[0]));
  const ylo = 5, yhi = 10;
  const x = (m) => L + (m / xmax) * (W - L - R), y = (v) => T + (1 - (Math.log10(v) - ylo) / (yhi - ylo)) * (H - T - Bm);
  const grid = [5, 6, 7, 8, 9, 10].map((e) => `<line x1="${L}" x2="${W - R}" y1="${y(10 ** e)}" y2="${y(10 ** e)}" class="g"/><text x="${L - 6}" y="${y(10 ** e) + 4}" class="ax" text-anchor="end">${short(10 ** e)}</text>`).join('');
  const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${x(f * xmax)}" y="${H - 12}" class="ax" text-anchor="middle">${fm(Math.round(f * xmax))}</text>`).join('');
  const band = `<rect x="${x(120)}" y="${T}" width="${x(180) - x(120)}" height="${H - T - Bm}" class="band"/><text x="${(x(120) + x(180)) / 2}" y="${T + 12}" class="ax" text-anchor="middle">2–3 год</text>`;
  const line = (l, cls) => `<polyline class="${cls}" points="${pts[l].map(([a, b]) => `${x(a).toFixed(1)},${y(b).toFixed(1)}`).join(' ')}"/>`;
  return `<figure><figcaption>${kind}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${kind}: вартість гаража + гроші за хвилинами гри, до і після">${band}${grid}${xt}${line('before', 'b')}${line('after', 'a')}</svg></figure>`;
}
const msRows = KINDS.map((k) => `<tr><td><b>${k}</b></td>${['worth1M', 'worth10M', 'worth100M', 'worth1B'].map((m) => `<td class="num">${fm(runs.before.summary[k].milestones[m])}</td><td class="num a">${fm(runs.after.summary[k].milestones[m])}</td>`).join('')}</tr>`).join('');
const dayRow = (k, day) => {
  const pick = (r) => r.summary[k].curve.filter((p) => p.day <= day + 0.99).pop();
  const b = pick(runs.before), a = pick(runs.after);
  return `<tr><td>${k}</td><td class="num">${day + 1}</td><td class="num">${fm(a.mins)}</td><td class="num">${short(b.worth)}</td><td class="num a">${short(a.worth)}</td><td class="num">${short(b.sellable)}</td><td class="num a">${short(a.sellable)}</td><td class="num">${Math.round(b.idle * 100)}%</td><td class="num a">${Math.round(a.idle * 100)}%</td></tr>`;
};
const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>АВТОДРОП — симуляція економіки</title>
<style>:root{--bg:#f6f6f4;--fg:#16181d;--mut:#6b7280;--line:#e2e2de;--card:#fff;--b:#9aa0ab;--a:#c99a00}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0e0f12;--fg:#e9eaee;--mut:#9aa0ab;--line:#262931;--card:#16181d;--b:#6b7280;--a:#ffd400}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}main{max-width:1200px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}.mut{color:var(--mut)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px}figcaption{font-weight:600;margin:0 0 4px 8px}svg{width:100%;height:auto}
.g{stroke:var(--line)}.ax{fill:var(--mut);font-size:11px}.band{fill:var(--a);opacity:.1}polyline{fill:none;stroke-width:2.5}.b{stroke:var(--b);stroke-dasharray:5 4}.a{stroke:var(--a)}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;min-width:640px}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}th{font-size:12px;color:var(--mut)}
.num{text-align:right;font-variant-numeric:tabular-nums}td.a{font-weight:600}.key span{display:inline-block;width:22px;height:0;border-top:3px solid var(--a);vertical-align:middle;margin:0 6px 0 12px}.key span.k{border-top:3px dashed var(--b)}</style></head><body><main>
<h1>Симуляція економіки: Сезон 1 проти Сезону 2</h1>
<p class="mut">tools/econ-sim.mjs — боти грають справжній рушій гри (src/game.js) ${runs.after.days} днів, по ${runs.after.perArch} на тип, медіана. Вісь X — хвилини в грі (сесії: casual 2×10 хв/день, active і whale 3×50, grinder 3×60). Вісь Y — гараж + гроші (лог). <span class="key"><span class="k"></span>Сезон 1 <span></span>Сезон 2</span></p>
<div class="grid">${KINDS.map(chart).join('')}</div>
<h2>Коли гравець доходить до 1 млн / 10 млн / 100 млн / 1 млрд (гараж + гроші)</h2>
<div class="wrap"><table><thead><tr><th>тип</th><th>1 млн S1</th><th>S2</th><th>10 млн S1</th><th>S2</th><th>100 млн S1</th><th>S2</th><th>1 млрд S1</th><th>S2</th></tr></thead><tbody>${msRows}</tbody></table></div>
<h2>По днях</h2><div class="wrap"><table><thead><tr><th>тип</th><th>день</th><th>в грі</th><th>гараж+гроші S1</th><th>S2</th><th>гроші+продаж S1</th><th>S2</th><th>простій S1</th><th>S2</th></tr></thead><tbody>
${KINDS.flatMap((k) => [0, 2, 6, 13].filter((d) => d < runs.after.days).map((d) => dayRow(k, d))).join('')}</tbody></table></div>
<p class="mut">«Простій» — частка хвилин сесії, коли боту нема на що витрачати (нема грошей на кейс і пального). Бот не грає дрифт, босів і «Заїзд дня», тож справжній простій нижчий.</p>
</main></body></html>`;
fs.writeFileSync(path.join(out, 'sim.html'), html);
console.log('wrote sim-curves.csv, sim-milestones.csv, sim-flow.csv, sim.html to', out);
