// «Автоклуби» on the server (rules: public/clubs.js, app: public/clubs-ui.js). Own tables only (created here, IF NOT
// EXISTS — nothing in the old tables changes, so the Railway base still merges). The game feeds it wins (award), the
// income collected (incomeBonus) and asks it for tags (tagsOf); the weekly league settles once per week, at the first
// call after Monday 00:00 Kyiv (and from the server's sweeper), by inserting its club_weeks row — only one caller
// ever gets that insert, so prizes are paid exactly once.
import crypto from 'node:crypto';
import * as C from '../public/clubs.js';

const R = C.CLUB;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS clubs (id INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE, name TEXT NOT NULL, about TEXT NOT NULL DEFAULT '',
  tg_url TEXT NOT NULL DEFAULT '', open INTEGER NOT NULL DEFAULT 1, owner_id INTEGER NOT NULL, invite TEXT NOT NULL UNIQUE,
  treasury INTEGER NOT NULL DEFAULT 0, donated INTEGER NOT NULL DEFAULT 0, spent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS club_members (user_id INTEGER PRIMARY KEY, club_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL, donated INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS club_members_club ON club_members(club_id);
CREATE TABLE IF NOT EXISTS club_points (week TEXT NOT NULL, club_id INTEGER NOT NULL, user_id INTEGER NOT NULL, pts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week, club_id, user_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS club_day (user_id INTEGER NOT NULL, day TEXT NOT NULL, pts INTEGER NOT NULL DEFAULT 0, dr INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS club_perks (club_id INTEGER NOT NULL, week TEXT NOT NULL, perk TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1,
  paid INTEGER NOT NULL, by_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (club_id, week, perk)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS club_claims (user_id INTEGER NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, key)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS club_weeks (week TEXT PRIMARY KEY, settled_at INTEGER NOT NULL, result TEXT);
CREATE TABLE IF NOT EXISTS club_log (id INTEGER PRIMARY KEY, club_id INTEGER NOT NULL, user_id INTEGER, kind TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
  note TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS club_log_club ON club_log(club_id, id);
`;
// Words a club may not take as a name or tag: they would pass for the game's own staff.
const RESERVED = /avtodrop|автодроп|admin|адмін|админ|модер|moder|support|підтримк/i;

export function createClubs(ctx) {
  const { db, q, now, fail, int, name, addMoney, pay, event, addKeys, userRow, weekOf, dayOf, addFuel, alog } = ctx;
  db.exec(SCHEMA);
  const tell = (uid, text) => {
    try {
      event(uid, text);
    } catch {}
  };

  // ---------- time ----------
  const week = () => weekOf(now());
  const prevWeek = (w) => {
    const d = new Date(w + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  };
  // Kyiv midnight of a date (UTC+2 in winter, +3 in summer).
  const kyivMidnight = (d) => {
    const s = Date.parse(d + 'T00:00:00+03:00');
    return dayOf(s) === d ? s : Date.parse(d + 'T00:00:00+02:00');
  };
  const weekEnd = (w = week()) => {
    const d = new Date(w + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    return kyivMidnight(d.toISOString().slice(0, 10));
  };

  // ---------- reads ----------
  const clubRow = (id) => q('SELECT * FROM clubs WHERE id = ?').get(id) || null;
  const memberRow = (uid) => q('SELECT * FROM club_members WHERE user_id = ?').get(uid) || null;
  const membersN = (cid) => q('SELECT COUNT(*) n FROM club_members WHERE club_id = ?').get(cid).n;
  const counts = (m, t = now()) => !!m && t - m.joined_at >= R.waitH * 3600e3;
  const clubPts = (cid, w = week()) => q('SELECT COALESCE(SUM(pts), 0) s FROM club_points WHERE week = ? AND club_id = ?').get(w, cid).s;
  const myPts = (uid, cid, w = week()) => q('SELECT pts FROM club_points WHERE week = ? AND club_id = ? AND user_id = ?').get(w, cid, uid)?.pts || 0;
  const perksOf = (cid, w = week()) => Object.fromEntries(q('SELECT perk, level, paid, by_id, at FROM club_perks WHERE club_id = ? AND week = ?').all(cid, w).map((r) => [r.perk, r]));
  const claimed = (uid, key) => !!q('SELECT 1 FROM club_claims WHERE user_id = ? AND key = ?').get(uid, key);
  const log = (cid, uid, kind, amount = 0, note = null) => q('INSERT INTO club_log (club_id, user_id, kind, amount, note, at) VALUES (?, ?, ?, ?, ?, ?)').run(cid, uid, kind, Math.round(amount), note, now());
  const newInvite = () => {
    let code;
    do code = Array.from(crypto.randomBytes(8), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b & 31]).join('');
    while (q('SELECT 1 FROM clubs WHERE invite = ?').get(code));
    return code;
  };
  // Tags of many players at once: Map uid → tag.
  function tagsOf(ids) {
    const list = [...new Set(ids.filter((x) => Number.isSafeInteger(x) && x > 0))];
    const out = new Map();
    for (let i = 0; i < list.length; i += 400) {
      const part = list.slice(i, i + 400);
      for (const r of q(`SELECT m.user_id, c.tag FROM club_members m JOIN clubs c ON c.id = m.club_id WHERE m.user_id IN (${part.map(() => '?').join(',')})`).all(...part)) out.set(r.user_id, r.tag);
    }
    return out;
  }
  // Puts `tag` on every row (or nested player object) that has a player id.
  function tagRows(rows, pick = (r) => r) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    const objs = rows.map(pick).filter((o) => o && typeof o === 'object');
    const tags = tagsOf(objs.map((o) => o.id));
    for (const o of objs) if (tags.has(o.id)) o.tag = tags.get(o.id);
    return rows;
  }

  // ---------- the league ----------
  // All clubs of a week, best first: points, members, members who made the prize minimum, qualified for prizes.
  function standings(w = week()) {
    const rows = q(`SELECT c.id, c.tag, c.name, c.open, c.tg_url,
        (SELECT COUNT(*) FROM club_members m WHERE m.club_id = c.id) members,
        COALESCE((SELECT SUM(p.pts) FROM club_points p WHERE p.week = ? AND p.club_id = c.id), 0) pts,
        (SELECT COUNT(*) FROM club_points p WHERE p.week = ? AND p.club_id = c.id AND p.pts >= ?) active
      FROM clubs c ORDER BY pts DESC, c.id`).all(w, w, R.prizeMinPts);
    let prizePlace = 0;
    return rows.map((r, i) => {
      const qualified = r.active >= R.prizeMembers && r.pts > 0;
      return { place: i + 1, id: r.id, tag: r.tag, name: r.name, open: !!r.open, members: r.members, pts: r.pts, active: r.active, qualified, prizePlace: qualified ? ++prizePlace : null };
    });
  }
  let settledWeek = null;
  // Money moved by the club itself (prizes, the income perk) is labelled 'club' in the owner's metrics (ctx.asClub).
  const asClub = (fn) => (ctx.asClub ? ctx.asClub(fn) : fn());
  const settle = () => asClub(settleNow);
  function settleNow() {
    const cur = week();
    if (settledWeek === cur) return 0;
    const prev = prevWeek(cur);
    if (q('SELECT 1 FROM club_weeks WHERE week = ?').get(prev)) return (settledWeek = cur, 0);
    q('INSERT INTO club_weeks (week, settled_at) VALUES (?, ?)').run(prev, now());
    const top = standings(prev).filter((r) => r.qualified && r.prizePlace <= R.prizes.length);
    const result = [];
    let paid = 0;
    for (const club of top) {
      const prize = C.prizeOf(club.prizePlace);
      const who = q('SELECT p.user_id, p.pts FROM club_points p JOIN club_members m ON m.user_id = p.user_id AND m.club_id = p.club_id WHERE p.week = ? AND p.club_id = ? AND p.pts >= ?')
        .all(prev, club.id, R.prizeMinPts);
      for (const m of who) {
        addMoney(m.user_id, prize);
        tell(m.user_id, `🏁 Клубна ліга: ${C.tagText(club.tag)} ${club.name} — ${club.prizePlace} місце тижня! Твій приз +${prize.toLocaleString('uk-UA')} ₴ (твої очки: ${m.pts})`);
      }
      paid += prize * who.length;
      log(club.id, null, 'prize', prize * who.length, `${club.prizePlace} місце · ${who.length} учасн.`);
      result.push({ place: club.prizePlace, id: club.id, tag: club.tag, name: club.name, pts: club.pts, paid: who.length, prize });
    }
    q('UPDATE club_weeks SET result = ? WHERE week = ?').run(JSON.stringify({ top: result, paid }), prev);
    // Old daily counters and point rows are not needed after a few weeks.
    const old = prevWeek(prevWeek(prevWeek(prev)));
    q('DELETE FROM club_points WHERE week < ?').run(old);
    q('DELETE FROM club_perks WHERE week < ?').run(old);
    q('DELETE FROM club_day WHERE day < ?').run(old);
    settledWeek = cur;
    return result.length;
  }

  // ---------- fed by the game ----------
  // A win: kind ∈ drag | drift | boss | dayrace. Counts only 24 h after joining, up to dayCap a day; the day race once.
  function award(uid, kind) {
    const add = R.points[kind];
    const m = memberRow(uid);
    if (!add || !m || !counts(m)) return 0;
    const day = dayOf(now());
    q('INSERT OR IGNORE INTO club_day (user_id, day) VALUES (?, ?)').run(uid, day);
    const d = q('SELECT pts, dr FROM club_day WHERE user_id = ? AND day = ?').get(uid, day);
    if (kind === 'dayrace' && d.dr) return 0;
    const n = Math.min(add, R.dayCap - d.pts);
    if (n <= 0) return 0;
    q('UPDATE club_day SET pts = pts + ?, dr = MAX(dr, ?) WHERE user_id = ? AND day = ?').run(n, kind === 'dayrace' ? 1 : 0, uid, day);
    q('INSERT INTO club_points (week, club_id, user_id, pts) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET pts = pts + excluded.pts').run(week(), m.club_id, uid, n);
    return n;
  }
  // «Клубний дохід»: +pct% of the income just collected, at most `cap` a day per member.
  function incomeBonus(uid, got) {
    const m = memberRow(uid);
    if (!m || !counts(m) || !(got > 0)) return 0;
    const p = perksOf(m.club_id).income;
    if (!p) return 0;
    const L = R.perks.income.levels[p.level - 1];
    const day = dayOf(now());
    q('INSERT OR IGNORE INTO club_day (user_id, day) VALUES (?, ?)').run(uid, day);
    const used = q('SELECT bonus FROM club_day WHERE user_id = ? AND day = ?').get(uid, day).bonus;
    const n = Math.max(0, Math.min(Math.floor((got * L.pct) / 100), L.cap - used));
    if (!n) return 0;
    q('UPDATE club_day SET bonus = bonus + ? WHERE user_id = ? AND day = ?').run(n, uid, day);
    asClub(() => addMoney(uid, n));
    return n;
  }

  // ---------- views ----------
  const roleRank = { owner: 0, officer: 1, member: 2 };
  function clubPublic(c, w = week()) {
    const st = standings(w);
    const s = st.find((r) => r.id === c.id);
    return { id: c.id, tag: c.tag, name: c.name, about: c.about, tg: c.tg_url || null, open: !!c.open, members: membersN(c.id), max: R.max,
      owner: { id: c.owner_id, name: name(c.owner_id) }, pts: s?.pts || 0, place: s?.place || null, clubs: st.length, createdAt: c.created_at };
  }
  function claimsOf(uid, m, perks) {
    const ok = counts(m);
    const day = dayOf(now()), w = week();
    return {
      chest: perks.chest ? { can: ok && !claimed(uid, `chest:${w}`), done: claimed(uid, `chest:${w}`), caseId: R.perks.chest.caseId } : null,
      fuel: perks.fuel ? { can: ok && !claimed(uid, `fuel:${day}`), done: claimed(uid, `fuel:${day}`), n: R.perks.fuel.n } : null,
    };
  }
  // The player's own club: everything the club screen shows.
  function mine(uid) {
    const m = memberRow(uid);
    if (!m) return null;
    const c = clubRow(m.club_id);
    const w = week(), perks = perksOf(c.id, w), n = membersN(c.id);
    const pts = Object.fromEntries(q('SELECT user_id, pts FROM club_points WHERE week = ? AND club_id = ?').all(w, c.id).map((r) => [r.user_id, r.pts]));
    const t = now();
    const members = q('SELECT user_id, role, joined_at, donated FROM club_members WHERE club_id = ?').all(c.id)
      .map((r) => ({ id: r.user_id, name: name(r.user_id), role: r.role, joinedAt: r.joined_at, counts: counts({ joined_at: r.joined_at }, t), countsAt: r.joined_at + R.waitH * 3600e3,
        donated: r.donated, pts: pts[r.user_id] || 0, me: r.user_id === uid, level: q('SELECT level FROM users WHERE id = ?').get(r.user_id)?.level || 1 }))
      .sort((a, b) => b.pts - a.pts || roleRank[a.role] - roleRank[b.role] || a.joinedAt - b.joinedAt);
    const staff = m.role === 'owner' || m.role === 'officer';
    const shop = Object.fromEntries(C.PERK_KEYS.map((k) => {
      const have = perks[k]?.level || 0;
      if (k === 'income') {
        return [k, { have, levels: R.perks.income.levels.map((L, i) => ({ level: i + 1, pct: L.pct, cap: L.cap, cost: C.perkCost('income', i + 1, n, have) })) }];
      }
      return [k, { have: !!have, cost: have ? null : C.perkCost(k, 1, n) }];
    }));
    return {
      ...clubPublic(c, w), invite: c.invite, treasury: c.treasury, donated: c.donated, spent: c.spent,
      role: m.role, staff, joinedAt: m.joined_at, counts: counts(m), countsAt: m.joined_at + R.waitH * 3600e3, myPts: pts[uid] || 0, myDonated: m.donated,
      members, perks: shop, claims: claimsOf(uid, m, perks), week: w, weekEnd: weekEnd(w),
      log: q('SELECT user_id, kind, amount, note, at FROM club_log WHERE club_id = ? ORDER BY id DESC LIMIT 30').all(c.id)
        .map((r) => ({ who: r.user_id ? name(r.user_id) : null, kind: r.kind, amount: r.amount, note: r.note, at: r.at })),
    };
  }
  // For `me`: one small object for the menu tile (null when not in a club).
  function brief(uid) {
    const m = memberRow(uid);
    if (!m) return null;
    const c = clubRow(m.club_id);
    if (!c) return null;
    const cl = claimsOf(uid, m, perksOf(c.id));
    return { id: c.id, tag: c.tag, name: c.name, role: m.role, pts: clubPts(c.id), myPts: myPts(uid, c.id), counts: counts(m), ready: (cl.chest?.can ? 1 : 0) + (cl.fuel?.can ? 1 : 0) };
  }
  function lastWeek() {
    const r = q('SELECT week, result FROM club_weeks WHERE result IS NOT NULL ORDER BY week DESC LIMIT 1').get();
    if (!r) return null;
    const v = JSON.parse(r.result);
    return { week: r.week, top: (v.top || []).slice(0, 3) };
  }

  // ---------- player calls ----------
  const need = (uid, lvl, what) => {
    if (userRow(uid).level < lvl) fail(`${what} відкривається з ${lvl}-го рівня`);
  };
  const myClub = (uid, roles = null) => {
    const m = memberRow(uid);
    if (!m) fail('Ти не в клубі');
    if (roles && !roles.includes(m.role)) fail(m.role === 'member' ? 'Це можуть лише власник і офіцери' : 'Це може лише власник клубу');
    return { m, c: clubRow(m.club_id) };
  };
  const target = (c, userId) => {
    const t = memberRow(int(userId, 1, Number.MAX_SAFE_INTEGER, 'Гравець'));
    if (!t || t.club_id !== c.id) fail('Цей гравець не в твоєму клубі');
    return t;
  };
  function view(uid) {
    settle();
    const club = mine(uid);
    const u = userRow(uid);
    const st = standings();
    return {
      club, rules: { ...R }, level: u.level, canJoin: u.level >= R.joinLevel, canCreate: u.level >= R.createLevel,
      league: st.slice(0, 50), clubs: st.length, weekEnd: weekEnd(), last: lastWeek(),
      list: club ? [] : list(uid, {}).list,
    };
  }
  function list(uid, { q: text = '' } = {}) {
    const s = String(text || '').trim().replace(/^\[|\]$/g, '').slice(0, 24);
    const st = standings();
    const lc = s.toLocaleLowerCase('uk-UA');
    const rows = s ? st.filter((r) => r.tag.toLocaleLowerCase('uk-UA').includes(lc) || r.name.toLocaleLowerCase('uk-UA').includes(lc)) : st.filter((r) => r.open);
    return { list: rows.slice(0, 30).map((r) => ({ ...r, about: clubRow(r.id).about, full: r.members >= R.max })), q: s };
  }
  // A club by its invite code (the link's preview) or id (from the list).
  function peek(uid, { id, code }) {
    const c = code != null ? (C.INVITE_RE.test(String(code)) ? q('SELECT * FROM clubs WHERE invite = ?').get(String(code)) : null) : clubRow(int(id, 1, 1e12, 'Клуб'));
    if (!c) fail(code != null ? 'Запрошення недійсне — попроси нове посилання' : 'Клуб не знайдено');
    const m = memberRow(uid);
    return { club: clubPublic(c), mine: m?.club_id === c.id, inClub: !!m, invited: code != null };
  }
  function create(uid, { tag, name: nm, about = '', open = true }) {
    settle();
    need(uid, R.createLevel, 'Створення клубу');
    if (memberRow(uid)) fail('Ти вже в клубі — спершу вийди з нього');
    const t = C.tagNorm(tag), n = C.nameNorm(nm);
    if (!C.TAG_RE.test(t)) fail('Тег — рівно 4 літери або цифри, напр. ЖИГА');
    if (!C.NAME_RE.test(n)) fail('Назва — 3–24 символи: літери, цифри, пробіли');
    if (RESERVED.test(t) || RESERVED.test(n)) fail('Така назва зарезервована');
    if (q('SELECT 1 FROM clubs WHERE tag = ?').get(t)) fail(`Тег [${t}] уже зайнятий`);
    pay(uid, R.createCost);
    const id = Number(q('INSERT INTO clubs (tag, name, about, open, owner_id, invite, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(t, n, C.aboutNorm(about), open === false || open === 0 ? 0 : 1, uid, newInvite(), now()).lastInsertRowid);
    q("INSERT INTO club_members (user_id, club_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(uid, id, now());
    log(id, uid, 'create', R.createCost);
    return { ok: true, club: mine(uid) };
  }
  function join(uid, { id, code }) {
    settle();
    need(uid, R.joinLevel, 'Вступ до клубу');
    if (memberRow(uid)) fail('Ти вже в клубі — спершу вийди з нього');
    const byCode = code != null && code !== '';
    const c = byCode ? (C.INVITE_RE.test(String(code)) ? q('SELECT * FROM clubs WHERE invite = ?').get(String(code)) : null) : clubRow(int(id, 1, 1e12, 'Клуб'));
    if (!c) fail(byCode ? 'Запрошення недійсне — попроси нове посилання' : 'Клуб не знайдено');
    if (!byCode && !c.open) fail('Цей клуб приймає лише за запрошенням');
    if (membersN(c.id) >= R.max) fail(`У клубі вже ${R.max} учасників`);
    q("INSERT INTO club_members (user_id, club_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(uid, c.id, now());
    log(c.id, uid, 'join', 0, byCode ? 'за запрошенням' : null);
    return { ok: true, club: mine(uid) };
  }
  // Leaving (or a kick) wipes the player's points of the current week: no hopping with them.
  function drop(uid, cid) {
    q('DELETE FROM club_members WHERE user_id = ?').run(uid);
    q('DELETE FROM club_points WHERE week = ? AND club_id = ? AND user_id = ?').run(week(), cid, uid);
  }
  function disband(cid) {
    q('DELETE FROM club_points WHERE club_id = ?').run(cid);
    q('DELETE FROM club_perks WHERE club_id = ?').run(cid);
    q('DELETE FROM club_members WHERE club_id = ?').run(cid);
    q('DELETE FROM club_log WHERE club_id = ?').run(cid);
    q('DELETE FROM clubs WHERE id = ?').run(cid);
  }
  function leave(uid) {
    settle();
    const { m, c } = myClub(uid);
    if (m.role === 'owner') {
      if (membersN(c.id) > 1) fail('Спершу передай клуб іншому учаснику');
      disband(c.id);
      return { ok: true, disbanded: true };
    }
    drop(uid, c.id);
    log(c.id, uid, 'leave');
    return { ok: true };
  }
  function kick(uid, { userId }) {
    settle();
    const { m, c } = myClub(uid, ['owner', 'officer']);
    const t = target(c, userId);
    if (t.user_id === uid) fail('Себе не можна виключити — вийди з клубу');
    if (t.role === 'owner' || (t.role === 'officer' && m.role !== 'owner')) fail('Офіцера може виключити лише власник');
    drop(t.user_id, c.id);
    log(c.id, uid, 'kick', 0, name(t.user_id));
    tell(t.user_id, `Тебе виключено з клубу ${C.tagText(c.tag)} ${c.name}`);
    return { ok: true, club: mine(uid) };
  }
  function role(uid, { userId, role: r }) {
    const { c } = myClub(uid, ['owner']);
    const t = target(c, userId);
    if (!['officer', 'member'].includes(r)) fail('Роль: офіцер або учасник');
    if (t.role === 'owner') fail('Власника не можна змінити — передай клуб');
    if (t.role === r) return { ok: true, club: mine(uid) };
    if (r === 'officer' && q("SELECT COUNT(*) n FROM club_members WHERE club_id = ? AND role = 'officer'").get(c.id).n >= R.officers) fail(`Офіцерів — не більше ${R.officers}`);
    q('UPDATE club_members SET role = ? WHERE user_id = ?').run(r, t.user_id);
    log(c.id, uid, 'role', 0, `${name(t.user_id)} → ${C.ROLES[r].toLowerCase()}`);
    if (r === 'officer') tell(t.user_id, `Тебе призначено офіцером клубу ${C.tagText(c.tag)} ${c.name}`);
    return { ok: true, club: mine(uid) };
  }
  function transfer(uid, { userId }) {
    const { c } = myClub(uid, ['owner']);
    const t = target(c, userId);
    if (t.user_id === uid) fail('Ти вже власник');
    const officers = q("SELECT COUNT(*) n FROM club_members WHERE club_id = ? AND role = 'officer' AND user_id <> ?").get(c.id, t.user_id).n;
    q("UPDATE club_members SET role = 'owner' WHERE user_id = ?").run(t.user_id);
    q('UPDATE club_members SET role = ? WHERE user_id = ?').run(officers < R.officers ? 'officer' : 'member', uid);
    q('UPDATE clubs SET owner_id = ? WHERE id = ?').run(t.user_id, c.id);
    log(c.id, uid, 'transfer', 0, name(t.user_id));
    tell(t.user_id, `👑 Тепер ти власник клубу ${C.tagText(c.tag)} ${c.name}`);
    return { ok: true, club: mine(uid) };
  }
  function edit(uid, { name: nm, about, tg, open }) {
    const { c } = myClub(uid, ['owner']);
    const set = {};
    if (nm != null) {
      const n = C.nameNorm(nm);
      if (!C.NAME_RE.test(n)) fail('Назва — 3–24 символи: літери, цифри, пробіли');
      if (RESERVED.test(n)) fail('Така назва зарезервована');
      set.name = n;
    }
    if (about != null) set.about = C.aboutNorm(about);
    if (tg != null) {
      const link = C.tgLinkNorm(tg);
      if (link === null) fail('Посилання на групу — лише t.me/… (напр. t.me/mygroup або t.me/+AbCdEf123)');
      set.tg_url = link;
    }
    if (open != null) set.open = open === true || open === 1 ? 1 : 0;
    const keys = Object.keys(set);
    if (keys.length) q(`UPDATE clubs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => set[k]), c.id);
    if (keys.length) log(c.id, uid, 'edit', 0, keys.join(','));
    return { ok: true, club: mine(uid) };
  }
  function invite(uid) {
    const { c } = myClub(uid, ['owner', 'officer']);
    q('UPDATE clubs SET invite = ? WHERE id = ?').run(newInvite(), c.id);
    log(c.id, uid, 'invite');
    return { ok: true, club: mine(uid) };
  }
  function donate(uid, { amount }) {
    settle();
    const { c } = myClub(uid);
    const n = int(amount, R.donateMin, R.donateMax, 'Сума');
    pay(uid, n);
    q('UPDATE clubs SET treasury = treasury + ?, donated = donated + ? WHERE id = ?').run(n, n, c.id);
    q('UPDATE club_members SET donated = donated + ? WHERE user_id = ?').run(n, uid);
    log(c.id, uid, 'donate', n);
    return { ok: true, club: mine(uid) };
  }
  function buyPerk(uid, { perk, level = 1 }) {
    settle();
    const { c } = myClub(uid, ['owner', 'officer']);
    const p = R.perks[perk];
    if (!p) fail('Невідомий бонус');
    const w = week(), have = perksOf(c.id, w)[perk]?.level || 0;
    const lvl = perk === 'income' ? int(level, 1, p.levels.length, 'Рівень') : 1;
    const cost = C.perkCost(perk, lvl, membersN(c.id), have);
    if (cost == null) fail(perk === 'income' ? 'Цей рівень уже куплено на цей тиждень' : 'Уже куплено на цей тиждень');
    if (!q('UPDATE clubs SET treasury = treasury - ?, spent = spent + ? WHERE id = ? AND treasury >= ?').run(cost, cost, c.id, cost).changes) fail('У клубній касі недостатньо грошей');
    q(`INSERT INTO club_perks (club_id, week, perk, level, paid, by_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET level = excluded.level, paid = paid + excluded.paid, by_id = excluded.by_id, at = excluded.at`).run(c.id, w, perk, lvl, cost, uid, now());
    log(c.id, uid, 'perk', cost, perk === 'income' ? `${p.name} +${p.levels[lvl - 1].pct}%` : p.name);
    return { ok: true, club: mine(uid) };
  }
  function claim(uid, { kind }) {
    settle();
    const { m, c } = myClub(uid);
    const perks = perksOf(c.id);
    if (!['chest', 'fuel'].includes(kind) || !perks[kind]) fail('Клуб не купив цей бонус на цей тиждень');
    if (!counts(m)) fail(`Бонуси клубу діють через ${R.waitH} год після вступу`);
    const key = kind === 'chest' ? `chest:${week()}` : `fuel:${dayOf(now())}`;
    if (claimed(uid, key)) fail(kind === 'chest' ? 'Ключ цього тижня вже забрано' : 'Пальне сьогодні вже забрано — завтра знову');
    let out;
    if (kind === 'chest') {
      addKeys(uid, R.perks.chest.caseId, 1);
      out = { caseId: R.perks.chest.caseId, count: 1 };
    } else {
      const got = addFuel(uid, R.perks.fuel.n);
      if (!got) fail('Бак уже повний — забери пальне пізніше');
      out = { fuel: got };
    }
    q('INSERT INTO club_claims (user_id, key, at) VALUES (?, ?, ?)').run(uid, key, now());
    return { ok: true, ...out, club: mine(uid) };
  }
  function league(uid) {
    settle();
    const st = standings();
    const m = memberRow(uid);
    return { list: st.slice(0, 50), mine: m ? st.find((r) => r.id === m.club_id) || null : null, clubs: st.length, weekEnd: weekEnd(), last: lastWeek(), prizes: R.prizes };
  }

  // ---------- admin ----------
  function adminView() {
    settle();
    const st = standings();
    return {
      clubs: st.map((r) => {
        const c = clubRow(r.id);
        return { ...r, owner: { id: c.owner_id, name: name(c.owner_id) }, treasury: c.treasury, donated: c.donated, spent: c.spent, about: c.about, tg: c.tg_url, createdAt: c.created_at };
      }),
      weeks: q('SELECT week, settled_at at, result FROM club_weeks ORDER BY week DESC LIMIT 6').all().map((r) => ({ week: r.week, at: r.at, ...(JSON.parse(r.result || 'null') || {}) })),
      totals: q('SELECT COUNT(*) n, COALESCE(SUM(treasury), 0) treasury, COALESCE(SUM(donated), 0) donated, COALESCE(SUM(spent), 0) spent FROM clubs').get(),
      members: q('SELECT COUNT(*) n FROM club_members').get().n,
    };
  }
  // A name, tag or text breaking the rules: replaced by a neutral one (the club stays, the owner can rename it).
  function adminReset(who, { id, what }) {
    const c = clubRow(int(id, 1, 1e12, 'Клуб'));
    if (!c) fail('Клуб не знайдено');
    if (what === 'tag') {
      let n = c.id % 1000, t;
      do t = 'К' + String(n++ % 1000).padStart(3, '0');
      while (q('SELECT 1 FROM clubs WHERE tag = ? AND id <> ?').get(t, c.id));
      q('UPDATE clubs SET tag = ? WHERE id = ?').run(t, c.id);
    } else if (what === 'name') q('UPDATE clubs SET name = ? WHERE id = ?').run(`Клуб ${c.id}`, c.id);
    else if (what === 'about') q("UPDATE clubs SET about = '' WHERE id = ?").run(c.id);
    else if (what === 'tg') q("UPDATE clubs SET tg_url = '' WHERE id = ?").run(c.id);
    else fail('Що скинути: tag, name, about або tg');
    log(c.id, null, 'admin', 0, what);
    tell(c.owner_id, `Адміністрація змінила ${{ tag: 'тег', name: 'назву', about: 'опис', tg: 'посилання на групу' }[what]} твого клубу — він порушував правила`);
    alog(who, 'clubs-reset', null, { id: c.id, tag: c.tag, name: c.name, what });
    return adminView();
  }
  function adminDisband(who, { id }) {
    const c = clubRow(int(id, 1, 1e12, 'Клуб'));
    if (!c) fail('Клуб не знайдено');
    const ids = q('SELECT user_id FROM club_members WHERE club_id = ?').all(c.id).map((r) => r.user_id);
    disband(c.id);
    for (const u of ids) tell(u, `Клуб ${C.tagText(c.tag)} ${c.name} розпущено адміністрацією`);
    alog(who, 'clubs-disband', null, { id: c.id, tag: c.tag, name: c.name, members: ids.length, treasury: c.treasury });
    return adminView();
  }

  return {
    settle, award, incomeBonus, brief, tagsOf, tagRows, standings, weekEnd,
    api: {
      club: view, 'club/list': list, 'club/peek': peek, 'club/create': create, 'club/join': join, 'club/leave': leave,
      'club/kick': kick, 'club/role': role, 'club/transfer': transfer, 'club/edit': edit, 'club/invite': invite,
      'club/donate': donate, 'club/perk': buyPerk, 'club/claim': claim, 'club/league': league,
    },
    admin: { clubs: () => adminView(), 'clubs/reset': adminReset, 'clubs/disband': adminDisband },
    mutating: ['clubs/reset', 'clubs/disband'],
  };
}
