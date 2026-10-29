// Desktop admin («ПК-адмінка», src/admin-pc.js): «Живий дашборд», «Економіка й кейси», «Перегляд бази», the wide
// player card's extra panels, inline SVG charts and the install button. Built for a computer first (≥ 1200 px uses
// the width, admin.css «desktop»), still usable on a phone.
//
// Charts: drawn at the container's real pixel width (so text keeps its size), redrawn on resize. One series per
// chart in the accent, a second one only as context (yesterday — muted, named in the legend) or for money in / out
// (the validated --made / --gone pair). Thin bars with a 2px gap and rounded data ends, a recessive grid with 3–4
// nice ticks, a hover band with a tooltip that names the bucket and every value.

const NS = 'http://www.w3.org/2000/svg';
const charts = new Map(); // element id → spec, so a resize can redraw
let tipEl = null;

function niceStep(max, ticks = 3) {
  if (max <= 0) return 1;
  const raw = max / ticks, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
// 1234567 → "1,2M"; small numbers stay whole.
export function shortNum(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  const f = (v, u) => `${s}${(Math.round(v * 10) / 10).toString().replace('.', ',')}${u}`;
  if (a >= 1e9) return f(a / 1e9, 'B');
  if (a >= 1e6) return f(a / 1e6, 'M');
  if (a >= 1e4) return f(a / 1e3, 'k');
  return s + Math.round(a).toLocaleString('uk-UA');
}

// spec: { labels: [...], series: [{ name, values, kind: 'bar' | 'line', tone: 'accent' | 'context' | 'made' | 'gone', neg }],
//         fmt(v), tip(i) → title of the bucket, tick(i) → show this x label, height }
export function drawChart(el, spec) {
  if (!el) return;
  charts.set(el.id, spec);
  const W = Math.max(240, Math.floor(el.clientWidth || 300));
  const H = spec.height || (W < 420 ? 150 : 180);
  const fmt = spec.fmt || shortNum;
  const n = spec.labels.length;
  const all = spec.series.flatMap((s) => s.values.map((v) => (s.neg ? -(v || 0) : v || 0)));
  let max = Math.max(0, ...all), min = Math.min(0, ...all);
  // counts never get a half tick (two «1» labels on a chart with one signup)
  const step = Math.max(spec.int === false ? 0 : 1, niceStep(Math.max(max, -min) || 1, max > 0 && min < 0 ? 2 : 3));
  max = max > 0 ? Math.ceil(max / step) * step : min < 0 ? 0 : step;
  min = min < 0 ? Math.floor(min / step) * step : 0;
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  const padL = Math.max(26, ...ticks.map((v) => fmt(v).length * 6.6 + 10)), padR = 6, padT = 10, padB = 22;
  const pw = W - padL - padR, ph = H - padT - padB;
  const y = (v) => padT + ph * (1 - (v - min) / (max - min || 1));
  const band = pw / Math.max(1, n);
  const x0 = (i) => padL + i * band;
  const parts = [];
  for (const v of ticks) parts.push(`<line class="${v === 0 ? 'zero' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="yl" x="${padL - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`);
  // x labels counted back from the newest bucket, so the last one never collides with its neighbour
  const every = Math.ceil(n / Math.max(2, Math.floor(pw / 46)));
  const tick = spec.tick || ((i) => (n - 1 - i) % every === 0);
  spec.labels.forEach((l, i) => {
    if (tick(i)) parts.push(`<text class="xl" x="${(x0(i) + band / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${l}</text>`);
  });
  const bw = Math.max(1, band - 2);
  for (const s of spec.series) {
    if (s.kind === 'line') {
      let d = '', pen = false, last = null;
      s.values.forEach((v, i) => {
        if (v == null) return (pen = false);
        d += `${pen ? 'L' : 'M'}${(x0(i) + band / 2).toFixed(1)} ${y(v).toFixed(1)}`;
        pen = true;
        last = i;
      });
      if (d) parts.push(`<path class="ln ${s.tone || 'accent'}" d="${d}"/>`);
      if (last != null && s.dot !== false) parts.push(`<circle class="dt ${s.tone || 'accent'}" cx="${(x0(last) + band / 2).toFixed(1)}" cy="${y(s.values[last]).toFixed(1)}" r="3.5"/>`);
      continue;
    }
    s.values.forEach((v0, i) => {
      if (v0 == null || !v0) return;
      const v = s.neg ? -v0 : v0;
      const top = y(Math.max(v, 0)), bot = y(Math.min(v, 0)), h = Math.max(1, bot - top);
      const r = Math.min(4, bw / 2, h);
      const x = x0(i) + 1;
      // rounded only at the data end (away from zero)
      const p = v >= 0
        ? `M${x} ${(top + h).toFixed(1)}V${(top + r).toFixed(1)}Q${x} ${top.toFixed(1)} ${(x + r).toFixed(1)} ${top.toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)} ${top.toFixed(1)} ${(x + bw).toFixed(1)} ${(top + r).toFixed(1)}V${(top + h).toFixed(1)}Z`
        : `M${x} ${top.toFixed(1)}V${(top + h - r).toFixed(1)}Q${x} ${(top + h).toFixed(1)} ${(x + r).toFixed(1)} ${(top + h).toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)} ${(top + h).toFixed(1)} ${(x + bw).toFixed(1)} ${(top + h - r).toFixed(1)}V${top.toFixed(1)}Z`;
      parts.push(`<path class="br ${s.tone || 'accent'}" d="${p}"/>`);
    });
  }
  // hover targets: the whole column, taller than the mark
  for (let i = 0; i < n; i++) parts.push(`<rect class="hit" data-i="${i}" x="${x0(i).toFixed(1)}" y="${padT}" width="${band.toFixed(1)}" height="${ph}"/>`);
  const label = spec.series.map((s) => s.name).filter(Boolean).join(', ');
  el.innerHTML = `<svg class="pcsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${parts.join('')}<rect class="hl" x="0" y="${padT}" width="${band.toFixed(1)}" height="${ph}" visibility="hidden"/></svg>`;
  const svg = el.firstChild;
  const hl = svg.querySelector('.hl');
  svg.onmousemove = (e) => {
    const r = e.target.closest?.('.hit');
    if (!r) return hideTip(hl);
    const i = Number(r.dataset.i);
    hl.setAttribute('x', r.getAttribute('x'));
    hl.setAttribute('visibility', 'visible');
    const rows = spec.series.map((s) => `<div><i class="sw ${s.tone || 'accent'}"></i>${s.name ? `${s.name}: ` : ''}<b>${s.values[i] == null ? '—' : (s.tipFmt || fmt)(s.values[i])}</b></div>`).join('');
    showTip(`<div class="tt">${spec.tip ? spec.tip(i) : spec.labels[i]}</div>${rows}`, e.clientX, e.clientY);
  };
  svg.onmouseleave = () => hideTip(hl);
}
function showTip(html, x, y) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'pctip';
    document.body.append(tipEl);
  }
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x + 14))}px`;
  tipEl.style.top = `${Math.max(8, y - h - 12)}px`;
}
export const hideChartTip = () => hideTip();
function hideTip(hl) {
  if (tipEl) tipEl.hidden = true;
  hl?.setAttribute('visibility', 'hidden');
}
let resizeT;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      for (const [id, spec] of charts) {
        const el = document.getElementById(id);
        if (el) drawChart(el, spec);
        else charts.delete(id);
      }
    }, 120);
  });
}
const legend = (items) => `<div class="legend">${items.map(([tone, t]) => `<span><i class="sw ${tone}"></i>${t}</span>`).join('')}</div>`;
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const dayL = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

// ---------- «Живий дашборд» ----------
export function livePanels(L, { esc, short, ago, userLink, days }) {
  const C = L.cmp, T = C.today, Y = C.yesterday, YN = C.yesterdayByNow;
  // Today vs yesterday up to this hour where the rows carry a time; the arrow is the change.
  const delta = (a, b) => {
    if (b == null) return '';
    if (!b) return a ? '<span class="dl up">▲ нове</span>' : '';
    const p = Math.round(((a - b) / b) * 100);
    return p ? `<span class="dl ${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}%</span>` : '<span class="dl">= як учора</span>';
  };
  const card = (label, v, yv, yn, fmt = (x) => x, note = '') => `<div class="stat"><span>${label}</span><b>${fmt(v)}</b>
    <small>учора ${fmt(yv)}${yn != null ? ` · до цієї години ${fmt(yn)}` : ''} ${delta(v, yn ?? yv)}</small>${note ? `<small>${note}</small>` : ''}</div>`;
  const cards = `<div class="cards lv-cards">
      <div class="stat live"><span>Онлайн зараз</span><b>${L.online.n}</b><small>за ${L.online.windowMin} хв · за 5 хв: ${L.online.n5}</small></div>
      ${card('Нові гравці', T.newUsers, Y.newUsers, YN.newUsers)}
      ${card('Активні сьогодні', T.active, Y.active, L.hoursSince ? YN.active : null)}
      ${card('Відкрито кейсів', T.opens, Y.opens, YN.opens, (x) => x.toLocaleString('uk-UA'))}
      ${card('Зірки', T.stars, Y.stars, YN.stars, (x) => `⭐ ${x}`, `платежів: ${T.payments} (учора ${Y.payments})`)}
      <div class="stat flow2"><span>Гривні ₴: створено / вилучено</span><b>+${shortNum(T.created)} / ${shortNum(-T.destroyed)}</b>
        <small>учора +${short(Y.created)} / −${short(Y.destroyed)} · чисто ${T.created - T.destroyed >= 0 ? '+' : '−'}${short(Math.abs(T.created - T.destroyed))}</small></div>
    </div>`;
  const who = L.online.list.length ? `<div class="tbl-wrap"><table class="stack lv-who"><tr><th>Гравець</th><th class="num">Рів.</th><th class="num">Гривні</th><th class="num">Гараж</th><th>Був</th></tr>
      ${L.online.list.map((u) => `<tr class="click" data-user="${u.id}"><td class="ttl"><b>${esc(u.name)}</b>${u.banned ? ' <span class="badge red">бан</span>' : ''} <span class="muted small">${u.id}</span></td><td class="num">${u.level}</td>
        <td class="num">${short(u.balance)}</td><td class="num">${short(u.value)}</td><td class="small muted">${ago(u.lastSeen)}</td></tr>`).join('')}</table></div>`
    : '<div class="empty">Зараз у грі нікого</div>';
  return {
    cards,
    who: `<h2>${'Хто грає'} <span class="sub">${L.online.n} за ${L.online.windowMin} хв</span></h2>${who}`,
    stamp: `оновлено ${new Date(L.now).toLocaleTimeString('uk-UA')}`,
    note: L.hoursSince ? '' : '<div class="small muted">«Активні по годинах» записуються з цього оновлення — вчорашні години з’являться завтра.</div>',
    days,
  };
}
// Hourly and daily charts for the dashboard (ids are fixed so a refresh redraws the same boxes).
export function liveCharts(L, D) {
  const h = L.hours, cut = (a) => a.map((v, i) => (i <= L.hourNow ? v : null));
  const hourTip = (i) => `${HOURS[i]}:00–${HOURS[(i + 1) % 24]}:00${i === L.hourNow ? ' (зараз)' : ''}`;
  const hourly = (key, fmt) => ({
    labels: HOURS, tick: (i) => i % 3 === 0, tip: hourTip, fmt,
    series: [{ name: 'сьогодні', values: cut(h.today[key]), tone: 'accent' }, { name: 'учора', values: h.yesterday[key], kind: 'line', tone: 'context', dot: false }],
  });
  drawChart(document.getElementById('lvH1'), hourly('signups'));
  drawChart(document.getElementById('lvH2'), hourly('active'));
  drawChart(document.getElementById('lvH3'), hourly('opens'));
  drawChart(document.getElementById('lvH4'), hourly('stars'));
  if (D) {
    const lab = D.map((d) => dayL(d.day));
    const daily = (key, name) => ({ labels: lab, tip: (i) => dayL(D[i].day), series: [{ name, values: D.map((d) => d[key]), tone: 'accent' }] });
    drawChart(document.getElementById('lvD1'), daily('newUsers', 'нові'));
    drawChart(document.getElementById('lvD2'), daily('dau', 'активні'));
    drawChart(document.getElementById('lvD3'), daily('cases', 'кейси'));
    drawChart(document.getElementById('lvD4'), daily('stars', 'зірки'));
  }
}
export function liveSkeleton(P, { ic, days }) {
  const box = (id, title) => `<div class="panel"><h2>${title}</h2><div class="pcchart" id="${id}"></div></div>`;
  return `<div class="head"><h1>Живий дашборд</h1><span class="badge green lv-pulse" id="lvStamp">${P.stamp}</span>
      <button class="btn ghost sm" data-act="lvPause" id="lvPause">${ic('clock')} Пауза</button>
      <button class="btn ghost sm" data-act="lvNow">${ic('refresh')} Оновити</button></div>
    <div id="lvCards">${P.cards}</div>
    <div class="lv-grid">
      <div class="lv-charts">
        <h2 class="section">Сьогодні по годинах <span class="muted small">(за Києвом)</span></h2>
        ${legend([['accent', 'сьогодні'], ['context', 'учора']])}
        <div id="lvNote">${P.note}</div>
        <div class="grid2 pc-g">${box('lvH1', 'Нові гравці')}${box('lvH2', 'Активні гравці')}${box('lvH3', 'Відкриття кейсів')}${box('lvH4', 'Зірки ⭐')}</div>
        <div class="row between"><h2 class="section">По днях</h2><div class="seg">${[14, 30].map((n) => `<button class="${days === n ? 'on' : ''}" data-act="lvDays" data-n="${n}">${n} дн</button>`).join('')}</div></div>
        <div class="grid2 pc-g">${box('lvD1', 'Нові гравці')}${box('lvD2', 'Активні (DAU)')}${box('lvD3', 'Відкрито кейсів')}${box('lvD4', 'Зірки ⭐')}</div>
      </div>
      <div class="panel lv-side" id="lvWho">${P.who}</div>
    </div>`;
}

// ---------- the wide player card: money by day, «Підозріле» ----------
export function playerMoney(X, { short }) {
  if (!X) return '';
  const D = X.days, has = (k) => D.some((d) => d[k]);
  const signed = (v) => (v ? `${v > 0 ? '+' : '−'}${short(Math.abs(v))}` : '·');
  const cell = (v, f = short) => `<td class="num${v ? '' : ' muted'}">${v ? f(v) : '·'}</td>`;
  const rows = [...D].reverse().map((d) => `<tr><td>${dayL(d.day)}</td>${cell(d.opens, String)}${cell(d.spent)}${cell(d.dropValue)}${cell(d.dropSale)}
    ${has('sold') ? cell(d.sold, (n) => `${n} · ≈${short(d.soldValue)}`) : ''}${has('stars') ? cell(d.stars, (n) => `⭐${n} → ${short(d.starsAmount)}`) : ''}${has('admin') ? `<td class="num">${signed(d.admin)}</td>` : ''}
    ${has('carsIn') || has('carsOut') ? `<td class="num">${d.carsIn || d.carsOut ? `+${d.carsIn} / −${d.carsOut}` : '<span class="muted">·</span>'}</td>` : ''}<td class="num">${d.balance == null ? '<span class="muted">—</span>' : short(d.balance)}</td></tr>`).join('');
  return `<div class="tbl-wrap"><table class="pmoney"><tr><th>День</th><th class="num">Кейсів</th><th class="num">Витрачено*</th><th class="num">Випало на</th><th class="num">Продаж одразу</th>
      ${has('sold') ? '<th class="num">Продав дилеру</th>' : ''}${has('stars') ? '<th class="num">За зірки</th>' : ''}${has('admin') ? '<th class="num">Адмін ±</th>' : ''}${has('carsIn') || has('carsOut') ? '<th class="num">Авто від / до гравців</th>' : ''}<th class="num">Гривні на кінець дня</th></tr>${rows}</table></div>
    <div class="small muted mt">* за ціною кейса (знижка «кейс дня» і ключі не враховані). «Продав дилеру» — оцінка за класом, бо ціна продажу не зберігається. Баланс на кінець дня — з погодинних знімків${X.snapSince ? ` (ведуться з ${new Date(X.snapSince).toLocaleDateString('uk-UA')})` : ' (ще не почались)'}.</div>`;
}
export function playerSuspicious(X, { esc }) {
  if (!X) return '';
  const list = X.suspicious || [];
  if (!list.length) return '<div class="sus-ok"><span class="badge green">чисто</span> <span class="small muted">Жоден простий сигнал не спрацював (пачки акаунтів, машини чи гривні одному гравцю, стрибок балансу, темп відкриттів, нарахування адмінів).</span></div>';
  return `<div class="sus">${list.map((s) => `<div class="sus-i ${s.level}"><b>${esc(s.title)}</b><div class="small">${esc(s.text)}</div>
    ${s.users?.length ? `<div class="small sus-u">${s.users.map((u) => `<a data-user="${u.id}">${esc(u.name)}</a>`).join(' · ')}</div>` : ''}</div>`).join('')}
    <div class="small muted">Це лише сигнали для перевірки, не вирок.</div></div>`;
}

// ---------- «Економіка й кейси» ----------
export async function economyPage({ api, esc, ic, short, money, userLink, win, grow }) {
  const E = await api('pc/economy', { window: win, grow });
  economyPage.last = E;
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  // A real return far from the theory (±15 points) with enough opens to mean something.
  const off = (real, th, n) => (real != null && th != null && n >= 50 && Math.abs(real - th) >= 0.15 ? (real > th ? 'hot' : 'cold') : '');
  const tot = E.cases.reduce((a, c) => ({ opens: a.opens + c.opens, spent: a.spent + c.spent, value: a.value + c.value, sale: a.sale + c.sale, red: a.red + c.red }), { opens: 0, spent: 0, value: 0, sale: 0, red: 0 });
  const caseRows = E.cases.map((c) => `<tr><td class="ttl"><b>${esc(c.name)}</b> <span class="muted small">${c.kind === 'parts' ? 'деталі' : c.kind === 'country' ? 'країна' : ''} ${c.price ? short(c.price) : ''}</span></td>
      <td class="num">${c.opens.toLocaleString('uk-UA')}</td><td class="num">${short(c.spent)}</td><td class="num">${short(c.value)}</td><td class="num">${short(c.sale)}</td>
      <td class="num ${off(c.ret, c.evRet, c.opens)}">${pct(c.ret)} <span class="muted small">/ ${pct(c.evRet)}</span></td>
      <td class="num ${off(c.retSale, c.sellRet, c.opens)}">${pct(c.retSale)} <span class="muted small">/ ${pct(c.sellRet)}</span></td>
      <td class="num">${c.red ? `<b class="red-s">${c.red}</b>` : '<span class="muted">0</span>'}</td></tr>`).join('');
  const A = E.anomalies;
  const uList = (list, val, empty) => (list.length ? `<ol class="top">${list.slice(0, 15).map((u) => `<li data-user="${u.id}"><span class="nm">${esc(u.name)}${u.banned ? ' <span class="badge red">бан</span>' : ''}</span><b>${val(u)}</b></li>`).join('')}</ol>${list.length > 15 ? `<div class="small muted">і ще ${list.length - 15}</div>` : ''}` : `<div class="empty small">${empty}</div>`);
  const groups = E.src.groups.slice().sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return `<div class="head"><h1>Економіка й кейси</h1>
      <div class="seg">${[['24h', '24 год'], ['7d', '7 дн'], ['30d', '30 дн']].map(([k, t]) => `<button class="${E.window === k ? 'on' : ''}" data-act="ecWin" data-k="${k}">${t}</button>`).join('')}</div>
      <button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    <div class="cards">
      <div class="stat"><span>Гривень у гравців</span><b>${short(E.supply.balance)}</b><small>${E.supply.players} гравців · в середньому ${short(E.supply.players ? E.supply.balance / E.supply.players : 0)}</small></div>
      <div class="stat"><span>Вартість усіх гаражів</span><b>${short(E.supply.value)}</b><small>разом зі статками: ${short(E.supply.value + E.supply.balance)}</small></div>
      <div class="stat"><span>Створено / вилучено за вікно, ₴</span><b>+${shortNum(E.src.total.created)} / ${shortNum(-E.src.total.destroyed)}</b><small>чисто ${E.src.total.created - E.src.total.destroyed >= 0 ? '+' : '−'}${short(Math.abs(E.src.total.created - E.src.total.destroyed))} (за повні дні з ${dayL(E.caseSrc.since)})</small></div>
      <div class="stat"><span>Кейси за вікно</span><b>${tot.opens.toLocaleString('uk-UA')}</b><small>за ціною ${short(tot.spent)} · фактично списано ${short(E.caseSrc.spent)}</small></div>
      <div class="stat"><span>Віддача всіх кейсів</span><b>${pct(tot.spent ? tot.value / tot.spent : null)}</b><small>продаж одразу ${pct(tot.spent ? tot.sale / tot.spent : null)} · червоних ${tot.red}</small></div>
    </div>
    <div class="panel"><h2>Кейси <span class="sub">реальна віддача / теоретична (S.CASE_BY_ID ev, sellEv)</span></h2>
      ${E.cases.length ? `<div class="tbl-wrap"><table class="stack eco-cases"><tr><th>Кейс</th><th class="num">Відкрито</th><th class="num">Витрачено*</th><th class="num">Випало на</th><th class="num">Продаж одразу</th><th class="num">Віддача</th><th class="num">Віддача продажу</th><th class="num">Червоні (S)</th></tr>${caseRows}
        <tr class="avg"><td>Усього</td><td class="num">${tot.opens.toLocaleString('uk-UA')}</td><td class="num">${short(tot.spent)}</td><td class="num">${short(tot.value)}</td><td class="num">${short(tot.sale)}</td><td class="num">${pct(tot.spent ? tot.value / tot.spent : null)}</td><td class="num">${pct(tot.spent ? tot.sale / tot.spent : null)}</td><td class="num">${tot.red}</td></tr></table></div>`
      : '<div class="empty">За це вікно кейсів не відкривали</div>'}
      <div class="small muted mt">* кількість × ціна кейса; «кейс дня», ключі й батли не враховані — фактичне списання за «case/open» вище в картці. «Випало на» — ціна моделей (деталей), «продаж одразу» — що дав би дилер за кожен дроп з урахуванням частки кейса. <span class="hotk">Жовтим</span> — віддача на 15+ пунктів вища за теорію, <span class="coldk">синім</span> — нижча (від 50 відкриттів).</div></div>
    <div class="grid2 pc-g">
      <div class="panel"><h2>Гривні по днях <span class="sub">30 днів, створено вгору, вилучено вниз</span></h2>
        ${legend([['made', 'створено'], ['gone', 'вилучено']])}<div class="pcchart" id="ecFlow"></div></div>
      <div class="panel"><h2>Звідки гроші <span class="sub">за вікно</span></h2>${groups.length ? `<div class="tbl-wrap"><table><tr><th>Джерело</th><th class="num">Створено</th><th class="num">Вилучено</th><th class="num">Різниця</th></tr>
        ${groups.map((g) => `<tr><td>${esc(g.name)}<div class="muted small">${g.top.map(esc).join(', ')}</div></td><td class="num">${g.created ? '+' + short(g.created) : '—'}</td><td class="num">${g.destroyed ? '−' + short(g.destroyed) : '—'}</td><td class="num"><b>${g.net >= 0 ? '+' : '−'}${short(Math.abs(g.net))}</b></td></tr>`).join('')}</table></div>` : '<div class="empty">Ще немає записів</div>'}</div>
    </div>
    <div class="grid2 pc-g">
      <div class="panel"><h2>Топ-20 за статками <span class="sub">гривні + гараж</span></h2>
        <div class="tbl-wrap"><table class="stack"><tr><th>Гравець</th><th class="num">Рів.</th><th class="num">Гривні</th><th class="num">Гараж</th><th class="num">Разом</th></tr>
        ${E.rich.map((u, i) => `<tr class="click" data-user="${u.id}"><td class="ttl"><span class="muted">${i + 1}.</span> <b>${esc(u.name)}</b>${u.banned ? ' <span class="badge red">бан</span>' : ''}</td><td class="num">${u.level}</td><td class="num">${short(u.balance)}</td><td class="num">${short(u.value)}</td><td class="num"><b>${short(u.balance + u.value)}</b></td></tr>`).join('')}</table></div></div>
      <div class="panel"><h2>Аномалії за 24 год</h2>
        <form class="row" id="ecGrow" style="margin-bottom:10px"><label class="small muted" for="ecGrowIn">Поріг X, ₴</label><input id="ecGrowIn" inputmode="numeric" value="${E.growMin}" style="width:140px"><button class="btn ghost sm">Застосувати</button></form>
        <div class="ano">
          <div><h3>Баланс виріс більше ніж на ${short(E.growMin)}</h3>${A.snapSince ? uList(A.grew, (u) => `+${short(u.grow)}`, 'Нікого') : '<div class="empty small">Знімки балансу ще не почались — з’являться за добу після оновлення</div>'}</div>
          <div><h3>Нові (до 3 днів) зі статком від ${short(E.growMin)}</h3>${uList(A.fresh, (u) => short(u.balance + u.value), 'Нікого')}</div>
          <div><h3>500+ відкриттів за добу</h3>${uList(A.openers, (u) => `${u.n} дропів`, 'Нікого')}</div>
          <div><h3>Отримали 5+ машин від інших</h3>${uList(A.receivers, (u) => `${u.n} авто від ${u.from}`, 'Нікого')}</div>
          <div><h3>Нарахування адмінів від ${short(E.growMin / 5)}</h3>${uList(A.granted, (u) => `${u.amount >= 0 ? '+' : '−'}${short(Math.abs(u.amount))}`, 'Нікого')}</div>
        </div>${A.snapSince ? `<div class="small muted">Знімки балансу щогодини, з ${new Date(A.snapSince).toLocaleString('uk-UA')}.</div>` : ''}</div>
    </div>`;
}
export function economyCharts(E = economyPage.last) {
  const D = E?.flowDays;
  if (!D?.length) return;
  drawChart(document.getElementById('ecFlow'), {
    labels: D.map((d) => dayL(d.day)), tip: (i) => dayL(D[i].day),
    series: [{ name: 'створено', values: D.map((d) => d.created), tone: 'made' }, { name: 'вилучено', values: D.map((d) => d.destroyed), tone: 'gone', neg: true }],
  });
}

// ---------- «Перегляд бази» ----------
const OPS = [['has', 'містить'], ['eq', '='], ['ne', '≠'], ['gt', '>'], ['lt', '<'], ['ge', '≥'], ['le', '≤'], ['null', 'порожньо'], ['notnull', 'не порожньо']];
const PLAYER_COLS = /^(user_id|owner_id|seller_id|buyer_id|from_uid|to_uid|from_id|to_id|creator_id|opponent_id|winner_id|referrer_id|host_id|guest_id|invited_id|top_bidder|target|viewer_id|a_uid|b_uid)$/;
const TIME_COLS = /(_at|^at|_until|^until|^start|^end|ends_at|last_seen|created|updated)$/;
export function dbPage(T, R, V, { esc, date }) {
  const list = T.tables.filter((t) => !V.q || t.name.includes(V.q.toLowerCase()));
  const side = `<div class="panel db-side"><input id="dbQ" type="search" placeholder="Таблиця…" value="${esc(V.q || '')}" autocomplete="off">
    <select id="dbSel" class="db-sel">${T.tables.map((t) => `<option value="${esc(t.name)}" ${t.name === V.table ? 'selected' : ''}>${esc(t.name)} (${t.rows})</option>`).join('')}</select>
    <div class="db-list">${list.map((t) => `<button class="${t.name === V.table ? 'on' : ''}" data-act="dbTable" data-t="${esc(t.name)}"><span>${esc(t.name)}</span><b>${t.rows.toLocaleString('uk-UA')}</b></button>`).join('') || '<div class="empty small">Нічого</div>'}</div></div>`;
  if (!R) return `<div class="head"><h1>Перегляд бази</h1></div><div class="db-grid">${side}<div class="panel"><div class="empty">Вибери таблицю зліва</div></div></div>`;
  const cols = R.cols;
  const open = cols.filter((c) => !c.hidden && !c.masked);
  const hidden = cols.filter((c) => c.hidden || c.masked);
  const filt = V.filters.map((f) => dbFilterRow(open, f, esc)).join('');
  const cell = (c, v) => {
    if (v == null) return '<td class="muted">NULL</td>';
    if (v === '•••') return '<td class="muted" title="Приховано">•••</td>';
    const s = String(v);
    const link = PLAYER_COLS.test(c.name) || (R.table === 'users' && c.name === 'id');
    const time = typeof v === 'number' && v > 1e12 && v < 4e12 && TIME_COLS.test(c.name);
    const short = s.length > 80 ? s.slice(0, 80) + '…' : s;
    return `<td class="${typeof v === 'number' ? 'num' : ''}"${s.length > 80 ? ` title="${esc(s.slice(0, 2000))}"` : ''}>${link && Number(v) > 0 ? `<a data-user="${esc(s)}">${esc(s)}</a>` : esc(short)}${time ? `<div class="muted small">${date(v)}</div>` : ''}</td>`;
  };
  const head = cols.map((c) => {
    const can = !c.hidden && !c.masked, on = V.sort === c.name;
    return `<th class="${on ? 'on' : ''}">${can ? `<a data-act="dbSort" data-c="${esc(c.name)}">${esc(c.name)}${on ? (V.dir === 'asc' ? ' ▲' : ' ▼') : ''}</a>` : `<span title="Приховано: секрет або живі дані">${esc(c.name)} 🔒</span>`}</th>`;
  }).join('');
  const tot = R.total, from = R.offset + 1, to = R.offset + R.rows.length;
  return `<div class="head"><h1>Перегляд бази</h1><span class="badge">лише читання · кожен перегляд у журналі дій</span></div>
    <div class="db-grid">${side}
      <div class="db-main">
        <div class="panel"><h2>${esc(R.table)} <span class="sub">${tot.n.toLocaleString('uk-UA')}${tot.capped ? '+' : ''} рядків${V.filters.length ? ' за фільтром' : ''}</span></h2>
          <form id="dbForm" class="db-filters"><div class="db-flist">${filt}</div><div class="small muted db-none">Без фільтрів — додай умову або клікни на назву колонки, щоб сортувати.</div>
            <div class="row"><button type="button" class="btn ghost sm" data-act="dbFAdd">+ Фільтр</button><button class="btn sm">Показати</button>
              ${V.filters.length || V.sort ? '<button type="button" class="btn ghost sm" data-act="dbReset">Скинути</button>' : ''}
              <button type="button" class="btn ghost sm" data-act="dbExport" style="margin-left:auto">Експорт CSV</button></div></form>
          ${hidden.length ? `<div class="small muted mt">🔒 Приховано: ${hidden.map((c) => esc(c.name)).join(', ')} — секрети (сіди, хеші) або дані живих ігор/лотів.</div>` : ''}</div>
        <div class="panel db-rows">${R.rows.length ? `<div class="tbl-wrap"><table class="db-t"><tr>${head}</tr>${R.rows.map((r) => `<tr>${cols.map((c) => cell(c, r[c.name])).join('')}</tr>`).join('')}</table></div>
          <div class="pager"><span class="muted small">${from}–${to} з ${tot.n.toLocaleString('uk-UA')}${tot.capped ? '+' : ''}</span>
            <button class="btn ghost sm" data-act="dbPage" data-o="${Math.max(0, R.offset - R.pageSize)}" ${R.offset ? '' : 'disabled'}>‹ Назад</button>
            <button class="btn ghost sm" data-act="dbPage" data-o="${R.offset + R.pageSize}" ${R.rows.length < R.pageSize ? 'disabled' : ''}>Далі ›</button></div>` : '<div class="empty">Рядків немає</div>'}</div>
      </div></div>`;
}
// One filter row: column (only the open ones), condition, value; × removes it without a round trip.
export function dbFilterRow(open, f, esc) {
  return `<div class="db-f">
      <select class="dfc" aria-label="Колонка">${open.map((c) => `<option ${c.name === f.col ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="dfo" aria-label="Умова">${OPS.map(([k, t]) => `<option value="${k}" ${k === f.op ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input class="dfv" value="${esc(f.value ?? '')}" placeholder="значення" aria-label="Значення" ${f.op === 'null' || f.op === 'notnull' ? 'disabled' : ''}>
      <button type="button" class="btn ghost sm sq" data-act="dbFDel" aria-label="Прибрати фільтр">×</button></div>`;
}
// The filter rows as they stand in the form (read before any re-render, so typing isn't lost).
export function readFilters(root) {
  return [...root.querySelectorAll('.db-f')].map((r) => ({ col: r.querySelector('.dfc').value, op: r.querySelector('.dfo').value, value: r.querySelector('.dfv').value }));
}

// ---------- installing the panel as an app (Chrome / Edge on a computer) ----------
// admin-sw.js only makes the panel installable (network first, the API never cached); its scope is the panel page.
export function setupInstall(btn) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('admin-sw.js', { scope: './admin.html' }).catch(() => {});
  let ev = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    ev = e;
    if (btn) btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => btn && (btn.hidden = true));
  btn?.addEventListener('click', async () => {
    if (!ev) return;
    ev.prompt();
    await ev.userChoice.catch(() => null);
    ev = null;
    btn.hidden = true;
  });
}
