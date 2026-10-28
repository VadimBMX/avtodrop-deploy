// Owner 28.10: the tank ran dry → «Повний бак зі знижкою» (S.FUEL_DEAL, item refuel_deal) for a while, once per everyH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

test('fuel deal: starts only on an empty tank, lasts FUEL_DEAL.minutes, cheaper item, once per everyH', () => {
  const clock = { t: Date.parse('2026-11-06T12:00:00Z') };
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => clock.t, admins: [1], notify: () => {}, allUnlocked: true });
  g.ensureUser({ id: 5, first_name: 'U' });
  db.prepare('UPDATE users SET level = 5, level_seen = 5, fuel = 3, fuel_at = ? WHERE id = 5').run(clock.t);
  assert.equal(g.api['fuel/deal'](5).deal, null, 'fuel left — no deal');
  assert.throws(() => g.itemPrice(5, 'refuel_deal'), /закінчилась/);
  db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = 5').run(clock.t);
  const d = g.api['fuel/deal'](5).deal;
  assert.ok(d && d.stars < d.full && d.until === clock.t + S.FUEL_DEAL.minutes * 60e3);
  assert.equal(g.api.me(5).fuelDeal.until, d.until);
  assert.equal(g.itemPrice(5, 'refuel_deal'), S.SHOP_BY_ID.refuel_deal.stars);
  g.creditItem({ chargeId: 'c1', userId: 5, itemId: 'refuel_deal', stars: d.stars });
  const u = db.prepare('SELECT fuel, fuel_deal_until FROM users WHERE id = 5').get();
  assert.ok(u.fuel > 0 && u.fuel_deal_until === 0, 'tank full, deal used up');
  db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = 5').run(clock.t);
  assert.equal(g.api['fuel/deal'](5).deal, null, 'not again within everyH');
  clock.t += S.FUEL_DEAL.everyH * 3600e3 + 1;
  db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = 5').run(clock.t);
  assert.ok(g.api['fuel/deal'](5).deal, 'again after everyH');
});
