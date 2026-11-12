// «Мої бізнеси» (Сезон 02): the rules and every number, shared by the server (src/business.js) and the app
// (public/business-ui.js). Imports only public/econ.js: public/shared.js imports BIZ_SHOP_ITEMS from here (the manager is a Stars item).
//
// A business is bought once for ₴ from its unlock level and earns `income` ₴/h into its own «Каса» (cash box). The box
// fills lazily from timestamps (no cron) and stops at its cap (capHours, VIP: vipCapHours, +«Персонал»), so the player
// comes back to tap «Зібрати». Three branches of five steps each («Обладнання» +income, «Персонал» +cap hours,
// «Реклама» +income) and three building levels (×income; level 2 needs every branch ≥ 2, level 3 every branch ≥ 4).
// A «Менеджер» (Stars, 30 days) takes the box to the balance by himself: while he works the box never caps.
// Owning a business also gives a passive perk in another system (PERKS below; wired in src/game.js, `// s2-biz`).
//
// ECONOMY: prices, levels, incomes and the box hours come from public/econ.js (ECON.biz); the rest of the shape is here.
import { ECON } from './econ.js';

export const BIZ = {
  // Price, unlock level and base income/h of each business come from public/econ.js (ECON.biz.list).
  list: [
    { id: 'wash', name: 'Автомийка «Блиск»', short: 'Автомийка', color: '#2ee6ff', icon: 'droplet' },
    { id: 'gas', name: 'Заправка «Турбо»', short: 'Заправка', color: '#ffd400', icon: 'gas-station' },
    { id: 'sto', name: 'СТО «Форсаж»', short: 'СТО', color: '#ff8a1f', icon: 'tool' },
    { id: 'tire', name: 'Шиномонтаж «Протектор»', short: 'Шиномонтаж', color: '#ffb020', icon: 'disc' }, // r13: the map's «Шиномонтаж»
    { id: 'salon', name: 'Автосалон', short: 'Автосалон', color: '#b57bff', icon: 'building-store' },
  ].map((b) => ({ ...b, ...ECON.biz.list.find((x) => x.id === b.id) })),
  capHours: ECON.biz.capHours, // the box holds this many hours of income…
  vipCapHours: ECON.biz.vipCapHours, // …and this many with VIP
  // Upgrade branches: `k` × business price × growth^step is the price of the next step (rounded to 1 000 ₴).
  branches: {
    eq: { name: 'Обладнання', steps: 5, k: 0.1, income: 0.08 }, // +8% income a step
    staff: { name: 'Персонал', steps: 5, k: 0.08, capHours: 1 }, // +1 h of box a step
    ads: { name: 'Реклама', steps: 5, k: 0.12, income: 0.06 }, // +6% income a step
  },
  growth: ECON.biz.growth,
  // Building levels 1…3: income multiplier, the branch steps every branch needs, the price (× business price).
  build: [
    { mult: 1, need: 0, cost: 0 },
    { mult: 1.25, need: 2, cost: 0.6 },
    { mult: 1.6, need: 4, cost: 1.5 },
  ],
  manager: { stars: 80, days: 30 },
  // The passive perks of owning a business (only while owned).
  perks: {
    washShine: 0.5, // +50% length of a wash's shine (S.WASH.shineHours)
    washBonus: 0.5, // +50% to the shine's income bonus (S.WASH.shine: +5% → +7.5%; S.washFactor washBonus)
    gasTank: 1, // +1 ⛽ tank capacity
    gasRegen: 0.25, // fuel comes back 25% faster
    stoParts: ECON.biz.stoParts, // −15% on part cases (the only ₴ the game charges for parts / tuning)
    salonSell: ECON.biz.salonSell, // +5% to a car's sale price to the dealer
    tireGrip: 0.05, // r13: fresh tyres — ×1.05 grip (drift) and traction (drag) of the owner's cars (S.carStats `tire`)
  },
  districtBonus: 0.15, // +15% income when the player's club holds a district — TODO: districts (src/business.js districtBonus)
};
export const BRANCH_KEYS = ['eq', 'staff', 'ads'];
export const BIZ_BY_ID = Object.fromEntries(BIZ.list.map((b) => [b.id, b]));
export const BIZ_MAX_LVL = BIZ.build.length;

// What each perk says on the cards.
export const PERK_TEXT = {
  wash: `мийка блищить на ${Math.round(BIZ.perks.washShine * 100)}% довше, бонус блиску до доходу +${Math.round(BIZ.perks.washBonus * 100)}%`,
  gas: `+${BIZ.perks.gasTank} ⛽ до бака, пальне на ${Math.round(BIZ.perks.gasRegen * 100)}% швидше`,
  sto: `−${Math.round(BIZ.perks.stoParts * 100)}% на кейси деталей`,
  salon: `+${Math.round(BIZ.perks.salonSell * 100)}% до ціни продажу машин`,
  tire: `свіжі шини: +${Math.round(BIZ.perks.tireGrip * 100)}% зчеплення в драгу й дрифті`,
};

// The «Менеджер» Stars items (one per business), merged into S.SHOP_BY_ID by public/shared.js.
export const mgrItemId = (bizId) => 'bizmgr-' + bizId;
export const BIZ_SHOP_ITEMS = BIZ.list.map((b) => ({ id: mgrItemId(b.id), name: `Менеджер · ${b.short}`, stars: BIZ.manager.stars, biz: b.id, mgrDays: BIZ.manager.days }));
export const bizOfItem = (itemId) => (typeof itemId === 'string' && itemId.startsWith('bizmgr-') && BIZ_BY_ID[itemId.slice(7)] ? itemId.slice(7) : null);

const r1k = (n) => Math.round(n / 1000) * 1000;
// The price of the next step of a branch (from `step`), null at the max.
export function stepCost(bizId, branch, step) {
  const b = BIZ_BY_ID[bizId], br = BIZ.branches[branch];
  if (!b || !br || step >= br.steps) return null;
  return r1k(b.price * br.k * BIZ.growth ** step);
}
// The price of the next building level (from `lvl`), null at the max.
export const buildCost = (bizId, lvl) => (BIZ_BY_ID[bizId] && lvl < BIZ_MAX_LVL ? r1k(BIZ_BY_ID[bizId].price * BIZ.build[lvl].cost) : null);
// Can the building go to lvl + 1 now (every branch at the step it needs)?
export const buildReady = (row) => row.level < BIZ_MAX_LVL && BRANCH_KEYS.every((k) => (row[k] || 0) >= BIZ.build[row.level].need);
// ₴/h of a business row { id, level, eq, ads } (district: the club's district bonus share, 0 for now).
export function rateOf(row, district = 0) {
  const b = BIZ_BY_ID[row.id];
  if (!b) return 0;
  const lvl = Math.min(BIZ_MAX_LVL, Math.max(1, row.level || 1));
  const up = (row.eq || 0) * BIZ.branches.eq.income + (row.ads || 0) * BIZ.branches.ads.income;
  return Math.round(b.income * BIZ.build[lvl - 1].mult * (1 + up) * (1 + district));
}
// Hours the box holds (VIP doubles the base, «Персонал» adds on top).
export const capHoursOf = (row, vip) => (vip ? BIZ.vipCapHours : BIZ.capHours) + (row.staff || 0) * BIZ.branches.staff.capHours;
// What is in the box at t: banked + rate × hours since cash_at, at most the cap (banked money is never lost).
// A working manager (managerUntil > t) lifts the cap.
export function boxAt({ banked = 0, cashAt, rate, capH, managerUntil = 0 }, t) {
  const earned = t > cashAt ? (rate * (t - cashAt)) / 3600e3 : 0;
  if (managerUntil > t) return Math.floor(banked + earned);
  return Math.floor(Math.max(banked, Math.min(banked + earned, rate * capH)));
}
