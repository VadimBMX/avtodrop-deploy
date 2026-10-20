import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'U1' });
  db.prepare('UPDATE users SET balance = 1e13, slots = 100000, level = 99, level_seen = 99 WHERE id = 1').run();
  return { db, g, call: (name, body = {}) => g.api[name](1, body) };
}

test('admin: a guaranteed car drops from the next case that contains it, once', () => {
  const { db, g, call } = setup();
  assert.throws(() => g.admin.rig('t', { id: 1, model: S.SECRET_BY_COUNTRY.JP }), /секретну/);
  const { cases } = g.admin.rig('t', { id: 1, model: 'lexus-lfa' });
  assert.ok(cases.includes('c-jp'));
  call('case/open', { caseId: 'c-ua', count: 1 }); // Ukraine can't drop a Lexus: still waiting
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rigged_drops WHERE used_at IS NULL').get().n, 1);
  const r = call('case/open', { caseId: 'c-jp', count: 3 });
  assert.equal(r.results[0].car.model, 'lexus-lfa');
  assert.equal(r.results.filter((x) => x.car.model === 'lexus-lfa').length >= 1, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rigged_drops WHERE used_at IS NULL').get().n, 0, 'used up');
  assert.equal(db.prepare("SELECT forced FROM drops WHERE item = 'lexus-lfa' ORDER BY id LIMIT 1").get().forced, 3);
});

test('admin: luck for a number of opens, then it switches off', () => {
  const { g, call } = setup();
  assert.equal(call('me').luck, 0);
  g.admin.luck('t', { id: 1, chance: 80, opens: 3 });
  assert.equal(call('me').luck, 0.8);
  call('case/open', { caseId: 'rust', count: 3 });
  assert.equal(call('me').luck, 0, 'used up after 3 opens');
  g.admin.luck('t', { id: 1, chance: 50, opens: 10 });
  g.admin.luck('t', { id: 1, chance: 0 });
  assert.equal(call('me').luck, 0, 'switched off');
});

test('races: a dearer car always races for more, whatever its class', () => {
  const cars = [...S.ALL_MODELS].sort((a, b) => a.price - b.price);
  for (let i = 1; i < cars.length; i++) {
    for (const op of S.OPPONENTS) {
      assert.ok(S.raceMoney(op, cars[i].price).prize >= S.raceMoney(op, cars[i - 1].price).prize, `${cars[i].name} vs ${cars[i - 1].name}`);
    }
  }
  const hard = S.OPPONENTS[2];
  assert.ok(S.raceMoney(hard, S.MODELS['ferrari-sf90-stradale'].price).prize > S.raceMoney(hard, S.MODELS['ferrari-458-italia'].price).prize);
});
