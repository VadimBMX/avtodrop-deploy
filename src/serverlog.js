// Server logs for the admin «Логи» → «Сервер» (owner and admins only). Every line the server logs (the `log` passed
// around server.js, and console.* once captureConsole() runs in the real process) goes into an in-memory ring of the
// last RING_SIZE lines; warnings and errors are also written to server_log (KEEP_DAYS days, at most KEEP_ROWS rows,
// pruned by prune() from the server's sweeper), so they survive a restart.
//
// Nothing is stored before redact(): bot tokens (123456:AA…), the exact BOT_TOKEN / ADMIN_KEY values, initData
// parameters (hash=, user=, query_id=, auth_date=, signature=, tgWebAppData=) and long hex strings (seeds, salts,
// hashes). The request handler logs only the method and path of a failed request — never bodies, headers or initData.
export const RING_SIZE = 2000;
export const KEEP_DAYS = 14;
export const KEEP_ROWS = 20000;
export const MSG_MAX = 2000;
export const STACK_MAX = 8000;
const RANK = { info: 0, warn: 1, error: 2 };

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function makeRedactor(secrets = []) {
  const exact = [...new Set(secrets.filter((s) => typeof s === 'string' && s.length >= 6))].sort((a, b) => b.length - a.length).map(escRe);
  const exactRe = exact.length ? new RegExp(exact.join('|'), 'g') : null;
  return (v) => {
    let s = String(v ?? '');
    if (exactRe) s = s.replace(exactRe, '[secret]');
    s = s.replace(/\d{6,}:[A-Za-z0-9_-]{30,}/g, '[bot-token]');
    // initData as it travels (URL-encoded key=value pairs) and the header / variable names that carry secrets
    s = s.replace(/\b(hash|signature|user|query_id|auth_date|chat_instance|tgWebAppData)=[^&\s"'<>]*/gi, '$1=[redacted]');
    s = s.replace(/\b(init_?data|x-init-data|x-admin-key|admin_?key|bot_?token)(["']?\s*[=:]\s*["']?)[^&\s"',;}]+/gi, '$1$2[redacted]');
    s = s.replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hex]');
    return s;
  };
}

function argText(a) {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  if (a == null || typeof a !== 'object') return String(a);
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
// The level a line deserves: an Error object (or anything with a stack) is an error; words like «error» / «failed»
// raise it; the hint (which console method, or the caller) is the floor.
function levelOf(args, text, hint) {
  let lv = hint && RANK[hint] != null ? hint : 'info';
  const up = (l) => (RANK[l] > RANK[lv] ? (lv = l) : lv);
  // Node's own notice that node:sqlite is experimental comes on every start: not worth a warning
  if (/ExperimentalWarning|--trace-warnings/.test(text) && !args.some((a) => a instanceof Error)) return 'info';
  if (args.some((a) => a instanceof Error || (a && typeof a === 'object' && typeof a.stack === 'string'))) up('error');
  if (/(^|[^a-z])(error|errors|failed|fail|exception|fatal|crash|uncaught)([^a-z]|$)|помилк/i.test(text)) up('error');
  else if (/(^|[^a-z])(warn|warning)([^a-z]|$)|увага/i.test(text)) up('warn');
  return lv;
}

export function createServerLog({ db = null, now = () => Date.now(), secrets = [], ring = RING_SIZE } = {}) {
  const redact = makeRedactor(secrets);
  const buf = [];
  let seq = 0, busy = false, restore = null, prunedAt = 0;
  const startedAt = now();
  let ins = null;
  try {
    ins = db ? db.prepare('INSERT INTO server_log (ts, level, msg, stack) VALUES (?, ?, ?, ?)') : null;
  } catch {}

  // args: what was passed to log(…). Never throws (a failing log must not fail what it logs).
  function add(args, hint) {
    try {
      const list = Array.isArray(args) ? args : [args];
      const raw = list.map(argText).join(' ');
      const err = list.find((a) => a instanceof Error || (a && typeof a === 'object' && typeof a.stack === 'string'));
      const level = levelOf(list, raw, hint);
      const msg = redact(raw).slice(0, MSG_MAX);
      const stack = err?.stack ? redact(String(err.stack)).slice(0, STACK_MAX) : null;
      const e = { id: ++seq, ts: now(), level, msg, stack };
      buf.push(e);
      if (buf.length > ring) buf.splice(0, buf.length - ring);
      if (ins && level !== 'info') {
        busy = true;
        try {
          ins.run(e.ts, level, msg, stack);
        } catch {} finally {
          busy = false;
        }
      }
      return e;
    } catch {
      return null;
    }
  }
  // A log function that also records: what server.js passes around as `log`.
  const wrap = (fn) => (...a) => {
    add(a);
    busy = true;
    try {
      fn(...a);
    } finally {
      busy = false;
    }
  };
  // The real process only (server.js main): console.* lines are recorded too. A call made from inside a wrapped log
  // (which prints through console.error itself) is not recorded twice.
  function captureConsole(c = console) {
    if (restore) return restore;
    const orig = { log: c.log, info: c.info, warn: c.warn, error: c.error };
    const hints = { log: 'info', info: 'info', warn: 'warn', error: 'warn' };
    for (const k of Object.keys(orig)) {
      c[k] = (...a) => {
        if (!busy) add(a, hints[k]);
        return orig[k].apply(c, a);
      };
    }
    restore = () => {
      Object.assign(c, orig);
      restore = null;
    };
    return restore;
  }
  // Old rows go (KEEP_DAYS), then everything past the newest KEEP_ROWS. At most once a minute.
  function prune(force = false) {
    if (!db) return 0;
    const t = now();
    if (!force && t - prunedAt < 60e3) return 0;
    prunedAt = t;
    let n = db.prepare('DELETE FROM server_log WHERE ts < ?').run(t - KEEP_DAYS * 86400e3).changes;
    const cut = db.prepare('SELECT id FROM server_log ORDER BY id DESC LIMIT 1 OFFSET ?').get(KEEP_ROWS);
    if (cut) n += db.prepare('DELETE FROM server_log WHERE id <= ?').run(cut.id).changes;
    return n;
  }
  // For the admin tab. level 'all': the ring (this process, every level); 'warn' / 'error': the table (14 days).
  // q: plain text in the message or the stack; before: the id to page from.
  function query({ level = 'all', q = '', before = null, limit = 200 } = {}) {
    const lim = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)));
    const text = String(q || '').trim().slice(0, 200);
    const b = Number(before) > 0 ? Math.floor(Number(before)) : null;
    let list, more;
    if (level === 'warn' || level === 'error') {
      if (!db) return { list: [], more: false };
      const w = [level === 'error' ? "level = 'error'" : "level IN ('warn', 'error')"], a = [];
      if (b) (w.push('id < ?'), a.push(b));
      if (text) {
        const like = `%${text.replace(/[\\%_]/g, (x) => '\\' + x)}%`;
        w.push("(msg LIKE ? ESCAPE '\\' OR stack LIKE ? ESCAPE '\\')");
        a.push(like, like);
      }
      list = db.prepare(`SELECT id, ts, level, msg, stack FROM server_log WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...a, lim + 1);
    } else {
      const low = text.toLowerCase();
      list = [];
      for (let i = buf.length - 1; i >= 0 && list.length <= lim; i--) {
        const e = buf[i];
        if (b && e.id >= b) continue;
        if (low && !e.msg.toLowerCase().includes(low) && !(e.stack || '').toLowerCase().includes(low)) continue;
        list.push(e);
      }
    }
    more = list.length > lim;
    return { list: list.slice(0, lim), more };
  }
  // Errors and warnings in the last hour / 24 h, and errors per UTC hour over the last 24 h.
  function counts() {
    const t = now(), out = { h1: { error: 0, warn: 0 }, h24: { error: 0, warn: 0 }, hours: [] };
    if (!db) return out;
    for (const r of db.prepare('SELECT level, COUNT(*) n, SUM(ts >= ?) n1 FROM server_log WHERE ts >= ? GROUP BY level').all(t - 3600e3, t - 86400e3)) {
      if (r.level !== 'error' && r.level !== 'warn') continue;
      out.h24[r.level] = r.n;
      out.h1[r.level] = r.n1 || 0;
    }
    const h0 = Math.floor(t / 3600e3) - 23, by = new Map();
    for (const r of db.prepare("SELECT CAST(ts / 3600000 AS INTEGER) h, COUNT(*) n FROM server_log WHERE level = 'error' AND ts >= ? GROUP BY h").all(h0 * 3600e3)) by.set(r.h, r.n);
    for (let h = h0; h < h0 + 24; h++) out.hours.push({ h: h * 3600e3, n: by.get(h) || 0 });
    return out;
  }
  return { add, wrap, captureConsole, prune, query, counts, redact, startedAt, size: () => buf.length, ringSize: ring };
}
