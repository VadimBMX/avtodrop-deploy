// New cars (NEW_RAW in shared.js) stay out of the game until their photo is in public/cars and public/car-photos.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { CAR_PHOTOS } from '../public/car-photos.js';
import { photoIds } from '../tools/car_photos.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pending = Object.values(S.PENDING_MODELS);
const pendingIds = new Set(pending.map((m) => m.id));

test('car-photos.js lists exactly the photos in public/cars (run `npm run car-photos` after adding one by hand)', () => {
  assert.deepEqual([...CAR_PHOTOS].sort(), photoIds());
});

test('every car in the game has a photo; a car without one is only in PENDING_MODELS', () => {
  const photos = new Set(CAR_PHOTOS);
  for (const m of S.ALL_MODELS) assert.ok(photos.has(m.id) || (m.img && photos.has(m.img)), `${m.id} has no photo`);
  for (const m of pending) {
    assert.ok(!photos.has(m.id), m.id);
    assert.equal(S.MODELS[m.id], undefined, m.id);
    assert.ok(!S.isPhotoReady(m.id));
    assert.ok(S.CLASSES[m.cls] && m.price >= S.CLASSES[m.cls].lo && m.price <= S.CLASSES[m.cls].hi, `${m.id} price inside its class`);
  }
  // No name or id clashes with the cars already in the game.
  const names = new Set(S.ALL_MODELS.map((m) => m.name));
  for (const m of pending) assert.ok(!names.has(m.name), m.name);
});

test('cars without a photo are in no case pool, collection, milestone or set', () => {
  for (const cs of S.CASES) for (const cls of S.CLASS_ORDER) assert.ok(!cs.pool(cls).some((m) => pendingIds.has(m.id)), `${cs.id}/${cls}`);
  for (const c of Object.keys(S.COUNTRIES)) assert.ok(!S.countryModels(c).some((m) => pendingIds.has(m.id)), c);
  const regular = S.ALL_MODELS.filter((m) => !m.secret).length;
  assert.equal(S.COLLECTION_MILESTONES.at(-1).n, regular);
  assert.equal(S.ACH_BY_KEY.collection.goals.at(-1), regular);
  for (const s of S.SETS) for (const id of s.models) assert.ok(S.MODELS[id], `${s.id}: ${id}`);
});

test('cars without a photo never drop, never come from the dealer and cannot be given', () => {
  if (!pending.length) return;
  const db = openDb(':memory:');
  let seq = 0;
  const g = createGame(db, { now: () => Date.parse('2026-10-21T10:00:00Z'), random: () => (seq = (seq * 9301 + 49297) % 233280) / 233280, partCooldownMs: 0 });
  g.ensureUser({ id: 1, first_name: 'x' });
  db.prepare('UPDATE users SET balance = 1e15, slots = 40, level = 50 WHERE id = 1').run();
  const seen = new Set();
  for (const cs of S.CASES.filter((c) => !c.starter)) {
    for (let i = 0; i < 20; i++) {
      for (const r of g.api['case/open'](1, { caseId: cs.id, count: 6 }).results) seen.add(r.car.model);
      db.prepare('DELETE FROM cars WHERE owner_id = 1').run();
    }
  }
  assert.ok(seen.size > 60, `opened a wide spread of cars (${seen.size})`);
  for (const id of seen) assert.ok(!pendingIds.has(id) && S.MODELS[id], id);
  g.api['market/list'](1, {});
  for (const r of db.prepare('SELECT model FROM cars').all()) assert.ok(!pendingIds.has(r.model), r.model);
  assert.throws(() => g.giveCar(1, pending[0].id), /Невідома модель/);
});

test('«Уся колекція» is paid once: an old full-collection claim (n142) counts', () => {
  const ms = S.COLLECTION_MILESTONES.at(-1);
  assert.equal(S.milestoneId(ms), 'nall');
  assert.ok(S.milestoneTaken(ms, ['n142']) && S.milestoneTaken(ms, new Set(['nall'])) && !S.milestoneTaken(ms, ['n80']));
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-21T10:00:00Z') });
  g.ensureUser({ id: 7, first_name: 'x' });
  const ins = db.prepare('INSERT OR IGNORE INTO collection (user_id, model, at) VALUES (7, ?, 0)');
  for (const m of S.ALL_MODELS.filter((x) => !x.secret)) ins.run(m.id);
  db.prepare("INSERT INTO claims (user_id, key) VALUES (7, 'n142')").run();
  assert.throws(() => g.api['collection/claim'](7, { key: 'nall' }), /вже отримано/);
});

test('when a photo arrives the car joins the game at the price it already had, and the others keep theirs', () => {
  if (!pending.length) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtodrop-photos-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'public', 'shared.js'), path.join(dir, 'shared.js'));
    const ready = pending.map((m) => m.id);
    fs.writeFileSync(path.join(dir, 'car-photos.js'), `export const CAR_PHOTOS = ${JSON.stringify([...CAR_PHOTOS, ...ready])};\n`);
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const S = await import(${JSON.stringify('file://' + path.join(dir, 'shared.js'))});
      const pool = (id) => S.CASES.filter((cs) => cs.pool(S.MODELS[id].cls).some((m) => m.id === id) && cs.weights[S.MODELS[id].cls]).map((cs) => cs.id);
      console.log(JSON.stringify({ prices: Object.fromEntries(S.ALL_MODELS.map((m) => [m.id, m.price])), pending: Object.keys(S.PENDING_MODELS).length,
        pools: Object.fromEntries(${JSON.stringify(ready)}.map((id) => [id, pool(id)])), sets: S.SETS.map((s) => s.id) }));`], { encoding: 'utf8' });
    const r = JSON.parse(out);
    assert.equal(r.pending, 0);
    for (const m of pending) {
      assert.equal(r.prices[m.id], m.price, `${m.id}: same price before and after its photo`);
      assert.ok(r.pools[m.id].length > 0, `${m.id} drops from a case once it has a photo`);
      if (S.MAIN_COUNTRIES.includes(m.country) && S.CASE_BY_ID['c-' + m.country.toLowerCase()].weights[m.cls]) assert.ok(r.pools[m.id].includes('c-' + m.country.toLowerCase()), `${m.id} drops from its country case`);
    }
    for (const m of S.ALL_MODELS) assert.equal(r.prices[m.id], m.price, `${m.id} keeps its price`);
    assert.ok(r.sets.includes('wild90s') && !S.SETS.some((s) => s.id === 'wild90s'), 'the 90s set opens with its cars');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
