// QA3 (2026-10-29): regressions found in the full functional pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../public/shared.js';

const APP = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const ADMIN_JS = fs.readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
const ADMIN_CSS = fs.readFileSync(new URL('../public/admin.css', import.meta.url), 'utf8');
const GAME = fs.readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');

test('qa3: a set reward reads without "+ +" (parts are joined with « · »)', () => {
  for (const set of S.SETS) {
    const t = S.setRewardText(set);
    assert.ok(!/\+\s*\+/.test(t), t);
    assert.match(t, /\+\d+% доходу машинам сету$/);
  }
});

test('qa3: the rewards window opened by itself at start never covers the level-up window', () => {
  // openRewards(…, auto) gives up when another window is already open once its data is in
  assert.match(APP, /async function openRewards\(result, auto = false\)[\s\S]{0,400}if \(auto && !\$\('#modal'\)\.hidden\) return false;/);
  // the start-up call is the auto one, and the daily banner comes back when it wasn't shown
  assert.match(APP, /openRewards\(null, true\)\.then\(\(shown\) => shown === false && \(skipDailyBanner = false\)\)/);
});

test('qa3: helpers do not see admin buttons the server refuses them', () => {
  assert.match(ADMIN_JS, /document\.body\.classList\.toggle\('helper', w\.role === 'helper'\)/);
  const m = /body\.helper :is\(([^)]*(?:\)[^{]*)?)\)\s*\{\s*display: none !important;/.exec(ADMIN_CSS);
  assert.ok(m, 'helper rule in admin.css');
  const hidden = [...m[1].matchAll(/data-act="([a-zA-Z]+)"/g)].map((x) => x[1]);
  // every one of these calls an action outside HELPER_ACTIONS (src/game.js)
  const helperSet = /const HELPER_ACTIONS = new Set\(\[([^\]]*)\]\)/.exec(GAME)[1];
  for (const a of ['market/remove', 'remove-car', 'remove-plate', 'dealer/refresh', 'containers/toggle', 'containers/close', 'halloween/mode', 'schedule/save', 'schedule/delete', 'schedule/seed', 'dayrace/set', 'dayrace/dq', 'clubs/reset', 'clubs/disband']) assert.ok(!helperSet.includes(`'${a}'`), a);
  for (const a of ['removeCar', 'removePlate', 'dealerRefresh', 'unlist', 'ctToggle', 'ctClose', 'hwMode', 'evpNew', 'evpStop', 'evpDel', 'drDq', 'drSet', 'clubReset', 'clubDisband']) assert.ok(hidden.includes(a), a);
});

test('qa3: place texts use the ordinal form («6-е місце»)', () => {
  assert.match(GAME, /Гонка тижня: \$\{i \+ 1\}-е місце!/);
  assert.match(GAME, /Сезон \$\{prev\}: \$\{place\}-е місце!/);
});
