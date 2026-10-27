// Spinning wheels in the drag race (public/race-wheels.js + race-wheels-data.js from tools/race_wheels.py): the
// elliptical disc math and the wheel data every photo needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../public/shared.js';
import { wheelBox, wheelData, spinOf, WW_CAP } from '../public/race-wheels.js';
import { WW_DATA } from '../public/race-wheels-data.js';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
// 2×2 matrices of a CSS transform list made of rotate(Xdeg) / scaleY(k)
const mat = (s) => [...s.matchAll(/(rotate|scaleY)\(([-\d.e]+)(deg)?\)/g)].reduce((M, [, fn, v]) => {
  const n = Number(v), c = Math.cos((n * Math.PI) / 180), si = Math.sin((n * Math.PI) / 180);
  const B = fn === 'rotate' ? [c, -si, si, c] : [1, 0, 0, n];
  return [M[0] * B[0] + M[1] * B[2], M[0] * B[1] + M[1] * B[3], M[2] * B[0] + M[3] * B[2], M[2] * B[1] + M[3] * B[3]];
}, [1, 0, 0, 1]);

test('at rest the disc is the photo pixel for pixel; turning keeps it on the wheel ellipse', () => {
  const d = wheelData('zil-41047'); // a clearly elliptical, tilted pair of wheels
  for (const q of d.wheels) {
    const b = wheelBox(d.w, d.h, q);
    // the frame: a square of side 2a centred on the wheel
    near((b.left / 100) * d.w + q.a, q.cx);
    near((b.top / 100) * d.h + q.a, q.cy);
    near((b.size / 100) * d.w, 2 * q.a);
    // the photo layer lines up with the photo underneath (origin at photo 0,0, full photo width)
    near((b.left / 100) * d.w + (b.pl / 100) * 2 * q.a, 0);
    near((b.top / 100) * d.h + (b.pt / 100) * 2 * q.a, 0);
    near((b.pw / 100) * 2 * q.a, d.w);
    // both transforms are about the wheel centre, and frame ∘ photo = identity
    const [ox, oy] = b.origin.split(' ').map(parseFloat);
    near((ox / 100) * d.w, q.cx);
    near((oy / 100) * d.h, q.cy);
    const E = mat(b.ell), I = mat(b.inv);
    const P = [E[0] * I[0] + E[1] * I[2], E[0] * I[1] + E[1] * I[3], E[2] * I[0] + E[3] * I[2], E[2] * I[1] + E[3] * I[3]];
    [1, 0, 0, 1].forEach((v, i) => near(P[i], v, 1e-4));
    // the turning circle (radius a) lands on the ellipse: semi-axes a along the tilt, b across it
    const len = (x, y) => Math.hypot(E[0] * x + E[1] * y, E[2] * x + E[3] * y);
    near(len(q.a, 0), q.a, 1e-3);
    near(len(0, q.a), q.b, 1e-2);
  }
});

test('every race photo has wheel data from the tool, inside the picture, mostly turning', () => {
  const photos = fs.readdirSync(new URL('../public/cars', import.meta.url)).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5));
  let n = 0, spin = 0;
  for (const id of photos) {
    const d = wheelData(id);
    assert.ok(d, `no wheels for ${id}`);
    assert.ok(d.wheels.length >= 1 && d.wheels.length <= 2, id);
    for (const q of d.wheels) {
      n++;
      spin += q.spin;
      const R = Math.max(q.a, q.b);
      assert.ok(q.cx - R > 0 && q.cx + R < d.w && q.cy - R > 0 && q.cy + R <= d.h + 1, id);
      assert.ok(q.a > 0.07 * d.h && q.a < 0.3 * d.h && q.b / q.a > 0.75 && q.b / q.a < 1.3, id);
    }
  }
  assert.ok(spin / n > 0.85, `only ${spin}/${n} wheels turn`);
  assert.deepEqual(Object.keys(WW_DATA).sort(), photos.sort());
});

test('a season livery uses the wheels of the photo it borrows; unknown models get none', () => {
  const liv = Object.keys(S.MODELS).find((id) => S.MODELS[id].img && !WW_DATA[id]);
  if (liv) assert.deepEqual(wheelData(liv), wheelData(S.MODELS[liv].img));
  assert.equal(wheelData('no-such-car'), null);
});

test('spin: stopped at 0, true rolling when slow, capped (with the blur level up) when fast', () => {
  assert.deepEqual(spinOf(0, 10), { rate: 0, lvl: 0 });
  const slow = spinOf(1, 10);
  assert.ok(Math.abs(slow.rate - 9 / (2 * Math.PI * 10)) < 1e-9 && slow.lvl === 1);
  const fast = spinOf(60, 10);
  assert.equal(fast.rate, WW_CAP);
  assert.equal(fast.lvl, 3);
});
