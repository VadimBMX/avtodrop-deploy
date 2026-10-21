// Player market of parts and plates (S.ITEM_MARKET): list / buy / cancel / expiry, atomic money and item moves,
// no double sale, price bounds, items locked while listed, the «вигідна ціна» badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const IM = S.ITEM_MARKET;
const SPORT = S.TIER_BY_ID.sport.price;

function setup(t0 = Date.parse('2026-10-21T10:00:00Z')) {
  const db = openDb(':memory:');
  let t = t0;
  const clock = { now: () => t, add: (ms) => (t += ms) };
  const g = createGame(db, { now: clock.now, notify: () => {}, random: () => 0.5 });
  const mk = (id, balance = 1e9) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET balance = ?, slots = 40 WHERE id = ?').run(balance, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const bal = (id) => db.prepare('SELECT balance FROM users WHERE id = ?').get(id).balance;
  const parts = (id, type, tier) => db.prepare('SELECT count FROM parts WHERE user_id = ? AND type = ? AND tier = ?').get(id, type, tier)?.count || 0;
  const plate = (owner, text, value, carId = null) =>
    Number(db.prepare('INSERT INTO plates (owner_id, text, cls, value, car_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(owner, text, S.plateInfo(text).cls, value, carId, t).lastInsertRowid);
  const plateRow = (id) => db.prepare('SELECT * FROM plates WHERE id = ?').get(id);
  const lots = () => db.prepare('SELECT COUNT(*) n FROM item_listings').get().n;
  const money = () => db.prepare('SELECT COALESCE(SUM(created), 0) c, COALESCE(SUM(destroyed), 0) d FROM money_days').get();
  return { db, g, clock, mk, call, bal, parts, plate, plateRow, lots, money };
}
const sellPart = (call, uid, type, tier, count, price) => call(uid, 'market/item-sell', { kind: 'part', type, tier, count, price }).id;

test('part lot: listing takes the pieces off the warehouse, buying moves them, money and fee add up', () => {
  const { g, mk, call, bal, parts, money } = setup();
  mk(1);
  mk(2);
  g.addPart(1, 'eng', 'sport', 5);
  const id = sellPart(call, 1, 'eng', 'sport', 3, 3 * SPORT);
  assert.equal(parts(1, 'eng', 'sport'), 2, 'three pieces are held by the lot');
  const seen = call(2, 'market/items', { kind: 'part' }).list.find((l) => l.id === id);
  assert.equal(seen.count, 3);
  assert.equal(seen.unit, SPORT);
  assert.equal(seen.mine, false);
  const b1 = bal(1), b2 = bal(2), m0 = money();
  const r = call(2, 'market/item-buy', { id });
  assert.deepEqual(r.part, { type: 'eng', tier: 'sport', count: 3 });
  const price = 3 * SPORT, got = Math.floor(price * (1 - S.FEE));
  assert.equal(bal(2), b2 - price);
  assert.equal(bal(1), b1 + got);
  assert.equal(parts(2, 'eng', 'sport'), 3);
  // Admin "money created/destroyed": the price leaves with the buyer, price − fee comes to the seller: net −fee.
  const m1 = money();
  assert.equal((m1.d - m0.d) - (m1.c - m0.c), price - got);
});

test('plate lot: buyer becomes the owner; fee logged in item_sales', () => {
  const { db, mk, call, bal, plate, plateRow } = setup();
  mk(1);
  mk(2);
  const pid = plate(1, 'KA 7777 KA', 2_000_000);
  const { id } = call(1, 'market/item-sell', { kind: 'plate', plateId: pid, price: 2_500_000 });
  const b2 = bal(2);
  call(2, 'market/item-buy', { id });
  assert.equal(plateRow(pid).owner_id, 2);
  assert.equal(plateRow(pid).car_id, null);
  assert.equal(bal(2), b2 - 2_500_000);
  const s = db.prepare('SELECT * FROM item_sales').get();
  assert.equal(s.kind, 'plate');
  assert.equal(s.fee, 2_500_000 - Math.floor(2_500_000 * (1 - S.FEE)));
  assert.equal(s.plate_text, 'KA 7777 KA');
  // The new owner can use it at once.
  const car = (call(2, 'me').cars[0] || {}).id;
  if (car) call(2, 'plate/attach', { plateId: pid, carId: car });
});

test('cancel returns the item; cannot buy own lot; cannot double-sell', () => {
  const { g, mk, call, parts, lots, bal } = setup();
  mk(1);
  mk(2);
  mk(3);
  g.addPart(1, 'turbo', 'pro', 2);
  const id = sellPart(call, 1, 'turbo', 'pro', 2, 2 * S.TIER_BY_ID.pro.price);
  assert.throws(() => call(1, 'market/item-buy', { id }), /твій лот/);
  assert.throws(() => call(2, 'market/item-cancel', { id }), /не знайдено/);
  call(1, 'market/item-cancel', { id });
  assert.equal(parts(1, 'turbo', 'pro'), 2);
  assert.equal(lots(), 0);
  const id2 = sellPart(call, 1, 'turbo', 'pro', 1, S.TIER_BY_ID.pro.price);
  call(2, 'market/item-buy', { id: id2 });
  const b3 = bal(3);
  assert.throws(() => call(3, 'market/item-buy', { id: id2 }), /продано/);
  assert.throws(() => call(1, 'market/item-cancel', { id: id2 }), /не знайдено/);
  assert.equal(bal(3), b3);
  assert.equal(parts(2, 'turbo', 'pro'), 1);
  assert.equal(parts(3, 'turbo', 'pro'), 0);
});

test('atomic: a buyer without money changes nothing', () => {
  const { g, mk, call, bal, parts, lots, money } = setup();
  mk(1);
  mk(2, 1000);
  g.addPart(1, 'body', 'race', 1);
  const id = sellPart(call, 1, 'body', 'race', 1, S.TIER_BY_ID.race.price);
  const b1 = bal(1), m0 = money();
  assert.throws(() => call(2, 'market/item-buy', { id }), /Недостатньо/);
  assert.equal(bal(1), b1);
  assert.equal(bal(2), 1000);
  assert.equal(parts(2, 'body', 'race'), 0);
  assert.equal(lots(), 1);
  assert.deepEqual(money(), m0);
});

test('atomic: a failure after the money moved rolls everything back', () => {
  const { db, mk, call, bal, plate, plateRow, lots } = setup();
  mk(1);
  mk(2);
  const pid = plate(1, 'AA 0001 AA', 1_500_000);
  const { id } = call(1, 'market/item-sell', { kind: 'plate', plateId: pid, price: 1_500_000 });
  // Make the plate move fail after pay/addMoney ran (a broken row), via a trigger.
  db.exec("CREATE TEMP TRIGGER boom BEFORE UPDATE OF owner_id ON plates BEGIN SELECT RAISE(ABORT, 'boom'); END");
  const b1 = bal(1), b2 = bal(2);
  assert.throws(() => call(2, 'market/item-buy', { id }), /boom/);
  db.exec('DROP TRIGGER boom');
  assert.equal(bal(1), b1);
  assert.equal(bal(2), b2);
  assert.equal(plateRow(pid).owner_id, 1);
  assert.equal(lots(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM item_sales').get().n, 0);
});

test('price bounds per piece, lot limit, count limit, unknown items', () => {
  const { g, mk, call, plate } = setup();
  mk(1);
  g.addPart(1, 'wheels', 'sport', 100);
  const [lo, hi] = S.itemPriceRange(SPORT, 2);
  assert.throws(() => sellPart(call, 1, 'wheels', 'sport', 2, lo - 1), /Ціна має бути/);
  assert.throws(() => sellPart(call, 1, 'wheels', 'sport', 2, hi + 1), /Ціна має бути/);
  assert.throws(() => sellPart(call, 1, 'wheels', 'sport', IM.maxCount + 1, SPORT * (IM.maxCount + 1)), /Кількість/);
  assert.throws(() => sellPart(call, 1, 'wheels', 'nope', 1, SPORT), /Невідома/);
  assert.throws(() => sellPart(call, 1, 'constructor', 'sport', 1, SPORT), /Невідома/);
  assert.throws(() => sellPart(call, 1, 'wheels', 'sport', 101, 101 * SPORT), /Кількість|немає/);
  sellPart(call, 1, 'wheels', 'sport', 2, lo);
  sellPart(call, 1, 'wheels', 'sport', 2, hi);
  const p = plate(1, 'BC 1234 HK', 50_000);
  assert.throws(() => call(1, 'market/item-sell', { kind: 'plate', plateId: p, price: 50_000 * IM.maxRate + 1 }), /Ціна має бути/);
  for (let i = 2; i < IM.lots; i++) sellPart(call, 1, 'wheels', 'sport', 1, SPORT);
  assert.throws(() => sellPart(call, 1, 'wheels', 'sport', 1, SPORT), /Максимум/);
});

test('cooling parts and plates on cars: not listable unless detached', () => {
  const { g, mk, call, parts, plate, plateRow } = setup();
  mk(1);
  const car = g.giveCar(1, S.ALL_MODELS.find((m) => m.cls === 'D' && !m.ev && !m.secret).id).id;
  g.addPart(1, 'brakes', 'stock', 1);
  call(1, 'parts/install', { carId: car, type: 'brakes', tier: 'stock' });
  call(1, 'parts/uninstall', { carId: car, type: 'brakes' });
  assert.equal(parts(1, 'brakes', 'stock'), 1);
  assert.throws(() => sellPart(call, 1, 'brakes', 'stock', 1, S.TIER_BY_ID.stock.price), /остигають/);
  const pid = plate(1, 'KA 1111 KA', 300_000, car);
  assert.throws(() => call(1, 'market/item-sell', { kind: 'plate', plateId: pid, price: 300_000 }), /зніми/);
  call(1, 'market/item-sell', { kind: 'plate', plateId: pid, price: 300_000, detach: true });
  assert.equal(plateRow(pid).car_id, null, 'detached with consent');
  assert.throws(() => call(1, 'market/item-sell', { kind: 'plate', plateId: pid, price: 300_000 }), /уже на ринку/);
});

test('listed items are locked: install, merge, dealer sale of parts; attach and dealer sale of plates', () => {
  const { g, mk, call, plate, plateRow } = setup();
  mk(1);
  mk(2);
  const car = g.giveCar(1, S.ALL_MODELS.find((m) => m.cls === 'D' && !m.ev && !m.secret).id).id;
  g.addPart(1, 'exhaust', 'street', 3);
  const id = sellPart(call, 1, 'exhaust', 'street', 3, 3 * S.TIER_BY_ID.street.price);
  assert.throws(() => call(1, 'parts/install', { carId: car, type: 'exhaust', tier: 'street' }), /Немає вільної/);
  assert.throws(() => call(1, 'parts/merge', { type: 'exhaust', tier: 'street' }), /Немає вільної/);
  assert.throws(() => call(1, 'parts/sell', { type: 'exhaust', tier: 'street', count: 1 }), /Немає вільної/);
  assert.ok(!call(1, 'me').parts.some((p) => p.type === 'exhaust'), 'listed pieces are not in the warehouse');
  call(1, 'market/item-cancel', { id });
  call(1, 'parts/merge', { type: 'exhaust', tier: 'street' }); // free again
  const pid = plate(1, 'AX 2222 AX', 400_000);
  call(1, 'market/item-sell', { kind: 'plate', plateId: pid, price: 400_000 });
  assert.throws(() => call(1, 'plate/attach', { plateId: pid, carId: car }), /на ринок/);
  assert.throws(() => call(1, 'plate/sell', { plateId: pid }), /на ринок/);
  assert.equal(plateRow(pid).car_id, null);
  assert.equal(plateRow(pid).owner_id, 1);
});

test('expiry returns the item and tells the seller; expired lots cannot be bought', () => {
  const { db, g, clock, mk, call, parts, plate, lots } = setup();
  mk(1);
  mk(2);
  g.addPart(1, 'gearbox', 'sport', 2);
  const id = sellPart(call, 1, 'gearbox', 'sport', 2, 2 * SPORT);
  const pid = plate(1, 'BH 3333 BH', 250_000);
  call(1, 'market/item-sell', { kind: 'plate', plateId: pid, price: 250_000 });
  clock.add(IM.hours * 3600e3 - 1000);
  assert.equal(lots(), 2);
  clock.add(2000);
  assert.throws(() => call(2, 'market/item-buy', { id }), /продано/);
  call(2, 'market/items', { kind: 'part' }); // any market read closes expired lots
  assert.equal(lots(), 0);
  assert.equal(parts(1, 'gearbox', 'sport'), 2);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM events WHERE user_id = 1 AND text LIKE '⌛%'").get().n >= 2);
  call(1, 'plate/sell', { plateId: pid }); // the plate is free again
  // The server's sweeper (settleAuctions) expires lots too.
  g.addPart(1, 'gearbox', 'sport', 1);
  sellPart(call, 1, 'gearbox', 'sport', 1, SPORT);
  clock.add(IM.hours * 3600e3 + 1);
  g.settleAuctions();
  assert.equal(lots(), 0);
});

test('badge «вигідна ціна»: base value with few samples, median of recent sales and other sellers once there are enough', () => {
  const { g, mk, call } = setup();
  for (const id of [1, 2, 3, 4, 5, 6]) mk(id);
  for (const id of [1, 2, 3, 4, 5]) g.addPart(id, 'suspension', 'sport', 20);
  const items = (uid = 6) => call(uid, 'market/items', { kind: 'part', type: 'suspension' }).list;
  // No history: the reference is the base value; 80 % of it is a deal, 81 % is not.
  const a = sellPart(call, 1, 'suspension', 'sport', 1, Math.floor(SPORT * IM.dealRate));
  const b = sellPart(call, 2, 'suspension', 'sport', 1, Math.ceil(SPORT * 0.81));
  let l = items();
  assert.equal(l.find((x) => x.id === a).deal, true);
  assert.equal(l.find((x) => x.id === b).deal, false);
  assert.equal(l.find((x) => x.id === a).ref, SPORT);
  // Three sales at 2× base: the reference doubles, so 1.5× is now a good deal.
  for (const s of [3, 4, 5]) call(6, 'market/item-buy', { id: sellPart(call, s, 'suspension', 'sport', 1, 2 * SPORT) });
  const c = sellPart(call, 3, 'suspension', 'sport', 1, 1.5 * SPORT);
  l = items();
  const lc = l.find((x) => x.id === c);
  assert.ok(lc.ref > 1.5 * SPORT, `reference follows the sales (${lc.ref})`);
  assert.equal(lc.deal, true);
  assert.ok(lc.pct < 0);
  // One seller piling up overpriced lots counts once (his cheapest), and never for his own lots.
  const { median, itemRefRatio, isItemDeal } = S;
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(itemRefRatio([2, 2]), 1, 'fewer than refMin samples → base value');
  assert.equal(itemRefRatio([2, 2, 2]), 2);
  assert.equal(isItemDeal(80, 100, 1), true);
  assert.equal(isItemDeal(81, 100, 1), false);
  // Sorting by deal puts the best ratio first; filters by tier work.
  l = call(6, 'market/items', { kind: 'part', sort: 'deal' }).list;
  assert.equal(l[0].id, a);
  assert.equal(call(6, 'market/items', { kind: 'part', tier: 'pro' }).list.length, 0);
});

test('plate search: class, region (name or code), text; own lots listed in mine', () => {
  const { mk, call, plate } = setup();
  mk(1);
  mk(2);
  const p1 = plate(1, 'KA 7777 KA', 2_000_000);
  const p2 = plate(1, 'BC 1234 HK', 60_000);
  call(1, 'market/item-sell', { kind: 'plate', plateId: p1, price: 2_000_000 });
  call(1, 'market/item-sell', { kind: 'plate', plateId: p2, price: 60_000 });
  const f = (b) => call(2, 'market/items', { kind: 'plate', ...b }).list.map((l) => l.plate.text);
  assert.deepEqual(f({ cls: 'S' }), ['KA 7777 KA']);
  assert.deepEqual(f({ region: 'м. Київ' }), ['KA 7777 KA']);
  assert.deepEqual(f({ region: 'bc' }), ['BC 1234 HK']);
  assert.deepEqual(f({ query: '1234' }), ['BC 1234 HK']);
  assert.deepEqual(f({ query: 'ка77' }), ['KA 7777 KA'], 'Cyrillic look-alikes');
  assert.deepEqual(f({ sort: 'cheap' }), ['BC 1234 HK', 'KA 7777 KA']);
  const me = call(1, 'market/items', { kind: 'part' });
  assert.equal(me.mine.length, 2);
  assert.equal(me.list.length, 0);
});

test('admin: removing a lot, banning, removing a plate and the overview', () => {
  const { g, mk, call, parts, plate, lots } = setup();
  mk(1);
  mk(2);
  g.addPart(1, 'eng', 'pro', 2);
  const id = sellPart(call, 1, 'eng', 'pro', 1, S.TIER_BY_ID.pro.price);
  assert.equal(g.admin.market('key').items.length, 1);
  g.admin['market/remove']('key', { kind: 'item', id });
  assert.equal(parts(1, 'eng', 'pro'), 2);
  sellPart(call, 1, 'eng', 'pro', 2, 2 * S.TIER_BY_ID.pro.price);
  const pid = plate(1, 'AE 5555 AE', 300_000);
  call(1, 'market/item-sell', { kind: 'plate', plateId: pid, price: 300_000 });
  assert.equal(g.admin.overview('key').itemListings, 2);
  g.admin.ban('key', { id: 1, banned: true, reason: 'test' });
  assert.equal(lots(), 0);
  assert.equal(parts(1, 'eng', 'pro'), 2);
  g.admin.ban('key', { id: 1, banned: false });
  call(1, 'market/item-sell', { kind: 'plate', plateId: pid, price: 300_000 });
  g.admin['remove-plate']('key', { plateId: pid });
  assert.equal(lots(), 0);
});
