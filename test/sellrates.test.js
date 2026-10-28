import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';

test('sell rates: owner decision 22.10 (3rd) — grey 50, blue 45, purple 40, gold 35, red 30 %; owner 28.10: a buy-back share only on the dear cases that were above 1', () => {
  assert.deepEqual(S.SELL_RATES, { D: 0.5, C: 0.45, B: 0.4, A: 0.35, S: 0.3, X: 0.3 });
  for (const cs of S.CASES) assert.ok(S.originSellOf(cs.id) <= 1 && S.originSellOf(cs.id) >= 0.6, cs.id);
  for (const id of ['city', 'sport', 'premium', 'elite', 'c-it', 'c-us', 'c-gb']) assert.ok(S.originSellOf(id) < 1, id);
  assert.equal(S.originSellOf(null), 1); // cars not from a case (and old ones, origin cleared) — the full rate
});

test('qa2: the drop prices shown (reel, «Що всередині») include the case buy-back share', () => {
  const m = S.ALL_MODELS.find((x) => x.cls === 'A' && !x.secret && !x.homeOnly && !x.edition && !x.restored)?.id;
  assert.equal(S.dropSaleOf(m, S.CASE_BY_ID.elite), Math.floor(S.MODELS[m].price * S.caseSellShare('elite', 'A')));
});
