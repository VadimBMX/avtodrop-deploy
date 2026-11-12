// «Війна районів» (public/war.js, src/war.js): declaring an attack (owner/officer, ≥ 3 members, one a week, not an own
// district), war points = the club league points, defence = points ÷ districts held, the Monday 00:00 Kyiv settlement
// exactly once (ties to the holder, a free district to the top attacker with > 0), 5 000 000 ₴ per district into the
// treasury, +15 % business income for holders' members only, the admin force-settle and the map view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, weekOf } from '../src/game.js';
import * as W from '../public/war.js';
import { BIZ } from '../public/business.js';
import { warRoundText } from '../src/channel.js';

const K = (s) => Date.parse(s + '+02:00'); // Kyiv wall clock in winter time
const H = 3600e3;
const MON = K('2026-11-02T00:00:00'); // the Monday after the start

function setup(t0 = K('2026-10-28T12:00:00')) {
  let t = t0;
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {} });
  const mk = (id, level = 12, balance = 1e9) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ?, slots = 40 WHERE id = ?').run(level, level, balance, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const admin = (name, body = {}, who = 'tg:1') => g.adminCall(who, name, { reason: 'тест', confirm: true, ...body });
  // A club: owner + members (all past the 24 h wait); returns its id.
  const club = (owner, tag, members = []) => {
    mk(owner);
    const c = call(owner, 'club/create', { tag, name: 'Клуб ' + tag }).club;
    for (const m of members) (mk(m), call(m, 'club/join', { code: c.invite }));
    t += 25 * H;
    g.api.me(owner, {}); // the round of the week before (nothing held yet) settles here, as on the first deploy
    return c.id;
  };
  const week = () => weekOf(t);
  const setPts = (cid, uid, n, w = week()) => db.prepare('INSERT OR REPLACE INTO club_points (week, club_id, user_id, pts) VALUES (?, ?, ?, ?)').run(w, cid, uid, n);
  const hold = (district, cid) => db.prepare('INSERT OR REPLACE INTO war_holdings (district, club_id, since, week) VALUES (?, ?, ?, ?)').run(district, cid, t, week());
  const holder = (district) => db.prepare('SELECT club_id FROM war_holdings WHERE district = ?').get(district)?.club_id ?? null;
  const treasury = (cid) => db.prepare('SELECT treasury FROM clubs WHERE id = ?').get(cid).treasury;
  const events = (uid) => db.prepare('SELECT text FROM events WHERE user_id = ?').all(uid).map((r) => r.text).join('\n');
  return { db, g, mk, call, admin, club, setPts, hold, holder, treasury, events, week, add: (ms) => (t += ms), set: (x) => (t = x), at: () => t };
}

// ---------- rules ----------
test('rules: 7 districts with ids, the numbers in WAR, colours never the game yellow, resolve and defence', () => {
  assert.equal(W.DISTRICTS.length, 7);
  assert.equal(new Set(W.DISTRICTS.map((d) => d.id)).size, 7);
  assert.equal(W.WAR.attackMinMembers, 3);
  assert.equal(W.WAR.treasuryPerDistrict, 5_000_000);
  assert.equal(W.WAR.bizBonus, BIZ.districtBonus);
  assert.equal(BIZ.districtBonus, 0.15);
  assert.equal(W.WAR_LIVE, true);
  for (const c of W.CLUB_COLOURS) assert.ok(!['#ffd400', W.NEUTRAL].includes(c.toLowerCase()));
  assert.equal(W.clubColour(5), W.clubColour(5));
  assert.equal(W.defenceOf(10, 3), 3);
  assert.equal(W.defenceOf(10, 0), 0);
  // tie → holder; higher attacker → captured; earlier attacker wins a tie between attackers
  assert.deepEqual(W.resolveDistrict({ id: 1, score: 5 }, [{ id: 2, score: 5, at: 1 }]), { winner: 1, kind: 'kept' });
  assert.deepEqual(W.resolveDistrict({ id: 1, score: 5 }, [{ id: 2, score: 6, at: 1 }]), { winner: 2, kind: 'captured' });
  assert.deepEqual(W.resolveDistrict({ id: 1, score: 0 }, []), { winner: 1, kind: 'held' });
  assert.deepEqual(W.resolveDistrict(null, [{ id: 3, score: 4, at: 9 }, { id: 2, score: 4, at: 5 }]), { winner: 2, kind: 'captured' });
  assert.deepEqual(W.resolveDistrict(null, [{ id: 2, score: 0, at: 1 }]), { winner: null, kind: 'free' });
  assert.deepEqual(W.resolveDistrict(null, []), { winner: null, kind: 'free' });
});

test('map view: holders in their colour, «бій» where attackers are, a legend of holding clubs; nothing loaded → all free', () => {
  const empty = W.warView(null);
  assert.ok(empty.districts.every((d) => d.free && !d.club && !d.fight && d.c === W.NEUTRAL));
  assert.deepEqual(empty.legend, []);
  const A = { id: 1, tag: 'АААА', name: 'A', c: W.clubColour(1) }, B = { id: 2, tag: 'BBBB', name: 'B', c: W.clubColour(2) };
  const v = W.warView({ districts: [{ id: 'podil', holder: A, attackers: [] }, { id: 'obolon', holder: A, attackers: [{ ...B, score: 3 }] }, { id: 'pechersk', holder: null, attackers: [{ ...B, score: 1 }] }] });
  const by = Object.fromEntries(v.districts.map((d) => [d.id, d]));
  assert.equal(by.podil.club.id, 1);
  assert.equal(by.podil.c, A.c);
  assert.ok(by.obolon.fight && by.obolon.c === A.c && by.obolon.c2 === B.c);
  assert.ok(by.pechersk.fight && !by.pechersk.club);
  assert.ok(by.darnytsia.free);
  assert.deepEqual(v.legend.map(([c, n]) => [c.id, n]), [[1, 2]]);
});

// ---------- declaring ----------
test('declare: only owner/officer, clubs of ≥ 3 members, one attack a week (final), never an own district', () => {
  const s = setup();
  const small = s.club(10, 'МАЛИ', [11]);
  assert.throws(() => s.call(10, 'war/attack', { district: 'podil' }), /від 3 учасників/);
  const A = s.club(20, 'АААА', [21, 22]);
  assert.throws(() => s.call(21, 'war/attack', { district: 'podil' }), /власник або офіцери/);
  assert.throws(() => s.call(20, 'war/attack', { district: 'kyiv' }), /Невідомий район/);
  s.mk(99);
  assert.throws(() => s.call(99, 'war/attack', { district: 'podil' }), /Вступи в автоклуб/);
  s.call(20, 'club/role', { userId: 21, role: 'officer' });
  const r = s.call(21, 'war/attack', { district: 'podil' });
  assert.equal(r.war.my.target, 'podil');
  assert.match(r.war.my.cant, /уже оголосив/);
  assert.throws(() => s.call(20, 'war/attack', { district: 'obolon' }), /уже оголосив/);
  assert.match(s.events(22), /атаку .* на Поділ/);
  // an own district
  s.hold('pechersk', small);
  s.mk(12); s.call(12, 'club/join', { id: small });
  assert.throws(() => s.call(10, 'war/attack', { district: 'pechersk' }), /уже твого клубу/);
  s.call(10, 'war/attack', { district: 'darnytsia' });
  assert.equal(s.call(10, 'war').my.target, 'darnytsia');
  assert.ok(A);
});

// ---------- scoring, defence, settle ----------
test('settle at Monday 00:00 Kyiv, once: defence = points ÷ districts held, ties keep the holder, free districts to the top attacker > 0', () => {
  const s = setup();
  const A = s.club(10, 'АААА', [11, 12]), B = s.club(20, 'BBBB', [21, 22]), C = s.club(30, 'CCCC', [31, 32]), D = s.club(40, 'DDDD', [41, 42]);
  s.hold('podil', A);
  s.hold('obolon', A);
  s.setPts(A, 10, 10); // defence 10 ÷ 2 = 5 in each district
  s.setPts(B, 20, 6);
  s.setPts(C, 30, 5);
  s.setPts(D, 40, 0);
  s.call(20, 'war/attack', { district: 'podil' }); // 6 > 5 → B captures
  s.call(30, 'war/attack', { district: 'obolon' }); // 5 = 5 → A keeps
  s.call(40, 'war/attack', { district: 'pechersk' }); // free, but 0 points → stays free
  const v = s.call(10, 'war');
  const podil = v.districts.find((d) => d.id === 'podil');
  assert.equal(podil.holder.defence, 5);
  assert.deepEqual(podil.attackers.map((a) => [a.tag, a.score]), [['BBBB', 6]]);
  assert.ok(v.endsAt === MON, 'the countdown ends at Monday 00:00 Kyiv');
  s.set(MON - 60e3);
  s.call(10, 'me');
  assert.equal(s.holder('podil'), A, 'nothing settles before Monday');
  const tA = s.treasury(A);
  s.set(MON + 1000);
  s.call(10, 'me');
  s.call(20, 'me');
  s.g.sweep?.();
  assert.equal(s.holder('podil'), B);
  assert.equal(s.holder('obolon'), A);
  assert.equal(s.holder('pechersk'), null);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM war_rounds WHERE week = ?').get(weekOf(MON - 1)).n, 1);
  // treasury: one district each, paid once with a club_log row
  assert.equal(s.treasury(A) - tA, 5_000_000);
  assert.equal(s.treasury(B), 5_000_000);
  assert.equal(s.treasury(C), 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM club_log WHERE kind = 'war' AND club_id = ?").get(B).n, 1);
  for (let i = 0; i < 5; i++) (s.add(H), s.call(10, 'me'), s.call(10, 'war'));
  assert.equal(s.treasury(B), 5_000_000, 'paid exactly once');
  // messages
  assert.match(s.events(21), /🏴 Ваш клуб захопив Поділ!/);
  assert.match(s.events(11), /💥 Ваш клуб втратив Поділ/);
  assert.match(s.events(11), /🛡 Ваш клуб відстояв Оболонь/);
  assert.match(s.events(31), /Атака на Оболонь не вдалася/);
  // the new round: a new attack is allowed, the last result is shown
  const v2 = s.call(20, 'war');
  assert.equal(v2.my.target, null);
  assert.equal(v2.my.cant, null);
  assert.deepEqual(v2.my.holds, ['podil']);
  assert.equal(v2.last.districts.find((d) => d.id === 'podil').kind, 'captured');
  // the group summary text
  const txt = warRoundText(v2.last);
  assert.match(txt, /Поділ — <b>\[BBBB\] Клуб BBBB<\/b> захопив у <b>\[АААА\]/);
  assert.match(txt, /Оболонь — <b>\[АААА\] Клуб АААА<\/b> відстояв/);
});

test('settle: a free district goes to the top attacker (> 0); a club holding many districts defends each with a share', () => {
  const s = setup();
  const A = s.club(10, 'АААА', [11, 12]), B = s.club(20, 'BBBB', [21, 22]), C = s.club(30, 'CCCC', [31, 32]);
  for (const d of ['podil', 'obolon', 'pechersk', 'darnytsia']) s.hold(d, A);
  s.setPts(A, 10, 20); // 20 ÷ 4 = 5
  s.setPts(B, 20, 7);
  s.setPts(C, 30, 3);
  s.call(20, 'war/attack', { district: 'darnytsia' });
  s.call(30, 'war/attack', { district: 'pozniaky' });
  assert.equal(s.call(10, 'war').districts.find((d) => d.id === 'darnytsia').holder.defence, 5);
  s.set(MON + 1);
  s.call(10, 'me');
  assert.equal(s.holder('darnytsia'), B, 'one big club can\'t hold the whole city: 7 beats 20 ÷ 4');
  assert.equal(s.holder('pozniaky'), C);
  assert.equal(s.treasury(A), 3 * 5_000_000);
});

test('admin force-settle: owner/admin only, with confirm; closes the round now, later attacks form the next round', () => {
  const s = setup();
  const B = s.club(20, 'BBBB', [21, 22]);
  s.setPts(B, 20, 4);
  s.call(20, 'war/attack', { district: 'podil' });
  s.mk(50);
  s.db.prepare("UPDATE users SET role = 'helper' WHERE id = 50").run();
  assert.throws(() => s.admin('war/settle', {}, 'tg:50'), /Немає прав/);
  assert.throws(() => s.admin('war/settle', {}, 'tg:21'), /Немає прав/);
  assert.throws(() => s.g.adminCall('tg:1', 'war/settle', { reason: 'тест' }), /не підтверджено/);
  const r = s.admin('war/settle');
  assert.equal(r.ok, true);
  assert.equal(s.holder('podil'), B);
  assert.equal(s.treasury(B), 5_000_000);
  // a new attack is possible in the same week (next round); Monday settles that round, once
  s.mk(23); s.call(23, 'club/join', { id: B });
  s.call(20, 'war/attack', { district: 'obolon' });
  s.set(MON + 1);
  s.call(20, 'me');
  s.call(20, 'me');
  assert.equal(s.holder('obolon'), B);
  assert.equal(s.treasury(B), 5_000_000 + 2 * 5_000_000);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM war_rounds WHERE forced = 0 AND week = ?').get(weekOf(MON - 1)).n, 1);
});

test('+15 % business income: only members of a holding club (24 h after joining), boxes banked when it switches; a disbanded club frees its districts', () => {
  const s = setup();
  const A = s.club(10, 'АААА', [11, 12]);
  s.mk(30);
  for (const u of [10, 30]) s.call(u, 'biz/buy', { id: 'wash' });
  const rate = (u) => s.call(u, 'biz').list.find((b) => b.id === 'wash').rate;
  const base = rate(30);
  assert.equal(rate(10), base);
  s.hold('podil', A);
  s.hold('obolon', A); // two districts: still one bonus
  assert.equal(rate(10), Math.round(base * 1.15));
  assert.equal(s.call(10, 'biz').district, 0.15);
  assert.equal(rate(30), base, 'not a member');
  assert.equal(s.call(10, 'war').my.bonus, true);
  // a new member: after 24 h
  s.call(30, 'club/join', { id: A });
  assert.equal(rate(30), base);
  s.add(25 * H);
  assert.equal(rate(30), Math.round(base * 1.15));
  // leaving banks the box at the bonus rate, then the bonus is gone
  const before = s.call(30, 'biz').list.find((b) => b.id === 'wash').box;
  s.call(30, 'club/leave');
  assert.equal(rate(30), base);
  assert.ok(s.call(30, 'biz').list.find((b) => b.id === 'wash').box >= before, 'the banked box is kept');
  // disband: the districts are free
  for (const u of [11, 12]) s.call(10, 'club/kick', { userId: u });
  s.call(10, 'club/leave');
  assert.equal(s.holder('podil'), null);
  assert.equal(rate(10), base);
});
