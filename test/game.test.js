import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, GameError, fairRoll, pickWeighted, classEntries, pickModel, weekOf } from '../src/game.js';
import { verifyInitData, signInitData } from '../src/auth.js';
import { createApp } from '../server.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

function setup(t0 = Date.parse('2026-10-14T10:00:00Z')) {
  const db = openDb(':memory:');
  let t = t0;
  let r = 0.5;
  const sent = [];
  const g = createGame(db, { now: () => t, notify: (uid, text) => sent.push([uid, text]), random: () => r, partCooldownMs: 0, allUnlocked: true });
  const clock = { advance: (ms) => (t += ms) };
  const mk = (id, username) => (g.ensureUser({ id, username, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const rich = (id, n = 1e12) => db.prepare('UPDATE users SET balance = ?, slots = 40 WHERE id = ?').run(n, id);
  return { db, g, clock, mk, call, sent, rich, setRandom: (x) => (r = x) };
}
const car = (call, uid, id) => call(uid, 'me').cars.find((c) => c.id === id);
// Drives a started race like the app does (taps at the right moments) and finishes it once the run is over.
const drive = ({ call, clock }, uid, st, reaction, qs) => {
  const run = honestDrag(st.car, st.greenMs, reaction, qs);
  clock.advance(Math.ceil(run.ms) + 50);
  return call(uid, 'race/finish', { raceId: st.raceId, ...run.body });
};

test('data: unique models, every case class has cars, case prices below average drop value', () => {
  assert.equal(new Set(S.ALL_MODELS.map((m) => m.name)).size, S.ALL_MODELS.length);
  for (const c of S.CASES) {
    for (const cls of Object.keys(c.weights)) assert.ok(c.pool(cls).length > 0, `${c.id}/${cls}`);
    if (!c.starter) assert.ok(c.price > 0);
  }
  for (const c of S.MAIN_COUNTRIES) assert.ok(S.SECRET_BY_COUNTRY[c], c);
});

test('new player: starter case free once, garage starts with 6 slots', () => {
  const { mk, call } = setup();
  mk(1);
  const me = call(1, 'me');
  assert.equal(me.balance, S.START_BALANCE);
  assert.equal(me.slots, S.START_SLOTS);
  const r = call(1, 'case/open', { caseId: 'starter' });
  assert.equal(S.MODELS[r.results[0].car.model].cls, 'D');
  assert.equal(S.MODELS[r.results[0].car.model].country, 'UA');
  assert.equal(call(1, 'me').balance, S.START_BALANCE);
  assert.throws(() => call(1, 'case/open', { caseId: 'starter' }), /уже відкрито/);
  assert.equal(call(1, 'me').newbie.ready, true);
});

test('cases open as x1, x3 or x6 only', () => {
  const { mk, call, rich } = setup();
  mk(1);
  rich(1);
  assert.equal(call(1, 'case/open', { caseId: 'rust', count: 6 }).results.length, 6);
  assert.equal(call(1, 'case/open', { caseId: 'rust', count: 3 }).results.length, 3);
  assert.throws(() => call(1, 'case/open', { caseId: 'rust', count: 5 }), /1, 3 або 6/);
});

test('pity guarantees the first rare class of the case after its n opens', () => {
  const { mk, call, rich, g } = setup();
  mk(1);
  rich(1);
  g.giveCar(1, 'vaz-2106');
  let saw = false;
  for (let i = 0; i < S.pitySteps(S.CASE_BY_ID.rust)[0].n && !saw; i++) {
    const { results } = call(1, 'case/open', { caseId: 'rust' });
    if (S.MODELS[results[0].car.model].cls !== 'D') saw = true;
    call(1, 'sell', { carIds: [results[0].car.id] });
  }
  assert.ok(saw);
});

test('fair roll is reproducible from the revealed seed', () => {
  const { mk, call, rich } = setup();
  mk(1);
  rich(1);
  const before = call(1, 'me').fair;
  const [d] = call(1, 'case/open', { caseId: 'city' }).results;
  const rev = call(1, 'fair/rotate');
  assert.equal(rev.hash, before.seedHash);
  const h = call(1, 'case/history')[0];
  const cs = S.CASE_BY_ID.city;
  const cls = h.forced ? h.cls : pickWeighted(classEntries(cs.weights), fairRoll(rev.revealed, h.clientSeed, h.nonce, 0));
  assert.equal(pickModel(cs.pool(cls), fairRoll(rev.revealed, h.clientSeed, h.nonce, 1)), d.car.model);
});

test('parts: open, install respects class, merge 3→1, cooldown after removal', () => {
  const { mk, call, rich, g, clock, setRandom } = setup();
  mk(1);
  rich(1);
  const supra = g.giveCar(1, 'toyota-supra-a80').id; // class B → needs Sport+
  const vaz = g.giveCar(1, 'vaz-2107').id;
  g.addPart(1, 'eng', 'stock', 3);
  assert.throws(() => call(1, 'parts/install', { carId: supra, type: 'eng', tier: 'stock' }), /потрібні деталі від Sport/);
  const before = car(call, 1, vaz);
  call(1, 'parts/install', { carId: vaz, type: 'eng', tier: 'stock' });
  const after = car(call, 1, vaz);
  assert.ok(after.hp > before.hp);
  assert.equal(after.value, before.value + S.TIER_BY_ID.stock.price);
  call(1, 'parts/uninstall', { carId: vaz, type: 'eng' });
  const inv = call(1, 'me').parts.find((p) => p.type === 'eng' && p.tier === 'stock');
  assert.equal(inv.count, 3);
  assert.equal(inv.available, 2);
  assert.throws(() => call(1, 'parts/merge', { type: 'eng', tier: 'stock' }), /остигає/);
  clock.advance(S.PART_COOLDOWN_MIN * 60e3 + 1);
  setRandom(0.1);
  const m = call(1, 'parts/merge', { type: 'eng', tier: 'stock' });
  assert.equal(m.ok, true);
  assert.equal(call(1, 'me').parts.find((p) => p.tier === 'street').count, 1);
  // street→sport is 80%: a high roll burns all three
  g.addPart(1, 'eng', 'street', 2);
  setRandom(0.95);
  assert.equal(call(1, 'parts/merge', { type: 'eng', tier: 'street' }).ok, false);
  assert.equal(call(1, 'me').parts.filter((p) => p.tier === 'street').length, 0);
});

test('part cases: picking a type costs 15% more, factory is random-only', () => {
  const { mk, call, rich } = setup();
  mk(1);
  rich(1, 1e6);
  const r = call(1, 'parts/open', { caseId: 'scrap', type: 'wheels', count: 3 });
  assert.ok(r.results.every((p) => p.type === 'wheels'));
  assert.equal(r.price, Math.round(S.PART_CASE_BY_ID.scrap.price * 1.15 / 100) * 100 * 3);
  assert.throws(() => call(1, 'parts/open', { caseId: 'factory', type: 'eng' }), /випадкові/);
});

test('plates: generated plate matches its class, is unique and adds car value', () => {
  const { mk, call, rich, g, setRandom } = setup();
  mk(1);
  rich(1);
  const c = g.giveCar(1, 'vaz-2107').id;
  for (const r of [0.01, 0.5, 0.99]) {
    setRandom(r);
    const { plate } = call(1, 'plate/generate', { gen: 'pretty' });
    assert.equal(S.plateInfo(plate.text).cls, plate.cls);
  }
  const p = call(1, 'me').plates[0];
  const before = car(call, 1, c).value;
  call(1, 'plate/attach', { plateId: p.id, carId: c });
  assert.equal(car(call, 1, c).value, before + p.value);
  assert.throws(() => call(1, 'plate/sell', { plateId: p.id }), /зніми/);
  call(1, 'plate/detach', { plateId: p.id });
  assert.equal(call(1, 'plate/sell', { plateId: p.id }).got, Math.floor(p.value / 2));
});

test('showcase: cars there earn nothing and free a garage slot; last car stays', () => {
  const { mk, call, g } = setup();
  mk(1);
  const a = g.giveCar(1, 'vaz-2107').id;
  assert.throws(() => call(1, 'showcase', { carId: a, put: true }), /Останню/);
  g.giveCar(1, 'vaz-2106');
  call(1, 'showcase', { carId: a, put: true });
  const me = call(1, 'me');
  assert.equal(me.used, 1);
  assert.equal(me.income.rate, Math.round(S.MODELS['vaz-2106'].price * S.CLASS_INCOME.D));
  assert.throws(() => call(1, 'sell', { carIds: me.cars.map((c) => c.id) }), /Останню/);
});

test('selling a car returns its parts and plate', () => {
  const { mk, call, rich, g } = setup();
  mk(1);
  rich(1);
  g.giveCar(1, 'vaz-2106');
  const c = g.giveCar(1, 'vaz-2107').id;
  g.addPart(1, 'turbo', 'street', 1);
  call(1, 'parts/install', { carId: c, type: 'turbo', tier: 'street' });
  call(1, 'plate/generate', { gen: 'basic' });
  call(1, 'plate/attach', { plateId: call(1, 'me').plates[0].id, carId: c });
  const bal = call(1, 'me').balance;
  call(1, 'sell', { carIds: [c] });
  const me = call(1, 'me');
  assert.equal(me.balance, bal + S.sellPriceOf('vaz-2107'));
  assert.equal(me.parts.find((p) => p.type === 'turbo').count, 1);
  assert.equal(me.plates[0].carId, null);
});

test('race: rivals, shared fuel, perfect driving beats the easy rival, entry is returned on win', () => {
  const ctx = setup();
  const { mk, call, g, setRandom } = ctx;
  mk(1);
  const c = g.giveCar(1, 'vaz-2107').id;
  const all = call(1, 'race/rivals', { carId: c }).list;
  assert.equal(all.length, 4);
  assert.equal(all[0].id, 'train');
  assert.equal(all[0].entry, 0);
  const list = all.slice(1);
  assert.ok(list[0].chance > list[2].chance);
  setRandom(0.5);
  const bal = call(1, 'me').balance;
  const st = call(1, 'race/start', { carId: c, rival: 'easy' });
  assert.equal(call(1, 'me').balance, bal - list[0].entry);
  assert.equal(call(1, 'me').fuel, S.FUEL_MAX - 1);
  assert.equal(car(call, 1, c).tank, S.CAR_TANK, 'no per-car tank: an app from before sees it full');
  const r = drive(ctx, 1, st, 0.12, ['perfect', 'perfect', 'perfect', 'perfect']);
  assert.deepEqual(r.shifts, ['perfect', 'perfect', 'perfect', 'perfect']);
  assert.equal(r.win, true);
  assert.equal(r.perfectStart, true);
  assert.equal(call(1, 'me').balance, bal + list[0].prize);
  assert.throws(() => call(1, 'race/finish', { raceId: st.raceId, reaction: 0.12, shifts: ['good', 'good', 'good', 'good'] }), /завершено/);
});

test('race: jump start and missed shifts are slower; one car races the whole shared tank', () => {
  const ctx = setup();
  const { mk, call, g, rich } = ctx;
  mk(1);
  rich(1);
  const c = g.giveCar(1, 'vaz-2107').id;
  const times = [];
  for (const [reaction, q] of [[0.12, 'perfect'], [-1, 'late']]) {
    const st = call(1, 'race/start', { carId: c, rival: 'mid' });
    times.push(drive(ctx, 1, st, reaction, Array(4).fill(q)).time);
  }
  assert.ok(times[1] > times[0] + 1);
  for (let i = 2; i < S.FUEL_MAX; i++) drive(ctx, 1, call(1, 'race/start', { carId: c, rival: 'easy' }), 0.2, Array(4).fill('good'));
  assert.equal(call(1, 'me').fuel, 0);
  assert.throws(() => call(1, 'race/start', { carId: c, rival: 'easy' }), /Пальне 0\/15 — \+1 через \d+ хв/);
});

test('levels: xp grants level rewards; capped xp stops at the daily limit', () => {
  const { mk, call, rich } = setup();
  mk(1);
  rich(1, 1e9);
  for (let i = 0; i < 20; i++) call(1, 'plate/generate', { gen: 'basic' });
  assert.ok(call(1, 'me').xpToday <= S.DAILY_XP_CAP);
  for (let i = 0; i < 80; i++) call(1, 'plate/generate', { gen: 'basic' });
  assert.equal(call(1, 'me').xpToday, S.DAILY_XP_CAP);
  assert.ok(call(1, 'me').level >= 2);
});

test('newbie tasks are claimed in order', () => {
  const { mk, call } = setup();
  mk(1);
  assert.throws(() => call(1, 'newbie/claim'), /ще не виконано/);
  call(1, 'case/open', { caseId: 'starter' });
  const bal = call(1, 'me').balance;
  call(1, 'newbie/claim');
  assert.equal(call(1, 'me').balance, bal + S.NEWBIE_TASKS[0].money);
  assert.equal(call(1, 'me').newbie.key, 'collect');
});

test('daily bonus streak and 4-hour reward case', () => {
  const { mk, call, clock } = setup();
  mk(1);
  assert.equal(call(1, 'rewards/daily').streak, 1);
  assert.throws(() => call(1, 'rewards/daily'), /вже забрано/);
  clock.advance(86400e3);
  const d2 = call(1, 'rewards/daily');
  assert.equal(d2.streak, 2);
  assert.equal(d2.reward.items.length, 3);
  call(1, 'rewards/case');
  assert.throws(() => call(1, 'rewards/case'), /не готовий/);
  clock.advance(S.REWARD_CASE_HOURS * 3600e3);
  call(1, 'rewards/case');
});

test('collection: country completion gives money and the secret car', () => {
  const { mk, call, g, rich } = setup();
  mk(1);
  rich(1);
  assert.throws(() => call(1, 'collection/claim', { key: 'cGB' }), /Збери/);
  for (const m of S.countryModels('GB')) g.giveCar(1, m.id);
  call(1, 'collection/claim', { key: 'cGB' });
  assert.ok(call(1, 'me').cars.some((c) => c.model === S.SECRET_BY_COUNTRY.GB));
  assert.throws(() => call(1, 'collection/claim', { key: 'cGB' }), /вже/);
  call(1, 'collection/claim', { key: 'n5' });
});

test('trade: cars move with parts and plate; stale offers are invalidated', () => {
  const { mk, call, g, rich } = setup();
  mk(1, 'alice');
  mk(2, 'bob');
  rich(1);
  g.giveCar(1, 'vaz-2106');
  g.giveCar(2, 'vaz-2109');
  const a = g.giveCar(1, 'toyota-supra-a80').id;
  const b = g.giveCar(2, 'nissan-skyline-gt-r-r34').id;
  g.addPart(1, 'eng', 'sport', 1);
  call(1, 'parts/install', { carId: a, type: 'eng', tier: 'sport' });
  call(1, 'plate/generate', { gen: 'basic' });
  const plate = call(1, 'me').plates[0];
  call(1, 'plate/attach', { plateId: plate.id, carId: a });
  call(1, 'trade/create', { to: '@bob', give: [a], get: [b], giveMoney: 1000 });
  call(1, 'trade/create', { to: 'bob', give: [a] });
  const [t2, t1] = call(2, 'trade/list').open;
  call(2, 'trade/accept', { id: t1.id });
  const got = car(call, 2, a);
  assert.equal(got.parts.eng, 'sport');
  assert.equal(got.plate.id, plate.id);
  assert.ok(call(2, 'me').plates.some((p) => p.id === plate.id));
  assert.equal(call(2, 'trade/list').open.length, 0);
  assert.throws(() => call(2, 'trade/accept', { id: t2.id }), GameError);
});

test('market and auction transfer cars; anti-snipe extends the auction', () => {
  const { mk, call, g, db, clock } = setup();
  mk(1);
  mk(2);
  mk(3);
  db.prepare('UPDATE users SET balance = 10000000 WHERE id IN (2, 3)').run();
  g.giveCar(1, 'vaz-2106');
  const c = g.giveCar(1, 'toyota-supra-a80').id;
  call(1, 'market/sell', { carId: c, price: 500000 });
  assert.throws(() => call(1, 'sell', { carIds: [c] }), GameError);
  call(2, 'market/buy', { id: call(2, 'market/list').list.find((l) => !l.dealer).id });
  assert.equal(car(call, 2, c).id, c);
  g.giveCar(2, 'vaz-2109');
  call(2, 'auction/create', { carId: c, startPrice: 100000, hours: 1 });
  const id = call(3, 'auction/list').list[0].id;
  clock.advance(3600e3 - 30e3);
  call(3, 'auction/bid', { id, amount: 100000 });
  clock.advance(45e3);
  assert.equal(g.settleAuctions(), 0);
  clock.advance(30e3);
  assert.equal(g.settleAuctions(), 1);
  assert.equal(car(call, 3, c).id, c);
});

test('pvp: both bets escrowed, faster car usually wins, winner gets pot minus fee', () => {
  const { mk, call, g, db } = setup();
  mk(1);
  mk(2);
  db.prepare('UPDATE users SET balance = 100000 WHERE id IN (1, 2)').run();
  const fast = g.giveCar(1, 'bugatti-chiron-super-sport').id;
  const slow = g.giveCar(2, 'zaz-968m-zaporozhets').id;
  const { id } = call(1, 'pvp/create', { carId: fast, bet: 10000 });
  assert.equal(call(2, 'pvp/accept', { id, carId: slow }).win, false);
  assert.equal(call(1, 'me').balance, 90000 + 19000);
});

test('weekly race: growth is measured from Monday and prizes are paid once', () => {
  const { mk, call, g, clock, db } = setup(Date.parse('2026-10-12T08:00:00Z'));
  mk(1);
  mk(2);
  call(1, 'me');
  call(2, 'me');
  g.giveCar(1, 'toyota-supra-a80');
  call(1, 'me');
  const lb = call(1, 'leaderboard', { type: 'week' });
  assert.equal(lb.list[0].id, 1);
  assert.equal(weekOf(Date.parse('2026-10-18T20:00:00Z')), '2026-10-12');
  clock.advance(7 * 86400e3);
  const bal = db.prepare('SELECT balance FROM users WHERE id = 1').get().balance;
  call(2, 'me');
  call(1, 'me');
  assert.equal(db.prepare('SELECT balance FROM users WHERE id = 1').get().balance, bal + S.WEEKLY_PRIZES[0]);
});

test('promo codes and stars payments', () => {
  const { mk, call, g } = setup();
  mk(1);
  mk(2);
  g.createPromo('start', 5000, 1);
  call(1, 'promo', { code: 'START' });
  assert.throws(() => call(2, 'promo', { code: 'start' }), /недійсний/);
  g.creditPayment({ chargeId: 'x', userId: 1, packId: 'p1', stars: 50 });
  g.creditPayment({ chargeId: 'x', userId: 1, packId: 'p1', stars: 50 });
  assert.equal(call(1, 'me').balance, S.START_BALANCE + 5000 + S.PACKS.find((p) => p.id === 'p1').amount * S.FIRST_BUY_MULT); // the first purchase ×3
});

test('referral pays when the friend reaches level 3', () => {
  const { g, call, db } = setup();
  g.ensureUser({ id: 1 });
  g.ensureUser({ id: 2 }, 'ref_1');
  assert.equal(call(2, 'me').balance, S.START_BALANCE + S.REF_FRIEND_BONUS);
  assert.equal(call(2, 'me').keys[S.REF_FRIEND_KEY], 1, 'the friend gets a free case');
  assert.ok(call(2, 'pulse').gifts.some((x) => x.kind === 'ref'), 'and a welcome window');
  const before = call(2, 'me').balance;
  db.prepare('UPDATE users SET xp = ? WHERE id = 2').run(S.xpForLevel(1) + S.xpForLevel(2));
  db.prepare('UPDATE users SET level = 1, xp = ? WHERE id = 2').run(S.xpForLevel(1) + S.xpForLevel(2) - 1);
  call(2, 'rewards/daily');
  assert.ok(call(2, 'me').level >= 3);
  assert.equal(call(1, 'me').balance, S.START_BALANCE + S.REF_REWARD);
  assert.ok(call(2, 'me').balance >= before + S.REF_FRIEND_L3, 'the friend gets a level-3 bonus too');
});

test('initData signature check', () => {
  const token = '123:ABC';
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42, first_name: 'Іван' }) };
  const good = signInitData(fields, token);
  assert.equal(verifyInitData(good, token).user.id, 42);
  assert.equal(verifyInitData(good, 'other'), null);
  assert.equal(verifyInitData(good.replace('42', '43'), token), null);
});

test('http api: auth, dev header, errors, static files', async () => {
  const app = createApp({ dbFile: ':memory:', dev: true, log: () => {} });
  const port = await app.start(0);
  const url = (p) => `http://localhost:${port}${p}`;
  const dev = { 'x-dev-user': encodeURIComponent(JSON.stringify({ id: 5, first_name: 'Тест' })), 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(url('/api/me'), { method: 'POST' })).status, 401);
    assert.equal((await (await fetch(url('/api/me'), { method: 'POST', headers: dev })).json()).id, 5);
    assert.equal((await fetch(url('/api/case/open'), { method: 'POST', headers: dev, body: '{"caseId":"nope"}' })).status, 400);
    assert.ok((await (await fetch(url('/api/config'))).json()).images);
    assert.equal((await fetch(url('/'))).status, 200);
    assert.equal((await fetch(url('/..%2fserver.js'))).status, 403);
  } finally {
    app.close();
  }
});

test('part cases: a 10 s pause between openings, checked by the server', () => {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-14T10:00:00Z');
  const g = createGame(db, { now: () => t, allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET balance = 1e12 WHERE id = 1').run();
  const pc = S.PART_CASES.find((c) => !c.randomOnly) || S.PART_CASES[0];
  const r = g.api['parts/open'](1, { caseId: pc.id, count: 1 });
  assert.equal(r.nextAt, t + S.PART_COOLDOWN_MS);
  assert.throws(() => g.api['parts/open'](1, { caseId: pc.id, count: 1 }), /Зачекай ще 10 с/);
  t += 9000;
  assert.throws(() => g.api['parts/open'](1, { caseId: pc.id, count: 1 }), /Зачекай ще 1 с/);
  t += 1000;
  g.api['parts/open'](1, { caseId: pc.id, count: 1 });
});
