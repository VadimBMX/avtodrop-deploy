// Wave E: the rewards center («Забрати все»), reward keys opened with the reel, season pass scaled by income,
// season cosmetics and the R34 season car.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

function setup(t0 = Date.parse('2026-10-22T10:00:00Z')) {
  const db = openDb(':memory:');
  let t = t0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, mk, call, advance: (ms) => (t += ms) };
}
const xpTo = (lvl) => {
  let t = 0;
  for (let l = 1; l < lvl; l++) t += S.passXpFor(l);
  return t;
};
// A player with something waiting everywhere: daily bonus, reward case, the day's tasks done, an achievement tier,
// season levels 2–6, a collection milestone.
function loaded({ db, mk, call }, uid) {
  mk(uid);
  call(uid, 'case/open', { caseId: 'starter' });
  db.prepare('UPDATE users SET season_xp = ?, season_id = 1, cases_opened = 12, slots = 30 WHERE id = ?').run(xpTo(6), uid);
  call(uid, 'quests');
  db.prepare('UPDATE quests SET progress = target WHERE user_id = ?').run(uid);
  const ins = db.prepare('INSERT OR IGNORE INTO collection (user_id, model, at) VALUES (?, ?, 0)');
  for (const m of S.ALL_MODELS.filter((x) => x.cls === 'D' && !x.secret).slice(0, 6)) ins.run(uid, m.id);
}

test('rewards center: «Забрати все» takes every ready reward once, a second call finds nothing', () => {
  const T = setup();
  const { call, db } = T;
  loaded(T, 1);
  const before = call(1, 'me');
  const questMoney = call(1, 'quests').list.reduce((n, x) => n + x.reward, 0);
  const r = call(1, 'rewards/all');
  for (const k of ['daily', 'rcase', 'quest', 'ach', 'pass', 'coll']) assert.ok(r.kinds.includes(k), 'claimed: ' + k);
  const after = call(1, 'me');
  assert.equal(r.money, after.balance - before.balance, 'the money reported is what landed');
  assert.ok(r.money >= questMoney + [2, 3, 4, 5, 6].reduce((n, l) => n + S.passMoneyFor(l), 0), 'tasks and pass money paid');
  assert.equal(after.dailyReady, false);
  assert.ok(call(1, 'quests').list.every((x) => x.claimed));
  assert.equal(call(1, 'season').ready, 0);
  assert.ok(after.claims.includes('cos:s1:livery'), 'level 5 of the pass: the season livery');
  // The «Міський» key of pass level 5 comes back as a key to reveal (it stays a key until the app opens it).
  assert.ok(r.reveal.some((x) => x.kind === 'key' && x.caseId === 'city'));
  assert.equal(r.reveal[0].kind, 'rcase', 'the reward case spins first');
  // Nothing twice: the whole call and every single claim.
  assert.throws(() => call(1, 'rewards/all'), /Немає нагород/);
  assert.throws(() => call(1, 'rewards/daily'), /вже забрано/);
  assert.throws(() => call(1, 'rewards/case'), /ще не готовий/);
  assert.throws(() => call(1, 'season/claim'), /Немає нових нагород/);
  assert.throws(() => call(1, 'ach/claim'), /Немає нових досягнень/);
  assert.throws(() => call(1, 'quests/claim', { key: call(1, 'quests').list[0].key }), /вже отримано/);
  assert.equal(call(1, 'me').balance, after.balance);
  // pulse has no reward claims left (only what is not a reward may remain)
  const kinds = call(1, 'pulse').claims.map((c) => c.kind);
  assert.ok(!kinds.some((k) => ['daily', 'rcase', 'quest', 'ach', 'achAll', 'pass', 'coll', 'newbie'].includes(k)), kinds.join());
  db.close();
});

test('rewards center: a claim taken on its own before is skipped, the rest still paid', () => {
  const T = setup();
  const { call } = T;
  loaded(T, 2);
  call(2, 'season/claim');
  call(2, 'rewards/daily');
  const r = call(2, 'rewards/all');
  assert.ok(!r.kinds.includes('pass') && !r.kinds.includes('daily'));
  assert.ok(r.kinds.includes('quest'));
  assert.throws(() => call(2, 'rewards/all'), /Немає нагород/);
});

test('rewards center: nothing ready → an error, nothing changes', () => {
  const { mk, call } = setup();
  mk(3);
  call(3, 'rewards/all'); // daily + reward case of a fresh player
  const bal = call(3, 'me').balance;
  assert.throws(() => call(3, 'rewards/all'), /Немає нагород/);
  assert.equal(call(3, 'me').balance, bal);
});

test('reward keys open only with a key: keyOnly never charges', () => {
  const { mk, call } = setup();
  mk(4);
  call(4, 'case/open', { caseId: 'starter' });
  const bal = call(4, 'me').balance;
  assert.throws(() => call(4, 'case/open', { caseId: 'rust', count: 1, keyOnly: true }), /Ключа «Іржавий гараж» вже немає/);
  assert.equal(call(4, 'me').balance, bal);
});

test('daily bonus: case days say what the case gives', () => {
  assert.equal(S.dailyText(S.DAILY_BONUS[6]), 'Кейс «Спорткар» (машина B–S)');
  assert.equal(S.dailyText(S.DAILY_BONUS[13]), 'Кейс «Еліта» (машина A–S)');
  assert.equal(S.dailyText(S.DAILY_BONUS[4]), 'Машина класу C');
  assert.ok(!S.DAILY_BONUS.some((d) => /Машина з/.test(d.label || '')), 'no «Машина зі «Спорткара»» any more');
});

test('season pass: money scales with the garage income, never below the base (45 тис at level 2)', () => {
  assert.equal(S.passMoneyFor(2), 45000);
  assert.equal(S.passMoneyFor(2, 100000), 45000, 'a casual garage gets the base');
  for (let l = 2; l <= 30; l++) assert.ok(S.passMoneyFor(l, 3500000) >= S.passMoneyFor(l), 'never below the base');
  assert.equal(S.passMoneyFor(2, 3500000), 1000000, '0,29 h of 3,5 млн/год');
  assert.equal(S.passMoneyFor(30, 3500000), 5400000, '1,55 h at level 30');
  assert.equal(S.passMoneyFor(30, 1e12), S.passMoneyFor(30, S.SEASON_RATE_CAP), 'income above the cap counts as the cap');
  assert.equal(S.passReward(1, 4, true, 3500000).money, S.passMoneyFor(4, 3500000), 'premium money scales too');
  // Free track: cosmetics every 5 levels, the R34 at premium 30.
  assert.deepEqual([5, 10, 15, 20, 25].map((l) => S.cosmeticOf(S.passReward(1, l, false).cosmetic).kind), ['livery', 'frame', 'showcase', 'gold', 'badge']);
  assert.equal(S.MODELS[S.passReward(1, 30, true).seasonCar].name, 'BMW X5 M E70 «Monte Carlo Blue»');
  assert.ok(S.MODELS['bmw-x5-m-e70-monte-carlo-blue'], 'the old season car stays a valid model');
});

test('season pass: a rich garage gets the scaled money, the season page shows the same sums', () => {
  const { db, mk, call } = setup();
  mk(5);
  const ins = db.prepare("INSERT INTO cars (owner_id, model, tank, tank_at, created_at, dirt_at) VALUES (5, ?, 5, 0, 0, 0)");
  for (const m of S.ALL_MODELS.filter((x) => x.cls === 'D' && !x.secret).slice(0, 20)) ins.run(m.id);
  db.prepare('UPDATE users SET slots = 30, season_xp = ?, season_id = 1 WHERE id = 5').run(xpTo(4));
  const rate = call(5, 'me').income.rate;
  assert.ok(rate > 0);
  const s = call(5, 'season');
  assert.equal(s.rate, rate);
  assert.equal(s.levels.find((l) => l.level === 3).free.money, S.passMoneyFor(3, rate));
  const bal = call(5, 'me').balance;
  const r = call(5, 'season/claim');
  assert.equal(r.money, [2, 3, 4].reduce((n, l) => n + S.passMoneyFor(l, rate), 0));
  assert.equal(call(5, 'me').balance, bal + r.money);
});

test('season cosmetics: the livery is free on own cars once earned, locked for others; the badge goes to the profile', () => {
  const { db, mk, call } = setup();
  mk(6);
  mk(7);
  const car6 = call(6, 'case/open', { caseId: 'starter' }).results[0].car;
  const car7 = call(7, 'case/open', { caseId: 'starter' }).results[0].car;
  const g = createGame(db, { now: () => Date.parse('2026-10-22T10:00:00Z'), random: () => 0.5, allUnlocked: true, paintable: new Set([car6.model, car7.model]) });
  db.prepare('UPDATE users SET season_xp = ?, season_id = 1 WHERE id = 6').run(xpTo(25));
  g.api['season/claim'](6, {});
  const me6 = g.api.me(6, {});
  for (const k of ['livery', 'frame', 'showcase', 'gold', 'badge']) assert.ok(me6.claims.includes(`cos:s1:${k}`), k);
  assert.ok(me6.badges.some((b) => b.title === 'Сезон 1 · пропуск'));
  const bal = me6.balance;
  const r = g.api['car/livery'](6, { carId: car6.id, livery: 'szn1' });
  assert.equal(r.paid, 0);
  assert.equal(r.car.look.livery, 'szn1');
  assert.equal(g.api.me(6, {}).balance, bal);
  assert.throws(() => g.api['car/livery'](7, { carId: car7.id, livery: 'szn1g' }), /нагорода сезонного пропуску/);
  assert.equal(S.liveryPrice(car6.model, 'szn1g'), 0);
  assert.ok(S.liveryPrice(car6.model, 'stripes') > 0);
});
