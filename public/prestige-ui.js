// «Престиж» in the app (rules public/prestige.js, server src/prestige.js). Installed once by app.js with its helpers.
//   · ★ on a car: starsHtml(c) — garage tiles, list rows (market, trades, rooms), the car sheet;
//   · the restyle sheet of one car (cost, what the ★ gives, payback, the 24 h timer, «slot first»);
//   · «Трофейна зала» (sheet): the trophies, the restyled cars with their timers, «Статок»; a row in the menu.
// One yellow button per sheet: the slot offer when there is one, otherwise the ★ / the next trophy.
import * as S from './shared.js';
import * as P from './prestige.js';
import { carArt } from './car.js';

let cur = null; // the open sheet: { car: id } or { hall: true }
let X = null; // { me(), H, ic, esc, sheet, act, api, carSheet, go, serverNow, clockOffset(), carInc(c), toast, closeModal }

// ★★★ in gold, the rest of the five as dim outlines (full = always 5 marks; otherwise only the ★ the car has).
export function starsHtml(c, { full = false, cls = '' } = {}) {
  const n = Math.min(P.PRESTIGE.max, c?.stars || 0);
  if (!n && !full) return '';
  return `<span class="pr-stars ${cls}${n >= P.PRESTIGE.max ? ' max' : ''}" role="img" aria-label="Рестайлінг ${n} з ${P.PRESTIGE.max}">${P.STAR.repeat(n)}${full ? `<i>${'☆'.repeat(P.PRESTIGE.max - n)}</i>` : ''}</span>`;
}
// Extra class for a garage tile: the ★5 gold frame.
export const starTileCls = (c) => ((c?.stars || 0) >= P.PRESTIGE.max ? ' pr-gold' : '');
// Sale dialog: a line about the ★ that leave with the car (the dealer pays the usual class share).
export function sellStarNote(cars) {
  const st = cars.filter((c) => c?.stars);
  if (!st.length) return '';
  const spent = st.reduce((s, c) => s + (c.starSpent || P.restyleSpent(c.model, c.stars)), 0);
  return ` Увага: ${st.length > 1 ? `у ${st.length} машин є` : 'у машини є'} ${P.STAR} рестайлінгу (вкладено ${S.short(spent)}) — дилер їх не оплачує, вони пропадуть. На ринку чи в обміні ★ переходять до покупця.`;
}

const pr = () => X.me()?.prestige || { open: false, trophies: 0 };
const untilHtml = (t) => `<span data-until="${t - X.clockOffset()}">${left(t - X.serverNow())}</span>`;
function left(ms) {
  ms = Math.max(0, ms);
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), s = Math.floor((ms % 60e3) / 1000);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const days = (d) => (d == null ? '—' : d >= 365 ? `≈ ${(d / 365).toFixed(1).replace('.', ',')} р.` : `≈ ${Math.round(d)} дн.`);

// What is still missing before «Престиж» opens (level, garage value), as a card.
function lockCard() {
  const m = X.me(), v = m.stats?.value || 0;
  const row = (ok, text, pct) => `<div class="pr-need${ok ? ' ok' : ''}"><span>${X.ic(ok ? 'check' : 'lock')}</span><b>${text}</b><span class="pr-bar"><i style="width:${Math.min(100, pct * 100)}%"></i></span></div>`;
  return `<div class="card pr-lock"><b>«Престиж» — для пізньої гри</b>
    <div class="small muted mt">Рестайлінг ★1–★5 і Трофейна зала відкриваються з ${P.PRESTIGE.level}-го рівня, коли гараж коштує від ${S.short(P.PRESTIGE.garage)}. До того гроші краще вкладати в кейси, місця й тюнінг.</div>
    ${row(m.level >= P.PRESTIGE.level, `Рівень ${m.level} / ${P.PRESTIGE.level}`, m.level / P.PRESTIGE.level)}
    ${row(v >= P.PRESTIGE.garage, `Гараж ${S.short(v)} / ${S.short(P.PRESTIGE.garage)}`, v / P.PRESTIGE.garage)}</div>`;
}
// «Slot first»: the better buy as a card with the sheet's one yellow button; null when there is none.
function offerCard() {
  const m = X.me(), o = P.firstOffer({ balance: m.balance, slots: m.slots, capLevel: m.capLevel });
  if (!o) return { html: '', on: false };
  const text = o.kind === 'slot'
    ? `<b>Спершу вигідніше: місце в гаражі</b><div class="small muted">Місце № ${m.slots + 1} коштує ${S.short(o.cost)} — це менше ${Math.round(P.PRESTIGE.slotShare * 100)}% твого балансу, а ще одна машина приноситиме дохід щогодини. Рестайлінг нікуди не дінеться.</div>`
    : `<b>Спершу вигідніше: каса на ${o.hours} год</b><div class="small muted">${S.short(o.cost)} — менше ${Math.round(P.PRESTIGE.capShare * 100)}% балансу: дохід не стоїть, поки тебе немає.</div>`;
  return { on: true, html: `<div class="card pr-offer">${text}<button class="btn mt" data-act="${o.kind === 'slot' ? 'prSlot' : 'prCap'}">${X.ic(o.kind === 'slot' ? 'building-warehouse' : 'clock')} ${o.kind === 'slot' ? 'Купити місце' : 'Збільшити касу'} · ${S.short(o.cost)}</button></div>` };
}

// ---------- the restyle sheet of one car ----------
const PERKS = ['', '', 'іменна табличка в майстерні', '', 'золота рамка в гаражі й рядок «Легенда» в профілі'];
function restyleSheet(id) {
  const m = X.me(), c = m.cars.find((x) => x.id === Number(id));
  if (!c) return X.closeModal();
  const mod = S.MODELS[c.model], back = () => X.carSheet(c.id);
  cur = { car: c.id };
  if (!pr().open) return X.sheet('Рестайлінг', lockCard(), back);
  const n = c.stars || 0, t = X.serverNow();
  const e = X.carInc(c), clean = e?.clean ?? S.carIncomeOf({ model: c.model, parts: c.parts, plateValue: c.plate?.value || 0 });
  const steps = P.PRESTIGE.mult.map((k, i) => {
    const st = i < n ? 'done' : i === n ? 'next' : '';
    return `<div class="pr-step ${st}"><span class="pr-s">${P.STAR}${i + 1}</span><span class="grow"><b>${S.short(P.restyleCost(c.model, i))}</b><small>${String(k).replace('.', ',')}× ціни · +${Math.round(S.STAR_INCOME * 100 * (i + 1))}% доходу${PERKS[i] ? ` · ${PERKS[i]}` : ''}</small></span><span class="pr-st">${st === 'done' ? X.ic('check') : st === 'next' ? 'далі' : ''}</span></div>`;
  }).join('');
  let action = '', note = '';
  const offer = offerCard();
  if (n >= P.PRESTIGE.max) note = `<div class="card pr-done center"><b>${P.STAR}5 — машина-легенда</b><div class="small muted">Усі п’ять зірок: +${Math.round(S.STAR_INCOME * 500)}% доходу, золота рамка, рядок у профілі.</div></div>`;
  else {
    const cost = P.restyleCost(c.model, n), g = P.starGain(c.model, n, clean);
    const ready = P.starReady(c.starAt || 0, t), listed = c.status === 'market' || c.status === 'auction';
    const short = m.balance < cost;
    note = `<div class="card pr-next"><div class="row between"><b>Наступна: ${P.STAR}${n + 1}</b><b class="disp">${S.short(cost)}</b></div>
      <div class="pr-gain"><span>Дохід машини</span><b>${S.short(clean * (1 + P.starBonus(n)))} → ${S.short(clean * (1 + P.starBonus(n + 1)))}<small>/год</small></b></div>
      <div class="pr-gain"><span>Окупиться бонусом</span><b>${days(g.days)}</b></div>
      <div class="tiny muted mt">Чесно: це покупка статусу, а не спосіб заробити. ★ лишаються з машиною назавжди, доки вона твоя.</div></div>`;
    const label = `${X.ic('sparkles')} Рестайлінг ${P.STAR}${n + 1} · ${S.short(cost)}`;
    if (listed) action = '<div class="small muted center mt">Машина на ринку чи аукціоні — зніми лот, щоб робити рестайлінг.</div>';
    else if (!ready) action = `<div class="pr-timer">${X.ic('clock')} Майстерня працює над ${P.STAR}${n}: наступна через <b>${untilHtml(P.nextStarAt(c.starAt))}</b></div><button class="btn ghost mt" disabled>${label}</button>`;
    else action = `<button class="btn ${offer.on ? 'ghost ' : ''}mt" data-act="prDo" data-id="${c.id}" ${short ? 'disabled' : ''}>${label}</button>${short ? `<div class="tiny muted center mt">Не вистачає ${S.short(cost - m.balance)}</div>` : ''}`;
  }
  X.sheet('Рестайлінг', `<div class="pr-hero r${S.rankOf(mod.cls)}${n >= P.PRESTIGE.max ? ' pr-gold' : ''}" style="--c:${S.CLASSES[mod.cls].color}"><div class="art">${carArt(c.model, { look: c.look })}</div>
      <div class="pr-hero-tx"><b class="clamp2">${X.esc(mod.name)}</b>${starsHtml(c, { full: true, cls: 'pr-lg' })}${n >= 3 ? `<span class="pr-plate">${X.esc(mod.name)} · ${P.STAR}${n}</span>` : ''}</div></div>
    ${offer.html}${note}${action}
    <div class="pr-ladder">${steps}</div>
    <div class="tiny muted mt pr-rules">Одна ${P.STAR} на машину за 24 год. Платиш лише гривнями. ★ переходять разом із машиною в обміні, на ринку й аукціоні; дилер викуповує за звичайним відсотком класу — ★ ціни продажу не додають. Машину з ★ не можна поставити в апгрейд чи трейд-ін.</div>`, back);
}
async function doRestyle(d, el) {
  const c = X.me().cars.find((x) => x.id === Number(d.id));
  if (!c) return;
  el.disabled = true;
  const r = await X.act('prestige/restyle', { carId: c.id }, (r) => `${S.MODELS[c.model].name}: ${P.STAR}${r.stars} · +${Math.round(r.bonus * 100)}% доходу`, { rerender: true });
  restyleSheet(c.id);
  if (r) document.querySelector('.pr-hero .pr-stars')?.classList.add('pop');
}

// ---------- «Трофейна зала» ----------
async function hallSheet() {
  cur = { hall: true };
  if (!pr().open) return X.sheet('Престиж', lockCard());
  let st;
  try {
    st = await X.api('prestige');
  } catch (e) {
    return X.toast(e.message, true);
  }
  const m = X.me(), offer = offerCard();
  const tiles = P.TROPHIES.map((t) => {
    const own = t.k < st.n, next = t.k === st.n;
    return `<div class="pr-tr${own ? ' own' : next ? ' next' : ''}"><span class="pr-tr-ic">${X.ic(own || next ? t.icon : 'lock')}</span><b>${X.esc(t.name)}</b><small>${own ? 'твій' : S.short(t.cost)}</small></div>`;
  }).join('');
  const nextT = st.next && P.TROPHIES[st.next.k];
  const buy = nextT ? `<button class="btn ${offer.on ? 'ghost ' : ''}mt" data-act="prTrophy" ${m.balance < nextT.cost ? 'disabled' : ''}>${X.ic(nextT.icon)} ${X.esc(nextT.name)} · ${S.short(nextT.cost)}</button>${m.balance < nextT.cost ? `<div class="tiny muted center mt">Не вистачає ${S.short(nextT.cost - m.balance)}</div>` : ''}` : '<div class="small muted center mt">Зала повна — усі 10 трофеїв твої.</div>';
  const cars = st.restyled.slice(0, 8).map((r) => {
    const c = m.cars.find((x) => x.id === r.carId) || { id: r.carId, model: r.model, stars: r.stars };
    const wait = r.nextAt && r.nextAt > X.serverNow();
    return `<button class="li" data-act="prRestyle" data-id="${r.carId}"><span class="mini art">${carArt(r.model, { thumb: true })}</span><div class="grow"><b class="clamp2">${X.esc(S.MODELS[r.model].name)}</b><div class="small muted">${starsHtml(c, { full: true })} · вкладено <span class="nw">${S.short(r.spent)}</span></div></div><span class="small ${wait ? 'muted' : 'pr-ready'} nw">${r.stars >= P.PRESTIGE.max ? 'легенда' : wait ? untilHtml(r.nextAt) : 'можна ★'}</span></button>`;
  }).join('');
  const titleNext = P.TROPHY_TITLES.find((x) => x.n > st.n);
  X.sheet('Престиж', `<div class="card pr-sum"><div class="row between"><span class="small muted">Статок</span>${st.title ? `<span class="chip pr-title">${X.ic('trophy')} ${X.esc(st.title)}</span>` : ''}</div>
      <b class="pr-wealth">${S.short(st.wealth)}</b>
      <div class="tiny muted">гараж ${S.short(st.value)} · рестайлінг ${S.short(st.spent.restyle)} · трофеї ${S.short(st.spent.trophies)}</div>
      <button class="pr-lb" data-act="prBoard">${X.ic('trophy')} Рейтинг «Статок» ${X.ic('chevron-right')}</button></div>
    ${offer.html}
    <div class="h2"><span>Трофейна зала</span><span>${st.n}/${P.TROPHIES.length}</span></div>
    <div class="pr-hall">${tiles}</div>${buy}
    <div class="tiny muted mt">Трофеї не приносять грошей і нічого не коштують далі — без утримання. Вони рахуються в «Статку», і їх видно в картці гравця.${titleNext ? ` Титул «${titleNext.title}» — на ${titleNext.n} трофеях.` : ''}</div>
    <div class="h2"><span>Рестайлінг</span><span>+${Math.round(S.STAR_INCOME * 100)}% за ${P.STAR}</span></div>
    ${cars ? `<div class="list">${cars}</div>` : `<div class="card small muted">Ще жодної ${P.STAR}. Відкрий машину класу A, S чи секретну в гаражі → «Рестайлінг».</div>`}
    <button class="btn outline mt" data-act="prPick">${X.ic('car')} Обрати машину для рестайлінгу</button>`);
}
function pickForRestyle() {
  const m = X.me();
  const list = m.cars.filter((c) => (c.status === 'garage' || c.status === 'showcase') && P.canRestyle(c.model))
    .sort((a, b) => (b.stars || 0) - (a.stars || 0) || S.MODELS[b.model].price - S.MODELS[a.model].price);
  X.sheet('Яку машину?', list.length ? `<div class="list">${list.map((c) => `<button class="li" data-act="prRestyle" data-id="${c.id}"><span class="mini art">${carArt(c.model, { look: c.look, thumb: true })}</span><div class="grow"><b class="clamp2">${X.esc(S.MODELS[c.model].name)}</b><div class="small muted">${c.stars ? starsHtml(c, { full: true }) : 'без ★'} · ${P.STAR}${(c.stars || 0) + 1 > P.PRESTIGE.max ? '5' : (c.stars || 0) + 1} ${c.stars >= P.PRESTIGE.max ? 'готово' : S.short(P.restyleCost(c.model, c.stars || 0))}</div></div><span class="chev">›</span></button>`).join('')}</div>`
    : '<div class="card small muted">Рестайлінг — для машин класу A, S і секретних. У гаражі таких поки немає.</div>', () => hallSheet());
}

// ---------- entry points in app.js ----------
// Car sheet: the «Рестайлінг» row (A/S/secret cars only).
export function carRestyleLi(c) {
  if (!X || !P.canRestyle(c.model)) return '';
  const open = pr().open, n = c.stars || 0;
  const sub = !open ? `з ${P.PRESTIGE.level}-го рівня й гаража від ${S.short(P.PRESTIGE.garage)}` : n >= P.PRESTIGE.max ? 'легенда: +15% доходу' : !P.starReady(c.starAt || 0, X.serverNow()) ? `наступна ${P.STAR} через ${left(P.nextStarAt(c.starAt) - X.serverNow()).replace(/:\d\d$/, '')}` : `${P.STAR}${n + 1} за ${S.short(P.restyleCost(c.model, n))} · +3% доходу`;
  return `<button class="li" data-act="prRestyle" data-id="${c.id}"><span class="ic">${X.ic(open ? 'sparkles' : 'lock')}</span><div class="grow"><b>Рестайлінг</b><div class="small muted">${sub}</div></div>${n ? starsHtml(c, { full: true }) : '<span class="chev">›</span>'}</button>`;
}
// Menu: one wide row under the challenges.
export function prestigeHubRow() {
  if (!X) return '';
  const p = pr(), m = X.me();
  const info = p.open ? `${p.title ? `«${X.esc(p.title)}» · ` : ''}трофеї ${p.trophies}/${P.TROPHIES.length} · ${P.STAR} ${m.cars.reduce((s, c) => s + (c.stars || 0), 0)}` : `рів. ${P.PRESTIGE.level} і гараж від ${S.short(P.PRESTIGE.garage)}`;
  return `<button class="hub-store pr-hub${p.open ? '' : ' locked'}" data-act="prHall"><span class="hub-ic">${X.ic(p.open ? 'trophy' : 'lock')}</span><span class="grow"><b>Престиж</b><span class="hub-i">${info}</span></span><span class="chev">${X.ic('chevron-right')}</span></button>`;
}

export function installPrestige(ctx) {
  X = ctx;
  const H = ctx.H;
  H.prRestyle = (d) => restyleSheet(d.id);
  H.prDo = doRestyle;
  H.prHall = () => hallSheet();
  H.prPick = () => pickForRestyle();
  H.prTrophy = async (d, el) => {
    el.disabled = true;
    const r = await X.act('prestige/trophy', {}, (r) => `${r.trophy.name} — у Трофейній залі${r.title ? ` · титул «${r.title}»` : ''}`, { rerender: true });
    hallSheet();
    return r;
  };
  // The offer was bought from the restyle sheet or the hall: reopen the same one with the new numbers.
  const reopen = () => (cur?.car ? restyleSheet(cur.car) : hallSheet());
  H.prSlot = async () => (await X.act('buy-slot', {}, 'Місце в гаражі додано'), reopen());
  H.prCap = async () => (await X.act('upgrade-cap', {}, 'Касу збільшено'), reopen());
  H.prBoard = () => {
    X.closeModal();
    X.state().lbType = 'wealth';
    X.go('leaderboard');
  };
}
