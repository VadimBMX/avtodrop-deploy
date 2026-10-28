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
  const base = g.packAmountFor(5, 'p1');
  assert.equal(base, S.packAmount(S.PACKS[0], 1, 0));
  assert.equal(g.api.me(5).packOffer, null, 'not at level 1');
  assert.equal(g.api.shop(5).packs.length, S.PACKS.length);
  db.prepare('UPDATE users SET level = 3 WHERE id = 5').run();
  const o = g.api.me(5).packOffer;
  assert.ok(o && o.mult === S.PACK_OFFER.mult);
  assert.equal(g.packAmountFor(5, 'p1'), S.packAmount(S.PACKS[0], 3, 0) * S.PACK_OFFER.mult);
  assert.equal(g.api.shop(5).offer.until, o.until);
  t += S.PACK_OFFER.hours * 3600e3 + 1000;
  assert.equal(g.api.me(5).packOffer, null, 'over after the hours');
  assert.equal(g.packAmountFor(5, 'p1'), S.packAmount(S.PACKS[0], 3, 0));
  t += S.PACK_OFFER.everyDays * 86400e3;
  assert.ok(g.api.me(5).packOffer, 'the next one after the pause');
  // A paid invoice credits the amount fixed in it (the offer amount), once.
  const r = g.creditPayment({ chargeId: 'c1', userId: 5, packId: 'p1', stars: 50, amount: g.packAmountFor(5, 'p1') });
  assert.equal(r.amount, S.packAmount(S.PACKS[0], 3, 0) * 2);
  assert.ok(g.creditPayment({ chargeId: 'c1', userId: 5, packId: 'p1', stars: 50, amount: 1 }).duplicate);
});
