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
