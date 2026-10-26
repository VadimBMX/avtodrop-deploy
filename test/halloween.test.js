// «Ніч Хелловіну» (public/halloween.js, src/halloween.js): it runs by the calendar (29.10 00:00 – 2.11 23:59 Kyiv) with
// an admin switch, the event tasks pay once and only while it runs, everything earned stays after it, the ghost
// container is as honest as the other lots (content fits the hints and the list, bots value the list, ≈ 0.8 return)
// and nothing touches case prices or odds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as C from '../public/containers.js';
import * as HW from '../public/halloween.js';

const R = C.CONTAINER_RULES;
// Kyiv wall clock → ms (UTC+2 after 25.10).
const K = (s) => Date.parse(s + '+02:00');

function setup({ t0 = K('2026-10-30T12:00:00'), random = () => 0.5 } = {}) {
  let t = t0, n = 11;
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], random: () => random(), notify: () => {}, containerSeed: () => (n = (n * 48271) % 2147483647) });
  const mk = (id, level = 12) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, level_seen = ?, balance = 50000000, slots = 40 WHERE id = ?').run(level, level, id);
    return id;
  };
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const owner = (name, body = {}) => g.adminCall('tg:1', name, { reason: 'тест', confirm: true, ...body });
  // One collect = some income first (an hour of a car's income).
  const collect = (uid) => {
    t += 3600e3;
    return call(uid, 'collect');
  };
  const task = (uid, id) => call(uid, 'me').halloween.tasks.find((x) => x.id === id);
  const markDone = (uid, ids) => {
    for (const id of ids) db.prepare("INSERT OR REPLACE INTO hw_tasks (event, user_id, task, progress, done_at) VALUES (?, ?, ?, 99, ?)").run(HW.hwKey(t), uid, id, t);
  };
  const keys = (uid, caseId) => db.prepare('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, caseId)?.count || 0;
  return { db, g, mk, call, owner, collect, task, markDone, keys, set: (x) => (t = x), add: (ms) => (t += ms), at: () => t };
}

// ---------- dates ----------
test('dates: on from 29.10 00:00 to 2.11 23:59:59 Kyiv, off around it, every year', () => {
  assert.equal(HW.hwActive(K('2026-10-28T23:59:59')), false);
  assert.equal(HW.hwActive(K('2026-10-29T00:00:00')), true);
  assert.equal(HW.hwActive(K('2026-10-31T21:00:00')), true);
  assert.equal(HW.hwActive(K('2026-11-02T23:59:59')), true);
  assert.equal(HW.hwActive(K('2026-11-03T00:00:00')), false);
  assert.equal(HW.hwActive(K('2026-07-01T12:00:00')), false);
  assert.equal(HW.hwActive(Date.parse('2027-10-29T00:00:00+03:00')), true, 'next year (summer time ends 31.10.2027)');
  assert.equal(HW.hwActive(Date.parse('2027-10-28T23:59:00+03:00')), false);
  const w = HW.hwWindow(2026);
  assert.equal(w.end - w.start, 5 * 86400e3);
  assert.equal(HW.hwKey(K('2026-10-30T10:00:00')), 'hw2026');
});

test('dates: the game follows the clock — `me.halloween` and the ghost lot appear and go with the fake clock', () => {
  const { mk, call, set } = setup({ t0: K('2026-10-28T23:59:00') });
  mk(5);
  assert.equal(call(5, 'me').halloween, null);
  assert.deepEqual(call(5, 'containers').lots.map((l) => l.tier), ['odesa', 'customs', 'japan']);
  set(K('2026-10-29T00:00:01'));
  const h = call(5, 'me').halloween;
  assert.ok(h.on && h.tasks.length === 5);
  assert.equal(h.end, K('2026-11-03T00:00:00'));
  assert.deepEqual(call(5, 'containers').lots.map((l) => l.tier), ['ghost', 'odesa', 'customs', 'japan']);
  set(K('2026-11-03T00:00:01'));
  assert.equal(call(5, 'me').halloween, null);
  assert.deepEqual(call(5, 'containers').lots.map((l) => l.tier), ['odesa', 'customs', 'japan'], 'the ghost lot nobody bid on is taken off');
});

// ---------- admin ----------
test('admin: on outside the dates, off inside them, back to the calendar; reason required; helpers only look', () => {
  const { g, db, mk, call, owner } = setup({ t0: K('2026-10-26T12:00:00') });
  mk(5);
  mk(7);
  db.prepare("UPDATE users SET role = 'helper' WHERE id = 7").run();
  assert.equal(owner('halloween').mode, 'auto');
  assert.equal(owner('halloween').on, false);
  assert.throws(() => g.adminCall('tg:1', 'halloween/mode', { mode: 'on' }), /причину/);
  assert.throws(() => g.adminCall('tg:7', 'halloween/mode', { mode: 'on', reason: 'тест', confirm: true }), /прав/);
  assert.equal(g.adminCall('tg:7', 'halloween', {}).mode, 'auto', 'a helper may look');
  assert.throws(() => owner('halloween/mode', { mode: 'maybe' }), /Режим/);
  const v = owner('halloween/mode', { mode: 'on' });
  assert.ok(v.on && !v.inWindow);
  assert.ok(call(5, 'me').halloween.forced);
  assert.equal(call(5, 'me').halloween.end, null, 'forced: no end date to count down to');
  assert.ok(call(5, 'containers').lots.some((l) => l.tier === 'ghost'));
  owner('halloween/mode', { mode: 'off' });
  assert.equal(call(5, 'me').halloween, null);
  assert.ok(!call(5, 'containers').lots.some((l) => l.tier === 'ghost'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM container_lots WHERE tier = 'ghost' AND status = 'cancelled'").get().n, 1);
  owner('halloween/mode', { mode: 'auto' });
  assert.equal(call(5, 'me').halloween, null, 'auto on 26.10: off');
  assert.equal(owner('halloween').history.length, 3);
});

test('admin: off inside the dates stops it; a live ghost lot still finishes and pays out', () => {
  const { mk, call, owner, add } = setup();
  mk(5);
  const l = call(5, 'containers').lots.find((x) => x.tier === 'ghost');
  call(5, 'containers/bid', { id: l.id, amount: l.minBid });
  owner('halloween/mode', { mode: 'off' });
  assert.equal(call(5, 'me').halloween, null);
  let d;
  for (let i = 0; i < 600; i++) {
    add(1000);
    d = call(5, 'containers/lot', { id: l.id });
    if (d.lot.status === 'done') break;
    if (!d.lot.mine) call(5, 'containers/bid', { id: l.id, amount: d.lot.minBid });
  }
  assert.equal(d.lot.status, 'done', 'live bidding was not cut off');
  assert.ok(!call(5, 'containers').lots.some((x) => x.tier === 'ghost'), 'no new ghost lot');
});

// ---------- tasks and rewards ----------
test('tasks: the frame for three collects — paid once, worn at once, counted only while the event runs', () => {
  const { g, db, mk, call, collect, task, set } = setup({ t0: K('2026-10-28T20:00:00') });
  mk(5);
  g.giveCar(5, 'vaz-2107');
  collect(5);
  collect(5); // 22:00 on 28.10: not yet
  set(K('2026-10-29T01:00:00'));
  assert.equal(task(5, 'collect').progress, 0, 'actions before the start do not count');
  collect(5);
  collect(5);
  assert.equal(task(5, 'collect').progress, 2);
  collect(5);
  const t = task(5, 'collect');
  assert.ok(t.done && t.prize.frame === HW.HW_FRAME);
  const me = call(5, 'me');
  assert.ok(me.claims.includes(HW.HW_FRAME));
  assert.equal(me.style.frame, HW.HW_FRAME, 'worn at once (no other frame)');
  assert.equal(S.styleLook(HW.HW_FRAME), 'pumpkin');
  for (let i = 0; i < 5; i++) collect(5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM claims WHERE user_id = 5 AND key = ?').get(HW.HW_FRAME).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE user_id = 5 AND text LIKE '%Гарбуз%'").get().n, 1, 'one message');
  // Not for sale: not in the shop, can't be bought with stars.
  assert.ok(!S.SHOP_BY_ID['hw-pumpkin'] && !S.STYLE_ITEMS.some((x) => x.cos === HW.HW_FRAME));
  assert.throws(() => call(5, 'shop/stars', { item: 'hw-pumpkin' }));
});

test('tasks: keys once per task; the last task rolls the №13 once — edition with a serial, or a key', () => {
  for (const [roll, ed] of [[0.05, true], [0.5, false]]) {
    const { g, db, mk, call, collect, task, markDone, keys } = setup({ random: () => roll });
    mk(5);
    g.giveCar(5, 'vaz-2107');
    const key = S.levelKey(12);
    markDone(5, ['open', 'win', 'drift']);
    const before = keys(5, key);
    collect(5);
    collect(5);
    collect(5);
    const last = task(5, 'all');
    assert.ok(last.done, 'all four done → the fifth is done');
    const eds = db.prepare('SELECT * FROM cars WHERE owner_id = 5 AND model = ?').all(HW.HW_EDITION);
    if (ed) {
      assert.equal(eds.length, 1);
      assert.equal(eds[0].serial, 1);
      assert.equal(last.prize.serial, 1);
      assert.equal(keys(5, key), before);
      assert.ok(S.isEdition(HW.HW_EDITION) && S.MODELS[HW.HW_EDITION].filter);
      assert.equal(S.sellPriceOf(HW.HW_EDITION), Math.floor(S.MODELS[HW.HW_EDITION].price * S.EDITION_SELL));
      assert.ok(!db.prepare('SELECT 1 FROM collection WHERE user_id = 5 AND model = ?').get(HW.HW_EDITION), 'not in the collection');
    } else {
      assert.equal(eds.length, 0);
      assert.equal(keys(5, key), before + 1);
      assert.equal(last.prize.caseId, key);
    }
    for (let i = 0; i < 4; i++) collect(5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cars WHERE owner_id = 5 AND model = ?').get(HW.HW_EDITION).n, ed ? 1 : 0, 'rolled once');
    assert.equal(keys(5, key), before + (ed ? 0 : 1));
  }
});

test('tasks: car cases count (13 → the level key, once)', () => {
  const { mk, call, task, keys } = setup();
  mk(5);
  const key = S.levelKey(12);
  for (let i = 0; i < 2; i++) call(5, 'case/open', { caseId: 'city', count: 6 });
  assert.equal(task(5, 'open').progress, 12);
  const k0 = keys(5, key);
  call(5, 'case/open', { caseId: 'city', count: 3 });
  assert.ok(task(5, 'open').done);
  assert.equal(keys(5, key), k0 + 1);
  call(5, 'case/open', { caseId: 'city', count: 6 });
  assert.equal(keys(5, key), k0 + 1, 'paid once');
});

// ---------- after the event ----------
test('after: the frame and the №13 stay, the content hides, nothing more counts; next year is a fresh set', () => {
  const { g, db, mk, call, collect, task, markDone, set } = setup({ random: () => 0.01 });
  mk(5);
  g.giveCar(5, 'vaz-2107');
  markDone(5, ['open', 'win', 'drift']);
  for (let i = 0; i < 3; i++) collect(5);
  assert.ok(task(5, 'all').done);
  set(K('2026-11-04T12:00:00'));
  const me = call(5, 'me');
  assert.equal(me.halloween, null);
  assert.ok(me.claims.includes(HW.HW_FRAME) && me.style.frame === HW.HW_FRAME, 'the frame stays on');
  assert.ok(me.cars.some((c) => c.model === HW.HW_EDITION), 'the №13 stays');
  collect(5);
  assert.equal(db.prepare("SELECT progress FROM hw_tasks WHERE user_id = 5 AND task = 'collect'").get().progress, 3, 'no counting after the end');
  set(Date.parse('2027-10-30T12:00:00+03:00'));
  assert.ok(call(5, 'me').halloween.tasks.every((x) => !x.done), '2027: new tasks');
});

// ---------- the ghost container: honest like the others ----------
test('ghost container: its own pool with the №13, the content fits the hints and the list, the list sums to 1', () => {
  const t = C.TIER_BY.ghost;
  assert.ok(t && t.event === 'halloween' && !C.CONTAINER_TIERS.includes(t));
  const outs = C.tierOutcomes('ghost');
  assert.ok(Math.abs(outs.reduce((a, o) => a + o.p, 0) - 1) < 1e-9);
  assert.ok(outs.some((o) => o.model === HW.HW_EDITION && o.ed), 'the №13 is in the pool');
  assert.ok(outs.every((o) => o.junk || o.model === HW.HW_EDITION || t.bodies.includes(S.MODELS[o.model].body)));
  assert.ok(!outs.some((o) => o.ed && o.model !== HW.HW_EDITION), 'no ordinary editions');
  for (const tr of C.CONTAINER_TIERS) assert.ok(!C.tierOutcomes(tr.id).some((o) => o.model === HW.HW_EDITION), `${tr.id} never draws the №13`);
  let eds = 0;
  const N = 3000;
  for (let s = 1; s <= N; s++) {
    const L = C.spawnLot('ghost', s);
    const o = outs.find((x) => x.model === L.model && x.junk === L.junk);
    assert.ok(o && C.matches(o, L.hints), 'every hint is a true fact');
    const post = C.posterior('ghost', L.hints);
    assert.ok(post.rows.some((r) => r.model === L.model && r.junk === L.junk && r.p > 0), 'the real content is on the list');
    assert.ok(Math.abs(post.rows.reduce((a, r) => a + r.p, 0) - 1) < 1e-9);
    if (L.ed) {
      eds++;
      assert.ok(post.rows.some((r) => r.model === S.MODELS[L.model].base), 'the edition sits next to its base');
    }
    for (const b of L.bots) assert.ok(b.id !== 'zhora' && b.max >= Math.floor(post.ev * R.k[0]) - 1 && b.max <= post.ev * R.k[1] + 1, 'bot limits from the list only');
  }
  const share = outs.filter((o) => o.ed).reduce((a, o) => a + o.p, 0);
  assert.ok(Math.abs(eds / N - share) < 0.012, `editions ${eds / N} vs ${share}`);
});

test('ghost container: «win and sell» returns 0.75–0.85 of the price over many lots (the same bots and rules)', () => {
  let paid = 0, ev = 0, got = 0, wins = 0;
  for (let i = 0; i < 2500; i++) {
    const L = C.spawnLot('ghost', C.seedOf(`ret:ghost:${i}`));
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
  assert.ok(wins > 2300, `a persistent player wins almost always (${wins})`);
  assert.ok(ev / paid >= 0.75 && ev / paid <= 0.85, `expected return ${(ev / paid).toFixed(3)}`);
  assert.ok(got / paid >= 0.7 && got / paid <= 0.9, `realised return ${(got / paid).toFixed(3)}`);
});

test('ghost container: through the server — level gate, commitment, the winner gets the car (the №13 with a serial)', () => {
  const { db, mk, call, add } = setup();
  mk(3, 4);
  mk(5);
  const l = call(5, 'containers').lots.find((x) => x.tier === 'ghost');
  assert.throws(() => call(3, 'containers/bid', { id: l.id, amount: l.minBid }), /рівня 5/);
  // Put the №13 inside (as if the seed drew it) and let a persistent player win.
  db.prepare("UPDATE container_lots SET model = ?, ed = 1, junk = 0 WHERE id = ?").run(HW.HW_EDITION, l.id);
  let d;
  for (let i = 0; i < 800; i++) {
    d = call(5, 'containers/lot', { id: l.id });
    if (d.lot.status === 'done') break;
    if (!d.lot.mine) call(5, 'containers/bid', { id: l.id, amount: d.lot.minBid });
    add(1100);
  }
  assert.ok(d.lot.result.mine);
  const car = db.prepare('SELECT * FROM cars WHERE id = ?').get(d.lot.result.carId);
  assert.equal(car.model, HW.HW_EDITION);
  assert.equal(car.serial, 1);
  assert.ok(call(5, 'containers').lots.some((x) => x.tier === 'ghost' && x.id !== l.id), 'a new ghost lot while the event runs');
});

// ---------- no economy change ----------
test('no case price, odds or sell rate changes during the event', () => {
  const { mk, call, set } = setup({ t0: K('2026-10-28T12:00:00') }); // Wednesday before
  mk(5);
  const snap = () => JSON.stringify(S.CASES.map((c) => [c.id, c.price, c.weights]));
  const before = snap();
  const me0 = call(5, 'me');
  set(K('2026-10-29T12:00:00'));
  const me1 = call(5, 'me');
  assert.ok(me1.halloween && !me0.halloween);
  assert.equal(snap(), before);
  assert.deepEqual(S.SELL_RATES, { D: 0.5, C: 0.45, B: 0.4, A: 0.35, S: 0.3, X: 0.3 });
  assert.ok(!S.EVENT_IDS.includes('halloween'), 'not a weekly event: no case effects');
});
