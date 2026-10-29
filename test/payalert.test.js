// Owner 28.10: a real Stars payment is told to the owner(s) and to @gavryl11uk only — not to other admins/helpers,
// not on a repeated charge, not on a refund.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

test('pay alert: owner + @gavryl11uk hear about a donation, nobody else; repeats and refunds are silent', () => {
  const sent = [];
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-29T12:00:00Z'), admins: [1], notify: (id, text) => sent.push([id, text]), allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'Owner' });
  g.ensureUser({ id: 2, first_name: 'Гаврилюк', username: 'Gavryl11uk' });
  g.ensureUser({ id: 3, first_name: 'Helper' });
  g.ensureUser({ id: 9, first_name: 'Петро', username: 'petro' });
  db.prepare("UPDATE users SET role = 'helper' WHERE id = 3").run();
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 2").run();
  const alerts = () => sent.filter(([, t]) => t.startsWith('💰'));
  g.creditPayment({ chargeId: 'c1', userId: 9, packId: 'p1', stars: 50 });
  assert.deepEqual(alerts().map(([id]) => id).sort(), [1, 2]);
  assert.match(alerts()[0][1], /Петро \(@petro\), ID 9 купив пакет .* — ⭐ 50/);
  g.creditPayment({ chargeId: 'c1', userId: 9, packId: 'p1', stars: 50 }); // the same charge again
  assert.equal(alerts().length, 2);
  g.creditItem({ chargeId: 'c2', userId: 9, itemId: 'starter', stars: 39 });
  assert.equal(alerts().length, 4);
  assert.match(alerts()[3][1], /купив «Стартовий пакет» — ⭐ 39/);
  g.creditItem({ chargeId: 'c3', userId: 9, itemId: 'starter', stars: 39 }); // once-only → refund, no alert
  assert.equal(alerts().length, 4);
});

test('pay alert: the admin test button finds @gavry11uik and says which handles are not in the game', () => {
  const sent = [];
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-29T12:00:00Z'), admins: [1], notify: (id, text) => sent.push([id, text]), allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'Owner' });
  g.ensureUser({ id: 5, first_name: 'Гаврилюк', username: 'gavry11uik' });
  const r = g.admin['payalert/test']('key', {});
  assert.deepEqual(r.found.map((u) => u.id).sort(), [1, 5]);
  assert.ok(!r.missing.includes('gavry11uik') && r.missing.includes('gavryl11uk'));
  assert.deepEqual(sent.filter(([, t]) => t.startsWith('🧪')).map(([id]) => id).sort(), [1, 5]);
});
