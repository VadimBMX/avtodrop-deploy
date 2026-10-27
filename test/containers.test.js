// «Причал» — the container auction (rules public/containers.js, server src/containers.js): honest lots (the content
// always fits the hints and the «Можливий вміст» list, the shares match the generator, nothing leaks before the end,
// the commitment checks out), the bid rules (step, 50% cap, extension, escrow and refunds, limits), the bots (limits
// from the list only, never over their limit, ≈ 0.8 return over many lots), settlement exactly once, «тиражні» cars
// and the admin switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as C from '../public/containers.js';

const R = C.CONTAINER_RULES;
const T0 = Date.parse('2026-10-23T10:00:00Z');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function setup({ seeds = null } = {}) {
  let t = T0, n = 7;
  const pushes = [];
  const queue = seeds ? [...seeds] : [];
  const db = openDb(':memory:');
  const g = createGame(db, {
    now: () => t, admins: [1], random: () => 0.5, notify: (u, x) => pushes.push([u, x]),
    containerSeed: () => (queue.length ? queue.shift() : (n = (n * 48271) % 2147483647)),
  });
  const mk = (id, { level = 12, balance = 50e6 } = {}) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = ? WHERE id = ?').run(level, level, balance, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const owner = (name, body = {}) => g.adminCall('tg:1', name, { reason: 'тест', confirm: true, ...body });
  const bal = (uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;
  const lotRow = (id) => db.prepare('SELECT * FROM container_lots WHERE id = ?').get(id);
  const lotOf = (uid, tier) => call(uid, 'containers').lots.find((l) => l.tier === tier);
  // Bots that never answer (limits 0), so a test controls the timing alone.
  const muteBots = (id) => {
    const L = lotRow(id);
    db.prepare('UPDATE container_lots SET bots = ?, pending = NULL WHERE id = ?').run(JSON.stringify(JSON.parse(L.bots).map((b) => ({ ...b, max: 0 }))), id);
  };
  // A player who always tops the leader by the minimum step, until the lot ends.
  const playToEnd = (uid, id, { cap = Infinity } = {}) => {
    for (let i = 0; i < 2000; i++) {
      const d = call(uid, 'containers/lot', { id });
      if (d.lot.status === 'done' || d.lot.status === 'cancelled') return d;
      if (!d.lot.mine && d.lot.minBid <= Math.min(cap, d.maxBid)) call(uid, 'containers/bid', { id, amount: d.lot.minBid });
      t += 1100;
    }
    throw new Error('lot never ended');
  };
  return { db, g, mk, call, owner, bal, lotRow, lotOf, muteBots, playToEnd, pushes, at: () => t, set: (x) => (t = x), add: (ms) => (t += ms) };
}
// The first seed for which a tier's lot has the wanted content.
function seedFor(tier, ok) {
  for (let s = 1; s < 500000; s++) if (ok(C.spawnLot(tier, s))) return s;
  throw new Error('no seed');
}

// ---------- honest lots ----------
test('generation: the content always fits its hints and the «Можливий вміст» list; the list sums to 1', () => {
  for (const t of [...C.CONTAINER_TIERS, C.EVENING_TIER]) {
    for (let s = 1; s <= 1500; s++) {
      const L = C.spawnLot(t.id, s);
      const o = C.tierOutcomes(t.id).find((x) => x.model === L.model && x.junk === L.junk);
      assert.ok(o, `${t.id}/${s}: the content is a real outcome of the tier`);
      assert.ok(C.matches(o, L.hints), 'every hint is a true fact about the car');
      const post = C.posterior(t.id, L.hints);
      const row = post.rows.find((r) => r.model === L.model && r.junk === L.junk);
      assert.ok(row && row.p > 0, 'the real content is on the list');
      assert.ok(Math.abs(post.rows.reduce((a, r) => a + r.p, 0) - 1) < 1e-9);
      assert.equal(L.ed, !!S.MODELS[L.model].edition);
      if (L.ed) assert.equal(S.MODELS[L.model].base && C.posterior(t.id, L.hints).rows.some((r) => r.model === S.MODELS[L.model].base), true, 'the edition row sits next to its base');
      if (t.countries) assert.ok(t.countries.includes(S.MODELS[L.model].country));
      assert.ok(!S.MODELS[L.model].secret && !S.MODELS[L.model].homeOnly);
    }
  }
});

test('generation: what comes out matches the list — class shares, junk and editions at the stated rates; the shown % are calibrated', () => {
  for (const t of [...C.CONTAINER_TIERS, C.EVENING_TIER]) {
    const N = 12000, cls = {}, tw = Object.values(t.w).reduce((a, b) => a + b, 0);
    let junk = 0, eds = 0, hit = 0, expect = 0;
    for (let s = 1; s <= N; s++) {
      const L = C.spawnLot(t.id, 100000 + s);
      if (L.junk) junk++;
      else cls[S.MODELS[L.model].cls] = (cls[S.MODELS[L.model].cls] || 0) + 1;
      if (L.ed) eds++;
      // Calibration of the shown list: the chance the list gave to its most likely row vs how often that row was it.
      const top = C.posterior(t.id, L.hints).rows[0];
      expect += top.p;
      if (top.model === L.model && top.junk === L.junk) hit++;
    }
    assert.ok(Math.abs(junk / N - t.junk) < 0.012, `${t.id} junk ${junk / N}`);
    for (const [c, w] of Object.entries(t.w)) assert.ok(Math.abs((cls[c] || 0) / (N - junk) - w / tw) < 0.015, `${t.id} class ${c}: ${(cls[c] || 0) / (N - junk)} vs ${w / tw}`);
    const edShare = C.tierOutcomes(t.id).filter((o) => o.ed).reduce((a, o) => a + o.p, 0);
    assert.ok(Math.abs(eds / N - edShare) < 0.006, `${t.id} editions ${eds / N} vs ${edShare}`);
    assert.ok(Math.abs(hit - expect) / N < 0.02, `${t.id}: the top row came ${hit}, the list promised ${expect.toFixed(0)}`);
  }
});

test('server: nothing about the content leaves the server before the end; afterwards the commitment checks out', () => {
  const { mk, call, playToEnd, lotRow } = setup();
  mk(5);
  const list = call(5, 'containers');
  assert.equal(list.lots.length, 3);
  assert.deepEqual(list.lots.map((l) => l.tier), ['odesa', 'customs', 'japan']);
  const id = list.lots[0].id;
  const d = call(5, 'containers/lot', { id, full: true });
  const raw = JSON.stringify({ list, d });
  const L = lotRow(id);
  assert.ok(!raw.includes(L.salt), 'no salt');
  assert.ok(!raw.includes('"max"') && !raw.includes('pending') && !raw.includes('"seed"'), 'no bot limits, plan or seed');
  assert.equal(d.lot.result, null);
  assert.deepEqual(d.lot.post.map((r) => r.model).sort(), C.posterior(L.tier, JSON.parse(L.hints)).rows.map((r) => r.model).sort());
  assert.equal(d.lot.commit, sha(C.commitText(id, L.model, L.ed, L.junk, L.salt)));
  const end = playToEnd(5, id);
  assert.equal(end.lot.result.model, L.model);
  assert.equal(end.lot.commit, sha(C.commitText(id, end.lot.result.model, end.lot.result.ed, end.lot.result.junk, end.lot.result.salt)));
});

// ---------- bid rules ----------
test('bids: minimum step, 50% cap, leader can\'t rebid, level gate, one bid a second, two lots at most', () => {
  const { db, mk, call, lotOf, muteBots, add } = setup();
  mk(5, { balance: 100000 });
  mk(6, { level: 4 });
  const od = lotOf(5, 'odesa');
  muteBots(od.id);
  assert.throws(() => call(5, 'containers/bid', { id: od.id, amount: od.minBid - 1 }), /Мінімальна ставка/);
  const cap = C.maxBidOf(100000);
  if (od.minBid > cap) assert.throws(() => call(5, 'containers/bid', { id: od.id, amount: od.minBid }), /половини балансу/);
  db.prepare('UPDATE users SET balance = ? WHERE id = 5').run(od.minBid * 4);
  assert.throws(() => call(5, 'containers/bid', { id: od.id, amount: od.minBid * 2 + 1000 }), /половини балансу/, 'one bid ≤ 50% of the balance: no all-in');
  const r = call(5, 'containers/bid', { id: od.id, amount: od.minBid });
  assert.equal(r.lot.mine, true);
  assert.equal(r.lot.status, 'live');
  add(1500);
  assert.throws(() => call(5, 'containers/bid', { id: od.id, amount: r.lot.minBid }), /вже лідер/);
  // Level gate: Митниця from level 6.
  const cu = lotOf(6, 'customs');
  assert.throws(() => call(6, 'containers/bid', { id: cu.id, amount: cu.minBid }), /з рівня 6/);
  // One bid a second.
  const jp = lotOf(5, 'japan');
  db.prepare('UPDATE users SET balance = 1e10 WHERE id = 5').run();
  call(5, 'containers/bid', { id: cu.id, amount: cu.minBid });
  assert.throws(() => call(5, 'containers/bid', { id: jp.id, amount: jp.minBid }), /одна ставка на секунду/);
  add(1100);
  // Leading in two lots already (odesa, customs): the third is refused.
  assert.throws(() => call(5, 'containers/bid', { id: jp.id, amount: jp.minBid }), /щонайбільше в 2 лотах/);
});

test('bids: the first human bid starts 90 s, a bid in the last 15 s extends, 5 min at most; escrow and refunds', () => {
  const { mk, call, lotOf, muteBots, add, at, bal, set, pushes } = setup();
  mk(5);
  mk(6);
  const l = lotOf(5, 'odesa');
  muteBots(l.id);
  assert.equal(l.status, 'waiting');
  const b0 = bal(5);
  let d = call(5, 'containers/bid', { id: l.id, amount: l.minBid });
  assert.equal(d.lot.endsAt, at() + R.liveMs);
  assert.equal(bal(5), b0 - l.minBid, 'the bid is held at once');
  add(R.liveMs - 20e3); // 20 s left: no extension
  d = call(6, 'containers/bid', { id: l.id, amount: d.lot.minBid });
  assert.equal(d.lot.endsAt, at() + 20e3);
  assert.equal(bal(5), b0, 'outbid: the money is back at once');
  assert.ok(pushes.some(([u, x]) => u === 5 && /перебили/.test(x)), '«тебе перебили» goes to the bot');
  add(10e3); // 10 s left → a bid puts the end 15 s after it
  d = call(5, 'containers/bid', { id: l.id, amount: d.lot.minBid });
  assert.equal(d.lot.endsAt, at() + R.extendMs);
  // Keep bidding in the last seconds: never past live start + 5 min.
  const live = d.lot.liveAt;
  for (let i = 0; i < 40 && d.lot.status === 'live'; i++) {
    add(Math.max(1100, d.lot.endsAt - at() - 2000));
    if (at() >= d.lot.endsAt) break;
    d = call(i % 2 ? 5 : 6, 'containers/bid', { id: l.id, amount: d.lot.minBid });
    assert.ok(d.lot.endsAt <= live + R.maxLiveMs);
  }
  set(live + R.maxLiveMs + 1);
  const end = call(5, 'containers/lot', { id: l.id });
  assert.equal(end.lot.status, 'done');
  const winner = end.lot.result.mine ? 5 : 6, loser = winner === 5 ? 6 : 5;
  assert.equal(bal(loser), 50e6, 'the loser has every hryvnia back');
  assert.equal(bal(winner), 50e6 - end.lot.result.price, 'the winner paid his last bid');
});

test('bids: a watching player gets no bot push (he sees it on screen); pushes are rate-limited per lot', () => {
  const { mk, call, lotOf, muteBots, add, pushes } = setup();
  mk(5);
  mk(6);
  const l = lotOf(5, 'odesa');
  muteBots(l.id);
  let d = call(5, 'containers/bid', { id: l.id, amount: l.minBid });
  call(5, 'containers/lot', { id: l.id }); // 5 is on the lot screen
  add(1100);
  d = call(6, 'containers/bid', { id: l.id, amount: d.lot.minBid });
  assert.equal(pushes.filter(([u]) => u === 5).length, 0);
  add(20e3); // 5 left the screen
  d = call(5, 'containers/bid', { id: l.id, amount: d.lot.minBid });
  add(20e3);
  d = call(6, 'containers/bid', { id: l.id, amount: d.lot.minBid });
  add(1100);
  d = call(5, 'containers/bid', { id: l.id, amount: d.lot.minBid });
  add(1100);
  call(6, 'containers/bid', { id: l.id, amount: d.lot.minBid });
  assert.equal(pushes.filter(([u, x]) => u === 5 && /перебили/.test(x)).length, 1, 'one push a minute per lot');
});

// ---------- bots ----------
test('bots: limits come from the list only (1.02–1.6 × the expected sale), Жора passes on a flooded car', () => {
  for (const t of C.CONTAINER_TIERS) {
    for (let s = 1; s <= 800; s++) {
      const L = C.spawnLot(t.id, s);
      const ev = C.posterior(t.id, L.hints).ev;
      assert.ok(L.bots.length >= 2 && L.bots.length <= 3);
      for (const b of L.bots) {
        if (b.id === 'zhora') assert.equal(t.id, 'odesa');
        if (b.id === 'zhora' && L.junk) assert.equal(b.max, 0);
        else assert.ok(b.max >= Math.floor(ev * R.k[0]) - 1 && b.max <= ev * R.k[1] + 1, `${t.id}/${s} ${b.id}: ${b.max} vs ev ${ev}`);
      }
      // Same hints, same seed → same limits whatever the car: the bots never see it.
      const twin = C.spawnLot(t.id, s);
      assert.deepEqual(twin.bots, L.bots);
    }
  }
});

test('bots: they never bid over their limit, answer in time, and a bot that wins shows what was inside', () => {
  const { mk, call, lotOf, lotRow, add, db } = setup();
  mk(5);
  const l = lotOf(5, 'customs');
  const lim = Object.fromEntries(JSON.parse(lotRow(l.id).bots).map((b) => [C.botCode(b.id), b.max]));
  // One human bid, then the bots fight it out alone.
  call(5, 'containers/bid', { id: l.id, amount: l.minBid });
  let d;
  for (let i = 0; i < 400; i++) {
    add(1000);
    d = call(5, 'containers/lot', { id: l.id });
    if (d.lot.status === 'done') break;
  }
  assert.equal(d.lot.status, 'done');
  for (const b of db.prepare('SELECT bidder, amount FROM container_bids WHERE lot_id = ? AND bidder < 0 AND amount > 0').all(l.id)) assert.ok(b.amount <= lim[b.bidder], 'never over the limit');
  assert.ok(!d.lot.result.mine && d.lot.result.bot, 'a bot took it');
  assert.ok(d.lot.result.model && d.lot.result.price > 0);
  const recent = call(5, 'containers').recent;
  assert.equal(recent[0].id, l.id);
  assert.equal(recent[0].model, lotRow(l.id).model, '«Петрович забрав — там була …»');
  // A new lot of the tier took its place.
  assert.ok(call(5, 'containers').lots.some((x) => x.tier === 'customs' && x.id !== l.id));
});

test('bots: a lot no human bid on is taken by the leading bot after 30 min and replaced', () => {
  const { mk, call, lotOf, add } = setup();
  mk(5);
  const l = lotOf(5, 'japan');
  add(R.waitMs + 1);
  const d = call(5, 'containers/lot', { id: l.id });
  assert.equal(d.lot.status, 'done');
  assert.ok(d.lot.result.bot);
  assert.equal(d.lot.result.price, l.topBid, 'at its warm-up price');
  assert.ok(d.next && d.next !== l.id);
});

test('economy: «win and sell» returns 0.75–0.85 of the price over many lots (pure engine, the server\'s own rules)', () => {
  for (const t of [...C.CONTAINER_TIERS, C.EVENING_TIER]) {
    let paid = 0, ev = 0, got = 0, wins = 0;
    for (let i = 0; i < 2500; i++) {
      const L = C.spawnLot(t.id, C.seedOf(`ret:${t.id}:${i}`));
      const st = { top: L.start, leader: C.botCode(L.leader), liveAt: 0, endsAt: 0, bots: L.bots.map((b) => ({ ...b })) };
      let now = 0, step = 0;
      const human = () => {
        st.top = C.minNext(st.top);
        st.leader = 1;
        st.endsAt = st.liveAt ? C.extendEnd(st.endsAt, now, st.liveAt) : ((st.liveAt = now), now + R.liveMs);
      };
      human();
      for (;;) {
        const mv = C.botMove(st, now, C.rng(C.seedOf(`${i}:${step++}`)));
        for (const p of mv.passes) st.bots.find((b) => b.id === p).passed = true;
        if (!mv.action) break;
        assert.ok(mv.action.amount <= st.bots.find((b) => b.id === mv.action.bot).max);
        now = mv.action.at;
        st.top = mv.action.amount;
        st.leader = C.botCode(mv.action.bot);
        st.endsAt = C.extendEnd(st.endsAt, now, st.liveAt);
        now += 500;
        if (now >= st.endsAt) break;
        human();
      }
      if (st.leader !== 1) continue;
      wins++;
      paid += st.top;
      ev += L.ev;
      got += C.saleOfModel(L.model);
    }
    assert.ok(wins > 2300, `${t.id}: a persistent player wins almost always (${wins})`);
    assert.ok(ev / paid >= 0.75 && ev / paid <= 0.85, `${t.id}: expected return ${(ev / paid).toFixed(3)}`);
    assert.ok(got / paid >= 0.7 && got / paid <= 0.9, `${t.id}: realised return ${(got / paid).toFixed(3)}`);
  }
});

test('economy: the same holds through the real server (persistent bidder, 40 lots)', () => {
  const { mk, call, playToEnd, db } = setup();
  mk(5, { balance: 1e12 });
  let paid = 0, ev = 0;
  for (let i = 0; i < 40; i++) {
    const l = call(5, 'containers').lots.find((x) => x.tier === 'odesa');
    const d = playToEnd(5, l.id);
    if (!d.lot.result.mine) continue;
    paid += d.lot.result.price;
    ev += db.prepare('SELECT ev FROM container_lots WHERE id = ?').get(l.id).ev;
    db.prepare("UPDATE container_lots SET settled_at = settled_at - 86400e3 WHERE id = ?").run(l.id); // keep under the daily limit
  }
  assert.ok(paid > 0);
  assert.ok(ev / paid > 0.7 && ev / paid < 0.9, `server return ${(ev / paid).toFixed(3)}`);
});

// ---------- settlement ----------
test('settlement: exactly once — repeated reads, sweeps and opens give one car and charge once', () => {
  const { g, mk, call, lotOf, muteBots, add, bal, db } = setup();
  mk(5);
  const l = lotOf(5, 'odesa');
  muteBots(l.id);
  call(5, 'containers/bid', { id: l.id, amount: l.minBid });
  const before = bal(5), cars = db.prepare('SELECT COUNT(*) n FROM cars WHERE owner_id = 5').get().n;
  add(R.liveMs + 1);
  g.settleAuctions();
  g.settleAuctions();
  call(5, 'containers/lot', { id: l.id });
  call(5, 'containers');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cars WHERE owner_id = 5').get().n, cars + 1);
  assert.equal(bal(5), before);
  const o1 = call(5, 'containers/open', { id: l.id }), o2 = call(5, 'containers/open', { id: l.id });
  assert.equal(o1.car.id, o2.car.id);
  assert.equal(o1.car.model, db.prepare('SELECT model FROM container_lots WHERE id = ?').get(l.id).model);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cars WHERE owner_id = 5').get().n, cars + 1);
  assert.deepEqual(call(5, 'containers').unopened, []);
  mk(6);
  assert.throws(() => call(6, 'containers/open', { id: l.id }), /не твій/);
  assert.throws(() => call(5, 'containers/bid', { id: l.id, amount: 1e9 }), /завершено/);
});

test('settlement: a full garage puts the car on the showcase; a flooded car comes 100% dirty', () => {
  const sJunk = seedFor('odesa', (L) => L.junk);
  const { mk, call, lotOf, muteBots, add, db } = setup({ seeds: [sJunk, 1] });
  mk(5);
  db.prepare('UPDATE users SET slots = 0 WHERE id = 5').run();
  const l = lotOf(5, 'odesa');
  muteBots(l.id);
  call(5, 'containers/bid', { id: l.id, amount: l.minBid });
  add(R.liveMs + 1);
  call(5, 'containers/lot', { id: l.id });
  const c = db.prepare('SELECT c.* FROM cars c JOIN container_lots l ON l.car_id = c.id WHERE l.id = ?').get(l.id);
  assert.equal(c.status, 'showcase');
  assert.equal(c.dirt, 100);
  assert.equal(c.origin, 'container');
});

// ---------- «тиражні» ----------
test('editions: twelve of them, serial numbers per edition, sale 10%, no collection, no upgrade/trade-in/paint; market and swaps allowed', () => {
  assert.equal(S.EDITION_CARS.length, 12);
  for (const e of S.EDITION_CARS) {
    assert.ok([...C.CONTAINER_TIERS, C.EVENING_TIER].some((t) => C.tierOutcomes(t.id).some((o) => o.model === e.id && o.p > 0)), `${e.id} can come out of some lot`);
    const m = S.MODELS[e.id], b = S.MODELS[e.base];
    assert.ok(m.edition && m.img === b.id && m.filter && m.cls === b.cls && m.price === b.price);
    assert.ok(!S.ALL_MODELS.includes(m), 'not in cases, collections, sets, rival pools');
    assert.equal(S.sellPriceOf(e.id), Math.floor(b.price * 0.1));
    assert.ok(!Object.values(S.SECRET_BY_COUNTRY).includes(e.id));
  }
  const sEd = seedFor('japan', (L) => L.ed);
  const { g, mk, call, muteBots, add, db, owner } = setup({ seeds: [11, 12, 13, 14, sEd, 15, sEd, 16] });
  mk(5);
  mk(6);
  const jp = call(5, 'containers').lots.find((l) => l.tier === 'japan');
  muteBots(jp.id);
  call(5, 'containers/bid', { id: jp.id, amount: jp.minBid });
  add(R.liveMs + 1);
  const d = call(5, 'containers/lot', { id: jp.id });
  assert.ok(d.lot.result.ed && d.lot.result.serial === 1);
  const car = call(5, 'containers/open', { id: jp.id }).car;
  assert.equal(car.serial, 1);
  assert.ok(S.MODELS[car.model].edition);
  assert.equal(car.sell, Math.floor(S.MODELS[car.model].price * 0.1));
  assert.ok(!db.prepare('SELECT 1 FROM collection WHERE user_id = 5 AND model = ?').get(car.model), 'not in the collection');
  // The next one of the same edition (the replacement lot has the same content) gets № 002.
  const jp2 = call(6, 'containers').lots.find((l) => l.tier === 'japan');
  assert.notEqual(jp2.id, jp.id);
  muteBots(jp2.id);
  call(6, 'containers/bid', { id: jp2.id, amount: jp2.minBid });
  add(R.liveMs + 1);
  const d2 = call(6, 'containers/lot', { id: jp2.id });
  assert.equal(d2.lot.result.model, car.model);
  assert.equal(d2.lot.result.serial, 2);
  assert.throws(() => call(5, 'car/paint', { carId: car.id, color: Object.keys(S.PAINT_BY_ID)[0] }), /ліврею/);
  assert.throws(() => call(5, 'upgrade', { carIds: [car.id], target: 'bugatti-chiron' }), /Тиражну/);
  const other = db.prepare("SELECT id FROM cars WHERE owner_id = 5 AND id <> ? LIMIT 1").get(car.id);
  if (other) assert.throws(() => call(5, 'dealer/tradein', { carIds: [car.id, other.id, other.id + 1000] }), /Тиражну|не твоє|повторюються/);
  // Market and swaps are allowed.
  db.prepare('UPDATE users SET level = 12 WHERE id IN (5, 6)').run();
  g.giveCar(5, 'vaz-2106');
  const mkt = call(5, 'market/sell', { carId: car.id, price: S.MODELS[car.model].price });
  assert.ok(mkt);
  call(5, 'market/cancel', { id: db.prepare('SELECT id FROM listings WHERE car_id = ?').get(car.id).id });
  assert.ok(call(5, 'trade/create', { to: 6, give: [car.id], get: [], getMoney: 1000 }));
  // Selling to the dealer pays 10%.
  db.prepare('DELETE FROM trades').run();
  const r = call(5, 'sell', { carIds: [car.id] });
  assert.equal(r.got, Math.floor(S.MODELS[car.model].price * 0.1));
  assert.ok(owner('containers').recent.some((l) => l.id === jp.id && l.ed && l.serial === 1));
});

// ---------- admin ----------
test('admin: the switch (default on), live lots, close-and-replace with a refund; helpers only look', () => {
  const { db, g, mk, call, owner, lotOf, muteBots, bal } = setup();
  mk(5);
  mk(7);
  db.prepare("UPDATE users SET role = 'helper' WHERE id = 7").run();
  assert.equal(call(5, 'containers').on, true, 'on by default after a deploy');
  const l = lotOf(5, 'odesa');
  muteBots(l.id);
  call(5, 'containers/bid', { id: l.id, amount: l.minBid });
  const v = owner('containers');
  assert.equal(v.open.length, 3);
  assert.ok(!JSON.stringify(v.open).includes(db.prepare('SELECT salt FROM container_lots WHERE id = ?').get(l.id).salt), 'the admin sees no content of a running lot');
  assert.ok(g.adminCall('tg:7', 'containers', {}).open.length === 3, 'a helper may look');
  assert.throws(() => g.adminCall('tg:7', 'containers/toggle', { on: false, reason: 'тест', confirm: true }), /прав/);
  assert.throws(() => g.adminCall('tg:1', 'containers/toggle', { on: false }), /причину/);
  // Switched off: waiting lots go, the live one stays, new bids are refused.
  const off = owner('containers/toggle', { on: false });
  assert.equal(off.on, false);
  assert.equal(off.removed, 2);
  const list = call(5, 'containers');
  assert.equal(list.on, false);
  assert.deepEqual(list.lots.map((x) => x.id), [l.id]);
  mk(6);
  assert.throws(() => call(6, 'containers/bid', { id: l.id, amount: 1e6 }), /зачинено/);
  // Close by hand: the leader's bid comes back.
  const b0 = bal(5);
  owner('containers/close', { id: l.id });
  assert.equal(bal(5), b0 + l.minBid);
  assert.equal(call(5, 'containers').lots.length, 0, 'off: no replacement');
  owner('containers/toggle', { on: true });
  assert.equal(call(5, 'containers').lots.length, 3);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM admin_log WHERE action LIKE 'containers%'").get().n >= 3);
});

test('metrics: money of «Причал» is its own source group', async () => {
  const M = await import('../src/metrics.js');
  assert.ok(M.MONEY_GROUPS.some((g) => g.key === 'containers' && g.src.includes('containers')));
  const { mk, call, lotOf, muteBots, db } = setup();
  mk(5);
  const l = lotOf(5, 'odesa');
  muteBots(l.id);
  call(5, 'containers/bid', { id: l.id, amount: l.minBid });
  assert.ok(db.prepare("SELECT destroyed FROM money_src WHERE src = 'containers/bid'").get().destroyed >= l.minBid);
});

// ---------- «Контейнери 2.0»: «Вечірній аукціон», «Огляд експерта», sharing an edition ----------
const KY = (s) => Date.parse(s + '+03:00'); // 23.10.2026 is still summer time in Kyiv

test('evening: 20:00 Kyiv every day, right across the summer-time switch; the next one after the window', () => {
  assert.equal(C.kyivAt('2026-10-24', 20), Date.parse('2026-10-24T17:00:00Z'), 'summer: UTC+3');
  assert.equal(C.kyivAt('2026-10-25', 20), Date.parse('2026-10-25T18:00:00Z'), 'the switch day: UTC+2 by the evening');
  assert.equal(C.kyivAt('2026-03-29', 20), Date.parse('2026-03-29T17:00:00Z'), 'spring switch day: UTC+3 by the evening');
  assert.equal(C.nextEvening(KY('2026-10-23T12:00:00')), KY('2026-10-23T20:00:00'));
  assert.equal(C.nextEvening(KY('2026-10-23T20:14:00')), KY('2026-10-23T20:00:00'), 'still today inside the late window');
  assert.equal(C.nextEvening(KY('2026-10-23T20:16:00')), KY('2026-10-24T20:00:00'));
});

test('evening: the lot comes up at 19:30 (no bids yet), reminds only the subscribed, goes live at 20:00 for everyone, once a day', () => {
  const { g, mk, call, set, add, pushes, db, at } = setup();
  mk(5);
  mk(6);
  mk(7, { level: 3 });
  set(KY('2026-10-23T19:00:00'));
  assert.equal(call(5, 'containers').evening.lot, null);
  assert.equal(call(5, 'containers').evening.at, KY('2026-10-23T20:00:00'));
  assert.equal(call(5, 'containers/evening', { on: true }).sub, true);
  call(7, 'containers/evening', { on: true });
  call(6, 'containers/evening', { on: true });
  assert.equal(call(6, 'containers/evening', { on: false }).sub, false);
  set(KY('2026-10-23T19:29:00'));
  g.settleAuctions();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM container_lots WHERE tier = 'evening'").get().n, 0, 'not before 19:30');
  set(KY('2026-10-23T19:30:05'));
  g.settleAuctions(); // the sweeper puts it up even when nobody looks
  g.settleAuctions();
  const lots = db.prepare("SELECT * FROM container_lots WHERE tier = 'evening'").all();
  assert.equal(lots.length, 1);
  assert.equal(lots[0].status, 'soon');
  assert.equal(lots[0].live_at, KY('2026-10-23T20:00:00'));
  const rem = pushes.filter(([, x]) => x.includes('Вечірній аукціон'));
  assert.deepEqual(rem.map(([u]) => u).sort(), [5, 7], 'only the subscribed, once each');
  assert.match(rem[0][1], /о 20:00 — через 30 хв/);
  const list = call(5, 'containers');
  assert.ok(!list.lots.some((l) => l.tier === 'evening'), 'its own tile, not a pier card');
  const e = list.evening.lot;
  assert.equal(e.status, 'soon');
  assert.equal(e.result, null);
  assert.ok(!JSON.stringify(list).includes(lots[0].salt));
  assert.throws(() => call(5, 'containers/bid', { id: e.id, amount: e.minBid }), /стартують о 20:00/);
  // 20:00: live for everyone, the bots start bidding among themselves.
  set(KY('2026-10-23T20:00:00') + 60e3);
  const d = call(6, 'containers/lot', { id: e.id });
  assert.equal(d.lot.status, 'live');
  assert.equal(d.lot.liveAt, KY('2026-10-23T20:00:00'));
  assert.ok(d.lot.endsAt >= d.lot.liveAt + C.EVENING.liveMs);
  assert.throws(() => call(7, 'containers/bid', { id: e.id, amount: d.lot.minBid }), /рівня 6/);
  // Two people and the bots on one lot.
  for (let i = 0; i < 600; i++) {
    const x = call(5, 'containers/lot', { id: e.id });
    if (x.lot.status === 'done') break;
    const who = i % 2 ? 5 : 6;
    const y = call(who, 'containers/lot', { id: e.id });
    if (!y.lot.mine && y.lot.minBid <= y.maxBid) call(who, 'containers/bid', { id: e.id, amount: y.lot.minBid });
    add(1100);
  }
  const end = call(5, 'containers/lot', { id: e.id });
  assert.equal(end.lot.status, 'done');
  assert.ok(at() <= KY('2026-10-23T20:00:00') + C.EVENING.liveMs + R.maxLiveMs);
  const L = db.prepare('SELECT * FROM container_lots WHERE id = ?').get(e.id);
  assert.ok([5, 6].includes(L.top_bidder), 'a person won it');
  assert.ok(db.prepare('SELECT COUNT(DISTINCT bidder) n FROM container_bids WHERE lot_id = ? AND bidder > 0').get(e.id).n === 2);
  assert.equal(call(5, 'containers').evening.lot.result.model, L.model, 'after the end everyone sees what was inside');
  // No second one today; tomorrow's comes up at 19:30 again.
  set(KY('2026-10-23T20:10:00'));
  g.settleAuctions();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM container_lots WHERE tier = 'evening'").get().n, 1);
  assert.equal(call(5, 'containers').evening.at, KY('2026-10-24T20:00:00'));
  set(KY('2026-10-24T19:31:00'));
  g.settleAuctions();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM container_lots WHERE tier = 'evening'").get().n, 2);
});

test('evening: a server that was down at 20:00 puts it up live till 20:15, not later; nobody bids → a bot takes it and shows it', () => {
  const { g, mk, call, set, db } = setup();
  mk(5);
  set(KY('2026-10-23T20:16:00'));
  g.settleAuctions();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM container_lots WHERE tier = 'evening'").get().n, 0);
  set(KY('2026-10-24T20:10:00'));
  g.settleAuctions();
  const L = db.prepare("SELECT * FROM container_lots WHERE tier = 'evening'").get();
  assert.equal(L.status, 'live');
  assert.equal(L.live_at, KY('2026-10-24T20:10:00'));
  set(KY('2026-10-24T20:30:00'));
  g.settleAuctions();
  const r = call(5, 'containers').evening.lot.result;
  assert.ok(r && r.bot && r.model === L.model, 'the bot took it and the content is shown');
});

test('evening: the switch off takes the evening lot down before it starts, and puts none up', () => {
  const { g, mk, owner, set, db } = setup();
  mk(5);
  set(KY('2026-10-23T19:40:00'));
  g.settleAuctions();
  owner('containers/toggle', { on: false });
  assert.equal(db.prepare("SELECT status FROM container_lots WHERE tier = 'evening'").get().status, 'cancelled');
  set(KY('2026-10-24T19:40:00'));
  g.settleAuctions();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM container_lots WHERE tier = 'evening'").get().n, 1);
});

test('expert (pure): the bought fact is true, the narrowed list is the public one cut and renormalised, and stays calibrated', () => {
  for (const t of [...C.CONTAINER_TIERS, C.EVENING_TIER]) {
    let hit = 0, expect = 0, n = 0;
    for (let s = 1; s <= 4000; s++) {
      const L = C.spawnLot(t.id, 700000 + s);
      const fs = C.expertFields(L.hints);
      if (!fs.length) continue;
      const f = fs[s % fs.length], v = C.factOf(L.model, f);
      const pub = C.posterior(t.id, L.hints), post = C.narrow(pub, { [f]: v });
      assert.ok(Math.abs(post.rows.reduce((a, r) => a + r.p, 0) - 1) < 1e-9);
      assert.ok(post.rows.some((r) => r.model === L.model && r.junk === L.junk), 'the real content stays on the list');
      assert.ok(post.rows.every((r) => C.factOf(r.model, f) === v));
      const mass = pub.rows.filter((r) => C.factOf(r.model, f) === v).reduce((a, r) => a + r.p, 0);
      for (const r of post.rows) assert.ok(Math.abs(r.p - pub.rows.find((x) => x.model === r.model && x.junk === r.junk).p / mass) < 1e-9);
      const p = C.expertPrice(pub);
      assert.ok(p >= C.EXPERT.min && p >= pub.rows.reduce((a, r) => a + r.p * r.value, 0) * C.EXPERT.share - 1);
      n++;
      expect += post.rows[0].p;
      if (post.rows[0].model === L.model && post.rows[0].junk === L.junk) hit++;
    }
    assert.ok(n > 1000, `${t.id}: lots with something to reveal (${n})`);
    assert.ok(Math.abs(hit - expect) / n < 0.025, `${t.id}: with the expert the top row came ${hit}, the list promised ${expect.toFixed(0)}`);
  }
});

test('expert (server): paid once, only the buyer sees it, the bots don\'t get it, money is destroyed; only hidden facts', () => {
  const { mk, call, bal, lotRow, db } = setup();
  mk(5);
  mk(6);
  let l = null;
  for (const x of call(5, 'containers').lots) if (!l && x.expertFields.length) l = x;
  assert.ok(l, 'some lot keeps a fact hidden');
  const before = lotRow(l.id), money = bal(5);
  const f = l.expertFields[0];
  assert.throws(() => call(5, 'containers/expert', { id: l.id, field: 'country' }), /обери інший/);
  const d = call(5, 'containers/expert', { id: l.id, field: f });
  assert.equal(bal(5), money - l.expertPrice);
  assert.equal(d.lot.expert.field, f);
  assert.equal(d.lot.expert.value, C.factOf(before.model, f), 'a true fact');
  const want = C.narrow(C.posterior(l.tier, JSON.parse(before.hints)), { [f]: d.lot.expert.value });
  assert.deepEqual(d.lot.post.map((r) => [r.model, r.p]), want.rows.map((r) => [r.model, r.p]));
  assert.equal(d.lot.est.n, want.rows.length);
  assert.equal(d.lot.expertFields.length, 0);
  assert.throws(() => call(5, 'containers/expert', { id: l.id, field: l.expertFields[1] || f }), /уже оглянув/);
  // The other player and the bots: the public list, the same limits.
  const o = call(6, 'containers/lot', { id: l.id, full: true });
  assert.equal(o.lot.expert, null);
  assert.equal(o.lot.post.length, C.posterior(l.tier, JSON.parse(before.hints)).rows.length);
  assert.equal(lotRow(l.id).bots, before.bots, 'bot limits untouched');
  assert.ok(!JSON.stringify(o).includes('"field"'), 'nothing of the fact leaks to others');
  assert.equal(call(5, 'containers').lots.find((x) => x.id === l.id).est.n, want.rows.length, 'the pier card too');
  assert.ok(db.prepare("SELECT destroyed FROM money_src WHERE src = 'containers/expert'").get().destroyed >= l.expertPrice);
});

test('share: an edition is shared with its livery name and serial', () => {
  const e = S.EDITION_CARS[7];
  const cap = S.shareCaption(e.id, 7);
  assert.ok(cap.includes(S.MODELS[e.id].name) && cap.includes('№ 007') && cap.includes('Причал'));
  assert.ok(!S.shareCaption('vaz-2106').includes('тиражн'));
});
