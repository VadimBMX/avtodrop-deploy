// «Що додати в гру?» was removed on 04.11 (David: the big update is here): no window, no idea/seen or idea/send calls,
// no `me.ideaAsk`; the answers players already wrote stay readable in the admin «Ідеї гравців».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

test('ideas: the forced window is gone — no flag in me, no calls; the admin still reads old answers', () => {
  const db = openDb(':memory:');
  const t = Date.parse('2026-11-04T12:00:00Z');
  const g = createGame(db, { now: () => t, allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'A' });
  db.prepare('UPDATE users SET level = 5').run();
  assert.equal('ideaAsk' in g.api.me(1), false);
  assert.equal(g.api['idea/seen'], undefined);
  assert.equal(g.api['idea/send'], undefined);
  assert.equal(S.IDEA_ASK, undefined);
  db.prepare("INSERT INTO ideas (user_id, text, tags, created_at) VALUES (1, 'Більше японських машин', 'cars,mech', ?)").run(t);
  const a = g.admin.ideas('key', {});
  assert.equal(a.total, 1);
  assert.deepEqual(a.tags, { cars: 1, mech: 1 });
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /ideaAskOnce|Що додати чи змінити в грі|Готуємо велике оновлення/);
});
