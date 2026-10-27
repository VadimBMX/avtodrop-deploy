// «Сарайна знахідка» on the server (rules: public/barn.js). Finds live in barn_finds: 'found' (waiting in the shed),
// 'work' (restoration started: `done` stages finished, `run_until` = the running stage's end, null between stages),
// 'done' (the «R» car was taken: car_id) or 'dropped'. Stages finish lazily (settle() on every read) — the time is the
// state, nothing needs a timer; the bot reminder (push.candidates) tells the player when a stage is ready.
// Where finds come from: one free find a Kyiv week (source 'week:<monday>', UNIQUE per player, so it can't be taken
// twice) and won containers (barn_lots: each lot rolled once, from its own committed salt — no server randomness to
// replay; only lots settled after the feature went live).
import crypto from 'node:crypto';
import * as S from '../public/shared.js';
import * as B from '../public/barn.js';

const SINCE_KEY = 'barn_since';
const hashU = (s, k = 0) => parseInt(crypto.createHash('sha256').update(s).digest('hex').slice(k * 8, k * 8 + 8), 16) / 2 ** 32;

export function createBarn(ctx) {
  const { q, now, fail, int, weekOf, userRow, pay, takePart, inventory, giveCar, garageCount, bank, metaGet, metaSet } = ctx;
  const rnd = ctx.random || (() => crypto.randomInt(1e9) / 1e9);
  if (!metaGet(SINCE_KEY)) metaSet(SINCE_KEY, String(now()));
  const since = () => Number(metaGet(SINCE_KEY)) || 0;
  const tell = (uid, text) => q('INSERT INTO events (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, text, now());
  const waiting = (uid) => q("SELECT COUNT(*) n FROM barn_finds WHERE user_id = ? AND status = 'found'").get(uid).n;
  const working = (uid) => q("SELECT * FROM barn_finds WHERE user_id = ? AND status = 'work' ORDER BY id LIMIT 1").get(uid);
  function addFind(uid, model, source) {
    const r = q('INSERT OR IGNORE INTO barn_finds (user_id, model, source, created_at) VALUES (?, ?, ?, ?)').run(uid, model, source, now());
    return r.changes ? Number(r.lastInsertRowid) : null;
  }

  // A finished stage: counted once (the guarded UPDATE), whoever reads first.
  function settle(uid) {
    const t = now();
    q("UPDATE barn_finds SET done = done + 1, run_until = NULL WHERE user_id = ? AND status = 'work' AND run_until IS NOT NULL AND run_until <= ?").run(uid, t);
    // Won containers since the last look: each one rolled once for a find hidden inside.
    const lots = q(`SELECT id, tier, junk, salt FROM container_lots l WHERE top_bidder = ? AND status = 'done' AND settled_at >= ?
      AND NOT EXISTS (SELECT 1 FROM barn_lots b WHERE b.lot_id = l.id) ORDER BY id LIMIT 20`).all(uid, since());
    for (const L of lots) {
      const odds = B.LOT_ODDS[L.tier];
      const p = L.junk ? B.BARN.lotChance.junk : B.BARN.lotChance.normal;
      const key = `barn|${L.id}|${L.salt}`;
      let model = null;
      if (odds && waiting(uid) < B.BARN.maxFinds && hashU(key, 0) < p) model = B.pickFind(odds, hashU(key, 1), hashU(key, 2));
      q('INSERT OR IGNORE INTO barn_lots (lot_id, user_id, model, at) VALUES (?, ?, ?, ?)').run(L.id, uid, model, t);
      if (model && addFind(uid, model, `lot:${L.id}`)) tell(uid, `🏚 У контейнері №${L.id} знайшлись документи на сарайну знахідку: ${S.MODELS[model].name}. Меню → Сарай`);
    }
  }

  function findOut(f, inv) {
    const t = now(), m = S.MODELS[f.model], r = S.MODELS[B.rOf(f.model)];
    const next = f.status !== 'done' && !f.run_until && f.done < B.STAGES.length ? f.done : null;
    const plan = next != null ? B.partsPlan(f.model, next, inv) : null;
    return {
      id: f.id, model: f.model, r: r.id, status: f.status, source: f.source.split(':')[0], done: f.done, runUntil: f.run_until || null,
      left: f.run_until ? Math.max(0, f.run_until - t) : 0, rush: f.run_until ? B.rushCost(f.model, f.run_until - t) : 0,
      ready: f.status === 'work' && !f.run_until && f.done >= B.STAGES.length,
      next: next != null ? { i: next, money: B.stageMoney(f.model, next), take: plan.take, missing: plan.missing, hours: B.STAGES[next].hours } : null,
      value: m.price, rValue: r.price, rSale: S.sellPriceOf(r.id), spent: f.spent, carId: f.car_id || null, createdAt: f.created_at,
    };
  }
  function weeklyState(uid) {
    const wk = weekOf(now());
    const taken = !!q('SELECT 1 FROM barn_finds WHERE user_id = ? AND source = ?').get(uid, `week:${wk}`);
    const nextAt = S.kyivMidnightOf(wk, 7); // next Monday 00:00 Kyiv
    return { ready: !taken && waiting(uid) < B.BARN.maxFinds, taken, full: !taken && waiting(uid) >= B.BARN.maxFinds, week: wk, nextAt };
  }

  // ---------- API ----------
  function view(uid) {
    settle(uid);
    const inv = inventory(uid);
    const finds = q("SELECT * FROM barn_finds WHERE user_id = ? AND status IN ('found', 'work') ORDER BY status = 'work' DESC, id").all(uid).map((f) => findOut(f, inv));
    const doneList = q("SELECT * FROM barn_finds WHERE user_id = ? AND status = 'done' ORDER BY id DESC LIMIT 10").all(uid).map((f) => findOut(f, inv));
    return { finds, done: doneList, weekly: weeklyState(uid), max: B.BARN.maxFinds, restored: q("SELECT COUNT(*) n FROM barn_finds WHERE user_id = ? AND status = 'done'").get(uid).n };
  }
  function weekly(uid) {
    settle(uid);
    const w = weeklyState(uid);
    if (w.taken) fail('Цього тижня ти вже оглянув сарай — нова знахідка в понеділок');
    if (w.full) fail(`У сараї вже ${B.BARN.maxFinds} знахідки — почни реставрацію або прибери одну`);
    const u = userRow(uid);
    const model = B.pickFind(B.weeklyOdds(u.level), rnd(), rnd());
    const id = addFind(uid, model, `week:${w.week}`);
    if (!id) fail('Цього тижня ти вже оглянув сарай');
    return { ...view(uid), found: { id, model } };
  }
  function own(uid, id, statuses) {
    const f = q('SELECT * FROM barn_finds WHERE id = ? AND user_id = ?').get(int(id, 1, Number.MAX_SAFE_INTEGER, 'ID знахідки'), uid);
    if (!f || !statuses.includes(f.status)) fail('Знахідку не знайдено');
    return f;
  }
  // The next stage: its parts leave the warehouse and its money is paid now; it runs for its hours.
  function start(uid, { id }) {
    settle(uid);
    const f = own(uid, id, ['found', 'work']);
    if (f.status === 'found') {
      const w = working(uid);
      if (w) fail(`Спершу доведи до кінця ${S.MODELS[w.model].name} — у гаражі одне місце для реставрації`);
    }
    if (f.run_until) fail('Етап ще триває');
    if (f.done >= B.STAGES.length) fail('Реставрацію завершено — забери машину');
    const i = f.done, st = B.STAGES[i];
    const plan = B.partsPlan(f.model, i, inventory(uid));
    if (plan.missing.length) fail(`Не вистачає деталей: ${plan.missing.map((p) => `${B.partName(p.type, p.tier)} ×${p.n}`).join(', ')}`);
    const money = B.stageMoney(f.model, i);
    pay(uid, money);
    for (const p of plan.take) takePart(uid, p.type, p.tier, p.n);
    const until = now() + st.hours * 3600e3;
    if (!q("UPDATE barn_finds SET status = 'work', run_until = ?, spent = spent + ?, parts = parts + ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND done = ? AND run_until IS NULL")
      .run(until, money, plan.take.reduce((s, p) => s + p.n, 0), now(), f.id, i).changes) fail('Знахідка змінилась — онови екран');
    return { ...view(uid), started: { id: f.id, stage: st.id, until, money, take: plan.take } };
  }
  // «Прискорити»: the running stage ends now, for hryvnias (B.rushCost; never Stars).
  function rush(uid, { id }) {
    settle(uid);
    const f = own(uid, id, ['work']);
    if (!f.run_until) fail('Зараз нічого не триває');
    const cost = B.rushCost(f.model, f.run_until - now());
    pay(uid, cost);
    if (!q('UPDATE barn_finds SET done = done + 1, run_until = NULL, spent = spent + ?, rushed = rushed + ? WHERE id = ? AND run_until = ?').run(cost, cost, f.id, f.run_until).changes) fail('Знахідка змінилась — онови екран');
    return { ...view(uid), rushed: cost };
  }
  // All four stages done: the «R» car goes to the garage (to the showcase when the garage is over its slots).
  function claim(uid, { id }) {
    settle(uid);
    const f = own(uid, id, ['work']);
    if (f.run_until || f.done < B.STAGES.length) fail('Реставрацію ще не завершено');
    if (!q("UPDATE barn_finds SET status = 'done', done_at = ? WHERE id = ? AND status = 'work'").run(now(), f.id).changes) fail('Машину вже забрано');
    const rid = B.rOf(f.model);
    bank(uid);
    const g = giveCar(uid, rid, 'barn');
    q('INSERT INTO edition_serials (model, next) VALUES (?, 1) ON CONFLICT DO NOTHING').run(rid);
    const serial = q('SELECT next FROM edition_serials WHERE model = ?').get(rid).next;
    q('UPDATE edition_serials SET next = next + 1 WHERE model = ?').run(rid);
    q('UPDATE cars SET serial = ? WHERE id = ?').run(serial, g.id);
    const showcase = garageCount(uid) > userRow(uid).slots;
    if (showcase) q("UPDATE cars SET status = 'showcase' WHERE id = ?").run(g.id);
    q('UPDATE barn_finds SET car_id = ? WHERE id = ?').run(g.id, f.id);
    tell(uid, `✨ Реставрацію завершено: ${S.MODELS[rid].name} ${S.serialText(serial)} ${showcase ? 'стоїть на вітрині (гараж повний)' : 'уже в гаражі'}`);
    return { ...view(uid), car: { id: g.id, model: rid, serial, showcase } };
  }
  // A waiting find can be thrown out (nothing back — a find is free); a started one can't.
  function drop(uid, { id }) {
    const f = own(uid, id, ['found']);
    q("UPDATE barn_finds SET status = 'dropped', done_at = ? WHERE id = ? AND status = 'found'").run(now(), f.id);
    return view(uid);
  }

  // For `me`: the badge numbers only (the screen asks 'barn').
  function brief(uid) {
    settle(uid);
    const w = working(uid), wk = weeklyState(uid);
    return {
      finds: waiting(uid), weekly: wk.ready,
      active: w ? { id: w.id, model: w.model, done: w.done, runUntil: w.run_until || null } : null,
      ready: !!w && !w.run_until, // a stage finished: the next one (or the car) waits for the player
    };
  }

  // ---------- the bot reminder: «Двигун готовий — заходь на наступний етап» ----------
  // Adds a 'barn' item for players whose running stage has ended (src/reminders.js applies quiet hours, 2 a day, idle).
  function remind(list, rules) {
    const t = now();
    const rows = q(`SELECT u.*, f.model f_model, f.done f_done, f.run_until f_until FROM barn_finds f JOIN users u ON u.id = f.user_id
      WHERE f.status = 'work' AND f.run_until IS NOT NULL AND f.run_until <= ? AND u.push_off = 0 AND u.push_blocked = 0 AND u.banned = 0
      AND u.last_seen BETWEEN ? AND ?`).all(t, t - rules.inactiveDays * 86400e3, t - rules.idleMin * 60e3);
    if (!rows.length) return list;
    const byId = new Map(list.map((c) => [c.uid, c]));
    for (const u of rows) {
      const st = B.STAGES[u.f_done];
      if (!st) continue;
      const last = u.f_done + 1 >= B.STAGES.length;
      const text = `🔧 ${st.ready} (${S.MODELS[u.f_model].name}) — ${last ? 'забирай R-версію!' : 'заходь на наступний етап'}`;
      const item = { kind: 'barn', at: u.f_until, text };
      const c = byId.get(u.id);
      if (c) {
        if (!c.ready.some((r) => r.kind === 'barn')) c.ready.push(item);
        continue;
      }
      let sent = {};
      try {
        sent = JSON.parse(u.push_sent || '{}') || {};
      } catch {}
      list.push({ uid: u.id, lastSeen: u.last_seen, pushOff: false, blocked: false, pushDay: u.push_day, pushCount: u.push_count, pushLast: u.push_last, sent, ready: [item] });
    }
    return list;
  }

  // ---------- admin (read-only numbers) ----------
  function adminView() {
    const n = (sql, ...a) => q(sql).get(...a).n;
    return {
      finds: n('SELECT COUNT(*) n FROM barn_finds'), waiting: n("SELECT COUNT(*) n FROM barn_finds WHERE status = 'found'"),
      working: n("SELECT COUNT(*) n FROM barn_finds WHERE status = 'work'"), restored: n("SELECT COUNT(*) n FROM barn_finds WHERE status = 'done'"),
      spent: q("SELECT COALESCE(SUM(spent), 0) n FROM barn_finds").get().n, parts: q('SELECT COALESCE(SUM(parts), 0) n FROM barn_finds').get().n,
      fromLots: n("SELECT COUNT(*) n FROM barn_finds WHERE source LIKE 'lot:%'"),
    };
  }

  return {
    brief, remind, settle,
    api: { barn: view, 'barn/weekly': weekly, 'barn/start': start, 'barn/rush': rush, 'barn/claim': claim, 'barn/drop': drop },
    gates: { 'barn/weekly': 'parts', 'barn/start': 'parts', 'barn/rush': 'parts', 'barn/claim': 'parts' },
    admin: { barn: () => adminView() },
  };
}
