// «Шоурум» in the app (rules public/showroom.js, server src/showroom.js, share card public/showroom-card.js).
// Installed once by app.js with its helpers:
//   · page «Шоурум» (Меню → Шоурум): my showroom on top (up to 3 cars on the «Фон вітрини» backdrop, ♥ counters, one
//     yellow action — «Зібрати шоурум» while empty, «Поділитися» after), the week's prize line, then one list by tab:
//     top of the week, new, friends & club; a heart on every row (1 like per showroom per day, 5 a day in all);
//   · a player's showroom as a sheet (from the list, the player card or a sr_<id> link) with «♥ Подобається»;
//   · showroomHubRow(): the row in «Меню»; showroomStrip(p): the line on the player card; showroomFromLink().
// Naming: «Вітрина» stays what it was — the storage for cars that don't earn (garage → «Вітрина»); «Шоурум» is the
// three cars a player shows off for likes. They only point at cars, so a garage car in the showroom keeps earning.
import * as S from './shared.js';
import * as R from './showroom.js';
import { carArt } from './car.js';

let X = null; // { me, state, config, tg, H, PAGES, AFTER, PAGE_TITLES, api, toast, sheet, closeModal, go, render, ic, esc, carTile,
//               showcaseBackdrop, withFrame, nameHtml, haptic, shareCaps, authHeaders, copyText, untilSpan, tickUntil, emptyBox, tgAt }
const SR = R.SHOWROOM;
const M = (id) => S.MODELS[id];
const n0 = (n) => Number(n || 0).toLocaleString('uk-UA');

export function installShowroom(x) {
  X = x;
  X.PAGE_TITLES.showroom = 'Шоурум';
  X.PAGES.showroom = page;
  X.AFTER.showroom = () => {
    X.tickUntil();
    const st = X.state();
    if (st.srOpen) {
      const id = st.srOpen;
      st.srOpen = null;
      openShowroom(id);
    }
  };
  Object.assign(X.H, handlers);
}

// ---------- entry points ----------
export function showroomHubRow() {
  const { ic } = X, me = X.me(), b = me.showroom;
  const info = me.level < SR.level ? `${ic('lock')} з ${SR.level}-го рівня`
    : b?.n ? `♥ ${n0(b.week)} за тиждень · лайків сьогодні ${b.left}/${SR.perDay}` : `${SR.cars} найкращі машини на показ · приз тижня`;
  return `<button class="hub-store srm-hub" data-act="go" data-page="showroom"><span class="hub-ic">${ic('heart')}</span><span class="grow"><b>Шоурум</b>
    <span class="hub-i">${info}</span></span><span class="chev">${ic('chevron-right')}</span></button>`;
}
// The player card's line: the cars in his showroom and the ♥, opens the showroom.
export function showroomStrip(p) {
  const s = p?.showroom;
  if (!s?.cars?.length) return '';
  const { ic } = X;
  return `<button class="srm-strip mt" data-act="srOpen" data-id="${p.id}"><span class="srm-th">${s.cars.map((c) => `<span class="art">${carArt(c.model, { look: c.look, thumb: true })}</span>`).join('')}</span>
    <span class="grow"><b>Шоурум</b><small>♥ ${n0(s.likes)}${s.week ? ` · тиждень ${n0(s.week)}` : ''}</small></span>${ic('chevron-right')}</button>`;
}
// start_param sr_<id> (t.me/<bot>/<app>?startapp=sr_…), ?sr=<id> (the bot's button) or, in DEV, ?start=sr_<id>.
export function showroomFromLink() {
  const p = new URLSearchParams(location.search);
  const sp = X.tg?.initDataUnsafe?.start_param || p.get('start') || '';
  const id = R.SR_PARAM.exec(sp)?.[1] || (/^\d{1,20}$/.test(p.get('sr') || '') ? p.get('sr') : null);
  if (!id) return false;
  const st = X.state();
  st.srOpen = Number(id);
  st.page = 'showroom';
  return true;
}
const linkOf = (uid) => R.showroomLink(X.config().bot, X.config().app, uid) || (X.config().dev ? `${location.origin}/?sr=${uid}` : '');

// ---------- the page ----------
let V = null; // the last `showroom` answer
async function page() {
  const st = X.state();
  V = await X.api('showroom', { tab: st.srTab || 'top' });
  return mineCard(V.mine) + weekCard(V) + listHtml(V);
}
// The three places on the backdrop: a car (as it looks, with its plate frame and ★) or an empty «+».
function stage(v, { act = 'noop', empty = '' } = {}) {
  const { carTile, showcaseBackdrop, withFrame } = X;
  const slots = Array.from({ length: SR.cars }, (_, i) => v.cars[i]);
  return `<div class="grid srm-stage${showcaseBackdrop(v.style)}">${slots.map((c) => (c ? carTile(withFrame(c, v.style), { act }) : empty ? `<button class="slot srm-slot" data-act="${empty}"><span class="slot-plus">${X.ic('plus')}</span><span class="tiny">Додати</span></button>` : '')).join('')}</div>`;
}
function mineCard(v) {
  const { ic } = X, me = X.me();
  if (me.level < SR.level) {
    return `<div class="card srm-mine"><div class="row between"><b class="srm-h">${ic('heart')} Мій шоурум</b><span class="chip">${ic('lock')} рів. ${SR.level}</span></div>
      <div class="small muted mt">До ${SR.cars} машин на показ — інші гравці ставлять лайки, топ тижня отримує приз. Відкривається з ${SR.level}-го рівня; дивитися чужі шоуруми можна вже зараз.</div></div>`;
  }
  const has = v.cars.length > 0;
  return `<div class="card srm-mine"><div class="row between"><b class="srm-h">${ic('heart')} Мій шоурум</b>
      <span class="srm-likes">♥ <b>${n0(v.likes)}</b>${v.week ? `<small>· ${n0(v.week)} за тиждень${v.place ? ` · #${v.place}` : ''}</small>` : ''}</span></div>
    ${has ? stage(v, { act: 'srPick', empty: 'srPick' }) : `<div class="small muted mt">Вистав до ${SR.cars} машин такими, як вони є: фарба, ліврея, номер з рамкою, ★ престижу. Машини лишаються в гаражі й далі заробляють.</div>`}
    ${has ? `<div class="srm-acts"><button class="btn" data-act="srShare">${ic('share')} Поділитися</button><button class="btn ghost sm" data-act="srPick">Змінити</button></div>`
      : '<button class="btn mt" data-act="srPick">Зібрати шоурум</button>'}</div>`;
}
function weekCard(v) {
  const { ic, untilSpan, esc } = X;
  const p = SR.prizes;
  const last = v.lastWeek?.winners?.length ? `<div class="srm-last">${ic('trophy')} Минулого тижня: ${v.lastWeek.winners.map((w) => `<button class="txtlink" data-act="srOpen" data-id="${w.id}">${w.place}. ${esc(w.name)}</button>`).join(' · ')}</div>` : '';
  return `<div class="srm-week"><div class="row between"><b>Шоурум тижня</b><span class="chip">${ic('clock')} ${untilSpan(v.endsAt)}</span></div>
    <div class="tiny muted">Топ-${p.length} за лайками тижня: ${p.map((x) => S.short(x)).join(' / ')}, значок у профілі, а першому — рамка номера «Шоурум тижня». Лайків у тебе сьогодні: <b>${v.mine.left}</b> з ${SR.perDay}, один на шоурум.</div>${last}</div>`;
}
function listHtml(v) {
  const { ic, esc, nameHtml, emptyBox } = X;
  const st = X.state(), tab = v.tab;
  const seg = `<div class="seg srm-seg">${Object.entries(R.SR_TABS).map(([k, t]) => `<button class="${tab === k ? 'on' : ''}" data-act="srTab" data-k="${k}">${t}</button>`).join('')}</div>`;
  if (!v.list.length) {
    const why = tab === 'friends' ? ['users', 'Друзі ще не зібрали шоуруми', 'Запроси друзів або вступи в автоклуб — їхні шоуруми будуть тут'] : ['heart', 'Поки порожньо', 'Збери свій шоурум першим'];
    return seg + emptyBox(...why);
  }
  void st;
  const rows = v.list.map((r, i) => `<div class="srm-row${r.me ? ' me' : ''}" data-act="srOpen" data-id="${r.id}" role="button" tabindex="0">
      ${tab === 'top' ? `<span class="srm-pl${i < SR.prizes.length && r.week >= SR.minLikes ? ' prize' : ''}">${i + 1}</span>` : ''}
      <span class="grow srm-who"><b class="ellipsis">${nameHtml(r.name, r.style)}</b><span class="srm-th">${r.cars.map((c) => `<span class="art">${carArt(c.model, { look: c.look, thumb: true })}</span>`).join('')}</span></span>
      <span class="srm-n"><b>${n0(tab === 'top' ? r.week : r.likes)}</b><small>${tab === 'top' ? 'тиждень' : 'усього'}</small></span>
      ${r.me ? '' : `<button class="srm-heart${r.liked ? ' on' : ''}" data-act="srLike" data-id="${r.id}" aria-label="${r.liked ? 'Уже лайкнуто сьогодні' : 'Лайк'}" ${r.liked ? 'disabled' : ''}>${ic('heart')}</button>`}</div>`).join('');
  return seg + `<div class="srm-list">${rows}</div><div class="tiny muted center mt">Лайк від акаунта, молодшого за ${SR.ageH / 24} доби, чи від того, кого ти запросив (або хто запросив тебе), видно в ♥, але в «Шоурум тижня» він не йде — так топ не накрутити другими акаунтами.</div>`;
}

// ---------- a player's showroom ----------
async function openShowroom(id) {
  let v;
  try {
    v = await X.api('showroom/get', { id });
  } catch (e) {
    return X.toast(e.message, true);
  }
  showSheet(v);
}
function showSheet(v) {
  const { ic, esc, sheet, emptyBox } = X;
  const badges = (v.badges || []).map((b) => `<span class="chip srm-badge">${ic('trophy')} ${esc(b.title)}</span>`).join('');
  const like = v.self ? `<div class="srm-acts">${v.cars.length ? `<button class="btn" data-act="srShare">${ic('share')} Поділитися</button>` : ''}<button class="btn ${v.cars.length ? 'ghost sm' : ''}" data-act="srPick">${v.cars.length ? 'Змінити' : 'Зібрати шоурум'}</button></div>`
    : v.likedToday ? `<button class="btn ghost" disabled>${ic('heart')} Лайкнуто сьогодні — завтра знову</button>`
      : `<button class="btn" data-act="srLike" data-id="${v.id}" data-sheet="1" ${v.canLike ? '' : 'disabled'}>${ic('heart')} Подобається</button>${v.why ? `<div class="tiny muted center mt">${esc(v.why)}</div>` : ''}`;
  sheet(`Шоурум ${esc(v.name)}`, `<div class="srm-sh-head"><span class="srm-likes">♥ <b>${n0(v.likes)}</b>${v.week ? `<small>· ${n0(v.week)} за тиждень${v.place ? ` · #${v.place}` : ''}</small>` : ''}</span>${badges}</div>
    ${v.cars.length ? stage(v) : emptyBox('heart', 'Шоурум порожній', v.self ? `Обери до ${SR.cars} машин` : 'Гравець ще не виставив машини')}
    <div class="mt">${like}</div>
    ${v.self ? '' : `<button class="btn outline sm srm-card" data-act="playerCard" data-id="${v.id}">Картка гравця</button>`}`);
}

// ---------- choosing the cars ----------
let pick = null; // Set of car ids while the pick sheet is open
function pickSheet() {
  const { ic, esc, sheet, emptyBox } = X, me = X.me();
  const cars = me.cars.filter((c) => c.status === 'garage' || c.status === 'showcase').sort((a, b) => b.value - a.value || b.id - a.id);
  const order = [...pick];
  const rows = cars.map((c) => {
    const m = M(c.model), k = order.indexOf(c.id);
    return `<button class="li srm-pick${k >= 0 ? ' on' : ''}" data-act="srToggle" data-id="${c.id}"><div class="mini art">${carArt(c.model, { look: c.look, thumb: true })}</div>
      <div class="grow"><b class="ellipsis">${esc(m.name)}</b><div class="tiny muted"><span style="color:${S.CLASSES[m.cls].color}">${m.cls}</span>${c.stars ? ` · ${'★'.repeat(c.stars)}` : ''}${c.status === 'showcase' ? ' · на вітрині' : ''} · ${S.short(c.value)}</div></div>
      <span class="srm-ck">${k >= 0 ? k + 1 : ''}</span></button>`;
  }).join('');
  sheet('Мій шоурум', `<div class="small muted" style="margin:0 2px 10px">Обери до ${SR.cars} машин — у такому порядку їх побачать інші. Машини не переїжджають: з гаража вони й далі заробляють.</div>
    ${cars.length ? `<div class="list srm-picklist">${rows}</div>` : emptyBox('car', 'Немає машин', 'Відкрий кейс — і буде що показати')}
    <div class="srm-save"><button class="btn" data-act="srSave">${ic('check')} Зберегти · ${pick.size}/${SR.cars}</button></div>`);
}

// ---------- sharing ----------
let share = null;
async function openShare() {
  const { ic, esc, sheet, me: meFn, config } = X;
  const me = meFn();
  let v;
  try {
    v = await X.api('showroom/get', { id: me.id });
  } catch (e) {
    return X.toast(e.message, true);
  }
  if (!v.cars.length) return X.toast('Спершу постав машини в шоурум', true);
  const link = linkOf(me.id);
  sheet('Поділитися шоурумом', `<div class="chg-prev srm-prev" id="srPrev"><div class="share-wait">${ic('heart')} Малюю картку…</div></div>
    <div class="share-acts" id="srActs"></div>
    <div class="tiny muted center mt">Друзі відкриють твій шоурум і поставлять ♥. Новачок за цим посиланням стає твоїм рефералом: ${S.short(S.REF_REWARD)} тобі, коли він досягне 3-го рівня (його лайки в «Шоурум тижня» не йдуть).</div>`);
  const token = (share = { v, link, blob: null, card: null });
  const who = me.firstName || (me.username ? '@' + me.username : '');
  const blob = await import('./showroom-card.js').then((x) => x.showroomCard({ cars: v.cars, who, likes: v.likes, bot: config().bot })).catch(() => null);
  if (share !== token || !document.getElementById('srPrev')) return;
  share.blob = blob;
  const prev = document.getElementById('srPrev');
  prev.innerHTML = blob ? `<img src="${URL.createObjectURL(blob)}" alt="Картка шоуруму">` : '<div class="share-wait">Картку не вдалося намалювати — поділися посиланням</div>';
  const inline = !!(config().inline && X.tgAt('6.7') && X.tg?.switchInlineQuery);
  document.getElementById('srActs').innerHTML = `<button class="btn" data-act="srSend">${ic('share')} Надіслати в чат</button>
    <div class="btns">${inline ? `<button class="btn ghost" data-act="srInline">${ic('heart')} Через @${esc(config().bot)}</button>` : ''}<button class="btn ghost" data-act="srCopy" ${link ? '' : 'disabled'}>${ic('copy')} Скопіювати посилання</button></div>
    ${link ? `<div class="mono chg-link">${esc(link)}</div>` : ''}`;
}
async function prepared(st) {
  if (!st.card) {
    const r = await fetch('/api/share/card', { method: 'POST', headers: X.authHeaders('image/jpeg'), body: st.blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Не вдалося завантажити картку');
    st.card = j.id;
  }
  return X.api('showroom/prepare', { card: st.card });
}
const captionOf = (st) => R.showroomCaption({ who: X.me().firstName || '', names: st.v.cars.map((c) => M(c.model)?.name), likes: st.v.likes });

// ---------- handlers ----------
const handlers = {
  srTab: (d) => {
    X.state().srTab = d.k;
    X.render();
  },
  srOpen: (d) => openShowroom(Number(d.id)),
  srLike: async (d, el, e) => {
    e?.stopPropagation?.();
    if (el) el.disabled = true;
    try {
      const r = await X.api('showroom/like', { id: Number(d.id) });
      X.haptic('success');
      X.toast(r.note || `♥ Лайк! Сьогодні ще ${r.left} з ${SR.perDay}`, false);
      const me = X.me();
      if (me.showroom) me.showroom.left = r.left;
      if (d.sheet) await openShowroom(Number(d.id));
      if (X.state().page === 'showroom') X.render();
    } catch (err) {
      X.toast(err.message, true);
      if (el) el.disabled = false;
    }
  },
  srPick: () => {
    const me = X.me();
    if (me.level < SR.level) return X.toast(`Шоурум відкривається з ${SR.level}-го рівня`, true);
    pick = new Set((V?.mine?.cars || []).map((c) => c.id));
    pickSheet();
  },
  srToggle: (d) => {
    const id = Number(d.id);
    if (pick.has(id)) pick.delete(id);
    else if (pick.size >= SR.cars) return X.toast(`У шоурумі до ${SR.cars} машин — спершу прибери одну`, true);
    else pick.add(id);
    const y = document.querySelector('#sheet')?.scrollTop || 0;
    pickSheet();
    const sh = document.querySelector('#sheet');
    if (sh) sh.scrollTop = y;
  },
  srSave: async (d, el) => {
    if (el) el.disabled = true;
    try {
      const r = await X.api('showroom/set', { cars: [...pick] });
      const me = X.me();
      me.showroom = { ...(me.showroom || {}), n: r.showroom.cars.length };
      X.haptic('success');
      X.closeModal();
      X.toast(r.showroom.cars.length ? 'Шоурум оновлено' : 'Шоурум порожній');
      if (X.state().page === 'showroom') X.render();
      else X.go('showroom');
    } catch (err) {
      X.toast(err.message, true);
      if (el) el.disabled = false;
    }
  },
  srShare: () => openShare(),
  srSend: async (d, el) => {
    const st = share;
    if (!st) return;
    if (X.shareCaps().message && st.blob) {
      el.disabled = true;
      try {
        const r = await prepared(st);
        el.disabled = false;
        return X.tg.shareMessage(r.preparedId, (ok) => ok && (X.toast('Надіслано!'), X.haptic('success')));
      } catch {
        el.disabled = false; // no bot / no https: the plain share link below
      }
    }
    if (st.link) return X.H.shareRef({ link: st.link, text: captionOf(st) });
    X.copyText(captionOf(st), 'Текст скопійовано');
  },
  srInline: async (d, el) => {
    const st = share;
    if (!st) return;
    el.disabled = true;
    if (st.blob) await prepared(st).catch(() => {}); // the bot's inline answer then shows the card picture
    el.disabled = false;
    X.tg.switchInlineQuery('sr_' + X.me().id, ['users', 'groups', 'channels']);
  },
  srCopy: () => share?.link && X.copyText(share.link, 'Посилання скопійовано'),
};
