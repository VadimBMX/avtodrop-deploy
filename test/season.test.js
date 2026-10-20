import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup(t0 = Date.parse('2026-10-21T10:00:00Z')) {
  const db = openDb(':memory:');
  let t = t0;
  const sent = [];
  const g = createGame(db, { now: () => t, notify: (uid, text) => sent.push([uid, text]), random: () => 0.5 });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, mk, call, sent, advance: (ms) => (t += ms), at: () => t };
}

test('season: dates and pass curve', () => {
  assert.equal(S.seasonOf(Date.parse('2026-10-21T10:00:00Z')), 1);
  assert.equal(S.seasonOf(Date.parse('2026-11-03T10:00:00Z')), 2);
  assert.equal(S.passLevel(0).level, 1);
  assert.equal(S.passLevel(S.passXpFor(1)).level, 2);
  let total = 0;
  for (let l = 1; l < S.SEASON.levels; l++) total += S.passXpFor(l);
  assert.equal(S.passLevel(total).level, S.SEASON.levels);
  assert.equal(S.passLevel(total * 2).level, S.SEASON.levels, 'never above the last level');
  assert.ok(total > 2000 * 10 && total < 2000 * 14, 'an active player finishes the pass in 10–14 days');
});

test('season: XP fills the pass, free rewards claimable, premium after buying with stars', () => {
  const { db, mk, call } = setup();
  mk(1);
  db.prepare('UPDATE users SET season_xp = ?, season_id = 1 WHERE id = 1').run(S.passXpFor(1) + S.passXpFor(2) + S.passXpFor(3) + S.passXpFor(4));
  let s = call(1, 'season');
  assert.equal(s.level, 5);
  assert.equal(s.ready, 4);
  const bal = call(1, 'me').balance;
  const r = call(1, 'season/claim');
  assert.equal(r.got.length, 4);
  const money = [2, 3, 4, 5].reduce((n, l) => n + S.passReward(1, l, false).money, 0);
  assert.equal(call(1, 'me').balance, bal + money);
  assert.equal(call(1, 'me').keys.city, 1, 'level 5 gives a «Міський» key');
  assert.throws(() => call(1, 'season/claim'), /Немає нових нагород/);
  // Premium from the stars on the account: the premium track of the levels already reached opens at once.
  assert.throws(() => call(1, 'shop/stars', { item: 'pass' }), /Недостатньо зірок/);
  db.prepare('UPDATE users SET stars = 300 WHERE id = 1').run();
  call(1, 'shop/stars', { item: 'pass' });
  assert.equal(call(1, 'me').stars, 300 - S.SEASON.premiumStars);
  assert.throws(() => call(1, 'shop/stars', { item: 'pass' }), /вже куплено/);
  s = call(1, 'season');
  assert.equal(s.premium, true);
  assert.equal(s.ready, 4);
  call(1, 'season/claim');
  assert.equal(call(1, 'me').keys.sport, 1, 'premium level 5 gives a «Спорткар» key');
});

test('season: the premium level-30 reward is the season car, which cannot be sold', () => {
  const { db, mk, call } = setup();
  mk(1);
  let total = 0;
  for (let l = 1; l < S.SEASON.levels; l++) total += S.passXpFor(l);
  db.prepare('UPDATE users SET season_xp = ?, season_id = 1, premium_season = 1, slots = 40 WHERE id = 1').run(total);
  call(1, 'case/open', { caseId: 'starter' });
  call(1, 'season/claim');
  const car = call(1, 'me').cars.find((c) => S.MODELS[c.model].season === 1);
  assert.ok(car, 'season car in the garage');
  assert.throws(() => call(1, 'sell', { carIds: [car.id] }), /Секретну машину/);
  assert.ok(!call(1, 'me').collection.filter((id) => !S.MODELS[id].secret).includes(car.model));
});

test('season: XP earned goes to the season counter; a new season starts it from zero and pays the rating', () => {
  const { db, mk, call, advance, sent } = setup();
  mk(1);
  mk(2);
  call(1, 'rewards/daily');
  call(2, 'rewards/daily');
  call(2, 'race/rivals', { carId: call(2, 'case/open', { caseId: 'starter' }).results[0].car.id });
  const xp1 = call(1, 'season').xp;
  assert.ok(xp1 > 0);
  db.prepare('UPDATE users SET season_xp = 5000 WHERE id = 2').run();
  const lb = call(1, 'leaderboard', { type: 'season' });
  assert.equal(lb.list[0].id, 2);
  assert.equal(lb.me.place, 2);
  advance(14 * 86400e3);
  assert.equal(call(1, 'season').xp, 0, 'new season, fresh pass');
  assert.equal(call(1, 'season').id, 2);
  assert.equal(call(2, 'me').stars, S.SEASON_PRIZES[0]);
  assert.equal(call(1, 'me').stars, S.SEASON_PRIZES[1]);
  assert.equal(call(2, 'me').badges[0].title, 'Чемпіон · Сезон 1');
  assert.ok(sent.some(([uid, text]) => uid === 2 && /Сезон 1: 1 місце/.test(text)));
  // Settled once.
  call(1, 'me');
  assert.equal(call(2, 'me').stars, S.SEASON_PRIZES[0]);
});

test('daily bonus: 14 days, a missed day does not reset the series', () => {
  const { mk, call, advance } = setup();
  mk(1);
  call(1, 'rewards/daily');
  advance(86400e3 * 3); // skipped two days
  const r = call(1, 'rewards/daily');
  assert.equal(r.streak, 2);
  assert.equal(call(1, 'rewards').days.length, 14);
  for (let i = 0; i < 12; i++) {
    advance(86400e3);
    call(1, 'rewards/daily');
  }
  advance(86400e3);
  assert.equal(call(1, 'rewards').nextDay, 1, 'after day 14 the series starts again');
});

test('VIP: bought for stars, longer income cap, faster fuel, daily bonus extra', () => {
  const { db, mk, call, advance, at } = setup();
  mk(1);
  db.prepare('UPDATE users SET stars = 1000 WHERE id = 1').run();
  const capBefore = call(1, 'me').income.capH;
  call(1, 'shop/stars', { item: 'vip' });
  const me = call(1, 'me');
  assert.equal(me.vip, true);
  assert.equal(me.income.capH, capBefore + S.VIP.extraHours);
  const bal = me.balance;
  const r = call(1, 'rewards/daily');
  assert.equal(r.reward.vip, S.VIP.daily);
  assert.equal(call(1, 'me').balance, bal + S.DAILY_BONUS[0].money + S.VIP.daily);
  db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = 1').run(at());
  advance(S.FUEL_REGEN_MIN * 60e3);
  assert.equal(call(1, 'me').fuel, 2, 'twice as fast');
  advance(S.VIP.days * 86400e3);
  assert.equal(call(1, 'me').vip, false);
});

test('shop: starter pack once, slot price doubles, refuel fills every tank', () => {
  const { db, mk, call, g } = setup();
  mk(1);
  db.prepare('UPDATE users SET stars = 2000, balance = 0, fuel = 0 WHERE id = 1').run();
  call(1, 'shop/stars', { item: 'starter' });
  const me = call(1, 'me');
  assert.equal(me.balance, S.SHOP_BY_ID.starter.money);
  assert.equal(me.keys.city, 2);
  assert.equal(me.vip, true);
  assert.throws(() => call(1, 'shop/stars', { item: 'starter' }), /лише один раз/);
  assert.equal(g.itemPrice(1, 'slot'), 100);
  call(1, 'shop/stars', { item: 'slot' });
  assert.equal(g.itemPrice(1, 'slot'), 200);
  assert.equal(call(1, 'me').slots, S.START_SLOTS + 1);
  call(1, 'shop/stars', { item: 'refuel' });
  assert.equal(call(1, 'me').fuel, S.FUEL_MAX);
});

test('shop: Telegram payment for an item applies once', () => {
  const { mk, call, g } = setup();
  mk(1);
  g.creditItem({ chargeId: 'x1', userId: 1, itemId: 'pass', stars: 250 });
  assert.equal(call(1, 'season').premium, true);
  assert.deepEqual(g.creditItem({ chargeId: 'x1', userId: 1, itemId: 'pass', stars: 250 }), { duplicate: true });
  assert.throws(() => g.itemPrice(1, 'pass'), /вже куплено/);
});

test('collection: cars from other players do not count, set bonus and country bonus', () => {
  const { db, mk, call, g } = setup();
  mk(1);
  mk(2);
  const id = g.giveCar(1, 'bmw-m3-e46').id;
  g.giveCar(1, 'vaz-2107');
  db.prepare('UPDATE users SET balance = 1e12 WHERE id = 2').run();
  call(1, 'market/sell', { carId: id, price: 2000000 });
  const lot = call(2, 'market/list').list.find((l) => l.car.id === id);
  call(2, 'market/buy', { id: lot.id });
  assert.ok(call(2, 'me').cars.some((c) => c.id === id));
  assert.ok(!call(2, 'me').collection.includes('bmw-m3-e46'), 'bought, not found');

  const parts = Object.fromEntries(S.PART_KEYS.map((k) => [k, 'sport']));
  const plain = S.carStats({ model: 'bmw-m3-e46' });
  const full = S.carStats({ model: 'bmw-m3-e46', parts });
  const mixed = S.carStats({ model: 'bmw-m3-e46', parts: { ...parts, eng: 'pro' } });
  assert.equal(full.set, true);
  assert.equal(mixed.set, false);
  assert.ok(full.hp > plain.hp);

  mk(3);
  db.prepare('UPDATE users SET slots = 10 WHERE id = 3').run();
  for (const m of ['bmw-m3-e46', 'audi-rs4-b7']) g.giveCar(3, m);
  const two = call(3, 'me').income.rate;
  g.giveCar(3, 'volkswagen-golf-r');
  const three = call(3, 'me').income.rate;
  const golf = S.carIncomeOf({ model: 'volkswagen-golf-r' });
  assert.ok(Math.abs(three - (two + golf) * 1.1) <= 2, 'three German cars earn +10%');
});

test('race: training costs nothing and pays a little', () => {
  const { mk, call, g } = setup();
  mk(1);
  const c = g.giveCar(1, 'vaz-2107').id;
  const tr = call(1, 'race/rivals', { carId: c }).list[0];
  assert.equal(tr.id, 'train');
  assert.equal(tr.entry, 0);
  assert.ok(tr.prize > 0);
  const bal = call(1, 'me').balance;
  const st = call(1, 'race/start', { carId: c, rival: 'train' });
  assert.equal(call(1, 'me').balance, bal);
  assert.ok(st.raceId);
});
