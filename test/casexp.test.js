// Car-case xp by price with its own daily cap, and the one-time backfill (owner 23.10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

test('case xp: 5 for the cheapest case, more for dearer ones, 22 for Еліта', () => {
  assert.equal(S.caseXp(S.CASE_BY_ID.rust), 5);
  assert.equal(S.caseXp(S.CASE_BY_ID['c-ua']), 5);
  assert.equal(S.caseXp(S.CASE_BY_ID.elite), 22);
  let prev = 0;
  for (const id of ['rust', 'city', 'tuning', 'sport', 'premium', 'elite']) {
    const x = S.caseXp(S.CASE_BY_ID[id]);
    assert.ok(x >= prev, id);
    prev = x;
  }
});

test('case xp: own daily cap, part cases keep the shared 300', () => {
  const clock = { t: Date.parse('2026-10-23T10:00:00Z') };
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => clock.t, notify: () => {}, allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12, slots = 1000 WHERE id = 1').run();
  const xpOf = () => { const u = db.prepare('SELECT level, xp FROM users WHERE id = 1').get(); return Array.from({ length: u.level - 1 }, (_, i) => S.xpForLevel(i + 1)).reduce((a, b) => a + b, 0) + u.xp; };
  const used = () => db.prepare('SELECT xp_case_used FROM users WHERE id = 1').get().xp_case_used;
  g.api['case/open'](1, { caseId: 'elite', count: 6 });
  assert.equal(used(), 6 * 22);
  for (let i = 0; i < 20; i++) g.api['case/open'](1, { caseId: 'elite', count: 6 });
  assert.equal(used(), S.CASE_XP_CAP);
  assert.ok(xpOf() >= S.CASE_XP_CAP);
});

test('case xp backfill: pays the difference once, idempotent, no season xp', () => {
  const t0 = Date.parse('2026-10-20T10:00:00Z');
  const clock = { t: t0 };
  const db = openDb(':memory:');
  let g = createGame(db, { now: () => clock.t, notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  const ins = db.prepare("INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, created_at) VALUES (1, ?, 'x', 'A', 'h', 'c', 0, ?)");
  for (let i = 0; i < 100; i++) ins.run('elite', t0 + i * 1000); // one day: new min(1500, 2200) − old min(300, 500) = 1200
  db.prepare("DELETE FROM meta WHERE key = 'xp_case_backfill_1'").run();
  const season0 = db.prepare('SELECT season_xp FROM users WHERE id = 1').get().season_xp;
  g = createGame(db, { now: () => clock.t, notify: () => {} });
  const u = db.prepare('SELECT level, xp, season_xp FROM users WHERE id = 1').get();
  const total = Array.from({ length: u.level - 1 }, (_, i) => S.xpForLevel(i + 1)).reduce((a, b) => a + b, 0) + u.xp;
  assert.ok(total >= 1200, `got ${total}`);
  assert.equal(u.season_xp, season0, 'season untouched');
  g = createGame(db, { now: () => clock.t, notify: () => {} });
  const u2 = db.prepare('SELECT level, xp FROM users WHERE id = 1').get();
  assert.deepEqual([u2.level, u2.xp], [u.level, u.xp], 'runs once');
});
