// Regression tests for the defects found by the 05.11 fuzz / property run (tools/fuzz-api.mjs); each failed before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, GameError } from '../src/game.js';

function setup(t0 = Date.parse('2026-11-05T10:00:00Z')) {
  const db = openDb(':memory:');
  let t = t0;
  const clock = { now: () => t, add: (ms) => (t += ms), set: (x) => (t = x) };
  const g = createGame(db, { now: clock.now, notify: () => {}, random: () => 0.5, allUnlocked: true });
  const mk = (id) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET balance = 1e9, slots = 40 WHERE id = ?').run(id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const err = (fn) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof GameError, `expected a GameError, got ${e?.constructor?.name}: ${e?.message}`);
      return e.message;
    }
    assert.fail('expected a refusal');
  };
  const bal = (id) => db.prepare('SELECT balance FROM users WHERE id = ?').get(id).balance;
  const pvp = (id) => db.prepare('SELECT * FROM pvp WHERE id = ?').get(id);
  return { db, g, clock, mk, call, err, bal, pvp };
}

// ---------- N5-1: a PvP challenge whose car left the garage stayed open forever ----------
test('N5-1a selling the car of an open PvP challenge cancels it and refunds the bet', () => {
  const { g, mk, call, err, bal, pvp } = setup();
  mk(1), mk(2);
  const a = g.giveCar(1, 'vaz-2107').id;
  g.giveCar(1, 'vaz-2107');
  const b = g.giveCar(2, 'vaz-2107').id;
  const before = bal(1);
  const { id } = call(1, 'pvp/create', { carId: a, bet: 100000 });
  const { got } = call(1, 'sell', { carIds: [a] });
  assert.equal(pvp(id).status, 'cancelled');
  assert.equal(call(2, 'pvp/list').open.length, 0, 'the dead challenge is not in the list');
  err(() => call(2, 'pvp/accept', { id, carId: b }));
  assert.equal(bal(1), before + got, 'the bet came back (and only once)');
});
test('N5-1b «виклик скасовано» really cancels: the refusal keeps the cancel and the refund', () => {
  const { db, g, mk, call, err, bal, pvp } = setup();
  mk(1), mk(2);
  const a = g.giveCar(1, 'vaz-2107').id;
  g.giveCar(1, 'vaz-2107');
  const b = g.giveCar(2, 'vaz-2107').id;
  for (const how of ['pvp/accept', 'pvp/request']) {
    const { id } = call(1, 'pvp/create', { carId: a, bet: 100000 });
    const before = bal(1);
    db.prepare("UPDATE cars SET status = 'showcase' WHERE id = ?").run(a); // the car left the garage by any path
    assert.match(err(() => call(2, how, { id, carId: b })), /скасовано/);
    assert.equal(pvp(id).status, 'cancelled', `${how}: the cancel was rolled back with the error`);
    assert.equal(bal(1), before + 100000, `${how}: the bet goes back to the creator`);
    err(() => call(2, how, { id, carId: b })); // a second try pays nothing more
    assert.equal(bal(1), before + 100000);
    db.prepare("UPDATE cars SET status = 'garage' WHERE id = ?").run(a);
  }
});
test('N5-1c pvp/answer with a car gone gives the asker his bet back at once (not after the 25 s sweep)', () => {
  const { db, g, mk, call, err, bal, pvp } = setup();
  mk(1), mk(2);
  const a = g.giveCar(1, 'vaz-2107').id;
  const b = g.giveCar(2, 'vaz-2107').id;
  g.giveCar(2, 'vaz-2107');
  const { id } = call(1, 'pvp/create', { carId: a, bet: 100000 });
  call(1, 'pulse');
  const before = bal(2);
  call(2, 'pvp/request', { id, carId: b });
  assert.equal(bal(2), before - 100000);
  db.prepare("UPDATE cars SET status = 'showcase' WHERE id = ?").run(b);
  err(() => call(1, 'pvp/answer', { id, yes: true }));
  assert.equal(pvp(id).status, 'open', 'back to the list');
  assert.equal(bal(2), before, 'the asker has his bet back');
});
test('N5-1d admin reset of a creator with a pending challenge refunds the asker once and keeps the reset account at the start money', () => {
  const { db, g, mk, call, bal, pvp, clock } = setup();
  mk(1), mk(2);
  const a = g.giveCar(1, 'vaz-2107').id;
  const b = g.giveCar(2, 'vaz-2107').id;
  g.giveCar(2, 'vaz-2107');
  const { id } = call(1, 'pvp/create', { carId: a, bet: 100000 });
  call(1, 'pulse');
  const before = bal(2);
  call(2, 'pvp/request', { id, carId: b });
  g.adminCall('local', 'reset', { id: 1, confirm: true });
  const start = bal(1);
  assert.equal(pvp(id).status, 'cancelled');
  assert.equal(bal(2), before, 'the asker got his bet back');
  clock.add(60e3);
  call(2, 'pvp/list');
  assert.equal(bal(2), before, '… only once');
  assert.equal(bal(1), start, 'the reset account got no pre-reset bet back');
  void db;
});

// ---------- N5-2: boss/start with a prototype name as the boss was a server error ----------
test('N5-2 boss/start: «valueOf» / «constructor» as the boss is a clean refusal, not a 500', () => {
  const { g, mk, call, err } = setup();
  mk(1);
  const c = g.giveCar(1, 'vaz-2107').id;
  for (const boss of ['valueOf', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.match(err(() => call(1, 'boss/start', { carId: c, boss })), /Невідомий бос/);
});

// ---------- N5-3: upgrade with a prototype name as the target burned the cars at a NaN chance ----------
test('N5-3 upgrade: «toString» as the target is refused and the cars stay', () => {
  const { db, g, mk, call, err } = setup();
  mk(1);
  const a = g.giveCar(1, 'vaz-2107').id;
  g.giveCar(1, 'vaz-2107');
  for (const target of ['toString', 'constructor', 'valueOf', '__proto__']) assert.match(err(() => call(1, 'upgrade', { carIds: [a], target })), /машину-ціль/);
  assert.ok(db.prepare('SELECT 1 FROM cars WHERE id = ?').get(a), 'the car is still there');
});
test('N5-3b admin: give-car / keys / part / battle with a prototype name are refused (no broken rows)', () => {
  const { db, g, mk, call, err } = setup();
  mk(1);
  const adm = (name, body) => err(() => g.adminCall('local', name, { confirm: true, ...body }));
  adm('give-car', { id: 1, model: 'constructor' });
  adm('keys', { id: 1, caseId: 'constructor', count: 1 });
  adm('part', { id: 1, type: 'constructor', tier: 'constructor', count: 1 });
  err(() => call(1, 'battle/create', { caseId: 'constructor', count: 1 }));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cars WHERE model = 'constructor'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM keys WHERE case_id = 'constructor'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM parts WHERE type = 'constructor'").get().n, 0);
});

// ---------- N5-4: an admin reset left the player leading on «Причал»: the old bid came back to the fresh account ----------
test('N5-4 admin reset / ban of a container leader: no pre-reset bid back on an outbid, no car won; a ban refunds once', async () => {
  const C = await import('../public/containers.js');
  const R = C.CONTAINER_RULES;
  let t = Date.parse('2026-10-23T10:00:00Z'), n = 7;
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], random: () => 0.5, notify() {}, containerSeed: () => (n = (n * 48271) % 2147483647) });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id }), db.prepare('UPDATE users SET level = 12, level_seen = 12, balance = 50e6 WHERE id = ?').run(id));
  [5, 6, 7].forEach(mk);
  const call = (u, k, b = {}) => g.api[k](u, b);
  const bal = (u) => db.prepare('SELECT balance FROM users WHERE id = ?').get(u).balance;
  const mute = (id) => {
    const L = db.prepare('SELECT bots FROM container_lots WHERE id = ?').get(id);
    db.prepare('UPDATE container_lots SET bots = ?, pending = NULL WHERE id = ?').run(JSON.stringify(JSON.parse(L.bots).map((b) => ({ ...b, max: 0 }))), id);
  };
  const lots = call(6, 'containers').lots.filter((x) => x.status === 'waiting');
  const [a, b] = lots;
  mute(a.id), mute(b.id);
  // reset: the leader's bid is gone with his balance
  const d = call(5, 'containers/bid', { id: a.id, amount: a.minBid });
  g.adminCall('tg:1', 'reset', { id: 5, confirm: true, reason: 'тест' });
  const start = bal(5);
  t += 2000;
  call(6, 'containers/bid', { id: a.id, amount: d.lot.minBid });
  assert.equal(bal(5), start, 'the reset account got its old bid back on the outbid');
  // ban: the bid comes back once, the lot is won by nobody
  const before = bal(7);
  call(7, 'containers/bid', { id: b.id, amount: b.minBid });
  g.adminCall('tg:1', 'ban', { id: 7, banned: true, confirm: true, reason: 'тест' });
  assert.equal(bal(7), before, 'the banned player has his held bid back');
  t += R.maxLiveMs + 60e3;
  call(6, 'containers/lot', { id: b.id });
  assert.equal(db.prepare('SELECT status FROM container_lots WHERE id = ?').get(b.id).status, 'done');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cars WHERE owner_id = 7 AND origin = 'container'").get().n, 0, 'the banned player won no car');
  assert.equal(bal(7), before, '… and no second refund');
});
