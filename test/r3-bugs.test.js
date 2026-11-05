// r3 bug hunt over the 05.11 merges (intro A / splash, newcomer free tank, auctions, art). Source-level checks for the
// browser code, like test/d1-intro.test.js; tools/ui-sweep.mjs --today runs the same things in a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const fnBody = (src, head) => {
  const i = src.indexOf(head);
  assert.ok(i >= 0, `${head} not found`);
  return src.slice(i, src.indexOf('\n}\n', i));
};

test('garage tank card: the newcomer\'s free full tank sits on its own row, not squeezed into the tank row', () => {
  // At 320–390 px the long «Повний бак · безкоштовно» in the row cut itself off and crushed «0/15» (layout-check:
  // overlap + clip on Гараж → Машини for an empty-tank newcomer, worse next to «Бак 18 · 2 млн»).
  const app = read('app.js');
  const body = fnBody(app, 'function tankCard() {');
  assert.match(body, /const nb = newbieFuelOn\(\);/);
  assert.match(body, /\$\{up\}\$\{nb \? '' : refuelBtn\(\)\}<\/div>/, 'not inside .tk-row while the free tank is on');
  assert.match(body, /\$\{nb \? `<div class="tk-nb">\$\{refuelBtn\(\)\}<\/div>` : ''\}/, 'its own row under it');
  const css = read('style.css');
  const cut = css.indexOf('/* ===== wIntro 2026-10-29');
  const at = css.indexOf('.tk-card .tk-nb .refuel-btn.nb-fuel');
  assert.ok(at > 0 && at < cut, 'the full-width rule exists, before the wIntro block');
  assert.match(css.slice(at, css.indexOf('}', at)), /width: 100%/);
});

test('splash: a boot that throws still lets the splash go (it covers the whole app now); a «null» config is survived', () => {
  const app = read('app.js');
  assert.match(app, /\}\)\(\)\.catch\(\(e\) => \{\n[^]*?splashReady\(\);[^]*?throw e;\n\}\);/, 'boot().catch → splashReady');
  assert.match(app, /config = \(await \(await fetch\('\/api\/config'\)\)\.json\(\)\) \|\| config;/, 'a null body keeps the defaults');
});
