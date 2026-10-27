import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'U1' });
  db.prepare('UPDATE users SET balance = 1e13, slots = 100000, level = 99, level_seen = 99, cases_opened = 100 WHERE id = 1').run();
  return { db, g, call: (name, body = {}) => g.api[name](1, body) };
}

// Admin-set drops («Гарантована машина») and admin luck («Підкрутка») were removed (owner 27.10): see test/security.test.js.

test('races: a dearer car always races for more, whatever its class', () => {
  const cars = [...S.ALL_MODELS].sort((a, b) => a.price - b.price);
  for (let i = 1; i < cars.length; i++) {
    for (const op of S.OPPONENTS) {
      assert.ok(S.raceMoney(op, cars[i].price).prize >= S.raceMoney(op, cars[i - 1].price).prize, `${cars[i].name} vs ${cars[i - 1].name}`);
    }
  }
  const hard = S.OPPONENTS[2];
  assert.ok(S.raceMoney(hard, S.MODELS['ferrari-sf90-stradale'].price).prize > S.raceMoney(hard, S.MODELS['ferrari-458-italia'].price).prize);
});
