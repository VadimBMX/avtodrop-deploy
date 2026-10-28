import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

test('packs grow with level and garage, never below the base amount', () => {
  const p = S.PACKS[0];
  assert.equal(S.packAmount(p, 1, 0), p.amount, 'a newcomer gets the base amount');
  assert.ok(S.packAmount(p, 10, 0) > p.amount * 5, 'level 10 gets several times more');
  assert.ok(S.packAmount(p, 5, 17e9) > 100 * p.amount, 'a 17B garage makes the pack worth it');
  assert.ok(S.packAmount(p, 10, 1e9) > S.packAmount(p, 10, 1e8));
});

test('payment credits the amount fixed in the invoice; a broken amount falls back to the current one', () => {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-20T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 0, level = 10, level_seen = 10, pack_offer_next = 9e15 WHERE id = 1').run(); // no «мега-пропозиція» here
  const amount = g.packAmountFor(1, 'p1');
  assert.equal(amount, S.packAmount(S.PACKS[0], 10, 0));
  g.creditPayment({ chargeId: 'c1', userId: 1, packId: 'p1', stars: 50, amount });
  assert.equal(g.api.me(1).balance, amount);
  assert.deepEqual(g.creditPayment({ chargeId: 'c1', userId: 1, packId: 'p1', stars: 50, amount }), { duplicate: true });
  g.creditPayment({ chargeId: 'c2', userId: 1, packId: 'p1', stars: 50, amount: 1 }); // below the base: ignored
  assert.equal(g.api.me(1).balance, amount * 2);
});
