import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, GameError } from '../src/game.js';
import { createShareStore, jpegSize, SHARE } from '../src/share.js';
import { createApp } from '../server.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-20T10:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12, slots = 40 WHERE id = 1').run();
  const call = (name, body = {}) => g.api[name](1, body);
  // The next case opened drops this model (the admin "rigged drop" path, the same as a real roll for giveCar).
  const rig = (model) => db.prepare('INSERT INTO rigged_drops (user_id, model, created_at) VALUES (1, ?, ?)').run(model, t);
  return { db, g, call, rig, advance: (ms) => (t += ms) };
}
// A dream that some case drops: the case with the best chance for it.
const dreamOf = (cls) => {
  const m = S.ALL_MODELS.find((x) => x.cls === cls && !x.secret && S.dreamChances(x.id).length);
  return { model: m.id, caseId: S.dreamChances(m.id)[0].caseId };
};
// A minimal JPEG: SOI, a baseline SOF0 with the size, EOI.
const jpeg = (w = 1080, h = 1920, pad = 0) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(pad), Buffer.from([0xff, 0xd9])]);

test('dream car: none yet → a suggestion; set, read back in me, clear', () => {
  const { call } = setup();
  const d0 = call('me').dream;
  assert.equal(d0.model, null);
  assert.ok(S.MODELS[d0.suggest] && !S.MODELS[d0.suggest].secret, 'day 1 suggests a real, non-secret car');
  assert.ok(S.dreamChances(d0.suggest).length, 'the suggested car drops from some case');
  const { model } = dreamOf('S');
  const r = call('dream/set', { model });
  assert.equal(r.dream.model, model);
  assert.equal(r.dream.got, false);
  assert.equal(call('me').dream.model, model);
  call('dream/set', { model: null });
  assert.equal(call('me').dream.model, null);
});

test('dream car: secret and unknown cars are refused', () => {
  const { call } = setup();
  const secret = S.ALL_MODELS.find((m) => m.secret);
  assert.throws(() => call('dream/set', { model: secret.id }), GameError);
  assert.throws(() => call('dream/set', { model: 'no-such-car' }), GameError);
  assert.throws(() => call('dream/set', { model: { a: 1 } }), GameError);
});

test('dream car drop: the case result is marked, me shows it as got; the achievement needs a dream chosen 12 h before', () => {
  const { call, rig, advance } = setup();
  const { model, caseId } = dreamOf('A');
  call('dream/set', { model });
  rig(model);
  const r = call('case/open', { caseId, count: 1 });
  assert.equal(r.results[0].car.model, model);
  assert.equal(r.results[0].dream, true);
  const d = call('me').dream;
  assert.equal(d.got, true);
  assert.equal(d.own, true);
  // Chosen just now: celebrated, but not counted for «Мрійник» (no pick-and-get farming).
  assert.equal(call('achievements').list.find((s) => s.key === 'dream').value, 0);
  // A new dream, held for 12 h, then dropped: counts once.
  const other = S.ALL_MODELS.find((m) => m.cls === 'A' && m.id !== model && !m.secret && S.dreamChances(m.id).length);
  call('dream/set', { model: other.id });
  assert.equal(call('me').dream.got, false);
  advance(S.DREAM.achAgeMs + 1000);
  rig(other.id);
  assert.equal(call('case/open', { caseId: S.dreamChances(other.id)[0].caseId, count: 1 }).results[0].dream, true);
  assert.equal(call('achievements').list.find((s) => s.key === 'dream').value, 1);
  rig(other.id); // the same dream again: still one
  call('case/open', { caseId: S.dreamChances(other.id)[0].caseId, count: 1 });
  const st = call('achievements').list.find((s) => s.key === 'dream');
  assert.equal(st.value, 1);
  assert.equal(st.reached, 1);
  assert.equal(call('ach/claim', { key: 'dream' }).got, S.achReward(S.ACH_BY_KEY.dream.rewards[0]).money);
});

test('dream car: a cheap (D/C) dream never counts for the achievement', () => {
  const { call, rig, advance } = setup();
  const { model, caseId } = dreamOf('D');
  call('dream/set', { model });
  advance(S.DREAM.achAgeMs + 1000);
  rig(model);
  assert.equal(call('case/open', { caseId, count: 1 }).results[0].dream, true);
  assert.equal(call('achievements').list.find((s) => s.key === 'dream').value, 0);
});

test('dream chances: shares of the case odds, best case first, none for secret cars', () => {
  const m = S.ALL_MODELS.find((x) => x.cls === 'S' && !x.secret && S.dreamChances(x.id).length > 1);
  const ch = S.dreamChances(m.id);
  for (let i = 1; i < ch.length; i++) assert.ok(ch[i - 1].pct >= ch[i].pct);
  for (const c of ch) assert.ok(c.pct > 0 && c.pct < 100 && S.CASE_BY_ID[c.caseId].pool(m.cls).some((x) => x.id === m.id));
  assert.deepEqual(S.dreamChances(S.ALL_MODELS.find((x) => x.secret).id), []);
});

test('share store: JPEG only, size and per-player limits, expiry, unguessable ids', () => {
  let t = 0;
  const st = createShareStore({ now: () => t, limits: { ...SHARE, perMinute: 2, maxCount: 3 } });
  assert.deepEqual(jpegSize(jpeg(1080, 1920)), { w: 1080, h: 1920 });
  assert.equal(jpegSize(Buffer.from('\x89PNG\r\n\x1a\n0000000000')), null);
  assert.equal(st.put(1, Buffer.from('<svg onload=alert(1)>')).code, 415);
  assert.equal(st.put(1, jpeg(4000, 4000)).code, 415, 'too many pixels');
  assert.equal(st.put(1, jpeg(1080, 1920, SHARE.maxBytes)).code, 413);
  const a = st.put(1, jpeg());
  assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.ok(st.put(1, jpeg()).id);
  assert.equal(st.put(1, jpeg()).code, 429, 'third card within a minute');
  assert.ok(st.put(2, jpeg()).id, 'another player is not limited');
  assert.ok(st.put(3, jpeg()).id);
  assert.equal(st.get(a.id), null, 'oldest card dropped past maxCount');
  t += 61e3;
  const b = st.put(1, jpeg());
  assert.ok(st.get(b.id));
  assert.equal(st.get('../../etc/passwd'), null);
  t += SHARE.ttlMs + 1;
  assert.equal(st.get(b.id), null, 'expired');
});

test('share over HTTP: upload a card, fetch it publicly; prepare needs the bot and an owned car', async () => {
  const app = createApp({ dbFile: ':memory:', dev: true, log: () => {} });
  const port = await app.start(0);
  const url = (p) => `http://localhost:${port}${p}`;
  const dev = { 'x-dev-user': encodeURIComponent(JSON.stringify({ id: 7, first_name: 'Тест' })) };
  try {
    assert.equal((await fetch(url('/api/share/card'), { method: 'POST', body: jpeg() })).status, 401);
    assert.equal((await fetch(url('/api/share/card'), { method: 'POST', headers: dev, body: 'hello' })).status, 415);
    assert.equal((await fetch(url('/api/share/card'), { method: 'POST', headers: dev, body: Buffer.alloc(SHARE.maxBytes + 10, 0xff) })).status, 413);
    const r = await (await fetch(url('/api/share/card'), { method: 'POST', headers: dev, body: jpeg() })).json();
    assert.match(r.path, /^share\/[0-9a-f]{32}\.jpg$/);
    const img = await fetch(url('/' + r.path));
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.match(img.headers.get('cache-control'), /public/);
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), jpeg());
    assert.equal((await fetch(url('/share/' + 'a'.repeat(32) + '.jpg'))).status, 404);
    // Not in the collection → refused before anything else; in DEV without a bot → a clear error, never a crash.
    const prep = (model) => fetch(url('/api/share/prepare'), { method: 'POST', headers: { ...dev, 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id, model }) });
    assert.match((await (await prep('bugatti-chiron-super-sport')).json()).error, /колекції/);
    app.game.giveCar(7, 'bugatti-chiron-super-sport');
    const e = await prep('bugatti-chiron-super-sport');
    assert.equal(e.status, 400);
    assert.match((await e.json()).error, /бота/);
  } finally {
    app.close();
  }
});
