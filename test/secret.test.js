import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

// Country collections → secret cars (22.10: players with the whole country case ✓ got no secret car).
const T0 = Date.parse('2026-10-22T10:00:00Z');
function setup(db = openDb(':memory:'), notes = []) {
  const clock = { t: T0 };
  const g = createGame(db, { now: () => clock.t, random: () => 0.5, notify: (uid, text) => notes.push([uid, text]) });
  const mk = (id) => (g.ensureUser({ id, username: 'u' + id, first_name: 'U' + id }), id);
  const found = (id, models) => { for (const m of models) db.prepare('INSERT OR IGNORE INTO collection (user_id, model, at) VALUES (?, ?, ?)').run(id, m, clock.t); };
  const balance = (id) => db.prepare('SELECT balance FROM users WHERE id = ?').get(id).balance;
  const secrets = (id, c) => db.prepare('SELECT id, status FROM cars WHERE owner_id = ? AND model = ?').all(id, S.SECRET_BY_COUNTRY[c]);
  const claimed = (id, c) => !!db.prepare('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(id, 'c' + c);
  return { db, g, clock, mk, found, balance, secrets, claimed, notes };
}
const caseList = (c) => {
  const cs = S.CASES.find((x) => x.country === c && !x.starter);
  return [...new Set(Object.keys(cs.weights).flatMap((k) => cs.pool(k).map((m) => m.id)))];
};

test('the requirement is the country case list: every needed car drops from its own case, UA gold cars included', () => {
  for (const c of S.MAIN_COUNTRIES) {
    const need = S.countryNeed(c).map((m) => m.id);
    assert.ok(need.length >= 5, c);
    assert.deepEqual([...need].sort(), caseList(c).sort(), `${c}: requirement = what «Що всередині» shows`);
    for (const id of need) assert.ok(!S.MODELS[id].secret && S.MODELS[id].country === c, id);
    assert.ok(S.SECRET_BY_COUNTRY[c] && !need.includes(S.SECRET_BY_COUNTRY[c]), c);
  }
  for (const id of S.ALL_MODELS.filter((m) => m.homeOnly).map((m) => m.id)) assert.ok(S.countryNeed('UA').some((m) => m.id === id), id);
  // The old rule asked for cars no country case drops (JP/DE/CN D cars, IT/US/GB C and D cars).
  assert.ok(S.countryModels('JP').length > S.countryNeed('JP').length);
});

test('reported case: the whole JP/DE/IT/US/GB/CN case collected (without the cheap rarity-case cars) → claim gives the secret car', () => {
  const { g, mk, found, balance, secrets, claimed } = setup();
  let id = 300;
  for (const c of S.MAIN_COUNTRIES) {
    const uid = mk(++id);
    found(uid, caseList(c));
    const p = g.api.pulse(uid);
    assert.ok(p.claims.some((x) => x.key === 'coll:c' + c), `${c}: the claim banner shows`);
    const before = balance(uid);
    const r = g.api['collection/claim'](uid, { key: 'c' + c });
    assert.equal(r.reward.secret, S.SECRET_BY_COUNTRY[c]);
    assert.equal(secrets(uid, c).length, 1, c);
    assert.equal(balance(uid) - before, S.COUNTRY_REWARD[c]);
    assert.ok(claimed(uid, c));
    assert.throws(() => g.api['collection/claim'](uid, { key: 'c' + c }), /вже отримано/);
    assert.ok(!g.api.pulse(uid).claims.some((x) => x.key === 'coll:c' + c));
  }
});

test('one car of the case missing → no claim; cars sold after being found still count', () => {
  const { g, db, mk, found, secrets } = setup();
  const uid = mk(401);
  const list = caseList('IT');
  found(uid, list.slice(1));
  assert.ok(!g.api.pulse(uid).claims.some((x) => x.key === 'coll:cIT'));
  assert.throws(() => g.api['collection/claim'](uid, { key: 'cIT' }), /Збери/);
  // The last one comes from a case drop, then is sold: the collection keeps it.
  const car = g.giveCar(uid, list[0]);
  db.prepare('DELETE FROM cars WHERE id = ?').run(car.id);
  assert.ok(g.api.pulse(uid).claims.some((x) => x.key === 'coll:cIT'));
  g.api['rewards/all'](uid);
  assert.equal(secrets(uid, 'IT').length, 1);
});

test('full garage: the secret car still comes (on the showcase)', () => {
  const { g, db, mk, found, secrets } = setup();
  const uid = mk(402);
  const slots = db.prepare('SELECT slots FROM users WHERE id = ?').get(uid).slots;
  const filler = S.ALL_MODELS.find((m) => m.cls === 'D' && !m.secret).id;
  for (let i = 0; i < slots; i++) g.giveCar(uid, filler);
  found(uid, caseList('GB'));
  const r = g.api['collection/claim'](uid, { key: 'cGB' });
  assert.equal(r.reward.carOut.status, 'showcase');
  assert.equal(secrets(uid, 'GB').length, 1);
});

test('backfill: grants once — car + money to the unclaimed, car only to the claimed; idempotent, notified in Ukrainian', () => {
  const db = openDb(':memory:');
  const a = setup(db);
  const done = a.mk(501), claimedNoCar = a.mk(502), hasIt = a.mk(503), short = a.mk(504), full = a.mk(505);
  a.found(done, caseList('JP'));
  // 502 claimed UA long ago, then the car was lost (an admin removal, a reset of cars).
  a.found(claimedNoCar, caseList('UA'));
  a.g.api['collection/claim'](claimedNoCar, { key: 'cUA' });
  db.prepare('DELETE FROM cars WHERE owner_id = ? AND model = ?').run(claimedNoCar, S.SECRET_BY_COUNTRY.UA);
  a.found(hasIt, caseList('DE'));
  a.g.api['collection/claim'](hasIt, { key: 'cDE' });
  a.found(short, caseList('CN').slice(1));
  const slots = db.prepare('SELECT slots FROM users WHERE id = ?').get(full).slots;
  for (let i = 0; i < slots; i++) a.g.giveCar(full, S.ALL_MODELS.find((m) => m.cls === 'D' && !m.secret).id);
  a.found(full, caseList('US'));
  const bal = Object.fromEntries([done, claimedNoCar, hasIt, short, full].map((u) => [u, a.balance(u)]));

  // A restart of the server on this database: the meta flag is still unset → the backfill runs.
  db.prepare("DELETE FROM meta WHERE key = 'secret_backfill_1'").run();
  const notes = [];
  const b = setup(db, notes);
  assert.equal(b.secrets(done, 'JP').length, 1);
  assert.equal(b.balance(done) - bal[done], S.COUNTRY_REWARD.JP);
  assert.ok(b.claimed(done, 'JP'));
  assert.equal(b.secrets(claimedNoCar, 'UA').length, 1);
  assert.equal(b.balance(claimedNoCar), bal[claimedNoCar], 'claimed before: paid then, no money again');
  assert.equal(b.secrets(hasIt, 'DE').length, 1, 'already had it: no second car');
  assert.equal(b.balance(hasIt), bal[hasIt]);
  assert.equal(b.secrets(short, 'CN').length, 0);
  assert.equal(b.balance(short), bal[short]);
  assert.equal(b.secrets(full, 'US').length, 1);
  assert.equal(b.secrets(full, 'US')[0].status, 'showcase');
  // In-app: an event and a window; the bot message waits for the sender.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gifts WHERE kind = 'secret'").get().n, 3);
  assert.match(db.prepare('SELECT text FROM events WHERE user_id = ? ORDER BY id DESC').get(done).text, /^🎁 Ти зібрав колекцію «Японія» — секретна машина .+ у твоєму гаражі/);
  assert.equal(notes.length, 0);
  assert.equal(b.g.flushStartupNotes(), 3);
  assert.equal(notes.length, 3);
  assert.deepEqual(notes.map((n) => n[0]).sort(), [done, claimedNoCar, full].sort());
  assert.equal(b.g.flushStartupNotes(), 0, 'sent once');

  // Run again (forced, and as a normal restart): nothing more.
  assert.deepEqual(b.g.backfillSecrets(), { cars: 0, players: 0 });
  setup(db);
  for (const [u, c] of [[done, 'JP'], [claimedNoCar, 'UA'], [full, 'US']]) assert.equal(b.secrets(u, c).length, 1);
  assert.equal(b.balance(done) - bal[done], S.COUNTRY_REWARD.JP);
  // No double money through the normal claim paths either.
  assert.throws(() => b.g.api['collection/claim'](done, { key: 'cJP' }), /вже отримано/);
  const before = b.balance(done);
  try { b.g.api['rewards/all'](done); } catch {}
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND model = ?").get(done, S.SECRET_BY_COUNTRY.JP).n, 1);
  assert.ok(b.balance(done) - before < S.COUNTRY_REWARD.JP, 'rewards/all pays no country reward again');
});

test('the meta flag keeps a normal restart from scanning again', () => {
  const db = openDb(':memory:');
  const a = setup(db);
  const uid = a.mk(601);
  a.found(uid, caseList('CN'));
  setup(db); // flag set on the first start: no backfill now, the player claims it himself
  assert.equal(a.secrets(uid, 'CN').length, 0);
  assert.ok(a.g.api.pulse(uid).claims.some((x) => x.key === 'coll:cCN'));
});
