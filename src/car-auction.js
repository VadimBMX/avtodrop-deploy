// «🔨 Аукціон машини» (owner 07.11: «аукціон на 2 дні на лімітовану машину, запускає адмін»). The car twin of
// src/plate-auction.js: only the owner / admins put a model up (car-auction/create), players bid while it runs, whoever
// leads when the time runs out gets a NEW car of that model with cars.no_state_sale = 1 — a tradable limited car: it
// goes on the market, the player auction and trades (game.js noSecret lets it through), never to the state (noState:
// instant sale, the buyer, trade-in, upgrade). Money as on the plate auction: a bid is taken at once (escrow), the
// previous leader gets his back with an event «тебе перебили»; the winning bid disappears (a money sink). A bid in the
// last ANTI_SNIPE_MS moves the end to now + ANTI_SNIPE_MS, at most EXTEND_CAP_MS in all. Settlement: the server's
// sweeper (settleAuctions) and every read of the page. Own tables only (IF NOT EXISTS). The app:
// public/car-auction-ui.js; the admin: public/admin-car-auction.js; the group post: src/channel.js postCarAuctions.
import * as S from '../public/shared.js';

export const CAR_AUCTION = Object.freeze({
  antiSnipeMs: 2 * 60e3,
  extendCapMs: 30 * 60e3,
  hoursMin: 0.5,
  hoursMax: 72,
  hoursDefault: 48,
  startDefault: 1_000_000,
  stepDefault: 50_000,
  maxOpen: 3,
  minStart: 1000,
  minStep: 100,
  historyN: 50,
  showDoneMs: 24 * 3600e3, // a finished auction keeps its card on the page (and in `me`) for a day
});
const R = CAR_AUCTION;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS car_auctions (id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL,
  start_price INTEGER NOT NULL, step INTEGER NOT NULL, ends_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', top_bid INTEGER, top_bidder INTEGER, bids INTEGER NOT NULL DEFAULT 0,
  extended INTEGER NOT NULL DEFAULT 0, settled_at INTEGER, car_id INTEGER);
CREATE INDEX IF NOT EXISTS car_auctions_status ON car_auctions(status, ends_at);
CREATE TABLE IF NOT EXISTS car_auction_bids (id INTEGER PRIMARY KEY AUTOINCREMENT, auction_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS car_auction_bids_a ON car_auction_bids(auction_id, id);`;

export const minBidOf = (a) => (a.top_bid ? a.top_bid + a.step : a.start_price);
const modelName = (id) => S.MODELS[id]?.name || id;

export function createCarAuction(ctx) {
  const { db, q, now, fail, int, name, addMoney, pay, event, gift, alog, isBanned, giveCar, auctionRoom } = ctx;
  db.exec(SCHEMA);
  const row = (id) => q('SELECT * FROM car_auctions WHERE id = ?').get(id) || null;
  const openRow = (id) => q("SELECT * FROM car_auctions WHERE id = ? AND status = 'open'").get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID аукціону')) || null;

  // ---------- settlement ----------
  function settleOne(a) {
    const t = now();
    if (!a.top_bidder) {
      q("UPDATE car_auctions SET status = 'done', settled_at = ? WHERE id = ? AND status = 'open'").run(t, a.id);
      return;
    }
    // A new car of the model, flagged; the garage while it has room, else the showcase, else the garage anyway (over
    // the limit: the prize is never lost — only the best slots earn, the player frees a slot himself).
    const room = auctionRoom(a.top_bidder) === 'showcase' ? 'showcase' : 'garage'; // before the car is in
    const { id: carId } = giveCar(a.top_bidder, a.model);
    q('UPDATE cars SET no_state_sale = 1, status = ? WHERE id = ?').run(room, carId);
    q("UPDATE car_auctions SET status = 'done', settled_at = ?, car_id = ? WHERE id = ?").run(t, carId, a.id);
    event(a.top_bidder, `🔨 Ти виграв аукціон машини ${modelName(a.model)} за ${S.fmt(a.top_bid)}! Вона вже в гаражі`);
    gift(a.top_bidder, 'car', { model: a.model, carId }, `Аукціон машини: твоя ставка ${S.fmt(a.top_bid)} перемогла. Лімітована машина: її можна продати чи обміняти іншим гравцям, але не державі`);
  }
  function sweep() {
    const due = q("SELECT * FROM car_auctions WHERE status = 'open' AND ends_at <= ?").all(now());
    for (const a of due) settleOne(a);
    return due.length;
  }

  // ---------- reading ----------
  function out(a, uid, { history = 0 } = {}) {
    const m = S.MODELS[a.model];
    const o = {
      id: a.id, model: a.model, name: modelName(a.model), cls: m?.cls || 'X', status: a.status,
      startPrice: a.start_price, step: a.step, topBid: a.top_bid, bids: a.bids, endsAt: a.ends_at, extended: a.extended,
      leader: a.top_bidder ? name(a.top_bidder) : null, leading: !!uid && a.top_bidder === uid, minBid: minBidOf(a), settledAt: a.settled_at,
      won: a.status === 'done' && !!a.top_bidder, carId: a.car_id ?? null,
    };
    if (uid) {
      const my = q('SELECT MAX(amount) m FROM car_auction_bids WHERE auction_id = ? AND user_id = ?').get(a.id, uid).m;
      o.myBid = my || 0;
      o.outbid = !!my && a.top_bidder !== uid;
    }
    if (history) o.history = q('SELECT user_id, amount, at FROM car_auction_bids WHERE auction_id = ? ORDER BY id DESC LIMIT ?').all(a.id, history)
      .map((b) => ({ name: name(b.user_id), amount: b.amount, at: b.at, me: b.user_id === uid }));
    return o;
  }
  const recentDone = (n) => q("SELECT * FROM car_auctions WHERE status = 'done' AND settled_at > ? ORDER BY settled_at DESC LIMIT ?").all(now() - R.showDoneMs, n);
  // The page (polled every ~4 s while open): what runs (with the whole bid history for the sheet), the last day's results.
  function page(uid) {
    sweep();
    const open = q("SELECT * FROM car_auctions WHERE status = 'open' ORDER BY ends_at").all().map((a) => out(a, uid, { history: R.historyN }));
    const finished = recentDone(5).map((a) => out(a, uid, { history: R.historyN }));
    return { now: now(), open, finished, rules: { antiSnipeMs: R.antiSnipeMs, extendCapMs: R.extendCapMs } };
  }
  // `me.carAuction`: the hub card and the strips. null when nothing runs and nothing ended today.
  function brief(uid) {
    const open = q("SELECT * FROM car_auctions WHERE status = 'open' AND ends_at > ? ORDER BY ends_at").all(now());
    const last = recentDone(1)[0];
    if (!open.length && !last) return null;
    return {
      open: open.map((a) => ({ id: a.id, model: a.model, name: modelName(a.model), topBid: a.top_bid, minBid: minBidOf(a), bids: a.bids, endsAt: a.ends_at, leading: a.top_bidder === uid })),
      last: last ? { id: last.id, model: last.model, name: modelName(last.model), price: last.top_bid, winner: last.top_bidder ? name(last.top_bidder) : null, mine: last.top_bidder === uid, at: last.settled_at } : null,
    };
  }

  // ---------- bidding ----------
  function bid(uid, { id, amount }) {
    const a = openRow(id);
    if (!a || a.ends_at <= now()) fail('Аукціон уже завершено');
    if (isBanned(uid)) fail('Акаунт заблоковано адміністрацією');
    if (a.top_bidder === uid) fail('Ти вже лідер — перебивати себе не треба');
    const amt = int(amount, 1, 1e13, 'Ставка');
    const min = minBidOf(a);
    if (amt < min) fail(`Мінімальна ставка ${S.fmt(min)}`);
    pay(uid, amt); // 'Недостатньо гривень' when short
    if (a.top_bidder) {
      addMoney(a.top_bidder, a.top_bid);
      event(a.top_bidder, `⚠️ Тебе перебили на аукціоні машини ${modelName(a.model)}: ${S.fmt(amt)}. Твої ${S.fmt(a.top_bid)} повернуто — встигни поставити більше!`);
    }
    const t = now();
    let ends = a.ends_at, ext = a.extended;
    if (a.ends_at - t < R.antiSnipeMs) {
      const add = Math.min(t + R.antiSnipeMs - a.ends_at, R.extendCapMs - a.extended);
      if (add > 0) (ends += add), (ext += add);
    }
    q('UPDATE car_auctions SET top_bid = ?, top_bidder = ?, bids = bids + 1, ends_at = ?, extended = ? WHERE id = ?').run(amt, uid, ends, ext, a.id);
    q('INSERT INTO car_auction_bids (auction_id, user_id, amount, at) VALUES (?, ?, ?, ?)').run(a.id, uid, amt, t);
    return { auction: out(row(a.id), uid, { history: R.historyN }), extended: ends > a.ends_at };
  }
  // A banned player's lead is dropped (his bid comes back; the next bid starts from the start price again).
  function dropLeader(uid, { refund = true } = {}) {
    for (const a of q("SELECT * FROM car_auctions WHERE status = 'open' AND top_bidder = ?").all(uid)) {
      if (refund) addMoney(uid, a.top_bid);
      q('UPDATE car_auctions SET top_bid = NULL, top_bidder = NULL WHERE id = ?').run(a.id);
    }
  }

  // ---------- admin (owner / admins: not in HELPER_ACTIONS) ----------
  function adminCreate(who, { model, startPrice, step, hours }) {
    const id0 = String(model ?? '').trim() || S.CAR_AUCTION_MODEL;
    const m = Object.hasOwn(S.MODELS, id0) ? S.MODELS[id0] : null;
    if (!m) fail('Невідома модель');
    if (q("SELECT COUNT(*) n FROM car_auctions WHERE status = 'open'").get().n >= R.maxOpen) fail(`Одночасно — не більше ${R.maxOpen} аукціонів машин`);
    if (q("SELECT 1 FROM car_auctions WHERE model = ? AND status = 'open'").get(m.id)) fail(`${m.name} уже на аукціоні`);
    const start = int(startPrice, R.minStart, 1e12, 'Стартова ціна');
    const st = int(step, R.minStep, 1e11, 'Крок');
    const h = Number(hours);
    if (!Number.isFinite(h) || h < R.hoursMin || h > R.hoursMax) fail(`Тривалість: від ${String(R.hoursMin).replace('.', ',')} до ${R.hoursMax} годин`);
    const t = now();
    const ends = t + Math.round(h * 3600e3);
    const id = Number(q('INSERT INTO car_auctions (model, start_price, step, ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(m.id, start, st, ends, String(who), t).lastInsertRowid);
    alog(who, 'car-auction', null, { id, model: m.id, start, step: st, hours: h });
    return { auction: out(row(id), null) };
  }
  function adminCancel(who, { id }) {
    const a = openRow(id);
    if (!a) fail('Аукціон не знайдено або вже завершено');
    if (a.top_bidder) {
      addMoney(a.top_bidder, a.top_bid);
      event(a.top_bidder, `🔨 Аукціон машини ${modelName(a.model)} скасовано адміністрацією — твою ставку ${S.fmt(a.top_bid)} повернуто`);
    }
    q("UPDATE car_auctions SET status = 'cancelled', settled_at = ? WHERE id = ?").run(now(), a.id);
    alog(who, 'car-auction-cancel', a.top_bidder ?? null, { id: a.id, model: a.model, refund: a.top_bid || 0 });
    return {};
  }
  function adminList() {
    sweep();
    const list = q("SELECT * FROM car_auctions ORDER BY (status = 'open') DESC, id DESC LIMIT 30").all().map((a) => ({
      ...out(a, null, { history: R.historyN }), createdBy: a.created_by, createdAt: a.created_at, leaderId: a.top_bidder ?? null,
    }));
    return { list, now: now(), rules: R, defaultModel: S.CAR_AUCTION_MODEL };
  }

  return {
    sweep, page, brief, dropLeader,
    api: { carAuction: (uid) => page(uid), 'carAuction/bid': bid },
    admin: { 'car-auction/list': (w) => adminList(w), 'car-auction/create': adminCreate, 'car-auction/cancel': adminCancel },
    mutating: ['car-auction/create', 'car-auction/cancel'],
  };
}
