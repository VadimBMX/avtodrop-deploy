// «Причал» on the server: the container auction (rules and the pure engine in public/containers.js).
// Lots are always open: one per tier (Порт Одеса, Митниця, Контейнер з Японії). A lot waits for a human bid with the
// bots' warm-up price on it; the first human bid starts 90 s of live bidding, a bid in the last 15 s extends it (5 min
// at most). Everything is decided here: the content (from a secret seed, committed with sha256 before anyone bids),
// the bots' limits (never sent to the client), every bid and every deadline. The bots act lazily: their next answer
// is stored as `pending` (bot, time, amount) and applied by tick() whenever the lot is read, bid on or swept (every
// 15 s by the server's sweeper, only lots with live bidding). Each API call runs in one transaction (src/game.js), so
// two bids at once are applied one after the other; a stale version is refused.
// Money: a bid is taken from the balance at once (escrow) and given back when someone outbids it; the winner's bid is
// destroyed (no seller), so the feature only removes money (≈ 20% of each win on average, see test/containers.test.js).
import crypto from 'node:crypto';
import * as S from '../public/shared.js';
import * as C from '../public/containers.js';

const R = C.CONTAINER_RULES;
const ON_KEY = 'containers_on'; // meta: '0' = switched off by an admin; anything else (or nothing) = on
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const OPEN = "status IN ('waiting', 'live')";
const ACTIVE = "status IN ('soon', 'waiting', 'live')"; // + the evening lot before 20:00 (no bids yet)

export function createContainers(ctx) {
  const { db, q, now, fail, int, name, addMoney, pay, notify, giveCar, carRow, carOut, garageCount, userRow, metaGet, metaSet, alog, bank, recalc } = ctx;
  const newSeed = ctx.seed || (() => crypto.randomInt(2 ** 31));
  const seen = new Map(); // uid → when the lot screen last polled (an outbid push goes to the bot only when he's away)
  const lastBid = new Map(); // uid → time of the last bid (one a second)
  const pushed = new Map(); // `${uid}:${lot}` → time of the last «тебе перебили» push (one a minute per lot)
  const isOn = () => metaGet(ON_KEY) !== '0';
  // Event lots (C.EVENT_TIERS): on the pier only while their event runs (ctx.eventOn, src/halloween.js).
  const eventOn = (ev) => !!ctx.eventOn?.(ev);
  const tiersNow = () => [...C.CONTAINER_TIERS, ...C.EVENT_TIERS.filter((t) => eventOn(t.event))];

  const parse = (L) => ({ ...L, hints: JSON.parse(L.hints), bots: JSON.parse(L.bots), pending: L.pending ? JSON.parse(L.pending) : null });
  const row = (id) => {
    const L = q('SELECT * FROM container_lots WHERE id = ?').get(id);
    return L ? parse(L) : null;
  };
  const bidderName = (code) => (code < 0 ? C.botOf(code)?.name || 'Бот' : code ? name(code) : '—');
  const tell = (uid, text, push) => {
    q('INSERT INTO events (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, text, now());
    if (!push) return;
    try {
      notify(uid, text);
    } catch {}
  };
  const lotTitle = (L) => `«${C.TIER_BY[L.tier].name}» №${L.id}`;

  // ---------- a new lot ----------
  function spawn(tierId) {
    const t = now();
    const L = C.spawnLot(tierId, newSeed());
    const salt = crypto.randomBytes(16).toString('hex');
    const seed = newSeed();
    const lead = C.botCode(L.leader);
    const r = q(`INSERT INTO container_lots (tier, model, ed, junk, hints, commit_hash, salt, seed, bots, ev, top_bid, top_bidder, ends_at, created_at)
      VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`).run(tierId, L.model, L.ed ? 1 : 0, L.junk ? 1 : 0, JSON.stringify(L.hints), salt, seed, JSON.stringify(L.bots), Math.round(L.ev), L.start, lead, t + R.waitMs, t);
    const id = Number(r.lastInsertRowid);
    q('UPDATE container_lots SET commit_hash = ? WHERE id = ?').run(sha256(C.commitText(id, L.model, L.ed, L.junk, salt)), id);
    // The warm-up: another bot opened lower, the leader topped it (the feed isn't empty before the first human).
    const other = L.bots.find((b) => b.id !== L.leader && b.max > 0);
    if (other) q('INSERT INTO container_bids (lot_id, bidder, amount, at) VALUES (?, ?, ?, ?)').run(id, C.botCode(other.id), Math.max(1000, Math.round((L.start * 0.8) / C.unitOf(L.start)) * C.unitOf(L.start)), t - 4000);
    q('INSERT INTO container_bids (lot_id, bidder, amount, at) VALUES (?, ?, ?, ?)').run(id, lead, L.start, t - 1000);
    return id;
  }
  // One open lot per tier, always (while the feature is on).
  function ensure() {
    // An event that ended takes its lots nobody bid on off the pier; live ones finish as usual (money in escrow).
    for (const t of C.EVENT_TIERS) if (!eventOn(t.event)) q("UPDATE container_lots SET status = 'cancelled', settled_at = ?, pending = NULL WHERE tier = ? AND status = 'waiting' AND humans = 0").run(now(), t.id);
    if (!isOn()) return;
    for (const t of tiersNow()) if (!q(`SELECT 1 FROM container_lots WHERE tier = ? AND ${OPEN}`).get(t.id)) spawn(t.id);
    evening();
  }

  // ---------- the bots' next answer ----------
  function decide(L, at) {
    const r = C.rng((L.seed ^ Math.imul(L.bids + 1, 2654435761)) >>> 0);
    const mv = C.botMove({ top: L.top_bid, leader: L.top_bidder, endsAt: L.ends_at, liveAt: L.live_at, bots: L.bots }, at, r);
    for (const id of mv.passes) {
      L.bots.find((b) => b.id === id).passed = true;
      q('INSERT INTO container_bids (lot_id, bidder, amount, at) VALUES (?, ?, 0, ?)').run(L.id, C.botCode(id), at);
    }
    L.pending = mv.action;
  }
  const save = (L, extra = '') => q(`UPDATE container_lots SET top_bid = ?, top_bidder = ?, bids = ?, humans = ?, status = ?, live_at = ?, ends_at = ?, bots = ?, pending = ?, version = version + 1${extra} WHERE id = ?`)
    .run(L.top_bid, L.top_bidder, L.bids, L.humans, L.status, L.live_at, L.ends_at, JSON.stringify(L.bots), L.pending ? JSON.stringify(L.pending) : null, L.id);

  // Brings a lot up to time t: the bots' answers that are due (each at its own moment, with its own extension), then
  // the end. Returns the lot as it is now.
  function tick(L, t = now()) {
    if (L.status === 'soon') {
      if (t < L.live_at) return L;
      goLive(L);
    }
    if (L.status !== 'waiting' && L.status !== 'live') return L;
    let changed = false;
    while (L.status === 'live' && L.pending && L.pending.at <= t && L.pending.at < L.ends_at) {
      const a = L.pending, code = C.botCode(a.bot);
      const prev = L.top_bidder, prevBid = L.top_bid;
      L.top_bid = a.amount;
      L.top_bidder = code;
      L.bids++;
      L.ends_at = C.extendEnd(L.ends_at, a.at, L.live_at);
      q('INSERT INTO container_bids (lot_id, bidder, amount, at) VALUES (?, ?, ?, ?)').run(L.id, code, a.amount, a.at);
      if (prev > 0) outbid(prev, prevBid, L, C.botOf(code).name);
      decide(L, a.at);
      changed = true;
    }
    if (changed) save(L);
    if (t >= L.ends_at) settle(L, t);
    return row(L.id);
  }
  function outbid(uid, back, L, by) {
    addMoney(uid, back);
    const key = `${uid}:${L.id}`, t = now();
    const push = !(seen.get(uid) > t - 10e3) && !(pushed.get(key) > t - 60e3);
    if (push) pushed.set(key, t);
    if (pushed.size > 5000) pushed.clear();
    tell(uid, `⚠️ Тебе перебили на ${lotTitle(L)}: ${S.fmt(L.top_bid)} (${by}). Ставку ${S.fmt(back)} повернуто`, push);
  }

  // The end of a lot, exactly once (the status guard): a human winner gets the car — in the garage, or on the showcase
  // when the garage is full — with its serial when it's an edition and 100% dirt when it was flooded. Then a new lot.
  function settle(L, t = now()) {
    if (!q(`UPDATE container_lots SET status = 'done', settled_at = ?, pending = NULL, version = version + 1 WHERE id = ? AND ${OPEN}`).run(t, L.id).changes) return;
    if (L.top_bidder > 0) {
      const uid = L.top_bidder;
      bank(uid);
      const g = giveCar(uid, L.model, 'container');
      let serial = null;
      if (L.ed) {
        q('INSERT INTO edition_serials (model, next) VALUES (?, 1) ON CONFLICT DO NOTHING').run(L.model);
        serial = q('SELECT next FROM edition_serials WHERE model = ?').get(L.model).next;
        q('UPDATE edition_serials SET next = next + 1 WHERE model = ?').run(L.model);
        q('UPDATE cars SET serial = ? WHERE id = ?').run(serial, g.id);
      }
      if (L.junk) q('UPDATE cars SET dirt = 100, dirt_at = ? WHERE id = ?').run(t, g.id);
      if (garageCount(uid) > userRow(uid).slots) q("UPDATE cars SET status = 'showcase' WHERE id = ?").run(g.id);
      q('UPDATE container_lots SET car_id = ?, serial = ? WHERE id = ?').run(g.id, serial, L.id);
      tell(uid, `🔨 Ти виграв ${lotTitle(L)} за ${S.fmt(L.top_bid)}! Відкрий контейнер на «Причалі» (Ринок → Причал)`, true);
      recalc(uid);
    }
    ensure();
  }

  // ---------- «Вечірній аукціон» (Контейнери 2.0) ----------
  // One lot a day: made EVENING.warnMin before 20:00 Kyiv (status 'soon', live_at = the start; the reminder goes to the
  // players who asked for it), live at 20:00 for EVENING.liveMs with the usual extensions. A server that was down
  // makes it up to EVENING.lateMs after the start, live at once. The bots start bidding among themselves at the start.
  const subbed = (uid) => !!q('SELECT 1 FROM container_subs WHERE user_id = ?').get(uid);
  const eveningRow = (s) => {
    const L = q("SELECT * FROM container_lots WHERE tier = 'evening' AND created_at >= ? ORDER BY id DESC LIMIT 1").get(s - C.EVENING.warnMin * 60e3 - C.EVENING.lateMs);
    return L ? parse(L) : null;
  };
  function evening(t = now()) {
    if (!isOn()) return;
    const s = C.eveningStart(t);
    if (t < s - C.EVENING.warnMin * 60e3 || t >= s + C.EVENING.lateMs || eveningRow(s)) return;
    const id = spawn('evening');
    const late = t >= s;
    q("UPDATE container_lots SET status = 'soon', live_at = ?, ends_at = ? WHERE id = ?").run(late ? t : s, (late ? t : s) + C.EVENING.liveMs, id);
    const L = row(id), post = C.posterior('evening', L.hints);
    const what = [S.COUNTRIES[L.hints.country]?.name, C.BODY_NAMES[L.hints.body], L.hints.cls && S.CLASSES[L.hints.cls].name.toLowerCase(), L.hints.dec && C.decadeText(L.hints.dec)].filter(Boolean).join(', ');
    const text = `🌆 ${late ? 'Вечірній аукціон уже йде' : `Вечірній аукціон о ${C.EVENING.hour}:00 — через ${Math.max(1, Math.round((s - t) / 60e3))} хв`}: ${what} · оцінка ${S.short(post.lo)}–${S.short(post.hi)}. Ринок → Причал`;
    for (const u of q('SELECT s.user_id id FROM container_subs s JOIN users u ON u.id = s.user_id WHERE u.banned = 0').all()) tell(u.id, text, true);
    if (late) tick(row(id), t);
  }
  function goLive(L) {
    L.status = 'live';
    L.ends_at = L.live_at + C.EVENING.liveMs;
    decide(L, L.live_at);
    save(L);
  }
  function eveningSub(uid, { on }) {
    if (on) q('INSERT OR IGNORE INTO container_subs (user_id, at) VALUES (?, ?)').run(uid, now());
    else q('DELETE FROM container_subs WHERE user_id = ?').run(uid);
    return { sub: subbed(uid) };
  }
  function eveningOut(uid) {
    const t = now(), s = C.eveningStart(t);
    const L = eveningRow(s);
    const at = t < s ? s : C.nextEvening(s + C.EVENING.lateMs); // after 20:00 the tile counts down to tomorrow
    return { at, hour: C.EVENING.hour, warnMin: C.EVENING.warnMin, sub: subbed(uid), level: C.EVENING_TIER.level, lot: L ? lotOut(tick(L, t), uid) : null };
  }

  // ---------- «Огляд експерта» (Контейнери 2.0) ----------
  const expertOf = (lotId, uid) => {
    const r = uid > 0 ? q('SELECT field, value FROM container_expert WHERE lot_id = ? AND user_id = ?').get(lotId, uid) : null;
    return r ? { field: r.field, value: JSON.parse(r.value) } : null;
  };
  function expert(uid, { id, field }) {
    if (!isOn()) fail('Причал зараз зачинено — зазирни пізніше');
    let L = row(int(id, 1, Number.MAX_SAFE_INTEGER, 'Лот'));
    if (!L) fail('Лот не знайдено');
    L = tick(L);
    if (!['soon', 'waiting', 'live'].includes(L.status)) fail('Торги за цим контейнером уже завершено');
    const tier = C.TIER_BY[L.tier];
    if (userRow(uid).level < tier.level) fail(`«${tier.name}» відкривається з рівня ${tier.level}`);
    if (expertOf(L.id, uid)) fail('Експерт уже оглянув цей контейнер для тебе');
    const f = String(field || '');
    if (!C.expertFields(L.hints).includes(f)) fail('Цей факт уже видно — обери інший');
    const price = C.expertPrice(C.posterior(L.tier, L.hints));
    pay(uid, price);
    q('INSERT INTO container_expert (lot_id, user_id, field, value, price, at) VALUES (?, ?, ?, ?, ?, ?)').run(L.id, uid, f, JSON.stringify(C.factOf(L.model, f)), price, now());
    return lot(uid, { id: L.id, full: true });
  }

  // ---------- what the app sees ----------
  const feedOf = (L, uid, n = 14) => q('SELECT bidder, amount, at FROM container_bids WHERE lot_id = ? ORDER BY at DESC, rowid DESC LIMIT ?').all(L.id, n)
    .map((b) => ({ who: bidderName(b.bidder), bot: C.botOf(b.bidder)?.id || null, me: b.bidder === uid, amount: b.amount, at: b.at, pass: b.amount === 0 ? C.botOf(b.bidder)?.line || 'пас' : null }));
  function resultOf(L, uid) {
    if (L.status !== 'done' && L.status !== 'cancelled') return null;
    return { model: L.model, ed: !!L.ed, junk: !!L.junk, salt: L.salt, winner: L.status === 'done' ? bidderName(L.top_bidder) : null, bot: C.botOf(L.top_bidder)?.id || null,
      mine: L.status === 'done' && L.top_bidder === uid, price: L.top_bid, sale: C.saleOfModel(L.model), value: S.MODELS[L.model].price, opened: !!L.opened,
      carId: L.top_bidder === uid ? L.car_id : null, serial: L.serial, cancelled: L.status === 'cancelled', at: L.settled_at };
  }
  function lotOut(L, uid, full = false) {
    const t = now(), pub = C.posterior(L.tier, L.hints), ex = expertOf(L.id, uid);
    const post = ex ? C.narrow(pub, { [ex.field]: ex.value }) : pub; // the buyer's honest list: the public one with his fact
    const out = { id: L.id, tier: L.tier, hints: L.hints, commit: L.commit_hash, status: L.status, topBid: L.top_bid, leader: bidderName(L.top_bidder), leaderBot: C.botOf(L.top_bidder)?.id || null,
      mine: L.top_bidder === uid, bids: L.bids, endsAt: L.ends_at, liveAt: L.live_at, minBid: C.minNext(L.top_bid), version: L.version, now: t,
      est: { lo: post.lo, hi: post.hi, ev: Math.round(post.ev), n: post.rows.length }, bots: L.bots.map((b) => ({ id: b.id, passed: !!b.passed })), result: resultOf(L, uid),
      expert: ex, expertPrice: ex ? null : C.expertPrice(pub), expertFields: ex ? [] : C.expertFields(L.hints) };
    if (full) out.post = post.rows;
    return out;
  }
  const escrowOf = (uid) => q(`SELECT COALESCE(SUM(top_bid), 0) n FROM container_lots WHERE top_bidder = ? AND ${OPEN}`).get(uid).n;
  const unopened = (uid) => q("SELECT id FROM container_lots WHERE top_bidder = ? AND status = 'done' AND opened = 0 ORDER BY id").all(uid).map((r) => r.id);

  function list(uid) {
    for (const L of q(`SELECT * FROM container_lots WHERE ${ACTIVE}`).all()) tick(parse(L));
    ensure();
    const lots = q(`SELECT * FROM container_lots WHERE ${OPEN} AND tier <> 'evening' ORDER BY id`).all().map(parse)
      .sort((a, b) => C.CONTAINER_TIERS.findIndex((t) => t.id === a.tier) - C.CONTAINER_TIERS.findIndex((t) => t.id === b.tier)).map((L) => lotOut(L, uid));
    const recent = q("SELECT * FROM container_lots WHERE status = 'done' ORDER BY settled_at DESC, id DESC LIMIT 8").all().map(parse).map((L) => ({ id: L.id, tier: L.tier, ...resultOf(L, uid) }));
    const u = userRow(uid);
    return { on: isOn(), lots, recent, escrow: escrowOf(uid), unopened: unopened(uid), maxBid: C.maxBidOf(u.balance), level: u.level, now: now(), evening: isOn() ? eveningOut(uid) : null };
  }
  function lot(uid, { id, full }) {
    let L = row(int(id, 1, Number.MAX_SAFE_INTEGER, 'Лот'));
    if (!L) fail('Лот не знайдено');
    seen.set(uid, now());
    if (seen.size > 5000) seen.clear();
    L = tick(L);
    const u = userRow(uid);
    return { lot: lotOut(L, uid, !!full), feed: feedOf(L, uid), maxBid: C.maxBidOf(u.balance), escrow: escrowOf(uid), next: L.status === 'done' || L.status === 'cancelled' ? q(`SELECT id FROM container_lots WHERE tier = ? AND ${OPEN}`).get(L.tier)?.id || null : null };
  }

  function bid(uid, { id, amount }) {
    if (!isOn()) fail('Причал зараз зачинено — зазирни пізніше');
    const t = now();
    if (lastBid.get(uid) > t - R.bidGapMs) fail('Не так швидко — одна ставка на секунду');
    let L = row(int(id, 1, Number.MAX_SAFE_INTEGER, 'Лот'));
    if (!L) fail('Лот не знайдено');
    L = tick(L, t);
    if (L.status === 'soon') fail(`Торги стартують о ${C.EVENING.hour}:00 — поки можна роздивитись підказки й покликати експерта`);
    if (L.status !== 'waiting' && L.status !== 'live') fail('Торги за цим контейнером уже завершено');
    const tier = C.TIER_BY[L.tier], u = userRow(uid);
    if (tier.event && L.status === 'waiting' && !eventOn(tier.event)) fail('Подія завершилась — цей контейнер уже зняли з причалу');
    if (u.level < tier.level) fail(`«${tier.name}» відкривається з рівня ${tier.level}`);
    if (L.top_bidder === uid) fail('Ти вже лідер цього лоту');
    const amt = int(amount, 1, 1e13, 'Ставка');
    const min = C.minNext(L.top_bid);
    if (amt < min) fail(`Мінімальна ставка ${S.fmt(min)}`);
    const cap = C.maxBidOf(u.balance);
    if (amt > cap) fail(cap < min ? `Замало грошей: ставка — не більше половини балансу (до ${S.fmt(cap)})` : `Ставка — не більше половини балансу: до ${S.fmt(cap)}`);
    if (q(`SELECT COUNT(*) n FROM container_lots WHERE top_bidder = ? AND ${OPEN} AND id <> ?`).get(uid, L.id).n >= R.maxLeading) fail(`Бути лідером можна щонайбільше в ${R.maxLeading} лотах одночасно`);
    if (q("SELECT COUNT(*) n FROM container_lots WHERE top_bidder = ? AND status = 'done' AND settled_at > ?").get(uid, t - 86400e3).n >= R.winsPerDay) fail(`Ліміт: ${R.winsPerDay} виграних контейнерів на добу`);
    pay(uid, amt);
    const prev = L.top_bidder, prevBid = L.top_bid;
    if (L.status === 'waiting') {
      L.status = 'live';
      L.live_at = t;
      L.ends_at = t + R.liveMs;
    } else L.ends_at = C.extendEnd(L.ends_at, t, L.live_at);
    L.top_bid = amt;
    L.top_bidder = uid;
    L.bids++;
    L.humans++;
    q('INSERT INTO container_bids (lot_id, bidder, amount, at) VALUES (?, ?, ?, ?)').run(L.id, uid, amt, t);
    if (prev > 0) outbid(prev, prevBid, L, name(uid));
    decide(L, t);
    save(L);
    lastBid.set(uid, t);
    if (lastBid.size > 5000) lastBid.clear();
    return lot(uid, { id: L.id });
  }

  // The winner opens the doors: the car (already in the garage since the lot ended) for the reveal. Repeating is harmless.
  function open(uid, { id }) {
    const L = row(int(id, 1, Number.MAX_SAFE_INTEGER, 'Лот'));
    if (!L || L.status !== 'done' || L.top_bidder !== uid) fail('Це не твій контейнер');
    q('UPDATE container_lots SET opened = 1 WHERE id = ?').run(L.id);
    const c = L.car_id ? carRow(L.car_id) : null;
    return { car: c && c.owner_id === uid ? carOut(c) : null, result: resultOf({ ...L, opened: 1 }, uid), tier: L.tier };
  }

  // Server sweeper: lots with live bidding are brought up to date (bots' answers, endings) even when nobody looks.
  function sweep() {
    let n = 0;
    evening(); // the evening lot comes up (and its reminder goes out) even when nobody looks
    for (const L of q("SELECT * FROM container_lots WHERE status IN ('soon', 'live')").all()) {
      tick(parse(L));
      n++;
    }
    return n;
  }

  // ---------- admin ----------
  function adminView() {
    const t = now(), since = t - 7 * 86400e3;
    const open = q(`SELECT * FROM container_lots WHERE ${ACTIVE} ORDER BY id`).all().map(parse).map((L) => ({
      id: L.id, tier: L.tier, status: L.status, hints: L.hints, commit: L.commit_hash, topBid: L.top_bid, leader: bidderName(L.top_bidder), human: L.top_bidder > 0 ? L.top_bidder : null,
      bids: L.bids, humans: L.humans, endsAt: L.ends_at, est: (({ lo, hi, ev }) => ({ lo, hi, ev: Math.round(ev) }))(C.posterior(L.tier, L.hints)),
    }));
    const recent = q("SELECT * FROM container_lots WHERE status IN ('done', 'cancelled') ORDER BY COALESCE(settled_at, created_at) DESC LIMIT 30").all().map(parse).map((L) => ({
      id: L.id, tier: L.tier, status: L.status, model: L.model, ed: !!L.ed, junk: !!L.junk, serial: L.serial, price: L.top_bid, winner: bidderName(L.top_bidder), human: L.top_bidder > 0 ? L.top_bidder : null,
      sale: C.saleOfModel(L.model), bots: L.bots.map((b) => ({ id: b.id, max: b.max })), at: L.settled_at,
    }));
    const done = q("SELECT tier, top_bid, top_bidder, model, ed FROM container_lots WHERE status = 'done' AND settled_at > ?").all(since);
    const hum = done.filter((l) => l.top_bidder > 0);
    const paid = hum.reduce((s, l) => s + l.top_bid, 0), sale = hum.reduce((s, l) => s + C.saleOfModel(l.model), 0);
    const byTier = [...C.CONTAINER_TIERS, ...C.EVENT_TIERS, C.EVENING_TIER].map((tr) => {
      const h = hum.filter((l) => l.tier === tr.id), p = h.reduce((s, l) => s + l.top_bid, 0);
      return { tier: tr.id, done: done.filter((l) => l.tier === tr.id).length, human: h.length, paid: p, ret: p ? h.reduce((s, l) => s + C.saleOfModel(l.model), 0) / p : null };
    });
    const ex = q('SELECT COUNT(*) n, COALESCE(SUM(price), 0) spent FROM container_expert WHERE at > ?').get(since);
    return { on: isOn(), open, recent, week: { done: done.length, human: hum.length, bots: done.length - hum.length, paid, sale, ret: paid ? sale / paid : null, editions: hum.filter((l) => l.ed).length, byTier, expert: { n: ex.n, spent: ex.spent } },
      evening: { at: C.nextEvening(t), subs: q('SELECT COUNT(*) n FROM container_subs').get().n },
      history: q("SELECT admin, action, details, created_at at FROM admin_log WHERE action LIKE 'containers%' ORDER BY id DESC LIMIT 10").all().map((r) => ({ ...r, details: JSON.parse(r.details || 'null') })) };
  }
  // Off: no new lots and no new bids; lots nobody bid on yet are taken off; live ones finish as usual (money in escrow).
  function adminToggle(who, { on }) {
    const to = !!on;
    metaSet(ON_KEY, to ? '1' : '0');
    let removed = 0;
    if (!to) removed = q("UPDATE container_lots SET status = 'cancelled', settled_at = ?, pending = NULL WHERE status IN ('soon', 'waiting') AND humans = 0").run(now()).changes;
    else ensure();
    alog(who, 'containers-toggle', null, { on: to, removed });
    return { on: to, removed };
  }
  // Close a lot by hand: a human leader gets his bid back, the lot is cancelled (its content stays hidden from players
  // but the admin sees it in «Завершені») and a fresh lot of the tier takes its place.
  function adminClose(who, { id }) {
    const L = row(int(id, 1, Number.MAX_SAFE_INTEGER, 'Лот'));
    if (!L || !['soon', 'waiting', 'live'].includes(L.status)) fail('Лот уже завершено');
    q("UPDATE container_lots SET status = 'cancelled', settled_at = ?, pending = NULL, version = version + 1 WHERE id = ?").run(now(), L.id);
    if (L.top_bidder > 0) {
      addMoney(L.top_bidder, L.top_bid);
      tell(L.top_bidder, `🔨 Лот ${lotTitle(L)} закрито адміністрацією — ставку ${S.fmt(L.top_bid)} повернуто`, true);
    }
    alog(who, 'containers-close', L.top_bidder > 0 ? L.top_bidder : null, { lot: L.id, tier: L.tier, refund: L.top_bidder > 0 ? L.top_bid : 0 });
    ensure();
    return { closed: L.id };
  }

  return {
    isOn, ensure, tick: (id, t) => tick(row(id), t), sweep, spawn,
    api: { containers: list, 'containers/lot': lot, 'containers/bid': bid, 'containers/open': open, 'containers/expert': expert, 'containers/evening': eveningSub },
    admin: { containers: () => adminView(), 'containers/toggle': adminToggle, 'containers/close': adminClose },
    mutating: ['containers/toggle', 'containers/close'],
    gates: { 'containers/bid': 'auction', 'containers/expert': 'auction' },
  };
}
