// «Шоурум» — rules shared by the server (src/showroom.js) and the app (public/showroom-ui.js).
// A player puts up to SHOWROOM.cars of his own cars on show (from the garage or the «Вітрина»; they keep their status
// and keep earning — the showroom only points at them), exactly as they look: paint, livery, plate with its frame,
// ★ of «Престиж». Others browse showrooms and give likes:
//   · one like per showroom per day (Kyiv day) from one viewer, SHOWROOM.perDay likes per viewer per day in all;
//   · liking needs level SHOWROOM.level (the usual «most features from level 2»), no likes for one's own showroom;
//   · a like always shows in the ♥ counter, but it goes to «Шоурум тижня» (the weekly top) only when the viewer is not
//     a likely second account: his account is at least SHOWROOM.ageH hours old and he is not in the owner's referral
//     chain (the owner invited him, he invited the owner, or one player invited them both).
// Weekly (Mon–Sun, Kyiv): the SHOWROOM.prizes.length showrooms with the most counted likes (at least SHOWROOM.minLikes)
// get the money, the badge «Шоурум тижня» in the profile, and the first place the plate frame «Шоурум тижня».
export const SHOWROOM = {
  cars: 3,
  level: 2,
  perDay: 5,
  ageH: 48,
  minLikes: 3,
  prizes: [1000000, 500000, 250000],
  listN: 30,
  frame: 'cos:e:sr-week', // S.EVENT_COSMETICS: the winners' plate frame, never sold
};
export const SR_PARAM = /^sr_(\d{1,20})$/;
export const SR_TABS = { top: 'Топ тижня', new: 'Нові', friends: 'Друзі й клуб' };
export const BADGE = { 1: ['Шоурум тижня', 3], 2: ['Шоурум тижня · 2-е місце', 2], 3: ['Шоурум тижня · 3-є місце', 2] };

// A deep link that opens a player's showroom: the Mini App itself when its short name is known, otherwise the bot.
export function showroomLink(bot, app, uid) {
  if (!bot || !uid) return '';
  return app ? `https://t.me/${bot}/${app}?startapp=sr_${uid}` : `https://t.me/${bot}?start=sr_${uid}`;
}

// Two players in one referral chain: one invited the other, or the same player invited both.
export function sameChain(a, b) {
  if (!a || !b) return false;
  if (a.referrer_id && a.referrer_id === b.id) return true;
  if (b.referrer_id && b.referrer_id === a.id) return true;
  return !!(a.referrer_id && a.referrer_id === b.referrer_id);
}

// May `viewer` like `owner`'s showroom now? viewer/owner: user rows ({ id, level, created_at, referrer_id });
// cars: how many cars the showroom shows; likedToday: the viewer already liked it today; usedToday: his likes today.
// → { error } or { counted, why } (why: '' | 'age' | 'ref' — the like shows, but the weekly top skips it).
export function likeCheck({ viewer, owner, cars, likedToday, usedToday, now }) {
  if (!owner) return { error: 'Гравця не знайдено' };
  if (viewer.id === owner.id) return { error: 'Свій шоурум лайкнути не можна' };
  if ((viewer.level || 1) < SHOWROOM.level) return { error: `Лайки — з ${SHOWROOM.level}-го рівня` };
  if (!cars) return { error: 'Шоурум порожній' };
  if (likedToday) return { error: 'Сьогодні ти вже лайкнув цей шоурум — завтра знову' };
  if (usedToday >= SHOWROOM.perDay) return { error: `Усі ${SHOWROOM.perDay} лайків на сьогодні роздано — нові опівночі` };
  if (sameChain(viewer, owner)) return { counted: false, why: 'ref' };
  if (now - (viewer.created_at || 0) < SHOWROOM.ageH * 3600e3) return { counted: false, why: 'age' };
  return { counted: true, why: '' };
}
export const WHY_TEXT = {
  ref: 'Лайк є, але в «Шоурум тижня» не йде: ви з одного ланцюжка запрошень',
  age: `Лайк є, але в «Шоурум тижня» йде лише від акаунтів, старших за ${SHOWROOM.ageH / 24} доби`,
};

// Weekly top: rows [{ id, n, last }] → the prize places, ties to whoever reached the count first (earlier last like).
export function weeklyPlaces(rows) {
  return rows.filter((r) => r.n >= SHOWROOM.minLikes).sort((a, b) => b.n - a.n || a.last - b.last || a.id - b.id)
    .slice(0, SHOWROOM.prizes.length).map((r, i) => ({ ...r, place: i + 1, prize: SHOWROOM.prizes[i] }));
}

export const likesText = (n) => `${n} ${plural(n, ['лайк', 'лайки', 'лайків'])}`;
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  return b >= 2 && b <= 4 ? few : many;
}
// The text under a shared showroom card.
export function showroomCaption({ who = '', names = [], likes = 0 }) {
  const cars = names.filter(Boolean).slice(0, SHOWROOM.cars).join(', ');
  return `🏁 Шоурум${who ? ` ${who}` : ''} в АВТОДРОПі${cars ? `: ${cars}` : ''}.${likes ? ` Уже ${likesText(likes)}.` : ''} Зайди й постав ♥`;
}
