// Owner decisions of 05.11 (d1-rules): auctions never give more cars than garage slots (car auctions and «Причал»),
// a live PvP where neither player finished refunds both bets, and the newbie come-back hint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, GameError } from '../src/game.js';
import * as S from '../public/shared.js';
import * as C from '../public/containers.js';
import { comebackHint, createHintSession, cashFullAt, COMEBACK_HINT } from '../public/comeback-hint.js';

const R = C.CONTAINER_RULES;

function setup(t0 = Date.parse('2026-11-05T10:00:00Z')) {
  const db = openDb(':memory:');
  let t = t0, n = 7;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true, containerSeed: () => (n = (n * 48271) % 2147483647) });
  const mk = (id, { slots = 40 } = {}) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET balance = 1e9, slots = ?, level = 12, level_seen = 12 WHERE id = ?').run(slots, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const err = (fn) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof GameError, `expected a GameError, got ${e?.constructor?.name}: ${e?.message}`);
      return e.message;
    }
    assert.fail('expected a refusal');
  };
  const bal = (id) => db.prepare('SELECT balance FROM users WHERE id = ?').get(id).balance;
  const garage = (id) => db.prepare("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status <> 'showcase'").get(id).n;
  const muteBots = (id) => {
    const L = db.prepare('SELECT bots FROM container_lots WHERE id = ?').get(id);
    db.prepare('UPDATE container_lots SET bots = ?, pending = NULL WHERE id = ?').run(JSON.stringify(JSON.parse(L.bots).map((b) => ({ ...b, max: 0 }))), id);
  };
  return { db, g, mk, call, err, bal, garage, muteBots, add: (ms) => (t += ms), at: () => t };
}
// A seller (id 1) with `n` cars on 1-hour auctions; returns the auction ids.
function auctions(ctx, n) {
  const { g, mk, call, db } = ctx;
  mk(1);
  g.giveCar(1, 'vaz-2107'); // the last garage car can't be auctioned
  for (let i = 0; i < n; i++) call(1, 'auction/create', { carId: g.giveCar(1, 'vaz-2107').id, startPrice: 1000, hours: 1 });
  return db.prepare("SELECT id FROM auctions WHERE status = 'open' ORDER BY id").all().map((r) => r.id);
}

// ---------- 1. auctions never give more cars than garage slots ----------
test('auction bid: every auction a player leads holds a free slot — 1 free slot, 1 auction at a time', () => {
  const ctx = setup();
  const { g, mk, call, err, garage, add, db } = ctx;
  const ids = auctions(ctx, 5);
  mk(3, { slots: 3 });
  g.giveCar(3, 'vaz-2107'), g.giveCar(3, 'vaz-2107'); // 2 of 3 slots used → 1 free
  call(3, 'auction/bid', { id: ids[0], amount: 1000 });
  assert.match(err(() => call(3, 'auction/bid', { id: ids[1], amount: 1000 })), /Звільни місце в гаражі — ти вже лідируєш у 1 аукціоні/);
  call(3, 'auction/bid', { id: ids[0], amount: 2000 }); // raising his own lead needs no new slot
  mk(4);
  call(4, 'auction/bid', { id: ids[0], amount: 5000 }); // outbid → the slot is free again
  call(3, 'auction/bid', { id: ids[1], amount: 1000 });
  for (const id of ids.slice(2)) err(() => call(3, 'auction/bid', { id, amount: 1000 }));
  add(3600e3 + 1);
  g.settleAuctions();
  assert.equal(garage(3), 3, 'he won exactly as many cars as he had free slots');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cars WHERE owner_id = 3 AND status = 'showcase'").get().n, 0);
  // a full garage: the plain message
  call(1, 'auction/create', { carId: g.giveCar(1, 'vaz-2107').id, startPrice: 1000, hours: 1 });
  const fresh = db.prepare("SELECT id FROM auctions WHERE status = 'open' ORDER BY id DESC").get().id;
  assert.match(err(() => call(3, 'auction/bid', { id: fresh, amount: 1000 })), /Гараж заповнений/);
});

test('auction bid: two leading lots need two free slots; the message counts them', () => {
  const ctx = setup();
  const { mk, call, err } = ctx;
  const ids = auctions(ctx, 3);
  mk(3, { slots: 2 }); // 2 free
  call(3, 'auction/bid', { id: ids[0], amount: 1000 });
  call(3, 'auction/bid', { id: ids[1], amount: 1000 });
  assert.match(err(() => call(3, 'auction/bid', { id: ids[2], amount: 1000 })), /лідируєш у 2 аукціонах/);
});

test('auction won with the garage filled after the bid: showcase if it has room, else refund and relist for an hour', () => {
  const ctx = setup();
  const { g, mk, call, bal, add, db } = ctx;
  const ids = auctions(ctx, 1);
  mk(3, { slots: 1 });
  db.prepare('UPDATE users SET showcase_slots = 1 WHERE id = 3').run();
  call(3, 'auction/bid', { id: ids[0], amount: 1000 });
  g.giveCar(3, 'vaz-2107'); // the garage filled up after the bid (a reward, a case…)
  add(3600e3 + 1);
  g.settleAuctions();
  const a0 = db.prepare('SELECT * FROM auctions WHERE id = ?').get(ids[0]);
  assert.equal(a0.status, 'done');
  assert.equal(db.prepare('SELECT owner_id, status FROM cars WHERE id = ?').get(a0.car_id).status, 'showcase', 'the showcase had a free place');
  // now both the garage and the showcase are full
  const b0 = bal(3);
  add(1000);
  call(1, 'auction/create', { carId: g.giveCar(1, 'vaz-2107').id, startPrice: 1000, hours: 1 });
  const a1 = db.prepare("SELECT * FROM auctions WHERE status = 'open' ORDER BY id DESC").get();
  db.prepare('UPDATE users SET slots = 2 WHERE id = 3').run(); // 1 free for the bid…
  call(3, 'auction/bid', { id: a1.id, amount: 7000 });
  g.giveCar(3, 'vaz-2107'); // …taken afterwards
  add(3600e3 + 1);
  g.settleAuctions();
  const r = db.prepare('SELECT * FROM auctions WHERE id = ?').get(a1.id);
  assert.equal(bal(3), b0, 'the winner has his bid back');
  assert.equal(r.status, 'open', 'the lot is up again');
  assert.equal(r.top_bidder, null);
  assert.ok(r.ends_at > ctx.at() + 3500e3, 'for another hour');
  assert.deepEqual({ ...db.prepare('SELECT owner_id, status FROM cars WHERE id = ?').get(r.car_id) }, { owner_id: 1, status: 'auction' });
  assert.ok(db.prepare('SELECT text FROM events WHERE user_id = 3').all().some((e) => /гараж заповнений.*повернуто/.test(e.text)), 'he is told why');
  add(3600e3 + 1);
  g.settleAuctions(); // nobody bid on the relisted lot → back to the seller as usual
  assert.deepEqual({ ...db.prepare('SELECT owner_id, status FROM cars WHERE id = ?').get(r.car_id) }, { owner_id: 1, status: 'garage' });
});

test('«Причал»: leading a car auction holds the slot a container bid needs, and the other way round', () => {
  const ctx = setup();
  const { mk, call, err, muteBots } = ctx;
  const ids = auctions(ctx, 1);
  mk(3, { slots: 1 }); // 1 free
  call(3, 'auction/bid', { id: ids[0], amount: 1000 });
  const l = call(3, 'containers').lots.find((x) => x.tier === 'odesa');
  muteBots(l.id);
  assert.match(err(() => call(3, 'containers/bid', { id: l.id, amount: l.minBid })), /лідируєш у 1 аукціоні/);
  mk(4, { slots: 1 });
  call(4, 'containers/bid', { id: l.id, amount: l.minBid });
  assert.match(err(() => call(4, 'auction/bid', { id: ids[0], amount: 5000 })), /лідируєш у 1 аукціоні/);
});

test('«Причал»: a lot won with the garage and the showcase full is cancelled and the bid refunded', () => {
  const ctx = setup();
  const { g, mk, call, bal, add, db, muteBots } = ctx;
  mk(5, { slots: 1 });
  db.prepare('UPDATE users SET showcase_slots = 0 WHERE id = 5').run();
  const l = call(5, 'containers').lots.find((x) => x.tier === 'odesa');
  muteBots(l.id);
  const b0 = bal(5);
  call(5, 'containers/bid', { id: l.id, amount: l.minBid });
  g.giveCar(5, 'vaz-2107'); // full after the bid
  add(R.liveMs + 1);
  const d = call(5, 'containers/lot', { id: l.id });
  assert.equal(d.lot.status, 'cancelled');
  assert.equal(bal(5), b0, 'the bid came back');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cars WHERE owner_id = 5 AND origin = 'container'").get().n, 0);
  assert.ok(call(5, 'containers').lots.some((x) => x.tier === 'odesa' && x.id !== l.id), 'a fresh lot came up');
});

// ---------- 2. live PvP: neither finished → both bets back ----------
function livePvp(ctx) {
  const { g, mk, call } = ctx;
  mk(1), mk(2);
  const a = g.giveCar(1, 'vaz-2107').id, b = g.giveCar(2, 'vaz-2109').id;
  const { id } = call(1, 'pvp/create', { carId: a, bet: 100000 });
  call(1, 'pulse');
  call(2, 'pvp/request', { id, carId: b });
  return { id, live: call(1, 'pvp/answer', { id, yes: true }) };
}
test('live PvP where neither player finishes: both bets refunded, no winner, no XP', () => {
  const ctx = setup();
  const { call, bal, add, db } = ctx;
  const { id } = livePvp(ctx);
  const b1 = 1e9, b2 = 1e9; // both made with 1e9; the bets are held now
  assert.ok(bal(1) < b1 && bal(2) < b2);
  const xp = (u) => db.prepare('SELECT xp FROM users WHERE id = ?').get(u).xp;
  const x1 = xp(1), x2 = xp(2);
  add(60e3);
  const s = call(1, 'pvp/state', { id });
  assert.equal(s.status, 'done');
  assert.equal(s.refund, true);
  assert.equal(s.win, false);
  const row = db.prepare('SELECT * FROM pvp WHERE id = ?').get(id);
  assert.equal(row.winner_id, null);
  assert.equal(bal(1), b1, 'creator has his bet back');
  assert.equal(bal(2), b2, 'opponent has his bet back');
  assert.equal(xp(1), x1), assert.equal(xp(2), x2);
  const h = call(2, 'pvp/list').history[0];
  assert.equal(h.refund, true);
  call(1, 'pvp/state', { id }); // settling again pays nothing more
  assert.equal(bal(1), b1);
});
test('live PvP where only one finishes: he still wins (the other is counted with a late start)', () => {
  const ctx = setup();
  const { call, add, db } = ctx;
  const { id, live } = livePvp(ctx);
  add(live.greenAt - ctx.at() + 15e3);
  call(1, 'pvp/finish', { id, reaction: 0.2, shifts: Array(S.SHIFTS).fill('good') });
  add(60e3);
  const s = call(1, 'pvp/state', { id });
  assert.equal(s.status, 'done');
  assert.equal(s.refund, false);
  assert.equal(db.prepare('SELECT winner_id FROM pvp WHERE id = ?').get(id).winner_id, 1);
});

// ---------- 3. the come-back hint ----------
const T = Date.parse('2026-11-05T10:00:00Z'); // 12:00 in Kyiv
const inc = { rate: 100000, capH: 4, since: T - 3600e3, banked: 0 }; // full at T + 3 h
test('come-back hint: a newbie with an empty tank is told when the tank and the cash are both full (Kyiv time)', () => {
  const h = comebackHint({ now: T, createdAt: T - 3600e3, fuel: 0, fuelFullAt: T + 2 * 3600e3, income: inc });
  assert.equal(h.text, 'Повернись о 15:00 — каса і паливо будуть повні');
  assert.equal(h.at, cashFullAt(inc));
  // the tank takes longer than the cash
  assert.equal(comebackHint({ now: T, createdAt: T, fuel: 0, fuelFullAt: T + 5.5 * 3600e3, income: inc }).text, 'Повернись о 17:30 — каса і паливо будуть повні');
  // after midnight in Kyiv
  assert.match(comebackHint({ now: Date.parse('2026-11-05T20:00:00Z'), createdAt: T, fuel: 0, fuelFullAt: Date.parse('2026-11-05T23:10:00Z'), income: null }).text, /^Повернись завтра о 01:10 — бак буде повний$/);
});
test('come-back hint: not for old accounts, not with fuel, not when it is minutes away; once per session', () => {
  const base = { now: T, createdAt: T - 3600e3, fuel: 0, fuelFullAt: T + 2 * 3600e3, income: inc };
  assert.equal(comebackHint({ ...base, createdAt: T - (COMEBACK_HINT.maxAgeDays + 1) * 86400e3 }), null);
  assert.equal(comebackHint({ ...base, fuel: 1 }), null);
  assert.equal(comebackHint({ ...base, fuelFullAt: T + 5 * 60e3, income: null }), null);
  const pick = createHintSession();
  assert.equal(pick({ ...base, fuel: 3 }), null, 'nothing while there is fuel');
  const first = pick(base);
  assert.ok(first);
  assert.equal(pick({ ...base, now: T + 60e3 }), first, 'the same line on every redraw while the tank is empty');
  assert.equal(pick({ ...base, fuel: 1 }), null);
  assert.equal(pick(base), null, 'never again in this session');
});
test('me: createdAt and fuelFullAt (when the shared tank is full again) for the hint', () => {
  const ctx = setup();
  const { mk, call, db, at } = ctx;
  mk(1);
  db.prepare('UPDATE users SET fuel = 0, fuel_at = ?, vip_until = 0 WHERE id = 1').run(at());
  const me = call(1, 'me');
  assert.equal(me.fuel, 0);
  assert.equal(typeof me.createdAt, 'number');
  assert.ok(me.fuelFullAt > at(), 'in the future');
  assert.ok(Math.abs(me.fuelFullAt - (at() + me.fuelMax * S.FUEL_REGEN_MIN * 60e3)) <= me.fuelMax * S.FUEL_REGEN_MIN * 60e3 * 0.5, 'about max × regen away');
  assert.ok(me.fuelFullAt >= me.fuelNext);
  db.prepare('UPDATE users SET fuel = ? WHERE id = 1').run(me.fuelMax);
  assert.equal(call(1, 'me').fuelFullAt, null);
});
