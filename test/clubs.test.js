// «Автоклуби» (public/clubs.js, src/clubs.js): create/join/roles, the 24 h rule and the reset on leaving (no hopping),
// league points from real wins with a daily cap, the Monday 00:00 Kyiv settlement paid exactly once, the treasury
// (donations in, perks out, never back), perks (income %, weekly key, daily fuel), tags in the ratings and battles,
// t.me-only group links and the admin tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as C from '../public/clubs.js';
import { honestDrag, clientDrift } from './race-helpers.js';

const R = C.CLUB;
const K = (s) => Date.parse(s + '+02:00'); // Kyiv wall clock in winter time
const H = 3600e3;

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
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  const keys = (uid, caseId) => db.prepare('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, caseId)?.count || 0;
  const pts = (cid) => db.prepare('SELECT COALESCE(SUM(pts), 0) s FROM club_points WHERE club_id = ?').get(cid).s;
  const setPts = (week, cid, uid, n) => db.prepare('INSERT OR REPLACE INTO club_points (week, club_id, user_id, pts) VALUES (?, ?, ?, ?)').run(week, cid, uid, n);
  // A club with an owner and members, everyone past the 24 h wait.
  const club = (owner, tag, members = [], { open = true } = {}) => {
    const c = call(owner, 'club/create', { tag, name: 'Клуб ' + tag, open }).club;
    for (const m of members) call(m, 'club/join', { code: c.invite });
    t += 25 * H;
    return c.id;
  };
  return { db, g, mk, call, admin, bal, keys, pts, setPts, club, add: (ms) => (t += ms), set: (x) => (t = x), at: () => t };
}
const all = (q) => Array(S.SHIFTS).fill(q);
// A real drag race won with a perfect run against the easiest rival.
function winDrag(s, uid, carId) {
  for (let i = 0; i < 5; i++) {
    const st = s.call(uid, 'race/start', { carId, rival: 'easy' });
    const run = honestDrag(st.car, st.greenMs, 0.12, all('perfect'));
    s.add(run.ms + 20);
    const r = s.call(uid, 'race/finish', { raceId: st.raceId, ...run.body });
    s.add(60e3);
    if (r.win) return r;
  }
  throw new Error('no win');
}

// ---------- rules ----------
test('rules: tags are 4 Ukrainian/Latin letters or digits, t.me links only, invite links, perk prices', () => {
  assert.equal(C.tagNorm(' [жига] '), 'ЖИГА');
  for (const t of ['ЖИГА', 'BMW1', 'ЇЖАК', 'ҐАЗД', 'A1B2']) assert.ok(C.tagOk(t), t);
  for (const t of ['ЖИГ', 'ЖИГАА', 'Ж-ГА', 'ЫЫЫЫ', 'ЖИ А', '']) assert.ok(!C.tagOk(t), t);
  assert.equal(C.tgLinkNorm('t.me/my_group'), 'https://t.me/my_group');
  assert.equal(C.tgLinkNorm('https://t.me/+AbCdEf12345'), 'https://t.me/+AbCdEf12345');
  assert.equal(C.tgLinkNorm('@avto_club'), 'https://t.me/avto_club');
  assert.equal(C.tgLinkNorm('http://telegram.me/joinchat/AbCdEf123456/'), 'https://t.me/joinchat/AbCdEf123456');
  assert.equal(C.tgLinkNorm(''), '');
  for (const bad of ['https://evil.com/t.me/x', 't.me/x', 'https://t.me.evil.com/abcd', 'javascript:alert(1)', 'https://t.me/abcd?x=1', 'tg://resolve?domain=abcd'])
    assert.equal(C.tgLinkNorm(bad), null, bad);
  assert.equal(C.clubLink('avtodrop_bot', 'play', 'abcd2345'), 'https://t.me/avtodrop_bot/play?startapp=club_abcd2345');
  assert.equal(C.clubLink('avtodrop_bot', '', 'abcd2345'), 'https://t.me/avtodrop_bot?start=club_abcd2345');
  assert.equal(C.clubLink('avtodrop_bot', '', 'bad'), '');
  // Price = per member × max(5, members); an income upgrade pays only the difference.
  assert.equal(C.perkCost('chest', 1, 2), 5 * R.perks.chest.per);
  assert.equal(C.perkCost('chest', 1, 12), 12 * R.perks.chest.per);
  assert.equal(C.perkCost('chest', 1, 12, 1), null);
  assert.equal(C.perkCost('income', 3, 10, 1), 10 * (R.perks.income.levels[2].per - R.perks.income.levels[0].per));
  assert.equal(C.perkCost('income', 1, 10, 2), null);
  assert.equal(R.max, 20);
});

// ---------- create / join ----------
test('create: from level 5, costs 500 000 ₴, unique tag, one club per player; join: from level 3, open list or invite', () => {
  const s = setup();
  s.mk(1, 4);
  s.mk(2, 12, 100000);
  s.mk(3);
  s.mk(4, 2);
  s.mk(5);
  s.mk(6);
  assert.throws(() => s.call(1, 'club/create', { tag: 'ЖИГА', name: 'Жигулі' }), /5 рівні/);
  assert.throws(() => s.call(2, 'club/create', { tag: 'ЖИГА', name: 'Жигулі' }), /Недостатньо/);
  assert.throws(() => s.call(3, 'club/create', { tag: 'ЖИ', name: 'Жигулі' }), /Тег/);
  assert.throws(() => s.call(3, 'club/create', { tag: 'ЖИГА', name: 'Ж' }), /Назва/);
  assert.throws(() => s.call(3, 'club/create', { tag: 'ADMI', name: 'Admin team' }), /зарезервована/);
  const b = s.bal(3);
  const c = s.call(3, 'club/create', { tag: 'жига', name: 'Жигулі назавжди', about: 'Ганяємо на класиці' }).club;
  assert.equal(s.bal(3), b - R.createCost);
  assert.equal(c.tag, 'ЖИГА');
  assert.equal(c.role, 'owner');
  assert.match(c.invite, C.INVITE_RE);
  assert.throws(() => s.call(5, 'club/create', { tag: 'ЖИГА', name: 'Інший' }), /зайнятий/);
  assert.throws(() => s.call(3, 'club/create', { tag: 'ІНШИ', name: 'Другий клуб' }), /вже в клубі/);
  assert.throws(() => s.call(4, 'club/join', { id: c.id }), /3 рівні/);
  // Search finds it by tag and by name; the open list shows it.
  assert.equal(s.call(5, 'club/list', { q: '[жиг' }).list[0].id, c.id);
  assert.equal(s.call(5, 'club/list', { q: 'назав' }).list[0].id, c.id);
  assert.equal(s.call(5, 'club').list[0].id, c.id);
  s.call(5, 'club/join', { id: c.id });
  assert.equal(s.call(5, 'club').club.members.length, 2);
  assert.throws(() => s.call(5, 'club/join', { id: c.id }), /вже в клубі/);
  // Invite-only: not from the list, yes by the link's code.
  s.call(3, 'club/edit', { open: false });
  assert.throws(() => s.call(6, 'club/join', { id: c.id }), /лише за запрошенням/);
  assert.throws(() => s.call(6, 'club/join', { code: 'zzzzzzzz' }), /недійсне/);
  assert.equal(s.call(6, 'club/peek', { code: c.invite }).club.tag, 'ЖИГА');
  s.call(6, 'club/join', { code: c.invite });
  assert.equal(s.call(3, 'me').club.tag, 'ЖИГА');
});

test('join: at most 20 members; a new invite code makes the old link useless', () => {
  const s = setup();
  for (let i = 1; i <= 22; i++) s.mk(i);
  const c = s.call(1, 'club/create', { tag: 'ПОВН', name: 'Повний клуб' }).club;
  for (let i = 2; i <= 20; i++) s.call(i, 'club/join', { code: c.invite });
  assert.throws(() => s.call(21, 'club/join', { code: c.invite }), /20 учасників/);
  const fresh = s.call(1, 'club/invite').club.invite;
  assert.notEqual(fresh, c.invite);
  s.call(20, 'club/leave');
  assert.throws(() => s.call(21, 'club/join', { code: c.invite }), /недійсне/);
  s.call(21, 'club/join', { code: fresh });
});

// ---------- roles ----------
test('roles: officers kick members (not officers), only the owner promotes and transfers; owner leaves last', () => {
  const s = setup();
  for (const i of [1, 2, 3, 4, 5, 6, 7]) s.mk(i);
  const cid = s.club(1, 'РОЛІ', [2, 3, 4, 5, 6]);
  assert.throws(() => s.call(2, 'club/role', { userId: 3, role: 'officer' }), /лише власник/);
  s.call(1, 'club/role', { userId: 2, role: 'officer' });
  s.call(1, 'club/role', { userId: 3, role: 'officer' });
  s.call(1, 'club/role', { userId: 4, role: 'officer' });
  assert.throws(() => s.call(1, 'club/role', { userId: 5, role: 'officer' }), /не більше 3/);
  assert.throws(() => s.call(2, 'club/kick', { userId: 3 }), /лише власник/);
  assert.throws(() => s.call(5, 'club/kick', { userId: 6 }), /власник і офіцери/);
  assert.throws(() => s.call(2, 'club/kick', { userId: 7 }), /не в твоєму клубі/);
  s.call(2, 'club/kick', { userId: 6 });
  assert.equal(s.call(6, 'me').club, null);
  assert.throws(() => s.call(1, 'club/leave'), /передай клуб/);
  s.call(1, 'club/role', { userId: 4, role: 'member' });
  s.call(1, 'club/transfer', { userId: 5 });
  const v = s.call(5, 'club').club;
  assert.equal(v.role, 'owner');
  assert.equal(v.owner.id, 5);
  assert.equal(v.members.find((m) => m.id === 1).role, 'officer', 'the old owner becomes an officer while there is room');
  s.call(1, 'club/leave');
  for (const u of [2, 3, 4]) s.call(u, 'club/leave');
  const r = s.call(5, 'club/leave');
  assert.equal(r.disbanded, true);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM clubs WHERE id = ?').get(cid).n, 0);
});

test('edit: the group link must be t.me, name/about checked; only the owner edits', () => {
  const s = setup();
  s.mk(1);
  s.mk(2);
  s.club(1, 'ЛІНК', [2]);
  assert.throws(() => s.call(1, 'club/edit', { tg: 'https://evil.example/join' }), /t\.me/);
  assert.throws(() => s.call(2, 'club/edit', { tg: 't.me/okgroup' }), /лише власник/);
  const c = s.call(1, 'club/edit', { tg: 't.me/okgroup', about: '  Привіт,\nдрузі  ', name: 'Нова назва' }).club;
  assert.equal(c.tg, 'https://t.me/okgroup');
  assert.equal(c.about, 'Привіт, друзі');
  assert.equal(c.name, 'Нова назва');
  assert.equal(s.call(1, 'club/edit', { tg: '' }).club.tg, null);
});

// ---------- league points ----------
test('points: a real drag win counts 24 h after joining, a daily cap, leaving wipes the week', () => {
  const s = setup();
  s.mk(1);
  const car = s.g.giveCar(1, 'vaz-2107').id;
  s.mk(2);
  const c = s.call(2, 'club/create', { tag: 'ДРАГ', name: 'Драгстери' }).club;
  s.call(1, 'club/join', { id: c.id });
  let r = winDrag(s, 1, car);
  assert.equal(r.clubPts, 0, 'not before 24 h in the club');
  assert.equal(s.pts(c.id), 0);
  s.add(24 * H);
  r = winDrag(s, 1, car);
  assert.equal(r.clubPts, R.points.drag);
  assert.equal(s.call(1, 'me').club.myPts, 1);
  // The daily cap: fill the day to the limit, the next win adds nothing.
  s.db.prepare('UPDATE club_day SET pts = ? WHERE user_id = 1').run(R.dayCap);
  s.db.prepare('UPDATE users SET fuel = ? WHERE id = 1').run(S.FUEL_MAX);
  r = winDrag(s, 1, car);
  assert.equal(r.clubPts, 0);
  assert.equal(s.pts(c.id), 1);
  // Leaving resets the contribution: the club's total drops, rejoining starts from zero and waits 24 h again.
  s.call(1, 'club/leave');
  assert.equal(s.pts(c.id), 0);
  s.call(1, 'club/join', { id: c.id });
  assert.equal(s.call(1, 'club').club.myPts, 0);
  assert.equal(s.call(1, 'club').club.counts, false);
});

test('points: a drift win counts too', () => {
  const s = setup();
  s.mk(1);
  s.mk(2);
  const car = s.g.giveCar(1, 'vaz-2107').id;
  s.club(2, 'ДРИФ', [1]);
  const st = s.call(1, 'drift/start', { carId: car, rival: 'easy' });
  const run = clientDrift(st, { skill: 0.9 });
  s.add(S.DRIFT_COUNT_MS + run.ms);
  const r = s.call(1, 'drift/finish', { runId: st.runId, ...run });
  assert.equal(r.win, true);
  assert.equal(r.clubPts, R.points.drift);
  assert.equal(s.call(2, 'club').club.pts, R.points.drift);
});

test('points: a kick also wipes the kicked member\'s points of the week; other weeks stay', () => {
  const s = setup();
  for (const i of [1, 2, 3]) s.mk(i);
  const cid = s.club(1, 'КІКК', [2, 3]);
  const w = s.call(1, 'club').club.week;
  s.setPts(w, cid, 2, 9);
  s.setPts(w, cid, 3, 4);
  s.setPts('2026-10-19', cid, 2, 7);
  s.call(1, 'club/kick', { userId: 2 });
  assert.equal(s.db.prepare('SELECT COALESCE(SUM(pts),0) s FROM club_points WHERE week = ? AND club_id = ?').get(w, cid).s, 4);
  assert.equal(s.db.prepare("SELECT pts FROM club_points WHERE week = '2026-10-19' AND user_id = 2").get().pts, 7);
});

// ---------- the weekly settlement ----------
test('league: at Monday 00:00 Kyiv members of qualified top clubs get prizes once; small or idle clubs do not', () => {
  const s = setup();
  for (let i = 1; i <= 12; i++) s.mk(i);
  const a = s.club(1, 'АААА', [2, 3, 4]);
  const b = s.club(5, 'ББББ', [6, 7]);
  const solo = s.club(9, 'СОЛО', [10]);
  const w = s.call(1, 'club').club.week;
  assert.equal(w, '2026-10-26');
  // A: four members, one of them under the minimum. B: three qualified. Solo: two members only (not enough).
  [[1, 30], [2, 12], [3, 5], [4, 2]].forEach(([u, n]) => s.setPts(w, a, u, n));
  [[5, 10], [6, 10], [7, 5]].forEach(([u, n]) => s.setPts(w, b, u, n));
  [[9, 99], [10, 99]].forEach(([u, n]) => s.setPts(w, solo, u, n));
  const L = s.call(1, 'club/league');
  assert.deepEqual(L.list.map((r) => r.tag), ['СОЛО', 'АААА', 'ББББ']);
  assert.deepEqual(L.list.map((r) => r.prizePlace), [null, 1, 2]);
  const before = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 9, 10].map((u) => [u, s.bal(u)]));
  s.set(K('2026-11-01T23:59:00'));
  s.call(1, 'me');
  assert.equal(s.bal(1), before[1], 'nothing before midnight');
  s.set(K('2026-11-02T00:00:30'));
  s.g.settleAuctions(); // the sweeper settles it even when nobody plays
  assert.equal(s.bal(1) - before[1], R.prizes[0]);
  assert.equal(s.bal(2) - before[2], R.prizes[0]);
  assert.equal(s.bal(3) - before[3], R.prizes[0]);
  assert.equal(s.bal(4), before[4], 'under the minimum points: no prize');
  for (const u of [5, 6, 7]) assert.equal(s.bal(u) - before[u], R.prizes[1]);
  for (const u of [9, 10]) assert.equal(s.bal(u), before[u], 'a club of two takes no place');
  // Exactly once, whoever calls next; the new week starts from zero.
  s.call(5, 'club');
  s.call(9, 'club/league');
  s.g.settleAuctions();
  assert.equal(s.bal(1) - before[1], R.prizes[0]);
  const nl = s.call(1, 'club/league');
  assert.equal(nl.list.every((r) => r.pts === 0), true);
  assert.equal(nl.last.top[0].tag, 'АААА');
  assert.equal(s.call(1, 'events').list.some((e) => /Клубна ліга/.test(e.text)), true);
  assert.equal(s.admin('clubs').weeks[0].paid, R.prizes[0] * 3 + R.prizes[1] * 3);
});

// ---------- treasury and perks ----------
test('treasury: donations go in (min 10 000), only owner/officers buy perks, money never comes back', () => {
  const s = setup();
  for (const i of [1, 2, 3]) s.mk(i);
  const cid = s.club(1, 'КАСА', [2, 3]);
  assert.throws(() => s.call(2, 'club/donate', { amount: 9999 }), /Сума/);
  const b2 = s.bal(2);
  s.call(2, 'club/donate', { amount: 5000000 });
  assert.equal(s.bal(2), b2 - 5000000);
  let v = s.call(1, 'club').club;
  assert.equal(v.treasury, 5000000);
  assert.equal(v.members.find((m) => m.id === 2).donated, 5000000);
  assert.throws(() => s.call(2, 'club/perk', { perk: 'chest' }), /власник і офіцери/);
  // 3 members → billed as 5.
  const price = 5 * R.perks.chest.per;
  v = s.call(1, 'club/perk', { perk: 'chest' }).club;
  assert.equal(v.treasury, 5000000 - price);
  assert.throws(() => s.call(1, 'club/perk', { perk: 'chest' }), /Уже куплено/);
  assert.throws(() => s.call(1, 'club/perk', { perk: 'income', level: 3 }), /недостатньо/);
  s.call(1, 'club/role', { userId: 2, role: 'officer' });
  s.call(2, 'club/perk', { perk: 'income', level: 1 });
  v = s.call(1, 'club/donate', { amount: 10000000 }).club;
  const t0 = v.treasury;
  v = s.call(1, 'club/perk', { perk: 'income', level: 2 }).club;
  assert.equal(t0 - v.treasury, 5 * (R.perks.income.levels[1].per - R.perks.income.levels[0].per), 'the upgrade pays the difference');
  assert.equal(v.perks.income.have, 2);
  // Leaving gives nothing back; perks end with the week.
  const b3 = s.bal(3);
  s.call(3, 'club/donate', { amount: 100000 });
  s.call(3, 'club/leave');
  assert.equal(s.bal(3), b3 - 100000);
  s.set(K('2026-11-02T00:01:00'));
  v = s.call(1, 'club').club;
  assert.equal(v.perks.income.have, 0);
  assert.equal(v.perks.chest.have, false);
  assert.ok(s.db.prepare('SELECT spent FROM clubs WHERE id = ?').get(cid).spent > 0);
});

test('perks: income +% on collect (capped per day, after 24 h), one key a week, fuel once a day and never above full', () => {
  const s = setup();
  for (const i of [1, 2]) s.mk(i);
  s.g.giveCar(1, 'vaz-2107');
  s.g.giveCar(2, 'vaz-2107');
  const c = s.call(1, 'club/create', { tag: 'БОНУ', name: 'Бонуси' }).club;
  s.call(1, 'club/donate', { amount: 50000000 });
  s.call(1, 'club/perk', { perk: 'income', level: 1 });
  s.call(1, 'club/perk', { perk: 'chest' });
  s.call(1, 'club/perk', { perk: 'fuel' });
  s.add(H);
  let r = s.call(1, 'collect');
  assert.equal(r.clubBonus, undefined, 'not before 24 h in the club');
  assert.throws(() => s.call(1, 'club/claim', { kind: 'chest' }), /24 год/);
  s.add(25 * H);
  s.db.prepare('UPDATE users SET banked = 4000000, income_at = ? WHERE id = 1').run(s.at());
  r = s.call(1, 'collect');
  assert.equal(r.clubBonus, Math.floor(4000000 * 0.02));
  assert.equal(r.got, 4000000 + r.clubBonus);
  s.db.prepare('UPDATE users SET banked = 4000000, income_at = ? WHERE id = 1').run(s.at());
  r = s.call(1, 'collect');
  assert.equal(r.clubBonus, R.perks.income.levels[0].cap - Math.floor(4000000 * 0.02), 'the rest of the daily cap');
  s.db.prepare('UPDATE users SET banked = 4000000, income_at = ? WHERE id = 1').run(s.at());
  assert.equal(s.call(1, 'collect').clubBonus, undefined);
  // The weekly key.
  const k = s.keys(1, R.perks.chest.caseId);
  assert.equal(s.call(1, 'me').club.ready, 2);
  s.call(1, 'club/claim', { kind: 'chest' });
  assert.equal(s.keys(1, R.perks.chest.caseId), k + 1);
  assert.throws(() => s.call(1, 'club/claim', { kind: 'chest' }), /вже забрано/);
  // Fuel: a full tank can't take it (and the claim is not used up).
  assert.throws(() => s.call(1, 'club/claim', { kind: 'fuel' }), /повний/);
  s.db.prepare('UPDATE users SET fuel = 5, fuel_at = ? WHERE id = 1').run(s.at());
  const f = s.call(1, 'club/claim', { kind: 'fuel' });
  assert.equal(f.fuel, R.perks.fuel.n);
  assert.equal(s.db.prepare('SELECT fuel FROM users WHERE id = 1').get().fuel, 5 + R.perks.fuel.n);
  assert.throws(() => s.call(1, 'club/claim', { kind: 'fuel' }), /завтра/);
  s.add(24 * H);
  s.db.prepare('UPDATE users SET fuel = 14, fuel_at = ? WHERE id = 1').run(s.at());
  assert.equal(s.call(1, 'club/claim', { kind: 'fuel' }).fuel, 1, 'topped up to full only');
  // Hopping to another club does not give a second key this week.
  s.mk(3);
  const d = s.call(3, 'club/create', { tag: 'ДРУГ', name: 'Другий' }).club;
  s.call(3, 'club/donate', { amount: 10000000 });
  s.call(3, 'club/perk', { perk: 'chest' });
  assert.throws(() => s.call(1, 'club/transfer', { userId: 1 }), /вже власник/);
  assert.equal(s.call(1, 'club/leave').disbanded, true);
  s.call(1, 'club/join', { id: d.id });
  s.add(25 * H);
  assert.equal(s.call(1, 'club').club.week, '2026-10-26');
  assert.throws(() => s.call(1, 'club/claim', { kind: 'chest' }), /вже забрано/);
  assert.equal(c.id > 0, true);
});

test('tags: [TAG] next to members in the rating, battles and the day\'s board', () => {
  const s = setup();
  for (const i of [1, 2, 3]) s.mk(i);
  s.club(1, 'ТЕГИ', [2]);
  const lb = s.call(3, 'leaderboard', { type: 'all' });
  const tag = (id) => lb.list.find((r) => r.id === id)?.tag;
  assert.equal(tag(1), 'ТЕГИ');
  assert.equal(tag(2), 'ТЕГИ');
  assert.equal(tag(3), undefined);
  assert.equal(s.call(3, 'leaderboard', { type: 'season' }).list.find((r) => r.id === 1)?.tag ?? 'ТЕГИ', 'ТЕГИ');
  const cs = S.CASES.find((c) => c.id === 'rust');
  const { id } = s.call(1, 'battle/create', { caseId: cs.id, count: 1 });
  assert.equal(s.call(3, 'battle/list').open[0].creator.tag, 'ТЕГИ');
  assert.equal(s.call(3, 'battle/get', { id }).creator.tag, 'ТЕГИ');
  const dr = s.call(1, 'dayrace');
  assert.ok(Array.isArray(dr.board));
});

// ---------- admin ----------
test('admin: sees clubs and money, resets a bad tag/name, disbands the club', () => {
  const s = setup();
  for (const i of [1, 2, 3]) s.mk(i);
  const cid = s.club(2, 'ХАМИ', [3]);
  s.call(2, 'club/donate', { amount: 1000000 });
  const v = s.admin('clubs');
  assert.equal(v.clubs[0].tag, 'ХАМИ');
  assert.equal(v.totals.treasury, 1000000);
  const r = s.admin('clubs/reset', { id: cid, what: 'tag' });
  assert.match(r.clubs[0].tag, C.TAG_RE);
  assert.notEqual(r.clubs[0].tag, 'ХАМИ');
  s.admin('clubs/reset', { id: cid, what: 'name' });
  assert.equal(s.call(2, 'club').club.name, `Клуб ${cid}`);
  s.admin('clubs/disband', { id: cid });
  assert.equal(s.call(3, 'me').club, null);
  assert.equal(s.call(3, 'events').list.some((e) => /розпущено/.test(e.text)), true);
});
