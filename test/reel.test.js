// «Прокрут» (public/s2-reel.js): the strip is decoration — the card the reel stops on is always the server's car.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';
import { REEL, buildStrip, planReels, stopX, indexAt, overshoot, stopOffset, motion, leanOf } from '../public/s2-reel.js';

const ids = Object.keys(S.MODELS).filter((id) => !S.MODELS[id].secret);
const draw = () => ids[Math.floor(Math.random() * ids.length)];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('reel: every row of ×1 / ×3 / ×6 has the server car at its stop index', () => {
  for (const n of [1, 3, 6]) for (let k = 0; k < 200; k++) {
    const results = Array.from({ length: n }, () => ({ car: { model: draw() } }));
    for (const reduce of [false, true]) {
      const plans = planReels(results, draw, { reduce, rnd });
      assert.equal(plans.length, n);
      plans.forEach((p, i) => {
        assert.equal(p.winner, results[i].car.model);
        assert.equal(p.strip[p.W], results[i].car.model);
        assert.equal(p.strip.length, reduce ? REEL.NR : REEL.N);
      });
    }
  }
});

test('reel: the marker ends inside the winner card — at the stop and through the whole settle', () => {
  for (const [cardW, gap, viewW] of [[140, 8, 390], [104, 6, 360], [86, 6, 390], [76, 6, 360]]) {
    const geo = { step: cardW + gap, cardW, viewW };
    for (let k = 0; k < 2000; k++) {
      const lean = [-1, 0, 1][k % 3];
      const off = stopOffset(lean, rnd);
      assert.ok(Math.abs(off) <= 0.36);
      const target = stopX({ W: REEL.W, ...geo, off });
      assert.equal(indexAt(target, geo), REEL.W);
      const over = overshoot(off, cardW, rnd);
      const m = motion({ target, over, spinMs: 4700, settleMs: 360 });
      assert.equal(m.at(m.total), target);
      for (let t = 4700; t <= m.total; t += 12) assert.equal(indexAt(m.at(t), geo), REEL.W, `t=${t}`);
      // never runs backwards during the spin, and starts at 0
      assert.equal(m.at(0), 0);
      let prev = -1;
      for (let t = 0; t <= 4700; t += 50) (assert.ok(m.at(t) >= prev - 1e-6), (prev = m.at(t)));
    }
  }
  const r = motion({ target: 900, spinMs: 600, reduce: true });
  assert.equal(r.total, 600);
  assert.equal(r.at(600), 900);
});

test('reel: honest strip — nothing planted, lean only towards a rarer real neighbour', () => {
  const byCls = (c) => ids.find((id) => S.MODELS[id].cls === c);
  const strip = buildStrip(byCls('C'), () => byCls('D'), { N: 10, W: 5 });
  assert.deepEqual(strip.filter((x) => x !== byCls('D')), [byCls('C')]);
  assert.equal(leanOf(strip, 5), 0);
  strip[6] = byCls('A');
  assert.equal(leanOf(strip, 5), 1);
  strip[4] = byCls('S');
  assert.equal(leanOf(strip, 5), -1);
});
