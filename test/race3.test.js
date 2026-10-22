// Races, honest pass (night wave C): the shown chance ignores AFK runs and has honest floors, the rival roster shows
// real power, career bosses have class windows and a daily hard rematch, drift has a free training run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag, clientDrift } from './race-helpers.js';

const byName = (n) => S.ALL_MODELS.find((m) => m.name === n && !m.secret).id;
const byId = (list) => Object.fromEntries(list.map((r) => [r.id, r]));
function setup(seed = 3) {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-21T09:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {}, random: S.seededRand(seed), partCooldownMs: 0 });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12, slots = 60, level = 99, level_seen = 99 WHERE id = 1').run();
  const refuel = () => (db.prepare('UPDATE users SET fuel = ?, fuel_at = ? WHERE id = 1').run(S.FUEL_MAX, t), db.prepare('UPDATE cars SET tank = ?, tank_at = ?').run(S.CAR_TANK, t));
  const fresh = (carId) => (db.prepare('DELETE FROM rivals').run(), byId(g.api['race/rivals'](1, { carId }).list));
  // A solo drag race as the phone plays it: `reaction` s after green (1.5 = the car launched by itself), the shifts
  // wanted ('late' = left to the limiter).
  const drag = (carId, rival, reaction, shifts) => {
    refuel();
    t += 61e3;
    const st = g.api['race/start'](1, { carId, rival });
    const run = honestDrag(st.car, st.greenMs, reaction, shifts);
    t += Math.ceil(run.ms) + 50;
    return g.api['race/finish'](1, { raceId: st.raceId, ...run.body });
  };
  const AFK = [1.5, ['late', 'late', 'late', 'late']];
  return { db, g, refuel, fresh, drag, AFK, advance: (ms) => (t += ms), now: () => t };
}

test('chance: AFK runs (no own shifts) are ignored — after 4 or 6 of them Training still shows ≥85%, as for a new player', () => {
  const { g, fresh, drag, AFK } = setup();
  const car = g.giveCar(1, byName('BYD Dolphin')).id;
  const before = fresh(car);
  assert.ok(before.train.chance >= 85 && before.easy.chance >= 70, `new player: ${before.train.chance}/${before.easy.chance}`);
  for (let i = 0; i < 4; i++) drag(car, 'train', ...AFK);
  let r = fresh(car);
  assert.ok(r.train.chance >= 85, `after 4 AFK runs: Training ${r.train.chance}%`);
  assert.equal(r.easy.tough, undefined);
  for (let i = 0; i < 2; i++) drag(car, 'train', ...AFK);
  r = fresh(car);
  assert.ok(r.train.chance >= 85 && r.easy.chance >= 70, `after 6 AFK runs: ${r.train.chance}/${r.easy.chance}`);
  // A run with one own shift is not enough either (the limiter did the rest).
  for (let i = 0; i < 4; i++) drag(car, 'train', 0.9, ['early', 'late', 'late', 'late']);
  r = fresh(car);
  assert.ok(r.train.chance >= 85, `one-tap runs ignored: ${r.train.chance}%`);
});

test('chance: the median of the last 10 runs with ≥2 own shifts — perfect runs push it up, one awful run among them does not drag it down', () => {
  const { g, fresh, drag, AFK } = setup(5);
  const car = g.giveCar(1, byName('Toyota GR Yaris')).id;
  const base = fresh(car).hard.chance;
  const P = ['perfect', 'perfect', 'perfect', 'perfect'];
  for (let i = 0; i < 10; i++) drag(car, 'train', 0.13, P);
  const good = fresh(car).hard.chance;
  assert.ok(good > base + 15, `perfect form: hard ${base}% → ${good}%`);
  // One awful run with shifts (late start, early shifts) and a few AFK runs: the median holds.
  drag(car, 'train', 0.9, ['early', 'early', 'late', 'late']);
  for (let i = 0; i < 3; i++) drag(car, 'train', ...AFK);
  const after = fresh(car).hard.chance;
  assert.ok(Math.abs(after - good) <= 6, `median holds: ${good}% → ${after}%`);
});

test('chance: a weak driver who shifts sees floors on Training/Easy no higher than an average driver really wins; below 50% on Easy — «важко»', () => {
  const { g, fresh, drag } = setup(7);
  const car = g.giveCar(1, byName('Volkswagen Polo')).id;
  // Slow at the light and sloppy, but shifting himself: form well below a good driver.
  for (let i = 0; i < 6; i++) drag(car, 'train', 0.55, ['early', 'good', 'early', 'late']);
  const r = fresh(car);
  assert.ok(r.train.chance >= S.CHANCE_FLOOR.train, `training floor: ${r.train.chance}%`);
  // The floor is honest: an average driver in this car beats this very training rival at least that often.
  const me = g.api.me(1).cars.find((c) => c.id === car);
  const rand = S.seededRand(21);
  let w = 0;
  for (let i = 0; i < 1500; i++) if (S.humanRun({ base: me.base, shift: me.shift }, S.DRIVERS.average, rand) < S.rivalRun(rand, r.train)) w++;
  assert.ok(w / 1500 >= 0.85, `an average driver wins training ${(w / 15).toFixed(0)}%`);
  if (!r.easy.tough) assert.ok(r.easy.chance >= 50, `easy shows ${r.easy.chance}%`);
  // A driver who loses most runs to the easy rival: «важко — потренуйся», no number on Easy.
  for (let i = 0; i < 10; i++) drag(car, 'train', 1.2, ['early', 'early', 'early', 'late']);
  const bad = fresh(car);
  assert.equal(bad.easy.tough, true, `easy ${bad.easy.chance}%`);
  assert.ok(bad.easy.chance < S.RACE_FORM.toughBelow);
  assert.ok(bad.train.chance >= S.CHANCE_FLOOR.train, 'training keeps its floor');
});

test('roster: S-class rivals are different real cars with their factory power (±10%), never one model with invented horsepower', () => {
  const { g, fresh } = setup(9);
  const seen = new Set();
  for (const n of ['Hongqi S9', 'Bugatti Bolide', 'Ferrari Enzo', 'McLaren P1', 'Koenigsegg Jesko']) {
    const id = byName(n);
    for (const kit of [null, 'race']) {
      const carId = g.giveCar(1, id).id;
      if (kit) for (const k of S.partKeysOf(id)) (g.addPart(1, k, kit, 1), g.api['parts/install'](1, { carId, type: k, tier: kit }));
      const list = Object.values(fresh(carId));
      // Physics 22.10: a fully tuned hypercar outruns any car on factory power, so its rivals may be tuned like it —
      // never more power over the factory than the player's own car runs; the shown power is that kit's real power.
      const ownGain = S.carStats({ model: id, parts: kit ? Object.fromEntries(S.partKeysOf(id).map((k) => [k, kit])) : {} }).hp / S.MODELS[id].hp - 1;
      for (const r of list) {
        const m = S.MODELS[r.model];
        assert.equal(r.hp, S.carStats({ model: r.model, parts: r.parts }).hp);
        assert.ok(Math.abs(r.hp / m.hp - 1) <= Math.max(S.RIVAL_HP_DEV, ownGain) + 0.01, `${n}${kit ? '+' + kit : ''} vs ${m.name}: ${r.hp} hp, factory ${m.hp}`);
        if (!kit) assert.ok(Math.abs(r.hp / m.hp - 1) <= S.RIVAL_HP_DEV + 0.01, 'a stock car meets rivals on factory power ±10%');
        seen.add(r.model);
      }
      assert.ok(new Set(list.map((r) => r.model)).size >= 3, `${n}: at least 3 different cars in one list`);
    }
  }
  assert.ok(seen.size >= 10, `S rivals across lists: ${seen.size} models`);
});

test('roster: the rival race uses the shown driver — its runs are those of rivalDriver(skill) in the shown car', () => {
  const { g, fresh, drag } = setup(11);
  const car = g.giveCar(1, byName('BMW M3 E46')).id;
  const r = fresh(car).mid;
  assert.deepEqual(r.ai, S.rivalDriver(r.skill));
  const a = S.rivalRun(S.seededRand(4), r), b = S.humanRun({ base: r.base, shift: 0 }, S.rivalDriver(r.skill), S.seededRand(4));
  assert.equal(a, b);
  // The race record keeps the driver, so the server's rival time comes from it.
  const res = drag(car, 'mid', 0.2, ['good', 'good', 'good', 'good']);
  assert.ok(res.rivalTime > r.base && res.rivalTime < r.base + 3);
});

test('career windows: a boss takes only its class window, a final only a car of its country; one strong S car fits only the top bosses', () => {
  for (const b of S.BOSSES) {
    assert.ok(S.CLASSES[b.max] && S.rankOf(b.max) >= S.rankOf(b.req), `${b.nick}: window ${b.req}–${b.max}`);
    assert.equal(b.own, b.final);
    assert.ok(S.bossCarHint(b).length >= 1, `${b.nick}: some car fits`);
    for (const id of S.bossCarHint(b)) assert.ok(S.bossFits(b, id));
  }
  const sf90 = byName('Ferrari SF90 Stradale'), chiron = byName('Bugatti Chiron Super Sport');
  assert.ok(S.BOSSES.filter((b) => S.bossFits(b, sf90)).length <= 8, 'SF90 fits the top bosses only');
  assert.ok(S.BOSSES.filter((b) => S.bossFits(b, chiron)).length <= 8);
  assert.equal(S.bossFits(S.BOSS_BY_ID['ua-panas'], chiron), false);
  assert.equal(S.bossFits(S.BOSS_BY_ID['ua-panas'], byName('ЗАЗ Lanos')), true);
  // The Ukrainian final: a Ukrainian/Soviet car of D–C only; the Japanese final a Japanese car.
  const gen = S.BOSS_BY_ID['ua-general'], gz = S.BOSS_BY_ID['jp-godzilla'];
  assert.equal(S.bossFits(gen, byName('ЗАЗ Forza')), true);
  assert.equal(S.bossFits(gen, byName('Volkswagen Polo')), false);
  assert.equal(S.bossFits(gz, byName('Lexus IS F')), true);
  assert.equal(S.bossFits(gz, byName('BMW M3 E46')), false);
  assert.match(S.bossNeedText(gen), /українська чи радянська машина класу D–C/);
  assert.equal(S.bossWindowText(S.BOSS_BY_ID['de-bumer']), 'лише B');
  assert.equal(S.bossWindowText(S.BOSS_BY_ID['it-boss']), 'S і вище');
  // Every final can be won by some car of its country with its class kit (the Italian final stays the hardest).
  const kit = { D: 'street', C: 'sport', B: 'pro', A: 'pro', S: 'race', X: 'race' };
  for (const f of S.BOSSES.filter((b) => b.final && b.country !== 'IT')) {
    const best = Math.max(...S.ALL_MODELS.filter((m) => !m.secret && S.bossFits(f, m.id)).map((m) => {
      const st = S.carStats({ model: m.id, parts: Object.fromEntries(S.partKeysOf(m.id).map((k) => [k, kit[m.cls]])) });
      return S.oddsVs(S.driverTimes(st), S.bossOffsets(f), f.base);
    }));
    assert.ok(best >= 0.5, `${f.nick}: best own-country car ${Math.round(best * 100)}%`);
  }
});

test('career windows: the server refuses a car outside the window with the window in the message, and shows no chance for it', () => {
  const { g } = setup();
  const s = g.giveCar(1, byName('Bugatti Chiron Super Sport')).id, d = g.giveCar(1, byName('ЗАЗ Lanos')).id;
  assert.throws(() => g.api['boss/start'](1, { carId: s, boss: 'ua-panas' }), /потрібна машина класу D–C/);
  const l = g.api['boss/list'](1, { carId: s }).list[0];
  assert.equal(l.fits, false);
  assert.equal(l.chance, undefined);
  const ok = g.api['boss/list'](1, { carId: d }).list[0];
  assert.ok(ok.fits && ok.chance >= 0);
});

test('hard rematch: only after the first win, twice the rematch prize at the harder boss\'s odds, one win a day (a loss keeps it open)', () => {
  const { db, g, refuel, advance } = setup();
  const b = S.BOSS_BY_ID['ua-tolik'], hb = S.bossHard(b);
  assert.ok(hb.base < b.base && S.BOSS_AI[hb.ai].stars > S.BOSS_AI[b.ai].stars, 'harder: better kit, better driver');
  assert.equal(S.bossHard(S.BOSS_BY_ID['it-boss']).ai, 'champ');
  const car = g.giveCar(1, byName('ВАЗ-2105 VFTS')).id, weak = g.giveCar(1, byName('Fiat 500')).id;
  for (const x of S.BOSSES.slice(0, b.n)) db.prepare('INSERT INTO boss_runs (user_id, boss, tries, wins, beaten_at) VALUES (1, ?, 1, 1, 1)').run(x.id);
  assert.throws(() => g.api['boss/start'](1, { carId: car, boss: b.id, hard: true }), /після першої перемоги/);
  db.prepare('INSERT INTO boss_runs (user_id, boss, tries, wins, beaten_at) VALUES (1, ?, 1, 1, 1)').run(b.id);
  const row = g.api['boss/list'](1, { carId: car }).list.find((x) => x.id === b.id);
  assert.equal(row.hard.done, false);
  const normal = row.prize, hard = row.hard.prize;
  const good = S.driverTimes({ base: g.api.me(1).cars.find((c) => c.id === car).base, shift: 0 });
  const expect = S.bossRematch(S.oddsVs(good, S.bossOffsets(hb), hb.base), Math.min(S.MODELS[byName('ВАЗ-2105 VFTS')].price, S.MODELS[b.model].price));
  assert.equal(hard, expect.prize * S.BOSS_HARD.prizeMult);
  assert.equal(row.hard.entry, expect.entry);
  assert.ok(hard >= 2 * normal * 0.95, `hard ${hard} vs normal ${normal}`);
  const race = (carId) => {
    refuel();
    advance(61e3);
    const st = g.api['boss/start'](1, { carId, boss: b.id, hard: true });
    assert.equal(st.rival.hard, true);
    assert.equal(st.rival.base, hb.base);
    const run = honestDrag(st.car, st.greenMs, 0.13, ['perfect', 'perfect', 'perfect', 'perfect']);
    advance(Math.ceil(run.ms) + 50);
    return { st, res: g.api['race/finish'](1, { raceId: st.raceId, ...run.body }) };
  };
  // A loss (a car far too slow) costs the entry and keeps today's hard rematch open.
  const lost = race(weak).res;
  assert.equal(lost.win, false);
  assert.equal(lost.boss.hard, true);
  assert.equal(g.api['boss/list'](1, { carId: car }).list.find((x) => x.id === b.id).hard.done, false);
  const m0 = db.prepare('SELECT balance FROM users WHERE id = 1').get().balance;
  const { st, res } = race(car);
  assert.ok(res.win && res.boss.hard && !res.boss.first);
  assert.equal(res.prize, st.rival.prize);
  assert.equal(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance - m0, st.rival.prize);
  assert.equal(g.api['boss/list'](1, { carId: car }).list.find((x) => x.id === b.id).hard.done, true);
  refuel();
  advance(61e3);
  assert.throws(() => g.api['boss/start'](1, { carId: car, boss: b.id, hard: true }), /сьогодні вже виграно/);
  // The normal rematch stays open, and tomorrow the hard one again.
  assert.ok(g.api['boss/start'](1, { carId: car, boss: b.id }).raceId);
  advance(24 * 3600e3);
  assert.equal(g.api['boss/list'](1, { carId: car }).list.find((x) => x.id === b.id).hard.done, false);
});

test('drift training: free (no fuel, no entry, no dirt), no prize and no race counted — XP, quests and weekly tasks stay the same', () => {
  const { db, g, advance } = setup();
  const car = g.giveCar(1, 'vaz-2107').id;
  const d = g.api['drift/rivals'](1, { carId: car });
  assert.equal(d.train.id, 'train');
  assert.equal(d.train.entry, 0);
  assert.equal(d.train.prize, 0);
  assert.equal(d.train.target, Math.max(10, Math.round((d.par * S.DRIFT_TRAIN.share) / 10) * 10));
  assert.deepEqual(d.list.map((r) => r.id), ['easy', 'mid', 'hard']);
  const u0 = db.prepare('SELECT * FROM users WHERE id = 1').get(), c0 = db.prepare('SELECT * FROM cars WHERE id = ?').get(car);
  const wk0 = db.prepare('SELECT COALESCE(SUM(progress), 0) n FROM weekly_quests WHERE user_id = 1').get().n;
  const q0 = db.prepare('SELECT COALESCE(SUM(progress), 0) n FROM quests WHERE user_id = 1').get().n;
  const st = g.api['drift/start'](1, { carId: car, rival: 'train' });
  assert.equal(st.rival.training, true);
  const run = clientDrift(st, { skill: 0.9 });
  advance(S.DRIFT_COUNT_MS + run.ms);
  const r = g.api['drift/finish'](1, { runId: st.runId, ...run });
  assert.equal(r.training, true);
  assert.equal(r.prize, 0);
  assert.equal(r.score, run.score);
  const u1 = db.prepare('SELECT * FROM users WHERE id = 1').get(), c1 = db.prepare('SELECT * FROM cars WHERE id = ?').get(car);
  assert.equal(u1.balance, u0.balance);
  assert.equal(u1.fuel, u0.fuel);
  assert.equal(c1.tank, c0.tank);
  assert.equal(c1.dirt, c0.dirt);
  assert.equal(u1.races, u0.races);
  assert.equal(u1.wins, u0.wins);
  assert.equal(u1.season_xp, u0.season_xp);
  assert.equal(db.prepare('SELECT COALESCE(SUM(progress), 0) n FROM weekly_quests WHERE user_id = 1').get().n, wk0);
  assert.equal(db.prepare('SELECT COALESCE(SUM(progress), 0) n FROM quests WHERE user_id = 1').get().n, q0);
  // A paid run still costs fuel and counts.
  const paid = g.api['drift/start'](1, { carId: car, rival: 'easy' });
  assert.equal(db.prepare('SELECT fuel FROM users WHERE id = 1').get().fuel, u1.fuel - 1);
  assert.ok(paid.rival.entry > 0);
});

test('drift dots: 1–5, grip parts make a car hold better, power makes it faster but twitchier', () => {
  const dots = (model, tier) => S.driftDots(S.driftModel(S.carStats({ model, parts: tier ? { suspension: tier, wheels: tier } : {} })));
  for (const m of S.ALL_MODELS.filter((x) => !x.secret)) {
    const d = dots(m.id);
    assert.ok(d.hold >= 1 && d.hold <= 5 && d.speed >= 1 && d.speed <= 5, m.name);
  }
  const lada = byName('ВАЗ-2107'), hongqi = byName('Hongqi S9');
  assert.ok(dots(lada, 'race').hold > dots(lada).hold, 'grip kit holds better');
  assert.ok(dots(hongqi).speed > dots(lada).speed, 'a hypercar is faster');
  assert.ok(dots(hongqi).hold < dots(lada).hold, 'and its slide is sharper');
  assert.equal(dots(lada, 'race').hold, 5);
});
