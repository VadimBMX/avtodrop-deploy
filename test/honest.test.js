// Honest numbers (reports/audit.md №1, №14; report b): the sale is the main figure of a car, the collection price
// (model + parts + plate) comes second; «×N від ціни кейсу» is the sale against the case; the dream car shows the
// openings it really takes. No economy constant changed: these helpers only read SELL_RATES / ORIGIN_SELL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-14T10:00:00Z'), notify: () => {}, random: () => 0.5, partCooldownMs: 0, allUnlocked: true });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  g.ensureUser({ id: 1, username: 'u1', first_name: 'U1' });
  db.prepare('UPDATE users SET balance = 1e12, slots = 40 WHERE id = 1').run();
  return { db, call };
}

test.skip('honest: the Elite Corvette from the audit — sale 4,8 млн is the main figure, ×0,48 of the case, ×1,8 in the collection', () => {
  const car = { model: 'chevrolet-corvette-c8', origin: 'elite', value: S.MODELS['chevrolet-corvette-c8'].price };
  const sale = S.saleOf(car);
  assert.equal(sale, Math.floor(17613000 * S.caseSellShare('elite', 'A')));
  assert.equal(S.multText(sale / 10e6), '×0,48');
  assert.equal(S.multText(car.value / 10e6), '×1,8');
  // The server's own number wins (it counts FRESH_SELL and the car's age).
  assert.equal(S.saleOf({ ...car, sell: 123 }), 123);
});

test('honest: multText — two decimals under 1, one under 10, none above', () => {
  assert.equal(S.multText(0.4755), '×0,48');
  assert.equal(S.multText(0.06), '×0,06');
  assert.equal(S.multText(1.76), '×1,8');
  assert.equal(S.multText(9.97), '×10');
  assert.equal(S.multText(22.4), '×22');
});

test('honest: secret cars have no sale; the sale never exceeds the collection price, parts and plate included', () => {
  const secret = S.ALL_MODELS.find((m) => m.secret);
  assert.equal(S.saleOf({ model: secret.id, value: secret.price }), null);
  assert.equal(S.saleOf({ model: 'no-such-model' }), null);
  for (const cs of S.CASES) for (const cls of Object.keys(cs.weights)) for (const m of cs.pool(cls)) {
    const s = S.dropSaleOf(m.id, cs);
    assert.equal(s, S.sellPriceOf(m.id, 0, cs.starter ? null : cs.id));
    assert.ok(s > 0 && s <= m.price, `${cs.id} ${m.id}`);
  }
});

test('honest: extrasOf — installed parts and the plate, the gap between the collection price and the model', () => {
  const car = { model: 'byd-dolphin', parts: { suspension: 'stock', wheels: 'stock', brakes: 'stock', body: 'stock' }, plate: { value: 400000 } };
  const x = S.extrasOf(car);
  assert.equal(x.parts, 4 * S.TIER_BY_ID.stock.price);
  assert.equal(x.plate, 400000);
  assert.equal(S.carValue({ ...car, plateValue: 400000 }) - S.MODELS['byd-dolphin'].price, x.parts + x.plate);
  // A part type the car can't take (petrol engine on an EV) is not counted, like carValue.
  assert.equal(S.extrasOf({ model: 'byd-dolphin', parts: { eng: 'race' } }).parts, 0);
  assert.deepEqual(S.extrasOf({ model: 'byd-dolphin' }), { parts: 0, plate: 0 });
});

test('honest: the dream outlook comes from the real drop chance, not from money against the price', () => {
  const o = S.dreamOutlook('hongqi-s9', { balance: 32e6 });
  const best = S.dreamChances('hongqi-s9')[0];
  assert.equal(o.caseId, best.caseId);
  assert.equal(o.opens, Math.round(100 / best.pct));
  assert.equal(o.spend, o.opens * S.CASE_BY_ID[o.caseId].price);
  assert.equal(o.can, Math.floor(32e6 / S.CASE_BY_ID[o.caseId].price));
  assert.ok(Math.abs(o.chanceNow - (1 - Math.pow(1 - best.pct / 100, o.can))) < 1e-12);
  // Keys of that case count as openings; no money and no keys — no chance, not a 70% bar.
  assert.equal(S.dreamOutlook('hongqi-s9', { balance: 0, keys: { [o.caseId]: 2 } }).can, 2);
  assert.equal(S.dreamOutlook('hongqi-s9', { balance: 0 }).chanceNow, 0);
  // A secret car drops from no case.
  assert.equal(S.dreamOutlook(S.ALL_MODELS.find((m) => m.secret).id), null);
});

test('honest: what the server sends for a dropped car is what the screen shows and what selling pays', () => {
  const { call } = setup();
  const { results } = call(1, 'case/open', { caseId: 'sport', count: 3 });
  for (const r of results) {
    const m = S.MODELS[r.car.model];
    assert.equal(r.car.value, m.price); // a fresh drop: no parts, no plate
    assert.equal(S.saleOf(r.car), S.sellPriceOf(r.car.model, 0, 'sport'));
    assert.equal(S.saleOf(r.car), S.dropSaleOf(r.car.model, S.CASE_BY_ID.sport));
  }
  const before = call(1, 'me').balance;
  const c = results[0].car;
  assert.equal(call(1, 'sell', { carIds: [c.id] }).got, S.saleOf(c));
  assert.equal(call(1, 'me').balance, before + S.saleOf(c));
});
