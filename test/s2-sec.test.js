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
