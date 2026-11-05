// r3 (launch rehearsal 05.11): races are read by player on every rivals list (myForm) and every race start (expire the
// running one) — an index, not a scan of the whole table (310k rows ≈ a month of Season 2: 116 ms → 1.3 ms per start).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';

test('races by player use the races_user index (myForm, race/start expire)', () => {
  const db = openDb(':memory:');
  const plan = (sql) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((r) => r.detail).join(' | ');
  assert.match(plan("SELECT rival, result FROM races WHERE user_id = ? AND status = 'done' ORDER BY id DESC LIMIT 60"), /races_user/);
  assert.match(plan("UPDATE races SET status = 'expired' WHERE user_id = ? AND status = 'running'"), /races_user/);
});
