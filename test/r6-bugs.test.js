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

test('Season 2 «Місто»: the live «Ніч дрифту» slot seeded as «… Токіо» is renamed on start, an owner\'s own title stays', async () => {
  const { openDb } = await import('../src/db.js');
  const { createGame } = await import('../src/game.js');
  const { DEFAULT_PLAN } = await import('../src/schedule.js');
  const t = Date.parse('2026-11-06T09:00:00+02:00');
  const title = (db, seed) => db.prepare('SELECT title FROM event_plan WHERE seed = ?').get(seed)?.title;
  const want = DEFAULT_PLAN.find((s) => s.seed === 'w1-drift').title;
  assert.doesNotMatch(want, /Токіо/);
  for (const [was, after] of [['Ніч дрифту: Токіо', want], ['Ніч дрифту від адміна', 'Ніч дрифту від адміна']]) {
    const db = openDb(':memory:');
    createGame(db, { now: () => t, notify: () => {}, seedSchedule: true });
    db.prepare("UPDATE event_plan SET title = ? WHERE seed = 'w1-drift'").run(was); // as seeded on the live server on 2.11 / edited
    const g = createGame(db, { now: () => t, notify: () => {}, seedSchedule: true }); // the deploy restarts the server
    assert.equal(title(db, 'w1-drift'), after);
    // what players get at 18:00 is the plan's title
    const g2 = createGame(db, { now: () => Date.parse('2026-11-06T19:00:00+02:00'), notify: () => {}, seedSchedule: true });
    g2.ensureUser({ id: 5, first_name: 'P' });
    const ev = g2.api.me(5, {}).gameEvents.active.find((e) => e.id === 'drift');
    assert.equal(ev?.title, after);
    void g;
  }
});

test('DROP case page, short of room: the note with «продати дешевші» is inside the sticky dock (its ::after strip covered it below), and names the count that fits', () => {
  const ui = fs.readFileSync(new URL('../public/s2-ui.js', import.meta.url), 'utf8');
  const dock = ui.slice(ui.indexOf('function dock(cs)'), ui.indexOf('function oddsTiles'));
  assert.match(dock, /\$\{openBtn\(cs, n\)\}\$\{note\}<\/div>`/, 'the note is the dock\'s last child');
  assert.doesNotMatch(dock, /<\/div>\$\{free < n/, 'no note after the dock');
  // r7-ux: the button itself opens what fits («Відкрити ×K (що влізе)», K = free slots), the note says how many are free
  assert.match(dock, /Для ×\$\{n\} мало місця — вільно \$\{free\}/);
  // the strip is still there for what scrolls under the dock; the note row keeps ×N and the button on one line
  assert.match(css, /body\.s2 \.s2-dock::after, body\.s2 \.pdock::after \{ background: #07080b; height: 40px; \}/);
  assert.match(css, /body\.s2 \.s2-dock\.s2-dock-note \{ flex-wrap: wrap; row-gap: 4px; \}/);
  assert.match(css, /body\.s2 \.s2-dock\.s2-dock-note > \.s2-open \{ flex: 1 1 0; \}/);
});
