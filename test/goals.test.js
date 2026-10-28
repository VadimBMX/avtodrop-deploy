// «Цілі дня» (src/goals.js, S.QUESTS): three small goals a day from open features, a key for all three, a run of such
// days with a weekly freeze, the evening bot line, and the balance against the old daily tasks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, dayOf } from '../src/game.js';
import { PUSH, pickReminder } from '../src/reminders.js';
import * as S from '../public/shared.js';

const H = 3600e3, D = 86400e3;
// Wednesday 2026-10-14, 13:00 in Kyiv (UTC+3).
const T0 = Date.parse('2026-10-14T10:00:00Z');

function setup({ t0 = T0, allUnlocked = true } = {}) {
  const db = openDb(':memory:');
  const clock = { t: t0 };
  const g = createGame(db, { now: () => clock.t, random: () => 0.5, allUnlocked, notify: () => {} });
  const mk = (id, level = 10) => {
    g.ensureUser({ id, username: 'u' + id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, balance = ? WHERE id = ?').run(level, 1e9, id);
    return id;
  };
  const keys = (id, caseId) => db.prepare('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(id, caseId)?.count || 0;
  // Today's goals replaced with known ones: [key, target, progress].
  const goals = (id, list, day = dayOf(clock.t)) => {
    g.api.quests(id);
    db.prepare('DELETE FROM quests WHERE user_id = ? AND day = ?').run(id, day);
    for (const [key, target, progress = 0] of list) db.prepare('INSERT INTO quests (user_id, day, key, target, progress, reward) VALUES (?, ?, ?, ?, ?, 1000)').run(id, day, key, target, progress);
  };
  // A whole day done (rows made complete, then any read notices it).
  const doneDay = (id) => {
    goals(id, [['open', 1, 1], ['race', 1, 1], ['collect', 1, 1]]);
    return g.api.goals(id);
  };
  return { db, g, clock, mk, keys, goals, doneDay };
}

test('pool: three different goals from open features, one per group, the same all day, varied over days', () => {
  const { g, clock, mk } = setup();
  const seen = new Set();
  for (let id = 1; id <= 30; id++) {
    mk(id, 10);
    const a = g.api.quests(id).list;
    assert.equal(a.length, S.QUEST_COUNT);
    assert.equal(new Set(a.map((x) => S.QUESTS[x.key].group)).size, 3, 'cases / race / garage');
    for (const x of a) {
      const [lo, hi] = S.QUESTS[x.key].range;
      assert.ok(x.target >= lo && x.target <= hi && hi <= 5, `${x.key} is small`);
      assert.ok(!S.QUESTS[x.key].off, `${x.key} is not picked any more`);
      assert.equal(x.reward, S.questReward(10));
      seen.add(x.key);
    }
    assert.deepEqual(g.api.quests(id).list, a, 'stable within the day');
  }
  assert.ok(seen.size >= 10, `the pool is used widely (${[...seen]})`);
  // The next day another set (for most players).
  const day1 = Object.fromEntries([1, 2, 3, 4, 5].map((id) => [id, g.api.quests(id).list.map((x) => x.key).join()]));
  clock.t += D;
  const changed = [1, 2, 3, 4, 5].filter((id) => g.api.quests(id).list.map((x) => x.key).join() !== day1[id]).length;
  assert.ok(changed >= 3);
});

test('pool: locked features and the level gate of «Причал» are respected', () => {
  const { g, mk } = setup({ allUnlocked: false });
  for (let id = 100; id < 140; id++) {
    mk(id, 1);
    for (const x of g.api.quests(id).list) assert.ok(!S.QUESTS[x.key].feature, `${x.key} for a level-1 player`);
  }
  const s2 = setup();
  for (let id = 200; id < 260; id++) {
    s2.mk(id, 2);
    assert.ok(!s2.g.api.quests(id).list.some((x) => x.key === 'bid'), 'bids only from level 3 (the first container)');
  }
});

test('progress comes from real actions: plates, cases and income; all three → one key of the level, once', () => {
  const { g, clock, mk, keys, goals } = setup();
  const id = mk(1, 14); // city key
  goals(id, [['plate', 1], ['open', 2], ['collect', 1]]);
  g.api['plate/generate'](id, { gen: 'basic' });
  g.api['case/open'](id, { caseId: 'rust', count: 1 });
  let m = g.api.me(id).goals;
  assert.deepEqual(m.list.map((x) => [x.key, x.progress]), [['plate', 1], ['open', 1], ['collect', 0]]);
  assert.equal(m.done, 1);
  assert.equal(m.complete, false);
  assert.throws(() => g.api['goals/key'](id), /усі три/);
  g.api['case/open'](id, { caseId: 'rust', count: 3 });
  clock.t += H;
  g.api.collect(id);
  m = g.api.me(id).goals;
  assert.equal(m.done, 3);
  assert.equal(m.complete, true);
  assert.equal(m.keyReady, 1);
  assert.equal(m.caseId, 'city');
  assert.equal(m.streak, 1);
  const claim = g.api.pulse(id).claims.find((c) => c.kind === 'goalkey');
  assert.match(claim.sub, /ключ «Міський»/);
  const before = keys(id, 'city');
  const r = g.api['goals/key'](id);
  assert.deepEqual(r.keys, [{ caseId: 'city', count: 1 }]);
  assert.equal(keys(id, 'city'), before + 1);
  assert.throws(() => g.api['goals/key'](id), /усі три/);
  assert.ok(!g.api.pulse(id).claims.some((c) => c.kind === 'goalkey'));
  // The task money is claimed as before, apart from the key.
  assert.equal(g.api['quests/claim'](id, { key: 'plate' }).got, 1000);
});

test('«Забрати все» takes the key with the rest and shows it in the reveal; a day left unclaimed still waits', () => {
  const { g, clock, mk, keys, doneDay } = setup();
  const id = mk(1, 5);
  doneDay(id);
  clock.t += D; // the key of yesterday was not taken
  const p = g.api.pulse(id).claims.find((c) => c.kind === 'goalkey');
  assert.ok(p);
  const r = g.api['rewards/all'](id);
  assert.ok(r.kinds.includes('goalkey'));
  assert.ok(r.reveal.some((x) => x.kind === 'key' && x.caseId === 'rust' && x.title === 'Цілі дня'));
  assert.equal(keys(id, 'rust') >= 1, true);
  assert.equal(g.api.me(id).goals.keyReady, 0);
});

test('the run: 7 complete days → two better keys; a missed day is frozen once a week; two missed days end it', () => {
  const { g, clock, mk, keys, doneDay } = setup({ t0: Date.parse('2026-10-12T09:00:00Z') }); // Monday
  const id = mk(1, 14); // day key city, run reward 2 × tuning
  for (let i = 0; i < 6; i++) {
    assert.equal(doneDay(id).streak, i + 1);
    clock.t += D;
  }
  let m = doneDay(id); // Sunday: 7th day
  assert.equal(m.streak, 7);
  assert.equal(m.streakReady, 1);
  assert.equal(m.next, 14);
  const c = g.api.pulse(id).claims.find((x) => x.kind === 'gstreak');
  assert.match(c.title, /7 днів/);
  assert.match(c.sub, /2 × ключ «Тюнінг-ательє»/);
  const r = g.api['goals/streak'](id);
  assert.deepEqual(r.keys, [{ caseId: 'tuning', count: 2 }]);
  assert.equal(keys(id, 'tuning'), 2);
  assert.throws(() => g.api['goals/streak'](id), /Немає/);
  // Monday missed; Tuesday done → the freeze of this week covered Monday, the run goes on without growing.
  clock.t += 2 * D;
  m = g.api.goals(id);
  assert.equal(m.streak, 7, 'shown as alive (frozen) before the day is done');
  assert.equal(m.frozen, true);
  m = doneDay(id);
  assert.equal(m.streak, 8);
  assert.equal(m.freezeReady, false);
  // Wednesday missed again (same week, no freeze left) → Thursday starts over.
  clock.t += 2 * D;
  assert.equal(g.api.goals(id).streak, 0);
  assert.equal(doneDay(id).streak, 1);
  // Two days missed in a row → over even with a fresh week's freeze.
  clock.t = Date.parse('2026-10-26T09:00:00Z'); // next Monday
  doneDay(id);
  clock.t += 3 * D;
  assert.equal(doneDay(id).streak, 1);
  assert.equal(g.api.goals(id).best, 8);
});

test('evening bot line: from 18:00 Kyiv, one goal short or a 3+ day run; not when done, opted out or too far', () => {
  const { db, g, clock, mk, goals, doneDay } = setup({ t0: Date.parse('2026-10-14T06:00:00Z') });
  const a = mk(1, 14), b = mk(2, 14), c = mk(3, 14), d = mk(4, 14), e = mk(5, 14);
  goals(a, [['open', 1, 1], ['race', 1, 1], ['collect', 2, 0]]);
  goals(b, [['open', 1, 0], ['race', 1, 0], ['collect', 2, 0]]); // 3 left, no run → nothing
  goals(c, [['open', 1, 1], ['race', 1, 1], ['collect', 1, 1]]);
  g.api.goals(c); // done
  goals(d, [['open', 1, 1], ['race', 1, 1], ['collect', 2, 0]]);
  db.prepare('UPDATE users SET push_off = 1 WHERE id = ?').run(d);
  // e: a 3-day run, nothing done today.
  for (let i = 3; i >= 1; i--) {
    clock.t = Date.parse('2026-10-14T06:00:00Z') - i * D;
    doneDay(e);
  }
  clock.t = Date.parse('2026-10-14T06:00:00Z');
  goals(e, [['open', 2, 0], ['race', 2, 0], ['collect', 2, 0]]);
  db.prepare('UPDATE users SET last_seen = ?').run(Date.parse('2026-10-14T09:00:00Z'));
  const item = (uid) => g.pushCandidates(PUSH).find((x) => x.uid === uid)?.ready.find((r) => r.kind === 'goals');
  clock.t = Date.parse('2026-10-14T14:30:00Z'); // 17:30 Kyiv
  assert.equal(item(a), undefined);
  clock.t = Date.parse('2026-10-14T15:30:00Z'); // 18:30 Kyiv
  assert.equal(item(a).text, '🔑 Ще 1 ціль дня — і ключ «Міський» твій');
  assert.equal(item(b), undefined);
  assert.equal(item(c), undefined);
  assert.equal(item(d), undefined);
  assert.equal(item(e).text, '🔥 Серія цілей 3 дні — лишилось 3 цілі до опівночі');
  const cand = g.pushCandidates(PUSH).find((x) => x.uid === a);
  const kinds = pickReminder(cand, clock.t);
  assert.ok(kinds.includes('goals'));
  g.pushMark(a, kinds, clock.t);
  assert.equal(item(a), undefined, 'once a day');
  // Muted with the «Бонуси» group.
  assert.equal(pickReminder({ ...g.pushCandidates(PUSH).find((x) => x.uid === e), mute: 'bonus' }, clock.t)?.includes('goals') || false, false);
});

test('balance: day keys and the run add at most +35% to what the old daily tasks paid (level 3–60); no per-goal cut', () => {
  const sell = (id) => S.CASE_BY_ID[id].sellEv;
  for (let lvl = 3; lvl <= 60; lvl++) {
    // The old tasks: (8000 + 4000 × average target) × level^1.3 each, three a day.
    const old = 21 * Math.round((8000 + 4000 * 3.6) * Math.pow(lvl, 1.3) / 100) * 100;
    const money = 21 * S.questReward(lvl);
    const rw = S.goalStreakReward(lvl);
    const extra = 7 * sell(S.goalKey(lvl)) + rw.count * sell(rw.caseId);
    assert.ok(Math.abs(money - old) / old < 0.01, `level ${lvl}: the money per task stays`);
    assert.ok((money + extra) / old <= 1.35, `level ${lvl}: +${(((money + extra) / old - 1) * 100).toFixed(1)}%`);
  }
  // The ladders only go up, and the run's key is always the better one.
  const order = S.CASES.map((c) => c.id);
  for (let lvl = 1; lvl < 80; lvl++) {
    assert.ok(order.indexOf(S.goalKey(lvl + 1)) >= order.indexOf(S.goalKey(lvl)));
    assert.ok(order.indexOf(S.goalStreakReward(lvl).caseId) > order.indexOf(S.goalKey(lvl)));
  }
});

test('«Заїзд дня» runs and «Причал» bids count for their goals', async () => {
  const { honestDrag } = await import('./race-helpers.js');
  const { db, g, clock, mk, goals } = setup({ t0: Date.parse('2026-10-23T10:00:00Z') });
  const id = mk(1, 6);
  goals(id, [['dayrace', 1], ['bid', 1], ['collect', 5]]);
  const st = g.api['dayrace/start'](id);
  const r = honestDrag(st.car, st.greenMs, 0.2, ['good', 'good', 'good', 'good']);
  clock.t += r.ms + 30;
  g.api['race/finish'](id, { raceId: st.raceId, ...r.body });
  const lot = g.api.containers(id).lots.find((l) => l.tier === 'odesa');
  const d = g.api['containers/lot'](id, { id: lot.id });
  g.api['containers/bid'](id, { id: lot.id, amount: d.lot.minBid });
  const p = Object.fromEntries(g.api.goals(id).list.map((x) => [x.key, x.progress]));
  assert.deepEqual(p, { dayrace: 1, bid: 1, collect: 0 });
  void db;
});
