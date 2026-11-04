// Season 2 economy (public/econ.js): the targets of the rebuild, so a later tweak can't quietly bring back what broke S1.
// Data behind them: scratchpad econ report (anonymised live DB of 3.11.2026) and tools/econ-sim.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as B from '../public/business.js';
import { ECON } from '../public/econ.js';
import { allDays } from '../tools/econ-audit.mjs';

const CASES = S.CASES.filter((c) => !c.starter);

// S1 exploit: the per-class buy-back tables (Еліта gold 22 %, red 45 %) plus an upgrade result inheriting its case origin
// turned an Еліта gold sold for 22 % into a red sold for 45 %: 0,92 × 0,45 / 0,22 ≈ ×1,9 per upgrade. The two biggest S1
// balances (8,0 and 6,5 млрд) were the two biggest upgraders (6 311 and 3 367 cars, 249 and 139 млрд of value burned).
test('S2 exploit fix: a dearer class never sells for a larger share, so the upgrade can only lose in sale terms', () => {
  for (const origin of [null, ...S.CASES.map((c) => c.id)]) {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 5; j++) {
      const lo = S.CLASS_ORDER[i], hi = S.CLASS_ORDER[j];
      assert.ok(S.caseSellShare(origin, hi) <= S.caseSellShare(origin, lo) + 1e-12, `${origin}: ${hi} sells for more than ${lo}`);
      // E[sale out] / sale in of an upgrade from `lo` to `hi` (one car, the best edge).
      assert.ok((S.upgradeEdge(1) * S.caseSellShare(origin, hi)) / S.caseSellShare(origin, lo) < 1, `${origin}: upgrade ${lo}→${hi}`);
    }
  }
});

test('S2 exploit fix, on the engine: an upgraded car out of «Еліта» sells for the same 50 % as any car', () => {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-11-09T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 0, slots = 100, level = 30, level_seen = 30 WHERE id = 1').run();
  g.giveCar(1, 'zaz-lanos');
  const gold = S.CASE_BY_ID.elite.pool('A')[0], red = S.CASE_BY_ID.elite.pool('S')[0];
  const ids = [];
  for (let i = 0; i < 40; i++) {
    const id = g.giveCar(1, gold.id).id;
    db.prepare("UPDATE cars SET origin = 'elite' WHERE id = ?").run(id);
    ids.push(id);
  }
  let won = null;
  for (const id of ids) {
    const r = g.api.upgrade(1, { carIds: [id], target: red.id });
    if (r.win) { won = r.car; break; }
  }
  assert.ok(won, 'some upgrade wins (chance ≈ stake / target × 0,92)');
  assert.ok(won.origin == null || won.origin === 'elite', 'no buy-back share to inherit any more');
  assert.equal(won.sell, Math.floor(red.price * 0.5));
});

test('S2 cases: honest — open-and-sell 0,85–0,93 on a plain day, under 1 on every day type even with «Автосалон»', () => {
  for (const cs of CASES) {
    const d = allDays(cs, 4e4, 7);
    assert.ok(d.plain >= 0.84 && d.plain <= 0.935, `${cs.id} plain ${d.plain.toFixed(3)}`);
    assert.ok(d.max * (1 + B.BIZ.perks.salonSell) < 1, `${cs.id} worst day ${d.max.toFixed(3)} × salon`);
  }
});

// Owner (S1): «кейс за 600 тис може дати машину за 50». S1's worst drop sold for 0,15 (Преміум) – 0,36 of the case; now the
// worst drop of every case sells for at least ~a quarter of it and is worth at least ~half of it.
test('S2 cases: the cheapest drop is worth ≥ 0,45 of the price and sells for ≥ 0,22 of it; value EV 1,1–2,6 × the price', () => {
  for (const cs of CASES) {
    const all = Object.keys(cs.weights).flatMap((c) => cs.pool(c));
    const lo = all.reduce((a, b) => (a.price < b.price ? a : b));
    assert.ok(lo.price >= cs.price * 0.45, `${cs.id}: ${lo.name} worth ${(lo.price / cs.price).toFixed(2)} of the case`);
    assert.ok(S.sellPriceOf(lo.id, Infinity, cs.id) >= cs.price * 0.22, `${cs.id}: ${lo.name} sells for ${(S.sellPriceOf(lo.id, Infinity, cs.id) / cs.price).toFixed(2)}`);
    assert.ok(cs.ev >= cs.price * 1.1 && cs.ev <= cs.price * 2.6, `${cs.id}: value EV ×${(cs.ev / cs.price).toFixed(2)}`);
  }
});

// Owner (S1): «за СРСР/Україна 5–10 хвилин гри дають машину за 600 млн». S1: UA secret 500 млн for ~13 млн of net spend
// (×39); DE paid 1 млрд for ~1,7 млрд (×0,6). S2: ≈ 1,5 × the median net cost, and the crown of its own collection.
test('S2 secret cars: priced from the collection, not a fortune for a short UA run', () => {
  assert.ok(S.MODELS[S.SECRET_BY_COUNTRY.UA].price <= 50e6, 'UA secret');
  for (const c of S.MAIN_COUNTRIES) {
    const top = Math.max(...S.countryNeed(c).map((m) => m.price));
    const v = S.MODELS[S.SECRET_BY_COUNTRY[c]].price;
    assert.ok(v >= top * 1.25 && v <= 3e9, `${c}: ${v}`);
    assert.equal(S.COUNTRY_REWARD[c], Math.round((v * ECON.countryRewardShare) / 10000) * 10000);
  }
});

test('S2 progression: a richer first session, businesses inside one season, paying capped', () => {
  assert.equal(S.START_BALANCE, 500000);
  assert.equal(S.NEWBIE_TASKS.reduce((a, t) => a + t.money, 0), 400000); // 04.11: cut from ~1 млн (too much in the first minutes)
  assert.equal(S.levelReward(5).money, 25000 * 25); // 04.11: 25 000 × L² (was 40 000)
  for (const b of B.BIZ.list) assert.ok(b.level <= 10, `${b.id} from level ${b.level}`);
  assert.ok(S.PACK_SCALE.max <= 10 && S.FIRST_BUY_MULT <= 2 && S.PACK_OFFER.mult <= 1.5);
  // Early races pay double, the dearest car about as much as in S1 (raceEv: 20 000 × (v / 40 000)^0,5).
  assert.equal(Math.round(S.raceEv(40000)), 20000);
  assert.ok(S.raceEv(S.RACE_VALUE_CAP) < 2e6);
  // Late garage income: gold 0,4 %/h, red 0,2 %/h (S1 0,5 / 0,25) — the late game is a climb, not a printer.
  assert.ok(S.CLASS_INCOME.A <= 0.004 && S.CLASS_INCOME.S <= 0.002);
});
