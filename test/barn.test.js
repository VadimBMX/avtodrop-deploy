// «Сарайна знахідка» (public/barn.js, src/barn.js): a free find a week and finds in won containers, four timed stages
// that eat warehouse parts and money (fake clock), an optional money-only speed-up, the «R» car at the end (×1,6
// value and income, serial, not in cases or collections, tradeable), the «етап готовий» bot reminder — and the
// economy: restoring to sell is never free money.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { pickReminder, PUSH } from '../src/reminders.js';
import * as S from '../public/shared.js';
import * as B from '../public/barn.js';

const K = (s) => Date.parse(s + '+02:00'); // Kyiv wall clock (UTC+2 after 25.10)
const H = 3600e3;

function setup({ t0 = K('2026-10-28T12:00:00'), random = () => 0.3 } = {}) {
  let t = t0;
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], random: () => random(), notify: () => {} });
  const mk = (id, level = 12, balance = 1e9) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ?, slots = 40 WHERE id = ?').run(level, level, balance, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const give = (uid, tier = 'race', n = 20) => {
    for (const k of S.PART_KEYS) db.prepare('INSERT INTO parts (user_id, type, tier, count) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET count = count + excluded.count').run(uid, k, tier, n);
  };
  const partsLeft = (uid) => db.prepare('SELECT COALESCE(SUM(count), 0) n FROM parts WHERE user_id = ?').get(uid).n;
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  // A find of a chosen model, straight into the shed.
  const plant = (uid, model, source = 'test:' + Math.random()) => Number(db.prepare('INSERT INTO barn_finds (user_id, model, source, created_at) VALUES (?, ?, ?, ?)').run(uid, model, source, t).lastInsertRowid);
  return { db, g, mk, call, give, partsLeft, bal, plant, add: (ms) => (t += ms), set: (x) => (t = x), at: () => t };
}

// ---------- the «R» cars ----------
test('R models: ×1,6 value and income, an edition outside ALL_MODELS, the dealer pays what a plain car sells for', () => {
  assert.ok(S.BARN_MODELS.length >= 25);
  for (const cls of ['D', 'C', 'B', 'A', 'S']) assert.ok(B.poolOf(cls).length >= 1, `finds of class ${cls}`);
  assert.ok(S.BARN_MODELS.filter((id) => S.MODELS[id].country === 'UA').length >= 8, 'Soviet/Ukrainian classics among the finds');
  const ids = new Set(S.ALL_MODELS.map((m) => m.id));
  for (const id of S.BARN_MODELS) {
    const b = S.MODELS[id], r = S.MODELS[S.R_OF[id]];
    assert.ok(!b.secret && !b.homeOnly && !b.ev && b.year <= 1992);
    assert.ok(r.edition && r.restored && S.isRestored(r.id) && S.isEdition(r.id));
    assert.equal(r.cls, b.cls);
    assert.ok(Math.abs(r.price / b.price - S.R_MULT) < 0.01, id);
    assert.ok(!ids.has(r.id), 'not in any case, dealer, collection or set');
    assert.ok(Math.abs(S.carIncomeOf({ model: r.id, parts: {} }) / S.carIncomeOf({ model: id, parts: {} }) - S.R_MULT) < 0.01);
    assert.ok(Math.abs(S.sellPriceOf(r.id) - S.sellPriceOf(id)) <= S.sellPriceOf(id) * 0.01, 'dealer: like the plain car');
    assert.ok(r.filter && r.img === id, 'restored livery: the base photo through a filter');
  }
  for (const cs of S.CASES) for (const m of S.ALL_MODELS) assert.ok(!m.restored, cs.id);
});

// ---------- economy ----------
test('economy: restore-and-sell is a loss for every find (parts at their dealer price, no speed-up)', () => {
  for (const id of S.BARN_MODELS) {
    const money = B.totalMoney(id);
    const parts = B.partsCount() * S.TIER_BY_ID[B.partTierOf(id)].price * S.PART_SELL_RATE;
    const cost = money + parts;
    const sale = S.sellPriceOf(S.R_OF[id]);
    assert.ok(sale < cost * 0.75, `${id}: dealer ${sale} vs cost ${cost}`);
    assert.ok(cost < S.MODELS[S.R_OF[id]].price, `${id}: the R is still worth more than it cost`);
    assert.ok(cost > S.MODELS[id].price * 0.6, `${id}: not cheap either`);
  }
  // Stage lengths 6–12 h, the speed-up is hryvnias and costs real money.
  for (const st of B.STAGES) assert.ok(st.hours >= 6 && st.hours <= 12);
  assert.ok(B.rushCost('vaz-2101-kopiika', 12 * H) >= S.MODELS['vaz-2101-kopiika'].price * 0.3);
  assert.equal(B.rushCost('vaz-2101-kopiika', 0), 0);
});

test('parts plan: the cheapest accepted tier first, junk tiers count, below the class tier never', () => {
  const inv = [
    { type: 'body', tier: 'stock', available: 1 }, { type: 'body', tier: 'street', available: 5 }, { type: 'suspension', tier: 'race', available: 1 },
  ];
  const p = B.partsPlan('vaz-2101-kopiika', 0, inv);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.take, [{ type: 'body', tier: 'stock', n: 1 }, { type: 'body', tier: 'street', n: 1 }, { type: 'suspension', tier: 'race', n: 1 }]);
  // A B-class find takes Street or better: Stock doesn't count.
  const b = B.partsPlan('ford-mustang-1967', 0, [{ type: 'body', tier: 'stock', available: 9 }, { type: 'suspension', tier: 'street', available: 1 }]);
  assert.deepEqual(b.missing, [{ type: 'body', tier: 'street', n: 2 }]);
  // The interior eats any three parts.
  const any = B.partsPlan('vaz-2101-kopiika', 2, [{ type: 'motor', tier: 'stock', available: 2 }, { type: 'wheels', tier: 'stock', available: 4 }]);
  assert.equal(any.take.reduce((s, x) => s + x.n, 0), 3);
  assert.deepEqual(any.missing, []);
});

// ---------- the weekly find ----------
test('weekly find: once a Kyiv week, again from Monday, at most 3 waiting; level decides the classes', () => {
  const { mk, call, set } = setup({ t0: K('2026-10-28T12:00:00') });
  mk(5, 3);
  assert.deepEqual(call(5, 'me').barn, { finds: 0, weekly: true, active: null, ready: false });
  const r = call(5, 'barn/weekly');
  assert.equal(S.MODELS[r.found.model].cls, 'D', 'level 3: D only');
  assert.throws(() => call(5, 'barn/weekly'), /цього тижня/i);
  assert.equal(call(5, 'me').barn.weekly, false);
  set(K('2026-11-01T23:59:00'));
  assert.throws(() => call(5, 'barn/weekly'), /цього тижня/i, 'Sunday is still the same week');
  set(K('2026-11-02T00:01:00'));
  call(5, 'barn/weekly');
  set(K('2026-11-09T09:00:00'));
  call(5, 'barn/weekly');
  set(K('2026-11-16T09:00:00'));
  assert.equal(call(5, 'barn').weekly.full, true);
  assert.throws(() => call(5, 'barn/weekly'), /3 знахідки/);
  assert.equal(call(5, 'barn').finds.length, 3);
  // Throw one out → the week's find can be taken.
  call(5, 'barn/drop', { id: call(5, 'barn').finds[0].id });
  call(5, 'barn/weekly');
  assert.equal(B.weeklyOdds(12).S > 0 && B.weeklyOdds(12).S < 1, true, 'late game: S finds exist and are rare');
  assert.equal(B.weeklyOdds(1).S, undefined);
});

test('gate: the shed opens with the parts (level 2)', () => {
  const { mk, call } = setup();
  mk(5, 1);
  assert.equal(call(5, 'me').barn, null);
  assert.throws(() => call(5, 'barn/weekly'), /рівні 2/);
});

// ---------- the four stages ----------
test('stages: parts and money go at each start, the clock finishes them, one restoration at a time, then the R car', () => {
  const { mk, call, give, partsLeft, bal, plant, add, db } = setup();
  mk(5);
  const id = plant(5, 'vaz-2101-kopiika');
  const other = plant(5, 'vaz-2106');
  assert.throws(() => call(5, 'barn/start', { id }), /Не вистачає деталей: Обвіс Stock ×2/);
  give(5, 'stock', 5);
  const p0 = partsLeft(5), b0 = bal(5);
  let v = call(5, 'barn/start', { id });
  assert.equal(partsLeft(5), p0 - 3);
  assert.equal(bal(5), b0 - B.stageMoney('vaz-2101-kopiika', 0));
  assert.equal(v.started.stage, 'body');
  assert.throws(() => call(5, 'barn/start', { id }), /триває/);
  assert.throws(() => call(5, 'barn/start', { id: other }), /одне місце/);
  assert.equal(call(5, 'me').barn.ready, false);
  add(8 * H - 1000);
  assert.equal(call(5, 'barn').finds[0].done, 0);
  add(1000);
  const me = call(5, 'me').barn;
  assert.equal(me.ready, true);
  assert.equal(me.active.done, 1);
  for (let i = 1; i < 4; i++) {
    call(5, 'barn/start', { id });
    add(B.STAGES[i].hours * H);
  }
  v = call(5, 'barn');
  const f = v.finds.find((x) => x.id === id);
  assert.equal(f.ready, true);
  assert.equal(f.spent, B.totalMoney('vaz-2101-kopiika'));
  assert.equal(partsLeft(5), p0 - B.partsCount());
  const c = call(5, 'barn/claim', { id }).car;
  assert.equal(c.model, 'vaz-2101-kopiika--r');
  assert.equal(c.serial, 1);
  assert.throws(() => call(5, 'barn/claim', { id }), /не знайдено/);
  const car = call(5, 'me').cars.find((x) => x.id === c.id);
  assert.equal(car.serial, 1);
  assert.equal(car.value, S.MODELS['vaz-2101-kopiika--r'].price);
  assert.ok(!call(5, 'me').collection.includes('vaz-2101-kopiika--r'), 'not counted in the collection (like editions)');
  assert.equal(db.prepare("SELECT origin FROM cars WHERE id = ?").get(c.id).origin, 'barn');
  // Tradeable: on the market yes; upgrade/repaint no.
  give(5, 'stock', 1);
  assert.throws(() => call(5, 'car/paint', { carId: c.id, color: S.PAINT_COLORS[0].id }), /R-версія має реставраційну ліврею/);
  // A second car so the R isn't the last one in the garage.
  db.prepare("INSERT INTO cars (owner_id, model, tank, tank_at, created_at, dirt_at) VALUES (5, 'fiat-uno', 1, 0, 0, 0)").run();
  call(5, 'market/sell', { carId: c.id, price: 500000 });
  // The next find can start now.
  give(5, 'stock', 3);
  call(5, 'barn/start', { id: other });
});

test('speed-up: hryvnias finish the running stage at once; nothing to speed up between stages', () => {
  const { mk, call, give, bal, plant, add } = setup();
  mk(5);
  give(5, 'stock', 5);
  const id = plant(5, 'haz-24-volha');
  call(5, 'barn/start', { id });
  add(2 * H + 1);
  const f = call(5, 'barn').finds[0];
  assert.equal(f.rush, B.rushCost('haz-24-volha', 6 * H - 1)); // 6 started hours left
  const b0 = bal(5);
  const r = call(5, 'barn/rush', { id });
  assert.equal(bal(5), b0 - r.rushed);
  assert.equal(r.finds[0].done, 1);
  assert.throws(() => call(5, 'barn/rush', { id }), /нічого не триває/);
});

test('money: no balance, no stage — nothing is taken (one transaction)', () => {
  const { mk, call, give, partsLeft, plant } = setup();
  mk(5, 12, 100);
  give(5, 'stock', 5);
  const id = plant(5, 'haz-24-volha');
  const p0 = partsLeft(5);
  assert.throws(() => call(5, 'barn/start', { id }), /Недостатньо гривень/);
  assert.equal(partsLeft(5), p0);
  assert.equal(call(5, 'barn').finds[0].done, 0);
});

test('garage full: the R car goes to the showcase', () => {
  const { mk, call, give, plant, add, db } = setup();
  mk(5);
  give(5, 'stock', 5);
  const id = plant(5, 'vaz-2106');
  for (let i = 0; i < 4; i++) {
    call(5, 'barn/start', { id });
    add(B.STAGES[i].hours * H);
  }
  db.prepare('UPDATE users SET slots = 0 WHERE id = 5').run();
  const c = call(5, 'barn/claim', { id }).car;
  assert.equal(c.showcase, true);
});

// ---------- containers ----------
test('containers: every won lot is rolled once, from its salt; flooded lots hide finds more often; old lots never', () => {
  const { mk, call, db, at } = setup();
  mk(5);
  const lot = (id, tier, junk, settled = at()) => db.prepare(`INSERT INTO container_lots (id, tier, model, junk, hints, commit_hash, salt, seed, bots, ends_at, created_at, settled_at, status, top_bidder)
    VALUES (?, ?, 'fiat-uno', ?, '{}', '', ?, 1, '[]', ?, ?, ?, 'done', 5)`).run(id, tier, junk, 'salt' + id, settled, settled, settled);
  lot(1, 'odesa', 1, at() - 86400e3); // before the feature: never rolled
  for (let i = 2; i < 202; i++) lot(i, i % 2 ? 'customs' : 'odesa', i % 4 === 0 ? 1 : 0);
  call(5, 'barn');
  const rolled = db.prepare('SELECT COUNT(*) n FROM barn_lots').get().n;
  assert.equal(rolled, 20, 'at most 20 lots per look');
  for (let k = 0; k < 15; k++) call(5, 'barn');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM barn_lots').get().n, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM barn_lots WHERE lot_id = 1').get().n, 0);
  const finds = db.prepare("SELECT model, source FROM barn_finds WHERE source LIKE 'lot:%'").all();
  assert.ok(finds.length >= 1 && finds.length <= 3, 'never more than 3 waiting');
  for (const f of finds) assert.ok(['D', 'C', 'B'].includes(S.MODELS[f.model].cls));
  // Deterministic: the same lot gives the same answer in another database.
  const s2 = setup();
  s2.mk(5);
  const lot2 = (id, tier, junk) => s2.db.prepare(`INSERT INTO container_lots (id, tier, model, junk, hints, commit_hash, salt, seed, bots, ends_at, created_at, settled_at, status, top_bidder)
    VALUES (?, ?, 'fiat-uno', ?, '{}', '', ?, 1, '[]', ?, ?, ?, 'done', 5)`).run(id, tier, junk, 'salt' + id, s2.at(), s2.at(), s2.at());
  const first = db.prepare('SELECT lot_id, model FROM barn_lots WHERE model IS NOT NULL ORDER BY lot_id LIMIT 1').get();
  lot2(first.lot_id, first.lot_id % 2 ? 'customs' : 'odesa', first.lot_id % 4 === 0 ? 1 : 0);
  s2.call(5, 'barn');
  assert.equal(s2.db.prepare('SELECT model FROM barn_lots WHERE lot_id = ?').get(first.lot_id).model, first.model);
  // Odds: junk 35%, normal 6% (pure rule check on many salts).
  assert.ok(B.BARN.lotChance.junk > B.BARN.lotChance.normal * 4);
});

// ---------- bot reminder ----------
test('bot: «Двигун готовий — заходь на наступний етап» once the stage is over, within the reminder limits', () => {
  const { g, mk, call, give, plant, add, set, db } = setup({ t0: K('2026-10-28T10:00:00') });
  mk(5);
  give(5, 'stock', 5);
  const id = plant(5, 'vaz-2101-kopiika');
  call(5, 'barn/start', { id });
  add(8 * H);
  call(5, 'barn/start', { id }); // the engine: 12 h → 06:00 next day (quiet hours until 09:00)
  db.prepare('UPDATE users SET last_seen = ? WHERE id = 5').run(K('2026-10-28T18:00:00'));
  set(K('2026-10-29T05:00:00'));
  assert.ok(!g.pushCandidates(PUSH).find((c) => c.uid === 5)?.ready.some((r) => r.kind === 'barn'), 'not before the stage ends');
  set(K('2026-10-29T10:00:00'));
  const c = g.pushCandidates(PUSH).find((x) => x.uid === 5);
  const item = c.ready.find((r) => r.kind === 'barn');
  assert.match(item.text, /Двигун готовий .*заходь на наступний етап/);
  assert.ok(pickReminder(c, K('2026-10-29T10:00:00')).includes('barn'));
  // Last stage: «забирай R-версію».
  call(5, 'barn/start', { id });
  add(6 * H);
  call(5, 'barn/start', { id });
  add(10 * H);
  db.prepare('UPDATE users SET last_seen = ?, push_sent = ?, push_count = 0, push_last = 0 WHERE id = 5').run(K('2026-10-29T10:00:00'), '{}');
  const c2 = g.pushCandidates(PUSH).find((x) => x.uid === 5);
  assert.match(c2.ready.find((r) => r.kind === 'barn').text, /Фарба висохла.*R-версію/);
});
