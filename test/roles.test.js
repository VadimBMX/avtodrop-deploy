import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-20T10:00:00Z'), notify: () => {}, admins: [1] });
  for (const id of [1, 2, 3, 4]) g.ensureUser({ id, first_name: 'U' + id });
  return { db, g };
}

test('roles: the owner gives admin and helper; a helper can only look, answer support and write', () => {
  const { g } = setup();
  assert.equal(g.roleOf(1), 'owner');
  assert.equal(g.roleOf(2), null);
  g.admin.role('tg:1', { id: 2, role: 'admin' });
  g.admin.role('tg:1', { id: 3, role: 'helper' });
  assert.equal(g.roleOf(2), 'admin');
  assert.equal(g.roleOf(3), 'helper');
  // Helper: allowed to look and write, not to give money.
  assert.ok(g.admin.users('tg:3', {}).list.length);
  g.admin.message('tg:3', { id: 4, text: 'Привіт' });
  assert.throws(() => g.admin.money('tg:3', { id: 4, amount: 1000 }), /Немає прав/);
  assert.throws(() => g.admin.role('tg:3', { id: 4, role: 'helper' }), /Немає прав/);
  // Admin: everything, can give helper, can't give admin or touch the owner.
  g.admin.money('tg:2', { id: 4, amount: 1000 });
  g.admin.role('tg:2', { id: 4, role: 'helper' });
  assert.throws(() => g.admin.role('tg:2', { id: 4, role: 'admin' }), /лише власник/);
  assert.throws(() => g.admin.role('tg:2', { id: 1, role: null }), /власник гри/);
  // Someone without a role can't do anything.
  assert.throws(() => g.admin.users('tg:999', {}), /Немає прав/);
  g.admin.role('tg:1', { id: 3, role: null });
  assert.equal(g.roleOf(3), null);
});
