// Owner 03.11: the Season 1 prize stars (top-10, S.SEASON_PRIZES) were archived by the Season 2 wipe
// (s1_archive.prize_stars) and then zeroed — lost. src/season2.js restorePrizeStars gives them back once as star credit
// (creditAdd → star_credit_log 's1-prize'), with an event, a gift window and a bot message after start; meta
// 's1_prize_restore_done' keeps it from ever running twice, and before the wipe it does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { PRIZE_RESTORE } from '../src/season2.js';
import * as S from '../public/shared.js';

const S1_T = Date.parse('2026-10-28T10:00:00Z'); // Season 1
const S2_T = Date.parse('2026-11-03T10:00:00Z'); // Season 2, after the wipe
const FLAG = 's1_prize_restore_done';

function boot(db, t) {
  const sent = [];
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [1000] });
  g.flushStartupNotes((uid, text) => sent.push([uid, text]));
  return { g, sent };
}
const get = (db, sql, ...a) => db.prepare(sql).get(...a);
const all = (db, sql, ...a) => db.prepare(sql).all(...a);
const credit = (db, uid) => get(db, 'SELECT star_credit FROM users WHERE id = ?', uid).star_credit;
const prizeLog = (db) => all(db, "SELECT user_id, delta FROM star_credit_log WHERE what = 's1-prize' ORDER BY user_id").map((r) => [r.user_id, r.delta]);
const giftsOf = (db) => all(db, "SELECT user_id, data, note FROM gifts WHERE kind = 'stars' ORDER BY user_id").map((r) => ({ uid: r.user_id, ...JSON.parse(r.data), note: r.note }));

// A database the way production has it: the wipe ran (marker meta, s1_archive filled, stars zeroed, the compensation
// credit given) on code without the restore.
function wipedBefore() {
  const db = openDb(':memory:');
  const { g } = boot(db, S2_T);
  for (const id of [1, 2, 3, 4, 5, 6]) g.ensureUser({ id, first_name: 'U' + id });
  // prize_stars by player: 1 — 500 (1st), 2 — 250 (2nd), 3 — 50 (4th), 4 — none, 5 — 120 left from the prizes (spent some),
  // 6 — 50, but the account is banned now; 77 — archived but gone from users.
  const arch = [[1, 500, 1, 300], [2, 250, 2, 0], [3, 50, 4, 0], [4, 0, 40, 75], [5, 120, 7, 0], [6, 50, 9, 0], [77, 250, 3, 0]];
  const ins = db.prepare(`INSERT INTO s1_archive (user_id, level, xp, season_xp, season_place, garage_value, balance, cars, stars_spent, friends_l3,
    prize_stars, credit, created_at) VALUES (?, 10, 0, 1000, ?, 0, 0, 0, ?, 0, ?, ?, ?)`);
  for (const [uid, stars, place, comp] of arch) ins.run(uid, place, comp, stars, comp, S2_T - 3600e3);
  // the compensation credit already given (bought Stars back)
  db.prepare('UPDATE users SET star_credit = 300, stars = 0 WHERE id = 1').run();
  db.prepare("INSERT INTO star_credit_log (user_id, delta, what, balance, at) VALUES (1, 300, 's1-comp', 300, ?)").run(S2_T - 3600e3);
  db.prepare('UPDATE users SET banned = 1 WHERE id = 6').run();
  db.prepare("INSERT INTO meta (key, value) VALUES ('season_reset_s2', ?)").run(String(S2_T - 3600e3));
  db.prepare('DELETE FROM meta WHERE key = ?').run(FLAG); // the first boot above saw no wipe: no flag (asserted below)
  return db;
}

test('S1 prize stars: granted once at start — credit, log, event, gift, bot message, flag', () => {
  assert.equal(PRIZE_RESTORE, FLAG);
  const db = wipedBefore();
  const { sent } = boot(db, S2_T);
  // the credit: added to what was there, through the credit log
  assert.equal(credit(db, 1), 300 + 500);
  assert.equal(credit(db, 2), 250);
  assert.equal(credit(db, 3), 50);
  assert.equal(credit(db, 4), 0, 'no prize stars, nothing');
  assert.equal(credit(db, 5), 120);
  assert.equal(credit(db, 6), 50, 'banned now: the credit waits like the rest of his compensation');
  assert.deepEqual(prizeLog(db), [[1, 500], [2, 250], [3, 50], [5, 120], [6, 50]]);
  assert.equal(get(db, "SELECT balance FROM star_credit_log WHERE user_id = 1 AND what = 's1-prize'").balance, 800);
  // never the hryvnia balance or the Stars on the account
  assert.equal(get(db, 'SELECT stars FROM users WHERE id = 1').stars, 0);
  // in the game: a gift window and an event; after start: the bot message
  const gifts = giftsOf(db);
  assert.deepEqual(gifts.map((x) => [x.uid, x.stars, x.place, x.season]), [[1, 500, 1, 1], [2, 250, 2, 1], [3, 50, 4, 1], [5, 120, 7, 1], [6, 50, 9, 1]]);
  assert.match(gifts[0].note, /^Повернули ⭐ 500 — приз за місце в Сезоні 1\./);
  assert.equal(gifts[0].credit, 800);
  assert.ok(get(db, "SELECT 1 FROM events WHERE user_id = 2 AND text LIKE '%Повернули ⭐ 250 — приз за місце в Сезоні 1%'"));
  assert.deepEqual(sent.map(([uid]) => uid), [1, 2, 3, 5, 6]);
  // the flag and the admin log
  assert.ok(Number(get(db, 'SELECT value FROM meta WHERE key = ?', FLAG).value) > 0);
  const log = get(db, "SELECT admin, details FROM admin_log WHERE action = 's1-prize-restore'");
  assert.equal(log.admin, 'system');
  assert.deepEqual(JSON.parse(log.details), { users: 5, stars: 970 });
});

test('S1 prize stars: idempotent — a restart, or even a lost flag, never pays twice', () => {
  const db = wipedBefore();
  boot(db, S2_T);
  const snap = () => ({ c: [1, 2, 3, 5, 6].map((id) => credit(db, id)), log: prizeLog(db).length, gifts: giftsOf(db).length, ev: get(db, "SELECT COUNT(*) n FROM events WHERE text LIKE '%Повернули ⭐%'").n });
  const once = snap();
  const again = boot(db, S2_T + 60e3);
  assert.deepEqual(snap(), once, 'second start: nothing');
  assert.equal(again.sent.length, 0);
  db.prepare('DELETE FROM meta WHERE key = ?').run(FLAG);
  boot(db, S2_T + 120e3);
  assert.deepEqual(snap(), once, 'flag lost: the per-player log row still guards');
  assert.ok(get(db, 'SELECT 1 FROM meta WHERE key = ?', FLAG));
  // spending the credit afterwards doesn't bring it back either
  db.prepare('UPDATE users SET star_credit = 0 WHERE id = 2').run();
  boot(db, S2_T + 180e3);
  assert.equal(credit(db, 2), 0);
});

test('S1 prize stars: no wipe yet → no-op, no flag; the wipe itself then returns them, once', () => {
  const db = openDb(':memory:');
  let t = S1_T;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [1000] });
  const ids = Array.from({ length: 12 }, (_, i) => i + 1);
  for (const id of ids) g.ensureUser({ id, first_name: 'U' + id });
  // the Season 1 board: 1 leads … 12 last; 3 also has 40 stars left from the shop
  for (const id of ids) db.prepare('UPDATE users SET season_id = 1, season_xp = ? WHERE id = ?').run(10000 - id * 100, id);
  db.prepare('UPDATE users SET stars = 40 WHERE id = 3').run();
  // a restart before the wipe: nothing at all
  createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [1000] });
  assert.equal(get(db, 'SELECT value FROM meta WHERE key = ?', FLAG), undefined);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM star_credit_log').n, 0);
  assert.equal(get(db, "SELECT COUNT(*) n FROM gifts WHERE kind = 'stars'").n, 0);
  // the wipe (Season 2): settles Season 1 (prizes to the top 10), archives, zeroes — and gives the prizes back as credit
  t = S2_T;
  g.adminCall('key', 'season2/reset', { confirm: true, phrase: S.S2_RESET.phrase });
  assert.equal(get(db, 'SELECT COALESCE(SUM(stars), 0) n FROM users').n, 0, 'stars on the account are zeroed by the wipe');
  for (const id of ids) {
    const want = (S.SEASON_PRIZES[id - 1] || 0) + (id === 3 ? 40 : 0);
    assert.equal(get(db, 'SELECT prize_stars FROM s1_archive WHERE user_id = ?', id).prize_stars, want, `archive ${id}`);
    assert.equal(credit(db, id), want, `credit of place ${id}`);
  }
  assert.deepEqual(prizeLog(db).map(([, d]) => d), [500, 250, 290, 50, 50, 50, 50, 50, 50, 50]);
  assert.ok(get(db, 'SELECT 1 FROM meta WHERE key = ?', FLAG));
  // and the next start leaves it alone
  const total = get(db, 'SELECT SUM(star_credit) n FROM users').n;
  boot(db, S2_T + 60e3);
  assert.equal(get(db, 'SELECT SUM(star_credit) n FROM users').n, total);
  assert.equal(prizeLog(db).length, 10);
});
