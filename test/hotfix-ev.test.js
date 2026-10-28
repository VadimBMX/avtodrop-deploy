import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

test('origin sell hotfix: cars from the dear cases made before it keep the full rate (origin cleared once)', () => {
  const db = openDb(':memory:');
  db.exec("INSERT INTO meta (key, value) VALUES ('secret_backfill_1', '1') ON CONFLICT DO NOTHING");
  let g = createGame(db, { notify: () => {} });
  g.ensureUser({ id: 5, first_name: 'P' });
  // Simulate an old car from «Еліта» made before the fix: reset the flag and the origin, create the game again.
  db.prepare("DELETE FROM meta WHERE key = 'origin_sell_fix_1'").run();
  const id = Number(db.prepare("INSERT INTO cars (owner_id, model, tank, tank_at, created_at, dirt_at, origin) VALUES (5, 'mclaren-570s', 5, 0, 0, 0, 'elite')").run().lastInsertRowid);
  db.prepare("INSERT INTO cars (owner_id, model, tank, tank_at, created_at, dirt_at, origin) VALUES (5, 'mclaren-570s', 5, 0, 0, 0, 'c-jp')").run();
  g = createGame(db, { notify: () => {} });
  assert.equal(db.prepare('SELECT origin FROM cars WHERE id = ?').get(id).origin, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cars WHERE origin = 'c-jp'").get().n, 1, 'other origins untouched');
  // Runs once: a new «Еліта» car keeps its origin.
  db.prepare("UPDATE cars SET origin = 'elite' WHERE id = ?").run(id);
  g = createGame(db, { notify: () => {} });
  assert.equal(db.prepare('SELECT origin FROM cars WHERE id = ?').get(id).origin, 'elite');
});
