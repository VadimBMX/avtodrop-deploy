// «Таємний покупець» in the app (rules public/buyer.js, server src/buyer.js): a card in «Гараж» under the income card —
// not a strip on top (public/firsthour.js keeps one strip there), drawn into the garage after it renders, like the barn
// row. One tap → a confirm sheet with the sum (dealer price + premium) → buyer/sell.
import * as S from './shared.js';
import { carArt } from './car.js';
import { sellStarNote } from './prestige-ui.js';

let X = null;
const M = (id) => S.MODELS[id];

function cardHtml(o) {
  // fix5: a newcomer with no request yet — one calm line inside «Сьогодні», never a card of its own
  if (o.hint) return `<div class="card tb-card tb-hint" id="tbCard"><div class="tb-note">${X.ic('users')} ${X.esc(o.hint)}</div></div>`;
  const pct = `+${Math.round(o.prem * 100)}%`;
  const head = `<div class="tb-head"><span class="tb-ic">${X.ic('users')}</span><span class="grow tb-who"><b>Таємний покупець</b><small>з ${X.esc(o.city)}</small></span>
    ${o.sold ? '' : `<span class="tb-time">${X.ic('clock')}${X.untilSpan(o.expiresAt)}</span>`}</div>`;
  if (o.sold) { // qa4: done for today — one quiet line, no second card's worth of space
    return `<div class="card tb-card tb-sold" id="tbCard"><div class="tb-head"><span class="tb-ic">${X.ic('users')}</span><span class="grow tb-who ellipsis">Покупець з ${X.esc(o.city)}: <b>${X.esc(M(o.sold.model)?.name || '')}</b></span>
      <span class="tb-plus">+${X.esc(S.short(o.sold.paid))}</span></div></div>`;
  }
  let act;
  if (o.cars.length && o.lastCar) act = '<div class="tb-note">Це твоя остання машина — її не продати навіть покупцю.</div>';
  else if (o.cars.length === 1) {
    const c = o.cars[0];
    act = `<button class="btn sm ghost tb-btn" data-act="buyerSell" data-id="${c.id}"><span class="ellipsis">Продати ${X.esc(M(c.model).name)}</span><b>${X.esc(S.short(c.pay))}</b></button>`;
  } else if (o.cars.length) {
    act = `<button class="btn sm ghost tb-btn" data-act="buyerPick"><span>Обрати машину · ${o.cars.length}</span><b>до ${X.esc(S.short(o.cars[0].pay))}</b></button>`;
  } else {
    const cs = o.cases.map((id) => S.CASE_BY_ID[id]?.name).filter(Boolean);
    act = `<div class="tb-note">У гаражі такої немає${cs.length ? ` · найчастіше падає з кейса «${X.esc(cs[0])}»` : ''}.</div>`;
  }
  // qa4: a compact row of the «Сьогодні» card — who / what / how much more; the buyer's own line is in the confirm sheet
  // Owner 28.10 (garage too long): one line — who wants what and how much more, then the action.
  return `<div class="card tb-card tb-compact" id="tbCard"><div class="tb-head"><span class="tb-ic">${X.ic('users')}</span><span class="grow tb-who ellipsis">Покупець шукає <b>${X.esc(o.text)}</b> <span class="tb-plus">${pct}</span></span>
    <span class="tb-time">${X.ic('clock')}${X.untilSpan(o.expiresAt)}</span></div>
    ${act}</div>`;
}

function paint() {
  const st = X.state(), o = X.me()?.buyer, view = document.getElementById('view');
  if (!view) return;
  const old = document.getElementById('tbCard');
  const today = document.getElementById('todayCard'); // qa4: a row of the «Сьогодні» card when the garage has one
  const live = o && (o.hint ? !!today : o.expiresAt > X.serverNow()); // fix5: the hint lives only inside «Сьогодні»
  const show = live && !st.page && !st.race && !st.drift && st.tab === 'garage' && st.garageView !== 'showcase';
  if (!show) return old?.remove();
  const sig = o.hint ? `hint:${o.hint}` : JSON.stringify([o.day, o.sold, o.cars.map((c) => [c.id, c.pay]), o.lastCar]);
  if (old && old.dataset.sig === sig && old.parentNode === (today || view)) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = cardHtml(o).trim();
  const el = tpl.content.firstElementChild;
  el.dataset.sig = sig;
  if (old && old.parentNode === (today || view)) return old.replaceWith(el);
  old?.remove();
  if (today) return void today.append(el);
  const income = document.getElementById('incomeCard');
  if (income && income.parentNode === view) income.after(el);
}

function confirmSale(c) {
  const o = X.me().buyer, m = M(c.model), car = X.me().cars.find((x) => x.id === c.id);
  return new Promise((res) => {
    X.sheet('Продати покупцю?', `<div class="tb-sheet">
      <div class="art lit tb-art" style="--c:${S.CLASSES[m.cls].color}">${carArt(c.model, { look: car?.look, thumb: true })}</div>
      <b class="tb-name">${X.esc(m.name)}</b>
      ${o?.line ? `<div class="tb-line">«${X.esc(o.line)}»</div>` : ''}
      <div class="tb-sum">${X.esc(S.fmt(c.pay))}</div>
      <div class="small muted">Дилер дав би ${X.esc(S.fmt(c.sell))} · покупець доплачує <span class="tb-plus">+${X.esc(S.fmt(c.pay - c.sell))}</span></div>
      <div class="tiny muted mt">Деталі й номер повернуться тобі.${X.esc(sellStarNote([car].filter(Boolean)))} Покупець бере одну машину на день.</div>
      <div class="btns mt"><button class="btn ghost" data-act="buyerNo">Скасувати</button><button class="btn yellow" data-act="buyerYes">Продати</button></div></div>`);
    pending = res;
  });
}
let pending = null;
const answer = (ok) => {
  const r = pending;
  pending = null;
  X.closeModal();
  r?.(ok);
};

async function sellOne(id) {
  const o = X.me()?.buyer, c = o?.cars.find((x) => x.id === Number(id));
  if (!c) return;
  if (!(await confirmSale(c))) return;
  await X.act('buyer/sell', { carId: c.id }, (r) => `Продано покупцю: +${S.fmt(r.got)} (з них +${S.short(r.bonus)} понад дилера)`);
}

export function installBuyer(ctx) {
  X = ctx;
  const { H } = ctx;
  H.buyerSell = (d) => sellOne(d.id);
  H.buyerPick = () => {
    const o = X.me()?.buyer;
    if (!o) return;
    X.sheet('Яку машину продати?', `<div class="list tb-list">${o.cars.map((c) => `<button class="li" data-act="buyerSell" data-id="${c.id}">
      <span class="grow ellipsis"><b>${X.esc(M(c.model).name)}</b><span class="tiny muted"> · дилер ${X.esc(S.short(c.sell))}</span></span><b class="tb-plus">${X.esc(S.short(c.pay))}</b></button>`).join('')}</div>`);
  };
  H.buyerYes = () => answer(true);
  H.buyerNo = () => answer(false);
  const view = document.getElementById('view');
  if (view) new MutationObserver(() => paint()).observe(view, { childList: true });
}
