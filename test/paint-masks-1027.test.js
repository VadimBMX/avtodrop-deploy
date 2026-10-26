import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { paintableModels } from '../src/game.js';

// Paint masks made by hand-tuned hints (tools/paint/hints.json) on 27.10 for cars that had paint off.
const NEW = ['nissan-skyline-gt-r-r34', 'nissan-silvia-s15', 'nissan-200sx-s13', 'honda-nsx-na1', 'honda-civic-type-r-ep3', 'honda-civic-ek',
  'mitsubishi-lancer-evolution-ix', 'mitsubishi-lancer-evolution-vi', 'toyota-gr-super-sport', 'lancia-delta-hf-integrale', 'mercedes-benz-190e-2-3-16',
  'vaz-2101-kopiika', 'zaz-965-horbatyi', 'haz-13-chaika', 'zil-41047', 'haz-24-95-volha-4x4', 'haz-24-24-volha-v8', 'ford-mustang-1967', 'ford-gt',
  'shelby-gt500', 'hennessey-venom-f5', 'lotus-evija', 'nio-ep9', 'lucid-air-sapphire', 'porsche-taycan-turbo-s', 'bmw-m5-cs',
  'bmw-x5-m-e70-monte-carlo-blue', 'gmc-hummer-ev', 'yangwang-u9'];

const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)]; // IHDR width / height

test('paint 27.10: the 29 re-masked cars are paintable, their masks sit on the photo canvas and cover a sane share of it', () => {
  const set = paintableModels();
  const meta = JSON.parse(fs.readFileSync(new URL('../public/paint/meta.json', import.meta.url), 'utf8'));
  const hints = JSON.parse(fs.readFileSync(new URL('../tools/paint/hints.json', import.meta.url), 'utf8'));
  for (const id of NEW) {
    assert.ok(set.has(id), `${id} paintable`);
    assert.ok(!hints[id]?.off, `${id}: no off in hints.json`);
    const m = meta.cars[id];
    const png = fs.readFileSync(new URL(`../public/paint/${id}.png`, import.meta.url));
    assert.deepEqual(pngSize(png), [m.w, m.h], `${id}: mask size`);
    assert.equal(m.wheels.length, 2, `${id}: two wheels`);
    assert.ok(m.p[0] <= m.p[1] && m.p[1] <= m.p[2], `${id}: lightness percentiles`);
    assert.ok(m.x1 - m.x0 > 0.8 * m.w && m.top < 0.5 * m.h, `${id}: body box`);
  }
  // still off on purpose (the photo can't separate body from glass / carbon cleanly)
  for (const id of ['bugatti-veyron-16-4', 'koenigsegg-jesko', 'pagani-huayra', 'ssc-tuatara']) assert.ok(!set.has(id), id);
});
