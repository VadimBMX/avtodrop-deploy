// Regression tests for defects found in the bug hunt (each failed before its fix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, GameError } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

function setup(t0 = Date.parse('2026-10-19T10:00:00Z')) {
  const db = openDb(':memory:');
  let t = t0;
  const clock = { now: () => t, add: (ms) => (t += ms) };
  const g = createGame(db, { now: clock.now, notify: () => {}, random: () => 0.5, allUnlocked: true });
  const mk = (id) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET balance = 1e9, slots = 40 WHERE id = ?').run(id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const plate = (owner, text, value, carId = null) =>
    Number(db.prepare('INSERT INTO plates (owner_id, text, cls, value, car_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(owner, text, 'A', value, carId, t).lastInsertRowid);
  return { db, g, clock, mk, call, plate };
}
const good = Array(S.SHIFTS).fill('good');
const perfect = Array(S.SHIFTS).fill('perfect');
const onlyGameErrors = (fn) => {
  try {
    return fn();
  } catch (e) {
    assert.ok(e instanceof GameError, `expected a GameError, got ${e.constructor.name}: ${e.message}`);
    return null;
  }
};

// ---------- 1. live PvP: a prototype key as a shift makes the time NaN → null, and null always wins ----------
test('BUG-1 live PvP: shift names like "constructor" are rejected and cannot steal the bank', () => {
  const { clock, mk, call, g } = setup();
  mk(1);
  mk(2);
  const fast = g.giveCar(1, 'bugatti-chiron-super-sport' in S.MODELS ? 'bugatti-chiron-super-sport' : S.ALL_MODELS.filter((m) => !m.secret).sort((a, b) => b.price - a.price)[0].id).id;
  const slow = g.giveCar(2, 'vaz-2107').id;
  const bet = 1_000_000;
  const { id } = call(1, 'pvp/create', { carId: fast, bet });
  call(1, 'pulse');
  call(2, 'pvp/request', { id, carId: slow });
  const live = call(1, 'pvp/answer', { id, yes: true });
  const run = honestDrag(live.me.car, live.greenAt - live.startAt, 0.12, perfect);
  clock.add(live.startAt + run.ms - clock.now() + 50);
  call(1, 'pvp/finish', { id, ...run.body }); // the creator drives a perfect race in a far faster car
  for (const bad of ['constructor', 'toString', '__proto__']) {
    onlyGameErrors(() => call(2, 'pvp/finish', { id, reaction: 0.2, shifts: Array(S.SHIFTS).fill(bad) }));
    onlyGameErrors(() => call(2, 'pvp/finish', { id, launch: 3000, shiftAt: [], shifts: Array(S.SHIFTS).fill(bad) }));
  }
  clock.add(60e3);
  const s = call(1, 'pvp/state', { id });
  assert.equal(s.status, 'done');
  assert.equal(s.win, true, 'the faster, perfect driver must win');
  assert.equal(typeof s.rival.run.time, 'number');
});

// ---------- 2. a plate can be pulled off a car that is on the market or at an auction ----------
test('BUG-2 plate/attach cannot take a plate off a car listed on the market or auction', () => {
  const { mk, call, g, plate, db } = setup();
  mk(1);
  mk(2);
  const a = g.giveCar(1, 'vaz-2107').id, b = g.giveCar(1, 'vaz-2107').id;
  g.giveCar(1, 'vaz-2107');
  const pid = plate(1, 'AA 7777 AA', 400000, a);
  call(1, 'market/sell', { carId: a, price: 500000 });
  assert.throws(() => call(1, 'plate/attach', { plateId: pid, carId: b }), GameError);
  const lot = db.prepare('SELECT id FROM listings WHERE car_id = ?').get(a);
  call(2, 'market/buy', { id: lot.id });
  assert.equal(db.prepare('SELECT car_id, owner_id FROM plates WHERE id = ?').get(pid).owner_id, 2, 'the buyer gets the plate they paid for');
});

// ---------- 3. parts / plate removed after a trade offer: the other side gets a stripped car ----------
test('BUG-3a trade room: uninstalling a part from an offered car resets the deal', () => {
  const { mk, call, g } = setup();
  mk(1);
  mk(2);
  const a = g.giveCar(1, 'vaz-2107').id;
  g.giveCar(1, 'vaz-2107');
  g.giveCar(2, 'vaz-2107');
  g.addPart(1, 'eng', 'race', 1);
  call(1, 'parts/install', { carId: a, type: 'eng', tier: 'race' });
  const { id } = call(1, 'room/create', {});
  call(2, 'room/join', { id });
  call(1, 'room/offer', { id, add: a });
  call(2, 'room/offer', { id, money: 100000 });
  const v = call(2, 'room/state', { id }).version;
  assert.equal(call(2, 'room/ready', { id, version: v, ready: true }).done, false); // guest agrees to a car with a Race engine
  call(1, 'parts/uninstall', { carId: a, type: 'eng' }); // host strips it
  const v2 = call(1, 'room/state', { id }).version;
  const r = onlyGameErrors(() => call(1, 'room/ready', { id, version: v2, ready: true }));
  assert.notEqual(r?.done, true, 'the swap must not go through with the car the guest did not agree to');
});
test('BUG-3b direct trade: detaching the plate of an offered car invalidates the offer', () => {
  const { mk, call, g, plate } = setup();
  mk(1);
  mk(2);
  const a = g.giveCar(1, 'vaz-2107').id;
  g.giveCar(1, 'vaz-2107');
  g.giveCar(2, 'vaz-2107');
  const pid = plate(1, 'BB 7777 BB', 400000, a);
  const { id } = call(1, 'trade/create', { to: '2', give: [a], getMoney: 300000 });
  call(1, 'plate/detach', { plateId: pid });
  const r = onlyGameErrors(() => call(2, 'trade/accept', { id }));
  assert.ok(!r || r.stale, 'the offer is stale');
  assert.equal(call(2, 'me').balance, 1e9, 'buyer did not pay for a car without its plate');
});

// ---------- 4. race result uses the car as it is at the finish, not at the start ----------
test('BUG-4a race/finish uses the car stats from the start (no installing parts mid-race)', () => {
  const { mk, call, g, clock } = setup();
  mk(1);
  const a = g.giveCar(1, 'vaz-2107').id;
  g.giveCar(1, 'vaz-2107');
  g.addPart(1, 'eng', 'race', 1);
  const { raceId, car, greenMs } = call(1, 'race/start', { carId: a, rival: 'hard' });
  call(1, 'parts/install', { carId: a, type: 'eng', tier: 'race' });
  const run = honestDrag(car, greenMs, 0.3, good);
  clock.add(run.ms + 50);
  const r = call(1, 'race/finish', { raceId, ...run.body });
  assert.equal(r.time, S.raceTime(car, 0.3, good), 'time must come from the car that started the race');
});
test('BUG-4b race/finish after the car was sold is a clean result, not a server crash', () => {
  const { mk, call, g } = setup();
  mk(1);
  const a = g.giveCar(1, 'vaz-2107').id;
  g.giveCar(1, 'vaz-2107');
  const { raceId } = call(1, 'race/start', { carId: a, rival: 'easy' });
  call(1, 'sell', { carIds: [a] });
  onlyGameErrors(() => call(1, 'race/finish', { raceId, reaction: 0.3, shifts: good }));
});

// ---------- 5. a car from a reward earns income for hours before it was received ----------
test('BUG-5 a reward car does not earn income retroactively (daily bonus car)', () => {
  const { mk, call, g, clock, db } = setup();
  mk(1);
  g.giveCar(1, 'vaz-2107');
  db.prepare('UPDATE users SET income_at = ?, banked = 0, streak = 4, streak_day = ? WHERE id = ?').run(clock.now(), '2026-10-18', 1);
  clock.add(3 * 3600e3);
  const before = call(1, 'me').income.pending;
  const rw = call(1, 'rewards/daily');
  assert.ok(rw.reward.carOut, 'day 5 of the series gives a class C car (DAILY_BONUS[4])');
  const after = call(1, 'me').income.pending;
  assert.ok(after - before <= 1, `pending jumped by ${after - before} the moment the car arrived`);
});

// ---------- 6. roulette field names from Object.prototype crash the handler ----------
test('BUG-6 roulette: a field like "constructor" is a clean error, not a TypeError', () => {
  const { mk, call, db } = setup();
  mk(1);
  db.prepare("INSERT INTO meta (key, value) VALUES ('casino_mode', 'on') ON CONFLICT DO UPDATE SET value = 'on'").run(); // off by default since 22.10
  for (const on of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => call(1, 'casino/roulette', { bets: [{ on, amount: 1000 }] }), /Невідома ставка/);
  }
});

// ---------- 7. one-time items paid twice through Telegram (two invoices) ----------
test('BUG-7 a second Stars payment for the starter pack / pass is flagged for refund, not applied again', () => {
  const { mk, g, call } = setup();
  mk(1);
  const first = g.creditItem({ chargeId: 'c1', userId: 1, itemId: 'starter', stars: 99 });
  assert.ok(!first.refund);
  const bal = call(1, 'me').balance;
  const second = g.creditItem({ chargeId: 'c2', userId: 1, itemId: 'starter', stars: 99 });
  assert.equal(second.refund, true);
  assert.equal(call(1, 'me').balance, bal, 'starter money is not given twice');
  g.creditItem({ chargeId: 'p1', userId: 1, itemId: 'pass', stars: S.SEASON.premiumStars });
  assert.equal(g.creditItem({ chargeId: 'p2', userId: 1, itemId: 'pass', stars: S.SEASON.premiumStars }).refund, true, 'the second pass buys nothing — refund it');
});
test('BUG-5b a sold market lot does not let the seller\'s spare cars earn for the hours before the sale', () => {
  const { mk, call, g, clock, db } = setup();
  mk(1);
  mk(2);
  const a = g.giveCar(1, 'vaz-2107').id;
  for (let i = 0; i < 3; i++) g.giveCar(1, 'vaz-2107');
  db.prepare('UPDATE users SET slots = 3 WHERE id = 1').run();
  call(1, 'market/sell', { carId: a, price: 5000 }); // 3 garage cars, but only slots − listed = 2 earn
  clock.add(3 * 3600e3);
  const before = call(1, 'me').income.pending;
  call(2, 'market/buy', { id: db.prepare('SELECT id FROM listings WHERE car_id = ?').get(a).id });
  const after = call(1, 'me').income.pending;
  assert.ok(after - before <= 1, `seller's pending jumped by ${after - before} at the sale`);
});
