// «Ніч Хелловіну» on the server (rules: public/halloween.js). The calendar decides when it runs; the only state is the
// admin's switch (meta 'halloween_mode': 'on' | 'off' | absent = by the calendar) and the players' task progress
// (hw_tasks, one row per event year, player and task). Tasks count only while the event runs (fed from the game's
// track(): the same actions as the daily/weekly tasks) and pay once — done_at is set by a guarded UPDATE, so a task
// can't be paid twice whatever runs at the same time. The ghost container lives in src/containers.js (eventOn).
import crypto from 'node:crypto';
import * as S from '../public/shared.js';
import * as HW from '../public/halloween.js';

const MODE_KEY = 'halloween_mode';

export function createHalloween(ctx) {
  const { q, now, fail, metaGet, metaSet, addKeys, giveCar, garageCount, userRow, grantCosmetic, styleOf, styleWear, alog } = ctx;
  const rnd = ctx.random || (() => crypto.randomInt(1e9) / 1e9);
  const mode = () => (HW.HW_MODES.includes(metaGet(MODE_KEY)) ? metaGet(MODE_KEY) : 'auto');
  const on = (t = now()) => HW.hwActive(t, mode());
  const tell = (uid, text) => q('INSERT INTO events (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, text, now());

  const rowsOf = (uid, key) => Object.fromEntries(q('SELECT task, progress, done_at, prize FROM hw_tasks WHERE event = ? AND user_id = ?').all(key, uid).map((r) => [r.task, r]));
  // A finished task: marked done exactly once, then paid.
  function finish(uid, key, task) {
    const t = now();
    q('INSERT OR IGNORE INTO hw_tasks (event, user_id, task, progress) VALUES (?, ?, ?, 0)').run(key, uid, task.id);
    if (!q('UPDATE hw_tasks SET progress = ?, done_at = ? WHERE event = ? AND user_id = ? AND task = ? AND done_at IS NULL').run(task.n, t, key, uid, task.id).changes) return null;
    const prize = pay(uid, task);
    q('UPDATE hw_tasks SET prize = ? WHERE event = ? AND user_id = ? AND task = ?').run(JSON.stringify(prize), key, uid, task.id);
    tell(uid, `🎃 Ніч Хелловіну: «${task.text}» — виконано! ${prize.text}`);
    return prize;
  }
  function pay(uid, task) {
    const r = task.reward, u = userRow(uid);
    if (r.frame) {
      grantCosmetic(uid, HW.HW_FRAME);
      if (!styleOf(uid).frame) styleWear(uid, HW.HW_FRAME); // on at once unless another frame is worn
      return { frame: HW.HW_FRAME, text: 'Рамка номера «Гарбуз» — уже на твоїх номерах' };
    }
    if (r.edition && rnd() < r.edition) {
      const g = giveCar(uid, HW.HW_EDITION, 'halloween');
      q('INSERT INTO edition_serials (model, next) VALUES (?, 1) ON CONFLICT DO NOTHING').run(HW.HW_EDITION);
      const serial = q('SELECT next FROM edition_serials WHERE model = ?').get(HW.HW_EDITION).next;
      q('UPDATE edition_serials SET next = next + 1 WHERE model = ?').run(HW.HW_EDITION);
      q('UPDATE cars SET serial = ? WHERE id = ?').run(serial, g.id);
      if (garageCount(uid) > u.slots) q("UPDATE cars SET status = 'showcase' WHERE id = ?").run(g.id);
      return { edition: HW.HW_EDITION, carId: g.id, serial, text: `Випав тиражний «№ 13» ${S.serialText(serial)}!` };
    }
    const caseId = S.levelKey(u.level), n = r.keys || 1;
    addKeys(uid, caseId, n);
    return { caseId, count: n, text: `${n > 1 ? `${n} ключі` : 'Ключ'} «${S.CASE_BY_ID[caseId].name}»${r.edition ? ' (тиражний цього разу не випав)' : ''}` };
  }
  // Called from the game's track(uid, key, n) for every counted action.
  function track(uid, key, n = 1) {
    if (!on()) return;
    const tasks = HW.HW_TASKS.filter((t) => t.track === key);
    if (!tasks.length) return;
    const ek = HW.hwKey(now());
    for (const task of tasks) {
      q('INSERT OR IGNORE INTO hw_tasks (event, user_id, task, progress) VALUES (?, ?, ?, 0)').run(ek, uid, task.id);
      q('UPDATE hw_tasks SET progress = MIN(?, progress + ?) WHERE event = ? AND user_id = ? AND task = ? AND done_at IS NULL').run(task.n, n, ek, uid, task.id);
      const r = q('SELECT progress, done_at FROM hw_tasks WHERE event = ? AND user_id = ? AND task = ?').get(ek, uid, task.id);
      if (!r.done_at && r.progress >= task.n) finish(uid, ek, task);
    }
    const rows = rowsOf(uid, ek);
    const last = HW.HW_TASKS.find((t) => t.all);
    if (last && !rows[last.id]?.done_at && HW.HW_TASKS.filter((t) => !t.all).every((t) => rows[t.id]?.done_at)) finish(uid, ek, last);
  }

  // For `me`: null when the event is off (its content hides); otherwise the window and the tasks with progress/prizes.
  function brief(uid) {
    if (!on()) return null;
    const t = now(), ek = HW.hwKey(t), w = HW.hwWindow(HW.hwYearOf(t)), rows = rowsOf(uid, ek), u = userRow(uid);
    const doneN = HW.HW_TASKS.filter((x) => !x.all && rows[x.id]?.done_at).length;
    return {
      on: true, key: ek, start: w.start, end: mode() === 'on' && !HW.hwInWindow(t) ? null : w.end, forced: mode() === 'on',
      tasks: HW.HW_TASKS.map((x) => {
        const r = rows[x.id];
        const progress = x.all ? doneN : Math.min(x.n, r?.progress || 0);
        return { id: x.id, text: x.text, icon: x.icon, n: x.n, progress: r?.done_at ? x.n : progress, done: !!r?.done_at, reward: HW.hwRewardText(x, u.level), prize: r?.prize ? JSON.parse(r.prize) : null };
      }),
      frame: !!q('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(uid, HW.HW_FRAME),
    };
  }

  // ---------- admin ----------
  function adminView() {
    const t = now(), y = HW.hwYearOf(t), w = HW.hwWindow(y), ek = HW.hwKey(t);
    const done = Object.fromEntries(HW.HW_TASKS.map((x) => [x.id, q('SELECT COUNT(*) n FROM hw_tasks WHERE event = ? AND task = ? AND done_at IS NOT NULL').get(ek, x.id).n]));
    return {
      mode: mode(), on: on(), inWindow: HW.hwInWindow(t), start: w.start, end: w.end, key: ek,
      players: q('SELECT COUNT(DISTINCT user_id) n FROM hw_tasks WHERE event = ?').get(ek).n,
      tasks: HW.HW_TASKS.map((x) => ({ id: x.id, text: x.text, done: done[x.id] })),
      frames: q('SELECT COUNT(*) n FROM claims WHERE key = ?').get(HW.HW_FRAME).n,
      editions: q('SELECT COUNT(*) n FROM cars WHERE model = ?').get(HW.HW_EDITION).n,
      ghostLots: q("SELECT COUNT(*) n FROM container_lots WHERE tier = 'ghost' AND status = 'done' AND top_bidder > 0").get().n,
      history: q("SELECT admin, action, details, created_at at FROM admin_log WHERE action = 'halloween-mode' ORDER BY id DESC LIMIT 10").all().map((r) => ({ ...r, details: JSON.parse(r.details || 'null') })),
    };
  }
  // 'auto' = by the calendar; 'on' = runs now whatever the date; 'off' = stopped (nothing earned is taken away).
  function adminSet(who, { mode: m }) {
    const to = String(m || '');
    if (!HW.HW_MODES.includes(to)) fail('Режим: auto, on або off');
    metaSet(MODE_KEY, to);
    ctx.after?.(); // the pier puts up or takes down the ghost lot right away
    alog(who, 'halloween-mode', null, { mode: to });
    return adminView();
  }

  return {
    on, mode, track, brief,
    admin: { halloween: () => adminView(), 'halloween/mode': adminSet },
    mutating: ['halloween/mode'],
  };
}
