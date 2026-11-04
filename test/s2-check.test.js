// tools/s2-check.mjs: the read-only launch check the deploy runbook runs right after the Season 2 wipe (backup taken
// before the wipe vs the live database). A clean wipe + two restarts pass; a doubled prize credit, a lost compensation
// row or a backup taken after the wipe fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { dealerPriceOf } from '../src/plate-auction.js';
import { checkSeason2 } from '../tools/s2-check.mjs';
import * as S from '../public/shared.js';

const S1_T = Date.parse('2026-10-28T10:00:00Z'), S2_T = Date.parse('2026-11-03T10:00:00Z');
const boot = (db, clock) => createGame(db, { now: () => clock.t, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [1000] });

function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-check-'));
  const file = path.join(dir, 'avtodrop.db'), backup = path.join(dir, 'prewipe.db');
  const clock = { t: S1_T };
  const db = openDb(file);
  const g = boot(db, clock);
  for (const id of [1, 2, 3, 4]) g.ensureUser({ id, first_name: 'U' + id });
  db.prepare('UPDATE users SET level = 10, level_seen = 10, balance = 50e6 WHERE id IN (1, 2)').run();
  db.prepare('UPDATE users SET stars = 500 WHERE id = 1').run(); // a Season 1 prize, settled before the wipe
  db.prepare('UPDATE users SET referrer_id = 2, ref_paid = 1 WHERE id IN (3, 4)').run();
  db.prepare("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES ('c1', 2, 'item:pass', 250, 0, ?)").run(clock.t);
  const { id } = g.adminCall('key', 'plate-auction/create', { confirm: true, text: 'AA 7777 AA', startPrice: dealerPriceOf('S'), step: 10000, hours: 1 }).auction;
  g.api['plateAuction/bid'](2, { id, amount: dealerPriceOf('S') });
  clock.t += 3600e3 + 1;
  g.settleAuctions();
  db.exec(`VACUUM INTO '${backup}'`);
  clock.t = S2_T;
  g.adminCall('key', 'season2/reset', { confirm: true, phrase: S.S2_RESET.phrase });
  boot(db, clock);
  boot(db, clock); // two restarts, as after a deploy
  return { db, file, backup, dir };
}

test('s2-check: a clean wipe and two restarts pass', () => {
  const { db, file, backup, dir } = launch();
  const r = checkSeason2(backup, file);
  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.ok(r.lines.some((l) => /кредит ⭐: 1 гравців, 250 ⭐/.test(l)));
  assert.ok(r.lines.some((l) => /призові зірки S1: 1 гравців, 500 ⭐, рівно раз/.test(l)));
  assert.ok(r.lines.some((l) => /номери з аукціону: 1 з 1/.test(l)));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('s2-check: a doubled prize credit, a lost compensation row and a backup taken after the wipe fail', () => {
  const { db, file, backup, dir } = launch();
  db.prepare("INSERT INTO star_credit_log (user_id, delta, what, balance, at) VALUES (1, 500, 's1-prize', 1000, ?)").run(S2_T);
  db.prepare('UPDATE users SET star_credit = star_credit + 500 WHERE id = 1').run();
  let r = checkSeason2(backup, file);
  assert.equal(r.ok, false);
  assert.ok(r.fails.some((f) => f.startsWith('призові зірки')), r.lines.join('\n'));
  db.prepare("DELETE FROM star_credit_log WHERE what = 's1-comp'").run();
  r = checkSeason2(backup, file);
  assert.ok(r.fails.some((f) => f.startsWith('кредит ⭐')) && r.fails.some((f) => f.startsWith('кредит у кожного')), r.lines.join('\n'));
  r = checkSeason2(file, file);
  assert.ok(r.fails.includes('бекап зроблено ДО обнулення'));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
