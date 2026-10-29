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
  const g = createGame(db, { now: () => t, notify: (uid, text) => sent.push([uid, text]), allUnlocked: true });
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
  g.creditPayment({ chargeId: 'x1', userId: 2, packId: S.PACKS.find((p) => p.id === 'p1').id, stars: S.PACKS.find((p) => p.id === 'p1').stars });

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

test('admin: reset also clears achievements, season, VIP, event tasks, badges and the rating standing', () => {
  const { g, db, mk, call, advance } = setup();
  mk(1, 'cheat');
  mk(2, 'rival');
  const t0 = Date.parse('2026-10-14T10:00:00Z');
  db.prepare('UPDATE users SET season_xp = 9000, premium_season = 1, vip_until = ?, play_ms = ?, plate_best = 5, total_value = 5e8 WHERE id = 1').run(t0 + 30 * 86400e3, 50 * 3600e3);
  const ins = (sql, ...a) => db.prepare(sql).run(...a);
  ins("INSERT INTO battles (creator_id, opponent_id, case_id, count, price, status, winner_id, created_at, finished_at) VALUES (1, 2, 'rust', 1, 1, 'done', 1, ?, ?)", t0 - 1000, t0 - 500);
  ins("INSERT INTO hw_tasks (event, user_id, task, progress, done_at, prize) VALUES ('hw26', 1, 'cases', 5, ?, NULL)", t0);
  ins("INSERT INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (1, 'season', 'Топ', 1, 1, 1, ?)", t0);
  ins('INSERT INTO trophies (user_id, k, cost, at) VALUES (1, 0, 100, ?)', t0);
  ins("INSERT INTO weekly_quests (user_id, week, key, target, progress, claimed) VALUES (1, '2026-10-12', 'cases', 10, 10, 1)");
  const battlesBefore = call(1, 'achievements').list.find((a) => a.key === 'battles').value;
  assert.equal(battlesBefore, 1);
  advance(1000);
  g.admin.reset('key', { id: 1 });
  const u = db.prepare('SELECT * FROM users WHERE id = 1').get();
  assert.deepEqual([u.season_xp, u.premium_season, u.vip_until, u.play_ms, u.plate_best, u.total_value], [0, 0, 0, 0, 0, 0]);
  for (const tb of ['hw_tasks', 'badges', 'trophies', 'weekly_quests']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${tb} WHERE user_id = 1`).get().n, 0, tb);
  const ach = call(1, 'achievements').list;
  assert.equal(ach.find((a) => a.key === 'battles').value, 0, 'old battle wins no longer count');
  assert.equal(ach.reduce((n, a) => n + a.reached, 0), 0, 'no tier is reached again after a reset');
  assert.equal(call(1, 'me').vip, false);
  assert.ok(!g.api.leaderboard(1, { type: 'season' }).list.some((r) => r.id === 1), 'out of the season board');
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

// ---------- panel rules: roles, confirm + reason, logging, search, player card, dashboard, broadcast ----------
function panel() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-20T10:00:00Z');
  const sent = [], bc = [];
  const g = createGame(db, { now: () => t, notify: (uid, text) => sent.push([uid, text]), admins: [1], broadcast: (ids, text) => bc.push([ids, text]) });
  g.ensureUser({ id: 1, username: 'owner', first_name: 'Власник' });
  g.ensureUser({ id: 2, username: 'adm', first_name: 'Адмін' });
  g.ensureUser({ id: 3, username: 'help', first_name: 'Хелпер' });
  g.ensureUser({ id: 10, username: 'Olena_Cars', first_name: 'Олена' });
  g.ensureUser({ id: 11, username: null, first_name: 'Іван 100%' });
  g.admin.role('tg:1', { id: 2, role: 'admin' });
  g.admin.role('tg:1', { id: 3, role: 'helper' });
  const ok = { confirm: true, reason: 'перевірка' };
  return { db, g, sent, bc, ok, advance: (ms) => (t += ms), now: () => t };
}

test('admin panel: a helper can look and answer, but not give, take, ban or broadcast', () => {
  const { g, ok } = panel();
  assert.ok(g.adminCall('tg:3', 'users', { query: 'олена' }).list.length);
  assert.equal(g.adminCall('tg:3', 'user', { id: 10 }).user.id, 10);
  assert.ok(g.adminCall('tg:3', 'dashboard', {}).days.length);
  g.adminCall('tg:3', 'message', { id: 10, text: 'Привіт' });
  for (const [name, body] of [['money', { id: 10, amount: 1000 }], ['money', { id: 10, amount: -1000 }], ['ban', { id: 10, banned: true }],
    ['broadcast', { text: 'всім' }], ['broadcast/preview', {}], ['give-car', { id: 10, model: 'vaz-2107' }], ['keys', { id: 10, caseId: 'rust', count: 1 }],
    ['part', { id: 10, type: 'eng', tier: 'pro', count: 1 }], ['reset', { id: 10 }], ['promo/create', { code: 'XX1', amount: 1, uses: 1 }], ['payments', {}], ['role', { id: 11, role: 'helper' }]]) {
    assert.throws(() => g.adminCall('tg:3', name, { ...body, ...ok }), /Немає прав/, name);
  }
  // Nobody without a role, and unknown methods are reported as such (undefined → 404 in the server).
  assert.throws(() => g.adminCall('tg:10', 'users', {}), /Немає прав/);
  assert.equal(g.adminCall('tg:2', 'nope', {}), undefined);
  assert.equal(g.adminCall('tg:2', '__proto__', {}), undefined);
  // An admin can do the rest.
  g.adminCall('tg:2', 'money', { id: 10, amount: 1000, ...ok });
});

test('admin panel: every change needs confirm and a reason; both go to the log with who and whom', () => {
  const { g, db, ok } = panel();
  const bal = db.prepare('SELECT balance FROM users WHERE id = 10').get().balance;
  assert.throws(() => g.adminCall('tg:2', 'money', { id: 10, amount: -500 }), /причину/);
  assert.throws(() => g.adminCall('tg:2', 'money', { id: 10, amount: -500, reason: 'ok' }), /причину/, 'too short');
  assert.throws(() => g.adminCall('tg:2', 'money', { id: 10, amount: -500, reason: 'баг з оплатою' }), /не підтверджено/);
  assert.throws(() => g.adminCall('tg:2', 'money', { id: 10, amount: -500, reason: 'баг з оплатою', confirm: 'true' }), /не підтверджено/, 'only a real true');
  assert.equal(db.prepare('SELECT balance FROM users WHERE id = 10').get().balance, bal, 'nothing changed');

  const steps = [
    ['money', { id: 10, amount: -500 }], ['money', { id: 10, amount: 700, note: 'Подарунок' }], ['give-car', { id: 10, model: 'vaz-2107' }],
    ['part', { id: 10, type: 'eng', tier: 'pro', count: 2 }], ['part', { id: 10, type: 'eng', tier: 'pro', count: -5 }],
    ['keys', { id: 10, caseId: 'rust', count: 3 }], ['set', { id: 10, field: 'slots', value: 9 }], ['part', { id: 10, type: 'eng', tier: 'pro', count: 1 }],
    ['ban', { id: 10, banned: true }], ['ban', { id: 10, banned: false }], ['promo/create', { code: 'TEST1', amount: 100, uses: 2 }], ['promo/delete', { code: 'TEST1' }],
  ];
  steps.forEach(([name, body], i) => g.adminCall('tg:2', name, { ...body, confirm: true, reason: `причина ${i}` }));
  const carId = g.admin.user('tg:2', { id: 10 }).cars[0].id;
  g.adminCall('tg:2', 'remove-car', { carId, ...ok });
  g.adminCall('tg:2', 'reset', { id: 10, confirm: true, reason: 'мультиакаунт' });

  const log = db.prepare('SELECT * FROM admin_log WHERE admin = ? ORDER BY id').all('tg:2');
  assert.equal(log.length, steps.length + 2, 'one entry per action');
  const logged = { 'promo/create': 'promo', 'promo/delete': 'promo-delete' };
  log.slice(0, steps.length).forEach((l, i) => {
    assert.equal(l.action, steps[i][0] === 'ban' && !steps[i][1].banned ? 'unban' : logged[steps[i][0]] || steps[i][0]);
    assert.equal(JSON.parse(l.details).reason, `причина ${i}`, l.action);
  });
  assert.equal(log[0].target, 10);
  assert.equal(JSON.parse(log[0].details).amount, -500);
  assert.equal(JSON.parse(log[4].details).count, -2, 'logs what was really taken (2 of 5)');
  assert.deepEqual([JSON.parse(log[6].details).was, JSON.parse(log[6].details).value], [S.START_SLOTS, 9], 'old and new value');
  assert.equal(JSON.parse(log.at(-1).details).reason, 'мультиакаунт');
  // The ban reason typed in the dialog is the ban reason on the player.
  g.adminCall('tg:2', 'ban', { id: 11, banned: true, confirm: true, reason: 'чіти' });
  assert.equal(g.admin.user('tg:2', { id: 11 }).user.banReason, 'чіти');
  // message / support reply need no dialog but are still logged.
  g.adminCall('tg:3', 'message', { id: 11, text: 'Привіт' });
  assert.equal(db.prepare("SELECT admin FROM admin_log WHERE action = 'message'").get().admin, 'tg:3');
});

test('admin panel: bad field names and the bot commands are handled and logged', () => {
  const { g, db, ok } = panel();
  for (const field of ['constructor', '__proto__', 'toString', 'balance']) assert.throws(() => g.adminCall('tg:2', 'set', { id: 10, field, value: 1, ...ok }), /не можна/, field);
  const bal = db.prepare('SELECT balance FROM users WHERE id = 10').get().balance;
  g.adminGive(10, -1e12);
  assert.equal(db.prepare('SELECT balance FROM users WHERE id = 10').get().balance, 0, '/give never goes below zero');
  g.createPromo('botcode', 500, 3);
  const log = db.prepare("SELECT action, details FROM admin_log WHERE admin = 'bot' ORDER BY id").all();
  assert.deepEqual(log.map((l) => l.action), ['money', 'promo']);
  assert.equal(JSON.parse(log[0].details).amount, -bal);
});

test('admin panel: player search by ID, @username and Cyrillic name; exact match first', () => {
  const { g } = panel();
  const s = (query) => g.adminCall('tg:3', 'users', { query }).list.map((u) => u.id);
  assert.deepEqual(s('олена'), [10], 'Cyrillic, any case');
  assert.deepEqual(s('ОЛЕНА'), [10]);
  assert.deepEqual(s('@olena_cars'), [10]);
  assert.deepEqual(s('OLENA'), [10]);
  assert.equal(s('10')[0], 10, 'exact ID first');
  assert.ok(s('1').includes(11));
  assert.deepEqual(s('100%'), [11], '% is literal');
  assert.deepEqual(s('_'), [10], '_ is literal');
  assert.deepEqual(s('нікого'), []);
});

test('admin panel: player card has balance, cars with values, parts, plates, keys, payments, drops, referrals, legacy, ban and last seen', () => {
  const { g, db, ok, advance } = panel();
  g.ensureUser({ id: 12, username: 'friend', first_name: 'Друг' }, 'ref_10');
  g.adminCall('tg:2', 'give-car', { id: 10, model: 'bmw-m3-e30', ...ok });
  g.adminCall('tg:2', 'part', { id: 10, type: 'turbo', tier: 'sport', count: 2, ...ok });
  g.adminCall('tg:2', 'keys', { id: 10, caseId: 'rust', count: 1, ...ok });
  g.adminCall('tg:2', 'give-plate', { id: 10, text: 'AA 0001 AA', ...ok });
  g.creditPayment({ chargeId: 'c1', userId: 10, packId: S.PACKS.find((p) => p.id === 'p1').id, stars: S.PACKS.find((p) => p.id === 'p1').stars });
  g.api['case/open'](10, { caseId: 'starter' });
  db.prepare('INSERT INTO legacy (id, referrer_id, stars, thanked) VALUES (10, 1, 75, 1)').run();
  advance(60e3);
  g.api.me(10, {});
  const c = g.adminCall('tg:3', 'user', { id: 10 });
  assert.ok(c.user.balance > 0);
  assert.equal(c.user.username, 'Olena_Cars');
  assert.ok(c.cars.some((x) => x.model === 'bmw-m3-e30' && x.value > 0));
  assert.equal(c.parts.find((p) => p.type === 'turbo').count, 2);
  assert.equal(c.plates[0].text, 'AA 0001 AA');
  assert.equal(c.keys.find((k) => k.caseId === 'rust').count, 1);
  assert.equal(c.payments[0].stars, S.PACKS.find((p) => p.id === 'p1').stars);
  assert.ok(c.drops.length >= 1);
  assert.deepEqual(c.user.invited.map((f) => f.id), [12]);
  assert.equal(g.adminCall('tg:3', 'user', { id: 12 }).user.referrer.id, 10);
  assert.deepEqual(c.user.legacy, { referrer: 1, stars: 75, thanked: true });
  assert.equal(c.user.banned, false);
  assert.ok(c.user.lastSeen > 0);
  assert.ok(c.user.activeDays >= 1);
  assert.ok('playMs' in c.user && 'stars' in c.user && Array.isArray(c.fragments));
  assert.ok(c.log.length >= 4 && c.log.every((l) => l.admin === 'tg:2'));
});

test('admin panel: dashboard counts active players, new players, cases, stars and money in / out per day', () => {
  const { g, db, ok, advance } = panel();
  const d0 = g.adminCall('tg:2', 'dashboard', { days: 7 });
  assert.equal(d0.days.length, 7);
  const today0 = d0.days.at(-1);
  assert.ok(today0.newUsers >= 5);
  assert.ok(today0.created >= 5 * S.START_BALANCE, 'start money counts as created');
  g.api['case/open'](10, { caseId: 'starter' });
  g.creditPayment({ chargeId: 'p1', userId: 11, packId: S.PACKS.find((p) => p.id === 'p1').id, stars: S.PACKS.find((p) => p.id === 'p1').stars });
  g.adminCall('tg:2', 'money', { id: 10, amount: -1000, ...ok });
  const d1 = g.adminCall('tg:2', 'dashboard', { days: 7 });
  const t = d1.days.at(-1);
  assert.equal(t.cases, 1);
  assert.equal(t.stars, S.PACKS.find((p) => p.id === 'p1').stars);
  assert.ok(t.dau >= 2, 'opened a case or paid today');
  assert.equal(t.destroyed - today0.destroyed >= 1000, true);
  assert.equal(t.supply, db.prepare('SELECT SUM(balance) n FROM users').get().n, 'money supply today');
  assert.equal(d1.top.payers[0].id, 11);
  assert.ok(S.CASE_BY_ID[d1.caseOfDay.today]);
  // Next day: yesterday's numbers stay, the supply line walks back by the net.
  advance(86400e3);
  const d2 = g.adminCall('tg:2', 'dashboard', { days: 7 });
  assert.equal(d2.days.at(-2).cases, 1);
  assert.equal(d2.days.at(-1).cases, 0);
  assert.equal(d2.days.at(-2).supply, d2.days.at(-1).supply - (d2.days.at(-1).created - d2.days.at(-1).destroyed));
});

test('admin panel: broadcast — preview count, banned left out, delivered in game and through the bot, once per 10 minutes', () => {
  const { g, db, bc, ok, advance } = panel();
  g.adminCall('tg:2', 'ban', { id: 11, banned: true, ...ok });
  const p = g.adminCall('tg:2', 'broadcast/preview', { audience: 'all' });
  assert.equal(p.recipients, 4);
  assert.throws(() => g.adminCall('tg:2', 'broadcast', { audience: 'all', text: 'Привіт' }), /причину/);
  assert.throws(() => g.adminCall('tg:2', 'broadcast', { audience: 'everyone', text: 'Привіт', ...ok }), /аудиторія/);
  assert.throws(() => g.adminCall('tg:2', 'broadcast', { audience: 'all', text: ' ', ...ok }), /текст/);
  assert.equal(g.adminCall('tg:2', 'broadcast', { audience: 'all', text: 'Новий кейс!', ...ok }).recipients, 4);
  assert.deepEqual(bc[0][0], [1, 2, 3, 10]);
  assert.equal(bc[0][1], '📢 Новий кейс!');
  assert.ok(g.api.events(10, {}).list.some((e) => e.text === '📢 Новий кейс!'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gifts WHERE kind = 'message' AND note = 'Новий кейс!'").get().n, 4);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE user_id = 11 AND text LIKE '📢%'").get().n, 0, 'banned left out');
  const l = db.prepare("SELECT * FROM admin_log WHERE action = 'broadcast'").get();
  assert.equal(l.admin, 'tg:2');
  assert.equal(JSON.parse(l.details).reason, 'перевірка');
  assert.throws(() => g.adminCall('tg:1', 'broadcast', { audience: 'all', text: 'Ще раз', ...ok }), /через \d+ хв/);
  assert.ok(g.adminCall('tg:2', 'broadcast/preview', {}).waitMs > 0);
  advance(10 * 60e3 + 1);
  assert.equal(g.adminCall('tg:1', 'broadcast', { audience: 'active1', text: 'Ще раз', ...ok }).recipients, 4);
});

test('admin panel: log viewer filters by admin, action, player, date and text', () => {
  const { g, ok, now } = panel();
  g.adminCall('tg:2', 'money', { id: 10, amount: 100, confirm: true, reason: 'компенсація' });
  g.adminCall('tg:1', 'ban', { id: 11, banned: true, ...ok });
  const f = (b) => g.adminCall('tg:3', 'log', b);
  assert.deepEqual(f({ admin: 'tg:2', action: 'money' }).list.map((l) => l.target), [10]);
  assert.equal(f({ target: '@olena_cars' }).list[0].action, 'money');
  assert.equal(f({ target: '11' }).list[0].action, 'ban');
  assert.equal(f({ target: '@nobody' }).total, 0);
  assert.equal(f({ text: 'КОМПЕНСАЦ' }).total, 1, 'text search in details and reason');
  assert.equal(f({ from: now() + 1 }).total, 0);
  const all = f({});
  assert.ok(all.total >= 4);
  assert.ok(all.admins.some((a) => a.id === 'tg:2' && a.name === '@adm'));
  assert.ok(all.actions.includes('role') && all.actions.includes('ban'));
  assert.equal(all.list.find((l) => l.admin === 'tg:2').adminName, '@adm');
});

test('admin http: changes need confirm + reason, proxied requests are not "local" in DEV, wrong keys are limited overall', async () => {
  const devApp = createApp({ dbFile: ':memory:', dev: true, log: () => {} });
  const port = await devApp.start(0);
  const post = (p, body = {}, headers = {}) => fetch(`http://localhost:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    devApp.game.ensureUser({ id: 5, first_name: 'П' });
    let r = await post('/api/admin/money', { id: 5, amount: 100 });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /не підтверджено/); // the owner (local DEV) needs no reason, only the confirm
    r = await post('/api/admin/money', { id: 5, amount: 100, reason: 'тест http', confirm: true });
    assert.equal(r.status, 200);
    assert.equal(devApp.db.prepare("SELECT admin FROM admin_log WHERE action = 'money'").get().admin, 'local');
    assert.equal((await post('/api/admin/nope')).status, 404);
    // Through a reverse proxy on the same machine, DEV must not hand out the admin panel.
    assert.equal((await post('/api/admin/overview', {}, { 'x-forwarded-for': '203.0.113.9' })).status, 401);
    assert.equal((await post('/api/admin/overview', {}, { 'x-real-ip': '203.0.113.9' })).status, 401);
  } finally {
    devApp.close();
  }

  const app = createApp({ dbFile: ':memory:', adminKey: 'a-long-secret-key-123', log: () => {} });
  const p2 = await app.start(0);
  const post2 = (headers) => fetch(`http://localhost:${p2}/api/admin/whoami`, { method: 'POST', headers });
  try {
    // 10 addresses (as a proxy would report them) × 10 wrong keys = 100 → key login locked for everyone for a while.
    for (let ip = 0; ip < 10; ip++) for (let i = 0; i < 10; i++) assert.equal((await post2({ 'x-admin-key': 'bad', 'x-forwarded-for': `198.51.100.${ip}` })).status, 401);
    assert.equal((await post2({ 'x-admin-key': 'a-long-secret-key-123', 'x-forwarded-for': '198.51.100.200' })).status, 429);
  } finally {
    app.close();
  }
});

test('admin panel: only the owner grants the premium pass and VIP', () => {
  const { db, g, ok } = panel();
  assert.throws(() => g.adminCall('tg:2', 'grant-premium', { id: 10, what: 'pass', ...ok }), /лише власник/);
  assert.throws(() => g.adminCall('tg:3', 'grant-premium', { id: 10, what: 'pass', ...ok }), /Немає прав/);
  assert.throws(() => g.adminCall('tg:1', 'grant-premium', { id: 10, what: 'pass' }), /не підтверджено/);
  const r = g.adminCall('tg:1', 'grant-premium', { id: 10, what: 'pass', ...ok });
  assert.equal(db.prepare('SELECT premium_season s FROM users WHERE id = 10').get().s, r.season);
  assert.throws(() => g.adminCall('tg:1', 'grant-premium', { id: 10, what: 'pass', ...ok }), /вже є/);
  const v = g.adminCall('tg:1', 'grant-premium', { id: 10, what: 'vip', days: 3, ...ok });
  assert.ok(v.until > Date.parse('2026-10-22T10:00:00Z'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_log WHERE action = 'grant-premium'").get().n, 2);
});

test('admin reason (owner 28.10): the owner confirms without a reason, an admin still has to give one', () => {
  const db = openDb(':memory:');
  const g = createGame(db, { notify: () => {}, admins: [1] });
  for (const id of [1, 2, 10]) g.ensureUser({ id, first_name: 'U' + id });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 2").run();
  g.adminCall('tg:1', 'money', { id: 10, amount: 100, confirm: true });
  assert.throws(() => g.adminCall('tg:2', 'money', { id: 10, amount: 100, confirm: true }), /причину/);
  g.adminCall('tg:2', 'money', { id: 10, amount: 100, confirm: true, reason: 'тест' });
});
