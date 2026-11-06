// r6 (06.11, Season 2 «Місто» launch day): bugs found in the r4/r3 merges. The browser side is checked by
// tools/ui-sweep.mjs --r6 (320×568, 390×844, 430×932); the pure rules and the texts are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { coachShift } from '../public/firsthour.js';

const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('coach card strip: scrolled down it changes at once and the page scrolls with it (no jump on iOS); at the top it slides', () => {
  // folding the card (152 px strip) on a page scrolled 400 px: the page scrolls up by the strip, nothing on screen moves
  assert.deepEqual(coachShift({ y: 400, was: 152, h: 0 }), { instant: true, by: -152 });
  // the card drops in while scrolled: scroll down by it
  assert.deepEqual(coachShift({ y: 400, was: 0, h: 152 }), { instant: true, by: 152 });
  // the card grows (opened by hand) while scrolled
  assert.deepEqual(coachShift({ y: 10, was: 100, h: 180 }), { instant: true, by: 80 });
  // at the top of the page: the strip slides (CSS transition), no scrolling
  assert.deepEqual(coachShift({ y: 0, was: 152, h: 0 }), { instant: false, by: 0 });
  // nothing changes: nothing to do
  assert.deepEqual(coachShift({ y: 300, was: 152, h: 152 }), { instant: false, by: 0 });
  // the app uses it, and the instant change switches the slide off
  assert.match(app, /coachShift\(\{ y, was, h \}\)/);
  // measured, not assumed: Android's Chromium anchors the scroll itself (a fixed «by» would move it twice), iOS doesn't
  assert.match(app, /const d = ref\.getBoundingClientRect\(\)\.top - top0;/);
  assert.match(css, /body\.coach-still #view::before \{ transition: none; \}/);
});

test('Місто on a short phone: with the coach strip the map may shrink below its 120 px floor, so the bottom sheet stays above the bar', () => {
  const at = css.indexOf('/* ===== wIntro 2026-10-29');
  const i = css.indexOf('@media (max-height: 640px) { body.s2.coach-push .s2-city > .s2-map { min-height: 84px; } }');
  assert.ok(i > 0 && i < at, 'the rule exists (short screens only), before the wIntro block');
});
