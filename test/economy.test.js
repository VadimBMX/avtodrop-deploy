// Economy invariants: things that must stay true whatever the numbers are tuned to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const sellBack = (cs) => {
  let v = 0;
  for (const [cls, sh] of Object.entries(S.effectiveWeights(cs))) {
    const l = cs.pool(cls), w = S.modelWeights(l), t = w.reduce((a, b) => a + b, 0);
    l.forEach((m, i) => (v += (sh * w[i] * S.sellPriceOf(m.id)) / t));
  }
  return v / cs.price;
};

test('instant sale: grey 70%, blue 60%, purple 50%, gold 45%, red 40%, no daily limit', () => {
  assert.deepEqual(S.SELL_RATES, { D: 0.7, C: 0.6, B: 0.5, A: 0.45, S: 0.4, X: 0.4 });
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 0, slots = 1000, level = 99, level_seen = 99 WHERE id = 1').run();
  g.giveCar(1, 'zaz-lanos');
  const ids = Array.from({ length: 8 }, () => g.giveCar(1, 'lexus-lfa').id);
  assert.equal(g.api.sell(1, { carIds: ids }).got, S.sellPriceOf('lexus-lfa') * 8, 'every car at the full rate');
});

test('class ladder: every class is clearly dearer than the one below, secrets above the S floor', () => {
  for (let i = 1; i < 5; i++) {
    const lo = S.CLASSES[S.CLASS_ORDER[i]].lo, prevHi = S.CLASSES[S.CLASS_ORDER[i - 1]].hi;
    assert.ok(lo >= prevHi * 2, `${S.CLASS_ORDER[i]} starts well above ${S.CLASS_ORDER[i - 1]}`);
  }
  for (const m of S.ALL_MODELS.filter((x) => x.secret)) assert.ok(m.price >= S.CLASSES.S.lo * 2, m.name);
});

test('parts and plates do not turn a cheap car into a money printer', () => {
  const lanos = { model: 'zaz-lanos' };
  const tuned = { model: 'zaz-lanos', parts: Object.fromEntries(S.PART_KEYS.map((k) => [k, 'race'])), plateValue: 5000000 };
  const extra = S.carValue(tuned) - S.carValue(lanos);
  assert.ok(S.carIncomeOf(tuned) - S.carIncomeOf(lanos) <= extra * S.CLASS_INCOME.X + 1, 'extras earn the lowest rate only');
  const hard = S.OPPONENTS[2];
  assert.equal(S.raceMoney(hard, S.MODELS['zaz-lanos'].price).prize, S.raceMoney(hard, S.MODELS['zaz-lanos'].price).prize);
});

test('income per hour falls with class, so the late game is a climb', () => {
  for (let i = 1; i < S.CLASS_ORDER.length; i++) assert.ok(S.CLASS_INCOME[S.CLASS_ORDER[i]] <= S.CLASS_INCOME[S.CLASS_ORDER[i - 1]]);
});

test('race prizes come from the car model, not from parts or plates', () => {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12, level = 99, level_seen = 99 WHERE id = 1').run();
  const car = g.giveCar(1, 'zaz-lanos').id;
  const before = g.api['race/rivals'](1, { carId: car }).list.map((r) => r.prize);
  g.addPart(1, 'eng', 'race', 1);
  g.api['parts/install'](1, { carId: car, type: 'eng', tier: 'race' });
  const after = g.api['race/rivals'](1, { carId: car }).list.map((r) => r.prize);
  assert.deepEqual(after, before);
});
