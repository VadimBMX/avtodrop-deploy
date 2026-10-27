// «Престиж» — the late-game money sink chosen by the owner on 26.10 (package П1*, scratchpad/wEcon/reports/econ.md):
//   · «Рестайлінг»: an A, S or secret car goes ★1 → ★5 in the workshop for 0,2 / 0,4 / 0,8 / 1,6 / 3,2 × the model's
//     price (6,2× in all). Each ★ adds S.STAR_INCOME (+3%) to that car's own income (S.garageIncome) — at ★5 +15%,
//     so the bonus never pays the restyle back quickly (★1 on a median S ≈ 110 days, all five ≈ 690 days).
//     One ★ per car per 24 h (the workshop's timer). The ★ belong to the car: they go with it in a trade, on the
//     market or an auction; a sale to the dealer pays the usual class share (S.SELL_RATES unchanged) and the ★ go
//     with the car. Paid in hryvnias only — never with Telegram Stars, VIP or keys.
//   · «Трофейна зала»: ten items of status, 25 млн × 2,5^k each, bought in order. No upkeep and no income: they count
//     in the «Статок» rating, show in the player card and give a title badge at 3 / 6 / 9 trophies.
// Opens at level 10 with a garage worth ≥ 500 млн (collection value); once open it stays open. When a garage slot or
// the cash upgrade is a better buy (cheap next to the balance), the app offers that first.
// Shared by the server (src/prestige.js) and the app (public/prestige-ui.js).
import * as S from './shared.js';

export const PRESTIGE = {
  level: 10, garage: 500e6,
  mult: [0.2, 0.4, 0.8, 1.6, 3.2], // ★1 … ★5, × the model's price
  max: 5, cooldownH: 24,
  // «Slot first» (econ.md §7): a slot cheaper than 15% of the balance, or the cash upgrade under 10%, is offered first.
  slotShare: 0.15, capShare: 0.1,
};
export const STAR = '★';

// Which cars can be restyled: the A and S classes and the secret cars (class X).
export const canRestyle = (model) => {
  const m = S.MODELS[model];
  return !!m && (m.cls === 'A' || m.cls === 'S' || !!m.secret);
};
// The price of the next ★ (stars = the ★ the car has now); null at ★5.
export function restyleCost(model, stars = 0) {
  const m = S.MODELS[model];
  if (!m || stars >= PRESTIGE.max || stars < 0) return null;
  return Math.round((m.price * PRESTIGE.mult[stars]) / 1000) * 1000;
}
// All five ★ of a model (what a full restyle costs) and what was put into the first `stars` of them.
export const restyleTotal = (model) => PRESTIGE.mult.reduce((s, _, i) => s + restyleCost(model, i), 0);
export const restyleSpent = (model, stars) => Array.from({ length: Math.max(0, Math.min(stars, PRESTIGE.max)) }, (_, i) => restyleCost(model, i)).reduce((a, b) => a + b, 0);
export const starBonus = (stars) => (stars || 0) * S.STAR_INCOME;
// When the next ★ can be done: `at` = when the last one was (0 = never).
export const nextStarAt = (at) => (at ? at + PRESTIGE.cooldownH * 3600e3 : 0);
export const starReady = (at, t) => !at || t >= nextStarAt(at);
// What one ★ adds an hour on this car (its clean income × +3%) and how many days it takes to pay for itself.
export function starGain(model, stars, cleanIncome) {
  const cost = restyleCost(model, stars);
  const perH = (cleanIncome || 0) * S.STAR_INCOME;
  return { cost, perH, days: cost && perH > 0 ? cost / perH / 24 : null };
}

// Open: level and garage value now, or `ever` (it opened once and stays open).
export const prestigeOpen = ({ level = 0, value = 0, ever = false } = {}) => ever || (level >= PRESTIGE.level && value >= PRESTIGE.garage);

// The better buy to offer before a ★, or null: a garage slot (another car earns) or the cash upgrade.
export function firstOffer({ balance, slots, capLevel }) {
  if (slots < S.MAX_SLOTS && S.slotCost(slots) < balance * PRESTIGE.slotShare) return { kind: 'slot', cost: S.slotCost(slots) };
  const cap = S.CAP_LEVELS[capLevel + 1];
  if (cap && cap.cost < balance * PRESTIGE.capShare) return { kind: 'cap', cost: cap.cost, hours: cap.hours };
  return null;
}

// ---------- «Трофейна зала» ----------
const sig3 = (n) => {
  const p = Math.pow(10, Math.floor(Math.log10(n)) - 2);
  return Math.round(n / p) * p;
};
export const TROPHIES = [
  ['watch', 'Годинник «Хронограф»', 'clock'],
  ['cup', 'Кубок першого заїзду', 'trophy'],
  ['key', 'Золотий ключ', 'key'],
  ['penthouse', 'Пентхаус з видом на трасу', 'building-skyscraper'],
  ['hangar', 'Приватний ангар', 'building-warehouse'],
  ['yacht', 'Яхта «Нітро»', 'wind'],
  ['track', 'Власний автодром', 'flag-3'],
  ['jet', 'Реактивний літак', 'rocket'],
  ['island', 'Острів', 'world'],
  ['crown', 'Корона АВТОДРОПу', 'crown'],
].map(([id, name, icon], k) => ({ k, id, name, icon, cost: sig3(25e6 * Math.pow(2.5, k)) }));
export const trophyCost = (k) => TROPHIES[k]?.cost ?? null;
export const trophiesWorth = (n) => TROPHIES.slice(0, n).reduce((s, t) => s + t.cost, 0);
// Titles (a badge in the player card): at 3, 6 and 9 trophies.
export const TROPHY_TITLES = [
  { n: 3, title: 'Колекціонер', tier: 1 },
  { n: 6, title: 'Магнат', tier: 2 },
  { n: 9, title: 'Легенда АВТОДРОПу', tier: 3 },
];
export const trophyTitle = (n) => [...TROPHY_TITLES].reverse().find((t) => n >= t.n) || null;
