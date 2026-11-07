// «🔨 Аукціон машини» in the app (owner 07.11; server: src/car-auction.js). The car twin of plate-auction-ui.js,
// installed once by app.js with its helpers. Shows only while an auction runs (me.carAuction.open):
//   · caHubCard(): «Наживо · Аукціон машини» at the top of «Меню» — the car photo, the bid, the timer, «Перебий від …»;
//   · caBanner(): the slim strip on «Гараж» / «Кейси» / «Ринок»;
//   · page «Аукціон машини»: the car big, the current bid and leader, my status, «Поставити X» with +1/+2/+5 steps and
//     an own amount, the last bids and «Уся історія» (a sheet with every bid), the rules; polled every 4 s while open.
import * as S from './shared.js';
import { carArt } from './car.js';

let X = null; // { me, state, H, PAGES, AFTER, PAGE_TITLES, api, act, toast, go, ic, esc, untilSpan, tickUntil, serverNow, sheet, closeModal, confirmBox, emptyBox }
const POLL_MS = 4000;
const SHOW_BIDS = 5;
let poll = null;
let data = null;

const openList = () => (X.me()?.carAuction?.open || []).filter((a) => a.endsAt > X.serverNow());
const fmt = (n) => S.fmt(n);
const digits = (v) => Number(String(v ?? '').replace(/\D/g, '')) || 0;
const grp = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const nBids = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'ставка' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'ставки' : 'ставок'}`;
const colorOf = (model) => S.CLASSES[S.MODELS[model]?.cls]?.color || '#ff3df0';
const tm = (at) => new Date(at).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function installCarAuction(x) {
  X = x;
  X.PAGE_TITLES.carAuction = 'Аукціон машини';
  X.PAGES.carAuction = page;
  X.AFTER.carAuction = after;
  Object.assign(X.H, handlers);
}
export const caOpen = () => (X ? openList() : []);

// ---------- entry points ----------
export function caHubCard() {
  const list = openList();
  if (!list.length) return '';
  const { ic, esc, untilSpan } = X, a = list[0];
  return `<button class="ca-hub${a.leading ? ' lead' : ''}" data-act="go" data-page="carAuction" style="--c:${colorOf(a.model)}">
    <span class="ca-hub-h"><span class="pa-live">наживо</span><b>Аукціон машини</b>${list.length > 1 ? `<span class="pa-more">+${list.length - 1}</span>` : ''}${ic('chevron-right')}</span>
    <span class="ca-hub-b"><span class="ca-hub-art">${carArt(a.model, { thumb: true })}</span>
      <span class="ca-hub-i"><b class="ca-hub-n">${esc(a.name)}</b><small>${a.topBid ? (a.leading ? 'твоя ставка' : 'ставка') : 'старт'}</small><b class="ca-hub-p">${S.short(a.topBid || a.minBid)}</b>
      <small>${ic('clock')} ${untilSpan(a.endsAt)}</small></span></span>
    <span class="ca-hub-f">${a.leading ? `${ic('crown')} Ти лідируєш` : a.topBid ? `Перебий від ${esc(S.short(a.minBid))}` : `Будь першим — від ${esc(S.short(a.minBid))}`}</span></button>`;
}
export function caBanner() {
  const list = openList();
  if (!list.length) return '';
  const { ic, esc, untilSpan } = X, a = list[0];
  return `<button class="pa-strip ca-strip" data-act="go" data-page="carAuction"><span class="ca-strip-art">${carArt(a.model, { thumb: true })}</span>
    <span class="pa-strip-tx"><b>${a.leading ? 'Ти лідер' : a.topBid ? `Ставка ${S.short(a.topBid)}` : `Старт ${S.short(a.minBid)}`} · ${esc(a.name)}</b><small>${ic('clock')} ${untilSpan(a.endsAt)}</small></span>${ic('chevron-right')}</button>`;
}

// ---------- the page ----------
async function page() {
  data = await X.api('carAuction');
  return view();
}
function view() {
  const { ic, emptyBox } = X;
  const d = data;
  if (!d.open.length) {
    return `${d.finished.length ? `<div class="h2"><span>Останній аукціон</span></div>${d.finished.slice(0, 1).map(doneCard).join('')}` : emptyBox('hammer', 'Аукціону машин зараз немає', 'Коли адміністрація виставить лімітовану машину — тут з’явиться лот, а в групі вийде новина')}
      ${d.finished.length > 1 ? `<div class="h2"><span>Завершені</span></div><div class="list">${d.finished.slice(1).map(doneRow).join('')}</div>` : ''}`;
  }
  return `${d.open.map(card).join('')}
    <div class="card tiny muted pa-rules">${ic('info-circle')} Гроші за ставку списуються одразу. Перебили — повертаються повністю. Ставка в останні ${Math.round(d.rules.antiSnipeMs / 60e3)} хв відсуває кінець на ${Math.round(d.rules.antiSnipeMs / 60e3)} хв (разом не більше ніж на +${Math.round(d.rules.extendCapMs / 60e3)} хв). Переможець отримує машину в гараж. Це лімітована машина: її можна продати на ринку, виставити на аукціон чи обміняти з гравцями, але не продати державі.</div>
    ${d.finished.length ? `<div class="h2"><span>Завершені</span></div><div class="list">${d.finished.map(doneRow).join('')}</div>` : ''}`;
}
function card(a) {
  const { ic, esc } = X;
  const m = S.MODELS[a.model] || {};
  return `<div class="card pa-card ca-card" id="ca-${a.id}" style="--c:${colorOf(a.model)}">
    <div class="ca-stand"><span class="pa-live ca-tag">наживо</span><div class="art">${carArt(a.model, { glow: true })}</div></div>
    <div class="ca-name disp">${esc(a.name)}</div>
    <div class="pa-meta"><span class="cls" style="--c:${colorOf(a.model)}">${esc(a.cls)}</span> ${m.hp ? `${m.hp} к.с. · ` : ''}${m.year || ''} · ${ic('lock')} лімітована · тільки між гравцями</div>
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
  const quick = [1, 2, 5].map((k) => `<button class="chip pa-q" data-act="caQuick" data-id="${a.id}" data-v="${base + k * a.step}">+${k === 1 ? '' : k + '×'}крок<small>${grp(base + k * a.step)}</small></button>`).join('');
  const bal = X.me().balance;
  return `<div class="pa-quick">${quick}</div>
    <div class="pa-row"><input id="caAmt-${a.id}" class="pa-amt ca-amt" inputmode="numeric" autocomplete="off" value="${grp(a.minBid)}" data-id="${a.id}" aria-label="Своя сума">
      <button class="btn yellow pa-go" data-act="caBid" data-id="${a.id}" id="caGo-${a.id}">${ic('hammer')} Поставити</button></div>
    <div class="tiny muted pa-hint">${a.topBid ? 'перебий від' : 'мінімум'} ${fmt(a.minBid)} · крок ${fmt(a.step)}${bal < a.minBid ? ` · <span class="bad">на балансі ${S.short(bal)}</span>` : ''}</div>`;
}
const bidRow = (b, i) => `<div class="pa-b${i === 0 ? ' first' : ''}${b.me ? ' me' : ''}"><span class="ellipsis">${X.esc(b.name)}${b.me ? ' · ти' : ''}</span><b>${fmt(b.amount)}</b><small>${tm(b.at)}</small></div>`;
function hist(a) {
  if (!a.history?.length) return `<div class="tiny muted center pa-none">Ставок ще немає</div>`;
  return `<div class="pa-hh tiny muted">Останні ставки · ${nBids(a.bids)}</div>${a.history.slice(0, SHOW_BIDS).map(bidRow).join('')}
    ${a.bids > 0 ? `<button class="btn ghost sm ca-all" data-act="caHistory" data-id="${a.id}">${X.ic('clock')} Уся історія ставок</button>` : ''}`;
}
function doneCard(a) {
  const { esc } = X;
  return `<div class="card pa-card ca-card done" style="--c:${colorOf(a.model)}"><div class="ca-stand"><div class="art">${carArt(a.model, { glow: true })}</div></div>
    <div class="ca-name disp">${esc(a.name)}</div>
    <div class="pa-meta">${a.won ? `Продано за <b class="win">${fmt(a.topBid)}</b> · ${esc(a.leader)}${a.leading ? ' — це ти!' : ''}` : 'Завершився без ставок'}</div>
    ${a.history?.length ? `<div class="row center mt"><button class="btn ghost sm" data-act="caHistory" data-id="${a.id}">${X.ic('clock')} Історія ставок</button></div>` : ''}</div>`;
}
const doneRow = (a) => `<div class="li pa-done"><span class="ca-strip-art">${carArt(a.model, { thumb: true })}</span><span class="grow ellipsis">${X.esc(a.name)} · ${a.won ? X.esc(a.leader) + (a.leading ? ' · ти' : '') : 'без ставок'}</span><b>${a.won ? S.short(a.topBid) : '—'}</b></div>`;

// The detail sheet: the whole bid history of one lot.
function historySheet(a) {
  const list = a.history || [];
  X.sheet(`Ставки · ${a.name}`, `<div class="ca-sheet" style="--c:${colorOf(a.model)}"><div class="ca-sheet-art">${carArt(a.model, { thumb: true })}</div>
    <div class="pa-stats"><div><small>${a.topBid ? (a.status === 'open' ? 'поточна' : 'переможна') : 'старт'}</small><b>${S.short(a.topBid || a.startPrice)}</b></div><div><small>ставок</small><b>${a.bids}</b></div><div><small>${a.status === 'open' ? 'до кінця' : 'завершено'}</small><b>${a.status === 'open' ? X.untilSpan(a.endsAt) : tm(a.settledAt || a.endsAt)}</b></div></div>
    <div class="pa-hist">${list.length ? list.map(bidRow).join('') : '<div class="tiny muted center pa-none">Ставок ще немає</div>'}</div>
    ${a.bids > list.length ? `<div class="tiny muted center mt">показано останні ${list.length} з ${a.bids}</div>` : ''}</div>`);
  X.tickUntil();
}

// ---------- live: poll every 4 s while the page is open; swap the changing parts, keep what the player types ----------
function after() {
  X.tickUntil();
  wireInputs();
  clearInterval(poll);
  poll = setInterval(async () => {
    if (X.state().page !== 'carAuction') return void (clearInterval(poll), (poll = null));
    if (document.hidden) return;
    let d;
    try {
      d = await X.api('carAuction');
    } catch {
      return;
    }
    if (X.state().page !== 'carAuction') return;
    const ids = (l) => l.map((a) => a.id).join();
    if (ids(d.open) !== ids(data.open) || ids(d.finished) !== ids(data.finished)) {
      data = d;
      document.querySelector('#view').innerHTML = view();
      after();
      return;
    }
    for (const a of d.open) {
      const was = data.open.find((x) => x.id === a.id), el = document.getElementById('ca-' + a.id);
      if (!el || !was) continue;
      if (a.topBid !== was.topBid || a.endsAt !== was.endsAt || a.leading !== was.leading || a.outbid !== was.outbid) {
        el.querySelector('.pa-dyn').innerHTML = dyn(a);
        el.querySelector('.pa-hist').innerHTML = hist(a);
        const inp = document.getElementById('caAmt-' + a.id);
        if (a.leading !== was.leading || !inp || document.activeElement !== inp) {
          el.querySelector('.pa-form').innerHTML = form(a);
          wireInputs();
        }
        if (was.leading && !a.leading) X.toast(`Тебе перебили на ${a.name}: ${S.short(a.topBid)}`, true);
      }
    }
    data = d;
    X.tickUntil();
  }, POLL_MS);
}
function wireInputs() {
  for (const inp of document.querySelectorAll('.ca-amt')) {
    if (inp.dataset.wired) continue;
    inp.dataset.wired = '1';
    inp.addEventListener('input', () => {
      const btn = document.getElementById('caGo-' + inp.dataset.id), v = digits(inp.value);
      if (btn) btn.disabled = !v;
    });
  }
}

const handlers = {
  caQuick: (d) => {
    const inp = document.getElementById('caAmt-' + d.id);
    if (!inp) return;
    inp.value = grp(Number(d.v));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  },
  caHistory: (d) => {
    const a = [...(data?.open || []), ...(data?.finished || [])].find((x) => x.id === Number(d.id));
    if (a) historySheet(a);
  },
  caBid: async (d) => {
    const a = data?.open.find((x) => x.id === Number(d.id));
    const amount = digits(document.getElementById('caAmt-' + d.id)?.value);
    if (!a) return;
    if (amount < a.minBid) return X.toast(`Мінімальна ставка ${fmt(a.minBid)}`, true);
    if (amount > X.me().balance) return X.toast(`Не вистачає: на балансі ${fmt(X.me().balance)}`, true);
    if (!(await X.confirmBox(`Поставити ${fmt(amount)} на ${a.name}? Гроші спишуться одразу й повернуться, якщо тебе переб’ють.`))) return;
    await X.act('carAuction/bid', { id: a.id, amount }, (r) => (r.extended ? 'Ставку прийнято — аукціон продовжено' : `Ставку ${S.short(amount)} прийнято — ти лідер!`));
  },
};
