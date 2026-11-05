// d1-intro (owner 5.11): the start splash holds long enough to see, never blocks; ?intro=A|B previews two cinematic
// newcomer intros (public/intro-cine.js) while the reel stays the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as SP from '../public/splash.js';
import { CINE } from '../public/intro-cine.js';

const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('splash: on <body>, not in #view; ~2 s on the day\'s first launch, short after; a hold is capped', () => {
  const html = read('index.html');
  assert.match(html, /<main id="view"><\/main>/, 'the first render must not wipe it');
  assert.match(html, /<\/div>\n\s*<!--[^\n]*-->\n\s*<div class="loading s2-splash">/);
  assert.ok(SP.SPLASH_DAY_MS >= 1500 && SP.SPLASH_DAY_MS <= 2500, String(SP.SPLASH_DAY_MS));
  assert.ok(SP.SPLASH_AGAIN_MS >= 400 && SP.SPLASH_AGAIN_MS <= 1000);
  const src = read('splash.js');
  assert.match(src, /setTimeout\(release, 3000\)/, 'a hold never keeps it longer than 3 s');
  const app = read('app.js');
  assert.match(app, /\(async function boot\(\) \{\n  liftSplash\(\);/);
  assert.ok((app.match(/splashReady\(\)/g) || []).length >= 3, 'ready on success, error, no-Telegram and the 429 wait');
});

test('cinematic intros: A is the newcomer default, B dormant behind ?intro=B, ≤ 6 s to the CTA, skippable, reduced motion = last frame', () => {
  for (const v of ['A', 'B']) {
    assert.ok(CINE[v].cta <= 6000 && CINE[v].end <= 8000 && CINE[v].cta < CINE[v].end, v);
    assert.equal(Object.keys(CINE[v].cars).length, 3, 'three cars in the frame');
  }
  const src = read('intro-cine.js');
  assert.match(src, /if \(rm\) \{\n\s*t = def\.end;/);
  assert.match(src, /toEnd\(\)/);
  assert.match(src, /close\('skip'\)/);
  assert.match(src, /el\.className = `reel cine/, 'seen by popIdle as an intro on screen');
  const app = read('app.js');
  assert.match(app, /return v === 'A' \|\| v === 'B' \? v : null;/);
  assert.match(app, /^import \{ playCine \} from '\.\/intro-cine\.js';$/m, 'loaded with the app');
  assert.match(app, /const v = introVariant\(\) \|\| \(first \? 'A' : null\);/, 'A for a fresh player, no flag');
  assert.match(app, /if \(!v\) return playReel\(opts\);/, '«Як грати» replays the 7-scene reel');
});

test('cinematic intros: every car has measured lamp points and the race wheel data, lamps placed from them', async () => {
  const { LAMPS } = await import('../public/intro-cine.js');
  const { wheelData } = await import('../public/race-wheels.js');
  const src = read('intro-cine.js');
  const model = Object.fromEntries([...src.matchAll(/(\w+): '([a-z0-9-]+)'/g)].filter(([, k]) => LAMPS[k]).map(([, k, id]) => [k, id]));
  for (const v of ['A', 'B']) for (const key of Object.values(CINE[v].cars)) {
    const l = LAMPS[key];
    assert.ok(l && l.head[0] > 0.85 && l.tail[0] < 0.15, `${key}: head at the front, tail at the back`);
    assert.ok(wheelData(model[key]), `${key}: wheel discs from race-wheels-data.js`);
  }
  assert.match(src, /<i class="cn-head" style="\$\{pc\(lamp\.head\)\}">/);
  assert.doesNotMatch(src, /cn-hl/, 'no free-floating headlights');
});
