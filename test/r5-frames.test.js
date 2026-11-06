// r5-frames: profile frames drawn in code (public/frames.js) and the premium animated frames sold for Telegram Stars
// (S.FRAME_SHOP_ITEMS → S.SHOP_BY_ID; src/game.js itemPrice / applyItem / creditItem; the star credit, src/season2.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as F from '../public/frames.js';

function setup() {
  const t = Date.parse('2026-11-06T10:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {}, random: () => 0.5, allUnlocked: true, partCooldownMs: 0 });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const mk = (id, level = 3) => {
    g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id });
    run('UPDATE users SET level = ?, level_seen = ? WHERE id = ?', level, level, id);
    return id;
  };
  return { db, g, call, run, get, mk };
}

test('frames: every profile frame is drawn in code, no picture left behind', () => {
  const ids = new Set(F.frameIds());
  for (const f of S.PROFILE_FRAMES) {
    assert.ok(ids.has(f.id), `${f.id} has a drawing`);
    assert.equal(f.img, undefined, `${f.id}: no webp any more`);
    const h = F.frameHtml(f.id);
    assert.match(h, new RegExp(`class="pf pf-${f.id}"`));
    assert.ok(h.length < 12000, `${f.id}: light enough for 30+ rows (${h.length})`);
  }
  assert.match(F.frameHtml('__proto__'), /pf-rust/, 'unknown → the free «Іржа»');
  assert.match(F.frameHtml('fire', { live: true }), /data-live/);
  assert.doesNotMatch(F.frameHtml('fire'), /data-live/, 'rows get the still pose');
  assert.ok(!fs.existsSync(new URL('../public/s2/fr', import.meta.url)), 'the old webp frames are gone');
});

test('premium frames: six Stars items, 100 ⭐ each, kept for good (own)', () => {
  const want = { fire: 'Вогонь', neon_pulse: 'Неон-пульс', lightning: 'Блискавка', gold_pure: 'Чисте золото', ice: 'Лід', carbon: 'Карбон' };
  assert.deepEqual(S.FRAME_SHOP_ITEMS.map((it) => it.pframe), Object.keys(want));
  for (const it of S.FRAME_SHOP_ITEMS) {
    const f = S.FRAME_BY_ID[it.pframe];
    assert.equal(f.name, want[f.id]);
    assert.ok(f.own && f.anim && !f.soon && f.shop === it.id);
    assert.equal(it.stars, 100);
    assert.equal(S.SHOP_BY_ID[it.id], it);
    assert.ok(`${it.name} · АВТОДРОП`.length <= 32 || it.name.length <= 32, 'fits a Telegram invoice title');
    assert.equal(S.frameAllowed(it.pframe, { level: 99, vip: true, clubOwner: true }), false, 'not by level / VIP / club');
    assert.equal(S.frameAllowed(it.pframe, { owned: [it.pframe] }), true);
  }
  // the level ladder and the specials keep their ids and rules
  assert.deepEqual(S.PROFILE_FRAMES.filter((f) => f.lvl).map((f) => [f.id, f.lvl]), [['rust', 1], ['steel', 5], ['racer', 10], ['gold', 15], ['neon', 20], ['smoke', 30], ['inferno', 40]]);
  for (const id of ['vip', 'club_leader', 'patron', 'legend_s1', 'veteran_s1', 'season2', 'king']) assert.ok(S.FRAME_BY_ID[id], id);
});

test('premium frames: a Telegram payment grants and wears it; can not be bought twice; a second invoice is refunded', () => {
  const T = setup();
  const u = T.mk(10);
  assert.equal(T.g.itemPriceTx ? T.g.itemPriceTx(u, 'pf-fire') : 100, 100);
  assert.throws(() => T.call(u, 'frames/equip', { id: 'fire' }), /ще немає/);
  const r = T.g.creditItem({ chargeId: 'ch-1', userId: u, itemId: 'pf-fire', stars: 100 });
  assert.equal(r.frame, 'fire');
  assert.equal(T.get('SELECT source FROM user_frames WHERE user_id = ? AND frame = ?', u, 'fire').source, 'shop');
  const me = T.call(u, 'me');
  assert.equal(me.frame, 'fire', 'worn at once');
  assert.ok(me.frames.includes('fire'));
  assert.equal(T.call(u, 'frames').list.find((f) => f.id === 'fire').allowed, true);
  // can't buy twice: the price check fails, a second paid invoice is refunded (nothing granted twice)
  assert.throws(() => T.call(u, 'shop/credit', { item: 'pf-fire' }), /вже твоя/);
  assert.equal(T.g.creditItem({ chargeId: 'ch-1', userId: u, itemId: 'pf-fire', stars: 100 }).duplicate, true);
  assert.equal(T.g.creditItem({ chargeId: 'ch-2', userId: u, itemId: 'pf-fire', stars: 100 }).refund, true);
  assert.equal(T.get('SELECT COUNT(*) n FROM user_frames WHERE user_id = ?', u).n, 1);
  // kept: take it off, put another on, then back
  T.call(u, 'frames/equip', { id: 'rust' });
  assert.equal(T.call(u, 'frames/equip', { id: 'fire' }).equipped, 'fire');
  // others see it
  const v = T.mk(11);
  assert.equal(T.call(v, 'player', { id: u }).frame, 'fire');
});

test('premium frames: the star credit and the stars on the account pay too, same checks', () => {
  const T = setup();
  const u = T.mk(20);
  T.run('UPDATE users SET star_credit = 150 WHERE id = ?', u);
  assert.deepEqual(T.call(u, 'shop/credit', { item: 'pf-ice' }), { price: 100, credit: 150, enough: true });
  const r = T.call(u, 'shop/credit', { item: 'pf-ice', confirm: true });
  assert.equal(r.frame, 'ice');
  assert.equal(r.starCredit, 50);
  assert.equal(T.call(u, 'me').frame, 'ice');
  assert.throws(() => T.call(u, 'shop/credit', { item: 'pf-ice', confirm: true }), /вже твоя/);
  assert.equal(T.call(u, 'shop/credit', { item: 'pf-carbon' }).enough, false, '50 ⭐ left: not enough → the invoice opens instead');
  // the stars on the account (season prizes)
  T.run('UPDATE users SET stars = 120 WHERE id = ?', u);
  assert.equal(T.call(u, 'shop/stars', { item: 'pf-carbon' }).paid, 100);
  assert.equal(T.get('SELECT stars FROM users WHERE id = ?', u).stars, 20);
  assert.deepEqual(T.call(u, 'me').frames.sort(), ['carbon', 'ice']);
  assert.throws(() => T.call(u, 'shop/stars', { item: 'pf-carbon' }), /вже твоя/);
});
