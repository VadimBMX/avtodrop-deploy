// Progression and the first days (audit §2 №3, №4, №14): the XP table and its one-time migration, the one shared
// fuel tank (no per-car limit), and «Перші кроки» — the single newbie track and how older tracks map onto it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

const T0 = Date.parse('2026-10-22T08:00:00Z');
function setup(db = openDb(':memory:'), extra = {}) {
  const clock = { t: T0 };
  const g = createGame(db, { now: () => clock.t, notify: () => {}, random: () => 0.5, partCooldownMs: 0, ...extra });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const user = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const set = (id, sql, ...args) => db.prepare(`UPDATE users SET ${sql} WHERE id = ?`).run(...args, id);
  const drive = (uid, st, qs = ['perfect', 'perfect', 'perfect', 'perfect']) => {
    const run = honestDrag(st.car, st.greenMs, 0.2, qs);
    clock.t += Math.ceil(run.ms) + 50;
    return call(uid, 'race/finish', { raceId: st.raceId, ...run.body });
  };
  return { db, g, clock, mk, call, user, set, drive };
}

// ---------- XP thresholds ----------
test('xp: the owner\'s table for levels 1–8, a smooth bridge to 300·L^1.6 from level 11, never more than before', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(S.xpForLevel), [300, 700, 1100, 1600, 2300, 3200, 4300]);
  for (let l = 11; l <= 60; l++) assert.equal(S.xpForLevel(l), Math.round(300 * Math.pow(l, 1.6)), `L${l}`);
  for (let l = 1; l < 80; l++) {
    assert.ok(S.xpForLevel(l + 1) > S.xpForLevel(l), `rises at L${l}`);
    assert.ok(S.xpForLevel(l) <= S.xpForLevelV1(l), `L${l} never needs more than the old curve`);
  }
  // No jump where the table hands over: L7→L11 grow by the table's own last step (×1.34 ± 0.02).
  for (let l = 7; l <= 10; l++) {
    const k = S.xpForLevel(l + 1) / S.xpForLevel(l);
    assert.ok(k > 1.32 && k < 1.36, `L${l}→${l + 1} ×${k.toFixed(3)}`);
  }
  assert.equal(S.xpForLevel(0), 300, 'a broken level 0 never loops forever');
  // Level 4 (the first social and cosmetic features) at 2 100 xp in total, level 5 at 3 700 (were 3 512 and 7 150).
  const total = (to) => Array.from({ length: to - 1 }, (_, i) => S.xpForLevel(i + 1)).reduce((a, b) => a + b, 0);
  assert.equal(total(4), 2100);
  assert.equal(total(5), 3700);
});

test('xp: the daily cap is only for cases, parts and plates (and the upgrade/casino); races, the daily bonus and tasks are uncapped', () => {
  for (const k of ['case', 'plate', 'merge', 'install']) assert.ok(S.CAPPED_XP.includes(k), k);
  for (const k of ['win', 'race', 'daily', 'task', 'quest', 'newCar', 'pvp']) assert.ok(!S.CAPPED_XP.includes(k), k);
  const { mk, call, g, set, user, drive } = setup(undefined, { allUnlocked: true });
  mk(1);
  const car = g.giveCar(1, 'vaz-2107').id;
  set(1, 'balance = 1e9, xp_day = ?, xp_day_capped = ?', '2026-10-22', S.DAILY_XP_CAP); // the cap is used up today
  const xp0 = user(1).xp;
  const r = drive(1, call(1, 'race/start', { carId: car, rival: 'train' }));
  assert.equal(user(1).xp - xp0, r.win ? S.XP.win : S.XP.race, 'a race pays its xp with the cap used up');
  assert.equal(call(1, 'me').xpToday, S.DAILY_XP_CAP);
});

// ---------- migration of the stored xp ----------
test('xp migration: levels stay, the bar keeps its share, nobody jumps levels; once per player row', () => {
  const db = openDb(':memory:');
  const a = setup(db);
  const rows = [[21, 1, 150], [22, 3, 2000], [23, 4, 3637], [24, 7, 5000], [25, 13, 30000], [26, 30, 0], [27, 2, 1043]];
  for (const [id, level, xp] of rows) (a.mk(id), a.set(id, 'level = ?, level_seen = ?, xp = ?', level, level, xp));
  a.mk(30);
  a.set(30, 'level = 1, level_seen = 1, xp = 710'); // seen in an old Railway copy: more than the level needs
  db.prepare('UPDATE users SET prog_v = 0').run(); // rows from before the table (old players, or merged in from an older database)
  const b = setup(db);
  for (const [id, level, xp] of rows) {
    const u = b.user(id), need = S.xpForLevel(level);
    assert.equal(u.level, level, `${id} keeps level ${level}`);
    assert.ok(u.xp >= 0 && u.xp < need, `${id}: ${u.xp} < ${need}`);
    const was = xp / S.xpForLevelV1(level), now = u.xp / need;
    assert.ok(Math.abs(was - now) < 1 / need + 1e-9, `${id}: share ${was.toFixed(4)} → ${now.toFixed(4)}`);
    const me = b.call(id, 'me');
    assert.ok(me.xp < me.xpNeed, 'no bar over 100%');
  }
  assert.equal(b.user(21).xp, 150, 'level 1 needs 300 on both curves: unchanged');
  assert.equal(b.user(26).xp, 0);
  // The next xp is ordinary: one daily bonus never lifts a migrated player more than one level.
  b.call(23, 'rewards/daily');
  assert.ok(b.user(23).level <= 5);
  // A broken row that already held more than its need keeps it and levels up on its next xp, with the level gift.
  assert.equal(b.user(30).xp, 710);
  const bal = b.user(30).balance;
  b.call(30, 'rewards/daily');
  assert.equal(b.user(30).level, 2);
  assert.equal(b.user(30).xp, 710 + S.XP.daily - S.xpForLevel(1));
  assert.ok(b.user(30).balance >= bal + S.levelReward(2).money);
  // Once: a second start leaves the numbers alone.
  const snap = rows.map(([id]) => b.user(id).xp);
  setup(db);
  assert.deepEqual(rows.map(([id]) => b.user(id).xp), snap);
  // A player who signs up now is born on the new curve: never rescaled.
  b.mk(28);
  b.set(28, 'level = 3, xp = 1000');
  setup(db);
  assert.equal(b.user(28).xp, 1000);
  // A row merged in later from an older database (prog_v 0 by default) is migrated at the next start, alone.
  db.prepare("INSERT INTO users (id, balance, slots, showcase_slots, income_at, fuel, fuel_at, server_seed, client_seed, created_at, last_seen, level, xp) VALUES (29, 0, 6, 4, 0, 15, 0, 's', 'c', 0, 0, 3, 2000)").run();
  setup(db);
  assert.equal(b.user(29).xp, Math.floor((2000 * S.xpForLevel(3)) / S.xpForLevelV1(3)));
  assert.equal(b.user(28).xp, 1000);
  assert.deepEqual(rows.map(([id]) => b.user(id).xp), snap);
});

// ---------- one shared tank ----------
test('fuel: one shared tank, no per-car limit — one car races all 15, any race kind takes from the same tank', () => {
  const { mk, call, g, db, set, drive, clock } = setup(undefined, { allUnlocked: true });
  mk(1);
  set(1, 'balance = 1e9, level = 20, level_seen = 20');
  const car = g.giveCar(1, 'vaz-2107').id;
  for (let i = 0; i < S.FUEL_MAX - 1; i++) drive(1, call(1, 'race/start', { carId: car, rival: 'train' }));
  assert.equal(call(1, 'me').fuel, 1);
  assert.equal(db.prepare('SELECT tank FROM cars WHERE id = ?').get(car).tank, S.CAR_TANK, 'cars.tank is no longer touched');
  assert.equal(call(1, 'me').cars.find((c) => c.id === car).tank, S.CAR_TANK, 'an app from before never greys the car out');
  // The last one on a boss: the same tank.
  const boss = S.BOSSES[0];
  const fits = g.giveCar(1, S.ALL_MODELS.find((m) => S.bossFits(boss, m.id) && !m.secret).id).id;
  clock.t += 61e3;
  call(1, 'boss/start', { carId: fits, boss: boss.id });
  assert.equal(call(1, 'me').fuel, 0);
  // Empty: a clear message with the wait (the app shows a card instead of it).
  assert.throws(() => call(1, 'race/start', { carId: car, rival: 'train' }), /Пальне 0\/15 — \+1 через \d+ хв/);
  assert.throws(() => call(1, 'drift/start', { carId: car, rival: 'easy' }), /Пальне 0\/15/);
  clock.t += S.FUEL_REGEN_MIN * 60e3;
  assert.equal(call(1, 'me').fuel, 1);
  call(1, 'race/start', { carId: fits, rival: 'train' });
});

// ---------- «Перші кроки» ----------
test('«Перші кроки»: a new player walks all 8 steps with real actions, each paid once, in order', () => {
  const { mk, call, g, set, user, drive, clock } = setup();
  mk(1);
  call(1, 'intro/seen');
  const paid = [];
  const claim = () => paid.push(call(1, 'newbie/claim').got);
  const step = () => call(1, 'me').newbie;
  assert.equal(call(1, 'me').guide, 'starter');
  call(1, 'case/open', { caseId: 'starter' });
  claim();
  assert.equal(call(1, 'me').guide, 'collect');
  assert.throws(() => call(1, 'newbie/claim'), /ще не виконано/);
  clock.t += 3600e3;
  call(1, 'collect');
  claim();
  const car = call(1, 'me').cars[0].id;
  assert.equal(call(1, 'me').guide, 'race');
  drive(1, call(1, 'race/start', { carId: car, rival: 'train' }), ['late', 'late', 'late', 'late']);
  claim();
  assert.equal(call(1, 'me').guide, 'daily');
  call(1, 'rewards/daily');
  claim();
  assert.equal(step().key, 'win');
  for (let i = 0; i < 5 && !step().ready; i++) (clock.t += 61e3, drive(1, call(1, 'race/start', { carId: car, rival: 'train' })));
  claim();
  assert.equal(call(1, 'me').guide, 'open_case');
  set(1, 'balance = 1e8');
  call(1, 'case/open', { caseId: 'rust' });
  claim();
  // Install: locked until level 2 → the pill says so; then a part case; then the install.
  set(1, 'level = 1, xp = 0');
  assert.equal(call(1, 'me').guide, 'level2');
  assert.equal(step().lockedTill, 2);
  set(1, 'level = 2, level_seen = 2');
  assert.equal(call(1, 'me').guide, 'part_case');
  call(1, 'parts/open', { caseId: 'scrap', count: 1 });
  assert.equal(call(1, 'me').guide, 'install');
  const me = call(1, 'me');
  const part = me.parts[0];
  const target = me.cars.find((c) => S.partFits(c.model, part.type));
  call(1, 'parts/install', { carId: target.id, type: part.type, tier: part.tier });
  claim();
  assert.equal(call(1, 'me').guide, 'level3');
  set(1, 'level = 3, level_seen = 3');
  claim();
  assert.deepEqual(paid, S.NEWBIE_TASKS.map((t) => t.money));
  assert.equal(call(1, 'me').newbie, null);
  assert.equal(call(1, 'me').guide, null);
  assert.throws(() => call(1, 'newbie/claim'), /Перші кроки/);
  assert.ok(user(1).level >= 3);
});

test('«Перші кроки» migration from the 10-task track: every case keeps progress, nothing is paid twice', () => {
  const db = openDb(':memory:');
  const a = setup(db);
  const v2 = (k) => S.NEWBIE_ORDER_V2.indexOf(k);
  // [id, old step, old flags, daily bonuses taken]
  const cases = [
    [41, 0, '["open_starter"]', 0], // nothing claimed: untouched
    [42, v2('race'), '["collect","race"]', 3], // claimed open_starter, collect; took daily bonuses
    [43, v2('open_case'), '[]', 0], // claimed …, race, win; no daily bonus yet
    [44, v2('level3'), '[]', 2], // claimed through merge
    [45, v2('plate'), '[]', 5], // claimed through level3, only the plate left
    [46, 10, '[]', 9], // finished
    [47, v2('win'), '["nb:install","nb:plate"]', 1], // from the V1 migration: install and plate already paid
  ];
  for (const [id, step, flags, streak] of cases) (a.mk(id), a.set(id, 'newbie_step = ?, newbie_flags = ?, streak = ?', step, flags, streak));
  db.prepare('UPDATE users SET prog_v = 0').run();
  const b = setup(db, { allUnlocked: true });
  const at = (id) => {
    const u = b.user(id);
    return [S.NEWBIE_TASKS[u.newbie_step]?.key ?? 'done', JSON.parse(u.newbie_flags).filter((f) => f.startsWith('nb:')).sort()];
  };
  assert.deepEqual(at(41), ['open_starter', []]);
  assert.deepEqual(JSON.parse(b.user(41).newbie_flags), ['open_starter'], 'progress flags are kept');
  assert.deepEqual(at(42), ['race', ['nb:daily']], 'took daily bonuses before: that step is skipped, not paid');
  assert.deepEqual(JSON.parse(b.user(42).newbie_flags).filter((f) => !f.startsWith('nb:')), ['collect', 'race']);
  assert.deepEqual(at(43), ['daily', ['nb:win']]);
  assert.deepEqual(at(44), ['level3', []], 'daily taken before → skipped; win, open_case, install were paid');
  assert.deepEqual(at(45), ['done', []]);
  assert.deepEqual(at(46), ['done', []]);
  assert.deepEqual(at(47), ['win', ['nb:install']], 'old skip marks carry over, the plate is gone from the track');
  // 43: the daily step, then win is skipped (paid in the old track) and open_case is next.
  const bal = b.user(43).balance;
  b.call(43, 'rewards/daily');
  const got = b.call(43, 'newbie/claim').got;
  assert.equal(got, S.NEWBIE_TASKS.find((t) => t.key === 'daily').money);
  assert.equal(at(43)[0], 'open_case');
  assert.ok(b.user(43).balance >= bal + got);
  // Runs once.
  b.set(46, 'newbie_step = 2');
  setup(db);
  assert.equal(b.user(46).newbie_step, 2);
});
