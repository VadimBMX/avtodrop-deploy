// «🔨 Аукціон номера» (src/plate-auction.js): admins launch it for a free plate, players bid with escrow and refunds,
// anti-snipe extension with a cap, settlement gives the plate to the winner (the winning bid is a money sink), cancel
// refunds, helpers can't create, `me` / the page are empty while nothing runs, the group posts the start and the result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createChannel } from '../src/channel.js';
import { PLATE_AUCTION as R, dealerPriceOf } from '../src/plate-auction.js';
import * as S from '../public/shared.js';

const T0 = Date.parse('2026-10-29T10:00:00Z');
const START = dealerPriceOf('S'); // AA 7777 AA is class S

function setup() {
  let t = T0;
  const pushes = [];
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], random: () => 0.5, notify: (u, x) => pushes.push([u, x]) });
  const mk = (id, { balance = 50e6, level = 10 } = {}) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ? WHERE id = ?').run(level, level, balance, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const owner = (name, body = {}) => g.adminCall('tg:1', name, { confirm: true, ...body });
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  const create = (b = {}) => owner('plate-auction/create', { text: 'аа 7777 аа', startPrice: START, step: 10000, hours: 1, ...b }).auction;
  const row = (id) => db.prepare('SELECT * FROM plate_auctions WHERE id = ?').get(id);
  return { db, g, mk, call, owner, bal, create, row, pushes, at: () => t, add: (ms) => (t += ms) };
}

test('plate auction: create validates the plate like give-plate and refuses an owned / listed / doubled one', () => {
  const s = setup();
  const u = s.mk(2);
  assert.throws(() => s.create({ text: 'AA 77 AA' }), /Формат номера/);
  assert.throws(() => s.create({ text: 'ZZ 7777 AA' }), /Регіону ZZ не існує/);
  assert.throws(() => s.create({ text: 'AA 7777 AZ' }), /лише літери/);
  assert.throws(() => s.create({ hours: 0.2 }), /Тривалість/);
  assert.throws(() => s.create({ hours: 73 }), /Тривалість/);
  assert.throws(() => s.create({ startPrice: START - 1 }), /не менше/, 'below the dealer price would print money');
  // owned (and so also any listed plate: a market lot is always an owned plate)
  s.owner('give-plate', { id: u, text: 'KA 1111 KA' });
  assert.throws(() => s.create({ text: 'ka1111ka' }), /уже має/);
  const pid = s.db.prepare("SELECT id FROM plates WHERE text = 'KA 1111 KA'").get().id;
  s.db.prepare("INSERT INTO item_listings (seller_id, kind, item_key, plate_id, count, price, base, created_at, expires_at) VALUES (?, 'plate', 'plate:S', ?, 1, 1, 1, 0, 9e15)").run(u, pid);
  assert.throws(() => s.create({ text: 'KA 1111 KA' }), /уже має/);
  const a = s.create();
  assert.equal(a.text, 'AA 7777 AA', 'normalized: Cyrillic, spaces');
  assert.equal(a.cls, 'S');
  assert.throws(() => s.create(), /уже на аукціоні/);
  // the plate is reserved meanwhile: give-plate refuses it
  assert.throws(() => s.owner('give-plate', { id: u, text: 'AA 7777 AA' }), /на аукціоні/);
  assert.equal(s.owner('check-plate', { text: 'AA 7777 AA' }).auction, true);
  const log = s.db.prepare("SELECT * FROM admin_log WHERE action = 'plate-auction'").all();
  assert.equal(log.length, 1);
  assert.equal(JSON.parse(log[0].details).text, 'AA 7777 AA');
});

test('plate auction: only the owner and admins launch or cancel it — helpers and players cannot; a reason is asked of admins', () => {
  const s = setup();
  s.mk(5);
  s.mk(6);
  s.db.prepare("UPDATE users SET role = 'helper' WHERE id = 5").run();
  s.db.prepare("UPDATE users SET role = 'admin' WHERE id = 6").run();
  const body = { text: 'AA 7777 AA', startPrice: START, step: 10000, hours: 1, confirm: true, reason: 'тестовий лот' };
  assert.throws(() => s.g.adminCall('tg:5', 'plate-auction/create', body), /Немає прав/);
  assert.throws(() => s.g.adminCall('tg:5', 'plate-auction/list', {}), /Немає прав/);
  assert.throws(() => s.g.adminCall('tg:7', 'plate-auction/create', body), /Немає прав/);
  assert.throws(() => s.g.adminCall('tg:6', 'plate-auction/create', { ...body, reason: '' }), /причину/);
  assert.throws(() => s.g.adminCall('tg:6', 'plate-auction/create', { ...body, confirm: false }), /не підтверджено/);
  const a = s.g.adminCall('tg:6', 'plate-auction/create', body).auction;
  assert.ok(a.id);
  assert.throws(() => s.g.adminCall('tg:5', 'plate-auction/cancel', { id: a.id, confirm: true, reason: 'ххх' }), /Немає прав/);
  assert.equal(s.g.adminCall('tg:6', 'plate-auction/list', {}).list.length, 1);
});

test('plate auction: bid rules — the start, then top + step; not on my own lead; not without the money; not banned', () => {
  const s = setup();
  const [a1, a2, poor, bad] = [s.mk(2), s.mk(3), s.mk(4, { balance: START - 1 }), s.mk(8)];
  const { id } = s.create();
  assert.throws(() => s.call(a1, 'plateAuction/bid', { id, amount: START - 1 }), /Мінімальна ставка/);
  assert.throws(() => s.call(poor, 'plateAuction/bid', { id, amount: START }), /Недостатньо/);
  assert.equal(s.bal(poor), START - 1);
  s.call(a1, 'plateAuction/bid', { id, amount: START });
  assert.throws(() => s.call(a1, 'plateAuction/bid', { id, amount: START + 50000 }), /лідер/);
  assert.throws(() => s.call(a2, 'plateAuction/bid', { id, amount: START + 9999 }), /Мінімальна ставка/);
  s.db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(bad);
  assert.throws(() => s.call(bad, 'plateAuction/bid', { id, amount: START + 10000 }), /заблоковано/);
  s.call(a2, 'plateAuction/bid', { id, amount: START + 10000 });
  const r = s.row(id);
  assert.equal(r.top_bidder, a2);
  assert.equal(r.bids, 2);
  s.add(3600e3);
  assert.throws(() => s.call(a1, 'plateAuction/bid', { id, amount: START + 30000 }), /завершено/);
});

test('plate auction: the money is taken at once, the outbid leader gets all of it back with an event and a push', () => {
  const s = setup();
  const [a1, a2] = [s.mk(2), s.mk(3)];
  const { id } = s.create();
  s.call(a1, 'plateAuction/bid', { id, amount: START });
  assert.equal(s.bal(a1), 50e6 - START);
  s.pushes.length = 0;
  s.call(a2, 'plateAuction/bid', { id, amount: START + 20000 });
  assert.equal(s.bal(a1), 50e6, 'refunded in full');
  assert.equal(s.bal(a2), 50e6 - START - 20000);
  const ev = s.db.prepare('SELECT text FROM events WHERE user_id = ? ORDER BY id DESC').get(a1).text;
  assert.match(ev, /Тебе перебили.*AA 7777 AA/);
  assert.ok(s.pushes.some(([u, x]) => u === a1 && /перебили/.test(x)));
  const page = s.call(a1, 'plateAuction');
  assert.equal(page.open[0].outbid, true);
  assert.equal(page.open[0].myBid, START);
  assert.equal(page.open[0].leader, 'U3');
  assert.equal(page.open[0].history.length, 2);
  assert.equal(page.open[0].history[0].amount, START + 20000);
  // metrics: the bid's money is named (market group), not «other»
  const src = s.db.prepare("SELECT SUM(destroyed) d, SUM(created) c FROM money_src WHERE src = 'plateAuction/bid'").get();
  assert.equal(src.d - src.c, START + 20000);
});

test('plate auction: anti-snipe — a bid in the last 2 min moves the end to now + 2 min, at most +30 min in all', () => {
  const s = setup();
  const [a1, a2] = [s.mk(2), s.mk(3)];
  const { id } = s.create({ hours: 0.5 });
  const end0 = s.row(id).ends_at;
  s.add(10 * 60e3);
  s.call(a1, 'plateAuction/bid', { id, amount: START });
  assert.equal(s.row(id).ends_at, end0, 'early bid: no change');
  s.add(end0 - s.at() - 30e3); // 30 s before the end
  const r = s.call(a2, 'plateAuction/bid', { id, amount: START + 10000 });
  assert.equal(r.extended, true);
  assert.equal(s.row(id).ends_at, s.at() + R.antiSnipeMs);
  assert.equal(s.row(id).extended, R.antiSnipeMs - 30e3);
  // a bidding war in the last seconds: the end keeps moving until the cap
  let amt = START + 10000, who = a1;
  for (let i = 0; i < 40; i++) {
    const row = s.row(id);
    s.add(Math.max(0, row.ends_at - s.at() - 5e3));
    amt += 10000;
    s.call(who, 'plateAuction/bid', { id, amount: amt });
    who = who === a1 ? a2 : a1;
  }
  const row = s.row(id);
  assert.equal(row.extended, R.extendCapMs);
  assert.equal(row.ends_at, end0 + R.extendCapMs);
  assert.ok(row.ends_at - s.at() < R.antiSnipeMs, 'over the cap the end no longer moves');
});

test('plate auction: settlement gives the plate to the winner\'s warehouse, the winning bid disappears (money sink)', () => {
  const s = setup();
  const [a1, a2, other] = [s.mk(2), s.mk(3), s.mk(4)];
  const before = s.bal(a1) + s.bal(a2) + s.bal(other);
  const { id } = s.create();
  s.call(a1, 'plateAuction/bid', { id, amount: START });
  s.call(a2, 'plateAuction/bid', { id, amount: START + 10000 });
  s.call(a1, 'plateAuction/bid', { id, amount: START + 30000 });
  s.add(3600e3 + 1);
  assert.equal(s.g.settleAuctions() >= 0, true);
  const p = s.db.prepare("SELECT * FROM plates WHERE text = 'AA 7777 AA'").get();
  assert.equal(p.owner_id, a1);
  assert.equal(p.car_id, null, 'on the warehouse, not on a car');
  assert.equal(p.cls, 'S');
  const [lo, hi] = S.PLATE_VALUE.S;
  assert.equal(p.value, Math.round((lo + hi) / 2 / 100) * 100, 'the same value as an admin-issued plate');
  assert.equal(s.row(id).status, 'done');
  assert.equal(s.row(id).plate_id, p.id);
  assert.equal(s.bal(a1) + s.bal(a2) + s.bal(other), before - (START + 30000), 'only the winning bid left the economy');
  assert.match(s.db.prepare('SELECT text FROM events WHERE user_id = ? ORDER BY id DESC').get(a1).text, /виграв аукціон номера AA 7777 AA/);
  assert.equal(s.db.prepare("SELECT kind FROM gifts WHERE user_id = ?").get(a1).kind, 'plate');
  assert.ok(s.call(a1, 'me').plates.some((x) => x.text === 'AA 7777 AA'));
  // settled once: a second sweep changes nothing
  s.g.settleAuctions();
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM plates WHERE text = 'AA 7777 AA'").get().n, 1);
  // the page and `me` show the result for a day, then nothing
  const me = s.call(a2, 'me').plateAuction;
  assert.deepEqual(me.open, []);
  assert.equal(me.last.text, 'AA 7777 AA');
  assert.equal(s.call(a2, 'plateAuction').finished[0].won, true);
  s.add(R.showDoneMs + 1);
  assert.equal(s.call(a2, 'me').plateAuction, null);
});

test('plate auction: no bids → done without a winner; read of the page settles it too', () => {
  const s = setup();
  const u = s.mk(2);
  const { id } = s.create({ hours: 0.5 });
  s.add(1800e3 + 1);
  const page = s.call(u, 'plateAuction');
  assert.deepEqual(page.open, []);
  assert.equal(s.row(id).status, 'done');
  assert.equal(s.row(id).top_bidder, null);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM plates WHERE text = 'AA 7777 AA'").get().n, 0);
  // and the plate can be put up again
  assert.ok(s.create().id);
});

test('plate auction: cancel refunds the leader and logs it; a banned leader gets his bid back and loses the lead', () => {
  const s = setup();
  const [a1, a2] = [s.mk(2), s.mk(3)];
  const { id } = s.create();
  s.call(a1, 'plateAuction/bid', { id, amount: START });
  s.owner('plate-auction/cancel', { id });
  assert.equal(s.bal(a1), 50e6);
  assert.equal(s.row(id).status, 'cancelled');
  assert.match(s.db.prepare('SELECT text FROM events WHERE user_id = ? ORDER BY id DESC').get(a1).text, /скасовано/);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM admin_log WHERE action = 'plate-auction-cancel'").get().n, 1);
  assert.throws(() => s.owner('plate-auction/cancel', { id }), /не знайдено/);
  s.add(3600e3 + 1);
  s.g.settleAuctions();
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM plates WHERE text = 'AA 7777 AA'").get().n, 0);
  // ban
  const b = s.create();
  s.call(a2, 'plateAuction/bid', { id: b.id, amount: START });
  s.owner('ban', { id: a2, banned: true });
  assert.equal(s.bal(a2), 50e6);
  assert.equal(s.row(b.id).top_bidder, null);
});

test('plate auction: nothing open → no tile data in `me`, an empty page; one open → the tile data', () => {
  const s = setup();
  const u = s.mk(2);
  assert.equal(s.call(u, 'me').plateAuction, null);
  const page = s.call(u, 'plateAuction');
  assert.deepEqual(page.open, []);
  assert.deepEqual(page.finished, []);
  const a = s.create();
  const m = s.call(u, 'me').plateAuction;
  assert.equal(m.open.length, 1);
  assert.equal(m.open[0].text, 'AA 7777 AA');
  assert.equal(m.open[0].minBid, START);
  assert.equal(a.minBid, START);
});

test('plate auction: the group gets the start and the result once each (anonymous unless opted in); nothing without a target', async () => {
  const s = setup();
  const [a1] = [s.mk(2)];
  const calls = [];
  const ch = createChannel({ db: s.db, api: async (m, p) => calls.push([m, p]), now: () => s.at(), log: () => {} });
  const { id } = s.create();
  assert.equal((await ch.postPlateAuctions()).sent, 0, 'no target yet');
  ch.setTarget({ chat: -1001234567, thread: 3 });
  assert.equal((await ch.postPlateAuctions()).sent, 1);
  assert.match(calls[0][1].text, /Аукціон номера AA 7777 AA/);
  assert.equal(calls[0][1].message_thread_id, 3);
  assert.equal((await ch.postPlateAuctions()).sent, 0, 'once');
  s.call(a1, 'plateAuction/bid', { id, amount: START });
  s.add(3600e3 + 1);
  s.g.settleAuctions();
  assert.equal((await ch.postPlateAuctions()).sent, 1);
  assert.match(calls[1][1].text, /Номер AA 7777 AA продано/);
  assert.match(calls[1][1].text, /Хтось із гравців/);
  assert.equal((await ch.postPlateAuctions()).sent, 0);
});
