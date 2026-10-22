// «Виклик-привид» (public/ghost.js, src/game.js challenge/*): a finished drag run thrown as a challenge, accepted by a
// friend who races its ghost; validation, the ghost's determinism, limits, rewards, referral attribution, expiry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, GameError } from '../src/game.js';
import * as S from '../public/shared.js';
import * as G from '../public/ghost.js';
import * as M from '../src/metrics.js';
import { startText } from '../src/bot.js';
import { honestDrag, clientDrag } from './race-helpers.js';

const byName = (n) => S.ALL_MODELS.find((m) => m.name === n && !m.secret).id;
function setup(seed = 3) {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-21T09:00:00Z');
  const events = [];
  const g = createGame(db, { now: () => t, notify: (uid, text) => events.push({ uid, text }), random: S.seededRand(seed), partCooldownMs: 0 });
  const user = (id, name = 'P' + id, startParam) => (g.ensureUser({ id, first_name: name }, startParam), id);
  const refuel = (uid) => db.prepare('UPDATE users SET fuel = ?, fuel_at = ? WHERE id = ?').run(S.FUEL_MAX, t, uid);
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  // A solo drag race as the phone plays it; returns the race id and the result.
  const drag = (uid, carId, rival = 'train', reaction = 0.18, shifts = ['good', 'perfect', 'good', 'early']) => {
    refuel(uid);
    t += 61e3;
    db.prepare('DELETE FROM rivals').run();
    g.api['race/rivals'](uid, { carId });
    const st = g.api['race/start'](uid, { carId, rival });
    const run = honestDrag(st.car, st.greenMs, reaction, shifts);
    t += Math.ceil(run.ms) + 50;
    return { raceId: st.raceId, res: g.api['race/finish'](uid, { raceId: st.raceId, ...run.body }) };
  };
  // A race against a challenge: start (own car or loaner), drive `plan` (reaction, shifts), finish.
  const accept = (uid, id, { carId, loaner, reaction = 0.18, shifts = ['good', 'good', 'good', 'good'], early = false } = {}) => {
    t += 61e3;
    const st = g.api['challenge/start'](uid, { id, carId, loaner });
    const run = honestDrag(st.car, st.greenMs, reaction, shifts);
    t += early ? 500 : Math.ceil(run.ms) + 50;
    return { st, run, res: g.api['race/finish'](uid, { raceId: st.raceId, ...run.body }) };
  };
  return { db, g, user, refuel, drag, accept, row, events, advance: (ms) => (t += ms), now: () => t };
}

test('create: a finished run becomes a challenge with the car as it raced; the same run again → the same challenge', () => {
  const { g, user, drag } = setup();
  user(1, 'Тарас');
  const car = g.giveCar(1, byName('Toyota Supra A80')).id;
  const { raceId, res } = drag(1, car);
  assert.ok(res.run && res.run.shiftAt.length === 4, 'race/finish keeps the tap times');
  const r = g.api['challenge/create'](1, { raceId });
  assert.match(r.challenge.id, G.CH_ID);
  assert.equal(r.challenge.time, res.time);
  assert.equal(r.challenge.car.model, byName('Toyota Supra A80'));
  assert.ok(r.challenge.car.hp > 0 && r.challenge.car.cls);
  assert.equal(r.challenge.mine, true);
  assert.equal(r.left, G.CHALLENGE.perDay - 1);
  const again = g.api['challenge/create'](1, { raceId });
  assert.equal(again.challenge.id, r.challenge.id);
  assert.equal(again.again, true);
  assert.equal(again.left, G.CHALLENGE.perDay - 1, 'sharing the same run again does not use the limit');
  assert.equal(g.api['challenge/list'](1).sent.length, 1);
});

test('create: refused for someone else\'s race, a running race, a timed-out run, an old run, a car changed after the race', () => {
  const { g, db, user, drag, refuel, advance } = setup();
  user(1);
  user(2);
  const car = g.giveCar(1, byName('Toyota Supra A80')).id;
  const { raceId } = drag(1, car);
  assert.throws(() => g.api['challenge/create'](2, { raceId }), /доїдь заїзд/);
  refuel(1);
  advance(61e3);
  const st = g.api['race/start'](1, { carId: car, rival: 'train' });
  assert.throws(() => g.api['challenge/create'](1, { raceId: st.raceId }), /доїдь заїзд/);
  advance(4 * 60e3); // left hanging: the finish counts it as 99 s
  const run = honestDrag(st.car, st.greenMs, 0.2, ['good', 'good', 'good', 'good']);
  assert.equal(g.api['race/finish'](1, { raceId: st.raceId, ...run.body }).time, 99);
  assert.throws(() => g.api['challenge/create'](1, { raceId: st.raceId }), /не можна кинути/);
  const old = drag(1, car).raceId;
  advance((G.CHALLENGE.maxAgeH + 1) * 3600e3);
  assert.throws(() => g.api['challenge/create'](1, { raceId: old }), /застарів/);
  const fresh = drag(1, car).raceId;
  db.prepare("INSERT INTO car_parts (car_id, type, tier) VALUES (?, 'eng', ?)").run(car, S.TIERS[2].id);
  assert.throws(() => g.api['challenge/create'](1, { raceId: fresh }), /змінили/);
});

test('limit: 10 challenges a Kyiv day, the next day again', () => {
  const { g, user, drag, advance } = setup();
  user(1);
  const car = g.giveCar(1, byName('Volkswagen Polo')).id;
  for (let i = 0; i < G.CHALLENGE.perDay; i++) g.api['challenge/create'](1, { raceId: drag(1, car).raceId });
  const extra = drag(1, car).raceId;
  assert.throws(() => g.api['challenge/create'](1, { raceId: extra }), /Ліміт — 10 викликів на день/);
  assert.equal(g.api['challenge/list'](1).left, 0);
  advance(14 * 3600e3);
  const r = g.api['challenge/create'](1, { raceId: drag(1, car).raceId });
  assert.equal(r.left, G.CHALLENGE.perDay - 1);
});

test('ghost: the stored run replays on the player\'s own timeline — same progress at every frame, the line at the stored time', () => {
  const { g, db, user, drag } = setup();
  user(1);
  const car = g.giveCar(1, byName('Nissan Skyline GT-R R34')).id;
  for (const [reaction, shifts] of [[0.13, ['perfect', 'perfect', 'good', 'perfect']], [0.31, ['early', 'late', 'good', 'late']], [-1, ['good', 'good', 'early', 'good']], [1.5, ['late', 'late', 'late', 'late']]]) {
    const { raceId, res } = drag(1, car, 'train', reaction, shifts);
    const ch = g.api['challenge/create'](1, { raceId }).challenge;
    const row = db.prepare('SELECT run, car FROM challenges WHERE id = ?').get(ch.id);
    const run = JSON.parse(row.run), snap = JSON.parse(row.car);
    const plan = G.ghostPlan(snap, run.reaction, run.shiftAt, run.shifts);
    assert.deepEqual(G.ghostPlan(snap, run.reaction, run.shiftAt, run.shifts), plan, 'deterministic');
    assert.equal(plan.time, res.time, 'the plan ends at the stored time');
    assert.deepEqual(plan.shifts, res.shifts);
    // What the player saw on his own screen, frame by frame (the app moves its car with dragU and the shifts so far).
    const race = JSON.parse(db.prepare('SELECT rival, result FROM races WHERE id = ?').get(raceId).result);
    const shiftTau = race.run.shiftAt.map(S.msToTau);
    const { react, drive } = G.ghostDrive(snap, plan);
    assert.ok(Math.abs(react + drive - res.time) < 1e-9, 'the ghost crosses the line at the stored time');
    for (let tau = 0; tau < res.time + 0.5; tau += 0.0137) {
      if (shiftTau.some((s) => Math.abs(s - tau) < 1e-6)) continue;
      const done = res.shifts.slice(0, shiftTau.filter((s) => s <= tau).length);
      const own = S.dragU(snap, run.reaction, done.length >= 4 ? res.shifts : done, tau);
      assert.ok(Math.abs(G.ghostU(snap, plan, tau) - own) < 1e-9, `tau ${tau.toFixed(3)}: ghost ${G.ghostU(snap, plan, tau)} vs own ${own}`);
    }
    assert.equal(G.ghostU(snap, plan, res.time + 1e-9), 1);
    assert.ok(G.ghostU(snap, plan, res.time - 0.05) < 1);
  }
});

test('accept: the friend races his own car, the run is validated like any drag race and judged against the stored time', () => {
  const { g, user, drag, accept, row, events, advance, refuel } = setup();
  user(1, 'Тарас');
  user(2, 'Іван');
  const supra = byName('Toyota Supra A80');
  const car1 = g.giveCar(1, supra).id;
  const ch = g.api['challenge/create'](1, { raceId: drag(1, car1, 'train', 0.3, ['early', 'good', 'early', 'late']).raceId }).challenge;
  const car2 = g.giveCar(2, supra).id;
  const view = g.api['challenge/get'](2, { id: ch.id });
  assert.equal(view.challenge.creator.name, 'Тарас');
  assert.equal(view.free, true);
  assert.equal(view.loaner, null, 'a player with a car gets no loaner');
  // A run that "finishes" sooner than it can on the server's clock is refused.
  assert.throws(() => accept(2, ch.id, { carId: car2, early: true }), /ще не закінчився/);
  // The failed finish rolled back; the start stays counted (next start costs fuel).
  refuel(2);
  const fuel0 = row('SELECT fuel FROM users WHERE id = 2').fuel;
  const before = row('SELECT balance FROM users WHERE id = 2').balance;
  const { st, res } = accept(2, ch.id, { carId: car2, reaction: 0.13, shifts: ['perfect', 'perfect', 'perfect', 'perfect'] });
  assert.equal(st.free, false, 'the second start against the same challenge is not free');
  assert.equal(row('SELECT fuel FROM users WHERE id = 2').fuel, fuel0 - 1);
  assert.equal(st.rival.id, 'ghost');
  assert.equal(st.rival.time, ch.time);
  assert.ok(Array.isArray(st.rival.plan.at));
  assert.equal(res.rivalTime, ch.time);
  assert.equal(res.win, res.time < ch.time);
  assert.ok(res.win, `perfect run ${res.time} beats ${ch.time}`);
  const prize = G.winPrize(S.MODELS[supra].price, S.MODELS[supra].price);
  assert.equal(res.prize, prize);
  assert.equal(res.challenge.firstWin, true);
  assert.equal(row('SELECT balance FROM users WHERE id = 2').balance - before, prize);
  assert.ok(events.some((e) => e.uid === 1 && /Іван побив твій час на \d+,\d+ с/.test(e.text) && /реванш/.test(e.text)), 'the creator hears he was beaten');
  // A second win over the same challenge pays nothing.
  advance(61e3);
  refuel(2);
  const again = accept(2, ch.id, { carId: car2, reaction: 0.13, shifts: ['perfect', 'perfect', 'perfect', 'perfect'] }).res;
  assert.equal(again.win, true);
  assert.equal(again.prize, 0);
  assert.equal(again.challenge.firstWin, false);
  const c = g.api['challenge/get'](1, { id: ch.id });
  assert.equal(c.challenge.accepted, 1);
  assert.equal(c.challenge.beaten, 1);
  assert.equal(c.rivals[0].name, 'Іван');
  assert.equal(c.rivals[0].won, true);
  assert.equal(c.rivals[0].tries, 2);
  // Own challenge can't be accepted.
  assert.throws(() => g.api['challenge/start'](1, { id: ch.id, carId: car1 }), /твій виклик/);
});

test('accept: the first start is free of fuel even with an empty tank; a loss pays the creator a defence (capped per day)', () => {
  const { g, db, user, drag, accept, row, events } = setup();
  user(1, 'Тарас');
  const car1 = g.giveCar(1, byName('Toyota Supra A80')).id;
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(g.api['challenge/create'](1, { raceId: drag(1, car1, 'train', 0.13, ['perfect', 'perfect', 'perfect', 'perfect']).raceId }).challenge.id);
  const slow = byName('Volkswagen Polo');
  const pay = G.defendPay(S.MODELS[byName('Toyota Supra A80')].price);
  const bal0 = row('SELECT balance FROM users WHERE id = 1').balance;
  for (let i = 0; i < 7; i++) {
    const uid = 10 + i;
    user(uid, 'Гість' + i);
    const car = g.giveCar(uid, slow).id;
    db.prepare('UPDATE users SET fuel = 0 WHERE id = ?').run(uid);
    const { res } = accept(uid, ids[i], { carId: car, reaction: 0.4, shifts: ['early', 'late', 'late', 'late'] });
    assert.equal(res.win, false);
    assert.equal(res.prize, 0);
    assert.equal(row('SELECT fuel FROM users WHERE id = ?', uid).fuel, 0, 'the first start took no fuel');
    // The second start needs fuel.
    assert.throws(() => g.api['challenge/start'](uid, { id: ids[i], carId: car }), /Пальне 0/);
  }
  assert.equal(row('SELECT balance FROM users WHERE id = 1').balance - bal0, pay * G.CHALLENGE.defendPays, 'defences paid up to the daily cap');
  assert.equal(events.filter((e) => e.uid === 1 && /Твій привид переміг Гість/.test(e.text)).length, 7, 'every first loss is told');
  assert.equal(events.filter((e) => e.uid === 1 && /Твій привид переміг Гість/.test(e.text) && /\+/.test(e.text)).length, G.CHALLENGE.defendPays);
  const st = g.api['challenge/list'](1).stats;
  assert.equal(st.sent, 7);
  assert.equal(st.accepted, 7);
  assert.equal(st.defended, 7);
  assert.equal(st.beaten, 0);
  assert.deepEqual([g.api['challenge/list'](10).stats.wins, g.api['challenge/list'](10).stats.losses], [0, 1]);
});

test('accept: prized wins are capped per day for the accepter', () => {
  const { g, user, drag, accept, row, refuel } = setup();
  const slow = byName('Volkswagen Polo');
  const ids = [];
  for (let i = 0; i < G.CHALLENGE.winPays + 1; i++) {
    const uid = 20 + i;
    user(uid);
    const car = g.giveCar(uid, slow).id;
    ids.push(g.api['challenge/create'](uid, { raceId: drag(uid, car, 'train', 0.5, ['early', 'late', 'late', 'late']).raceId }).challenge.id);
  }
  user(2);
  const fast = g.giveCar(2, byName('Toyota Supra A80')).id;
  const paid = [];
  for (const id of ids) {
    refuel(2);
    paid.push(accept(2, id, { carId: fast, reaction: 0.13, shifts: ['perfect', 'perfect', 'perfect', 'perfect'] }).res);
  }
  assert.ok(paid.every((r) => r.win));
  const prize = G.winPrize(S.MODELS[slow].price, S.MODELS[byName('Toyota Supra A80')].price);
  assert.deepEqual(paid.map((r) => r.prize), [...Array(G.CHALLENGE.winPays).fill(prize), 0], 'the cheaper car sets the prize; the cap holds');
  assert.equal(paid.at(-1).challenge.capped, true);
  assert.equal(g.api['challenge/get'](2, { id: ids[0] }).winPaysLeft, 0);
  assert.ok(row('SELECT wins FROM users WHERE id = 2').wins >= paid.length, 'ghost races count as races');
});

test('loaner: an empty garage races the challenge\'s model at stock for this race only; with a car of his own — refused', () => {
  const { g, db, user, drag, accept, row } = setup();
  user(1, 'Тарас');
  const supra = byName('Toyota Supra A80');
  const car1 = g.giveCar(1, supra).id;
  db.prepare("INSERT INTO car_parts (car_id, type, tier) VALUES (?, 'eng', ?)").run(car1, S.TIERS[3].id);
  const ch = g.api['challenge/create'](1, { raceId: drag(1, car1).raceId }).challenge;
  assert.ok(ch.car.hp > S.MODELS[supra].hp, 'the creator raced a tuned car');
  user(3, 'Новачок');
  const view = g.api['challenge/get'](3, { id: ch.id });
  assert.equal(view.loaner.model, supra);
  assert.equal(view.loaner.hp, S.carStats({ model: supra }).hp, 'the loaner is stock');
  const { st, res } = accept(3, ch.id, { loaner: true, reaction: 0.13, shifts: ['perfect', 'perfect', 'perfect', 'perfect'] });
  assert.equal(st.car.loaner, true);
  assert.equal(st.car.id, 0);
  assert.equal(row('SELECT COUNT(*) n FROM cars WHERE owner_id = 3').n, 0, 'no car is given');
  assert.equal(res.challenge.loaner, true);
  // A loaner run can be thrown back as a challenge (the car is kept with the race).
  const back = g.api['challenge/create'](3, { raceId: st.raceId }).challenge;
  assert.equal(back.car.model, supra);
  assert.equal(back.car.loaner, true);
  assert.equal(back.time, res.time);
  // With a car in the garage the loaner is refused.
  g.giveCar(3, byName('Volkswagen Polo'));
  assert.equal(g.api['challenge/get'](3, { id: ch.id }).loaner, null);
  assert.throws(() => g.api['challenge/start'](3, { id: ch.id, loaner: true }), /гараж порожній/);
});

test('referral: a new player by ch_<id> becomes the creator\'s referral exactly once, with the ref link\'s rewards; metrics see a challenge', () => {
  const { g, db, user, drag, row, events } = setup();
  user(1, 'Тарас');
  const car1 = g.giveCar(1, byName('Toyota Supra A80')).id;
  const ch = g.api['challenge/create'](1, { raceId: drag(1, car1).raceId }).challenge;
  const r = g.ensureUser({ id: 50, first_name: 'Оля' }, 'ch_' + ch.id);
  assert.deepEqual(r, { created: true, ref: true });
  const u = row('SELECT referrer_id, balance, start_param FROM users WHERE id = 50');
  assert.equal(u.referrer_id, 1);
  assert.equal(u.balance, S.START_BALANCE + S.REF_FRIEND_BONUS);
  assert.equal(row('SELECT count FROM keys WHERE user_id = 50 AND case_id = ?', S.REF_FRIEND_KEY).count, 1);
  assert.equal(u.start_param, 'ch_' + ch.id);
  assert.equal(M.signupSource({ startParam: u.start_param, referrerId: u.referrer_id }), 'challenge');
  assert.ok(events.some((e) => e.uid === 1 && /Оля приєднався за твоїм викликом/.test(e.text)));
  assert.equal(g.api['challenge/get'](1, { id: ch.id }).challenge.recruits, 1);
  // Opening the link again, another challenge or a ref link changes nothing.
  assert.deepEqual(g.ensureUser({ id: 50, first_name: 'Оля' }, 'ch_' + ch.id), { created: false });
  user(2);
  assert.deepEqual(g.ensureUser({ id: 50, first_name: 'Оля' }, 'ref_2'), { created: false });
  assert.equal(row('SELECT referrer_id FROM users WHERE id = 50').referrer_id, 1);
  assert.equal(row('SELECT balance FROM users WHERE id = 50').balance, S.START_BALANCE + S.REF_FRIEND_BONUS);
  assert.equal(g.api['challenge/get'](1, { id: ch.id }).challenge.recruits, 1);
  // An existing player opening a challenge is not a referral; a bad id is ignored.
  assert.deepEqual(g.ensureUser({ id: 2, first_name: 'P2' }, 'ch_' + ch.id), { created: false });
  assert.equal(row('SELECT referrer_id FROM users WHERE id = 2').referrer_id, null);
  assert.deepEqual(g.ensureUser({ id: 51 }, 'ch_zzzzzzzzzz'), { created: true });
  assert.deepEqual(g.ensureUser({ id: 52 }, 'ch_0000000000'), { created: true });
  assert.equal(row('SELECT referrer_id FROM users WHERE id = 52').referrer_id, null);
  // The referral reward at level 3 is paid once, like a ref link's (a race's XP crosses into level 3 twice here).
  const before = row('SELECT balance FROM users WHERE id = 1').balance;
  const car50 = g.giveCar(50, byName('Volkswagen Polo')).id;
  for (let k = 0; k < 2; k++) {
    db.prepare('UPDATE users SET level = 2, xp = ? WHERE id = 50').run(S.xpForLevel(2) - 1);
    drag(50, car50);
    assert.ok(row('SELECT level FROM users WHERE id = 50').level >= 3);
  }
  assert.equal(row('SELECT ref_paid FROM users WHERE id = 50').ref_paid, 1);
  assert.equal(row('SELECT balance FROM users WHERE id = 1').balance - before, S.REF_REWARD);
});

test('expiry: after 7 days the challenge can\'t be started; the link still opens it and the lists mark it', () => {
  const { g, user, drag, accept, advance } = setup();
  user(1, 'Тарас');
  user(2);
  const car1 = g.giveCar(1, byName('Toyota Supra A80')).id;
  const car2 = g.giveCar(2, byName('Toyota Supra A80')).id;
  const ch = g.api['challenge/create'](1, { raceId: drag(1, car1).raceId }).challenge;
  accept(2, ch.id, { carId: car2 });
  advance(G.CHALLENGE.ttlDays * 86400e3);
  const v = g.api['challenge/get'](2, { id: ch.id });
  assert.equal(v.challenge.expired, true);
  assert.throws(() => g.api['challenge/start'](2, { id: ch.id, carId: car2 }), /Термін виклику минув/);
  assert.equal(g.api['challenge/list'](1).sent[0].expired, true);
  assert.equal(g.api['challenge/list'](2).got[0].expired, true);
  assert.throws(() => g.api['challenge/get'](2, { id: 'nope' }), GameError);
  assert.equal(g.challengeInfo(ch.id).expired, true);
});

test('bot: /start ch_<id> names the challenge; inline-ready info; ghost texts', () => {
  const { g, user, drag } = setup();
  user(1, 'Тарас');
  const supra = byName('Toyota Supra A80');
  const ch = g.api['challenge/create'](1, { raceId: drag(1, g.giveCar(1, supra).id).raceId }).challenge;
  const info = g.challengeInfo(ch.id);
  assert.equal(info.who, 'Тарас');
  assert.equal(info.model, supra);
  const txt = startText({ name: 'Оля', created: true, ref: true, challenge: info });
  assert.match(txt, new RegExp(`Тарас кидає тобі виклик: ${G.chTime(ch.time)} с на ${S.MODELS[supra].name}\\. Поб'єш\\?`));
  assert.match(txt, /Прийняти виклик/);
  assert.match(G.challengeCaption(info), /Поб'єш\?/);
  assert.equal(G.challengeLink('avtodrop_bot', '', ch.id), `https://t.me/avtodrop_bot?start=ch_${ch.id}`);
  assert.equal(G.challengeLink('avtodrop_bot', 'play', ch.id), `https://t.me/avtodrop_bot/play?startapp=ch_${ch.id}`);
  assert.equal(G.challengeLink('', 'play', ch.id), '');
  assert.equal(g.challengeInfo('0000000000'), null);
  assert.throws(() => g.challengeCard(2, ch.id, 'a'.repeat(32)), /не твій/);
  assert.equal(g.challengeCard(1, ch.id, 'a'.repeat(32)).id, ch.id);
  assert.equal(g.challengeInfo(ch.id).card, 'a'.repeat(32));
});

test('client sim: clientDrag at 60 fps → create → accept by a 30 fps phone; both runs go through the same checks', () => {
  const { g, user, row, refuel, advance, db } = setup(9);
  user(1);
  user(2);
  const m = byName('BYD Dolphin');
  const c1 = g.giveCar(1, m).id, c2 = g.giveCar(2, m).id;
  refuel(1);
  advance(61e3);
  g.api['race/rivals'](1, { carId: c1 });
  const st = g.api['race/start'](1, { carId: c1, rival: 'easy' });
  const run = clientDrag(st.car, st.greenMs, { reactMs: 210, taps: [400, 1100, 2100, 3300], fps: 60 });
  advance(Math.ceil(run.ms) + 30);
  const res = g.api['race/finish'](1, { raceId: st.raceId, ...run.body });
  const ch = g.api['challenge/create'](1, { raceId: st.raceId }).challenge;
  assert.equal(ch.time, res.time);
  advance(61e3);
  const s2 = g.api['challenge/start'](2, { id: ch.id, carId: c2 });
  const run2 = clientDrag(s2.car, s2.greenMs, { reactMs: 210, taps: [400, 1100, 2100, 3300], fps: 30 });
  advance(Math.ceil(run2.ms) + 30);
  const res2 = g.api['race/finish'](2, { raceId: s2.raceId, ...run2.body });
  assert.equal(res2.rivalTime, ch.time);
  assert.equal(res2.win, res2.time < ch.time);
  assert.equal(row('SELECT tries FROM challenge_tries WHERE challenge_id = ? AND user_id = 2', ch.id).tries, 1);
  assert.equal(JSON.parse(db.prepare('SELECT rival FROM races WHERE id = ?').get(s2.raceId).rival).ghost, ch.id);
});

test('server + bot: /start ch_<id> (referral, «Прийняти виклик» into the game), inline answers, challenge/prepare, config', async () => {
  const { createApp } = await import('../server.js');
  const realFetch = globalThis.fetch;
  const calls = [], updates = [];
  globalThis.fetch = async (u, opts = {}) => {
    if (!String(u).startsWith('https://api.telegram.org/')) return realFetch(u, opts);
    const method = String(u).split('/').pop(), params = JSON.parse(opts.body || '{}');
    calls.push({ method, params });
    let result = true;
    if (method === 'getMe') result = { id: 1, username: 'avtodrop_bot', supports_inline_queries: true };
    else if (method === 'getMyDescription') result = { description: '' };
    else if (method === 'getMyShortDescription') result = { short_description: '' };
    else if (method === 'savePreparedInlineMessage') result = { id: 'prep1' };
    else if (method === 'sendMessage') result = { message_id: 1 };
    else if (method === 'getUpdates') result = await new Promise((r) => setTimeout(() => r(updates.splice(0)), 20));
    return { json: async () => ({ ok: true, result }) };
  };
  const app = createApp({ dbFile: ':memory:', dev: true, token: 'T', webappUrl: 'https://game.example/', log: () => {} });
  const port = await app.start(0);
  const url = (p) => `http://localhost:${port}${p}`;
  const as = (id) => ({ 'x-dev-user': encodeURIComponent(JSON.stringify({ id, first_name: 'U' + id })) });
  const until = async (fn) => {
    for (let i = 0; i < 200; i++) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timeout');
  };
  try {
    app.game.ensureUser({ id: 1, first_name: 'Тарас' });
    const supra = byName('Toyota Supra A80'), st = S.carStats({ model: supra });
    const snap = { model: supra, cls: S.MODELS[supra].cls, hp: st.hp, kg: st.kg, base: st.base, shift: st.shift, parts: {}, look: null };
    const plan = G.ghostPlan(snap, 0.2, [600, 1300, 2300, 3500], ['good', 'good', 'good', 'good']);
    app.db.prepare('INSERT INTO challenges (id, creator_id, race_id, car, run, time, day, created_at, expires_at) VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?)')
      .run('abcdef0123', JSON.stringify(snap), JSON.stringify({ reaction: 0.2, shiftAt: [600, 1300, 2300, 3500], shifts: plan.shifts }), plan.time, '2026-10-22', Date.now(), Date.now() + 7 * 86400e3);
    const cfg = await (await realFetch(url('/api/config'))).json();
    assert.equal(cfg.bot, 'avtodrop_bot');
    assert.equal(cfg.inline, true);
    assert.equal(cfg.app, '');
    // A new player opens the bot by the challenge's link.
    updates.push({ update_id: 1, message: { message_id: 1, from: { id: 9, first_name: 'Оля' }, chat: { id: 9, type: 'private' }, text: '/start ch_abcdef0123' } });
    const sent = await until(() => calls.find((c) => c.method === 'sendMessage' && c.params.chat_id === 9));
    assert.match(sent.params.text, /Тарас кидає тобі виклик: \d+,\d{3} с на Toyota Supra A80\. Поб'єш\?/);
    assert.match(sent.params.text, /запросив друг/);
    assert.equal(sent.params.reply_markup.inline_keyboard[0][0].web_app.url, 'https://game.example/?ch=abcdef0123');
    const u9 = app.db.prepare('SELECT referrer_id, start_param FROM users WHERE id = 9').get();
    assert.deepEqual({ ...u9 }, { referrer_id: 1, start_param: 'ch_abcdef0123' });
    // Inline: no card yet → an article with «Прийняти виклик» and the bot link.
    updates.push({ update_id: 2, inline_query: { id: 'iq1', from: { id: 9 }, query: 'ch_abcdef0123', offset: '' } });
    const ans = await until(() => calls.find((c) => c.method === 'answerInlineQuery' && c.params.inline_query_id === 'iq1'));
    assert.equal(ans.params.results[0].type, 'article');
    assert.equal(ans.params.results[0].reply_markup.inline_keyboard[0][0].url, 'https://t.me/avtodrop_bot?start=ch_abcdef0123');
    // challenge/prepare: only the creator, with a fresh card.
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x46, 0x04, 0x38, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
    const card = await (await realFetch(url('/api/share/card'), { method: 'POST', headers: as(1), body: jpg })).json();
    const prep = (id, body) => realFetch(url('/api/challenge/prepare'), { method: 'POST', headers: { ...as(id), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.match((await (await prep(9, { id: 'abcdef0123', card: card.id })).json()).error, /не твій/);
    assert.match((await (await prep(1, { id: 'abcdef0123', card: 'f'.repeat(32) })).json()).error, /застаріла/);
    const ok = await (await prep(1, { id: 'abcdef0123', card: card.id })).json();
    assert.equal(ok.preparedId, 'prep1');
    assert.equal(ok.link, 'https://t.me/avtodrop_bot?start=ch_abcdef0123');
    const saved = calls.find((c) => c.method === 'savePreparedInlineMessage').params;
    assert.equal(saved.result.photo_url, `https://game.example/share/${card.id}.jpg`);
    assert.equal(saved.result.reply_markup.inline_keyboard[0][0].text, '🏁 Прийняти виклик');
    assert.match(saved.result.caption, /Поб'єш\?/);
    // Inline again: now the card picture.
    updates.push({ update_id: 3, inline_query: { id: 'iq2', from: { id: 9 }, query: 'ch_abcdef0123', offset: '' } });
    const ans2 = await until(() => calls.find((c) => c.method === 'answerInlineQuery' && c.params.inline_query_id === 'iq2'));
    assert.equal(ans2.params.results[0].type, 'photo');
    assert.equal(ans2.params.results[0].photo_url, `https://game.example/share/${card.id}.jpg`);
    // Anything else typed after @bot: an invitation with the player's own link.
    updates.push({ update_id: 4, inline_query: { id: 'iq3', from: { id: 9 }, query: '', offset: '' } });
    const ans3 = await until(() => calls.find((c) => c.method === 'answerInlineQuery' && c.params.inline_query_id === 'iq3'));
    assert.equal(ans3.params.results[0].reply_markup.inline_keyboard[0][0].url, 'https://t.me/avtodrop_bot?start=ref_9');
    // The Mini App's short name switches links to startapp.
    process.env.TG_APP_NAME = 'play';
    assert.equal((await (await realFetch(url('/api/config'))).json()).app, 'play');
    assert.equal((await (await prep(1, { id: 'abcdef0123', card: card.id })).json()).link, 'https://t.me/avtodrop_bot/play?startapp=ch_abcdef0123');
  } finally {
    delete process.env.TG_APP_NAME;
    app.close();
    await new Promise((r) => setTimeout(r, 60));
    globalThis.fetch = realFetch;
  }
});
