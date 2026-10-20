// Admin panel: overview, players (with everything they own), market, promo codes, payments and the action log.
import * as S from './shared.js';
import { carArt, setImages } from './car.js';

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
// Destructive buttons need a second click within 3 s.
function armed(el, label = 'Точно?') {
  if (el.dataset.armed) return true;
  const old = el.innerHTML;
  el.dataset.armed = '1';
  el.classList.add('armed');
  el.innerHTML = label;
  setTimeout(() => {
    if (!el.isConnected) return;
    delete el.dataset.armed;
    el.classList.remove('armed');
    el.innerHTML = old;
  }, 3000);
  return false;
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
  ban: 'Бан', unban: 'Розбан', reset: 'Обнулено', 'dealer-refresh': 'Нові лоти дилера', 'give-plate': 'Видано номер', 'remove-plate': 'Забрано номер', message: 'Повідомлення', 'market-remove': 'Знято лот', promo: 'Промокод', 'promo-delete': 'Видалено промокод', support: 'Відповідь підтримки', role: 'Права',
  luck: 'Підкрутка', rig: 'Гарантована машина', 'rig-cancel': 'Скасовано гарантовану машину',
};
function details(a, d) {
  if (!d) return '';
  try {
    d = typeof d === 'string' ? JSON.parse(d) : d;
  } catch {
    return esc(d);
  }
  switch (a) {
    case 'money': return `<span class="${d.amount >= 0 ? 'win' : 'bad'}">${d.amount >= 0 ? '+' : ''}${money(d.amount)}</span>${d.note ? ` · ${esc(d.note)}` : ''}`;
    case 'give-car': case 'remove-car': return esc(model(d.model).name);
    case 'part': return `${esc(partName(d.type, d.tier))} × ${d.count}`;
    case 'keys': return `${esc(caseName(d.caseId))} × ${d.count}`;
    case 'set': return `${esc(d.field)} = ${d.value}`;
    case 'ban': return esc(d.reason || '');
    case 'reset': return `прибрано ${d.cars} авто${d.reason ? ` · ${esc(d.reason)}` : ''}`;
    case 'message': return esc(d.text);
    case 'promo': return `${esc(d.code)} · ${money(d.amount)} × ${d.uses}`;
    case 'promo-delete': return esc(d.code);
    case 'give-plate': return `${plate(d.text)} ${cls(d.cls)} ${money(d.value)}${d.note ? ` · ${esc(d.note)}` : ''}`;
    case 'remove-plate': return plate(d.text);
    case 'support': return esc(d.text);
    case 'role': return d.role ? ({ admin: 'видано Адмін', helper: 'видано Хелпер' }[d.role]) : 'права забрано';
    case 'luck': return d.chance ? `${d.chance}% на ${d.opens} відкр.` : 'вимкнено';
    case 'rig': case 'rig-cancel': return esc(model(d.model).name);
    case 'market-remove': return d.kind === 'listing' ? 'ринок' : 'аукціон';
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
window.addEventListener('popstate', () => (fromHash(), render()));
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === (state.view === 'user' ? 'users' : state.view)));
  try {
    const html = await VIEWS[state.view]();
    if (seq !== renderSeq) return;
    $('#main').innerHTML = html;
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
  if (nav) return go(nav.dataset.go);
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
H.logout = () => {
  store.set('');
  login('Ти вийшов.');
};

// ---------- overview ----------
VIEWS.overview = async () => {
  const o = await api('overview');
  const stat = (label, value, sub = '') => `<div class="stat"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const maxCls = Math.max(1, ...Object.values(o.classes));
  const crashProfit = o.crash24h.bet - o.crash24h.paid;
  return `<div class="head"><h1>Огляд</h1><button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    <div class="cards">
      ${stat('Гравців', o.users, `+${o.new24h} за добу`)}
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
      <div class="panel"><h2>Найбагатші</h2>${userTable(o.richest, true)}</div>
      <div class="panel"><h2>Нові гравці</h2>${userTable(o.newest, false)}</div>
    </div>`;
};
H.reload = () => render();
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
        <input class="grow" id="q" placeholder="ID, @username або ім’я" value="${esc(state.query)}">
        <select id="sort">${[['value', 'За вартістю'], ['balance', 'За гривнями'], ['seen', 'Нещодавно в грі'], ['new', 'Нові'], ['level', 'За рівнем'], ['play', 'За часом у грі']].map(([k, t]) => `<option value="${k}" ${state.sort === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <button class="btn">Знайти</button>
      </form>
      ${list.length ? `<div class="tbl-wrap"><table>
        <tr><th>ID</th><th>Гравець</th><th class="num">Рівень</th><th class="num">Гривні</th><th class="num">Вартість гаража</th><th class="num">Авто</th><th class="num">Кейсів</th><th class="num">Час у грі</th><th>Запросив</th><th>Реєстрація</th><th>Був у грі</th><th></th></tr>
        ${list.map((u) => `<tr class="click" data-user="${u.id}"><td class="muted">${u.id}</td><td><b>${esc(u.name)}</b>${u.username && u.firstName ? `<div class="muted small">${esc(u.firstName)}</div>` : ''}</td>
          <td class="num">${u.level}</td><td class="num">${money(u.balance)}</td><td class="num">${money(u.value)}</td><td class="num">${u.cars}</td><td class="num">${u.cases}</td><td class="num nowrap">${playTime(u.playMs)}</td>
          <td class="small">${u.referrer ? esc(u.referrer.name) : '<span class="muted">сам</span>'}</td><td class="small nowrap">${date(u.createdAt)}</td>
          <td class="small">${ago(u.lastSeen)}</td><td>${u.banned ? '<span class="badge red">бан</span>' : ''}</td></tr>`).join('')}
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
VIEWS.user = async () => {
  cur = await api('user', { id: state.userId });
  const { user: u, income, cars, plates, parts, keys, payments, events, drops, log } = cur;
  const tabs = [['cars', 'Машини', cars.length], ['friends', 'Запрошені', u.invited.length], ['plates', 'Номери', plates.length], ['parts', 'Деталі', parts.reduce((s, p) => s + p.count, 0)],
    ['keys', 'Ключі', keys.reduce((s, k) => s + k.count, 0)], ['drops', 'Дропи', drops.length], ['payments', 'Платежі', payments.length],
    ['events', 'Сповіщення', events.length], ['log', 'Дії адмінів', log.length]];
  return `<div class="crumb"><a data-go="users">‹ Усі гравці</a></div>
    <div class="head"><h1>${esc(u.name)}</h1>${u.role ? `<span class="badge amber">${ic('shield-check')} ${ROLE_NAMES[u.role]}</span>` : ''}${u.banned ? `<span class="badge red">${ic('lock')} заблокований${u.banReason ? `: ${esc(u.banReason)}` : ''}</span>` : ''}
      <button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    <div class="panel"><div class="kv">
      <div><span>Telegram ID</span><b>${u.id}</b></div>
      <div><span>Username</span><b>${u.username ? '@' + esc(u.username) : '—'}</b></div>
      <div><span>Ім’я</span><b>${esc(u.firstName || '—')}</b></div>
      <div><span>Гривні</span><b>${money(u.balance)}</b></div>
      <div><span>Вартість гаража</span><b>${money(u.value)}</b></div>
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
      <div><span>Час у грі</span><b>${playTime(u.stats.playMs)}</b></div>
      <div><span>Досягнення</span><b>${u.achievements.claimed}/${u.achievements.total}${u.achievements.reached > u.achievements.claimed ? ` <span class="muted small">(ще ${u.achievements.reached - u.achievements.claimed} не забрано)</span>` : ''}</b></div>
    </div></div>
    <div class="panel"><h2>${ic('gauge')} Активність</h2>${activityHtml(cur.activity)}</div>
    <div class="panel"><h2>${ic('adjustments')} Керування</h2>${controls(u)}</div>
    <div class="panel">
      <div class="tabs">${tabs.map(([k, t, n]) => `<button class="${state.userTab === k ? 'on' : ''}" data-act="userTab" data-k="${k}">${t}<span class="n">${n}</span></button>`).join('')}</div>
      ${USER_TABS[state.userTab]()}
    </div>`;
};
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
H.givePlate = (d, el) => {
  if (!armed(el, `Видати ${el.dataset.text}?`)) return;
  doAndReload('give-plate', { id: uid(), text: el.dataset.text, value: num('#plValue') || null, carId: Number($('#plCar').value) || null, note: $('#plNote').value.trim() }, (r) => `Номер ${r.text} видано`);
};
H.removePlate = (d, el) => armed(el, 'Забрати?') && doAndReload('remove-plate', { plateId: Number(d.id) }, 'Номер забрано');
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
  if (u.role === 'owner') return `<div class="act"><h3>${ic('shield-check')} Права</h3><div class="small muted">Власник гри (ADMIN_IDS на сервері) — змінюється тільки там.</div></div>`;
  const opts = [['', 'Гравець'], ['helper', 'Хелпер — гравці, підтримка, повідомлення'], ...(state.role === 'owner' ? [['admin', 'Адмін — усе, крім видачі адмінки']] : [])];
  return `<div class="act"><h3>${ic('shield-check')} Права в адмін-панелі</h3>
    <div class="small muted">Зараз: <b>${ROLE_NAMES[u.role] || 'гравець'}</b>. Адмін-панель з’явиться в меню гри.</div>
    <select id="roleSel">${opts.map(([v, t]) => `<option value="${v}" ${(u.role || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <button class="btn sm" data-act="setRole">${ic('check')} Зберегти</button></div>`;
}
H.setRole = (d, el) => {
  const role = $('#roleSel').value;
  if (!armed(el, `Точно ${role ? ROLE_NAMES[role] : 'забрати права'}?`)) return;
  doAndReload('role', { id: uid(), role }, 'Права оновлено');
};
function controls(u) {
  const models = [...S.ALL_MODELS].sort((a, b) => S.CLASS_ORDER.indexOf(a.cls) - S.CLASS_ORDER.indexOf(b.cls) || a.price - b.price);
  // A helper only writes messages to players.
  if (state.role === 'helper') return `<div class="actions"><div class="act"><h3>${ic('bell')} Повідомлення</h3>
      <textarea id="msgText" placeholder="Текст прийде в сповіщення гри та в бот"></textarea>
      <button class="btn ghost sm" data-act="message">Надіслати</button></div></div>`;
  return `<div class="actions">
    ${roleBlock(u)}
    <div class="act"><h3>${ic('cash')} Гривні</h3>
      <input id="mAmount" inputmode="numeric" placeholder="Сума, напр. 100000">
      <input id="mNote" placeholder="Повідомлення гравцю (необов’язково)">
      <div class="row"><button class="btn green sm grow" data-act="money" data-sign="1">${ic('plus')} Нарахувати</button><button class="btn red sm grow" data-act="money" data-sign="-1">${ic('minus')} Списати</button></div></div>
    <div class="act"><h3>${ic('car')} Видати машину</h3>
      <select id="gModel">${S.CLASS_ORDER.map((c) => `<optgroup label="Клас ${c} · ${S.CLASSES[c].name}">${models.filter((m) => m.cls === c).map((m) => `<option value="${m.id}">${esc(m.name)} — ${short(m.price)}${m.secret ? ' (секретна)' : ''}</option>`).join('')}</optgroup>`).join('')}</select>
      <label class="row small muted"><input type="checkbox" id="gNotify" checked style="width:auto"> Повідомити гравця</label>
      <button class="btn sm" data-act="giveCar">${ic('gift')} Видати</button></div>
    <div class="act"><h3>${ic('sparkles')} Підкрутка</h3>
      <div class="small muted">Зараз удача гравця: <b>${Math.round(u.luck * 100)}%</b>${u.luckLeft ? ` · увімкнено тобою ${Math.round(u.luckBonus * 100)}% ще на ${u.luckLeft} відкриттів` : ''}. З удачею кейс кидає клас двічі й бере кращий.</div>
      <div class="row"><input id="lChance" class="grow" inputmode="numeric" placeholder="Шанс, %" value="${u.luckLeft ? Math.round(u.luckBonus * 100) : 60}">
        <input id="lOpens" class="grow" inputmode="numeric" placeholder="На скільки відкриттів" value="${u.luckLeft || 20}"></div>
      <div class="row"><button class="btn green sm grow" data-act="luck">${ic('sparkles')} Увімкнути</button>${u.luckLeft ? `<button class="btn ghost sm" data-act="luckOff">Вимкнути</button>` : ''}</div>
      <h3 style="margin-top:10px">${ic('target-arrow')} Гарантована машина</h3>
      <select id="rModel">${S.CLASS_ORDER.filter((c) => c !== 'X').map((c) => `<optgroup label="Клас ${c} · ${S.CLASSES[c].name}">${models.filter((m) => m.cls === c && !m.secret).map((m) => `<option value="${m.id}">${esc(m.name)} — ${short(m.price)}</option>`).join('')}</optgroup>`).join('')}</select>
      <div class="small muted" id="rCases">${rigCases(models.find((m) => !m.secret)?.id)}</div>
      <button class="btn sm" data-act="rig">${ic('target-arrow')} Випаде з наступного кейса</button>
      ${u.rigs.length ? `<div class="small mt">Чекають: ${u.rigs.map((r) => `<span class="chip">${esc(model(r.model).name)} <a href="#" data-act="rigCancel" data-id="${r.id}">✕</a></span>`).join(' ')}</div>` : ''}</div>
    <div class="act"><h3>${ic('tool')} Деталі</h3>
      <div class="row"><select id="pType" class="grow">${S.PART_KEYS.map((k) => `<option value="${k}">${esc(S.PARTS[k].name)}</option>`).join('')}</select>
        <select id="pTier" class="grow">${S.TIERS.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div class="row"><input id="pCount" class="grow" inputmode="numeric" value="1"><button class="btn green sm" data-act="part" data-sign="1">${ic('plus')}</button><button class="btn red sm" data-act="part" data-sign="-1">${ic('minus')}</button></div></div>
    <div class="act"><h3>${ic('key')} Ключі від кейсів</h3>
      <select id="kCase">${S.CASES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <div class="row"><input id="kCount" class="grow" inputmode="numeric" value="1"><button class="btn green sm" data-act="keys" data-sign="1">${ic('plus')}</button><button class="btn red sm" data-act="keys" data-sign="-1">${ic('minus')}</button></div></div>
    <div class="act"><h3>${ic('license')} Видати номер</h3>
      <input id="plText" placeholder="AA 1234 BC" autocomplete="off" style="text-transform:uppercase">
      <div class="check" id="plCheck"><span class="muted">Можна писати кирилицею і без пробілів</span></div>
      <div class="row"><input id="plValue" class="grow" inputmode="numeric" placeholder="Вартість (авто за класом)">
        <select id="plCar" class="grow"><option value="">на склад</option>${cur.cars.filter((c) => !c.plate).map((c) => `<option value="${c.id}">на ${esc(model(c.model).name)} #${c.id}</option>`).join('')}</select></div>
      <input id="plNote" maxlength="300" placeholder="Повідомлення гравцю (необов’язково)">
      <button class="btn sm" data-act="givePlate" id="plBtn" disabled>${ic('gift')} Видати номер</button></div>
    <div class="act"><h3>${ic('gauge')} Параметри</h3>
      ${[['level', 'Рівень', u.level], ['slots', 'Місць у гаражі', u.slots], ['showcase_slots', 'Місць на вітрині', u.showcaseSlots], ['cap_level', `Рівень сховища (0–${S.CAP_LEVELS.length - 1})`, u.capLevel]]
        .map(([f, t, v]) => `<div class="row"><span class="grow small">${t}</span><input id="set-${f}" value="${v}" inputmode="numeric" style="width:80px"><button class="btn ghost sm" data-act="set" data-f="${f}">OK</button></div>`).join('')}</div>
    <div class="act"><h3>${ic('bell')} Повідомлення</h3>
      <textarea id="msgText" placeholder="Текст прийде в сповіщення гри та в бот"></textarea>
      <button class="btn ghost sm" data-act="message">Надіслати</button></div>
    <div class="act"><h3>${ic('refresh')} Обнулити прогрес</h3>
      <input id="resetReason" maxlength="200" placeholder="Причина (побачить гравець, необов’язково)">
      <div class="small muted">Зникнуть усі машини, номери, деталі, гривні, рівень і колекція — як новий гравець. Лишаються акаунт, хто запросив, оплати й бан.</div>
      <button class="btn red sm" data-act="resetUser">${ic('refresh')} Обнулити гравця</button></div>
    <div class="act"><h3>${ic('lock')} Блокування</h3>
      ${u.banned ? `<div class="small">Гравець заблокований${u.banReason ? `: ${esc(u.banReason)}` : ''}. Не може грати, його лоти знято з ринку.</div>
        <button class="btn green sm" data-act="ban" data-v="0">Розблокувати</button>`
        : `<input id="banReason" placeholder="Причина (необов’язково)"><div class="small muted">Гравець не зможе грати, його лоти знімуться з ринку.</div>
        <button class="btn red sm" data-act="ban" data-v="1">Заблокувати</button>`}</div>
  </div>`;
}
const uid = () => state.userId;
const num = (sel) => Number(String($(sel).value).replace(/[\s_]/g, ''));
async function doAndReload(name, body, ok) {
  if (await act(name, body, ok)) render();
}
H.money = (d, el) => {
  const n = num('#mAmount');
  if (!n || n < 0) return toast('Вкажи додатну суму', true);
  const amount = n * Number(d.sign);
  if (!armed(el, `Точно ${amount > 0 ? '+' : ''}${short(amount)}?`)) return;
  doAndReload('money', { id: uid(), amount, note: $('#mNote').value.trim() }, (r) => `Баланс: ${money(r.balance)}`);
};
H.giveCar = (d, el) => {
  const m = $('#gModel').value;
  if (!armed(el, `Видати ${model(m).name}?`)) return;
  doAndReload('give-car', { id: uid(), model: m, notify: $('#gNotify').checked }, `${model(m).name} видано`);
};
// Which cases can drop this car (a guaranteed car comes out of the first of them the player opens).
function rigCases(id) {
  const m = S.MODELS[id];
  if (!m) return '';
  const cases = S.CASES.filter((cs) => !cs.starter && cs.weights[m.cls] && cs.pool(m.cls).some((x) => x.id === id));
  return cases.length ? `Випаде, коли гравець відкриє: ${cases.map((cs) => esc(cs.name)).join(', ')}` : '<span class="bad">Ця машина не випадає з кейсів</span>';
}
document.addEventListener('change', (e) => {
  if (e.target.id === 'rModel') $('#rCases').innerHTML = rigCases(e.target.value);
});
H.luck = (d, el) => {
  const chance = num('#lChance'), opens = num('#lOpens');
  if (!(chance > 0 && chance <= 100)) return toast('Шанс від 1 до 100%', true);
  if (!(opens > 0)) return toast('Вкажи кількість відкриттів', true);
  if (!armed(el, `Точно ${chance}% на ${opens} відкр.?`)) return;
  doAndReload('luck', { id: uid(), chance, opens }, 'Підкрутку увімкнено');
};
H.luckOff = () => doAndReload('luck', { id: uid(), chance: 0 }, 'Підкрутку вимкнено');
H.rig = (d, el) => {
  const m = $('#rModel').value;
  if (!armed(el, `Точно ${model(m).name}?`)) return;
  doAndReload('rig', { id: uid(), model: m }, `${model(m).name} випаде з наступного кейса`);
};
H.rigCancel = (d, el, e) => {
  e?.preventDefault();
  doAndReload('rig-cancel', { rigId: Number(d.id) }, 'Скасовано');
};
H.part = (d) => {
  const n = num('#pCount') * Number(d.sign);
  if (!n) return toast('Вкажи кількість', true);
  doAndReload('part', { id: uid(), type: $('#pType').value, tier: $('#pTier').value, count: n }, 'Деталі оновлено');
};
H.keys = (d) => {
  const n = num('#kCount') * Number(d.sign);
  if (!n) return toast('Вкажи кількість', true);
  doAndReload('keys', { id: uid(), caseId: $('#kCase').value, count: n }, 'Ключі оновлено');
};
H.set = (d) => doAndReload('set', { id: uid(), field: d.f, value: num('#set-' + d.f) }, 'Збережено');
H.message = () => {
  const text = $('#msgText').value.trim();
  if (!text) return toast('Напиши текст', true);
  doAndReload('message', { id: uid(), text }, 'Надіслано');
};
H.ban = (d, el) => {
  if (!armed(el, d.v === '1' ? 'Точно заблокувати?' : 'Точно розблокувати?')) return;
  doAndReload('ban', { id: uid(), banned: d.v === '1', reason: $('#banReason')?.value.trim() || '' }, d.v === '1' ? 'Заблоковано' : 'Розблоковано');
};
H.resetUser = (d, el) => {
  if (!armed(el, `Точно обнулити ${esc(cur.user.name)}?`)) return;
  doAndReload('reset', { id: uid(), reason: $('#resetReason').value.trim() }, (r) => `Гравця обнулено (прибрано ${r.cars} авто)`);
};
H.removeCar = (d, el) => {
  if (!armed(el, 'Точно вилучити?')) return;
  doAndReload('remove-car', { carId: Number(d.id) }, 'Авто вилучено, деталі й номер повернуто гравцю');
};

const STATUS = { garage: ['гараж', ''], showcase: ['вітрина', 'amber'], market: ['на ринку', 'green'], auction: ['на аукціоні', 'green'] };
const friendsTable = (list) => `<div class="tbl-wrap"><table><tr><th>Гравець</th><th class="num">Рівень</th><th class="num">Гараж</th><th>Прийшов</th><th>Був у грі</th><th>3-й рівень</th></tr>
  ${list.map((f) => `<tr class="click" data-user="${f.id}"><td><b>${esc(f.name)}</b> <span class="muted small">${f.id}</span></td><td class="num">${f.level}</td><td class="num">${short(f.value)}</td>
    <td class="small nowrap">${date(f.createdAt)}</td><td class="small">${ago(f.lastSeen)}</td><td>${f.paid ? '<span class="badge green">так · нагороду виплачено</span>' : '<span class="muted small">ще ні</span>'}</td></tr>`).join('')}</table></div>`;
const USER_TABS = {
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
  plates: () => (cur.plates.length ? `<table><tr><th>Номер</th><th>Клас</th><th class="num">Вартість</th><th>На машині</th><th></th></tr>${cur.plates.map((p) => {
    const car = p.carId && cur.cars.find((c) => c.id === p.carId);
    return `<tr><td>${plate(p.text)}</td><td>${cls(p.cls)}</td><td class="num">${money(p.value)}</td><td>${car ? esc(model(car.model).name) : '<span class="muted">на складі</span>'}</td>
      <td><button class="btn red sm" data-act="removePlate" data-id="${p.id}">${ic('trash')} Забрати</button></td></tr>`;
  }).join('')}</table>` : '<div class="empty">Номерів немає</div>'),
  parts: () => (cur.parts.length ? `<table><tr><th>Деталь</th><th>Рівень</th><th class="num">Кількість</th><th class="num">Остигає</th></tr>${cur.parts.map((p) => `<tr><td>${esc(S.PARTS[p.type]?.name || p.type)}</td><td>${cls(tierCls(p.tier))} ${esc(S.TIER_BY_ID[p.tier]?.name || p.tier)}</td><td class="num">${p.count}</td><td class="num">${p.cooling || ''}</td></tr>`).join('')}</table>` : '<div class="empty">Склад порожній</div>'),
  keys: () => (cur.keys.length ? `<table><tr><th>Кейс</th><th class="num">Ключів</th></tr>${cur.keys.map((k) => `<tr><td>${esc(caseName(k.caseId))}</td><td class="num">${k.count}</td></tr>`).join('')}</table>` : '<div class="empty">Ключів немає</div>'),
  drops: () => (cur.drops.length ? `<table><tr><th>Коли</th><th>Кейс</th><th>Випало</th></tr>${cur.drops.map((d) => `<tr><td class="small nowrap">${date(d.at)}</td><td>${esc(caseName(d.caseId))}</td><td>${cls(d.cls)} ${esc(S.MODELS[d.item]?.name || (S.PARTS[d.item.split(':')[0]] ? partName(...d.item.split(':')) : d.item))}${d.forced ? ' <span class="badge amber">гарантія</span>' : ''}</td></tr>`).join('')}</table>` : '<div class="empty">Дропів ще не було</div>'),
  payments: () => (cur.payments.length ? `<table><tr><th>Коли</th><th>Пакет</th><th class="num">Зірки</th><th class="num">Гривні</th></tr>${cur.payments.map((p) => `<tr><td class="small nowrap">${date(p.at)}</td><td>${esc(p.pack)}</td><td class="num">⭐ ${p.stars}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}</table>` : '<div class="empty">Покупок не було</div>'),
  events: () => (cur.events.length ? `<table>${cur.events.map((e) => `<tr><td class="small nowrap muted">${date(e.at)}</td><td>${esc(e.text)}</td></tr>`).join('')}</table>` : '<div class="empty">Сповіщень немає</div>'),
  log: () => (cur.log.length ? `<table><tr><th>Коли</th><th>Хто</th><th>Дія</th><th>Деталі</th></tr>${cur.log.map((l) => `<tr><td class="small nowrap">${date(l.at)}</td><td class="small">${esc(l.admin)}</td><td>${ACTIONS[l.action] || esc(l.action)}</td><td>${details(l.action, l.details)}</td></tr>`).join('')}</table>` : '<div class="empty">Адміни нічого не змінювали</div>'),
};

// ---------- referrals ----------
VIEWS.referrals = async () => {
  const r = await api('referrals');
  const stat = (label, value, sub = '') => `<div class="stat"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const all = r.total + r.organic;
  return `<div class="head"><h1>Реферали</h1><button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button></div>
    <div class="cards">
      ${stat('Прийшли за запрошенням', r.total, all ? `${Math.round((r.total / all) * 100)}% усіх гравців` : '')}
      ${stat('Прийшли самі', r.organic)}
      ${stat('Дійшли до 3 рівня', r.qualified, r.total ? `${Math.round((r.qualified / r.total) * 100)}% запрошених` : '')}
      ${stat('Виплачено нагород', short(r.qualified * r.reward), `по ${short(r.reward)} за друга`)}
      ${stat('Хто запрошує', r.top.length, 'гравців з друзями')}
    </div>
    <div class="panel"><h2>Хто кого привів <span class="sub">натисни на рядок, щоб побачити друзів</span></h2>
      ${r.top.length ? `<div class="tbl-wrap"><table><tr><th>Гравець</th><th class="num">Запросив</th><th class="num">Дійшли до 3 рів.</th><th class="num">Заробив</th><th>Останній друг</th><th></th></tr>
        ${r.top.map((t, i) => `<tr class="click" data-act="refOpen" data-i="${i}"><td><b>${esc(t.name)}</b> <span class="muted small">${t.id}</span></td><td class="num">${t.invited}</td><td class="num">${t.qualified}</td>
          <td class="num">${short(t.earned)}</td><td class="small">${ago(t.last)}</td><td><a data-user="${t.id}">картка ›</a></td></tr>
          <tr class="reffriends" id="ref-${i}" hidden><td colspan="6">${friendsTable(t.friends)}</td></tr>`).join('')}
      </table></div>` : '<div class="empty">Поки ніхто нікого не запросив</div>'}</div>
    <div class="panel"><h2>Останні, хто прийшов за посиланням <span class="sub">${r.recent.length}</span></h2>
      ${r.recent.length ? `<div class="tbl-wrap"><table><tr><th>Гравець</th><th>Хто запросив</th><th class="num">Рівень</th><th>Коли прийшов</th><th>Був у грі</th><th>3-й рівень</th></tr>
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
      ${r.plates.length ? `<div class="tbl-wrap"><table><tr><th>Номер</th><th>Клас</th><th class="num">Вартість</th><th>Власник</th><th>На машині</th></tr>
        ${r.plates.map((p) => `<tr><td>${plate(p.text)}</td><td>${cls(p.cls)}</td><td class="num">${money(p.value)}</td><td>${userLink(p.owner)}</td><td>${p.carModel ? esc(model(p.carModel).name) : '<span class="muted">на складі</span>'}</td></tr>`).join('')}
      </table></div>` : '<div class="empty">Таких номерів ні в кого немає</div>'}</div>
    <div class="panel"><h2>${ic('car')} Машини <span class="sub">${r.cars.length}${r.cars.length >= 300 ? '+' : ''}</span></h2>
      ${r.cars.length ? `<div class="tbl-wrap"><table><tr><th>Авто</th><th>Власник</th><th>Де</th><th>Тюнінг</th><th>Номер</th><th class="num">Вартість</th></tr>
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
      ${listings.length ? `<div class="tbl-wrap"><table><tr><th>Авто</th><th>Продавець</th><th class="num">Ціна</th><th class="num">Ціна / оцінка</th><th>Виставлено</th><th></th></tr>
        ${listings.map((l) => `<tr><td>${carCell(l.car)}</td><td>${userLink(l.seller)}</td><td class="num">${money(l.price)}</td>
          <td class="num ${l.price < l.car.value * 0.5 || l.price > l.car.value * 3 ? 'bad' : ''}">${Math.round((l.price / l.car.value) * 100)}%</td><td class="small">${ago(l.at)}</td>
          <td><button class="btn red sm" data-act="unlist" data-kind="listing" data-id="${l.id}">Зняти</button></td></tr>`).join('')}</table></div>` : '<div class="empty">Лотів немає</div>'}
    </div>
    <div class="panel"><h2>Аукціони <span class="sub">${auctions.length}</span></h2>
      ${auctions.length ? `<div class="tbl-wrap"><table><tr><th>Авто</th><th>Продавець</th><th class="num">Старт</th><th class="num">Ставка</th><th>Лідер</th><th>Кінець</th><th></th></tr>
        ${auctions.map((a) => `<tr><td>${carCell(a.car)}</td><td>${userLink(a.seller)}</td><td class="num">${money(a.startPrice)}</td><td class="num">${a.topBid ? `${money(a.topBid)} <span class="muted small">(${a.bids})</span>` : '—'}</td>
          <td>${a.leader ? userLink(a.leader) : '—'}</td><td class="small">${date(a.endsAt)}</td>
          <td><button class="btn red sm" data-act="unlist" data-kind="auction" data-id="${a.id}">Зняти</button></td></tr>`).join('')}</table></div>` : '<div class="empty">Аукціонів немає</div>'}
    </div>
    <div class="small muted">Знятий лот повертається в гараж продавця, ставка лідера аукціону — йому на рахунок. Червоним позначено підозрілі ціни (менше 50% або більше 300% оцінки).</div>`;
};
H.dealerRefresh = (d, el) => armed(el, 'Точно оновити?') && doAndReload('dealer/refresh', {}, 'Дилер виставив нові лоти');
H.unlist = (d, el) => {
  if (!armed(el)) return;
  doAndReload('market/remove', { kind: d.kind, id: Number(d.id) }, 'Лот знято');
};

// ---------- promo codes ----------
VIEWS.promos = async () => {
  const { list } = await api('promos');
  return `<div class="head"><h1>Промокоди</h1></div>
    <div class="panel"><h2>Новий промокод</h2>
      <form class="row" id="promoForm">
        <input id="pcCode" placeholder="КОД" style="text-transform:uppercase;width:160px">
        <input id="pcAmount" inputmode="numeric" placeholder="Сума ₴" style="width:140px">
        <input id="pcUses" inputmode="numeric" placeholder="Скільки разів" style="width:140px">
        <input id="pcDays" inputmode="numeric" placeholder="Днів (необов’язково)" style="width:170px">
        <button class="btn">${ic('plus')} Створити</button>
      </form>
      <div class="small muted" style="margin-top:8px">Кожен гравець може використати код один раз. Той самий код замінює старий.</div></div>
    <div class="panel"><h2>Усі коди <span class="sub">${list.length}</span></h2>
      ${list.length ? `<table><tr><th>Код</th><th class="num">Сума</th><th class="num">Використано</th><th class="num">Залишилось</th><th>Діє до</th><th></th></tr>
        ${list.map((p) => {
          const dead = p.usesLeft <= 0 || (p.expiresAt && p.expiresAt < Date.now());
          return `<tr><td><b>${esc(p.code)}</b> ${dead ? '<span class="badge">неактивний</span>' : '<span class="badge green">діє</span>'}</td><td class="num">${money(p.amount)}</td><td class="num">${p.used}</td><td class="num">${p.usesLeft}</td>
            <td class="small">${p.expiresAt ? date(p.expiresAt) : 'безстроково'}</td><td><button class="btn red sm" data-act="delPromo" data-code="${esc(p.code)}">${ic('trash')}</button></td></tr>`;
        }).join('')}</table>` : '<div class="empty">Промокодів ще немає</div>'}</div>`;
};
AFTER.promos = () => $('#promoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { code: $('#pcCode').value.trim(), amount: num('#pcAmount'), uses: num('#pcUses'), days: num('#pcDays') || null };
  if (await act('promo/create', body, (r) => `Промокод ${r.code} створено`)) render();
});
H.delPromo = (d, el) => armed(el) && doAndReload('promo/delete', { code: d.code }, 'Видалено');

// ---------- payments ----------
VIEWS.payments = async () => {
  const { list, total } = await api('payments', { offset: state.offset });
  return `<div class="head"><h1>Платежі</h1><span class="badge amber">⭐ ${total.stars} усього · ${total.n} платежів</span></div>
    <div class="panel">${list.length ? `<div class="tbl-wrap"><table><tr><th>Коли</th><th>Гравець</th><th>Пакет</th><th class="num">Зірки</th><th class="num">Гривні</th><th>ID платежу</th></tr>
      ${list.map((p) => `<tr><td class="small nowrap">${date(p.at)}</td><td>${userLink({ id: p.userId, name: p.name })}</td><td>${esc(p.pack)}</td><td class="num">⭐ ${p.stars}</td><td class="num">${money(p.amount)}</td><td class="small muted">${esc(p.chargeId)}</td></tr>`).join('')}
    </table></div>${pager(state.offset, 100, list.length, total.n)}` : '<div class="empty">Платежів ще не було</div>'}</div>`;
};

// ---------- support: players' messages from the game; the answer pops up in their game ----------
VIEWS.support = async () => {
  const { list, open } = await api('support', { open: state.supOpen });
  const n = $('#supN');
  if (n) (n.textContent = open), (n.hidden = !open);
  return `<div class="head"><h1>Підтримка</h1><span class="badge ${open ? 'red' : 'green'}">${open ? `${open} без відповіді` : 'усім відповіли'}</span>
      <label class="row small muted" style="margin-left:auto"><input type="checkbox" id="supOpen" ${state.supOpen ? 'checked' : ''} style="width:auto"> лише без відповіді</label></div>
    ${list.length ? list.map((m) => `<div class="panel"><div class="row between"><div>${m.user ? userLink(m.user) : '—'} <span class="muted small">рів. ${m.user?.level ?? '?'} · ${date(m.at)}</span></div><span class="muted small">#${m.id}</span></div>
      <div style="white-space:pre-wrap;margin:8px 0">${esc(m.text)}</div>
      ${m.answer ? `<div class="small"><b>Відповідь</b> <span class="muted">(${esc(m.by || '')}, ${date(m.answeredAt)})</span><div style="white-space:pre-wrap">${esc(m.answer)}</div></div>`
        : `<textarea id="supA${m.id}" placeholder="Відповідь — гравець побачить її у грі й у боті"></textarea><button class="btn sm" data-act="supReply" data-id="${m.id}">Відповісти</button>`}</div>`).join('')
      : '<div class="panel"><div class="empty">Звернень немає</div></div>'}`;
};
AFTER.support = () => $('#supOpen').addEventListener('change', (e) => ((state.supOpen = e.target.checked), render()));
H.supReply = (d) => {
  const text = $('#supA' + d.id).value.trim();
  if (!text) return toast('Напиши відповідь', true);
  doAndReload('support/reply', { id: Number(d.id), text }, 'Відповідь надіслано');
};

// ---------- admin log ----------
VIEWS.log = async () => {
  const { list } = await api('log', { offset: state.offset });
  return `<div class="head"><h1>Журнал дій</h1></div>
    <div class="panel">${list.length ? `<div class="tbl-wrap"><table><tr><th>Коли</th><th>Хто</th><th>Дія</th><th>Гравець</th><th>Деталі</th></tr>
      ${list.map((l) => `<tr><td class="small nowrap">${date(l.at)}</td><td class="small">${esc(l.admin)}</td><td>${ACTIONS[l.action] || esc(l.action)}</td>
        <td>${l.target ? userLink({ id: l.target, name: l.targetName }) : '—'}</td><td>${details(l.action, l.details)}</td></tr>`).join('')}
    </table></div>${pager(state.offset, 100, list.length, null)}` : '<div class="empty">Записів ще немає</div>'}</div>`;
};

// ---------- start ----------
async function start() {
  try {
    const w = await api('whoami');
    state.role = w.role;
    const who = { key: 'вхід за ключем', local: 'локальний доступ (DEV)' }[w.who] || `Telegram ${w.who.slice(3)}`;
    $('#who').innerHTML = `${esc(who)} · ${ROLE_NAMES[w.role] || ''}${w.who === 'key' ? ' · <a data-act="logout">вийти</a>' : ''}`;
    fetch('/api/config').then((r) => r.json()).then((c) => {
      setImages(c.images || {});
      if (state.view === 'user') render();
    }).catch(() => {});
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
start();
