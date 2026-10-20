import crypto from 'node:crypto';
import * as S from '../public/shared.js';

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
function rivalRun(rand, base) {
  const reaction = 0.15 + rand() * 0.2;
  const shifts = Array.from({ length: S.SHIFTS }, () => {
    const x = rand();
    return x < 0.25 ? 'perfect' : x < 0.85 ? 'good' : 'early';
  });
  return S.raceTime({ base, shift: 0 }, reaction, shifts);
}
function playerRun(rand, stats) {
  const j = rand();
  const reaction = j < 0.05 ? -1 : Math.max(0.1, Math.min(0.8, 0.28 + (rand() + rand() + rand() - 1.5) * 0.15));
  const shifts = Array.from({ length: S.SHIFTS }, () => {
    const x = rand();
    return x < 0.2 ? 'perfect' : x < 0.6 ? 'good' : x < 0.9 ? 'late' : 'miss';
  });
  return S.raceTime(stats, reaction, shifts);
}
export function winChance(stats, rivalBase, seed) {
  const rand = lcg(seed);
  let wins = 0;
  for (let i = 0; i < 300; i++) if (playerRun(rand, stats) < rivalRun(rand, rivalBase)) wins++;
  return Math.round((wins / 300) * 100);
}

export function createGame(db, opts = {}) {
  const notify = opts.notify || (() => {});
  const now = opts.now || (() => Date.now());
  const rnd = opts.random || Math.random;
  const q = db.q;

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
  const addMoney = (uid, n) => q('UPDATE users SET balance = balance + ? WHERE id = ?').run(Math.round(n), uid);
  function pay(uid, n) {
    if (!n) return;
    if (!q('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?').run(n, uid, n).changes) fail('Недостатньо гривень');
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
  // VIP refills both the shared tank and the cars' own tanks twice as fast.
  const regenMs = (vip) => (S.FUEL_REGEN_MIN * 60e3) / (vip ? S.VIP.fuelMult : 1);
  function tankState(c) {
    const regen = regenMs(vipOf(c.owner_id));
    if (c.tank >= S.CAR_TANK) return { tank: S.CAR_TANK, at: now(), next: null };
    const g = Math.floor((now() - c.tank_at) / regen);
    const tank = Math.min(S.CAR_TANK, c.tank + g);
    const at = tank >= S.CAR_TANK ? now() : c.tank_at + g * regen;
    return { tank, at, next: tank >= S.CAR_TANK ? null : at + regen };
  }
  function carOut(c) {
    if (!c) return null;
    const parts = carParts(c.id);
    const plate = carPlate(c.id);
    const st = S.carStats({ model: c.model, parts, plateValue: plate?.value || 0 });
    const t = tankState(c);
    return { id: c.id, model: c.model, status: c.status, parts, plate, tank: t.tank, tankNext: t.next, ...st };
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
  const garageCount = (uid) => q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status <> 'showcase'").get(uid).n;
  function needSlots(uid, n) {
    const u = q('SELECT slots FROM users WHERE id = ?').get(uid);
    if (garageCount(uid) + n > u.slots) fail(n > 1 ? `Потрібно ${n} вільних місць у гаражі` : 'Гараж заповнений — продай авто або купи місце');
  }
  function giveCar(uid, model) {
    const isNew = !q('SELECT 1 FROM collection WHERE user_id = ? AND model = ?').get(uid, model);
    const r = q('INSERT INTO cars (owner_id, model, tank, tank_at, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, model, S.CAR_TANK, now(), now());
    if (isNew) {
      q('INSERT INTO collection (user_id, model, at) VALUES (?, ?, ?)').run(uid, model, now());
      xp(uid, 'newCar');
    }
    return { id: Number(r.lastInsertRowid), isNew };
  }
  function transferCar(carId, to) {
    q("UPDATE cars SET owner_id = ?, status = 'garage' WHERE id = ?").run(to, carId);
    q('UPDATE plates SET owner_id = ? WHERE car_id = ?').run(to, carId);
    q('DELETE FROM rivals WHERE car_id = ?').run(carId);
    // A car bought or traded from another player does not count in the collection: collections are found, not bought.
  }

  // ---------- income ----------
  // Only as many cars as the garage has slots earn income (the best earners), so a garage that went over its
  // limit (battle win, auction, reward) gives no extra income until the spare cars are sold.
  const carIncome = (c) => S.carIncomeOf({ model: c.model, parts: carParts(c.id), plateValue: carPlate(c.id)?.value || 0 });
  function incomeRate(uid) {
    const u = q('SELECT slots FROM users WHERE id = ?').get(uid);
    const listed = q("SELECT COUNT(*) n FROM cars WHERE owner_id = ? AND status IN ('market', 'auction')").get(uid).n;
    const earning = q("SELECT * FROM cars WHERE owner_id = ? AND status = 'garage'").all(uid).map((c) => ({ country: S.MODELS[c.model].country, v: carIncome(c) }))
      .sort((a, b) => b.v - a.v).slice(0, Math.max(0, (u?.slots ?? 1e9) - listed));
    // Three or more earning cars of one country: +10% to their income (S.COUNTRY_BONUS).
    const per = {};
    for (const c of earning) per[c.country] = (per[c.country] || 0) + 1;
    return earning.reduce((s, c) => s + c.v * (per[c.country] >= S.COUNTRY_BONUS.cars ? 1 + S.COUNTRY_BONUS.income : 1), 0);
  }
  function incomeState(u) {
    const rate = incomeRate(u.id);
    const capH = S.CAP_LEVELS[u.cap_level].hours + ((u.vip_until || 0) > now() ? S.VIP.extraHours : 0);
    const elapsed = Math.max(0, now() - u.income_at) / 3600e3;
    const cap = rate * capH;
    // Income already banked is never lost, even if the cap shrinks after selling a car.
    const pending = Math.max(Math.min(u.banked + rate * elapsed, cap), u.banked);
    return { rate, capH, pending: Math.floor(pending) };
  }
  // Freeze income earned so far before the set or value of cars changes.
  function bank(uid) {
    const u = q('SELECT id, banked, income_at, cap_level, vip_until FROM users WHERE id = ?').get(uid);
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
      if (rw.slots) q('UPDATE users SET slots = MIN(?, slots + ?) WHERE id = ?').run(S.MAX_SLOTS, rw.slots, uid);
      if (level >= 3 && u.referrer_id && !u.ref_paid) {
        q('UPDATE users SET ref_paid = 1 WHERE id = ?').run(uid);
        addMoney(u.referrer_id, S.REF_REWARD);
        event(u.referrer_id, `👥 Твій друг ${name(uid)} досяг 3 рівня! +${S.fmt(S.REF_REWARD)}`);
      }
    }
    q('UPDATE users SET level = ?, xp = ? WHERE id = ?').run(level, cur, uid);
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
    return { step: u.newbie_step, total: S.NEWBIE_TASKS.length, ...task, ready };
  }
  function ensureQuests(uid) {
    const day = dayOf(now());
    if (q('SELECT COUNT(*) n FROM quests WHERE user_id = ? AND day = ?').get(uid, day).n) return day;
    const h = sha256(`${uid}:${day}`);
    const keys = Object.keys(S.QUESTS);
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
        q('UPDATE users SET username = ?, first_name = COALESCE(?, first_name), last_seen = ? WHERE id = ?').run(uname, first, now(), uid);
        return { created: false };
      }
      const t = now();
      q(`INSERT INTO users (id, username, first_name, balance, slots, showcase_slots, income_at, fuel, fuel_at, server_seed, client_seed, created_at, last_seen, week_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid, uname, first, S.START_BALANCE, S.START_SLOTS, S.SHOWCASE_START, t, S.FUEL_MAX, t, newSeed(), crypto.randomBytes(8).toString('hex'), t, t, weekOf(t));
      addKeys(uid, 'starter', 1);
      const m = /^ref_(\d{1,20})$/.exec(startParam || '');
      const ref = m ? Number(m[1]) : null;
      if (ref && ref !== uid && q('SELECT id FROM users WHERE id = ?').get(ref)) {
        q('UPDATE users SET referrer_id = ? WHERE id = ?').run(ref, uid);
        addMoney(uid, S.REF_FRIEND_BONUS);
        event(ref, `👥 ${name(uid)} приєднався за твоїм посиланням. Коли він досягне 3 рівня — отримаєш ${S.fmt(S.REF_REWARD)}`);
      }
      return { created: true };
    });
  }

  function fuelState(u) {
    const regen = regenMs((u.vip_until || 0) > now());
    if (u.fuel >= S.FUEL_MAX) return { fuel: S.FUEL_MAX, at: now(), next: null };
    const g = Math.floor((now() - u.fuel_at) / regen);
    const fuel = Math.min(S.FUEL_MAX, u.fuel + g);
    const at = fuel >= S.FUEL_MAX ? now() : u.fuel_at + g * regen;
    return { fuel, at, next: fuel >= S.FUEL_MAX ? null : at + regen };
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
    return {
      id: u.id, username: u.username, firstName: u.first_name, balance: u.balance,
      slots: u.slots, used: cars.filter((c) => c.status !== 'showcase').length, showcaseSlots: u.showcase_slots, capLevel: u.cap_level, fragments,
      income: { rate: Math.round(inc.rate), pending: inc.pending, capH: inc.capH, since: u.income_at, banked: u.banked },
      fuel: fuel.fuel, fuelNext: fuel.next, cars, keys, collection, pity, plates, parts: inventory(uid),
      level: u.level, levelSeen: u.level_seen, xp: u.xp, xpNeed: S.xpForLevel(u.level),
      xpToday: u.xp_day === day ? u.xp_day_capped : 0, newbie: newbieState(u),
      dailyReady: u.streak_day !== day, streak: u.streak, rewardCaseAt: u.reward_case_at + S.REWARD_CASE_HOURS * 3600e3,
      claims: q('SELECT key FROM claims WHERE user_id = ?').all(uid).map((r) => r.key),
      caseOfDay: S.caseOfDay(day),
      fair: { seedHash: sha256(u.server_seed), clientSeed: u.client_seed, nonce: u.nonce },
      stats: { cases: u.cases_opened, races: u.races, wins: u.wins, merges: u.merges, value: u.total_value, playMs: u.play_ms },
      unread: q('SELECT COUNT(*) n FROM events WHERE user_id = ? AND seen = 0').get(uid).n,
      incomingTrades: q("SELECT COUNT(*) n FROM trades WHERE to_id = ? AND status = 'open'").get(uid).n
        + q("SELECT COUNT(*) n FROM trade_rooms WHERE invited_id = ? AND status = 'open' AND host_seen > ?").get(uid, now() - 45e3).n,
      noInvites: !!u.no_invites,
      luck: luckOf(u.id),
      stars: u.stars, vipUntil: u.vip_until, vip: u.vip_until > now(), starterBought: !!u.starter_bought,
      season: (({ claimed, ...s }) => s)(seasonInfo(u)), badges: badgesOf(uid),
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
      got += S.sellPriceOf(c.model);
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
  function openCase(uid, { caseId, count }) {
    const cs = S.CASE_BY_ID[caseId];
    if (!cs) fail('Невідомий кейс');
    const n = int(count ?? 1, 1, 6, 'Кількість');
    if (![1, 3, 6].includes(n)) fail('Можна відкрити 1, 3 або 6');
    needSlots(uid, n);
    const k = q('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, caseId)?.count || 0;
    if (cs.starter && k < n) fail('Стартовий кейс уже відкрито');
    const useKeys = Math.min(k, n);
    const price = S.casePrice(cs, dayOf(now()));
    pay(uid, price * (n - useKeys));
    if (useKeys) q('UPDATE keys SET count = count - ? WHERE user_id = ? AND case_id = ?').run(useKeys, uid, caseId);
    bank(uid);
    const results = [];
    let fragments = 0, newKeys = 0;
    for (let i = 0; i < n; i++) {
      const paid = i >= useKeys; // keys are used first; only paid opens leave fragments
      const streak = cs.starter ? 0 : q('SELECT bad_streak FROM users WHERE id = ?').get(uid).bad_streak;
      // Hidden boost and luck combine: the class is thrown twice with chance 1 − (1 − boost)(1 − luck).
      const luck = cs.starter ? 0 : 1 - (1 - S.BOOST) * (1 - luckOf(uid));
      // After a losing streak the roll aims for a car worth at least the case (see S.LUCK.streak / hardStreak).
      const save = streak >= S.LUCK.streak ? { need: cs.price, force: streak >= S.LUCK.hardStreak } : null;
      let { model, forced, lucky } = rollCase(uid, cs, luck, save);
      if (!cs.starter) q('UPDATE users SET luck_bonus_left = MAX(0, luck_bonus_left - 1) WHERE id = ?').run(uid);
      // An admin-set car replaces this roll (the drop record keeps forced = 3 so it can be told apart).
      const rig = cs.starter ? null : riggedFor(uid, cs);
      if (rig) {
        q('UPDATE rigged_drops SET used_at = ? WHERE id = ?').run(now(), rig.id);
        q('UPDATE drops SET item = ?, cls = ?, forced = 3 WHERE id = (SELECT MAX(id) FROM drops WHERE user_id = ?)').run(rig.model, S.MODELS[rig.model].cls, uid);
        model = rig.model;
        lucky = 1;
      }
      const { id, isNew } = giveCar(uid, model);
      // luck_spent holds the fading sum of what these cases should give on average (their expected value).
      if (!cs.starter) {
        q('UPDATE users SET luck_spent = luck_spent * ? + ?, luck_got = luck_got * ? + ? WHERE id = ?').run(S.LUCK.decay, cs.ev, S.LUCK.decay, S.MODELS[model].price, uid);
        q('UPDATE users SET bad_streak = ? WHERE id = ?').run(S.MODELS[model].price >= cs.price ? 0 : streak + 1, uid);
      }
      // A drop worth less than the case leaves a key fragment; a full set turns into a free key of this case.
      let fragment = false;
      if (paid && !cs.starter && S.MODELS[model].price < price) {
        fragment = true;
        fragments++;
        const fr = q('INSERT INTO fragments (user_id, case_id, count) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count').get(uid, cs.id).count;
        if (fr >= S.FRAGMENTS_PER_KEY) {
          q('UPDATE fragments SET count = count - ? WHERE user_id = ? AND case_id = ?').run(S.FRAGMENTS_PER_KEY, uid, cs.id);
          addKeys(uid, cs.id, 1);
          newKeys++;
        }
      }
      results.push({ car: carOut(carRow(id)), isNew, forced: !!forced, lucky: !!lucky, fragment });
    }
    countOpens(uid, n);
    const fragmentsNow = q('SELECT count FROM fragments WHERE user_id = ? AND case_id = ?').get(uid, cs.id)?.count || 0;
    flag(uid, cs.starter ? 'open_starter' : 'open_case');
    return { results, fragments, newKeys, fragmentsNow, keysNow: q('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, cs.id)?.count || 0 };
  }
  // One provably fair case roll with the pity guarantee; recorded in drops so it can be verified later.
  // The second guarantee's counter lives in the same table under "<case>:2".
  // A truly broke player (money + garage) gets the most luck; otherwise it comes from recent case results.
  function luckOf(uid) {
    const u = q('SELECT balance, total_value, luck_spent, luck_got, luck_bonus, luck_bonus_left FROM users WHERE id = ?').get(uid);
    const own = S.luckChance(u.luck_spent, u.luck_got, S.isBroke(u.balance, u.total_value));
    return u.luck_bonus_left > 0 ? Math.max(own, u.luck_bonus) : own;
  }
  // Admin-set car for this case, if one is waiting and this case can drop it.
  function riggedFor(uid, cs) {
    return q('SELECT * FROM rigged_drops WHERE user_id = ? AND used_at IS NULL ORDER BY id').all(uid)
      .find((r) => cs.weights[S.MODELS[r.model]?.cls] && cs.pool(S.MODELS[r.model].cls).some((m) => m.id === r.model));
  }
  function rollCase(uid, cs, luck = 0, save = null) {
    const classes = classEntries(cs.weights);
    const { first, second } = S.pityClasses(cs);
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
    const count = (key) => q('SELECT count FROM pity WHERE user_id = ? AND case_id = ?').get(uid, key)?.count || 0;
    const pc = count(cs.id), pc2 = second ? count(cs.id + ':2') : 0;
    if (second && S.rankOf(cls) < S.rankOf(second) && pc2 + 1 >= S.PITY2) {
      cls = second;
      forced = 1;
    } else if (first && S.rankOf(cls) < S.rankOf(first) && pc + 1 >= S.PITY) {
      cls = first;
      forced = 1;
    }
    const savePity = q('INSERT INTO pity (user_id, case_id, count) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET count = excluded.count');
    if (first) savePity.run(uid, cs.id, S.rankOf(cls) >= S.rankOf(first) ? 0 : pc + 1);
    if (second) savePity.run(uid, cs.id + ':2', S.rankOf(cls) >= S.rankOf(second) ? 0 : pc2 + 1);
    let model = pickModel(cs.pool(cls), f.roll(1));
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
    q('INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, forced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid, cs.id, model, cls, sha256(f.server_seed), f.client_seed, f.nonce, forced || (lucky ? 2 : 0), now());
    return { model, cls, forced, lucky };
  }
  // Out of money and cars: a free rusty-garage case every LUCK.rescueHours, so the game can go on.
  const rescueReady = (u) => u.balance < S.CASE_BY_ID.rust.price && S.isBroke(u.balance, u.total_value) && u.rescue_at + S.LUCK.rescueHours * 3600e3 <= now();
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
  function openParts(uid, { caseId, type, count }) {
    const pc = S.PART_CASE_BY_ID[caseId];
    if (!pc) fail('Невідомий кейс');
    if (type != null && !S.PART_KEYS.includes(type)) fail('Невідома деталь');
    if (type && pc.randomOnly) fail('У цьому кейсі лише випадкові деталі');
    const n = int(count ?? 1, 1, 10, 'Кількість');
    if (![1, 3, 5, 10].includes(n)) fail('Можна відкрити 1, 3, 5 або 10');
    const price = Math.round(pc.price * (type ? 1 + S.PICK_PART_EXTRA : 1) / 100) * 100;
    pay(uid, price * n);
    const tiers = Object.entries(pc.weights);
    const results = [];
    for (let i = 0; i < n; i++) {
      const f = nextNonce(uid);
      const tier = pickWeighted(tiers, f.roll(0));
      const t = type || S.PART_KEYS[Math.floor(f.roll(1) * S.PART_KEYS.length)];
      addPart(uid, t, tier);
      q('INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uid, caseId, `${t}:${tier}`, S.TIER_BY_ID[tier].cls, sha256(f.server_seed), f.client_seed, f.nonce, now());
      results.push({ type: t, tier });
    }
    xp(uid, 'case', n);
    track(uid, 'parts', n);
    flag(uid, 'part_case');
    return { results, price: price * n };
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
    return { car: carOut(carRow(c.id)) };
  }

  // ---------- plates ----------
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
      price = S.regionPrice(reg);
      weights = S.REGION_GEN.weights;
    } else {
      const g = S.PLATE_GEN.find((x) => x.id === gen);
      if (!g) fail('Невідомий тип номера');
      price = g.price;
      weights = g.weights;
    }
    pay(uid, price);
    const cls = pickWeighted(classEntries(weights), rnd());
    const text = makePlate(cls, reg);
    const [lo, hi] = S.PLATE_VALUE[cls];
    const value = Math.round((lo + rnd() * (hi - lo)) / 100) * 100;
    const r = q('INSERT INTO plates (owner_id, text, cls, value, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, text, cls, value, now());
    xp(uid, 'plate');
    flag(uid, 'plate');
    return { plate: { id: Number(r.lastInsertRowid), text, cls, value, label: S.plateInfo(text).label, region: S.regionOf(text) } };
  }
  function ownPlate(uid, id) {
    const p = q('SELECT * FROM plates WHERE id = ?').get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID номера'));
    if (!p || p.owner_id !== uid) fail('Це не твій номер');
    return p;
  }
  function attachPlate(uid, { plateId, carId }) {
    const p = ownPlate(uid, plateId);
    const c = ownCar(uid, carId, ['garage', 'showcase']);
    bank(uid);
    q('UPDATE plates SET car_id = NULL WHERE car_id = ?').run(c.id);
    q('UPDATE plates SET car_id = ? WHERE id = ?').run(c.id, p.id);
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
    return {};
  }
  function sellPlate(uid, { plateId }) {
    const p = ownPlate(uid, plateId);
    if (p.car_id) fail('Спочатку зніми номер з машини');
    q('DELETE FROM plates WHERE id = ?').run(p.id);
    const got = Math.floor(p.value * 0.5);
    addMoney(uid, got);
    return { got };
  }

  // ---------- racing ----------
  function rivalSig(c) {
    return JSON.stringify([c.model, carParts(c.id), carPlate(c.id)?.id || 0]);
  }
  function rivals(uid, { carId }) {
    const c = ownCar(uid, carId);
    const o = carOut(c);
    const sig = rivalSig(c);
    const cls = S.MODELS[c.model].cls;
    const row = q('SELECT * FROM rivals WHERE user_id = ? AND car_id = ?').get(uid, c.id);
    // Cached rivals keep their cars and odds, but entry/prize always follow the current tables (a balance change applies at once).
    const money = (op) => (op.id === S.TRAINING.id
      ? { prize: Math.max(500, Math.round((S.raceMoney(S.OPPONENTS[0], S.MODELS[c.model].price).prize * op.share) / 100) * 100), entry: 0 }
      : S.raceMoney(op, S.MODELS[c.model].price));
    const opOf = (id) => (id === S.TRAINING.id ? S.TRAINING : S.OPPONENTS.find((op) => op.id === id));
    if (row && row.sig === sig && JSON.parse(row.data)[0]?.id === S.TRAINING.id) return { car: o, list: JSON.parse(row.data).map((r) => ({ ...r, ...money(opOf(r.id)) })) };
    const pool = S.ALL_MODELS.filter((m) => m.cls === cls);
    const names = [...S.RIVAL_NAMES].sort(() => rnd() - 0.5);
    const list = S.OPPONENTS.map((op, i) => {
      const d = op.delta[0] + rnd() * (op.delta[1] - op.delta[0]);
      const base = round3(o.base * (1 + d / 15));
      const model = pool[Math.floor(rnd() * pool.length)];
      const hp = Math.round((model.kg * 2.2046) / Math.pow(Math.max(base - 0.3, 4) / 5.825, 3));
      return { id: op.id, label: op.name, name: names[i], model: model.id, hp, base, ...money(op), chance: winChance(o, base, Math.floor(base * 1e6) + i) };
    });
    // Training first: an easy rival, no entry fee, a quarter of the easy prize.
    {
      const tr = S.TRAINING;
      const d = tr.delta[0] + rnd() * (tr.delta[1] - tr.delta[0]);
      const base = round3(o.base * (1 + d / 15));
      const model = pool[Math.floor(rnd() * pool.length)];
      const hp = Math.round((model.kg * 2.2046) / Math.pow(Math.max(base - 0.3, 4) / 5.825, 3));
      list.unshift({ id: tr.id, label: tr.name, name: names[3] || 'Інструктор', model: model.id, hp, base, ...money(tr), chance: winChance(o, base, Math.floor(base * 1e6) + 9) });
    }
    q('INSERT INTO rivals (user_id, car_id, sig, data) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET sig = excluded.sig, data = excluded.data').run(uid, c.id, sig, JSON.stringify(list));
    return { car: o, list };
  }
  // ---------- drift (rules in S.DRIFT) ----------
  // Three rivals per car and day, each with a target score; money as in drag races (by the car model's price).
  function driftRivals(uid, { carId }) {
    const c = ownCar(uid, carId);
    const o = carOut(c);
    const h = sha256(`drift:${uid}:${c.id}:${dayOf(now())}`);
    const pool = S.ALL_MODELS.filter((m) => m.cls === S.MODELS[c.model].cls && !m.secret);
    const list = S.DRIFT_RIVALS.map((r, i) => {
      const x = parseInt(h.slice(i * 6, i * 6 + 6), 16) / 0xffffff;
      const money = S.raceMoney(S.OPPONENTS.find((op) => op.id === r.id), S.MODELS[c.model].price);
      return { id: r.id, label: r.name, name: S.RIVAL_NAMES[parseInt(h.slice(20 + i * 2, 22 + i * 2), 16) % S.RIVAL_NAMES.length],
        model: pool[Math.floor(x * pool.length)]?.id || c.model, target: Math.round(S.DRIFT_MAX * r.share * (0.92 + 0.16 * x) / 10) * 10, ...money };
    });
    return { car: o, list, model: S.driftModel(o) };
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
  function driftStart(uid, { carId, rival }) {
    const { car, list, model } = driftRivals(uid, { carId });
    const r = list.find((x) => x.id === rival);
    if (!r) fail('Обери суперника');
    const c = carRow(car.id);
    useFuel(uid, c);
    pay(uid, r.entry);
    q("UPDATE drift_runs SET status = 'expired' WHERE user_id = ? AND status = 'running'").run(uid);
    const id = Number(q('INSERT INTO drift_runs (user_id, car_id, rival, target, entry, prize, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid, c.id, JSON.stringify(r), r.target, r.entry, r.prize, now()).lastInsertRowid);
    return { runId: id, car, rival: r, model, max: S.DRIFT_MAX };
  }
  function driftFinish(uid, { runId, score, clean, spins }) {
    const run = q('SELECT * FROM drift_runs WHERE id = ? AND user_id = ?').get(int(runId, 1, 1e15, 'ID заїзду'), uid);
    if (!run || run.status !== 'running') fail('Заїзд уже завершено');
    const took = now() - run.created_at;
    if (took < S.DRIFT_MS * 0.85) fail('Заїзд ще не закінчився');
    // The score can't beat a perfect run; a run left hanging for minutes counts as nothing.
    const pts = took > 3 * 60e3 ? 0 : Math.max(0, Math.min(S.DRIFT_MAX, Math.round(Number(score) || 0)));
    const win = pts >= run.target;
    if (win) addMoney(uid, run.entry + run.prize);
    const rival = JSON.parse(run.rival);
    const result = { win, score: pts, target: run.target, prize: win ? run.prize : 0, entry: run.entry, clean: int(clean ?? 0, 0, S.DRIFT.corners), spins: int(spins ?? 0, 0, 99), rival };
    q("UPDATE drift_runs SET status = 'done', result = ? WHERE id = ?").run(JSON.stringify(result), run.id);
    q('UPDATE users SET races = races + 1, wins = wins + ? WHERE id = ?').run(win ? 1 : 0, uid);
    xp(uid, win ? 'win' : 'race');
    track(uid, 'race');
    if (win) track(uid, 'win');
    flag(uid, 'race');
    if (win) flag(uid, 'win');
    return result;
  }
  function raceStart(uid, { carId, rival }) {
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
    const rr = lcg(Math.floor(rnd() * 2 ** 31));
    const rivalTime = rivalRun(rr, r.base);
    const rec = { ...r, time: rivalTime };
    const id = Number(q('INSERT INTO races (user_id, car_id, rival, entry, prize, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, c.id, JSON.stringify(rec), r.entry, r.prize, now()).lastInsertRowid);
    return { raceId: id, car, rival: rec, shiftPoints: S.SHIFT_POINTS };
  }
  function raceFinish(uid, { raceId, reaction, shifts }) {
    const race = q('SELECT * FROM races WHERE id = ? AND user_id = ?').get(int(raceId, 1, 1e15, 'ID заїзду'), uid);
    if (!race || race.status !== 'running') fail('Заїзд уже завершено');
    if (!Array.isArray(shifts) || shifts.length !== S.SHIFTS || shifts.some((s) => !(s in S.SHIFT_LOSS))) fail('Некоректні дані заїзду');
    let react = Number(reaction);
    if (!Number.isFinite(react)) fail('Некоректний старт');
    if (react >= 0) react = Math.max(0.09, Math.min(react, 3));
    const expired = now() - race.created_at > 3 * 60e3;
    const c = carRow(race.car_id);
    const stats = carOut(c);
    const rival = JSON.parse(race.rival);
    const time = expired ? 99 : S.raceTime(stats, react, shifts);
    const win = time < rival.time;
    if (win) addMoney(uid, race.entry + race.prize);
    const result = { win, time, rivalTime: rival.time, diff: round3(Math.abs(time - rival.time)), prize: win ? race.prize : 0, entry: race.entry, jump: react < 0, perfectStart: react >= 0 && react <= S.START.perfectWindow, reaction: react, shifts };
    q("UPDATE races SET status = 'done', result = ? WHERE id = ?").run(JSON.stringify(result), race.id);
    q('UPDATE users SET races = races + 1, wins = wins + ? WHERE id = ?').run(win ? 1 : 0, uid);
    q('DELETE FROM rivals WHERE user_id = ? AND car_id = ?').run(uid, c.id);
    xp(uid, win ? 'win' : 'race');
    track(uid, 'race');
    if (win) track(uid, 'win');
    const perfect = shifts.filter((s) => s === 'perfect').length;
    if (perfect) track(uid, 'perfect', perfect);
    flag(uid, 'race');
    if (win) flag(uid, 'win');
    return result;
  }

  // ---------- upgrade ----------
  function upgrade(uid, { carIds, target }) {
    const ids = idList(carIds, S.UPGRADE.maxCars);
    if (!ids.length) fail('Обери хоча б одну машину');
    const cars = ids.map((id) => noSecret(ownCar(uid, id)));
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
      const g = giveCar(uid, t.id);
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
    const cars = ids.map((id) => noSecret(ownCar(uid, id)));
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
    const g = giveCar(uid, model);
    q('INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, forced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid, 'tradein', model, S.MODELS[model].cls, sha256(f.server_seed), f.client_seed, f.nonce, 0, now());
    xp(uid, 'upgrade');
    return { win, chance: S.TRADE_IN.chance, stake, car: carOut(carRow(g.id)), isNew: g.isNew, from: cls, to: win ? up : cls };
  }

  // ---------- casino ----------
  function bet(uid, amount) {
    const b = int(amount, S.CASINO.minBet, S.CASINO.maxBet, 'Ставка');
    pay(uid, b);
    return b;
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
      if (!isNum && !S.ROULETTE_BETS[on]) fail('Невідома ставка');
      const amount = int(x.amount, S.CASINO.minBet, Number.MAX_SAFE_INTEGER, 'Ставка');
      if (amount > S.CASINO.maxBet) fail(`Максимум ${S.fmt(S.CASINO.maxBet)} на одне поле`);
      return { on, amount };
    });
    if (new Set(parsed.map((x) => String(x.on))).size !== parsed.length) fail('Ставки на одне поле повторюються');
    const total = parsed.reduce((s, x) => s + x.amount, 0);
    if (total > S.CASINO.rouletteTotal) fail(`Максимум ${S.fmt(S.CASINO.rouletteTotal)} на всі ставки за один спін`);
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
    if (react >= 0) react = Math.max(0.09, Math.min(react, 3));
    return { reaction: round3(react), shifts, time: S.raceTime(stats, react, shifts), jump: react < 0, perfectStart: react >= 0 && react <= S.START.perfectWindow };
  }
  function pvpFinish(uid, { id, reaction, shifts }) {
    const p = pvpOf(uid, id);
    if (p.status !== 'live') return pvpOut(p, uid);
    if (!Array.isArray(shifts) || shifts.length !== S.SHIFTS || shifts.some((s) => !(s in S.SHIFT_LOSS))) fail('Некоректні дані заїзду');
    if (now() < p.green_at - 1000 && Number(reaction) >= 0) fail('Гонка ще не почалася');
    const isC = p.creator_id === uid;
    if (!p[isC ? 'c_run' : 'o_run']) {
      const run = pvpRun(JSON.parse(isC ? p.snapshot : p.opp_snapshot), reaction, shifts);
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
      const carId = Number(q("INSERT INTO cars (owner_id, model, status, tank, tank_at, created_at) VALUES (?, ?, 'market', ?, ?, ?)").run(DEALER_ID, model, S.CAR_TANK, now(), now()).lastInsertRowid);
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
    return due.length;
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
    };
  }
  function invalidateTrades(carIds) {
    if (!carIds.length) return;
    const rows = q(`SELECT DISTINCT t.id FROM trades t JOIN trade_items i ON i.trade_id = t.id WHERE t.status = 'open' AND i.car_id IN (${carIds.map(() => '?').join(',')})`).all(...carIds);
    for (const t of rows) q("UPDATE trades SET status = 'invalid', updated_at = ? WHERE id = ?").run(now(), t.id);
  }
  function tradeCreate(uid, { to, give, get, giveMoney, getMoney }) {
    const toId = findPlayer(to);
    if (toId === uid) fail('Не можна обмінюватися з собою');
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
  function roomInvite(uid, { to }) {
    const toId = int(to, 1, Number.MAX_SAFE_INTEGER, 'ID');
    if (toId === uid) fail('Не можна запросити себе');
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
  // Prizes may push the garage over its limit: the player then picks which cars to sell (the result screen offers it),
  // and until then no new cases can be opened and only the best cars within the limit earn income.
  const BATTLE_COUNTS = [1, 3, 6, 10];
  const CONSOLATION = S.ALL_MODELS.filter((m) => m.cls === 'D' && !m.secret);
  const giveCars = (uid, models) => models.map((m) => ({ id: giveCar(uid, m).id, model: m }));
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
      prize = giveCars(winner.id, [...a.drops, ...o.drops].map((d) => d.model));
      const model = CONSOLATION[Math.floor(rnd() * CONSOLATION.length)].id;
      consolation = { model, ...giveCars(loser.id, [model])[0] };
    } else {
      // A dead heat: everyone keeps what they opened.
      a.cars = giveCars(a.id, a.drops.map((d) => d.model));
      o.cars = giveCars(o.id, o.drops.map((d) => d.model));
    }
    const result = { creator: a, opponent: o, consolation, prize };
    q("UPDATE battles SET opponent_id = ?, status = 'done', winner_id = ?, result = ?, finished_at = ? WHERE id = ?")
      .run(uid, winner?.id ?? null, JSON.stringify(result), now(), b.id);
    for (const who of [a.id, o.id]) recalc(who);
    const total = a.total + o.total;
    event(b.creator_id, !winner ? `⚔️ Батл з ${name(uid)} — нічия, кожен забрав свої авто`
      : winner.id === b.creator_id ? `⚔️ Ти виграв батл у ${name(uid)}! Усі ${b.count * 2} авто на ${S.fmt(total)} — твої`
        : `⚔️ ${name(uid)} виграв твій батл (${S.short(o.total)} проти ${S.short(a.total)}). Тобі — утішна машина`);
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
  function randomPartOf(tier) {
    return { type: S.PART_KEYS[Math.floor(rnd() * S.PART_KEYS.length)], tier };
  }
  function grant(uid, rw) {
    const got = { ...rw };
    if (rw.money) addMoney(uid, rw.money);
    if (rw.parts) {
      got.items = Array.from({ length: rw.parts }, () => randomPartOf(rw.tier));
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
    return got;
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
    const x = rnd();
    let rw;
    if (x < 0.5) rw = { money: Math.round((5000 + rnd() * 20000) * u.level / 1000) * 1000 };
    else if (x < 0.8) rw = { parts: 1, tier: rnd() < 0.7 ? 'stock' : 'street' };
    else if (x < 0.92) rw = { fuel: true };
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
    q('UPDATE users SET newbie_step = newbie_step + 1 WHERE id = ?').run(uid);
    addMoney(uid, st.money);
    xp(uid, 'task');
    return { got: st.money };
  }
  // Polled every few seconds by the open app: invites waiting for an answer, rewards ready to claim and a live race
  // in progress. The app shows them as banners sliding down from the top of the screen.
  // ---------- achievements (tiers and rewards in S.ACHIEVEMENTS) ----------
  // Every measure comes from data the game already keeps, so earlier play counts too.
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
      pvp: q('SELECT COUNT(*) n FROM pvp WHERE winner_id = ?').get(uid).n,
      battles: q('SELECT COUNT(*) n FROM battles WHERE winner_id = ?').get(uid).n,
      collection: models.filter((m) => !m.secret).length,
      rarest: Math.max(0, ...models.filter((m) => !m.season).map((m) => S.rankOf(m.cls))),
      secrets: models.filter((m) => m.secret && !m.season).length,
      garage: u.total_value, level: u.level, play: Math.floor(u.play_ms / 3600e3), streak: u.streak, merges: u.merges, tuned,
      plates: Math.max(0, ...q('SELECT cls FROM plates WHERE owner_id = ?').all(uid).map((p) => S.rankOf(p.cls))),
      friends: q('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND ref_paid = 1').get(uid).n,
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
  function achievements(uid) {
    return { list: achievementState(uid) };
  }
  // Claims every tier reached and not claimed yet — of one achievement, or of all of them.
  function achievementClaim(uid, { key }) {
    let got = 0, tiers = 0;
    for (const s of achievementState(uid)) {
      if (key && s.key !== key) continue;
      const a = S.ACH_BY_KEY[s.key];
      for (let i = 0; i < s.reached; i++) {
        if (q('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(uid, `a:${a.key}:${i}`)) continue;
        q('INSERT INTO claims (user_id, key) VALUES (?, ?)').run(uid, `a:${a.key}:${i}`);
        got += a.rewards[i];
        tiers++;
        xp(uid, 'task');
      }
    }
    if (!tiers) fail('Немає нових досягнень');
    addMoney(uid, got);
    return { got, tiers };
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
    const owned = new Set(q('SELECT model FROM collection WHERE user_id = ?').all(uid).map((r) => r.model));
    const have = new Set(q('SELECT key FROM claims WHERE user_id = ?').all(uid).map((r) => r.key));
    const regular = [...owned].filter((id) => !S.MODELS[id]?.secret).length;
    for (const m of S.COLLECTION_MILESTONES) if (regular >= m.n && !have.has('n' + m.n)) claims.push({ key: 'coll:n' + m.n, kind: 'coll', id: 'n' + m.n, title: 'Нагорода за колекцію', sub: m.label || `Зібрано ${m.n} машин`, money: m.money });
    for (const c of S.MAIN_COUNTRIES) {
      if (!have.has('c' + c) && S.countryModels(c).every((m) => owned.has(m.id))) claims.push({ key: 'coll:c' + c, kind: 'coll', id: 'c' + c, title: `Колекція «${S.COUNTRIES[c].name}» зібрана!`, sub: 'Секретна машина й гроші', money: S.COUNTRY_REWARD[c] });
    }
    // Achievements: one banner per new tier, or a single "claim all" banner when several are waiting.
    const ach = achievementState(uid).filter((s) => s.reached > s.claimed);
    if (ach.length > 2) {
      const money = ach.reduce((sum, s) => sum + S.ACH_BY_KEY[s.key].rewards.slice(s.claimed, s.reached).reduce((x, y) => x + y, 0), 0);
      claims.push({ key: 'achAll:' + ach.map((s) => s.key + s.reached).join(','), kind: 'achAll', title: `Нові досягнення: ${ach.reduce((n, s) => n + s.reached - s.claimed, 0)}`, sub: 'Забери всі нагороди одразу', money });
    } else {
      for (const s of ach) {
        const a = S.ACH_BY_KEY[s.key], tier = s.reached - 1;
        claims.push({ key: `ach:${s.key}:${tier}`, kind: 'ach', id: s.key, tier, title: `${a.title} · ${S.ACH_TIERS[tier].name}`, sub: S.achText(a, tier), money: a.rewards.slice(s.claimed, s.reached).reduce((x, y) => x + y, 0) });
      }
    }
    const si = seasonInfo(u);
    if (si.ready) claims.push({ key: `pass:${si.id}:${si.level}:${si.premium ? 1 : 0}:${si.ready}`, kind: 'pass', title: `Рівень ${si.level} сезонного пропуску!`, sub: `Нагород до забору: ${si.ready}` });
    if (rescueReady(u)) claims.push({ key: 'rescue:' + u.rescue_at, kind: 'rescue', title: 'Не здавайся!', sub: 'Тримай безкоштовний «Іржавий гараж»' });
    const inc = incomeState(u);
    if (inc.rate > 0 && inc.pending >= inc.rate * inc.capH * 0.999) claims.push({ key: 'income:' + u.income_at, kind: 'income', title: 'Гараж набрав максимум', sub: 'Дохід зупинився — забери, щоб він знову йшов', money: inc.pending });
    const live = q("SELECT id FROM pvp WHERE status IN ('pending', 'live') AND opponent_id = ? OR status = 'live' AND creator_id = ? ORDER BY id DESC LIMIT 1").get(uid, uid);
    const gifts = q('SELECT id, kind, data, note FROM gifts WHERE user_id = ? AND shown = 0 ORDER BY id LIMIT 10').all(uid).map((g) => ({ ...g, data: JSON.parse(g.data) }));
    return {
      now: t, balance: u.balance, noInvites: !!u.no_invites, invites, claims, gifts, livePvp: live?.id || null, achReady: ach.length,
      unread: q('SELECT COUNT(*) n FROM events WHERE user_id = ? AND seen = 0').get(uid).n,
    };
  }
  function levelSeen(uid) {
    q('UPDATE users SET level_seen = level WHERE id = ?').run(uid);
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
  function collectionClaim(uid, { key }) {
    const k = String(key);
    if (q('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(uid, k)) fail('Нагороду вже отримано');
    const owned = new Set(q('SELECT model FROM collection WHERE user_id = ?').all(uid).map((r) => r.model));
    let rw;
    if (k.startsWith('n')) {
      const ms = S.COLLECTION_MILESTONES.find((m) => 'n' + m.n === k);
      if (!ms) fail('Невідома нагорода');
      if ([...owned].filter((id) => !S.MODELS[id]?.secret).length < ms.n) fail('Ще не зібрано');
      rw = { money: ms.money, slots: ms.slots || 0 };
    } else if (k.startsWith('c')) {
      const c = k.slice(1);
      if (!S.MAIN_COUNTRIES.includes(c)) fail('Невідома нагорода');
      if (!S.countryModels(c).every((m) => owned.has(m.id))) fail(`Збери всі машини: ${S.COUNTRIES[c].name}`);
      rw = { money: S.COUNTRY_REWARD[c], secret: S.SECRET_BY_COUNTRY[c] };
    } else fail('Невідома нагорода');
    q('INSERT INTO claims (user_id, key) VALUES (?, ?)').run(uid, k);
    addMoney(uid, rw.money);
    if (rw.slots) q('UPDATE users SET slots = MIN(?, slots + ?) WHERE id = ?').run(S.MAX_SLOTS, rw.slots, uid);
    if (rw.secret) {
      const { id } = giveCar(uid, rw.secret);
      if (garageCount(uid) > userRow(uid).slots) q("UPDATE cars SET status = 'showcase' WHERE id = ?").run(id);
    }
    return { reward: rw };
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
  function season(uid) {
    const u = userRow(uid);
    const info = seasonInfo(u);
    const levels = [];
    for (let l = 2; l <= S.SEASON.levels; l++) levels.push({ level: l, free: S.passReward(info.id, l, false), premium: S.passReward(info.id, l, true) });
    const car = S.passReward(info.id, S.SEASON.levels, true).seasonCar;
    return { ...info, levels, car };
  }
  // Claims every pass reward reached and not yet taken (free track, and premium if bought).
  function passClaim(uid) {
    const u = userRow(uid);
    const info = seasonInfo(u);
    const got = [];
    for (let l = 2; l <= info.level; l++) {
      for (const tr of info.premium ? ['f', 'p'] : ['f']) {
        const key = `pass:${info.id}:${l}:${tr}`;
        if (info.claimed.includes(key)) continue;
        q('INSERT INTO claims (user_id, key) VALUES (?, ?)').run(uid, key);
        const rw = S.passReward(info.id, l, tr === 'p');
        if (rw.seasonCar && q('SELECT 1 FROM cars WHERE owner_id = ? AND model = ?').get(uid, rw.seasonCar)) continue;
        got.push({ level: l, premium: tr === 'p', ...grant(uid, rw) });
      }
    }
    if (!got.length) fail('Немає нових нагород пропуску');
    return { got, money: got.reduce((n, g) => n + (g.money || 0), 0) };
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
  function adminGive(userId, amount) {
    db.tx(() => {
      userRow(userId);
      addMoney(userId, int(amount, -1e13, 1e13, 'Сума'));
    });
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
  function alog(who, action, target, details) {
    q('INSERT INTO admin_log (admin, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(String(who), action, target ?? null, details == null ? null : JSON.stringify(details), now());
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
    const like = `%${s}%`;
    const where = s ? 'WHERE CAST(u.id AS TEXT) LIKE ? OR lower(u.username) LIKE ? OR lower(u.first_name) LIKE ?' : '';
    const args = s ? [like, like, like] : [];
    const off = offset ? int(offset, 0, 1e9, 'Зсув') : 0;
    const list = q(`SELECT u.*, (SELECT COUNT(*) FROM cars c WHERE c.owner_id = u.id) cars FROM users u ${where} ORDER BY ${USER_SORT[sort] || USER_SORT.value} LIMIT 50 OFFSET ?`)
      .all(...args, off).map(userBrief);
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
      },
      income: incomeState(u),
      activity: playerActivity(uid),
      cars: q('SELECT * FROM cars WHERE owner_id = ? ORDER BY id').all(uid).map((c) => ({ ...carOut(c), listing: listing[c.id] || null, auction: auction[c.id] || null })),
      plates: q('SELECT id, text, cls, value, car_id carId FROM plates WHERE owner_id = ? ORDER BY value DESC').all(uid),
      parts: inventory(uid),
      keys: q('SELECT case_id caseId, count FROM keys WHERE user_id = ? AND count > 0').all(uid),
      payments: q('SELECT charge_id chargeId, pack, stars, amount, created_at at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(uid),
      events: q('SELECT text, created_at at FROM events WHERE user_id = ? ORDER BY id DESC LIMIT 40').all(uid),
      drops: q('SELECT case_id caseId, item, cls, forced, created_at at FROM drops WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(uid),
      log: q('SELECT admin, action, details, created_at at FROM admin_log WHERE target = ? ORDER BY id DESC LIMIT 30').all(uid),
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
  // ---------- roles in the admin panel ----------
  // owner: in ADMIN_IDS (Railway variable) — can't be changed from the panel; admin: everything; helper: only
  // looking at players, answering support and writing messages (HELPER_ACTIONS).
  const HELPER_ACTIONS = new Set(['overview', 'users', 'user', 'search', 'referrals', 'support', 'support/reply', 'message', 'market', 'log']);
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
    for (const a of opts.admins || []) {
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
    if (n > 0) {
      addPart(uid, type, tier, n);
      gift(uid, 'part', { type, tier, count: n });
    } else q('UPDATE parts SET count = MAX(0, count + ?) WHERE user_id = ? AND type = ? AND tier = ?').run(n, uid, type, tier);
    alog(who, 'part', uid, { type, tier, count: n });
    return {};
  }
  function adminGiveKeys(who, { id, caseId, count }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    if (!S.CASE_BY_ID[caseId]) fail('Невідомий кейс');
    const n = int(count, -1000, 1000, 'Кількість');
    if (n > 0) {
      addKeys(uid, caseId, n);
      gift(uid, 'keys', { caseId, count: n });
    } else q('UPDATE keys SET count = MAX(0, count + ?) WHERE user_id = ? AND case_id = ?').run(n, uid, caseId);
    alog(who, 'keys', uid, { caseId, count: n });
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
    const range = USER_FIELDS[field];
    if (!range) fail('Це поле не можна змінювати');
    const v = int(value, range[0], range[1], 'Значення');
    bank(uid);
    q(`UPDATE users SET ${field} = ?${field === 'level' ? ', level_seen = ?' : ''} WHERE id = ?`).run(...(field === 'level' ? [v, v, uid] : [v, uid]));
    alog(who, 'set', uid, { field, value: v });
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
    }
    alog(who, banned ? 'ban' : 'unban', uid, r ? { reason: r } : null);
    return {};
  }
  // Wipes one player's progress back to a fresh start. Kept: the account itself, who invited them, payments,
  // ban status, the fairness seed and drop history. Their open deals are closed first so nobody else loses money.
  function adminResetUser(who, { id, reason }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    const t = now();
    for (const l of q('SELECT id FROM listings WHERE seller_id = ?').all(uid)) q('DELETE FROM listings WHERE id = ?').run(l.id);
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
       level = 1, level_seen = 1, xp = 0, xp_day = NULL, xp_day_capped = 0, newbie_step = 0, newbie_flags = '[]',
       streak = 0, streak_day = NULL, reward_case_at = 0, total_value = 0, week_id = ?, week_start_value = 0, last_week_id = NULL, last_week_growth = NULL,
       cases_opened = 0, races = 0, wins = 0, merges = 0 WHERE id = ?`)
      .run(S.START_BALANCE, S.START_SLOTS, S.SHOWCASE_START, t, S.FUEL_MAX, t, weekOf(t), uid);
    addKeys(uid, 'starter', 1);
    const why = String(reason ?? '').trim().slice(0, 200);
    event(uid, `♻️ Адміністрація обнулила твій прогрес${why ? `: ${why}` : ''}. Починай заново — стартовий кейс уже чекає!`);
    alog(who, 'reset', uid, { cars: carIds.length, reason: why || null });
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
    };
  }
  function adminMarketRemove(who, { kind, id }, log = true) {
    const lid = int(id, 1, 1e15, 'ID');
    let sellerId, carId;
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
  function adminLog({ offset }) {
    const off = offset ? int(offset, 0, 1e9, 'Зсув') : 0;
    return { list: q('SELECT id, admin, action, target, details, created_at at FROM admin_log ORDER BY id DESC LIMIT 100 OFFSET ?').all(off).map((r) => ({ ...r, targetName: r.target ? name(r.target) : null })) };
  }
  // Admin handlers get (who, body); read-only ones ignore `who`. Each runs in one transaction.
  const adminHandlers = {
    overview: () => adminOverview(), users: (w, b) => adminUsers(b), user: (w, b) => adminUser(b),
    money: adminMoney, 'give-car': adminGiveCar, 'remove-car': adminRemoveCar, part: adminGivePart, keys: adminGiveKeys,
    'give-plate': adminGivePlate, 'remove-plate': adminRemovePlate, search: (w, b) => adminSearch(b), 'check-plate': (w, b) => checkPlate(b.text),
    set: adminSetUser, ban: adminBan, message: adminMessage, reset: adminResetUser,
    luck: adminLuck, rig: adminRig, 'rig-cancel': adminRigCancel,
    market: () => adminMarket(), 'market/remove': (w, b) => adminMarketRemove(w, b),
    'dealer/refresh': (w) => (restockDealer(true), alog(w, 'dealer-refresh', null, null), {}),
    promos: () => adminPromos(), 'promo/create': adminPromoCreate, 'promo/delete': adminPromoDelete,
    payments: (w, b) => adminPayments(b), log: (w, b) => adminLog(b), referrals: () => adminReferrals(),
    support: (w, b) => adminSupport(b), 'support/reply': adminSupportReply, role: adminSetRole,
  };
  // Every admin call checks the caller's role (helpers may only use HELPER_ACTIONS).
  const admin = Object.fromEntries(Object.entries(adminHandlers).map(([k, fn]) => [k, (who, body = {}) => db.tx(() => {
    if (!canDo(actorRole(who), k)) fail('Немає прав на цю дію');
    const r = fn(who, body || {});
    if (body?.id && k !== 'market/remove' && q('SELECT 1 FROM users WHERE id = ?').get(body.id)) recalc(body.id);
    return r;
  })]));

  const handlers = {
    me: (u) => me(u),
    collect, 'buy-slot': buySlot, 'upgrade-cap': upgradeCap, sell, showcase, 'buy-showcase': buyShowcaseSlot,
    'case/open': openCase, 'case/history': dropHistory,
    'fair/seed': setClientSeed, 'fair/rotate': rotateSeed, 'fair/revealed': revealedSeeds,
    'parts/open': openParts, 'parts/merge': merge, 'parts/sell': sellParts, 'parts/install': install, 'parts/uninstall': uninstall,
    'plate/generate': generatePlate, 'plate/attach': attachPlate, 'plate/detach': detachPlate, 'plate/sell': sellPlate,
    'race/rivals': rivals, 'race/start': raceStart, 'race/finish': raceFinish,
    'drift/rivals': driftRivals, 'drift/start': driftStart, 'drift/finish': driftFinish,
    upgrade, 'dealer/tradein': tradeIn,
    'casino/slots': slots, 'casino/roulette': roulette,
    'casino/crash/start': crashStart, 'casino/crash/state': crashState, 'casino/crash/cashout': crashCashout, 'casino/crash/history': crashHistory,
    'casino/mines/start': minesStart, 'casino/mines/reveal': minesReveal, 'casino/mines/cashout': minesCashout, 'casino/mines/state': minesState,
    'pvp/list': pvpList, 'pvp/create': pvpCreate, 'pvp/accept': pvpAccept, 'pvp/cancel': pvpCancel,
    'pvp/request': pvpRequest, 'pvp/withdraw': pvpWithdraw, 'pvp/answer': pvpAnswer, 'pvp/state': pvpState, 'pvp/progress': pvpProgress, 'pvp/finish': pvpFinish,
    achievements, 'ach/claim': achievementClaim, 'support/send': supportSend, 'support/mine': supportMine,
    pulse, 'settings/invites': setNoInvites, 'room/decline': roomDecline, 'gifts/seen': giftsSeen, 'rescue/claim': rescueClaim,
    'market/list': marketList, 'market/sell': marketSell, 'market/buy': marketBuy, 'market/cancel': marketCancel,
    'auction/list': auctionList, 'auction/create': auctionCreate, 'auction/bid': auctionBid, 'auction/cancel': auctionCancel,
    player, 'trade/list': tradeList, 'trade/create': tradeCreate, 'trade/accept': tradeAccept,
    'trade/decline': (u, b) => tradeClose(u, b, 'declined'), 'trade/cancel': (u, b) => tradeClose(u, b, 'cancelled'),
    hall, 'hall/chat': (u, b) => postChat(u, 0, b.text),
    'room/create': roomCreate, 'room/join': roomJoin, 'room/invite': roomInvite, 'room/state': roomState,
    'room/offer': roomOffer, 'room/ready': roomReady, 'room/leave': roomLeave,
    'room/chat': (u, b) => postChat(u, roomLive(u, b.id).id, b.text),
    'battle/list': battleList, 'battle/create': battleCreate, 'battle/join': battleJoin, 'battle/cancel': battleCancel, 'battle/get': battleGet,
    rewards, 'rewards/daily': dailyClaim, 'rewards/case': rewardCase, 'newbie/claim': newbieClaim, 'level/seen': levelSeen,
    quests, 'quests/claim': questClaim, 'collection/claim': collectionClaim,
    leaderboard, promo: redeemPromo, events,
    season, 'season/claim': passClaim, shop, 'shop/stars': buyWithStars, feed: dropFeed,
  };
  // Every call runs in one transaction, settles the weekly race and refreshes the caller's garage value — except the
  // frequent polls below (every few seconds, or several times a second in a live race), which change no cars.
  const LIGHT = new Set(['pulse', 'pvp/progress', 'pvp/state']);
  const api = Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, (uid, body = {}) => db.tx(() => {
    const light = LIGHT.has(k);
    if (!light) {
      settleWeek();
      rollWeek(uid);
      settleSeason();
      rollSeason(uid);
    }
    // Presence for "online" (trade hall, live PvP): written at most every 15 s so plain reads don't hit the disk.
    q('UPDATE users SET last_seen = ? WHERE id = ? AND (last_seen IS NULL OR last_seen < ?)').run(now(), uid, now() - 15e3);
    const r = fn(uid, body || {});
    if (!light) recalc(uid);
    return r;
  })]));

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

  return { api, admin, roleOf, isBanned, ensureUser, settleAuctions, creditPayment, creditItem, itemPrice: itemPriceTx, packAmountFor, createPromo, adminGive, stats, giveCar: (uid, m) => db.tx(() => giveCar(uid, m)), addPart: (uid, t, tier, n) => db.tx(() => addPart(uid, t, tier, n)) };
}
