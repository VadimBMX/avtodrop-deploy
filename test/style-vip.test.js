// Stars shop without progress (audit §2 №10, features 8–9): hryvnia packs off sale (old payments still credit), one
// starter pack, «Стиль» cosmetics (owned / worn / seen by others), VIP as a Telegram Stars subscription, the
// home-screen key and the emoji-status claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createBot } from '../src/bot.js';
import * as S from '../public/shared.js';

const DAY = 86400e3;
function setup(t0 = Date.parse('2026-10-22T10:00:00Z'), extra = {}) {
  const db = openDb(':memory:');
  let t = t0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true, ...extra });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, mk, call, advance: (ms) => (t += ms), at: () => t };
}
const payments = (db, uid) => db.prepare('SELECT charge_id, pack, stars, amount FROM payments WHERE user_id = ? ORDER BY rowid').all(uid);

test('shop: hryvnia packs are off sale, but old pack and item payments still credit (and refunds still work)', () => {
  const { db, g, mk, call } = setup();
  mk(1);
  assert.equal(S.PACKS_ON_SALE, false);
  const items = call(1, 'shop').items.map((i) => i.id);
  assert.ok(!items.some((id) => S.PACKS.some((p) => p.id === id)), 'no pack in the shop');
  assert.deepEqual(items.slice(0, 3), ['starter', 'vipsub', 'vip']);
  // An invoice for a pack made before the change, paid now: credited at the invoice amount, once.
  db.prepare('UPDATE users SET balance = 0 WHERE id = 1').run();
  g.creditPayment({ chargeId: 'old-p2', userId: 1, packId: 'p2', stars: 150, amount: 7000000 });
  assert.equal(call(1, 'me').balance, 7000000);
  assert.deepEqual(g.creditPayment({ chargeId: 'old-p2', userId: 1, packId: 'p2', stars: 150, amount: 7000000 }), { duplicate: true });
  // Old items keep working: VIP, the pass; a second pass is refunded.
  g.creditItem({ chargeId: 'i1', userId: 1, itemId: 'vip', stars: S.VIP.stars });
  assert.equal(call(1, 'me').vip, true);
  g.creditItem({ chargeId: 'i2', userId: 1, itemId: 'pass', stars: S.SEASON.premiumStars });
  assert.equal(g.creditItem({ chargeId: 'i3', userId: 1, itemId: 'pass', stars: S.SEASON.premiumStars }).refund, true);
  assert.deepEqual(payments(db, 1).map((p) => p.pack), ['p2', 'item:vip', 'item:pass', 'refund:pass']);
});

test('starter pack: one modest pack per account, a second payment is refunded', () => {
  const { db, g, mk, call } = setup();
  mk(1);
  mk(2);
  const st = S.SHOP_BY_ID.starter;
  assert.equal(st.name, 'Стартовий пакет');
  assert.ok(st.once && st.money <= 1500000, 'modest');
  db.prepare('UPDATE users SET balance = 0, stars = 500 WHERE id = 1').run();
  call(1, 'shop/stars', { item: 'starter' });
  assert.equal(call(1, 'me').balance, st.money);
  assert.equal(call(1, 'me').keys.city, 2);
  assert.throws(() => call(1, 'shop/stars', { item: 'starter' }), /лише один раз/);
  assert.throws(() => g.itemPrice(1, 'starter'), /лише один раз/);
  assert.equal(call(1, 'shop').starterBought, true);
  // By Telegram Stars: once; the second invoice paid back to back is refunded.
  g.creditItem({ chargeId: 'a', userId: 2, itemId: 'starter', stars: 99 });
  assert.deepEqual(g.creditItem({ chargeId: 'b', userId: 2, itemId: 'starter', stars: 99 }), { refund: true, item: 'starter' });
  assert.equal(call(2, 'me').balance, S.START_BALANCE + st.money);
});

test('«Стиль»: buy once, worn at once, put on / take off, seen by other players (card, rating, market, showcase)', () => {
  const { db, g, mk, call } = setup();
  mk(1);
  mk(2);
  call(1, 'case/open', { caseId: 'starter' });
  db.prepare('UPDATE users SET stars = 1000, balance = 1e9 WHERE id = 1').run();
  // Not owned: can't put it on.
  assert.throws(() => call(1, 'style/equip', { slot: 'frame', id: 'cos:x:frame-neon' }), /Спершу купи/);
  // Bought with account stars: owned (a claim, like season cosmetics) and worn right away.
  call(1, 'shop/stars', { item: 'frame-neon' });
  assert.equal(call(1, 'me').stars, 950);
  assert.ok(call(1, 'me').claims.includes('cos:x:frame-neon'));
  assert.equal(call(1, 'me').style.frame, 'cos:x:frame-neon');
  assert.throws(() => call(1, 'shop/stars', { item: 'frame-neon' }), /вже твій/);
  assert.throws(() => g.itemPrice(1, 'frame-neon'), /вже твій/);
  // Telegram payment for something owned already: refunded.
  assert.equal(g.creditItem({ chargeId: 'dup', userId: 1, itemId: 'frame-neon', stars: 50 }).refund, true);
  // By Telegram Stars: the name colour, worn at once.
  g.creditItem({ chargeId: 'n1', userId: 1, itemId: 'nm-gold', stars: 75 });
  call(1, 'shop/stars', { item: 'bg-city' });
  call(1, 'shop/stars', { item: 'gl-cyan' });
  assert.deepEqual(call(1, 'me').style, { frame: 'cos:x:frame-neon', showcase: 'cos:x:bg-city', name: 'cos:x:nm-gold', glow: 'cos:x:gl-cyan' });
  // Wrong slot, unknown slot.
  assert.throws(() => call(1, 'style/equip', { slot: 'name', id: 'cos:x:frame-neon' }), /не підходить/);
  assert.throws(() => call(1, 'style/equip', { slot: 'hat', id: '' }), /Невідомий слот/);
  // Others see it: the player card, the rating, the market lot.
  assert.deepEqual(call(2, 'player', { id: 1 }).style, call(1, 'me').style);
  db.prepare('UPDATE users SET season_id = 1, season_xp = 500 WHERE id = 1').run();
  const lb = call(2, 'leaderboard', { type: 'season' }).list.find((r) => r.id === 1);
  assert.equal(lb.style.name, 'cos:x:nm-gold');
  assert.equal(call(2, 'leaderboard', { type: 'all' }).list.find((r) => r.id === 1).style.frame, 'cos:x:frame-neon');
  const car = call(1, 'me').cars[0];
  db.prepare('UPDATE users SET slots = 10 WHERE id = 1').run();
  g.giveCar(1, car.model); // a second car, so the first can be listed
  call(1, 'market/sell', { carId: car.id, price: 5000 });
  const lot = call(2, 'market/list').list.find((l) => l.car.id === car.id);
  assert.equal(lot.sellerStyle.name, 'cos:x:nm-gold');
  assert.equal(lot.sellerStyle.frame, 'cos:x:frame-neon');
  assert.ok(call(2, 'market/list').list.filter((l) => l.dealer).every((l) => l.sellerStyle === null));
  // Take off: nobody sees it any more; put back on.
  call(1, 'style/equip', { slot: 'name', id: '' });
  assert.equal(call(2, 'player', { id: 1 }).style.name, null);
  call(1, 'style/equip', { slot: 'name', id: 'cos:x:nm-gold' });
  assert.equal(call(2, 'player', { id: 1 }).style.name, 'cos:x:nm-gold');
  // Looks only: buying cosmetics changed no stats, garage value or balance.
  assert.equal(call(1, 'me').balance, 1e9);
});

test('«Стиль» and season cosmetics share the slots: the season frame is on by default, a chosen one wins, off stays off', () => {
  const { db, mk, call } = setup();
  mk(1);
  db.prepare("INSERT INTO claims (user_id, key) VALUES (1, 'cos:s1:frame'), (1, 'cos:s1:showcase')").run();
  assert.equal(call(1, 'me').style.frame, 'cos:s1:frame', 'as before «Стиль»: the season frame is worn');
  assert.equal(call(1, 'me').style.showcase, 'cos:s1:showcase');
  db.prepare('UPDATE users SET stars = 100 WHERE id = 1').run();
  call(1, 'shop/stars', { item: 'frame-ua' });
  assert.equal(call(1, 'me').style.frame, 'cos:x:frame-ua');
  call(1, 'style/equip', { slot: 'frame', id: 'cos:s1:frame' });
  assert.equal(call(1, 'me').style.frame, 'cos:s1:frame');
  call(1, 'style/equip', { slot: 'showcase', id: '' });
  assert.equal(call(1, 'me').style.showcase, null, 'switched off, not back to the season default');
  // A broken style column never breaks the player.
  db.prepare("UPDATE users SET style = 'not json' WHERE id = 1").run();
  assert.equal(call(1, 'me').style.frame, 'cos:s1:frame');
});

test('«Стиль» liveries: locked until bought, then free on any own car (paint shop)', () => {
  const { db, mk, call, at } = setup();
  mk(1);
  mk(2);
  const c1 = call(1, 'case/open', { caseId: 'starter' }).results[0].car;
  const g = createGame(db, { now: at, random: () => 0.5, allUnlocked: true, paintable: new Set([c1.model]) });
  assert.throws(() => g.api['car/livery'](1, { carId: c1.id, livery: 'xneon' }), /«Стилі» за зірки/);
  db.prepare('UPDATE users SET stars = 150 WHERE id = 1').run();
  g.api['shop/stars'](1, { item: 'lv-neon' });
  const bal = g.api.me(1).balance;
  const r = g.api['car/livery'](1, { carId: c1.id, livery: 'xneon' });
  assert.equal(r.paid, 0);
  assert.equal(r.car.look.livery, 'xneon');
  assert.equal(g.api.me(1).balance, bal);
  assert.equal(S.liveryPrice(c1.model, 'xneon'), 0);
  assert.ok(S.ownedCosmetics(g.api.me(1).claims).some((c) => c.livery === 'xneon'), 'listed in the paint shop');
  // The look is public: another player sees the livery on the car.
  assert.equal(g.api.player(2, { id: 1 }).cars.find((c) => c.id === c1.id).look.livery, 'xneon');
});

test('VIP subscription: +30 days per paid period, each charge once, a second subscription refunded, cancel / resume', () => {
  const { db, g, mk, call, advance, at } = setup();
  mk(1);
  const t0 = at();
  const it = S.SHOP_BY_ID.vipsub;
  assert.ok(it.sub && it.stars >= 450 && it.stars <= 550 && it.vipDays === 30);
  assert.ok(it.stars < S.VIP.stars * 2, 'cheaper than two one-off VIPs');
  // First payment of the subscription.
  const r1 = g.creditItem({ chargeId: 's1', userId: 1, itemId: 'vipsub', stars: 499, recurring: true, first: true, expires: t0 + 30 * DAY });
  assert.equal(r1.vipUntil, t0 + 30 * DAY);
  assert.deepEqual(call(1, 'shop').sub, { active: true, canceled: false, expiresAt: t0 + 30 * DAY, stars: 499, renewals: 0, since: t0 });
  assert.equal(call(1, 'me').vip, true);
  // The same charge again (Telegram re-delivers an update): nothing changes.
  assert.deepEqual(g.creditItem({ chargeId: 's1', userId: 1, itemId: 'vipsub', stars: 499, recurring: true, first: true }), { duplicate: true });
  assert.equal(call(1, 'me').vipUntil, t0 + 30 * DAY);
  // No second subscription while one runs; not from account stars.
  assert.throws(() => g.itemPrice(1, 'vipsub'), /вже діє/);
  db.prepare('UPDATE users SET stars = 1000 WHERE id = 1').run();
  assert.throws(() => call(1, 'shop/stars', { item: 'vipsub' }), /лише через Telegram Stars/);
  // A renewal 30 days later (is_recurring without is_first_recurring): +30 days, once.
  advance(30 * DAY - 60e3);
  g.creditItem({ chargeId: 's2', userId: 1, itemId: 'vipsub', stars: 499, recurring: true, expires: t0 + 60 * DAY });
  assert.equal(call(1, 'me').vipUntil, t0 + 60 * DAY);
  assert.deepEqual(g.creditItem({ chargeId: 's2', userId: 1, itemId: 'vipsub', stars: 499, recurring: true, expires: t0 + 60 * DAY }), { duplicate: true });
  assert.equal(call(1, 'me').vipUntil, t0 + 60 * DAY, 'idempotent');
  let sub = call(1, 'shop').sub;
  assert.equal(sub.renewals, 1);
  assert.equal(sub.expiresAt, t0 + 60 * DAY);
  // A second subscription's first payment while this one runs: refunded and its renewals cancelled.
  assert.deepEqual(g.creditItem({ chargeId: 's3', userId: 1, itemId: 'vipsub', stars: 499, recurring: true, first: true }), { refund: true, item: 'vipsub', cancelSub: true });
  assert.equal(call(1, 'me').vipUntil, t0 + 60 * DAY);
  // Cancel / resume (server.js calls Telegram with the first charge's id, then this).
  assert.equal(g.vipSub(1).chargeId, 's1');
  assert.equal(g.vipSub(1).lastCharge, 's2');
  assert.equal(g.vipSubSet(1, true).sub.canceled, true);
  assert.equal(g.vipSubSet(1, false).sub.canceled, false);
  g.vipSubSet(1, true);
  assert.deepEqual(payments(db, 1).map((p) => p.pack), ['item:vipsub', 'renew:vipsub', 'refund:vipsub']);
  // The paid period ends with no renewal: VIP and the subscription end, a new one can be bought.
  advance(31 * DAY);
  assert.equal(call(1, 'shop').sub, null);
  assert.equal(call(1, 'me').vip, false);
  assert.equal(g.itemPrice(1, 'vipsub'), 499);
  assert.throws(() => g.vipSub(1), /немає/);
  // The one-off VIP stays as a fallback and stacks.
  call(1, 'shop/stars', { item: 'vip' });
  assert.equal(call(1, 'me').vip, true);
});

// The bot against a stubbed Telegram: updates in, Bot API calls out.
async function botRun(game, updates) {
  const calls = [];
  const realFetch = globalThis.fetch;
  let polls = 0, done;
  const finished = new Promise((r) => (done = r));
  let bot;
  globalThis.fetch = async (url, opt) => {
    const method = String(url).split('/').pop(), body = JSON.parse(opt.body || '{}');
    calls.push([method, body]);
    let result = true;
    if (method === 'getMe') result = { username: 'avtodrop_test_bot' };
    if (method === 'getMyDescription') result = { description: '' };
    if (method === 'getMyShortDescription') result = { short_description: '' };
    if (method === 'createInvoiceLink') result = 'https://t.me/$invoice';
    if (method === 'getUpdates') {
      polls++;
      result = polls === 1 ? updates.map((u, i) => ({ update_id: i + 1, ...u })) : [];
      if (polls === 2) (bot.stop(), done());
    }
    return { json: async () => ({ ok: true, result }) };
  };
  try {
    bot = createBot({ token: 'T', webappUrl: '', game, log: () => {} });
    await bot.start();
    await finished;
    return { calls, bot };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('bot: old packs declined at pre-checkout, the subscription accepted at its invoice price, renewals and refunds', async () => {
  const { g, mk, call, at } = setup();
  mk(5);
  const from = { id: 5, first_name: 'U5' };
  const pq = (id, payload, total) => ({ pre_checkout_query: { id, from, currency: 'XTR', total_amount: total, invoice_payload: payload } });
  const paid = (charge, payload, total, extra = {}) => ({ message: { message_id: 1, from, chat: { id: 5, type: 'private' }, successful_payment: { currency: 'XTR', total_amount: total, invoice_payload: payload, telegram_payment_charge_id: charge, ...extra } } });
  const exp = Math.floor(at() / 1000) + 30 * 86400;
  const { calls } = await botRun(g, [
    pq('q1', 'pack:p1:5:1500000', 50),
    pq('q2', 'item:vipsub:5:499', 499),
    pq('q3', 'item:frame-neon:5:50', 50),
    paid('c-old', 'pack:p1:5:1500000', 50), // a pack invoice approved before the change: still credited
    paid('c-sub1', 'item:vipsub:5:499', 499, { is_recurring: true, is_first_recurring: true, subscription_expiration_date: exp }),
    paid('c-sub2', 'item:vipsub:5:499', 499, { is_recurring: true, is_first_recurring: true, subscription_expiration_date: exp }),
    paid('c-fr', 'item:frame-neon:5:50', 50),
    pq('q4', 'item:frame-neon:5:50', 50), // owned now: declined with the reason
  ]);
  const answers = calls.filter(([m]) => m === 'answerPreCheckoutQuery').map(([, b]) => [b.pre_checkout_query_id, b.ok, b.error_message || '']);
  assert.deepEqual(answers.map((a) => a.slice(0, 2)), [['q1', false], ['q2', true], ['q3', true], ['q4', false]]);
  assert.match(answers[0][2], /більше не продаються/);
  assert.match(answers[3][2], /вже твій/);
  // Credited: the old pack's amount, VIP 30 days from the subscription, the frame; the second subscription refunded
  // and its renewal cancelled.
  assert.equal(call(5, 'me').balance, S.START_BALANCE + 1500000);
  assert.equal(call(5, 'shop').sub.active, true);
  assert.equal(call(5, 'me').style.frame, 'cos:x:frame-neon');
  const cancel = calls.find(([m]) => m === 'editUserStarSubscription');
  assert.deepEqual(cancel[1], { user_id: 5, telegram_payment_charge_id: 'c-sub2', is_canceled: true });
  assert.deepEqual(calls.filter(([m]) => m === 'refundStarPayment').map(([, b]) => b.telegram_payment_charge_id), ['c-sub2']);
});

test('bot: the VIP subscription invoice is a 30-day Stars subscription with a short title', async () => {
  const { g, mk } = setup();
  mk(5);
  const { calls, bot } = await botRun(g, []);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => (calls.push([String(url).split('/').pop(), JSON.parse(opt.body)]), { json: async () => ({ ok: true, result: 'https://t.me/$x' }) });
  try {
    await bot.itemInvoiceLink(5, 'vipsub', 499);
    await bot.itemInvoiceLink(5, 'pass', 250);
    await bot.itemInvoiceLink(5, 'frame-ua', 50);
    await bot.editStarSubscription(5, 'c1', false);
  } finally {
    globalThis.fetch = realFetch;
  }
  const inv = calls.filter(([m]) => m === 'createInvoiceLink').map(([, b]) => b);
  assert.equal(inv[0].subscription_period, 2592000);
  assert.equal(inv[0].payload, 'item:vipsub:5:499');
  assert.match(inv[0].description, /продовжується сам/);
  assert.equal(inv[1].subscription_period, undefined);
  for (const b of inv) assert.ok(b.title.length >= 1 && b.title.length <= 32, b.title);
  assert.equal(inv[2].title, 'Рамка «Синьо-жовта» · АВТОДРОП');
  assert.deepEqual(calls.at(-1), ['editUserStarSubscription', { user_id: 5, telegram_payment_charge_id: 'c1', is_canceled: false }]);
});

test('home-screen shortcut: offered from the 3rd day, one «Міський» key once', () => {
  const { db, mk, call } = setup();
  mk(1);
  assert.equal(call(1, 'me').homeOffer, false, 'day 1');
  assert.throws(() => call(1, 'home/added'), /з 3-го дня/);
  db.prepare("INSERT OR IGNORE INTO user_days (day, user_id) VALUES ('2026-10-20', 1), ('2026-10-21', 1), ('2026-10-22', 1)").run();
  assert.equal(call(1, 'me').homeOffer, true);
  const keys = call(1, 'me').keys.city || 0;
  assert.deepEqual(call(1, 'home/added'), { caseId: 'city', count: 1 });
  assert.equal(call(1, 'me').keys.city, keys + 1);
  assert.deepEqual(call(1, 'home/added'), { already: true });
  assert.equal(call(1, 'me').keys.city, keys + 1);
  assert.equal(call(1, 'me').homeOffer, false);
});

test('emoji status: recorded only for a player with the career badge', () => {
  const { db, mk, call } = setup();
  mk(1);
  assert.throws(() => call(1, 'emoji/set', { kind: 'career' }), /фінального боса/);
  assert.throws(() => call(1, 'emoji/set', { kind: 'other' }), /Невідомий/);
  db.prepare("INSERT INTO badges (user_id, key, title, tier, created_at) VALUES (1, 'boss', 'Бос усіх босів', 3, 0)").run();
  call(1, 'emoji/set', { kind: 'career' });
  call(1, 'emoji/set', { kind: 'career' });
  assert.ok(call(1, 'me').claims.includes('emoji:career'));
});
