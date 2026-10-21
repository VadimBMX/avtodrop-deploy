// race2: solo drag rivals are real cars, their odds mean what they say, and the money scales with the car.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

function setup(seed = 3) {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-21T09:00:00Z');
  const random = S.seededRand(seed);
  const g = createGame(db, { now: () => t, notify: () => {}, random, partCooldownMs: 0 });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e13, slots = 40, level = 99, level_seen = 99 WHERE id = 1').run();
  const fresh = (carId) => (db.prepare('DELETE FROM rivals').run(), g.api['race/rivals'](1, { carId }).list);
  return { db, g, fresh, advance: (ms) => (t += ms) };
}
const byId = (list) => Object.fromEntries(list.map((r) => [r.id, r]));
const regular = S.ALL_MODELS.filter((m) => !m.secret && !m.season);
const sample = (cls, n) => {
  const l = regular.filter((m) => m.cls === cls).sort((a, b) => a.price - b.price);
  return Array.from({ length: n }, (_, i) => l[Math.round((i * (l.length - 1)) / Math.max(1, n - 1))]);
};

test('race2: every rival is a real car whose shown power runs exactly its pace; the hard one is faster than your stock car, the easy one slower', () => {
  const { g, fresh } = setup();
  let hpUp = 0, n = 0;
  for (const m of regular) {
    const carId = g.giveCar(1, m.id).id;
    const own = S.carStats({ model: m.id });
    const r = byId(fresh(carId));
    assert.deepEqual(Object.keys(r), ['train', 'easy', 'mid', 'hard']);
    for (const x of Object.values(r)) {
      const rm = S.MODELS[x.model];
      assert.ok(rm && !rm.secret, `${m.name}: ${x.model}`);
      assert.ok(Math.abs(S.CLASS_ORDER.indexOf(rm.cls) - S.CLASS_ORDER.indexOf(m.cls)) <= 1, `${m.name} vs ${rm.name}: a neighbouring class at most`);
      const need = S.hpForBase(rm.kg, x.base, x.hp);
      assert.ok((need != null && Math.abs(need - x.hp) <= 0.5) || (need == null && x.tuned), `${m.name}: ${rm.name} shows ${x.hp} hp, needs ${need} for ${x.base}`);
      assert.equal(x.et, Math.round((x.base + 0.2) * 100) / 100);
    }
    assert.ok(r.hard.base < own.base, `${m.name}: hard rival ${r.hard.base} must be faster than ${own.base}`);
    assert.ok(r.easy.base > own.base && r.train.base > r.easy.base, `${m.name}: easy/training slower`);
    assert.ok(r.train.base > r.easy.base && r.easy.base > r.mid.base && r.mid.base > r.hard.base, `${m.name}: tiers in order`);
    if (r.hard.hp > own.hp) hpUp++;
    n++;
  }
  assert.ok(hpUp / n >= 0.9, `a hard rival shows more power than your car (${hpUp}/${n})`);
});

test('race2: a good driver in a stock car wins the easy rival ~90%, the medium ~55%, the hard ~22% (every class, real server runs)', () => {
  const { g, fresh } = setup(5);
  const band = { train: [0.9, 1], easy: [0.8, 0.97], mid: [0.42, 0.68], hard: [0.1, 0.34] };
  for (const cls of ['D', 'C', 'B', 'A', 'S']) {
    for (const m of sample(cls, 3)) {
      const carId = g.giveCar(1, m.id).id;
      const st = S.carStats({ model: m.id });
      const wins = {}, runs = {};
      for (let s = 0; s < 4; s++) {
        const rand = S.seededRand(100 + s);
        for (const r of fresh(carId)) {
          for (let i = 0; i < 150; i++) if (S.humanRun(st, S.DRIVERS.good, rand) < S.rivalRun(rand, r)) wins[r.id] = (wins[r.id] || 0) + 1;
          runs[r.id] = (runs[r.id] || 0) + 150;
        }
      }
      for (const id of Object.keys(band)) {
        const p = wins[id] / runs[id];
        assert.ok(p >= band[id][0] && p <= band[id][1], `${cls} ${m.name} ${id}: ${(p * 100).toFixed(0)}%`);
      }
    }
  }
});

test('race2: skill and parts push the odds up, but a full kit never makes the hard rival a sure win', () => {
  const { g, fresh } = setup(7);
  for (const id of ['vaz-2121-nyva', 'toyota-gr-yaris', 'bugatti-veyron-16-4']) {
    const m = S.MODELS[id];
    const tier = S.TIERS[S.minTierFor(m.cls)].id;
    const stock = g.giveCar(1, id).id, tuned = g.giveCar(1, id).id;
    for (const k of S.partKeysOf(id)) {
      g.addPart(1, k, tier, 1);
      g.api['parts/install'](1, { carId: tuned, type: k, tier });
    }
    const odds = (carId, d) => {
      const me = g.api.me(1).cars.find((c) => c.id === carId);
      const rand = S.seededRand(9);
      let w = 0, n = 0;
      for (let s = 0; s < 4; s++) {
        const hard = byId(fresh(carId)).hard;
        for (let i = 0; i < 150; i++, n++) if (S.humanRun({ base: me.base, shift: me.shift }, d, rand) < S.rivalRun(rand, hard)) w++;
      }
      return w / n;
    };
    const good = odds(stock, S.DRIVERS.good), perfect = odds(stock, S.DRIVERS.perfect), average = odds(stock, S.DRIVERS.average), kit = odds(tuned, S.DRIVERS.good);
    assert.ok(perfect > good + 0.15 && good > average, `${id}: perfect ${perfect} > good ${good} > average ${average}`);
    assert.ok(kit > good + 0.1 && kit < 0.7, `${id}: full kit ${kit} vs stock ${good}`);
  }
});

test('race2: prizes grow with the tier and with the car price; the expected money of a good driver is ~raceEv on every tier', () => {
  const cars = [...regular].sort((a, b) => a.price - b.price);
  for (let i = 1; i < cars.length; i++) {
    for (const op of [S.TRAINING, ...S.OPPONENTS]) assert.ok(S.raceMoney(op, cars[i].price).prize >= S.raceMoney(op, cars[i - 1].price).prize);
  }
  for (const price of [40000, 74000, 350000, 4e6, 23e6, 140e6, 300e6]) {
    const [tr, e, m, h] = [S.TRAINING, ...S.OPPONENTS].map((op) => S.raceMoney(op, price));
    assert.equal(tr.entry, 0);
    assert.ok(tr.prize < e.prize && e.prize < m.prize && m.prize < h.prize, `${price}: tiers pay more`);
    assert.ok(h.prize >= 5 * e.prize, `${price}: the hard rival is worth the risk`);
    for (const [op, x] of [[S.OPPONENTS[0], e], [S.OPPONENTS[1], m], [S.OPPONENTS[2], h]]) {
      assert.ok(x.entry > 0 && x.entry < x.prize);
      const ev = op.chance * x.prize - (1 - op.chance) * x.entry;
      assert.ok(Math.abs(ev / (op.ev * S.raceEv(price)) - 1) < 0.08, `${price} ${op.id}: EV ${ev}`);
    }
  }
});

test('race2: earning without cases is worthwhile but no farm — a full tank of good races is 1–5 cases of the class, and income/h rises with class', () => {
  const caseOf = { D: 'rust', C: 'city', B: 'sport', A: 'premium', S: 'elite' };
  for (const [cls, cs] of Object.entries(caseOf)) {
    const l = regular.filter((m) => m.cls === cls);
    const mid = l.sort((a, b) => a.price - b.price)[l.length >> 1];
    const tank = S.FUEL_MAX * S.raceEv(mid.price);
    const cases = tank / S.CASE_BY_ID[cs].price;
    assert.ok(cases >= 0.8 && cases <= 5, `${cls}: a tank = ${cases.toFixed(2)} × ${cs}`);
  }
  const med = (cls) => {
    const l = regular.filter((m) => m.cls === cls).sort((a, b) => a.price - b.price);
    return S.carIncomeOf({ model: l[l.length >> 1].id });
  };
  for (let i = 1; i < 5; i++) assert.ok(med(S.CLASS_ORDER[i]) > med(S.CLASS_ORDER[i - 1]), 'a dearer class earns more per car');
  // A day-1 garage (four typical D cars, ~250k) pays one 60k case in 3–5 hours of income (it was ~5 h).
  const h = S.CASE_BY_ID.rust.price / (4 * med('D'));
  assert.ok(h >= 2.5 && h <= 5, `starter garage: ${h.toFixed(1)} h per rust case`);
});

test('race2: the shown chance follows the player\'s own recent races', () => {
  const { g, fresh, advance } = setup(11);
  const carId = g.giveCar(1, 'vaz-2121-nyva').id;
  const before = byId(fresh(carId));
  for (let i = 0; i < 6; i++) {
    const st = g.api['race/start'](1, { carId, rival: 'train' });
    const run = honestDrag(st.car, st.greenMs, 0.13, ['perfect', 'perfect', 'perfect', 'perfect']);
    advance(Math.ceil(run.ms) + 50);
    g.api['race/finish'](1, { raceId: st.raceId, ...run.body });
    advance(25 * 60e3);
  }
  const after = byId(fresh(carId));
  assert.ok(after.hard.chance > before.hard.chance + 20, `perfect runs: hard ${before.hard.chance}% → ${after.hard.chance}%`);
  // Where the rivals stand does not depend on the player's skill.
  assert.ok(Math.abs(after.hard.base - before.hard.base) / before.hard.base < 0.01);
});

test('race2: a gearbox cuts the loss of a bad shift but keeps the gain of a perfect one', () => {
  const st = { base: 15, shift: 0.5 };
  assert.equal(S.raceTime(st, 0.2, ['perfect', 'perfect', 'perfect', 'perfect']), S.raceTime({ base: 15, shift: 0 }, 0.2, ['perfect', 'perfect', 'perfect', 'perfect']));
  assert.ok(S.raceTime(st, 0.2, ['late', 'late', 'late', 'late']) < S.raceTime({ base: 15, shift: 0 }, 0.2, ['late', 'late', 'late', 'late']));
});
