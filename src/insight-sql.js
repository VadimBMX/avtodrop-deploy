// «Ключ аналітики» → POST /api/insight/sql: the sandbox, a child process of the server (src/insight.js forks it).
// It builds an anonymized in-memory snapshot: the game's database is attached READ-ONLY (file: URI, mode=ro), each
// allowlisted table is copied into v_<table> with uid columns turned into pseudonyms and identifying columns left out
// (src/insight-anon.js ALLOW), then the source is detached and the connection set to query_only. Queries run only
// against that snapshot. A child process (not a worker thread) because SQLite can't be interrupted from node:sqlite:
// the parent kills this process when a query runs too long, and the next query gets a fresh one.
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ALLOW, selectFor, viewName, pseudonym, scrubText, sourceTag } from './insight-anon.js';

let db = null;

function build({ file, secret }) {
  db?.close();
  db = new DatabaseSync(':memory:');
  let usernames = new Set();
  db.function('insight_pid', { deterministic: true }, (v) => pseudonym(secret, v));
  db.function('insight_tag', { deterministic: true }, (v) => sourceTag(v));
  db.function('insight_scrub', { deterministic: true }, (text, a, b) => scrubText(text, [a, b], usernames));
  db.exec(`ATTACH DATABASE '${(pathToFileURL(file).href + '?mode=ro').replace(/'/g, "''")}' AS src`);
  usernames = new Set(db.prepare('SELECT lower(username) u FROM src.users WHERE username IS NOT NULL').all().map((r) => r.u).filter((u) => u.length >= 4));
  const tables = {};
  for (const t of Object.keys(ALLOW)) {
    if (!db.prepare("SELECT 1 FROM src.sqlite_master WHERE type = 'table' AND name = ?").get(t)) continue;
    const have = new Set(db.prepare(`PRAGMA src.table_info("${t}")`).all().map((c) => c.name));
    const sel = selectFor(t, have);
    if (!sel) continue;
    db.exec(`CREATE TABLE main."${viewName(t)}" AS ${sel}`);
    tables[viewName(t)] = db.prepare(`SELECT COUNT(*) n FROM main."${viewName(t)}"`).get().n;
  }
  db.exec('DETACH DATABASE src');
  db.exec('PRAGMA query_only = 1');
  return { tables };
}

const clean = (v) => (typeof v === 'bigint' ? (Number.isSafeInteger(Number(v)) ? Number(v) : String(v)) : v instanceof Uint8Array ? null : v);

function query({ sql, params, max }) {
  if (!db) throw new Error('snapshot not built');
  const st = db.prepare(sql);
  const args = Array.isArray(params) ? params : params && typeof params === 'object' ? [params] : [];
  const rows = [];
  let truncated = false, columns = null;
  for (const r of st.iterate(...args)) {
    if (rows.length >= max) {
      truncated = true;
      break;
    }
    if (!columns) columns = Object.keys(r);
    const o = {};
    for (const k in r) o[k] = clean(r[k]);
    rows.push(o);
  }
  if (!columns) columns = st.columns ? st.columns().map((c) => c.name) : [];
  return { columns, rows, truncated };
}

process.on('message', (m) => {
  const t = Date.now();
  try {
    const out = m.op === 'build' ? build(m) : m.op === 'query' ? query(m) : { pong: true };
    process.send({ id: m.id, ok: true, ms: Date.now() - t, ...out });
  } catch (e) {
    process.send({ id: m.id, ok: false, error: String(e?.message || e) });
  }
});
process.on('disconnect', () => process.exit(0));
