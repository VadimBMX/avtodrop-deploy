// Admin «Логи» (src/logs.js, src/serverlog.js): three tabs under one nav item.
//   «Стрічка подій» — everything that happens in the game, newest first, filters + «Ще» by cursor + CSV;
//   «Входи гравців» — sessions with their length and deep-link source;
//   «Сервер» — server lines and errors with stacks (owner and admins only; the tab isn't shown to helpers).
// The list of the feed grows in place («Ще» appends rows), the server tab can refresh itself every 10 s.
import { drawChart } from './admin-pc.js';

// icon + colour per feed type (names come from the server: FEED_TYPES)
export const TYPE_UI = {
  signup: ['👤', '#4d8ff0'], drop: ['🎁', '#ffc400'], sell: ['💰', '#2fd27a'], car: ['🚗', '#9aa4b8'], trade: ['🔄', '#38bdf8'],
  market: ['🏪', '#a78bfa'], auction: ['🔨', '#fb923c'], pay: ['⭐', '#facc15'], promo: ['🎟', '#f472b6'], gift: ['🎀', '#fb7185'],
  support: ['💬', '#22d3ee'], race: ['🏁', '#84cc16'], battle: ['⚔️', '#f87171'], container: ['📦', '#d4a24c'], invite: ['✉️', '#94a3b8'], admin: ['🛡', '#ff6b75'],
};
const TYPE_NAMES = {
  signup: 'Реєстрації', drop: 'Кейси', sell: 'Продаж дилеру', car: 'Рух авто', trade: 'Обміни', market: 'Ринок', auction: 'Аукціони',
  pay: 'Оплати ⭐', promo: 'Промокоди', gift: 'Подарунки', support: 'Підтримка', race: 'Гонки', battle: 'Батли й PvP',
  container: 'Причал', invite: 'Запрошення', admin: 'Дії адмінів',
};
const WINDOWS = [['1h', '1 год'], ['24h', '24 год'], ['7d', '7 днів'], ['30d', '30 днів']];
const LEVELS = [['all', 'Усі'], ['warn', 'Попередження'], ['error', 'Помилки']];
const SRV_MS = 10e3;

const two = (n) => String(n).padStart(2, '0');
function stamp(t) {
  const d = new Date(t), now = new Date();
  const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return d.toDateString() === now.toDateString() ? time : `${two(d.getDate())}.${two(d.getMonth() + 1)} ${time}`;
}
function dur(ms) {
  const m = Math.floor((ms || 0) / 60e3);
  if (m < 1) return '<1 хв';
  return m >= 60 ? `${Math.floor(m / 60)} год ${m % 60} хв` : `${m} хв`;
}
const st = (state) => (state.lg ||= { tab: 'feed', feed: { player: '', window: '24h', types: [], q: '' }, srv: { level: 'all', q: '', auto: false }, ses: { player: '', source: '', offset: 0 } });

// ---------- page ----------
export async function logsPage(c) {
  const L = st(c.state);
  if (L.tab === 'server' && c.state.role === 'helper') L.tab = 'feed';
  const tabs = [['feed', 'Стрічка подій'], ['sessions', 'Входи гравців'], ...(c.state.role === 'helper' ? [] : [['server', 'Сервер']])];
  const head = `<div class="head"><h1>Логи</h1></div>
    <div class="tabs lg-tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" class="${L.tab === k ? 'on' : ''}" aria-selected="${L.tab === k}" data-act="lgTab" data-t="${k}">${t}</button>`).join('')}</div>`;
  if (L.tab === 'server') return head + (await serverTab(c, L));
  if (L.tab === 'sessions') return head + (await sessionsTab(c, L));
  return head + (await feedTab(c, L));
}

// ---------- «Стрічка подій» ----------
let feedCursor = null;
function feedRow(e, c) {
  const { esc, short } = c;
  const [icon, col] = TYPE_UI[e.type] || ['•', '#9aa4b8'];
  const who = (id, nm) => (id == null ? '' : `<a data-user="${id}">${esc(nm || id)}</a> <span class="muted small">${id}</span>`);
  const amt = e.amount == null ? '' : `<span class="${e.amount < 0 ? 'bad' : ''}">${e.approx ? '≈ ' : ''}${e.cur === '⭐' ? `⭐ ${e.amount}` : short(e.amount)}</span>`;
  return `<tr><td class="ttl"><span class="lgt" style="--c:${col}"><i aria-hidden="true">${icon}</i>${esc(TYPE_NAMES[e.type] || e.type)}</span> <span class="lg-text">${esc(e.text)}</span></td>
    <td class="half nowrap small" data-l="Час" title="${esc(new Date(e.t).toLocaleString('uk-UA'))}">${stamp(e.t)}</td>
    <td class="half" data-l="Гравець">${who(e.uid, e.name) || '<span class="muted">—</span>'}</td>
    <td class="half num" data-l="Сума">${amt}</td>
    <td class="half" data-l="Контрагент">${who(e.other, e.otherName)}</td></tr>`;
}
async function feedTab(c, L) {
  const { esc, api } = c;
  const f = L.feed;
  const r = await api('logs/feed', { player: f.player || null, window: f.window, types: f.types, q: f.q || null });
  feedCursor = r.cursor;
  const nf = (f.player ? 1 : 0) + (f.q ? 1 : 0) + f.types.length;
  const chips = Object.keys(TYPE_UI).map((k) => `<button type="button" class="lg-chip ${f.types.includes(k) ? 'on' : ''}" style="--c:${TYPE_UI[k][1]}" data-act="lgType" data-t="${k}" aria-pressed="${f.types.includes(k)}"><i aria-hidden="true">${TYPE_UI[k][0]}</i>${esc(TYPE_NAMES[k])}</button>`).join('');
  return `<div class="panel lg-filters">
      <form class="lg-form" id="lgFeedForm">
        <label>Гравець<input id="lgPlayer" placeholder="ID або @username" value="${esc(f.player)}" autocomplete="off"></label>
        <label>Пошук<input id="lgQ" placeholder="текст події, ім’я" value="${esc(f.q)}" autocomplete="off"></label>
        <div class="lg-win"><span class="muted small">Період</span><div class="seg">${WINDOWS.map(([k, t]) => `<button type="button" class="${f.window === k ? 'on' : ''}" data-act="lgWin" data-k="${k}">${t}</button>`).join('')}</div></div>
        <div class="lg-btns"><button type="button" class="btn ghost sm" data-act="lgReset" ${nf ? '' : 'disabled'}>Скинути</button>
          <button type="button" class="btn ghost sm" data-act="lgCsv">${c.ic('download')} CSV</button><button class="btn sm">Показати</button></div>
      </form>
      <div class="lg-chips" role="group" aria-label="Типи подій">${chips}</div>
    </div>
    <div class="panel lg-list">
      <h2>Події <span class="sub" id="lgCount">${r.list.length}${r.more ? '+' : ''} · найновіші зверху</span></h2>
      ${r.list.length ? `<div class="tbl-wrap"><table class="stack lg-feed" data-l="1"><tbody><tr class="hd"><th>Подія</th><th>Час</th><th>Гравець</th><th class="num">Сума</th><th>Контрагент</th></tr>
        ${r.list.map((e) => feedRow(e, c)).join('')}</tbody></table></div>
        <div class="lg-more"><button class="btn ghost" data-act="lgMore" ${r.more ? '' : 'hidden'}>Ще</button>${r.more ? '' : '<span class="muted small">Це все за обраний період</span>'}</div>`
      : `<div class="empty">Подій за обраний період немає${nf ? ' — спробуй зняти фільтри' : ''}</div>`}
    </div>`;
}
function readFeedForm(c, L) {
  const p = c.$('#lgPlayer'), q = c.$('#lgQ');
  if (p) L.feed.player = p.value.trim();
  if (q) L.feed.q = q.value.trim();
}

// ---------- «Сервер» ----------
let srvTimer = null, srvBefore = null;
const levelBadge = (l) => `<span class="badge ${l === 'error' ? 'red' : l === 'warn' ? 'amber' : ''}">${{ error: 'помилка', warn: 'увага', info: 'інфо' }[l] || l}</span>`;
function srvRows(list, esc) {
  return list.map((e) => `<details class="lgs lv-${e.level}" data-id="${e.id}"><summary><span class="lgs-t small">${stamp(e.ts)}</span>${levelBadge(e.level)}<code class="lgs-m">${esc(e.msg)}</code></summary>
    <pre class="lgs-pre">${esc(e.msg)}${e.stack && e.stack !== e.msg ? `\n\n${esc(e.stack)}` : ''}</pre></details>`).join('');
}
function srvCards(r, c) {
  const C = r.counts;
  const card = (label, v, sub, tone = '') => `<div class="stat ${tone}"><span>${label}</span><b>${v}</b><small>${sub}</small></div>`;
  return card('Помилки за 1 год', C.h1.error, `попереджень ${C.h1.warn}`, C.h1.error ? 'lg-bad' : '')
    + card('Помилки за 24 год', C.h24.error, `попереджень ${C.h24.warn}`, C.h24.error ? 'lg-bad' : '')
    + card('Буфер у пам’яті', `${r.ring.size} / ${r.ring.max}`, `з ${c.date(r.startedAt)} (запуск)`);
}
async function serverTab(c, L) {
  const { esc, api, ic } = c;
  const s = L.srv;
  const r = await api('logs/server', { level: s.level, q: s.q || null });
  srvBefore = r.more && r.list.length ? r.list[r.list.length - 1].id : null;
  c.state.lgSrvHours = r.counts.hours;
  return `<div class="cards lg-cards" id="lgSrvCards">${srvCards(r, c)}</div>
    <div class="panel"><h2>Помилки по годинах <span class="sub">останні 24 год</span></h2><div class="pcchart" id="lgErrChart"></div></div>
    <div class="panel lg-filters">
      <form class="lg-form" id="lgSrvForm">
        <div class="lg-win"><span class="muted small">Рівень</span><div class="seg">${LEVELS.map(([k, t]) => `<button type="button" class="${s.level === k ? 'on' : ''}" data-act="lgLevel" data-k="${k}">${t}</button>`).join('')}</div></div>
        <label>Пошук<input id="lgSrvQ" placeholder="текст у рядку чи стеку" value="${esc(s.q)}" autocomplete="off"></label>
        <label class="lg-auto"><input type="checkbox" id="lgAuto" ${s.auto ? 'checked' : ''}> Автооновлення 10 с</label>
        <div class="lg-btns"><button type="button" class="btn ghost sm" data-act="lgSrvNow">${ic('refresh')} Оновити</button><button class="btn sm">Показати</button></div>
      </form>
      <div class="small muted">${s.level === 'all' ? 'Усі рівні — з пам’яті сервера з моменту запуску (останні рядки). Попередження й помилки — з бази за 14 днів.' : 'З бази за 14 днів (не більше ~20 000 рядків). Натисни рядок, щоб побачити стек.'} Токени, ключі, initData й довгі hex-рядки вирізано ще до запису.</div>
    </div>
    <div class="panel lg-srv"><div id="lgSrvList">${r.list.length ? srvRows(r.list, esc) : '<div class="empty">Записів немає</div>'}</div>
      <div class="lg-more"><button class="btn ghost" data-act="lgSrvMore" ${srvBefore ? '' : 'hidden'}>Ще</button></div></div>`;
}
async function srvRefresh(c) {
  const L = st(c.state);
  if (c.state.view !== 'logs' || L.tab !== 'server' || !c.$('#lgSrvList')) return stopSrv();
  if (document.hidden) return;
  let r;
  try {
    r = await c.api('logs/server', { level: L.srv.level, q: L.srv.q || null });
  } catch {
    return;
  }
  const list = c.$('#lgSrvList');
  if (!list) return;
  const open = new Set([...list.querySelectorAll('details[open]')].map((d) => d.dataset.id));
  // keep what «Ще» already loaded below: only the newest page is replaced
  list.innerHTML = r.list.length ? srvRows(r.list, c.esc) : '<div class="empty">Записів немає</div>';
  for (const d of list.querySelectorAll('details')) if (open.has(d.dataset.id)) d.open = true;
  srvBefore = r.more && r.list.length ? r.list[r.list.length - 1].id : null;
  const more = c.$('[data-act="lgSrvMore"]');
  if (more) more.hidden = !srvBefore;
  const cards = c.$('#lgSrvCards');
  const html = srvCards(r, c);
  if (cards && cards.innerHTML !== html) cards.innerHTML = html;
  c.state.lgSrvHours = r.counts.hours;
  errChart(c);
}
function stopSrv() {
  clearInterval(srvTimer);
  srvTimer = null;
}
function errChart(c) {
  const el = c.$('#lgErrChart'), hours = c.state.lgSrvHours;
  if (!el || !hours) return;
  drawChart(el, {
    labels: hours.map((h) => two(new Date(h.h).getHours())),
    series: [{ name: 'Помилки', values: hours.map((h) => h.n), kind: 'bar', tone: 'err' }],
    tip: (i) => `${new Date(hours[i].h).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    height: 140,
  });
}

// ---------- «Входи гравців» ----------
const srcLabel = (s, esc) => (s ? `<code>${esc(s)}</code>` : '<span class="muted">напряму</span>');
async function sessionsTab(c, L) {
  const { esc, api } = c;
  const f = L.ses;
  const r = await api('logs/sessions', { player: f.player || null, source: f.source || null, offset: f.offset });
  c.state.lgSesHours = r.today.hours;
  const T = r.today;
  const card = (label, v, sub = '') => `<div class="stat"><span>${label}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const opt = (v, t) => `<option value="${esc(v)}" ${f.source === v ? 'selected' : ''}>${esc(t)}</option>`;
  const top = T.top.length ? `<ol class="top lg-top">${T.top.map((s) => `<li><span class="nm">${srcLabel(s.source, esc)}${s.note ? ` <span class="muted small">${esc(s.note)}</span>` : ''}</span><b>${s.n}</b></li>`).join('')}</ol>` : '<div class="empty">Сьогодні ще ніхто не заходив</div>';
  const rows = r.list.map((s) => `<tr><td class="ttl"><a data-user="${s.uid}">${esc(s.name)}</a> <span class="muted small">${s.uid}</span>${s.live ? ' <span class="badge green">зараз у грі</span>' : ''}</td>
      <td class="half nowrap" data-l="Початок" title="${esc(new Date(s.start).toLocaleString('uk-UA'))}">${stamp(s.start)}</td>
      <td class="half nowrap" data-l="Тривалість">${dur(s.ms)}</td>
      <td class="half" data-l="Джерело">${srcLabel(s.source, esc)}${s.note ? `<div class="muted small">${esc(s.note)}</div>` : ''}</td></tr>`).join('');
  const nf = (f.player ? 1 : 0) + (f.source ? 1 : 0);
  return `<div class="cards lg-cards">${card('Сесій сьогодні', T.sessions)}${card('Гравців сьогодні', T.players, 'унікальних')}${card('Середня тривалість', dur(T.avgMs), `сесія закінчується після ${r.gapMin} хв тиші`)}${card('Головне джерело', T.top[0] ? (T.top[0].source ? esc(T.top[0].source) : 'напряму') : '—', T.top[0] ? `${T.top[0].n} сесій` : '')}</div>
    <div class="grid2 lg-g">
      <div class="panel"><h2>Входи за годинами <span class="sub">сьогодні, за Києвом</span></h2><div class="pcchart" id="lgSesChart"></div></div>
      <div class="panel"><h2>Джерела сьогодні <span class="sub">мітка посилання, з яким відкрили гру</span></h2>${top}</div>
    </div>
    <div class="panel lg-filters"><form class="lg-form" id="lgSesForm">
      <label>Гравець<input id="lgSesPlayer" placeholder="ID або @username" value="${esc(f.player)}" autocomplete="off"></label>
      <label>Джерело<select id="lgSesSrc">${opt('', 'усі')}${opt('-', 'напряму (без мітки)')}${r.sources.filter((s) => s.source).map((s) => opt(s.source, `${s.source} · ${s.n}`)).join('')}</select></label>
      <div class="lg-btns"><button type="button" class="btn ghost sm" data-act="lgSesReset" ${nf ? '' : 'disabled'}>Скинути</button><button class="btn sm">Показати</button></div>
    </form></div>
    <div class="panel"><h2>Сесії <span class="sub">найновіші зверху · 30 днів</span></h2>
      ${r.list.length ? `<div class="tbl-wrap"><table class="stack lg-ses" data-l="1"><tbody><tr class="hd"><th>Гравець</th><th>Початок</th><th>Тривалість</th><th>Джерело</th></tr>${rows}</tbody></table></div>
      <div class="pager"><span class="muted small">${r.offset + 1}–${r.offset + r.list.length}</span>
        <button class="btn ghost sm" data-act="lgSesPage" data-o="${Math.max(0, r.offset - r.pageSize)}" ${r.offset ? '' : 'disabled'}>‹ Новіші</button>
        <button class="btn ghost sm" data-act="lgSesPage" data-o="${r.offset + r.pageSize}" ${r.more ? '' : 'disabled'}>Старіші ›</button></div>`
      : `<div class="empty">Сесій немає${nf ? ' — спробуй зняти фільтри' : ''}</div>`}</div>`;
}

// ---------- after render: forms, charts, the server timer ----------
export function logsAfter(c) {
  const L = st(c.state);
  stopSrv();
  c.$('#lgFeedForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    readFeedForm(c, L);
    c.render();
  });
  c.$('#lgSrvForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    L.srv.q = c.$('#lgSrvQ').value.trim();
    c.render();
  });
  c.$('#lgAuto')?.addEventListener('change', (e) => {
    L.srv.auto = e.target.checked;
    stopSrv();
    if (L.srv.auto) srvTimer = setInterval(() => srvRefresh(c), SRV_MS);
  });
  c.$('#lgSesForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(L.ses, { player: c.$('#lgSesPlayer').value.trim(), source: c.$('#lgSesSrc').value, offset: 0 });
    c.render();
  });
  c.$('#lgSesSrc')?.addEventListener('change', (e) => {
    Object.assign(L.ses, { player: c.$('#lgSesPlayer').value.trim(), source: e.target.value, offset: 0 });
    c.render();
  });
  if (L.tab === 'server') {
    errChart(c);
    if (L.srv.auto) srvTimer = setInterval(() => srvRefresh(c), SRV_MS);
  }
  if (L.tab === 'sessions' && c.state.lgSesHours) {
    const h = c.state.lgSesHours;
    drawChart(c.$('#lgSesChart'), { labels: h.map((_, i) => two(i)), series: [{ name: 'Нові сесії', values: h, kind: 'bar', tone: 'accent' }], tip: (i) => `${two(i)}:00–${two(i)}:59`, height: 150 });
  }
}

export function logsActions(c) {
  const L = () => st(c.state);
  const tabHash = (t) => history.replaceState(null, '', `#logs/${t}`);
  return {
    lgTab: (d) => {
      L().tab = d.t;
      tabHash(d.t);
      c.render();
    },
    lgWin: (d) => {
      readFeedForm(c, L());
      L().feed.window = d.k;
      c.render();
    },
    lgType: (d, el) => {
      readFeedForm(c, L());
      const t = L().feed.types, i = t.indexOf(d.t);
      if (i >= 0) t.splice(i, 1);
      else t.push(d.t);
      el.classList.toggle('on', i < 0);
      c.render();
    },
    lgReset: () => {
      L().feed = { player: '', window: L().feed.window, types: [], q: '' };
      c.render();
    },
    lgMore: async (d, el) => {
      if (!feedCursor) return;
      const f = L().feed;
      el.disabled = true;
      const r = await c.act('logs/feed', { player: f.player || null, window: f.window, types: f.types, q: f.q || null, cursor: feedCursor });
      el.disabled = false;
      if (!r) return;
      feedCursor = r.cursor;
      const body = c.$('table.lg-feed tbody');
      body?.insertAdjacentHTML('beforeend', r.list.map((e) => feedRow(e, c)).join(''));
      const n = body ? body.rows.length - 1 : 0;
      const cnt = c.$('#lgCount');
      if (cnt) cnt.textContent = `${n}${r.more ? '+' : ''} · найновіші зверху`;
      if (!r.more) {
        el.hidden = true;
        el.insertAdjacentHTML('afterend', '<span class="muted small">Це все за обраний період</span>');
      }
    },
    lgCsv: async () => {
      readFeedForm(c, L());
      const f = L().feed;
      c.toast('Готую CSV…');
      const r = await c.act('logs/export', { player: f.player || null, window: f.window, types: f.types, q: f.q || null });
      if (!r) return;
      const url = URL.createObjectURL(new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `logs-${f.window}-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.csv` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      c.toast(`Експортовано ${r.n} подій${r.truncated ? ` (обрізано до ${r.n})` : ''}`);
    },
    lgLevel: (d) => {
      const q = c.$('#lgSrvQ');
      if (q) L().srv.q = q.value.trim();
      L().srv.level = d.k;
      c.render();
    },
    lgSrvNow: () => srvRefresh(c),
    lgSrvMore: async (d, el) => {
      if (!srvBefore) return;
      const s = L().srv;
      el.disabled = true;
      const r = await c.act('logs/server', { level: s.level, q: s.q || null, before: srvBefore });
      el.disabled = false;
      if (!r) return;
      c.$('#lgSrvList')?.insertAdjacentHTML('beforeend', srvRows(r.list, c.esc));
      srvBefore = r.more && r.list.length ? r.list[r.list.length - 1].id : null;
      el.hidden = !srvBefore;
    },
    lgSesPage: (d) => {
      L().ses.offset = Number(d.o) || 0;
      c.render();
    },
    lgSesReset: () => {
      L().ses = { player: '', source: '', offset: 0 };
      c.render();
    },
  };
}
// #logs/<tab> in the address opens that tab
export function logsFromHash(state, tab) {
  if (['feed', 'sessions', 'server'].includes(tab)) st(state).tab = tab;
}
