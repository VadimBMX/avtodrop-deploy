// Security and anti-cheat (wave 3, 2026-10-29-security): no admin-rigged drops, «Чесна гра» checks every drop path,
// money guards, own-key lookups, admin self-dealing, promo guessing, Telegram sign-in freshness, DEV sign-in, per-
// endpoint limits, CSP, double claims, car duplication through market / trades / rooms, container bids, race replays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, GameError, fairRoll } from '../src/game.js';
import { verifyInitData, signInitData } from '../src/auth.js';
import { createApp } from '../server.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

const T0 = Date.parse('2026-10-28T10:00:00Z');
function setup(extra = {}) {
  const db = openDb(':memory:');
  const clock = { t: T0 };
  const g = createGame(db, { now: () => clock.t, notify: () => {}, admins: [1], allUnlocked: true, partCooldownMs: 0, ...extra });
  const mk = (id, balance = 1e10) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET balance = ?, slots = 60, level = 60, level_seen = 60, cases_opened = 100 WHERE id = ?').run(balance, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  const car = (uid, cls = 'C') => g.giveCar(uid, S.ALL_MODELS.find((m) => m.cls === cls && !m.secret && !m.edition && !S.isCollector(m.id)).id).id;
  const ok = { confirm: true, reason: 'перевірка' };
  return { db, g, clock, mk, call, bal, car, ok };
}

// ---------- «Підкрутка» and «Гарантована машина» are gone ----------
test('no admin-rigged drops: the luck / rig actions are gone, old rows and luck bonuses are ignored', () => {
  const { db, g, mk, call, ok } = setup();
  mk(1);
  mk(5);
  for (const k of ['luck', 'rig', 'rig-cancel']) {
    assert.equal(g.admin[k], undefined, k);
    assert.equal(g.adminCall('tg:1', k, { id: 5, model: 'lexus-lfa', chance: 100, opens: 50, ...ok }), undefined, k);
  }
  // Old data from before the removal: a waiting rigged car and an admin luck bonus.
  db.prepare("INSERT INTO rigged_drops (user_id, model, created_at) VALUES (5, 'lexus-lfa', ?)").run(T0);
  db.prepare('UPDATE users SET luck_bonus = 1, luck_bonus_left = 100 WHERE id = 5').run();
  assert.equal(call(5, 'me').luck, 0, 'the admin bonus no longer counts');
  assert.ok(!('luckLeft' in g.admin.user('tg:1', { id: 5 }).user) && !('rigs' in g.admin.user('tg:1', { id: 5 }).user));
  for (let i = 0; i < 20; i++) call(5, 'case/open', { caseId: 'c-jp', count: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rigged_drops WHERE used_at IS NULL').get().n, 1, 'never used');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM drops WHERE forced = 3').get().n, 0);
  assert.equal(db.prepare('SELECT luck_bonus_left n FROM users WHERE id = 5').get().n, 100, 'not even counted down');
});

// ---------- «Чесна гра» ----------
test('«Чесна гра»: every drop (plain, luck, guarantee, streak save, luck weekend) checks out from the revealed seed', () => {
  const { db, g, mk, call, clock, ok } = setup();
  mk(1);
  db.prepare('UPDATE users SET slots = 100000 WHERE id = 1').run();
  const ids = S.CASES.filter((c) => !c.starter).map((c) => c.id);
  const hows = new Set();
  for (const ev of [false, true]) {
    if (ev) g.adminCall('tg:1', 'game-events/start', { event: 'luck', hours: 48, ...ok });
    for (let i = 0; i < 50; i++) {
      // A losing streak and a run of bad luck now and then, so the save and the luck throw take part.
      if (i % 7 === 0) db.prepare('UPDATE users SET luck_spent = 1e9, luck_got = 0, bad_streak = ? WHERE id = 1').run(i % 14 ? 7 : 12);
      call(1, 'case/open', { caseId: ids[i % ids.length], count: 1 });
      clock.t += 1000;
    }
    const hist = call(1, 'case/history');
    const { revealed } = call(1, 'fair/rotate');
    for (const h of hist) {
      const cs = S.CASE_BY_ID[h.caseId];
      const roll = (sub) => fairRoll(revealed, h.clientSeed, h.nonce, sub);
      const v = S.verifyCaseDrop(cs, h, roll);
      assert.ok(v.ok, `${h.caseId} #${h.nonce} ${h.item} forced=${h.forced}`);
      hows.add(v.how);
      // A plain drop has exactly one right answer: a tampered record never checks out.
      const other = cs.pool(h.cls).find((m) => m.id !== h.item);
      if (other && h.forced === 0) assert.equal(S.verifyCaseDrop(cs, { ...h, item: other.id }, roll).ok, false);
    }
    db.prepare('DELETE FROM drops').run();
  }
  assert.ok(hows.has('roll') && hows.has('save') && hows.has('luck'), [...hows].join(','));
});

// ---------- money guards ----------
test('money: a negative or NaN price can never pay out (a corrupted lot is refused, not paid)', () => {
  const { db, mk, call, bal, car } = setup();
  mk(1);
  mk(2);
  car(2);
  const c = car(2);
  call(2, 'market/sell', { carId: c, price: 50000 });
  const lot = db.prepare('SELECT id FROM listings WHERE car_id = ?').get(c).id;
  for (const price of [-1e9, 'abc']) {
    db.prepare('UPDATE listings SET price = ? WHERE id = ?').run(price, lot);
    const before = bal(1);
    assert.throws(() => call(1, 'market/buy', { id: lot }), GameError, String(price));
    assert.equal(bal(1), before);
  }
  for (const amount of [-5, '1e3', 1.5, NaN, 1e300, [], {}]) assert.throws(() => call(1, 'auction/bid', { id: 1, amount }), GameError);
});

// ---------- own-key lookups ----------
test('player-sent keys: __proto__ / constructor never reach Object members (clean errors, not crashes)', () => {
  const { mk, call, car } = setup();
  mk(1);
  const c = car(1);
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.throws(() => call(1, 'case/open', { caseId: key }), GameError, key);
    assert.throws(() => call(1, 'parts/open', { caseId: key }), GameError, key);
    assert.throws(() => call(1, 'shop/stars', { item: key }), GameError, key);
    assert.throws(() => call(1, 'dream/set', { model: key }), GameError, key);
    assert.throws(() => call(1, 'style/equip', { slot: 'frame', id: `cos:s1:${key.toLowerCase()}` }), GameError, key);
  }
  assert.throws(() => call(1, 'parts/uninstall', { carId: c }), GameError);
  assert.equal(S.cosmeticOf('cos:s1:constructor'), null);
});

// ---------- admin roles ----------
test('admin roles: an admin can\'t change his own account, the owner\'s or another admin\'s; the owner can; all logged', () => {
  const { db, g, mk, bal, car, ok } = setup();
  for (const id of [1, 2, 3, 10]) mk(id, 1000);
  g.admin.role('tg:1', { id: 2, role: 'admin' });
  g.admin.role('tg:1', { id: 3, role: 'admin' });
  const c2 = car(2);
  for (const [name, body] of [['money', { id: 2, amount: 1e9 }], ['give-car', { id: 2, model: 'vaz-2107' }], ['keys', { id: 2, caseId: 'rust', count: 5 }],
    ['part', { id: 2, type: 'eng', tier: 'pro', count: 1 }], ['set', { id: 2, field: 'slots', value: 99 }], ['remove-car', { carId: c2 }]]) {
    assert.throws(() => g.adminCall('tg:2', name, { ...body, ...ok }), /Свій акаунт/, name);
  }
  for (const [name, body] of [['ban', { id: 1, banned: true }], ['reset', { id: 3 }], ['money', { id: 1, amount: -500 }], ['ban', { id: 3, banned: true }]]) {
    assert.throws(() => g.adminCall('tg:2', name, { ...body, ...ok }), /лише власник/, name);
  }
  assert.equal(bal(2), 1000);
  g.adminCall('tg:2', 'money', { id: 10, amount: 500, ...ok }); // a player: fine
  g.adminCall('tg:1', 'money', { id: 2, amount: 500, ...ok }); // the owner may
  assert.deepEqual([bal(10), bal(2)], [1500, 1500]);
  assert.deepEqual(db.prepare("SELECT admin, target FROM admin_log WHERE action = 'money' ORDER BY id").all().map((r) => [r.admin, r.target]), [['tg:2', 10], ['tg:1', 2]]);
  // The bot's /give and /promo carry the owner who typed them.
  g.adminGive(10, 100, 1);
  g.createPromo('SECBOT', 100, 1, null, 1);
  assert.deepEqual(db.prepare("SELECT action FROM admin_log WHERE admin = 'bot:1' ORDER BY id").all().map((r) => r.action), ['money', 'promo']);
  assert.equal(g.adminCall('tg:1', 'log', {}).list.find((l) => l.admin === 'bot:1').adminName, 'bot · U1');
});

// ---------- promo codes ----------
test('promo codes: 5 wrong guesses lock the player out for 10 minutes', () => {
  const { g, mk, call, bal, clock } = setup();
  mk(1);
  g.createPromo('REALCODE', 777, 10);
  for (let i = 0; i < 5; i++) assert.throws(() => call(1, 'promo', { code: 'GUESS' + i }), /недійсний/);
  assert.throws(() => call(1, 'promo', { code: 'REALCODE' }), /Забагато/);
  clock.t += 10 * 60e3 + 1;
  const before = bal(1);
  assert.equal(call(1, 'promo', { code: 'REALCODE' }).got, 777);
  assert.equal(bal(1), before + 777);
  assert.throws(() => call(1, 'promo', { code: 'REALCODE' }), /вже використав/);
});

// ---------- Telegram sign-in ----------
test('initData: valid and fresh only — stale, from the future, non-integer date, wrong token or tampered refused', () => {
  const token = '123:ABC', now = 1_800_000_000;
  const user = JSON.stringify({ id: 42, first_name: 'A' });
  const sign = (auth_date) => signInitData({ auth_date: String(auth_date), user }, token);
  assert.equal(verifyInitData(sign(now - 60), token, 86400, now).user.id, 42);
  assert.equal(verifyInitData(sign(now - 60), token, 86400, now).authDate, now - 60);
  assert.equal(verifyInitData(sign(now - 86401), token, 86400, now), null, 'stale');
  assert.equal(verifyInitData(sign(now + 3600), token, 86400, now), null, 'from the future');
  assert.equal(verifyInitData(sign(`${now}.5`), token, 86400, now), null, 'not an integer');
  assert.equal(verifyInitData(sign(now), 'other', 86400, now), null);
  assert.equal(verifyInitData(sign(now).replace('%22A%22', '%22B%22'), token, 86400, now), null, 'tampered');
});

// ---------- HTTP: DEV sign-in, limits, CSP ----------
async function serve(opts) {
  const app = createApp({ dbFile: ':memory:', log: () => {}, ...opts });
  await new Promise((r) => app.server.listen(0, r));
  return { app, url: (p) => `http://localhost:${app.server.address().port}${p}` };
}
const devUser = (id) => ({ 'x-dev-user': encodeURIComponent(JSON.stringify({ id, first_name: 'T' + id })), 'content-type': 'application/json' });

test('DEV sign-in: with a bot token only from this computer (never through the proxy); a test copy without a token as before', async () => {
  const withToken = await serve({ dev: true, token: 'T' });
  try {
    assert.equal((await fetch(withToken.url('/api/me'), { method: 'POST', headers: devUser(7) })).status, 200, 'local');
    assert.equal((await fetch(withToken.url('/api/me'), { method: 'POST', headers: { ...devUser(7), 'x-forwarded-for': '203.0.113.9' } })).status, 401, 'via proxy');
  } finally {
    withToken.app.close();
  }
  const noToken = await serve({ dev: true });
  try {
    assert.equal((await fetch(noToken.url('/api/me'), { method: 'POST', headers: { ...devUser(7), 'x-forwarded-for': '203.0.113.9' } })).status, 200, 'staging without a bot');
  } finally {
    noToken.app.close();
  }
  const prod = await serve({ token: 'T' });
  try {
    assert.equal((await fetch(prod.url('/api/me'), { method: 'POST', headers: devUser(7) })).status, 401, 'no DEV: no header sign-in at all');
  } finally {
    prod.app.close();
  }
});

test('limits: money-moving calls at most 30 per 10 s per player (reads are not counted against them); CSP is strict', async () => {
  const { app, url } = await serve({ dev: true });
  try {
    const h = devUser(8);
    let first429 = 0;
    for (let i = 1; i <= 32 && !first429; i++) {
      const r = await fetch(url('/api/promo'), { method: 'POST', headers: h, body: JSON.stringify({ code: 'X' }) });
      if (r.status === 429) first429 = i;
    }
    assert.equal(first429, 31);
    assert.equal((await fetch(url('/api/me'), { method: 'POST', headers: h })).status, 200, 'a read still works');
    const csp = (await fetch(url('/'))).headers.get('content-security-policy');
    for (const part of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "script-src 'self' https://telegram.org;"]) assert.ok(csp.includes(part), part);
    assert.ok(!/unsafe-inline[^;]*;/.test(csp.split('script-src')[1].split(';')[0] + ';'), 'no inline scripts');
  } finally {
    app.close();
  }
});

// ---------- double claims ----------
test('rewards: no claim pays twice — every claim call and «Забрати все» repeated give nothing more', () => {
  const { db, g, mk, call, clock } = setup();
  mk(1);
  db.prepare('UPDATE users SET races = 500, wins = 400, merges = 50, xp = 0, streak = 6, slots = 100000 WHERE id = 1').run();
  for (let i = 0; i < 30; i++) call(1, 'case/open', { caseId: 'c-ua', count: 6 });
  const worth = () => ({
    ...db.prepare('SELECT balance, banked, stars, slots, fuel FROM users WHERE id = 1').get(),
    keys: db.prepare('SELECT COALESCE(SUM(count), 0) n FROM keys WHERE user_id = 1').get().n,
    cars: db.prepare('SELECT COUNT(*) n FROM cars WHERE owner_id = 1').get().n,
    parts: db.prepare('SELECT COALESCE(SUM(count), 0) n FROM parts WHERE user_id = 1').get().n,
  });
  const claims = Object.keys(g.api).filter((k) => /claim|^rewards\/|weekly\/chest/.test(k) && k !== 'rewards');
  assert.ok(claims.length >= 10, claims.join(','));
  const bodies = [{}, { key: 'dream' }, { n: 1 }, { id: 1 }, { level: 1 }, { tier: 1 }];
  for (const name of claims) {
    for (const body of bodies) {
      try {
        call(1, name, body);
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
      }
      const before = worth();
      try {
        call(1, name, body);
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
      }
      const after = worth();
      for (const k of Object.keys(before)) if (k !== 'fuel') assert.ok(after[k] <= before[k], `${name} ${JSON.stringify(body)} paid twice: ${k} ${before[k]} → ${after[k]}`);
    }
  }
  clock.t += 1000;
});

// ---------- car duplication ----------
test('cars: a car on the market / auction can\'t be sold, traded, auctioned, upgraded or put in a room; a stale trade is refused', () => {
  const { db, mk, call, car } = setup();
  mk(1);
  mk(2);
  const keep = car(1), a = car(1), b = car(1), x = car(2);
  car(1);
  car(2);
  call(1, 'market/sell', { carId: a, price: 50000 });
  call(1, 'auction/create', { carId: b, startPrice: 50000, hours: 1 });
  for (const id of [a, b]) {
    assert.throws(() => call(1, 'market/sell', { carId: id, price: 60000 }), GameError);
    assert.throws(() => call(1, 'auction/create', { carId: id, startPrice: 60000, hours: 1 }), GameError);
    assert.throws(() => call(1, 'sell', { carIds: [id] }), GameError);
    assert.throws(() => call(1, 'trade/create', { to: 2, give: [id], get: [x] }), GameError);
    assert.throws(() => call(1, 'upgrade', { carIds: [id], target: 'vaz-2107' }), GameError);
  }
  // An offer made before the car went to the market is refused at accept time; nothing moves.
  const t = call(1, 'trade/create', { to: 2, give: [keep], get: [x] }).id;
  call(1, 'market/sell', { carId: keep, price: 70000 });
  assert.equal(db.prepare('SELECT status FROM trades WHERE id = ?').get(t).status, 'invalid');
  assert.throws(() => call(2, 'trade/accept', { id: t }), GameError);
  assert.equal(db.prepare('SELECT owner_id FROM cars WHERE id = ?').get(x).owner_id, 2);
  // Sold twice: the second buyer finds no lot.
  mk(3);
  call(2, 'market/buy', { id: db.prepare('SELECT id FROM listings WHERE car_id = ?').get(a).id });
  assert.throws(() => call(3, 'market/buy', { id: 1 }), /продано/);
  assert.equal(db.prepare('SELECT owner_id FROM cars WHERE id = ?').get(a).owner_id, 2);
});

test('trade room: a car listed after it was put on the table is taken off at the swap, nothing duplicated', () => {
  const { db, mk, call, car } = setup();
  mk(1);
  mk(2);
  car(1);
  const a = car(1);
  car(2);
  const r = call(1, 'room/create', {}).id;
  call(2, 'room/join', { id: r });
  call(1, 'room/offer', { id: r, add: a });
  call(2, 'room/offer', { id: r, money: 1000 });
  call(1, 'market/sell', { carId: a, price: 50000 });
  const v = call(1, 'room/state', { id: r }).version;
  call(1, 'room/ready', { id: r, version: v, ready: true });
  const out = call(2, 'room/ready', { id: r, version: v, ready: true });
  assert.equal(out.done, false);
  assert.equal(db.prepare('SELECT owner_id, status FROM cars WHERE id = ?').get(a).owner_id, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM trade_room_items WHERE room_id = ?').get(r).n, 0);
});

// ---------- «Причал» ----------
test('containers: bids from two players in the same moment keep every hryvnia (escrow + refunds), one winner, settled once', () => {
  const { db, g, mk, call, bal, clock } = setup();
  mk(1, 5e8);
  mk(2, 5e8);
  const L = call(1, 'containers').lots.find((l) => l.status === 'waiting' || l.status === 'live');
  db.prepare('UPDATE container_lots SET bots = ?, pending = NULL WHERE id = ?').run(JSON.stringify(JSON.parse(db.prepare('SELECT bots FROM container_lots WHERE id = ?').get(L.id).bots).map((b) => ({ ...b, max: 0 }))), L.id);
  const total = () => bal(1) + bal(2) + (db.prepare('SELECT top_bidder, top_bid FROM container_lots WHERE id = ?').get(L.id).top_bidder > 0 ? db.prepare('SELECT top_bid FROM container_lots WHERE id = ?').get(L.id).top_bid : 0);
  const start = total();
  for (let i = 0; i < 12; i++) {
    for (const uid of [1, 2]) {
      const d = call(uid, 'containers/lot', { id: L.id });
      if (d.lot.mine || d.lot.status === 'done') continue;
      try {
        call(uid, 'containers/bid', { id: L.id, amount: d.lot.minBid });
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
      }
      assert.equal(total(), start, 'money only moves between balance and escrow');
    }
    clock.t += 1100;
  }
  clock.t += 3600e3;
  g.settleAuctions();
  g.settleAuctions();
  call(1, 'containers/lot', { id: L.id });
  const row = db.prepare('SELECT status, top_bidder, top_bid, car_id FROM container_lots WHERE id = ?').get(L.id);
  assert.equal(row.status, 'done');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cars WHERE origin = 'container'").get().n, 1);
  assert.equal(bal(1) + bal(2), start - row.top_bid, 'the winner paid once, the loser got everything back');
});

// ---------- races ----------
test('races: the time is the server\'s replay; a report sooner than the run could end and a second finish are refused', () => {
  const { mk, call, car, clock } = setup();
  mk(1);
  const c = car(1, 'B');
  const rv = call(1, 'race/rivals', { carId: c });
  const st = call(1, 'race/start', { carId: c, rival: rv.list[0].id });
  const run = honestDrag(st.car, st.greenMs, 0.2, ['perfect', 'perfect', 'perfect', 'perfect']);
  assert.throws(() => call(1, 'race/finish', { raceId: st.raceId, ...run.body }), /ще не закінчився/, 'too early');
  clock.t += Math.ceil(run.ms) + 50;
  // A forged claim (all perfect, no taps) gets the replayed time, not the claimed one.
  const forged = call(1, 'race/finish', { raceId: st.raceId, ...run.body, shifts: ['perfect', 'perfect', 'perfect', 'perfect'], reaction: 0.01, time: 1 });
  assert.equal(forged.time, S.raceTime(st.car, run.body.launch - st.greenMs > 0 ? S.reactionOf(run.body.launch, st.greenMs) : 0, forged.shifts));
  assert.throws(() => call(1, 'race/finish', { raceId: st.raceId, ...run.body }), /уже завершено/);
  // Another player's race can't be finished.
  mk(2);
  assert.throws(() => call(2, 'race/finish', { raceId: st.raceId, ...run.body }), /уже завершено/);
  // Garbage in the run is refused.
  const st2 = call(1, 'race/start', { carId: c, rival: rv.list[0].id });
  clock.t += 60e3;
  for (const bad of [{ launch: -1, shiftAt: [] }, { launch: NaN, shiftAt: [] }, { launch: 1e9, shiftAt: [] }, { launch: 3000, shiftAt: ['x', {}, null] }]) {
    assert.throws(() => call(1, 'race/finish', { raceId: st2.raceId, ...bad }), GameError, JSON.stringify(bad));
  }
});

// ---------- SQL ----------
test('SQL: quotes and comments in search / sort / log filters are plain text', () => {
  const { g, mk } = setup();
  mk(1);
  mk(2);
  const inj = "' OR 1=1 --";
  assert.equal(g.adminCall('tg:1', 'users', { query: inj }).list.length, 0);
  assert.ok(g.adminCall('tg:1', 'users', { sort: '__proto__' }).list.length >= 2);
  assert.ok(g.adminCall('tg:1', 'users', { sort: 'constructor' }).list.length >= 2);
  assert.equal(g.adminCall('tg:1', 'log', { text: inj, action: inj, admin: inj }).list.length, 0);
  assert.throws(() => g.adminCall('tg:1', 'set', { id: 2, field: 'balance = 1e15, slots', value: 1, confirm: true, reason: 'перевірка' }), /не можна/);
});
