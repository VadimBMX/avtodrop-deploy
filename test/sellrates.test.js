import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';

test('sell rates: owner decision 22.10 (2nd) — grey 45, blue 40, purple 30, gold 22, red 18 %, no per-case cut', () => {
  assert.deepEqual(S.SELL_RATES, { D: 0.45, C: 0.4, B: 0.3, A: 0.22, S: 0.18, X: 0.18 });
  assert.deepEqual(S.ORIGIN_SELL, {});
  for (const cs of S.CASES) assert.equal(S.originSellOf(cs.id), 1);
});

test('qa2: no UI text promises a per-case buy-back share any more (ORIGIN_SELL is empty)', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(!/частку від звичайного викупу/.test(app));
  assert.deepEqual(S.ORIGIN_SELL, {});
});
