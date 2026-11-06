// r11 «Зірковий кейс» (David 06.11): 50 real Telegram Stars → 10…1000 virtual ⭐ on users.star_credit (ECON.starCase,
// S.STAR_CASE; src/game.js creditItem / starCaseRoll / starCasePending; src/season2.js creditBuy), and the admin
// grant / take-back of virtual stars (admin 'star-credit' → POST /api/admin/star-credit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { ECON } from '../public/econ.js';
import { installSeason2, s2CreditCard } from '../public/season2-ui.js';

function setup() {
  const t = Date.parse('2026-11-06T10:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {}, random: () => 0.5, allUnlocked: true, partCooldownMs: 0 });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a).map((r) => ({ ...r }));
  const mk = (id, level = 3) => {
    g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id });
    run('UPDATE users SET level = ?, level_seen = ? WHERE id = ?', level, level, id);
    return id;
  };
  return { db, g, call, run, get, all, mk };
}
const credit = (T, u) => T.get('SELECT star_credit c FROM users WHERE id = ?', u).c;

test('star case: the table — chances sum to 100%, EV below the 50 ⭐ price', () => {
  const c = ECON.starCase;
  assert.equal(c.stars, 50);
  const sum = c.prizes.reduce((s, [, p]) => s + p, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9, `chances sum to ${sum}`);
  const ev = c.prizes.reduce((s, [n, p]) => s + (n * p) / 100, 0);
  assert.ok(Math.abs(ev - 44.65) < 1e-9, `EV ${ev}`);
  assert.ok(ev < c.stars, 'EV below the price: the house keeps a margin, nothing to farm');
  assert.equal(S.STAR_CASE.ev, ev);
  assert.deepEqual([S.STAR_CASE.min, S.STAR_CASE.max], [10, 1000]);
  assert.deepEqual(c.prizes.map(([n]) => n), [10, 20, 30, 50, 75, 150, 500, 1000]);
  const it = S.SHOP_BY_ID.starcase;
  assert.ok(it && it.realOnly && it.starcase && it.stars === 50);
  assert.ok(!S.SHOP_ITEMS.includes(it), 'not in the generic item list — its own card');
});

test('star case: one paid charge = one roll onto the credit, a repeat of the charge is a duplicate', () => {
  const T = setup();
  const u = T.mk(10);
  assert.equal(T.g.itemPrice(u, 'starcase'), 50, 'the pre-checkout price');
  const r = T.g.creditItem({ chargeId: 'ch-a', userId: u, itemId: 'starcase', stars: 50 });
  assert.ok(S.STAR_CASE.prizes.some(([n]) => n === r.won), `won ${r.won}`);
  assert.equal(credit(T, u), r.won);
  assert.equal(r.starCredit, r.won);
  for (let i = 0; i < 3; i++) assert.equal(T.g.creditItem({ chargeId: 'ch-a', userId: u, itemId: 'starcase', stars: 50 }).duplicate, true);
  assert.equal(credit(T, u), r.won, 'the same charge never rolls twice');
  assert.equal(T.all("SELECT * FROM star_credit_log WHERE user_id = ? AND what = 'starcase'", u).length, 1);
  assert.equal(T.all('SELECT * FROM star_case_rolls WHERE user_id = ?', u).length, 1);
  assert.equal(T.get('SELECT pack FROM payments WHERE charge_id = ?', 'ch-a').pack, 'item:starcase');
  const r2 = T.g.creditItem({ chargeId: 'ch-b', userId: u, itemId: 'starcase', stars: 50 });
  assert.equal(credit(T, u), r.won + r2.won, 'a second paid charge rolls again');
  const log = T.all("SELECT delta, balance FROM star_credit_log WHERE user_id = ? AND what = 'starcase' ORDER BY id", u);
  assert.deepEqual(log, [{ delta: r.won, balance: r.won }, { delta: r2.won, balance: r.won + r2.won }]);
  // the reveal: both rolls once, then nothing
  const p = T.call(u, 'starcase/pending', {});
  assert.deepEqual(p.list.map((x) => x.won), [r.won, r2.won]);
  assert.equal(p.starCredit, r.won + r2.won);
  assert.equal(T.call(u, 'starcase/pending', {}).list.length, 0);
  assert.ok(T.all('SELECT text FROM events WHERE user_id = ?', u).some((e) => e.text.includes(`+${r.won} ⭐ на баланс`)));
});

test('star case: the roll is the fair case RNG and follows the table', () => {
  const T = setup();
  const u = T.mk(11);
  const seen = new Map();
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const n0 = T.get('SELECT nonce FROM users WHERE id = ?', u).nonce;
    const r = T.g.creditItem({ chargeId: 'c' + i, userId: u, itemId: 'starcase', stars: 50 });
    assert.equal(T.get('SELECT nonce FROM users WHERE id = ?', u).nonce, n0 + 1, 'one fair nonce per roll');
    seen.set(r.won, (seen.get(r.won) || 0) + 1);
  }
  assert.equal(seen.get(10) > N * 0.25 && seen.get(10) < N * 0.35, true, `10 ⭐ ${seen.get(10)}`);
  const total = [...seen].reduce((s, [n, k]) => s + n * k, 0);
  assert.equal(credit(T, u), total);
  for (const k of seen.keys()) assert.ok(S.STAR_CASE.prizes.some(([n]) => n === k));
});

test('star case: the credit and the stars on the account cannot buy it (no stars → credit → case loop)', () => {
  const T = setup();
  const u = T.mk(12);
  T.run('UPDATE users SET star_credit = 5000, stars = 5000 WHERE id = ?', u);
  assert.throws(() => T.call(u, 'shop/credit', { item: 'starcase' }), /лише за справжні Telegram Stars/);
  assert.throws(() => T.call(u, 'shop/credit', { item: 'starcase', confirm: true }), /лише за справжні Telegram Stars/);
  assert.throws(() => T.call(u, 'shop/stars', { item: 'starcase' }), /лише за справжні Telegram Stars/);
  assert.equal(credit(T, u), 5000);
  assert.equal(T.get('SELECT stars FROM users WHERE id = ?', u).stars, 5000);
  assert.equal(T.all('SELECT * FROM star_case_rolls').length, 0);
  // the app never offers the credit for it either
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const buy = app.slice(app.indexOf('H.buyStarCase = async'), app.indexOf('// r5-frames: «Рамки профілю»'));
  assert.ok(buy.includes("api('shop/invoice'") && !buy.includes('s2PayCredit('), 'the star case opens a Telegram invoice only');
});

test('star credit pays for every other shop item: it adds no rule of its own beyond the item rules', () => {
  const T = setup();
  const u = T.mk(13, 20);
  T.run('UPDATE users SET star_credit = 100000 WHERE id = ?', u);
  for (const id of Object.keys(S.SHOP_BY_ID)) {
    let priceErr = null, creditErr = null;
    try { T.g.itemPrice(u, id); } catch (e) { priceErr = e.message; }
    try { T.call(u, 'shop/credit', { item: id }); } catch (e) { creditErr = e.message; }
    if (S.SHOP_BY_ID[id].realOnly) assert.match(creditErr, /Telegram Stars/, id);
    else assert.equal(creditErr, priceErr, `${id}: the credit refuses only what an invoice would refuse`);
  }
  // and it really buys: a style item, a frame, VIP
  const style = S.STYLE_ITEMS[0], frame = S.FRAME_SHOP_ITEMS[0];
  for (const id of [style.id, frame.id, 'vip', 'vipsub']) assert.ok(T.call(u, 'shop/credit', { item: id, confirm: true }).paid > 0, id);
});

test('the shop shows the virtual balance (also at 0) and the star case card with its odds', () => {
  const T = setup();
  const u = T.mk(14);
  const sh0 = T.call(u, 'shop');
  assert.equal(sh0.starCredit, 0);
  assert.deepEqual(sh0.starCase, { id: 'starcase', price: 50, min: 10, max: 1000, prizes: ECON.starCase.prizes });
  installSeason2({ H: {}, ic: (n) => `<i:${n}>`, me: () => ({}) });
  assert.match(s2CreditCard(sh0), /Баланс: 0 ⭐ \(віртуальні\)/);
  T.g.creditItem({ chargeId: 'x1', userId: u, itemId: 'starcase', stars: 50 });
  const sh = T.call(u, 'shop');
  assert.ok(sh.starCredit >= 10);
  assert.ok(s2CreditCard(sh).includes(`Баланс: ${sh.starCredit} ⭐ (віртуальні)`));
  assert.equal(T.call(u, 'me').starCredit, sh.starCredit);
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('Зірковий кейс · ${c.price} ⭐ · випадає від ${c.min} до ${c.max} ⭐ на баланс магазину'));
  assert.ok(app.includes('data-act="starCaseOdds"') && app.includes('+${won} ⭐ на баланс'));
});

test('admin star-credit: grant, take back (never below 0), log, event, rights', () => {
  const T = setup();
  const u = T.mk(20), adm = T.mk(30), helper = T.mk(31);
  T.g.adminCall('tg:1', 'role', { id: adm, role: 'admin', confirm: true, reason: 'test' });
  T.g.adminCall('tg:1', 'role', { id: helper, role: 'helper', confirm: true, reason: 'test' });
  assert.throws(() => T.g.adminCall(`tg:${adm}`, 'star-credit', { userId: u, delta: 50, reason: 'компенсація' }), /не підтверджено/);
  assert.throws(() => T.g.adminCall(`tg:${adm}`, 'star-credit', { userId: u, delta: 50, confirm: true }), /причину/);
  assert.throws(() => T.g.adminCall(`tg:${helper}`, 'star-credit', { userId: u, delta: 50, reason: 'xxx', confirm: true }), /Немає прав/);
  assert.throws(() => T.g.adminCall(`tg:${adm}`, 'star-credit', { userId: adm, delta: 50, reason: 'xxx', confirm: true }), /Свій акаунт/);
  const r = T.g.adminCall(`tg:${adm}`, 'star-credit', { userId: u, delta: 50, reason: 'компенсація', confirm: true });
  assert.deepEqual(r, { starCredit: 50, delta: 50 });
  assert.ok(T.all('SELECT text FROM events WHERE user_id = ?', u).some((e) => e.text === '⭐ +50 віртуальних зірок від адміністрації'));
  const r2 = T.g.adminCall(`tg:${adm}`, 'star-credit', { userId: u, delta: -80, reason: 'помилка', confirm: true });
  assert.deepEqual(r2, { starCredit: 0, delta: -50 }, 'never below 0');
  assert.throws(() => T.g.adminCall(`tg:${adm}`, 'star-credit', { userId: u, delta: -1, reason: 'ще раз', confirm: true }), /вже 0/);
  assert.throws(() => T.g.adminCall(`tg:${adm}`, 'star-credit', { userId: u, delta: 0, reason: 'ще раз', confirm: true }), /Вкажи/);
  assert.equal(credit(T, u), 0);
  const log = T.all('SELECT delta, what, balance FROM star_credit_log WHERE user_id = ? ORDER BY id', u);
  assert.deepEqual(log, [{ delta: 50, what: 'admin: компенсація', balance: 50 }, { delta: -50, what: 'admin: помилка', balance: 0 }]);
  assert.equal(T.g.adminCall('tg:1', 'user', { id: u }).user.starCredit, 0, 'the admin player card shows it');
  // the owner needs no reason (like every other action), only the confirm
  assert.equal(T.g.adminCall('tg:1', 'star-credit', { userId: u, delta: 7, confirm: true }).starCredit, 7);
  const admin = fs.readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  assert.ok(admin.includes('id="act-scredit"') && admin.includes("mutate('star-credit', { userId: uid(), delta }"));
});
