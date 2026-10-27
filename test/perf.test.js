// 2026-10-29-perf: the speed-ups must not change any answer — per-hour Kyiv clock caches across the summer-time switch,
// memoized catalogue lookups return fresh copies, `me` reads car data in a few queries with the same result, list
// pictures get the small copy only where asked, the server offers a copy only for the current photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame, dayOf } from '../src/game.js';
import { createApp } from '../server.js';
import * as S from '../public/shared.js';

const KYIV_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });
const KYIV_MIN = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

test('Kyiv clock caches: same answers as Intl around the summer-time switches, minute by minute', () => {
  for (const at of ['2026-10-25T00:00:00Z', '2026-03-29T00:00:00Z', '2026-10-24T20:30:00Z', '2026-12-31T21:00:00Z']) {
    const t0 = Date.parse(at);
    for (let t = t0; t < t0 + 3 * 3600e3; t += 7 * 60e3 + 13e3) {
      assert.equal(dayOf(t), KYIV_DAY.format(new Date(t)), new Date(t).toISOString());
      assert.equal(S.kyivLocal(t).replace('T', ' '), KYIV_MIN.format(new Date(t)), new Date(t).toISOString());
    }
  }
  assert.equal(S.kyivMidnightOf('2026-10-25'), Date.parse('2026-10-24T21:00:00Z'));
  assert.equal(S.kyivMidnightOf('2026-10-26'), Date.parse('2026-10-25T22:00:00Z'));
  assert.throws(() => dayOf(NaN));
});

test('memoized dreamChances / countryNeed hand out copies', () => {
  const id = S.ALL_MODELS.find((m) => !m.secret && S.dreamChances(m.id).length).id;
  const a = S.dreamChances(id);
  a[0].pct = -1;
  a.push({ caseId: 'x', pct: 0 });
  assert.notEqual(S.dreamChances(id)[0].pct, -1);
  assert.equal(S.dreamChances(id).length, a.length - 1);
  const c = S.MAIN_COUNTRIES[0], n = S.countryNeed(c).length;
  S.countryNeed(c).length = 0;
  assert.equal(S.countryNeed(c).length, n);
  assert.deepEqual(S.dreamChances('no-such-car'), []);
});

test('me: cars with parts, plates and restyle read in bulk give the same result as one by one', () => {
  const db = openDb(':memory:');
  const g = createGame(db, { notify: () => {}, admins: [1] });
  g.ensureUser({ id: 5, first_name: 'A' });
  db.prepare('UPDATE users SET slots = 30, level = 20 WHERE id = 5').run();
  const plain = S.ALL_MODELS.filter((m) => !m.secret && !m.edition && !S.isCollector(m.id));
  const ids = [0, 1, 2, 3, 4].map((i) => g.giveCar(5, plain[i * 9].id).id);
  const types = Object.keys(S.PARTS);
  db.prepare("INSERT INTO car_parts (car_id, type, tier) VALUES (?, ?, 'street'), (?, ?, 'sport')").run(ids[1], types[2], ids[1], types[0]);
  db.prepare("INSERT INTO plates (owner_id, text, cls, value, car_id, created_at) VALUES (5, 'AA 7777 AA', 'S', 123456, ?, 1)").run(ids[2]);
  db.prepare('INSERT INTO car_restyle (car_id, stars, at, spent) VALUES (?, 2, 1000, 5000)').run(ids[3]);
  const me = g.api.me(5);
  const byId = Object.fromEntries(me.cars.map((c) => [c.id, c]));
  assert.deepEqual(Object.keys(byId[ids[1]].parts), [types[0], types[2]].sort());
  assert.equal(byId[ids[1]].parts[types[0]], 'sport');
  assert.deepEqual({ ...byId[ids[2]].plate }, { id: byId[ids[2]].plate.id, text: 'AA 7777 AA', cls: 'S', value: 123456 });
  assert.equal(byId[ids[3]].stars, 2);
  assert.equal(byId[ids[3]].starSpent, 5000);
  assert.equal(byId[ids[0]].plate, null);
  assert.deepEqual(byId[ids[0]].parts, {});
  // the garage value counts the plate and the parts like S.carValue one car at a time
  const want = me.cars.reduce((s, c) => s + S.carValue({ model: c.model, parts: c.parts, plateValue: c.plate?.value || 0 }), 0);
  assert.equal(db.prepare('SELECT total_value v FROM users WHERE id = 5').get().v, want);
});

test('carArt: the small copy only for list pictures without paint; config offers copies of current photos only', async () => {
  const { carArt, setImages } = await import('../public/car.js');
  const m = S.ALL_MODELS.find((x) => !x.secret && !x.img);
  setImages({ [m.id]: `cars/${m.id}.webp?v=a` }, { [m.id]: `cars/thumb/${m.id}.webp?v=b` });
  assert.ok(!carArt(m.id).includes('srcset'));
  assert.match(carArt(m.id, { thumb: true }), /srcset="cars\/thumb\/[^"]+ 480w, cars\/[^"]+ 900w" sizes="160px"/);
  // painted / dirty pictures are redrawn from the full photo (paint.js, dirt.js): never a srcset there
  const painted = carArt(m.id, { thumb: true, look: { paint: Object.keys(S.PAINT_BY_ID)[0], livery: null, n: 1 } });
  if (painted.includes('data-look')) assert.ok(!painted.includes('srcset'));
  const dirty = carArt(m.id, { thumb: true, dirt: 100 });
  assert.ok(dirty.includes('data-dirt') && !dirty.includes('srcset'));
  setImages({});

  const app = createApp({ dbFile: ':memory:', dev: true, log: () => {} });
  const port = await app.start(0);
  const cfg = await (await fetch(`http://localhost:${port}/api/config`)).json();
  app.close();
  const index = JSON.parse(fs.readFileSync(new URL('../public/cars/thumb/index.json', import.meta.url), 'utf8'));
  for (const [id, url] of Object.entries(cfg.thumbs)) {
    assert.match(url, new RegExp(`^cars/thumb/${id}\\.webp\\?v=`));
    assert.equal(cfg.images[id].split('?v=')[1], index[id]);
  }
  assert.ok(Object.keys(cfg.thumbs).length > 0);
});
