import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'U1' });
  db.prepare('UPDATE users SET balance = 1e15, slots = 100000, level = 99, level_seen = 99 WHERE id = 1').run();
  return { db, g };
}

test('city case: a purple car at least every PITY2 opens, a blue one every PITY', () => {
  const { db, g } = setup();
  assert.deepEqual(S.pityClasses(S.CASE_BY_ID.city), { first: 'C', second: 'B' });
  for (let i = 0; i < 400; i++) g.api['case/open'](1, { caseId: 'city', count: 6 });
  const drops = db.prepare("SELECT cls FROM drops WHERE case_id = 'city' ORDER BY id").all().map((r) => r.cls);
  let sinceB = 0, sinceC = 0;
  for (const cls of drops) {
    sinceB = S.rankOf(cls) >= S.rankOf('B') ? 0 : sinceB + 1;
    sinceC = S.rankOf(cls) >= S.rankOf('C') ? 0 : sinceC + 1;
    assert.ok(sinceB < S.PITY2, 'no 40-open streak without purple');
    assert.ok(sinceC < S.PITY, 'no 30-open streak without blue');
  }
  const purple = drops.filter((c) => S.rankOf(c) >= S.rankOf('B')).length / drops.length;
  const eff = S.effectiveWeights(S.CASE_BY_ID.city);
  // Losing-streak protection only adds good drops on top of the priced share.
  assert.ok(purple > eff.B + eff.A - 0.01, `purple-or-better ${purple} ≥ priced share ${eff.B + eff.A}`);
});

test('no second guarantee for jackpots or the fixed-price rust case', () => {
  for (const id of ['rust', 'sport', 'elite', 'c-ua', 'c-jp', 'c-de', 'c-it', 'c-us', 'c-gb']) assert.equal(S.pityClasses(S.CASE_BY_ID[id]).second, null, id);
});


test('a price change revalues garages without inflating the weekly growth', async () => {
  const { db, g } = setup();
  g.giveCar(1, 'lexus-lfa');
  g.api.me(1);
  db.prepare('UPDATE users SET total_value = total_value - 1000000, week_start_value = week_start_value - 1000000').run();
  db.prepare("DELETE FROM meta WHERE key = 'price_sig'").run();
  const before = db.prepare('SELECT total_value - week_start_value g FROM users WHERE id = 1').get().g;
  createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  const u = db.prepare('SELECT total_value t, total_value - week_start_value g FROM users WHERE id = 1').get();
  assert.ok(u.t >= S.MODELS['lexus-lfa'].price, 'revalued at the current price');
  assert.equal(u.g, before, 'weekly growth unchanged');
});
