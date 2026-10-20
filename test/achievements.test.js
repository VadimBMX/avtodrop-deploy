import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12, slots = 1000, level = 99, level_seen = 99 WHERE id = 1').run();
  return { db, g, call: (name, body = {}) => g.api[name](1, body) };
}
const state = (call, key) => call('achievements').list.find((s) => s.key === key);

test('achievements: progress from past play, every tier pays once', () => {
  const { db, call } = setup();
  db.prepare('UPDATE users SET cases_opened = 120 WHERE id = 1').run(); // played before achievements existed
  const s = state(call, 'cases');
  assert.equal(s.reached, 2);
  assert.equal(s.claimed, 0);
  const before = call('me').balance;
  const r = call('ach/claim', { key: 'cases' });
  assert.equal(r.got, S.achReward(S.ACH_BY_KEY.cases.rewards[0]).money + S.achReward(S.ACH_BY_KEY.cases.rewards[1]).money);
  assert.equal(call('me').balance, before + r.got);
  assert.equal(state(call, 'cases').claimed, 2);
  assert.throws(() => call('ach/claim', { key: 'cases' }), /Немає нових/);
});

test('achievements: rarest class, tuning and secrets are measured from what you own', () => {
  const { g, call } = setup();
  g.giveCar(1, 'lexus-lfa');
  assert.equal(state(call, 'rarest').reached, 3, 'an S car reaches the B, A and S tiers');
  const car = g.giveCar(1, 'zaz-lanos').id;
  for (const k of S.partKeysOf('zaz-lanos')) {
    g.addPart(1, k, 'pro', 1);
    call('parts/install', { carId: car, type: k, tier: 'pro' });
  }
  assert.equal(state(call, 'tuned').reached, 3, '8 Pro parts = third tier');
  g.giveCar(1, S.SECRET_BY_COUNTRY.UA);
  assert.equal(state(call, 'secrets').reached, 1);
});

test('achievements show up in the banner poll: one each, or one "claim all"', () => {
  const { db, call } = setup();
  db.prepare('UPDATE users SET wins = 15, level = 1, level_seen = 1 WHERE id = 1').run();
  let c = call('pulse').claims.filter((x) => x.kind === 'ach' || x.kind === 'achAll');
  assert.deepEqual(c.map((x) => x.kind + ':' + x.id), ['ach:wins']);
  db.prepare('UPDATE users SET cases_opened = 20, merges = 10, streak = 5 WHERE id = 1').run();
  c = call('pulse').claims.filter((x) => x.kind === 'ach' || x.kind === 'achAll');
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'achAll');
  call('ach/claim');
  assert.equal(call('pulse').claims.filter((x) => x.kind === 'ach' || x.kind === 'achAll').length, 0);
});

test('every achievement has a text for each tier and growing goals', () => {
  for (const a of S.ACHIEVEMENTS) {
    assert.equal(a.goals.length, a.rewards.length, a.key);
    assert.ok(a.goals.length <= S.ACH_TIERS.length, a.key);
    a.goals.forEach((g, i) => {
      assert.ok(S.achText(a, i).length > 5, `${a.key} tier ${i}`);
      if (i) assert.ok(g > a.goals[i - 1] && S.achRewardValue(a.rewards[i]) > S.achRewardValue(a.rewards[i - 1]), `${a.key} grows`);
      assert.ok(S.achRewardText(a.rewards[i]).length > 2, `${a.key} tier ${i} reward text`);
    });
  }
});

test('plates: only a plate you generated counts, a plate that came with a traded car does not', () => {
  const { db, g, call } = setup();
  g.ensureUser({ id: 2, first_name: 'B' });
  // Player 2 holds a mythic plate on a car and hands the car over: the plate moves with it, the achievement doesn't.
  const car = g.giveCar(2, 'zaz-lanos').id;
  db.prepare("INSERT INTO plates (owner_id, text, cls, value, car_id, created_at) VALUES (2, 'AA 0001 AA', 'S', 2000000, ?, 0)").run(car);
  db.prepare('UPDATE cars SET owner_id = 1 WHERE id = ?').run(car);
  db.prepare('UPDATE plates SET owner_id = 1 WHERE car_id = ?').run(car);
  assert.equal(state(call, 'plates').reached, 0, 'a received plate gives nothing');
  // Generating counts — and keeps counting after the plate is sold.
  let best = 0;
  for (let i = 0; i < 40 && best < 2; i++) {
    const { plate } = call('plate/generate', { gen: 'better' });
    best = Math.max(best, S.rankOf(plate.cls));
    call('plate/sell', { plateId: plate.id });
  }
  assert.ok(best >= 2, 'the better tier gives a B plate within 40 tries');
  assert.equal(state(call, 'plates').value, best);
  assert.equal(state(call, 'plates').reached, best);
});

test('plates: the migration counts plates owned before the change', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ach-')), 'db.sqlite');
  const db = openDb(file);
  createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} }).ensureUser({ id: 5, first_name: 'Old' });
  db.exec("INSERT INTO plates (owner_id, text, cls, value, created_at) VALUES (5, 'AA 7777 BC', 'A', 300000, 0)");
  db.exec('UPDATE users SET plate_best = 0');
  db.close();
  const raw = new DatabaseSync(file); // an old database: the column didn't exist yet
  raw.exec('ALTER TABLE users DROP COLUMN plate_best');
  raw.close();
  const again = openDb(file);
  assert.equal(again.prepare('SELECT plate_best FROM users WHERE id = 5').get().plate_best, 3);
  again.exec('UPDATE users SET plate_best = 1');
  again.close();
  assert.equal(openDb(file).prepare('SELECT plate_best FROM users WHERE id = 5').get().plate_best, 1, 'the backfill runs only once');
});

test('PvP and battle wins: one per rival per day', () => {
  const { db, call } = setup();
  const day = Date.parse('2026-10-19T10:00:00Z');
  const pvp = db.prepare("INSERT INTO pvp (creator_id, car_id, snapshot, bet, opponent_id, winner_id, status, created_at, finished_at) VALUES (?, 1, '{}', 5000, ?, 1, 'done', 0, ?)");
  for (let i = 0; i < 10; i++) pvp.run(1, 2, day + i * 60e3); // ten wins over one alt on one day
  pvp.run(3, 1, day); // another rival, same day
  pvp.run(1, 2, day + 86400e3); // the alt again, the next day
  db.prepare("INSERT INTO pvp (creator_id, car_id, snapshot, bet, opponent_id, winner_id, status, created_at, finished_at) VALUES (1, 1, '{}', 5000, 2, 2, 'done', 0, ?)").run(day); // a loss
  assert.equal(state(call, 'pvp').value, 3);
  const bt = db.prepare("INSERT INTO battles (creator_id, opponent_id, case_id, count, price, status, winner_id, created_at, finished_at) VALUES (?, ?, 'rust', 1, 60000, 'done', 1, 0, ?)");
  for (let i = 0; i < 5; i++) bt.run(2, 1, day + i);
  assert.equal(state(call, 'battles').value, 1);
});

test('non-money rewards: keys, parts and fuel are granted on claim', () => {
  const { db, g, call } = setup();
  db.prepare('UPDATE users SET merges = 60, fuel = 0 WHERE id = 1').run();
  const r = call('ach/claim', { key: 'merges' });
  assert.equal(r.tiers, 2);
  assert.equal(r.got, 5000);
  assert.ok(r.text.includes('Sport'), r.text);
  const parts = call('me').parts || [];
  assert.ok(JSON.stringify(parts).includes('sport'), 'a Sport part is in the warehouse');
  db.prepare('UPDATE users SET cases_opened = 1000 WHERE id = 1').run();
  call('ach/claim', { key: 'cases' });
  assert.ok(db.prepare("SELECT count FROM keys WHERE user_id = 1 AND case_id = 'city'").get().count >= 1);
  db.prepare('UPDATE users SET wins = 100 WHERE id = 1').run();
  call('ach/claim', { key: 'wins' });
  assert.equal(db.prepare('SELECT fuel FROM users WHERE id = 1').get().fuel, S.FUEL_MAX);
});

test('balance: early tiers are small, plates never pay millions', () => {
  for (const a of S.ACHIEVEMENTS) {
    if (a.key === 'secrets') continue; // needs a whole country collection even for the first tier
    assert.ok(S.achRewardValue(a.rewards[0]) <= 10000, `${a.key} bronze is a small bonus`);
  }
  const plates = S.ACH_BY_KEY.plates.rewards.reduce((s, r) => s + S.achRewardValue(r), 0);
  // An A plate costs ~360k of "pretty" generations on average; its tiers must pay well under that.
  assert.ok(S.ACH_BY_KEY.plates.rewards.slice(0, 3).reduce((s, r) => s + S.achRewardValue(r), 0) < 0.25 * S.PLATE_GEN[2].price / 0.7);
  assert.ok(plates < 1e6, 'the whole plate track is under a million');
  const total = S.ACHIEVEMENTS.reduce((s, a) => s + a.rewards.reduce((x, r) => x + S.achRewardValue(r), 0), 0);
  assert.ok(total < 60e6, `all achievements together: ${total}`);
});
