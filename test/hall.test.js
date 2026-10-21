import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

function setup() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-14T10:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {}, allUnlocked: true });
  const mk = (id, username) => (g.ensureUser({ id, username, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  // level 99: no level-up gifts land in the balance during the test
  const rich = (id) => db.prepare('UPDATE users SET balance = 1000000, slots = 40, level = 99, level_seen = 99 WHERE id = ?').run(id);
  const car = (uid, model) => g.giveCar(uid, model).id;
  return { db, g, mk, call, rich, car, advance: (ms) => (t += ms) };
}

test('hall: anyone joins an open room, both get ready, cars and money swap', () => {
  const { mk, call, rich, car } = setup();
  mk(1, 'ivan');
  mk(2, 'petro');
  rich(1);
  rich(2);
  const a = car(1, 'bmw-m3-e30'), a2 = car(1, 'vaz-2107');
  const b = car(2, 'toyota-supra-a80'), b2 = car(2, 'zaz-lanos');

  const { id } = call(1, 'room/create', { note: 'шукаю Supra' });
  assert.equal(call(1, 'room/create', {}).id, id, 'one room per player');
  const hall = call(2, 'hall', {});
  assert.equal(hall.rooms.length, 1);
  assert.equal(hall.rooms[0].note, 'шукаю Supra');
  assert.ok(hall.online.some((u) => u.id === 1), 'host is online');

  call(2, 'room/join', { id });
  call(1, 'room/offer', { id, add: a });
  call(2, 'room/offer', { id, add: b });
  call(2, 'room/offer', { id, money: 5000 });
  let s = call(1, 'room/state', { id });
  assert.equal(s.partner.name, '@petro');
  assert.equal(s.partner.money, 5000);
  assert.deepEqual(s.partner.cars.map((c) => c.id), [b]);

  assert.equal(call(1, 'room/ready', { id, version: s.version, ready: true }).done, false);
  // A change after "ready" clears both flags and needs a fresh look at the offer.
  call(2, 'room/offer', { id, money: 4000 });
  assert.throws(() => call(2, 'room/ready', { id, version: s.version, ready: true }), /змінилась/);
  s = call(1, 'room/state', { id });
  assert.equal(s.me.ready, false);
  call(1, 'room/ready', { id, version: s.version, ready: true });
  assert.equal(call(2, 'room/ready', { id, version: s.version, ready: true }).done, true);

  const me1 = call(1, 'me'), me2 = call(2, 'me');
  assert.ok(me1.cars.some((c) => c.id === b) && !me1.cars.some((c) => c.id === a));
  assert.ok(me2.cars.some((c) => c.id === a) && !me2.cars.some((c) => c.id === b));
  assert.equal(me1.balance, 1000000 + 4000);
  assert.equal(me2.balance, 1000000 - 4000);
  assert.ok(me1.cars.some((c) => c.id === a2) && me2.cars.some((c) => c.id === b2));
  assert.equal(call(1, 'room/state', { id }).status, 'done');
  assert.ok(call(1, 'room/state', { id }).chat.some((m) => m.system && m.text.includes('завершено')));
});

test('hall: a car sold meanwhile is dropped from the swap instead of breaking it', () => {
  const { mk, call, rich, car } = setup();
  mk(1);
  mk(2);
  rich(1);
  rich(2);
  car(1, 'vaz-2107');
  const a = car(1, 'bmw-m3-e30');
  car(2, 'zaz-lanos');
  const { id } = call(1, 'room/create', {});
  call(2, 'room/join', { id });
  call(1, 'room/offer', { id, add: a });
  call(2, 'room/offer', { id, money: 1000 });
  const v = call(1, 'room/state', { id }).version;
  call(1, 'room/ready', { id, version: v, ready: true });
  call(1, 'sell', { carIds: [a] });
  const r = call(2, 'room/ready', { id, version: v, ready: true });
  assert.equal(r.stale, true);
  const s = call(2, 'room/state', { id });
  assert.equal(s.partner.cars.length, 0);
  assert.equal(s.me.ready, false);
  assert.equal(call(2, 'me').balance, 1000000, 'no money moved');
});

test('hall: leaving, host timeout, invites, chat limits', () => {
  const { mk, call, rich, car, advance } = setup();
  mk(1);
  mk(2);
  mk(3);
  rich(1);
  rich(2);
  const b = car(2, 'zaz-lanos');
  car(2, 'vaz-2107');
  const { id } = call(1, 'room/invite', { to: 3 });
  assert.equal(call(3, 'hall', {}).rooms[0].invited, true);
  assert.ok(call(3, 'me').incomingTrades >= 1);

  call(2, 'room/join', { id });
  assert.throws(() => call(3, 'room/join', { id }), /недоступна/, 'room is full');
  call(2, 'room/offer', { id, add: b });
  call(2, 'room/leave', { id });
  let s = call(1, 'room/state', { id });
  assert.equal(s.status, 'open');
  assert.equal(s.partner, null);

  call(1, 'room/chat', { id, text: 'привіт' });
  assert.throws(() => call(1, 'room/chat', { id, text: 'ще' }), /швидко/);
  advance(2000);
  assert.throws(() => call(1, 'hall/chat', { text: '   ' }), /Порожнє/);
  call(1, 'hall/chat', { text: 'Продаю Ланос' });
  assert.equal(call(2, 'hall', {}).chat.at(-1).text, 'Продаю Ланос');

  // The host stops polling: the room vanishes from the hall, then closes.
  advance(60e3);
  assert.equal(call(2, 'hall', {}).rooms.length, 0);
  advance(5 * 60e3);
  call(2, 'hall', {});
  s = call(1, 'room/state', { id });
  assert.equal(s.status, 'closed');
  assert.throws(() => call(1, 'room/offer', { id, money: 1 }), /закрито/);
});
