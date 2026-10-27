// Progressive unlock (S.UNLOCKS): the server refuses locked features, opens them with the level, keeps them for players
// who used them before the ladder (users.feats backfill, newbie order migration), never locks staff; the owner's
// casino switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const T0 = Date.parse('2026-10-21T10:00:00Z');
function setup(db = openDb(':memory:'), extra = {}) {
  let t = T0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, admins: [1], ...extra });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const setLevel = (uid, level) => db.prepare('UPDATE users SET level = ? WHERE id = ?').run(level, uid);
  const owner = (name, body) => g.adminCall('tg:1', name, { reason: 'тест', confirm: true, ...body });
  // The casino is off by default since 22.10 (S.CASINO_DEFAULT); tests of the ladder itself switch it on.
  const casinoOn = () => db.prepare("INSERT INTO meta (key, value) VALUES ('casino_mode', 'on') ON CONFLICT DO UPDATE SET value = 'on'").run();
  return { db, g, mk, call, setLevel, owner, casinoOn, advance: (ms) => (t += ms) };
}

test('ladder: one constant, levels ascending, every gated key in it; casino and upgrade late', () => {
  const levels = S.UNLOCKS.map((u) => u.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
  assert.ok(S.unlockLevel('casino') >= 10 && S.unlockLevel('upgrade') >= 4);
  assert.equal(S.unlockLevel('nothing'), 1);
  assert.deepEqual(S.unlocksBetween(1, 3).map((u) => u.key), ['parts', 'wash', 'dayrace', 'drift', 'plates', 'market', 'trades', 'auction', 'paint', 'tradein', 'pvp', 'battles']);
  for (const t of S.NEWBIE_TASKS) if (t.feature) assert.ok(S.UNLOCK_BY_KEY[t.feature]);
  // Newbie tasks follow the ladder: no task needs a feature that opens later than the step before it allows.
  const at = S.NEWBIE_TASKS.map((t) => (t.feature ? S.unlockLevel(t.feature) : t.key === 'level3' ? 3 : 1));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  assert.deepEqual([...S.NEWBIE_ORDER_V1].sort(), [...S.NEWBIE_ORDER_V2].sort());
});

test('a level-1 player: core loop open, everything else refused by the API with the level it opens at', () => {
  const { mk, call, setLevel, casinoOn } = setup();
  mk(5);
  const me = call(5, 'me');
  assert.deepEqual(me.unlocked, []);
  assert.equal(me.casino, S.CASINO_DEFAULT);
  casinoOn();
  call(5, 'case/open', { caseId: 'starter' });
  const car = call(5, 'me').cars[0];
  call(5, 'race/rivals', { carId: car.id });
  call(5, 'rewards/daily');
  const refused = [
    ['parts/open', { caseId: 'scrap', count: 1 }, 2], ['wash/hand', { carId: car.id }, 2], ['wash/auto', { carIds: [car.id] }, 2], ['drift/rivals', { carId: car.id }, 2], ['plate/generate', { gen: 'basic' }, 2],
    ['car/paint', { carId: car.id, color: 'red' }, 2], ['dealer/tradein', { carIds: [car.id] }, 2], ['market/sell', { carId: car.id, price: 1e6 }, 2],
    ['pvp/create', { carId: car.id, bet: 1e5 }, 3], ['trade/create', { to: 1 }, 2], ['room/create', {}, 2], ['auction/create', { carId: car.id, startPrice: 1e5, hours: 1 }, 2],
    ['battle/create', { caseId: 'rust', count: 1 }, 3], ['upgrade', { carIds: [car.id], target: 'x' }, 4],
    ['casino/slots', { amount: 10000 }, 10], ['casino/roulette', { bets: [{ on: 'red', amount: 10000 }] }, 10],
    ['casino/crash/start', { amount: 10000 }, 10], ['casino/mines/start', { amount: 10000, mines: 3 }, 10],
  ];
  for (const [name, body, lvl] of refused) assert.throws(() => call(5, name, body), new RegExp(`відкриється на рівні ${lvl}`), name);
  // Reads stay open (nothing is ever stuck): lists, own lots, cancel paths.
  call(5, 'market/list', {});
  call(5, 'casino/mines/state');
  // The level opens them.
  setLevel(5, 2);
  assert.deepEqual(call(5, 'me').unlocked, ['parts', 'wash', 'dayrace', 'drift', 'plates', 'market', 'trades', 'auction', 'paint', 'tradein']);
  call(5, 'parts/open', { caseId: 'scrap', count: 1 });
  call(5, 'wash/hand', { carId: car.id });
  setLevel(5, 10);
  assert.equal(call(5, 'me').unlocked.length, S.UNLOCKS.length);
  call(5, 'casino/slots', { amount: 10000 });
});

test('quests: a locked player never gets a daily or weekly task for a locked feature', () => {
  const { mk, call, advance } = setup();
  for (let d = 0; d < 20; d++) {
    const id = mk(100 + d);
    advance(86400e3);
    const keys = call(id, 'quests').list.map((x) => x.key);
    for (const k of keys) assert.ok(!S.QUESTS[k].feature, `daily ${k} for a level-1 player`);
    const wk = call(id, 'weekly').list.map((x) => x.key);
    for (const k of wk) assert.ok(!S.WEEKLY_QUESTS[k].feature, `weekly ${k} for a level-1 player`);
    assert.equal(keys.length, 3);
    assert.equal(wk.length, S.WEEKLY_COUNT);
  }
});

test('newbie chain: a locked step says when it opens', () => {
  const { mk, call, db } = setup();
  mk(6);
  db.prepare("UPDATE users SET newbie_step = ?, newbie_flags = '[]' WHERE id = 6").run(S.NEWBIE_TASKS.findIndex((t) => t.key === 'install'));
  const nb = call(6, 'me').newbie;
  assert.equal(nb.key, 'install');
  assert.equal(nb.lockedTill, 2);
  db.prepare('UPDATE users SET level = 2 WHERE id = 6').run();
  assert.equal(call(6, 'me').newbie.lockedTill, 0);
});

test('staff: the owner and admins are never locked; a helper is', () => {
  const { mk, call, db, casinoOn } = setup();
  casinoOn();
  mk(1);
  mk(2);
  mk(3);
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 2").run();
  db.prepare("UPDATE users SET role = 'helper' WHERE id = 3").run();
  assert.equal(call(1, 'me').unlocked.length, S.UNLOCKS.length);
  assert.equal(call(2, 'me').unlocked.length, S.UNLOCKS.length);
  assert.deepEqual(call(3, 'me').unlocked, []);
  call(2, 'casino/slots', { amount: 10000 });
  assert.throws(() => call(3, 'casino/slots', { amount: 10000 }), /рівні 10/);
});

test('deals: you cannot send a trade or a room invite to a player who has not opened trades', () => {
  const { mk, call, setLevel } = setup();
  mk(7);
  mk(8);
  setLevel(7, 5);
  call(7, 'case/open', { caseId: 'starter' });
  const car = call(7, 'me').cars[0];
  assert.throws(() => call(7, 'trade/create', { to: 8, give: [car.id], getMoney: 0 }), /ще не відкриті «Обміни»/);
  assert.throws(() => call(7, 'room/invite', { to: 8 }), /ще не відкриті «Обміни»/);
});

test('casino switch: owner only; off hides it for everyone (staff too), refuses bets, settles running mines; wheel keeps only roulette', () => {
  const { mk, call, setLevel, owner, g, db } = setup();
  mk(1);
  mk(9);
  mk(10);
  setLevel(9, 12);
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 10").run();
  assert.equal(owner('settings').casino, 'off', 'off by default since 22.10');
  owner('casino-mode', { mode: 'on' });
  // A running mines game when the switch goes off.
  call(9, 'casino/mines/start', { amount: 10000, mines: 3 });
  assert.throws(() => g.adminCall('tg:10', 'casino-mode', { mode: 'off', reason: 'тест', confirm: true }), /лише власник/);
  assert.throws(() => owner('casino-mode', { mode: 'maybe' }), /Невідомий режим/);
  const bal = () => db.prepare('SELECT balance FROM users WHERE id = 9').get().balance;
  const before = bal();
  assert.equal(owner('casino-mode', { mode: 'off' }).settled, 1);
  assert.equal(bal(), before + 10000, 'the untouched mines game gives the bet back');
  assert.equal(call(9, 'casino/mines/state').game, null);
  for (const id of [1, 9, 10]) {
    const me = call(id, 'me');
    assert.equal(me.casino, 'off');
    assert.ok(!me.unlocked.includes('casino'), `casino open for ${id}`);
  }
  for (const id of [1, 9]) assert.throws(() => call(id, 'casino/slots', { amount: 10000 }), /Казино вимкнено/);
  assert.throws(() => call(9, 'casino/crash/start', { amount: 10000 }), /Казино вимкнено/);
  // Upgrade is not part of the casino.
  assert.ok(call(9, 'me').unlocked.includes('upgrade'));
  owner('casino-mode', { mode: 'wheel' });
  assert.ok(call(9, 'me').unlocked.includes('casino'));
  call(9, 'casino/roulette', { bets: [{ on: 'red', amount: 10000 }] });
  assert.throws(() => call(9, 'casino/slots', { amount: 10000 }), /лише рулетка/);
  assert.throws(() => call(1, 'casino/crash/start', { amount: 10000 }), /лише рулетка/);
  owner('casino-mode', { mode: 'on' });
  call(9, 'casino/slots', { amount: 10000 });
  const st = owner('settings');
  assert.equal(st.casinoSaved, 'on');
  assert.deepEqual(st.history.map((h) => h.details.to), ['on', 'wheel', 'off', 'on']);
});

test('grandfathering: the feats backfill keeps what an existing player used; level 5+ keeps everything', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtodrop-unlock-'));
  const file = path.join(dir, 'g.db');
  try {
    let db = openDb(file);
    const { mk, call, setLevel, casinoOn } = setup(db, { allUnlocked: true }); // "before the ladder": everything open
    casinoOn();
    for (const id of [21, 22, 23, 24]) mk(id);
    setLevel(22, 5);
    setLevel(23, 3);
    call(21, 'case/open', { caseId: 'starter' });
    call(21, 'plate/generate', { gen: 'basic' });
    call(21, 'casino/crash/start', { amount: 10000 });
    const car = call(21, 'me').cars[0];
    call(21, 'pvp/create', { carId: car.id, bet: S.PVP_MIN_BET });
    // Back to a database from before the ladder: no feats column yet.
    db.exec('ALTER TABLE users DROP COLUMN feats');
    db.close();
    db = openDb(file);
    const feats = (id) => JSON.parse(db.prepare('SELECT feats FROM users WHERE id = ?').get(id).feats);
    assert.deepEqual(feats(21).sort(), ['casino', 'plates', 'pvp']);
    // The backfill lists the features of its day; later ones (the wash, «Заїзд дня», level 2) open by level anyway.
    assert.deepEqual(feats(22).sort(), S.UNLOCKS.map((u) => u.key).filter((k) => k !== 'wash' && k !== 'dayrace').sort());
    assert.deepEqual(feats(23).sort(), ['casino', 'upgrade'], 'untraceable games stay open from level 3');
    assert.deepEqual(feats(24), []);
    // With the ladder on: 21 (level 1) keeps plates, PvP and the casino, nothing else.
    const s2 = setup(db);
    assert.deepEqual(s2.call(21, 'me').unlocked, ['plates', 'pvp', 'casino']);
    s2.call(21, 'plate/generate', { gen: 'basic' });
    s2.call(21, 'casino/slots', { amount: 10000 });
    assert.throws(() => s2.call(21, 'market/sell', { carId: car.id, price: 1e6 }), /рівні 2/);
    // The casino switch still wins over grandfathering.
    s2.owner('casino-mode', { mode: 'off' });
    assert.throws(() => s2.call(21, 'casino/slots', { amount: 10000 }), /Казино вимкнено/);
    // An admin reset takes the grandfathered features away with the rest of the progress.
    s2.owner('reset', { id: 21 });
    assert.deepEqual(s2.call(21, 'me').unlocked, []);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('newbie order migration (V1 → V2 → «Перші кроки»): a player in the middle keeps his place and is not paid twice', () => {
  const db = openDb(':memory:');
  const a = setup(db);
  for (const id of [31, 32, 33]) a.mk(id);
  // Oldest order: open_starter, collect, part_case, install, race, win, plate, open_case, merge, level3.
  db.prepare('UPDATE users SET newbie_step = 3 WHERE id = 31').run(); // claimed open_starter, collect, part_case
  db.prepare('UPDATE users SET newbie_step = 7 WHERE id = 32').run(); // … install, race, win, plate
  db.prepare('UPDATE users SET newbie_step = 10 WHERE id = 33').run(); // all done
  db.prepare("DELETE FROM meta WHERE key = 'newbie_order_2'").run();
  db.prepare('UPDATE users SET prog_v = 0').run(); // rows from before «Перші кроки»
  const b = setup(db, { allUnlocked: true });
  const u = (id) => db.prepare('SELECT newbie_step, newbie_flags FROM users WHERE id = ?').get(id);
  // «Перші кроки»: open_starter, collect, race, daily, win, open_case, install, level3.
  assert.equal(S.NEWBIE_TASKS[u(31).newbie_step].key, 'race');
  assert.deepEqual(JSON.parse(u(31).newbie_flags), [], 'part_case is not a step any more');
  assert.equal(S.NEWBIE_TASKS[u(32).newbie_step].key, 'daily', 'the daily step is new for him (no daily bonus taken yet)');
  assert.deepEqual(JSON.parse(u(32).newbie_flags).sort(), ['nb:install', 'nb:win']);
  assert.equal(u(33).newbie_step, S.NEWBIE_TASKS.length, 'finished the old track — finished this one');
  // Runs once: a second start changes nothing.
  db.prepare('UPDATE users SET newbie_step = 3 WHERE id = 33').run();
  setup(db);
  assert.equal(u(33).newbie_step, 3);
  // 32 takes the daily bonus and claims the step; win was paid before → open_case is next; then install is skipped too.
  b.call(32, 'rewards/daily');
  b.call(32, 'newbie/claim');
  assert.equal(S.NEWBIE_TASKS[u(32).newbie_step].key, 'open_case');
  db.prepare('UPDATE users SET newbie_flags = ? WHERE id = 32').run(JSON.stringify([...JSON.parse(u(32).newbie_flags), 'open_case']));
  b.call(32, 'newbie/claim');
  assert.equal(S.NEWBIE_TASKS[u(32).newbie_step].key, 'level3');
});

test('level-up: the unlocks between two levels are what the popup lists', () => {
  assert.deepEqual(S.unlocksBetween(3, 4).map((u) => u.key), ['upgrade']);
  assert.deepEqual(S.unlocksBetween(2, 3).map((u) => u.key), ['pvp', 'battles']);
  assert.deepEqual(S.unlocksBetween(9, 10).map((u) => u.key), ['casino']);
  assert.deepEqual(S.unlocksBetween(10, 11), []);
  assert.equal(S.unlocksBetween(1, 10).length, S.UNLOCKS.length, 'nothing in the ladder sits at level 1 or above 10');
});
