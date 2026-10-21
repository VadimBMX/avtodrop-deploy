import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame, GameError, paintableModels } from '../src/game.js';
import * as S from '../public/shared.js';

const MODEL = 'vaz-2107';
const OFF = 'ssc-tuatara';
function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-14T10:00:00Z'), random: () => 0.5, partCooldownMs: 0, paintable: new Set([MODEL, 'bmw-m5-cs']) });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const mk = (id) => (g.ensureUser({ id, username: 'u' + id, first_name: 'U' }), db.prepare('UPDATE users SET balance = 1e9, slots = 40 WHERE id = ?').run(id), id);
  const give = (uid, model) => Number(db.prepare('INSERT INTO cars (owner_id, model, tank, tank_at, created_at) VALUES (?, ?, 5, 0, 0)').run(uid, model, ).lastInsertRowid);
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  return { db, g, call, mk, give, bal };
}
// width/height from a WebP header (VP8 / VP8L / VP8X)
function webpSize(buf) {
  const t = buf.toString('ascii', 12, 16);
  if (t === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (t === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
}
const throws = (fn, re) => assert.throws(fn, (e) => e instanceof GameError && re.test(e.message));

test('paint: palette and prices follow the model price, with a minimum', () => {
  assert.ok(S.PAINT_COLORS.length >= 16);
  assert.equal(new Set(S.PAINT_COLORS.map((p) => p.id)).size, S.PAINT_COLORS.length);
  for (const p of S.PAINT_COLORS) assert.match(p.hex, /^#[0-9a-f]{6}$/), assert.ok(S.PAINT_FINISH[p.finish]);
  // the ids of the old CSS repaint stay valid
  for (const id of ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'white', 'graphite', 'black']) assert.ok(S.PAINT_BY_ID[id], id);
  assert.equal(S.paintPrice(MODEL), S.PAINT.min);
  const big = S.ALL_MODELS.reduce((a, m) => (m.price > a.price ? m : a));
  assert.ok(Math.abs(S.paintPrice(big.id) / big.price - S.PAINT.rate) < 0.002);
  assert.ok(S.liveryPrice(big.id) > S.paintPrice(big.id));
});

test('paint: buy a colour for an owned car, shown in me / player / market, sell value unchanged', () => {
  const { call, mk, give, bal } = setup();
  const a = mk(1), b = mk(2);
  const id = give(a, 'bmw-m5-cs');
  give(a, MODEL);
  const before = call(a, 'me').cars.find((c) => c.id === id);
  assert.equal(before.look, null);
  const b0 = bal(a);
  const r = call(a, 'car/paint', { carId: id, color: 'teal' });
  assert.equal(r.paid, S.paintPrice('bmw-m5-cs'));
  assert.equal(bal(a), b0 - r.paid);
  assert.deepEqual({ ...r.car.look, n: 0 }, { paint: 'teal', livery: null, n: 0 });
  assert.equal(r.car.value ?? null, before.value ?? null, 'painting gives no value');
  // the same colour again is refused and costs nothing
  throws(() => call(a, 'car/paint', { carId: id, color: 'teal' }), /вже/);
  assert.equal(bal(a), b0 - r.paid);
  // livery on top
  const l = call(a, 'car/livery', { carId: id, livery: 'race' });
  assert.equal(l.paid, S.liveryPrice('bmw-m5-cs'));
  assert.equal(l.car.look.livery, 'race');
  assert.equal(l.car.look.paint, 'teal');
  // others see it
  const card = call(b, 'player', { id: a });
  assert.equal(card.cars.find((c) => c.id === id).look.paint, 'teal');
  call(a, 'market/sell', { carId: id, price: 20000000 });
  const lot = call(b, 'market/list').list.find((x) => x.car.id === id);
  assert.equal(lot.car.look.livery, 'race');
  // listed: can't repaint
  throws(() => call(a, 'car/paint', { carId: id, color: 'red' }), /ринку|аукціоні/);
  // bought: the look comes along
  call(b, 'market/buy', { id: lot.id });
  const mine = call(b, 'me').cars.find((c) => c.id === id);
  assert.equal(mine.look.paint, 'teal');
});

test('paint: validation — ownership, unknown ids, disabled models, money', () => {
  const { call, mk, give, db } = setup();
  const a = mk(1), b = mk(2);
  const id = give(a, MODEL);
  give(a, MODEL);
  throws(() => call(b, 'car/paint', { carId: id, color: 'red' }), /не твоє/);
  throws(() => call(a, 'car/paint', { carId: id, color: 'rainbow' }), /Невідомий/);
  throws(() => call(a, 'car/livery', { carId: id, livery: 'flames' }), /Невідома/);
  throws(() => call(a, 'car/paint', { carId: 'x', color: 'red' }), /ID/);
  const off = give(a, OFF);
  throws(() => call(a, 'car/paint', { carId: off, color: 'red' }), /недоступне/);
  throws(() => call(a, 'car/livery', { carId: off, livery: 'ua' }), /недоступне/);
  db.prepare('UPDATE users SET balance = 100 WHERE id = ?').run(a);
  throws(() => call(a, 'car/paint', { carId: id, color: 'red' }), /Недостатньо/);
  assert.equal(call(a, 'me').cars.find((c) => c.id === id).look, null);
  // removing what isn't there
  throws(() => call(a, 'car/paint', { carId: id, color: null }), /заводському/);
  throws(() => call(a, 'car/livery', { carId: id, livery: null }), /немає/);
  throws(() => call(a, 'car/paint-reset', { carId: id }), /заводська/);
});

test('paint: back to factory and livery off are free; reset clears both; showcase cars can be painted', () => {
  const { call, mk, give, bal } = setup();
  const a = mk(1);
  const id = give(a, MODEL);
  give(a, MODEL);
  call(a, 'showcase', { carId: id, put: true });
  call(a, 'car/paint', { carId: id, color: 'matteblack' });
  call(a, 'car/livery', { carId: id, livery: 'ua' });
  const b0 = bal(a);
  assert.equal(call(a, 'car/livery', { carId: id, livery: '' }).car.look.livery, null);
  assert.equal(call(a, 'car/paint', { carId: id, color: null }).car.look, null);
  call(a, 'car/paint', { carId: id, color: 'red' });
  const b1 = bal(a);
  assert.equal(b1, b0 - S.paintPrice(MODEL));
  assert.equal(call(a, 'car/paint-reset', { carId: id }).car.look, null);
  assert.equal(bal(a), b1);
});

test('paint: an old CSS colour still shows, an unknown one counts as factory; selling a painted car pays the plain price', () => {
  const { call, mk, give, db, bal } = setup();
  const a = mk(1);
  const id = give(a, MODEL);
  const other = give(a, MODEL);
  db.prepare("UPDATE cars SET paint = 'graphite' WHERE id = ?").run(id);
  db.prepare("UPDATE cars SET paint = 'hue-120', livery = 'x' WHERE id = ?").run(other);
  const cars = call(a, 'me').cars;
  assert.equal(cars.find((c) => c.id === id).look.paint, 'graphite');
  assert.equal(cars.find((c) => c.id === other).look, null);
  const b0 = bal(a);
  const r = call(a, 'sell', { carIds: [id] });
  assert.equal(r.got, S.sellPriceOf(MODEL));
  assert.equal(bal(a), b0 + r.got);
});

test('paint: masks exist for the paintable cars and match their photos', () => {
  const set = paintableModels();
  const meta = JSON.parse(fs.readFileSync(new URL('../public/paint/meta.json', import.meta.url), 'utf8'));
  assert.ok(set.size >= 100, `paintable ${set.size}`);
  for (const id of set) {
    assert.ok(S.MODELS[id], `meta for unknown model ${id}`);
    assert.ok(fs.existsSync(new URL(`../public/paint/${id}.png`, import.meta.url)), id);
    assert.ok(fs.existsSync(new URL(`../public/cars/${id}.webp`, import.meta.url)), id);
    const m = meta.cars[id];
    assert.ok(m.wheels.length >= 1 && m.p.length === 3, id);
    // a regenerated photo needs `npm run paint-masks` (the game would show it unpainted otherwise)
    assert.deepEqual(webpSize(fs.readFileSync(new URL(`../public/cars/${id}.webp`, import.meta.url))), [m.w, m.h], `${id}: photo changed, rerun npm run paint-masks`);
  }
  for (const [id, m] of Object.entries(meta.cars)) if (m.off) assert.ok(!set.has(id));
});
