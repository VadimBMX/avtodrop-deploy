// r9-bg: «Фони вітрини» (S.STYLE_ITEMS kind showcase) — the four old backdrops keep their ids, two premium ones at
// 150 ⭐; every look has its drawn scene in style.css (tools/showcase_bg.mjs) with two animated layers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { css } from '../tools/showcase_bg.mjs';

const BG = () => S.STYLE_ITEMS.filter((it) => it.kind === 'showcase');

test('showcase backdrops: the old four stay (ids, claims, 100 ⭐), «Київ уночі» and «Аврора» at 150 ⭐', () => {
  const by = Object.fromEntries(BG().map((it) => [it.id, it]));
  for (const [id, look] of [['bg-city', 'city'], ['bg-track', 'track'], ['bg-neon', 'neon'], ['bg-mount', 'mount']]) {
    assert.equal(by[id].look, look);
    assert.equal(by[id].stars, 100);
    assert.equal(by[id].cos, `cos:x:${id}`);
  }
  for (const [id, look] of [['bg-kyiv', 'kyiv'], ['bg-aurora', 'aurora']]) {
    assert.equal(by[id].look, look);
    assert.equal(by[id].stars, 150);
    assert.equal(S.SHOP_BY_ID[id], by[id], 'sold like the rest');
    assert.equal(S.cosmeticOf(`cos:x:${id}`).kind, 'showcase');
    assert.equal(S.styleLook(`cos:x:${id}`), look);
  }
  assert.equal(BG().length, 6);
  assert.equal(new Set(BG().map((it) => it.look)).size, 6);
});

test('showcase backdrops: each look is drawn in style.css with a scene and two animated layers, still under reduced motion', () => {
  const file = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const i = file.indexOf('/* r9-bg */'), j = file.indexOf('/* /r9-bg */');
  assert.ok(i > 0 && j > i, 'the block is there');
  const block = file.slice(i, j + '/* /r9-bg */\n'.length);
  assert.equal(block, css(), 'style.css is the generator output (run node tools/showcase_bg.mjs)');
  for (const { look } of BG()) {
    assert.match(block, new RegExp(`\\.sc-${look} \\{ background: url\\("data:image/svg\\+xml`), look);
    assert.match(block, new RegExp(`\\.sc-${look}::before \\{ background-image: url\\(.+animation: `), `${look} ::before`);
    assert.match(block, new RegExp(`\\.sc-${look}::after \\{ background-image: url\\(.+animation: `), `${look} ::after`);
  }
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.sc-aurora::after \{ animation: none; \}/);
  // only cheap properties move
  for (const kf of block.match(/@keyframes [^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g)) {
    for (const prop of kf.match(/[a-z-]+(?=:)/g)) assert.ok(['transform', 'opacity'].includes(prop), `${kf.slice(0, 22)}: ${prop}`);
  }
  assert.ok(block.length < 170000, `light enough (${block.length})`);
});

test('showcase backdrops: a premium one is bought for 150 ⭐ and worn on the showcase others see', () => {
  const t = Date.parse('2026-11-06T10:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {}, random: () => 0.5, allUnlocked: true, partCooldownMs: 0 });
  for (const id of [1, 2]) g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id });
  db.prepare('UPDATE users SET stars = 200 WHERE id = 1').run();
  g.api['shop/stars'](1, { item: 'bg-aurora' });
  assert.equal(g.api.me(1).stars, 50);
  assert.equal(g.api.me(1).style.showcase, 'cos:x:bg-aurora');
  assert.equal(g.api.player(2, { id: 1 }).style.showcase, 'cos:x:bg-aurora');
  assert.throws(() => g.api['shop/stars'](1, { item: 'bg-kyiv' }), /Недостатньо зірок/);
  g.creditItem({ chargeId: 'k1', userId: 1, itemId: 'bg-kyiv', stars: 150 }); // paid in Telegram Stars
  assert.equal(g.api.me(1).style.showcase, 'cos:x:bg-kyiv');
  assert.ok(g.api.me(1).claims.includes('cos:x:bg-aurora'), 'the first one is still owned');
  assert.throws(() => g.api['style/equip'](1, { slot: 'showcase', id: 'cos:x:bg-city' }), /Спершу купи/);
});
