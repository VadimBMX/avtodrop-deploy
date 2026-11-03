// Economy audit 28.10 (reports/econ-fable/economy.md): no repeatable «open and sell» loop may return the money paid, on any
// day type — a plain day, the case of the day (−10%, no hidden boost), the luck weekend (top class ×1.3, no boost), the
// country of the week (−15%, no boost, no fragments), a case battle with a person (shown odds + guarantee only) and a
// battle with the bot (shown odds only). tools/econ-audit.mjs copies the real roll (tools/sim-cases.mjs ← src/game.js
// rollCase) with fixed seeds, so these numbers are reproducible; the static bound below has no Monte Carlo noise at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';
import * as B from '../public/buyer.js';
import { allDays, staticSell } from '../tools/econ-audit.mjs';
import { natural } from '../tools/sim-cases.mjs';

const CASES = S.CASES.filter((c) => !c.starter);
const N = 1e5;

test('economy: open-and-sell is under the price for every case on every day type (fixed-seed Monte Carlo, 100k opens each)', () => {
  for (const cs of CASES) {
    const d = allDays(cs, N, 7);
    for (const [k, v] of Object.entries({ plain: d.plain, deal: d.deal, luck: d.luck ?? 0, battle: d.battle, bot: d.bot })) assert.ok(v < 1, `${cs.id} ${k}: ${v.toFixed(3)}`);
    // The target band of a plain day (reports/caseev.md, econ-fable): ~0.85–0.95; China, the one case with every blue car
    // under its price, is allowed lower.
    assert.ok(d.plain <= 0.95 && d.plain >= (cs.id === 'c-cn' ? 0.7 : 0.8), `${cs.id} plain ${d.plain.toFixed(3)}`);
  }
});

test('economy: the noise-free expectation (shown odds, guarantee, hidden boost) is under 0.95 for every case', () => {
  for (const cs of CASES) {
    const s = staticSell(cs);
    assert.ok(s < 0.95, `${cs.id}: ${s.toFixed(3)}`);
    // The case of the day / country of the week price, without the boost (what the deal takes away): still under 1 before
    // the fragments and the streak save come on top (they are in the Monte Carlo above).
    const off = cs.group === 'rarity' ? S.CASE_OF_DAY.off : S.EVENTS.country.off;
    assert.ok(staticSell(cs, 0) / (1 - off) < 1.0, `${cs.id} deal (static): ${(staticSell(cs, 0) / (1 - off)).toFixed(3)}`);
  }
});

test('economy: «Таємний покупець» cannot lift a case over the price — on its deal day, with a fresh drop\'s buy-back share', () => {
  const reqs = [...B.BUYABLE.map((m) => ({ model: m.id })), ...B.GROUPS];
  for (const cs of CASES) {
    const d = allDays(cs, N, 7);
    const deal = cs.group === 'rarity' ? S.caseDeal(cs, '2026-11-03') : S.caseDeal(cs, '2026-11-02', S.eventEffects([{ id: 'country', country: cs.country }]));
    const price = Math.min(deal.price, cs.price * (1 - (cs.group === 'rarity' ? S.CASE_OF_DAY.off : S.EVENTS.country.off)));
    // The largest the buyer adds to one open: drop chance × its sale × the premium he may offer for it (B.premCap).
    const sh = S.effectiveWeights(cs);
    let worst = 0;
    for (const req of reqs) {
      let add = 0;
      for (const cls of Object.keys(cs.weights)) {
        const list = cs.pool(cls), w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
        list.forEach((m, i) => {
          if (!B.matches(req, m.id)) return;
          const prem = Math.min(B.BUYER.prem.stretch[1], B.premCap(req));
          if (prem >= B.BUYER.minPrem) add += ((sh[cls] * w[i]) / sw) * S.sellPriceOf(m.id, Infinity, cs.id) * prem;
        });
      }
      worst = Math.max(worst, add);
    }
    assert.ok(Math.max(d.plain, d.deal) + worst / price < 1, `${cs.id}: ${Math.max(d.plain, d.deal).toFixed(3)} + buyer ${(worst / price).toFixed(3)}`);
  }
});

test('economy (S2): China case — priced at its cheap blue cars (S1: 480 тис over 206–291 тис cars), purple guaranteed by 25', () => {
  const cn = S.CASE_BY_ID['c-cn'];
  const blue = cn.pool('C').map((m) => m.price).sort((a, b) => a - b);
  assert.ok(cn.price <= blue[blue.length - 1] && cn.price >= blue[0], 'the price sits inside its blue cars');
  assert.ok(natural(cn, 'B') >= 1 / 38, `B+ 1 in ${(1 / natural(cn, 'B')).toFixed(1)}`);
  assert.deepEqual(S.pitySteps(cn).map((s) => [s.cls, s.n]), [['B', 25], ['S', 2500]]);
});

test('economy: race prizes stop growing above the dearest real car — a secret car races like a 300 млн hypercar', () => {
  assert.equal(S.RACE_VALUE_CAP, S.CLASSES.S.hi);
  for (const op of [S.TRAINING, ...S.OPPONENTS]) {
    assert.deepEqual(S.raceMoney(op, 1e9), S.raceMoney(op, S.RACE_VALUE_CAP));
    assert.ok(S.raceMoney(op, 299e6).prize <= S.raceMoney(op, S.RACE_VALUE_CAP).prize);
  }
  assert.deepEqual(S.bossRematch(0.9, 1.5e9), S.bossRematch(0.9, S.RACE_VALUE_CAP));
});

test('economy: a per-class buy-back table reads like a factor (caseSellShare / originSellOf / originSellText)', () => {
  const saved = S.ORIGIN_SELL.elite;
  try {
    S.ORIGIN_SELL.elite = { A: 0.22, S: 0.45 };
    assert.equal(S.caseSellShare('elite', 'A'), 0.22);
    assert.equal(S.caseSellShare('elite', 'S'), 0.45);
    assert.equal(S.caseSellShare('elite', 'B'), S.SELL_RATES.B, 'a class the table does not name keeps its rate');
    assert.equal(S.originSellOf('elite', 'S'), 0.45 / S.SELL_RATES.S);
    assert.ok(Math.abs(S.originSellOf('elite') - 0.22 / S.SELL_RATES.A) < 1e-9, 'without a class: the lowest factor (what an upgrade inherits)');
    assert.equal(S.originSellText('elite'), `золоті ×${(0.22 / S.SELL_RATES.A).toFixed(2).replace(/0$/, '').replace('.', ',')} · червоні ×${(0.45 / S.SELL_RATES.S).toFixed(2).replace(/0$/, '').replace('.', ',')}`); // S2 rates: ×0,44 · ×0,9
    const s = S.ALL_MODELS.find((m) => m.cls === 'S' && !m.secret && !m.edition && !m.restored);
    assert.equal(S.sellPriceOf(s.id, Infinity, 'elite'), Math.floor(s.price * 0.45));
    assert.equal(S.sellPriceOf(s.id), Math.floor(s.price * S.SELL_RATES.S), 'the same car not from a case: the class rate');
  } finally {
    if (saved == null) delete S.ORIGIN_SELL.elite;
    else S.ORIGIN_SELL.elite = saved;
  }
  const savedCity = S.ORIGIN_SELL.city;
  S.ORIGIN_SELL.city = 0.79;
  assert.equal(S.originSellText('city'), '×0,79');
  if (savedCity == null) delete S.ORIGIN_SELL.city;
  else S.ORIGIN_SELL.city = savedCity;
  assert.equal(S.originSellText('c-jp'), '');
  assert.equal(S.originSellOf(null), 1);
});

// Season 2: the red is still the jackpot — at the flat 50 % sale an average red pays ×3,5 Еліта, ×7 Преміум, ×10+ the dear
// country cases — and rarity cases never guarantee it. Country cases do guarantee a red still MISSING from the collection
// (after 500 / 2500 opens), so a collection never hangs on one 0,02 % car (S1: DE ~18 000 opens for its last red).
test('jackpot (S2): the red of the dear cases pays ×3+ the case; only a missing red of a collection is guaranteed', () => {
  const medianRed = (cs) => {
    const list = cs.pool('S'), w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
    return list.reduce((s, m, i) => s + (S.sellPriceOf(m.id, Infinity, cs.id) * w[i]) / sw, 0) / cs.price;
  };
  for (const id of ['elite', 'premium', 'c-it', 'c-us', 'c-gb']) {
    const cs = S.CASE_BY_ID[id];
    assert.ok(medianRed(cs) >= 3, `${id}: an average red pays ×${medianRed(cs).toFixed(1)}`);
    for (const st of S.pitySteps(cs).filter((x) => x.cls === 'S')) assert.ok(cs.country && st.missing, `${id}: a red step only for a missing collection car`);
  }
  assert.deepEqual(S.pitySteps(S.CASE_BY_ID.sport).map((s) => s.cls), ['A'], 'Спорткар keeps its gold step (the middle class)');
  for (const id of ['rust', 'city', 'c-ua', 'tuning', 'c-jp', 'c-de', 'c-cn']) assert.ok(S.pitySteps(S.CASE_BY_ID[id]).length >= 1, `${id} keeps its guarantee (newcomer insurance)`);
});
