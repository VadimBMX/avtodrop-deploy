// Admin panel: overview, players (with everything they own), market, promo codes, payments and the action log.
import * as S from './shared.js';
import { carArt, setImages } from './car.js';
import { metricsPage } from './admin-metrics.js';
import { dayRacePage, dayRaceActions } from './admin-dayrace.js';
import { halloweenPage, halloweenActions } from './admin-halloween.js';
import { channelPage, channelActions } from './admin-channel.js';
import { eventsPage, eventsActions, eventsAfter } from './admin-events.js';
import { clubsPage, clubsActions } from './admin-clubs.js';
import { bugsPage, bugsActions, bugChooser, bugCardLine, bugRewardText } from './admin-bugs.js';
import { hideChartTip, liveSkeleton, livePanels, liveCharts, playerMoney, playerSuspicious, economyPage, economyCharts, dbPage, dbFilterRow, readFilters, setupInstall } from './admin-pc.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ic = (name) => `<svg class="i" aria-hidden="true"><use href="icons.svg#i-${name}"/></svg>`;
const tg = window.Telegram?.WebApp;
const KEY = 'avtodrop-admin-key';
const store = {
  get: () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
  set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} },
};

async function api(name, body = {}) {
  const headers = { 'content-type': 'application/json' };
  const key = store.get();
  if (key) headers['x-admin-key'] = key;
  else if (tg?.initData) headers['x-init-data'] = tg.initData;
  const r = await fetch('/api/admin/' + name, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: 'Помилка сервера' }));
  if (r.status === 401 || r.status === 403) {
    const e = new Error(j.error || 'Немає доступу');
    e.auth = true;
    throw e;
  }
  if (!r.ok) throw new Error(j.error || 'Помилка');
  return j;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
async function act(name, body, ok) {
  try {
    const r = await api(name, body);
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
    return r || {};
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}
// Every action that changes a player or the economy goes through this dialog: what will happen, a required reason
// (it goes into the action log with the admin's name) and an explicit confirm. The server refuses the action without both.
// `summary` is HTML built by the caller with esc() around anything that came from players.
// The owner isn't asked for a reason (owner 28.10): the field is gone, or optional where the reason reaches the player.
function confirmDialog({ title, summary = '', danger = false, button = 'Підтвердити', reasonLabel = null, reasonValue = '' }) {
  const owner = state.role === 'owner';
  const custom = reasonLabel != null;
  reasonLabel ??= 'Причина — піде в журнал дій';
  if (owner) reasonLabel += ' (необов’язково)';
  return new Promise((resolve) => {
    const m = $('#modal'), d = $('#dialog');
    d.innerHTML = `<h3></h3><div class="summary">${summary}</div>
      <label class="field"><span></span><textarea id="cfReason" maxlength="300" rows="2" placeholder="Напр.: компенсація за баг з оплатою"></textarea></label>
      <div class="row end"><button class="btn ghost" data-cf="0">Скасувати</button><button class="btn ${danger ? 'danger' : ''}" data-cf="1" disabled></button></div>`;
    $('h3', d).textContent = title;
    $('label span', d).textContent = reasonLabel;
    const ok = $('[data-cf="1"]', d);
    ok.textContent = button;
    const r = $('#cfReason', d);
    r.value = reasonValue;
    if (owner && !custom) $('label.field', d).hidden = true;
    const check = () => (ok.disabled = !owner && r.value.trim().length < 3);
    check();
    r.addEventListener('input', check);
    // On a phone the dialog is a bottom sheet: keep it inside the visible part of the screen, so the on-screen
    // keyboard (the reason field) never covers the buttons, and don't let the page behind it scroll.
    const vv = window.visualViewport;
    const fit = () => {
      m.style.top = `${vv.offsetTop}px`;
      m.style.height = `${vv.height}px`;
    };
    const done = (v) => {
      m.hidden = true;
      d.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      m.style.top = m.style.height = '';
      document.body.classList.remove('modal-open');
      resolve(v);
    };
    const onKey = (e) => e.key === 'Escape' && done(null);
    document.addEventListener('keydown', onKey);
    d.onclick = (e) => {
      const b = e.target.closest('[data-cf]');
      if (b && !b.disabled) done(b.dataset.cf === '1' ? r.value.trim() : null);
    };
    m.onclick = (e) => e.target === m && done(null);
    $('#toast').hidden = true;
    if (vv) {
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
      fit();
    }
    document.body.classList.add('modal-open');
    m.hidden = false;
    d.scrollTop = 0;
    if (owner && !custom) ok.focus(); else r.focus();
  });
}
// A changing action: ask (dialog above), then call with confirm + reason and re-render on success.
async function mutate(name, body, dialog, ok) {
  const reason = await confirmDialog(dialog);
  if (reason == null) return null;
  const r = await act(name, { ...body, confirm: true, reason }, ok);
  if (r) render();
  return r;
}

// ---------- formatting ----------
const money = (n) => S.fmt(Math.round(n || 0));
const short = (n) => S.short(Math.round(n || 0));
const date = (t) => (t ? new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
// "3 год 12 хв" / "12 хв" — time the player spent with the game open.
function playTime(ms) {
  const m = Math.floor((ms || 0) / 60e3);
  return m >= 60 ? `${Math.floor(m / 60)} год ${m % 60} хв` : `${m} хв`;
}
function ago(t) {
  if (!t) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'щойно';
  if (s < 3600) return `${Math.floor(s / 60)} хв тому`;
  if (s < 86400) return `${Math.floor(s / 3600)} год тому`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} дн тому`;
  return date(t);
}
const cls = (c) => `<span class="cls" style="--c:${S.CLASSES[c]?.color || '#888'}">${esc(c)}</span>`;
const model = (id) => S.MODELS[id] || { name: id, cls: 'D', price: 0 };
const plate = (t) => `<span class="plate"><span class="ua">UA</span><span class="t">${esc(t)}</span></span>`;
const userLink = (u) => `<a data-user="${u.id}">${esc(u.name)}</a> <span class="muted small">${u.id}</span>`;
const partName = (type, tier) => `${S.PARTS[type]?.name || type} · ${S.TIER_BY_ID[tier]?.name || tier}`;
const caseName = (id) => S.CASE_BY_ID[id]?.name || id;
const tierCls = (tier) => S.TIER_BY_ID[tier]?.cls || 'D';
const ACTIONS = {
  money: 'Гроші', 'give-car': 'Видано авто', 'remove-car': 'Вилучено авто', part: 'Деталі', keys: 'Ключі', set: 'Параметр',
  ban: 'Бан', unban: 'Розбан', 'lb-hide': 'Приховано з рейтингу', 'lb-show': 'Повернуто в рейтинг', reset: 'Обнулено', 'dealer-refresh': 'Нові лоти дилера', 'give-plate': 'Видано номер', 'remove-plate': 'Забрано номер', message: 'Повідомлення', 'market-remove': 'Знято лот', promo: 'Промокод', 'promo-delete': 'Видалено промокод', support: 'Відповідь підтримки', role: 'Права',
  luck: 'Підкрутка', rig: 'Гарантована машина', 'rig-cancel': 'Скасовано гарантовану машину', broadcast: 'Розсилка', 'casino-mode': 'Режим казино',
  'containers-toggle': 'Причал: перемикач', 'containers-close': 'Причал: лот закрито',
  'db-browse': 'База: перегляд', 'db-export': 'База: експорт CSV',
  'event-start': 'Подія: запуск', 'event-stop': 'Подія: зупинка', 'plan-add': 'Розклад: додано', 'plan-edit': 'Розклад: змінено', 'plan-delete': 'Розклад: видалено', 'plan-seed': 'Розклад: типовий календар',
};
const FIELD_NAMES = { level: 'Рівень', slots: 'Місць у гаражі', showcase_slots: 'Місць на вітрині', cap_level: 'Рівень сховища', xp: 'XP' };
const AUDIENCE = { all: 'усім гравцям', active30: 'активним за 30 днів', active7: 'активним за 7 днів', active1: 'активним за добу' };
const DANGER = new Set(['remove-car', 'remove-plate', 'ban', 'reset', 'broadcast', 'role', 'promo-delete', 'market-remove']);
// Details of a log entry, then the reason typed in the confirm dialog.
function details(a, d) {
  if (!d) return '';
  try {
    d = typeof d === 'string' ? JSON.parse(d) : d;
  } catch {
    return esc(d);
  }
  const main = detailsMain(a, d);
  const why = d.reason && a !== 'ban' && a !== 'reset' ? `<div class="why">причина: ${esc(d.reason)}</div>` : '';
  return main + why;
}
function detailsMain(a, d) {
  switch (a) {
    case 'broadcast': return `${esc(d.text)} <span class="muted small">· ${esc(AUDIENCE[d.audience] || d.audience)} · ${d.recipients} отрим.</span>`;
    case 'money': return `<span class="${d.amount >= 0 ? 'win' : 'bad'}">${d.amount >= 0 ? '+' : ''}${money(d.amount)}</span>${d.note ? ` · ${esc(d.note)}` : ''}`;
    case 'give-car': case 'remove-car': return esc(model(d.model).name);
    case 'part': return `${esc(partName(d.type, d.tier))} × ${d.count}`;
    case 'keys': return `${esc(caseName(d.caseId))} × ${d.count}`;
    case 'set': return `${esc(FIELD_NAMES[d.field] || d.field)}: ${d.was != null ? `${esc(d.was)} → ` : ''}${esc(d.value)}`;
    case 'ban': case 'unban': return esc(d.reason || '');
    case 'reset': return `прибрано ${d.cars} авто${d.reason ? ` · ${esc(d.reason)}` : ''}`;
    case 'message': return esc(d.text);
    case 'promo': return `${esc(d.code)} · ${money(d.amount)} × ${d.uses}`;
    case 'promo-delete': return esc(d.code);
    case 'give-plate': return `${plate(d.text)} ${cls(d.cls)} ${money(d.value)}${d.note ? ` · ${esc(d.note)}` : ''}`;
    case 'remove-plate': return plate(d.text);
    case 'support': return esc(d.text);
    case 'bug-reward': return `🐞 ${esc({ small: 'Дрібниця', useful: 'Корисна знахідка', serious: 'Серйозний баг' }[d.preset] || 'Своя')} · <span class="win">${esc(bugRewardText(d.money, d.keys))}</span>${d.ticket ? ` · звернення #${d.ticket}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}`;
    case 'role': return d.role ? ({ admin: 'видано Адмін', helper: 'видано Хелпер' }[d.role]) : 'права забрано';
    case 'luck': return d.chance ? `${d.chance}% на ${d.opens} відкр.` : 'вимкнено';
    case 'rig': case 'rig-cancel': return esc(model(d.model).name);
    case 'market-remove': return d.kind === 'listing' ? 'ринок' : 'аукціон';
    case 'plan-add': case 'plan-edit': case 'plan-delete': return `${esc(d.title || S.EVENTS[d.kind]?.name || d.kind)} · ${esc(S.kyivLocal(d.start).replace('T', ' '))} – ${esc(S.kyivLocal(d.end).replace('T', ' '))}`;
    case 'plan-seed': return `додано ${d.added}, пропущено ${d.skipped}`;
    case 'db-browse': case 'db-export': return `<code>${esc(d.table)}</code>${d.filters?.length ? ` · ${d.filters.map((f) => esc(`${f.col} ${f.op} ${f.value}`)).join(', ')}` : ''}${d.sort ? ` · сорт. ${esc(d.sort)}` : ''}${d.rows != null ? ` · ${d.rows} рядків${d.truncated ? ' (обрізано)' : ''}` : ''}`;
    default: return esc(JSON.stringify(d));
  }
}
const pager = (offset, size, count, total) => (total > size || offset ? `<div class="pager"><span class="muted small">${offset + 1}–${offset + count}${total != null ? ` з ${total}` : ''}</span>
  <button class="btn ghost sm" data-page="${Math.max(0, offset - size)}" ${offset ? '' : 'disabled'}>‹ Назад</button>
  <button class="btn ghost sm" data-page="${offset + size}" ${count < size ? 'disabled' : ''}>Далі ›</button></div>` : '');

// ---------- router ----------
const state = { view: 'overview', userId: null, userTab: 'cars', query: '', sort: 'value', offset: 0 };
const VIEWS = {};
function go(view, extra = {}) {
  Object.assign(state, { view, offset: 0 }, extra);
  const hash = view === 'user' ? `#user/${state.userId}` : `#${view}`;
  if (location.hash !== hash) history.pushState(null, '', hash);
  render();
}
function fromHash() {
  const [v, id] = location.hash.slice(1).split('/');
  if (v === 'user' && id) Object.assign(state, { view: 'user', userId: Number(id) });
  else if (VIEWS[v]) state.view = v;
}
window.addEventListener('popstate', () => (navOpen(false), fromHash(), render()));
// ---------- phone (admin.css «phone»): the side bar is a drawer behind the top bar's menu button ----------
const narrow = () => window.matchMedia?.('(max-width: 860px)').matches;
// Desktop (admin.css «desktop», ≥ 1200 px): the player card lays its panels side by side; crossing the line redraws it.
const WIDE = window.matchMedia?.('(min-width: 1200px)');
const wide = () => !!WIDE?.matches;
WIDE?.addEventListener?.('change', () => state.view === 'user' && render());
function navOpen(open) {
  if (open === document.body.classList.contains('nav-open')) return;
  document.body.classList.toggle('nav-open', open);
  $('.scrim').hidden = !open;
  $('.menu-btn').setAttribute('aria-expanded', String(open));
  const side = $('#side'), on = $('#nav button.on');
  if (open) {
    if (on) side.scrollTop = on.offsetTop - side.clientHeight / 2;
    (on || $('.drawer-x')).focus({ preventScroll: true });
  } else if (side.contains(document.activeElement)) $('.menu-btn').focus({ preventScroll: true });
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && navOpen(false));
// Tables marked .stack turn into one card per row on a narrow screen: every cell gets its column name as data-l
// (shown above the value by admin.css); the header row is hidden there. Rows of another shape (colspan) are left alone.
function labelTables(root) {
  for (const t of root.querySelectorAll('table.stack:not([data-l])')) {
    t.dataset.l = '1';
    const head = [...t.rows].find((r) => r.cells[0]?.tagName === 'TH');
    if (!head) continue;
    head.classList.add('hd');
    const names = [...head.cells].map((c) => c.textContent.trim());
    for (const r of t.rows) if (r !== head && r.cells.length === names.length) [...r.cells].forEach((c, i) => names[i] && c.setAttribute('data-l', names[i]));
  }
}
const navText = (b) => [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  hideChartTip(); // a chart tooltip must not outlive its chart
  const navKey = state.view === 'user' ? 'users' : state.view;
  document.querySelectorAll('#nav button').forEach((b) => {
    b.classList.toggle('on', b.dataset.go === navKey);
    if (b.dataset.go === navKey) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const onBtn = document.querySelector('#nav button.on');
  if (onBtn) $('#tbTitle').textContent = navText(onBtn);
  if (!narrow()) onBtn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  try {
    const html = await VIEWS[state.view]();
    if (seq !== renderSeq) return;
    const main = $('#main');
    main.innerHTML = html;
    labelTables(main);
    // the player card's tab strip scrolls sideways: keep the open tab in sight
    const tabs = $('.tabs', main), tab = tabs && $('button.on', tabs);
    if (tab) tabs.scrollLeft += tab.getBoundingClientRect().left - tabs.getBoundingClientRect().left - (tabs.clientWidth - tab.offsetWidth) / 2;
    AFTER[state.view]?.();
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e.auth) return login(e.message);
    $('#main').innerHTML = `<div class="empty bad">${esc(e.message)}</div>`;
  }
}
const AFTER = {};
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-go]');
  if (nav) return navOpen(false), go(nav.dataset.go);
  const u = e.target.closest('[data-user]');
  if (u) return go('user', { userId: Number(u.dataset.user), userTab: 'cars' });
  const p = e.target.closest('[data-page]');
  if (p && !p.disabled) {
    state.offset = Number(p.dataset.page);
    return render();
  }
  const a = e.target.closest('[data-act]');
  if (a && !a.disabled && H[a.dataset.act]) H[a.dataset.act](a.dataset, a, e);
});
const H = {};
H.navOpen = () => navOpen(true);
H.navClose = () => navOpen(false);

// ---------- login ----------
function login(msg) {
  $('#who').textContent = '';
  $('#main').innerHTML = `<div class="login panel"><h1>Вхід в адмінку</h1>
    <p class="muted">${esc(msg || '')}</p>
    <p class="small muted">Введи ключ <b>ADMIN_KEY</b>, заданий на сервері. Або відкрий панель з Telegram командою <b>/admin</b> у боті (якщо твій ID є в ADMIN_IDS).</p>
    <form class="form" id="loginForm"><input id="key" type="password" placeholder="Ключ адміністратора" autocomplete="current-password"><button class="btn">Увійти</button></form></div>`;
  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    store.set($('#key').value.trim());
    start();
  });
}
// Quick search (side bar on a computer, top bar on a phone): an exact ID / @username (or a single match) opens the card,
// otherwise the list.
document.addEventListener('submit', async (e) => {
  if (!e.target.classList?.contains('qsearch')) return;
  e.preventDefault();
  const inp = e.target.querySelector('input');
  const q = inp.value.trim();
  if (!q) return;
  const r = await act('users', { query: q, sort: 'seen' });
  if (!r) return;
  const low = q.replace(/^@/, '').toLowerCase();
  const hit = r.list.find((u) => String(u.id) === low || (u.username || '').toLowerCase() === low) || (r.list.length === 1 ? r.list[0] : null);
  inp.value = '';
  inp.blur();
  if (hit) go('user', { userId: hit.id, userTab: 'cars' });
  else go('users', { query: q, sort: 'seen' });
});
H.logout = () => {
  store.set('');
  login('Ти вийшов.');
};

// ---------- overview ----------
// One bar per day; the tip (CSS, from data-tip: plain text) shows the exact value on hover / tap.
const dayLabel = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
function barChart(days, key, fmt = (n) => n) {
  const max = Math.max(1, ...days.map((d) => d[key]));
  return `<div class="chart" role="img"><div class="plot">${days.map((d) => `<div class="col" tabindex="0" data-tip="${esc(`${dayLabel(d.day)}: ${fmt(d[key])}`)}"><i style="height:${Math.max(d[key] ? 3 : 0, (d[key] / max) * 100)}%"></i></div>`).join('')}</div>
    <div class="axis"><span>${dayLabel(days[0].day)}</span><span>${dayLabel(days[days.length - 1].day)}</span></div></div>`;
}
// Money created (up) and destroyed (down) per day around one zero line.
function flowChart(days) {
  const max = Math.max(1, ...days.flatMap((d) => [d.created, d.destroyed]));
  return `<div class="legend"><span><i class="sw made"></i>створено</span><span><i class="sw gone"></i>вилучено</span></div>
    <div class="chart flow"><div class="plot">${days.map((d) => `<div class="col" tabindex="0" data-tip="${esc(`${dayLabel(d.day)}: +${short(d.created)} / −${short(d.destroyed)} · чисто ${d.created - d.destroyed >= 0 ? '+' : '−'}${short(Math.abs(d.created - d.destroyed))}`)}">
      <div class="up"><i class="made" style="height:${(d.created / max) * 100}%"></i></div><div class="down"><i class="gone" style="height:${(d.destroyed / max) * 100}%"></i></div></div>`).join('')}</div>
    <div class="axis"><span>${dayLabel(days[0].day)}</span><span>${dayLabel(days[days.length - 1].day)}</span></div></div>`;
}
const topList = (list, value) => (list.length ? `<ol class="top">${list.map((u) => `<li class="click" data-user="${u.id}"><span class="nm">${esc(u.name)}${u.banned ? ' <span class="badge red">бан</span>' : ''}</span><b>${value(u)}</b></li>`).join('')}</ol>` : '<div class="empty">Поки нікого</div>');
VIEWS.overview = async () => {
  const [o, dsh] = await Promise.all([api('overview'), api('dashboard', { days: state.days || 14 })]);
  const stat = (label, value, sub = '') => `<div class="stat"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const maxCls = Math.max(1, ...Object.values(o.classes));
  const crashProfit = o.crash24h.bet - o.crash24h.paid;
  const days = dsh.days, total = (k) => days.reduce((s, d) => s + d[k], 0);
  const net = total('created') - total('destroyed');
  const cod = dsh.caseOfDay;
  return `<div class="head"><h1>Огляд</h1>
      <div class="seg">${[7, 14, 30].map((n) => `<button class="${(state.days || 14) === n ? 'on' : ''}" data-act="days" data-n="${n}">${n} дн</button>`).join('')}</div>
      <button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    <div class="cards">
      ${stat('DAU сьогодні', dsh.dau, `WAU ${dsh.wau} · MAU ${dsh.mau}`)}
      ${stat('Гравців', o.users, `+${o.new24h} за добу`)}
      ${stat('Зірки за період', `⭐ ${total('stars')}`, `${total('payments')} платежів`)}
      ${stat('Економіка за період', `${net >= 0 ? '+' : '−'}${short(Math.abs(net))}`, `створено ${short(total('created'))} · вилучено ${short(total('destroyed'))}`)}
      ${stat('Кейс дня', esc(caseName(cod.today)), `−${Math.round(cod.off * 100)}% · завтра: ${esc(caseName(cod.tomorrow))}`)}
    </div>
    <div class="grid2">
      <div class="panel"><h2>Активні гравці (DAU)</h2>${barChart(days, 'dau')}</div>
      <div class="panel"><h2>Нові гравці за день</h2>${barChart(days, 'newUsers')}</div>
      <div class="panel"><h2>Відкрито кейсів за день</h2>${barChart(days, 'cases')}</div>
      <div class="panel"><h2>Зірки за день</h2>${barChart(days, 'stars', (n) => `⭐ ${n}`)}</div>
      <div class="panel wide"><h2>Здоров’я економіки <span class="sub">гривні, що з’явились і зникли за день</span></h2>${flowChart(days)}
        <div class="small muted">Угоди між гравцями рахуються з обох боків, тож важлива різниця: якщо «створено» стабільно більше за «вилучено», гроші знецінюються. Гривень у гравців зараз: <b>${short(days[days.length - 1].supply)}</b>.</div></div>
    </div>
    <details class="panel"><summary>Таблиця по днях</summary><div class="tbl-wrap"><table><tr><th>День</th><th class="num">DAU</th><th class="num">Нові</th><th class="num">Кейси</th><th class="num">Зірки</th><th class="num">Створено</th><th class="num">Вилучено</th><th class="num">У гравців</th></tr>
      ${[...days].reverse().map((d) => `<tr><td>${dayLabel(d.day)}</td><td class="num">${d.dau}</td><td class="num">${d.newUsers}</td><td class="num">${d.cases}</td><td class="num">${d.stars}</td><td class="num">${short(d.created)}</td><td class="num">${short(d.destroyed)}</td><td class="num">${short(d.supply)}</td></tr>`).join('')}</table></div></details>
    <div class="grid3">
      <div class="panel"><h2>Топ за статками</h2>${topList(dsh.top.rich, (u) => short(u.value + u.balance))}</div>
      <div class="panel"><h2>Топ донатерів</h2>${topList(dsh.top.payers, (u) => `⭐ ${u.stars}`)}</div>
      <div class="panel"><h2>Найактивніші за 7 днів</h2>${topList(dsh.top.active, (u) => `${u.drops} дропів`)}</div>
    </div>
    <h2 class="section">Зараз у грі</h2>
    <div class="cards">
      ${stat('Активні 24 год', o.active24h, `за 7 днів: ${o.active7d}`)}
      ${stat('Гривень у гравців', short(o.money))}
      ${stat('Вартість усіх гаражів', short(o.value))}
      ${stat('Машин у грі', o.cars, `номерів: ${o.plates}`)}
      ${stat('Кейсів відкрито', o.cases, `за добу: ${o.drops24h}`)}
      ${stat('Зірок отримано', `⭐ ${o.stars}`, `за добу: ${o.stars24h} · платежів ${o.payments}`)}
      ${stat('Ринок', `${o.listings} / ${o.auctions}`, `лоти / аукціони · обмінів ${o.trades}`)}
      ${stat('Краш за добу', o.crash24h.games, `ставки ${short(o.crash24h.bet)} · казино ${crashProfit >= 0 ? '+' : ''}${short(crashProfit)}`)}
      ${stat('Міни за добу', o.mines24h.games, `ставки ${short(o.mines24h.bet)}`)}
      ${stat('Заблоковано', o.banned)}
    </div>
    <div class="cols">
      <div class="panel"><h2>Машини за класами</h2><div class="bars">${S.CLASS_ORDER.map((c) => `<div class="bar">${cls(c)}<i style="--c:${S.CLASSES[c].color};width:${(o.classes[c] / maxCls) * 100}%"></i><span class="num">${o.classes[c]}</span></div>`).join('')}</div>
        <h2 style="margin-top:18px">Найчастіші моделі</h2>
        <table>${o.topModels.map((m) => `<tr><td>${cls(model(m.model).cls)} ${esc(model(m.model).name)}</td><td class="num">${m.n}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div>
      <div class="panel"><h2>Нові гравці</h2>${userTable(o.newest, false)}</div>
    </div>`;
};
H.reload = () => render();
// «Таємний покупець» (src/buyer.js): read-only numbers under «Огляд» — offers, sales, what was paid and the part above the dealer.
AFTER.overview = async () => {
  const main = $('#main');
  let b;
  try {
    b = await api('buyer');
  } catch {
    return;
  }
  if (state.view !== 'overview' || !main || main.querySelector('#tbAdmin')) return;
  const conv = (x) => (x.offers ? `${Math.round((x.sold / x.offers) * 100)}%` : '—');
  const el = document.createElement('div');
  el.className = 'panel';
  el.id = 'tbAdmin';
  el.innerHTML = `<h2>Таємний покупець <span class="sub">одна пропозиція на гравця на день, 3 год</span></h2>
    <div class="cards"><div class="stat"><span>Сьогодні</span><b>${b.today.sold} / ${b.today.offers}</b><small>продано / пропозицій · ${conv(b.today)}</small></div>
      <div class="stat"><span>Усього</span><b>${b.all.sold} / ${b.all.offers}</b><small>конверсія ${conv(b.all)}</small></div>
      <div class="stat"><span>Виплачено</span><b>${short(b.all.paid)}</b><small>з них понад дилера ${short(b.all.bonus)}</small></div></div>
    <div class="tbl-wrap"><table><tr><th>День</th><th class="num">Пропозицій</th><th class="num">Продано</th><th class="num">Виплачено</th><th class="num">Понад дилера</th></tr>
      ${b.days.map((d) => `<tr><td>${esc(d.day)}</td><td class="num">${d.offers}</td><td class="num">${d.sold}</td><td class="num">${short(d.paid)}</td><td class="num">${short(d.bonus)}</td></tr>`).join('') || '<tr><td class="muted" colspan="5">Ще не було</td></tr>'}</table></div>`;
  main.append(el);
};
H.days = (d) => ((state.days = Number(d.n)), render());
// ---------- metrics for the owner (public/admin-metrics.js) ----------
VIEWS.metrics = () => metricsPage({ api, esc, ic, short, days: state.mDays || 30 });
H.mdays = (d) => ((state.mDays = Number(d.n)), render());
// ---------- «Живий дашборд» (public/admin-pc.js, src/admin-pc.js live): refreshes itself every LIVE_MS ----------
// A refresh patches only the parts that changed (cards, who's online, the hourly charts), so nothing jumps or blinks;
// the daily charts come again every few minutes. A hidden tab doesn't poll; «Пауза» stops it until pressed again.
const LIVE_MS = 20e3, LIVE_DAYS_EVERY = 15; // ticks: the daily series every ~5 min
let lv = null, lvTimer = null, lvTicks = 0;
VIEWS.live = async () => {
  lv = await api('pc/live', { days: state.lvDays || 14 });
  return liveSkeleton(livePanels(lv, { esc, short, ago, userLink }), { ic, days: state.lvDays || 14 });
};
AFTER.live = () => {
  liveCharts(lv, lv.days);
  pauseLabel();
  clearInterval(lvTimer);
  lvTicks = 0;
  lvTimer = setInterval(lvTick, LIVE_MS);
};
async function lvTick(force = false) {
  if (state.view !== 'live') return clearInterval(lvTimer);
  if (!force && (document.hidden || state.lvPaused)) return;
  const withDays = ++lvTicks % LIVE_DAYS_EVERY === 0;
  let L;
  try {
    L = await api('pc/live', withDays ? { days: state.lvDays || 14 } : {});
  } catch {
    $('#lvStamp')?.classList.replace('green', 'red');
    return;
  }
  if (state.view !== 'live' || !$('#lvCards')) return;
  const P = livePanels(L, { esc, short, ago, userLink });
  const put = (sel, html) => {
    const el = $(sel);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  };
  put('#lvCards', P.cards);
  put('#lvWho', P.who);
  put('#lvNote', P.note);
  labelTables($('#lvWho'));
  const st = $('#lvStamp');
  st.textContent = P.stamp;
  st.classList.replace('red', 'green');
  liveCharts(L, withDays ? L.days : null);
  lv = { ...L, days: L.days || lv.days };
}
const pauseLabel = () => {
  const b = $('#lvPause');
  if (b) b.innerHTML = state.lvPaused ? `${ic('player-play')} Продовжити` : `${ic('clock')} Пауза`;
  $('#lvStamp')?.classList.toggle('paused', !!state.lvPaused);
};
H.lvPause = () => ((state.lvPaused = !state.lvPaused), pauseLabel(), state.lvPaused || lvTick(true));
H.lvNow = () => lvTick(true);
H.lvDays = (d) => ((state.lvDays = Number(d.n)), render());
document.addEventListener('visibilitychange', () => !document.hidden && state.view === 'live' && lvTick());

// ---------- «Економіка й кейси» (public/admin-pc.js economyPage, src/admin-pc.js economy) ----------
VIEWS.economy = () => economyPage({ api, esc, ic, short, money, userLink, win: state.ecWin || '24h', grow: state.ecGrow ?? null });
AFTER.economy = () => {
  economyCharts();
  $('#ecGrow')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = num('#ecGrowIn');
    if (!(v >= 0)) return toast('Вкажи суму, напр. 5m', true);
    state.ecGrow = v;
    render();
  });
};
H.ecWin = (d) => ((state.ecWin = d.k), render());

// ---------- «Перегляд бази» (owner and admins; public/admin-pc.js dbPage, src/admin-pc.js createDbBrowser) ----------
const dbv = () => (state.dbv ||= { table: null, filters: [], sort: null, dir: 'desc', offset: 0, q: '' });
let dbLast = null;
VIEWS.db = async () => {
  const V = dbv();
  const T = await api('db/tables');
  if (V.table && !T.tables.some((t) => t.name === V.table)) V.table = null;
  const R = V.table ? await api('db/rows', { table: V.table, filters: V.filters, sort: V.sort, dir: V.dir, offset: V.offset }) : null;
  dbLast = R;
  return dbPage(T, R, V, { esc, date });
};
const dbOpenCols = () => (dbLast?.cols || []).filter((c) => !c.hidden && !c.masked);
const dbSync = () => {
  const f = $('#dbForm');
  if (f) dbv().filters = readFilters(f);
};
const dbEmpty = () => {
  const n = $('.db-none');
  if (n) n.hidden = !!$('#dbForm .db-f');
};
AFTER.db = () => {
  dbEmpty();
  const on = $('.db-list button.on');
  if (on) on.parentElement.scrollTop = on.offsetTop - on.parentElement.clientHeight / 2;
  $('#dbForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    dbSync();
    dbv().offset = 0;
    render();
  });
  $('#dbForm')?.addEventListener('change', (e) => {
    if (!e.target.classList.contains('dfo')) return;
    const v = e.target.closest('.db-f').querySelector('.dfv');
    v.disabled = e.target.value === 'null' || e.target.value === 'notnull';
  });
  // the table list filters itself as you type (no round trip)
  $('#dbQ')?.addEventListener('input', (e) => {
    dbv().q = e.target.value.trim();
    const q = dbv().q.toLowerCase();
    document.querySelectorAll('.db-list button').forEach((b) => (b.hidden = !!q && !b.dataset.t.includes(q)));
  });
  $('#dbSel')?.addEventListener('change', (e) => H.dbTable({ t: e.target.value }));
};
H.dbTable = (d) => {
  Object.assign(dbv(), { table: d.t, filters: [], sort: null, dir: 'desc', offset: 0 });
  render();
};
H.dbSort = (d) => {
  dbSync();
  const V = dbv();
  if (V.sort === d.c) V.dir = V.dir === 'asc' ? 'desc' : 'asc';
  else Object.assign(V, { sort: d.c, dir: 'desc' });
  V.offset = 0;
  render();
};
H.dbPage = (d) => {
  dbSync();
  dbv().offset = Number(d.o);
  render();
};
H.dbFAdd = () => {
  const cols = dbOpenCols();
  if (!cols.length) return;
  $('#dbForm .db-flist').insertAdjacentHTML('beforeend', dbFilterRow(cols, { col: cols[0].name, op: 'has', value: '' }, esc));
  dbEmpty();
  [...document.querySelectorAll('#dbForm .dfv')].pop()?.focus();
};
H.dbFDel = (d, el) => (el.closest('.db-f').remove(), dbEmpty());
H.dbReset = () => (Object.assign(dbv(), { filters: [], sort: null, dir: 'desc', offset: 0 }), render());
// The export is the current filter and sort, built on the server (EXPORT_CAP rows at most), saved here as a file
// with a BOM so Excel reads the Cyrillic right.
H.dbExport = async () => {
  dbSync();
  const V = dbv();
  const r = await act('db/export', { table: V.table, filters: V.filters, sort: V.sort, dir: V.dir });
  if (!r) return;
  const url = URL.createObjectURL(new Blob(['\ufeff' + r.csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${r.table}-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Експортовано ${r.n} рядків${r.truncated ? ` (обрізано до ${r.n})` : ''}`);
};

// ---------- «Заїзд дня»: the car schedule and today's board (public/admin-dayrace.js) ----------
VIEWS.dayrace = () => dayRacePage({ api, esc, cls, userLink });
Object.assign(H, dayRaceActions({ mutate, esc, $ }));
// ---------- «Ніч Хелловіну»: dates, the switch, what players got (public/admin-halloween.js) ----------
VIEWS.halloween = () => halloweenPage({ api, esc, date });
Object.assign(H, halloweenActions({ mutate }));
// ---------- «Канал»: auto-posts to the Telegram channel (public/admin-channel.js, src/channel.js) ----------
VIEWS.channel = () => channelPage({ api, esc, date });
Object.assign(H, channelActions({ mutate, $, api }));
Object.assign(ACTIONS, { 'channel-set': 'Канал: налаштування', 'channel-test': 'Канал: тестовий пост', 'channel-target': 'Автопости: тема (/here)', 'channel-target-clear': 'Автопости: тему скинуто' });
// ---------- «Події»: what runs now, the next 8 weeks and the events scheduler (public/admin-events.js) ----------
VIEWS.events = () => eventsPage({ api, esc, ic });
AFTER.events = () => eventsAfter({ $ });
Object.assign(H, eventsActions({ mutate, render, esc }));
// ---------- «Автоклуби»: clubs, treasuries, league weeks, moderation (public/admin-clubs.js) ----------
VIEWS.clubs = () => clubsPage({ api, esc, date, userLink });
Object.assign(H, clubsActions({ mutate }));
Object.assign(ACTIONS, { 'clubs-reset': 'Клуб: скинуто', 'clubs-disband': 'Клуб розпущено' });
// ---------- «🐞 Знайдені баги»: rewards for found bugs (public/admin-bugs.js, src/bugbounty.js) ----------
VIEWS.bugs = () => bugsPage({ api, esc, date, userLink });
Object.assign(H, bugsActions({ mutate, toast, go, state, esc, $ }));
Object.assign(ACTIONS, { 'bug-reward': 'Нагорода за баг' });
Object.assign(ACTIONS, { 'dayrace-set': 'Заїзд дня: машина', 'dayrace-dq': 'Заїзд дня: результат' });
function userTable(list, rich) {
  if (!list.length) return '<div class="empty">Гравців поки немає</div>';
  return `<div class="tbl-wrap"><table><tr><th>Гравець</th><th class="num">${rich ? 'Гараж + гривні' : 'Зареєстр.'}</th></tr>
    ${list.map((u) => `<tr class="click" data-user="${u.id}"><td>${esc(u.name)} ${u.banned ? '<span class="badge red">бан</span>' : ''}<div class="muted small">${u.id} · рів. ${u.level} · авто ${u.cars}</div></td>
      <td class="num">${rich ? short(u.value + u.balance) : ago(u.createdAt)}</td></tr>`).join('')}</table></div>`;
}

// ---------- players ----------
VIEWS.users = async () => {
  const { list, total } = await api('users', { query: state.query, sort: state.sort, offset: state.offset });
  return `<div class="head"><h1>Гравці <span class="muted" style="font-size:16px">${total}</span></h1></div>
    <div class="panel">
      <form class="row" id="userSearch" style="margin-bottom:12px">
        <input class="grow m-full" id="q" type="search" enterkeyhint="search" placeholder="ID, @username або ім’я" value="${esc(state.query)}">
        <select id="sort" class="m-grow">${[['value', 'За вартістю'], ['balance', 'За гривнями'], ['seen', 'Нещодавно в грі'], ['new', 'Нові'], ['level', 'За рівнем'], ['play', 'За часом у грі']].map(([k, t]) => `<option value="${k}" ${state.sort === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <button class="btn">Знайти</button>
      </form>
      ${list.length ? `<div class="tbl-wrap"><table>
        <tr><th class="hide-m">ID</th><th>Гравець</th><th class="num">Рівень</th><th class="num">Гривні</th><th class="num hide-m">Вартість гаража</th><th class="num hide-m">Авто</th><th class="num hide-m">Кейсів</th><th class="num hide-m">Час у грі</th><th class="hide-m">Запросив</th><th class="hide-m">Реєстрація</th><th class="hide-m">Був у грі</th><th class="hide-m"></th></tr>
        ${list.map((u) => `<tr class="click" data-user="${u.id}"><td class="muted hide-m">${u.id}</td><td><b>${esc(u.name)}</b>${u.banned ? ' <span class="badge red">бан</span>' : ''}${u.role ? ` <span class="badge amber">${esc(ROLE_NAMES[u.role] || u.role)}</span>` : ''}${u.username && u.firstName ? `<div class="muted small">${esc(u.firstName)}</div>` : ''}<div class="muted small show-m">${u.id} · ${ago(u.lastSeen)}</div></td>
          <td class="num">${u.level}</td><td class="num">${short(u.balance)}</td><td class="num hide-m">${money(u.value)}</td><td class="num hide-m">${u.cars}</td><td class="num hide-m">${u.cases}</td><td class="num nowrap hide-m">${playTime(u.playMs)}</td>
          <td class="small hide-m">${u.referrer ? esc(u.referrer.name) : '<span class="muted">сам</span>'}</td><td class="small nowrap hide-m">${date(u.createdAt)}</td>
          <td class="small hide-m">${ago(u.lastSeen)}</td><td class="hide-m"></td></tr>`).join('')}
      </table></div>${pager(state.offset, 50, list.length, total)}` : '<div class="empty">Нікого не знайдено</div>'}
    </div>`;
};
AFTER.users = () => {
  $('#userSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    state.query = $('#q').value.trim();
    state.sort = $('#sort').value;
    state.offset = 0;
    render();
  });
  $('#sort').addEventListener('change', () => $('#userSearch').requestSubmit());
};

// ---------- one player ----------
let cur = null;
let curX = null; // src/admin-pc.js player(): money by day and «Підозріле»
VIEWS.user = async () => {
  [cur, curX] = await Promise.all([api('user', { id: state.userId }), api('pc/player', { id: state.userId }).catch(() => null)]);
  const { user: u, income, cars, plates, parts, keys, payments, events, drops, log, carLog = [] } = cur;
  const tabs = [['cars', 'Машини', cars.length], ['friends', 'Запрошені', u.invited.length], ['plates', 'Номери', plates.length], ['parts', 'Деталі', parts.reduce((s, p) => s + p.count, 0)],
    ['keys', 'Ключі', keys.reduce((s, k) => s + k.count, 0)], ['drops', 'Дропи', drops.length], ['payments', 'Платежі', payments.length],
    ['carlog', 'Історія машин', carLog.length], ['events', 'Сповіщення', events.length], ['log', 'Дії адмінів', log.length]];
  const starsPaid = payments.reduce((s, p) => s + p.stars, 0);
  return `<div class="crumb"><a data-go="users">‹ Усі гравці</a></div>
    <div class="head"><h1>${esc(u.name)}</h1>${u.role ? `<span class="badge amber">${ic('shield-check')} ${ROLE_NAMES[u.role]}</span>` : ''}${u.lbHidden ? `<span class="badge">${ic('trophy')} прихований з рейтингу</span>` : ''}${u.banned ? `<span class="badge red">${ic('lock')} заблокований${u.banReason ? `: ${esc(u.banReason)}` : ''}</span>` : ''}
      ${u.legacy ? `<span class="badge blue" title="Грав у першу версію">${ic('clock')} гравець v1${u.legacy.stars ? ` · ⭐ ${u.legacy.stars}` : ''}</span>` : ''}
      <button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    <div class="hero-row">
      <div class="hero-num"><span>Гривні</span><b>${money(u.balance)}</b></div>
      <div class="hero-num"><span>Гараж</span><b>${money(u.value)}</b></div>
      <div class="hero-num"><span>Рівень</span><b>${u.level}</b></div>
      <div class="hero-num"><span>Зірки (оплати)</span><b>⭐ ${starsPaid}</b></div>
      <div class="hero-num"><span>Був у грі</span><b>${ago(u.lastSeen)}</b></div>
    </div>
    ${quickActs(u)}
    <details class="panel" ${state.userInfo ?? wide() ? 'open' : ''} data-remember="userInfo"><summary>Профіль і статистика</summary><div class="kv">
      <div><span>Telegram ID</span><b>${u.id}</b></div>
      <div><span>Username</span><b>${u.username ? '@' + esc(u.username) : '—'}</b></div>
      <div><span>Ім’я</span><b>${esc(u.firstName || '—')}</b></div>
      <div><span>Статус</span><b>${u.banned ? '<span class="bad">заблокований</span>' : '<span class="win">активний</span>'}</b></div>
      <div><span>Зірки на рахунку</span><b>⭐ ${u.stars || 0}</b></div>
      <div><span>VIP</span><b>${u.vipUntil > Date.now() ? `до ${date(u.vipUntil)}` : '—'}</b></div>
      <div><span>Днів у грі</span><b>${u.activeDays}</b></div>
      <div><span>Гравець першої версії</span><b>${u.legacy ? `так${u.legacy.stars ? ` · донатив ⭐ ${u.legacy.stars}` : ''}${u.legacy.thanked ? ' · подяку отримав' : ''}` : 'ні'}</b></div>
      <div><span>Уламки ключів</span><b>${cur.fragments.length ? cur.fragments.map((f) => `${esc(caseName(f.caseId))} ${f.count}`).join(', ') : '—'}</b></div>
      <div><span>Дохід / год</span><b>${money(income.rate)}</b></div>
      <div><span>Накопичено доходу</span><b>${money(income.pending)}</b></div>
      <div><span>Рівень</span><b>${u.level} <span class="muted small">${u.xp}/${u.xpNeed} XP</span></b></div>
      <div><span>Місць у гаражі</span><b>${cars.filter((c) => c.status !== 'showcase').length}/${u.slots}</b></div>
      <div><span>Вітрина</span><b>${cars.filter((c) => c.status === 'showcase').length}/${u.showcaseSlots}</b></div>
      <div><span>Сховище доходу</span><b>${S.CAP_LEVELS[u.capLevel]?.hours} год</b></div>
      <div><span>Колекція</span><b>${u.collection}/${S.ALL_MODELS.length}</b></div>
      <div><span>Кейсів / гонок / перемог</span><b>${u.stats.cases} / ${u.stats.races} / ${u.stats.wins}</b></div>
      <div><span>Серія входів</span><b>${u.streak}</b></div>
      <div><span>Запросив друзів</span><b>${u.referrals}</b></div>
      <div><span>Прийшов від</span><b>${u.referrer ? `<a data-user="${u.referrer.id}">${esc(u.referrer.name)}</a>` : '—'}</b></div>
      <div><span>Реєстрація</span><b>${date(u.createdAt)}</b></div>
      <div><span>Був у грі</span><b>${ago(u.lastSeen)}</b></div>
      <div><span>Час у грі</span><b>${playTime(u.playMs)}</b></div>
      <div><span>Досягнення</span><b>${u.achievements.claimed}/${u.achievements.total}${u.achievements.reached > u.achievements.claimed ? ` <span class="muted small">(ще ${u.achievements.reached - u.achievements.claimed} не забрано)</span>` : ''}</b></div>
      ${bugCardLine(cur.bugs, esc)}
    </div></details>
    ${wide() ? wideCard(u, tabs) : `<div class="panel">
      <div class="tabs">${tabs.map(([k, t, n]) => `<button class="${state.userTab === k ? 'on' : ''}" data-act="userTab" data-k="${k}">${t}<span class="n">${n}</span></button>`).join('')}</div>
      ${USER_TABS[state.userTab]()}
    </div>
    <details class="panel" ${state.userAct ? 'open' : ''} data-remember="userAct"><summary>${ic('gauge')} Активність</summary>${activityHtml(cur.activity)}</details>
    ${curX ? `<details class="panel" ${state.userSus ?? curX.suspicious.length ? 'open' : ''} data-remember="userSus"><summary>${ic('alert-triangle')} Підозріле ${susBadge()}</summary>${playerSuspicious(curX, { esc })}</details>
    <details class="panel" ${state.userMoney ? 'open' : ''} data-remember="userMoney"><summary>${ic('cash')} Гроші по днях</summary>${playerMoney(curX, { short })}</details>` : ''}`}
    <div class="panel" id="controls"><h2>${ic('adjustments')} Керування</h2>
      <div class="small muted" style="margin-bottom:10px">Кожна зміна просить причину й підтвердження та записується в журнал дій.</div>${controls(u)}</div>`;
};
const susBadge = () => (curX?.suspicious.length ? `<span class="badge ${curX.suspicious.some((x) => x.level === 'red') ? 'red' : 'amber'}">${curX.suspicious.length}</span>` : '<span class="badge green">чисто</span>');
// The wide card: garage and money by day in the main column; «Підозріле», profile and activity beside them; every
// former tab as its own panel below (scrolling inside when long), so nothing hides behind a tab on a big screen.
function wideCard(u, tabs) {
  const n = Object.fromEntries(tabs.map(([k, , c]) => [k, c]));
  const P = [['carlog', 'Історія машин'], ['payments', 'Платежі'], ['drops', 'Дропи'], ['log', 'Дії адмінів'], ['events', 'Сповіщення'], ['friends', 'Запрошені'], ['plates', 'Номери'], ['parts', 'Деталі'], ['keys', 'Ключі']];
  return `<div class="u-cols">
      <div class="u-main">
        <div class="panel"><h2>${ic('car')} Гараж <span class="sub">${n.cars} авто</span></h2>${USER_TABS.cars()}</div>
        ${curX ? `<div class="panel"><h2>${ic('cash')} Гроші по днях <span class="sub">14 днів, з того, що зберігає гра</span></h2>${playerMoney(curX, { short })}</div>` : ''}
      </div>
      <div class="u-side">
        ${curX ? `<div class="panel"><h2>${ic('alert-triangle')} Підозріле ${susBadge()}</h2>${playerSuspicious(curX, { esc })}</div>` : ''}
        <div class="panel"><h2>${ic('gauge')} Активність</h2>${activityHtml(cur.activity)}</div>
      </div>
    </div>
    <div class="pc-panels">${P.filter(([k]) => n[k]).map(([k, t]) => `<div class="panel pcp"><h2>${t} <span class="sub">${n[k]}</span></h2><div class="pcp-body">${USER_TABS[k]()}</div></div>`).join('')}</div>
    ${P.some(([k]) => !n[k]) ? `<div class="small muted pc-empty">Порожньо: ${P.filter(([k]) => !n[k]).map(([, t]) => t).join(', ')}</div>` : ''}`;
}
document.addEventListener('toggle', (e) => {
  const k = e.target.dataset?.remember;
  if (k) state[k] = e.target.open;
}, true);
// Live check while typing a plate: is the format valid, which class, and is it free.
function plateVerdict(r) {
  if (r.error) return `<span class="bad">${esc(r.error)}</span>`;
  const what = `${cls(r.cls)} ${esc(r.label)} · ${esc(r.region)}`;
  return r.owner ? `<span class="bad">Зайнятий: ${userLink(r.owner)}</span> · ${what}` : `<span class="win">Вільний ✓</span> · ${what}`;
}
let checkTimer;
AFTER.user = () => {
  const inp = $('#plText');
  inp?.addEventListener('input', () => {
    clearTimeout(checkTimer);
    $('#plBtn').disabled = true;
    const v = inp.value.trim();
    if (v.length < 8) return ($('#plCheck').innerHTML = '<span class="muted">Можна писати кирилицею і без пробілів</span>');
    checkTimer = setTimeout(async () => {
      try {
        const r = await api('check-plate', { text: v });
        if (inp.value.trim() !== v) return;
        $('#plCheck').innerHTML = plateVerdict(r);
        $('#plBtn').disabled = !!(r.error || r.owner);
        $('#plBtn').dataset.text = r.text;
      } catch (e) {
        $('#plCheck').innerHTML = `<span class="bad">${esc(e.message)}</span>`;
      }
    }, 250);
  });
};
const who = () => `<span class="who"><b>${esc(cur.user.name)}</b> <span class="muted">(${cur.user.id})</span></span>`;
H.givePlate = (d, el) => mutate('give-plate', { id: uid(), text: el.dataset.text, value: num('#plValue') || null, carId: Number($('#plCar').value) || null, note: $('#plNote').value.trim() },
  { title: 'Видати номер', summary: `${plate(el.dataset.text)} → ${who()}`, button: 'Видати' }, (r) => `Номер ${r.text} видано`);
H.removePlate = (d) => {
  const p = cur.plates.find((x) => x.id === Number(d.id));
  mutate('remove-plate', { plateId: Number(d.id) }, { title: 'Забрати номер', summary: `${plate(p?.text)} у ${who()} — номер зникне з гри`, danger: true, button: 'Забрати' }, 'Номер забрано');
};
function activityHtml(a) {
  const pctOf = (x, n) => (n ? ` · ${Math.round((x / n) * 100)}%` : '');
  const crashProfit = a.crash.paid - a.crash.bet;
  const box = (title, value, sub = '') => `<div><span>${title}</span><b>${value}</b>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
  const maxCls = Math.max(1, ...Object.values(a.cases.byClass));
  return `<div class="kv">
      ${box('Відкрито кейсів з авто', a.cases.total, `з деталями: ${a.cases.parts}`)}
      ${box('Найдорожча машина', a.best ? esc(model(a.best.model).name) : '—', a.best ? money(a.best.value) : '')}
      ${box('Номери', a.plates.n, a.plates.n ? `на ${money(a.plates.value)}` : '')}
      ${box('Краш', `${a.crash.games} ігор`, a.crash.games ? `ставки ${short(a.crash.bet)} · ${crashProfit >= 0 ? '<span class="win">+' : '<span class="bad">'}${short(crashProfit)}</span>` : '')}
      ${box('Міни', `${a.mines.games} ігор`, a.mines.games ? `ставки ${short(a.mines.bet)} · виграшів ${a.mines.wins}${pctOf(a.mines.wins, a.mines.games)}` : '')}
      ${box('Кейс-батли', `${a.battles.won} / ${a.battles.n}`, a.battles.n ? `перемог${pctOf(a.battles.won, a.battles.n)} · поставлено ${short(a.battles.spent)}` : '')}
      ${box('PvP', `${a.pvp.won} / ${a.pvp.n}`, a.pvp.n ? `перемог${pctOf(a.pvp.won, a.pvp.n)} · ставки ${short(a.pvp.bets)}` : '')}
      ${box('Обміни', a.trades, 'завершених')}
      ${box('Аукціони', `${a.auctions.sold.n} продано / ${a.auctions.won.n} виграно`, a.auctions.sold.n || a.auctions.won.n ? `${short(a.auctions.sold.sum)} / ${short(a.auctions.won.sum)}` : '')}
      ${box('Лоти на ринку зараз', a.listed)}
      ${box('Купівлі за зірки', a.stars.n ? `⭐ ${a.stars.stars}` : '—', a.stars.n ? `${a.stars.n} платежів · ${short(a.stars.amount)}` : '')}
      ${box('Промокоди', a.promos.length ? esc(a.promos.join(', ')) : '—')}
    </div>
    ${a.cases.total ? `<div class="cols" style="margin-top:14px">
      <div><div class="small muted" style="margin-bottom:6px">Дропи за класами</div><div class="bars">${S.CLASS_ORDER.map((c) => `<div class="bar">${cls(c)}<i style="--c:${S.CLASSES[c].color};width:${(a.cases.byClass[c] / maxCls) * 100}%"></i><span class="num">${a.cases.byClass[c]}</span></div>`).join('')}</div></div>
      <div><div class="small muted" style="margin-bottom:6px">Які кейси відкривав</div><table>${Object.entries(a.cases.byCase).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<tr><td>${esc(caseName(k))}</td><td class="num">${n}</td></tr>`).join('')}</table></div>
    </div>` : ''}`;
}
H.userTab = (d) => {
  state.userTab = d.k;
  render();
};
const ROLE_NAMES = { owner: 'Власник', admin: 'Адмін', helper: 'Хелпер' };
// Rights block: the owner gives Admin or Helper; an admin can give and take Helper.
function roleBlock(u) {
  if (u.role === 'owner') return `<div class="act" id="act-role"><h3>${ic('shield-check')} Права</h3><div class="small muted">Власник гри (ADMIN_IDS на сервері) — змінюється тільки там.</div></div>`;
  const opts = [['', 'Гравець'], ['helper', 'Хелпер — гравці, підтримка, повідомлення'], ...(state.role === 'owner' ? [['admin', 'Адмін — усе, крім видачі адмінки']] : [])];
  return `<div class="act" id="act-role"><h3>${ic('shield-check')} Права в адмін-панелі</h3>
    <div class="small muted">Зараз: <b>${ROLE_NAMES[u.role] || 'гравець'}</b>. Адмін-панель з’явиться в меню гри.</div>
    <select id="roleSel">${opts.map(([v, t]) => `<option value="${v}" ${(u.role || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <button class="btn sm" data-act="setRole">${ic('check')} Зберегти</button></div>`;
}
H.setRole = () => {
  const role = $('#roleSel').value;
  mutate('role', { id: uid(), role }, { title: 'Права в адмін-панелі', summary: `${who()}: ${esc(ROLE_NAMES[cur.user.role] || 'гравець')} → <b>${esc(ROLE_NAMES[role] || 'гравець')}</b>`, danger: true, button: 'Змінити права' }, 'Права оновлено');
};
function controls(u) {
  const models = [...S.ALL_MODELS].sort((a, b) => S.CLASS_ORDER.indexOf(a.cls) - S.CLASS_ORDER.indexOf(b.cls) || a.price - b.price);
  // A helper only writes messages to players.
  if (state.role === 'helper') return `<div class="actions"><div class="act" id="act-msg"><h3>${ic('bell')} Повідомлення</h3>
      <textarea id="msgText" placeholder="Текст прийде в сповіщення гри та в бот"></textarea>
      <button class="btn ghost sm" data-act="message">Надіслати</button></div></div>`;
  return `<div class="actions">
    ${roleBlock(u)}
    <div class="act" id="act-bug"><h3>🐞 Знайдені баги <span class="muted small">нагороджено: ${cur.bugs?.count || 0}${cur.bugs?.badge ? ` · ${esc(cur.bugs.badge)}` : ''}</span></h3>
      ${bugChooser({ esc, user: { id: u.id, name: u.name } })}</div>
    <div class="act" id="act-money"><h3>${ic('cash')} Гривні</h3>
      <input id="mAmount" inputmode="decimal" placeholder="Сума: 100000, 250k, 1.5m">
      <input id="mNote" placeholder="Повідомлення гравцю (необов’язково)">
      <div class="row"><button class="btn green sm grow" data-act="money" data-sign="1">${ic('plus')} Нарахувати</button><button class="btn red sm grow" data-act="money" data-sign="-1">${ic('minus')} Списати</button></div></div>
    ${state.role === 'owner' ? `<div class="act" id="act-vip"><h3>${ic('crown')} Пропуск і VIP <span class="muted small">лише власник</span></h3>
      <div class="small muted">Пропуск: ${u.premiumSeason === S.seasonOf(Date.now()) ? '<b class="win">є в цьому сезоні</b>' : 'немає'} · VIP: ${u.vipUntil > Date.now() ? `до ${date(u.vipUntil)}` : 'немає'}</div>
      <div class="row"><button class="btn sm grow" data-act="grantPass" ${u.premiumSeason === S.seasonOf(Date.now()) ? 'disabled' : ''}>${ic('gift')} Преміум-пропуск</button></div>
      <div class="row"><input id="vipDays" class="grow" inputmode="numeric" value="7" placeholder="Днів"><button class="btn sm" data-act="grantVip">${ic('crown')} VIP на N днів</button></div></div>` : ''}
    <div class="act" id="act-car"><h3>${ic('car')} Видати машину</h3>
      <select id="gModel">${S.CLASS_ORDER.map((c) => `<optgroup label="Клас ${c} · ${S.CLASSES[c].name}">${models.filter((m) => m.cls === c).map((m) => `<option value="${m.id}">${esc(m.name)} — ${short(m.price)}${m.secret ? ' (секретна)' : ''}</option>`).join('')}</optgroup>`).join('')}</select>
      <label class="row small muted check-l"><input type="checkbox" id="gNotify" checked style="width:auto"> Повідомити гравця</label>
      <button class="btn sm" data-act="giveCar">${ic('gift')} Видати</button></div>
    <div class="act" id="act-parts"><h3>${ic('tool')} Деталі</h3>
      <div class="row"><select id="pType" class="grow">${S.PART_KEYS.map((k) => `<option value="${k}">${esc(S.PARTS[k].name)}</option>`).join('')}</select>
        <select id="pTier" class="grow">${S.TIERS.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div class="row"><input id="pCount" class="grow" inputmode="numeric" value="1"><button class="btn green sm sq" data-act="part" data-sign="1" aria-label="Видати">${ic('plus')}</button><button class="btn red sm sq" data-act="part" data-sign="-1" aria-label="Забрати">${ic('minus')}</button></div></div>
    <div class="act" id="act-keys"><h3>${ic('key')} Ключі від кейсів</h3>
      <select id="kCase">${S.CASES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <div class="row"><input id="kCount" class="grow" inputmode="numeric" value="1"><button class="btn green sm sq" data-act="keys" data-sign="1" aria-label="Видати">${ic('plus')}</button><button class="btn red sm sq" data-act="keys" data-sign="-1" aria-label="Забрати">${ic('minus')}</button></div></div>
    <div class="act" id="act-plate"><h3>${ic('license')} Видати номер</h3>
      <input id="plText" placeholder="AA 1234 BC" autocomplete="off" style="text-transform:uppercase">
      <div class="check" id="plCheck"><span class="muted">Можна писати кирилицею і без пробілів</span></div>
      <div class="row"><input id="plValue" class="grow" inputmode="numeric" placeholder="Вартість (авто за класом)">
        <select id="plCar" class="grow"><option value="">на склад</option>${cur.cars.filter((c) => !c.plate).map((c) => `<option value="${c.id}">на ${esc(model(c.model).name)} #${c.id}</option>`).join('')}</select></div>
      <input id="plNote" maxlength="300" placeholder="Повідомлення гравцю (необов’язково)">
      <button class="btn sm" data-act="givePlate" id="plBtn" disabled>${ic('gift')} Видати номер</button></div>
    <div class="act" id="act-set"><h3>${ic('gauge')} Параметри</h3>
      ${[['level', 'Рівень', u.level], ['slots', 'Місць у гаражі', u.slots], ['showcase_slots', 'Місць на вітрині', u.showcaseSlots], ['cap_level', `Рівень сховища (0–${S.CAP_LEVELS.length - 1})`, u.capLevel]]
        .map(([f, t, v]) => `<div class="row"><span class="grow small">${t}</span><input id="set-${f}" value="${v}" inputmode="numeric" style="width:80px"><button class="btn ghost sm" data-act="set" data-f="${f}">OK</button></div>`).join('')}</div>
    <div class="act" id="act-msg"><h3>${ic('bell')} Повідомлення</h3>
      <textarea id="msgText" placeholder="Текст прийде в сповіщення гри та в бот"></textarea>
      <button class="btn ghost sm" data-act="message">Надіслати</button></div>
    <div class="act" id="act-reset"><h3>${ic('refresh')} Обнулити прогрес</h3>
      <div class="small muted">Зникнуть усі машини, номери, деталі, гривні, рівень і колекція — як новий гравець. Лишаються акаунт, хто запросив, оплати й бан.</div>
      <button class="btn red sm" data-act="resetUser">${ic('refresh')} Обнулити гравця</button></div>
    <div class="act" id="act-lb"><h3>${ic('trophy')} Рейтинг</h3>
      ${u.lbHidden ? `<div class="small">Гравець прихований з усіх рейтингів (тиждень, увесь час, сезон, «Статок») і не отримує призів тижня. Гараж і гроші — без змін.</div>
        <button class="btn green sm" data-act="lbHide" data-v="0">Показати в рейтингу</button>`
        : `<div class="small muted">Сховати з усіх рейтингів і призів тижня. Гравець далі грає як звичайно; повернути можна будь-коли.</div>
        <button class="btn ghost sm" data-act="lbHide" data-v="1">Приховати з рейтингу</button>`}</div>
    <div class="act" id="act-ban"><h3>${ic('lock')} Блокування</h3>
      ${u.banned ? `<div class="small">Гравець заблокований${u.banReason ? `: ${esc(u.banReason)}` : ''}. Не може грати, його лоти знято з ринку.</div>
        <button class="btn green sm" data-act="ban" data-v="0">Розблокувати</button>`
        : `<div class="small muted">Гравець не зможе грати, його лоти знімуться з ринку.</div>
        <button class="btn red sm" data-act="ban" data-v="1">Заблокувати</button>`}</div>
  </div>`;
}
// Phone: big buttons right under the numbers, each jumps to its block in «Керування» (with the cursor in the field where
// typing is the point) instead of scrolling past the garage and the tabs. admin.css shows it on a narrow screen only.
function quickActs(u) {
  const list = state.role === 'helper' ? [['msg', 'bell', 'Повідомлення']] : [
    ['money', 'cash', 'Гривні'], ['keys', 'key', 'Ключі'], ['car', 'car', 'Машина'], ['msg', 'bell', 'Повідомлення'],
    ['plate', 'license', 'Номер'], ['parts', 'tool', 'Деталі'], ...(state.role === 'owner' ? [['vip', 'crown', 'VIP, пропуск']] : []), ['set', 'gauge', 'Параметри'],
    ['bug', 'bug', 'За баг'], ['lb', 'trophy', u.lbHidden ? 'У рейтинг' : 'З рейтингу'], ['role', 'shield-check', 'Права'],
    ['ban', 'lock', u.banned ? 'Розбан' : 'Бан', u.banned ? 'ok' : 'red'], ['reset', 'refresh', 'Обнулити', 'red']];
  return `<div class="quick m-only" role="group" aria-label="Керування гравцем">${list.map(([k, i, t, c = '']) => `<button class="${c}" data-act="jump" data-to="act-${k}">${ic(i)}<span>${t}</span></button>`).join('')}</div>`;
}
const JUMP_FOCUS = { 'act-money': '#mAmount', 'act-msg': '#msgText', 'act-plate': '#plText' };
H.jump = (d) => {
  const el = document.getElementById(d.to);
  if (!el) return;
  const pick = el.querySelector('.bb-pick[hidden]');
  if (pick) pick.hidden = false;
  if (JUMP_FOCUS[d.to]) $(JUMP_FOCUS[d.to], el)?.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
};
const uid = () => state.userId;
// "1 000 000", "1_000_000", "1.5m", "250k" → number.
function num(sel) {
  const s = String($(sel).value).trim().toLowerCase().replace(/[\s_]/g, '').replace(',', '.');
  const m = /^(-?\d+(?:\.\d+)?)(k|к|m|м|b|б)?$/.exec(s);
  if (!m) return s ? NaN : 0;
  return Math.round(Number(m[1]) * ({ k: 1e3, к: 1e3, m: 1e6, м: 1e6, b: 1e9, б: 1e9 }[m[2]] || 1));
}
async function doAndReload(name, body, ok) {
  if (await act(name, body, ok)) render();
}
H.money = (d) => {
  const n = num('#mAmount');
  if (!(n > 0)) return toast('Вкажи додатну суму', true);
  const amount = n * Number(d.sign);
  const take = amount < 0;
  const bal = cur.user.balance;
  mutate('money', { id: uid(), amount, note: $('#mNote').value.trim() }, {
    title: take ? 'Списати гривні' : 'Нарахувати гривні', danger: take, button: take ? 'Списати' : 'Нарахувати',
    summary: `${who()}<div class="delta"><span>${money(bal)}</span> → <b class="${take ? 'bad' : 'win'}">${money(Math.max(0, bal + amount))}</b> <span class="${take ? 'bad' : 'win'}">(${take ? '−' : '+'}${money(Math.min(Math.abs(amount), take ? bal : Infinity))})</span></div>${take && -amount > bal ? '<div class="small muted">Більше, ніж є — баланс стане 0.</div>' : ''}`,
  }, (r) => `Баланс: ${money(r.balance)}`);
};
H.grantPass = () => mutate('grant-premium', { id: uid(), what: 'pass' }, { title: 'Видати преміум-пропуск', summary: `Преміум-пропуск поточного сезону → ${who()}`, button: 'Видати' }, 'Пропуск видано');
H.grantVip = () => {
  const d = Number($('#vipDays').value) || 7;
  mutate('grant-premium', { id: uid(), what: 'vip', days: d }, { title: 'Видати VIP', summary: `VIP на <b>${d}</b> дн. → ${who()}`, button: 'Видати' }, `VIP на ${d} дн. видано`);
};
H.giveCar = () => {
  const m = $('#gModel').value;
  mutate('give-car', { id: uid(), model: m, notify: $('#gNotify').checked }, { title: 'Видати машину', summary: `${cls(model(m).cls)} <b>${esc(model(m).name)}</b> (${money(model(m).price)}) → ${who()}`, button: 'Видати' }, `${model(m).name} видано`);
};
function giveTake(name, body, n, what) {
  const take = n < 0;
  return mutate(name, body, { title: take ? 'Забрати' : 'Видати', summary: `${what} × <b>${Math.abs(n)}</b> ${take ? 'у' : '→'} ${who()}`, danger: take, button: take ? 'Забрати' : 'Видати' }, take ? 'Забрано' : 'Видано');
}
H.part = (d) => {
  const n = num('#pCount') * Number(d.sign);
  if (!n) return toast('Вкажи кількість', true);
  const type = $('#pType').value, tier = $('#pTier').value;
  giveTake('part', { id: uid(), type, tier, count: n }, n, `${cls(tierCls(tier))} ${esc(partName(type, tier))}`);
};
H.keys = (d) => {
  const n = num('#kCount') * Number(d.sign);
  if (!n) return toast('Вкажи кількість', true);
  const caseId = $('#kCase').value;
  giveTake('keys', { id: uid(), caseId, count: n }, n, `${ic('key')} ${esc(caseName(caseId))}`);
};
H.set = (d) => {
  const value = num('#set-' + d.f);
  const was = { level: cur.user.level, slots: cur.user.slots, showcase_slots: cur.user.showcaseSlots, cap_level: cur.user.capLevel }[d.f];
  mutate('set', { id: uid(), field: d.f, value }, { title: 'Змінити параметр', summary: `${who()}: ${esc(FIELD_NAMES[d.f])} <b>${esc(was)} → ${esc(value)}</b>`, button: 'Зберегти' }, 'Збережено');
};
H.message = () => {
  const text = $('#msgText').value.trim();
  if (!text) return toast('Напиши текст', true);
  doAndReload('message', { id: uid(), text }, 'Надіслано');
};
H.lbHide = (d) => {
  const hide = d.v === '1';
  mutate('lb-hide', { id: uid(), hidden: hide }, hide
    ? { title: 'Приховати з рейтингу', summary: `${who()} зникне з усіх рейтингів і призів тижня. Гараж, гроші й гра — без змін.`, button: 'Приховати' }
    : { title: 'Показати в рейтингу', summary: `${who()} знову з’явиться в рейтингах.`, button: 'Показати' }, hide ? 'Приховано з рейтингу' : 'Повернуто в рейтинг');
};
H.ban = (d) => {
  const ban = d.v === '1';
  mutate('ban', { id: uid(), banned: ban }, ban
    ? { title: 'Заблокувати гравця', summary: `${who()} не зможе грати, його лоти знімуться з ринку й аукціонів.`, danger: true, button: 'Заблокувати', reasonLabel: 'Причина бану — піде в журнал і в картку гравця' }
    : { title: 'Розблокувати гравця', summary: who(), button: 'Розблокувати' }, ban ? 'Заблоковано' : 'Розблоковано');
};
H.resetUser = () => mutate('reset', { id: uid() }, { title: 'Обнулити прогрес', danger: true, button: 'Обнулити',
  summary: `${who()}: зникнуть усі машини (${cur.cars.length}), номери, деталі, гривні (${money(cur.user.balance)}), рівень і колекція. Лишаються акаунт, хто запросив, оплати й бан.`,
  reasonLabel: 'Причина — гравець побачить її в сповіщенні' }, (r) => `Гравця обнулено (прибрано ${r.cars} авто)`);
H.removeCar = (d) => {
  const c = cur.cars.find((x) => x.id === Number(d.id));
  mutate('remove-car', { carId: Number(d.id) }, { title: 'Вилучити машину', danger: true, button: 'Вилучити',
    summary: `${cls(model(c?.model).cls)} <b>${esc(model(c?.model).name)}</b> #${esc(d.id)} (${money(c?.value)}) у ${who()}. Деталі й номер повернуться гравцю, лот/аукціон закриється.` }, 'Авто вилучено, деталі й номер повернуто гравцю');
};

const STATUS = { garage: ['гараж', ''], showcase: ['вітрина', 'amber'], market: ['на ринку', 'green'], auction: ['на аукціоні', 'green'] };
const friendsTable = (list) => `<div class="tbl-wrap"><table class="stack"><tr><th>Гравець</th><th class="num">Рівень</th><th class="num">Гараж</th><th>Прийшов</th><th>Був у грі</th><th>3-й рівень</th></tr>
  ${list.map((f) => `<tr class="click" data-user="${f.id}"><td><b>${esc(f.name)}</b> <span class="muted small">${f.id}</span></td><td class="num">${f.level}</td><td class="num">${short(f.value)}</td>
    <td class="small nowrap">${date(f.createdAt)}</td><td class="small">${ago(f.lastSeen)}</td><td>${f.paid ? '<span class="badge green">так · нагороду виплачено</span>' : '<span class="muted small">ще ні</span>'}</td></tr>`).join('')}</table></div>`;
// «Історія машин» (car_log): every car that left / entered the garage or changed status, with the action behind it.
const CAR_REASON = { sell: 'продав дилеру', 'buyer/sell': 'продав «Таємному покупцю»', upgrade: 'апгрейд (машини згоріли)', 'dealer/tradein': 'трейд-ін (машини віддано дилеру)', 'casino/upgrade': 'апгрейд у казино',
  'market/sell': 'виставив на ринок', 'market/buy': 'купівля на ринку', 'market/cancel': 'зняв з ринку', 'auction/create': 'виставив на аукціон', 'auction/bid': 'ставка на аукціоні', 'auction/cancel': 'скасував аукціон',
  'trade/accept': 'обмін прийнято', 'trade/create': 'обмін', showcase: 'вітрина', 'room/ready': 'кімната обміну', prestige: 'престиж', 'containers/open': 'контейнер', 'battle/join': 'кейс-батл', system: 'система (таймер: кінець аукціону/лоту тощо)' };
const STATUS_NAME = { garage: 'гараж', showcase: 'вітрина', market: 'ринок', auction: 'аукціон' };
function carLogTable(list, uid) {
  if (!list.length) return '<div class="empty">Записів ще немає — історія ведеться з 29.10</div>';
  const why = (r) => esc(CAR_REASON[r.reason] || r.reason || '—');
  const what = (r) => r.kind === 'gone' ? '<span class="badge red">зникла з гри</span>'
    : r.kind === 'moved' ? (r.fromUid === uid ? `<span class="badge amber">пішла до</span> ${r.toName ? userLink({ id: r.toUid, name: r.toName }) : r.toUid}` : `<span class="badge green">прийшла від</span> ${r.fromName ? userLink({ id: r.fromUid, name: r.fromName }) : r.fromUid}`)
    : `${esc(STATUS_NAME[r.statusFrom] || r.statusFrom)} → <b>${esc(STATUS_NAME[r.statusTo] || r.statusTo)}</b>`;
  return `<div class="tbl-wrap"><table class="stack"><tr><th>Коли</th><th>Машина</th><th>Що сталось</th><th>Чому</th></tr>${list.map((r) => `<tr>
    <td class="small nowrap" data-label="Коли">${date(r.at)}</td><td data-label="Машина">${esc(model(r.model)?.name || r.model)} <span class="muted small">#${r.carId}</span></td>
    <td data-label="Що сталось">${what(r)}</td><td class="small" data-label="Чому">${why(r)}</td></tr>`).join('')}</table></div>`;
}
const USER_TABS = {
  carlog: () => carLogTable(cur.carLog || [], cur.user.id),
  friends: () => (cur.user.invited.length ? friendsTable(cur.user.invited) : '<div class="empty">Цей гравець ще нікого не запросив</div>'),
  cars: () => (cur.cars.length ? `<div class="garage">${cur.cars.map((c) => {
    const m = model(c.model);
    const parts = S.PART_KEYS.filter((k) => c.parts[k]);
    const [st, stc] = STATUS[c.status] || [c.status, ''];
    return `<div class="carc" style="--c:${S.CLASSES[m.cls].color}">
      <div class="row">${cls(m.cls)} <span class="badge ${stc}">${st}</span><span class="muted small" style="margin-left:auto">#${c.id}</span></div>
      <div class="art">${carArt(c.model)}</div>
      <div class="nm">${esc(m.name)}</div>
      <div class="meta"><span>${c.hp} к.с.</span><span>·</span><b style="color:var(--text)">${money(c.value)}</b>${c.plate ? plate(c.plate.text) : ''}</div>
      <div class="meta">${parts.length ? parts.map((k) => `<span class="badge" title="${esc(partName(k, c.parts[k]))}">${esc(S.PARTS[k].name)} ${esc(S.TIER_BY_ID[c.parts[k]]?.name || '')}</span>`).join('') : 'без тюнінгу'}</div>
      ${c.listing ? `<div class="meta">ціна на ринку ${money(c.listing.price)}</div>` : ''}
      ${c.auction ? `<div class="meta">аукціон: ${c.auction.top_bid ? `ставка ${money(c.auction.top_bid)}` : `старт ${money(c.auction.start_price)}`}</div>` : ''}
      <button class="btn red sm" data-act="removeCar" data-id="${c.id}">${ic('trash')} Вилучити</button></div>`;
  }).join('')}</div>` : '<div class="empty">Машин немає</div>'),
  plates: () => (cur.plates.length ? `<table class="stack"><tr><th>Номер</th><th>Клас</th><th class="num">Вартість</th><th>На машині</th><th></th></tr>${cur.plates.map((p) => {
    const car = p.carId && cur.cars.find((c) => c.id === p.carId);
    return `<tr><td>${plate(p.text)}</td><td>${cls(p.cls)}</td><td class="num">${money(p.value)}</td><td>${car ? esc(model(car.model).name) : '<span class="muted">на складі</span>'}</td>
      <td><button class="btn red sm" data-act="removePlate" data-id="${p.id}">${ic('trash')} Забрати</button></td></tr>`;
  }).join('')}</table>` : '<div class="empty">Номерів немає</div>'),
  parts: () => (cur.parts.length ? `<table><tr><th>Деталь</th><th>Рівень</th><th class="num">Кількість</th><th class="num">Остигає</th></tr>${cur.parts.map((p) => `<tr><td>${esc(S.PARTS[p.type]?.name || p.type)}</td><td>${cls(tierCls(p.tier))} ${esc(S.TIER_BY_ID[p.tier]?.name || p.tier)}</td><td class="num">${p.count}</td><td class="num">${p.cooling || ''}</td></tr>`).join('')}</table>` : '<div class="empty">Склад порожній</div>'),
  keys: () => (cur.keys.length ? `<table><tr><th>Кейс</th><th class="num">Ключів</th></tr>${cur.keys.map((k) => `<tr><td>${esc(caseName(k.caseId))}</td><td class="num">${k.count}</td></tr>`).join('')}</table>` : '<div class="empty">Ключів немає</div>'),
  drops: () => (cur.drops.length ? `<table><tr><th>Коли</th><th>Кейс</th><th>Випало</th></tr>${cur.drops.map((d) => `<tr><td class="small nowrap">${date(d.at)}</td><td>${esc(caseName(d.caseId))}</td><td>${cls(d.cls)} ${esc(S.MODELS[d.item]?.name || (S.PARTS[d.item.split(':')[0]] ? partName(...d.item.split(':')) : d.item))}${d.forced ? ' <span class="badge amber">гарантія</span>' : ''}</td></tr>`).join('')}</table>` : '<div class="empty">Дропів ще не було</div>'),
  payments: () => (cur.payments.length ? `<table><tr><th>Коли</th><th>Пакет</th><th class="num">Зірки</th><th class="num">Гривні</th></tr>${cur.payments.map((p) => `<tr><td class="small nowrap">${date(p.at)}</td><td>${esc(p.pack)}</td><td class="num">⭐ ${p.stars}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}</table>` : '<div class="empty">Покупок не було</div>'),
  events: () => (cur.events.length ? `<table>${cur.events.map((e) => `<tr><td class="small nowrap muted">${date(e.at)}</td><td>${esc(e.text)}</td></tr>`).join('')}</table>` : '<div class="empty">Сповіщень немає</div>'),
  log: () => (cur.log.length ? `<div class="row end"><a data-act="logFor" data-id="${cur.user.id}">Увесь журнал гравця з фільтрами ›</a></div><div class="tbl-wrap"><table class="log"><tr><th>Коли</th><th>Хто</th><th>Дія</th><th>Деталі</th></tr>${cur.log.map((l) => `<tr class="${DANGER.has(l.action) ? 'warn' : ''}"><td class="small nowrap">${date(l.at)}</td><td class="small">${esc(WHO[l.admin] || l.admin)}</td><td>${esc(ACTIONS[l.action] || l.action)}</td><td>${details(l.action, l.details)}</td></tr>`).join('')}</table></div>` : '<div class="empty">Адміни нічого не змінювали</div>'),
};

// ---------- referrals ----------
// «Битва амбасадорів» (src/contest.js): start / stop and who brought how many players during the contest.
function contestPanel(c) {
  const k = c.contest, on = k && c.now < k.end;
  const head = on ? `<span class="badge green">йде</span> до ${date(k.end)}` : k ? `<span class="badge">завершено</span> ${date(k.start)} — ${date(k.end)}` : '<span class="muted">ще не запускали</span>';
  const ctl = on ? '<button class="btn red sm" data-act="contestStop">Зупинити</button>'
    : `<input id="ctDays" type="number" min="1" max="60" value="${c.rules.days}" style="width:70px"> днів <button class="btn sm" data-act="contestStart">${k ? 'Почати новий' : 'Почати конкурс'}</button>`;
  const prize = (p) => (!p ? '' : p.stars ? `⭐ ${p.stars}` : esc(p.extra));
  const yes = (v) => (v ? '<span class="badge green">так</span>' : '<span class="muted small">ні</span>');
  const friends = (list) => `<div class="tbl-wrap"><table class="stack"><tr><th>Друг</th><th class="num">Рівень</th><th>Прийшов</th><th>Був у грі</th><th>Зараховано</th><th>Повернувся наступного дня</th></tr>
    ${list.map((f) => `<tr class="${f.banned ? 'warn' : ''}"><td>${userLink(f)}${f.banned ? ' <span class="badge red">бан</span>' : ''}</td><td class="num">${f.level}</td><td class="small nowrap">${date(f.createdAt)}</td><td class="small">${ago(f.lastSeen)}</td><td>${yes(f.counted)}</td><td>${yes(f.returned)}</td></tr>`).join('')}</table></div>`;
  const rows = c.rows.length ? `<div class="tbl-wrap"><table class="stack"><tr><th class="num hide-s">Місце</th><th>Гравець</th><th class="num">Зараховано</th><th class="num">З них повернулись</th><th class="num">Прийшло всього</th><th>Приз</th><th></th></tr>
    ${c.rows.map((t, i) => `<tr class="click" data-act="ctOpen" data-i="${i}"><td class="num hide-s"><b>${t.place || '—'}</b></td><td class="ttl"><b class="show-s">${t.place ? `#${t.place} · ` : ''}</b><b>${esc(t.name)}</b> <span class="muted small">${t.id}</span></td>
      <td class="num"><b>${t.counted}</b></td><td class="num">${t.old ? `${t.returned} з ${t.old}` : '<span class="muted small">рано</span>'}${t.suspect ? ' <span class="badge red" title="Мало хто з друзів, зареєстрованих понад добу тому, повернувся — перевір на накрутку">?</span>' : ''}</td><td class="num">${t.invited}</td><td>${prize(t.prize)}</td><td><a data-user="${t.id}">картка ›</a></td></tr>
      <tr class="reffriends" id="ct-${i}" hidden><td colspan="7">${friends(t.friends)}</td></tr>`).join('')}</table></div>` : '<div class="empty">Ще ніхто нікого не привів</div>';
  return `<div class="panel"><h2>${ic('trophy')} Конкурс «Битва амбасадорів» <span class="sub">${head}</span></h2>
    <div class="row" style="gap:8px;margin-bottom:10px">${ctl}</div>
    <details class="small muted rules" style="margin-bottom:10px" ${narrow() ? '' : 'open'}><summary>Як рахуємо</summary>Рахуються друзі, які прийшли за посиланням гравця під час конкурсу й дійшли до ${c.rules.minLevel} рівня (бан і приховані з рейтингу — не рахуються). «Повернулись» — з друзів, що прийшли понад добу тому, скільки заходили в інший день, ніж реєструвались; червоний «?» — менше третини: можлива накрутка. Призи (${c.rules.prizes.map((p) => '⭐' + p).join(' / ')}, 4–${c.rules.extraUpTo} місця — ${esc(c.rules.extra)}) видаєш вручну після кінця.</details>
    ${k ? `<div class="small" style="margin-bottom:8px">Учасників: <b>${c.totals.inviters}</b> · прийшло друзів: <b>${c.totals.invited}</b> · зараховано: <b>${c.totals.counted}</b></div>${rows}` : ''}</div>`;
}
H.ctOpen = (d, el, e) => {
  if (e.target.closest('[data-user]')) return;
  const row = $(`#ct-${d.i}`);
  row.hidden = !row.hidden;
};
H.contestStart = () => {
  const days = Number($('#ctDays').value) || 14;
  return mutate('contest/start', { days }, { title: 'Почати «Битву амбасадорів»', button: 'Почати',
    summary: `Конкурс триватиме ${days} дн. Гравці побачать його в «Меню» з таймером, своїм посиланням і рейтингом. Рахуються лише друзі, що прийдуть з цього моменту.` }, 'Конкурс запущено');
};
H.contestStop = () => mutate('contest/stop', {}, { title: 'Зупинити конкурс', danger: true, button: 'Зупинити',
  summary: 'Рахунок зупиниться зараз, рейтинг заморозиться. Гравці ще 3 дні бачитимуть підсумки.' }, 'Конкурс зупинено');

VIEWS.referrals = async () => {
  const [r, ct] = await Promise.all([api('referrals'), api('contest').catch(() => null)]);
  const stat = (label, value, sub = '') => `<div class="stat"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const all = r.total + r.organic;
  return `<div class="head"><h1>Реферали</h1><button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    ${ct ? contestPanel(ct) : ''}
    <div class="cards">
      ${stat('Прийшли за запрошенням', r.total, all ? `${Math.round((r.total / all) * 100)}% усіх гравців` : '')}
      ${stat('Прийшли самі', r.organic)}
      ${stat('Дійшли до 3-го рівня', r.qualified, r.total ? `${Math.round((r.qualified / r.total) * 100)}% запрошених` : '')}
      ${stat('Виплачено нагород', short(r.qualified * r.reward), `по ${short(r.reward)} за друга`)}
      ${stat('Хто запрошує', r.top.length, 'гравців з друзями')}
    </div>
    <div class="panel"><h2>Хто кого привів <span class="sub">натисни на рядок, щоб побачити друзів</span></h2>
      ${r.top.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Гравець</th><th class="num">Запросив</th><th class="num">Дійшли до 3 рів.</th><th class="num">Заробив</th><th>Останній друг</th><th></th></tr>
        ${r.top.map((t, i) => `<tr class="click" data-act="refOpen" data-i="${i}"><td><b>${esc(t.name)}</b> <span class="muted small">${t.id}</span></td><td class="num">${t.invited}</td><td class="num">${t.qualified}</td>
          <td class="num">${short(t.earned)}</td><td class="small">${ago(t.last)}</td><td><a data-user="${t.id}">картка ›</a></td></tr>
          <tr class="reffriends" id="ref-${i}" hidden><td colspan="6">${friendsTable(t.friends)}</td></tr>`).join('')}
      </table></div>` : '<div class="empty">Поки ніхто нікого не запросив</div>'}</div>
    <div class="panel"><h2>Останні, хто прийшов за посиланням <span class="sub">${r.recent.length}</span></h2>
      ${r.recent.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Гравець</th><th>Хто запросив</th><th class="num">Рівень</th><th>Коли прийшов</th><th>Був у грі</th><th>3-й рівень</th></tr>
        ${r.recent.map((f) => `<tr><td>${userLink(f)}</td><td>${userLink(f.referrer)}</td><td class="num">${f.level}</td><td class="small nowrap">${date(f.createdAt)}</td>
          <td class="small">${ago(f.lastSeen)}</td><td>${f.paid ? '<span class="badge green">так</span>' : '<span class="muted small">ще ні</span>'}</td></tr>`).join('')}
      </table></div>` : '<div class="empty">Ще ніхто не приходив за запрошенням</div>'}</div>`;
};
H.refOpen = (d, el, e) => {
  if (e.target.closest('[data-user]')) return;
  const row = $(`#ref-${d.i}`);
  row.hidden = !row.hidden;
};

// ---------- search over all inventories ----------
VIEWS.search = async () => {
  const q = state.search || '';
  const r = q.length >= 2 ? await api('search', { query: q }) : { plates: [], cars: [], exact: null };
  const e = r.exact;
  const verdict = e ? (e.error ? `<div class="verdict taken">${plate(e.text)}<div><b class="bad">Такого номера не буває</b><div class="small">${esc(e.error)}</div></div></div>`
    : `<div class="verdict ${e.owner ? 'taken' : 'free'}">${plate(e.text)}<div><b class="${e.owner ? 'bad' : 'win'}">${e.owner ? 'Зайнятий' : 'Вільний — ще ніхто не вибив'}</b>
      <div class="small">${e.owner ? `Власник: ${userLink(e.owner)} · ` : ''}${cls(e.cls)} ${esc(e.label)} · ${esc(e.region)}</div></div></div>`) : '';
  return `<div class="head"><h1>Пошук номерів і авто</h1></div>
    <div class="panel">
      <form class="row" id="invSearch" style="margin-bottom:12px">
        <input class="grow" id="sq" placeholder="Номер (AA 1234 BC, частина «7777» або «КА») чи назва машини" value="${esc(q)}" autocomplete="off">
        <button class="btn">Знайти</button>
      </form>
      <div class="small muted">Номери в грі не повторюються. Введи повний номер, щоб дізнатися, вільний він чи ні; частину номера — щоб побачити всі схожі.</div>
    </div>
    ${q.length >= 2 ? `${verdict}
    <div class="panel"><h2>${ic('license')} Номери <span class="sub">${r.plates.length}${r.plates.length >= 200 ? '+' : ''}</span></h2>
      ${r.plates.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Номер</th><th>Клас</th><th class="num">Вартість</th><th>Власник</th><th>На машині</th></tr>
        ${r.plates.map((p) => `<tr><td>${plate(p.text)}</td><td>${cls(p.cls)}</td><td class="num">${money(p.value)}</td><td>${userLink(p.owner)}</td><td>${p.carModel ? esc(model(p.carModel).name) : '<span class="muted">на складі</span>'}</td></tr>`).join('')}
      </table></div>` : '<div class="empty">Таких номерів ні в кого немає</div>'}</div>
    <div class="panel"><h2>${ic('car')} Машини <span class="sub">${r.cars.length}${r.cars.length >= 300 ? '+' : ''}</span></h2>
      ${r.cars.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Авто</th><th>Власник</th><th>Де</th><th>Тюнінг</th><th>Номер</th><th class="num">Вартість</th></tr>
        ${r.cars.map((c) => `<tr><td>${cls(model(c.model).cls)} <b>${esc(model(c.model).name)}</b> <span class="muted small">#${c.id}</span></td><td>${userLink(c.owner)}</td>
          <td><span class="badge ${(STATUS[c.status] || [])[1] || ''}">${(STATUS[c.status] || [c.status])[0]}</span></td><td class="small">${S.PART_KEYS.filter((k) => c.parts[k]).length}/8</td>
          <td>${c.plate ? plate(c.plate.text) : '—'}</td><td class="num">${money(c.value)}</td></tr>`).join('')}
      </table></div>` : '<div class="empty">Таких машин ні в кого немає</div>'}</div>` : ''}`;
};
AFTER.search = () => {
  const f = $('#invSearch');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    state.search = $('#sq').value.trim();
    render();
  });
  if (!state.search) $('#sq').focus();
};
H.backToGame = () => {
  let back = '/';
  try {
    back = sessionStorage.getItem('avtodrop-back') || '/';
  } catch {}
  location.href = back;
};

// ---------- market ----------
VIEWS.market = async () => {
  const { listings, auctions } = await api('market');
  const carCell = (c) => `${cls(model(c.model).cls)} <b>${esc(model(c.model).name)}</b><div class="muted small">#${c.id} · ${c.hp} к.с. · оцінка ${short(c.value)}</div>`;
  return `<div class="head"><h1>Ринок</h1><button class="btn ghost sm" data-act="dealerRefresh">${ic('building-store')} Нові лоти дилера</button><button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    <div class="panel"><h2>Лоти на ринку <span class="sub">${listings.length}</span></h2>
      ${listings.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Авто</th><th>Продавець</th><th class="num">Ціна</th><th class="num">Ціна / оцінка</th><th>Виставлено</th><th></th></tr>
        ${listings.map((l) => `<tr><td>${carCell(l.car)}</td><td>${userLink(l.seller)}</td><td class="num">${money(l.price)}</td>
          <td class="num ${l.price < l.car.value * 0.5 || l.price > l.car.value * 3 ? 'bad' : ''}">${Math.round((l.price / l.car.value) * 100)}%</td><td class="small">${ago(l.at)}</td>
          <td><button class="btn red sm" data-act="unlist" data-kind="listing" data-id="${l.id}" data-name="${esc(model(l.car.model).name)}">Зняти</button></td></tr>`).join('')}</table></div>` : '<div class="empty">Лотів немає</div>'}
    </div>
    <div class="panel"><h2>Аукціони <span class="sub">${auctions.length}</span></h2>
      ${auctions.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Авто</th><th>Продавець</th><th class="num">Старт</th><th class="num">Ставка</th><th>Лідер</th><th>Кінець</th><th></th></tr>
        ${auctions.map((a) => `<tr><td>${carCell(a.car)}</td><td>${userLink(a.seller)}</td><td class="num">${money(a.startPrice)}</td><td class="num">${a.topBid ? `${money(a.topBid)} <span class="muted small">(${a.bids})</span>` : '—'}</td>
          <td>${a.leader ? userLink(a.leader) : '—'}</td><td class="small">${date(a.endsAt)}</td>
          <td><button class="btn red sm" data-act="unlist" data-kind="auction" data-id="${a.id}" data-name="${esc(model(a.car.model).name)}">Зняти</button></td></tr>`).join('')}</table></div>` : '<div class="empty">Аукціонів немає</div>'}
    </div>
    <div class="small muted">Знятий лот повертається в гараж продавця, ставка лідера аукціону — йому на рахунок. Червоним позначено підозрілі ціни (менше 50% або більше 300% оцінки).</div>`;
};
H.dealerRefresh = () => mutate('dealer/refresh', {}, { title: 'Нові лоти дилера', summary: 'Дилер замінить свої поточні лоти новими.', button: 'Оновити' }, 'Дилер виставив нові лоти');
H.unlist = (d) => mutate('market/remove', { kind: d.kind, id: Number(d.id) }, { title: d.kind === 'listing' ? 'Зняти лот з ринку' : 'Зняти аукціон', danger: true, button: 'Зняти',
  summary: `Лот #${esc(d.id)}${d.name ? ` · <b>${esc(d.name)}</b>` : ''}. Авто повернеться в гараж продавця${d.kind === 'auction' ? ', ставка лідера — йому на рахунок' : ''}.` }, 'Лот знято');

// ---------- «Причал»: the container auction (src/containers.js) ----------
// The switch, the lots on the pier right now (hints only: the content stays hidden until a lot ends), the last lots
// with their content and the bots' limits, and the week's numbers: how many people won, what they paid, the return.
const TIER_NAMES = { odesa: 'Порт Одеса', customs: 'Митниця', japan: 'Контейнер з Японії', ghost: 'Контейнер з привидом (Хелловін)', evening: 'Вечірній аукціон (20:00)' };
const BOT_NAMES = { petrovych: 'Петрович', vasya: 'Вася', liza: 'Ліза', zhora: 'Жора' };
const pctR = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const hintsText = (h) => [h.country, h.body, h.cls ? `клас ${h.cls}` : 'клас ?', h.dec ? `${h.dec}-ті` : '', h.kg != null ? `${h.kg}–${h.kg + 600} кг` : 'вага ?', h.junk ? 'після повені' : ''].filter(Boolean).join(' · ');
VIEWS.containers = async () => {
  const c = await api('containers');
  const w = c.week;
  return `<div class="head"><h1>Причал (контейнери)</h1><button class="btn ${c.on ? 'red' : 'green'} sm" data-act="ctToggle" data-on="${c.on ? 0 : 1}">${c.on ? 'Вимкнути' : 'Увімкнути'}</button><button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    <div class="panel"><h2>Режим <span class="sub">${c.on ? 'увімкнено' : 'вимкнено'}</span></h2>
      <p class="small muted">Три контейнери завжди на причалі (Порт Одеса, Митниця, Японія). Вимкнення: нові лоти й ставки зупиняються, лоти без ставок гравців знімаються, живі торги доходять до кінця. Віддача «виграв і продав» має бути ≈ 80% (тест 75–85%).</p>
      <table class="stack s4"><tr><th></th><th class="num">Лотів</th><th class="num">Виграли гравці</th><th class="num">Сплачено</th><th class="num">Віддача</th></tr>
        ${w.byTier.map((t) => `<tr><td>${esc(TIER_NAMES[t.tier] || t.tier)}</td><td class="num">${t.done}</td><td class="num">${t.human}</td><td class="num">${short(t.paid)}</td><td class="num">${pctR(t.ret)}</td></tr>`).join('')}
        <tr><td><b>За 7 днів</b></td><td class="num"><b>${w.done}</b></td><td class="num"><b>${w.human}</b> <span class="muted small">(боти ${w.bots})</span></td><td class="num"><b>${short(w.paid)}</b></td><td class="num"><b>${pctR(w.ret)}</b></td></tr></table>
      <div class="small muted">Спалено гравцями: ${money(w.paid)} · продаж виграних машин: ${money(w.sale)} · видано тиражних: ${w.editions}</div>
      ${w.expert ? `<div class="small muted">Огляд експерта: ${w.expert.n} за 7 днів, спалено ${money(w.expert.spent)}${c.evening ? ` · вечірній аукціон о 20:00 — нагадування увімкнули ${c.evening.subs}` : ''}</div>` : ''}</div>
    <div class="panel"><h2>Зараз на причалі <span class="sub">${c.open.length}</span></h2>
      ${c.open.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Лот</th><th>Підказки</th><th class="num">Ставка</th><th>Лідер</th><th>Кінець</th><th></th></tr>
        ${c.open.map((l) => `<tr><td><b>#${l.id}</b> ${esc(TIER_NAMES[l.tier] || l.tier)}<div class="muted small">${l.status === 'live' ? 'торги' : l.status === 'soon' ? 'старт о 20:00' : 'чекає ставки'} · ставок ${l.bids} (людей ${l.humans})</div></td>
          <td class="small">${esc(hintsText(l.hints))}<div class="muted">оцінка ${short(l.est.lo)}–${short(l.est.hi)} · EV продажу ${short(l.est.ev)}</div></td>
          <td class="num">${money(l.topBid)}</td><td>${l.human ? `<a data-user="${l.human}">${esc(l.leader)}</a>` : esc(l.leader)}</td><td class="small">${date(l.endsAt)}</td>
          <td><button class="btn red sm" data-act="ctClose" data-id="${l.id}">Закрити й замінити</button></td></tr>`).join('')}</table></div>` : '<div class="empty">Лотів немає</div>'}</div>
    <div class="panel"><h2>Завершені <span class="sub">останні ${c.recent.length}</span></h2>
      ${c.recent.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Лот</th><th>Вміст</th><th class="num">Ціна</th><th>Переможець</th><th class="num">Продаж / ціна</th><th>Межі ботів</th></tr>
        ${c.recent.map((l) => `<tr><td>#${l.id} ${esc(TIER_NAMES[l.tier] || l.tier)}<div class="muted small">${l.status === 'cancelled' ? 'закрито' : date(l.at)}</div></td>
          <td>${cls(model(l.model).cls)} ${esc(model(l.model).name)}${l.ed ? ` <span class="badge">тираж${l.serial ? ' №' + l.serial : ''}</span>` : ''}${l.junk ? ' <span class="muted small">після повені</span>' : ''}</td>
          <td class="num">${money(l.price)}</td><td>${l.human ? `<a data-user="${l.human}">${esc(l.winner)}</a>` : esc(l.winner)}</td><td class="num">${short(l.sale)} · ${pctR(l.sale / l.price)}</td>
          <td class="small muted">${l.bots.map((b) => `${esc(BOT_NAMES[b.id] || b.id)} ${short(b.max)}`).join(', ')}</td></tr>`).join('')}</table></div>` : '<div class="empty">Ще нічого</div>'}</div>`;
};
H.ctToggle = (d) => mutate('containers/toggle', { on: d.on === '1' }, { title: d.on === '1' ? 'Увімкнути «Причал»' : 'Вимкнути «Причал»', danger: d.on !== '1', button: d.on === '1' ? 'Увімкнути' : 'Вимкнути',
  summary: d.on === '1' ? 'На причалі знову з’являться три контейнери.' : 'Нові лоти й ставки зупиняться; лоти без ставок гравців знімуться, живі торги завершаться як звичайно.' }, (r) => (r.on ? 'Причал увімкнено' : `Причал вимкнено${r.removed ? `, знято лотів: ${r.removed}` : ''}`));
H.ctClose = (d) => mutate('containers/close', { id: Number(d.id) }, { title: `Закрити лот #${d.id}`, danger: true, button: 'Закрити',
  summary: 'Лот буде скасовано (лідеру-гравцю гроші повернуться), замість нього з’явиться новий контейнер цього рівня.' }, 'Лот закрито, новий уже на причалі');

// ---------- promo codes ----------
// «Автопромо» (src/autopromo.js): codes into the players' chat a few times a day.
function autoPromoPanel(a) {
  if (!a) return '';
  const c = a.cfg, t = a.target;
  const where = t ? `${esc(t.title || 'чат')}${t.thread ? ' · тема' : ''}` : '<b class="bad">не вибрано</b> — напиши <code>/promohere</code> у темі «Чат» групи';
  const log = a.log.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Коли</th><th>Код</th><th class="num">Сума</th><th class="num">Активацій</th><th class="num">Лишилось</th><th></th></tr>
    ${a.log.map((l) => `<tr><td class="small nowrap" data-label="Коли">${date(l.at)}</td><td data-label="Код"><b>${esc(l.code)}</b></td><td class="num" data-label="Сума">${money(l.amount)}</td><td class="num" data-label="Активацій">${l.uses}</td><td class="num" data-label="Лишилось">${l.ok ? l.left : '—'}</td><td data-label="">${l.ok ? (l.by === 'auto' ? '<span class="badge">сам</span>' : '<span class="badge amber">вручну</span>') : `<span class="badge red" title="${esc(l.error || '')}">помилка</span>`}</td></tr>`).join('')}</table></div>` : '<div class="empty">Ще нічого не кидав</div>';
  return `<div class="panel"><h2>${ic('ticket')} Автопромо в чат <span class="sub">${c.on && t ? `<span class="badge green">увімкнено</span>${a.nextAt ? ` · наступний ${date(a.nextAt)}` : ''}` : (c.on ? '<span class="badge amber">чекає /promohere</span>' : '<span class="badge">вимкнено</span>')}</span></h2>
    <div class="small muted" style="margin-bottom:10px">Бот сам кидає новий промокод у чат кілька разів на день у випадковий час (${c.from === 0 && c.to === 24 ? 'цілодобово' : `${c.from}:00–${c.to}:00 за Києвом${c.to <= c.from ? ', через північ' : ''}`}). Куди: ${where}.</div>
    <div class="grid2 apgrid">
      <label class="field"><span>Увімкнено</span><input type="checkbox" id="apOn" ${c.on ? 'checked' : ''}></label>
      <label class="field"><span>Разів на день</span><input id="apPer" inputmode="numeric" value="${c.perDay}"></label>
      <label class="field"><span>Сума від, ₴</span><input id="apMin" inputmode="numeric" value="${c.min}"></label>
      <label class="field"><span>Сума до, ₴</span><input id="apMax" inputmode="numeric" value="${c.max}"></label>
      <label class="field"><span>Активацій від</span><input id="apUmin" inputmode="numeric" value="${c.usesMin}"></label>
      <label class="field"><span>Активацій до</span><input id="apUmax" inputmode="numeric" value="${c.usesMax}"></label>
      <label class="field"><span>Діє, хв</span><input id="apTtl" inputmode="numeric" value="${c.ttlMin}"></label>
      <label class="field"><span>З години (0–23)</span><input id="apFrom" inputmode="numeric" value="${c.from}"></label>
      <label class="field"><span>До години (1–24)</span><input id="apTo" inputmode="numeric" value="${c.to}"></label>
    </div>
    <div class="row" style="gap:8px;margin:10px 0"><button class="btn" data-act="apSave">${ic('check')} Зберегти</button><button class="btn ghost" data-act="apNow" ${t && a.hasBot ? '' : 'disabled'}>${ic('share')} Кинути зараз</button></div>
    ${log}</div>`;
}
H.apSave = () => mutate('autopromo/set', { on: $('#apOn').checked, perDay: num('#apPer'), min: num('#apMin'), max: num('#apMax'), usesMin: num('#apUmin'), usesMax: num('#apUmax'), ttlMin: num('#apTtl'), from: num('#apFrom'), to: num('#apTo') },
  { title: 'Автопромо: зберегти', button: 'Зберегти', summary: 'Нові налаштування діють з наступного промокоду. Години за Києвом: 0 і 24 — цілодобово, 18 і 6 — з вечора до ранку.' }, 'Збережено');
H.apNow = () => mutate('autopromo/now', {}, { title: 'Кинути промокод зараз', button: 'Кинути', summary: 'Бот одразу напише новий промокод у вибрану тему чату.' }, 'Промокод у чаті');

VIEWS.promos = async () => {
  const [{ list }, ap] = await Promise.all([api('promos'), api('autopromo').catch(() => null)]);
  return `<div class="head"><h1>Промокоди</h1></div>
    ${autoPromoPanel(ap)}
    <div class="panel"><h2>Новий промокод</h2>
      <form class="row pform" id="promoForm">
        <input id="pcCode" placeholder="КОД" autocapitalize="characters" autocomplete="off" style="text-transform:uppercase;width:160px">
        <input id="pcAmount" inputmode="numeric" placeholder="Сума ₴" style="width:140px">
        <input id="pcUses" inputmode="numeric" placeholder="Скільки разів" style="width:140px">
        <input id="pcDays" inputmode="numeric" placeholder="Днів (необов’язково)" style="width:170px">
        <button class="btn">${ic('plus')} Створити</button>
      </form>
      <div class="small muted" style="margin-top:8px">Кожен гравець може використати код один раз. Той самий код замінює старий.</div></div>
    <div class="panel"><h2>Усі коди <span class="sub">${list.length}</span></h2>
      ${list.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Код</th><th class="num">Сума</th><th class="num">Використано</th><th class="num">Залишилось</th><th>Діє до</th><th></th></tr>
        ${list.map((p) => {
          const dead = p.usesLeft <= 0 || (p.expiresAt && p.expiresAt < Date.now());
          return `<tr><td><b>${esc(p.code)}</b> ${dead ? '<span class="badge">неактивний</span>' : '<span class="badge green">діє</span>'}</td><td class="num">${money(p.amount)}</td><td class="num">${p.used}</td><td class="num">${p.usesLeft}</td>
            <td class="small">${p.expiresAt ? date(p.expiresAt) : 'безстроково'}</td><td><button class="btn red sm" data-act="delPromo" data-code="${esc(p.code)}" aria-label="Видалити ${esc(p.code)}">${ic('trash')}<span class="show-s">Видалити</span></button></td></tr>`;
        }).join('')}</table></div>` : '<div class="empty">Промокодів ще немає</div>'}</div>`;
};
AFTER.promos = () => $('#promoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { code: $('#pcCode').value.trim(), amount: num('#pcAmount'), uses: num('#pcUses'), days: num('#pcDays') || null };
  if (!body.code || !(body.amount > 0) || !(body.uses > 0)) return toast('Заповни код, суму й кількість', true);
  mutate('promo/create', body, { title: 'Новий промокод', button: 'Створити',
    summary: `<b>${esc(body.code.toUpperCase())}</b>: ${money(body.amount)} × ${body.uses} = до <b>${money(body.amount * body.uses)}</b> нових гривень в економіці${body.days ? ` · ${body.days} дн` : ''}` }, (r) => `Промокод ${r.code} створено`);
});
H.delPromo = (d) => mutate('promo/delete', { code: d.code }, { title: 'Видалити промокод', summary: `<b>${esc(d.code)}</b> перестане діяти`, danger: true, button: 'Видалити' }, 'Видалено');

// ---------- payments ----------
VIEWS.payments = async () => {
  const { list, total } = await api('payments', { offset: state.offset });
  return `<div class="head"><h1>Платежі</h1><span class="badge amber">⭐ ${total.stars} усього · ${total.n} платежів</span></div>
    <div class="panel">${list.length ? `<div class="tbl-wrap"><table class="stack"><tr><th>Коли</th><th>Гравець</th><th>Пакет</th><th class="num">Зірки</th><th class="num">Гривні</th><th>ID платежу</th></tr>
      ${list.map((p) => `<tr><td class="small nowrap half">${date(p.at)}</td><td class="ttl">${userLink({ id: p.userId, name: p.name })}</td><td>${esc(p.pack)}</td><td class="num">⭐ ${p.stars}</td><td class="num">${money(p.amount)}</td><td class="small muted cid">${esc(p.chargeId)}</td></tr>`).join('')}
    </table></div>${pager(state.offset, 100, list.length, total.n)}` : '<div class="empty">Платежів ще не було</div>'}</div>`;
};

// ---------- support: players' messages from the game; the answer pops up in their game ----------
VIEWS.support = async () => {
  const { list, open } = await api('support', { open: state.supOpen });
  setSup(open);
  return `<div class="head"><h1>Підтримка</h1><span class="badge ${open ? 'red' : 'green'}">${open ? `${open} без відповіді` : 'усім відповіли'}</span>
      <label class="row small muted check-l" style="margin-left:auto"><input type="checkbox" id="supOpen" ${state.supOpen ? 'checked' : ''} style="width:auto"> лише без відповіді</label></div>
    ${list.length ? list.map((m) => `<div class="panel" id="sup${m.id}"><div class="row between"><div>${m.user ? userLink(m.user) : '—'} <span class="muted small">рів. ${m.user?.level ?? '?'} · ${date(m.at)}</span></div><span class="muted small">#${m.id}</span></div>
      <div style="white-space:pre-wrap;margin:8px 0">${esc(m.text)}</div>
      ${m.answer ? `<div class="small"><b>Відповідь</b> <span class="muted">(${esc(m.by || '')}, ${date(m.answeredAt)})</span><div style="white-space:pre-wrap">${esc(m.answer)}</div></div>`
        : `<textarea id="supA${m.id}" placeholder="Відповідь — гравець побачить її у грі й у боті"></textarea><button class="btn sm m-block mt" data-act="supReply" data-id="${m.id}">Відповісти</button>`}
      ${m.user && (state.role !== 'helper' || m.bug) ? bugChooser({ esc, user: m.user, ticket: m.id, done: m.bug }) : ''}</div>`).join('')
      : '<div class="panel"><div class="empty">Звернень немає</div></div>'}`;
};
AFTER.support = () => $('#supOpen').addEventListener('change', (e) => ((state.supOpen = e.target.checked), render()));
H.supReply = (d) => {
  const text = $('#supA' + d.id).value.trim();
  if (!text) return toast('Напиши відповідь', true);
  doAndReload('support/reply', { id: Number(d.id), text }, 'Відповідь надіслано');
};

// Unanswered messages: the badge on «Підтримка» and the same number on the phone's menu button.
function setSup(n) {
  for (const el of [$('#supN'), $('#supN2')]) if (el) (el.textContent = n), (el.hidden = !n);
}

// ---------- admin log ----------
const WHO = { key: 'ключ ADMIN_KEY', local: 'локально (DEV)', bot: 'бот (/give, /promo)', system: 'система (оновлення гри)' };
const dayStart = (v) => (v ? new Date(v + 'T00:00:00').getTime() : null);
VIEWS.log = async () => {
  const f = state.logF || {};
  const r = await api('log', { offset: state.offset, admin: f.admin || null, action: f.action || null, target: f.target || null, text: f.text || null,
    from: dayStart(f.from), to: f.to ? dayStart(f.to) + 86400e3 : null });
  const opt = (v, t, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(t)}</option>`;
  // the six filters fill a phone's whole first screen: there they fold into «Фільтри» unless one is set
  const nf = Object.values(f).filter(Boolean).length;
  return `<div class="head"><h1>Журнал дій <span class="muted" style="font-size:16px">${r.total}</span></h1></div>
    <details class="panel lf" ${nf || (state.logOpen ?? !narrow()) ? 'open' : ''} data-remember="logOpen"><summary>Фільтри${nf ? ` <span class="badge amber">${nf}</span>` : ''}</summary>
    <form class="filters" id="logForm">
      <label>Хто<select id="lfAdmin">${opt('', 'усі', f.admin || '')}${r.admins.map((a) => opt(a.id, `${WHO[a.id] || a.name} · ${a.n}`, f.admin)).join('')}</select></label>
      <label>Дія<select id="lfAction">${opt('', 'усі', f.action || '')}${r.actions.map((a) => opt(a, ACTIONS[a] || a, f.action)).join('')}</select></label>
      <label>Гравець<input id="lfTarget" placeholder="ID або @username" value="${esc(f.target || '')}"></label>
      <label>Текст<input id="lfText" placeholder="у деталях і причині" value="${esc(f.text || '')}"></label>
      <label>Від<input id="lfFrom" type="date" value="${esc(f.from || '')}"></label>
      <label>До<input id="lfTo" type="date" value="${esc(f.to || '')}"></label>
      <div class="row end"><button type="button" class="btn ghost sm" data-act="logReset">Скинути</button><button class="btn sm">Показати</button></div>
    </form></details>
    <div class="panel">${r.list.length ? `<div class="tbl-wrap"><table class="log"><tr><th>Коли</th><th>Хто</th><th>Дія</th><th>Гравець</th><th>Деталі</th></tr>
      ${r.list.map((l) => `<tr class="${DANGER.has(l.action) ? 'warn' : ''}"><td class="small nowrap">${date(l.at)}</td><td class="small">${esc(WHO[l.admin] || l.adminName)}${l.admin.startsWith('tg:') ? ` <span class="muted">${esc(l.admin.slice(3))}</span>` : ''}</td><td class="nowrap">${esc(ACTIONS[l.action] || l.action)}</td>
        <td>${l.target ? userLink({ id: l.target, name: l.targetName }) : '—'}</td><td>${details(l.action, l.details)}</td></tr>`).join('')}
    </table></div>${pager(state.offset, 100, r.list.length, r.total)}` : '<div class="empty">Записів немає</div>'}</div>`;
};
AFTER.log = () => $('#logForm').addEventListener('submit', (e) => {
  e.preventDefault();
  state.logF = { admin: $('#lfAdmin').value, action: $('#lfAction').value, target: $('#lfTarget').value.trim(), text: $('#lfText').value.trim(), from: $('#lfFrom').value, to: $('#lfTo').value };
  state.offset = 0;
  render();
});
H.logReset = () => ((state.logF = {}), (state.offset = 0), render());
// From a player card: their log entries.
H.logFor = (d) => go('log', { logF: { target: d.id } });

// ---------- broadcast through the bot ----------
VIEWS.broadcast = async () => {
  const aud = state.bcAud || 'active30';
  const p = await api('broadcast/preview', { audience: aud });
  const waitMin = Math.ceil(p.waitMs / 60e3);
  return `<div class="head"><h1>Розсилка</h1></div>
    <div class="grid2">
      <div class="panel"><h2>Нове повідомлення</h2>
        <div class="form">
          <label>Кому<select id="bcAud">${Object.entries(AUDIENCE).map(([k, t]) => `<option value="${k}" ${aud === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <div class="small">Отримають: <b>${p.recipients}</b> гравців (без заблокованих)</div>
          <label>Текст<textarea id="bcText" maxlength="1000" rows="5" placeholder="Що нового в грі…">${esc(state.bcText || '')}</textarea></label>
          <div class="small muted"><span id="bcLen">${(state.bcText || '').length}</span>/1000 · повідомлення прийде в бот, у сповіщення та вікном у грі. Не частіше ніж раз на 10 хвилин; бот шле ~20 повідомлень за секунду.</div>
          <div class="preview"><div class="small muted">Як побачить гравець</div><div class="bubble" id="bcPrev"></div></div>
          ${p.waitMs > 0 ? `<div class="small bad">Наступна розсилка буде доступна через ${waitMin} хв.</div>` : ''}
          <button class="btn danger" data-act="broadcast" ${p.waitMs > 0 ? 'disabled' : ''}>${ic('bell')} Надіслати ${p.recipients} гравцям</button>
        </div></div>
      <div class="panel"><h2>Останні розсилки</h2>${p.history.length ? p.history.map((h) => {
        let d = {};
        try { d = JSON.parse(h.details); } catch {}
        return `<div class="hist"><div class="small muted">${date(h.at)} · ${esc(WHO[h.admin] || h.adminName)} · ${esc(AUDIENCE[d.audience] || '')} · ${d.recipients} отрим.</div><div class="pre">${esc(d.text)}</div>${d.reason ? `<div class="why">причина: ${esc(d.reason)}</div>` : ''}</div>`;
      }).join('') : '<div class="empty">Розсилок ще не було</div>'}</div>
    </div>`;
};
AFTER.broadcast = () => {
  const t = $('#bcText');
  const upd = () => {
    state.bcText = t.value;
    $('#bcLen').textContent = t.value.length;
    $('#bcPrev').textContent = t.value.trim() ? `📢 ${t.value.trim()}` : '…';
  };
  t.addEventListener('input', upd);
  upd();
  $('#bcAud').addEventListener('change', (e) => ((state.bcAud = e.target.value), render()));
};
H.broadcast = async () => {
  const text = (state.bcText || '').trim();
  if (text.length < 3) return toast('Напиши текст розсилки', true);
  const aud = state.bcAud || 'active30';
  const p = await act('broadcast/preview', { audience: aud });
  if (!p) return;
  const r = await mutate('broadcast', { audience: aud, text }, { title: 'Надіслати розсилку', danger: true, button: `Надіслати ${p.recipients}`,
    summary: `<div class="bubble">${esc('📢 ' + text)}</div><div>Отримають: <b>${p.recipients}</b> гравців (${esc(AUDIENCE[aud])}). Скасувати після відправки не можна.</div>` }, (x) => `Розсилку запущено: ${x.recipients} гравців`);
  if (r) state.bcText = '';
};

// ---------- game settings: the casino switch (owner only) and the unlock ladder ----------
const CASINO_HINT = {
  on: 'Краш, міни, рулетка й слоти — як зараз. Відкривається на рівні з драбини нижче.',
  wheel: 'Лише рулетка (як «колесо» в DZ). Краш, міни й слоти зникають; запущені міни розраховуються одразу.',
  off: 'Казино немає ніде: вхід з «Апгрейду» зникає, сервер відмовляє в ставках. Запущені міни й краш розраховуються одразу (виплата за відкритими клітинками чи досягнутим множником, або повернення ставки).',
};
VIEWS.settings = async () => {
  const s = await api('settings');
  const owner = state.role === 'owner';
  return `<div class="head"><h1>Налаштування гри</h1></div>
    <div class="grid2">
      <div class="panel"><h2>Казино <span class="sub">зараз: ${esc(s.modes[s.casino])}${s.casinoSaved ? '' : ' (типово з коду)'}</span></h2>
        <p class="small muted">Політики Telegram щодо азартних механік — ризик для бота (див. звіт). Типове значення в коді: <b>${esc(s.modes[s.casinoDefault])}</b> (S.CASINO_DEFAULT). Змінити може лише власник.</p>
        <div class="list">${Object.entries(s.modes).map(([k, t]) => `<div class="row" style="gap:10px;align-items:flex-start;margin:8px 0">
          <button class="btn ${k === s.casino ? '' : 'ghost'} sm" data-act="casinoMode" data-k="${k}" ${owner && k !== s.casino ? '' : 'disabled'}>${k === s.casino ? '✓ ' : ''}${esc(t)}</button>
          <span class="small muted">${esc(CASINO_HINT[k] || '')}</span></div>`).join('')}</div>
        ${owner ? '' : '<div class="small muted">Перемикач доступний лише власнику (ADMIN_IDS / ключ).</div>'}
        ${s.history.length ? `<h2 style="margin-top:14px">Історія</h2>${s.history.map((h) => `<div class="small muted">${date(h.at)} · ${esc(WHO[h.admin] || h.adminName)} · ${esc(s.modes[h.details?.from] || '?')} → <b>${esc(s.modes[h.details?.to] || '?')}</b>${h.details?.reason ? ` · ${esc(h.details.reason)}` : ''}</div>`).join('')}` : ''}</div>
      <div class="panel"><h2>Відкриття за рівнем <span class="sub">S.UNLOCKS у shared.js</span></h2>
        <p class="small muted">Рівень 1: кейси, гараж, драг, щоденні бонус і завдання. Решта відкривається з рівнем; хто вже користувався функцією до появи драбини — зберіг доступ. Адміни й власник бачать усе.</p>
        <table>${s.unlocks.map((u) => `<tr><td>${esc(u.name)}</td><td class="num">рів. ${u.level}</td></tr>`).join('')}</table></div>
    </div>`;
};
H.casinoMode = (d) => mutate('casino-mode', { mode: d.k }, { title: 'Режим казино', danger: d.k !== 'on', button: 'Змінити',
  summary: `<div>Новий режим: <b>${esc({ on: 'Усі ігри', wheel: 'Лише рулетка', off: 'Вимкнено' }[d.k])}</b></div><div class="small muted">${esc(CASINO_HINT[d.k])}</div>` }, 'Режим казино змінено');

// ---------- start ----------
async function start() {
  try {
    const w = await api('whoami');
    state.role = w.role;
    const who = { key: 'вхід за ключем', local: 'локальний доступ (DEV)' }[w.who] || `Telegram ${w.who.slice(3)}`;
    $('#who').innerHTML = `${esc(who)} · ${ROLE_NAMES[w.role] || ''}${w.who === 'key' ? ' · <a data-act="logout">вийти</a>' : ''}`;
    // A helper doesn't see sections they have no rights for (the server refuses them anyway).
    for (const b of document.querySelectorAll('#nav [data-admin-only]')) b.hidden = w.role === 'helper';
    document.body.classList.toggle('helper', w.role === 'helper'); // admin.css hides the buttons a helper may not use
    document.querySelectorAll('.qsearch').forEach((f) => (f.hidden = false));
    api('support', { open: true }).then((s) => setSup(s.open)).catch(() => {});
    fetch('/api/config').then((r) => r.json()).then((c) => {
      setImages(c.images || {});
      if (state.view === 'user') render();
    }).catch(() => {});
    // On a computer the panel opens on the live dashboard (an address with #section still opens that section).
    if (!location.hash && wide()) state.view = 'live';
    fromHash();
    render();
  } catch (e) {
    if (e.auth) {
      if (store.get()) store.set('');
      return login(e.message);
    }
    $('#main').innerHTML = `<div class="empty bad">${esc(e.message)}</div>`;
  }
}
try {
  tg?.ready?.();
  tg?.expand?.();
} catch {}
// «Встановити як програму»: the button shows up only when the browser offers the install (Chrome / Edge, not Telegram).
if (!tg?.initData) setupInstall($('#installBtn'));
start();
