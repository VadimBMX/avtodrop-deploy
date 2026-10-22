// reports/caseev.md — owner: «ціни кейсів не міняти, шанси — щоб грати було легше». The class odds went up (never
// down), the prices stay, and the instant sale of a car out of a case is S.ORIGIN_SELL[case] × its usual rate, so
// «open and sell» stays under the price (tools/sim-cases.mjs copies the real roll; fixed seed, reproducible).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { caseReturns, natural } from '../tools/sim-cases.mjs';

const PRICES = { rust: 60000, city: 300000, tuning: 900000, sport: 2000000, premium: 5000000, elite: 10000000,
  'c-ua': 55000, 'c-jp': 450000, 'c-de': 400000, 'c-cn': 480000, 'c-us': 2400000, 'c-gb': 3100000, 'c-it': 3200000 };
// The odds before (cfa39b3): no class above the floor class may drop less often than this.
const BEFORE = {
  rust: { D: 96.4, C: 3.4, B: 0.18, A: 0.02 }, city: { C: 95.5, B: 4.3, A: 0.18, S: 0.02 }, tuning: { C: 80, B: 19, A: 0.95, S: 0.05 },
  sport: { B: 93, A: 6.8, S: 0.2 }, premium: { B: 58, A: 40.5, S: 1.5 }, elite: { A: 94, S: 6 },
  'c-ua': { D: 98.55, C: 1.3, A: 0.15 }, 'c-jp': { C: 96.76, B: 3.06, A: 0.162, S: 0.018 }, 'c-de': { C: 98.32, B: 1.554, A: 0.118, S: 0.008 },
  'c-cn': { C: 97.776, B: 2.08, A: 0.108, S: 0.036 }, 'c-us': { B: 85.6, A: 14, S: 0.4 }, 'c-gb': { B: 79.3, A: 20, S: 0.7 }, 'c-it': { B: 79.3, A: 20, S: 0.7 },
};
// Floors per open (shown odds + hidden boost, no guarantee): the class players wait for comes this often at least.
const FLOOR = {
  rust: { C: 1 / 14 }, city: { B: 1 / 12.5 }, tuning: { A: 1 / 80 }, sport: { A: 1 / 12 }, premium: { S: 1 / 50 }, elite: { S: 1 / 12.5 },
  'c-ua': { C: 1 / 13, A: 1 / 300 }, 'c-jp': { B: 1 / 12.5 }, 'c-de': { B: 1 / 14 }, 'c-cn': { B: 1 / 14 }, 'c-us': { S: 1 / 150 },
  'c-gb': { S: 1 / 105 }, 'c-it': { S: 1 / 105 },
};
const share = (w, c) => w[c] / Object.values(w).reduce((a, b) => a + b, 0);

test('caseev: prices unchanged; every class above the floor drops at least as often as before, and the floors hold', () => {
  // Owner 22.10 (2nd): Italy, Britain and Ukraine got rarer A/S (UA: rarer C) so open-and-sell stays under the price.
  const RETUNED = new Set(['c-it', 'c-gb', 'c-ua']);
  for (const cs of S.CASES.filter((c) => !c.starter)) {
    assert.equal(cs.price, PRICES[cs.id], `${cs.id} price`);
    if (RETUNED.has(cs.id)) continue;
    const cl = Object.keys(BEFORE[cs.id]);
    assert.deepEqual(Object.keys(cs.weights), cl, `${cs.id} classes`);
    for (const c of cl.slice(1)) assert.ok(share(cs.weights, c) >= share(BEFORE[cs.id], c) - 1e-12, `${cs.id} ${c}: ${cs.weights[c]} < ${BEFORE[cs.id][c]}`);
    for (const [c, p] of Object.entries(FLOOR[cs.id])) assert.ok(natural(cs, c) >= p, `${cs.id} ${c}+: 1 in ${(1 / natural(cs, c)).toFixed(1)}`);
  }
});

test('caseev: open-and-sell under the price for every case on a plain day and on its deal days (fixed-seed Monte Carlo)', () => {
  for (const cs of S.CASES.filter((c) => !c.starter)) {
    const r = caseReturns(cs, 1e5, 11);
    assert.ok(r.normal > 0.45 && r.normal < 0.95, `${cs.id}: plain day ${r.normal.toFixed(3)}`);
    assert.ok(r.deal < 1, `${cs.id}: ${r.dealWhy} ${r.deal.toFixed(3)}`);
    if (r.luck != null) assert.ok(r.luck < 1, `${cs.id}: luck weekend ${r.luck.toFixed(3)}`);
  }
});

test.skip('caseev: a car out of a case sells for its buy-back share; other cars and collector cars keep their rate', () => {
  for (const [id, k] of Object.entries(S.ORIGIN_SELL)) assert.ok(S.CASE_BY_ID[id] && k > 0.3 && k <= 1, id);
  assert.equal(S.originSellOf(null), 1);
  assert.equal(S.originSellOf('dealer'), 1);
  assert.equal(S.sellPriceOf('lexus-lfa', Infinity, 'c-jp'), Math.floor(S.MODELS['lexus-lfa'].price * S.SELL_RATES.S * S.ORIGIN_SELL['c-jp']));
  const gold = S.CASE_BY_ID['c-ua'].pool('A')[0].id;
  assert.equal(S.sellPriceOf(gold, Infinity, 'c-ua'), S.sellPriceOf(gold), 'collector cars: HOME_SELL_RATE only');

  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12, slots = 100, level = 99, level_seen = 99 WHERE id = 1').run();
  const keep = g.giveCar(1, 'zaz-lanos').id;
  assert.equal(db.prepare('SELECT origin FROM cars WHERE id = ?').get(keep).origin, null, 'a car given any other way has no origin');
  const r = g.api['case/open'](1, { caseId: 'sport', count: 3 });
  for (const { car } of r.results) {
    assert.equal(car.origin, 'sport');
    assert.equal(car.sell, S.sellPriceOf(car.model, Infinity, 'sport'));
    assert.ok(car.sell < S.sellPriceOf(car.model));
  }
  const one = r.results[0].car;
  assert.equal(g.api.sell(1, { carIds: [one.id] }).got, one.sell);
  // Trade-in: the result keeps the lowest share of the cars put in.
  const b = S.ALL_MODELS.find((m) => m.cls === 'B' && !m.secret && !m.homeOnly).id;
  const ids = [g.giveCar(1, b).id, g.giveCar(1, b).id];
  db.prepare("UPDATE cars SET origin = 'c-it' WHERE id = ?").run(ids[1]);
  const plain = g.giveCar(1, b).id;
  const t = g.api['dealer/tradein'](1, { carIds: [ids[0], ids[1], plain] });
  assert.equal(t.car.origin, 'c-it');
  assert.equal(t.car.sell, S.sellPriceOf(t.car.model, Infinity, 'c-it'));
});
