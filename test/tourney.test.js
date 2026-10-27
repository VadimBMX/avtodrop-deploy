// «Турнір вихідних» (public/tourney.js rules, src/tourney.js server): the week's schedule, registration, the draw with
// bots, rounds and deadlines, the ghost of the other side's run, the anti-cheat replay of race/finish and the prizes
// (paid exactly once).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as G from '../public/ghost.js';
import * as TR from '../public/tourney.js';
import { honestDrag } from './race-helpers.js';

const TID = '2026-10-30'; // a Friday (Kyiv winter time, UTC+2, after the 25.10 switch)
const H = 3600e3;
const FRI18 = TR.regOpenOf(TID), SAT12 = TR.regCloseOf(TID);
const PERFECT = ['perfect', 'perfect', 'perfect', 'perfect'];

function setup({ t0 = FRI18 + 60e3 } = {}) {
  let t = t0;
  const db = openDb(':memory:');
  const sent = [];
  const g = createGame(db, { now: () => t, notify: (uid, text) => sent.push({ uid, text }), random: () => 0.5, admins: [1] });
  const mk = (id, model = 'toyota-corolla-ae86', level = 5) => {
    g.ensureUser({ id, first_name: 'U' + id }, '');
    db.prepare('UPDATE users SET level = ?, level_seen = ? WHERE id = ?').run(level, level, id);
    return g.giveCar(id, model).id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  // A whole tournament run as the app drives it: start, honest taps, finish after the run's real time.
  const run = (uid, react = 0.13, qs = PERFECT, body = {}) => {
    const st = call(uid, 'tourney/start', body);
    const r = honestDrag(st.car, st.greenMs, react, qs);
    t += r.ms + 30;
    const res = call(uid, 'race/finish', { raceId: st.raceId, ...r.body });
    t += 61e3; // past the anti-bot start limit
    return { st, res, run: r };
  };
  const match = (uid) => db.prepare('SELECT * FROM tourney_matches WHERE (a_uid = ? OR b_uid = ?) ORDER BY round DESC LIMIT 1').get(uid, uid);
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  const keys = (uid, c) => db.prepare('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, c)?.count || 0;
  return { db, g, mk, call, run, match, bal, keys, sent, at: () => t, set: (x) => (t = x), add: (ms) => (t += ms) };
}
const win = (size, round) => TR.windowOf(TID, size, round);
// Players 10 and 11 (seeds 1 and 2) meet in the first round: the draw is edited after it is made.
function pair(db) {
  const a = db.prepare('SELECT * FROM tourney_matches WHERE round = 0 AND a_uid = 10').get();
  const b = db.prepare('SELECT * FROM tourney_matches WHERE round = 0 AND a_uid = 11').get();
  db.prepare('UPDATE tourney_matches SET b = ?, b_uid = 11 WHERE id = ?').run(b.a, a.id);
  db.prepare('UPDATE tourney_matches SET a = ?, a_uid = NULL WHERE id = ?').run(a.b, b.id);
  return a.id;
}

// ---------- schedule ----------
test('schedule: Fri 18:00 → Sat 12:00 registration, fixed round windows, the final on Sunday 20:00 (Kyiv, across DST)', () => {
  const kyiv = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
  assert.equal(kyiv(FRI18), 'Fri 18:00');
  assert.equal(kyiv(SAT12), 'Sat 12:00');
  assert.equal(kyiv(win(16, 3).opens), 'Sun 20:00'); // the final of a 16 bracket
  assert.equal(kyiv(win(16, 3).deadline), 'Sun 23:00');
  assert.equal(kyiv(win(32, 0).opens), 'Sat 12:00');
  assert.equal(kyiv(win(16, 0).opens), 'Sat 15:00');
  assert.equal(kyiv(win(16, 2).opens), 'Sun 16:00');
  // Every round's deadline is before the next round opens; 3 h each.
  for (const size of [16, 32]) for (let r = 0; r < TR.roundsOf(size); r++) {
    const w = win(size, r);
    assert.equal(w.deadline - w.opens, 3 * H);
    if (r) assert.ok(win(size, r - 1).deadline <= w.opens);
  }
  // The DST weekend (Sunday 25.10.2026): hours stay Kyiv wall-clock hours.
  assert.equal(kyiv(TR.windowOf('2026-10-23', 16, 3).opens), 'Sun 20:00');
  assert.equal(TR.tidOf(SAT12), TID);
  assert.equal(TR.tidOf(Date.parse('2026-10-26T10:00:00Z')), TID); // Monday → this week's Friday
  assert.equal(TR.shownTid(FRI18 - 1), '2026-10-23'); // before registration: last week's tournament on the screen
  assert.deepEqual([TR.phaseAt(TID, FRI18 - 1), TR.phaseAt(TID, FRI18), TR.phaseAt(TID, SAT12), TR.phaseAt(TID, TR.endOf(TID))], ['soon', 'reg', 'run', 'done']);
  assert.deepEqual(TR.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.deepEqual([TR.roundName(32, 0), TR.roundName(32, 1), TR.roundName(32, 2), TR.roundName(32, 3), TR.roundName(32, 4)], ['1/16 фіналу', '1/8 фіналу', '1/4 фіналу', 'Півфінал', 'Фінал']);
  assert.deepEqual([TR.placeOfLoss(16, 3), TR.placeOfLoss(16, 2), TR.placeOfLoss(16, 1), TR.placeOfLoss(16, 0)], [2, 3, 5, 9]);
});

// ---------- registration ----------
test('registration: free, level gate, only in the window, one car (its class is the bracket), change or leave until Sat 12:00', () => {
  const { mk, call, set, bal, db } = setup({ t0: FRI18 - H });
  const c = mk(5);
  const lada = mk(5, 'vaz-2106');
  const low = mk(6, 'vaz-2106', 1);
  assert.throws(() => call(5, 'tourney/join', { carId: c }), /п’ятниці 18:00/);
  const before = call(5, 'tourney'); // before registration: last week's (empty) tournament and the countdown to this one
  assert.deepEqual([before.tid, before.phase, before.nextTid, before.nextRegOpen], ['2026-10-23', 'done', TID, FRI18]);
  set(FRI18 + 60e3);
  assert.throws(() => call(6, 'tourney/join', { carId: low }), /рівня/);
  mk(7);
  assert.throws(() => call(7, 'tourney/join', { carId: c }), /не твоє/);
  const money = bal(5);
  let v = call(5, 'tourney/join', { carId: c });
  assert.equal(v.entry.cls, 'C');
  assert.equal(bal(5), money, 'registration is free');
  v = call(5, 'tourney/join', { carId: lada }); // another car: the class follows it
  assert.equal(v.entry.cls, 'D');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tourney_entries').get().n, 1);
  assert.equal(call(5, 'me').tourney.entry, 'D');
  call(5, 'tourney/leave');
  assert.equal(call(5, 'tourney').entry, null);
  call(5, 'tourney/join', { carId: c });
  set(SAT12);
  assert.throws(() => call(5, 'tourney/leave'), /вийти не можна/);
  assert.throws(() => call(5, 'tourney/join', { carId: lada }), /Реєстрація/);
});

// ---------- the draw: class brackets, bots fill ----------
test('draw: brackets by class, 16 or 32 seats, bots fill the rest with real cars of the class and graded drivers', () => {
  const { mk, call, set, db, sent } = setup();
  for (let i = 0; i < 3; i++) call(10 + i, 'tourney/join', { carId: mk(10 + i) }); // C
  for (let i = 0; i < 17; i++) call(100 + i, 'tourney/join', { carId: mk(100 + i, 'vaz-2106') }); // D
  call(200, 'tourney/join', { carId: mk(200, 'ferrari-f40') }); // S
  set(SAT12 + 1000);
  const v = call(10, 'tourney');
  assert.equal(v.phase, 'run');
  assert.deepEqual(v.brackets.map((b) => [b.bracket, b.size, b.humans]), [['D', 32, 17], ['C', 16, 3], ['S', 16, 1]]);
  // A Lada never meets a Ferrari: every side of a bracket is a car of its class.
  for (const br of ['D', 'C', 'S']) {
    const rows = db.prepare('SELECT * FROM tourney_matches WHERE bracket = ? AND round = 0').all(br);
    const sides = rows.flatMap((m) => [JSON.parse(m.a), JSON.parse(m.b)]);
    const size = rows.length * 2;
    assert.equal(sides.length, size);
    assert.deepEqual(sides.map((p) => p.seed).sort((a, b) => a - b), Array.from({ length: size }, (_, i) => i + 1));
    for (const p of sides) {
      const model = p.bot ? p.bot.model : db.prepare('SELECT model FROM tourney_entries WHERE user_id = ?').get(p.uid).model;
      assert.equal(TR.bracketCls(S.MODELS[model].cls), br, `${br}: ${model}`);
      if (p.bot) assert.ok(p.bot.skill >= TR.TOURNEY.botSkill[0] && p.bot.skill <= TR.TOURNEY.botSkill[1]);
    }
    // Players take the top seeds; the stronger the bot's seed, the better its driver.
    const bots = sides.filter((p) => p.bot).sort((a, b) => a.seed - b.seed);
    for (let i = 1; i < bots.length; i++) assert.ok(bots[i].bot.skill <= bots[i - 1].bot.skill);
    assert.ok(sides.filter((p) => p.uid).every((p) => p.seed <= sides.filter((x) => x.uid).length));
    // Standard pairing: seed 1 meets the last seed.
    const m0 = rows.find((m) => m.slot === 0);
    assert.deepEqual([JSON.parse(m0.a).seed, JSON.parse(m0.b).seed], [1, size]);
  }
  // The C players (seeds 1–3) can't meet before the semis; the draw told each of them.
  assert.ok(sent.some((x) => x.uid === 10 && /ти в сітці класу C/.test(x.text)));
  // A second call draws nothing again.
  call(11, 'tourney');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tourney_brackets').get().n, 3);
  // Deterministic bots: same week, same cars.
  const again = setup();
  for (let i = 0; i < 3; i++) again.call(10 + i, 'tourney/join', { carId: again.mk(10 + i) });
  again.set(SAT12 + 1000);
  again.call(10, 'tourney');
  const bots = (d) => d.prepare("SELECT a, b FROM tourney_matches WHERE bracket = 'C' ORDER BY slot").all().map((m) => m.a + m.b).join();
  assert.equal(bots(again.db), bots(db));
});

test('draw: more than 32 players of a class split into several brackets of up to 32', () => {
  const { mk, call, set } = setup();
  for (let i = 0; i < 40; i++) call(300 + i, 'tourney/join', { carId: mk(300 + i, 'vaz-2106') });
  set(SAT12 + 1000);
  const v = call(300, 'tourney');
  assert.deepEqual(v.brackets.map((b) => [b.bracket, b.size, b.humans]), [['D1', 32, 20], ['D2', 32, 20]]);
});

// ---------- rounds, deadlines ----------
test('rounds: a match opens with its window, 2 runs without fuel, decided early when it cannot change; no-show loses at the deadline', () => {
  const { mk, call, set, run, match, db, sent, at } = setup();
  call(10, 'tourney/join', { carId: mk(10) });
  call(11, 'tourney/join', { carId: mk(11) });
  set(SAT12 + 1000);
  assert.throws(() => call(10, 'tourney/start'), /відкриється/);
  set(win(16, 0).opens + 60e3);
  call(10, 'tourney');
  assert.equal(match(10).status, 'open');
  assert.ok(sent.some((x) => x.uid === 10 && /матч 1\/8 фіналу готовий/.test(x.text)));
  const bot = JSON.parse(match(10).b);
  assert.ok(bot.bot && match(10).b_best > 0, 'the bot\'s time is fixed when the match opens');
  // A strong bot this time (its time is the seed's own; here a fast one, so both runs below lose).
  db.prepare('UPDATE tourney_matches SET b_best = 12 WHERE round = 0 AND a_uid = 10').run();
  const fuel = db.prepare('SELECT fuel FROM users WHERE id = 10').get().fuel;
  // A slow first run (late shifts) loses to the bot; the match waits for the second run.
  const r1 = run(10, 0.4, ['late', 'late', 'late', 'late']);
  assert.equal(r1.st.rival.kind, 'bot');
  assert.equal(r1.res.tourney.counted, true);
  assert.equal(r1.res.tourney.tries.left, 1);
  assert.equal(match(10).status, 'open', 'a slower first run decides nothing: one run is left');
  const r2 = run(10);
  assert.equal(db.prepare('SELECT fuel FROM users WHERE id = 10').get().fuel, fuel, 'tournament runs burn no fuel');
  assert.equal(match(10).round, 0);
  assert.equal(r2.res.tourney.won, false);
  const m0 = db.prepare('SELECT * FROM tourney_matches WHERE round = 0 AND a_uid = 10').get();
  assert.equal(m0.status, 'done', 'both runs used: decided at once');
  assert.equal(m0.a_best, Math.min(r1.res.time, r2.res.time), 'the best run counts');
  assert.throws(() => call(10, 'tourney/start'), /немає матчу|відкриється/);
  // Player 11 never races: at the deadline he loses to his bot.
  assert.equal(match(11).status, 'open');
  set(win(16, 0).deadline + 1000);
  call(10, 'tourney');
  const m11 = db.prepare('SELECT * FROM tourney_matches WHERE round = 0 AND a_uid = 11').get();
  assert.deepEqual([m11.status, m11.winner, m11.how], ['done', 1, 'noshow']);
  assert.equal(call(11, 'tourney').my.place, 9);
  // Every first-round match is over; the next round is filled from the winners.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tourney_matches WHERE round = 0 AND status != 'done'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tourney_matches WHERE round = 1 AND a IS NOT NULL AND b IS NOT NULL").get().n, 4);
  assert.ok(at() > 0);
});

test('rounds: two players with no time at the deadline — the higher seed goes on; a run past the deadline is not counted', () => {
  const { mk, call, set, db, add } = setup();
  // Two players in a bracket of 16 meet only if seeded together: force it by editing the draw after it is made.
  call(10, 'tourney/join', { carId: mk(10) });
  call(11, 'tourney/join', { carId: mk(11) });
  set(SAT12 + 1000);
  call(10, 'tourney');
  const a = db.prepare('SELECT * FROM tourney_matches WHERE round = 0 AND a_uid = 10').get();
  const b = db.prepare('SELECT * FROM tourney_matches WHERE round = 0 AND a_uid = 11').get();
  db.prepare('UPDATE tourney_matches SET b = ?, b_uid = 11 WHERE id = ?').run(b.a, a.id);
  db.prepare('UPDATE tourney_matches SET a = ?, a_uid = NULL WHERE id = ?').run(a.b, b.id);
  set(win(16, 0).deadline - 2000);
  const st = call(11, 'tourney/start');
  const r = honestDrag(st.car, st.greenMs, 0.13, PERFECT);
  add(r.ms + 5000); // the finish comes after the deadline
  const res = call(11, 'race/finish', { raceId: st.raceId, ...r.body });
  assert.equal(res.tourney.counted, false);
  assert.equal(res.tourney.late, true);
  call(10, 'tourney');
  const m = db.prepare('SELECT * FROM tourney_matches WHERE id = ?').get(a.id);
  assert.deepEqual([m.status, m.winner, m.how], ['done', 0, 'noshow2'], 'seed 1 beats seed 2 when neither has a time');
});

// ---------- the ghost ----------
test('ghost: the second player races the replay of the first one\'s best run; before it, the car\'s typical time', () => {
  const { mk, call, set, db, sent, run } = setup();
  call(10, 'tourney/join', { carId: mk(10) });
  call(11, 'tourney/join', { carId: mk(11) });
  set(SAT12 + 1000);
  call(10, 'tourney');
  const a = db.prepare('SELECT * FROM tourney_matches WHERE round = 0 AND a_uid = 10').get();
  const b = db.prepare('SELECT * FROM tourney_matches WHERE round = 0 AND a_uid = 11').get();
  db.prepare('UPDATE tourney_matches SET b = ?, b_uid = 11 WHERE id = ?').run(b.a, a.id);
  db.prepare('UPDATE tourney_matches SET a = ?, a_uid = NULL WHERE id = ?').run(a.b, b.id);
  set(win(16, 0).opens + 60e3);
  const first = run(10, 0.2, ['good', 'good', 'good', 'good']);
  assert.equal(first.st.rival.kind, 'par');
  assert.ok(sent.some((x) => x.uid === 11 && /U10 проїхав/.test(x.text)), 'the other player hears there is a time to beat');
  const st = call(11, 'tourney/start');
  assert.equal(st.rival.kind, 'ghost');
  assert.equal(st.rival.time, first.res.time);
  // The ghost crosses the line exactly at the stored time (the same replay as the ghost challenges).
  assert.ok(Math.abs(G.ghostPlan(st.rival, st.rival.plan.reaction, [], st.rival.plan.shifts).time - first.res.time) < 0.0005);
  assert.ok(Math.abs(st.rival.plan.time - first.res.time) < 0.0005);
  assert.equal(st.tries.left, 1);
});

// ---------- anti-cheat ----------
test('anti-cheat: the server replays the taps — a forged time, an early finish, an old client or a 3rd run never count', () => {
  const { mk, call, set, db, add, match } = setup();
  call(10, 'tourney/join', { carId: mk(10) });
  call(11, 'tourney/join', { carId: mk(11) });
  set(SAT12 + 1000);
  call(10, 'tourney');
  pair(db); // 10 meets 11: the match stays open until both have raced
  set(win(16, 0).opens + 60e3);
  // Old client (no launch / shiftAt): refused.
  let st = call(10, 'tourney/start');
  let r = honestDrag(st.car, st.greenMs, 0.2, ['late', 'late', 'late', 'late']);
  add(r.ms + 30);
  assert.throws(() => call(10, 'race/finish', { raceId: st.raceId, reaction: 0.12, shifts: PERFECT }), /Онови гру/);
  // Too early on the server's clock: refused (the run is still «running»).
  add(-r.ms);
  assert.throws(() => call(10, 'race/finish', { raceId: st.raceId, ...r.body }), /ще не закінчився/);
  add(r.ms);
  // Claims of perfect shifts over limiter taps: the replay judges the taps, the time is the server's own.
  const res = call(10, 'race/finish', { raceId: st.raceId, ...r.body, shifts: PERFECT });
  assert.equal(res.time, S.raceTime(st.car, r.reaction, res.shifts));
  assert.ok(res.shifts.every((q) => q !== 'perfect'));
  assert.equal(db.prepare('SELECT a_best FROM tourney_matches WHERE round = 0 AND a_uid = 10').get().a_best, res.time);
  // Someone else's race id: not his.
  add(61e3);
  st = call(10, 'tourney/start');
  r = honestDrag(st.car, st.greenMs, 0.13, PERFECT);
  add(r.ms + 30);
  call(10, 'tourney'); // a read in between changes nothing
  mk(99);
  assert.throws(() => call(99, 'race/finish', { raceId: st.raceId, ...r.body }), /Заїзд уже завершено/);
  const ok = call(10, 'race/finish', { raceId: st.raceId, ...r.body });
  assert.equal(ok.tourney.counted, true);
  // A finish sent twice counts once.
  assert.throws(() => call(10, 'race/finish', { raceId: st.raceId, ...r.body }), /Заїзд уже завершено/);
  // Two runs per match: the third start is refused (if the match is still open).
  add(61e3);
  assert.throws(() => call(10, 'tourney/start'), /закінчились/);
  assert.equal(match(10).status, 'open', 'the match waits for player 11');
  // A car of another class can't race in this bracket.
  const lada = mk(11, 'vaz-2106');
  assert.throws(() => call(11, 'tourney/start', { carId: lada }), /класу C/);
  assert.equal(match(11).b_tries, 0, 'a refused start uses no run');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM races WHERE user_id = 10 AND status = 'running'").get().n, 0);
});

// ---------- the whole weekend, prizes once ----------
test('prizes: the whole weekend to the Sunday final — places, money, keys, badge and the champions\' frame, paid exactly once', () => {
  const { mk, call, set, db, run, match, bal, keys, sent } = setup();
  call(10, 'tourney/join', { carId: mk(10) });
  call(11, 'tourney/join', { carId: mk(11) });
  set(SAT12 + 1000);
  call(10, 'tourney');
  // Player 10 drives every round perfectly; player 11 never shows up.
  for (let r = 0; r < 4; r++) {
    set(win(16, r).opens + 60e3);
    call(10, 'tourney');
    const m = match(10);
    if (m.status !== 'open') break;
    if (r === 3) assert.ok(sent.some((x) => x.uid === 10 && /Ти у фіналі/.test(x.text)));
    for (let k = 0; k < 2 && match(10).status === 'open' && match(10).round === r; k++) run(10);
    set(win(16, r).deadline + 1000);
    call(10, 'tourney');
  }
  set(TR.endOf(TID) + 1000);
  const v = call(10, 'tourney');
  assert.equal(v.phase, 'done');
  const br = db.prepare("SELECT * FROM tourney_brackets WHERE bracket = 'C'").get();
  assert.ok(br.done_at, 'the bracket is finished');
  const champ = JSON.parse(br.champion);
  const p10 = db.prepare('SELECT * FROM tourney_prizes WHERE user_id = 10').get();
  const p11 = db.prepare('SELECT * FROM tourney_prizes WHERE user_id = 11').get();
  assert.ok(p10 && p11);
  assert.equal(p11.place, 9);
  assert.equal(JSON.parse(p11.prize).money, 0, 'a no-show wins nothing');
  const pz = JSON.parse(p10.prize);
  assert.deepEqual(pz, TR.prizeFor('C', p10.place, true));
  assert.equal(champ.uid, 10, 'a perfect driver beats the bots of his bracket');
  {
    assert.equal(p10.place, 1);
    assert.ok(db.prepare("SELECT 1 FROM claims WHERE user_id = 10 AND key = 'cos:e:tr-champ'").get(), 'the champions\' frame');
    assert.equal(db.prepare("SELECT tier FROM badges WHERE user_id = 10 AND key = 'tourney'").get().tier, 3);
    assert.equal(keys(10, 'tuning'), 1);
    assert.equal(keys(10, 'city'), 1);
    assert.equal(v.hall[0].uid, 10);
    assert.ok(sent.some((x) => x.uid === 10 && /Ти чемпіон/.test(x.text)));
    assert.ok(S.cosmeticOf('cos:e:tr-champ')?.kind === 'frame');
  }
  assert.equal(v.my.place, p10.place);
  // Paid once: more calls, more ticks, a re-run of the settlement — nothing more.
  const money = bal(10), k = keys(10, 'city');
  for (let i = 0; i < 3; i++) {
    call(10, 'tourney');
    call(10, 'me');
    db.prepare('UPDATE tourney_brackets SET done_at = NULL').run(); // even if the guard row were lost, the per-player rows hold
    set(TR.endOf(TID) + 2000 + i);
    db.prepare("UPDATE tourney_matches SET status = 'open' WHERE round = 3").run();
    call(10, 'tourney');
  }
  assert.equal(bal(10), money);
  assert.equal(keys(10, 'city'), k);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tourney_prizes').get().n, 2);
  // The next week: last week's results on the screen until Friday 18:00, then a new registration.
  set(TR.regOpenOf('2026-11-06') - H);
  const nv = call(10, 'tourney');
  assert.equal(nv.tid, TID);
  assert.equal(nv.nextTid, '2026-11-06');
  set(TR.regOpenOf('2026-11-06') + 1000);
  assert.equal(call(10, 'tourney').phase, 'reg');
  assert.equal(call(10, 'me').tourney.phase, 'reg');
  assert.ok(call(10, 'tourney').hall.length >= 1, 'the hall of champions keeps the past weeks');
});

test('prizes: money scales with the class, the champion takes two keys, the finalist one, everyone who raced something', () => {
  const d = TR.prizeFor('D', 1), s = TR.prizeFor('S', 1);
  assert.ok(s.money > d.money * 20);
  assert.deepEqual(d.keys, ['city', 'rust']);
  assert.deepEqual(TR.prizeFor('B', 2).keys, ['sport']);
  assert.equal(TR.prizeFor('B', 3).keys.length, 0);
  assert.ok(TR.prizeFor('A', 9, true).money > 0);
  assert.equal(TR.prizeFor('A', 9, false).money, 0);
  assert.equal(d.frame, true);
  assert.equal(TR.prizeFor('D', 2).frame, false);
  // A champion's money is about a dozen races of the class's typical car.
  assert.equal(d.money, Math.round((12 * S.raceEv(TR.classValue('D'))) / 1000) * 1000);
});
