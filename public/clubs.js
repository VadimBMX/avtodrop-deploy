// «Автоклуби» — the rules shared by the server (src/clubs.js) and the app (public/clubs-ui.js).
// A club: up to 20 players, a 4-letter tag [ЖИГА] next to their names in the ratings, battles and the day's board,
// a weekly league from the members' wins (prizes to the members of the top clubs at Monday 00:00 Kyiv) and a club
// treasury («клубна каса»): members put money in, the owner/officers spend it on weekly perks for everyone. Money in
// the treasury never comes back out (no withdrawals, nothing back on leaving or disbanding) — it is a money sink.
// Anti-hopping: a member's wins count for the league (and perks work for him) only 24 h after joining; leaving or
// being kicked wipes his points of the current week.

export const CLUB = {
  max: 20, // members, the owner included
  joinLevel: 3, // join: from the first evening (the social side opens at 3)
  createLevel: 5, // create: ~87 min of play (S.UNLOCKS: L5)
  createCost: 500000,
  officers: 3, // at most, besides the owner
  waitH: 24, // hours in the club before league points count and perks work
  dayCap: 25, // league points per member per Kyiv day
  // League points per win: drag (solo/ghost), drift, a country boss, «Заїзд дня» (beating the day's ghost, once a day).
  points: { drag: 1, drift: 1, boss: 3, dayrace: 2 },
  // Weekly prizes per member by club place (only clubs with ≥ prizeMembers members who made ≥ prizeMinPts this week
  // take places; only those members are paid).
  prizes: [300000, 200000, 150000, 50000, 50000, 50000, 50000, 50000, 50000, 50000],
  prizeMinPts: 5,
  prizeMembers: 3,
  donateMin: 10000,
  donateMax: 1e12,
  // Perks: bought for the current league week (until Monday 00:00 Kyiv). Price = per member × max(minBill, members).
  minBill: 5,
  perks: {
    income: {
      name: 'Клубний дохід', icon: 'coin',
      levels: [
        { pct: 2, cap: 100000, per: 300000 },
        { pct: 4, cap: 200000, per: 700000 },
        { pct: 6, cap: 300000, per: 1200000 },
      ],
    },
    chest: { name: 'Клубна скриня', icon: 'key', per: 300000, caseId: 'city' }, // one key per member per week
    fuel: { name: 'Клубна заправка', icon: 'gas-station', per: 250000, n: 3 }, // +3 fuel per member per day
  },
};
export const ROLES = { owner: 'Власник', officer: 'Офіцер', member: 'Учасник' };
export const PERK_KEYS = Object.keys(CLUB.perks);

// Tag: exactly 4 letters/digits, Ukrainian or Latin, stored in upper case.
export const TAG_RE = /^[A-ZА-ЩЬЮЯІЇЄҐ0-9]{4}$/u;
export const tagNorm = (s) => String(s ?? '').trim().replace(/^\[|\]$/g, '').toUpperCase();
export const tagOk = (s) => TAG_RE.test(tagNorm(s));
export const tagText = (t) => (t ? `[${t}]` : '');
// Name: 3–24 characters — letters, digits, spaces and . - ' «» (no links, no emoji floods).
export const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .\-'’«»"]{1,22}[\p{L}\p{N}.»"]$/u;
export const nameNorm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
export const ABOUT_MAX = 140;
export const aboutNorm = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, ABOUT_MAX);
// The club's Telegram group/channel: only t.me links (public @name, +invite or joinchat). Returns the normalized
// https link, '' for empty, null for anything else.
export function tgLinkNorm(s) {
  let v = String(s ?? '').trim();
  if (!v) return '';
  if (/^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(v)) v = 't.me/' + v.slice(1);
  v = v.replace(/^https?:\/\//i, '').replace(/^(www\.)?telegram\.me\//i, 't.me/').replace(/\/+$/, '');
  const m = /^t\.me\/(\+[A-Za-z0-9_-]{8,64}|joinchat\/[A-Za-z0-9_-]{8,64}|[A-Za-z][A-Za-z0-9_]{3,31})$/i.exec(v);
  return m ? `https://t.me/${m[1]}` : null;
}
// Invite: start parameter club_<code> (t.me/<bot>/<app>?startapp=club_… or the bot's /start club_…).
export const INVITE_RE = /^[a-z0-9]{8}$/;
export const CLUB_PARAM = /^club_([a-z0-9]{8})$/;
export function clubLink(bot, app, code) {
  if (!bot || !INVITE_RE.test(String(code))) return '';
  return app ? `https://t.me/${bot}/${app}?startapp=club_${code}` : `https://t.me/${bot}?start=club_${code}`;
}
export const perkPrice = (per, members) => per * Math.max(CLUB.minBill, members);
// What a perk costs now: income is bought by level (an upgrade pays the difference to the level already bought).
export function perkCost(perk, level, members, have = 0) {
  const p = CLUB.perks[perk];
  if (!p) return null;
  if (perk !== 'income') return have ? null : perkPrice(p.per, members);
  const L = p.levels[level - 1];
  if (!L || level <= have) return null;
  return perkPrice(L.per, members) - (have ? perkPrice(p.levels[have - 1].per, members) : 0);
}
export const prizeOf = (place) => CLUB.prizes[place - 1] || 0;
export const plural = (n, [one, few, many]) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
