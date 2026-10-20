import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-14T10:00:00Z'), notify: () => {} });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  // level 99: no level-up gifts in the balance; 40 slots unless a test says otherwise
  const rich = (id, slots = 40) => db.prepare('UPDATE users SET balance = 1e12, slots = ?, level = 99, level_seen = 99 WHERE id = ?').run(slots, id);
  return { db, g, mk, call, rich };
}

test('battle: winner takes every car, loser gets one cheap car, both paid the same', () => {
  const { mk, call, rich } = setup();
  mk(1);
  mk(2);
  rich(1);
  rich(2);
  const price = S.CASE_BY_ID.elite.price * 6;
  const { id } = call(1, 'battle/create', { caseId: 'elite', count: 6 });
  assert.equal(call(1, 'me').balance, 1e12 - price, 'creator pays up front');
  assert.equal(call(2, 'battle/list').open[0].id, id);
  assert.throws(() => call(1, 'battle/join', { id }), /твій батл/);

  const b = call(2, 'battle/join', { id });
  assert.equal(b.status, 'done');
  assert.equal(call(2, 'me').balance, 1e12 - price);
  const { creator, opponent, consolation } = b.result;
  assert.equal(creator.drops.length, 6);
  assert.equal(opponent.drops.length, 6);
  const win = creator.total > opponent.total ? 1 : 2, lose = 3 - win;
  assert.equal(b.winnerId, win);
  const cars = (u) => call(u, 'me').cars.map((c) => c.model).sort();
  assert.deepEqual(cars(win), [...creator.drops, ...opponent.drops].map((d) => d.model).sort(), 'all 12 cars to the winner');
  assert.deepEqual(cars(lose), [consolation.model]);
  assert.equal(S.MODELS[consolation.model].cls, 'D');
  assert.throws(() => call(1, 'battle/join', { id }), /почався/);
});

test('secret cars cannot be sold, listed, auctioned, traded or upgraded', () => {
  const { g, mk, call, rich } = setup();
  mk(1);
  mk(2);
  rich(1);
  rich(2);
  g.giveCar(1, 'vaz-2107');
  g.giveCar(1, 'vaz-2106');
  const s = g.giveCar(1, S.SECRET_BY_COUNTRY.UA).id;
  const err = /Секретну машину не можна/;
  assert.throws(() => call(1, 'sell', { carIds: [s] }), err);
  assert.throws(() => call(1, 'market/sell', { carId: s, price: 1000000 }), err);
  assert.throws(() => call(1, 'auction/create', { carId: s, startPrice: 1000, hours: 1 }), err);
  assert.throws(() => call(1, 'upgrade', { carIds: [s], target: 'bugatti-bolide' }), err);
  assert.throws(() => call(1, 'trade/create', { to: '2', give: [s] }), err);
  assert.throws(() => call(2, 'trade/create', { to: '1', get: [s], giveMoney: 1000 }), err);
  const { id } = call(1, 'room/create', {});
  assert.throws(() => call(1, 'room/offer', { id, add: s }), err);
  assert.ok(call(1, 'me').cars.some((c) => c.id === s), 'still in the garage');
});

test('battle: an over-full garage keeps every car, earns only within its slots and blocks new cases until sold', () => {
  const { db, mk, call, rich } = setup();
  mk(1);
  mk(2);
  rich(1, 2);
  rich(2, 2);
  assert.throws(() => call(1, 'battle/create', { caseId: 'elite', count: 5 }), /Кейсів у батлі/);
  assert.throws(() => call(1, 'battle/create', { caseId: 'starter', count: 1 }), /Обери кейс/);

  const c = call(1, 'battle/create', { caseId: 'rust', count: 3 });
  call(1, 'battle/cancel', { id: c.id });
  assert.equal(call(1, 'me').balance, 1e12, 'refunded');

  const { id } = call(1, 'battle/create', { caseId: 'rust', count: 3 });
  const b = call(2, 'battle/join', { id });
  const winner = b.winnerId;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM drops').get().n, 6, 'every roll is recorded for fairness checks');
  if (!winner) return; // a dead heat (rare): each kept their own cars
  let me = call(winner, 'me');
  assert.equal(me.cars.length, 6, 'all six cars kept, nothing sold behind the player’s back');
  assert.deepEqual(b.result.prize.map((p) => p.model), [...b.result.creator.drops, ...b.result.opponent.drops].map((d) => d.model));
  const top2 = me.cars.map((c) => S.carIncomeOf({ model: c.model, parts: c.parts, plateValue: c.plate?.value || 0 })).sort((x, y) => y - x).slice(0, 2).reduce((s, v) => s + v, 0);
  assert.equal(me.income.rate, Math.round(top2), 'only the 2 best earners count');
  assert.throws(() => call(winner, 'case/open', { caseId: 'rust' }), /Гараж заповнений/);
  // The player picks what to sell, one by one.
  call(winner, 'sell', { carIds: [b.result.prize[0].id] });
  call(winner, 'sell', { carIds: me.cars.filter((c) => c.id !== b.result.prize[0].id).slice(0, 3).map((c) => c.id) });
  me = call(winner, 'me');
  assert.equal(me.cars.length, 2, 'back within the limit');
  call(winner, 'sell', { carIds: [me.cars[0].id] });
  assert.equal(call(winner, 'case/open', { caseId: 'rust', count: 1 }).results.length, 1, 'a free slot opens cases again');
});
