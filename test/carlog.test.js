// Car history (owner 29.10): selling, upgrading, listing and trading cars all land in car_log with the action behind
// them, and the admin player card returns it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

test('car_log: sale, market listing and an admin removal are recorded with their reason', () => {
  const db = openDb(':memory:');
  const t = Date.parse('2026-10-29T12:00:00Z');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {}, allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'Owner' });
  g.ensureUser({ id: 5, first_name: 'P' });
  db.prepare('UPDATE users SET level = 20, slots = 40 WHERE id = 5').run();
  const ids = ['vaz-2107', 'bmw-m3-e30', 'nissan-gt-r-r35'].map((m) => Number(db.prepare(`INSERT INTO cars (owner_id, model, tank, tank_at, created_at, dirt_at, dirt) VALUES (5, ?, 5, 0, ?, 0, 0)`).run(m, t - 3600e3).lastInsertRowid));
  g.api.sell(5, { carIds: [ids[0]] });
  g.api['market/sell'](5, { carId: ids[1], price: 9000000 });
  g.adminCall('tg:1', 'remove-car', { carId: ids[2], confirm: true, reason: 'тест' });
  const log = db.prepare('SELECT * FROM car_log ORDER BY id').all();
  assert.deepEqual(log.map((r) => [r.car_id, r.kind, r.reason]), [
    [ids[0], 'gone', 'sell'],
    [ids[1], 'status', 'market/sell'],
    [ids[2], 'gone', 'admin:remove-car (tg:1)'],
  ]);
  assert.equal(log[1].status_to, 'market');
  assert.equal(log[0].at, t);
  const card = g.adminCall('tg:1', 'user', { id: 5 });
  assert.equal(card.carLog.length, 3);
  assert.equal(card.carLog[0].carId, ids[2]);
  // Outside a call: «system».
  db.prepare('DELETE FROM cars WHERE owner_id = 5').run();
  assert.equal(db.prepare('SELECT reason FROM car_log ORDER BY id DESC').get().reason, 'system');
});
