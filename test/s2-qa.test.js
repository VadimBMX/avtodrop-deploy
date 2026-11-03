// s2-qa: odd request bodies get a game error (400), never a server error (500).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, GameError } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-11-03T12:00:00Z'), notify: () => {}, admins: [1] });
  g.ensureUser({ id: 1, first_name: 'A' });
  return { db, g };
}

test('s2-qa: «Стиль» with an Object.prototype name is an unknown item, not a crash', () => {
  const { g } = setup();
  assert.equal(S.cosmeticOf('toString'), null);
  assert.equal(S.cosmeticOf('constructor'), null);
  assert.throws(() => g.api['style/equip'](1, { slot: 'frame', id: 'toString' }), GameError);
});

test('s2-qa: admin calls with a non-number player id answer normally', () => {
  const { g } = setup();
  for (const id of [[1], { a: 1 }]) assert.doesNotThrow(() => g.adminCall('key', 'overview', { id }));
  // a string id (the panel's inputs) still refreshes that player
  assert.doesNotThrow(() => g.adminCall('key', 'money', { id: '1', amount: 1000, confirm: true }));
});
