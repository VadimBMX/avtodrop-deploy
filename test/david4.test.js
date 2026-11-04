// David 04.11 (co-owner): four changes after the Season 2 launch.
//  1. The garage cash: 4 h, with VIP 8 h (S.GARAGE_CAP, the businesses' rule) — no paid cap upgrades; what was paid for
//     them in Season 2 comes back once (src/game.js refundCapLevels, meta 'cap_refund_1', money source 'cap-refund').
//  2. (test/ideas.test.js) the «Що додати в гру?» window is gone.
//  3. Plates won at a finished «Аукціон номера» survive the wipe (src/season2.js KEPT_PLATES); on a database the wipe
//     already took them from, restoreAuctionPlates gives them back once (meta 's1_auction_plates_restore').
//  4. «Битва амбасадорів» counts a friend who reached CONTEST.minLevel in Season 1 (s1_archive.level) or now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { PLATE_RESTORE } from '../src/season2.js';
import { dealerPriceOf } from '../src/plate-auction.js';
import * as S from '../public/shared.js';
import { BIZ } from '../public/business.js';

const H = 3600e3, DAY = 86400e3;
const S1_T = Date.parse('2026-10-28T10:00:00Z');
const S2_T = Date.parse('2026-11-03T10:00:00Z');
const get = (db, sql, ...a) => db.prepare(sql).get(...a);
const all = (db, sql, ...a) => db.prepare(sql).all(...a);
const run = (db, sql, ...a) => db.prepare(sql).run(...a);
const boot = (db, clock) => {
  const sent = [];
  const g = createGame(db, { now: () => clock.t, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [1000] });
  g.flushStartupNotes((uid, text) => sent.push([uid, text]));
  return { g, sent };
};
const ownerReset = (g) => g.adminCall('key', 'season2/reset', { confirm: true, phrase: S.S2_RESET.phrase });

// ---------- 1. the garage cash ----------
test('garage cash: 4 h, with VIP 8 h — the businesses\' rule; the comeback gift never makes it longer than VIP', () => {
  assert.deepEqual(S.GARAGE_CAP, { hours: 4, vipHours: 8 });
  assert.equal(S.GARAGE_CAP.hours, BIZ.capHours);
  assert.equal(S.GARAGE_CAP.vipHours, BIZ.vipCapHours);
  assert.equal(S.GARAGE_CAP.hours + S.VIP.extraHours, S.GARAGE_CAP.vipHours);
  assert.equal(S.GARAGE_CAP.hours + S.COMEBACK.capHours, S.GARAGE_CAP.vipHours, 'the comeback cash is the VIP cash, for a day');
  assert.equal(S.CAP_LEVELS, undefined);
  assert.equal(S.nextCapOffer, undefined);
  const clock = { t: S2_T };
  const db = openDb(':memory:');
  const { g } = boot(db, clock);
  g.ensureUser({ id: 1, first_name: 'A' });
  g.api['case/open'](1, { caseId: 'starter' });
  assert.equal(g.api['upgrade-cap'], undefined, 'no paid upgrade any more');
  // an old cap_level left in the row changes nothing
  run(db, 'UPDATE users SET cap_level = 3 WHERE id = 1');
  assert.equal(g.api.me(1).income.capH, 4);
  assert.equal('capLevel' in g.api.me(1), false);
  run(db, 'UPDATE users SET vip_until = ? WHERE id = 1', clock.t + DAY);
  assert.equal(g.api.me(1).income.capH, 8);
  // VIP + the comeback gift: still 8
  run(db, 'UPDATE users SET comeback_cap_until = ?, income_at = ? WHERE id = 1', clock.t + DAY, clock.t);
  assert.equal(g.api.me(1).income.capH, 8);
  run(db, 'UPDATE users SET vip_until = 0 WHERE id = 1');
  assert.equal(g.api.me(1).income.capH, 8, 'comeback alone: the VIP hours for a day');
  clock.t += 2 * DAY;
  g.api.collect(1, {});
  assert.equal(g.api.me(1).income.capH, 4, 'after the gift: back to 4');
  // the income really stops at the cap
  clock.t += 10 * H;
  const m = g.api.me(1);
  assert.ok(Math.abs(m.income.pending - Math.floor(m.income.rate * 4)) <= 1);
});

test('garage cash: texts say «4 год, з VIP — 8 год» — garage, VIP, «Що нового», intro, the first steps; no upgrade UI', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /Каса вміщує \$\{G\.hours\} год, з VIP — \$\{G\.vipHours\} год/);
  assert.match(app, /Каса гаража — \$\{S\.GARAGE_CAP\.vipHours\} год замість \$\{S\.GARAGE_CAP\.hours\}/);
  assert.doesNotMatch(app, /upgradeCap|upgrade-cap|nextCapOffer|CAP_LEVELS|capLevel/);
  for (const f of ['prestige-ui.js', 'prestige.js', 'admin.js']) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8'), /upgrade-cap|nextCapOffer|CAP_LEVELS|prCap/, f);
  }
  const rule = '4 год, з VIP — 8 год';
  assert.ok(S.WHATS_NEW.slides.find((s) => s.title === 'Бізнеси').text.includes(rule));
  assert.ok(S.INTRO_STORY.slides[2].text.includes(rule));
  assert.ok(S.INTRO_REEL.scenes.find((s) => s.key === 'garage').text.includes(rule));
  assert.ok(S.GUIDE_STEPS.find((s) => s.key === 'collect').text.includes(rule));
});

// A database where the wipe ran, and players bought cap levels in Season 2 (before this release).
function wipedWithCaps() {
  const clock = { t: S2_T };
  const db = openDb(':memory:');
  const { g } = boot(db, clock);
  for (const id of [1, 2, 3, 4]) g.ensureUser({ id, first_name: 'U' + id });
  run(db, "INSERT INTO meta (key, value) VALUES ('season_reset_s2', ?)", String(S2_T - H));
  run(db, "DELETE FROM meta WHERE key = 'cap_refund_1'");
  run(db, 'UPDATE users SET cap_level = 1 WHERE id = 1');
  run(db, 'UPDATE users SET cap_level = 3 WHERE id = 2');
  run(db, 'UPDATE users SET cap_level = 2, banned = 1 WHERE id = 3');
  return { db, clock };
}
const bal = (db, uid) => get(db, 'SELECT balance FROM users WHERE id = ?', uid).balance;

test('cap refund: what each player paid comes back once — addMoney, money source, event, gift, bot message, flag', () => {
  const { db, clock } = wipedWithCaps();
  const before = [1, 2, 3, 4].map((id) => bal(db, id));
  const { sent } = boot(db, clock);
  const paid = { 1: 400000, 2: 400000 + 4000000 + 40000000, 3: 400000 + 4000000, 4: 0 };
  [1, 2, 3, 4].forEach((id, i) => assert.equal(bal(db, id), before[i] + paid[id], `player ${id}`));
  assert.deepEqual(all(db, 'SELECT cap_level FROM users WHERE id IN (1, 2, 3, 4) ORDER BY id').map((r) => r.cap_level), [0, 0, 0, 0]);
  const src = get(db, "SELECT SUM(created) n FROM money_src WHERE src = 'cap-refund'").n;
  assert.equal(src, paid[1] + paid[2] + paid[3], 'the money is created under its own source');
  const gifts = all(db, "SELECT user_id, data, note FROM gifts WHERE kind = 'money' ORDER BY user_id");
  assert.deepEqual(gifts.map((x) => [x.user_id, JSON.parse(x.data).amount]), [[1, paid[1]], [2, paid[2]], [3, paid[3]]]);
  assert.match(gifts[1].note, /Каса гаража тепер без покращень: 4 год, з VIP — 8 год\. Повертаємо 44 400 000 ₴/);
  assert.ok(get(db, "SELECT 1 FROM events WHERE user_id = 1 AND text LIKE '💰 Каса гаража тепер без покращень%'"));
  assert.deepEqual(sent.map(([u]) => u), [1, 2, 3]);
  assert.ok(Number(get(db, "SELECT value FROM meta WHERE key = 'cap_refund_1'").value) > 0);
  assert.equal(all(db, "SELECT * FROM admin_log WHERE action = 'cap-refund'").length, 3);
  // a restart pays nothing; even a lost flag finds every cap_level at 0
  boot(db, clock);
  run(db, "DELETE FROM meta WHERE key = 'cap_refund_1'");
  boot(db, clock);
  assert.equal(bal(db, 2), before[1] + paid[2]);
  assert.equal(all(db, "SELECT * FROM gifts WHERE kind = 'money'").length, 3);
});

test('cap refund: before the wipe it does nothing and sets no flag (the wipe zeroes Season 1 levels itself)', () => {
  const clock = { t: S1_T };
  const db = openDb(':memory:');
  const { g } = boot(db, clock);
  g.ensureUser({ id: 1, first_name: 'A' });
  run(db, 'UPDATE users SET cap_level = 2 WHERE id = 1');
  const b = bal(db, 1);
  boot(db, clock);
  assert.equal(bal(db, 1), b);
  assert.equal(get(db, "SELECT value FROM meta WHERE key = 'cap_refund_1'"), undefined);
  // the wipe: cap_level 0, then a restart refunds nothing and sets the flag
  const { g: g2 } = boot(db, clock);
  clock.t = S2_T;
  ownerReset(g2);
  assert.equal(get(db, 'SELECT cap_level FROM users WHERE id = 1').cap_level, 0);
  const after = bal(db, 1);
  boot(db, clock);
  assert.equal(bal(db, 1), after);
  assert.ok(get(db, "SELECT value FROM meta WHERE key = 'cap_refund_1'"));
});

// ---------- 3. the auction plates ----------
// Season 1: player 2 wins «AA 7777 AA» at the auction and puts it on his car; player 3 wins «BB 8888 BB» and sells it
// to player 4 on the market (simulated: the owner changes); player 5 has an ordinary plate. An auction without bids too.
function s1WithAuctions() {
  const clock = { t: S1_T };
  const db = openDb(':memory:');
  const { g } = boot(db, clock);
  for (const id of [2, 3, 4, 5]) {
    g.ensureUser({ id, first_name: 'U' + id });
    run(db, 'UPDATE users SET level = 10, level_seen = 10, balance = 50e6 WHERE id = ?', id);
  }
  const owner = (name, body) => g.adminCall('key', name, { confirm: true, ...body });
  const win = (text, uid) => {
    const { id } = owner('plate-auction/create', { text, startPrice: dealerPriceOf('S'), step: 10000, hours: 1 }).auction;
    g.api['plateAuction/bid'](uid, { id, amount: dealerPriceOf('S') });
    return id;
  };
  win('AA 7777 AA', 2);
  win('BB 8888 BB', 3);
  owner('plate-auction/create', { text: 'OO 0001 OO', startPrice: dealerPriceOf('S'), step: 10000, hours: 1 }); // nobody bids
  clock.t += H + 1;
  g.settleAuctions();
  g.api['case/open'](2, { caseId: 'starter' });
  const car = get(db, 'SELECT id FROM cars WHERE owner_id = 2').id;
  const pid = get(db, "SELECT id FROM plates WHERE text = 'AA 7777 AA'").id;
  g.api['plate/attach'](2, { plateId: pid, carId: car });
  run(db, "UPDATE plates SET owner_id = 4 WHERE text = 'BB 8888 BB'");
  run(db, "INSERT INTO plates (owner_id, text, cls, value, created_at) VALUES (5, 'KA 1234 KA', 'C', 500, ?)", clock.t);
  return { db, clock, g };
}
const plates = (db) => all(db, 'SELECT owner_id, text, car_id FROM plates ORDER BY text').map((p) => [p.owner_id, p.text, p.car_id]);

test('auction plates: kept through the wipe with their owner, off the car, in the garage value; the rest goes', () => {
  const { db, clock, g } = s1WithAuctions();
  const ids = Object.fromEntries(all(db, 'SELECT id, text FROM plates').map((p) => [p.text, p.id]));
  clock.t = S2_T;
  ownerReset(g);
  assert.deepEqual(plates(db), [[2, 'AA 7777 AA', null], [4, 'BB 8888 BB', null]]);
  assert.equal(get(db, "SELECT id FROM plates WHERE text = 'AA 7777 AA'").id, ids['AA 7777 AA'], 'the same row id (plate_auctions.plate_id)');
  assert.equal(get(db, 'SELECT COUNT(*) n FROM cars').n, 0);
  const v = get(db, "SELECT value FROM plates WHERE text = 'AA 7777 AA'").value;
  const u2 = get(db, 'SELECT total_value, week_start_value FROM users WHERE id = 2');
  assert.deepEqual([u2.total_value, u2.week_start_value], [v, v]);
  assert.equal(get(db, 'SELECT total_value FROM users WHERE id = 5').total_value, 0);
  assert.ok(g.api.me(2).plates.some((p) => p.text === 'AA 7777 AA' && !p.carId));
  // the wipe set the restore flag: nothing is recreated, no gift, now or after a restart
  assert.ok(get(db, 'SELECT value FROM meta WHERE key = ?', PLATE_RESTORE));
  const { sent } = boot(db, clock);
  assert.deepEqual(plates(db), [[2, 'AA 7777 AA', null], [4, 'BB 8888 BB', null]]);
  assert.equal(sent.length, 0);
});

test('auction plates: a database the old wipe already emptied gets them back once for the winners — never twice', () => {
  const { db, clock, g } = s1WithAuctions();
  clock.t = S2_T;
  ownerReset(g);
  // what the old wipe left: no plates at all, and no restore flag
  run(db, 'DELETE FROM plates');
  run(db, 'UPDATE users SET total_value = 0');
  run(db, 'DELETE FROM meta WHERE key = ?', PLATE_RESTORE);
  // a Season 2 auction (after the wipe) whose plate was sold since: not Season 1, never recreated
  run(db, `INSERT INTO plate_auctions (text, cls, start_price, step, ends_at, created_by, created_at, status, top_bid, top_bidder, settled_at, plate_id, value)
    VALUES ('CC 5555 CC', 'S', 1, 1, ?, 'key', ?, 'done', 1, 5, ?, 999, 1)`, S2_T + H, S2_T, S2_T + H);
  clock.t = S2_T + 2 * H;
  const { sent } = boot(db, clock);
  // the winner gets it, even though BB was with player 4 before the wipe (the only evidence is the auction)
  assert.deepEqual(plates(db), [[2, 'AA 7777 AA', null], [3, 'BB 8888 BB', null]]);
  const p = get(db, "SELECT id, value FROM plates WHERE text = 'AA 7777 AA'");
  assert.equal(get(db, "SELECT plate_id FROM plate_auctions WHERE text = 'AA 7777 AA'").plate_id, p.id);
  assert.equal(get(db, 'SELECT total_value FROM users WHERE id = 2').total_value, p.value);
  const gift = get(db, "SELECT data, note FROM gifts WHERE user_id = 2 AND kind = 'plate' ORDER BY id DESC");
  assert.equal(JSON.parse(gift.data).text, 'AA 7777 AA');
  assert.match(gift.note, /^Твій номер з аукціону AA 7777 AA лишився з тобою/);
  assert.ok(get(db, "SELECT 1 FROM events WHERE user_id = 3 AND text LIKE '%Твій номер з аукціону BB 8888 BB лишився з тобою%'"));
  assert.deepEqual(sent.map(([u]) => u).sort(), [2, 3]);
  // once: a restart, a lost flag, or a sold plate never brings a second copy
  boot(db, clock);
  run(db, 'DELETE FROM meta WHERE key = ?', PLATE_RESTORE);
  boot(db, clock);
  assert.equal(all(db, "SELECT * FROM plates WHERE text = 'AA 7777 AA'").length, 1);
  g.api['plate/sell'](3, { plateId: get(db, "SELECT id FROM plates WHERE text = 'BB 8888 BB'").id });
  boot(db, clock);
  assert.deepEqual(plates(db), [[2, 'AA 7777 AA', null]]);
  assert.equal(all(db, "SELECT * FROM gifts WHERE kind = 'plate' AND note LIKE 'Твій номер з аукціону%'").length, 2);
});

// ---------- 4. «Битва амбасадорів» through the wipe ----------
test('contest: a friend who reached the level in Season 1 still counts after the wipe; the contest itself survives it', () => {
  const clock = { t: S1_T };
  const db = openDb(':memory:');
  const { g } = boot(db, clock);
  g.ensureUser({ id: 10, first_name: 'Inviter' });
  g.adminCall('key', 'contest/start', { days: 14, confirm: true });
  clock.t += H;
  for (const [id, l] of [[101, 3], [102, 5], [103, 1], [104, 2]]) {
    g.ensureUser({ id, first_name: 'F' + id }, 'ref_10');
    run(db, 'UPDATE users SET level = ? WHERE id = ?', l, id);
  }
  assert.equal(g.api.contest(10).contest.me.counted, 2);
  const cfg = get(db, "SELECT value FROM meta WHERE key = 'contest'").value;
  clock.t = S2_T;
  ownerReset(g);
  assert.equal(get(db, "SELECT value FROM meta WHERE key = 'contest'").value, cfg, 'the contest config is not wiped');
  assert.equal(get(db, 'SELECT level FROM s1_archive WHERE user_id = 102').level, 5);
  assert.deepEqual(all(db, 'SELECT level FROM users WHERE id IN (101, 102, 103, 104)').map((r) => r.level), [1, 1, 1, 1]);
  let s = g.api.contest(10).contest;
  assert.ok(s.on);
  assert.equal(s.me.counted, 2, '101 and 102 reached level 3 in Season 1');
  assert.equal(s.me.invited, 4);
  // now: 104 reaches level 3 in Season 2 — counts too; 103 at level 2 — not yet
  run(db, 'UPDATE users SET level = 3 WHERE id = 104');
  run(db, 'UPDATE users SET level = 2 WHERE id = 103');
  s = g.api.contest(10).contest;
  assert.equal(s.me.counted, 3);
  const a = g.adminCall('key', 'contest', {});
  const f102 = a.rows[0].friends.find((f) => f.id === 102);
  assert.deepEqual([f102.level, f102.s1Level, f102.counted], [1, 5, true]);
  // banned stays out, whatever the Season 1 level
  run(db, 'UPDATE users SET banned = 1 WHERE id = 102');
  assert.equal(g.api.contest(10).contest.me.counted, 2);
});
