// Career «Боси країн»: bosses open in order, the first win pays once, and a boss race is checked like any solo race.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

const byName = (n) => S.ALL_MODELS.find((m) => m.name === n && !m.secret).id;
// The quickest stock car a boss takes (class window, own country for a final).
const fitFor = (b) => S.ALL_MODELS.filter((m) => !m.secret && S.bossFits(b, m.id)).sort((x, y) => S.carStats({ model: x.id }).base - S.carStats({ model: y.id }).base)[0].id;
function setup(seed = 3) {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-21T09:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {}, random: S.seededRand(seed), partCooldownMs: 0 });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e9, slots = 40, level = 99, level_seen = 99 WHERE id = 1').run();
  const refuel = () => (db.prepare('UPDATE users SET fuel = ?, fuel_at = ? WHERE id = 1').run(S.FUEL_MAX, t), db.prepare('UPDATE cars SET tank = ?, tank_at = ?').run(S.CAR_TANK, t));
  const balance = () => db.prepare('SELECT balance FROM users WHERE id = 1').get().balance;
  // A boss race as the phone plays it: start, an honest run (perfect shifts unless told otherwise), finish on time.
  const race = (carId, boss, { reaction = 0.2, shifts = ['perfect', 'perfect', 'perfect', 'perfect'] } = {}) => {
    refuel();
    t += 61e3; // never trips the starts-a-minute limit
    const st = g.api['boss/start'](1, { carId, boss });
    const run = honestDrag(st.car, st.greenMs, reaction, shifts);
    t += run.ms + 50;
    return { st, res: g.api['race/finish'](1, { raceId: st.raceId, ...run.body }) };
  };
  // Marks bosses as beaten directly (to get far up the ladder quickly).
  const beat = (...ids) => ids.forEach((id) => db.prepare('INSERT INTO boss_runs (user_id, boss, tries, wins, beaten_at) VALUES (1, ?, 1, 1, ?) ON CONFLICT DO UPDATE SET beaten_at = excluded.beaten_at').run(id, t));
  return { db, g, race, beat, refuel, balance, advance: (ms) => (t += ms) };
}

test('boss: the ladder is real cars in order — every country ends on its final boss, pace and power are carStats of the boss car', () => {
  assert.deepEqual(S.BOSS_COUNTRIES, ['UA', 'JP', 'DE', 'CN', 'US', 'GB', 'IT']);
  assert.ok(S.BOSSES.length >= 21);
  for (const c of S.BOSS_COUNTRIES) {
    const bs = S.BOSSES.filter((b) => b.country === c);
    assert.ok(bs.length >= 3 && bs.length <= 5, c);
    assert.deepEqual(bs.map((b) => b.final), bs.map((_, i) => i === bs.length - 1), `${c}: only the last boss is the final`);
    for (const b of bs) {
      const m = S.MODELS[b.model];
      assert.equal(m.country, c, `${b.nick} drives a car of its country`);
      const st = S.carStats({ model: b.model, parts: b.kit ? Object.fromEntries(S.partKeysOf(b.model).map((k) => [k, b.kit])) : {} });
      assert.equal(b.base, st.base);
      assert.equal(b.hp, st.hp);
      assert.ok(S.BOSS_AI[b.ai] && S.CLASSES[b.req] && b.taunt.length > 10);
    }
    // Within a country each boss is faster than the one before.
    for (let i = 1; i < bs.length; i++) assert.ok(bs[i].base < bs[i - 1].base, `${bs[i].nick} faster than ${bs[i - 1].nick}`);
    const f = bs.at(-1).reward;
    assert.ok(f.caseId === 'c-' + c.toLowerCase() && f.plate && f.badge, `${c}: the final gives keys, a plate and the badge`);
  }
  assert.equal(new Set(S.BOSSES.map((b) => b.id)).size, S.BOSSES.length);
  assert.equal(new Set(S.BOSSES.map((b) => b.nick)).size, S.BOSSES.length);
});

test('boss: only the first boss is open; each win opens exactly the next one, across countries', () => {
  const { g, race, beat } = setup();
  const car = g.giveCar(1, fitFor(S.BOSSES[0])).id; // the UA bosses race D–C cars
  let l = g.api['boss/list'](1, { carId: car });
  assert.equal(l.next, S.BOSSES[0].id);
  assert.deepEqual(l.list.filter((x) => x.open).map((x) => x.id), [S.BOSSES[0].id]);
  assert.equal(l.beaten, 0);
  assert.throws(() => g.api['boss/start'](1, { carId: car, boss: S.BOSSES[1].id }), /попереднього боса/);
  assert.throws(() => g.api['boss/start'](1, { carId: car, boss: 'it-boss' }), /попереднього боса/);
  const { res } = race(car, S.BOSSES[0].id);
  assert.ok(res.win && res.boss.first);
  assert.equal(res.boss.next, S.BOSSES[1].id);
  l = g.api['boss/list'](1, { carId: car });
  assert.deepEqual(l.list.filter((x) => x.open).map((x) => x.id), [S.BOSSES[0].id, S.BOSSES[1].id]);
  assert.equal(l.next, S.BOSSES[1].id);
  // The last boss of Ukraine opens the first of Japan, and nothing further.
  const ua = S.BOSSES.filter((b) => b.country === 'UA');
  beat(...ua.slice(0, -1).map((b) => b.id));
  assert.throws(() => g.api['boss/start'](1, { carId: car, boss: S.BOSSES.find((b) => b.country === 'JP').id }), /попереднього боса/);
  assert.ok(race(g.giveCar(1, fitFor(ua.at(-1))).id, ua.at(-1).id).res.boss.first);
  l = g.api['boss/list'](1, { carId: car });
  const jp = S.BOSSES.filter((b) => b.country === 'JP');
  assert.equal(l.next, jp[0].id);
  assert.equal(l.list.find((x) => x.id === jp[1].id).open, false);
});

test('boss: the first win pays the reward once; rematches pay normal race money, a loss before the first win costs only fuel', () => {
  const { db, g, race, balance } = setup();
  const weak = g.giveCar(1, byName('Fiat 500')).id; // ~25 s: loses to Дід Панас
  const car = g.giveCar(1, byName('ЗАЗ Lanos')).id;
  const b = S.BOSSES[0];
  // A loss: no entry, no reward, nothing opens.
  let m0 = balance();
  const lost = race(weak, b.id).res;
  assert.equal(lost.win, false);
  assert.equal(lost.boss.first, false);
  assert.equal(balance(), m0);
  assert.equal(g.api['boss/list'](1, {}).list[1].open, false);
  // The first win: exactly the reward (money + parts), beaten_at set.
  const parts0 = db.prepare('SELECT COALESCE(SUM(count), 0) n FROM parts WHERE user_id = 1').get().n;
  m0 = balance();
  const first = race(car, b.id);
  assert.equal(first.st.rival.entry, 0);
  assert.ok(first.res.win && first.res.boss.first);
  assert.equal(first.res.prize, 0);
  assert.equal(balance() - m0, b.reward.money);
  assert.equal(db.prepare('SELECT COALESCE(SUM(count), 0) n FROM parts WHERE user_id = 1').get().n - parts0, b.reward.parts);
  const at = db.prepare("SELECT beaten_at FROM boss_runs WHERE user_id = 1 AND boss = ?").get(b.id).beaten_at;
  assert.ok(at > 0);
  // A rematch: an entry and a normal prize, no reward again.
  const st = g.api['boss/list'](1, { carId: car }).list[0];
  assert.ok(st.beaten && st.entry > 0 && st.prize > 0);
  m0 = balance();
  const again = race(car, b.id).res;
  assert.ok(again.win);
  assert.equal(again.boss.first, false);
  assert.equal(again.boss.reward, undefined);
  assert.equal(balance() - m0, again.prize);
  assert.ok(again.prize < b.reward.money);
  const row = db.prepare('SELECT * FROM boss_runs WHERE user_id = 1 AND boss = ?').get(b.id);
  assert.equal(row.beaten_at, at);
  assert.equal(row.wins, 2);
  assert.equal(row.tries, 3);
});

test('boss: a country final gives two keys of the country case, a plate and one career badge that the next country replaces', () => {
  const { db, g, race, beat } = setup();
  const keys = (cs) => db.prepare('SELECT COALESCE(SUM(count), 0) n FROM keys WHERE user_id = 1 AND case_id = ?').get(cs).n;
  const finals = ['UA', 'JP'].map((c) => S.BOSSES.filter((b) => b.country === c));
  for (const bs of finals) {
    beat(...bs.slice(0, -1).map((b) => b.id));
    const f = bs.at(-1), k0 = keys(f.reward.caseId);
    const res = race(g.giveCar(1, fitFor(f)).id, f.id).res;
    assert.ok(res.win && res.boss.first, f.nick);
    assert.equal(keys(f.reward.caseId) - k0, 2);
    const p = db.prepare('SELECT * FROM plates WHERE id = ?').get(res.boss.reward.plate.id);
    assert.equal(p.owner_id, 1);
    assert.equal(p.cls, f.reward.plate);
    const badges = db.prepare("SELECT * FROM badges WHERE user_id = 1 AND key = 'boss'").all();
    assert.equal(badges.length, 1);
    assert.equal(badges[0].title, S.BOSS_BADGES[f.country][0]);
  }
  assert.equal(g.api['boss/list'](1, {}).badge.title, S.BOSS_BADGES.JP[0]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM plates WHERE owner_id = 1').get().n, 2);
});

test('boss: validation — car class, own car, fuel, unknown boss; finished exactly like a solo race (early finish refused, no double finish)', () => {
  const { db, g, race, beat, refuel, advance } = setup();
  const d = g.giveCar(1, byName('ЗАЗ Lanos')).id;
  beat(...S.BOSSES.filter((b) => b.country === 'UA').map((b) => b.id));
  const jp = S.BOSSES.find((b) => b.country === 'JP');
  const s = g.giveCar(1, fitFor(jp)).id;
  assert.throws(() => g.api['boss/start'](1, { carId: d, boss: jp.id }), /потрібна машина класу C/);
  assert.throws(() => g.api['boss/start'](1, { carId: g.giveCar(1, byName('Bugatti Chiron Super Sport')).id, boss: jp.id }), /потрібна машина класу C/);
  assert.throws(() => g.api['boss/start'](1, { carId: s, boss: 'nobody' }), /Невідомий бос/);
  g.ensureUser({ id: 2, first_name: 'B' });
  const other = g.giveCar(2, byName('Bugatti Chiron Super Sport')).id;
  assert.throws(() => g.api['boss/start'](1, { carId: other, boss: jp.id }), /не твоє/);
  db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = 1').run(Date.parse('2026-10-21T09:00:00Z') + 1e9);
  assert.throws(() => g.api['boss/start'](1, { carId: s, boss: jp.id }), /Пальне 0\/15/);
  refuel();
  // No per-car tank any more: a car with an old empty cars.tank races all the same.
  db.prepare('UPDATE cars SET tank = 0, tank_at = ? WHERE id = ?').run(Date.parse('2026-10-21T09:00:00Z') + 1e9, s);
  // A start costs one fuel from the shared tank, like a race.
  const f0 = g.api.me(1).fuel;
  const st = g.api['boss/start'](1, { carId: s, boss: jp.id });
  assert.equal(g.api.me(1).fuel, f0 - 1);
  // The boss's exact time stays on the server; the client gets it rounded.
  assert.equal(st.rival.coarse, true);
  assert.equal(st.rival.base, jp.base);
  const run = honestDrag(st.car, st.greenMs, 0.2, ['perfect', 'perfect', 'perfect', 'perfect']);
  advance(1000);
  assert.throws(() => g.api['race/finish'](1, { raceId: st.raceId, ...run.body }), /ще не закінчився/);
  advance(run.ms);
  const res = g.api['race/finish'](1, { raceId: st.raceId, ...run.body });
  assert.ok(res.win && res.boss.first);
  assert.throws(() => g.api['race/finish'](1, { raceId: st.raceId, ...run.body }), /уже завершено/);
  // The boss's pace is the same whatever the player drives (parts on your car never make it faster).
  const tuned = g.giveCar(1, byName('Toyota Supra MK3')).id;
  for (const k of S.partKeysOf(byName('Toyota Supra MK3'))) g.addPart(1, k, 'race');
  for (const k of S.partKeysOf(byName('Toyota Supra MK3'))) g.api['parts/install'](1, { carId: tuned, type: k, tier: 'race' });
  const next = S.BOSSES[jp.n + 1];
  assert.equal(race(tuned, next.id).st.rival.base, next.base);
  assert.equal(race(s, next.id).st.rival.base, next.base);
});

test('boss: rematch money is a normal race — a sure win pays about an easy race of the cheaper car, never a farm', () => {
  for (const b of S.BOSSES) {
    for (const own of [S.MODELS[b.model].price / 3, S.MODELS[b.model].price, S.MODELS[b.model].price * 20]) {
      const price = Math.min(own, S.MODELS[b.model].price);
      const sure = S.bossRematch(1, price);
      // EV of a sure win (prize) stays ≤ ~1 race of that price, and around what the easy rival pays.
      assert.ok(sure.prize <= 1.05 * S.raceEv(price) + 1000, `${b.nick}: ${sure.prize} vs ${S.raceEv(price)}`);
      const easy = S.raceMoney(S.OPPONENTS[0], price).prize;
      assert.ok(Math.abs(sure.prize - easy) <= Math.max(0.2 * easy, 1000), `${b.nick}: sure ${sure.prize} ~ easy ${easy}`);
      // At any odds a good driver earns ≤ 1 raceEv per race.
      for (const p of [0.2, 0.3, 0.5, 0.7, 0.9]) {
        const m = S.bossRematch(p, price);
        assert.ok(p * m.prize - (1 - p) * m.entry <= 1.0 * S.raceEv(price) + 2000, `${b.nick} p=${p}`);
      }
    }
  }
  // The whole ladder's one-time money stays a small part of the late game (one country final ≤ ~2 h of an S garage).
  const total = S.BOSSES.reduce((s, b) => s + b.reward.money, 0);
  assert.ok(total < 150e6, `total ${total}`);
});
