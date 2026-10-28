// «Битва амбасадорів» (src/contest.js): only friends who signed up by the link during the contest and reached
// CONTEST.minLevel count; banned / hidden players are out; admins start and stop it; the owner needs no reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

test('contest: counts friends who joined during it and reached the level, ranks inviters, start/stop', () => {
  const clock = { t: Date.parse('2026-10-29T10:00:00Z') };
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => clock.t, admins: [1], notify: () => {}, allUnlocked: true });
  for (const id of [1, 10, 20]) g.ensureUser({ id, first_name: 'U' + id });
  const lvl = (id, l) => db.prepare('UPDATE users SET level = ? WHERE id = ?').run(l, id);
  // Before the contest: a friend of 10 — never counts.
  g.ensureUser({ id: 100, first_name: 'old' }, 'ref_10');
  lvl(100, 5);
  assert.equal(g.api.contest(10).contest, null);
  assert.equal(g.api.me(10).contest, null);
  assert.throws(() => g.adminCall('tg:1', 'contest/stop', { confirm: true }), /не йде/);
  clock.t += 60e3;
  g.adminCall('tg:1', 'contest/start', { days: 14, confirm: true }); // the owner: no reason needed
  assert.ok(g.api.me(10).contest.on);
  clock.t += 3600e3;
  for (const [id, ref, l] of [[101, 10, 3], [102, 10, 4], [103, 10, 1], [201, 20, 3]]) {
    g.ensureUser({ id, first_name: 'F' + id }, `ref_${ref}`);
    lvl(id, l);
  }
  let s = g.api.contest(10).contest;
  assert.equal(s.me.counted, 2, 'only friends of the contest at level 3+');
  assert.equal(s.me.invited, 3);
  assert.equal(s.me.place, 1);
  assert.deepEqual(s.me.prize, { stars: S.CONTEST.prizes[0] });
  assert.deepEqual(s.top.map((x) => x.counted), [2, 1]);
  assert.equal(g.api.contest(20).contest.me.place, 2);
  // A banned friend stops counting.
  db.prepare('UPDATE users SET banned = 1 WHERE id = 102').run();
  assert.equal(g.api.contest(10).contest.me.counted, 1);
  const a = g.adminCall('tg:1', 'contest', {});
  assert.equal(a.rows.length, 2);
  assert.ok(a.rows[0].friends.length >= 1);
  assert.throws(() => g.adminCall('tg:1', 'contest/start', { confirm: true }), /уже йде/);
  clock.t += 1000;
  g.adminCall('tg:1', 'contest/stop', { confirm: true });
  // After the end: a new friend no longer counts; the card stays for showAfterH.
  clock.t += 1000;
  g.ensureUser({ id: 202, first_name: 'late' }, 'ref_20');
  lvl(202, 9);
  assert.equal(g.api.contest(20).contest.me.counted, 1);
  assert.equal(g.api.me(20).contest.on, false);
  clock.t += S.CONTEST.showAfterH * 3600e3 + 1;
  assert.equal(g.api.me(20).contest, null);
});
