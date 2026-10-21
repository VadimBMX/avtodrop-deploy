import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { simCase, oldSteps, natural } from '../tools/sim-cases.mjs';

function setup(db = openDb(':memory:')) {
  const g = createGame(db, { now: () => Date.parse('2026-10-19T10:00:00Z'), notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'U1' });
  db.prepare('UPDATE users SET balance = 1e15, slots = 100000, level = 99, level_seen = 99 WHERE id = 1').run();
  return { db, g };
}
const steps = (id) => S.pitySteps(S.CASE_BY_ID[id]).map((s) => [s.cls, s.n]);

// The guarantee table of reports/pity.md (tools/sim-cases.mjs): change it there first.
test('guarantee steps per case', () => {
  const want = {
    rust: [['C', 25]], city: [['B', 30]], tuning: [['A', 200]], sport: [['A', 30]], premium: [['S', 130]], elite: [['S', 30]],
    'c-ua': [['C', 35]], 'c-jp': [['B', 30]], 'c-de': [['B', 30]], 'c-cn': [['B', 30]], 'c-us': [['S', 300]], 'c-gb': [['S', 250]], 'c-it': [['S', 250]],
  };
  for (const cs of S.CASES) assert.deepEqual(steps(cs.id), want[cs.id] || [], cs.id);
  assert.deepEqual(S.pitySteps(S.CASE_BY_ID.rust)[0].key, 'rust:C', 'one counter per case and class');
});

test('every guarantee can be felt: it fires for 5–60 % of the unlucky runs, never for (almost) nobody', () => {
  for (const cs of S.CASES.filter((c) => !c.starter)) {
    for (const s of S.pitySteps(cs)) {
      // Chance that n − 1 opens in a row bring nothing of the class (the n-th is then lifted), boost included.
      const reach = Math.pow(1 - natural(cs, s.cls), s.n - 1);
      assert.ok(reach > 0.05 && reach < 0.6, `${cs.id} ${s.cls}@${s.n}: reached in ${(reach * 100).toFixed(1)}% of runs`);
    }
  }
});

test('the guarantee lifts the roll on the n-th open and every step resets on its class or better', () => {
  const { db, g } = setup();
  const set = (key, n) => db.prepare('INSERT INTO pity (user_id, case_id, count) VALUES (1, ?, ?) ON CONFLICT DO UPDATE SET count = excluded.count').run(key, n);
  const get = (key) => g.api.me(1).pity[key];
  for (const id of ['rust', 'tuning', 'premium', 'c-us']) {
    const [st] = S.pitySteps(S.CASE_BY_ID[id]);
    for (let k = 0; k < 5; k++) {
      set(st.key, st.n - 1);
      const [r] = g.api['case/open'](1, { caseId: id }).results;
      const cls = S.MODELS[r.car.model].cls;
      assert.ok(S.rankOf(cls) >= S.rankOf(st.cls), `${id}: ${cls} on the ${st.n}-th open`);
      assert.equal(get(st.key), 0, `${id}: reset after the guaranteed class`);
    }
    set(st.key, 3);
    g.api['case/open'](1, { caseId: id });
    const c = get(st.key);
    assert.ok(c === 0 || c === 4, `${id}: +1 or reset (${c})`);
  }
  // The forced drop is marked in the history (forced = 1: «гарантія»).
  assert.ok(db.prepare('SELECT COUNT(*) n FROM drops WHERE forced = 1').get().n > 0);
});

test('rust: no run of n opens without blue, and keys count too', () => {
  const { db, g } = setup();
  const [st] = S.pitySteps(S.CASE_BY_ID.rust);
  g.api['case/open'](1, { caseId: 'rust', count: 6 });
  db.prepare("INSERT INTO keys (user_id, case_id, count) VALUES (1, 'rust', 60) ON CONFLICT DO UPDATE SET count = 60").run();
  for (let i = 0; i < 160; i++) g.api['case/open'](1, { caseId: 'rust', count: 6 });
  const drops = db.prepare("SELECT cls, forced FROM drops WHERE case_id = 'rust' ORDER BY id").all();
  let since = 0, longest = 0;
  for (const d of drops) {
    since = S.rankOf(d.cls) >= S.rankOf(st.cls) ? 0 : since + 1;
    longest = Math.max(longest, since);
  }
  assert.ok(longest < st.n, `longest run without ${st.cls}: ${longest}`);
});

test('city case: a purple car at least every n opens, at least the priced share', () => {
  const { db, g } = setup();
  const [st] = S.pitySteps(S.CASE_BY_ID.city);
  assert.equal(st.cls, 'B');
  for (let i = 0; i < 400; i++) g.api['case/open'](1, { caseId: 'city', count: 6 });
  const drops = db.prepare("SELECT cls FROM drops WHERE case_id = 'city' ORDER BY id").all().map((r) => r.cls);
  let sinceB = 0;
  for (const cls of drops) {
    sinceB = S.rankOf(cls) >= S.rankOf('B') ? 0 : sinceB + 1;
    assert.ok(sinceB < st.n, `no ${st.n}-open streak without purple`);
  }
  const purple = drops.filter((c) => S.rankOf(c) >= S.rankOf('B')).length / drops.length;
  const eff = S.effectiveWeights(S.CASE_BY_ID.city);
  // Losing-streak protection only adds good drops on top of the priced share.
  assert.ok(purple > eff.B - 0.01, `purple-or-better ${purple} ≥ priced share ${eff.B}`);
});

// Open-and-sell (tools/sim-cases.mjs, same seed for both rules, so only the guarantee differs): a case under 1 stays
// under 1, and no case gains more than 3 points of its price from the new steps.
test('economy: the guarantee change keeps open-and-sell in check for every case', () => {
  for (const cs of S.CASES.filter((c) => !c.starter)) {
    const before = simCase(cs, oldSteps(cs), 1e5, 3).sell, after = simCase(cs, S.pitySteps(cs), 1e5, 3).sell;
    assert.ok(after - before < 0.03, `${cs.id}: ${before.toFixed(3)} → ${after.toFixed(3)}`);
    if (before < 1.01) assert.ok(after < 0.99, `${cs.id}: open-and-sell under the price (${after.toFixed(3)})`);
  }
});

test('old counters move to the per-class keys once: same class keeps the count, a new class counts from the drops', () => {
  const db = openDb(':memory:');
  setup(db);
  const ins = db.prepare('INSERT INTO pity (user_id, case_id, count) VALUES (1, ?, ?)');
  ins.run('rust', 17); // old rule: blue (C) after 30 — the new rust step is C too
  ins.run('tuning', 3); // old rule: purple (B) — the new step is gold (A)
  ins.run('c-ua', 40); // more than the new n − 1 (impossible now, but capped)
  const drop = db.prepare("INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, created_at) VALUES (1, ?, 'x', ?, 'h', 'c', 0, 0)");
  drop.run('tuning', 'A');
  for (let i = 0; i < 12; i++) drop.run('tuning', i % 2 ? 'B' : 'C');
  db.prepare("DELETE FROM meta WHERE key = 'pity_steps_1'").run();
  const { g } = setup(db);
  const p = g.api.me(1).pity;
  assert.equal(p['rust:C'], 17);
  assert.equal(p['tuning:A'], 12, 'tuning: opens since the last gold');
  assert.equal(p['c-ua:C'], S.pitySteps(S.CASE_BY_ID['c-ua'])[0].n - 1);
  assert.equal(p.rust, undefined, 'old rows removed');
  assert.equal(p.tuning, undefined);
});
