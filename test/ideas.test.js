// «Що додати в гру?» (owner 29.10): the window is due from level 2, comes back once after a skip, stops after an answer;
// the first answer of S.IDEA_ASK.minLen+ characters pays the bonus once; the admin reads them in «Ідеї гравців».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

test('ideas: due from level 2, asked again once after a skip, one bonus, admin list with topics', () => {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-29T12:00:00Z');
  const g = createGame(db, { now: () => t, allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'A' });
  g.ensureUser({ id: 2, first_name: 'B' });
  assert.equal(g.api.me(1).ideaAsk, false, 'level 1: not yet');
  db.prepare('UPDATE users SET level = 3').run();
  assert.equal(g.api.me(1).ideaAsk, true);
  g.api['idea/seen'](1);
  assert.equal(g.api.me(1).ideaAsk, false, 'skipped: not again today');
  t += S.IDEA_ASK.gapH * 3600e3;
  assert.equal(g.api.me(1).ideaAsk, true, 'next day: once more');
  g.api['idea/seen'](1);
  t += S.IDEA_ASK.gapH * 3600e3;
  assert.equal(g.api.me(1).ideaAsk, false, 'after maxShows: never');

  assert.throws(() => g.api['idea/send'](2, { text: ' ', tags: ['cars'] }), /кілька слів/);
  const bal = g.api.me(2).balance;
  assert.equal(g.api['idea/send'](2, { text: 'Більше японських машин і турніри клубів', tags: ['cars', 'mech', 'bogus'] }).reward, S.IDEA_ASK.reward);
  assert.equal(g.api.me(2).balance, bal + S.IDEA_ASK.reward);
  assert.equal(g.api.me(2).ideaAsk, false, 'answered: the window is done');
  assert.equal(g.api['idea/send'](2, { text: 'Ще одна ідея: нічні гонки по місту' }).reward, 0, 'the bonus is paid once');
  for (let i = 0; i < 3; i++) g.api['idea/send'](2, { text: 'ідея ' + i });
  assert.throws(() => g.api['idea/send'](2, { text: 'шоста за день' }), /досить/);
  const a = g.admin.ideas('key', {});
  assert.equal(a.total, 5);
  assert.equal(a.players, 1);
  assert.deepEqual(a.tags, { cars: 1, mech: 1 });
  assert.equal(a.list.at(-1).text, 'Більше японських машин і турніри клубів');
});
