// D-race UI (27.10): the boss intro stands before the race clock starts, scene mode is pure CSS + an observer,
// and the result buttons live in the sticky dock. Source checks: the race maths itself is covered by race*.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const src = (head) => {
  const i = APP.indexOf(head);
  assert.ok(i >= 0, head);
  return APP.slice(i, APP.indexOf('\n}', i) + 2);
};

test('boss intro runs after boss/start and before the race screen and runRace()', () => {
  const f = src('H.startBoss = async (d) => {');
  const iStart = f.indexOf("api('boss/start'"), iIntro = f.indexOf('await bossIntroFor('), iRender = f.lastIndexOf('await render()'), iRun = f.lastIndexOf('runRace();');
  assert.ok(iStart >= 0 && iStart < iIntro && iIntro < iRender && iRender < iRun);
  assert.match(f, /if \(!d\.again\) await bossIntroFor/);
  assert.match(src('H.bossAgain = (d) => {'), /H\.startBoss\(\{ \.\.\.d, again: 1 \}\)/);
});

test('boss intro module: skippable, reduced motion is a still 1 s card', () => {
  const m = fs.readFileSync(new URL('../public/boss-intro.js', import.meta.url), 'utf8');
  assert.match(m, /const ms = rm \? 1000 : 2200/);
  assert.match(m, /addEventListener\('pointerdown', close/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.boss-in, \.boss-in \* \{ animation: none/);
});

test('scene mode hides the tab bar only while a run is on screen; results use the sticky dock', () => {
  const m = fs.readFileSync(new URL('../public/race-scene.js', import.meta.url), 'utf8');
  assert.match(m, /:scope > \.drag, :scope > \.d2/);
  assert.match(CSS, /body\.racing \.tabs \{ display: none; \}/);
  for (const f of ['function raceResult(', 'function driftResult(', 'function bossResult(']) assert.match(src(f), /class="dr-dock"/, f);
  assert.match(src('function raceResult('), /whyHtml\(why\)/); // the loss explanation stays
});
