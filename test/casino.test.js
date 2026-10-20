import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const pay = (b, m) => Math.floor(Math.round(b * m * 100) / 100);

function setup(t0 = Date.parse('2026-10-14T10:00:00Z')) {
  const db = openDb(':memory:');
  let t = t0;
  const g = createGame(db, { now: () => t });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const balance = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  // High level so level-up gifts (from casino XP) don't disturb exact balance checks.
  const setBalance = (uid, n) => db.prepare('UPDATE users SET balance = ?, slots = 40, level = 99 WHERE id = ?').run(n, uid);
  g.ensureUser({ id: 1, first_name: 'A' });
  return { db, g, call, balance, setBalance, clock: { advance: (ms) => (t += ms) } };
}

test('regions: every generated plate uses an official region code', () => {
  const { call, setBalance } = setup();
  setBalance(1, 1e10);
  for (let i = 0; i < 60; i++) {
    const { plate } = call(1, 'plate/generate', { gen: ['basic', 'better', 'pretty'][i % 3] });
    assert.ok(S.REGIONS[plate.text.slice(0, 2)], plate.text);
    assert.equal(plate.region, S.REGIONS[plate.text.slice(0, 2)]);
    assert.match(plate.text, new RegExp(`^[${S.PLATE_LETTERS}]{2} \\d{4} [${S.PLATE_LETTERS}]{2}$`));
  }
});

test('upgrade: chance formula, win gives target, loss burns cars but returns parts and plates', () => {
  const { g, call, setBalance, db } = setup();
  setBalance(1, 1e10);
  g.giveCar(1, 'vaz-2106');
  const stakeCar = g.giveCar(1, 'toyota-supra-a80').id;
  g.addPart(1, 'eng', 'sport', 1);
  call(1, 'parts/install', { carId: stakeCar, type: 'eng', tier: 'sport' });
  const target = S.ALL_MODELS.find((m) => !m.secret && m.price > S.MODELS['toyota-supra-a80'].price * 3);
  const r = call(1, 'upgrade', { carIds: [stakeCar], target: target.id });
  assert.equal(r.chance, S.upgradeChance(S.MODELS['toyota-supra-a80'].price, target.price));
  assert.equal(r.win, r.roll < r.chance);
  const cars = call(1, 'me').cars;
  assert.ok(!cars.some((c) => c.id === stakeCar), 'stake car is gone');
  assert.equal(cars.some((c) => c.model === target.id), r.win);
  assert.equal(call(1, 'me').parts.find((p) => p.type === 'eng').count, 1, 'installed part returned');
  void db;
});

test('upgrade: up to 6 cars, each extra car costs 1% of edge', () => {
  const { g, call } = setup();
  g.giveCar(1, 'vaz-2107');
  const ids = ['vaz-2106', 'zaz-lanos', 'fiat-uno', 'vaz-2109', 'zaz-sens', 'moskvych-412'].map((m) => g.giveCar(1, m).id);
  const stake = ['vaz-2106', 'zaz-lanos', 'fiat-uno', 'vaz-2109', 'zaz-sens', 'moskvych-412'].reduce((s, m) => s + S.MODELS[m].price, 0);
  const r = call(1, 'upgrade', { carIds: ids, target: 'toyota-supra-a80' });
  assert.equal(r.chance, S.upgradeChance(stake, S.MODELS['toyota-supra-a80'].price, 6));
  assert.ok(Math.abs(S.upgradeEdge(6) - 0.87) < 1e-9);
  assert.ok(S.upgradeChance(100, 1000, 1) > S.upgradeChance(100, 1000, 6));
});

test('upgrade: limits — target range, last car, at most 6 cars', () => {
  const { g, call } = setup();
  const only = g.giveCar(1, 'vaz-2107').id;
  assert.throws(() => call(1, 'upgrade', { carIds: [only], target: 'toyota-supra-a80' }), /хоча б одна машина/);
  const a = g.giveCar(1, 'vaz-2106').id;
  assert.throws(() => call(1, 'upgrade', { carIds: [a], target: 'vaz-2109' }), /щонайменше/);
  assert.throws(() => call(1, 'upgrade', { carIds: [a], target: 'bugatti-chiron-super-sport' }), /занадто дорога/);
  assert.throws(() => call(1, 'upgrade', { carIds: [a], target: S.SECRET_BY_COUNTRY.UA }), /ціль/);
  assert.throws(() => call(1, 'upgrade', { carIds: [1, 2, 3, 4, 5, 6, 7], target: 'toyota-supra-a80' }), /список/);
});

test('upgrade: observed win rate matches the shown chance', () => {
  const { g, call, setBalance } = setup();
  setBalance(1, 1e12);
  g.giveCar(1, 'vaz-2106');
  const target = S.ALL_MODELS.find((m) => !m.secret && m.price >= S.MODELS['vaz-2107'].price * 2);
  const chance = S.upgradeChance(S.MODELS['vaz-2107'].price, target.price);
  let wins = 0;
  const N = 600;
  for (let i = 0; i < N; i++) {
    const id = g.giveCar(1, 'vaz-2107').id;
    const r = call(1, 'upgrade', { carIds: [id], target: target.id });
    if (r.win) {
      wins++;
      call(1, 'sell', { carIds: [r.car.id] });
    }
  }
  // sd of the observed rate is ~0.02 here; 0.08 ≈ 4 sd keeps the test from flaking.
  assert.ok(Math.abs(wins / N - chance) < 0.08, `win rate ${wins / N} vs chance ${chance}`);
});

test('slots: payout matches the reels and the table', () => {
  const { call, setBalance, balance } = setup();
  setBalance(1, 1e9);
  for (let i = 0; i < 200; i++) {
    const before = balance(1);
    const r = call(1, 'casino/slots', { amount: 10000 });
    assert.equal(r.mult, S.slotPayout(r.reels));
    assert.equal(balance(1), before - 10000 + pay(10000, r.mult));
  }
});

test('slots: exact RTP from the pay table is ~95% with frequent small wins', () => {
  const W = S.SLOT_SYMBOLS.reduce((a, x) => a + x.w, 0);
  let rtp = 0, hit = 0;
  for (const a of S.SLOT_SYMBOLS) for (const b of S.SLOT_SYMBOLS) for (const c of S.SLOT_SYMBOLS) {
    const p = (a.w * b.w * c.w) / W ** 3, pay = S.slotPayout([a.s, b.s, c.s]);
    rtp += p * pay;
    if (pay) hit += p;
  }
  assert.ok(rtp > 0.93 && rtp < 0.97, `slots RTP ${rtp}`);
  assert.ok(hit > 0.15, `hit rate ${hit}`);
});

test('casino: simulated returns agree with theory (house keeps its edge)', () => {
  const { call, setBalance, balance } = setup();
  const START = 1e13;
  setBalance(1, START);
  // Slots have rare 1100x jackpots (sd ≈ 8 per spin), so the tolerance is ~4 standard errors.
  const N = 20000;
  for (let i = 0; i < N; i++) call(1, 'casino/slots', { amount: 10000 });
  const slotsRtp = (balance(1) - START + N * 10000) / (N * 10000);
  assert.ok(slotsRtp > 0.7 && slotsRtp < 1.2, `slots RTP ${slotsRtp}`);
  setBalance(1, START);
  const R = 8000;
  for (let i = 0; i < R; i++) call(1, 'casino/roulette', { bets: [{ on: 'red', amount: 10000 }] });
  const rouletteRtp = (balance(1) - START + R * 10000) / (R * 10000);
  assert.ok(rouletteRtp > 0.92 && rouletteRtp < 1.03, `roulette RTP ${rouletteRtp}`);
});

test('roulette: several numbers at the max bet each, limits per field and per spin', () => {
  const { call, setBalance, balance } = setup();
  setBalance(1, 64e9);
  const max = S.CASINO.maxBet;
  const r = call(1, 'casino/roulette', { bets: [7, 17, 23, 32].map((on) => ({ on, amount: max })) });
  assert.equal(r.total, 4 * max);
  assert.equal(balance(1), 64e9 - 4 * max + r.won);
  assert.throws(() => call(1, 'casino/roulette', { bets: [{ on: 7, amount: max + 1 }] }), /одне поле/);
  assert.throws(() => call(1, 'casino/roulette', { bets: [{ on: 7, amount: 1000 }, { on: 7, amount: 1000 }] }), /повторюються/);
  const five = Array.from({ length: 5 }, (_, i) => ({ on: i + 1, amount: 1000 }));
  assert.throws(() => call(1, 'casino/roulette', { bets: five }), /Максимум 4 поля/);
});

test('roulette: straight number pays 36x the stake, colours are correct', () => {
  const { call, setBalance, balance } = setup();
  setBalance(1, 1e9);
  for (let i = 0; i < 300; i++) {
    const before = balance(1);
    const r = call(1, 'casino/roulette', { bets: [{ on: 7, amount: 1000 }, { on: 'black', amount: 2000 }] });
    const expect = (r.number === 7 ? 36000 : 0) + (r.number > 0 && !S.ROULETTE_RED.includes(r.number) ? 4000 : 0);
    assert.equal(r.won, expect);
    assert.equal(balance(1), before - 3000 + expect);
    assert.equal(r.color, r.number === 0 ? 'green' : S.ROULETTE_RED.includes(r.number) ? 'red' : 'black');
  }
  assert.throws(() => call(1, 'casino/roulette', { bets: [{ on: 37, amount: 1000 }] }), /Число/);
  assert.throws(() => call(1, 'casino/roulette', { bets: [{ on: 'gold', amount: 1000 }] }), /Невідома/);
});

test('crash: cashout before the crash pays, after the crash loses, cannot claim more than server time', () => {
  const { call, setBalance, balance, clock } = setup();
  setBalance(1, 1e9);
  let won = 0, lost = 0;
  for (let i = 0; i < 150; i++) {
    const g = call(1, 'casino/crash/start', { amount: 10000 });
    assert.equal(g.point, null, 'crash point is hidden while running');
    clock.advance(4000); // ~1.32x
    const m = S.crashAt(4);
    const before = balance(1);
    const r = call(1, 'casino/crash/cashout', { id: g.id, at: 999 });
    if (r.status === 'won') {
      won++;
      assert.ok(r.cashout <= m, 'claimed multiplier capped at server multiplier');
      assert.ok(r.point > r.cashout);
      assert.equal(balance(1), before + pay(10000, r.cashout));
    } else {
      lost++;
      assert.ok(r.point <= m);
      assert.equal(balance(1), before);
    }
  }
  assert.ok(won > 0 && lost > 0);
});

test('crash: auto cashout pays at the target, starting twice is blocked', () => {
  const { call, setBalance, balance, clock } = setup();
  setBalance(1, 1e9);
  const g = call(1, 'casino/crash/start', { amount: 10000, auto: 1.1 });
  // ~3% of rounds crash instantly at 1.00x; only a still-running round blocks a new one.
  if (call(1, 'casino/crash/state', { id: g.id }).status === 'running') {
    assert.throws(() => call(1, 'casino/crash/start', { amount: 10000 }), /заверши/);
  }
  clock.advance(60000);
  const s = call(1, 'casino/crash/state', { id: g.id });
  if (s.point > 1.1) {
    assert.equal(s.status, 'won');
    assert.equal(s.cashout, 1.1);
    assert.equal(balance(1), 1e9 - 10000 + 11000);
  } else assert.equal(s.status, 'lost');
});

test('crash history reports the player outcome of every round, newest first', () => {
  const { call, setBalance, clock } = setup();
  setBalance(1, 1e9);
  const played = [];
  for (let i = 0; i < 12; i++) {
    const g = call(1, 'casino/crash/start', { amount: 10000 });
    clock.advance(3000); // ~1.23x
    // cash out on even rounds, let odd rounds ride until they crash
    const r = i % 2 === 0 ? call(1, 'casino/crash/cashout', { id: g.id }) : (clock.advance(600000), call(1, 'casino/crash/state', { id: g.id }));
    played.unshift({ point: r.point, status: r.status, cashout: r.cashout ?? null });
  }
  const { last } = call(1, 'casino/crash/history');
  assert.equal(last.length, 12);
  last.forEach((h, i) => {
    assert.equal(h.point, played[i].point);
    assert.equal(h.status, played[i].status);
    if (h.status === 'won') assert.ok(h.cashout < h.point, 'won rounds were cashed out before the crash');
    if (i % 2 === 0) assert.equal(h.status, 'lost', 'rounds left to ride are losses whatever the crash point');
  });
});

test('mines: hitting a mine loses, safe cells grow the multiplier, cashout pays', () => {
  const { call, setBalance, balance } = setup();
  setBalance(1, 1e9);
  let sawWin = false, sawLoss = false;
  for (let round = 0; round < 40; round++) {
    const g = call(1, 'casino/mines/start', { amount: 10000, mines: 3 });
    assert.equal(g.layout, null, 'mines hidden while running');
    let state = g;
    const before = balance(1);
    for (const cell of [0, 1, 2]) {
      state = call(1, 'casino/mines/reveal', { cell });
      if (state.status === 'lost') break;
    }
    if (state.status === 'lost') {
      sawLoss = true;
      assert.equal(state.layout.length, 3);
      assert.equal(balance(1), before);
    } else {
      assert.equal(state.mult, S.minesMult(3, 3));
      const r = call(1, 'casino/mines/cashout');
      sawWin = true;
      assert.equal(balance(1), before + pay(10000, S.minesMult(3, 3)));
      assert.ok(!r.layout.some((c) => [0, 1, 2].includes(c)));
    }
  }
  assert.ok(sawWin && sawLoss);
  assert.throws(() => call(1, 'casino/mines/start', { amount: 10000, mines: 2 }), /Кількість мін/);
});

test('casino: bet limits and balance checks', () => {
  const { call, setBalance } = setup();
  setBalance(1, 5000);
  assert.throws(() => call(1, 'casino/slots', { amount: 999 }), /Ставка/);
  assert.throws(() => call(1, 'casino/slots', { amount: 6000 }), /Недостатньо/);
  assert.throws(() => call(1, 'casino/slots', { amount: S.CASINO.maxBet + 1 }), /Ставка/);
});
