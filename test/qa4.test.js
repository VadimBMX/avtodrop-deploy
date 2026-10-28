// qa4 (night 28.10, wave N2): the six night features merged together — the calm garage («Сьогодні» card, the slim
// tank line), and the places where the features meet: goals × canister, the daily bonus × the bigger tank, the buyer ×
// the showroom, bug rewards × the hidden-from-ratings chain, two new reminder kinds under one limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { pickReminder, PUSH, KINDS } from '../src/reminders.js';
import * as S from '../public/shared.js';
import * as B from '../public/buyer.js';
import { tankShown, TANK_NEAR } from '../public/garage-calm.js';

const src = (p) => fs.readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
const K = (s) => Date.parse(s + '+02:00'); // Kyiv wall clock
const H = 3600e3;
const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date(t));

function setup(t0 = K('2026-10-28T12:00:00')) {
  let t = t0;
  const db = openDb(':memory:');
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('buyer_seed', 'cd'.repeat(32));
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {} });
  const mk = (id, level = 18, balance = 80e6) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ?, slots = 40 WHERE id = ?').run(level, level, balance, id);
    db.prepare('DELETE FROM cars WHERE owner_id = ?').run(id);
    return id;
  };
  const car = (uid, model) => Number(db.prepare("INSERT INTO cars (owner_id, model, tank, tank_at, created_at, dirt_at, status) VALUES (?, ?, 3, ?, ?, ?, 'garage')")
    .run(uid, model, t, t - 48 * H, t).lastInsertRowid);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const fuel = (uid) => { const m = call(uid, 'me'); return [m.fuel, m.fuelMax]; };
  return { db, g, mk, car, call, fuel, add: (ms) => (t += ms), at: () => t };
}

test('garage: the tank line shows only when it matters (empty, or the next tank open and half affordable)', () => {
  const next = S.nextTank(0); // 18 for 2 млн from level 5
  assert.equal(tankShown({ level: 1, fuel: 0, balance: 1e9, next }), false, 'the first minutes: nothing');
  assert.equal(tankShown({ level: 3, fuel: 9, balance: 1e9, next }), false, 'locked by level → in the level list, not the garage');
  assert.equal(tankShown({ level: 3, fuel: 0, balance: 0, next }), true, 'an empty tank always shows (when the next one comes)');
  assert.equal(tankShown({ level: 5, fuel: 9, balance: next.cost * TANK_NEAR - 1, next }), false);
  assert.equal(tankShown({ level: 5, fuel: 9, balance: next.cost * TANK_NEAR, next }), true, 'near: half the price');
  assert.equal(tankShown({ level: 60, fuel: 9, balance: 1e12, next: S.nextTank(S.TANK_UPGRADES.length) }), false, 'the biggest tank: quiet');
});

test('garage: «Цілі дня» and «Таємний покупець» are rows of one «Сьогодні» card; it hides when empty', () => {
  const app = src('app.js'), goals = src('goals-ui.js'), buyer = src('buyer-ui.js'), css = src('style.css');
  const g = app.slice(app.indexOf('TABS.garage = () => {'), app.indexOf('H.gView ='));
  const iInc = g.indexOf('id="incomeCard"'), iToday = g.indexOf('<div class="card today" id="todayCard"></div>'), iTank = g.indexOf('${tankCard()}');
  assert.ok(iInc > 0 && iToday > iInc && iTank > iToday, 'cash → «Сьогодні» → tank line');
  assert.match(goals, /today\.insertAdjacentHTML\('afterbegin', html\)/, 'the goals row first');
  assert.match(buyer, /today\.append\(el\)/, 'the buyer row after it (it used to land above the goals)');
  assert.match(css, /\.card\.today:empty \{ display: none; \}/);
  // the buyer row is compact: his quote moved into the confirm sheet; a sold offer is one line
  const card = buyer.slice(buyer.indexOf('function cardHtml'), buyer.indexOf('function paint'));
  assert.doesNotMatch(card, /tb-line/);
  assert.match(buyer.slice(buyer.indexOf('function confirmSale')), /tb-line/);
});

test('texts: the canister line speaks of «цілі дня»; a showroom row fits 360 px', () => {
  const app = src('app.js'), css = src('style.css');
  assert.match(app, /за кожну ціль дня \(не більше за бак\)/);
  assert.doesNotMatch(app, /виконане завдання дня/);
  assert.match(css, /\.srm-row \.srm-th \.art \{ flex: 0 1 58px; min-width: 0; \}/);
});

test('goals × canister × bigger tank: +1 per goal and +3 a day, up to the player\'s own tank', () => {
  const x = setup();
  const u = x.mk(10);
  x.car(u, S.ALL_MODELS.find((m) => m.cls === 'C' && !m.secret).id);
  x.car(u, S.ALL_MODELS.find((m) => m.cls === 'D' && !m.secret).id);
  // the reward case not ready: its random «повний бак» would fill the tank before the canister counts
  x.db.prepare('UPDATE users SET tank_lvl = 1, fuel = 16, fuel_at = ?, reward_case_at = ? WHERE id = ?').run(x.at(), x.at(), u);
  assert.deepEqual(x.fuel(u), [16, 18]);
  const day = dayKey(x.at());
  x.call(u, 'quests');
  const keys = x.db.prepare('SELECT key FROM quests WHERE user_id = ? AND day = ?').all(u, day).map((r) => r.key);
  assert.equal(keys.length, 3, 'three goals a day');
  x.db.prepare('UPDATE quests SET progress = target WHERE user_id = ? AND day = ? AND key = ?').run(u, day, keys[0]);
  assert.equal(x.call(u, 'quests/claim', { key: keys[0] }).canister, 1);
  assert.deepEqual(x.fuel(u), [17, 18]);
  // the daily +3 stops at 18 (not at the old 15, not above the tank)
  assert.equal(x.call(u, 'rewards/daily').reward.canister, 1);
  assert.deepEqual(x.fuel(u), [18, 18]);
  // full: the next goal pays its money, no fuel
  x.db.prepare('UPDATE quests SET progress = target WHERE user_id = ? AND day = ? AND key = ?').run(u, day, keys[1]);
  assert.equal(x.call(u, 'quests/claim', { key: keys[1] }).canister, 0);
  // a bigger tank keeps what was in it
  x.call(u, 'tank/upgrade');
  assert.deepEqual(x.fuel(u), [18, 21]);
  // the last goal → +1 fuel and the day's key; «Забрати все» still counts it once
  x.db.prepare('UPDATE quests SET progress = target WHERE user_id = ? AND day = ? AND key = ?').run(u, day, keys[2]);
  const all = x.call(u, 'rewards/all');
  assert.equal(all.canister, 1);
  assert.ok(all.reveal.some((r) => r.kind === 'key' && r.caseId === S.goalKey(18)), 'the goals key comes with it');
  assert.deepEqual(x.fuel(u), [19, 21]);
});

test('buyer × showroom: a car on show sold to the buyer leaves the showroom cleanly (own page, lists, others)', () => {
  const x = setup();
  const u = x.mk(20), v = x.mk(21);
  const ms = B.BUYABLE.filter((m) => m.cls === 'B').slice(0, 3).map((m) => m.id);
  const ids = ms.map((m) => x.car(u, m));
  x.car(u, B.BUYABLE.find((m) => m.cls === 'D').id);
  x.call(u, 'showroom/set', { cars: ids });
  x.call(u, 'me'); // today's offer, then the one we want in its place
  x.db.prepare('DELETE FROM buyer_offers WHERE user_id = ?').run(u);
  x.db.prepare('INSERT INTO buyer_offers (user_id, day, kind, req, prem, city, line, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(u, dayKey(x.at()), 'own', JSON.stringify({ model: ms[1] }), 0.35, 'Одеси', 'Шукаю…', x.at(), x.at() + B.BUYER.hours * H);
  const r = x.call(u, 'buyer/sell', { carId: ids[1] });
  assert.ok(r.got > 0 && r.bonus > 0);
  assert.deepEqual(x.call(u, 'showroom', { tab: 'new' }).mine.cars.map((c) => c.id), [ids[0], ids[2]]);
  assert.equal(x.call(u, 'me').showroom.n, 2);
  assert.deepEqual(x.call(v, 'showroom/get', { id: u }).cars.map((c) => c.id), [ids[0], ids[2]]);
  assert.deepEqual(x.call(v, 'showroom', { tab: 'new' }).list.find((row) => row.id === u).cars.map((c) => c.id), [ids[0], ids[2]]);
  // the stale id doesn't block a new pick
  x.call(u, 'showroom/set', { cars: [ids[2], ids[0]] });
  assert.deepEqual(x.call(u, 'showroom', { tab: 'new' }).mine.cars.map((c) => c.id), [ids[2], ids[0]]);
});

test('ratings: a hidden player stays hidden on every board, with the 🐞 tag and «Статок» in the chain', () => {
  const x = setup();
  const hid = x.mk(30, 20, 9e12), seen = x.mk(31, 20, 5e6), viewer = x.mk(32);
  for (const id of [hid, seen]) x.car(id, S.ALL_MODELS.find((m) => m.cls === 'A' && !m.secret).id);
  x.g.adminCall('tg:1', 'bug-reward', { id: hid, preset: 'small', confirm: true });
  x.g.adminCall('tg:1', 'bug-reward', { id: seen, preset: 'small', confirm: true });
  x.db.prepare('UPDATE users SET lb_hidden = 1, season_xp = 999999 WHERE id = ?').run(hid);
  x.db.prepare('UPDATE users SET season_xp = 10 WHERE id = ?').run(seen);
  for (const type of ['season', 'week', 'all', 'wealth', undefined]) {
    const r = x.call(viewer, 'leaderboard', { type });
    assert.ok(!r.list.some((row) => row.id === hid), `hidden on ${type}`);
    const s = r.list.find((row) => row.id === seen);
    if (s) assert.equal(s.tester, 1, `the 🐞 tag survives the hiding filter on ${type}`);
    r.list.forEach((row, i) => assert.equal(row.place, i + 1, 'places close up'));
  }
});

test('reminders: «Цілі дня» and «Таємний покупець» share one message under 2 a day, quiet hours and one a kind', () => {
  const t = K('2026-10-28T19:30:00');
  const c = {
    uid: 1, lastSeen: t - 2 * H, pushDay: null, pushCount: 0, pushLast: 0, sent: {},
    ready: [{ kind: 'buyer', at: t - 10e3, text: 'b' }, { kind: 'goals', at: t - 60e3, text: 'g' }, { kind: 'dayrace', at: t - 60e3, text: 'd' }, { kind: 'tggroup', at: t - 60e3, text: 't' }],
  };
  assert.deepEqual(pickReminder(c, t), ['dayrace', 'goals', 'buyer', 'tggroup'], 'one bundle, in KINDS order');
  assert.ok(KINDS.indexOf('goals') < KINDS.indexOf('buyer'));
  // after that one message: the same kinds don't come back today, and the second message waits minGapH
  const sent = { buyer: t, goals: t, dayrace: t, tggroup: t };
  assert.equal(pickReminder({ ...c, pushDay: dayKey(t), pushCount: 1, pushLast: t, sent }, t + H), null);
  assert.equal(pickReminder({ ...c, pushDay: dayKey(t), pushCount: 1, pushLast: t, sent }, t + PUSH.minGapH * H + 1), null, 'nothing new → nothing');
  assert.equal(pickReminder({ ...c, pushDay: dayKey(t), pushCount: PUSH.maxPerDay }, t), null, '2 a day');
  assert.equal(pickReminder(c, K('2026-10-28T23:10:00')), null, 'quiet hours');
  assert.deepEqual(pickReminder({ ...c, mute: 'garage' }, t), ['dayrace', 'goals', 'tggroup'], 'the buyer is muted with «Гараж»');
});
