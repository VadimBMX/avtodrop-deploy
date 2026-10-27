import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

test('outbox: waits for an unknown username, then goes once', () => {
  const file = JSON.parse(fs.readFileSync(new URL('../src/outbox.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(file) && file.every((m) => m.id && m.username && m.text));
  const db = openDb(':memory:');
  const game = createGame(db, { admins: [1], notify: () => {} });
  const sent = [];
  const send = (id, t) => sent.push([id, t]);
  const box = [{ id: 'x', username: '@Agent_1', text: 'hello' }];
  assert.equal(game.deliverOutbox(box, { send }).sent, 0);
  assert.ok(sent.some(([id, t]) => id === 1 && t.includes('чекає')));
  game.ensureUser({ id: 555, username: 'agent_1', first_name: 'A' });
  assert.equal(game.deliverOutbox(box, { send }).sent, 1);
  assert.ok(sent.some(([id, t]) => id === 555 && t === 'hello'));
  assert.equal(game.deliverOutbox(box, { send }).sent, 0);
});
