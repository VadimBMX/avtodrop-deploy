// «🔨 Аукціон машини» (owner 07.11, src/car-auction.js): admins launch it for a model (default the Supra «Neon Tokyo»),
// players bid with escrow, an outbid refund and the plate auction's anti-snipe; the winner gets a new car with
// cars.no_state_sale = 1 — it goes on the market, the player auction and trades (and keeps the flag with every new
// owner), but every sell-to-state path refuses it. Cancel refunds. The legend and secret rules of other cars stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createChannel } from '../src/channel.js';
import { CAR_AUCTION as R } from '../src/car-auction.js';
import * as S from '../public/shared.js';

const T0 = Date.parse('2026-11-07T10:00:00Z');
const START = 1_000_000, STEP = 50_000;
const NO_STATE = /Цю машину не можна продати державі — тільки гравцям/;
const SUPRA = 'toyota-supra-a80-neon-tokyo';

function setup() {
  let t = T0;
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], random: () => 0.5, allUnlocked: true, notify: () => {} });
  const mk = (id, { balance = 50e6 } = {}) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = 99, level_seen = 99, balance = ? WHERE id = ?').run(balance, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const owner = (name, body = {}) => g.adminCall('tg:1', name, { confirm: true, ...body });
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  const create = (b = {}) => owner('car-auction/create', { startPrice: START, step: STEP, hours: 48, ...b }).auction;
  const row = (id) => db.prepare('SELECT * FROM car_auctions WHERE id = ?').get(id);
  const car = (id) => db.prepare('SELECT * FROM cars WHERE id = ?').get(id);
  const give = (uid, model = 'bmw-m3-e30') => g.adminCall('tg:1', 'give-car', { id: uid, model, confirm: true }).carId
    ?? db.prepare('SELECT MAX(id) id FROM cars WHERE owner_id = ?').get(uid).id;
  return { db, g, mk, call, owner, bal, create, row, car, give, at: () => t, add: (ms) => (t += ms) };
}
// Runs a whole auction: a1 bids, a2 outbids, the time runs out. Returns the won car's id.
function won(s, winner) {
  const { id } = s.create();
  s.call(winner, 'carAuction/bid', { id, amount: START });
  s.add(48 * 3600e3 + 1);
  s.g.settleAuctions();
  return s.row(id).car_id;
}

test('car auction: the first lot is the Supra «Neon Tokyo» — a season-2 secret model, never a pass prize', () => {
  assert.equal(S.CAR_AUCTION_MODEL, SUPRA);
  const m = S.MODELS[SUPRA];
  assert.equal(m.name, 'Toyota Supra A80 «Neon Tokyo»');
  assert.equal(m.secret, true);
  assert.equal(m.season, 2);
  assert.ok(!S.SEASON_CARS.some((c) => c.id === SUPRA), 'not the season pass car');
  assert.equal(R.hoursDefault, 48);
  assert.equal(R.startDefault, 1_000_000);
});

test('car auction: admin create defaults to the Supra, validates, owner/admin only with confirm; helpers and players cannot', () => {
  const s = setup();
  s.mk(5);
  s.mk(6);
  s.db.prepare("UPDATE users SET role = 'helper' WHERE id = 5").run();
  s.db.prepare("UPDATE users SET role = 'admin' WHERE id = 6").run();
  assert.throws(() => s.create({ hours: 0.2 }), /Тривалість/);
  assert.throws(() => s.create({ hours: 73 }), /Тривалість/);
  assert.throws(() => s.create({ model: 'nope' }), /Невідома модель/);
  assert.throws(() => s.create({ model: 'toString' }), /Невідома модель/);
  assert.throws(() => s.create({ startPrice: 10 }), /Стартова ціна/);
  const body = { startPrice: START, step: STEP, hours: 48, confirm: true, reason: 'лот' };
  assert.throws(() => s.g.adminCall('tg:5', 'car-auction/create', body), /Немає прав/);
  assert.throws(() => s.g.adminCall('tg:5', 'car-auction/list', {}), /Немає прав/);
  assert.throws(() => s.g.adminCall('tg:6', 'car-auction/create', { ...body, confirm: false }), /не підтверджено/);
  assert.equal(s.g.api['carAuction/create'], undefined, 'no player route to create');
  const a = s.g.adminCall('tg:6', 'car-auction/create', body).auction;
  assert.equal(a.model, SUPRA);
  assert.equal(a.endsAt, s.at() + 48 * 3600e3);
  assert.equal(a.minBid, START);
  assert.throws(() => s.create(), /уже на аукціоні/);
  assert.equal(s.owner('car-auction/list').list.length, 1);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM admin_log WHERE action = 'car-auction'").get().n, 1);
});

test('car auction: bid escrow, the step, the outbid refund, anti-snipe, the winner gets the car with the flag', () => {
  const s = setup();
  const [a1, a2, poor] = [s.mk(2), s.mk(3), s.mk(4, { balance: 10 })];
  assert.equal(s.call(a1, 'me').carAuction, null, 'nothing runs');
  const { id } = s.create();
  assert.equal(s.call(a1, 'me').carAuction.open[0].model, SUPRA);
  assert.throws(() => s.call(a1, 'carAuction/bid', { id, amount: START - 1 }), /Мінімальна ставка/);
  assert.throws(() => s.call(poor, 'carAuction/bid', { id, amount: START }), /Недостатньо/);
  const b1 = s.bal(a1);
  s.call(a1, 'carAuction/bid', { id, amount: START });
  assert.equal(s.bal(a1), b1 - START, 'taken at once');
  assert.throws(() => s.call(a1, 'carAuction/bid', { id, amount: START + STEP }), /лідер/);
  assert.throws(() => s.call(a2, 'carAuction/bid', { id, amount: START + STEP - 1 }), /Мінімальна ставка/);
  const b2 = s.bal(a2);
  s.call(a2, 'carAuction/bid', { id, amount: START + STEP });
  assert.equal(s.bal(a1), b1, 'the outbid leader got all his money back');
  assert.ok(s.db.prepare("SELECT 1 FROM events WHERE user_id = ? AND text LIKE '%Тебе перебили на аукціоні машини%'").get(a1));
  // anti-snipe: a bid 30 s before the end moves it to 2 min from the bid
  s.add(48 * 3600e3 - 30e3);
  const r = s.call(a1, 'carAuction/bid', { id, amount: START + 3 * STEP });
  assert.equal(r.extended, true);
  assert.equal(s.row(id).ends_at, s.at() + R.antiSnipeMs);
  assert.equal(s.bal(a2), b2, 'a2 refunded');
  const page = s.call(a2, 'carAuction');
  assert.equal(page.open[0].history.length, 3);
  assert.equal(page.open[0].outbid, true);
  s.add(R.antiSnipeMs + 1);
  s.g.settleAuctions();
  const a = s.row(id);
  assert.equal(a.status, 'done');
  assert.equal(s.bal(a1), b1 - (START + 3 * STEP), 'the winning bid is a sink');
  const c = s.car(a.car_id);
  assert.equal(c.owner_id, a1);
  assert.equal(c.model, SUPRA);
  assert.equal(c.no_state_sale, 1);
  assert.equal(s.call(a1, 'me').cars.find((x) => x.id === c.id).noState, true);
  assert.ok(s.db.prepare("SELECT 1 FROM events WHERE user_id = ? AND text LIKE '%Ти виграв аукціон машини%'").get(a1));
  assert.ok(s.db.prepare("SELECT 1 FROM gifts WHERE user_id = ? AND kind = 'car'").get(a1), 'the winner window');
  assert.throws(() => s.call(a2, 'carAuction/bid', { id, amount: 1e8 }), /завершено/);
  assert.equal(s.call(a1, 'carAuction').finished[0].won, true);
  // a lot without bids ends with no car
  const { id: id2 } = s.create({ hours: 1 });
  s.add(3600e3 + 1);
  s.g.settleAuctions();
  assert.equal(s.row(id2).status, 'done');
  assert.equal(s.row(id2).car_id, null);
});

test('car auction: cancel refunds the leader, logs it, and gives no car', () => {
  const s = setup();
  const a1 = s.mk(2);
  const b1 = s.bal(a1);
  const { id } = s.create();
  s.call(a1, 'carAuction/bid', { id, amount: START });
  s.owner('car-auction/cancel', { id });
  assert.equal(s.bal(a1), b1);
  assert.equal(s.row(id).status, 'cancelled');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM cars WHERE model = ?').get(SUPRA).n, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM admin_log WHERE action = 'car-auction-cancel'").get().n, 1);
  assert.ok(s.db.prepare("SELECT 1 FROM events WHERE user_id = ? AND text LIKE '%скасовано адміністрацією%'").get(a1));
  assert.throws(() => s.owner('car-auction/cancel', { id }), /не знайдено/);
  s.add(49 * 3600e3);
  s.g.settleAuctions();
  assert.equal(s.row(id).status, 'cancelled');
});

test('car auction: the won car is refused by every sell-to-state path', () => {
  const s = setup();
  const a1 = s.mk(2);
  const L = won(s, a1);
  const x = s.give(a1), y = s.give(a1);
  assert.throws(() => s.call(a1, 'sell', { carIds: [L] }), NO_STATE);
  assert.throws(() => s.call(a1, 'sell', { carIds: [x, L] }), NO_STATE, 'not in «продати все» either');
  assert.throws(() => s.call(a1, 'upgrade', { carIds: [L], target: 'bmw-m3-e30' }), NO_STATE);
  assert.throws(() => s.call(a1, 'dealer/tradein', { carIds: [L, x, y] }), NO_STATE);
  // the daily buyer: whatever he asks for, this car is refused before the match
  s.db.prepare('INSERT INTO buyer_offers (user_id, day, kind, req, prem, city, line, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(a1, '2026-11-09', 'model', JSON.stringify({ model: SUPRA }), 50, 'Київ', 'шукаю Supra', s.at(), s.at() + 3600e3);
  assert.throws(() => s.call(a1, 'buyer/sell', { carId: L }), NO_STATE);
  assert.equal(s.car(L).owner_id, a1, 'still there');
  assert.ok(s.call(a1, 'sell', { carIds: [x] }).got > 0, 'other cars still sell');
});

test('car auction: the won car goes on the market and the player auction, is traded, and keeps the flag with every owner', () => {
  const s = setup();
  const [a1, a2, a3] = [s.mk(2), s.mk(3), s.mk(4)];
  const L = won(s, a1);
  s.give(a1);
  s.give(a2);
  s.give(a3);
  // market: list, buy
  s.call(a1, 'market/sell', { carId: L, price: 5e6 });
  assert.equal(s.car(L).status, 'market');
  const lot = s.db.prepare('SELECT id FROM listings WHERE car_id = ?').get(L).id;
  s.call(a2, 'market/buy', { id: lot });
  assert.equal(s.car(L).owner_id, a2);
  assert.equal(s.car(L).no_state_sale, 1, 'kept after the market');
  assert.throws(() => s.call(a2, 'sell', { carIds: [L] }), NO_STATE);
  // player auction: list, win
  const { id: au } = s.call(a2, 'auction/create', { carId: L, startPrice: 1e6, hours: 1 }).auction ?? { id: s.db.prepare("SELECT id FROM auctions WHERE car_id = ? AND status = 'open'").get(L).id };
  s.call(a3, 'auction/bid', { id: au, amount: 1e6 });
  s.add(3600e3 + 1);
  s.g.settleAuctions();
  assert.equal(s.car(L).owner_id, a3);
  assert.equal(s.car(L).no_state_sale, 1, 'kept after the auction');
  // trade: offer it, accept
  const t = s.call(a3, 'trade/create', { to: String(a1), give: [L] });
  const tid = t.id ?? s.db.prepare("SELECT id FROM trades WHERE status = 'open'").get().id;
  s.call(a1, 'trade/accept', { id: tid });
  assert.equal(s.car(L).owner_id, a1);
  assert.equal(s.car(L).no_state_sale, 1, 'kept after a trade');
  // a trade asking for it from the other side, and the trade room
  const other = s.give(a2);
  s.call(a2, 'trade/create', { to: String(a1), give: [other], get: [L] });
  const { id: room } = s.call(a1, 'room/create', {});
  s.call(a2, 'room/join', { id: room });
  s.call(a1, 'room/offer', { id: room, add: L });
  assert.throws(() => s.call(a1, 'upgrade', { carIds: [L], target: 'bmw-m3-e30' }), NO_STATE);
});

test('car auction: other secret / season cars and the legend car keep their rules', () => {
  const s = setup();
  const a1 = s.mk(2), a2 = s.mk(3);
  s.give(a1);
  s.give(a2);
  // the same Supra model given without the flag (e.g. by an admin) is a plain secret car: no market, no sale
  const plain = s.give(a1, SUPRA);
  assert.equal(s.car(plain).no_state_sale, 0);
  const SECRET = /Секретну машину не можна/;
  assert.throws(() => s.call(a1, 'market/sell', { carId: plain, price: 5e6 }), SECRET);
  assert.throws(() => s.call(a1, 'auction/create', { carId: plain, startPrice: 1e6, hours: 1 }), SECRET);
  assert.throws(() => s.call(a1, 'trade/create', { to: String(a2), give: [plain] }), SECRET);
  assert.throws(() => s.call(a1, 'sell', { carIds: [plain] }), SECRET);
  const season = s.give(a1, S.SEASON_CARS[1].id);
  assert.throws(() => s.call(a1, 'market/sell', { carId: season, price: 5e6 }), SECRET);
  // a legend car stays locked even if it somehow carried the flag too
  const leg = s.give(a1, S.LEGEND_CAR.model);
  s.db.prepare('UPDATE cars SET legend = 1, no_state_sale = 1 WHERE id = ?').run(leg);
  const LOCK = /Легенда S1 — не продається і не передається/;
  assert.throws(() => s.call(a1, 'market/sell', { carId: leg, price: 5e6 }), LOCK);
  assert.throws(() => s.call(a1, 'trade/create', { to: String(a2), give: [leg] }), LOCK);
  assert.throws(() => s.call(a1, 'auction/create', { carId: leg, startPrice: 1e6, hours: 1 }), LOCK);
});

test('car auction: the group gets the start and the result once each, with the car photo as the preview', async () => {
  const s = setup();
  const a1 = s.mk(2);
  const calls = [];
  const ch = createChannel({ db: s.db, api: async (m, p) => calls.push([m, p]), imageUrl: (img) => `https://x/${img}.webp`, now: () => s.at(), log: () => {} });
  const { id } = s.create();
  assert.equal((await ch.postCarAuctions()).sent, 0, 'no target yet');
  ch.setTarget({ chat: -1001234567, thread: 3 });
  assert.equal((await ch.postCarAuctions()).sent, 1);
  assert.match(calls[0][1].text, /Аукціон машини: Toyota Supra A80 «Neon Tokyo»/);
  assert.equal(calls[0][1].link_preview_options.url, 'https://x/toyota-supra-a80.webp');
  assert.equal((await ch.postCarAuctions()).sent, 0, 'once');
  s.call(a1, 'carAuction/bid', { id, amount: START });
  s.add(48 * 3600e3 + 1);
  s.g.settleAuctions();
  assert.equal((await ch.postCarAuctions()).sent, 1);
  assert.match(calls[1][1].text, /продано/);
  assert.equal((await ch.postCarAuctions()).sent, 0);
});
