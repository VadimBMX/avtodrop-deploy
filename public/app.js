import * as S from './shared.js';
import { carArt, setImages } from './car.js';
import * as FX from './fx.js';

const tg = window.Telegram?.WebApp;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => Number(String(v ?? '').replace(/[\s ]/g, ''));
const M = (id) => S.MODELS[id];
const clsBadge = (cls, extra = '') => `<span class="cls ${extra}" style="background:${S.CLASSES[cls].color}">${cls}</span>`;
const tierCls = (tier) => S.TIER_BY_ID[tier].cls;
const flag = (id) => S.COUNTRIES[M(id).country].flag;
// Line icons from public/icons.svg (Tabler, MIT).
const ic = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="icons.svg#i-${name}"/></svg>`;
// Country cases show the country code instead of an emoji flag (flags render as letters on Windows anyway).
// Round flag emblems for the country cases (drawn, since emoji flags don't render on Windows).
const FLAG_SVG = {
  UA: '<rect width="30" height="10" fill="#0057b7"/><rect y="10" width="30" height="10" fill="#ffd700"/>',
  JP: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>',
  DE: '<rect width="30" height="7" fill="#000"/><rect y="6.6" width="30" height="7" fill="#dd0000"/><rect y="13.3" width="30" height="6.7" fill="#ffce00"/>',
  IT: '<rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ce2b37"/>',
  US: `<rect width="30" height="20" fill="#fff"/>${[0, 2, 4, 6].map((i) => `<rect y="${i * 2.86}" width="30" height="1.43" fill="#b22234"/>`).join('')}<rect y="17.14" width="30" height="2.86" fill="#b22234"/><rect width="14" height="10" fill="#3c3b6e"/>${[[3, 2.5], [7, 2.5], [11, 2.5], [5, 5], [9, 5], [3, 7.5], [7, 7.5], [11, 7.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".8" fill="#fff"/>`).join('')}`,
  GB: '<rect width="30" height="20" fill="#012169"/><path d="M0,0 30,20M30,0 0,20" stroke="#fff" stroke-width="4"/><path d="M0,0 30,20M30,0 0,20" stroke="#c8102e" stroke-width="1.4"/><path d="M15,0v20M0,10h30" stroke="#fff" stroke-width="6"/><path d="M15,0v20M0,10h30" stroke="#c8102e" stroke-width="3.6"/>',
};
FLAG_SVG.CN = '<rect width="30" height="20" fill="#de2910"/><polygon points="5,2 6.2,5.6 10,5.6 6.9,7.8 8.1,11.4 5,9.2 1.9,11.4 3.1,7.8 0,5.6 3.8,5.6" fill="#ffde00"/>';
const flagEmblem = (c) => (FLAG_SVG[c] ? `<span class="flag-emb"><svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" aria-label="${c}">${FLAG_SVG[c]}</svg></span>` : `<span class="cc">${c}</span>`);
const caseIcon = (cs) => (cs.country ? flagEmblem(cs.country) : ic(cs.icon));
const partIcon = (type) => ic(S.PARTS[type].icon);
// A part as a picture: its photo from public/parts/<type>.webp when there is one, otherwise its icon on a tile tinted by tier.
function partArt(type, tier, size = '') {
  const c = tier ? S.CLASSES[S.TIER_BY_ID[tier].cls].color : '#8e8e93';
  const img = config.partImages?.[type];
  return `<span class="part ${size} ${img ? 'photo' : ''}" style="--c:${c}">${img ? `<img src="${img}" alt="" loading="lazy">` : ic(S.PARTS[type].icon)}</span>`;
}
const countryTag = (c) => `<span class="cc sm">${c}</span>`;

let config = { dev: false, packs: [], images: {} };
let me = null;
let clockOffset = 0;
const H = {};
const state = {
  tab: 'garage', page: null, garageView: 'cars', selling: null,
  caseId: 'rust', count: 1, fast: false, drop: null, opening: false,
  raceView: 'race', raceCar: null, race: null,
  shopView: 'cases', partCase: 'scrap', partType: null, partCount: 1, partDrop: null,
  plateView: 'gen', plateDrop: null, marketTab: 'buy', marketCls: '', marketSort: 'new',
  lbType: 'season', collFilter: '', collAll: false, trade: null,
};

// ---------- infrastructure ----------
function devUser() {
  const p = new URLSearchParams(location.search);
  const key = 'devUser' + (p.get('as') || '');
  let u = null;
  try {
    u = JSON.parse(localStorage.getItem(key) || 'null');
  } catch {}
  if (!u) {
    u = p.get('as') ? { id: Number(p.get('as')), first_name: p.get('name') || 'Гравець', username: p.get('name') || null } : { id: 1e9 + Math.floor(Math.random() * 1e6), first_name: 'Тестер' };
    try {
      localStorage.setItem(key, JSON.stringify(u));
    } catch {}
  }
  return u;
}
async function api(name, body = {}) {
  const headers = { 'content-type': 'application/json' };
  if (tg?.initData) headers['x-init-data'] = tg.initData;
  else if (config.dev) headers['x-dev-user'] = encodeURIComponent(JSON.stringify(devUser()));
  let r;
  try {
    r = await fetch('/api/' + name, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('Немає з’єднання з сервером');
  }
  const j = await r.json().catch(() => ({ error: 'Помилка сервера' }));
  if (!r.ok) throw new Error(j.error || 'Помилка');
  return j;
}
function haptic(kind) {
  if (!tg?.initData) return;
  try {
    if (['success', 'error', 'warning'].includes(kind)) tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind || 'light');
  } catch {}
}
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
async function act(name, body, ok, { rerender = true } = {}) {
  try {
    const r = await api(name, body);
    if (r?.stale) {
      toast(r.message, true);
      await refresh();
      return null;
    }
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
    haptic('success');
    await refresh(rerender);
    return r;
  } catch (e) {
    toast(e.message, true);
    haptic('error');
    return null;
  }
}
function confirmBox(text) {
  return new Promise((res) => {
    if (tg?.initData && tg.showConfirm && tg.isVersionAtLeast?.('6.2')) return tg.showConfirm(text, (ok) => res(ok));
    // Own dialog outside Telegram: window.confirm is blocked in embedded browsers and returns false at once.
    const box = document.createElement('div');
    box.className = 'confirm';
    box.innerHTML = `<div class="confirm-card"><div class="confirm-text">${esc(text)}</div><div class="btns"><button class="btn ghost" data-ok="0">Скасувати</button><button class="btn yellow" data-ok="1">Так</button></div></div>`;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ok]');
      if (!b && e.target !== box) return;
      e.stopPropagation();
      box.remove();
      res(b?.dataset.ok === '1');
    });
    document.body.append(box);
  });
}
let sheetBack = null;
function sheet(title, html, back = null) {
  sheetBack = back;
  $('#sheet').innerHTML = `<div class="sheet-head">${back ? '<button class="bk" data-act="sheetBack">‹ Назад</button>' : '<span class="spacer"></span>'}<h3>${title}</h3><button class="x" data-act="closeModal">✕</button></div>${html}`;
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
  $('#sheet').innerHTML = '';
  sheetBack = null;
}
H.closeModal = closeModal;
H.sheetBack = () => sheetBack?.();
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal' && !state.opening) closeModal();
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = H[el.dataset.act];
  if (fn) {
    haptic('light');
    fn(el.dataset, el, e);
  }
});
const left = (ms) => {
  ms = Math.max(0, ms);
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), s = Math.floor((ms % 60e3) / 1000);
  if (h >= 24) return `${Math.floor(h / 24)} д ${h % 24} год`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const serverNow = () => Date.now() + clockOffset;
const plateGroups = (text, wrapChars = false) => String(text).split(' ').map((g) => `<span class="g">${wrapChars ? [...g].map((c) => `<span class="ch">${esc(c)}</span>`).join('') : esc(g)}</span>`).join('');
const plate = (text, size = '') => `<span class="plate ${size}"><span class="ua"><i></i>UA</span><span class="tx"><span class="txi">${plateGroups(text)}</span></span></span>`;

// Plate typography adapts to whatever condensed font the device has: capitals are sized to 62% of the
// plate height and centred vertically, measured from the real font metrics.
function measurePlateFont() {
  const probe = document.createElement('span');
  probe.innerHTML = plate('AA 0000 AA', 'lg');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
  document.body.appendChild(probe);
  const family = getComputedStyle(probe.querySelector('.txi')).fontFamily;
  probe.remove();
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `700 100px ${family}`;
  const m = ctx.measureText('H');
  const cap = m.actualBoundingBoxAscent, A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent;
  if (!cap || !A) return;
  const root = document.documentElement.style;
  root.setProperty('--plate-fs', (62 / cap).toFixed(4));
  root.setProperty('--plate-lh', ((A + D) / 100).toFixed(4));
  root.setProperty('--plate-dy', ((D - A + cap) / 200).toFixed(4));
}
// Squeeze or stretch the text so it fills the plate exactly like on a real one.
function fitPlate(p) {
  const tx = p.querySelector('.tx'), t = p.querySelector('.txi');
  if (!tx || !t) return;
  const cs = getComputedStyle(tx);
  const avail = tx.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const natural = t.offsetWidth;
  // Wide text is condensed to fit; narrow text (e.g. "II 1111 II") is barely stretched so glyphs keep their shape.
  if (avail > 0 && natural > 0) t.style.setProperty('--sx', Math.max(0.55, Math.min(1.05, avail / natural)).toFixed(4));
}
new MutationObserver((list) => {
  for (const m of list) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.classList.contains('plate')) fitPlate(n);
    else n.querySelectorAll?.('.plate').forEach(fitPlate);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
const pct = (p) => (p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p >= 0.1 ? p.toFixed(2) : p.toFixed(3)).replace('.', ',') + '%';
function dots(weights, map = (k) => k) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return `<div class="dots">${Object.entries(weights).map(([k, w]) => `<span style="--c:${S.CLASSES[map(k)].color}">${pct((w / total) * 100)}</span>`).join('')}</div>`;
}
const partCount = (c) => S.partKeysOf(c.model).filter((k) => c.parts?.[k]).length;
const partSlots = (c) => S.partKeysOf(c.model).length;
function carTile(c, { act = 'car', sel = false, isNew = false, showTank = false } = {}) {
  const m = M(c.model);
  return `<button class="car r${S.rankOf(m.cls)} ${sel ? 'sel' : ''} ${c.status === 'market' || c.status === 'auction' ? 'listed' : ''}" data-act="${act}" data-id="${c.id}" style="--c:${S.CLASSES[m.cls].color}">
    ${clsBadge(m.cls, 'tl')}<span class="tr">${isNew ? '<span class="new">NEW</span>' : ''}<span class="chip">${ic('tool')}${partCount(c)}/${partSlots(c)}</span></span>
    <div class="art">${carArt(c.model)}</div>
    <div class="nm ellipsis">${esc(m.name)}</div>
    ${c.plate ? `<div class="meta">${plate(c.plate.text, 'sm')}</div>` : ''}
    <div class="meta row between" style="gap:4px"><span>${c.hp} к.с.</span><b class="disp" style="color:var(--text);font-size:14px;font-weight:600">${S.short(c.value)}</b></div>
    ${showTank ? `<div class="tank">${Array.from({ length: S.CAR_TANK }, (_, i) => `<i class="${i < c.tank ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    ${c.status === 'market' ? `<div class="status">${ic('building-store')}На ринку</div>` : c.status === 'auction' ? `<div class="status">${ic('hammer')}На аукціоні</div>` : ''}
  </button>`;
}
function carRow(c, right = '') {
  const m = M(c.model);
  return `<div class="li"><div class="mini art">${carArt(c.model)}</div><div class="grow"><div class="ellipsis"><b>${esc(m.name)}</b></div>
    <div class="small muted">${clsBadge(m.cls)} ${c.plate ? plate(c.plate.text, 'sm') : ''} ${c.hp} к.с. · ${S.short(c.value)}</div></div>${right}</div>`;
}
function rewardText(rw) {
  if (!rw) return '';
  const parts = [];
  if (rw.money) parts.push(S.fmt(rw.money));
  if (rw.parts) parts.push(`Деталі ${S.TIER_BY_ID[rw.tier].name} ×${rw.parts}`);
  if (rw.car) parts.push(`Машина класу ${rw.car}`);
  if (rw.caseId) parts.push(`Кейс «${S.CASE_BY_ID[rw.caseId].name}»${rw.count > 1 ? ` ×${rw.count}` : ''}`);
  if (rw.seasonCar) parts.push(M(rw.seasonCar).name);
  if (rw.slots) parts.push(`+${rw.slots} місце в гаражі`);
  if (rw.fuel) parts.push('Повний бак');
  return parts.join(' · ');
}

// ---------- header & navigation ----------
const TITLES = { garage: 'Гараж', cases: 'Кейси', race: 'Гонки', shop: 'Майстерня', menu: 'Меню' };
const PAGE_TITLES = { casino: 'Казино', upgrade: 'Апгрейд', collection: 'Колекція', plates: 'Номери', market: 'Ринок', trades: 'Обміни', tradeNew: 'Новий обмін', room: 'Кімната обміну', battles: 'Кейс-батли', battle: 'Батл', quests: 'Завдання', leaderboard: 'Рейтинг', store: 'Магазин', season: 'Сезон', friends: 'Друзі', promo: 'Промокоди', fair: 'Чесна гра', events: 'Сповіщення', achievements: 'Досягнення', support: 'Підтримка' };
function ring(level, xp, need, size = 40) {
  const r = size / 2 - 2, c = 2 * Math.PI * r, f = Math.min(1, xp / need);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#252c39" stroke-width="3"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#f5b301" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}
function renderHeader() {
  $('#balance').textContent = S.short(me.balance);
  const initial = (me.firstName || me.username || '?').trim()[0]?.toUpperCase() || '?';
  $('#avatar').innerHTML = `${ring(me.level, me.xp, me.xpNeed)}<span class="face">${esc(initial)}</span><span class="lvl">${me.level}</span>`;
  const giftReady = me.dailyReady || serverNow() >= me.rewardCaseAt;
  $('#giftBadge').hidden = !giftReady;
  $('#menuDot').hidden = !(me.incomingTrades || me.unread || claimableCollection() || me.newbie?.ready || me.achReady);
  $('#title').textContent = state.page ? PAGE_TITLES[state.page] : TITLES[state.tab];
  $('#title').classList.toggle('long', $('#title').textContent.length > 9);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === state.tab && !state.page);
  if (tg?.initData && tg.BackButton) state.page ? tg.BackButton.show() : tg.BackButton.hide();
}
function go(page) {
  state.page = page;
  closeModal();
  window.scrollTo(0, 0);
  render();
}
function back() {
  if (!$('#modal').hidden) return sheetBack ? sheetBack() : closeModal();
  if (state.race && state.race.phase !== 'done') return;
  state.page = state.page === 'tradeNew' || state.page === 'room' ? 'trades' : state.page === 'battle' ? 'battles' : null;
  render();
}
document.querySelectorAll('#tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    if (state.race && state.race.phase !== 'done' && state.race.phase !== 'idle') return toast('Спочатку доїдь заїзд', true);
    if (state.drift && state.drift.phase !== 'done') return toast('Спочатку доїдь дрифт', true);
    state.drift = null;
    haptic('light');
    // Opening «Гонки» from the bottom bar always starts on the drag races (drift and PvP are the tabs next to it).
    if (b.dataset.tab === 'race' && state.tab !== 'race') state.raceView = 'race';
    state.tab = b.dataset.tab;
    state.page = null;
    state.selling = null;
    state.race = null;
    window.scrollTo(0, 0);
    render();
  }));
$('#balance').addEventListener('click', () => (state.tab = 'menu', go('store')));
$('#gift').addEventListener('click', () => openRewards());
$('#avatar').addEventListener('click', () => openProfile());
H.go = (d) => go(d.page);

async function refresh(rerender = true) {
  me = await api('me');
  clockOffset = me.now - Date.now();
  if (rerender) render();
  else renderHeader();
  // Let a drop's celebration play out before the level-up popup covers it.
  const wait = state.fx ? 2600 : 0;
  setTimeout(() => {
    if (me.level > me.levelSeen && $('#modal').hidden && !state.opening && !state.race && !battleTimers.length) showLevelUp();
  }, wait);
}
let renderSeq = 0;
async function render() {
  renderHeader();
  stopPoll(); // live pages (trade hall, room) start their own polling again in AFTER
  const seq = ++renderSeq;
  const fn = state.page ? PAGES[state.page] : TABS[state.tab];
  try {
    const html = await fn();
    if (seq !== renderSeq) return;
    $('#view').innerHTML = html;
    AFTER[state.page || state.tab]?.();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
const AFTER = {};
const TABS = {};
const PAGES = {};

// ---------- level up, profile, rewards ----------
function showLevelUp() {
  const rw = S.levelReward(me.level);
  sheet('', `<div class="center"><div class="ring">${ring(me.level, 1, 1, 84)}<span class="face">${me.level}</span></div>
    <div class="big mt">Рівень ${me.level}!</div><div class="muted">подарунок уже в тебе</div>
    <div class="card mt"><b class="win">${esc(rewardText(rw))}</b></div>
    <button class="btn" data-act="levelOk">Чудово</button></div>`);
  haptic('success');
}
H.levelOk = async () => {
  closeModal();
  await api('level/seen');
  me.levelSeen = me.level;
};
// ---------- achievements ----------
const ROMAN = ['I', 'II', 'III', 'IV'];
// Round badge in the colour of the highest tier claimed (grey while none is); a red dot when a tier waits.
function achBadge(s, size = '') {
  const a = S.ACH_BY_KEY[s.key], top = s.claimed - 1;
  const color = top >= 0 ? S.ACH_TIERS[top].color : '';
  return `<div class="badge-a ${size} ${top < 0 ? 'off' : ''} ${s.reached > s.claimed ? 'ready' : ''}" style="${color ? `--tc:${color}` : ''}">${ic(a.icon)}${top >= 0 ? `<span class="tn">${ROMAN[top]}</span>` : ''}</div>`;
}
const achDone = (list) => list.reduce((n, s) => n + s.claimed, 0);
const achTotal = () => S.ACHIEVEMENTS.reduce((n, a) => n + a.goals.length, 0);
PAGES.achievements = async () => {
  const { list } = await api('achievements');
  const ready = list.filter((s) => s.reached > s.claimed);
  return `<div class="card"><div class="row between"><b>Отримано рівнів</b><span class="muted">${achDone(list)} з ${achTotal()}</span></div>
      <div class="progress mt"><i style="width:${(achDone(list) / achTotal()) * 100}%"></i></div>
      <div class="tiny muted mt">Кожне досягнення має рівні: ${S.ACH_TIERS.map((t) => `<b style="color:${t.color}">${t.name}</b>`).join(' → ')}. Рахується й те, що ти зробив раніше.</div>
      ${ready.length > 1 ? `<button class="btn yellow mt" data-act="achClaimAll">${ic('gift')} Забрати все (${ready.length})</button>` : ''}</div>
    <div class="list">${list.map((s) => {
      const a = S.ACH_BY_KEY[s.key];
      const next = Math.min(s.claimed, a.goals.length - 1), done = s.claimed >= a.goals.length;
      const goal = a.goals[next], prog = Math.min(1, (s.value || 0) / goal);
      const val = a.money ? `${S.short(s.value)} / ${S.short(goal)}` : a.labels ? '' : `${Math.min(s.value, goal)} / ${goal}`;
      return `<div class="card ach-row">${achBadge(s, 'lg')}
        <div class="grow"><b>${esc(a.title)}</b> <span class="tiny muted">${s.claimed ? S.ACH_TIERS[s.claimed - 1].name : 'ще немає'}</span>
          <div class="small muted">${done ? 'Усі рівні пройдено!' : esc(S.achText(a, next))}</div>
          <div class="ach-dots">${a.goals.map((g, i) => `<i style="${i < s.claimed ? `background:${S.ACH_TIERS[i].color}` : i < s.reached ? 'background:#ff3b30' : ''}"></i>`).join('')}</div>
          ${done ? '' : `<div class="progress mt" style="height:5px"><i style="width:${prog * 100}%"></i></div>
          <div class="row between tiny muted mt"><span>${val}</span><span>${ic('gift')} ${S.short(a.rewards[next])}</span></div>`}</div>
        ${s.reached > s.claimed ? `<button class="btn sm yellow" data-act="achClaim" data-k="${s.key}">Забрати</button>` : ''}</div>`;
    }).join('')}</div>`;
};
H.achClaim = (d) => act('ach/claim', { key: d.k }, (r) => `Досягнення: +${S.fmt(r.got)}`);
H.achClaimAll = () => act('ach/claim', {}, (r) => `${r.tiers} досягнень: +${S.fmt(r.got)}`);

// "3 год 12 хв" / "12 хв" — time spent with the game open.
const playTime = (ms) => {
  const m = Math.floor((ms || 0) / 60e3);
  return m >= 60 ? `${Math.floor(m / 60)} год ${m % 60} хв` : `${m} хв`;
};
function openProfile() {
  const n = me.newbie;
  const initial = (me.firstName || me.username || '?').trim()[0]?.toUpperCase() || '?';
  sheet('Профіль', `<div class="center"><div class="ring">${ring(me.level, me.xp, me.xpNeed, 84)}<span class="face">${esc(initial)}</span><span class="lvl">${me.level}</span></div>
    <div style="font-size:20px;font-weight:900" class="mt">${esc(me.username ? '@' + me.username : me.firstName || 'Гравець')}</div>
    <div class="small muted">Рівень ${me.level} · ID ${me.id}</div>
    ${me.vip || me.badges.length ? `<div class="row mt" style="justify-content:center;flex-wrap:wrap;gap:6px">${me.vip ? vipChip() : ''}${me.badges.map(badgeChip).join('')}</div>` : ''}</div>
    <div class="progress mt"><i style="width:${(me.xp / me.xpNeed) * 100}%"></i></div>
    <div class="small muted center mt">${me.xp} / ${me.xpNeed} досвіду · до ${me.level + 1} рівня: +${S.short(S.levelReward(me.level + 1).money)}</div>
    <div class="tiny muted center">Досвід за кейси, номери й деталі сьогодні: ${me.xpToday}/${S.DAILY_XP_CAP}</div>
    <button class="btn ghost mt" data-act="go" data-page="season">${ic('ticket')} Сезонний пропуск · ${me.season.level}/${S.SEASON.levels}</button>
    ${n ? `<div class="h2"><span>Завдання новачка</span><span>${n.step + 1}/${n.total}</span></div>
      <div class="card row"><div class="grow"><b>${esc(n.text)}</b><div class="small muted">+${S.fmt(n.money)} · +${S.XP.task} досвіду</div></div>
      <button class="btn sm" data-act="newbieClaim" ${n.ready ? '' : 'disabled'}>${n.ready ? 'Забрати' : 'Виконай'}</button></div>` : ''}
    <div class="h2"><span>Статистика</span></div>
    <div class="stat"><div><b>${me.used}</b><span>у гаражі</span></div><div><b>${me.collection.filter((id) => !M(id)?.secret).length}/${S.ALL_MODELS.filter((m) => !m.secret).length}</b><span>колекція</span></div><div><b>${S.short(me.stats.value)}</b><span>вартість</span></div>
    <div><b>${me.stats.cases}</b><span>кейсів</span></div><div><b>${me.stats.wins}/${me.stats.races}</b><span>перемог/гонок</span></div><div><b>${me.stats.merges}</b><span>злиттів</span></div></div>
    <div class="card row between mt"><span class="row" style="gap:8px">${ic('clock')} Час у грі</span><b>${playTime(me.stats.playMs)}</b></div>
    <div class="h2"><span>Досягнення</span><span id="achCount"></span></div>
    <div class="card" data-act="go" data-page="achievements" style="cursor:pointer"><div class="badges" id="achBadges"><div class="tiny muted">Завантаження…</div></div></div>
    <div class="tiny muted mt">Досвід дають гонки (перемоги більше), нові машини в колекції, щоденний бонус і завдання — без обмежень. Кейси, номери, злиття й встановлення деталей — до ${S.DAILY_XP_CAP} досвіду на день.</div>
    <button class="btn ghost mt" data-act="go" data-page="quests">${ic('target-arrow')} Завдання на сьогодні</button>`);
  api('achievements').then(({ list }) => {
    const box = $('#achBadges');
    if (!box) return;
    // Earned badges first (highest tier first), then the ones still to get.
    const sorted = [...list].sort((x, y) => y.claimed - x.claimed || y.reached - x.reached);
    box.innerHTML = sorted.map((s) => `<div class="badge-cell">${achBadge(s)}<b>${esc(S.ACH_BY_KEY[s.key].title)}</b></div>`).join('');
    $('#achCount').textContent = `${achDone(list)}/${achTotal()}`;
  }, () => {});
}
H.newbieClaim = async () => {
  if (await act('newbie/claim', {}, (r) => `+${S.fmt(r.got)}`, { rerender: false })) openProfile();
};
async function openRewards(result) {
  let r;
  try {
    r = await api('rewards');
  } catch (e) {
    return toast(e.message, true);
  }
  const caseReady = serverNow() >= r.rewardCaseAt;
  const doneUpTo = r.ready ? r.nextDay - 1 : r.todayIndex + 1;
  sheet('Нагороди', `${result ? `<div class="card center"><div class="small muted">${esc(result.title)}</div><div style="font-size:18px;font-weight:900" class="win mt">${esc(result.text)}</div>${result.car ? `<div class="art" style="height:90px">${carArt(result.car.model, { glow: true })}</div><b>${esc(M(result.car.model).name)}</b>` : ''}</div>` : ''}
    <div class="h2"><span>Щоденний бонус</span><span>день ${r.ready ? r.nextDay : r.todayIndex + 1} з ${r.days.length}</span></div>
    <div class="card"><div class="days">${r.days.map((d, i) => {
      const e = ic(d.money ? 'coin' : d.parts ? 'tool' : d.car ? 'car' : 'car-turbine');
      const label = d.money ? S.short(d.money).replace(' ₴', '') : d.parts ? `Деталі ×${d.parts}` : d.label;
      const today = r.ready && i === r.nextDay - 1;
      return `<div class="day ${d.big ? 'big' : ''} ${today ? 'today' : ''} ${i < doneUpTo ? 'done' : ''}"><small>ДЕНЬ ${i + 1}${i < doneUpTo ? ' ✓' : ''}</small><div class="e">${e}</div><b>${esc(label)}</b></div>`;
    }).join('')}</div>
    <div class="tiny muted mt">Заходь щодня: на 7-й день машина зі «Спорткара», на 14-й — з «Еліти». Пропустив день — нічого не згорає, продовжиш з того ж місця.</div>
    ${r.vip ? `<div class="tiny mt" style="color:var(--accent)">${ic('crown')} VIP: ще +${S.short(r.vipDaily)} щодня до бонусу</div>` : `<div class="tiny muted mt">${ic('crown')} З VIP — ще +${S.short(r.vipDaily)} щодня</div>`}
    <button class="btn mt" data-act="claimDaily" ${r.ready ? '' : 'disabled'}>${r.ready ? `Забрати · день ${r.nextDay}` : 'Наступний через <span data-until="' + (new Date(new Date().toDateString()).getTime() + 86400e3) + '"></span>'}</button></div>
    <div class="h2"><span>Кейс нагород</span><span>раз на ${S.REWARD_CASE_HOURS} год</span></div>
    <div class="card row"><span class="ic" style="font-size:24px;color:var(--accent);display:inline-flex">${ic('gift')}</span><div class="grow"><b>Кейс нагород</b><div class="small muted">Гроші, деталь, повний бак або машина</div></div>
      ${caseReady ? '<button class="btn sm" data-act="claimRewardCase">Відкрити</button>' : `<span class="chip" data-until="${r.rewardCaseAt - clockOffset}"></span>`}</div>
    <div class="h2"><span>Колекція</span></div>
    <div class="list"><button class="li" data-act="go" data-page="collection"><span class="ic">${ic('books')}</span><div class="grow"><b>Нагороди за колекцію</b><div class="small muted">Збирай машини й цілі країни</div></div>${claimableCollection() ? '<span class="badge" style="position:static">!</span>' : `<span class="chev">${ic('chevron-right')}</span>`}</button></div>`);
  tickUntil();
}
H.claimDaily = async () => {
  const r = await act('rewards/daily', {}, null, { rerender: false });
  if (r) openRewards({ title: `День ${((r.streak - 1) % S.DAILY_BONUS.length) + 1}`, text: rewardText(r.reward) + (r.reward.items ? ': ' + r.reward.items.map((p) => S.PARTS[p.type].name).join(', ') : '') + (r.reward.vip ? ` + VIP ${S.short(r.reward.vip)}` : ''), car: r.reward.carOut });
};
H.claimRewardCase = async () => {
  const r = await act('rewards/case', {}, null, { rerender: false });
  if (r) openRewards({ title: 'Кейс нагород', text: r.reward.items ? S.partLabel(r.reward.items[0].type, r.reward.items[0].tier) : rewardText(r.reward), car: r.reward.carOut });
};
function tickUntil() {
  document.querySelectorAll('[data-until]').forEach((el) => (el.textContent = left(Number(el.dataset.until) - Date.now())));
}
setInterval(tickUntil, 1000);

// ---------- garage ----------
function pendingNow() {
  const i = me.income;
  const elapsed = Math.max(0, serverNow() - i.since) / 3600e3;
  return Math.floor(Math.max(Math.min(i.banked + i.rate * elapsed, i.rate * i.capH), i.banked));
}
TABS.garage = () => {
  const seg = `<div class="seg">${[['cars', 'Машини'], ['showcase', 'Вітрина']].map(([k, t]) => `<button class="${state.garageView === k ? 'on' : ''}" data-act="gView" data-k="${k}">${t}</button>`).join('')}</div>`;
  if (state.garageView === 'showcase') {
    const cars = me.cars.filter((c) => c.status === 'showcase');
    const free = me.showcaseSlots - cars.length;
    return seg + `<div class="card"><div class="row between"><b class="disp" style="font-size:17px;letter-spacing:.5px">${ic('building-arch')} ВІТРИНА</b><span class="muted">${cars.length}/${me.showcaseSlots}</span></div>
      <div class="small muted mt">Улюблені машини на постаменті. Тут вони не їздять і не приносять доходу, зате не займають місця в гаражі. Твою вітрину бачать інші гравці з рейтингу.</div></div>
      <div class="grid">${cars.map((c) => carTile(c)).join('')}${Array.from({ length: free }, () => '<button class="slot" data-act="showcasePick">+ Виставити машину</button>').join('')}
      ${me.showcaseSlots < S.SHOWCASE_MAX ? `<button class="slot buy" data-act="buyShowcase">+<span>Місце на вітрині</span><b>${S.short(S.showcaseCost(me.showcaseSlots))}</b></button>` : ''}</div>`;
  }
  const i = me.income;
  const pending = pendingNow();
  const fill = i.rate ? Math.min(100, (pending / (i.rate * i.capH)) * 100) : 0;
  const nextCap = S.CAP_LEVELS[me.capLevel + 1];
  const cars = me.cars.filter((c) => c.status !== 'showcase').sort((a, b) => b.value - a.value);
  const total = cars.reduce((s, c) => s + c.value, 0);
  const sel = state.selling;
  const selTotal = sel ? sellTotal(cars.filter((c) => sel.has(c.id)).map((c) => c.model)) : 0;
  const free = Math.max(0, me.slots - cars.length);
  return seg + `${overfullHtml()}
  <div class="card">
    <div class="row between small muted"><span>Дохід гаража</span><span>${S.short(i.rate)} / год</span></div>
    <div class="big" id="pending">${S.fmt(pending)}</div>
    <div class="progress mt"><i id="capBar" style="width:${fill}%"></i></div>
    <button class="btn mt" data-act="collect" ${pending < 1 ? 'disabled' : ''}>Забрати</button>
    <div class="tiny muted center mt">Копиться до ${i.capH} год, потім зупиняється${nextCap ? ` · <a data-act="upgradeCap" style="color:#f5b301">сховище до ${nextCap.hours} год за ${S.short(nextCap.cost)}</a>` : ''}</div>
  </div>
  <div class="h2"><span>Машини ${cars.length}/${me.slots}</span><span>${S.short(total)}</span></div>
  ${cars.length > 1 ? `<div class="row between" style="margin:-2px 2px 10px"><span class="small muted">${sel ? `Обрано ${sel.size} · ${S.fmt(selTotal)}` : 'Продаж: 40–70% ціни моделі, деталі й номер повертаються'}</span>
    <span class="row">${sel ? `<button class="btn sm red" data-act="sellSel" ${sel.size ? '' : 'disabled'}>Продати</button>` : ''}<button class="btn sm ghost" data-act="sellMode">${sel ? 'Скасувати' : 'Продати'}</button></span></div>` : ''}
  <div class="grid">${cars.map((c) => carTile(c, { sel: sel?.has(c.id), act: sel ? 'selToggle' : 'car' })).join('')}
    ${Array.from({ length: free }, () => '<button class="slot" data-act="toCases">+ Вільне місце</button>').join('')}
    ${me.slots < S.MAX_SLOTS ? `<button class="slot buy" data-act="buySlot">+<span>Місце в гаражі</span><b>${S.short(S.slotCost(me.slots))}</b></button>` : ''}</div>`;
};
H.gView = (d) => (state.garageView = d.k, render());
H.toCases = () => (state.tab = 'cases', render());
H.collect = () => act('collect', {}, (r) => `+${S.fmt(r.got)}`);
// Purchases confirm with a second tap on the same button (no pop-up), so several slots can be bought in a row.
H.buySlot = (d, el) => armed(el, `<b>Точно купити?</b><span>${S.short(S.slotCost(me.slots))}</span>`) && act('buy-slot', {}, `Місце додано · тепер ${me.slots + 1}`);
H.upgradeCap = (d, el) => {
  const n = S.CAP_LEVELS[me.capLevel + 1];
  if (armed(el, `Точно? до ${n.hours} год за ${S.short(n.cost)}`)) act('upgrade-cap', {}, 'Сховище покращено');
};
H.buyShowcase = (d, el) => armed(el, `<b>Точно купити?</b><span>${S.short(S.showcaseCost(me.showcaseSlots))}</span>`) && act('buy-showcase', {}, 'Місце додано');
H.showcasePick = () => pickCar('Яку машину на вітрину?', (id) => act('showcase', { carId: id, put: true }, 'Машина на вітрині'));
H.sellMode = () => (state.selling = state.selling ? null : new Set(), render());
H.selToggle = (d) => {
  const id = Number(d.id);
  const c = me.cars.find((x) => x.id === id);
  if (c.status !== 'garage') return toast('Авто зараз на ринку', true);
  if (M(c.model).secret) return toast('Секретну машину продати не можна — це нагорода за колекцію', true);
  state.selling.has(id) ? state.selling.delete(id) : state.selling.add(id);
  render();
};
H.sellSel = async () => {
  const ids = [...state.selling];
  if (!(await confirmBox(`Продати ${ids.length} авто? Деталі й номери повернуться тобі.`))) return;
  if (await act('sell', { carIds: ids }, (r) => `Продано: +${S.fmt(r.got)}`)) {
    state.selling = null;
    render();
  }
};
setInterval(() => {
  if (!me || state.page || state.tab !== 'garage' || state.garageView !== 'cars') return;
  const el = $('#pending');
  if (!el) return;
  const p = pendingNow();
  el.textContent = S.fmt(p);
  if (me.income.rate) $('#capBar').style.width = Math.min(100, (p / (me.income.rate * me.income.capH)) * 100) + '%';
}, 1000);
function pickCar(title, onPick, filter = (c) => c.status === 'garage', back = null) {
  const list = me.cars.filter(filter);
  H.pickedCar = (d) => {
    closeModal();
    onPick(Number(d.id));
  };
  sheet(title, list.length ? `<div class="grid">${list.map((c) => carTile(c, { act: 'pickedCar' })).join('')}</div>` : '<div class="empty">Немає доступних авто</div>', back);
}

// ---------- car sheet ----------
function carSheet(id) {
  const c = me.cars.find((x) => x.id === Number(id));
  if (!c) return closeModal();
  const m = M(c.model);
  const minTier = S.minTierFor(m.cls);
  const locked = c.status === 'market' || c.status === 'auction';
  sheet(esc(m.name), `
    <div class="center">${clsBadge(m.cls)} <span class="chip">${S.CLASSES[m.cls].name}</span> <span class="chip">${S.COUNTRIES[m.country].flag} ${S.COUNTRIES[m.country].name}</span> <span class="chip">${m.year}</span></div>
    <div class="hero"><div class="art">${carArt(c.model, { glow: S.rankOf(m.cls) >= 3 })}</div>${c.plate ? `<div class="plate-on">${plate(c.plate.text)}</div>` : ''}</div>
    <div class="stat four"><div><b>${c.hp}</b><span>к.с.${c.hp > m.hp ? ` <span class="win">+${c.hp - m.hp}</span>` : ''}</span></div><div><b>${c.et.toFixed(2)}</b><span>402 м, с</span></div><div><b>${S.short(c.value)}</b><span>вартість</span></div><div><b>${S.short(c.income)}</b><span>дохід / год</span></div></div>
    ${locked ? `<div class="card mt center muted">Авто виставлено на ${c.status === 'market' ? 'ринок' : 'аукціон'} — керуй ним у «Меню → Ринок → Мої лоти».</div>` : `
    <div class="list mt">
      <button class="li" data-act="carShowcase" data-id="${c.id}"><span class="ic">${ic('building-arch')}</span><div class="grow"><b>${c.status === 'showcase' ? 'Повернути в гараж' : 'Виставити на вітрину'}</b><div class="small muted">${c.status === 'showcase' ? 'знову приноситиме дохід' : `вільно місць: ${me.showcaseSlots - me.cars.filter((x) => x.status === 'showcase').length}`}</div></div><span class="chev">›</span></button>
      <button class="li" data-act="carPlate" data-id="${c.id}"><span class="ic">${ic('license')}</span><div class="grow"><b>Номер</b><div class="small muted">${c.plate ? `+${S.short(c.plate.value)} до вартості` : 'немає'}</div></div>${c.plate ? plate(c.plate.text, 'sm') : '<span class="chev">›</span>'}</button>
    </div>
    <div class="h2"><span>Тюнінг · ${partCount(c)}/${partSlots(c)}</span><span>${m.ev ? `${ic('bolt')} електро · ` : ''}деталі від ${S.TIERS[minTier].name}</span></div>
    <div class="list">${S.partKeysOf(c.model).map((k) => {
      const t = c.parts[k];
      return `<button class="li" data-act="carSlot" data-id="${c.id}" data-type="${k}">${partArt(k, t, 'sm')}<div class="grow"><b>${S.PARTS[k].name}</b><div class="small muted">${t ? S.partEffect(k, t) : S.PARTS[k].hint}</div></div>
        ${t ? clsBadge(tierCls(t)) + ` <b>${S.TIER_BY_ID[t].name}</b>` : '<span class="muted small">Порожньо ›</span>'}</button>`;
    }).join('')}</div>
    ${c.status === 'garage' ? `<div class="btns"><button class="btn yellow" data-act="raceWith" data-id="${c.id}">${ic('flag-3')} Гонка</button>${m.secret ? '' : `<button class="btn ghost" data-act="carSellMenu" data-id="${c.id}">${ic('cash')} Продати</button>`}</div>
      ${m.secret ? '<div class="tiny muted center mt">Секретна машина — нагорода за колекцію. Її не можна продати, обміняти чи поставити в апгрейд.</div>' : ''}` : ''}`}`);
}
H.car = (d) => carSheet(d.id);
H.carShowcase = async (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  if (await act('showcase', { carId: c.id, put: c.status !== 'showcase' }, c.status === 'showcase' ? 'Повернуто в гараж' : 'Машина на вітрині')) carSheet(c.id);
};
H.raceWith = (d) => {
  state.raceCar = Number(d.id);
  state.tab = 'race';
  state.page = null;
  state.raceView = 'race';
  closeModal();
  render();
};
H.carSlot = (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  const type = d.type;
  const minTier = S.minTierFor(M(c.model).cls);
  const cur = c.parts[type];
  const inv = me.parts.filter((p) => p.type === type).sort((a, b) => S.TIER_BY_ID[b.tier].index - S.TIER_BY_ID[a.tier].index);
  sheet(S.PARTS[type].name, `
    ${cur ? `<div class="h2"><span>Встановлено</span></div><div class="list"><div class="li">${partArt(type, cur, 'sm')}<div class="grow"><b>${S.partLabel(type, cur)}</b><div class="small muted">${S.partEffect(type, cur)} · +${S.short(S.TIER_BY_ID[cur].price)}</div></div><button class="btn sm ghost" data-act="uninstall" data-id="${c.id}" data-type="${type}">Зняти</button></div></div>` : ''}
    <div class="h2"><span>На складі</span></div>
    ${inv.length ? `<div class="list">${inv.map((p) => {
      const ok = S.TIER_BY_ID[p.tier].index >= minTier;
      return `<div class="li">${partArt(type, p.tier, 'sm')}<div class="grow"><b>${S.partLabel(type, p.tier)} × ${p.count}</b><div class="small muted">${S.partEffect(type, p.tier)} · +${S.short(S.TIER_BY_ID[p.tier].price)}${p.cooling ? ` · остигає: ${p.cooling}` : ''}</div></div>
        <button class="btn sm" data-act="install" data-id="${c.id}" data-type="${type}" data-tier="${p.tier}" ${ok && p.available ? '' : 'disabled'}>${ok ? (cur ? 'Замінити' : 'Встановити') : 'Не підходить'}</button></div>`;
    }).join('')}</div>` : '<div class="card empty">Немає деталей цього типу.<br><br><button class="btn sm" data-act="toPartCases" data-type="' + type + '">До кейсів з деталями</button></div>'}
    <div class="tiny muted">Підходять деталі не нижче класу машини. Знята деталь ${S.PART_COOLDOWN_MIN} хв «остигає» — її не можна поставити чи злити.</div>`, () => carSheet(c.id));
};
H.install = async (d) => {
  const r = await act('parts/install', { carId: Number(d.id), type: d.type, tier: d.tier }, `${S.partLabel(d.type, d.tier)} встановлено`, { rerender: false });
  if (r) carSheet(d.id), render();
};
H.uninstall = async (d) => {
  if (await act('parts/uninstall', { carId: Number(d.id), type: d.type }, 'Деталь знято', { rerender: false })) carSheet(d.id), render();
};
H.toPartCases = (d) => {
  state.tab = 'shop';
  state.page = null;
  state.shopView = 'cases';
  state.partType = d.type;
  closeModal();
  render();
};
H.carPlate = (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  const free = me.plates.filter((p) => !p.carId);
  sheet('Номер', `${c.plate ? `<div class="center">${plate(c.plate.text, 'lg')}<div class="mt">${clsBadge(c.plate.cls)} <b>${S.fmt(c.plate.value)}</b></div></div><button class="btn ghost mt" data-act="plateDetach" data-pid="${c.plate.id}" data-id="${c.id}">Зняти номер</button>` : ''}
    <div class="h2"><span>Мої номери</span></div>
    ${free.length ? `<div class="list">${free.map((p) => `<div class="li">${plate(p.text)}<div class="grow small">${clsBadge(p.cls)} ${S.short(p.value)}</div><button class="btn sm" data-act="plateAttach" data-pid="${p.id}" data-id="${c.id}">Повісити</button></div>`).join('')}</div>`
      : `<div class="card empty">Номерів немає — їх генерують у «Меню → Номери».<br><br><button class="btn sm" data-act="go" data-page="plates">До номерів</button></div>`}
    <div class="tiny muted">Ціна номера додається до вартості машини та її доходу.</div>`, () => carSheet(c.id));
};
H.plateAttach = async (d) => {
  if (await act('plate/attach', { plateId: Number(d.pid), carId: Number(d.id) }, 'Номер встановлено', { rerender: false })) carSheet(d.id), render();
};
H.plateDetach = async (d) => {
  if (await act('plate/detach', { plateId: Number(d.pid) }, 'Номер знято', { rerender: false })) d.id ? carSheet(d.id) : null, render();
};
H.carSellMenu = (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  const quick = sellPrice(c.model);
  sheet('Продаж', `<div class="list">
    <button class="li" data-act="sellOne" data-id="${c.id}"><span class="ic">${ic('bolt')}</span><div class="grow"><b>Продати одразу · ${S.short(quick)}</b><div class="small muted">${Math.round(S.SELL_RATES[M(c.model).cls] * 100)}% ціни моделі. Деталі й номер повернуться тобі</div></div></button>
    <button class="li" data-act="listMarket" data-id="${c.id}"><span class="ic">${ic('building-store')}</span><div class="grow"><b>На ринок</b><div class="small muted">Свою ціну, комісія ${S.FEE * 100}%. Машина йде разом з деталями й номером</div></div></button>
    <button class="li" data-act="listAuction" data-id="${c.id}"><span class="ic">${ic('hammer')}</span><div class="grow"><b>На аукціон</b><div class="small muted">Торги 1–24 год, ставка в останню хвилину продовжує</div></div></button>
  </div>`, () => carSheet(c.id));
};
H.sellOne = async (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  if (!(await confirmBox(`Продати ${M(c.model).name} за ${S.fmt(sellPrice(c.model))}?`))) return;
  if (await act('sell', { carIds: [c.id] }, (r) => `+${S.fmt(r.got)}`)) closeModal();
};
H.listMarket = (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  sheet('На ринок', `${carRow(c)}<div class="small muted mt">Оцінка: ${S.fmt(c.value)} · комісія ${S.FEE * 100}%</div>
    <input id="price" class="mt" inputmode="numeric" value="${Math.round(c.value * 0.8)}"><button class="btn mt" data-act="doListMarket" data-id="${c.id}">Виставити</button>`, () => H.carSellMenu(d));
};
H.doListMarket = async (d) => {
  if (await act('market/sell', { carId: Number(d.id), price: num($('#price').value) }, 'Виставлено на ринок', { rerender: false })) {
    closeModal();
    state.marketTab = 'buy';
    go('market');
  }
};
H.listAuction = (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  sheet('Аукціон', `${carRow(c)}<div class="small muted mt">Оцінка: ${S.fmt(c.value)} · крок ставки 5% · комісія ${S.FEE * 100}%</div>
    <input id="start" class="mt" inputmode="numeric" value="${Math.round(c.value * 0.5)}">
    <div class="seg mt" id="hours">${[1, 6, 24].map((h) => `<button data-h="${h}" class="${h === 6 ? 'on' : ''}" data-act="pickHours">${h} год</button>`).join('')}</div>
    <button class="btn" data-act="doAuction" data-id="${c.id}">Запустити</button>`, () => H.carSellMenu(d));
};
H.pickHours = (d, el) => el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
H.doAuction = async (d) => {
  if (await act('auction/create', { carId: Number(d.id), startPrice: num($('#start').value), hours: Number($('#hours .on').dataset.h) }, 'Аукціон запущено', { rerender: false })) {
    closeModal();
    state.marketTab = 'auction';
    go('market');
  }
};

// ---------- car cases ----------
function weightedModel(cs) {
  const e = Object.entries(cs.weights);
  let x = Math.random() * e.reduce((s, [, w]) => s + w, 0);
  let cls = e[0][0];
  for (const [c, w] of e) if ((x -= w) < 0) {
    cls = c;
    break;
  }
  // Show the reel a bit "richer" than the real odds so rare cars flash by.
  if (Math.random() < 0.3 && e[1]) cls = e[Math.min(e.length - 1, 1 + Math.floor(Math.random() * 2))][0];
  const list = cs.pool(cls);
  return list[Math.floor(Math.random() * list.length)].id;
}
// Dropped cars can be sold right from the result, so junk doesn't clog the garage.
const sellPrice = (model) => S.sellPriceOf(model);
const sellTotal = (models) => models.reduce((s, m) => s + S.sellPriceOf(m), 0);
const dropAlive = (r) => !r.sold && me.cars.some((c) => c.id === r.car.id && c.status === 'garage');
const reelCard = (model) => `<div class="car r${S.rankOf(M(model).cls)}" style="--c:${S.CLASSES[M(model).cls].color}">${clsBadge(M(model).cls, 'tl')}<div class="art">${carArt(model)}</div><div class="nm tiny ellipsis">${esc(M(model).name)}</div><div class="price tiny" style="color:${S.CLASSES[M(model).cls].color}">${S.short(M(model).price)}</div></div>`;
TABS.cases = () => {
  const cs = S.CASE_BY_ID[state.caseId];
  const keys = me.keys[cs.id] || 0;
  if (cs.starter && !keys) state.caseId = 'rust';
  const n = cs.starter ? 1 : state.count;
  const dayCase = cs.id === me.caseOfDay;
  const price = dayCase ? dayPrice(cs) : cs.price;
  const paid = Math.max(0, n - keys);
  const free = me.slots - me.used;
  const d = state.drop;
  let stage;
  if (d?.length === 1) {
    const { car, isNew, forced } = d[0];
    const m = M(car.model);
    const rank = S.rankOf(m.cls), color = S.CLASSES[m.cls].color;
    const fresh = state.fx?.type === 'case';
    stage = `<div class="reveal-wrap" id="revealWrap"><div class="art ${fresh ? 'reveal' : ''}" id="dropArt">${carArt(car.model, { glow: rank >= 2 })}</div></div>
      <div class="result-name ${fresh ? 'pop' : ''} ${rank >= 3 ? 'shimmer' : ''}" style="--c:${color}">${esc(m.name)}</div>
      <div class="mt ${fresh ? 'pop2' : ''}">${clsBadge(m.cls)} <span class="chip" style="color:${color}">${S.CLASSES[m.cls].name}</span> <span class="chip">${flag(car.model)} ${S.COUNTRIES[m.country].name}</span>${forced ? ' <span class="chip">гарантія</span>' : ''}${d[0].fragment ? ` <span class="chip" style="color:var(--accent)">${ic('key')} +фрагмент</span>` : ''}</div>
      <div class="small muted mt ${fresh ? 'pop2' : ''}">${isNew ? `<span style="color:var(--accent)">${ic('sparkles')} Нова в колекції</span> · ` : ''}Вартість <b id="dropValue">${S.fmt(car.value)}</b>${d[0].sold ? ` · <span class="win">продано за ${S.fmt(sellPrice(car.model))}</span>` : ''}</div>`;
  } else if (d?.length) {
    const fresh = state.fx?.type === 'case';
    stage = `<div class="multi">${d.map((r, i) => {
      const c = S.CLASSES[M(r.car.model).cls].color;
      const sell = dropAlive(r) ? `<button class="dropsell" data-act="sellDrop" data-id="${r.car.id}">${ic('cash')}${S.short(sellPrice(r.car.model))}</button>`
        : r.sold ? '<div class="dropsell done">Продано</div>' : '';
      return `<div class="${fresh ? 'flip-in' : ''} ${S.rankOf(M(r.car.model).cls) >= 1 ? 'rare' : ''} ${r.sold ? 'sold' : ''}" style="--c:${c};animation-delay:${i * 180}ms">${r.sold ? carTile(r.car, { act: 'none' }) : carTile(r.car, { act: 'car', isNew: r.isNew })}${sell}</div>`;
    }).join('')}</div>`;
  } else {
    stage = `<div class="reel-wrap" id="reelWrap"><div class="reel" id="reel">${Array.from({ length: 6 }, () => reelCard(weightedModel(cs))).join('')}</div></div>`;
  }
  const pity = S.pityClasses(cs);
  const guarantee = [[pity.first, S.PITY - (me.pity[cs.id] || 0)], [pity.second, S.PITY2 - (me.pity[cs.id + ':2'] || 0)]]
    .filter(([cls]) => cls).map(([cls, left]) => `${clsBadge(cls)} або краще через ${left}`).join(' · ');
  return `<div class="feed" id="dropFeed"></div>
    <div class="row between"><button class="picker" data-act="casePicker">${caseIcon(cs)} ${esc(cs.name)} ▾</button>${dayCase ? `<span class="chip dayc">${ic('flame')} Кейс дня −${S.CASE_OF_DAY.off * 100}%</span>` : ''}<button class="iconbtn" data-act="odds">i</button></div>
    <div class="stage" id="stage" style="${d?.length > 1 ? 'height:auto;min-height:230px' : ''}">${stage}</div>
    ${cs.starter ? '' : `<div class="seg">${[1, 3, 6].map((k) => `<button class="${k === n ? 'on' : ''}" data-act="pickCount" data-n="${k}">×${k}</button>`).join('')}</div>`}
    ${(() => {
      const short = price * paid - me.balance;
      if (free < n) return '<button class="btn" disabled>Гараж заповнений</button>';
      // Not enough money: say so on the button, with how much is missing.
      if (paid && short > 0) return `<button class="btn" disabled>Недостатньо коштів · бракує ${S.fmt(short)}</button>`;
      return `<button class="btn ${dayCase ? 'yellow' : ''}" data-act="openCase">${paid ? `${d ? 'Відкрити ще' : 'Відкрити'} · ${S.fmt(price * paid)}${dayCase ? ` <s class="muted" style="font-weight:500">${S.short(cs.price * paid)}</s>` : ''}${keys ? ` + ${ic('key')}${Math.min(keys, n)}` : ''}` : cs.starter ? 'Відкрити безкоштовно' : `Відкрити ключем ${ic('key')} ${n}`}</button>`;
    })()}
    ${cs.starter ? '<div class="tiny muted center mt">Подарунок новачку</div>' : ''}
    ${free < n ? '<div class="tiny muted center mt">Продай авто або купи місце в гаражі</div>' : ''}
    ${d ? (() => {
      const alive = d.filter(dropAlive);
      const sum = sellTotal(alive.map((r) => r.car.model));
      const sellBtn = alive.length ? `<button class="btn ghost btn2" data-act="sellDrops"><span>${ic('cash')} ${alive.length > 1 ? 'Продати все' : 'Продати'}</span><small>${S.short(sum)}</small></button>` : '';
      return `<div class="btns mt"><button class="btn outline" data-act="toGarage">У гараж</button>${sellBtn}</div>`;
    })() : ''}
    <div class="card row between mt"><span>Швидке відкриття</span><button class="toggle ${state.fast ? 'on' : ''}" data-act="toggleFast"></button></div>
    ${cs.starter ? '' : (() => {
      const fr = me.fragments?.[cs.id] || 0, need = S.FRAGMENTS_PER_KEY;
      const pity1 = pity.first ? S.PITY - (me.pity[cs.id] || 0) : 0;
      return `<div class="card hooks mt">
        <div class="hook"><div class="row between"><span>${ic('key')} Фрагменти ключа</span><b>${fr}/${need}</b></div><div class="frag-bar"><i style="width:${(fr / need) * 100}%"></i></div><div class="tiny muted">Кожна машина дешевша за кейс дає фрагмент · ${need} фрагментів = безкоштовне відкриття${keys ? ` · у тебе ${ic('key')} ${keys}` : ''}</div></div>
        ${pity.first ? `<div class="hook"><div class="row between"><span>${ic('shield-check')} Гарантія ${clsBadge(pity.first)} або краще</span><b>через ${pity1}</b></div><div class="frag-bar"><i style="width:${((S.PITY - pity1) / S.PITY) * 100}%;background:${S.CLASSES[pity.first].color}"></i></div></div>` : ''}
      </div>`;
    })()}`;
};
H.toGarage = () => {
  state.drop = null;
  state.tab = 'garage';
  render();
};
async function sellDrops(ids) {
  if (!state.drop) return; // a late tap after the drop screen was left
  const list = state.drop.filter((r) => ids.includes(r.car.id));
  if (await act('sell', { carIds: ids }, (r) => `Продано: +${S.fmt(r.got)}`, { rerender: false })) {
    list.forEach((r) => (r.sold = true));
    render();
  }
}
// Two-tap guard: the first tap arms the button, a second tap within 3 s does the action.
function armed(el, label) {
  if (el.dataset.armed) return true;
  const old = el.innerHTML;
  el.dataset.armed = '1';
  el.classList.add('armed');
  el.innerHTML = label;
  haptic('warning');
  setTimeout(() => {
    if (!el.isConnected) return;
    delete el.dataset.armed;
    el.classList.remove('armed');
    el.innerHTML = old;
  }, 3000);
  return false;
}
H.sellDrop = (d, el) => armed(el, 'Точно?') && sellDrops([Number(d.id)]);
H.sellDrops = (d, el) => {
  if (!state.drop) return; // a tap on a stale button after the drop was cleared
  const ids = state.drop.filter(dropAlive).map((r) => r.car.id);
  const sum = sellTotal(state.drop.filter(dropAlive).map((r) => r.car.model));
  if (armed(el, `Точно продати? · ${S.short(sum)}`)) sellDrops(ids);
};
H.pickCount = (d) => (state.count = Number(d.n), render());
H.toggleFast = () => (state.fast = !state.fast, render());
const dayPrice = (cs) => Math.round((cs.price * (1 - S.CASE_OF_DAY.off)) / 1000) * 1000;
H.casePicker = () => {
  const group = (g, title) => {
    const list = S.CASES.filter((c) => c.group === g && (!c.starter || me.keys[c.id]));
    if (!list.length) return '';
    return `<div class="h2"><span>${title}</span></div><div class="list">${list.map((c) => `<button class="li ${c.id === state.caseId ? 'on' : ''}" data-act="pickCase" data-id="${c.id}">
      <span class="ic">${caseIcon(c)}</span><div class="grow"><b>${esc(c.name)}${c.id === me.caseOfDay ? ` <span class="chip dayc">${ic('flame')} −${S.CASE_OF_DAY.off * 100}%</span>` : ''}</b>${dots(c.weights)}</div><div class="center"><b>${c.starter ? 'Безкоштовно' : c.id === me.caseOfDay ? `<span style="color:var(--accent)">${S.short(dayPrice(c))}</span>` : S.short(c.price)}</b>${me.keys[c.id] && !c.starter ? `<div class="tiny win">${ic('key')} ${me.keys[c.id]}</div>` : ''}</div></button>`).join('')}</div>`;
  };
  sheet('Вибір кейсу', group('gift', 'Подарунок новачку') + group('rarity', 'За рідкістю') + group('country', 'За країнами'));
};
H.pickCase = (d) => {
  state.caseId = d.id;
  state.drop = null;
  closeModal();
  render();
};
H.odds = () => {
  const cs = S.CASE_BY_ID[state.caseId];
  const owned = new Set(me.collection);
  const total = Object.values(cs.weights).reduce((a, b) => a + b, 0);
  sheet('Що всередині', `<div class="row"><span style="font-size:24px">${caseIcon(cs)}</span><b>${esc(cs.name)}</b></div>
    <div class="small muted mt">Спочатку випадає клас, потім машина. Чим дорожча машина, тим рідше вона випадає. Вказано мінімальні шанси — з удачею випадає й краще. ✓ — уже є в колекції.</div>
    ${Object.keys(cs.weights).map((cls) => {
      const list = cs.pool(cls);
      const w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
      const p = (cs.weights[cls] / total) * 100;
      return `<div class="h2"><span>${clsBadge(cls)} ${S.CLASSES[cls].name}</span><span>${pct(p)}</span></div>
        <div class="grid">${list.map((m, i) => `<div class="car" style="min-height:0;--c:${S.CLASSES[cls].color}">${owned.has(m.id) ? '<span class="tr win">✓</span>' : ''}<div class="art" style="height:54px">${carArt(m.id)}</div><div class="nm tiny">${esc(m.name)}</div><div class="meta">${pct((p * w[i]) / sw)} · ${S.short(m.price)}</div></div>`).join('')}</div>`;
    }).join('')}`);
};
H.openCase = async (d, el) => {
  if (state.opening) return;
  const cs = S.CASE_BY_ID[state.caseId];
  const n = cs.starter ? 1 : state.count;
  state.opening = true;
  el.disabled = true;
  let r;
  try {
    r = await api('case/open', { caseId: cs.id, count: n });
  } catch (e) {
    state.opening = false;
    el.disabled = false;
    haptic('error');
    return toast(e.message, true);
  }
  if (!state.fast) {
    state.drop = null;
    if (r.results.length === 1) {
      $('#stage').innerHTML = `<div class="reel-wrap" id="reelWrap"><div class="reel" id="reel"></div></div>`;
      await spin(cs, r.results[0].car.model);
    } else {
      // ×3 / ×6: one small reel per case, spinning together and stopping one after another.
      await spinMany($('#stage'), r.results.length, (i, wrap, reel, extra, quiet) => spin(cs, r.results[i].car.model, { wrap, reel, extra, quiet }));
    }
  }
  state.opening = false;
  state.drop = r.results;
  state.fx = { type: 'case' };
  if (cs.starter) state.caseId = 'rust';
  if (r.newKeys) setTimeout(() => toast(`${ic('key')} Фрагменти зібрано — безкоштовний кейс «${cs.name}»!`), 1200);
  await refresh();
};
// Celebrate the drop once it is on screen; the show scales with the best class.
// The feed of everyone's rare drops scrolls above the case; refreshed on every render of the tab (cheap query).
let feedCache = { at: 0, list: [] };
async function paintFeed() {
  const el = $('#dropFeed');
  if (!el) return;
  if (Date.now() - feedCache.at > 20e3) {
    try {
      feedCache = { at: Date.now(), list: (await api('feed')).list };
    } catch {}
  }
  const list = feedCache.list;
  if (!$('#dropFeed')) return;
  if (!list.length) return (el.hidden = true);
  el.hidden = false;
  const item = (f) => `<span class="fi" style="--c:${S.CLASSES[f.cls].color}"><b>${esc(f.name)}</b> вибив ${clsBadge(f.cls)} <span class="fm">${esc(M(f.model)?.name || f.model)}</span> <span class="muted">· ${esc(S.CASE_BY_ID[f.caseId]?.name || '')}</span></span>`;
  el.innerHTML = `<div class="feed-track">${list.map(item).join('')}${list.map(item).join('')}</div>`;
}
AFTER.cases = () => {
  paintFeed();
  if (state.fx?.type !== 'case' || !state.drop) return;
  state.fx = null;
  const best = state.drop.reduce((a, r) => Math.max(a, S.rankOf(M(r.car.model).cls)), 0);
  const color = S.CLASS_ORDER.map((c) => S.CLASSES[c].color)[best];
  haptic(best >= 3 ? 'heavy' : best >= 1 ? 'medium' : 'success');
  if (state.drop.length === 1) {
    const car = state.drop[0].car;
    setTimeout(() => FX.reveal(best, color, { host: $('#revealWrap'), target: $('#dropArt') }), 150);
    FX.countUp($('#dropValue'), car.value, 900, S.fmt);
  } else {
    // Cards flip in one by one with a few sparkles in their colour.
    state.drop.forEach((r, i) => {
      const rank = S.rankOf(M(r.car.model).cls);
      setTimeout(() => {
        const el = document.querySelectorAll('.multi > div')[i];
        if (!el) return;
        FX.sparkle(el, [S.CLASSES[M(r.car.model).cls].color, '#fff'], 3 + rank * 2);
        haptic(rank >= 2 ? 'medium' : 'light');
      }, i * 180 + 300);
    });
  }
};
function spin(cs, winner, reelOpts = {}) {
  const pool = Object.keys(cs.weights);
  const loss = M(winner).price < cs.price;
  // Near-miss tease (visual only, the drop is already decided): a rarer car sits right next to the winner; on a
  // losing drop it is the case's top class and the reel leans towards it, so it stops "almost" on the jackpot.
  const side = Math.random() < 0.5 ? -1 : 1;
  const tease = (i, W) => {
    if (Math.abs(i - W) !== 1 || pool.length < 2 || (!loss && Math.random() < 0.4)) return weightedModel(cs);
    const cls = loss && i - W === side ? pool[pool.length - 1] : pool[Math.min(pool.length - 1, Math.max(1, pool.indexOf(M(winner).cls) + 1))];
    const list = cs.pool(cls);
    return list[Math.floor(Math.random() * list.length)].id;
  };
  return spinReel({ cardAt: (i, W) => reelCard(i === W ? winner : tease(i, W)), color: S.CLASSES[M(winner).cls].color, rank: S.rankOf(M(winner).cls), lean: loss ? side : 0, ...reelOpts });
}
// The horizontal case reel shared by car and part cases: cardAt(i, W) builds card i, W is the winner's index.
// wrap/reel default to the single big reel; several small reels (×3/×6) pass their own, each a bit longer (`extra`)
// so they stop one after another, and all but the first stay `quiet` (no haptics, no flash).
function spinReel({ cardAt, color, rank, lean = 0, wrap = $('#reelWrap'), reel = $('#reel'), extra = 0, quiet = false }) {
  return new Promise((resolve) => {
    if (!reel) return resolve();
    const N = 46, W = 34;
    reel.innerHTML = Array.from({ length: N }, (_, i) => cardAt(i, W)).join('');
    const card = reel.children[1].offsetLeft - reel.children[0].offsetLeft; // card width + gap, big or mini reel
    const cardW = reel.children[0].offsetWidth;
    const target = W * card + cardW / 2 - wrap.clientWidth / 2 + (lean ? lean * (0.3 + Math.random() * 0.12) : (Math.random() - 0.5) * 0.6) * cardW;
    const dur = (rank >= 2 ? 6000 : 5000) + extra; // rare drops spin a little longer for suspense
    let last = -1;
    wrap.classList.add('spinning');
    const tick = () => {
      const x = -new DOMMatrix(getComputedStyle(reel).transform).m41;
      const idx = Math.floor((x + wrap.clientWidth / 2) / card);
      if (idx !== last) {
        last = idx;
        if (!quiet) haptic('soft');
        reel.children[idx]?.animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 160 });
      }
      if (state.opening) requestAnimationFrame(tick);
    };
    requestAnimationFrame(() => {
      reel.style.transition = `transform ${dur}ms cubic-bezier(.08,.75,.12,1)`;
      reel.style.transform = `translateX(${-target}px)`;
      requestAnimationFrame(tick);
    });
    setTimeout(() => wrap.classList.replace('spinning', 'slowing'), dur * 0.55);
    setTimeout(() => {
      const w = reel.children[W];
      w.style.setProperty('--c', color);
      w.classList.add('winner');
      haptic(rank >= 2 ? 'heavy' : quiet ? 'light' : 'medium');
      if (rank >= 4 && !quiet) FX.flash(color, 0.12, 400);
    }, dur + 100);
    setTimeout(resolve, dur + 800);
  });
}
// Builds one small reel per result in `host` and spins them together; spinOne(i, wrap, reel, extra, quiet) starts reel i.
function spinMany(host, n, spinOne) {
  host.style.height = 'auto';
  host.innerHTML = Array.from({ length: n }, (_, i) => `<div class="reel-wrap mini" id="reelWrap${i}"><div class="reel" id="reel${i}"></div></div>`).join('');
  return Promise.all(Array.from({ length: n }, (_, i) => spinOne(i, $(`#reelWrap${i}`), $(`#reel${i}`), i * 350, i > 0)));
}

// ---------- racing ----------
TABS.race = async () => {
  if (state.race && state.race.phase !== 'idle') return raceScreen();
  if (state.drift) return driftScreen();
  const seg = `<div class="seg">${[['race', 'Драг-заїзд'], ['drift', 'Дрифт'], ['pvp', 'PvP']].map(([k, t]) => `<button class="${state.raceView === k ? 'on' : ''}" data-act="raceView" data-k="${k}">${t}</button>`).join('')}</div>`;
  const garage = me.cars.filter((c) => c.status === 'garage');
  if (!garage.length) return seg + '<div class="empty">Потрібна хоча б одна машина в гаражі</div>';
  if (!garage.some((c) => c.id === state.raceCar)) state.raceCar = [...garage].sort((a, b) => b.tank - a.tank || a.et - b.et)[0].id;
  const car = garage.find((c) => c.id === state.raceCar);
  if (state.raceView === 'pvp') return seg + await pvpView(car);
  if (state.raceView === 'drift') return seg + await driftView(car, garage);
  const { list } = await api('race/rivals', { carId: car.id });
  const cls = M(car.model).cls;
  return seg + `<div class="h2"><span>Твоя машина</span><span>${garage.length}</span></div>
    <div class="carpick">${garage.map((c) => carTile(c, { act: 'pickRaceCar', sel: c.id === car.id, showTank: true })).join('')}</div>
    <div class="card mt"><div class="row between"><b class="disp" style="font-size:16px">${ic('gas-station')} ПАЛЬНЕ ${me.fuel}/${S.FUEL_MAX}</b><span class="small muted">${me.fuelNext ? `+1 через <span data-until="${me.fuelNext - clockOffset}"></span>` : 'бак повний'}</span></div>
      <div class="progress gold mt"><i style="width:${(me.fuel / S.FUEL_MAX) * 100}%"></i></div>
      <div class="row between small mt"><span>Бак ${esc(M(car.model).name)}: <b>${car.tank}/${S.CAR_TANK}</b></span><span class="muted">${car.tankNext ? `+1 через <span data-until="${car.tankNext - clockOffset}"></span>` : 'повний'}</span></div>
      <div class="tiny muted mt">Загальний бак — на всі машини, і в кожної машини свій бак на ${S.CAR_TANK} гонок · ${car.hp} к.с. · ${car.et.toFixed(2)} с на 402 м</div></div>
    <div class="h2"><span>Суперники · клас ${cls}</span><span>дрег 402 м</span></div>
    <div class="list">${list.map((r) => `<button class="rival" data-act="startRace" data-rival="${r.id}">
      <div class="mini art">${carArt(r.model)}</div>
      <div class="grow"><b class="ellipsis">${esc(r.name)}</b><div class="small muted ellipsis">${esc(M(r.model).name)} · ${r.hp} к.с.</div>
        <div class="row mt" style="gap:6px"><span class="diff ${r.id}">${r.label}</span><span class="chip">шанс ${r.chance < 1 ? '<1' : r.chance}%</span></div></div>
      <div class="center"><b class="win">+${S.short(r.prize)}</b><div class="tiny muted">внесок ${S.short(r.entry)}</div></div></button>`).join('')}</div>
    <div class="tiny muted">Тисни на суперника, щоб почати. На світлофорі жми «ГАЗ» рівно на зелений: ідеальний старт дає +4% потужності, фальстарт — −8%. Під час заїзду перемикай передачі, коли стрілка в зеленій зоні. Програв — внесок згоряє.</div>`;
};
H.raceView = (d) => (state.raceView = d.k, render());
H.pickRaceCar = (d) => (state.raceCar = Number(d.id), render());

H.startRace = async (d) => {
  let r;
  try {
    r = await api('race/start', { carId: state.raceCar, rival: d.rival });
  } catch (e) {
    return toast(e.message, true);
  }
  me.fuel--;
  renderHeader();
  state.race = { phase: 'lights', id: r.raceId, car: r.car, rival: r.rival, reaction: null, shifts: [], gear: 1, result: null };
  await render();
  runRace();
};
function raceScreen() {
  const R = state.race;
  if (R.phase === 'done') return raceResult();
  const rm = M(R.rival.model);
  return `<div class="racebox">
    <div class="row between small muted"><span>ЧАС</span><span>РОЗРИВ</span></div>
    <div class="row between"><b style="font-size:22px" id="rTimer">0,000</b><b id="rGap">—</b></div>
    <div class="lane"><div class="mini art">${carArt(R.car.model)}</div><span class="who">Ти</span><span class="hp">${R.car.hp} к.с.</span><div class="bar"><i id="pBar"></i></div></div>
    <div class="lane rv"><div class="mini art">${carArt(R.rival.model)}</div><span class="who">${esc(R.rival.name)} <span class="tiny muted">${esc(rm.name)}</span></span><span class="hp">${R.rival.hp} к.с.</span><div class="bar"><i id="rBar"></i></div></div>
    <div class="marks"><span>0 м</span><span>201 м</span><span>402 м</span></div></div>
  <div class="tree" id="tree"><i></i><i></i><i></i><i></i></div>
  <div class="dash"><div class="speed"><span id="rSpeed">0</span><small> км/год</small></div><div class="tacho"><div class="zone"></div><div class="redz"></div><div class="needle" id="needle"></div></div><div class="gear"><span id="rGear">N</span><small>передача</small></div></div>
  <div class="center small muted mt" id="rHint">Жми «ГАЗ», коли загориться зелений</div>
  <div style="position:relative"><button class="btn racebtn gas mt" id="raceBtn">ГАЗ!</button></div>
  <div class="row mt" id="rShifts" style="justify-content:center;gap:6px"></div>`;
}
const QLABEL = { perfect: 'Ідеально', good: 'Добре', early: 'Рано', late: 'Пізно', miss: 'Пропуск' };
function flashText(text, color) {
  const el = document.createElement('div');
  el.className = 'flash';
  el.style.color = color;
  el.textContent = text;
  $('#raceBtn')?.parentElement.appendChild(el);
  setTimeout(() => el.remove(), 800);
}
// Solo race against a bot, or a live PvP race (R.live): then the lights follow the server's shared start time, the
// rival's bar follows the other player's real progress, and the result comes once both have finished.
function runRace() {
  const R = state.race;
  const K = 2.3; // playback speed
  const lights = [...document.querySelectorAll('#tree i')];
  const btn = $('#raceBtn');
  const sinceStart = R.live ? serverNow() - R.live.startAt : 0;
  const greenAt = R.live ? R.live.greenAt - R.live.startAt - sinceStart : 1800 + 400 + Math.random() * 1200;
  let green = 0, runStart = 0, raf = 0;
  const lbs = R.car.kg * 2.2046;
  const vmax = 1.609 * 234 * Math.cbrt(R.car.hp / lbs);
  const timers = [600, 1200, 1800].map((ms, i) => setTimeout(() => (lights[i].className = 'amber', haptic('light')), Math.max(0, ms - sinceStart)));
  if (R.live) {
    // Send my progress and read the rival's ~3 times a second until the race is settled.
    R.myD = 0;
    R.rivalD = 0;
    R.poll = setInterval(async () => {
      if (state.race !== R) return clearInterval(R.poll);
      try {
        const s = await api('pvp/progress', { id: R.live.id, u: R.myD });
        R.rivalD = s.rival.u;
        if (s.status === 'done') settleLive(s);
      } catch {}
    }, 330);
  }
  timers.push(setTimeout(() => {
    lights.forEach((l) => (l.className = ''));
    lights[3].className = 'green';
    green = performance.now();
    haptic('medium');
  }, greenAt));
  timers.push(setTimeout(() => !runStart && launch(1.5), greenAt + 1500));
  let segStart = 0;
  const projected = () => S.raceTime(R.car, R.reaction, [...R.shifts, ...Array(S.SHIFTS - R.shifts.length).fill('good')]);
  function launch(reaction) {
    timers.forEach(clearTimeout);
    R.reaction = reaction;
    R.phase = 'run';
    runStart = performance.now();
    if (reaction < 0) {
      lights.forEach((l) => (l.className = 'red'));
      flashText('ФАЛЬСТАРТ −8%', '#f87171');
      haptic('error');
    } else if (reaction <= S.START.perfectWindow) {
      flashText('ІДЕАЛЬНИЙ СТАРТ +4%', '#4ade80');
      haptic('success');
    } else if (reaction >= 1.5) flashText('ПІЗНІЙ СТАРТ', '#fbbf24');
    else flashText(`Реакція ${reaction.toFixed(3)}`, '#eceef2');
    btn.className = 'btn racebtn shift mt';
    btn.textContent = 'ПЕРЕДАЧА';
    R.gear = 1;
    $('#rHint').textContent = 'Перемикай, коли стрілка в зеленій зоні';
    raf = requestAnimationFrame(frame);
  }
  function rpmAt(u) {
    const ideal = S.SHIFT_POINTS[R.shifts.length];
    if (ideal == null) return 0.5 + 0.4 * Math.min(1, (u - segStart) / Math.max(0.05, 1 - segStart));
    return 0.3 + 0.58 * ((u - segStart) / Math.max(0.03, ideal - segStart));
  }
  function doShift(q, u) {
    R.shifts.push(q);
    segStart = u;
    R.gear++;
    $('#rShifts').insertAdjacentHTML('beforeend', `<span class="qchip q-${q}">${QLABEL[q]}</span>`);
    flashText(QLABEL[q], q === 'perfect' ? '#4ade80' : q === 'good' ? '#eceef2' : '#fbbf24');
    haptic(q === 'perfect' ? 'success' : q === 'good' ? 'light' : 'warning');
  }
  let curU = 0;
  btn.addEventListener('pointerdown', () => {
    if (R.phase === 'lights') {
      launch(green ? (performance.now() - green) / 1000 : -1);
      return;
    }
    if (R.phase !== 'run' || R.shifts.length >= S.SHIFTS) return;
    const r = rpmAt(curU);
    doShift(r < 0.7 ? 'early' : r < 0.82 ? 'good' : r <= 0.94 ? 'perfect' : 'good', curU);
  });
  let shownRivalD = 0;
  function frame() {
    const tau = ((performance.now() - runStart) / 1000) * K;
    const react = R.reaction < 0 ? 0.25 : R.reaction;
    const T = projected();
    const drive = Math.max(0.5, T - react);
    const u = Math.max(0, Math.min(1, (tau - react) / drive));
    curU = u;
    if (R.shifts.length < S.SHIFTS && rpmAt(u) >= 1.02) doShift('late', u);
    const pd = Math.pow(u, 1.6);
    let ru, rd;
    if (R.live) {
      // The rival's real progress arrives a few times a second; glide towards it so the bar doesn't jump.
      R.myD = pd;
      shownRivalD += (R.rivalD - shownRivalD) * 0.18;
      rd = shownRivalD;
      ru = 1; // my own finish ends the animation; the result waits for the rival
    } else {
      const rReact = 0.25;
      ru = Math.max(0, Math.min(1, (tau - rReact) / (R.rival.time - rReact)));
      rd = Math.pow(ru, 1.6);
    }
    $('#pBar').style.width = pd * 100 + '%';
    $('#rBar').style.width = rd * 100 + '%';
    $('#rTimer').textContent = Math.min(tau, R.live ? T : Math.max(T, R.rival.time)).toFixed(3).replace('.', ',');
    const gap = Math.round((pd - rd) * 402);
    $('#rGap').textContent = u >= 1 && ru >= 1 ? '—' : (gap > 0 ? '+' : '') + gap + ' м';
    $('#rGap').className = gap >= 0 ? 'win' : 'lose';
    $('#rSpeed').textContent = Math.round(vmax * Math.pow(u, 0.62) * (0.92 + 0.08 * Math.min(1, rpmAt(u))));
    $('#rGear').textContent = u > 0 ? Math.min(R.gear, S.SHIFTS + 1) : 1;
    const rpm = Math.max(0, Math.min(1, u > 0 ? rpmAt(u) : 0.2));
    $('#needle').style.width = rpm * 100 + '%';
    if (u >= 1 && ru >= 1) return finish();
    raf = requestAnimationFrame(frame);
  }
  async function finish() {
    cancelAnimationFrame(raf);
    while (R.shifts.length < S.SHIFTS) R.shifts.push('late');
    if (R.live) return finishLive();
    try {
      R.result = await api('race/finish', { raceId: R.id, reaction: R.reaction, shifts: R.shifts });
    } catch (e) {
      toast(e.message, true);
      state.race = null;
      return render();
    }
    R.phase = 'done';
    haptic(R.result.win ? 'success' : 'error');
    await refresh();
  }
  // Live: send my run, then keep the rival's bar moving until they finish too (the progress poll settles it).
  async function finishLive() {
    R.myD = 1;
    R.phase = 'wait';
    $('#rHint').textContent = `Фініш! Чекаємо на ${R.rival.name}…`;
    btn.disabled = true;
    try {
      const s = await api('pvp/finish', { id: R.live.id, reaction: R.reaction, shifts: R.shifts });
      if (s.status === 'done') return settleLive(s);
    } catch (e) {
      toast(e.message, true);
    }
    const glide = () => {
      if (state.race !== R || R.phase !== 'wait') return;
      shownRivalD += (R.rivalD - shownRivalD) * 0.18;
      $('#rBar').style.width = shownRivalD * 100 + '%';
      requestAnimationFrame(glide);
    };
    glide();
  }
}
// Both runs are in: show the live result (once, whichever poll sees it first).
async function settleLive(s) {
  const R = state.race;
  if (!R?.live || R.phase === 'done' || R.live.id !== s.id) return;
  clearInterval(R.poll);
  R.phase = 'done';
  R.result = s;
  haptic(s.win ? 'success' : 'error');
  if (s.win) FX.flash('#4ade80', 0.25, 500);
  await refresh();
}
function liveResult() {
  const R = state.race, s = R.result, my = s.me.run, rv = s.rival.run;
  const t = (x) => x.time.toFixed(3).replace('.', ',');
  const startTxt = (x) => (x.jump ? 'фальстарт' : x.perfectStart ? 'ідеальний старт' : `реакція ${x.reaction.toFixed(3)} с`);
  const row = (who, car, run, won) => `<div class="li"><div class="mini art">${carArt(car.model)}</div><div class="grow"><b>${esc(who)} ${won ? ic('trophy', 'win') : ''}</b><div class="small muted">${esc(M(car.model).name)} · ${startTxt(run)}</div></div><b>${t(run)} с</b></div>`;
  return `<div class="center mt2"><div class="tiny muted">PvP наживо</div><div class="big ${s.win ? 'win' : 'lose'}">${s.win ? 'Перемога!' : 'Поразка'}</div>
    <div class="muted">${s.win ? 'швидше' : 'повільніше'} на ${Math.abs(my.time - rv.time).toFixed(3).replace('.', ',')} с</div>
    <div style="font-size:26px;font-weight:900" class="mt ${s.win ? 'win' : 'lose'}">${s.win ? '+' + S.fmt(s.prize) : '−' + S.fmt(s.bet)}</div>
    <div class="tiny muted">${s.win ? `банк мінус ${S.FEE * 100}% комісії` : 'ставка пішла суперникові'}</div></div>
    <div class="list mt">${row('Ти', s.me.car, my, s.win)}${row(s.rival.name, s.rival.car, rv, !s.win)}</div>
    <div class="card"><div class="small muted">Твої перемикання</div><div class="row wrap mt" style="gap:6px">${my.shifts.map((q, i) => `<span class="qchip q-${q}">${i + 1}→${i + 2}: ${QLABEL[q]}</span>`).join('')}</div></div>
    <button class="btn outline" data-act="pvpExit">До PvP</button>`;
}
H.pvpExit = () => {
  state.race = null;
  state.raceView = 'pvp';
  render();
};
function raceResult() {
  if (state.race.live) return liveResult();
  const R = state.race, r = R.result;
  const startTxt = r.jump ? 'Фальстарт −8%' : r.perfectStart ? 'Ідеальний старт +4%' : r.reaction >= 1.5 ? 'Пізній старт' : `Реакція ${r.reaction.toFixed(3)} с`;
  return `<div class="center mt2"><div class="big ${r.win ? 'win' : 'lose'}">${r.win ? 'Перемога!' : 'Поразка'}</div>
    <div class="muted">${r.win ? 'швидше' : 'повільніше'} на ${r.diff.toFixed(3).replace('.', ',')} с</div>
    <div style="font-size:26px;font-weight:900" class="mt ${r.win ? 'win' : 'lose'}">${r.win ? '+' + S.fmt(r.prize) : '−' + S.fmt(r.entry)}</div>
    <div class="tiny muted">${r.win ? `приз · внесок ${S.short(r.entry)} повернувся` : 'внесок згорів'}</div></div>
    <div class="list mt">
      <div class="li"><div class="mini art">${carArt(R.car.model)}</div><div class="grow"><b>Ти ${r.win ? ic('trophy', 'win') : ''}</b><div class="small muted">${esc(M(R.car.model).name)}</div></div><b>${r.time.toFixed(3).replace('.', ',')} с</b></div>
      <div class="li"><div class="mini art">${carArt(R.rival.model)}</div><div class="grow"><b>${esc(R.rival.name)} ${r.win ? '' : ic('trophy', 'win')}</b><div class="small muted">${esc(M(R.rival.model).name)}</div></div><b>${r.rivalTime.toFixed(3).replace('.', ',')} с</b></div></div>
    <div class="card"><div class="small muted">${startTxt}</div><div class="row wrap mt" style="gap:6px">${r.shifts.map((q, i) => `<span class="qchip q-${q}">${i + 1}→${i + 2}: ${QLABEL[q]}</span>`).join('')}</div></div>
    <button class="btn yellow" data-act="raceAgain" ${me.fuel < 1 ? 'disabled' : ''}>Ще гонка · пальне ${me.fuel}/${S.FUEL_MAX}</button>
    <button class="btn outline mt" data-act="raceExit">До суперників</button>`;
}
// ---------- drift ----------
async function driftView(car, garage) {
  const { list, model } = await api('drift/rivals', { carId: car.id });
  const zone = Math.round(model.zone[1] - model.zone[0]);
  return `<div class="h2"><span>Твоя машина</span><span>${garage.length}</span></div>
    <div class="carpick">${garage.map((c) => carTile(c, { act: 'pickRaceCar', sel: c.id === car.id, showTank: true })).join('')}</div>
    <div class="card mt"><div class="row between"><b class="disp" style="font-size:16px">${ic('gas-station')} ПАЛЬНЕ ${me.fuel}/${S.FUEL_MAX}</b><span class="small muted">бак машини ${car.tank}/${S.CAR_TANK}</span></div>
      <div class="row mt" style="gap:8px;flex-wrap:wrap"><span class="chip">зелена зона ${zone}°</span><span class="chip">занос ${model.turn}°/с</span><span class="chip">вирівнювання ${model.recover}°/с</span></div>
      <div class="tiny muted mt">Ширша зелена зона — легше тримати занос (підвіска й диски). Більше потужності — різкіший занос.</div></div>
    <div class="h2"><span>Суперники в дрифті</span><span>${S.DRIFT.corners} поворотів</span></div>
    <div class="list">${list.map((r) => `<button class="rival" data-act="startDrift" data-rival="${r.id}">
      <div class="mini art">${carArt(r.model)}</div>
      <div class="grow"><b class="ellipsis">${esc(r.name)}</b><div class="small muted ellipsis">${esc(M(r.model).name)}</div>
        <div class="row mt" style="gap:6px"><span class="diff ${r.id}">${r.label}</span><span class="chip">ціль ${S.fmt(r.target).replace(' ₴', '')} очок</span></div></div>
      <div class="center"><b class="win">+${S.short(r.prize)}</b><div class="tiny muted">внесок ${S.short(r.entry)}</div></div></button>`).join('')}</div>
    <div class="tiny muted">Тримай «ГАЗ» — машину заносить сильніше, відпусти — вирівнюється. Тримай стрілку в зеленій зоні: там капають очки, а в самому центрі — у 1,5 раза швидше. За червоною лінією — розворот і комбо згорає. Чистий поворот піднімає комбо до ×${S.DRIFT.comboMax}. Набери більше очок, ніж суперник.</div>`;
}
H.startDrift = async (d) => {
  let r;
  try {
    r = await api('drift/start', { carId: state.raceCar, rival: d.rival });
  } catch (e) {
    return toast(e.message, true);
  }
  me.fuel--;
  renderHeader();
  state.drift = { phase: 'count', ...r, score: 0, combo: 1, clean: 0, spins: 0, result: null };
  await render();
  runDrift();
};
function driftScreen() {
  const D = state.drift;
  if (D.phase === 'done') return driftResult();
  const m = D.model, pct = (a) => `${(a / 90) * 100}%`;
  return `<div class="drift">
    <div class="dhud"><div><small>ОЧКИ</small><b id="dScore">0</b></div><div class="center"><small>КОМБО</small><b id="dCombo">×1</b></div><div style="text-align:right"><small>${esc(D.rival.name)}</small><b>${S.fmt(D.rival.target).replace(' ₴', '')}</b></div></div>
    <div class="progress gold"><i id="dBar"></i></div>
    <div class="dtrack" id="dTrack"><canvas id="dCanvas"></canvas>
      <div class="dsign" id="dSign">ГОТУЙСЯ</div><div class="dmsg" id="dMsg"></div></div>
    <div class="dgauge"><span class="dz" style="left:${pct(m.zone[0])};width:${pct(m.zone[1] - m.zone[0])}"></span><span class="di" style="left:${pct(m.ideal[0])};width:${pct(m.ideal[1] - m.ideal[0])}"></span>
      <span class="dr" style="left:${pct(m.spin)}"></span><i id="dNeedle"></i></div>
    <div class="row between tiny muted mt"><span>0°</span><span id="dAngle">кут 0°</span><span>90°</span></div>
    <div class="center small muted mt" id="dHint">Тримай «ГАЗ», щоб увійти в занос</div>
    <button class="btn racebtn gas mt" id="dGas">ГАЗ</button></div>`;
}
// Top-down drift scene on a canvas: a winding road (90° corners alternating sides, with kerbs), the car sliding
// through them at the drift angle, black tyre marks and smoke; the camera follows and turns with the car.
function driftScene(canvas, color) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const v = 150, STEP = 4; // px per second along the road, px between track samples
  const lead = 220, cornerLen = v * (S.DRIFT.cornerMs / 1000), straightLen = v * (S.DRIFT.straightMs / 1000);
  const dirs = Array.from({ length: S.DRIFT.corners }, (_, i) => (i % 2 ? -1 : 1) * (Math.random() < 0.25 ? -1 : 1));
  const segs = [{ len: lead, turn: 0 }];
  dirs.forEach((d, i) => {
    segs.push({ len: cornerLen, turn: d, corner: i });
    if (i < dirs.length - 1) segs.push({ len: straightLen, turn: 0 });
  });
  segs.push({ len: 900, turn: 0 });
  // Sample the centre line: x, y, heading (0 = up), and whether it is a corner.
  const xs = [], ys = [], hs = [], kc = [];
  let x = 0, y = 0, h = 0;
  for (const sg of segs) {
    const n = Math.round(sg.len / STEP), dh = sg.turn ? (sg.turn * Math.PI) / 2 / n : 0;
    for (let i = 0; i < n; i++) {
      xs.push(x); ys.push(y); hs.push(h); kc.push(sg.turn ? sg.turn : 0);
      h += dh;
      x += Math.sin(h) * STEP;
      y -= Math.cos(h) * STEP;
    }
  }
  const at = (s) => Math.max(0, Math.min(xs.length - 1, Math.round(s / STEP)));
  const marks = [], smoke = [];
  let camH = 0, lastRear = null, lastPuff = 0;
  function road(from, to, width, style, dash = null, onlyCorners = false) {
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.setLineDash(dash || []);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let open = false;
    for (let i = from; i <= to; i++) {
      if (onlyCorners && !kc[i]) { open = false; continue; }
      if (!open) { ctx.moveTo(xs[i], ys[i]); open = true; } else ctx.lineTo(xs[i], ys[i]);
    }
    ctx.stroke();
  }
  function car(body) {
    const L = 40, Wd = 20;
    ctx.rotate(body);
    ctx.fillStyle = '#0008';
    ctx.beginPath(); ctx.roundRect(-Wd / 2 + 2, -L / 2 + 3, Wd, L, 6); ctx.fill(); // shadow
    ctx.fillStyle = '#111';
    for (const [wx, wy] of [[-Wd / 2 - 2, -L / 2 + 6], [Wd / 2 - 2, -L / 2 + 6], [-Wd / 2 - 2, L / 2 - 14], [Wd / 2 - 2, L / 2 - 14]]) ctx.fillRect(wx, wy, 4, 9);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(-Wd / 2, -L / 2, Wd, L, 6); ctx.fill();
    ctx.fillStyle = '#0b1220cc';
    ctx.beginPath(); ctx.roundRect(-Wd / 2 + 3, -L / 2 + 9, Wd - 6, 8, 3); ctx.fill(); // windscreen
    ctx.beginPath(); ctx.roundRect(-Wd / 2 + 3, L / 2 - 12, Wd - 6, 6, 3); ctx.fill(); // rear window
    ctx.fillStyle = '#fff7c2';
    ctx.fillRect(-Wd / 2 + 2, -L / 2, 4, 2); ctx.fillRect(Wd / 2 - 6, -L / 2, 4, 2); // headlights
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(-Wd / 2 + 2, L / 2 - 2, 4, 2); ctx.fillRect(Wd / 2 - 6, L / 2 - 2, 4, 2);
  }
  return {
    lead, dirs,
    // s: distance along the road; angle: drift angle in degrees; spin: 0..1 progress of a spin-out.
    draw(s, angle, spin, dt, now) {
      const i = at(s), cx = xs[i], cy = ys[i], heading = hs[i];
      const dir = kc[i] || kc[Math.max(0, i - Math.round(straightLen / STEP))] || 1;
      const body = heading + dir * (angle * Math.PI) / 180 + spin * Math.PI * 2;
      camH += (heading - camH) * Math.min(1, dt * 4);
      // Tyre marks and smoke while the car is sideways.
      const f = [Math.sin(body), -Math.cos(body)], r = [Math.cos(body), Math.sin(body)];
      const rear = [-1, 1].map((k) => [cx - f[0] * 13 + r[0] * 8 * k, cy - f[1] * 13 + r[1] * 8 * k]);
      if (angle > 12 && lastRear) {
        marks.push([lastRear, rear, Math.min(0.55, angle / 70)]);
        if (marks.length > 700) marks.shift();
        if (now - lastPuff > 45) {
          lastPuff = now;
          for (const p of rear) smoke.push({ x: p[0], y: p[1], r: 5, a: Math.min(0.55, angle / 60), vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20 });
          if (smoke.length > 140) smoke.splice(0, smoke.length - 140);
        }
      }
      lastRear = rear;
      for (const p of smoke) { p.r += dt * 34; p.a -= dt * 0.55; p.x += p.vx * dt; p.y += p.vy * dt; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#18241c';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H * 0.64);
      ctx.rotate(-camH);
      ctx.translate(-cx, -cy);
      const from = Math.max(0, i - 90), to = Math.min(xs.length - 1, i + 160);
      road(from, to, 108, '#e5e7eb', null, true); // kerbs on corners: white…
      road(from, to, 108, '#dc2626', [10, 10], true); // …and red
      road(from, to, 94, '#f4f4f5');
      road(from, to, 88, '#34373e');
      road(from, to, 2, '#ffffff88', [14, 14]);
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      for (const [a, b, al] of marks) {
        ctx.strokeStyle = `rgba(8,8,10,${al})`;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(a[0][0], a[0][1]); ctx.lineTo(b[0][0], b[0][1]);
        ctx.moveTo(a[1][0], a[1][1]); ctx.lineTo(b[1][0], b[1][1]);
        ctx.stroke();
      }
      for (const p of smoke) {
        if (p.a <= 0) continue;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `rgba(235,236,240,${p.a})`);
        g.addColorStop(1, 'rgba(235,236,240,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.translate(cx, cy);
      car(body);
      ctx.restore();
    },
  };
}
function runDrift() {
  const D = state.drift, M2 = D.model, C = S.DRIFT.cornerMs, ST = S.DRIFT.straightMs;
  const el = (id) => document.getElementById(id);
  const btn = el('dGas');
  let hold = false, ang = 0, last = 0, t0 = 0, raf = 0, corner = -1, zoneMs = 0, spunHere = false, spinUntil = 0, wasIn = false;
  const seed = Math.random() * 10;
  const scene = driftScene(el('dCanvas'), S.CLASSES[M(D.car.model).cls].color);
  const SPEED = 150; // must match driftScene's road speed
  // While the lights count down the car waits at the end of the lead-in straight.
  let idle = performance.now();
  const wait = (now) => {
    if (state.drift !== D || D.phase !== 'count') return;
    scene.draw(scene.lead - 60, 0, 0, Math.min(0.05, (now - idle) / 1000), now);
    idle = now;
    requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
  const press = (v) => (e) => {
    e.preventDefault();
    hold = v;
    btn.classList.toggle('on', v);
  };
  btn.addEventListener('pointerdown', press(true));
  btn.addEventListener('pointerup', press(false));
  btn.addEventListener('pointercancel', press(false));
  btn.addEventListener('pointerleave', press(false));
  const msg = (text, color) => {
    const m = el('dMsg');
    if (!m) return;
    m.textContent = text;
    m.style.color = color;
    m.classList.remove('pop');
    void m.offsetWidth;
    m.classList.add('pop');
  };
  // 3 · 2 · 1 then go.
  let n = 3;
  el('dSign').textContent = n;
  const count = setInterval(() => {
    n--;
    haptic('light');
    if (n > 0) return (el('dSign').textContent = n);
    clearInterval(count);
    el('dSign').textContent = 'ПОЇХАЛИ!';
    D.phase = 'run';
    t0 = last = performance.now();
    raf = requestAnimationFrame(frame);
  }, 700);
  function endCorner() {
    const clean = !spunHere && zoneMs >= C * S.DRIFT.clean;
    if (clean) {
      D.clean++;
      D.combo = Math.min(S.DRIFT.comboMax, D.combo + 1);
      msg(`ЧИСТО! ×${D.combo}`, '#4ade80');
      haptic('success');
    } else if (!spunHere) {
      D.combo = 1;
      msg('Слабкий занос', '#fbbf24');
    }
  }
  function frame(now) {
    if (state.drift !== D) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now - t0;
    if (t >= S.DRIFT_MS) return finish();
    const i = Math.floor(t / (C + ST)), inCorner = t - i * (C + ST) < C;
    if (inCorner && i !== corner) {
      corner = i;
      zoneMs = 0;
      spunHere = false;
      el('dSign').textContent = `${scene.dirs[i] > 0 ? '↱' : '↰'} ПОВОРОТ ${i + 1}/${S.DRIFT.corners}`;
    }
    if (!inCorner && el('dSign').dataset.k !== 's' + i) {
      el('dSign').dataset.k = 's' + i;
      if (corner === i) endCorner();
      el('dSign').textContent = 'ПРЯМА';
    }
    if (inCorner && now > spinUntil) {
      ang += (hold ? M2.turn : -M2.recover) * dt;
      ang += (Math.sin(t / 230 + seed) * 22 + (Math.random() - 0.5) * 30) * dt; // the car never sits still
      ang = Math.max(0, ang);
      if (ang >= M2.spin) {
        D.spins++;
        D.combo = 1;
        spunHere = true;
        spinUntil = now + 700;
        ang = 0;
        msg('РОЗВОРОТ!', '#f87171');
        haptic('error');
      }
      const inZone = ang >= M2.zone[0] && ang <= M2.zone[1];
      if (inZone) {
        const ideal = ang >= M2.ideal[0] && ang <= M2.ideal[1];
        D.score += S.DRIFT.pps * D.combo * (ideal ? S.DRIFT.idealBonus : 1) * dt;
        zoneMs += dt * 1000;
        if (!wasIn) haptic('light');
      }
      wasIn = inZone;
    } else if (!inCorner) ang = Math.max(0, ang - M2.recover * 1.5 * dt);
    // The car moves along the road at a steady speed; a spin-out turns it a full circle.
    scene.draw(scene.lead + (SPEED * t) / 1000, ang, now < spinUntil ? 1 - (spinUntil - now) / 700 : 0, dt, now);
    el('dNeedle').style.left = `${(Math.min(90, ang) / 90) * 100}%`;
    el('dAngle').textContent = `кут ${Math.round(ang)}°`;
    el('dScore').textContent = S.fmt(Math.floor(D.score)).replace(' ₴', '');
    el('dCombo').textContent = '×' + D.combo;
    el('dBar').style.width = Math.min(100, (D.score / D.rival.target) * 100) + '%';
    el('dHint').textContent = !inCorner ? 'Пряма — готуйся до повороту' : ang < M2.zone[0] ? 'Більше газу — заносу мало' : ang > M2.zone[1] ? 'Відпусти — зараз розверне!' : 'Тримай занос!';
    raf = requestAnimationFrame(frame);
  }
  async function finish() {
    cancelAnimationFrame(raf);
    if (corner === S.DRIFT.corners - 1) endCorner();
    D.phase = 'wait';
    try {
      D.result = await api('drift/finish', { runId: D.runId, score: Math.floor(D.score), clean: D.clean, spins: D.spins });
    } catch (e) {
      toast(e.message, true);
      state.drift = null;
      return render();
    }
    D.phase = 'done';
    haptic(D.result.win ? 'success' : 'error');
    if (D.result.win) FX.flash('#4ade80', 0.25, 500);
    await refresh();
  }
}
function driftResult() {
  const r = state.drift.result;
  return `<div class="center mt2"><div class="tiny muted">Дрифт</div><div class="big ${r.win ? 'win' : 'lose'}">${r.win ? 'Перемога!' : 'Поразка'}</div>
    <div style="font-size:30px;font-weight:900" class="mt">${S.fmt(r.score).replace(' ₴', '')} <span class="muted small">очок</span></div>
    <div class="muted">ціль ${esc(r.rival.name)}: ${S.fmt(r.target).replace(' ₴', '')}</div>
    <div style="font-size:24px;font-weight:900" class="mt ${r.win ? 'win' : 'lose'}">${r.win ? '+' + S.fmt(r.prize) : '−' + S.fmt(r.entry)}</div></div>
    <div class="card row between mt"><span>Чистих поворотів</span><b>${r.clean}/${S.DRIFT.corners}</b></div>
    <div class="card row between"><span>Розворотів</span><b>${r.spins}</b></div>
    <button class="btn yellow" data-act="driftAgain" ${me.fuel < 1 ? 'disabled' : ''}>Ще дрифт · пальне ${me.fuel}/${S.FUEL_MAX}</button>
    <button class="btn outline mt" data-act="driftExit">До суперників</button>`;
}
H.driftAgain = H.driftExit = () => {
  state.drift = null;
  state.raceView = 'drift';
  render();
};
H.raceAgain = H.raceExit = () => {
  state.race = null;
  render();
};

async function pvpView(car) {
  const data = await api('pvp/list');
  return `<div class="card"><b>Створити виклик</b><div class="list mt">${carRow(car, '<button class="btn sm ghost" data-act="pvpCar">Змінити</button>')}</div>
      <input id="bet" inputmode="numeric" placeholder="Ставка" value="${Math.max(S.PVP_MIN_BET, Math.min(me.balance, 50000))}">
      <button class="btn mt" data-act="pvpCreate">Кинути виклик</button>
      <div class="tiny muted mt">Суперник ставить стільки ж. Переможець забирає банк мінус ${S.FEE * 100}%. Якщо суперник онлайн — гонка наживо: кожен сам жме газ і перемикає передачі. Якщо ні — за нього їде автопілот.</div></div>
    <div class="h2"><span>Відкриті виклики</span></div>
    <div class="list">${data.open.length ? data.open.map((p) => carRow(p.car, p.mine ? `<button class="btn sm red" data-act="pvpCancel" data-id="${p.id}">Скасувати</button>` : `<button class="btn sm" data-act="pvpAccept" data-id="${p.id}" data-bet="${p.bet}">${S.short(p.bet)}</button>`)
      .replace('</b></div>', `</b></div><div class="tiny muted">${esc(p.creator)} · ${p.car.et.toFixed(2)} с ${p.car.et < car.et ? '<span class="lose">швидший за твою</span>' : '<span class="win">повільніший за твою</span>'}</div>`)).join('') : '<div class="empty">Поки немає викликів — створи перший!</div>'}</div>
    ${data.history.length ? `<div class="h2"><span>Історія</span></div><div class="list">${data.history.map((h) => `<div class="li"><div class="grow"><b class="${h.win ? 'win' : 'lose'}">${h.win ? 'Перемога' : 'Поразка'}</b> <span class="muted small">vs ${esc(h.rival.name)}</span><div class="tiny muted">${esc(M(h.me.model).name)} проти ${esc(M(h.rival.car.model).name)}</div></div><b>${h.win ? '+' + S.short(h.result.prize - h.bet) : '−' + S.short(h.bet)}</b></div>`).join('')}</div>` : ''}`;
}
H.pvpCar = () => pickCar('Обери авто', (id) => (state.raceCar = id, render()));
H.pvpCreate = () => act('pvp/create', { carId: state.raceCar, bet: num($('#bet').value) }, 'Виклик створено — чекай суперника');
H.pvpCancel = (d) => act('pvp/cancel', { id: Number(d.id) }, 'Скасовано, ставку повернуто');
// Tapping a challenge asks its creator to race live; an offline (or "do not disturb") creator is raced by autopilot.
H.pvpAccept = (d) => pickCar(`Твоє авто · ставка ${S.fmt(Number(d.bet))}`, async (carId) => {
  const id = Number(d.id);
  let r;
  try {
    r = await api('pvp/request', { id, carId });
  } catch (e) {
    return toast(e.message, true);
  }
  if (r.offline) {
    if (await confirmBox('Суперник зараз не в грі. Поїхати проти його автопілота?')) pvpAutopilot(id, carId);
    return;
  }
  pvpWaiting(r, carId);
});
// Waiting for the creator to accept: a sheet with a countdown; it turns into the race, or offers the autopilot.
function pvpWaiting(s, carId) {
  const until = Date.now() + 25e3;
  sheet('PvP наживо', `<div class="center"><div class="art" style="margin:0 auto;max-width:200px">${carArt(s.rival.car.model)}</div>
    <b class="mt">Чекаємо, поки ${esc(s.rival.name)} прийме гонку</b>
    <div class="small muted mt">Ставка ${S.fmt(s.bet)} · ${esc(M(s.rival.car.model).name)}</div>
    <div class="big mt" id="pvpWait">25</div>
    <button class="btn outline mt" data-act="pvpWithdraw" data-id="${s.id}">Скасувати</button></div>`);
  clearInterval(pvpWaitTimer);
  pvpWaitTimer = setInterval(async () => {
    const el = $('#pvpWait');
    if (!el) return clearInterval(pvpWaitTimer);
    el.textContent = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    let st;
    try {
      st = await api('pvp/state', { id: s.id });
    } catch {
      return;
    }
    if (st.status === 'live') {
      clearInterval(pvpWaitTimer);
      startLive(st);
    } else if (st.status === 'released' || st.status === 'cancelled') {
      clearInterval(pvpWaitTimer);
      closeModal();
      if (st.status === 'released' && await confirmBox('Суперник не прийняв гонку. Поїхати проти його автопілота?')) pvpAutopilot(s.id, carId);
    }
  }, 1000);
}
let pvpWaitTimer = 0;
H.pvpWithdraw = async (d) => {
  clearInterval(pvpWaitTimer);
  closeModal();
  await act('pvp/withdraw', { id: Number(d.id) }, 'Запит скасовано, ставку повернуто');
};
// A live race is accepted: both players switch to the race screen with the shared start.
async function startLive(s) {
  if (state.race?.live?.id === s.id) return; // already on it (two polls saw the start at once)
  closeModal();
  clockOffset = s.now - Date.now();
  state.tab = 'race';
  state.page = null;
  state.race = {
    phase: 'lights', live: { id: s.id, startAt: s.startAt, greenAt: s.greenAt },
    car: s.me.car, rival: { name: s.rival.name, model: s.rival.car.model, hp: s.rival.car.hp, base: s.rival.car.base },
    reaction: null, shifts: [], gear: 1, result: null,
  };
  await render();
  runRace();
}
async function pvpAutopilot(id, carId) {
  try {
    const r = await api('pvp/accept', { id, carId });
    haptic(r.win ? 'success' : 'error');
    sheet('PvP', `<div class="center"><div class="big ${r.win ? 'win' : 'lose'}">${r.win ? 'Перемога!' : 'Поразка'}</div>${r.win ? `<div class="win" style="font-weight:900">+${S.fmt(r.prize)}</div>` : ''}
      <div class="mt">Ти: ${r.result.opponent.time.toFixed(3)} с</div><div>${esc(r.rival.name)} (${esc(M(r.rival.car.model).name)}): ${r.result.creator.time.toFixed(3)} с</div>
      <button class="btn mt" data-act="closeModal">Готово</button></div>`);
    await refresh();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- workshop ----------
TABS.shop = () => {
  const seg = `<div class="seg">${[['cases', 'Кейси'], ['stock', `Склад${me.parts.length ? ' · ' + me.parts.reduce((s, p) => s + p.count, 0) : ''}`]].map(([k, t]) => `<button class="${state.shopView === k ? 'on' : ''}" data-act="shopView" data-k="${k}">${t}</button>`).join('')}</div>`;
  if (state.shopView === 'stock') return seg + stockView();
  const pc = S.PART_CASE_BY_ID[state.partCase];
  if (pc.randomOnly && state.partType) state.partCase = 'racing';
  const price = partCasePrice(state.partCase);
  const d = state.partDrop;
  const fresh = state.fx?.type === 'parts';
  let stage;
  if (d) {
    stage = `<div class="multi parts ${d.length === 1 ? 'one' : ''}">${d.map((p, i) => {
      const t = S.TIER_BY_ID[p.tier];
      const sell = p.sold ? '<div class="dropsell done">Продано</div>' : `<button class="dropsell" data-act="sellDropPart" data-i="${i}">${ic('cash')}${S.short(t.price * S.PART_SELL_RATE)}</button>`;
      return `<div class="${fresh ? 'flip-in' : ''} ${p.sold ? 'sold' : ''}" style="animation-delay:${i * 140}ms"><div class="car pcard r${t.index}" style="--c:${S.CLASSES[t.cls].color}">${clsBadge(t.cls, 'tl')}
        <div class="art">${partArt(p.type, p.tier, 'lg')}</div><div class="nm ellipsis">${S.PARTS[p.type].name}</div><div class="meta">${t.name} · ${S.partEffect(p.type, p.tier)}</div></div>${sell}</div>`;
    }).join('')}</div>`;
  } else {
    stage = `<div class="reel-wrap" id="reelWrap"><div class="reel" id="reel">${Array.from({ length: 6 }, () => partReelCard(randomPartFor(pc))).join('')}</div></div>`;
  }
  const alive = d ? d.filter((p) => !p.sold) : [];
  const sum = alive.reduce((s, p) => s + Math.floor(S.TIER_BY_ID[p.tier].price * S.PART_SELL_RATE), 0);
  return seg + `
    <div class="ptypes">${[[null, 'Будь-яка'], ...S.PART_KEYS.map((k) => [k, S.PARTS[k].name])].map(([k, n]) => `<button class="ptype ${state.partType === k ? 'on' : ''}" data-act="pickPartType" data-k="${k ?? ''}">
      ${k ? partArt(k, null, 'sm') : `<span class="part sm">${ic('adjustments')}</span>`}<span>${n}</span></button>`).join('')}</div>
    <div class="pcases">${S.PART_CASES.map((c) => {
      const off = c.randomOnly && state.partType;
      return `<button class="pcase ${c.id === state.partCase ? 'on' : ''}" data-act="pickPartCase" data-id="${c.id}" ${off ? 'disabled' : ''}>
        <b>${esc(c.name)}</b>
        <span class="tierbar">${Object.entries(c.weights).map(([t, w]) => `<i style="flex:${w};background:${S.CLASSES[S.TIER_BY_ID[t].cls].color}"></i>`).join('')}</span>
        <span class="pprice">${off ? 'лише випадкові' : S.fmt(partCasePrice(c.id))}</span></button>`;
    }).join('')}</div>
    <div class="stage pstage" style="${d?.length > 3 ? 'height:auto;min-height:200px' : ''}">${stage}</div>
    <div class="seg">${[1, 3, 5, 10].map((k) => `<button class="${k === state.partCount ? 'on' : ''}" data-act="partCount" data-n="${k}">×${k}</button>`).join('')}</div>
    ${price * state.partCount > me.balance ? `<button class="btn" disabled>Недостатньо коштів · бракує ${S.fmt(price * state.partCount - me.balance)}</button>`
      : `<button class="btn" data-act="openParts" ${state.opening ? 'disabled' : ''}>${d ? 'Відкрити ще' : 'Відкрити'}${state.partCount > 1 ? ' ×' + state.partCount : ''} · ${S.fmt(price * state.partCount)}</button>`}
    ${d ? `<div class="btns mt"><button class="btn outline" data-act="shopView" data-k="stock">На склад</button>${alive.length ? `<button class="btn ghost btn2" data-act="sellDropParts"><span>${ic('cash')} Продати все</span><small>${S.short(sum)}</small></button>` : ''}</div>` : ''}
    <div class="card row between mt"><span>Швидке відкриття</span><button class="toggle ${state.fast ? 'on' : ''}" data-act="toggleFast"></button></div>
    <div class="tiny muted center">${state.partType ? `Випадає лише «${S.PARTS[state.partType].name}», кейс на ${S.PICK_PART_EXTRA * 100}% дорожчий.` : 'Деталь випадає випадкова — обери конкретну вгорі, щоб збирати лише її.'} Три однакові деталі зливаються в одну рівнем вище на складі.</div>`;
};
const partCasePrice = (id) => Math.round(S.PART_CASE_BY_ID[id].price * (state.partType ? 1 + S.PICK_PART_EXTRA : 1) / 100) * 100;
function randomPartFor(pc) {
  const e = Object.entries(pc.weights);
  let x = Math.random() * e.reduce((s, [, w]) => s + w, 0);
  let tier = e[0][0];
  for (const [t, w] of e) if ((x -= w) < 0) {
    tier = t;
    break;
  }
  return { type: state.partType || S.PART_KEYS[Math.floor(Math.random() * S.PART_KEYS.length)], tier };
}
const partReelCard = (p) => {
  const t = S.TIER_BY_ID[p.tier];
  return `<div class="car pcard" style="--c:${S.CLASSES[t.cls].color}">${clsBadge(t.cls, 'tl')}<div class="art">${partArt(p.type, p.tier)}</div><div class="nm tiny ellipsis">${S.PARTS[p.type].name} · ${t.name}</div></div>`;
};
AFTER.shop = () => {
  if (state.fx?.type !== 'parts' || !state.partDrop) return;
  state.fx = null;
  // Cards flip in one by one with a few sparkles in their tier colour.
  state.partDrop.forEach((p, i) => {
    const t = S.TIER_BY_ID[p.tier];
    setTimeout(() => {
      const el = document.querySelectorAll('.multi.parts > div')[i];
      if (!el) return;
      FX.sparkle(el, [S.CLASSES[t.cls].color, '#fff'], 3 + t.index * 2);
      haptic(t.index >= 3 ? 'medium' : 'light');
    }, i * 140 + 250);
  });
};
H.sellDropPart = (d, el) => {
  const p = state.partDrop[Number(d.i)];
  if (!armed(el, 'Точно?')) return;
  sellParts([p]);
};
H.sellDropParts = (d, el) => {
  const list = state.partDrop.filter((p) => !p.sold);
  const sum = list.reduce((s, p) => s + Math.floor(S.TIER_BY_ID[p.tier].price * S.PART_SELL_RATE), 0);
  if (armed(el, `Точно продати? · ${S.short(sum)}`)) sellParts(list);
};
async function sellParts(list) {
  let got = 0;
  try {
    for (const p of list) {
      got += (await api('parts/sell', { type: p.type, tier: p.tier, count: 1 })).got || 0;
      p.sold = true;
    }
    toast(`Продано: +${S.fmt(got)}`);
  } catch (e) {
    toast(e.message, true);
  }
  await refresh();
}
H.shopView = (d) => {
  state.shopView = d.k;
  state.partDrop = null;
  render();
};
H.partCount = (d) => (state.partCount = Number(d.n), render());
H.pickPartType = (d) => {
  if (state.opening) return;
  state.partType = d.k || null;
  if (state.partType && S.PART_CASE_BY_ID[state.partCase].randomOnly) state.partCase = 'racing';
  state.partDrop = null;
  render();
};
H.pickPartCase = (d) => {
  if (state.opening) return;
  state.partCase = d.id;
  state.partDrop = null;
  closeModal();
  render();
};
H.openParts = async (d, el) => {
  if (state.opening) return;
  state.opening = true;
  el.disabled = true;
  let r;
  try {
    r = await api('parts/open', { caseId: state.partCase, type: state.partType, count: state.partCount });
  } catch (e) {
    state.opening = false;
    el.disabled = false;
    haptic('error');
    return toast(e.message, true);
  }
  // One part, not in fast mode: spin the reel first, like car cases.
  // Not in fast mode: spin a reel per part (up to 5 at once; ×10 shows the cards straight away).
  if (!state.fast && r.results.length <= 5) {
    const pc = S.PART_CASE_BY_ID[state.partCase];
    state.partDrop = null;
    const spinPart = (win, opts = {}) => {
      const t = S.TIER_BY_ID[win.tier];
      return spinReel({ cardAt: (i, W) => partReelCard(i === W ? win : randomPartFor(pc)), color: S.CLASSES[t.cls].color, rank: t.index, ...opts });
    };
    if (r.results.length === 1) {
      $('.pstage').innerHTML = '<div class="reel-wrap" id="reelWrap"><div class="reel" id="reel"></div></div>';
      await spinPart(r.results[0]);
    } else {
      await spinMany($('.pstage'), r.results.length, (i, wrap, reel, extra, quiet) => spinPart(r.results[i], { wrap, reel, extra, quiet }));
    }
  }
  state.opening = false;
  state.partDrop = r.results.map((p) => ({ ...p }));
  state.fx = { type: 'parts' };
  await refresh();
};
function stockView() {
  if (!me.parts.length) return `<div class="card center"><div style="font-size:40px;color:var(--muted)">${ic('box')}</div><b class="disp" style="font-size:18px">СКЛАД ПОРОЖНІЙ</b><div class="small muted mt">Деталі випадають з кейсів майстерні. Три однакові деталі можна злити в одну рівнем вище.</div><button class="btn mt" data-act="shopView" data-k="cases">До кейсів з деталями</button></div>`;
  const types = S.PART_KEYS.filter((k) => me.parts.some((p) => p.type === k));
  return `<div class="list">${types.map((k) => {
    const items = me.parts.filter((p) => p.type === k).sort((a, b) => S.TIER_BY_ID[a.tier].index - S.TIER_BY_ID[b.tier].index);
    const canMerge = items.some((p) => p.available >= 3 && S.TIER_BY_ID[p.tier].index < S.TIERS.length - 1);
    return `<button class="li" data-act="stockType" data-k="${k}">${partArt(k, items[items.length - 1].tier, 'sm')}<div class="grow"><b>${S.PARTS[k].name}</b><div class="dots">${items.map((p) => `<span style="--c:${S.CLASSES[tierCls(p.tier)].color}">${S.TIER_BY_ID[p.tier].name} × ${p.count}</span>`).join('')}</div></div>${canMerge ? '<span class="qchip q-perfect">3→1</span>' : '<span class="chev">›</span>'}</button>`;
  }).join('')}</div>
  <div class="tiny muted">Встановити деталь можна в гаражі, у картці машини. Підходять деталі не нижче класу машини.</div>`;
}
H.stockType = (d, el, e, result) => {
  const k = d.k;
  const items = me.parts.filter((p) => p.type === k).sort((a, b) => S.TIER_BY_ID[b.tier].index - S.TIER_BY_ID[a.tier].index);
  sheet(S.PARTS[k].name, `${result ? `<div class="card center"><div style="font-size:40px" class="${result.ok ? 'win' : 'lose'}">${result.ok ? partArt(k, result.result.tier, 'lg') : ic('flame')}</div><b class="${result.ok ? 'win' : 'lose'}">${result.ok ? S.partLabel(k, result.result.tier) : 'Не пощастило — деталі згоріли'}</b></div>` : ''}
    ${items.length ? `<div class="list">${items.map((p) => {
      const t = S.TIER_BY_ID[p.tier];
      const chance = S.MERGE_CHANCE[t.index];
      return `<div class="li">${partArt(k, p.tier, 'sm')}<div class="grow"><b>${t.name} × ${p.count}</b><div class="small muted">${clsBadge(t.cls)} ${S.short(t.price)} · ${S.partEffect(k, p.tier)}${p.cooling ? ` · остигає ${p.cooling} (<span data-until="${p.coolUntil - clockOffset}"></span>)` : ''}</div></div>
        <div class="col" style="gap:4px">${chance != null ? `<button class="btn sm" data-act="merge" data-k="${k}" data-tier="${p.tier}" ${p.available >= 3 ? '' : 'disabled'}>3→1 · ${Math.round(chance * 100)}%</button>` : ''}
        <button class="btn sm ghost" data-act="sellPart" data-k="${k}" data-tier="${p.tier}" ${p.available ? '' : 'disabled'}>${S.short(t.price * S.PART_SELL_RATE)}</button></div></div>`;
    }).join('')}</div>` : '<div class="empty">Деталей цього типу більше немає</div>'}
    <div class="tiny muted">Злиття: 3 однакові деталі → 1 рівнем вище. Якщо не пощастить — згорять усі три. Кнопка з ціною продає одну деталь. Знята з машини деталь ${S.PART_COOLDOWN_MIN} хв «остигає».</div>`);
  tickUntil();
};
H.merge = async (d) => {
  try {
    const r = await api('parts/merge', { type: d.k, tier: d.tier });
    haptic(r.ok ? 'success' : 'error');
    await refresh();
    H.stockType({ k: d.k }, null, null, r);
  } catch (e) {
    toast(e.message, true);
  }
};
H.sellPart = async (d) => {
  if (await act('parts/sell', { type: d.k, tier: d.tier, count: 1 }, (r) => `+${S.fmt(r.got)}`)) H.stockType({ k: d.k });
};

// ---------- menu ----------
function claimableCollection() {
  if (!me) return false;
  const owned = new Set(me.collection);
  const n = me.collection.filter((id) => !M(id)?.secret).length;
  if (S.COLLECTION_MILESTONES.some((m) => n >= m.n && !me.claims.includes('n' + m.n))) return true;
  return S.MAIN_COUNTRIES.some((c) => !me.claims.includes('c' + c) && S.countryModels(c).every((m) => owned.has(m.id)));
}
TABS.menu = () => {
  // Grouped rows like iOS Settings: coloured square icon, name, a short value on the right, a red counter when needed.
  const row = (page, icon, title, c, sub = '', count = 0, act = 'go') => `<button class="li" data-act="${act}" data-page="${page}">
    <span class="mi" style="--c:${c}">${ic(icon)}</span><b>${title}</b>${count ? `<span class="cnt" style="margin-left:auto">${count}</span>` : sub ? `<span class="sub">${sub}</span>` : '<span style="margin-left:auto"></span>'}<span class="chev">${ic('chevron-right')}</span></button>`;
  const group = (title, rows) => `<div class="mgroup">${title}</div><div class="list menu-list">${rows.join('')}</div>`;
  return seasonCard() + group('Грати', [
      row('casino', 'cards', 'Казино', '#ff2d55'),
      row('battles', 'flame', 'Кейс-батли', '#ff9500'),
      row('upgrade', 'arrow-big-up-lines', 'Апгрейд', '#af52de'),
      row('quests', 'target-arrow', 'Завдання', '#ff3b30', 'щодня нові'),
    ])
    + group('Торгівля', [
      row('market', 'building-store', 'Ринок', '#34c759'),
      row('trades', 'arrows-exchange', 'Обміни', '#007aff', 'трейд-зал', me.incomingTrades),
      row('plates', 'license', 'Номери', '#ffcc00', String(me.plates.length)),
    ])
    + group('Прогрес', [
      row('leaderboard', 'trophy', 'Рейтинг', '#ff9f0a', 'призи в ⭐ за сезон'),
      row('achievements', 'diamond', 'Досягнення', '#bf5af2', 'бейджі й нагороди', me.achReady || 0),
      row('collection', 'books', 'Колекція', '#5856d6', `${me.collection.filter((id) => !M(id)?.secret).length}/${S.ALL_MODELS.filter((m) => !m.secret).length}`, claimableCollection() ? '!' : 0),
      row('events', 'bell', 'Сповіщення', '#8e8e93', '', me.unread),
    ])
    + group('Спільнота', [
      ...(config.community?.channel ? [row(config.community.channel, 'bell', 'Канал з анонсами', '#007aff', 'новини й промокоди', 0, 'openLink')] : []),
      ...(config.community?.chat ? [row(config.community.chat, 'users', 'Чат гравців', '#34c759', 'спілкування й обміни', 0, 'openLink')] : []),
      row('support', 'info-circle', 'Підтримка', '#ff9500', 'написати нам'),
    ])
    + group('Інше', [
      row('store', 'star', 'Магазин', '#30b0c7', me.vip ? 'VIP активний' : 'VIP, пропуск, набори'),
      row('friends', 'users', 'Друзі', '#ff2d55', `+${S.short(S.REF_REWARD)}`),
      row('promo', 'ticket', 'Промокоди', '#64d2ff'),
      ...(me.admin ? [row('', 'adjustments', 'Адмін-панель', '#636366', '', 0, 'openAdmin')] : []),
    ])
    + `<div class="card row between mt2"><div><b>Не турбувати</b><div class="tiny muted">Ніхто не зможе запросити тебе на обмін чи гонку</div></div><button class="toggle ${me.noInvites ? 'on' : ''}" data-act="toggleDnd"></button></div>`
    + `<div class="card row between"><div><div class="small muted">Твій ID для обмінів</div><b>${me.id}</b></div><button class="btn sm ghost" data-act="copyId">Копіювати</button></div>`;
};
H.openAdmin = () => {
  // Remember the exact game address (with ?as=… in DEV) so the panel's "back" button returns here.
  try {
    sessionStorage.setItem('avtodrop-back', location.href);
  } catch {}
  location.href = 'admin.html';
};
H.openLink = (d) => (tg?.openTelegramLink && /^https:\/\/t\.me\//.test(d.page) ? tg.openTelegramLink(d.page) : window.open(d.page, '_blank'));
// ---------- support ----------
PAGES.support = async () => {
  const { list } = await api('support/mine');
  return `<div class="card"><b>Написати в підтримку</b>
      <div class="small muted mt">Питання, помилка, оплата чи ідея — пиши сюди. Відповідь прийде прямо в гру й у бот.</div>
      <textarea id="supText" maxlength="1000" placeholder="Опиши, що сталося" style="display:block;width:100%;box-sizing:border-box;min-height:110px;margin-top:10px"></textarea>
      <button class="btn yellow mt" data-act="supSend">${ic('arrow-right')} Надіслати</button></div>
    ${list.length ? `<div class="h2"><span>Мої звернення</span></div><div class="list">${list.map((m) => `<div class="card"><div class="small muted">${new Date(m.at).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}</div>
      <div class="mt" style="white-space:pre-wrap">${esc(m.text)}</div>
      ${m.answer ? `<div class="gift-note" style="margin:10px 0 0;max-width:none"><b class="small">Підтримка:</b><div style="white-space:pre-wrap">${esc(m.answer)}</div></div>` : '<div class="tiny muted mt">Чекає на відповідь…</div>'}</div>`).join('')}</div>` : ''}`;
};
H.supSend = async () => {
  const text = $('#supText').value.trim();
  if (text.length < 3) return toast('Опиши питання хоча б кількома словами', true);
  if (await act('support/send', { text }, 'Надіслано — відповімо якнайшвидше', { rerender: false })) render();
};
H.copyId = () => navigator.clipboard?.writeText(String(me.id)).then(() => toast('ID скопійовано'), () => toast(String(me.id)));

// ---------- collection ----------
PAGES.collection = () => {
  const owned = new Set(me.collection);
  const n = me.collection.filter((id) => !M(id)?.secret).length;
  const totalReg = S.ALL_MODELS.filter((m) => !m.secret).length;
  const ms = S.COLLECTION_MILESTONES;
  const rows = [
    ...ms.map((m) => ({ key: 'n' + m.n, title: m.label || `Збери ${m.n} машин`, sub: rewardText({ money: m.money, slots: m.slots }), have: Math.min(n, m.n), need: m.n, ic: ic('car') })),
    ...S.MAIN_COUNTRIES.map((c) => {
      const list = S.countryModels(c);
      return { key: 'c' + c, title: `Усі машини: ${S.COUNTRIES[c].name}`, sub: `+${S.short(S.COUNTRY_REWARD[c])} · секретна машина`, have: list.filter((m) => owned.has(m.id)).length, need: list.length, ic: S.COUNTRIES[c].flag };
    }),
  ];
  const visible = state.collAll ? rows : rows.filter((r) => !me.claims.includes(r.key)).slice(0, 3);
  const filter = state.collFilter;
  const models = S.ALL_MODELS.filter((m) => (!filter || m.country === filter) && (!m.season || owned.has(m.id)));
  return `<div class="card"><div class="row between"><b>Зібрано</b><span class="muted">${n} з ${totalReg}</span></div><div class="progress mt"><i style="width:${(n / totalReg) * 100}%"></i></div></div>
    <div class="h2"><span>Нагороди за колекцію</span></div>
    <div class="list">${visible.map((r) => {
      const done = me.claims.includes(r.key);
      const ready = !done && r.have >= r.need;
      return `<div class="li"><span class="ic">${r.ic}</span><div class="grow"><b>${esc(r.title)}</b><div class="small muted">${esc(r.sub)}</div><div class="progress mt"><i style="width:${(r.have / r.need) * 100}%"></i></div></div>
        ${done ? '<span class="win">✓</span>' : ready ? `<button class="btn sm yellow" data-act="collClaim" data-k="${r.key}">Забрати</button>` : `<span class="small muted">${r.have}/${r.need}</span>`}</div>`;
    }).join('')}
    <button class="li" data-act="collAll" style="justify-content:center;color:#f5b301;font-weight:700">${state.collAll ? 'Згорнути' : `Показати всі · ще ${rows.length - visible.length}`}</button></div>
    <div class="h2"><span>Машини</span></div>
    <div class="chips"><button class="${!filter ? 'on' : ''}" data-act="collFilter" data-k="">Усі</button>${S.MAIN_COUNTRIES.map((c) => `<button class="${filter === c ? 'on' : ''}" data-act="collFilter" data-k="${c}">${S.COUNTRIES[c].flag} ${S.COUNTRIES[c].name}</button>`).join('')}</div>
    ${S.CLASS_ORDER.map((cls) => {
      const list = models.filter((m) => m.cls === cls);
      if (!list.length) return '';
      return `<div class="h2"><span>${clsBadge(cls)} ${cls === 'X' ? 'Секретні' : S.CLASSES[cls].name}</span><span>${list.filter((m) => owned.has(m.id)).length}/${list.length}</span></div>
        <div class="grid">${list.map((m) => `<div class="car" style="min-height:0;--c:${S.CLASSES[cls].color}">${clsBadge(cls, 'tl')}<div class="art" style="height:60px">${carArt(m.id, { silhouette: !owned.has(m.id) })}</div>
          <div class="nm tiny">${owned.has(m.id) ? esc(m.name) : '???'}</div><div class="meta">${m.season ? `Сезон ${m.season}` : m.secret && !owned.has(m.id) ? `збери: ${S.COUNTRIES[m.country].name}` : `${S.COUNTRIES[m.country].flag} ${S.COUNTRIES[m.country].name}`}</div></div>`).join('')}</div>`;
    }).join('')}`;
};
H.collClaim = (d) => act('collection/claim', { key: d.k }, (r) => `Отримано: ${S.short(r.reward.money)}${r.reward.secret ? ' + секретна машина!' : ''}`);
H.collAll = () => (state.collAll = !state.collAll, render());
H.collFilter = (d) => (state.collFilter = d.k, render());

// ---------- plates ----------
PAGES.plates = () => {
  const seg = `<div class="seg">${[['gen', 'Генерація'], ['mine', `Мої · ${me.plates.length}`]].map(([k, t]) => `<button class="${state.plateView === k ? 'on' : ''}" data-act="plateView" data-k="${k}">${t}</button>`).join('')}</div>`;
  if (state.plateView === 'mine') {
    return seg + (me.plates.length ? `<div class="list">${me.plates.map((p) => {
      const c = p.carId && me.cars.find((x) => x.id === p.carId);
      return `<div class="li">${plate(p.text)}<div class="grow small">${clsBadge(p.cls)} ${S.short(p.value)}<div class="tiny muted ellipsis">${esc(S.regionOf(p.text) || '')}</div><div class="tiny muted ellipsis">${c ? esc(M(c.model).name) : 'не встановлено'}</div></div>
        ${c ? `<button class="btn sm ghost" data-act="plateDetach" data-pid="${p.id}">Зняти</button>` : `<span class="col" style="gap:4px"><button class="btn sm" data-act="plateToCar" data-pid="${p.id}">Повісити</button><button class="btn sm ghost" data-act="plateSell" data-pid="${p.id}">${S.short(p.value / 2)}</button></span>`}</div>`;
    }).join('')}</div>` : '<div class="empty">Номерів поки немає</div>');
  }
  const gen = S.PLATE_GEN.find((g) => g.id === (state.plateGen || 'basic'));
  const reg = state.plateRegion;
  const d = state.plateDrop;
  return seg + `<div class="center" style="padding:18px 0 10px" id="plateStage">${plate(d ? d.text : 'AA 0000 AA', 'lg')}</div>
    ${d ? `<div class="center ${state.fx?.type === 'plate' ? 'pop' : ''}">${clsBadge(d.cls)} <span class="chip" style="color:${S.CLASSES[d.cls].color}">${S.CLASSES[d.cls].name}</span><div class="big mt ${S.rankOf(d.cls) >= 3 ? 'shimmer' : ''}" style="--c:${S.CLASSES[d.cls].color}" id="plateValue">${S.fmt(d.value)}</div><div class="small muted">${esc(d.label)}</div><div class="tiny muted">Регіон: ${esc(S.regionOf(d.text) || '—')}</div></div>
      <div class="btns mt"><button class="btn outline" data-act="plateToCar" data-pid="${d.id}">Повісити на машину</button><button class="btn red" data-act="plateSell" data-pid="${d.id}">Продати · ${S.short(d.value / 2)}</button></div>` : ''}
    <button class="btn mt" data-act="genPlate" id="genBtn">${d ? 'Ще раз' : 'Згенерувати'} · ${reg ? `${reg} · ${S.fmt(S.regionPrice(reg))}` : `${gen.name} · ${S.fmt(gen.price)}`}</button>
    <div class="list mt"><button class="li" data-act="regionPick"><span class="ic">${ic('world')}</span><div class="grow"><b>Регіон</b><div class="small muted">${reg ? `${reg} · ${esc(S.REGIONS[reg])}` : 'будь-який — випадковий'}</div></div>${reg ? `<span class="chip" data-act="regionClear">✕</span>` : `<span class="chev">${ic('chevron-right')}</span>`}</button></div>
    ${reg ? `<div class="card mt"><b>Номер області ${reg}</b><div class="small muted">Клас — повний рандом: від звичайного до міфічного, як пощастить</div>${dots(S.REGION_GEN.weights)}</div>` : `<div class="h2"><span>Генерація номера</span></div>
    <div class="list">${S.PLATE_GEN.map((g) => `<button class="li ${g.id === gen.id ? 'on' : ''}" data-act="pickGen" data-id="${g.id}"><span class="ic">${ic(g.id === 'basic' ? 'license' : g.id === 'better' ? 'star' : 'sparkles')}</span><div class="grow"><b>${g.name}</b>${dots(g.weights)}</div><b>${S.short(g.price)}</b></button>`).join('')}</div>`}
    <div class="tiny muted">Кожен номер існує в одному екземплярі. Номер на машині додає свою ціну до вартості машини — і до доходу. Найдорожчі: 0001–0009, чотири однакові цифри з однаковими літерами (KA 7777 KA).</div>`;
};
H.plateView = (d) => (state.plateView = d.k, render());
// Region picker: search by code or name; each code has its own price (the capital and ІІ cost more).
function regionSheet(filter = '') {
  const f = filter.trim().toLowerCase();
  const norm = S.normalizePlate(filter).slice(0, 2);
  const rows = S.REGION_LIST.filter((r) => !f || r.name.toLowerCase().includes(f) || (norm && r.codes.some((c) => c.startsWith(norm))));
  return `<input id="regQ" placeholder="Код або назва: KA, Львівська…" value="${esc(filter)}" autocomplete="off">
    <div class="tiny muted mt">Обрав регіон — клас номера випадає повним рандомом. Ціна залежить від регіону: Київ і ІІ дорожчі.</div>
    <div class="list mt"><button class="li" data-act="regionSet" data-k=""><span class="grow"><b>Будь-який регіон</b><div class="small muted">звичайна генерація за типом</div></span></button>
    ${rows.map((r) => `<div class="li"><div class="grow"><b>${esc(r.name)}</b></div><span class="row" style="gap:6px">${r.codes.map((c) => `<button class="btn sm ${state.plateRegion === c ? 'yellow' : 'ghost'}" data-act="regionSet" data-k="${c}">${c} · ${S.short(S.regionPrice(c)).replace(' ₴', '')}</button>`).join('')}</span></div>`).join('') || '<div class="empty">Нічого не знайдено</div>'}</div>`;
}
H.regionPick = () => {
  sheet('Регіон номера', regionSheet());
  const bind = () => $('#regQ')?.addEventListener('input', (e) => {
    const v = e.target.value;
    sheet('Регіон номера', regionSheet(v));
    bind();
    const i = $('#regQ');
    i.focus();
    i.setSelectionRange(v.length, v.length);
  });
  bind();
};
H.regionSet = (d) => (state.plateRegion = d.k || null, state.plateDrop = null, closeModal(), render());
H.regionClear = () => (state.plateRegion = null, state.plateDrop = null, render());
H.pickGen = (d) => (state.plateGen = d.id, state.plateDrop = null, render());
H.genPlate = async (d, el) => {
  el.disabled = true;
  let r;
  try {
    r = await api('plate/generate', state.plateRegion ? { region: state.plateRegion } : { gen: state.plateGen || 'basic' });
  } catch (e) {
    el.disabled = false;
    return toast(e.message, true);
  }
  await spinPlate(r.plate);
  state.plateDrop = r.plate;
  state.fx = { type: 'plate' };
  await refresh();
};
// Slot-machine reels: every character spins on its own strip and they stop left to right.
function spinPlate(p) {
  return new Promise((resolve) => {
    const plateEl = $('#plateStage .plate');
    const txi = plateEl.querySelector('.txi');
    const L = S.PLATE_LETTERS, D = '0123456789';
    const rand = (s) => s[Math.floor(Math.random() * s.length)];
    const rank = S.rankOf(p.cls);
    // Split-flap style: every cell keeps its final width and just swaps whole characters (with a quick flip),
    // so a glyph is never shown half-cut the way a scrolling strip would — on any phone or font.
    txi.innerHTML = plateGroups(p.text, true);
    fitPlate(plateEl);
    // Fractional layout widths (getBoundingClientRect is scaled by --sx, so undo it); offsetWidth rounds.
    const sx = parseFloat(txi.style.getPropertyValue('--sx')) || 1;
    const cells = [...txi.querySelectorAll('.ch')];
    const finals = cells.map((c) => c.textContent);
    cells.forEach((c) => {
      c.style.width = `${c.getBoundingClientRect().width / sx}px`;
      c.classList.add('flipc');
      c.textContent = rand(/\d/.test(c.textContent) ? D : L);
    });
    plateEl.style.setProperty('--c', S.CLASSES[p.cls].color);
    plateEl.classList.remove('lit');
    let done = 0;
    const t0 = performance.now();
    cells.forEach((c, i) => {
      const pool = /\d/.test(finals[i]) ? D : L;
      // Later cells run longer; on rare plates the last two drag out for suspense.
      const extra = rank >= 2 && i >= cells.length - 2 ? 700 * (i - cells.length + 3) : 0;
      const dur = 900 + i * 220 + extra;
      if (rank >= 2 && i === cells.length - 2) setTimeout(() => plateEl.classList.add('tension'), 900 + i * 220 - 200);
      const flip = (ch) => {
        c.textContent = ch;
        c.classList.remove('flip');
        void c.offsetWidth;
        c.classList.add('flip');
      };
      const tick = () => {
        const left = dur - (performance.now() - t0);
        if (left <= 0) {
          flip(finals[i]);
          c.classList.add('landed');
          haptic(i === cells.length - 1 ? 'heavy' : 'light');
          if (++done === cells.length) {
            plateEl.classList.remove('tension');
            resolve();
          }
          return;
        }
        let ch;
        do ch = rand(pool);
        while (ch === c.textContent);
        flip(ch);
        // Fast at first, slowing down as the cell is about to stop.
        setTimeout(tick, Math.min(left, 45 + 130 * Math.max(0, 1 - left / 900)));
      };
      tick();
    });
  });
}
AFTER.plates = () => {
  if (state.fx?.type !== 'plate' || !state.plateDrop) return;
  state.fx = null;
  const p = state.plateDrop;
  const rank = S.rankOf(p.cls), color = S.CLASSES[p.cls].color;
  const plateEl = $('#plateStage .plate');
  plateEl.style.setProperty('--c', color);
  if (rank >= 1) plateEl.classList.add('lit');
  FX.celebrate(rank, color, { target: plateEl });
  FX.countUp($('#plateValue'), p.value, 900, S.fmt);
  haptic(rank >= 3 ? 'heavy' : 'success');
};
H.plateToCar = (d) => pickCar('На яку машину?', (carId) => act('plate/attach', { plateId: Number(d.pid), carId }, 'Номер встановлено').then(() => (state.plateDrop = null)), (c) => c.status === 'garage' || c.status === 'showcase');
H.plateSell = async (d) => {
  if (await act('plate/sell', { plateId: Number(d.pid) }, (r) => `+${S.fmt(r.got)}`)) state.plateDrop = null, render();
};

// ---------- market ----------
PAGES.market = async () => {
  const seg = `<div class="seg">${[['buy', 'Купити'], ['auction', 'Аукціони'], ['mine', 'Мої лоти']].map(([k, t]) => `<button class="${state.marketTab === k ? 'on' : ''}" data-act="mTab" data-k="${k}">${t}</button>`).join('')}</div>`;
  const info = (c) => `<span class="chip">${partCount(c)}/${partSlots(c)} деталей</span>`;
  if (state.marketTab === 'buy') {
    const { list, dealer, now } = await api('market/list', { cls: state.marketCls, sort: state.marketSort });
    // Own lots stay in the list (marked), so a freshly listed car doesn't look like it vanished.
    const mineTag = '<span class="chip mine">твій лот</span>';
    const row = (l) => carRow(l.car, l.mine ? `<button class="btn sm red" data-act="unlist" data-id="${l.id}">Зняти</button>`
      : `<button class="btn sm" data-act="buy" data-id="${l.id}" data-price="${l.price}" ${me.balance < l.price || (l.dealer && !dealer.left) ? 'disabled' : ''}>${S.short(l.price)}</button>`)
      .replace('</b></div>', `</b></div><div class="tiny muted">${l.mine ? `${mineTag} ціна ${S.short(l.price)}` : l.dealer ? '' : esc(l.seller) + ' · '}оцінка ${S.short(l.car.value)}${l.dealer ? '' : ' ' + info(l.car)} ${!l.mine && l.price <= l.car.value * 1.05 ? `<span class="chip deal">${l.dealer ? 'акція' : 'вигідно'}</span>` : ''}</div>`);
    const fromDealer = list.filter((l) => l.dealer), fromPlayers = list.filter((l) => !l.dealer);
    // No "X" filter: secret cars can never be on the market.
    return seg + `<div class="chips">${[['', 'Усі'], ...S.CLASS_ORDER.filter((c) => c !== 'X').map((c) => [c, c])].map(([k, t]) => `<button class="${state.marketCls === k ? 'on' : ''}" data-act="mCls" data-k="${k}">${t}</button>`).join('')}</div>
      <div class="chips">${[['new', 'Нові'], ['cheap', 'Дешевші'], ['expensive', 'Дорожчі'], ['deal', 'Вигідні']].map(([k, t]) => `<button class="${state.marketSort === k ? 'on' : ''}" data-act="mSort" data-k="${k}">${t}</button>`).join('')}</div>
      <div class="card dealer-head"><div class="row between"><b>${ic('building-store')} Дилер АВТОДРОП</b><span class="small muted">нові лоти через <span data-until="${dealer.nextAt - (now - Date.now())}"></span></span></div>
        <div class="small muted">Продає машини за фіксованою ціною, оновлюється кожні ${S.DEALER.hours} год. Тобі лишилось покупок: <b style="color:var(--text)">${dealer.left}/${dealer.perPlayer}</b></div></div>
      <div class="list">${fromDealer.length ? fromDealer.map(row).join('') : '<div class="empty">Дилер усе розпродав — чекай нових лотів</div>'}</div>
      <div class="h2"><span>Від гравців</span><span>${fromPlayers.length}</span></div>
      <div class="list">${fromPlayers.length ? fromPlayers.map(row).join('') : '<div class="empty">Лотів поки немає. Виставляй свої авто з картки машини!</div>'}</div>`;
  }
  if (state.marketTab === 'auction') {
    const { list, now } = await api('auction/list');
    return seg + `<div class="list">${list.length ? list.map((a) => carRow(a.car, a.mine ? (a.bids ? `<span class="chip">${a.bids} ставок</span>` : `<button class="btn sm red" data-act="unauction" data-id="${a.id}">Скасувати</button>`) : `<button class="btn sm ${a.leading ? 'green' : ''}" data-act="bid" data-id="${a.id}" data-min="${a.minBid}">${a.leading ? 'Лідер' : 'Ставка'}</button>`).replace('</b></div>', `</b></div><div class="tiny muted">${a.mine ? '<span class="chip mine">твій лот</span> ' : ''}${a.topBid ? `ставка ${S.short(a.topBid)} (${a.bids})` : `старт ${S.short(a.startPrice)}`} · ${ic('clock')} <span data-until="${a.endsAt - (now - Date.now())}"></span></div>`)).join('') : '<div class="empty">Активних аукціонів немає</div>'}</div>`;
  }
  const [m, a] = await Promise.all([api('market/list'), api('auction/list')]);
  const mine = m.list.filter((l) => l.mine), auc = a.list.filter((x) => x.mine);
  return seg + `<div class="tiny muted">Виставити авто можна з його картки в гаражі → «Продати».</div>
    <div class="h2"><span>На ринку</span></div><div class="list">${mine.length ? mine.map((l) => carRow(l.car, `<button class="btn sm red" data-act="unlist" data-id="${l.id}">Зняти</button>`).replace('</b></div>', `</b></div><div class="tiny muted">ціна ${S.fmt(l.price)}</div>`)).join('') : '<div class="empty">Немає лотів</div>'}</div>
    <div class="h2"><span>Аукціони</span></div><div class="list">${auc.length ? auc.map((x) => carRow(x.car, x.bids ? `<span class="chip">${x.bids} ставок</span>` : `<button class="btn sm red" data-act="unauction" data-id="${x.id}">Скасувати</button>`).replace('</b></div>', `</b></div><div class="tiny muted">${x.topBid ? `ставка ${S.short(x.topBid)} від ${esc(x.leader)}` : `старт ${S.short(x.startPrice)}`} · ${ic('clock')} <span data-until="${x.endsAt - (a.now - Date.now())}"></span></div>`)).join('') : '<div class="empty">Немає аукціонів</div>'}</div>`;
};
AFTER.market = tickUntil;
H.mTab = (d) => (state.marketTab = d.k, render());
H.mCls = (d) => (state.marketCls = d.k, render());
H.mSort = (d) => (state.marketSort = d.k, render());
H.buy = async (d) => (await confirmBox(`Купити за ${S.fmt(Number(d.price))}?`)) && act('market/buy', { id: Number(d.id) }, 'Авто вже у твоєму гаражі!');
H.unlist = (d) => act('market/cancel', { id: Number(d.id) }, 'Лот знято');
H.unauction = (d) => act('auction/cancel', { id: Number(d.id) }, 'Аукціон скасовано');
H.bid = (d) => sheet('Ставка', `<div class="small muted">Мінімум ${S.fmt(Number(d.min))}. Якщо тебе переб’ють — гроші повернуться.</div><input id="bidAmt" class="mt" inputmode="numeric" value="${d.min}"><button class="btn mt" data-act="placeBid" data-id="${d.id}">Поставити</button>`);
H.placeBid = async (d) => {
  if (await act('auction/bid', { id: Number(d.id), amount: num($('#bidAmt').value) }, 'Ставку прийнято')) closeModal();
};

// ---------- trades ----------
function tradeCard(t) {
  const mineGive = t.incoming ? t.get : t.give, mineGet = t.incoming ? t.give : t.get;
  const moneyGive = t.incoming ? t.getMoney : t.giveMoney, moneyGet = t.incoming ? t.giveMoney : t.getMoney;
  const side = (cars, money) => (cars.map((c) => (c.gone ? '<div class="small muted">авто більше недоступне</div>' : carRow(c))).join('') + (money ? `<div class="li"><b>${ic('cash')} ${S.fmt(money)}</b></div>` : '')) || '<div class="small muted" style="padding:8px 0">нічого</div>';
  const vg = mineGive.reduce((s, c) => s + (c.value || 0), 0) + moneyGive, vr = mineGet.reduce((s, c) => s + (c.value || 0), 0) + moneyGet;
  const st = { done: 'Завершено', declined: 'Відхилено', cancelled: 'Скасовано', invalid: 'Неактуальний' }[t.status];
  return `<div class="card"><div class="row between"><b>${t.incoming ? 'Від ' + esc(t.from.name) : 'Для ' + esc(t.to.name)}</b>${st ? `<span class="chip">${st}</span>` : ''}</div>
    <div class="col mt"><div class="trade-side"><h4>Ти віддаєш · ${S.short(vg)}</h4>${side(mineGive, moneyGive)}</div><div class="trade-side"><h4>Ти отримуєш · ${S.short(vr)}</h4>${side(mineGet, moneyGet)}</div></div>
    ${t.status === 'open' ? (t.incoming ? `<div class="btns mt"><button class="btn red" data-act="tradeDecline" data-id="${t.id}">Відхилити</button><button class="btn green" data-act="tradeAccept" data-id="${t.id}">Прийняти</button></div>` : `<button class="btn ghost mt" data-act="tradeCancel" data-id="${t.id}">Скасувати</button>`) : ''}</div>`;
}
// ---------- trade hall: open rooms, live chat, players online ----------
let livePoll = null;
function stopPoll() {
  clearInterval(livePoll);
  livePoll = null;
  clearBattleTimers();
}
const hhmm = (t) => new Date(t).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
const chatHtml = (list) => list.map((m) => (m.system ? `<div class="msg sys">${esc(m.text)}</div>`
  : `<div class="msg ${m.userId === me.id ? 'me' : ''}"><b>${esc(m.name)}</b>${esc(m.text)}<span class="t">${hhmm(m.at)}</span></div>`)).join('');
function appendChat(list) {
  const box = $('#chat');
  if (!box || !list.length) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.querySelector('.chat-empty')?.remove();
  box.insertAdjacentHTML('beforeend', chatHtml(list));
  if (atBottom || list.some((m) => m.userId === me.id)) box.scrollTop = box.scrollHeight;
}
const chatBlock = (list, act) => `<div class="card chatbox"><div class="chat" id="chat">${list.length ? chatHtml(list) : '<div class="chat-empty muted small center">Повідомлень ще немає — напиши першим</div>'}</div>
  <form class="row mt chatin" id="chatForm" data-send="${act}"><input id="chatText" maxlength="200" placeholder="Напиши повідомлення…" autocomplete="off"><button class="btn sm">${ic('arrow-right')}</button></form></div>`;
function bindChat() {
  const box = $('#chat');
  if (box) box.scrollTop = box.scrollHeight;
  $('#chatForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    H[e.currentTarget.dataset.send]();
  });
}
const miniCars = (models) => models.map((m) => `<span class="mini art">${carArt(m)}</span>`).join('');
function roomsHtml(h) {
  const list = [...h.rooms].sort((a, b) => b.invited - a.invited || b.mine - a.mine);
  if (!list.length) return '<div class="card empty">Відкритих кімнат зараз немає — створи свою!</div>';
  return `<div class="list">${list.map((r) => `<div class="li ${r.invited ? 'invited' : ''}"><div class="grow"><b>${esc(r.host.name)}</b> <span class="chip">рів. ${r.host.level}</span>${r.invited ? ' <span class="chip mine">запрошує тебе</span>' : ''}
      ${r.note ? `<div class="small">${esc(r.note)}</div>` : ''}${r.cars.length ? `<div class="row minis">${miniCars(r.cars)}</div>` : '<div class="tiny muted">гараж ' + S.short(r.host.value) + '</div>'}</div>
      ${r.mine ? `<button class="btn sm ghost" data-act="openRoom" data-id="${r.id}">Моя</button>` : `<button class="btn sm" data-act="roomJoin" data-id="${r.id}">Увійти</button>`}</div>`).join('')}</div>`;
}
const onlineHtml = (h) => (h.online.length ? `<div class="list">${h.online.map((u) => `<div class="li"><div class="grow"><b>${esc(u.name)}</b> <span class="chip">рів. ${u.level}</span><div class="tiny muted">гараж ${S.short(u.value)}</div></div>
    <button class="btn sm ghost" data-act="roomInvite" data-id="${u.id}">Запросити</button></div>`).join('')}</div>` : '<div class="card empty">Зараз більше нікого немає онлайн</div>');
function hallHtml(h) {
  return `${h.myRoom ? `<button class="card row between roomback" data-act="openRoom" data-id="${h.myRoom}"><div><b>${ic('arrows-exchange')} Ти в кімнаті обміну</b><div class="small muted">Натисни, щоб повернутися</div></div><span class="chev">›</span></button>`
    : `<div class="card"><b>Створи кімнату обміну</b><div class="small muted">Її побачать усі в Трейд-залі й зможуть зайти, щоб обмінятися з тобою наживо</div>
      <input id="roomNote" class="mt" maxlength="60" placeholder="Що шукаєш? Напр.: «міняю BMW на Supra»" autocomplete="off"><button class="btn mt" data-act="roomCreate">Створити кімнату</button></div>`}
    <div class="h2"><span>Відкриті кімнати</span></div><div id="hallRooms">${roomsHtml(h)}</div>
    <div class="h2"><span>Загальний чат</span></div>${chatBlock(h.chat, 'hallSend')}
    <div class="h2"><span>Гравці онлайн</span><span id="onlineN">${h.online.length}</span></div><div id="hallOnline">${onlineHtml(h)}</div>`;
}
PAGES.trades = async () => {
  const tab = state.tradesTab || 'hall';
  const seg = `<div class="seg">${[['hall', 'Трейд-зал'], ['offers', 'Пропозиції' + (me.incomingTrades ? ` · ${me.incomingTrades}` : '')]].map(([k, t]) => `<button class="${tab === k ? 'on' : ''}" data-act="tradesTab" data-k="${k}">${t}</button>`).join('')}</div>`;
  if (tab === 'hall') {
    const h = await api('hall', {});
    state.hallChatId = h.chat.at(-1)?.id || 0;
    state.hallMyRoom = h.myRoom;
    return seg + hallHtml(h);
  }
  return seg + (await offersHtml());
};
AFTER.trades = () => {
  if ((state.tradesTab || 'hall') !== 'hall') return;
  bindChat();
  livePoll = setInterval(async () => {
    if (document.hidden || state.page !== 'trades') return;
    try {
      const h = await api('hall', { since: state.hallChatId });
      if (state.page !== 'trades') return;
      if (h.myRoom !== state.hallMyRoom) return render();
      $('#hallRooms').innerHTML = roomsHtml(h);
      $('#hallOnline').innerHTML = onlineHtml(h);
      $('#onlineN').textContent = h.online.length;
      if (h.chat.length) state.hallChatId = h.chat.at(-1).id;
      appendChat(h.chat);
    } catch {}
  }, 2500);
};
H.tradesTab = (d) => (state.tradesTab = d.k, render());
H.hallSend = async () => {
  const inp = $('#chatText');
  const text = inp.value.trim();
  if (!text) return;
  try {
    await api('hall/chat', { text });
    inp.value = '';
    const h = await api('hall', { since: state.hallChatId });
    if (h.chat.length) state.hallChatId = h.chat.at(-1).id;
    appendChat(h.chat);
  } catch (e) {
    toast(e.message, true);
  }
};
async function enterRoom(name, body) {
  try {
    const r = await api(name, body);
    state.roomId = r.id;
    go('room');
    return r;
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}
H.roomCreate = () => enterRoom('room/create', { note: $('#roomNote')?.value.trim() || '' });
H.roomJoin = (d) => enterRoom('room/join', { id: Number(d.id) });
H.openRoom = (d) => {
  state.roomId = Number(d.id);
  go('room');
};
H.roomInvite = async (d) => {
  if (await enterRoom('room/invite', { to: Number(d.id) })) toast('Запрошення надіслано — чекай у кімнаті');
};

// ---------- one trade room ----------
function roomTopHtml(s) {
  if (s.status === 'done') return `<div class="card center"><div style="font-size:38px" class="win">${ic('check')}</div><b class="disp" style="font-size:20px">ОБМІН ЗАВЕРШЕНО</b><div class="small muted">Машини вже у ваших гаражах</div><button class="btn mt" data-act="toHall">До Трейд-залу</button></div>`;
  if (s.status === 'closed') return `<div class="card center"><b>Кімнату закрито</b><div class="small muted">Власник вийшов або довго не відповідав</div><button class="btn mt" data-act="toHall">До Трейд-залу</button></div>`;
  if (!s.partner) return `<div class="card center waiting"><div class="spinner"></div><b>Чекаємо на другого гравця…</b><div class="small muted">Кімнату видно всім у Трейд-залі${s.note ? ` з підписом «${esc(s.note)}»` : ''}. Можеш одразу додати авто — їх побачать ті, хто зайде.</div></div>`;
  return `<div class="card row between"><div><div class="small muted">Обмін з</div><b>${esc(s.partner.name)}</b> <span class="chip">рів. ${s.partner.level}</span></div><div class="small muted right">гараж<br><b style="color:var(--text)">${S.short(s.partner.value)}</b></div></div>`;
}
function sideHtml(side, mine) {
  const cars = side.cars.map((c) => (c.gone ? '<div class="li small muted">авто більше недоступне</div>'
    : carRow(c, mine && !side.ready ? `<button class="btn sm ghost" data-act="roomRemoveCar" data-id="${c.id}">${ic('x')}</button>` : (c.ok ? '' : '<span class="chip">недоступне</span>'))));
  return cars.join('') + (side.money ? `<div class="li"><b>${ic('cash')} ${S.fmt(side.money)}</b></div>` : '') || '<div class="small muted" style="padding:10px 0">поки нічого</div>';
}
const sideValue = (side) => side.cars.reduce((s, c) => s + (c.value || 0), 0) + side.money;
function roomOfferHtml(s) {
  if (s.status !== 'open' && s.status !== 'active') return '';
  const p = s.partner;
  const inOffer = new Set(s.me.cars.map((c) => c.id));
  const canAdd = me.cars.some((c) => c.status === 'garage' && !inOffer.has(c.id) && !M(c.model).secret);
  return `<div class="trade-side"><h4>Ти даєш · ${S.short(sideValue(s.me))}</h4>${sideHtml(s.me, true)}
      <div class="row mt" style="gap:6px"><button class="btn sm ghost" data-act="roomAddCar" ${canAdd ? '' : 'disabled'}>${ic('plus')} Авто</button>
      <input id="roomMoney" inputmode="numeric" placeholder="гривні" value="${s.me.money || ''}" style="flex:1;padding:8px 10px"><button class="btn sm ghost" data-act="roomMoney">OK</button></div></div>
    <div class="trade-side mt"><h4>Ти отримуєш · ${p ? S.short(sideValue(p)) : '—'}</h4>${p ? sideHtml(p, false) : '<div class="small muted" style="padding:10px 0">ще ніхто не зайшов</div>'}</div>
    ${p ? `<div class="row between mt small"><span>${esc(p.name)}:</span>${p.ready ? '<span class="chip ready">готовий ✓</span>' : '<span class="chip">думає…</span>'}</div>` : ''}
    <button class="btn ${s.me.ready ? 'green' : 'yellow'} mt" data-act="roomReady" ${p ? '' : 'disabled'}>${s.me.ready ? 'Готовий ✓ · скасувати' : 'Готовий до обміну'}</button>
    <div class="tiny muted center mt">Обмін відбудеться, щойно обидва натиснуть «Готовий». Будь-яка зміна пропозиції скидає готовність, тож підмінити авто в останню мить не вийде.</div>`;
}
const roomKey = (s) => JSON.stringify([s.status, s.version, s.me?.ready, s.partner?.id, s.partner?.ready]);
PAGES.room = async () => {
  const s = await api('room/state', { id: state.roomId });
  state.room = s;
  state.roomChatId = s.chat.at(-1)?.id || 0;
  const live = s.status === 'open' || s.status === 'active';
  return `<div id="roomTop">${roomTopHtml(s)}</div><div id="roomOffer">${roomOfferHtml(s)}</div>
    <div class="h2"><span>Чат кімнати</span></div>${live ? chatBlock(s.chat, 'roomSend') : `<div class="card chatbox"><div class="chat" id="chat">${chatHtml(s.chat)}</div></div>`}
    ${live ? `<button class="btn ghost mt" data-act="roomLeave">${s.host ? 'Закрити кімнату' : 'Вийти з кімнати'}</button>` : ''}`;
};
function paintRoom(s) {
  const changed = roomKey(s) !== roomKey(state.room);
  const wasDone = state.room.status !== 'done' && s.status === 'done';
  state.room = s;
  if (s.chat.length) state.roomChatId = s.chat.at(-1).id;
  appendChat(s.chat);
  if (!changed) return;
  if (wasDone || s.status === 'closed') {
    stopPoll();
    if (wasDone) {
      haptic('success');
      FX.confetti(['#f5b301', '#fff', '#2fbf71']);
    }
    return refresh(false).then(() => render());
  }
  // Keep whatever the player is typing in the money box across a repaint.
  const typing = document.activeElement?.id === 'roomMoney' ? $('#roomMoney').value : null;
  $('#roomTop').innerHTML = roomTopHtml(s);
  $('#roomOffer').innerHTML = roomOfferHtml(s);
  if (typing != null) {
    $('#roomMoney').value = typing;
    $('#roomMoney').focus();
  }
}
async function pollRoom() {
  try {
    const s = await api('room/state', { id: state.roomId, since: state.roomChatId });
    if (state.page === 'room') paintRoom(s);
  } catch {}
}
AFTER.room = () => {
  bindChat();
  if (state.room.status === 'open' || state.room.status === 'active') livePoll = setInterval(() => !document.hidden && state.page === 'room' && pollRoom(), 1500);
};
async function roomCall(name, body) {
  try {
    const r = await api(name, { id: state.roomId, ...body });
    if (r?.stale) toast(r.message, true);
    await pollRoom();
    return r;
  } catch (e) {
    toast(e.message, true);
    await pollRoom();
    return null;
  }
}
H.roomSend = async () => {
  const inp = $('#chatText');
  const text = inp.value.trim();
  if (!text) return;
  if (await roomCall('room/chat', { text })) inp.value = '';
};
H.roomAddCar = () => {
  const inOffer = new Set(state.room.me.cars.map((c) => c.id));
  pickCar('Яке авто додати в обмін?', (carId) => roomCall('room/offer', { add: carId }), (c) => c.status === 'garage' && !inOffer.has(c.id) && !M(c.model).secret);
};
H.roomRemoveCar = (d) => roomCall('room/offer', { remove: Number(d.id) });
H.roomMoney = () => roomCall('room/offer', { money: num($('#roomMoney').value) || 0 });
H.roomReady = async () => {
  const r = await roomCall('room/ready', { version: state.room.version, ready: !state.room.me.ready });
  if (r?.done) toast('Обмін завершено!');
};
H.roomLeave = async () => {
  if (!(await confirmBox(state.room.host ? 'Закрити кімнату?' : 'Вийти з кімнати?'))) return;
  await roomCall('room/leave', {});
  H.toHall();
};
H.toHall = () => {
  state.tradesTab = 'hall';
  go('trades');
};

// ---------- case battles ----------
let battleTimers = [];
const clearBattleTimers = () => (battleTimers.forEach(clearTimeout), (battleTimers = []));
const caseLabel = (id) => `${caseIcon(S.CASE_BY_ID[id])} ${esc(S.CASE_BY_ID[id].name)}`;
function battleRow(b) {
  const r = b.result;
  const verdict = b.status !== 'done' ? '' : !b.winnerId ? '<span class="chip">нічия</span>'
    : b.me ? (b.winnerId === me.id ? '<span class="chip ready">перемога</span>' : '<span class="chip lose">поразка</span>')
      : `<span class="chip">переміг ${esc((b.winnerId === b.creator.id ? b.creator : b.opponent).name)}</span>`;
  return `<button class="li" data-act="openBattle" data-id="${b.id}"><div class="grow"><b>${caseLabel(b.caseId)} ×${b.count}</b>
    <div class="small muted">${esc(b.creator.name)}${b.opponent ? ` vs ${esc(b.opponent.name)}` : ''}${r ? ` · ${S.short(r.creator.total)} : ${S.short(r.opponent.total)}` : ''}</div></div>${verdict}</button>`;
}
// The battle form starts on the dearest case the player can afford three of (not on a case they can't pay for).
const battleDefaultCase = () => [...S.CASES].filter((c) => !c.starter && c.group === 'rarity' && c.price * 3 <= me.balance).sort((a, b) => b.price - a.price)[0]?.id || 'rust';
PAGES.battles = async () => {
  const L = await api('battle/list');
  state.battleOpenMine = L.open.filter((b) => b.mine).map((b) => b.id);
  const cases = S.CASES.filter((c) => !c.starter);
  state.bCase ||= battleDefaultCase();
  const cs = S.CASE_BY_ID[state.bCase];
  const n = state.bCount || 3;
  const short = cs.price * n - me.balance;
  return `<div class="card"><b class="disp" style="font-size:18px">${ic('flame')} НОВИЙ БАТЛ</b>
      <div class="small muted">Ти і суперник відкриваєте однакові кейси. У кого машини дорожчі — забирає <b>усі</b> авто з обох боків. Той, хто програв, отримує дешеву утішну машину.</div>
      <select id="bCase" class="mt">${cases.map((c) => `<option value="${c.id}" ${c.id === cs.id ? 'selected' : ''}>${esc(c.name)} — ${S.short(c.price)}</option>`).join('')}</select>
      <div class="seg mt">${[1, 3, 6, 10].map((k) => `<button class="${k === n ? 'on' : ''}" data-act="bCount" data-n="${k}">×${k}</button>`).join('')}</div>
      ${short > 0 ? `<button class="btn" disabled>Недостатньо коштів · бракує ${S.fmt(short)}</button>` : `<button class="btn yellow" data-act="battleCreate">Створити батл · ${S.fmt(cs.price * n)}</button>`}
      <div class="tiny muted center mt">Гроші знімаються одразу, скасувати можна, поки ніхто не зайшов. Якщо після перемоги не вистачить місць у гаражі — сам обереш, які машини продати.</div></div>
    <div class="h2"><span>Чекають суперника</span><span id="bOpenN">${L.open.length}</span></div>
    <div id="bOpen">${battleOpenHtml(L.open)}</div>
    ${L.mine.length ? `<div class="h2"><span>Мої батли</span></div><div class="list">${L.mine.map(battleRow).join('')}</div>` : ''}
    ${L.recent.length ? `<div class="h2"><span>Останні батли</span></div><div class="list">${L.recent.map(battleRow).join('')}</div>` : ''}`;
};
const battleOpenHtml = (open) => (open.length ? `<div class="list">${open.map((b) => `<div class="li"><div class="grow"><b>${caseLabel(b.caseId)} ×${b.count}</b>
    <div class="small muted">${esc(b.creator.name)} · рів. ${b.creator.level}</div></div>
    ${b.mine ? `<button class="btn sm ghost" data-act="battleCancel" data-id="${b.id}">Скасувати</button>`
      : `<button class="btn sm yellow" data-act="battleJoin" data-id="${b.id}" data-price="${b.price}" ${me.balance < b.price ? 'disabled' : ''}>Битись · ${S.short(b.price)}</button>`}</div>`).join('')}</div>`
  : '<div class="card empty">Відкритих батлів немає — створи свій!</div>');
AFTER.battles = () => {
  $('#bCase').addEventListener('change', (e) => (state.bCase = e.target.value, render()));
  livePoll = setInterval(async () => {
    if (document.hidden || state.page !== 'battles') return;
    try {
      const L = await api('battle/list');
      if (state.page !== 'battles') return;
      // Someone joined my battle: jump straight to the show.
      const started = (state.battleOpenMine || []).find((id) => !L.open.some((b) => b.id === id) && L.mine.some((b) => b.id === id));
      if (started) return openBattle(started, true);
      state.battleOpenMine = L.open.filter((b) => b.mine).map((b) => b.id);
      $('#bOpen').innerHTML = battleOpenHtml(L.open);
      $('#bOpenN').textContent = L.open.length;
    } catch {}
  }, 3000);
};
H.bCount = (d) => (state.bCount = Number(d.n), render());
H.battleCreate = async () => {
  const cs = S.CASE_BY_ID[state.bCase || 'rust'], n = state.bCount || 3;
  if (!(await confirmBox(`Створити батл: ${cs.name} ×${n} за ${S.fmt(cs.price * n)}?`))) return;
  try {
    const { id } = await api('battle/create', { caseId: cs.id, count: n });
    await refresh(false);
    openBattle(id, true);
  } catch (e) {
    toast(e.message, true);
  }
};
H.battleCancel = async (d) => {
  if (await act('battle/cancel', { id: Number(d.id) }, 'Батл скасовано, гроші повернуто', { rerender: false })) render();
};
H.battleJoin = async (d) => {
  if (!(await confirmBox(`Битись за ${S.fmt(Number(d.price))}?`))) return;
  try {
    const b = await api('battle/join', { id: Number(d.id) });
    state.battle = b;
    state.battleAnim = true;
    go('battle');
  } catch (e) {
    toast(e.message, true);
  }
};
H.openBattle = (d) => openBattle(Number(d.id), false);
function openBattle(id, anim) {
  state.battle = { id };
  state.battleAnim = anim;
  go('battle');
}
function dropCard(d, hidden) {
  const m = M(d.model);
  return `<div class="car bdrop r${S.rankOf(m.cls)} ${hidden ? 'hid' : ''}" style="--c:${S.CLASSES[m.cls].color}">${clsBadge(m.cls, 'tl')}<div class="art">${carArt(d.model)}</div>
    <div class="nm ellipsis">${esc(m.name)}</div><div class="meta"><b>${S.short(d.value)}</b></div><div class="q">?</div></div>`;
}
PAGES.battle = async () => {
  clearBattleTimers();
  const b = (state.battle = await api('battle/get', { id: state.battle.id }));
  if (b.status === 'open') {
    return `<div class="card center waiting"><div class="spinner"></div><b>Чекаємо суперника…</b>
      <div class="small muted">${caseLabel(b.caseId)} ×${b.count} · банк ${S.short(b.price * 2)}. Батл видно всім у «Кейс-батлах». Щойно хтось зайде — почнеться відкриття.</div>
      ${b.mine ? `<button class="btn ghost mt" data-act="battleCancel" data-id="${b.id}">Скасувати й повернути гроші</button>` : ''}</div>`;
  }
  if (b.status !== 'done') return '<div class="card center">Батл скасовано</div><button class="btn mt" data-act="go" data-page="battles">До батлів</button>';
  const r = b.result, hide = state.battleAnim;
  const head = (p, tot, id) => `<div class="bhead ${!hide && b.winnerId === p.id ? 'won' : ''}" id="bh${id}"><b class="ellipsis">${esc(p.name)}${p.id === me.id ? ' (ти)' : ''}</b><span class="disp" id="tot${id}">${hide ? '0' : S.short(tot)}</span></div>`;
  // The car each card turned into for me (prize if I won, my own drops on a tie) — to offer selling it right here.
  const mine = (side, i) => {
    const list = b.winnerId === me.id ? r.prize || [] : !b.winnerId ? (side === 'creator' ? r.creator : r.opponent).cars || [] : [];
    const car = b.winnerId === me.id ? list[side === 'creator' ? i : r.creator.drops.length + i] : (side === 'creator') === (b.creator.id === me.id) ? list[i] : null;
    return car && me.cars.some((c) => c.id === car.id && c.status === 'garage') ? car : null;
  };
  const cell = (d, side, i) => {
    const car = !hide && mine(side, i);
    return `<div class="bcell">${dropCard(d, hide)}${car ? `<button class="dropsell" data-act="battleSell" data-id="${car.id}">${ic('cash')}${S.short(sellPrice(car.model))}</button>` : ''}</div>`;
  };
  return `<div class="small muted center">${caseLabel(b.caseId)} ×${b.count} · банк ${S.short(b.price * 2)}</div>
    <div class="bgrid mt">${head(b.creator, r.creator.total, 'A')}${head(b.opponent, r.opponent.total, 'B')}
      ${r.creator.drops.map((d, i) => cell(d, 'creator', i) + cell(r.opponent.drops[i], 'opponent', i)).join('')}</div>
    <div id="bResult" ${hide ? 'hidden' : ''}>${battleVerdict(b)}</div>
    ${hide ? '<div class="countdown" id="countdown"></div>' : ''}`;
};
function battleVerdict(b) {
  const r = b.result;
  const total = r.creator.total + r.opponent.total;
  const winner = b.winnerId === b.creator.id ? b.creator : b.opponent;
  let html;
  if (!b.winnerId) html = '<b class="disp" style="font-size:22px">НІЧИЯ</b><div class="small muted">Кожен забрав свої авто</div>';
  else if (b.winnerId === me.id) html = `<b class="disp win" style="font-size:24px">ПЕРЕМОГА!</b><div class="small">Ти забираєш усі ${b.count * 2} авто на ${S.fmt(total)}</div>${r.sold ? `<div class="tiny muted mt">${r.sold} авто не влізли в гараж — продано за ${S.fmt(r.soldFor)}</div>` : ''}
    <div class="tiny muted mt">Непотрібні машини можна продати кнопками під ними.</div>`;
  else if (b.me) html = `<b class="disp lose" style="font-size:24px">ПОРАЗКА</b><div class="small muted">Утішний приз:</div>
    <div class="grid mt" style="grid-template-columns:1fr;max-width:190px;margin:8px auto 0">${carTile({ id: 0, model: r.consolation.model, parts: {}, hp: M(r.consolation.model).hp, value: M(r.consolation.model).price, status: 'garage' }, { act: 'none' })}</div>
    ${r.consolation.soldFor ? `<div class="tiny muted">Гараж повний — продано за ${S.fmt(r.consolation.soldFor)}</div>` : ''}`;
  else html = `<b class="disp" style="font-size:20px">Переміг ${esc(winner.name)}</b><div class="small muted">${S.fmt(total)} у банку</div>`;
  return `${overfullHtml()}<div class="card center mt">${html}<button class="btn mt" data-act="go" data-page="battles">До батлів</button></div>`;
}
// Garage over its limit (battle prize, auction, reward): say how many to sell and offer to sell the cheapest extras.
function overfullHtml() {
  const used = me.cars.filter((c) => c.status !== 'showcase').length;
  const extra = used - me.slots;
  if (extra <= 0) return '';
  const cheapest = me.cars.filter((c) => c.status === 'garage' && !M(c.model).secret).sort((a, b) => a.value - b.value).slice(0, extra);
  const sum = cheapest.reduce((s, c) => s + sellPrice(c.model), 0);
  return `<div class="card warnbox mt"><b>${ic('info-circle')} Гараж переповнений: ${used}/${me.slots}</b>
    <div class="small">Продай ${extra} ${extra === 1 ? 'машину' : extra < 5 ? 'машини' : 'машин'} або купи місце. Поки що дохід приносять лише ${me.slots} найкращих, а нові кейси відкрити не можна.</div>
    ${cheapest.length === extra ? `<button class="btn sm ghost mt" data-act="sellExtras" data-ids="${cheapest.map((c) => c.id).join(',')}">${ic('cash')} Продати ${extra} найдешевших · ${S.short(sum)}</button>` : ''}</div>`;
}
H.battleSell = async (d, el) => {
  if (!armed(el, 'Точно?')) return;
  if (await act('sell', { carIds: [Number(d.id)] }, (r) => `Продано: +${S.fmt(r.got)}`, { rerender: false })) render();
};
H.sellExtras = async (d, el) => {
  if (!armed(el, 'Точно продати?')) return;
  if (await act('sell', { carIds: d.ids.split(',').map(Number) }, (r) => `Продано: +${S.fmt(r.got)}`, { rerender: false })) render();
};
AFTER.battle = () => {
  const b = state.battle;
  if (b.status === 'open') {
    livePoll = setInterval(async () => {
      if (document.hidden || state.page !== 'battle') return;
      try {
        const fresh = await api('battle/get', { id: b.id });
        if (fresh.status !== 'open' && state.page === 'battle') {
          state.battleAnim = fresh.status === 'done';
          render();
        }
      } catch {}
    }, 2000);
    return;
  }
  if (b.status !== 'done' || !state.battleAnim) return;
  state.battleAnim = false;
  // 3-2-1, then the cases open row by row with running totals.
  const r = b.result, cd = $('#countdown');
  [3, 2, 1].forEach((n, i) => battleTimers.push(setTimeout(() => {
    cd.textContent = n;
    cd.classList.remove('go');
    void cd.offsetWidth;
    cd.classList.add('go');
    haptic('light');
  }, i * 900)));
  const cards = [...document.querySelectorAll('.bgrid .bdrop')];
  let ta = 0, tb = 0;
  const step = 750, start = 2900;
  battleTimers.push(setTimeout(() => cd.remove(), start - 100));
  r.creator.drops.forEach((d, i) => battleTimers.push(setTimeout(() => {
    ta += d.value;
    tb += r.opponent.drops[i].value;
    for (const el of [cards[i * 2], cards[i * 2 + 1]]) el.classList.replace('hid', 'flip-in');
    $('#totA').textContent = S.short(ta);
    $('#totB').textContent = S.short(tb);
    const best = Math.max(S.rankOf(M(d.model).cls), S.rankOf(M(r.opponent.drops[i].model).cls));
    haptic(best >= 2 ? 'medium' : 'light');
    if (best >= 3) {
      const el = S.rankOf(M(d.model).cls) >= 3 ? cards[i * 2] : cards[i * 2 + 1];
      const [x, y] = FX.centerOf(el);
      FX.burst(x, y, [S.CLASSES[S.CLASS_ORDER[best]].color, '#fff'], { count: 40, power: 6 });
    }
  }, start + i * step)));
  battleTimers.push(setTimeout(() => {
    if (b.winnerId) $(b.winnerId === b.creator.id ? '#bhA' : '#bhB').classList.add('won');
    $('#bResult').hidden = false;
    $('#bResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (b.winnerId === me.id) {
      haptic('success');
      FX.confetti(['#f5b301', '#fff', '#2fbf71']);
    } else if (b.me && b.winnerId) haptic('error');
    // Repaint in the final state so the "sell" buttons under the won cars appear.
    battleTimers.push(setTimeout(() => refresh(false).then(() => state.page === 'battle' && render()).then(() => $('#bResult')?.scrollIntoView({ block: 'center' })), 1200));
  }, start + r.creator.drops.length * step + 300));
};

async function offersHtml() {
  const { open, past } = await api('trade/list');
  const inc = open.filter((t) => t.incoming), out = open.filter((t) => !t.incoming);
  return `<button class="btn" data-act="tradeNew">+ Новий обмін за ID</button>
    <div class="tiny muted center mt">Машини переходять разом з деталями й номером. Перед підтвердженням усе перевіряється ще раз.</div>
    <div class="h2"><span>Вхідні ${inc.length || ''}</span></div>${inc.length ? inc.map(tradeCard).join('') : '<div class="card empty">Немає вхідних пропозицій</div>'}
    <div class="h2"><span>Мої пропозиції</span></div>${out.length ? out.map(tradeCard).join('') : '<div class="card empty">Немає</div>'}
    ${past.length ? `<div class="h2"><span>Історія</span></div>${past.map(tradeCard).join('')}` : ''}`;
}
H.tradeNew = () => {
  state.trade = { partner: null, give: new Set(), get: new Set() };
  go('tradeNew');
};
H.tradeAccept = async (d) => (await confirmBox('Прийняти обмін?')) && act('trade/accept', { id: Number(d.id) }, 'Обмін завершено!');
H.tradeDecline = (d) => act('trade/decline', { id: Number(d.id) }, 'Відхилено');
H.tradeCancel = (d) => act('trade/cancel', { id: Number(d.id) }, 'Скасовано');
PAGES.tradeNew = () => {
  const t = state.trade || (state.trade = { partner: null, give: new Set(), get: new Set() });
  if (!t.partner) return `<div class="card"><b>З ким обмінюємось?</b><div class="small muted">ID гравця (є в «Меню») або @username</div><input id="partner" class="mt" placeholder="123456789 або @username" autocomplete="off"><button class="btn mt" data-act="findPartner">Знайти</button></div>`;
  const p = t.partner;
  const mine = me.cars.filter((c) => c.status === 'garage' && !M(c.model).secret);
  const vg = mine.filter((c) => t.give.has(c.id)).reduce((s, c) => s + c.value, 0);
  const vr = p.cars.filter((c) => t.get.has(c.id)).reduce((s, c) => s + c.value, 0);
  return `<div class="card row between"><div><b>${esc(p.name)}</b><div class="small muted">рівень ${p.level} · гараж ${S.short(p.value)}</div></div><button class="btn sm ghost" data-act="resetPartner">Змінити</button></div>
    <div class="h2"><span>Ти віддаєш</span><span>${S.short(vg)}</span></div>
    <div class="grid">${mine.map((c) => carTile(c, { sel: t.give.has(c.id), act: 'tgGive' })).join('')}</div>
    <input id="giveMoney" class="mt" inputmode="numeric" placeholder="+ гривні від тебе" value="${t.giveMoney || ''}">
    <div class="h2"><span>Ти отримуєш</span><span>${S.short(vr)}</span></div>
    ${p.cars.length ? `<div class="grid">${p.cars.map((c) => carTile(c, { sel: t.get.has(c.id), act: 'tgGet' })).join('')}</div>` : '<div class="card empty">У гравця немає вільних авто</div>'}
    <input id="getMoney" class="mt" inputmode="numeric" placeholder="+ гривні від гравця" value="${t.getMoney || ''}">
    <button class="btn yellow mt" data-act="sendTrade">Надіслати пропозицію</button>`;
};
const keepMoney = () => {
  if ($('#giveMoney')) state.trade.giveMoney = $('#giveMoney').value;
  if ($('#getMoney')) state.trade.getMoney = $('#getMoney').value;
};
H.findPartner = async () => {
  try {
    const p = await api('player', { query: $('#partner').value });
    if (p.self) return toast('Це ти :)', true);
    state.trade.partner = p;
    render();
  } catch (e) {
    toast(e.message, true);
  }
};
H.resetPartner = () => (state.trade = null, render());
const toggleIn = (set, id) => (set.has(id) ? set.delete(id) : set.size < 10 && set.add(id));
H.tgGive = (d) => (keepMoney(), toggleIn(state.trade.give, Number(d.id)), render());
H.tgGet = (d) => (keepMoney(), toggleIn(state.trade.get, Number(d.id)), render());
H.sendTrade = async () => {
  keepMoney();
  const t = state.trade;
  if (await act('trade/create', { to: String(t.partner.id), give: [...t.give], get: [...t.get], giveMoney: num(t.giveMoney) || 0, getMoney: num(t.getMoney) || 0 }, 'Пропозицію надіслано')) {
    state.trade = null;
    go('trades');
  }
};

// ---------- quests ----------
PAGES.quests = async () => {
  const { list } = await api('quests');
  const n = me.newbie;
  return `${n ? `<div class="h2"><span>Завдання новачка</span><span>${n.step + 1}/${n.total}</span></div>
    <div class="card row"><div class="grow"><b>${esc(n.text)}</b><div class="small muted">+${S.fmt(n.money)} · +${S.XP.task} досвіду</div></div><button class="btn sm" data-act="newbieQuest" ${n.ready ? '' : 'disabled'}>${n.ready ? 'Забрати' : 'Виконай'}</button></div>` : ''}
    <div class="h2"><span>На сьогодні</span><span>оновлюються опівночі</span></div>
    ${list.map((x) => `<div class="card"><div class="row between"><b>${esc(x.text)}</b><span class="small muted">${x.progress}/${x.target}</span></div><div class="progress mt"><i style="width:${(x.progress / x.target) * 100}%"></i></div>
      <div class="row between mt"><span class="small">${ic('gift')} ${S.fmt(x.reward)} · +${S.XP.quest} досвіду</span>${x.claimed ? '<span class="chip">Отримано</span>' : `<button class="btn sm" data-act="questClaim" data-k="${x.key}" ${x.progress < x.target ? 'disabled' : ''}>Забрати</button>`}</div></div>`).join('')}`;
};
H.newbieQuest = () => act('newbie/claim', {}, (r) => `+${S.fmt(r.got)}`);
H.questClaim = (d) => act('quests/claim', { key: d.k }, (r) => `+${S.fmt(r.got)}`);

// ---------- season & pass ----------
const vipChip = () => `<span class="chip vipchip">${ic('crown')} VIP</span>`;
const BADGE_COLORS = ['#8e8e93', '#5ac8fa', '#c4c9d2', '#f5b301'];
const badgeChip = (b) => `<span class="chip" style="color:${BADGE_COLORS[b.tier] || '#8e8e93'};border-color:currentColor">${ic('trophy')} ${esc(b.title)}</span>`;
function seasonCard() {
  const s = me.season;
  if (!s) return '';
  const pct = s.need ? (s.levelXp / s.need) * 100 : 100;
  return `<button class="card season-card" data-act="go" data-page="season">
    <div class="row between"><b class="disp" style="font-size:17px">${ic('ticket')} Пропуск · Сезон ${s.id}</b><span class="chip">${s.level}/${S.SEASON.levels}</span></div>
    <div class="progress gold mt"><i style="width:${pct}%"></i></div>
    <div class="row between mt small"><span class="muted">${s.ready ? `<b style="color:var(--accent)">Нагород до забору: ${s.ready}</b>` : `до кінця сезону <span data-until="${s.endsAt - clockOffset}"></span>`}</span>${s.premium ? `<span style="color:var(--accent)">${ic('crown')} Преміум</span>` : '<span class="muted">Преміум</span>'}</div></button>`;
}
const passCell = (rw, state) => {
  const icon = rw.seasonCar ? 'car-turbine' : rw.caseId ? 'gift' : rw.parts ? 'tool' : 'coin';
  const label = rw.seasonCar ? 'Машина сезону' : rewardText(rw);
  return `<div class="pcell ${state}">${state === 'lock' ? ic('lock') : ic(icon)}<span>${esc(label)}</span></div>`;
};
PAGES.season = async () => {
  const s = await api('season');
  const car = s.car && M(s.car);
  const row = (l) => {
    const reached = s.level >= l.level;
    const st = (tr) => (s.claimed.includes(`pass:${s.id}:${l.level}:${tr}`) ? 'done' : reached ? (tr === 'p' && !s.premium ? 'lock' : 'ready') : tr === 'p' && !s.premium ? 'lock' : 'future');
    return `<div class="prow ${reached ? 'reached' : ''} ${l.level === s.level ? 'cur' : ''}"><span class="plvl">${l.level}</span>${passCell(l.free, st('f'))}${passCell(l.premium, st('p'))}</div>`;
  };
  return `<div class="card"><div class="row between"><b class="disp" style="font-size:18px">Сезон ${s.id}</b><span class="small muted">до кінця <span data-until="${s.endsAt - clockOffset}"></span></span></div>
      <div class="row between mt"><span>Рівень <b>${s.level}</b> з ${S.SEASON.levels}</span><span class="small muted">${s.need ? `${s.levelXp} / ${s.need} досвіду` : 'максимум'}</span></div>
      <div class="progress gold mt"><i style="width:${s.need ? (s.levelXp / s.need) * 100 : 100}%"></i></div>
      <div class="tiny muted mt">Досвід сезону — той самий, що й завжди: гонки (перемоги більше), кейси, завдання, бонуси. Нічого не скидається, крім пропуску.</div>
      ${s.ready ? `<button class="btn yellow mt" data-act="passClaim">${ic('gift')} Забрати нагороди · ${s.ready}</button>` : ''}</div>
    ${car ? `<div class="card center season-car"><div class="small muted">Рівень ${S.SEASON.levels} · преміум</div><div class="art" style="height:110px">${carArt(car.id, { glow: true })}</div><b style="font-size:17px">${esc(car.name)}</b>
      <div class="small muted">${car.hp} к.с. · ${S.short(car.price)} · лише в цьому сезоні</div>
      ${s.premium ? `<div class="mt" style="color:var(--accent)">${ic('crown')} Преміум активний</div>` : `<button class="btn yellow mt" data-act="buyItem" data-id="pass">${ic('crown')} Преміум · ${ic('star')} ${S.SEASON.premiumStars}</button><div class="tiny muted mt">Нагороди правої доріжки за вже пройдені рівні — одразу після покупки</div>`}</div>` : ''}
    <div class="prow head"><span class="plvl">#</span><span>Безкоштовно</span><span>${ic('crown')} Преміум</span></div>
    <div class="ptable">${s.levels.map(row).join('')}</div>`;
};
AFTER.season = tickUntil;
H.passClaim = async () => {
  const r = await act('season/claim', {}, (r) => `Нагород: ${r.got.length}${r.money ? ` · +${S.short(r.money)}` : ''}`, { rerender: false });
  if (r) {
    const car = r.got.find((g) => g.carOut);
    await refresh();
    if (car) openRewards({ title: 'Машина сезону!', text: M(car.carOut.model).name, car: car.carOut });
  }
};

// ---------- what's new (shown once per S.WHATS_NEW.id) ----------
function whatsNew(force = false) {
  const key = 'avtodrop-story-' + S.WHATS_NEW.id;
  try {
    if (!force && localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    if (!force) return;
  }
  let i = 0;
  const slides = S.WHATS_NEW.slides;
  const el = document.createElement('div');
  el.className = 'story';
  const paint = () => {
    const sl = slides[i];
    el.innerHTML = `<div class="story-bars">${slides.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('')}</div>
      <button class="story-skip">Пропустити</button>
      <div class="story-body"><div class="story-ic">${ic(sl.icon)}</div><div class="story-title disp">${esc(sl.title)}</div><div class="story-text">${esc(sl.text)}</div></div>
      <button class="btn yellow story-next">${i < slides.length - 1 ? 'Далі' : 'Поїхали!'}</button>`;
  };
  const close = () => el.remove();
  el.addEventListener('click', (e) => {
    if (e.target.closest('.story-skip')) return close();
    if (e.target.closest('.story-next') || e.clientX > window.innerWidth / 3) {
      if (++i >= slides.length) return close();
    } else if (i > 0) i--;
    paint();
  });
  paint();
  document.body.appendChild(el);
}

// ---------- leaderboard ----------
PAGES.leaderboard = async () => {
  state.lbType = state.lbType || 'season';
  const lb = await api('leaderboard', { type: state.lbType });
  const segs = `<div class="seg">${[['season', 'Сезон'], ['week', 'Тиждень'], ['all', 'Весь час']].map(([k, t]) => `<button class="${state.lbType === k ? 'on' : ''}" data-act="lbType" data-k="${k}">${t}</button>`).join('')}</div>`;
  if (lb.type === 'season') {
    const p = lb.prizes;
    return `${segs}<div class="card"><div class="row between"><b>Сезон ${lb.season}</b><span class="small muted">до кінця <span data-until="${lb.endsAt - clockOffset}"></span></span></div>
      <div class="tiny muted">Місце — за досвідом сезону: гонки, кейси, завдання. Донат тут не вирішує. Наприкінці сезону топ-10 отримує зірки на рахунок, топ-${lb.badgeTop} — значок назавжди.</div>
      <div class="prizes"><div><span class="medal m1">1</span>${ic('star')} ${p[0]}</div><div><span class="medal m2">2</span>${ic('star')} ${p[1]}</div><div><span class="medal m3">3</span>${ic('star')} ${p[2]}</div><div><span>${ic('trophy')}</span>4–10: ${ic('star')} ${p[3]}</div></div></div>
      <div class="list">${lb.list.length ? lb.list.map((r) => `<button class="lb ${r.me ? 'me' : ''}" data-act="playerCard" data-id="${r.id}"><span class="pl">${r.place <= 3 ? `<span class="medal m${r.place}">${r.place}</span>` : r.place}</span><span class="grow ellipsis">${esc(r.name)}${r.vip ? ` <span style="color:var(--accent)">${ic('crown')}</span>` : ''}</span><span class="chip">рів. ${r.level}</span><b>${r.score.toLocaleString('uk-UA')}</b></button>`).join('') : '<div class="empty">Сезон щойно почався — будь першим</div>'}</div>
      <div class="mybar"><span>Ти: #${lb.me.place}</span><span class="grow"></span><span>${lb.me.score.toLocaleString('uk-UA')} досвіду</span></div>`;
  }
  const week = lb.type === 'week';
  return `${segs}
    ${week ? `<div class="card"><div class="row between"><b>Гонка тижня</b><span class="small muted">до кінця <span data-until="${lb.endsAt - clockOffset}"></span></span></div>
      <div class="tiny muted">Місце — за тим, наскільки виросла вартість твого гаража з понеділка</div>
      <div class="prizes"><div><span class="medal m1">1</span>${S.short(lb.prizes[0])}</div><div><span class="medal m2">2</span>${S.short(lb.prizes[1])}</div><div><span class="medal m3">3</span>${S.short(lb.prizes[2])}</div><div><span>${ic('trophy')}</span>4–10: ${S.short(lb.prizes[3])}</div></div></div>`
      : '<div class="tiny muted" style="margin:0 2px 10px">Вартість гаража: машини з деталями й номерами, вітрина та номери</div>'}
    <div class="list">${lb.list.length ? lb.list.map((r) => `<button class="lb ${r.me ? 'me' : ''}" data-act="playerCard" data-id="${r.id}"><span class="pl">${r.place <= 3 ? `<span class="medal m${r.place}">${r.place}</span>` : r.place}</span><span class="grow ellipsis">${esc(r.name)}</span><b>${week ? '+' : ''}${S.short(r.score)}</b></button>`).join('') : '<div class="empty">Поки порожньо</div>'}</div>
    <div class="mybar"><span>Ти: #${lb.me.place}</span><span class="grow"></span><span>${week ? '+' : ''}${S.short(lb.me.score)}</span></div>`;
};
AFTER.leaderboard = tickUntil;
H.lbType = (d) => (state.lbType = d.k, render());
H.playerCard = async (d, el, e, showcase) => {
  let p;
  try {
    p = await api('player', { id: Number(d.id) });
  } catch (err) {
    return toast(err.message, true);
  }
  if (showcase) return sheet(`Вітрина ${esc(p.name)}`, p.showcase.length ? `<div class="grid">${p.showcase.map((c) => carTile(c, { act: 'noop' })).join('')}</div>` : '<div class="empty">Вітрина порожня</div>', () => H.playerCard(d));
  const b = p.best;
  sheet(esc(p.name), `${p.vip || p.badges?.length ? `<div class="row center" style="justify-content:center;flex-wrap:wrap;gap:6px;margin-bottom:8px">${p.vip ? vipChip() : ''}${(p.badges || []).map(badgeChip).join('')}</div>` : ''}${b ? `<div class="hero"><div class="art">${carArt(b.model, { glow: true })}</div>${b.plate ? `<div class="plate-on">${plate(b.plate.text)}</div>` : ''}</div>
    <div class="center"><b style="font-size:18px">${esc(M(b.model).name)}</b> ${clsBadge(M(b.model).cls)}<div class="small muted">Найкраща машина · ${S.short(b.value)}</div></div>` : ''}
    <div class="stat mt"><div><b>${S.short(p.value)}</b><span>гараж</span></div><div><b>${p.carCount}</b><span>машин</span></div><div><b>${p.collection}</b><span>у колекції</span></div></div>
    <button class="btn mt" data-act="playerShowcase" data-id="${p.id}">${ic('building-arch')} Вітрина · ${p.showcase.length}</button>
    ${p.self ? '' : `<button class="btn ghost mt" data-act="tradeWith" data-id="${p.id}">${ic('arrows-exchange')} Запропонувати обмін</button>`}`);
};
H.playerShowcase = (d) => H.playerCard(d, null, null, true);
H.noop = () => {};
H.tradeWith = async (d) => {
  const p = await api('player', { id: Number(d.id) });
  state.trade = { partner: p, give: new Set(), get: new Set() };
  state.tab = 'menu';
  go('tradeNew');
};

// ---------- upgrade ----------
state.up = { cars: new Set(), target: null, spinning: false, result: null, angle: 0 };
function upStake() {
  return me.cars.filter((c) => c.status === 'garage' && state.up.cars.has(c.id)).reduce((s, c) => s + M(c.model).price, 0);
}
function upCandidates(stake) {
  if (!stake) return [];
  return S.ALL_MODELS.filter((m) => !m.secret && m.price >= stake * S.UPGRADE.minMult && m.price <= stake * S.UPGRADE.maxMult).sort((a, b) => a.price - b.price);
}
PAGES.upgrade = () => {
  const U = state.up;
  // Most expensive first, both for your cars and for the targets.
  // Sorted by the value shown on the card (model + parts + plate), so the order always matches what you see.
  const garage = me.cars.filter((c) => c.status === 'garage').sort((a, b) => b.value - a.value || b.id - a.id);
  for (const id of [...U.cars]) if (!garage.some((c) => c.id === id)) U.cars.delete(id);
  const stake = upStake();
  const list = upCandidates(stake);
  if (U.target && !list.some((m) => m.id === U.target) && !U.result) U.target = null;
  const t = U.target ? M(U.target) : null;
  const r = U.result;
  // After a spin keep showing the chance that was played, so you can see where the needle landed.
  const chance = r && !stake ? r.chance : t && stake ? S.upgradeChance(stake, t.price, state.up.cars.size) : 0;
  const C = 2 * Math.PI * 100;
  const center = r ? (r.win ? `<div class="art">${carArt(r.target, { glow: true })}</div><b class="win" style="font-size:18px">ВИГРАШ</b>` : `<b class="lose" style="font-size:26px">${ic('flame')}</b><span class="small lose">Не пощастило</span>`)
    : t ? `<b>${pct(chance * 100)}</b><span class="tiny muted">шанс</span>` : '<span class="small muted">Обери авто<br>і ціль</span>';
  const chosen = garage.filter((c) => U.cars.has(c.id));
  return `<div class="gauge"><svg viewBox="0 0 220 220"><circle cx="110" cy="110" r="100" fill="none" stroke="#3a1218" stroke-width="14"/>
      <circle cx="110" cy="110" r="100" fill="none" stroke="#22c55e" stroke-width="14" stroke-dasharray="${C * chance} ${C}" transform="rotate(-90 110 110)" style="filter:drop-shadow(0 0 6px #22c55e)"/></svg>
      <div class="needle" id="upNeedle" style="transform:rotate(${U.angle}deg)"></div><div class="center">${center}</div></div>
    <div class="up-pair mt">
      <div class="side">${chosen.length ? `<div class="art">${carArt(chosen[0].model)}</div><div class="tiny ellipsis">${chosen.length > 1 ? `${chosen.length} авто` : esc(M(chosen[0].model).name)}</div><b class="small">${S.short(stake)}</b>` : '<div class="small muted" style="padding-top:28px">Твої авто</div>'}</div>
      <div style="font-size:22px">➜</div>
      <div class="side">${t ? `<div class="art">${carArt(t.id)}</div><div class="tiny ellipsis">${esc(t.name)}</div><b class="small">${S.short(t.price)}</b>` : '<div class="small muted" style="padding-top:28px">Ціль</div>'}</div></div>
    ${stake ? `<div class="chips mt">${[1.5, 2, 3, 5, 10, 20].map((k) => `<button data-act="upMult" data-k="${k}">×${k}</button>`).join('')}</div>` : ''}
    <button class="btn yellow" data-act="doUpgrade" ${stake && t && !U.spinning ? '' : 'disabled'}>${t && stake ? `Апгрейд · шанс ${pct(chance * 100)}` : 'Апгрейд'}</button>
    <div class="tiny muted center mt">Ставиш до ${S.UPGRADE.maxCars} авто (рахується ціна моделей), кожне наступне після першого знімає ${S.UPGRADE.perExtraCar * 100}% шансу. Виграв — отримуєш ціль, програв — авто згорають. Деталі й номери з них повертаються на склад у будь-якому разі.</div>
    <div class="h2"><span>Твої авто · ${U.cars.size}/${S.UPGRADE.maxCars}</span><span>${S.short(stake)}</span></div>
    <div class="grid">${garage.map((c) => carTile(c, { act: 'upCar', sel: U.cars.has(c.id) })).join('')}</div>
    ${list.length ? `<div class="h2"><span>Ціль</span><span>${list.length}</span></div>
      <div class="list">${[...list].reverse().map((m) => `<button class="li ${m.id === U.target ? 'on' : ''}" data-act="upTarget" data-id="${m.id}"><div class="mini art">${carArt(m.id)}</div>
        <div class="grow"><b class="ellipsis">${esc(m.name)}</b><div class="small muted">${clsBadge(m.cls)} ${S.short(m.price)} · ×${(m.price / stake).toFixed(1)}</div></div><b class="${S.upgradeChance(stake, m.price, state.up.cars.size) >= 0.5 ? 'win' : ''}">${pct(S.upgradeChance(stake, m.price, state.up.cars.size) * 100)}</b></button>`).join('')}</div>` : ''}`;
};
H.upCar = (d) => {
  const U = state.up, id = Number(d.id);
  if (M(me.cars.find((c) => c.id === id)?.model)?.secret) return toast('Секретну машину не можна ставити в апгрейд', true);
  U.result = null;
  if (U.cars.has(id)) U.cars.delete(id);
  else {
    if (U.cars.size >= S.UPGRADE.maxCars) return toast(`Максимум ${S.UPGRADE.maxCars} авто`, true);
    if (me.cars.filter((c) => c.status === 'garage').length - U.cars.size <= 1) return toast('У гаражі має залишитися хоча б одна машина', true);
    U.cars.add(id);
  }
  render();
};
H.upMult = (d) => {
  const stake = upStake(), list = upCandidates(stake);
  const want = stake * Number(d.k);
  state.up.target = (list.find((m) => m.price >= want) || list[list.length - 1])?.id || null;
  state.up.result = null;
  render();
};
H.upTarget = (d) => {
  state.up.target = d.id;
  state.up.result = null;
  render();
};
H.doUpgrade = async () => {
  const U = state.up;
  const t = M(U.target), stake = upStake();
  if (!(await confirmBox(`Апгрейд на ${t.name}? Шанс ${pct(S.upgradeChance(stake, t.price, state.up.cars.size) * 100)}. Програш — авто згорять.`))) return;
  U.spinning = true;
  render();
  let r;
  try {
    r = await api('upgrade', { carIds: [...U.cars], target: U.target });
  } catch (e) {
    U.spinning = false;
    render();
    return toast(e.message, true);
  }
  const needle = $('#upNeedle');
  const final = 360 * 5 + r.roll * 360;
  needle.style.transition = 'transform 4.2s cubic-bezier(.12,.7,.15,1)';
  needle.style.transform = `rotate(${final}deg)`;
  await new Promise((res) => setTimeout(res, 4300));
  U.angle = r.roll * 360;
  U.spinning = false;
  U.result = r;
  U.cars.clear();
  state.fx = { type: 'upgrade' };
  await refresh();
};
AFTER.upgrade = () => {
  if (state.fx?.type !== 'upgrade' || !state.up.result) return;
  state.fx = null;
  const r = state.up.result;
  const gauge = $('.gauge');
  if (r.win) {
    const m = M(r.target);
    haptic('success');
    FX.celebrate(Math.max(2, S.rankOf(m.cls)), S.CLASSES[m.cls].color, { target: gauge });
  } else {
    haptic('error');
    FX.flash('#ef4444', 0.35, 450);
    FX.shake(gauge, 500);
  }
};

// ---------- casino ----------
state.cas = { game: 'crash', bet: 10000, rbets: {}, mines: 3, crash: null, minesG: null, slots: null, roulette: null, busy: false };
function readBet() {
  const v = Math.max(S.CASINO.minBet, Math.min(S.CASINO.maxBet, Math.round(num($('#betIn')?.value) || state.cas.bet)));
  state.cas.bet = v;
  return v;
}
const betRow = () => `<div class="bet"><button data-act="betAdj" data-k="min">Мін</button><button data-act="betAdj" data-k="half">½</button><input id="betIn" inputmode="numeric" value="${state.cas.bet}"><button data-act="betAdj" data-k="double">×2</button><button data-act="betAdj" data-k="max">Макс</button></div>`;
H.betAdj = (d) => {
  const b = readBet();
  const v = { min: S.CASINO.minBet, half: Math.floor(b / 2), double: b * 2, max: Math.min(me.balance, S.CASINO.maxBet) }[d.k];
  state.cas.bet = Math.max(S.CASINO.minBet, Math.min(S.CASINO.maxBet, v));
  $('#betIn').value = state.cas.bet;
};
const winRank = (mult) => (mult >= 50 ? 4 : mult >= 10 ? 3 : mult >= 3 ? 2 : mult > 1 ? 1 : 0);
function casinoWinFx(mult, target) {
  if (mult <= 0) return haptic('error');
  haptic(mult >= 3 ? 'heavy' : 'success');
  FX.celebrate(winRank(mult), mult >= 10 ? '#ffd500' : '#22c55e', { target });
}
PAGES.casino = async () => {
  const G = state.cas.game;
  const seg = `<div class="seg">${[['crash', 'rocket', 'Краш'], ['mines', 'bomb', 'Міни'], ['roulette', 'chart-donut', 'Рулетка'], ['slots', 'cherry', 'Слоти']].map(([k, icon, t]) => `<button class="${G === k ? 'on' : ''}" data-act="casGame" data-k="${k}">${ic(icon)}${t}</button>`).join('')}</div>`;
  const note = '<div class="tiny muted center mt">Гра на ігрові гривні, без виводу. Казино завжди має невелику перевагу (3–5%) — грай заради фану.</div>';
  if (G === 'crash') return seg + await crashView() + note;
  if (G === 'mines') return seg + await minesView() + note;
  if (G === 'roulette') return seg + rouletteView() + note;
  return seg + slotsView() + note;
};
AFTER.casino = () => {
  if (state.cas.game === 'crash') crashLoop();
};
H.casGame = (d) => {
  if (state.cas.busy || state.cas.crash?.status === 'running') return toast('Спочатку заверши гру', true);
  state.cas.game = d.k;
  render();
};

// Crash
async function crashView() {
  const h = await api('casino/crash/history');
  if (h.running) state.cas.crash = h.running;
  const g = state.cas.crash;
  const running = g?.status === 'running';
  const lastTxt = g && !running ? (g.status === 'won' ? `<div class="mult won">×${g.cashout.toFixed(2)}</div><div class="sub">виграш ${S.fmt(g.won)} · краш на ×${g.point.toFixed(2)}</div>` : `<div class="mult lost">КРАШ ×${g.point.toFixed(2)}</div><div class="sub">ставка ${S.fmt(g.bet)} згоріла</div>`) : '';
  // Green = you cashed out (your multiplier, crash point after the slash); red = it crashed on you.
  const histChip = (r) => (r.status === 'won'
    ? `<span class="hi" title="забрав ×${r.cashout.toFixed(2)}, краш на ×${r.point.toFixed(2)}">✓ ×${r.cashout.toFixed(2)}<i>/ ×${r.point.toFixed(2)}</i></span>`
    : `<span title="краш на ×${r.point.toFixed(2)}">${ic('flame')} ×${r.point.toFixed(2)}</span>`);
  return `<div class="hist">${h.last.map(histChip).join('') || '<span class="muted">ще немає ігор</span>'}</div>
    <div class="crashbox" id="crashBox"><svg viewBox="0 0 340 220" preserveAspectRatio="none"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5b301" stop-opacity=".45"/><stop offset="1" stop-color="#f5b301" stop-opacity="0"/></linearGradient></defs>
      <path id="crashFill" fill="url(#cg)" d=""/><path id="crashPath" fill="none" stroke="#f5b301" stroke-width="3" d=""/></svg>
      <div class="rocket" id="crashRocket" style="left:6%;top:88%"></div>
      ${running ? '<div class="mult" id="crashMult">×1.00</div><div class="sub" id="crashSub">тисни «Забрати», поки не вибухнуло</div>' : lastTxt || '<div class="mult" id="crashMult">×1.00</div><div class="sub">зроби ставку</div>'}</div>
    <div class="mt">${betRow()}</div>
    <div class="row mt"><span class="small muted" style="white-space:nowrap">Автовивід ×</span><input id="autoIn" inputmode="decimal" placeholder="напр. 2.00" value="${state.cas.auto || ''}"></div>
    ${running ? `<button class="btn green mt" id="crashBtn" data-act="crashOut">Забрати</button>` : '<button class="btn mt" data-act="crashStart">Ставка</button>'}`;
}
H.crashStart = async () => {
  const amount = readBet();
  const autoV = $('#autoIn').value.trim().replace(',', '.');
  state.cas.auto = autoV;
  try {
    state.cas.crash = await api('casino/crash/start', { amount, auto: autoV ? Number(autoV) : null });
  } catch (e) {
    return toast(e.message, true);
  }
  haptic('medium');
  await refresh();
};
let crashRaf = 0, crashPoll = 0, crashShown = 1;
function crashLoop() {
  cancelAnimationFrame(crashRaf);
  clearInterval(crashPoll);
  const g = state.cas.crash;
  if (!g || g.status !== 'running') return;
  const W = 340, Hh = 220;
  const frame = () => {
    if (state.page !== 'casino' || state.cas.game !== 'crash' || state.cas.crash !== g) return;
    const sec = Math.max(0, (Date.now() + clockOffset - g.startedAt) / 1000);
    const m = S.crashAt(sec);
    const span = Math.max(6, sec * 1.15), ymax = Math.max(2, m * 1.25);
    const pt = (t) => [(t / span) * W * 0.92 + 6, Hh - 14 - ((S.crashAt(t) - 1) / (ymax - 1)) * (Hh * 0.78)];
    const pts = Array.from({ length: 31 }, (_, i) => pt((sec * i) / 30));
    const d = 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L');
    $('#crashPath')?.setAttribute('d', d);
    $('#crashFill')?.setAttribute('d', `${d} L${pts[30][0].toFixed(1)} ${Hh} L6 ${Hh} Z`);
    const [x, y] = pts[30];
    const rk = $('#crashRocket');
    if (rk) (rk.style.left = (x / W) * 100 + '%'), (rk.style.top = (y / Hh) * 100 + '%');
    const el = $('#crashMult');
    if (el) el.textContent = '×' + m.toFixed(2);
    crashShown = m;
    const btn = $('#crashBtn');
    if (btn) btn.textContent = `Забрати · ×${m.toFixed(2)} · ${S.short(Math.floor(g.bet * m))}`;
    crashRaf = requestAnimationFrame(frame);
  };
  crashRaf = requestAnimationFrame(frame);
  crashPoll = setInterval(async () => {
    if (state.cas.crash !== g) return clearInterval(crashPoll);
    try {
      const s = await api('casino/crash/state', { id: g.id });
      if (s.status !== 'running') crashEnd(s);
    } catch {}
  }, 350);
}
async function crashEnd(s) {
  cancelAnimationFrame(crashRaf);
  clearInterval(crashPoll);
  state.cas.crash = s;
  state.fx = { type: 'crash' };
  await refresh();
  const box = $('#crashBox');
  if (s.status === 'won') casinoWinFx(s.cashout, box);
  else {
    haptic('error');
    FX.flash('#ef4444', 0.35, 400);
    FX.shake(box, 450);
  }
  state.fx = null;
}
H.crashOut = async () => {
  const g = state.cas.crash;
  if (!g || g.status !== 'running') return;
  // Claim exactly what the player saw; the server caps it at its own multiplier anyway.
  try {
    const s = await api('casino/crash/cashout', { id: g.id, at: crashShown });
    crashEnd(s);
  } catch (e) {
    toast(e.message, true);
  }
};

// Mines
async function minesView() {
  if (!state.cas.minesG || state.cas.minesG.status === 'running') state.cas.minesG = (await api('casino/mines/state')).game || (state.cas.minesG?.status === 'running' ? null : state.cas.minesG);
  const g = state.cas.minesG;
  const running = g?.status === 'running';
  const layout = new Set(g?.layout || []);
  const opened = new Set(g?.opened || []);
  const cells = Array.from({ length: S.MINES.cells }, (_, i) => {
    let cls = 'mcell', txt = '';
    if (opened.has(i)) (cls += ' safe'), (txt = '💎');
    else if (g && !running && layout.has(i)) (cls += ' mine' + (g.boom === i ? ' boom' : '')), (txt = '💣');
    else if (g && !running) cls += ' dim';
    return `<button class="${cls}" data-act="mineCell" data-i="${i}" ${running && !opened.has(i) ? '' : 'disabled'}>${txt}</button>`;
  }).join('');
  const head = g ? (running ? `<div class="row between"><span>Ставка <b>${S.short(g.bet)}</b> · мін ${g.mines}</span><span>×<b>${g.mult.toFixed(2)}</b>${g.next ? ` <span class="muted small">→ ×${g.next.toFixed(2)}</span>` : ''}</span></div>`
    : g.status === 'won' ? `<div class="center win" style="font-size:20px;font-weight:900">Виграш ${S.fmt(g.won)} · ×${g.mult.toFixed(2)}</div>` : '<div class="center lose" style="font-size:20px;font-weight:900">Бум! Ставка згоріла</div>') : '<div class="center muted small">Відкривай клітинки з діамантами. Що більше мін — то швидше росте множник.</div>';
  return `<div class="card">${head}<div class="mgrid" id="mgrid">${cells}</div>
    ${running ? `<button class="btn green" data-act="minesCash" ${g.opened.length ? '' : 'disabled'}>Забрати · ${S.fmt(Math.floor(g.bet * g.mult))}</button>` : `
      <div class="small muted">Кількість мін</div><div class="chips mt">${S.MINES.choices.map((k) => `<button class="${state.cas.mines === k ? 'on' : ''}" data-act="minesCount" data-k="${k}">${k}</button>`).join('')}</div>
      ${betRow()}<button class="btn mt" data-act="minesStart">Грати</button>`}</div>`;
}
H.minesCount = (d) => {
  readBet();
  state.cas.mines = Number(d.k);
  render();
};
H.minesStart = async () => {
  try {
    state.cas.minesG = await api('casino/mines/start', { amount: readBet(), mines: state.cas.mines });
  } catch (e) {
    return toast(e.message, true);
  }
  haptic('medium');
  await refresh();
};
H.mineCell = async (d) => {
  if (state.cas.busy) return;
  state.cas.busy = true;
  try {
    const g = await api('casino/mines/reveal', { cell: Number(d.i) });
    state.cas.minesG = g;
    if (g.status === 'lost') {
      await refresh();
      haptic('error');
      FX.flash('#ef4444', 0.4, 450);
      FX.shake($('#mgrid'), 500);
    } else if (g.status === 'won') {
      await refresh();
      casinoWinFx(g.mult, $('#mgrid'));
    } else {
      haptic('light');
      const el = document.querySelector(`[data-act="mineCell"][data-i="${d.i}"]`);
      if (el) {
        const [x, y] = FX.centerOf(el);
        FX.burst(x, y, ['#22c55e', '#fff'], { count: 14, power: 4 });
      }
      await refresh();
    }
  } catch (e) {
    toast(e.message, true);
  }
  state.cas.busy = false;
};
H.minesCash = async () => {
  try {
    const g = await api('casino/mines/cashout');
    state.cas.minesG = g;
    await refresh();
    casinoWinFx(g.mult, $('#mgrid'));
  } catch (e) {
    toast(e.message, true);
  }
};

// Roulette
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const rColor = (n) => (n === 0 ? 'green' : S.ROULETTE_RED.includes(n) ? 'red' : 'black');
function rouletteView() {
  const R = state.cas, bets = R.rbets, res = R.roulette;
  const total = Object.values(bets).reduce((a, b) => a + b, 0);
  const stake = (k) => (bets[k] ? `<span class="stake">${S.short(bets[k]).replace(' ₴', '')}</span>` : '');
  const won = (k) => (res && !R.busy && (typeof k === 'number' ? res.number === k : S.ROULETTE_BETS[k].win(res.number)) && bets[k] ? 'won' : '');
  const strip = (res ? [...WHEEL, ...WHEEL] : WHEEL).map((n) => `<div class="rnum ${rColor(n)} ${res && !R.busy && n === res.number ? 'hit' : ''}">${n}</div>`).join('');
  return `<div class="rwrap"><div class="rstrip" id="rstrip">${strip}</div></div>
    <div class="winline" id="rRes">${res && !R.busy ? (res.won ? `<span class="win">${res.number} · виграш ${S.fmt(res.won)}</span>` : `<span class="lose">${res.number} · не зіграло</span>`) : ''}</div>
    ${betRow()}<div class="tiny muted mt">Обери суму і тисни на поля — можна ставити на ${S.CASINO.rouletteFields} поля одразу (до ${S.short(S.CASINO.maxBet)} на кожне). Число платить 35:1, дюжини 2:1, решта 1:1.</div>
    <div class="routs">${['red', 'black', 'even', 'odd', 'low', 'high', 'd1', 'd2', 'd3'].map((k) => `<button class="rout ${k === 'red' ? 'red' : k === 'black' ? 'black' : ''} ${won(k)}" data-act="rBet" data-k="${k}">${S.ROULETTE_BETS[k].label}${stake(k)}</button>`).join('')}</div>
    <div class="rboard"><button class="rcell green zero ${won(0)}" data-act="rBet" data-k="0">0${stake(0)}</button>${Array.from({ length: 36 }, (_, i) => i + 1).map((n) => `<button class="rcell ${rColor(n)} ${won(n)}" data-act="rBet" data-k="${n}">${n}${stake(n)}</button>`).join('')}</div>
    <div class="btns mt"><button class="btn ghost" data-act="rClear" ${total ? '' : 'disabled'}>Очистити</button><button class="btn yellow" data-act="rSpin" ${total && !R.busy ? '' : 'disabled'}>Крутити · ${S.short(total)}</button></div>`;
}
H.rBet = (d) => {
  if (state.cas.busy) return;
  const k = /^\d+$/.test(d.k) ? Number(d.k) : d.k;
  const amount = readBet();
  const total = Object.values(state.cas.rbets).reduce((a, b) => a + b, 0);
  // Three different limits, each with its own honest message.
  if (!state.cas.rbets[k] && Object.keys(state.cas.rbets).length >= S.CASINO.rouletteFields) return toast(`Максимум ${S.CASINO.rouletteFields} поля за один спін`, true);
  if (total + amount > me.balance) return toast(`Недостатньо гривень: уже поставлено ${S.short(total)}`, true);
  if ((state.cas.rbets[k] || 0) + amount > S.CASINO.maxBet) return toast(`Максимум ${S.short(S.CASINO.maxBet)} на одне поле`, true);
  if (total + amount > S.CASINO.rouletteTotal) return toast(`Максимум ${S.short(S.CASINO.rouletteTotal)} на всі ставки за спін`, true);
  if (state.cas.roulette) state.cas.roulette = null;
  state.cas.rbets[k] = (state.cas.rbets[k] || 0) + amount;
  haptic('light');
  render();
};
H.rClear = () => {
  state.cas.rbets = {};
  state.cas.roulette = null;
  render();
};
H.rSpin = async () => {
  const R = state.cas;
  const bets = Object.entries(R.rbets).map(([on, amount]) => ({ on: /^\d+$/.test(on) ? Number(on) : on, amount }));
  let res;
  try {
    res = await api('casino/roulette', { bets });
  } catch (e) {
    return toast(e.message, true);
  }
  R.busy = true;
  R.roulette = res;
  await render();
  const strip = $('#rstrip'), wrap = strip.parentElement;
  strip.innerHTML = [...WHEEL, ...WHEEL, ...WHEEL, ...WHEEL].map((n) => `<div class="rnum ${rColor(n)}">${n}</div>`).join('');
  const idx = WHEEL.length * 3 + WHEEL.indexOf(res.number);
  const cell = 62;
  const target = idx * cell + 28 - wrap.clientWidth / 2 + (Math.random() * 30 - 15);
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';
  requestAnimationFrame(() => {
    strip.style.transition = 'transform 4.5s cubic-bezier(.1,.7,.12,1)';
    strip.style.transform = `translateX(${-target}px)`;
  });
  await new Promise((r) => setTimeout(r, 4700));
  R.busy = false;
  await refresh();
  const s2 = $('#rstrip');
  if (s2) {
    // Keep the wheel resting on the winning number after the re-render.
    const i2 = WHEEL.length + WHEEL.indexOf(res.number);
    s2.style.transform = `translateX(${-(i2 * cell + 28 - s2.parentElement.clientWidth / 2)}px)`;
  }
  casinoWinFx(res.won / res.total, $('#rRes'));
};

// Slots
function slotsView() {
  const s = state.cas.slots;
  const reels = s?.reels || ['🏎️', '💎', '7️⃣'];
  return `<div class="slotbox" id="slotBox">${reels.map((r, i) => `<div class="sreel ${s && !state.cas.busy && s.mult >= 5 ? 'win' : ''}" id="sreel${i}"><div class="sstrip"><span>${r}</span></div></div>`).join('')}</div>
    <div class="winline" id="sRes">${s && !state.cas.busy ? (s.won ? `<span class="win">+${S.fmt(s.won)} · ×${s.mult}</span>` : '<span class="muted">Не зіграло</span>') : ''}</div>
    ${betRow()}<button class="btn yellow mt" data-act="slotSpin" ${state.cas.busy ? 'disabled' : ''}>Крутити</button>
    <div class="h2"><span>Виплати (× ставки)</span></div>
    <div class="paytable">${S.SLOT_SYMBOLS.slice().reverse().map((x) => `<div><span>${x.s}${x.s}${x.s}</span><b>×${x.pays}</b></div>`).join('')}
      ${Object.entries(S.SLOT_PAIR).reverse().map(([k, v]) => `<div><span>${k}${k} ·</span><b>×${v}</b></div>`).join('')}</div>`;
}
H.slotSpin = async () => {
  if (state.cas.busy) return;
  let r;
  try {
    r = await api('casino/slots', { amount: readBet() });
  } catch (e) {
    return toast(e.message, true);
  }
  state.cas.busy = true;
  $('[data-act="slotSpin"]').disabled = true;
  $('#sRes').innerHTML = '';
  const syms = S.SLOT_SYMBOLS.map((x) => x.s);
  const ROW = 96, N = 22;
  await Promise.all(r.reels.map((final, i) => new Promise((res) => {
    const strip = $(`#sreel${i} .sstrip`);
    const cur = strip.textContent.trim() || syms[0];
    strip.innerHTML = [cur, ...Array.from({ length: N }, () => syms[Math.floor(Math.random() * syms.length)]), final].map((x) => `<span>${x}</span>`).join('');
    strip.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-(N + 1) * ROW - 10}px)`, offset: 0.93 }, { transform: `translateY(${-(N + 1) * ROW}px)` }],
      { duration: 1100 + i * 450, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' }).onfinish = () => {
      haptic('light');
      res();
    };
  })));
  state.cas.busy = false;
  state.cas.slots = r;
  await refresh();
  casinoWinFx(r.mult, $('#slotBox'));
};

// ---------- store, friends, promo, events, fair ----------
// Packs grow with the player (S.packAmount): the amounts shown are this player's.
PAGES.store = async () => {
  const sh = await api('shop');
  const mult = S.packMult(me.level, me.stats.value);
  const it = Object.fromEntries(sh.items.map((x) => [x.id, x]));
  const buyBtns = (x, cls = 'yellow') => `<div class="row" style="gap:6px"><button class="btn sm ${cls}" data-act="buyItem" data-id="${x.id}" ${config.stars ? '' : 'disabled'}>${ic('star')} ${x.price}</button>${sh.stars >= x.price ? `<button class="btn sm ghost" data-act="buyItemStars" data-id="${x.id}" data-p="${x.price}">з рахунку</button>` : ''}</div>`;
  const vipLeft = sh.vipUntil > serverNow();
  return `${config.stars ? '' : '<div class="card small muted">Оплата зірками запрацює після підключення бота (BOT_TOKEN).</div>'}
  <div class="card row between"><span class="row" style="gap:8px">${ic('star')} Зірки на рахунку</span><b style="font-size:18px">${sh.stars}</b></div>
  ${sh.starterBought ? '' : `<div class="card offer"><div class="row between"><b class="disp" style="font-size:19px">${esc(it.starter.name)}</b><span class="chip">один раз</span></div>
    <div class="offer-list"><span>${ic('coin')} ${S.short(it.starter.money)}</span><span>${ic('gift')} 2 × кейс «Міський»</span><span>${ic('crown')} VIP на ${it.starter.vipDays} дні</span></div>
    <div class="row between mt"><span class="tiny muted">Найвигідніше в магазині</span>${buyBtns(it.starter)}</div></div>`}
  <div class="card vip-card"><div class="row between"><b class="disp" style="font-size:19px;color:var(--accent)">${ic('crown')} VIP · ${S.VIP.days} днів</b>${vipLeft ? `<span class="chip">ще <span data-until="${sh.vipUntil - clockOffset}"></span></span>` : ''}</div>
    <div class="vip-list"><span>${ic('gas-station')} Пальне відновлюється вдвічі швидше</span><span>${ic('clock')} Гараж копить на ${S.VIP.extraHours} год довше</span><span>${ic('gift')} +${S.short(S.VIP.daily)} щодня до бонусу</span><span>${ic('crown')} Корона в рейтингу й профілі</span></div>
    <div class="row between mt"><span class="tiny muted">${vipLeft ? 'Купівля продовжить VIP' : ''}</span>${buyBtns(it.vip)}</div></div>
  <div class="card row"><span class="ic" style="font-size:24px;color:var(--accent);display:inline-flex">${ic('ticket')}</span><div class="grow"><b>Преміум-пропуск · Сезон ${me.season.id}</b><div class="tiny muted">Друга доріжка нагород і машина сезону</div></div>${sh.premium ? '<span class="chip">куплено</span>' : buyBtns(it.pass)}</div>
  <div class="h2"><span>Гривні</span><span>×${mult < 10 ? mult.toFixed(1).replace('.', ',') : Math.round(mult)} за рівнем</span></div>
  ${config.packs.map((p) => `<div class="card row"><span class="ic" style="font-size:24px;color:var(--accent);display:inline-flex">${ic('coin')}</span><div class="grow"><b style="font-size:18px">${S.short(S.packAmount(p, me.level, me.stats.value))}</b>${p.tag ? ` <span class="qchip q-perfect">${p.tag}</span>` : ''}</div><button class="btn sm yellow" data-act="buyPack" data-id="${p.id}" ${config.stars ? '' : 'disabled'}>${ic('star')} ${p.stars}</button></div>`).join('')}
  <div class="h2"><span>Зручності</span></div>
  ${[['refuel', 'gas-station', 'Загальний бак і баки всіх машин'], ['cool', 'wind', 'Зняті деталі одразу готові'], ['slot', 'building-warehouse', `Зараз ${me.slots} місць · кожне наступне ×2`]].map(([id, icon, sub]) => `<div class="card row"><span class="ic" style="font-size:22px;color:var(--accent);display:inline-flex">${ic(icon)}</span><div class="grow"><b>${esc(it[id].name)}</b><div class="tiny muted">${sub}</div></div>${buyBtns(it[id], 'ghost')}</div>`).join('')}
  <div class="tiny muted center mt">Оплата через Telegram Stars, усе зараховується одразу. Зірки на рахунку — призи сезону. Ігрові цінності не можна вивести чи обміняти на реальні гроші. Питання — /paysupport у боті.</div>`;
};
AFTER.store = tickUntil;
H.buyItem = async (d) => {
  try {
    const { link } = await api('shop/invoice', { item: d.id });
    if (!tg?.openInvoice) return toast('Відкрий гру в Telegram, щоб оплатити', true);
    tg.openInvoice(link, (status) => {
      if (status === 'paid') toast('Оплата пройшла'), setTimeout(refresh, 1500);
      else if (status === 'failed') toast('Оплата не пройшла', true);
    });
  } catch (e) {
    toast(e.message, true);
  }
};
H.buyItemStars = async (d) => {
  if (!(await confirmBox(`Списати ${d.p} ⭐ з рахунку?`))) return;
  act('shop/stars', { item: d.id }, 'Готово!');
};
H.buyPack = async (d) => {
  try {
    const { link } = await api('shop/invoice', { pack: d.id });
    if (!tg?.openInvoice) return toast('Відкрий гру в Telegram, щоб оплатити', true);
    tg.openInvoice(link, (status) => {
      if (status === 'paid') toast('Оплата пройшла'), setTimeout(refresh, 1500);
      else if (status === 'failed') toast('Оплата не пройшла', true);
    });
  } catch (e) {
    toast(e.message, true);
  }
};
PAGES.friends = async () => {
  const r = await api('ref');
  return `<div class="card center"><div style="font-size:36px;color:var(--accent)">${ic('users')}</div><b class="disp" style="font-size:20px">КЛИЧ ДРУЗІВ</b>
    <div class="muted mt">За кожного друга — <b class="win">${S.fmt(S.REF_REWARD)}</b> тобі, коли він досягне 3 рівня, і ${S.fmt(S.REF_FRIEND_BONUS)} йому на старт</div>
    ${r.link ? `<div class="mono mt">${esc(r.link)}</div><div class="btns mt"><button class="btn" data-act="shareRef" data-link="${esc(r.link)}">Поділитися</button><button class="btn ghost" data-act="copyRef" data-link="${esc(r.link)}">Скопіювати</button></div>` : '<div class="small muted mt">Посилання з’явиться після підключення бота</div>'}</div>
    <div class="stat" style="grid-template-columns:1fr 1fr"><div><b>${r.invited}</b><span>запрошено</span></div><div><b>${S.short(r.earned)}</b><span>зароблено</span></div></div>`;
};
H.copyRef = (d) => navigator.clipboard?.writeText(d.link).then(() => toast('Скопійовано'));
H.shareRef = (d) => {
  const url = `https://t.me/share/url?url=${encodeURIComponent(d.link)}&text=${encodeURIComponent('Збирай справжні авто, тюнінгуй і ганяй дрег в АВТОДРОП 🏎')}`;
  tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, '_blank');
};
PAGES.promo = () => `<div class="card center"><div style="font-size:36px;color:var(--accent)">${ic('ticket')}</div><b class="disp" style="font-size:20px">ПРОМОКОД</b><div class="small muted">Свіжі коди — у нашому каналі</div><input id="promo" class="mt" placeholder="Введи промокод" autocomplete="off" style="text-transform:uppercase;text-align:center"><button class="btn mt" data-act="promo">Активувати</button></div>`;
H.promo = async () => {
  if (await act('promo', { code: $('#promo').value }, (r) => `Промокод активовано: +${S.fmt(r.got)}`)) $('#promo').value = '';
};
PAGES.events = async () => {
  const { list } = await api('events');
  me.unread = 0;
  renderHeader();
  return `<div class="list">${list.length ? list.map((e) => `<div class="li"><div class="grow">${esc(e.text)}<div class="tiny muted">${new Date(e.at).toLocaleString('uk-UA')}</div></div></div>`).join('') : '<div class="empty">Сповіщень поки немає</div>'}</div>`;
};
async function hmacFloat(seed, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return parseInt(hex.slice(0, 13), 16) / 16 ** 13;
}
async function sha256hex(s) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function pickW(entries, r) {
  let x = r * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((x -= w) < 0) return k;
  return entries[entries.length - 1][0];
}
PAGES.fair = async () => {
  const [hist, revealed] = await Promise.all([api('case/history'), api('fair/revealed')]);
  const seeds = Object.fromEntries(revealed.map((r) => [r.seedHash, r.seed]));
  const label = (h) => (S.MODELS[h.item] ? M(h.item).name : S.partLabel(...h.item.split(':')));
  return `<div class="card small">Кожне відкриття = HMAC-SHA256(серверний сід, «клієнтський сід:номер:0») → клас, «…:1» → предмет. Хеш серверного сіда видно заздалегідь, сам сід розкривається після заміни — тоді будь-який дроп можна перевірити.</div>
    <div class="card"><div class="small muted">Хеш поточного серверного сіда</div><div class="mono">${me.fair.seedHash}</div>
    <div class="small muted mt">Клієнтський сід</div><div class="row mt"><input id="cseed" value="${esc(me.fair.clientSeed)}"><button class="btn sm" data-act="saveSeed">OK</button></div>
    <div class="small muted mt">Відкриттів на цьому сіді: ${me.fair.nonce}</div><button class="btn ghost mt" data-act="rotateSeed">Замінити сід і розкрити поточний</button></div>
    <div class="h2"><span>Останні дропи</span></div><div class="list">${hist.length ? hist.map((h) => `<div class="li"><div class="grow small">${clsBadge(h.cls)} <b>${esc(label(h))}</b>${h.forced ? ' <span class="chip">гарантія</span>' : ''}<div class="tiny muted">${esc((S.CASE_BY_ID[h.caseId] || S.PART_CASE_BY_ID[h.caseId]).name)} · #${h.nonce}</div></div>
      ${seeds[h.seedHash] ? `<button class="btn sm ghost" data-act="verify" data-seed="${seeds[h.seedHash]}" data-hash="${h.seedHash}" data-cs="${esc(h.clientSeed)}" data-n="${h.nonce}" data-case="${h.caseId}" data-cls="${h.cls}" data-item="${h.item}" data-forced="${h.forced}">Перевірити</button>` : '<span class="tiny muted">сід ще не розкрито</span>'}</div>`).join('') : '<div class="empty">Ще немає дропів</div>'}</div>`;
};
H.saveSeed = () => act('fair/seed', { clientSeed: $('#cseed').value.trim() }, 'Сід збережено');
H.rotateSeed = async () => (await confirmBox('Розкрити поточний серверний сід і створити новий?')) && act('fair/rotate', {}, 'Сід розкрито');
H.verify = async (d) => {
  const hashOk = (await sha256hex(d.seed)) === d.hash;
  const r0 = await hmacFloat(d.seed, `${d.cs}:${d.n}:0`), r1 = await hmacFloat(d.seed, `${d.cs}:${d.n}:1`);
  let item, ok;
  if (S.CASE_BY_ID[d.case]) {
    const cs = S.CASE_BY_ID[d.case];
    const cls = d.forced === '1' ? d.cls : pickW(S.CLASS_ORDER.filter((c) => cs.weights[c]).map((c) => [c, cs.weights[c]]), r0);
    const list = cs.pool(cls), w = S.modelWeights(list);
    item = pickW(list.map((m, i) => [m.id, w[i]]), r1);
    ok = hashOk && cls === d.cls && item === d.item;
  } else {
    const pc = S.PART_CASE_BY_ID[d.case];
    const tier = pickW(Object.entries(pc.weights), r0);
    const [type] = d.item.split(':');
    ok = hashOk && d.item.endsWith(':' + tier);
    item = `${type}:${tier}`;
  }
  sheet(ok ? 'Дроп чесний' : 'Не збігається', `<div class="small">Хеш сіда збігається: <b>${hashOk ? 'так' : 'ні'}</b></div><div class="small mt">Числа: ${r0.toFixed(8)} / ${r1.toFixed(8)}</div><div class="small">Результат: ${esc(S.MODELS[item] ? M(item).name : S.partLabel(...item.split(':')))}</div><div class="mono mt">${esc(d.seed)}</div>`);
};

// ---------- boot ----------
// ---------- banners: iOS-style notices sliding down from the top ----------
// Invites (a live race, a trade) stay until answered or gone; rewards ready to claim show once each (remembered in
// the browser) with a "Забрати" button and hide by themselves. A swipe up dismisses a banner.
const BANNER_IC = { pvp: ['flag-3', '#ff3b30'], room: ['arrows-exchange', '#007aff'], daily: ['gift', '#ff9f0a'], rcase: ['box', '#ff9f0a'], newbie: ['sparkles', '#34c759'], quest: ['target-arrow', '#ff3b30'], coll: ['books', '#5856d6'], income: ['coin', '#ffcc00'], rescue: ['clover', '#30d158'], ach: ['diamond', '#bf5af2'], achAll: ['diamond', '#bf5af2'] };
const banners = new Map(); // key → { el, data }
let bannerSeen;
try {
  bannerSeen = new Set(JSON.parse(localStorage.getItem('avtodrop-banners') || '[]'));
} catch {
  bannerSeen = new Set();
}
const rememberBanner = (key) => {
  bannerSeen.add(key);
  try {
    localStorage.setItem('avtodrop-banners', JSON.stringify([...bannerSeen].slice(-200)));
  } catch {}
};
let skipDailyBanner = false; // the rewards window already opened by itself at start
function showBanner(data) {
  if (banners.has(data.key)) return;
  let box = $('#banners');
  if (!box) {
    box = document.createElement('div');
    box.id = 'banners';
    document.body.append(box);
  }
  const [icon, color] = BANNER_IC[data.kind] || ['bell', '#8e8e93'];
  const el = document.createElement('div');
  el.className = 'banner';
  el.innerHTML = `<span class="mi" style="--c:${color}">${ic(icon)}</span>
    <div class="grow" data-act="bannerOpen" data-key="${esc(data.key)}"><b>${esc(data.title)}</b><div class="small">${data.sub}</div></div>
    <div class="bbtns">${data.buttons.map((b) => `<button class="btn sm ${b.cls || ''}" data-act="${b.act}" data-key="${esc(data.key)}">${b.label}</button>`).join('')}</div>`;
  box.prepend(el);
  banners.set(data.key, { el, data });
  requestAnimationFrame(() => el.classList.add('in'));
  haptic(data.invite ? 'warning' : 'light');
  if (data.ttl) data.timer = setTimeout(() => hideBanner(data.key), data.ttl);
  // Swipe up to dismiss.
  let y0 = null;
  el.addEventListener('pointerdown', (e) => (y0 = e.clientY));
  el.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    const dy = Math.min(0, e.clientY - y0);
    el.style.transform = `translateY(${dy}px)`;
    if (dy < -40) {
      y0 = null;
      hideBanner(data.key);
    }
  });
  el.addEventListener('pointerup', () => ((y0 = null), (el.style.transform = '')));
  // Keep at most 3 on screen: the oldest goes.
  if (banners.size > 3) hideBanner([...banners.keys()][0]);
}
function hideBanner(key) {
  const b = banners.get(key);
  if (!b) return;
  banners.delete(key);
  clearTimeout(b.data.timer);
  if (!b.data.invite) rememberBanner(key);
  b.el.classList.remove('in');
  b.el.style.transform = '';
  b.el.classList.add('out');
  setTimeout(() => b.el.remove(), 350);
}
// A gift or message from the administration: a window showing what arrived, with the admin's note.
let giftQueue = [];
function showGift() {
  const g = giftQueue[0];
  if (!g) return;
  const d = g.data;
  let art = '', title = 'Подарунок!', color = '#ff9f0a';
  if (g.kind === 'car') {
    const m = M(d.model);
    color = S.CLASSES[m.cls].color;
    art = `<div class="hero"><div class="art reveal">${carArt(d.model, { glow: true })}</div></div><div class="result-name pop" style="--c:${color}">${esc(m.name)}</div><div class="mt">${clsBadge(m.cls)} <span class="chip" style="color:${color}">${S.CLASSES[m.cls].name}</span></div>`;
  } else if (g.kind === 'money') {
    art = `<div class="gift-ic">${ic('coin')}</div><div class="gift-sum win">+${S.fmt(d.amount)}</div>`;
  } else if (g.kind === 'plate') {
    color = S.CLASSES[d.cls].color;
    art = `<div class="gift-plate pop">${plate(d.text, 'lg')}</div><div class="mt">${clsBadge(d.cls)} <span class="small muted">вартість ${S.fmt(d.value)}</span></div>`;
  } else if (g.kind === 'part') {
    color = S.CLASSES[S.TIER_BY_ID[d.tier].cls].color;
    art = `<div class="gift-part pop">${partArt(d.type, d.tier, 'lg')}</div><b class="mt">${esc(S.partLabel(d.type, d.tier))} × ${d.count}</b>`;
  } else if (g.kind === 'keys') {
    art = `<div class="gift-ic">${caseIcon(S.CASE_BY_ID[d.caseId])}</div><b>${esc(S.CASE_BY_ID[d.caseId].name)} × ${d.count}</b><div class="small muted">ключі — відкрий кейс безкоштовно</div>`;
  } else {
    title = 'Повідомлення';
    color = '#007aff';
    art = `<div class="gift-ic" style="--c:${color}">${ic('bell')}</div>`;
  }
  sheet(title, `<div class="center gift">${art}
    ${g.note ? `<div class="gift-note">${esc(g.note)}</div>` : ''}
    <div class="tiny muted mt">від адміністрації АВТОДРОП</div>
    <button class="btn yellow mt2" data-act="giftOk">${g.kind === 'message' ? 'Зрозуміло' : 'Забрати'}</button></div>`);
  haptic('success');
  if (g.kind !== 'message') setTimeout(() => {
    const r = $('#sheet')?.getBoundingClientRect();
    if (r) FX.burst(r.left + r.width / 2, r.top + 150, [color, '#fff', '#ffd60a'], { count: 70, power: 8, shape: 'mix' });
  }, 250);
}
H.giftOk = async () => {
  const g = giftQueue.shift();
  closeModal();
  if (g) {
    try {
      await api('gifts/seen', { ids: [g.id] });
    } catch {}
  }
  if (giftQueue.length) return setTimeout(showGift, 300);
  await refresh();
};
const busyForBanners = () => state.opening || (state.race && state.race.phase !== 'done') || battleTimers.length;
async function pulse() {
  if (document.hidden || !me) return;
  let p;
  try {
    p = await api('pulse');
  } catch {
    return;
  }
  clockOffset = p.now - Date.now();
  if (p.balance !== me.balance || p.unread !== me.unread || p.achReady !== me.achReady) {
    me.balance = p.balance;
    me.unread = p.unread;
    me.achReady = p.achReady;
    renderHeader();
  }
  // Invites: show new ones, drop banners whose invite is gone (accepted elsewhere, expired, withdrawn).
  const live = new Set();
  for (const inv of p.invites) {
    live.add(inv.key);
    if (state.race && state.race.phase !== 'done') continue;
    if (inv.kind === 'pvp') {
      showBanner({ key: inv.key, kind: 'pvp', invite: inv, title: `${inv.from} кличе на гонку!`, sub: `Ставка ${S.short(inv.bet)} · ${esc(M(inv.car.model).name)} · <span data-until="${inv.expiresAt - clockOffset}"></span>`, ttl: Math.max(1000, inv.expiresAt - serverNow()), buttons: [{ label: 'Ні', act: 'inviteNo', cls: 'ghost' }, { label: 'Їдемо!', act: 'inviteYes' }] });
    } else {
      showBanner({ key: inv.key, kind: 'room', invite: inv, title: `${inv.from} запрошує на обмін`, sub: 'Кімната обміну з чатом', buttons: [{ label: 'Ні', act: 'inviteNo', cls: 'ghost' }, { label: 'Зайти', act: 'inviteYes' }] });
    }
  }
  for (const [key, b] of banners) if (b.data.invite && !live.has(key)) hideBanner(key);
  if (busyForBanners()) return;
  // (Re)start from the server's list whenever no window is open: a gift closed by tapping outside comes back.
  if (p.gifts.length && $('#modal').hidden) {
    giftQueue = p.gifts;
    return showGift();
  }
  for (const c of p.claims) {
    if (bannerSeen.has(c.key) || (c.kind === 'daily' && skipDailyBanner)) continue;
    showBanner({ ...c, claim: c, sub: esc(c.sub) + (c.money ? ` · <b class="win">+${S.short(c.money)}</b>` : ''), ttl: 8000, buttons: [{ label: 'Забрати', act: 'bannerClaim' }] });
  }
  // Reloaded the app in the middle of a live race: get back into it.
  if (p.livePvp && !state.race && !$('#pvpWait')) {
    try {
      const s = await api('pvp/state', { id: p.livePvp });
      if (s.status === 'live' && serverNow() < s.greenAt + 20e3) startLive(s);
    } catch {}
  }
}
H.inviteYes = async (d) => {
  const b = banners.get(d.key);
  if (!b) return;
  const inv = b.data.invite;
  hideBanner(d.key);
  if (inv.kind === 'room') return enterRoom('room/join', { id: inv.id });
  try {
    startLive(await api('pvp/answer', { id: inv.id, yes: true }));
  } catch (e) {
    toast(e.message, true);
  }
};
H.inviteNo = async (d) => {
  const b = banners.get(d.key);
  if (!b) return;
  const inv = b.data.invite;
  hideBanner(d.key);
  try {
    await api(inv.kind === 'room' ? 'room/decline' : 'pvp/answer', { id: inv.id, yes: false });
  } catch {}
};
H.bannerClaim = async (d) => {
  const b = banners.get(d.key);
  if (!b) return;
  const c = b.data.claim;
  hideBanner(d.key);
  if (c.kind === 'daily') return H.claimDaily();
  if (c.kind === 'rcase') return H.claimRewardCase();
  if (c.kind === 'income') return H.collect();
  if (c.kind === 'newbie') return act('newbie/claim', {}, (r) => `+${S.fmt(r.got)}`);
  if (c.kind === 'quest') return act('quests/claim', { key: c.id }, (r) => `+${S.fmt(r.got)}`);
  if (c.kind === 'coll') return act('collection/claim', { key: c.id }, (r) => `Отримано: ${S.short(r.reward.money)}${r.reward.secret ? ' + секретна машина!' : ''}`);
  if (c.kind === 'ach') return act('ach/claim', { key: c.id }, (r) => `Досягнення: +${S.fmt(r.got)}`);
  if (c.kind === 'achAll') return act('ach/claim', {}, (r) => `${r.tiers} досягнень: +${S.fmt(r.got)}`);
  if (c.kind === 'pass') return H.passClaim();
  if (c.kind === 'rescue' && await act('rescue/claim', {}, 'Безкоштовний кейс уже чекає!', { rerender: false })) {
    state.tab = 'cases';
    state.page = null;
    state.caseId = 'rust';
    state.count = 1;
    render();
  }
};
// Tapping the banner's text opens the place it is about.
H.bannerOpen = (d) => {
  const b = banners.get(d.key);
  if (!b) return;
  const k = b.data.kind;
  if (b.data.invite) return;
  hideBanner(d.key);
  if (k === 'daily' || k === 'rcase') return openRewards();
  if (k === 'income') return (state.tab = 'garage', state.page = null, render());
  if (k === 'newbie') return openProfile();
  state.tab = 'menu';
  if (k === 'pass') return go('season');
  go(k === 'quest' ? 'quests' : k === 'ach' || k === 'achAll' ? 'achievements' : 'collection');
};
H.toggleDnd = async () => {
  const r = await act('settings/invites', { on: !me.noInvites }, null);
  if (r) toast(r.noInvites ? 'Не турбувати: ніхто не зможе тебе запросити' : 'Запрошення знову увімкнено');
};

(async function boot() {
  if (tg?.initData) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor('#07090d');
      tg.setBackgroundColor('#07090d');
      tg.disableVerticalSwipes?.();
    } catch {}
    tg.BackButton?.onClick(back);
  }
  try {
    config = await (await fetch('/api/config')).json();
  } catch {}
  setImages(config.images);
  measurePlateFont();
  if (!tg?.initData && !config.dev) {
    $('#view').innerHTML = '<div class="empty">Відкрий АВТОДРОП через Telegram-бота</div>';
    return;
  }
  try {
    await refresh();
    if (me.keys.starter) state.caseId = 'starter';
    if (me.dailyReady && !me.cars.length) state.tab = 'cases';
    render();
    if (me.dailyReady) {
      openRewards();
      skipDailyBanner = true;
    }
    if (me.cars.length) whatsNew();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
  setTimeout(pulse, 2500);
  setInterval(pulse, 4000);
  setInterval(async () => {
    if (document.hidden || state.opening || state.race || !$('#modal').hidden) return;
    try {
      const fresh = await api('me');
      const changed = fresh.unread !== me.unread || fresh.incomingTrades !== me.incomingTrades || fresh.balance !== me.balance;
      me = fresh;
      clockOffset = me.now - Date.now();
      if (changed) renderHeader();
    } catch {}
  }, 20000);
})();
