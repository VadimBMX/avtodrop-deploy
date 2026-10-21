import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

function setup() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-19T10:00:00Z');
  const clock = { now: () => t, add: (ms) => (t += ms) };
  const g = createGame(db, { now: clock.now, notify: () => {} });
  const mk = (id) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET balance = 1e9, level = 99, level_seen = 99 WHERE id = ?').run(id);
    return g.giveCar(id, 'vaz-2107').id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, clock, mk, call };
}
const good = Array(S.SHIFTS).fill('good');

test('live PvP: request → creator sees it in pulse → accept → both race → winner paid', () => {
  const { clock, mk, call } = setup();
  const c1 = mk(1), c2 = mk(2);
  const { id } = call(1, 'pvp/create', { carId: c1, bet: 100000 });
  call(1, 'pulse'); // creator is online
  const req = call(2, 'pvp/request', { id, carId: c2 });
  assert.equal(req.status, 'pending');
  assert.equal(call(2, 'me').balance, 1e9 - 100000, 'requester bet held');
  const inv = call(1, 'pulse').invites;
  assert.equal(inv.length, 1);
  assert.equal(inv[0].kind, 'pvp');
  assert.equal(call(2, 'pulse').livePvp, id, 'requester is waiting on this race');

  const live = call(1, 'pvp/answer', { id, yes: true });
  assert.equal(live.status, 'live');
  assert.ok(live.greenAt > live.startAt);
  clock.add(live.greenAt - clock.now() + 300);
  assert.equal(call(2, 'pvp/progress', { id, u: 0.4 }).me.u, 0.4);
  assert.equal(call(1, 'pvp/state', { id }).rival.u, 0.4, 'creator sees the rival move');
  const greenMs = live.greenAt - live.startAt;
  const r1 = honestDrag(live.me.car, greenMs, 0.12, Array(S.SHIFTS).fill('perfect'));
  const r2 = honestDrag(live.rival.car, greenMs, 0.9, Array(S.SHIFTS).fill('late'));
  clock.add(live.startAt + Math.max(r1.ms, r2.ms) - clock.now() + 50);
  let s = call(1, 'pvp/finish', { id, ...r1.body });
  assert.equal(s.status, 'live', 'waits for the other player');
  assert.equal(s.rival.run, null, 'times stay hidden until both finish');
  s = call(2, 'pvp/finish', { id, ...r2.body });
  assert.equal(s.status, 'done');
  assert.equal(s.win, false);
  const prize = Math.floor(200000 * (1 - S.FEE));
  assert.equal(call(1, 'me').balance, 1e9 - 100000 + prize);
  assert.ok(s.me.run.time > s.rival.run.time);
});

test('live PvP: an offline creator means the autopilot race; a silent one gives the bet back', () => {
  const { db, clock, mk, call } = setup();
  const c1 = mk(1), c2 = mk(2);
  const { id } = call(1, 'pvp/create', { carId: c1, bet: 50000 });
  clock.add(60e3); // creator went quiet
  assert.deepEqual(call(2, 'pvp/request', { id, carId: c2 }), { offline: true });
  assert.equal(call(2, 'me').balance, 1e9, 'nothing charged');
  call(1, 'pulse');
  call(2, 'pvp/request', { id, carId: c2 });
  clock.add(26e3);
  assert.equal(call(2, 'pvp/state', { id }).status, 'released', 'request expired');
  assert.equal(call(2, 'me').balance, 1e9, 'bet returned');
  db.prepare('UPDATE users SET no_invites = 1 WHERE id = 1').run();
  call(1, 'pulse');
  assert.deepEqual(call(2, 'pvp/request', { id, carId: c2 }), { offline: true }, 'do-not-disturb creator is never asked');
});

test('live PvP: a player who disconnects mid-race loses on a late run', () => {
  const { clock, mk, call } = setup();
  const c1 = mk(1), c2 = mk(2);
  const { id } = call(1, 'pvp/create', { carId: c1, bet: 50000 });
  call(1, 'pulse');
  call(2, 'pvp/request', { id, carId: c2 });
  const live = call(1, 'pvp/answer', { id, yes: true });
  const run = honestDrag(live.rival.car, live.greenAt - live.startAt, 0.3, good);
  clock.add(live.startAt + run.ms - clock.now() + 50);
  call(2, 'pvp/finish', { id, ...run.body });
  clock.add(50e3);
  const s = call(2, 'pvp/state', { id });
  assert.equal(s.status, 'done');
  assert.equal(s.win, true);
});

test('invites: do-not-disturb and anti-spam limits', () => {
  const { mk, call } = setup();
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) mk(id);
  call(2, 'settings/invites', { on: true });
  assert.throws(() => call(1, 'room/invite', { to: 2 }), /не приймає/);
  call(1, 'room/invite', { to: 3 });
  assert.equal(call(3, 'pulse').invites[0].kind, 'room');
  assert.throws(() => call(1, 'room/invite', { to: 3 }), /зачекай/);
  call(3, 'room/decline', { id: call(3, 'pulse').invites[0].id });
  assert.equal(call(3, 'pulse').invites.length, 0);
  for (const to of [4, 5, 6, 7]) call(1, 'room/invite', { to });
  assert.throws(() => call(1, 'room/invite', { to: 8 }), /Забагато/);
});

test('luck builds up after bad drops, only ever helps, and a broke player gets a free case', () => {
  const { db, mk, call } = setup();
  mk(1);
  assert.equal(call(1, 'me').luck, 0, 'no luck without bad drops');
  db.prepare('UPDATE users SET luck_spent = 10000000, luck_got = 500000 WHERE id = 1').run();
  const luck = call(1, 'me').luck;
  assert.ok(luck > 0.3 && luck <= S.LUCK.max, `luck ${luck} after drops worth 5% of what they should be`);
  // Rolls with luck: never below what the plain roll would give, so the purple-or-better share goes up.
  db.prepare('UPDATE users SET slots = 100000, balance = 1e12 WHERE id = 1').run();
  for (let i = 0; i < 300; i++) {
    db.prepare('UPDATE users SET luck_spent = 10000000, luck_got = 0 WHERE id = 1').run();
    call(1, 'case/open', { caseId: 'c-jp', count: 6 });
  }
  const drops = db.prepare("SELECT cls, forced FROM drops WHERE case_id = 'c-jp'").all();
  const good = drops.filter((d) => S.rankOf(d.cls) >= S.rankOf('B')).length / drops.length;
  // Against the plain odds (the pity guarantee fires less often when luck already lifts the class).
  const w = S.CASE_BY_ID['c-jp'].weights, tw = Object.values(w).reduce((a, b) => a + b, 0);
  assert.ok(good > ((w.B + w.A + w.S) / tw) * 1.15, `lucky purple-or-better ${good}`);
  assert.ok(drops.some((d) => d.forced === 2), 'lucky drops are marked');
  // Broke: no money, nothing in the garage worth much → a free rusty case every 12 h.
  db.prepare('UPDATE users SET balance = 1000, total_value = 0 WHERE id = 1').run();
  db.prepare('DELETE FROM cars WHERE owner_id = 1').run();
  assert.ok(call(1, 'pulse').claims.some((c) => c.kind === 'rescue'));
  call(1, 'rescue/claim');
  assert.equal(call(1, 'me').keys.rust, 1);
  assert.throws(() => call(1, 'rescue/claim'), /недоступна/);
});

test('a newcomer with the start balance has no luck; the rescue banner keeps one key until claimed', () => {
  const { db, g, call } = setup();
  g.ensureUser({ id: 9, first_name: 'New' }); // start balance, no cars
  assert.equal(g.api.me(9).luck, 0, 'not broke with the start money');
  db.prepare('UPDATE users SET balance = 1000 WHERE id = 9').run();
  const k1 = g.api.pulse(9).claims.find((c) => c.kind === 'rescue')?.key;
  const k2 = g.api.pulse(9).claims.find((c) => c.kind === 'rescue')?.key;
  assert.ok(k1 && k1 === k2, 'same banner key on every poll');
  void call;
});

test('rating: equal results rank the same in the list and in "my place"', () => {
  const { db, mk, call } = setup();
  mk(1);
  mk(2);
  call(1, 'me');
  call(2, 'me');
  db.prepare('UPDATE users SET total_value = 5000000, week_start_value = 0').run();
  for (const id of [1, 2]) {
    const lb = call(id, 'leaderboard', { type: 'week' });
    assert.equal(lb.me.place, lb.list.find((r) => r.me).place, `player ${id}`);
  }
});

test('play time adds up between polls of the open app, not while it is closed', () => {
  const { clock, mk, call } = setup();
  mk(1);
  call(1, 'pulse');
  clock.add(4000);
  call(1, 'pulse');
  clock.add(4000);
  call(1, 'pulse');
  clock.add(3600e3); // app closed for an hour
  call(1, 'pulse');
  clock.add(4000);
  call(1, 'pulse');
  assert.equal(call(1, 'me').stats.playMs, 12000);
});

test('admin gifts show up once in the app', () => {
  const { g, mk, call } = setup();
  mk(1);
  g.admin.money('test', { id: 1, amount: 5000, note: 'Дякуємо!' });
  g.admin['give-car']('test', { id: 1, model: 'vaz-2106', notify: true });
  g.admin.message('test', { id: 1, text: 'Привіт' });
  const gifts = call(1, 'pulse').gifts;
  assert.deepEqual(gifts.map((x) => x.kind), ['money', 'car', 'message']);
  assert.equal(gifts[0].note, 'Дякуємо!');
  call(1, 'gifts/seen', { ids: gifts.map((x) => x.id) });
  assert.equal(call(1, 'pulse').gifts.length, 0);
});

test('pulse lists rewards ready to claim', () => {
  const { mk, call } = setup();
  mk(1);
  const kinds = call(1, 'pulse').claims.map((c) => c.kind);
  assert.ok(kinds.includes('daily'), 'daily bonus');
  assert.ok(kinds.includes('rcase'), 'reward case');
  call(1, 'rewards/daily');
  assert.ok(!call(1, 'pulse').claims.some((c) => c.kind === 'daily'), 'gone once claimed');
});
