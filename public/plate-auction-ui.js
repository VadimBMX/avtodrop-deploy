// «🔨 Аукціон номера» in the app (server: src/plate-auction.js). Installed once by app.js with its helpers.
// Everything here shows only while an auction runs (me.plateAuction.open):
//   · paHubCard(): the card at the top of «Меню»; paBanner(): the slim strip on «Гараж» and «Кейси»;
//   · page «Аукціон номера»: the plate big, the current bid and leader, my status, «Поставити X» with +1/+2/+5 steps and
//     an own amount, the last 10 bids, the rules, the results of the last day; polled every 4 s while open;
//   · paAsk(): the one-time window (popups.js, kind 'plateauction') once per auction per player.
import * as S from './shared.js';

let X = null; // { me, state, H, PAGES, AFTER, PAGE_TITLES, api, act, toast, go, render, ic, esc, plate, untilSpan, tickUntil,
//               serverNow, sheet, closeModal, confirmBox, emptyBox, pop }
const POLL_MS = 4000;
const SEEN_KEY = 'avtodrop.plateAuctionAsk';
let poll = null;
let data = null; // the last page answer

const openList = () => (X.me()?.plateAuction?.open || []).filter((a) => a.endsAt > X.serverNow());
const fmt = (n) => S.fmt(n);
const digits = (v) => Number(String(v ?? '').replace(/\D/g, '')) || 0;
const grp = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const nBids = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'ставка' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'ставки' : 'ставок'}`;

export function installPlateAuction(x) {
  X = x;
  X.PAGE_TITLES.plateAuction = 'Аукціон номера';
  X.PAGES.plateAuction = page;
  X.AFTER.plateAuction = after;
  Object.assign(X.H, handlers);
}

// ---------- entry points ----------
export function paHubCard() {
  const list = openList();
  if (!list.length) return '';
  const { ic, esc, plate, untilSpan } = X, a = list[0];
  return `<button class="pa-hub${a.leading ? ' lead' : ''}" data-act="go" data-page="plateAuction" style="--c:${S.CLASSES[a.cls]?.color || '#ffc400'}">
    <span class="pa-hub-h"><span class="pa-live">наживо</span><b>🔨 Аукціон номера</b>${list.length > 1 ? `<span class="pa-more">+${list.length - 1}</span>` : ''}${ic('chevron-right')}</span>
    <span class="pa-hub-b">${plate(a.text, '', null)}<span class="pa-hub-i"><small>${a.topBid ? (a.leading ? 'твоя ставка' : 'ставка') : 'старт'}</small><b>${S.short(a.topBid || a.minBid)}</b>
      <small>${ic('clock')} ${untilSpan(a.endsAt)}</small></span></span>
    <span class="pa-hub-f">${a.leading ? `${ic('crown')} Ти лідируєш` : a.topBid ? `Перебий від ${esc(S.short(a.minBid))}` : 'Ще ніхто не ставив — будь першим'}</span></button>`;
}
export function paBanner() {
  const list = openList();
  if (!list.length) return '';
  const { ic, plate, untilSpan } = X, a = list[0];
  return `<button class="pa-strip" data-act="go" data-page="plateAuction"><span class="pa-strip-ic">🔨</span>${plate(a.text, 'sm', null)}
    <span class="pa-strip-tx"><b>${a.leading ? 'Ти лідер' : a.topBid ? `Ставка ${S.short(a.topBid)}` : `Старт ${S.short(a.minBid)}`}</b><small>${ic('clock')} ${untilSpan(a.endsAt)}</small></span>${ic('chevron-right')}</button>`;
}
// The one window per auction per player (the entry's one window, via popups.js; below «Що нового»).
export function paAsk() {
  const a = openList()[0];
  if (!a || a.leading) return;
  let seen = [];
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
  } catch {
    return;
  }
  if (!Array.isArray(seen) || seen.includes(a.id)) return;
  X.pop.offer('plateauction', () => {
    const cur = openList().find((x) => x.id === a.id);
    if (!cur || X.state().page === 'plateAuction') return false;
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, a.id].slice(-30)));
    } catch {}
    const { ic, plate, untilSpan } = X;
    X.sheet('Аукціон номера', `<div class="pa-pop"><div class="pa-pop-stand" style="--c:${S.CLASSES[cur.cls]?.color || '#ffc400'}">${plate(cur.text, 'lg', null)}</div>
      <b class="disp pa-pop-h">Аукціон номера ${X.esc(cur.text)} — встигни зробити ставку</b>
      <div class="muted mt">${X.esc(S.plateInfo(cur.text).label)} · клас ${cur.cls}. Номер дістанеться тому, хто дасть більше. ${cur.topBid ? `Зараз ${S.short(cur.topBid)}` : `Старт ${S.short(cur.minBid)}`}, до кінця <b class="win">${untilSpan(cur.endsAt)}</b></div>
      <div class="btns mt"><button class="btn yellow nowrap" data-act="paGo">${ic('hammer')} Зробити ставку</button><button class="btn ghost" data-act="closeModal">Пізніше</button></div></div>`);
    X.tickUntil();
  });
}

// ---------- the page ----------
async function page() {
  data = await X.api('plateAuction');
  return view();
}
function view() {
  const { ic, emptyBox } = X;
  const d = data;
  if (!d.open.length) {
    return `${d.finished.length ? `<div class="h2"><span>Останній аукціон</span></div>${d.finished.slice(0, 1).map(doneCard).join('')}` : emptyBox('hammer', 'Аукціону зараз немає', 'Коли адміністрація виставить номер — тут з’явиться вкладка, а в групі вийде новина')}
      ${d.finished.length > 1 ? `<div class="h2"><span>Завершені</span></div><div class="list">${d.finished.slice(1).map(doneRow).join('')}</div>` : ''}`;
  }
  return `${d.open.map(card).join('')}
    <div class="card tiny muted pa-rules">${ic('info-circle')} Гроші за ставку списуються одразу. Перебили — повертаються повністю. Ставка в останні ${Math.round(d.rules.antiSnipeMs / 60e3)} хв відсуває кінець на ${Math.round(d.rules.antiSnipeMs / 60e3)} хв від неї (разом не більше ніж на +${Math.round(d.rules.extendCapMs / 60e3)} хв). Переможець отримує номер на склад «Номери».</div>
    ${d.finished.length ? `<div class="h2"><span>Завершені</span></div><div class="list">${d.finished.map(doneRow).join('')}</div>` : ''}`;
}
function card(a) {
  const { ic, plate } = X;
  return `<div class="card pa-card" id="pa-${a.id}" style="--c:${S.CLASSES[a.cls]?.color || '#ffc400'}">
    <div class="pa-stand">${plate(a.text, 'lg', null)}</div>
    <div class="pa-meta"><span class="cls" style="--c:${S.CLASSES[a.cls]?.color}">${a.cls}</span> ${X.esc(a.label)} · ${X.esc(a.region || '')}</div>
    <div class="pa-dyn">${dyn(a)}</div>
    <div class="pa-form">${form(a)}</div>
    <div class="pa-hist">${hist(a)}</div></div>`;
}
function dyn(a) {
  const { ic, esc, untilSpan } = X;
  const status = a.leading ? `<div class="pa-me lead">${ic('crown')} Ти лідер зі ставкою ${fmt(a.topBid)}</div>`
    : a.outbid ? `<div class="pa-me out">${ic('alert-triangle')} Тебе перебили — твоя ставка ${fmt(a.myBid)} повернулась</div>` : '';
  return `<div class="pa-stats"><div><small>${a.topBid ? 'поточна ставка' : 'стартова ціна'}</small><b>${S.short(a.topBid || a.startPrice)}</b></div>
      <div><small>лідер</small><b class="ellipsis">${a.leader ? esc(a.leader) : '—'}</b></div>
      <div><small>до кінця</small><b class="pa-left">${untilSpan(a.endsAt)}</b></div></div>
    ${a.extended ? `<div class="tiny muted center">${ic('clock')} продовжено на ${Math.round(a.extended / 60e3)} хв через ставки в останні хвилини</div>` : ''}${status}`;
}
function form(a) {
  const { ic } = X;
  if (a.leading) return `<button class="btn ghost" disabled>${ic('crown')} Ти лідер — чекай або дивись, хто переб’є</button>`;
  const base = a.topBid || a.startPrice - a.step;
  const quick = [1, 2, 5].map((k) => `<button class="chip pa-q" data-act="paQuick" data-id="${a.id}" data-v="${base + k * a.step}">+${k === 1 ? '' : k + '×'}крок<small>${grp(base + k * a.step)}</small></button>`).join('');
  const bal = X.me().balance;
  return `<div class="pa-quick">${quick}</div>
    <div class="pa-row"><input id="paAmt-${a.id}" class="pa-amt" inputmode="numeric" autocomplete="off" value="${grp(a.minBid)}" data-id="${a.id}" aria-label="Своя сума">
      <button class="btn yellow pa-go" data-act="paBid" data-id="${a.id}" id="paGo-${a.id}">Поставити ${grp(a.minBid)} ₴</button></div>
    <div class="tiny muted pa-hint">мінімум ${fmt(a.minBid)} · крок ${fmt(a.step)}${bal < a.minBid ? ` · <span class="bad">на балансі ${S.short(bal)}</span>` : ''}</div>`;
}
function hist(a) {
  const { esc } = X;
  if (!a.history?.length) return `<div class="tiny muted center pa-none">Ставок ще немає</div>`;
  const t = (at) => new Date(at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return `<div class="pa-hh tiny muted">Останні ставки · ${nBids(a.bids)}</div>${a.history.map((b, i) => `<div class="pa-b${i === 0 ? ' first' : ''}${b.me ? ' me' : ''}"><span class="ellipsis">${esc(b.name)}${b.me ? ' · ти' : ''}</span><b>${fmt(b.amount)}</b><small>${t(b.at)}</small></div>`).join('')}`;
}
function doneCard(a) {
  const { esc, plate } = X;
  return `<div class="card pa-card done" style="--c:${S.CLASSES[a.cls]?.color || '#ffc400'}"><div class="pa-stand">${plate(a.text, 'lg', null)}</div>
    <div class="pa-meta">${a.won ? `Продано за <b class="win">${fmt(a.topBid)}</b> · ${esc(a.leader)}${a.leading ? ' — це ти!' : ''}` : 'Завершився без ставок'}</div></div>`;
}
const doneRow = (a) => `<div class="li pa-done">${X.plate(a.text, 'sm', null)}<span class="grow ellipsis">${a.won ? X.esc(a.leader) + (a.leading ? ' · ти' : '') : 'без ставок'}</span><b>${a.won ? S.short(a.topBid) : '—'}</b></div>`;

// ---------- live: poll every 4 s while the page is open; swap the changing parts, keep what the player types ----------
function after() {
  X.tickUntil();
  wireInputs();
  clearInterval(poll);
  poll = setInterval(async () => {
    if (X.state().page !== 'plateAuction') return void (clearInterval(poll), (poll = null));
    if (document.hidden) return;
    let d;
    try {
      d = await X.api('plateAuction');
    } catch {
      return;
    }
    if (X.state().page !== 'plateAuction') return;
    const ids = (l) => l.map((a) => a.id).join();
    // An auction started or ended: the whole page again (and `me` for the tile and banner).
    if (ids(d.open) !== ids(data.open) || ids(d.finished) !== ids(data.finished)) {
      data = d;
      document.querySelector('#view').innerHTML = view();
      after();
      return;
    }
    for (const a of d.open) {
      const was = data.open.find((x) => x.id === a.id), el = document.getElementById('pa-' + a.id);
      if (!el || !was) continue;
      if (a.topBid !== was.topBid || a.endsAt !== was.endsAt || a.leading !== was.leading || a.outbid !== was.outbid) {
        el.querySelector('.pa-dyn').innerHTML = dyn(a);
        el.querySelector('.pa-hist').innerHTML = hist(a);
        const inp = document.getElementById('paAmt-' + a.id);
        // The bid form follows the new minimum unless the player is typing in it.
        if (a.leading !== was.leading || !inp || document.activeElement !== inp) {
          el.querySelector('.pa-form').innerHTML = form(a);
          wireInputs();
        }
        if (was.leading && !a.leading) X.toast(`Тебе перебили на ${a.text}: ${S.short(a.topBid)}`, true);
      }
    }
    data = d;
    X.tickUntil();
  }, POLL_MS);
}
function wireInputs() {
  for (const inp of document.querySelectorAll('.pa-amt')) {
    if (inp.dataset.wired) continue;
    inp.dataset.wired = '1';
    inp.addEventListener('input', () => {
      const btn = document.getElementById('paGo-' + inp.dataset.id), v = digits(inp.value);
      if (btn) btn.textContent = `Поставити ${v ? grp(v) + ' ₴' : '…'}`;
    });
  }
}

const handlers = {
  paGo: () => (X.closeModal(), X.go('plateAuction')),
  paQuick: (d) => {
    const inp = document.getElementById('paAmt-' + d.id);
    if (!inp) return;
    inp.value = grp(Number(d.v));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  },
  paBid: async (d) => {
    const a = data?.open.find((x) => x.id === Number(d.id));
    const amount = digits(document.getElementById('paAmt-' + d.id)?.value);
    if (!a) return;
    if (amount < a.minBid) return X.toast(`Мінімальна ставка ${fmt(a.minBid)}`, true);
    if (amount > X.me().balance) return X.toast(`Не вистачає: на балансі ${fmt(X.me().balance)}`, true);
    if (!(await X.confirmBox(`Поставити ${fmt(amount)} на номер ${a.text}? Гроші спишуться одразу й повернуться, якщо тебе переб’ють.`))) return;
    await X.act('plateAuction/bid', { id: a.id, amount }, (r) => (r.extended ? `Ставку прийнято — аукціон продовжено` : `Ставку ${S.short(amount)} прийнято — ти лідер!`));
  },
};
