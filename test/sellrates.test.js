import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';

test('sell rates: owner decision 22.10 — grey 60, blue 55, purple 50, gold 45, red 40 %, no per-case cut', () => {
  assert.deepEqual(S.SELL_RATES, { D: 0.6, C: 0.55, B: 0.5, A: 0.45, S: 0.4, X: 0.4 });
  assert.deepEqual(S.ORIGIN_SELL, {});
  for (const cs of S.CASES) assert.equal(S.originSellOf(cs.id), 1);
});
