// The desktop admin («ПК-адмінка», owner 29.10: «апку для ПК, де розширена адмін-панель гри, де буквально все є»):
// read-only data for four sections of public/admin-pc.js — the live dashboard, the wide player card's extra panels,
// economy & cases, and the database browser. Nothing here changes the game; the only writes are two small tracking
// tables (user_hours from game.js markDay, wealth_snap from snapshot() on the server's 15 s sweeper) and the
// admin_log lines of the database browser.
//
// Cost on a big database: every query reads an indexed range (drops_time, users_seen, users_created, payments_time,
// car_log_from/to, user_hours / wealth_snap primary keys) or a small table; the database browser is the exception —
// a filter on an unindexed column scans the table, so its row count is capped (COUNT_CAP) and an export stops at
// EXPORT_CAP rows.
import * as S from '../public/shared.js';
import * as M from './metrics.js';

const HOUR = 3600e3, DAY = 86400e3;
export const ONLINE_MS = 3 * 60e3; // «зараз у грі»: a call in the last 3 minutes (the app polls every ~20 s while open)
export const PAGE = 50;
export const COUNT_CAP = 100000;
export const EXPORT_CAP = 50000;
export const SNAP_KEEP_DAYS = 35;

// ---------- the database browser's safety rules ----------
// A column whose name says it holds a secret is never shown, filtered or sorted on (filtering would leak it bit by bit).
// Conservative on purpose: the public seed hashes and the players' own client seeds go too.
export const SECRET_COL = /(^|_)(seed|secret|token|salt|pass|password|hash|api_?key|init_?data)(_|$)/i;
// Columns that are secret only while the row is "live": an open «Причал» lot's content (src/containers.js keeps it on
// the server until the lot ends), a running crash game's point, a running mines board. An admin who also plays must
// not read them. Shown once the row is finished; never filterable or sortable.
export const LIVE_SECRET = {
  container_lots: { cols: ['model', 'ed', 'junk', 'bots', 'pending', 'ev', 'serial', 'car_id'], open: (r) => r.status !== 'done' && r.status !== 'cancelled' },
  crash_games: { cols: ['point'], open: (r) => r.status === 'running' },
  mines_games: { cols: ['layout', 'revealed'], open: (r) => r.status === 'running' },
  // meta holds a few server-side seeds (buyer_seed…) next to harmless flags
  meta: { cols: ['value'], open: (r) => SECRET_COL.test(String(r.key || '')) || /seed|secret|token|salt/i.test(String(r.key || '')) },
};
export const MASK = '•••';
const OPS = new Set(['has', 'eq', 'ne', 'gt', 'lt', 'ge', 'le', 'null', 'notnull']);
const OP_SQL = { eq: '=', ne: '<>', gt: '>', lt: '<', ge: '>=', le: '<=' };
const qid = (s) => `"${String(s).replace(/"/g, '""')}"`;

// One CSV field: quoted when it holds a separator, a quote or a line break (RFC 4180, quotes doubled). Text that a
// spreadsheet would run as a formula (=, +, @, a tab, or − not followed by a number) gets a leading apostrophe:
// player names are typed by players.
export function csvField(v) {
  if (v == null) return '';
  let s = typeof v === 'string' ? v : String(v);
  if (typeof v === 'string' && (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s)))) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (vals) => vals.map(csvField).join(',');

// Reading the database: tables from sqlite_master, columns from PRAGMA table_info — the only identifiers that ever
// reach SQL; every value is a bound parameter.
export function createDbBrowser(db, fail = (m) => { throw new Error(m); }) {
  let tablesCache = null, countCache = null;
  function tables() {
    if (tablesCache && Date.now() - tablesCache.at < 60e3) return tablesCache.list;
    const list = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => {
      const cols = db.prepare(`PRAGMA table_info(${qid(t.name)})`).all().map((c) => ({ name: c.name, type: c.type || '', pk: c.pk }));
      const secret = new Set(cols.filter((c) => SECRET_COL.test(c.name)).map((c) => c.name));
      const live = new Set(LIVE_SECRET[t.name]?.cols || []);
      const rowid = !/WITHOUT\s+ROWID/i.test(t.sql || '');
      return {
        name: t.name, rowid,
        cols: cols.map((c) => ({ ...c, hidden: secret.has(c.name), masked: live.has(c.name) && !secret.has(c.name) })),
      };
    });
    tablesCache = { at: Date.now(), list };
    return list;
  }
  function table(name) {
    const t = tables().find((x) => x.name === name);
    if (!t) fail('Невідома таблиця');
    return t;
  }
  // A column a filter or the sort may use: it exists and is neither hidden nor masked.
  function openCol(t, name) {
    const c = t.cols.find((x) => x.name === name);
    if (!c) fail('Невідома колонка');
    if (c.hidden || c.masked) fail('Ця колонка прихована — за нею не можна шукати й сортувати');
    return c;
  }
  const numLike = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()));
  function where(t, filters) {
    if (filters != null && !Array.isArray(filters)) fail('Некоректні фільтри');
    const list = (filters || []).slice(0, 10), parts = [], args = [];
    for (const f of list) {
      if (!f || typeof f !== 'object') fail('Некоректний фільтр');
      const c = openCol(t, f.col);
      const op = String(f.op || 'has');
      if (!OPS.has(op)) fail('Невідома умова');
      const col = qid(c.name);
      if (op === 'null') parts.push(`${col} IS NULL`);
      else if (op === 'notnull') parts.push(`${col} IS NOT NULL`);
      else {
        const v = String(f.value ?? '').slice(0, 200);
        if (op === 'has') {
          parts.push(`CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'`);
          args.push(`%${v.replace(/[\\%_]/g, (x) => '\\' + x)}%`);
        } else {
          parts.push(`${col} ${OP_SQL[op]} ?`);
          args.push(numLike(v) ? Number(v) : v);
        }
      }
    }
    return [parts.length ? `WHERE ${parts.join(' AND ')}` : '', args];
  }
  function order(t, sort, dir) {
    const d = dir === 'asc' ? 'ASC' : 'DESC';
    if (sort) return `ORDER BY ${qid(openCol(t, sort).name)} ${d}`;
    if (t.rowid) return `ORDER BY rowid ${d}`;
    const pk = t.cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk);
    return pk.length ? `ORDER BY ${pk.map((c) => `${qid(c.name)} ${d}`).join(', ')}` : '';
  }
  // Hidden columns become MASK; a live-secret column too while its row is still live.
  function clean(t, rows) {
    const live = LIVE_SECRET[t.name];
    return rows.map((r) => {
      const o = {};
      for (const c of t.cols) o[c.name] = c.hidden ? (r[c.name] == null ? null : MASK) : r[c.name];
      if (live && live.open(r)) for (const k of live.cols) if (k in o && o[k] != null) o[k] = MASK;
      return o;
    });
  }
  function select(name, { filters, sort, dir, offset = 0, limit = PAGE } = {}) {
    const t = table(name);
    const [w, args] = where(t, filters);
    const sql = `SELECT * FROM ${qid(t.name)} ${w} ${order(t, sort, dir)} LIMIT ? OFFSET ?`;
    return { t, rows: clean(t, db.prepare(sql).all(...args, limit, offset)), w, args };
  }
  function count(t, w, args) {
    const n = db.prepare(`SELECT COUNT(*) n FROM (SELECT 1 FROM ${qid(t.name)} ${w} LIMIT ${COUNT_CAP + 1})`).get(...args).n;
    return { n: Math.min(n, COUNT_CAP), capped: n > COUNT_CAP };
  }
  const colsOut = (t) => t.cols.map((c) => ({ name: c.name, type: c.type, pk: !!c.pk, hidden: c.hidden, masked: c.masked }));
  return {
    // Row counts are exact but kept for a minute (COUNT(*) of a big drops table is a full pass over its index).
    tables() {
      if (!countCache || Date.now() - countCache.at > 60e3) countCache = { at: Date.now(), rows: Object.fromEntries(tables().map((t) => [t.name, db.prepare(`SELECT COUNT(*) n FROM ${qid(t.name)}`).get().n])) };
      return tables().map((t) => ({ name: t.name, rows: countCache.rows[t.name] ?? 0, cols: t.cols.length, hidden: t.cols.filter((c) => c.hidden || c.masked).map((c) => c.name) }));
    },
    rows(name, o = {}) {
      const offset = Math.max(0, Math.min(1e6, Math.floor(Number(o.offset) || 0)));
      const { t, rows, w, args } = select(name, { ...o, offset });
      return { table: t.name, cols: colsOut(t), rows, offset, pageSize: PAGE, total: count(t, w, args) };
    },
    csv(name, o = {}) {
      const { t, rows } = select(name, { ...o, offset: 0, limit: EXPORT_CAP + 1 });
      const out = rows.slice(0, EXPORT_CAP);
      const names = t.cols.map((c) => c.name);
      return { table: t.name, n: out.length, truncated: rows.length > EXPORT_CAP, csv: [csvLine(names), ...out.map((r) => csvLine(names.map((k) => r[k])))].join('\r\n') + '\r\n' };
    },
  };
}

// ---------- the rest: dashboard, player extras, economy ----------
export function createAdminPc({ db, q, now, dayOf, int, fail, name, kyivOffset, dashboard, alog }) {
  db.exec(`CREATE TABLE IF NOT EXISTS wealth_snap (hour INTEGER NOT NULL, user_id INTEGER NOT NULL, balance INTEGER NOT NULL, value INTEGER NOT NULL,
      PRIMARY KEY (hour, user_id)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS wealth_snap_user ON wealth_snap(user_id, hour);`);
  const browser = createDbBrowser(db, fail);
  const kday = M.hourDay(dayOf);
  // Kyiv midnight of the day `t` is in (a Kyiv day starts on a whole UTC hour).
  function dayStart(t) {
    const off = kyivOffset(t);
    return Math.floor((t + off) / DAY) * DAY - off;
  }
  const brief = (u) => ({ id: u.id, name: name(u.id), level: u.level, balance: u.balance, value: u.total_value, lastSeen: u.last_seen, createdAt: u.created_at, banned: !!u.banned });

  // Once an hour: the balance and garage value of everyone who made a call since the last snapshot (the first run
  // takes everybody), so «баланс за 24 год» has a base. A row is written only when a player could have changed;
  // the balance at a moment is the latest row at or before it. Rows older than SNAP_KEEP_DAYS go, as do user_hours
  // older than 3 days (the dashboard needs today and yesterday).
  function snapshot() {
    const t = now(), h = Math.floor(t / HOUR);
    const last = q('SELECT MAX(hour) h FROM wealth_snap').get().h;
    if (last != null && last >= h) return 0;
    const since = last == null ? -1 : last * HOUR - 60e3;
    const n = q('INSERT OR REPLACE INTO wealth_snap (hour, user_id, balance, value) SELECT ?, id, balance, total_value FROM users WHERE id > 0 AND (? < 0 OR last_seen >= ?)')
      .run(h, since, since).changes;
    q('DELETE FROM wealth_snap WHERE hour < ?').run(h - SNAP_KEEP_DAYS * 24);
    q('DELETE FROM user_hours WHERE hour < ?').run(h - 72);
    return n;
  }
  const snapSince = () => q('SELECT MIN(hour) h FROM wealth_snap').get().h;
  // Each player's balance at moment t (latest snapshot at or before it), for the given ids; missing = no snapshot yet.
  function balancesAt(ids, t) {
    const h = Math.floor(t / HOUR), out = new Map();
    const st = q('SELECT balance, value FROM wealth_snap WHERE user_id = ? AND hour <= ? ORDER BY hour DESC LIMIT 1');
    for (const id of ids) {
      const r = st.get(id, h);
      if (r) out.set(id, r);
    }
    return out;
  }

  // ---------- «Живий дашборд» ----------
  // Online now, today vs yesterday (and yesterday up to the same time, where the rows carry a time), today and
  // yesterday by Kyiv hour. `days` adds the daily series of the old dashboard (src/game.js adminDashboard), which the
  // page asks for only when it opens or the range changes, not on every 20-second refresh.
  function live({ days } = {}) {
    const t = now(), off = kyivOffset(t);
    const t0 = dayStart(t), y0 = t0 - DAY, yNow = t - DAY;
    const today = dayOf(t), yday = dayOf(y0 + HOUR);
    const online = q('SELECT * FROM users WHERE last_seen >= ? AND id > 0 ORDER BY last_seen DESC LIMIT 200').all(t - ONLINE_MS).map(brief);
    const n = (sql, ...a) => q(sql).get(...a).n;
    const span = (sql, a, b) => n(sql, a, b);
    const NEW = 'SELECT COUNT(*) n FROM users WHERE created_at >= ? AND created_at < ? AND id > 0';
    const OPENS = 'SELECT COUNT(*) n FROM drops WHERE created_at >= ? AND created_at < ?';
    const STARS = "SELECT COALESCE(SUM(stars), 0) n FROM payments WHERE created_at >= ? AND created_at < ? AND charge_id NOT LIKE 'legacy:%'";
    const PAYS = "SELECT COUNT(*) n FROM payments WHERE created_at >= ? AND created_at < ? AND charge_id NOT LIKE 'legacy:%'";
    const HOURS = 'SELECT COUNT(DISTINCT user_id) n FROM user_hours WHERE hour >= ? AND hour < ?';
    const money = (d) => q('SELECT created, destroyed FROM money_days WHERE day = ?').get(d) || { created: 0, destroyed: 0 };
    const mT = money(today), mY = money(yday);
    const side = (a, b) => ({
      newUsers: span(NEW, a, b), opens: span(OPENS, a, b), stars: span(STARS, a, b), payments: span(PAYS, a, b),
    });
    const T = { ...side(t0, t + 1), active: n('SELECT COUNT(*) n FROM user_days WHERE day = ?', today), created: mT.created, destroyed: mT.destroyed };
    const Y = { ...side(y0, t0), active: n('SELECT COUNT(*) n FROM user_days WHERE day = ?', yday), created: mY.created, destroyed: mY.destroyed };
    const YN = { ...side(y0, yNow + 1), active: span(HOURS, Math.floor(y0 / HOUR), Math.floor(yNow / HOUR) + 1) };
    // By Kyiv hour: (ms + offset) / 1 h, mod 24. The offset of this moment is used for both days (on the two DST
    // nights a year one hour lands next door).
    const byHour = (sql, from, to) => {
      const a = new Array(24).fill(0);
      for (const r of q(sql).all(off, from, to)) a[r.h] = r.n;
      return a;
    };
    const H = (col, table, extra = '', val = 'COUNT(*)') => `SELECT (CAST((${col} + ?) / 3600000 AS INTEGER) % 24) h, ${val} n FROM ${table} WHERE ${col} >= ? AND ${col} < ? ${extra} GROUP BY h`;
    const activeHours = (from, to) => {
      const a = new Array(24).fill(0);
      for (const r of q('SELECT hour, COUNT(*) n FROM user_hours WHERE hour >= ? AND hour < ? GROUP BY hour').all(Math.floor(from / HOUR), Math.ceil(to / HOUR))) {
        a[(((r.hour * HOUR + off) / HOUR) % 24 + 24) % 24] = r.n;
      }
      return a;
    };
    const hours = (from, to) => ({
      signups: byHour(H('created_at', 'users', 'AND id > 0'), from, to),
      opens: byHour(H('created_at', 'drops'), from, to),
      stars: byHour(H('created_at', 'payments', "AND charge_id NOT LIKE 'legacy:%'", 'COALESCE(SUM(stars), 0)'), from, to),
      active: activeHours(from, to),
    });
    const out = {
      now: t, hourNow: Math.floor(((t + off) % DAY) / HOUR), today, yesterday: yday,
      online: { n: online.length, n5: n('SELECT COUNT(*) n FROM users WHERE last_seen >= ? AND id > 0', t - 5 * 60e3), list: online, windowMin: ONLINE_MS / 60e3 },
      cmp: { today: T, yesterday: Y, yesterdayByNow: YN },
      hours: { today: hours(t0, t0 + DAY), yesterday: hours(y0, t0) },
      hoursSince: (q('SELECT MIN(hour) h FROM user_hours').get().h ?? null) * HOUR || null,
    };
    if (days) {
      const d = dashboard({ days: int(days, 7, 90, 'Днів') });
      out.days = d.days.map((x) => ({ day: x.day, newUsers: x.newUsers, dau: x.dau, cases: x.cases, stars: x.stars, payments: x.payments, created: x.created, destroyed: x.destroyed }));
    }
    return out;
  }

  // ---------- «Повний профіль гравця»: money by day and «Підозріле» ----------
  const caseOf = (id) => S.CASE_BY_ID[id] || S.PART_CASE_BY_ID[id] || null;
  // What one drop is worth (model price, or the part tier's price) and what the dealer pays for it right away.
  function dropWorth(caseId, item) {
    if (String(item).includes(':')) {
      const tier = S.TIER_BY_ID[String(item).split(':')[1]];
      return tier ? { value: tier.price, sale: Math.floor(tier.price * S.PART_SELL_RATE) } : { value: 0, sale: 0 };
    }
    const m = S.MODELS[item];
    if (!m) return { value: 0, sale: 0 };
    let sale = 0;
    try {
      sale = S.sellPriceOf(item, Infinity, S.CASE_BY_ID[caseId] ? caseId : null);
    } catch {}
    return { value: m.price, sale: m.secret ? 0 : sale };
  }
  function player({ id, days }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    const u = q('SELECT * FROM users WHERE id = ?').get(uid);
    if (!u) fail('Гравця не знайдено');
    const n = days ? int(days, 7, 60, 'Днів') : 14;
    const t = now(), from = dayStart(t) - (n - 1) * DAY;
    const list = [];
    for (let i = 0; i < n; i++) list.push(dayOf(from + i * DAY + HOUR));
    const by = Object.fromEntries(list.map((d) => [d, { day: d, opens: 0, spent: 0, dropValue: 0, dropSale: 0, sold: 0, soldValue: 0, starsAmount: 0, stars: 0, admin: 0, carsIn: 0, carsOut: 0, balance: null }]));
    const at = (ms) => by[kday(ms)];
    // Cases: count × the case price (the real price could be lower — case of the day, keys — so it says «за ціною кейса»).
    for (const r of q('SELECT case_id, item, created_at FROM drops WHERE user_id = ? AND created_at >= ?').all(uid, from)) {
      const d = at(r.created_at);
      if (!d) continue;
      const cs = caseOf(r.case_id), w = dropWorth(r.case_id, r.item);
      d.opens++;
      d.spent += cs?.price || 0;
      d.dropValue += w.value;
      d.dropSale += w.sale;
    }
    for (const r of q("SELECT stars, amount, created_at FROM payments WHERE user_id = ? AND created_at >= ? AND charge_id NOT LIKE 'legacy:%'").all(uid, from)) {
      const d = at(r.created_at);
      if (d) (d.stars += r.stars, d.starsAmount += r.amount);
    }
    for (const r of q("SELECT details, created_at FROM admin_log WHERE target = ? AND action = 'money' AND created_at >= ?").all(uid, from)) {
      const d = at(r.created_at);
      try {
        if (d) d.admin += Number(JSON.parse(r.details).amount) || 0;
      } catch {}
    }
    // Sales to the dealer leave a 'gone' row in car_log (the price itself isn't kept: ≈ the class rate of the model).
    for (const r of q("SELECT model, kind, from_uid, to_uid, reason, at FROM car_log WHERE (from_uid = ? OR to_uid = ?) AND at >= ?").all(uid, uid, from)) {
      const d = at(r.at);
      if (!d) continue;
      if (r.kind === 'gone' && (r.reason === 'sell' || r.reason === 'buyer/sell')) {
        d.sold++;
        const m = S.MODELS[r.model];
        if (m && !m.secret) d.soldValue += Math.floor(m.price * (S.SELL_RATES[m.cls] || 0));
      } else if (r.kind === 'moved') {
        if (r.to_uid === uid) d.carsIn++;
        else d.carsOut++;
      }
    }
    // End-of-day balance from the hourly snapshots.
    const snaps = q('SELECT hour, balance, value FROM wealth_snap WHERE user_id = ? AND hour >= ? ORDER BY hour').all(uid, Math.floor(from / HOUR) - 24 * 30);
    list.forEach((d, i) => {
      const end = Math.floor((from + (i + 1) * DAY) / HOUR); // the next Kyiv midnight (± an hour on the DST nights)
      let last = null;
      for (const s of snaps) if (s.hour < end) last = s;
      by[d].balance = i === list.length - 1 ? u.balance : last ? last.balance : null;
    });
    return { days: list.map((d) => by[d]), snapSince: (snapSince() ?? 0) * HOUR || null, suspicious: suspicious(u) };
  }

  // Simple signals, each with what it looked at; nothing here is a verdict.
  function suspicious(u) {
    const uid = u.id, t = now(), out = [];
    const who = (ids) => ids.map((id) => ({ id, name: name(id) }));
    // 1. Several accounts from the same inviter within minutes of this one (alts / farmed referrals).
    if (u.referrer_id) {
      const sib = q('SELECT id FROM users WHERE referrer_id = ? AND id <> ? AND created_at BETWEEN ? AND ?').all(u.referrer_id, uid, u.created_at - 10 * 60e3, u.created_at + 10 * 60e3).map((r) => r.id);
      if (sib.length >= 2) out.push({ level: 'red', title: 'Пачка акаунтів від одного запрошувача', text: `${sib.length} інших гравців прийшли за посиланням ${name(u.referrer_id)} в межах 10 хв від цього`, users: who([u.referrer_id, ...sib.slice(0, 12)]) });
    }
    // 2. As an inviter: bursts of invitees (3+ within 10 minutes), and how many never got past level 2.
    const inv = q('SELECT id, created_at, level FROM users WHERE referrer_id = ? ORDER BY created_at').all(uid);
    if (inv.length >= 3) {
      let best = 0, bi = 0;
      for (let i = 0, j = 0; i < inv.length; i++) {
        while (inv[i].created_at - inv[j].created_at > 10 * 60e3) j++;
        if (i - j + 1 > best) (best = i - j + 1), (bi = j);
      }
      if (best >= 3) out.push({ level: best >= 5 ? 'red' : 'amber', title: 'Запрошені приходять пачками', text: `${best} запрошених зареєструвались за 10 хв (усього запросив ${inv.length})`, users: who(inv.slice(bi, bi + best).slice(0, 12).map((r) => r.id)) });
      const low = inv.filter((r) => r.level <= 2 && t - r.created_at > DAY).length, old = inv.filter((r) => t - r.created_at > DAY).length;
      if (old >= 5 && low / old >= 0.8) out.push({ level: 'amber', title: 'Запрошені не грають', text: `${low} з ${old} запрошених (старших за добу) так і лишились на 1–2 рівні` });
    }
    // 3–4. Cars that came from / went to one and the same player (trades, rooms, market) — 3 or more.
    for (const [sql, title, lvl] of [
      ["SELECT from_uid o, COUNT(*) n FROM car_log WHERE to_uid = ? AND kind = 'moved' AND from_uid > 0 GROUP BY from_uid HAVING n >= 3 ORDER BY n DESC LIMIT 5", 'Машини від одного гравця', 'amber'],
      ["SELECT to_uid o, COUNT(*) n FROM car_log WHERE from_uid = ? AND kind = 'moved' AND to_uid > 0 GROUP BY to_uid HAVING n >= 3 ORDER BY n DESC LIMIT 5", 'Машини одному гравцю', 'amber'],
    ]) {
      const rows = q(sql).all(uid);
      if (rows.length) out.push({ level: rows[0].n >= 8 ? 'red' : lvl, title, text: rows.map((r) => `${name(r.o)}: ${r.n}`).join(' · '), users: who(rows.map((r) => r.o)) });
    }
    // 5. Hryvnias through finished trades / trade rooms to or from one player.
    const flow = new Map();
    const addF = (o, give, get) => {
      if (!o || o <= 0) return;
      const x = flow.get(o) || { give: 0, get: 0, n: 0 };
      x.give += give || 0;
      x.get += get || 0;
      x.n++;
      flow.set(o, x);
    };
    for (const r of q("SELECT from_id, to_id, give_money, get_money FROM trades WHERE status = 'done' AND (from_id = ? OR to_id = ?)").all(uid, uid)) {
      if (r.from_id === uid) addF(r.to_id, r.give_money, r.get_money);
      else addF(r.from_id, r.get_money, r.give_money);
    }
    for (const r of q("SELECT host_id, guest_id, host_money, guest_money FROM trade_rooms WHERE status = 'done' AND (host_id = ? OR guest_id = ?)").all(uid, uid)) {
      if (r.host_id === uid) addF(r.guest_id, r.host_money, r.guest_money);
      else addF(r.host_id, r.guest_money, r.host_money);
    }
    const big = [...flow].filter(([, x]) => Math.max(x.give, x.get) >= 1e6).sort((a, b) => Math.max(b[1].give, b[1].get) - Math.max(a[1].give, a[1].get)).slice(0, 5);
    if (big.length) out.push({ level: 'amber', title: 'Гривні через обміни з одним гравцем', text: big.map(([o, x]) => `${name(o)}: віддав ${S.short(x.give)}, отримав ${S.short(x.get)} (${x.n} обм.)`).join(' · '), users: who(big.map(([o]) => o)) });
    // 6. The balance jumped in 24 h far beyond what the garage is worth.
    const was = balancesAt([uid], t - DAY).get(uid);
    if (was) {
      const grow = u.balance - was.balance;
      if (grow >= 2e6 && grow > 2 * Math.max(u.total_value, 1)) out.push({ level: grow >= 10e6 ? 'red' : 'amber', title: 'Різкий стрибок балансу', text: `+${S.short(grow)} за 24 год при гаражі на ${S.short(u.total_value)}` });
    }
    // 7. Case opens at a pace a person hardly keeps up (the busiest hour of the last 7 days).
    const peak = q('SELECT CAST(created_at / 3600000 AS INTEGER) h, COUNT(*) n FROM drops WHERE user_id = ? AND created_at >= ? GROUP BY h ORDER BY n DESC LIMIT 1').get(uid, t - 7 * DAY);
    if (peak && peak.n >= 600) out.push({ level: 'amber', title: 'Дуже багато відкриттів за годину', text: `${peak.n} дропів за одну годину (${new Date(peak.h * HOUR).toISOString().slice(0, 13).replace('T', ' ')}:00 UTC)` });
    // 8. Many admin grants.
    const g = q("SELECT COUNT(*) n, details FROM admin_log WHERE target = ? AND action = 'money' AND created_at >= ?").get(uid, t - 30 * DAY);
    if (g.n >= 5) out.push({ level: 'amber', title: 'Часто отримує гривні від адмінів', text: `${g.n} нарахувань за 30 днів — див. «Дії адмінів»` });
    return out;
  }

  // ---------- «Економіка й кейси» ----------
  const WINDOWS = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };
  function economy({ window: win, grow } = {}) {
    const span = WINDOWS[win] ? WINDOWS[win] : DAY;
    const t = now(), from = t - span;
    const growMin = grow == null || grow === '' ? 5e6 : int(grow, 0, 1e15, 'Поріг');
    // Per case: SQL groups by case and item (an indexed range of drops), the values come from the models.
    const cases = new Map();
    for (const r of q('SELECT case_id, item, cls, COUNT(*) n FROM drops WHERE created_at >= ? GROUP BY case_id, item').all(from)) {
      let c = cases.get(r.case_id);
      if (!c) cases.set(r.case_id, (c = { id: r.case_id, opens: 0, value: 0, sale: 0, red: 0, byCls: {} }));
      const w = dropWorth(r.case_id, r.item);
      c.opens += r.n;
      c.value += w.value * r.n;
      c.sale += w.sale * r.n;
      if (r.cls === 'S') c.red += r.n;
      c.byCls[r.cls] = (c.byCls[r.cls] || 0) + r.n;
    }
    const caseRows = [...cases.values()].map((c) => {
      const cs = S.CASE_BY_ID[c.id], pc = S.PART_CASE_BY_ID[c.id];
      const price = cs?.price ?? pc?.price ?? 0;
      let ev = cs?.ev ?? null, sellEv = cs?.sellEv ?? null;
      if (pc) {
        const tw = Object.values(pc.weights).reduce((a, b) => a + b, 0);
        ev = Math.round(Object.entries(pc.weights).reduce((s, [k, w]) => s + (w / tw) * S.TIER_BY_ID[k].price, 0));
        sellEv = Math.round(ev * S.PART_SELL_RATE);
      }
      const spent = price * c.opens;
      return { ...c, name: cs?.name || pc?.name || c.id, kind: cs ? cs.group || 'case' : pc ? 'parts' : 'other', price, spent,
        ret: spent ? c.value / spent : null, retSale: spent ? c.sale / spent : null,
        evRet: price && ev != null ? ev / price : null, sellRet: price && sellEv != null ? sellEv / price : null };
    }).sort((a, b) => b.spent - a.spent || b.opens - a.opens);
    // Money: what the players hold, the richest, created / destroyed per day, the split by source over the window.
    const supply = q('SELECT COUNT(*) n, COALESCE(SUM(balance), 0) bal, COALESCE(SUM(total_value), 0) val FROM users WHERE id > 0').get();
    const rich = q('SELECT * FROM users WHERE id > 0 ORDER BY balance + total_value DESC LIMIT 20').all().map(brief);
    const firstDay = dayOf(t - 29 * DAY);
    const flowDays = q('SELECT day, created, destroyed FROM money_days WHERE day >= ? ORDER BY day').all(firstDay);
    const winDays = [];
    for (let d = dayStart(from); d <= t; d += DAY) winDays.push(dayOf(d + HOUR));
    const src = M.moneyBySource({ rows: q('SELECT day, src, created, destroyed FROM money_src WHERE day >= ?').all(winDays[0]), days: winDays });
    const caseSrc = q("SELECT COALESCE(SUM(destroyed), 0) d, COALESCE(SUM(created), 0) c FROM money_src WHERE day >= ? AND src = 'case/open'").get(winDays[0]);
    // Anomalies over the last 24 h.
    const d1 = t - DAY;
    const active = q('SELECT * FROM users WHERE last_seen >= ? AND id > 0').all(d1);
    const base = balancesAt(active.map((u) => u.id), d1);
    const grew = active.filter((u) => base.has(u.id)).map((u) => ({ ...brief(u), grow: u.balance - base.get(u.id).balance, valueGrow: u.total_value - base.get(u.id).value }))
      .filter((u) => u.grow >= growMin).sort((a, b) => b.grow - a.grow).slice(0, 30);
    const fresh = q('SELECT * FROM users WHERE created_at >= ? AND id > 0 AND balance + total_value >= ? ORDER BY balance + total_value DESC LIMIT 20').all(t - 3 * DAY, growMin).map(brief);
    const openers = q('SELECT user_id id, COUNT(*) n FROM drops WHERE created_at >= ? GROUP BY user_id HAVING n >= 500 ORDER BY n DESC LIMIT 20').all(d1).map((r) => ({ id: r.id, name: name(r.id), n: r.n }));
    const receivers = q("SELECT to_uid id, COUNT(*) n, COUNT(DISTINCT from_uid) f FROM car_log WHERE kind = 'moved' AND at >= ? AND to_uid > 0 AND from_uid > 0 GROUP BY to_uid HAVING n >= 5 ORDER BY n DESC LIMIT 20").all(d1).map((r) => ({ id: r.id, name: name(r.id), n: r.n, from: r.f }));
    const grants = new Map();
    for (const r of q("SELECT target, details FROM admin_log WHERE action = 'money' AND created_at >= ? AND target IS NOT NULL").all(d1)) {
      let a = 0;
      try {
        a = Number(JSON.parse(r.details).amount) || 0;
      } catch {}
      grants.set(r.target, (grants.get(r.target) || 0) + a);
    }
    const granted = [...grants].filter(([, a]) => Math.abs(a) >= growMin / 5).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, a]) => ({ id, name: name(id), amount: a }));
    return {
      window: WINDOWS[win] ? win : '24h', from, now: t, growMin,
      cases: caseRows, caseSrc: { spent: caseSrc.d, paid: caseSrc.c, since: winDays[0] },
      supply: { players: supply.n, balance: supply.bal, value: supply.val }, rich,
      flowDays, src: { groups: src.groups.map(({ series, ...g }) => g), total: src.total },
      anomalies: { grew, fresh, openers, receivers, granted, snapSince: (snapSince() ?? 0) * HOUR || null },
    };
  }

  // ---------- «Перегляд бази» (owner and admins only; every look and export goes into admin_log) ----------
  // Paging through the same view doesn't add a line each time: the same table + filters + sort by the same admin
  // within 2 minutes is one look.
  function logBrowse(who, action, details) {
    const key = JSON.stringify(details);
    const last = q('SELECT details, created_at FROM admin_log WHERE admin = ? AND action = ? ORDER BY id DESC LIMIT 1').get(String(who), action);
    if (action === 'db-browse' && last && last.details === key && now() - last.created_at < 2 * 60e3) return;
    alog(who, action, null, details);
  }
  const viewOf = (b) => (b.filters != null && !Array.isArray(b.filters) && fail('Некоректні фільтри'), { table: String(b.table || ''), filters: Array.isArray(b.filters) ? b.filters.slice(0, 10).map((f) => ({ col: String(f?.col ?? ''), op: String(f?.op ?? ''), value: String(f?.value ?? '').slice(0, 200) })) : [], sort: b.sort ? String(b.sort) : null, dir: b.dir === 'asc' ? 'asc' : 'desc' });
  const guard = (fn) => {
    try {
      return fn();
    } catch (e) {
      // SQLite / whitelist errors reach the panel as plain game errors.
      if (e?.constructor?.name === 'GameError') throw e;
      return fail(`База: ${String(e?.message || e).slice(0, 200)}`);
    }
  };

  return {
    snapshot, live, player, economy, suspicious, browser,
    dbTables: () => ({ tables: browser.tables(), pageSize: PAGE, exportCap: EXPORT_CAP }),
    dbRows: (who, b) => {
      const v = viewOf(b);
      const r = guard(() => browser.rows(v.table, { ...v, offset: b.offset }));
      logBrowse(who, 'db-browse', v);
      return r;
    },
    dbExport: (who, b) => {
      const v = viewOf(b);
      const r = guard(() => browser.csv(v.table, v));
      alog(who, 'db-export', null, { ...v, rows: r.n, truncated: r.truncated });
      return r;
    },
  };
}
