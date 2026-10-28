// «Цілі дня» (night 28.10): on top of the three daily tasks (S.QUESTS, game.js ensureQuests / track). The tasks stay
// what they were (progress from real actions through track(), money per task, the weekly route's active days); this
// adds the hook to come back every day:
//   · all three done on a Kyiv day → a key (S.goalKey of the level at that moment), claimed by hand or «Забрати все»;
//   · days in a row with all three done → every S.GOAL_STREAK.every-th day S.goalStreakReward (two better keys);
//     one missed day a Monday-based week is covered by a freeze, by itself — the same rule as the race streak
//     (game.js freezeCover): the frozen day keeps the run but doesn't add to it, two missed days end it;
//   · an evening bot line «ще 1 ціль до ключа» (src/reminders.js kind 'goals', the usual limits).
// Tables: goal_days (one row per completed day: the key and whether it was taken), goal_streak (like race_streak).
import * as S from '../public/shared.js';

export const GOAL_REMIND_HOUR = 18; // Kyiv; the line goes out from here until the quiet hours
const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' });
const kyivHour = (t) => Number(HOUR.format(new Date(t)));

export function createGoals({ q, now, dayOf, fail, addKeys, userRow, ensureQuests, freezeCover, mondayOfDay, weekOf, isGameError }) {
  const counts = (uid, day) => q('SELECT COUNT(*) total, COALESCE(SUM(progress >= target), 0) done FROM quests WHERE user_id = ? AND day = ?').get(uid, day);

  // Called by track() whenever a task moved, and lazily by the readers: the day becomes complete once, here.
  function hit(uid, day = dayOf(now())) {
    if (day !== dayOf(now())) return false; // only today's tasks start a key (a row from an earlier day is history)
    const c = counts(uid, day);
    if (c.total < S.QUEST_COUNT || c.done < c.total) return false;
    const u = userRow(uid);
    if (!q('INSERT OR IGNORE INTO goal_days (user_id, day, case_id, claimed, at) VALUES (?, ?, ?, 0, ?)').run(uid, day, S.goalKey(u.level), now()).changes) return false;
    const r = q('SELECT * FROM goal_streak WHERE user_id = ?').get(uid) || { n: 0, day: null, start: null, best: 0, freeze: null, ready: '[]' };
    if (r.day && r.day >= day) return true;
    const cover = r.day ? freezeCover(r.day, day, r.freeze) : null;
    const alive = cover !== null;
    const n = alive ? r.n + 1 : 1, start = alive ? r.start : day, freeze = cover || r.freeze;
    const ready = JSON.parse(r.ready || '[]');
    if (n % S.GOAL_STREAK.every === 0) ready.push({ m: n, day, ...S.goalStreakReward(u.level) });
    q(`INSERT INTO goal_streak (user_id, n, day, start, best, freeze, ready) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET n = excluded.n, day = excluded.day, start = excluded.start, best = excluded.best, freeze = excluded.freeze, ready = excluded.ready`)
      .run(uid, n, day, start, Math.max(r.best, n), freeze, JSON.stringify(ready));
    return true;
  }

  // The run as it stands today: a missed day covered by the week's freeze shows as frozen (used for good on the next
  // complete day), a run whose last day is too far back is 0.
  function streakOf(uid) {
    const r = q('SELECT * FROM goal_streak WHERE user_id = ?').get(uid);
    const today = dayOf(now());
    const cover = r?.day ? freezeCover(r.day, today, r.freeze) : null;
    const alive = !!r?.day && cover !== null;
    const n = alive ? r.n : 0;
    const lastFreeze = cover || r?.freeze || null;
    return {
      n, best: r?.best || 0, today: r?.day === today, frozen: !!cover,
      freezeReady: !lastFreeze || mondayOfDay(lastFreeze) < weekOf(now()),
      ready: JSON.parse(r?.ready || '[]'),
    };
  }

  const unclaimed = (uid) => q('SELECT day, case_id FROM goal_days WHERE user_id = ? AND claimed = 0 ORDER BY day').all(uid);

  // `me.goals`: what the garage card and the «Завдання» page draw.
  function brief(uid) {
    const day = ensureQuests(uid);
    hit(uid, day);
    const lvl = userRow(uid).level;
    const list = q('SELECT key, target, progress, claimed FROM quests WHERE user_id = ? AND day = ? ORDER BY rowid').all(uid, day)
      .map((r) => ({ key: r.key, target: r.target, progress: Math.min(r.progress, r.target), claimed: !!r.claimed }));
    const st = streakOf(uid);
    const todayRow = q('SELECT case_id, claimed FROM goal_days WHERE user_id = ? AND day = ?').get(uid, day);
    const next = S.nextGoalMilestone(st.n);
    return {
      day, list, done: list.filter((x) => x.progress >= x.target).length, total: list.length,
      caseId: todayRow?.case_id || S.goalKey(lvl), complete: !!todayRow, keyReady: unclaimed(uid).length,
      streak: st.n, best: st.best, today: st.today, frozen: st.frozen, freezeReady: st.freezeReady,
      next, nextReward: S.goalStreakReward(lvl), streakReady: st.ready.length,
    };
  }

  // Keys of completed days not taken yet (normally just today's; one left at midnight still waits).
  function claimKey(uid) {
    hit(uid);
    const rows = unclaimed(uid);
    if (!rows.length) fail('Спершу виконай усі три цілі дня');
    const keys = {};
    for (const r of rows) {
      if (!q('UPDATE goal_days SET claimed = 1 WHERE user_id = ? AND day = ? AND claimed = 0').run(uid, r.day).changes) continue;
      keys[r.case_id] = (keys[r.case_id] || 0) + 1;
    }
    const list = Object.entries(keys).map(([caseId, count]) => (addKeys(uid, caseId, count), { caseId, count }));
    if (!list.length) fail('Ключ уже забрано');
    return { keys: list, days: rows.map((r) => r.day) };
  }
  function claimStreak(uid) {
    const r = q('SELECT ready FROM goal_streak WHERE user_id = ?').get(uid);
    const ready = JSON.parse(r?.ready || '[]');
    if (!ready.length) fail('Немає нагород за серію цілей');
    // Emptied first: a second call (double tap, «Забрати все» in another tab) finds nothing.
    if (!q("UPDATE goal_streak SET ready = '[]' WHERE user_id = ? AND ready = ?").run(uid, r.ready).changes) fail('Нагороду вже отримано');
    const keys = {};
    for (const x of ready) keys[x.caseId] = (keys[x.caseId] || 0) + x.count;
    const list = Object.entries(keys).map(([caseId, count]) => (addKeys(uid, caseId, count), { caseId, count }));
    return { keys: list, milestones: ready.map((x) => x.m) };
  }

  const keyText = (list) => list.map((k) => `${k.count > 1 ? `${k.count} × ` : ''}ключ «${S.CASE_BY_ID[k.caseId]?.name || k.caseId}»`).join(' + ');
  // Pulse: the rewards center and the gift badge.
  function claims(uid) {
    const out = [];
    const rows = unclaimed(uid);
    if (rows.length) {
      const by = {};
      for (const r of rows) by[r.case_id] = (by[r.case_id] || 0) + 1;
      out.push({ key: 'goalkey:' + rows.map((r) => r.day).join(','), kind: 'goalkey', title: 'Цілі дня виконано', sub: keyText(Object.entries(by).map(([caseId, count]) => ({ caseId, count }))) });
    }
    const r = q('SELECT ready FROM goal_streak WHERE user_id = ?').get(uid);
    const ready = JSON.parse(r?.ready || '[]');
    if (ready.length) out.push({ key: 'gstreak:' + ready.map((x) => x.m).join(','), kind: 'gstreak', title: `Серія цілей: ${ready[ready.length - 1].m} ${S.daysWord(ready[ready.length - 1].m)}`, sub: keyText(ready.map((x) => ({ caseId: x.caseId, count: x.count }))) });
    return out;
  }

  // «Забрати все»: both claims ride along; their keys join the reveal (opened by the app like any key).
  function rewardsAll(uid, base) {
    const got = [];
    for (const [kind, fn, title] of [['goalkey', claimKey, 'Цілі дня'], ['gstreak', claimStreak, 'Серія цілей']]) {
      try {
        got.push({ kind, title, ...fn(uid) });
      } catch (e) {
        if (!isGameError(e)) throw e;
      }
    }
    let r;
    try {
      r = base();
    } catch (e) {
      if (!got.length || !isGameError(e)) throw e;
      r = { n: 0, kinds: [], money: 0, parts: 0, slots: 0, fuel: false, cosmetics: [], reveal: [] };
    }
    if (!got.length) return r;
    const keys = got.flatMap((g) => g.keys.map((k) => ({ kind: 'key', caseId: k.caseId, count: k.count, title: g.title })));
    const order = { rcase: 0, key: 1, car: 2 };
    return { ...r, n: r.n + got.length, kinds: [...r.kinds, ...got.map((g) => g.kind)], reveal: [...(r.reveal || []), ...keys].sort((a, b) => (order[a.kind] ?? 1) - (order[b.kind] ?? 1)) };
  }

  // The evening bot line: one goal short of the key, or a run of 3+ days that ends at midnight. Players with nothing
  // else ready join the list with this one item; src/reminders.js applies quiet hours, 2 a day, idle and opt-outs.
  function remind(list, rules) {
    const t = now();
    if (kyivHour(t) < GOAL_REMIND_HOUR) return list;
    const day = dayOf(t);
    const rows = q(`SELECT u.id, u.last_seen, u.push_day, u.push_count, u.push_last, u.push_sent, COUNT(x.key) total, COALESCE(SUM(x.progress >= x.target), 0) done
      FROM users u JOIN quests x ON x.user_id = u.id AND x.day = ?
      WHERE u.push_off = 0 AND u.push_blocked = 0 AND u.banned = 0 AND u.last_seen BETWEEN ? AND ? AND NOT (u.push_day = ? AND u.push_count >= ?)
        AND NOT EXISTS (SELECT 1 FROM goal_days g WHERE g.user_id = u.id AND g.day = ?)
      GROUP BY u.id HAVING done < total`).all(day, t - rules.inactiveDays * 86400e3, t - rules.idleMin * 60e3, day, rules.maxPerDay, day);
    if (!rows.length) return list;
    const byId = new Map(list.map((c) => [c.uid, c]));
    const at = S.kyivMidnightOf(day) + GOAL_REMIND_HOUR * 3600e3;
    for (const u of rows) {
      let sent = {};
      try {
        sent = JSON.parse(u.push_sent || '{}') || {};
      } catch {}
      if (sent.goals && dayOf(sent.goals) === day) continue;
      if (u.push_last && t - u.push_last < rules.minGapH * 3600e3) continue;
      const left = u.total - u.done, st = streakOf(u.id);
      if (left > 1 && st.n < 3) continue; // nothing close enough to be worth a message
      const caseName = S.CASE_BY_ID[S.goalKey(userRow(u.id).level)]?.name || '';
      const text = left === 1
        ? `🔑 Ще 1 ціль дня — і ключ «${caseName}» твій${st.n >= 2 ? ` (серія ${st.n} ${S.daysWord(st.n)} не перерветься)` : ''}`
        : `🔥 Серія цілей ${st.n} ${S.daysWord(st.n)} — лишилось ${left} цілі до опівночі`;
      const item = { kind: 'goals', at, text };
      const c = byId.get(u.id);
      if (c) c.ready.push(item);
      else list.push({ uid: u.id, lastSeen: u.last_seen, pushOff: false, blocked: false, pushDay: u.push_day, pushCount: u.push_count, pushLast: u.push_last, sent, ready: [item] });
    }
    return list;
  }

  return { hit, brief, claims, rewardsAll, remind, streakOf, api: { goals: brief, 'goals/key': claimKey, 'goals/streak': claimStreak } };
}
