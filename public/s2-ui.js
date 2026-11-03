// «АВТОДРОП: Місто» (Season 02) — the new shell: one bottom bar (Місто · Гараж · DROP · Ринок · Профіль), the city
// home with the pannable map, «Війна районів», the Drop-market → case → opening flow, the parking, the profile hero and
// small re-skins of the rating, store and achievements. Installed once by app.js with its helpers (like the other
// *-ui.js modules); game logic stays in app.js — every action here is an existing data-act handler.
import * as S from './shared.js';
import * as B from './business.js';

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
const caseKey = (cs) => CASE_ART[cs.id] || (/hallow|hw/i.test(cs.id) ? 'halloween' : null);
const caseCol = (cs) => CASE_COL[cs.id] || (cs.country ? '#22c1a5' : clsCol(S.CLASS_ORDER.filter((k) => cs.weights[k]).pop()));
function caseArt(cs, open = false, cls = '') {
  const k = caseKey(cs);
  if (k) return `<img class="s2-cimg ${cls}" src="s2/case/${open ? 'o' : 'c'}-${k}.webp" alt="" draggable="false">`;
  if (cs.starter) return `<img class="s2-cimg ${cls}" src="s2/x-gift.webp" alt="" draggable="false">`;
  return `<span class="s2-cflag ${cls}">${X.caseIcon(cs)}</span>`;
}
// Frame holes (centre x, centre y, radius as a share of the width; the picture's own size) for placing the helmet.
const HOLES = { f0: [0.5046, 0.5527, 0.2623, 326, 332], f1: [0.4984, 0.4969, 0.3047, 320, 327], f2: [0.4969, 0.4864, 0.2875, 320, 331], f3: [0.5015, 0.541, 0.2654, 324, 329],
  f4: [0.5153, 0.5107, 0.3012, 327, 326], f5: [0.4954, 0.515, 0.2918, 329, 333], f6: [0.5015, 0.5255, 0.2886, 324, 333], f7: [0.4954, 0.5045, 0.2936, 327, 330],
  f8: [0.5015, 0.5046, 0.2893, 337, 328], f9: [0.4984, 0.4984, 0.3062, 307, 311], f10: [0.5278, 0.4968, 0.3105, 306, 310], f11: [0.4984, 0.4968, 0.3056, 306, 310],
  f12: [0.4984, 0.5413, 0.2964, 307, 327], f13: [0.4984, 0.5015, 0.3071, 311, 326],
  // s2-fix: f14–f17 measured from the pictures (the transparent hole's centroid and area); f10 re-centred (was 0.5278)
  f14: [0.4994, 0.5016, 0.279, 219, 220], f15: [0.4996, 0.4974, 0.3196, 218, 220], f16: [0.5008, 0.5011, 0.295, 215, 220], f17: [0.4997, 0.4979, 0.3177, 219, 220] };
HOLES.f10 = [0.4998, 0.4973, 0.3092, 217, 220]; // s2-fix
const holeOf = (f) => HOLES['f' + f] || [0.5, 0.5, 0.3, 1, 1];
// Achievement → badge picture (public/s2/bd/b<N>.webp, all drawn gold; lower tiers are tinted in CSS).
const ACH_BADGE = { cases: 1, wins: 2, pvp: 9, battles: 10, collection: 3, rarest: 11, secrets: 12, garage: 0, level: 13, play: 14, streak: 6, merges: 15, tuned: 16, plates: 17, friends: 5, dream: 18 };
const TIER_CLS = ['br', 'sv', 'gd', 'dm'];
const badgeImg = (key, tier, cls = '') => `<img class="s2-bd t-${tier < 0 ? 'off' : TIER_CLS[Math.min(tier, 3)]} ${cls}" src="s2/bd/b${ACH_BADGE[key] ?? 19}.webp" alt="" loading="lazy">`;

// s2-fix: the look lives on the server — me.helmet (0…8) and me.frame (S.PROFILE_FRAMES id or null; S.frameAllowed),
// set with 'frames/helmet' / 'frames/equip'. Other players: `helmet` + `frame` on every player object the API returns
// (rating, card, club, hall, battles…; market rows: sellerLook) — collected into LOOKS by UI2.onApi (app.js api()).
// No frame picked → the free «Іржа» (S.PROFILE_FRAMES rust) is drawn.
const FR_NONE = S.FRAME_BY_ID.rust.fr;
const frImg = (id) => (id && S.FRAME_BY_ID[id] ? S.FRAME_BY_ID[id].fr : FR_NONE);
const LOOKS = new Map(); // player id → { h, f (picture index), frame (id or null) }
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
function avatar({ h, f }, size, lvl = null, cls = '') {
  const [cx, cy, r, w, hh] = holeOf(f);
  const d = r * 2 * 0.98, k = w / hh; // r is a share of the width, cy of the height
  return `<span class="s2-ava ${cls}" style="width:${size}px;height:${Math.round(size / k)}px"><i class="hb" style="left:${(cx - r) * 100}%;top:${(cy - r * k) * 100}%;width:${r * 200}%;height:${r * 200 * k}%"></i>
    <img class="hm" src="s2/av/h${h}.webp" alt="" style="left:${(cx - d / 2) * 100}%;top:${(cy - (d / 2) * k) * 100}%;width:${d * 100}%">
    <img class="fr" src="s2/fr/f${f}.webp" alt="">${lvl != null ? `<b class="s2lv">${lvl}</b>` : ''}</span>`;
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
  // s2-fix: the player card (licence) shows the player's helmet in his frame
  const cardBase = X.H.playerCard;
  if (cardBase) X.H.playerCard = async (...a) => {
    const r = await cardBase(...a);
    licenceAva();
    return r;
  };
  document.getElementById('s2back')?.addEventListener('click', () => X.back());
  // DROP pressed again on the DROP tab → back to the market (capture: before app.js switches the tab).
  document.getElementById('tabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b?.dataset.tab === 'cases' && st().tab === 'cases' && !st().page) st().s2case = false;
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
  if (back) back.hidden = !s.page || !!X.tg?.initData;
  const t = document.getElementById('title');
  const look = myLook();
  // asphalt: every tab root (no page open) gets the HUD — one dark slab with the helmet, the nickname and «рівень N»
  // on the left (taps open the profile like the old round avatar), the balance slab on the right.
  const hud = !s.page;
  top.classList.toggle('s2-hud', hud);
  if (hud && t) {
    const name = m.username || m.firstName || 'Гравець';
    const sub = `рівень ${m.level}${m.vip ? ' · VIP' : ''}`;
    t.innerHTML = `<span class="s2-hudme" role="button" aria-label="Профіль">${helmet(look.h, 36)}<span class="s2-who"><b class="ellipsis">${esc(name)}</b><small class="ellipsis">${sub}</small></span></span>`;
    t.onclick = () => document.getElementById('avatar')?.click();
  } else if (t) t.onclick = null;
  // s2-ui2: every inner page gets the mockups' heading — a small section label over the title — and its section glow.
  const pg = s.page || (home ? 'city' : s.tab);
  document.body.dataset.s2pg = pg;
  const lb = !hud && pageLabel(pg);
  document.getElementById('gift')?.classList.toggle('s2-hide', !!s.page); // s2-audit
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
  { k: 'wash', x: 716, y: 322, t: 'Мийка', c: '#22e3ff', i: 'droplet', biz: 'wash' },
  { k: 'gas', x: 1040, y: 316, t: 'Заправка', c: '#ffd400', i: 'gas-station', biz: 'gas' },
  { k: 'shop', x: 415, y: 386, t: 'Магазин', c: '#39ff88', i: 'star' },
  { k: 'club', x: 1032, y: 470, t: 'Автоклуб', c: '#c084fc', i: 'users' },
  { k: 'salon', x: 1322, y: 360, t: 'Автосалон', c: '#5ee7f0', i: 'building-arch', biz: 'salon' },
  { k: 'dealer', x: 876, y: 580, t: 'Трейд-ін', c: '#a2a3a6', i: 'refresh' },
  { k: 'free1', x: 168, y: 372, t: 'Вільна ділянка', c: '#39ff88', i: 'plus', free: true },
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
    case 'auction': return paOpen().length ? '<u>LIVE</u>' : '';
    case 'track': return `<small>${m.fuel ?? 0}/${X.fmax()}</small>`;
    case 'garage': return `<em>+${shortN(m.income?.rate || 0)}</em><small>${used}/${m.slots}</small>`;
    case 'club': return m.club?.tag ? `<small>${esc(m.club.tag)}</small>` : '';
    case 'dealer': return X.isOpen('tradein') ? '' : `<small>рів.${S.unlockLevel('tradein')}</small>`;
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
  const seg = `<div class="s2-seg"><button class="${war ? '' : 'on'}" data-act="s2City" data-k="city">${X.ic('building-skyscraper')}Моє місто</button><button class="${war ? 'on' : ''}" data-act="s2City" data-k="war">${X.ic('flag-3')}Війна районів</button></div>`;
  return `<div class="s2-city" id="s2City">${seg}${war ? warMap() : cityMap()}</div>`;
}
function cityMap() {
  const labels = SPOTS.map((sp) => `<button class="s2-lb${sp.free ? ' free' : ''}${sp.k === 'garage' ? ' main' : ''}" data-act="s2Spot" data-k="${sp.k}" style="left:${(sp.x / CITY_W) * 100}%;top:${(sp.y / CITY_H) * 100}%;--c:${sp.c}"><i>${X.ic(sp.i)}</i>${sp.t}${spotText(sp)}</button>`).join('');
  const quick = [['quests', 'target-arrow', 'Цілі', me().questReady], ['events', 'calendar', 'Події', 0], ['season', 'ticket', 'Пропуск', me().season?.ready]]
    .map(([k, i, t, n]) => `<button class="s2-q" data-act="s2Quick" data-k="${k}">${X.ic(i)}<span>${t}</span>${n ? `<b>${n > 9 ? '9+' : n}</b>` : ''}</button>`).join('');
  return `<div class="s2-map" id="s2Map"><div class="s2-pan" id="s2Pan" data-w="${CITY_W}" data-h="${CITY_H}" data-x="875"><img src="s2/city.webp" alt="" draggable="false">${labels}</div>
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
const WORLD_W = 1584, WORLD_H = 672;
const DISTRICTS = [
  { n: 'Оболонь', c: '#ff8a3d', club: null, fight: true, p: [[18, 238], [300, 38], [462, 148], [178, 350]], l: [250, 200] },
  { n: 'Поділ', c: '#ffd400', club: 'Нічні вовки', e: 0, p: [[285, 365], [505, 208], [665, 318], [445, 462]], l: [470, 330] },
  { n: 'Лук’янівка', c: '#ffd400', club: 'Нічні вовки', e: 0, p: [[15, 490], [255, 372], [442, 488], [195, 605]], l: [240, 470] },
  { n: 'Печерськ', c: '#b06cff', club: 'BMW Club', e: 2, p: [[733, 350], [940, 240], [1110, 345], [905, 450]], l: [920, 330] },
  { n: 'Троєщина', c: '#3d8bff', club: 'Турбо', e: 1, p: [[975, 195], [1165, 25], [1338, 152], [1145, 268]], l: [1170, 130] },
  { n: 'Дарниця', c: '#3d8bff', club: 'Турбо', e: 1, p: [[1175, 320], [1395, 185], [1570, 290], [1330, 435]], l: [1370, 300] },
  { n: 'Позняки', c: '#ff3d5a', club: 'Drift Kings', e: 3, p: [[955, 540], [1150, 345], [1368, 522], [1172, 642]], l: [1160, 470] },
];
function warMap() {
  const poly = DISTRICTS.map((d) => `<polygon points="${d.p.map((q) => q.join(',')).join(' ')}" fill="${d.fight ? 'url(#s2ct)' : d.c}" fill-opacity="${d.fight ? 0.8 : 0.16}" stroke="${d.c}" stroke-width="5" stroke-linejoin="round"/>`).join('');
  const labels = DISTRICTS.map((d) => `<div class="s2-dl" style="left:${(d.l[0] / WORLD_W) * 100}%;top:${(d.l[1] / WORLD_H) * 100}%;--c:${d.c}">${d.fight ? '<span class="fx">⚔ СПІРНИЙ</span>' : `<span class="ow"><img src="s2/em/e${d.e}.webp" alt="">${d.club}</span>`}<b>${d.n}</b></div>`).join('');
  const leg = [['Нічні вовки', '#ffd400', 0, 2], ['Турбо', '#3d8bff', 1, 2], ['BMW', '#b06cff', 2, 1], ['DK', '#ff3d5a', 3, 1]].map(([n, c, e, k]) => `<span style="--c:${c}"><img src="s2/em/e${e}.webp" alt="">${n} <b>${k}</b></span>`).join('');
  return `<div class="s2-leg">${leg}</div>
    <div class="s2-map war" id="s2Map"><div class="s2-pan" id="s2Pan" data-w="${WORLD_W}" data-h="${WORLD_H}" data-x="420"><img src="s2/world.webp" alt="" draggable="false">
      <svg class="s2-ov" viewBox="0 0 ${WORLD_W} ${WORLD_H}" preserveAspectRatio="none"><defs><pattern id="s2ct" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="18" fill="#ffd400" fill-opacity=".3"/><rect x="9" width="9" height="18" fill="#ff3d5a" fill-opacity=".3"/></pattern></defs>${poly}</svg>${labels}</div>
      <div class="s2-ef l"></div><div class="s2-ef r"></div><div class="s2-hint">${X.ic('arrows-exchange')}Гортай карту</div></div>
    <div class="s2-sheet s2-war"><div class="s2-war-h"><b>Війна районів</b><span class="s2-soon">Скоро</span></div>
      <div class="s2-war-t">Автоклуби битимуться за райони міста: гонки за район, бонус до доходу всім учасникам клубу-переможця. Карта поки демонстраційна.</div>
      <button class="s2-btn wide" data-act="go" data-page="club">${X.ic('users')}${me().club ? 'Мій автоклуб' : 'Знайти автоклуб'}</button></div>`;
}
let pendTimer = 0;
function cityAfter() {
  watchCity(); // s2-fix
  fitCity();
  mountPan();
  requestAnimationFrame(() => (fitCity(), mountPan(), fitLabels())); // s2-fix: after paintGuide
  clearInterval(pendTimer);
  pendTimer = setInterval(() => {
    const el = document.getElementById('s2Pend');
    if (!el) return clearInterval(pendTimer);
    const biz = bizList() || [];
    el.textContent = `+${n0(X.pendingNow() + biz.reduce((a, b) => a + (b.pending || 0), 0))} ₴`;
  }, 1000);
}
// The city fills the screen between the header and the bar (no page scroll on the home screen).
// s2-fix: measured against the tab bar's real top (it is fixed: its rect is the viewport's), and measured again when the
// newbie guide strip is put above the city after this render (app.js paintGuide prepends #guide to #view) — the old
// 420 px floor pushed «Зібрати» under the bar on short screens. The map takes what is left (flex), never < 150 px.
function fitCity() {
  const el = document.getElementById('s2City');
  if (!el) return;
  window.scrollTo(0, 0);
  const top = el.getBoundingClientRect().top;
  const tabs = document.getElementById('tabs');
  const tr = tabs?.getBoundingClientRect();
  // the bar's highest part (the raised DROP button sticks out above the bar)
  const barTop = tr && tr.height ? Math.min(tr.top, ...[...tabs.querySelectorAll('*')].map((b) => b.getBoundingClientRect()).filter((r) => r.width > 30 && r.top > 0).map((r) => r.top)) : window.innerHeight - 76;
  const gap = 8;
  const want = Math.floor(barTop - top - gap);
  const sheet = el.querySelector('.s2-sheet'), seg = el.querySelector('.s2-seg'), leg = el.querySelector('.s2-leg');
  const fixed = (sheet?.offsetHeight || 0) + (seg?.offsetHeight || 0) + (leg?.offsetHeight || 0) + 24;
  const h = Math.max(fixed + 150, want);
  if (el.style.height !== h + 'px') el.style.height = h + 'px';
}
let fitObs = null;
function watchCity() { // s2-fix
  const view = document.getElementById('view');
  if (!view || fitObs) return;
  fitObs = new MutationObserver((list) => {
    if (!document.getElementById('s2City')) return;
    if (list.some((m) => [...m.addedNodes, ...m.removedNodes].some((n) => n.id === 'guide' || n.id === 'nextUl'))) (fitCity(), mountPan(), fitLabels());
  });
  fitObs.observe(view, { childList: true });
  document.addEventListener('click', (e) => { // the guide pill opens / closes in place
    if (e.target.closest?.('#guide') && document.getElementById('s2City')) requestAnimationFrame(() => (fitCity(), mountPan(), fitLabels()));
  });
}
window.addEventListener('resize', () => {
  if (document.getElementById('s2City')) (fitCity(), mountPan(), fitLabels());
});
// s2-fix: building labels never cut off by the screen edge. While panning, a label near an edge slides inwards
// (--dx; its pointer stays on the building), and when even that can't fit it, the level part is dropped (.s2-tight).
const LB_PAD = 10;
let lbView = 0;
function fitLabels() {
  const vp = document.getElementById('s2Map'), pan = document.getElementById('s2Pan');
  if (!vp || !pan) return;
  lbView = vp.clientWidth;
  for (const lb of pan.querySelectorAll('.s2-lb')) (lb.classList.remove('s2-tight'), (lb._w = 0));
  const m = /translate3d\((-?[\d.]+)px/.exec(pan.style.transform || '');
  clampLabels(m ? Number(m[1]) : 0);
}
function clampLabels(x) {
  const pan = document.getElementById('s2Pan');
  if (!pan || !pan.querySelector('.s2-lb')) return;
  const V = lbView || (lbView = document.getElementById('s2Map')?.clientWidth || 0), W = pan.offsetWidth;
  if (!V || !W) return;
  for (const lb of pan.querySelectorAll('.s2-lb')) {
    if (!lb._w) lb._w = lb.offsetWidth;
    const ax = x + (parseFloat(lb.style.left) / 100) * W;
    let half = lb._w / 2;
    const need = (ax - half < LB_PAD ? LB_PAD - (ax - half) : ax + half > V - LB_PAD ? V - LB_PAD - (ax + half) : 0);
    if (need && Math.abs(need) > half - 14 && ax > -half && ax < V + half && !lb.classList.contains('s2-tight') && lb.querySelector('small')) {
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
  const all = [...pan.querySelectorAll('.s2-lb')];
  const rc = all.map((lb) => lb.getBoundingClientRect());
  all.forEach((lb, i) => {
    const slid = !!lb.style.getPropertyValue('--dx');
    const hit = slid && all.some((o, j) => j !== i && !o.classList.contains('s2-hid') && rc[j].left < rc[i].right - 2 && rc[j].right > rc[i].left + 2 && rc[j].top < rc[i].bottom - 2 && rc[j].bottom > rc[i].top + 2);
    lb.classList.toggle('s2-hid', hit);
  });
}
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
    if (Math.abs(dx) > 6 && !moved) (moved = true, vp.setPointerCapture?.(e.pointerId), vp.classList.add('drag'));
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
  if (free < n) return `<button class="s2-open" disabled>Вільно ${free} з ${m.slots}</button>`;
  if (paid && price * paid > m.balance) return `<button class="s2-open" disabled>Бракує ${S.short(price * paid - m.balance)}</button>`;
  return `<button class="s2-open opencase" data-act="openCase" data-expect="${price * paid}">${X.ic('box')}<span class="l">${cs.starter ? 'Відкрити' : 'Відкрити'}</span><span class="p">${cs.starter ? 'безкоштовно' : paid ? shortN(price * paid) + ' ₴' : `${X.ic('key')} ${n}`}</span></button>`;
}
function dock(cs) {
  const s = st(), n = cs.starter ? 1 : s.count || 1;
  const free = me().slots - me().used;
  const counts = cs.starter ? '' : `<div class="s2-cnt">${[1, 3, 6].map((k) => `<button class="${k === n ? 'on' : ''}" data-act="pickCount" data-n="${k}">×${k}</button>`).join('')}</div>`;
  return `<div class="s2-dock">${counts}${openBtn(cs, n)}</div>${free < n && free >= 0 && !cs.starter ? `<div class="s2-note">${free > 0 ? `Не вистачає місця для ×${n} — обери ×1 або продай машину` : 'Гараж заповнений — продай машину або купи місце в гаражі'} · <a class="txtlink" data-act="sellCheap" data-n="${Math.max(1, n - free)}">продати найдешевші</a></div>` : ''}`;
}
function oddsTiles(cs, weights) {
  const tw = Object.values(weights).reduce((a, b) => a + b, 0);
  return S.CLASS_ORDER.filter((k) => weights[k]).slice(-4).map((k) => `<div class="s2-od" style="--c:${clsCol(k)}"><b>${X.pct((weights[k] / tw) * 100)}</b><small>клас ${k}</small></div>`).join('');
}
function marketView(base) {
  const s = st(), m = me();
  const cs = S.CASE_BY_ID[s.caseId] || S.CASE_BY_ID.rust;
  const deal = X.caseNow(cs), keys = m.keys[cs.id] || 0;
  const tag = deal.why === 'day' ? `${X.ic('flame')} Кейс дня −${S.CASE_OF_DAY.off * 100}%` : deal.off ? `${X.ic('flame')} −${Math.round((1 - deal.price / cs.price) * 100)}%` : cs.starter ? `${X.ic('gift')} Подарунок новачку` : cs.country ? `${X.ic('world')} Країна` : `${X.ic('box')} За рідкістю`;
  const feat = `<div class="s2-feat" style="--cc:${caseCol(cs)}" data-act="s2Case" data-id="${cs.id}" role="button">
    <div class="s2-feat-tx"><span class="s2-tag">${tag}</span><h3>${esc(cs.name)}</h3>
      <div class="s2-price">${cs.starter ? 'Безкоштовно' : S.fmt(deal.price)}${deal.off ? ` <s>${shortN(cs.price)}</s>` : ''}</div>
      ${keys && !cs.starter ? `<div class="s2-keys">${X.ic('key')} ключів: ${keys}</div>` : `<div class="s2-keys muted">Що всередині ${X.ic('chevron-right')}</div>`}</div>
    <div class="s2-feat-art" id="stage">${caseArt(cs)}</div>
    <div class="s2-ods">${oddsTiles(cs, deal.weights)}</div></div>`;
  const list = S.CASES.filter((c) => !c.starter || m.keys[c.id]);
  const tile = (c) => {
    const dl = X.caseNow(c);
    return `<button class="s2-ct ${c.id === cs.id ? 'on' : ''}" style="--cc:${caseCol(c)}" data-act="s2Pick" data-id="${c.id}">${dl.why === 'day' || dl.off ? '<span class="s2-ct-hot">−%</span>' : ''}${m.keys[c.id] && !c.starter ? `<span class="s2-ct-key">${X.ic('key')}${m.keys[c.id]}</span>` : ''}${caseArt(c)}<b>${esc(CASE_SHORT[c.id] || c.name)}</b><small>${c.starter ? 'ключ' : shortN(dl.price)}</small></button>`;
  };
  const rar = list.filter((c) => c.group !== 'country'), cty = list.filter((c) => c.group === 'country');
  return `<div class="feed" id="dropFeed" hidden></div><div class="s2-page s2-drop">
    <div class="s2-ttl"><small style="--c:#ff3df0">DROP · MARKET</small><h2>Дроп-маркет</h2></div>${feat}
    <div class="s2-h"><b>Усі кейси</b><span>за рідкістю · країни</span></div><div class="s2-cgrid">${rar.map(tile).join('')}</div>
    <div class="s2-h"><b>Країни</b><span>${cty.length}</span></div><div class="s2-cgrid">${cty.map(tile).join('')}</div>
    ${dock(cs)}
    <div class="fastrow"><span>${X.ic('bolt')} Швидке відкриття <small>без анімації</small></span><button class="toggle ${s.fast ? 'on' : ''}" data-act="toggleFast" aria-label="Швидке відкриття"></button></div>
    ${X.brokeCard()}</div>`;
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
  const shown = s.s2all ? cars : order.flatMap((k) => cars.filter((c) => c.k === k).slice(0, per)).slice(0, 9);
  const grid = shown.map(({ md, k, p }) => `<div class="s2-cc" style="--c:${clsCol(k)}"><span class="s2-cl">${k}</span><em>${X.pct(p)}</em>${owned.has(md.id) ? '<span class="s2-own">✓</span>' : ''}<div class="art">${X.carArt(md.id, { thumb: true })}</div><b>${shortN(S.dropSaleOf(md.id, cs))}</b><small class="ellipsis">${esc(md.name)}</small></div>`).join('');
  const fr = m.fragments?.[cs.id] || 0, need = S.FRAGMENTS_PER_KEY;
  return `<div class="feed" id="dropFeed" hidden></div><div class="s2-page s2-case" style="--cc:${caseCol(cs)}">
    <div class="s2-ch"><button class="s2-rb" data-act="s2Case" data-id="">${X.ic('chevron-left')}</button><div><small>КЕЙС · ${cs.starter ? 'ПОДАРУНОК' : shortN(deal.price).toUpperCase() + ' ₴'}</small><h2>${esc(cs.name)}</h2></div></div>
    <div class="s2-hero"><div class="s2-hero-art" id="stage">${caseArt(cs)}</div><div class="s2-hero-tx"><b>Шанс на ${top}-клас</b><span>${X.pct((W[top] / tw) * 100)}${pity ? ` · гарантія ${pity.cls} через ${pLeft}` : ''}</span>
      <button class="s2-link" data-act="odds">${X.ic('info-circle')} Усі шанси</button></div></div>
    <div class="s2-card s2-bars">${bars}</div>
    <div class="s2-h"><b>Що всередині · ${cars.length} ${X.plural(cars.length, ['машина', 'машини', 'машин'])}</b>${cars.length > 9 ? `<button class="s2-link" data-act="s2All">${s.s2all ? 'Згорнути' : 'Всі'} ${X.ic('chevron-right')}</button>` : ''}</div>
    <div class="s2-cgrid cars">${grid}</div>
    ${cs.starter ? '' : `<div class="s2-card s2-frag"><div class="row between"><span>${X.ic('key')} Фрагменти ключа</span><b>${fr}/${need}</b></div><div class="pips">${Array.from({ length: need }, (_, i) => `<i class="${i < fr ? 'on' : ''}"></i>`).join('')}</div><div class="tiny muted">${need} фрагментів = безкоштовне відкриття. Фрагмент дає машина, дешевша за кейс.</div></div>`}
    ${dock(cs)}
    <div class="fastrow"><span>${X.ic('bolt')} Швидке відкриття <small>без анімації</small></span><button class="toggle ${s.fast ? 'on' : ''}" data-act="toggleFast" aria-label="Швидке відкриття"></button></div></div>`;
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
    const sum = tpl.content.querySelector('.multi-sum');
    const cell = (r, i) => {
      const md = M(r.car.model), rank = S.rankOf(md.cls), color = clsCol(md.cls);
      const sell = X.dropAlive(r) ? `<button class="dropsell" data-act="sellDrop" data-id="${r.car.id}">${X.ic('cash')}Продати · ${S.short(X.sellPrice(r.car))}</button>`
        : r.sold ? '<div class="dropsell done">Продано</div>' : '';
      return `<div class="a-mc r${rank} ${fresh ? 'flip-in' : ''}" style="--c:${color};animation-delay:${i * 160}ms">
        <div class="a-stage sm" ${r.sold ? '' : `data-act="car" data-id="${r.car.id}" role="button"`}><i class="a-fade"></i><div class="a-car"><div class="art">${X.carArt(r.car.model, { glow: rank >= 3 })}</div></div></div>
        <div class="a-mc-tx"><div class="a-head"><span class="a-cls" style="--c:${color}">${md.cls}</span><span class="a-clsn">${esc(S.CLASSES[md.cls].name)}</span>${r.isNew ? '<span class="a-new">нова</span>' : ''}</div>
        <b class="a-mc-n ellipsis">${esc(md.name)}</b><div class="a-mc-p">${S.short(X.sellPrice(r.car))}<small>${X.carInc(r.car) ? ` · +${shortN((X.carInc(r.car).rate ?? X.carInc(r.car).income ?? X.carInc(r.car)))}/год` : ''}</small></div>${sell}</div></div>`;
    };
    return `<div class="s2-multi a-multi"><div class="a-from">${esc(cs.name)} · ×${d.length} відкрито</div>
      <div class="a-car3" id="aCar3">${d.map(cell).join('')}</div>
      <div class="a-dots">${d.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
      ${sum ? sum.outerHTML : ''}${dockEl ? dockEl.outerHTML : ''}${share}</div>`;
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
  // ×3/×6 carousel: the dots follow the scroll
  const car3 = document.getElementById('aCar3');
  if (car3) car3.onscroll = () => {
    const k = Math.round(car3.scrollLeft / (car3.firstElementChild?.offsetWidth + 12 || 1));
    car3.parentElement.querySelectorAll('.a-dots i').forEach((el, i) => el.classList.toggle('on', i === k));
  };
}
// Opening: the closed case shakes harder and harder, a flash in the drop's colour, the lid flies open — then the result.
function openAnim(cs, r) {
  return new Promise((resolve) => {
    const best = r.results.reduce((a, x) => Math.max(a, S.rankOf(M(x.car.model).cls)), 0);
    const color = S.CLASSES[S.CLASS_ORDER[best]].color;
    const ov = document.createElement('div');
    ov.className = 's2-openov';
    ov.style.setProperty('--c', color);
    ov.innerHTML = `<div class="s2-rays"></div><div class="s2-oc">${caseArt(cs)}</div><div class="s2-oc open">${caseArt(cs, true)}</div><div class="s2-flash"></div><div class="s2-ot">${esc(cs.name)}${r.results.length > 1 ? ` · ×${r.results.length}` : ''}</div>`;
    document.body.appendChild(ov);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const T = reduce ? [200, 300, 500] : [1300, 1550, 2050];
    X.haptic('light');
    const ticks = reduce ? [] : [250, 500, 700, 880, 1020, 1140, 1240].map((t) => setTimeout(() => (X.haptic('light'), X.SFX.tick?.(1 + t / 2000)), t));
    requestAnimationFrame(() => ov.classList.add('go'));
    setTimeout(() => (ov.classList.add('burst'), X.haptic(best >= 3 ? 'heavy' : 'medium'), X.SFX.pop?.(best)), T[0]);
    setTimeout(() => ov.classList.add('opened'), T[1]);
    setTimeout(() => {
      ticks.forEach(clearTimeout);
      ov.classList.add('out');
      setTimeout(() => ov.remove(), 300);
      resolve();
    }, T[2]);
  });
}

// ---------- Гараж: «Мій паркінг» ----------
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
  const empties = Array.from({ length: Math.min(free, 2) }, (_, i) => `<button class="s2-fl a-fl empty" data-act="toCases"><span class="a-pn">P${cars.length + free - i}</span><span class="s2-fl-hint">${X.ic('plus')} Вільне місце — відкрий кейс</span></button>`).join('');
  return parkHead() + `${X.vipSaleBanner()}${X.paBanner()}<div class="seg s2-gseg">${[['park', 'Паркінг'], ['cars', 'Машини'], ['showcase', 'Вітрина']].map(([k, t]) => `<button class="${s.garageView === k ? 'on' : ''}" data-act="gView" data-k="${k}">${t}</button>`).join('')}</div>
    <div class="s2-inc"><div class="grow"><small>${X.ic('coin')} Дохід гаража · ${shortN(m.income.rate)}/год</small><b id="pending">${S.fmt(X.pendingNow())}</b></div><button class="s2-btn sm" data-act="collect" ${X.pendingNow() < 1 ? 'disabled' : ''}>Забрати</button></div>
    <div class="s2-park"><div class="s2-sign"><span>${esc(name)} · PARKING</span></div>${build}${empties}${cars.length ? cars.map((c, i) => floor(c, cars.length - i)).join('') : ''}</div>
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
  return `<div class="s2-prof"><button class="s2-prof-ava" data-act="s2Look" aria-label="Змінити шолом і рамку">${avatar(look, 150, m.level)}</button>
    <h2>${esc(name)}</h2><div class="s2-prof-sub">${m.club?.name ? `<span class="acc">${esc(m.club.tag ? m.club.tag + ' · ' : '')}${esc(m.club.name)}</span>` : ''}${m.vip ? `<span class="acc">${X.ic('crown')} VIP</span>` : ''}<span>рівень ${m.level}</span></div>
    <div class="s2-badges" id="s2Badges">${badges.length ? badges.map((a) => badgeImg(a.key, a.claimed - 1)).join('') : Object.keys(ACH_BADGE).slice(0, 5).map((k) => badgeImg(k, -1)).join('')}</div>
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
      if (el && badges.length) el.innerHTML = badges.map((a) => badgeImg(a.key, a.claimed - 1)).join('');
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
  const sorted = [...frameList].sort((a, b) => (b.allowed - a.allowed) || (a.soon ? 1 : 0) - (b.soon ? 1 : 0));
  const fs = sorted.map((f) => `<button class="s2-pick fr s2-fpick${f.id === l.frame ? ' on' : ''}${f.allowed ? '' : ' lock'}" data-act="s2SetLook" data-k="f" data-id="${f.id}" aria-label="${esc(f.name)}">
    <img src="${f.img}" alt="">${f.allowed ? '' : `<i class="s2-lk">${X.ic('lock')}</i>`}<small>${esc(f.name)}</small>${f.allowed ? '' : `<em>${esc(f.hint)}</em>`}</button>`).join('');
  const n = frameList.filter((f) => f.allowed).length;
  X.sheet('Мій вигляд', `<div class="s2-look-pv">${avatar(l, 120, me().level)}</div><div class="s2-h"><b>Шолом</b></div><div class="s2-picks">${hs}</div><div class="s2-h"><b>Рамка</b><span>відкрито ${n} з ${frameList.length}</span></div><div class="s2-picks s2-fpicks">${fs}</div>`);
}
// The licence (player card / my licence): the helmet in the frame instead of the initial.
function licenceAva() {
  document.querySelectorAll('.licence .lic-ava').forEach((a) => {
    if (a.dataset.s2) return;
    const id = Number((a.closest('.licence')?.querySelector('.lic-id')?.textContent || '').replace(/\D/g, ''));
    if (!id) return;
    a.dataset.s2 = '1';
    const lvl = a.querySelector('.lvl')?.textContent;
    a.innerHTML = avatar(lookOf(id), 84, lvl ?? null);
    a.classList.add('s2-lic');
  });
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
    const f = L.frame ? L.f : place === 1 ? 0 : place === 2 ? 7 : 11;
    ava.insertAdjacentHTML('afterbegin', avatar({ h: L.h, f }, place === 1 ? 92 : 74));
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
    a.innerHTML = `<img src="s2/av/h${L.h}.webp" alt="">`;
    a.classList.add('s2-hel');
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
      case 'auction': return paOpen().length ? X.go('plateAuction') : X.isOpen('auction') ? X.H.pierGo() : (s.tab = 'bazaar', X.go('market'));
      case 'sto': case 'wash': case 'gas': case 'salon': return bizList()?.some((b) => b.type === d.k) ? X.H.bizOpen({ id: d.k }) : X.go('biz');
      case 'track': return toTab('race', () => (s.raceView = 'race'));
      case 'drift': return toTab('race', () => (s.raceView = 'drift'));
      case 'garage': return toTab('garage', () => (s.garageView = 'park'));
      case 'shop': return X.go('store');
      case 'club': return X.go('club');
      case 'dealer': return X.isOpen('tradein') ? X.go('tradein') : X.H.locked({ k: 'tradein' });
      case 'tire': return X.toast('Шиномонтаж — бізнес Сезону 2, відкриється незабаром');
      default: return X.toast('Вільна ділянка: тут можна буде збудувати свій бізнес');
    }
  },
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
      if (a) a.innerHTML = avatar(myLook(), 150, m.level);
    }
  },
};
