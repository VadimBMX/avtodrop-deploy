// s2-intro (owner 3.11): the first-launch motion intro (public/intro-reel.js, S.INTRO_REEL) and the coach that replaced
// the scary top strip. Gate: a fresh player sees the intro once ('intro/seen'); a Season 1 veteran is never forced into
// it after the wipe (he gets the 'intro' claim, so the first steps still run); the replay is in Профіль, Налаштування and
// Новини. Every number in the copy comes from the rules; the animation stays on transform/opacity and small.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const APP = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const REEL = fs.readFileSync(new URL('../public/intro-reel.js', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const fn = (name, end) => APP.slice(APP.indexOf(name), end ? APP.indexOf(end, APP.indexOf(name)) : APP.indexOf('\n}\n', APP.indexOf(name)) + 2);

function setup() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-28T10:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, admins: [1000] });
  const mk = (id) => (g.ensureUser({ id, first_name: 'U' + id }), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, mk, call, setT: (v) => (t = v) };
}

test('intro gate: a fresh player gets the intro once, then the first steps; another device never replays it', () => {
  const { mk, call } = setup();
  mk(1);
  let me = call(1, 'me');
  assert.equal(me.intro, true);
  assert.equal(S.storyFor(me), 'intro', 'the intro, not «Що нового»');
  assert.equal(me.guide, null, 'no coach under the intro');
  call(1, 'intro/seen');
  me = call(1, 'me');
  assert.equal(me.intro, false);
  assert.equal(me.guide, 'starter', 'right after it: «Відкрий стартовий кейс»');
  assert.equal(S.storyFor(me), null);
  call(1, 'intro/seen');
  assert.equal(call(1, 'me').intro, false);
});

test('intro gate: a Season 1 veteran back at 0 cases after the wipe is not forced into the intro; a new player still is', () => {
  const { db, g, mk, call, setT } = setup();
  mk(2);
  call(2, 'case/open', { caseId: 'starter' }); // played before the intro existed: no 'intro' claim
  assert.equal(db.prepare("SELECT COUNT(*) n FROM claims WHERE user_id = 2 AND key = 'intro'").get().n, 0);
  setT(Date.parse('2026-11-03T10:00:00Z'));
  g.adminCall('key', 'season2/reset', { confirm: true, phrase: S.S2_RESET.phrase, reason: 'новий сезон' });
  const me = call(2, 'me');
  assert.equal(me.intro, false, 'no intro for a veteran');
  assert.ok(me.s2Welcome, 'the compensation window is his first thing');
  assert.equal(me.guide, 'starter', 'the first steps still guide him');
  mk(3); // joined after the wipe
  assert.equal(call(3, 'me').intro, true);
});

test('intro wiring: the boot plays the reel for me.intro, popups wait for it, the replay lives in Профіль / Налаштування / Новини', () => {
  const boot = APP.slice(APP.indexOf("if (story === 'intro') {"), APP.indexOf("} else if (story === 'whatsnew')"));
  assert.match(boot, /api\('intro\/seen'\)/);
  assert.match(boot, /introReel\(true, seen\)/);
  assert.doesNotMatch(boot, /playStory\(S\.INTRO_STORY/);
  assert.match(APP, /const popIdle = \(\) => [^\n]*!\$\('\.reel'\)/);
  assert.match(APP, /H\.howTo = \(\) => introReel\(false\);/);
  assert.match(fn('function settingsSheet('), /data-act="howTo"/);
  assert.match(fn('PAGES.news = ', 'H.whatsNewAgain'), /data-act="howTo"/);
  const reel = fn('function introReel(');
  assert.match(reel, /state\.tab = 'cases'/);
  assert.match(reel, /state\.caseId = 'starter'/);
  assert.match(reel, /if \(!first && how !== 'cta'\) return;/, 'a replay skipped stays where it was');
});

test('intro reel: 15–25 s, every scene skippable, numbers from the rules, reduced motion = still frames', () => {
  const R = S.INTRO_REEL;
  const total = R.scenes.reduce((a, s) => a + s.ms, 0);
  assert.ok(total >= 15000 && total <= 25000, `${total} ms`);
  assert.equal(R.scenes.at(-1).ms, 0, 'the CTA waits');
  assert.ok(R.scenes.every((s) => s.kicker && s.title && s.text));
  const go = R.scenes.at(-1).text;
  assert.ok(go.includes(S.short(S.START_BALANCE)), go);
  assert.ok(go.includes(S.short(S.NEWBIE_TASKS.reduce((a, t) => a + t.money, 0))), go);
  assert.ok(R.scenes[0].text.startsWith(S.carCountText()));
  for (const id of [R.cars.hero, R.cars.race, ...R.cars.garage]) assert.ok(S.MODELS[id], id);
  assert.doesNotMatch(REEL, /\d\s?₴|\d\s?(?:тис|млн)/, 'no hard-coded sums in the reel: prices and income come from S.MODELS');
  assert.match(REEL, /\.rl-skip'\)\) return close\('skip'\)/);
  assert.match(REEL, /reelReduced\(\)/);
  for (const src of REEL.match(/s2\/[\w/.-]+\.webp/g)) assert.ok(fs.existsSync(new URL(`../public/${src}`, import.meta.url)), src);
  // no Russian letters or Russianisms in the copy
  const copy = R.scenes.map((s) => `${s.kicker} ${s.title} ${s.text}`).join(' ') + R.cta + R.ctaAgain;
  assert.doesNotMatch(copy, /[ыэъё]|\bПлюс\b/i);
});

test('intro + coach CSS: before the wIntro marker, transform/opacity keyframes only, small', () => {
  const at = CSS.indexOf('/* ===== Night intro 2026-11-03'), coach = CSS.indexOf('/* ===== Coach (s2-intro)'), wi = CSS.indexOf('/* ===== wIntro 2026-10-29');
  assert.ok(at > 0 && coach > at && wi > coach, 'general styles go before the wIntro block');
  const block = CSS.slice(at, wi);
  for (const kf of block.matchAll(/@keyframes (\w+) \{(.*)\}$/gm)) assert.doesNotMatch(kf[2], /filter|blur|width|height|left|top|margin/, kf[1]);
  assert.match(block, /\.reel\.rm \*/);
  assert.match(block, /prefers-reduced-motion: reduce\) \{ \.reel \*/);
  assert.ok(block.length + REEL.length < 150e3, `${block.length + REEL.length} bytes`);
});

test('coach: no strip on top of the page — a ring in the header and a floating card; «Сховати підказки» stays', () => {
  const f = fn('function paintGuide(');
  assert.doesNotMatch(f, /\$\('#view'\)\.prepend/, 'nothing pushes the page down');
  assert.match(f, /\$\('#gift'\)\.before\(ring\)/);
  assert.match(f, /document\.body\.append\(el\)/);
  assert.match(f, /data-act="guideOff"/);
  assert.match(f, /data-act="newbieQuest"/, 'a done step is claimed from the card');
  assert.match(f, /classList\.add\('guide-hi'\)/, 'the target keeps its pulse');
  assert.match(APP, /H\.toggleGuide = /);
});
