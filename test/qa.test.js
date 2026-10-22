// QA of the night merge (wave 1: workshop G, rewards E, honest numbers B, metrics F, hotfixes A, races C,
// progression D): the seams between agents that a playthrough found broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as M from '../src/metrics.js';
import * as T from '../public/tune.js';

const APP = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
// The source of a top-level function / handler of public/app.js, up to its closing brace at column 0.
function src(head) {
  const i = APP.indexOf(head);
  assert.ok(i >= 0, `public/app.js: ${head}`);
  return APP.slice(i, APP.indexOf('\n}', i) + 2);
}

test('qa: «Продати непотрібні» (wG) counts as a dealer sale in the owner metrics (wF), not as tuning', () => {
  const db = openDb(':memory:');
  const t = Date.parse('2026-10-22T10:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'A' });
  g.giveCar(1, 'vaz-2107');
  g.addPart(1, 'motor', 'race', 1); // no electric car → junk
  const me = g.api.me(1);
  const r = g.api['parts/sell-junk'](1, { items: T.junkParts(me.cars, me.parts) });
  assert.ok(r.got > 0);
  const money = g.adminCall('key', 'metrics', { days: 14 }).money;
  const sales = money.groups.find((x) => x.key === 'sales');
  assert.equal(sales?.created, r.got);
  assert.ok(!money.groups.some((x) => x.key === 'upkeep' && x.created));
  // Every call that sells something to the dealer is a sale; player-to-player sales are the market.
  for (const k of Object.keys(g.api)) if (/sell|tradein/.test(k)) assert.equal(M.groupOf(k), k.startsWith('market/') ? 'market' : 'sales', k);
});

test('qa: a car picked from the boss card hint stays picked (wC «Взяти …» × wA career default car)', () => {
  // careerView swaps the race car for one the NEXT boss takes unless the player picked it himself (readyRaceCar).
  assert.match(src('H.bossPickCar = '), /state\.raceCar = state\.raceCarPicked = Number\(d\.id\)/);
  assert.match(src('function readyRaceCar('), /state\.raceCarPicked === cur\.id/);
});

test('qa: no «Перші кроки» banner while the steps pill is on screen; a reward claimed elsewhere drops its banner (wD × wE)', () => {
  const f = src('function showClaimBanners(');
  // newbie is one of the reward kinds now, so the pill check must sit in the reward branch
  assert.match(APP, /const REWARD_KINDS = new Set\(\[[^\]]*'newbie'/);
  assert.match(f, /const rw = claims\.filter\([^;]*c\.kind === 'newbie' && \$\('#guide'\)/);
  assert.match(f, /hideBanner\(k, false\)/);
  // …and none for what the open page claims itself (the season page's own «Забрати нагороди», Завдання, …)
  assert.match(f, /const here = PAGE_CLAIMS\[state\.page\] \|\| \[\]/);
  assert.match(f, /!here\.includes\(c\.kind\)/);
  assert.match(APP, /const PAGE_CLAIMS = \{ quests: \[[^\]]*'newbie'\], season: \['pass'\]/);
  // a claim made through act() asks the server again at once, so the stale banner goes in ~0.3 s
  assert.match(src('async function act('), /CELEBRATE\.has\(name\)\) pulseSoon\(\)/);
});

test('qa: the share card from a reward reveal uses the sale for ×N, like every drop (wE × wB)', () => {
  const f = src('function rvlResult(');
  assert.match(f, /openShare\(r\.car, \{ mult: cs\?\.price \? \(S\.saleOf\(r\.car\) \?\? 0\) \/ cs\.price : 0 \}\)/);
  assert.doesNotMatch(f, /r\.car\.value \/ cs\.price/);
});

test('qa: one filled yellow — the daily button under «Забрати все» and «Преміум» next to a ready pass claim are outlined (wE × wA)', () => {
  assert.match(src('async function openRewards('), /class="btn mt \$\{liveRewardClaims\(\)\.length \? 'soft' : ''\}" data-act="claimDaily"/);
  assert.match(APP, /class="btn \$\{s\.ready \? 'soft' : 'yellow'\} mt" data-act="buyItem" data-id="pass"/);
});

test('qa: no merge conflict markers left in the game files (a stray «=======» in style.css dropped the empty-tank card rule)', () => {
  const files = [];
  for (const dir of ['public', 'src']) {
    for (const f of fs.readdirSync(new URL(`../${dir}/`, import.meta.url))) if (/\.(js|css|html|json)$/.test(f)) files.push(`${dir}/${f}`);
  }
  for (const f of files) {
    const lines = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n');
    lines.forEach((l, i) => assert.doesNotMatch(l, /^(<{7}|={7}|>{7})(\s|$)/, `${f}:${i + 1}`));
  }
});
