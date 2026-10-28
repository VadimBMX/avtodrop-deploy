// «Битва амбасадорів» (owner 28.10): a referral contest. The owner starts it in the admin panel («Реферали» →
// «Конкурс»); it runs S.CONTEST.days. A friend counts for his inviter when he signed up by the inviter's link
// (users.referrer_id, set at sign-up only) between start and end, and has reached S.CONTEST.minLevel. Banned players
// and players hidden from the ratings (lb_hidden) are out, on either side. «Повернувся» (came back on another Kyiv
// day than the sign-up day) is shown to the admins as a check against fake accounts; it does not change the count.
// Prizes are paid by the owner by hand after the end. State: meta 'contest' = { start, end, by }.
import * as S from '../public/shared.js';

export function createContest({ db, q, now, fail, metaGet, metaSet, name, brief }) {
  const C = S.CONTEST;
  const cfg = () => {
    try {
      const c = JSON.parse(metaGet('contest') || 'null');
      return c && c.start && c.end ? c : null;
    } catch {
      return null;
    }
  };
  // Every inviter with his friends of this contest, best first (counted, then came back, then invited).
  function standings(c = cfg()) {
    if (!c) return [];
    const rows = q(`SELECT f.id, f.referrer_id rid, f.level, f.created_at, f.last_seen, f.banned, f.lb_hidden FROM users f
      JOIN users r ON r.id = f.referrer_id
      WHERE f.referrer_id IS NOT NULL AND f.created_at >= ? AND f.created_at < ? AND r.banned = 0 AND r.lb_hidden = 0`).all(c.start, c.end);
    const by = new Map();
    for (const f of rows) {
      let e = by.get(f.rid);
      if (!e) by.set(f.rid, (e = { id: f.rid, invited: 0, counted: 0, returned: 0, old: 0, friends: [] }));
      const ok = f.level >= C.minLevel && !f.banned && !f.lb_hidden;
      const back = S.kyivDateOf(f.last_seen) !== S.kyivDateOf(f.created_at);
      e.invited++;
      if (ok) e.counted++;
      if (ok && back) e.returned++;
      if (ok && now() - f.created_at > 86400e3) e.old++; // could have come back already: the base of the fake-account check
      e.friends.push({ id: f.id, level: f.level, createdAt: f.created_at, lastSeen: f.last_seen, counted: ok, returned: back, banned: !!f.banned });
    }
    return [...by.values()].sort((a, b) => b.counted - a.counted || b.returned - a.returned || b.invited - a.invited || a.id - b.id)
      .map((e, i) => ({ ...e, place: e.counted ? i + 1 : null }));
  }
  const prizeOf = (place) => (!place ? null : place <= C.prizes.length ? { stars: C.prizes[place - 1] } : place <= C.extraUpTo ? { extra: C.extra } : null);
  // For `me`: only whether to show the menu card (cheap: no standings).
  function brief4me() {
    const c = cfg(), t = now();
    if (!c || t > c.end + C.showAfterH * 3600e3) return null;
    return { start: c.start, end: c.end, on: t < c.end };
  }
  // The player's screen: timer, prizes, his place and count, the top 10.
  function status(uid) {
    const c = cfg();
    if (!c) return { contest: null };
    const all = standings(c), t = now();
    const mine = all.find((e) => e.id === uid);
    return {
      contest: {
        start: c.start, end: c.end, on: t >= c.start && t < c.end, minLevel: C.minLevel, prizes: C.prizes, extraUpTo: C.extraUpTo, extra: C.extra,
        top: all.filter((e) => e.counted).slice(0, 10).map((e) => ({ place: e.place, name: name(e.id), counted: e.counted, me: e.id === uid })),
        me: { place: mine?.place || null, counted: mine?.counted || 0, invited: mine?.invited || 0, prize: prizeOf(mine?.place) },
        players: all.filter((e) => e.counted).length,
      },
    };
  }
  function adminGet() {
    const c = cfg(), all = standings(c);
    return {
      contest: c, rules: C, now: now(),
      totals: { inviters: all.length, invited: all.reduce((s, e) => s + e.invited, 0), counted: all.reduce((s, e) => s + e.counted, 0) },
      rows: all.slice(0, 200).map((e) => ({ ...brief(e.id), invited: e.invited, counted: e.counted, returned: e.returned, old: e.old, suspect: e.old >= 3 && e.returned / e.old < 0.3, place: e.place, prize: prizeOf(e.place),
        friends: e.friends.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((f) => ({ ...f, name: name(f.id) })) })),
    };
  }
  function adminStart(who, { days } = {}) {
    const c = cfg(), t = now();
    if (c && t < c.end) fail('Конкурс уже йде — спершу зупини його');
    const d = Math.round(Number(days) || C.days);
    if (!(d >= 1 && d <= 60)) fail('Тривалість — від 1 до 60 днів');
    metaSet('contest', JSON.stringify({ start: t, end: t + d * 86400e3, by: String(who) }));
    return adminGet();
  }
  function adminStop() {
    const c = cfg(), t = now();
    if (!c || t >= c.end) fail('Конкурс зараз не йде');
    metaSet('contest', JSON.stringify({ ...c, end: t }));
    return adminGet();
  }
  return { cfg, standings, status, brief4me, adminGet, adminStart, adminStop };
}
