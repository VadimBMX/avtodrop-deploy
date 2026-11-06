// r9-names: «Стиль» name colours and underglow — the old ids keep working, two animated names and a rainbow glow at
// 100 ⭐ go through the same "cos:x:" claim path, and their CSS is drawn in code with cheap, reduced-motion-safe motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const CSS = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const BLOCK = CSS.slice(CSS.indexOf('/* r9-names */'), CSS.indexOf('/* /r9-names */'));

test('r9-names: old name / glow ids stay, the new ones cost 100 ⭐ and are claimed as cos:x:<id>', () => {
  const by = (kind) => S.STYLE_ITEMS.filter((x) => x.kind === kind).map((x) => [x.id, x.look, x.stars]);
  assert.deepEqual(by('name'), [['nm-gold', 'gold', 75], ['nm-neon', 'neon', 75], ['nm-flame', 'flame', 75], ['nm-ua', 'ua', 75], ['nm-rainbow', 'rainbow', 100], ['nm-glitch', 'glitch', 100]]);
  assert.deepEqual(by('glow'), [['gl-cyan', 'cyan', 75], ['gl-magenta', 'magenta', 75], ['gl-amber', 'amber', 75], ['gl-rainbow', 'rainbow', 100]]);
  for (const id of ['nm-rainbow', 'nm-glitch', 'gl-rainbow']) {
    const it = S.SHOP_BY_ID[id];
    assert.equal(it.cos, 'cos:x:' + id);
    assert.equal(S.cosmeticOf(it.cos).kind, it.kind);
    assert.equal(S.styleLook(it.cos), it.look);
    assert.ok(`${it.name} · АВТОДРОП`.length <= 32, 'fits a Telegram invoice title');
  }
  assert.equal(new Set(S.STYLE_ITEMS.map((x) => x.id)).size, S.STYLE_ITEMS.length, 'ids are unique');
});

test('r9-names: a new name and glow are bought, worn and seen by others like the old ones', () => {
  const t = Date.parse('2026-11-06T10:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  for (const id of [1, 2]) g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id });
  db.prepare('UPDATE users SET stars = 300 WHERE id = 1').run();
  call(1, 'shop/stars', { item: 'nm-glitch' });
  assert.equal(call(1, 'me').stars, 200, '100 ⭐');
  g.creditItem({ chargeId: 'r9-g', userId: 1, itemId: 'gl-rainbow', stars: 100 });
  assert.deepEqual(call(1, 'me').style, { frame: null, showcase: null, name: 'cos:x:nm-glitch', glow: 'cos:x:gl-rainbow' });
  assert.equal(call(2, 'player', { id: 1 }).style.name, 'cos:x:nm-glitch');
  assert.equal(g.creditItem({ chargeId: 'r9-g2', userId: 1, itemId: 'gl-rainbow', stars: 100 }).refund, true, 'not twice');
  call(1, 'shop/stars', { item: 'nm-rainbow' });
  call(1, 'style/equip', { slot: 'name', id: 'cos:x:nm-rainbow' });
  assert.equal(call(1, 'me').style.name, 'cos:x:nm-rainbow');
});

test('r9-names: every look is drawn in CSS, moves cheaply and stops for reduced motion', () => {
  for (const it of S.STYLE_ITEMS.filter((x) => x.kind === 'name')) assert.match(BLOCK, new RegExp(`\\.nm-${it.look}\\b`), it.id);
  for (const it of S.STYLE_ITEMS.filter((x) => x.kind === 'glow')) assert.match(BLOCK, new RegExp(`\\.gl-${it.look}\\b`), it.id);
  assert.match(BLOCK, /\.nm-gold \{[^}]*animation: r9nmSheen/, 'gold has a moving shine');
  assert.match(BLOCK, /\.nm-glitch::before[^{]*\{[^}]*content: attr\(data-n\)/, 'glitch slices come from the name');
  for (const kf of BLOCK.matchAll(/@keyframes (\w+) \{(.*)\}\n/g)) {
    assert.doesNotMatch(kf[2], /filter|blur|width|height|left|top/, kf[1]);
    if (/^r9gl|^r9rb|Glitch|Tube/.test(kf[1])) assert.doesNotMatch(kf[2].replace(/background: [^;]*;/g, ''), /background/, `${kf[1]}: transform / opacity`);
  }
  // the glitch never flashes: it is hidden ~90% of the time
  const gl = /@keyframes r9nmGlitchA \{ 0%, (\d+)% \{ opacity: 0;/.exec(BLOCK);
  assert.ok(gl && Number(gl[1]) >= 80);
  assert.match(BLOCK, /@media \(prefers-reduced-motion: reduce\) \{[^]*\.nm-glitch::before[^]*animation: none/);
  assert.ok(!/url\(/.test(BLOCK), 'no pictures');
});
