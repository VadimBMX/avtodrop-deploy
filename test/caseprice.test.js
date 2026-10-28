import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

// Player report 28.10: «відкрив Еліту за 10, а зняло більше». The server charges what the case costs at the moment of
// the tap; the button shows what it cost when the screen was drawn (and nothing redraws it at Kyiv midnight or when an
// event ends). `expect` — the total the button showed — makes the server refuse a higher charge instead of taking it.
function setup() {
  const ctx = { t: S.kyivParse('2026-10-24T23:59') + 50e3 }; // 24.10: «Еліта» is the case of the day (−10%)
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => ctx.t, notify: () => {}, admins: [1] });
  g.ensureUser({ id: 5, first_name: 'P' });
  db.prepare('UPDATE users SET balance = 100000000, slots = 20, level = 30 WHERE id = 5').run();
  const bal = () => db.prepare('SELECT balance FROM users WHERE id = 5').get().balance;
  const drops = () => db.prepare('SELECT COUNT(*) n FROM drops WHERE user_id = 5').get().n;
  const keys = () => db.prepare("SELECT count FROM keys WHERE user_id = 5 AND case_id = 'elite'").get()?.count || 0;
  return { ctx, db, g, bal, drops, keys, open: (b) => g.api['case/open'](5, { caseId: 'elite', ...b }) };
}

test('«Еліта»: the button drawn on its case-of-the-day (9 млн) is not charged 10 млн after Kyiv midnight', () => {
  const { ctx, bal, drops, open } = setup();
  const shown = S.caseDeal(S.CASE_BY_ID.elite, S.kyivDateOf(ctx.t), S.effectsAt(ctx.t)).price;
  assert.equal(shown, 9000000, 'the button showed the case-of-the-day price');
  ctx.t = S.kyivParse('2026-10-25T00:00') + 5e3; // the tap lands after midnight: the deal is over
  const b0 = bal();
  assert.throws(() => open({ count: 1, expect: shown }), /Ціна змінилась: тепер 10\s000\s000/);
  assert.equal(bal(), b0, 'no money taken');
  assert.equal(drops(), 0, 'nothing opened');
  // The redrawn button shows 10 млн: that one goes through, for exactly that.
  assert.equal(open({ count: 1, expect: 10000000 }).price, 10000000);
  assert.equal(b0 - bal(), 10000000);
  // ×3 → 30 млн, never more than the button said.
  assert.throws(() => open({ count: 3, expect: 10000000 }), /Ціна змінилась/);
  open({ count: 3, expect: 30000000 });
  assert.equal(b0 - bal(), 40000000);
});

test('«Еліта»: a cheaper charge than shown goes through; no expect keeps the old behaviour', () => {
  const { ctx, bal, open } = setup();
  ctx.t = S.kyivParse('2026-10-24T12:00'); // the case of the day started after the screen was drawn: pays less
  const b0 = bal();
  assert.equal(open({ count: 1, expect: 10000000 }).price, 9000000);
  assert.equal(b0 - bal(), 9000000);
  ctx.t = S.kyivParse('2026-10-24T18:00');
  const b1 = bal();
  assert.equal(open({ count: 3 }).price, 9000000); // older app without expect: charged as before
  assert.equal(b1 - bal(), 27000000);
});

test('«Еліта»: keys — a key spent elsewhere is not silently replaced by a paid open; partial keys are counted', () => {
  const { ctx, db, bal, keys, open } = setup();
  ctx.t = S.kyivParse('2026-10-28T12:00');
  db.prepare("INSERT INTO keys (user_id, case_id, count) VALUES (5, 'elite', 2)").run();
  const b0 = bal();
  open({ count: 3, expect: 10000000 }); // «10 000 000 ₴ + 🔑2»
  assert.equal(b0 - bal(), 10000000);
  assert.equal(keys(), 0);
  // The screen still shows «Відкрити ключем 🔑 1» (expect 0), but the key is gone: refused, not 10 млн.
  assert.throws(() => open({ count: 1, expect: 0 }), /Ціна змінилась/);
  assert.equal(b0 - bal(), 10000000);
});

test('app: the open button carries the total it shows and H.openCase sends it as expect', () => {
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(src, /data-act="openCase" data-expect="\$\{price \* paid\}"/);
  assert.match(src, /api\('case\/open', \{ caseId: cs\.id, count: n, \.\.\.\(d\?\.expect != null/);
});
