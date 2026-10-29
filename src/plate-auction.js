// «🔨 Аукціон номера» (owner 29.10: «аукціон для номерів, шоб адміни могли його тільки запускати, шоб вкладка появлялась
// коли запускаєм аукціон номеру»). Only the owner / admins put a plate up (plate-auction/create); players bid while it
// runs. The plate does not exist yet: it is a free plate text (the same rules and normalization as «Видати номер»),
// and whoever leads when the time runs out gets it into his plate warehouse — the same insert as give-plate.
// Money: a bid is taken at once (escrow), the previous leader gets his back with an event «тебе перебили»; the winning
// bid simply disappears (an admin lot has no seller), so the feature is a money sink. A bid in the last ANTI_SNIPE_MS
// moves the end to now + ANTI_SNIPE_MS, at most EXTEND_CAP_MS in all. Settlement: settleAuctions (the server's sweeper,
// every 15 s) and every read of the page. Own tables only (IF NOT EXISTS). The app: public/plate-auction-ui.js; the
// group post: src/channel.js (reads these tables, the game has no hook).
import * as S from '../public/shared.js';

export const PLATE_AUCTION = Object.freeze({
  antiSnipeMs: 2 * 60e3,
  extendCapMs: 30 * 60e3,
  hoursMin: 0.5,
  hoursMax: 72,
  maxOpen: 5,
  minStart: 1000,
  minStep: 100,
  historyN: 10,
  showDoneMs: 24 * 3600e3, // a finished auction keeps its card on the page (and in `me`) for a day
});
const R = PLATE_AUCTION;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plate_auctions (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, cls TEXT NOT NULL,
  start_price INTEGER NOT NULL, step INTEGER NOT NULL, ends_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', top_bid INTEGER, top_bidder INTEGER, bids INTEGER NOT NULL DEFAULT 0,
  extended INTEGER NOT NULL DEFAULT 0, settled_at INTEGER, plate_id INTEGER, value INTEGER);
CREATE INDEX IF NOT EXISTS plate_auctions_status ON plate_auctions(status, ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS plate_auctions_open_text ON plate_auctions(text) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS plate_auction_bids (id INTEGER PRIMARY KEY AUTOINCREMENT, auction_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS plate_auction_bids_a ON plate_auction_bids(auction_id, id);`;

// The value an auctioned plate gets (as an admin-issued plate without a value: the middle of its class range) and what
// the dealer pays for it (plate/sell: half the value) — the lowest start price allowed.
export const plateAuctionValue = (cls) => {
  const [lo, hi] = S.PLATE_VALUE[cls];
  return Math.round((lo + hi) / 2 / 100) * 100;
};
export const dealerPriceOf = (cls) => Math.floor(plateAuctionValue(cls) * 0.5);
export const minBidOf = (a) => (a.top_bid ? a.top_bid + a.step : a.start_price);

export function createPlateAuction(ctx) {
  const { db, q, now, fail, int, name, addMoney, pay, event, gift, alog, checkPlate, isBanned } = ctx;
  db.exec(SCHEMA);
  const row = (id) => q('SELECT * FROM plate_auctions WHERE id = ?').get(id) || null;
  const openRow = (id) => q("SELECT * FROM plate_auctions WHERE id = ? AND status = 'open'").get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID аукціону')) || null;
  const valueOf = plateAuctionValue;

  // ---------- settlement ----------
  function settleOne(a) {
    const t = now();
    if (!a.top_bidder) {
      q("UPDATE plate_auctions SET status = 'done', settled_at = ? WHERE id = ? AND status = 'open'").run(t, a.id);
      return;
    }
    // Someone got this text meanwhile (should not happen: give-plate and the generator skip a plate on auction).
    if (q('SELECT 1 FROM plates WHERE text = ?').get(a.text)) {
      addMoney(a.top_bidder, a.top_bid);
      q("UPDATE plate_auctions SET status = 'cancelled', settled_at = ? WHERE id = ?").run(t, a.id);
      event(a.top_bidder, `🔨 Аукціон номера ${a.text} скасовано — твою ставку ${S.fmt(a.top_bid)} повернуто`);
      return;
    }
    const v = valueOf(a.cls);
    const pid = Number(q('INSERT INTO plates (owner_id, text, cls, value, created_at) VALUES (?, ?, ?, ?, ?)').run(a.top_bidder, a.text, a.cls, v, t).lastInsertRowid);
    q("UPDATE plate_auctions SET status = 'done', settled_at = ?, plate_id = ?, value = ? WHERE id = ?").run(t, pid, v, a.id);
    event(a.top_bidder, `🔨 Ти виграв аукціон номера ${a.text} за ${S.fmt(a.top_bid)}! Номер уже на складі — «Номери»`);
    gift(a.top_bidder, 'plate', { text: a.text, cls: a.cls, value: v }, `Аукціон номера: твоя ставка ${S.fmt(a.top_bid)} перемогла`);
  }
  function sweep() {
    const due = q("SELECT * FROM plate_auctions WHERE status = 'open' AND ends_at <= ?").all(now());
    for (const a of due) settleOne(a);
    return due.length;
  }

  // ---------- reading ----------
  function out(a, uid, { history = false } = {}) {
    const info = S.plateInfo(a.text);
    const o = {
      id: a.id, text: a.text, cls: a.cls, label: info.label, region: S.regionOf(a.text), status: a.status,
      startPrice: a.start_price, step: a.step, topBid: a.top_bid, bids: a.bids, endsAt: a.ends_at, extended: a.extended,
      leader: a.top_bidder ? name(a.top_bidder) : null, leading: !!uid && a.top_bidder === uid, minBid: minBidOf(a), settledAt: a.settled_at,
      won: a.status === 'done' && !!a.top_bidder,
    };
    if (uid) {
      const my = q('SELECT MAX(amount) m FROM plate_auction_bids WHERE auction_id = ? AND user_id = ?').get(a.id, uid).m;
      o.myBid = my || 0;
      o.outbid = !!my && a.top_bidder !== uid;
    }
    if (history) o.history = q('SELECT user_id, amount, at FROM plate_auction_bids WHERE auction_id = ? ORDER BY id DESC LIMIT ?').all(a.id, R.historyN)
      .map((b) => ({ name: name(b.user_id), amount: b.amount, at: b.at, me: b.user_id === uid }));
    return o;
  }
  const recentDone = (n) => q("SELECT * FROM plate_auctions WHERE status = 'done' AND settled_at > ? ORDER BY settled_at DESC LIMIT ?").all(now() - R.showDoneMs, n);
  // The page (polled every ~4 s while open): what runs, the results of the last day, the rules.
  function page(uid) {
    sweep();
    const open = q("SELECT * FROM plate_auctions WHERE status = 'open' ORDER BY ends_at").all().map((a) => out(a, uid, { history: true }));
    const finished = recentDone(5).map((a) => out(a, uid, { history: false }));
    return { now: now(), open, finished, rules: { antiSnipeMs: R.antiSnipeMs, extendCapMs: R.extendCapMs } };
  }
  // `me.plateAuction`: the tile, the banner and the one-time window. null when nothing runs and nothing ended today.
  function brief(uid) {
    const open = q("SELECT * FROM plate_auctions WHERE status = 'open' AND ends_at > ? ORDER BY ends_at").all(now());
    const last = recentDone(1)[0];
    if (!open.length && !last) return null;
    return {
      open: open.map((a) => ({ id: a.id, text: a.text, cls: a.cls, topBid: a.top_bid, minBid: minBidOf(a), bids: a.bids, endsAt: a.ends_at, leading: a.top_bidder === uid })),
      last: last ? { id: last.id, text: last.text, price: last.top_bid, winner: last.top_bidder ? name(last.top_bidder) : null, mine: last.top_bidder === uid, at: last.settled_at } : null,
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
      event(a.top_bidder, `⚠️ Тебе перебили на аукціоні номера ${a.text}: ${S.fmt(amt)}. Твої ${S.fmt(a.top_bid)} повернуто — встигни поставити більше!`);
    }
    const t = now();
    let ends = a.ends_at, ext = a.extended;
    if (a.ends_at - t < R.antiSnipeMs) {
      const add = Math.min(t + R.antiSnipeMs - a.ends_at, R.extendCapMs - a.extended);
      if (add > 0) (ends += add), (ext += add);
    }
    q('UPDATE plate_auctions SET top_bid = ?, top_bidder = ?, bids = bids + 1, ends_at = ?, extended = ? WHERE id = ?').run(amt, uid, ends, ext, a.id);
    q('INSERT INTO plate_auction_bids (auction_id, user_id, amount, at) VALUES (?, ?, ?, ?)').run(a.id, uid, amt, t);
    return { auction: out(row(a.id), uid, { history: true }), extended: ends > a.ends_at };
  }
  // A banned player's lead is dropped (his bid comes back; the next bid starts from the start price again).
  function dropLeader(uid) {
    for (const a of q("SELECT * FROM plate_auctions WHERE status = 'open' AND top_bidder = ?").all(uid)) {
      addMoney(uid, a.top_bid);
      q('UPDATE plate_auctions SET top_bid = NULL, top_bidder = NULL WHERE id = ?').run(a.id);
    }
  }

  // ---------- admin (owner / admins: not in HELPER_ACTIONS) ----------
  function adminCreate(who, { text, startPrice, step, hours }) {
    const p = checkPlate(text);
    if (p.error) fail(p.error);
    if (p.owner) fail(`Номер ${p.text} уже має ${p.owner.name}`);
    if (q("SELECT 1 FROM plate_auctions WHERE text = ? AND status = 'open'").get(p.text)) fail(`Номер ${p.text} уже на аукціоні`);
    if (q("SELECT COUNT(*) n FROM plate_auctions WHERE status = 'open'").get().n >= R.maxOpen) fail(`Одночасно — не більше ${R.maxOpen} аукціонів`);
    const start = int(startPrice, R.minStart, 1e12, 'Стартова ціна');
    // Not below what the dealer pays for the plate (half its value): otherwise buying it here and selling it on would print money.
    const dealer = dealerPriceOf(p.cls);
    if (start < dealer) fail(`Стартова ціна — не менше ${S.fmt(dealer)} (стільки дилер дає за цей номер)`);
    const st = int(step, R.minStep, 1e11, 'Крок');
    const h = Number(hours);
    if (!Number.isFinite(h) || h < R.hoursMin || h > R.hoursMax) fail(`Тривалість: від ${String(R.hoursMin).replace('.', ',')} до ${R.hoursMax} годин`);
    const t = now();
    const ends = t + Math.round(h * 3600e3);
    const id = Number(q('INSERT INTO plate_auctions (text, cls, start_price, step, ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.text, p.cls, start, st, ends, String(who), t).lastInsertRowid);
    alog(who, 'plate-auction', null, { id, text: p.text, cls: p.cls, start, step: st, hours: h });
    return { auction: out(row(id), null) };
  }
  function adminCancel(who, { id }) {
    const a = openRow(id);
    if (!a) fail('Аукціон не знайдено або вже завершено');
    if (a.top_bidder) {
      addMoney(a.top_bidder, a.top_bid);
      event(a.top_bidder, `🔨 Аукціон номера ${a.text} скасовано адміністрацією — твою ставку ${S.fmt(a.top_bid)} повернуто`);
    }
    q("UPDATE plate_auctions SET status = 'cancelled', settled_at = ? WHERE id = ?").run(now(), a.id);
    alog(who, 'plate-auction-cancel', a.top_bidder ?? null, { id: a.id, text: a.text, refund: a.top_bid || 0 });
    return {};
  }
  function adminList() {
    sweep();
    const list = q("SELECT * FROM plate_auctions ORDER BY (status = 'open') DESC, id DESC LIMIT 30").all().map((a) => ({
      ...out(a, null, { history: true }), createdBy: a.created_by, createdAt: a.created_at, value: a.value,
      leaderId: a.top_bidder ?? null,
    }));
    return { list, now: now(), rules: R, values: Object.fromEntries(Object.keys(S.PLATE_VALUE).map((c) => [c, { value: valueOf(c), dealer: dealerPriceOf(c) }])) };
  }

  return {
    sweep, page, brief, dropLeader,
    api: { plateAuction: (uid) => page(uid), 'plateAuction/bid': bid },
    admin: { 'plate-auction/list': (w) => adminList(w), 'plate-auction/create': adminCreate, 'plate-auction/cancel': adminCancel },
    mutating: ['plate-auction/create', 'plate-auction/cancel'],
  };
}
