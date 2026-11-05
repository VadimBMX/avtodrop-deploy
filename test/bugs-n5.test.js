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
