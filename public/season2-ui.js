// «Сезон 02» in the app (server: src/season2.js). Installed once by app.js with its helpers.
//   · s2Ask(): the one-time window after the wipe (popups.js, kind 's2welcome') — what the player got as compensation;
//     closing it tells the server ('s2/welcome-seen'), so it never comes back on any device;
//   · s2PayCredit(): the shop pays from the star credit first when it covers the price (asks, then 'shop/credit');
//     otherwise the usual Telegram invoice opens;
//   · s2CreditCard(): the credit's line in the shop.
import * as S from './shared.js';

let X = null; // { me, H, api, act, toast, ic, esc, sheet, closeModal, confirmBox, pop, refresh }
let asked = false;

export function installSeason2(x) {
  X = x;
  Object.assign(X.H, handlers);
}

const keysWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'ключ' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'ключі' : 'ключів');

// The compensation as lines (also used by the tests through the server payload shape).
// wText 2026-11-03: each line says what it is and why the player got it; no numbers but the player's own.
export function welcomeLines(w) {
  const out = [];
  const prev = S.S2_RESET.prevSeason;
  if (w.credit > 0) out.push(['star', `${w.credit} ⭐ кредиту в магазині`, `${S.S2_RESET.creditPct}% зірок, витрачених у Сезоні ${prev} (VIP, «Стиль», пакети). Ними можна платити в магазині замість Telegram Stars`]);
  // s2-fix: + its picture; the first one is already worn (src/season2.js compensate: S2_RESET.framePriority)
  (w.frames || []).filter((f) => S.FRAME_BY_ID[f]).forEach((f, i) => out.push(['sparkles', `Рамка «${S.FRAME_BY_ID[f].name}»`, `${S.FRAME_BY_ID[f].hint}${i ? '' : ' · уже на аватарі'}`, S.FRAME_BY_ID[f].img]));
  if (w.veteran) out.push(['trophy', `Значок «${w.veteran.title}» · ${w.veteran.name}`, `за ${w.level}-й рівень у Сезоні ${prev} — назавжди в профілі`]);
  if (w.keys > 0) {
    const capped = w.friends > w.keys ? ` (максимум ${S.S2_RESET.friendKeysMax})` : '';
    out.push(['key', `${w.keys} ${keysWord(w.keys)} «${S.CASE_BY_ID[w.caseId]?.name || w.caseId}»`, `по ключу за кожного друга, якого ти привів до 3-го рівня${capped}`]);
  }
  if (w.vipSub) out.push(['crown', 'VIP-підписка', 'VIP обнулився разом із прогресом, його зірки — у кредиті вище. Підписка в Telegram продовжується далі, вимкнути — в магазині']);
  return out;
}

export function s2Ask() {
  const w = X?.me()?.s2Welcome;
  if (!w || asked) return;
  X.pop.offer('s2welcome', () => {
    const cur = X.me()?.s2Welcome;
    if (!cur) return false;
    asked = true;
    const { ic, esc } = X;
    const lines = welcomeLines(cur);
    X.sheet(`Сезон ${cur.season}`, `<div class="card center s2-pop"><div class="tg-home-ic">${ic('flag-3')}</div>
      <b class="disp">СЕЗОН ${cur.season} · «МІСТО»</b>
      <div class="muted mt">Прогрес обнулено для всіх, щоб нові бізнеси й економіка були чесними з першого дня. Акаунт, друзі, клуб і покупки — на місці.</div>
      <div class="mt">${lines.length ? `Дякуємо, що грав у Сезоні ${S.S2_RESET.prevSeason}! Ось що тобі повернулося:` : 'Стартовий кейс уже чекає — відкривай і будуй гараж заново.'}</div>
      ${lines.length ? `<div class="s2-list">${lines.map(([i, t, s, img]) => `<div class="s2-li">${img ? `<img class="s2-li-fr" src="${img}" alt="">` : ic(i)}<span><b>${esc(t)}</b><small>${esc(s)}</small></span></div>`).join('')}</div>` : ''}
      <div class="btns mt"><button class="btn yellow" data-act="s2Ok">Погнали!</button></div></div>`);
    X.api('s2/welcome-seen', {}).then(() => {
      if (X.me()) X.me().s2Welcome = null;
    }).catch(() => {});
  });
}

// true = handled here (paid from the credit, or the player said no); false = go on with the Telegram invoice.
export async function s2PayCredit(body) {
  if (!(X?.me()?.starCredit > 0)) return false;
  const q = await X.api('shop/credit', body);
  if (!q?.enough) return false;
  if (!(await X.confirmBox(`Оплатити ${q.price} ⭐ з кредиту Сезону ${S.S2_RESET.prevSeason}? Лишиться ${q.credit - q.price} ⭐`))) return true;
  const r = await X.act('shop/credit', { ...body, confirm: true }, 'Готово — оплачено кредитом');
  if (r) X.refresh();
  return true;
}

export function s2CreditCard(sh) {
  if (!(sh?.starCredit > 0)) return '';
  return `<div class="card row stars-card"><span class="ic tint" style="--c:#38bdf8">${X.ic('star')}</span><div class="grow"><b>Кредит Сезону ${S.S2_RESET.prevSeason}</b><div class="tiny muted">компенсація — оплачує будь-яку покупку за зірки</div></div><b class="disp stars-n">${sh.starCredit}</b></div>`;
}

const handlers = {
  s2Ok: () => X.closeModal(),
};
