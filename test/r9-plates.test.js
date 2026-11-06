// r9-plates: plate frames («Рамки номерів», S.STYLE_ITEMS kind 'frame') drawn in code (public/plate-frames.js + the
// r9-plates block of style.css): the five 50 ⭐ ones keep their ids / claims, four animated ones at 100 ⭐ are new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as PF from '../public/plate-frames.js';

const frames = () => S.STYLE_ITEMS.filter((x) => x.kind === 'frame');

test('plate frames: the old five keep id, claim and 50 ⭐; four animated ones at 100 ⭐', () => {
  const old = { 'frame-neon': 'neon', 'frame-carbon': 'carbon', 'frame-chrome': 'chrome', 'frame-flame': 'flame', 'frame-ua': 'ua' };
  const neu = { 'frame-blaze': 'blaze', 'frame-volt': 'volt', 'frame-pulse': 'pulse', 'frame-gold': 'gild' };
  assert.deepEqual(frames().map((x) => x.id), [...Object.keys(old), ...Object.keys(neu)]);
  for (const it of frames()) {
    const want = old[it.id] ? 50 : 100;
    assert.equal(it.stars, want, it.id);
    assert.equal(it.look, old[it.id] || neu[it.id]);
    assert.equal(it.cos, 'cos:x:' + it.id);
    assert.equal(S.SHOP_BY_ID[it.id], it);
    assert.equal(S.styleLook(it.cos), it.look);
    assert.equal(!!it.anim, !old[it.id], `${it.id}: animated only at 100 ⭐`);
    assert.ok(it.name.length <= 32, `${it.id}: fits a Telegram invoice title`);
  }
});

test('plate frames: every look has its layers and its CSS; only the 100 ⭐ ones move; season / event frames stay plain', () => {
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* r9-plates */'));
  assert.ok(block.length > 1000, 'the r9-plates block is at the end of style.css');
  for (const it of frames()) {
    const h = PF.plateFrameInner(` pf-${it.look}`);
    assert.match(h, /class="plf"/, it.id);
    assert.equal(/data-anim/.test(h), !!it.anim, `${it.id}: data-anim only on the animated ones`);
    assert.match(block, new RegExp(`\\.pf-${it.look} \\.plf-r \\{`), `${it.id}: rim drawn`);
    if (it.anim) assert.match(block, new RegExp(`\\.pf-${it.look} \\.plf\\.live`), `${it.id}: moves only while live`);
  }
  assert.deepEqual(PF.PLATE_ANIM, frames().filter((x) => x.anim).map((x) => x.look));
  for (const cls of ['', ' pf-season', ' pf-pumpkin', ' pf-champ', ' pf-showroom', ' pf-season2', ' pf-neonx']) assert.equal(PF.plateFrameInner(cls), '', cls);
  assert.match(block, /prefers-reduced-motion: reduce/);
  // motion: transform / opacity only
  for (const kf of block.match(/@keyframes plf-[\w-]+ \{.*\}/g)) assert.doesNotMatch(kf.replace(/transform|opacity/g, ''), /[a-z-]+:\s/, kf.slice(0, 40));
});

test('plate frames: a 100 ⭐ frame is bought once, worn on the plates and seen by others', () => {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-11-06T10:00:00Z'), notify: () => {}, random: () => 0.5, allUnlocked: true });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  for (const id of [1, 2]) g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id });
  db.prepare('UPDATE users SET stars = 150 WHERE id = 1').run();
  assert.equal(g.itemPrice(1, 'frame-volt'), 100);
  call(1, 'shop/stars', { item: 'frame-volt' });
  assert.equal(call(1, 'me').stars, 50);
  assert.equal(call(1, 'me').style.frame, 'cos:x:frame-volt');
  assert.throws(() => call(1, 'shop/stars', { item: 'frame-volt' }), /вже твій/);
  assert.equal(g.creditItem({ chargeId: 'v2', userId: 1, itemId: 'frame-volt', stars: 100 }).refund, true);
  assert.equal(call(2, 'leaderboard', { type: 'all' }).list.find((r) => r.id === 1)?.style?.frame, 'cos:x:frame-volt');
  // the old ones still on sale at 50
  g.creditItem({ chargeId: 'n1', userId: 1, itemId: 'frame-neon', stars: 50 });
  assert.ok(call(1, 'me').claims.includes('cos:x:frame-neon'));
});
