import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';

test('sell rates: owner decision 22.10 (3rd) — grey 50, blue 45, purple 40, gold 35, red 30 %, no per-case cut', () => {
  assert.deepEqual(S.SELL_RATES, { D: 0.5, C: 0.45, B: 0.4, A: 0.35, S: 0.3, X: 0.3 });
  assert.deepEqual(S.ORIGIN_SELL, {});
  for (const cs of S.CASES) assert.equal(S.originSellOf(cs.id), 1);
});

test('qa2: no UI text promises a per-case buy-back share any more (ORIGIN_SELL is empty)', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(!/частку від звичайного викупу/.test(app));
  assert.deepEqual(S.ORIGIN_SELL, {});
});
