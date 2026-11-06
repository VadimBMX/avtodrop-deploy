// Daily level cap (S.LEVEL_CAP, David 04.11): level ≤ perDay × (Kyiv day since the anchor), XP banked over the cap and
// released the next day with every reward once; the anchor moves with an admin reset and the Season 2 wipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const H = 3600e3, D = 24 * H;
// 10:00 Kyiv (UTC+2 in November) on a Monday.
const T0 = Date.parse('2026-11-09T08:00:00Z');
const xpTo = (lvl) => Array.from({ length: lvl - 1 }, (_, i) => S.xpForLevel(i + 1)).reduce((a, b) => a + b, 0);
function setup(t = T0) {
  const clock = { t };
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => clock.t, notify: () => {}, allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'A' });
  const row = () => db.prepare('SELECT level, xp, balance, slots FROM users WHERE id = 1').get();
  // XP handed straight to the row: /me (levelUp) turns it into levels like any xp() grant would.
  const giveXp = (n) => db.prepare('UPDATE users SET xp = xp + ? WHERE id = 1').run(n);
  return { clock, db, g, row, giveXp };
}

test('level cap: the numbers live in ECON and the day counts from the anchor (day 1 → 3, day 2 → 6)', () => {
  assert.equal(S.LEVEL_CAP.perDay, 3);
  assert.equal(S.levelCapOf(T0, T0), 3);
  assert.equal(S.levelCapOf(T0, T0 + 13 * H), 3, '23:59 Kyiv of the same day');
  assert.equal(S.levelCapOf(T0, T0 + 14 * H), 6, '00:00 Kyiv next day');
  assert.equal(S.levelCapOf(T0, T0 + 3 * D), 12);
  assert.equal(S.levelCapDayFor(7), 3);
  assert.equal(S.levelCapWhen({ max: 3, day: 1 }, 5), 'завтра');
  assert.equal(S.levelCapWhen({ max: 3, day: 1 }, 10), 'через 3 дн.');
  assert.equal(S.levelCapWhen({ max: 3, day: 1 }, 3), '');
});

test('level cap: day 1 stops at 3 with real xp (cases), the rest is banked, /me says so', () => {
  const { clock, g, db, row, giveXp } = setup();
  db.prepare('UPDATE users SET balance = 1e12, slots = 1000 WHERE id = 1').run();
  giveXp(300); // a few races (since 06.11 a new car gives 8 xp, so cases alone stop just short of level 4's xp)
  for (let i = 0; i < 30; i++) g.api['case/open'](1, { caseId: 'elite', count: 6 }); // up to the case cap (newCar xp is 8 since 06.11)
  const r = row();
  assert.equal(r.level, 3);
  assert.ok(r.xp >= S.CASE_XP_CAP - xpTo(3), 'xp over the cap is kept (case xp + new cars)');
  assert.ok(r.xp >= S.xpForLevel(3), 'more than level 3 needs: ' + r.xp + ' / ' + S.xpForLevel(3));
  const me = g.api.me(1);
  assert.deepEqual({ ...me.levelCap, date: undefined }, { max: 3, next: 6, day: 1, date: undefined, capped: true, over: r.xp - S.xpForLevel(3) });
  clock.t += 13 * H; // 23:00 Kyiv: still day 1
  assert.equal(g.api.me(1).level, 3);
});

test('level cap: day 2 releases the banked xp up to 6 at once, every reward paid once, then the next cap', () => {
  const { clock, g, row, giveXp } = setup();
  giveXp(xpTo(8) + 50); // enough for level 8
  assert.equal(g.api.me(1).level, 3);
  const b3 = row().balance;
  clock.t += D; // day 2
  const me = g.api.me(1);
  assert.equal(me.level, 6);
  assert.equal(me.levelSeen, 1, 'the window shows every level since the last one seen');
  const paid = [4, 5, 6].reduce((s, l) => s + S.levelReward(l).money, 0);
  assert.equal(row().balance - b3, paid);
  assert.deepEqual(S.levelRewardsBetween(3, 6), { money: paid, slots: 0, cases: { city: 1 } });
  assert.equal(row().xp, xpTo(8) + 50 - xpTo(6));
  // /me again (and again) pays nothing more
  g.api.me(1);
  g.api.me(1);
  assert.equal(row().balance - b3, paid);
  assert.equal(row().level, 6);
  clock.t += D; // day 3: up to 9, but the xp is for 8
  assert.equal(g.api.me(1).level, 8);
  assert.equal(g.api.me(1).levelCap.capped, false);
  assert.equal(row().xp, 50);
});

test('level cap: an admin reset re-anchors at day 1', () => {
  const { clock, g, giveXp } = setup();
  clock.t += 5 * D;
  giveXp(xpTo(10));
  assert.equal(g.api.me(1).level, 10);
  g.admin.reset('key', { id: 1 });
  giveXp(xpTo(6));
  const me = g.api.me(1);
  assert.equal(me.level, 3);
  assert.equal(me.levelCap.day, 1);
  clock.t += D;
  assert.equal(g.api.me(1).level, 6);
});

test('level cap: a veteran (signed up long before) is capped from the Season 2 wipe on', () => {
  const { clock, g, db, giveXp } = setup(T0 - 30 * D);
  clock.t += 10 * D;
  giveXp(xpTo(4));
  assert.equal(g.api.me(1).level, 4, 'no wipe yet: signed up a month ago, no cap in the way');
  clock.t = T0;
  db.prepare("INSERT INTO meta (key, value) VALUES ('season_reset_s2', ?)").run(String(T0 - H));
  db.prepare('UPDATE users SET level = 1, level_seen = 1, xp = 0 WHERE id = 1').run(); // what the wipe does to the row
  giveXp(xpTo(7));
  assert.equal(g.api.me(1).level, 3);
  clock.t += D;
  assert.equal(g.api.me(1).level, 6);
});

test('level cap: perDay 0 switches it off', () => {
  const was = S.LEVEL_CAP.perDay;
  try {
    S.LEVEL_CAP.perDay = 0;
    assert.equal(S.levelCapOf(T0, T0), Infinity);
    const { g, giveXp } = setup();
    giveXp(xpTo(9));
    const me = g.api.me(1);
    assert.equal(me.level, 9);
    assert.equal(me.levelCap, null);
  } finally {
    S.LEVEL_CAP.perDay = was;
  }
});

test('level cap: a referred friend pays the referrer once even when level 3+ arrives in one jump', () => {
  const { clock, g, db } = setup();
  g.ensureUser({ id: 2, first_name: 'B' });
  clock.t += D; // day 2: 1 → 5 in one go
  db.prepare('UPDATE users SET referrer_id = 1 WHERE id = 2').run();
  const bal1 = () => db.prepare('SELECT balance FROM users WHERE id = 1').get().balance;
  const before = bal1();
  db.prepare('UPDATE users SET xp = ? WHERE id = 2').run(xpTo(5) + 10);
  assert.equal(g.api.me(2).level, 5);
  assert.equal(bal1() - before, S.REF_REWARD);
});
