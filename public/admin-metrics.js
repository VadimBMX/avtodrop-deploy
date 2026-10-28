// Admin «Метрики»: retention by signup day, activity, the first-session funnel, where players come from and money by
// source (server: adminMetrics in src/game.js, arithmetic in src/metrics.js). Plain tables and small inline SVG
// sparklines; every number is also in a table, the sparkline tips repeat the values on hover.

const PCT_FULL = 0.5; // a retention cell is fully tinted at 50% and above

// 0.347 → "35%", 0.034 → "3,4%", null → "—".
export function pct(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  const v = x * 100;
  return (v > 0 && v < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v))) + '%';
}
const num1 = (x) => (x == null ? '—' : x.toFixed(1).replace('.', ','));
const dayLabel = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
// Minutes since signup → "12 хв" / "3 год 5 хв" / "2,5 дн".
export function since(min) {
  if (min == null) return '—';
  if (min < 60) return `${Math.max(1, Math.round(min))} хв`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} год${Math.round(min % 60) ? ` ${Math.round(min % 60)} хв` : ''}`;
  return `${(min / 1440).toFixed(1).replace('.', ',')} дн`;
}

// One series as a 2px line with an end dot; null values break the line. `zero` keeps 0 inside the range and draws its
// hairline (for values that go both ways). Each day has an invisible column whose <title> is the tip.
export function spark(values, { days = [], fmt = String, w = 132, h = 30, zero = false, esc = String } = {}) {
  const nums = values.filter((v) => v != null);
  if (!nums.length) return '<span class="muted small">—</span>';
  let min = Math.min(...nums), max = Math.max(...nums);
  if (zero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (max === min) max = min + 1;
  const n = values.length, pad = 4;
  const x = (i) => (n === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (v) => pad + (h - 2 * pad) * (1 - (v - min) / (max - min));
  let d = '', pen = false, last = -1;
  values.forEach((v, i) => {
    if (v == null) return (pen = false);
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
    last = i;
  });
  const zl = zero && min < 0 && max > 0 ? `<line class="zero" x1="0" x2="${w}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>` : '';
  const colW = w / n;
  const tips = values.map((v, i) => `<rect x="${(i * colW).toFixed(1)}" y="0" width="${colW.toFixed(1)}" height="${h}"><title>${esc(`${days[i] ? dayLabel(days[i]) + ': ' : ''}${v == null ? '—' : fmt(v)}`)}</title></rect>`).join('');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`останнє: ${fmt(values[last])}`)}">${zl}
    <path d="${d}"/><circle cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="3.5"/><g class="hit">${tips}</g></svg>`;
}

// «Мітки посилань» (m.tags, src/metrics.js startTags): new players per day by the raw start parameter. A 7/30-day switch
// without a round trip (two radio inputs + CSS), a small link maker for tagged links.
export const BOT_LINK = 'https://t.me/avtodrop2026_bot?start=';
const TAG_OK = /^[A-Za-z0-9_]{1,64}$/;
export function tagLink(tag) {
  const t = String(tag || '').trim();
  return TAG_OK.test(t) ? BOT_LINK + t : null;
}
export function tagsPanel(T, { esc }) {
  if (!T) return '';
  const name = (t) => (t.tag === '' ? '<span class="muted">без мітки</span>' : t.tag === '*' ? '<span class="muted">інші</span>' : `<code>${esc(t.tag)}</code>`);
  const note = (t) => (t.note ? `<div class="muted small mtag-note">${esc(t.note)}</div>` : '');
  const d7 = T.days.slice(-7);
  const total = (k) => T.tags.reduce((a, t) => a + t[k], 0);
  const rows7 = T.tags.filter((t) => t.d7).map((t) => `<tr><td>${name(t)}${note(t)}</td>${t.byDay.slice(-7).map((n) => `<td class="num${n ? '' : ' muted'}">${n || '·'}</td>`).join('')}<td class="num"><b>${t.d7}</b></td></tr>`).join('');
  const sum7 = d7.map((_, i) => T.tags.reduce((a, t) => a + t.byDay[t.byDay.length - 7 + i], 0));
  const rows30 = T.tags.map((t) => `<tr><td>${name(t)}${note(t)}</td><td class="hide-m">${spark(t.byDay, { days: T.days, fmt: String, esc, w: 180, h: 26 })}</td><td class="num">${t.d7}</td><td class="num"><b>${t.d30}</b></td></tr>`).join('');
  return `<div class="panel mtags"><h2>Мітки посилань <span class="sub">нові гравці за параметром старту</span></h2>
      <input type="radio" name="mtagw" id="mtag7" checked><input type="radio" name="mtagw" id="mtag30">
      <div class="seg mtag-seg"><label for="mtag7">7 дн</label><label for="mtag30">30 дн</label></div>
      <div class="mtag-7">${rows7 ? `<div class="tbl-wrap"><table><tr><th>Мітка</th>${d7.map((d) => `<th class="num">${dayLabel(d)}</th>`).join('')}<th class="num">Разом</th></tr>${rows7}
        <tr class="avg"><td>Усього</td>${sum7.map((n) => `<td class="num">${n}</td>`).join('')}<td class="num"><b>${total('d7')}</b></td></tr></table></div>` : '<div class="empty">За 7 днів нових гравців немає</div>'}</div>
      <div class="mtag-30">${T.tags.length ? `<div class="tbl-wrap"><table><tr><th>Мітка</th><th class="hide-m">По днях</th><th class="num">7 дн</th><th class="num">30 дн</th></tr>${rows30}
        <tr class="avg"><td>Усього</td><td class="hide-m"></td><td class="num">${total('d7')}</td><td class="num"><b>${total('d30')}</b></td></tr></table></div>` : '<div class="empty">За 30 днів нових гравців немає</div>'}</div>
      <div class="small muted mt">Як зробити посилання з міткою: <code class="mtag-link">${BOT_LINK}&lt;мітка&gt;</code> — мітка лише з латинських літер, цифр і <code>_</code> (до 64 знаків), напр. <code>tiktok</code>, <code>insta_gavr</code>, <code>tiktok_okt2</code>. Своя мітка на кожне джерело/рекламу — і тут видно, скільки людей вона привела. Рахується лише перший вхід гравця.</div>
      <div class="row mt" style="gap:8px;flex-wrap:wrap;align-items:center"><input id="mtagIn" placeholder="мітка, напр. insta_gavr" maxlength="64" style="width:200px"><code id="mtagOut" class="small muted mtag-link">${BOT_LINK}…</code></div></div>`;
}
if (typeof document !== 'undefined') {
  document.addEventListener('input', (e) => {
    if (e.target?.id !== 'mtagIn') return;
    const out = document.getElementById('mtagOut'), v = e.target.value.trim(), link = tagLink(v);
    out.textContent = !v ? BOT_LINK + '…' : link || 'лише латиниця, цифри й _';
    out.classList.toggle('bad', !!v && !link);
    out.classList.toggle('muted', !v);
  });
}

export async function metricsPage({ api, esc, ic, short, days }) {
  const m = await api('metrics', { days });
  const R = m.retention, F = m.funnel, s = m.series, last = s[s.length - 1];
  const sum = (k) => s.reduce((a, x) => a + x[k], 0);
  const goal = (value, target) => (value == null ? '' : value >= target
    ? `<span class="badge green">${ic('check')} ціль ${pct(target)}</span>`
    : `<span class="badge red">${ic('arrow-right')} ціль ${pct(target)}</span>`);
  const stat = (label, value, sub, badge = '') => `<div class="stat"><span>${label}</span><b>${value}</b><small>${sub}</small>${badge ? `<div class="goal">${badge}</div>` : ''}</div>`;
  const l4 = F.levels.find((l) => l.level === 4);
  const sessDays = s.filter((x) => x.sessions != null);
  const sessAvg = sessDays.length ? sessDays.reduce((a, x) => a + x.sessions, 0) / sessDays.length : null;

  // ---- cohorts
  const cell = (c) => {
    if (!c) return '<td class="num muted" title="ще не настав">·</td>';
    if (c.pct == null) return '<td class="num muted">—</td>';
    return `<td class="num heat${c.partial ? ' partial' : ''}" style="--p:${Math.min(1, c.pct / PCT_FULL).toFixed(3)}" title="${c.n} гравців${c.partial ? ' · день ще триває' : ''}">${pct(c.pct)}</td>`;
  };
  // Days nobody signed up on are left out (a quiet window would be a column of dashes).
  const cohortRows = R.cohorts.filter((c) => c.size).reverse().map((c) => `<tr><td>${dayLabel(c.day)}</td><td class="num">${c.size}</td>${m.ks.map((k) => cell(c.d[k])).join('')}</tr>`).join('');
  const avgRow = `<tr class="avg"><td>Середнє</td><td class="num">${R.cohorts.reduce((a, c) => a + c.size, 0)}</td>${m.ks.map((k) => (R.avg[k] ? `<td class="num" title="${R.avg[k].n} з ${R.avg[k].base}">${pct(R.avg[k].pct)}</td>` : '<td class="num muted">·</td>')).join('')}</tr>`;

  // ---- activity sparklines
  const line = (label, key, fmt, note = '') => {
    const vals = s.map((x) => x[key]);
    const lastV = [...vals].reverse().find((v) => v != null);
    return `<div class="sline"><div><b>${label}</b>${note ? `<small>${note}</small>` : ''}</div>${spark(vals, { days: m.days, fmt, esc })}<span class="val">${lastV == null ? '—' : fmt(lastV)}</span></div>`;
  };

  // ---- funnel
  const fsince = m.funnelSince ? new Date(m.funnelSince).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : null;
  const funnelRows = F.steps.map((st) => `<div class="fstep">
      <div class="fname">${esc(st.name)}</div>
      <div class="fbar"><i style="width:${st.d1Pct == null ? 0 : Math.max(st.d1 ? 1 : 0, st.d1Pct * 100).toFixed(1)}%"></i></div>
      <div class="fnums"><b>${pct(st.d1Pct)}</b><span>${st.d1}</span><span class="muted">${st.fromPrev == null || st.fromPrev > 1 ? '' : `${pct(st.fromPrev)} від попер.`}</span><span class="muted">будь-коли ${pct(st.everPct)}</span><span class="muted">≈ ${since(st.medianMin)}</span></div>
    </div>`).join('');

  // ---- sources
  const srcRows = m.sources.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.n}</td><td class="sharecell"><span class="share"><i style="width:${((x.pct || 0) * 100).toFixed(1)}%"></i></span>${pct(x.pct)}</td>
      <td class="num" title="${x.d1.n} з ${x.d1.base}">${pct(x.d1.pct)}</td><td class="num" title="${x.l4.n} з ${x.l4.base}">${pct(x.l4.pct)}</td></tr>`).join('');

  // ---- money
  const signed = (v) => `${v >= 0 ? '+' : '−'}${short(Math.abs(v))}`;
  const moneyRows = m.money.groups.map((g) => `<tr><td>${esc(g.name)}<div class="muted small hide-m">${g.top.map(esc).join(', ')}</div><div class="muted small show-m">${g.created ? '+' + short(g.created) : ''}${g.created && g.destroyed ? ' · ' : ''}${g.destroyed ? '−' + short(g.destroyed) : ''}</div></td>
      <td class="num hide-m">${g.created ? '+' + short(g.created) : '—'}</td><td class="num hide-m">${g.destroyed ? '−' + short(g.destroyed) : '—'}</td>
      <td class="num"><b>${signed(g.net)}</b></td><td class="hide-m">${spark(g.series, { days: m.days, fmt: signed, zero: true, esc, w: 180, h: 26 })}</td></tr>`).join('');
  const mt = m.money.total;

  return `<div class="head"><h1>Метрики</h1>
      <div class="seg">${[14, 30, 60, 90].map((n) => `<button class="${days === n ? 'on' : ''}" data-act="mdays" data-n="${n}">${n} дн</button>`).join('')}</div>
      <button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    <div class="cards metrics-cards">
      ${stat('D1 — повернулись наступного дня', pct(R.avg[1]?.pct), R.avg[1] ? `${R.avg[1].n} з ${R.avg[1].base} гравців` : 'ще немає завершених днів', goal(R.avg[1]?.pct, m.targets.d1))}
      ${stat('D7 — повернулись через тиждень', pct(R.avg[7]?.pct), R.avg[7] ? `${R.avg[7].n} з ${R.avg[7].base}` : 'когорти ще молоді', goal(R.avg[7]?.pct, m.targets.d7))}
      ${stat('L4 за першу добу', pct(l4?.pct), F.mature ? `${l4.n} з ${F.mature} новачків` : 'новачкам ще немає доби', goal(l4?.pct, m.targets.l4))}
      ${stat('Прийшли за посиланням', pct(m.viral.pct), `друга або виклик: ${m.viral.n}`, goal(m.viral.pct, m.targets.viral))}
      ${stat('DAU · WAU сьогодні', `${last.dau} · ${last.wau}`, `сесій на гравця: ${num1(sessAvg)}`)}
      ${stat('Нові гравці', sum('newUsers'), `за ${days} дн · сьогодні +${last.newUsers}`)}
    </div>

    <div class="panel"><h2>Утримання за днем реєстрації <span class="sub">% тих, хто зайшов знову на N-й день · «·» — день ще не настав</span></h2>
      <div class="tbl-wrap"><table class="cohort"><tr><th>Реєстрація</th><th class="num">Нових</th>${m.ks.map((k) => `<th class="num">D${k}</th>`).join('')}</tr>${avgRow}${cohortRows}</table></div>
      <div class="small muted mt">Активний = будь-яка дія в грі того дня (за Києвом). Сьогоднішні клітинки — курсивом: день ще триває. «Середнє» — лише завершені дні, зважене на розмір когорти.</div></div>

    <div class="grid2 mgrid"><div>
      <div class="panel"><h2>Активність <span class="sub">за ${days} дн</span></h2>
        ${line('Нові гравці', 'newUsers', String)}
        ${line('DAU', 'dau', String, 'активні за день')}
        ${line('WAU', 'wau', String, 'активні за 7 днів')}
        ${line('Сесій на гравця', 'sessions', num1, `перерва > ${m.sessionGapMin} хв — нова сесія`)}
        <details class="mt"><summary class="small muted">Таблиця по днях</summary><div class="tbl-wrap"><table><tr><th>День</th><th class="num">Нові</th><th class="num">DAU</th><th class="num">WAU</th><th class="num">Сесій</th></tr>
          ${[...s].reverse().map((x) => `<tr><td>${dayLabel(x.day)}</td><td class="num">${x.newUsers}</td><td class="num">${x.dau}</td><td class="num">${x.wau}</td><td class="num">${num1(x.sessions)}</td></tr>`).join('')}</table></div></details></div>

      <div class="panel"><h2>Звідки прийшли <span class="sub">нові гравці за ${days} дн</span></h2>
        <div class="tbl-wrap"><table class="sources"><tr><th>Джерело</th><th class="num">Гравців</th><th>Частка</th><th class="num">D1</th><th class="num">L4 за добу</th></tr>${srcRows}</table></div>
        <div class="small muted mt">«Посилання друга» — ref_ (його ж несе картка дропу), «Виклик» — startapp=ch_…, «Інше посилання» — будь-який інший параметр старту, «Органіка» — без параметра. Окремі мітки (tiktok, insta_…) — нижче в «Мітки посилань».</div></div>

    </div><div>
      <div class="panel"><h2>Перша доба новачка <span class="sub">${F.users ? `${F.mature} новачків старші за добу` : 'ще немає даних'}</span></h2>
        ${F.users ? `<div class="funnel">${funnelRows}</div>
          <div class="levels">${F.levels.map((l) => `<div><span>L${l.level} за добу</span><b>${pct(l.pct)}</b><small>${l.n}</small></div>`).join('')}</div>` : '<div class="empty">Кроки новачків записуються з цього оновлення — дані з’являться з першими реєстраціями.</div>'}
        <div class="small muted mt">Відсоток — від новачків, яким уже минула доба: скільки зробили крок за перші 24 год; «≈» — медіанний час від реєстрації.${fsince ? ` Кроки записуються з ${fsince}.` : ''}</div></div>

    </div></div>
      ${tagsPanel(m.tags, { esc })}
      <div class="panel"><h2>Гроші за джерелом <span class="sub">${m.money.since ? `з ${dayLabel(m.money.since)}` : 'записуються з цього оновлення'}</span></h2>
        ${m.money.groups.length ? `<div class="tbl-wrap"><table class="money"><tr><th>Звідки</th><th class="num hide-m">Створено</th><th class="num hide-m">Вилучено</th><th class="num">Різниця</th><th class="hide-m">По днях</th></tr>${moneyRows}
          <tr class="avg"><td>Усього<div class="muted small show-m">+${short(mt.created)} · −${short(mt.destroyed)}</div></td><td class="num hide-m">+${short(mt.created)}</td><td class="num hide-m">−${short(mt.destroyed)}</td><td class="num"><b>${signed(mt.created - mt.destroyed)}</b></td><td class="hide-m"></td></tr></table></div>` : '<div class="empty">Ще немає записів</div>'}
        <div class="small muted mt">Створено — гривні, що прийшли гравцям; вилучено — що пішли з гри (угоди між гравцями — з обох боків). Під назвою — найбільші дії групи.</div></div>`;
}
