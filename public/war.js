// «Війна районів» — the rules shared by the server (src/war.js) and the app (public/s2-ui.js warMap). Pure, so
// test/war.test.js checks it in node.
// A round = the club league week (Monday 00:00 → Monday 00:00 Kyiv). Each week the owner or an officer of a club with
// ≥ attackMinMembers members declares ONE attack on a district it doesn't hold (final once declared). War points = the
// club's league points of the week (public/clubs.js CLUB.points: the members' wins, the same daily cap and 24 h rule).
// Attack score in the target = the club's points; a holder defends EACH of its districts with its points ÷ the number
// of districts it holds (floor). At Monday 00:00 the highest score takes the district; a tie keeps it with the holder
// (between attackers: the earlier declaration); a free district goes to the top attacker if he scored > 0.
// Holding: +bizBonus income of the businesses to every member (one bonus, however many districts — public/business.js
// BIZ.districtBonus) and treasuryPerDistrict ₴ into the club treasury per district at every settlement.
import { BIZ } from './business.js';

export const WAR = {
  attackMinMembers: 3,
  treasuryPerDistrict: 5_000_000,
  bizBonus: BIZ.districtBonus, // 0.15
};
export const WAR_LIVE = true;

// District corners g: the block's top surface on public/s2/world.webp (1584×672) — left, back, right, front.
// id: the stable key in the database (war_holdings.district).
export const DISTRICTS = [
  { id: 'obolon', n: 'Оболонь', loc: 'Оболонь', g: [[17, 230], [314, 65], [462, 155], [165, 320]] },
  { id: 'podil', n: 'Поділ', loc: 'Поділ', g: [[287, 362], [516, 225], [669, 325], [440, 462]] },
  { id: 'lukianivka', n: 'Лук’янівка', loc: 'Лук’янівку', g: [[17, 500], [219, 365], [442, 495], [240, 630]] },
  { id: 'pechersk', n: 'Печерськ', loc: 'Печерськ', g: [[732, 367], [922, 250], [1110, 345], [920, 462]] },
  { id: 'troieshchyna', n: 'Троєщина', loc: 'Троєщину', g: [[980, 150], [1182, 20], [1337, 147], [1135, 277]] },
  { id: 'darnytsia', n: 'Дарниця', loc: 'Дарницю', g: [[1172, 320], [1369, 180], [1569, 290], [1372, 430]] },
  { id: 'pozniaky', n: 'Позняки', loc: 'Позняки', g: [[955, 525], [1147, 415], [1367, 535], [1175, 645]] },
];
export const DISTRICT_BY_ID = Object.fromEntries(DISTRICTS.map((d) => [d.id, d]));
export const NEUTRAL = '#8a8b90';

// A club's colour on the map: clubs pick none, so it is derived from the club id (stable for the club's life). None is
// the game's yellow (#ffd400 — the player's own UI) or the neutral grey.
// Ordered so that clubs with neighbouring ids (created one after another) get far-apart colours.
export const CLUB_COLOURS = ['#3d8bff', '#ff3d5a', '#39e58c', '#b06cff', '#ff8a3d', '#22e3ff', '#ff5fc8', '#9be13a', '#5b7cff', '#ff6a6a', '#2fd1b2', '#d08bff'];
export const clubColour = (id) => CLUB_COLOURS[(Math.max(1, Math.floor(Number(id) || 1)) - 1) % CLUB_COLOURS.length];

// Who takes a district at the settlement. holder: { id, score } | null; attackers: [{ id, score, at }].
// Returns { winner: club id | null, kind: 'kept' | 'captured' | 'held' (no attack) | 'free' }.
export function resolveDistrict(holder, attackers) {
  const best = [...attackers].sort((a, b) => b.score - a.score || a.at - b.at || a.id - b.id)[0] || null;
  if (holder) {
    if (best && best.score > holder.score) return { winner: best.id, kind: 'captured' };
    return { winner: holder.id, kind: attackers.length ? 'kept' : 'held' };
  }
  if (best && best.score > 0) return { winner: best.id, kind: 'captured' };
  return { winner: null, kind: 'free' };
}
// Defence of each district: the holder's points ÷ the districts it holds (floor).
export const defenceOf = (pts, held) => (held > 0 ? Math.floor(Math.max(0, pts) / held) : 0);

// The map as the app draws it, from the `war` API state (null while it loads: every district neutral).
// → { districts: [{ id, n, g, c, c2, fight, free, club: { id, name, tag, c } | null }], legend: [[club, count]] }
export function warView(state) {
  const by = Object.fromEntries((state?.districts || []).map((d) => [d.id, d]));
  const districts = DISTRICTS.map((d) => {
    const s = by[d.id];
    const holder = s?.holder || null, att = s?.attackers || [];
    const fight = att.length > 0;
    const c = holder ? holder.c : fight ? att[0].c : NEUTRAL;
    const c2 = fight ? (holder ? att[0].c : att[1]?.c || att[0].c) : c;
    return { id: d.id, n: d.n, g: d.g, c, c2, fight, free: !holder && !fight, club: holder };
  });
  const count = new Map();
  for (const d of districts) if (d.club) count.set(d.club.id, [d.club, (count.get(d.club.id)?.[1] || 0) + 1]);
  const legend = [...count.values()].sort((a, b) => b[1] - a[1] || a[0].id - b[0].id);
  return { districts, legend };
}
