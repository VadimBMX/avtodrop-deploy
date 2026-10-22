import * as S from './shared.js';
// Workshop maths: a part's real effect on the 402 m time, «Встановити найкраще», parts no car needs.
import * as T from './tune.js';
import { carArt, setImages } from './car.js';
// Painted cars get their recoloured photo once the picture is in the page.
import * as PAINT from './paint.js';
// Dirty cars (S.WASH) get their dirt layer the same way; the hand-wash mini-game takes its scene from here too.
import * as DIRT from './dirt.js';
import * as FX from './fx.js';
import * as SFX from './sfx.js';
// «Заїзд дня»: the car of the day and the prizes (shared with the server); the share card is loaded when needed.
import * as DRS from './dayrace.js';
import * as WOW from './wow.js';
// Ghost challenges: the ghost's replay and the rules (shared with the server), the share card.
import * as G from './ghost.js';
import { challengeCard } from './challenge-card.js';

const tg = window.Telegram?.WebApp;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => Number(String(v ?? '').replace(/[\s ]/g, ''));
const M = (id) => S.MODELS[id];
// Ukrainian plural: plural(2, ['машина', 'машини', 'машин']) → 'машини'.
const plural = (n, [one, few, many]) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
// Shared/server texts are written for "5+" ("Збери {n} секретних машин"): put the noun in the right form for n.
const COUNT_FORMS = {
  'PvP-заїздів': ['PvP-заїзд', 'PvP-заїзди', 'PvP-заїздів'], 'PvP-заїзд': ['PvP-заїзд', 'PvP-заїзди', 'PvP-заїздів'],
  'кейс-батлів': ['кейс-батл', 'кейс-батли', 'кейс-батлів'], 'ідеальних перемикань': ['ідеальне перемикання', 'ідеальні перемикання', 'ідеальних перемикань'],
  'різних машин': ['різну машину', 'різні машини', 'різних машин'], 'секретних машин': ['секретну машину', 'секретні машини', 'секретних машин'],
  'кейсів': ['кейс', 'кейси', 'кейсів'], 'заїздів': ['заїзд', 'заїзди', 'заїздів'], 'днів': ['день', 'дні', 'днів'],
  'раз': ['раз', 'рази', 'разів'], 'друзів': ['друга', 'друзів', 'друзів'],
};
const COUNT_RE = new RegExp(`(\\d+) (${Object.keys(COUNT_FORMS).join('|')})(?![\\p{L}-])`, 'gu');
const countFix = (text) => String(text ?? '').replace(COUNT_RE, (_, n, w) => `${n} ${plural(Number(n), COUNT_FORMS[w])}`);
// Decimal comma everywhere a fraction is shown: dec(10.034, 2) → '10,03'.
const dec = (x, n) => Number(x).toFixed(n).replace('.', ',');
// Digit groups for money typed into inputs: 21829500 → '21 829 500' (num() reads it back).
const grp = (v) => String(Math.max(0, Math.round(num(v) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const clsBadge = (cls, extra = '') => `<span class="cls ${extra}" style="background:${S.CLASSES[cls].color}">${cls}</span>`;
const tierCls = (tier) => S.TIER_BY_ID[tier].cls;
const flag = (id) => S.COUNTRIES[M(id).country].flag;
// Where a car is from, as a chip. The «Україна/СРСР» case mixes Ukrainian makes with Soviet ones (ВАЗ, ГАЗ, Москвич…):
// the Ukrainian flag goes only with ЗАЗ / ЛуАЗ / own prototypes, a Soviet car gets a grey «СРСР» tag instead.
const SOVIET_RE = /^(ВАЗ|Lada|Москвич|ГАЗ|ЗІЛ|УАЗ|ІЖ|ИЖ)(?=[\s-]|$)/; // (\b is ASCII-only, useless after a Cyrillic letter)
const originText = (m) => (m.country === 'UA' ? (SOVIET_RE.test(m.name) ? 'СРСР · радянська класика' : '🇺🇦 Україна') : `${S.COUNTRIES[m.country].flag} ${S.COUNTRIES[m.country].name}`);
const originChip = (id) => {
  const m = M(id), c = S.COUNTRIES[m.country];
  if (m.country === 'UA') return SOVIET_RE.test(m.name) ? '<span class="chip origin su"><i>СРСР</i> Радянська класика</span>' : `<span class="chip origin">${c.flag} Україна</span>`;
  return `<span class="chip origin">${c.flag} ${c.name}</span>`;
};
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
  return `<span class="part ${size} ${img ? 'photo' : ''} ${tier ? 'on' : ''}" style="--c:${c}">${img ? `<img src="${img}" alt="" loading="lazy">` : ic(S.PARTS[type].icon)}</span>`;
}
const countryTag = (c) => `<span class="cc sm">${c}</span>`;
// Empty state: an icon, what is missing, and (optionally) the next step as a button.
const emptyBox = (icon, title, sub = '', cta = '') => `<div class="empty-box"><span class="empty-ic">${ic(icon)}</span><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}${cta}</div>`;
const initialOf = (n) => (String(n || '?').replace(/^@/, '').trim()[0] || '?').toUpperCase();
// A small car picture standing on a floor lit in its class colour (lists, market, rivals).
const miniCar = (model, cls = '', look = null, dirt = 0) => `<div class="mini art lit r${S.rankOf(M(model).cls)} ${cls}" style="--c:${S.CLASSES[M(model).cls].color}">${carArt(model, { look, dirt })}</div>`;

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
    if (p.get('start')) u.start_param = p.get('start'); // DEV: a deep link's start parameter for a new test player
    try {
      localStorage.setItem(key, JSON.stringify(u));
    } catch {}
  }
  return u;
}
// Small per-player choices kept in this browser (the chosen race car, the chosen case): a restart keeps them.
const prefKey = () => 'avtodrop-pref-' + (me?.id ?? 'x');
function prefGet(k, ok = () => true) {
  try {
    const v = JSON.parse(localStorage.getItem(prefKey()) || '{}')[k];
    return v != null && ok(v) ? v : null;
  } catch {
    return null;
  }
}
function prefSet(k, v) {
  try {
    const o = JSON.parse(localStorage.getItem(prefKey()) || '{}');
    if (o[k] === v) return;
    o[k] = v;
    localStorage.setItem(prefKey(), JSON.stringify(o));
  } catch {}
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
// Haptics for fast repeated events (reel cards, plate symbols): at most one per `gap` ms.
let lastHaptic = 0;
function hapticTick(kind = 'soft', gap = 70) {
  const now = performance.now();
  if (now - lastHaptic < gap) return;
  lastHaptic = now;
  haptic(kind);
}
// Where the last tap was: coins fly from there when a reward lands.
let lastTap = null;
const tapPoint = () => (lastTap && performance.now() - lastTap.t < 4000 ? [lastTap.x, lastTap.y] : [innerWidth / 2, innerHeight * 0.55]);
// Money gained by an action (collect, claims, sales): coins fly to the balance chip, which then counts up.
let coinsLandAt = 0;
function moneyFx(amount) {
  if (!(amount > 0)) return;
  const chip = $('#balance');
  coinsLandAt = performance.now() + 700;
  SFX.coin();
  FX.coinFly(tapPoint(), chip, { count: Math.min(14, 6 + Math.round(Math.log10(amount))), onEach: (i) => (i % 3 === 0 && SFX.tick(1.6), i === 0 && FX.popEl(chip, 1.15, 300)), onDone: () => (FX.popEl(chip, 1.18, 380), SFX.coin()) });
  setTimeout(() => FX.gainLabel(chip, amount, S.short), 550);
}
const gainOf = (r) => [r?.got, r?.reward?.money, r?.money].find((v) => typeof v === 'number' && v > 0) || 0;
// Endpoints whose success is a moment worth celebrating (beyond the coins).
const CELEBRATE = new Set(['ach/claim', 'collection/claim', 'quests/claim', 'weekly/claim', 'newbie/claim', 'pass/claim']);
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  // Text is escaped; only our own line icons (ic(...)) inside the message are turned back into icons.
  // (src/static.js serves icons.svg as icons.svg?v=<hash>, so the href may carry a version before the «#».)
  const body = esc(msg).replace(/&lt;svg class=&quot;i ?&quot; aria-hidden=&quot;true&quot;&gt;&lt;use href=&quot;icons\.svg[^&#]*#i-([a-z0-9-]+)&quot;\/&gt;&lt;\/svg&gt;/g, (_, n) => ic(n));
  t.innerHTML = `<span class="toast-ic">${ic(err ? 'info-circle' : 'check')}</span><span class="toast-tx">${body}</span>`;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  void t.offsetWidth;
  t.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
// One request per action at a time: a double tap on «Забрати» used to send the claim twice — the first one paid, the
// second came back «Завдання ще не виконано» while the screen still showed the old card.
const acting = new Set();
async function act(name, body, ok, { rerender = true } = {}) {
  const lock = name + ':' + JSON.stringify(body || {});
  if (acting.has(lock)) return null;
  acting.add(lock);
  try {
    const r = await api(name, body);
    if (r?.stale) {
      toast(r.message, true);
      await refresh();
      return null;
    }
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
    haptic('success');
    moneyFx(gainOf(r));
    if (CELEBRATE.has(name)) {
      const [x, y] = tapPoint();
      FX.burst(x, y, ['#ffd500', '#ffffff', '#34c759'], { count: 36, power: 6, shape: 'mix' });
      SFX.win();
    }
    await refresh(rerender);
    return r;
  } catch (e) {
    toast(e.message, true);
    haptic('error');
    // The screen may be out of date (that is often why the action failed): bring it in line with the server.
    refresh().catch(() => {});
    return null;
  } finally {
    acting.delete(lock);
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
  hideClaimBanners();
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
// Money fields keep digit groups while typing ("21 829 500"); the caret stays after the same number of digits.
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.tagName !== 'INPUT' || el.inputMode !== 'numeric') return;
  const raw = el.value, pos = el.selectionStart ?? raw.length;
  const digitsBefore = raw.slice(0, pos).replace(/\D/g, '').length;
  const digits = raw.replace(/\D/g, '');
  const out = digits ? grp(digits) : '';
  if (out === raw) return;
  el.value = out;
  let i = 0, seen = 0;
  while (i < out.length && seen < digitsBefore) if (/\d/.test(out[i++])) seen++;
  try {
    el.setSelectionRange(i, i);
  } catch {}
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = H[el.dataset.act];
  if (fn) {
    haptic('light');
    lastTap = { x: e.clientX || FX.centerOf(el)[0], y: e.clientY || FX.centerOf(el)[1], t: performance.now() };
    if (/claim|collect|Claim|Chest|openCase|genPlate/.test(el.dataset.act)) FX.press(el), SFX.press();
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
const plate = (text, size = '', frame) => `<span class="plate ${size}${plateFrame(text, frame)}"><span class="ua"><i></i>UA</span><span class="tx"><span class="txi">${plateGroups(text)}</span></span></span>`;

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
// Odds as one segmented strip in class colours, plus the chance of the rarest class (the one people open the case for).
function oddsBar(weights) {
  const e = S.CLASS_ORDER.filter((c) => weights[c]).map((c) => [c, weights[c]]);
  const total = e.reduce((a, [, w]) => a + w, 0);
  const [tc, tw] = e[e.length - 1];
  return `<span class="odds"><span class="odds-bar">${e.map(([c, w]) => `<i style="flex:${Math.max(w / total, 0.03)};background:${S.CLASSES[c].color}"></i>`).join('')}</span><span class="odds-top" style="color:${S.CLASSES[tc].color}">${tc} ${pct((tw / total) * 100)}</span></span>`;
}
const partCount = (c) =>S.partKeysOf(c.model).filter((k) => c.parts?.[k]).length;
const partSlots = (c) => S.partKeysOf(c.model).length;
function carTile(c, { act = 'car', sel = false, isNew = false, showTank = false, sellLine = false, incLine = false, collLine = false } = {}) {
  const m = M(c.model);
  const sale = S.saleOf(c); // honest numbers: the sale is the main figure, the collection price the grey line
  return `<button class="car r${S.rankOf(m.cls)} ${sel ? 'sel' : ''} ${c.status === 'market' || c.status === 'auction' ? 'listed' : ''}" data-act="${act}" data-id="${c.id}" style="--c:${S.CLASSES[m.cls].color}">
    ${clsBadge(m.cls, 'tl')}<span class="tr">${isNew ? `<span class="new">${ic('sparkles')}нова</span>` : ''}<span class="chip">${ic('tool')}${partCount(c)}/${partSlots(c)}</span></span>
    <div class="art">${carArt(c.model, { look: c.look, dirt: c.dirt })}${dirtPip(c)}</div>
    <div class="nm clamp2" title="${esc(m.name)}">${esc(m.name)}</div>
    ${c.plate ? `<div class="meta">${plate(c.plate.text, 'sm', c.pf)}</div>` : ''}
    <div class="meta row between" style="gap:4px"><span>${c.hp} к.с.</span><b class="disp hn-sale" style="color:var(--text);font-size:14px;font-weight:600" title="${sale == null ? 'Колекційна ціна' : 'Продаж'}">${sale == null ? S.short(c.value) : `${ic('cash')}${S.short(sale)}`}</b></div>${collLine ? `<div class="meta sellp">${sale == null ? 'не продається' : `${collLine === 'short' ? 'колекц.' : 'колекційна'} ${S.short(c.value)}`}</div>` : ''}
    ${incLine && c.status === 'garage' ? tileInc(c) : ''}
    ${sellLine && c.sell != null && !m.secret && c.status === 'garage' && act !== 'none' ? `<div class="meta sellp">продаж ${S.short(c.sell)}</div>` : ''}
    ${c.status === 'market' ? `<div class="status">${ic('building-store')}На ринку</div>` : c.status === 'auction' ? `<div class="status">${ic('hammer')}На аукціоні</div>` : ''}
  </button>`;
}
// Garage tile: the car's real income an hour (all bonuses), or «не заробляє» when it's past the slots.
function tileInc(c) {
  const e = carInc(c);
  if (!e) return '';
  return e.earning ? `<div class="meta inc">${ic('coin')}${noRmb(e.rate)}<small>/год</small></div>` : '<div class="meta inc off">не заробляє</div>';
}
function carRow(c, right = '', meta = '', later = false) {
  const m = M(c.model);
  return `<div class="li">${miniCar(c.model, '', c.look, c.dirt)}<div class="grow"><div class="clamp2"><b>${esc(m.name)}</b></div>
    <div class="small muted">${clsBadge(m.cls)} ${c.plate ? plate(c.plate.text, 'sm', c.pf) : ''} <span class="nw">${c.hp} к.с.</span> · ${rowMoney(c, later)}${dirtTag(c)}</div>${meta ? `<div class="lot-meta">${meta}</div>` : ''}</div>${right}</div>`;
}
// A car's money on a list row: the sale first («продаж потім ≈» on a lot you'd buy), the collection price in grey.
function rowMoney(c, later = false) {
  const sale = S.saleOf(c);
  if (sale == null) return `<span class="nw">колекційна ${S.short(c.value)}</span>`;
  return `<span class="hn-rsale">${later ? 'продаж потім ≈' : 'продаж'} <b class="nw">${S.short(sale)}</b></span> <span class="hn-coll">· колекц. <span class="nw">${S.short(c.value)}</span></span>`;
}
function rewardText(rw) {
  if (!rw) return '';
  const parts = [];
  if (rw.money) parts.push(S.fmt(rw.money));
  if (rw.parts) parts.push(`Деталі ${S.TIER_BY_ID[rw.tier].name} ×${rw.parts}`);
  if (rw.car) parts.push(`Машина класу ${rw.car}`);
  if (rw.caseId) parts.push(`Кейс «${S.CASE_BY_ID[rw.caseId].name}»${rw.count > 1 ? ` ×${rw.count}` : ''}`);
  if (rw.seasonCar) parts.push(M(rw.seasonCar).name);
  if (rw.slots) parts.push(`+${rw.slots} ${plural(rw.slots, ['місце', 'місця', 'місць'])} в гаражі`);
  if (rw.cosmetic && S.cosmeticOf(rw.cosmetic)) parts.push(S.cosmeticOf(rw.cosmetic).name);
  if (rw.fuel) parts.push('Повний бак');
  return parts.join(' · ');
}

// ---------- header & navigation ----------
const TITLES = { garage: 'Гараж', cases: 'Кейси', race: 'Гонки', shop: 'Майстерня', menu: 'Меню' };
const PAGE_TITLES = { casino: 'Казино', upgrade: 'Апгрейд', collection: 'Колекція', plates: 'Номери', market: 'Ринок', trades: 'Обміни', tradeNew: 'Новий обмін', room: 'Кімната обміну', battles: 'Кейс-батли', battle: 'Батл', quests: 'Завдання', leaderboard: 'Рейтинг', store: 'Магазин', season: 'Сезон', tradein: 'Трейд-ін', friends: 'Друзі', promo: 'Промокоди', fair: 'Чесна гра', events: 'Сповіщення', achievements: 'Досягнення', support: 'Підтримка' };
function ring(level, xp, need, size = 40) {
  const r = size / 2 - 2, c = 2 * Math.PI * r, f = Math.min(1, xp / need);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#252c39" stroke-width="3"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}
let shownBalance = null;
function renderHeader() {
  // A gain counts up (after any flying coins have landed); spending just changes the number.
  const bal = $('#balance');
  if (shownBalance !== null && me.balance > shownBalance) FX.tween(bal, shownBalance, me.balance, 750, S.short, Math.max(0, coinsLandAt - performance.now()));
  else if (!bal.dataset.tweening || me.balance < shownBalance) (FX.stopTween(bal), bal.textContent = S.short(me.balance));
  shownBalance = me.balance;
  // The player's Telegram photo; without one the initial in the body font, and two letters ("Ве", "ОК") when the first
  // one looks like a class (В/B, А/A, С/C, Х/X, D, S), so the header can't be read as a class badge.
  const photo = tg?.initDataUnsafe?.user?.photo_url;
  const words = String(me.firstName || me.username || '?').replace(/^@/, '').trim().split(/\s+/);
  const first = (words[0][0] || '?').toUpperCase();
  const initials = !/[ВАСХBACDSX]/.test(first) ? first : words.length > 1 ? first + (words[1][0] || '').toUpperCase() : first + (words[0][1] || '').toLowerCase();
  $('#avatar').innerHTML = `${ring(me.level, me.xp, me.xpNeed)}<span class="face${photo ? ' photo' : ''}">${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : esc(initials)}</span><span class="lvl">${me.level}</span>`;
  paintGiftBadge(); // how many rewards wait (rewards center); first steps: one thing at a time
  $('#menuDot').hidden = !(me.incomingTrades || me.unread || claimableCollection() || me.newbie?.ready || me.achReady || me.season?.ready || me.questReady);
  $('#title').textContent = state.page ? PAGE_TITLES[state.page] : TITLES[state.tab];
  $('#title').classList.toggle('long', $('#title').textContent.length > 8);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === state.tab && !state.page);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('locked', !!TAB_FEATURE[b.dataset.tab] && !isOpen(TAB_FEATURE[b.dataset.tab]));
  if (tg?.initData && tg.BackButton) state.page ? tg.BackButton.show() : tg.BackButton.hide();
}
function go(page) {
  state.page = page;
  if (page === 'quests') state.questTabPicked = false;
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
  const qr = me?.questReady, qs = me?.questSplit;
  me = await api('me');
  me.questReady = qr; // quests aren't in `me`: kept from the last pulse / menu fetch
  me.questSplit = qs;
  if (state.page === 'quests') pulseSoon();
  if (state.hub) state.hub.at = 0; // the menu's live numbers refetch on its next render
  clockOffset = me.now - Date.now();
  if (rerender) render();
  else renderHeader();
  guideProgress();
  homeCheck(); // «Додай на головний екран» from the 3rd day (once a session; nothing on old clients)
  // Let a drop's celebration play out before the level-up popup covers it.
  const wait = state.fx ? 2600 : 0;
  setTimeout(() => {
    if (me.level > me.levelSeen && guideOn()) return levelToast();
    if (me.level > me.levelSeen && $('#modal').hidden && !state.opening && !state.race && !battleTimers.length && !WOW.isOpen()) showLevelUp();
  }, wait);
}
// During the first steps a level-up doesn't open a window over the path: a toast says it, the gift is already given.
async function levelToast() {
  const lvl = me.level;
  const opened = newUnlocks();
  me.levelSeen = lvl;
  toast(`Рівень ${lvl}! ${rewardText(S.levelReward(lvl))}${opened.length ? ` · Відкрито: ${opened.map((u) => u.name).join(', ')}` : ''}`);
  try {
    await api('level/seen');
  } catch {}
}
let renderSeq = 0;
async function render() {
  renderHeader();
  stopPoll(); // live pages (trade hall, room) start their own polling again in AFTER
  const seq = ++renderSeq;
  if (me?.guide === 'starter' && me.keys.starter && !state.drop) state.caseId = 'starter';
  const fn = state.page ? PAGES[state.page] : TABS[state.tab];
  const feat = state.page ? PAGE_FEATURE[state.page] : TAB_FEATURE[state.tab];
  const locked = feat && !isOpen(feat);
  try {
    const html = locked ? lockedView(feat) : await fn();
    if (seq !== renderSeq) return;
    $('#view').innerHTML = html;
    if (!locked) AFTER[state.page || state.tab]?.();
    paintGuide();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
const AFTER = {};
const TABS = {};
const PAGES = {};

// ---------- progressive unlock (S.UNLOCKS; the server says what is open in me.unlocked) ----------
// Locked things stay in sight with a lock and the level they open at, so there's something to look forward to.
const isOpen = (key) => !S.UNLOCK_BY_KEY[key] || !!me.unlocked?.includes(key);
const casinoOff = () => me.casino === 'off';
const lockChip = (key) => `<span class="lockchip">${ic('lock')} рів. ${S.unlockLevel(key)}</span>`;
// Pages and the tab behind a feature: opening them while locked shows the lock card instead.
const PAGE_FEATURE = { plates: 'plates', market: 'market', tradein: 'tradein', trades: 'trades', tradeNew: 'trades', room: 'trades', battles: 'battles', battle: 'battles', upgrade: 'upgrade', casino: 'casino' };
const TAB_FEATURE = { shop: 'parts' };
function lockBody(key) {
  const u = S.UNLOCK_BY_KEY[key];
  if (key === 'casino' && casinoOff()) return `<div class="center lockcard"><span class="lockic">${ic('lock')}</span><b class="big">${u.name}</b><div class="muted mt">Казино зараз вимкнено.</div></div>`;
  const next = S.UNLOCKS.filter((x) => x.level > me.level && x.key !== key).slice(0, 3);
  return `<div class="center lockcard"><span class="lockic">${ic(u.icon)}<i>${ic('lock')}</i></span><b class="big">${u.name}</b><div class="muted">${esc(u.text)}</div>
    <div class="chip mt">${ic('lock')} Відкриється на рівні ${u.level}</div>
    <div class="progress mt"><i style="width:${Math.min(100, ((me.level - 1 + me.xp / me.xpNeed) / (u.level - 1)) * 100)}%"></i></div>
    <div class="tiny muted mt">Ти на рівні ${me.level}. Досвід дають гонки, завдання, нові машини й кейси.</div></div>
    ${next.length ? `<div class="h2"><span>Далі відкриються</span></div><div class="list">${next.map((x) => `<div class="li"><span class="ic">${ic(x.icon)}</span><div class="grow"><b>${x.name}</b><div class="tiny muted">${esc(x.text)}</div></div>${lockChip(x.key)}</div>`).join('')}</div>` : ''}`;
}
function lockedSheet(key) {
  haptic('light');
  sheet('', lockBody(key));
}
H.locked = (d) => lockedSheet(d.k);
const lockedView = (key) => `<div class="card">${lockBody(key)}</div>`;
// The next feature on the ladder and how far it is (xp to its level, and the same in race wins, S.XP.win each).
function nextUnlock() {
  const all = S.UNLOCKS.filter((u) => u.level > me.level && !isOpen(u.key) && !(u.key === 'casino' && casinoOff()));
  if (!all.length) return null;
  const level = all[0].level, at = all.filter((u) => u.level === level);
  let left = Math.max(0, me.xpNeed - me.xp), total = me.xpNeed;
  for (let l = me.level + 1; l < level; l++) (left += S.xpForLevel(l)), (total += S.xpForLevel(l));
  return { u: at[0], names: at.map((u) => u.name), level, left, wins: Math.max(1, Math.ceil(left / S.XP.win)), share: total ? 1 - left / total : 0 };
}
// «Ще 3 перемоги → Ринок» when it's a few races away, else «Рів. 4 через ~350 досвіду → Фарбування».
function nextUnlockText(nu) {
  if (nu.wins <= 12) return `Ще ${nu.wins} ${plural(nu.wins, ['перемога', 'перемоги', 'перемог'])} → ${nu.names[0]}`;
  return `Рів. ${nu.level} через ~${S.fmt(Math.ceil(nu.left / 10) * 10).replace(' ₴', '')} досвіду → ${nu.names[0]}`;
}
// A slim chip on top of Гараж and Кейси (where players look), when the «Перші кроки» pill isn't there: tap → what it opens.
function paintNextUnlock() {
  $('#nextUl')?.remove();
  if (!me || state.page || state.race || state.drift || state.opening || !['garage', 'cases'].includes(state.tab)) return;
  if (state.tab === 'cases' && state.drop?.some(dropAlive)) return;
  const nu = nextUnlock();
  if (!nu) return;
  const el = document.createElement('button');
  el.id = 'nextUl';
  el.className = 'nextul';
  el.dataset.act = 'locked';
  el.dataset.k = nu.u.key;
  el.setAttribute('aria-label', `${nextUnlockText(nu)}: що відкриється`);
  el.innerHTML = `<span class="nu-ic">${ic(nu.u.icon)}<i>${ic('lock')}</i></span><span class="nu-t">${esc(nextUnlockText(nu))}${nu.names.length > 1 ? ` <small>+${nu.names.length - 1}</small>` : ''}</span>${nu.wins <= 12 ? `<span class="nu-lv">рів. ${nu.level}</span>` : ''}
    <span class="nu-bar"><i style="width:${Math.round(nu.share * 100)}%"></i></span>`;
  $('#view').prepend(el);
}

// ---------- trade-in (S.TRADE_IN) ----------
PAGES.tradein = () => {
  const T = (state.tradein ||= { cars: new Set(), result: null });
  const garage = me.cars.filter((c) => c.status === 'garage' && !M(c.model).secret && !S.isCollector(c.model)).sort((a, b) => b.value - a.value || b.id - a.id);
  for (const id of [...T.cars]) if (!garage.some((c) => c.id === id)) T.cars.delete(id);
  const picked = [...T.cars].map((id) => garage.find((c) => c.id === id));
  const cls = picked[0] ? M(picked[0].model).cls : null;
  const up = cls ? S.CLASS_ORDER[S.rankOf(cls) + 1] : null;
  const ready = picked.length === S.TRADE_IN.cars;
  const r = T.result;
  const result = r ? `<div class="card center ${state.fx?.type === 'tradein' ? 'pop' : ''}"><div class="small muted">${r.win ? 'Дилер дав клас вище!' : 'Цього разу той самий клас'}</div>
      <div class="art" style="height:100px" id="tiArt">${carArt(r.car.model, { glow: r.win })}</div><b style="font-size:17px">${esc(M(r.car.model).name)}</b> ${clsBadge(r.to)}${r.isNew ? `<div class="small" style="color:var(--accent)">${ic('sparkles')} Нова в колекції</div>` : ''}
      <div class="small muted">${rowMoney(r.car)}</div></div>` : '';
  return `${result}<div class="card"><b>${ic('refresh')} Трейд-ін у дилера</b>
      <div class="small muted mt">Віддай ${S.TRADE_IN.cars} машини одного класу — отримаєш одну: з шансом <b>${Math.round(S.TRADE_IN.chance * 100)}%</b> класу вище, інакше того ж класу. Деталі й номери повертаються на склад. Зручно позбутися дублів.</div>
      ${cls ? `<div class="row mt" style="gap:8px;flex-wrap:wrap"><span class="chip">${clsBadge(cls)} ×${picked.length}</span><span class="muted">→</span>${up && up !== 'X' ? `<span class="chip">${clsBadge(up)} ${Math.round(S.TRADE_IN.chance * 100)}%</span><span class="chip">${clsBadge(cls)} ${100 - Math.round(S.TRADE_IN.chance * 100)}%</span>` : '<span class="chip">вище немає</span>'}</div>` : ''}
      <button class="btn yellow mt" data-act="tradeInGo" ${ready && up && up !== 'X' ? '' : 'disabled'}>${ready ? 'Обміняти' : `Обери ще ${S.TRADE_IN.cars - picked.length}`}</button></div>
    <div class="h2"><span>Твої машини</span><span>${cls ? `лише клас ${cls}` : 'одного класу'}</span></div>
    ${garage.length ? `<div class="grid">${garage.map((c) => carTile(c, { act: 'tradeInPick', sel: T.cars.has(c.id) })).join('')}</div>` : emptyBox('building-warehouse', 'Гараж порожній', 'Для трейд-іну потрібні 3 машини одного класу')}`;
};
H.tradeInPick = (d) => {
  const T = state.tradein, id = Number(d.id);
  const c = me.cars.find((x) => x.id === id);
  T.result = null;
  if (T.cars.has(id)) T.cars.delete(id);
  else {
    const first = [...T.cars][0] && me.cars.find((x) => x.id === [...T.cars][0]);
    if (first && M(first.model).cls !== M(c.model).cls) return toast('Усі три мають бути одного класу', true);
    if (T.cars.size >= S.TRADE_IN.cars) return toast(`Рівно ${S.TRADE_IN.cars} машини`, true);
    if (me.cars.filter((x) => x.status === 'garage').length - T.cars.size <= 1) return toast('У гаражі має залишитися хоча б одна машина', true);
    T.cars.add(id);
  }
  render();
};
H.tradeInGo = async () => {
  const T = state.tradein;
  const picked = [...T.cars].map((id) => me.cars.find((c) => c.id === id));
  if (!(await confirmBox(`Віддати дилеру: ${picked.map((c) => M(c.model).name).join(', ')}?`))) return;
  const r = await act('dealer/tradein', { carIds: [...T.cars] }, null, { rerender: false });
  if (!r) return;
  T.cars = new Set();
  T.result = r;
  state.fx = { type: 'tradein' };
  haptic(r.win ? 'heavy' : 'medium');
  await refresh();
};
AFTER.tradein = () => {
  if (state.fx?.type !== 'tradein' || !state.tradein?.result) return;
  state.fx = null;
  const r = state.tradein.result;
  if (r.win) setTimeout(() => FX.reveal(S.rankOf(r.to), S.CLASSES[r.to].color, { host: $('#tiArt')?.parentElement, target: $('#tiArt') }), 150);
};

// ---------- level up, profile, rewards ----------
// What the level-ups since the last one seen opened (S.UNLOCKS), the casino left out while the owner keeps it off.
const newUnlocks = () => S.unlocksBetween(me.levelSeen, me.level).filter((u) => isOpen(u.key));
function showLevelUp() {
  const rw = S.levelReward(me.level);
  const opened = newUnlocks();
  // Seen as soon as it is shown: closing with ✕ or a tap outside must not bring it back on the next refresh.
  me.levelSeen = me.level;
  api('level/seen').catch(() => {});
  const nextU = S.UNLOCKS.find((u) => u.level > me.level && isOpen(u.key) === false && !(u.key === 'casino' && casinoOff()));
  sheet('', `<div class="center"><div class="ring">${ring(me.level, 1, 1, 84)}<span class="face">${me.level}</span></div>
    <div class="big mt">Рівень ${me.level}!</div><div class="muted">подарунок уже в тебе</div>
    <div class="card mt"><b class="win">${esc(rewardText(rw))}</b></div>
    ${opened.length ? `<div class="h2 unlocked-h"><span>${ic('sparkles')} Відкрито</span></div><div class="list unlocked">${opened.map((u) => `<div class="li"><span class="ic tint" style="--c:#ffc400">${ic(u.icon)}</span><div class="grow left"><b>${u.name}</b><div class="tiny muted">${esc(u.text)}</div></div></div>`).join('')}</div>` : ''}
    ${nextU ? `<div class="tiny muted mt">Далі: ${nextU.name} — на рівні ${nextU.level}</div>` : ''}
    <button class="btn mt" data-act="levelOk">Чудово</button></div>`);
  haptic('success');
  celebrateSheet($('#sheet .ring'), ['#f5b301', '#ffd500', '#ffffff', '#34c759']);
}
H.levelOk = () => closeModal();
// A celebratory moment for a sheet that just opened (level-up, set done, reward): the hero element pops with a
// burst of stars and a little confetti, plus a fanfare.
function celebrateSheet(el, colors, { confetti = 0.6 } = {}) {
  requestAnimationFrame(() => {
    if (!el?.isConnected) return;
    FX.popEl(el, 1.18, 520);
    FX.burst(...FX.centerOf(el), colors, { count: 50, power: 8, shape: 'mix' });
    if (confetti) FX.confetti(colors, confetti);
    SFX.fanfare();
    haptic('heavy');
  });
}
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
    <div class="list">${list.map((s, i) => [s, i]).sort(([a, i], [b, j]) => (b.reached > b.claimed) - (a.reached > a.claimed) || i - j).map(([s]) => {
      const a = S.ACH_BY_KEY[s.key];
      const next = Math.min(s.claimed, a.goals.length - 1), done = s.claimed >= a.goals.length;
      const goal = a.goals[next], prog = Math.min(1, (s.value || 0) / goal);
      const val = a.money ? `${S.short(s.value)} / ${S.short(goal)}` : a.labels ? '' : `${Math.min(s.value, goal)} / ${goal}`;
      return `<div class="card ach-row">${achBadge(s, 'lg')}
        <div class="grow"><b>${esc(a.title)}</b>${s.claimed ? ` <span class="tiny" style="color:${S.ACH_TIERS[s.claimed - 1].color}">${S.ACH_TIERS[s.claimed - 1].name}</span>` : ''}
          <div class="small muted">${done ? 'Усі рівні пройдено!' : esc(countFix(S.achText(a, next)))}</div>
          <div class="ach-dots">${a.goals.map((g, i) => `<i style="${i < s.claimed ? `background:${S.ACH_TIERS[i].color}` : i < s.reached ? 'background:var(--accent)' : ''}">${!done && i === next && i >= s.reached ? `<b style="width:${prog * 100}%"></b>` : ''}</i>`).join('')}</div>
          ${done ? '' : `<div class="row between tiny muted mt"><span>${val}</span><span>${ic('gift')} ${esc(S.achRewardText(a.rewards[next]))}</span></div>`}</div>
        ${s.reached > s.claimed ? `<button class="btn sm yellow" data-act="achClaim" data-k="${s.key}">Забрати</button>` : ''}</div>`;
    }).join('')}</div>`;
};
H.achClaim = (d) => act('ach/claim', { key: d.k }, (r) => `Досягнення: ${r.text}`);
H.achClaimAll = () => act('ach/claim', {}, (r) => `${r.tiers} досягнень: ${r.text}`);

// "3 год 12 хв" / "12 хв" — time spent with the game open.
const playTime = (ms) => {
  const m = Math.floor((ms || 0) / 60e3);
  return m >= 60 ? `${Math.floor(m / 60)} год ${m % 60} хв` : `${m} хв`;
};
// ---------- the player card: «Ліцензія пілота» ----------
// One card for me and for any other player: the frame takes the colour of the best car's class (the same class
// lighting as everywhere), the initial sits in a metal frame inside the level ring, stamps for VIP / season places /
// first-days players, the three dearest cars in lit bays and four numbers on a timing board.
const collPct = (have) => Math.round((have / S.ALL_MODELS.filter((m) => !m.secret).length) * 100);
function licenceCard(p) {
  const top = (p.top || []).filter((c) => M(c.model)).slice(0, 3);
  const best = top[0] && M(top[0].model);
  const rank = best ? S.rankOf(best.cls) : 0, color = best ? S.CLASSES[best.cls].color : '#9aa4b2';
  // Collection-set badges: the two hardest as stamps, the rest as one "+N сетів" stamp (badges come tier-first).
  const setB = (p.badges || []).filter((b) => b.key?.startsWith('set:'));
  const stamps = [
    p.vip ? `<span class="lstamp vip">${ic('crown')}VIP</span>` : '',
    ...(p.badges || []).filter((b) => !b.key?.startsWith('set:')).map((b) => `<span class="lstamp" style="--bc:${BADGE_COLORS[b.tier] || '#8e8e93'}">${ic('trophy')}${esc(b.title)}</span>`),
    ...setB.slice(0, 2).map((b) => `<span class="lstamp" style="--bc:${SET_TIER_COLORS[b.tier] || '#8e8e93'}">${ic('books')}${esc(b.title)}</span>`),
    setB.length > 2 ? `<span class="lstamp" style="--bc:#c3cad6">${ic('books')}+${setB.length - 2} ${plural(setB.length - 2, ['сет', 'сети', 'сетів'])}</span>` : '',
    p.legacy ? `<span class="lstamp legacy">${ic('heart')}Гравець з перших днів</span>` : '',
  ].join('');
  const bay = (c, i) => {
    const m = M(c.model), r = S.rankOf(m.cls);
    return `<div class="lbay ${i === 0 ? 'main' : ''} r${r}" style="--c:${S.CLASSES[m.cls].color}"><div class="art">${carArt(c.model, { glow: i === 0 && r >= 3, look: c.look })}</div>
      <div class="lbay-tx">${clsBadge(m.cls)}<b class="ellipsis">${esc(m.name)}</b><span>${S.short(c.value)}</span></div></div>`;
  };
  const xpFrac = p.xpNeed ? p.xp / p.xpNeed : 1;
  return `<div class="licence r${rank}${styleCls('gl', p.style?.glow)}" style="--c:${color}">
    <div class="lic-top"><span class="lic-brand">АВТОДРОП</span><span class="lic-kind">Ліцензія пілота</span><span class="lic-id">№ ${p.id}</span></div>
    <div class="lic-who"><div class="lic-ava">${ring(p.level, xpFrac, 1, 76)}<span class="face">${esc(initialOf(p.name))}</span><span class="lvl">${p.level}</span></div>
      <div class="grow"><div class="lic-name ellipsis">${nameHtml(p.name, p.style)}</div><div class="lic-sub">Рівень ${p.level}${best ? ` · найкраща: ${esc(best.name)}` : ''}</div>
        ${stamps ? `<div class="lic-stamps">${stamps}</div>` : ''}</div></div>
    ${top.length ? `<div class="lic-bays n${top.length}">${top.map(bay).join('')}</div>` : `<div class="lic-nobay">${ic('car')} Гараж поки порожній</div>`}
    <div class="lic-stats"><div><b>${S.short(p.value)}</b><span>колекц. гаража</span></div><div><b>${p.cases ?? '—'}</b><span>кейсів</span></div><div><b>${p.wins ?? '—'}</b><span>перемог</span></div><div><b>${p.coll}%</b><span>колекція</span></div></div>
  </div>`;
}
H.shareCard = async () => {
  const text = `Моя ліцензія пілота в АВТОДРОП: рівень ${me.level}, гараж ${S.short(me.stats.value)}, колекція ${collPct(me.collection.filter((id) => !M(id)?.secret).length)}%. Наздоженеш?`;
  let link = '';
  try {
    link = (await api('ref')).link || '';
  } catch {}
  if (link) return H.shareRef({ link, text });
  navigator.clipboard?.writeText(text).then(() => toast('Текст картки скопійовано'), () => toast(text));
};
function openProfile() {
  const have = me.collection.filter((id) => !M(id)?.secret).length, total = S.ALL_MODELS.filter((m) => !m.secret).length;
  const top = [...me.cars].filter((c) => c.status !== 'auction' && c.status !== 'market').sort((a, b) => b.value - a.value);
  const card = licenceCard({ id: me.id, name: me.username ? '@' + me.username : me.firstName || 'Гравець', level: me.level, xp: me.xp, xpNeed: me.xpNeed, vip: me.vip, badges: me.badges, legacy: me.legacy, style: me.style,
    top, value: me.stats.value, cases: me.stats.cases, wins: me.stats.wins, coll: collPct(have) });
  const boss = (me.badges || []).find((b) => b.key === 'boss');
  sheet('Профіль', `${card}${boss ? emojiOffer(boss.title) : ''}
    <div class="btns mt"><button class="btn ghost btn2" data-act="shareCard"><span>${ic('share')} Поділитися</span><small>картка гравця</small></button><button class="btn ghost btn2" data-act="go" data-page="season"><span>${ic('ticket')} Пропуск</span><small>рівень ${me.season.level}/${S.SEASON.levels}</small></button></div>
    <div class="card xpcard mt"><div class="row between"><span class="hook-t">${ic('sparkles')} До ${me.level + 1} рівня</span><b>${S.fmt(me.xp).replace(' ₴', '')}<small> / ${S.fmt(me.xpNeed).replace(' ₴', '')}</small></b></div>
      <div class="progress mt"><i style="width:${(me.xp / me.xpNeed) * 100}%"></i></div>
      <div class="row between tiny muted mt"><span>Подарунок за рівень: <b class="win">+${S.short(S.levelReward(me.level + 1).money)}</b></span><span>сьогодні ${me.xpToday}/${S.DAILY_XP_CAP} за кейси й деталі</span></div>
      ${(() => {
        const nx = S.UNLOCKS.filter((u) => !isOpen(u.key) && !(u.key === 'casino' && casinoOff()));
        const lvl = nx[0]?.level;
        return lvl ? `<div class="tiny muted mt">${ic('lock')} На рівні ${lvl} відкриється: <b>${nx.filter((u) => u.level === lvl).map((u) => u.name).join(', ')}</b></div>` : '';
      })()}</div>
    ${firstStepsCard('newbieClaim')}
    <div class="h2"><span>Статистика</span></div>
    <div class="stat"><div><b>${me.used}</b><span>у гаражі</span></div><div><b>${have}/${total}</b><span>колекція</span></div><div><b>${me.stats.races ? Math.round((me.stats.wins / me.stats.races) * 100) : 0}%</b><span>перемог</span></div>
    <div><b>${me.stats.wins}/${me.stats.races}</b><span>перемог/гонок</span></div><div><b>${me.stats.merges}</b><span>злиттів</span></div><div><b>${playTime(me.stats.playMs)}</b><span>у грі</span></div></div>
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
  let r, p;
  try {
    // the claims of a fresh pulse: «Забрати все» lists exactly what is ready now
    [r, p] = await Promise.all([api('rewards'), api('pulse').catch(() => null)]);
  } catch (e) {
    return toast(e.message, true);
  }
  if (p) setRewardClaims(p.claims);
  const caseReady = serverNow() >= r.rewardCaseAt;
  const doneUpTo = r.ready ? r.nextDay - 1 : r.todayIndex + 1;
  const rc = result?.car ? S.CLASSES[M(result.car.model).cls].color : '';
  sheet('Нагороди', `${result ? `<div class="card center reward-res pop">${result.car ? `<div class="reveal-wrap r${S.rankOf(M(result.car.model).cls)}" style="--c:${rc};height:110px"><div class="art">${carArt(result.car.model, { glow: true })}</div></div><b class="disp rr-name">${esc(M(result.car.model).name)}</b>` : `<span class="rr-ic">${ic('gift')}</span>`}
      <div class="small muted">${esc(result.title)}</div><div class="rr-text win">${esc(result.text)}</div></div>` : ''}
    ${rewardsAllCard()}
    <div class="h2"><span>Щоденний бонус</span><span>день ${r.ready ? r.nextDay : r.todayIndex + 1} з ${r.days.length}</span></div>
    <div class="card"><div class="days">${r.days.map((d, i) => {
      const e = ic(d.money ? 'coin' : d.parts ? 'tool' : d.car ? 'car' : 'box');
      const label = d.money ? S.short(d.money).replace(' ₴', '') : d.parts ? `Деталі ×${d.parts}` : d.label;
      const today = r.ready && i === r.nextDay - 1;
      return `<div class="day ${d.big ? 'big' : ''} ${today ? 'today' : ''} ${i < doneUpTo ? 'done' : ''}"><small>День ${i + 1}</small><div class="e">${i < doneUpTo ? ic('check') : e}</div><b>${esc(label)}</b>${d.caseId ? `<small class="day-cls">машина ${S.caseClassSpan(d.caseId)}</small>` : ''}</div>`;
    }).join('')}</div>
    ${r.ready ? `<div class="day-now">${ic('gift')} <b>День ${r.nextDay}</b> — ${esc(S.dailyText(r.days[r.nextDay - 1]))}</div>` : ''}
    <div class="tiny muted mt">Заходь щодня: на 5-й і 10-й день — машина, на 7-й — кейс «Спорткар» (машина ${S.caseClassSpan('sport')}), на 14-й — кейс «Еліта» (машина ${S.caseClassSpan('elite')}). Кейс відкривається одразу після «Забрати». Новий день — опівночі за Києвом. Пропустив день — нічого не згорає, продовжиш з того ж місця.</div>
    ${r.vip ? `<div class="tiny mt" style="color:var(--accent)">${ic('crown')} VIP: ще +${S.short(r.vipDaily)} щодня до бонусу</div>` : `<div class="tiny muted mt">${ic('crown')} VIP додає ще +${S.short(r.vipDaily)} щодня</div>`}
    <button class="btn mt" data-act="claimDaily" ${r.ready ? '' : 'disabled'}>${r.ready ? `Забрати · день ${r.nextDay}${r.days[r.nextDay - 1].caseId ? ' · відкрити кейс' : ''}` : 'Наступний опівночі · <span data-until="' + (S.kyivMidnightOf(S.kyivDateOf(serverNow()), 1) - clockOffset) + '"></span>'}</button></div>
    <div class="h2"><span>Кейс нагород</span><span>раз на ${S.REWARD_CASE_HOURS} год</span></div>
    <div class="card row"><span class="ic tint" style="--c:#ffc400">${ic('gift')}</span><div class="grow"><b>Кейс нагород</b><div class="small muted">Гроші, деталь, повний бак або машина</div></div>
      ${caseReady ? '<button class="btn sm" data-act="claimRewardCase">Відкрити</button>' : `<span class="chip" data-until="${r.rewardCaseAt - clockOffset}"></span>`}</div>
    <div class="h2"><span>Колекція</span></div>
    <div class="list"><button class="li" data-act="go" data-page="collection"><span class="ic">${ic('books')}</span><div class="grow"><b>Нагороди за колекцію</b><div class="small muted">Збирай машини й цілі країни</div></div>${claimableCollection() ? '<span class="badge" style="position:static">!</span>' : `<span class="chev">${ic('chevron-right')}</span>`}</button></div>`);
  tickUntil();
  if (result) {
    const res = $('#sheet .reward-res');
    if (result.car) {
      const rk = S.rankOf(M(result.car.model).cls);
      setTimeout(() => (FX.dropShow(rk, rc, { host: res?.querySelector('.reveal-wrap'), target: res?.querySelector('.art') }), SFX.pop(rk), rk >= 3 && SFX.rare(rk)), 300);
    } else setTimeout(() => (FX.sparkle(res, ['#ffd500', '#ffffff', '#34c759'], 12), FX.popEl(res?.querySelector('.rr-ic'), 1.25, 450), SFX.win()), 300);
  }
}
// A car or a case of the daily bonus (days 5/7/10/14) is revealed like a case drop (revealRewards); money and parts
// show in the rewards window.
H.claimDaily = async () => {
  const r = await act('rewards/daily', {}, null, { rerender: false });
  if (!r) return;
  pulseSoon();
  const day = ((r.streak - 1) % S.DAILY_BONUS.length) + 1, rw = r.reward;
  if (rw.carOut || rw.caseId) {
    if (rw.vip) toast(`${ic('crown')} VIP: +${S.short(rw.vip)}`);
    const title = `Щоденний бонус · день ${day}`;
    return revealRewards([rw.carOut ? { kind: 'car', car: rw.carOut, isNew: rw.isNew, title } : { kind: 'key', caseId: rw.caseId, count: rw.count || 1, title }]);
  }
  openRewards({ title: `День ${day}`, text: rewardText(rw) + (rw.items ? ': ' + rw.items.map((p) => S.PARTS[p.type].name).join(', ') : '') + (rw.vip ? ` + VIP ${S.short(rw.vip)}` : '') });
};
// The reward case: a 2-second strip of what it can give stops on what came (the coins fly only then).
H.claimRewardCase = async () => {
  const fromSheet = !$('#modal').hidden;
  const r = await claimQuiet('rewards/case');
  if (!r) return;
  pulseSoon();
  await revealRewards([{ kind: 'rcase', reward: r.reward, title: 'Кейс нагород' }]);
  if (fromSheet && !rvl) openRewards();
};
function tickUntil() {
  document.querySelectorAll('[data-until]').forEach((el) => (el.textContent = left(Number(el.dataset.until) - Date.now())));
}
setInterval(tickUntil, 1000);

// ---------- garage ----------
// Per-car income exactly as the server counts it (S.garageIncome): who earns (the best up to the free slots), the
// country and set bonuses, dirt and shine. Cheap, but tiles call it per car, so it's kept for one `me` and 10 s.
let incCache = null;
function garageInc() {
  const t = serverNow();
  if (incCache && incCache.me === me && Math.abs(t - incCache.t) < 10e3) return incCache.g;
  const g = S.garageIncome({
    cars: me.cars.map((c) => ({ ...c, plateValue: c.plate?.value || 0, dirtAt: me.now })),
    slots: me.slots, claimed: me.claims.filter((k) => k.startsWith('set:')).map((k) => k.slice(4)), t, cut: isOpen('wash'),
  });
  incCache = { me, t, g };
  return g;
}
const carInc = (c) => garageInc().cars[c.id] || null;
const sPct = (x) => `${x > 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`;
// «1 год 20 хв», «35 хв», «<1 хв»
function hm(ms) {
  const m = Math.ceil(Math.max(0, ms) / 60e3), h = Math.floor(m / 60);
  return m < 1 ? '<1 хв' : h ? `${h} год${m % 60 ? ` ${m % 60} хв` : ''}` : `${m} хв`;
}
const noRmb = (n) => S.short(n).replace(' ₴', '');
// The cash line under the bar: how much is in, the cap, and when it's full (then income stops until collected).
function capState(pending) {
  const i = me.income, cap = i.rate * i.capH;
  const full = i.rate > 0 && pending >= cap - 1;
  const text = !i.rate ? `Каса на ${i.capH} год · машини в гаражі наповнюють її щогодини`
    : `Каса: ${noRmb(Math.min(pending, Math.max(cap, pending)))} / ${S.short(cap)} · ${full ? '<b>повна — забери</b>' : `повна через ${hm(((cap - pending) / i.rate) * 3600e3)}`}`;
  return { full, text };
}
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
      <div class="grid${showcaseBackdrop()}">${cars.map((c) => carTile(c)).join('')}${Array.from({ length: free }, () => '<button class="slot" data-act="showcasePick">+ Виставити машину</button>').join('')}
      ${me.showcaseSlots < S.SHOWCASE_MAX ? `<button class="slot buy" data-act="buyShowcase">+<span>Місце на вітрині</span><b>${S.short(S.showcaseCost(me.showcaseSlots))}</b></button>` : ''}</div>`;
  }
  const i = me.income;
  const pending = pendingNow();
  const fill = i.rate ? Math.min(100, (pending / (i.rate * i.capH)) * 100) : 0;
  const nextCap = S.nextCapOffer(me.capLevel, i.capH); // with VIP / comeback hours: the real next cap, never smaller
  const capPlus = nextCap?.extra ? ` (${nextCap.base} + ${nextCap.extra} ${me.vip ? 'VIP' : 'бонус'})` : '';
  const cs = capState(pending);
  const all = me.cars.filter((c) => c.status !== 'showcase');
  const rk = (c) => S.rankOf(M(c.model).cls);
  const shown = (c) => S.saleOf(c) ?? c.value; // the number on the tile (the sale), so «За ціною» reads in order
  const sorts = { value: (a, b) => shown(b) - shown(a) || b.value - a.value, class: (a, b) => rk(b) - rk(a) || b.value - a.value, new: (a, b) => b.id - a.id };
  const sort = sorts[state.garageSort] ? state.garageSort : 'value';
  const present = S.CLASS_ORDER.filter((k) => all.some((c) => M(c.model).cls === k)).reverse();
  if (state.garageCls && !present.includes(state.garageCls)) state.garageCls = null;
  const cars = all.filter((c) => !state.garageCls || M(c.model).cls === state.garageCls).sort(sorts[sort]);
  const total = all.reduce((s, c) => s + c.value, 0);
  const sel = state.selling;
  const selTotal = sel ? sellTotal(cars.filter((c) => sel.has(c.id))) : 0;
  const free = Math.max(0, me.slots - all.length);
  const SORT_NAMES = { value: 'За ціною', class: 'За класом', new: 'Нові' };
  return seg + `${overfullHtml()}
  <div class="card income ${cs.full ? 'full' : ''}" id="incomeCard">
    <div class="row between small muted"><span>${ic('coin')} Дохід гаража</span><span class="rate"><b>${S.short(i.rate)}</b> / год</span></div>
    <div class="big" id="pending">${S.fmt(pending)}</div>
    <div class="progress cap mt"><i id="capBar" style="width:${fill}%"></i></div>
    <div class="cap-line" id="capLine">${cs.text}</div>
    <button class="btn mt" data-act="collect" ${pending < 1 ? 'disabled' : ''}>Забрати</button>
    ${i.comebackUntil ? `<div class="tiny center mt" style="color:#30d158">${ic('gift')} Подарунок повернення: +${S.COMEBACK.capHours} год сховища ще <span data-until="${i.comebackUntil - clockOffset}"></span></div>` : ''}
    ${nextCap ? `<div class="cap-up"><span class="tiny muted">Повна каса не росте — поки не забереш, дохід стоїть.</span><button class="btn outline sm" data-act="upgradeCap">${ic('clock')} Каса на ${nextCap.hours} год${capPlus} · ${S.short(nextCap.cost)}</button></div>` : ''}
    <div class="tiny muted center mt cap-more">Каса вміщує ${i.capH} год доходу${nextCap ? ` · <a data-act="upgradeCap" style="color:#f5b301">збільшити до ${nextCap.hours} год${capPlus} — ${S.short(nextCap.cost)}</a>` : ''}</div>
  </div>
  ${dreamCard()}
  ${washHint(all)}
  <div class="h2 garage-h"><span>Машини <b>${all.length}</b>/${me.slots}</span>${all.length ? `<button class="hn-gsum" data-act="honestHelp"><span>Продаж усього гаража: <b>${S.short(sellTotal(all.filter((c) => !M(c.model).secret)))}</b></span><small>колекційна ціна ${S.short(total)} ${ic('info-circle')}</small></button>` : ''}</div>
  ${all.length > 1 ? `${present.length > 1 ? `<div class="chips gfilter"><button class="${state.garageCls ? '' : 'on'}" data-act="gFilter" data-k="">Усі</button>${present.map((k) => `<button class="${state.garageCls === k ? 'on' : ''}" data-act="gFilter" data-k="${k}" style="--c:${S.CLASSES[k].color}"><i></i>${k}<small>${all.filter((c) => M(c.model).cls === k).length}</small></button>`).join('')}</div>` : ''}
    <div class="row between sellbar">${sel ? `<span class="small muted">${sel.size ? `Обрано ${sel.size} · ${S.fmt(selTotal)}` : `Обери машини. Продаж: ${Math.round(Math.min(...Object.values(S.SELL_RATES)) * 100)}–${Math.round(Math.max(...Object.values(S.SELL_RATES)) * 100)}% ціни моделі, деталі й номер повертаються`}</span>` : `<button class="gsort" data-act="gSort">${ic('adjustments')}${SORT_NAMES[sort]}</button>`}
    <span class="row">${sel ? `<button class="btn sm red" data-act="sellSel" ${sel.size ? '' : 'disabled'}>Продати</button>` : ''}<button class="btn sm ghost" data-act="sellMode">${sel ? 'Скасувати' : `${ic('cash')} Продати кілька`}</button></span></div>` : ''}
  <div class="grid">${cars.map((c) => carTile(c, { sel: sel?.has(c.id), act: sel ? 'selToggle' : 'car', collLine: true, incLine: true })).join('')}
    ${free && !state.garageCls ? `<button class="slot free" data-act="toCases"><span class="slot-plus">${ic('plus')}</span><b>${free} ${plural(free, ['вільне місце', 'вільні місця', 'вільних місць'])}</b><span class="tiny">Відкрити кейс ${ic('arrow-right')}</span></button>` : ''}
    ${me.slots < S.MAX_SLOTS && !state.garageCls ? `<button class="slot buy" data-act="buySlot"><span class="slot-plus">${ic('building-warehouse')}</span><span>Місце в гаражі</span><b>${S.short(S.slotCost(me.slots))}</b></button>` : ''}</div>`;
};
H.gView = (d) => (state.garageView = d.k, render());
H.gFilter = (d) => (state.garageCls = d.k || null, render());
H.gSort = () => {
  const order = ['value', 'class', 'new'];
  state.garageSort = order[(order.indexOf(state.garageSort || 'value') + 1) % order.length];
  render();
};
H.toCases = () => (state.tab = 'cases', state.page = null, window.scrollTo(0, 0), render());
H.collect = () => act('collect', {}, (r) => `+${S.fmt(r.got)}`);
// Purchases confirm with a second tap on the same button (no pop-up), so several slots can be bought in a row.
H.buySlot = (d, el) => armed(el, `<b>Точно купити?</b><span>${S.short(S.slotCost(me.slots))}</span>`) && act('buy-slot', {}, `Місце додано · тепер ${me.slots + 1}`);
H.upgradeCap = (d, el) => {
  const n = S.nextCapOffer(me.capLevel, me.income.capH);
  if (n && armed(el, `Точно? до ${n.hours} год за ${S.short(n.cost)}`)) act('upgrade-cap', {}, 'Сховище покращено');
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
  const cs = capState(p), line = $('#capLine');
  if (line && line.innerHTML !== cs.text) line.innerHTML = cs.text;
  $('#incomeCard')?.classList.toggle('full', cs.full);
}, 1000);
function pickCar(title, onPick, filter = (c) => c.status === 'garage', back = null) {
  const list = me.cars.filter(filter);
  H.pickedCar = (d) => {
    closeModal();
    onPick(Number(d.id));
  };
  sheet(title, list.length ? `<div class="grid">${list.map((c) => carTile(c, { act: 'pickedCar' })).join('')}</div>` : emptyBox('car', 'Немає доступних авто', 'Підходять лише машини в гаражі, не на ринку й не на аукціоні'), back);
}

// ---------- car sheet ----------
function carSheet(id, best = null) {
  const c = me.cars.find((x) => x.id === Number(id));
  if (!c) return closeModal();
  const m = M(c.model);
  const minTier = S.minTierFor(m.cls);
  const locked = c.status === 'market' || c.status === 'auction';
  const rank = S.rankOf(m.cls), color = S.CLASSES[m.cls].color;
  sheet(esc(m.name), `
    <div class="rarity-row sheet-tags"><span class="stamp r${rank}" style="--c:${color}"><b>${m.cls}</b>${S.CLASSES[m.cls].name}</span>${originChip(c.model)}<span class="chip">${m.year}</span>${dirtTag(c)}</div>
    <div class="hero r${rank} ${shining(c) ? 'shining' : ''}" style="--c:${color}"><div class="art">${carArt(c.model, { glow: rank >= 3, look: c.look, dirt: c.dirt })}</div>${c.plate ? `<div class="plate-on">${plate(c.plate.text)}</div>` : ''}</div>
    <div class="stat four"><div><b>${c.hp}${c.hp > m.hp ? `<em class="win">+${c.hp - m.hp}</em>` : ''}</b><span>к.с.</span></div><div><b>${dec(c.et, 2)}</b><span>с на 402 м</span></div><div class="val">${m.secret ? `<b>${S.short(c.value)}</b><span>колекційна ціна</span><span class="sellp">не продається</span>` : `<b>${S.short(sellPrice(c))}</b><span>продаж</span><span class="sellp">колекційна ${S.short(c.value)}</span>`}</div>${incStat(c)}</div>
    ${incNote(c)}${honestNote(c)}
    ${locked ? `<div class="card mt center muted">Авто виставлено на ${c.status === 'market' ? 'ринок' : 'аукціон'} — керуй ним у «Меню → Ринок → Мої лоти».</div>` : `
    <div class="list mt">
      <button class="li" data-act="carShowcase" data-id="${c.id}"><span class="ic">${ic('building-arch')}</span><div class="grow"><b>${c.status === 'showcase' ? 'Повернути в гараж' : 'Виставити на вітрину'}</b><div class="small muted">${c.status === 'showcase' ? 'знову приноситиме дохід' : `вільно місць: ${me.showcaseSlots - me.cars.filter((x) => x.status === 'showcase').length}`}</div></div><span class="chev">›</span></button>
      <button class="li" data-act="carPlate" data-id="${c.id}"><span class="ic">${ic('license')}</span><div class="grow"><b>Номер</b><div class="small muted">${c.plate ? `+${S.short(c.plate.value)} до колекційної ціни` : 'немає'}</div></div>${c.plate ? plate(c.plate.text, 'sm') : '<span class="chev">›</span>'}</button>
      ${washLi(c)}
      <button class="li" data-act="shareCar" data-id="${c.id}"><span class="ic">${ic('share')}</span><div class="grow"><b>Поділитися</b><div class="small muted">картка машини в Telegram: чат або історія</div></div><span class="chev">›</span></button>
      ${PAINT.canPaint(c.model) || c.look ? `<button class="li" data-act="carPaint" data-id="${c.id}"><span class="ic">${ic('palette')}</span><div class="grow"><b>Фарбування</b><div class="small muted">${c.look ? [S.PAINT_BY_ID[c.look.paint]?.name, S.LIVERY_BY_ID[c.look.livery] && 'ліврея «' + S.LIVERY_BY_ID[c.look.livery].name + '»'].filter(Boolean).join(' · ') : 'заводський колір'}</div></div>${c.look?.paint ? `<span class="sw-dot ${S.PAINT_BY_ID[c.look.paint].finish}" style="--sw:${S.PAINT_BY_ID[c.look.paint].hex}"></span>` : '<span class="chev">›</span>'}</button>` : ''}
    </div>
    <div class="h2 tune-h"><span>Тюнінг <b>${partCount(c)}</b>/${partSlots(c)}</span><span>${isOpen('parts') ? '' : lockChip('parts') + ' '}${m.ev ? `${ic('bolt')} електро · ` : ''}деталі від ${S.TIERS[minTier].name}</span></div>
    ${isOpen('parts') ? tuneBest(c, best) : ''}
    <div class="tune">${S.partKeysOf(c.model).map((k) => {
      const t = c.parts[k];
      const tdt = isOpen('parts') ? tileDt(c, k) : '';
      return `<button class="ptile ${t ? 'on' : 'empty'}${tdt.includes('spin') ? ' spin' : ''}" data-act="carSlot" data-id="${c.id}" data-type="${k}" ${t ? `style="--c:${S.CLASSES[tierCls(t)].color}"` : ''}>${partArt(k, t, t ? 'sm' : 'sm empty')}
        <span class="ptile-tx"><b>${S.PARTS[k].name}</b><span>${t ? S.partEffect(k, t) : S.PARTS[k].hint}</span>${tdt}</span>
        ${t ? `<span class="ptile-tier">${clsBadge(tierCls(t))}${S.TIER_BY_ID[t].name}</span>` : `<span class="ptile-add">${ic('plus')}</span>`}</button>`;
    }).join('')}</div>
    ${c.status === 'garage' ? `<div class="btns"><button class="btn yellow" data-act="raceWith" data-id="${c.id}">${ic('flag-3')} Гонка</button>${m.secret ? '' : `<button class="btn ghost" data-act="carSellMenu" data-id="${c.id}">${ic('cash')} Продати</button>`}</div>
      ${m.secret ? '<div class="tiny muted center mt">Секретна машина — нагорода за колекцію. Її не можна продати, обміняти чи поставити в апгрейд.</div>' : ''}` : ''}`}`);
}
// Honest numbers: installed parts and the plate raise the collection price, not the sale — selling the car gives
// them back (parts to the warehouse, the plate to the player), so the card says so instead of hiding the gap.
function honestNote(c) {
  if (M(c.model).secret) return '';
  const x = S.extrasOf(c);
  if (!x.parts && !x.plate) return '';
  const what = [x.parts ? `деталі +${S.short(x.parts)}` : '', x.plate ? `номер +${S.short(x.plate)}` : ''].filter(Boolean).join(' і ');
  const back = x.parts && x.plate ? 'деталі повернуться на склад, номер — тобі' : x.parts ? 'деталі повернуться на склад' : 'номер лишиться тобі';
  return `<div class="inc-note muted hn-note">Колекційна ціна = модель ${S.short(M(c.model).price)} + ${what}. У продаж вони не входять: ${back}.</div>`;
}
H.car = (d) => carSheet(d.id);
H.carShowcase = async (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  if (await act('showcase', { carId: c.id, put: c.status !== 'showcase' }, c.status === 'showcase' ? 'Повернуто в гараж' : 'Машина на вітрині')) carSheet(c.id);
};
H.raceWith = (d) => {
  state.raceCar = state.raceCarPicked = Number(d.id);
  state.tab = 'race';
  state.page = null;
  state.raceView = 'race';
  closeModal();
  render();
};
H.carSlot = (d) => {
  if (!isOpen('parts')) return lockedSheet('parts');
  const c = me.cars.find((x) => x.id === Number(d.id));
  const type = d.type;
  const minTier = S.minTierFor(M(c.model).cls);
  const cur = c.parts[type];
  // Most useful for this car first (its real effect on the time), then the higher tier.
  const gainOf = (p) => (S.TIER_BY_ID[p.tier].index >= minTier ? T.partGain(c, type, p.tier) : null);
  const inv = me.parts.filter((p) => p.type === type).map((p) => ({ ...p, g: gainOf(p) }))
    .sort((a, b) => (a.g?.dt ?? 9) - (b.g?.dt ?? 9) || S.TIER_BY_ID[b.tier].index - S.TIER_BY_ID[a.tier].index);
  sheet(S.PARTS[type].name, `
    ${cur ? `<div class="h2"><span>Встановлено</span></div><div class="list"><div class="li">${partArt(type, cur, 'sm')}<div class="grow"><b>${S.partLabel(type, cur)}</b><div class="small muted">${S.partEffect(type, cur)} · +${S.short(S.TIER_BY_ID[cur].price)}</div>${shareLine(c, type)}</div><button class="btn sm ghost" data-act="uninstall" data-id="${c.id}" data-type="${type}">Зняти</button></div></div>` : ''}
    <div class="h2"><span>На складі</span></div>
    ${inv.length ? `<div class="list">${inv.map((p) => {
      const ok = S.TIER_BY_ID[p.tier].index >= minTier;
      return `<div class="li">${partArt(type, p.tier, 'sm')}<div class="grow"><b>${S.partLabel(type, p.tier)} × ${p.count}</b><div class="small muted">${S.partEffect(type, p.tier)} · +${S.short(S.TIER_BY_ID[p.tier].price)}${p.cooling ? ` · остигає: ${p.cooling}` : ''}</div>${p.g ? dtLine(p.g, type) : ''}</div>
        <button class="btn sm" data-act="install" data-id="${c.id}" data-type="${type}" data-tier="${p.tier}" ${ok && p.available ? '' : 'disabled'}>${ok ? (cur ? 'Замінити' : 'Встановити') : 'Не підходить'}</button></div>`;
    }).join('')}</div>` : emptyBox('tool', 'Немає деталей цього типу', 'Вибий їх у кейсах майстерні', `<button class="btn sm" data-act="toPartCases" data-type="${type}">До кейсів з деталями</button>`)}
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

// ---------- workshop without grind (public/tune.js) ----------
// What a part really does to a car's 402 m time (T.partGain / T.partShare), «Встановити найкраще» (T.bestTune — the
// same count the server runs), «Поставити на …» from a drop or the warehouse, «Продати непотрібні» (T.junkParts).
const spinText = (type) => `${S.PARTS[type].stat === 'kg' ? 'Легша, але' : 'Більше к.с., але'} колеса буксують`;
// A part's effect as a line: green — faster; orange — the wheels spin, so the car is slower; grey — a downgrade or ~0.
function dtLine(g, type) {
  const st = S.PARTS[type].stat;
  if (g.spin) return `<div class="dt spin">${ic('flame')}${spinText(type)}: ${T.fmtDt(g.dt)}</div>`;
  if (g.same) return '<div class="dt">така сама вже стоїть</div>';
  if (g.dt <= -T.TUNE_EPS) return `<div class="dt win">${T.fmtDt(g.dt)} на 402 м</div>`;
  if (g.worse) return `<div class="dt">гірша за встановлену: ${T.fmtDt(g.dt)}</div>`;
  if (g.dt >= T.TUNE_EPS) return `<div class="dt">повільніше: ${T.fmtDt(g.dt)}</div>`;
  return `<div class="dt">≈0 с: ${st === 'grip' ? 'машина й так не буксує' : st === 'shift' ? 'у повільній машині перемикання майже не важать' : 'майже нічого не дає'}</div>`;
}
// What the installed part gives the car now.
function shareLine(c, type) {
  const s = T.partShare(c, type);
  if (!s) return '';
  if (s.spin) return `<div class="dt spin">${ic('flame')}${spinText(type)}: через неї ${T.fmtDt(s.dt)}. Зніми її або постав підвіску й шини.</div>`;
  return s.dt <= -T.TUNE_EPS ? `<div class="dt win">дає ${T.fmtDt(s.dt)} на 402 м</div>` : '<div class="dt">≈0 с на цій машині</div>';
}
// Under a tuning tile: what the installed part gives (orange if it slows the car), or what the warehouse could add.
function tileDt(c, k) {
  if (c.status === 'market' || c.status === 'auction') return '';
  if (c.parts[k]) {
    const s = T.partShare(c, k);
    if (s.spin) return `<span class="ptile-dt spin">${ic('flame')}буксує ${T.fmtDt(s.dt)}</span>`;
    return s.dt <= -T.TUNE_EPS ? `<span class="ptile-dt win">${T.fmtDt(s.dt)}</span>` : '';
  }
  const best = Math.min(0, ...me.parts.filter((p) => p.type === k && p.available > 0 && T.canTake(c.model, k, p.tier)).map((p) => T.partGain(c, k, p.tier).dt));
  return best <= -T.TUNE_EPS ? `<span class="ptile-dt can">на складі ${T.fmtDt(best)}</span>` : '';
}
// «+4 деталі · −0,21 с» (time: the card's 402 m time, gearbox counted for an average driver's shifts).
const bestSummary = (r) => {
  const put = r.changes.filter((x) => x.to).length, off = r.changes.length - put;
  return [put ? `+${put} ${plural(put, ['деталь', 'деталі', 'деталей'])}` : '', off ? `${off} знято` : ''].filter(Boolean).join(', ') + ` · ${T.fmtDt(r.dt)}`;
};
// Above the tuning tiles: the button with what it will do, and after a press what it did.
function tuneBest(c, done) {
  if (c.status === 'market' || c.status === 'auction') return '';
  const plan = T.bestTune(c, me.parts);
  const res = done?.changes?.length ? bestDone(c, done) : '';
  if (plan.changes.length) return `${res}<button class="btn btn2 tune-best" data-act="installBest" data-id="${c.id}"><span>${ic('sparkles')} Встановити найкраще</span><small>${bestSummary(plan)}</small></button>`;
  const fits = me.parts.some((p) => T.canTake(c.model, p.type, p.tier));
  return res || (fits ? `<div class="tiny muted tune-ok">${ic('check')} Найкраще зі складу вже стоїть</div>` : '');
}
function bestDone(c, r) {
  const tn = (t) => S.TIER_BY_ID[t].name;
  const rows = r.changes.map((x) => `<div class="bd-row">${partArt(x.type, x.to || x.from, 'xs')}<span>${S.PARTS[x.type].name}</span><b class="${x.to ? '' : 'spin'}">${x.to ? (x.from ? `${tn(x.from)} → ${tn(x.to)}` : tn(x.to)) : `${tn(x.from)} знято — колеса буксували`}</b></div>`).join('');
  const back = r.changes.some((x) => x.from);
  return `<div class="best-done"><div class="bd-head">${ic('check')}<b>${bestSummary(r)}</b><span>${dec(c.et, 2)} с на 402 м</span></div>${rows}
    ${c.set ? `<div class="tiny bd-set">${ic('sparkles')} Повний комплект ${tn(c.parts[S.partKeysOf(c.model)[0]])}: +${Math.round(S.SET_BONUS.hp * 100)}% к.с.</div>` : ''}
    ${back ? `<div class="tiny muted">Зняті деталі — на складі, ${S.PART_COOLDOWN_MIN} хв остигають.</div>` : ''}</div>`;
}
H.installBest = async (d) => {
  const r = await act('parts/install-best', { carId: Number(d.id) }, (x) => (x.changes.length ? bestSummary(x) : 'Найкраще вже стоїть'), { rerender: false });
  if (!r) return;
  carSheet(d.id, r);
  render();
  const el = $('#sheet .best-done');
  if (el && r.changes.length) FX.sparkle(el, ['#ffd500', '#ffffff', '#2fbf71'], 10);
};
// Puts one piece on a car (the slot sheet's «Встановити»), with the time it gives in the toast.
async function putPart(carId, type, tier) {
  const c = me.cars.find((x) => x.id === carId);
  if (!c) return null;
  const g = T.partGain(c, type, tier);
  return act('parts/install', { carId, type, tier }, `${S.partLabel(type, tier)} → ${M(c.model).name} · ${T.fmtDt(g.dt)}`, { rerender: false });
}
// Which car to put a part on: every car that can take it, with what it would do there.
function putSheet(type, tier, onPut, back = null) {
  const list = T.partTargets(me.cars, type, tier);
  H.putPicked = async (d) => {
    const id = Number(d.id);
    if (await putPart(id, type, tier)) onPut ? onPut(id) : (closeModal(), render());
  };
  sheet(esc(S.partLabel(type, tier)), list.length ? `<div class="tiny muted">Куди поставити: ${S.partEffect(type, tier)}. Знята стара деталь повернеться на склад.</div>
    <div class="list mt">${list.map((x) => `<div class="li">${miniCar(x.car.model, '', x.car.look)}<div class="grow"><b class="ellipsis">${esc(M(x.car.model).name)}</b><div class="small muted">${dec(x.car.et, 2)} с · ${x.car.parts[type] ? `зараз ${S.TIER_BY_ID[x.car.parts[type]].name}` : 'слот порожній'}</div>${dtLine(x, type)}</div>
      <button class="btn sm ${x.dt < -T.TUNE_EPS ? '' : 'ghost'}" data-act="putPicked" data-id="${x.car.id}" ${x.same ? 'disabled' : ''}>${x.car.parts[type] ? 'Замінити' : 'Поставити'}</button></div>`).join('')}</div>`
    : emptyBox('car', 'Немає машини для цієї деталі', 'Підходять машини в гаражі чи на вітрині, клас яких дозволяє цей рівень деталі'), back);
}
// Under a dropped part: «Поставити на <машину>» — the fastest car it makes faster — and a picker for any other.
function dropPutBtn(p, i, one) {
  if (p.sold) return '';
  if (p.put) return `<div class="dropput done">${ic('check')}<span class="ellipsis">${one ? 'Стоїть на ' : ''}${esc(p.put)}</span></div>`;
  if (!T.partTargets(me.cars, p.type, p.tier).length) return '';
  const tg = T.bestTarget(me.cars, p.type, p.tier);
  return `<div class="dropput-row">${tg ? `<button class="dropput" data-act="dropPut" data-i="${i}" data-car="${tg.car.id}"><span class="ellipsis">${one ? 'Поставити на ' : ''}${esc(M(tg.car.model).name)}</span><b>${ic('tool')}${T.fmtDt(tg.dt)}</b></button>` : ''}
    <button class="dropput more ${tg ? '' : 'wide'}" data-act="dropPick" data-i="${i}" aria-label="Обрати машину">${ic('car')}${tg ? '' : '<span>Поставити…</span>'}</button></div>`;
}
function dropPutDone(p, carId) {
  const c = me.cars.find((x) => x.id === carId);
  p.put = c ? M(c.model).name : 'машині';
  render();
}
H.dropPut = async (d) => {
  const p = state.partDrop?.[Number(d.i)];
  if (!p || p.put || p.sold) return;
  if (await putPart(Number(d.car), p.type, p.tier)) dropPutDone(p, Number(d.car));
};
H.dropPick = (d) => {
  const p = state.partDrop?.[Number(d.i)];
  if (!p || p.put || p.sold) return;
  putSheet(p.type, p.tier, (id) => (closeModal(), dropPutDone(p, id)));
};
// ×3/×5/×10: one line over the cards — what tiers came and how many make a car faster.
function dropSummary(d) {
  const by = {};
  for (const p of d) by[p.tier] = (by[p.tier] || 0) + 1;
  const useful = d.filter((p) => !p.sold && !p.put && T.bestTarget(me.cars, p.type, p.tier)).length;
  return `<div class="dropsum">${S.TIERS.filter((t) => by[t.id]).reverse().map((t) => `<span style="--c:${S.CLASSES[t.cls].color}"><i></i>${t.name} ×${by[t.id]}</span>`).join('')}
    <em>${useful ? `${ic('tool')} прискорять машини: ${useful}` : d.some((p) => p.put) ? '' : 'жодна не прискорить твої машини'}</em></div>`;
}
// Склад, most useful first: per piece, the car «Поставити на …» would put it on (T.bestTarget) and what it gives there.
function stockUse() {
  const use = {};
  for (const p of me.parts) {
    const tg = T.bestTarget(me.cars, p.type, p.tier);
    use[p.type + ':' + p.tier] = tg && tg.dt <= -T.TUNE_EPS ? tg : null;
  }
  return use;
}
// In the type sheet of the warehouse: put this tier on its best car, or say why it is not needed.
function stockPutLine(p) {
  const tg = p.available ? T.bestTarget(me.cars, p.type, p.tier) : null;
  if (tg) return `<div class="putline"><button class="putlink" data-act="stockPut" data-k="${p.type}" data-tier="${p.tier}" data-car="${tg.car.id}">${ic('tool')}<span class="ellipsis">На ${esc(M(tg.car.model).name)}</span><b>${T.fmtDt(tg.dt)}</b></button><button class="putlink more" data-act="stockPick" data-k="${p.type}" data-tier="${p.tier}">інша…</button></div>`;
  if (T.junkParts(me.cars, [{ ...p, available: 1 }]).length) return '<div class="dt">не краща за встановлені на всіх машинах</div>';
  return `<div class="dt">${T.partTargets(me.cars, p.type, p.tier).length ? 'зараз не прискорить жодну машину' : 'не підходить жодній машині'}</div>`;
}
H.stockPut = async (d) => {
  if (await putPart(Number(d.car), d.k, d.tier)) H.stockType({ k: d.k });
};
H.stockPick = (d) => putSheet(d.k, d.tier, () => H.stockType({ k: d.k }), () => H.stockType({ k: d.k }));
H.sellJunk = async () => {
  const junk = T.junkParts(me.cars, me.parts);
  if (!junk.length) return toast('Непотрібних деталей немає');
  const n = junk.reduce((s, j) => s + j.count, 0);
  const sum = junk.reduce((s, j) => s + Math.floor(S.TIER_BY_ID[j.tier].price * S.PART_SELL_RATE) * j.count, 0);
  const names = junk.slice(0, 8).map((j) => `${S.partLabel(j.type, j.tier)} ×${j.count}`).join(', ') + (junk.length > 8 ? ` і ще ${junk.length - 8}` : '');
  const merge = junk.some((j) => j.count >= 3 && S.TIER_BY_ID[j.tier].index < S.TIERS.length - 1);
  if (!(await confirmBox(`Продати ${n} ${plural(n, ['деталь', 'деталі', 'деталей'])} за ${S.fmt(sum)}? ${names}. Жодна не краща за встановлені на твоїх машинах.${merge ? ' Порада: 3 однакові можна злити в одну рівнем вище — це вигідніше.' : ''}`))) return;
  await act('parts/sell-junk', { items: junk }, (r) => `Продано ${r.count} шт: +${S.fmt(r.got)}`);
};
H.carPlate = (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  if (!isOpen('plates') && !c.plate && !me.plates.length) return lockedSheet('plates');
  const free = me.plates.filter((p) => !p.carId);
  sheet('Номер', `${c.plate ? `<div class="center">${plate(c.plate.text, 'lg')}<div class="mt">${clsBadge(c.plate.cls)} <b>${S.fmt(c.plate.value)}</b></div></div><button class="btn ghost mt" data-act="plateDetach" data-pid="${c.plate.id}" data-id="${c.id}">Зняти номер</button>` : ''}
    <div class="h2"><span>Мої номери</span></div>
    ${free.length ? `<div class="list">${free.map((p) => `<div class="li">${plate(p.text)}<div class="grow small">${clsBadge(p.cls)} ${S.short(p.value)}</div><button class="btn sm" data-act="plateAttach" data-pid="${p.id}" data-id="${c.id}">Повісити</button></div>`).join('')}</div>`
      : emptyBox('license', 'Вільних номерів немає', 'Їх генерують у «Меню → Номери»', '<button class="btn sm" data-act="go" data-page="plates">До номерів</button>')}
    <div class="tiny muted">Ціна номера додається до колекційної ціни машини та її доходу. У продаж машини номер не входить — він лишається тобі.</div>`, () => carSheet(c.id));
};
H.plateAttach = async (d) => {
  if (await act('plate/attach', { plateId: Number(d.pid), carId: Number(d.id) }, 'Номер встановлено', { rerender: false })) carSheet(d.id), render();
};
H.plateDetach = async (d) => {
  if (await act('plate/detach', { plateId: Number(d.pid) }, 'Номер знято', { rerender: false })) d.id ? carSheet(d.id) : null, render();
};
H.carSellMenu = (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  const quick = sellPrice(c);
  sheet('Продаж', `<div class="list">
    <button class="li" data-act="sellOne" data-id="${c.id}"><span class="ic">${ic('bolt')}</span><div class="grow"><b>Продати одразу · ${S.short(quick)}</b><div class="small muted">${Math.round((quick / M(c.model).price) * 100)}% ціни моделі${S.originSellOf(c.origin) < 1 ? ` (з кейсу «${esc(S.CASE_BY_ID[c.origin]?.name || c.origin)}» — викуп ×${dec(S.originSellOf(c.origin), 2)})` : ''}. Деталі й номер повернуться тобі</div></div></button>
    <button class="li" data-act="listMarket" data-id="${c.id}"><span class="ic">${ic('building-store')}</span><div class="grow"><b>На ринок</b><div class="small muted">Свою ціну, комісія ${S.FEE * 100}%. Машина йде разом з деталями й номером</div></div>${isOpen('market') ? '' : lockChip('market')}</button>
    <button class="li" data-act="listAuction" data-id="${c.id}"><span class="ic">${ic('hammer')}</span><div class="grow"><b>На аукціон</b><div class="small muted">Торги 1–24 год, ставка в останню хвилину продовжує</div></div>${isOpen('auction') ? '' : lockChip('auction')}</button>
  </div>`, () => carSheet(c.id));
};
H.sellOne = async (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  if (!(await confirmBox(`Продати ${M(c.model).name} за ${S.fmt(sellPrice(c))}?`))) return;
  if (await act('sell', { carIds: [c.id] }, (r) => `+${S.fmt(r.got)}`)) closeModal();
};
H.listMarket = (d) => {
  if (!isOpen('market')) return lockedSheet('market');
  const c = me.cars.find((x) => x.id === Number(d.id));
  sheet('На ринок', `${carRow(c)}<div class="small muted mt">Колекційна ціна ${S.fmt(c.value)} · дилер дасть одразу ${S.fmt(sellPrice(c))} · комісія ${S.FEE * 100}%</div>
    <label class="fld mt" for="price">Ціна, ₴</label><input id="price" inputmode="numeric" value="${grp(c.value * 0.8)}"><button class="btn mt" data-act="doListMarket" data-id="${c.id}">Виставити</button>`, () => H.carSellMenu(d));
};
H.doListMarket = async (d) => {
  if (await act('market/sell', { carId: Number(d.id), price: num($('#price').value) }, 'Виставлено на ринок', { rerender: false })) {
    closeModal();
    state.marketTab = 'buy';
    go('market');
  }
};
H.listAuction = (d) => {
  if (!isOpen('auction')) return lockedSheet('auction');
  const c = me.cars.find((x) => x.id === Number(d.id));
  sheet('Аукціон', `${carRow(c)}<div class="small muted mt">Колекційна ціна ${S.fmt(c.value)} · дилер дасть одразу ${S.fmt(sellPrice(c))} · крок ставки 5% · комісія ${S.FEE * 100}%</div>
    <label class="fld mt" for="start">Стартова ціна, ₴</label><input id="start" inputmode="numeric" value="${grp(c.value * 0.5)}">
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
// A reel card drawn by the case's real odds: the class by the odds the case screen shows right now (caseNow: the
// case of the day / game events, the same table the server rolls), the model inside the class by S.modelWeights
// (dearer models rarer), as the server's pickModel does. No class is swapped up: the strip looks like what drops.
function weightedModel(cs) {
  const e = Object.entries(caseNow(cs).weights).filter(([c, w]) => w > 0 && cs.pool(c).length);
  let x = Math.random() * e.reduce((s, [, w]) => s + w, 0);
  let cls = e[e.length - 1][0];
  for (const [c, w] of e) if ((x -= w) < 0) {
    cls = c;
    break;
  }
  const list = cs.pool(cls), mw = S.modelWeights(list);
  let y = Math.random() * mw.reduce((s, w) => s + w, 0);
  for (let i = 0; i < list.length; i++) if ((y -= mw[i]) < 0) return list[i].id;
  return list[list.length - 1].id;
}
// Dropped cars can be sold right from the result, so junk doesn't clog the garage.
// The server sends car.sell (the instant-sale price right now, S.FRESH_SELL included); the model price is the fallback.
const sellPrice = (car) => car.sell ?? S.sellPriceOf(car.model, Infinity, car.origin);
const sellTotal = (cars) => cars.reduce((s, c) => s + sellPrice(c), 0);
const dropAlive = (r) => !r.sold && me.cars.some((c) => c.id === r.car.id && c.status === 'garage');
// The price on a reel card is what that drop would sell for (honest numbers), not the model's collection price.
const reelCard = (model, cs) => `<div class="car r${S.rankOf(M(model).cls)}" style="--c:${S.CLASSES[M(model).cls].color}">${clsBadge(M(model).cls, 'tl')}<div class="art">${carArt(model)}</div><div class="nm tiny ellipsis">${esc(M(model).name)}</div><div class="price tiny" style="color:${S.CLASSES[M(model).cls].color}">${S.short(S.dropSaleOf(model, cs))}</div></div>`;
// ---------- game events (S.EVENTS): chips with a timer, the «Події» card, the deal for a case right now ----------
const evActive = () => (me.gameEvents?.active || []).filter((e) => e.end > serverNow());
const evFx = () => S.eventEffects(evActive());
const caseNow = (cs) => S.caseDeal(cs, S.kyivDateOf(serverNow()), evFx());
const caseEvChip = (dl) => (dl.why === 'luck' ? `<span class="chip evc" style="--c:${S.EVENTS.luck.color}">${ic('clover')} топ-клас ×${dec(S.EVENTS.luck.topMult, 1)}</span>`
  : dl.why === 'country' ? `<span class="chip evc" style="--c:${S.EVENTS.country.color}">${ic('world')} −${Math.round(dl.off * 100)}%</span>` : '');
// A countdown span filled at once (tickUntil updates it every second after that).
const untilSpan = (t) => `<span data-until="${t - clockOffset}">${left(t - serverNow())}</span>`;
// Running events of these kinds as chips with "till the end" timers; a tap opens the «Події» sheet.
function eventStrip(ids) {
  const list = evActive().filter((e) => ids.includes(e.id));
  if (!list.length) return '';
  return `<div class="ev-strip">${list.map((e) => `<button class="ev-chip" data-act="eventsOpen" style="--c:${e.color}">${ic(e.icon)}<b>${esc(e.title)}</b><span class="ev-left">${ic('clock')}${untilSpan(e.end)}</span></button>`).join('')}</div>`;
}
// skip: running events already shown as chips at the top of the same screen (the card then lists only what's next).
function eventsCard(compact, skip = []) {
  const act = evActive().filter((e) => !skip.includes(e.id)), next = (me.gameEvents?.next || []).filter((e) => e.start > serverNow()).slice(0, compact ? 2 : 4);
  if (!act.length && !next.length) return '';
  const row = (e, on) => `<div class="ev-row ${on ? 'on' : ''}" style="--c:${e.color}"><span class="ev-ic">${ic(e.icon)}</span>
    <div class="grow"><b>${esc(e.title)}</b>${compact && !on ? '' : `<div class="tiny muted">${esc(e.text)}</div>`}</div>
    <div class="ev-t"><small>${on ? 'ще' : 'через'}</small>${untilSpan(on ? e.end : e.start)}</div></div>`;
  return `<div class="card ev-card mt" ${compact ? 'data-act="eventsOpen"' : ''}>${compact ? `<div class="row between"><b class="ev-h">${ic('calendar')} Події</b><span class="tiny muted">усі ${ic('chevron-right')}</span></div>` : ''}
    ${act.map((e) => row(e, true)).join('')}${next.length ? `<div class="ev-sub tiny muted">Далі</div>${next.map((e) => row(e, false)).join('')}` : ''}</div>`;
}
H.eventsOpen = () => sheet('Події', `${eventsCard(false)}<div class="tiny muted mt">Події йдуть самі за розкладом (київський час): «Країна тижня» — щотижня, з понеділка; у вівторок і четвер — «Щасливі номери» та «Подвійне паливо»; на вихідних — «Вихідні удачі» або «Гоночний уїкенд», через тиждень.</div>`);
// No money for even the cheapest case and no keys: instead of a dead end, every way to get going again.
function brokeCard() {
  const cheapest = S.CASE_BY_ID.rust.price;
  if (me.balance >= cheapest || Object.values(me.keys || {}).some((k) => k > 0)) return '';
  const now = serverNow();
  const row = (icon, title, sub, right) => `<div class="broke-row"><span class="broke-ic">${ic(icon)}</span><span class="broke-tx"><b>${title}</b><span class="tiny muted">${sub}</span></span>${right}</div>`;
  const rows = [];
  if (me.rescueAt != null) rows.push(now >= me.rescueAt
    ? row('clover', 'Безкоштовний «Іржавий гараж»', 'Допомога, коли немає грошей', '<button class="btn sm yellow" data-act="rescueClaim">Забрати</button>')
    : row('clover', 'Безкоштовний «Іржавий гараж»', 'Допомога, коли немає грошей', `<span class="chip" data-until="${me.rescueAt - clockOffset}"></span>`));
  rows.push(now >= me.rewardCaseAt
    ? row('box', 'Кейс нагород', 'Раз на кілька годин', '<button class="btn sm" data-act="claimRewardCase">Відкрити</button>')
    : row('box', 'Кейс нагород', 'Раз на кілька годин', `<span class="chip" data-until="${me.rewardCaseAt - clockOffset}"></span>`));
  if (me.dailyReady) rows.push(row('gift', 'Щоденний бонус', 'Забери сьогоднішній', '<button class="btn sm" data-act="claimDaily">Забрати</button>'));
  rows.push(row('flag-3', 'Гонки', 'Вигравай заїзди — отримуй гроші', '<button class="btn sm ghost" data-act="brokeTab" data-tab="race">Їхати</button>'));
  rows.push(row('target-arrow', 'Завдання на сьогодні', 'Гроші за прості дії', '<button class="btn sm ghost" data-act="go" data-page="quests">Глянути</button>'));
  const sellable = (me.cars || []).filter((c) => c.status === 'garage');
  if (sellable.length) {
    const best = sellable.reduce((a, c) => (sellPrice(c) > sellPrice(a) ? c : a));
    rows.push(row('cash', 'Продати машину', `${esc(M(best.model).name)} — ${S.fmt(sellPrice(best))}`, '<button class="btn sm ghost" data-act="brokeTab" data-tab="garage">Гараж</button>'));
  }
  if (me.income?.pending > 0) rows.push(row('coin', 'Дохід гаража', `Набралось ${S.fmt(me.income.pending)}`, '<button class="btn sm ghost" data-act="collect">Забрати</button>'));
  return `<div class="card broke mt"><div class="broke-h">${ic('info-circle')} Немає грошей на кейс? <span class="tiny muted">найдешевший — ${S.fmt(cheapest)}</span></div>${rows.join('')}</div>`;
}
H.brokeTab = (d) => document.querySelector(`#tabs button[data-tab="${d.tab}"]`)?.click();
H.rescueClaim = async () => {
  if (await act('rescue/claim', {}, 'Безкоштовний кейс уже чекає!', { rerender: false })) {
    state.tab = 'cases'; state.page = null; state.caseId = 'rust'; state.count = 1; state.drop = null;
    render();
  }
};
TABS.cases = () => {
  const cs = S.CASE_BY_ID[state.caseId];
  const keys = me.keys[cs.id] || 0;
  if (cs.starter && !keys) state.caseId = 'rust';
  // A fresh drop on the screen (not sold yet): its «У гараж» is the main action and «Відкрити ще» is secondary. A count
  // that no longer fits steps down by itself (×3 → ×1 with 2 free places); «Не вистачає місця для ×N» shows only once
  // the player picks that count after the drop (audit №13).
  const onDrop = !!state.drop?.some(dropAlive);
  if (onDrop && !cs.starter && !state.countPicked && me.slots - me.used < state.count) {
    const fit = [6, 3, 1].find((k) => k <= me.slots - me.used);
    if (fit) state.count = fit;
  }
  const n = cs.starter ? 1 : state.count;
  const deal = caseNow(cs); // case of the day / game events (S.caseDeal, the same rules as the server)
  const dayCase = deal.why === 'day';
  const price = deal.price;
  const paid = Math.max(0, n - keys);
  const free = me.slots - me.used;
  const d = state.drop;
  let stage;
  if (d?.length === 1) {
    const { car, isNew, forced } = d[0];
    const m = M(car.model);
    const rank = S.rankOf(m.cls), color = S.CLASSES[m.cls].color;
    const fresh = state.fx?.type === 'case';
    // What selling gives against the price of the case it came from (the honest "won / lost" number: the value of the
    // model is not what a sale pays — S.SELL_RATES); ×1,2 reads as "won", ×0,4 as "try again".
    const from = S.CASE_BY_ID[state.dropCase] || cs;
    const sp = sellPrice(car);
    // Honest numbers (audit №1): the main figure is the sale, and «×N від ціни кейсу» is the sale against what one
    // opening cost (green only when it pays back); the collection price and its multiplier follow in grey. The same
    // numbers as on the celebration screen and the share card (dropPaid / dropMult).
    const paid = dropPaid(from);
    const mult = paid ? sp / paid : 0;
    stage = `<div class="reveal-wrap r${rank}" id="revealWrap" style="--c:${color}"><div class="art ${fresh ? 'reveal' : ''}" id="dropArt">${carArt(car.model, { glow: rank >= 2 })}</div></div>
      ${isNew ? `<div class="newtag ${fresh ? 'pop' : ''}">${ic('sparkles')} Нова в колекції</div>` : ''}
      <div class="result-name r${rank} ${fresh ? 'pop' : ''} ${rank >= 3 ? 'shimmer' : ''}" style="--c:${color}">${esc(m.name)}</div>
      <div class="rarity-row ${fresh ? 'pop2' : ''}"><span class="stamp r${rank}" style="--c:${color}"><b>${m.cls}</b>${S.CLASSES[m.cls].name}</span>${originChip(car.model)}${forced ? ' <span class="chip">гарантія</span>' : ''}${d[0].fragment ? ` <span class="chip frag">${ic('key')} +фрагмент</span>` : ''}</div>
      <div class="drop-value ${fresh ? 'pop2' : ''}"><span class="hn-lbl">${ic('cash')}Продаж</span><b id="dropValue">${S.fmt(sp)}</b>${mult ? `<span class="xmult ${mult >= 1 ? 'up' : ''}">${S.multText(mult)} від ціни кейсу</span>` : ''}</div>
      <div class="drop-sell ${fresh ? 'pop2' : ''}">${d[0].sold
        // Same line, same height: an extra «Продано» row pushed the buttons down right under a second tap.
        ? `<span class="win">${ic('check')} Продано за <b>${S.short(sp)}</b></span>`
        : `<span class="hn-coll">Колекційна ціна ${S.short(car.value)}${paid ? ` · ${S.multText(car.value / paid)} у колекції` : ''}</span>`}</div>`;
  } else if (d?.length) {
    const fresh = state.fx?.type === 'case';
    const best = d.reduce((a, r) => Math.max(a, S.rankOf(M(r.car.model).cls)), 0);
    stage = `<div class="multi n${d.length}">${d.map((r, i) => {
      const rk = S.rankOf(M(r.car.model).cls);
      const c = S.CLASSES[M(r.car.model).cls].color;
      const sell = dropAlive(r) ? `<button class="dropsell" data-act="sellDrop" data-id="${r.car.id}">${ic('cash')}${S.short(sellPrice(r.car))}</button>`
        : r.sold ? '<div class="dropsell done">Продано</div>' : '';
      return `<div class="dcell r${rk} ${fresh ? 'flip-in' : ''} ${rk >= 1 ? 'rare' : ''} ${rk === best && best >= 2 ? 'best' : ''} ${r.sold ? 'sold' : ''}" style="--c:${c};animation-delay:${i * 180}ms">${r.sold ? carTile(r.car, { act: 'none', collLine: 'short' }) : carTile(r.car, { act: 'car', isNew: r.isNew, collLine: 'short' })}${sell}</div>`;
    }).join('')}</div>
    <div class="multi-sum ${fresh ? 'pop2' : ''}"><span>${d.length} ${plural(d.length, ['машина', 'машини', 'машин'])}${d.some((r) => r.isNew) ? ` · <span class="newc">${ic('sparkles')} ${(() => { const k = d.filter((r) => r.isNew).length; return `${k} ${plural(k, ['нова', 'нові', 'нових'])}`; })()}</span>` : ''}</span><b>Продаж разом ${S.short(sellTotal(d.map((r) => r.car)))}<small> · колекційна ${S.short(d.reduce((s, r) => s + r.car.value, 0))}</small></b></div>`;
  } else {
    stage = `<div class="reel-wrap" id="reelWrap"><div class="reel" id="reel">${Array.from({ length: 6 }, () => reelCard(weightedModel(cs), cs)).join('')}</div></div>`;
  }
  const top = S.CLASS_ORDER.filter((c) => cs.weights[c]).pop();
  return `<div class="feed" id="dropFeed"></div>${eventStrip(['luck', 'country', 'plates'])}
    <div class="casebar"><button class="picker" data-act="casePicker" style="--c:${S.CLASSES[top].color}"><span class="picker-ic">${caseIcon(cs)}</span>
      <span class="picker-tx"><b>${esc(cs.name)}</b><span class="picker-sub">${oddsBar(deal.weights)}${dayCase ? `<span class="chip dayc">${ic('flame')} Кейс дня −${S.CASE_OF_DAY.off * 100}%</span>` : ''}${caseEvChip(deal)}</span></span>
      <span class="picker-chev">${ic('chevron-right')}</span></button>
      <button class="iconbtn" data-act="odds" aria-label="Що всередині">${ic('info-circle')}</button></div>
    <div class="stage ${d?.length ? 'lit' : ''}" id="stage" style="${d?.length > 1 ? 'height:auto;min-height:230px;' : ''}${d?.length ? `--c:${S.CLASSES[M(d.reduce((a, r) => (S.rankOf(M(r.car.model).cls) > S.rankOf(M(a.car.model).cls) ? r : a)).car.model).cls].color}` : ''}">${stage}</div>
    ${cs.starter ? '' : `<div class="seg">${[1, 3, 6].map((k) => `<button class="${k === n ? 'on' : ''}" data-act="pickCount" data-n="${k}">×${k}</button>`).join('')}</div>`}
    ${(() => {
      const short = price * paid - me.balance;
      // On the drop screen a full garage is one quiet line: the drop's own «Продати» is right below.
      if (onDrop && free < 1) return `<div class="tiny muted center mt">Гараж заповнений · ${me.used}/${me.slots} — продай машину або купи місце, щоб відкрити ще</div>`;
      if (free < n) return noRoomHtml(n, free);
      // Not enough money: say so on the button, with how much is missing.
      if (paid && short > 0) return `<button class="btn" disabled>Недостатньо коштів · бракує ${S.fmt(short)}</button>`;
      return `<button class="btn opencase ${onDrop ? 'second' : deal.off ? 'yellow' : ''}" data-act="openCase">${paid ? `<span class="oc-l">${d && state.dropCase === cs.id ? 'Відкрити ще' : 'Відкрити'}</span><span class="oc-p">${S.fmt(price * paid)}${deal.off ? ` <s>${S.short(cs.price * paid)}</s>` : ''}${keys ? ` + ${ic('key')}${Math.min(keys, n)}` : ''}</span>` : cs.starter ? 'Відкрити безкоштовно' : `Відкрити ключем ${ic('key')} ${n}`}</button>`;
    })()}
    ${cs.starter ? '<div class="tiny muted center mt">Подарунок новачку</div>' : ''}
    ${cs.starter ? '' : brokeCard()}
    ${d ? (() => {
      const alive = d.filter(dropAlive);
      const sum = sellTotal(alive.map((r) => r.car));
      // The only car can't be sold (the server says «Останню машину продати не можна»), so it isn't offered.
      const last = alive.length && me.cars.length - alive.length < 1;
      const sellBtn = alive.length && !last ? `<button class="btn ghost btn2" data-act="sellDrops"><span>${ic('cash')} ${alive.length > 1 ? 'Продати все' : 'Продати'}</span><small>${S.short(sum)}</small></button>` : '';
      return `<div class="btns mt"><button class="btn ${alive.length ? '' : 'outline'}" data-act="toGarage">У гараж</button>${sellBtn}</div>${last ? '<div class="tiny muted center mt">Це твоя єдина машина: на ній ганяєш і заробляєш, тому продати її не можна</div>' : ''}${wowShareRow(d)}`;
    })() : ''}
    <div class="fastrow"><span>${ic('bolt')} Швидке відкриття <small>без рулетки</small></span><button class="toggle ${state.fast ? 'on' : ''}" data-act="toggleFast" aria-label="Швидке відкриття"></button></div>
    ${cs.starter ? '' : (() => {
      const fr = me.fragments?.[cs.id] || 0, need = S.FRAGMENTS_PER_KEY;
      return `<div class="card hooks mt">
        <div class="hook"><div class="row between"><span class="hook-t">${ic('key')} Фрагменти ключа</span><b>${fr}<small>/${need}</small></b></div><div class="pips">${Array.from({ length: need }, (_, i) => `<i class="${i < fr ? 'on' : ''}"></i>`).join('')}</div><div class="tiny muted">Кожна машина дешевша за кейс дає фрагмент · ${need} фрагментів = безкоштовне відкриття${keys ? ` · у тебе ${ic('key')} ${keys}` : ''}${S.originSellOf(cs.id) < 1 ? `<br>Машини з цього кейсу продаються одразу за ×${dec(S.originSellOf(cs.id), 2)} звичайного викупу; у гаражі, доході й колекції — повна вартість` : ''}</div></div>
        ${S.pitySteps(cs).map(pityHook).join('')}
      </div>`;
    })()}
    ${eventsCard(true, ['luck', 'country', 'plates'])}`;
};
// One guarantee step under the case (S.pitySteps): opens left until the class is certain, a bar of the opens already
// made without it, and what resets it. left = 1: the very next open brings the class or better.
function pityHook(st) {
  const left = Math.max(1, st.n - (me.pity[st.key] || 0));
  return `<div class="hook pityhook" style="--c:${S.CLASSES[st.cls].color}"><div class="row between"><span class="hook-t">${ic('shield-check')} Гарантія ${clsBadge(st.cls)}${st.missing ? ' · нова в колекцію' : ' або краще'}</span><b>${left === 1 ? 'наступне' : `ще ${left}`}</b></div><div class="frag-bar pity"><i style="width:${((st.n - left) / st.n) * 100}%"></i></div>
    <div class="tiny muted">${left === 1 ? `Наступне відкриття — гарантовано ${st.cls} або краще` : `Не більше ${st.n} відкриттів поспіль без ${st.cls}: ${st.n}-те дасть ${st.cls} або краще`}</div></div>`;
}
// Not enough garage slots for this opening: how many are free, plus a way out right here — ×1 (if one fits) or the
// garage with the cheapest cars already picked for sale.
function noRoomHtml(n, free) {
  const need = n - free; // over the limit (a battle prize) free is negative: sell enough to open again
  return `<button class="btn" disabled>${free > 0 ? `Не вистачає місця для ×${n} · вільно ${free} з ${me.slots}` : `Гараж заповнений · ${me.used}/${me.slots}`}</button>
    <div class="btns mt">${free > 0 ? '<button class="btn outline" data-act="pickCount" data-n="1">Відкрити ×1</button>' : ''}<button class="btn ghost" data-act="sellCheap" data-n="${need}">${ic('cash')} Продати ${need === 1 ? 'найдешевшу' : `${need} ${plural(need, ['найдешевшу', 'найдешевші', 'найдешевших'])}`}</button></div>
    <div class="tiny muted center mt">або купи місце в гаражі</div>`;
}
H.sellCheap = (d) => {
  const ids = me.cars.filter((c) => c.status === 'garage' && !M(c.model).secret).sort((a, b) => a.value - b.value).slice(0, Number(d.n)).map((c) => c.id);
  state.drop = null;
  state.tab = 'garage';
  state.page = null;
  state.garageView = 'cars';
  state.garageCls = null;
  state.selling = new Set(ids);
  window.scrollTo(0, 0);
  render();
  toast('Обрано найдешевші — перевір і тисни «Продати»');
};
H.toGarage = () => {
  if ((me.stats?.cases || 0) <= 3) api('funnel/mark', { step: 'garage' }).catch(() => {}); // owner metrics: first-session funnel
  state.drop = null;
  state.tab = 'garage';
  window.scrollTo(0, 0); // a new tab starts at the top (the first-steps card lives there)
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
  const sum = sellTotal(state.drop.filter(dropAlive).map((r) => r.car));
  if (armed(el, `Точно продати? · ${S.short(sum)}`)) sellDrops(ids);
};
H.pickCount = (d) => (state.count = Number(d.n), state.countPicked = true, render());
H.toggleFast = () => (state.fast = !state.fast, render());
H.casePicker = () => {
  const group = (g, title) => {
    const list = S.CASES.filter((c) => c.group === g && (!c.starter || me.keys[c.id]));
    if (!list.length) return '';
    return `<div class="h2"><span>${title}</span></div><div class="list cases-list">${list.map((c) => {
      const dl = caseNow(c);
      return `<button class="li ${c.id === state.caseId ? 'on' : ''}" data-act="pickCase" data-id="${c.id}" style="--c:${S.CLASSES[S.CLASS_ORDER.filter((k) => c.weights[k]).pop()].color}">
      <span class="ic">${caseIcon(c)}</span><div class="grow"><b>${esc(c.name)}${dl.why === 'day' ? ` <span class="chip dayc">${ic('flame')} −${S.CASE_OF_DAY.off * 100}%</span>` : ''}${caseEvChip(dl)}</b>${oddsBar(dl.weights)}${dots(dl.weights)}</div><div class="center"><b>${c.starter ? 'Безкоштовно' : dl.off ? `<span style="color:var(--accent)">${S.short(dl.price)}</span>` : S.short(c.price)}</b>${me.keys[c.id] && !c.starter ? `<div class="tiny win">${ic('key')} ${me.keys[c.id]}</div>` : ''}</div></button>`;
    }).join('')}</div>`;
  };
  sheet('Вибір кейсу', group('gift', 'Подарунок новачку') + group('rarity', 'За рідкістю') + group('country', 'За країнами'));
};
H.pickCase = (d) => {
  state.caseId = d.id;
  prefSet('caseId', d.id);
  state.drop = null;
  closeModal();
  render();
};
H.odds = () => {
  const cs = S.CASE_BY_ID[state.caseId];
  const owned = new Set(me.collection);
  const W = caseNow(cs).weights; // with «Вихідні удачі» the top class is higher
  const total = Object.values(W).reduce((a, b) => a + b, 0);
  sheet('Що всередині', `<div class="row"><span style="font-size:24px">${caseIcon(cs)}</span><b>${esc(cs.name)}</b></div>
    <div class="small muted mt">Спочатку випадає клас, потім машина. Чим дорожча машина, тим рідше вона випадає. Вказано мінімальні шанси — з удачею випадає й краще. ✓ — уже є в колекції. Сума під машиною — скільки дасть продаж одразу; колекційна ціна моделі вища.</div>
    ${S.pitySteps(cs).map((st) => `<div class="small mt">${ic('shield-check')} Гарантія: якщо ${st.n} відкриттів поспіль цього кейса без ${clsBadge(st.cls)} або кращого, ${st.n}-те дає ${clsBadge(st.cls)} або краще. Ключі теж рахуються.${st.missing ? ` Гарантована — машина, якої ще немає в колекції; поки колекція неповна, лічильник скидає лише нова. Це колекційні машини: дилер викуповує їх за ${S.HOME_SELL_RATE * 100}% вартості, в апгрейд і трейд-ін вони не йдуть.` : ''}</div>`).join('')}
    ${Object.keys(W).map((cls) => {
      const list = cs.pool(cls);
      const w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
      const p = (W[cls] / total) * 100;
      return `<div class="h2"><span>${clsBadge(cls)} ${S.CLASSES[cls].name}</span><span>${pct(p)}</span></div>
        <div class="grid">${list.map((m, i) => `<div class="car" style="min-height:0;--c:${S.CLASSES[cls].color}">${owned.has(m.id) ? '<span class="tr win">✓</span>' : ''}<div class="art" style="height:54px">${carArt(m.id)}</div><div class="nm tiny">${esc(m.name)}</div><div class="meta">${pct((p * w[i]) / sw)} · ${S.short(S.dropSaleOf(m.id, cs))}</div></div>`).join('')}</div>`;
    }).join('')}`);
};
H.openCase = async (d, el) => {
  if (state.opening) return;
  const cs = S.CASE_BY_ID[state.caseId];
  const n = cs.starter ? 1 : state.count;
  state.opening = true;
  state.countPicked = false; // the next drop screen may step the count down again (TABS.cases)
  hideClaimBanners();
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
  state.dropCase = cs.id;
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
  if (wowDrop()) return; // a rare drop gets the full-screen show first; tapping through plays the normal result below
  state.fx = null;
  const best = state.drop.reduce((a, r) => Math.max(a, S.rankOf(M(r.car.model).cls)), 0);
  const color = S.CLASS_ORDER.map((c) => S.CLASSES[c].color)[best];
  haptic(best >= 3 ? 'heavy' : best >= 1 ? 'medium' : 'success');
  if (best >= 4) setTimeout(() => haptic('success'), 420);
  if (best >= 3) setTimeout(() => SFX.rare(best), 120);
  if (state.drop.length === 1) {
    const car = state.drop[0].car;
    setTimeout(() => {
      FX.dropShow(best, color, { host: $('#revealWrap'), target: $('#dropArt'), newEl: $('.newtag') });
      if (state.drop?.[0]?.isNew) setTimeout(() => SFX.coin(), 480);
    }, 150);
    FX.countUp($('#dropValue'), sellPrice(car), 900, S.fmt);
  } else {
    // Cards flip in one by one with a few sparkles in their colour.
    state.drop.forEach((r, i) => {
      const rank = S.rankOf(M(r.car.model).cls);
      setTimeout(() => {
        const el = document.querySelectorAll('.multi > div')[i];
        if (!el) return;
        const c = S.CLASSES[M(r.car.model).cls].color;
        FX.sparkle(el, [c, '#fff'], 3 + rank * 2);
        if (rank >= 3) FX.burst(...FX.centerOf(el), [c, '#fff'], { count: rank >= 4 ? 70 : 40, power: rank >= 4 ? 9 : 6, shape: rank >= 4 ? 'mix' : 'spark' });
        if (rank >= 4) FX.shake(undefined, 320);
        haptic(rank >= 2 ? 'medium' : 'light');
        SFX.tick(1.2 + rank * 0.1);
      }, i * 180 + 300);
    });
  }
};
// Honest strip: the winner is exactly what the server rolled; every other card, its neighbours included, is a fresh
// draw by the case's odds (weightedModel). The suspense stays (slow-down; a B+ win hangs a card short, then creeps on),
// but there are no planted rare neighbours: a near-miss happens only as often as the odds make one — when the real
// neighbour is rarer than the drop, the reel stops leaning a little towards it.
function spin(cs, winner, reelOpts = {}) {
  const strip = [];
  const at = (i, W) => (i === W ? winner : (strip[i] ??= weightedModel(cs)));
  const lean = (W) => {
    const r = S.rankOf(M(winner).cls), prev = S.rankOf(M(at(W - 1, W)).cls), next = S.rankOf(M(at(W + 1, W)).cls);
    if (Math.max(prev, next) <= r) return 0;
    return prev === next ? (Math.random() < 0.5 ? -1 : 1) : prev > next ? -1 : 1;
  };
  return spinReel({ cardAt: (i, W) => reelCard(at(i, W), cs), color: S.CLASSES[M(winner).cls].color, rank: S.rankOf(M(winner).cls), lean, ...reelOpts });
}
// The horizontal case reel shared by car and part cases: cardAt(i, W) builds card i, W is the winner's index.
// wrap/reel default to the single big reel; several small reels (×3/×6) pass their own, each a bit longer (`extra`)
// so they stop one after another, and all but the first stay `quiet` (no haptics, no flash).
// lean: -1 / 1 stops a little towards that neighbour, or a function of W giving it (after the strip is known).
function spinReel({ cardAt, color, rank, lean = 0, wrap = $('#reelWrap'), reel = $('#reel'), extra = 0, quiet = false }) {
  return new Promise((resolve) => {
    if (!reel) return resolve();
    const N = 46, W = 34;
    if (typeof lean === 'function') lean = lean(W);
    reel.innerHTML = Array.from({ length: N }, (_, i) => cardAt(i, W)).join('');
    const card = reel.children[1].offsetLeft - reel.children[0].offsetLeft; // card width + gap, big or mini reel
    const cardW = reel.children[0].offsetWidth;
    const target = W * card + cardW / 2 - wrap.clientWidth / 2 + (lean ? lean * (0.3 + Math.random() * 0.12) : (Math.random() - 0.5) * 0.6) * cardW;
    // Motion is driven from JS (transform only, no layout reads per frame) in up to three parts:
    //  1. spin: a quick ramp-up, then a long ease-out (velocity ∝ (1-u)^2.4) to the stop;
    //  2. B+ only — tease: the spin ends one card short, the reel hangs there for a beat and then creeps over;
    //  3. settle: it overshoots the stop by a fraction of a card and springs back.
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const teaseOn = rank >= 2 && !reduce;
    const over = reduce ? 0 : cardW * (0.1 + Math.random() * 0.06);
    const teaseD = teaseOn ? card * 0.92 : 0;
    const spinMs = (reduce ? 1200 : 4300) + extra, teaseMs = teaseOn ? 1050 : 0, settleMs = reduce ? 0 : 380;
    const spinTo = target + (teaseOn ? -teaseD : over);
    // Ease table for part 1 (numerically integrated velocity profile, normalised to 0…1).
    const N_E = 240, A = 0.07, prof = [0];
    for (let i = 1; i <= N_E; i++) {
      const u = (i - 0.5) / N_E;
      prof.push(prof[i - 1] + Math.min(1, u / A) * Math.pow(1 - u, 2.4));
    }
    const ease = (u) => {
      const f = Math.min(N_E, Math.max(0, u * N_E)), i = Math.floor(f);
      const v = i >= N_E ? prof[N_E] : prof[i] + (prof[i + 1] - prof[i]) * (f - i);
      return v / prof[N_E];
    };
    const smooth = (u) => u * u * (3 - 2 * u);
    const posAt = (t) => {
      if (t < spinMs) return spinTo * ease(t / spinMs);
      t -= spinMs;
      if (teaseOn) {
        if (t < teaseMs) {
          const u = Math.max(0, (t - 260) / (teaseMs - 260)); // hang for 260 ms, then creep (and overshoot)
          return spinTo + (teaseD + over) * smooth(u);
        }
        t -= teaseMs;
      }
      if (t < settleMs) return target + over * (1 - smooth(t / settleMs));
      return target;
    };
    const total = spinMs + teaseMs + settleMs;
    let last = -1, teased = false, slowed = false;
    const half = wrap.clientWidth / 2;
    wrap.classList.add('spinning');
    reel.style.transition = 'none';
    // The curve is baked into WAAPI keyframes (one every ~16 ms) so the compositor plays it even when the main
    // thread is busy; the rAF loop below only reads the animation clock for ticks and state changes.
    const K = Math.max(2, Math.round(total / 16));
    const anim = reel.animate(Array.from({ length: K + 1 }, (_, i) => ({ transform: `translate3d(${-posAt((total * i) / K).toFixed(1)}px,0,0)`, offset: i / K })), { duration: total, easing: 'linear', fill: 'forwards' });
    let ended = false;
    // rAF pauses in a background tab while the animation still finishes: settle from a timer then.
    const onEnd = () => ((ended = true), setTimeout(() => !stopped && frame(), 120));
    anim.finished.then(onEnd, onEnd);
    let stopped = false;
    const frame = () => {
      const t = Math.min(total, Number(anim.currentTime) || 0);
      const x = posAt(t);
      const idx = Math.floor((x + half) / card);
      if (idx !== last) {
        if (last >= 0 && !quiet) {
          // A soft click per card through the gate; pitch drops a little as the reel slows.
          SFX.tick(t < spinMs * 0.5 ? 1 : 0.85);
          hapticTick('soft', t < spinMs * 0.6 ? 90 : 40);
        }
        last = idx;
        reel.children[idx]?.animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 160 });
      }
      if (!slowed && t > spinMs * 0.55) (slowed = true, wrap.classList.replace('spinning', 'slowing'));
      if (teaseOn && !teased && t >= spinMs) {
        teased = true;
        wrap.classList.add('tease');
        wrap.style.setProperty('--c', color);
        if (!quiet) (SFX.tease(teaseMs), haptic('light'));
      }
      if (!ended && t < total) return requestAnimationFrame(frame);
      reel.style.transform = `translate3d(${-target}px,0,0)`;
      stop();
    };
    requestAnimationFrame(frame);
    function stop() {
      if (stopped) return;
      stopped = true;
      const w = reel.children[W];
      w.style.setProperty('--c', color);
      w.classList.add('winner');
      wrap.classList.remove('tease');
      wrap.style.setProperty('--c', color);
      wrap.classList.add('stopped', `r${rank}`); // the rest of the strip dims, the gate takes the winner's colour
      haptic(rank >= 3 ? 'heavy' : rank >= 2 || !quiet ? 'medium' : 'light');
      if (!quiet) {
        SFX.pop(rank);
        FX.flash(color, rank >= 4 ? 0.3 : rank >= 2 ? 0.18 : 0.1, 420);
        if (rank >= 3) FX.burst(...FX.centerOf(w), [color, '#ffffff'], { count: rank >= 4 ? 40 : 24, power: 6 });
      } else if (rank >= 2) FX.sparkle(w, [color, '#ffffff'], 4 + rank);
      setTimeout(resolve, 650);
    }
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
  if (!isOpen(state.raceView)) state.raceView = 'race';
  const seg = `<div class="seg">${[['race', 'Драг-заїзд'], ['career', "Кар'єра"], ['drift', 'Дрифт'], ['pvp', 'PvP']].map(([k, t]) => `<button class="${state.raceView === k ? 'on' : ''} ${isOpen(k) ? '' : 'locked'}" data-act="raceView" data-k="${k}">${isOpen(k) ? '' : ic('lock')}${t}</button>`).join('')}</div>${eventStrip(['race', 'fuel'])}`;
  const garage = me.cars.filter((c) => c.status === 'garage');
  if (!garage.length) return seg + emptyBox('flag-3', 'Немає на чому їхати', 'Для гонки потрібна хоча б одна машина в гаражі', '<button class="btn sm" data-act="toCases">Відкрити кейс</button>');
  if (!garage.some((c) => c.id === state.raceCar)) state.raceCar = prefGet('raceCar', (id) => garage.some((c) => c.id === id)) || [...garage].sort((a, b) => (b.tank > 0) - (a.tank > 0) || a.et - b.et)[0].id;
  readyRaceCar(garage);
  prefSet('raceCar', state.raceCar);
  const car = garage.find((c) => c.id === state.raceCar);
  if (state.raceView === 'pvp') return seg + await pvpView(car);
  if (state.raceView === 'drift') return seg + await driftView(car, garage);
  if (state.raceView === 'career') return seg + await careerView(car, garage);
  const { list } = await api('race/rivals', { carId: car.id });
  const cls = M(car.model).cls;
  return seg + `<div class="h2"><span>Твоя машина</span><span>${garage.length}</span></div>
    <div class="carpick">${garage.map((c) => carTile(c, { act: 'pickRaceCar', sel: c.id === car.id, showTank: true })).join('')}</div>
    ${fuelCard(car)}
    <div class="h2"><span>Суперники · клас ${cls}</span><span>драг 402 м</span></div>
    <div class="list rivals">${list.map((r) => `<button class="rival d-${r.id}" data-act="startRace" data-rival="${r.id}">
      ${miniCar(r.model)}
      <div class="grow"><b class="ellipsis">${esc(r.name)}</b><div class="small muted rv-meta"><span class="ellipsis">${esc(M(r.model).name)}</span><span class="nw">· ${r.hp} к.с.</span></div>${r.driver ? `<div class="tiny muted rv-drv">водій: ${esc(r.driver)}</div>` : ''}
        <div class="row mt" style="gap:6px"><span class="diff ${r.id}">${r.label}</span>${rivalChanceChip(r)}</div></div>
      <div class="center"><b class="win">+${S.short(r.prize)}</b><div class="tiny muted">${r.entry ? `внесок ${S.short(r.entry)}` : 'без внеску'}</div>${r.et ? `<div class="tiny muted">${dec(r.et, 2)} с</div>` : ''}</div></button>`).join('')}</div>
    ${challengeRaceRow()}
    <details class="dr-how"><summary>${ic('info-circle')} Як їздити</summary><div class="tiny muted">Тисни на суперника, щоб почати. Три жовті — чекай; щойно загориться зелений, жми «ГАЗ». Натиснеш до зеленого — фальстарт (−8% потужності). Реакція 0,10–0,15 с — ідеальний старт (+4%). Під час заїзду перемикай передачі, коли стрілка тахометра в зеленій зоні; не встигнеш — передача перемкнеться сама на відсічці, але пізно. Програв — внесок згоряє.</div>
      <div class="tiny muted mt">${RIVAL_HONEST_TEXT}</div></details>`;
};
// «Чесний шанс»: the chance chip of a solo rival — or, for an easy rival you'd lose more often than not right now,
// a plain «важко» instead of a number (S.RACE_FORM.toughBelow).
const rivalChanceChip = (r) => (r.tough ? '<span class="chip rv-tough">Для тебе зараз: важко — потренуйся</span>' : `<span class="chip">шанс ${r.chance < 1 ? '<1' : r.chance}%</span>`);
const RIVAL_HONEST_TEXT = `Шанс — за медіаною ${S.RACE_FORM.runs} твоїх останніх заїздів, де ти сам перемикав передачі (заїзди на автопілоті не рахуються; поки таких заїздів мало — як у доброго водія). На Тренуванні й Легкому шанс не нижчий, ніж у звичайного водія, який перемикає передачі (Тренування — щонайменше ${S.CHANCE_FLOOR.train}%). Суперники — справжні машини з їхньою реальною потужністю, а швидкість їм дає водій: від новачка до легенди. Деталі на твоїй машині піднімають шанс.`;
// Fuel: one tank for every car — 15 slanted pips like the key fragments, a race of any kind takes one.
function fuelCard(car, extra = '') {
  if (me.fuel < 1) return fuelOut();
  return `<div class="card fuelcard mt"><div class="row between"><span class="hook-t">${ic('gas-station')} Пальне</span><b class="fuel-n">${me.fuel}<small>/${S.FUEL_MAX}</small></b></div>
    <div class="pips fuel">${Array.from({ length: S.FUEL_MAX }, (_, i) => `<i class="${i < me.fuel ? 'on' : ''}"></i>`).join('')}</div>
    <div class="row between small"><span class="muted">${me.fuelNext ? `+1 через <span data-until="${me.fuelNext - clockOffset}">${left(me.fuelNext - serverNow())}</span>` : 'Бак повний'}</span><span class="muted">заїзд = 1 пальне</span></div>
    ${extra || `<div class="tiny muted mt">Один бак на всі машини, +1 кожні ${S.FUEL_REGEN_MIN} хв · ${car.hp} к.с. · ${dec(car.et, 2)} с на 402 м</div>`}</div>`;
}
// An empty tank: the rivals below grey out (CSS .fuel-out ~ .rivals) and this card says when the next one comes and
// what to do meanwhile — instead of an error toast on a tap. The screen redraws itself when the fuel is back.
function fuelOut() {
  fuelBackSoon();
  const next = me.fuelNext ? `+1 через <span data-until="${me.fuelNext - clockOffset}">${left(me.fuelNext - serverNow())}</span>` : 'скоро +1';
  return `<div class="card fuelcard fuel-out mt" id="fuelOut"><div class="row between"><span class="hook-t">${ic('gas-station')} Пальне ${me.fuel}/${S.FUEL_MAX}</span><b class="fuel-next">${next}</b></div>
    <div class="pips fuel">${Array.from({ length: S.FUEL_MAX }, () => '<i></i>').join('')}</div>
    <div class="small">Поки бак наповнюється — відкрий кейс або забери нагороду: кейс нагород буває з повним баком.</div>
    <div class="btns mt"><button class="btn sm" data-act="toCases">${ic('box')} Кейси</button><button class="btn sm ghost" data-act="fuelGifts">${ic('gift')} Нагороди</button></div></div>`;
}
let fuelTimer = 0;
function fuelBackSoon() {
  clearTimeout(fuelTimer);
  if (!me.fuelNext) return;
  fuelTimer = setTimeout(() => {
    if (state.tab === 'race' && !state.page && !state.race && !state.drift && $('#modal').hidden) refresh().catch(() => {});
  }, Math.min(2 ** 31 - 1, Math.max(1000, me.fuelNext - serverNow() + 600)));
}
// Fuel as of now (the last `me` may be a few minutes old: the next one may have come since).
const fuelNow = () => me.fuel + (me.fuel < S.FUEL_MAX && me.fuelNext && serverNow() >= me.fuelNext ? 1 : 0);
// A tap on a greyed rival: point at the card instead of an error.
function fuelNudge() {
  const card = $('#fuelOut');
  haptic('warning');
  if (!card) return toast(`Пальне 0/${S.FUEL_MAX}`);
  card.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  FX.shake(card, 360);
}
H.fuelGifts = () => openRewards();
// The car picker rail: the chosen car is always in view (it may be the 20th of 30), without moving the page.
// Race / drift / PvP verdict, once it is on screen: a win throws yellow confetti and counts the prize up,
// a loss gives the verdict a small shake.
function resultFx() {
  const fx = state.resultFx;
  if (!fx) return;
  const hero = $('.rhero') || $('#view .big.win, #view .big.lose')?.parentElement;
  if (!hero) return;
  state.resultFx = null;
  clearFab();
  if (fx.win) {
    FX.confetti(['#f5b301', '#ffd500', '#fff3b0', '#ffffff'], 1);
    FX.popEl(hero.querySelector('.rhero-t, .big'), 1.15, 480);
    SFX.win();
    // The prize readout counts up from zero (keeps its "+" and currency format).
    const amt = hero.querySelector('.rhero-amt') || hero.querySelector('.win[style*="font-size"]');
    const m = amt?.textContent.match(/^\+\s*([\d\s ]+)\s*₴/);
    if (m) FX.countUp(amt, num(m[1]), 800, (v) => '+' + S.fmt(v));
  } else {
    FX.shake(hero, 360);
    SFX.lose();
  }
}
// A result's main buttons never sit half under the raised «Кейси»: when the row is partly in view, the page moves up
// just enough (at most ~1/4 of the screen, so the verdict stays), the way the first-steps card clears the tab bar.
function clearFab() {
  const row = $('.dr-btns') || $('#view [data-act="bossNext"], #view [data-act="bossAgain"], #view [data-act="driftAgain"]');
  const fab = $('#tabs button[data-tab="cases"] .i');
  if (!row || !fab) return;
  const r = row.getBoundingClientRect(), top = fab.getBoundingClientRect().top - 10;
  const need = r.bottom - top;
  if (need > 0 && r.top < $('#tabs').getBoundingClientRect().top && need < innerHeight / 4) window.scrollBy({ top: need, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
AFTER.race = () => {
  resultFx();
  const pick = $('.carpick'), cur = pick?.querySelector('.car.sel');
  if (!cur) return;
  const dx = cur.getBoundingClientRect().left - pick.getBoundingClientRect().left;
  if (dx < 16 || dx + cur.offsetWidth > pick.clientWidth - 16) pick.scrollLeft += dx - 16;
};
H.raceView = (d) => (isOpen(d.k) ? (state.raceView = d.k, render()) : lockedSheet(d.k));
H.pickRaceCar = (d) => (state.raceCar = state.raceCarPicked = Number(d.id), prefSet('raceCar', state.raceCar), render());
// A remembered car with an empty tank never stays the default when another car can go (audit: the career opened on
// the Москвич 0/5 while the BYD was full) — unless the player picked it himself in this session. `ok` narrows it
// further (the career: a class the next boss takes). The fastest ready car wins.
function readyRaceCar(garage, ok = () => true) {
  const cur = garage.find((c) => c.id === state.raceCar);
  if (!cur || state.raceCarPicked === cur.id || (cur.tank > 0 && ok(cur))) return false;
  const alt = garage.filter((c) => c.tank > 0 && ok(c)).sort((a, b) => a.et - b.et)[0];
  if (!alt) return false;
  state.raceCar = alt.id;
  prefSet('raceCar', alt.id);
  return true;
}

H.startRace = async (d) => {
  if (fuelNow() < 1) return fuelNudge();
  let r;
  try {
    r = await api('race/start', { carId: state.raceCar, rival: d.rival });
  } catch (e) {
    return toast(e.message, true);
  }
  me.fuel--;
  renderHeader();
  hideClaimBanners();
  state.race = { phase: 'lights', id: r.raceId, car: r.car, rival: r.rival, greenMs: r.greenMs, reaction: null, shifts: [], gear: 1, result: null };
  // Training and the very first race coach: a short "how to drive" card on this device's first one (the lights start
  // when it's closed — the server only checks that a run didn't finish too soon), and the button lights up in the zone.
  state.race.coach = r.rival.id === 'train' || !me.stats.races;
  await render();
  if (state.race.coach && !drSeen()) return dragCoach(state.race);
  runRace();
};
// «Ще раз»: the same difficulty again (the rival list is drawn anew after every race, so it's a new car of that tier).
H.raceRetry = async (d) => {
  state.race = null;
  await H.startRace(d);
  if (!state.race) render();
};

// ---------- drag scene: a side view of a night strip ----------
// Two lanes (the rival's further away, smaller), both cars' photos (yours in its paint) placed by the simulated
// distance, a camera between them, parallax city / neon / lamps / grid road, start, distance boards and finish.
// Everything moves with transforms from one rAF loop; with reduced motion the camera stands still and shows the
// whole 402 m (no parallax, smoke or shake).
const DR_PXM = 9; // px per metre of track
const DR_RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DR_COACH_KEY = 'av.dragCoach';
const DR_MARKS = [[0, 'start', 'СТАРТ'], [100, 'num', '100 м'], [201, 'num', '201 м'], [300, 'num', '300 м'], [402, 'finish', 'ФІНІШ']];
const drSeen = () => { try { return !!localStorage.getItem(DR_COACH_KEY); } catch { return true; } };
const QLABEL = { perfect: 'Ідеально', good: 'Добре', early: 'Рано', late: 'Пізно', miss: 'Пропуск' };
let drSkyline = '';
function drCity() {
  if (drSkyline) return drSkyline;
  const rnd = S.seededRand(402);
  let s = '', x = 0;
  while (x < 480) {
    const w = 16 + Math.floor(rnd() * 34), h = 24 + Math.floor(rnd() * 78), y = 110 - h;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${rnd() < 0.5 ? '#141c2f' : '#0f1628'}"/>`;
    for (let wy = y + 6; wy < 104; wy += 7) for (let wx = x + 3; wx < x + w - 4; wx += 5) {
      if (rnd() < 0.15) s += `<rect x="${wx}" y="${wy}" width="2" height="3" fill="${rnd() < 0.72 ? '#ffd27a' : '#8fdcff'}" opacity="${(0.3 + rnd() * 0.55).toFixed(2)}"/>`;
    }
    if (h > 84 && rnd() < 0.7) s += `<rect x="${x + (w >> 1)}" y="${y - 9}" width="1" height="9" fill="#1b2438"/><circle cx="${x + (w >> 1) + 0.5}" cy="${y - 9}" r="1.5" fill="#ff4d5a"/>`;
    x += w + Math.floor(rnd() * 5);
  }
  return (drSkyline = `<svg viewBox="0 0 480 110" width="480" height="110" aria-hidden="true">${s}</svg>`);
}
// Tachometer: 270° dial, the shift zones of S.tapQuality (good 0.70–0.82, perfect 0.82–0.94), the limiter from 0.94.
const DR_ANG = (v) => -135 + 270 * Math.max(0, Math.min(1, v / 1.04));
const DR_GAUGE = (() => {
  const pt = (a, r) => [56 + r * Math.sin((a * Math.PI) / 180), 56 - r * Math.cos((a * Math.PI) / 180)].map((n) => n.toFixed(1)).join(' ');
  const arc = (v0, v1, r) => `M${pt(DR_ANG(v0), r)}A${r} ${r} 0 ${DR_ANG(v1) - DR_ANG(v0) > 180 ? 1 : 0} 1 ${pt(DR_ANG(v1), r)}`;
  let ticks = '';
  for (let i = 0; i <= 10; i++) ticks += `<path d="M${pt(DR_ANG(i / 10), 36)}L${pt(DR_ANG(i / 10), i % 2 ? 40 : 42)}" class="g-tick"/>`;
  return `<svg viewBox="0 0 112 112" aria-hidden="true"><path d="${arc(0, 1.04, 48)}" class="g-bg"/><path d="${arc(0.7, 0.82, 48)}" class="g-good"/><path d="${arc(0.82, 0.94, 48)}" class="g-perf"/><path d="${arc(0.94, 1.04, 48)}" class="g-red"/>${ticks}</svg>`;
})();
function raceScreen() {
  const R = state.race;
  if (R.phase === 'done') return raceResult();
  const city = `<div class="dr-tile">${drCity()}</div>`;
  const neon = '<div class="dr-ntile"><i class="dr-bb" style="left:24px;--c:#ff3ea5">ДРАГ 402</i><i class="dr-bb" style="left:206px;--c:#3ee0ff">АВТОДРОП</i></div>';
  const car = (who, model, look, tag) => `<div class="dr-car ${who}" id="dr-${who}"><div class="dr-tag">${tag}</div><i class="dr-shd"></i>
    <div class="dr-smoke"><i></i><i></i><i></i><i></i><i></i></div><div class="dr-bod"><i class="dr-beam"></i>${carArt(model, { look })}<i class="dr-flame"></i></div></div>`;
  return `<div class="drag${DR_RM ? ' rm' : ''}${R.rival.plan ? ' ghost' : ''}" id="drag">
  <div class="dr-scene" id="drScene">
    <div class="dr-sky"></div>
    <div class="dr-par dr-city">${city}${city}</div>
    <div class="dr-par dr-neon">${neon}${neon}${neon}</div>
    <div class="dr-road"><div class="dr-floor"><div class="dr-plane"><i class="dr-grid"></i></div></div><div class="dr-dashes"><i></i></div></div>
    <div class="dr-lamps">${'<i class="dr-lamp"></i>'.repeat(4)}</div>
    ${DR_MARKS.map(([m, k, t]) => `<div class="dr-mk ${k}" data-m="${m}"><b>${t}</b></div>`).join('')}
    <div class="dr-streaks">${'<i></i>'.repeat(6)}</div>
    ${car('rv', R.rival.model, R.rival.look, `${R.rival.plan ? ic('ghost') : ''}<b class="ellipsis">${esc(R.rival.name)}</b><span>${R.rival.hp} к.с.</span>`)}
    ${car('me', R.car.model, R.car.look, `<b>Ти</b><span>${R.car.hp} к.с.</span>`)}
    <div class="dr-off l" id="drOffL"></div><div class="dr-off r" id="drOffR"></div>
    <div class="dr-hud"><div><small>Час</small><b id="rTimer">0,000</b></div><div class="right"><small>Розрив</small><b id="rGap">—</b></div></div>
    <div class="dr-tree" id="tree"><i></i><i></i><i></i><i></i></div>
    <div class="dr-msg" id="drMsg"></div>
    <div class="dr-pops" id="drPops"></div>
  </div>
  <div class="dr-panel">
    <div class="dr-tacho" id="drTacho">${DR_GAUGE}<i class="dr-needle" id="needle"></i><b id="rGear">N</b><small>передача</small></div>
    <div class="dr-read">
      <div class="dr-spd"><b id="rSpeed">0</b><small>км/год</small></div>
      <div class="dr-map" id="drMap"><i class="rv"></i><i class="me"></i></div>
      <div class="dr-map-l"><span>0</span><span>201</span><span>402 м</span></div>
      <div class="dr-slots" id="rShifts">${[1, 2, 3, 4].map((i) => `<span>${i}→${i + 1}</span>`).join('')}</div>
    </div>
  </div>
  <div class="dr-hint" id="rHint">Чекай зелений — тоді жми «Газ»</div>
  <button class="btn racebtn wait" id="raceBtn">Чекай зелений…</button>
</div>`;
}
// The first-race card over the whole race screen; «На старт» starts the lights.
function dragCoach(R) {
  $('#drag')?.insertAdjacentHTML('beforeend', `<div class="dr-coach" id="drCoach"><div class="dr-coach-in">
    <b class="dr-coach-t">Як їхати драг</b>
    <div class="dr-step"><span class="dr-ci lights"><i></i><i></i><i></i><i class="g"></i></span><span><b>Три жовті — чекай.</b> Загорівся зелений — одразу тисни «Газ». Натиснеш раніше — фальстарт, −8% потужності.</span></div>
    <div class="dr-step"><span class="dr-ci zone"></span><span><b>Стрілка в зеленій зоні — «Передача».</b> Чотири перемикання за заїзд; яскраво-зелена смуга — ідеально.</span></div>
    <div class="dr-step"><span class="dr-ci red"></span><span><b>Не встиг?</b> На червоній відсічці передача перемкнеться сама, але пізно — це втрачений час.</span></div>
    <button class="btn yellow" id="drGo">Зрозуміло — на старт!</button></div></div>`);
  $('#drGo')?.addEventListener('click', () => {
    try { localStorage.setItem(DR_COACH_KEY, '1'); } catch {}
    $('#drCoach')?.remove();
    if (state.race === R && R.phase === 'lights') runRace();
  }, { once: true });
}
const drEls = () => {
  const s = $('#drScene');
  if (!s) return null;
  const q = (x) => s.querySelector(x);
  return { drag: $('#drag'), scene: s, me: q('#dr-me'), rv: q('#dr-rv'), meB: q('#dr-me .dr-bod'), rvB: q('#dr-rv .dr-bod'), city: q('.dr-city'), neon: q('.dr-neon'),
    grid: q('.dr-grid'), dashes: q('.dr-dashes i'), lamps: q('.dr-lamps'), marks: [...s.querySelectorAll('.dr-mk')], streaks: q('.dr-streaks'), streak: [...s.querySelectorAll('.dr-streaks i')],
    offL: q('#drOffL'), offR: q('#drOffR'), timer: q('#rTimer'), gap: q('#rGap'), tree: q('#tree'), msg: q('#drMsg'), pops: q('#drPops'),
    tacho: $('#drTacho'), needle: $('#needle'), gear: $('#rGear'), speed: $('#rSpeed'), map: $('#drMap'), mapMe: $('#drMap .me'), mapRv: $('#drMap .rv'),
    slots: [...document.querySelectorAll('#rShifts span')], hint: $('#rHint'), btn: $('#raceBtn') };
};
// A short label floating up above the cars (never over the button).
function drPop(E, title, sub, q) {
  if (!E?.pops) return;
  E.pops.replaceChildren();
  const el = document.createElement('div');
  el.className = `dr-pop q-${q}`;
  el.innerHTML = `<b>${title}</b>${sub ? `<small>${sub}</small>` : ''}`;
  E.pops.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
// A message panel in the sky (false start, "not yet", the finish); ms = 0 keeps it.
function drMsg(E, title, sub, cls, ms = 1600) {
  if (!E?.msg) return;
  clearTimeout(E.msg._t);
  E.msg.innerHTML = `<b>${title}</b>${sub ? `<small>${sub}</small>` : ''}`;
  E.msg.className = `dr-msg on ${cls}`;
  if (ms) E.msg._t = setTimeout(() => E.msg.classList.remove('on'), ms);
}
// What a reaction means, for the pop at the start and the result card. early = s before green for a false start.
function drStart(reaction, early = 0) {
  const r = (x) => dec(x, 3) + ' с';
  if (reaction < 0) return { q: 'bad', t: 'Фальстарт', s: early > 0.0005 ? `«Газ» за ${dec(early, 2)} с до зеленого · −8% потужності` : '«Газ» до зеленого · −8% потужності' };
  if (reaction >= 1.5) return { q: 'late', t: 'Пізній старт', s: 'машина рушила сама через 1,5 с після зеленого' };
  if (S.perfectStartOf(reaction)) return { q: 'perfect', t: 'Ідеальний старт', s: `реакція ${r(reaction)} · +4% потужності` };
  if (reaction < S.START.minReaction) return { q: 'good', t: 'Блискавичний старт', s: `${r(reaction)} · бонус +4% — за реакцію 0,10–0,15 с` };
  if (reaction < 0.3) return { q: 'good', t: 'Добрий старт', s: `реакція ${r(reaction)}` };
  return { q: 'late', t: 'Повільний старт', s: `реакція ${r(reaction)} · тисни, щойно загориться зелений` };
}
// Time a shift of this quality costs (+) or gains (−), as S.raceTime counts it for this car's gearbox.
const drLoss = (q, car) => {
  const l = S.SHIFT_LOSS[q] ?? S.SHIFT_LOSS.miss;
  return l > 0 ? l * (1 - (car.shift || 0)) : l;
};
// Solo race against a bot, or a live PvP race (R.live): then the lights follow the server's shared start time, the
// rival's bar follows the other player's real progress, and the result comes once both have finished.
function runRace() {
  const R = state.race;
  let E = drEls();
  const lights = [...E.tree.children];
  const btn = E.btn;
  const sinceStart = R.live ? serverNow() - R.live.startAt : 0;
  // The server picks the green light; every tap is reported in ms from the start of the lights (t0) so the server can
  // recompute the reaction and the shifts. Times are rounded to 0.1 ms first so both sides compute the same numbers.
  const t0 = performance.now() - sinceStart;
  const greenMs = R.live ? R.live.greenAt - R.live.startAt : R.greenMs ?? 2200 + Math.random() * 1200;
  const greenAt = greenMs - sinceStart;
  const clock = (from) => Math.round((performance.now() - from) * 10) / 10;
  R.shiftAt = [];
  let green = 0, runStart = 0, raf = 0, lastTap = 0;
  const lbs = R.car.kg * 2.2046;
  const vmax = 1.609 * 234 * Math.cbrt(R.car.hp / lbs);
  const timers = [600, 1200, 1800].map((ms, i) => setTimeout(() => {
    lights[i].className = 'amber';
    haptic('light');
    SFX.tick(0.9 + i * 0.1);
    if (i === 0) E.drag?.classList.add('rev');
  }, Math.max(0, ms - sinceStart)));
  const scene = drScene(E, R);
  scene.draw(0, 0, 0, 0, 0.12, 0);
  // Miss-click guard: taps in the first 1.5 s of the lights (the first two ambers) don't count — many players hit the
  // button right away thinking it starts the race. After that, until green, a tap is a real false start.
  // Green comes at 2.2–3.4 s, so there is always at least 0.7 s where jumping the light costs −8%.
  const guardUntil = performance.now() + Math.max(500, S.RACE_GUARD - sinceStart); // live race joined late: still 0.5 s
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
    btn.className = 'btn racebtn gas';
    btn.textContent = 'Газ!';
    E.hint.textContent = 'Зелений — тисни «Газ»!';
    haptic('medium');
    SFX.tick(1.8);
  }, greenAt));
  timers.push(setTimeout(() => !runStart && launch(), greenAt + S.RACE_LATE_START));
  let segStart = 0;
  const projected = () => S.raceTime(R.car, R.reaction, [...R.shifts, ...Array(S.SHIFTS - R.shifts.length).fill('good')]);
  function launch() {
    timers.forEach(clearTimeout);
    let at = clock(t0);
    // A tap once the green light is on screen is never a false start, whatever the timer rounding says.
    if (green && at < greenMs) at = Math.ceil(greenMs * 10) / 10;
    R.launchMs = at;
    const reaction = (R.reaction = S.reactionOf(R.launchMs, greenMs));
    R.phase = 'run';
    runStart = t0 + R.launchMs;
    lastTap = performance.now();
    E.drag?.classList.remove('rev');
    const st = drStart(reaction, (greenMs - R.launchMs) / 1000);
    if (reaction < 0) {
      R.jumpBy = (greenMs - R.launchMs) / 1000;
      lights.forEach((l) => (l.className = 'red'));
      drMsg(E, 'Фальстарт!', `Ти натиснув за ${dec(R.jumpBy, 2)} с до зеленого. Штраф −8% потужності — тепер жени!`, 'bad', 2600);
      haptic('error');
    } else {
      drPop(E, st.t, st.s, st.q);
      haptic(st.q === 'perfect' ? 'success' : 'light');
    }
    setTimeout(() => E.tree?.classList.add('off'), reaction < 0 ? 1400 : 500);
    scene.launch('me');
    btn.className = 'btn racebtn shift';
    btn.textContent = 'Передача';
    R.gear = 1;
    E.hint.textContent = R.coach ? 'Стрілка в зеленій зоні — тисни «Передача»' : 'Перемикай, коли стрілка в зеленій зоні';
    raf = requestAnimationFrame(frame);
  }
  const rpmAt = (u) => S.shiftRpm(R.shifts.length, segStart, u);
  function doShift(q, u, ms) {
    const i = R.shifts.length;
    R.shiftAt.push(ms);
    R.shifts.push(q);
    segStart = u;
    R.gear++;
    const slot = E.slots[i];
    if (slot) (slot.className = `q-${q}`, slot.textContent = QLABEL[q]);
    const l = drLoss(q, R.car);
    drPop(E, QLABEL[q], `${i + 1}→${i + 2}${Math.abs(l) > 0.0005 ? ` · ${l > 0 ? '+' : '−'}${dec(Math.abs(l), 2)} с` : ''}${q === 'late' ? ' · відсічка' : ''}`, q);
    scene.shift(q);
    haptic(q === 'perfect' ? 'success' : q === 'good' ? 'light' : 'warning');
    SFX.land(i);
  }
  btn.addEventListener('pointerdown', () => {
    if (R.phase === 'lights') {
      if (!green && performance.now() < guardUntil) {
        drMsg(E, 'Ще рано!', 'Дочекайся зеленого світла', 'warn', 1100);
        btn.classList.remove('nudge');
        void btn.offsetWidth;
        btn.classList.add('nudge');
        haptic('warning');
        return;
      }
      launch();
      return;
    }
    if (R.phase !== 'run' || R.sent || R.shifts.length >= S.SHIFTS) return;
    // The shift is judged at the moment of the tap (the server replays the same moment).
    const ms = clock(runStart);
    const u = S.dragU(R.car, R.reaction, R.shifts, S.msToTau(ms));
    if (u >= 1) return;
    // A second tap right after «Газ» or a shift with the needle still low is a double tap, not a gear change.
    if (performance.now() - lastTap < 200 && rpmAt(u) < 0.6) return;
    lastTap = performance.now();
    doShift(S.tapQuality(rpmAt(u)), u, ms);
  });
  let shownRivalD = 0, myFin = null, rvFin = null, txt = {};
  const ghost = R.rival.plan ? G.ghostDrive(R.rival, R.rival.plan) : null; // { react, drive } of a ghost challenge's run
  const coast = (t, v) => (DR_RM ? 0 : v * 1.1 * (1 - Math.exp(-t / 1.1))); // metres rolled past the line (t in race s)
  const set = (k, el, v) => txt[k] !== v && el && (el.textContent = txt[k] = v);
  function frame() {
    if (state.race !== R || R.phase === 'done') return;
    if (!E.scene.isConnected) {
      E = drEls();
      if (!E) return;
      scene.rebind(E);
    }
    const ms = clock(runStart);
    const tau = S.msToTau(ms);
    const T = projected();
    const u = S.dragU(R.car, R.reaction, R.shifts, tau);
    if (!R.sent && u < 1 && R.shifts.length < S.SHIFTS && rpmAt(u) >= S.SHIFT_AUTO_RPM) doShift('late', u, ms);
    // Solo: my car crossed the line — send the run now; the exact rival time comes back with the result.
    if (!R.live && u >= 1 && !R.sent) submit();
    const pd = Math.pow(u, 1.6);
    let ru, rd, rvGo;
    if (R.live) {
      // The rival's real progress arrives a few times a second; glide towards it so the car doesn't jump.
      R.myD = Math.max(R.myD || 0, pd);
      shownRivalD += (R.rivalD - shownRivalD) * 0.18;
      rd = shownRivalD;
      ru = 1; // my own finish ends my run; the result waits for the rival
      rvGo = rd > 0.0005;
    } else if (ghost) {
      // A ghost challenge: the creator's stored run on the same timeline as my car (public/ghost.js).
      ru = G.ghostU(R.rival, R.rival.plan, tau);
      rd = Math.pow(ru, 1.6);
      rvGo = tau > ghost.react;
      if (ru >= 1 && rvFin == null) rvFin = tau;
    } else {
      const rReact = 0.25;
      ru = Math.max(0, Math.min(1, (tau - rReact) / (R.rival.time - rReact)));
      rd = Math.pow(ru, 1.6);
      rvGo = tau > rReact;
      if (ru >= 1 && rvFin == null) rvFin = tau;
    }
    if (rvGo) scene.launch('rv');
    if (u >= 1 && myFin == null) myFin = tau;
    const myV = (402 * 1.6) / S.dragDrive(R.car, R.reaction, R.shifts).drive;
    const rvV = R.live ? myV : ghost ? (402 * 1.6) / ghost.drive : (402 * 1.6) / Math.max(0.5, R.rival.time - 0.25);
    const myM = pd * 402 + (myFin != null ? coast(tau - myFin, myV) : 0);
    const rvM = rd * 402 + (rvFin != null ? coast(tau - rvFin, rvV) : 0);
    const rpm = R.phase === 'run' && u < 1 ? Math.max(0, Math.min(1.04, rpmAt(u))) : Math.max(0.12, 0.5 * Math.exp(-(tau - (myFin ?? tau)) * 2));
    let kmh = Math.round(vmax * Math.pow(u, 0.62) * (0.92 + 0.08 * Math.min(1, rpmAt(u))));
    if (myFin != null) kmh = Math.round(kmh * Math.exp(-(tau - myFin) / 1.6));
    scene.draw(myM, rvM, kmh / Math.max(1, vmax), tau, rpm, u > 0 ? Math.min(R.gear, S.SHIFTS + 1) : 1);
    const hot = R.phase === 'run' && u < 1 && R.shifts.length < S.SHIFTS && rpm >= 0.82 && rpm <= 0.94;
    if (R.coach && btn.classList.contains('now') !== hot) btn.classList.toggle('now', hot);
    set('t', E.timer, Math.min(tau, R.live ? T : Math.max(T, R.rival.time)).toFixed(3).replace('.', ','));
    const gap = Math.round((pd - rd) * 402);
    if (u >= 1 && ru >= 1 && R.result) {
      set('g', E.gap, `${R.result.win ? '+' : '−'}${dec(R.result.diff, 3)} с`);
      E.gap.className = R.result.win ? 'win' : 'lose';
    } else if (!(u >= 1 && ru >= 1)) {
      set('g', E.gap, (gap > 0 ? '+' : '') + gap + ' м');
      E.gap.className = gap >= 0 ? 'win' : 'lose';
    }
    set('s', E.speed, String(kmh));
    if (R.live) {
      if (u >= 1 && !R.finSent) {
        R.finSent = true;
        finishLive();
      }
    } else if (u >= 1 && ru >= 1 && R.result && !R.endAt) {
      // Both are over the line: the verdict in the sky while the cars roll out, then the result screen.
      R.endAt = performance.now();
      const w = R.result.win;
      drMsg(E, w ? 'Перемога!' : 'Поразка', `${w ? 'швидше' : 'повільніше'} на ${dec(R.result.diff, 3)} с`, w ? 'win' : 'bad', 0);
      haptic(w ? 'success' : 'error');
      btn.disabled = true;
      E.hint.textContent = 'Фініш!';
    }
    if (R.endAt && performance.now() - R.endAt > (DR_RM ? 700 : 1300)) return finish();
    raf = requestAnimationFrame(frame);
  }
  // Shifts never made before the line count as late (padded in the copy only: the animation keeps its own list).
  const payload = () => ({ reaction: R.reaction, shifts: [...R.shifts, ...Array(Math.max(0, S.SHIFTS - R.shifts.length)).fill('late')], launch: R.launchMs, shiftAt: R.shiftAt });
  async function submit() {
    R.sent = true;
    try {
      const res = await api('race/finish', { raceId: R.id, ...payload() });
      R.rival.time = res.rivalTime; // the rival's bar finishes at its real time
      R.result = res;
    } catch (e) {
      cancelAnimationFrame(raf);
      toast(e.message, true);
      if (state.race === R) state.race = null;
      return render();
    }
  }
  async function finish() {
    cancelAnimationFrame(raf);
    while (R.shifts.length < S.SHIFTS) R.shifts.push('late');
    R.phase = 'done';
    state.resultFx = { win: !!R.result.win };
    await refresh();
  }
  // Live: send my run; the scene keeps running (my car rolls out, the rival's follows its real progress) until the
  // progress poll settles the race.
  async function finishLive() {
    R.myD = 1;
    R.phase = 'wait';
    E.hint.textContent = `Фініш! Чекаємо на ${R.rival.name}…`;
    btn.disabled = true;
    try {
      const s = await api('pvp/finish', { id: R.live.id, ...payload() });
      if (s.status === 'done') return settleLive(s);
    } catch (e) {
      toast(e.message, true);
    }
  }
}
// The scene's moving parts for one race: draw(myM, rivalM, speed 0..1, tau, rpm, gear) places the cars and the
// world for the camera; launch / shift kick the body (squat, nose dip, exhaust flame, tyre smoke).
function drScene(E0, R) {
  let E = E0, W = 0, meW = 0, rvW = 0, mapW = 0, last = 0, cache = new Map();
  const body = { me: { p: 0, v: 0, go: false }, rv: { p: 0, v: 0, go: false } };
  const measure = () => {
    W = E.scene.clientWidth;
    meW = E.me.offsetWidth;
    rvW = E.rv.offsetWidth;
    mapW = E.map.clientWidth;
  };
  measure();
  const tf = (el, v) => cache.get(el) !== v && (el.style.transform = v, cache.set(el, v));
  const kick = (who, p) => {
    if (DR_RM) return;
    body[who].v += p * 14; // a velocity kick: the body swings there and settles
  };
  return {
    rebind(e) {
      E = e;
      cache = new Map();
      measure();
    },
    launch(who) {
      if (body[who].go) return;
      body[who].go = true;
      const car = who === 'me' ? E.me : E.rv;
      car.classList.add('burn');
      kick(who, -3.2);
    },
    shift(q) {
      E.me.classList.remove('fl');
      void E.me.offsetWidth;
      E.me.classList.add('fl');
      kick('me', q === 'late' ? 2 : 1.3);
    },
    draw(myM, rvM, sp, tau, rpm, gear) {
      const now = performance.now(), dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      // Camera: halfway between the cars, but never letting mine off the screen; reduced motion: the whole strip.
      const A = W * 0.6;
      let x;
      let camPx = 0;
      if (DR_RM) {
        const x0 = meW + 6, k = (W - 12 - x0) / 402;
        x = (m) => x0 + Math.min(402, m) * k;
      } else {
        let cam = (myM + rvM) / 2;
        cam = Math.min(cam, myM - (meW + 6 - A) / DR_PXM);
        cam = Math.max(cam, myM - (W - 10 - A) / DR_PXM);
        camPx = cam * DR_PXM;
        x = (m) => A + (m - cam) * DR_PXM;
      }
      const meX = x(myM), rvX = x(rvM);
      for (const who of ['me', 'rv']) {
        const b = body[who];
        b.v += (-170 * b.p - 15 * b.v) * dt;
        b.p += b.v * dt;
        const bob = DR_RM || !b.go ? 0 : Math.sin(now / (who === 'me' ? 23 : 27)) * 0.5 * Math.min(1, sp);
        tf(who === 'me' ? E.meB : E.rvB, `translate3d(0,${bob.toFixed(2)}px,0) rotate(${b.p.toFixed(2)}deg)`);
      }
      tf(E.me, `translate3d(${(meX - meW).toFixed(1)}px,0,0)`);
      tf(E.rv, `translate3d(${(rvX - rvW).toFixed(1)}px,0,0)`);
      for (const mk of E.marks) tf(mk, `translate3d(${x(+mk.dataset.m).toFixed(1)}px,0,0)`);
      if (!DR_RM) {
        tf(E.city, `translate3d(${(-(camPx * 0.05) % 480).toFixed(1)}px,0,0)`);
        tf(E.neon, `translate3d(${(-(camPx * 0.22) % 360).toFixed(1)}px,0,0)`);
        tf(E.lamps, `translate3d(${(-camPx % 225).toFixed(1)}px,0,0)`);
        tf(E.grid, `translate3d(${(-camPx % 90).toFixed(1)}px,0,0)`);
        tf(E.dashes, `translate3d(${(-camPx % 90).toFixed(1)}px,0,0)`);
        const so = Math.max(0, Math.min(1, (sp - 0.3) * 1.8));
        if (cache.get('so') !== so.toFixed(2)) (E.streaks.style.opacity = so.toFixed(2), cache.set('so', so.toFixed(2)));
        if (so > 0) E.streak.forEach((s, i) => tf(s, `translate3d(${(W + 40 - ((camPx * 1.4 + i * 97) % (W + 180))).toFixed(1)}px,0,0)`));
      }
      // Off-screen rival: an arrow on that edge with the distance.
      const d = Math.round(Math.abs(myM - rvM));
      const offL = rvX < 6, offR = rvX - rvW > W - 6;
      if (cache.get('offL') !== (offL && d)) (E.offL.classList.toggle('on', offL), offL && (E.offL.textContent = `◀ ${d} м`), cache.set('offL', offL && d));
      if (cache.get('offR') !== (offR && d)) (E.offR.classList.toggle('on', offR), offR && (E.offR.textContent = `${d} м ▶`), cache.set('offR', offR && d));
      // Dash: needle, shift zone glow, gear, the 402 m strip.
      tf(E.needle, `rotate(${DR_ANG(rpm).toFixed(1)}deg)`);
      const zone = rpm >= 0.94 ? 'red' : rpm >= 0.82 ? 'perf' : rpm >= 0.7 ? 'good' : '';
      if (cache.get('zone') !== zone) (E.tacho.dataset.z = zone, cache.set('zone', zone));
      const g = String(gear);
      if (cache.get('gear') !== g && tau > 0) (E.gear.textContent = g, cache.set('gear', g));
      tf(E.mapMe, `translate3d(${(Math.min(1, myM / 402) * mapW).toFixed(1)}px,0,0)`);
      tf(E.mapRv, `translate3d(${(Math.min(1, rvM / 402) * mapW).toFixed(1)}px,0,0)`);
    },
  };
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
  state.resultFx = { win: !!s.win };
  await refresh();
}
// Race result as a timing sheet: the verdict under a light in green/red, the money as a readout, then both runs
// with a bar each (the faster run is full length) and the gear changes as chips.
function raceSheetHtml({ tag = '', win, diff, amount, note, rows, start, shifts }) {
  const t = (x) => x.toFixed(3).replace('.', ',');
  const best = Math.min(...rows.map((r) => r.time));
  return `<div class="rhero ${win ? 'win' : 'lose'}">${tag ? `<div class="rhero-tag">${tag}</div>` : ''}<div class="rhero-t">${win ? 'Перемога!' : 'Поразка'}</div>
      <div class="rhero-sub">${win ? 'швидше' : 'повільніше'} на <b>${t(diff)} с</b></div>
      <div class="rhero-amt">${amount}</div><div class="tiny muted">${note}</div></div>
    <div class="list rsheet">${rows.map((r) => `<div class="li ${r.won ? 'won' : ''}">${miniCar(r.model, '', r.look)}<div class="grow"><div class="row between"><b class="ellipsis">${esc(r.who)}${r.won ? ` ${ic('trophy', 'win')}` : ''}</b><b class="rtime">${t(r.time)} с</b></div>
      <div class="small muted ellipsis">${esc(M(r.model).name)}${r.sub ? ` · ${r.sub}` : ''}</div><div class="rbar"><i style="width:${Math.max(8, (best / r.time) * 100)}%"></i></div></div></div>`).join('')}</div>
    <div class="card rshifts"><div class="row between small"><span class="muted">${start}</span><span class="muted">передачі</span></div><div class="row wrap mt" style="gap:6px">${shifts.map((q, i) => `<span class="qchip q-${q}">${i + 1}→${i + 2}: ${QLABEL[q]}</span>`).join('')}</div></div>`;
}
function liveResult() {
  const R = state.race, s = R.result, my = s.me.run, rv = s.rival.run;
  const startTxt = (x) => (x.jump ? 'фальстарт' : x.perfectStart ? 'ідеальний старт' : `реакція ${dec(x.reaction, 3)} с`);
  return raceSheetHtml({ tag: 'PvP наживо', win: s.win, diff: Math.abs(my.time - rv.time), amount: s.win ? '+' + S.fmt(s.prize) : '−' + S.fmt(s.bet),
    note: s.win ? `банк мінус ${S.FEE * 100}% комісії` : 'ставка пішла суперникові',
    rows: [{ who: 'Ти', model: s.me.car.model, look: s.me.car.look, time: my.time, won: s.win, sub: startTxt(my) }, { who: s.rival.name, model: s.rival.car.model, look: s.rival.car.look, time: rv.time, won: !s.win, sub: startTxt(rv) }],
    start: 'Твої перемикання', shifts: my.shifts })
    + '<button class="btn outline" data-act="pvpExit">До PvP</button>';
}
H.pvpExit = () => {
  state.race = null;
  state.raceView = 'pvp';
  render();
};
function raceResult() {
  if (state.race.live) return liveResult();
  if (state.race.rival.boss) return bossResult();
  if (state.race.rival.ghost) return ghostResult();
  // Solo result: the verdict and the money, a photo finish (the loser behind by the real gap at the line), both
  // times, then what decided it — the start, every shift with what it cost — and one tip.
  const R = state.race, r = R.result, car = R.car;
  const reaction = r.jump ? -1 : r.reaction;
  const st = drStart(reaction, R.jumpBy || 0);
  const lost = r.shifts.reduce((a, q) => a + drLoss(q, car), 0);
  const v = (402 * 1.6) / S.dragDrive(car, reaction, r.shifts).drive; // m per race second at the line
  const gapM = r.diff * v;
  const n = (q) => r.shifts.filter((x) => x === q).length;
  const tip = r.jump ? 'Три жовті — ще ні. Чекай зеленого і тільки тоді тисни «Газ».'
    : n('late') >= 2 ? 'Перемикай, щойно стрілка в зеленій зоні, — не чекай червоної відсічки.'
    : n('early') ? 'Не поспішай із передачею: дочекайся, поки стрілка зайде в зелену зону.'
    : reaction >= 0.3 ? 'Тисни «Газ», щойно спалахне зелений: кожна десята секунди реакції — це час на фініші.'
    : !r.win ? 'Ти проїхав чисто — суперник просто швидший. Деталі з Майстерні додають потужності.' : '';
  const px = Math.min(120, gapM * 6);
  const amount = r.win ? '+' + S.fmt(r.prize) : r.entry ? '−' + S.fmt(r.entry) : 'Тренування';
  const note = r.win ? (r.entry ? `приз · внесок ${S.short(r.entry)} повернувся` : 'приз') : r.entry ? 'внесок згорів' : 'без внеску — нічого не втрачено';
  const shiftsTxt = lost > 0.0005 ? `втрачено ${dec(lost, 2)} с` : lost < -0.0005 ? `виграно ${dec(-lost, 2)} с` : 'без втрат';
  return `<div class="rhero ${r.win ? 'win' : 'lose'}"><div class="rhero-t">${r.win ? 'Перемога!' : 'Поразка'}</div>
      <div class="rhero-sub">${r.win ? 'швидше' : 'повільніше'} на <b>${dec(r.diff, 3)} с</b> · ${gapM >= 0.5 ? `≈ ${Math.round(gapM)} м` : 'ніс у ніс'}</div>
      <div class="rhero-amt">${amount}</div><div class="tiny muted">${note}</div></div>
    <div class="dr-photo" aria-hidden="true"><span class="dr-photo-t">Фотофініш · 402 м</span><i class="dr-photo-line"></i>
      <div class="dr-pcar rv" style="transform:translateX(${r.win ? -px : 0}px)">${carArt(R.rival.model, { look: R.rival.look })}</div>
      <div class="dr-pcar me" style="transform:translateX(${r.win ? 0 : -px}px)">${carArt(car.model, { look: car.look })}</div></div>
    <div class="dr-times">
      <div class="${r.win ? 'won' : ''}"><small>Ти</small><b>${dec(r.time, 3)} с</b><span class="ellipsis">${esc(M(car.model).name)}</span></div>
      <div class="${r.win ? '' : 'won'}"><small class="ellipsis">${esc(R.rival.name)}</small><b>${dec(r.rivalTime, 3)} с</b><span class="ellipsis">${esc(M(R.rival.model).name)}</span></div></div>
    ${challengeCta(R)}
    <div class="card dr-sum">
      <div class="dr-row"><span class="dr-dot q-${st.q}"></span><div class="grow"><b>${st.t}</b><div class="small muted">${st.s}</div></div></div>
      <div class="dr-row"><span class="dr-dot q-${lost > 0.0005 ? 'late' : lost < -0.0005 ? 'perfect' : 'good'}"></span><div class="grow"><b>Передачі: ${shiftsTxt}</b>
        <div class="dr-chips">${r.shifts.map((q, i) => `<span class="qchip q-${q}">${i + 1}→${i + 2} ${QLABEL[q]}</span>`).join('')}</div></div></div>
      ${tip ? `<div class="dr-tip">${ic('info-circle')}<span>${tip}</span></div>` : ''}</div>
    <div class="dr-btns"><button class="btn yellow btn2" data-act="raceRetry" data-rival="${esc(R.rival.id)}" ${me.fuel < 1 ? 'disabled' : ''}><span>${ic('refresh')} Ще раз</span><small>${R.rival.label ? `${esc(R.rival.label)} · ` : ''}${ic('gas-station')}${me.fuel}/${S.FUEL_MAX}</small></button>
      <button class="btn outline" data-act="raceExit">Інший суперник</button></div>`; // no line under the buttons: the raised «Кейси» covered it
}
// ---------- drift («Дрифт 2.0») ----------
const DRIFT_RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DKIND = { fast: 'Швидкий', mid: 'Середній', hair: 'Шпилька' };
const DGRADE = { perfect: ['Ідеально!', '#facc15'], clean: ['Чисто!', '#4ade80'], weak: ['Слабкий занос', '#fbbf24'], spin: ['Розворот!', '#f87171'], wide: ['Знесло!', '#fb923c'] };
const dArrow = (dir) => (dir > 0 ? '↱' : '↰');
const dMult = (m) => '×' + String(m).replace('.', ',');
const dPts = (n) => S.fmt(Math.floor(n)).replace(' ₴', '');
// The track's centre line sampled every `step` px at `px` px per metre: x, y, heading (0 = up, clockwise), the
// corner direction (0 on straights); start[i] / cnt[i] — the samples of segment i.
function driftGeom(segs, px, step) {
  const xs = [], ys = [], hs = [], kd = [], start = [], cnt = [];
  let x = 0, y = 0, h = 0;
  for (const g of segs) {
    const n = Math.max(1, Math.round((g.len * px) / step)), corner = g.kind !== 'straight';
    const dh = corner ? (g.dir * g.deg * Math.PI) / 180 / n : 0;
    start.push(xs.length);
    cnt.push(n);
    for (let i = 0; i < n; i++) {
      xs.push(x); ys.push(y); hs.push(h); kd.push(corner ? g.dir : 0);
      h += dh;
      x += Math.sin(h) * step;
      y -= Math.cos(h) * step;
    }
  }
  xs.push(x); ys.push(y); hs.push(h); kd.push(0);
  return { xs, ys, hs, kd, start, cnt };
}
// A small map of the day's track: the road, corners in their kind's colour with numbers, start and finish.
function driftMap(track) {
  const G = driftGeom(track.segs, 1, 2), W = 320, Hh = 120, pad = 14;
  // A track taller than wide is drawn turned a quarter, to fill the wide card.
  if (Math.max(...G.ys) - Math.min(...G.ys) > Math.max(...G.xs) - Math.min(...G.xs)) {
    [G.xs, G.ys] = [G.ys.map((v) => -v), G.xs];
    G.hs = G.hs.map((h) => h + Math.PI / 2);
  }
  const x0 = Math.min(...G.xs), x1 = Math.max(...G.xs), y0 = Math.min(...G.ys), y1 = Math.max(...G.ys);
  const k = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (Hh - pad * 2) / Math.max(1, y1 - y0));
  const ox = (W - (x1 - x0) * k) / 2, oy = (Hh - (y1 - y0) * k) / 2;
  const P = (i) => `${(ox + (G.xs[i] - x0) * k).toFixed(1)},${(oy + (G.ys[i] - y0) * k).toFixed(1)}`;
  const line = (a, b) => Array.from({ length: b - a + 1 }, (_, j) => P(a + j)).join(' ');
  const last = G.xs.length - 1;
  let out = `<polyline class="dm-road" points="${line(0, last)}"/>`;
  track.segs.forEach((g, i) => {
    if (g.kind === 'straight') return;
    const a = G.start[i], b = a + G.cnt[i], m = a + (G.cnt[i] >> 1);
    const [mx, my] = P(m).split(',').map(Number);
    const out2 = [Math.cos(G.hs[m]) * -g.dir * 11, Math.sin(G.hs[m]) * -g.dir * 11];
    out += `<polyline class="dm-c ${g.kind}" points="${line(a, b)}"/><text x="${(mx + out2[0]).toFixed(1)}" y="${(my + out2[1] + 3.5).toFixed(1)}">${g.corner + 1}</text>`;
  });
  const [sx, sy] = P(0).split(','), [fx, fy] = P(last).split(',');
  return `<svg class="dmap" viewBox="0 0 ${W} ${Hh}" aria-hidden="true">${out}<circle class="dm-s" cx="${sx}" cy="${sy}" r="4"/><rect class="dm-f" x="${fx - 4}" y="${fy - 4}" width="8" height="8" rx="1"/></svg>`;
}
// 1–5 dots for a drift stat (S.driftDots).
const dDots = (n) => `<span class="ddot5" aria-label="${n} з 5">${'●'.repeat(n)}<i>${'●'.repeat(5 - n)}</i></span>`;
async function driftView(car, garage) {
  const { list, train, model, track: tseed } = await api('drift/rivals', { carId: car.id });
  const track = S.driftTrack(tseed), corners = track.segs.filter((g) => g.kind !== 'straight');
  const dots = S.driftDots(model);
  return `<div class="h2"><span>Твоя машина</span><span>${garage.length}</span></div>
    <div class="carpick">${garage.map((c) => carTile(c, { act: 'pickRaceCar', sel: c.id === car.id, showTank: true })).join('')}</div>
    ${me.fuel < 1 ? fuelOut() : ''}<div class="card mt"><div class="row between"><b class="disp" style="font-size:16px">${ic('gas-station')} Пальне ${me.fuel}/${S.FUEL_MAX}</b><span class="small muted">${me.fuelNext ? `+1 через <span data-until="${me.fuelNext - clockOffset}"></span>` : 'бак повний'}</span></div>
      <div class="dfeel mt"><div class="row between"><span>Тримається в повороті</span>${dDots(dots.hold)}</div><div class="row between"><span>Швидкість</span>${dDots(dots.speed)}</div></div>
      <div class="tiny muted mt">Підвіска й диски — машина краще тримається в повороті. Потужність — більше швидкості, але занос різкіший.</div></div>
    ${train ? `<div class="card mt dtrain"><div class="row between"><b class="disp" style="font-size:16px">${ic('target-arrow')} Тренування</b><span class="chip ready">безкоштовно</span></div>
      <div class="small muted mt">Без внеску, без пального й без призу. Над кожним поворотом — підказка: кут і швидкість, а знизу — що робити з газом зараз. Ціль — ${S.fmt(train.target).replace(' ₴', '')} очок, як у Легкого.</div>
      <button class="btn mt" data-act="startDrift" data-rival="train">${ic('player-play')} Тренуватися</button></div>` : ''}
    <div class="card mt dtcard"><div class="row between"><b class="disp" style="font-size:15px">Траса дня</b><span class="small muted">${track.length} м · ${corners.length} поворотів</span></div>
      ${driftMap(track)}
      <div class="dlegend">${corners.map((g) => `<span class="dk ${g.kind}"><b>${g.corner + 1}</b> ${dArrow(g.dir)} ${DKIND[g.kind]} · ${g.center}°</span>`).join('')}</div></div>
    <div class="h2"><span>Суперники в дрифті</span><span>${S.DRIFT.corners} поворотів</span></div>
    <div class="list rivals">${list.map((r) => `<button class="rival d-${r.id}" data-act="startDrift" data-rival="${r.id}">
      ${miniCar(r.model)}
      <div class="grow"><b class="ellipsis">${esc(r.name)}</b><div class="small muted ellipsis">${esc(M(r.model).name)}</div>
        <div class="row mt" style="gap:6px"><span class="diff ${r.id}">${r.label}</span><span class="chip">ціль ${S.fmt(r.target).replace(' ₴', '')} очок</span></div></div>
      <div class="center"><b class="win">+${S.short(r.prize)}</b><div class="tiny muted">${r.entry ? `внесок ${S.short(r.entry)}` : 'без внеску'}</div></div></button>`).join('')}</div>
    <div class="card dhow"><b>Як їздити</b>
      <p>Одна кнопка — «ГАЗ». <b>На прямій</b> тримай — розганяєшся, відпусти — гальмуєш. <b>У повороті</b> тримай — заносить сильніше, відпусти — вирівнюєшся.</p>
      <p>Тримай стрілку в зеленій зоні повороту — у кожного свій кут: швидкий 28°, середній 36°, шпилька 44°. Очки капають за кожен метр у зоні: ×1,5 у самому центрі, більше на швидкості, менше, коли машину виносить з траєкторії.</p>
      <p>Залетиш у поворот надто швидко або з малим кутом — <b>«Знесло!»</b>. Перебереш кут — <b>«Розворот!»</b> і половина очок повороту згорає. Чисті повороти поспіль множать очки: комбо ×1,5 → ×2 → … ×3.</p></div>`;
}
H.startDrift = async (d) => {
  if (fuelNow() < 1) return fuelNudge();
  let r;
  try {
    r = await api('drift/start', { carId: state.raceCar, rival: d.rival });
  } catch (e) {
    return toast(e.message, true);
  }
  const training = r.rival?.id === 'train';
  if (!training) me.fuel--;
  renderHeader();
  state.drift = { phase: 'count', ...r, training, trackObj: S.driftTrack(r.track), result: null };
  await render();
  runDrift();
};
function driftScreen() {
  const D = state.drift;
  if (D.phase === 'done') return driftResult();
  const pct = (a) => `${(a / 90) * 100}%`;
  const corners = D.trackObj.segs.filter((g) => g.kind !== 'straight');
  return `<div class="drift d2">
    <div class="dhud"><div><small>ОЧКИ</small><b id="dScore">0</b><em id="dPend"></em></div><div class="center"><small>КОМБО</small><b id="dCombo">×1</b></div><div style="text-align:right"><small>${esc(D.rival.name)}</small><b>${dPts(D.rival.target)}</b></div></div>
    <div class="progress gold"><i id="dBar"></i></div>
    <div class="ddots" id="dDots">${corners.map((g) => `<i class="k-${g.kind}" title="${DKIND[g.kind]}">${dArrow(g.dir)}</i>`).join('')}</div>
    <div class="dtrack" id="dTrack"><canvas id="dCanvas"></canvas>
      <div class="dsign" id="dSign">ГОТУЙСЯ</div><div class="dmsg" id="dMsg"><b></b><small></small></div><div class="dspd" id="dSpd"></div></div>
    <div class="dgauge"><span class="dz" id="dZone"></span><span class="di" id="dIdeal"></span><span class="dr" style="left:${pct(D.model.spin)}"></span><i id="dNeedle"></i></div>
    <div class="row between tiny muted mt"><span>0°</span><span id="dAngle">кут 0°</span><span>90°</span></div>
    <div class="center mt ${D.training ? 'dtip' : 'small muted'}" id="dHint">Тримай «ГАЗ», щоб розігнатись</div>
    <button class="btn racebtn gas mt" id="dGas">ГАЗ</button></div>`;
}
// Top-down drift scene on a canvas: the day's track (corners with red-white kerbs, start and finish lines) on a
// grass pattern, the car sliding at the drift angle and pushed across the road by the line, black tyre marks and
// smoke puffs (a pre-rendered sprite, no per-frame gradients); the camera follows and turns with the road.
function driftScene(canvas, color, track, tips = false) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const PX = 5, STEP = 4, HALF = 42; // px per metre, px between samples, half the road width
  const segs = [...track.segs, { kind: 'straight', len: 140, from: track.length, to: track.length + 140 }];
  const G = driftGeom(segs, PX, STEP), { xs, ys, hs, kd } = G, last = xs.length - 1;
  const finishAt = G.start[segs.length - 1];
  // Fractional sample index of a point `pos` metres along the track, in segment `seg`.
  const idx = (seg, pos) => {
    const g = segs[Math.min(seg, segs.length - 1)];
    return Math.min(last - 1, G.start[seg] + Math.max(0, Math.min(0.9999, (pos - g.from) / g.len)) * G.cnt[seg]);
  };
  const lerp = (a, i, f) => a[i] + (a[i + 1] - a[i]) * f;
  // Sprites made once: a smoke puff and a grass tile.
  const puff = document.createElement('canvas');
  puff.width = puff.height = 64;
  const pg = puff.getContext('2d'), gr = pg.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(236,237,241,.85)');
  gr.addColorStop(1, 'rgba(236,237,241,0)');
  pg.fillStyle = gr;
  pg.fillRect(0, 0, 64, 64);
  const tile = document.createElement('canvas');
  tile.width = tile.height = 48;
  const tg2 = tile.getContext('2d');
  tg2.fillStyle = '#17241b';
  tg2.fillRect(0, 0, 48, 48);
  for (let i = 0; i < 26; i++) {
    tg2.fillStyle = i % 2 ? '#1c2c20' : '#132017';
    tg2.fillRect((i * 37) % 48, (i * 23 + (i >> 2) * 7) % 48, 2, 2);
  }
  const grass = ctx.createPattern(tile, 'repeat');
  const MAXM = 520, MAXP = DRIFT_RM ? 24 : 80;
  const marks = [], smoke = [];
  let camH = 0, lastRear = null, lastPuff = 0, shake = 0;
  function road(from, to, width, style, dash = null, onlyCorners = false) {
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.setLineDash(dash || []);
    ctx.lineCap = onlyCorners ? 'butt' : 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let open = false;
    for (let i = from; i <= to; i++) {
      if (onlyCorners && !kd[i]) { open = false; continue; }
      if (!open) { ctx.moveTo(xs[i], ys[i]); open = true; } else ctx.lineTo(xs[i], ys[i]);
    }
    ctx.stroke();
  }
  // A chequered band across the road at sample i.
  function checker(i) {
    ctx.save();
    ctx.translate(xs[i], ys[i]);
    ctx.rotate(hs[i]);
    const n = 8, w = (HALF * 2) / n;
    for (let r = 0; r < 2; r++) for (let c = 0; c < n; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#f4f4f5' : '#111';
      ctx.fillRect(-HALF + c * w, -r * 5, w, 5);
    }
    ctx.restore();
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
    // seg/pos: where the car is (segment, metres); lat: the line (−1 inside … 1 outside edge of the corner `dir`);
    // angle: drift angle in degrees; spin: 0..1 progress of a spin-out.
    draw(seg, pos, lat, angle, spin, dt, now, dir) {
      const k = idx(seg, pos), i = Math.floor(k), fr = k - i;
      const heading = lerp(hs, i, fr), off = lat * (HALF - 13);
      const cx = lerp(xs, i, fr) - dir * Math.cos(heading) * off, cy = lerp(ys, i, fr) - dir * Math.sin(heading) * off;
      const body = heading + dir * (angle * Math.PI) / 180 + spin * Math.PI * 2;
      camH += (heading - camH) * Math.min(1, dt * 3.5);
      // Tyre marks and smoke while the car is sideways.
      const f0 = Math.sin(body), f1 = -Math.cos(body), r0 = Math.cos(body), r1 = Math.sin(body);
      const rear = [cx - f0 * 13 - r0 * 8, cy - f1 * 13 - r1 * 8, cx - f0 * 13 + r0 * 8, cy - f1 * 13 + r1 * 8];
      if ((angle > 10 || spin > 0) && lastRear) {
        marks.push(lastRear[0], lastRear[1], rear[0], rear[1], lastRear[2], lastRear[3], rear[2], rear[3]);
        if (marks.length > MAXM * 8) marks.splice(0, 8);
        if (now - lastPuff > (DRIFT_RM ? 140 : 50)) {
          lastPuff = now;
          const a = Math.min(0.6, (spin ? 60 : angle) / 70);
          smoke.push({ x: rear[0], y: rear[1], r: 6, a, vx: (Math.random() - 0.5) * 24, vy: (Math.random() - 0.5) * 24 }, { x: rear[2], y: rear[3], r: 6, a, vx: (Math.random() - 0.5) * 24, vy: (Math.random() - 0.5) * 24 });
          if (smoke.length > MAXP) smoke.splice(0, smoke.length - MAXP);
        }
      }
      lastRear = rear;
      for (const p of smoke) { p.r += dt * 30; p.a -= dt * 0.6; p.x += p.vx * dt; p.y += p.vy * dt; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      if (shake > 0) {
        ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake);
        shake = Math.max(0, shake - dt);
      }
      ctx.translate(W / 2, H * 0.66);
      ctx.rotate(-camH);
      ctx.translate(-cx, -cy);
      ctx.fillStyle = grass;
      ctx.fillRect(cx - 700, cy - 700, 1400, 1400);
      const from = Math.max(0, i - 80), to = Math.min(last, i + 170);
      road(from, to, HALF * 2 + 20, '#e5e7eb', null, true); // kerbs on corners: white…
      road(from, to, HALF * 2 + 20, '#dc2626', [10, 10], true); // …and red
      road(from, to, HALF * 2 + 6, '#f4f4f5');
      road(from, to, HALF * 2, '#34373e');
      road(from, to, 2, '#ffffff66', [14, 14]);
      ctx.setLineDash([]);
      if (from <= 2) checker(1);
      if (finishAt >= from && finishAt <= to) checker(finishAt);
      // Training: a sign on the road at every corner ahead (not the one being driven) — direction, angle, entry speed.
      if (tips) {
        for (let s = 0; s < segs.length; s++) {
          const g = segs[s], at = G.start[s];
          if (g.kind === 'straight' || g.corner == null || s <= seg || at < from || at > Math.min(to, i + 110)) continue;
          const txt = `${g.dir > 0 ? '↱' : '↰'} ${g.center}° · до ${Math.round(g.vref * 3.6)} км/год`;
          ctx.save();
          ctx.translate(xs[at], ys[at]);
          // Only where it is fully on screen, clear of the corner name at the top.
          const tm = ctx.getTransform(), sx = tm.e / dpr, sy = tm.f / dpr;
          if (sx < 70 || sx > W - 70 || sy < 52 || sy > H - 16) {
            ctx.restore();
            continue;
          }
          ctx.rotate(camH);
          ctx.font = '800 14px system-ui, sans-serif';
          const w = ctx.measureText(txt).width + 16;
          ctx.fillStyle = '#0b0f16d9';
          ctx.beginPath(); ctx.roundRect(-w / 2, -12, w, 24, 8); ctx.fill();
          ctx.fillStyle = { fast: '#38bdf8', mid: '#facc15', hair: '#f87171' }[g.kind] || '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, 0, 0);
          ctx.restore();
        }
      }
      // All tyre marks in one path.
      ctx.strokeStyle = 'rgba(8,8,10,.42)';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let m = 0; m < marks.length; m += 4) { ctx.moveTo(marks[m], marks[m + 1]); ctx.lineTo(marks[m + 2], marks[m + 3]); }
      ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      car(body);
      ctx.restore();
      for (const p of smoke) {
        if (p.a <= 0) continue;
        ctx.globalAlpha = p.a;
        ctx.drawImage(puff, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
    bump(v = 0.4) {
      if (!DRIFT_RM) shake = v;
    },
  };
}
function runDrift() {
  const D = state.drift, M2 = D.model, track = D.trackObj, segs = track.segs, N = S.DRIFT.corners;
  const el = (id) => document.getElementById(id);
  const btn = el('dGas');
  let hold = false, last = 0, t0 = 0, raf = 0, dir = segs[1].dir;
  // The physics is the shared fixed-step simulation seeded by the server, which replays the gas log at the finish.
  const sim = S.driftSim(M2, track, D.seed);
  // The car on the track wears the player's paint (the class colour only for a factory car).
  const look = D.car.look || me.cars.find((c) => c.id === D.car.id)?.look;
  const scene = driftScene(el('dCanvas'), S.PAINT_BY_ID[look?.paint]?.hex || S.CLASSES[M(D.car.model).cls].color, track, !!D.training);
  const dots = [...el('dDots').children];
  // Text and style writes only when the value changes (cheap frames on slow phones).
  const shown = {};
  const put = (id, v, prop = 'textContent') => {
    const key = id + prop;
    if (shown[key] === v) return;
    shown[key] = v;
    const e = el(id);
    if (!e) return;
    if (prop === 'textContent') e.textContent = v;
    else e.style[prop] = v;
  };
  const pct = (a) => `${(Math.max(0, Math.min(90, a)) / 90) * 100}%`;
  const gauge = (g) => {
    if (!g || g.kind === 'straight') return;
    put('dZone', pct(g.center - M2.half), 'left');
    put('dZone', pct(2 * M2.half), 'width');
    put('dIdeal', pct(g.center - M2.half / 3), 'left');
    put('dIdeal', pct((2 * M2.half) / 3), 'width');
  };
  gauge(segs[1]);
  put('dSign', `ДАЛІ ${dArrow(segs[1].dir)} ${DKIND[segs[1].kind].toUpperCase()} · ${segs[1].center}°`);
  // While the lights count down the car waits on the start line.
  let idle = performance.now();
  const wait = (now) => {
    if (state.drift !== D || D.phase !== 'count') return;
    scene.draw(0, 0, 0, 0, 0, Math.min(0.05, (now - idle) / 1000), now, dir);
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
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // On a computer the space bar is the gas too.
  const key = (v) => (e) => {
    if (e.code !== 'Space' || state.drift !== D) return;
    e.preventDefault();
    hold = v;
    btn.classList.toggle('on', v);
  };
  const kd = key(true), ku = key(false);
  addEventListener('keydown', kd);
  addEventListener('keyup', ku);
  const msg = (text, color, sub = '') => {
    const m = el('dMsg');
    if (!m) return;
    m.firstChild.textContent = text;
    m.lastChild.textContent = sub;
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
  // Feedback for what happened in the steps just simulated.
  function events() {
    for (const e of sim.events.splice(0)) {
      if (e.k === 'corner') {
        const g = segs[sim.seg];
        put('dSign', `${dArrow(g.dir)} ${DKIND[g.kind].toUpperCase()} ${e.i + 1}/${N}`);
        gauge(g);
        dots[e.i]?.classList.add('now');
      } else if (e.k === 'straight') {
        const g = segs[sim.seg + 1];
        put('dSign', g ? `ДАЛІ ${dArrow(g.dir)} ${DKIND[g.kind].toUpperCase()} · ${g.center}°` : 'ФІНІШ!');
        gauge(g);
      } else if (e.k === 'zone') haptic('light');
      else if (e.k === 'spin') (msg('Розворот!', DGRADE.spin[1], 'комбо згоріло'), haptic('error'), scene.bump(0.5));
      else if (e.k === 'wide') (msg('Знесло!', DGRADE.wide[1], 'замало кута на такій швидкості'), haptic('warning'), scene.bump(0.25));
      else if (e.k === 'end') {
        const [t, c] = DGRADE[e.grade];
        msg(t, c, `+${dPts(e.pts)}${e.mult > 1 ? ` · Комбо ${dMult(e.mult)}` : ''}`);
        if (e.grade === 'perfect' || e.grade === 'clean') haptic(e.grade === 'perfect' ? 'success' : 'medium');
        const d = dots[e.i];
        if (d) d.className = `k-${e.kind} g-${e.grade}`;
        if (e.mult > 1) {
          const cb = el('dCombo');
          cb?.classList.remove('pop');
          void cb?.offsetWidth;
          cb?.classList.add('pop');
        }
      }
    }
  }
  function frame(now) {
    if (state.drift !== D) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    sim.input(hold);
    sim.advance(now - t0);
    events();
    if (sim.done) return finish();
    const g = segs[sim.seg], ang = sim.ang, t = sim.t;
    if (g.kind !== 'straight') dir = g.dir;
    // A spin-out turns the car a full circle.
    scene.draw(sim.seg, sim.pos, sim.y, ang, t < sim.spinUntil ? 1 - (sim.spinUntil - t) / 700 : 0, dt, now, dir);
    el('dNeedle').style.left = pct(ang);
    put('dAngle', `кут ${Math.round(ang)}°`);
    put('dSpd', `${Math.round(sim.v * 3.6)} км/год`);
    const pend = sim.cur ? Math.floor(sim.cur.base) : 0;
    put('dScore', dPts(sim.score));
    put('dPend', pend ? `+${pend}` : '');
    put('dCombo', dMult(sim.combo));
    put('dBar', Math.min(100, ((sim.score + pend) / D.rival.target) * 100).toFixed(1) + '%', 'width');
    let hint;
    if (g.kind === 'straight') {
      const nx = segs[sim.seg + 1];
      hint = !nx ? 'Фініш — тисни газ!' : sim.v > nx.vref * 1.15 ? `Відпусти — гальмуй перед поворотом (${DKIND[nx.kind].toLowerCase()})` : sim.v < nx.vref * 0.85 ? 'Тримай газ — розганяйся' : 'Швидкість якраз — заходь у поворот';
    } else if (t < sim.spinUntil) hint = 'Розворот…';
    else if (ang > g.center + M2.half) hint = 'Відпусти — зараз розверне!';
    else if (sim.y > 0.55) hint = 'Виносить! Додай кута';
    else if (sim.y < -0.75) hint = 'Притискає всередину — трохи менше кута';
    else if (ang < g.center - M2.half) hint = 'Більше газу — заносу мало';
    else hint = 'Тримай занос!';
    if (!D.training) put('dHint', hint);
    else {
      // The same advice, big over the track, with the numbers to aim at.
      let tip = hint, tone = 'ok';
      if (g.kind === 'straight') {
        const nx = segs[sim.seg + 1];
        if (nx && sim.v > nx.vref * 1.15) (tip = `ВІДПУСТИ ГАЗ — гальмуй до ${Math.round(nx.vref * 3.6)} км/год`, tone = 'stop');
        else if (nx && sim.v < nx.vref * 0.85) (tip = 'ТРИМАЙ ГАЗ — розганяйся', tone = 'go');
        else if (nx) tip = `Заходь у поворот: тримай газ, кут ${nx.center}°`;
      } else if (t >= sim.spinUntil) {
        if (ang > g.center + M2.half) (tip = 'ВІДПУСТИ — забагато кута!', tone = 'stop');
        else if (ang < g.center - M2.half) (tip = `ТИСНИ ГАЗ — більше кута (до ${g.center}°)`, tone = 'go');
        else tip = 'Так тримай — стрілка в зеленій зоні';
      }
      put('dHint', tip);
      put('dHint', tone === 'stop' ? '#f87171' : tone === 'go' ? '#4ade80' : '#facc15', 'color');
    }
    raf = requestAnimationFrame(frame);
  }
  async function finish() {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', kd);
    removeEventListener('keyup', ku);
    D.phase = 'wait';
    D.local = sim.corners;
    put('dSign', 'ФІНІШ!');
    try {
      D.result = await api('drift/finish', { runId: D.runId, score: sim.score, clean: sim.clean, spins: sim.spins, log: sim.log });
    } catch (e) {
      toast(e.message, true);
      state.drift = null;
      return render();
    }
    D.phase = 'done';
    haptic(D.result.win ? 'success' : 'error');
    if (D.result.win) FX.flash('#4ade80', 0.25, 500);
    state.resultFx = { win: !!D.result.win };
    await refresh();
  }
}
// The final score breakdown: per corner its grade, time in the zone / ideal band / on the line, speed, and points
// (base × combo), from the server's replay of the run.
function driftResult() {
  const D = state.drift, r = D.result, cs = r.corners || D.local || [];
  const best = Math.max(1, ...cs.map((c) => c.pts));
  const head = r.training
    ? `<div class="center mt2"><div class="tiny muted">Дрифт · тренування</div><div class="big ${r.win ? 'win' : ''}">${r.win ? 'Ціль виконано!' : 'Ще трохи'}</div>
    <div class="dfinal mt">${dPts(r.score)} <span class="muted small">очок</span></div>
    <div class="muted">ціль тренування: ${dPts(r.target)} · без призу й внеску</div>
    <div class="small muted mt">${r.win ? 'Так проходиш Легкого суперника — спробуй на гроші.' : 'Дивись, де повороти не чисті, і тримай стрілку в зеленій зоні.'}</div></div>`
    : `<div class="center mt2"><div class="tiny muted">Дрифт</div><div class="big ${r.win ? 'win' : 'lose'}">${r.win ? 'Перемога!' : 'Поразка'}</div>
    <div class="dfinal mt">${dPts(r.score)} <span class="muted small">очок</span></div>
    <div class="muted">ціль ${esc(r.rival.name)}: ${dPts(r.target)}</div>
    <div style="font-size:24px;font-weight:900" class="mt ${r.win ? 'win' : 'lose'}">${r.win ? '+' + S.fmt(r.prize) : '−' + S.fmt(r.entry)}</div></div>`;
  return `${head}
    <div class="dsum mt"><div><b>${r.clean}/${S.DRIFT.corners}</b><small>чистих</small></div><div><b>${dMult(r.maxCombo || 1)}</b><small>макс. комбо</small></div>
      <div><b>${r.spins}</b><small>розворотів</small></div><div><b>${r.wides ?? 0}</b><small>знесло</small></div></div>
    ${cs.length ? `<div class="h2"><span>Повороти</span><span>бали × комбо</span></div>
    <div class="dbreak">${cs.map((c) => `<div class="drow g-${c.grade}" style="--w:${Math.round((c.pts / best) * 100)}%">
      <span class="dn k-${c.kind}">${c.i + 1}</span>
      <div class="grow"><b>${dArrow(c.dir)} ${DKIND[c.kind]} <em>${DGRADE[c.grade][0]}</em></b>
        <div class="tiny muted">у зоні ${c.zone}% · центр ${c.ideal}% · лінія ${c.line}% · ${c.kmh} км/год</div></div>
      <div class="dp"><b>${dPts(c.pts)}</b><small>${c.base}${c.mult > 1 ? ' ' + dMult(c.mult) : ''}</small></div></div>`).join('')}</div>` : ''}
    ${r.training ? '<button class="btn yellow mt" data-act="driftTrainAgain">Ще тренування</button>'
      : `<button class="btn yellow mt" data-act="driftAgain" ${me.fuel < 1 ? 'disabled' : ''}>Ще дрифт · пальне ${me.fuel}/${S.FUEL_MAX}</button>`}
    <button class="btn outline mt" data-act="driftExit">До суперників</button>`;
}
H.driftTrainAgain = () => {
  state.drift = null;
  state.raceView = 'drift';
  H.startDrift({ rival: 'train' });
};
H.driftAgain = H.driftExit = () => {
  state.drift = null;
  state.raceView = 'drift';
  render();
};
H.raceAgain = H.raceExit = () => {
  state.race = null;
  render();
};

// ---------- career: country bosses (S.BOSSES) ----------
// «Гонки → Кар'єра»: the country strip (the map) with progress, the next boss as a big card, then every country's
// bosses (beaten / next / locked as a silhouette). A boss opens as a card (sheet); «Кинути виклик» runs the usual
// race screen with the boss as the rival (raceScreen / runRace are shared), and the result adds the one-time reward.
const BOSS = (id) => S.BOSS_BY_ID[id];
const bossStars = (b) => `<span class="bstars">${'★'.repeat(S.BOSS_AI[b.ai].stars)}<i>${'★'.repeat(Math.max(0, 4 - S.BOSS_AI[b.ai].stars))}</i></span>`;
// Class window: which of your cars a boss takes; none in the garage → a button for one that does, or a few models.
// "машина класу C–B" with the window kept on one line.
const bossNeedHtml = (b) => esc(S.bossNeedText(b)).replace(/([DCBASX])–([DCBASX])/, '<span class="nw">$1–$2</span>');
const bossGarageFits = (b) => me.cars.filter((c) => c.status === 'garage' && S.bossFits(b, c.model)).sort((x, y) => (y.tank > 0) - (x.tank > 0) || x.et - y.et);
function bossFitHint(b) {
  const c = bossGarageFits(b)[0];
  if (c) return `<button class="btn sm ghost bc-pick" data-act="bossPickCar" data-id="${c.id}" data-boss="${b.id}">${ic('car')} Взяти ${esc(M(c.model).name)}</button>`;
  return `<div class="tiny muted bc-hint">У гаражі такої немає. Підійде, наприклад: ${S.bossCarHint(b).map((id) => esc(M(id).name)).join(', ')}</div>`;
}
H.bossPickCar = async (d) => {
  state.raceCar = Number(d.id);
  prefSet('raceCar', state.raceCar);
  if (!$('#modal').hidden) closeModal();
  await render();
  if (d.boss && $('#modal').hidden) H.bossCard({ id: d.boss });
};
const bossKit = (b) => (b.kit ? `${S.TIER_BY_ID[b.kit].name}-кіт` : 'без тюнінгу');
const bossOf = (c) => S.BOSSES.filter((b) => b.country === c);
async function careerView(car, garage) {
  let data = await api('boss/list', { carId: car.id });
  // The next boss decides the default car: one with fuel and a class he takes (not the empty or too weak one).
  const nb = data.next && BOSS(data.next);
  if (nb && readyRaceCar(garage, (c) => S.bossFits(nb, c.model))) {
    car = garage.find((c) => c.id === state.raceCar);
    data = await api('boss/list', { carId: car.id });
  }
  state.career = data;
  const st = Object.fromEntries(data.list.map((x) => [x.id, x]));
  const next = data.next ? BOSS(data.next) : null;
  const here = next ? next.country : S.BOSS_COUNTRIES.at(-1);
  const map = S.BOSS_COUNTRIES.map((c) => {
    const bs = bossOf(c), n = bs.filter((b) => st[b.id].beaten).length;
    const cls = n === bs.length ? 'done' : bs.some((b) => st[b.id].open) ? 'cur' : 'lock';
    return `<button class="cm ${cls} ${c === here ? 'here' : ''}" data-act="careerJump" data-c="${c}" aria-label="${S.COUNTRIES[c].name}">${flagEmblem(c)}<small>${n === bs.length ? ic('check') : `${n}/${bs.length}`}</small></button>`;
  }).join('<i class="cm-line"></i>');
  const hero = `<div class="card career-hero"><div class="row between"><span class="hook-t">${ic('crown')} Боси країн</span><b class="ch-n">${data.beaten}<small>/${data.total}</small></b></div>
    <div class="cbar"><i style="width:${(data.beaten / data.total) * 100}%"></i></div>
    <div class="cmap">${map}</div>
    <div class="row between small mt">${data.badge ? badgeChip(data.badge) : '<span class="muted">Перемагай босів по черзі. Останній бос країни дає значок у профіль, ключі й номер.</span>'}</div></div>`;
  const nextCard = next ? bossFeature(next, st[next.id], car) : `<div class="card boss-next done center">${ic('crown', 'win')}<b class="mt">Кар'єру пройдено!</b><div class="small muted">Усі ${data.total} босів переможені. Реванші — як звичайні гонки, складні — ×${S.BOSS_HARD.prizeMult} раз на день.</div></div>`;
  return `${hero}
    ${nextCard}
    <div class="h2"><span>Твоя машина</span><span>${garage.length}</span></div>
    <div class="carpick">${garage.map((c) => carTile(c, { act: 'pickRaceCar', sel: c.id === car.id, showTank: true })).join('')}</div>
    ${fuelCard(car)}
    ${S.BOSS_COUNTRIES.map((c) => {
      const bs = bossOf(c);
      return `<div class="h2" id="cc-${c}"><span class="row" style="gap:8px">${flagEmblem(c)} ${S.COUNTRIES[c].name}</span><span>${bs.filter((b) => st[b.id].beaten).length}/${bs.length}</span></div>
      <div class="list rivals bosses">${bs.map((b) => bossRow(b, st[b.id])).join('')}</div>`;
    }).join('')}
    <div class="tiny muted">Бос їде завжди однаково — сильніша машина, деталі й чисті перемикання дають тобі шанс. Кожен бос пускає лише машини свого вікна класу (напр. «лише B» чи «C–B»), а фінальний бос країни — лише машину цієї країни, тож одна сильна машина всю кар'єру не пройде. Перша перемога над босом дає нагороду один раз і відкриває наступного; реванш — як звичайна гонка, а «Реванш · складний» (кращий кіт і сильніший водій) платить ×${S.BOSS_HARD.prizeMult} — одна перемога на день. Пальне — як у драг-заїзді.</div>`;
}
const bossChance = (s) => (s.chance == null ? '' : `<span class="chip">шанс ${s.chance < 1 ? '<1' : s.chance}%</span>`);
function bossFeature(b, s, car) {
  const color = S.CLASSES[M(b.model).cls].color;
  return `<div class="card boss-next" data-act="bossCard" data-id="${b.id}" style="--c:${color}">
    <div class="bn-tag">${flagEmblem(b.country)} Наступний бос${b.final ? ' · фінал країни' : ''}</div>
    <div class="bn-art">${carArt(b.model, { glow: true })}</div>
    <div class="bn-name"><b>${esc(b.nick)}</b><span class="small muted">${esc(M(b.model).name)} · ${b.hp} к.с. · ${bossKit(b)}</span></div>
    <div class="taunt">«${esc(b.taunt)}»</div>
    <div class="row between mt" style="gap:8px;flex-wrap:wrap"><span class="small ${s.fits ? 'muted' : 'lose'}">${s.fits ? `Клас <span class="nw">${S.bossWindowText(b)}</span>${b.own ? ` · ${S.BOSS_COUNTRY_ADJ[b.country]}` : ''} · бос їде ~${dec(b.et, 2)} с` : `Потрібна ${bossNeedHtml(b)}`}</span>${bossChance(s)}</div>
    ${s.fits ? '' : bossFitHint(b)}
    <div class="row between mt"><span class="small">Нагорода: <b class="win">${esc(S.bossRewardText(b.reward))}</b></span></div>
    <button class="btn yellow mt" data-act="startBoss" data-id="${b.id}" ${!s.fits || me.fuel < 1 ? 'disabled' : ''}>${ic('flag-3')} Кинути виклик</button></div>`;
}
function bossRow(b, s) {
  const prev = S.BOSSES[b.n - 1];
  const tag = s.beaten ? `<span class="diff easy">${ic('check')} Переможений</span>` : s.open ? '<span class="diff mid">Наступний</span>' : `<span class="diff lock">${ic('lock')} Після «${esc(prev.nick)}»</span>`;
  return `<button class="rival boss ${s.beaten ? 'beaten' : s.open ? 'open' : 'locked'}" data-act="bossCard" data-id="${b.id}">
    <div class="mini art lit r${S.rankOf(M(b.model).cls)}" style="--c:${S.CLASSES[M(b.model).cls].color}">${carArt(b.model, { silhouette: !s.open })}</div>
    <div class="grow"><b class="ellipsis">${esc(b.nick)}${b.final ? ` ${ic('crown', 'win')}` : ''}</b><div class="small muted rv-meta"><span class="ellipsis">${esc(M(b.model).name)}</span><span class="nw">· ${b.hp} к.с.</span></div>
      <div class="row mt" style="gap:6px">${tag}${s.open && !s.beaten ? bossChance(s) : ''}${s.beaten ? (s.hard?.done ? `<span class="chip">${ic('check')} складний сьогодні</span>` : '<span class="chip bs-hard">складний ×2</span>') : ''}</div></div>
    <div class="center">${s.beaten ? `<b class="muted">${s.best != null ? dec(s.best, 2) + ' с' : ''}</b><div class="tiny muted">реванш</div>` : `<b class="win">+${S.short(b.reward.money)}</b><div class="tiny muted">${b.final ? 'і значок' : 'нагорода'}</div>`}</div></button>`;
}
H.careerJump = (d) => $('#cc-' + d.c)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
H.bossCard = (d) => {
  const b = BOSS(d.id);
  if (!b) return;
  const s = state.career?.list.find((x) => x.id === b.id) || {};
  const car = me.cars.find((c) => c.id === state.raceCar);
  const m = M(b.model), rank = S.rankOf(m.cls), color = S.CLASSES[m.cls].color;
  const bs = bossOf(b.country), prev = S.BOSSES[b.n - 1];
  const row = (icon, title, sub, right = '') => `<div class="li"><span class="bc-ic">${ic(icon)}</span><div class="grow"><b>${title}</b><div class="small muted">${sub}</div></div>${right}</div>`;
  const btn = !s.open ? `${ic('lock')} Спершу переможи «${esc(prev.nick)}»` : !s.fits ? `Потрібна ${S.bossNeedText(b)}` : s.beaten ? `${ic('refresh')} Реванш` : `${ic('flag-3')} Кинути виклик`;
  const h = S.bossHard(b), hs = s.hard || {};
  sheet(esc(b.nick), `<div class="boss-card" style="--c:${color}">
    <div class="hero r${rank}" style="--c:${color}"><div class="art">${carArt(b.model, { glow: rank >= 2 && s.open, silhouette: !s.open })}</div></div>
    <div class="center"><div class="small muted row" style="justify-content:center;gap:6px">${flagEmblem(b.country)} ${S.COUNTRIES[b.country].name} · бос ${bs.indexOf(b) + 1} з ${bs.length}${b.final ? ' · фінал' : ''}</div>
      <div class="bc-car">${esc(m.name)}</div>
      <div class="small muted">${bossKit(b)} · ${b.hp} к.с. · ~${dec(b.et, 2)} с на 402 м</div>
      <div class="small mt">Водій: ${bossStars(b)} ${S.BOSS_AI[b.ai].name}</div></div>
    <div class="taunt big">«${esc(b.taunt)}»</div>
    <div class="list mt">
      ${row('car', 'Вимога', `${bossNeedHtml(b)}${b.own ? ' — фінал країни' : ''}${s.fits === false ? bossFitHint(b) : ''}`, s.fits == null ? '' : `<b class="${s.fits ? 'win' : 'lose'}">${s.fits ? ic('check') : '✕'}</b>`)}
      ${s.chance != null && car ? row('target-arrow', 'Твій шанс', `${esc(M(car.model).name)} · ${car.hp} к.с. · ${dec(car.et, 2)} с`, `<b>${s.chance < 1 ? '<1' : s.chance}%</b>`) : ''}
      ${row('trophy', s.beaten ? 'Нагороду отримано' : 'Нагорода за першу перемогу', esc(S.bossRewardText(b.reward)), s.beaten ? `<b class="win">${ic('check')}</b>` : '')}
      ${s.beaten ? row('refresh', 'Реванш', s.prize != null ? `як звичайна гонка: приз +${S.short(s.prize)}, внесок ${S.short(s.entry)}` : 'як звичайна гонка') : row('gas-station', 'Без внеску', 'програш коштує тільки пальне')}
      ${s.beaten ? row('flame', 'Реванш · складний', `${h.kit ? `${S.TIER_BY_ID[h.kit].name}-кіт` : 'без тюнінгу'} · ${h.hp} к.с. · водій ${S.BOSS_AI[h.ai].name} · ~${dec(h.et, 2)} с<br>${hs.done ? 'Сьогодні вже виграно — завтра знову' : `приз ×${S.BOSS_HARD.prizeMult}${hs.prize != null ? `: +${S.short(hs.prize)}, внесок ${S.short(hs.entry)}` : ''} · перемога раз на день`}`, hs.chance != null && !hs.done ? `<b>${hs.chance < 1 ? '<1' : hs.chance}%</b>` : '') : ''}
    </div>
    <button class="btn yellow mt" data-act="startBoss" data-id="${b.id}" ${!s.open || !s.fits || me.fuel < 1 ? 'disabled' : ''}>${btn}</button>
    ${s.beaten ? `<button class="btn outline mt bc-hard" data-act="startBoss" data-id="${b.id}" data-hard="1" ${hs.done || !s.fits || me.fuel < 1 ? 'disabled' : ''}>${ic('flame')} Реванш · складний ×${S.BOSS_HARD.prizeMult}</button>` : ''}</div>`);
};
H.startBoss = async (d) => {
  let r;
  try {
    r = await api('boss/start', { carId: state.raceCar, boss: d.id, hard: d.hard === '1' });
  } catch (e) {
    return toast(e.message, true);
  }
  if (!$('#modal').hidden) closeModal();
  me.fuel--;
  renderHeader();
  hideClaimBanners();
  state.race = { phase: 'lights', id: r.raceId, car: r.car, rival: r.rival, greenMs: r.greenMs, reaction: null, shifts: [], gear: 1, result: null };
  await render();
  runRace();
};
// The boss race result: the usual timing sheet, then the one-time reward (first win) or the boss's taunt (a loss).
function bossResult() {
  const R = state.race, r = R.result, b = BOSS(R.rival.boss), bo = r.boss || {}, rw = bo.reward;
  const startTxt = r.jump ? 'Фальстарт −8%' : r.perfectStart ? 'Ідеальний старт +4%' : r.reaction >= 1.5 ? 'Пізній старт' : `Реакція ${dec(r.reaction, 3)} с`;
  const amount = bo.first ? '+' + S.fmt(rw.money) : r.win ? (r.prize ? '+' + S.fmt(r.prize) : 'Перемога') : r.entry ? '−' + S.fmt(r.entry) : 'Без внеску';
  const hard = !!R.rival.hard;
  const note = bo.first ? 'бос переможений · нагорода нижче' : r.win ? (hard ? `складний реванш ×${S.BOSS_HARD.prizeMult} · наступний — завтра` : r.entry ? `реванш · внесок ${S.short(r.entry)} повернувся` : 'реванш') : r.entry ? 'внесок згорів' : 'програш коштує тільки пальне';
  const nx = bo.next ? BOSS(bo.next) : null;
  const reward = bo.first ? `<div class="card boss-reward" style="--c:${S.CLASSES[M(b.model).cls].color}"><div class="hook-t">${ic('crown')} ${esc(b.nick)} переможений!</div>
      <div class="rw-list">
        <div class="rw"><span class="rw-ic">${ic('cash')}</span><b class="win">${S.fmt(rw.money)}</b></div>
        ${(rw.items || []).map((p) => `<div class="rw">${partArt(p.type, p.tier, 'sm')}<span>${esc(S.partLabel(p.type, p.tier))}</span></div>`).join('')}
        ${rw.caseId ? `<div class="rw"><span class="rw-ic">${caseIcon(S.CASE_BY_ID[rw.caseId])}</span><span>${rw.count} × ключ «${esc(S.CASE_BY_ID[rw.caseId].name)}»</span></div>` : ''}
        ${rw.caseId && !bo.keysOpened ? rewardKeysBtn(rw.caseId, rw.count, `Бос · ${b.nick}`, 'boss') : ''}
        ${rw.plate ? `<div class="rw">${plate(rw.plate.text)}<span class="small muted">номер класу ${rw.plate.cls} · ${S.short(rw.plate.value)}</span></div>` : ''}
        ${rw.badge ? `<div class="rw">${badgeChip({ title: rw.badge, tier: S.BOSS_BADGES[b.country][1] })}<span class="small muted">у профілі</span></div>` : ''}
      </div>
      ${rw.badge ? emojiOffer(rw.badge) : ''}
      <div class="small muted mt">${nx ? `Відкрито: <b>${esc(nx.nick)}</b> · ${esc(M(nx.model).name)}${nx.country !== b.country ? ` · нова країна — ${S.COUNTRIES[nx.country].name}!` : ''}` : "Ти пройшов усю кар'єру!"}</div></div>` : !r.win ? `<div class="taunt">${esc(b.nick)}: «${esc(b.taunt)}»</div>` : '';
  return raceSheetHtml({ tag: `Бос · ${esc(b.nick)}${hard ? ' · складний' : ''}`, win: r.win, diff: r.diff, amount, note,
    rows: [{ who: 'Ти', model: R.car.model, look: R.car.look, time: r.time, won: r.win }, { who: b.nick, model: b.model, time: r.rivalTime, won: !r.win }], start: startTxt, shifts: r.shifts })
    + reward
    + challengeCta(R)
    + (nx && bo.first ? `<button class="btn yellow" data-act="bossNext" data-id="${nx.id}">Наступний бос: ${esc(nx.nick)}</button>`
      : `<button class="btn yellow" data-act="bossAgain" data-id="${b.id}" ${hard && !r.win ? 'data-hard="1"' : ''} ${me.fuel < 1 ? 'disabled' : ''}>${r.win ? 'Реванш' : hard ? 'Ще спроба · складний' : 'Ще спроба'} · пальне ${me.fuel}/${S.FUEL_MAX}</button>`)
    + `<button class="btn outline mt" data-act="raceExit">До кар'єри</button>`;
}
H.bossAgain = (d) => {
  state.race = null;
  H.startBoss(d);
};
H.bossNext = async (d) => {
  state.race = null;
  await render();
  H.bossCard(d);
};

async function pvpView(car) {
  const data = await api('pvp/list');
  return `<div class="card"><b>Створити виклик</b><div class="list mt">${carRow(car, '<button class="btn sm ghost" data-act="pvpCar">Змінити</button>')}</div>
      <label class="fld mt" for="bet">Ставка, ₴</label><input id="bet" inputmode="numeric" placeholder="Ставка" value="${grp(Math.max(S.PVP_MIN_BET, Math.min(me.balance, 50000)))}">
      <button class="btn mt" data-act="pvpCreate">Кинути виклик</button>
      <div class="tiny muted mt">Суперник ставить стільки ж. Переможець забирає банк мінус ${S.FEE * 100}%. Якщо суперник онлайн — гонка наживо: кожен сам жме газ і перемикає передачі. Якщо ні — за нього їде автопілот.</div></div>
    <div class="h2"><span>Відкриті виклики</span></div>
    ${data.open.length ? `<div class="list">${data.open.map((p) => carRow(p.car, p.mine ? `<button class="btn sm red" data-act="pvpCancel" data-id="${p.id}">Скасувати</button>` : `<button class="btn sm" data-act="pvpAccept" data-id="${p.id}" data-bet="${p.bet}">${S.short(p.bet)}</button>`)
      .replace('</b></div>', `</b></div><div class="tiny muted">${esc(p.creator)} · ${dec(p.car.et, 2)} с ${p.car.et < car.et ? '<span class="lose">швидший за твою</span>' : '<span class="win">повільніший за твою</span>'}</div>`)).join('')}</div>` : emptyBox('flag-3', 'Поки немає викликів', 'Створи перший — суперник поставить стільки ж')}
    ${data.history.length ? `<div class="h2"><span>Історія</span></div><div class="list">${data.history.map((h) => `<div class="li"><div class="grow"><b class="${h.win ? 'win' : 'lose'}">${h.win ? 'Перемога' : 'Поразка'}</b> <span class="muted small">vs ${esc(h.rival.name)}</span><div class="tiny muted">${esc(M(h.me.model).name)} проти ${esc(M(h.rival.car.model).name)}</div></div><b>${h.win ? '+' + S.short(h.result.prize - h.bet) : '−' + S.short(h.bet)}</b></div>`).join('')}</div>` : ''}`;
}
H.pvpCar = () => pickCar('Обери авто', (id) => (state.raceCar = state.raceCarPicked = id, render()));
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
  sheet('PvP наживо', `<div class="center"><div class="art" style="margin:0 auto;max-width:200px">${carArt(s.rival.car.model, { look: s.rival.car.look })}</div>
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
  hideClaimBanners();
  state.race = {
    phase: 'lights', live: { id: s.id, startAt: s.startAt, greenAt: s.greenAt },
    car: s.me.car, rival: { name: s.rival.name, model: s.rival.car.model, look: s.rival.car.look, hp: s.rival.car.hp, base: s.rival.car.base },
    reaction: null, shifts: [], gear: 1, result: null,
  };
  await render();
  runRace();
}
async function pvpAutopilot(id, carId) {
  try {
    const r = await api('pvp/accept', { id, carId });
    haptic(r.win ? 'success' : 'error');
    const show = () => sheet('PvP · автопілот', `<div class="center"><div class="big ${r.win ? 'win' : 'lose'}">${r.win ? 'Перемога!' : 'Поразка'}</div>${r.win ? `<div class="win" style="font-weight:900">+${S.fmt(r.prize)}</div>` : ''}
      <div class="mt">Ти: ${dec(r.result.opponent.time, 3)} с</div><div>${esc(r.rival.name)} (${esc(M(r.rival.car.model).name)}): ${dec(r.result.creator.time, 3)} с</div>
      <button class="btn mt" data-act="closeModal">Готово</button></div>`);
    // The result comes a moment after "Так": if the player has already moved to another screen (or opened a sheet),
    // it doesn't jump over it — a banner under the header says what happened, "Дивитись" opens the details.
    const here = state.tab === 'race' && !state.page && $('#modal').hidden;
    if (here) show();
    await refresh();
    // After the refresh, so the reward banners it brings don't push this one out of the stack.
    if (!here) showBanner({ key: `pvpres:${id}`, kind: 'pvp', title: `PvP: ${r.win ? 'перемога' : 'поразка'}`, sub: `${r.win ? `<b class="win">+${S.short(r.prize)}</b>` : 'ставку програно'} · автопілот ${esc(r.rival.name)}`, ttl: 12000, open: show, buttons: [{ label: 'Дивитись', act: 'bannerOpen' }] });
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- workshop ----------
TABS.shop = () => {
  const seg = `<div class="seg seg4">${[['cases', 'Кейси'], ['stock', `Склад${me.parts.length ? ' · ' + me.parts.reduce((s, p) => s + p.count, 0) : ''}`], ['paint', 'Фарбування'], ['wash', 'Мийка']].map(([k, t]) => `<button class="${state.shopView === k ? 'on' : ''} ${isOpen(k) ? '' : 'locked'}" data-act="shopView" data-k="${k}">${isOpen(k) ? '' : ic('lock')}${t}</button>`).join('')}</div>`;
  if (!isOpen(state.shopView)) state.shopView = 'cases';
  if (state.shopView === 'stock') return seg + stockView();
  if (state.shopView === 'wash') return seg + washView();
  if (state.shopView === 'paint') return seg + paintView();
  const pc = S.PART_CASE_BY_ID[state.partCase];
  if (pc.randomOnly && state.partType) state.partCase = 'racing';
  const price = partCasePrice(state.partCase);
  const d = state.partDrop;
  const fresh = state.fx?.type === 'parts';
  let stage;
  if (d) {
    stage = `<div class="multi parts ${d.length === 1 ? 'one' : ''}">${d.map((p, i) => {
      const t = S.TIER_BY_ID[p.tier];
      const sell = p.sold ? '<div class="dropsell done">Продано</div>' : p.put ? '' : `<button class="dropsell" data-act="sellDropPart" data-i="${i}">${ic('cash')}${S.short(t.price * S.PART_SELL_RATE)}</button>`;
      return `<div class="${fresh ? 'flip-in' : ''} ${p.sold ? 'sold' : ''}" style="animation-delay:${i * 140}ms"><div class="car pcard r${t.index}" style="--c:${S.CLASSES[t.cls].color}">${clsBadge(t.cls, 'tl')}
        <div class="art">${partArt(p.type, p.tier, 'lg')}</div><div class="nm ellipsis">${S.PARTS[p.type].name}</div><div class="meta">${t.name} · ${S.partEffect(p.type, p.tier)}</div>${S.partPoolFor(me.cars.map((c) => c.model)).includes(p.type) ? '' : `<div class="meta ptype-tag">${S.PARTS[p.type].ev ? 'для електро' : 'для бензинових'}</div>`}</div>${dropPutBtn(p, i, d.length === 1)}${sell}</div>`;
    }).join('')}</div>`;
  } else {
    stage = `<div class="reel-wrap" id="reelWrap"><div class="reel" id="reel">${Array.from({ length: 6 }, () => partReelCard(randomPartFor(pc))).join('')}</div></div>`;
  }
  const alive = d ? d.filter((p) => !p.sold && !p.put) : [];
  const sum = alive.reduce((s, p) => s + Math.floor(S.TIER_BY_ID[p.tier].price * S.PART_SELL_RATE), 0);
  const myPool = S.partPoolFor(me.cars.map((c) => c.model)); // what fits the player's cars (the server's random pool)
  const fitTag = (k) => (myPool.includes(k) ? '' : `<small class="ptype-tag">${S.PARTS[k].ev ? 'для електро' : 'для бензинових'}</small>`);
  return seg + `
    <div class="ptypes">${[[null, 'Будь-яка'], ...S.PART_KEYS.map((k) => [k, S.PARTS[k].name])].map(([k, n]) => `<button class="ptype ${state.partType === k ? 'on' : ''}" data-act="pickPartType" data-k="${k ?? ''}">
      ${k ? partArt(k, null, 'sm') : `<span class="part sm">${ic('adjustments')}</span>`}<span>${n}</span>${k ? fitTag(k) : ''}</button>`).join('')}</div>
    <div class="pcases">${S.PART_CASES.map((c) => {
      const off = c.randomOnly && state.partType;
      return `<button class="pcase ${c.id === state.partCase ? 'on' : ''}" data-act="pickPartCase" data-id="${c.id}" ${off ? 'disabled' : ''}>
        <b>${esc(c.name)}</b>
        <span class="tierbar">${Object.entries(c.weights).map(([t, w]) => `<i style="flex:${w};background:${S.CLASSES[S.TIER_BY_ID[t].cls].color}"></i>`).join('')}</span>
        <span class="pprice">${off ? 'лише випадкові' : S.fmt(partCasePrice(c.id))}</span></button>`;
    }).join('')}</div>
    <div class="stage pstage" style="${d?.length > 3 ? 'height:auto;min-height:200px' : d ? 'height:auto;min-height:170px' : ''}">${stage}</div>
    ${d?.length > 1 ? dropSummary(d) : ''}
    <div class="seg">${[1, 3, 5, 10].map((k) => `<button class="${k === state.partCount ? 'on' : ''}" data-act="partCount" data-n="${k}">×${k}</button>`).join('')}</div>
    ${price * state.partCount > me.balance ? `<button class="btn" disabled>Недостатньо коштів · бракує ${S.fmt(price * state.partCount - me.balance)}</button>`
      : state.partCount === 1 && (state.partNext || 0) > serverNow()
        ? `<button class="btn pwait" disabled style="--d:${S.PART_COOLDOWN_MS}ms;--o:${Math.min(0, state.partNext - serverNow() - S.PART_COOLDOWN_MS)}ms">Наступне ×1 через <span data-until="${state.partNext - clockOffset}"></span></button>`
        : `<button class="btn" data-act="openParts" ${state.opening ? 'disabled' : ''}>${d ? 'Відкрити ще' : 'Відкрити'}${state.partCount > 1 ? ' ×' + state.partCount : ''} · ${S.fmt(price * state.partCount)}</button>`}
    ${d ? `<div class="btns mt"><button class="btn outline" data-act="shopView" data-k="stock">На склад</button>${alive.length ? `<button class="btn ghost btn2" data-act="sellDropParts"><span>${ic('cash')} Продати все</span><small>${S.short(sum)}</small></button>` : ''}</div>` : ''}
    <div class="card row between mt"><span>Швидке відкриття</span><button class="toggle ${state.fast ? 'on' : ''}" data-act="toggleFast"></button></div>
    <div class="tiny muted center">${state.partType ? `Випадає лише «${S.PARTS[state.partType].name}», кейс на ${S.PICK_PART_EXTRA * 100}% дорожчий.` : 'Випадає випадкова деталь з тих, що підходять твоїм машинам. Обери конкретну вгорі, щоб збирати лише її.'} Три однакові деталі зливаються в одну рівнем вище на складі. Пауза ${S.PART_COOLDOWN_MS / 1000} с — лише між відкриттями ×1; ×3–×10 відкриваються одразу.</div>`;
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
  const pool = S.partPoolFor(me.cars.map((c) => c.model));
  return { type: state.partType || pool[Math.floor(Math.random() * pool.length)], tier };
}
const partReelCard = (p) => {
  const t = S.TIER_BY_ID[p.tier];
  return `<div class="car pcard" style="--c:${S.CLASSES[t.cls].color}">${clsBadge(t.cls, 'tl')}<div class="art">${partArt(p.type, p.tier)}</div><div class="nm tiny ellipsis">${S.PARTS[p.type].name} · ${t.name}</div></div>`;
};
AFTER.shop = () => {
  if (state.shopView === 'wash') return washAfter();
  if (state.shopView === 'paint') {
    const on = $('.pcar.on'), strip = $('#paintCars');
    if (on && strip && (on.offsetLeft < strip.scrollLeft || on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth)) strip.scrollLeft = on.offsetLeft - 16;
    return;
  }
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
  if (!isOpen(d.k)) return lockedSheet(d.k);
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
  hideClaimBanners();
  el.disabled = true;
  let r;
  try {
    r = await api('parts/open', { caseId: state.partCase, type: state.partType, count: state.partCount });
    // The server allows the next part case only after a pause; the button counts down and comes back by itself.
    state.partNext = r.nextAt;
    clearTimeout(state.partTimer);
    state.partTimer = setTimeout(() => !state.opening && render(), Math.max(0, r.nextAt - serverNow()) + 100);
  } catch (e) {
    state.opening = false;
    el.disabled = false;
    haptic('error');
    return toast(e.message, true);
  }
  // ×1, not in fast mode: spin the reel first, like car cases. ×3/×5/×10 show all the cards at once (one reveal).
  if (!state.fast && r.results.length === 1) {
    const pc = S.PART_CASE_BY_ID[state.partCase];
    state.partDrop = null;
    const spinPart = (win, opts = {}) => {
      const t = S.TIER_BY_ID[win.tier];
      return spinReel({ cardAt: (i, W) => partReelCard(i === W ? win : randomPartFor(pc)), color: S.CLASSES[t.cls].color, rank: t.index, ...opts });
    };
    $('.pstage').innerHTML = '<div class="reel-wrap" id="reelWrap"><div class="reel" id="reel"></div></div>';
    await spinPart(r.results[0]);
  }
  state.opening = false;
  state.partDrop = r.results.map((p) => ({ ...p }));
  state.fx = { type: 'parts' };
  await refresh();
};
function stockView() {
  if (!me.parts.length) return emptyBox('box', 'Склад порожній', 'Деталі випадають з кейсів майстерні. Три однакові деталі зливаються в одну рівнем вище.', '<button class="btn sm" data-act="shopView" data-k="cases">До кейсів з деталями</button>');
  // Types with the part that speeds a car up the most first; parts no car needs (T.junkParts) at the bottom, greyed.
  const use = stockUse();
  const junk = T.junkParts(me.cars, me.parts);
  const isJunk = (p) => junk.some((j) => j.type === p.type && j.tier === p.tier);
  const junkN = junk.reduce((s, j) => s + j.count, 0);
  const junkSum = junk.reduce((s, j) => s + Math.floor(S.TIER_BY_ID[j.tier].price * S.PART_SELL_RATE) * j.count, 0);
  const total = me.parts.reduce((s, p) => s + p.count, 0);
  const useful = me.parts.filter((p) => use[p.type + ':' + p.tier]).reduce((s, p) => s + p.count, 0);
  const rows = S.PART_KEYS.filter((k) => me.parts.some((p) => p.type === k)).map((k, order) => {
    const items = me.parts.filter((p) => p.type === k).sort((a, b) => S.TIER_BY_ID[a.tier].index - S.TIER_BY_ID[b.tier].index);
    const best = items.filter((p) => use[k + ':' + p.tier]).sort((a, b) => use[k + ':' + a.tier].dt - use[k + ':' + b.tier].dt)[0] || null;
    return { k, items, order, best: best && { p: best, u: use[k + ':' + best.tier] }, junk: items.every(isJunk) };
  }).sort((a, b) => (a.best ? a.best.u.dt : 1) - (b.best ? b.best.u.dt : 1) || a.junk - b.junk || a.order - b.order);
  return `<div class="card stock-sum"><div class="grow"><b>${total} ${plural(total, ['деталь', 'деталі', 'деталей'])} · ${rows.length} ${plural(rows.length, ['вид', 'види', 'видів'])}</b>
      <div class="small muted">${useful ? `${useful} прискорять машини` : 'жодна не прискорить твої машини'}${junkN ? ` · ${junkN} не потрібні` : ''}</div></div>
      ${junkN ? `<button class="btn sm ghost btn2" data-act="sellJunk"><span>${ic('cash')} Продати непотрібні</span><small>${junkN} шт · ${S.short(junkSum)}</small></button>` : ''}</div>
  <div class="list">${rows.map(({ k, items, best, junk: allJunk }) => {
    const canMerge = items.some((p) => p.available >= 3 && S.TIER_BY_ID[p.tier].index < S.TIERS.length - 1);
    return `<button class="li ${allJunk ? 'junk' : ''}" data-act="stockType" data-k="${k}">${partArt(k, items[items.length - 1].tier, 'sm')}<div class="grow"><b>${S.PARTS[k].name}</b><div class="dots tiers">${items.map((p) => `<span class="${isJunk(p) ? 'junk' : ''}" style="--c:${S.CLASSES[tierCls(p.tier)].color}">${S.TIER_BY_ID[p.tier].name}<b>×${p.count}</b></span>`).join('')}</div>
      ${best ? `<div class="stock-use">${S.TIER_BY_ID[best.p.tier].name}: <b>${T.fmtDt(best.u.dt)}</b> на ${esc(M(best.u.car.model).name)}</div>` : `<div class="stock-use none">${allJunk ? 'не кращі за встановлені на всіх машинах' : 'зараз не прискорять жодну машину'}</div>`}</div>
      ${canMerge ? `<span class="mergetag">${ic('sparkles')}3→1</span>` : `<span class="chev">${ic('chevron-right')}</span>`}</button>`;
  }).join('')}</div>
  <div class="tiny muted">Угорі — деталі, що найбільше прискорять твої машини (час на 402 м). Непотрібні — не кращі за встановлені на всіх машинах або не підходять жодній. Поставити деталь можна з її картки тут або кнопкою «Встановити найкраще» в картці машини.</div>`;
}
H.stockType = (d, el, e, result) => {
  const k = d.k;
  const items = me.parts.filter((p) => p.type === k).sort((a, b) => S.TIER_BY_ID[b.tier].index - S.TIER_BY_ID[a.tier].index);
  sheet(S.PARTS[k].name, `${result ? `<div class="card center"><div style="font-size:40px" class="${result.ok ? 'win' : 'lose'}">${result.ok ? partArt(k, result.result.tier, 'lg') : ic('flame')}</div><b class="${result.ok ? 'win' : 'lose'}">${result.ok ? S.partLabel(k, result.result.tier) : 'Не пощастило — деталі згоріли'}</b></div>` : ''}
    ${items.length ? `<div class="list">${items.map((p) => {
      const t = S.TIER_BY_ID[p.tier];
      const chance = S.MERGE_CHANCE[t.index];
      return `<div class="li">${partArt(k, p.tier, 'sm')}<div class="grow"><b>${t.name} × ${p.count}</b><div class="small muted">${clsBadge(t.cls)} ${S.short(t.price)} · ${S.partEffect(k, p.tier)}${p.cooling ? ` · остигає ${p.cooling} (<span data-until="${p.coolUntil - clockOffset}"></span>)` : ''}</div>${stockPutLine(p)}</div>
        <div class="col" style="gap:4px">${chance != null ? `<button class="btn sm" data-act="merge" data-k="${k}" data-tier="${p.tier}" ${p.available >= 3 ? '' : 'disabled'}>3→1 · ${Math.round(chance * 100)}%</button>` : ''}
        <button class="btn sm ghost" data-act="sellPart" data-k="${k}" data-tier="${p.tier}" ${p.available ? '' : 'disabled'}>${S.short(t.price * S.PART_SELL_RATE)}</button></div></div>`;
    }).join('')}</div>` : emptyBox('box', 'Деталей цього типу більше немає', 'Нові випадають з кейсів майстерні')}
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

// ---------- car wash (S.WASH): dirt on cars, Майстерня → Мийка, the hand-wash mini-game ----------
// Dirt comes from the server per car (c.dirt, at the time of the last refresh); «Блищить» until c.shineUntil.
const shining = (c) => (c.shineUntil || 0) > serverNow();
const isDirty = (c) => (c.dirt || 0) >= S.WASH.dirty;
const washable = (c) => c.status === 'garage' || c.status === 'showcase';
const cutPct = (c) => (isOpen('wash') ? Math.round(S.dirtCut(c.dirt || 0) * 100) : 0);
// Car card: the income an hour as the garage really pays it (S.garageIncome), and what made it so.
function incStat(c) {
  const e = carInc(c);
  if (c.status === 'garage' && e && !e.earning) return '<div class="inc-off"><b>0</b><span>не заробляє</span></div>';
  if (!e) return `<div class="inc-off"><b>0</b><span>дохід / год</span></div>`;
  const x = e.rate / e.clean - 1;
  return `<div><b>${S.short(e.rate)}${Math.abs(x) >= 0.005 ? `<em class="${x > 0 ? 'win' : 'lose'}">${sPct(x)}</em>` : ''}</b><span>дохід / год</span></div>`;
}
function incNote(c) {
  const e = carInc(c);
  if (c.status === 'showcase') return '<div class="inc-note muted">На вітрині машина не заробляє.</div>';
  if (!e) return '';
  if (!e.earning) {
    const g = garageInc();
    return `<div class="inc-note off"><b>Не заробляє — немає місця.</b> Дохід дають ${g.room} ${plural(g.room, ['найкраща машина', 'найкращі машини', 'найкращих машин'])} за кількістю місць у гаражі. Купи місце (Гараж → «Місце в гаражі»), продай або постав на вітрину слабшу машину.</div>`;
  }
  const bits = [];
  if (e.country) bits.push(`країна ${sPct(e.country)}`);
  if (e.set) bits.push(`сет ${sPct(e.set)}`);
  if (e.wash > 1) bits.push(`блищить ${sPct(e.wash - 1)}`);
  else if (e.wash < 1) bits.push(`бруд ${sPct(e.wash - 1)}`);
  return bits.length ? `<div class="inc-note muted">База ${S.short(e.clean)} / год · ${bits.join(' · ')}</div>` : '';
}
// Marker next to a car (car card, market rows): «брудна» from WASH.dirty, «блищить» while the shine lasts.
const dirtTag = (c) => (shining(c) ? ` <span class="dirt-tag shine">${ic('sparkles')}блищить</span>` : isDirty(c) ? ` <span class="dirt-tag dirty">${ic('droplet')}брудна</span>` : '');
// Small indicator on a garage tile: sparkles while it shines, a drop with the % once there's visible dirt.
const dirtPip = (c) => (shining(c) ? `<span class="dirt-pip shine" title="Блищить">${ic('sparkles')}</span>` : (c.dirt || 0) >= 20 ? `<span class="dirt-pip ${isDirty(c) ? 'dirty' : ''}">${ic('droplet')}${c.dirt}%</span>` : '');
function washLi(c) {
  if (!washable(c)) return '';
  const sub = shining(c) ? `блищить ще <span data-until="${c.shineUntil - clockOffset}"></span> · +${Math.round(S.WASH.shine * 100)}% доходу`
    : `бруд ${c.dirt || 0}%${(c.dirt || 0) >= 30 ? ` · помий — +${Math.round(S.WASH.shine * 100)}% доходу на ${S.WASH.shineHours} год` : ''}`;
  return `<button class="li" data-act="washCar" data-id="${c.id}"><span class="ic">${ic('droplet')}</span><div class="grow"><b>Мийка</b><div class="small muted">${sub}</div></div>${isOpen('wash') ? `<span class="wash-meter sm"><i style="width:${c.dirt || 0}%"></i></span>` : lockChip('wash')}</button>`;
}
function washHint(all) {
  if (!isOpen('wash')) return '';
  const dirty = all.filter((c) => c.status === 'garage' && isDirty(c));
  if (dirty.length < 2) return '';
  // Dirt costs nothing (S.WASH.maxCut 0): the hint only offers the shine bonus.
  return `<button class="card row wash-hint" data-act="toWash"><span class="wash-hint-ic">${ic('droplet')}</span><div class="grow"><b>${dirty.length} ${plural(dirty.length, ['машина брудна', 'машини брудні', 'машин брудні'])}</b>
    <div class="small muted">Помий — і вони блищатимуть: +${Math.round(S.WASH.shine * 100)}% доходу на ${S.WASH.shineHours} год. Бруд доходу не зменшує</div></div><span class="chev">${ic('chevron-right')}</span></button>`;
}
H.toWash = (d) => {
  if (!isOpen('wash')) return lockedSheet('wash');
  closeModal();
  state.tab = 'shop';
  state.page = null;
  state.shopView = 'wash';
  state.washCar = d?.id ? Number(d.id) : null;
  window.scrollTo(0, 0);
  render();
};
H.washCar = (d) => H.toWash(d);
// Cars that can go to the wash: dirtiest first.
function washList() {
  return me.cars.filter(washable).sort((a, b) => (b.dirt || 0) - (a.dirt || 0) || b.value - a.value || b.id - a.id);
}
function washView() {
  const cars = washList();
  if (!cars.length) return emptyBox('droplet', 'Немає машин для мийки', 'Мити можна машини в гаражі й на вітрині.');
  let c = cars.find((x) => x.id === state.washCar);
  if (!c) (c = cars[0], (state.washCar = c.id));
  const m = M(c.model), rank = S.rankOf(m.cls), sh = shining(c), d = c.dirt || 0;
  const left = me.wash?.handLeft ?? 0, vip = !!me.vip;
  const price = vip ? 0 : S.washPrice(c.model);
  const dirtyAll = cars.filter((x) => (x.dirt || 0) >= 10);
  const allSum = vip ? 0 : dirtyAll.reduce((s, x) => s + S.washPrice(x.model), 0);
  const strip = `<div class="paint-cars wash-cars" id="washCars">${cars.map((x) => `<button class="pcar ${x.id === c.id ? 'on' : ''}" data-act="washPick" data-id="${x.id}" style="--c:${S.CLASSES[M(x.model).cls].color}">
    <span class="art">${carArt(x.model, { look: x.look, dirt: x.dirt })}</span><span class="pcar-nm ellipsis">${esc(M(x.model).name)}</span>
    <span class="wash-meter"><i style="width:${x.dirt || 0}%"></i></span><span class="pcar-d ${isDirty(x) ? 'dirty' : ''}">${shining(x) ? `${ic('sparkles')}блищить` : `${x.dirt || 0}%`}</span></button>`).join('')}</div>`;
  const state1 = sh ? `<span class="wash-state shine">${ic('sparkles')} Блищить ще <span data-until="${c.shineUntil - clockOffset}"></span> · +${Math.round(S.WASH.shine * 100)}% доходу</span>`
    : `<span class="wash-state ${isDirty(c) ? 'dirty' : ''}">${ic('droplet')} Бруд ${d}% · ${d >= 30 ? `після мийки +${Math.round(S.WASH.shine * 100)}% доходу` : 'майже чиста'}</span>`;
  const handBtn = left > 0
    ? `<button class="btn" data-act="washHand" data-id="${c.id}">${ic('droplet')} Помити руками · безкоштовно</button>`
    : `<button class="btn ghost" disabled>Ручна мийка — завтра знову ${S.WASH.hand}</button>`;
  const autoBtn = `<button class="btn ${left > 0 ? 'ghost' : ''}" data-act="washAuto" data-id="${c.id}" ${!vip && price > me.balance ? 'disabled' : ''}>${ic('spray')} Автомийка · ${vip ? 'VIP безкоштовно' : S.fmt(price)}</button>`;
  return `${strip}
    <div class="hero wash-hero r${rank} ${sh ? 'shining' : ''}" id="washHero" style="--c:${S.CLASSES[m.cls].color}"><div class="art">${carArt(c.model, { look: c.look, dirt: d })}</div></div>
    <div class="wash-now"><b>${esc(m.name)}</b>${state1}</div>
    <div class="wash-bar"><span class="wash-meter lg"><i style="width:${d}%"></i><s style="left:${S.WASH.dirty}%"></s></span></div>
    <div class="wash-opts">
      <div class="wash-opt"><span class="ic">${ic('droplet')}</span><div class="grow"><b>Ручна мийка</b><div class="small muted">Зітри піну пальцем · ~10 с · сьогодні ще <b class="${left ? '' : 'lose'}">${left}</b> з ${S.WASH.hand}</div></div></div>
      ${handBtn}
      <div class="wash-opt"><span class="ic">${ic('spray')}</span><div class="grow"><b>Автомийка</b><div class="small muted">Миттєво · клас ${m.cls} — ${S.fmt(S.washPrice(c.model))}${vip ? ' · з VIP безкоштовно' : ''}</div></div></div>
      ${autoBtn}
      ${dirtyAll.length > 1 ? `<button class="btn outline btn2" data-act="washAll" ${!vip && allSum > me.balance ? 'disabled' : ''}><span>${ic('spray')} Помити всі · ${dirtyAll.length}</span><small>${vip ? 'VIP — безкоштовно' : S.fmt(allSum)}</small></button>` : ''}
    </div>
    <div class="tiny muted center mt">Кожен заїзд бруднить машину на ${S.WASH.race[0]}–${S.WASH.drift[1]}%, у гаражі — +${S.WASH.perHour}% за годину. Бруд — лише вигляд: на дохід і швидкість не впливає. Після мийки машина блищить ${S.WASH.shineHours} год: +${Math.round(S.WASH.shine * 100)}% доходу.</div>`;
}
function washAfter() {
  const on = $('.wash-cars .pcar.on'), strip = $('#washCars');
  if (on && strip && (on.offsetLeft < strip.scrollLeft || on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth)) strip.scrollLeft = on.offsetLeft - 16;
  if (state.washFx) {
    state.washFx = false;
    const hero = $('#washHero');
    if (!hero) return;
    hero.classList.add('just');
    FX.sparkle(hero, ['#ffffff', '#cfe8ff', '#ffd500'], 14);
  }
}
H.washPick = (d) => {
  state.washCar = Number(d.id);
  const x = $('#washCars')?.scrollLeft;
  render();
  if (x != null && $('#washCars')) $('#washCars').scrollLeft = x;
};
// After a car wash: `act` has already refreshed `me`; redraw with the shine and a splash.
function washDoneFx() {
  state.washFx = true;
  SFX.splash();
  render();
}
H.washAuto = async (d, el) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  if (!c) return;
  const price = me.vip ? 0 : S.washPrice(c.model);
  if (price && !armed(el, `Точно? · −${S.fmt(price)}`)) return;
  const r = await act('wash/auto', { carIds: [c.id] }, (x) => (x.paid ? `Помито · −${S.fmt(x.paid)}. Блищить ${S.WASH.shineHours} год` : `Помито безкоштовно (VIP). Блищить ${S.WASH.shineHours} год`), { rerender: false });
  if (r) washDoneFx();
};
H.washAll = async () => {
  const list = washList().filter((x) => (x.dirt || 0) >= 10);
  if (!list.length) return;
  const sum = me.vip ? 0 : list.reduce((s, x) => s + S.washPrice(x.model), 0);
  if (!(await confirmBox(`Помити ${list.length} ${plural(list.length, ['машину', 'машини', 'машин'])} на автомийці${sum ? ` за ${S.fmt(sum)}` : ' безкоштовно (VIP)'}?`))) return;
  const r = await act('wash/auto', { carIds: list.map((x) => x.id) }, (x) => `Помито ${x.count} ${plural(x.count, ['машину', 'машини', 'машин'])}${x.paid ? ` · −${S.fmt(x.paid)}` : ''}`, { rerender: false });
  if (r) washDoneFx();
};

// Hand wash: the car under foam and mud on a canvas; the finger (any pointer) wipes it off. Done at WASH.handClean of
// the cover gone; only then the server is asked (it checks the car and the day's count, nothing about the game).
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
H.washHand = (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  if (!c) return;
  if (!(me.wash?.handLeft > 0)) return toast(`Ручна мийка на сьогодні все — завтра знову ${S.WASH.hand}`, true);
  washGame(c);
};
async function washGame(c) {
  const m = M(c.model);
  const box = document.createElement('div');
  box.className = 'washgame' + (reducedMotion ? ' calm' : '');
  box.innerHTML = `<div class="wg-card"><div class="wg-head"><b>Ручна мийка</b><button class="x" data-wg="close" aria-label="Закрити">✕</button></div>
    <div class="wg-sub">${esc(m.name)} · три пальцем по піні, поки не заблищить</div>
    <div class="wg-stage"><img class="wg-car" alt="" draggable="false"><canvas class="wg-cover"></canvas><div class="wg-hint">${ic('droplet')} Три!</div><div class="wg-load">Набираємо піну…</div></div>
    <div class="wg-meter"><span class="wash-meter lg clean"><i></i></span><b class="wg-pct">0%</b></div>
    <div class="wg-foot"><button class="btn" data-wg="done" hidden>Готово</button></div></div>`;
  document.body.append(box);
  let over = false, alive = true;
  const close = () => {
    alive = false;
    box.remove();
    if (over) refresh();
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wg]');
    if (b || e.target === box) e.stopPropagation();
    if (b?.dataset.wg === 'close' || b?.dataset.wg === 'done' || (e.target === box && !over)) close();
  });
  let scene;
  try {
    scene = await DIRT.washScene(c.model, c.look, c.dirt);
  } catch {
    close();
    return toast('Не вдалося підготувати мийку — спробуй ще раз', true);
  }
  if (!alive) return;
  const stage = $('.wg-stage', box), img = $('.wg-car', box), cv = $('.wg-cover', box), pctEl = $('.wg-pct', box), bar = $('.wg-meter i', box);
  stage.style.aspectRatio = `${scene.w} / ${scene.h}`;
  img.src = scene.car.src;
  cv.width = scene.w;
  cv.height = scene.h;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.drawImage(scene.cover, 0, 0);
  $('.wg-load', box).remove();
  // Sample points: every 3rd pixel of the cover that starts out covered.
  const start = x.getImageData(0, 0, scene.w, scene.h).data;
  const pts = [];
  for (let y = 1; y < scene.h; y += 3) for (let i = 1; i < scene.w; i += 3) if (start[(y * scene.w + i) * 4 + 3] > 60) pts.push((y * scene.w + i) * 4 + 3);
  let last = null, dirty = false, clean = 0, t0 = 0;
  const brush = () => (22 * scene.w) / cv.getBoundingClientRect().width; // ~22 css px
  const toCanvas = (e) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * scene.w, ((e.clientY - r.top) / r.height) * scene.h];
  };
  const wipe = (p, q) => {
    const R = brush(), dist = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(dist / (R * 0.3)));
    x.globalCompositeOperation = 'destination-out';
    for (let i = 1; i <= n; i++) {
      const cx = p[0] + ((q[0] - p[0]) * i) / n, cy = p[1] + ((q[1] - p[1]) * i) / n;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, 'rgba(0,0,0,0.5)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(cx - R, cy - R, R * 2, R * 2);
    }
    x.globalCompositeOperation = 'source-over';
    dirty = true;
  };
  const measure = () => {
    if (!dirty || over) return;
    dirty = false;
    const d = x.getImageData(0, 0, scene.w, scene.h).data;
    let n = 0;
    for (const o of pts) if (d[o] < 40) n++;
    clean = pts.length ? n / pts.length : 1;
    const shown = Math.min(100, Math.round((clean / S.WASH.handClean) * 100));
    pctEl.textContent = shown + '%';
    bar.style.width = shown + '%';
    if (clean >= S.WASH.handClean) finish();
  };
  const timer = setInterval(() => (alive ? measure() : clearInterval(timer)), 150);
  cv.addEventListener('pointerdown', (e) => {
    if (over) return;
    e.preventDefault();
    cv.setPointerCapture?.(e.pointerId);
    last = toCanvas(e);
    t0 ||= performance.now();
    $('.wg-hint', box)?.remove();
    wipe(last, last);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!last || over) return;
    e.preventDefault();
    const p = toCanvas(e);
    const speed = Math.hypot(p[0] - last[0], p[1] - last[1]) / brush();
    wipe(last, p);
    last = p;
    SFX.scrub(0.7 + speed * 0.4);
    hapticTick('soft', 120);
  });
  const up = () => (last = null);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  async function finish() {
    over = true;
    clearInterval(timer);
    pctEl.textContent = '100%';
    bar.style.width = '100%';
    cv.classList.add('gone');
    try {
      const r = await api('wash/hand', { carId: c.id });
      me.wash = { ...me.wash, handLeft: r.handLeft };
      haptic('success');
      SFX.splash();
      stage.classList.add('shining');
      FX.sparkle(stage, ['#ffffff', '#cfe8ff', '#ffd500'], 18);
      $('.wg-sub', box).innerHTML = `<b class="win">${ic('sparkles')} Блищить!</b> +${Math.round(S.WASH.shine * 100)}% доходу на ${S.WASH.shineHours} год · ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} с`;
      state.washFx = true;
    } catch (e) {
      haptic('error');
      $('.wg-sub', box).innerHTML = `<span class="lose">${esc(e.message)}</span>`;
    }
    const done = $('[data-wg="done"]', box);
    done.hidden = false;
  }
}

// ---------- paint shop (Фарба 2.0) ----------
// Pick a car, try colours and liveries on its photo (rendered by paint.js right here), pay to keep them.
// Only the body changes; the price is a share of the model's price (S.paintPrice / S.liveryPrice), the car's value stays.
const curLook = (c) => ({ paint: c.look?.paint || null, livery: c.look?.livery || null });
function paintCarSel() {
  const cars = me.cars.slice().sort((a, b) => b.value - a.value || b.id - a.id);
  let c = cars.find((x) => x.id === state.paintCar);
  if (!c) c = cars.find((x) => PAINT.canPaint(x.model) && x.status !== 'market' && x.status !== 'auction') || cars[0];
  if (c && state.paintCar !== c.id) {
    state.paintCar = c.id;
    state.paintDraft = null;
  }
  if (c && !state.paintDraft) state.paintDraft = curLook(c);
  return { cars, c };
}
const swatchStyle = (p) => `--sw:${p.hex}`;
function paintPreview(c) {
  const m = M(c.model), rank = S.rankOf(m.cls);
  const look = { ...state.paintDraft, n: c.look?.n || (c.id % 99) + 1 };
  const p = S.PAINT_BY_ID[look.paint], l = S.LIVERY_BY_ID[look.livery];
  return `<div class="hero paint-hero r${rank}" style="--c:${S.CLASSES[m.cls].color}"><div class="art">${carArt(c.model, { look })}</div></div>
    <div class="paint-now"><span class="sw-dot ${p ? p.finish : 'factory'}" style="${p ? swatchStyle(p) : ''}"></span><b>${p ? esc(p.name) : 'Заводський колір'}</b>${p ? `<span class="muted">· ${S.PAINT_FINISH[p.finish]}</span>` : ''}${l ? `<span class="chip">${ic('brush')}${esc(l.name)}</span>` : ''}</div>`;
}
function paintBuyBtn(c) {
  const cur = curLook(c), d = state.paintDraft;
  const pc = d.paint !== cur.paint, lc = d.livery !== cur.livery;
  if (!pc && !lc) return `<button class="btn" disabled>${cur.paint || cur.livery ? 'Це вже на машині' : 'Обери колір або ліврею'}</button>`;
  const price = (pc && d.paint ? S.paintPrice(c.model) : 0) + (lc && d.livery ? S.liveryPrice(c.model, d.livery) : 0);
  if (!price) return `<button class="btn ${lc && S.LIVERY_BY_ID[d.livery]?.cos ? 'yellow' : 'ghost'}" id="paintBuy" data-act="paintBuy">${lc && S.LIVERY_BY_ID[d.livery]?.cos ? `${ic('brush')} Нанести ліврею ${S.LIVERY_BY_ID[d.livery].star ? '«Стилю»' : 'сезону'}` : d.paint || d.livery ? 'Зняти ліврею' : 'Повернути заводський вигляд'} · безкоштовно</button>`;
  if (price > me.balance) return `<button class="btn" disabled>Недостатньо коштів · бракує ${S.fmt(price - me.balance)}</button>`;
  const what = pc && d.paint && lc && d.livery ? 'Фарба + ліврея' : pc && d.paint ? 'Пофарбувати' : 'Нанести ліврею';
  return `<button class="btn yellow" id="paintBuy" data-act="paintBuy" data-price="${price}">${ic('palette')} ${what} · ${S.fmt(price)}</button>`;
}
function paintView() {
  const { cars, c } = paintCarSel();
  if (!c) return emptyBox('palette', 'Немає машин', 'Відкрий кейс — і перша машина з’явиться в гаражі.');
  const locked = c.status === 'market' || c.status === 'auction';
  const can = PAINT.canPaint(c.model) && !locked;
  const d = state.paintDraft;
  const mode = state.paintMode || 'color';
  const strip = `<div class="paint-cars" id="paintCars">${cars.map((x) => `<button class="pcar ${x.id === c.id ? 'on' : ''} ${PAINT.canPaint(x.model) ? '' : 'off'}" data-act="paintPick" data-id="${x.id}" style="--c:${S.CLASSES[M(x.model).cls].color}">
    <span class="art">${carArt(x.model, { look: x.look })}</span><span class="pcar-nm ellipsis">${esc(M(x.model).name)}</span></button>`).join('')}</div>`;
  let body;
  if (locked) body = `<div class="card center muted">Машина на ${c.status === 'market' ? 'ринку' : 'аукціоні'} — зніми її з продажу, щоб перефарбувати.</div>`;
  else if (!can) body = `<div class="card center muted">Для цієї машини фарбування поки недоступне: на її фото не вдалося точно виділити кузов.</div>
    ${c.look ? `<div class="btns mt"><button class="btn ghost" data-act="paintReset">Повернути заводський вигляд</button></div>` : ''}`;
  else {
    const grid = mode === 'color'
      ? `<div class="swatches"><button class="sw factory ${!d.paint ? 'on' : ''}" data-act="paintColor" data-id=""><i></i><span>Завод</span></button>${S.PAINT_COLORS.map((p) => `<button class="sw ${p.finish} ${d.paint === p.id ? 'on' : ''}" data-act="paintColor" data-id="${p.id}" style="${swatchStyle(p)}" aria-label="${esc(p.name)}"><i></i><span>${esc(p.name)}</span></button>`).join('')}</div>
        <div class="tiny muted center">Фарба · ${S.fmt(S.paintPrice(c.model))} — ${Math.round(S.PAINT.rate * 100)}% ціни моделі. Металік блищить дрібними іскрами, мат — без відблисків.</div>`
      : `<div class="liveries"><button class="lv ${!d.livery ? 'on' : ''}" data-act="paintLivery" data-id=""><b>Без лівреї</b><span>лише фарба</span></button>${liveryList().map((l) => `<button class="lv lv-${l.id} ${d.livery === l.id ? 'on' : ''}" data-act="paintLivery" data-id="${l.id}"><i></i><b>${esc(l.name)}</b><span>${esc(l.hint)}</span></button>`).join('')}${liveryLocked().map((it) => `<button class="lv lv-${it.look} lv-lock" data-act="goStyle"><i></i><b>${esc(S.LIVERY_BY_ID[it.look].name)}</b><span>${ic('star')} ${it.stars} · у «Стилі»</span></button>`).join('')}</div>
        <div class="tiny muted center">Ліврея · ${S.fmt(S.liveryPrice(c.model))} — ${Math.round(S.PAINT.liveryRate * 100)}% ціни моделі. Лягає поверх фарби з тінями кузова.</div>`;
    body = `<div id="paintBuyBox" class="paint-buy">${paintBuyBtn(c)}</div>
      <div class="seg paint-seg">${[['color', 'Колір'], ['livery', 'Ліврея']].map(([k, t]) => `<button class="${mode === k ? 'on' : ''}" data-act="paintMode" data-k="${k}">${t}</button>`).join('')}</div>
      ${grid}
      ${c.look ? `<button class="btn ghost sm paint-reset" data-act="paintReset">Повернути заводський вигляд · безкоштовно</button>` : ''}`;
  }
  return `${strip}<div id="paintPrevBox">${paintPreview(c)}</div>${body}
    <div class="tiny muted center mt">Фарбується лише кузов: скло, диски, фари, хром і чорний пластик лишаються як були. Вартість машини від фарби не змінюється.</div>`;
}
// Swatch / livery taps only redraw the preview and the button, so the car strip keeps its scroll position.
function paintRefresh() {
  const c = me.cars.find((x) => x.id === state.paintCar);
  if (!c || !$('#paintPrevBox')) return render();
  $('#paintPrevBox').innerHTML = paintPreview(c);
  const box = $('#paintBuyBox');
  if (box) box.innerHTML = paintBuyBtn(c);
  document.querySelectorAll('[data-act="paintColor"]').forEach((b) => b.classList.toggle('on', (b.dataset.id || null) === state.paintDraft.paint));
  document.querySelectorAll('[data-act="paintLivery"]').forEach((b) => b.classList.toggle('on', (b.dataset.id || null) === state.paintDraft.livery));
}
H.paintPick = (d) => {
  state.paintCar = Number(d.id);
  state.paintDraft = null;
  const x = $('#paintCars')?.scrollLeft;
  render();
  if (x != null && $('#paintCars')) $('#paintCars').scrollLeft = x;
};
H.paintMode = (d) => {
  state.paintMode = d.k;
  const x = $('#paintCars')?.scrollLeft;
  render();
  if (x != null && $('#paintCars')) $('#paintCars').scrollLeft = x;
};
H.paintColor = (d) => {
  state.paintDraft = { ...state.paintDraft, paint: d.id || null };
  haptic('light');
  paintRefresh();
};
H.paintLivery = (d) => {
  state.paintDraft = { ...state.paintDraft, livery: d.id || null };
  haptic('light');
  paintRefresh();
};
H.paintBuy = async (d, el) => {
  const c = me.cars.find((x) => x.id === state.paintCar);
  if (!c) return;
  const price = Number(el.dataset.price || 0);
  if (price && !armed(el, `Точно? · −${S.fmt(price)}`)) return;
  const cur = curLook(c), want = state.paintDraft;
  el.disabled = true;
  try {
    if (!want.paint && !want.livery) await api('car/paint-reset', { carId: c.id });
    else {
      if (want.paint !== cur.paint) await api('car/paint', { carId: c.id, color: want.paint });
      if (want.livery !== cur.livery) await api('car/livery', { carId: c.id, livery: want.livery });
    }
    haptic('success');
    toast(price ? `Готово! −${S.fmt(price)}` : S.LIVERY_BY_ID[want.livery]?.cos && want.livery !== cur.livery ? 'Ліврею нанесено!' : 'Повернуто заводський вигляд');
    if (price) {
      const r = el.getBoundingClientRect();
      FX.burst(r.left + r.width / 2, r.top, ['#ffd500', '#ffffff', S.PAINT_BY_ID[want.paint]?.hex || '#f5b301'], { count: 28, power: 5, shape: 'mix' });
    }
  } catch (e) {
    haptic('error');
    toast(e.message, true);
  }
  state.paintDraft = null;
  await refresh();
};
H.paintReset = async () => {
  const c = me.cars.find((x) => x.id === state.paintCar);
  if (c && (await act('car/paint-reset', { carId: c.id }, 'Повернуто заводський вигляд'))) state.paintDraft = null, render();
};
H.carPaint = (d) => {
  if (!isOpen('paint')) return lockedSheet('paint');
  state.tab = 'shop';
  state.page = null;
  state.shopView = 'paint';
  state.paintCar = Number(d.id);
  state.paintDraft = null;
  closeModal();
  render();
};

// ---------- menu ----------
function claimableCollection() {
  if (!me) return false;
  const owned = new Set(me.collection);
  const n = me.collection.filter((id) => !M(id)?.secret).length;
  if (S.COLLECTION_MILESTONES.some((m) => n >= m.n && !S.milestoneTaken(m, me.claims))) return true;
  if (setsReady() > 0) return true;
  return S.MAIN_COUNTRIES.some((c) => !me.claims.includes('c' + c) && S.countryModels(c).every((m) => owned.has(m.id)));
}
// The «Меню» hub: who I am on top, then what pays off today (pass, quests, events, collection, achievements, rating,
// friends) as big tiles with live numbers, then trading and the risky games as small tiles, the shop, help and one
// «Налаштування» row. Red badges only where something waits for a tap; «Нове» on a feature until its first visit.
// Numbers that `me` doesn't carry (quests, achievements, my place, career, friends) come in AFTER.menu and are patched
// into the tiles in place (cached for 30 s), so the screen never waits on the network.
const HUB_SEEN = 'avtodrop-hub-seen';
const HUB_FEATS = ['market', 'trades', 'tradein', 'plates', 'battles', 'upgrade'];
function hubSeen() {
  try {
    const raw = localStorage.getItem(HUB_SEEN);
    if (raw) return new Set(JSON.parse(raw));
    // First run of the new menu: everything already open counts as seen, so only later unlocks say «Нове».
    const s = new Set(HUB_FEATS.filter(isOpen));
    localStorage.setItem(HUB_SEEN, JSON.stringify([...s]));
    return s;
  } catch {
    return new Set(HUB_FEATS);
  }
}
function hubMarkSeen(k) {
  try {
    const s = hubSeen();
    if (s.has(k)) return;
    s.add(k);
    localStorage.setItem(HUB_SEEN, JSON.stringify([...s]));
  } catch {}
}
H.hubGo = (d) => (hubMarkSeen(d.k), go(d.page));
H.profileOpen = () => openProfile();
const hubCnt = (n) => (n ? `<span class="hub-cnt">${n === true ? '!' : n > 99 ? '99+' : n}</span>` : '');
// One tile: size 'tall' (2 per row, icon + title + live line), 'wide' (2 per row, icon left), 'mini' (4 per row,
// icon + label). Locked → lock chip. (Not 'big': the global .big is the slanted display headline.)
function hubTile({ page, k, icon, c, title, info = '', badge = 0, act = 'go', size = 'tall', id = '', extra = '' }) {
  const lockedK = k && !isOpen(k) ? k : null;
  if (lockedK) return `<button class="hub-t ${size} locked" data-act="locked" data-k="${lockedK}" style="--c:${c}"><span class="hub-ic">${ic(icon)}</span>
    <span class="hub-tx"><b>${title}</b>${lockChip(lockedK)}</span></button>`;
  const isNew = k && HUB_FEATS.includes(k) && !hubSeen().has(k);
  const a = isNew ? `data-act="hubGo" data-k="${k}"` : `data-act="${act}"`;
  return `<button class="hub-t ${size}" ${a} data-page="${page}" style="--c:${c}" ${id ? `id="${id}"` : ''}><span class="hub-ic">${ic(icon)}</span>
    <span class="hub-tx"><b>${title}</b>${size === 'mini' && !info ? '' : `<span class="hub-i">${info}</span>`}${extra}</span>${isNew ? '<span class="hub-new">Нове</span>' : hubCnt(badge)}</button>`;
}
// What the next level brings, right under the XP bar: «Ще 3 перемоги → Ринок, Трейд-ін» / «Рів. 4 через ~350 досвіду → …».
function hubNextText() {
  const nu = nextUnlock();
  if (nu) return `${nextUnlockText(nu)}${nu.names.length > 1 ? ', ' + nu.names.slice(1).join(', ') : ''}`;
  const left = Math.max(0, (me.xpNeed || 0) - (me.xp || 0));
  return `До ${me.level + 1} рівня — ще ${S.fmt(left).replace(' ₴', '')} досвіду`;
}
TABS.menu = () => {
  const Y = '#ffc400', BL = '#3b82f6', PU = '#a855f7', RD = '#ef4444', GR = '#2fd27a', AM = '#ff8a3d', ST = '#8a94a7', CY = '#22c3e6';
  const C = state.hub || {};
  const have = me.collection.filter((id) => !M(id)?.secret).length, total = S.ALL_MODELS.filter((m) => !m.secret).length;
  const name = me.firstName || (me.username ? '@' + me.username : 'Гравець');
  const photo = tg?.initDataUnsafe?.user?.photo_url;
  const boss = (me.badges || []).find((b) => b.key === 'boss');
  // ---- profile header: avatar in the level ring, name, level · career · VIP, garage value, XP to the next level
  const head = `<div class="hub-me" data-act="profileOpen" role="button" tabindex="0" aria-label="Профіль">
    <span class="hub-ava">${ring(me.level, me.xp, me.xpNeed, 58)}<span class="face${photo ? ' photo' : ''}">${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : esc(initialOf(name))}</span><span class="lvl">${me.level}</span></span>
    <span class="hub-who"><b class="ellipsis">${esc(name)}</b>
      <span class="hub-chips"><span class="hc career" id="hubCareer">${ic('crown')}${boss ? esc(boss.title) : C.career ? `Кар'єра ${C.career.beaten}/${C.career.total}` : "Кар'єра"}</span>${me.vip ? `<span class="hc vip">${ic('crown')}VIP</span>` : ''}</span>
      <span class="hub-xp"><i style="width:${Math.min(100, (me.xp / me.xpNeed) * 100)}%"></i></span>
      <span class="hub-next ellipsis">${hubNextText()}</span></span>
    <span class="hub-val"><small class="hn-hub">продаж гаража</small><b>${S.short(sellTotal(me.cars.filter((c) => c.status !== 'showcase' && !M(c.model).secret)))}</b></span>
    <button class="hub-bell" data-act="go" data-page="events" aria-label="Сповіщення${me.unread ? `: ${me.unread} нових` : ''}">${ic('bell')}${hubCnt(me.unread)}</button></div>`;
  // ---- season pass: the widest tile
  const s = me.season;
  const pass = s ? `<button class="hub-pass${s.ready ? ' ready' : ''}" data-act="go" data-page="season">
    <span class="hub-pass-h"><span class="hub-ic">${ic('ticket')}</span><span class="grow"><b>Сезонний пропуск</b><span class="hub-i">Сезон ${s.id} · ${s.premium ? `<span class="acc">${ic('crown')}Преміум</span>` : 'безкоштовна доріжка'}</span></span>
      <span class="hub-pass-lv"><b>${s.level}</b><small>/${S.SEASON.levels}</small></span></span>
    <span class="hub-pass-f">${s.ready ? `<span class="hub-claim">${ic('gift')} Забрати нагороди · ${s.ready}</span>` : `<span class="muted">${ic('clock')} до кінця ${untilSpan(s.endsAt)}</span>`}<span class="muted">нагороди ${ic('chevron-right')}</span></span></button>` : '';
  // ---- live tiles
  const act = evActive(), nextEv = (me.gameEvents?.next || []).filter((e) => e.start > serverNow())[0];
  const evInfo = act.length ? `<span class="acc">${esc(act[0].title)}</span>${act.length > 1 ? ` +${act.length - 1}` : ''} · ${untilSpan(act[0].end)}` : nextEv ? `${esc(nextEv.title)} через ${untilSpan(nextEv.start)}` : 'за розкладом';
  const qReady = C.quests ? C.quests.ready : me.questReady || 0;
  const coll = claimableCollection();
  const tiles = [
    hubTile({ page: 'quests', icon: 'target-arrow', c: Y, title: 'Завдання', id: 'hubQuests', badge: qReady, info: C.quests ? `день ${C.quests.done}/${C.quests.total} · тиж. ${C.quests.wk}` : 'щоденні й тижневі' }),
    `<button class="hub-t tall${act.length ? ' live' : ''}" data-act="eventsOpen" style="--c:${act[0]?.color || AM}"><span class="hub-ic">${ic(act[0]?.icon || 'calendar')}</span><span class="hub-tx"><b>Події</b><span class="hub-i">${evInfo}</span></span>${act.length ? '<span class="hub-live">наживо</span>' : ''}</button>`,
    hubTile({ page: 'collection', icon: 'books', c: BL, title: 'Колекція', badge: coll, info: `${have}/${total} машин${setsReady() ? ` · <span class="acc">сет готовий</span>` : ''}`, extra: `<span class="hub-bar"><i style="width:${(have / total) * 100}%"></i></span>` }),
    hubTile({ page: 'achievements', icon: 'diamond', c: PU, title: 'Досягнення', id: 'hubAch', badge: me.achReady || 0, info: C.ach ? `${C.ach.done}/${C.ach.total} рівнів` : 'рівні й бейджі' }),
    hubTile({ page: 'leaderboard', icon: 'trophy', c: AM, title: 'Рейтинг', id: 'hubLb', info: C.place ? `#${C.place} у сезоні` : `топ-10 — ${ic('star')} зірки` }),
    hubTile({ page: 'friends', icon: 'users', c: GR, title: 'Друзі', id: 'hubFr', info: C.friends != null ? `запрошено ${C.friends} · +${S.short(S.REF_REWARD)}` : `+${S.short(S.REF_REWARD)} за друга` }),
  ];
  const trade = [
    hubTile({ page: 'market', k: 'market', icon: 'building-store', c: GR, title: 'Ринок', size: 'mini' }),
    hubTile({ page: 'trades', k: 'trades', icon: 'arrows-exchange', c: BL, title: 'Обміни', size: 'mini', badge: me.incomingTrades }),
    hubTile({ page: 'tradein', k: 'tradein', icon: 'refresh', c: AM, title: 'Трейд-ін', size: 'mini' }),
    hubTile({ page: 'plates', k: 'plates', icon: 'license', c: Y, title: 'Номери', size: 'mini', info: me.plates.length ? String(me.plates.length) : '' }),
  ];
  const risk = [
    hubTile({ page: 'battles', k: 'battles', icon: 'flame', c: RD, title: 'Кейс-батли', size: 'wide', info: 'кейси наввипередки' }),
    hubTile({ page: 'upgrade', k: 'upgrade', icon: 'arrow-big-up-lines', c: PU, title: 'Апгрейд', size: 'wide', info: casinoOff() || !isOpen('casino') ? 'машини → дорожча' : 'і казино · 18+' }),
  ];
  const store = `<button class="hub-store" data-act="go" data-page="store"><span class="hub-ic">${ic('crown')}</span><span class="grow"><b>Магазин</b><span class="hub-i">${me.vip ? `VIP ще ${untilSpan(me.vipUntil)} · «Стиль»` : 'VIP-підписка, «Стиль», пропуск'}</span></span>${me.stars ? `<span class="hc">${ic('star')} ${me.stars}</span>` : ''}<span class="chev">${ic('chevron-right')}</span></button>`;
  const line = (act, page, icon, title, sub = '', count = 0) => `<button class="li" data-act="${act}" data-page="${page}"><span class="mi" style="--c:${ST}">${ic(icon)}</span><b>${title}</b>${count ? `<span class="cnt" style="margin-left:auto">${count}</span>` : `<span class="sub">${sub}</span>`}<span class="chev">${ic('chevron-right')}</span></button>`;
  const help = [
    line('go', 'promo', 'ticket', 'Промокод', 'коди — у каналі'),
    ...(config.community?.channel ? [line('openLink', config.community.channel, 'share', 'Канал з анонсами', 'новини й коди')] : []),
    ...(config.community?.chat ? [line('openLink', config.community.chat, 'users', 'Чат гравців')] : []),
    line('go', 'support', 'info-circle', 'Підтримка', 'написати нам'),
    line('howTo', '', 'player-play', 'Як грати', `${S.INTRO_STORY.slides.length} ${plural(S.INTRO_STORY.slides.length, ['слайд', 'слайди', 'слайдів'])}`),
    line('go', 'fair', 'shield-check', 'Чесна гра', 'перевір будь-який дроп'),
    line('settingsOpen', '', 'settings', 'Налаштування', 'звук, підказки, бот'),
    ...(me.admin ? [line('openAdmin', '', 'adjustments', 'Адмін-панель')] : []),
  ];
  const H2 = (t, r = '') => `<div class="hub-h"><span>${t}</span>${r ? `<span>${r}</span>` : ''}</div>`;
  const nextLock = S.UNLOCKS.find((u) => !isOpen(u.key) && !(u.key === 'casino' && casinoOff()));
  return `<div class="hub">${head}${pass}${homeCard()}
    ${H2('Нагороди й прогрес')}<div class="hub-grid g2">${tiles.join('')}</div>${challengeHubRow()}
    ${H2('Торгівля', nextLock && ['market', 'trades', 'tradein', 'plates'].includes(nextLock.key) ? `${ic('lock')} далі: ${nextLock.name} · рів. ${nextLock.level}` : '')}<div class="hub-grid g4">${trade.join('')}</div>
    ${H2('Ризикнути')}<div class="hub-grid g2">${risk.join('')}</div>
    ${H2('Магазин')}${store}
    ${H2('Допомога й налаштування')}<div class="list menu-list">${help.join('')}</div></div>`;
};
// Fills the live numbers of the hub without re-rendering it (and keeps them 30 s for the next visit).
AFTER.menu = async () => {
  tickUntil();
  const C = state.hub;
  if (C && Date.now() - C.at < 30e3) return;
  const [q, w, a, lb, fr, car] = await Promise.allSettled([api('quests'), api('weekly'), api('achievements'), api('leaderboard', { type: 'season' }), api('ref'), api('boss/list')]);
  const v = (r) => (r.status === 'fulfilled' ? r.value : null);
  const n = { at: Date.now() };
  if (v(q)) {
    const l = v(q).list, wk = v(w);
    n.quests = { done: l.filter((x) => x.claimed || x.progress >= x.target).length, total: l.length,
      ready: l.filter((x) => !x.claimed && x.progress >= x.target).length + (wk ? wk.list.filter((x) => !x.claimed && x.progress >= x.target).length + wk.chests.filter((c) => c.ready && !c.claimed).length : 0),
      wk: wk ? `${wk.list.filter((x) => x.claimed).length}/${wk.list.length}` : '—' };
  }
  if (v(a)) n.ach = { done: achDone(v(a).list), total: achTotal() };
  if (v(lb)?.me?.place) n.place = v(lb).me.place;
  if (v(fr)) n.friends = v(fr).invited;
  if (v(car)) n.career = { beaten: v(car).beaten, total: v(car).total };
  state.hub = n;
  if (n.quests) me.questReady = n.quests.ready;
  // Still on the menu: swap only the tiles (no scroll jump, no flicker).
  if (state.tab !== 'menu' || state.page) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = TABS.menu();
  for (const id of ['hubQuests', 'hubAch', 'hubLb', 'hubFr', 'hubCareer']) {
    const el = $('#' + id), nw = tmp.querySelector('#' + id);
    if (el && nw && el.innerHTML !== nw.innerHTML) (el.replaceWith(nw), nw.classList.add('upd'));
  }
  renderHeader();
};
function settingsSheet() {
  const GR = '#2fd27a', Y = '#ffc400', ST = '#8a94a7', BL = '#3b82f6';
  sheet('Налаштування', `<div class="list menu-list settings">
      <div class="li"><span class="mi" style="--c:${GR}">${ic('volume')}</span><div class="grow"><b>Звук</b><div class="tiny muted">На цьому пристрої</div></div><button class="toggle ${SFX.isOn() ? 'on' : ''}" data-act="toggleSound" aria-label="Звук" aria-pressed="${SFX.isOn()}"></button></div>
      <div class="li"><span class="mi" style="--c:${Y}">${ic('target-arrow')}</span><div class="grow"><b>Підказки перших кроків</b><div class="tiny muted">Смужка «Перші кроки» для новачка</div></div><button class="toggle ${me.claims.includes('guide-off') ? '' : 'on'}" data-act="toggleGuide" aria-label="Підказки перших кроків"></button></div>
      <div class="li"><span class="mi" style="--c:${ST}">${ic('bell')}</span><div class="grow"><b>Не турбувати</b><div class="tiny muted">Без запрошень на обмін і гонку</div></div><button class="toggle ${me.noInvites ? 'on' : ''}" data-act="toggleDnd" aria-label="Не турбувати"></button></div>
      <div class="li"><span class="mi" style="--c:${BL}">${ic('clock')}</span><div class="grow"><b>Нагадування від бота</b><div class="tiny muted">${me.pushOn && me.pushBlocked ? 'Бот не може написати — відкрий чат з ботом і натисни /start' : 'Бак, дохід, бонус — до 2 разів на день, не вночі'}</div></div><button class="toggle ${me.pushOn ? 'on' : ''}" data-act="togglePush" aria-label="Нагадування від бота"></button></div>
      <div class="li"><span class="mi" style="--c:${Y}">${ic('copy')}</span><div class="grow"><div class="tiny muted">Твій ID для обмінів</div><b class="disp">${me.id}</b></div><button class="btn sm ghost" data-act="copyId">Копіювати</button></div></div>`);
}
H.settingsOpen = () => settingsSheet();
H.howTo = () => playStory(S.INTRO_STORY);
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
// Two views: the cars (with milestones and countries) and the themed sets that cut across countries.
PAGES.collection = () => {
  const ready = setsReady();
  const seg = `<div class="seg">${[['cars', 'Машини', 0], ['sets', 'Сети', ready]].map(([k, t, n]) => `<button class="${(state.collTab || 'cars') === k ? 'on' : ''}" data-act="collTab" data-k="${k}">${t}${n ? `<span class="sets-dot">${n}</span>` : ''}</button>`).join('')}</div>`;
  return seg + (state.collTab === 'sets' ? setsView() : collectionCars());
};
H.collTab = (d) => (state.collTab = d.k, render());
const collectionCars = () => {
  const owned = new Set(me.collection);
  const n = me.collection.filter((id) => !M(id)?.secret).length;
  const totalReg = S.ALL_MODELS.filter((m) => !m.secret).length;
  const ms = S.COLLECTION_MILESTONES;
  const rows = [
    ...ms.map((m) => ({ key: S.milestoneId(m), done: S.milestoneTaken(m, me.claims), title: m.label || `Збери ${m.n} машин`, sub: rewardText({ money: m.money, slots: m.slots }), have: Math.min(n, m.n), need: m.n, ic: ic('car') })),
    ...S.MAIN_COUNTRIES.map((c) => {
      const list = S.countryModels(c);
      return { key: 'c' + c, title: `Усі машини: ${S.COUNTRIES[c].name}`, sub: `+${S.short(S.COUNTRY_REWARD[c])} · секретна машина`, have: list.filter((m) => owned.has(m.id)).length, need: list.length, ic: S.COUNTRIES[c].flag };
    }),
  ];
  const visible = state.collAll ? rows : rows.filter((r) => !(r.done ?? me.claims.includes(r.key))).slice(0, 3);
  const filter = state.collFilter, missing = state.collMissing;
  const pool = S.ALL_MODELS.filter((m) => !m.season || owned.has(m.id));
  const models = pool.filter((m) => !filter || m.country === filter);
  const pctAll = Math.round((n / totalReg) * 100);
  // Summary: a ring with the share collected and one bar per class, like a parts list on a spec sheet.
  const clsBars = S.CLASS_ORDER.filter((c) => c !== 'X').map((c) => {
    const l = pool.filter((m) => m.cls === c && !m.secret), h = l.filter((m) => owned.has(m.id)).length;
    return `<div class="cbar" style="--c:${S.CLASSES[c].color}">${clsBadge(c)}<i><b style="width:${l.length ? (h / l.length) * 100 : 0}%"></b></i><span>${h}<small>/${l.length}</small></span></div>`;
  }).join('');
  const R = 34, C = 2 * Math.PI * R;
  const countryCount = (c) => {
    const l = pool.filter((m) => m.country === c && !m.secret);
    return [l.filter((m) => owned.has(m.id)).length, l.length];
  };
  const tile = (m) => {
    const own = owned.has(m.id), r = S.rankOf(m.cls), col = S.CLASSES[m.cls].color;
    return `<div class="ctile r${r} ${own ? '' : 'off'}" style="--c:${col}"><div class="art">${carArt(m.id, { silhouette: !own })}</div>
      <b class="ellipsis">${own ? esc(m.name) : m.secret ? 'Секретна' : '???'}</b><span class="ellipsis">${m.season ? `Сезон ${m.season}` : m.secret && !own ? `збери: ${S.COUNTRIES[m.country].name}` : originText(m)}</span></div>`;
  };
  return `<div class="card coll-sum"><div class="coll-ring"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="${R}" fill="none" stroke="#0b0f16" stroke-width="7"/><circle cx="40" cy="40" r="${R}" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C * n) / totalReg} ${C}" transform="rotate(-90 40 40)"/></svg><b>${pctAll}<small>%</small></b></div>
      <div class="grow"><div class="row between"><b class="disp">Зібрано</b><span class="muted small"><b style="color:var(--text)">${n}</b> з ${totalReg}</span></div><div class="cbars">${clsBars}</div></div></div>
    <div class="h2"><span>Нагороди за колекцію</span></div>
    <div class="list">${visible.map((r) => {
      const done = r.done ?? me.claims.includes(r.key);
      const ready = !done && r.have >= r.need;
      return `<div class="li"><span class="ic">${r.ic}</span><div class="grow"><b>${esc(r.title)}</b><div class="small muted">${esc(r.sub)}</div><div class="progress mt"><i style="width:${(r.have / r.need) * 100}%"></i></div></div>
        ${done ? '<span class="win">✓</span>' : ready ? `<button class="btn sm yellow" data-act="collClaim" data-k="${r.key}">Забрати</button>` : `<span class="small muted">${r.have}/${r.need}</span>`}</div>`;
    }).join('')}
    <button class="li" data-act="collAll" style="justify-content:center;color:#f5b301;font-weight:700">${state.collAll ? 'Згорнути' : `Показати всі · ще ${rows.length - visible.length}`}</button></div>
    <div class="h2"><span>Машини</span><button class="gsort" data-act="collMissing">${ic(missing ? 'books' : 'lock')}${missing ? 'Усі машини' : 'Лише відсутні'}</button></div>
    <div class="chips cchips"><button class="${!filter ? 'on' : ''}" data-act="collFilter" data-k="">Усі</button>${S.MAIN_COUNTRIES.map((c) => {
      const [h, l] = countryCount(c);
      return `<button class="${filter === c ? 'on' : ''} ${h === l ? 'full' : ''}" data-act="collFilter" data-k="${c}">${S.COUNTRIES[c].flag} ${S.COUNTRIES[c].name}<small>${h === l ? ic('check') : `${h}/${l}`}</small></button>`;
    }).join('')}</div>
    ${S.CLASS_ORDER.map((cls) => {
      const all = models.filter((m) => m.cls === cls);
      const list = missing ? all.filter((m) => !owned.has(m.id)) : all;
      if (!all.length) return '';
      const h = all.filter((m) => owned.has(m.id)).length;
      return `<div class="cgroup" style="--c:${S.CLASSES[cls].color}"><div class="cgroup-h">${clsBadge(cls)}<b>${cls === 'X' ? 'Секретні' : S.CLASSES[cls].name}</b><i><b style="width:${(h / all.length) * 100}%"></b></i><span>${h}/${all.length}</span></div>
        ${list.length ? `<div class="cgrid">${list.map(tile).join('')}</div>` : `<div class="cgroup-done">${ic('check')} Усі машини класу ${cls} зібрано</div>`}</div>`;
    }).join('')}`;
};
H.collMissing = () => (state.collMissing = !state.collMissing, render());
H.collClaim = (d) => act('collection/claim', { key: d.k }, (r) => `Отримано: ${S.short(r.reward.money)}${r.reward.secret ? ' + секретна машина!' : ''}`).then(wowSecret);
H.collAll = () => (state.collAll = !state.collAll, render());
H.collFilter = (d) => (state.collFilter = d.k, render());

// ---------- collection sets (S.SETS) ----------
// Progress comes from me.collection (models ever found) and me.claims ("set:<id>"), so no extra request is needed.
const SET_TIER_COLORS = ['#cd7f32', '#c0c7d1', '#ffcc33', '#7ee8fa'];
function setsReady() {
  if (!me) return 0;
  const owned = new Set(me.collection);
  return S.SETS.filter((s) => !me.claims.includes('set:' + s.id) && S.setProgress(s, owned).done).length;
}
function setsView() {
  const owned = new Set(me.collection);
  const rows = S.SETS.map((s, i) => ({ s, i, p: S.setProgress(s, owned), claimed: me.claims.includes('set:' + s.id) }));
  const done = rows.filter((r) => r.claimed).length;
  // Ready to claim first, then the closest to done, finished ones last; ties keep the list order (easy → hard).
  const rank = (r) => (r.claimed ? 2 : r.p.done ? 0 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? b.p.have / b.p.need - a.p.have / a.p.need : 0) || a.i - b.i);
  const card = ({ s, p, claimed }) => {
    const col = SET_TIER_COLORS[s.tier], ready = p.done && !claimed;
    const thumbs = s.models.map((id) => {
      const m = M(id), own = owned.has(id);
      return `<div class="set-car ${own ? 'own' : 'miss'} r${S.rankOf(m.cls)}" style="--c:${S.CLASSES[m.cls].color}" title="${own ? esc(m.name) : '???'}"><div class="art">${carArt(id, { silhouette: !own })}</div>
        <span class="ellipsis">${own ? esc(m.name) : `${S.COUNTRIES[m.country].flag} ${m.cls} · ???`}</span></div>`;
    }).join('');
    return `<div class="card set-card ${ready ? 'ready' : ''} ${claimed ? 'claimed' : ''}" style="--tc:${col}">
      <div class="set-head"><span class="set-ic">${ic(s.icon)}</span><div class="grow"><b class="disp">${esc(s.name)}</b><div class="tiny muted">${esc(s.text)}</div></div>
        <span class="set-tier">${ic('trophy')}${S.SET_TIERS[s.tier].name}</span></div>
      <div class="set-prog"><div class="progress"><i style="width:${(p.have / p.need) * 100}%"></i></div><span><b>${p.have}</b>/${p.need}</span></div>
      <div class="set-cars">${thumbs}</div>
      <div class="set-foot"><div class="tiny set-rw">${ic('gift')} ${esc(S.setRewardText(s))}</div>
        ${claimed ? `<span class="set-got">${ic('check')} Отримано</span>` : ready ? `<button class="btn sm yellow" data-act="setClaim" data-id="${s.id}">Забрати</button>` : `<span class="tiny muted set-left">ще ${p.need - p.have}</span>`}</div></div>`;
  };
  return `<div class="card set-sum"><div class="grow"><b class="disp">Тематичні сети</b><div class="tiny muted">Машини з різних країн за однією темою. Рахуються всі знайдені моделі — навіть ті, що вже продані. За кожен сет — значок у ліцензію пілота, ключ, деталі й бонус до доходу його машин.</div></div>
      <div class="set-count"><b>${done}</b><small>/${S.SETS.length}</small></div></div>
    ${rows.map(card).join('')}`;
}
H.setClaim = async (d) => {
  const s = S.SET_BY_ID[d.id];
  const r = await act('sets/claim', { id: d.id }, null);
  if (!r) return;
  const rw = r.reward;
  const list = [
    rw.keys ? `${ic('key')} Ключ «${S.CASE_BY_ID[rw.caseId].name}»` : '',
    rw.frag ? `${ic('key')} ${rw.frag} фрагменти ключа «${S.CASE_BY_ID[rw.caseId].name}»${rw.newKeys ? ` (+${rw.newKeys} ключ)` : ''}` : '',
    ...(rw.items || []).map((it) => `${ic('engine')} ${esc(S.partLabel(it.type, it.tier))}`),
    `${ic('coin')} +${Math.round(rw.income * 100)}% доходу машинам сету`,
  ].filter(Boolean);
  sheet('Сет зібрано!', `<div class="card center reward-res pop set-done" style="--tc:${SET_TIER_COLORS[s.tier]}">
      <div class="set-cars mini">${s.models.map((id) => `<div class="set-car own"><div class="art">${carArt(id)}</div></div>`).join('')}</div>
      <span class="set-medal">${ic(s.icon)}</span><b class="disp rr-name">${esc(s.name)}</b>
      <span class="lstamp" style="--bc:${SET_TIER_COLORS[s.tier]}">${ic('trophy')}${esc(rw.badge)}</span>
      <div class="set-rw-list">${list.map((x) => `<div>${x}</div>`).join('')}</div>
      ${rewardKeysBtn(rw.caseId, (rw.keys || 0) + (rw.newKeys || 0), `Сет «${s.name}»`)}
      <div class="tiny muted mt">Значок уже у твоїй ліцензії пілота</div></div>`);
  celebrateSheet($('#sheet .set-medal'), [SET_TIER_COLORS[s.tier] || '#ffd500', '#ffd500', '#ffffff'], { confetti: 0.9 });
};

// ---------- plates ----------
PAGES.plates = () => {
  const seg = `<div class="seg">${[['gen', 'Генерація'], ['mine', `Мої · ${me.plates.length}`]].map(([k, t]) => `<button class="${state.plateView === k ? 'on' : ''}" data-act="plateView" data-k="${k}">${t}</button>`).join('')}</div>`;
  if (state.plateView === 'mine') {
    return seg + (me.plates.length ? `<div class="list plates-list">${me.plates.map((p) => {
      const c = p.carId && me.cars.find((x) => x.id === p.carId);
      // Plate and value on top, where it is (region, car) under it, the actions as one row of equal buttons.
      return `<div class="li prow2" style="--c:${S.CLASSES[p.cls].color}">${plate(p.text)}<div class="pr-val">${clsBadge(p.cls)}<b class="disp">${S.short(p.value)}</b></div>
        <div class="pr-meta tiny"><span class="muted">${esc(S.regionOf(p.text) || '')}</span><span class="ellipsis ${c ? 'on-car' : 'muted'}">${c ? `${ic('car')} ${esc(M(c.model).name)}` : 'не встановлено'}</span></div>
        <div class="pr-act">${c ? `<button class="btn sm ghost" data-act="plateDetach" data-pid="${p.id}">Зняти з машини</button>` : `<button class="btn sm" data-act="plateToCar" data-pid="${p.id}">${ic('car')} Повісити</button><button class="btn sm ghost" data-act="plateSell" data-pid="${p.id}">${ic('cash')} Продати · ${S.short(p.value / 2)}</button>`}</div></div>`;
    }).join('')}</div>` : emptyBox('license', 'Номерів поки немає', 'Згенеруй перший — кожен номер існує в одному екземплярі', '<button class="btn sm" data-act="plateView" data-k="gen">Згенерувати</button>'));
  }
  const gen = S.PLATE_GEN.find((g) => g.id === (state.plateGen || 'basic'));
  const reg = state.plateRegion;
  const d = state.plateDrop;
  const dc = d ? S.CLASSES[d.cls].color : '';
  return seg + `<div class="plate-stand ${d ? `r${S.rankOf(d.cls)}` : ''}" id="plateStage" style="${d ? `--c:${dc}` : ''}">${plate(d ? d.text : 'AA 0000 AA', 'lg')}</div>
    ${d ? `<div class="center plate-res ${state.fx?.type === 'plate' ? 'pop' : ''}"><span class="stamp r${S.rankOf(d.cls)}" style="--c:${dc}"><b>${d.cls}</b>${S.CLASSES[d.cls].name}</span><div class="big mt ${S.rankOf(d.cls) >= 3 ? 'shimmer' : ''}" style="--c:${dc}" id="plateValue">${S.fmt(d.value)}</div><div class="small muted">${esc(d.label)} · ${esc(S.regionOf(d.text) || '—')}</div></div>
      <div class="btns mt"><button class="btn outline" data-act="plateToCar" data-pid="${d.id}">${ic('car')} Повісити</button><button class="btn red" data-act="plateSell" data-pid="${d.id}">Продати · ${S.short(d.value / 2)}</button></div>` : ''}
    ${eventStrip(['plates'])}<button class="btn opencase mt" data-act="genPlate" id="genBtn"><span class="oc-l">${d ? 'Ще раз' : 'Згенерувати'}</span><span class="oc-p">${reg ? `${reg} · ${S.fmt(S.platePriceOf(S.regionPrice(reg), 'region', evFx()))}` : S.fmt(S.platePriceOf(gen.price, gen.id, evFx()))}</span></button>
    <div class="list mt"><button class="li" data-act="regionPick"><span class="ic">${ic('world')}</span><div class="grow"><b>Регіон</b><div class="small muted">${reg ? `${reg} · ${esc(S.REGIONS[reg])}` : 'будь-який — випадковий'}</div></div>${reg ? `<span class="regcode on sm"><b>${reg}</b></span><span class="chip" data-act="regionClear">${ic('x')}</span>` : `<span class="chev">${ic('chevron-right')}</span>`}</button></div>
    ${reg ? `<div class="card mt"><b>Номер області ${reg}</b><div class="small muted">Клас — повний рандом: від звичайного до міфічного, як пощастить</div><div class="mt">${oddsBar(S.REGION_GEN.weights)}</div>${dots(S.REGION_GEN.weights)}</div>` : `<div class="h2"><span>Генерація номера</span></div>
    <div class="list cases-list">${S.PLATE_GEN.map((g) => `<button class="li ${g.id === gen.id ? 'on' : ''}" data-act="pickGen" data-id="${g.id}" style="--c:${S.CLASSES[S.CLASS_ORDER.filter((k) => g.weights[k]).pop()].color}"><span class="ic">${ic(g.id === 'basic' ? 'license' : g.id === 'better' ? 'star' : 'sparkles')}</span><div class="grow"><b>${g.name}</b>${oddsBar(g.weights)}${dots(g.weights)}</div><div class="center"><b>${S.platePriceOf(g.price, g.id, evFx()) < g.price ? `<span style="color:var(--accent)">${S.short(S.platePriceOf(g.price, g.id, evFx()))}</span>` : S.short(g.price)}</b></div></button>`).join('')}</div>`}
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
    ${rows.map((r) => `<div class="li reg-row"><div class="grow"><b>${esc(r.name)}</b></div><span class="row" style="gap:6px">${r.codes.map((c) => `<button class="regcode ${state.plateRegion === c ? 'on' : ''}" data-act="regionSet" data-k="${c}"><b>${c}</b><small>${S.short(S.regionPrice(c)).replace(' ₴', '')}</small></button>`).join('')}</span></div>`).join('') || emptyBox('world', 'Нічого не знайдено', 'Спробуй код (KA) або частину назви')}</div>`;
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
      if (rank >= 2 && i === cells.length - 2) setTimeout(() => (plateEl.classList.add('tension'), SFX.tease(extra + 1400), haptic('light')), 900 + i * 220 - 200);
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
          SFX.land(i);
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
  else FX.popEl(plateEl, 1.08, 380);
  FX.celebrate(rank, color, { target: plateEl });
  FX.countUp($('#plateValue'), p.value, 900, S.fmt);
  haptic(rank >= 3 ? 'heavy' : 'success');
  SFX.pop(rank);
  if (rank >= 3) setTimeout(() => SFX.rare(rank), 100);
};
H.plateToCar = (d) => pickCar('На яку машину?', (carId) => act('plate/attach', { plateId: Number(d.pid), carId }, 'Номер встановлено').then(() => (state.plateDrop = null)), (c) => c.status === 'garage' || c.status === 'showcase');
H.plateSell = async (d) => {
  if (await act('plate/sell', { plateId: Number(d.pid) }, (r) => `+${S.fmt(r.got)}`)) state.plateDrop = null, render();
};

// ---------- market ----------
PAGES.market = async () => {
  state.marketKind ||= 'car';
  const kinds = `<div class="seg mk-kinds">${[['car', 'car', 'Машини'], ['part', 'engine', 'Деталі'], ['plate', 'license', 'Номери']].map(([k, i, t]) => `<button class="${state.marketKind === k ? 'on' : ''}" data-act="mKind" data-k="${k}">${ic(i)}${t}</button>`).join('')}</div>`;
  if (state.marketKind !== 'car') return kinds + (await itemMarket(state.marketKind));
  const seg = kinds + `<div class="seg">${[['buy', 'Купити'], ['auction', 'Аукціони'], ['mine', 'Мої лоти']].map(([k, t]) => `<button class="${state.marketTab === k ? 'on' : ''}" data-act="mTab" data-k="${k}">${t}</button>`).join('')}</div>`;
  const info = (c) => `<span class="chip">${partCount(c)}/${partSlots(c)} деталей</span>`;
  if (state.marketTab === 'buy') {
    const { list, dealer, now } = await api('market/list', { cls: state.marketCls, sort: state.marketSort });
    // Own lots stay in the list (marked), so a freshly listed car doesn't look like it vanished.
    const mineTag = '<span class="chip mine">твій лот</span>';
    const row = (l) => carRow(l.dealer ? l.car : withFrame(l.car, l.sellerStyle), l.mine ? `<button class="btn sm red" data-act="unlist" data-id="${l.id}">Зняти</button>`
      : `<button class="btn sm" data-act="buy" data-id="${l.id}" data-price="${l.price}" data-sell="${S.saleOf(l.car) ?? ''}" ${me.balance < l.price || (l.dealer && !dealer.left) ? 'disabled' : ''}>${S.short(l.price)}</button>`,
      // Seller, own-lot tag, parts and a «good deal» tag; the sale after buying and the collection price are on the
      // class line («продаж потім ≈»: what the dealer would pay for it right after).
      [l.mine ? mineTag : l.dealer ? '' : `<span class="seller">${nameHtml(l.seller, l.sellerStyle)}</span>`, l.dealer ? '' : info(l.car), !l.mine && l.price <= l.car.value * 1.05 ? `<span class="chip deal">${l.dealer ? 'акція' : 'вигідно'}</span>` : ''].join(''), !l.mine);
    const fromDealer = list.filter((l) => l.dealer), fromPlayers = list.filter((l) => !l.dealer);
    // No "X" filter: secret cars can never be on the market.
    return seg + `<div class="chips gfilter">${[['', 'Усі'], ...S.CLASS_ORDER.filter((c) => c !== 'X').map((c) => [c, c])].map(([k, t]) => `<button class="${state.marketCls === k ? 'on' : ''}" data-act="mCls" data-k="${k}" ${k ? `style="--c:${S.CLASSES[k].color}"` : ''}>${k ? '<i></i>' : ''}${t}</button>`).join('')}</div>
      <div class="chips sortchips">${[['new', 'Нові'], ['cheap', 'Дешевші'], ['expensive', 'Дорожчі'], ['deal', 'Вигідні']].map(([k, t]) => `<button class="${state.marketSort === k ? 'on' : ''}" data-act="mSort" data-k="${k}">${t}</button>`).join('')}</div>
      <div class="card dealer-head"><div class="row"><span class="ic tint" style="--c:#ffc400">${ic('building-store')}</span><div class="grow"><div class="row between"><b>Дилер АВТОДРОП</b><span class="chip">${ic('clock')} <span data-until="${dealer.nextAt - (now - Date.now())}"></span></span></div>
        <div class="small muted">Фіксовані ціни, нові лоти кожні ${S.DEALER.hours} год · покупок лишилось <b style="color:var(--text)">${dealer.left}/${dealer.perPlayer}</b></div>
        <div class="tiny muted hn-dnote">Ціни вищі за колекційні, а викуп — ${Math.round(Math.min(...Object.values(S.SELL_RATES)) * 100)}–${Math.round(Math.max(...Object.values(S.SELL_RATES)) * 100)}%: дивись «продаж потім».</div></div></div></div>
      ${fromDealer.length ? `<div class="list">${fromDealer.map(row).join('')}</div>` : emptyBox('building-store', 'Дилер усе розпродав', 'Нові лоти з’являться, щойно спливе таймер')}
      <div class="h2"><span>Від гравців</span><span>${fromPlayers.length}</span></div>
      ${fromPlayers.length ? `<div class="list">${fromPlayers.map(row).join('')}</div>` : emptyBox('car', 'Лотів поки немає', 'Виставити своє авто можна з картки машини → «Продати»')}`;
  }
  if (state.marketTab === 'auction') {
    const { list, now } = await api('auction/list');
    return seg + (list.length ? `<div class="list auctions">${list.map((a) => carRow(a.car, a.mine ? (a.bids ? `<span class="chip">${a.bids} ставок</span>` : `<button class="btn sm red" data-act="unauction" data-id="${a.id}">Скасувати</button>`) : `<button class="btn sm ${a.leading ? 'green' : ''}" data-act="bid" data-id="${a.id}" data-min="${a.minBid}">${a.leading ? 'Лідер' : 'Ставка'}</button>`,
      `${a.mine ? '<span class="chip mine">твій лот</span>' : ''}<span class="chip bidc">${a.topBid ? `${S.short(a.topBid)} · ${a.bids} ${plural(a.bids, ['ставка', 'ставки', 'ставок'])}` : `старт ${S.short(a.startPrice)}`}</span><span class="chip timec">${ic('clock')} <span data-until="${a.endsAt - (now - Date.now())}"></span></span>`, !a.mine)).join('')}</div>` : emptyBox('hammer', 'Активних аукціонів немає', 'Запусти свій: картка машини → «Продати» → «На аукціон»'));
  }
  const [m, a] = await Promise.all([api('market/list'), api('auction/list')]);
  const mine = m.list.filter((l) => l.mine), auc = a.list.filter((x) => x.mine);
  return seg + `<div class="tiny muted">Виставити авто можна з його картки в гаражі → «Продати».</div>
    <div class="h2"><span>На ринку</span><span>${mine.length}</span></div>${mine.length ? `<div class="list">${mine.map((l) => carRow(l.car, `<button class="btn sm red" data-act="unlist" data-id="${l.id}">Зняти</button>`, `<span class="chip mine">ціна ${S.short(l.price)}</span>`)).join('')}</div>` : emptyBox('building-store', 'Немає лотів на ринку', 'Свою ціну ставиш сам, комісія ' + S.FEE * 100 + '%')}
    <div class="h2"><span>Аукціони</span><span>${auc.length}</span></div>${auc.length ? `<div class="list">${auc.map((x) => carRow(x.car, x.bids ? `<span class="chip">${x.bids} ставок</span>` : `<button class="btn sm red" data-act="unauction" data-id="${x.id}">Скасувати</button>`, `<span class="chip bidc">${x.topBid ? `${S.short(x.topBid)} від ${esc(x.leader)}` : `старт ${S.short(x.startPrice)}`}</span><span class="chip timec">${ic('clock')} <span data-until="${x.endsAt - (a.now - Date.now())}"></span></span>`)).join('')}</div>` : emptyBox('hammer', 'Немає аукціонів', 'Торги тривають 1–24 год, ставка в останню хвилину продовжує')}`;
};
AFTER.market = () => {
  tickUntil();
  bindItemFilters();
};
H.mKind = (d) => (state.marketKind = d.k, render());

// ---------- market: parts and plates (S.ITEM_MARKET) ----------
// Tabs «Купити» / «Мої лоти»; parts filter by type and tier, plates by text, region and class; a green «вигідна ціна»
// chip when the piece price is ≤ 80 % of the reference (median of recent deals, or the base value).
let itemMine = [];
const itemTitle = (l) => (l.part ? `${S.partLabel(l.part.type, l.part.tier)}${l.count > 1 ? ` × ${l.count}` : ''}` : `номер ${l.plate.text}`);
const dealChip = (l) => (l.deal ? `<span class="chip deal">${ic('flame')}вигідна ціна${l.pct < 0 ? ` · ${l.pct}%` : ''}</span>` : '');
function itemRow(l, now) {
  const until = `${ic('clock')} <span data-until="${l.expiresAt - (now - Date.now())}"></span>`;
  const btn = l.mine ? `<button class="btn sm red" data-act="itemUnlist" data-id="${l.id}">Зняти</button>`
    : `<button class="btn sm" data-act="itemBuy" data-id="${l.id}" data-price="${l.price}" data-name="${esc(itemTitle(l))}" ${me.balance < l.price ? 'disabled' : ''}>${S.short(l.price)}</button>`;
  const who = l.mine ? '<span class="chip mine">твій лот</span>' : esc(l.seller);
  if (l.part) {
    const t = S.TIER_BY_ID[l.part.tier];
    return `<div class="li mk-item">${partArt(l.part.type, l.part.tier, 'sm')}<div class="grow"><b>${S.PARTS[l.part.type].name}</b>
      <div class="small"><span style="color:${S.CLASSES[t.cls].color}">${t.name}</span>${l.count > 1 ? ` × ${l.count} · ${S.short(l.unit)}/шт` : ''}</div>
      <div class="tiny muted">${S.partEffect(l.part.type, l.part.tier)} · база ${S.short(l.base)}</div>
      <div class="tiny muted">${who} · ${until}</div>${dealChip(l)}</div>${btn}</div>`;
  }
  return `<div class="li mk-item mk-plate">${plate(l.plate.text)}<div class="grow"><div class="small">${clsBadge(l.plate.cls)} ${esc(l.plate.label)}</div>
    <div class="tiny muted">${esc(l.plate.region || '')} · оцінка ${S.short(l.base)}</div>
    <div class="tiny muted">${who} · ${until}</div>${dealChip(l)}</div>${btn}</div>`;
}
const chipRow = (items, cur, actName) => `<div class="chips gfilter">${items.map(([k, t]) => `<button class="${(cur || '') === k ? 'on' : ''}" data-act="${actName}" data-k="${k}">${t}</button>`).join('')}</div>`;
async function itemMarket(kind) {
  const f = (state.itemF ||= { tab: 'buy', type: '', tier: '', cls: '', region: '', query: '', sort: 'new' });
  const r = await api('market/items', { kind, type: f.type, tier: f.tier, cls: f.cls, region: f.region, query: f.query, sort: f.sort });
  itemMine = r.mine;
  const seg = `<div class="seg">${[['buy', 'Купити'], ['mine', `Мої лоти · ${r.mine.length}/${r.maxLots}`]].map(([k, t]) => `<button class="${f.tab === k ? 'on' : ''}" data-act="itemTab" data-k="${k}">${t}</button>`).join('')}</div>`;
  const what = kind === 'part' ? 'деталь' : 'номер';
  const sellBtn = `<button class="btn outline" data-act="${kind === 'part' ? 'itemSellPart' : 'itemSellPlate'}" ${r.mine.length >= r.maxLots ? 'disabled' : ''}>${ic('plus')} Виставити ${what}</button>`;
  if (f.tab === 'mine') {
    return seg + `<div class="btns">${sellBtn}</div>
      <div class="tiny muted mt">Комісія ${S.FEE * 100}%. Ціна за штуку — від ${IMR(S.ITEM_MARKET.minRate)} до ${IMR(S.ITEM_MARKET.maxRate)} базової вартості. Лот висить ${S.ITEM_MARKET.hours} год, потім ${kind === 'part' ? 'деталі повертаються на склад' : 'номер знову вільний'}. Поки лот активний, деталь не поставити й не злити, а номер не повісити й не продати.</div>
      <div class="h2"><span>Мої лоти</span><span>${r.mine.length}</span></div>
      ${r.mine.length ? `<div class="list">${r.mine.map((l) => itemRow(l, r.now)).join('')}</div>` : emptyBox(kind === 'part' ? 'engine' : 'license', 'Твоїх лотів немає', `Виставлена ${what} висить ${S.ITEM_MARKET.hours} год`)}`;
  }
  const sort = chipRow([['new', 'Нові'], ['cheap', 'Дешевші'], ['expensive', 'Дорожчі'], ['deal', 'Вигідні']], f.sort, 'itemSort');
  const filters = kind === 'part'
    ? chipRow([['', 'Усі деталі'], ...S.PART_KEYS.map((k) => [k, S.PARTS[k].name])], f.type, 'itemType') + chipRow([['', 'Усі рівні'], ...S.TIERS.map((t) => [t.id, t.name])], f.tier, 'itemTier')
    : `<div class="mk-search"><input id="mq" placeholder="Пошук: 7777, KA 00…" value="${esc(f.query)}" autocomplete="off" enterkeyhint="search">
        <select id="mReg" aria-label="Регіон"><option value="">Усі регіони</option>${S.REGION_LIST.map((g) => `<option value="${esc(g.name)}" ${f.region === g.name ? 'selected' : ''}>${esc(g.name)} · ${g.codes.join('/')}</option>`).join('')}</select></div>`
      + chipRow([['', 'Усі класи'], ...Object.keys(S.PLATE_VALUE).map((c) => [c, `${c} · ${S.CLASSES[c].name}`])], f.cls, 'itemCls');
  const filtered = f.type || f.tier || f.cls || f.region || f.query;
  const empty = filtered ? emptyBox('adjustments', 'За цим фільтром лотів немає', 'Спробуй інший рівень, клас чи регіон')
    : emptyBox(kind === 'part' ? 'engine' : 'license', 'Лотів поки немає', `Свої ${kind === 'part' ? 'деталі' : 'номери'} можна виставити у вкладці «Мої лоти»`);
  return seg + filters + sort + `<div class="h2"><span>${kind === 'part' ? 'Деталі від гравців' : 'Номери від гравців'}</span><span>${r.list.length}</span></div>
    ${r.list.length ? `<div class="list">${r.list.map((l) => itemRow(l, r.now)).join('')}</div>` : empty}`;
}
const IMR = (x) => `${Math.round(x * 100)}%`;
let mqTimer;
function bindItemFilters() {
  const q = $('#mq');
  if (q) {
    if (state.itemF?.focus) {
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
      state.itemF.focus = false;
    }
    q.addEventListener('input', () => {
      clearTimeout(mqTimer);
      mqTimer = setTimeout(() => {
        state.itemF.query = q.value.slice(0, 16);
        state.itemF.focus = true;
        render();
      }, 350);
    });
  }
  $('#mReg')?.addEventListener('change', (e) => (state.itemF.region = e.target.value, render()));
}
H.itemTab = (d) => (state.itemF.tab = d.k, render());
H.itemSort = (d) => (state.itemF.sort = d.k, render());
H.itemType = (d) => (state.itemF.type = d.k, render());
H.itemTier = (d) => (state.itemF.tier = d.k, render());
H.itemCls = (d) => (state.itemF.cls = d.k, render());
H.itemBuy = async (d) => (await confirmBox(`Купити «${d.name}» за ${S.fmt(Number(d.price))}?`)) && act('market/item-buy', { id: Number(d.id) }, (r) => (r.part ? 'Деталі вже на складі!' : 'Номер твій! Повісь його на машину в «Номерах»'));
H.itemUnlist = (d) => act('market/item-cancel', { id: Number(d.id) }, 'Лот знято — усе повернулося');
// Listing a part: pick a free (not cooling) part from the warehouse, then count and price per piece.
H.itemSellPart = () => {
  const list = me.parts.filter((p) => p.available > 0).sort((a, b) => S.TIER_BY_ID[b.tier].index - S.TIER_BY_ID[a.tier].index);
  const cooling = me.parts.filter((p) => p.cooling > 0).length;
  sheet('Виставити деталь', `${list.length ? `<div class="list">${list.map((p) => `<button class="li" data-act="itemSellPartPick" data-type="${p.type}" data-tier="${p.tier}">${partArt(p.type, p.tier, 'sm')}<div class="grow"><b>${S.PARTS[p.type].name}</b><div class="small muted">${S.TIER_BY_ID[p.tier].name} · вільних ${p.available}</div></div><span class="chev">${ic('chevron-right')}</span></button>`).join('')}</div>` : '<div class="empty">На складі немає вільних деталей</div>'}
    ${cooling ? '<div class="tiny muted">Щойно зняті з машини деталі остигають — їх виставити не можна, доки не охолонуть.</div>' : ''}`);
};
H.itemSellPartPick = (d) => {
  const p = me.parts.find((x) => x.type === d.type && x.tier === d.tier);
  if (!p) return;
  const base = S.TIER_BY_ID[p.tier].price, [lo, hi] = S.itemPriceRange(base);
  const max = Math.min(p.available, S.ITEM_MARKET.maxCount);
  sheet('Виставити деталь', `<div class="li">${partArt(p.type, p.tier, 'sm')}<div class="grow"><b>${S.partLabel(p.type, p.tier)}</b><div class="small muted">${S.partEffect(p.type, p.tier)} · база ${S.fmt(base)}</div></div></div>
    <label class="fld mt" for="itCount">Кількість (до ${max})</label><input id="itCount" inputmode="numeric" value="1">
    <label class="fld mt" for="itPrice">Ціна за штуку, ₴</label><input id="itPrice" inputmode="numeric" value="${grp(base)}">
    <div class="tiny muted mt">Від ${S.fmt(lo)} до ${S.fmt(hi)} за штуку · комісія ${S.FEE * 100}% · лот на ${S.ITEM_MARKET.hours} год</div>
    <button class="btn mt" data-act="itemDoSellPart" data-type="${p.type}" data-tier="${p.tier}">Виставити</button>`, H.itemSellPart);
};
H.itemDoSellPart = async (d) => {
  const count = Math.max(1, Math.round(num($('#itCount').value) || 1)), unit = num($('#itPrice').value);
  if (await act('market/item-sell', { kind: 'part', type: d.type, tier: d.tier, count, price: unit * count }, 'Деталь на ринку')) closeModal();
};
// Listing a plate: not one already listed, not one on a car that is itself on the market (those can't be taken off).
H.itemSellPlate = () => {
  const listed = new Set(itemMine.filter((l) => l.plate).map((l) => l.plate.id));
  const list = me.plates.filter((p) => !listed.has(p.id)).filter((p) => {
    const c = p.carId && me.cars.find((x) => x.id === p.carId);
    return !c || c.status === 'garage' || c.status === 'showcase';
  });
  sheet('Виставити номер', list.length ? `<div class="list">${list.map((p) => {
    const c = p.carId && me.cars.find((x) => x.id === p.carId);
    return `<button class="li" data-act="itemSellPlatePick" data-pid="${p.id}">${plate(p.text)}<div class="grow small">${clsBadge(p.cls)} ${S.short(p.value)}<div class="tiny muted ellipsis">${c ? `на ${esc(M(c.model).name)} — зніметься` : 'вільний'}</div></div><span class="chev">${ic('chevron-right')}</span></button>`;
  }).join('')}</div>` : '<div class="empty">Немає номерів, які можна виставити</div>');
};
H.itemSellPlatePick = (d) => {
  const p = me.plates.find((x) => x.id === Number(d.pid));
  if (!p) return;
  const c = p.carId && me.cars.find((x) => x.id === p.carId);
  const [lo, hi] = S.itemPriceRange(p.value);
  sheet('Виставити номер', `<div class="center" style="padding:10px 0">${plate(p.text, 'lg')}</div>
    <div class="center small">${clsBadge(p.cls)} ${esc(S.plateInfo(p.text).label)} · оцінка ${S.fmt(p.value)}</div>
    ${c ? `<div class="card mt small">Номер зараз на ${esc(M(c.model).name)} — під час виставлення його буде знято, вартість і дохід машини зменшаться.</div>` : ''}
    <label class="fld mt" for="itPrice">Ціна, ₴</label><input id="itPrice" inputmode="numeric" value="${grp(p.value)}">
    <div class="tiny muted mt">Від ${S.fmt(lo)} до ${S.fmt(hi)} · комісія ${S.FEE * 100}% · лот на ${S.ITEM_MARKET.hours} год</div>
    <button class="btn mt" data-act="itemDoSellPlate" data-pid="${p.id}" data-detach="${c ? 1 : ''}">Виставити</button>`, H.itemSellPlate);
};
H.itemDoSellPlate = async (d) => {
  if (await act('market/item-sell', { kind: 'plate', plateId: Number(d.pid), price: num($('#itPrice').value), detach: !!d.detach }, 'Номер на ринку')) closeModal();
};
H.mTab = (d) => (state.marketTab = d.k, render());
H.mCls = (d) => (state.marketCls = d.k, render());
H.mSort = (d) => (state.marketSort = d.k, render());
H.buy = async (d) => {
  if (me.used >= me.slots) return toast(`Гараж заповнений · ${me.used}/${me.slots} — продай авто або купи місце`, true);
  return (await confirmBox(`Купити за ${S.fmt(Number(d.price))}?${d.sell ? ` Продати дилеру потім — ≈${S.fmt(Number(d.sell))}.` : ''}`)) && act('market/buy', { id: Number(d.id) }, 'Авто вже у твоєму гаражі!');
};
H.unlist = (d) => act('market/cancel', { id: Number(d.id) }, 'Лот знято');
H.unauction = (d) => act('auction/cancel', { id: Number(d.id) }, 'Аукціон скасовано');
H.bid = (d) => sheet('Ставка', `<div class="small muted">Мінімум ${S.fmt(Number(d.min))}. Якщо тебе переб’ють — гроші повернуться.</div><label class="fld mt" for="bidAmt">Твоя ставка, ₴</label><input id="bidAmt" inputmode="numeric" value="${grp(d.min)}"><button class="btn mt" data-act="placeBid" data-id="${d.id}">Поставити</button>`);
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
  if (!list.length) return emptyBox('arrows-exchange', 'Відкритих кімнат зараз немає', 'Створи свою — її побачать усі в Трейд-залі');
  return `<div class="list">${list.map((r) => `<div class="li ${r.invited ? 'invited' : ''}"><div class="grow"><b>${esc(r.host.name)}</b> <span class="chip">рів. ${r.host.level}</span>${r.invited ? ' <span class="chip mine">запрошує тебе</span>' : ''}
      ${r.note ? `<div class="small">${esc(r.note)}</div>` : ''}${r.cars.length ? `<div class="row minis">${miniCars(r.cars)}</div>` : '<div class="tiny muted">гараж ' + S.short(r.host.value) + '</div>'}</div>
      ${r.mine ? `<button class="btn sm ghost" data-act="openRoom" data-id="${r.id}">Моя</button>` : `<button class="btn sm" data-act="roomJoin" data-id="${r.id}">Увійти</button>`}</div>`).join('')}</div>`;
}
const onlineHtml = (h) => (h.online.length ? `<div class="list">${h.online.map((u) => `<div class="li"><span class="lb-ava on">${esc(initialOf(u.name))}</span><div class="grow"><b class="ellipsis">${esc(u.name)}</b><div class="tiny muted">рів. ${u.level} · гараж ${S.short(u.value)}</div></div>
    <button class="btn sm ghost" data-act="roomInvite" data-id="${u.id}">Запросити</button></div>`).join('')}</div>` : emptyBox('users', 'Зараз більше нікого немає онлайн', 'Залиш кімнату відкритою — хтось зайде'));
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
      <input id="roomMoney" inputmode="numeric" placeholder="гривні" value="${s.me.money ? grp(s.me.money) : ''}" style="flex:1;padding:8px 10px"><button class="btn sm ghost" data-act="roomMoney">OK</button></div></div>
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
// The battle form starts on the cheapest case ×1 (it used to offer «Еліта ×3 = 30 млн» — 88% of a rich player's money).
const battleDefaultCase = () => [...S.CASES].filter((c) => !c.starter).sort((a, b) => a.price - b.price)[0]?.id || 'rust';
PAGES.battles = async () => {
  const L = await api('battle/list');
  state.battleOpenMine = L.open.filter((b) => b.mine).map((b) => b.id);
  const cases = S.CASES.filter((c) => !c.starter);
  state.bCase ||= battleDefaultCase();
  const cs = S.CASE_BY_ID[state.bCase];
  const n = state.bCount || 1;
  const short = cs.price * n - me.balance;
  return `<div class="card"><b class="disp" style="font-size:18px">${ic('flame')} НОВИЙ БАТЛ</b>
      <div class="small muted">Ти і суперник відкриваєте однакові кейси. У кого машини дорожчі — забирає <b>усі</b> авто з обох боків. Той, хто програв, отримує дешеву утішну машину.</div>
      <button class="picker bpick mt" data-act="bCasePicker" style="--c:${S.CLASSES[S.CLASS_ORDER.filter((k) => cs.weights[k]).pop()].color}"><span class="picker-ic">${caseIcon(cs)}</span>
        <span class="picker-tx"><b>${esc(cs.name)}</b><span class="picker-sub">${oddsBar(cs.weights)}</span></span><b class="bpick-p">${S.short(cs.price)}</b><span class="picker-chev">${ic('chevron-right')}</span></button>
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
  : emptyBox('flame', 'Відкритих батлів немає', 'Створи свій — суперник відкриє такі самі кейси'));
// The case for a new battle: the same list as «Вибір кейсу» (styled rows, odds, price) instead of a raw <select>.
H.bCasePicker = () => {
  const group = (g, title) => {
    const list = S.CASES.filter((c) => c.group === g && !c.starter);
    return list.length ? `<div class="h2"><span>${title}</span></div><div class="list cases-list">${list.map((c) => `<button class="li ${c.id === state.bCase ? 'on' : ''}" data-act="bPickCase" data-id="${c.id}" style="--c:${S.CLASSES[S.CLASS_ORDER.filter((k) => c.weights[k]).pop()].color}">
      <span class="ic">${caseIcon(c)}</span><div class="grow"><b>${esc(c.name)}</b>${oddsBar(c.weights)}${dots(c.weights)}</div><div class="center"><b>${S.short(c.price)}</b>${(state.bCount || 1) > 1 ? `<div class="tiny muted">×${state.bCount} = ${S.short(c.price * state.bCount)}</div>` : ''}</div></button>`).join('')}</div>` : '';
  };
  sheet('Кейс для батлу', group('rarity', 'За рідкістю') + group('country', 'За країнами'));
};
H.bPickCase = (d) => {
  state.bCase = d.id;
  closeModal();
  render();
};
AFTER.battles = () => {
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
    return (car && me.cars.find((c) => c.id === car.id && c.status === 'garage')) || null;
  };
  const cell = (d, side, i) => {
    const car = !hide && mine(side, i);
    return `<div class="bcell">${dropCard(d, hide)}${car ? `<button class="dropsell" data-act="battleSell" data-id="${car.id}">${ic('cash')}${S.short(sellPrice(car))}</button>` : ''}</div>`;
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
  const sum = cheapest.reduce((s, c) => s + sellPrice(c), 0);
  return `<div class="card warnbox mt"><b>${ic('info-circle')} Гараж переповнений: ${used}/${me.slots}</b>
    <div class="small">Продай ${extra} ${plural(extra, ['машину', 'машини', 'машин'])} або купи місце. Поки що дохід приносять лише ${me.slots} найкращих, а нові кейси відкрити не можна.</div>
    ${cheapest.length === extra ? `<button class="btn sm ghost mt" data-act="sellExtras" data-ids="${cheapest.map((c) => c.id).join(',')}">${ic('cash')} Продати ${extra === 1 ? 'найдешевшу' : `${extra} ${plural(extra, ['найдешевшу', 'найдешевші', 'найдешевших'])}`} · ${S.short(sum)}</button>` : ''}</div>`;
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
    <div class="h2"><span>Вхідні</span><span>${inc.length || ''}</span></div>${inc.length ? inc.map(tradeCard).join('') : emptyBox('arrows-exchange', 'Немає вхідних пропозицій', 'Коли хтось запропонує обмін, він з’явиться тут')}
    <div class="h2"><span>Мої пропозиції</span><span>${out.length || ''}</span></div>${out.length ? out.map(tradeCard).join('') : emptyBox('arrow-right', 'Ти ще нічого не пропонував', 'Обмін за ID гравця — кнопка вгорі')}
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
    <input id="giveMoney" class="mt" inputmode="numeric" placeholder="+ гривні від тебе" value="${num(t.giveMoney) ? grp(t.giveMoney) : ''}">
    <div class="h2"><span>Ти отримуєш</span><span>${S.short(vr)}</span></div>
    ${p.cars.length ? `<div class="grid">${p.cars.map((c) => carTile(c, { sel: t.get.has(c.id), act: 'tgGet' })).join('')}</div>` : emptyBox('car', 'У гравця немає вільних авто', 'Можна запропонувати гроші за свої машини')}
    <input id="getMoney" class="mt" inputmode="numeric" placeholder="+ гривні від гравця" value="${num(t.getMoney) ? grp(t.getMoney) : ''}">
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
const questSeg = () => {
  const n = me.questSplit || {};
  return `<div class="seg" id="questSeg">${[['day', 'Сьогодні'], ['week', 'Тиждень']].map(([k, t]) => `<button class="${(state.questTab || 'day') === k ? 'on' : ''}" data-act="questTab" data-k="${k}">${t}${n[k] ? `<span class="seg-n" aria-label="можна забрати: ${n[k]}">${n[k]}</span>` : ''}</button>`).join('')}</div>`;
};
function paintQuestSeg() {
  const el = $('#questSeg');
  if (el) el.outerHTML = questSeg();
}
PAGES.quests = async () => {
  // Opened from the menu with rewards only on the weekly tab: go straight there.
  if (!state.questTabPicked) {
    const n = me.questSplit || {};
    if (!n.day && n.week) state.questTab = 'week';
    else if (n.day && !n.week) state.questTab = 'day';
  }
  return questSeg() + (state.questTab === 'week' ? await weeklyPage() : await dailyQuests());
};
H.questTab = (d) => (state.questTab = d.k, state.questTabPicked = true, render());
// ---------- weekly route: 4 tasks for fragments + chests for active days ----------
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const fragWord = (n) => plural(n, ['фрагмент', 'фрагменти', 'фрагментів']);
const chestText = (c, w) => [c.key ? `Ключ «${S.CASE_BY_ID[w.caseId].name}»` : '', c.frag ? `${c.frag} ${fragWord(c.frag)} ключа` : '', c.parts ? `${c.parts} ${plural(c.parts, ['деталь', 'деталі', 'деталей'])} ${S.TIER_BY_ID[w.partTier].name}` : '', c.fuel ? 'повний бак' : ''].filter(Boolean).join(' + ');
async function weeklyPage() {
  const w = await api('weekly');
  const cs = S.CASE_BY_ID[w.caseId];
  const max = S.WEEK_CHEST[S.WEEK_CHEST.length - 1].days;
  return `<div class="card wk-head"><div class="row between"><b class="disp" style="font-size:17px">${ic('calendar')} Тижневий маршрут</b><span class="chip">до понеділка <span data-until="${w.endsAt - clockOffset}"></span></span></div>
    <div class="small muted mt">Активний день — забрано ${S.WEEK_ACTIVE_QUESTS} з 3 щоденних завдань</div>
    <div class="wk-days mt">${w.days.map((d, i) => `<span class="wk-day${d.active ? ' on' : ''}${d.day === w.today ? ' today' : ''}">${d.active ? ic('check') : WD[i]}</span>`).join('')}</div>
    <div class="wk-track mt"><div class="progress gold"><i style="width:${Math.min(100, (w.active / max) * 100)}%"></i></div>
      ${w.chests.map((c) => `<span class="wk-mark" style="left:${(c.days / max) * 100}%">${c.days}</span>`).join('')}</div></div>
    <div class="h2"><span>Скрині тижня</span><span>${w.active}/${max} днів</span></div>
    ${w.chests.map((c) => `<div class="card row wk-chest${c.ready && !c.claimed ? ' ready' : ''}"><div class="wk-ic">${ic(c.claimed ? 'check' : c.ready ? 'gift' : 'lock')}</div>
      <div class="grow"><b>${c.days} ${plural(c.days, ['активний день', 'активні дні', 'активних днів'])}</b><div class="small muted">${esc(chestText(c, w))}</div></div>
      ${c.claimed ? '<span class="chip">Відкрито</span>' : `<button class="btn sm" data-act="wkChest" data-d="${c.days}" ${c.ready ? '' : 'disabled'}>${c.ready ? 'Відкрити' : `${w.active}/${c.days}`}</button>`}</div>`).join('')}
    <div class="h2"><span>Завдання тижня</span><span>${caseIcon(cs)} фрагменти: ${w.fragments}/${S.FRAGMENTS_PER_KEY}</span></div>
    ${w.list.map((x) => questCard({ text: countFix(x.text), progress: x.progress, target: x.target, claimed: x.claimed, reward: `${ic('key')} ${x.frag} ${fragWord(x.frag)} «${esc(cs.name)}» · +${S.XP.quest} досвіду`,
      btn: x.progress < x.target ? '' : `<button class="btn sm" data-act="wkClaim" data-k="${x.key}">Забрати</button>` })).join('')}
    <div class="tiny muted center mt">${S.FRAGMENTS_PER_KEY} фрагментів = ключ. Ключ залежить від рівня. Новий маршрут — щопонеділка о 00:00 за Києвом</div>`;
}
// One quest: a status tile (in progress / ready / done), the task, a progress bar with the count, the reward line.
function questCard({ text, progress, target, claimed, reward, btn }) {
  const ready = !claimed && progress >= target;
  const st = claimed ? 'done' : ready ? 'ready' : '';
  return `<div class="card qcard ${st}"><span class="q-ic">${ic(claimed ? 'check' : ready ? 'gift' : 'target-arrow')}</span>
    <div class="grow"><div class="row between"><b>${esc(text)}</b><span class="q-n">${Math.min(progress, target)}<small>/${target}</small></span></div>
      <div class="progress"><i style="width:${Math.min(100, (progress / target) * 100)}%"></i></div>
      <div class="row between"><span class="small q-rw">${reward}</span>${claimed ? '<span class="chip">Отримано</span>' : btn || '<span class="chip">у процесі</span>'}</div></div></div>`;
}
const wkClaimText = (r) => `+${r.frag} ${fragWord(r.frag)} «${S.CASE_BY_ID[r.caseId].name}»${r.newKeys ? ' — зібрано ключ!' : ''}`;
H.wkClaim = (d) => act('weekly/claim', { key: d.k }, wkClaimText);
H.wkChest = (d) => act('weekly/chest', { days: Number(d.d) }, (r) => 'Скриня: ' + [r.keys ? `ключ «${S.CASE_BY_ID[r.caseId].name}»` : '', r.frag ? `+${r.frag} ${fragWord(r.frag)}${r.newKeys ? ' (ключ зібрано!)' : ''}` : '', r.items ? `${r.items.length} ${plural(r.items.length, ['деталь', 'деталі', 'деталей'])}` : '', r.fuel ? 'повний бак' : ''].filter(Boolean).join(', '));
async function dailyQuests() {
  const { list } = await api('quests');
  return `${firstStepsCard()}
    <div class="h2"><span>На сьогодні</span><span>оновлюються опівночі</span></div>
    ${list.map((x) => questCard({ text: countFix(x.text), progress: x.progress, target: x.target, claimed: x.claimed, reward: `${ic('gift')} ${S.fmt(x.reward)} · +${S.XP.quest} досвіду`,
      btn: x.progress < x.target ? '' : `<button class="btn sm" data-act="questClaim" data-k="${x.key}">Забрати</button>` })).join('')}`;
}
H.newbieQuest = () => act('newbie/claim', {}, (r) => `+${S.fmt(r.got)}`);
H.questClaim = (d) => act('quests/claim', { key: d.k }, (r) => `+${S.fmt(r.got)}`);

// ---------- rewards center & reveal (wave E: audit №7, №8, feature 3) ----------
// Cars and case keys from rewards (daily bonus, season pass, sets, «Забрати все», bosses, a friend's invite) come the
// way a case drop does: the reel spins and stops on what came, then the same celebration. A key is opened at once by
// case/open with keyOnly (a key is used, never money): the server rolls it like any opening. A car the server already
// gave (class C / B of the daily bonus, the season car) gets a reel of its own class that stops on it. The reward case
// spins a 2-second strip of what it can give. One at a time; «Далі» moves on, «Пропустити» leaves the keys in the cases.
const REWARD_KINDS = new Set(['daily', 'rcase', 'newbie', 'quest', 'weekly', 'wchest', 'coll', 'set', 'ach', 'achAll', 'pass']);
const REWARD_IC = { daily: 'gift', rcase: 'box', newbie: 'sparkles', quest: 'target-arrow', weekly: 'calendar', wchest: 'gift', coll: 'books', set: 'books', ach: 'diamond', achAll: 'diamond', pass: 'ticket' };
CELEBRATE.add('rewards/all');
let rewardClaims = []; // reward claims of the last pulse: the rewards center lists them, the gift badge counts them
function setRewardClaims(claims) {
  rewardClaims = (claims || []).filter((c) => REWARD_KINDS.has(c.kind));
  paintGiftBadge();
}
// Without the daily bonus / reward case once they are taken (the pulse may be a few seconds old).
const liveRewardClaims = () => rewardClaims.filter((c) => (c.kind !== 'daily' || me.dailyReady) && (c.kind !== 'rcase' || serverNow() >= me.rewardCaseAt));
function paintGiftBadge() {
  const el = $('#giftBadge');
  if (!el || !me) return;
  const list = liveRewardClaims(), kinds = new Set(list.map((c) => c.kind));
  const n = list.length + (me.dailyReady && !kinds.has('daily') ? 1 : 0) + (serverNow() >= me.rewardCaseAt && !kinds.has('rcase') ? 1 : 0);
  el.hidden = !n || (guideOn() && me.guide !== 'daily'); // first steps: one thing at a time
  el.textContent = n > 9 ? '9+' : String(n);
}
const hashStr = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
// Banners: one reward keeps its own «Забрати»; several fold into one «Нагороди» banner that opens the rewards center
// (its single rewards are remembered as shown, so they don't come back one by one). Other claims stay as they were.
function showClaimBanners(claims) {
  const one = (c) => showBanner({ ...c, claim: c, sub: esc(countFix(c.sub)) + (c.money ? ` · <b class="win">+${S.short(c.money)}</b>` : ''), ttl: 8000, buttons: [{ label: 'Забрати', act: 'bannerClaim' }] });
  for (const c of claims) if (!REWARD_KINDS.has(c.kind) && !bannerSeen.has(c.key) && !(c.kind === 'newbie' && $('#guide'))) one(c);
  const rw = claims.filter((c) => REWARD_KINDS.has(c.kind) && !(c.kind === 'daily' && skipDailyBanner));
  if (rw.length === 1 && !bannerSeen.has(rw[0].key)) return one(rw[0]);
  if (rw.length < 2) return;
  const key = 'rwall:' + hashStr(rw.map((c) => c.key).sort().join('|'));
  if (bannerSeen.has(key) || banners.has(key)) return;
  for (const [k, b] of banners) if (b.data.claim && REWARD_KINDS.has(b.data.kind)) hideBanner(k, false);
  rw.forEach((c) => rememberBanner(c.key));
  const money = rw.reduce((sum, c) => sum + (c.money || 0), 0);
  showBanner({ key, kind: 'rwall', icon: 'gift', color: '#ffc400', claim: { kind: 'rwall' }, title: `Нагороди чекають · ${rw.length}`,
    sub: esc(rw.slice(0, 2).map((c) => countFix(c.title)).join(' · ')) + (rw.length > 2 ? ` · ще ${rw.length - 2}` : '') + (money ? ` · <b class="win">+${S.short(money)}</b>` : ''),
    ttl: 9000, open: () => openRewards(), buttons: [{ label: 'Забрати все', act: 'claimAllBanner' }] });
}
H.claimAllBanner = (d) => {
  hideBanner(d.key);
  H.claimAll();
};
// «Забрати все» at the top of the rewards window: what is ready, in one tap (POST rewards/all).
function rewardsAllCard() {
  const list = liveRewardClaims();
  if (!list.length) return '';
  const rows = list.slice(0, 5).map((c) => `<div class="rwc-row"><span class="rwc-ic">${ic(REWARD_IC[c.kind] || 'gift')}</span><span class="rwc-tx"><b class="ellipsis">${esc(countFix(c.title))}</b><span class="ellipsis">${esc(countFix(c.sub))}</span></span>${c.money ? `<b class="win nw">+${S.short(c.money)}</b>` : ''}</div>`).join('');
  return `<div class="card rwc"><div class="rwc-h"><b>${ic('gift')} Готово до видачі</b><span class="rwc-n">${list.length}</span></div>
    <div class="rwc-list">${rows}${list.length > 5 ? `<div class="tiny muted rwc-more">і ще ${list.length - 5}</div>` : ''}</div>
    <button class="btn yellow mt" data-act="claimAll">${ic('gift')} Забрати все (${list.length})</button>
    <div class="tiny muted center mt">Гроші, деталі й пальне — одразу; машини й ключі покажемо по черзі</div></div>`;
}
const claimAllText = (r) => [`Забрано: ${r.n}`, r.money > 0 ? '+' + S.short(r.money) : '', r.parts > 0 ? `деталі ×${r.parts}` : '', r.slots > 0 ? `+${r.slots} ${plural(r.slots, ['місце', 'місця', 'місць'])} в гаражі` : '', r.fuel ? 'повний бак' : '', ...(r.cosmetics || [])].filter(Boolean).join(' · ');
H.claimAll = async () => {
  const fromSheet = !$('#modal').hidden;
  const r = await act('rewards/all', {}, claimAllText, { rerender: false });
  if (!r) return;
  pulseSoon();
  if (r.reveal.length) await revealRewards(r.reveal);
  if (fromSheet && !rvl) openRewards();
};
// A claim whose result is revealed later: no coins and no refresh yet (act() would fly the coins before the reel).
const claiming = new Set();
async function claimQuiet(name, body = {}) {
  if (claiming.has(name)) return null;
  claiming.add(name);
  try {
    const r = await api(name, body);
    haptic('success');
    return r;
  } catch (e) {
    toast(e.message, true);
    haptic('error');
    refresh().catch(() => {});
    return null;
  } finally {
    claiming.delete(name);
  }
}
// «Відкрити ключ» under a reward that gave keys (a finished set, a country's last boss).
const rewardKeysBtn = (caseId, n, title, from = '') => (caseId && n > 0 && S.CASE_BY_ID[caseId]
  ? `<button class="btn yellow mt rw-keys" data-act="openRewardKeys" data-c="${caseId}" data-n="${n}" data-t="${esc(title)}" data-from="${from}">${ic('key')} Відкрити ${n > 1 ? `${n} × ключ` : 'ключ'} «${esc(S.CASE_BY_ID[caseId].name)}»</button>` : '');
H.openRewardKeys = async (d, el) => {
  el.disabled = true;
  if (d.from === 'boss' && state.race?.result?.boss) state.race.result.boss.keysOpened = true;
  await revealRewards([{ kind: 'key', caseId: d.c, count: Number(d.n) || 1, title: d.t }]);
};

// ---- the reveal: a full-screen card over everything (below the «вау» takeover)
let rvl = null;
function revealRewards(items) {
  const list = [];
  for (const it of items || []) {
    if (it.kind === 'key') for (let k = 0; k < Math.min(it.count || 1, 12); k++) list.push({ ...it, count: 1, nth: k + 1, of: Math.min(it.count || 1, 12) });
    else if (it.kind === 'rcase' || it.car) list.push(it);
  }
  if (!list.length) return refresh().catch(() => {});
  if (rvl) {
    rvl.list.push(...list);
    return rvl.promise;
  }
  closeModal();
  hideClaimBanners();
  const el = document.createElement('div');
  el.className = 'rvl';
  document.body.append(el);
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  rvl = { list, i: 0, el, resolve, promise, cur: null, free: me.slots - me.used }; // free: garage slots for the keys
  state.opening = true; // no banners, level-up windows or case opening over the reel
  rvlStep();
  return promise;
}
const rvlTitle = (it) => (it.kind === 'key' ? `${it.title ? it.title + ' · ' : ''}Кейс «${S.CASE_BY_ID[it.caseId].name}»${it.of > 1 ? ` · ${it.nth}/${it.of}` : ''}` : it.title || 'Нагорода');
async function rvlStep() {
  const R = rvl, it = R.list[R.i];
  R.cur = null;
  const left = R.list.length - R.i - 1;
  R.el.innerHTML = `<div class="rvl-box">
    <div class="rvl-top"><span class="rvl-n">${R.list.length > 1 ? `Нагорода ${R.i + 1} з ${R.list.length}` : 'Нагорода'}</span>${left && R.list.slice(R.i + 1).some((x) => x.kind === 'key') ? '<button class="rvl-skip" data-act="rvlSkip">Пропустити</button>' : ''}</div>
    <b class="rvl-t">${esc(rvlTitle(it))}</b>
    <div class="stage rvl-stage" id="rvlStage"><div class="reel-wrap" id="rvlWrap"><div class="reel" id="rvlReel"></div></div></div>
    <div class="rvl-res" id="rvlRes"></div><div class="rvl-btns" id="rvlBtns"></div></div>`;
  requestAnimationFrame(() => R.el.classList.add('in'));
  try {
    if (it.kind === 'key') await rvlKey(it);
    else if (it.kind === 'rcase') await rvlRewardCase(it);
    else await rvlCar(it);
  } catch (e) {
    try {
      rvlMsg('info-circle', 'Не вдалося показати нагороду', esc(e.message));
    } catch {}
  } finally {
    if (rvl === R) rvlButtons(); // always a way out of the overlay
  }
}
async function rvlKey(it) {
  const cs = S.CASE_BY_ID[it.caseId];
  let r;
  try {
    if (rvl.free < 1) throw new Error('Гараж заповнений — продай авто або купи місце');
    r = await api('case/open', { caseId: cs.id, count: 1, keyOnly: true });
    rvl.free--;
  } catch (e) {
    rvl.keyLeft = cs.id;
    return rvlMsg('key', `Ключ «${esc(cs.name)}» чекає в кейсах`, esc(e.message));
  }
  const res = r.results[0];
  if (!state.fast) await spin(cs, res.car.model, { wrap: $('#rvlWrap'), reel: $('#rvlReel') });
  rvlResult(res, cs);
}
// Cards of the car's own class (dearer ones rarer, as in a case); a secret or season car among A and S cars.
function classCardAt(model) {
  const m = M(model);
  const pool = S.ALL_MODELS.filter((x) => !x.secret && (m.secret ? x.cls === 'A' || x.cls === 'S' : x.cls === m.cls));
  const w = S.modelWeights(pool), sw = w.reduce((a, b) => a + b, 0), strip = [];
  const draw = () => {
    let y = Math.random() * sw;
    for (let i = 0; i < pool.length; i++) if ((y -= w[i]) < 0) return pool[i].id;
    return pool[pool.length - 1].id;
  };
  return (i, W) => reelCard(i === W ? model : (strip[i] ??= draw()));
}
async function rvlCar(it) {
  const m = M(it.car.model);
  if (!state.fast) await spinReel({ cardAt: classCardAt(it.car.model), color: S.CLASSES[m.cls].color, rank: S.rankOf(m.cls), wrap: $('#rvlWrap'), reel: $('#rvlReel') });
  rvlResult({ car: it.car, isNew: !!it.isNew }, null);
}
// The reward case's strip: money / a part / a full tank / a D or C car by S.REWARD_CASE_ODDS, stopping on what came.
function rcCard(kind, x) {
  if (kind === 'car') return reelCard(x);
  const color = kind === 'money' ? '#ffc400' : kind === 'fuel' ? '#30d158' : S.CLASSES[S.TIER_BY_ID[x.tier].cls].color;
  const art = kind === 'part' ? partArt(x.type, x.tier) : `<span class="rc-ic">${ic(kind === 'money' ? 'coin' : 'gas-station')}</span>`;
  const nm = kind === 'money' ? S.short(x) : kind === 'fuel' ? 'Повний бак' : S.partLabel(x.type, x.tier);
  return `<div class="car pcard rc-card" style="--c:${color}"><div class="art">${art}</div><div class="nm tiny ellipsis">${esc(nm)}</div></div>`;
}
async function rvlRewardCase(it) {
  const rw = it.reward, o = S.REWARD_CASE_ODDS, lvl = me.level;
  const parts = S.partPoolFor(me.cars.map((c) => c.model));
  const draw = () => {
    const x = Math.random();
    if (x < o.money) return ['money', Math.round(((5000 + Math.random() * 20000) * lvl) / 1000) * 1000];
    if (x < o.money + o.part) return ['part', { type: parts[Math.floor(Math.random() * parts.length)], tier: Math.random() < 0.7 ? 'stock' : 'street' }];
    if (x < o.money + o.part + o.fuel) return ['fuel'];
    const pool = S.ALL_MODELS.filter((m) => !m.secret && m.cls === (Math.random() < 0.85 ? 'D' : 'C'));
    return ['car', pool[Math.floor(Math.random() * pool.length)].id];
  };
  const win = rw.carOut ? ['car', rw.carOut.model] : rw.items ? ['part', rw.items[0]] : rw.fuel ? ['fuel'] : ['money', rw.money];
  const strip = [];
  const rank = rw.carOut ? S.rankOf(M(rw.carOut.model).cls) : 0;
  const color = rw.carOut ? S.CLASSES[M(rw.carOut.model).cls].color : win[0] === 'part' ? S.CLASSES[S.TIER_BY_ID[win[1].tier].cls].color : win[0] === 'fuel' ? '#30d158' : '#ffc400';
  $('#rvlWrap').classList.add('rc');
  if (!state.fast) await spinReel({ cardAt: (i, W) => rcCard(...(i === W ? win : (strip[i] ??= draw()))), color, rank: Math.min(rank, 1), wrap: $('#rvlWrap'), reel: $('#rvlReel'), extra: -2300 });
  if (rw.carOut) return rvlResult({ car: rw.carOut, isNew: !!rw.isNew }, null);
  const big = win[0] === 'part' ? partArt(win[1].type, win[1].tier, 'lg') : `<span class="rc-big-ic">${ic(win[0] === 'money' ? 'coin' : 'gas-station')}</span>`;
  const name = win[0] === 'money' ? `+${S.fmt(win[1])}` : win[0] === 'fuel' ? 'Повний бак' : S.partLabel(win[1].type, win[1].tier);
  const sub = win[0] === 'money' ? 'на рахунок' : win[0] === 'fuel' ? 'загальний бак заправлено' : 'деталь — у Майстерні';
  $('#rvlStage').outerHTML = `<div class="rc-big pop" id="rvlBig" style="--c:${color}">${big}</div>`;
  $('#rvlRes').innerHTML = `<div class="result-name pop" style="--c:${color}">${esc(name)}</div><div class="small muted center pop2">${sub}</div>`;
  FX.sparkle($('#rvlBig'), [color, '#ffffff'], 12);
  FX.popEl($('#rvlBig'), 1.15, 420);
  SFX.win();
  haptic('success');
  if (win[0] === 'money') moneyFx(win[1]);
}
function rvlResult(res, cs) {
  const car = res.car, m = M(car.model), rank = S.rankOf(m.cls), color = S.CLASSES[m.cls].color;
  rvl.cur = res;
  $('#rvlStage').outerHTML = `<div class="reveal-wrap r${rank}" id="rvlReveal" style="--c:${color}"><div class="art reveal" id="rvlArt">${carArt(car.model, { glow: rank >= 2, look: car.look })}</div></div>`;
  const sale = m.secret ? `<span>${ic('trophy')} трофей — не продається</span>` : `<span>${ic('cash')} продаж <b>${S.short(sellPrice(car))}</b></span>`;
  $('#rvlRes').innerHTML = `${res.isNew ? `<div class="newtag pop">${ic('sparkles')} Нова в колекції</div>` : ''}
    <div class="result-name r${rank} pop ${rank >= 3 ? 'shimmer' : ''}" style="--c:${color}">${esc(m.name)}</div>
    <div class="rarity-row pop2"><span class="stamp r${rank}" style="--c:${color}"><b>${m.cls}</b>${S.CLASSES[m.cls].name}</span>${originChip(car.model)}${res.forced ? ' <span class="chip">гарантія</span>' : ''}</div>
    <div class="drop-sell pop2">${sale}</div>`;
  const fx = () => {
    if (!$('#rvlReveal')) return;
    haptic(rank >= 3 ? 'heavy' : rank >= 1 ? 'medium' : 'success');
    if (rank >= 3) setTimeout(() => SFX.rare(rank), 120);
    setTimeout(() => FX.dropShow(rank, color, { host: $('#rvlReveal'), target: $('#rvlArt'), newEl: $('#rvlRes .newtag') }), 150);
  };
  if (WOW.pickDrop([res])) WOW.celebrate(res, { casePrice: cs?.price || 0, onShare: (r) => openShare(r.car, { mult: cs?.price ? r.car.value / cs.price : 0 }) }).then(fx);
  else fx();
}
function rvlMsg(icon, title, text) {
  const st = $('#rvlStage') || $('#rvlReveal') || $('#rvlBig');
  if (st) st.outerHTML = `<div class="rc-big" style="--c:#8e8e93"><span class="rc-big-ic">${ic(icon)}</span></div>`;
  $('#rvlRes').innerHTML = `<div class="result-name" style="font-size:20px">${title}</div><div class="small muted center">${text}</div>`;
}
function rvlButtons() {
  const R = rvl, left = R.list.length - R.i - 1, res = R.cur;
  if (!$('#rvlBtns')) return;
  const sell = res?.car && !M(res.car.model).secret && me.cars.length > 1
    ? (res.sold ? `<div class="btn ghost btn2 done"><span>${ic('check')} Продано</span></div>` : `<button class="btn ghost btn2" data-act="rvlSell"><span>${ic('cash')} Продати</span><small>${S.short(sellPrice(res.car))}</small></button>`) : '';
  const toCases = R.keyLeft ? '<button class="btn ghost" data-act="rvlToCases">До кейсів</button>' : '';
  $('#rvlBtns').innerHTML = `<div class="btns">${sell || toCases}<button class="btn yellow" data-act="rvlNext">${left ? `Далі · ще ${left}` : 'Готово'}</button></div>`;
}
H.rvlNext = () => {
  if (!rvl) return;
  if (++rvl.i >= rvl.list.length) return rvlClose();
  rvlStep();
};
H.rvlSkip = () => {
  if (!rvl) return;
  const keys = rvl.list.slice(rvl.i + 1).filter((x) => x.kind === 'key').length;
  rvlClose();
  if (keys) setTimeout(() => toast(`${ic('key')} ${keys} ${plural(keys, ['ключ чекає', 'ключі чекають', 'ключів чекають'])} у кейсах`), 300);
};
H.rvlToCases = () => {
  const caseId = rvl?.keyLeft;
  rvlClose().then(() => {
    state.tab = 'cases';
    state.page = null;
    if (caseId) state.caseId = caseId;
    state.count = 1;
    state.drop = null;
    render();
  });
};
H.rvlSell = async (d, el) => {
  const res = rvl?.cur;
  if (!res || res.sold || !armed(el, 'Точно продати?')) return;
  if (await act('sell', { carIds: [res.car.id] }, (r) => `Продано: +${S.fmt(r.got)}`, { rerender: false })) {
    res.sold = true;
    if (rvl) rvl.free++;
    if (rvl?.cur === res) rvlButtons();
  }
};
async function rvlClose() {
  const R = rvl;
  if (!R) return;
  rvl = null;
  state.opening = false;
  R.el.classList.remove('in');
  setTimeout(() => R.el.remove(), 220);
  try {
    await refresh();
  } catch {}
  R.resolve();
}

// ---- season cosmetics in the game (S.cosmeticOf): free season liveries in the paint shop, the plate frame on the
// owner's plates, the backdrop behind the showcase. The badge lives in the profile with the other badges.
// «Стиль» (S.styleWorn) extends it: me.style says what is worn per slot (season or bought), another player's style
// comes with their card / lot / showcase and is passed in.
let cosCache = { me: null, style: {}, plates: new Set() };
function cosNow() {
  if (cosCache.me !== me) cosCache = { me, style: me ? me.style || S.styleWorn(me.claims, {}) : {}, plates: new Set((me?.plates || []).map((p) => p.text)) };
  return cosCache;
}
// frame: the plate owner's worn frame for another player's plate (null = none); without it, mine on my own plates.
function plateFrame(text, frame) {
  if (frame !== undefined) return styleCls('pf', frame);
  const c = cosNow();
  return c.plates.has(text) ? styleCls('pf', c.style.frame) : '';
}
// Classes for a showcase grid: the backdrop (season one with its number) and the underglow of the cars.
function showcaseBackdrop(style = cosNow().style) {
  const show = style?.showcase, c = show && S.cosmeticOf(show);
  // (the season backdrop closes the class attribute to add its number, so it goes last)
  return styleCls('gl', style?.glow) + (c ? (c.season ? ` sc-season" data-season="${c.season}` : ` sc-${c.look}`) : '');
}
const liveryList = () => [...S.LIVERIES, ...S.ownedCosmetics(me.claims).filter((c) => c.livery).sort((a, b) => a.season - b.season || (a.kind === 'gold') - (b.kind === 'gold')).map((c) => S.LIVERY_BY_ID[c.livery])];
// Liveries of «Стиль» not owned yet: shown locked in the paint shop with a link to «Стиль».
const liveryLocked = () => S.STYLE_ITEMS.filter((it) => it.kind === 'livery' && !me.claims.includes(it.cos));

// ---------- season & pass ----------
const vipChip = () => `<span class="chip vipchip">${ic('crown')} VIP</span>`;
const BADGE_COLORS = ['#8e8e93', '#5ac8fa', '#c4c9d2', '#f5b301'];
const badgeChip = (b) => `<span class="chip" style="color:${BADGE_COLORS[b.tier] || '#8e8e93'};border-color:currentColor">${ic('trophy')} ${esc(b.title)}</span>`;
const passCell = (rw, state) => {
  const cos = S.cosmeticOf(rw.cosmetic);
  const icon = rw.seasonCar ? 'car-turbine' : cos ? cos.icon : rw.caseId ? 'gift' : rw.parts ? 'tool' : 'coin';
  const label = rw.seasonCar ? 'Машина сезону' : rewardText(rw);
  return `<div class="pcell ${state}${cos ? ' cos' : ''}">${state === 'lock' ? ic('lock') : ic(icon)}<span>${esc(label)}</span></div>`;
};
// Every 5 levels of the free track: the season's cosmetics (S.PASS_COSMETICS), owned ones ticked.
function seasonCosStrip(s) {
  const tiles = Object.keys(S.PASS_COSMETICS).map(Number).map((l) => {
    const c = S.passCosmetic(s.id, l), own = me.claims.includes(c.id);
    return `<div class="scos ${own ? 'own' : s.level >= l ? 'ready' : ''}"><span class="scos-pv scos-${c.kind}" data-season="${s.id}">${ic(c.icon)}</span><b>${esc(c.short)}</b><small>${own ? `${ic('check')} твоє` : `рівень ${l}`}</small></div>`;
  }).join('');
  return `<div class="card scos-card"><div class="row between"><b>${ic('sparkles')} Косметика сезону ${s.id}</b><span class="tiny muted">кожні 5 рівнів · безкоштовно</span></div>
    <div class="scos-row">${tiles}</div><div class="tiny muted">Лівреї — у «Фарбуванні» на будь-яку свою машину, рамка — на твоїх номерах, фон — за вітриною (зняти чи надягти — у магазині, «Стиль»), значок — у профілі. Лише в цьому сезоні.</div></div>`;
}
// Season car showroom: one 360x200 scene, scaled with the card. The left lamp + beam are drawn once and
// mirrored with <use>, so both sides are identical; glows are stacked strokes (no SVG filters — cheap on phones).
// Turntable top: ellipse c(180,150) r(150,24). The car box (CSS) is 262 wide with its bottom at y=149, so any
// photo (bumpers reach the canvas edges, wheels on the bottom edge) stands fully on the top surface.
const SHOWROOM_SVG = (() => {
  const grid = [];
  for (let k = -12; k <= 12; k++) grid.push(`M${(180 + k * 9.2).toFixed(1)} 104L${180 + k * 42} 200`);
  for (const y of [106, 109, 113, 118, 124, 132, 142, 155, 171, 192]) grid.push(`M0 ${y}H360`);
  const beam = (w0, w1, o) => `<path d="M${-w0} 11L${w0} 11L${w1} 190L${-w1} 190Z" fill="url(#srBeam)" opacity="${o}"/>`;
  return `<svg class="sr-scene" viewBox="0 0 360 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><defs>
<radialGradient id="srHaze" cx="180" cy="112" r="200" gradientTransform="translate(0 33.6) scale(1 .7)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7a4cff" stop-opacity=".5"/><stop offset=".3" stop-color="#4b2fc4" stop-opacity=".28"/><stop offset=".65" stop-color="#1a1a5a" stop-opacity=".12"/><stop offset="1" stop-color="#05070c" stop-opacity="0"/></radialGradient>
<radialGradient id="srContact" cx="180" cy="149.5" r="122" gradientTransform="translate(0 144) scale(1 .0369)" gradientUnits="userSpaceOnUse"><stop offset=".6" stop-color="#000" stop-opacity=".75"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="srPool" cx="180" cy="148" r="100" gradientTransform="translate(0 124.3) scale(1 .16)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff6dc" stop-opacity=".42"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></radialGradient>
<linearGradient id="srRail" x1="0" y1="0" x2="0" y2="6" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3a4452"/><stop offset=".5" stop-color="#1a2029"/><stop offset="1" stop-color="#0b0e13"/></linearGradient>
<radialGradient id="srGridFade" cx="180" cy="168" r="175" gradientTransform="translate(0 -168) scale(1 2)" gradientUnits="userSpaceOnUse"><stop offset=".35" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity=".15"/></radialGradient>
<linearGradient id="srHorizon" x1="0" y1="104" x2="0" y2="200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".35" stop-color="#fff"/><stop offset=".8" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="srGridMask" maskUnits="userSpaceOnUse" x="0" y="0" width="360" height="200"><rect y="104" width="360" height="96" fill="url(#srGridFade)"/></mask>
<mask id="srHorizonMask" maskUnits="userSpaceOnUse" x="0" y="0" width="360" height="200"><rect width="360" height="200" fill="url(#srHorizon)"/></mask>
<radialGradient id="srFloorGlow" cx="180" cy="186" r="180" gradientTransform="translate(0 155.6) scale(1 .1634)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffc400" stop-opacity=".3"/><stop offset="1" stop-color="#ffc400" stop-opacity="0"/></radialGradient>
<linearGradient id="srBeam" x1="0" y1="11" x2="0" y2="190" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff8e1" stop-opacity=".6"/><stop offset=".45" stop-color="#f1f4ff" stop-opacity=".26"/><stop offset=".85" stop-color="#f1f4ff" stop-opacity=".1"/><stop offset="1" stop-color="#f1f4ff" stop-opacity="0"/></linearGradient>
<linearGradient id="srBody" x1="-8" y1="0" x2="8" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#11161d"/><stop offset=".45" stop-color="#4a5664"/><stop offset="1" stop-color="#151b23"/></linearGradient>
<linearGradient id="srBand" x1="30" y1="0" x2="330" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#07090d"/><stop offset=".5" stop-color="#232d3a"/><stop offset="1" stop-color="#07090d"/></linearGradient>
<radialGradient id="srTop" cx="180" cy="146" r="150" gradientTransform="translate(0 116.8) scale(1 .2)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4a5b70"/><stop offset=".6" stop-color="#1f2935"/><stop offset="1" stop-color="#121820"/></radialGradient>
<linearGradient id="srRim" x1="0" y1="126" x2="0" y2="174" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffc400" stop-opacity=".25"/><stop offset=".55" stop-color="#ffc400" stop-opacity=".8"/><stop offset="1" stop-color="#ffe27a"/></linearGradient>
<g id="srLamp"><path d="M30 5V10" stroke="#2c3542" stroke-width="2.6"/><rect x="25" y="3" width="10" height="4" rx="1" fill="#2c3542"/><g transform="translate(30 15) rotate(-58)">${beam(13, 64, 0.18)}${beam(8, 42, 0.3)}${beam(4, 22, 0.4)}
<path d="M-10 2V-6A10 6 0 0 1 10 -6V2" fill="none" stroke="#2c3542" stroke-width="2"/><circle cx="-10" cy="1" r="1.6" fill="#55606e"/><circle cx="10" cy="1" r="1.6" fill="#55606e"/><rect x="-7.5" y="-9" width="15" height="17" rx="3.5" fill="url(#srBody)"/><rect x="-9" y="6" width="18" height="4.5" rx="1.6" fill="#232b35"/>
<circle cy="11" r="11" fill="#fff3c4" opacity=".1"/><circle cy="11" r="6" fill="#fff3c4" opacity=".22"/><ellipse cy="10.6" rx="7.4" ry="2.2" fill="#fffbea"/></g></g></defs>
<rect width="360" height="200" fill="url(#srHaze)"/>
<rect x="8" y="0" width="344" height="5" rx="2" fill="url(#srRail)"/><path d="M8 5.5H352" stroke="#7b8cff" stroke-opacity=".35" stroke-width=".6"/>
<g mask="url(#srHorizonMask)"><path d="${grid.join('')}" stroke="#8494ff" stroke-opacity=".55" stroke-width=".7" fill="none" mask="url(#srGridMask)"/></g>
<g class="sr-neon" fill="none" stroke-linecap="round"><path d="M44 150A136 122 0 0 1 316 150" stroke="#ffc400" stroke-width="14" stroke-opacity=".06"/><path d="M44 150A136 122 0 0 1 316 150" stroke="#ffc400" stroke-width="7" stroke-opacity=".14"/></g>
<g fill="none"><path d="M44 150A136 122 0 0 1 316 150" stroke="#ffc400" stroke-width="2.4"/><path d="M44 150A136 122 0 0 1 316 150" stroke="#fff4c8" stroke-width=".9"/></g>
<ellipse cx="180" cy="187" rx="180" ry="29" fill="url(#srFloorGlow)"/><ellipse cx="180" cy="176" rx="152" ry="14" fill="#000" opacity=".6"/>
<use href="#srLamp"/><use href="#srLamp" transform="translate(360 0) scale(-1 1)"/>
<path d="M30 150A150 24 0 0 0 330 150L330 162A150 24 0 0 1 30 162Z" fill="url(#srBand)"/>
<path d="M30 162A150 24 0 0 0 330 162" fill="none" stroke="#8a7bff" stroke-width="6" stroke-opacity=".16"/><path d="M30 162A150 24 0 0 0 330 162" fill="none" stroke="#a99cff" stroke-width="1.1"/>
<ellipse cx="180" cy="150" rx="150" ry="24" fill="url(#srTop)"/><ellipse cx="180" cy="148" rx="100" ry="16" fill="url(#srPool)"/><ellipse cx="180" cy="150" rx="124" ry="19.5" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width=".8"/>
<ellipse cx="180" cy="149.5" rx="122" ry="4.5" fill="url(#srContact)"/>
<ellipse cx="180" cy="150" rx="150" ry="24" fill="none" stroke="#ffc400" stroke-width="5" stroke-opacity=".12"/><ellipse cx="180" cy="150" rx="150" ry="24" fill="none" stroke="url(#srRim)" stroke-width="1.4"/>
<ellipse class="sr-spin" cx="180" cy="150" rx="150" ry="24" fill="none" stroke="#fffbea" stroke-width="1.6" stroke-linecap="round" pathLength="100" stroke-dasharray="5 95"/>
</svg>`;
})();
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
      <div class="tiny mt pass-rate">${ic('coin')} Гроші пропуску ростуть разом з гаражем: ${S.passHours(2).toFixed(1).replace('.', ',')}–${S.passHours(S.SEASON.levels).toFixed(1).replace('.', ',')} год його доходу за рівень${s.rate ? ` (зараз ${S.short(s.rate)}/год)` : ''}, мінімум ${S.short(S.passMoneyFor(2))}</div>
      ${s.ready ? `<button class="btn yellow mt" data-act="passClaim">${ic('gift')} Забрати нагороди · ${s.ready}</button>` : ''}</div>
    ${car ? `<div class="card center season-car"><div class="small muted">Рівень ${S.SEASON.levels} · преміум</div><div class="showroom">${SHOWROOM_SVG}<div class="sr-refl" aria-hidden="true">${carArt(car.id)}</div><div class="art">${carArt(car.id)}</div></div><b style="font-size:17px">${esc(car.name)}</b>
      <div class="small muted">${car.hp} к.с. · колекційна ${S.short(car.price)} · лише в цьому сезоні</div>
      ${s.premium ? `<div class="mt" style="color:var(--accent)">${ic('crown')} Преміум активний</div>` : `<button class="btn yellow mt" data-act="buyItem" data-id="pass">${ic('crown')} Преміум · ${ic('star')} ${S.SEASON.premiumStars}</button><div class="tiny muted mt">Нагороди правої доріжки за вже пройдені рівні — одразу після покупки</div>`}</div>` : ''}
    ${seasonCosStrip(s)}
    <div class="prow head"><span class="plvl">#</span><span>Безкоштовно</span><span>${ic('crown')} Преміум</span></div>
    <div class="ptable">${s.levels.map(row).join('')}</div>`;
};
AFTER.season = tickUntil;
// Keys of the pass open one by one with the case reel, the season car comes last (revealRewards).
H.passClaim = async () => {
  const cosText = (got) => got.map((g) => S.cosmeticOf(g.cosmetic)?.name).filter(Boolean);
  const r = await act('season/claim', {}, (r) => [`Нагород: ${r.got.length}`, r.money ? `+${S.short(r.money)}` : '', ...cosText(r.got)].filter(Boolean).join(' · '), { rerender: false });
  if (!r) return;
  pulseSoon();
  const items = [];
  for (const g of r.got) {
    const title = `Сезон · рівень ${g.level}${g.premium ? ' · преміум' : ''}`;
    if (g.caseId) items.push({ kind: 'key', caseId: g.caseId, count: g.count || 1, title });
    if (g.carOut) items.push({ kind: 'car', car: g.carOut, isNew: true, title });
  }
  items.sort((a, b) => (a.kind === 'car') - (b.kind === 'car'));
  if (items.length) await revealRewards(items);
  else await refresh();
};

// ---------- what's new (shown once per S.WHATS_NEW.id) ----------
const whatsNewKey = () => 'avtodrop-story-' + S.WHATS_NEW.id;
function whatsNewSeenHere() {
  try {
    return !!localStorage.getItem(whatsNewKey());
  } catch {
    return true; // no storage: don't show it on every start
  }
}
function whatsNew(force = false) {
  try {
    if (!force && localStorage.getItem(whatsNewKey())) return;
    localStorage.setItem(whatsNewKey(), '1');
  } catch {
    if (!force) return;
  }
  playStory(S.WHATS_NEW);
}
// The full-screen story player shared by "what's new" and the intro "how to play" (S.INTRO_STORY).
// The intro stands on the showroom stage: a real car on the turntable where the slide is about one (the wordmark
// above, the class badges under the «classes» slide), the line icon elsewhere.
const INTRO_CARS = { 'car-turbine': 'bugatti-chiron-super-sport', gift: 'zaz-965-horbatyi', coin: 'toyota-supra-a80', 'flag-3': 'nissan-skyline-gt-r-r34' };
const WORDMARK = '<span class="wordmark">АВТО<b>ДРОП</b></span>';
function playStory(story, onClose = () => {}) {
  let i = 0;
  const slides = story.slides;
  const el = document.createElement('div');
  el.className = 'story';
  const visual = (sl) => {
    const car = story === S.INTRO_STORY && INTRO_CARS[sl.icon];
    if (car && M(car)) return `<div class="season-car story-car"><div class="showroom">${SHOWROOM_SVG}<div class="sr-refl" aria-hidden="true">${carArt(car)}</div><div class="art">${carArt(car)}</div></div></div>`;
    return `<div class="story-ic">${ic(sl.icon)}</div>`;
  };
  const classes = (sl) => (story === S.INTRO_STORY && (sl.classes || sl.icon === 'diamond') ? `<div class="story-classes">${S.CLASS_ORDER.filter((k) => k !== 'X').map((k) => `<span class="stamp r${S.rankOf(k)}" style="--c:${S.CLASSES[k].color}"><b>${k}</b>${S.CLASSES[k].name}</span>`).join('')}</div>` : '');
  const paint = () => {
    const sl = slides[i];
    el.innerHTML = `<div class="story-bars">${slides.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('')}</div>
      ${story === S.INTRO_STORY ? `<div class="story-brand">${WORDMARK}</div>` : ''}
      <button class="story-skip">Пропустити</button>
      <div class="story-body">${visual(sl)}<div class="story-title disp">${esc(sl.title)}</div><div class="story-text">${esc(sl.text)}</div>${classes(sl)}</div>
      <button class="btn yellow story-next">${i < slides.length - 1 ? 'Далі' : story.last || 'Поїхали!'}</button>`;
  };
  const close = () => {
    el.remove();
    onClose();
  };
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

// ---------- «Перші кроки» (S.NEWBIE_TASKS; the server says which hint, me.guide, and which step, me.newbie) ----------
// One pill on top of the screen — the step, its reward, where to go — and a glowing ring around the button to press;
// a step done turns the pill into «Забрати». During the first few steps (S.GUIDE_FOCUS) reward banners and the
// level-up window stay away (a level-up is a toast instead) so nothing covers the path.
const guideOn = () => S.GUIDE_FOCUS.includes(me?.guide);
function guideKey() {
  if (!me?.guide) return null;
  // Right after a drop the next thing is the choice on the drop screen: keep it or sell it.
  if (guideOn() && state.tab === 'cases' && !state.page && state.drop?.some(dropAlive) && !me.keys.starter) return 'keep';
  return me.guide;
}
// The track as a card (profile, Завдання): every step with its reward, done ones ticked, the current one claimable.
function firstStepsCard(btnAct = 'newbieQuest') {
  const n = me.newbie;
  if (!n) return '';
  const row = (t, i) => {
    const st = i < n.step ? 'done' : i === n.step ? (n.ready ? 'ready' : 'on') : '';
    const lock = i === n.step && n.lockedTill ? ` · ${ic('lock')} рів. ${n.lockedTill}` : '';
    return `<div class="fs-row ${st}"><span class="fs-ic">${i < n.step ? ic('check') : i + 1}</span><span class="grow">${esc(t.text)}${lock}</span><b class="fs-rw">+${S.short(t.money).replace(' ₴', '')}</b></div>`;
  };
  return `<div class="h2"><span>Перші кроки</span><span>${n.step + 1}/${n.total}</span></div>
    <div class="card firststeps"><div class="fs-list">${S.NEWBIE_TASKS.map(row).join('')}</div>
      <button class="btn ${n.ready ? 'yellow' : ''} mt" data-act="${btnAct}" ${n.ready ? '' : 'disabled'}>${n.ready ? `${ic('gift')} Забрати +${S.fmt(n.money)} · +${S.XP.task} досвіду` : n.lockedTill ? `${ic('lock')} Відкриється на рівні ${n.lockedTill}` : `Крок ${n.step + 1}: ${esc(n.text)}`}</button></div>`;
}
function paintGuide() {
  document.querySelectorAll('.guide-hi').forEach((el) => el.classList.remove('guide-hi'));
  $('#guide')?.remove();
  const key = guideKey();
  // Only on the five main tabs (not over Магазин, Підтримка…), and never over a race, a drift run or a spinning case.
  if (!key || state.page || state.race || state.drift || state.opening) return paintNextUnlock();
  $('#nextUl')?.remove();
  const st = S.GUIDE_STEPS.find((s) => s.key === key);
  const nb = me.newbie;
  const ready = !!nb?.ready && key !== 'keep';
  const here = ready || !st.tab || st.tab === state.tab;
  const n = nb ? nb.step : 0, total = S.GUIDE_PATH.length;
  const open = here && guideOpen && !ready;
  // A slim progress pill (~36 px): on the step's own tab it says what to do and expands on tap (the hint text, hide);
  // on another tab it says where to go and takes you there. The step's reward sits on the right — a button once done.
  const el = document.createElement('div');
  el.id = 'guide';
  el.className = `guide pill${open ? ' open' : ''}${ready ? ' ready' : ''}`;
  const title = ready ? `${ic('check')} ${esc(nb.text)}` : `${here ? '' : `<span class="guide-to">${ic('arrow-right')}${TITLES[st.tab]}:</span> `}${esc(st.title)}`;
  const reward = nb ? (ready ? `<button class="guide-gift" data-act="newbieQuest" aria-label="Забрати нагороду за крок">${ic('gift')}Забрати +${S.short(nb.money).replace(' ₴', '')}</button>`
    : `<span class="guide-rw">+${S.short(nb.money).replace(' ₴', '')}</span>`) : '';
  el.innerHTML = `<div class="guide-bar"><button class="guide-main" data-act="${ready ? 'newbieQuest' : here ? 'guideToggle' : 'guideGo'}" aria-expanded="${open}">
      <span class="guide-dots">${S.GUIDE_PATH.map((_, i) => `<i class="${i < n ? 'done' : i === n ? 'on' : ''}"></i>`).join('')}</span>
      <span class="guide-t"><b>${n + 1}/${total}</b> ${title}</span>
      ${ready ? '' : `<span class="guide-chev">${ic('chevron-right')}</span>`}</button>
    ${reward}</div>
    ${open ? `<div class="guide-more"><div class="small">${esc(st.text)}</div><button class="guide-off" data-act="guideOff">Сховати підказки (повернути: Меню → Налаштування)</button></div>` : ''}`;
  $('#view').prepend(el);
  if (ready) return;
  const target = here ? $(st.target) : $(`#tabs button[data-tab="${st.tab}"]`);
  if (!target) return;
  target.classList.add('guide-hi');
  // Once per step: bring a target that is below the fold (the first rival) into view.
  // Only as far as needed to clear the tab bar: centring it pushed the freshly dropped car under the header.
  const below = target.getBoundingClientRect().bottom - (window.innerHeight - 96);
  if (here && guideScrolled !== key && below > 0) {
    guideScrolled = key;
    window.scrollBy({ top: below, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}
let guideScrolled = null;
let guideOpen = false;
H.guideToggle = () => {
  guideOpen = !guideOpen;
  paintGuide();
};
H.guideGo = () => {
  const st = S.GUIDE_STEPS.find((s) => s.key === guideKey());
  if (!st?.tab) return;
  state.tab = st.tab;
  state.page = null;
  if (st.tab === 'race') state.raceView = 'race';
  window.scrollTo(0, 0);
  render();
};
H.guideOff = async () => {
  if (!(await confirmBox('Сховати підказки перших кроків?'))) return;
  await act('guide/off', {}, 'Підказки сховано — увімкнути знову можна в Меню → Налаштування');
};
H.toggleGuide = async () => {
  const off = me.claims.includes('guide-off');
  if (!off) return H.guideOff();
  if (await act('guide/on', {}, null)) toast(me.guide ? 'Підказки перших кроків увімкнено' : 'Підказки увімкнено, але перші кроки вже пройдено');
};
let guideWas = null;
// Called after every refresh: the last step done → a small celebration.
function guideProgress() {
  if (guideWas !== me.guide) paintGuide();
  if (guideWas && !me.guide && !me.newbie && !me.claims.includes('guide-off')) {
    setTimeout(() => {
      toast('Перші кроки пройдено! Далі — щоденні завдання й тижневий маршрут');
      FX.burst(window.innerWidth / 2, 120, ['#f5b301', '#fff', '#34c759'], { count: 60, power: 7, shape: 'mix' });
      haptic('success');
    }, 400);
  }
  guideWas = me.guide;
}

// ---------- leaderboard ----------
PAGES.leaderboard = async () => {
  state.lbType = state.lbType || 'season';
  const lb = await api('leaderboard', { type: state.lbType });
  const segs = `<div class="seg">${[['season', 'Сезон'], ['week', 'Тиждень'], ['all', 'Весь час']].map(([k, t]) => `<button class="${state.lbType === k ? 'on' : ''}" data-act="lbType" data-k="${k}">${t}</button>`).join('')}</div>`;
  const crown = (r) => (r.vip ? `<span class="lb-vip">${ic('crown')}</span>` : '');
  // The top three stand on a podium (2 · 1 · 3), everyone else is a row with an initial; my row and bar are yellow.
  const board = (val, extra = () => '') => {
    const list = lb.list;
    const pod = list.length >= 3 ? `<div class="podium">${[1, 0, 2].map((i) => {
      const r = list[i];
      return `<button class="pod p${r.place} ${r.me ? 'me' : ''}" data-act="playerCard" data-id="${r.id}"><span class="pod-ava">${esc(initialOf(r.name))}${crown(r)}</span>
        <b class="ellipsis">${nameHtml(r.name, r.style)}</b><span class="pod-val">${val(r)}</span><span class="pod-step"><span class="medal m${r.place}">${r.place}</span></span></button>`;
    }).join('')}</div>` : '';
    const rest = list.length >= 3 ? list.slice(3) : list;
    const rows = rest.map((r) => `<button class="lb ${r.me ? 'me' : ''}" data-act="playerCard" data-id="${r.id}"><span class="pl">${r.place <= 3 ? `<span class="medal m${r.place}">${r.place}</span>` : r.place}</span><span class="lb-ava">${esc(initialOf(r.name))}</span><span class="grow ellipsis">${nameHtml(r.name, r.style)}${crown(r)}</span>${extra(r)}<b>${val(r)}</b></button>`).join('');
    return pod + (rows ? `<div class="list">${rows}</div>` : '');
  };
  const empty = (t) => emptyBox('trophy', t, 'Відкривай кейси й ганяй — і твоє ім’я з’явиться тут');
  if (lb.type === 'season') {
    const p = lb.prizes;
    return `${segs}<div class="card lb-head"><div class="row between"><b class="disp">Сезон ${lb.season}</b><span class="chip">${ic('clock')} <span data-until="${lb.endsAt - clockOffset}"></span></span></div>
      <div class="tiny muted mt">Місце — за досвідом сезону: гонки, кейси, завдання. Донат тут не вирішує. Наприкінці сезону топ-10 отримує зірки на рахунок, топ-${lb.badgeTop} — значок назавжди.</div>
      <div class="prizes"><div><span class="medal m1">1</span>${ic('star')} ${p[0]}</div><div><span class="medal m2">2</span>${ic('star')} ${p[1]}</div><div><span class="medal m3">3</span>${ic('star')} ${p[2]}</div><div><span>${ic('trophy')}</span>4–10: ${ic('star')} ${p[3]}</div></div></div>
      ${lb.list.length ? board((r) => r.score.toLocaleString('uk-UA'), (r) => `<span class="chip">рів. ${r.level}</span>`) : empty('Сезон щойно почався')}
      <div class="mybar"><span>Ти: #${lb.me.place}</span><span class="grow"></span><span>${lb.me.score.toLocaleString('uk-UA')} досвіду</span></div>`;
  }
  const week = lb.type === 'week';
  return `${segs}
    ${week ? `<div class="card lb-head"><div class="row between"><b class="disp">Гонка тижня</b><span class="chip">${ic('clock')} <span data-until="${lb.endsAt - clockOffset}"></span></span></div>
      <div class="tiny muted mt">Місце — за тим, наскільки виросла колекційна вартість твого гаража з понеділка (не сума продажу)</div>
      <div class="prizes"><div><span class="medal m1">1</span>${S.short(lb.prizes[0])}</div><div><span class="medal m2">2</span>${S.short(lb.prizes[1])}</div><div><span class="medal m3">3</span>${S.short(lb.prizes[2])}</div><div><span>${ic('trophy')}</span>4–10: ${S.short(lb.prizes[3])}</div></div></div>`
      : '<div class="tiny muted" style="margin:0 2px 10px">Колекційна вартість гаража: ціни моделей з деталями й номерами, вітрина та номери. Це не сума продажу — її видно в гаражі</div>'}
    ${lb.list.length ? board((r) => `${week ? '+' : ''}${S.short(r.score)}`) : empty('Поки порожньо')}
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
  if (showcase) return sheet(`Вітрина ${esc(p.name)}`, p.showcase.length ? `<div class="grid${showcaseBackdrop(p.style)}">${p.showcase.map((c) => carTile(withFrame(c, p.style), { act: 'noop' })).join('')}</div>` : emptyBox('building-arch', 'Вітрина порожня', 'Гравець ще не виставив жодної машини'), () => H.playerCard(d));
  sheet('Картка гравця', `${licenceCard({ id: p.id, name: p.name, level: p.level, vip: p.vip, badges: p.badges, legacy: p.legacy, style: p.style, top: p.top || (p.best ? [p.best] : []),
      value: p.value, cases: p.stats?.cases, wins: p.stats?.wins, coll: collPct(p.collection) })}
    <div class="row between small muted mt" style="padding:0 2px"><span>${p.carCount} ${plural(p.carCount, ['машина', 'машини', 'машин'])} · ${p.collection} у колекції</span><span>${p.stats?.races ? `${Math.round((p.stats.wins / p.stats.races) * 100)}% перемог` : ''}</span></div>
    <div class="btns mt"><button class="btn ${p.self ? '' : 'ghost'}" data-act="playerShowcase" data-id="${p.id}">${ic('building-arch')} Вітрина · ${p.showcase.length}</button>
    ${p.self ? '' : `<button class="btn" data-act="tradeWith" data-id="${p.id}">${ic('arrows-exchange')} Обмін</button>`}</div>`);
};
H.playerShowcase = (d) => H.playerCard(d, null, null, true);
H.noop = () => {};
H.tradeWith = async (d) => {
  if (!isOpen('trades')) return lockedSheet('trades');
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
  const garage = me.cars.filter((c) => c.status === 'garage' && !S.isCollector(c.model)).sort((a, b) => b.value - a.value || b.id - a.id);
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
    ${stake ? `<div class="chips mt">${[1.5, 2, 3, 5, 10, 20].map((k) => `<button data-act="upMult" data-k="${k}">×${dec(k, k % 1 ? 1 : 0)}</button>`).join('')}</div>` : ''}
    <button class="btn yellow" data-act="doUpgrade" ${stake && t && !U.spinning ? '' : 'disabled'}>${t && stake ? `Апгрейд · шанс ${pct(chance * 100)}` : 'Апгрейд'}</button>
    ${chosen.length ? `<div class="small center mt hn-upsale"><span class="muted">Твої авто: продаж зараз</span> <b>${S.short(sellTotal(chosen))}</b>${t ? ` <span class="muted">→ ціль: продаж потім ≈</span> <b>${S.short(S.sellPriceOf(t.id, 0, chosen.reduce((o, c) => (S.originSellOf(c.origin) < S.originSellOf(o) ? c.origin : o), null)))}</b>` : ''}</div>` : ''}
    <div class="tiny muted center mt">До ${S.UPGRADE.maxCars} машин (рахується колекційна ціна моделей, без деталей і номерів). Кожна додаткова −${S.UPGRADE.perExtraCar * 100}% шансу. Виграв — отримуєш ціль, програв — авто згорають. Деталі й номери з них повертаються на склад у будь-якому разі.</div>
    <div class="h2"><span>Твої авто · ${U.cars.size}/${S.UPGRADE.maxCars}</span><span>${S.short(stake)}</span></div>
    <div class="grid">${garage.map((c) => carTile(c, { act: 'upCar', sel: U.cars.has(c.id) })).join('')}</div>
    ${list.length ? `<div class="h2"><span>Ціль</span><span>${list.length}</span></div>
      <div class="list">${[...list].reverse().map((m) => `<button class="li ${m.id === U.target ? 'on' : ''}" data-act="upTarget" data-id="${m.id}"><div class="mini art">${carArt(m.id)}</div>
        <div class="grow"><b class="ellipsis">${esc(m.name)}</b><div class="small muted">${clsBadge(m.cls)} ${S.short(m.price)} · ×${dec(m.price / stake, 1)}</div></div><b class="${S.upgradeChance(stake, m.price, state.up.cars.size) >= 0.5 ? 'win' : ''}">${pct(S.upgradeChance(stake, m.price, state.up.cars.size) * 100)}</b></button>`).join('')}</div>` : ''}`;
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
const upgradeBase = PAGES.upgrade;
// The casino is reachable only from here (not from the menu).
// Switched off by the owner: no way in at all; below its level: the lock card.
PAGES.upgrade = () => upgradeBase() + (casinoOff() ? '' : isOpen('casino')
  ? `<button class="li mt" data-act="go" data-page="casino" style="justify-content:center;color:var(--muted)">${ic('cards')} Казино на удачу — ${me.casino === 'wheel' ? 'рулетка' : 'краш, міни, рулетка, слоти'} · 18+</button>`
  : `<button class="li mt locked" data-act="locked" data-k="casino" style="justify-content:center;color:var(--muted)">${ic('lock')} Казино · відкриється на рівні ${S.unlockLevel('casino')}</button>`);
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
  const cap = Math.max(S.CASINO.minBet, S.casinoMaxBet(me.balance));
  const v = Math.max(S.CASINO.minBet, Math.min(cap, Math.round(num($('#betIn')?.value) || state.cas.bet)));
  state.cas.bet = v;
  return v;
}
const betRow = () => `<div class="bet"><button data-act="betAdj" data-k="min">Мін</button><button data-act="betAdj" data-k="half">½</button><input id="betIn" inputmode="numeric" value="${grp(state.cas.bet)}"><button data-act="betAdj" data-k="double">×2</button><button data-act="betAdj" data-k="max">Макс</button></div>`;
H.betAdj = (d) => {
  const b = readBet();
  const cap = Math.max(S.CASINO.minBet, S.casinoMaxBet(me.balance));
  const v = { min: S.CASINO.minBet, half: Math.floor(b / 2), double: b * 2, max: cap }[d.k];
  state.cas.bet = Math.max(S.CASINO.minBet, Math.min(cap, v));
  if (d.k === 'max' || (d.k === 'double' && b * 2 > cap)) toast(`Максимум — половина балансу: ${S.short(cap)}`);
  $('#betIn').value = grp(state.cas.bet);
};
const winRank = (mult) => (mult >= 50 ? 4 : mult >= 10 ? 3 : mult >= 3 ? 2 : mult > 1 ? 1 : 0);
function casinoWinFx(mult, target) {
  if (mult <= 0) return haptic('error');
  haptic(mult >= 3 ? 'heavy' : 'success');
  FX.celebrate(winRank(mult), mult >= 10 ? '#ffd500' : '#22c55e', { target });
}
// Responsible play: on every casino screen (Telegram's rules on gambling-like games — see the reports).
const casinoWarn = `<div class="casino-warn">${ic('info-circle')}<div><b>18+ · лише ігрові гривні</b><div class="tiny">Гривні не виводяться й не обмінюються на реальні гроші чи призи. Казино завжди має перевагу 3–5% — на дистанції воно виграє. Грай заради фану й роби перерви.</div></div></div>`;
PAGES.casino = async () => {
  const games = [['crash', 'rocket', 'Краш'], ['mines', 'bomb', 'Міни'], ['roulette', 'chart-donut', 'Рулетка'], ['slots', 'cherry', 'Слоти']].filter(([k]) => S.casinoGameOpen(me.casino, k));
  if (!games.some(([k]) => k === state.cas.game)) state.cas.game = games[0][0];
  const G = state.cas.game;
  const seg = (games.length > 1 ? `<div class="seg">${games.map(([k, icon, t]) => `<button class="${G === k ? 'on' : ''}" data-act="casGame" data-k="${k}">${ic(icon)}${t}</button>`).join('')}</div>` : '') + casinoWarn;
  const note = '<div class="tiny muted center mt">18+ · Гра на ігрові гривні, без виводу. Казино завжди має невелику перевагу (3–5%) — грай заради фану.</div>';
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
  const lastTxt = g && !running ? (g.status === 'won' ? `<div class="mult won">×${dec(g.cashout, 2)}</div><div class="sub">виграш ${S.fmt(g.won)} · краш на ×${dec(g.point, 2)}</div>` : `<div class="mult lost">КРАШ ×${dec(g.point, 2)}</div><div class="sub">ставка ${S.fmt(g.bet)} згоріла</div>`) : '';
  // Green = you cashed out (your multiplier, crash point after the slash); red = it crashed on you.
  const histChip = (r) => (r.status === 'won'
    ? `<span class="hi" title="забрав ×${dec(r.cashout, 2)}, краш на ×${dec(r.point, 2)}">✓ ×${dec(r.cashout, 2)}<i>/ ×${dec(r.point, 2)}</i></span>`
    : `<span title="краш на ×${dec(r.point, 2)}">${ic('flame')} ×${dec(r.point, 2)}</span>`);
  return `<div class="hist">${h.last.map(histChip).join('') || '<span class="muted">ще немає ігор</span>'}</div>
    <div class="crashbox" id="crashBox"><svg viewBox="0 0 340 220" preserveAspectRatio="none"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5b301" stop-opacity=".45"/><stop offset="1" stop-color="#f5b301" stop-opacity="0"/></linearGradient></defs>
      <path id="crashFill" fill="url(#cg)" d=""/><path id="crashPath" fill="none" stroke="#f5b301" stroke-width="3" d=""/></svg>
      <div class="rocket" id="crashRocket" style="left:6%;top:88%"></div>
      ${running ? '<div class="mult" id="crashMult">×1,00</div><div class="sub" id="crashSub">тисни «Забрати», поки не вибухнуло</div>' : lastTxt || '<div class="mult" id="crashMult">×1,00</div><div class="sub">зроби ставку</div>'}</div>
    <div class="mt">${betRow()}</div>
    <div class="row mt"><span class="small muted" style="white-space:nowrap">Автовивід ×</span><input id="autoIn" inputmode="decimal" placeholder="напр. 2,00" value="${state.cas.auto || ''}"></div>
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
    if (el) el.textContent = '×' + dec(m, 2);
    crashShown = m;
    const btn = $('#crashBtn');
    if (btn) btn.textContent = `Забрати · ×${dec(m, 2)} · ${S.short(Math.floor(g.bet * m))}`;
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
  const head = g ? (running ? `<div class="row between"><span>Ставка <b>${S.short(g.bet)}</b> · мін ${g.mines}</span><span>×<b>${dec(g.mult, 2)}</b>${g.next ? ` <span class="muted small">→ ×${dec(g.next, 2)}</span>` : ''}</span></div>`
    : g.status === 'won' ? `<div class="center win" style="font-size:20px;font-weight:900">Виграш ${S.fmt(g.won)} · ×${dec(g.mult, 2)}</div>` : '<div class="center lose" style="font-size:20px;font-weight:900">Бум! Ставка згоріла</div>') : '<div class="center muted small">Відкривай клітинки з діамантами. Що більше мін — то швидше росте множник.</div>';
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
    ${betRow()}<div class="tiny muted mt">Обери суму і тисни на поля — можна ставити на ${S.CASINO.rouletteFields} поля одразу; разом не більше половини балансу. Число платить 35:1, дюжини 2:1, решта 1:1.</div>
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
  { const tot = Object.values(state.cas.rbets).reduce((a, x) => a + x, 0) + amount, cap = S.casinoMaxBet(me.balance, S.CASINO.rouletteTotal);
    if (tot > cap) return toast(`Усі ставки за спін — не більше половини балансу: ${S.short(cap)}`, true); }
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
// Stars buy looks and VIP, not progress (owner, audit §2 №10): two tabs — «Магазин» (the one starter pack, the VIP
// subscription with the one-off VIP as a fallback, the pass, conveniences) and «Стиль» (S.STYLE_ITEMS: plate frames,
// showcase backdrops, liveries, name colour, underglow — owned for good, worn per slot, seen by other players).
const storeBuyBtns = (x, sh, cls = 'yellow') => `<div class="row" style="gap:6px"><button class="btn sm ${cls}" data-act="buyItem" data-id="${x.id}" ${config.stars ? '' : 'disabled'}>${ic('star')} ${x.price}</button>${sh.stars >= x.price ? `<button class="btn sm ghost" data-act="buyItemStars" data-id="${x.id}" data-p="${x.price}">з рахунку</button>` : ''}</div>`;
const kyivDate = (t) => new Date(t).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', timeZone: 'Europe/Kyiv' });
PAGES.store = async () => {
  const sh = await api('shop');
  state.storeView ||= 'shop';
  const seg = `<div class="seg st-seg">${[['shop', 'star', 'Магазин'], ['style', 'sparkles', 'Стиль']].map(([k, i, t]) => `<button class="${state.storeView === k ? 'on' : ''}" data-act="storeView" data-k="${k}">${ic(i)} ${t}</button>`).join('')}</div>`;
  const top = `${config.stars ? '' : `<div class="notice">${ic('info-circle')}<span>Оплата зірками запрацює після підключення бота (BOT_TOKEN).</span></div>`}
  <div class="card row stars-card"><span class="ic tint" style="--c:#ffc400">${ic('star')}</span><div class="grow"><b>Зірки на рахунку</b><div class="tiny muted">призи сезону — можна витратити тут</div></div><b class="disp stars-n">${sh.stars}</b></div>`;
  const foot = `<div class="tiny muted center mt">Оплата через Telegram Stars, усе зараховується одразу. Зірки на рахунку — призи сезону. Ігрові цінності не можна вивести чи обміняти на реальні гроші. Питання — /paysupport у боті.</div>`;
  return seg + top + (state.storeView === 'style' ? styleView(sh) : storeMain(sh)) + foot;
};
function storeMain(sh) {
  const it = Object.fromEntries(sh.items.map((x) => [x.id, x]));
  const vipLeft = sh.vipUntil > serverNow();
  const sub = sh.sub;
  const st = it.starter;
  const starter = sh.starterBought ? '' : `<div class="card offer st-starter"><div class="row between"><b class="disp" style="font-size:19px">${esc(st.name)}</b><span class="chip">${ic('lock')} 1 раз на акаунт</span></div>
    <div class="tiny muted">Єдині гривні за зірки — невеликий поштовх на старті</div>
    <div class="offer-list"><span>${ic('coin')} ${S.short(st.money)}</span><span>${ic('gift')} 2 × кейс «${esc(S.CASE_BY_ID.city.name)}»</span><span>${ic('crown')} VIP на ${st.vipDays} дні</span></div>
    <div class="row between mt"><span class="tiny muted">Більше не з’явиться</span>${storeBuyBtns(st, sh)}</div></div>`;
  const perks = [['gas-station', 'Пальне відновлюється вдвічі швидше'], ['clock', `Каса гаража копить на ${S.VIP.extraHours} год довше`], ['gift', `+${S.short(S.VIP.daily)} до щоденного бонусу`],
    ['droplet', 'Автомийка — безкоштовно'], ['building-store', `${S.ITEM_MARKET.vipLots} лотів деталей і номерів на ринку замість ${S.ITEM_MARKET.lots}`], ['crown', 'Корона в рейтингу й профілі']];
  const subBox = sub ? (sub.canceled
    ? `<div class="vip-sub off"><div class="grow"><b>Автопродовження вимкнено</b><div class="tiny muted">VIP діє до ${kyivDate(sh.vipUntil)}, далі зірки не списуються</div></div><button class="btn sm yellow" data-act="vipSub" data-cancel="0">Відновити</button></div>`
    : `<div class="vip-sub"><div class="grow"><b>${ic('check')} Підписка діє</b><div class="tiny muted">Наступне списання ${kyivDate(sub.expiresAt)} · ${ic('star')} ${sub.stars}</div></div><button class="btn sm ghost" data-act="vipSub" data-cancel="1">Скасувати</button></div>`)
    : `<div class="row between mt vip-buy"><div><b class="vip-price">${ic('star')} ${it.vipsub.price}<small> / ${S.VIP_SUB.days} днів</small></b><div class="tiny muted">дешевше, ніж 2 × ${S.VIP.days} днів (${it.vip.price * 2} ⭐)</div></div>
        <button class="btn sm yellow" data-act="buyItem" data-id="vipsub" ${config.stars ? '' : 'disabled'}>Оформити</button></div>
      <div class="tiny muted mt">Продовжується сама кожні ${S.VIP_SUB.days} днів. Скасувати можна будь-коли — тут або в Telegram: Налаштування → Мої зірки. Оплачений строк лишається.</div>`;
  const vip = `<div class="card vip-card"><div class="row between"><b class="disp" style="font-size:19px;color:var(--accent)">${ic('crown')} VIP-підписка</b>${vipLeft ? `<span class="chip">ще <span data-until="${sh.vipUntil - clockOffset}"></span></span>` : ''}</div>
    <div class="vip-list">${perks.map(([i, t]) => `<span>${ic(i)} ${t}</span>`).join('')}</div>
    ${subBox}
    <div class="vip-once"><div class="grow"><b>Разово · ${S.VIP.days} днів</b><div class="tiny muted">${vipLeft ? 'додасться до поточного VIP' : 'без автопродовження'}</div></div>${storeBuyBtns(it.vip, sh, 'ghost')}</div></div>`;
  return `${starter}${vip}
  <button class="card row st-style-promo" data-act="storeView" data-k="style"><span class="ic tint" style="--c:#b48cff">${ic('sparkles')}</span><div class="grow"><b>Стиль</b><div class="tiny muted">рамки номерів, фони вітрини, лівреї, колір імені — лише вигляд, без характеристик</div></div><span class="chev">${ic('chevron-right')}</span></button>
  <div class="card row"><span class="ic tint" style="--c:#ffc400">${ic('ticket')}</span><div class="grow"><b>Преміум-пропуск · Сезон ${me.season.id}</b><div class="tiny muted">Друга доріжка нагород і машина сезону</div></div>${sh.premium ? '<span class="chip">куплено</span>' : storeBuyBtns(it.pass, sh)}</div>
  <div class="h2"><span>Зручності</span></div>
  ${[['refuel', 'gas-station', `Пальне ${S.FUEL_MAX}/${S.FUEL_MAX} одразу`], ['cool', 'wind', 'Зняті деталі одразу готові'], ['slot', 'building-warehouse', `Зараз ${me.slots} місць · кожне наступне ×2`]].map(([id, icon, sub]) => `<div class="card row"><span class="ic tint" style="--c:#8a94a7">${ic(icon)}</span><div class="grow"><b>${esc(it[id].name)}</b><div class="tiny muted">${sub}</div></div>${storeBuyBtns(it[id], sh, 'ghost')}</div>`).join('')}`;
}
// ---- «Стиль»: classes of what a player wears (S.styleWorn ids → CSS), used on every screen that shows a player ----
const styleCls = (prefix, id) => { const l = id && S.styleLook(id); return l ? ` ${prefix}-${l}` : ''; };
const nameCls = (style) => styleCls('nm', style?.name).trim();
const nameHtml = (name, style) => (style?.name ? `<span class="${nameCls(style)}">${esc(name)}</span>` : esc(name));
// The car a player is shown with: carries the owner's plate frame (null = none) for plate().
const withFrame = (c, style) => (c ? { ...c, pf: style?.frame || null } : c);
function styleView(sh) {
  const owned = new Set(me.claims || []);
  const worn = me.style || {};
  const sample = me.cars.filter((c) => c.status !== 'auction').sort((a, b) => b.value - a.value)[0];
  const lvCar = me.cars.filter((c) => PAINT.canPaint(c.model)).sort((a, b) => b.value - a.value)[0];
  const myName = me.username ? '@' + me.username : me.firstName || 'Гравець';
  const tile = (it) => {
    const own = owned.has(it.cos), on = worn[it.kind] === it.cos;
    const pv = it.kind === 'frame' ? `<span class="sty-pv">${plate(sample?.plate?.text || 'AA 7777 AA', 'sm', it.cos)}</span>`
      : it.kind === 'showcase' ? `<span class="sty-pv sty-bg sc-${it.look}"></span>`
      : it.kind === 'name' ? `<span class="sty-pv"><b class="nm-${it.look}">${esc(myName.replace(/^@/, '').slice(0, 9))}</b></span>`
      : it.kind === 'glow' ? `<span class="sty-pv sty-glow gl-${it.look}"><span class="art">${sample ? carArt(sample.model) : ''}</span></span>`
      : `<span class="sty-pv sty-lv"><span class="art">${lvCar ? carArt(lvCar.model, { look: { paint: null, livery: it.look, n: 7 } }) : ''}</span></span>`;
    const btn = !own ? storeBuyBtns({ id: it.id, price: it.stars }, sh, 'yellow')
      : it.kind === 'livery' ? `<button class="btn sm ghost" data-act="styleLivery" data-id="${it.look}">${ic('brush')} Нанести</button>`
      : on ? `<button class="btn sm ghost on" data-act="styleEquip" data-slot="${it.kind}" data-id="">${ic('check')} Надіто · зняти</button>`
      : `<button class="btn sm" data-act="styleEquip" data-slot="${it.kind}" data-id="${it.cos}">Надіти</button>`;
    return `<div class="sty-item ${own ? 'own' : ''} ${on ? 'on' : ''}">${pv}<div class="sty-tx"><b>${esc(it.name)}</b><small>${own ? `${ic('check')} твоє` : esc(it.hint)}</small></div>${btn}</div>`;
  };
  // Season cosmetics the player earned sit in the same slots (frame, backdrop), so they can be put back on here.
  const season = S.ownedCosmetics(me.claims).filter((c) => c.season && (c.kind === 'frame' || c.kind === 'showcase'));
  const seasonRow = (kind) => season.filter((c) => c.kind === kind).map((c) => {
    const on = worn[kind] === c.id;
    return `<div class="sty-item own ${on ? 'on' : ''}">${kind === 'frame' ? `<span class="sty-pv">${plate(sample?.plate?.text || 'AA 7777 AA', 'sm', c.id)}</span>` : `<span class="sty-pv sty-bg sc-season" data-season="${c.season}"></span>`}<div class="sty-tx"><b>${esc(c.name)}</b><small>${ic('trophy')} нагорода сезону</small></div>
      ${on ? `<button class="btn sm ghost on" data-act="styleEquip" data-slot="${kind}" data-id="">${ic('check')} Надіто · зняти</button>` : `<button class="btn sm" data-act="styleEquip" data-slot="${kind}" data-id="${c.id}">Надіти</button>`}</div>`;
  }).join('');
  const sections = Object.entries(S.STYLE_KINDS).map(([kind, k]) => `<div class="h2"><span>${ic(k.icon)} ${k.title}</span><span>${ic('star')} ${S.STYLE_ITEMS.find((x) => x.kind === kind).stars}</span></div>
    <div class="tiny muted sty-where">${esc(k.where)}</div>
    <div class="sty-list">${seasonRow(kind)}${S.STYLE_ITEMS.filter((x) => x.kind === kind).map(tile).join('')}</div>`).join('');
  // «Як тебе бачать»: the name, a plate with the frame and the showcase backdrop with the underglow, as others see them.
  const preview = `<div class="card sty-me"><div class="row between"><b>Як тебе бачать інші</b><span class="tiny muted">рейтинг · картка · ринок</span></div>
    <div class="sty-me-row"><span class="lb-ava">${esc(initialOf(myName))}</span><b class="grow ellipsis">${nameHtml(myName, worn)}</b>${sample?.plate ? plate(sample.plate.text, 'sm') : plate('AA 7777 AA', 'sm', worn.frame || null)}</div>
    ${sample ? `<div class="grid sty-me-sc${showcaseBackdrop(worn)}">${carTile(sample, { act: 'noop' })}</div>` : ''}</div>`;
  return `<div class="notice sty-note">${ic('sparkles')}<span>Лише вигляд — жодних характеристик і переваг у гонках. Куплене лишається назавжди, надягати й знімати можна будь-коли.</span></div>${preview}${sections}`;
}
H.goStyle = () => {
  state.storeView = 'style';
  state.tab = 'menu';
  go('store');
};
H.storeView = (d) => {
  state.storeView = d.k;
  render().then(() => window.scrollTo(0, 0));
};
H.styleEquip = (d) => act('style/equip', { slot: d.slot, id: d.id || '' }, d.id ? 'Надіто — це бачать інші гравці' : 'Знято');
// A livery bought in «Стиль» is applied in the paint shop (free on any own car).
H.styleLivery = (d) => {
  if (!isOpen('paint')) return lockedSheet('paint');
  state.tab = 'shop';
  state.page = null;
  state.shopView = 'paint';
  state.paintMode = 'livery';
  const c = me.cars.find((x) => x.id === state.paintCar && PAINT.canPaint(x.model)) || me.cars.filter((x) => PAINT.canPaint(x.model) && x.status !== 'market' && x.status !== 'auction').sort((a, b) => b.value - a.value)[0];
  if (c) state.paintCar = c.id;
  state.paintDraft = c ? { ...curLook(c), livery: d.id } : null;
  render();
};
// Cancel / resume the renewal of the VIP subscription (Telegram editUserStarSubscription through the server).
H.vipSub = async (d) => {
  const cancel = d.cancel === '1';
  if (cancel && !(await confirmBox('Вимкнути автопродовження VIP? Оплачений строк лишається, далі зірки не списуватимуться.'))) return;
  act('shop/sub', { cancel }, cancel ? 'Автопродовження вимкнено' : 'Підписку відновлено');
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
// ---- home-screen shortcut (WebApp.addToHomeScreen / checkHomeScreenStatus, Bot API 8.0): from the 3rd day in the
// game a card in the menu offers it; one «Міський» key once Telegram says the shortcut is there. Old clients: nothing.
let homeState = { status: null, asked: false, hooked: false };
const homeCan = () => !!(tgAt('8.0') && typeof tg.addToHomeScreen === 'function' && typeof tg.checkHomeScreenStatus === 'function');
async function homeClaim() {
  if (!me?.homeOffer || homeState.claiming) return;
  homeState.claiming = true;
  try {
    const r = await api('home/added');
    if (r.caseId) toast(`Ярлик додано! +${r.count} ключ «${S.CASE_BY_ID[r.caseId].name}»`), haptic('success');
    await refresh();
  } catch {}
  homeState.claiming = false;
}
function homeCheck() {
  if (!me?.homeOffer || !homeCan() || homeState.asked) return;
  homeState.asked = true;
  try {
    if (!homeState.hooked) {
      homeState.hooked = true;
      tg.onEvent?.('homeScreenAdded', () => ((homeState.status = 'added'), homeClaim()));
    }
    tg.checkHomeScreenStatus((status) => {
      homeState.status = status;
      if (status === 'added') return homeClaim();
      if (state.tab === 'menu' && !state.page && (status === 'missed' || status === 'unknown')) render();
    });
  } catch {}
}
const homeCard = () => (me?.homeOffer && homeCan() && (homeState.status === 'missed' || homeState.status === 'unknown')
  ? `<button class="hub-home" data-act="homeAdd"><span class="hub-ic">${ic('layout-grid')}</span><span class="grow"><b>Додай АВТОДРОП на головний екран</b><span class="hub-i">гра відкриватиметься одним тапом · +${S.HOME_SCREEN.count} ключ «${esc(S.CASE_BY_ID[S.HOME_SCREEN.caseId].name)}»</span></span><span class="chev">${ic('chevron-right')}</span></button>` : '');
H.homeAdd = () => {
  try {
    tg.addToHomeScreen();
  } catch {
    toast('Цей Telegram не вміє додавати ярлик', true);
  }
};
// ---- emoji status (WebApp.setEmojiStatus, Bot API 8.0): after a career milestone (a country's final boss, the
// «Бос усіх босів» above all) the game offers its 🏁 custom emoji (EMOJI_STATUS_ID) for the player's Telegram status.
const emojiCan = () => !!(config.emojiStatus && tgAt('8.0') && typeof tg.setEmojiStatus === 'function');
const emojiOffer = (title) => (emojiCan() ? `<button class="btn ghost emoji-offer" data-act="emojiStatus" data-t="${esc(title)}">${ic('flag-3')} Постав 🏁 у статус Telegram</button>` : '');
H.emojiStatus = () => {
  if (!emojiCan()) return;
  try {
    tg.setEmojiStatus(config.emojiStatus, {}, (ok) => {
      if (!ok) return;
      haptic('success');
      toast('🏁 тепер біля твого імені в Telegram');
      api('emoji/set', { kind: 'career' }).catch(() => {});
    });
  } catch {}
};
PAGES.friends = async () => {
  const r = await api('ref');
  return `<div class="card center"><div style="font-size:36px;color:var(--accent)">${ic('users')}</div><b class="disp" style="font-size:20px">КЛИЧ ДРУЗІВ</b>
    <div class="muted mt">За кожного друга — <b class="win">${S.fmt(S.REF_REWARD)}</b> тобі, коли він досягне 3 рівня, а йому — ${S.fmt(S.REF_FRIEND_BONUS)} і кейс «${esc(S.CASE_BY_ID[S.REF_FRIEND_KEY].name)}» на старт та ще ${S.fmt(S.REF_FRIEND_L3)} на 3 рівні</div>
    ${r.link ? `<div class="mono mt">${esc(r.link)}</div><div class="btns mt"><button class="btn" data-act="shareRef" data-link="${esc(r.link)}">Поділитися</button><button class="btn ghost" data-act="copyRef" data-link="${esc(r.link)}">Скопіювати</button></div>` : '<div class="small muted mt">Посилання з’явиться після підключення бота</div>'}</div>
    <div class="stat" style="grid-template-columns:1fr 1fr"><div><b>${r.invited}</b><span>запрошено</span></div><div><b>${S.short(r.earned)}</b><span>зароблено</span></div></div>`;
};
H.copyRef = (d) => navigator.clipboard?.writeText(d.link).then(() => toast('Скопійовано'));
H.shareRef = (d) => {
  const url = `https://t.me/share/url?url=${encodeURIComponent(d.link)}&text=${encodeURIComponent(d.text || 'Збирай справжні авто, тюнінгуй і ганяй дрег в АВТОДРОП 🏎')}`;
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
  // Grouped by day; the first emoji of a notice becomes its icon tile.
  const day = (t) => new Date(t).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
  const today = day(Date.now()), yest = day(Date.now() - 86400e3);
  const groups = [];
  for (const e of [...list].sort((a, b) => b.at - a.at)) {
    const d = day(e.at);
    if (groups.at(-1)?.d !== d) groups.push({ d, list: [] });
    groups.at(-1).list.push(e);
  }
  const split = (text) => {
    const m = /^(\p{Extended_Pictographic}️?)\s*/u.exec(text);
    return m ? [m[1], text.slice(m[0].length)] : ['', text];
  };
  return list.length ? groups.map((g) => `<div class="h2"><span>${g.d === today ? 'Сьогодні' : g.d === yest ? 'Учора' : g.d}</span></div><div class="list events">${g.list.map((e) => {
    const [emo, text] = split(e.text);
    return `<div class="li"><span class="ic ev-ic">${emo ? esc(emo) : ic('bell')}</span><div class="grow">${esc(text)}<div class="tiny muted">${new Date(e.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</div></div></div>`;
  }).join('')}</div>`).join('') : emptyBox('bell', 'Сповіщень поки немає', 'Тут з’являться перемоги, продажі, ставки й обміни');
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
  return `${honestGlossary()}<div class="card small">Кожне відкриття = HMAC-SHA256(серверний сід, «клієнтський сід:номер:0») → клас, «…:1» → предмет. Хеш серверного сіда видно заздалегідь, сам сід розкривається після заміни — тоді будь-який дроп можна перевірити.</div>
    <div class="card"><div class="small muted">Хеш поточного серверного сіда</div><div class="mono">${me.fair.seedHash}</div>
    <div class="small muted mt">Клієнтський сід</div><div class="row mt"><input id="cseed" value="${esc(me.fair.clientSeed)}"><button class="btn sm" data-act="saveSeed">OK</button></div>
    <div class="small muted mt">Відкриттів на цьому сіді: ${me.fair.nonce}</div><button class="btn ghost mt" data-act="rotateSeed">Замінити сід і розкрити поточний</button></div>
    <div class="h2"><span>Останні дропи</span></div><div class="list">${hist.length ? hist.map((h) => `<div class="li"><div class="grow small">${clsBadge(h.cls)} <b>${esc(label(h))}</b>${h.forced ? ' <span class="chip">гарантія</span>' : ''}<div class="tiny muted">${esc((S.CASE_BY_ID[h.caseId] || S.PART_CASE_BY_ID[h.caseId]).name)} · #${h.nonce}</div></div>
      ${seeds[h.seedHash] ? `<button class="btn sm ghost" data-act="verify" data-seed="${seeds[h.seedHash]}" data-hash="${h.seedHash}" data-cs="${esc(h.clientSeed)}" data-n="${h.nonce}" data-case="${h.caseId}" data-cls="${h.cls}" data-item="${h.item}" data-forced="${h.forced}">Перевірити</button>` : '<span class="tiny muted">сід ще не розкрито</span>'}</div>`).join('') : '<div class="empty">Ще немає дропів</div>'}</div>`;
};
// Glossary of the two numbers every car shows (honest numbers, audit №1): on «Чесна гра» and behind the garage total.
const honestGlossary = () => `<div class="card small hn-gloss"><b>Дві ціни машини</b>
  <div class="mt"><b>Продаж</b> — скільки дасть дилер одразу. Машини з кейсів він викуповує за частку від звичайного викупу (її видно на екрані кейсу).</div>
  <div class="mt"><b>Колекційна ціна</b> — ціна моделі з деталями й номером. Вона рахується для рейтингу, доходу гаража й колекцій. У продаж деталі й номер не входять: вони повертаються тобі.</div></div>`;
H.honestHelp = () => sheet('Продаж і колекційна ціна', honestGlossary());
H.saveSeed = () => act('fair/seed', { clientSeed: $('#cseed').value.trim() }, 'Сід збережено');
H.rotateSeed = async () => (await confirmBox('Розкрити поточний серверний сід і створити новий?')) && act('fair/rotate', {}, 'Сід розкрито');
H.verify = async (d) => {
  const hashOk = (await sha256hex(d.seed)) === d.hash;
  const r0 = await hmacFloat(d.seed, `${d.cs}:${d.n}:0`), r1 = await hmacFloat(d.seed, `${d.cs}:${d.n}:1`);
  let item, ok;
  if (S.CASE_BY_ID[d.case]) {
    const cs = S.CASE_BY_ID[d.case];
    const cls = d.forced === '1' || d.forced === '4' ? d.cls : pickW(S.CLASS_ORDER.filter((c) => cs.weights[c]).map((c) => [c, cs.weights[c]]), r0);
    const list = cs.pool(cls), w = S.modelWeights(list);
    item = pickW(list.map((m, i) => [m.id, w[i]]), r1);
    ok = hashOk && cls === d.cls && item === d.item;
    // The gold step draws among the cars missing from the collection at that moment: the car is checked to be one of
    // that class in this case.
    if (d.forced === '4' && list.some((m) => m.id === d.item)) [item, ok] = [d.item, hashOk && cls === d.cls];
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
const BANNER_IC = { pvp: ['flag-3', '#ef4444'], room: ['arrows-exchange', '#3b82f6'], daily: ['gift', '#ffc400'], rcase: ['box', '#ffc400'], newbie: ['sparkles', '#2fd27a'], quest: ['target-arrow', '#ffc400'], coll: ['books', '#3b82f6'], income: ['coin', '#ffc400'], rescue: ['clover', '#2fd27a'], ach: ['diamond', '#a855f7'], achAll: ['diamond', '#a855f7'], pass: ['ticket', '#ffc400'], weekly: ['calendar', '#ffc400'], wchest: ['gift', '#ffc400'] };
// Several banners at once fold into a stack (the newest on top, the others peeking under it); «ще N» unfolds them.
function paintBannerStack() {
  const box = $('#banners');
  if (!box) return;
  const list = [...box.querySelectorAll('.banner:not(.out)')];
  // The strip scrolls with the page (it never floats over the content); only a live invite stays pinned under the header.
  box.classList.toggle('pinned', list.some((el) => el.classList.contains('invite')));
  if (list.length < 2) box.classList.remove('open');
  box.classList.toggle('stacked', list.length > 1);
  list.forEach((el, i) => {
    el.style.setProperty('--i', Math.min(i, 3));
    el.classList.toggle('behind', i > 0);
  });
  let more = box.querySelector('.bmore');
  if (list.length > 1) {
    if (!more) {
      more = document.createElement('button');
      more.className = 'bmore';
      more.dataset.act = 'bannersToggle';
      box.append(more);
    }
    // Folded: a small «+N» key inside the front banner (a pill under the stack covered the page's own tabs).
    // Unfolded: «Згорнути» under the list.
    const open = box.classList.contains('open');
    if (open) {
      if (more.parentElement !== box) box.append(more);
      more.classList.remove('in-banner');
      more.innerHTML = `Згорнути ${ic('chevron-right')}`;
      more.removeAttribute('aria-label');
    } else {
      const btns = list[0].querySelector('.bbtns');
      if (more.parentElement !== btns) btns.prepend(more);
      more.classList.add('in-banner');
      more.innerHTML = `+${list.length - 1}`;
      more.setAttribute('aria-label', `Ще ${list.length - 1} — показати всі`);
    }
  } else more?.remove();
}
H.bannersToggle = () => {
  $('#banners')?.classList.toggle('open');
  paintBannerStack();
};
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
    // A strip in the page flow right under the header: it pushes the screen down instead of covering its title.
    box = document.createElement('div');
    box.id = 'banners';
    ($('#app .top') || document.body).after(box);
  }
  const [icon, color] = data.icon ? [data.icon, data.color] : BANNER_IC[data.kind] || ['bell', '#8e8e93'];
  const el = document.createElement('div');
  el.className = data.invite ? 'banner invite' : 'banner';
  el.innerHTML = `<span class="mi" style="--c:${color}">${ic(icon)}</span>
    <div class="grow" data-act="bannerOpen" data-key="${esc(data.key)}"><b>${esc(data.title)}</b><div class="small">${data.sub}</div></div>
    <div class="bbtns">${data.buttons.map((b) => `<button class="btn sm ${b.cls || ''}" data-act="${b.act}" data-key="${esc(data.key)}">${b.label}</button>`).join('')}</div>`;
  box.prepend(el);
  banners.set(data.key, { el, data });
  paintBannerStack();
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
// Claim banners ("Забрати …") never cover an open sheet, a race or a spinning case. Hidden this way they are not
// marked as seen, so the next pulse shows them again once the screen is free.
function hideClaimBanners() {
  try {
    for (const [key, b] of banners) if (b.data.claim) hideBanner(key, false);
  } catch {} // a sheet opened while the module is still loading
}
// Also while a case result is on the screen (the drop is the moment, a «Забрати» strip only covered it) and while the
// page is scrolled down (the strip lives at the top of the page; it waits there until the player is back up).
const claimsBlocked = () => busyForBanners() || !$('#modal').hidden || !!$('.story')
  || (state.tab === 'cases' && !state.page && !!state.drop?.length) || window.scrollY > 120;
function hideBanner(key, remember = true) {
  const b = banners.get(key);
  if (!b) return;
  banners.delete(key);
  clearTimeout(b.data.timer);
  if (!b.data.invite && remember) rememberBanner(key);
  b.el.classList.remove('in');
  b.el.style.transform = '';
  b.el.classList.add('out');
  paintBannerStack();
  setTimeout(() => {
    b.el.remove();
    paintBannerStack();
  }, 350);
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
  } else if (g.kind === 'comeback') {
    // Welcome back (S.COMEBACK): granted on the server already, this window only shows what came.
    title = 'З поверненням!';
    color = '#30d158';
    const lines = [`${ic('gas-station')} Повний бак пального`, ...d.keys.map((k) => `${ic('key')} Ключ «${esc(S.CASE_BY_ID[k.caseId].name)}»${k.count > 1 ? ` ×${k.count}` : ''}`)];
    if (d.capHours) lines.push(`${ic('clock')} Дохід копиться на ${d.capHours} год довше — ${d.capFor} год`);
    art = `<div class="gift-ic" style="--c:${color}">${ic('car')}</div><div class="gift-sum" style="color:${color};font-size:26px">Гараж скучив за тобою</div>
      <div class="small muted">тебе не було ${d.days} ${d.days % 10 >= 2 && d.days % 10 <= 4 && (d.days % 100 < 12 || d.days % 100 > 14) ? 'дні' : 'днів'}</div>
      <div class="cb-list mt">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
  } else if (g.kind === 'ref') {
    title = 'Тебе запросив друг!';
    color = '#30d158';
    art = `<div class="gift-ic" style="--c:${color}">${ic('users')}</div><div class="gift-sum win">+${S.fmt(d.money)}</div>
      <div class="mt"><b>${ic('key')} Кейс «${esc(S.CASE_BY_ID[d.caseId]?.name || '')}»</b> — безкоштовно</div>
      <div class="small muted mt">${esc(d.from || 'Друг')} запросив тебе в АВТОДРОП. На 3 рівні отримаєш ще ${S.fmt(d.l3)}</div>`;
  } else if (g.kind === 'thanks') {
    title = 'Дякуємо! 💛';
    color = '#ffd60a';
    art = `<div class="gift-ic" style="--c:${color}">${ic('heart')}</div><div class="gift-sum" style="color:${color}">Гравець з перших днів</div>${d.stars ? `<div class="small muted">твоя підтримка: ${d.stars} ⭐</div>` : ''}`;
  } else {
    title = 'Повідомлення';
    color = '#007aff';
    art = `<div class="gift-ic" style="--c:${color}">${ic('bell')}</div>`;
  }
  sheet(title, `<div class="center gift">${art}
    ${g.note ? `<div class="gift-note">${esc(g.note)}</div>` : ''}
    ${g.kind === 'comeback' || g.kind === 'ref' ? '' : '<div class="tiny muted mt">від адміністрації АВТОДРОП</div>'}
    <button class="btn yellow mt2" data-act="giftOk">${g.kind === 'message' ? 'Зрозуміло' : g.kind === 'thanks' ? 'Дякую! 💛' : g.kind === 'comeback' ? 'Погнали!' : 'Забрати'}</button></div>`);
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
  if (g?.kind === 'ref' && S.CASE_BY_ID[g.data?.caseId] && !me.guide && !me.keys?.starter) await revealRewards([{ kind: 'key', caseId: g.data.caseId, count: 1, title: 'Подарунок від друга' }]);
  if (giftQueue.length) return setTimeout(showGift, 300);
  await refresh();
};
const busyForBanners = () => state.opening || (state.race && state.race.phase !== 'done') || battleTimers.length || WOW.isOpen();
// After a claim on the quests page: ask the server again right away so the tab counters drop without waiting.
let pulseTimer = 0;
function pulseSoon() {
  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => pulse().catch(() => {}), 300);
}
async function pulse() {
  if (document.hidden || !me) return;
  let p;
  try {
    p = await api('pulse');
  } catch {
    return;
  }
  clockOffset = p.now - Date.now();
  setRewardClaims(p.claims);
  const qReady = p.claims.filter((c) => c.kind === 'quest' || c.kind === 'weekly' || c.kind === 'wchest').length;
  // Where the rewards are: the «Сьогодні» / «Тиждень» tabs of Завдання get their own counters.
  const split = { day: p.claims.filter((c) => c.kind === 'quest' || c.kind === 'newbie').length, week: p.claims.filter((c) => c.kind === 'weekly' || c.kind === 'wchest').length };
  const splitChanged = split.day !== me.questSplit?.day || split.week !== me.questSplit?.week;
  me.questSplit = split;
  if (splitChanged && state.page === 'quests') paintQuestSeg();
  if (p.balance !== me.balance || p.unread !== me.unread || p.achReady !== me.achReady || qReady !== (me.questReady || 0)) {
    me.balance = p.balance;
    me.unread = p.unread;
    me.achReady = p.achReady;
    me.questReady = qReady;
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
  // Game events: a new one began or one ended — fresh prices and chips; a banner once per event when it starts.
  const evKeys = (l) => (l || []).map((e) => e.key).join();
  if (p.gameEvents && evKeys(p.gameEvents) !== evKeys(me.gameEvents?.active) && !busyForBanners()) {
    try {
      await refresh(!state.page || state.tab === 'cases' || state.tab === 'race');
    } catch {}
  }
  if (busyForBanners()) return hideClaimBanners();
  if (!claimsBlocked() && !guideOn()) for (const e of p.gameEvents || []) {
    if (bannerSeen.has('ev:' + e.key)) continue;
    showBanner({ key: 'ev:' + e.key, kind: 'event', icon: e.icon, color: e.color, title: `Почалася подія: ${e.title}`, sub: `${esc(e.text)} · ще <span data-until="${e.end - clockOffset}"></span>`, ttl: 9000, buttons: [{ label: 'Дивитись', act: 'bannerOpen' }] });
  }
  // (Re)start from the server's list whenever no window is open: a gift closed by tapping outside comes back.
  if (p.gifts.length && $('#modal').hidden) {
    giftQueue = p.gifts;
    return showGift();
  }
  // First steps: the hint card leads to these rewards itself, banners would only cover it.
  if (claimsBlocked() || guideOn()) hideClaimBanners();
  else showClaimBanners(p.claims); // several rewards fold into one «Нагороди» banner (rewards center)
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
  if (c.kind === 'weekly') return H.wkClaim({ k: c.id });
  if (c.kind === 'wchest') return H.wkChest({ d: c.id });
  if (c.kind === 'coll') return act('collection/claim', { key: c.id }, (r) => `Отримано: ${S.short(r.reward.money)}${r.reward.secret ? ' + секретна машина!' : ''}`).then(wowSecret);
  if (c.kind === 'set') return H.setClaim({ id: c.id });
  if (c.kind === 'ach') return act('ach/claim', { key: c.id }, (r) => `Досягнення: ${r.text}`);
  if (c.kind === 'achAll') return act('ach/claim', {}, (r) => `${r.tiers} досягнень: ${r.text}`);
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
  if (b.data.open) return (hideBanner(d.key), b.data.open());
  const k = b.data.kind;
  if (b.data.invite) return;
  hideBanner(d.key);
  if (k === 'daily' || k === 'rcase') return openRewards();
  if (k === 'income') return (state.tab = 'garage', state.page = null, render());
  if (k === 'newbie') return openProfile();
  if (k === 'event') return H.eventsOpen();
  state.tab = 'menu';
  if (k === 'pass') return go('season');
  if (k === 'weekly' || k === 'wchest') return (state.questTab = 'week', go('quests'));
  if (k === 'quest') state.questTab = 'day';
  if (k === 'set' || k === 'coll') state.collTab = k === 'set' ? 'sets' : 'cars';
  go(k === 'quest' ? 'quests' : k === 'ach' || k === 'achAll' ? 'achievements' : 'collection');
};
H.togglePush = async () => {
  const r = await act('settings/push', { on: !me.pushOn }, null);
  if (r) toast(r.pushOn ? 'Нагадування від бота увімкнено' : 'Нагадування вимкнено — повідомлення про обміни й PvP приходитимуть і далі');
};
H.toggleSound = (d, el) => {
  SFX.setOn(!SFX.isOn());
  el.classList.toggle('on', SFX.isOn());
  el.setAttribute('aria-pressed', SFX.isOn());
  if (SFX.isOn()) SFX.coin();
  toast(SFX.isOn() ? 'Звук увімкнено' : 'Звук вимкнено');
};
H.toggleDnd = async () => {
  const r = await act('settings/invites', { on: !me.noInvites }, null);
  if (r) toast(r.noInvites ? 'Не турбувати: ніхто не зможе тебе запросити' : 'Запрошення знову увімкнено');
};
// The switches live in the «Налаштування» sheet: after the server answers, redraw the sheet if it's still open.
for (const k of ['toggleDnd', 'togglePush', 'toggleGuide']) {
  const f = H[k];
  H[k] = async (...a) => {
    await f(...a);
    if (!$('#modal').hidden && $('#sheet .settings')) settingsSheet();
  };
}

(async function boot() {
  if (tg?.initData) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor('#0b0f16');
      tg.setBackgroundColor('#0b0f16');
      tg.setBottomBarColor?.('#0e131b');
      tg.disableVerticalSwipes?.();
    } catch {}
    tg.BackButton?.onClick(back);
  }
  PAINT.loadPaintMeta(); // in parallel with /api/config: one round trip less before the first screen
  try {
    config = await (await fetch('/api/config')).json();
  } catch {}
  setImages(config.images);
  // body masks' index (small); painted cars render as plain photos if it's slow or missing
  await Promise.race([PAINT.loadPaintMeta(), new Promise((r) => setTimeout(r, 1500))]);
  PAINT.watchLooks(document.body);
  DIRT.watchDirt(document.body);
  measurePlateFont();
  if (!tg?.initData && !config.dev) {
    $('#view').innerHTML = '<div class="empty">Відкрий АВТОДРОП через Telegram-бота</div>';
    return;
  }
  try {
    await refresh();
    if (me.keys.starter) state.caseId = 'starter';
    else state.caseId = prefGet('caseId', (id) => !!S.CASE_BY_ID[id] && !S.CASE_BY_ID[id].starter) || state.caseId;
    if (me.dailyReady && !me.cars.length) state.tab = 'cases';
    const story = S.storyFor(me, whatsNewSeenHere());
    const st = guideOn() && S.GUIDE_STEPS.find((s) => s.key === me.guide);
    if (st?.tab) state.tab = st.tab; // back in the middle of the first steps: open where the next one is
    const fromLink = challengeFromLink(); // a ghost challenge's link opens on the challenge (over the intro's end too)
    render();
    // A new player gets neither the rewards window nor banners over the first steps: the guide brings them to the gift.
    if (me.dailyReady && !guideOn() && !me.intro && !fromLink) {
      openRewards();
      skipDailyBanner = true;
    }
    if (story === 'intro') {
      const seen = api('intro/seen').catch(() => {}); // once, even if the app is closed in the middle
      try {
        localStorage.setItem(whatsNewKey(), '1');
      } catch {}
      playStory(S.INTRO_STORY, async () => {
        state.tab = 'cases';
        state.caseId = 'starter';
        try {
          await seen;
          await refresh();
        } catch {}
      });
    } else if (story === 'whatsnew') whatsNew();
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

// ---------- ghost challenges («Виклик-привид»: public/ghost.js, public/challenge-card.js) ----------
// After any finished drag run «Кинути виклик другу» throws it as a challenge: the share sheet with the card picture —
// «Надіслати в чат» (WebApp.shareMessage with a «Прийняти виклик» button; else the t.me/share/url link), «Через @bot»
// (switchInlineQuery, when the bot's inline mode is on) and «Скопіювати посилання». The link opens the game on the
// challenge (page «Виклики» with state.challengeId): who, the car (class, power), the time to beat; the friend picks
// any car of his (an empty garage gets the creator's model at stock for this race) and races the ghost — the stored
// run replayed on the drag scene (runRace with R.rival.plan); the server checks the run like any drag race.
PAGE_TITLES.challenges = 'Виклики';
const chLink = (id) => G.challengeLink(config.bot, config.app, id) || (config.dev ? `${location.origin}/?ch=${id}` : '');
const chT = (t) => `${dec(t, 3)} с`;
// The challenge in the link: start_param ch_<id> (t.me/<bot>/<app>?startapp=…), ?ch=<id> (the bot's «Прийняти
// виклик» button) or, in DEV, ?start=ch_<id>. Opens the page once, at boot.
function challengeFromLink() {
  const p = new URLSearchParams(location.search);
  const sp = tg?.initDataUnsafe?.start_param || p.get('start') || '';
  const id = G.CH_PARAM.exec(sp)?.[1] || (G.CH_ID.test(p.get('ch') || '') ? p.get('ch') : null);
  if (!id) return false;
  state.challengeId = id;
  state.page = 'challenges';
  return true;
}
// A result screen's call to throw this very run (it needs the run's tap times, which every current app sends).
function challengeCta(R, title = 'Кинути виклик другу') {
  const r = R.result;
  if (!r?.run || !(r.time < 99)) return '';
  return `<button class="chg-cta" data-act="challengeThrow" data-race="${R.id}"><span class="chg-ic">${ic('ghost')}</span>
    <span class="grow"><b>${title}</b><small>${chT(r.time)} · друг їде проти твого привида</small></span>${ic('chevron-right')}</button>`;
}
const challengeHubRow = () => `<button class="hub-store chg-hub" data-act="challengesOpen"><span class="hub-ic">${ic('ghost')}</span><span class="grow"><b>Виклики друзям</b>
  <span class="hub-i">кинь виклик — друг їде проти твого привида</span></span><span class="chev">${ic('chevron-right')}</span></button>`;
const challengeRaceRow = () => `<button class="chg-row" data-act="challengesOpen">${ic('ghost')}<span class="grow"><b>Виклики друзям</b>
  <small>Після заїзду тисни «Кинути виклик» — друг поїде проти твого привида</small></span>${ic('chevron-right')}</button>`;
H.challengesOpen = () => {
  state.challengeId = null;
  go('challenges');
};
H.challengeOpen = (d) => {
  state.challengeId = d.id;
  go('challenges');
};
H.challengeThrow = async (d, el) => {
  if (el) el.disabled = true;
  try {
    const r = await api('challenge/create', { raceId: Number(d.race) });
    haptic('success');
    openChallengeShare(r.challenge, r);
  } catch (e) {
    toast(e.message, true);
  }
  if (el) el.disabled = false;
};
H.challengeShare = async (d) => {
  try {
    openChallengeShare((await api('challenge/get', { id: d.id })).challenge);
  } catch (e) {
    toast(e.message, true);
  }
};

// The share sheet: the card is drawn here and uploaded only when a Telegram share needs its URL.
let chShare = null;
async function openChallengeShare(ch, { left = null } = {}) {
  const m = M(ch.car.model);
  const link = chLink(ch.id);
  sheet('Кинути виклик', `<div class="chg-prev" id="chgPrev"><div class="share-wait">${ic('ghost')} Малюю картку…</div></div>
    <div class="chg-sline"><b>${chT(ch.time)}</b><span>на ${esc(m.name)}</span>${clsBadge(m.cls)}<span class="muted">${ch.car.hp} к.с.</span></div>
    <div class="share-acts" id="chgActs"></div>
    <div class="tiny muted center mt">Друг їде проти твого привида — твого точного заїзду. Виклик діє ${G.CHALLENGE.ttlDays} днів${left != null ? ` · сьогодні ще ${left} з ${G.CHALLENGE.perDay}` : ''}.
      Новачок за твоїм викликом стає твоїм рефералом: ${S.short(S.REF_REWARD)} тобі, коли він досягне 3 рівня.</div>`);
  const token = (chShare = { ch, link, blob: null, card: null });
  const who = me.firstName || (me.username ? '@' + me.username : '');
  const blob = await challengeCard({ model: ch.car.model, time: ch.time, hp: ch.car.hp, who, bot: config.bot }).catch(() => null);
  if (chShare !== token || !$('#chgPrev')) return; // the sheet was closed or another one opened
  chShare.blob = blob;
  if (blob) chShare.preview = URL.createObjectURL(blob);
  $('#chgPrev').innerHTML = blob ? `<img src="${chShare.preview}" alt="Картка виклику: ${esc(G.challengeLine(ch.car.model, ch.time))}">` : '<div class="share-wait">Картку не вдалося намалювати — поділися посиланням</div>';
  const inline = !!(config.inline && tgAt('6.7') && tg.switchInlineQuery);
  $('#chgActs').innerHTML = `<button class="btn yellow" data-act="challengeSend">${ic('share')} Надіслати в чат</button>
    <div class="btns">${inline ? `<button class="btn ghost" data-act="challengeInline">${ic('ghost')} Через @${esc(config.bot)}</button>` : ''}<button class="btn ghost" data-act="challengeCopy" ${link ? '' : 'disabled'}>${ic('copy')} Скопіювати посилання</button></div>
    ${link ? `<div class="mono chg-link">${esc(link)}</div>` : ''}`;
}
async function challengePrepared(st) {
  if (!st.card) {
    const r = await fetch('/api/share/card', { method: 'POST', headers: authHeaders('image/jpeg'), body: st.blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Не вдалося завантажити картку');
    st.card = j.id;
  }
  return api('challenge/prepare', { id: st.ch.id, card: st.card });
}
const chCaption = (st) => G.challengeCaption({ who: me.firstName || (me.username ? '@' + me.username : ''), model: st.ch.car.model, time: st.ch.time });
H.challengeSend = async (d, el) => {
  const st = chShare;
  if (!st) return;
  if (shareCaps().message && st.blob) {
    el.disabled = true;
    try {
      const r = await challengePrepared(st);
      el.disabled = false;
      return tg.shareMessage(r.preparedId, (ok) => ok && (toast('Виклик надіслано!'), haptic('success')));
    } catch {
      el.disabled = false; // no bot / no https: the plain share link below
    }
  }
  if (st.link) return H.shareRef({ link: st.link, text: chCaption(st) });
  copyText(chCaption(st), 'Текст виклику скопійовано');
};
H.challengeInline = async (d, el) => {
  const st = chShare;
  if (!st) return;
  el.disabled = true;
  if (st.blob) await challengePrepared(st).catch(() => {}); // the bot's inline answer then shows the card picture
  el.disabled = false;
  tg.switchInlineQuery('ch_' + st.ch.id, ['users', 'groups', 'channels']);
};
H.challengeCopy = () => chShare?.link && copyText(chShare.link, 'Посилання скопійовано');
function copyText(text, ok) {
  const done = () => (toast(ok), haptic('success'));
  const old = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(ta);
    ta.select();
    let r = false;
    try {
      r = document.execCommand('copy');
    } catch {}
    ta.remove();
    r ? done() : toast(text);
  };
  navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(done, old) : old();
}

// «Виклики»: one challenge (from a link or the list), or the lists of thrown and accepted ones.
PAGES.challenges = async () => (state.challengeId ? challengeView(state.challengeId) : challengeLists());
AFTER.challenges = () => {
  tickUntil();
  const pick = $('.chg-pick .carpick'), cur = pick?.querySelector('.car.sel');
  if (cur) pick.scrollLeft += cur.getBoundingClientRect().left - pick.getBoundingClientRect().left - 16;
};
const chStatus = (ch) => (ch.expired ? '<span class="chip chg-exp">термін минув</span>' : `<span class="chip">ще ${untilSpan(ch.expiresAt)}</span>`);
async function challengeLists() {
  const d = await api('challenge/list');
  const s = d.stats;
  const sent = d.sent.map((ch) => {
    const m = M(ch.car.model);
    const who = ch.rivals.slice(0, 3).map((r) => `<span class="${r.won ? 'lose' : 'win'}">${esc(r.name)}</span>`).join(', ');
    return `<div class="li chg-li" data-act="challengeOpen" data-id="${ch.id}" role="button">${miniCar(ch.car.model, '', ch.car.look)}<div class="grow">
      <div class="row between"><b class="ellipsis">${esc(m.name)}</b><b class="rtime">${chT(ch.time)}</b></div>
      <div class="tiny muted">${ch.accepted ? `прийняли ${ch.accepted} · <span class="win">захистив ${ch.defended}</span> · <span class="lose">побили ${ch.beaten}</span>` : 'ще ніхто не прийняв'}${ch.recruits ? ` · ${ic('users')} ${ch.recruits}` : ''}</div>
      ${who ? `<div class="tiny ellipsis">${who}</div>` : ''}<div class="row mt" style="gap:6px">${chStatus(ch)}</div></div>
      ${ch.expired ? '' : `<button class="btn sm ghost chg-again" data-act="challengeShare" data-id="${ch.id}" aria-label="Поділитися ще раз">${ic('share')}</button>`}</div>`;
  }).join('');
  const got = d.got.map((ch) => {
    const m = M(ch.car.model), my = ch.my;
    return `<div class="li chg-li" data-act="challengeOpen" data-id="${ch.id}" role="button">${miniCar(ch.car.model, '', ch.car.look)}<div class="grow">
      <div class="row between"><b class="ellipsis">${esc(ch.creator.name)}</b><b class="rtime">${chT(ch.time)}</b></div>
      <div class="tiny muted ellipsis">${esc(m.name)} · ${ch.car.hp} к.с.</div>
      <div class="row mt" style="gap:6px">${my.tries ? `<span class="chip ${my.won ? 'chg-won' : 'chg-lost'}">${my.won ? 'побив' : 'не побив'} · найкращий ${chT(my.best)}</span>` : '<span class="chip">не доїхав</span>'}${chStatus(ch)}</div></div></div>`;
  }).join('');
  return `<div class="card chg-top"><div class="chg-kick">${ic('ghost')} Виклик-привид</div>
      <div class="small muted">Проїдь драг і на екрані результату тисни «Кинути виклик другу». Друг відкриє посилання й поїде проти твого привида — твого точного заїзду. Ставок немає: приз платить гра.</div>
      <div class="stat chg-stat"><div><b>${s.sent}</b><span>кинуто</span></div><div><b class="win">${s.defended}</b><span>захищено</span></div><div><b class="lose">${s.beaten}</b><span>побили</span></div><div><b>${s.wins}–${s.losses}</b><span>мої заїзди</span></div></div>
      <button class="btn yellow mt" data-act="challengeGoRace">${ic('flag-3')} До заїзду</button>
      <div class="tiny muted center mt">Сьогодні ще ${d.left} з ${G.CHALLENGE.perDay} викликів${s.recruits ? ` · за викликами прийшло друзів: ${s.recruits}` : ''}</div></div>
    <div class="h2"><span>Мої виклики</span><span>${d.sent.length}</span></div>
    ${sent ? `<div class="list">${sent}</div>` : emptyBox('ghost', 'Ще жодного виклику', 'Проїдь драг — і кинь свій час другу')}
    <div class="h2"><span>Прийняті</span><span>${d.got.length}</span></div>
    ${got ? `<div class="list">${got}</div>` : emptyBox('flag-3', 'Ти ще не приймав викликів', 'Коли друг кине тобі виклик — він з’явиться тут')}`;
}
H.challengeGoRace = () => {
  state.page = null;
  state.tab = 'race';
  state.raceView = 'race';
  window.scrollTo(0, 0);
  render();
};
// One challenge. The creator sees who raced it; a friend — the car, the time, his runs, what a win pays, his garage
// to pick from (or the loaner) and «Прийняти виклик».
async function challengeView(id) {
  const d = await api('challenge/get', { id });
  const ch = d.challenge, m = M(ch.car.model), color = S.CLASSES[m.cls].color;
  const parts = Object.keys(ch.car.parts || {}).length;
  const hero = `<div class="chg-hero" style="--c:${color}">
      <div class="chg-kick">${ic('ghost')} Виклик-привид · драг 402 м</div>
      <div class="chg-who"><b>${esc(ch.creator.name)}</b> ${ch.mine ? '— твій виклик' : 'кидає тобі виклик'}</div>
      <div class="chg-time">${dec(ch.time, 3)}<small>с</small></div>
      <div class="chg-art">${carArt(ch.car.model, { look: ch.car.look })}</div>
      <div class="chg-car"><b>${esc(m.name)}</b>${clsBadge(m.cls)}<span>${ch.car.hp} к.с.</span><span>${ch.car.loaner ? 'позичена' : parts ? `деталей: ${parts}` : 'стандарт'}</span></div>
      <div class="chg-hero-f">${chStatus(ch)}${ch.accepted ? `<span class="chip">прийняли ${ch.accepted} · побили ${ch.beaten}</span>` : ''}</div></div>`;
  const back = `<button class="btn outline mt" data-act="challengesOpen">Усі виклики</button>`;
  if (ch.mine) {
    const rv = (d.rivals || []).map((r) => `<div class="li"><span class="chg-res ${r.won ? 'lose' : 'win'}">${ic(r.won ? 'flag-3' : 'ghost')}</span><div class="grow"><b class="ellipsis">${esc(r.name)}</b>
      <div class="tiny muted">${r.won ? 'побив твій час' : 'привид переміг'} · ${r.tries} ${plural(r.tries, ['спроба', 'спроби', 'спроб'])}</div></div><b class="rtime ${r.won ? 'lose' : ''}">${chT(r.best)}</b></div>`).join('');
    return hero + `<div class="h2"><span>Хто їхав</span><span>${ch.accepted}</span></div>
      ${rv ? `<div class="list">${rv}</div>` : emptyBox('users', 'Ще ніхто не прийняв', 'Надішли виклик у чат друзів')}
      ${ch.expired ? '' : `<button class="btn yellow mt" data-act="challengeShare" data-id="${ch.id}">${ic('share')} Поділитися ще раз</button>`}${back}`;
  }
  if (ch.expired) return hero + `<div class="card center"><b>Термін цього виклику минув</b><div class="small muted mt">Кинь свій: проїдь драг і на екрані результату тисни «Кинути виклик другу».</div>
      <button class="btn yellow mt" data-act="challengeGoRace">${ic('flag-3')} До заїзду</button></div>${back}`;
  const my = d.my;
  const garage = me.cars.filter((c) => c.status === 'garage');
  if (!d.loaner && !garage.some((c) => c.id === state.chCar)) state.chCar = [...garage].sort((a, b) => a.et - b.et)[0]?.id ?? null;
  const car = d.loaner || garage.find((c) => c.id === state.chCar);
  const prize = car ? G.winPrize(m.price, M(car.model).price) : 0;
  const prizeTxt = my?.won ? 'Ти вже побив цей виклик — приз отримано, можна покращити час'
    : d.winPaysLeft ? `Перемога: <b class="win">+${S.short(prize)}</b> від гри (не від суперника)` : `Сьогодні вже ${G.CHALLENGE.winPays} призів за виклики — перемога зарахується без призу`;
  const pick = d.loaner ? `<div class="card chg-loan">${miniCar(d.loaner.model)}<div class="grow"><b>Позичена ${esc(M(d.loaner.model).name)}</b>
        <div class="tiny muted">стандарт · ${d.loaner.hp} к.с. · лише на цей виклик — у гараж не потрапить</div></div></div>`
    : `<div class="chg-pick"><div class="h2"><span>Твоя машина — будь-яка</span><span>${garage.length}</span></div>
        <div class="carpick">${garage.map((c) => carTile(c, { act: 'challengePick', sel: c.id === state.chCar })).join('')}</div></div>`;
  const vs = car ? `<div class="chg-vs"><div><small>Ти</small><b class="ellipsis">${esc(M(car.model).name)}</b><span>${clsBadge(M(car.model).cls)} ${car.hp} к.с. · ~${dec(car.et, 2)} с</span></div>
      <i>VS</i><div><small>${ic('ghost')} Привид</small><b class="ellipsis">${esc(m.name)}</b><span>${clsBadge(m.cls)} ${ch.car.hp} к.с. · ${chT(ch.time)}</span></div></div>` : '';
  const fuel = d.free ? 'перша спроба — без пального' : `спроба = 1 пальне · ${me.fuel}/${S.FUEL_MAX}`;
  return hero + (my?.tries ? `<div class="card chg-my"><span>Твої заїзди: <b>${my.tries}</b></span><span>найкращий <b class="${my.won ? 'win' : ''}">${chT(my.best)}</b></span><span class="chip ${my.won ? 'chg-won' : 'chg-lost'}">${my.won ? 'побив' : 'ще не побив'}</span></div>` : '')
    + pick + vs
    + `<div class="small center mt chg-prize">${prizeTxt}</div>
      <button class="btn yellow btn2 mt" data-act="challengeRace" data-id="${ch.id}" ${d.loaner ? 'data-loaner="1"' : ''} ${!car || (!d.free && fuelNow() < 1) ? 'disabled' : ''}><span>${ic('flag-3')} Прийняти виклик</span><small>${fuel}</small></button>
      ${!car ? '<div class="tiny muted center mt">Для заїзду потрібна машина в гаражі</div>' : ''}
      <div class="tiny muted center mt">Привид — точний запис заїзду: той самий старт і кожна передача. Твій заїзд сервер перевіряє, як звичайну гонку.</div>${back}`;
}
H.challengePick = (d) => {
  state.chCar = Number(d.id);
  const y = window.scrollY, x = $('.chg-pick .carpick')?.scrollLeft || 0;
  render().then(() => {
    window.scrollTo(0, y);
    const p = $('.chg-pick .carpick');
    if (p) p.scrollLeft = x;
  });
};
H.challengeRace = async (d, el) => {
  const loaner = d.loaner === '1';
  if (el) el.disabled = true;
  let r;
  try {
    r = await api('challenge/start', loaner ? { id: d.id, loaner: true } : { id: d.id, carId: state.chCar });
  } catch (e) {
    if (el) el.disabled = false;
    return toast(e.message, true);
  }
  if (!r.free) me.fuel--;
  renderHeader();
  hideClaimBanners();
  closeModal();
  state.page = null;
  state.tab = 'race';
  state.race = { phase: 'lights', id: r.raceId, car: r.car, rival: r.rival, greenMs: r.greenMs, reaction: null, shifts: [], gear: 1, result: null, chId: d.id, loaner };
  state.race.coach = !me.stats.races; // a newcomer's first race: the short «how to drive» card first
  window.scrollTo(0, 0);
  await render();
  if (state.race.coach && !drSeen()) return dragCoach(state.race);
  runRace();
};
H.challengeAgain = (d) => {
  const R = state.race;
  if (R && !R.loaner) state.chCar = R.car.id;
  state.race = null;
  H.challengeRace({ id: d.id, loaner: R?.loaner ? '1' : '' });
};
H.challengeBack = (d) => {
  state.race = null;
  state.challengeId = d.id;
  go('challenges');
};
// The ghost race's result: the timing sheet, what the creator will hear, «Реванш», and the run thrown back.
function ghostResult() {
  const R = state.race, r = R.result, c = r.challenge || {};
  const startTxt = r.jump ? 'Фальстарт −8%' : r.perfectStart ? 'Ідеальний старт +4%' : r.reaction >= 1.5 ? 'Пізній старт' : `Реакція ${dec(r.reaction, 3)} с`;
  const amount = r.prize ? '+' + S.fmt(r.prize) : r.win ? 'Привида побито' : 'Привид швидший';
  const note = r.prize ? 'приз від гри за перемогу над викликом' : c.capped ? `сьогодні вже ${G.CHALLENGE.winPays} призів за виклики — завтра ще` : r.win ? 'приз за цей виклик ти вже отримав' : 'реванш — і привид не встоїть';
  const told = c.first || c.firstWin ? `<div class="chg-told">${ic('bell')}<span>${esc(c.creator || R.rival.name)} отримає повідомлення: ${r.win ? `«${esc(me.firstName || 'Ти')} побив твій час на ${dec(r.diff, r.diff < 0.01 ? 3 : 2)} с»` : '«Твій привид переміг»'}</span></div>` : '';
  const again = !c.expired;
  return raceSheetHtml({ tag: `${ic('ghost')} Виклик · ${esc(R.rival.name)}`, win: r.win, diff: r.diff, amount, note,
    rows: [{ who: 'Ти', model: R.car.model, look: R.car.look, time: r.time, won: r.win, sub: R.car.loaner ? 'позичена' : `${R.car.hp} к.с.` },
      { who: `Привид · ${R.rival.name}`, model: R.rival.model, look: R.rival.look, time: r.rivalTime, won: !r.win, sub: `${R.rival.hp} к.с.` }], start: startTxt, shifts: r.shifts })
    + told
    + challengeCta(R, r.win ? 'Кинути виклик у відповідь' : 'Кинути свій виклик')
    + `<div class="dr-btns">${again ? `<button class="btn yellow btn2" data-act="challengeAgain" data-id="${esc(R.chId || R.rival.ghost)}" ${me.fuel < 1 ? 'disabled' : ''}><span>${ic('refresh')} Реванш</span><small>${ic('gas-station')}${me.fuel}/${S.FUEL_MAX}</small></button>` : ''}
      <button class="btn outline" data-act="challengeBack" data-id="${esc(R.chId || R.rival.ghost)}">До виклику</button></div>`;
}

// ---------- «вау»: the rare-drop takeover, sharing a drop, the dream car (public/wow.js, public/wow.css) ----------
WOW.init({ haptic, esc, ic, showroom: SHOWROOM_SVG });
// What one opening of the drop's case cost (case of the day / event discount included): the base of «×N від ціни
// кейсу». The multiplier is the SALE against it — honest numbers, the same on the drop, the celebration and the card.
function dropPaid(cs) {
  return cs && !cs.starter ? caseNow(cs).price : 0;
}
const dropMult = (car) => {
  const paid = dropPaid(S.CASE_BY_ID[state.dropCase]);
  return paid ? (S.saleOf(car) ?? 0) / paid : 0;
};
// After a case opening: the best rare drop (or the dream car) gets the full-screen show; when the player taps
// through, AFTER.cases runs again and plays the usual result effects. Once per drop.
function wowDrop() {
  const d = state.drop;
  if (!d || d.wowDone) return false;
  d.wowDone = true;
  const pick = WOW.pickDrop(d, { fast: state.fast });
  if (!pick) return false;
  const cs = S.CASE_BY_ID[state.dropCase];
  hideClaimBanners();
  WOW.celebrate(pick, { casePrice: dropPaid(cs), onShare: (r) => openShare(r.car, { mult: dropMult(r.car) }) }).then(() => {
    if (state.drop !== d) return;
    if (state.tab === 'cases' && !state.page) AFTER.cases();
    else state.fx = null;
    setTimeout(() => {
      if (me.level > me.levelSeen && $('#modal').hidden && !state.opening && !state.race && !WOW.isOpen()) guideOn() ? levelToast() : showLevelUp();
    }, 2600);
  });
  return true;
}
// A secret car from a finished country collection gets the same show (cyan, the biggest star storm).
function wowSecret(r) {
  const model = r?.reward?.secret;
  if (!model || !M(model)) return r;
  const car = me.cars.find((c) => c.model === model) || { model, value: M(model).price };
  closeModal();
  WOW.celebrate({ car, isNew: true }, { onShare: () => openShare(car) });
  return r;
}
// «Поділитися» under a rare drop (the best one of ×3 / ×6).
function wowShareRow(d) {
  const pick = WOW.pickDrop(d.filter((r) => !r.sold));
  return pick ? `<button class="btn ghost share-drop mt" data-act="shareDrop" data-id="${pick.car.id}">${ic('share')} Поділитися: ${esc(M(pick.car.model).name)}</button>` : '';
}
H.shareDrop = (d) => {
  const r = state.drop?.find((x) => x.car.id === Number(d.id));
  if (r) openShare(r.car, { mult: dropMult(r.car) });
};
H.shareCar = (d) => {
  const c = me.cars.find((x) => x.id === Number(d.id));
  if (c) openShare(c, {}, () => carSheet(c.id));
};

// Sharing: the card is drawn on a canvas (wow.js). «Надіслати в чат» = WebApp.shareMessage with a prepared photo
// message (Bot API 8.0+, needs the bot and an https WEBAPP_URL), else the t.me/share/url link with the referral
// link; «В історію» = WebApp.shareToStory (Telegram on iOS/Android only); «Зберегти» = downloadFile / a plain download.
let shareState = null;
const tgAt = (v) => !!(tg?.initData && tg.isVersionAtLeast?.(v));
const shareCaps = () => ({
  message: !!(tgAt('8.0') && tg.shareMessage && config.bot),
  story: !!(tgAt('7.8') && tg.shareToStory && /^(ios|android|android_x)$/.test(tg.platform || '')),
  download: !!(tgAt('8.0') && tg.downloadFile),
});
function authHeaders(type) {
  const h = { 'content-type': type };
  if (tg?.initData) h['x-init-data'] = tg.initData;
  else if (config.dev) h['x-dev-user'] = encodeURIComponent(JSON.stringify(devUser()));
  return h;
}
async function uploadCard() {
  if (shareState.path) return shareState;
  if (!shareState.blob) throw new Error('Картка ще не готова');
  const r = await fetch('/api/share/card', { method: 'POST', headers: authHeaders('image/jpeg'), body: shareState.blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Не вдалося завантажити картку');
  Object.assign(shareState, { id: j.id, path: j.path, url: `${location.origin}/${j.path}` });
  return shareState;
}
async function openShare(car, { mult = 0 } = {}, back = null) {
  const m = M(car.model);
  const who = me.username ? '@' + me.username : me.firstName || '';
  sheet('Поділитися', `<div class="share-prev" id="sharePrev" style="--c:${S.CLASSES[m.cls].color}"><div class="share-wait">${ic('sparkles')} Малюю картку…</div></div>
    <div class="share-acts" id="shareActs"></div>
    <div class="tiny muted center mt">Друг за твоїм посиланням отримає ${S.short(S.REF_FRIEND_BONUS)} на старт, а ти — ${S.short(S.REF_REWARD)}, коли він досягне 3 рівня</div>`, back);
  const token = (shareState = { car, blob: null, link: '' });
  const [blob, ref] = await Promise.all([WOW.shareCard({ model: car.model, value: car.value, sale: S.saleOf(car), mult, who, bot: config.bot }).catch(() => null), api('ref').catch(() => ({}))]);
  if (shareState !== token || !$('#sharePrev')) return; // the sheet was closed or another share started
  Object.assign(shareState, { blob, link: ref.link || '' });
  if (shareState.preview) URL.revokeObjectURL(shareState.preview);
  shareState.preview = blob ? URL.createObjectURL(blob) : '';
  $('#sharePrev').innerHTML = blob ? `<img src="${shareState.preview}" alt="Картка: ${esc(m.name)}">` : `<div class="share-wait">Картку не вдалося намалювати — можна поділитися посиланням</div>`;
  const can = shareCaps();
  $('#shareActs').innerHTML = `<button class="btn yellow" data-act="shareChat">${ic('share')} Надіслати друзям</button>
    <div class="btns">${can.story && blob ? `<button class="btn ghost" data-act="shareStory">${ic('sparkles')} В історію</button>` : ''}${blob ? `<button class="btn ghost" data-act="shareSave">Зберегти картинку</button>` : ''}</div>`;
}
H.shareChat = async (d, el) => {
  const st = shareState;
  if (!st) return;
  const caption = S.shareCaption(st.car.model);
  if (shareCaps().message && st.blob) {
    el.disabled = true;
    try {
      await uploadCard();
      const r = await api('share/prepare', { id: st.id, model: st.car.model });
      el.disabled = false;
      return tg.shareMessage(r.preparedId, (ok) => ok && (toast('Надіслано!'), haptic('success')));
    } catch {
      el.disabled = false; // an older bot setup or no https: fall back to the plain share link below
    }
  }
  if (st.link) return H.shareRef({ link: st.link, text: caption });
  navigator.clipboard?.writeText(caption).then(() => toast('Текст скопійовано — посилання з’явиться після підключення бота'), () => toast(caption));
};
H.shareStory = async (d, el) => {
  const st = shareState;
  if (!st) return;
  el.disabled = true;
  try {
    await uploadCard();
    // A link widget is for Premium users only; everyone else gets the link in the caption (200 characters max).
    const premium = !!tg.initDataUnsafe?.user?.is_premium;
    const name = M(st.car.model).name;
    const text = (premium || !st.link ? `🏁 ${name} — мій дроп в АВТОДРОП!` : `🏁 ${name} — мій дроп в АВТОДРОП! ${st.link}`).slice(0, 200);
    tg.shareToStory(st.url, premium && st.link ? { text, widget_link: { url: st.link, name: 'Грати в АВТОДРОП' } } : { text });
  } catch (e) {
    toast(e.message, true);
  }
  el.disabled = false;
};
H.shareSave = async (d, el) => {
  const st = shareState;
  if (!st?.blob) return;
  const file = `avtodrop-${st.car.model}.jpg`;
  try {
    if (shareCaps().download) {
      el.disabled = true;
      await uploadCard();
      el.disabled = false;
      return tg.downloadFile({ url: st.url, file_name: file });
    }
    // Phone browsers: the system share sheet with the picture; desktop: a plain download.
    const f = typeof File === 'function' ? new File([st.blob], file, { type: 'image/jpeg' }) : null;
    if (f && navigator.canShare?.({ files: [f] })) return await navigator.share({ files: [f], text: S.shareCaption(st.car.model) });
    const a = document.createElement('a');
    a.href = st.preview;
    a.download = file;
    document.body.append(a);
    a.click();
    a.remove();
  } catch (e) {
    el.disabled = false;
    if (e?.name !== 'AbortError') toast(e.message || 'Не вдалося зберегти', true);
  }
};

// The dream car on the garage screen: no dream yet → the suggested one (from day 1); a dream → the honest outlook
// (dreamOutlookHtml: openings expected and the chance with the money there is) and the best case for it with the
// chance; got it → a trophy and «Нова мрія».
const DREAM_HIDE = 'avtodrop-dream-hide';
function dreamCard() {
  const d = me.dream;
  if (!d) return '';
  if (!d.model) {
    const sm = d.suggest && M(d.suggest);
    let hidden = 0;
    try {
      hidden = Number(localStorage.getItem(DREAM_HIDE)) || 0;
    } catch {}
    if (!sm || Date.now() - hidden < 3 * 86400e3) return '';
    return `<div class="card dream sug" style="--c:${S.CLASSES[sm.cls].color}">
      <div class="dream-h"><span>${ic('heart')} Яка машина — твоя мрія?</span><button class="dream-x" data-act="dreamHide" aria-label="Сховати">${ic('x')}</button></div>
      <div class="dream-row"><div class="dream-art">${carArt(sm.id, { glow: true })}</div><div class="grow"><b class="dream-nm">${esc(sm.name)}</b>
        <div class="small muted">${clsBadge(sm.cls)} ${S.short(sm.price)}</div><div class="tiny muted">Обери ціль — гараж показуватиме, скільки лишилось і де її шукати</div></div></div>
      <div class="btns"><button class="btn soft" data-act="dreamSet" data-id="${sm.id}">${ic('heart')} Хочу її</button><button class="btn ghost" data-act="dreamPick">Обрати іншу</button></div></div>`;
  }
  const m = M(d.model);
  const color = S.CLASSES[m.cls].color;
  if (d.got) {
    const own = me.cars.find((c) => c.model === m.id);
    return `<div class="card dream got" style="--c:${color}">
      <div class="dream-h"><span>${ic('trophy')} Мрію здійснено!</span></div>
      <div class="dream-row"><div class="dream-art">${carArt(m.id, { glow: true, look: own?.look })}</div><div class="grow"><b class="dream-nm">${esc(m.name)}</b><div class="small muted">${clsBadge(m.cls)} у твоєму гаражі</div></div></div>
      <div class="btns">${own ? `<button class="btn ghost" data-act="shareCar" data-id="${own.id}">${ic('share')} Поділитися</button>` : ''}<button class="btn soft" data-act="dreamPick">${ic('heart')} Нова мрія</button></div></div>`;
  }
  const ch = S.dreamChances(m.id)[0];
  const cs = ch && S.CASE_BY_ID[ch.caseId];
  const o = S.dreamOutlook(m.id, { balance: me.balance, keys: me.keys });
  return `<div class="card dream" style="--c:${color}">
    <div class="dream-h"><span>${ic('heart')} Машина мрії</span><button class="dream-edit" data-act="dreamPick">Змінити</button></div>
    <div class="dream-row"><div class="dream-art">${carArt(m.id, { glow: true })}</div><div class="grow"><b class="dream-nm">${esc(m.name)}</b><div class="small muted">${clsBadge(m.cls)} ${m.hp} к.с. · колекційна ${S.short(m.price)}</div></div></div>
    ${o && cs ? dreamOutlookHtml(o, cs) : ''}
    ${me.balance >= m.price ? `<div class="tiny mt" style="color:var(--green)">${ic('check')} Грошей більше за її колекційну ціну — пошукай її на ринку чи аукціоні</div>` : ''}
    ${cs ? `<button class="dream-case" data-act="dreamCase" data-id="${cs.id}"><span class="ic">${caseIcon(cs)}</span><span class="grow"><b>Випадає з «${esc(cs.name)}»</b><span class="tiny muted">шанс ${pct(ch.pct)} · це ${WOW.oneIn(ch.pct)} · кейс ${S.short(cs.price)}</span></span><span class="chev">${ic('chevron-right')}</span></button>`
      : '<div class="tiny muted mt">У кейсах не випадає — шукай на ринку та аукціонах</div>'}</div>`;
}
// The dream's outlook from the real drop chance (audit №14) instead of «гроші й гараж / ціна»: how many openings it
// takes on average and what they cost, and the chance to get it with the money (and keys) there are now — the bar is
// that chance, never money against a price.
function dreamOutlookHtml(o, cs) {
  const keys = me.keys?.[cs.id] || 0;
  return `<div class="dream-prog hn-dream"><div class="tiny"><b>Очікувано ще ~${grp(o.opens)} ${plural(o.opens, ['кейс', 'кейси', 'кейсів'])} «${esc(cs.name)}»</b> <span class="muted">(≈${S.short(o.spend)})</span></div>
    <div class="row between tiny mt"><span class="muted">${o.can ? `На твої гроші${keys ? ' й ключі' : ''} — ${o.can} ${plural(o.can, ['відкриття', 'відкриття', 'відкриттів'])}` : `На один кейс бракує ${S.short(cs.price - me.balance)}`}</span>${o.can ? `<span>шанс <b>${pct(o.chanceNow * 100)}</b></span>` : ''}</div>
    <div class="progress dream-bar"><i style="width:${o.chanceNow > 0 ? Math.max(1, o.chanceNow * 100) : 0}%"></i></div></div>`;
}
H.dreamHide = () => {
  try {
    localStorage.setItem(DREAM_HIDE, String(Date.now()));
  } catch {}
  render();
};
H.dreamSet = async (d) => {
  closeModal();
  if (await act('dream/set', { model: d.id }, `${ic('heart')} Мрія: ${M(d.id).name}`)) FX.sparkle($('.card.dream .dream-art'), [S.CLASSES[M(d.id).cls].color, '#ffffff'], 14);
};
H.dreamCase = (d) => {
  state.caseId = d.id;
  state.drop = null;
  state.tab = 'cases';
  state.page = null;
  window.scrollTo(0, 0);
  render();
};
// The picker: every non-secret car of a class, dearest first, with the best case chance; the current dream marked.
function dreamPicker() {
  const cur = me.dream?.model;
  const cls = state.dreamCls || (cur ? M(cur).cls : M(me.dream?.suggest)?.cls) || 'A';
  const owned = new Set(me.collection);
  const list = S.ALL_MODELS.filter((m) => !m.secret && m.cls === cls).sort((a, b) => b.price - a.price);
  const tile = (m) => {
    const ch = S.dreamChances(m.id)[0];
    return `<button class="car dream-tile ${m.id === cur ? 'on' : ''}" data-act="dreamSet" data-id="${m.id}" style="--c:${S.CLASSES[m.cls].color}">${m.id === cur ? `<span class="tr">${ic('heart')}</span>` : owned.has(m.id) ? '<span class="tr win">✓</span>' : ''}
      <div class="art">${carArt(m.id)}</div><div class="nm">${esc(m.name)}</div><div class="meta"><b>${S.short(m.price)}</b> · ${ch ? pct(ch.pct) : 'ринок'}</div></button>`;
  };
  sheet('Машина мрії', `<div class="small muted">Обери ціль з каталогу. Коли вона випаде — буде окреме свято й досягнення «Мрійник».</div>
    <div class="chips gfilter mt">${['S', 'A', 'B', 'C', 'D'].map((k) => `<button class="${k === cls ? 'on' : ''}" data-act="dreamCls" data-k="${k}" style="--c:${S.CLASSES[k].color}"><i></i>${k}<small>${S.CLASSES[k].name}</small></button>`).join('')}</div>
    <div class="grid dream-grid mt">${list.map(tile).join('')}</div>
    ${cur ? '<button class="btn ghost mt" data-act="dreamClear">Прибрати мрію</button>' : ''}`);
}
H.dreamPick = () => dreamPicker();
H.dreamCls = (d) => {
  state.dreamCls = d.k;
  const y = $('#sheet').scrollTop;
  dreamPicker();
  $('#sheet').scrollTop = Math.min(y, 120);
};
H.dreamClear = async () => {
  closeModal();
  await act('dream/set', { model: null }, 'Мрію прибрано');
};

// ---------- «Заїзд дня» (audit §4 feature 1; rules public/dayrace.js, server src/dayrace.js) ----------
// A tile on top of «Гонки»; the day's screen (the car, rules and prizes, attempts, the «Усі / Друзі» boards, refreshed
// while open); a run is the usual drag scene (runRace — the server finishes it through race/finish, with the replay);
// then the result with the place and the gap to the next one, «Ще спроба» and a share card (public/dayrace-card.js).
// Hooked in from here only: the page, the «Гонки» tab and the reward claims are wrapped, nothing above is edited.
PAGE_TITLES.dayrace = 'Заїзд дня';
PAGE_FEATURE.dayrace = 'dayrace';
REWARD_KINDS.add('drace');
REWARD_IC.drace = 'flag-3';
const DR_SEEN = 'drSeen'; // the «Нове» chip on the tile until the screen has been opened once
const drN = (n) => grp(n).replace(/ /g, ' ');
const drT = (t) => `${DRS.fmtTime(t)} с`;
const drPips = (left, max) => `<span class="dr-pips" aria-label="спроби: ${left} з ${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('')}</span>`;
let drData = null, drPoll = 0, drKey = '';

// The tile: the car, your time and place, attempts left. Locked (level 1): one quiet row, and none during the first steps.
function dayRaceTile() {
  if (!isOpen('dayrace')) return guideOn() ? '' : `<button class="drt locked" data-act="locked" data-k="dayrace">${ic('lock')}<span class="grow ellipsis"><b>Заїзд дня</b> · одна машина для всіх</span>${lockChip('dayrace')}</button>`;
  const d = me.dayRace;
  if (!d || !M(d.model)) return '';
  const m = M(d.model);
  const stat = d.time != null ? `твій час <b>${DRS.fmtTime(d.time)}</b>${d.place ? ` · <b>${d.place}-й</b> з ${drN(d.total)}` : ''}`
    : d.total ? `уже проїхали: ${drN(d.total)} · ${d.left ? 'твоя черга' : 'спроби закінчились'}` : 'ще ніхто не проїхав — будь першим';
  const tag = d.ready ? '<em class="rw">нагорода</em>' : !prefGet(DR_SEEN) ? '<em>нове</em>' : '';
  return `<button class="drt" data-act="drOpen" style="--c:${S.CLASSES[m.cls].color}">
    <span class="drt-tx"><span class="drt-h">${ic('flag-3')} Заїзд дня${tag}</span><b class="drt-car ellipsis">${esc(m.name)}</b><span class="drt-st">${stat}</span>
      <span class="drt-at">${drPips(d.left, d.max)}<small>${d.left ? `спроби ${d.left}/${d.max}` : 'спроби закінчились'}</small></span></span>
    <span class="drt-art">${carArt(d.model)}</span><span class="chev">${ic('chevron-right')}</span></button>`;
}
{
  const base = TABS.race;
  TABS.race = async () => {
    if (state.race?.rival?.dayrace) state.race = null; // back from the day's screen: the tab starts fresh
    const html = await base();
    return (state.race && state.race.phase !== 'idle') || state.drift ? html : dayRaceTile() + html;
  };
}
H.drOpen = () => {
  state.race = null;
  go('dayrace');
};

// ---- the day's screen
PAGES.dayrace = async () => {
  if (state.race?.rival?.dayrace) return state.race.phase === 'done' ? drResult() : raceScreen();
  drData = await api('dayrace');
  drKey = '';
  prefSet(DR_SEEN, 1);
  return drPage(drData);
};
AFTER.dayrace = () => {
  clearInterval(drPoll);
  if (state.race?.rival?.dayrace) return resultFx();
  drPoll = setInterval(drLive, 8000);
};
function drPage(v) {
  const m = M(v.car.model), color = S.CLASSES[m.cls].color, tm = M(v.tomorrow);
  const hero = `<div class="card drh" style="--c:${color}">
    <div class="drh-top"><span class="chip">${ic('calendar')} ${DRS.dayLabel(v.day)}</span><span class="chip">${ic('clock')} нова машина через ${untilSpan(v.endsAt)}</span></div>
    <div class="drh-art">${carArt(m.id, { glow: true })}</div>
    <b class="drh-nm">${esc(m.name)}</b>
    <div class="drh-meta">${clsBadge(m.cls)} ${originChip(m.id)}</div>
    <div class="drh-specs"><span><b>${drN(v.car.hp)}</b>к.с.</span><span><b>${drN(v.car.kg)}</b>кг</span><span><b>${dec(v.car.et, 2)}</b>с — еталон</span></div>
    <div class="tiny muted center">Заводська машина для всіх: без деталей і фарби — вирішують старт і передачі</div></div>`;
  const yd = v.yesterday;
  const yCard = yd?.place ? `<div class="card dry"><span class="dry-ic">${ic('trophy')}</span><div class="grow"><b>Вчора · ${esc(M(yd.model)?.name || '')}</b>
      <div class="small muted">${yd.place}-й з ${drN(yd.field)} · ${drT(yd.time)}</div></div>${yd.claimed ? `<span class="chip">${ic('check')} забрано</span>` : `<button class="btn sm ghost" data-act="drClaim" data-day="${yd.day}">Забрати</button>`}</div>`
    : yd?.field ? `<div class="tiny muted center dry-none">Вчора на ${esc(M(yd.model)?.name || '')} проїхали ${drN(yd.field)}</div>` : '';
  const R = DRS.DAYRACE, cn = (id) => esc(S.CASE_BY_ID[id]?.name || id);
  const rules = `<div class="card drr"><div class="hook-t">${ic('gift')} Нагороди опівночі</div>
    <div class="drr-list">
      <div><span class="drr-ic">${ic('key')}</span><span><b>Кожному, хто проїхав</b> — фрагмент ключа «${cn(R.fragCase)}»</span></div>
      <div><span class="drr-ic">${ic('star')}</span><span><b>Топ-10%</b>${v.topN ? ` (зараз — ${v.topN} ${plural(v.topN, ['місце', 'місця', 'місць'])})` : ''} — ключ «${cn(R.topKey)}»</span></div>
      <div><span class="drr-ic gold">${ic('crown')}</span><span><b>Топ-3</b> — ключ «${cn(R.podiumKey)}» і значок «Заїзд дня: №1/2/3»</span></div></div>
    <details class="dr-how"><summary>${ic('info-circle')} Правила</summary><div class="tiny muted">О 00:00 за Києвом — нова машина, однакова для всіх: заводська, без деталей і фарби. ${R.attempts} безкоштовні спроби на день, пальне не потрібне; більше спроб не купити. У таблицю йде твій найкращий час; при однаковому часі вище той, хто проїхав раніше. Сервер перевіряє кожен заїзд — старт і всі перемикання, як у звичайному драгу. Нагороди за місця — коли проїхали щонайменше ${R.minField} гравців; забрати — в «Нагородах».${tm ? ` Завтра: ${esc(tm.name)}.` : ''}</div></details></div>`;
  const tab = state.drTab || 'all';
  const tabs = `<div class="seg drb-tabs">${[['all', `Усі · ${drN(v.total)}`], ['friends', `Друзі${v.friends.list.length > 1 ? ` · ${v.friends.list.length}` : ''}`]].map(([k, t]) => `<button class="${tab === k ? 'on' : ''}" data-act="drBoard" data-k="${k}">${t}</button>`).join('')}</div>`;
  return `${hero}<div class="card drs" id="drMe">${drMeHtml(v)}</div>${yCard}
    <div class="h2"><span>Таблиця дня</span><span class="drb-live">${ic('refresh')} наживо</span></div>${tabs}<div id="drList">${drBoardHtml(v)}</div>${rules}`;
}
function drMeHtml(v) {
  const a = v.attempts, mine = v.me;
  const line = !mine ? `<span class="muted">Ще немає часу — ${a.left ? `перша спроба безкоштовна, як і всі ${a.max}` : 'спроби закінчились'}</span>`
    : mine.dq ? '<span class="muted">Результат знято адміністрацією</span>'
    : `<b class="drs-t">${drT(mine.time)}</b><span class="drs-pl"><b>${mine.place}-й</b> з ${drN(v.total)}</span>`;
  const btn = a.left ? `<button class="btn yellow btn2" data-act="drStart"><span>${ic('flag-3')} ${mine ? 'Ще спроба' : 'Їхати'}</span><small>спроба ${a.used + 1} з ${a.max} · без пального</small></button>`
    : `<button class="btn" disabled>Спроби закінчились · нова машина через ${untilSpan(v.endsAt)}</button>`;
  const share = mine && !mine.dq ? `<button class="drs-share" data-act="drShare">${ic('share')} Поділитися часом</button>` : '';
  return `<div class="row between"><span class="hook-t">${ic('trophy')} Твій найкращий час</span>${drPips(a.left, a.max)}</div><div class="drs-row">${line}</div>${btn}${share}`;
}
const drRow = (r, extra = '') => `<button class="lb ${r.me ? 'me' : ''}" data-act="playerCard" data-id="${r.id}"><span class="pl">${r.place <= 3 ? `<span class="medal m${r.place}">${r.place}</span>` : r.place}</span><span class="lb-ava">${esc(initialOf(r.name))}</span><span class="grow ellipsis">${esc(r.name)}</span>${extra}<b class="nw drb-t">${drT(r.time)}</b></button>`;
function drBoardHtml(v) {
  if ((state.drTab || 'all') === 'friends') {
    const f = v.friends;
    const rows = f.list.length > 1 || f.friends ? f.list.map((r) => drRow(r, `<span class="tiny muted nw">#${r.global}</span>`)).join('') : '';
    const empty = !f.friends ? emptyBox('users', 'Друзів у грі поки немає', 'Тут — ті, кого ти запросив або хто запросив тебе, і з ким ти міняв машини чи гонявся. Запроси друзів за посиланням.', '<button class="btn sm ghost" data-act="go" data-page="friends">Запросити друзів</button>') : '';
    const wait = f.waiting ? `<div class="tiny muted center mt">Ще не проїхали: ${f.waiting} ${plural(f.waiting, ['друг', 'друзі', 'друзів'])}</div>` : '';
    return (rows ? `<div class="list drb">${rows}</div>` : '') + empty + wait;
  }
  if (!v.board.length) return emptyBox('flag-3', 'Таблиця поки порожня', 'Проїдь першим — і твоє ім’я буде вгорі');
  // Folded: the top 10 and your neighbours (2 above, 2 below); «Весь топ-100» unfolds it.
  const list = v.board, mine = list.find((r) => r.me), fold = !state.drAll && list.length > 15;
  const rows = !fold ? list : mine && mine.place > 12 ? [...list.slice(0, 10), null, ...list.slice(mine.place - 3, mine.place + 2)] : list.slice(0, 15);
  const html = rows.map((r) => (r ? drRow(r) : '<div class="drb-gap">· · ·</div>')).join('');
  const more = list.length > 15 ? `<button class="btn ghost sm drb-more" data-act="drAll">${fold ? `Весь топ-${list.length}` : 'Згорнути'}</button>` : '';
  const bar = v.me && !v.me.dq && v.me.place && !mine ? `<div class="mybar"><span>Ти: #${v.me.place}</span><span class="grow"></span><span>${drT(v.me.time)}</span></div>` : '';
  return `<div class="list drb">${html}</div>${more}${bar}`;
}
H.drAll = () => {
  state.drAll = !state.drAll;
  if (drData && $('#drList')) $('#drList').innerHTML = drBoardHtml(drData);
};
H.drBoard = (d) => {
  state.drTab = d.k;
  document.querySelectorAll('.drb-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.k === d.k));
  if (drData && $('#drList')) $('#drList').innerHTML = drBoardHtml(drData);
};
// Live: the board and your line follow the server while the screen is open (not during a run or under a window).
async function drLive() {
  if (state.page !== 'dayrace' || state.race) return clearInterval(drPoll);
  if (document.hidden || !$('#modal').hidden) return;
  try {
    const v = await api('dayrace');
    if (state.page !== 'dayrace' || state.race) return;
    if (v.day !== drData?.day) return render(); // midnight passed while the screen was open: the new car
    const key = JSON.stringify([v.board, v.friends, v.me, v.attempts, v.total]);
    if (key === drKey) return;
    drKey = key;
    drData = v;
    if ($('#drMe')) $('#drMe').innerHTML = drMeHtml(v);
    if ($('#drList')) $('#drList').innerHTML = drBoardHtml(v);
  } catch {}
}

// ---- a run: the drag scene of every race, against a ghost (the next place up, your record, the middle of the board)
H.drStart = async (d, el) => {
  if (el) el.disabled = true;
  let r;
  try {
    r = await api('dayrace/start');
  } catch (e) {
    toast(e.message, true);
    return refresh();
  }
  clearInterval(drPoll);
  hideClaimBanners();
  if (me.dayRace) Object.assign(me.dayRace, { used: r.attempts.used, left: r.attempts.left });
  state.race = { phase: 'lights', id: r.raceId, car: r.car, rival: r.rival, greenMs: r.greenMs, reaction: null, shifts: [], gear: 1, result: null, coach: !me.stats.races };
  state.page = 'dayrace';
  window.scrollTo(0, 0);
  await render();
  $('#drag')?.classList.add('dr-ghost');
  if (state.race.coach && !drSeen()) return dragCoach(state.race);
  runRace();
};
H.drAgain = () => {
  state.race = null;
  return H.drStart();
};
H.drBack = () => {
  state.race = null;
  window.scrollTo(0, 0);
  render();
};
// The result: was it a record, the place, the gap to the next place (or the lead), the start and the shifts.
function drResult() {
  const R = state.race, r = R.result, dr = r.dayrace, car = R.car, m = M(car.model);
  const best = dr.counted && dr.newBest;
  if (state.resultFx) state.resultFx = { win: best }; // confetti for a new best, not for beating the ghost
  const reaction = r.jump ? -1 : r.reaction;
  const st = drStart(reaction, R.jumpBy || 0);
  const lost = r.shifts.reduce((a, q) => a + drLoss(q, car), 0);
  const shiftsTxt = lost > 0.0005 ? `втрачено ${dec(lost, 2)} с` : lost < -0.0005 ? `виграно ${dec(-lost, 2)} с` : 'без втрат';
  const title = !dr.counted ? 'Не зараховано' : !dr.newBest ? 'Рекорд не побито' : dr.prevBest == null ? 'Є час!' : 'Новий рекорд!';
  const sub = !dr.counted ? (dr.expired ? 'заїзд тривав понад 3 хвилини' : 'заїзд почався до опівночі — у новий день він не йде')
    : dr.newBest && dr.prevBest != null ? `краще на <b>${dec(dr.prevBest - r.time, 3)} с</b>` : dr.newBest ? 'перший час дня — тепер ти в таблиці' : `твій рекорд — <b>${drT(dr.best)}</b>`;
  const placeLine = dr.place ? `<div class="drres-pl"><b>${dr.place}-й</b> з ${drN(dr.total)}${dr.prevPlace > dr.place ? ` <span class="up">↑ ${dr.prevPlace - dr.place}</span>` : ''}</div>` : '';
  const gap = dr.next ? `<div class="drres-gap">${ic('target-arrow')}<span><span>${dr.next.gap > 0 ? `До ${dr.next.place}-го місця: <b>−${dec(dr.next.gap, 3)} с</b>` : `Той самий час, що в ${dr.next.place}-го, але він проїхав раніше — потрібна хоч <b>0,001 с</b>`}</span><small class="ellipsis">${esc(dr.next.name)} · ${drT(dr.next.time)}</small></span></div>`
    : dr.lead ? `<div class="drres-gap lead">${ic('crown')}<span><span>Ти перший! Відрив: <b>${dec(dr.lead.gap, 3)} с</b></span><small class="ellipsis">2-й — ${esc(dr.lead.name)} · ${drT(dr.lead.time)}</small></span></div>`
    : dr.place === 1 ? `<div class="drres-gap lead">${ic('crown')}<span>Ти перший у таблиці дня</span></div>` : '';
  const a = dr.attempts, beat = r.time < r.rivalTime, tie = r.time === r.rivalTime;
  const again = a.left ? `<button class="btn yellow btn2" data-act="drAgain"><span>${ic('refresh')} Ще спроба</span><small>залишилось ${a.left} з ${a.max}</small></button>` : '';
  return `<div class="rhero drres ${best ? 'win' : 'flat'}"><div class="rhero-tag">${ic('flag-3')} Заїзд дня · ${esc(m.name)}</div><div class="rhero-t">${title}</div>
      <div class="rhero-sub">${sub}</div><div class="rhero-amt">${drT(r.time)}</div>${placeLine}</div>
    ${gap}
    <div class="dr-times">
      <div class="${beat ? 'won' : ''}"><small>Ти</small><b>${dec(r.time, 3)} с</b><span class="ellipsis">${esc(m.name)}</span></div>
      <div class="${beat || tie ? '' : 'won'}"><small class="ellipsis">Привид · ${esc(dr.ghostName || R.rival.name)}</small><b>${dec(r.rivalTime, 3)} с</b><span class="ellipsis">${beat ? 'обігнав' : tie ? 'так само' : 'попереду'}</span></div></div>
    <div class="card dr-sum">
      <div class="dr-row"><span class="dr-dot q-${st.q}"></span><div class="grow"><b>${st.t}</b><div class="small muted">${st.s}</div></div></div>
      <div class="dr-row"><span class="dr-dot q-${lost > 0.0005 ? 'late' : lost < -0.0005 ? 'perfect' : 'good'}"></span><div class="grow"><b>Передачі: ${shiftsTxt}</b>
        <div class="dr-chips">${r.shifts.map((q, i) => `<span class="qchip q-${q}">${i + 1}→${i + 2} ${QLABEL[q]}</span>`).join('')}</div></div></div></div>
    <div class="dr-btns drres-btns">${again}<div class="btns"><button class="btn ${a.left ? 'outline' : 'yellow'}" data-act="drShare" ${dr.best != null ? '' : 'disabled'}>${ic('share')} Поділитися</button><button class="btn ghost" data-act="drBack">До таблиці</button></div></div>`;
}

// ---- prizes: one banner claims its own day; «Забрати все» takes them with the rest (server: rewards/all)
async function drClaim(day) {
  const r = await claimQuiet('dayrace/claim', { day });
  if (!r) return;
  toast(`Заїзд дня ${DRS.dayLabel(r.day)}: ${r.text}`);
  pulseSoon();
  if (r.keys.length) await revealRewards(r.keys.map((k) => ({ kind: 'key', caseId: k.caseId, count: k.count, title: r.title })));
  else await refresh();
}
H.drClaim = (d) => drClaim(d.day);
{
  const claimBase = H.bannerClaim, openBase = H.bannerOpen;
  H.bannerClaim = async (d) => {
    const b = banners.get(d.key);
    if (b?.data.claim?.kind !== 'drace') return claimBase(d);
    hideBanner(d.key);
    return drClaim(b.data.claim.id);
  };
  H.bannerOpen = (d) => {
    const b = banners.get(d.key);
    if (b?.data.kind !== 'drace') return openBase(d);
    hideBanner(d.key);
    openRewards();
  };
}

// ---- sharing: the card (time, place, car) and the caption come from the player's own result on the server
H.drShare = async () => {
  const day = state.race?.result?.dayrace?.day || drData?.day;
  let c;
  try {
    c = await api('dayrace/caption', { day });
  } catch (e) {
    return toast(e.message, true);
  }
  const m = M(c.model);
  const who = me.username ? '@' + me.username : me.firstName || '';
  sheet('Поділитися часом', `<div class="share-prev" id="sharePrev" style="--c:${S.CLASSES[m.cls].color}"><div class="share-wait">${ic('sparkles')} Малюю картку…</div></div>
    <div class="share-acts" id="shareActs"></div>
    <div class="tiny muted center mt">Друг за твоїм посиланням отримає ${S.short(S.REF_FRIEND_BONUS)} на старт і з’явиться в твоїй таблиці «Друзі»</div>`);
  const token = (shareState = { car: { model: c.model }, blob: null, link: '', dayrace: c });
  const [blob, ref] = await Promise.all([import('./dayrace-card.js').then((x) => x.dayRaceCard({ ...c, who, bot: config.bot })).catch(() => null), api('ref').catch(() => ({}))]);
  if (shareState !== token || !$('#sharePrev')) return;
  Object.assign(shareState, { blob, link: ref.link || '' });
  shareState.preview = blob ? URL.createObjectURL(blob) : '';
  $('#sharePrev').innerHTML = blob ? `<img src="${shareState.preview}" alt="Картка: ${esc(m.name)}, ${drT(c.time)}">` : '<div class="share-wait">Картку не вдалося намалювати — можна поділитися посиланням</div>';
  const can = shareCaps();
  $('#shareActs').innerHTML = `<button class="btn yellow" data-act="drShareChat">${ic('share')} Надіслати друзям</button>
    <div class="btns">${can.story && blob ? `<button class="btn ghost" data-act="drShareStory">${ic('sparkles')} В історію</button>` : ''}${blob ? '<button class="btn ghost" data-act="drShareSave">Зберегти картинку</button>' : ''}</div>`;
};
H.drShareChat = async (d, el) => {
  const st = shareState;
  if (!st?.dayrace) return;
  if (shareCaps().message && st.blob) {
    el.disabled = true;
    try {
      await uploadCard();
      const r = await api('share/prepare', { id: st.id, dayrace: st.dayrace.day });
      el.disabled = false;
      return tg.shareMessage(r.preparedId, (ok) => ok && (toast('Надіслано!'), haptic('success')));
    } catch {
      el.disabled = false; // no bot or no https: the plain share link below
    }
  }
  if (st.link) return H.shareRef({ link: st.link, text: st.dayrace.caption });
  navigator.clipboard?.writeText(st.dayrace.caption).then(() => toast('Текст скопійовано — посилання з’явиться після підключення бота'), () => toast(st.dayrace.caption));
};
H.drShareStory = async (d, el) => {
  const st = shareState;
  if (!st?.dayrace) return;
  el.disabled = true;
  try {
    await uploadCard();
    const premium = !!tg.initDataUnsafe?.user?.is_premium;
    const head = `🏁 Заїзд дня: ${M(st.dayrace.model).name} — ${drT(st.dayrace.time)}. Поб’єш?`;
    const text = (premium || !st.link ? head : `${head} ${st.link}`).slice(0, 200);
    tg.shareToStory(st.url, premium && st.link ? { text, widget_link: { url: st.link, name: 'Грати в АВТОДРОП' } } : { text });
  } catch (e) {
    toast(e.message, true);
  }
  el.disabled = false;
};
H.drShareSave = async (d, el) => {
  const st = shareState;
  if (!st?.blob || !st.dayrace) return;
  const file = `avtodrop-${st.dayrace.day}.jpg`;
  try {
    if (shareCaps().download) {
      el.disabled = true;
      await uploadCard();
      el.disabled = false;
      return tg.downloadFile({ url: st.url, file_name: file });
    }
    const f = typeof File === 'function' ? new File([st.blob], file, { type: 'image/jpeg' }) : null;
    if (f && navigator.canShare?.({ files: [f] })) return await navigator.share({ files: [f], text: st.dayrace.caption });
    const a = document.createElement('a');
    a.href = st.preview;
    a.download = file;
    document.body.append(a);
    a.click();
    a.remove();
  } catch (e) {
    el.disabled = false;
    if (e?.name !== 'AbortError') toast(e.message || 'Не вдалося зберегти', true);
  }
};

// Telegram photo blocked or gone: show the player's initial instead of a broken image (header, menu hub, profile).
// error does not bubble, so listen in the capture phase.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const face = img.closest('.face.photo');
  if (!face) return;
  face.classList.remove('photo');
  face.textContent = String(me?.firstName || me?.username || '?').replace(/^@/, '').trim().charAt(0).toUpperCase() || '?';
}, true);
