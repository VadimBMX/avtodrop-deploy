// «Таємний покупець» on the server (the rules and the premium cap are in public/buyer.js, shared with the app).
// The offer of the day is made on the player's first `me` of the Kyiv day (market open, level 2): the request is
// picked by a generator seeded with HMAC(meta 'buyer_seed', uid:day) from what the player has at that moment (his
// garage, his balance), then frozen in buyer_offers — the same player and day always get the same offer, and a deploy
// or a later garage change can't swap it. It lives BUYER.hours; one car can be sold to it, through the ordinary sale
// (game.js sell: never the last car, parts and plate go back, trades invalidated) plus the premium on top.
import crypto from 'node:crypto';
import * as S from '../public/shared.js';
import * as B from '../public/buyer.js';

export function createBuyer(ctx) {
  const { q, now, dayOf, fail, int, isOpen, ownCar, noSecret, sellCar, addMoney, metaGet, metaSet } = ctx;

  let seed = null;
  function seedOf() {
    if (seed) return seed;
    seed = metaGet('buyer_seed');
    if (!seed) metaSet('buyer_seed', (seed = crypto.randomBytes(32).toString('hex')));
    return seed;
  }
  // A reproducible stream of numbers in [0, 1) for one player and day.
  function rngFor(uid, day) {
    let i = 0;
    const key = seedOf();
    return () => crypto.createHmac('sha256', key).update(`${uid}:${day}:${i++}`).digest().readUIntBE(0, 6) / 2 ** 48;
  }

  const rowOf = (uid, day) => q('SELECT * FROM buyer_offers WHERE user_id = ? AND day = ?').get(uid, day) || null;
  // The offer that counts now: one still running (yesterday's may run past midnight), else today's.
  function current(uid) {
    const t = now();
    return q('SELECT * FROM buyer_offers WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1').get(uid, t) || rowOf(uid, dayOf(t));
  }
  const ownModels = (uid) => q("SELECT model FROM cars WHERE owner_id = ? AND status IN ('garage', 'showcase')").all(uid).map((r) => r.model);
  const carCount = (uid) => q('SELECT COUNT(*) n FROM cars WHERE owner_id = ?').get(uid).n;
  function ensure(uid) {
    const t = now(), day = dayOf(t);
    const cur = current(uid);
    if (cur) return cur;
    const u = q('SELECT balance, level FROM users WHERE id = ?').get(uid);
    const cars = carCount(uid), newbie = B.isNewbie({ level: u?.level || 1, cars });
    const pick = B.pickRequest(rngFor(uid, day), { own: ownModels(uid), balance: u?.balance || 0, canSell: cars > 1, newbie });
    if (!pick) return null; // fix5: a newcomer with no sensible request gets no offer (picked again on a later visit)
    const win = B.windowOf(t); // fix5: made at night → the 3 hours run from 08:00 Kyiv
    q(`INSERT INTO buyer_offers (user_id, day, kind, req, prem, city, line, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`).run(uid, day, pick.kind, JSON.stringify(pick.req), pick.prem, pick.city, pick.line, t, win.expires);
    return rowOf(uid, day);
  }
  // The player's cars the buyer would take (garage or showcase, not on the market or an auction), dearest first.
  function matching(uid, req, prem) {
    const t = now();
    return q("SELECT id, model, created_at, origin FROM cars WHERE owner_id = ? AND status IN ('garage', 'showcase')").all(uid)
      .filter((c) => B.matches(req, c.model))
      .map((c) => {
        const sell = S.sellPriceOf(c.model, t - c.created_at, c.origin);
        return { id: c.id, model: c.model, sell, pay: B.payOf(sell, prem) };
      })
      .sort((a, b) => b.pay - a.pay || a.id - b.id);
  }
  function out(uid, o) {
    const req = JSON.parse(o.req);
    const sold = o.sold_at ? { model: o.sold_model, paid: o.paid, bonus: o.bonus, at: o.sold_at } : null;
    return {
      day: o.day, kind: o.kind, req, text: B.reqText(req), prem: o.prem, city: o.city, line: o.line,
      createdAt: o.created_at, expiresAt: o.expires_at, sold,
      cars: sold ? [] : matching(uid, req, o.prem), lastCar: carCount(uid) <= 1,
      // Where the asked car can drop (a hint for the card when the garage has none).
      cases: sold ? [] : B.casesFor(req),
    };
  }

  // For `me`: the offer of the day while it runs (a sold one too, to show «продано»), null otherwise.
  function brief(uid) {
    if (!isOpen(uid, B.BUYER.feature)) return null;
    const o = ensure(uid);
    if (!o) return carCount(uid) < B.BUYER.newbieCars ? { hint: B.NEWBIE_HINT } : null; // fix5: a calm line, no card
    if (o.expires_at <= now()) return null;
    return out(uid, o);
  }

  function sellTo(uid, body) {
    const id = int(body?.carId, 1, Number.MAX_SAFE_INTEGER, 'ID авто');
    const o = current(uid);
    if (!o || o.expires_at <= now()) fail('Покупець уже поїхав — новий з’явиться завтра');
    if (o.sold_at) fail('Сьогодні покупець уже купив машину');
    const req = JSON.parse(o.req);
    const c = noSecret(ownCar(uid, id, ['garage', 'showcase']));
    if (!B.matches(req, c.model)) fail(`Покупець шукає ${B.reqText(req)}`);
    const { got } = sellCar(uid, c.id); // the ordinary sale: refuses the last car, returns parts and the plate
    const paid = B.payOf(got, o.prem), bonus = paid - got;
    if (bonus > 0) addMoney(uid, bonus);
    const done = q('UPDATE buyer_offers SET sold_at = ?, car_id = ?, sold_model = ?, paid = ?, bonus = ? WHERE user_id = ? AND day = ? AND sold_at IS NULL')
      .run(now(), c.id, c.model, paid, bonus, uid, o.day).changes;
    if (!done) fail('Сьогодні покупець уже купив машину');
    return { got: paid, dealer: got, bonus, model: c.model };
  }

  // ---------- the bot reminder: «покупець чекає ще 1 год» ----------
  // Only for a player who has a car the buyer takes (and more than one car); src/reminders.js applies quiet hours,
  // 2 a day, idle players only and one 'buyer' line a day.
  function remind(list, rules) {
    const t = now(), soon = B.BUYER.remindMin * 60e3;
    const rows = q(`SELECT o.user_id, o.req, o.prem, o.city, o.expires_at, u.last_seen, u.push_day, u.push_count, u.push_last, u.push_sent
      FROM buyer_offers o JOIN users u ON u.id = o.user_id
      WHERE o.sold_at IS NULL AND o.expires_at > ? AND o.expires_at <= ? AND u.push_off = 0 AND u.push_blocked = 0 AND u.banned = 0
      AND u.last_seen BETWEEN ? AND ?`).all(t + 10 * 60e3, t + soon, t - rules.inactiveDays * 86400e3, t - rules.idleMin * 60e3);
    if (!rows.length) return list;
    const byId = new Map(list.map((c) => [c.uid, c]));
    for (const r of rows) {
      const req = JSON.parse(r.req);
      if (carCount(r.user_id) <= 1 || !ownModels(r.user_id).some((m) => B.matches(req, m))) continue;
      const mins = Math.round((r.expires_at - t) / 60e3);
      const text = `🕵️ Таємний покупець з ${r.city} чекає ще ${mins >= 50 ? '1 год' : `${mins} хв`}: ${B.reqText(req)} — +${Math.round(r.prem * 100)}% до ціни дилера`;
      const item = { kind: 'buyer', at: r.expires_at - soon, text };
      const c = byId.get(r.user_id);
      if (c) {
        if (!c.ready.some((x) => x.kind === 'buyer')) c.ready.push(item);
        continue;
      }
      let sent = {};
      try {
        sent = JSON.parse(r.push_sent || '{}') || {};
      } catch {}
      list.push({ uid: r.user_id, lastSeen: r.last_seen, pushOff: false, blocked: false, pushDay: r.push_day, pushCount: r.push_count, pushLast: r.push_last, sent, ready: [item] });
    }
    return list;
  }

  // ---------- admin (read-only numbers) ----------
  function adminView() {
    const sum = (where = '1', ...a) => q(`SELECT COUNT(*) offers, COUNT(sold_at) sold, COALESCE(SUM(paid), 0) paid, COALESCE(SUM(bonus), 0) bonus FROM buyer_offers WHERE ${where}`).get(...a);
    const days = q(`SELECT day, COUNT(*) offers, COUNT(sold_at) sold, COALESCE(SUM(paid), 0) paid, COALESCE(SUM(bonus), 0) bonus
      FROM buyer_offers GROUP BY day ORDER BY day DESC LIMIT 7`).all();
    const kinds = q('SELECT kind, COUNT(*) offers, COUNT(sold_at) sold FROM buyer_offers GROUP BY kind').all();
    return { all: sum(), today: sum('day = ?', dayOf(now())), days, kinds };
  }

  return {
    brief, remind,
    api: { 'buyer/sell': sellTo },
    gates: { 'buyer/sell': B.BUYER.feature },
    admin: { buyer: () => adminView() },
  };
}
