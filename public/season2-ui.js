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
export function welcomeLines(w) {
  const out = [];
  if (w.credit > 0) out.push(['star', `${w.credit} ⭐ кредиту в магазині`, `100% зірок, витрачених у Сезоні ${S.S2_RESET.prevSeason} — VIP, пакети, «Стиль» без нової оплати`]);
  for (const f of w.frames || []) if (S.FRAME_BY_ID[f]) out.push(['sparkles', `Рамка «${S.FRAME_BY_ID[f].name}»`, S.FRAME_BY_ID[f].hint, S.FRAME_BY_ID[f].img]); // s2-fix: + its picture
  if (w.veteran) out.push(['trophy', `Значок «${w.veteran.title}» · ${w.veteran.name}`, `за ${w.level}-й рівень у Сезоні ${S.S2_RESET.prevSeason} — назавжди в профілі`]);
  if (w.keys > 0) out.push(['key', `${w.keys} ${keysWord(w.keys)} «${S.CASE_BY_ID[w.caseId]?.name || w.caseId}»`, `за друзів, яких ти привів до 3-го рівня`]);
  if (w.vipSub) out.push(['crown', 'VIP-підписка', 'її зірки вже в кредиті вище; автопродовження в Telegram діє далі — вимкнути можна в магазині']);
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
      <b class="disp">СЕЗОН ${cur.season}: ОСЬ ТВОЯ КОМПЕНСАЦІЯ</b>
      <div class="muted mt">Прогрес обнулено для всіх — усі стартують рівно. За Сезон ${S.S2_RESET.prevSeason} ти отримуєш:</div>
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
