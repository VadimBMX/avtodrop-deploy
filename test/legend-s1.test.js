// Owner 06.11: the Season 1 top-10 (the places that got S.SEASON_PRIZES) each get a permanent «Легенда S1» car —
// ВАЗ-2101 «Копійка» with cars.legend = 1 — from the admin action 'season2/legend-cars', run once after the wipe.
// The car never leaves its owner (game.js isLockedCar / noLocked, db.js triggers); racing and painting stay allowed;
// it takes no garage slot; only an explicit admin player reset deletes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

const S1_T = Date.parse('2026-10-28T10:00:00Z');
const S2_T = Date.parse('2026-11-03T10:00:00Z');
const LOCK = /Легенда S1 — не продається і не передається/;
const get = (db, sql, ...a) => db.prepare(sql).get(...a);
const all = (db, sql, ...a) => db.prepare(sql).all(...a);
const run = (db, sql, ...a) => db.prepare(sql).run(...a);

// 13 Season 1 players: 1…12 by season XP (1 is first), 13 banned before the settlement (never placed); the wipe runs.
function world() {
  const clock = { t: S1_T };
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => clock.t, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [1000] });
  for (let id = 1; id <= 13; id++) {
    g.ensureUser({ id, first_name: 'U' + id });
    run(db, 'UPDATE users SET season_id = 1, season_xp = ? WHERE id = ?', 10000 - id * 10, id);
  }
  run(db, 'UPDATE users SET season_xp = 99999, banned = 1 WHERE id = 13');
  clock.t = S2_T;
  g.adminCall('key', 'season2/reset', { confirm: true, phrase: S.S2_RESET.phrase });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const grant = (body = {}) => g.adminCall('key', 'season2/legend-cars', { confirm: true, ...body });
  const legendOf = (uid) => get(db, 'SELECT * FROM cars WHERE owner_id = ? AND legend = 1', uid);
  const rich = (uid) => run(db, 'UPDATE users SET balance = 1e12, level = 99, level_seen = 99 WHERE id = ?', uid);
  return { db, g, clock, call, grant, legendOf, rich };
}

test('grant: refused before the wipe, then exactly the S1 prize places 1–10, once', () => {
  const db0 = openDb(':memory:');
  const g0 = createGame(db0, { now: () => S2_T, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [1000] });
  assert.throws(() => g0.adminCall('key', 'season2/legend-cars', { confirm: true }), /Спершу запусти Сезон 2/);
  assert.equal(get(db0, 'SELECT value FROM meta WHERE key = ?', S.LEGEND_CAR.meta), undefined, 'no flag before the wipe');

  const { db, g, grant, legendOf } = world();
  assert.equal(S.LEGEND_CAR.model, 'vaz-2101-kopiika');
  assert.ok(S.MODELS[S.LEGEND_CAR.model], 'the model is in S.MODELS');
  // the same list the prize stars went to: s1_archive places 1…S.SEASON_PRIZES.length
  const prize = all(db, 'SELECT user_id FROM s1_archive WHERE season_place BETWEEN 1 AND ? ORDER BY season_place', S.SEASON_PRIZES.length).map((r) => r.user_id);
  assert.deepEqual(prize, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(all(db, 'SELECT 1 FROM cars WHERE legend = 1').length, 0, 'the wipe itself gives nothing');
  // owner only, and a mutating action (confirm)
  assert.throws(() => g.adminCall('key', 'season2/legend-cars', {}), /не підтверджено/);
  const r = grant();
  assert.equal(r.already, false);
  assert.deepEqual(r.granted.map((x) => x.id), prize);
  const cars = all(db, 'SELECT owner_id, model, status FROM cars WHERE legend = 1 ORDER BY owner_id');
  assert.deepEqual(cars.map((c) => c.owner_id), prize);
  assert.ok(cars.every((c) => c.model === S.LEGEND_CAR.model && c.status === 'garage'));
  for (const uid of [11, 12, 13]) assert.equal(legendOf(uid), undefined, `player ${uid} is not in the prize top-10`);
  // the event
  for (const uid of prize) assert.ok(get(db, 'SELECT 1 FROM events WHERE user_id = ? AND text = ?', uid, S.LEGEND_CAR.event));
  assert.equal(S.LEGEND_CAR.event, '🏆 Легенда S1: ВАЗ-2101 «Копійка» — назавжди твоя');
  assert.ok(get(db, 'SELECT value FROM meta WHERE key = ?', S.LEGEND_CAR.meta));
  assert.equal(g.adminCall('key', 'season2', {}).legendCarsAt, S2_T, 'the admin page knows it was given');
  // the car on the card
  const me = g.api.me(1);
  assert.equal(me.cars.find((c) => c.model === S.LEGEND_CAR.model).legend, true);
  // a second run: nothing
  const r2 = grant();
  assert.equal(r2.already, true);
  assert.deepEqual(r2.granted, []);
  assert.equal(all(db, 'SELECT 1 FROM cars WHERE legend = 1').length, 10);
  assert.equal(all(db, 'SELECT 1 FROM events WHERE text = ?', S.LEGEND_CAR.event).length, 10);
  // even with the flag lost, nobody gets a second one
  run(db, 'DELETE FROM meta WHERE key = ?', S.LEGEND_CAR.meta);
  assert.deepEqual(grant().granted, []);
  assert.equal(all(db, 'SELECT 1 FROM cars WHERE legend = 1').length, 10);
});

test('grant: the season-2 wipe is untouched — season2.js has no legend-car code', () => {
  const src = fs.readFileSync(new URL('../src/season2.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /LEGEND_CAR|legend-cars|cars\.legend/);
});

test('every exit path refuses a legend car', () => {
  const { db, g, call, grant, legendOf, rich } = world();
  grant();
  rich(1);
  rich(2);
  const L = legendOf(1).id;
  const a = g.giveCar(1, 'vaz-2107').id, b = g.giveCar(1, 'vaz-2107').id, c = g.giveCar(1, 'vaz-2107').id;
  const o = g.giveCar(2, 'vaz-2107').id;
  g.giveCar(2, 'vaz-2107');
  const still = () => {
    const row = get(db, 'SELECT owner_id, status, legend FROM cars WHERE id = ?', L);
    assert.deepEqual({ ...row }, { owner_id: 1, status: 'garage', legend: 1 });
  };
  // sell, sell several (nothing of the batch is sold), quick sell
  assert.throws(() => call(1, 'sell', { carIds: [L] }), LOCK);
  assert.throws(() => call(1, 'sell', { carIds: [a, L] }), LOCK);
  assert.ok(get(db, 'SELECT 1 FROM cars WHERE id = ?', a), 'the batch is all-or-nothing');
  // market, auction
  assert.throws(() => call(1, 'market/sell', { carId: L, price: 100000 }), LOCK);
  assert.throws(() => call(1, 'auction/create', { carId: L, startPrice: 100000, hours: 1 }), LOCK);
  // trade-in and the upgrade burn
  assert.throws(() => call(1, 'dealer/tradein', { carIds: [L, a, b] }), LOCK);
  assert.throws(() => call(1, 'upgrade', { carIds: [L], target: 'bmw-m3-e30' }), LOCK);
  // a direct trade: neither offered nor asked for
  assert.throws(() => call(1, 'trade/create', { to: '2', give: [L] }), LOCK);
  assert.throws(() => call(2, 'trade/create', { to: '1', give: [o], get: [L] }), LOCK);
  // a trade room
  const { id } = call(1, 'room/create', {});
  call(2, 'room/join', { id });
  assert.throws(() => call(1, 'room/offer', { id, add: L }), LOCK);
  // the admin «remove car» (only the explicit player reset may take it)
  assert.throws(() => g.adminCall('key', 'remove-car', { carId: L, confirm: true, reason: 'test' }), LOCK);
  still();
  // the database itself refuses whatever path forgets the check: delete, new owner, market / auction status
  assert.throws(() => run(db, 'DELETE FROM cars WHERE id = ?', L), LOCK);
  assert.throws(() => run(db, 'DELETE FROM cars WHERE owner_id = 1'), LOCK);
  assert.throws(() => run(db, 'UPDATE cars SET owner_id = 2 WHERE id = ?', L), LOCK);
  assert.throws(() => run(db, "UPDATE cars SET status = 'market' WHERE id = ?", L), LOCK);
  assert.throws(() => run(db, "UPDATE cars SET status = 'auction' WHERE id = ?", L), LOCK);
  still();
  // the other cars still sell as before
  assert.ok(call(1, 'sell', { carIds: [c] }).got > 0);
  // the client hides the ways out
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(c\.legend\) return toast\(S\.LEGEND_CAR\.lockText, true\);/, 'sell mode: not selectable');
  assert.match(app, /if \(c\?\.legend\) return toast\(S\.LEGEND_CAR\.lockText, true\);/, 'the sell menu');
  assert.match(app, /!!m\.secret \|\| !!c\.legend \|\| c\.status !== 'garage'/, 'the «Продати» button is disabled');
  assert.match(app, /H\.sellCheap = [^\n]*\n\s*const ids = me\.cars\.filter\(\(c\) => c\.status === 'garage' && !M\(c\.model\)\.secret && !c\.legend\)/, '«продати дешевші» never picks it');
  assert.equal(S.LEGEND_CAR.lockText, 'Легенда S1 — не продається і не передається');
});

test('a legend car takes no garage slot; showcase is allowed (still his)', () => {
  const { db, g, call, grant, legendOf, rich } = world();
  grant();
  rich(1);
  run(db, 'UPDATE users SET slots = 2 WHERE id = 1');
  g.giveCar(1, 'vaz-2107');
  g.giveCar(1, 'vaz-2107');
  const me = g.api.me(1);
  assert.equal(me.cars.length, 3);
  assert.equal(me.used, 2, 'the legend car is not counted');
  // a full garage refuses the next case for the 2 normal cars, not for the legend
  assert.throws(() => call(1, 'case/open', { caseId: 'rust' }), /Гараж заповнений|місця/);
  run(db, 'UPDATE users SET slots = 3 WHERE id = 1');
  call(1, 'case/open', { caseId: 'rust' });
  assert.equal(g.api.me(1).used, 3);
  const L = legendOf(1).id;
  call(1, 'showcase', { carId: L, put: true });
  assert.equal(legendOf(1).status, 'showcase');
  call(1, 'showcase', { carId: L, put: false });
  assert.equal(legendOf(1).status, 'garage');
});

test('a legend car still races and gets painted; the admin player reset removes it', () => {
  const { db, g, clock, call, grant, legendOf, rich } = world();
  grant();
  rich(1);
  const L = legendOf(1).id;
  // race
  const st = call(1, 'race/start', { carId: L, rival: 'easy' });
  const r = honestDrag(st.car, st.greenMs, 0.2, Array(S.SHIFTS).fill('perfect'));
  clock.t += r.ms + 20;
  const fin = call(1, 'race/finish', { raceId: st.raceId, ...r.body });
  assert.equal(typeof fin.win, 'boolean');
  assert.equal(legendOf(1).id, L);
  // paint
  const color = S.PAINT_COLORS[0].id;
  call(1, 'car/paint', { carId: L, color });
  assert.equal(legendOf(1).paint, color);
  // tuning
  g.addPart(1, 'eng', 'street', 1);
  call(1, 'parts/install', { carId: L, type: 'eng', tier: 'street' });
  assert.equal(get(db, 'SELECT tier FROM car_parts WHERE car_id = ? AND type = ?', L, 'eng').tier, 'street');
  // the explicit admin player reset is the one way out
  g.adminCall('key', 'reset', { id: 1, confirm: true, reason: 'test' });
  assert.equal(legendOf(1), undefined);
  assert.equal(get(db, 'SELECT 1 FROM cars WHERE id = ?', L), undefined);
  // and another legend owner is unaffected
  assert.ok(legendOf(2));
});
