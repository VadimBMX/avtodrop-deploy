import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { startText, BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION } from '../src/bot.js';
import * as S from '../public/shared.js';

function setup(t0 = Date.parse('2026-10-21T10:00:00Z')) {
  const db = openDb(':memory:');
  let t = t0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5 });
  const mk = (id, startParam) => (g.ensureUser({ id, first_name: 'U' + id }, startParam), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, mk, call, advance: (ms) => (t += ms) };
}

test('intro stories: a brand-new player gets them once, and no "what\'s new" on top', () => {
  const { mk, call } = setup();
  mk(1);
  let me = call(1, 'me');
  assert.equal(me.intro, true);
  assert.equal(S.storyFor(me), 'intro');
  assert.equal(me.guide, null, 'no hints before the stories');
  call(1, 'intro/seen');
  call(1, 'intro/seen'); // a second call (another device) changes nothing
  me = call(1, 'me');
  assert.equal(me.intro, false);
  assert.equal(S.storyFor(me), null);
  // After the starter car is in the garage the player still doesn't get the current "what's new".
  call(1, 'case/open', { caseId: 'starter' });
  me = call(1, 'me');
  assert.ok(me.cars.length);
  assert.equal(S.storyFor(me), null);
  assert.equal(S.storyFor(me, false), null);
});

test('intro stories: an existing player never sees them, "what\'s new" still works', () => {
  const { mk, call } = setup();
  mk(2);
  call(2, 'case/open', { caseId: 'starter' }); // played before the intro existed
  const me = call(2, 'me');
  assert.equal(me.intro, false);
  assert.equal(me.guide, null, 'no first-steps hints for old players');
  assert.equal(S.storyFor(me), 'whatsnew');
  assert.equal(S.storyFor(me, true), null, 'already seen in this browser');
});

test('«Перші кроки»: one track of 8 — the pill follows the step; no car → a car first, a locked step → the level', () => {
  const step = (p) => S.guideStep({ introSeen: true, keys: {}, garage: 1, level: 1, step: 0, ...p });
  const at = (k) => S.NEWBIE_TASKS.findIndex((t) => t.key === k);
  assert.equal(S.NEWBIE_TASKS.length, 8);
  assert.deepEqual(S.GUIDE_PATH, S.NEWBIE_TASKS.map((t) => t.key), 'the pill dots are the track');
  assert.ok(S.NEWBIE_TASKS.every((t) => t.money > 0 && t.text), 'every step says what to do and what it pays');
  assert.equal(step({ keys: { starter: 1 }, garage: 0 }), 'starter');
  assert.equal(step({}), 'starter', 'opened, not claimed yet: the pill turns into «Забрати»');
  assert.equal(step({ step: at('collect') }), 'collect');
  assert.equal(step({ step: at('collect'), garage: 0 }), 'case', 'starter car sold: get a car first');
  assert.equal(step({ step: at('race') }), 'race');
  assert.equal(step({ step: at('daily') }), 'daily');
  assert.equal(step({ step: at('win'), garage: 0 }), 'case');
  assert.equal(step({ step: at('open_case'), garage: 0 }), 'open_case');
  assert.equal(step({ step: at('install'), locked: true }), 'level2');
  assert.equal(step({ step: at('install') }), 'part_case');
  assert.equal(step({ step: at('install'), parts: 2 }), 'install');
  assert.equal(step({ step: at('level3') }), 'level3');
  assert.equal(step({ step: S.NEWBIE_TASKS.length }), null, 'track done');
  assert.equal(step({ introSeen: false }), null);
  assert.equal(step({ off: true }), null);
  for (const k of ['starter', 'keep', 'case', 'collect', 'race', 'daily', 'win', 'open_case', 'part_case', 'install', 'level2', 'level3']) {
    assert.ok(S.GUIDE_STEPS.some((s) => s.key === k), k);
  }
  for (const k of S.GUIDE_FOCUS) assert.ok(S.GUIDE_STEPS.some((s) => s.key === k), k);

  const { mk, call } = setup();
  mk(3);
  call(3, 'intro/seen');
  assert.equal(call(3, 'me').guide, 'starter');
  call(3, 'case/open', { caseId: 'starter' });
  assert.equal(call(3, 'me').guide, 'starter');
  assert.equal(call(3, 'me').newbie.ready, true);
  call(3, 'newbie/claim');
  assert.equal(call(3, 'me').guide, 'collect');
  call(3, 'guide/off');
  assert.equal(call(3, 'me').guide, null);
  assert.equal(call(3, 'me').newbie.key, 'collect', 'hints off: the track stays in Завдання');
});

test('first steps add no money: newbie task rewards are unchanged', () => {
  assert.deepEqual(S.NEWBIE_TASKS.slice(0, 2).map((t) => t.money), [10000, 20000]);
  assert.equal(S.START_BALANCE, 250000);
  const { mk, call } = setup();
  mk(4);
  call(4, 'intro/seen');
  assert.equal(call(4, 'me').balance, S.START_BALANCE);
});

test('bot texts: description limits and the /start message', () => {
  assert.ok(BOT_DESCRIPTION.length <= 512, `description ${BOT_DESCRIPTION.length}`);
  assert.ok(BOT_SHORT_DESCRIPTION.length <= 120, `short ${BOT_SHORT_DESCRIPTION.length}`);
  assert.match(BOT_DESCRIPTION, /безкоштовн/);

  const fresh = startText({ name: 'Оля', created: true });
  assert.match(fresh, /^🏁 Привіт, Оля! Вітаємо в АВТОДРОПі/);
  assert.equal(fresh.split('\n').filter((l) => /^(🎁|🚗|🏎) /.test(l)).length, 3, 'three hooks');
  assert.match(fresh, /Стартовий кейс уже твій/);
  assert.match(fresh, /Тисни «Грати» 👇$/);
  assert.doesNotMatch(fresh, /Нагадування|запросив/);

  const back = startText({ name: 'Оля', pushBack: true });
  assert.match(back, /^🔔 Нагадування знову увімкнено\.\n\n🏁 Привіт, Оля! Гараж чекає/);
  assert.doesNotMatch(back, /Стартовий кейс/);

  assert.match(startText({ created: true, ref: true }), new RegExp(`запросив друг — \\+${S.fmt(S.REF_FRIEND_BONUS)}`));
  assert.match(startText({ canButton: false }), /WEBAPP_URL ще не налаштовано/);
  assert.match(startText({}), /^🏁 Привіт! /);
});

test('/start with a referral link still credits the friend bonus and says so', () => {
  const { mk, g } = setup();
  mk(10);
  const r = g.ensureUser({ id: 11, first_name: 'N' }, 'ref_10');
  assert.deepEqual(r, { created: true, ref: true });
  assert.equal(g.api.me(11).balance, S.START_BALANCE + S.REF_FRIEND_BONUS);
  assert.deepEqual(g.ensureUser({ id: 12, first_name: 'M' }, 'ref_999'), { created: true });
  assert.deepEqual(g.ensureUser({ id: 11, first_name: 'N' }, 'ref_10'), { created: false });
});
