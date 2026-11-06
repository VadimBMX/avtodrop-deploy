// r7-ux (06.11, Season 2 launch day): fixes from the r6 persona playtest (scratchpad r6-persona-report.md #2 #4 #5 #8
// #9 #10). Checked in the browser on 360×640 and 390×844; the texts and rules are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const css = read('style.css'), s2 = read('s2-ui.js');

test('city map: «Траса» steps out from under «Мій гараж» and is never faded; the map starts centred on both', () => {
  assert.match(s2, /function liftLabel\(r, hits, mapTop\)/);
  assert.match(s2, /const hid = hits\(r\) && lb\.dataset\.k !== 'track';/);
  assert.match(s2, /sp\.k === 'track' \? ' top' : ''/);
  assert.match(css, /body\.s2 \.s2-lb\.top \{ z-index: 3; \}/);
  assert.match(css, /calc\(-100% \+ var\(--dy, 0px\)\)/);
  // centred between the garage (x 875) and the track (x 1030), the remembered drag dropped when coming from elsewhere
  assert.match(s2, /data-x="952"/);
  assert.match(s2, /delete s\['pan_' \+ \(s\.cityView \|\| 'city'\)\]/);
  // «Гортай місто» no longer at the top right over «Аукціон»
  assert.match(css, /body\.s2 \.s2-map:not\(\.war\) \.s2-hint \{ top: auto; bottom: 56px; \}/);
});

test('first steps 7/8 below the parts level: «Дійди до 3-го рівня — відкриються деталі», its button leads to Траса', async () => {
  const S = await import('../public/shared.js');
  const st = S.GUIDE_STEPS.find((s) => s.key === 'level2');
  assert.equal(st.title, `Дійди до ${S.unlockLevel('parts')}-го рівня — відкриються деталі`);
  assert.equal(st.tab, 'race');
  assert.doesNotMatch(read('app.js'), /key === 'level2' \? `<button class="coach-go" data-act="workshopGo">/);
});

test('short of garage room: the button opens what fits (K = free slots) and the server takes any count up to 6', async () => {
  const dock = s2.slice(s2.indexOf('function openBtn('), s2.indexOf('const fastPill'));
  assert.match(dock, /data-n="\$\{free\}"/);
  assert.match(dock, /Відкрити ×\$\{free\} \(що влізе\)/);
  assert.doesNotMatch(dock, /вибери менше/);
  const app = read('app.js');
  assert.equal((app.match(/const fit = free >= 1 && free < n \? free : 0;/g) || []).length, 2);
  const { openDb } = await import('../src/db.js');
  const { createGame } = await import('../src/game.js');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-11-06T12:00:00+02:00'), notify: () => {} });
  g.ensureUser({ id: 7, first_name: 'T' });
  db.prepare('UPDATE users SET balance = 10000000 WHERE id = 7').run();
  db.prepare("DELETE FROM keys WHERE user_id = 7 AND case_id = 'starter'").run();
  const bal = () => db.prepare('SELECT balance FROM users WHERE id = 7').get().balance;
  let b0 = bal();
  g.api['case/open'](7, { caseId: 'rust', count: 1 });
  const one = b0 - bal();
  b0 = bal();
  const r = g.api['case/open'](7, { caseId: 'rust', count: 4 });
  assert.equal(r.results.length, 4);
  assert.equal(b0 - bal(), one * 4, 'price × count, nothing else');
});

test('DROP dock: «Відкрити ×N · price» with no case name; short of money the same one-row button; no guide scroll over a drop', () => {
  const app = read('app.js');
  assert.match(app, /\$\{paid && onDrop \? `<span class="oc-l">Відкрити ×\$\{n\}<\/span><span class="oc-p">\$\{S\.short\(price \* paid\)\}/);
  assert.match(app, /return onDrop \? `<button class="btn opencase second" disabled><span class="oc-l">Відкрити ×\$\{n\}<\/span><span class="oc-p">бракує/);
  assert.match(app, /below > 0 && !held && !target\.closest\('\.drop-dock, \.s2-dock'\)/);
});

test('«Бета-тест»: not in the first session, never over the garage or Траса; «Нагороди чекають» waits while the coach card shows', async () => {
  const { firstSession, bugAskTabOk, NEW_ENTRY_MS } = await import('../public/popups.js');
  const t0 = Date.parse('2026-11-06T14:00:00+02:00');
  assert.equal(firstSession(t0, t0 + 9 * 60e3), true, '9 minutes into the first session');
  assert.equal(firstSession(t0, t0 + NEW_ENTRY_MS - 1), true);
  assert.equal(firstSession(t0, t0 + 20 * 3600e3), false, 'the next day');
  assert.equal(firstSession(undefined, t0), true, 'unknown age: wait');
  for (const t of ['garage', 'race']) assert.equal(bugAskTabOk(t), false);
  for (const t of ['city', 'cases', 'bazaar', 'menu']) assert.equal(bugAskTabOk(t), true);
  const app = read('app.js');
  assert.match(app, /if \(firstSession\(me\?\.createdAt, bugEntryAt\)\) return void \(bugAskOn = false\);/);
  assert.match(app, /if \(!bugAskTabOk\(state\.tab\) \|\| state\.drift \|\| !\$\('#modal'\)\.hidden/);
  assert.match(app, /localStorage\.setItem\(BUG_ASK_KEY, '1'\);/);
  assert.match(css, /body\.coach-push #banners \.banner\.rwall \{ display: none; \}/);
});

test('small items: a tile with keys says «ключ ×N»; another case before the starter → a toast; «Стан» explains itself', () => {
  assert.match(s2, /m\.keys\[c\.id\] \? `\$\{X\.ic\('key'\)\}ключ ×\$\{m\.keys\[c\.id\]\}` : shortN\(dl\.price\)/);
  assert.match(s2, /X\.toast\('Спершу відкрий стартовий — він безкоштовний'\)/);
  assert.equal((s2.match(/if \(starterFirst\(d\.id\)\) return;/g) || []).length, 2, 's2Pick and s2Case');
  const app = read('app.js');
  assert.match(app, /data-act="stateInfo"><small>Стан /);
  assert.match(app, /H\.stateInfo = \(\) => toast\(`Стан — наскільки машина чиста\./);
});
