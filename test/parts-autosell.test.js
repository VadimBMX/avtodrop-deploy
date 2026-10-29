// Part cases: «Автопродаж» (the chosen tiers go to the dealer right as they drop, inside the same parts/open call, at
// the hand-sale rate) and the S.PART_COOLDOWN_MS pause after every opening (×1…×10), kept in users.parts_open_at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, dayOf } from '../src/game.js';
import * as S from '../public/shared.js';

const T0 = Date.parse('2026-10-29T10:00:00Z');
function setup(db = openDb(':memory:'), clock = { t: T0 }) {
  const g = createGame(db, { now: () => clock.t, notify: () => {}, random: () => 0.5, allUnlocked: true });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12 WHERE id = 1').run();
  return { db, g, call, clock, advance: (ms) => (clock.t += ms) };
}
const stock = (call) => Object.fromEntries(call(1, 'me').parts.map((p) => [p.type + ':' + p.tier, p.count]));
const sale = (tier) => Math.floor(S.TIER_BY_ID[tier].price * S.PART_SELL_RATE);

test('autosell: every tier a part case drops has a chip; nothing is sold by default', () => {
  assert.deepEqual(S.PART_DROP_TIERS, ['stock', 'street', 'sport', 'pro', 'race']);
  const { call } = setup();
  assert.deepEqual(call(1, 'me').partsAutosell, []);
  const r = call(1, 'parts/open', { caseId: 'atelier', count: 10 });
  assert.equal(r.autoSold.count, 0);
  assert.equal(r.autoSold.got, 0);
  assert.ok(r.results.every((p) => !('autoSold' in p)));
  assert.equal(Object.values(stock(call)).reduce((a, b) => a + b, 0), 10);
});

test('autosell: only the chosen tiers are sold, at the hand-sale rate, in the same call; the rest go to the warehouse', () => {
  const { db, g, call, advance } = setup();
  call(1, 'parts/autosell', { tiers: ['stock', 'street'] });
  const day = dayOf(T0);
  db.prepare('INSERT INTO quests (user_id, day, key, target, reward) VALUES (1, ?, ?, 1000, 1)').run(day, 'parts');
  const kept = {};
  let opened = 0, soldSeen = 0, keptSeen = 0, paid = 0, got = 0;
  const money0 = call(1, 'me').balance;
  // Atelier drops stock/street (sold) and sport/pro (kept): open until both kinds came (a few ×10 at most).
  for (let i = 0; i < 20 && !(soldSeen && keptSeen); i++) {
    const r = call(1, 'parts/open', { caseId: 'atelier', count: 10 });
    opened += 10;
    paid += r.price;
    let sum = 0;
    for (const p of r.results) {
      if (['stock', 'street'].includes(p.tier)) {
        assert.equal(p.autoSold, sale(p.tier), `${p.tier} sold at the dealer rate`);
        sum += p.autoSold;
        soldSeen++;
      } else {
        assert.equal(p.autoSold, undefined, `${p.tier} is kept`);
        kept[p.type + ':' + p.tier] = (kept[p.type + ':' + p.tier] || 0) + 1;
        keptSeen++;
      }
    }
    assert.equal(r.autoSold.got, sum);
    assert.equal(r.autoSold.count, r.results.filter((p) => p.autoSold).length);
    got += sum;
    advance(S.PART_COOLDOWN_MS);
  }
  assert.ok(soldSeen && keptSeen, 'both sold and kept drops were seen');
  // The warehouse holds exactly the kept ones; no stock/street piece ever landed there.
  assert.deepEqual(stock(call), kept);
  assert.equal(call(1, 'me').balance, money0 - paid + got);
  // Every drop is still on the provably fair record, and opened cases count for the tasks.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM drops WHERE user_id = 1 AND case_id = 'atelier'").get().n, opened);
  assert.equal(db.prepare("SELECT progress FROM quests WHERE user_id = 1 AND day = ? AND key = 'parts'").get(day).progress, opened);
  // The owner's metrics see it as a dealer sale, not as cheaper cases.
  assert.equal(g.adminCall('key', 'metrics', { days: 14 }).money.groups.find((x) => x.key === 'sales')?.created, got);
  // The same money as selling that tier by hand.
  g.addPart(1, 'eng', 'street', 1);
  assert.equal(call(1, 'parts/sell', { type: 'eng', tier: 'street', count: 1 }).got, sale('street'));
});

test('autosell: the top tier is sold only when picked; the choice persists and bad input changes nothing', () => {
  const { db, call } = setup();
  assert.deepEqual(call(1, 'parts/autosell', { tiers: ['race', 'stock', 'stock'] }).tiers, ['stock', 'race']); // S.TIERS order, once each
  assert.deepEqual(call(1, 'me').partsAutosell, ['stock', 'race']);
  for (const tiers of [undefined, null, 'stock', { stock: 1 }, ['gold'], [5], ['stock', null], ['STOCK'], [...S.PART_DROP_TIERS, 'stock']]) {
    assert.throws(() => call(1, 'parts/autosell', { tiers }), /Обери рівні деталей|Невідомий рівень деталі/, JSON.stringify(tiers));
  }
  assert.deepEqual(call(1, 'me').partsAutosell, ['stock', 'race']);
  // A restart (a new game on the same database) keeps it.
  assert.deepEqual(setup(db).call(1, 'me').partsAutosell, ['stock', 'race']);
  // Factory drops sport/pro/race: with stock+race picked only race is sold.
  const r = call(1, 'parts/open', { caseId: 'factory', count: 10 });
  for (const p of r.results) assert.equal(p.autoSold, p.tier === 'race' ? sale('race') : undefined);
  assert.equal(Object.keys(stock(call)).some((k) => k.endsWith(':race')), false);
  // [] switches it off.
  assert.deepEqual(call(1, 'parts/autosell', { tiers: [] }).tiers, []);
  assert.equal(db.prepare('SELECT parts_autosell FROM users WHERE id = 1').get().parts_autosell, '');
});

test('autosell: a failed opening sells nothing and pays nothing', () => {
  const { db, call } = setup();
  call(1, 'parts/autosell', { tiers: S.PART_DROP_TIERS });
  db.prepare('UPDATE users SET balance = 100 WHERE id = 1').run();
  assert.throws(() => call(1, 'parts/open', { caseId: 'scrap', count: 10 }), /Недостатньо/);
  assert.equal(call(1, 'me').balance, 100);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM drops WHERE user_id = 1').get().n, 0);
});

test('cooldown: 10 s after every opening (×1…×10), checked by the server and kept over a restart', () => {
  assert.equal(S.PART_COOLDOWN_MS, 10000);
  const { db, call, clock, advance } = setup();
  assert.equal(call(1, 'me').partsNextAt, 0);
  const r = call(1, 'parts/open', { caseId: 'scrap', count: 1 });
  assert.equal(r.nextAt, T0 + S.PART_COOLDOWN_MS);
  assert.equal(call(1, 'me').partsNextAt, T0 + S.PART_COOLDOWN_MS);
  const money = call(1, 'me').balance;
  assert.throws(() => call(1, 'parts/open', { caseId: 'scrap', count: 1 }), /Зачекай ще 10 с/);
  assert.throws(() => call(1, 'parts/open', { caseId: 'scrap', count: 10 }), /Зачекай ще 10 с/); // multi-opens wait too
  assert.equal(call(1, 'me').balance, money, 'a refused opening costs nothing');
  advance(9000);
  assert.throws(() => call(1, 'parts/open', { caseId: 'atelier', count: 5 }), /Зачекай ще 1 с/);
  // A restart doesn't forgive the pause (users.parts_open_at, not memory).
  assert.throws(() => setup(db, clock).call(1, 'parts/open', { caseId: 'scrap', count: 1 }), /Зачекай ще 1 с/);
  advance(1000);
  const r10 = call(1, 'parts/open', { caseId: 'scrap', count: 10 });
  assert.equal(r10.results.length, 10);
  assert.equal(r10.nextAt, clock.t + S.PART_COOLDOWN_MS); // ×10 starts the pause as well
  assert.throws(() => call(1, 'parts/open', { caseId: 'scrap', count: 1 }), /Зачекай ще 10 с/);
  advance(S.PART_COOLDOWN_MS);
  assert.equal(call(1, 'me').partsNextAt, 0);
  call(1, 'parts/open', { caseId: 'scrap', count: 3 });
});

test('cooldown: a refused opening (no money) does not start the pause', () => {
  const { db, call } = setup();
  db.prepare('UPDATE users SET balance = 100 WHERE id = 1').run();
  assert.throws(() => call(1, 'parts/open', { caseId: 'scrap', count: 1 }), /Недостатньо/);
  db.prepare('UPDATE users SET balance = 1e9 WHERE id = 1').run();
  call(1, 'parts/open', { caseId: 'scrap', count: 1 });
});
