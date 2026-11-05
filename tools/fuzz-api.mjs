// Fuzz + property runner for the game API (src/game.js), in-process on a fresh in-memory database.
//   node tools/fuzz-api.mjs [--seed=1] [--steps=4000] [--players=12] [--quiet] [--stop]
// Many simulated players act in an interleaved order (the server is one process with synchronous SQLite, so
// "parallel" requests are interleavings: two players hitting the same lot, a double-submit, a sell between a start
// and a finish). Each step is either a SCRIPTED move (valid ids from the database: cases ×1/×3/×6, sell, garage
// collect, races, drift, PvP, tourney, market, trades, auctions, plates, parts, paint, wash, businesses, clubs, pass,
// store with star credit, daily/goals/events, admin reset) or a GARBAGE call (any endpoint, odd bodies: negative,
// huge, NaN, strings, prototype names, arrays, missing fields). The clock jumps now and then, also exactly over
// Kyiv midnight, a week change and a season boundary.
// After every step the invariants are checked (see check()); a break is printed with the step that caused it and
// the run's seed, so `--seed=<n>` replays it. Exit code 1 when anything broke.
import { openDb } from '../src/db.js';
import { createGame, GameError, dayOf } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag, clientDrift } from '../test/race-helpers.js';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=')[1] : d;
};
const SEED = Number(arg('seed', 1));
const STEPS = Number(arg('steps', 4000));
const NP = Number(arg('players', 12));
const QUIET = process.argv.includes('--quiet');
const STOP = process.argv.includes('--stop');

// ---------- deterministic randomness ----------
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = mulberry(SEED * 7919 + 13);
const gameRnd = mulberry(SEED * 104729 + 7);
const mathRnd = mulberry(SEED * 31 + 3);
Math.random = mathRnd; // modules that use Math.random directly replay with the seed too
const ri = (n) => Math.floor(R() * n);
const pick = (a) => a[ri(a.length)];
const chance = (p) => R() < p;

// ---------- the game ----------
const db = openDb(':memory:');
let T = Date.parse('2026-11-05T09:00:00Z');
const clock = { now: () => T };
const notes = [];
const g = createGame(db, { now: clock.now, notify: () => {}, random: gameRnd, allUnlocked: true });
const q = (sql) => db.prepare(sql);
const PLAYERS = Array.from({ length: NP }, (_, i) => 1000 + i);
const OWNER = 'local';

// ---------- odd values ----------
const WEIRD = [
  -1, -1e9, 0, 0.5, 1e308, Infinity, -Infinity, NaN, 2 ** 53, -(2 ** 53), '1', '-5', '', ' ', 'abc', '1e9', '0x10', null, undefined, true, false,
  [], [1], {}, { a: 1 }, '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '<img src=x onerror=alert(1)>', 'x'.repeat(5000), '💥🚗',
];
const FIELDS = ['id', 'carId', 'carIds', 'caseId', 'count', 'n', 'price', 'bet', 'amount', 'startPrice', 'type', 'tier', 'tiers', 'model', 'text', 'name', 'tag',
  'code', 'kind', 'key', 'item', 'pack', 'confirm', 'yes', 'plateId', 'raceId', 'runId', 'cars', 'give', 'get', 'giveMoney', 'getMoney', 'to', 'userId', 'branch',
  'all', 'slot', 'color', 'livery', 'clientSeed', 'cell', 'mines', 'field', 'spins', 'bets', 'region', 'level', 'perk', 'role', 'q', 'sort', 'tab', 'day', 'days',
  'reaction', 'shifts', 'launch', 'shiftAt', 'gas', 'log', 'target', 'rival', 'boss', 'ready', 'on', 'seen', 'expect', 'detach', 'auto', 'full', 'keyOnly', 'step'];

// ---------- pools of real ids, refreshed from the database ----------
const P = {};
function refresh() {
  P.cars = q('SELECT id, owner_id, model, status FROM cars').all();
  P.listings = q('SELECT id, seller_id, car_id, price FROM listings').all();
  P.auctions = q("SELECT id, seller_id, car_id, start_price, top_bid FROM auctions WHERE status = 'open'").all();
  P.items = q('SELECT id, seller_id, kind, price FROM item_listings').all();
  P.plates = q('SELECT id, owner_id, car_id FROM plates').all();
  P.trades = q("SELECT id, from_id, to_id FROM trades WHERE status = 'open'").all();
  P.pvp = q("SELECT id, creator_id, opponent_id, status FROM pvp WHERE status IN ('open','pending','live')").all();
  P.parts = q('SELECT user_id, type, tier, count FROM parts WHERE count > 0').all();
  P.battles = q('SELECT id FROM battles').all();
  P.clubs = tableExists('clubs') ? q('SELECT id FROM clubs').all() : [];
}
const tableExists = (t) => !!q("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const own = (uid, st = 'garage') => P.cars.filter((c) => c.owner_id === uid && (!st || c.status === st));
const ownCar = (uid) => pick(own(uid))?.id ?? pick(P.cars)?.id ?? 1;
const anyId = () => pick([...P.cars, ...P.listings, ...P.auctions, ...P.items, ...P.plates, ...P.trades, ...P.pvp, ...P.battles, ...P.clubs].map((x) => x.id)) ?? 1;
const goodValue = (f, uid) => {
  switch (f) {
    case 'carId': case 'car': return ownCar(uid);
    case 'carIds': case 'cars': return own(uid).slice(0, 1 + ri(3)).map((c) => c.id);
    case 'id': return chance(0.5) ? anyId() : pick(['wash', 'gas', 'sto', ...S.CASES.map((c) => c.id)]);
    case 'caseId': return pick(S.CASES).id;
    case 'count': case 'n': return pick([1, 3, 6, 2, 10]);
    case 'price': case 'bet': case 'amount': case 'startPrice': case 'giveMoney': case 'getMoney': return pick([1, 1000, 50000, 1e6, 1e8]);
    case 'type': return pick(Object.keys(S.PARTS));
    case 'tier': return pick(S.TIERS).id;
    case 'model': return pick(S.ALL_MODELS).id;
    case 'confirm': case 'yes': case 'all': case 'on': return true;
    case 'to': case 'userId': return pick(PLAYERS);
    default: return pick(['a', 1, true, 'stock', 'eng']);
  }
};
const oddValue = () => pick(WEIRD);
function randomBody(uid) {
  if (chance(0.05)) return pick([null, [], 'x', 5, Object.create(null)]);
  const b = {};
  const n = ri(5);
  for (let i = 0; i < n; i++) {
    const f = chance(0.03) ? pick(['__proto__', 'constructor', 'prototype']) : pick(FIELDS);
    b[f] = chance(0.55) ? goodValue(f, uid) : oddValue();
  }
  return b;
}

// ---------- the record ----------
const bugs = new Map(); // signature → { count, first }
let stepNo = 0, okCalls = 0, failCalls = 0, lastCall = null;
const callLog = [];
let lastCharge = null;
const snapshotUser = (u) => ({ balance: q('SELECT balance FROM users WHERE id = ?').get(u)?.balance, keys: q('SELECT COALESCE(SUM(count), 0) n FROM keys WHERE user_id = ?').get(u).n, cars: q('SELECT COUNT(*) n FROM cars WHERE owner_id = ?').get(u).n });
const cov = {}, errs = {};
const COV = process.argv.includes('--cov');
function bug(kind, msg, extra = {}) {
  const sig = kind + ':' + msg.slice(0, 160);
  const b = bugs.get(sig);
  if (b) return void b.count++;
  bugs.set(sig, { kind, msg, count: 1, step: stepNo, at: new Date(T).toISOString(), last: callLog.slice(-4), ...extra });
  if (!QUIET) console.log(`\n[BUG ${kind}] step ${stepNo} ${new Date(T).toISOString()}: ${msg}\n  last calls: ${JSON.stringify(callLog.slice(-3)).slice(0, 900)}`);
  if (STOP) finish();
}
const short = (v) => {
  try {
    return JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : typeof x === 'string' && x.length > 40 ? x.slice(0, 40) + '…' : x));
  } catch {
    return String(v);
  }
};
const RNUM = /(?:^|[^\w])(NaN|undefined|\[object Object\])(?:$|[^\w])/;
function scanOut(name, out, path = '', depth = 0) {
  if (depth > 6 || out == null) return;
  if (typeof out === 'number') {
    if (!Number.isFinite(out)) bug('out-nan', `${name} → ${path} = ${out}`);
    return;
  }
  if (typeof out === 'string') {
    if (RNUM.test(out) && !/text|name|title|caption|nick|tag|msg|note|chat/i.test(path)) bug('out-text', `${name} → ${path} = «${out.slice(0, 80)}»`);
    return;
  }
  if (Array.isArray(out)) {
    for (let i = 0; i < Math.min(out.length, 30); i++) scanOut(name, out[i], path + '[' + i + ']', depth + 1);
    return;
  }
  if (typeof out === 'object') for (const [k, v] of Object.entries(out)) scanOut(name, v, path + '.' + k, depth + 1);
}

function call(uid, name, body = {}) {
  const fn = g.api[name];
  if (!fn) return null;
  lastCall = { uid, name, body };
  callLog.push({ s: stepNo, uid, name, body: short(body).slice(0, 300) });
  if (callLog.length > 50) callLog.shift();
  const pre = moneyState();
  try {
    const r = fn(uid, body);
    okCalls++;
    cov[name] = (cov[name] || 0) + 1;
    scanOut(name, r);
    lastCall.ok = true;
    return r;
  } catch (e) {
    failCalls++;
    lastCall.ok = false;
    if (e instanceof GameError) errs[name + ': ' + e.message.slice(0, 60)] = (errs[name + ': ' + e.message.slice(0, 60)] || 0) + 1;
    if (!(e instanceof GameError)) bug('500', `${name}: ${e?.constructor?.name}: ${e?.message}`, { stack: String(e?.stack).split('\n').slice(0, 6).join('\n'), body: short(body) });
    return null;
  } finally {
    checkMoney(pre, name);
  }
}
function admin(name, body) {
  callLog.push({ s: stepNo, admin: name, body: short(body).slice(0, 300) });
  const pre = moneyState();
  try {
    return g.adminCall(OWNER, name, { confirm: true, reason: 'fuzz', ...body });
  } catch (e) {
    if (!(e instanceof GameError)) bug('500', `admin/${name}: ${e?.constructor?.name}: ${e?.message}`, { stack: String(e?.stack).split('\n').slice(0, 6).join('\n') });
    return null;
  } finally {
    checkMoney(pre, 'admin/' + name);
  }
}

// ---------- invariants ----------
// Money: every change of SUM(users.balance) must be in money_days (created − destroyed). Held money (open bids,
// PvP bets, club treasuries…) is whatever the game takes off a balance: it must be logged when taken and when given
// back, so the sum of balances alone has to match the log at every step.
function moneyState() {
  const bal = q('SELECT COALESCE(SUM(balance), 0) s FROM users').get().s;
  const log = q('SELECT COALESCE(SUM(created - destroyed), 0) s FROM money_days').get().s;
  const src = q('SELECT COALESCE(SUM(created - destroyed), 0) s FROM money_src').get().s;
  return { bal, log, src };
}
let moneyGap = null;
function checkMoney(pre, name) {
  const st = moneyState();
  const gap = st.bal - st.log;
  if (moneyGap == null) moneyGap = gap;
  if (gap !== moneyGap) {
    bug('money-unlogged', `${name}: balances moved ${st.bal - pre.bal}, log moved ${st.log - pre.log} (gap ${gap - moneyGap})`);
    moneyGap = gap;
  }
  if (st.log !== st.src) bug('money-src', `${name}: money_days ${st.log} ≠ money_src ${st.src}`);
}
const capOf = (u) => {
  const me = g.api.me(u.id, {});
  return me.levelCap?.max ?? Infinity;
};
function check(tag) {
  const users = q('SELECT id, balance, stars, star_credit, level, xp, fuel, slots FROM users').all();
  for (const u of users) {
    if (!Number.isInteger(u.balance) || u.balance < 0) bug('neg-balance', `user ${u.id} balance ${u.balance} after ${tag}`);
    if (u.stars != null && (!Number.isInteger(u.stars) || u.stars < 0)) bug('neg-stars', `user ${u.id} stars ${u.stars} after ${tag}`);
    if (u.star_credit != null && (!Number.isInteger(u.star_credit) || u.star_credit < 0)) bug('neg-credit', `user ${u.id} star_credit ${u.star_credit} after ${tag}`);
    if (!Number.isFinite(u.xp) || u.xp < 0) bug('bad-xp', `user ${u.id} xp ${u.xp} after ${tag}`);
    if (!Number.isFinite(u.fuel) || u.fuel < 0) bug('bad-fuel', `user ${u.id} fuel ${u.fuel} after ${tag}`);
  }
  if (tableExists('star_credit_log')) {
    for (const r of q('SELECT u.id, u.star_credit c, COALESCE(SUM(l.delta), 0) s FROM users u LEFT JOIN star_credit_log l ON l.user_id = u.id GROUP BY u.id HAVING c <> s').all())
      bug('credit-log', `user ${r.id} star_credit ${r.c} ≠ log ${r.s} after ${tag}`);
  }
  const ids = new Set(users.map((u) => u.id));
  const stale = (sql, what) => {
    for (const r of q(sql).all()) bug('stale', `${what}: ${short(r)}`);
  };
  const bad = (sql, what) => {
    for (const r of q(sql).all()) bug('orphan', `${what}: ${short(r)} after ${tag}`);
  };
  bad("SELECT id, owner_id, status FROM cars WHERE owner_id NOT IN (SELECT id FROM users) AND owner_id > 0", 'car of a missing user');
  bad("SELECT id, owner_id, status FROM cars WHERE status NOT IN ('garage','market','auction','showcase','trade','pvp','race','room','barn','container','club','tourney')", 'car in unknown status');
  bad("SELECT l.id, l.car_id FROM listings l LEFT JOIN cars c ON c.id = l.car_id WHERE c.id IS NULL OR c.owner_id <> l.seller_id OR c.status <> 'market'", 'listing without its car on the market');
  bad("SELECT c.id, c.status FROM cars c WHERE c.status = 'market' AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.car_id = c.id)", 'car on the market without a listing');
  bad("SELECT a.id, a.car_id FROM auctions a LEFT JOIN cars c ON c.id = a.car_id WHERE a.status = 'open' AND (c.id IS NULL OR c.owner_id <> a.seller_id OR c.status <> 'auction')", 'open auction without its car');
  bad("SELECT c.id FROM cars c WHERE c.status = 'auction' AND NOT EXISTS (SELECT 1 FROM auctions a WHERE a.car_id = c.id AND a.status = 'open')", 'car on auction without an open auction');
  bad('SELECT car_id, COUNT(*) n FROM auctions WHERE status = \'open\' GROUP BY car_id HAVING n > 1', 'car in two open auctions');
  bad('SELECT p.id, p.car_id FROM plates p LEFT JOIN cars c ON c.id = p.car_id WHERE p.car_id IS NOT NULL AND (c.id IS NULL OR c.owner_id <> p.owner_id)', 'plate on a missing / foreign car');
  bad('SELECT id, owner_id FROM plates WHERE owner_id NOT IN (SELECT id FROM users) AND owner_id > 0', 'plate of a missing user');
  bad('SELECT car_id FROM car_parts WHERE car_id NOT IN (SELECT id FROM cars)', 'parts on a missing car');
  bad('SELECT user_id, case_id, count FROM keys WHERE count < 0', 'negative keys');
  bad('SELECT user_id, type, tier, count FROM parts WHERE count < 0', 'negative parts');
  bad('SELECT user_id, case_id, count FROM fragments WHERE count < 0', 'negative fragments');
  bad('SELECT user_id, case_id FROM keys WHERE user_id NOT IN (SELECT id FROM users) AND count > 0', 'keys of a missing user');
  bad('SELECT user_id FROM parts WHERE user_id NOT IN (SELECT id FROM users) AND count > 0', 'parts of a missing user');
  bad("SELECT il.id FROM item_listings il LEFT JOIN plates p ON p.id = il.plate_id WHERE il.kind = 'plate' AND (p.id IS NULL OR p.owner_id <> il.seller_id)", 'plate lot without its plate');
  bad("SELECT ti.trade_id, ti.car_id FROM trade_items ti JOIN trades t ON t.id = ti.trade_id LEFT JOIN cars c ON c.id = ti.car_id WHERE t.status = 'open' AND c.id IS NULL", 'open trade with a missing car');
  bad("SELECT id, creator_id FROM pvp WHERE status IN ('open','pending','live') AND creator_id NOT IN (SELECT id FROM users)", 'pvp of a missing user');
  bad("SELECT user_id FROM races WHERE status = 'running' GROUP BY user_id HAVING COUNT(*) > 5", 'many running races');
  stale("SELECT p.id, p.car_id FROM pvp p LEFT JOIN cars c ON c.id = p.car_id WHERE p.status IN ('open','pending') AND (c.id IS NULL OR c.owner_id <> p.creator_id)", 'open PvP challenge whose car is gone');
  stale("SELECT b.id FROM trades b JOIN trade_items i ON i.trade_id = b.id LEFT JOIN cars c ON c.id = i.car_id WHERE b.status = 'open' AND c.id IS NULL", 'open trade whose car is gone');
  if (tableExists('clubs')) {
    const cols = q("SELECT name FROM pragma_table_info('clubs')").all().map((r) => r.name);
    if (cols.includes('bank')) bad('SELECT id, bank FROM clubs WHERE bank < 0', 'club bank negative');
    if (tableExists('club_members')) bad('SELECT user_id, COUNT(*) n FROM club_members GROUP BY user_id HAVING n > 1', 'player in two clubs');
  }
  for (const u of users) if (ids.has(u.id) && PLAYERS.includes(u.id) && chance(0.2)) {
    const cap = capOf(u);
    if (u.level > cap) bug('level-cap', `user ${u.id} level ${u.level} > today's cap ${cap} (${dayOf(T)}) after ${tag}`);
  }
}

// ---------- scripted moves ----------
const others = (uid) => PLAYERS.filter((x) => x !== uid);
const goodShifts = () => Array.from({ length: S.SHIFTS }, () => pick(['perfect', 'good', 'good', 'early', 'late']));
const MOVES = {
  me: (u) => call(u, 'me'),
  collect: (u) => call(u, 'collect'),
  caseOpen: (u) => {
    const cs = pick(S.CASES.filter((c) => c.price > 0 || chance(0.2)));
    const r = call(u, 'case/open', { caseId: cs.id, count: pick([1, 1, 3, 6]), ...(chance(0.2) ? { useKey: true, key: true } : {}) });
    if (r && chance(0.4)) call(u, 'case/open', { caseId: cs.id, count: pick([1, 3, 6]) }); // double-submit
  },
  sell: (u) => {
    const c = pick(own(u));
    if (!c) return;
    call(u, 'sell', { carIds: [c.id] });
    if (chance(0.3)) call(u, 'sell', { carIds: [c.id] }); // double-submit
  },
  sellMany: (u) => {
    const cs = own(u).slice(0, 3).map((c) => c.id);
    if (cs.length) call(u, 'sell', { carIds: chance(0.3) ? [...cs, cs[0]] : cs });
  },
  race: (u) => {
    const c = pick(own(u));
    if (!c) return;
    const rv = call(u, 'race/rivals', { carId: c.id });
    const rival = rv?.rivals?.[ri(rv.rivals.length || 1)]?.id ?? rv?.list?.[0]?.id ?? 0;
    const st = call(u, 'race/start', { carId: c.id, rival: chance(0.9) ? rival : oddValue(), hard: chance(0.3) });
    if (!st) return;
    if (chance(0.1)) call(u, 'sell', { carIds: [c.id] }); // sell mid-race
    const stats = st.car || st.me?.car || st.stats;
    T += 15e3;
    let body = { raceId: st.raceId ?? st.id, reaction: 0.25, shifts: goodShifts() };
    try {
      const green = st.greenMs ?? (st.greenAt != null ? st.greenAt - (st.startAt ?? 0) : null);
      if (stats && green != null) {
        const run = honestDrag(stats, green, chance(0.05) ? -1 : 0.15 + R() * 0.3, goodShifts());
        T += Math.ceil(run.ms) + 30 - 15e3;
        body = { raceId: st.raceId ?? st.id, ...run.body };
      }
    } catch {}
    if (chance(0.15)) body.reaction = oddValue();
    call(u, 'race/finish', body);
    if (chance(0.3)) call(u, 'race/finish', body); // double-submit: paid once
  },
  drift: (u) => {
    const c = pick(own(u));
    if (!c) return;
    const rv = call(u, 'drift/rivals', { carId: c.id });
    const st = call(u, 'drift/start', { carId: c.id, rival: chance(0.2) ? 'train' : rv?.list?.[ri(rv?.list?.length || 1)]?.id });
    if (!st) return;
    T += 40e3;
    let body = { runId: st.runId ?? st.id, gas: [] };
    try {
      body = { runId: st.runId ?? st.id, ...clientDrift(st, { skill: R() }).body };
    } catch {}
    call(u, 'drift/finish', body);
    if (chance(0.3)) call(u, 'drift/finish', body);
  },
  pvp: (u) => {
    const c = pick(own(u));
    if (!c) return;
    const cr = call(u, 'pvp/create', { carId: c.id, bet: pick([1000, 100000, 1e6, -5, 0.5, 1e15]) });
    if (!cr) return;
    const o = pick(others(u));
    const oc = pick(own(o));
    if (!oc) return;
    call(u, 'pulse');
    if (chance(0.15)) call(u, 'sell', { carIds: [c.id] }); // the creator sells the car of an open challenge
    if (chance(0.1)) call(u, 'market/sell', { carId: c.id, price: 1e6 });
    if (chance(0.5)) {
      call(o, 'pvp/accept', { id: cr.id, carId: oc.id });
    } else {
      call(o, 'pvp/request', { id: cr.id, carId: oc.id });
      const live = call(u, 'pvp/answer', { id: cr.id, yes: chance(0.8) });
      if (live?.greenAt != null) {
        T += 20e3;
        for (const [who, car] of [[u, live.me?.car], [o, null]]) {
          let body = { id: cr.id, reaction: 0.2, shifts: goodShifts() };
          try {
            if (car) body = { id: cr.id, ...honestDrag(car, live.greenAt - live.startAt, 0.2, goodShifts()).body };
          } catch {}
          call(who, 'pvp/finish', body);
        }
        T += 60e3;
      }
    }
    call(u, 'pvp/state', { id: cr.id });
    if (chance(0.3)) call(u, 'pvp/cancel', { id: cr.id });
  },
  battle: (u) => {
    const cs = own(u).slice(0, 3).map((c) => c.id);
    const b = call(u, 'battle/create', { caseId: pick(S.CASES.filter((c) => c.price < 2e6)).id, count: pick([1, 3, 6, 10, 2]), botOk: chance(0.5) });
    if (b) {
      const o = pick(others(u));
      if (chance(0.7)) call(o, 'battle/join', { id: b.id });
      else call(u, 'battle/cancel', { id: b.id });
      if (chance(0.3)) call(pick(others(u)), 'battle/join', { id: b.id });
      call(u, 'battle/get', { id: b.id });
    }
  },
  marketSell: (u) => {
    const c = pick(own(u));
    if (c) call(u, 'market/sell', { carId: c.id, price: pick([1, 1000, 1e6, 1e9, 1e12, -1, 0.3, '5e5']) });
  },
  marketBuy: (u) => {
    const l = pick(P.listings);
    if (!l) return;
    call(u, 'market/buy', { id: l.id });
    if (chance(0.4)) call(pick(PLAYERS), 'market/buy', { id: l.id }); // a second buyer races for the same lot
  },
  marketCancel: (u) => {
    const l = pick(P.listings.filter((x) => x.seller_id === u)) || pick(P.listings);
    if (l) call(u, 'market/cancel', { id: l.id });
  },
  itemSell: (u) => {
    const p = pick(P.parts.filter((x) => x.user_id === u));
    const pl = pick(P.plates.filter((x) => x.owner_id === u));
    const sellIt = (body) => {
      // the price band is in the error message: retry once inside it
      try {
        return g.api['market/item-sell'](u, body);
      } catch (e) {
        const m = /від ([\d  ]+) ₴ до ([\d  ]+) ₴/.exec(e.message || '');
        if (!m) return call(u, 'market/item-sell', body);
        const lo = Number(m[1].replace(/\D/g, '')), hi = Number(m[2].replace(/\D/g, ''));
        return call(u, 'market/item-sell', { ...body, price: pick([lo, hi, Math.round((lo + hi) / 2), hi + 1]) });
      }
    };
    if (p && chance(0.5)) sellIt({ kind: 'part', type: p.type, tier: p.tier, count: pick([1, 1, p.count, p.count + 1, -1]), price: 1 });
    else if (pl) sellIt({ kind: 'plate', plateId: pl.id, id: pl.id, price: 1, detach: chance(0.5) });
  },
  itemBuy: (u) => {
    const it = pick(P.items);
    if (!it) return;
    call(u, 'market/item-buy', { id: it.id });
    if (chance(0.3)) call(pick(PLAYERS), 'market/item-buy', { id: it.id });
    if (chance(0.2)) call(it.seller_id, 'market/item-cancel', { id: it.id });
  },
  auction: (u) => {
    const c = pick(own(u));
    if (c) {
      const a = call(u, 'auction/create', { carId: c.id, startPrice: pick([1000, 1e5, 1e6, 1e9, -1]), hours: pick([1, 1, 6, 24, 0, 1e9]) });
      if (a && chance(0.3)) call(u, 'auction/cancel', { id: a.id });
    }
    const op = pick(P.auctions);
    if (op) {
      const b = call(pick(PLAYERS), 'auction/bid', { id: op.id, amount: Math.round((op.top_bid || op.start_price) * (1 + R())) });
      if (b && chance(0.4)) call(pick(PLAYERS), 'auction/bid', { id: op.id, amount: Math.round((op.top_bid || op.start_price) * 1.3) + 1 });
      if (chance(0.3)) call(op.seller_id, 'auction/cancel', { id: op.id });
    }
  },
  trade: (u) => {
    const o = pick(others(u));
    const mine = own(u).slice(0, ri(3)).map((c) => c.id), theirs = own(o).slice(0, ri(2)).map((c) => c.id);
    const t = call(u, 'trade/create', { to: o, userId: o, give: mine, get: theirs, giveMoney: pick([0, 1000, 1e6, -1]), getMoney: pick([0, 1000, -5]) });
    if (!t) return;
    const id = t.id ?? t.trade?.id;
    if (chance(0.2) && mine[0]) call(u, 'sell', { carIds: [mine[0]] }); // sell an offered car
    if (chance(0.15) && mine[0]) call(u, 'market/sell', { carId: mine[0], price: 1e6 });
    call(o, pick(['trade/accept', 'trade/accept', 'trade/decline']), { id });
    if (chance(0.3)) call(o, 'trade/accept', { id }); // double-submit
  },
  room: (u) => {
    const o = pick(others(u));
    const r = call(u, 'room/create', { to: o });
    const id = r?.id ?? r?.room?.id;
    if (!id) return;
    call(o, 'room/join', { id });
    const a = pick(own(u)), b = pick(own(o));
    if (a) call(u, 'room/offer', { id, add: a.id, money: pick([0, 1000, 1e6, -5]) });
    if (b) call(o, 'room/offer', { id, add: b.id, money: pick([0, 0, 5000]) });
    let v = call(u, 'room/state', { id })?.room?.version ?? call(u, 'room/state', { id })?.version;
    if (chance(0.15) && a) call(u, 'parts/uninstall', { carId: a.id, type: 'eng' });
    if (chance(0.1) && a) call(u, 'sell', { carIds: [a.id] });
    call(u, 'room/ready', { id, ready: true, version: v });
    if (chance(0.15)) call(u, 'admin-pay-out-of-band'); // nothing: placeholder for interleaving
    v = call(o, 'room/state', { id })?.room?.version ?? call(o, 'room/state', { id })?.version ?? v;
    call(o, 'room/ready', { id, ready: true, version: v });
    if (chance(0.3)) call(u, 'room/ready', { id, ready: true, version: v });
    if (chance(0.3)) call(pick([u, o]), 'room/leave', { id });
  },
  plates: (u) => {
    const r = call(u, 'plate/generate', chance(0.5) ? {} : { region: chance(0.8) ? pick(S.PLATE_REGIONS) : oddValue(), gen: pick([undefined, 'basic', 'rare', oddValue()]) });
    const pl = pick(P.plates.filter((x) => x.owner_id === u));
    const c = pick(own(u));
    if (pl && c) call(u, 'plate/attach', { plateId: pl.id, carId: c.id, id: pl.id });
    if (pl && chance(0.3)) call(u, 'plate/detach', { plateId: pl.id, id: pl.id });
    if (pl && chance(0.2)) call(u, 'plate/sell', { plateId: pl.id, id: pl.id });
    if (chance(0.2)) call(u, 'plateAuction');
    return r;
  },
  parts: (u) => {
    const pc = pick(S.PART_CASES);
    call(u, 'parts/open', { id: pc.id, caseId: pc.id, count: pick([1, 3, 5, 10, 6, -1, 1e9]) });
    const p = pick(P.parts.filter((x) => x.user_id === u));
    const c = pick(own(u));
    if (p && c) call(u, 'parts/install', { carId: c.id, type: p.type, tier: p.tier });
    if (p) call(u, 'parts/merge', { type: p.type, tier: p.tier, count: pick([1, 3, 5, -3, 1e9]) });
    if (c && chance(0.3)) call(u, 'parts/install-best', { carId: c.id });
    if (c && chance(0.3)) call(u, 'parts/uninstall', { carId: c.id, type: p?.type || 'eng' });
    if (p && chance(0.2)) call(u, 'parts/sell', { type: p.type, tier: p.tier, count: pick([1, -1, 1e9, 'x']) });
    if (chance(0.1)) call(u, 'parts/sell-junk');
  },
  paint: (u) => {
    const c = pick(own(u));
    if (!c) return;
    call(u, 'car/paint', { carId: c.id, color: pick([...S.PAINT_COLORS.map((x) => x.id), '#ff00ff', oddValue()]) });
    if (chance(0.3)) call(u, 'car/livery', { carId: c.id, livery: pick(['stripes', oddValue()]) });
    if (chance(0.2)) call(u, 'car/paint-reset', { carId: c.id });
    call(u, 'wash/hand', { carId: c.id });
    call(u, 'wash/auto', { carIds: chance(0.7) ? own(u).map((x) => x.id) : [c.id, c.id] });
    if (chance(0.3)) call(u, 'showcase', { carId: c.id, put: true });
    if (chance(0.2)) call(u, 'showcase', { carId: pick(own(u, 'showcase'))?.id, put: false });
    if (chance(0.2)) call(u, 'upgrade', { carIds: own(u).slice(0, 3).map((x) => x.id), target: pick(S.ALL_MODELS).id });
  },
  biz: (u) => {
    const id = pick(['wash', 'gas', 'sto', 'x', '__proto__']);
    call(u, 'biz/buy', { id });
    call(u, 'biz/upgrade', { id, branch: pick(['eq', 'staff', 'ads', 'build', 'x', undefined]) });
    call(u, 'biz/collect', { id, all: chance(0.5) });
    if (chance(0.3)) call(u, 'biz/collect', { all: true }); // double-submit
  },
  club: (u) => {
    const c = pick(P.clubs);
    const r = pick(['club/create', 'club/join', 'club/join', 'club/leave', 'club/donate', 'club/donate', 'club/perk', 'club/claim', 'club/edit', 'club/kick', 'club/role', 'club/transfer', 'club/invite', 'club', 'club/league']);
    const perks = Object.keys(S.CLUB?.perks || {});
    const body = { id: c?.id, name: 'Клуб ' + ri(1000), tag: pick(['ABCD', 'ZZ' + (10 + ri(89)), '__proto__', '', 'ЖИГА']), amount: pick([1000, 50000, 1e6, -5, 1e15]), perk: pick([...perks, 'x', '__proto__']), level: pick([1, 2, 3, 0, 9]), kind: pick(['daily', 'weekly', 'x']), userId: pick(PLAYERS), role: pick(['officer', 'member', 'owner']), to: pick(PLAYERS) };
    call(u, r, body);
    if (chance(0.2)) call(u, r, body);
  },
  pass: (u) => {
    call(u, 'season');
    const r1 = call(u, 'season/claim', {});
    const pre = snapshotUser(u);
    const r2 = call(u, 'season/claim', {}); // double-submit
    const post = snapshotUser(u);
    if (r1 && r2 && (post.balance > pre.balance || post.keys > pre.keys || post.cars > pre.cars)) bug('paid-twice', `season/claim paid again: ${short(pre)} → ${short(post)}`);
  },
  shop: (u) => {
    const items = Object.keys(S.SHOP_BY_ID);
    call(u, 'shop');
    call(u, 'shop/stars', { item: pick(items), id: pick(items), pack: pick(items) });
    const it = pick(items);
    call(u, 'shop/credit', { item: it, confirm: false });
    call(u, 'shop/credit', { item: it, confirm: true });
    if (chance(0.3)) call(u, 'shop/credit', { item: it, confirm: true });
  },
  daily: (u) => {
    const keys = [];
    const harvest = (o, d = 0) => {
      if (!o || typeof o !== 'object' || d > 5) return;
      if (Array.isArray(o)) return o.slice(0, 40).forEach((x) => harvest(x, d + 1));
      for (const [k, v] of Object.entries(o)) {
        if ((k === 'key' || k === 'id') && (typeof v === 'string' || typeof v === 'number')) keys.push(v);
        else harvest(v, d + 1);
      }
    };
    for (const k of ['quests', 'weekly', 'sets', 'achievements', 'rewards', 'goals']) harvest(call(u, k));
    for (const k of ['rewards/daily', 'rewards/case', 'streak/claim', 'newbie/claim', 'goals/key', 'goals/streak', 'weekly/claim', 'weekly/chest', 'quests/claim', 'collection/claim', 'sets/claim', 'ach/claim', 'rescue/claim', 'rewards/all']) {
      if (chance(0.4)) {
        const kk = pick(keys.length ? keys : ['x']);
        const body = { id: kk, key: kk, days: pick([1, 3, 5, 7]), tier: pick([0, 1, 2]) };
        const r1 = call(u, k, body);
        const pre = snapshotUser(u);
        const r2 = call(u, k, body); // double-submit: paid once
        const post = snapshotUser(u);
        if (k !== 'newbie/claim' && r1 && r2 && (post.balance > pre.balance || post.keys > pre.keys || post.cars > pre.cars)) bug('paid-twice', `${k} ${short(body)} paid again on a double-submit: ${short(pre)} → ${short(post)}`);
      }
    }
    call(u, pick(['goals', 'weekly', 'quests', 'events', 'rewards', 'achievements', 'sets', 'collection/claim']));
  },
  tourney: (u) => {
    call(u, 'tourney');
    const c = pick(own(u));
    if (c) call(u, 'tourney/join', { carId: c.id });
    if (c) call(u, 'tourney/start', { carId: c.id });
    if (chance(0.2)) call(u, 'tourney/leave');
    if (chance(0.5)) call(u, 'tourney/start', { id: anyId() });
    if (c && chance(0.1)) call(u, 'sell', { carIds: [c.id] }); // sell the tourney car
  },
  misc: (u) => {
    const k = pick(['buy-slot', 'tank/upgrade', 'buy-showcase', 'showcase', 'upgrade', 'dealer/tradein', 'containers', 'containers/bid', 'barn', 'barn/start', 'barn/claim',
      'dayrace', 'dayrace/start', 'dayrace/claim', 'buyer/sell', 'prestige', 'prestige/trophy', 'showroom/set', 'boss/list', 'boss/start', 'challenge/create',
      'fair/seed', 'fair/rotate', 'promo', 'dream/set', 'emoji/set', 'style/equip', 'frames/equip', 'level/seen', 'casino/slots', 'casino/roulette', 'casino/mines/start',
      'casino/crash/start', 'fuel/deal', 'vip/sale']);
    call(u, k, randomBody(u));
  },
  harvested: (u) => {
    // a listing endpoint, then its actions with the ids it shows
    const ids = [];
    const harvest = (o, d = 0) => {
      if (!o || typeof o !== 'object' || d > 5) return;
      if (Array.isArray(o)) return o.slice(0, 40).forEach((x) => harvest(x, d + 1));
      for (const [k, v] of Object.entries(o)) {
        if (k === 'id' && (typeof v === 'string' || typeof v === 'number')) ids.push(v);
        else harvest(v, d + 1);
      }
    };
    const amt = () => pick([1000, 50000, 1e6, 3e7, -1, 1e15]);
    const c = pick(own(u));
    const [list, acts] = pick([
      ['containers', ['containers/lot', 'containers/bid', 'containers/bid', 'containers/open', 'containers/expert']],
      ['barn', ['barn/start', 'barn/rush', 'barn/claim', 'barn/drop', 'barn/weekly']],
      ['plateAuction', ['plateAuction/bid', 'plateAuction/bid']],
      ['boss/list', ['boss/start']],
      ['buyer', ['buyer/sell']],
      ['prestige', ['prestige/restyle', 'prestige/trophy']],
      ['showroom', ['showroom/set', 'showroom/like', 'showroom/get']],
      ['challenge/list', ['challenge/get', 'challenge/start']],
      ['dayrace', ['dayrace/start', 'dayrace/claim']],
      ['frames', ['frames/equip', 'frames/helmet']],
      ['contest', ['contest']],
      ['pvp/list', ['pvp/accept', 'pvp/withdraw', 'pvp/progress', 'pvp/cancel']],
      ['trade/list', ['trade/cancel', 'trade/decline', 'trade/accept']],
    ]);
    harvest(call(u, list, c ? { carId: c.id } : {}));
    for (const a of acts) {
      const id = pick(ids.length ? ids : [1]);
      const body = { id, boss: id, carId: c?.id, cars: own(u).slice(0, 3).map((x) => x.id), amount: amt(), field: pick(['model', 'cls', 'x']), full: true, on: true, frame: id };
      const pre = snapshotUser(u);
      const r = call(u, a, body);
      if (a === 'dayrace/start' && r) {
        T += 15e3;
        call(u, 'race/finish', { raceId: r.raceId ?? r.id, reaction: 0.3, shifts: goodShifts() });
      }
      if (r && /claim|trophy|weekly/.test(a)) {
        const mid = snapshotUser(u);
        const r2 = call(u, a, body);
        const post = snapshotUser(u);
        if (r2 && (post.balance > mid.balance || post.keys > mid.keys || post.cars > mid.cars)) bug('paid-twice', `${a} paid again on a double-submit: ${short(mid)} → ${short(post)}`);
      }
      void pre;
    }
  },
  casino: (u) => {
    const k = pick(['slots', 'roulette', 'crash', 'mines']);
    const a = pick([1000, 10000, 1e6, -1, 0.5, 1e15]);
    if (k === 'slots') call(u, 'casino/slots', { amount: a });
    if (k === 'roulette') call(u, 'casino/roulette', { bets: [{ on: pick(['red', 'black', 'even', 7, '0', '__proto__', 'constructor', 40]), amount: a }, ...(chance(0.3) ? [{ on: 'red', amount: a }] : [])] });
    if (k === 'crash') {
      const r = call(u, 'casino/crash/start', { amount: a, auto: pick([undefined, 1.5, 2, 0.5, 1e9, NaN]) });
      T += ri(20e3);
      call(u, 'casino/crash/state', { id: r?.id });
      call(u, 'casino/crash/cashout', { id: r?.id, at: pick([undefined, 1.2, 50]) });
      if (chance(0.3)) call(u, 'casino/crash/cashout', { id: r?.id });
    }
    if (k === 'mines') {
      call(u, 'casino/mines/start', { amount: a, mines: pick([1, 3, 5, 24, 0, 25, -1]) });
      for (let i = 0; i < 1 + ri(4); i++) call(u, 'casino/mines/reveal', { cell: pick([ri(25), ri(25), -1, 25, 'x']) });
      call(u, 'casino/mines/cashout');
      if (chance(0.3)) call(u, 'casino/mines/cashout');
    }
  },
  challenge: (u) => {
    const r = q('SELECT id FROM races WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(u);
    if (!r) return;
    const ch = call(u, 'challenge/create', { raceId: r.id });
    const id = ch?.id ?? ch?.challenge?.id;
    if (!id) return;
    const o = pick(others(u));
    call(o, 'challenge/get', { id });
    const st = call(o, 'challenge/start', { id, carId: pick(own(o))?.id });
    if (st) {
      T += 15e3;
      call(o, 'race/finish', { raceId: st.raceId ?? st.id, reaction: 0.3, shifts: goodShifts() });
    }
  },
  stars: (u) => {
    // Telegram Stars payments as the bot credits them; a repeated charge id must apply once
    const items = Object.keys(S.SHOP_BY_ID);
    const it = pick(items);
    const charge = chance(0.3) && lastCharge ? lastCharge : 'ch' + stepNo + '-' + ri(1e6);
    lastCharge = charge;
    const pre = snapshotUser(u);
    let r;
    try {
      r = g.creditItem({ chargeId: charge, userId: u, itemId: it, stars: S.SHOP_BY_ID[it].stars || 1, recurring: chance(0.2), first: chance(0.5) });
    } catch (e) {
      if (!(e instanceof GameError)) bug('500', `creditItem: ${e.message}`, { stack: String(e.stack).split('\n').slice(0, 5).join('\n') });
    }
    if (r?.duplicate || r?.refund) {
      const post = snapshotUser(u);
      if (post.balance !== pre.balance || post.keys !== pre.keys || post.cars !== pre.cars) bug('paid-twice', `creditItem ${it} ${r.duplicate ? 'duplicate' : 'refund'} still changed the player: ${short(pre)} → ${short(post)}`);
    }
  },
  garbage: (u) => {
    const names = Object.keys(g.api);
    const k = pick(names);
    const body = randomBody(u);
    call(u, k, body);
    if (chance(0.2)) call(u, k, body); // double-submit
  },
  give: (u) => {
    // the owner pays a player (logged money), sometimes a car or keys
    admin('money', { id: u, amount: pick([1e6, 5e7, -1e6]) });
    if (chance(0.3)) admin('give-car', { id: u, model: pick(S.ALL_MODELS).id });
    if (chance(0.2)) admin('keys', { id: u, caseId: pick(S.CASES).id, count: pick([1, 3, -2]) });
    if (chance(0.1)) admin('part', { id: u, type: pick(Object.keys(S.PARTS)), tier: pick(S.TIERS).id, count: pick([1, 5, -1]) });
    if (chance(0.2)) admin('give-plate', { id: u, text: 'AA' + ri(9999) + 'XX' });
  },
  xp: (u) => {
    // a lot of XP at once: levels must stop at the daily cap
    admin('set', { id: u, field: 'xp', value: pick([1e5, 1e7]) });
    call(u, 'me');
  },
  reset: (u) => {
    if (chance(0.25)) admin('reset', { id: u });
  },
};
const WEIGHTS = { me: 3, collect: 4, caseOpen: 10, sell: 5, sellMany: 2, race: 8, drift: 4, pvp: 4, battle: 2, marketSell: 5, marketBuy: 5, marketCancel: 2, itemSell: 3, itemBuy: 3,
  auction: 4, trade: 4, room: 3, plates: 4, parts: 6, paint: 3, biz: 4, club: 4, pass: 2, shop: 2, daily: 5, tourney: 2, misc: 6, harvested: 8, casino: 3, challenge: 2, stars: 2, garbage: 18, give: 3, xp: 1, reset: 1 };
const BAG = Object.entries(WEIGHTS).flatMap(([k, w]) => Array(w).fill(k));

// ---------- the clock ----------
const KYIV_MIDNIGHT = (t) => {
  // next 00:00 Kyiv after t (Kyiv is UTC+2 in winter, +3 in summer: try both, take the nearest after t whose dayOf flips)
  let x = t + 60e3;
  for (let i = 0; i < 26 * 60; i++, x += 60e3) if (dayOf(x) !== dayOf(t)) return x;
  return t + 86400e3;
};
function timeTravel() {
  const r = R();
  if (r < 0.55) T += ri(120) * 1000;
  else if (r < 0.8) T += ri(4 * 3600) * 1000;
  else if (r < 0.9) T = KYIV_MIDNIGHT(T) - ri(3) * 1000 + ri(3) * 1000; // right at Kyiv midnight
  else if (r < 0.96) T += 86400e3 + ri(3600e3);
  else if (r < 0.985) {
    // the next Monday 00:00 Kyiv (week change)
    let x = T;
    for (let i = 0; i < 8; i++) {
      x = KYIV_MIDNIGHT(x);
      if (new Date(x + 3 * 3600e3).getUTCDay() === 1) break;
    }
    T = x - 1000 + ri(2000);
  } else {
    // the season boundary
    const s = S.seasonOf(T);
    T = S.SEASON.start + s * S.SEASON.days * 86400e3 - 1000 + ri(2000);
  }
}

// ---------- run ----------
function setup() {
  for (const id of PLAYERS) {
    g.ensureUser({ id, first_name: 'F' + id, username: 'fz' + id });
  }
  for (const id of PLAYERS) {
    admin('money', { id, amount: pick([2e6, 5e7, 1e9]) });
    for (let i = 0; i < 2; i++) admin('give-car', { id, model: pick(S.ALL_MODELS.filter((m) => !m.secret)).id });
  }
  admin('casino-mode', { mode: 'on' });
  // star credit for half the players, written as season2.js writes it (with its log row)
  for (const id of PLAYERS.slice(0, NP / 2)) {
    const c = pick([50, 500, 5000]);
    q('UPDATE users SET star_credit = star_credit + ? WHERE id = ?').run(c, id);
    q("INSERT INTO star_credit_log (user_id, delta, what, balance, at) VALUES (?, ?, 'fuzz', ?, ?)").run(id, c, c, T);
  }
  refresh();
  check('setup');
}
function finish() {
  check('end');
  const list = [...bugs.values()];
  console.log(`\nseed ${SEED}: ${stepNo} steps, ${okCalls} ok calls, ${failCalls} rejected, clock ${new Date(T).toISOString()}`);
  console.log(`${list.length} distinct problem(s)`);
  for (const b of list) {
    console.log(`- [${b.kind}] ×${b.count} (first at step ${b.step}, ${b.at}) ${b.msg}`);
    if (b.stack) console.log('  ' + b.stack.split('\n').slice(0, 3).join('\n  '));
    console.log('  calls: ' + JSON.stringify(b.last).slice(0, 700));
  }
  if (COV) {
    const names = Object.keys(g.api);
    console.log('\nnever succeeded: ' + names.filter((n) => !cov[n]).join(' '));
    console.log('top rejections:\n' + Object.entries(errs).sort((a, b) => b[1] - a[1]).slice(0, 400).map(([k, v]) => `  ${v} ${k}`).join('\n'));
  }
  process.exit(list.length ? 1 : 0);
}
// --proto: every endpoint × every field name × a prototype key / odd value, the other fields valid (after a warm-up
// so there are cars, parts and lots to point at). Afterwards no table may hold a prototype key as a game id.
const PROTO = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'];
function protoSweep() {
  const names = Object.keys(g.api).filter((n) => !/^(support\/send|hall\/chat|room\/chat)$/.test(n));
  for (const name of names) {
    for (const f of FIELDS) {
      for (const v of [...PROTO, NaN, -1, 1e300, [], {}]) {
        const u = pick(PLAYERS);
        const body = {};
        for (const f2 of FIELDS) if (chance(0.25)) body[f2] = goodValue(f2, u);
        body[f] = v;
        stepNo++;
        call(u, name, body);
      }
    }
    refresh();
    check('proto ' + name);
    protoStored(name);
  }
}
function protoStored(after) {
  for (const { name: t } of q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    if (/log|chat|support|ideas|events|admin|funnel|money_src|sessions|serverlog|outbox|gifts|meta|car_ctx/.test(t)) continue;
    for (const { name: c, type } of q(`SELECT name, type FROM pragma_table_info('${t}')`).all()) {
      if (!/TEXT|^$/.test(type) || /name|text|note|about|title|caption|reason|nick|tag|msg|username|data|result|snapshot|rival|json|style|flags|feats|seed/i.test(c)) continue;
      const r = q(`SELECT COUNT(*) n FROM "${t}" WHERE "${c}" IN (${PROTO.map(() => '?').join(',')})`).get(...PROTO);
      if (r.n) bug('proto-stored', `${t}.${c} holds a prototype key`, { after });
    }
  }
}
setup();
if (process.argv.includes('--proto')) {
  for (let i = 0; i < 300; i++) {
    stepNo++;
    try {
      MOVES[pick(BAG.filter((m) => m !== 'garbage' && m !== 'reset'))](pick(PLAYERS));
    } catch {}
    refresh();
  }
  protoSweep();
  finish();
}
for (stepNo = 1; stepNo <= STEPS; stepNo++) {
  if (chance(0.25)) timeTravel();
  if (process.env.FUZZ_SELFTEST && stepNo === 10) {
    // the runner checks itself: an unlogged balance write and a negative key count must be caught
    const pre = moneyState();
    q('UPDATE users SET balance = balance + 5 WHERE id = ?').run(PLAYERS[0]);
    q("INSERT INTO keys (user_id, case_id, count) VALUES (?, 'rust', -1) ON CONFLICT DO UPDATE SET count = -1").run(PLAYERS[0]);
    checkMoney(pre, 'selftest');
  }
  const u = pick(PLAYERS);
  const mv = pick(BAG);
  try {
    MOVES[mv](u);
  } catch (e) {
    bug('runner', `${mv}: ${e?.message}`, { stack: String(e?.stack).split('\n').slice(0, 4).join('\n') });
  }
  refresh();
  check(mv);
  if (!QUIET && stepNo % 500 === 0) process.stdout.write(`.${stepNo}`);
}
finish();
