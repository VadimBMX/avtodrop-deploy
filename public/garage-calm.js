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
