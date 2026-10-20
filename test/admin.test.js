import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createApp } from '../server.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-14T10:00:00Z');
  const sent = [];
  const g = createGame(db, { now: () => t, notify: (uid, text) => sent.push([uid, text]) });
  const mk = (id, username) => (g.ensureUser({ id, username, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const rich = (id) => db.prepare('UPDATE users SET balance = 1e12, slots = 40 WHERE id = ?').run(id);
  return { db, g, mk, call, rich, sent, advance: (ms) => (t += ms) };
}

test('admin: money, cars, parts, keys and fields change the player and are logged', () => {
  const { g, mk, call, sent } = setup();
  mk(1, 'ivan');
  const before = call(1, 'me').balance;
  assert.equal(g.admin.money('key', { id: 1, amount: 5000, note: 'Компенсація' }).balance, before + 5000);
  assert.ok(sent.some(([u, t]) => u === 1 && t.includes('Компенсація')));
  // Taking more than the player has stops at zero instead of going negative.
  assert.equal(g.admin.money('key', { id: 1, amount: -1e12 }).balance, 0);

  const { id: carId } = g.admin['give-car']('key', { id: 1, model: 'bmw-m3-e30', notify: true });
  assert.ok(call(1, 'me').cars.some((c) => c.id === carId && c.model === 'bmw-m3-e30'));
  assert.throws(() => g.admin['give-car']('key', { id: 1, model: 'no-such-car' }), /Невідома модель/);

  g.admin.part('key', { id: 1, type: 'eng', tier: 'pro', count: 3 });
  assert.equal(call(1, 'me').parts.find((p) => p.type === 'eng' && p.tier === 'pro').count, 3);
  g.admin.part('key', { id: 1, type: 'eng', tier: 'pro', count: -5 });
  assert.equal(call(1, 'me').parts.find((p) => p.type === 'eng' && p.tier === 'pro'), undefined);

  g.admin.keys('key', { id: 1, caseId: 'rust', count: 2 });
  assert.equal(call(1, 'me').keys.rust, 2);

  g.admin.set('key', { id: 1, field: 'slots', value: 12 });
  assert.equal(call(1, 'me').slots, 12);
  assert.throws(() => g.admin.set('key', { id: 1, field: 'balance', value: 1 }), /не можна/);
  assert.throws(() => g.admin.set('key', { id: 1, field: 'slots', value: 999 }), /некоректне/);

  const log = g.admin.log('key', {}).list.map((l) => l.action);
  for (const a of ['money', 'give-car', 'part', 'keys', 'set']) assert.ok(log.includes(a), a);
  const u = g.admin.user('key', { id: 1 });
  assert.equal(u.user.username, 'ivan');
  assert.ok(u.log.length >= 5);
});

test('admin: removing a car closes its auction, refunds the leader and returns parts and plate', () => {
  const { g, db, mk, call, rich } = setup();
  mk(1);
  mk(2);
  rich(1);
  rich(2);
  const keep = g.admin['give-car']('key', { id: 1, model: 'vaz-2107' }).id;
  const carId = g.admin['give-car']('key', { id: 1, model: 'toyota-supra-a80' }).id;
  g.admin.part('key', { id: 1, type: 'turbo', tier: 'sport', count: 1 });
  call(1, 'parts/install', { carId, type: 'turbo', tier: 'sport' });
  call(1, 'auction/create', { carId, startPrice: 1000, hours: 6 });
  const bal2 = call(2, 'me').balance;
  call(2, 'auction/bid', { id: 1, amount: 50000 });
  assert.equal(call(2, 'me').balance, bal2 - 50000);

  g.admin['remove-car']('key', { carId });
  assert.equal(call(2, 'me').balance, bal2, 'leader refunded');
  assert.equal(db.prepare('SELECT status FROM auctions WHERE id = 1').get().status, 'cancelled');
  const me = call(1, 'me');
  assert.ok(!me.cars.some((c) => c.id === carId));
  assert.ok(me.cars.some((c) => c.id === keep));
  assert.equal(me.parts.find((p) => p.type === 'turbo').count, 1, 'part back in the warehouse');
});

test('admin: ban takes lots off the market, market removal returns the car, promos', () => {
  const { g, mk, call, rich } = setup();
  mk(1);
  rich(1);
  g.admin['give-car']('key', { id: 1, model: 'vaz-2107' });
  const a = g.admin['give-car']('key', { id: 1, model: 'zaz-lanos' }).id;
  const b = g.admin['give-car']('key', { id: 1, model: 'fiat-uno' }).id;
  call(1, 'market/sell', { carId: a, price: 50000 });
  call(1, 'market/sell', { carId: b, price: 50000 });
  assert.equal(g.admin.market('key').listings.length, 2);

  g.admin['market/remove']('key', { kind: 'listing', id: g.admin.market('key').listings[0].id });
  assert.equal(g.admin.market('key').listings.length, 1);

  g.admin.ban('key', { id: 1, banned: true, reason: 'мультиакаунт' });
  assert.equal(g.isBanned(1), true);
  assert.equal(g.admin.market('key').listings.length, 0);
  assert.ok(call(1, 'me').cars.every((c) => c.status === 'garage'));
  assert.equal(g.admin.user('key', { id: 1 }).user.banReason, 'мультиакаунт');
  g.admin.ban('key', { id: 1, banned: false });
  assert.equal(g.isBanned(1), false);

  g.admin['promo/create']('key', { code: 'start', amount: 1000, uses: 5 });
  call(1, 'promo', { code: 'START' });
  const p = g.admin.promos('key').list.find((x) => x.code === 'START');
  assert.equal(p.used, 1);
  assert.equal(p.usesLeft, 4);
  g.admin['promo/delete']('key', { code: 'start' });
  assert.equal(g.admin.promos('key').list.length, 0);
});

test('admin: plates are issued only if free, checked by format and region, and found by search', () => {
  const { g, mk, call } = setup();
  mk(1, 'ivan');
  mk(2, 'petro');
  assert.equal(S.normalizePlate('ка7777ка'), 'KA 7777 KA');
  assert.equal(S.normalizePlate(' aa 1234 bc '), 'AA 1234 BC');

  const carId = g.admin['give-car']('key', { id: 1, model: 'bmw-m3-e30' }).id;
  const p = g.admin['give-plate']('key', { id: 1, text: 'ка7777ка', carId, note: 'Вітаю з перемогою в конкурсі' });
  assert.ok(g.api.events(1, {}).list.some((e) => e.text.includes('Вітаю з перемогою в конкурсі') && e.text.includes('KA 7777 KA')));
  assert.equal(p.text, 'KA 7777 KA');
  assert.equal(p.cls, 'S');
  assert.equal(call(1, 'me').cars.find((c) => c.id === carId).plate.text, 'KA 7777 KA');
  assert.throws(() => g.admin['give-plate']('key', { id: 2, text: 'KA 7777 KA' }), /уже має @ivan/);
  assert.throws(() => g.admin['give-plate']('key', { id: 2, text: 'ZZ 1234 AA' }), /не існує/);
  assert.throws(() => g.admin['give-plate']('key', { id: 2, text: 'AA 12 BC' }), /Формат/);
  assert.throws(() => g.admin['give-plate']('key', { id: 2, text: 'AA 1234 BD' }), /літери/);

  assert.equal(g.admin['check-plate']('key', { text: 'KA 7777 KA' }).owner.id, 1);
  assert.equal(g.admin['check-plate']('key', { text: 'AA 0001 AA' }).owner, null);

  const s = g.admin.search('key', { query: '7777' });
  assert.equal(s.plates[0].owner.id, 1);
  assert.equal(s.plates[0].carModel, 'bmw-m3-e30');
  assert.equal(g.admin.search('key', { query: 'ka 7777 ka' }).exact.owner.id, 1);
  assert.equal(g.admin.search('key', { query: 'AA 5555 AA' }).exact.owner, null);
  assert.equal(g.admin.search('key', { query: 'm3 e30' }).cars[0].owner.id, 1);

  g.admin['remove-plate']('key', { plateId: p.id });
  assert.equal(call(1, 'me').plates.length, 0);
  assert.equal(g.admin['check-plate']('key', { text: 'KA 7777 KA' }).owner, null);
});

test('admin: referrals show who brought whom, player card shows activity', () => {
  const { g } = setup();
  g.ensureUser({ id: 1, username: 'boss', first_name: 'B' });
  g.ensureUser({ id: 2, username: 'friend1', first_name: 'F' }, 'ref_1');
  g.ensureUser({ id: 3, username: 'friend2', first_name: 'F' }, 'ref_1');
  g.ensureUser({ id: 4, username: 'solo', first_name: 'S' });
  const r = g.admin.referrals('key');
  assert.equal(r.total, 2);
  assert.equal(r.organic, 2);
  assert.equal(r.top[0].name, '@boss');
  assert.equal(r.top[0].invited, 2);
  assert.deepEqual(r.top[0].friends.map((f) => f.id).sort(), [2, 3]);
  assert.equal(r.recent[0].referrer.id, 1);
  const u = g.admin.user('key', { id: 1 });
  assert.equal(u.user.invited.length, 2);
  assert.equal(g.admin.users('key', { query: 'friend1' }).list[0].referrer.name, '@boss');
  g.api['case/open'](2, { caseId: 'starter' });
  const a = g.admin.user('key', { id: 2 }).activity;
  assert.equal(a.cases.total, 1);
  assert.equal(a.cases.byCase.starter, 1);
  assert.equal(a.cases.byClass.D, 1);
  assert.ok(a.best);
});

test('admin: reset wipes progress but keeps account, referrer and payments; open deals are closed', () => {
  const { g, db, mk, call, rich } = setup();
  mk(1, 'boss');
  g.ensureUser({ id: 2, username: 'kid', first_name: 'K' }, 'ref_1');
  mk(3, 'buyer');
  rich(2);
  rich(3);
  g.admin['give-car']('key', { id: 2, model: 'vaz-2107' });
  const a = g.admin['give-car']('key', { id: 2, model: 'bmw-m3-e30' }).id;
  g.admin['give-plate']('key', { id: 2, text: 'AA 0001 AA', carId: a });
  g.admin.part('key', { id: 2, type: 'turbo', tier: 'pro', count: 2 });
  call(2, 'auction/create', { carId: a, startPrice: 1000, hours: 6 });
  const before3 = call(3, 'me').balance;
  call(3, 'auction/bid', { id: 1, amount: 5000 });
  g.creditPayment({ chargeId: 'x1', userId: 2, packId: S.PACKS[0].id, stars: S.PACKS[0].stars });

  assert.equal(g.admin.reset('key', { id: 2, reason: 'тест' }).cars, 2);
  const me = call(2, 'me');
  assert.equal(me.cars.length, 0);
  assert.equal(me.plates.length, 0);
  assert.equal(me.parts.length, 0);
  assert.equal(me.balance, S.START_BALANCE);
  assert.equal(me.level, 1);
  assert.equal(me.slots, S.START_SLOTS);
  assert.equal(me.keys.starter, 1, 'starter case is back');
  assert.equal(call(3, 'me').balance, before3, 'the other bidder got the money back');
  assert.equal(g.admin['check-plate']('key', { text: 'AA 0001 AA' }).owner, null, 'plate is free again');
  assert.equal(db.prepare('SELECT referrer_id FROM users WHERE id = 2').get().referrer_id, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payments WHERE user_id = 2').get().n, 1);
  assert.ok(g.api.events(2, {}).list.some((e) => e.text.includes('обнулила') && e.text.includes('тест')));
  assert.equal(call(2, 'case/open', { caseId: 'starter' }).results.length, 1, 'can start over');
});

test('admin: overview and player search', () => {
  const { g, mk } = setup();
  mk(1, 'ivan');
  mk(2, 'petro');
  g.admin['give-car']('key', { id: 2, model: 'bugatti-bolide' });
  const o = g.admin.overview('key');
  assert.equal(o.users, 2);
  assert.equal(o.cars, 1);
  assert.equal(o.classes[S.MODELS['bugatti-bolide'].cls], 1);
  assert.equal(o.richest[0].id, 2);
  assert.equal(g.admin.users('key', { query: '@petro' }).list[0].id, 2);
  assert.equal(g.admin.users('key', { query: '1' }).list.some((u) => u.id === 1), true);
  assert.equal(g.admin.users('key', { query: 'nobody' }).total, 0);
});

test('admin http: key, wrong-key lockout, dev local access, banned players blocked', async () => {
  const app = createApp({ dbFile: ':memory:', adminKey: 'secret-key', log: () => {} });
  const port = await app.start(0);
  const url = (p) => `http://localhost:${port}${p}`;
  const post = (p, headers = {}, body = {}) => fetch(url(p), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/admin/overview')).status, 401, 'no key, not dev');
    assert.equal((await (await post('/api/admin/whoami', { 'x-admin-key': 'secret-key' })).json()).who, 'key');
    assert.equal((await post('/api/admin/users', { 'x-admin-key': 'secret-key' })).status, 200);
    for (let i = 0; i < 10; i++) assert.equal((await post('/api/admin/overview', { 'x-admin-key': 'wrong' })).status, 401);
    assert.equal((await post('/api/admin/overview', { 'x-admin-key': 'secret-key' })).status, 429, 'locked after 10 wrong keys');
  } finally {
    app.close();
  }

  const devApp = createApp({ dbFile: ':memory:', dev: true, log: () => {} });
  const p2 = await devApp.start(0);
  const u2 = (p) => `http://localhost:${p2}${p}`;
  const dev = { 'x-dev-user': encodeURIComponent(JSON.stringify({ id: 7, first_name: 'Тест' })), 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(u2('/api/admin/whoami'), { method: 'POST' })).status, 200, 'dev + localhost is allowed');
    const me = await (await fetch(u2('/api/me'), { method: 'POST', headers: dev })).json();
    assert.equal(me.admin, true);
    devApp.game.admin.ban('local', { id: 7, banned: true });
    const r = await fetch(u2('/api/me'), { method: 'POST', headers: dev });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /заблоковано/);
  } finally {
    devApp.close();
  }
});
