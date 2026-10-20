import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

const L = JSON.parse((await import('node:fs')).readFileSync(new URL('../src/legacy.json', import.meta.url), 'utf8'));
const tg = (p) => ({ id: p.id, username: p.username, first_name: p.firstName });

test('legacy import: inviters restored without new rewards, donors thanked once, payments recorded once', () => {
  const db = openDb(':memory:');
  const pre = L.players.find((p) => p.referrerId);
  const inviter = L.players.find((p) => p.id === pre.referrerId);
  // The inviter already plays on the new server before the import.
  let g = createGame(db);
  g.ensureUser(tg(inviter));
  g.ensureUser(tg(pre));
  g = createGame(db); // restart: the import runs now
  const row = db.prepare('SELECT referrer_id, ref_paid FROM users WHERE id = ?').get(pre.id);
  assert.equal(row.referrer_id, pre.referrerId);
  assert.equal(row.ref_paid, 1);
  const donor = L.payments[0].userId;
  const before = db.prepare('SELECT balance FROM users WHERE id = ?').get(donor)?.balance;
  g.ensureUser(tg(L.players.find((p) => p.id === donor)));
  g.ensureUser(tg(L.players.find((p) => p.id === donor)));
  const gifts = db.prepare("SELECT kind FROM gifts WHERE user_id = ? AND kind = 'thanks'").all(donor);
  assert.equal(gifts.length, 1, 'thanked exactly once');
  if (before != null) assert.equal(db.prepare('SELECT balance FROM users WHERE id = ?').get(donor).balance, before, 'no money gift');
  createGame(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments WHERE charge_id LIKE 'legacy:%'").get().n, L.payments.length);
  // A new legacy player keeps their old inviter even with someone else's ref link.
  const late = L.players.find((p) => p.referrerId && p.id !== pre.id && p.referrerId === inviter.id) || null;
  if (late) {
    g.ensureUser(tg(late), 'ref_' + pre.id);
    assert.equal(db.prepare('SELECT referrer_id FROM users WHERE id = ?').get(late.id).referrer_id, inviter.id);
  }
});
