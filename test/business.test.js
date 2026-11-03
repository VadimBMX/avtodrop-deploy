// «Мої бізнеси» (public/business.js, src/business.js): buy from the unlock level for ₴, income into a cash box capped
// at 4 h (8 h VIP, +1 h per «Персонал» step), «Зібрати» one / all, three branches × 5 steps and building levels 2/3
// (every branch ≥ 2 / ≥ 4), the Stars «Менеджер» (box uncapped, credited on the next call), the passive perks wired
// into fuel, wash, part cases and car sales (only while owned), `me.biz`, and every ₴ logged once in money_src.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as B from '../public/business.js';

const H = 3600e3;
const CAR = S.ALL_MODELS.find((m) => m.cls === 'B' && !m.secret && !m.edition && !m.homeOnly && !m.season && !m.restored && !S.isCollector(m.id));

function setup() {
  let t = Date.parse('2026-11-02T10:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {}, partCooldownMs: 0 });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const mk = (id, { level = 20, balance = 1e9 } = {}) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ?, slots = 20 WHERE id = ?').run(level, level, balance, id);
    return id;
  };
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  const src = (name) => db.prepare('SELECT COALESCE(SUM(created), 0) c, COALESCE(SUM(destroyed), 0) d FROM money_src WHERE src = ?').get(name);
  const one = (uid, id) => call(uid, 'biz').list.find((b) => b.id === id);
  return { db, g, call, mk, bal, src, one, add: (ms) => (t += ms), at: () => t };
}

test('rules: the four businesses, rate / cap / step costs from one config', () => {
  assert.deepEqual(B.BIZ.list.map((b) => [b.id, b.level, b.price, b.income]), [
    ['wash', 3, 2e6, 30000], ['gas', 5, 6e6, 80000], ['sto', 7, 15e6, 180000], ['salon', 10, 50e6, 500000]]); // S2: СТО 8 → 7, Автосалон 15 → 10 (S1 players reached L10 after ~18 h; L15 never in a 14-day season)
  assert.equal(B.rateOf({ id: 'wash', level: 1 }), 30000);
  assert.equal(B.rateOf({ id: 'wash', level: 2, eq: 1, ads: 1 }), Math.round(30000 * 1.25 * 1.14));
  assert.equal(B.rateOf({ id: 'wash', level: 1 }, 0.15), 34500); // the district hook multiplies in
  assert.equal(B.capHoursOf({ staff: 0 }, false), 4);
  assert.equal(B.capHoursOf({ staff: 2 }, true), 10);
  for (const k of B.BRANCH_KEYS) {
    const c = [0, 1, 2, 3, 4].map((s) => B.stepCost('gas', k, s));
    assert.ok(c.every((x, i) => i === 0 || x > c[i - 1]), k);
    assert.equal(B.stepCost('gas', k, 5), null);
  }
  assert.equal(B.buildCost('wash', 3), null);
  assert.equal(S.SHOP_BY_ID['bizmgr-wash'].stars, B.BIZ.manager.stars);
});

test('buy: level gate, money, once; the price leaves through biz/buy', () => {
  const T = setup();
  const low = T.mk(10, { level: 2 });
  assert.throws(() => T.call(low, 'biz/buy', { id: 'wash' }), /3-го рівня/);
  const poor = T.mk(11, { level: 5, balance: 1e6 });
  assert.throws(() => T.call(poor, 'biz/buy', { id: 'wash' }), /Недостатньо/);
  const u = T.mk(12, { level: 5, balance: 10e6 });
  assert.throws(() => T.call(u, 'biz/buy', { id: 'nope' }), /Невідомий/);
  assert.throws(() => T.call(u, 'biz/buy', { id: 'sto' }), /7-го рівня/);
  const r = T.call(u, 'biz/buy', { id: 'wash' });
  assert.equal(r.paid, 2e6);
  assert.equal(T.bal(u), 8e6);
  assert.throws(() => T.call(u, 'biz/buy', { id: 'wash' }), /уже твій/);
  assert.equal(T.src('biz/buy').d, 2e6);
  const list = T.call(u, 'biz').list;
  assert.equal(list.find((b) => b.id === 'gas').canBuy, true);
  assert.equal(list.find((b) => b.id === 'sto').unlocked, false);
});

test('the box fills over time, stops at 4 h (8 h with VIP); banked money is kept', () => {
  const T = setup();
  const u = T.mk(20);
  T.call(u, 'biz/buy', { id: 'wash' });
  T.add(2 * H);
  let b = T.one(u, 'wash');
  assert.equal(b.box, 60000);
  assert.equal(b.full, false);
  assert.equal(b.fullAt, T.at() + 2 * H);
  T.add(10 * H);
  b = T.one(u, 'wash');
  assert.equal(b.box, 120000);
  assert.equal(b.full, true);
  // VIP: the box holds 8 h, but the 8 h already passed don't turn into money afterwards (bought → banked first).
  T.db.prepare('UPDATE users SET stars = 1000 WHERE id = ?').run(u);
  T.call(u, 'shop/stars', { item: 'vip' });
  assert.equal(T.one(u, 'wash').box, 120000);
  assert.equal(T.one(u, 'wash').capH, 8);
  T.add(6 * H);
  assert.equal(T.one(u, 'wash').box, 240000);
});

test('collect one or all: the box goes to the balance once, logged as biz/collect', () => {
  const T = setup();
  const u = T.mk(21);
  T.call(u, 'biz/buy', { id: 'wash' });
  T.call(u, 'biz/buy', { id: 'gas' });
  const days0 = T.db.prepare('SELECT COALESCE(SUM(created), 0) c FROM money_days').get().c;
  T.add(1 * H);
  const b0 = T.bal(u);
  const r = T.call(u, 'biz/collect', { id: 'wash' });
  assert.equal(r.got, 30000);
  assert.equal(T.bal(u), b0 + 30000);
  assert.equal(T.call(u, 'biz/collect', { id: 'wash' }).got, 0); // a double tap gets nothing
  const all = T.call(u, 'biz/collect', { all: true });
  assert.equal(all.got, 80000);
  assert.equal(T.bal(u), b0 + 110000);
  assert.equal(T.src('biz/collect').c, 110000);
  assert.equal(T.db.prepare('SELECT COALESCE(SUM(created), 0) c FROM money_days').get().c - days0, 110000);
  assert.throws(() => T.call(u, 'biz/collect', { id: 'sto' }), /Спершу купи/);
});

test('upgrades: costs, max 5, «Персонал» lifts the cap, the building needs every branch ≥ 2 / ≥ 4', () => {
  const T = setup();
  const u = T.mk(22);
  T.call(u, 'biz/buy', { id: 'wash' });
  assert.throws(() => T.call(u, 'biz/upgrade', { id: 'wash', branch: 'xx' }), /Невідома гілка/);
  assert.throws(() => T.call(u, 'biz/upgrade', { id: 'gas', branch: 'eq' }), /Спершу купи/);
  assert.throws(() => T.call(u, 'biz/upgrade', { id: 'wash', branch: 'build' }), /всі гілки на 2/);
  for (let s = 0; s < 5; s++) {
    const b0 = T.bal(u);
    const r = T.call(u, 'biz/upgrade', { id: 'wash', branch: 'eq' });
    assert.equal(r.paid, B.stepCost('wash', 'eq', s));
    assert.equal(T.bal(u), b0 - r.paid);
  }
  assert.throws(() => T.call(u, 'biz/upgrade', { id: 'wash', branch: 'eq' }), /максимумі/);
  assert.equal(T.one(u, 'wash').rate, Math.round(30000 * 1.4));
  // An upgrade banks the box first: a full box doesn't grow from the time it stood still.
  T.add(10 * H);
  const full = T.one(u, 'wash').box;
  T.call(u, 'biz/upgrade', { id: 'wash', branch: 'staff' });
  assert.equal(T.one(u, 'wash').box, full);
  assert.equal(T.one(u, 'wash').capH, 5);
  T.call(u, 'biz/upgrade', { id: 'wash', branch: 'staff' });
  T.call(u, 'biz/upgrade', { id: 'wash', branch: 'ads' });
  assert.equal(T.one(u, 'wash').build.ready, false);
  T.call(u, 'biz/upgrade', { id: 'wash', branch: 'ads' });
  assert.equal(T.one(u, 'wash').build.ready, true);
  const r2 = T.call(u, 'biz/upgrade', { id: 'wash', branch: 'build' });
  assert.equal(r2.paid, B.buildCost('wash', 1));
  assert.equal(T.one(u, 'wash').lvl, 2);
  assert.throws(() => T.call(u, 'biz/upgrade', { id: 'wash', branch: 'build' }), /всі гілки на 4/);
  for (const k of ['staff', 'staff', 'ads', 'ads']) T.call(u, 'biz/upgrade', { id: 'wash', branch: k });
  T.call(u, 'biz/upgrade', { id: 'wash', branch: 'build' });
  const b = T.one(u, 'wash');
  assert.equal(b.lvl, 3);
  assert.equal(b.build.cost, null);
  assert.equal(b.rate, Math.round(30000 * 1.6 * (1 + 0.4 + 0.24)));
  assert.throws(() => T.call(u, 'biz/upgrade', { id: 'wash', branch: 'build' }), /максимального/);
  assert.ok(T.src('biz/upgrade').d > 0);
});

test('manager: only for an owned business; the box never caps and is credited on the next call (biz/manager)', () => {
  const T = setup();
  const u = T.mk(23);
  T.db.prepare('UPDATE users SET stars = 500 WHERE id = ?').run(u);
  assert.throws(() => T.call(u, 'shop/stars', { item: 'bizmgr-gas' }), /свій бізнес/);
  T.call(u, 'biz/buy', { id: 'wash' });
  T.add(10 * H); // a full box (4 h) before he comes: that part stays capped
  T.call(u, 'shop/stars', { item: 'bizmgr-wash' });
  assert.equal(T.db.prepare('SELECT stars FROM users WHERE id = ?').get(u).stars, 500 - B.BIZ.manager.stars);
  const b0 = T.bal(u);
  T.add(10 * H);
  const me = T.call(u, 'me');
  assert.equal(T.bal(u), b0 + 120000 + 300000); // the banked 4 h + 10 h uncapped
  assert.equal(me.biz[0].box, 0);
  assert.ok(me.biz[0].mgr > T.at());
  assert.equal(T.src('biz/manager').c, 420000);
  // After his 30 days the box caps again from his last day.
  T.add(31 * 24 * H);
  const b1 = T.bal(u);
  T.call(u, 'me');
  const paid = T.bal(u) - b1;
  assert.ok(Math.abs(paid - (30 * 24 - 10) * 30000) <= 1, String(paid));
  assert.equal(T.one(u, 'wash').box, 120000);
  assert.equal(T.one(u, 'wash').manager, 0);
});

test('me: compact biz state for the home screen', () => {
  const T = setup();
  const u = T.mk(24);
  assert.deepEqual(T.call(u, 'me').biz, []);
  T.call(u, 'biz/buy', { id: 'wash' });
  T.call(u, 'biz/buy', { id: 'gas' });
  T.add(5 * H);
  const me = T.call(u, 'me');
  assert.deepEqual(me.biz.map((b) => [b.id, b.lvl, b.box, b.rate, b.cap, b.full]), [['wash', 1, 120000, 30000, 120000, true], ['gas', 1, 320000, 80000, 320000, true]]);
  assert.equal(me.bizTotalBox, 440000);
});

test('perk «Заправка»: +1 tank and a faster refill — only when owned', () => {
  const T = setup();
  const u = T.mk(25), v = T.mk(26);
  T.call(u, 'biz/buy', { id: 'gas' });
  assert.equal(T.call(u, 'me').fuelMax, S.FUEL_MAX + 1);
  assert.equal(T.call(v, 'me').fuelMax, S.FUEL_MAX);
  for (const id of [u, v]) T.db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = ?').run(T.at(), id);
  T.add(S.FUEL_REGEN_MIN * 60e3 * 4); // 4 periods: 5 units at 1,25×
  assert.equal(T.call(u, 'me').fuel, 5);
  assert.equal(T.call(v, 'me').fuel, 4);
});

test('perk «Автомийка»: a wash shines 50% longer — only when owned', () => {
  const T = setup();
  const u = T.mk(27), v = T.mk(28);
  T.call(u, 'biz/buy', { id: 'wash' });
  const cu = T.g.giveCar(u, CAR.id).id, cv = T.g.giveCar(v, CAR.id).id;
  const su = T.call(u, 'wash/hand', { carId: cu }).shineUntil, sv = T.call(v, 'wash/hand', { carId: cv }).shineUntil;
  assert.equal(su - T.at(), S.WASH.shineHours * 1.5 * H);
  assert.equal(sv - T.at(), S.WASH.shineHours * H);
});

test('perk «СТО»: part cases −15% — only when owned', () => {
  const T = setup();
  const u = T.mk(29), v = T.mk(30);
  T.call(u, 'biz/buy', { id: 'sto' });
  T.g.giveCar(u, CAR.id);
  T.g.giveCar(v, CAR.id);
  const price = S.PART_CASE_BY_ID.scrap.price;
  let b = T.bal(u);
  T.call(u, 'parts/open', { caseId: 'scrap', count: 1 });
  const paidU = b - T.bal(u);
  b = T.bal(v);
  T.call(v, 'parts/open', { caseId: 'scrap', count: 1 });
  const paidV = b - T.bal(v);
  // Auto-sell is off, so the balance only moved by the price.
  assert.equal(paidV, price);
  assert.equal(paidU, Math.round((price * 0.85) / 100) * 100);
});

test('perk «Автосалон»: +2% (S2; S1 +5%) on a car sale and on the car.sell shown — only when owned', () => {
  const T = setup();
  const u = T.mk(31), v = T.mk(32);
  T.call(u, 'biz/buy', { id: 'salon' });
  const [cu] = [T.g.giveCar(u, CAR.id).id, T.g.giveCar(u, CAR.id).id];
  const [cv] = [T.g.giveCar(v, CAR.id).id, T.g.giveCar(v, CAR.id).id];
  T.add(48 * H); // past the fresh-sale window
  const base = S.sellPriceOf(CAR.id, 48 * H, null);
  assert.equal(T.call(u, 'me').cars.find((c) => c.id === cu).sell, Math.floor(base * (1 + B.BIZ.perks.salonSell)));
  assert.equal(T.call(v, 'me').cars.find((c) => c.id === cv).sell, base);
  assert.equal(T.call(u, 'sell', { carIds: [cu] }).got, Math.floor(base * (1 + B.BIZ.perks.salonSell)));
  assert.equal(T.call(v, 'sell', { carIds: [cv] }).got, base);
});
