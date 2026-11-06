// «Ефект дропу» (r5-shop, owner 06.11): four case-open effects for 120 ⭐ each, kept for good, one worn at a time,
// a private slot (only in me, not in the public style). Same Stars shop path as «Стиль»: account stars, a Telegram
// invoice (pre-checkout + payment through the bot), the Season 2 star credit; a second payment for an owned one is refunded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createBot } from '../src/bot.js';
import * as S from '../public/shared.js';

function setup() {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-11-06T10:00:00Z'), notify: () => {}, random: () => 0.5, allUnlocked: true });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, mk, call };
}

test('dropfx: four 120 ⭐ items in the Stars shop, a private slot (not in the public style)', () => {
  assert.deepEqual(S.DROPFX_ITEMS.map((x) => x.id), ['fx-gold', 'fx-bolt', 'fx-fire', 'fx-chrome']);
  for (const it of S.DROPFX_ITEMS) {
    assert.equal(S.SHOP_BY_ID[it.id], it);
    assert.equal(it.stars, 120);
    assert.equal(it.cos, 'cos:x:' + it.id);
    assert.equal(S.cosmeticOf(it.cos).kind, 'dropfx');
  }
  assert.ok(!S.STYLE_SLOTS.includes('dropfx'), 'other players never see it');
  const { g, mk, call } = setup();
  mk(1);
  assert.equal(g.itemPrice(1, 'fx-gold'), 120);
  assert.equal(call(1, 'me').dropfx, null);
  assert.ok(!('dropfx' in call(1, 'me').style));
});

test('dropfx: buy with account stars → owned and worn; double buy refused; equip / switch / take off; others see nothing', () => {
  const { db, g, mk, call } = setup();
  mk(1);
  mk(2);
  db.prepare('UPDATE users SET stars = 500 WHERE id = 1').run();
  assert.throws(() => call(1, 'style/equip', { slot: 'dropfx', id: 'cos:x:fx-gold' }), /Спершу купи/);
  call(1, 'shop/stars', { item: 'fx-gold' });
  assert.equal(call(1, 'me').stars, 380);
  assert.ok(call(1, 'me').claims.includes('cos:x:fx-gold'));
  assert.equal(call(1, 'me').dropfx, 'cos:x:fx-gold', 'worn at once');
  // A second buy: refused before any stars move.
  assert.throws(() => call(1, 'shop/stars', { item: 'fx-gold' }), /вже твій/);
  assert.throws(() => g.itemPrice(1, 'fx-gold'), /вже твій/);
  assert.equal(call(1, 'me').stars, 380);
  // A second effect: one worn at a time (the new one replaces the old).
  call(1, 'shop/stars', { item: 'fx-bolt' });
  assert.equal(call(1, 'me').dropfx, 'cos:x:fx-bolt');
  const r = call(1, 'style/equip', { slot: 'dropfx', id: 'cos:x:fx-gold' });
  assert.equal(r.dropfx, 'cos:x:fx-gold');
  assert.equal(call(1, 'me').dropfx, 'cos:x:fx-gold');
  call(1, 'style/equip', { slot: 'dropfx', id: '' });
  assert.equal(call(1, 'me').dropfx, null);
  // Wrong slot both ways; not owned.
  assert.throws(() => call(1, 'style/equip', { slot: 'dropfx', id: 'cos:x:frame-neon' }), /не підходить/);
  assert.throws(() => call(1, 'style/equip', { slot: 'name', id: 'cos:x:fx-gold' }), /не підходить/);
  assert.throws(() => call(1, 'style/equip', { slot: 'dropfx', id: 'cos:x:fx-fire' }), /Спершу купи/);
  // Wearing an effect doesn't touch the public look and isn't shown on the player card.
  call(1, 'style/equip', { slot: 'dropfx', id: 'cos:x:fx-bolt' });
  assert.equal(call(2, 'player', { id: 1 }).dropfx, undefined);
  assert.deepEqual(Object.keys(call(2, 'player', { id: 1 }).style).sort(), [...S.STYLE_SLOTS].sort());
  // Other slots are kept when the effect changes.
  db.prepare('UPDATE users SET stars = 500 WHERE id = 1').run();
  call(1, 'shop/stars', { item: 'nm-gold' });
  call(1, 'style/equip', { slot: 'dropfx', id: 'cos:x:fx-gold' });
  assert.equal(call(1, 'me').style.name, 'cos:x:nm-gold');
});

test('dropfx: Telegram payment credits and wears it; a second payment for it is refunded', () => {
  const { db, g, mk, call } = setup();
  mk(1);
  const out = g.creditItem({ chargeId: 'fx1', userId: 1, itemId: 'fx-fire', stars: 120 });
  assert.equal(out.cosmetic, 'cos:x:fx-fire');
  assert.equal(call(1, 'me').dropfx, 'cos:x:fx-fire');
  assert.deepEqual(g.creditItem({ chargeId: 'fx1', userId: 1, itemId: 'fx-fire', stars: 120 }), { duplicate: true });
  assert.equal(g.creditItem({ chargeId: 'fx2', userId: 1, itemId: 'fx-fire', stars: 120 }).refund, true);
  assert.deepEqual(db.prepare('SELECT pack FROM payments WHERE user_id = 1 ORDER BY rowid').all().map((r) => r.pack), ['item:fx-fire', 'refund:fx-fire']);
});

test('dropfx: the Season 2 star credit buys it like an invoice (and not twice)', () => {
  const { db, mk, call } = setup();
  mk(1);
  db.prepare('UPDATE users SET star_credit = 200 WHERE id = 1').run();
  assert.deepEqual(call(1, 'shop/credit', { item: 'fx-chrome' }), { price: 120, credit: 200, enough: true });
  call(1, 'shop/credit', { item: 'fx-chrome', confirm: true });
  assert.equal(call(1, 'me').starCredit, 80);
  assert.equal(call(1, 'me').dropfx, 'cos:x:fx-chrome');
  assert.throws(() => call(1, 'shop/credit', { item: 'fx-chrome', confirm: true }), /вже твій/);
  assert.equal(call(1, 'shop/credit', { item: 'fx-gold' }).enough, false);
  assert.throws(() => call(1, 'shop/credit', { item: 'fx-gold', confirm: true }), /не вистачає/);
  assert.equal(call(1, 'me').starCredit, 80);
});

test('dropfx: the bot invoice (title ≤ 32), pre-checkout accepts, payment credits, a pre-checkout for an owned one is declined', async () => {
  const { g, mk, call } = setup();
  mk(5);
  const from = { id: 5, first_name: 'U5' };
  const calls = [];
  const realFetch = globalThis.fetch;
  let polls = 0, done, bot;
  const finished = new Promise((r) => (done = r));
  const updates = [
    { pre_checkout_query: { id: 'q1', from, currency: 'XTR', total_amount: 120, invoice_payload: 'item:fx-gold:5:120' } },
    { message: { message_id: 1, from, chat: { id: 5, type: 'private' }, successful_payment: { currency: 'XTR', total_amount: 120, invoice_payload: 'item:fx-gold:5:120', telegram_payment_charge_id: 'c-fx' } } },
    { pre_checkout_query: { id: 'q2', from, currency: 'XTR', total_amount: 120, invoice_payload: 'item:fx-gold:5:120' } },
  ];
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
    bot = createBot({ token: 'T', webappUrl: '', game: g, log: () => {} });
    await bot.start();
    await finished;
    for (const it of S.DROPFX_ITEMS) await bot.itemInvoiceLink(5, it.id, it.stars);
  } finally {
    globalThis.fetch = realFetch;
  }
  const ans = calls.filter(([m]) => m === 'answerPreCheckoutQuery').map(([, b]) => [b.pre_checkout_query_id, b.ok]);
  assert.deepEqual(ans, [['q1', true], ['q2', false]]);
  assert.equal(call(5, 'me').dropfx, 'cos:x:fx-gold');
  const inv = calls.filter(([m]) => m === 'createInvoiceLink').map(([, b]) => b);
  assert.equal(inv.length, 4);
  for (const b of inv) {
    assert.ok(b.title.length >= 1 && b.title.length <= 32, b.title);
    assert.equal(b.prices[0].amount, 120);
    assert.match(b.payload, /^item:fx-[a-z]+:5:120$/);
  }
});
