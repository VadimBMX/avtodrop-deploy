// Owner 29.10 «VIP −40%»: the window once per player, his VIP_SALE.minutes start on vip/sale, both VIP items cost
// −pct while they run (shop list, itemPrice → the invoice), never again after; not for a running subscription.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

test('VIP sale: once per player, 30 minutes of −40% on vipsub and vip, then full price', () => {
  const clock = { t: Date.parse('2026-10-29T10:00:00Z') };
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => clock.t, admins: [1], notify: () => {}, allUnlocked: true });
  g.ensureUser({ id: 7, first_name: 'V' });
  db.prepare('UPDATE users SET level = 5 WHERE id = 7').run();
  assert.deepEqual(g.api.me(7).vipSale, { can: true, pct: S.VIP_SALE.pct });
  assert.equal(g.itemPrice(7, 'vipsub'), S.SHOP_BY_ID.vipsub.stars, 'no discount before the window');
  const s = g.api['vip/sale'](7).sale;
  assert.equal(s.until, clock.t + S.VIP_SALE.minutes * 60e3);
  assert.equal(g.itemPrice(7, 'vipsub'), S.vipSalePrice(S.SHOP_BY_ID.vipsub.stars));
  assert.equal(g.itemPrice(7, 'vip'), S.vipSalePrice(S.SHOP_BY_ID.vip.stars));
  assert.equal(g.itemPrice(7, 'refuel'), S.SHOP_BY_ID.refuel.stars, 'other items untouched');
  const shop = g.api.shop(7);
  assert.equal(shop.items.find((i) => i.id === 'vipsub').price, 299);
  assert.equal(shop.items.find((i) => i.id === 'vipsub').full, 499);
  assert.equal(g.api['vip/sale'](7).sale.until, s.until, 'calling again does not extend it');
  clock.t += S.VIP_SALE.minutes * 60e3 + 1;
  assert.equal(g.itemPrice(7, 'vipsub'), 499);
  assert.equal(g.api.me(7).vipSale, null, 'never again');
  assert.equal(g.api['vip/sale'](7).sale, null);
});

test('VIP sale: not offered with a running subscription, nor after the campaign', () => {
  const clock = { t: Date.parse('2026-10-29T10:00:00Z') };
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => clock.t, admins: [1], notify: () => {}, allUnlocked: true });
  g.ensureUser({ id: 8, first_name: 'S' });
  db.prepare('UPDATE users SET level = 5 WHERE id = 8').run();
  g.creditItem({ chargeId: 'sub1', userId: 8, itemId: 'vipsub', stars: 499, recurring: true, first: true });
  assert.equal(g.api.me(8).vipSale, null);
  g.ensureUser({ id: 9, first_name: 'L' });
  db.prepare('UPDATE users SET level = 5 WHERE id = 9').run();
  clock.t = S.kyivMidnightOf(S.VIP_SALE.until, 1) + 1;
  assert.equal(g.api.me(9).vipSale, null);
});
