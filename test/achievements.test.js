import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12, slots = 1000, level = 99, level_seen = 99 WHERE id = 1').run();
  return { db, g, call: (name, body = {}) => g.api[name](1, body) };
}
const state = (call, key) => call('achievements').list.find((s) => s.key === key);

test('achievements: progress from past play, every tier pays once', () => {
  const { db, call } = setup();
  db.prepare('UPDATE users SET cases_opened = 120 WHERE id = 1').run(); // played before achievements existed
  const s = state(call, 'cases');
  assert.equal(s.reached, 2);
  assert.equal(s.claimed, 0);
  const before = call('me').balance;
  const r = call('ach/claim', { key: 'cases' });
  assert.equal(r.got, S.ACH_BY_KEY.cases.rewards[0] + S.ACH_BY_KEY.cases.rewards[1]);
  assert.equal(call('me').balance, before + r.got);
  assert.equal(state(call, 'cases').claimed, 2);
  assert.throws(() => call('ach/claim', { key: 'cases' }), /Немає нових/);
});

test('achievements: rarest class, tuning and secrets are measured from what you own', () => {
  const { g, call } = setup();
  g.giveCar(1, 'lexus-lfa');
  assert.equal(state(call, 'rarest').reached, 3, 'an S car reaches the B, A and S tiers');
  const car = g.giveCar(1, 'zaz-lanos').id;
  for (const k of S.PART_KEYS) {
    g.addPart(1, k, 'pro', 1);
    call('parts/install', { carId: car, type: k, tier: 'pro' });
  }
  assert.equal(state(call, 'tuned').reached, 3, '8 Pro parts = third tier');
  g.giveCar(1, S.SECRET_BY_COUNTRY.UA);
  assert.equal(state(call, 'secrets').reached, 1);
});

test('achievements show up in the banner poll: one each, or one "claim all"', () => {
  const { db, call } = setup();
  db.prepare('UPDATE users SET wins = 15, level = 1, level_seen = 1 WHERE id = 1').run();
  let c = call('pulse').claims.filter((x) => x.kind === 'ach' || x.kind === 'achAll');
  assert.deepEqual(c.map((x) => x.kind + ':' + x.id), ['ach:wins']);
  db.prepare('UPDATE users SET cases_opened = 20, merges = 10, streak = 5 WHERE id = 1').run();
  c = call('pulse').claims.filter((x) => x.kind === 'ach' || x.kind === 'achAll');
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'achAll');
  call('ach/claim');
  assert.equal(call('pulse').claims.filter((x) => x.kind === 'ach' || x.kind === 'achAll').length, 0);
});

test('every achievement has a text for each tier and growing goals', () => {
  for (const a of S.ACHIEVEMENTS) {
    assert.equal(a.goals.length, a.rewards.length, a.key);
    assert.ok(a.goals.length <= S.ACH_TIERS.length, a.key);
    a.goals.forEach((g, i) => {
      assert.ok(S.achText(a, i).length > 5, `${a.key} tier ${i}`);
      if (i) assert.ok(g > a.goals[i - 1] && a.rewards[i] > a.rewards[i - 1], `${a.key} grows`);
    });
  }
});
