// «Престиж» (public/prestige.js, src/prestige.js): restyle ★1–★5 of A/S/secret cars for 0,2…3,2× the price (6,2× in
// all), +3% of that car's income per ★, one ★ per car per 24 h, open from level 10 with a garage ≥ 500 млн; the
// «Трофейна зала» (25 млн × 2,5^k, titles at 3/6/9); money only (no Stars); the ★ go with the car in trades and on the
// market, a dealer sale pays the usual class share; restyled cars stay out of the upgrade and the trade-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as P from '../public/prestige.js';

const plain = (m) => !m.secret && !m.edition && !m.homeOnly && !m.season && !S.isCollector(m.id);
const S_CAR = S.ALL_MODELS.filter((m) => m.cls === 'S' && plain(m)).sort((a, b) => b.price - a.price)[0];
const A_CAR = S.ALL_MODELS.filter((m) => m.cls === 'A' && plain(m))[0];
const B_CAR = S.ALL_MODELS.filter((m) => m.cls === 'B' && plain(m))[0];
const SECRET = S.ALL_MODELS.find((m) => m.secret && !m.season);
const H = 3600e3;

function setup() {
  let t = Date.parse('2026-11-02T10:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {} });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  // A late-game player: level 12, 40 slots, a garage of S cars well over 500 млн.
  const mk = (id, { level = 12, balance = 20e9, cars = 4 } = {}) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ?, slots = 40 WHERE id = ?').run(level, level, balance, id);
    const ids = Array.from({ length: cars }, () => g.giveCar(id, S_CAR.id).id);
    call(id, 'me'); // recalc → total_value
    return { id, cars: ids };
  };
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  const stars = (carId) => db.prepare('SELECT stars FROM car_restyle WHERE car_id = ?').get(carId)?.stars || 0;
  return { db, g, call, mk, bal, stars, add: (ms) => (t += ms), at: () => t };
}

test('rules: ★ costs 0,2/0,4/0,8/1,6/3,2 × price = 6,2×; +3%/★; trophies 25 млн × 2,5^k; A/S/secret only', () => {
  assert.deepEqual(P.PRESTIGE.mult, [0.2, 0.4, 0.8, 1.6, 3.2]);
  assert.equal(S.STAR_INCOME, 0.03);
  assert.equal(P.restyleCost(S_CAR.id, 0), Math.round(S_CAR.price * 0.2 / 1000) * 1000);
  assert.ok(Math.abs(P.restyleTotal(S_CAR.id) / S_CAR.price - 6.2) < 0.001);
  assert.equal(P.restyleCost(S_CAR.id, 5), null);
  assert.equal(P.TROPHIES.length, 10);
  assert.equal(P.TROPHIES[0].cost, 25e6);
  for (const t of P.TROPHIES) assert.ok(Math.abs(t.cost / (25e6 * 2.5 ** t.k) - 1) < 0.01, t.name);
  assert.ok(P.canRestyle(S_CAR.id) && P.canRestyle(A_CAR.id) && P.canRestyle(SECRET.id));
  assert.ok(!P.canRestyle(B_CAR.id));
  // Payback stays long (the bonus is not a new money printer): ★1 on an S car > 100 days.
  const clean = S.carIncomeOf({ model: S_CAR.id, parts: {} });
  assert.ok(P.starGain(S_CAR.id, 0, clean).days > 100);
});

test('opens at level 10 with a garage ≥ 500 млн and stays open; a notice the first time', () => {
  const T = setup();
  const low = T.mk(10, { level: 9 });
  assert.throws(() => T.call(low.id, 'prestige/restyle', { carId: low.cars[0] }), /10 рівня/);
  assert.equal(T.call(low.id, 'me').prestige.open, false);
  const poor = T.mk(11, { level: 12, cars: 0 });
  T.g.giveCar(poor.id, A_CAR.id);
  T.call(poor.id, 'me');
  assert.equal(T.call(poor.id, 'me').prestige.open, false);
  const u = T.mk(12);
  assert.ok(T.call(u.id, 'me').stats.value >= P.PRESTIGE.garage);
  assert.equal(T.call(u.id, 'me').prestige.open, true);
  assert.equal(T.db.prepare("SELECT COUNT(*) n FROM events WHERE user_id = ? AND text LIKE '%Відкрито «Престиж»%'").get(u.id).n, 1);
  T.call(u.id, 'me');
  assert.equal(T.db.prepare("SELECT COUNT(*) n FROM events WHERE user_id = ? AND text LIKE '%Відкрито «Престиж»%'").get(u.id).n, 1);
  // The garage shrinks under 500 млн: still open.
  T.call(u.id, 'sell', { carIds: u.cars.slice(1) });
  assert.ok(T.call(u.id, 'me').stats.value < P.PRESTIGE.garage);
  assert.equal(T.call(u.id, 'me').prestige.open, true);
  T.call(u.id, 'prestige/restyle', { carId: u.cars[0] });
});

test('money flow: a ★ costs exactly its price, destroyed in money_days/money_src; no money → nothing changes', () => {
  const T = setup();
  const u = T.mk(20);
  const day = () => T.db.prepare('SELECT COALESCE(SUM(destroyed), 0) n FROM money_days').get().n;
  const src = () => T.db.prepare("SELECT COALESCE(SUM(destroyed), 0) n FROM money_src WHERE src = 'prestige/restyle'").get().n;
  const b0 = T.bal(u.id), d0 = day();
  const r = T.call(u.id, 'prestige/restyle', { carId: u.cars[0] });
  assert.equal(r.stars, 1);
  assert.equal(r.cost, P.restyleCost(S_CAR.id, 0));
  assert.equal(T.bal(u.id), b0 - r.cost);
  assert.equal(day() - d0, r.cost);
  assert.equal(src(), r.cost);
  assert.equal(T.call(u.id, 'me').cars.find((c) => c.id === u.cars[0]).stars, 1);
  // Not enough hryvnias: refused, no ★, balance untouched.
  T.db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(1000, u.id);
  assert.throws(() => T.call(u.id, 'prestige/restyle', { carId: u.cars[1] }), /Недостатньо гривень/);
  assert.equal(T.stars(u.cars[1]), 0);
  assert.equal(T.bal(u.id), 1000);
  // All five ★ = 6,2× the price.
  const v = T.mk(21);
  T.db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(1e12, v.id);
  let paid = 0;
  for (let i = 0; i < 5; i++) {
    paid += T.call(v.id, 'prestige/restyle', { carId: v.cars[0] }).cost;
    T.add(24 * H);
  }
  assert.equal(paid, P.restyleTotal(S_CAR.id));
  assert.throws(() => T.call(v.id, 'prestige/restyle', { carId: v.cars[0] }), /максимум/);
  assert.equal(T.call(v.id, 'prestige').spent.restyle, paid);
});

test('one ★ per car per 24 h (other cars are not blocked)', () => {
  const T = setup();
  const u = T.mk(30);
  T.call(u.id, 'prestige/restyle', { carId: u.cars[0] });
  assert.throws(() => T.call(u.id, 'prestige/restyle', { carId: u.cars[0] }), /Майстерня ще працює/);
  T.call(u.id, 'prestige/restyle', { carId: u.cars[1] }); // another car: fine
  T.add(24 * H - 60e3);
  assert.throws(() => T.call(u.id, 'prestige/restyle', { carId: u.cars[0] }), /через 1 хв/);
  T.add(60e3);
  assert.equal(T.call(u.id, 'prestige/restyle', { carId: u.cars[0] }).stars, 2);
  assert.equal(T.stars(u.cars[0]), 2);
});

test('each ★ = +3% of that car\'s income; income before the ★ is banked at the old rate', () => {
  const T = setup();
  const u = T.mk(40, { cars: 2 }); // two cars of one country: no country bonus, no set
  const clean = S.carIncomeOf({ model: S_CAR.id, parts: {} });
  const rate0 = T.call(u.id, 'me').income.rate;
  assert.equal(rate0, Math.round(2 * clean));
  T.add(H);
  T.call(u.id, 'prestige/restyle', { carId: u.cars[0] });
  const me1 = T.call(u.id, 'me');
  assert.equal(me1.income.banked, Math.floor(2 * clean)); // the hour before at the old rate
  assert.equal(me1.income.rate, Math.round(clean * 1.03 + clean));
  T.add(24 * H);
  T.call(u.id, 'collect');
  T.call(u.id, 'prestige/restyle', { carId: u.cars[0] });
  assert.equal(T.call(u.id, 'me').income.rate, Math.round(clean * 1.06 + clean));
  // Client and server count the same (S.garageIncome reads car.stars).
  const me2 = T.call(u.id, 'me');
  const g = S.garageIncome({ cars: me2.cars.map((c) => ({ ...c, plateValue: 0, dirtAt: me2.now })), slots: me2.slots, t: me2.now });
  assert.equal(Math.round(g.rate), me2.income.rate);
  assert.ok(Math.abs(g.cars[u.cars[0]].star - 0.06) < 1e-9);
  assert.equal(g.cars[u.cars[1]].star, 0);
  // An hour of income with ★2 on one car: that car earns 6% more.
  T.add(H);
  const got = T.call(u.id, 'collect').got;
  assert.ok(Math.abs(got - (clean * 1.06 + clean)) <= 1, `${got}`);
});

test('★ stay with the car in a trade and on the market; a dealer sale pays the usual share and drops the ★', () => {
  const T = setup();
  const a = T.mk(50), b = T.mk(51);
  T.call(a.id, 'prestige/restyle', { carId: a.cars[0] });
  // Trade: a gives the ★ car to b.
  const { id } = T.call(a.id, 'trade/create', { to: String(b.id), give: [a.cars[0]], get: [] });
  T.call(b.id, 'trade/accept', { id });
  const got = T.call(b.id, 'me').cars.find((c) => c.id === a.cars[0]);
  assert.equal(got.stars, 1);
  assert.ok(T.call(b.id, 'me').income.rate > 0);
  // The ★ timer goes with the car too.
  assert.throws(() => T.call(b.id, 'prestige/restyle', { carId: a.cars[0] }), /Майстерня ще працює/);
  // Market: b sells it on, a buys it back — still ★1, shown on the lot.
  T.call(b.id, 'market/sell', { carId: a.cars[0], price: 1e9 });
  const lot = T.call(a.id, 'market/list').list.find((l) => l.car.id === a.cars[0]);
  assert.equal(lot.car.stars, 1);
  T.call(a.id, 'market/buy', { id: lot.id });
  assert.equal(T.call(a.id, 'me').cars.find((c) => c.id === a.cars[0]).stars, 1);
  // Dealer sale: the usual class share, nothing for the ★; the row is gone with the car.
  const before = T.bal(a.id);
  const car = T.call(a.id, 'me').cars.find((c) => c.id === a.cars[0]);
  const r = T.call(a.id, 'sell', { carIds: [a.cars[0]] });
  assert.equal(r.got, car.sell);
  assert.equal(r.got, S.sellPriceOf(S_CAR.id, Infinity, null));
  assert.equal(T.bal(a.id), before + r.got);
  assert.equal(T.db.prepare('SELECT COUNT(*) n FROM car_restyle WHERE car_id = ?').get(a.cars[0]).n, 0);
  assert.deepEqual(S.SELL_RATES, { D: 0.5, C: 0.45, B: 0.4, A: 0.35, S: 0.3, X: 0.3 });
});

test('a restyled car is refused by the upgrade and the trade-in; B cars and listed cars cannot be restyled', () => {
  const T = setup();
  const u = T.mk(60);
  T.call(u.id, 'prestige/restyle', { carId: u.cars[0] });
  const target = S.ALL_MODELS.filter((m) => m.cls === 'S' && plain(m) && m.price >= S_CAR.price * S.UPGRADE.minMult)[0];
  if (target) assert.throws(() => T.call(u.id, 'upgrade', { carIds: [u.cars[0]], target: target.id }), /рестайлінгу не йде/);
  assert.throws(() => T.call(u.id, 'dealer/tradein', { carIds: u.cars.slice(0, 3) }), /рестайлінгу не йде/);
  const b = T.g.giveCar(u.id, B_CAR.id).id;
  assert.throws(() => T.call(u.id, 'prestige/restyle', { carId: b }), /лише для машин класу A, S/);
  T.call(u.id, 'market/sell', { carId: u.cars[1], price: 1e9 });
  assert.throws(() => T.call(u.id, 'prestige/restyle', { carId: u.cars[1] }), /ринку або аукціоні/);
  // A secret car (a collection trophy) and a car on the showcase can.
  const sec = T.g.giveCar(u.id, SECRET.id).id;
  assert.equal(T.call(u.id, 'prestige/restyle', { carId: sec }).stars, 1);
  T.call(u.id, 'showcase', { carId: u.cars[2], put: true });
  assert.equal(T.call(u.id, 'prestige/restyle', { carId: u.cars[2] }).stars, 1);
});

test('trophy hall: in order, 25 млн × 2,5^k, titles at 3/6/9, full at 10; «Статок» counts garage + ★ + trophies', () => {
  const T = setup();
  const u = T.mk(70, { balance: 2e11 });
  let spent = 0;
  for (let k = 0; k < 10; k++) {
    const b0 = T.bal(u.id);
    const r = T.call(u.id, 'prestige/trophy');
    assert.equal(r.k, k);
    assert.equal(T.bal(u.id), b0 - P.TROPHIES[k].cost);
    spent += P.TROPHIES[k].cost;
    if (k + 1 === 3) assert.equal(r.title, 'Колекціонер');
    if (k + 1 === 4) assert.equal(r.title, null);
  }
  assert.throws(() => T.call(u.id, 'prestige/trophy'), /заповнена/);
  const badge = T.call(u.id, 'me').badges.find((b) => b.key === 'prestige');
  assert.equal(badge.title, 'Легенда АВТОДРОПу');
  assert.equal(T.db.prepare("SELECT COALESCE(SUM(destroyed), 0) n FROM money_src WHERE src = 'prestige/trophy'").get().n, spent);
  const r = T.call(u.id, 'prestige/restyle', { carId: u.cars[0] });
  const st = T.call(u.id, 'prestige');
  assert.equal(st.wealth, T.call(u.id, 'me').stats.value + spent + r.cost);
  const lb = T.call(u.id, 'leaderboard', { type: 'wealth' });
  assert.equal(lb.type, 'wealth');
  assert.equal(lb.list[0].id, u.id);
  assert.equal(lb.me.place, 1);
  assert.equal(lb.me.score, st.wealth);
  // Player card: trophies, title, the best restyled car.
  const other = T.mk(71);
  const card = T.call(other.id, 'player', { id: u.id });
  assert.equal(card.prestige.trophies, 10);
  assert.equal(card.prestige.best.stars, 1);
  // The usual boards still work.
  assert.equal(T.call(u.id, 'leaderboard', { type: 'all' }).type, 'all');
});

test('money only: no shop item buys ★ or trophies with Telegram Stars; the slot-first offer', () => {
  const T = setup();
  const u = T.mk(80);
  const shop = JSON.stringify(T.call(u.id, 'shop'));
  assert.ok(!/restyle|trophy|рестайл|трофе/i.test(shop));
  assert.throws(() => T.call(u.id, 'shop/stars', { item: 'restyle' }));
  // Cheap slot next to the balance → the app offers it first.
  T.db.prepare('UPDATE users SET slots = 20 WHERE id = ?').run(u.id);
  assert.equal(T.call(u.id, 'prestige').offer?.kind, 'slot');
  T.db.prepare('UPDATE users SET slots = 40, cap_level = 3 WHERE id = ?').run(u.id);
  assert.equal(T.call(u.id, 'prestige').offer, null);
  assert.deepEqual(P.firstOffer({ balance: 1e9, slots: 40, capLevel: 2 }), { kind: 'cap', cost: S.CAP_LEVELS[3].cost, hours: S.CAP_LEVELS[3].hours });
});
