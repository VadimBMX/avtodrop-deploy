// Car wash (S.WASH): dirt from races and from time (visual only — owner decision, no income cut), the «Блищить» bonus,
// hand wash (3 a day, server-counted) and the car wash (price by class, free with VIP), the daily task, and the
// in-place upgrade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const T0 = Date.parse('2026-10-21T08:00:00Z');
const H = 3600e3;
function setup(db = openDb(':memory:')) {
  let t = T0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5 });
  const mk = (id, level = 2) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET balance = 1e9, slots = 40, level = ?, level_seen = ? WHERE id = ?').run(level, level, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const car = (id) => db.prepare('SELECT * FROM cars WHERE id = ?').get(id);
  const meCar = (uid, id) => call(uid, 'me').cars.find((c) => c.id === id);
  return { db, g, mk, call, car, meCar, advance: (ms) => (t += ms), now: () => t };
}
const D_MODEL = S.ALL_MODELS.find((m) => m.cls === 'D' && !m.secret).id;
const B_MODEL = S.ALL_MODELS.find((m) => m.cls === 'B' && !m.secret).id;
const A_MODEL = S.ALL_MODELS.find((m) => m.cls === 'A' && !m.secret).id;

test('dirt maths: no dirt from standing (owner 27.10), capped at 100, no income cut (visual only), shine +5%, exact average', () => {
  assert.equal(S.WASH.perHour, 0);
  assert.equal(S.dirtNow(10, T0, T0 + 5 * H), 10);
  assert.equal(S.dirtNow(90, T0, T0 + 50 * H), 90);
  assert.equal(S.dirtNow(30, 0, T0 + 50 * H), 30, 'no clock: stays as stored');
  assert.equal(S.WASH.maxCut, 0);
  for (const d of [0, 50, 75, 100]) assert.equal(S.dirtCut(d), 0, `${d}%`);
  assert.equal(S.washFactor(0, T0, T0 + H, T0), 1 + S.WASH.shine);
  assert.equal(S.washFactor(100, T0, 0, T0), 1, '100% dirty earns in full');
  assert.equal(S.washFactor(100, T0, T0 + H, T0), 1 + S.WASH.shine, 'shine counts however dirty');
  assert.equal(S.washFactor(100, T0, 0, T0, false), 1);
  assert.equal(S.washFactorAvg(60, T0, T0 + 3 * H, T0, T0 + 6 * H), 1 + S.WASH.shine / 2, 'half the stretch shining');
  // The closed form against a fine numeric integral, across the 50% and 100% bends and the end of a shine.
  for (const [dirt, shineH, a, b] of [[40, 3, 0, 80], [0, 6, 1, 7], [95, 0, 0, 30], [60, 0, 2, 3]]) {
    const exact = S.washFactorAvg(dirt, T0, shineH ? T0 + shineH * H : 0, T0 + a * H, T0 + b * H);
    let s = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) s += S.washFactor(dirt, T0, shineH ? T0 + shineH * H : 0, T0 + (a + ((b - a) * (i + 0.5)) / n) * H);
    assert.ok(Math.abs(exact - s / n) < 1e-6, `${dirt}% ${a}–${b} h: ${exact} vs ${s / n}`);
  }
  assert.deepEqual(Object.keys(S.WASH.price), S.CLASS_ORDER);
  assert.equal(S.washPrice(D_MODEL), 2000);
  for (let i = 1; i < 5; i++) assert.ok(S.WASH.price[S.CLASS_ORDER[i]] > S.WASH.price[S.CLASS_ORDER[i - 1]]);
});

test('a race adds 8–12% dirt, standing adds nothing (owner 27.10); new cars start clean; the car card shows it', () => {
  const { mk, call, car, meCar, advance, g } = setup();
  const u = mk(1);
  const id = g.giveCar(u, D_MODEL).id;
  assert.equal(meCar(u, id).dirt, 0);
  assert.equal(meCar(u, id).shineUntil, 0);
  advance(10 * H);
  assert.equal(meCar(u, id).dirt, 0, 'a car in the garage stays clean');
  const before = S.dirtNow(car(id).dirt, car(id).dirt_at, T0 + 10 * H);
  const { list } = call(u, 'race/rivals', { carId: id });
  call(u, 'race/start', { carId: id, rival: list[0].id });
  const added = car(id).dirt - before;
  assert.ok(added >= S.WASH.race[0] && added <= S.WASH.race[1], `race added ${added}`);
  advance(500 * H);
  assert.equal(meCar(u, id).dirt, car(id).dirt, 'no more dirt while it stands');
  for (let i = 0; i < 15; i++) { advance(61e3); call(u, 'race/start', { carId: id, rival: list[0].id }); }
  assert.ok(meCar(u, id).dirt <= 100, 'capped');
});

test('income: dirt costs nothing at any level (owner: visual only) — the server rate and «Забрати» stay full', () => {
  const { db, mk, call, g, advance, now } = setup();
  const u = mk(1);
  const id = g.giveCar(u, B_MODEL).id;
  const clean = call(u, 'me').income.rate;
  assert.ok(clean > 0);
  // 100% dirty: still the full rate.
  db.prepare('UPDATE cars SET dirt = 100, dirt_at = ? WHERE id = ?').run(now(), id);
  assert.equal(call(u, 'me').income.rate, clean);
  // From 40%: 12 h with dirt sliding 40→52% pay exactly 12 h of the clean rate (the largest cap and VIP's extra hours,
  // so the cap never bites).
  db.prepare('UPDATE cars SET dirt = 40, dirt_at = ? WHERE id = ?').run(now(), id);
  db.prepare('UPDATE users SET banked = 0, income_at = ?, cap_level = ?, vip_until = ? WHERE id = ?').run(now(), S.CAP_LEVELS.length - 1, now() + 99 * H, u);
  advance(12 * H);
  const want = clean * 12;
  const got = call(u, 'collect').got;
  assert.ok(Math.abs(got - want) <= 2, `${got} vs ${want}`);
  // A level-1 player (wash still locked) keeps the full income however dirty the car is.
  db.prepare('UPDATE users SET level = 1 WHERE id = ?').run(u);
  db.prepare('UPDATE cars SET dirt = 100 WHERE id = ?').run(id);
  assert.equal(call(u, 'me').income.rate, clean);
  assert.deepEqual(call(u, 'me').unlocked, []);
});

test('hand wash: free, 3 a day (server-counted), own car only, sets dirt 0 and «Блищить» +5% for 6 h', () => {
  const { db, mk, call, g, advance, now, meCar } = setup();
  const u = mk(1), other = mk(2);
  const ids = [g.giveCar(u, B_MODEL).id, g.giveCar(u, D_MODEL).id, g.giveCar(u, D_MODEL).id, g.giveCar(u, D_MODEL).id];
  const theirs = g.giveCar(other, D_MODEL).id;
  db.prepare('UPDATE cars SET dirt = 80, dirt_at = ?').run(now());
  const rate0 = call(u, 'me').income.rate;
  const bal = call(u, 'me').balance;
  assert.throws(() => call(u, 'wash/hand', { carId: theirs }), /не твоє/);
  assert.equal(call(u, 'me').wash.handLeft, 3);
  const r = call(u, 'wash/hand', { carId: ids[0] });
  assert.equal(r.handLeft, 2);
  assert.equal(r.shineUntil, now() + 6 * H);
  const c = meCar(u, ids[0]);
  assert.equal(c.dirt, 0);
  assert.equal(c.shineUntil, now() + 6 * H);
  assert.equal(call(u, 'me').balance, bal, 'free');
  assert.ok(call(u, 'me').income.rate > rate0, 'washed car earns more');
  call(u, 'wash/hand', { carId: ids[1] });
  call(u, 'wash/hand', { carId: ids[2] });
  assert.throws(() => call(u, 'wash/hand', { carId: ids[3] }), /на сьогодні все/);
  assert.equal(call(u, 'me').wash.handLeft, 0);
  // A car on the market can't be washed.
  db.prepare("UPDATE cars SET status = 'market' WHERE id = ?").run(ids[3]);
  advance(24 * H);
  assert.equal(call(u, 'me').wash.handLeft, 3, 'a new Kyiv day');
  assert.throws(() => call(u, 'wash/hand', { carId: ids[3] }), /ринку|аукціоні/);
  // The shine ends after 6 h: the washed car earns exactly 1.05× its clean rate meanwhile.
  db.prepare("UPDATE cars SET status = 'garage', dirt = 0, dirt_at = ? WHERE owner_id = ?").run(now(), u);
  for (const id of ids.slice(1)) db.prepare('DELETE FROM cars WHERE id = ?').run(id);
  const only = call(u, 'me').income.rate;
  call(u, 'wash/hand', { carId: ids[0] });
  assert.equal(call(u, 'me').income.rate, Math.round(only * (1 + S.WASH.shine)));
  advance(6 * H + 1);
  assert.equal(call(u, 'me').income.rate, only);
  assert.equal(meCar(u, ids[0]).shineUntil, 0);
});

test('car wash: class price, «помити всі» pays the sum, VIP washes free, no money — no wash', () => {
  const { db, mk, call, g, now } = setup();
  const u = mk(1);
  const a = g.giveCar(u, A_MODEL).id, b = g.giveCar(u, B_MODEL).id, d = g.giveCar(u, D_MODEL).id;
  db.prepare('UPDATE cars SET dirt = 70, dirt_at = ?').run(now());
  const bal = call(u, 'me').balance;
  const one = call(u, 'wash/auto', { carIds: [d] });
  assert.equal(one.paid, S.WASH.price.D);
  assert.equal(call(u, 'me').balance, bal - S.WASH.price.D);
  const all = call(u, 'wash/auto', { carIds: [a, b] });
  assert.equal(all.paid, S.WASH.price.A + S.WASH.price.B);
  assert.equal(all.count, 2);
  assert.ok(call(u, 'me').cars.every((c) => c.dirt === 0 && c.shineUntil > now()));
  assert.throws(() => call(u, 'wash/auto', { carIds: [] }), /Обери/);
  assert.throws(() => call(u, 'wash/auto', { carIds: [a, a] }), /повторюються/);
  // No money: refused, nothing washed.
  db.prepare('UPDATE cars SET dirt = 70, dirt_at = ?').run(now());
  db.prepare('UPDATE users SET balance = 1000 WHERE id = ?').run(u);
  assert.throws(() => call(u, 'wash/auto', { carIds: [a] }), /Недостатньо/);
  assert.equal(call(u, 'me').cars.find((c) => c.id === a).dirt, 70);
  // VIP: free.
  db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(now() + 24 * H, u);
  const v = call(u, 'wash/auto', { carIds: [a, b, d] });
  assert.equal(v.paid, 0);
  assert.equal(v.vip, true);
  assert.equal(call(u, 'me').balance, 1000);
});

test('the daily task «Помий машини» counts every washed car', () => {
  const { db, mk, call, g, now } = setup();
  const u = mk(1);
  const ids = [g.giveCar(u, D_MODEL).id, g.giveCar(u, D_MODEL).id, g.giveCar(u, D_MODEL).id];
  call(u, 'quests'); // makes today's tasks; then today's set is replaced by the wash task
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now()));
  db.prepare('DELETE FROM quests WHERE user_id = ?').run(u);
  db.prepare('INSERT INTO quests (user_id, day, key, target, reward) VALUES (?, ?, ?, ?, ?)').run(u, d, 'wash', 3, 1000);
  call(u, 'wash/hand', { carId: ids[0] });
  call(u, 'wash/auto', { carIds: [ids[1], ids[2]] });
  assert.equal(db.prepare("SELECT progress FROM quests WHERE user_id = ? AND key = 'wash'").get(u).progress, 3);
});

test('upgrade in place: an old database gets the columns, its cars start clean with the clock from the upgrade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtodrop-wash-'));
  const file = path.join(dir, 'w.db');
  try {
    let db = openDb(file);
    db.exec("INSERT INTO cars (owner_id, model, tank, tank_at, created_at) VALUES (1, 'zaz-lanos', 5, 0, 0)");
    db.close();
    // Back to before the wash: drop the new columns.
    const raw = new DatabaseSync(file);
    for (const col of ['dirt', 'dirt_at', 'shine_until']) raw.exec(`ALTER TABLE cars DROP COLUMN ${col}`);
    for (const col of ['wash_day', 'wash_hand']) raw.exec(`ALTER TABLE users DROP COLUMN ${col}`);
    raw.close();
    const t = Date.now();
    db = openDb(file);
    const c = db.prepare('SELECT dirt, dirt_at, shine_until FROM cars').get();
    assert.equal(c.dirt, 0);
    assert.equal(c.shine_until, 0);
    assert.ok(Math.abs(c.dirt_at - t) < 5000, 'clock starts at the upgrade');
    db.close();
    // A second start changes nothing.
    db = openDb(file);
    assert.equal(db.prepare('SELECT dirt_at FROM cars').get().dirt_at, c.dirt_at);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('drift runs (11–15%), career bosses and PvP (both cars) get the cars dirty too', () => {
  const { mk, call, car, g } = setup();
  const u = mk(1, 10), v = mk(2, 10);
  const id = g.giveCar(u, B_MODEL).id, vid = g.giveCar(v, B_MODEL).id;
  const st = call(u, 'drift/rivals', { carId: id });
  call(u, 'drift/start', { carId: id, rival: st.list[0].id });
  const d1 = car(id).dirt;
  assert.ok(d1 >= S.WASH.drift[0] && d1 <= S.WASH.drift[1], `drift added ${d1}`);
  const bid = g.giveCar(u, 'vaz-2107').id; // the first boss races D–C cars only (class windows)
  const boss = call(u, 'boss/list', { carId: bid }).list.find((b) => b.open && b.fits);
  call(u, 'boss/start', { carId: bid, boss: boss.id });
  const d2 = car(bid).dirt;
  assert.ok(d2 >= S.WASH.race[0] && d2 <= S.WASH.race[1] + 0.01, `boss added ${d2}`);
  const { id: pid } = call(u, 'pvp/create', { carId: id, bet: S.PVP_MIN_BET });
  call(v, 'pvp/accept', { id: pid, carId: vid });
  assert.ok(car(id).dirt - d1 >= S.WASH.race[0] - 0.01, 'creator car');
  assert.ok(car(vid).dirt >= S.WASH.race[0], 'opponent car');
});
