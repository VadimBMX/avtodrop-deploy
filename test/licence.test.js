// Licence 2026-11-03: the «Ліцензія пілота» card in «Асфальт» and the tap-to-explain achievement badges — the player
// card carries the badges he has earned (read-only: key, progress, tiers claimed), the client draws them as buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

test('player card: earned achievement badges only, read-only fields', () => {
  const t = Date.parse('2026-11-03T10:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {}, random: () => 0.5, allUnlocked: true });
  for (const id of [11, 12]) g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id });
  db.prepare('UPDATE users SET cases_opened = 120, level = 12, level_seen = 12 WHERE id = 11').run();
  g.api['ach/claim'](11, {});
  const card = g.api.player(12, { id: 11 });
  assert.ok(Array.isArray(card.ach));
  const cases = card.ach.find((a) => a.key === 'cases');
  assert.deepEqual(cases, { key: 'cases', value: 120, claimed: 2 });
  assert.ok(card.ach.every((a) => a.claimed > 0 && S.ACH_BY_KEY[a.key] && Object.keys(a).length === 3));
  assert.deepEqual(g.api.player(11, { id: 12 }).ach, []);
});

test('licence markup and styles: the new card, the badge popover, CSS before the wIntro marker', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../public/s2-ui.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(app, /class="licence lc /);
  assert.match(app, /UI2\.ava \? UI2\.ava\(p\.id/);
  assert.match(ui, /UI2\.achRow = achRow/);
  assert.match(ui, /data-act="s2Ach"/);
  for (const k of Object.keys(S.ACH_BY_KEY)) assert.match(ui, new RegExp(`\\b${k}: \\['За `), `about line for ${k}`);
  const end = css.indexOf('/* ===== wIntro 2026-10-29');
  for (const sel of ['.licence.lc {', '.lc-hero {', '.s2-bdp {']) {
    const i = css.indexOf(sel);
    assert.ok(i > 0 && i < end, sel);
  }
  assert.doesNotMatch(css, /\.lic-stats|\.lic-ava/, 'the old licence styles are gone');
});
