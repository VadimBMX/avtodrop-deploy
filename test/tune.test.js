// Workshop without grind (audit §2 №9): «Встановити найкраще» (T.bestTune + parts/install-best), the real effect of a
// part on the 402 m time (wheelspin included), «Продати непотрібні» (T.junkParts + parts/sell-junk) and the part-case
// pause after every opening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as T from '../public/tune.js';

const T0 = Date.parse('2026-10-22T10:00:00Z');
function setup(opts = {}) {
  const db = openDb(':memory:');
  let t = T0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true, ...opts });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12, slots = 40 WHERE id = 1').run();
  return { db, g, call, advance: (ms) => (t += ms) };
}
const stockOf = (types, tiers, n = 2) => types.flatMap((k) => tiers.map((t) => ({ type: k, tier: t, available: n, count: n })));
// Every piece the player has, on the warehouse or on a car: "type:tier" → count.
function allPieces(call) {
  const me = call(1, 'me');
  const out = {};
  for (const p of me.parts) out[p.type + ':' + p.tier] = (out[p.type + ':' + p.tier] || 0) + p.count;
  for (const c of me.cars) for (const [k, t] of Object.entries(c.parts)) out[k + ':' + t] = (out[k + ':' + t] || 0) + 1;
  return out;
}

test('economy numbers stay as they were', () => {
  assert.equal(S.PARTS_SHARE, 0.9);
  assert.equal(S.PARTS_KEEP_MAX, 0.008);
  assert.equal(S.PART_SELL_RATE, 0.5);
  assert.equal(S.PART_COOLDOWN_MS, 10000);
  assert.deepEqual(S.PART_CASES.map((c) => c.price), [7000, 23000, 86000, 210000]);
  assert.equal(S.partEffect('brakes', 'stock'), '−0,3% часу'); // decimal comma, like everywhere else
});

test('bestTune: deterministic, order of the warehouse does not matter, best tier wins on a car that grips', () => {
  const car = { model: 'vaz-2107', parts: {} };
  const stock = stockOf(S.partKeysOf('vaz-2107'), ['stock', 'street', 'sport']);
  const a = T.bestTune(car, stock);
  const b = T.bestTune(car, [...stock].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a, T.bestTune(car, stock));
  // Sport everywhere (a full Sport set on top: +5% power).
  assert.ok(S.partKeysOf('vaz-2107').every((k) => a.parts[k] === 'sport'));
  assert.ok(S.hasSet({ model: 'vaz-2107', parts: a.parts }));
  assert.equal(a.changes.length, 8);
  assert.ok(a.dt < -1 && a.after < a.before);
  // Already the best: nothing to do.
  const again = T.bestTune({ model: 'vaz-2107', parts: a.parts }, stock);
  assert.equal(again.changes.length, 0);
  assert.equal(again.dt, 0);
});

test('bestTune: a full set of a lower tier beats a mixed kit when the +5% is worth more', () => {
  // All 8 Stock pieces and one Street engine: Street on the engine breaks the Stock set.
  const keys = S.partKeysOf('vaz-2107');
  const stock = [...stockOf(keys, ['stock'], 1), { type: 'eng', tier: 'street', available: 1 }];
  const r = T.bestTune({ model: 'vaz-2107', parts: {} }, stock);
  const set = T.tuneTime({ model: 'vaz-2107', parts: Object.fromEntries(keys.map((k) => [k, 'stock'])) });
  const mixed = T.tuneTime({ model: 'vaz-2107', parts: { ...Object.fromEntries(keys.map((k) => [k, 'stock'])), eng: 'street' } });
  assert.ok(Math.abs(r.after - Math.min(set, mixed)) < 1e-9);
});

test('wheelspin: on a spinning Bolide power parts still help a little and never slow it; grip parts help (owner 22.10)', () => {
  const bolide = { model: 'bugatti-bolide', parts: {} };
  assert.ok(T.spinning(bolide));
  const eng = T.partGain(bolide, 'eng', 'race');
  // Physics 22.10: power above the grip counts for S.TRACTION.over (it used to add nothing past a hard ceiling).
  assert.ok(eng.dt < -T.TUNE_EPS && !eng.spin && eng.slip, 'more power is faster, the tyres just hold it back');
  const wheels = T.partGain(bolide, 'wheels', 'race');
  assert.ok(wheels.dt < -0.1 && !wheels.spin);
  const keys = S.partKeysOf('bugatti-bolide');
  const r = T.bestTune(bolide, stockOf(keys, ['race']));
  for (const k of ['suspension', 'wheels', 'brakes', 'gearbox']) assert.equal(r.parts[k], 'race', k);
  const partial = { model: 'bugatti-bolide', parts: { eng: 'race', turbo: 'race' } };
  assert.ok(T.tuneTime(partial) <= T.tuneTime(bolide) + T.TUNE_EPS);
  // The race time never grows with power, on any tyres.
  for (const grip of [0.35, 0.5, 0.69]) for (let hp = 100; hp < 5000; hp += 50) assert.ok(S.raceBaseTime(hp + 50, 1400, grip) <= S.raceBaseTime(hp, 1400, grip) + 1e-9, `${hp} hp, grip ${grip}`);
});

test('grip parts do nothing on a car that does not spin; the gearbox is worth more in a fast car', () => {
  const lada = { model: 'vaz-2107', parts: {} };
  assert.equal(T.spinning(lada), false);
  assert.ok(Math.abs(T.partGain(lada, 'wheels', 'race').dt) < T.TUNE_EPS);
  assert.ok(-T.partGain({ model: 'bugatti-bolide', parts: {} }, 'gearbox', 'race').dt > -T.partGain(lada, 'gearbox', 'race').dt);
  // A best kit from wheels only leaves a car that doesn't spin as it is.
  assert.equal(T.bestTune(lada, stockOf(['wheels', 'suspension'], ['race'])).changes.length, 0);
});

test('parts/install-best: installs the kit the app previewed, loses no part, swaps cool down, second call does nothing', () => {
  const { g, call } = setup();
  const vaz = g.giveCar(1, 'vaz-2107').id;
  const supra = g.giveCar(1, 'toyota-supra-a80').id; // class B: Sport and up
  for (const k of S.partKeysOf('vaz-2107')) g.addPart(1, k, 'stock', 2), g.addPart(1, k, 'street', 1);
  g.addPart(1, 'eng', 'sport', 1);
  call(1, 'parts/install', { carId: vaz, type: 'turbo', tier: 'stock' });
  const before = allPieces(call);
  const me = call(1, 'me');
  const preview = T.bestTune(me.cars.find((c) => c.id === vaz), me.parts);
  const r = call(1, 'parts/install-best', { carId: vaz });
  assert.deepEqual(r.changes, preview.changes);
  assert.deepEqual(allPieces(call), before, 'no part lost or made');
  const after = call(1, 'me').cars.find((c) => c.id === vaz);
  assert.deepEqual(after.parts, preview.parts);
  assert.ok(r.dt < 0 && after.et < me.cars.find((c) => c.id === vaz).et);
  // The swapped-out Stock turbo is back on the warehouse, cooling like any removed part.
  assert.ok(r.changes.some((c) => c.type === 'turbo' && c.from === 'stock'));
  const turbo = call(1, 'me').parts.find((p) => p.type === 'turbo' && p.tier === 'stock');
  assert.equal(turbo.cooling, 1);
  assert.equal(call(1, 'parts/install-best', { carId: vaz }).changes.length, 0);
  // The B car can't take Stock/Street: only the Sport engine fits it (and it is already on the Lada? then nothing).
  const s = call(1, 'parts/install-best', { carId: supra });
  assert.ok(s.changes.every((c) => S.TIER_BY_ID[c.to].index >= S.minTierFor('B')));
  assert.deepEqual(allPieces(call), before);
});

test('parts/install-best: cooling pieces are not used, someone else\'s car is refused, electric cars get electric parts', () => {
  const { g, call } = setup();
  const vaz = g.giveCar(1, 'vaz-2107').id;
  const byd = g.giveCar(1, 'byd-dolphin').id;
  g.addPart(1, 'eng', 'stock', 1);
  g.addPart(1, 'motor', 'street', 1);
  call(1, 'parts/install', { carId: vaz, type: 'eng', tier: 'stock' });
  call(1, 'parts/uninstall', { carId: vaz, type: 'eng' }); // cooling now
  assert.equal(call(1, 'parts/install-best', { carId: vaz }).changes.length, 0);
  const e = call(1, 'parts/install-best', { carId: byd });
  assert.deepEqual(e.changes.map((c) => [c.type, c.to]), [['motor', 'street']]);
  g.ensureUser({ id: 2, first_name: 'B' });
  assert.throws(() => call(2, 'parts/install-best', { carId: vaz }), /не твоє/);
});

test('junkParts + parts/sell-junk: only parts no car needs, at the dealer rate, never the useful ones', () => {
  const { g, call } = setup();
  const vaz = g.giveCar(1, 'vaz-2107').id;
  g.giveCar(1, 'toyota-supra-a80'); // B: takes Sport+ only
  g.addPart(1, 'eng', 'street', 1);
  call(1, 'parts/install', { carId: vaz, type: 'eng', tier: 'street' });
  g.addPart(1, 'eng', 'stock', 3); // worse than the Lada's Street engine, too low for the Supra → junk
  g.addPart(1, 'eng', 'sport', 1); // the Supra has no engine yet → useful
  g.addPart(1, 'motor', 'race', 1); // no electric car in the garage → junk
  g.addPart(1, 'wheels', 'stock', 1); // the Lada's wheels are empty → useful (even if it doesn't spin)
  const me = call(1, 'me');
  const junk = T.junkParts(me.cars, me.parts);
  assert.deepEqual(junk.map((p) => `${p.type}:${p.tier}:${p.count}`).sort(), ['eng:stock:3', 'motor:race:1']);
  const money = me.balance;
  const r = call(1, 'parts/sell-junk', { items: [...junk, { type: 'eng', tier: 'sport', count: 1 }] });
  assert.equal(r.count, 4);
  assert.equal(r.got, 3 * S.TIER_BY_ID.stock.price * S.PART_SELL_RATE + S.TIER_BY_ID.race.price * S.PART_SELL_RATE);
  assert.equal(call(1, 'me').balance, money + r.got);
  const left = call(1, 'me').parts.map((p) => `${p.type}:${p.tier}:${p.count}`).sort();
  assert.deepEqual(left, ['eng:sport:1', 'wheels:stock:1']);
  assert.throws(() => call(1, 'parts/sell-junk', { items: [{ type: 'eng', tier: 'sport', count: 1 }] }), /не зайві/);
});

test('part cases: the 10 s pause follows every opening — ×1, ×5 and ×10 alike', () => {
  const { call, advance } = setup({ partCooldownMs: undefined });
  const r1 = call(1, 'parts/open', { caseId: 'scrap', count: 1 });
  assert.equal(r1.nextAt, T0 + S.PART_COOLDOWN_MS);
  assert.throws(() => call(1, 'parts/open', { caseId: 'scrap', count: 1 }), /Зачекай/);
  assert.throws(() => call(1, 'parts/open', { caseId: 'scrap', count: 5 }), /Зачекай/);
  advance(S.PART_COOLDOWN_MS);
  assert.equal(call(1, 'parts/open', { caseId: 'scrap', count: 5 }).results.length, 5);
  advance(S.PART_COOLDOWN_MS);
  const r10 = call(1, 'parts/open', { caseId: 'scrap', count: 10 });
  assert.equal(r10.results.length, 10);
  assert.equal(r10.nextAt, T0 + 3 * S.PART_COOLDOWN_MS); // ×10 starts the pause too
  assert.throws(() => call(1, 'parts/open', { caseId: 'scrap', count: 1 }), /Зачекай/);
  advance(S.PART_COOLDOWN_MS);
  call(1, 'parts/open', { caseId: 'scrap', count: 1 });
});
