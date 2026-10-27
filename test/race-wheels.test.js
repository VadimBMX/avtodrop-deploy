// Spinning wheels in the drag race (public/race-wheels.js): the disc math and the wheel data every photo needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../public/shared.js';
import { wheelBox, wheelData, spinOf, saneWheels, WW_EXTRA, WW_CROP, WW_CAP } from '../public/race-wheels.js';

const META = JSON.parse(fs.readFileSync(new URL('../public/paint/meta.json', import.meta.url), 'utf8')).cars;
const metaOf = (id) => META[id] || null;

test('the disc sits on the wheel: its centre and the photo under it map back to the wheel centre', () => {
  const { w, h, wheels } = META['bmw-325i-e30'];
  for (const q of wheels) {
    const b = wheelBox(w, h, q);
    assert.ok(Math.abs(((b.left + b.size / 2) / 100) * w - q[0]) < 1e-6);
    assert.ok(Math.abs((b.top / 100) * h + b.r - q[1]) < 1e-6); // the disc is square: size is % of the width
    assert.ok(Math.abs(b.r - q[2] * WW_CROP) < 1e-9);
    // background: photo width = bgW% of the disc, offset (disc − photo) · bgX% → the wheel centre in the disc middle
    const disc = 2 * b.r, img = (b.bgW / 100) * disc;
    assert.ok(Math.abs(img - w) < 1e-6);
    const offX = (disc - img) * (b.bgX / 100), offY = (disc - (img * h) / w) * (b.bgY / 100);
    assert.ok(Math.abs(q[0] + offX - disc / 2) < 1e-6);
    assert.ok(Math.abs(q[1] + offY - disc / 2) < 1e-6);
  }
});

test('every race photo has wheel data (meta.json or the fallback table), inside the picture', () => {
  const photos = fs.readdirSync(new URL('../public/cars', import.meta.url)).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5));
  for (const id of photos) {
    const d = wheelData(id, metaOf);
    assert.ok(d, `no wheels for ${id}`);
    for (const [cx, cy, r] of d.wheels) assert.ok(cx - r * WW_CROP > 0 && cx + r * WW_CROP < d.w && cy - r * WW_CROP > 0 && cy + r * WW_CROP <= d.h + 1 && r > 0.1 * d.h && r < 0.3 * d.h, id);
  }
  for (const id of Object.keys(WW_EXTRA)) {
    assert.ok(!saneWheels(META[id]), `${id} has meta wheels now — drop it from WW_EXTRA`);
    assert.equal(META[id].w, WW_EXTRA[id][0]);
    assert.equal(META[id].h, WW_EXTRA[id][1]);
  }
});

test('a season livery uses the wheels of the photo it borrows; unknown models get none', () => {
  const liv = Object.keys(S.MODELS).find((id) => S.MODELS[id].img && !META[id]);
  if (liv) assert.deepEqual(wheelData(liv, metaOf)?.wheels, wheelData(S.MODELS[liv].img, metaOf)?.wheels);
  assert.equal(wheelData('no-such-car', metaOf), null);
});

test('spin: stopped at 0, true rolling when slow, capped (with the blur level up) when fast', () => {
  assert.deepEqual(spinOf(0, 10), { rate: 0, lvl: 0 });
  const slow = spinOf(1, 10);
  assert.ok(Math.abs(slow.rate - 9 / (2 * Math.PI * 10)) < 1e-9 && slow.lvl === 1);
  const fast = spinOf(60, 10);
  assert.equal(fast.rate, WW_CAP);
  assert.equal(fast.lvl, 3);
});
