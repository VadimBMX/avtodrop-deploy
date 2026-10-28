// «🐞 Нагорода за баг» (open beta): the presets the admin panel offers and the tester badge ladder.
// Shared by the server (src/bugbounty.js) and the panel (public/admin-bugs.js).
export const BUG_PRESETS = {
  small: { name: 'Дрібниця', money: 250000, keys: [] },
  useful: { name: 'Корисна знахідка', money: 1000000, keys: [{ caseId: 'city', count: 1 }] },
  serious: { name: 'Серйозний баг', money: 5000000, keys: [{ caseId: 'sport', count: 2 }] },
};
export const BUG_CUSTOM = 'custom';
export const BUG_CUSTOM_MAX = 100000000; // a typo guard: custom amounts up to 100 млн ₴
export const BUG_KEYS_MAX = 10;
// Rewarded finds → the profile badge (badges.key = 'tester'); the higher one replaces the lower.
export const BUG_BADGES = [
  { n: 5, title: 'Головний тестувальник', tier: 3 },
  { n: 1, title: 'Тестувальник', tier: 1 },
];
export const bugBadgeFor = (n) => BUG_BADGES.find((b) => n >= b.n) || null;
