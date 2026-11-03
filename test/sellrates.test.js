import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';

test('sell rates (Season 2): 50 % for every class; no per-case buy-back table — case prices carry the honest EV instead', () => {
  assert.deepEqual(S.SELL_RATES, { D: 0.5, C: 0.5, B: 0.5, A: 0.5, S: 0.5, X: 0.5 });
  // S1's per-class tables (Еліта: gold 22 %, red 45 %) let the upgrade turn a 22 % car into a 45 % one — see test/econ-s2.test.js.
  assert.deepEqual(S.ORIGIN_SELL, {});
  for (const cs of S.CASES) assert.equal(S.originSellOf(cs.id), 1, cs.id);
  assert.equal(S.originSellOf(null), 1); // cars not from a case — the full rate
});

test('qa2: the drop prices shown (reel, «Що всередині») include the case buy-back share', () => {
  const m = S.ALL_MODELS.find((x) => x.cls === 'A' && !x.secret && !x.homeOnly && !x.edition && !x.restored)?.id;
  assert.equal(S.dropSaleOf(m, S.CASE_BY_ID.elite), Math.floor(S.MODELS[m].price * S.caseSellShare('elite', 'A')));
});
