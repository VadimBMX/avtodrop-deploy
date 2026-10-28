// Ghosts on the «Заїзд дня» board (public/dayrace.js DAYRACE.ghosts, src/dayrace.js ghostsOf) and the clubs' weekly
// goal (public/clubs.js CLUB.goal, src/clubs.js). Ghosts are targets only: never stored, never ranked, never paid,
// not in the field size, friends board, club points or captions. The goal pays a key to each member with a win of his
// own, once, at the Monday settlement; its target follows the members and is never lowered by kicks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, dayOf } from '../src/game.js';
import * as S from '../public/shared.js';
import * as D from '../public/dayrace.js';
import * as C from '../public/clubs.js';
import { honestDrag } from './race-helpers.js';

const T0 = Date.parse('2026-10-22T09:00:00Z'); // 12:00 in Kyiv
const TODAY = dayOf(T0), YDAY = D.addDays(TODAY, -1);
const G = D.DAYRACE.ghosts;

function setup({ t0 = T0 } = {}) {
  let t = t0;
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, admins: [1] });
  const mk = (id, level = 12) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = 1e9, slots = 40 WHERE id = ?').run(level, level, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const owner = (name, body) => g.adminCall('tg:1', name, { reason: 'тест', confirm: true, ...body });
  const run = (uid, react = 0.2, qs = ['good', 'good', 'good', 'good']) => {
    const st = call(uid, 'dayrace/start');
    const r = honestDrag(st.car, st.greenMs, react, qs);
    t += r.ms + 30;
    const res = call(uid, 'race/finish', { raceId: st.raceId, ...r.body });
    t += 61e3;
    return { st, res };
  };
  const put = (uid, day, time, model = D.scheduledCar(day)) => db.prepare('INSERT INTO dayrace_best (day, user_id, model, time, at) VALUES (?, ?, ?, ?, ?)').run(day, uid, model, time, t - 1000 + uid);
  const keys = (uid, c) => db.prepare('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, c)?.count || 0;
  return { db, g, mk, call, owner, run, put, keys, add: (ms) => (t += ms), set: (x) => (t = x), at: () => t };
}
const sameClass = (model) => Object.keys(S.MODELS).find((id) => id !== model && !S.MODELS[id].secret && S.MODELS[id].cls === S.MODELS[model].cls);
const otherClass = (model) => Object.keys(S.MODELS).find((id) => !S.MODELS[id].secret && S.MODELS[id].cls !== S.MODELS[model].cls);

// ---------- ghosts ----------
test('ghosts: an empty board shows 5 marked driver-model ghosts, sorted, the same all day; the board itself stays empty', () => {
  const s = setup();
  s.mk(5);
  const v = s.call(5, 'dayrace');
  assert.equal(v.total, 0);
  assert.deepEqual(v.board, []);
  assert.equal(v.ghosts.length, G.n);
  for (const x of v.ghosts) {
    assert.equal(x.ghost, true);
    assert.equal(x.src, 'ai');
    assert.match(x.name, /^Привид · /);
    assert.equal(x.id, undefined, 'no player id: no card, no tag');
    assert.ok(x.time > v.car.base * 0.95 && x.time < v.car.base + 2, `${x.time} near the car's ${v.car.base}`);
  }
  assert.deepEqual(v.ghosts.map((x) => x.time), [...v.ghosts.map((x) => x.time)].sort((a, b) => a - b));
  assert.deepEqual(s.call(5, 'dayrace').ghosts, v.ghosts, 'stable within the day');
  assert.deepEqual(D.aiGhosts(TODAY, v.car.model), v.ghosts, 'the shared generator');
  assert.deepEqual(v.ghosts.map((x) => x.name.split(' · ')[1]), D.GHOST_DRIVERS.map((x) => x.label), 'labels follow the times');
  const me = s.call(5, 'me').dayRace;
  assert.equal(me.ghosts, G.n);
  assert.equal(me.ghostsBeaten, 0);
  assert.equal(me.total, 0);
});

test('ghosts: yesterday\'s real times on a car of the same class, anonymous and scaled; another class → the driver model', () => {
  const s = setup();
  for (const u of [1, 5, 6, 7, 8, 9, 10, 11, 12]) s.mk(u);
  const ym = D.scheduledCar(YDAY);
  [[6, 14.2], [7, 14.5], [8, 14.9], [9, 15.3], [10, 15.8], [11, 16.4], [12, 17.1]].forEach(([u, t]) => s.put(u, YDAY, t, ym));
  s.db.prepare('UPDATE dayrace_best SET dq = 1 WHERE user_id = 12').run(); // disqualified: not a ghost source
  const tm = sameClass(ym);
  s.owner('dayrace/set', { day: TODAY, model: tm });
  const v = s.call(5, 'dayrace');
  assert.equal(v.car.model, tm);
  const y = v.ghosts.filter((x) => x.src === 'yday');
  assert.equal(y.length, G.n, 'five of the six valid runs, spread best → slowest');
  assert.ok(y.every((x) => x.name === 'Привид · вчорашній заїзд'));
  const want = D.spread([14.2, 14.5, 14.9, 15.3, 15.8, 16.4], G.n).map((t) => D.scaleGhost(t, ym, tm)).sort((a, b) => a - b);
  assert.deepEqual(y.map((x) => x.time), want);
  const json = JSON.stringify(v.ghosts);
  for (const u of [6, 7, 8, 9, 10, 11]) assert.ok(!json.includes('U' + u), 'no names of yesterday\'s players');
  // Another class today: all from the driver model.
  const s2 = setup();
  for (const u of [1, 5, 6]) s2.mk(u);
  s2.put(6, YDAY, 14.2, ym);
  s2.owner('dayrace/set', { day: TODAY, model: otherClass(ym) });
  assert.ok(s2.call(5, 'dayrace').ghosts.every((x) => x.src === 'ai'));
  // Two runs yesterday (same class): two real ghosts + three from the model.
  const s3 = setup();
  for (const u of [1, 5, 6, 7]) s3.mk(u);
  s3.put(6, YDAY, 14.2, ym);
  s3.put(7, YDAY, 15.0, ym);
  s3.owner('dayrace/set', { day: TODAY, model: tm });
  const g3 = s3.call(5, 'dayrace').ghosts;
  assert.equal(g3.filter((x) => x.src === 'yday').length, 2);
  assert.equal(g3.filter((x) => x.src === 'ai').length, 3);
});

test('ghosts: a run says how many it beat; ghosts take no place, no field size, no prize; they leave at the 5th real time', () => {
  const s = setup();
  for (const u of [5, 6, 7, 8, 9, 10]) s.mk(u);
  const { res } = s.run(5, 0.12, ['perfect', 'perfect', 'perfect', 'perfect']);
  const dr = res.dayrace;
  assert.equal(dr.place, 1);
  assert.equal(dr.total, 1, 'the field is real players only');
  assert.equal(dr.ghosts.n, G.n);
  assert.equal(dr.ghosts.before, 0);
  assert.equal(dr.ghosts.beaten, D.ghostsBeaten(s.call(5, 'dayrace').ghosts, res.time));
  assert.ok(dr.ghosts.beaten >= 3, 'a perfect run beats most of them');
  const v = s.call(5, 'dayrace');
  assert.equal(v.board.length, 1);
  assert.equal(v.me.place, 1);
  assert.equal(v.topN, 0, 'no place prizes under 5 real finishers, ghosts or not');
  assert.equal(v.friends.list.some((r) => r.ghost), false);
  assert.equal(s.call(5, 'me').dayRace.ghostsBeaten, dr.ghosts.beaten);
  assert.match(s.call(5, 'dayrace/caption', { day: TODAY }).caption, /1-й з 1\b/, 'the caption counts players only');
  // Midnight: field 1, a fragment only (no top key, no podium) — the ghosts were never in it.
  s.set(T0 + 86400e3);
  s.call(5, 'me');
  const row = s.db.prepare('SELECT place, field, prize FROM dayrace_best WHERE day = ? AND user_id = 5').get(TODAY);
  assert.equal(row.place, 1);
  assert.equal(row.field, 1);
  assert.deepEqual(JSON.parse(row.prize), D.prizeOf(1, 1));
  assert.equal(JSON.parse(row.prize).podiumKey, undefined);
  assert.equal(s.db.prepare('SELECT total FROM dayrace_days WHERE day = ?').get(TODAY).total, 1);
  // Five real times today: no more ghosts.
  const day2 = dayOf(s.at());
  [6, 7, 8, 9].forEach((u, i) => s.put(u, day2, 13 + i));
  assert.equal(s.call(10, 'dayrace').ghosts.length, G.n, 'four real times: still there');
  s.put(10, day2, 17);
  assert.deepEqual(s.call(10, 'dayrace').ghosts, []);
  assert.equal(s.call(10, 'me').dayRace.ghosts, 0);
});

// ---------- the clubs' weekly goal ----------
const K = (x) => Date.parse(x + '+02:00');
const all = (q) => Array(S.SHIFTS).fill(q);
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
function clubOf(s, ownerId, tag, members) {
  const c = s.call(ownerId, 'club/create', { tag, name: 'Клуб ' + tag }).club;
  for (const m of members) s.call(m, 'club/join', { code: c.invite });
  s.add(25 * 3600e3);
  return c.id;
}

test('club goal: N scales with members (min..max); real wins count; the target never drops when members leave', () => {
  assert.equal(C.goalOf(1), C.CLUB.goal.min);
  assert.equal(C.goalOf(4), 4 * C.CLUB.goal.perMember);
  assert.equal(C.goalOf(20), C.CLUB.goal.max);
  const s = setup({ t0: K('2026-10-28T12:00:00') });
  for (const u of [1, 2, 3, 4]) s.mk(u);
  const cid = clubOf(s, 1, 'ЦІЛЬ', [2, 3, 4]);
  let g = s.call(1, 'club').club.goal;
  assert.deepEqual([g.target, g.wins, g.myWins, g.done], [C.goalOf(4), 0, 0, false]);
  const car = s.g.giveCar(1, 'vaz-2107').id;
  const r = winDrag(s, 1, car);
  assert.equal(r.clubPts, 1);
  g = s.call(1, 'club').club.goal;
  assert.equal(g.wins, 1);
  assert.equal(g.myWins, 1);
  assert.equal(s.call(2, 'club').club.goal.myWins, 0);
  s.call(1, 'club/kick', { userId: 4 });
  assert.equal(s.call(1, 'club').club.goal.target, C.goalOf(4), 'kicking does not lower the week\'s target');
  assert.equal(cid > 0, true);
});

test('club goal: at Monday 00:00 a key to each member with a win of his own, once; a missed goal pays nothing', () => {
  const s = setup({ t0: K('2026-10-28T12:00:00') });
  for (let u = 1; u <= 8; u++) s.mk(u);
  const a = clubOf(s, 1, 'АААА', [2, 3, 4]); // 4 members → target 60
  const b = clubOf(s, 5, 'ББББ', [6, 7]); // misses its goal
  const w = s.call(1, 'club').club.week;
  const put = (cid, uid, n) => s.db.prepare('INSERT OR REPLACE INTO club_wins (week, club_id, user_id, n) VALUES (?, ?, ?, ?)').run(w, cid, uid, n);
  put(a, 1, 40);
  put(a, 2, 15);
  put(a, 3, 5); // 4 has no win → no key
  put(b, 5, 10);
  put(b, 6, 3);
  s.call(1, 'club'); // writes the targets
  s.call(5, 'club');
  const key = C.CLUB.goal.caseId;
  const before = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((u) => [u, s.keys(u, key)]));
  assert.equal(s.call(1, 'club').club.goal.done, true);
  s.set(K('2026-11-02T00:00:30'));
  s.g.settleAuctions();
  for (const u of [1, 2, 3]) assert.equal(s.keys(u, key) - before[u], 1, 'member ' + u);
  assert.equal(s.keys(4, key), before[4], 'no own win, no key');
  for (const u of [5, 6, 7]) assert.equal(s.keys(u, key), before[u], 'goal missed');
  s.call(1, 'club');
  s.g.settleAuctions();
  assert.equal(s.keys(1, key) - before[1], 1, 'exactly once');
  const wk = s.owner('clubs').weeks[0];
  assert.deepEqual(wk.goals.map((x) => [x.tag, x.wins, x.target, x.paid]), [['АААА', 60, C.goalOf(4), 3]]);
  assert.equal(s.call(1, 'events').list.some((e) => /Ціль клубу/.test(e.text)), true);
  assert.equal(s.call(1, 'club').club.goal.wins, 0, 'the new week starts from zero');
});
