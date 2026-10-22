// «Заїзд дня» (public/dayrace.js rules, src/dayrace.js server): the car of a day, three attempts, the drag replay of
// race/finish, the board and its ties, the friends board, the midnight prizes (exactly once) and the 19:00 reminder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, dayOf } from '../src/game.js';
import { pickReminder, PUSH } from '../src/reminders.js';
import * as S from '../public/shared.js';
import * as D from '../public/dayrace.js';
import { honestDrag, clientDrag } from './race-helpers.js';

const T0 = Date.parse('2026-10-22T09:00:00Z'); // 12:00 in Kyiv
function setup({ t0 = T0, db = openDb(':memory:') } = {}) {
  let t = t0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, admins: [1] });
  const mk = (id, { level = 3, ref = null, name = 'U' + id } = {}) => {
    g.ensureUser({ id, first_name: name }, ref ? 'ref_' + ref : '');
    db.prepare('UPDATE users SET level = ?, level_seen = ? WHERE id = ?').run(level, level, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const owner = (name, body) => g.adminCall('tg:1', name, { reason: 'тест', confirm: true, ...body });
  // A whole run as the app drives it: start, honest taps, finish after the run's real time.
  const run = (uid, react = 0.2, qs = ['good', 'good', 'good', 'good']) => {
    const st = call(uid, 'dayrace/start');
    const r = honestDrag(st.car, st.greenMs, react, qs);
    t += r.ms + 30;
    const res = call(uid, 'race/finish', { raceId: st.raceId, ...r.body });
    t += 61e3; // past the anti-bot start limit
    return { st, res, run: r };
  };
  const put = (uid, day, time, at) => db.prepare('INSERT INTO dayrace_best (day, user_id, model, time, at) VALUES (?, ?, ?, ?, ?)').run(day, uid, D.scheduledCar(day), time, at);
  const keys = (uid, c) => db.prepare('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, c)?.count || 0;
  const frags = (uid, c) => db.prepare('SELECT count FROM fragments WHERE user_id = ? AND case_id = ?').get(uid, c)?.count || 0;
  return { db, g, mk, call, owner, run, put, keys, frags, at: () => t, set: (x) => (t = x), add: (ms) => (t += ms) };
}
const TODAY = dayOf(T0);

// ---------- the car of a day ----------
test('daily car: deterministic, every car once per cycle, never the same two days in a row', () => {
  assert.ok(D.CARS.length >= 28 && D.CARS.length <= 36, 'about 30 curated cars');
  assert.equal(new Set(D.CARS).size, D.CARS.length);
  const classes = new Set(D.CARS.map((id) => S.MODELS[id].cls)), countries = new Set(D.CARS.map((id) => S.MODELS[id].country));
  assert.ok(classes.size >= 5 && countries.size >= 6, 'across classes and countries');
  assert.equal(D.scheduledCar('2026-10-22'), D.scheduledCar('2026-10-22'));
  const n = D.CARS.length;
  // Days of three whole cycles: each cycle holds every car exactly once.
  const first = Math.ceil(Date.parse('2026-10-22T00:00:00Z') / 86400e3 / n) * n;
  const days = Array.from({ length: n * 3 + 1 }, (_, i) => new Date((first + i) * 86400e3).toISOString().slice(0, 10));
  for (let c = 0; c < 3; c++) assert.deepEqual(days.slice(c * n, c * n + n).map((d) => D.scheduledCar(d)).sort(), [...D.CARS].sort());
  for (let i = 1; i < days.length; i++) assert.notEqual(D.scheduledCar(days[i]), D.scheduledCar(days[i - 1]), days[i]);
  // Over a year: no repeat on consecutive days anywhere.
  for (let i = 1; i < 400; i++) assert.notEqual(D.scheduledCar(D.addDays('2026-10-22', i)), D.scheduledCar(D.addDays('2026-10-22', i - 1)));
  // The server and the screen agree, and the car is stock: the day's base time is the model's own.
  const { mk, call } = setup();
  mk(5);
  const v = call(5, 'dayrace');
  assert.equal(v.day, TODAY);
  assert.equal(v.car.model, D.scheduledCar(TODAY));
  assert.equal(v.car.base, S.carStats({ model: v.car.model }).base);
  assert.equal(v.car.shift, 0);
  assert.equal(call(5, 'me').dayRace.model, v.car.model);
});

test('daily car: admin picks future days, today only while nobody has started; today stays frozen', () => {
  const { mk, call, owner, g, db, run } = setup();
  mk(5);
  mk(6);
  const tomorrow = D.addDays(TODAY, 1);
  assert.throws(() => g.adminCall('tg:5', 'dayrace/set', { day: tomorrow, model: 'ferrari-f40', reason: 'тест', confirm: true }), /Немає прав/);
  assert.throws(() => owner('dayrace/set', { day: tomorrow, model: 'ferrari-f40', confirm: false }), /не підтверджено/);
  assert.throws(() => owner('dayrace/set', { day: D.addDays(TODAY, -1), model: 'ferrari-f40' }), /від сьогодні/);
  assert.throws(() => owner('dayrace/set', { day: tomorrow, model: 'nope' }), /Невідома модель/);
  owner('dayrace/set', { day: tomorrow, model: 'ferrari-f40' });
  assert.equal(owner('dayrace').schedule[1].model, 'ferrari-f40');
  assert.ok(owner('dayrace').schedule[1].by);
  // Today: allowed before the first start, refused after it.
  owner('dayrace/set', { day: TODAY, model: 'lexus-lfa' });
  assert.equal(call(5, 'dayrace').car.model, 'lexus-lfa');
  run(5);
  assert.throws(() => owner('dayrace/set', { day: TODAY, model: 'ferrari-f40' }), /вже є заїзди/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_log WHERE action = 'dayrace-set'").get().n, 2);
  // Frozen: the day's car is written down at first use, so a changed schedule can't swap it mid-day.
  const ov = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'dayrace_cars'").get().value);
  assert.equal(ov[TODAY].model, 'lexus-lfa');
  owner('dayrace/set', { day: tomorrow, model: null });
  assert.equal(owner('dayrace').schedule[1].model, D.scheduledCar(tomorrow));
});

// ---------- attempts ----------
test('attempts: three free runs a day (counted at the start, no fuel, no money), the fourth is refused; a new day gives three more', () => {
  const { mk, call, run, db, add, at, set } = setup();
  mk(5);
  const before = db.prepare('SELECT balance, fuel FROM users WHERE id = 5').get();
  run(5);
  // An abandoned run (started, never finished) still uses its attempt.
  call(5, 'dayrace/start');
  add(61e3);
  const third = run(5);
  assert.deepEqual(third.res.dayrace.attempts, { used: 3, left: 0, max: 3 });
  assert.throws(() => call(5, 'dayrace/start'), /Спроби на сьогодні закінчились/);
  const after = db.prepare('SELECT balance, fuel FROM users WHERE id = 5').get();
  assert.deepEqual(after, before, 'no fuel and no money');
  assert.equal(call(5, 'me').dayRace.left, 0);
  // Next Kyiv day.
  set(Date.parse(D.addDays(TODAY, 1) + 'T09:00:00Z'));
  assert.equal(call(5, 'dayrace').attempts.left, 3);
  assert.equal(run(5).res.dayrace.attempts.left, 2);
  assert.ok(at() > T0);
});

test('unlock: level 2; a level-1 player is refused with the level, the tile is off; staff and level 2 can race', () => {
  const { mk, call, db } = setup();
  mk(5, { level: 1 });
  assert.throws(() => call(5, 'dayrace/start'), /відкриється на рівні 2/);
  assert.equal(call(5, 'me').dayRace, null);
  assert.ok(!call(5, 'me').unlocked.includes('dayrace'));
  db.prepare('UPDATE users SET level = 2 WHERE id = 5').run();
  assert.ok(call(5, 'me').unlocked.includes('dayrace'));
  assert.equal(call(5, 'me').dayRace.left, 3);
  call(5, 'dayrace/start');
  assert.equal(S.unlockLevel('dayrace'), 2);
});

// ---------- the run: the drag replay of race/finish ----------
test('run: race/finish replays it like any drag race — honest time kept, forged shifts corrected, too soon refused', () => {
  const { mk, call, add, db } = setup();
  mk(5);
  // Honest run: exactly the time S.raceTime gives on the stock car.
  const st = call(5, 'dayrace/start');
  assert.equal(st.rival.dayrace, true);
  assert.equal(st.car.base, S.carStats({ model: st.car.model }).base);
  const r = honestDrag(st.car, st.greenMs, 0.12, ['perfect', 'good', 'perfect', 'good']);
  add(r.ms + 30);
  const res = call(5, 'race/finish', { raceId: st.raceId, ...r.body });
  assert.equal(res.time, S.raceTime(st.car, 0.12, ['perfect', 'good', 'perfect', 'good']));
  assert.equal(res.corrected, 0);
  assert.equal(res.perfectStart, true);
  assert.equal(res.dayrace.counted, true);
  assert.equal(res.dayrace.newBest, true);
  assert.equal(res.dayrace.place, 1);
  assert.equal(db.prepare('SELECT time FROM dayrace_best WHERE user_id = 5').get().time, res.time);
  assert.throws(() => call(5, 'race/finish', { raceId: st.raceId, ...r.body }), /уже завершено/);
  add(61e3);
  // Forged: early taps claimed as perfect → the server's own qualities stand, the time is the honest one.
  const st2 = call(5, 'dayrace/start');
  const c = clientDrag(st2.car, st2.greenMs, { reactMs: 200, taps: [150, 500, 900, 1400] });
  add(c.ms + 30);
  const forged = call(5, 'race/finish', { raceId: st2.raceId, ...c.body, shifts: Array(4).fill('perfect') });
  assert.deepEqual(forged.shifts, c.shifts);
  assert.ok(forged.corrected > 0);
  assert.equal(forged.time, c.time);
  assert.equal(forged.dayrace.newBest, forged.time < res.time);
  add(61e3);
  // Finished sooner than the run can take on the server's clock → refused (the attempt is spent).
  const st3 = call(5, 'dayrace/start');
  const fast = honestDrag(st3.car, st3.greenMs, 0.2, Array(4).fill('good'));
  add(1000);
  assert.throws(() => call(5, 'race/finish', { raceId: st3.raceId, ...fast.body }), /ще не закінчився/);
  // An app from before the replay (no launch/shift times) can't post a board time.
  add(fast.ms);
  assert.throws(() => call(5, 'race/finish', { raceId: st3.raceId, reaction: 0.2, shifts: Array(4).fill('good') }), /Онови гру/);
  assert.equal(call(5, 'dayrace').attempts.left, 0);
});

test('run: a normal race/finish is untouched; a day run counts as a race (XP, form), never a win; a run over midnight is not counted', () => {
  const { mk, call, add, db, g, set } = setup();
  mk(5);
  const car = g.giveCar(5, 'vaz-2107').id;
  const st = call(5, 'race/start', { carId: car, rival: 'train' });
  const r = honestDrag(st.car, st.greenMs, 0.2, Array(4).fill('good'));
  add(r.ms + 30);
  const res = call(5, 'race/finish', { raceId: st.raceId, ...r.body });
  assert.equal(res.dayrace, undefined);
  add(61e3);
  const u0 = db.prepare('SELECT races, wins, xp, level FROM users WHERE id = 5').get();
  const st2 = call(5, 'dayrace/start');
  const r2 = honestDrag(st2.car, st2.greenMs, 0.2, Array(4).fill('good'));
  add(r2.ms + 30);
  call(5, 'race/finish', { raceId: st2.raceId, ...r2.body });
  const u1 = db.prepare('SELECT races, wins, xp, level FROM users WHERE id = 5').get();
  assert.equal(u1.races, u0.races + 1);
  assert.equal(u1.wins, u0.wins);
  assert.ok(u1.xp > u0.xp || u1.level > u0.level);
  // Started at 23:59:58 Kyiv, finished after midnight: shown, not on any board.
  set(Date.parse(TODAY + 'T20:59:58Z')); // 23:59:58 Kyiv
  const st3 = call(5, 'dayrace/start');
  const r3 = honestDrag(st3.car, st3.greenMs, 0.2, Array(4).fill('good'));
  add(r3.ms + 30);
  const late = call(5, 'race/finish', { raceId: st3.raceId, ...r3.body });
  assert.equal(late.dayrace.counted, false);
  assert.equal(late.dayrace.late, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM dayrace_best WHERE day = ?').get(D.addDays(TODAY, 1)).n, 0);
});

// ---------- the board ----------
test('board: best time per player, ties go to who set it first, banned and disqualified are off; top 100 + my place', () => {
  const { mk, call, put, db, owner, at } = setup();
  for (let id = 10; id < 130; id++) mk(id);
  // 120 players; 11 and 12 share a time — 12 set it first.
  for (let id = 10; id < 130; id++) put(id, TODAY, 13 + id / 1000, at() - 1e6 + id);
  db.prepare('UPDATE dayrace_best SET time = 13.012, at = ? WHERE user_id = 11').run(at() - 500);
  db.prepare('UPDATE dayrace_best SET time = 13.012, at = ? WHERE user_id = 12').run(at() - 900);
  const v = call(129, 'dayrace');
  assert.equal(v.total, 120);
  assert.equal(v.board.length, 100, 'top 100');
  assert.deepEqual(v.board.slice(0, 3).map((r) => r.id), [10, 12, 11]);
  assert.deepEqual(v.board.map((r) => r.place), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(v.me.place, 120);
  assert.ok(!v.board.some((r) => r.me), 'my row is not in the top 100, my place is still known');
  // Banned and disqualified players leave the board; everyone behind moves up.
  db.prepare('UPDATE users SET banned = 1 WHERE id = 10').run();
  owner('dayrace/dq', { day: TODAY, id: 12, dq: true });
  const v2 = call(129, 'dayrace');
  assert.equal(v2.total, 118);
  assert.deepEqual(v2.board.slice(0, 2).map((r) => r.id), [11, 13]);
  assert.equal(v2.me.place, 118);
  assert.equal(call(12, 'dayrace').me.place, null);
  assert.equal(call(50, 'dayrace').me.place, 39, 'ids 10…50 were ahead or equal; 10 and 12 are gone');
  assert.equal(call(50, 'me').dayRace.place, 39);
});

test('board: ties between real runs — the same time set later ranks behind', () => {
  const { mk, run, call, db } = setup();
  mk(5);
  mk(6);
  const a = run(5, 0.2, Array(4).fill('good'));
  const b = run(6, 0.2, Array(4).fill('good'));
  assert.equal(a.res.time, b.res.time);
  assert.equal(b.res.dayrace.place, 2);
  assert.deepEqual(b.res.dayrace.next, { place: 1, name: 'U5', time: a.res.time, gap: 0 });
  assert.deepEqual(call(5, 'dayrace').board.map((r) => r.id), [5, 6]);
  // 6 beats it: first, with the lead over 5.
  const c = run(6, 0.12, Array(4).fill('perfect'));
  assert.equal(c.res.dayrace.place, 1);
  assert.equal(c.res.dayrace.prevPlace, 2);
  assert.ok(c.res.dayrace.lead.gap > 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM dayrace_best').get().n, 2);
  // The ghost of the next run: own record for the leader, the next place up for the second.
  assert.equal(call(6, 'dayrace/start').rival.ghost, 'best');
  const g5 = call(5, 'dayrace/start').rival;
  assert.equal(g5.ghost, 'next');
  assert.equal(g5.time, c.res.time);
});

// ---------- friends ----------
test('friends board: invite links both ways and finished deals; strangers are not on it', () => {
  const { mk, call, put, db, at } = setup();
  mk(5, { name: 'Тарас' });
  mk(6, { ref: 5, name: 'Іван' }); // invited by 5
  mk(4, { name: 'Батя' });
  db.prepare('UPDATE users SET referrer_id = 4 WHERE id = 5').run(); // 5 was invited by 4
  mk(7, { name: 'Партнер' });
  mk(8, { name: 'Чужий' });
  mk(9, { name: 'Мовчун' }); // a friend who hasn't raced
  db.prepare('UPDATE users SET referrer_id = 5 WHERE id = 9').run();
  db.prepare("INSERT INTO trades (from_id, to_id, status, created_at, updated_at) VALUES (7, 5, 'done', 0, 0)").run();
  db.prepare("INSERT INTO trades (from_id, to_id, status, created_at, updated_at) VALUES (8, 5, 'declined', 0, 0)").run();
  for (const [id, tm] of [[5, 12.5], [6, 12.1], [4, 13], [7, 12.9], [8, 11]]) put(id, TODAY, tm, at());
  const f = call(5, 'dayrace').friends;
  assert.deepEqual(f.list.map((r) => r.id), [6, 5, 7, 4]);
  assert.deepEqual(f.list.map((r) => r.place), [1, 2, 3, 4]);
  assert.deepEqual(f.list.map((r) => r.global), [2, 3, 4, 5], 'each with the place on the whole board');
  assert.equal(f.friends, 4);
  assert.equal(f.waiting, 1);
  assert.ok(f.list.find((r) => r.id === 5).me);
  // Symmetric: 6 sees 5 (his inviter), not 4 or 7.
  assert.deepEqual(call(6, 'dayrace').friends.list.map((r) => r.id), [6, 5]);
  // No social graph: only yourself.
  assert.deepEqual(call(8, 'dayrace').friends.list.map((r) => r.id), [8]);
});

// ---------- midnight ----------
test('midnight: places and prizes for the day before, exactly once; claim once; «Забрати все» and the reveal', () => {
  const { mk, call, put, db, set, keys, frags, at } = setup();
  for (let id = 10; id < 40; id++) mk(id); // 30 finishers → top 10% = 3 places
  for (let id = 10; id < 40; id++) put(id, TODAY, 12 + (id - 10) / 100, at());
  db.prepare("INSERT INTO fragments (user_id, case_id, count) VALUES (39, 'city', 7)").run(); // the 8th makes a key
  // Still the same day: nothing settled, nothing to claim.
  assert.equal(call(10, 'pulse').claims.filter((c) => c.kind === 'drace').length, 0);
  set(Date.parse(D.addDays(TODAY, 1) + 'T00:30:00Z')); // 03:30 Kyiv, the next day
  call(10, 'me');
  call(11, 'me'); // a second call settles nothing more
  const day = db.prepare('SELECT * FROM dayrace_days WHERE day = ?').get(TODAY);
  assert.equal(day.total, 30);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM dayrace_days').get().n, 1);
  const prize = (id) => JSON.parse(db.prepare('SELECT prize FROM dayrace_best WHERE user_id = ?').get(id).prize);
  assert.deepEqual(prize(10), { fragments: 1, caseId: 'city', topKey: 'city', podiumKey: 'sport', badge: 1 });
  assert.deepEqual(prize(12), { fragments: 1, caseId: 'city', topKey: 'city', podiumKey: 'sport', badge: 3 });
  assert.deepEqual(prize(13), { fragments: 1, caseId: 'city' });
  assert.equal(db.prepare('SELECT place FROM dayrace_best WHERE user_id = 39').get().place, 30);
  // Badges and the feed line for the podium.
  assert.deepEqual({ ...call(10, 'me').badges.find((b) => b.key === 'dayrace') }, { key: 'dayrace', title: 'Заїзд дня: №1', tier: 3, season: null, place: 1 });
  assert.equal(call(11, 'me').badges.find((b) => b.key === 'dayrace').title, 'Заїзд дня: №2');
  assert.ok(!call(13, 'me').badges.some((b) => b.key === 'dayrace'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE text LIKE '🏁 Заїзд дня%'").get().n, 3);
  // The rewards center lists it; one claim pays it, the second is refused.
  const cl = call(10, 'pulse').claims.find((c) => c.kind === 'drace');
  assert.equal(cl.id, TODAY);
  assert.match(cl.title, /1-й з 30/);
  const k0 = { city: keys(10, 'city'), sport: keys(10, 'sport') };
  const got = call(10, 'dayrace/claim', { day: TODAY });
  assert.equal(keys(10, 'city'), k0.city + 1);
  assert.equal(keys(10, 'sport'), k0.sport + 1);
  assert.equal(frags(10, 'city'), 1);
  assert.deepEqual(got.keys.map((k) => k.caseId), ['city', 'sport']);
  assert.throws(() => call(10, 'dayrace/claim', { day: TODAY }), /вже забрано/);
  assert.equal(call(10, 'pulse').claims.filter((c) => c.kind === 'drace').length, 0);
  // «Забрати все»: the 8th fragment becomes a key, shown in the reveal; a second tap pays nothing.
  const all = call(39, 'rewards/all');
  assert.ok(all.kinds.includes('drace'));
  assert.equal(frags(39, 'city'), 0);
  assert.ok(all.reveal.some((r) => r.kind === 'key' && r.caseId === 'city'));
  assert.equal(call(39, 'pulse').claims.filter((c) => c.kind === 'drace').length, 0);
  assert.throws(() => call(39, 'dayrace/claim', { day: TODAY }), /вже забрано/);
  // No result that day → nothing to claim; the day stays settled after a restart of the game.
  mk(50);
  assert.throws(() => call(50, 'dayrace/claim', { day: TODAY }), /ще не готова/);
  const g2 = createGame(db, { now: at, notify: () => {} });
  g2.api.me(11);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM dayrace_days').get().n, 1);
  assert.equal(JSON.parse(db.prepare('SELECT prize FROM dayrace_best WHERE user_id = 11').get().prize).badge, 2);
});

test('midnight: a small field gets fragments only; a rolled-back call settles again; the badge keeps the best place', () => {
  const { mk, call, put, db, set, owner, at } = setup();
  for (const id of [10, 11, 12]) mk(id);
  for (const [id, tm] of [[10, 12], [11, 13], [12, 14]]) put(id, TODAY, tm, at());
  set(Date.parse(D.addDays(TODAY, 1) + 'T09:00:00Z'));
  // The first call of the new day fails (no attempts problem — a bad day id): its settlement is rolled back with it…
  assert.throws(() => call(10, 'dayrace/claim', { day: 'nope' }), /Некоректний день/);
  // …and the next call settles for real.
  call(10, 'dayrace');
  for (const id of [10, 11, 12]) assert.deepEqual(JSON.parse(db.prepare('SELECT prize FROM dayrace_best WHERE user_id = ?').get(id).prize), { fragments: 1, caseId: 'city' });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM badges WHERE key = 'dayrace'").get().n, 0, 'fewer than 5 finishers: no place prizes');
  assert.throws(() => owner('dayrace/dq', { day: TODAY, id: 10, dq: true }), /уже підсумовано/);
  // Badge: №2 one day, №1 the next keeps №1; a later №3 doesn't lower it.
  const tomorrow = D.addDays(TODAY, 1);
  for (let id = 20; id < 26; id++) mk(id);
  for (let id = 20; id < 26; id++) put(id, tomorrow, 10 + id / 100, at());
  put(10, tomorrow, 10.205, at()); // second
  set(Date.parse(D.addDays(TODAY, 2) + 'T09:00:00Z'));
  call(10, 'me');
  assert.equal(call(10, 'me').badges.find((b) => b.key === 'dayrace').title, 'Заїзд дня: №2');
  const d3 = D.addDays(TODAY, 2);
  for (let id = 20; id < 26; id++) put(id, d3, 11 + id / 100, at());
  put(10, d3, 9, at()); // first
  set(Date.parse(D.addDays(TODAY, 3) + 'T09:00:00Z'));
  assert.equal(call(10, 'me').badges.find((b) => b.key === 'dayrace').title, 'Заїзд дня: №1');
  const d4 = D.addDays(TODAY, 3);
  for (let id = 20; id < 26; id++) put(id, d4, 10 + id / 100, at());
  put(10, d4, 10.215, at()); // third
  set(Date.parse(D.addDays(TODAY, 4) + 'T09:00:00Z'));
  assert.equal(call(10, 'me').badges.find((b) => b.key === 'dayrace').title, 'Заїзд дня: №1');
  // Every day was paid once: four days with prizes waiting for 10.
  assert.equal(call(10, 'pulse').claims.filter((c) => c.kind === 'drace').length, 4);
});

test('prizes: top 10% at least the winner from 5 finishers, podium 3; the rules in one place', () => {
  assert.deepEqual(D.prizeOf(1, 4), { fragments: 1, caseId: 'city' });
  assert.deepEqual(D.prizeOf(1, 5), { fragments: 1, caseId: 'city', topKey: 'city', podiumKey: 'sport', badge: 1 });
  assert.deepEqual(D.prizeOf(2, 5), { fragments: 1, caseId: 'city', podiumKey: 'sport', badge: 2 });
  assert.equal(D.topCount(1240), 124);
  assert.ok(D.prizeOf(124, 1240).topKey);
  assert.ok(!D.prizeOf(125, 1240).topKey);
  assert.ok(!D.prizeOf(4, 1240).badge);
  for (const k of [D.DAYRACE.fragCase, D.DAYRACE.topKey, D.DAYRACE.podiumKey]) assert.ok(S.CASE_BY_ID[k], k);
});

// ---------- the 19:00 reminder ----------
test('reminder: from 19:00 Kyiv to players with it open who haven\'t raced, with a friend\'s time; the usual limits apply', () => {
  const { mk, g, put, db, set, at, run } = setup();
  mk(5, { name: 'Тарас' });
  mk(6, { ref: 5, name: 'Іван' });
  mk(7, { level: 1 });
  mk(8, { name: 'Самітник' });
  mk(9, { name: 'Вимкнув' });
  db.prepare('UPDATE users SET push_off = 1 WHERE id = 9').run();
  put(6, TODAY, 11.842, at());
  db.prepare('INSERT INTO dayrace_tries (day, user_id, n) VALUES (?, 6, 1)').run(TODAY);
  const seenAt = Date.parse(TODAY + 'T12:00:00Z'); // 15:00 Kyiv
  db.prepare('UPDATE users SET last_seen = ?').run(seenAt);
  const cand = () => g.pushCandidates(PUSH);
  const item = (uid) => cand().find((c) => c.uid === uid)?.ready.find((r) => r.kind === 'dayrace');
  set(Date.parse(TODAY + 'T15:30:00Z')); // 18:30 Kyiv
  assert.equal(item(5), undefined);
  set(Date.parse(TODAY + 'T16:05:00Z')); // 19:05 Kyiv
  const car = S.MODELS[D.scheduledCar(TODAY)].name;
  assert.equal(item(5).text, `🏁 Заїзд дня: ${car}. Твій друг Іван — 11,842 с. Поб'єш?`);
  assert.equal(item(8).text, `🏁 Заїзд дня: ${car}. Лідер — 11,842 с. 3 безкоштовні спроби — поб'єш?`);
  assert.equal(item(7), undefined, 'locked (level 1)');
  assert.equal(item(9), undefined, 'opted out');
  assert.equal(item(6), undefined, 'already raced today');
  // pickReminder takes it (one of a kind per day), and marks it; the next tick doesn't repeat it.
  const c5 = cand().find((c) => c.uid === 5);
  const kinds = pickReminder(c5, at());
  assert.ok(kinds.includes('dayrace'));
  assert.equal(kinds[0], kinds.includes('event') ? 'event' : 'dayrace');
  g.pushMark(5, kinds, at());
  assert.equal(item(5), undefined);
  // Raced today → no reminder.
  run(8);
  assert.equal(item(8), undefined);
});
