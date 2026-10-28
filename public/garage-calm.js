// qa4 (N2, calm garage): small pure rules for what «Гараж» shows under the income card — kept here so tests can check
// them. One main action per screen: «Цілі дня» and «Таємний покупець» are rows of one «Сьогодні» card (app.js
// #todayCard, filled by goals-ui.js / buyer-ui.js); the tank is a slim line only when it matters.

// The next tank shows once the player has this share of its price (and its level); an empty tank always shows.
export const TANK_NEAR = 0.5;
export function tankShown({ level, fuel, balance, next }) {
  if (level < 2) return false; // the first minutes: cases and the first race only
  if (fuel <= 0) return true;
  return !!next && level >= next.level && balance >= next.cost * TANK_NEAR;
}

// fix5 (crit4 №9): a newcomer back after hours away sees why the cash gave little — one line under the cash card,
// «Каса стояла повна N год — збільш її до 6 год за X» (the ordinary cap upgrade; the economy is unchanged).
// income: me.income { rate, capH, since, banked }; next: S.nextCapOffer(...). Returns the whole hours it stood full, or 0.
export const IDLE_CAP = { level: 5, minHours: 1 };
export function idleCapHours({ level, income, now, next }) {
  if (!next || !income || level >= IDLE_CAP.level || !(income.rate > 0)) return 0;
  const cap = income.rate * income.capH;
  const fullAt = income.since + Math.max(0, (cap - (income.banked || 0)) / income.rate) * 3600e3;
  const h = Math.floor((now - fullAt) / 3600e3);
  return h >= IDLE_CAP.minHours ? h : 0;
}
