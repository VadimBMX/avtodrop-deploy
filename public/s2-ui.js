// «АВТОДРОП: Місто» (Season 02) — the new shell: one bottom bar (Місто · Гараж · DROP · Ринок · Профіль), the city
// home with the pannable map, «Війна районів», the Drop-market → case → opening flow, the parking, the profile hero and
// small re-skins of the rating, store and achievements. Installed once by app.js with its helpers (like the other
// *-ui.js modules); game logic stays in app.js — every action here is an existing data-act handler.
import * as S from './shared.js';
import * as F from './frames.js';
import * as B from './business.js';
import { playOpen } from './s2-reel.js';
import { warDemo } from './war-demo.js';

let X = null;
// Hooks app.js reads: the opening animation and the header painter; tabs that live inside another tab's button.
export const UI2 = { openAnim: null, header: null, tabBtn: { race: 'city', shop: 'garage' } };

const me = () => X.me();
const st = () => X.state();
const M = (id) => S.MODELS[id];
const clsCol = (c) => S.CLASSES[c]?.color || '#a3a4a7';
const shortN = (n) => S.short(n).replace(' ₴', '');
const n0 = (n) => Math.round(n || 0).toLocaleString('uk-UA');

// ---------- assets ----------
const CASE_ART = { rust: 'rust', city: 'city', tuning: 'tuning', sport: 'sport', premium: 'premium', elite: 'elite' };
const CASE_COL = { starter: '#39ff88', rust: '#ff8a3d', city: '#3d8bff', tuning: '#a26bff', sport: '#ff3d5a', premium: '#5ee7f0', elite: '#ffcc33' };
const CASE_SHORT = { rust: 'Іржавий', city: 'Міський', tuning: 'Тюнінг', sport: 'Спорт', premium: 'Преміум', elite: 'Еліта', starter: 'Стартовий' };
// Country crates (art audit 05.11, prompts in the art report): drop s2/case/c-<cc>.webp + o-<cc>.webp (cc = ua, jp, de,
// it, us, gb, cn) and add the code here, e.g. ['ua', 'jp']; until then the case shows its round flag.
const COUNTRY_ART = new Set(['ua', 'jp', 'de', 'it', 'us', 'gb', 'cn']);
const caseKey = (cs) => CASE_ART[cs.id] || (cs.country && COUNTRY_ART.has(cs.country.toLowerCase()) ? cs.country.toLowerCase() : null)
  || (/hallow|hw/i.test(cs.id) ? 'halloween' : null);
const caseCol = (cs) => CASE_COL[cs.id] || (cs.country ? '#22c1a5' : clsCol(S.CLASS_ORDER.filter((k) => cs.weights[k]).pop()));
function caseArt(cs, open = false, cls = '') {
  const k = caseKey(cs);
  if (k) return `<img class="s2-cimg ${cls}" src="s2/case/${open ? 'o' : 'c'}-${k}.webp" alt="" draggable="false">`;
  if (cs.starter) return `<img class="s2-cimg ${cls}" src="s2/x-gift.webp" alt="" draggable="false">`;
  return `<span class="s2-cflag ${cls}">${X.caseIcon(cs)}</span>`;
}
// Frame hole (centre x, centre y, radius of the free circle — shares of the box; the box's width / height; the dark
// disc's radius). r5-frames: every frame is drawn in code (public/frames.js) with the same ring, r 35.5…46 of a 100-unit
// box, so one hole fits all; the disc (r 36.5) tucks just under the ring's inner edge.
const FRAME_HOLE = [0.5, 0.5, F.RING.in / 100, 1, 1, (F.RING.in + 1) / 100];
// The helmets' outline (all nine alike, tools/frame_holes.py): the smallest circle round it — centre x, centre y,
// radius as shares of the 160 px picture. The chin reaches further than the dome, so the picture's own middle is not
// the helmet's: centring that circle in the hole leaves the same gap to the ring all round.
const HELMET_FIT = [0.4712, 0.5304, 0.4713];
const HELMET_FILL = 0.8; // the helmet's circle takes this share of the free hole
// Achievement → badge picture (public/s2/bd/b<N>.webp, all drawn gold; lower tiers are tinted in CSS).
const ACH_BADGE = { cases: 1, wins: 2, pvp: 9, battles: 10, collection: 3, rarest: 11, secrets: 12, garage: 0, level: 13, play: 14, streak: 6, merges: 15, tuned: 16, plates: 17, friends: 5, dream: 18 };
const TIER_CLS = ['br', 'sv', 'gd', 'dm'];
const badgeImg = (key, tier, cls = '') => `<img class="s2-bd t-${tier < 0 ? 'off' : TIER_CLS[Math.min(tier, 3)]} ${cls}" src="s2/bd/b${ACH_BADGE[key] ?? 19}.webp" alt="" loading="lazy">`;
// A badge you can tap: the popover (achPop) says what it is, the tier and what is left to the next one.
const badgeBtn = (key, tier, owner, cls = '') => `<button class="s2-bdb ${cls}" data-act="s2Ach" data-k="${key}" data-o="${owner}" aria-label="${esc(S.ACH_BY_KEY[key]?.title || '')}">${badgeImg(key, tier)}</button>`;

// s2-fix: the look lives on the server — me.helmet (0…8) and me.frame (S.PROFILE_FRAMES id or null; S.frameAllowed),
// set with 'frames/helmet' / 'frames/equip'. Other players: `helmet` + `frame` on every player object the API returns
// (rating, card, club, hall, battles…; market rows: sellerLook) — collected into LOOKS by UI2.onApi (app.js api()).
// No frame picked → the free «Іржа» (S.PROFILE_FRAMES rust) is drawn.
const FR_NONE = 'rust';
const frImg = (id) => (id && S.FRAME_BY_ID[id] ? id : FR_NONE); // the frame drawn (public/frames.js id)
const LOOKS = new Map(); // player id → { h, f (frame drawn), frame (id worn or null) }
function lookSeen(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return;
  if (Array.isArray(o)) return o.forEach((x) => lookSeen(x, depth + 1));
  if (Number.isSafeInteger(o.id) && Number.isInteger(o.helmet)) LOOKS.set(o.id, { h: o.helmet, f: frImg(o.frame), frame: o.frame || null });
  if (o.sellerLook && Number.isSafeInteger(o.sellerId)) LOOKS.set(o.sellerId, { h: o.sellerLook.helmet, f: frImg(o.sellerLook.frame), frame: o.sellerLook.frame || null });
  if (o.creatorLook && Number.isSafeInteger(o.creatorId)) LOOKS.set(o.creatorId, { h: o.creatorLook.helmet, f: frImg(o.creatorLook.frame), frame: o.creatorLook.frame || null });
  for (const k in o) if (o[k] && typeof o[k] === 'object' && k !== 'car' && k !== 'cars') lookSeen(o[k], depth + 1);
}
function myLook() {
  const m = me();
  return { h: Number.isInteger(m.helmet) ? m.helmet : S.helmetDefault(m.id), f: frImg(m.frame), frame: m.frame || null };
}
const lookOf = (id) => (Number(id) === me()?.id ? myLook() : LOOKS.get(Number(id)) || { h: S.helmetDefault(id), f: FR_NONE, frame: null });
// `live`: the frame may move (header, profile, look picker, shop, licence — public/frames.js frameWatch animates it only
// on screen and never under reduced motion); rows in lists keep the still pose.
export function avatar({ h, f }, size, lvl = null, cls = '', live = false) {
  const [cx, cy, r, w, hh, rb] = FRAME_HOLE;
  const k = w / hh; // shares of the width → of the height
  const d = (HELMET_FILL * r) / HELMET_FIT[2]; // the helmet picture's width (share of the frame's width)
  const pc = (v) => `${+(v * 100).toFixed(3)}%`;
  return `<span class="s2-ava ${cls}" style="width:${size}px;height:${Math.round(size / k)}px"><i class="hb" style="left:${pc(cx - rb)};top:${pc(cy - rb * k)};width:${pc(rb * 2)};height:${pc(rb * 2 * k)}"></i>
    <img class="hm" src="s2/av/h${h}.webp" alt="" style="left:${pc(cx - HELMET_FIT[0] * d)};top:${pc(cy - HELMET_FIT[1] * d * k)};width:${pc(d)}">
    ${F.frameHtml(f, { live })}${lvl != null ? `<b class="s2lv">${lvl}</b>` : ''}</span>`;
}
// Small round helmet (header, tab bar): the helmet on a dark disc in a level ring.
const helmet = (h, size) => `<span class="s2-hel" style="width:${size}px;height:${size}px"><img src="s2/av/h${h}.webp" alt=""></span>`;

// ---------- install ----------
export function installS2(x) {
  X = x;
  Object.assign(X.TITLES, { city: 'Місто', bazaar: 'Ринок', menu: 'Профіль', cases: 'Дроп-маркет', garage: 'Мій гараж' });
  X.TABS.city = cityView;
  X.AFTER.city = cityAfter;
  X.TABS.bazaar = bazaarView;
  X.AFTER.bazaar = () => X.tickUntil();
  st().tab = 'city';
  // DROP: the market, the case, the result — the reel/result logic of app.js underneath.
  const casesBase = X.TABS.cases, casesAfter = X.AFTER.cases;
  X.TABS.cases = () => dropView(casesBase);
  X.AFTER.cases = () => {
    casesAfter?.();
    dropAfter();
  };
  const garageBase = X.TABS.garage;
  X.TABS.garage = () => garageView(garageBase);
  const menuBase = X.TABS.menu, menuAfter = X.AFTER.menu;
  X.TABS.menu = () => profileHero() + menuBase();
  X.AFTER.menu = async () => {
    profileAfter();
    await menuAfter?.();
    const rk = document.querySelector('#s2Rank b'), pl = st().hub?.place; // s2-audit: the hub's place came after the hero
    if (rk && pl) rk.textContent = '#' + pl;
  };
  wrapAfter('leaderboard', ratingAfter);
  // s2-ui2: the race lobby head goes over the strips other modules put on top (tourney, day race).
  wrapAfter('race', () => {
    const h = document.querySelector('#view .s2r-head'), v = document.getElementById('view');
    if (h && v && v.firstElementChild !== h) v.prepend(h);
  });
  wrapAfter('store', storeAfter);
  wrapAfter('achievements', achAfter);
  wrapAfter('club', clubAfter); // s2-audit: members get their helmets like in the rating
  Object.assign(X.H, handlers);
  UI2.openAnim = openAnim;
  UI2.header = header;
  UI2.onApi = (name, j) => { // s2-fix: other players' looks from every API answer
    try {
      lookSeen(j);
    } catch {}
  };
  // The licence (app.js licenceCard): the player's helmet in his frame and his achievement badges (tap → what it is).
  UI2.ava = (id, size, lvl) => avatar(lookOf(id), size, lvl, '', true);
  UI2.avatar = avatar; // r5-frames: the shop's frame previews round the player's own helmet
  UI2.myLook = myLook;
  F.frameWatch();
  UI2.achRow = achRow;
  document.getElementById('s2back')?.addEventListener('click', () => X.back());
  // DROP pressed again on the DROP tab → back to the market (capture: before app.js switches the tab). r4-ux (owner
  // 06.11): from a drop result too — the cars are already in the garage, the result screen just closes (like «У гараж»).
  document.getElementById('tabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b?.dataset.tab === 'cases' && st().tab === 'cases' && !st().page && !st().opening) (st().s2case = false, st().drop = null);
    // s2-ui2: a full-page sheet (car card, СТО) sits under the bar — a tab closes it like a page.
    const md = document.getElementById('modal');
    if (b && md && !md.hidden && md.classList.contains('s2-pm')) X.closeModal();
  }, true);
}
function wrapAfter(page, fn) {
  const base = X.AFTER[page];
  X.AFTER[page] = (...a) => {
    const r = base?.(...a);
    try {
      fn();
    } catch {}
    return r;
  };
}

// ---------- header ----------
// One header for every screen: on «Місто» the player pill (helmet, level, name, club), elsewhere ‹ + the title;
// the balance pill with the coin and the rewards bell stay on the right.
function header() {
  const m = me(), s = st();
  if (!m) return;
  const top = document.querySelector('.top');
  const home = s.tab === 'city' && !s.page;
  top.classList.toggle('s2-home', home);
  const back = document.getElementById('s2back');
  // design pass 05.11: «Майстерня» (тюнінг-кейси, склад, фарбування, мийка) opens from the car card — it is an inner
  // screen with ‹ and its title like every other one, not a tab root with the HUD.
  const inner = !!s.page || s.tab === 'shop';
  if (back) back.hidden = !inner || !!X.tg?.initData;
  const t = document.getElementById('title');
  const look = myLook();
  // asphalt: every tab root (no page open) gets the HUD — one dark slab with the helmet, the nickname and «рівень N»
  // on the left (taps open the profile like the old round avatar), the balance slab on the right.
  const hud = !inner;
  top.classList.toggle('s2-hud', hud);
  if (hud && t) {
    const name = m.username || m.firstName || 'Гравець';
    const sub = `рівень ${m.level}${m.vip ? ' · VIP' : ''}`;
    t.innerHTML = `<span class="s2-hudme${look.frame ? ' s2-hudfr' : ''}" role="button" aria-label="Профіль">${look.frame ? avatar(look, 38, null, '', true) : helmet(look.h, 36)}<span class="s2-who"><b class="ellipsis">${esc(name)}</b><small class="ellipsis">${sub}</small></span></span>`;
    t.onclick = () => document.getElementById('avatar')?.click();
  } else if (t) t.onclick = null;
  // s2-ui2: every inner page gets the mockups' heading — a small section label over the title — and its section glow.
  const pg = s.page || (home ? 'city' : s.tab);
  document.body.dataset.s2pg = pg;
  const lb = !hud && pageLabel(pg);
  document.getElementById('gift')?.classList.toggle('s2-hide', inner); // s2-audit
  if (t) t.classList.toggle('s2-xl', !hud && t.textContent.length > 12); // s2-audit: «Цілі дня й тижня», «Аукціон номерів»
  if (lb && lb[0] && t) {
    const title = t.textContent;
    t.innerHTML = `<span class="s2-pt"><small style="--c:${lb[1]}">${lb[0]}</small><b>${esc(title)}</b></span>`;
  }
  document.body.style.setProperty('--s2glow', (lb && lb[1]) || '#12204a');
  const av = document.getElementById('avatar');
  if (av && !av.querySelector('.s2-hel')) av.insertAdjacentHTML('beforeend', helmet(look.h, 30));
  else if (av) av.querySelector('.s2-hel img').src = `s2/av/h${look.h}.webp`;
  const tb = document.getElementById('s2meAv');
  if (tb && tb.dataset.h !== String(look.h)) (tb.dataset.h = look.h, tb.innerHTML = helmet(look.h, 26));
  // The bar: a page keeps its tab lit (Ринок → Авторинок stays on «Ринок»); race/shop live under Місто/Гараж.
  const on = UI2.tabBtn[s.tab] || s.tab;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === on);
  const bz = document.getElementById('bazaarDot');
  if (bz) bz.hidden = !m.incomingTrades;
}
const esc = (v) => X.esc(v);
// Page → [label, section colour] (labels keep to what is known on the client).
function pageLabel(pg) {
  const m = me(), s = st();
  const have = () => m.collection.filter((id) => !M(id)?.secret).length, total = () => S.ALL_MODELS.filter((x) => !x.secret).length;
  const L = {
    market: ['РИНОК · ТОРГІВЛЯ', '#39e58c'], trades: ['ОБМІНИ · НАЖИВО', '#39e58c'], room: ['КІМНАТА ОБМІНУ · LIVE', '#39e58c'], tradeNew: ['НОВИЙ ОБМІН', '#39e58c'],
    plates: [`МОЇ НОМЕРИ · ${m.plates?.length || 0}`, '#3d8bff'], plateAuction: ['АУКЦІОН · НОМЕРИ', '#ff3d5a'], lot: ['ПРИЧАЛ · КОНТЕЙНЕР', '#22c3e6'],
    collection: [`КОЛЕКЦІЯ · ${have()} / ${total()}`, '#a26bff'], quests: ['ЗАВДАННЯ · ЦІЛІ', '#39e58c'], season: [`СЕЗОН ${m.season?.id || ''} · ПРОПУСК`.replace('  ', ' '), '#ff3df0'],
    club: ['АВТОКЛУБ', '#c084fc'], friends: ['ЗАПРОСИ ДРУГА', '#39e58c'], events: ['ЩО ВІДБУВАЄТЬСЯ', '#ff3df0'], achievements: ['НАГОРОДИ', '#ffcc33'],
    support: ['ВІДПОВІДЬ ДО 24 ГОД', '#22e3ff'], leaderboard: ['ТОП ГРАВЦІВ', '#ffcc33'], store: ['ЗІРКИ TELEGRAM', '#ffcc33'], battles: ['КЕЙС-БАТЛИ', '#ff3d5a'], battle: ['КЕЙС-БАТЛ', '#ff3d5a'],
    upgrade: ['АПГРЕЙД МАШИН', '#a26bff'], casino: ['КАЗИНО', '#ff3df0'], tradein: ['ТРЕЙД-ІН', '#ff8a3d'], challenges: ['ВИКЛИКИ ДРУЗЯМ', '#ff8a1f'], dayrace: ['ЗАЇЗД ДНЯ', '#ff8a1f'],
    tourney: ['ТУРНІР ВИХІДНИХ', '#ff8a1f'], barn: ['САРАЙ · ЗНАХІДКА', '#ff8a3d'], biz: ['МОЇ БІЗНЕСИ', '#39e58c'], bizOne: ['БІЗНЕС', '#39e58c'], showroom: ['ШОУРУМ', '#5ee7f0'],
    fair: ['ЧЕСНА ГРА', '#22e3ff'], news: ['ОНОВЛЕННЯ ГРИ', '#3d8bff'], promo: ['ПРОМОКОДИ', '#ffcc33'], contest: ['КОНКУРС', '#ff3df0'],
    race: [null, '#ff8a1f'], shop: [s.shopView === 'wash' ? 'МИЙКА · БЛИСК' : s.shopView === 'paint' ? 'ФАРБУВАННЯ' : 'ДЕТАЛІ', '#ff8a1f'],
  };
  const v = L[pg];
  return v && v[0] ? v : v ? [null, v[1]] : null;
}

// ---------- Місто ----------
// Labels on the city picture (public/s2/city.webp, 1750×775): x, y of the label's foot in picture pixels.
const CITY_W = 1750, CITY_H = 775;
const SPOTS = [
  { k: 'auction', x: 875, y: 58, t: 'Аукціон', c: '#ff4d6d', i: 'hammer' },
  { k: 'sto', x: 712, y: 150, t: 'СТО', c: '#ff8a1f', i: 'tool', biz: 'sto' },
  { k: 'tire', x: 488, y: 212, t: 'Шиномонтаж', c: '#ffb020', i: 'disc', biz: 'tire' },
  { k: 'track', x: 1030, y: 178, t: 'Траса', c: '#ff8a1f', i: 'flag-3' },
  { k: 'drift', x: 1270, y: 212, t: 'Дрифт', c: '#ff3df0', i: 'tornado' },
  { k: 'garage', x: 875, y: 222, t: 'Мій гараж', c: '#ffd400', i: 'building-warehouse' },
  { k: 'wash', x: 716, y: 322, t: 'Автомийка', c: '#22e3ff', i: 'droplet', biz: 'wash' },
  { k: 'gas', x: 1040, y: 316, t: 'Заправка', c: '#ffd400', i: 'gas-station', biz: 'gas' },
  { k: 'shop', x: 415, y: 386, t: 'Магазин', c: '#39ff88', i: 'star' },
  { k: 'club', x: 1032, y: 470, t: 'Автоклуб', c: '#c084fc', i: 'users' },
  { k: 'salon', x: 1322, y: 360, t: 'Автосалон', c: '#5ee7f0', i: 'building-arch', biz: 'salon' },
  { k: 'dealer', x: 876, y: 580, t: 'Трейд-ін', c: '#a2a3a6', i: 'refresh' },
  // r4-ux (owner 06.11: «Де майстерня?» — hints sent players to «Майстерня», the map had none): its own building.
  { k: 'workshop', x: 168, y: 372, t: 'Майстерня', c: '#ff8a1f', i: 'tool' },
  { k: 'free2', x: 1580, y: 352, t: 'Вільна ділянка', c: '#39ff88', i: 'plus', free: true },
];
// Businesses (another part of Season 2 adds me.biz): accept a list or a map of { type|id, name, income|rate, pending, level }.
function bizList() {
  const b = me().biz;
  if (!b) return null;
  const list = Array.isArray(b) ? b : Array.isArray(b.list) ? b.list : Object.entries(b).map(([k, v]) => (v && typeof v === 'object' ? { type: k, ...v } : null)).filter(Boolean);
  return list.map((v) => ({ type: v.type || v.kind || v.id, name: v.name, rate: v.rate ?? v.income ?? v.perHour ?? 0, pending: v.pending ?? v.cash ?? v.box ?? 0, level: v.level ?? v.lvl }));
}
const paOpen = () => (me().plateAuction?.open || []).filter((a) => a.endsAt > X.serverNow());
function spotText(sp) {
  const m = me(), biz = bizList();
  const used = m.cars.filter((c) => c.status !== 'showcase').length;
  switch (sp.k) {
    case 'auction': return paOpen().length ? '<u>LIVE</u>' : X.isOpen('auction') ? '' : `<small>рів.${S.unlockLevel('auction')}</small>`;
    case 'drift': return X.isOpen('drift') ? '' : `<small>рів.${S.unlockLevel('drift')}</small>`;
    case 'track': return `<small>${m.fuel ?? 0}/${X.fmax()}</small>`;
    case 'garage': return `<em>+${shortN(m.income?.rate || 0)}</em><small>${used}/${m.slots}</small>`;
    case 'club': return m.club?.tag ? `<small>${esc(m.club.tag)}</small>` : '';
    case 'dealer': return X.isOpen('tradein') ? '' : `<small>рів.${S.unlockLevel('tradein')}</small>`;
    // r6: the workshop opens with its first view (wash, L2) — the badge said «рів.3» (parts) while a tap said «з 2-го рівня»
    case 'workshop': { const ks = ['wash', 'parts', 'paint']; return ks.some((k) => X.isOpen(k)) ? '' : `<small>рів.${Math.min(...ks.map((k) => S.unlockLevel(k)))}</small>`; }
    case 'free1': case 'free2': return '';
    default:
      if (sp.biz) {
        const b = biz?.find((v) => v.type === sp.biz);
        if (b) return `<em>+${shortN(b.rate)}</em>${b.level ? `<small>рів.${b.level}</small>` : ''}`;
        // s2-audit: a business that can be bought said «скоро» — the price (or the level it opens at) instead
        const d = B.BIZ?.list?.find((v) => v.id === sp.biz);
        return d ? ((m.level || 1) >= d.level ? `<small>${shortN(d.price)}</small>` : `<small>рів.${d.level}</small>`) : '<small>скоро</small>';
      }
      return '';
  }
}
function cityView() {
  const s = st();
  const war = s.cityView === 'war';
  // r7-ux (playtest 06.11, 360×640: «Траса» off screen after an old drag): coming in from another screen the map starts
  // centred on «Траса» and «Мій гараж» again — the remembered drag only lives while the player stays on this map.
  const vpNow = document.getElementById('s2Map');
  if (!vpNow || vpNow.classList.contains('war') !== war) delete s['pan_' + (s.cityView || 'city')];
  const seg = `<div class="s2-seg"><button class="${war ? '' : 'on'}" data-act="s2City" data-k="city">${X.ic('building-skyscraper')}Моє місто</button><button class="${war ? 'on' : ''}" data-act="s2City" data-k="war">${X.ic('flag-3')}Війна районів</button></div>`;
  return `<div class="s2-city" id="s2City">${seg}${war ? warMap() : cityMap()}</div>`;
}
function cityMap() {
  const labels = SPOTS.map((sp) => `<button class="s2-lb${sp.free ? ' free' : ''}${sp.k === 'garage' ? ' main' : ''}${sp.k === 'track' ? ' top' : ''}" data-act="s2Spot" data-k="${sp.k}" style="left:${(sp.x / CITY_W) * 100}%;top:${(sp.y / CITY_H) * 100}%;--c:${sp.c}"><i>${X.ic(sp.i)}</i>${sp.t}${spotText(sp)}</button>`).join('');
  const quick = [['quests', 'target-arrow', 'Цілі', me().questReady], ['events', 'calendar', 'Події', 0], ['season', 'ticket', 'Пропуск', me().season?.ready]]
    .map(([k, i, t, n]) => `<button class="s2-q" data-act="s2Quick" data-k="${k}">${X.ic(i)}<span>${t}</span>${n ? `<b>${n > 9 ? '9+' : n}</b>` : ''}</button>`).join('');
  return `<div class="s2-map" id="s2Map"><div class="s2-pan" id="s2Pan" data-w="${CITY_W}" data-h="${CITY_H}" data-x="952"><img src="s2/city.webp" alt="" draggable="false">${labels}</div>
      <div class="s2-ef l"></div><div class="s2-ef r"></div><div class="s2-quick">${quick}</div><div class="s2-hint">${X.ic('arrows-exchange')}Гортай місто</div></div>
    ${collectSheet()}`;
}
function collectSheet() {
  const m = me(), biz = bizList() || [];
  const pend = Math.floor(X.pendingNow() + biz.reduce((a, b) => a + (b.pending || 0), 0));
  const n = 1 + biz.filter((b) => b.pending > 0).length;
  const cols = ['#ffd400', ...biz.filter((b) => b.pending > 0).map((b) => SPOTS.find((sp) => sp.biz === b.type)?.c || '#22e3ff')].slice(0, 4);
  const full = m.income?.rate && X.pendingNow() >= m.income.rate * m.income.capH - 1;
  return `<div class="s2-sheet s2-collect"><span class="s2-dots">${cols.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
    <span class="s2-st"><small>${n > 1 ? `Каса · ${n} ${X.plural(n, ['бізнес', 'бізнеси', 'бізнесів'])}` : full ? 'Каса гаража повна' : `Гараж накопичив · ${shortN(m.income?.rate || 0)}/год`}</small><b id="s2Pend">+${n0(pend)} ₴</b></span>
    <button class="s2-btn" data-act="s2CollectAll" ${pend < 1 ? 'disabled' : ''}>${X.ic('cash')}Зібрати</button></div>`;
}
// «Війна районів»: districts of the world map (public/s2/world.webp 1584×672). Static until clubs fight for them.
// s2-districts (owner 03.11: «не подобається обводка оцих районів»): no more hard polygon strokes over the art. A club's
// district now sits in its colour the way a tuned car does: a soft underglow on the dark ground around the block's plinth
// (blurred, masked off every block, mix-blend screen), a thin LED strip along the plinth's two FRONT base edges, and one
// pin standing on the block (club shield + district name + club). «Спірний»: the underglow slowly trades the two
// claimants' colours (opacity only) and the pin carries crossed swords. g: the block's top surface corners measured on the
// art — left, back, right, front; T: the plinth's height there.
const WORLD_W = 1584, WORLD_H = 672, PLINTH = 12;
// The demo districts and their made-up clubs: public/war-demo.js (warDemo).
const SWORDS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/></svg>';
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const ptsOf = (q) => q.map((v) => v.map((n) => Math.round(n)).join(',')).join(' ');
// The corners pushed out from the block's centre by k (k > 1 grows the shape), dropped by dy.
const grow = (g, k, dy = 0) => {
  const cx = g.reduce((a, v) => a + v[0], 0) / 4, cy = g.reduce((a, v) => a + v[1], 0) / 4;
  return g.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k + dy]);
};
// The LED strip: along the plinth's base from the left corner, round the front corner, to the right corner.
function ledPath([L, , R, B]) {
  const d = [0, PLINTH], a = lerp(L, B, 0.08), b = lerp(B, L, 0.07), c = lerp(B, R, 0.07), e = lerp(R, B, 0.08);
  const P = (v) => `${Math.round(v[0] + d[0])},${Math.round(v[1] + d[1])}`;
  return `M${P(a)} L${P(b)} Q${P(B)} ${P(c)} L${P(e)}`;
}
function warMap() {
  const { districts: DISTRICTS, legend } = warDemo(me().club);
  const tiles = DISTRICTS.map((d) => `<polygon points="${ptsOf(grow(d.g, 1.02, PLINTH / 2))}"/>`).join('');
  const glow = (d, c, cls = '') => `<polygon class="${cls}" points="${ptsOf(grow(d.g, 1.1, PLINTH + 6))}" fill="${c}"/>`;
  const defs = DISTRICTS.map((d, i) => {
    const [L, , R] = d.g;
    const grad = (id, c) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${L[0]}" y1="0" x2="${R[0]}" y2="0"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset=".2" stop-color="${c}"/><stop offset=".8" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`;
    return grad(`s2led${i}`, d.c) + (d.fight ? grad(`s2led${i}b`, d.c2) : '');
  }).join('');
  // A neutral district (no demo club, see warDemo) has no glow and no LED: nobody holds it.
  const base = DISTRICTS.filter((d) => !d.fight && d.club).map((d) => glow(d, d.c)).join('');
  const leds = DISTRICTS.map((d, i) => d.fight || !d.club ? '' : `<path d="${ledPath(d.g)}" stroke="url(#s2led${i})" color="${d.c}"/>`).join('');
  // Contested blocks: each claimant's glow and LED in its own <svg> layer, crossfaded by opacity (composited, no repaint).
  const fightLayer = (d, i, c, k) => `<svg class="s2-ov s2-dg s2-fight${k}" viewBox="0 0 ${WORLD_W} ${WORLD_H}" preserveAspectRatio="none" aria-hidden="true"><g mask="url(#s2gm)" filter="url(#s2gb)">${glow(d, c)}</g><g class="s2-led"><path d="${ledPath(d.g)}" stroke="url(#s2led${i}${k === 2 ? 'b' : ''})" color="${c}"/></g></svg>`;
  const fights = DISTRICTS.map((d, i) => d.fight ? fightLayer(d, i, d.c, 1) + fightLayer(d, i, d.c2, 2) : '').join('');
  const pin = (d) => {
    const [cx, cy] = lerp(grow(d.g, 0)[0], d.g[3], 0.2); // the pin stands a little in front of the block's centre
    const head = d.fight
      ? `<span class="s2-pin-ic x">${SWORDS}</span><span class="s2-pin-t"><b>${d.n}</b><small>Спірний</small></span>`
      : d.club ? `<img class="s2-pin-ic" src="s2/em/e${d.club.e}.webp" alt=""><span class="s2-pin-t"><b>${d.n}</b><small>${esc(d.club.name)}</small></span>`
        : `<span class="s2-pin-ic x n">${X.ic('flag-3')}</span><span class="s2-pin-t"><b>${d.n}</b><small>${d.free ? 'вільний' : 'Нічий'}</small></span>`;
    return `<div class="s2-dl${d.fight ? ' fight' : ''}" style="left:${((cx / WORLD_W) * 100).toFixed(2)}%;top:${((cy / WORLD_H) * 100).toFixed(2)}%;--c:${d.c};--c2:${d.c2 || d.c}"><div class="s2-pin">${head}</div><i class="s2-pin-stem"></i><i class="s2-pin-dot"></i></div>`;
  };
  const labels = DISTRICTS.map(pin).join('');
  const leg = legend.map(([cl, k]) => `<span style="--c:${cl.c}"><img src="s2/em/e${cl.e}.webp" alt="">${esc(cl.short)} <b>${k}</b></span>`).join('');
  // r4-ux: before the war every district is free (war-demo.js WAR_LIVE) — a grey outline on each block and a banner
  // instead of the club score bar.
  const free = DISTRICTS.filter((d) => d.free).map((d) => `<polygon points="${ptsOf(d.g)}"/>`).join('');
  const top = leg ? `<div class="s2-leg" aria-label="Клуби">${leg}</div>`
    : `<div class="s2-war-soon" role="note"><span class="s2-war-soon-ic">${X.ic('flag-3')}</span><span><b>Війна районів стартує скоро</b><small>Збери або знайди автоклуб, щоб першим захопити район</small></span></div>`;
  return `${top}
    <div class="s2-map war" id="s2Map"><div class="s2-pan" id="s2Pan" data-w="${WORLD_W}" data-h="${WORLD_H}" data-x="420"><img src="s2/world.webp" alt="" draggable="false">
      <svg class="s2-ov s2-dg" viewBox="0 0 ${WORLD_W} ${WORLD_H}" preserveAspectRatio="none" aria-hidden="true"><defs>
        <filter id="s2gb" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16"/></filter>
        <filter id="s2lb" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="3.5"/></filter>
        <mask id="s2gm" maskUnits="userSpaceOnUse" x="0" y="0" width="${WORLD_W}" height="${WORLD_H}"><rect width="${WORLD_W}" height="${WORLD_H}" fill="#fff"/><g fill="#000" filter="url(#s2lb)">${tiles}</g></mask>${defs}</defs>
        <g mask="url(#s2gm)" filter="url(#s2gb)">${base}</g><g class="s2-led">${leds}</g>${free ? `<g class="s2-free">${free}</g>` : ''}</svg>${fights}${labels}</div>
      <div class="s2-ef l"></div><div class="s2-ef r"></div><div class="s2-hint">${X.ic('arrows-exchange')}Гортай карту</div></div>
    <div class="s2-sheet s2-war"><div class="s2-war-h"><b>Війна районів</b><span class="s2-soon">Скоро</span></div>
      <div class="s2-war-t">${legend.length ? 'Поки це демо: клуби на карті вигадані, твій клуб з’явиться тут, коли стартує війна. ' : 'Усі райони поки вільні. '}Автоклуби битимуться за райони міста: гонки за район, бонус до доходу всім учасникам клубу-переможця.</div>
      <button class="s2-btn wide" data-act="go" data-page="club">${X.ic('users')}${me().club ? 'Мій автоклуб' : 'Знайти автоклуб'}</button></div>`;
}
let pendTimer = 0;
function cityAfter() {
  fitCity();
  mountPan();
  requestAnimationFrame(() => (fitCity(), mountPan(), fitLabels())); // s2-fix: once the frame has laid out
  clearInterval(pendTimer);
  pendTimer = setInterval(() => {
    const el = document.getElementById('s2Pend');
    if (!el) return clearInterval(pendTimer);
    const biz = bizList() || [];
    el.textContent = `+${n0(X.pendingNow() + biz.reduce((a, b) => a + (b.pending || 0), 0))} ₴`;
  }, 1000);
}
// The city fills the screen between the header and the bar (no page scroll on the home screen).
// s2-fix: measured against the tab bar's real top (it is fixed: its rect is the viewport's) — the old 420 px floor
// pushed «Зібрати» under the bar on short screens. The map takes what is left (flex), never < 150 px. (The newbie steps
// are the coach ring in the header now, floating over the page, so nothing is put above the city after this render.)
// s2-screens (owner 03.11, iPhone): the measured height went stale while Telegram resized the webview (a void under the
// map, or the page scrolling with an empty band over the header). Now the layout is pure CSS — on «Місто» #app is one
// fixed 100dvh flex column (header · toggle · map · cash strip), nothing scrolls vertically — and the map is
// re-measured for panning whenever its box changes size (ResizeObserver).
function fitCity() {
  const el = document.getElementById('s2City');
  if (!el) return;
  window.scrollTo(0, 0);
  if (el.style.height) el.style.height = '';
  const vp = document.getElementById('s2Map');
  if (vp && !vp._ro && window.ResizeObserver) {
    let h0 = vp.clientHeight, w0 = vp.clientWidth;
    vp._ro = new ResizeObserver(() => {
      if (!vp.isConnected) return vp._ro.disconnect();
      if (vp.clientHeight === h0 && vp.clientWidth === w0) return;
      h0 = vp.clientHeight; w0 = vp.clientWidth;
      mountPan();
      fitLabels();
    });
    vp._ro.observe(vp);
  }
}
window.addEventListener('resize', () => {
  if (document.getElementById('s2City')) (fitCity(), mountPan(), fitLabels());
});
// s2-fix: building labels never cut off by the screen edge. While panning, a label near an edge slides inwards
// (--dx; its pointer stays on the building), and when even that can't fit it, the level part is dropped (.s2-tight).
// s2-tails: the district pins of «Війна районів» (.s2-dl) slide the same way — the pin's card moves, its dot stays.
const LB_PAD = 10;
let lbView = 0;
function fitLabels() {
  const vp = document.getElementById('s2Map'), pan = document.getElementById('s2Pan');
  if (!vp || !pan) return;
  lbView = vp.clientWidth;
  for (const lb of pan.querySelectorAll('.s2-lb, .s2-dl')) (lb.classList.remove('s2-tight'), (lb._w = 0));
  const m = /translate3d\((-?[\d.]+)px/.exec(pan.style.transform || '');
  clampLabels(m ? Number(m[1]) : 0);
}
function clampLabels(x) {
  const pan = document.getElementById('s2Pan');
  if (!pan || !pan.querySelector('.s2-lb, .s2-dl')) return;
  const V = lbView || (lbView = document.getElementById('s2Map')?.clientWidth || 0), W = pan.offsetWidth;
  if (!V || !W) return;
  const card = (lb) => (lb.classList.contains('s2-dl') ? lb.querySelector('.s2-pin') : lb); // what is seen and measured
  for (const lb of pan.querySelectorAll('.s2-lb, .s2-dl')) {
    if (!lb._w) lb._w = card(lb).offsetWidth;
    const ax = x + (parseFloat(lb.style.left) / 100) * W;
    let half = lb._w / 2;
    const need = (ax - half < LB_PAD ? LB_PAD - (ax - half) : ax + half > V - LB_PAD ? V - LB_PAD - (ax + half) : 0);
    if (need && Math.abs(need) > half - 14 && ax > -half && ax < V + half && !lb.classList.contains('s2-tight') && lb.classList.contains('s2-lb') && lb.querySelector('small')) {
      lb.classList.add('s2-tight');
      lb._w = lb.offsetWidth;
      half = lb._w / 2;
    }
    const lim = Math.max(0, half - 14);
    // the label slides fully inside while any of it would show; its pointer moves at most to the label's end
    let v = ax - half < LB_PAD ? LB_PAD - (ax - half) : ax + half > V - LB_PAD ? V - LB_PAD - (ax + half) : 0;
    if (ax < -half || ax > V + half) v = 0; // the building is far off screen: leave it there
    const a = Math.max(-lim, Math.min(lim, v));
    const px = (n) => (Math.abs(n) < 0.5 ? '' : n.toFixed(1) + 'px');
    for (const [k, n] of [['--dx', px(v)], ['--adx', px(a)]]) {
      if (lb.style.getPropertyValue(k) !== n) n ? lb.style.setProperty(k, n) : lb.style.removeProperty(k);
    }
  }
  // s2-audit: a label pushed in from the edge must not lie on top of another one («Шиномонтаж» under «Мій гараж»
  // on a short map) — it fades out until the picture is dragged so it has room again.
  const all = [...pan.querySelectorAll('.s2-dl')];
  const rc = all.map((lb) => card(lb).getBoundingClientRect());
  all.forEach((lb, i) => {
    const slid = !!lb.style.getPropertyValue('--dx');
    const hit = slid && all.some((o, j) => j !== i && !o.classList.contains('s2-hid') && rc[j].left < rc[i].right - 2 && rc[j].right > rc[i].left + 2 && rc[j].top < rc[i].bottom - 2 && rc[j].bottom > rc[i].top + 2);
    lb.classList.toggle('s2-hid', hit);
  });
  // layout-check 05.11: on a short map (320×568: the city is ~230 px tall) the labels of nearby buildings overlap
  // whatever the pan («Траса» under «Мій гараж», «Мийка 2 млн» under «Заправка»). The more important one stays; the
  // other first drops its level / price part (.s2-tight), and only if it still overlaps fades out (.s2-hid).
  // r7-ux (playtest 06.11, 360×640: «Траса» lay under «Мій гараж» and a tap there opened the garage): before a label
  // gives up its level part or fades, it first steps UP out of the way (--dy, its stem grows down to the building).
  // «Траса» is never faded: it is the main loop, and it sits above every other label (.s2-lb.top, z-index).
  const kept = [];
  const hits = (r) => kept.some((o) => o.left < r.right - 2 && o.right > r.left + 2 && o.top < r.bottom - 2 && o.bottom > r.top + 2);
  const mapTop = document.getElementById('s2Map')?.getBoundingClientRect().top ?? -1e9;
  const order = [...pan.querySelectorAll('.s2-lb')].sort((a, b) => lbRank(a) - lbRank(b));
  for (const lb of order) {
    if (lb.style.getPropertyValue('--dy')) lb.style.removeProperty('--dy');
    let r = lb.getBoundingClientRect();
    const dy = hits(r) ? liftLabel(r, hits, mapTop) : 0;
    if (dy) (lb.style.setProperty('--dy', -dy + 'px'), (r = lb.getBoundingClientRect()));
    if (hits(r) && !lb.classList.contains('s2-tight') && lb.querySelector('small')) {
      lb.classList.add('s2-tight');
      lb._w = lb.offsetWidth;
      r = lb.getBoundingClientRect();
    }
    const hid = hits(r) && lb.dataset.k !== 'track';
    lb.classList.toggle('s2-hid', hid);
    if (!hid) kept.push(r);
  }
}
// How far (px) a label must step up so it clears the labels already placed — 0 if no step up to LIFT_MAX does, or if it
// would leave the top of the map.
const LIFT_MAX = 44;
function liftLabel(r, hits, mapTop) {
  for (let d = 4; d <= LIFT_MAX; d += 4) {
    const q = { left: r.left, right: r.right, top: r.top - d, bottom: r.bottom - d };
    if (q.top < mapTop + 2) return 0;
    if (!hits(q)) return d;
  }
  return 0;
}
const LB_ORDER = ['garage', 'track', 'auction', 'gas', 'wash', 'sto', 'workshop', 'club', 'dealer', 'shop', 'drift', 'salon', 'tire', 'free1', 'free2'];
const lbRank = (lb) => (LB_ORDER.indexOf(lb.dataset.k) + 1 || 99);
// Drag the picture sideways (pointer events; a drag never counts as a tap on a label).
function mountPan() {
  const vp = document.getElementById('s2Map'), pan = document.getElementById('s2Pan');
  if (!vp || !pan) return;
  const s = st(), key = 'pan_' + (s.cityView || 'city');
  const H0 = vp.clientHeight, W = Math.round((H0 * Number(pan.dataset.w)) / Number(pan.dataset.h)), V = vp.clientWidth;
  pan.style.width = W + 'px';
  pan.style.height = H0 + 'px';
  const min = Math.min(0, V - W), clamp = (v) => Math.max(min, Math.min(0, v));
  // s2-fix: the listeners below are bound once per map element, so they read the CURRENT size from vp._P — the map is
  // measured again (guide strip, resize) and the first size let the picture be dragged past its end.
  const P = (vp._P = { x: clamp(s[key] ?? V / 2 - (Number(pan.dataset.x) / Number(pan.dataset.w)) * W), clamp, put: null });
  P.put = () => ((pan.style.transform = `translate3d(${P.x}px,0,0)`), clampLabels(P.x)); // s2-fix: labels stay on screen
  P.put();
  // s2-tails: the «Гортай» hint is for a player who hasn't dragged this map yet (it lay over the Троєщина pin).
  vp.classList.toggle('panned', !!s['panned_' + key]);
  if (vp.dataset.on) return;
  vp.dataset.on = '1';
  let x0 = 0, px = 0, moved = false, down = false, vx = 0, lt = 0, lx = 0, raf = 0;
  vp.addEventListener('pointerdown', (e) => {
    down = true; moved = false; px = e.clientX; x0 = vp._P.x; lx = e.clientX; lt = performance.now(); vx = 0;
    cancelAnimationFrame(raf);
  });
  vp.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - px;
    if (Math.abs(dx) > 6 && !moved) (moved = true, vp.setPointerCapture?.(e.pointerId), vp.classList.add('drag', 'panned'), (st()['panned_' + key] = 1));
    if (!moved) return;
    const now = performance.now();
    vx = (e.clientX - lx) / Math.max(1, now - lt);
    lx = e.clientX; lt = now;
    const Q = vp._P;
    Q.x = Q.clamp(x0 + dx);
    Q.put();
  });
  const up = () => {
    if (!down) return;
    down = false;
    vp.classList.remove('drag');
    st()[key] = vp._P.x;
    // a little glide after a flick
    let v = vx * 16;
    const glide = () => {
      const Q = vp._P;
      if (Math.abs(v) < 0.4) return (st()[key] = Q.x);
      Q.x = Q.clamp(Q.x + v); v *= 0.92; Q.put();
      raf = requestAnimationFrame(glide);
    };
    if (moved) raf = requestAnimationFrame(glide);
  };
  vp.addEventListener('pointerup', up);
  vp.addEventListener('pointercancel', up);
  vp.addEventListener('click', (e) => {
    if (moved) (e.stopPropagation(), e.preventDefault(), moved = false);
  }, true);
}

// ---------- Ринок ----------
function bazaarView() {
  const m = me(), pa = paOpen();
  const Y = '#ffd400', GR = '#2fd27a', BL = '#3d8bff', CY = '#22c3e6', AM = '#ff8a3d', RD = '#ff3d5a', PU = '#a26bff';
  const tile = (o) => X.hubTile(o);
  const live = pa.length ? `<button class="s2-live" data-act="go" data-page="plateAuction"><span class="s2-live-l">LIVE</span><span class="grow"><b>Аукціон номера</b><small>${esc(pa[0].text)} · ставка ${S.short(pa[0].topBid || pa[0].minBid)} · ${X.untilSpan(pa[0].endsAt)}</small></span>${X.ic('chevron-right')}</button>` : '';
  return `<div class="s2-page"><div class="s2-ttl"><small style="--c:${GR}">РИНОК · ТОРГІВЛЯ</small><h2>Ринок</h2></div>${live}
    <div class="hub-grid g2">
      ${tile({ page: 'market', k: 'market', icon: 'building-store', c: GR, title: 'Авторинок', info: 'машини, деталі, номери' })}
      ${tile({ page: 'trades', k: 'trades', icon: 'arrows-exchange', c: BL, title: 'Обміни', badge: m.incomingTrades, info: 'кімнати обміну наживо' })}
      ${tile({ page: 'market', k: 'auction', icon: 'box', c: CY, title: 'Причал', act: 'pierGo', info: 'контейнери наосліп' })}
      ${tile({ page: 'plateAuction', icon: 'hammer', c: RD, title: 'Аукціон номерів', info: pa.length ? '<span class="acc">іде зараз</span>' : 'коли запустять — тут' })}
      ${tile({ page: 'plates', k: 'plates', icon: 'license', c: Y, title: 'Номери', info: m.plates.length ? `твоїх: ${m.plates.length}` : 'генератор номерів' })}
      ${tile({ page: 'tradein', k: 'tradein', icon: 'refresh', c: AM, title: 'Трейд-ін', info: '3 машини → 1 краща' })}
      ${tile({ page: 'battles', k: 'battles', icon: 'flame', c: RD, title: 'Кейс-батли', info: 'кейси наввипередки' })}
      ${tile({ page: 'upgrade', k: 'upgrade', icon: 'arrow-big-up-lines', c: PU, title: 'Апгрейд', info: 'машини → дорожча' })}
    </div>
    <button class="hub-store s2-store-row" data-act="go" data-page="store"><img src="s2/x-vip.webp" alt=""><span class="grow"><b>Магазин</b><span class="hub-i">Гривні, VIP, «Стиль»</span></span><span class="chev">${X.ic('chevron-right')}</span></button></div>`;
}

// ---------- DROP ----------
function dropView(base) {
  const s = st(), m = me();
  const onDrop = !!s.drop?.some(X.dropAlive) || !!s.drop?.length;
  if (s.opening) return base();
  if (onDrop) return dropResult(base);
  if (s.s2case && !(m.guide === 'starter' && m.keys.starter)) return caseView(base);
  return marketView(base);
}
// The case open button (the same rules as app.js's openBlock: room, money, keys).
function openBtn(cs, n) {
  const m = me(), deal = X.caseNow(cs), keys = m.keys[cs.id] || 0;
  const paid = Math.max(0, n - keys), free = m.slots - m.used, price = deal.price;
  if (free < 1) return `<button class="s2-open s2-full-g" data-act="toGarage">${X.ic('building-warehouse')}Гараж повний · звільнити місце</button>`; // s2-audit
  // «Вільно 4 з 6» in the caps font read as «ВІЛЬНО 4 3 6» and didn't say what to do (persona playtest 05.11).
  // r7-ux (playtest 06.11: ×6 remembered, then a grey «Лише 5 вільних місць» on every visit): open what fits, once.
  if (free < n) {
    const kp = Math.max(0, free - keys);
    if (kp && price * kp > m.balance) return `<button class="s2-open" disabled>Бракує ${S.short(price * kp - m.balance)}</button>`;
    return `<button class="s2-open opencase s2-fit" data-act="openCase" data-n="${free}" data-expect="${price * kp}">${X.ic('box')}<span class="l">Відкрити ×${free} (що влізе)</span><span class="p">${kp ? shortN(price * kp) + ' ₴' : `${X.ic('key')} ${free}`}</span></button>`;
  }
  if (paid && price * paid > m.balance) return `<button class="s2-open" disabled>Бракує ${S.short(price * paid - m.balance)}</button>`;
  return `<button class="s2-open opencase" data-act="openCase" data-expect="${price * paid}">${X.ic('box')}<span class="l">${cs.starter ? 'Відкрити' : 'Відкрити'}</span><span class="p">${cs.starter ? 'безкоштовно' : paid ? shortN(price * paid) + ' ₴' : `${X.ic('key')} ${n}`}</span></button>`;
}
const fastPill = (on) => `<button class="s2-fast${on ? ' on' : ''}" data-act="toggleFast" aria-pressed="${on ? 'true' : 'false'}" aria-label="Швидке відкриття — без анімації">${X.ic('player-track-next')}<span>Швидко</span><i></i></button>`;
function dock(cs) {
  const s = st(), n = cs.starter ? 1 : s.countWant || s.count || 1;
  const free = me().slots - me().used;
  const counts = cs.starter ? '' : `<div class="s2-cnt">${[1, 3, 6].map((k) => `<button class="${k === n ? 'on' : ''}" data-act="pickCount" data-n="${k}">×${k}</button>`).join('')}</div>`;
  // s2-screens (owner 03.11): «Швидко» lives right here, next to ×1/×3/×6 and the open button (it was a footer row under
  // the bar nobody saw); the same pill sits on the opening overlay and skips the animation mid-way.
  const fast = cs.starter ? '' : fastPill(st().fast);
  // r6: the no-room note lives INSIDE the sticky dock — after it, the dock's ::after strip (it hides what scrolls between
  // the dock and the bar) lay right on it, so «продати дешевші» was never visible. It names the count that fits (×3 / ×1).
  const note = free < n && free >= 0 && !cs.starter ? `<div class="s2-note">${free > 0 ? `Для ×${n} мало місця — вільно ${free}` : 'Гараж заповнений — продай машину або купи місце в гаражі'} · <a class="txtlink" data-act="sellCheap" data-n="${Math.max(1, n - free)}">продати дешевші</a></div>` : '';
  return `<div class="s2-dock${cs.starter ? '' : ' s2-dock2'}${note ? ' s2-dock-note' : ''}">${counts || fast ? `<div class="s2-dock-r">${counts}${fast}</div>` : ''}${openBtn(cs, n)}${note}</div>`;
}
function oddsTiles(cs, weights) {
  const tw = Object.values(weights).reduce((a, b) => a + b, 0);
  return S.CLASS_ORDER.filter((k) => weights[k]).slice(-4).map((k) => `<div class="s2-od" style="--c:${clsCol(k)}"><b>${X.pct((weights[k] / tw) * 100)}</b><small>клас ${k}</small></div>`).join('');
}
function marketView(base) {
  const s = st(), m = me();
  const cs = S.CASE_BY_ID[s.caseId] || S.CASE_BY_ID.rust;
  const deal = X.caseNow(cs), keys = m.keys[cs.id] || 0;
  const tag = deal.why === 'day' ? `${X.ic('flame')} Кейс дня −${S.CASE_OF_DAY.off * 100}%` : deal.off ? `${X.ic('flame')} −${Math.round((1 - deal.price / cs.price) * 100)}%` : cs.starter ? `${X.ic('gift')} Подарунок на старт` : cs.country ? `${X.ic('world')} Країна` : `${X.ic('box')} За рідкістю`;
  const feat = `<div class="s2-feat" style="--cc:${caseCol(cs)}" data-act="s2Case" data-id="${cs.id}" role="button">
    <div class="s2-feat-tx"><span class="s2-tag">${tag}</span><h3>${esc(cs.name)}</h3>
      <div class="s2-price">${cs.starter ? 'Безкоштовно' : S.fmt(deal.price)}${deal.off ? ` <s>${shortN(cs.price)}</s>` : ''}</div>
      ${keys && !cs.starter ? `<div class="s2-keys">${X.ic('key')} ключів: ${keys}</div>` : `<div class="s2-keys muted">Що всередині ${X.ic('chevron-right')}</div>`}</div>
    <div class="s2-feat-art" id="stage">${caseArt(cs)}</div>
    <div class="s2-ods">${oddsTiles(cs, deal.weights)}</div></div>`;
  const list = S.CASES.filter((c) => !c.starter || m.keys[c.id]);
  const tile = (c) => {
    const dl = X.caseNow(c);
    return `<button class="s2-ct ${c.id === cs.id ? 'on' : ''}" style="--cc:${caseCol(c)}" data-act="s2Pick" data-id="${c.id}">${dl.off ? `<span class="s2-ct-hot">−${Math.round(dl.off * 100)}%</span>` : ''}${m.keys[c.id] && !c.starter ? `<span class="s2-ct-key">${X.ic('key')}${m.keys[c.id]}</span>` : ''}${caseArt(c)}<b>${esc(CASE_SHORT[c.id] || c.name)}</b><small>${c.starter ? 'ключ' : shortN(dl.price)}</small></button>`;
  };
  const rar = list.filter((c) => c.group !== 'country'), cty = list.filter((c) => c.group === 'country');
  return `<div class="feed" id="dropFeed" hidden></div><div class="s2-page s2-drop">
    <div class="s2-ttl"><small style="--c:#ff3df0">DROP · MARKET</small><h2>Дроп-маркет</h2></div>${feat}
    <div class="s2-h"><b>Усі кейси</b><span>за рідкістю · країни</span></div><div class="s2-cgrid">${rar.map(tile).join('')}</div>
    <div class="s2-h"><b>Країни</b><span>${cty.length}</span></div><div class="s2-cgrid">${cty.map(tile).join('')}</div>
    ${partsEntry()}
    ${dock(cs)}
    ${X.brokeCard()}</div>`;
}
// 04.11 (David: «нема кейсів з запчастинами і зливати їх»): the part cases and the merge live in «Майстерня», which has
// no button on the S2 bar — a visible way in from the Drop-market (locked card before the parts level).
function partsEntry() {
  const open = X.isOpen('parts'), lvl = S.unlockLevel('parts');
  return `<div class="s2-h"><b>Майстерня</b><span>кейси з деталями · склад · злиття</span></div>
    <button class="s2-parts${open ? '' : ' locked'}" data-act="s2Parts"><span class="s2-parts-ic">${X.ic(open ? 'tool' : 'lock')}</span>
      <span class="grow"><b>Кейси з деталями</b><small>${open ? 'Деталі для твоїх машин · 3 однакові зливаються в кращу' : `Деталі в Майстерні — з ${lvl}-го рівня`}</small></span>
      <span class="s2-parts-go">${X.ic('chevron-right')}</span></button>`;
}
function caseView(base) {
  const s = st(), m = me();
  const cs = S.CASE_BY_ID[s.caseId] || S.CASE_BY_ID.rust;
  const deal = X.caseNow(cs), W = deal.weights;
  const tw = Object.values(W).reduce((a, b) => a + b, 0);
  const order = S.CLASS_ORDER.filter((k) => W[k]).reverse();
  const top = order[0];
  const pity = S.pitySteps(cs)[0];
  const pLeft = pity ? Math.max(1, pity.n - (m.pity[pity.key] || 0)) : 0;
  const bars = order.map((k) => {
    const p = (W[k] / tw) * 100;
    return `<div class="s2-bar" style="--c:${clsCol(k)}"><span class="s2-cl">${k}</span><i><b style="width:${Math.max(1.5, Math.min(100, Math.sqrt(p / 100) * 100))}%"></b></i><em>${X.pct(p)}</em></div>`;
  }).join('');
  // Contents: the dearest car of every class first, then the rest (each class's odds spread by the model weights).
  const owned = new Set(m.collection);
  const cars = [];
  for (const k of order) {
    const pool = cs.pool(k), w = S.modelWeights(pool), sw = w.reduce((a, b) => a + b, 0);
    pool.forEach((md, i) => cars.push({ md, k, p: ((W[k] / tw) * 100 * w[i]) / sw }));
  }
  cars.sort((a, b) => S.rankOf(b.k) - S.rankOf(a.k) || b.md.price - a.md.price);
  // Collapsed: the dearest few of every class (9 cards), so the common cars show up too.
  const per = Math.max(1, Math.ceil(9 / order.length));
  const folded = order.flatMap((k) => cars.filter((c) => c.k === k).slice(0, per)).slice(0, 9);
  const shown = s.s2all ? cars : folded; // «Всі» whenever the folded view hides a car (GB: 9 cars, 7 shown)
  const grid = shown.map(({ md, k, p }) => `<div class="s2-cc" style="--c:${clsCol(k)}"><span class="s2-cl">${k}</span><em>${X.pct(p)}</em>${owned.has(md.id) ? '<span class="s2-own">✓</span>' : ''}<div class="art">${X.carArt(md.id, { thumb: true })}</div><b>${shortN(S.dropSaleOf(md.id, cs))}</b><small class="ellipsis">${esc(md.name)}</small></div>`).join('');
  const fr = m.fragments?.[cs.id] || 0, need = S.FRAGMENTS_PER_KEY;
  return `<div class="feed" id="dropFeed" hidden></div><div class="s2-page s2-case" style="--cc:${caseCol(cs)}">
    <div class="s2-ch"><button class="s2-rb" data-act="s2Case" data-id="">${X.ic('chevron-left')}</button><div><small>КЕЙС · ${cs.starter ? 'ПОДАРУНОК' : shortN(deal.price).toUpperCase() + ' ₴'}</small><h2>${esc(cs.name)}</h2></div></div>
    <div class="s2-hero"><div class="s2-hero-art" id="stage">${caseArt(cs)}</div><div class="s2-hero-tx"><b>Шанс на ${top}-клас</b><span>${X.pct((W[top] / tw) * 100)}${pity ? ` · <span class="nw">гарантія ${pity.cls} через ${pLeft}</span>` : ''}</span>
      <button class="s2-link" data-act="odds">${X.ic('info-circle')} Усі шанси</button></div></div>
    <div class="s2-card s2-bars">${bars}</div>
    <div class="s2-h"><b>Що всередині · ${cars.length} ${X.plural(cars.length, ['машина', 'машини', 'машин'])}</b>${folded.length < cars.length ? `<button class="s2-link" data-act="s2All">${s.s2all ? 'Згорнути' : 'Всі'} ${X.ic('chevron-right')}</button>` : ''}</div>
    <div class="s2-cgrid cars">${grid}</div>
    ${cs.starter ? '' : `<div class="s2-card s2-frag"><div class="row between"><span>${X.ic('key')} Фрагменти ключа</span><b>${fr}/${need}</b></div><div class="pips">${Array.from({ length: need }, (_, i) => `<i class="${i < fr ? 'on' : ''}"></i>`).join('')}</div><div class="tiny muted">${need} фрагментів = безкоштовне відкриття. Фрагмент дає машина, дешевша за кейс.</div></div>`}
    ${dock(cs)}</div>`;
}
// The result (asphalt, owner 03.11): the won car stands ON the lit asphalt turntable (s2/bg/stage-reveal.webp) — no card
// frame, no floating case, no ghost class letter. Under it: the class tag, the name, «нова в колекції N/174», one grid
// of stat slabs and app.js's own drop dock (one yellow «У гараж», the rest dark slabs). ×3/×6 → a carousel of stages.
function dropResult(base) {
  const s = st(), d = s.drop;
  const html = base();
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const dockEl = tpl.content.querySelector('.drop-dock');
  const share = dockEl?.nextElementSibling?.outerHTML || '';
  const cs = S.CASE_BY_ID[s.dropCase] || S.CASE_BY_ID[s.caseId];
  const fresh = s.fx?.type === 'case';
  const have = me().collection.filter((id) => !M(id)?.secret).length, total = S.ALL_MODELS.filter((x) => !x.secret).length;
  if (d.length !== 1) {
    // s2-screens (owner 03.11: «no swiping»): every dropped car on one screen — a grid of small turntables (3 → one row of
    // 3, 4 → 2×2, 6 → 3×2), each tile: the car on its mini stage (tap → the car card), class, «нова», name, sale price and
    // its own «Продати». The summary (with a share icon) and the dock fit above the bar on 390×844 for ×6.
    const sum = tpl.content.querySelector('.multi-sum');
    const shareId = tpl.content.querySelector('[data-act="shareDrop"]')?.dataset.id;
    if (sum) { // two lines: «6 машин · 4 нові · колекційна X» over «Продаж разом Y» (three lines slid under the dock on 360)
      const first = sum.querySelector(':scope > span')?.innerHTML || '';
      sum.innerHTML = `<span class="a-sum1">${first}<em> · колекційна ${S.short(d.reduce((a, r) => a + r.car.value, 0))}</em></span><b>Продаж разом ${S.short(X.sellTotal(d.map((r) => r.car)))}</b>`;
    }
    if (sum && shareId) sum.insertAdjacentHTML('beforeend', `<button class="a-share" data-act="shareDrop" data-id="${shareId}" aria-label="Поділитися">${X.ic('share')}</button>`);
    const cols = d.length === 4 || d.length === 2 ? 2 : 3;
    const cell = (r, i) => {
      const md = M(r.car.model), rank = S.rankOf(md.cls), color = clsCol(md.cls);
      const sell = X.dropAlive(r) ? `<button class="a-gt-sell" data-act="sellDrop" data-id="${r.car.id}" aria-label="Продати ${esc(md.name)}">${X.ic('cash')}Продати</button>`
        : r.sold ? '<div class="a-gt-sell done">Продано</div>' : '';
      return `<div class="a-gt r${rank}${r.sold ? ' sold' : ''} ${fresh ? 'flip-in' : ''}" style="--c:${color};animation-delay:${i * 110}ms">
        <div class="a-gt-st" ${r.sold ? '' : `data-act="car" data-id="${r.car.id}" role="button"`}><div class="a-car"><div class="art">${X.carArt(r.car.model, { glow: rank >= 3 })}</div></div></div>
        <div class="a-gt-tx"><div class="a-gt-h"><span class="a-cls" style="--c:${color}">${md.cls}</span>${r.isNew ? '<span class="a-gt-new">нова</span>' : ''}</div>
        <b class="a-gt-n">${esc(md.name)}</b><div class="a-gt-p">${S.short(X.sellPrice(r.car))}</div></div>${sell}</div>`;
    };
    return `<div class="s2-multi a-multi"><div class="a-from">${esc(cs.name)} · ×${d.length} відкрито</div>
      <div class="a-grid c${cols} n${d.length}">${d.map(cell).join('')}</div>
      ${sum ? sum.outerHTML : ''}${dockEl ? dockEl.outerHTML : ''}${shareId ? '' : share}</div>`;
  }
  const { car, isNew, forced } = d[0];
  const md = M(car.model), rank = S.rankOf(md.cls), color = clsCol(md.cls);
  const sp = X.sellPrice(car), paid = X.dropPaid(cs), mult = paid ? sp / paid : 0;
  const inc = X.carInc(car);
  const origin = X.originText(md);
  const extra = [forced ? 'гарантія' : '', d[0].fragment ? `${X.ic('key')} +фрагмент` : ''].filter(Boolean).map((t) => `<span class="a-x">${t}</span>`).join('');
  return `<div class="s2-res a-res r${rank}" style="--c:${color}">
    <div class="a-from">${esc(cs.name)} · відкрито</div>
    <div class="a-stage ${fresh ? 'go' : ''}"><i class="a-fade"></i>
      <div class="a-car reveal-wrap r${rank}" id="revealWrap" style="--c:${color}"><div class="art ${fresh ? 'reveal' : ''}" id="dropArt">${X.carArt(car.model, { glow: rank >= 3 })}</div></div></div>
    <div class="a-head ${fresh ? 'pop' : ''}"><span class="a-cls" style="--c:${color}">${rank >= 3 ? X.ic('crown') : ''}${md.cls}</span><span class="a-clsn">${esc(S.CLASSES[md.cls].name)}</span>${isNew ? `<span class="a-new">нова в колекції ${have}/${total}</span>` : ''}${extra}</div>
    <div class="result-name s2-res-name ${fresh ? 'pop' : ''}">${esc(md.name)}</div>
    <div class="a-stats">
      <div class="y"><small>Продаж</small><b id="dropValue">${S.short(sp)}</b></div>
      <div class="y"><small>Дохід/год</small><b>${inc ? '+' + shortN(inc.rate ?? inc.income ?? inc) : '—'}</b></div>
      ${mult ? `<div class="${mult >= 1 ? 'g' : ''}"><small>Від ціни кейса</small><b>${S.multText(mult)}</b></div>` : `<div><small>Колекційна</small><b>${S.short(car.value)}</b></div>`}
      <div><small>Потужність</small><b>${md.hp} к.с.</b></div><div><small>Маса</small><b>${n0(md.kg)} кг</b></div><div><small>Країна</small><b class="ellipsis">${esc(origin)}</b></div></div>
    ${d[0].sold ? `<div class="s2-note win">${X.ic('check')} Продано за ${S.short(sp)}</div>` : ''}
    ${dockEl ? dockEl.outerHTML : ''}${share}</div>`;
}
function dropAfter() {
  const res = document.querySelector('.s2-res');
  if (res) document.body.style.setProperty('--s2rc', getComputedStyle(res).getPropertyValue('--c'));
}
// Opening (owner 03.11: «анімація прокрута машини»): the case drops and unlocks, then the reel (public/s2-reel.js) stops
// on the car the server rolled; ×3 / ×6 stacked rows. «Швидко» on the overlay skips it and turns the quick open on.
function openAnim(cs, r) {
  return playOpen({ cs, r, caseArt: (open) => caseArt(cs, open), carArt: X.carArt, haptic: X.haptic, SFX: X.SFX, draw: () => X.weightedModel(cs),
    fastPill: fastPill(false), onFast: () => X.setFast?.(true) });
}

// ---------- Гараж: «Мій гараж» (the parking floors) ----------
function garageView(base) {
  const s = st(), m = me();
  // asphalt (owner): the garage opens on «Паркінг»; the newbie step «Встанови деталь» points at a car tile of «Машини»,
  // so while that step is on, the garage switches there once by itself.
  if (!s.s2gInit) (s.s2gInit = true, s.garageView = 'park');
  if (m.guide === 'install' && !s.s2gInstall) (s.s2gInstall = true, s.garageView = 'cars');
  if (s.garageView !== 'park') return parkHead() + base().replace('<div class="seg">', `<div class="seg s2-gseg"><button data-act="gView" data-k="park">Паркінг</button>`);
  const cars = m.cars.filter((c) => c.status === 'garage' || c.status === 'race').sort((a, b) => b.value - a.value);
  const name = String(m.username || m.firstName || 'MY').toUpperCase().replace(/[^A-ZА-ЯІЇЄҐ0-9_]/g, '').slice(0, 10) || 'MY';
  // asphalt: every car is one floor of a night parking garage (s2/bg/garage-floor.webp) — the car stands on the floor, the
  // name/class and the price/income ride in two small slabs; the floors stack like a building, the next one is being built.
  const floor = (c, k) => {
    const md = M(c.model), inc = X.carInc(c);
    return `<button class="s2-fl a-fl" data-act="car" data-id="${c.id}" style="--c:${clsCol(md.cls)}"><span class="a-pn">P${k}</span>
      <span class="s2-fl-car art">${X.carArt(c.model, { look: c.look, dirt: c.dirt })}</span>
      <span class="a-fl-tag"><span class="a-cls" style="--c:${clsCol(md.cls)}">${md.cls}</span><b class="ellipsis">${esc(md.name)}</b></span>
      <span class="a-fl-val"><em>${S.short(X.sellPrice(c))}</em>${inc ? `<small>+${shortN(inc.rate ?? inc.income ?? inc)}/год</small>` : ''}</span></button>`;
  };
  const build = m.slots < S.MAX_SLOTS ? `<div class="s2-fl a-fl build"><span class="a-pn">P${m.slots + 1}</span><div class="s2-tape"><span>БУДУЄТЬСЯ · ПОВЕРХ P${m.slots + 1}</span></div><span class="s2-fl-hint">+1 місце для машини</span><button class="s2-btn sm" data-act="buySlot">${X.ic('plus')}${S.short(S.slotCost(m.slots))}</button></div>` : '';
  const free = Math.max(0, m.slots - m.cars.filter((c) => c.status !== 'showcase').length);
  // 03.11 (owner): top-down — P1 (the dearest car) on top, then the next free places, the floor being built last.
  // Only two empty floors are drawn; with more free places the second one stands for all the rest («P3–P6»), so the
  // numbers don't jump from P3 to the floor being built (P7) — persona playtest 05.11.
  const empties = Array.from({ length: Math.min(free, 2) }, (_, i) => {
    const n = cars.length + 1 + i, rest = i === 1 && free > 2;
    return `<button class="s2-fl a-fl empty" data-act="toCases"><span class="a-pn">P${n}${rest ? `–P${cars.length + free}` : ''}</span><span class="s2-fl-hint">${X.ic('plus')} ${rest ? `Ще ${free - 1} ${X.plural(free - 1, ['вільне місце', 'вільні місця', 'вільних місць'])} — відкрий кейс` : 'Вільне місце — відкрий кейс'}</span></button>`;
  }).join('');
  return parkHead() + `${X.vipSaleBanner()}${X.paBanner()}<div class="seg s2-gseg">${[['park', 'Паркінг'], ['cars', 'Машини'], ['showcase', 'Вітрина']].map(([k, t]) => `<button class="${s.garageView === k ? 'on' : ''}" data-act="gView" data-k="${k}">${t}</button>`).join('')}</div>
    <div class="s2-inc"><div class="grow"><small>${X.ic('coin')} Дохід гаража · ${shortN(m.income.rate)}/год</small><b id="pending">${S.fmt(X.pendingNow())}</b><small class="s2-cap">Каса вміщує ${m.income.capH} год${m.income.capH < S.GARAGE_CAP.vipHours ? ` · з VIP — ${S.GARAGE_CAP.vipHours} год` : ' (VIP)'}</small></div><button class="s2-btn sm" data-act="collect" ${X.pendingNow() < 1 ? 'disabled' : ''}>Забрати</button></div>
    <div class="s2-park"><div class="s2-sign"><span>${esc(name)} · PARKING</span></div>${cars.map((c, i) => floor(c, i + 1)).join('')}${empties}${build}</div>
    <div class="s2-note a-note">Тисни на машину — тюнінг, фарба, мийка, продаж</div>`;
}
function parkHead() {
  const m = me();
  const all = m.cars.filter((c) => c.status !== 'showcase');
  return `<div class="s2-phead"><h2>Мій гараж</h2><div><b>${S.short(X.sellTotal(all.filter((c) => !M(c.model).secret)))}</b><small>+${shortN(m.income?.rate || 0)}/год · ${all.length}/${m.slots}</small></div></div>`;
}

// ---------- Профіль ----------
function profileHero() {
  const m = me(), look = myLook(), C = st().hub || {};
  const name = m.username ? m.username : m.firstName || 'Гравець';
  const have = m.collection.filter((id) => !M(id)?.secret).length;
  const ach = st().s2ach;
  const badges = ach ? ach.filter((a) => a.claimed > 0).sort((a, b) => b.claimed - a.claimed).slice(0, 5) : [];
  const playH = Math.floor((m.stats?.playMs || 0) / 3600e3);
  const stat = (t, v) => `<div class="s2-stat"><small>${t}</small><b>${v}</b></div>`;
  return `<div class="s2-prof"><button class="s2-prof-ava" data-act="s2Look" aria-label="Змінити шолом і рамку">${avatar(look, 150, m.level, '', true)}</button>
    <h2>${esc(name)}</h2><div class="s2-prof-sub">${m.club?.name ? `<span class="acc">${esc(m.club.tag ? m.club.tag + ' · ' : '')}${esc(m.club.name)}</span>` : ''}${m.vip ? `<span class="acc">${X.ic('crown')} VIP</span>` : ''}<span>рівень ${m.level}</span></div>
    <div class="s2-badges" id="s2Badges">${heroBadges(badges, m.id)}</div>
    <div class="s2-stats">${stat('Гараж', S.short(m.stats?.value || 0).replace(' ₴', ''))}${stat('Рейтинг', C.place ? '#' + C.place : '—').replace('class="s2-stat"', 'class="s2-stat" id="s2Rank"')}${stat('Кейсів', n0(m.stats?.cases))}
      ${stat('Перемог', n0(m.stats?.wins))}${stat('Колекція', have)}${stat('У грі', `${playH} год`)}</div>
    <div class="s2-prof-act"><button class="s2-btn ghost" data-act="profileOpen">${X.ic('license')}Ліцензія</button><button class="s2-btn" data-act="go" data-page="trades">${X.ic('arrows-exchange')}Обмін</button></div></div>`;
}
async function profileAfter() {
  const s = st();
  if (s.s2achAt && Date.now() - s.s2achAt < 60e3) return;
  try {
    const { list } = await X.api('achievements');
    s.s2ach = list;
    s.s2achAt = Date.now();
    if (s.tab === 'menu' && !s.page) {
      const el = document.getElementById('s2Badges');
      const badges = list.filter((a) => a.claimed > 0).sort((a, b) => b.claimed - a.claimed).slice(0, 5);
      if (el) el.innerHTML = heroBadges(badges, me().id);
    }
  } catch {}
}
// s2-fix: the picker reads / writes the server ('frames'); locked frames show how to get them.
let frameList = null;
async function lookSheet(fresh = true) {
  if (fresh || !frameList) {
    try {
      frameList = (await X.api('frames', {})).list;
    } catch {
      frameList = frameList || S.PROFILE_FRAMES.map((f) => ({ ...f, allowed: S.frameAllowed(f.id, { level: me().level, vip: me().vip, owned: me().frames || [] }) }));
    }
  }
  const l = myLook();
  const hs = Array.from({ length: S.HELMETS }, (_, i) => `<button class="s2-pick ${i === l.h ? 'on' : ''}" data-act="s2SetLook" data-k="h" data-n="${i}"><img src="s2/av/h${i}.webp" alt=""></button>`).join('');
  // Open first, then the premium ones still to buy (with their price), then the rest; «скоро» last.
  const rank = (f) => (f.allowed ? 0 : f.shop ? 1 : f.soon ? 3 : 2);
  const sorted = [...frameList].sort((a, b) => rank(a) - rank(b));
  const fs = sorted.map((f) => {
    const buy = !f.allowed && f.shop;
    return `<button class="s2-pick fr s2-fpick${f.id === l.frame ? ' on' : ''}${f.allowed ? '' : ' lock'}${buy ? ' buy' : ''}" data-act="s2SetLook" data-k="f" data-id="${f.id}" aria-label="${esc(f.name)}">
    ${avatar({ h: l.h, f: f.id }, 76, null, 's2-fpv', true)}${f.allowed || buy ? '' : `<i class="s2-lk">${X.ic('lock')}</i>`}<small>${esc(f.name)}</small>${buy ? `<em class="s2-fprice">${X.ic('star')} ${S.PROFILE_FRAME_STARS}</em>` : f.allowed ? '' : `<em>${esc(f.hint)}</em>`}</button>`;
  }).join('');
  const n = frameList.filter((f) => f.allowed).length;
  X.sheet('Мій вигляд', `<div class="s2-look-pv">${avatar(l, 160, me().level, '', true)}</div><div class="s2-h"><b>Шолом</b></div><div class="s2-picks">${hs}</div><div class="s2-h"><b>Рамка</b><span>відкрито ${n} з ${frameList.length}</span></div><div class="s2-picks s2-fpicks">${fs}</div>`);
}
// r5-frames: a premium frame not bought yet — the big live preview round the player's helmet and the buy buttons
// (app.js H.buyItem: the star credit first, else a Telegram invoice; H.buyItemStars: the stars on the account).
function frameBuySheet(f) {
  const it = S.SHOP_BY_ID[f.shop], m = me();
  X.sheet(`Рамка «${f.name}»`, `<div class="s2-look-pv">${avatar({ h: myLook().h, f: f.id }, 160, m.level, '', true)}</div>
    <div class="center muted">${esc(f.hint)} · анімована · назавжди</div>
    <div class="btns mt s2-fbuy"><button class="btn yellow" data-act="buyItem" data-id="${it.id}">${X.ic('star')} ${it.stars} · Купити</button>${(m.stars || 0) >= it.stars ? `<button class="btn ghost" data-act="buyItemStars" data-id="${it.id}" data-p="${it.stars}">з рахунку</button>` : ''}</div>
    <div class="tiny muted center mt">Після оплати рамка одразу з’явиться на аватарі</div>`);
}
// ---------- achievement badges: tap → what it is ----------
// What each achievement is for (one line) and the unit its progress counts in (plural forms for «ще N … до золота»);
// achievements with per-tier labels (rarest, tuned, plates, dream) name the next step instead of a number.
const ACH_ABOUT = {
  cases: ['За відкриті кейси з машинами', ['кейс', 'кейси', 'кейсів']], wins: ['За виграні заїзди', ['перемога', 'перемоги', 'перемог']],
  pvp: ['За перемоги в PvP-заїздах', ['перемога', 'перемоги', 'перемог']],
  battles: ['За перемоги в кейс-батлах', ['перемога', 'перемоги', 'перемог']],
  collection: ['За різні машини в колекції', ['машина', 'машини', 'машин']], rarest: ['За найрідкіснішу машину, що тобі випала', null],
  secrets: ['За секретні машини в колекції', ['машина', 'машини', 'машин']], garage: ['За колекційну ціну гаража', 'money'],
  level: ['За рівень гравця', ['рівень', 'рівні', 'рівнів']], play: ['За години в грі', ['година', 'години', 'годин']],
  streak: ['За щоденний бонус кілька днів поспіль', ['день', 'дні', 'днів']], merges: ['За злиття деталей', ['злиття', 'злиття', 'злиттів']],
  tuned: ['За машину з повним тюнінгом', null], plates: ['За рідкісний номер, який згенерував сам', null],
  friends: ['За друзів, що дійшли до 3-го рівня', ['друг', 'друзі', 'друзів']], dream: ['За здійснену машину мрії', null],
};
const TIER_TO = ['бронзи', 'срібла', 'золота', 'діаманта'];
const ACH_OF = new Map(); // owner id → his achievement list (the licence / profile row that was drawn last)
function heroBadges(badges, owner) {
  if (badges.length) return badges.map((a) => badgeBtn(a.key, a.claimed - 1, owner)).join('');
  return Object.keys(ACH_BADGE).slice(0, 5).map((k) => badgeBtn(k, -1, owner)).join('');
}
// The badge strip of the licence: earned badges, best first; my own card shows the next ones to get while none is.
function achRow(list, owner) {
  if (!list) return `<div class="lc-ach-h"><span>Значки</span></div><div class="lc-ach-row sk">${'<i></i>'.repeat(5)}</div>`;
  ACH_OF.set(Number(owner), list);
  const mine = Number(owner) === me()?.id;
  const got = list.filter((a) => a.claimed > 0).sort((a, b) => b.claimed - a.claimed || (b.value || 0) - (a.value || 0));
  const done = list.reduce((n, a) => n + (a.claimed || 0), 0);
  const total = S.ACHIEVEMENTS.reduce((n, a) => n + a.goals.length, 0);
  const show = got.length ? got.slice(0, 6).map((a) => badgeBtn(a.key, a.claimed - 1, owner)) : mine ? list.slice(0, 5).map((a) => badgeBtn(a.key, -1, owner)) : [];
  return `<div class="lc-ach-h"><span>Значки</span><small>${got.length ? `${mine ? `${done}/${total} · ` : ''}натисни на значок` : mine ? 'як отримати — натисни' : ''}</small></div>
    ${show.length ? `<div class="lc-ach-row">${show.join('')}${got.length > 6 ? `<span class="lc-ach-more">+${got.length - 6}</span>` : ''}</div>` : '<div class="lc-ach-none">Ще жодного значка</div>'}`;
}
function achPop(key, owner, list) {
  const a = S.ACH_BY_KEY[key];
  if (!a) return;
  const mine = Number(owner) === me()?.id;
  const s = list?.find((x) => x.key === key) || { key, value: null, claimed: 0, reached: 0 };
  const tier = s.claimed - 1, n = a.goals.length, max = s.claimed >= n;
  const [about, unit] = ACH_ABOUT[key] || [X.esc(a.title), null];
  const tierName = tier >= 0 ? S.ACH_TIERS[tier].name : 'Ще не отримано';
  const fmtGoal = (g, i) => (a.labels ? a.labels[i] : a.money ? S.short(g) : n0(g));
  let prog = '';
  if (max) prog = `<div class="s2-bdp-max">${X.ic('check')} Усі рівні пройдено — це найвищий значок</div>`;
  else if (s.value != null) {
    const g = a.goals[s.claimed], v = s.value || 0, frac = a.labels ? 0 : Math.min(1, v / g);
    const left = Math.max(0, g - v);
    const to = TIER_TO[s.claimed];
    let line;
    if (s.reached > s.claimed) line = mine ? `Рівень «${S.ACH_TIERS[s.claimed].name}» уже виконано — забери нагороду` : `Наступний рівень — ${S.ACH_TIERS[s.claimed].name}`;
    else if (a.labels) line = `До ${to}: ${X.esc(a.labels[s.claimed].replace(/^./, (c) => c.toLowerCase()))}`;
    else if (unit === 'money') line = `Ще ${S.short(left)} до ${to}`;
    else line = `Ще ${n0(left)} ${X.plural(left, unit || ['', '', ''])} до ${to}`;
    prog = `<div class="s2-bdp-prog">${a.labels ? '' : `<div class="s2-bdp-bar"><i style="width:${Math.round((s.reached > s.claimed ? 1 : frac) * 100)}%"></i></div>
      <div class="s2-bdp-num"><span>${a.money ? S.short(v) : n0(v)}</span><span>${fmtGoal(g, s.claimed)}</span></div>`}<b>${line}</b></div>`;
  }
  const how = tier < 0 ? `<div class="s2-bdp-how"><small>Як отримати</small>${X.esc((X.countFix || String)(S.achText(a, 0)))}</div>` : '';
  const steps = a.goals.map((g, i) => `<div class="${i < s.claimed ? 'on' : ''}${i === s.claimed && !max ? ' nx' : ''}" style="--tc:${S.ACH_TIERS[i].color}"><i></i><small>${S.ACH_TIERS[i].name}</small>${a.labels ? '' : `<em>${fmtGoal(g, i)}</em>`}</div>`).join('');
  const btn = mine ? `<button class="s2-btn${s.reached > s.claimed ? '' : ' ghost'}" data-act="s2AchGo">${s.reached > s.claimed ? `${X.ic('gift')}Забрати нагороду` : 'Усі досягнення'}</button>` : '';
  achPopClose();
  const el = document.createElement('div');
  el.className = 's2-bdp';
  el.innerHTML = `<div class="s2-bdp-bg" data-act="s2AchX"></div><div class="s2-bdp-card" role="dialog" aria-label="${X.esc(a.title)}" style="--tc:${tier >= 0 ? S.ACH_TIERS[tier].color : '#6b6f78'}">
    <button class="s2-bdp-x" data-act="s2AchX" aria-label="Закрити">✕</button>
    <div class="s2-bdp-pic">${badgeImg(key, tier)}</div>
    <span class="s2-bdp-tier">${tierName}${tier >= 0 ? ` · ${s.claimed}/${n}` : ''}</span>
    <h3>${X.esc(a.title)}</h3><p>${about}</p>${how}
    <div class="s2-bdp-steps n${n}">${steps}</div>${prog}${btn}</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
}
function achPopClose() {
  document.querySelectorAll('.s2-bdp').forEach((e) => e.remove());
}

// ---------- re-skins of existing pages (decoration after app.js drew them) ----------
function ratingAfter() {
  const pods = document.querySelectorAll('.podium .pod');
  pods.forEach((p) => {
    const place = Number((p.className.match(/p(\d)/) || [])[1]) || 3;
    const ava = p.querySelector('.pod-ava');
    if (!ava || ava.querySelector('.s2-ava')) return;
    const id = Number(p.dataset.id) || 0;
    const L = lookOf(id); // s2-fix: the player's own frame; without one the podium's gold / steel / bronze
    const f = L.frame ? L.f : place === 1 ? 'gold' : place === 2 ? 'steel' : 'bronze';
    ava.insertAdjacentHTML('afterbegin', avatar({ h: L.h, f }, place === 1 ? 92 : 74, null, '', true));
    ava.classList.add('s2-has');
  });
  const lbs = document.querySelectorAll('.list .lb .lb-ava');
  lbs.forEach((a) => {
    if (a.querySelector('img')) return;
    const id = Number(a.closest('.lb')?.dataset.id) || 0;
    const L = lookOf(id);
    if (L.frame) (a.innerHTML = avatar(L, 40), a.classList.add('s2-lbf')); // s2-fix: a worn frame shows in the row
    else (a.innerHTML = `<img src="s2/av/h${L.h}.webp" alt="">`, a.classList.add('s2-hel'));
  });
  document.querySelector('.mybar')?.classList.add('s2-mybar');
}
function clubAfter() {
  for (const a of document.querySelectorAll('.clb-mem .lb-ava')) {
    if (a.querySelector('img')) continue;
    const L = lookOf(Number(a.closest('.clb-mem')?.dataset.id) || 0);
    if (L.frame) (a.innerHTML = avatar(L, 34), a.classList.add('s2-lbf')); // r5-frames: a worn frame shows like in the rating
    else (a.innerHTML = `<img src="s2/av/h${L.h}.webp" alt="">`, a.classList.add('s2-hel'));
  }
}
function storeAfter() {
  const packs = [...document.querySelectorAll('.pk-grid .pk')];
  packs.forEach((p, i) => {
    if (p.querySelector('.s2-pk')) return;
    const k = Math.min(5, 1 + Math.round((i * 4) / Math.max(1, packs.length - 1)));
    p.insertAdjacentHTML('afterbegin', `<img class="s2-pk" src="s2/pack/m${k}.webp" alt="">`);
  });
  const vip = document.querySelector('.vip-card');
  if (vip && !vip.querySelector('.s2-vip')) vip.insertAdjacentHTML('afterbegin', '<img class="s2-vip" src="s2/x-vip.webp" alt="">');
  const dd = document.querySelector('.st-daydeal');
  if (dd && !dd.querySelector('.s2-dd')) dd.insertAdjacentHTML('afterbegin', '<img class="s2-dd" src="s2/x-chest.webp" alt="">');
}
function achAfter() {
  document.querySelectorAll('.ach-row').forEach((row) => {
    const b = row.querySelector('.badge-a');
    const key = row.querySelector('[data-act="achClaim"]')?.dataset.k || row.dataset.k;
    if (!b || b.dataset.s2) return;
    b.dataset.s2 = '1';
    const title = row.querySelector('b')?.textContent;
    const a = S.ACHIEVEMENTS.find((x) => x.title === title) || (key && S.ACH_BY_KEY[key]);
    if (!a) return;
    const tierName = row.querySelector('.grow .tiny')?.textContent?.trim();
    let tier = S.ACH_TIERS.findIndex((t) => t.name === tierName);
    if (tier < 0 && b.classList.contains('ready')) tier = 0; // reached, not claimed yet: bronze
    b.insertAdjacentHTML('beforeend', badgeImg(a.key, tier));
    b.classList.add('s2-hasbd');
  });
}

// ---------- handlers ----------
const handlers = {
  s2Ach: async (d) => {
    const owner = Number(d.o) || me().id;
    let list = ACH_OF.get(owner) || (owner === me().id ? st().s2ach : null);
    if (!list && owner === me().id) {
      try {
        list = (await X.api('achievements')).list;
        st().s2ach = list;
      } catch {}
    }
    achPop(d.k, owner, list);
  },
  s2AchX: () => achPopClose(),
  s2AchGo: () => {
    achPopClose();
    if (!document.getElementById('modal').hidden) X.closeModal();
    X.go('achievements');
  },
  s2City: (d) => {
    st().cityView = d.k === 'war' ? 'war' : 'city';
    X.render();
  },
  // «Зібрати» on the city: the garage income and every business box in one tap.
  s2CollectAll: async () => {
    const g = X.pendingNow() >= 1 ? await X.api('collect', {}).catch(() => null) : null;
    const b = (bizList() || []).some((v) => v.pending >= 1) ? await X.api('biz/collect', { all: true }).catch(() => null) : null;
    const got = (g?.got || 0) + (b?.got || 0);
    X.toast(got ? `+${S.fmt(got)}` : 'Поки нічого збирати');
    await X.refresh?.();
    X.render();
  },
  s2Spot: (d) => {
    const s = st();
    const toTab = (tab, extra) => {
      s.tab = tab; s.page = null; s.race = null;
      if (extra) extra();
      window.scrollTo(0, 0);
      X.render();
    };
    switch (d.k) {
      // s2-polish: «Аукціон» opens the car auctions (Ринок → Аукціони), or the live plate auction while one runs. «Причал»
      // (containers) keeps its own ways in: the «Причал» tile on «Ринок» and the «Причал» tab next to «Аукціони».
      case 'auction': return paOpen().length ? X.go('plateAuction') : X.isOpen('auction') ? (s.marketKind = 'car', s.marketTab = 'auction', X.go('market')) : X.H.locked({ k: 'auction' });
      case 'sto': case 'wash': case 'gas': case 'salon': return bizList()?.some((b) => b.type === d.k) ? X.H.bizOpen({ id: d.k }) : X.go('biz');
      case 'track': return toTab('race', () => (s.raceView = 'race'));
      case 'drift': return toTab('race', () => (s.raceView = 'drift'));
      case 'garage': return toTab('garage', () => (s.garageView = 'park'));
      case 'shop': return X.go('store');
      case 'club': return X.go('club');
      case 'dealer': return X.isOpen('tradein') ? X.go('tradein') : X.H.locked({ k: 'tradein' });
      case 'workshop': return X.H.workshopGo();
      case 'tire': return X.toast('Шиномонтаж — бізнес Сезону 2, відкриється незабаром');
      default: return X.toast('Вільна ділянка: тут можна буде збудувати свій бізнес');
    }
  },
  s2Parts: () => X.H.workshopGo(),
  s2Quick: (d) => (d.k === 'events' ? X.H.eventsOpen() : X.go(d.k)),
  s2Pick: (d) => {
    const s = st();
    if (s.caseId === d.id) return handlers.s2Case(d);
    s.caseId = d.id;
    s.drop = null;
    X.prefSet?.('caseId', d.id);
    X.render();
  },
  s2Case: (d) => {
    const s = st();
    if (d.id) s.caseId = d.id;
    s.s2case = !!d.id;
    s.s2all = false;
    s.drop = null;
    window.scrollTo(0, 0);
    X.render();
  },
  s2All: () => (st().s2all = !st().s2all, X.render()),
  s2Look: () => lookSheet(),
  s2SetLook: async (d) => { // s2-fix: saved on the server
    const m = me();
    if (d.k === 'f') {
      const f = frameList?.find((x) => x.id === d.id);
      if (f && !f.allowed && f.shop) return frameBuySheet(f);
      if (f && !f.allowed) return X.toast(`«${f.name}»: ${f.hint}`);
    }
    let r;
    try {
      r = d.k === 'h' ? await X.api('frames/helmet', { helmet: Number(d.n) }) : await X.api('frames/equip', { id: d.id });
    } catch (e) {
      return X.toast(e.message, true);
    }
    m.helmet = r.helmet;
    m.frame = r.equipped;
    frameList = r.list;
    lookSheet(false);
    header();
    if (st().tab === 'menu' && !st().page) {
      const a = document.querySelector('.s2-prof-ava');
      if (a) a.innerHTML = avatar(myLook(), 150, m.level, '', true);
    }
  },
};
