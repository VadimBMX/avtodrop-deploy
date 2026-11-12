// «Мої бізнеси» (public/business.js, src/business.js): buy from the unlock level for ₴, income into a cash box capped
// at 4 h (8 h VIP, +1 h per «Персонал» step), «Зібрати» one / all, three branches × 5 steps and building levels 2/3
// (every branch ≥ 2 / ≥ 4), the Stars «Менеджер» (box uncapped, credited on the next call), the passive perks wired
// into fuel, wash, part cases, car sales and (r13 «Шиномонтаж») grip / traction (only while owned), `me.biz`, and every ₴ logged once in money_src.
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

test('rules: the five businesses, rate / cap / step costs from one config', () => {
  assert.deepEqual(B.BIZ.list.map((b) => [b.id, b.level, b.price, b.income]), [
    ['wash', 3, 4e6, 60000], ['gas', 5, 12e6, 160000], ['sto', 7, 30e6, 360000], ['tire', 8, 50e6, 550000], ['salon', 10, 100e6, 1000000]]); // r13: «Шиномонтаж» opens (5th) // 06.11: prices ×2; // 05.11: income ×2 (growth 1,75 → 1,5). S2: СТО 8 → 7, Автосалон 15 → 10 (S1 players reached L10 after ~18 h; L15 never in a 14-day season)
  assert.equal(B.rateOf({ id: 'wash', level: 1 }), 60000);
  assert.equal(B.rateOf({ id: 'wash', level: 2, eq: 1, ads: 1 }), Math.round(60000 * 1.25 * 1.14));
  assert.equal(B.rateOf({ id: 'wash', level: 1 }, 0.15), 69000); // the district hook multiplies in
  assert.equal(B.capHoursOf({ staff: 0 }, false), 4);
  assert.equal(B.capHoursOf({ staff: 2 }, true), 10);
  for (const k of B.BRANCH_KEYS) {
    const c = [0, 1, 2, 3, 4].map((s) => B.stepCost('gas', k, s));
    assert.ok(c.every((x, i) => i === 0 || x > c[i - 1]), k);
    assert.equal(B.stepCost('gas', k, 5), null);
  }
  assert.equal(B.buildCost('wash', 3), null);
  assert.equal(S.SHOP_BY_ID['bizmgr-wash'].stars, B.BIZ.manager.stars);
  // r13: a «Менеджер» for every business, «Шиномонтаж» included
  assert.deepEqual(B.BIZ_SHOP_ITEMS.map((i) => i.biz), ['wash', 'gas', 'sto', 'tire', 'salon']);
  assert.equal(S.SHOP_BY_ID['bizmgr-tire'].stars, B.BIZ.manager.stars);
  assert.equal(B.bizOfItem('bizmgr-tire'), 'tire');
  assert.equal(B.PERK_TEXT.tire, 'свіжі шини: −0,05 с на старті драгу, +5% зчеплення в дрифті');
  assert.equal(B.BIZ_BY_ID.tire.name, 'Шиномонтаж «Протектор»');
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
  assert.equal(r.paid, 4e6);
  assert.equal(T.bal(u), 6e6);
  assert.throws(() => T.call(u, 'biz/buy', { id: 'wash' }), /уже твій/);
  assert.equal(T.src('biz/buy').d, 4e6);
  const list = T.call(u, 'biz').list;
  assert.equal(list.find((b) => b.id === 'gas').canBuy, false); // 12 млн > 6 млн left
  assert.equal(list.find((b) => b.id === 'sto').unlocked, false);
});

test('the box fills over time, stops at 4 h (8 h with VIP); banked money is kept', () => {
  const T = setup();
  const u = T.mk(20);
  T.call(u, 'biz/buy', { id: 'wash' });
  T.add(2 * H);
  let b = T.one(u, 'wash');
  assert.equal(b.box, 120000);
  assert.equal(b.full, false);
  assert.equal(b.fullAt, T.at() + 2 * H);
  T.add(10 * H);
  b = T.one(u, 'wash');
  assert.equal(b.box, 240000);
  assert.equal(b.full, true);
  // VIP: the box holds 8 h, but the 8 h already passed don't turn into money afterwards (bought → banked first).
  T.db.prepare('UPDATE users SET stars = 1000 WHERE id = ?').run(u);
  T.call(u, 'shop/stars', { item: 'vip' });
  assert.equal(T.one(u, 'wash').box, 240000);
  assert.equal(T.one(u, 'wash').capH, 8);
  T.add(6 * H);
  assert.equal(T.one(u, 'wash').box, 480000);
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
  assert.equal(r.got, 60000);
  assert.equal(T.bal(u), b0 + 60000);
  assert.equal(T.call(u, 'biz/collect', { id: 'wash' }).got, 0); // a double tap gets nothing
  const all = T.call(u, 'biz/collect', { all: true });
  assert.equal(all.got, 160000);
  assert.equal(T.bal(u), b0 + 220000);
  assert.equal(T.src('biz/collect').c, 220000);
  assert.equal(T.db.prepare('SELECT COALESCE(SUM(created), 0) c FROM money_days').get().c - days0, 220000);
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
  assert.equal(T.one(u, 'wash').rate, Math.round(60000 * 1.4));
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
  assert.equal(b.rate, Math.round(60000 * 1.6 * (1 + 0.4 + 0.24)));
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
  assert.equal(T.bal(u), b0 + 240000 + 600000); // the banked 4 h + 10 h uncapped
  assert.equal(me.biz[0].box, 0);
  assert.ok(me.biz[0].mgr > T.at());
  assert.equal(T.src('biz/manager').c, 840000);
  // After his 30 days the box caps again from his last day.
  T.add(31 * 24 * H);
  const b1 = T.bal(u);
  T.call(u, 'me');
  const paid = T.bal(u) - b1;
  assert.ok(Math.abs(paid - (30 * 24 - 10) * 60000) <= 1, String(paid));
  assert.equal(T.one(u, 'wash').box, 240000);
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
  assert.deepEqual(me.biz.map((b) => [b.id, b.lvl, b.box, b.rate, b.cap, b.full]), [['wash', 1, 240000, 60000, 240000, true], ['gas', 1, 640000, 160000, 640000, true]]);
  assert.equal(me.bizTotalBox, 880000);
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

// s2-qa: a «Менеджер» invoice paid when the player no longer owns that business (made before the Season 2 wipe) is
// recorded as a refund, not swallowed with nothing given.
test('manager: a paid invoice for a business not owned is a refund', () => {
  const { g, mk, db } = setup();
  mk(5);
  const r = g.creditItem({ chargeId: 'mgr-1', userId: 5, itemId: B.mgrItemId('gas'), stars: B.BIZ.manager.stars });
  assert.equal(r.refund, true);
  assert.equal(db.prepare('SELECT pack FROM payments WHERE charge_id = ?').get('mgr-1').pack, 'refund:' + B.mgrItemId('gas'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_business WHERE uid = 5').get().n, 0);
});

// r13: «Шиномонтаж «Протектор»» — the 5th business: level 8, 50 млн, 550 тис/год; its manager; fresh tyres.
const FAST = S.ALL_MODELS.find((m) => m.cls === 'S' && !m.secret && !m.edition && !m.homeOnly && !m.season && !m.restored && !S.isCollector(m.id) && S.carStats({ model: m.id }).slip > 0);
const near = (a, b) => Math.abs(a - b) < 0.0015; // base is rounded to 0.001 s

test('«Шиномонтаж»: level 8, buy, the box, collect, the manager', () => {
  const T = setup();
  const low = T.mk(40, { level: 7, balance: 100e6 });
  assert.throws(() => T.call(low, 'biz/buy', { id: 'tire' }), /8-го рівня/);
  const u = T.mk(41, { level: 8, balance: 60e6 });
  const card = T.one(u, 'tire');
  assert.deepEqual([card.owned, card.unlocked, card.canBuy, card.price, card.income, card.perk], [false, true, true, 50e6, 550000, B.PERK_TEXT.tire]);
  assert.equal(T.call(u, 'biz/buy', { id: 'tire' }).paid, 50e6);
  assert.equal(T.bal(u), 10e6);
  T.add(2 * H);
  assert.equal(T.one(u, 'tire').box, 1100000);
  T.add(10 * H);
  assert.equal(T.one(u, 'tire').box, 550000 * 4); // capped at 4 h
  const b0 = T.bal(u);
  assert.equal(T.call(u, 'biz/collect', { id: 'tire' }).got, 2200000);
  assert.equal(T.bal(u), b0 + 2200000);
  assert.deepEqual(T.call(u, 'me').biz.map((b) => b.id), ['tire']);
  T.db.prepare('UPDATE users SET stars = 500 WHERE id = ?').run(u);
  T.call(u, 'shop/stars', { item: 'bizmgr-tire' });
  assert.ok(T.one(u, 'tire').manager > T.at());
});

test('perk «Шиномонтаж» in S.carStats: −0,05 s off the drag base for every class, +5% drift grip, traction / slip untouched', () => {
  const pure = S.ALL_MODELS.filter((m) => !m.secret);
  for (const cls of ['D', 'C', 'B', 'A', 'S']) {
    const m = pure.find((x) => x.cls === cls);
    for (const parts of [{}, { wheels: 'race', suspension: 'race' }]) {
      if (!Object.keys(parts).every((k) => S.partKeysOf(m.id).includes(k))) continue;
      const a = S.carStats({ model: m.id, parts }), b = S.carStats({ model: m.id, parts, tire: true });
      assert.ok(near(a.base - b.base, B.BIZ.perks.tireLaunch), `${cls} ${a.base} → ${b.base}`);
      assert.ok(near(a.et - b.et, B.BIZ.perks.tireLaunch));
      assert.deepEqual([b.traction, b.slip, b.hp, b.kg], [a.traction, a.slip, a.hp, a.kg]);
      assert.equal(b.grip, Math.round(a.grip * 1.05 * 1000) / 1000);
    }
  }
  // The race-loss reasons count the launch on the owner's side only: a car that is 0,05 s quicker with the tyres says so.
  const m = pure.find((x) => x.cls === 'B');
  const why = S.raceWhy({ model: m.id, parts: {}, tire: true }, { model: m.id, parts: {} }, { time: 15, rivalTime: 14 });
  assert.deepEqual(why, []); // same hp: nothing about power to explain — and nothing that claims the tyres slowed the car
});

test('perk «Шиномонтаж»: the owner\'s drag (every class) and drift really use it, nobody else\'s', () => {
  const T = setup();
  const u = T.mk(42), v = T.mk(43);
  T.call(u, 'biz/buy', { id: 'tire' });
  for (const model of [CAR.id, FAST.id]) {
    const cu = T.g.giveCar(u, model).id, cv = T.g.giveCar(v, model).id;
    const mine = T.call(u, 'me').cars.find((c) => c.id === cu), theirs = T.call(v, 'me').cars.find((c) => c.id === cv);
    assert.equal(mine.tire, true);
    assert.equal(theirs.tire, undefined);
    assert.equal(theirs.base, S.carStats({ model }).base);
    assert.ok(near(theirs.base - mine.base, 0.05), `${model}: ${mine.base} vs ${theirs.base}`);
    assert.equal(mine.traction, theirs.traction);
    // The client's own S.carStats on the car it got says the same (tune / race-loss reasons).
    assert.equal(S.carStats(mine).base, mine.base);
    // Drag: the race fixes the faster base at the start; the rivals don't get the tyres.
    const ru = T.call(u, 'race/rivals', { carId: cu }), rv = T.call(v, 'race/rivals', { carId: cv });
    assert.equal(ru.car.base, mine.base);
    assert.equal(rv.car.base, theirs.base);
    T.call(u, 'race/start', { carId: cu, rival: 'easy' });
    const rec = JSON.parse(T.db.prepare('SELECT rival FROM races WHERE user_id = ? ORDER BY id DESC').get(u).rival);
    assert.equal(rec.me.base, mine.base);
    assert.ok(!('tire' in ru.list[0]));
    // Drift: a wider green zone; the rivals' targets (the par) stay the same as without the tyres.
    const du = T.call(u, 'drift/rivals', { carId: cu }), dv = T.call(v, 'drift/rivals', { carId: cv });
    assert.ok(du.model.half > dv.model.half && du.model.recover >= dv.model.recover && du.model.lat <= dv.model.lat);
    const parNo = S.driftPar(S.driftModel(S.carStats({ model })), S.driftTrack(du.track));
    assert.equal(du.par, Math.round(parNo));
    T.call(u, 'drift/start', { carId: cu, rival: 'train' });
    const run = JSON.parse(T.db.prepare('SELECT rival FROM drift_runs WHERE user_id = ? ORDER BY id DESC').get(u).rival);
    assert.deepEqual(run.model, du.model);
    T.db.prepare("UPDATE drift_runs SET status = 'expired'").run();
    T.db.prepare("UPDATE races SET status = 'expired'").run();
  }
  // perks in `me`
  assert.deepEqual([T.call(u, 'me').bizPerks.grip, T.call(u, 'me').bizPerks.launch], [1.05, 0.05]);
  assert.deepEqual([T.call(v, 'me').bizPerks.grip, T.call(v, 'me').bizPerks.launch], [1, 0]);
});

test('perk «Шиномонтаж»: buying it refreshes the cached race rivals (their odds follow the faster car)', () => {
  const T = setup();
  const u = T.mk(44);
  const c = T.g.giveCar(u, FAST.id).id;
  const before = T.call(u, 'race/rivals', { carId: c });
  T.call(u, 'biz/buy', { id: 'tire' });
  const after = T.call(u, 'race/rivals', { carId: c });
  assert.ok(after.car.base < before.car.base);
  const sig = T.db.prepare('SELECT sig FROM rivals WHERE user_id = ? AND car_id = ?').get(u, c).sig;
  assert.ok(sig.includes('tire'));
});
