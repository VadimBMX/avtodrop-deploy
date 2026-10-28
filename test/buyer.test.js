// «Таємний покупець» (public/buyer.js, src/buyer.js): one offer a Kyiv day from level 2, frozen per player + day from a
// server seed, 3 hours, one matching car sold in one tap for the dealer's price + a premium (never the last car, not a car
// on the market, no secret / edition cars), the «чекає ще 1 год» reminder, the admin numbers — and the economy: opening
// cases to sell to the buyer is never profitable on average.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { pickReminder, PUSH, KINDS, groupOf } from '../src/reminders.js';
import * as S from '../public/shared.js';
import * as B from '../public/buyer.js';

const K = (s) => Date.parse(s + '+02:00'); // Kyiv wall clock (UTC+2 after 25.10)
const H = 3600e3;

function setup({ t0 = K('2026-10-28T12:00:00'), seed = 'ab'.repeat(32) } = {}) {
  let t = t0;
  const db = openDb(':memory:');
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('buyer_seed', seed);
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {} });
  const mk = (id, level = 5, balance = 1e6) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ?, slots = 40 WHERE id = ?').run(level, level, balance, id);
    db.prepare('DELETE FROM cars WHERE owner_id = ?').run(id);
    return id;
  };
  const car = (uid, model, status = 'garage') => Number(db.prepare('INSERT INTO cars (owner_id, model, tank, tank_at, created_at, dirt_at, status) VALUES (?, ?, 3, ?, ?, ?, ?)')
    .run(uid, model, t, t - 48 * H, t, status).lastInsertRowid);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  // Puts a chosen offer in place of today's (the request is otherwise rolled from the seed).
  const plantOffer = (uid, req, prem = 0.4, at = t) => {
    db.prepare('DELETE FROM buyer_offers WHERE user_id = ?').run(uid);
    db.prepare('INSERT INTO buyer_offers (user_id, day, kind, req, prem, city, line, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid, dayKey(at), 'own', JSON.stringify(req), prem, 'Одеси', 'Шукаю…', at, at + B.BUYER.hours * H);
  };
  return { db, g, mk, car, call, bal, plantOffer, add: (ms) => (t += ms), set: (x) => (t = x), at: () => t };
}
const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date(t));
const D_CAR = B.BUYABLE.find((m) => m.cls === 'D' && m.country === 'UA').id;
const C_CAR = B.BUYABLE.find((m) => m.cls === 'C').id;

// ---------- the economy ----------
test('no profit: for every case and every request, the premium on the asked car never makes «open until it drops» pay', () => {
  const reqs = [...B.BUYABLE.map((m) => ({ model: m.id })), ...B.GROUPS];
  let checked = 0;
  for (const cs of S.CASES.filter((c) => !c.starter)) {
    const price = cs.group === 'rarity' ? cs.price * (1 - S.CASE_OF_DAY.off) : cs.price; // the «Кейс дня» price too
    const back = cs.sellEv * B.BUYER.safety; // open-and-sell with the hidden boost, luck and key fragments on top
    for (const req of reqs) {
      const cap = B.premCap(req);
      const d = B.dropOf(cs, req);
      if (!d.p) continue;
      checked++;
      const extra = Math.min(cap, B.BUYER.prem.stretch[1]) * d.sell * d.p; // what the offer adds to one open, on average
      if (back < price) {
        // Sub-par case: still a loss with the buyer. Equivalently: the bonus < the expected loss of the 1/p opens it takes.
        assert.ok(back + extra < price, `${cs.id} ${B.reqKey(req)}: ${Math.round(back + extra)} ≥ ${price}`);
        assert.ok(Math.min(cap, 0.6) * d.sell <= (price - back) / d.p + 1e-6, `${cs.id} ${B.reqKey(req)}: farming pays`);
      } else {
        // Already ≥ 1 (owner 22.10: OK for some dear cases): the buyer adds at most 1 % of the price per open.
        assert.ok(extra <= B.BUYER.abovePar * price + 1e-6, `${cs.id} ${B.reqKey(req)}: +${Math.round(extra)} per open`);
      }
    }
  }
  assert.ok(checked > 300, `checked ${checked} case × request pairs`);
});

test('offers: premium within its range and the cap, never above 80 % of the model price; mostly reachable requests', () => {
  let h = 7;
  const rnd = () => ((h = (h * 1103515245 + 12345) % 2147483648) / 2147483648);
  const kinds = {};
  for (let i = 0; i < 3000; i++) {
    const own = i % 3 ? [D_CAR, C_CAR] : [];
    const r = B.pickRequest(rnd, { own, balance: [0, 3e5, 2e6, 1e7, 1e9][i % 5] });
    kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    assert.ok(r.prem >= B.BUYER.minPrem && r.prem <= B.BUYER.prem.stretch[1], `prem ${r.prem}`);
    assert.ok(r.prem <= B.premCap(r.req) + 1e-9, `${B.reqKey(r.req)}: ${r.prem} > cap`);
    assert.ok(B.reqModels(r.req).length >= 1);
    for (const m of B.reqModels(r.req)) assert.ok(B.payOf(S.sellPriceOf(m.id), r.prem) <= 0.8 * m.price + 1, m.id);
    assert.match(r.line, /\S/);
    assert.ok(!/\{w\}/.test(r.line));
  }
  assert.ok(kinds.own > 600 && kinds.reach > 600 && kinds.stretch > 150, JSON.stringify(kinds));
  // No secret, edition, R-version or collector car is ever asked for or taken.
  assert.ok(B.BUYABLE.every((m) => !m.secret && !m.edition && !m.homeOnly));
  const ed = Object.values(S.MODELS).find((m) => m.edition && !m.restored);
  assert.equal(B.matches({ cls: ed.cls, country: ed.country }, ed.id), false);
  const sec = Object.values(S.MODELS).find((m) => m.secret);
  assert.equal(B.matches({ model: sec.id }, sec.id), false);
});

// ---------- the offer of the day ----------
test('offer: from level 2, once a Kyiv day, deterministic per player + day + seed, frozen once made, 3 hours', () => {
  const a = setup(), b = setup();
  for (const x of [a, b]) {
    x.mk(10, 1);
    x.car(10, D_CAR);
    x.car(10, C_CAR);
  }
  assert.equal(a.call(10, 'me').buyer, null, 'level 1: no buyer');
  for (const x of [a, b]) x.db.prepare('UPDATE users SET level = 2 WHERE id = 10').run();
  const o1 = a.call(10, 'me').buyer, o2 = b.call(10, 'me').buyer;
  assert.ok(o1 && o1.text && o1.city && o1.prem >= B.BUYER.minPrem);
  assert.deepEqual({ ...o1, cars: null }, { ...o2, cars: null }, 'same seed, player, day, garage → same offer');
  assert.equal(o1.expiresAt - o1.createdAt, B.BUYER.hours * H);
  // A garage change later the same day doesn't swap it.
  a.car(10, B.BUYABLE.find((m) => m.cls === 'S').id);
  a.add(H);
  assert.deepEqual(a.call(10, 'me').buyer.req, o1.req);
  // Over: gone for the rest of the day; the next day brings a new one.
  a.add(2.5 * H);
  assert.equal(a.call(10, 'me').buyer, null);
  assert.equal(a.db.prepare('SELECT COUNT(*) n FROM buyer_offers WHERE user_id = 10').get().n, 1);
  a.set(K('2026-10-29T10:00:00'));
  const n = a.call(10, 'me').buyer;
  assert.ok(n && n.day === '2026-10-29');
  // Another seed → (almost surely) another stream: the request comes from the seed, not from the clock alone.
  const offers = new Set();
  for (const seed of ['01', '02', '03', '04', '05', '06'].map((s) => s.repeat(32))) {
    const x = setup({ seed });
    x.mk(10, 3, 5e6);
    x.car(10, D_CAR);
    x.car(10, C_CAR);
    offers.add(JSON.stringify(x.call(10, 'me').buyer.req) + x.call(10, 'me').buyer.prem);
  }
  assert.ok(offers.size >= 3);
});

test('sell: one tap, dealer price + premium; never twice, never a car he does not ask for, never the last car or a car on the market', () => {
  const x = setup();
  x.mk(11, 4, 1000);
  const id = x.car(11, D_CAR);
  x.plantOffer(11, { model: D_CAR }, 0.4);
  // The only car: not even to the buyer.
  assert.equal(x.call(11, 'me').buyer.lastCar, true);
  assert.throws(() => x.call(11, 'buyer/sell', { carId: id }), /Останню машину/);
  const other = x.car(11, C_CAR);
  assert.throws(() => x.call(11, 'buyer/sell', { carId: other }), /Покупець шукає/);
  const onMarket = x.car(11, D_CAR, 'market');
  assert.throws(() => x.call(11, 'buyer/sell', { carId: onMarket }), /ринку або аукціоні/);
  // Someone else's car.
  const y = x.mk(12, 4);
  x.car(12, D_CAR);
  const theirs = x.car(12, D_CAR);
  assert.throws(() => x.call(11, 'buyer/sell', { carId: theirs }), /не твоє/);
  const me = x.call(11, 'me').buyer;
  assert.deepEqual(me.cars.map((c) => c.id), [id], 'the car on the market is not offered');
  const sell = S.sellPriceOf(D_CAR);
  assert.equal(me.cars[0].pay, Math.floor(sell * 1.4));
  const before = x.bal(11);
  const r = x.call(11, 'buyer/sell', { carId: id });
  assert.equal(r.got, Math.floor(sell * 1.4));
  assert.equal(r.bonus, r.got - sell);
  assert.equal(x.bal(11) - before, r.got);
  assert.ok(!x.db.prepare('SELECT 1 FROM cars WHERE id = ?').get(id));
  const after = x.call(11, 'me').buyer;
  assert.equal(after.sold.paid, r.got);
  assert.deepEqual(after.cars, []);
  const id2 = x.car(11, D_CAR);
  assert.throws(() => x.call(11, 'buyer/sell', { carId: id2 }), /уже купив/);
  // A gone buyer.
  x.plantOffer(12, { model: D_CAR }, 0.3);
  x.add(3 * H + 1);
  assert.throws(() => x.call(y, 'buyer/sell', { carId: theirs }), /поїхав/);
  // Level 1: the call is refused by the gate.
  const z = x.mk(13, 1);
  x.car(13, D_CAR);
  assert.throws(() => x.call(z, 'buyer/sell', { carId: x.car(13, D_CAR) }), /рівні 2/);
});

test('sell: a «class + country» request takes any such car, parts go back to the warehouse', () => {
  const x = setup();
  x.mk(14, 4);
  const grp = B.GROUPS.find((g) => g.cls === 'C');
  const [m1, m2] = B.reqModels(grp);
  const a = x.car(14, m1.id), b2 = x.car(14, m2.id);
  x.car(14, D_CAR);
  x.db.prepare("INSERT INTO car_parts (car_id, type, tier) VALUES (?, 'engine', 'stock')").run(b2);
  x.plantOffer(14, grp, 0.3);
  const me = x.call(14, 'me').buyer;
  assert.match(me.text, /машину класу C/);
  assert.deepEqual(me.cars.map((c) => c.id).sort(), [a, b2].sort());
  x.call(14, 'buyer/sell', { carId: b2 });
  assert.equal(x.db.prepare("SELECT count FROM parts WHERE user_id = 14 AND type = 'engine' AND tier = 'stock'").get()?.count, 1);
});

// ---------- the bot ----------
test('bot: «покупець чекає ще 1 год» only with a matching car, within the reminder limits; the admin numbers', () => {
  assert.ok(KINDS.includes('buyer'));
  assert.equal(groupOf('buyer'), 'garage');
  const x = setup({ t0: K('2026-10-28T12:00:00') });
  x.mk(15, 4);
  x.car(15, D_CAR);
  x.car(15, C_CAR);
  x.plantOffer(15, { model: D_CAR }, 0.35);
  x.mk(16, 4);
  x.car(16, C_CAR);
  x.car(16, C_CAR);
  x.plantOffer(16, { model: D_CAR }, 0.35); // has none of it: no nudge
  x.db.prepare('UPDATE users SET last_seen = ? WHERE id IN (15, 16)').run(K('2026-10-28T12:10:00'));
  x.set(K('2026-10-28T13:30:00')); // 1.5 h left: too early
  assert.ok(!x.g.pushCandidates(PUSH).find((c) => c.uid === 15)?.ready.some((r) => r.kind === 'buyer'));
  x.set(K('2026-10-28T14:00:00')); // 1 h left
  const c = x.g.pushCandidates(PUSH).find((v) => v.uid === 15);
  const item = c.ready.find((r) => r.kind === 'buyer');
  assert.match(item.text, /Таємний покупець з Одеси чекає ще 1 год: .+ \+35% до ціни дилера/);
  assert.ok(pickReminder(c, K('2026-10-28T14:00:00')).includes('buyer'));
  assert.ok(!x.g.pushCandidates(PUSH).find((v) => v.uid === 16)?.ready.some((r) => r.kind === 'buyer'));
  // Muted with the «Гараж» group.
  assert.ok(!(pickReminder({ ...c, mute: 'garage' }, K('2026-10-28T14:00:00')) || []).includes('buyer'));

  const id = x.db.prepare('SELECT id FROM cars WHERE owner_id = 15 AND model = ?').get(D_CAR).id;
  const r = x.call(15, 'buyer/sell', { carId: id });
  const st = x.g.adminCall(1, 'buyer', {});
  assert.equal(st.all.offers, 2);
  assert.equal(st.all.sold, 1);
  assert.equal(st.all.paid, r.got);
  assert.equal(st.all.bonus, r.bonus);
  assert.equal(st.today.offers, 2);
  assert.equal(st.days[0].day, '2026-10-28');
});
