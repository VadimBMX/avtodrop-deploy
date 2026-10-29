// Green "key" photos for the new cars (FACTORY_PAINT in shared.js, tools/paint/green.py, key-car path in paint.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as S from '../public/shared.js';
import { paintSource, lookPaints, keyCurve, shadeLut } from '../public/paint.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'green', 'haz-21-volha.webp');

function webpSize(buf) {
  const t = buf.toString('ascii', 12, 16);
  if (t === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (t === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
}
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10);

test('green: factory colours for every new car, valid and only for NEW_RAW cars', () => {
  const ids = Object.keys(S.FACTORY_PAINT);
  assert.equal(ids.length, 32); // 27 cars of prompts 151–177 + the five Italian B cars of 29.10 (178–182)
  assert.match(S.KEY_GREEN, /^#[0-9a-f]{6}$/);
  for (const id of ids) {
    const f = S.FACTORY_PAINT[id];
    assert.ok(S.PENDING_MODELS[id] || S.MODELS[id], `${id} is a car`);
    assert.ok(S.isKeyCar(id), id);
    assert.match(f.hex, /^#[0-9a-f]{6}$/, id);
    assert.ok(S.PAINT_FINISH[f.finish], id);
    if (f.two) {
      assert.match(f.two.hex, /^#[0-9a-f]{6}$/, id);
      assert.ok(['above', 'below'].includes(f.two.side) && f.two.at > 0 && f.two.at < 1, id);
    }
  }
  assert.ok(!S.isKeyCar('vaz-2107'));
});

test('green: paint.js paints a key car from its green base, other cars from their photo', () => {
  const photo = (id) => `cars/${id}.webp?v=x`;
  const key = { w: 10, h: 4, base: 'abc123', factory: { hex: '#cc1118', finish: 'gloss' } };
  assert.equal(paintSource('ferrari-f40', key, photo), 'cars/base/ferrari-f40.webp?v=abc123');
  assert.equal(paintSource('vaz-2107', { w: 10, h: 4 }, photo), 'cars/vaz-2107.webp?v=x');
  // a look without a paint (livery only) keeps the factory colour on a key car, nothing on others
  assert.equal(lookPaints({ livery: 'race' }, key).pc.hex, '#cc1118');
  assert.equal(lookPaints({ livery: 'race' }, { w: 1 }).pc, null);
  assert.equal(lookPaints({ paint: 'blue' }, key).pc, S.PAINT_BY_ID.blue);
  const two = { ...key, factory: { hex: '#8cc5bd', finish: 'gloss', two: { hex: '#ebe2c8', side: 'above', at: 0.36 } } };
  assert.equal(lookPaints(null, two).two.hex, '#ebe2c8');
  assert.equal(lookPaints({ paint: 'red' }, two).two, null, 'a repaint covers the whole body');
  // key tone curve: mid tones untouched, blacks pushed down, whites get highlight room
  assert.deepEqual(keyCurve(50), [50, 1, 1]);
  assert.ok(keyCurve(8)[1] > 2 && keyCurve(95)[0] < 95 && keyCurve(95)[2] < 1);
  // non-key tables are as before (key=false is the default)
  assert.deepEqual(shadeLut([40, 20, 10], [20, 50, 80], 'gloss'), shadeLut([40, 20, 10], [20, 50, 80], 'gloss', false, false));
});

test('green: every green base in public/cars has its baked photo, mask and meta entry (run npm run green-cars)', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(PUB, 'paint', 'meta.json'), 'utf8')).cars;
  const dir = path.join(PUB, 'cars', 'base');
  const bases = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)) : [];
  for (const id of bases) {
    const m = meta[id];
    assert.ok(S.isKeyCar(id), `${id}: base photo for a car without FACTORY_PAINT`);
    assert.ok(m?.base, `${id}: no green meta entry`);
    assert.equal(m.base, sha(path.join(dir, id + '.webp')), `${id}: base changed, rerun npm run green-cars`);
    assert.equal(m.baked, sha(path.join(PUB, 'cars', id + '.webp')), `${id}: photo is not the bake, rerun npm run green-cars`);
    assert.deepEqual(m.factory, JSON.parse(JSON.stringify({ hex: S.FACTORY_PAINT[id].hex, finish: S.FACTORY_PAINT[id].finish, ...(S.FACTORY_PAINT[id].two ? { two: S.FACTORY_PAINT[id].two } : {}) })), `${id}: factory colour changed, rerun npm run green-cars`);
  }
  for (const [id, m] of Object.entries(meta)) if (m.base) assert.ok(bases.includes(id), `${id}: meta says green base but there is none`);
});

const PY = ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import numpy, scipy, PIL'], { stdio: 'ignore' }).status === 0);
test('green: green.py builds a matching mask and bakes the factory colour, idempotently', { skip: !PY && 'needs python with numpy/scipy/pillow' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'green-'));
  try {
    for (const d of ['public/cars', 'public/paint']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
    for (const f of ['shared.js', 'car-photos.js']) fs.copyFileSync(path.join(PUB, f), path.join(tmp, 'public', f));
    // as `npm run cars` / the cloud cutter leave it: the green photo in public/cars
    fs.copyFileSync(FIXTURE, path.join(tmp, 'public/cars/haz-21-volha.webp'));
    const run = () => {
      const r = spawnSync(PY, ['-I', path.join(ROOT, 'tools/paint/green.py'), '--root', tmp, 'haz-21-volha'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /haz-21-volha: ok/);
    };
    run();
    const base = path.join(tmp, 'public/cars/base/haz-21-volha.webp'), baked = path.join(tmp, 'public/cars/haz-21-volha.webp');
    const mask = path.join(tmp, 'public/paint/haz-21-volha.png');
    assert.equal(sha(base), sha(FIXTURE), 'the green original is kept as the base');
    const size = webpSize(fs.readFileSync(FIXTURE));
    assert.deepEqual(webpSize(fs.readFileSync(baked)), size);
    assert.deepEqual(pngSize(fs.readFileSync(mask)), size);
    const m = JSON.parse(fs.readFileSync(path.join(tmp, 'public/paint/meta.json'), 'utf8')).cars['haz-21-volha'];
    assert.deepEqual([m.w, m.h], size);
    assert.equal(m.base, sha(base));
    assert.equal(m.baked, sha(baked));
    assert.equal(m.factory.hex, S.FACTORY_PAINT['haz-21-volha'].hex);
    assert.equal(m.wheels.length, 2);
    assert.ok(m.p[0] < m.p[1] && m.p[1] < m.p[2]);
    assert.notEqual(sha(baked), sha(base), 'the photo is baked, not the green original');
    const before = [base, baked, mask].map(sha);
    run();
    assert.deepEqual([base, baked, mask].map(sha), before, 'a second run changes nothing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
