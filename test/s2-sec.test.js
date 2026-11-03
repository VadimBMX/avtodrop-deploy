// s2-sec: the Season 2 security pass (scratchpad sec-report.md) — DEV mode can't come on in a production build,
// the Season 2 wipe takes the businesses bought with Season 1 money, admin-only server actions check the role,
// prototype keys in admin / share calls are clean errors (never a 500).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, GameError } from '../src/game.js';
import { signInitData } from '../src/auth.js';
import { createApp, devModeFrom } from '../server.js';
import * as S from '../public/shared.js';

test('DEV mode: never in a production build, whatever DEV / BOT_TOKEN say; the owner\'s computer as before', () => {
  assert.equal(devModeFrom({ NODE_ENV: 'production' }), false, 'BOT_TOKEN lost on the server: no header sign-in for anybody');
  assert.equal(devModeFrom({ NODE_ENV: 'production', DEV: '1' }), false, 'DEV=1 left on');
  assert.equal(devModeFrom({ NODE_ENV: 'production', DEV: '1', BOT_TOKEN: 'T' }), false);
  assert.equal(devModeFrom({ NODE_ENV: 'production', BOT_TOKEN: 'T' }), false);
  assert.equal(devModeFrom({}), true, 'local copy without a bot');
  assert.equal(devModeFrom({ DEV: '1', BOT_TOKEN: 'T' }), true);
  assert.equal(devModeFrom({ BOT_TOKEN: 'T' }), false);
});

test('season 2 wipe: businesses bought before it (Season 1 money in their boxes) are wiped too', () => {
  const db = openDb(':memory:');
  let t = Date.parse('2026-11-03T10:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [1000] });
  g.ensureUser({ id: 7, first_name: 'U7' });
  db.prepare('UPDATE users SET level = 60, level_seen = 60, balance = 1e12 WHERE id = 7').run();
  const biz = g.api.biz(7, {}).list.find((b) => b.unlocked);
  g.api['biz/buy'](7, { id: biz.id });
  t += 30 * 3600e3;
  assert.ok(g.api.biz(7, {}).totalBox > 0, 'the box holds Season 1 income');
  g.adminCall('key', 'season2/reset', { phrase: S.S2_RESET.phrase, confirm: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_business').get().n, 0);
  assert.equal(g.api['biz/collect'](7, { all: true }).got, 0, 'nothing to collect after the wipe');
  assert.equal(db.prepare('SELECT balance FROM users WHERE id = 7').get().balance, S.START_BALANCE);
});

async function serve(opts) {
  const app = createApp({ dbFile: ':memory:', log: () => {}, ...opts });
  // listen only (app.start would start the bot, and a test never talks to Telegram)
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  return { app, url: (p) => `http://127.0.0.1:${app.server.address().port}${p}` };
}
const init = (id) => signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'A' + id }) }, 'T');
