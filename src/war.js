// «Війна районів» on the server (rules: public/war.js; the map: public/s2-ui.js warMap). Own tables only (IF NOT
// EXISTS). Reads the clubs' tables (src/clubs.js) — war points ARE the club league points of the week (club_points),
// so every win that feeds the league feeds the war the same way (weights, daily cap, the 24 h rule).
// A round is settled once: war_rounds has one non-forced row per league week (a UNIQUE partial index), inserted by the
// first caller after Monday 00:00 Kyiv (the server's sweeper and `me`, through CL.settle in game.js). An admin
// force-settle (test bot) closes the current round early as a forced row; attacks declared after it form the next
// round of the same week (round key `<week>#<n>`), which the Monday settlement then closes.
import * as W from '../public/war.js';
import { CLUB, tagText } from '../public/clubs.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS war_holdings (district TEXT PRIMARY KEY, club_id INTEGER NOT NULL, since INTEGER NOT NULL, week TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS war_attacks (round TEXT NOT NULL, club_id INTEGER NOT NULL, district TEXT NOT NULL, by_id INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (round, club_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS war_rounds (round TEXT PRIMARY KEY, week TEXT NOT NULL, forced INTEGER NOT NULL DEFAULT 0, settled_at INTEGER NOT NULL, result TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS war_rounds_week ON war_rounds(week) WHERE forced = 0;
`;

export function createWar(ctx) {
  const { db, q, now, fail, name, event, weekOf, weekEnd, bankAll = () => {}, alog = () => {} } = ctx;
  db.exec(SCHEMA);
  const tell = (uid, text) => {
    try {
      event(uid, text);
    } catch {}
  };
  const week = () => weekOf(now());
  const prevWeek = (w) => {
    const d = new Date(w + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  };
  // The open round of a week: the week itself, or `<week>#<n>` after n forced settlements.
  const roundOf = (w) => {
    const n = q('SELECT COUNT(*) n FROM war_rounds WHERE week = ?').get(w).n;
    return n ? `${w}#${n}` : w;
  };
  const settledWeek = (w) => !!q('SELECT 1 FROM war_rounds WHERE week = ? AND forced = 0').get(w);

  const clubRow = (id) => q('SELECT id, tag, name, treasury FROM clubs WHERE id = ?').get(id) || null;
  const clubOut = (c) => (c ? { id: c.id, tag: c.tag, name: c.name, c: W.clubColour(c.id) } : null);
  const membersN = (cid) => q('SELECT COUNT(*) n FROM club_members WHERE club_id = ?').get(cid).n;
  const memberIds = (cid) => q('SELECT user_id FROM club_members WHERE club_id = ?').all(cid).map((r) => r.user_id);
  const pts = (cid, w) => q('SELECT COALESCE(SUM(pts), 0) s FROM club_points WHERE week = ? AND club_id = ?').get(w, cid).s;
  // Holdings of clubs that still exist (a disbanded club's rows are dropped by drop(); this is the safety net).
  const holdings = () => q('SELECT h.district, h.club_id, h.since, h.week FROM war_holdings h JOIN clubs c ON c.id = h.club_id').all().filter((h) => W.DISTRICT_BY_ID[h.district]);
  const heldBy = (cid) => holdings().filter((h) => h.club_id === cid);
  const attacksOf = (round) => q('SELECT a.club_id, a.district, a.by_id, a.at FROM war_attacks a JOIN clubs c ON c.id = a.club_id WHERE a.round = ? ORDER BY a.at, a.club_id').all(round);

  // ---------- the +15 % business bonus ----------
  // A member of a club holding at least one district, 24 h after joining (the clubs' anti-hopping rule, CLUB.waitH).
  function holds(uid) {
    const m = q('SELECT club_id, joined_at FROM club_members WHERE user_id = ?').get(uid);
    if (!m || now() - m.joined_at < CLUB.waitH * 3600e3) return false;
    return !!q('SELECT 1 FROM war_holdings WHERE club_id = ? LIMIT 1').get(m.club_id);
  }

  // ---------- the round's live scores ----------
  // Per district: holder + its defence, attackers with their scores (best first).
  function board(round, w) {
    const hs = holdings(), atts = attacksOf(round);
    const held = new Map();
    for (const h of hs) held.set(h.club_id, (held.get(h.club_id) || 0) + 1);
    const ptsCache = new Map();
    const P = (cid) => (ptsCache.has(cid) ? ptsCache.get(cid) : (ptsCache.set(cid, pts(cid, w)), ptsCache.get(cid)));
    return W.DISTRICTS.map((d) => {
      const h = hs.find((x) => x.district === d.id) || null;
      const holder = h ? { id: h.club_id, score: W.defenceOf(P(h.club_id), held.get(h.club_id)), since: h.since, held: held.get(h.club_id) } : null;
      const attackers = atts.filter((a) => a.district === d.id).map((a) => ({ id: a.club_id, score: P(a.club_id), at: a.at }))
        .sort((a, b) => b.score - a.score || a.at - b.at || a.id - b.id);
      return { id: d.id, holder, attackers };
    });
  }

  // ---------- the settlement ----------
  function settleRound(round, w, forced) {
    if (!q('INSERT OR IGNORE INTO war_rounds (round, week, forced, settled_at) VALUES (?, ?, ?, ?)').run(round, w, forced ? 1 : 0, now()).changes) return null;
    const b = board(round, w);
    const before = new Map(holdings().map((h) => [h.district, h.club_id]));
    const after = new Map(before);
    const out = [];
    for (const d of b) {
      const r = W.resolveDistrict(d.holder, d.attackers);
      if (r.winner) after.set(d.id, r.winner);
      else after.delete(d.id);
      out.push({ id: d.id, kind: r.kind, from: d.holder?.id ?? null, to: r.winner, defence: d.holder?.score ?? null, attackers: d.attackers.map((a) => ({ id: a.id, score: a.score })) });
    }
    // Members whose +15 % switches on or off: their business boxes are banked first, at the old rate.
    const had = new Set(before.values()), has = new Set(after.values());
    for (const cid of new Set([...had, ...has])) if (had.has(cid) !== has.has(cid)) for (const uid of memberIds(cid)) bankAll(uid);
    const t = now(), cur = week();
    for (const d of out) {
      if (d.kind !== 'captured') continue;
      q('INSERT INTO war_holdings (district, club_id, since, week) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET club_id = excluded.club_id, since = excluded.since, week = excluded.week')
        .run(d.id, d.to, t, cur);
    }
    q(`DELETE FROM war_holdings WHERE district NOT IN (${[...after.keys()].map(() => '?').join(',') || "''"})`).run(...after.keys());
    // The treasury: treasuryPerDistrict per district held after the settlement.
    const pay = new Map();
    for (const [dist, cid] of after) pay.set(cid, [...(pay.get(cid) || []), dist]);
    for (const [cid, list] of pay) {
      const sum = W.WAR.treasuryPerDistrict * list.length;
      q('UPDATE clubs SET treasury = treasury + ? WHERE id = ?').run(sum, cid);
      q('INSERT INTO club_log (club_id, user_id, kind, amount, note, at) VALUES (?, NULL, ?, ?, ?, ?)')
        .run(cid, 'war', sum, `Війна районів: ${list.map((x) => W.DISTRICT_BY_ID[x].n).join(', ')}`, t);
    }
    // Messages: one per member per club, every district that concerns the club in it.
    const lines = new Map();
    const add = (cid, s) => lines.set(cid, [...(lines.get(cid) || []), s]);
    const cl = (id) => {
      const c = clubRow(id);
      return c ? `${tagText(c.tag)} ${c.name}` : 'інший клуб';
    };
    for (const d of out) {
      const D = W.DISTRICT_BY_ID[d.id];
      if (d.kind === 'captured') {
        add(d.to, `🏴 Ваш клуб захопив ${D.loc}!`);
        if (d.from) add(d.from, `💥 Ваш клуб втратив ${D.loc} — район забрав ${cl(d.to)}`);
      } else if (d.kind === 'kept') add(d.from, `🛡 Ваш клуб відстояв ${D.loc}`);
      for (const a of d.attackers) if (a.id !== d.to) add(a.id, `⚔️ Атака на ${D.loc} не вдалася (${a.score} проти ${d.kind === 'captured' ? d.attackers[0].score : d.defence ?? 0})`);
    }
    for (const [cid, list] of pay) add(cid, `💰 +${(W.WAR.treasuryPerDistrict * list.length).toLocaleString('uk-UA')} ₴ у клубну касу, +${Math.round(W.WAR.bizBonus * 100)}% доходу бізнесів усім учасникам на тиждень`);
    for (const [cid, ls] of lines) {
      if (!clubRow(cid)) continue;
      const text = `Війна районів:\n${ls.join('\n')}`;
      for (const uid of memberIds(cid)) tell(uid, text);
    }
    const names = Object.fromEntries([...new Set(out.flatMap((d) => [d.from, d.to, ...d.attackers.map((a) => a.id)]).filter(Boolean))].map((id) => [id, clubOut(clubRow(id))]));
    const result = { districts: out, clubs: names, paid: [...pay].map(([cid, l]) => ({ id: cid, n: l.length, sum: W.WAR.treasuryPerDistrict * l.length })) };
    q('UPDATE war_rounds SET result = ? WHERE round = ?').run(JSON.stringify(result), round);
    q('DELETE FROM war_attacks WHERE round < ?').run(prevWeek(prevWeek(w)));
    return result;
  }
  // At the first call after Monday 00:00 Kyiv: the previous week's last round, once.
  let doneFor = null;
  function settle() {
    const cur = week();
    if (doneFor === cur) return null;
    const prev = prevWeek(cur);
    if (settledWeek(prev)) return (doneFor = cur, null);
    const r = settleRound(roundOf(prev), prev, false);
    doneFor = cur;
    return r;
  }
  function forceSettle(who) {
    settle();
    const w = week(), round = roundOf(w);
    const r = settleRound(round, w, true);
    alog(who, 'war-settle', null, { round, changes: r?.districts.filter((d) => d.kind === 'captured').length || 0 });
    return { ok: true, round, result: r };
  }
  // A disbanded club (src/clubs.js disband): its districts are free, its attack is gone.
  function drop(cid) {
    if (q('SELECT 1 FROM war_holdings WHERE club_id = ? LIMIT 1').get(cid)) for (const uid of memberIds(cid)) bankAll(uid);
    q('DELETE FROM war_holdings WHERE club_id = ?').run(cid);
    q('DELETE FROM war_attacks WHERE club_id = ?').run(cid);
  }

  // ---------- player calls ----------
  const myMember = (uid) => q('SELECT club_id, role, joined_at FROM club_members WHERE user_id = ?').get(uid) || null;
  // Why this club can't attack this round (null: it can).
  function cantAttack(m, round) {
    if (!m) return 'Вступи в автоклуб, щоб воювати';
    if (m.role !== 'owner' && m.role !== 'officer') return 'Атаку оголошують власник або офіцери клубу';
    if (membersN(m.club_id) < W.WAR.attackMinMembers) return `Атакувати можуть клуби від ${W.WAR.attackMinMembers} учасників`;
    if (q('SELECT 1 FROM war_attacks WHERE round = ? AND club_id = ?').get(round, m.club_id)) return 'Цього тижня клуб уже оголосив атаку';
    if (holdings().length >= W.DISTRICTS.length && holdings().every((h) => h.club_id === m.club_id)) return 'Твій клуб тримає всі райони';
    return null;
  }
  function view(uid) {
    settle();
    const w = week(), round = roundOf(w);
    const b = board(round, w);
    const m = myMember(uid);
    const ids = new Set(b.flatMap((d) => [d.holder?.id, ...d.attackers.map((a) => a.id)]).filter(Boolean));
    if (m) ids.add(m.club_id);
    const clubs = Object.fromEntries([...ids].map((id) => [id, clubOut(clubRow(id))]));
    const myTarget = m ? q('SELECT district FROM war_attacks WHERE round = ? AND club_id = ?').get(round, m.club_id)?.district || null : null;
    const last = q('SELECT round, settled_at, result FROM war_rounds WHERE result IS NOT NULL ORDER BY settled_at DESC, round DESC LIMIT 1').get();
    return {
      live: W.WAR_LIVE, week: w, round, endsAt: weekEnd(w), rules: W.WAR,
      districts: b.map((d) => ({
        id: d.id, n: W.DISTRICT_BY_ID[d.id].n,
        holder: d.holder ? { ...clubs[d.holder.id], defence: d.holder.score, since: d.holder.since, held: d.holder.held } : null,
        attackers: d.attackers.map((a) => ({ ...clubs[a.id], score: a.score })),
      })),
      my: m ? {
        club: { ...clubs[m.club_id], members: membersN(m.club_id), pts: pts(m.club_id, w) }, role: m.role, staff: m.role === 'owner' || m.role === 'officer',
        target: myTarget, cant: cantAttack(m, round), holds: heldBy(m.club_id).map((h) => h.district), bonus: holds(uid),
      } : null,
      last: last ? { round: last.round, at: last.settled_at, ...JSON.parse(last.result) } : null,
    };
  }
  function attack(uid, { district } = {}) {
    settle();
    const id = String(district ?? '');
    if (!Object.hasOwn(W.DISTRICT_BY_ID, id)) fail('Невідомий район');
    const m = myMember(uid);
    const round = roundOf(week());
    const why = cantAttack(m, round);
    if (why) fail(why);
    if (q('SELECT 1 FROM war_holdings WHERE district = ? AND club_id = ?').get(id, m.club_id)) fail('Цей район уже твого клубу');
    q('INSERT INTO war_attacks (round, club_id, district, by_id, at) VALUES (?, ?, ?, ?, ?)').run(round, m.club_id, id, uid, now());
    const D = W.DISTRICT_BY_ID[id], c = clubRow(m.club_id);
    q('INSERT INTO club_log (club_id, user_id, kind, amount, note, at) VALUES (?, ?, ?, 0, ?, ?)').run(c.id, uid, 'war-attack', `Атака на ${D.loc}`, now());
    for (const u of memberIds(c.id)) if (u !== uid) tell(u, `⚔️ ${name(uid)} оголосив атаку клубу ${tagText(c.tag)} на ${D.loc}! Кожна твоя перемога до понеділка — очки в бій`);
    const holder = q('SELECT club_id FROM war_holdings WHERE district = ?').get(id)?.club_id;
    if (holder && clubRow(holder)) for (const u of memberIds(holder)) tell(u, `🚨 ${tagText(c.tag)} ${c.name} атакує ваш район ${D.n}! Вигравай гонки, щоб відстояти його до понеділка`);
    return { ok: true, war: view(uid) };
  }

  return {
    settle, forceSettle, holds, drop,
    api: { war: view, 'war/attack': attack },
  };
}
