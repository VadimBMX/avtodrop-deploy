import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-14T10:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {} });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const rich = (id) => db.prepare('UPDATE users SET balance = 1e13, slots = 40, level = 99, level_seen = 99 WHERE id = ?').run(id);
  return { db, g, mk, call, rich, advance: (ms) => (t += ms) };
}

test('dealer: restocks every few hours with marked-up, non-secret cars', () => {
  const { mk, call, advance } = setup();
  mk(1);
  const first = call(1, 'market/list').list.filter((l) => l.dealer);
  assert.equal(first.length, S.DEALER.lots);
  for (const l of first) {
    const m = S.MODELS[l.car.model];
    assert.ok(!m.secret, 'never secret cars');
    assert.equal(l.seller, 'Дилер АВТОДРОП');
    assert.ok(l.price >= m.price * S.DEALER.deal[0] * 0.99 && l.price <= m.price * S.DEALER.markup[1] * 1.01, `${m.name} ${l.price}`);
  }
  // Same batch: the same lots. Next batch: a fresh set.
  assert.deepEqual(call(1, 'market/list').list.filter((l) => l.dealer).map((l) => l.id), first.map((l) => l.id));
  advance(S.DEALER.hours * 3600e3);
  const next = call(1, 'market/list').list.filter((l) => l.dealer);
  assert.equal(next.length, S.DEALER.lots);
  assert.ok(next.every((l) => !first.some((f) => f.id === l.id)));
});

test('dealer: purchases are a money sink and limited per player per batch', () => {
  const { db, mk, call, rich, advance } = setup();
  mk(1);
  mk(2);
  rich(1);
  rich(2);
  let lots = call(1, 'market/list').list.filter((l) => l.dealer);
  const moneyBefore = db.prepare('SELECT SUM(balance) n FROM users').get().n;
  for (let i = 0; i < S.DEALER.perPlayer; i++) call(1, 'market/buy', { id: lots[i].id });
  const spent = lots.slice(0, S.DEALER.perPlayer).reduce((s, l) => s + l.price, 0);
  assert.ok(Math.abs(db.prepare('SELECT SUM(balance) n FROM users').get().n - (moneyBefore - spent)) < 1, 'nobody received the money');
  assert.equal(call(1, 'me').cars.length, S.DEALER.perPlayer);
  assert.throws(() => call(1, 'market/buy', { id: lots[S.DEALER.perPlayer].id }), /можна купити/);
  assert.equal(call(1, 'market/list').dealer.left, 0);
  call(2, 'market/buy', { id: lots[S.DEALER.perPlayer].id }); // another player still can
  assert.throws(() => call(2, 'market/buy', { id: lots[0].id }), /продано/);
  advance(S.DEALER.hours * 3600e3);
  assert.equal(call(1, 'market/list').dealer.left, S.DEALER.perPlayer, 'limit resets with the next batch');
  // Unsold cars of the old batch are gone, bought ones stay with their owners.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cars WHERE owner_id = 0').get().n, S.DEALER.lots);
  assert.equal(call(1, 'me').cars.length, S.DEALER.perPlayer);
});

test('dealer: admin can restock now and remove a dealer lot', () => {
  const { g, mk, call } = setup();
  mk(1);
  const before = call(1, 'market/list').list.filter((l) => l.dealer).map((l) => l.id);
  g.admin['dealer/refresh']('key', {});
  const after = g.admin.market('key').listings.filter((l) => l.seller.id === 0);
  assert.equal(after.length, S.DEALER.lots);
  assert.ok(after.every((l) => !before.includes(l.id)));
  g.admin['market/remove']('key', { kind: 'listing', id: after[0].id });
  assert.equal(g.admin.market('key').listings.filter((l) => l.seller.id === 0).length, S.DEALER.lots - 1);
  assert.equal(g.admin.overview('key').cars, 0, 'dealer stock is not counted as players’ cars');
});
