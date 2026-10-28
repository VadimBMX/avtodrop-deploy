import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

test('packs on sale; «мега-пропозиція»: from level 3, ×2 hryvnias for 6 h, then not again for 3 days', () => {
  let t = Date.parse('2026-10-28T12:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, notify: () => {}, admins: [1] });
  g.ensureUser({ id: 5, first_name: 'P' });
  db.prepare("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES ('old5', 5, 'p1', 1, 0, 0)").run(); // paid before: no first-buy ×3 here
  const base = g.packAmountFor(5, 'p1');
  assert.equal(base, S.packAmount(S.PACKS.find((p) => p.id === 'p1'), 1, 0));
  assert.equal(g.api.me(5).packOffer, null, 'not at level 1');
  assert.equal(g.api.shop(5).packs.length, S.PACKS.length);
  db.prepare('UPDATE users SET level = 3 WHERE id = 5').run();
  const o = g.api.me(5).packOffer;
  assert.ok(o && o.mult === S.PACK_OFFER.mult);
  assert.equal(g.packAmountFor(5, 'p1'), S.packAmount(S.PACKS.find((p) => p.id === 'p1'), 3, 0) * S.PACK_OFFER.mult);
  assert.equal(g.api.shop(5).offer.until, o.until);
  t += S.PACK_OFFER.hours * 3600e3 + 1000;
  assert.equal(g.api.me(5).packOffer, null, 'over after the hours');
  assert.equal(g.packAmountFor(5, 'p1'), S.packAmount(S.PACKS.find((p) => p.id === 'p1'), 3, 0));
  t += S.PACK_OFFER.everyDays * 86400e3;
  assert.ok(g.api.me(5).packOffer, 'the next one after the pause');
  // A paid invoice credits the amount fixed in it (the offer amount), once.
  const r = g.creditPayment({ chargeId: 'c1', userId: 5, packId: 'p1', stars: 50, amount: g.packAmountFor(5, 'p1') });
  assert.equal(r.amount, S.packAmount(S.PACKS.find((p) => p.id === 'p1'), 3, 0) * 2);
  assert.ok(g.creditPayment({ chargeId: 'c1', userId: 5, packId: 'p1', stars: 50, amount: 1 }).duplicate);
});

test('first Stars purchase: the first pack gives ×FIRST_BUY_MULT (not on top of the offer), then the usual amount', () => {
  const t = Date.parse('2026-10-28T12:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, notify: () => {}, admins: [1] });
  g.ensureUser({ id: 7, first_name: 'F' });
  db.prepare('UPDATE users SET level = 3 WHERE id = 7').run();
  g.api.me(7); // the offer (×2) starts too
  const base = S.packAmount(S.PACKS.find((p) => p.id === 'p1'), 3, 0);
  assert.equal(g.packAmountFor(7, 'p1'), base * S.FIRST_BUY_MULT);
  assert.equal(g.api.shop(7).firstBuy, S.FIRST_BUY_MULT);
  g.creditPayment({ chargeId: 'f1', userId: 7, packId: 'p1', stars: 50, amount: g.packAmountFor(7, 'p1') });
  assert.equal(g.packAmountFor(7, 'p1'), base * S.PACK_OFFER.mult, 'back to the offer');
  assert.equal(g.api.shop(7).firstBuy, 0);
});

test('«Угода дня»: today’s deal only, once a Kyiv day, from level DAY_DEAL_MIN_LEVEL', () => {
  let t = Date.parse('2026-10-28T12:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, notify: () => {}, admins: [1] });
  g.ensureUser({ id: 8, first_name: 'D' });
  assert.equal(g.api.shop(8).dayDeal, null, 'level 1: none');
  db.prepare('UPDATE users SET level = 5 WHERE id = 8').run();
  const dd = g.api.shop(8).dayDeal;
  assert.equal(dd.id, S.dayDealOf(t).id);
  const other = S.DAY_DEALS.find((d) => d.id !== dd.id);
  assert.throws(() => g.itemPrice(8, other.id), /минула/);
  assert.equal(g.itemPrice(8, dd.id), dd.stars);
  const keys = () => db.prepare('SELECT COALESCE(SUM(count), 0) n FROM keys WHERE user_id = 8').get().n;
  const k0 = keys();
  g.creditItem({ chargeId: 'd1', userId: 8, itemId: dd.id, stars: dd.stars });
  assert.ok(keys() > k0, 'keys arrived');
  assert.ok(g.api.shop(8).dayDeal.taken);
  assert.throws(() => g.itemPrice(8, dd.id), /вже взяв/);
  t += 86400e3;
  const next = g.api.shop(8).dayDeal;
  assert.ok(!next.taken && next.id !== dd.id, 'a new one tomorrow');
});
