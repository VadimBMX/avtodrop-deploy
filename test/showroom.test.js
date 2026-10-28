// «Шоурум» (public/showroom.js, src/showroom.js): up to 3 own cars on show (garage or «Вітрина», they keep their status),
// likes — 1 per showroom per Kyiv day per viewer, 5 a day per viewer, from level 2, not for one's own; likes from accounts
// younger than 48 h or from the owner's referral chain show in ♥ but don't count for «Шоурум тижня»; the weekly top-3
// (≥ 3 counted likes) is paid once per week inside settleWeek: money, the badge, and the frame for the first place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as R from '../public/showroom.js';

const SR = R.SHOWROOM;
const H = 3600e3, D = 24 * H;
const CAR = S.ALL_MODELS.find((m) => m.cls === 'B' && !m.secret && !m.edition && !m.season && !S.isCollector(m.id));

function setup() {
  let t = Date.parse('2026-11-03T10:00:00Z'); // a Tuesday (Kyiv)
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [], notify: () => {} });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const mk = (id, { level = 3, cars = 2, ref = null } = {}) => {
    g.ensureUser({ id, first_name: 'U' + id }, ref ? `ref_${ref}` : undefined);
    db.prepare('UPDATE users SET level = ?, level_seen = ?, slots = 20 WHERE id = ?').run(level, level, id);
    return Array.from({ length: cars }, () => g.giveCar(id, CAR.id).id);
  };
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  // The weekly race pays too (garage growth): its growth is zeroed so the balances show the showroom prizes alone.
  const noRace = () => db.prepare('UPDATE users SET week_start_value = total_value + 1e12').run();
  return { db, g, call, mk, bal, noRace, add: (ms) => (t += ms), at: () => t };
}
// A showroom owner and `n` viewers whose accounts are old enough (created, then 3 days pass).
function crowd(T, n, { owner = 1, base = 100 } = {}) {
  const cars = T.mk(owner);
  for (let i = 0; i < n; i++) T.mk(base + i, { cars: 1 });
  T.add(3 * D);
  T.call(owner, 'showroom/set', { cars: [cars[0]] });
  return Array.from({ length: n }, (_, i) => base + i);
}

test('rules: likeCheck order, the daily limits and the alt-account rule', () => {
  const now = Date.parse('2026-11-05T10:00:00Z');
  const old = now - 5 * D;
  const owner = { id: 1, level: 5, created_at: old, referrer_id: null };
  const v = (o = {}) => ({ id: 2, level: 3, created_at: old, referrer_id: null, ...o });
  const chk = (viewer, o = {}) => R.likeCheck({ viewer, owner, cars: 2, likedToday: false, usedToday: 0, now, ...o });
  assert.match(chk(v({ id: 1 })).error, /Свій/);
  assert.match(chk(v({ level: 1 })).error, /2-го рівня/);
  assert.match(chk(v(), { cars: 0 }).error, /порожній/);
  assert.match(chk(v(), { likedToday: true }).error, /вже лайкнув/);
  assert.match(chk(v(), { usedToday: SR.perDay }).error, /5 лайків/);
  assert.deepEqual(chk(v()), { counted: true, why: '' });
  assert.deepEqual(chk(v({ created_at: now - 47 * H })), { counted: false, why: 'age' });
  assert.deepEqual(chk(v({ referrer_id: 1 })), { counted: false, why: 'ref' }); // the owner invited him
  assert.deepEqual(R.likeCheck({ viewer: v(), owner: { ...owner, referrer_id: 2 }, cars: 1, likedToday: false, usedToday: 0, now }), { counted: false, why: 'ref' }); // he invited the owner
  assert.deepEqual(R.likeCheck({ viewer: v({ referrer_id: 9 }), owner: { ...owner, referrer_id: 9 }, cars: 1, likedToday: false, usedToday: 0, now }), { counted: false, why: 'ref' }); // one inviter
  assert.equal(R.sameChain({ id: 2, referrer_id: 8 }, { id: 1, referrer_id: 9 }), false);
  // weekly places: ≥ minLikes, most first, a tie to the earlier last like
  const top = R.weeklyPlaces([{ id: 5, n: 2, last: 1 }, { id: 6, n: 4, last: 50 }, { id: 7, n: 4, last: 40 }, { id: 8, n: 3, last: 1 }, { id: 9, n: 9, last: 99 }]);
  assert.deepEqual(top.map((r) => [r.id, r.place, r.prize]), [[9, 1, SR.prizes[0]], [7, 2, SR.prizes[1]], [6, 3, SR.prizes[2]]]);
  assert.equal(R.showroomLink('bot', 'app', 7), 'https://t.me/bot/app?startapp=sr_7');
  assert.equal(R.showroomLink('bot', '', 7), 'https://t.me/bot?start=sr_7');
  assert.ok(SR.prizes[0] < S.WEEKLY_PRIZES[0], 'the prize stays modest (below the weekly race)');
});

test('set: up to 3 own cars at home; they keep their status; a car that leaves drops out', () => {
  const T = setup();
  const cars = T.mk(1, { cars: 5 });
  const other = T.mk(2, { cars: 1 });
  assert.throws(() => T.call(1, 'showroom/set', { cars: cars.slice(0, 4) }), /до 3 машин/);
  assert.throws(() => T.call(1, 'showroom/set', { cars: [other[0]] }), /не твоє/);
  T.call(1, 'showcase', { carId: cars[2], put: true }); // a «Вітрина» car may go on show too
  const r = T.call(1, 'showroom/set', { cars: [cars[2], cars[0], cars[0]] });
  assert.deepEqual(r.showroom.cars.map((c) => c.id), [cars[2], cars[0]], 'order kept, duplicates dropped');
  assert.equal(T.db.prepare('SELECT status FROM cars WHERE id = ?').get(cars[0]).status, 'garage', 'still in the garage — still earning');
  T.db.prepare("UPDATE cars SET status = 'market' WHERE id = ?").run(cars[0]);
  assert.deepEqual(T.call(1, 'showroom/get', { id: 1 }).cars.map((c) => c.id), [cars[2]], 'a listed car is hidden');
  assert.throws(() => T.call(1, 'showroom/set', { cars: [cars[0]] }), /на ринку/);
  T.call(1, 'sell', { carIds: [cars[2]] });
  assert.equal(T.call(1, 'showroom/get', { id: 1 }).cars.length, 0, 'a sold car is gone');
  // level 1: not yet
  T.mk(3, { level: 1, cars: 1 });
  assert.throws(() => T.call(3, 'showroom/set', { cars: [] }), /2-го рівня/);
});

test('likes: one per showroom per day, 5 a day in all, not one\'s own, from level 2; the day resets', () => {
  const T = setup();
  const owners = [1, 2, 3, 4, 5, 6];
  for (const id of owners) T.mk(id);
  T.mk(50, { cars: 1 });
  T.mk(51, { level: 1, cars: 1 });
  T.add(3 * D);
  for (const id of owners) T.call(id, 'showroom/set', { cars: [T.db.prepare('SELECT id FROM cars WHERE owner_id = ? LIMIT 1').get(id).id] });
  assert.throws(() => T.call(1, 'showroom/like', { id: 1 }), /Свій/);
  assert.throws(() => T.call(51, 'showroom/like', { id: 1 }), /2-го рівня/);
  const r = T.call(50, 'showroom/like', { id: 1 });
  assert.equal(r.likes, 1);
  assert.equal(r.week, 1);
  assert.equal(r.left, SR.perDay - 1);
  assert.equal(r.counted, true);
  assert.throws(() => T.call(50, 'showroom/like', { id: 1 }), /вже лайкнув/);
  for (const id of [2, 3, 4, 5]) T.call(50, 'showroom/like', { id });
  assert.throws(() => T.call(50, 'showroom/like', { id: 6 }), /5 лайків/);
  assert.equal(T.call(50, 'showroom/get', { id: 6 }).canLike, false);
  T.add(D); // a new Kyiv day
  assert.equal(T.call(50, 'showroom/like', { id: 1 }).likes, 2, 'the same showroom again the next day');
  T.call(50, 'showroom/like', { id: 6 });
  // an empty showroom can't be liked
  T.mk(7);
  assert.throws(() => T.call(50, 'showroom/like', { id: 7 }), /порожній/);
  // the owner hears about it in «Сповіщення» (in-app only)
  assert.ok(T.db.prepare("SELECT COUNT(*) n FROM events WHERE user_id = 1 AND text LIKE '%шоурум%'").get().n >= 2);
});

test('alt accounts: a fresh account or the referral chain shows in ♥ but not in the weekly top', () => {
  const T = setup();
  const cars = T.mk(1);
  T.mk(20, { cars: 1, ref: 1 }); // invited by the owner
  T.mk(21, { cars: 1 }); // an ordinary player
  T.add(3 * D);
  T.mk(22, { cars: 1 }); // created just now
  T.call(1, 'showroom/set', { cars: [cars[0]] });
  const a = T.call(20, 'showroom/like', { id: 1 });
  assert.equal(a.counted, false);
  assert.match(a.note, /ланцюжка запрошень/);
  const b = T.call(22, 'showroom/like', { id: 1 });
  assert.equal(b.counted, false);
  assert.match(b.note, /старших за 2 доби/);
  const c = T.call(21, 'showroom/like', { id: 1 });
  assert.equal(c.counted, true);
  assert.equal(c.likes, 3, 'all three show in ♥');
  assert.equal(c.week, 1, 'only one counts for the week');
  // a newcomer through a shared showroom link becomes the owner's referral (so his likes don't count either)
  T.g.ensureUser({ id: 23, first_name: 'N' }, 'sr_1');
  assert.equal(T.db.prepare('SELECT referrer_id FROM users WHERE id = 23').get().referrer_id, 1);
});

test('weekly: top-3 by counted likes paid once — money, badge, the frame for the first; ≥3 likes; banned skipped', () => {
  const T = setup();
  // owners 1 (5 likes), 2 (4), 3 (4, reached later), 4 (2 — under the minimum), 5 (6 likes but banned)
  for (const id of [1, 2, 3, 4, 5]) T.mk(id);
  const viewers = Array.from({ length: 8 }, (_, i) => 100 + i);
  for (const v of viewers) T.mk(v, { cars: 1 });
  T.add(D); // Wednesday
  T.add(2 * D); // Friday: viewers are 3 days old
  for (const id of [1, 2, 3, 4, 5]) T.call(id, 'showroom/set', { cars: [T.db.prepare('SELECT id FROM cars WHERE owner_id = ? LIMIT 1').get(id).id] });
  const likes = { 1: 5, 2: 4, 4: 2, 5: 6 };
  for (const [o, n] of Object.entries(likes)) for (let i = 0; i < n; i++) T.call(viewers[i], 'showroom/like', { id: Number(o) });
  T.add(H);
  for (let i = 4; i < 8; i++) T.call(viewers[i], 'showroom/like', { id: 3 }); // 4 likes, the last one later than owner 2's
  T.db.prepare('UPDATE users SET banned = 1 WHERE id = 5').run();
  const page = T.call(100, 'showroom', { tab: 'top' });
  assert.deepEqual(page.list.slice(0, 3).map((r) => r.id), [1, 2, 3]);
  T.noRace();
  const before = Object.fromEntries([1, 2, 3, 4].map((id) => [id, T.bal(id)]));
  T.add(3 * D); // next Monday (Kyiv): any call settles the week
  T.call(100, 'me');
  assert.equal(T.bal(1) - before[1], SR.prizes[0]);
  assert.equal(T.bal(2) - before[2], SR.prizes[1]);
  assert.equal(T.bal(3) - before[3], SR.prizes[2]);
  assert.equal(T.bal(4), before[4], 'under the minimum: no prize');
  const badge = (id) => T.db.prepare("SELECT title, place FROM badges WHERE user_id = ? AND key = 'showroom'").get(id);
  assert.deepEqual({ ...badge(1) }, { title: 'Шоурум тижня', place: 1 });
  assert.equal(badge(3).place, 3);
  assert.equal(badge(4), undefined);
  assert.ok(T.db.prepare('SELECT 1 FROM claims WHERE user_id = 1 AND key = ?').get(SR.frame), 'the first place gets the frame');
  assert.ok(!T.db.prepare('SELECT 1 FROM claims WHERE user_id = 2 AND key = ?').get(SR.frame));
  assert.equal(S.cosmeticOf(SR.frame)?.kind, 'frame');
  assert.ok(T.db.prepare("SELECT 1 FROM events WHERE user_id = 1 AND text LIKE '%Шоурум тижня: 1-е місце%'").get());
  // the money is booked as a weekly reward
  assert.ok(T.db.prepare("SELECT 1 FROM money_src WHERE src = 'weekly/showroom'").get());
  // once: more calls this week pay nothing
  const after = T.bal(1), weeks = T.db.prepare('SELECT COUNT(*) n FROM showroom_weeks').get().n;
  T.call(1, 'me');
  T.call(2, 'showroom', {});
  T.add(D);
  T.call(1, 'me');
  assert.equal(T.bal(1), after);
  assert.equal(T.db.prepare('SELECT COUNT(*) n FROM showroom_weeks').get().n, weeks);
  assert.ok(T.db.prepare("SELECT result FROM showroom_weeks WHERE week = '2026-11-02'").get().result);
  // the page names last week's winners; the new week starts from zero
  const p2 = T.call(100, 'showroom', {});
  assert.deepEqual(p2.lastWeek.winners.map((w) => w.id), [1, 2, 3]);
  assert.equal(p2.mine.week, 0);
  assert.equal(T.call(100, 'showroom/get', { id: 1 }).week, 0);
  assert.equal(T.call(100, 'showroom/get', { id: 1 }).likes, 5, 'the all-time ♥ stays');
});

test('a week without enough likes settles with no winners; the player card and `me` carry the showroom', () => {
  const T = setup();
  const vs = crowd(T, 2);
  for (const v of vs) T.call(v, 'showroom/like', { id: 1 });
  const p = T.call(100, 'player', { id: 1 });
  assert.equal(p.showroom.cars.length, 1);
  assert.equal(p.showroom.likes, 2);
  const me = T.call(1, 'me');
  assert.deepEqual({ n: me.showroom.n, likes: me.showroom.likes, week: me.showroom.week }, { n: 1, likes: 2, week: 2 });
  assert.equal(T.call(100, 'me').showroom.left, SR.perDay - 1);
  T.noRace();
  const b = T.bal(1);
  T.add(7 * D);
  T.call(1, 'me');
  assert.equal(T.bal(1), b, 'no showroom prize under 3 likes');
  assert.equal(T.db.prepare("SELECT COUNT(*) n FROM badges WHERE key = 'showroom'").get().n, 0);
  assert.equal(T.call(1, 'showroom', {}).lastWeek, null);
  // friends & club tab: the inviter and the invited
  T.mk(300, { ref: 1 });
  T.call(300, 'showroom/set', { cars: [T.db.prepare('SELECT id FROM cars WHERE owner_id = 300 LIMIT 1').get().id] });
  assert.deepEqual(T.call(1, 'showroom', { tab: 'friends' }).list.map((r) => r.id), [300]);
  assert.deepEqual(T.call(300, 'showroom', { tab: 'friends' }).list.map((r) => r.id), [1]);
});
