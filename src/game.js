import crypto from 'node:crypto';
import fs from 'node:fs';
import * as S from '../public/shared.js';
import * as T from '../public/tune.js';
import * as M from './metrics.js';

export class GameError extends Error {}
const fail = (msg) => {
  throw new GameError(msg);
};

const KYIV = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayOf = (t) => KYIV.format(new Date(t));
export function weekOf(t) {
  const d = new Date(dayOf(t) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function int(v, min, max, what = 'Значення') {
  const n = typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${what}: некоректне число`);
  return n;
}
function idList(v, max) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) fail('Некоректний список');
  const ids = v.map((x) => int(x, 1, Number.MAX_SAFE_INTEGER, 'ID'));
  if (new Set(ids).size !== ids.length) fail('Елементи повторюються');
  return ids;
}
// Own keys only: `'constructor' in obj` is true for every plain object and turns race times into NaN.
const okShifts = (shifts) => Array.isArray(shifts) && shifts.length === S.SHIFTS && shifts.every((s) => typeof s === 'string' && Object.hasOwn(S.SHIFT_LOSS, s));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newSeed = () => crypto.randomBytes(32).toString('hex');
const round3 = (x) => Math.round(x * 1000) / 1000;

export function fairRoll(serverSeed, clientSeed, nonce, sub) {
  const h = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}:${sub}`).digest('hex');
  return parseInt(h.slice(0, 13), 16) / 16 ** 13;
}
export function pickWeighted(entries, r) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [k, w] of entries) if ((x -= w) < 0) return k;
  return entries[entries.length - 1][0];
}
export const classEntries = (weights) => S.CLASS_ORDER.filter((c) => weights[c]).map((c) => [c, weights[c]]);
export function pickModel(list, r) {
  const w = S.modelWeights(list);
  return pickWeighted(list.map((m, i) => [m.id, w[i]]), r);
}

// Small deterministic RNG for stable "win chance" estimates.
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
// Cars whose photo has a good body mask (public/paint/meta.json from `npm run paint-masks`; `off` = disabled by hand).
export function paintableModels(file = new URL('../public/paint/meta.json', import.meta.url)) {
  try {
    const cars = JSON.parse(fs.readFileSync(file, 'utf8')).cars || {};
    return new Set(Object.keys(cars).filter((id) => cars[id].w && !cars[id].off));
  } catch {
    return new Set();
  }
}

export function createGame(db, opts = {}) {
  const notify = opts.notify || (() => {});
  const now = opts.now || (() => Date.now());
  const rnd = opts.random || Math.random;
  const q = db.q;

  // ---------- game events (S.EVENTS) ----------
  // What runs is computed from the clock (S.eventsBetween); the only state is the admin overrides in meta.events_override:
  // { forced: [{ key, id, start, end, country?, by }], stopped: { eventKey: stoppedAt } }.
  const EVENT_PUSH_H = 12; // a bot reminder about an event goes out only in its first hours
  const EV_META = 'events_override';
  function loadEventOv() {
    try {
      const v = JSON.parse(q('SELECT value FROM meta WHERE key = ?').get(EV_META)?.value || 'null');
      if (v && typeof v === 'object') return { forced: Array.isArray(v.forced) ? v.forced.filter((f) => S.EVENTS[f?.id]) : [], stopped: v.stopped && typeof v.stopped === 'object' ? v.stopped : {} };
    } catch {}
    return { forced: [], stopped: {} };
  }
  let evOv = loadEventOv();
  // Kept small: overrides that ended more than 8 days ago can't touch anything any more (the longest event is 7 days).
  function saveEventOv(ov) {
    const old = now() - 8 * 86400e3;
    const clean = { forced: ov.forced.filter((f) => f.end > old), stopped: Object.fromEntries(Object.entries(ov.stopped).filter(([, at]) => at > old)) };
    q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT DO UPDATE SET value = excluded.value').run(EV_META, JSON.stringify(clean));
    evOv = clean;
  }
  const evFx = () => S.effectsAt(now(), evOv);
  // For the client: what runs now and the next few, with their times (countdowns are drawn from these).
  function gameEvents() {
    const t = now();
    const list = S.eventsBetween(t, t + 8 * 86400e3, evOv);
    return { active: list.filter((e) => e.start <= t).map(S.eventInfo), next: list.filter((e) => e.start > t).slice(0, 4).map(S.eventInfo) };
  }

  // ---------- basic helpers ----------
  function userRow(uid) {
    const u = q('SELECT * FROM users WHERE id = ?').get(uid);
    if (!u) fail('Гравця не знайдено');
    return u;
  }
  function event(uid, text) {
    q('INSERT INTO events (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, text, now());
    try {
      notify(uid, text);
    } catch {}
  }
  const addMoney = (uid, n) => {
    const r = q('UPDATE users SET balance = balance + ? WHERE id = ?').run(Math.round(n), uid);
    if (r.changes) moneyFlow(Math.round(n));
    return r;
  };
  function pay(uid, n) {
    if (!n) return;
    if (!q('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?').run(n, uid, n).changes) fail('Недостатньо гривень');
    moneyFlow(-n);
  }
  // Economy health for the admin dashboard: hryvnias created (+) and destroyed (−) per Kyiv day.
  function moneyFlow(n) {
    if (!n) return;
    q('INSERT INTO money_days (day, created, destroyed) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET created = created + excluded.created, destroyed = destroyed + excluded.destroyed')
      .run(dayOf(now()), n > 0 ? n : 0, n < 0 ? -n : 0);
    srcFlow(n); // the same split by what moved it (owner metrics, below)
  }
  const addKeys = (uid, caseId, n) => q('INSERT INTO keys (user_id, case_id, count) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET count = count + excluded.count').run(uid, caseId, n);
  const addPart = (uid, type, tier, n = 1) => q('INSERT INTO parts (user_id, type, tier, count) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET count = count + excluded.count').run(uid, type, tier, n);
  function name(uid) {
    if (uid === 0) return 'Дилер АВТОДРОП';
    const u = q('SELECT username, first_name FROM users WHERE id = ?').get(uid);
    if (!u) return 'Гравець';
    return u.username ? '@' + u.username : u.first_name || 'Гравець ' + uid;
  }

  // ---------- cars ----------
  function carRow(id) {
    return q('SELECT * FROM cars WHERE id = ?').get(id);
  }
  function carParts(carId) {
    return Object.fromEntries(q('SELECT type, tier FROM car_parts WHERE car_id = ?').all(carId).map((r) => [r.type, r.tier]));
  }
  const carPlate = (carId) => q('SELECT id, text, cls, value FROM plates WHERE car_id = ?').get(carId) || null;
  const vipOf = (uid) => (q('SELECT vip_until FROM users WHERE id = ?').get(uid)?.vip_until || 0) > now();
  // VIP refills both the shared tank and the cars' own tanks twice as fast; the «Подвійне паливо» event doubles that
  // while it runs (S.regenAt switches the speed exactly at the event's start and end, at most ×EVENT_CAPS.fuelTotal).
  const REGEN_MS = S.FUEL_REGEN_MIN * 60e3;
  const vipMult = (vip) => (vip ? S.VIP.fuelMult : 1);
  function tankState(c) {
    if (c.tank >= S.CAR_TANK) return { tank: S.CAR_TANK, at: now(), next: null };
    const r = S.regenAt(c.tank_at, now(), REGEN_MS, S.CAR_TANK - c.tank, evOv, vipMult(vipOf(c.owner_id)));
    const tank = c.tank + r.n;
    return { tank, at: tank >= S.CAR_TANK ? now() : r.at, next: r.next };
  }
  function carOut(c) {
    if (!c) return null;
    const parts = carParts(c.id);
    const plate = carPlate(c.id);
    const st = S.carStats({ model: c.model, parts, plateValue: plate?.value || 0 });
    const t = tankState(c);
    return { id: c.id, model: c.model, status: c.status, parts, plate, look: lookOf(c), tank: t.tank, tankNext: t.next, sell: S.sellPriceOf(c.model, now() - c.created_at, c.origin), origin: c.origin || null, ...st,
      dirt: Math.floor(S.dirtNow(c.dirt, c.dirt_at, now())), shineUntil: c.shine_until > now() ? c.shine_until : 0 };
  }
  // Paint and livery as the client draws them (n = the race livery's number); null for a factory car. Unknown ids
  // (an old colour that was dropped) count as factory.
  function lookOf(c) {
    const paint = S.PAINT_BY_ID[c.paint] ? c.paint : null;
    const livery = S.LIVERY_BY_ID[c.livery] ? c.livery : null;
    return paint || livery ? { paint, livery, n: (c.id % 99) + 1 } : null;
  }
  const carValueOf = (c) => S.carValue({ model: c.model, parts: carParts(c.id), plateValue: carPlate(c.id)?.value || 0 });
  function ownCar(uid, id, statuses = ['garage']) {
    const c = carRow(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID авто'));
    if (!c || c.owner_id !== uid) fail('Це не твоє авто');
    if (statuses && !statuses.includes(c.status)) fail(c.status === 'showcase' ? 'Авто на вітрині' : 'Авто зараз на ринку або аукціоні');
    return c;
  }
  // Secret cars are trophies for finishing a collection: they can't be sold, listed, traded or burned in an upgrade.
  function noSecret(c) {
    if (S.MODELS[c.model]?.secret) fail('Секретну машину не можна продати, обміняти чи поставити в апгрейд — це нагорода за колекцію');
    return c;
  }
  // Collector cars (the UA gold rarities) sell for S.HOME_SELL_RATE only, so they can't be turned into money at the full
  // rate through an upgrade or a trade-in either.
  function noCollector(c) {
    if (S.isCollector(c.model)) fail('Колекційну машину не можна поставити в апгрейд чи трейд-ін');
    return c;
  }
  const garageCount = (uid) => q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status <> 'showcase'").get(uid).n;
  function needSlots(uid, n) {
    const u = q('SELECT slots FROM users WHERE id = ?').get(uid);
    const free = u.slots - garageCount(uid);
    // "Full" only when it really is: 4/6 and ×3 is "no room for ×3 — 2 free", not "garage full".
    if (free < n) fail(free > 0 ? `Не вистачає місця для ×${n} — вільно ${free}` : 'Гараж заповнений — продай авто або купи місце');
  }
  // origin: the case the car came out of (S.ORIGIN_SELL sets its instant-sale share), null for any other source.
  function giveCar(uid, model, origin = null) {
    // The one door every car comes in by: a car not in the game (a NEW_RAW car still without its photo) never gets in.
    if (!S.MODELS[model]) fail('Невідома модель');
    const isNew = !q('SELECT 1 FROM collection WHERE user_id = ? AND model = ?').get(uid, model);
    const r = q('INSERT INTO cars (owner_id, model, tank, tank_at, created_at, dirt_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid, model, S.CAR_TANK, now(), now(), now(), origin);
    if (isNew) {
      q('INSERT INTO collection (user_id, model, at) VALUES (?, ?, ?)').run(uid, model, now());
      xp(uid, 'newCar');
    }
    return { id: Number(r.lastInsertRowid), isNew, dream: dreamHit(uid, model) };
  }
  // An upgrade or trade-in result keeps the lowest instant-sale share of the cars put in, so a case car can't be turned
  // into a full-rate one that way.
  const worstOrigin = (cars) => cars.reduce((o, c) => (S.originSellOf(c.origin) < S.originSellOf(o) ? c.origin : o), null);
  function transferCar(carId, to) {
    q("UPDATE cars SET owner_id = ?, status = 'garage' WHERE id = ?").run(to, carId);
    q('UPDATE plates SET owner_id = ? WHERE car_id = ?').run(to, carId);
    q('DELETE FROM rivals WHERE car_id = ?').run(carId);
    // A car bought or traded from another player does not count in the collection: collections are found, not bought.
  }

  // Parts or plate of a car changed: open offers with it are no longer what the other side saw and agreed to.
  function carChanged(...ids) {
    const list = ids.filter(Boolean);
    if (!list.length) return;
    invalidateTrades(list);
    for (const r of q(`SELECT DISTINCT i.room_id id FROM trade_room_items i JOIN trade_rooms r ON r.id = i.room_id WHERE r.status IN ('open', 'active') AND i.car_id IN (${list.map(() => '?').join(',')})`).all(...list)) bump(r.id);
  }

  // ---------- income ----------
  // Only as many cars as the garage has slots earn income (the best earners), so a garage that went over its
  // limit (battle win, auction, reward) gives no extra income until the spare cars are sold.
  // The rate now, and (with `from`) what was earned from `from` until now: each car's dirt and shine (S.WASH) change its
  // income over time, so that part is the exact average of its multiplier over the stretch (S.washFactorAvg). Which
  // cars earn and the country bonus go by the clean income. The dirt penalty starts once the wash is open to the player.
  function incomeRate(uid, from = null) {
    const u = q('SELECT slots FROM users WHERE id = ?').get(uid);
    const rows = q("SELECT * FROM cars WHERE owner_id = ? AND status IN ('garage', 'market', 'auction') ORDER BY id").all(uid);
    const garage = rows.filter((c) => c.status === 'garage');
    const t = now(), cut = garage.length > 0 && isOpen(uid, 'wash');
    // S.garageIncome is the one count of who earns and how much (the client shows the same per car and in total).
    const g = S.garageIncome({
      cars: rows.map((c) => (c.status === 'garage'
        ? { id: c.id, model: c.model, status: c.status, parts: carParts(c.id), plateValue: carPlate(c.id)?.value || 0, dirt: c.dirt, dirtAt: c.dirt_at, shineUntil: c.shine_until }
        : { id: c.id, model: c.model, status: c.status })),
      slots: u?.slots ?? 1e9, claimed: garage.length ? claimedSets(uid) : [], t, cut,
    });
    let earned = 0;
    if (from != null && t > from) {
      for (const c of garage) {
        const e = g.cars[c.id];
        if (e.earning) earned += e.base * S.washFactorAvg(c.dirt, c.dirt_at, c.shine_until, from, t, cut) * ((t - from) / 3600e3);
      }
    }
    return { rate: g.rate, earned };
  }
  function incomeState(u) {
    const { rate, earned } = incomeRate(u.id, u.income_at);
    // VIP and the comeback gift both lengthen the cap; they don't add up. The comeback cap covers every stretch of
    // income that began before it ran out (it was banked when given, so the hours before it never count).
    const extra = Math.max((u.vip_until || 0) > now() ? S.VIP.extraHours : 0, u.income_at < (u.comeback_cap_until || 0) ? S.COMEBACK.capHours : 0);
    const capH = S.CAP_LEVELS[u.cap_level].hours + extra;
    const cap = rate * capH;
    // Income already banked is never lost, even if the cap shrinks after selling a car.
    const pending = Math.max(Math.min(u.banked + earned, cap), u.banked);
    return { rate, capH, pending: Math.floor(pending) };
  }
  // Freeze income earned so far before the set or value of cars changes.
  function bank(uid) {
    const u = q('SELECT id, banked, income_at, cap_level, vip_until, comeback_cap_until FROM users WHERE id = ?').get(uid);
    q('UPDATE users SET banked = ?, income_at = ? WHERE id = ?').run(incomeState(u).pending, now(), uid);
  }

  // ---------- xp, levels, tasks ----------
  function xp(uid, kind, mult = 1) {
    let amount = (S.XP[kind] || 0) * mult;
    if (!amount) return;
    const u = userRow(uid);
    if (S.CAPPED_XP.includes(kind)) {
      const today = dayOf(now());
      const used = u.xp_day === today ? u.xp_day_capped : 0;
      amount = Math.max(0, Math.min(amount, S.DAILY_XP_CAP - used));
      q('UPDATE users SET xp_day = ?, xp_day_capped = ? WHERE id = ?').run(today, used + amount, uid);
      if (!amount) return;
    }
    const season = S.seasonOf(now());
    q('UPDATE users SET season_xp = CASE WHEN season_id = ? THEN season_xp + ? ELSE ? END, season_id = ? WHERE id = ?').run(season, amount, amount, season, uid);
    let { level, xp: cur } = u;
    cur += amount;
    while (cur >= S.xpForLevel(level)) {
      cur -= S.xpForLevel(level);
      level++;
      const rw = S.levelReward(level);
      addMoney(uid, rw.money);
      if (rw.caseId) addKeys(uid, rw.caseId, 1);
      if (rw.slots) {
        bank(uid);
        q('UPDATE users SET slots = MIN(?, slots + ?) WHERE id = ?').run(S.MAX_SLOTS, rw.slots, uid);
      }
      if (level >= 3 && u.referrer_id && !u.ref_paid) {
        q('UPDATE users SET ref_paid = 1 WHERE id = ?').run(uid);
        addMoney(u.referrer_id, S.REF_REWARD);
        addMoney(uid, S.REF_FRIEND_L3);
        event(uid, `👥 3 рівень! Бонус за запрошення: +${S.fmt(S.REF_FRIEND_L3)}`);
        event(u.referrer_id, `👥 Твій друг ${name(uid)} досяг 3 рівня! +${S.fmt(S.REF_REWARD)}`);
      }
    }
    q('UPDATE users SET level = ?, xp = ? WHERE id = ?').run(level, cur, uid);
  }
  // ---------- progressive unlock (S.UNLOCKS) and the casino switch ----------
  // The owner's casino switch (admin 'casino-mode'), S.CASINO_DEFAULT until he sets it.
  const casinoMode = () => (Object.hasOwn(S.CASINO_MODES, metaGet('casino_mode') ?? '') ? metaGet('casino_mode') : S.CASINO_DEFAULT);
  // Owner and admins see everything; opts.allUnlocked opens everything for tests and sims of late features.
  const isStaff = (uid) => !!opts.allUnlocked || ['owner', 'admin'].includes(roleOf(uid));
  function openKeys(u) {
    return S.unlockedKeys({ level: u.level, feats: JSON.parse(u.feats || '[]'), staff: isStaff(u.id), casino: casinoMode() });
  }
  const isOpen = (uid, key) => openKeys(userRow(uid)).includes(key);
  function needFeature(uid, key) {
    if (key === 'casino' && casinoMode() === 'off') fail('Казино вимкнено');
    if (!isOpen(uid, key)) fail(`${S.UNLOCK_BY_KEY[key].name}: відкриється на рівні ${S.unlockLevel(key)}`);
  }
  // A deal or an invite needs the other player to have the feature open too.
  function needFeatureOf(other, key) {
    if (!isOpen(other, key)) fail(`У гравця ще не відкриті «${S.UNLOCK_BY_KEY[key].name}» (рівень ${S.unlockLevel(key)})`);
  }
  // API calls that start or make a locked action. Reads, cancels, cash-outs and finishing a started run stay open,
  // so nothing is ever stuck (a listing can be withdrawn, a running crash or mines game cashed out).
  const GATES = {
    'parts/open': 'parts', 'parts/merge': 'parts', 'parts/install': 'parts', 'parts/install-best': 'parts',
    'drift/rivals': 'drift', 'drift/start': 'drift',
    'plate/generate': 'plates', 'plate/attach': 'plates',
    'car/paint': 'paint', 'car/livery': 'paint',
    'wash/hand': 'wash', 'wash/auto': 'wash',
    'dealer/tradein': 'tradein',
    'market/sell': 'market', 'market/buy': 'market', 'market/item-sell': 'market', 'market/item-buy': 'market',
    'pvp/create': 'pvp', 'pvp/accept': 'pvp', 'pvp/request': 'pvp', 'pvp/answer': 'pvp',
    'trade/create': 'trades', 'trade/accept': 'trades', 'room/create': 'trades', 'room/join': 'trades', 'room/invite': 'trades', 'hall/chat': 'trades',
    'auction/create': 'auction', 'auction/bid': 'auction',
    'battle/create': 'battles', 'battle/join': 'battles',
    upgrade: 'upgrade',
    'casino/slots': 'casino', 'casino/roulette': 'casino', 'casino/crash/start': 'casino', 'casino/mines/start': 'casino',
  };
  const CASINO_GAME_OF = { 'casino/slots': 'slots', 'casino/roulette': 'roulette', 'casino/crash/start': 'crash', 'casino/mines/start': 'mines' };
  function gate(uid, name) {
    const key = GATES[name];
    if (!key) return;
    needFeature(uid, key);
    if (CASINO_GAME_OF[name] && !S.casinoGameOpen(casinoMode(), CASINO_GAME_OF[name])) fail('Ця гра зараз недоступна — відкрита лише рулетка');
  }
  // Guarantee counters before the per-case steps (S.pitySteps) were kept under "<case>" for the case's second class
  // (after 30 opens). Once per database: a step for that same class keeps the player's counter (the bar does not
  // jump); a step for another class starts from the player's own drops — the opens of this case since the last car of
  // that class or better (at most n − 1, so the next open brings it). Old rows are removed.
  function migratePity() {
    if (metaGet('pity_steps_1')) return;
    db.tx(() => {
      const save = q('INSERT INTO pity (user_id, case_id, count) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET count = excluded.count');
      for (const cs of S.CASES) {
        const oldFirst = S.CLASS_ORDER.filter((c) => cs.weights[c])[1];
        for (const s of S.pitySteps(cs)) {
          if (s.cls === oldFirst) {
            for (const r of q('SELECT user_id, count FROM pity WHERE case_id = ?').all(cs.id)) save.run(r.user_id, s.key, Math.min(r.count, s.n - 1));
            continue;
          }
          const better = S.CLASS_ORDER.filter((c) => S.rankOf(c) >= S.rankOf(s.cls));
          const rows = q(`WITH last AS (SELECT user_id, MAX(id) m FROM drops WHERE case_id = ? AND cls IN (${better.map(() => '?').join(',')}) GROUP BY user_id)
            SELECT d.user_id, COUNT(*) n FROM drops d LEFT JOIN last l ON l.user_id = d.user_id WHERE d.case_id = ? AND d.id > COALESCE(l.m, 0) GROUP BY d.user_id`).all(cs.id, ...better, cs.id);
          for (const r of rows) save.run(r.user_id, s.key, Math.min(r.n, s.n - 1));
        }
      }
      q("DELETE FROM pity WHERE case_id NOT LIKE '%:%' OR case_id LIKE '%:2'").run();
      metaSet('pity_steps_1', Date.now());
    });
  }
  // Newbie tasks before the ladder had another order (S.NEWBIE_ORDER_V1). Once per database: a player in the middle
  // keeps the step count of the tasks he finished that still come first in the new order; tasks he already claimed
  // further on are marked 'nb:<key>' and skipped (not paid twice).
  function migrateNewbieOrder() {
    if (metaGet('newbie_order_2')) return;
    db.tx(() => {
      const order = S.NEWBIE_TASKS.map((x) => x.key);
      for (const u of q('SELECT id, newbie_step, newbie_flags FROM users WHERE newbie_step > 0 AND newbie_step < ?').all(order.length)) {
        const done = new Set(S.NEWBIE_ORDER_V1.slice(0, u.newbie_step));
        let step = 0;
        while (step < order.length && done.has(order[step])) step++;
        const f = JSON.parse(u.newbie_flags);
        for (const k of order.slice(step)) if (done.has(k) && !f.includes('nb:' + k)) f.push('nb:' + k);
        q('UPDATE users SET newbie_step = ?, newbie_flags = ? WHERE id = ?').run(step, JSON.stringify(f), u.id);
      }
      metaSet('newbie_order_2', Date.now());
    });
  }
  function flag(uid, key) {
    const u = q('SELECT newbie_flags FROM users WHERE id = ?').get(uid);
    const f = JSON.parse(u.newbie_flags);
    if (!f.includes(key)) {
      f.push(key);
      q('UPDATE users SET newbie_flags = ? WHERE id = ?').run(JSON.stringify(f), uid);
    }
  }
  function newbieState(u) {
    const task = S.NEWBIE_TASKS[u.newbie_step];
    if (!task) return null;
    const flags = JSON.parse(u.newbie_flags);
    const ready = task.key === 'level3' ? u.level >= 3 : flags.includes(task.key);
    // A task whose feature is still locked says when it opens (the app shows a lock instead of a "go" button).
    const lockedTill = task.feature && !ready && !openKeys(u).includes(task.feature) ? S.unlockLevel(task.feature) : 0;
    return { step: u.newbie_step, total: S.NEWBIE_TASKS.length, ...task, ready, lockedTill };
  }
  function ensureQuests(uid) {
    const day = dayOf(now());
    if (q('SELECT COUNT(*) n FROM quests WHERE user_id = ? AND day = ?').get(uid, day).n) return day;
    const h = sha256(`${uid}:${day}`);
    const open = openKeys(userRow(uid));
    const keys = Object.keys(S.QUESTS).filter((k) => !S.QUESTS[k].feature || open.includes(S.QUESTS[k].feature));
    const picked = [];
    for (let i = 0; picked.length < 3 && i < 30; i++) {
      const k = keys[parseInt(h.slice(i * 2, i * 2 + 2), 16) % keys.length];
      if (!picked.includes(k)) picked.push(k);
    }
    const lvl = q('SELECT level FROM users WHERE id = ?').get(uid).level;
    picked.forEach((k, j) => {
      const [lo, hi] = S.QUESTS[k].range;
      const target = lo + (parseInt(h.slice(40 + j * 2, 42 + j * 2), 16) % (hi - lo + 1));
      q('INSERT OR IGNORE INTO quests (user_id, day, key, target, reward) VALUES (?, ?, ?, ?, ?)').run(uid, day, k, target, Math.round((8000 + 4000 * target) * Math.pow(lvl, 1.3) / 100) * 100);
    });
    return day;
  }
  function track(uid, key, n = 1) {
    const day = ensureQuests(uid);
    q('UPDATE quests SET progress = MIN(target, progress + ?) WHERE user_id = ? AND day = ? AND key = ?').run(n, uid, day, key);
    if (S.WEEKLY_QUESTS[key]) {
      const week = ensureWeekly(uid);
      q('UPDATE weekly_quests SET progress = MIN(target, progress + ?) WHERE user_id = ? AND week = ? AND key = ?').run(n, uid, week, key);
    }
  }
  // Four weekly tasks, picked from sha256(uid:week) like the daily ones; made on first use in the week.
  function ensureWeekly(uid) {
    const week = weekOf(now());
    if (q('SELECT COUNT(*) n FROM weekly_quests WHERE user_id = ? AND week = ?').get(uid, week).n) return week;
    const h = sha256(`${uid}:w:${week}`);
    const open = openKeys(userRow(uid));
    const keys = Object.keys(S.WEEKLY_QUESTS).filter((k) => !S.WEEKLY_QUESTS[k].feature || open.includes(S.WEEKLY_QUESTS[k].feature));
    const picked = [];
    for (let i = 0; picked.length < S.WEEKLY_COUNT && i < 30; i++) {
      const k = keys[parseInt(h.slice(i * 2, i * 2 + 2), 16) % keys.length];
      if (!picked.includes(k)) picked.push(k);
    }
    for (const k of keys) if (picked.length < S.WEEKLY_COUNT && !picked.includes(k)) picked.push(k);
    picked.forEach((k, j) => {
      const [lo, hi] = S.WEEKLY_QUESTS[k].range;
      const target = lo + (parseInt(h.slice(40 + j * 2, 42 + j * 2), 16) % (hi - lo + 1));
      q('INSERT OR IGNORE INTO weekly_quests (user_id, week, key, target) VALUES (?, ?, ?, ?)').run(uid, week, k, target);
    });
    return week;
  }

  // ---------- weekly race & totals ----------
  function totalValue(uid) {
    let v = 0;
    for (const c of q('SELECT * FROM cars WHERE owner_id = ?').all(uid)) v += carValueOf(c);
    v += q('SELECT COALESCE(SUM(value), 0) v FROM plates WHERE owner_id = ? AND car_id IS NULL').get(uid).v;
    return v;
  }
  function recalc(uid) {
    q('UPDATE users SET total_value = ? WHERE id = ?').run(totalValue(uid), uid);
  }
  function settleWeek() {
    const cur = weekOf(now());
    const prevDate = new Date(cur + 'T00:00:00Z');
    prevDate.setUTCDate(prevDate.getUTCDate() - 7);
    const prev = prevDate.toISOString().slice(0, 10);
    if (q('SELECT 1 FROM weeks WHERE week_id = ?').get(prev)) return;
    q('INSERT INTO weeks (week_id, settled_at) VALUES (?, ?)').run(prev, now());
    const rows = q(`SELECT id, CASE WHEN week_id = ? THEN total_value - week_start_value WHEN last_week_id = ? THEN last_week_growth END g
                    FROM users WHERE week_id = ? OR last_week_id = ? ORDER BY g DESC, id LIMIT 10`).all(prev, prev, prev, prev);
    rows.filter((r) => r.g > 0).forEach((r, i) => {
      addMoney(r.id, S.WEEKLY_PRIZES[i]);
      event(r.id, `🏆 Гонка тижня: ${i + 1} місце! +${S.fmt(S.WEEKLY_PRIZES[i])}`);
    });
  }
  function rollWeek(uid) {
    const u = q('SELECT week_id, total_value, week_start_value FROM users WHERE id = ?').get(uid);
    const cur = weekOf(now());
    if (u.week_id === cur) return;
    q('UPDATE users SET last_week_id = ?, last_week_growth = ?, week_id = ?, week_start_value = ? WHERE id = ?')
      .run(u.week_id, u.week_id ? u.total_value - u.week_start_value : null, cur, totalValue(uid), uid);
  }

  // ---------- users ----------
  function ensureUser(tg, startParam) {
    return db.tx(() => {
      const uid = int(tg.id, 1, Number.MAX_SAFE_INTEGER, 'ID');
      const uname = typeof tg.username === 'string' && tg.username ? tg.username.slice(0, 64) : null;
      const first = typeof tg.first_name === 'string' ? tg.first_name.slice(0, 64) : null;
      if (uname) q('UPDATE users SET username = NULL WHERE lower(username) = lower(?) AND id <> ?').run(uname, uid);
      if (q('SELECT id FROM users WHERE id = ?').get(uid)) {
        checkComeback(uid); // before last_seen moves: it measures how long the player was away
        q('UPDATE users SET username = ?, first_name = COALESCE(?, first_name), last_seen = ? WHERE id = ?').run(uname, first, now(), uid);
        legacyWelcome(uid);
        return { created: false };
      }
      const t = now();
      q(`INSERT INTO users (id, username, first_name, balance, slots, showcase_slots, income_at, fuel, fuel_at, server_seed, client_seed, created_at, last_seen, week_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid, uname, first, S.START_BALANCE, S.START_SLOTS, S.SHOWCASE_START, t, S.FUEL_MAX, t, newSeed(), crypto.randomBytes(8).toString('hex'), t, t, weekOf(t));
      addKeys(uid, 'starter', 1);
      moneyFlow(S.START_BALANCE);
      if (legacyWelcome(uid)) return { created: true };
      const m = /^ref_(\d{1,20})$/.exec(startParam || '');
      const ref = m ? Number(m[1]) : null;
      if (ref && ref !== uid && q('SELECT id FROM users WHERE id = ?').get(ref)) {
        q('UPDATE users SET referrer_id = ? WHERE id = ?').run(ref, uid);
        addMoney(uid, S.REF_FRIEND_BONUS);
        addKeys(uid, S.REF_FRIEND_KEY, 1);
        gift(uid, 'ref', { from: name(ref), money: S.REF_FRIEND_BONUS, caseId: S.REF_FRIEND_KEY, l3: S.REF_FRIEND_L3 });
        event(ref, `👥 ${name(uid)} приєднався за твоїм посиланням. Коли він досягне 3 рівня — отримаєш ${S.fmt(S.REF_REWARD)}`);
        return { created: true, ref: true };
      }
      return { created: true };
    });
  }

  // ---------- players of the first version (src/legacy.json, imported once) ----------
  // Their inviter is restored (without paying the referral reward again) and donors see a thank-you window once.
  // Returns true when the player came from the first version (their old inviter wins over a new ref link).
  function legacyWelcome(uid) {
    const l = q('SELECT referrer_id, stars, thanked FROM legacy WHERE id = ?').get(uid);
    if (!l) return false;
    if (l.referrer_id && l.referrer_id !== uid && q('SELECT id FROM users WHERE id = ?').get(l.referrer_id)) {
      q('UPDATE users SET referrer_id = ?, ref_paid = 1 WHERE id = ? AND referrer_id IS NULL').run(l.referrer_id, uid);
    }
    if (l.stars > 0 && !l.thanked) {
      q('UPDATE legacy SET thanked = 1 WHERE id = ?').run(uid);
      gift(uid, 'thanks', { stars: l.stars }, 'Дякуємо, що підтримав АВТОДРОП ще з перших днів! Твій донат допоміг грі вирости — ти з нами від самого початку 💛');
    }
    return true;
  }
  function importLegacy() {
    if (metaGet('legacy_import_1')) return;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(new URL('./legacy.json', import.meta.url), 'utf8'));
    } catch {
      return;
    }
    db.tx(() => {
      const stars = {};
      for (const p of data.payments || []) {
        stars[p.userId] = (stars[p.userId] || 0) + p.stars;
        q('INSERT OR IGNORE INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run('legacy:' + p.chargeId, p.userId, p.pack, p.stars, p.amount, p.createdAt);
      }
      for (const p of data.players || []) {
        q('INSERT OR IGNORE INTO legacy (id, referrer_id, stars) VALUES (?, ?, ?)').run(p.id, p.referrerId || null, stars[p.id] || 0);
      }
      // Players already on the server get their inviter now; everyone else when they next open the game.
      for (const p of data.players || []) if (p.referrerId && q('SELECT id FROM users WHERE id = ?').get(p.id)) {
        q('UPDATE users SET referrer_id = ?, ref_paid = 1 WHERE id = ? AND referrer_id IS NULL AND ? IN (SELECT id FROM users)').run(p.referrerId, p.id, p.referrerId);
      }
      metaSet('legacy_import_1', Date.now());
    });
  }

  function fuelState(u) {
    if (u.fuel >= S.FUEL_MAX) return { fuel: S.FUEL_MAX, at: now(), next: null, fullAt: u.fuel_at };
    const r = S.regenAt(u.fuel_at, now(), REGEN_MS, S.FUEL_MAX - u.fuel, evOv, vipMult((u.vip_until || 0) > now()));
    const fuel = u.fuel + r.n;
    return { fuel, at: fuel >= S.FUEL_MAX ? now() : r.at, next: r.next, fullAt: fuel >= S.FUEL_MAX ? r.at : null };
  }
  function inventory(uid) {
    const cool = {};
    for (const r of q('SELECT type, tier, COUNT(*) n, MIN(until) until FROM parts_cool WHERE user_id = ? AND until > ? GROUP BY type, tier').all(uid, now())) cool[r.type + ':' + r.tier] = r;
    return q('SELECT type, tier, count FROM parts WHERE user_id = ? AND count > 0').all(uid).map((p) => {
      const c = cool[p.type + ':' + p.tier];
      return { ...p, cooling: c ? Math.min(c.n, p.count) : 0, coolUntil: c?.until || null, available: p.count - (c ? Math.min(c.n, p.count) : 0) };
    });
  }
  function availableParts(uid, type, tier) {
    return inventory(uid).find((p) => p.type === type && p.tier === tier)?.available || 0;
  }
  function takePart(uid, type, tier, n = 1) {
    if (availableParts(uid, type, tier) < n) fail('Немає вільної деталі (можливо, вона ще остигає)');
    q('UPDATE parts SET count = count - ? WHERE user_id = ? AND type = ? AND tier = ?').run(n, uid, type, tier);
  }

  function me(uid) {
    const u = userRow(uid);
    const inc = incomeState(u);
    const fuel = fuelState(u);
    const cars = q('SELECT * FROM cars WHERE owner_id = ? ORDER BY id').all(uid).map(carOut);
    const keys = Object.fromEntries(q('SELECT case_id, count FROM keys WHERE user_id = ? AND count > 0').all(uid).map((r) => [r.case_id, r.count]));
    const collection = q('SELECT model FROM collection WHERE user_id = ?').all(uid).map((r) => r.model);
    const pity = Object.fromEntries(q('SELECT case_id, count FROM pity WHERE user_id = ?').all(uid).map((r) => [r.case_id, r.count]));
    const fragments = Object.fromEntries(q('SELECT case_id, count FROM fragments WHERE user_id = ? AND count > 0').all(uid).map((r) => [r.case_id, r.count]));
    const plates = q('SELECT id, text, cls, value, car_id carId FROM plates WHERE owner_id = ? ORDER BY value DESC').all(uid);
    const day = dayOf(now());
    const claims = q('SELECT key FROM claims WHERE user_id = ?').all(uid).map((r) => r.key);
    // First minutes: the "how to play" stories for a player who has never opened a case, then the guided first steps.
    const intro = !claims.includes('intro') && u.cases_opened === 0;
    const guide = S.guideStep({
      introSeen: claims.includes('intro'), off: claims.includes('guide-off'), keys, opened: u.cases_opened, level: u.level,
      garage: cars.filter((c) => c.status === 'garage').length, flags: JSON.parse(u.newbie_flags),
      races: u.races, streak: u.streak, dailyReady: u.streak_day !== day,
    });
    return {
      id: u.id, username: u.username, firstName: u.first_name, balance: u.balance, intro, guide,
      slots: u.slots, used: cars.filter((c) => c.status !== 'showcase').length, showcaseSlots: u.showcase_slots, capLevel: u.cap_level, fragments,
      income: { rate: Math.round(inc.rate), pending: inc.pending, capH: inc.capH, since: u.income_at, banked: u.banked, comebackUntil: u.comeback_cap_until > now() ? u.comeback_cap_until : 0 },
      fuel: fuel.fuel, fuelNext: fuel.next, cars, keys, collection, pity, plates, parts: inventory(uid),
      level: u.level, levelSeen: u.level_seen, xp: u.xp, xpNeed: S.xpForLevel(u.level),
      xpToday: u.xp_day === day ? u.xp_day_capped : 0, newbie: newbieState(u),
      dailyReady: u.streak_day !== day, streak: u.streak, rewardCaseAt: u.reward_case_at + S.REWARD_CASE_HOURS * 3600e3,
      claims,
      caseOfDay: evFx().noCaseOfDay ? null : S.caseOfDay(day), gameEvents: gameEvents(),
      fair: { seedHash: sha256(u.server_seed), clientSeed: u.client_seed, nonce: u.nonce },
      stats: { cases: u.cases_opened, races: u.races, wins: u.wins, merges: u.merges, value: u.total_value, playMs: u.play_ms },
      unread: q('SELECT COUNT(*) n FROM events WHERE user_id = ? AND seen = 0').get(uid).n,
      incomingTrades: q("SELECT COUNT(*) n FROM trades WHERE to_id = ? AND status = 'open'").get(uid).n
        + q("SELECT COUNT(*) n FROM trade_rooms WHERE invited_id = ? AND status = 'open' AND host_seen > ?").get(uid, now() - 45e3).n,
      noInvites: !!u.no_invites, pushOn: !u.push_off, pushBlocked: !!u.push_blocked,
      luck: luckOf(u.id), rescueAt: rescueNext(u),
      stars: u.stars, vipUntil: u.vip_until, vip: u.vip_until > now(), starterBought: !!u.starter_bought,
      season: (({ claimed, ...s }) => s)(seasonInfo(u)), badges: badgesOf(uid),
      legacy: isLegacy(uid), // played the first version: «Гравець з перших днів» badge in the profile
      unlocked: openKeys(u), casino: casinoMode(), // S.UNLOCKS keys open to this player; the owner's casino switch
      dream: dreamOut(u),
      wash: { handLeft: handLeft(u), hand: S.WASH.hand }, // free hand washes left today (S.WASH)
      now: now(),
    };
  }

  // ---------- garage ----------
  function collect(uid) {
    const { pending } = incomeState(userRow(uid));
    if (pending < 1) fail('Поки нічого забирати');
    addMoney(uid, pending);
    q('UPDATE users SET banked = 0, income_at = ? WHERE id = ?').run(now(), uid);
    track(uid, 'collect');
    flag(uid, 'collect');
    return { got: pending };
  }
  function buySlot(uid) {
    const u = userRow(uid);
    if (u.slots >= S.MAX_SLOTS) fail('Максимум місць');
    pay(uid, S.slotCost(u.slots));
    q('UPDATE users SET slots = slots + 1 WHERE id = ?').run(uid);
    return {};
  }
  function upgradeCap(uid) {
    const u = userRow(uid);
    const next = S.CAP_LEVELS[u.cap_level + 1];
    if (!next) fail('Максимальний рівень сховища');
    bank(uid);
    pay(uid, next.cost);
    q('UPDATE users SET cap_level = cap_level + 1 WHERE id = ?').run(uid);
    return {};
  }
  // Selling returns installed parts to the warehouse and the plate to the player.
  function stripCar(uid, carId) {
    for (const p of q('SELECT type, tier FROM car_parts WHERE car_id = ?').all(carId)) addPart(uid, p.type, p.tier);
    q('DELETE FROM car_parts WHERE car_id = ?').run(carId);
    q('UPDATE plates SET car_id = NULL WHERE car_id = ?').run(carId);
  }
  function sell(uid, { carIds }) {
    const ids = idList(carIds, S.MAX_SLOTS + S.SHOWCASE_MAX);
    if (!ids.length) fail('Обери авто');
    const total = q('SELECT COUNT(*) n FROM cars WHERE owner_id = ?').get(uid).n;
    if (ids.length >= total) fail('Останню машину продати не можна — на ній можна ганяти й заробляти');
    bank(uid);
    let got = 0;
    for (const id of ids) {
      const c = noSecret(ownCar(uid, id, ['garage', 'showcase']));
      got += S.sellPriceOf(c.model, now() - c.created_at, c.origin);
      stripCar(uid, c.id);
      q('DELETE FROM cars WHERE id = ?').run(c.id);
      q('DELETE FROM rivals WHERE car_id = ?').run(c.id);
    }
    addMoney(uid, got);
    invalidateTrades(ids);
    return { got };
  }
  function showcase(uid, { carId, put }) {
    const c = ownCar(uid, carId, put ? ['garage'] : ['showcase']);
    const u = userRow(uid);
    bank(uid);
    if (put) {
      if (q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status = 'showcase'").get(uid).n >= u.showcase_slots) fail('Вітрина заповнена');
      if (q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status = 'garage'").get(uid).n <= 1) fail('Останню машину не можна прибрати з гаража — на ній можна ганяти й заробляти');
      q("UPDATE cars SET status = 'showcase' WHERE id = ?").run(c.id);
      invalidateTrades([c.id]);
    } else {
      needSlots(uid, 1);
      q("UPDATE cars SET status = 'garage' WHERE id = ?").run(c.id);
    }
    return {};
  }
  function buyShowcaseSlot(uid) {
    const u = userRow(uid);
    if (u.showcase_slots >= S.SHOWCASE_MAX) fail('Максимум місць на вітрині');
    pay(uid, S.showcaseCost(u.showcase_slots));
    q('UPDATE users SET showcase_slots = showcase_slots + 1 WHERE id = ?').run(uid);
    return {};
  }

  // ---------- car cases ----------
  function nextNonce(uid) {
    const u = q('SELECT server_seed, client_seed, nonce FROM users WHERE id = ?').get(uid);
    const nonce = u.nonce + 1;
    q('UPDATE users SET nonce = ? WHERE id = ?').run(nonce, uid);
    return { ...u, nonce, roll: (sub) => fairRoll(u.server_seed, u.client_seed, nonce, sub) };
  }
  // keyOnly (a reward key opened from the rewards reveal): never pays — no key left → an error, not a paid opening.
  function openCase(uid, { caseId, count, keyOnly }) {
    const cs = S.CASE_BY_ID[caseId];
    if (!cs) fail('Невідомий кейс');
    const n = int(count ?? 1, 1, 6, 'Кількість');
    if (![1, 3, 6].includes(n)) fail('Можна відкрити 1, 3 або 6');
    needSlots(uid, n);
    const k = q('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, caseId)?.count || 0;
    if (cs.starter && k < n) fail('Стартовий кейс уже відкрито');
    if (keyOnly && k < n) fail(`Ключа «${cs.name}» вже немає`);
    const useKeys = Math.min(k, n);
    // Price, odds, hidden boost and fragments as they are right now (case of the day, game events — S.caseDeal).
    const deal = S.caseDeal(cs, dayOf(now()), evFx());
    const ecs = deal.weights === cs.weights ? cs : { ...cs, weights: deal.weights };
    const price = deal.price;
    pay(uid, price * (n - useKeys));
    if (useKeys) q('UPDATE keys SET count = count - ? WHERE user_id = ? AND case_id = ?').run(useKeys, uid, caseId);
    bank(uid);
    const results = [];
    let fragments = 0, newKeys = 0;
    for (let i = 0; i < n; i++) {
      const paid = i >= useKeys; // keys are used first; only paid opens leave fragments
      const streak = cs.starter ? 0 : q('SELECT bad_streak FROM users WHERE id = ?').get(uid).bad_streak;
      // Hidden boost and luck combine: the class is thrown twice with chance 1 − (1 − boost)(1 − luck).
      const luck = cs.starter ? 0 : 1 - (1 - deal.boost) * (1 - luckOf(uid));
      // After a losing streak the roll aims for a car worth at least the case (see S.LUCK.streak / hardStreak).
      const save = deal.save && streak >= S.LUCK.streak ? { need: cs.price, force: streak >= S.LUCK.hardStreak } : null;
      let { model, forced, lucky } = rollCase(uid, ecs, luck, save);
      if (!cs.starter) q('UPDATE users SET luck_bonus_left = MAX(0, luck_bonus_left - 1) WHERE id = ?').run(uid);
      // An admin-set car replaces this roll (the drop record keeps forced = 3 so it can be told apart).
      const rig = cs.starter ? null : riggedFor(uid, cs);
      if (rig) {
        q('UPDATE rigged_drops SET used_at = ? WHERE id = ?').run(now(), rig.id);
        q('UPDATE drops SET item = ?, cls = ?, forced = 3 WHERE id = (SELECT MAX(id) FROM drops WHERE user_id = ?)').run(rig.model, S.MODELS[rig.model].cls, uid);
        model = rig.model;
        lucky = 1;
      }
      const { id, isNew, dream } = giveCar(uid, model, cs.starter ? null : cs.id);
      // luck_spent holds the fading sum of what these cases should give on average (their expected value).
      if (!cs.starter) {
        q('UPDATE users SET luck_spent = luck_spent * ? + ?, luck_got = luck_got * ? + ? WHERE id = ?').run(S.LUCK.decay, cs.ev, S.LUCK.decay, S.MODELS[model].price, uid);
        q('UPDATE users SET bad_streak = ? WHERE id = ?').run(S.MODELS[model].price >= cs.price ? 0 : streak + 1, uid);
      }
      // A drop worth less than the case leaves a key fragment; a full set turns into a free key of this case.
      let fragment = false;
      if (paid && !cs.starter && deal.fragments && S.MODELS[model].price < price) {
        fragment = true;
        fragments++;
        const fr = q('INSERT INTO fragments (user_id, case_id, count) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count').get(uid, cs.id).count;
        if (fr >= S.FRAGMENTS_PER_KEY) {
          q('UPDATE fragments SET count = count - ? WHERE user_id = ? AND case_id = ?').run(S.FRAGMENTS_PER_KEY, uid, cs.id);
          addKeys(uid, cs.id, 1);
          newKeys++;
        }
      }
      results.push({ car: carOut(carRow(id)), isNew, forced: !!forced, lucky: !!lucky, fragment, ...(dream ? { dream: true } : {}) });
    }
    countOpens(uid, n);
    if (cs.group === 'country') track(uid, 'country', n);
    const fragmentsNow = q('SELECT count FROM fragments WHERE user_id = ? AND case_id = ?').get(uid, cs.id)?.count || 0;
    flag(uid, cs.starter ? 'open_starter' : 'open_case');
    return { results, fragments, newKeys, fragmentsNow, price, event: deal.why === 'luck' || deal.why === 'country' ? deal.why : null,
      keysNow: q('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, cs.id)?.count || 0 };
  }
  // One provably fair case roll with the pity guarantee; recorded in drops so it can be verified later.
  // A truly broke player (money + garage) gets the most luck; otherwise it comes from recent case results.
  function luckOf(uid) {
    const u = q('SELECT balance, total_value, luck_spent, luck_got, luck_bonus, luck_bonus_left, cases_opened FROM users WHERE id = ?').get(uid);
    let own = S.luckChance(u.luck_spent, u.luck_got, S.isBroke(u.balance, u.total_value));
    if (u.cases_opened < S.LUCK.newbieOpens) own = Math.max(own, S.LUCK.newbie); // a newcomer's first opens
    return u.luck_bonus_left > 0 ? Math.max(own, u.luck_bonus) : own;
  }
  // Admin-set car for this case, if one is waiting and this case can drop it.
  function riggedFor(uid, cs) {
    return q('SELECT * FROM rigged_drops WHERE user_id = ? AND used_at IS NULL ORDER BY id').all(uid)
      .find((r) => cs.weights[S.MODELS[r.model]?.cls] && cs.pool(S.MODELS[r.model].cls).some((m) => m.id === r.model));
  }
  function rollCase(uid, cs, luck = 0, save = null) {
    const classes = classEntries(cs.weights);
    const f = nextNonce(uid);
    let cls = pickWeighted(classes, f.roll(0));
    let forced = 0, lucky = 0;
    // Luck: throw the class a second time and keep the better one.
    if (luck > 0 && f.roll(2) < luck) {
      const again = pickWeighted(classes, f.roll(3));
      if (S.rankOf(again) > S.rankOf(cls)) {
        cls = again;
        lucky = 1;
      }
    }
    // Guarantee (S.pitySteps): the highest step that is due lifts the roll to its class; every step's counter then
    // resets on a car of its class or better, or goes up by one.
    const steps = S.pitySteps(cs);
    const counts = steps.map((s) => q('SELECT count FROM pity WHERE user_id = ? AND case_id = ?').get(uid, s.key)?.count || 0);
    // A { missing } step: the cars of its class this case drops that the player has never had.
    const miss = steps.map((s) => (s.missing ? cs.pool(s.cls).filter((m) => !q('SELECT 1 FROM collection WHERE user_id = ? AND model = ?').get(uid, m.id)) : []));
    let due = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (S.rankOf(cls) < S.rankOf(steps[i].cls) && counts[i] + 1 >= steps[i].n) {
        cls = steps[i].cls;
        forced = steps[i].missing && miss[i].length ? 4 : 1; // 4: a car missing from the collection (verify knows)
        due = i;
        break;
      }
    }
    const savePity = q('INSERT INTO pity (user_id, case_id, count) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET count = excluded.count');
    steps.forEach((s, i) => s.missing || savePity.run(uid, s.key, S.rankOf(cls) >= S.rankOf(s.cls) ? 0 : counts[i] + 1));
    let model = pickModel(forced === 4 ? miss[due] : cs.pool(cls), f.roll(1));
    // Losing-streak protection: throw again (up to LUCK.tries) for a car worth the case; when forced, give the
    // cheapest car of this case that is.
    if (save && S.MODELS[model].price < save.need) {
      for (let i = 0; i < S.LUCK.tries && S.MODELS[model].price < save.need; i++) {
        const c2 = pickWeighted(classes, f.roll(10 + i * 2));
        const m2 = pickModel(cs.pool(c2), f.roll(11 + i * 2));
        if (S.MODELS[m2].price > S.MODELS[model].price) {
          model = m2;
          cls = c2;
          lucky = 1;
        }
      }
      if (save.force && S.MODELS[model].price < save.need) {
        const win = classes.flatMap(([c]) => cs.pool(c)).filter((m) => m.price >= save.need).sort((a, b) => a.price - b.price)[0];
        if (win) {
          model = win.id;
          cls = win.cls;
          lucky = 1;
        }
      }
    }
    // A { missing } step looks at the final drop (a streak-save re-roll counts too); while cars of its class are missing
    // only a new one resets it.
    steps.forEach((s, i) => s.missing && savePity.run(uid, s.key,
      S.rankOf(cls) >= S.rankOf(s.cls) && (!miss[i].length || miss[i].some((m) => m.id === model)) ? 0 : counts[i] + 1));
    q('INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, forced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid, cs.id, model, cls, sha256(f.server_seed), f.client_seed, f.nonce, forced || (lucky ? 2 : 0), now());
    return { model, cls, forced, lucky };
  }
  // Not enough money for any case: a free rusty-garage case, so the game can go on — every LUCK.rescueHours when truly
  // broke, every LUCK.softHours when only a few cheap cars are left (null: no rescue for this player now).
  const rescueHours = (u) => (u.balance >= S.CASE_BY_ID.rust.price ? null : S.isBroke(u.balance, u.total_value) ? S.LUCK.rescueHours
    : u.balance + u.total_value < S.LUCK.softBelow ? S.LUCK.softHours : null);
  const rescueNext = (u) => { const h = rescueHours(u); return h == null ? null : u.rescue_at + h * 3600e3; };
  const rescueReady = (u) => { const t = rescueNext(u); return t != null && t <= now(); };
  function rescueClaim(uid) {
    if (!rescueReady(userRow(uid))) fail('Допомога зараз недоступна');
    addKeys(uid, 'rust', 1);
    q('UPDATE users SET rescue_at = ? WHERE id = ?').run(now(), uid);
    return { caseId: 'rust' };
  }
  function countOpens(uid, n) {
    q('UPDATE users SET cases_opened = cases_opened + ? WHERE id = ?').run(n, uid);
    xp(uid, 'case', n);
    track(uid, 'open', n);
  }
  function dropHistory(uid) {
    return q('SELECT case_id caseId, item, cls, seed_hash seedHash, client_seed clientSeed, nonce, forced, created_at at FROM drops WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(uid);
  }
  function setClientSeed(uid, { clientSeed }) {
    if (typeof clientSeed !== 'string' || !/^[\w-]{1,32}$/.test(clientSeed)) fail('Сід: 1–32 символи (літери, цифри, _ -)');
    q('UPDATE users SET client_seed = ? WHERE id = ?').run(clientSeed, uid);
    return {};
  }
  function rotateSeed(uid) {
    const u = userRow(uid);
    q('INSERT INTO revealed_seeds (user_id, seed, seed_hash, revealed_at) VALUES (?, ?, ?, ?)').run(uid, u.server_seed, sha256(u.server_seed), now());
    q('UPDATE users SET server_seed = ?, nonce = 0 WHERE id = ?').run(newSeed(), uid);
    return { revealed: u.server_seed, hash: sha256(u.server_seed) };
  }
  const revealedSeeds = (uid) => q('SELECT seed, seed_hash seedHash, revealed_at at FROM revealed_seeds WHERE user_id = ? ORDER BY revealed_at DESC LIMIT 20').all(uid);

  // ---------- parts ----------
  // Last part-case opening per player (in memory: a restart only forgives one pause).
  const partOpenedAt = new Map();
  const partCooldown = opts.partCooldownMs ?? S.PART_COOLDOWN_MS;
  function openParts(uid, { caseId, type, count }) {
    const pc = S.PART_CASE_BY_ID[caseId];
    if (!pc) fail('Невідомий кейс');
    if (type != null && !S.PART_KEYS.includes(type)) fail('Невідома деталь');
    if (type && pc.randomOnly) fail('У цьому кейсі лише випадкові деталі');
    const n = int(count ?? 1, 1, 10, 'Кількість');
    if (![1, 3, 5, 10].includes(n)) fail('Можна відкрити 1, 3, 5 або 10');
    // The pause is for ×1 only (its reel plays meanwhile); ×3/×5/×10 open at once and show one combined reveal.
    const wait = n === 1 ? (partOpenedAt.get(uid) || 0) + partCooldown - now() : 0;
    if (wait > 0) fail(`Зачекай ${Math.ceil(wait / 1000)} с перед наступним відкриттям`);
    const price = Math.round(pc.price * (type ? 1 + S.PICK_PART_EXTRA : 1) / 100) * 100;
    pay(uid, price * n);
    const tiers = Object.entries(pc.weights);
    const pool = partPool(uid);
    const results = [];
    for (let i = 0; i < n; i++) {
      const f = nextNonce(uid);
      const tier = pickWeighted(tiers, f.roll(0));
      // A random part is one the player's cars can take (no battery for a petrol-only garage — S.partPoolFor).
      const t = type || pool[Math.floor(f.roll(1) * pool.length)];
      addPart(uid, t, tier);
      q('INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uid, caseId, `${t}:${tier}`, S.TIER_BY_ID[tier].cls, sha256(f.server_seed), f.client_seed, f.nonce, now());
      results.push({ type: t, tier });
    }
    xp(uid, 'case', n);
    track(uid, 'parts', n);
    flag(uid, 'part_case');
    if (n === 1) partOpenedAt.set(uid, now());
    // nextAt: when the next ×1 may open (a multi-open doesn't move it).
    return { results, price: price * n, nextAt: Math.max(now(), (partOpenedAt.get(uid) || 0) + partCooldown) };
  }
  function merge(uid, { type, tier }) {
    if (!S.PART_KEYS.includes(type) || !S.TIER_BY_ID[tier]) fail('Невідома деталь');
    const idx = S.TIER_BY_ID[tier].index;
    if (idx >= S.TIERS.length - 1) fail('Це вже найвищий рівень');
    takePart(uid, type, tier, 3);
    const chance = S.MERGE_CHANCE[idx];
    const ok = rnd() < chance;
    const next = S.TIERS[idx + 1].id;
    if (ok) addPart(uid, type, next);
    q('UPDATE users SET merges = merges + 1 WHERE id = ?').run(uid);
    xp(uid, 'merge');
    track(uid, 'merge');
    flag(uid, 'merge');
    return { ok, chance, result: ok ? { type, tier: next } : null };
  }
  function sellParts(uid, { type, tier, count }) {
    if (!S.PART_KEYS.includes(type) || !S.TIER_BY_ID[tier]) fail('Невідома деталь');
    const n = int(count ?? 1, 1, 10000, 'Кількість');
    takePart(uid, type, tier, n);
    const got = Math.floor(S.TIER_BY_ID[tier].price * S.PART_SELL_RATE) * n;
    addMoney(uid, got);
    return { got };
  }
  function install(uid, { carId, type, tier }) {
    if (!S.PART_KEYS.includes(type) || !S.TIER_BY_ID[tier]) fail('Невідома деталь');
    const c = ownCar(uid, carId, ['garage', 'showcase']);
    if (!S.partFits(c.model, type)) fail(S.MODELS[c.model].ev ? 'На електромобіль ставлять електромотор, батарею й редуктор замість двигуна, турбіни, вихлопу й КПП' : 'Ця деталь — для електромобілів');
    const minTier = S.minTierFor(S.MODELS[c.model].cls);
    if (S.TIER_BY_ID[tier].index < minTier) fail(`Для цієї машини потрібні деталі від ${S.TIERS[minTier].name}`);
    takePart(uid, type, tier);
    bank(uid);
    const old = q('SELECT tier FROM car_parts WHERE car_id = ? AND type = ?').get(c.id, type);
    if (old) coolPart(uid, type, old.tier);
    q('INSERT INTO car_parts (car_id, type, tier) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET tier = excluded.tier').run(c.id, type, tier);
    carChanged(c.id);
    xp(uid, 'install');
    flag(uid, 'install');
    return { car: carOut(carRow(c.id)) };
  }
  function coolPart(uid, type, tier) {
    addPart(uid, type, tier);
    q('INSERT INTO parts_cool (user_id, type, tier, until) VALUES (?, ?, ?, ?)').run(uid, type, tier, now() + S.PART_COOLDOWN_MIN * 60e3);
  }
  function uninstall(uid, { carId, type }) {
    const c = ownCar(uid, carId, ['garage', 'showcase']);
    const old = q('SELECT tier FROM car_parts WHERE car_id = ? AND type = ?').get(c.id, type);
    if (!old) fail('Тут немає деталі');
    bank(uid);
    q('DELETE FROM car_parts WHERE car_id = ? AND type = ?').run(c.id, type);
    coolPart(uid, type, old.tier);
    carChanged(c.id);
    return { car: carOut(carRow(c.id)) };
  }
  // «Встановити найкраще»: the fastest kit for this car from its slots and the free pieces on the warehouse (T.bestTune,
  // the same count the app previews). Swapped-out parts go back to the warehouse and cool down like any removed part.
  // Returns the changes [{ type, from, to, dt }] and the time before/after (T.tuneTime, s).
  function installBest(uid, { carId }) {
    const c = ownCar(uid, carId, ['garage', 'showcase']);
    const plan = T.bestTune({ model: c.model, parts: carParts(c.id) }, inventory(uid));
    if (plan.changes.length) {
      bank(uid);
      for (const ch of plan.changes) {
        if (ch.to) {
          takePart(uid, ch.type, ch.to);
          q('INSERT INTO car_parts (car_id, type, tier) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET tier = excluded.tier').run(c.id, ch.type, ch.to);
        } else q('DELETE FROM car_parts WHERE car_id = ? AND type = ?').run(c.id, ch.type);
        if (ch.from) coolPart(uid, ch.type, ch.from);
      }
      carChanged(c.id);
      const put = plan.changes.filter((ch) => ch.to).length;
      if (put) xp(uid, 'install', put), flag(uid, 'install');
    }
    return { car: carOut(carRow(c.id)), changes: plan.changes, before: plan.before, after: plan.after, dt: plan.dt };
  }
  // «Продати непотрібні»: the pieces no car of the player needs (T.junkParts over every car they own) at the usual
  // dealer rate. items: what the app showed in its confirm; only those still unneeded are sold, at most that many.
  function sellJunk(uid, { items }) {
    if (!Array.isArray(items) || !items.length || items.length > 200) fail('Немає що продати');
    const cars = q('SELECT id, model FROM cars WHERE owner_id = ?').all(uid).map((c) => ({ model: c.model, parts: carParts(c.id) }));
    const junk = T.junkParts(cars, inventory(uid));
    let got = 0, count = 0;
    const sold = [];
    for (const it of items) {
      const j = junk.find((p) => p.type === it?.type && p.tier === it?.tier && p.count > 0);
      if (!j) continue;
      const n = Math.min(j.count, int(it.count ?? j.count, 1, 10000, 'Кількість'));
      takePart(uid, j.type, j.tier, n);
      j.count -= n;
      got += Math.floor(S.TIER_BY_ID[j.tier].price * S.PART_SELL_RATE) * n;
      count += n;
      sold.push({ type: j.type, tier: j.tier, count: n });
    }
    if (!count) fail('Ці деталі вже не зайві — онови склад');
    addMoney(uid, got);
    return { got, count, sold };
  }

  // ---------- paint shop (S.PAINT_COLORS / S.LIVERIES) ----------
  // Only a car in the garage or on the showcase (not listed on the market or an auction) whose photo has a body mask.
  // Paying never changes the car's value; the factory colour and "no livery" are free.
  const paintable = opts.paintable || paintableModels();
  function paintTarget(uid, carId) {
    const c = ownCar(uid, carId, ['garage', 'showcase']);
    if (!paintable.has(c.model)) fail('Для цієї машини фарбування поки недоступне');
    return c;
  }
  function paintCar(uid, { carId, color }) {
    const c = paintTarget(uid, carId);
    const id = color ? String(color) : null;
    if (id && !S.PAINT_BY_ID[id]) fail('Невідомий колір');
    const cur = S.PAINT_BY_ID[c.paint] ? c.paint : null;
    if (cur === id) fail(id ? 'Машина вже цього кольору' : 'Машина й так у заводському кольорі');
    const price = id ? S.paintPrice(c.model) : 0;
    pay(uid, price);
    q('UPDATE cars SET paint = ? WHERE id = ?').run(id, c.id);
    carChanged(c.id);
    return { car: carOut(carRow(c.id)), paid: price };
  }
  function liveryCar(uid, { carId, livery }) {
    const c = paintTarget(uid, carId);
    const id = livery ? String(livery) : null;
    if (id && !S.LIVERY_BY_ID[id]) fail('Невідома ліврея');
    // A season livery is a pass reward: only for its owner, and free.
    if (id && S.LIVERY_BY_ID[id].season && !q('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(uid, S.LIVERY_BY_ID[id].cos)) fail('Ця ліврея — нагорода сезонного пропуску');
    const cur = S.LIVERY_BY_ID[c.livery] ? c.livery : null;
    if (cur === id) fail(id ? 'Ця ліврея вже на машині' : 'На машині немає лівреї');
    const price = id ? S.liveryPrice(c.model, id) : 0;
    pay(uid, price);
    q('UPDATE cars SET livery = ? WHERE id = ?').run(id, c.id);
    carChanged(c.id);
    return { car: carOut(carRow(c.id)), paid: price };
  }
  // Back to factory: colour and livery off at once, free.
  function paintReset(uid, { carId }) {
    const c = ownCar(uid, carId, ['garage', 'showcase']);
    if (!c.paint && !c.livery) fail('Машина й так заводська');
    q('UPDATE cars SET paint = NULL, livery = NULL WHERE id = ?').run(c.id);
    carChanged(c.id);
    return { car: carOut(carRow(c.id)) };
  }

  // ---------- plates ----------
  // ---------- car wash (S.WASH) ----------
  // Cars in the garage or on the showcase can be washed (not while on the market or an auction).
  const WASHABLE = ['garage', 'showcase'];
  function handLeft(u) {
    return Math.max(0, S.WASH.hand - (u.wash_day === dayOf(now()) ? u.wash_hand : 0));
  }
  function washDone(uid, cars) {
    bank(uid); // income so far at the old dirt and shine
    const until = now() + S.WASH.shineHours * 3600e3;
    for (const c of cars) q('UPDATE cars SET dirt = 0, dirt_at = ?, shine_until = ? WHERE id = ?').run(now(), until, c.id);
    track(uid, 'wash', cars.length);
    return until;
  }
  // Hand wash: the rub-off mini-game runs in the app; the server only counts the day's free washes and checks the car.
  function washHand(uid, { carId }) {
    const c = ownCar(uid, carId, WASHABLE);
    const u = userRow(uid);
    const left = handLeft(u);
    if (left < 1) fail(`Ручна мийка на сьогодні все — ${S.WASH.hand} з ${S.WASH.hand}. Завтра знову безкоштовно, а автомийка працює завжди`);
    const day = dayOf(now());
    q('UPDATE users SET wash_day = ?, wash_hand = ? WHERE id = ?').run(day, S.WASH.hand - left + 1, uid);
    return { shineUntil: washDone(uid, [c]), handLeft: left - 1 };
  }
  // Car wash: one car or several («Помити всі»), each at its class price; free with VIP.
  function washAuto(uid, { carIds }) {
    const ids = idList(carIds, S.MAX_SLOTS + S.SHOWCASE_MAX);
    if (!ids.length) fail('Обери машину');
    const cars = ids.map((id) => ownCar(uid, id, WASHABLE));
    const vip = vipOf(uid);
    const paid = vip ? 0 : cars.reduce((s, c) => s + S.washPrice(c.model), 0);
    pay(uid, paid);
    return { shineUntil: washDone(uid, cars), paid, vip, count: cars.length };
  }

  function makePlate(cls, region = null) {
    const L = S.PLATE_LETTERS;
    const letter = () => L[crypto.randomInt(L.length)];
    const reg = () => region || S.PLATE_REGIONS[crypto.randomInt(S.PLATE_REGIONS.length)];
    const four = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');
    for (let i = 0; i < 400; i++) {
      let r = reg(), d = four(), s = letter() + letter();
      const dg = String(crypto.randomInt(1, 10));
      if (cls === 'S') {
        if (crypto.randomInt(2)) d = '000' + dg;
        else (d = dg.repeat(4)), (s = r);
      } else if (cls === 'A') {
        const k = crypto.randomInt(3);
        d = k === 0 ? dg.repeat(4) : k === 1 ? dg + '000' : '00' + dg + crypto.randomInt(10);
      } else if (cls === 'B') {
        const k = crypto.randomInt(3);
        const a = String(crypto.randomInt(10)), b = String(crypto.randomInt(10));
        d = k === 0 ? a + b + b + a : k === 1 ? a + dg.repeat(3) : ['1234', '4321', '2345', '6789', '9876'][crypto.randomInt(5)];
      } else if (cls === 'C') {
        const a = String(crypto.randomInt(10)), b = String(crypto.randomInt(10));
        if (crypto.randomInt(2)) d = a + a + b + b;
        else s = r;
      }
      const text = `${r} ${d} ${s}`;
      if (S.plateInfo(text).cls === cls && !q('SELECT 1 FROM plates WHERE text = ?').get(text)) return text;
    }
    fail('Не вдалося згенерувати номер, спробуй ще');
  }
  // Either a tier (random region) or a chosen region (full random class, price by region — S.REGION_GEN).
  function generatePlate(uid, { gen, region }) {
    let price, weights, reg = null;
    if (region) {
      reg = String(region).toUpperCase();
      if (!S.REGIONS[reg]) fail('Невідомий регіон');
      price = S.platePriceOf(S.regionPrice(reg), 'region', evFx());
      weights = S.REGION_GEN.weights;
    } else {
      const g = S.PLATE_GEN.find((x) => x.id === gen);
      if (!g) fail('Невідомий тип номера');
      price = S.platePriceOf(g.price, g.id, evFx()); // «Щасливі номери»: −20% on the pretty and region plates
      weights = g.weights;
    }
    pay(uid, price);
    const cls = pickWeighted(classEntries(weights), rnd());
    const text = makePlate(cls, reg);
    const [lo, hi] = S.PLATE_VALUE[cls];
    const value = Math.round((lo + rnd() * (hi - lo)) / 100) * 100;
    const r = q('INSERT INTO plates (owner_id, text, cls, value, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, text, cls, value, now());
    q('UPDATE users SET plate_best = MAX(plate_best, ?) WHERE id = ?').run(S.rankOf(cls), uid);
    xp(uid, 'plate');
    flag(uid, 'plate');
    return { plate: { id: Number(r.lastInsertRowid), text, cls, value, label: S.plateInfo(text).label, region: S.regionOf(text) } };
  }
  function ownPlate(uid, id) {
    const p = q('SELECT * FROM plates WHERE id = ?').get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID номера'));
    if (!p || p.owner_id !== uid) fail('Це не твій номер');
    return p;
  }
  const notListed = (p) => {
    if (plateLot(p.id)) fail('Номер виставлено на ринок — спочатку зніми лот');
    return p;
  };
  function attachPlate(uid, { plateId, carId }) {
    const p = notListed(ownPlate(uid, plateId));
    const c = ownCar(uid, carId, ['garage', 'showcase']);
    // The plate may be on another car: only take it from one that is in the garage or showcase, not one being sold.
    const from = p.car_id ? carRow(p.car_id) : null;
    if (from && from.status !== 'garage' && from.status !== 'showcase') fail('Авто з цим номером на ринку — номер зняти не можна');
    bank(uid);
    q('UPDATE plates SET car_id = NULL WHERE car_id = ?').run(c.id);
    q('UPDATE plates SET car_id = ? WHERE id = ?').run(c.id, p.id);
    carChanged(c.id, from?.id);
    return {};
  }
  function detachPlate(uid, { plateId }) {
    const p = ownPlate(uid, plateId);
    if (p.car_id) {
      const c = carRow(p.car_id);
      if (c.status !== 'garage' && c.status !== 'showcase') fail('Авто на ринку — номер зняти не можна');
    }
    bank(uid);
    q('UPDATE plates SET car_id = NULL WHERE id = ?').run(p.id);
    carChanged(p.car_id);
    return {};
  }
  function sellPlate(uid, { plateId }) {
    const p = notListed(ownPlate(uid, plateId));
    if (p.car_id) fail('Спочатку зніми номер з машини');
    q('DELETE FROM plates WHERE id = ?').run(p.id);
    const got = Math.floor(p.value * 0.5);
    addMoney(uid, got);
    return { got };
  }

  // ---------- racing ----------
  function rivalSig(c) {
    return JSON.stringify([2, c.model, carParts(c.id), carPlate(c.id)?.id || 0]);
  }
  // The player's own form for the shown odds: what their last solo races took over their car's base time (at least
  // 5 races; before that a mix of a good and an average driver). Only the shown chance uses it — how fast the
  // rivals are never depends on the player's skill.
  function myTimes(uid, o) {
    const offs = [];
    for (const r of q("SELECT rival, result FROM races WHERE user_id = ? AND status = 'done' ORDER BY id DESC LIMIT 30").all(uid)) {
      try {
        const rv = JSON.parse(r.rival), res = JSON.parse(r.result);
        if (rv.me?.base && res.time < 99) offs.push(res.time - rv.me.base);
      } catch {}
    }
    if (offs.length >= 5) return offs.map((x) => o.base + x).sort((a, b) => a - b);
    const st = { base: o.base, shift: o.shift };
    return [...S.driverTimes(st, S.DRIVERS.good, 120), ...S.driverTimes(st, S.DRIVERS.average, 120)].sort((a, b) => a - b);
  }
  // Rivals (rules in S.OPPONENTS): for every tier the base time that gives a good driver in the reference car
  // (S.raceRef) the tier's chance, then a real model that runs it (S.pickRival) — its shown power is what it needs.
  function rivals(uid, { carId }) {
    const c = ownCar(uid, carId);
    const o = carOut(c);
    const sig = rivalSig(c);
    const cls = S.MODELS[c.model].cls;
    const row = q('SELECT * FROM rivals WHERE user_id = ? AND car_id = ?').get(uid, c.id);
    // Cached rivals keep their cars and odds, but entry/prize always follow the current tables (a balance change applies at once).
    // The race weekend raises the prize (S.eventPrize, at most EVENT_CAPS.prizeMult); the entry stays the same.
    const fx = evFx();
    const money = (op) => {
      const m = S.raceMoney(op, S.MODELS[c.model].price);
      return { ...m, prize: S.eventPrize(m.prize, fx, op.share != null ? 100 : 1000) };
    };
    const tiers = [S.TRAINING, ...S.OPPONENTS];
    const opOf = (id) => tiers.find((op) => op.id === id);
    if (row && row.sig === sig) return { car: o, list: JSON.parse(row.data).map((r) => ({ ...r, ...money(opOf(r.id)) })) };
    const ref = S.raceRef({ model: c.model, parts: carParts(c.id) });
    const refTimes = S.driverTimes({ base: ref.base, shift: ref.shift });
    const refOffsets = S.rivalOffsets(ref.base);
    const mine = myTimes(uid, o);
    const names = [...S.RIVAL_NAMES].sort(() => rnd() - 0.5);
    const used = [c.model];
    const list = tiers.map((op, i) => {
      const p = op.chance + (rnd() * 2 - 1) * op.spread;
      const base = round3(S.baseForChance(refTimes, refOffsets, p));
      const pick = S.pickRival(cls, base, { hp: ref.stock.hp, harder: op.id === 'hard' ? true : op.id === 'mid' ? null : false, rand: rnd, avoid: used });
      used.push(pick.model);
      const chance = Math.round(S.oddsVs(mine, S.rivalOffsets(base), base) * 100);
      return { id: op.id, label: op.name, name: names[i] || 'Інструктор', model: pick.model, hp: pick.hp, tuned: pick.tuned, base, et: Math.round((base + 0.2) * 100) / 100, ...money(op), chance };
    });
    q('INSERT INTO rivals (user_id, car_id, sig, data) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET sig = excluded.sig, data = excluded.data').run(uid, c.id, sig, JSON.stringify(list));
    return { car: o, list };
  }
  // ---------- drift (rules in S.DRIFT) ----------
  // A track of the day per car and three rivals on it, each with a target score: a share of the track's par (what an
  // average driver scores there in this model's stock form — parts on your car are your edge); money as in drag
  // races (by the car model's price).
  function driftRivals(uid, { carId }) {
    const c = ownCar(uid, carId);
    const o = carOut(c);
    const h = sha256(`drift:${uid}:${c.id}:${dayOf(now())}`);
    const trackSeed = parseInt(h.slice(48, 56), 16);
    const par = S.driftPar(S.driftModel(S.carStats({ model: c.model })), S.driftTrack(trackSeed));
    const pool = S.ALL_MODELS.filter((m) => m.cls === S.MODELS[c.model].cls && !m.secret);
    const list = S.DRIFT_RIVALS.map((r, i) => {
      const x = parseInt(h.slice(i * 6, i * 6 + 6), 16) / 0xffffff;
      const base = S.raceMoney(S.OPPONENTS.find((op) => op.id === r.id), S.MODELS[c.model].price);
      const money = { ...base, prize: S.eventPrize(base.prize, evFx()) };
      return { id: r.id, label: r.name, name: S.RIVAL_NAMES[parseInt(h.slice(20 + i * 2, 22 + i * 2), 16) % S.RIVAL_NAMES.length],
        model: pool[Math.floor(x * pool.length)]?.id || c.model, target: Math.max(10, Math.round((par * r.share * (0.96 + 0.08 * x)) / 10) * 10), ...money };
    });
    return { car: o, list, model: S.driftModel(o), track: trackSeed, par };
  }
  // Fuel: one from the shared tank and one from the car's own tank (as a drag race).
  function useFuel(uid, c) {
    const f = fuelState(userRow(uid));
    if (f.fuel < 1) fail('Загальний бак порожній — зачекай або відкрий кейс нагород');
    const t = tankState(c);
    if (t.tank < 1) fail('Бак цієї машини порожній — візьми іншу');
    q('UPDATE users SET fuel = ?, fuel_at = ? WHERE id = ?').run(f.fuel - 1, f.fuel >= S.FUEL_MAX ? now() : f.at, uid);
    q('UPDATE cars SET tank = ?, tank_at = ? WHERE id = ?').run(t.tank - 1, t.tank >= S.CAR_TANK ? now() : t.at, c.id);
  }
  // A race gets the car dirty (S.WASH.race / .drift, random in the range); the owner's income so far is banked first, at
  // the old dirt. Not from the game's random source (opts.random), so race rolls stay where they were.
  function soil(c, kind = 'race') {
    if (!c) return;
    bank(c.owner_id);
    const [lo, hi] = S.WASH[kind] || S.WASH.race;
    const d = Math.min(100, S.dirtNow(c.dirt, c.dirt_at, now()) + lo + crypto.randomInt(hi - lo + 1));
    q('UPDATE cars SET dirt = ?, dirt_at = ? WHERE id = ?').run(d, now(), c.id);
  }
  // Anti-bot: at most this many starts a minute (an honest drag race takes ~10 s, a drift run ~30 s).
  const START_LIMIT = { races: 10, drift_runs: 4 };
  function startLimit(uid, table) {
    if (q(`SELECT COUNT(*) n FROM ${table} WHERE user_id = ? AND created_at > ?`).get(uid, now() - 60e3).n >= START_LIMIT[table]) fail('Забагато заїздів за хвилину — перепочинь трохи');
  }
  function driftStart(uid, { carId, rival }) {
    startLimit(uid, 'drift_runs');
    const { car, list, model, track: trackSeed } = driftRivals(uid, { carId });
    const r = list.find((x) => x.id === rival);
    if (!r) fail('Обери суперника');
    const c = carRow(car.id);
    useFuel(uid, c);
    pay(uid, r.entry);
    soil(c, 'drift');
    q("UPDATE drift_runs SET status = 'expired' WHERE user_id = ? AND status = 'running'").run(uid);
    // The run token: the seed of the physics noise, the track and the model are fixed here; the finish replays the
    // gas log on them.
    const seed = Math.floor(rnd() * 2 ** 31);
    const id = Number(q('INSERT INTO drift_runs (user_id, car_id, rival, target, entry, prize, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid, c.id, JSON.stringify({ ...r, seed, track: trackSeed, model }), r.target, r.entry, r.prize, now()).lastInsertRowid);
    return { runId: id, car, rival: r, model, max: S.DRIFT_MAX, seed, track: trackSeed, step: S.DRIFT_STEP };
  }
  // A run without a gas log (a client from before «Дрифт 2.0», or a run started before it) can't be checked: its
  // score is capped below the rival's target, so it can never win; it must still have taken an honest run's time.
  const DRIFT_LEGACY_SHARE = 0.6, DRIFT_LEGACY_MS = 20000;
  function driftFinish(uid, { runId, score, clean, spins, log }) {
    const run = q('SELECT * FROM drift_runs WHERE id = ? AND user_id = ?').get(int(runId, 1, 1e15, 'ID заїзду'), uid);
    if (!run || run.status !== 'running') fail('Заїзд уже завершено');
    const took = now() - run.created_at;
    const { seed, track: trackSeed, model: m0, ...rival } = JSON.parse(run.rival);
    const v2 = seed != null && trackSeed != null && m0?.vmax != null;
    const model = v2 ? m0 : S.driftModel(carOut(carRow(run.car_id)) || { hp: 100, kg: 1000, grip: 0.35 });
    const layout = S.driftTrack(trackSeed ?? 0);
    const cap = S.driftCap(model, layout);
    let pts, cl, sp, check, extra = {};
    if (log != null && v2) {
      const rep = S.driftReplay(model, layout, seed, log);
      if (rep.error) fail('Некоректні дані заїзду');
      // The countdown and the whole replayed run must have passed on the server's clock (less the network allowance).
      if (took < S.DRIFT_COUNT_MS + rep.ms - S.DRAG_TOL.wall) fail('Заїзд ще не закінчився');
      pts = rep.score;
      cl = rep.clean;
      sp = rep.spins;
      extra = { wides: rep.wides, maxCombo: rep.maxCombo, corners: rep.corners, track: trackSeed, ms: rep.ms };
      check = Math.floor(Number(score)) === pts ? 'ok' : 'replayed';
    } else {
      if (took < S.DRIFT_COUNT_MS + DRIFT_LEGACY_MS - S.DRAG_TOL.wall) fail('Заїзд ще не закінчився');
      pts = Math.max(0, Math.round(Number(score) || 0));
      cl = int(clean ?? 0, 0, S.DRIFT.corners);
      sp = int(spins ?? 0, 0, 99);
      check = 'legacy';
      pts = Math.min(pts, Math.floor(run.target * DRIFT_LEGACY_SHARE));
    }
    // Never above what this car can reach on this track; a run left hanging for minutes counts as nothing.
    pts = Math.min(pts, cap);
    if (took > 3 * 60e3) (pts = 0, check = 'timeout');
    const win = pts >= run.target;
    if (win) addMoney(uid, run.entry + run.prize);
    const result = { win, score: pts, target: run.target, prize: win ? run.prize : 0, entry: run.entry, clean: cl, spins: sp, ...extra, rival, check };
    q("UPDATE drift_runs SET status = 'done', result = ? WHERE id = ?").run(JSON.stringify(result), run.id);
    q('UPDATE users SET races = races + 1, wins = wins + ? WHERE id = ?').run(win ? 1 : 0, uid);
    xp(uid, win ? 'win' : 'race');
    track(uid, 'race');
    if (win) track(uid, 'win');
    flag(uid, 'race');
    if (win) flag(uid, 'win');
    return result;
  }
  // A drag run from the client's report. New clients send `launch` (ms after the lights started) and `shiftAt` (ms
  // after launch of every shift): the server recomputes the reaction against its own green time and replays every
  // shift. Old clients send only reaction/shifts: no perfect start, no perfect shifts. Either way the run must not
  // end sooner on the server's clock (elapsedMs since the lights started, from the server's side) than it can.
  function dragRun(stats, greenMs, body, elapsedMs) {
    let reaction, shifts, launch, endMs, corrected = 0, legacy = false;
    if (body.launch == null && body.shiftAt == null) {
      legacy = true;
      if (!okShifts(body.shifts)) fail('Некоректні дані заїзду');
      reaction = Number(body.reaction);
      if (!Number.isFinite(reaction)) fail('Некоректний старт');
      reaction = reaction < 0 ? -1 : Math.max(S.START.perfectWindow + 0.001, Math.min(reaction, 3));
      shifts = body.shifts.map((s) => (s === 'perfect' ? 'good' : s));
      launch = greenMs + Math.max(0, reaction) * 1000;
      const { react, drive } = S.dragDrive(stats, reaction, shifts);
      endMs = ((react + drive) / S.RACE_SPEED) * 1000;
    } else {
      launch = Number(body.launch);
      if (!Number.isFinite(launch) || launch < 0 || launch > 120e3) fail('Некоректний старт');
      reaction = S.reactionOf(launch, greenMs);
      if (body.shifts != null && !okShifts(body.shifts)) fail('Некоректні дані заїзду');
      const rep = S.dragReplay(stats, reaction, body.shiftAt, body.shifts || []);
      if (rep.error) fail('Некоректні дані заїзду');
      ({ shifts, endMs, corrected } = rep);
    }
    if (elapsedMs < launch + endMs - S.DRAG_TOL.wall) fail('Заїзд ще не закінчився');
    return { reaction: round3(reaction), shifts, time: S.raceTime(stats, reaction, shifts), jump: reaction < 0, perfectStart: S.perfectStartOf(reaction), corrected, legacy };
  }
  function raceStart(uid, { carId, rival }) {
    startLimit(uid, 'races');
    const { car, list } = rivals(uid, { carId });
    const r = list.find((x) => x.id === rival);
    if (!r) fail('Обери суперника');
    const u = userRow(uid);
    const f = fuelState(u);
    if (f.fuel < 1) fail('Загальний бак порожній — зачекай або відкрий кейс нагород');
    const c = carRow(car.id);
    const t = tankState(c);
    if (t.tank < 1) fail('Бак цієї машини порожній — візьми іншу');
    q("UPDATE races SET status = 'expired' WHERE user_id = ? AND status = 'running'").run(uid);
    pay(uid, r.entry);
    q('UPDATE users SET fuel = ?, fuel_at = ? WHERE id = ?').run(f.fuel - 1, f.fuel >= S.FUEL_MAX ? now() : f.at, uid);
    q('UPDATE cars SET tank = ?, tank_at = ? WHERE id = ?').run(t.tank - 1, t.tank >= S.CAR_TANK ? now() : t.at, c.id);
    soil(c);
    const rr = lcg(Math.floor(rnd() * 2 ** 31));
    const rivalTime = S.rivalRun(rr, r);
    // The car is fixed at the start: installing parts or selling it before the finish changes nothing.
    // The server picks the green light; the exact rival time stays here until the finish (the client gets it
    // rounded to 0.1 s, enough to animate the rival's car).
    const greenMs = S.RACE_GREEN[0] + Math.floor(rnd() * (S.RACE_GREEN[1] - S.RACE_GREEN[0]));
    const rec = { ...r, time: rivalTime, me: { base: car.base, shift: car.shift }, greenMs };
    const id = Number(q('INSERT INTO races (user_id, car_id, rival, entry, prize, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, c.id, JSON.stringify(rec), r.entry, r.prize, now()).lastInsertRowid);
    return { raceId: id, car, rival: { ...r, time: Math.round(rivalTime * 10) / 10, coarse: true }, greenMs, shiftPoints: S.SHIFT_POINTS };
  }
  function raceFinish(uid, { raceId, ...body }) {
    const race = q('SELECT * FROM races WHERE id = ? AND user_id = ?').get(int(raceId, 1, 1e15, 'ID заїзду'), uid);
    if (!race || race.status !== 'running') fail('Заїзд уже завершено');
    const elapsed = now() - race.created_at;
    const expired = elapsed > 3 * 60e3;
    const rival = JSON.parse(race.rival);
    const stats = rival.me || carOut(carRow(race.car_id));
    if (!stats) fail('Цього авто вже немає');
    const run = dragRun(stats, rival.greenMs ?? S.RACE_GREEN[0], body, elapsed);
    const { shifts } = run;
    const time = expired ? 99 : run.time;
    const win = time < rival.time;
    if (win) addMoney(uid, race.entry + race.prize);
    const result = { win, time, rivalTime: rival.time, diff: round3(Math.abs(time - rival.time)), prize: win ? race.prize : 0, entry: race.entry, jump: run.jump, perfectStart: run.perfectStart, reaction: run.reaction, shifts, corrected: run.corrected };
    if (rival.boss && S.BOSS_BY_ID[rival.boss]) result.boss = bossAfterRace(uid, S.BOSS_BY_ID[rival.boss], result);
    q("UPDATE races SET status = 'done', result = ? WHERE id = ?").run(JSON.stringify(result), race.id);
    q('UPDATE users SET races = races + 1, wins = wins + ? WHERE id = ?').run(win ? 1 : 0, uid);
    q('DELETE FROM rivals WHERE user_id = ? AND car_id = ?').run(uid, race.car_id);
    xp(uid, win ? 'win' : 'race');
    track(uid, 'race');
    if (win) track(uid, 'win');
    const perfect = shifts.filter((s) => s === 'perfect').length;
    if (perfect) track(uid, 'perfect', perfect);
    flag(uid, 'race');
    if (win) flag(uid, 'win');
    return result;
  }

  // ---------- career: country bosses (S.BOSSES) ----------
  // A boss race is a solo drag race in the `races` table (rival.boss = the boss id), started here and finished by
  // race/finish exactly like any other (same replay and checks); bossAfterRace adds the career part to its result.
  const bossRows = (uid) => Object.fromEntries(q('SELECT * FROM boss_runs WHERE user_id = ?').all(uid).map((r) => [r.boss, r]));
  // Bosses open in order: the first one always, every next one once the one before it is beaten.
  const bossOpen = (b, rows) => b.n === 0 || !!rows[S.BOSSES[b.n - 1].id]?.beaten_at;
  // What a car of the player earns and risks against a boss: before the first win nothing (no entry, no prize — the
  // one-time reward is the prize); after it, normal race money (S.bossRematch) at a good driver's odds in this car.
  // A boss's pace never changes, so its run spread is worked out once per process.
  const bossOffs = new Map();
  const bossOffsetsOf = (b) => bossOffs.get(b.id) || (bossOffs.set(b.id, S.bossOffsets(b)), bossOffs.get(b.id));
  function bossMoney(b, o, beaten, good = S.driverTimes({ base: o.base, shift: o.shift })) {
    if (!beaten) return { entry: 0, prize: 0 };
    const p = S.oddsVs(good, bossOffsetsOf(b), b.base);
    return S.bossRematch(p, Math.min(S.MODELS[o.model].price, S.MODELS[b.model].price));
  }
  function bossList(uid, { carId } = {}) {
    const rows = bossRows(uid);
    const o = carId ? carOut(ownCar(uid, carId)) : null;
    const mine = o ? myTimes(uid, o) : null;
    const good = o ? S.driverTimes({ base: o.base, shift: o.shift }) : null;
    let next = null;
    const list = S.BOSSES.map((b) => {
      const r = rows[b.id], open = bossOpen(b, rows), beaten = !!r?.beaten_at;
      if (open && !beaten && !next) next = b.id;
      const out = { id: b.id, open, beaten, tries: r?.tries || 0, wins: r?.wins || 0, best: r?.best ?? null };
      if (o && open) {
        out.fits = S.bossFits(b, o.model);
        out.chance = Math.round(S.oddsVs(mine, bossOffsetsOf(b), b.base) * 100);
        Object.assign(out, bossMoney(b, o, beaten, good));
      }
      return out;
    });
    const beatenN = list.filter((x) => x.beaten).length;
    return { list, next, beaten: beatenN, total: S.BOSSES.length, badge: q("SELECT title, tier FROM badges WHERE user_id = ? AND key = 'boss'").get(uid) || null };
  }
  function bossStart(uid, { carId, boss }) {
    startLimit(uid, 'races');
    const b = S.BOSS_BY_ID[String(boss)];
    if (!b) fail('Невідомий бос');
    const rows = bossRows(uid);
    if (!bossOpen(b, rows)) fail('Спершу переможи попереднього боса');
    const c = ownCar(uid, carId);
    const car = carOut(c);
    if (!S.bossFits(b, c.model)) fail(`${b.nick} не прийме виклик: потрібна машина класу ${b.req} або вище`);
    const u = userRow(uid);
    const f = fuelState(u);
    if (f.fuel < 1) fail('Загальний бак порожній — зачекай або відкрий кейс нагород');
    const t = tankState(c);
    if (t.tank < 1) fail('Бак цієї машини порожній — візьми іншу');
    const beaten = !!rows[b.id]?.beaten_at;
    const money = bossMoney(b, car, beaten);
    q("UPDATE races SET status = 'expired' WHERE user_id = ? AND status = 'running'").run(uid);
    pay(uid, money.entry);
    q('UPDATE users SET fuel = ?, fuel_at = ? WHERE id = ?').run(f.fuel - 1, f.fuel >= S.FUEL_MAX ? now() : f.at, uid);
    q('UPDATE cars SET tank = ?, tank_at = ? WHERE id = ?').run(t.tank - 1, t.tank >= S.CAR_TANK ? now() : t.at, c.id);
    q('INSERT INTO boss_runs (user_id, boss, tries) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET tries = tries + 1').run(uid, b.id);
    soil(c);
    const rivalTime = S.bossRun(lcg(Math.floor(rnd() * 2 ** 31)), b);
    const greenMs = S.RACE_GREEN[0] + Math.floor(rnd() * (S.RACE_GREEN[1] - S.RACE_GREEN[0]));
    const r = { id: 'boss', boss: b.id, label: "Бос", name: b.nick, model: b.model, hp: b.hp, base: b.base, shift: b.shift, et: b.et, ...money };
    const rec = { ...r, time: rivalTime, me: { base: car.base, shift: car.shift }, greenMs };
    const id = Number(q('INSERT INTO races (user_id, car_id, rival, entry, prize, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, c.id, JSON.stringify(rec), money.entry, money.prize, now()).lastInsertRowid);
    return { raceId: id, car, rival: { ...r, time: Math.round(rivalTime * 10) / 10, coarse: true }, greenMs, shiftPoints: S.SHIFT_POINTS };
  }
  // After race/finish of a boss race: counts the win, and the first one pays the reward once (beaten_at is set in the
  // same transaction, guarded by "IS NULL", so a second win — or a replayed finish — can never pay it again).
  function bossAfterRace(uid, b, result) {
    if (result.win) q('UPDATE boss_runs SET wins = wins + 1, best = MIN(COALESCE(best, ?), ?) WHERE user_id = ? AND boss = ?').run(result.time, result.time, uid, b.id);
    const first = result.win && q('UPDATE boss_runs SET beaten_at = ? WHERE user_id = ? AND boss = ? AND beaten_at IS NULL').run(now(), uid, b.id).changes > 0;
    const out = { id: b.id, first };
    if (!first) return out;
    const rw = b.reward;
    const got = grant(uid, { money: rw.money, parts: rw.parts, tier: rw.tier, caseId: rw.caseId, count: rw.count });
    out.reward = { money: rw.money, caseId: rw.caseId, count: rw.count, tier: rw.tier, parts: rw.parts, items: got.items || [] };
    if (rw.plate) {
      const text = makePlate(rw.plate);
      const [lo, hi] = S.PLATE_VALUE[rw.plate];
      const value = Math.round((lo + rnd() * (hi - lo)) / 100) * 100;
      const pid = Number(q('INSERT INTO plates (owner_id, text, cls, value, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, text, rw.plate, value, now()).lastInsertRowid);
      q('UPDATE users SET plate_best = MAX(plate_best, ?) WHERE id = ?').run(S.rankOf(rw.plate), uid);
      out.reward.plate = { id: pid, text, cls: rw.plate, value };
    }
    if (rw.badge) {
      // One career badge, replaced by the next country's (never downgraded by an old country — the ladder is in order).
      q("INSERT INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, 'boss', ?, ?, NULL, NULL, ?) ON CONFLICT DO UPDATE SET title = excluded.title, tier = excluded.tier, created_at = excluded.created_at")
        .run(uid, rw.badge, S.BOSS_BADGES[b.country][1], now());
      out.reward.badge = rw.badge;
    }
    const nx = S.BOSSES[b.n + 1];
    out.next = nx ? nx.id : null;
    return out;
  }

  // ---------- upgrade ----------
  function upgrade(uid, { carIds, target }) {
    const ids = idList(carIds, S.UPGRADE.maxCars);
    if (!ids.length) fail('Обери хоча б одну машину');
    const cars = ids.map((id) => noCollector(noSecret(ownCar(uid, id))));
    if (q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status = 'garage'").get(uid).n - ids.length < 1) fail('У гаражі має залишитися хоча б одна машина');
    const t = S.MODELS[target];
    if (!t || t.secret) fail('Обери машину-ціль');
    const stake = cars.reduce((s, c) => s + S.MODELS[c.model].price, 0);
    if (t.price < stake * S.UPGRADE.minMult) fail(`Ціль має бути щонайменше в ${S.UPGRADE.minMult} раза дорожча`);
    if (t.price > stake * S.UPGRADE.maxMult) fail(`Ціль занадто дорога — максимум ×${S.UPGRADE.maxMult}`);
    const chance = S.upgradeChance(stake, t.price, cars.length);
    const f = nextNonce(uid);
    const roll = f.roll(0);
    const win = roll < chance;
    bank(uid);
    for (const c of cars) {
      stripCar(uid, c.id);
      q('DELETE FROM cars WHERE id = ?').run(c.id);
      q('DELETE FROM rivals WHERE car_id = ?').run(c.id);
    }
    invalidateTrades(ids);
    let car = null, isNew = false;
    if (win) {
      const g = giveCar(uid, t.id, worstOrigin(cars));
      car = carOut(carRow(g.id));
      isNew = g.isNew;
    }
    xp(uid, 'upgrade');
    return { win, chance, roll, stake, car, isNew, target: t.id };
  }

  // ---------- trade-in (S.TRADE_IN) ----------
  function tradeIn(uid, { carIds }) {
    const ids = idList(carIds, S.TRADE_IN.cars);
    if (ids.length !== S.TRADE_IN.cars) fail(`Потрібно рівно ${S.TRADE_IN.cars} машини`);
    const cars = ids.map((id) => noCollector(noSecret(ownCar(uid, id))));
    const cls = S.MODELS[cars[0].model].cls;
    if (cars.some((c) => S.MODELS[c.model].cls !== cls)) fail('Усі три машини мають бути одного класу');
    const up = S.CLASS_ORDER[S.rankOf(cls) + 1];
    if (!up || up === 'X') fail('Вище за міфічний клас нічого немає');
    if (q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status = 'garage'").get(uid).n - ids.length < 1) fail('У гаражі має залишитися хоча б одна машина');
    const stake = cars.reduce((s, c) => s + S.MODELS[c.model].price, 0);
    const f = nextNonce(uid);
    const win = f.roll(0) < S.TRADE_IN.chance;
    const poolOf = (k) => S.ALL_MODELS.filter((m) => m.cls === k && !m.secret && !m.homeOnly && m.price <= stake * S.TRADE_IN.maxMult);
    let pool = poolOf(win ? up : cls);
    if (!pool.length) pool = S.ALL_MODELS.filter((m) => m.cls === (win ? up : cls) && !m.secret && !m.homeOnly).sort((a, b) => a.price - b.price).slice(0, 3);
    const model = pickModel(pool, f.roll(1));
    bank(uid);
    for (const c of cars) {
      stripCar(uid, c.id);
      q('DELETE FROM cars WHERE id = ?').run(c.id);
      q('DELETE FROM rivals WHERE car_id = ?').run(c.id);
    }
    invalidateTrades(ids);
    const g = giveCar(uid, model, worstOrigin(cars));
    q('INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, forced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid, 'tradein', model, S.MODELS[model].cls, sha256(f.server_seed), f.client_seed, f.nonce, 0, now());
    xp(uid, 'upgrade');
    return { win, chance: S.TRADE_IN.chance, stake, car: carOut(carRow(g.id)), isNew: g.isNew, from: cls, to: win ? up : cls };
  }

  // ---------- casino ----------
  function bet(uid, amount) {
    const b = int(amount, S.CASINO.minBet, S.CASINO.maxBet, 'Ставка');
    halfCap(uid, b);
    pay(uid, b);
    return b;
  }
  function halfCap(uid, stake, limit) {
    const bal = userRow(uid).balance, cap = S.casinoMaxBet(bal, limit);
    if (stake <= bal && stake > cap) fail(cap < S.CASINO.minBet ? 'Замало грошей для ставки: можна ставити до половини балансу' : `Ставка — не більше половини балансу: до ${S.fmt(cap)}`);
  }
  // bet × multiplier without float artefacts (1.14 × 10000 must be 11400, not 11399).
  const payout = (b, mult) => Math.floor(Math.round(b * mult * 100) / 100);
  function casinoXp(uid) {
    xp(uid, 'casino');
  }
  function slots(uid, { amount }) {
    const b = bet(uid, amount);
    const f = nextNonce(uid);
    const entries = S.SLOT_SYMBOLS.map((x) => [x.s, x.w]);
    const reels = [0, 1, 2].map((i) => pickWeighted(entries, f.roll(i)));
    const mult = S.slotPayout(reels);
    const won = payout(b, mult);
    if (won) addMoney(uid, won);
    casinoXp(uid);
    return { reels, mult, won, bet: b };
  }
  function roulette(uid, { bets }) {
    if (!Array.isArray(bets) || !bets.length) fail('Зроби ставку');
    if (bets.length > S.CASINO.rouletteFields) fail(`Максимум ${S.CASINO.rouletteFields} поля за один спін`);
    const parsed = bets.map((x) => {
      const isNum = typeof x?.on === 'number' || /^\d+$/.test(String(x?.on));
      const on = isNum ? int(Number(x.on), 0, 36, 'Число') : String(x?.on);
      if (!isNum && !Object.hasOwn(S.ROULETTE_BETS, on)) fail('Невідома ставка');
      const amount = int(x.amount, S.CASINO.minBet, Number.MAX_SAFE_INTEGER, 'Ставка');
      if (amount > S.CASINO.maxBet) fail(`Максимум ${S.fmt(S.CASINO.maxBet)} на одне поле`);
      return { on, amount };
    });
    if (new Set(parsed.map((x) => String(x.on))).size !== parsed.length) fail('Ставки на одне поле повторюються');
    const total = parsed.reduce((s, x) => s + x.amount, 0);
    if (total > S.CASINO.rouletteTotal) fail(`Максимум ${S.fmt(S.CASINO.rouletteTotal)} на всі ставки за один спін`);
    halfCap(uid, total, S.CASINO.rouletteTotal);
    pay(uid, total);
    const n = Math.floor(nextNonce(uid).roll(0) * 37);
    let won = 0;
    const results = parsed.map((x) => {
      const hit = typeof x.on === 'number' ? x.on === n : S.ROULETTE_BETS[x.on].win(n);
      const pays = typeof x.on === 'number' ? 35 : S.ROULETTE_BETS[x.on].pays;
      const w = hit ? x.amount * (pays + 1) : 0;
      won += w;
      return { ...x, hit, won: w };
    });
    if (won) addMoney(uid, won);
    casinoXp(uid);
    return { number: n, color: n === 0 ? 'green' : S.ROULETTE_RED.includes(n) ? 'red' : 'black', won, total, results };
  }
  // Crash: the crash point is fixed at the start; the multiplier grows with server time.
  function crashResolve(g) {
    if (g.status !== 'running') return g;
    const m = S.crashAt((now() - g.started_at) / 1000);
    if (g.auto && g.auto < g.point && m >= g.auto) {
      addMoney(g.user_id, payout(g.bet, g.auto));
      q("UPDATE crash_games SET status = 'won', cashout = ? WHERE id = ?").run(g.auto, g.id);
      return { ...g, status: 'won', cashout: g.auto };
    }
    if (m >= g.point) {
      q("UPDATE crash_games SET status = 'lost' WHERE id = ?").run(g.id);
      return { ...g, status: 'lost' };
    }
    return g;
  }
  const crashOut = (g) => ({
    id: g.id, bet: g.bet, status: g.status, auto: g.auto, startedAt: g.started_at,
    point: g.status === 'running' ? null : g.point, cashout: g.cashout, won: g.status === 'won' ? payout(g.bet, g.cashout) : 0, now: now(),
  });
  function crashStart(uid, { amount, auto }) {
    const running = q("SELECT * FROM crash_games WHERE user_id = ? AND status = 'running'").get(uid);
    if (running && crashResolve(running).status === 'running') fail('Спочатку заверши поточну гру');
    const a = auto == null || auto === '' ? null : Number(auto);
    if (a != null && !(a >= 1.01 && a <= S.CRASH.max)) fail('Автовивід: від 1.01 до 1000');
    const b = bet(uid, amount);
    const r = nextNonce(uid).roll(0);
    const point = Math.min(S.CRASH.max, Math.max(1, Math.floor((S.CRASH.edge / (1 - r)) * 100) / 100));
    const id = Number(q('INSERT INTO crash_games (user_id, bet, point, auto, started_at) VALUES (?, ?, ?, ?, ?)').run(uid, b, point, a, now()).lastInsertRowid);
    casinoXp(uid);
    return crashOut(q('SELECT * FROM crash_games WHERE id = ?').get(id));
  }
  function crashGame(uid, id) {
    const g = q('SELECT * FROM crash_games WHERE id = ? AND user_id = ?').get(int(id, 1, 1e15, 'ID гри'), uid);
    if (!g) fail('Гру не знайдено');
    return g;
  }
  function crashState(uid, { id }) {
    return crashOut(crashResolve(crashGame(uid, id)));
  }
  // The client sends the multiplier it showed when the player tapped; it is accepted only if the
  // server's own multiplier has already reached it and the rocket has not crashed yet.
  function crashCashout(uid, { id, at }) {
    const g = crashResolve(crashGame(uid, id));
    if (g.status !== 'running') return crashOut(g);
    const m = S.crashAt((now() - g.started_at) / 1000);
    const want = Number(at);
    const x = Number.isFinite(want) && want >= 1 && want <= m ? Math.floor(want * 100) / 100 : m;
    if (x >= g.point) {
      q("UPDATE crash_games SET status = 'lost' WHERE id = ?").run(g.id);
      return crashOut({ ...g, status: 'lost' });
    }
    addMoney(uid, payout(g.bet, x));
    q("UPDATE crash_games SET status = 'won', cashout = ? WHERE id = ?").run(x, g.id);
    return crashOut({ ...g, status: 'won', cashout: x });
  }
  function crashHistory(uid) {
    const running = q("SELECT * FROM crash_games WHERE user_id = ? AND status = 'running'").get(uid);
    return {
      running: running ? crashOut(crashResolve(running)) : null,
      // Each past round with the player's own outcome, not just where it crashed.
      last: q("SELECT point, status, cashout FROM crash_games WHERE user_id = ? AND status <> 'running' ORDER BY id DESC LIMIT 12").all(uid),
    };
  }
  // Mines: mine positions are drawn from the fair roll at the start and revealed at the end.
  const minesOut = (g, reveal = false) => {
    const opened = JSON.parse(g.revealed);
    return {
      id: g.id, bet: g.bet, mines: g.mines, status: g.status, opened,
      mult: S.minesMult(g.mines, opened.length), next: opened.length < S.MINES.cells - g.mines ? S.minesMult(g.mines, opened.length + 1) : null,
      layout: reveal || g.status !== 'running' ? JSON.parse(g.layout) : null,
      won: g.status === 'won' ? payout(g.bet, S.minesMult(g.mines, opened.length)) : 0,
    };
  };
  function minesStart(uid, { amount, mines }) {
    if (q("SELECT 1 FROM mines_games WHERE user_id = ? AND status = 'running'").get(uid)) fail('Спочатку заверши поточну гру');
    const n = int(mines, 1, 24, 'Кількість мін');
    if (!S.MINES.choices.includes(n)) fail('Кількість мін: ' + S.MINES.choices.join(', '));
    const b = bet(uid, amount);
    const f = nextNonce(uid);
    const cells = Array.from({ length: S.MINES.cells }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(f.roll(i) * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const layout = cells.slice(0, n).sort((a, b2) => a - b2);
    const id = Number(q('INSERT INTO mines_games (user_id, bet, mines, layout, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, b, n, JSON.stringify(layout), now()).lastInsertRowid);
    casinoXp(uid);
    return minesOut(q('SELECT * FROM mines_games WHERE id = ?').get(id));
  }
  function minesGame(uid) {
    const g = q("SELECT * FROM mines_games WHERE user_id = ? AND status = 'running'").get(uid);
    if (!g) fail('Немає активної гри');
    return g;
  }
  function minesReveal(uid, { cell }) {
    const g = minesGame(uid);
    const c = int(cell, 0, S.MINES.cells - 1, 'Клітинка');
    const opened = JSON.parse(g.revealed);
    if (opened.includes(c)) fail('Клітинку вже відкрито');
    const layout = JSON.parse(g.layout);
    if (layout.includes(c)) {
      q("UPDATE mines_games SET status = 'lost', revealed = ? WHERE id = ?").run(JSON.stringify([...opened, c]), g.id);
      return { ...minesOut({ ...g, status: 'lost', revealed: JSON.stringify(opened) }), boom: c };
    }
    opened.push(c);
    const done = opened.length === S.MINES.cells - g.mines;
    q('UPDATE mines_games SET revealed = ? WHERE id = ?').run(JSON.stringify(opened), g.id);
    if (done) return minesCashout(uid);
    return minesOut({ ...g, revealed: JSON.stringify(opened) });
  }
  function minesCashout(uid) {
    const g = minesGame(uid);
    const opened = JSON.parse(g.revealed);
    if (!opened.length) fail('Відкрий хоча б одну клітинку');
    const won = payout(g.bet, S.minesMult(g.mines, opened.length));
    addMoney(uid, won);
    q("UPDATE mines_games SET status = 'won' WHERE id = ?").run(g.id);
    return minesOut({ ...g, status: 'won' });
  }
  function minesState(uid) {
    const g = q("SELECT * FROM mines_games WHERE user_id = ? AND status = 'running'").get(uid);
    return { game: g ? minesOut(g) : null };
  }

  // ---------- PvP ----------
  function autoRun(stats) {
    const reaction = 0.15 + rnd() * 0.25;
    const shifts = Array.from({ length: S.SHIFTS }, () => (rnd() < 0.3 ? 'perfect' : rnd() < 0.8 ? 'good' : 'late'));
    return { reaction: round3(reaction), time: S.raceTime(stats, reaction, shifts) };
  }
  function pvpList(uid) {
    const open = q("SELECT * FROM pvp WHERE status = 'open' ORDER BY id DESC LIMIT 50").all().map((p) => ({
      id: p.id, bet: p.bet, mine: p.creator_id === uid, creator: name(p.creator_id), car: JSON.parse(p.snapshot), at: p.created_at,
    }));
    const history = q("SELECT * FROM pvp WHERE status = 'done' AND (creator_id = ? OR opponent_id = ?) ORDER BY finished_at DESC LIMIT 20").all(uid, uid).map((p) => {
      const mine = p.creator_id === uid;
      return { id: p.id, bet: p.bet, win: p.winner_id === uid, me: JSON.parse(mine ? p.snapshot : p.opp_snapshot), rival: { name: name(mine ? p.opponent_id : p.creator_id), car: JSON.parse(mine ? p.opp_snapshot : p.snapshot) }, result: JSON.parse(p.result), at: p.finished_at };
    });
    return { open, history };
  }
  function pvpCreate(uid, { carId, bet }) {
    const b = int(bet, S.PVP_MIN_BET, 1e13, 'Ставка');
    const c = ownCar(uid, carId);
    if (q("SELECT COUNT(*) n FROM pvp WHERE creator_id = ? AND status = 'open'").get(uid).n >= 3) fail('Максимум 3 відкриті виклики');
    pay(uid, b);
    const r = q('INSERT INTO pvp (creator_id, car_id, snapshot, bet, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, c.id, JSON.stringify(carOut(c)), b, now());
    return { id: Number(r.lastInsertRowid) };
  }
  function pvpCancel(uid, { id }) {
    const p = q("SELECT * FROM pvp WHERE id = ? AND status = 'open'").get(int(id, 1, 1e15));
    if (!p || p.creator_id !== uid) fail('Виклик не знайдено');
    q("UPDATE pvp SET status = 'cancelled' WHERE id = ?").run(p.id);
    addMoney(uid, p.bet);
    return {};
  }
  function pvpAccept(uid, { id, carId }) {
    const p = q("SELECT * FROM pvp WHERE id = ? AND status = 'open'").get(int(id, 1, 1e15));
    if (!p) fail('Виклик уже зайнятий або скасований');
    if (p.creator_id === uid) fail('Не можна гонитися з собою');
    const cc = carRow(p.car_id);
    if (!cc || cc.owner_id !== p.creator_id || cc.status !== 'garage') {
      q("UPDATE pvp SET status = 'cancelled' WHERE id = ?").run(p.id);
      addMoney(p.creator_id, p.bet);
      fail('Суперник уже не має цього авто — виклик скасовано');
    }
    const c = ownCar(uid, carId);
    pay(uid, p.bet);
    const a = autoRun(carOut(cc)), b = autoRun(carOut(c));
    const winner = a.time <= b.time ? p.creator_id : uid;
    const prize = Math.floor(p.bet * 2 * (1 - S.FEE));
    addMoney(winner, prize);
    const result = { creator: a, opponent: b, prize };
    soil(cc);
    soil(c);
    q("UPDATE pvp SET status = 'done', opponent_id = ?, opp_car_id = ?, opp_snapshot = ?, winner_id = ?, result = ?, finished_at = ? WHERE id = ?")
      .run(uid, c.id, JSON.stringify(carOut(c)), winner, JSON.stringify(result), now(), p.id);
    for (const who of [p.creator_id, uid]) {
      track(who, 'pvp');
      xp(who, 'pvp');
    }
    event(p.creator_id, winner === p.creator_id ? `🏁 Ти переміг ${name(uid)} у PvP! +${S.fmt(prize)}` : `🏁 ${name(uid)} обігнав тебе у PvP (ставка ${S.fmt(p.bet)})`);
    return { win: winner === uid, prize: winner === uid ? prize : 0, result, rival: { name: name(p.creator_id), car: JSON.parse(p.snapshot) } };
  }

  // ---------- live PvP: both players race at once ----------
  // open → pending (someone asked to race; the creator sees it on screen and has PVP_ANSWER_MS to accept)
  //      → live (shared start: lights from start_at, green at green_at) → done when both finished.
  // A creator who is offline or on "do not disturb" can't be asked — the other player races their autopilot instead.
  const PVP_ANSWER_MS = 25e3, PVP_LEAD_MS = 4000, PVP_RACE_MS = 45e3, PVP_ONLINE_MS = 40e3;
  function sweepPvp() {
    for (const p of q("SELECT * FROM pvp WHERE status = 'pending' AND req_at < ?").all(now() - PVP_ANSWER_MS)) releasePvp(p);
    for (const p of q("SELECT * FROM pvp WHERE status = 'live' AND green_at < ?").all(now() - PVP_RACE_MS)) settleLive(p);
  }
  // Back to the open list; the player who asked gets the bet back.
  function releasePvp(p) {
    addMoney(p.opponent_id, p.bet);
    q("UPDATE pvp SET status = 'open', opponent_id = NULL, opp_car_id = NULL, opp_snapshot = NULL, req_at = NULL WHERE id = ?").run(p.id);
  }
  const carOk = (carId, owner) => {
    const c = carRow(carId);
    return c && c.owner_id === owner && c.status === 'garage' ? c : null;
  };
  function pvpRequest(uid, { id, carId }) {
    sweepPvp();
    const p = q("SELECT * FROM pvp WHERE id = ? AND status = 'open'").get(int(id, 1, 1e15));
    if (!p) fail('Виклик уже зайнятий або скасований');
    if (p.creator_id === uid) fail('Не можна гонитися з собою');
    const c = ownCar(uid, carId);
    if (!carOk(p.car_id, p.creator_id)) {
      q("UPDATE pvp SET status = 'cancelled' WHERE id = ?").run(p.id);
      addMoney(p.creator_id, p.bet);
      fail('Суперник уже не має цього авто — виклик скасовано');
    }
    const host = userRow(p.creator_id);
    if (host.no_invites || !host.last_seen || host.last_seen < now() - PVP_ONLINE_MS) return { offline: true };
    pay(uid, p.bet);
    q("UPDATE pvp SET status = 'pending', opponent_id = ?, opp_car_id = ?, opp_snapshot = ?, req_at = ? WHERE id = ?").run(uid, c.id, JSON.stringify(carOut(c)), now(), p.id);
    return pvpOut(q('SELECT * FROM pvp WHERE id = ?').get(p.id), uid);
  }
  function pvpWithdraw(uid, { id }) {
    const p = q("SELECT * FROM pvp WHERE id = ? AND status = 'pending' AND opponent_id = ?").get(int(id, 1, 1e15), uid);
    if (p) releasePvp(p);
    return {};
  }
  function pvpAnswer(uid, { id, yes }) {
    sweepPvp();
    const p = q("SELECT * FROM pvp WHERE id = ? AND status = 'pending' AND creator_id = ?").get(int(id, 1, 1e15), uid);
    if (!p) fail('Запит на гонку вже неактуальний');
    if (!yes) {
      releasePvp(p);
      return { declined: true };
    }
    const cc = carOk(p.car_id, p.creator_id), oc = carOk(p.opp_car_id, p.opponent_id);
    if (!cc || !oc) {
      releasePvp(p);
      fail('Однієї з машин уже немає в гаражі');
    }
    soil(cc);
    soil(oc);
    const start = now() + PVP_LEAD_MS;
    // Same light sequence as a solo race: three ambers 0.6 s apart, then green at a random moment.
    const green = start + 2200 + Math.floor(rnd() * 1200);
    q("UPDATE pvp SET status = 'live', snapshot = ?, opp_snapshot = ?, start_at = ?, green_at = ?, c_u = 0, o_u = 0 WHERE id = ?")
      .run(JSON.stringify(carOut(cc)), JSON.stringify(carOut(oc)), start, green, p.id);
    return pvpOut(q('SELECT * FROM pvp WHERE id = ?').get(p.id), uid);
  }
  function pvpOf(uid, id) {
    const p = q('SELECT * FROM pvp WHERE id = ? AND (creator_id = ? OR opponent_id = ?)').get(int(id, 1, 1e15), uid, uid);
    if (!p) fail('Гонку не знайдено');
    return p;
  }
  function pvpOut(p, uid) {
    const mine = p.creator_id === uid;
    const side = (who) => {
      const isC = who === 'c';
      const run = p[isC ? 'c_run' : 'o_run'] ? JSON.parse(p[isC ? 'c_run' : 'o_run']) : null;
      return { name: name(isC ? p.creator_id : p.opponent_id), car: JSON.parse(isC ? p.snapshot : p.opp_snapshot || 'null'), u: p[isC ? 'c_u' : 'o_u'], done: !!run, run: p.status === 'done' ? run : null };
    };
    return {
      id: p.id, status: p.status, bet: p.bet, prize: Math.floor(p.bet * 2 * (1 - S.FEE)), startAt: p.start_at, greenAt: p.green_at,
      me: side(mine ? 'c' : 'o'), rival: side(mine ? 'o' : 'c'), win: p.status === 'done' ? p.winner_id === uid : null, now: now(),
    };
  }
  function pvpState(uid, { id }) {
    sweepPvp();
    const p = q('SELECT * FROM pvp WHERE id = ?').get(int(id, 1, 1e15));
    if (!p) fail('Гонку не знайдено');
    // The request was declined or expired: the challenge went back to the open list without this player.
    if (p.creator_id !== uid && p.opponent_id !== uid) return { id: p.id, status: 'released' };
    return pvpOut(p, uid);
  }
  function pvpProgress(uid, { id, u }) {
    const p = pvpOf(uid, id);
    if (p.status === 'live') q(`UPDATE pvp SET ${p.creator_id === uid ? 'c_u' : 'o_u'} = MAX(${p.creator_id === uid ? 'c_u' : 'o_u'}, ?) WHERE id = ?`).run(Math.max(0, Math.min(1, Number(u) || 0)), p.id);
    sweepPvp();
    return pvpOut(q('SELECT * FROM pvp WHERE id = ?').get(p.id), uid);
  }
  function pvpRun(stats, reaction, shifts) {
    let react = Number(reaction);
    if (!Number.isFinite(react)) react = 1.5;
    if (react >= 0) react = Math.min(react, 3);
    return { reaction: round3(react), shifts, time: S.raceTime(stats, react, shifts), jump: react < 0, perfectStart: S.perfectStartOf(react) };
  }
  function pvpFinish(uid, { id, ...body }) {
    const p = pvpOf(uid, id);
    if (p.status !== 'live') return pvpOut(p, uid);
    if (now() < p.start_at) fail('Гонка ще не почалася');
    const isC = p.creator_id === uid;
    if (!p[isC ? 'c_run' : 'o_run']) {
      // Same checks as a solo race, against the shared start: green at green_at, the clock from start_at.
      const { reaction, shifts, time, jump, perfectStart } = dragRun(JSON.parse(isC ? p.snapshot : p.opp_snapshot), p.green_at - p.start_at, body, now() - p.start_at);
      const run = { reaction, shifts, time, jump, perfectStart };
      q(`UPDATE pvp SET ${isC ? 'c_run' : 'o_run'} = ?, ${isC ? 'c_u' : 'o_u'} = 1 WHERE id = ?`).run(JSON.stringify(run), p.id);
    }
    const fresh = q('SELECT * FROM pvp WHERE id = ?').get(p.id);
    if (fresh.c_run && fresh.o_run) settleLive(fresh);
    return pvpOut(q('SELECT * FROM pvp WHERE id = ?').get(p.id), uid);
  }
  // Both finished, or time is up: whoever never finished (lost connection) is counted with a late start and late shifts.
  function settleLive(p) {
    const late = (snap) => pvpRun(JSON.parse(snap), 1.5, Array(S.SHIFTS).fill('late'));
    const a = p.c_run ? JSON.parse(p.c_run) : late(p.snapshot);
    const b = p.o_run ? JSON.parse(p.o_run) : late(p.opp_snapshot);
    const winner = a.time <= b.time ? p.creator_id : p.opponent_id;
    const prize = Math.floor(p.bet * 2 * (1 - S.FEE));
    addMoney(winner, prize);
    q("UPDATE pvp SET status = 'done', winner_id = ?, result = ?, c_run = ?, o_run = ?, c_u = 1, o_u = 1, finished_at = ? WHERE id = ?")
      .run(winner, JSON.stringify({ creator: a, opponent: b, prize, live: true }), JSON.stringify(a), JSON.stringify(b), now(), p.id);
    for (const who of [p.creator_id, p.opponent_id]) {
      track(who, 'pvp');
      xp(who, 'pvp');
    }
  }

  // ---------- market & auctions ----------
  // ---------- dealer: a bot that restocks the market every few hours (rules in S.DEALER) ----------
  const DEALER_ID = 0;
  const dealerPeriod = () => S.DEALER.hours * 3600e3;
  const dealerBatch = (t = now()) => Math.floor(t / dealerPeriod());
  const metaGet = (k) => q('SELECT value FROM meta WHERE key = ?').get(k)?.value;
  const metaSet = (k, v) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT DO UPDATE SET value = excluded.value').run(k, String(v));
  const sig3 = (n) => { const step = Math.pow(10, Math.max(3, Math.floor(Math.log10(n)) - 2)); return Math.round(n / step) * step; };
  function restockDealer(force = false) {
    const cur = dealerBatch();
    if (!force && Number(metaGet('dealer_batch') ?? -1) === cur) return;
    // Unsold lots of the previous batch disappear with their cars.
    for (const l of q('SELECT id, car_id FROM listings WHERE seller_id = ?').all(DEALER_ID)) {
      q('DELETE FROM listings WHERE id = ?').run(l.id);
      q('DELETE FROM cars WHERE id = ? AND owner_id = ?').run(l.car_id, DEALER_ID);
    }
    const classes = Object.entries(S.DEALER.classWeights);
    for (let i = 0; i < S.DEALER.lots; i++) {
      const cls = pickWeighted(classes, rnd());
      const model = pickModel(S.ALL_MODELS.filter((m) => m.cls === cls && !m.secret && !m.homeOnly), rnd());
      const [lo, hi] = rnd() < S.DEALER.dealChance ? S.DEALER.deal : S.DEALER.markup;
      const price = sig3(S.MODELS[model].price * (lo + rnd() * (hi - lo)));
      const carId = Number(q("INSERT INTO cars (owner_id, model, status, tank, tank_at, created_at, dirt_at) VALUES (?, ?, 'market', ?, ?, ?, ?)").run(DEALER_ID, model, S.CAR_TANK, now(), now(), now()).lastInsertRowid);
      q('INSERT INTO listings (seller_id, car_id, price, created_at) VALUES (?, ?, ?, ?)').run(DEALER_ID, carId, price, now());
    }
    metaSet('dealer_batch', cur);
    q('DELETE FROM dealer_buys WHERE batch < ?').run(cur);
  }
  const dealerBought = (uid) => q('SELECT n FROM dealer_buys WHERE batch = ? AND user_id = ?').get(dealerBatch(), uid)?.n || 0;
  function marketList(uid, { cls, sort } = {}) {
    restockDealer();
    let list = q('SELECT * FROM listings ORDER BY id DESC LIMIT 500').all().map((l) => ({
      id: l.id, price: l.price, mine: l.seller_id === uid, seller: name(l.seller_id), car: carOut(carRow(l.car_id)), at: l.created_at,
      dealer: l.seller_id === DEALER_ID,
    }));
    if (cls && S.CLASSES[cls]) list = list.filter((l) => S.MODELS[l.car.model].cls === cls);
    if (sort === 'cheap') list.sort((a, b) => a.price - b.price);
    else if (sort === 'expensive') list.sort((a, b) => b.price - a.price);
    else if (sort === 'deal') list.sort((a, b) => a.price / a.car.value - b.price / b.car.value);
    return { list, dealer: { nextAt: (dealerBatch() + 1) * dealerPeriod(), left: Math.max(0, S.DEALER.perPlayer - dealerBought(uid)), perPlayer: S.DEALER.perPlayer }, now: now() };
  }
  function marketSell(uid, { carId, price }) {
    const c = noSecret(ownCar(uid, carId));
    const p = int(price, 1000, 1e13, 'Ціна');
    if (q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status = 'garage'").get(uid).n <= 1) fail('Останню машину виставити не можна');
    if (q('SELECT COUNT(*) n FROM listings WHERE seller_id = ?').get(uid).n >= 20) fail('Максимум 20 лотів на ринку');
    bank(uid);
    q("UPDATE cars SET status = 'market' WHERE id = ?").run(c.id);
    q('INSERT INTO listings (seller_id, car_id, price, created_at) VALUES (?, ?, ?, ?)').run(uid, c.id, p, now());
    invalidateTrades([c.id]);
    return {};
  }
  function marketCancel(uid, { id }) {
    const l = q('SELECT * FROM listings WHERE id = ?').get(int(id, 1, 1e15));
    if (!l || l.seller_id !== uid) fail('Лот не знайдено');
    bank(uid);
    q("UPDATE cars SET status = 'garage' WHERE id = ?").run(l.car_id);
    q('DELETE FROM listings WHERE id = ?').run(l.id);
    return {};
  }
  function marketBuy(uid, { id }) {
    restockDealer();
    const l = q('SELECT * FROM listings WHERE id = ?').get(int(id, 1, 1e15));
    if (!l) fail('Лот уже продано');
    if (l.seller_id === uid) fail('Це твій лот');
    if (l.seller_id === DEALER_ID && dealerBought(uid) >= S.DEALER.perPlayer) fail(`У дилера можна купити ${S.DEALER.perPlayer} авто за одне оновлення — чекай нових лотів`);
    needSlots(uid, 1);
    pay(uid, l.price);
    bank(uid);
    if (l.seller_id === DEALER_ID) {
      // The dealer's money simply leaves the economy.
      transferCar(l.car_id, uid);
      q('DELETE FROM listings WHERE id = ?').run(l.id);
      q('INSERT INTO dealer_buys (batch, user_id, n) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1').run(dealerBatch(), uid);
      track(uid, 'market');
      xp(uid, 'market');
      return { car: carOut(carRow(l.car_id)) };
    }
    const got = Math.floor(l.price * (1 - S.FEE));
    bank(l.seller_id); // the lot stops counting against the seller's earning slots from now on
    addMoney(l.seller_id, got);
    transferCar(l.car_id, uid);
    q('DELETE FROM listings WHERE id = ?').run(l.id);
    for (const who of [uid, l.seller_id]) {
      track(who, 'market');
      xp(who, 'market');
    }
    recalc(l.seller_id);
    event(l.seller_id, `💰 ${name(uid)} купив твій ${S.MODELS[carRow(l.car_id).model].name} за ${S.fmt(l.price)}. Тобі +${S.fmt(got)}`);
    return { car: carOut(carRow(l.car_id)) };
  }
  const AUCTION_HOURS = [1, 6, 24];
  const minBid = (a) => (a.top_bid ? Math.ceil(a.top_bid * 1.05) : a.start_price);
  function auctionList(uid) {
    settleAuctions();
    const list = q("SELECT * FROM auctions WHERE status = 'open' ORDER BY ends_at LIMIT 200").all().map((a) => ({
      id: a.id, startPrice: a.start_price, topBid: a.top_bid, bids: a.bids, endsAt: a.ends_at,
      mine: a.seller_id === uid, leading: a.top_bidder === uid, seller: name(a.seller_id),
      leader: a.top_bidder ? name(a.top_bidder) : null, minBid: minBid(a), car: carOut(carRow(a.car_id)),
    }));
    return { list, now: now() };
  }
  function auctionCreate(uid, { carId, startPrice, hours }) {
    const c = noSecret(ownCar(uid, carId));
    const p = int(startPrice, 1000, 1e13, 'Стартова ціна');
    const h = int(hours, 1, 24, 'Тривалість');
    if (!AUCTION_HOURS.includes(h)) fail('Тривалість: 1, 6 або 24 години');
    if (q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status = 'garage'").get(uid).n <= 1) fail('Останню машину виставити не можна');
    if (q("SELECT COUNT(*) n FROM auctions WHERE seller_id = ? AND status = 'open'").get(uid).n >= 10) fail('Максимум 10 аукціонів');
    bank(uid);
    q("UPDATE cars SET status = 'auction' WHERE id = ?").run(c.id);
    q('INSERT INTO auctions (seller_id, car_id, start_price, ends_at, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, c.id, p, now() + h * 3600e3, now());
    invalidateTrades([c.id]);
    return {};
  }
  function auctionBid(uid, { id, amount }) {
    const a = q("SELECT * FROM auctions WHERE id = ? AND status = 'open'").get(int(id, 1, 1e15));
    if (!a || a.ends_at <= now()) fail('Аукціон завершено');
    if (a.seller_id === uid) fail('Не можна ставити на свій лот');
    const amt = int(amount, 1, 1e13, 'Ставка');
    if (amt < minBid(a)) fail(`Мінімальна ставка ${S.fmt(minBid(a))}`);
    if (a.top_bidder !== uid) needSlots(uid, 1);
    if (a.top_bidder) addMoney(a.top_bidder, a.top_bid);
    pay(uid, amt);
    const ends = a.ends_at - now() < 60e3 ? now() + 60e3 : a.ends_at;
    q('UPDATE auctions SET top_bid = ?, top_bidder = ?, bids = bids + 1, ends_at = ? WHERE id = ?').run(amt, uid, ends, a.id);
    if (a.top_bidder && a.top_bidder !== uid) event(a.top_bidder, `⚠️ Твою ставку на ${S.MODELS[carRow(a.car_id).model].name} перебили: ${S.fmt(amt)}. Гроші повернуто.`);
    return {};
  }
  function auctionCancel(uid, { id }) {
    const a = q("SELECT * FROM auctions WHERE id = ? AND status = 'open'").get(int(id, 1, 1e15));
    if (!a || a.seller_id !== uid) fail('Аукціон не знайдено');
    if (a.top_bidder) fail('Вже є ставки — скасувати не можна');
    bank(uid);
    q("UPDATE cars SET status = 'garage' WHERE id = ?").run(a.car_id);
    q("UPDATE auctions SET status = 'cancelled' WHERE id = ?").run(a.id);
    return {};
  }
  function settleAuctions() {
    const due = q("SELECT * FROM auctions WHERE status = 'open' AND ends_at <= ?").all(now());
    for (const a of due) {
      db.tx(() => {
        const model = S.MODELS[carRow(a.car_id).model].name;
        bank(a.seller_id);
        if (a.top_bidder) {
          bank(a.top_bidder);
          const got = Math.floor(a.top_bid * (1 - S.FEE));
          addMoney(a.seller_id, got);
          transferCar(a.car_id, a.top_bidder);
          track(a.seller_id, 'market');
          track(a.top_bidder, 'market');
          recalc(a.top_bidder);
          event(a.top_bidder, `🔨 Ти виграв аукціон: ${model} за ${S.fmt(a.top_bid)}!`);
          event(a.seller_id, `🔨 ${model} продано на аукціоні за ${S.fmt(a.top_bid)}. Тобі +${S.fmt(got)}`);
        } else {
          q("UPDATE cars SET status = 'garage' WHERE id = ?").run(a.car_id);
          event(a.seller_id, `🔨 Аукціон на ${model} завершився без ставок — авто повернулося в гараж`);
        }
        q("UPDATE auctions SET status = 'done' WHERE id = ?").run(a.id);
        recalc(a.seller_id);
      });
    }
    expireItemLots(); // the server's sweeper calls this every few seconds
    return due.length;
  }

  // ---------- market of parts and plates (S.ITEM_MARKET) ----------
  // A part lot takes its pieces off the warehouse, so a listed part can't be installed, merged or sold to the dealer —
  // it just isn't there. A plate stays in plates (it still counts in the garage value) and its lot locks it: attach,
  // sell to the dealer and listing again check plateLot(). Cancel, expiry, a ban or an admin removal give the item back.
  // Money: the buyer pays the price (destroyed), the seller gets price − fee (created), so the economy loses the fee.
  const IM = S.ITEM_MARKET;
  const plateLot = (plateId) => q('SELECT id FROM item_listings WHERE plate_id = ?').get(plateId) || null;
  const itemMaxLots = (uid) => (vipOf(uid) ? IM.vipLots : IM.lots);
  const itemName = (l) => (l.kind === 'part' ? `${S.partLabel(l.part_type, l.part_tier)}${l.count > 1 ? ` × ${l.count}` : ''}` : `номер ${q('SELECT text FROM plates WHERE id = ?').get(l.plate_id)?.text || ''}`);
  // Closes a lot without a sale: the part pieces go back to the warehouse (the plate never left its owner).
  function closeItemLot(l) {
    q('DELETE FROM item_listings WHERE id = ?').run(l.id);
    if (l.kind === 'part') addPart(l.seller_id, l.part_type, l.part_tier, l.count);
  }
  function expireItemLots() {
    const due = q('SELECT * FROM item_listings WHERE expires_at <= ? LIMIT 200').all(now());
    for (const l of due) {
      db.tx(() => {
        if (!q('SELECT 1 FROM item_listings WHERE id = ?').get(l.id)) return;
        closeItemLot(l);
        event(l.seller_id, `⌛ Лот «${itemName(l)}» ніхто не купив за ${IM.hours} год — ${l.kind === 'part' ? 'деталі повернулися на склад' : 'номер знову вільний'}`);
      });
    }
    return due.length;
  }
  // Samples for the reference price of one item_key: recent sales, plus the cheapest lot of every other seller (one per
  // seller, so nobody can drag the median up with a pile of overpriced lots of his own).
  function itemSamples(key) {
    const sales = q('SELECT price * 1.0 / (count * base) r FROM item_sales WHERE item_key = ? AND created_at >= ? AND base > 0 ORDER BY id DESC LIMIT ?')
      .all(key, now() - IM.refDays * 86400e3, IM.refSales).map((x) => x.r);
    const lots = q('SELECT seller_id s, MIN(price * 1.0 / (count * base)) r FROM item_listings WHERE item_key = ? AND base > 0 GROUP BY seller_id').all(key);
    return { sales, lots };
  }
  function itemOut(l, uid, samplesFor) {
    const unit = Math.round(l.price / l.count);
    const sm = samplesFor(l.item_key);
    const ratio = S.itemRefRatio([...sm.sales, ...sm.lots.filter((x) => x.s !== l.seller_id).map((x) => x.r)]);
    const ref = Math.round(ratio * l.base);
    const o = {
      id: l.id, kind: l.kind, price: l.price, count: l.count, unit, base: l.base, ref,
      deal: S.isItemDeal(unit, l.base, ratio), pct: ref ? Math.round((unit / ref - 1) * 100) : 0,
      mine: l.seller_id === uid, seller: name(l.seller_id), at: l.created_at, expiresAt: l.expires_at,
    };
    if (l.kind === 'part') o.part = { type: l.part_type, tier: l.part_tier };
    else o.plate = { id: l.plate_id, text: l.text, cls: l.pcls, value: l.value, label: S.plateInfo(l.text).label, region: S.regionOf(l.text) };
    return o;
  }
  function marketItems(uid, { kind, type, tier, cls, region, query, sort } = {}) {
    expireItemLots();
    const k = kind === 'plate' ? 'plate' : 'part';
    const cache = new Map();
    const samplesFor = (key) => cache.get(key) || (cache.set(key, itemSamples(key)), cache.get(key));
    const rows = q('SELECT l.*, p.text, p.cls pcls, p.value FROM item_listings l LEFT JOIN plates p ON p.id = l.plate_id WHERE l.kind = ? ORDER BY l.id DESC LIMIT 500').all(k);
    let list = rows;
    if (k === 'part') {
      if (S.PARTS[type] && Object.hasOwn(S.PARTS, type)) list = list.filter((l) => l.part_type === type);
      if (S.TIER_BY_ID[tier] && Object.hasOwn(S.TIER_BY_ID, tier)) list = list.filter((l) => l.part_tier === tier);
    } else {
      if (cls && S.PLATE_VALUE[cls] && Object.hasOwn(S.PLATE_VALUE, cls)) list = list.filter((l) => l.pcls === cls);
      // Region: its name from S.REGION_LIST (all of its codes) or a single code.
      const reg = String(region ?? '').trim();
      if (reg) list = list.filter((l) => S.regionOf(l.text) === reg || l.text.slice(0, 2) === reg.toUpperCase());
      // Search in the plate text: "7777", "ka 77", "АА" (Cyrillic look-alikes become Latin).
      const qs = S.normalizePlate(String(query ?? '').slice(0, 16)).replace(/ /g, '');
      if (qs) list = list.filter((l) => l.text.replace(/ /g, '').includes(qs));
    }
    let out = list.map((l) => itemOut(l, uid, samplesFor));
    if (sort === 'cheap') out.sort((a, b) => a.unit - b.unit);
    else if (sort === 'expensive') out.sort((a, b) => b.unit - a.unit);
    else if (sort === 'deal') out.sort((a, b) => a.unit / (a.ref || 1) - b.unit / (b.ref || 1));
    out = out.slice(0, 200);
    const mine = q('SELECT l.*, p.text, p.cls pcls, p.value FROM item_listings l LEFT JOIN plates p ON p.id = l.plate_id WHERE l.seller_id = ? ORDER BY l.id DESC').all(uid)
      .map((l) => itemOut(l, uid, samplesFor));
    return { list: out, mine, maxLots: itemMaxLots(uid), now: now() };
  }
  function marketItemSell(uid, { kind, type, tier, count, plateId, price, detach }) {
    expireItemLots();
    if (q('SELECT COUNT(*) n FROM item_listings WHERE seller_id = ?').get(uid).n >= itemMaxLots(uid)) fail(`Максимум ${itemMaxLots(uid)} лотів з деталями й номерами`);
    const p = int(price, 1, 1e13, 'Ціна');
    let lot;
    if (kind === 'part') {
      if (!Object.hasOwn(S.PARTS, String(type)) || !Object.hasOwn(S.TIER_BY_ID, String(tier))) fail('Невідома деталь');
      const n = int(count ?? 1, 1, IM.maxCount, 'Кількість');
      const inv = inventory(uid).find((x) => x.type === type && x.tier === tier);
      if (!inv || inv.available < n) fail(inv?.cooling ? `Вільних деталей ${inv.available}: щойно зняті з машини остигають і на ринок не йдуть` : 'Стільки таких деталей на складі немає');
      lot = { kind, n, base: S.TIER_BY_ID[tier].price, key: `part:${type}:${tier}` };
    } else if (kind === 'plate') {
      const pl = ownPlate(uid, plateId);
      if (plateLot(pl.id)) fail('Цей номер уже на ринку');
      if (pl.value < 1) fail('Цей номер не можна продати на ринку');
      lot = { kind, n: 1, base: pl.value, key: `plate:${pl.cls}`, plate: pl };
    } else fail('Невідомий тип лоту');
    const [lo, hi] = S.itemPriceRange(lot.base, lot.n);
    if (p < lo || p > hi) fail(`Ціна має бути від ${S.fmt(lo)} до ${S.fmt(hi)}`);
    if (lot.kind === 'part') {
      takePart(uid, type, tier, lot.n);
    } else if (lot.plate.car_id) {
      // A plate on a car: only with the player's consent (detach), and only from a car he can change right now.
      if (!detach) fail('Номер висить на машині — спочатку зніми його');
      const c = carRow(lot.plate.car_id);
      if (c.status !== 'garage' && c.status !== 'showcase') fail('Авто з цим номером на ринку — номер зняти не можна');
      bank(uid);
      q('UPDATE plates SET car_id = NULL WHERE id = ?').run(lot.plate.id);
      carChanged(c.id);
    }
    const r = q(`INSERT INTO item_listings (seller_id, kind, item_key, part_type, part_tier, plate_id, count, price, base, created_at, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uid, lot.kind, lot.key, lot.kind === 'part' ? type : null, lot.kind === 'part' ? tier : null, lot.plate?.id ?? null, lot.n, p, lot.base, now(), now() + IM.hours * 3600e3);
    return { id: Number(r.lastInsertRowid) };
  }
  function marketItemCancel(uid, { id }) {
    const l = q('SELECT * FROM item_listings WHERE id = ?').get(int(id, 1, 1e15));
    if (!l || l.seller_id !== uid) fail('Лот не знайдено');
    closeItemLot(l);
    return {};
  }
  function marketItemBuy(uid, { id }) {
    expireItemLots();
    const l = q('SELECT * FROM item_listings WHERE id = ?').get(int(id, 1, 1e15));
    // An expired lot is refused even if no sweep has closed it yet (a failed call rolls its own sweep back).
    if (!l || l.expires_at <= now()) fail('Лот уже продано або знято');
    if (l.seller_id === uid) fail('Це твій лот');
    let plate = null;
    if (l.kind === 'plate') {
      plate = q('SELECT * FROM plates WHERE id = ?').get(l.plate_id);
      if (!plate || plate.owner_id !== l.seller_id || plate.car_id) fail('Лот недоступний');
    }
    pay(uid, l.price);
    const got = Math.floor(l.price * (1 - S.FEE));
    addMoney(l.seller_id, got);
    q('DELETE FROM item_listings WHERE id = ?').run(l.id);
    if (l.kind === 'part') addPart(uid, l.part_type, l.part_tier, l.count);
    else q('UPDATE plates SET owner_id = ? WHERE id = ?').run(uid, plate.id);
    q(`INSERT INTO item_sales (kind, item_key, seller_id, buyer_id, part_type, part_tier, plate_text, count, price, fee, base, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(l.kind, l.item_key, l.seller_id, uid, l.part_type, l.part_tier, plate?.text ?? null, l.count, l.price, l.price - got, l.base, now());
    recalc(l.seller_id);
    const what = l.kind === 'part' ? `${S.partLabel(l.part_type, l.part_tier)}${l.count > 1 ? ` × ${l.count}` : ''}` : `номер ${plate.text}`;
    event(l.seller_id, `💰 ${name(uid)} купив твій лот «${what}» за ${S.fmt(l.price)}. Тобі +${S.fmt(got)}`);
    return l.kind === 'part' ? { part: { type: l.part_type, tier: l.part_tier, count: l.count } } : { plate: { id: plate.id, text: plate.text, cls: plate.cls, value: plate.value } };
  }

  // ---------- trades ----------
  function findPlayer(query) {
    const s = String(query ?? '').trim().replace(/^@/, '');
    if (!s) fail('Вкажи ID або @username гравця');
    const u = /^\d+$/.test(s) ? q('SELECT id FROM users WHERE id = ?').get(Number(s)) : q('SELECT id FROM users WHERE lower(username) = lower(?)').get(s);
    if (!u) fail('Гравця не знайдено — він має хоч раз відкрити гру');
    return u.id;
  }
  function player(uid, { query, id }) {
    const pid = id ? int(id, 1, Number.MAX_SAFE_INTEGER) : findPlayer(query);
    const u = userRow(pid);
    const cars = q("SELECT * FROM cars WHERE owner_id = ? AND status IN ('garage', 'showcase') ORDER BY id").all(pid).map(carOut);
    const best = [...cars].sort((a, b) => b.value - a.value)[0] || null;
    return {
      id: pid, name: name(pid), level: u.level, value: u.total_value, cars: cars.filter((c) => c.status === 'garage'),
      showcase: cars.filter((c) => c.status === 'showcase'), best, carCount: cars.length,
      collection: q('SELECT COUNT(*) n FROM collection WHERE user_id = ?').get(pid).n, self: pid === uid,
      vip: u.vip_until > now(), badges: badgesOf(pid),
      // Read-only extras for the player card: the three dearest cars, a few counters, the first-days badge.
      top: [...cars].sort((a, b) => b.value - a.value).slice(0, 3),
      stats: { cases: u.cases_opened, wins: u.wins, races: u.races }, legacy: isLegacy(pid),
    };
  }
  const isLegacy = (uid) => !!q('SELECT 1 FROM legacy WHERE id = ?').get(uid);
  function invalidateTrades(carIds) {
    if (!carIds.length) return;
    const rows = q(`SELECT DISTINCT t.id FROM trades t JOIN trade_items i ON i.trade_id = t.id WHERE t.status = 'open' AND i.car_id IN (${carIds.map(() => '?').join(',')})`).all(...carIds);
    for (const t of rows) q("UPDATE trades SET status = 'invalid', updated_at = ? WHERE id = ?").run(now(), t.id);
  }
  function tradeCreate(uid, { to, give, get, giveMoney, getMoney }) {
    const toId = findPlayer(to);
    if (toId === uid) fail('Не можна обмінюватися з собою');
    needFeatureOf(toId, 'trades');
    const g = idList(give, 10), r = idList(get, 10);
    const gm = int(giveMoney ?? 0, 0, 1e13, 'Сума'), rm = int(getMoney ?? 0, 0, 1e13, 'Сума');
    if (!g.length && !r.length) fail('Додай хоча б одне авто');
    for (const id of g) noSecret(ownCar(uid, id));
    for (const id of r) {
      const c = carRow(id);
      if (!c || c.owner_id !== toId || c.status !== 'garage') fail('Авто гравця недоступне');
      noSecret(c);
    }
    if (gm > userRow(uid).balance) fail('Недостатньо гривень для пропозиції');
    if (q("SELECT COUNT(*) n FROM trades WHERE from_id = ? AND status = 'open'").get(uid).n >= 10) fail('Максимум 10 відкритих пропозицій');
    const tid = Number(q('INSERT INTO trades (from_id, to_id, give_money, get_money, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, toId, gm, rm, now(), now()).lastInsertRowid);
    for (const id of g) q("INSERT INTO trade_items (trade_id, car_id, side) VALUES (?, ?, 'give')").run(tid, id);
    for (const id of r) q("INSERT INTO trade_items (trade_id, car_id, side) VALUES (?, ?, 'get')").run(tid, id);
    event(toId, `🔄 ${name(uid)} пропонує тобі обмін. Відкрий «Обміни», щоб переглянути.`);
    return { id: tid };
  }
  function tradeOut(t, uid) {
    const items = q('SELECT car_id, side FROM trade_items WHERE trade_id = ?').all(t.id);
    const cars = (side) => items.filter((i) => i.side === side).map((i) => carOut(carRow(i.car_id)) || { id: i.car_id, gone: true });
    return {
      id: t.id, status: t.status, incoming: t.to_id === uid,
      from: { id: t.from_id, name: name(t.from_id) }, to: { id: t.to_id, name: name(t.to_id) },
      give: cars('give'), get: cars('get'), giveMoney: t.give_money, getMoney: t.get_money, at: t.updated_at,
    };
  }
  function tradeList(uid) {
    const open = q("SELECT * FROM trades WHERE status = 'open' AND (from_id = ? OR to_id = ?) ORDER BY id DESC").all(uid, uid).map((t) => tradeOut(t, uid));
    const past = q("SELECT * FROM trades WHERE status <> 'open' AND (from_id = ? OR to_id = ?) ORDER BY updated_at DESC LIMIT 20").all(uid, uid).map((t) => tradeOut(t, uid));
    return { open, past };
  }
  function tradeAccept(uid, { id }) {
    const t = q("SELECT * FROM trades WHERE id = ? AND status = 'open'").get(int(id, 1, 1e15));
    if (!t || t.to_id !== uid) fail('Пропозицію не знайдено');
    const items = q('SELECT car_id, side FROM trade_items WHERE trade_id = ?').all(t.id);
    const give = items.filter((i) => i.side === 'give').map((i) => i.car_id);
    const get = items.filter((i) => i.side === 'get').map((i) => i.car_id);
    const ownsAll = (ids, owner) => ids.every((cid) => {
      const c = carRow(cid);
      return c && c.owner_id === owner && c.status === 'garage';
    });
    if (!ownsAll(give, t.from_id) || !ownsAll(get, uid) || userRow(t.from_id).balance < t.give_money) {
      q("UPDATE trades SET status = 'invalid', updated_at = ? WHERE id = ?").run(now(), t.id);
      return { stale: true, message: 'Обмін уже неактуальний: авто або гроші змінилися' };
    }
    if (userRow(uid).balance < t.get_money) fail('Недостатньо гривень для цього обміну');
    const left = (who, out) => q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status = 'garage'").get(who).n - out.length;
    if (left(uid, get) < 1 && !give.length) fail('Не можна віддати останню машину');
    if (left(t.from_id, give) < 1 && !get.length) fail('У гравця не залишиться жодної машини');
    if (garageCount(uid) - get.length + give.length > userRow(uid).slots) fail('Не вистачає місць у гаражі');
    if (garageCount(t.from_id) - give.length + get.length > userRow(t.from_id).slots) fail('У гравця не вистачає місць у гаражі');
    bank(uid);
    bank(t.from_id);
    for (const cid of give) transferCar(cid, uid);
    for (const cid of get) transferCar(cid, t.from_id);
    if (t.give_money) {
      pay(t.from_id, t.give_money);
      addMoney(uid, t.give_money);
    }
    if (t.get_money) {
      pay(uid, t.get_money);
      addMoney(t.from_id, t.get_money);
    }
    q("UPDATE trades SET status = 'done', updated_at = ? WHERE id = ?").run(now(), t.id);
    invalidateTrades([...give, ...get]);
    for (const who of [uid, t.from_id]) xp(who, 'trade');
    recalc(t.from_id);
    event(t.from_id, `✅ ${name(uid)} прийняв твій обмін!`);
    return {};
  }
  function tradeClose(uid, { id }, as) {
    const t = q("SELECT * FROM trades WHERE id = ? AND status = 'open'").get(int(id, 1, 1e15));
    if (!t || (as === 'declined' ? t.to_id : t.from_id) !== uid) fail('Пропозицію не знайдено');
    q('UPDATE trades SET status = ?, updated_at = ? WHERE id = ?').run(as, now(), t.id);
    if (as === 'declined') event(t.from_id, `❌ ${name(uid)} відхилив твій обмін`);
    return {};
  }

  // ---------- trade hall: live rooms anyone can join, with chat ----------
  // A room has a host and (once someone joins) a guest. Each side puts cars and money on the table; any change bumps
  // `version` and clears both "ready" flags. The swap happens when both are ready on the same version.
  const ONLINE_MS = 90e3, HOST_GONE_MS = 45e3, KICK_MS = 90e3, CLOSE_MS = 5 * 60e3;
  const chatText = (t) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  function chatOut(rows) {
    return rows.map((m) => ({ id: m.id, userId: m.user_id, name: m.user_id ? name(m.user_id) : null, text: m.text, at: m.created_at, system: !m.user_id }));
  }
  function postChat(uid, roomId, text) {
    const t = chatText(text);
    if (!t) fail('Порожнє повідомлення');
    const last = q('SELECT created_at FROM trade_chat WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(uid);
    if (last && now() - last.created_at < 1200) fail('Не так швидко');
    q('INSERT INTO trade_chat (room_id, user_id, text, created_at) VALUES (?, ?, ?, ?)').run(roomId, uid, t, now());
    return {};
  }
  const sysChat = (roomId, text) => q('INSERT INTO trade_chat (room_id, user_id, text, created_at) VALUES (?, 0, ?, ?)').run(roomId, text, now());
  function chatSince(roomId, since) {
    const s = since ? int(since, 0, Number.MAX_SAFE_INTEGER, 'ID') : 0;
    const rows = s ? q('SELECT * FROM trade_chat WHERE room_id = ? AND id > ? ORDER BY id LIMIT 100').all(roomId, s)
      : q('SELECT * FROM (SELECT * FROM trade_chat WHERE room_id = ? ORDER BY id DESC LIMIT 50) ORDER BY id').all(roomId);
    return chatOut(rows);
  }
  const myRoom = (uid) => q("SELECT * FROM trade_rooms WHERE status IN ('open', 'active') AND (host_id = ? OR guest_id = ?) ORDER BY id DESC LIMIT 1").get(uid, uid);
  function roomOf(uid, id) {
    const r = q('SELECT * FROM trade_rooms WHERE id = ?').get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID кімнати'));
    if (!r || (r.host_id !== uid && r.guest_id !== uid)) fail('Ти не в цій кімнаті');
    return r;
  }
  function bump(roomId) {
    q('UPDATE trade_rooms SET version = version + 1, host_ready = 0, guest_ready = 0, updated_at = ? WHERE id = ?').run(now(), roomId);
  }
  function dropGuest(r, why) {
    q('DELETE FROM trade_room_items WHERE room_id = ? AND user_id = ?').run(r.id, r.guest_id);
    q("UPDATE trade_rooms SET guest_id = NULL, guest_seen = NULL, guest_money = 0, status = 'open' WHERE id = ?").run(r.id);
    bump(r.id);
    sysChat(r.id, `${name(r.guest_id)} ${why}`);
  }
  // Rooms whose players went quiet are tidied lazily, whenever someone looks at the hall or a room.
  function sweepRooms() {
    for (const r of q("SELECT * FROM trade_rooms WHERE status IN ('open', 'active') AND host_seen < ?").all(now() - CLOSE_MS)) {
      q("UPDATE trade_rooms SET status = 'closed', updated_at = ? WHERE id = ?").run(now(), r.id);
    }
    for (const r of q("SELECT * FROM trade_rooms WHERE status = 'active' AND guest_seen < ?").all(now() - KICK_MS)) dropGuest(r, 'вийшов (немає зв’язку)');
  }
  const brief = (uid) => {
    const u = q('SELECT id, level, total_value FROM users WHERE id = ?').get(uid);
    return u ? { id: u.id, name: name(u.id), level: u.level, value: u.total_value } : null;
  };
  function hall(uid, { since }) {
    sweepRooms();
    const rooms = q("SELECT * FROM trade_rooms WHERE status = 'open' AND host_seen > ? ORDER BY id DESC LIMIT 50").all(now() - HOST_GONE_MS).map((r) => ({
      id: r.id, host: brief(r.host_id), note: r.note, mine: r.host_id === uid, invited: r.invited_id === uid,
      cars: q('SELECT car_id FROM trade_room_items WHERE room_id = ? AND user_id = ? LIMIT 3').all(r.id, r.host_id).map((i) => carRow(i.car_id)?.model).filter(Boolean),
    }));
    const online = q('SELECT id FROM users WHERE last_seen > ? AND id <> ? AND banned = 0 ORDER BY last_seen DESC LIMIT 60').all(now() - ONLINE_MS, uid).map((u) => brief(u.id));
    const mine = myRoom(uid);
    return { rooms, online, chat: chatSince(0, since), myRoom: mine ? mine.id : null };
  }
  function roomCreate(uid, { note }) {
    const cur = myRoom(uid);
    if (cur) return { id: cur.id };
    const t = now();
    const r = q('INSERT INTO trade_rooms (host_id, note, host_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(uid, chatText(note).slice(0, 60) || null, t, t, t);
    return { id: Number(r.lastInsertRowid) };
  }
  function roomJoin(uid, { id }) {
    const r = q('SELECT * FROM trade_rooms WHERE id = ?').get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID кімнати'));
    if (r && (r.host_id === uid || r.guest_id === uid) && r.status !== 'closed' && r.status !== 'done') return { id: r.id };
    if (!r || r.status !== 'open' || r.host_seen < now() - HOST_GONE_MS) fail('Кімната вже недоступна');
    const cur = myRoom(uid);
    if (cur) fail('Спочатку вийди зі своєї кімнати обміну');
    q("UPDATE trade_rooms SET guest_id = ?, guest_seen = ?, status = 'active', invited_id = NULL WHERE id = ?").run(uid, now(), r.id);
    bump(r.id);
    sysChat(r.id, `${name(uid)} зайшов у кімнату`);
    event(r.host_id, `🔄 ${name(uid)} зайшов у твою кімнату обміну`);
    return { id: r.id };
  }
  // Invites pop up on the other player's screen, so they are limited: nobody can invite a player who switched on
  // "do not disturb", and one sender gets at most INVITES_PER_MIN a minute and one invite per player per 30 s.
  const INVITES_PER_MIN = 5, INVITE_REPEAT_MS = 30e3;
  function checkInvite(from, to) {
    if (userRow(to).no_invites) fail('Гравець не приймає запрошень');
    const t = now();
    q('DELETE FROM invite_log WHERE at < ?').run(t - 60e3);
    if (q('SELECT 1 FROM invite_log WHERE from_id = ? AND to_id = ? AND at > ?').get(from, to, t - INVITE_REPEAT_MS)) fail('Ти вже запросив цього гравця — зачекай трохи');
    if (q('SELECT COUNT(*) n FROM invite_log WHERE from_id = ?').get(from).n >= INVITES_PER_MIN) fail('Забагато запрошень — зачекай хвилину');
    q('INSERT INTO invite_log (from_id, to_id, at) VALUES (?, ?, ?)').run(from, to, t);
  }
  function setNoInvites(uid, { on }) {
    q('UPDATE users SET no_invites = ? WHERE id = ?').run(on ? 1 : 0, uid);
    if (on) q("UPDATE trade_rooms SET invited_id = NULL WHERE invited_id = ? AND status = 'open'").run(uid);
    return { noInvites: !!on };
  }
  // ---------- bot reminders (src/reminders.js applies the limits) ----------
  function setPushOn(uid, { on }) {
    q('UPDATE users SET push_off = ? WHERE id = ?').run(on ? 0 : 1, uid);
    return { pushOn: !!on };
  }
  // Players who may get a reminder now, each with what is ready and when it became ready.
  function pushCandidates(rules) {
    const t = now(), day = dayOf(t);
    const evStarted = S.activeEvents(t, evOv).filter((e) => t - e.start <= EVENT_PUSH_H * 3600e3).sort((a, b) => b.start - a.start);
    const rows = q(`SELECT * FROM users WHERE push_off = 0 AND push_blocked = 0 AND banned = 0 AND last_seen BETWEEN ? AND ?
      AND NOT (push_day = ? AND push_count >= ?)`).all(t - rules.inactiveDays * 86400e3, t - rules.idleMin * 60e3, day, rules.maxPerDay);
    return rows.map((u) => {
      const ready = [];
      if (u.streak_day !== day) {
        const next = ((u.streak % S.DAILY_BONUS.length) + 1);
        ready.push({ kind: 'daily', at: t, text: `🎁 Щоденний бонус чекає — день ${next}` });
      }
      const inc = incomeState(u);
      const cap = inc.rate * inc.capH;
      if (inc.rate > 0 && inc.pending >= Math.floor(cap) - 1) {
        const at = u.income_at + Math.max(0, (cap - u.banked) / inc.rate) * 3600e3;
        ready.push({ kind: 'income', at, text: `💰 Гараж заповнений: ${S.short(inc.pending)} чекає, далі дохід не росте` });
      }
      const rcAt = u.reward_case_at + S.REWARD_CASE_HOURS * 3600e3;
      if (rcAt <= t) ready.push({ kind: 'rcase', at: rcAt, text: '📦 Кейс нагород готовий' });
      const fs = fuelState(u);
      if (fs.fuel >= S.FUEL_MAX) ready.push({ kind: 'fuel', at: fs.fullAt, text: '⛽ Бак повний — час на заїзд' });
      // A game event began (one message per event, only in its first EVENT_PUSH_H hours).
      for (const e of evStarted.slice(0, 1)) ready.push({ kind: 'event', at: e.start, text: `🎉 Почалася подія «${S.eventInfo(e).title}»: ${S.EVENTS[e.id].text}` });
      const si = seasonInfo(u);
      if (si.xp > 0 && si.endsAt > t && si.endsAt - t <= rules.seasonWarnH * 3600e3) {
        const h = Math.max(1, Math.round((si.endsAt - t) / 3600e3));
        ready.push({ kind: 'season', at: si.endsAt - rules.seasonWarnH * 3600e3, text: `🏁 Сезон закінчується за ${h} год${si.ready ? ` — забери нагороди пропуску (${si.ready})` : ''}` });
      }
      let sent = {};
      try {
        sent = JSON.parse(u.push_sent || '{}') || {};
      } catch {}
      return { uid: u.id, lastSeen: u.last_seen, pushOff: !!u.push_off, blocked: !!u.push_blocked, pushDay: u.push_day, pushCount: u.push_count, pushLast: u.push_last, sent, ready };
    }).filter((c) => c.ready.length);
  }
  function pushMark(uid, kinds, t) {
    const u = q('SELECT push_day, push_count, push_sent FROM users WHERE id = ?').get(uid);
    if (!u) return;
    let sent = {};
    try {
      sent = JSON.parse(u.push_sent || '{}') || {};
    } catch {}
    for (const k of kinds) sent[k] = t;
    const day = dayOf(t);
    q('UPDATE users SET push_day = ?, push_count = ?, push_last = ?, push_sent = ? WHERE id = ?').run(day, (u.push_day === day ? u.push_count : 0) + 1, t, JSON.stringify(sent), uid);
  }
  const push = {
    candidates: (rules) => pushCandidates(rules),
    mark: (uid, kinds, t) => db.tx(() => pushMark(uid, kinds, t)),
    // Telegram answered 403: the bot is blocked (or the chat was never started) — nothing more goes to this player.
    block: (uid) => q('UPDATE users SET push_blocked = 1 WHERE id = ?').run(uid),
    isBlocked: (uid) => !!q('SELECT push_blocked FROM users WHERE id = ?').get(uid)?.push_blocked,
    isOff: (uid) => !!q('SELECT push_off FROM users WHERE id = ?').get(uid)?.push_off,
    // The player wrote to the bot, so it can write back.
    unblock: (uid) => q('UPDATE users SET push_blocked = 0 WHERE id = ? AND push_blocked = 1').run(uid),
    // /stop and /start in the bot. Returns false when the player is unknown.
    set: (uid, on) => q('UPDATE users SET push_off = ?, push_blocked = 0 WHERE id = ?').run(on ? 0 : 1, uid).changes > 0,
  };
  function roomInvite(uid, { to }) {
    const toId = int(to, 1, Number.MAX_SAFE_INTEGER, 'ID');
    if (toId === uid) fail('Не можна запросити себе');
    userRow(toId);
    needFeatureOf(toId, 'trades');
    checkInvite(uid, toId);
    const { id } = roomCreate(uid, {});
    const r = q('SELECT * FROM trade_rooms WHERE id = ?').get(id);
    if (r.host_id !== uid || r.status !== 'open') fail('У кімнаті вже є партнер');
    q('UPDATE trade_rooms SET invited_id = ? WHERE id = ?').run(toId, id);
    event(toId, `🔄 ${name(uid)} запрошує тебе обмінятися! Відкрий «Меню → Обміни».`);
    return { id };
  }
  function roomDecline(uid, { id }) {
    const r = q("SELECT * FROM trade_rooms WHERE id = ? AND invited_id = ? AND status = 'open'").get(int(id, 1, Number.MAX_SAFE_INTEGER), uid);
    if (r) {
      q('UPDATE trade_rooms SET invited_id = NULL WHERE id = ?').run(r.id);
      sysChat(r.id, `${name(uid)} відхилив запрошення`);
    }
    return {};
  }
  function sideOut(r, who) {
    if (!who) return null;
    const money = who === r.host_id ? r.host_money : r.guest_money;
    const cars = q('SELECT car_id FROM trade_room_items WHERE room_id = ? AND user_id = ?').all(r.id, who).map((i) => {
      const c = carRow(i.car_id);
      return c && c.owner_id === who ? { ...carOut(c), ok: c.status === 'garage' } : { id: i.car_id, gone: true };
    });
    return { ...brief(who), money, cars, ready: !!(who === r.host_id ? r.host_ready : r.guest_ready) };
  }
  function roomState(uid, { id, since }) {
    sweepRooms();
    let r = roomOf(uid, id);
    if (r.status === 'open' || r.status === 'active') {
      q(`UPDATE trade_rooms SET ${r.host_id === uid ? 'host_seen' : 'guest_seen'} = ? WHERE id = ?`).run(now(), r.id);
      r = q('SELECT * FROM trade_rooms WHERE id = ?').get(r.id);
    }
    const other = r.host_id === uid ? r.guest_id : r.host_id;
    return {
      id: r.id, status: r.status, version: r.version, host: r.host_id === uid, note: r.note,
      me: sideOut(r, uid), partner: other ? sideOut(r, other) : null, chat: chatSince(r.id, since),
    };
  }
  function roomLive(uid, id) {
    const r = roomOf(uid, id);
    if (r.status !== 'open' && r.status !== 'active') fail('Кімнату закрито');
    return r;
  }
  function roomOffer(uid, { id, add, remove, money }) {
    const r = roomLive(uid, id);
    if (add != null) {
      const c = noSecret(ownCar(uid, add));
      if (q('SELECT 1 FROM trade_room_items WHERE room_id = ? AND car_id = ?').get(r.id, c.id)) fail('Авто вже в обміні');
      if (q('SELECT COUNT(*) n FROM trade_room_items WHERE room_id = ? AND user_id = ?').get(r.id, uid).n >= 10) fail('Максимум 10 авто');
      q('INSERT INTO trade_room_items (room_id, user_id, car_id) VALUES (?, ?, ?)').run(r.id, uid, c.id);
    }
    if (remove != null) q('DELETE FROM trade_room_items WHERE room_id = ? AND user_id = ? AND car_id = ?').run(r.id, uid, int(remove, 1, Number.MAX_SAFE_INTEGER, 'ID авто'));
    if (money != null) {
      const m = int(money, 0, 1e13, 'Сума');
      if (m > userRow(uid).balance) fail('Недостатньо гривень');
      q(`UPDATE trade_rooms SET ${r.host_id === uid ? 'host_money' : 'guest_money'} = ? WHERE id = ?`).run(m, r.id);
    }
    bump(r.id);
    return {};
  }
  function roomReady(uid, { id, version, ready }) {
    let r = roomLive(uid, id);
    if (r.status !== 'active') fail('Чекаємо на другого гравця');
    if (int(version, 1, Number.MAX_SAFE_INTEGER, 'Версія') !== r.version) fail('Пропозиція щойно змінилась — перевір її ще раз');
    q(`UPDATE trade_rooms SET ${r.host_id === uid ? 'host_ready' : 'guest_ready'} = ? WHERE id = ?`).run(ready ? 1 : 0, r.id);
    r = q('SELECT * FROM trade_rooms WHERE id = ?').get(r.id);
    if (!r.host_ready || !r.guest_ready) return { done: false };
    return roomExecute(r);
  }
  function roomExecute(r) {
    const items = q('SELECT user_id, car_id FROM trade_room_items WHERE room_id = ?').all(r.id);
    const hostCars = items.filter((i) => i.user_id === r.host_id).map((i) => i.car_id);
    const guestCars = items.filter((i) => i.user_id === r.guest_id).map((i) => i.car_id);
    const stale = (msg) => {
      bump(r.id);
      sysChat(r.id, `⚠️ ${msg}`);
      return { done: false, stale: true, message: msg };
    };
    const bad = items.filter((i) => {
      const c = carRow(i.car_id);
      return !c || c.owner_id !== i.user_id || c.status !== 'garage';
    });
    if (bad.length) {
      for (const i of bad) q('DELETE FROM trade_room_items WHERE room_id = ? AND car_id = ?').run(r.id, i.car_id);
      return stale('Деяких авто вже немає в гаражі — їх прибрано з обміну');
    }
    if (!hostCars.length && !guestCars.length && !r.host_money && !r.guest_money) return stale('Обмін порожній — додайте авто або гривні');
    if (userRow(r.host_id).balance < r.host_money) return stale(`${name(r.host_id)}: не вистачає гривень`);
    if (userRow(r.guest_id).balance < r.guest_money) return stale(`${name(r.guest_id)}: не вистачає гривень`);
    const garageLeft = (who, out) => q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status = 'garage'").get(who).n - out.length;
    if (garageLeft(r.host_id, hostCars) < 1 && !guestCars.length) return stale(`${name(r.host_id)}: не можна віддати останню машину`);
    if (garageLeft(r.guest_id, guestCars) < 1 && !hostCars.length) return stale(`${name(r.guest_id)}: не можна віддати останню машину`);
    if (garageCount(r.host_id) - hostCars.length + guestCars.length > userRow(r.host_id).slots) return stale(`${name(r.host_id)}: не вистачає місць у гаражі`);
    if (garageCount(r.guest_id) - guestCars.length + hostCars.length > userRow(r.guest_id).slots) return stale(`${name(r.guest_id)}: не вистачає місць у гаражі`);
    bank(r.host_id);
    bank(r.guest_id);
    for (const cid of hostCars) transferCar(cid, r.guest_id);
    for (const cid of guestCars) transferCar(cid, r.host_id);
    if (r.host_money) {
      pay(r.host_id, r.host_money);
      addMoney(r.guest_id, r.host_money);
    }
    if (r.guest_money) {
      pay(r.guest_id, r.guest_money);
      addMoney(r.host_id, r.guest_money);
    }
    q("UPDATE trade_rooms SET status = 'done', updated_at = ? WHERE id = ?").run(now(), r.id);
    invalidateTrades([...hostCars, ...guestCars]);
    sysChat(r.id, '✅ Обмін завершено!');
    for (const who of [r.host_id, r.guest_id]) {
      xp(who, 'trade');
      recalc(who);
    }
    return { done: true };
  }
  function roomLeave(uid, { id }) {
    const r = roomOf(uid, id);
    if (r.status !== 'open' && r.status !== 'active') return {};
    if (r.host_id === uid) {
      q("UPDATE trade_rooms SET status = 'closed', updated_at = ? WHERE id = ?").run(now(), r.id);
      sysChat(r.id, `${name(uid)} закрив кімнату`);
    } else dropGuest(r, 'вийшов з кімнати');
    return {};
  }

  // ---------- case battles ----------
  // The creator pays for N cases and waits; whoever joins pays the same. Both open N cases at once (each with their own
  // provably fair seed); the higher total model value takes every car, the other gets a cheap consolation car.
  // The loser's consolation car never goes over the limit (sold at once instead). The winner's prizes may push the
  // garage over its limit: the player then picks which cars to sell (the result screen offers it),
  // and until then no new cases can be opened and only the best cars within the limit earn income.
  const BATTLE_COUNTS = [1, 3, 6, 10];
  const CONSOLATION = S.ALL_MODELS.filter((m) => m.cls === 'D' && !m.secret);
  const giveCars = (uid, models, origin = null) => models.map((m) => ({ id: giveCar(uid, m, origin).id, model: m }));
  function battleOut(b, uid) {
    return {
      id: b.id, caseId: b.case_id, count: b.count, price: b.price, status: b.status, mine: b.creator_id === uid,
      creator: brief(b.creator_id), opponent: b.opponent_id ? brief(b.opponent_id) : null, winnerId: b.winner_id,
      result: b.result ? JSON.parse(b.result) : null, createdAt: b.created_at, finishedAt: b.finished_at,
      me: uid === b.creator_id || uid === b.opponent_id,
    };
  }
  function battleList(uid) {
    return {
      open: q("SELECT * FROM battles WHERE status = 'open' ORDER BY id DESC LIMIT 50").all().map((b) => battleOut(b, uid)),
      recent: q("SELECT * FROM battles WHERE status = 'done' ORDER BY finished_at DESC LIMIT 15").all().map((b) => battleOut(b, uid)),
      mine: q("SELECT * FROM battles WHERE status = 'done' AND (creator_id = ? OR opponent_id = ?) ORDER BY finished_at DESC LIMIT 10").all(uid, uid).map((b) => battleOut(b, uid)),
    };
  }
  function battleCreate(uid, { caseId, count }) {
    const cs = S.CASE_BY_ID[caseId];
    if (!cs || cs.starter) fail('Обери кейс');
    const n = int(count, 1, 10, 'Кількість');
    if (!BATTLE_COUNTS.includes(n)) fail(`Кейсів у батлі: ${BATTLE_COUNTS.join(', ')}`);
    if (q("SELECT COUNT(*) n FROM battles WHERE creator_id = ? AND status = 'open'").get(uid).n >= 3) fail('Максимум 3 відкриті батли');
    pay(uid, cs.price * n);
    const r = q('INSERT INTO battles (creator_id, case_id, count, price, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, cs.id, n, cs.price * n, now());
    return { id: Number(r.lastInsertRowid) };
  }
  function battleCancel(uid, { id }) {
    const b = q("SELECT * FROM battles WHERE id = ? AND status = 'open'").get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID'));
    if (!b || b.creator_id !== uid) fail('Батл не знайдено або вже почався');
    q("UPDATE battles SET status = 'cancelled', finished_at = ? WHERE id = ?").run(now(), b.id);
    addMoney(uid, b.price);
    return {};
  }
  function battleJoin(uid, { id }) {
    const b = q("SELECT * FROM battles WHERE id = ? AND status = 'open'").get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID'));
    if (!b) fail('Батл уже почався або скасований');
    if (b.creator_id === uid) fail('Це твій батл — чекай суперника');
    const cs = S.CASE_BY_ID[b.case_id];
    pay(uid, b.price);
    const side = (who) => {
      const drops = Array.from({ length: b.count }, () => rollCase(who, cs)).map((d) => ({ model: d.model, cls: d.cls, value: S.MODELS[d.model].price }));
      countOpens(who, b.count);
      return { id: who, drops, total: drops.reduce((s, d) => s + d.value, 0) };
    };
    const a = side(b.creator_id), o = side(uid);
    for (const who of [a.id, o.id]) bank(who);
    let winner = null, loser = null, consolation = null, prize = [];
    if (a.total !== o.total) {
      [winner, loser] = a.total > o.total ? [a, o] : [o, a];
      // Ids line up with creator drops first, then opponent drops, so the result screen can offer "sell" per card.
      prize = giveCars(winner.id, [...a.drops, ...o.drops].map((d) => d.model), cs.id);
      const model = CONSOLATION[Math.floor(rnd() * CONSOLATION.length)].id;
      // The consolation car never pushes the loser's garage over its limit: with no free slot it is sold at once
      // (the result screen says "Гараж повний — продано за …").
      const lu = q('SELECT slots FROM users WHERE id = ?').get(loser.id);
      if (garageCount(loser.id) < lu.slots) consolation = { model, ...giveCars(loser.id, [model])[0] };
      else {
        const soldFor = S.sellPriceOf(model);
        addMoney(loser.id, soldFor);
        consolation = { model, soldFor };
      }
    } else {
      // A dead heat: everyone keeps what they opened.
      a.cars = giveCars(a.id, a.drops.map((d) => d.model), cs.id);
      o.cars = giveCars(o.id, o.drops.map((d) => d.model), cs.id);
    }
    const result = { creator: a, opponent: o, consolation, prize };
    q("UPDATE battles SET opponent_id = ?, status = 'done', winner_id = ?, result = ?, finished_at = ? WHERE id = ?")
      .run(uid, winner?.id ?? null, JSON.stringify(result), now(), b.id);
    for (const who of [a.id, o.id]) recalc(who);
    const total = a.total + o.total;
    event(b.creator_id, !winner ? `⚔️ Батл з ${name(uid)} — нічия, кожен забрав свої авто`
      : winner.id === b.creator_id ? `⚔️ Ти виграв батл у ${name(uid)}! Усі ${b.count * 2} авто на ${S.fmt(total)} — твої`
        : `⚔️ ${name(uid)} виграв твій батл (${S.short(o.total)} проти ${S.short(a.total)}). ${consolation.soldFor ? `Утішну машину продано за ${S.short(consolation.soldFor)} — гараж повний` : 'Тобі — утішна машина'}`);
    return battleOut(q('SELECT * FROM battles WHERE id = ?').get(b.id), uid);
  }
  function battleGet(uid, { id }) {
    const b = q('SELECT * FROM battles WHERE id = ?').get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID'));
    if (!b) fail('Батл не знайдено');
    return battleOut(b, uid);
  }

  // ---------- rewards ----------
  function rewards(uid) {
    const u = userRow(uid);
    const day = dayOf(now());
    // A missed day loses nothing: the next claim continues the series (14 days, then from day 1 again).
    const next = u.streak_day === day ? u.streak : u.streak + 1;
    const len = S.DAILY_BONUS.length;
    return { streak: u.streak, ready: u.streak_day !== day, nextDay: ((next - 1) % len) + 1, todayIndex: ((u.streak_day === day ? u.streak : next) - 1) % len, rewardCaseAt: u.reward_case_at + S.REWARD_CASE_HOURS * 3600e3, days: S.DAILY_BONUS, vip: (u.vip_until || 0) > now(), vipDaily: S.VIP.daily };
  }
  const partPool = (uid) => S.partPoolFor(q('SELECT DISTINCT model FROM cars WHERE owner_id = ?').all(uid).map((r) => r.model));
  function randomPartOf(tier, uid) {
    const pool = uid ? partPool(uid) : S.PART_KEYS;
    return { type: pool[Math.floor(rnd() * pool.length)], tier };
  }
  function grant(uid, rw) {
    const got = { ...rw };
    if (rw.car || rw.seasonCar || rw.slots) bank(uid); // a new car (or slot) earns from now on, not for the hours before
    if (rw.money) addMoney(uid, rw.money);
    if (rw.parts) {
      got.items = Array.from({ length: rw.parts }, () => randomPartOf(rw.tier, uid));
      for (const p of got.items) addPart(uid, p.type, p.tier);
    }
    if (rw.car) {
      const list = S.ALL_MODELS.filter((m) => m.cls === rw.car && !m.secret);
      const { id, isNew } = giveCar(uid, pickModel(list, rnd()));
      got.carOut = carOut(carRow(id));
      got.isNew = isNew;
    }
    if (rw.caseId) addKeys(uid, rw.caseId, rw.count || 1);
    if (rw.fuel) q('UPDATE users SET fuel = ?, fuel_at = ? WHERE id = ?').run(S.FUEL_MAX, now(), uid);
    if (rw.slots) q('UPDATE users SET slots = MIN(?, slots + ?) WHERE id = ?').run(S.MAX_SLOTS, rw.slots, uid);
    if (rw.seasonCar) {
      // Like a secret car it never pushes the garage over its limit: no room → it goes to the showcase.
      const { id } = giveCar(uid, rw.seasonCar);
      if (garageCount(uid) > userRow(uid).slots) q("UPDATE cars SET status = 'showcase' WHERE id = ?").run(id);
      got.carOut = carOut(carRow(id));
    }
    if (rw.cosmetic) grantCosmetic(uid, rw.cosmetic);
    return got;
  }
  // A season cosmetic (S.cosmeticOf): owned once (a claim); the badge also goes to the profile.
  function grantCosmetic(uid, id) {
    const cos = S.cosmeticOf(id);
    if (!cos) return;
    q('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(uid, cos.id);
    if (cos.kind === 'badge') q('INSERT OR IGNORE INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, ?, ?, 1, NULL, NULL, ?)').run(uid, cos.id, `Сезон ${cos.season} · пропуск`, now());
  }
  function dailyClaim(uid) {
    const u = userRow(uid);
    const day = dayOf(now());
    if (u.streak_day === day) fail('Сьогодні вже забрано — повертайся завтра');
    const streak = u.streak + 1;
    const rw = S.DAILY_BONUS[(streak - 1) % S.DAILY_BONUS.length];
    q('UPDATE users SET streak = ?, streak_day = ? WHERE id = ?').run(streak, day, uid);
    const got = grant(uid, rw);
    if ((u.vip_until || 0) > now()) {
      addMoney(uid, S.VIP.daily);
      got.vip = S.VIP.daily;
    }
    xp(uid, 'daily');
    return { streak, reward: got };
  }
  function rewardCase(uid) {
    const u = userRow(uid);
    if (now() < u.reward_case_at + S.REWARD_CASE_HOURS * 3600e3) fail('Кейс нагород ще не готовий');
    q('UPDATE users SET reward_case_at = ? WHERE id = ?').run(now(), uid);
    const x = rnd(), o = S.REWARD_CASE_ODDS;
    let rw;
    if (x < o.money) rw = { money: Math.round((5000 + rnd() * 20000) * u.level / 1000) * 1000 };
    else if (x < o.money + o.part) rw = { parts: 1, tier: rnd() < 0.7 ? 'stock' : 'street' };
    else if (x < o.money + o.part + o.fuel) rw = { fuel: true };
    else {
      if (garageCount(uid) >= u.slots) rw = { money: 50000 * u.level };
      else rw = { car: rnd() < 0.85 ? 'D' : 'C' };
    }
    return { reward: grant(uid, rw) };
  }
  function newbieClaim(uid) {
    const u = userRow(uid);
    const st = newbieState(u);
    if (!st) fail('Усі завдання новачка виконано');
    if (!st.ready) fail('Завдання ще не виконано');
    // Skip the tasks already claimed in the old order (migrateNewbieOrder).
    const f = JSON.parse(u.newbie_flags);
    let next = u.newbie_step + 1;
    while (S.NEWBIE_TASKS[next] && f.includes('nb:' + S.NEWBIE_TASKS[next].key)) next++;
    q('UPDATE users SET newbie_step = ? WHERE id = ?').run(next, uid);
    addMoney(uid, st.money);
    xp(uid, 'task');
    return { got: st.money };
  }
  // Polled every few seconds by the open app: invites waiting for an answer, rewards ready to claim and a live race
  // in progress. The app shows them as banners sliding down from the top of the screen.
  // ---------- dream car (S.dreamChances / S.suggestDream) ----------
  // The model the player aims for. When it arrives (giveCar: a case, a reward, a battle) the drop is marked so the app
  // can celebrate it; for the «Мрійник» achievement it counts once per model, only for class B+ dreams chosen at least
  // S.DREAM.achAgeMs before (no "pick a cheap car, get it, pick the next" farming).
  function dreamHit(uid, model) {
    const u = q('SELECT dream_car, dream_at FROM users WHERE id = ?').get(uid);
    if (!u?.dream_car || u.dream_car !== model) return false;
    const m = S.MODELS[model];
    if (m && S.rankOf(m.cls) >= S.DREAM.achMinRank && now() - u.dream_at >= S.DREAM.achAgeMs) {
      q('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(uid, 'dream:' + model);
    }
    q("INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)").run(uid, `dreamgot:${model}:${u.dream_at}`);
    return true;
  }
  function dreamOut(u) {
    if (!u.dream_car || !S.MODELS[u.dream_car]) return { model: null, suggest: S.suggestDream(u.balance + u.total_value, u.id) };
    const got = !!q('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(u.id, `dreamgot:${u.dream_car}:${u.dream_at}`);
    const own = !!q("SELECT 1 FROM cars WHERE owner_id = ? AND model = ? AND status <> 'auction'").get(u.id, u.dream_car);
    return { model: u.dream_car, at: u.dream_at, got, own };
  }
  function dreamSet(uid, { model }) {
    if (model == null || model === '') {
      q('UPDATE users SET dream_car = NULL, dream_at = 0 WHERE id = ?').run(uid);
      return { dream: dreamOut(userRow(uid)) };
    }
    const m = S.MODELS[String(model)];
    if (!m) fail('Невідома машина');
    if (m.secret) fail('Секретну машину не можна обрати мрією — її дають лише за колекцію');
    const u = userRow(uid);
    if (u.dream_car !== m.id) q('UPDATE users SET dream_car = ?, dream_at = ? WHERE id = ?').run(m.id, now(), uid);
    return { dream: dreamOut(userRow(uid)) };
  }

  // ---------- achievements (tiers and rewards in S.ACHIEVEMENTS) ----------
  // Every measure comes from data the game already keeps, so earlier play counts too.
  // PvP and battle wins: one per beaten rival per (UTC) day — two accounts racing each other at the minimum bet can't
  // farm the tiers. The rival of a finished match is creator + opponent − winner.
  const WINS_PER_RIVAL_DAY = (table) => `SELECT COUNT(DISTINCT (creator_id + opponent_id - winner_id) || ':' || (finished_at / 86400000)) n
    FROM ${table} WHERE winner_id = ? AND status = 'done' AND opponent_id IS NOT NULL`;
  const TIER_RANK = { stock: 0, street: 1, sport: 2, pro: 3, race: 4 };
  function achievementProgress(uid) {
    const u = userRow(uid);
    const models = q('SELECT model FROM collection WHERE user_id = ?').all(uid).map((r) => S.MODELS[r.model]).filter(Boolean);
    let tuned = 0;
    for (const r of q('SELECT cp.car_id, cp.tier, c.model FROM car_parts cp JOIN cars c ON c.id = cp.car_id WHERE c.owner_id = ?').all(uid).reduce((m, r) => {
      const x = m.get(r.car_id) || { n: 0, lo: 4, model: r.model };
      x.n++;
      x.lo = Math.min(x.lo, TIER_RANK[r.tier] ?? 0);
      return m.set(r.car_id, x);
    }, new Map()).values()) {
      if (r.n >= S.partKeysOf(r.model).length) tuned = Math.max(tuned, Math.max(1, r.lo));
    }
    return {
      cases: u.cases_opened, wins: u.wins,
      pvp: q(WINS_PER_RIVAL_DAY('pvp')).get(uid).n,
      battles: q(WINS_PER_RIVAL_DAY('battles')).get(uid).n,
      collection: models.filter((m) => !m.secret).length,
      rarest: Math.max(0, ...models.filter((m) => !m.season).map((m) => S.rankOf(m.cls))),
      secrets: models.filter((m) => m.secret && !m.season).length,
      garage: u.total_value, level: u.level, play: Math.floor(u.play_ms / 3600e3), streak: u.streak, merges: u.merges, tuned,
      plates: u.plate_best, // best plate generated by the player himself (see generatePlate)
      friends: q('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND ref_paid = 1').get(uid).n,
      dream: q("SELECT COUNT(*) n FROM claims WHERE user_id = ? AND key LIKE 'dream:%'").get(uid).n,
    };
  }
  // Per achievement: progress, how many tiers are claimed, how many are reached.
  function achievementState(uid) {
    const p = achievementProgress(uid);
    const claimed = new Set(q("SELECT key FROM claims WHERE user_id = ? AND key LIKE 'a:%'").all(uid).map((r) => r.key));
    return S.ACHIEVEMENTS.map((a) => {
      const reached = a.goals.filter((g) => p[a.key] >= g).length;
      const got = a.goals.filter((g, i) => claimed.has(`a:${a.key}:${i}`)).length;
      return { key: a.key, value: p[a.key], reached, claimed: got };
    });
  }
  // Money part of tiers from..to-1 (keys and parts are not summed into the banner).
  const achMoney = (a, from, to) => a.rewards.slice(from, to).reduce((x, rw) => x + (S.achReward(rw).money || 0), 0);
  function achievements(uid) {
    return { list: achievementState(uid) };
  }
  // Claims every tier reached and not claimed yet — of one achievement, or of all of them.
  function achievementClaim(uid, { key }) {
    let got = 0, tiers = 0;
    const items = [], keys = [];
    for (const s of achievementState(uid)) {
      if (key && s.key !== key) continue;
      const a = S.ACH_BY_KEY[s.key];
      for (let i = 0; i < s.reached; i++) {
        if (q('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(uid, `a:${a.key}:${i}`)) continue;
        q('INSERT INTO claims (user_id, key) VALUES (?, ?)').run(uid, `a:${a.key}:${i}`);
        const rw = S.achReward(a.rewards[i]);
        grant(uid, { ...rw, money: 0 });
        got += rw.money || 0;
        if (rw.caseId || rw.parts || rw.fuel) items.push(S.achRewardText({ ...rw, money: 0 }));
        if (rw.caseId) keys.push({ caseId: rw.caseId, count: rw.count || 1 });
        tiers++;
        xp(uid, 'task');
      }
    }
    if (!tiers) fail('Немає нових досягнень');
    if (got) addMoney(uid, got);
    return { got, tiers, items, keys, text: [got ? '+' + S.fmt(got) : '', ...items].filter(Boolean).join(' + ') };
  }

  // The app polls every 4 s only while it is on screen: a gap of up to PLAY_GAP_MS since the previous poll is time
  // spent playing; a longer gap means the app was closed or hidden.
  const PLAY_GAP_MS = 15e3;
  function pulse(uid) {
    sweepPvp();
    const u = userRow(uid), t = now(), day = dayOf(t);
    const gap = t - u.play_at;
    q('UPDATE users SET play_ms = play_ms + ?, play_at = ? WHERE id = ?').run(gap > 0 && gap <= PLAY_GAP_MS ? gap : 0, t, uid);
    const invites = [];
    for (const r of q("SELECT * FROM trade_rooms WHERE invited_id = ? AND status = 'open' AND host_seen > ?").all(uid, t - 45e3)) {
      invites.push({ key: 'room' + r.id, kind: 'room', id: r.id, from: name(r.host_id), at: r.updated_at });
    }
    for (const p of q("SELECT * FROM pvp WHERE creator_id = ? AND status = 'pending'").all(uid)) {
      invites.push({ key: 'pvp' + p.id + ':' + p.req_at, kind: 'pvp', id: p.id, from: name(p.opponent_id), bet: p.bet, car: JSON.parse(p.opp_snapshot), expiresAt: p.req_at + PVP_ANSWER_MS });
    }
    const claims = [];
    if (u.streak_day !== day) claims.push({ key: 'daily:' + day, kind: 'daily', title: 'Щоденний бонус', sub: `День ${(u.streak % S.DAILY_BONUS.length) + 1} з ${S.DAILY_BONUS.length} — забери подарунок` });
    if (u.reward_case_at + S.REWARD_CASE_HOURS * 3600e3 <= t) claims.push({ key: 'rcase:' + u.reward_case_at, kind: 'rcase', title: 'Кейс нагород готовий', sub: 'Гроші, деталі, пальне або машина' });
    const nb = newbieState(u);
    if (nb?.ready) claims.push({ key: 'newbie:' + nb.step, kind: 'newbie', title: 'Завдання новачка виконано', sub: nb.text, money: nb.money });
    for (const r of q('SELECT key, target, progress, reward FROM quests WHERE user_id = ? AND day = ? AND claimed = 0 AND progress >= target').all(uid, day)) {
      claims.push({ key: `quest:${day}:${r.key}`, kind: 'quest', id: r.key, title: 'Завдання виконано', sub: S.QUESTS[r.key].text.replace('{n}', r.target), money: r.reward });
    }
    // Weekly route: finished tasks and chests that can be opened (rows are made by ensureWeekly, never here).
    const week = weekOf(t);
    for (const r of q('SELECT key, target FROM weekly_quests WHERE user_id = ? AND week = ? AND claimed = 0 AND progress >= target').all(uid, week)) {
      claims.push({ key: `weekly:${week}:${r.key}`, kind: 'weekly', id: r.key, title: 'Тижневе завдання виконано', sub: `${S.WEEKLY_QUESTS[r.key].text.replace('{n}', r.target)} · +${S.WEEKLY_FRAG} фрагменти ключа` });
    }
    const wkActive = activeDays(uid, week).length;
    const wkClaimed = new Set(q('SELECT key FROM claims WHERE user_id = ? AND key LIKE ?').all(uid, `wk:${week}:%`).map((r) => r.key));
    for (const c of S.WEEK_CHEST) if (wkActive >= c.days && !wkClaimed.has(chestKey(week, c.days))) {
      claims.push({ key: chestKey(week, c.days), kind: 'wchest', id: c.days, title: `Скриня тижня: ${c.days} активних дні${c.days > 4 ? 'в' : ''}`, sub: 'Відкрий скриню тижневого маршруту' });
    }
    const owned = new Set(q('SELECT model FROM collection WHERE user_id = ?').all(uid).map((r) => r.model));
    const have = new Set(q('SELECT key FROM claims WHERE user_id = ?').all(uid).map((r) => r.key));
    const regular = [...owned].filter((id) => !S.MODELS[id]?.secret).length;
    for (const m of S.COLLECTION_MILESTONES) if (regular >= m.n && !S.milestoneTaken(m, have)) claims.push({ key: 'coll:' + S.milestoneId(m), kind: 'coll', id: S.milestoneId(m), title: 'Нагорода за колекцію', sub: m.label || `Зібрано ${m.n} машин`, money: m.money });
    for (const c of S.MAIN_COUNTRIES) {
      if (!have.has('c' + c) && S.countryModels(c).every((m) => owned.has(m.id))) claims.push({ key: 'coll:c' + c, kind: 'coll', id: 'c' + c, title: `Колекція «${S.COUNTRIES[c].name}» зібрана!`, sub: 'Секретна машина й гроші', money: S.COUNTRY_REWARD[c] });
    }
    for (const s of S.SETS) {
      if (!have.has('set:' + s.id) && S.setProgress(s, owned).done) claims.push({ key: 'set:' + s.id, kind: 'set', id: s.id, title: `Сет «${s.name}» зібрано!`, sub: `Значок ${S.SET_TIERS[s.tier].name} · ${S.setRewardText(s)}` });
    }
    // Achievements: one banner per new tier, or a single "claim all" banner when several are waiting.
    const ach = achievementState(uid).filter((s) => s.reached > s.claimed);
    if (ach.length > 2) {
      const money = ach.reduce((sum, s) => sum + achMoney(S.ACH_BY_KEY[s.key], s.claimed, s.reached), 0);
      claims.push({ key: 'achAll:' + ach.map((s) => s.key + s.reached).join(','), kind: 'achAll', title: `Нові досягнення: ${ach.reduce((n, s) => n + s.reached - s.claimed, 0)}`, sub: 'Забери всі нагороди одразу', money });
    } else {
      for (const s of ach) {
        const a = S.ACH_BY_KEY[s.key], tier = s.reached - 1;
        claims.push({ key: `ach:${s.key}:${tier}`, kind: 'ach', id: s.key, tier, title: `${a.title} · ${S.ACH_TIERS[tier].name}`, sub: S.achText(a, tier), money: achMoney(a, s.claimed, s.reached) });
      }
    }
    const si = seasonInfo(u);
    if (si.ready) claims.push({ key: `pass:${si.id}:${si.level}:${si.premium ? 1 : 0}:${si.ready}`, kind: 'pass', title: `Сезонний пропуск: рівень ${si.level}`, sub: `Можна забрати: ${si.ready}` });
    if (rescueReady(u)) claims.push({ key: 'rescue:' + u.rescue_at, kind: 'rescue', title: 'Не здавайся!', sub: 'Тримай безкоштовний «Іржавий гараж»' });
    const inc = incomeState(u);
    if (inc.rate > 0 && inc.pending >= inc.rate * inc.capH * 0.999) claims.push({ key: 'income:' + u.income_at, kind: 'income', title: 'Гараж набрав максимум', sub: 'Дохід зупинився — забери, щоб він знову йшов', money: inc.pending });
    const live = q("SELECT id FROM pvp WHERE status IN ('pending', 'live') AND opponent_id = ? OR status = 'live' AND creator_id = ? ORDER BY id DESC LIMIT 1").get(uid, uid);
    const gifts = q('SELECT id, kind, data, note FROM gifts WHERE user_id = ? AND shown = 0 ORDER BY id LIMIT 10').all(uid).map((g) => ({ ...g, data: JSON.parse(g.data) }));
    return {
      now: t, balance: u.balance, noInvites: !!u.no_invites, invites, claims, gifts, livePvp: live?.id || null, achReady: ach.length,
      gameEvents: S.activeEvents(t, evOv).map(S.eventInfo),
      unread: q('SELECT COUNT(*) n FROM events WHERE user_id = ? AND seen = 0').get(uid).n,
    };
  }
  function levelSeen(uid) {
    q('UPDATE users SET level_seen = level WHERE id = ?').run(uid);
    return {};
  }
  // The intro stories were shown: never again, and the current "what's new" counts as seen too.
  function introSeen(uid) {
    q('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(uid, 'intro');
    q('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(uid, 'story:' + S.WHATS_NEW.id);
    return {};
  }
  // "Не підказувати": the player turned the first-steps hints off.
  function guideOff(uid) {
    q('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(uid, 'guide-off');
    return {};
  }
  // Menu → Налаштування → "Підказки перших кроків": the hints come back (if any step is still left).
  function guideOn(uid) {
    q("DELETE FROM claims WHERE user_id = ? AND key = 'guide-off'").run(uid);
    return {};
  }
  function quests(uid) {
    const day = ensureQuests(uid);
    return { list: q('SELECT key, target, progress, reward, claimed FROM quests WHERE user_id = ? AND day = ?').all(uid, day).map((r) => ({ ...r, claimed: !!r.claimed, text: S.QUESTS[r.key].text.replace('{n}', r.target) })) };
  }
  function questClaim(uid, { key }) {
    const day = ensureQuests(uid);
    const r = q('SELECT * FROM quests WHERE user_id = ? AND day = ? AND key = ?').get(uid, day, String(key));
    if (!r) fail('Завдання не знайдено');
    if (r.claimed) fail('Нагороду вже отримано');
    if (r.progress < r.target) fail('Завдання ще не виконано');
    q('UPDATE quests SET claimed = 1 WHERE user_id = ? AND day = ? AND key = ?').run(uid, day, r.key);
    addMoney(uid, r.reward);
    xp(uid, 'quest');
    return { got: r.reward };
  }

  // ---------- weekly route (S.WEEKLY_QUESTS, S.WEEK_CHEST) ----------
  const addDays = (date, n) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // Kyiv midnight that starts this date (UTC+3 in summer, UTC+2 in winter).
  const kyivMidnight = (date) => {
    const t = Date.parse(date + 'T00:00:00Z') - 3 * 3600e3;
    return dayOf(t) === date ? t : t + 3600e3;
  };
  // Days of the week (Kyiv dates) with at least S.WEEK_ACTIVE_QUESTS daily tasks claimed.
  function activeDays(uid, week) {
    return q('SELECT day FROM quests WHERE user_id = ? AND day >= ? AND day <= ? GROUP BY day HAVING SUM(claimed) >= ? ORDER BY day')
      .all(uid, week, addDays(week, 6), S.WEEK_ACTIVE_QUESTS).map((r) => r.day);
  }
  // Fragments of a key; every full set becomes a key at once (as with case drops). Returns the new keys.
  function addFragments(uid, caseId, n) {
    const fr = q('INSERT INTO fragments (user_id, case_id, count) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET count = count + excluded.count RETURNING count').get(uid, caseId, n).count;
    const keys = Math.floor(fr / S.FRAGMENTS_PER_KEY);
    if (keys) {
      q('UPDATE fragments SET count = count - ? WHERE user_id = ? AND case_id = ?').run(keys * S.FRAGMENTS_PER_KEY, uid, caseId);
      addKeys(uid, caseId, keys);
    }
    return keys;
  }
  const chestKey = (week, days) => `wk:${week}:${days}`;
  function weekly(uid) {
    const week = ensureWeekly(uid);
    const lvl = userRow(uid).level;
    const days = activeDays(uid, week);
    const claimed = new Set(q("SELECT key FROM claims WHERE user_id = ? AND key LIKE ?").all(uid, `wk:${week}:%`).map((r) => r.key));
    const caseId = S.levelKey(lvl);
    return {
      week, endsAt: kyivMidnight(addDays(week, 7)), today: dayOf(now()), caseId, partTier: S.levelPartTier(lvl),
      fragments: q('SELECT count FROM fragments WHERE user_id = ? AND case_id = ?').get(uid, caseId)?.count || 0,
      list: q('SELECT key, target, progress, claimed FROM weekly_quests WHERE user_id = ? AND week = ? ORDER BY rowid').all(uid, week)
        .map((r) => ({ ...r, claimed: !!r.claimed, text: S.WEEKLY_QUESTS[r.key].text.replace('{n}', r.target), frag: S.WEEKLY_FRAG })),
      days: Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((d) => ({ day: d, active: days.includes(d) })),
      active: days.length,
      chests: S.WEEK_CHEST.map((c) => ({ ...c, ready: days.length >= c.days, claimed: claimed.has(chestKey(week, c.days)) })),
    };
  }
  function weeklyClaim(uid, { key }) {
    const week = ensureWeekly(uid);
    const r = q('SELECT * FROM weekly_quests WHERE user_id = ? AND week = ? AND key = ?').get(uid, week, String(key));
    if (!r) fail('Завдання не знайдено');
    if (r.claimed) fail('Нагороду вже отримано');
    if (r.progress < r.target) fail('Завдання ще не виконано');
    if (!q('UPDATE weekly_quests SET claimed = 1 WHERE user_id = ? AND week = ? AND key = ? AND claimed = 0').run(uid, week, r.key).changes) fail('Нагороду вже отримано');
    const caseId = S.levelKey(userRow(uid).level);
    const newKeys = addFragments(uid, caseId, S.WEEKLY_FRAG);
    xp(uid, 'quest');
    return { caseId, frag: S.WEEKLY_FRAG, newKeys };
  }
  function weeklyChest(uid, { days }) {
    const n = int(days, 1, 7, 'Днів');
    const chest = S.WEEK_CHEST.find((c) => c.days === n);
    if (!chest) fail('Немає такої скрині');
    const week = weekOf(now());
    if (activeDays(uid, week).length < n) fail(`Потрібно ${n} активних днів цього тижня`);
    if (q('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(uid, chestKey(week, n)).changes === 0) fail('Скриню вже відкрито');
    const lvl = userRow(uid).level;
    const caseId = S.levelKey(lvl);
    const got = { caseId };
    if (chest.key) addKeys(uid, caseId, (got.keys = chest.key));
    if (chest.frag) got.newKeys = addFragments(uid, caseId, (got.frag = chest.frag));
    if (chest.parts) got.items = grant(uid, { parts: chest.parts, tier: S.levelPartTier(lvl) }).items;
    if (chest.fuel) {
      grant(uid, { fuel: true });
      got.fuel = true;
    }
    return got;
  }

  // ---------- comeback gift (S.COMEBACK) ----------
  // Called before last_seen is updated. Gates: level, account age, cooldown — a fresh second account gets nothing.
  function checkComeback(uid) {
    const u = q('SELECT id, level, created_at, last_seen, comeback_at, banned FROM users WHERE id = ?').get(uid);
    const t = now(), C = S.COMEBACK, D = 86400e3;
    if (!u || !u.last_seen || u.banned) return null;
    const away = t - u.last_seen;
    if (away < C.minDays * D || u.level < C.minLevel || t - u.created_at < C.minAgeDays * D || t - u.comeback_at < C.cooldownDays * D) return null;
    const big = away >= C.bigDays * D;
    // Freeze income at the normal cap first, so the longer cap never pays for the hours spent away.
    bank(uid);
    q('UPDATE users SET fuel = ?, fuel_at = ?, comeback_at = ? WHERE id = ?').run(S.FUEL_MAX, t, t, uid);
    q('UPDATE cars SET tank = ?, tank_at = ? WHERE owner_id = ?').run(S.CAR_TANK, t, uid);
    const keys = [{ caseId: S.comebackKey(u.level), count: 1 }];
    if (big && S.levelKey(u.level) === keys[0].caseId) keys[0].count++;
    else if (big) keys.push({ caseId: S.levelKey(u.level), count: 1 });
    for (const k of keys) addKeys(uid, k.caseId, k.count);
    const capUntil = big ? t + C.capFor * 3600e3 : 0;
    if (big) q('UPDATE users SET comeback_cap_until = ? WHERE id = ?').run(capUntil, uid);
    const data = { days: Math.floor(away / D), fuel: true, keys, capHours: big ? C.capHours : 0, capFor: big ? C.capFor : 0, capUntil };
    gift(uid, 'comeback', data, null);
    return data;
  }
  function collectionClaim(uid, { key }) {
    const k = String(key);
    if (q('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(uid, k)) fail('Нагороду вже отримано');
    const owned = new Set(q('SELECT model FROM collection WHERE user_id = ?').all(uid).map((r) => r.model));
    let rw;
    if (k.startsWith('n')) {
      const ms = S.COLLECTION_MILESTONES.find((m) => S.milestoneId(m) === k);
      if (!ms) fail('Невідома нагорода');
      if (S.milestoneTaken(ms, q('SELECT key FROM claims WHERE user_id = ?').all(uid).map((r) => r.key))) fail('Нагороду вже отримано');
      if ([...owned].filter((id) => !S.MODELS[id]?.secret).length < ms.n) fail('Ще не зібрано');
      rw = { money: ms.money, slots: ms.slots || 0 };
    } else if (k.startsWith('c')) {
      const c = k.slice(1);
      if (!S.MAIN_COUNTRIES.includes(c)) fail('Невідома нагорода');
      if (!S.countryModels(c).every((m) => owned.has(m.id))) fail(`Збери всі машини: ${S.COUNTRIES[c].name}`);
      rw = { money: S.COUNTRY_REWARD[c], secret: S.SECRET_BY_COUNTRY[c] };
    } else fail('Невідома нагорода');
    q('INSERT INTO claims (user_id, key) VALUES (?, ?)').run(uid, k);
    bank(uid);
    addMoney(uid, rw.money);
    if (rw.slots) q('UPDATE users SET slots = MIN(?, slots + ?) WHERE id = ?').run(S.MAX_SLOTS, rw.slots, uid);
    if (rw.secret) {
      const { id } = giveCar(uid, rw.secret);
      if (garageCount(uid) > userRow(uid).slots) q("UPDATE cars SET status = 'showcase' WHERE id = ?").run(id);
      rw.carOut = carOut(carRow(id));
    }
    return { reward: rw };
  }

  // ---------- collection sets (S.SETS) ----------
  // Progress counts models ever found (collection table); a finished set is claimed once under "set:<id>".
  const claimedSets = (uid) => q("SELECT key FROM claims WHERE user_id = ? AND key LIKE 'set:%'").all(uid).map((r) => r.key.slice(4));
  function sets(uid) {
    const owned = new Set(q('SELECT model FROM collection WHERE user_id = ?').all(uid).map((r) => r.model));
    const claimed = new Set(claimedSets(uid));
    return {
      list: S.SETS.map((s) => {
        const p = S.setProgress(s, owned);
        return { id: s.id, have: p.have, need: p.need, got: p.got, ready: p.done && !claimed.has(s.id), claimed: claimed.has(s.id) };
      }),
    };
  }
  function setClaim(uid, { id }) {
    const set = S.SET_BY_ID[String(id)];
    if (!set || !Object.hasOwn(S.SET_BY_ID, String(id))) fail('Невідомий сет');
    const owned = new Set(q('SELECT model FROM collection WHERE user_id = ?').all(uid).map((r) => r.model));
    const p = S.setProgress(set, owned);
    if (!p.done) fail(`Ще не зібрано: ${p.have}/${p.need}`);
    // The claim row goes first: a second call (double tap, two tabs) finds it and pays nothing.
    if (q('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(uid, 'set:' + set.id).changes === 0) fail('Нагороду вже отримано');
    bank(uid); // the income bonus counts from now on, not for the hours before
    const r = S.setReward(set);
    const got = { id: set.id, caseId: r.caseId, income: S.setIncome(set), badge: S.setBadgeTitle(set), tier: set.tier };
    if (r.count) addKeys(uid, r.caseId, (got.keys = r.count));
    if (r.frag) got.newKeys = addFragments(uid, r.caseId, (got.frag = r.frag));
    if (r.parts) got.items = grant(uid, { parts: r.parts, tier: r.tier }).items;
    q('INSERT OR IGNORE INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)').run(uid, 'set:' + set.id, got.badge, set.tier, now());
    return { reward: got };
  }

  // ---------- seasons (S.SEASON) ----------
  // Counters belong to a season; a player seen in a new season starts it from zero (nothing else is reset).
  function rollSeason(uid) {
    const cur = S.seasonOf(now());
    q('UPDATE users SET season_id = ?, season_xp = 0 WHERE id = ? AND (season_id IS NULL OR season_id <> ?)').run(cur, uid, cur);
  }
  // Prizes of the season that just ended: stars to the top 10, a badge to the top 100 (by season XP).
  function settleSeason() {
    const prev = S.seasonOf(now()) - 1;
    if (prev < 1 || q('SELECT 1 FROM seasons WHERE season_id = ?').get(prev)) return;
    q('INSERT INTO seasons (season_id, settled_at) VALUES (?, ?)').run(prev, now());
    const rows = q('SELECT id FROM users WHERE season_id = ? AND season_xp > 0 AND banned = 0 ORDER BY season_xp DESC, id LIMIT ?').all(prev, S.SEASON_BADGE_TOP);
    rows.forEach((r, i) => {
      const place = i + 1, stars = S.SEASON_PRIZES[i] || 0, b = S.seasonBadge(place);
      if (stars) q('UPDATE users SET stars = stars + ? WHERE id = ?').run(stars, r.id);
      q('INSERT OR IGNORE INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(r.id, `s${prev}`, `${b.title} · Сезон ${prev}`, b.tier, prev, place, now());
      event(r.id, `🏆 Сезон ${prev}: ${place} місце!${stars ? ` +${stars} ⭐ на рахунок` : ''} Значок «${b.title}» тепер у твоєму профілі.`);
    });
  }
  const badgesOf = (uid) => q('SELECT key, title, tier, season, place FROM badges WHERE user_id = ? ORDER BY tier DESC, season DESC').all(uid);
  function seasonInfo(u) {
    const cur = S.seasonOf(now());
    const xp = u.season_id === cur ? u.season_xp : 0;
    const p = S.passLevel(xp);
    const claimed = new Set(q("SELECT key FROM claims WHERE user_id = ? AND key LIKE ?").all(u.id, `pass:${cur}:%`).map((r) => r.key));
    const premium = u.premium_season === cur;
    let ready = 0;
    for (let l = 2; l <= p.level; l++) {
      if (!claimed.has(`pass:${cur}:${l}:f`)) ready++;
      if (premium && !claimed.has(`pass:${cur}:${l}:p`)) ready++;
    }
    return { id: cur, endsAt: S.seasonEndOf(cur), xp, level: p.level, levelXp: p.xp, need: p.need, premium, ready, claimed: [...claimed] };
  }
  // The garage income per hour the pass money scales with (S.passMoneyFor): the same number the garage shows.
  const passRate = (u) => Math.round(incomeState(u).rate);
  function season(uid) {
    const u = userRow(uid);
    const info = seasonInfo(u);
    const rate = passRate(u);
    const levels = [];
    for (let l = 2; l <= S.SEASON.levels; l++) levels.push({ level: l, free: S.passReward(info.id, l, false, rate), premium: S.passReward(info.id, l, true, rate) });
    const car = S.passReward(info.id, S.SEASON.levels, true).seasonCar;
    return { ...info, levels, car, rate };
  }
  // Claims every pass reward reached and not yet taken (free track, and premium if bought).
  function passClaim(uid) {
    const u = userRow(uid);
    const info = seasonInfo(u);
    const rate = passRate(u);
    const got = [];
    for (let l = 2; l <= info.level; l++) {
      for (const tr of info.premium ? ['f', 'p'] : ['f']) {
        const key = `pass:${info.id}:${l}:${tr}`;
        if (info.claimed.includes(key)) continue;
        q('INSERT INTO claims (user_id, key) VALUES (?, ?)').run(uid, key);
        const rw = S.passReward(info.id, l, tr === 'p', rate);
        if (rw.seasonCar && q('SELECT 1 FROM cars WHERE owner_id = ? AND model = ?').get(uid, rw.seasonCar)) continue;
        got.push({ level: l, premium: tr === 'p', ...grant(uid, rw) });
      }
    }
    if (!got.length) fail('Немає нових нагород пропуску');
    return { got, money: got.reduce((n, g) => n + (g.money || 0), 0) };
  }

  // ---------- rewards center: «Забрати все» (wave E) ----------
  // Every reward that is ready, in one call: daily bonus, reward case, newbie and daily tasks, the weekly route,
  // achievements, the season pass, collection and sets. Each part goes through its own claim with its own guard (the
  // claim row or flag is written before anything is paid), so a second call — a double tap, a second tab — finds
  // nothing left and pays nothing. A part that fails with a game error (no longer ready) is rolled back to its savepoint
  // and skipped. Money, parts, fuel and cosmetics land at once; cars and keys come back in `reveal` (in this order), for
  // the app to show one by one: keys are opened by the app through case/open, so the server rolls them as usual.
  function rewardsAll(uid) {
    const snap = () => {
      const u = userRow(uid);
      return { bal: u.balance, slots: u.slots, fuel: u.fuel, parts: q('SELECT COALESCE(SUM(count), 0) n FROM parts WHERE user_id = ?').get(uid).n,
        cos: new Set(q("SELECT key FROM claims WHERE user_id = ? AND key LIKE 'cos:%'").all(uid).map((r) => r.key)) };
    };
    const before = snap();
    const reveal = [], kinds = [];
    const take = (kind, fn) => {
      db.exec('SAVEPOINT rewards_all');
      try {
        const r = fn();
        db.exec('RELEASE rewards_all');
        kinds.push(kind);
        return r;
      } catch (e) {
        db.exec('ROLLBACK TO rewards_all');
        db.exec('RELEASE rewards_all');
        if (e instanceof GameError) return null;
        throw e;
      }
    };
    const key = (caseId, count, title) => {
      if (caseId && count > 0 && S.CASE_BY_ID[caseId]) reveal.push({ kind: 'key', caseId, count, title });
    };
    const car = (out, title, isNew = true) => out && reveal.push({ kind: 'car', car: out, title, isNew });
    const t = now(), day = dayOf(t), u = userRow(uid);
    if (u.streak_day !== day) {
      const r = take('daily', () => dailyClaim(uid));
      if (r) {
        const title = `Щоденний бонус · день ${((r.streak - 1) % S.DAILY_BONUS.length) + 1}`;
        car(r.reward.carOut, title, !!r.reward.isNew);
        key(r.reward.caseId, r.reward.count || 1, title);
      }
    }
    if (t >= u.reward_case_at + S.REWARD_CASE_HOURS * 3600e3) {
      const r = take('rcase', () => rewardCase(uid));
      if (r) reveal.unshift({ kind: 'rcase', reward: r.reward, title: 'Кейс нагород' });
    }
    for (let i = 0; i < S.NEWBIE_TASKS.length && newbieState(userRow(uid))?.ready; i++) if (!take('newbie', () => newbieClaim(uid))) break;
    const qday = ensureQuests(uid);
    for (const r of q('SELECT key FROM quests WHERE user_id = ? AND day = ? AND claimed = 0 AND progress >= target').all(uid, qday)) take('quest', () => questClaim(uid, { key: r.key }));
    const week = ensureWeekly(uid);
    for (const r of q('SELECT key FROM weekly_quests WHERE user_id = ? AND week = ? AND claimed = 0 AND progress >= target').all(uid, week)) {
      const w = take('weekly', () => weeklyClaim(uid, { key: r.key }));
      if (w?.newKeys) key(w.caseId, w.newKeys, 'Тижневий маршрут · ключ з фрагментів');
    }
    const active = activeDays(uid, week).length;
    for (const c of S.WEEK_CHEST) {
      if (active < c.days || q('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(uid, chestKey(week, c.days))) continue;
      const w = take('wchest', () => weeklyChest(uid, { days: c.days }));
      if (w) key(w.caseId, (w.keys || 0) + (w.newKeys || 0), `Скриня тижня · ${c.days} дн.`);
    }
    if (achievementState(uid).some((s) => s.reached > s.claimed)) {
      const a = take('ach', () => achievementClaim(uid, {}));
      for (const k of a?.keys || []) key(k.caseId, k.count, 'Досягнення');
    }
    if (seasonInfo(userRow(uid)).ready) {
      const p = take('pass', () => passClaim(uid));
      for (const g of p?.got || []) {
        car(g.carOut, `Сезон · рівень ${g.level}${g.premium ? ' · преміум' : ''}`);
        key(g.caseId, g.count || 1, `Сезон · рівень ${g.level}${g.premium ? ' · преміум' : ''}`);
      }
    }
    const owned = new Set(q('SELECT model FROM collection WHERE user_id = ?').all(uid).map((r) => r.model));
    const have = new Set(q('SELECT key FROM claims WHERE user_id = ?').all(uid).map((r) => r.key));
    const regular = [...owned].filter((id) => !S.MODELS[id]?.secret).length;
    for (const m of S.COLLECTION_MILESTONES) if (regular >= m.n && !S.milestoneTaken(m, have)) take('coll', () => collectionClaim(uid, { key: S.milestoneId(m) }));
    for (const c of S.MAIN_COUNTRIES) {
      if (have.has('c' + c) || !S.countryModels(c).every((m) => owned.has(m.id))) continue;
      const r = take('coll', () => collectionClaim(uid, { key: 'c' + c }));
      car(r?.reward.carOut, `Колекція «${S.COUNTRIES[c].name}» зібрана`);
    }
    for (const s of S.SETS) {
      if (have.has('set:' + s.id) || !S.setProgress(s, owned).done) continue;
      const r = take('set', () => setClaim(uid, { id: s.id }));
      if (r) key(r.reward.caseId, (r.reward.keys || 0) + (r.reward.newKeys || 0), `Сет «${s.name}»`);
    }
    if (!kinds.length) fail('Немає нагород, які можна забрати');
    const after = snap();
    // The reward case first, then the keys, the cars last (the season car is the finale).
    const order = { rcase: 0, key: 1, car: 2 };
    reveal.sort((a, b) => order[a.kind] - order[b.kind]);
    return {
      n: kinds.length, kinds, money: after.bal - before.bal, parts: after.parts - before.parts, slots: after.slots - before.slots,
      fuel: after.fuel > before.fuel, cosmetics: [...after.cos].filter((k) => !before.cos.has(k)).map((k) => S.cosmeticOf(k)?.name).filter(Boolean), reveal,
    };
  }
  function seasonBoard(uid) {
    const cur = S.seasonOf(now());
    const rows = q('SELECT id, season_xp score FROM users WHERE season_id = ? AND season_xp > 0 AND banned = 0 ORDER BY score DESC, id LIMIT 100').all(cur);
    const vips = new Set(q('SELECT id FROM users WHERE vip_until > ?').all(now()).map((r) => r.id));
    const list = rows.map((r, i) => ({ place: i + 1, id: r.id, name: name(r.id), score: r.score, me: r.id === uid, vip: vips.has(r.id), level: S.passLevel(r.score).level }));
    const u = userRow(uid);
    const myScore = u.season_id === cur ? u.season_xp : 0;
    const myPlace = q('SELECT COUNT(*) n FROM users WHERE season_id = ? AND banned = 0 AND (season_xp > ? OR season_xp = ? AND id < ?)').get(cur, myScore, myScore, uid).n + 1;
    return { list, type: 'season', season: cur, me: { place: myPlace, score: myScore }, endsAt: S.seasonEndOf(cur), prizes: S.SEASON_PRIZES, badgeTop: S.SEASON_BADGE_TOP };
  }

  // ---------- star shop: VIP, pass, starter pack, conveniences (S.SHOP_ITEMS) ----------
  function itemPrice(uid, itemId) {
    const it = S.SHOP_BY_ID[itemId];
    if (!it) fail('Невідомий товар');
    const u = userRow(uid);
    if (it.once && u.starter_bought) fail('Стартовий набір можна купити лише один раз');
    if (it.id === 'pass' && u.premium_season === S.seasonOf(now())) fail('Преміум-пропуск цього сезону вже куплено');
    if (it.id === 'slot' && u.slots >= S.MAX_SLOTS) fail('Максимум місць');
    return S.shopPrice(it, u.star_slots);
  }
  function applyItem(uid, itemId) {
    const it = S.SHOP_BY_ID[itemId];
    const u = userRow(uid);
    const out = { item: it.id };
    if (it.vipDays) {
      bank(uid); // income so far at the old cap; the longer cap starts now
      const until = Math.max(u.vip_until || 0, now()) + it.vipDays * 86400e3;
      q('UPDATE users SET vip_until = ? WHERE id = ?').run(until, uid);
      out.vipUntil = until;
    }
    if (it.money) addMoney(uid, it.money);
    for (const [caseId, n] of Object.entries(it.keys || {})) addKeys(uid, caseId, n);
    if (it.once) q('UPDATE users SET starter_bought = 1 WHERE id = ?').run(uid);
    if (it.id === 'pass') q('UPDATE users SET premium_season = ? WHERE id = ?').run(S.seasonOf(now()), uid);
    if (it.id === 'refuel') {
      q('UPDATE users SET fuel = ?, fuel_at = ? WHERE id = ?').run(S.FUEL_MAX, now(), uid);
      q('UPDATE cars SET tank = ?, tank_at = ? WHERE owner_id = ?').run(S.CAR_TANK, now(), uid);
    }
    if (it.id === 'cool') q('DELETE FROM parts_cool WHERE user_id = ?').run(uid);
    if (it.id === 'slot') q('UPDATE users SET slots = MIN(?, slots + 1), star_slots = star_slots + 1 WHERE id = ?').run(S.MAX_SLOTS, uid);
    return out;
  }
  function shop(uid) {
    const u = userRow(uid);
    const cur = S.seasonOf(now());
    return {
      stars: u.stars, vipUntil: u.vip_until, starterBought: !!u.starter_bought, premium: u.premium_season === cur,
      items: S.SHOP_ITEMS.map((it) => ({ ...it, price: S.shopPrice(it, u.star_slots) })),
    };
  }
  // Paid from the stars on the account (season prizes).
  function buyWithStars(uid, { item }) {
    const price = itemPrice(uid, String(item));
    if (!q('UPDATE users SET stars = stars - ? WHERE id = ? AND stars >= ?').run(price, uid, price).changes) fail('Недостатньо зірок на рахунку');
    return { ...applyItem(uid, String(item)), paid: price };
  }
  // Paid in Telegram Stars through the bot (each charge once).
  function creditItem({ chargeId, userId, itemId, stars }) {
    return db.tx(() => {
      if (!S.SHOP_BY_ID[itemId]) fail('Невідомий товар');
      if (q('SELECT 1 FROM payments WHERE charge_id = ?').get(chargeId)) return { duplicate: true };
      const it = S.SHOP_BY_ID[itemId], u = userRow(userId);
      // Two invoices paid back to back both pass the pre-checkout; the second one would buy nothing (or a once-only pack twice).
      if ((it.once && u.starter_bought) || (it.id === 'pass' && u.premium_season === S.seasonOf(now()))) {
        q('INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(chargeId, userId, 'refund:' + itemId, stars, 0, now());
        return { refund: true, item: itemId };
      }
      q('INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(chargeId, userId, 'item:' + itemId, stars, 0, now());
      const out = applyItem(userId, itemId);
      event(userId, `⭐ Оплата пройшла! ${S.SHOP_BY_ID[itemId].name} — уже твоє`);
      return out;
    });
  }
  const itemPriceTx = (uid, itemId) => db.tx(() => itemPrice(uid, itemId));

  // Live feed for the case screen: the latest purple-or-better drops of all players (names shortened).
  function dropFeed() {
    const rows = q("SELECT d.user_id uid, d.item, d.cls, d.case_id caseId, d.created_at at FROM drops d WHERE d.cls IN ('B', 'A', 'S') AND d.forced <> 3 ORDER BY d.id DESC LIMIT 40").all()
      .filter((r) => S.MODELS[r.item] && S.CASE_BY_ID[r.caseId]).slice(0, 12);
    return { list: rows.map((r) => ({ name: name(r.uid), model: r.item, cls: r.cls, caseId: r.caseId, at: r.at })) };
  }
  function leaderboard(uid, { type } = {}) {
    if (type === 'season') return seasonBoard(uid);
    const week = type !== 'all';
    const cur = weekOf(now());
    const rows = week
      ? q('SELECT id, total_value - week_start_value score FROM users WHERE week_id = ? ORDER BY score DESC, id LIMIT 50').all(cur)
      : q('SELECT id, total_value score FROM users ORDER BY score DESC, id LIMIT 50').all();
    const list = rows.map((r, i) => ({ place: i + 1, id: r.id, name: name(r.id), score: r.score, me: r.id === uid }));
    const u = userRow(uid);
    const myScore = week ? u.total_value - u.week_start_value : u.total_value;
    // Ties go to the earlier player (lower id), the same order as the list and the weekly prizes.
    const myPlace = week
      ? q('SELECT COUNT(*) n FROM users WHERE week_id = ? AND (total_value - week_start_value > ? OR total_value - week_start_value = ? AND id < ?)').get(cur, myScore, myScore, uid).n + 1
      : q('SELECT COUNT(*) n FROM users WHERE total_value > ? OR total_value = ? AND id < ?').get(myScore, myScore, uid).n + 1;
    const next = new Date(cur + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 7);
    return { list, type: week ? 'week' : 'all', me: { place: myPlace, score: myScore }, endsAt: next.getTime() - 2 * 3600e3, prizes: S.WEEKLY_PRIZES };
  }

  function redeemPromo(uid, { code }) {
    const c = String(code || '').trim().toUpperCase();
    const p = q('SELECT * FROM promos WHERE code = ?').get(c);
    if (!p || p.uses_left <= 0 || (p.expires_at && p.expires_at < now())) fail('Промокод недійсний');
    if (q('SELECT 1 FROM promo_uses WHERE code = ? AND user_id = ?').get(c, uid)) fail('Ти вже використав цей промокод');
    q('INSERT INTO promo_uses (code, user_id) VALUES (?, ?)').run(c, uid);
    q('UPDATE promos SET uses_left = uses_left - 1 WHERE code = ?').run(c);
    addMoney(uid, p.amount);
    return { got: p.amount };
  }
  function createPromo(code, amount, uses, days) {
    const c = String(code).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(c)) fail('Код: 3–32 символи A-Z 0-9 _ -');
    q('INSERT OR REPLACE INTO promos (code, amount, uses_left, expires_at) VALUES (?, ?, ?, ?)')
      .run(c, int(amount, 1, 1e12, 'Сума'), int(uses, 1, 1e7, 'Кількість'), days ? now() + int(days, 1, 3650, 'Дні') * 86400e3 : null);
    return c;
  }
  function events(uid) {
    const list = q('SELECT id, text, seen, created_at at FROM events WHERE user_id = ? ORDER BY id DESC LIMIT 40').all(uid);
    q('UPDATE events SET seen = 1 WHERE user_id = ? AND seen = 0').run(uid);
    return { list };
  }
  // What a pack gives this player right now (S.packAmount: grows with level and garage).
  function packAmountFor(uid, packId) {
    const pack = S.PACKS.find((p) => p.id === packId);
    if (!pack) fail('Невідомий пакет');
    const u = userRow(uid);
    return S.packAmount(pack, u.level, u.total_value);
  }
  // `amount` comes from the invoice (fixed when it was made); without it the player's current amount is used.
  function creditPayment({ chargeId, userId, packId, stars, amount }) {
    return db.tx(() => {
      const pack = S.PACKS.find((p) => p.id === packId);
      if (!pack) fail('Невідомий пакет');
      if (q('SELECT 1 FROM payments WHERE charge_id = ?').get(chargeId)) return { duplicate: true };
      const got = Number.isSafeInteger(amount) && amount >= pack.amount && amount <= pack.amount * 1e6 ? amount : packAmountFor(userId, packId);
      q('INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(chargeId, userId, pack.id, stars, got, now());
      addMoney(userId, got);
      event(userId, `⭐ Оплата пройшла! +${S.fmt(got)}`);
      return { amount: got };
    });
  }
  // The bot's /give: same as the panel's money action (never below zero), logged as "bot".
  function adminGive(userId, amount) {
    return db.tx(() => adminMoney('bot', { id: userId, amount }));
  }
  function stats() {
    return {
      users: q('SELECT COUNT(*) n FROM users').get().n,
      active24h: q('SELECT COUNT(*) n FROM users WHERE last_seen > ?').get(now() - 86400e3).n,
      cars: q('SELECT COUNT(*) n FROM cars').get().n,
      stars: q('SELECT COALESCE(SUM(stars), 0) n FROM payments').get().n,
    };
  }

  // ---------- admin panel ----------
  // Every admin action is written to admin_log with who did it, so changes can be traced later.
  // The reason typed in the panel's confirm dialog (adminCall) is added to whatever the action logs.
  const actx = { reason: null };
  function alog(who, action, target, details) {
    const d = actx.reason && !(details && details.reason) ? { ...(details || {}), reason: actx.reason } : details;
    q('INSERT INTO admin_log (admin, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(String(who), action, target ?? null, d == null ? null : JSON.stringify(d), now());
  }
  // SQLite's lower() only folds ASCII; player names are mostly Cyrillic.
  try {
    db.function('ulower', { deterministic: true }, (v) => (v == null ? null : String(v).toLowerCase()));
  } catch {}
  // The player's day in user_days, and his sessions that day: a call after a gap over M.SESSION_GAP_MS (or the first
  // one of a new day) starts a new session.
  function markDay(uid) {
    const t = now(), day = dayOf(t);
    const prev = q('SELECT session_at FROM users WHERE id = ?').get(uid)?.session_at || 0;
    const fresh = t - prev > M.SESSION_GAP_MS || dayOf(prev) !== day ? 1 : 0;
    q('UPDATE users SET session_at = ? WHERE id = ?').run(t, uid);
    q('INSERT INTO user_days (day, user_id, sessions) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET sessions = sessions + excluded.sessions WHERE excluded.sessions > 0')
      .run(day, uid, fresh);
  }
  const isBanned = (uid) => !!q('SELECT banned FROM users WHERE id = ?').get(uid)?.banned;
  const userBrief = (u) => ({
    id: u.id, name: name(u.id), username: u.username, firstName: u.first_name, balance: u.balance, value: u.total_value,
    level: u.level, banned: !!u.banned, lastSeen: u.last_seen, createdAt: u.created_at, cars: u.cars,
    referrer: u.referrer_id ? { id: u.referrer_id, name: name(u.referrer_id) } : null, cases: u.cases_opened, playMs: u.play_ms, role: (opts.admins || []).includes(u.id) ? 'owner' : u.role || null,
  });
  const sum = (sql, ...a) => q(sql).get(...a).n;
  function adminOverview() {
    const day = now() - 86400e3;
    const byModel = q('SELECT model, COUNT(*) n FROM cars WHERE owner_id <> 0 GROUP BY model').all();
    const classes = Object.fromEntries(S.CLASS_ORDER.map((c) => [c, 0]));
    for (const r of byModel) if (S.MODELS[r.model]) classes[S.MODELS[r.model].cls] += r.n;
    return {
      users: sum('SELECT COUNT(*) n FROM users'),
      active24h: sum('SELECT COUNT(*) n FROM users WHERE last_seen > ?', day),
      active7d: sum('SELECT COUNT(*) n FROM users WHERE last_seen > ?', now() - 7 * 86400e3),
      new24h: sum('SELECT COUNT(*) n FROM users WHERE created_at > ?', day),
      banned: sum('SELECT COUNT(*) n FROM users WHERE banned = 1'),
      money: sum('SELECT COALESCE(SUM(balance), 0) n FROM users'),
      value: sum('SELECT COALESCE(SUM(total_value), 0) n FROM users'),
      cars: sum('SELECT COUNT(*) n FROM cars WHERE owner_id <> 0'),
      plates: sum('SELECT COUNT(*) n FROM plates'),
      stars: sum('SELECT COALESCE(SUM(stars), 0) n FROM payments'),
      stars24h: sum('SELECT COALESCE(SUM(stars), 0) n FROM payments WHERE created_at > ?', day),
      payments: sum('SELECT COUNT(*) n FROM payments'),
      cases: sum('SELECT COALESCE(SUM(cases_opened), 0) n FROM users'),
      drops24h: sum('SELECT COUNT(*) n FROM drops WHERE created_at > ?', day),
      listings: sum('SELECT COUNT(*) n FROM listings'),
      itemListings: sum('SELECT COUNT(*) n FROM item_listings'),
      auctions: sum("SELECT COUNT(*) n FROM auctions WHERE status = 'open'"),
      trades: sum("SELECT COUNT(*) n FROM trades WHERE status = 'open'"),
      crash24h: q("SELECT COUNT(*) games, COALESCE(SUM(bet), 0) bet, COALESCE(SUM(CASE WHEN status = 'won' THEN bet * cashout END), 0) paid FROM crash_games WHERE started_at > ?").get(day),
      mines24h: q('SELECT COUNT(*) games, COALESCE(SUM(bet), 0) bet FROM mines_games WHERE created_at > ?').get(day),
      classes,
      topModels: byModel.sort((a, b) => b.n - a.n).slice(0, 8).map((r) => ({ model: r.model, n: r.n })),
      richest: q('SELECT u.*, (SELECT COUNT(*) FROM cars c WHERE c.owner_id = u.id) cars FROM users u ORDER BY total_value + balance DESC LIMIT 10').all().map(userBrief),
      newest: q('SELECT u.*, (SELECT COUNT(*) FROM cars c WHERE c.owner_id = u.id) cars FROM users u ORDER BY created_at DESC LIMIT 8').all().map(userBrief),
    };
  }
  const USER_SORT = { value: 'u.total_value DESC', balance: 'u.balance DESC', seen: 'u.last_seen DESC', new: 'u.created_at DESC', level: 'u.level DESC, u.xp DESC', play: 'u.play_ms DESC' };
  function adminUsers({ query, sort, offset }) {
    const s = String(query ?? '').trim().replace(/^@/, '').toLowerCase().slice(0, 64);
    // LIKE wildcards typed by the admin are taken literally.
    const like = `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const where = s ? "WHERE CAST(u.id AS TEXT) LIKE ? ESCAPE '\\' OR ulower(u.username) LIKE ? ESCAPE '\\' OR ulower(u.first_name) LIKE ? ESCAPE '\\'" : '';
    const args = s ? [like, like, like] : [];
    const off = offset ? int(offset, 0, 1e9, 'Зсув') : 0;
    // An exact ID or @username comes first, whatever the sort.
    const exact = s ? '(CAST(u.id AS TEXT) = ? OR ulower(u.username) = ?) DESC, ' : '';
    const list = q(`SELECT u.*, (SELECT COUNT(*) FROM cars c WHERE c.owner_id = u.id) cars FROM users u ${where} ORDER BY ${exact}${USER_SORT[sort] || USER_SORT.value} LIMIT 50 OFFSET ?`)
      .all(...args, ...(s ? [s, s] : []), off).map(userBrief);
    return { list, total: q(`SELECT COUNT(*) n FROM users u ${where}`).get(...args).n };
  }
  function adminUser({ id }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    const u = userRow(uid);
    const listing = Object.fromEntries(q('SELECT car_id, id, price FROM listings WHERE seller_id = ?').all(uid).map((l) => [l.car_id, l]));
    const auction = Object.fromEntries(q("SELECT car_id, id, start_price, top_bid, ends_at FROM auctions WHERE seller_id = ? AND status = 'open'").all(uid).map((a) => [a.car_id, a]));
    return {
      user: {
        ...userBrief({ ...u, cars: null }), slots: u.slots, showcaseSlots: u.showcase_slots, capLevel: u.cap_level, xp: u.xp, xpNeed: S.xpForLevel(u.level),
        streak: u.streak, stats: { cases: u.cases_opened, races: u.races, wins: u.wins, merges: u.merges },
        banReason: u.ban_reason, referrer: u.referrer_id ? { id: u.referrer_id, name: name(u.referrer_id) } : null,
        referrals: q('SELECT COUNT(*) n FROM users WHERE referrer_id = ?').get(uid).n,
        luck: luckOf(uid), luckBonus: u.luck_bonus, luckLeft: u.luck_bonus_left, role: roleOf(uid),
        achievements: (() => { const s = achievementState(uid); return { claimed: s.reduce((n, x) => n + x.claimed, 0), reached: s.reduce((n, x) => n + x.reached, 0), total: S.ACHIEVEMENTS.reduce((n, a) => n + a.goals.length, 0) }; })(),
        rigs: q('SELECT id, model, created_at createdAt FROM rigged_drops WHERE user_id = ? AND used_at IS NULL ORDER BY id').all(uid),
        invited: q('SELECT id, level, total_value, created_at, last_seen, ref_paid FROM users WHERE referrer_id = ? ORDER BY created_at DESC LIMIT 200').all(uid)
          .map((f) => ({ id: f.id, name: name(f.id), level: f.level, value: f.total_value, createdAt: f.created_at, lastSeen: f.last_seen, paid: !!f.ref_paid })),
        collection: q('SELECT COUNT(*) n FROM collection WHERE user_id = ?').get(uid).n,
        stars: u.stars, vipUntil: u.vip_until, premiumSeason: u.premium_season,
        // A player of the first (pre-reset) version: who invited them back then, Stars donated, thanked or not.
        legacy: (() => { const l = q('SELECT referrer_id, stars, thanked FROM legacy WHERE id = ?').get(uid); return l ? { referrer: l.referrer_id, stars: l.stars, thanked: !!l.thanked } : null; })(),
        activeDays: q('SELECT COUNT(*) n FROM user_days WHERE user_id = ?').get(uid).n,
      },
      fragments: q('SELECT case_id caseId, count FROM fragments WHERE user_id = ? AND count > 0').all(uid),
      income: incomeState(u),
      activity: playerActivity(uid),
      cars: q('SELECT * FROM cars WHERE owner_id = ? ORDER BY id').all(uid).map((c) => ({ ...carOut(c), listing: listing[c.id] || null, auction: auction[c.id] || null })),
      plates: q('SELECT id, text, cls, value, car_id carId FROM plates WHERE owner_id = ? ORDER BY value DESC').all(uid),
      parts: inventory(uid),
      keys: q('SELECT case_id caseId, count FROM keys WHERE user_id = ? AND count > 0').all(uid),
      payments: q('SELECT charge_id chargeId, pack, stars, amount, created_at at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(uid),
      events: q('SELECT text, created_at at FROM events WHERE user_id = ? ORDER BY id DESC LIMIT 40').all(uid),
      drops: q('SELECT case_id caseId, item, cls, forced, created_at at FROM drops WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(uid),
      log: q('SELECT id, admin, action, details, created_at at FROM admin_log WHERE target = ? ORDER BY id DESC LIMIT 50').all(uid),
    };
  }
  // Everything a player has done, summed up from the game's own records (for the admin player card).
  function playerActivity(uid) {
    const carDrops = q("SELECT case_id, cls, COUNT(*) n FROM drops WHERE user_id = ? AND item NOT LIKE '%:%' GROUP BY case_id, cls").all(uid);
    const byCase = {}, byClass = Object.fromEntries(S.CLASS_ORDER.map((c) => [c, 0]));
    for (const r of carDrops) {
      byCase[r.case_id] = (byCase[r.case_id] || 0) + r.n;
      byClass[r.cls] = (byClass[r.cls] || 0) + r.n;
    }
    const crash = q("SELECT COUNT(*) games, COALESCE(SUM(bet), 0) bet, COALESCE(SUM(CASE WHEN status = 'won' THEN bet * cashout END), 0) paid, SUM(status = 'won') wins FROM crash_games WHERE user_id = ?").get(uid);
    const mines = q("SELECT COUNT(*) games, COALESCE(SUM(bet), 0) bet, SUM(status = 'won') wins FROM mines_games WHERE user_id = ?").get(uid);
    const battles = q("SELECT COUNT(*) n, SUM(winner_id = ?) won, SUM(winner_id IS NULL) ties, COALESCE(SUM(price), 0) spent FROM battles WHERE status = 'done' AND (creator_id = ? OR opponent_id = ?)").get(uid, uid, uid);
    const pvp = q("SELECT COUNT(*) n, SUM(winner_id = ?) won, COALESCE(SUM(bet), 0) bets FROM pvp WHERE status = 'done' AND (creator_id = ? OR opponent_id = ?)").get(uid, uid, uid);
    return {
      cases: { byCase, byClass, total: carDrops.reduce((s, r) => s + r.n, 0), parts: q("SELECT COUNT(*) n FROM drops WHERE user_id = ? AND item LIKE '%:%'").get(uid).n },
      crash: { ...crash, wins: crash.wins || 0, paid: Math.round(crash.paid) },
      mines: { ...mines, wins: mines.wins || 0 },
      battles: { n: battles.n, won: battles.won || 0, ties: battles.ties || 0, spent: battles.spent },
      pvp: { n: pvp.n, won: pvp.won || 0, bets: pvp.bets },
      trades: q("SELECT COUNT(*) n FROM trades WHERE status = 'done' AND (from_id = ? OR to_id = ?)").get(uid, uid).n
        + q("SELECT COUNT(*) n FROM trade_rooms WHERE status = 'done' AND (host_id = ? OR guest_id = ?)").get(uid, uid).n,
      auctions: {
        sold: q("SELECT COUNT(*) n, COALESCE(SUM(top_bid), 0) sum FROM auctions WHERE seller_id = ? AND status = 'done' AND top_bidder IS NOT NULL").get(uid),
        won: q("SELECT COUNT(*) n, COALESCE(SUM(top_bid), 0) sum FROM auctions WHERE top_bidder = ? AND status = 'done'").get(uid),
      },
      listed: q('SELECT COUNT(*) n FROM listings WHERE seller_id = ?').get(uid).n,
      stars: q('SELECT COUNT(*) n, COALESCE(SUM(stars), 0) stars, COALESCE(SUM(amount), 0) amount FROM payments WHERE user_id = ?').get(uid),
      promos: q('SELECT code FROM promo_uses WHERE user_id = ?').all(uid).map((r) => r.code),
      plates: q('SELECT COUNT(*) n, COALESCE(SUM(value), 0) value FROM plates WHERE owner_id = ?').get(uid),
      best: (() => {
        const c = q('SELECT * FROM cars WHERE owner_id = ?').all(uid).map((x) => ({ model: x.model, value: carValueOf(x) })).sort((a, b) => b.value - a.value)[0];
        return c || null;
      })(),
    };
  }
  // Owners (ADMIN_IDS) and everyone with a panel role.
  const staffIds = () => [...new Set([...(opts.admins || []), ...q("SELECT id FROM users WHERE role IN ('admin', 'helper')").all().map((r) => r.id)])];
  // Release notes for the team: on start, every changelog entry not announced yet goes to the owners, admins and
  // helpers in one message (src/changelog.json, newest first). A fresh database announces only the newest entry.
  function announceUpdates(log = [], { send = notify } = {}) {
    const list = Array.isArray(log) ? log.filter((e) => e && e.id && Array.isArray(e.items)) : [];
    if (!list.length) return { sent: 0 };
    const last = metaGet('changelog_sent');
    const idx = last ? list.findIndex((e) => e.id === last) : 1;
    const fresh = list.slice(0, idx < 0 ? list.length : idx);
    if (!fresh.length) return { sent: 0 };
    metaSet('changelog_sent', list[0].id);
    const text = ['🆕 Вийшло оновлення АВТОДРОП', ...fresh.map((e) => `\n${e.title ? `${e.title}\n` : ''}${e.items.map((i) => `• ${i}`).join('\n')}`)].join('\n').slice(0, 3900);
    const ids = staffIds();
    for (const id of ids) {
      try {
        send(id, text);
      } catch {}
    }
    return { sent: ids.length, entries: fresh.length };
  }
  // ---------- roles in the admin panel ----------
  // owner: in ADMIN_IDS (Railway variable) — can't be changed from the panel; admin: everything; helper: only
  // looking at players, answering support and writing messages (HELPER_ACTIONS).
  const HELPER_ACTIONS = new Set(['overview', 'dashboard', 'users', 'user', 'search', 'check-plate', 'referrals', 'support', 'support/reply', 'message', 'market', 'log', 'game-events']);
  function roleOf(uid) {
    if (!uid) return null;
    if ((opts.admins || []).includes(uid)) return 'owner';
    return q('SELECT role FROM users WHERE id = ?').get(uid)?.role || null;
  }
  // Who made an admin call: 'key' / 'local' are the owner; 'tg:<id>' is whatever role that player has.
  const actorRole = (who) => (String(who).startsWith('tg:') ? roleOf(Number(String(who).slice(3))) : 'owner');
  const canDo = (role, action) => role === 'owner' || role === 'admin' || (role === 'helper' && HELPER_ACTIONS.has(action));
  function adminSetRole(who, { id, role }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    const r = role === 'admin' || role === 'helper' ? role : null;
    const me = actorRole(who);
    if (roleOf(uid) === 'owner') fail('Це власник гри — його права змінюються тільки на сервері');
    if (me !== 'owner' && (r === 'admin' || roleOf(uid) === 'admin')) fail('Видавати й забирати адмінку може лише власник');
    q('UPDATE users SET role = ? WHERE id = ?').run(r, uid);
    alog(who, 'role', uid, { role: r });
    if (r) event(uid, `🛡 Тобі видано права «${r === 'admin' ? 'Адмін' : 'Хелпер'}» — адмін-панель у меню гри`);
    return { role: r };
  }
  // ---------- support: the player writes from the game, admins get it in Telegram and answer from the panel ----------
  const SUPPORT_GAP_MS = 60e3, SUPPORT_OPEN_MAX = 5;
  function supportSend(uid, { text }) {
    const t = String(text ?? '').trim().slice(0, 1000);
    if (t.length < 3) fail('Опиши питання хоча б кількома словами');
    const last = q('SELECT created_at FROM support WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(uid);
    if (last && now() - last.created_at < SUPPORT_GAP_MS) fail('Зачекай хвилинку перед наступним повідомленням');
    if (q('SELECT COUNT(*) n FROM support WHERE user_id = ? AND answer IS NULL').get(uid).n >= SUPPORT_OPEN_MAX) fail('Дочекайся відповіді на попередні повідомлення');
    const id = Number(q('INSERT INTO support (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, t, now()).lastInsertRowid);
    // The owner(s) and everyone with a panel role (admin, helper) hear about it; the writer never pings themself.
    const staff = new Set(staffIds());
    staff.delete(uid);
    for (const a of staff) {
      try {
        notify(a, `🆘 Підтримка #${id} від ${name(uid)} (ID ${uid}):\n\n${t}\n\nВідповісти: адмін-панель → Підтримка`);
      } catch {}
    }
    return { id };
  }
  function supportMine(uid) {
    return { list: q('SELECT id, text, created_at at, answer, answered_at answeredAt FROM support WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(uid) };
  }
  function adminSupport({ open }) {
    const rows = q(`SELECT * FROM support ${open ? 'WHERE answer IS NULL' : ''} ORDER BY answer IS NOT NULL, id DESC LIMIT 200`).all();
    return { list: rows.map((r) => ({ id: r.id, user: brief(r.user_id), text: r.text, at: r.created_at, answer: r.answer, answeredAt: r.answered_at, by: r.answered_by })),
      open: q('SELECT COUNT(*) n FROM support WHERE answer IS NULL').get().n };
  }
  // The answer reaches the player like an admin message: a window in the game, a notification and the bot.
  function adminSupportReply(who, { id, text }) {
    const r = q('SELECT * FROM support WHERE id = ?').get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID'));
    if (!r) fail('Повідомлення не знайдено');
    const t = String(text ?? '').trim().slice(0, 1000);
    if (!t) fail('Напиши відповідь');
    q('UPDATE support SET answer = ?, answered_at = ?, answered_by = ? WHERE id = ?').run(t, now(), who, r.id);
    event(r.user_id, `💬 Відповідь підтримки: ${t}`);
    gift(r.user_id, 'message', {}, `Відповідь підтримки на «${r.text.slice(0, 80)}${r.text.length > 80 ? '…' : ''}»:\n\n${t}`);
    alog(who, 'support', r.user_id, { text: t });
    return {};
  }
  // Admin gifts and messages also pop up in the player's app as a window showing what arrived (once).
  function gift(uid, kind, data, note) {
    q('INSERT INTO gifts (user_id, kind, data, note, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, kind, JSON.stringify(data), note ? String(note).slice(0, 1000) : null, now());
  }
  function giftsSeen(uid, { ids }) {
    for (const id of idList(ids, 50)) q('UPDATE gifts SET shown = 1 WHERE id = ? AND user_id = ?').run(id, uid);
    return {};
  }
  function adminMoney(who, { id, amount, note }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    const n = int(amount, -1e13, 1e13, 'Сума');
    if (!n) fail('Вкажи суму');
    const before = userRow(uid).balance;
    q('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?').run(n, uid);
    const after = userRow(uid).balance;
    moneyFlow(after - before);
    if (note) event(uid, `${n > 0 ? '🎁' : '⚠️'} ${String(note).slice(0, 300)} (${n > 0 ? '+' : ''}${S.fmt(after - before)})`);
    if (n > 0) gift(uid, 'money', { amount: after - before }, note);
    alog(who, 'money', uid, { amount: after - before, note: note || null });
    return { balance: after };
  }
  function adminGiveCar(who, { id, model, notify: tell }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    if (!S.MODELS[model]) fail('Невідома модель');
    bank(uid);
    const c = giveCar(uid, model);
    if (tell) {
      event(uid, `🎁 Адміністрація подарувала тобі ${S.MODELS[model].name}!`);
      gift(uid, 'car', { model, carId: c.id });
    }
    alog(who, 'give-car', uid, { model, carId: c.id });
    return c;
  }
  // Premium pass of the current season or VIP days, as a gift. Owner only (not admins): these are paid Stars items.
  function adminGrantPremium(who, { id, what, days }) {
    if (actorRole(who) !== 'owner') fail('Пропуск і VIP може видавати лише власник');
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    const u = userRow(uid);
    if (what === 'pass') {
      const season = S.seasonOf(now());
      if (u.premium_season === season) fail('У гравця вже є преміум-пропуск цього сезону');
      q('UPDATE users SET premium_season = ? WHERE id = ?').run(season, uid);
      event(uid, '🎁 Адміністрація подарувала тобі преміум-пропуск сезону!');
      alog(who, 'grant-premium', uid, { what, season });
      return { what, season };
    }
    if (what === 'vip') {
      const d = int(days ?? 7, 1, 365, 'Днів');
      bank(uid);
      const until = Math.max(u.vip_until || 0, now()) + d * 86400e3;
      q('UPDATE users SET vip_until = ? WHERE id = ?').run(until, uid);
      event(uid, `🎁 Адміністрація подарувала тобі VIP на ${d} дн.!`);
      alog(who, 'grant-premium', uid, { what, days: d, until });
      return { what, until };
    }
    fail('Невідомо, що видати');
  }
  // Takes a car out of the game: closes its market lot, auction (refunding the leader) and PvP challenge first.
  function adminRemoveCar(who, { carId }) {
    const c = carRow(int(carId, 1, Number.MAX_SAFE_INTEGER, 'ID авто'));
    if (!c) fail('Авто не знайдено');
    bank(c.owner_id);
    q('DELETE FROM listings WHERE car_id = ?').run(c.id);
    for (const a of q("SELECT * FROM auctions WHERE car_id = ? AND status = 'open'").all(c.id)) {
      if (a.top_bidder) addMoney(a.top_bidder, a.top_bid);
      q("UPDATE auctions SET status = 'cancelled' WHERE id = ?").run(a.id);
    }
    for (const p of q("SELECT * FROM pvp WHERE car_id = ? AND status = 'open'").all(c.id)) {
      addMoney(p.creator_id, p.bet);
      q("UPDATE pvp SET status = 'cancelled' WHERE id = ?").run(p.id);
    }
    stripCar(c.owner_id, c.id);
    q('DELETE FROM cars WHERE id = ?').run(c.id);
    q('DELETE FROM rivals WHERE car_id = ?').run(c.id);
    invalidateTrades([c.id]);
    recalc(c.owner_id);
    alog(who, 'remove-car', c.owner_id, { carId: c.id, model: c.model });
    return {};
  }
  function adminGivePart(who, { id, type, tier, count }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    if (!S.PARTS[type] || !S.TIER_BY_ID[tier]) fail('Невідома деталь');
    const n = int(count, -1000, 1000, 'Кількість');
    if (!n) fail('Вкажи кількість');
    const had = q('SELECT count FROM parts WHERE user_id = ? AND type = ? AND tier = ?').get(uid, type, tier)?.count || 0;
    if (n > 0) {
      addPart(uid, type, tier, n);
      gift(uid, 'part', { type, tier, count: n });
    } else q('UPDATE parts SET count = MAX(0, count + ?) WHERE user_id = ? AND type = ? AND tier = ?').run(n, uid, type, tier);
    // What really changed (taking 5 from someone who has 2 takes 2).
    alog(who, 'part', uid, { type, tier, count: n > 0 ? n : -Math.min(had, -n) });
    return {};
  }
  function adminGiveKeys(who, { id, caseId, count }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    if (!S.CASE_BY_ID[caseId]) fail('Невідомий кейс');
    const n = int(count, -1000, 1000, 'Кількість');
    if (!n) fail('Вкажи кількість');
    const had = q('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, caseId)?.count || 0;
    if (n > 0) {
      addKeys(uid, caseId, n);
      gift(uid, 'keys', { caseId, count: n });
    } else q('UPDATE keys SET count = MAX(0, count + ?) WHERE user_id = ? AND case_id = ?').run(n, uid, caseId);
    alog(who, 'keys', uid, { caseId, count: n > 0 ? n : -Math.min(had, -n) });
    return {};
  }
  const USER_FIELDS = {
    level: [1, 999], slots: [1, S.MAX_SLOTS], showcase_slots: [0, S.SHOWCASE_MAX], cap_level: [0, S.CAP_LEVELS.length - 1], xp: [0, 1e9],
  };
  // Plates are unique across the game, so a requested plate is only issued if nobody owns it yet.
  function checkPlate(raw) {
    const text = S.normalizePlate(raw);
    const m = /^([A-Z]{2}) (\d{4}) ([A-Z]{2})$/.exec(text);
    if (!m) return { text, error: 'Формат номера: AA 1234 BC' };
    if (!S.REGIONS[m[1]]) return { text, error: `Регіону ${m[1]} не існує` };
    if (![...m[3]].every((c) => S.PLATE_LETTERS.includes(c))) return { text, error: `На номерах є лише літери ${S.PLATE_LETTERS}` };
    const owner = q('SELECT owner_id FROM plates WHERE text = ?').get(text);
    return { text, region: S.REGIONS[m[1]], ...S.plateInfo(text), owner: owner ? { id: owner.owner_id, name: name(owner.owner_id) } : null };
  }
  function adminGivePlate(who, { id, text, value, carId, note }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    const p = checkPlate(text);
    if (p.error) fail(p.error);
    if (p.owner) fail(`Номер ${p.text} уже має ${p.owner.name}`);
    const [lo, hi] = S.PLATE_VALUE[p.cls];
    const v = value ? int(value, 0, 1e12, 'Вартість') : Math.round((lo + hi) / 2 / 100) * 100;
    bank(uid);
    const r = q('INSERT INTO plates (owner_id, text, cls, value, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, p.text, p.cls, v, now());
    const plateId = Number(r.lastInsertRowid);
    if (carId) {
      const c = carRow(int(carId, 1, Number.MAX_SAFE_INTEGER, 'ID авто'));
      if (!c || c.owner_id !== uid) fail('Це авто не належить гравцю');
      if (carPlate(c.id)) fail('На цьому авто вже є номер');
      q('UPDATE plates SET car_id = ? WHERE id = ?').run(c.id, plateId);
    }
    const msg = String(note ?? '').trim().slice(0, 300);
    event(uid, msg ? `🎁 ${msg} — номер ${p.text}` : `🎁 Адміністрація видала тобі номер ${p.text}!`);
    gift(uid, 'plate', { text: p.text, cls: p.cls, value: v }, msg);
    alog(who, 'give-plate', uid, { text: p.text, cls: p.cls, value: v, note: msg || null });
    return { id: plateId, text: p.text, cls: p.cls, value: v };
  }
  function adminRemovePlate(who, { plateId }) {
    const p = q('SELECT * FROM plates WHERE id = ?').get(int(plateId, 1, Number.MAX_SAFE_INTEGER, 'ID номера'));
    if (!p) fail('Номер не знайдено');
    bank(p.owner_id);
    q('DELETE FROM item_listings WHERE plate_id = ?').run(p.id);
    q('DELETE FROM plates WHERE id = ?').run(p.id);
    recalc(p.owner_id);
    alog(who, 'remove-plate', p.owner_id, { text: p.text });
    return {};
  }
  // One search box over every player's inventory: plates by text, cars by model name.
  function adminSearch({ query }) {
    const raw = String(query ?? '').trim().slice(0, 64);
    if (raw.length < 2) return { plates: [], cars: [], exact: null };
    const exact = /^[A-Z]{2} \d{4} [A-Z]{2}$/.test(S.normalizePlate(raw)) ? checkPlate(raw) : null;
    const pq = S.normalizePlate(raw).replace(/ /g, '');
    const plates = pq.length >= 2 ? q("SELECT p.*, c.model FROM plates p LEFT JOIN cars c ON c.id = p.car_id WHERE REPLACE(p.text, ' ', '') LIKE ? ORDER BY p.value DESC LIMIT 200").all(`%${pq}%`)
      .map((p) => ({ id: p.id, text: p.text, cls: p.cls, value: p.value, carModel: p.model || null, owner: { id: p.owner_id, name: name(p.owner_id) } })) : [];
    const low = raw.toLowerCase();
    const models = S.ALL_MODELS.filter((m) => m.name.toLowerCase().includes(low) || m.id.includes(low)).map((m) => m.id).slice(0, 100);
    const cars = models.length ? q(`SELECT * FROM cars WHERE model IN (${models.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 300`).all(...models)
      .map((c) => ({ ...carOut(c), owner: { id: c.owner_id, name: name(c.owner_id) } })) : [];
    return { plates, cars, exact };
  }
  function adminSetUser(who, { id, field, value }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    // Own keys only: 'constructor' / '__proto__' must not slip into the SQL below.
    const range = Object.hasOwn(USER_FIELDS, String(field)) ? USER_FIELDS[field] : null;
    if (!range) fail('Це поле не можна змінювати');
    const v = int(value, range[0], range[1], 'Значення');
    const was = userRow(uid)[field];
    bank(uid);
    q(`UPDATE users SET ${field} = ?${field === 'level' ? ', level_seen = ?' : ''} WHERE id = ?`).run(...(field === 'level' ? [v, v, uid] : [v, uid]));
    alog(who, 'set', uid, { field, value: v, was });
    return {};
  }
  function adminBan(who, { id, banned, reason }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    const r = banned ? String(reason || '').slice(0, 200) || null : null;
    q('UPDATE users SET banned = ?, ban_reason = ? WHERE id = ?').run(banned ? 1 : 0, r, uid);
    if (banned) {
      // A banned player's lots leave the market so nobody buys from a frozen account.
      for (const l of q('SELECT id FROM listings WHERE seller_id = ?').all(uid)) adminMarketRemove(who, { kind: 'listing', id: l.id }, false);
      for (const a of q("SELECT id FROM auctions WHERE seller_id = ? AND status = 'open'").all(uid)) adminMarketRemove(who, { kind: 'auction', id: a.id }, false);
      for (const l of q('SELECT * FROM item_listings WHERE seller_id = ?').all(uid)) closeItemLot(l);
    }
    alog(who, banned ? 'ban' : 'unban', uid, r ? { reason: r } : null);
    return {};
  }
  // Wipes one player's progress back to a fresh start. Kept: the account itself, who invited them, payments,
  // ban status, the fairness seed and drop history. Their open deals are closed first so nobody else loses money.
  function adminResetUser(who, { id, reason }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    const balanceBefore = userRow(uid).balance;
    const t = now();
    for (const l of q('SELECT id FROM listings WHERE seller_id = ?').all(uid)) q('DELETE FROM listings WHERE id = ?').run(l.id);
    q('DELETE FROM item_listings WHERE seller_id = ?').run(uid); // their parts and plates are wiped below anyway
    for (const a of q("SELECT * FROM auctions WHERE seller_id = ? AND status = 'open'").all(uid)) {
      if (a.top_bidder) {
        addMoney(a.top_bidder, a.top_bid);
        event(a.top_bidder, `🔨 Аукціон скасовано адміністрацією — ставку ${S.fmt(a.top_bid)} повернуто`);
      }
      q("UPDATE auctions SET status = 'cancelled' WHERE id = ?").run(a.id);
    }
    // Their leading bids on other people's auctions are dropped; the money was already taken and the balance resets anyway.
    q("UPDATE auctions SET top_bid = NULL, top_bidder = NULL WHERE top_bidder = ? AND status = 'open'").run(uid);
    q("UPDATE pvp SET status = 'cancelled' WHERE creator_id = ? AND status = 'open'").run(uid);
    q("UPDATE battles SET status = 'cancelled', finished_at = ? WHERE creator_id = ? AND status = 'open'").run(t, uid);
    q("UPDATE trades SET status = 'cancelled', updated_at = ? WHERE status = 'open' AND (from_id = ? OR to_id = ?)").run(t, uid, uid);
    for (const r of q("SELECT * FROM trade_rooms WHERE status IN ('open', 'active') AND (host_id = ? OR guest_id = ?)").all(uid, uid)) {
      if (r.host_id === uid) q("UPDATE trade_rooms SET status = 'closed', updated_at = ? WHERE id = ?").run(t, r.id);
      else dropGuest(r, 'вийшов з кімнати');
    }
    q("UPDATE crash_games SET status = 'lost' WHERE user_id = ? AND status = 'running'").run(uid);
    q("UPDATE mines_games SET status = 'lost' WHERE user_id = ? AND status = 'running'").run(uid);
    const carIds = q('SELECT id FROM cars WHERE owner_id = ?').all(uid).map((c) => c.id);
    invalidateTrades(carIds);
    for (const cid of carIds) {
      q('DELETE FROM car_parts WHERE car_id = ?').run(cid);
      q('DELETE FROM rivals WHERE car_id = ?').run(cid);
    }
    q('DELETE FROM cars WHERE owner_id = ?').run(uid);
    for (const table of ['parts', 'parts_cool', 'keys', 'collection', 'claims', 'pity', 'quests']) q(`DELETE FROM ${table} WHERE user_id = ?`).run(uid);
    q('DELETE FROM plates WHERE owner_id = ?').run(uid);
    q('DELETE FROM races WHERE user_id = ? AND status = ?').run(uid, 'running');
    q(`UPDATE users SET balance = ?, slots = ?, showcase_slots = ?, cap_level = 0, income_at = ?, banked = 0, fuel = ?, fuel_at = ?,
       level = 1, level_seen = 1, xp = 0, xp_day = NULL, xp_day_capped = 0, newbie_step = 0, newbie_flags = '[]', feats = '[]',
       streak = 0, streak_day = NULL, reward_case_at = 0, total_value = 0, week_id = ?, week_start_value = 0, last_week_id = NULL, last_week_growth = NULL,
       cases_opened = 0, races = 0, wins = 0, merges = 0 WHERE id = ?`)
      .run(S.START_BALANCE, S.START_SLOTS, S.SHOWCASE_START, t, S.FUEL_MAX, t, weekOf(t), uid);
    addKeys(uid, 'starter', 1);
    moneyFlow(S.START_BALANCE - balanceBefore);
    const why = String(reason ?? '').trim().slice(0, 200);
    event(uid, `♻️ Адміністрація обнулила твій прогрес${why ? `: ${why}` : ''}. Починай заново — стартовий кейс уже чекає!`);
    alog(who, 'reset', uid, { cars: carIds.length, balance: balanceBefore, reason: why || null });
    return { cars: carIds.length };
  }
  // Luck for a player: chance (0–100 %) that each of their next `opens` case rolls is thrown twice, the better kept.
  function adminLuck(who, { id, chance, opens }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    const c = int(chance, 0, 100, 'Шанс');
    const n = c ? int(opens, 1, 10000, 'Кількість відкриттів') : 0;
    q('UPDATE users SET luck_bonus = ?, luck_bonus_left = ? WHERE id = ?').run(c / 100, n, uid);
    alog(who, 'luck', uid, { chance: c, opens: n });
    return { luckBonus: c / 100, luckLeft: n };
  }
  // A guaranteed car: it drops from the player's next opened case that contains it.
  function adminRig(who, { id, model }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    const m = S.MODELS[model];
    if (!m || m.secret) fail('Обери звичайну (не секретну) машину');
    const cases = S.CASES.filter((cs) => !cs.starter && cs.weights[m.cls] && cs.pool(m.cls).some((x) => x.id === m.id));
    if (!cases.length) fail('Ця машина не випадає з жодного кейса');
    const r = q('INSERT INTO rigged_drops (user_id, model, created_at) VALUES (?, ?, ?)').run(uid, m.id, now());
    alog(who, 'rig', uid, { model: m.id });
    return { id: Number(r.lastInsertRowid), cases: cases.map((cs) => cs.id) };
  }
  function adminRigCancel(who, { rigId }) {
    const r = q('SELECT * FROM rigged_drops WHERE id = ? AND used_at IS NULL').get(int(rigId, 1, Number.MAX_SAFE_INTEGER));
    if (!r) fail('Вже випала або скасована');
    q('DELETE FROM rigged_drops WHERE id = ?').run(r.id);
    alog(who, 'rig-cancel', r.user_id, { model: r.model });
    return {};
  }
  function adminMessage(who, { id, text }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    const t = String(text || '').trim().slice(0, 1000);
    if (!t) fail('Порожнє повідомлення');
    event(uid, `📢 ${t}`);
    gift(uid, 'message', {}, t);
    alog(who, 'message', uid, { text: t });
    return {};
  }
  function adminMarket() {
    return {
      listings: q('SELECT * FROM listings ORDER BY id DESC LIMIT 300').all().map((l) => ({ id: l.id, price: l.price, at: l.created_at, seller: { id: l.seller_id, name: name(l.seller_id) }, car: carOut(carRow(l.car_id)) })),
      auctions: q("SELECT * FROM auctions WHERE status = 'open' ORDER BY ends_at LIMIT 300").all().map((a) => ({
        id: a.id, startPrice: a.start_price, topBid: a.top_bid, bids: a.bids, endsAt: a.ends_at, seller: { id: a.seller_id, name: name(a.seller_id) },
        leader: a.top_bidder ? { id: a.top_bidder, name: name(a.top_bidder) } : null, car: carOut(carRow(a.car_id)),
      })),
      items: q('SELECT l.*, p.text FROM item_listings l LEFT JOIN plates p ON p.id = l.plate_id ORDER BY l.id DESC LIMIT 300').all().map((l) => ({
        id: l.id, kind: l.kind, price: l.price, count: l.count, base: l.base, at: l.created_at, expiresAt: l.expires_at, seller: { id: l.seller_id, name: name(l.seller_id) },
        part: l.kind === 'part' ? { type: l.part_type, tier: l.part_tier } : null, plate: l.kind === 'plate' ? { id: l.plate_id, text: l.text } : null,
      })),
    };
  }
  function adminMarketRemove(who, { kind, id }, log = true) {
    const lid = int(id, 1, 1e15, 'ID');
    let sellerId, carId;
    if (kind === 'item') {
      const l = q('SELECT * FROM item_listings WHERE id = ?').get(lid);
      if (!l) fail('Лот не знайдено');
      const what = itemName(l);
      closeItemLot(l);
      event(l.seller_id, `🛑 Адміністрація зняла твій лот «${what}» з ринку — ${l.kind === 'part' ? 'деталі повернулися на склад' : 'номер знову вільний'}`);
      if (log) alog(who, 'market-remove', l.seller_id, { kind, id: lid });
      return {};
    }
    if (kind === 'listing') {
      const l = q('SELECT * FROM listings WHERE id = ?').get(lid);
      if (!l) fail('Лот не знайдено');
      q('DELETE FROM listings WHERE id = ?').run(l.id);
      [sellerId, carId] = [l.seller_id, l.car_id];
    } else if (kind === 'auction') {
      const a = q("SELECT * FROM auctions WHERE id = ? AND status = 'open'").get(lid);
      if (!a) fail('Аукціон не знайдено');
      if (a.top_bidder) {
        addMoney(a.top_bidder, a.top_bid);
        event(a.top_bidder, `🔨 Аукціон знято адміністрацією — ставку ${S.fmt(a.top_bid)} повернуто`);
      }
      q("UPDATE auctions SET status = 'cancelled' WHERE id = ?").run(a.id);
      [sellerId, carId] = [a.seller_id, a.car_id];
    } else fail('Невідомий тип лоту');
    if (sellerId === DEALER_ID) {
      q('DELETE FROM cars WHERE id = ? AND owner_id = ?').run(carId, DEALER_ID);
      if (log) alog(who, 'market-remove', null, { kind, id: lid, dealer: true });
      return {};
    }
    bank(sellerId);
    q("UPDATE cars SET status = 'garage' WHERE id = ?").run(carId);
    event(sellerId, `🛑 Адміністрація зняла твій ${S.MODELS[carRow(carId).model].name} з ${kind === 'listing' ? 'ринку' : 'аукціону'} — авто повернулося в гараж`);
    if (log) alog(who, 'market-remove', sellerId, { kind, id: lid, carId });
    return {};
  }
  function adminPromos() {
    return { list: q('SELECT p.*, (SELECT COUNT(*) FROM promo_uses u WHERE u.code = p.code) used FROM promos p ORDER BY rowid DESC').all()
      .map((p) => ({ code: p.code, amount: p.amount, usesLeft: p.uses_left, used: p.used, expiresAt: p.expires_at })) };
  }
  function adminPromoCreate(who, { code, amount, uses, days }) {
    const c = createPromo(code, amount, uses, days || null);
    alog(who, 'promo', null, { code: c, amount: Number(amount), uses: Number(uses), days: days || null });
    return { code: c };
  }
  function adminPromoDelete(who, { code }) {
    const c = String(code || '').toUpperCase();
    if (!q('DELETE FROM promos WHERE code = ?').run(c).changes) fail('Промокод не знайдено');
    alog(who, 'promo-delete', null, { code: c });
    return {};
  }
  // Who brought whom: top inviters, the latest players who came by a link, and overall numbers.
  function adminReferrals() {
    const invitedRow = (u) => ({ id: u.id, name: name(u.id), level: u.level, value: u.total_value, createdAt: u.created_at, lastSeen: u.last_seen, paid: !!u.ref_paid });
    return {
      total: sum('SELECT COUNT(*) n FROM users WHERE referrer_id IS NOT NULL'),
      organic: sum('SELECT COUNT(*) n FROM users WHERE referrer_id IS NULL'),
      qualified: sum('SELECT COUNT(*) n FROM users WHERE ref_paid = 1'),
      reward: S.REF_REWARD,
      top: q(`SELECT referrer_id id, COUNT(*) n, SUM(ref_paid) paid, MAX(created_at) last FROM users
              WHERE referrer_id IS NOT NULL GROUP BY referrer_id ORDER BY n DESC, last DESC LIMIT 200`).all()
        .map((r) => ({ ...brief(r.id), invited: r.n, qualified: r.paid, earned: r.paid * S.REF_REWARD, last: r.last,
          friends: q('SELECT * FROM users WHERE referrer_id = ? ORDER BY created_at DESC LIMIT 100').all(r.id).map(invitedRow) })),
      recent: q('SELECT * FROM users WHERE referrer_id IS NOT NULL ORDER BY created_at DESC LIMIT 100').all()
        .map((u) => ({ ...invitedRow(u), referrer: { id: u.referrer_id, name: name(u.referrer_id) } })),
    };
  }
  function adminPayments({ offset }) {
    const off = offset ? int(offset, 0, 1e9, 'Зсув') : 0;
    return {
      list: q('SELECT charge_id chargeId, user_id userId, pack, stars, amount, created_at at FROM payments ORDER BY created_at DESC LIMIT 100 OFFSET ?').all(off).map((p) => ({ ...p, name: name(p.userId) })),
      total: q('SELECT COUNT(*) n, COALESCE(SUM(stars), 0) stars FROM payments').get(),
    };
  }
  // The action log with filters: who did it, which action, which player (ID or @username), a date range, text in details.
  function adminLog({ offset, admin: by, action, target, from, to, text }) {
    const off = offset ? int(offset, 0, 1e9, 'Зсув') : 0;
    const where = [], args = [];
    if (by) where.push('admin = ?'), args.push(String(by).slice(0, 64));
    if (action) where.push('action = ?'), args.push(String(action).slice(0, 32));
    if (target != null && String(target).trim()) {
      const t = String(target).trim().replace(/^@/, '').slice(0, 64);
      const id = /^\d{1,16}$/.test(t) ? Number(t) : q('SELECT id FROM users WHERE ulower(username) = ?').get(t.toLowerCase())?.id;
      where.push('target = ?'), args.push(id ?? -1);
    }
    if (from) where.push('created_at >= ?'), args.push(int(from, 0, 1e14, 'Дата'));
    if (to) where.push('created_at < ?'), args.push(int(to, 0, 1e14, 'Дата'));
    if (text && String(text).trim()) where.push("ulower(details) LIKE ? ESCAPE '\\'"), args.push(`%${String(text).trim().toLowerCase().slice(0, 64).replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return {
      list: q(`SELECT id, admin, action, target, details, created_at at FROM admin_log ${w} ORDER BY id DESC LIMIT 100 OFFSET ?`).all(...args, off)
        .map((r) => ({ ...r, targetName: r.target ? name(r.target) : null, adminName: adminName(r.admin) })),
      total: q(`SELECT COUNT(*) n FROM admin_log ${w}`).get(...args).n,
      admins: q('SELECT admin, COUNT(*) n FROM admin_log GROUP BY admin ORDER BY n DESC LIMIT 50').all().map((r) => ({ id: r.admin, name: adminName(r.admin), n: r.n })),
      actions: q('SELECT DISTINCT action FROM admin_log ORDER BY action').all().map((r) => r.action),
    };
  }
  // 'tg:123' → '@name'; 'key' / 'local' / 'bot' stay as they are.
  const adminName = (who) => (String(who).startsWith('tg:') ? name(Number(String(who).slice(3))) : String(who));

  // ---------- dashboard: activity, payments and economy health per Kyiv day ----------
  // Minutes Kyiv is ahead of UTC at time t (2 or 3 hours), so SQL can bucket timestamps by Kyiv day.
  function kyivOffset(t) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / 60e3) * 60e3;
  }
  function adminDashboard({ days }) {
    const n = days ? int(days, 7, 90, 'Днів') : 14;
    const t = now();
    const off = kyivOffset(t);
    const list = [...new Set(Array.from({ length: n }, (_, i) => dayOf(t - (n - 1 - i) * 86400e3)))];
    const first = list[0];
    const since = t - (n + 1) * 86400e3;
    const D = 'date((created_at + ?) / 1000, \'unixepoch\')';
    const by = (rows) => Object.fromEntries(rows.map((r) => [r.d, r]));
    const newU = by(q(`SELECT ${D} d, COUNT(*) n FROM users WHERE created_at >= ? GROUP BY d`).all(off, since));
    const cases = by(q(`SELECT ${D} d, COUNT(*) n, COUNT(DISTINCT user_id) u FROM drops WHERE created_at >= ? GROUP BY d`).all(off, since));
    const stars = by(q(`SELECT ${D} d, COUNT(*) n, COALESCE(SUM(stars), 0) stars, COUNT(DISTINCT user_id) u FROM payments WHERE created_at >= ? AND charge_id NOT LIKE 'legacy:%' GROUP BY d`).all(off, since));
    // Active = opened the game (user_days, written by every call) or left a trace in drops / payments (older days).
    const activeSql = (fromDay, fromT) => [`SELECT day d, user_id u FROM user_days WHERE day >= ?
      UNION SELECT ${D} d, user_id u FROM drops WHERE created_at >= ? UNION SELECT ${D} d, user_id u FROM payments WHERE created_at >= ?`, [fromDay, off, fromT, off, fromT]];
    const [aSql, aArgs] = activeSql(first, since);
    const dau = by(q(`SELECT d, COUNT(DISTINCT u) n FROM (${aSql}) GROUP BY d`).all(...aArgs));
    const distinct = (k) => {
      const [sq, a] = activeSql(dayOf(t - (k - 1) * 86400e3), t - (k + 1) * 86400e3);
      return q(`SELECT COUNT(DISTINCT u) n FROM (${sq}) WHERE d >= ?`).get(...a, dayOf(t - (k - 1) * 86400e3)).n;
    };
    const money = by(q('SELECT day d, created, destroyed FROM money_days WHERE day >= ?').all(first));
    // Money in players' hands at the end of each day, walked back from today's total with each day's net change.
    let supply = sum('SELECT COALESCE(SUM(balance), 0) n FROM users');
    const series = list.map((d) => ({
      day: d, dau: dau[d]?.n || 0, newUsers: newU[d]?.n || 0, cases: cases[d]?.n || 0, openers: cases[d]?.u || 0,
      stars: stars[d]?.stars || 0, payments: stars[d]?.n || 0, payers: stars[d]?.u || 0,
      created: money[d]?.created || 0, destroyed: money[d]?.destroyed || 0,
    }));
    for (let i = series.length - 1; i >= 0; i--) {
      series[i].supply = supply;
      supply -= series[i].created - series[i].destroyed;
    }
    const row = (u) => ({ id: u.id, name: name(u.id), level: u.level, value: u.total_value, balance: u.balance, banned: !!u.banned, lastSeen: u.last_seen });
    const week = t - 7 * 86400e3;
    return {
      days: series, today: dayOf(t),
      dau: dau[dayOf(t)]?.n || 0, wau: distinct(7), mau: distinct(30), users: sum('SELECT COUNT(*) n FROM users'),
      caseOfDay: { today: S.caseOfDay(dayOf(t)), tomorrow: S.caseOfDay(dayOf(t + 86400e3)), off: S.CASE_OF_DAY.off },
      top: {
        rich: q('SELECT * FROM users WHERE banned = 0 ORDER BY total_value + balance DESC LIMIT 10').all().map(row),
        payers: q("SELECT u.*, SUM(p.stars) stars, COUNT(*) n FROM payments p JOIN users u ON u.id = p.user_id WHERE p.charge_id NOT LIKE 'legacy:%' GROUP BY u.id ORDER BY stars DESC LIMIT 10").all()
          .map((u) => ({ ...row(u), stars: u.stars, payments: u.n })),
        active: q('SELECT u.*, COUNT(*) n FROM drops d JOIN users u ON u.id = d.user_id WHERE d.created_at >= ? GROUP BY u.id ORDER BY n DESC LIMIT 10').all(week)
          .map((u) => ({ ...row(u), drops: u.n })),
      },
    };
  }

  // ---------- broadcast: one message to every (or every recently active) player, in the game and through the bot ----------
  const BROADCAST_GAP_MS = 10 * 60e3, BROADCAST_AUDIENCE = { all: null, active30: 30, active7: 7, active1: 1 };
  function broadcastWhere(audience) {
    if (!Object.hasOwn(BROADCAST_AUDIENCE, String(audience))) fail('Невідома аудиторія');
    const d = BROADCAST_AUDIENCE[audience];
    return d ? ['banned = 0 AND last_seen >= ?', [now() - d * 86400e3]] : ['banned = 0', []];
  }
  function broadcastText(text) {
    const t = String(text ?? '').trim().slice(0, 1000);
    if (t.length < 3) fail('Напиши текст розсилки');
    return t;
  }
  function lastBroadcast() {
    return q("SELECT created_at FROM admin_log WHERE action = 'broadcast' ORDER BY id DESC LIMIT 1").get()?.created_at || 0;
  }
  function adminBroadcastPreview({ audience, text }) {
    const [w, a] = broadcastWhere(audience || 'all');
    const wait = Math.max(0, lastBroadcast() + BROADCAST_GAP_MS - now());
    return { recipients: q(`SELECT COUNT(*) n FROM users WHERE ${w}`).get(...a).n, text: text == null ? null : String(text).trim().slice(0, 1000), waitMs: wait,
      history: q("SELECT admin, details, created_at at FROM admin_log WHERE action = 'broadcast' ORDER BY id DESC LIMIT 10").all().map((r) => ({ ...r, adminName: adminName(r.admin) })) };
  }
  function adminBroadcast(who, { audience, text }) {
    const t = broadcastText(text);
    const wait = lastBroadcast() + BROADCAST_GAP_MS - now();
    if (wait > 0) fail(`Наступна розсилка — через ${Math.ceil(wait / 60e3)} хв`);
    const [w, a] = broadcastWhere(audience || 'all');
    const ids = q(`SELECT id FROM users WHERE ${w} ORDER BY id`).all(...a).map((r) => r.id);
    if (!ids.length) fail('Нікому надсилати');
    const at = now();
    // In the game: an event and the message window; the bot sends are paced by the server (opts.broadcast).
    q(`INSERT INTO events (user_id, text, created_at) SELECT id, ?, ? FROM users WHERE ${w}`).run(`📢 ${t}`, at, ...a);
    q(`INSERT INTO gifts (user_id, kind, data, note, created_at) SELECT id, 'message', '{}', ?, ? FROM users WHERE ${w}`).run(t, at, ...a);
    alog(who, 'broadcast', null, { text: t, audience: audience || 'all', recipients: ids.length });
    try {
      opts.broadcast?.(ids, `📢 ${t}`);
    } catch {}
    return { recipients: ids.length };
  }
  // ---------- game events: the calendar, and starting / stopping one right now ----------
  function adminGameEvents() {
    const t = now();
    const list = S.eventsBetween(t - 86400e3, t + 15 * 86400e3, evOv);
    return {
      now: t, caps: S.EVENT_CAPS, countries: S.MAIN_COUNTRIES,
      events: Object.fromEntries(S.EVENT_IDS.map((id) => [id, { name: S.EVENTS[id].name, text: S.EVENTS[id].text, hours: S.EVENTS[id].days * 24 }])),
      active: list.filter((e) => e.start <= t && e.end > t).map((e) => ({ ...S.eventInfo(e), stopped: !!e.stopped })),
      upcoming: list.filter((e) => e.start > t).map((e) => ({ ...S.eventInfo(e), stopped: !!e.stopped })),
      history: q("SELECT admin, action, details, created_at at FROM admin_log WHERE action IN ('event-start', 'event-stop') ORDER BY id DESC LIMIT 20").all()
        .map((r) => ({ ...r, details: JSON.parse(r.details || 'null'), adminName: adminName(r.admin) })),
    };
  }
  // Starts an event now for `hours` (default: its usual length, EVENT_CAPS.forcedHours). Refused when the same event is
  // already running, when EVENT_CAPS.forcedMax started events still run, or when it would overlap an exclusive one.
  function adminEventStart(who, { event, hours, country }) {
    const d = S.EVENTS[event];
    if (!Object.hasOwn(S.EVENTS, String(event))) fail('Невідома подія');
    const [hMin, hMax] = S.EVENT_CAPS.forcedHours;
    const h = hours == null || hours === '' ? Math.min(hMax, d.days * 24) : int(hours, hMin, hMax, 'Тривалість, год');
    const t = now(), end = t + h * 3600e3;
    let c = null;
    if (event === 'country') {
      c = String(country ?? '').toUpperCase();
      if (!S.MAIN_COUNTRIES.includes(c)) fail('Обери країну');
    }
    if (S.activeEvents(t, evOv).some((e) => e.id === event)) fail('Ця подія вже йде — спершу зупини її');
    if (evOv.forced.filter((f) => f.end > t).length >= S.EVENT_CAPS.forcedMax) fail(`Одночасно можна запустити вручну не більше ${S.EVENT_CAPS.forcedMax} подій`);
    for (const pair of S.EVENT_EXCLUSIVE) {
      if (!pair.includes(event)) continue;
      const other = pair.find((x) => x !== event);
      const clash = S.eventsBetween(t, end, evOv).find((e) => e.id === other);
      if (clash) fail(`Не можна одночасно з подією «${S.EVENTS[other].name}» — вона йде або почнеться ${dayOf(clash.start)}; скороти тривалість`);
    }
    const f = { key: `${event}:f${t}`, id: event, start: t, end, ...(c ? { country: c } : {}), by: String(who) };
    alog(who, 'event-start', null, { event, hours: h, country: c, until: end });
    saveEventOv({ ...evOv, forced: [...evOv.forced, f] });
    return { event: S.eventInfo({ ...f, forced: true }) };
  }
  // Stops a running event (scheduled or started by hand) right now.
  function adminEventStop(who, { key }) {
    const t = now();
    const e = S.activeEvents(t, evOv).find((x) => x.key === String(key ?? ''));
    if (!e) fail('Ця подія зараз не йде');
    alog(who, 'event-stop', null, { event: e.id, key: e.key, country: e.country || null, plannedEnd: e.end });
    saveEventOv({ forced: evOv.forced.map((f) => (f.key === e.key ? { ...f, end: t } : f)), stopped: e.forced ? evOv.stopped : { ...evOv.stopped, [e.key]: t } });
    return {};
  }
  // ---------- game settings: the casino switch (owner only) and the unlock ladder (read-only, S.UNLOCKS) ----------
  function adminSettings() {
    const saved = metaGet('casino_mode');
    return {
      casino: casinoMode(), casinoDefault: S.CASINO_DEFAULT, casinoSaved: Object.hasOwn(S.CASINO_MODES, saved ?? '') ? saved : null, modes: S.CASINO_MODES,
      unlocks: S.UNLOCKS.map(({ key, level, name }) => ({ key, level, name })),
      history: q("SELECT admin, details, created_at at FROM admin_log WHERE action = 'casino-mode' ORDER BY id DESC LIMIT 10").all()
        .map((r) => ({ ...r, details: JSON.parse(r.details || 'null'), adminName: adminName(r.admin) })),
    };
  }
  function adminCasinoMode(who, { mode }) {
    if (actorRole(who) !== 'owner') fail('Казино вмикає й вимикає лише власник гри');
    if (!Object.hasOwn(S.CASINO_MODES, String(mode))) fail('Невідомий режим');
    const from = casinoMode();
    metaSet('casino_mode', mode);
    const settled = closeCasinoGames(mode);
    alog(who, 'casino-mode', null, { from, to: mode, settled });
    return { casino: mode, settled };
  }
  // Games still running when their game closes: nobody can reach them in the app any more, so they are settled now.
  // Mines: cashed out at the current multiplier, or the bet back when no cell was opened. Crash: a round that already
  // crashed (or hit its auto cash-out) ends as it would have; one still in the air is cashed out at the multiplier it
  // has reached (at least ×1.00, the bet back). Returns how many games were paid out this way.
  function closeCasinoGames(mode) {
    let settled = 0;
    if (!S.casinoGameOpen(mode, 'mines')) {
      for (const g of q("SELECT * FROM mines_games WHERE status = 'running'").all()) {
        const opened = JSON.parse(g.revealed).length;
        const back = opened ? payout(g.bet, S.minesMult(g.mines, opened)) : g.bet;
        addMoney(g.user_id, back);
        q("UPDATE mines_games SET status = 'won' WHERE id = ?").run(g.id);
        event(g.user_id, `🎰 Гру «Міни» закрито адміністрацією — тобі повернуто ${S.fmt(back)}`);
        settled++;
      }
    }
    if (!S.casinoGameOpen(mode, 'crash')) {
      for (const g0 of q("SELECT * FROM crash_games WHERE status = 'running'").all()) {
        const g = crashResolve(g0);
        if (g.status !== 'running') continue;
        const x = Math.max(1, Math.floor(S.crashAt((now() - g.started_at) / 1000) * 100) / 100);
        if (x >= g.point) {
          q("UPDATE crash_games SET status = 'lost' WHERE id = ?").run(g.id);
          continue;
        }
        const back = payout(g.bet, x);
        addMoney(g.user_id, back);
        q("UPDATE crash_games SET status = 'won', cashout = ? WHERE id = ?").run(x, g.id);
        event(g.user_id, `🎰 Гру «Краш» закрито адміністрацією — тобі повернуто ${S.fmt(back)} (×${x.toFixed(2).replace('.', ',')})`);
        settled++;
      }
    }
    return settled;
  }
  // Admin handlers get (who, body); read-only ones ignore `who`. Each runs in one transaction.
  const adminHandlers = {
    overview: () => adminOverview(), users: (w, b) => adminUsers(b), user: (w, b) => adminUser(b),
    money: adminMoney, 'give-car': adminGiveCar, 'grant-premium': adminGrantPremium, 'remove-car': adminRemoveCar, part: adminGivePart, keys: adminGiveKeys,
    'give-plate': adminGivePlate, 'remove-plate': adminRemovePlate, search: (w, b) => adminSearch(b), 'check-plate': (w, b) => checkPlate(b.text),
    set: adminSetUser, ban: adminBan, message: adminMessage, reset: adminResetUser,
    luck: adminLuck, rig: adminRig, 'rig-cancel': adminRigCancel,
    market: () => adminMarket(), 'market/remove': (w, b) => adminMarketRemove(w, b),
    'dealer/refresh': (w) => (restockDealer(true), alog(w, 'dealer-refresh', null, null), {}),
    promos: () => adminPromos(), 'promo/create': adminPromoCreate, 'promo/delete': adminPromoDelete,
    payments: (w, b) => adminPayments(b), log: (w, b) => adminLog(b), referrals: () => adminReferrals(),
    support: (w, b) => adminSupport(b), 'support/reply': adminSupportReply, role: adminSetRole,
    dashboard: (w, b) => adminDashboard(b), 'broadcast/preview': (w, b) => adminBroadcastPreview(b), broadcast: adminBroadcast,
    'game-events': () => adminGameEvents(), 'game-events/start': adminEventStart, 'game-events/stop': adminEventStop,
    settings: () => adminSettings(), 'casino-mode': adminCasinoMode,
  };
  // Every admin call checks the caller's role (helpers may only use HELPER_ACTIONS).
  const admin = Object.fromEntries(Object.entries(adminHandlers).map(([k, fn]) => [k, (who, body = {}) => db.tx(() => {
    if (!canDo(actorRole(who), k)) fail('Немає прав на цю дію');
    const r = fn(who, body || {});
    if (body?.id && k !== 'market/remove' && q('SELECT 1 FROM users WHERE id = ?').get(body.id)) recalc(body.id);
    return r;
  })]));
  // Actions that change a player or the economy. From the panel (adminCall, used by the HTTP endpoint) each needs
  // `confirm: true` (the confirm dialog) and a `reason` of 3+ characters, which goes into admin_log with the action.
  // message / support/reply are not here: their text is the whole action and is logged as it is.
  const ADMIN_MUTATING = new Set(['money', 'give-car', 'grant-premium', 'remove-car', 'part', 'keys', 'give-plate', 'remove-plate', 'set', 'ban', 'reset',
    'luck', 'rig', 'rig-cancel', 'market/remove', 'dealer/refresh', 'promo/create', 'promo/delete', 'role', 'broadcast',
    'game-events/start', 'game-events/stop', 'casino-mode']);
  function adminCall(who, name, body) {
    if (!Object.hasOwn(admin, name)) return undefined;
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    if (!canDo(actorRole(who), name)) fail('Немає прав на цю дію');
    let reason = null;
    if (ADMIN_MUTATING.has(name)) {
      reason = String(b.reason ?? '').trim().slice(0, 300);
      if (reason.length < 3) fail('Вкажи причину (від 3 символів) — вона піде в журнал дій');
      if (b.confirm !== true) fail('Дію не підтверджено');
    }
    actx.reason = reason;
    try {
      return admin[name](who, b);
    } finally {
      actx.reason = null;
    }
  }

  const handlers = {
    me: (u) => me(u),
    collect, 'buy-slot': buySlot, 'upgrade-cap': upgradeCap, sell, showcase, 'buy-showcase': buyShowcaseSlot,
    'car/paint': paintCar, 'car/livery': liveryCar, 'car/paint-reset': paintReset,
    'wash/hand': washHand, 'wash/auto': washAuto,
    'case/open': openCase, 'case/history': dropHistory,
    'fair/seed': setClientSeed, 'fair/rotate': rotateSeed, 'fair/revealed': revealedSeeds,
    'parts/open': openParts, 'parts/merge': merge, 'parts/sell': sellParts, 'parts/install': install, 'parts/uninstall': uninstall, 'parts/install-best': installBest, 'parts/sell-junk': sellJunk,
    'plate/generate': generatePlate, 'plate/attach': attachPlate, 'plate/detach': detachPlate, 'plate/sell': sellPlate,
    'race/rivals': rivals, 'race/start': raceStart, 'race/finish': raceFinish,
    'boss/list': bossList, 'boss/start': bossStart,
    'drift/rivals': driftRivals, 'drift/start': driftStart, 'drift/finish': driftFinish,
    upgrade, 'dealer/tradein': tradeIn,
    'casino/slots': slots, 'casino/roulette': roulette,
    'casino/crash/start': crashStart, 'casino/crash/state': crashState, 'casino/crash/cashout': crashCashout, 'casino/crash/history': crashHistory,
    'casino/mines/start': minesStart, 'casino/mines/reveal': minesReveal, 'casino/mines/cashout': minesCashout, 'casino/mines/state': minesState,
    'pvp/list': pvpList, 'pvp/create': pvpCreate, 'pvp/accept': pvpAccept, 'pvp/cancel': pvpCancel,
    'pvp/request': pvpRequest, 'pvp/withdraw': pvpWithdraw, 'pvp/answer': pvpAnswer, 'pvp/state': pvpState, 'pvp/progress': pvpProgress, 'pvp/finish': pvpFinish,
    achievements, 'ach/claim': achievementClaim, 'support/send': supportSend, 'support/mine': supportMine,
    pulse, 'settings/invites': setNoInvites, 'settings/push': setPushOn,'room/decline': roomDecline, 'gifts/seen': giftsSeen, 'rescue/claim': rescueClaim,
    'market/list': marketList, 'market/sell': marketSell, 'market/buy': marketBuy, 'market/cancel': marketCancel,
    'market/items': marketItems, 'market/item-sell': marketItemSell, 'market/item-buy': marketItemBuy, 'market/item-cancel': marketItemCancel,
    'auction/list': auctionList, 'auction/create': auctionCreate, 'auction/bid': auctionBid, 'auction/cancel': auctionCancel,
    player, 'trade/list': tradeList, 'trade/create': tradeCreate, 'trade/accept': tradeAccept,
    'trade/decline': (u, b) => tradeClose(u, b, 'declined'), 'trade/cancel': (u, b) => tradeClose(u, b, 'cancelled'),
    hall, 'hall/chat': (u, b) => postChat(u, 0, b.text),
    'room/create': roomCreate, 'room/join': roomJoin, 'room/invite': roomInvite, 'room/state': roomState,
    'room/offer': roomOffer, 'room/ready': roomReady, 'room/leave': roomLeave,
    'room/chat': (u, b) => postChat(u, roomLive(u, b.id).id, b.text),
    'battle/list': battleList, 'battle/create': battleCreate, 'battle/join': battleJoin, 'battle/cancel': battleCancel, 'battle/get': battleGet,
    rewards, 'rewards/daily': dailyClaim, 'rewards/case': rewardCase, 'newbie/claim': newbieClaim, 'level/seen': levelSeen, 'intro/seen': introSeen, 'guide/off': guideOff, 'guide/on': guideOn,
    quests, 'quests/claim': questClaim, 'collection/claim': collectionClaim, sets, 'sets/claim': setClaim,
    weekly, 'weekly/claim': weeklyClaim, 'weekly/chest': weeklyChest,
    leaderboard, promo: redeemPromo, events,
    season, 'season/claim': passClaim, shop, 'shop/stars': buyWithStars, feed: dropFeed,
    'rewards/all': rewardsAll,
    'dream/set': dreamSet,
  };
  // Every call runs in one transaction, settles the weekly race and refreshes the caller's garage value — except the
  // frequent polls below (every few seconds, or several times a second in a live race), which change no cars.
  const LIGHT = new Set(['pulse', 'pvp/progress', 'pvp/state']);
  const WEEKLY_AFTER = { 'drift/finish': 'drift' };
  const api = Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, (uid, body = {}) => db.tx(() => {
    const light = LIGHT.has(k);
    if (!light) {
      settleWeek();
      rollWeek(uid);
      settleSeason();
      rollSeason(uid);
    }
    checkComeback(uid); // normally done at sign-in (ensureUser); here too for callers that skip it
    gate(uid, k); // progressive unlock and the casino switch (GATES)
    // Presence for "online" (trade hall, live PvP): written at most every 15 s so plain reads don't hit the disk.
    if (q('UPDATE users SET last_seen = ? WHERE id = ? AND (last_seen IS NULL OR last_seen < ?)').run(now(), uid, now() - 15e3).changes) markDay(uid);
    const r = fn(uid, body || {});
    // Weekly tasks counted per finished call (kept out of the handlers themselves).
    if (WEEKLY_AFTER[k]) track(uid, WEEKLY_AFTER[k]);
    if (!light) recalc(uid);
    return r;
  })]));

  // ---------- owner metrics (admin «Метрики»; the arithmetic is in src/metrics.js) ----------
  // What moved the money right now, for money_src: the API call's name, 'admin/<action>', or the job that pays out on
  // its own ('level', 'weekly', 'season', 'comeback', 'shop', 'auction', 'signup'); 'other' when none is set.
  let flowSrc = null;
  function srcFlow(n) {
    q('INSERT INTO money_src (day, src, created, destroyed) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET created = created + excluded.created, destroyed = destroyed + excluded.destroyed')
      .run(dayOf(now()), flowSrc || 'other', n > 0 ? n : 0, n < 0 ? -n : 0);
  }
  const srcWrap = (src, fn) => function (...a) {
    const prev = flowSrc;
    flowSrc = src;
    try {
      return fn.apply(this, a);
    } finally {
      flowSrc = prev;
    }
  };
  // The first time a first-session step happened (M.FUNNEL_STEPS); later ones change nothing.
  const funnelMark = (uid, step) => q('INSERT OR IGNORE INTO funnel (user_id, step, at) VALUES (?, ?, ?)').run(uid, step, now());
  // Every API call names its money, and a successful call may be a funnel step (M.FUNNEL_AFTER).
  for (const [k, fn] of Object.entries(api)) {
    const step = M.FUNNEL_AFTER[k];
    api[k] = (uid, body = {}) => db.tx(() => {
      const prev = flowSrc;
      flowSrc = k;
      try {
        const r = fn(uid, body);
        if (step) funnelMark(uid, step);
        return r;
      } finally {
        flowSrc = prev;
      }
    });
  }
  // Steps only the app sees (the «У гараж» tap on the drop screen): a light call that does nothing else.
  api['funnel/mark'] = (uid, body = {}) => db.tx(() => {
    const step = String(body?.step ?? '');
    if (!M.CLIENT_STEPS.has(step)) fail('Невідомий крок');
    userRow(uid);
    funnelMark(uid, step);
    return {};
  });
  for (const k of Object.keys(admin)) admin[k] = srcWrap('admin/' + k, admin[k]);
  // Jobs that pay out on their own. Function declarations can be re-pointed: every caller goes through the name, so
  // this labels their money without touching their code.
  settleWeek = srcWrap('weekly', settleWeek);
  settleSeason = srcWrap('season', settleSeason);
  checkComeback = srcWrap('comeback', checkComeback);
  settleAuctions = srcWrap('auction', settleAuctions);
  creditPayment = srcWrap('shop', creditPayment);
  creditItem = srcWrap('shop', creditItem);
  adminGive = srcWrap('admin/give', adminGive);
  // Level-ups: the reward money is 'level', and every new level up to M.FUNNEL_LEVEL_MAX is a funnel mark ('L3', …).
  xp = ((inner) => {
    const labelled = srcWrap('level', inner);
    return (uid, kind, mult) => {
      const before = q('SELECT level FROM users WHERE id = ?').get(uid)?.level;
      labelled(uid, kind, mult);
      const after = q('SELECT level FROM users WHERE id = ?').get(uid)?.level;
      for (let l = before + 1; l <= Math.min(after, M.FUNNEL_LEVEL_MAX); l++) funnelMark(uid, 'L' + l);
    };
  })(xp);
  // Signing in: the start money is 'signup', a new player's deep-link parameter is kept (M.signupSource), and the day
  // counts as active right away (the API calls mark it at most every 15 s after the last sign-in).
  ensureUser = ((inner) => (tg, startParam) => db.tx(() => {
    const prev = flowSrc;
    flowSrc = 'signup';
    try {
      const r = inner(tg, startParam);
      const uid = Number(tg.id);
      if (r?.created) q('UPDATE users SET start_param = ? WHERE id = ?').run(M.cleanStartParam(startParam), uid);
      if (!isBanned(uid)) markDay(uid);
      return r;
    } finally {
      flowSrc = prev;
    }
  }))(ensureUser);

  // The tab: players who signed up in the last `days` Kyiv days (cohorts, funnel, sources), activity from 6 days
  // before (WAU), money by source. Reads only indexed ranges: users_created, user_days by day, funnel by player.
  function adminMetrics({ days }) {
    const n = days == null || days === '' ? 30 : int(days, 7, 90, 'Днів');
    const t = now(), T = M.dayNum(dayOf(t)), first = T - (n - 1);
    const kday = M.hourDay(dayOf);
    const funnelSince = Number(metaGet('funnel_since')) || 0;
    const since = Date.parse(M.dayStr(first) + 'T00:00:00Z') - 3 * 3600e3; // a Kyiv day starts 2–3 h before UTC's
    const users = [];
    for (const r of q('SELECT u.id, u.created_at, u.referrer_id, u.start_param, l.id legacy FROM users u LEFT JOIN legacy l ON l.id = u.id WHERE u.created_at >= ?').all(since)) {
      const day = M.dayNum(kday(r.created_at));
      if (day < first) continue;
      users.push({ id: r.id, createdAt: r.created_at, day, tracked: !!funnelSince && r.created_at >= funnelSince,
        source: M.signupSource({ startParam: r.start_param, referrerId: r.referrer_id, legacy: r.legacy != null }) });
    }
    const activity = q('SELECT day, user_id, sessions FROM user_days WHERE day >= ?').all(M.dayStr(first - 6));
    const marks = q('SELECT f.user_id, f.step, f.at FROM users u JOIN funnel f ON f.user_id = u.id WHERE u.created_at >= ?').all(Math.max(since, funnelSince));
    const money = q('SELECT day, src, created, destroyed FROM money_src WHERE day >= ?').all(M.dayStr(first));
    return M.buildMetrics({ today: T, first, users, activity, marks, money, now: t, funnelSince });
  }
  // Owner and admins (not helpers); read-only, so no confirm or reason.
  admin.metrics = (who, body = {}) => db.tx(() => {
    if (!canDo(actorRole(who), 'metrics')) fail('Немає прав на цю дію');
    return adminMetrics(body || {});
  });

  // Once per database: the days players were in the game before user_days existed, from what they left behind
  // (case drops, races, Stars payments, the signup day) over the last 120 days (the tab shows at most 90 + 6), up to
  // the end of the first day user_days already has. One INSERT … SELECT per table, all in SQL; sessions unknown (0).
  function backfillUserDays() {
    if (metaGet('user_days_backfill_1')) return;
    const firstTracked = q('SELECT MIN(day) d FROM user_days').get()?.d;
    const from = Math.floor(now() - 120 * 86400e3);
    const to = Math.floor(firstTracked ? Date.parse(firstTracked + 'T00:00:00Z') + 86400e3 : now() + 86400e3);
    const day = M.kyivDaySql('created_at', from, to);
    db.tx(() => {
      for (const [table, uid, extra] of [['drops', 'user_id', ''], ['races', 'user_id', ''], ['payments', 'user_id', "AND charge_id NOT LIKE 'legacy:%'"], ['users', 'id', '']]) {
        if (to > from) db.exec(`INSERT OR IGNORE INTO user_days (day, user_id) SELECT DISTINCT ${day}, ${uid} FROM ${table} WHERE created_at >= ${from} AND created_at < ${to} ${extra}`);
      }
      metaSet('user_days_backfill_1', now());
    });
  }
  // The owner switched the casino off on 22.10 (S.CASINO_DEFAULT = 'off'). Once per database: a mode saved in the panel
  // before that day goes back to off (one the owner picked on 22.10 or later stays), and games left running in a game
  // that is closed now are settled (closeCasinoGames). Logged as 'system' in the casino history.
  const CASINO_OFF_FLAG = 'casino_off_2026_10_22', CASINO_OFF_SINCE = Date.parse('2026-10-22T00:00:00+03:00');
  function migrateCasinoOff() {
    if (metaGet(CASINO_OFF_FLAG)) return;
    db.tx(() => {
      const saved = metaGet('casino_mode');
      const valid = Object.hasOwn(S.CASINO_MODES, saved ?? '');
      const last = q("SELECT created_at FROM admin_log WHERE action = 'casino-mode' AND admin <> 'system' ORDER BY id DESC LIMIT 1").get();
      const from = valid ? saved : 'on'; // the default until 22.10
      if (valid && saved !== 'off' && !(last && last.created_at >= CASINO_OFF_SINCE)) metaSet('casino_mode', 'off');
      const to = casinoMode();
      const settled = srcWrap('casino/close', closeCasinoGames)(to);
      // A new, empty database never had the casino on: nothing to log there.
      const live = !!q('SELECT 1 FROM users LIMIT 1').get();
      if ((from !== to && live) || settled) alog('system', 'casino-mode', null, { from, to, settled, reason: 'Рішення власника 22.10: казино вимкнено' });
      metaSet(CASINO_OFF_FLAG, now());
    });
  }
  if (!metaGet('funnel_since')) metaSet('funnel_since', now());
  backfillUserDays();
  migrateCasinoOff();

  // When car prices change (a balance update), revalue every garage at once and move the week's starting value by
  // the same amount, so the weekly race counts only real growth, not the revaluation.
  const priceSig = sha256(JSON.stringify(S.ALL_MODELS.map((m) => [m.id, m.price])));
  if (metaGet('price_sig') !== priceSig) {
    db.tx(() => {
      for (const u of q('SELECT id, total_value FROM users').all()) {
        const v = totalValue(u.id);
        q('UPDATE users SET total_value = ?, week_start_value = week_start_value + ? WHERE id = ?').run(v, v - u.total_value, u.id);
      }
      metaSet('price_sig', priceSig);
    });
  }

  importLegacy();
  migrateNewbieOrder();
  migratePity();
  // The bot's /promo is logged like the panel's (who = "bot").
  const botPromo = (code, amount, uses, days) => db.tx(() => {
    const c = createPromo(code, amount, uses, days);
    alog('bot', 'promo', null, { code: c, amount: Number(amount), uses: Number(uses), days: days || null });
    return c;
  });
  return { api, admin, adminCall, announceUpdates, push, pushCandidates: push.candidates, pushMark: push.mark, roleOf, isBanned, ensureUser, settleAuctions, creditPayment, creditItem, itemPrice: itemPriceTx, packAmountFor, createPromo: botPromo, adminGive, stats, giveCar: (uid, m) => db.tx(() => giveCar(uid, m)), addPart: (uid, t, tier, n) => db.tx(() => addPart(uid, t, tier, n)) };
}
