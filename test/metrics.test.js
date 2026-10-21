// Owner metrics (admin «Метрики», src/metrics.js + adminMetrics in src/game.js): cohort retention on a fixed clock,
// WAU and sessions, the first-session funnel, signup sources, money by source, the one-time user_days backfill, speed
// on 10 000 players; and the casino switched off by default (one-time migration that settles running games).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as M from '../src/metrics.js';
import * as S from '../public/shared.js';
import { honestDrag } from './race-helpers.js';

const H = 3600e3, D = 86400e3;
const T0 = Date.parse('2026-10-01T09:00:00Z'); // 12:00 in Kyiv

function setup(extra = {}, db = openDb(':memory:')) {
  let t = extra.t0 ?? T0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, admins: [1], ...extra });
  const mk = (id, param, more = {}) => (g.ensureUser({ id, first_name: 'U' + id, ...more }, param), id);
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const metrics = (days = 14) => g.adminCall('local', 'metrics', { days });
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  return { db, g, mk, call, metrics, row, all, now: () => t, set: (v) => (t = v), advance: (ms) => (t += ms) };
}

// ---------- the arithmetic, on hand-made rows ----------
test('cohorts: Dk per signup day, null before the day comes, today partial, averages over finished days only', () => {
  const day = M.dayNum;
  const first = day('2026-10-01'), today = day('2026-10-10');
  const users = [
    ...[1, 2, 3, 4].map((id) => ({ id, day: first })),
    { id: 5, day: day('2026-10-03') }, { id: 6, day: day('2026-10-03') },
    { id: 7, day: day('2026-10-09') }, { id: 8, day: today },
  ];
  const act = { 1: ['10-02', '10-04', '10-08'], 2: ['10-02'], 3: ['10-08'], 5: ['10-04', '10-06'], 6: ['10-10'], 7: ['10-10'] };
  const rows = Object.entries(act).flatMap(([u, ds]) => ds.map((d) => ({ day: '2026-' + d, user_id: Number(u), sessions: 1 })));
  const { byUser } = M.indexActivity(rows);
  const { cohorts, avg } = M.retention({ users, byUser, first, today });
  assert.equal(cohorts.length, 10);
  const c1 = cohorts[0], c3 = cohorts[2], c9 = cohorts[8], c10 = cohorts[9];
  assert.equal(c1.day, '2026-10-01');
  assert.equal(c1.size, 4);
  assert.deepEqual([c1.d[1].pct, c1.d[3].pct, c1.d[7].pct], [0.5, 0.25, 0.5]);
  assert.equal(c1.d[14], null, 'day 15 has not come');
  assert.equal(c1.d[30], null);
  assert.deepEqual(c3.d[1], { n: 1, pct: 0.5, partial: false });
  assert.deepEqual(c3.d[7], { n: 1, pct: 0.5, partial: true }, 'D7 of 03.10 is today');
  assert.deepEqual(c9.d[1], { n: 1, pct: 1, partial: true });
  assert.equal(c9.d[3], null);
  assert.equal(c10.d[1], null);
  assert.equal(cohorts[1].size, 0);
  assert.equal(cohorts[1].d[1].pct, null, 'an empty cohort has no share');
  // Finished days only, weighted by size: D1 = (2 + 1) / (4 + 2); 09.10's D1 is today and does not count.
  assert.deepEqual(avg[1], { n: 3, base: 6, pct: 0.5 });
  assert.deepEqual(avg[3], { n: 2, base: 6, pct: 2 / 6 });
  assert.deepEqual(avg[7], { n: 2, base: 4, pct: 0.5 });
  assert.equal(avg[14], null);
});

test('activity: DAU, WAU over 7 days without double counts, sessions per player (backfilled days left out)', () => {
  const rows = [
    { day: '2026-10-02', user_id: 1, sessions: 2 }, { day: '2026-10-02', user_id: 2, sessions: 1 }, { day: '2026-10-02', user_id: 9, sessions: 0 },
    { day: '2026-10-04', user_id: 1, sessions: 1 }, { day: '2026-10-08', user_id: 1, sessions: 3 }, { day: '2026-10-08', user_id: 3, sessions: 1 },
    { day: '2026-10-10', user_id: 6, sessions: 1 },
  ];
  const { byUser, byDay } = M.indexActivity(rows);
  const wau = M.wauByDay(byUser);
  const n = M.dayNum;
  assert.equal(byDay.get(n('2026-10-02')).dau, 3);
  assert.equal(byDay.get(n('2026-10-02')).sessions / byDay.get(n('2026-10-02')).counted, 1.5);
  assert.equal(wau.get(n('2026-10-02')), 3);
  assert.equal(wau.get(n('2026-10-08')), 4, '1, 2, 3, 9 within 02–08');
  assert.equal(wau.get(n('2026-10-09')), 2, '1 and 3 (02.10 has left the window)');
  assert.equal(wau.get(n('2026-10-10')), 3);
  const m = M.buildMetrics({ today: '2026-10-10', first: n('2026-10-04'), users: [], activity: rows, marks: [], money: [], now: Date.parse('2026-10-10T12:00:00Z') });
  assert.deepEqual(m.series.map((x) => x.dau), [1, 0, 0, 0, 2, 0, 1]);
  assert.equal(m.series[0].wau, 3, 'WAU of the first day sees the 6 days before it (1, 2 and 9 on 02.10)');
  assert.equal(m.series[4].sessions, 2);
  assert.equal(m.series[1].sessions, null);
});

test('funnel arithmetic: within 24 h (inclusive) among players older than a day, ever among all, median time', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const users = [{ id: 1, createdAt: now - 3 * D }, { id: 2, createdAt: now - 2 * D }, { id: 3, createdAt: now - 23 * H }];
  const marks = [
    { user_id: 1, step: 'intro', at: now - 3 * D + 60e3 }, { user_id: 1, step: 'drop', at: now - 3 * D + 3 * 60e3 }, { user_id: 1, step: 'L4', at: now - 2 * D },
    { user_id: 2, step: 'intro', at: now - 2 * D + 60e3 }, { user_id: 2, step: 'drop', at: now - D + 1 },
    { user_id: 3, step: 'intro', at: now - 22 * H },
  ];
  const f = M.funnel({ users, marks, now });
  const st = Object.fromEntries(f.steps.map((s) => [s.key, s]));
  assert.equal(f.mature, 2);
  assert.deepEqual([st.intro.d1, st.intro.ever, st.intro.everPct], [2, 3, 1]);
  assert.equal(st.drop.d1, 1, 'a drop 24 h + 1 ms after signup is not first-day');
  assert.equal(st.drop.ever, 2);
  assert.equal(st.drop.fromPrev, 0.5);
  assert.equal(st.L4.d1, 1, 'exactly 24 h still counts');
  assert.equal(st.intro.medianMin, 1);
  assert.deepEqual(f.levels.map((l) => [l.level, l.n]), [[3, 0], [4, 1], [5, 0]]);
});

test('sources and money groups: start parameters and money_src names map to the right rows', () => {
  assert.equal(M.signupSource({ startParam: 'ref_123' }), 'ref');
  assert.equal(M.signupSource({ startParam: 'ch_9' }), 'challenge');
  assert.equal(M.signupSource({ startParam: 'tiktok-oct' }), 'link');
  assert.equal(M.signupSource({}), 'organic');
  assert.equal(M.signupSource({ referrerId: 5 }), 'ref', 'players from before start_param keep their inviter');
  assert.equal(M.signupSource({ startParam: 'ref_1', legacy: true }), 'legacy');
  assert.equal(M.cleanStartParam(' ref_42 '), 'ref_42');
  assert.equal(M.cleanStartParam('a b'), null);
  assert.equal(M.cleanStartParam('x'.repeat(80)).length, 64);
  const cases = { 'case/open': 'cases', 'battle/join': 'cases', sell: 'sales', 'plate/sell': 'sales', 'plate/generate': 'upkeep', 'parts/open': 'cases',
    'parts/merge': 'upkeep', 'race/finish': 'races', collect: 'garage', 'rewards/daily': 'rewards', weekly: 'rewards', 'weekly/chest': 'rewards',
    level: 'levels', signup: 'start', 'market/buy': 'market', auction: 'market', 'casino/close': 'casino', shop: 'shop', 'shop/stars': 'shop',
    'admin/money': 'admin', 'upgrade-cap': 'upkeep', other: 'other', 'something/new': 'other' };
  for (const [src, g] of Object.entries(cases)) assert.equal(M.groupOf(src), g, src);
});

// ---------- through the game, on a fixed clock ----------
test('game: activity days, sessions (30 min gap, new day) and cohorts come from real calls', () => {
  const { mk, call, metrics, row, advance, set } = setup();
  mk(10);
  mk(11);
  advance(10 * 60e3);
  call(10, 'me'); // same session
  advance(40 * 60e3);
  call(10, 'me'); // 40 min later: a new one
  assert.equal(row("SELECT sessions FROM user_days WHERE user_id = 10 AND day = '2026-10-01'").sessions, 2);
  assert.equal(row("SELECT sessions FROM user_days WHERE user_id = 11 AND day = '2026-10-01'").sessions, 1, 'signing in counts the day');
  // Day 2 (Kyiv): only 10 comes back; day 3: 12 signs up; day 4: 10 again (D3 of the first cohort).
  set(T0 + D);
  call(10, 'me');
  set(T0 + 2 * D);
  mk(12);
  set(T0 + 3 * D);
  call(10, 'me');
  call(12, 'me'); // within 15 s of nothing: 12 last signed in a day ago, so this marks the day
  const m = metrics(7);
  assert.equal(m.today, '2026-10-04');
  const c = Object.fromEntries(m.retention.cohorts.map((x) => [x.day, x]));
  assert.equal(c['2026-10-01'].size, 2);
  assert.deepEqual(c['2026-10-01'].d[1], { n: 1, pct: 0.5, partial: false });
  assert.deepEqual(c['2026-10-01'].d[3], { n: 1, pct: 0.5, partial: true });
  assert.deepEqual(c['2026-10-03'].d[1], { n: 1, pct: 1, partial: true });
  assert.deepEqual(m.retention.avg[1], { n: 1, base: 2, pct: 0.5 });
  const s = Object.fromEntries(m.series.map((x) => [x.day, x]));
  assert.deepEqual([s['2026-10-01'].newUsers, s['2026-10-01'].dau, s['2026-10-02'].dau, s['2026-10-04'].dau, s['2026-10-04'].wau], [2, 2, 1, 2, 3]);
  assert.equal(s['2026-10-01'].sessions, 1.5);
});

test('game: the first-session funnel records each step once, levels through XP, the «У гараж» tap from the app', () => {
  const { g, mk, call, metrics, all, db, advance } = setup();
  mk(20);
  call(20, 'intro/seen');
  call(20, 'case/open', { caseId: 'starter' });
  call(20, 'funnel/mark', { step: 'garage' });
  call(20, 'funnel/mark', { step: 'garage' }); // only the first counts
  assert.throws(() => call(20, 'funnel/mark', { step: 'race' }), /Невідомий крок/, 'server-side steps cannot be claimed by the app');
  advance(2 * H);
  call(20, 'collect');
  const car = call(20, 'me').cars[0].id;
  const rv = call(20, 'race/rivals', { carId: car }).list[0].id;
  const st = call(20, 'race/start', { carId: car, rival: rv });
  const run = honestDrag(st.car, st.greenMs, 0.3, Array(S.SHIFTS).fill('good'));
  advance(run.ms + 20);
  call(20, 'race/finish', { raceId: st.raceId, ...run.body });
  // Two level-ups through real XP: put the player just below the next level, then earn a little.
  for (let i = 0; i < 2; i++) {
    const u = db.prepare('SELECT level FROM users WHERE id = 20').get();
    db.prepare('UPDATE users SET xp = ? WHERE id = 20').run(S.xpForLevel(u.level) - 1);
    advance(H);
    call(20, 'case/open', { caseId: S.CASES.find((c) => !c.starter && c.price < 300000).id });
  }
  // An admin-set level is not a funnel step.
  g.adminCall('local', 'set', { id: 20, field: 'level', value: 9, confirm: true, reason: 'тест' });
  const steps = Object.fromEntries(all('SELECT step, at FROM funnel WHERE user_id = 20').map((r) => [r.step, r.at]));
  for (const k of ['intro', 'drop', 'garage', 'collect', 'race']) assert.ok(steps[k], k);
  assert.ok(steps.collect > steps.drop && steps.race > steps.collect);
  const level = db.prepare('SELECT level FROM users WHERE id = 20').get().level;
  assert.equal(level, 9);
  const marked = Object.keys(steps).filter((k) => /^L\d+$/.test(k)).map((k) => Number(k.slice(1))).sort((a, b) => a - b);
  assert.ok(marked.length >= 2 && marked.every((l, i) => l === marked[0] + i) && marked[0] === 2, `levels marked: ${marked}`);
  assert.ok(Math.max(...marked) < 9);
  // 21 signs up, sees the intro, opens his first case only after 25 h.
  mk(21);
  call(21, 'intro/seen');
  advance(25 * H);
  call(21, 'case/open', { caseId: 'starter' });
  // 22 signed up minutes ago: in «ever», not yet in the first-day share.
  mk(22);
  call(22, 'intro/seen');
  const f = metrics(7).funnel;
  const by = Object.fromEntries(f.steps.map((s) => [s.key, s]));
  assert.deepEqual([f.users, f.mature], [3, 2]);
  assert.deepEqual([by.intro.d1, by.intro.ever], [2, 3]);
  assert.deepEqual([by.drop.d1, by.drop.ever, by.drop.d1Pct], [1, 2, 0.5]);
  assert.equal(by.garage.d1, 1);
  assert.equal(by.L3.d1, marked.includes(3) ? 1 : 0);
});

test('game: the start parameter is kept on signup and decides the source; a later sign-in does not change it', () => {
  const { mk, metrics, row, db } = setup();
  mk(500);
  mk(501, 'ref_500');
  mk(502, 'ch_77');
  mk(503, 'tiktok-oct');
  mk(504);
  mk(505, 'bad param!');
  db.prepare('INSERT INTO legacy (id, referrer_id, stars) VALUES (506, NULL, 0)').run();
  mk(506);
  mk(502, 'ref_500');
  assert.equal(row('SELECT start_param p FROM users WHERE id = 501').p, 'ref_500');
  assert.equal(row('SELECT referrer_id r FROM users WHERE id = 501').r, 500);
  assert.equal(row('SELECT start_param p FROM users WHERE id = 502').p, 'ch_77');
  assert.equal(row('SELECT start_param p FROM users WHERE id = 505').p, null);
  const src = Object.fromEntries(metrics(7).sources.map((s) => [s.key, s.n]));
  assert.deepEqual(src, { ref: 1, challenge: 1, link: 1, organic: 3, legacy: 1 });
  assert.equal(metrics(7).viral.n, 2);
});

test('game: money by source adds up to money_days and lands in the right groups', () => {
  const { g, mk, call, metrics, all, row, advance } = setup();
  mk(30);
  call(30, 'case/open', { caseId: 'starter' });
  const paid = S.CASES.find((c) => !c.starter && c.price < 200000);
  call(30, 'case/open', { caseId: paid.id });
  advance(3 * H);
  const got = call(30, 'collect').got;
  g.adminCall('local', 'money', { id: 30, amount: 5000, confirm: true, reason: 'компенсація' });
  const src = Object.fromEntries(all("SELECT src, created, destroyed FROM money_src WHERE day = '2026-10-01'").map((r) => [r.src, r]));
  assert.equal(src.signup.created, S.START_BALANCE);
  assert.ok(src['case/open'].destroyed >= S.caseDeal(paid, '2026-10-01', {}).price * 0.8);
  assert.equal(src.collect.created, got);
  assert.equal(src['admin/money'].created, 5000);
  const sum = all("SELECT SUM(created) c, SUM(destroyed) d FROM money_src WHERE day = '2026-10-01'")[0];
  const md = row("SELECT created c, destroyed d FROM money_days WHERE day = '2026-10-01'");
  assert.deepEqual([sum.c, sum.d], [md.c, md.d], 'money_src splits money_days exactly');
  const groups = Object.fromEntries(metrics(7).money.groups.map((x) => [x.key, x]));
  assert.equal(groups.garage.created, got);
  assert.equal(groups.admin.created, 5000);
  assert.ok(groups.cases.destroyed > 0);
  assert.equal(groups.start.created, S.START_BALANCE);
});

test('admin: metrics is for the owner and admins, not helpers; read-only (no confirm needed)', () => {
  const { g, mk, db } = setup();
  mk(1);
  mk(2);
  mk(3);
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 2").run();
  db.prepare("UPDATE users SET role = 'helper' WHERE id = 3").run();
  assert.ok(g.adminCall('tg:1', 'metrics', {}).retention);
  assert.ok(g.adminCall('tg:2', 'metrics', { days: 60 }).retention.cohorts.length === 60);
  assert.throws(() => g.adminCall('tg:3', 'metrics', {}), /Немає прав/);
  assert.throws(() => g.adminCall('tg:1', 'metrics', { days: 1000 }), /Днів/);
});

test('backfill: days from before user_days existed come from drops, races, payments and the signup day (once)', () => {
  const { db, mk } = setup();
  mk(40);
  const kyiv = (iso) => Date.parse(iso);
  db.prepare("DELETE FROM user_days").run();
  const drop = db.prepare("INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, created_at) VALUES (40, 'rust', 'vaz-2106', 'D', 'h', 'c', 1, ?)");
  drop.run(kyiv('2026-09-20T21:30:00Z')); // 00:30 on 21.09 in Kyiv
  drop.run(kyiv('2026-09-20T22:10:00Z'));
  db.prepare("INSERT INTO races (user_id, car_id, rival, entry, prize, created_at) VALUES (40, 1, '{}', 0, 0, ?)").run(kyiv('2026-09-25T10:00:00Z'));
  db.prepare("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES ('x1', 40, 'p', 50, 1, ?)").run(kyiv('2026-09-27T10:00:00Z'));
  db.prepare("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES ('legacy:9', 40, 'p', 50, 1, ?)").run(kyiv('2026-05-01T10:00:00Z'));
  db.prepare("DELETE FROM meta WHERE key = 'user_days_backfill_1'").run();
  setup({}, db);
  const days = db.prepare('SELECT day, sessions FROM user_days WHERE user_id = 40 ORDER BY day').all();
  assert.deepEqual(days.map((d) => d.day), ['2026-09-21', '2026-09-25', '2026-09-27', '2026-10-01']);
  assert.ok(days.every((d) => d.sessions === 0));
  db.prepare("DELETE FROM user_days WHERE day = '2026-09-25'").run();
  setup({}, db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM user_days WHERE day = '2026-09-25'").get().n, 0, 'runs once');
});

test('backfill: the SQL Kyiv day matches dayOf every 20 minutes across both daylight-saving switches', async () => {
  const { dayOf } = await import('../src/game.js');
  const db = openDb(':memory:');
  db.exec('CREATE TABLE t (created_at INTEGER)');
  const from = Date.parse('2026-03-20T00:00:00Z'), to = Date.parse('2026-11-05T00:00:00Z');
  const ins = db.prepare('INSERT INTO t VALUES (?)');
  for (let x = from; x <= to; x += 20 * 60e3) ins.run(x);
  const rows = db.prepare(`SELECT created_at t, ${M.kyivDaySql('created_at', from, to)} d FROM t`).all();
  const bad = rows.filter((r) => r.d !== dayOf(r.t));
  assert.equal(bad.length, 0, `first mismatch: ${bad[0] && new Date(bad[0].t).toISOString()} ${bad[0]?.d} vs ${bad[0] && dayOf(bad[0].t)}`);
  assert.equal(rows.length, (to - from) / (20 * 60e3) + 1);
});

test('speed: the tab on 10 000 players over 90 days stays fast', () => {
  const { db, set, metrics } = setup();
  const today = T0 + 89 * D;
  db.exec('BEGIN');
  const ins = db.prepare("INSERT INTO users (id, first_name, balance, slots, showcase_slots, income_at, fuel, fuel_at, server_seed, client_seed, created_at, last_seen, start_param) VALUES (?, 'P', 0, 4, 1, ?, 5, ?, 's', 'c', ?, ?, ?)");
  const day = db.prepare('INSERT OR IGNORE INTO user_days (day, user_id, sessions) VALUES (?, ?, ?)');
  const fn = db.prepare('INSERT OR IGNORE INTO funnel (user_id, step, at) VALUES (?, ?, ?)');
  const ms = db.prepare('INSERT OR IGNORE INTO money_src (day, src, created, destroyed) VALUES (?, ?, ?, ?)');
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 10000; i++) {
    const id = 100000 + i, at = T0 + Math.floor(rnd() * 90) * D + Math.floor(rnd() * 20) * H;
    ins.run(id, at, at, at, at, rnd() < 0.3 ? 'ref_1' : null);
    const d0 = Math.floor((at - T0) / D);
    for (let k = 0; k < 40; k++) if (rnd() < 0.6 / (1 + k) && d0 + k < 90) day.run(M.dayStr(M.dayNum('2026-10-01') + d0 + k), id, 1 + Math.floor(rnd() * 3));
    for (const [j, s] of M.FUNNEL_STEPS.entries()) if (rnd() < 0.9 - j * 0.1) fn.run(id, s.key, at + j * 10 * 60e3);
  }
  for (let d = 0; d < 90; d++) for (const s of ['case/open', 'collect', 'sell', 'race/finish', 'level', 'rewards/daily']) ms.run(M.dayStr(M.dayNum('2026-10-01') + d), s, 1e6, 5e5);
  db.exec('COMMIT');
  set(today);
  const t = performance.now();
  const m = metrics(90);
  const took = performance.now() - t;
  assert.equal(m.retention.cohorts.length, 90);
  assert.ok(m.funnel.users > 9000);
  console.log(`# metrics on 10k players / 90 days: ${took.toFixed(0)} ms`);
  // A guard against a slow path (a full scan, n²), not a benchmark: shared CI machines are slow and noisy.
  assert.ok(took < 4000, `took ${took.toFixed(0)} ms`);
});

// ---------- the casino: off by default, one-time migration ----------
// A database "from before the update": the flag removed, the owner's saved mode and its log entry at `savedAt`.
function beforeUpdate(db, mode, savedAt) {
  db.prepare("DELETE FROM meta WHERE key = 'casino_off_2026_10_22'").run();
  if (mode) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('casino_mode', ?) ON CONFLICT DO UPDATE SET value = excluded.value").run(mode);
    db.prepare("INSERT INTO admin_log (admin, action, details, created_at) VALUES ('tg:1', 'casino-mode', ?, ?)").run(JSON.stringify({ from: 'on', to: mode }), savedAt);
  } else db.prepare("DELETE FROM meta WHERE key = 'casino_mode'").run();
}
const crashRow = (db, uid, bet, point, startedAt, auto = null) =>
  Number(db.prepare('INSERT INTO crash_games (user_id, bet, point, auto, started_at) VALUES (?, ?, ?, ?, ?)').run(uid, bet, point, auto, startedAt).lastInsertRowid);

test('casino: off by default; the migration switches an old saved mode off and settles every running game', () => {
  const t0 = Date.parse('2026-10-21T12:00:00Z');
  const a = setup({ t0, allUnlocked: true });
  const { db } = a;
  assert.equal(a.call(a.mk(1), 'me').casino, 'off');
  assert.equal(S.CASINO_DEFAULT, 'off');
  for (const id of [50, 51, 52, 53]) a.mk(id);
  db.prepare('UPDATE users SET balance = 1e7, level = 12 WHERE id >= 50').run();
  beforeUpdate(db, 'on', t0 - H); // the owner had it on (21.10)
  // Running games: mines untouched (50), mines with one safe cell (51); crash in the air (52), crashed long ago and
  // one that hit its auto cash-out (53).
  a.call(50, 'casino/mines/start', { amount: 10000, mines: 3 });
  const m51 = a.call(51, 'casino/mines/start', { amount: 20000, mines: 3 });
  const safe = [...Array(25).keys()].find((c) => !JSON.parse(db.prepare('SELECT layout FROM mines_games WHERE id = ?').get(m51.id).layout).includes(c));
  a.call(51, 'casino/mines/reveal', { cell: safe });
  const now = a.now();
  const inAir = crashRow(db, 52, 30000, 500, now - 5000);
  const crashed = crashRow(db, 53, 40000, 1.2, now - 10 * 60e3);
  const auto = crashRow(db, 53, 50000, 900, now - 60e3, 1.5);
  const bal = (id) => db.prepare('SELECT balance FROM users WHERE id = ?').get(id).balance;
  const before = { 50: bal(50), 51: bal(51), 52: bal(52), 53: bal(53) };
  // The update arrives (a restart with the new code).
  a.advance(1000);
  const b = setup({ t0: a.now(), allUnlocked: true }, db);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'casino_mode'").get().value, 'off');
  assert.ok(db.prepare("SELECT value FROM meta WHERE key = 'casino_off_2026_10_22'").get());
  assert.equal(bal(50) - before[50], 10000, 'untouched mines: the bet back');
  assert.equal(bal(51) - before[51], Math.floor(Math.round(20000 * S.minesMult(3, 1) * 100) / 100));
  const g52 = db.prepare('SELECT * FROM crash_games WHERE id = ?').get(inAir);
  assert.equal(g52.status, 'won');
  assert.equal(g52.cashout, S.crashAt(6));
  assert.equal(bal(52) - before[52], Math.floor(Math.round(30000 * g52.cashout * 100) / 100));
  assert.equal(db.prepare('SELECT status FROM crash_games WHERE id = ?').get(crashed).status, 'lost');
  assert.deepEqual({ ...db.prepare('SELECT status, cashout FROM crash_games WHERE id = ?').get(auto) }, { status: 'won', cashout: 1.5 });
  assert.equal(bal(53) - before[53], 75000, 'the crashed round pays nothing, the auto cash-out pays ×1.5');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mines_games WHERE status = 'running'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM crash_games WHERE status = 'running'").get().n, 0);
  assert.ok(db.prepare("SELECT 1 FROM events WHERE user_id = 52 AND text LIKE '%Краш%'").get());
  const log = db.prepare("SELECT admin, details FROM admin_log WHERE action = 'casino-mode' ORDER BY id DESC LIMIT 1").get();
  assert.equal(log.admin, 'system');
  assert.deepEqual((({ from, to, settled }) => ({ from, to, settled }))(JSON.parse(log.details)), { from: 'on', to: 'off', settled: 3 });
  assert.ok(db.prepare("SELECT created FROM money_src WHERE src = 'casino/close'").get().created > 0);
  assert.equal(b.call(50, 'me').casino, 'off');
  assert.throws(() => b.call(50, 'casino/slots', { amount: 10000 }), /Казино вимкнено/);
  // Once only: the owner switches it back on and a later restart keeps his choice.
  b.g.adminCall('tg:1', 'casino-mode', { mode: 'on', confirm: true, reason: 'тест' });
  setup({ t0: a.now() + D, allUnlocked: true }, db);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'casino_mode'").get().value, 'on');
});

test('casino: a mode the owner chose on 22.10 or later stays; no saved mode on a live database goes off by default', () => {
  const t0 = Date.parse('2026-10-22T12:00:00Z');
  const a = setup({ t0, allUnlocked: true });
  a.mk(60);
  beforeUpdate(a.db, 'wheel', Date.parse('2026-10-22T08:00:00+03:00'));
  setup({ t0, allUnlocked: true }, a.db);
  assert.equal(a.db.prepare("SELECT value FROM meta WHERE key = 'casino_mode'").get().value, 'wheel');
  assert.equal(a.call(60, 'me').casino, 'wheel');
  // Saved on 21.10 at 23:59 Kyiv: before the decision → off.
  beforeUpdate(a.db, 'on', Date.parse('2026-10-21T23:59:00+03:00'));
  setup({ t0, allUnlocked: true }, a.db);
  assert.equal(a.call(60, 'me').casino, 'off');
  // Never saved, players in the game (they had the casino by the old default) and a mines game left running.
  const c = setup({ t0, allUnlocked: true });
  c.mk(61);
  c.db.prepare('UPDATE users SET balance = 1e7 WHERE id = 61').run();
  c.db.prepare("INSERT INTO meta (key, value) VALUES ('casino_mode', 'on')").run();
  c.call(61, 'casino/mines/start', { amount: 10000, mines: 1 });
  beforeUpdate(c.db, null);
  const before = c.db.prepare('SELECT balance FROM users WHERE id = 61').get().balance;
  setup({ t0, allUnlocked: true }, c.db);
  assert.equal(c.call(61, 'me').casino, 'off');
  assert.equal(c.db.prepare('SELECT balance FROM users WHERE id = 61').get().balance - before, 10000);
  const log = JSON.parse(c.db.prepare("SELECT details FROM admin_log WHERE admin = 'system' AND action = 'casino-mode'").get().details);
  assert.deepEqual([log.from, log.to, log.settled], ['on', 'off', 1]);
  // A brand-new database has nothing to log.
  const fresh = setup({ t0 });
  assert.equal(fresh.db.prepare("SELECT COUNT(*) n FROM admin_log WHERE admin = 'system'").get().n, 0);
});
