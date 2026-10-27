import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

test('changelog: valid file, announced once to owners/admins/helpers', () => {
  const log = JSON.parse(fs.readFileSync(new URL('../src/changelog.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(log) && log.length);
  assert.equal(new Set(log.map((e) => e.id)).size, log.length);
  for (const e of log) assert.ok(e.id && Array.isArray(e.items) && e.items.length && e.items.every((i) => typeof i === 'string'));
  const db = openDb(':memory:');
  const sent = [];
  const game = createGame(db, { admins: [1], notify: () => {} });
  const send = (id, text) => sent.push([id, text]);
  const first = game.announceUpdates(log, { send });
  assert.equal(first.sent, 1);
  assert.equal(first.entries, 1); // a fresh database announces only the newest entry
  assert.ok(sent[0][1].includes(log[0].title || ''));
  assert.ok(sent[0][1].length < 700, 'short Telegram message');
  assert.equal(game.announceUpdates(log, { send }).sent, 0); // not again
  const next = [{ id: 'new', items: ['x'] }, ...log];
  assert.equal(game.announceUpdates(next, { send }).entries, 1);
});
