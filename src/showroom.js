// «Шоурум» on the server (rules: public/showroom.js). Three new tables:
//   showroom        — a player's chosen cars (JSON list of car ids, in order). Only pointers: the cars keep their status
//                     (garage → still earns, «Вітрина» → still stored), a car that was sold, traded or listed simply
//                     drops out of the view until it is back;
//   showroom_likes  — one row per viewer × showroom × Kyiv day (the primary key is the «one like a day» rule), with the
//                     week it belongs to and whether it counts for the weekly top (counted = 0 for likely alt accounts);
//   showroom_weeks  — the settled weeks (one row each, the guard against paying twice) with their winners.
// The weekly prizes run inside settleWeek (src/game.js wraps it), so they are paid once, by the first call of the week.
import * as S from '../public/shared.js';
import * as R from '../public/showroom.js';

const SR = R.SHOWROOM;
const TELL_PER_DAY = 5; // «X likes your showroom» lines in «Сповіщення» per owner per day (in-app only, no bot push)

export function createShowroom(ctx) {
  const { db, q, now, fail, int, name, addMoney, event, userRow, weekOf, dayOf, carExtras, carOut, styleOf, badgesOf, grantCosmetic, asPrize = (fn) => fn() } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS showroom (user_id INTEGER PRIMARY KEY, cars TEXT NOT NULL DEFAULT '[]', at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS showroom_likes (viewer_id INTEGER NOT NULL, owner_id INTEGER NOT NULL, day TEXT NOT NULL, week TEXT NOT NULL,
      counted INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL, PRIMARY KEY (viewer_id, owner_id, day)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS showroom_likes_owner ON showroom_likes (owner_id, week);
    CREATE INDEX IF NOT EXISTS showroom_likes_day ON showroom_likes (viewer_id, day);
    CREATE TABLE IF NOT EXISTS showroom_weeks (week TEXT PRIMARY KEY, settled_at INTEGER NOT NULL, result TEXT);`);
  const tell = (uid, text) => q('INSERT INTO events (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, text, now());
  const prevWeek = (cur) => {
    const d = new Date(cur + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  };
  const weekEnds = (cur) => {
    const d = new Date(cur + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    return d.getTime() - 2 * 3600e3; // Kyiv midnight (as the weekly race shows it)
  };

  // ---------- the cars ----------
  function ids(uid) {
    try {
      const a = JSON.parse(q('SELECT cars FROM showroom WHERE user_id = ?').get(uid)?.cars || '[]');
      return Array.isArray(a) ? a.map(Number).filter(Number.isInteger).slice(0, SR.cars) : [];
    } catch {
      return [];
    }
  }
  // The cars as they look now (only those still owned and at home: garage or «Вітрина»), in the chosen order.
  function cars(uid) {
    const list = ids(uid);
    if (!list.length) return [];
    const rows = q(`SELECT * FROM cars WHERE owner_id = ? AND status IN ('garage', 'showcase') AND id IN (${list.map(() => '?').join(',')})`).all(uid, ...list);
    const ex = carExtras(uid);
    return list.map((id) => rows.find((c) => c.id === id)).filter(Boolean).map((c) => carOut(c, ex));
  }
  // The light version for lists: id, model, look, class (no parts / tank maths).
  function thumbs(uid) {
    const list = ids(uid);
    if (!list.length) return [];
    const rows = q(`SELECT id, model, paint, livery FROM cars WHERE owner_id = ? AND status IN ('garage', 'showcase') AND id IN (${list.map(() => '?').join(',')})`).all(uid, ...list);
    return list.map((id) => rows.find((c) => c.id === id)).filter(Boolean).map((c) => {
      const paint = S.PAINT_BY_ID[c.paint] ? c.paint : null, livery = S.LIVERY_BY_ID[c.livery] ? c.livery : null;
      return { id: c.id, model: c.model, look: paint || livery ? { paint, livery, n: (c.id % 99) + 1 } : null };
    });
  }
  function set(uid, { cars: want }) {
    const u = userRow(uid);
    if (u.level < SR.level) fail(`Шоурум відкривається з ${SR.level}-го рівня`);
    const list = Array.isArray(want) ? want : [];
    if (list.length > SR.cars) fail(`У шоурумі до ${SR.cars} машин`);
    const out = [];
    for (const v of list) {
      const id = int(v, 1, Number.MAX_SAFE_INTEGER, 'ID авто');
      if (out.includes(id)) continue;
      const c = q('SELECT owner_id, status FROM cars WHERE id = ?').get(id);
      if (!c || c.owner_id !== uid) fail('Це не твоє авто');
      if (c.status !== 'garage' && c.status !== 'showcase') fail('Авто зараз на ринку або аукціоні');
      out.push(id);
    }
    q('INSERT INTO showroom (user_id, cars, at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET cars = excluded.cars, at = excluded.at').run(uid, JSON.stringify(out), now());
    return { showroom: view(uid, uid) };
  }

  // ---------- likes ----------
  const totalOf = (uid) => q('SELECT COUNT(*) n FROM showroom_likes WHERE owner_id = ?').get(uid).n;
  const weekOfOwner = (uid, week = weekOf(now())) => q('SELECT COUNT(*) n FROM showroom_likes WHERE owner_id = ? AND week = ? AND counted = 1').get(uid, week).n;
  const usedToday = (uid) => q('SELECT COUNT(*) n FROM showroom_likes WHERE viewer_id = ? AND day = ?').get(uid, dayOf(now())).n;
  const likedToday = (viewer, owner) => !!q('SELECT 1 FROM showroom_likes WHERE viewer_id = ? AND owner_id = ? AND day = ?').get(viewer, owner, dayOf(now()));
  function like(uid, { id }) {
    const oid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID гравця');
    const viewer = userRow(uid);
    const owner = q('SELECT id, level, created_at, referrer_id, banned FROM users WHERE id = ?').get(oid);
    if (owner?.banned) fail('Цей шоурум недоступний');
    const r = R.likeCheck({ viewer, owner, cars: thumbs(oid).length, likedToday: likedToday(uid, oid), usedToday: usedToday(uid), now: now() });
    if (r.error) fail(r.error);
    const t = now(), day = dayOf(t);
    q('INSERT INTO showroom_likes (viewer_id, owner_id, day, week, counted, at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, oid, day, weekOf(t), r.counted ? 1 : 0, t);
    if (q('SELECT COUNT(*) n FROM showroom_likes WHERE owner_id = ? AND day = ?').get(oid, day).n <= TELL_PER_DAY) tell(oid, `♥ ${name(uid)} лайкнув твій шоурум`);
    return { id: oid, liked: true, likes: totalOf(oid), week: weekOfOwner(oid), left: Math.max(0, SR.perDay - usedToday(uid)), counted: r.counted, note: r.why ? R.WHY_TEXT[r.why] : '' };
  }

  // ---------- views ----------
  const placeOf = (uid, week = weekOf(now())) => {
    const mine = weekOfOwner(uid, week);
    if (!mine) return null;
    return q(`SELECT COUNT(*) n FROM (SELECT owner_id, COUNT(*) c FROM showroom_likes WHERE week = ? AND counted = 1 GROUP BY owner_id HAVING c > ?)`).get(week, mine).n + 1;
  };
  function view(uid, oid) {
    const u = q('SELECT id, level, banned FROM users WHERE id = ?').get(oid);
    if (!u || (u.banned && uid !== oid)) fail('Гравця не знайдено');
    const viewer = userRow(uid);
    const list = cars(oid);
    const self = uid === oid;
    const can = self ? { error: '' } : R.likeCheck({ viewer, owner: { ...u, created_at: 0 }, cars: list.length, likedToday: likedToday(uid, oid), usedToday: usedToday(uid), now: now() });
    return {
      id: oid, name: name(oid), level: u.level, self, cars: list, style: styleOf(oid), badges: badgesOf(oid).filter((b) => b.key === 'showroom'),
      likes: totalOf(oid), week: weekOfOwner(oid), place: placeOf(oid), likedToday: likedToday(uid, oid),
      canLike: !self && !can.error, why: self ? '' : can.error || '', left: Math.max(0, SR.perDay - usedToday(uid)),
    };
  }
  function row(oid, extra = {}) {
    return { id: oid, name: name(oid), level: q('SELECT level FROM users WHERE id = ?').get(oid)?.level || 1, cars: thumbs(oid), style: styleOf(oid), ...extra };
  }
  // The «Шоурум» page: my own showroom, today's likes left, one list (tab), last week's winners.
  function page(uid, { tab } = {}) {
    const k = R.SR_TABS[tab] ? tab : 'top';
    const cur = weekOf(now());
    const visible = "JOIN users u ON u.id = s.user_id WHERE u.banned = 0 AND u.lb_hidden = 0 AND s.cars <> '[]'";
    let list = [];
    if (k === 'top') {
      list = q(`SELECT s.user_id id, (SELECT COUNT(*) FROM showroom_likes l WHERE l.owner_id = s.user_id AND l.week = ? AND l.counted = 1) w,
                (SELECT COUNT(*) FROM showroom_likes l WHERE l.owner_id = s.user_id) t FROM showroom s ${visible} ORDER BY w DESC, t DESC, s.at DESC LIMIT ?`).all(cur, SR.listN * 2);
    } else if (k === 'new') {
      list = q(`SELECT s.user_id id, (SELECT COUNT(*) FROM showroom_likes l WHERE l.owner_id = s.user_id AND l.week = ? AND l.counted = 1) w,
                (SELECT COUNT(*) FROM showroom_likes l WHERE l.owner_id = s.user_id) t FROM showroom s ${visible} ORDER BY s.at DESC LIMIT ?`).all(cur, SR.listN * 2);
    } else {
      const me = userRow(uid);
      const club = (() => {
        try {
          return q('SELECT club_id FROM club_members WHERE user_id = ?').get(uid)?.club_id ?? null;
        } catch {
          return null; // no clubs table (a bare test database)
        }
      })();
      const friends = new Set(q('SELECT id FROM users WHERE referrer_id = ?').all(uid).map((r) => r.id));
      if (me.referrer_id) friends.add(me.referrer_id);
      if (club != null) for (const r of q('SELECT user_id FROM club_members WHERE club_id = ?').all(club)) friends.add(r.user_id);
      friends.delete(uid);
      const fl = [...friends].slice(0, 500);
      list = fl.length ? q(`SELECT s.user_id id, (SELECT COUNT(*) FROM showroom_likes l WHERE l.owner_id = s.user_id AND l.week = ? AND l.counted = 1) w,
                (SELECT COUNT(*) FROM showroom_likes l WHERE l.owner_id = s.user_id) t FROM showroom s ${visible} AND s.user_id IN (${fl.map(() => '?').join(',')}) ORDER BY w DESC, t DESC LIMIT ?`).all(cur, ...fl, SR.listN * 2) : [];
    }
    const day = dayOf(now());
    const liked = new Set(q('SELECT owner_id FROM showroom_likes WHERE viewer_id = ? AND day = ?').all(uid, day).map((r) => r.owner_id));
    const rows = list.map((r) => row(r.id, { week: r.w, likes: r.t, liked: liked.has(r.id), me: r.id === uid })).filter((r) => r.cars.length).slice(0, SR.listN);
    const last = q('SELECT week, result FROM showroom_weeks WHERE result IS NOT NULL ORDER BY week DESC LIMIT 1').get();
    let winners = [];
    try {
      winners = last ? JSON.parse(last.result).map((w) => ({ ...w, name: name(w.id) })) : [];
    } catch {}
    return { tab: k, list: rows, mine: view(uid, uid), endsAt: weekEnds(cur), lastWeek: winners.length ? { week: last.week, winners } : null, rules: SR };
  }

  // ---------- weekly settlement ----------
  // Once per week (the INSERT is the guard): the top showrooms of the week that just ended by counted likes.
  // Banned and rating-hidden players are skipped (the places close up).
  function settle() {
    const prev = prevWeek(weekOf(now()));
    if (q('SELECT 1 FROM showroom_weeks WHERE week = ?').get(prev)) return null;
    const rows = q(`SELECT l.owner_id id, COUNT(*) n, MAX(l.at) last FROM showroom_likes l JOIN users u ON u.id = l.owner_id
                    WHERE l.week = ? AND l.counted = 1 AND u.banned = 0 AND u.lb_hidden = 0 GROUP BY l.owner_id`).all(prev);
    const top = R.weeklyPlaces(rows);
    q('INSERT INTO showroom_weeks (week, settled_at, result) VALUES (?, ?, ?)').run(prev, now(), top.length ? JSON.stringify(top.map(({ id, n, place, prize }) => ({ id, n, place, prize }))) : null);
    asPrize(() => {
      for (const w of top) {
        addMoney(w.id, w.prize);
        const [title, tier] = R.BADGE[w.place];
        q(`INSERT INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, 'showroom', ?, ?, NULL, ?, ?)
           ON CONFLICT (user_id, key) DO UPDATE SET title = excluded.title, tier = excluded.tier, place = excluded.place, created_at = excluded.created_at
           WHERE badges.place IS NULL OR excluded.place <= badges.place`).run(w.id, title, tier, w.place, now());
        if (w.place === 1) grantCosmetic(w.id, SR.frame);
        event(w.id, w.place === 1
          ? `🏆 Шоурум тижня: 1-е місце (${R.likesText(w.n)})! +${S.fmt(w.prize)}, значок «Шоурум тижня» і рамка номера «Шоурум тижня»`
          : `🏆 Шоурум тижня: ${w.place}-е місце (${R.likesText(w.n)}). +${S.fmt(w.prize)} і значок у профілі`);
      }
    });
    return top;
  }

  // For `me` (the menu row) and the player card: a few numbers, no car maths.
  const brief = (uid) => ({ n: thumbs(uid).length, likes: totalOf(uid), week: weekOfOwner(uid), left: Math.max(0, SR.perDay - usedToday(uid)) });
  const card = (oid) => ({ cars: thumbs(oid), likes: totalOf(oid), week: weekOfOwner(oid) });
  // For the bot (inline answers, the shared message): who, which cars, how many likes; null when there's nothing to show.
  function info(oid) {
    const u = q('SELECT id, banned FROM users WHERE id = ?').get(oid);
    const list = u && !u.banned ? thumbs(oid) : [];
    return list.length ? { id: oid, name: name(oid), models: list.map((c) => c.model), likes: totalOf(oid), week: weekOfOwner(oid) } : null;
  }

  return {
    api: {
      showroom: page,
      'showroom/get': (uid, { id }) => view(uid, int(id, 1, Number.MAX_SAFE_INTEGER, 'ID гравця')),
      'showroom/set': set,
      'showroom/like': like,
    },
    settle, brief, card, cars, view, info,
  };
}
