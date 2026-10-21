import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-14T10:00:00Z'), notify: () => {}, partCooldownMs: 0 });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const rich = (id, slots = 40) => db.prepare('UPDATE users SET balance = 1e12, slots = ?, level = 99, level_seen = 99 WHERE id = ?').run(slots, id);
  return { db, g, mk, call, rich };
}

test('garage space: "full" only when it is, otherwise how many slots are free', () => {
  const { g, mk, call, rich } = setup();
  mk(1);
  rich(1, 6);
  for (const m of ['vaz-2107', 'vaz-2106', 'vaz-2107', 'vaz-2106']) g.giveCar(1, m);
  assert.throws(() => call(1, 'case/open', { caseId: 'rust', count: 3 }), /Не вистачає місця для ×3 — вільно 2/);
  assert.throws(() => call(1, 'case/open', { caseId: 'rust', count: 6 }), /Не вистачає місця для ×6 — вільно 2/);
  assert.equal(call(1, 'case/open', { caseId: 'rust', count: 1 }).results.length, 1, '×1 still fits');
  g.giveCar(1, 'vaz-2107');
  assert.throws(() => call(1, 'case/open', { caseId: 'rust', count: 1 }), /Гараж заповнений/);
});

test('starter car: the only car is never sellable, so the drop screen must not offer it; a second car is', () => {
  const { g, mk, call } = setup();
  mk(2);
  call(2, 'intro/seen');
  const { results } = call(2, 'case/open', { caseId: 'starter' });
  assert.throws(() => call(2, 'sell', { carIds: [results[0].car.id] }), /Останню машину продати не можна/);
  assert.equal(S.GUIDE_STEPS.find((s) => s.key === 'keep').text.includes('Продати'), false, 'the guide no longer teaches selling it');
  const other = g.giveCar(2, 'vaz-2107').id;
  assert.ok(call(2, 'sell', { carIds: [other] }).got > 0);
});

test('battle: the consolation car never pushes a full garage over its limit — it is sold at once', () => {
  const { g, mk, call, rich } = setup();
  mk(1);
  mk(2);
  rich(1, 2);
  rich(2, 2);
  // Both garages full (2/2) before the battle.
  for (const id of [1, 2]) for (let i = 0; i < 2; i++) g.giveCar(id, 'vaz-2106');
  let b;
  for (let tries = 0; tries < 20; tries++) {
    const { id } = call(1, 'battle/create', { caseId: 'rust', count: 1 });
    b = call(2, 'battle/join', { id });
    if (b.winnerId) break;
  }
  assert.ok(b.winnerId, 'a battle with a winner');
  const loser = b.winnerId === 1 ? 2 : 1;
  const c = b.result.consolation;
  assert.ok(c.soldFor > 0, 'sold instead of given');
  assert.equal(c.soldFor, S.sellPriceOf(c.model));
  assert.equal(c.id, undefined, 'no car was created');
  const me = call(loser, 'me');
  assert.ok(me.used <= me.slots, `loser within the limit: ${me.used}/${me.slots}`);
  // The creator (who may not be watching) hears about it in the notifications; the joiner sees the result screen.
  if (loser === 1) assert.ok(call(1, 'events', {}).list.some((e) => /Утішну машину продано/.test(e.text)));
});

test('battle: with a free slot the loser still gets the consolation car', () => {
  const { mk, call, rich } = setup();
  mk(1);
  mk(2);
  rich(1);
  rich(2);
  let b;
  for (let tries = 0; tries < 20; tries++) {
    const { id } = call(1, 'battle/create', { caseId: 'rust', count: 1 });
    b = call(2, 'battle/join', { id });
    if (b.winnerId) break;
  }
  const loser = b.winnerId === 1 ? 2 : 1;
  assert.ok(b.result.consolation.id);
  assert.ok(call(loser, 'me').cars.some((c) => c.id === b.result.consolation.id));
});

test('parts: a random part fits the player’s cars (no battery for a petrol garage)', () => {
  const ev = S.ALL_MODELS.find((m) => m.ev && !m.secret).id;
  const petrol = 'vaz-2107';
  assert.ok(!S.partPoolFor([petrol]).some((k) => S.PARTS[k].ev), 'petrol: no EV parts');
  assert.ok(S.partPoolFor([ev]).includes('battery') && !S.partPoolFor([ev]).includes('turbo'), 'EV: no turbo');
  assert.deepEqual(S.partPoolFor([petrol, ev]), S.PART_KEYS, 'mixed garage: everything');
  assert.deepEqual(S.partPoolFor([]), S.PART_KEYS, 'no cars: everything');

  const { g, mk, call, rich } = setup();
  mk(5);
  rich(5);
  g.giveCar(5, petrol);
  const got = [];
  for (let i = 0; i < 12; i++) got.push(...call(5, 'parts/open', { caseId: 'scrap', count: 10 }).results.map((r) => r.type));
  assert.ok(!got.some((t) => S.PARTS[t].ev), 'never an EV-only part');
  assert.ok(new Set(got).size >= 6, 'still a spread of types');
  // A picked type is honoured as before.
  assert.ok(call(5, 'parts/open', { caseId: 'scrap', type: 'battery', count: 1 }).results.every((r) => r.type === 'battery'));
  assert.notEqual(S.PART_CASE_BY_ID.atelier.name, S.CASE_BY_ID.tuning.name, 'parts case and car case have different names');
});

test('first steps: stale steps are skipped and the hints can be turned back on', () => {
  const step = (p) => S.guideStep({ introSeen: true, keys: {}, garage: 1, flags: [], races: 0, streak: 0, dailyReady: true, ...p });
  assert.equal(step({ races: 1 }), 'daily', 'raced before collecting: the collect step is stale');
  assert.equal(step({ opened: S.GUIDE_PAST.opened }), null, 'well past the first minutes');
  assert.equal(step({ level: S.GUIDE_PAST.level }), null);
  assert.equal(step({ opened: 3, level: 2 }), 'collect');

  const { mk, call } = setup();
  mk(3);
  call(3, 'intro/seen');
  call(3, 'case/open', { caseId: 'starter' });
  call(3, 'guide/off');
  assert.equal(call(3, 'me').guide, null);
  call(3, 'guide/on');
  assert.equal(call(3, 'me').guide, 'collect', 'back on where it was');
  assert.ok(!call(3, 'me').claims.includes('guide-off'));
});
