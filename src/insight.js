// «Ключ аналітики для Claude» (owner-approved, docs/INSIGHT.md): READ-ONLY access for an outside analyst to the game's
// analytics, the players' chat and support, with a key the owner issues and revokes in the admin panel («Аналітика
// для Claude»). The full ADMIN_KEY is never needed. The key works only on /api/insight/* (server.js routes nothing
// else to it), stores only its sha256, and everything it returns is anonymized (src/insight-anon.js).
//
//   admin: insight (keys list), insight/issue { label, confirm }, insight/revoke { id, confirm } — owner / admin only
//   GET  /api/insight/summary?days=N   per Kyiv day: players, DAU, retention, cases, races, money, Stars, biz, clubs, war
//   GET  /api/insight/funnel?days=N    first-session funnel
//   GET  /api/insight/players?limit=&sort=&offset=
//   GET  /api/insight/chat?since=&limit=&topic=
//   GET  /api/insight/support?status=&kind=&limit=
//   GET  /api/insight/schema           the v_* views of the SQL sandbox
//   POST /api/insight/sql { sql, params, limit }
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as M from './metrics.js';
import { IDEA_TAGS } from '../public/shared.js';
import { pseudonym, scrubText, checkSql, schemaDoc } from './insight-anon.js';

export const INSIGHT = {
  maxKeys: 3, // active keys at once
  perMin: 60, // requests per key per minute
  badPerIp: 20, badWindowMs: 10 * 60e3, // wrong keys per address
  rowsMax: 2000, sqlTimeoutMs: 5000, snapshotTtlMs: 5 * 60e3, childIdleMs: 10 * 60e3,
  chatDays: 30, // the players' chat log is kept this long
  useLogMs: 3600e3, // «insight-use» goes into admin_log at most once an hour per key
};
const DAY = 86400e3;
const SQL_CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'insight-sql.js');
const MEDIA = ['photo', 'video', 'animation', 'sticker', 'voice', 'audio', 'video_note', 'document', 'poll', 'location', 'venue', 'contact', 'dice', 'story'];
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const clamp = (v, lo, hi, def) => {
  if (v == null || v === '') return def;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};

export function createInsight({ db, dbFile = ':memory:', secret = '', now = Date.now, dayOf, groupsCfg = () => ({}), log = () => {}, opts = {} }) {
  const R = { ...INSIGHT, ...opts };
  db.exec(`CREATE TABLE IF NOT EXISTS insight_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      created_at INTEGER NOT NULL, created_by TEXT NOT NULL, last_used_at INTEGER, uses INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER, revoked_by TEXT);
    CREATE TABLE IF NOT EXISTS insight_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT NOT NULL, message_id INTEGER NOT NULL,
      thread_id INTEGER NOT NULL DEFAULT 0, topic TEXT, date INTEGER NOT NULL, edited_at INTEGER, reply_to INTEGER, sender TEXT,
      sender_kind TEXT NOT NULL, is_player INTEGER NOT NULL DEFAULT 0, level INTEGER, media TEXT, text TEXT, UNIQUE (chat, message_id));
    CREATE INDEX IF NOT EXISTS insight_chat_date ON insight_chat(date);
    CREATE TABLE IF NOT EXISTS insight_topics (chat TEXT NOT NULL, thread_id INTEGER NOT NULL, name TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (chat, thread_id));`);
  const q = (sql) => db.q(sql);
  // The HMAC key of the pseudonyms: the bot token / ADMIN_KEY; a test copy without either keeps a random salt.
  let key = secret;
  if (!key) {
    key = q("SELECT value FROM meta WHERE key = 'insight_salt'").get()?.value;
    if (!key) q("INSERT INTO meta (key, value) VALUES ('insight_salt', ?)").run((key = crypto.randomBytes(32).toString('hex')));
  }
  const pid = (uid) => pseudonym(key, uid);
  const alog = (who, action, details) => q('INSERT INTO admin_log (admin, action, target, details, created_at) VALUES (?, ?, NULL, ?, ?)').run(String(who), action, JSON.stringify(details), now());

  // Every known @username (for scrubbing free text), refreshed every 10 minutes.
  let unames = null, unamesAt = 0;
  const usernames = () => {
    if (!unames || now() - unamesAt > 10 * 60e3) {
      unames = new Set(q('SELECT lower(username) u FROM users WHERE username IS NOT NULL').all().map((r) => r.u).filter((u) => u.length >= 4));
      unamesAt = now();
    }
    return unames;
  };
  const scrub = (text, names = []) => scrubText(text, names, usernames());
  const authorNames = (uid) => {
    const u = q('SELECT username, first_name FROM users WHERE id = ?').get(uid);
    return u ? [u.username, u.first_name] : [];
  };

  // ---------- keys (admin panel) ----------
  const keyOut = (r) => ({ id: r.id, label: r.label, createdAt: r.created_at, createdBy: r.created_by, lastUsedAt: r.last_used_at, uses: r.uses,
    revokedAt: r.revoked_at, revokedBy: r.revoked_by, active: !r.revoked_at });
  const activeKeys = () => q('SELECT * FROM insight_keys WHERE revoked_at IS NULL').all();
  const listKeys = () => q('SELECT * FROM insight_keys ORDER BY revoked_at IS NOT NULL, id DESC LIMIT 50').all().map(keyOut);
  const status = () => ({ keys: listKeys(), max: R.maxKeys, active: activeKeys().length, perMin: R.perMin, chatDays: R.chatDays,
    endpoints: ['GET /api/insight/summary?days=14', 'GET /api/insight/funnel?days=30', 'GET /api/insight/players?limit=100&sort=level', 'GET /api/insight/chat?since=&limit=200&topic=',
      'GET /api/insight/support?status=open', 'GET /api/insight/schema', 'POST /api/insight/sql {"sql":"SELECT …"}'] });
  function admin(name, body = {}, { who = '?', role = null } = {}) {
    if (name !== 'insight' && name !== 'insight/issue' && name !== 'insight/revoke') return undefined;
    if (role !== 'owner' && role !== 'admin') return { error: 'Немає прав на цю дію', code: 403 };
    if (name === 'insight') return status();
    const reason = String(body.reason ?? '').trim().slice(0, 300);
    if (body.confirm !== true) return { error: 'Дію не підтверджено', code: 400 };
    if (reason.length < 3 && role !== 'owner') return { error: 'Вкажи причину (від 3 символів) — вона піде в журнал дій', code: 400 };
    if (name === 'insight/issue') {
      if (activeKeys().length >= R.maxKeys) return { error: `Уже ${R.maxKeys} активні ключі — спершу вимкни непотрібний`, code: 400 };
      const label = String(body.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'Claude';
      const token = 'ins_' + crypto.randomBytes(32).toString('base64url');
      const id = Number(q('INSERT INTO insight_keys (hash, label, created_at, created_by) VALUES (?, ?, ?, ?)').run(sha(token).toString('hex'), label, now(), String(who)).lastInsertRowid);
      alog(who, 'insight-issue', { id, label, reason: reason || null });
      // The only moment the plaintext exists outside the analyst's hands: shown once, never stored.
      return { token, key: keyOut(q('SELECT * FROM insight_keys WHERE id = ?').get(id)), ...status() };
    }
    const r = q('SELECT * FROM insight_keys WHERE id = ?').get(Number(body.id) || 0);
    if (!r) return { error: 'Ключ не знайдено', code: 404 };
    if (!r.revoked_at) {
      q('UPDATE insight_keys SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(now(), String(who), r.id);
      alog(who, 'insight-revoke', { id: r.id, label: r.label, reason: reason || null });
    }
    return status();
  }

  // ---------- auth: Authorization: Bearer <token> or x-insight-key ----------
  const bad = new Map(), hits = new Map(), usedLog = new Map();
  function auth(req, ip) {
    const h = String(req.headers.authorization || '');
    const raw = (/^Bearer\s+(\S+)\s*$/i.exec(h)?.[1]) || (req.headers['x-insight-key'] ? String(req.headers['x-insight-key']).trim() : '');
    const t = now();
    const f = bad.get(ip);
    if (f && t - f[0] < R.badWindowMs && f[1] >= R.badPerIp) return { code: 429, error: 'Забагато невдалих спроб, зачекай 10 хвилин' };
    if (!raw) return { code: 401, error: 'Потрібен ключ аналітики: Authorization: Bearer <ключ>' };
    const hash = sha(raw);
    let found = null;
    for (const k of activeKeys()) {
      const stored = Buffer.from(k.hash, 'hex');
      if (stored.length === hash.length && crypto.timingSafeEqual(stored, hash)) found = k;
    }
    if (!found) {
      if (bad.size > 10000) bad.clear();
      if (!f || t - f[0] > R.badWindowMs) bad.set(ip, [t, 1]);
      else f[1]++;
      return { code: 401, error: 'Невірний або вимкнений ключ аналітики' };
    }
    const w = hits.get(found.id);
    if (!w || t - w[0] > 60e3) hits.set(found.id, [t, 1]);
    else if (++w[1] > R.perMin) return { code: 429, error: `Забагато запитів: до ${R.perMin} на хвилину` };
    q('UPDATE insight_keys SET last_used_at = ?, uses = uses + 1 WHERE id = ?').run(t, found.id);
    return { key: found };
  }
  function noteUse(k, name) {
    const t = now();
    if (t - (usedLog.get(k.id) || 0) < R.useLogMs) return;
    usedLog.set(k.id, t);
    alog(`insight:${k.id}`, 'insight-use', { id: k.id, label: k.label, endpoint: name });
  }

  // ---------- the JSON endpoints ----------
  function win(days) {
    const t = now(), today = dayOf(t), T = M.dayNum(today), first = T - days + 1;
    const firstStr = M.dayStr(first);
    const fromMs = Date.parse(firstStr + 'T00:00:00Z') - 4 * 3600e3; // Kyiv is 2–3 h ahead: start a little early, days filter the rest
    return { t, today, T, first, firstStr, fromMs, daySql: (col) => M.kyivDaySql(col, fromMs, t + 3600e3) };
  }
  function summary(sp) {
    const N = clamp(sp.get('days'), 1, 90, 14);
    const W = win(N), notes = [];
    const days = [];
    for (let d = W.first; d <= W.T; d++) days.push(M.dayStr(d));
    const out = Object.fromEntries(days.map((d) => [d, { day: d, newPlayers: 0, dau: 0, sessions: null, sessionsLogged: 0, avgSessionMin: null, retention: null,
      cases: {}, casesTotal: 0, races: { total: 0, byKind: {} }, drifts: 0, pvp: 0, battles: 0, money: { created: 0, destroyed: 0, bySource: {} },
      stars: { purchases: 0, stars: 0, refunds: 0, byItem: {} }, starCases: 0, business: { bought: 0, byBiz: {} },
      clubs: { created: 0, joined: 0, log: {} }, war: { attacks: 0 }, promoUses: 0 }]));
    const at = (d) => out[d];
    const each = (label, fn) => {
      try {
        fn();
      } catch (e) {
        notes.push(`${label}: не вдалося прочитати (${e.message})`);
      }
    };
    each('newPlayers', () => {
      for (const r of q(`SELECT ${W.daySql('created_at')} d, COUNT(*) n FROM users WHERE created_at >= ? GROUP BY d`).all(W.fromMs)) if (at(r.d)) at(r.d).newPlayers = r.n;
    });
    each('dau', () => {
      for (const r of q('SELECT day d, COUNT(*) n, SUM(sessions) s, SUM(sessions > 0) c FROM user_days WHERE day >= ? GROUP BY day').all(W.firstStr)) {
        if (!at(r.d)) continue;
        at(r.d).dau = r.n;
        at(r.d).sessions = r.c ? r.s : null;
      }
      for (const r of q(`SELECT ${W.daySql('started_at')} d, COUNT(*) n, AVG(last_at - started_at) a FROM sessions WHERE started_at >= ? GROUP BY d`).all(W.fromMs)) {
        if (!at(r.d)) continue;
        at(r.d).sessionsLogged = r.n;
        at(r.d).avgSessionMin = r.a == null ? null : Math.round(r.a / 6e3) / 10;
      }
    });
    each('retention', () => {
      const users = q(`SELECT id, ${W.daySql('created_at')} d FROM users WHERE created_at >= ?`).all(W.fromMs).filter((u) => u.d >= W.firstStr).map((u) => ({ id: u.id, day: M.dayNum(u.d) }));
      const { byUser } = M.indexActivity(q('SELECT day, user_id, sessions FROM user_days WHERE day >= ?').all(W.firstStr));
      const ret = M.retention({ users, byUser, first: W.first, today: W.T, ks: [1, 3, 7] });
      for (const c of ret.cohorts) if (at(c.day)) at(c.day).retention = { cohort: c.size, d1: c.d[1], d3: c.d[3], d7: c.d[7] };
      out._retentionAvg = ret.avg;
    });
    each('cases', () => {
      for (const r of q(`SELECT ${W.daySql('created_at')} d, case_id c, COUNT(*) n FROM drops WHERE created_at >= ? GROUP BY d, c`).all(W.fromMs)) {
        if (!at(r.d)) continue;
        at(r.d).cases[r.c] = r.n;
        at(r.d).casesTotal += r.n;
      }
    });
    each('races', () => {
      const kind = `CASE WHEN json_valid(rival) THEN CASE WHEN json_extract(rival, '$.dayrace') IS NOT NULL THEN 'dayrace' WHEN json_extract(rival, '$.tourney') IS NOT NULL THEN 'tourney'
        WHEN json_extract(rival, '$.id') IN ('boss', 'ghost') THEN json_extract(rival, '$.id') ELSE 'rival' END ELSE 'rival' END`;
      for (const r of q(`SELECT ${W.daySql('created_at')} d, ${kind} k, COUNT(*) n FROM races WHERE created_at >= ? GROUP BY d, k`).all(W.fromMs)) {
        if (!at(r.d)) continue;
        at(r.d).races.byKind[r.k] = r.n;
        at(r.d).races.total += r.n;
      }
      for (const r of q(`SELECT ${W.daySql('created_at')} d, COUNT(*) n FROM drift_runs WHERE created_at >= ? GROUP BY d`).all(W.fromMs)) if (at(r.d)) at(r.d).drifts = r.n;
      for (const r of q(`SELECT ${W.daySql('finished_at')} d, COUNT(*) n FROM pvp WHERE finished_at >= ? GROUP BY d`).all(W.fromMs)) if (at(r.d)) at(r.d).pvp = r.n;
      for (const r of q(`SELECT ${W.daySql('finished_at')} d, COUNT(*) n FROM battles WHERE finished_at >= ? GROUP BY d`).all(W.fromMs)) if (at(r.d)) at(r.d).battles = r.n;
    });
    each('money', () => {
      const rows = q('SELECT day, src, created, destroyed FROM money_src WHERE day >= ?').all(W.firstStr);
      for (const r of rows) {
        const x = at(r.day);
        if (!x) continue;
        const g = M.groupOf(r.src);
        const b = (x.money.bySource[g] ||= { created: 0, destroyed: 0 });
        b.created += r.created;
        b.destroyed += r.destroyed;
        x.money.created += r.created;
        x.money.destroyed += r.destroyed;
      }
      const since = q('SELECT MIN(day) d FROM money_src').get()?.d;
      if (since && since > W.firstStr) notes.push(`money: розбивка за джерелом пишеться з ${since}`);
    });
    each('stars', () => {
      for (const r of q(`SELECT ${W.daySql('created_at')} d, pack, COUNT(*) n, SUM(stars) s FROM payments WHERE created_at >= ? GROUP BY d, pack`).all(W.fromMs)) {
        const x = at(r.d);
        if (!x) continue;
        if (String(r.pack).startsWith('refund:')) {
          x.stars.refunds += r.n;
          continue;
        }
        x.stars.purchases += r.n;
        x.stars.stars += r.s || 0;
        const item = String(r.pack).replace(/^(item|renew):/, '');
        x.stars.byItem[item] = (x.stars.byItem[item] || 0) + (r.s || 0);
      }
      for (const r of q(`SELECT ${W.daySql('created_at')} d, COUNT(*) n FROM star_case_rolls WHERE created_at >= ? GROUP BY d`).all(W.fromMs)) if (at(r.d)) at(r.d).starCases = r.n;
    });
    each('business', () => {
      for (const r of q(`SELECT ${W.daySql('bought_at')} d, biz_id b, COUNT(*) n FROM user_business WHERE bought_at >= ? GROUP BY d, b`).all(W.fromMs)) {
        if (!at(r.d)) continue;
        at(r.d).business.byBiz[r.b] = r.n;
        at(r.d).business.bought += r.n;
      }
    });
    each('clubs', () => {
      for (const r of q(`SELECT ${W.daySql('created_at')} d, COUNT(*) n FROM clubs WHERE created_at >= ? GROUP BY d`).all(W.fromMs)) if (at(r.d)) at(r.d).clubs.created = r.n;
      for (const r of q(`SELECT ${W.daySql('joined_at')} d, COUNT(*) n FROM club_members WHERE joined_at >= ? GROUP BY d`).all(W.fromMs)) if (at(r.d)) at(r.d).clubs.joined = r.n;
      for (const r of q(`SELECT ${W.daySql('at')} d, kind k, COUNT(*) n FROM club_log WHERE at >= ? GROUP BY d, k`).all(W.fromMs)) if (at(r.d)) at(r.d).clubs.log[r.k] = r.n;
    });
    each('war', () => {
      for (const r of q(`SELECT ${W.daySql('at')} d, COUNT(*) n FROM war_attacks WHERE at >= ? GROUP BY d`).all(W.fromMs)) if (at(r.d)) at(r.d).war.attacks = r.n;
    });
    each('promo', () => {
      for (const r of q(`SELECT ${W.daySql('at')} d, COUNT(*) n FROM promo_uses WHERE at >= ? GROUP BY d`).all(W.fromMs)) if (at(r.d)) at(r.d).promoUses = r.n;
    });
    const avg = out._retentionAvg || null;
    delete out._retentionAvg;
    notes.push(
      'Дні — київські (Europe/Kyiv). DAU = гравці з хоча б одним API-викликом за день (user_days).',
      'sessions — сума сесій за user_days (пауза > 30 хв = нова сесія; null там, де підрахунку ще не було); sessionsLogged / avgSessionMin — з таблиці sessions (зберігається 30 днів, last_at оновлюється раз на хвилину).',
      'retention: когорта = зареєстровані цього дня; d1/d3/d7 = частка активних через 1/3/7 днів (partial — день ще не скінчився, null — ще не настав).',
      'cases: кожне відкриття кейса (машини, деталі, трейд-ін) за case_id.',
      'races.byKind: rival — звичайні суперники, boss, ghost (виклик-привид), dayrace, tourney.',
      'money.bySource — групи src/metrics.js MONEY_GROUPS (гроші, що з’явились / зникли).',
      'stars: оплати Telegram Stars (purchases, stars); refunds — повернені. Зірки з кредиту S1 (star_credit) тут не рахуються — див. v_star_credit_log.',
      'business.bought — перші покупки бізнесів; апгрейди бізнесів не мають дати (їхні витрати видно в money.bySource.biz).',
      'clubs.joined — лише ті, хто й зараз у клубі (виходи з клубів не логуються); clubs.log — події каси / ліги з club_log.',
      'Не відстежується: перегляди екранів і натискання в клієнті (лише API-виклики), відкриті, але не оплачені рахунки Stars, виходи з клубів, історія рівнів бізнесів.',
    );
    return { days: N, today: W.today, series: days.map((d) => out[d]), retentionAvg: avg, notes };
  }

  function funnel(sp) {
    const N = clamp(sp.get('days'), 1, 180, 30);
    const W = win(N);
    const since = Number(q("SELECT value FROM meta WHERE key = 'funnel_since'").get()?.value) || 0;
    const users = q(`SELECT id, created_at, ${W.daySql('created_at')} d FROM users WHERE created_at >= ? AND created_at >= ?`).all(W.fromMs, since).filter((u) => u.d >= W.firstStr);
    const ids = new Set(users.map((u) => u.id));
    const firsts = new Map(); // uid → { step: at }
    const mark = (uid, step, t) => {
      if (!ids.has(uid) || t == null) return;
      let o = firsts.get(uid);
      if (!o) firsts.set(uid, (o = {}));
      if (o[step] == null || t < o[step]) o[step] = t;
    };
    const from = users.reduce((m, u) => Math.min(m, u.created_at), W.t);
    for (const r of q('SELECT f.user_id, f.step, f.at FROM funnel f JOIN users u ON u.id = f.user_id WHERE u.created_at >= ?').all(from)) mark(r.user_id, r.step, r.at);
    for (const r of q('SELECT d.user_id, MIN(d.created_at) at FROM drift_runs d JOIN users u ON u.id = d.user_id WHERE u.created_at >= ? GROUP BY d.user_id').all(from)) mark(r.user_id, 'drift', r.at);
    for (const r of q('SELECT b.uid, MIN(b.bought_at) at FROM user_business b JOIN users u ON u.id = b.uid WHERE u.created_at >= ? GROUP BY b.uid').all(from)) mark(r.uid, 'business', r.at);
    for (const r of q('SELECT m.user_id, m.joined_at FROM club_members m JOIN users u ON u.id = m.user_id WHERE u.created_at >= ?').all(from)) mark(r.user_id, 'club', r.joined_at);
    for (const r of q("SELECT p.user_id, MIN(p.created_at) at FROM payments p JOIN users u ON u.id = p.user_id WHERE u.created_at >= ? AND p.pack NOT LIKE 'refund:%' GROUP BY p.user_id").all(from)) mark(r.user_id, 'paid', r.at);
    const STEPS = [
      ['intro', 'Побачив інтро'], ['drop', 'Відкрив стартовий кейс (перший дроп)'], ['garage', 'Машина в гараж'], ['collect', 'Перший збір доходу'],
      ['race', 'Перший заїзд'], ['L3', 'Рівень 3'], ['L4', 'Рівень 4'], ['drift', 'Перший дрифт'], ['L5', 'Рівень 5'], ['business', 'Купив перший бізнес'],
      ['club', 'Вступив в автоклуб (теперішні учасники)'], ['paid', 'Перша оплата Stars'], ['L10', 'Рівень 10'],
    ];
    const med = (a) => {
      if (!a.length) return null;
      const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
      return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
    };
    const mature = users.filter((u) => u.created_at <= W.t - DAY);
    let prev = users.length;
    const steps = [{ key: 'signup', name: 'Реєстрація', n: users.length, pct: 1, fromPrev: null, d1: mature.length, medianMin: 0 }];
    for (const [k, name] of STEPS) {
      const mins = [];
      let d1 = 0;
      for (const u of users) {
        const t = firsts.get(u.id)?.[k];
        if (t == null) continue;
        mins.push(Math.max(0, (t - u.created_at) / 60e3));
        if (u.created_at <= W.t - DAY && t - u.created_at <= DAY) d1++;
      }
      steps.push({ key: k, name, n: mins.length, pct: users.length ? mins.length / users.length : null, fromPrev: prev ? mins.length / prev : null,
        d1, d1Pct: mature.length ? d1 / mature.length : null, medianMin: med(mins) });
      prev = mins.length;
    }
    return { days: N, signups: users.length, mature: mature.length, funnelSince: since || null, steps,
      notes: ['n / pct — гравці вікна, що колись дійшли до кроку; d1 / d1Pct — за перші 24 год, серед зареєстрованих щонайменше добу тому.',
        'Кроки intro…L10 — з таблиці funnel (лише гравці після funnel_since); drift / business / club / paid — перші записи у своїх таблицях.',
        'club — лише гравці, які й зараз у клубі. Кроки не обов’язково йдуть у цьому порядку, тож fromPrev може бути > 1.'] };
  }

  const SORTS = { level: 'u.level DESC, u.xp DESC', xp: 'u.xp DESC', money: 'u.balance DESC', value: 'u.total_value DESC', cars: 'cars DESC',
    created: 'u.created_at DESC', last_seen: 'u.last_seen DESC', stars: 'stars_spent DESC' };
  function players(sp) {
    const limit = clamp(sp.get('limit'), 1, 500, 100), offset = clamp(sp.get('offset'), 0, 1e7, 0);
    const sort = Object.hasOwn(SORTS, sp.get('sort') || '') ? sp.get('sort') : 'level';
    const rows = q(`SELECT u.id, u.level, u.xp, u.balance, u.total_value, u.created_at, u.last_seen, u.banned, u.vip_until, u.cases_opened, u.races, u.wins, u.play_ms,
        (SELECT COUNT(*) FROM cars c WHERE c.owner_id = u.id) cars,
        (SELECT COALESCE(SUM(p.stars), 0) FROM payments p WHERE p.user_id = u.id AND p.pack NOT LIKE 'refund:%') stars_spent,
        (SELECT cl.tag FROM club_members m JOIN clubs cl ON cl.id = m.club_id WHERE m.user_id = u.id) club
      FROM users u ORDER BY ${SORTS[sort]}, u.created_at LIMIT ? OFFSET ?`).all(limit, offset);
    const t = now();
    return { sort, limit, offset, total: q('SELECT COUNT(*) n FROM users').get().n, sorts: Object.keys(SORTS),
      players: rows.map((r) => ({ player: pid(r.id), level: r.level, xp: r.xp, money: r.balance, garageValue: r.total_value, cars: r.cars,
        casesOpened: r.cases_opened, races: r.races, wins: r.wins, playMin: Math.round((r.play_ms || 0) / 60e3), starsSpent: r.stars_spent, club: r.club || null,
        vip: (r.vip_until || 0) > t, banned: !!r.banned, createdAt: r.created_at, lastSeen: r.last_seen })) };
  }

  function chat(sp) {
    const limit = clamp(sp.get('limit'), 1, 1000, 200);
    const s = sp.get('since');
    const since = s == null || s === '' ? now() - 7 * DAY : /^\d+$/.test(s) ? Number(s) * (Number(s) < 1e11 ? 1000 : 1) : Date.parse(s) || 0;
    const topic = String(sp.get('topic') ?? '').trim();
    const where = ['date >= ?'], args = [since];
    if (/^\d+$/.test(topic)) (where.push('thread_id = ?'), args.push(Number(topic)));
    else if (topic) (where.push('ulower(topic) LIKE ?'), args.push(`%${topic.toLowerCase()}%`));
    const rows = q(`SELECT * FROM insight_chat WHERE ${where.join(' AND ')} ORDER BY date, message_id LIMIT ?`).all(...args, limit);
    const topics = q('SELECT thread_id, name FROM insight_topics ORDER BY thread_id').all().map((r) => ({ thread: r.thread_id, name: r.name,
      messages: q('SELECT COUNT(*) n FROM insight_chat WHERE thread_id = ?').get(r.thread_id).n }));
    return { since, limit, count: rows.length, retentionDays: R.chatDays, topics,
      messages: rows.map((r) => ({ id: r.message_id, thread: r.thread_id, topic: r.topic, date: new Date(r.date).toISOString(), at: r.date, editedAt: r.edited_at,
        replyTo: r.reply_to, sender: r.sender, senderKind: r.sender_kind, isPlayer: !!r.is_player, level: r.level, media: r.media, text: r.text })) };
  }

  function support(sp) {
    const limit = clamp(sp.get('limit'), 1, 500, 100);
    const st = ['open', 'answered', 'closed'].includes(sp.get('status')) ? sp.get('status') : 'all';
    const kind = ['support', 'ideas'].includes(sp.get('kind')) ? sp.get('kind') : 'all';
    const lvl = (uid) => q('SELECT level FROM users WHERE id = ?').get(uid)?.level ?? null;
    const statusOf = (r) => (r.answered_at == null ? 'open' : r.answer != null ? 'answered' : 'closed');
    const cond = { all: '', open: 'WHERE answered_at IS NULL', answered: 'WHERE answer IS NOT NULL', closed: 'WHERE answered_at IS NOT NULL AND answer IS NULL' }[st];
    const tickets = kind === 'ideas' ? [] : q(`SELECT * FROM support ${cond} ORDER BY id DESC LIMIT ?`).all(limit).map((r) => {
      const names = authorNames(r.user_id);
      const bug = q('SELECT preset, money FROM bug_rewards WHERE ticket_id = ?').get(r.id);
      return { kind: 'support', id: r.id, category: 'Підтримка', status: statusOf(r), text: scrub(r.text, names), createdAt: r.created_at,
        answer: r.answer == null ? null : scrub(r.answer, names), answeredAt: r.answered_at, author: pid(r.user_id), authorLevel: lvl(r.user_id),
        bugReward: bug ? { preset: bug.preset, money: bug.money } : null };
    });
    const ideas = kind === 'support' || st !== 'all' ? [] : q('SELECT * FROM ideas ORDER BY id DESC LIMIT ?').all(limit).map((r) => {
      const tags = r.tags ? r.tags.split(',') : [];
      return { kind: 'idea', id: r.id, category: tags.map((k) => String(IDEA_TAGS[k] || k).replace(/^\P{L}+/u, '')).join(', ') || null, tags,
        status: 'idea', text: scrub(r.text, authorNames(r.user_id)), createdAt: r.created_at, author: pid(r.user_id), authorLevel: lvl(r.user_id) };
    });
    return { status: st, kind, counts: { open: q('SELECT COUNT(*) n FROM support WHERE answered_at IS NULL').get().n, support: q('SELECT COUNT(*) n FROM support').get().n,
      ideas: q('SELECT COUNT(*) n FROM ideas').get().n }, tickets, ideas,
      notes: ['status: open — без відповіді; answered — з відповіддю; closed — закрито без відповіді. Ідеї («Що додати в гру?») статусу не мають.',
        'Текст очищено: імена й нік автора, @ніки, t.me-посилання, телефони й довгі числа (id) замінено.'] };
  }

  // ---------- read-only SQL (src/insight-sql.js in a child process) ----------
  let child = null, builtAt = 0, idle = null, seq = 0, chain = Promise.resolve(), waiting = 0, snapshot = null;
  const pending = new Map();
  function kill() {
    if (!child) return;
    try {
      child.kill('SIGKILL');
    } catch {}
    child = null;
    builtAt = 0;
  }
  function spawn() {
    const c = fork(SQL_CHILD, [], { execArgv: ['--no-warnings'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json' });
    c.on('message', (m) => pending.get(m.id)?.fn(m));
    c.on('exit', () => {
      if (child === c) (child = null), (builtAt = 0);
      for (const [id, p] of pending) if (p.c === c) p.fn({ id, ok: false, error: 'sandbox stopped' });
    });
    c.on('error', (e) => log('insight sql child:', e.message));
    c.unref();
    c.channel?.unref?.();
    return c;
  }
  function ask(msg, timeout) {
    if (!child) child = spawn();
    const c = child;
    return new Promise((resolve) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        if (child === c) kill();
        resolve({ ok: false, timeout: true });
      }, timeout);
      pending.set(id, { c, fn: (m) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(m);
      } });
      try {
        c.send({ ...msg, id });
      } catch (e) {
        pending.get(id)?.fn({ ok: false, error: e.message });
      }
    });
  }
  async function ensureSnapshot() {
    if (child && builtAt && now() - builtAt < R.snapshotTtlMs) return { ok: true };
    let file = dbFile, tmp = null;
    if (!dbFile || dbFile === ':memory:') {
      // A test copy (in-memory database): a private file copy for the sandbox to attach, deleted right after.
      tmp = path.join(os.tmpdir(), `avtodrop-insight-${process.pid}-${crypto.randomBytes(6).toString('hex')}.db`);
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      file = tmp;
    }
    try {
      const r = await ask({ op: 'build', file, secret: key }, 120e3);
      if (!r.ok) return { ok: false, error: r.timeout ? 'Знімок бази будувався задовго' : `Знімок бази: ${r.error}` };
      builtAt = now();
      snapshot = r.tables;
      return { ok: true };
    } finally {
      if (tmp) fs.rm(tmp, { force: true }, () => {});
    }
  }
  function cleanParams(p) {
    if (p == null) return [];
    const ok = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
    const fix = (v) => (typeof v === 'boolean' ? Number(v) : v);
    if (Array.isArray(p)) return p.length <= 100 && p.every(ok) ? p.map(fix) : null;
    if (typeof p === 'object') {
      const e = Object.entries(p);
      return e.length <= 100 && e.every(([, v]) => ok(v)) ? Object.fromEntries(e.map(([k, v]) => [k, fix(v)])) : null;
    }
    return null;
  }
  async function sql(body) {
    const c = checkSql(body?.sql);
    if (c.error) return { code: 400, error: c.error };
    const params = cleanParams(body?.params);
    if (params == null) return { code: 400, error: 'params: масив або об’єкт простих значень (до 100)' };
    const max = clamp(body?.limit, 1, R.rowsMax, R.rowsMax);
    if (waiting >= 4) return { code: 429, error: 'Зачекай: попередні запити ще виконуються' };
    waiting++;
    const run = chain.then(async () => {
      const s = await ensureSnapshot();
      if (!s.ok) return { code: 500, error: s.error };
      const r = await ask({ op: 'query', sql: c.sql, params, max }, R.sqlTimeoutMs);
      clearTimeout(idle);
      idle = setTimeout(kill, R.childIdleMs);
      idle.unref?.();
      if (r.timeout) return { code: 408, error: `Запит виконувався довше ${R.sqlTimeoutMs / 1000} с і був зупинений` };
      if (!r.ok) return { code: 400, error: /no such table/i.test(r.error) ? `${r.error} — дозволено лише v_* таблиці (див. /api/insight/schema)` : r.error };
      return { columns: r.columns, rows: r.rows, count: r.rows.length, truncated: r.truncated, maxRows: max, ms: r.ms, snapshotAt: builtAt };
    });
    chain = run.catch(() => {}).finally(() => waiting--);
    return run;
  }
  const schema = () => ({ views: schemaDoc().map((v) => ({ ...v, rows: snapshot ? snapshot[v.view] ?? null : null })),
    rules: { statement: 'один SELECT або WITH (без RECURSIVE)', maxRows: R.rowsMax, timeoutMs: R.sqlTimeoutMs, snapshotTtlMin: R.snapshotTtlMs / 60e3,
      pseudonym: 'p + 10 hex HMAC-SHA256 від id гравця; однаковий у всіх v_* таблицях і в інших ендпоінтах', times: 'мілісекунди Unix; day — київський YYYY-MM-DD' },
    example: { sql: 'SELECT case_id, COUNT(*) n FROM v_drops WHERE created_at > ? GROUP BY case_id ORDER BY n DESC', params: [Date.now() - 7 * DAY] } });

  async function handle(req, res, name, sp, { send, readBody, ip }) {
    const a = auth(req, ip);
    if (a.error) return send(res, a.code, { error: a.error });
    const GET = { summary, funnel, players, chat, support, schema, '': () => ({ endpoints: status().endpoints, docs: 'docs/INSIGHT.md' }) };
    if (name === 'sql') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      noteUse(a.key, name);
      const r = await sql(await readBody(req));
      return r.error ? send(res, r.code || 400, { error: r.error }) : send(res, 200, r);
    }
    if (!Object.hasOwn(GET, name)) return send(res, 404, { error: 'Невідомий метод' });
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'GET only' });
    noteUse(a.key, name);
    return send(res, 200, GET[name](sp));
  }

  // ---------- the players' chat log (src/bot.js → onChatMessage) ----------
  function isPlayersChat(chat) {
    const c = String(groupsCfg()?.chat || '');
    if (!c || !chat) return false;
    if (c.startsWith('@')) return !!chat.username && `@${chat.username}`.toLowerCase() === c.toLowerCase();
    return String(chat.id) === c;
  }
  function setTopic(chat, thread, name) {
    if (!thread || !name) return;
    q('INSERT INTO insight_topics (chat, thread_id, name, at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET name = excluded.name, at = excluded.at')
      .run(chat, Number(thread), String(name).slice(0, 128), now());
  }
  // A message in the configured players' chat: text or caption (never the files), pseudonymous sender. Returns true if stored.
  function onChatMessage(m, { edited = false } = {}) {
    if (!m?.chat || m.chat.type === 'private' || m.chat.type === 'channel' || !isPlayersChat(m.chat)) return false;
    const chat = String(m.chat.id);
    const thread = m.is_topic_message ? Number(m.message_thread_id) || 0 : 0;
    if (m.forum_topic_created) setTopic(chat, m.message_thread_id, m.forum_topic_created.name);
    if (m.forum_topic_edited?.name) setTopic(chat, m.message_thread_id, m.forum_topic_edited.name);
    if (thread && m.reply_to_message?.forum_topic_created) setTopic(chat, thread, m.reply_to_message.forum_topic_created.name);
    const media = MEDIA.find((k) => m[k] != null) || null;
    const raw = media === 'contact' ? null : m.text ?? m.caption ?? null;
    if (raw == null && !media) return false; // service messages (joins, pins, topic changes) are not stored
    const names = [m.from?.first_name, m.from?.last_name, m.from?.username, m.reply_to_message?.from?.first_name, m.reply_to_message?.from?.last_name,
      m.reply_to_message?.from?.username, m.forward_origin?.sender_user?.first_name, m.forward_origin?.sender_user_name];
    const text = raw == null ? null : scrub(String(raw).slice(0, 4096), names);
    if (edited) {
      return q('UPDATE insight_chat SET text = ?, edited_at = ? WHERE chat = ? AND message_id = ?').run(text, (m.edit_date || Math.floor(now() / 1000)) * 1000, chat, m.message_id).changes > 0;
    }
    let kind = 'user', sender = null, player = null;
    if (m.sender_chat) kind = m.sender_chat.id === m.chat.id ? 'anon_admin' : 'channel';
    else if (m.from?.is_bot) (kind = 'bot'), (sender = pid(m.from.id));
    else if (m.from?.id) {
      sender = pid(m.from.id);
      player = q('SELECT level FROM users WHERE id = ?').get(m.from.id) || null;
    }
    const topic = thread ? q('SELECT name FROM insight_topics WHERE chat = ? AND thread_id = ?').get(chat, thread)?.name || null : null;
    const replyTo = m.reply_to_message && !m.reply_to_message.forum_topic_created ? m.reply_to_message.message_id : null;
    return q(`INSERT OR IGNORE INTO insight_chat (chat, message_id, thread_id, topic, date, reply_to, sender, sender_kind, is_player, level, media, text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(chat, m.message_id, thread, topic, (m.date || Math.floor(now() / 1000)) * 1000, replyTo, sender, kind,
      player ? 1 : 0, player?.level ?? null, media, text).changes > 0;
  }
  let prunedAt = 0;
  function prune(force = false) {
    if (!force && now() - prunedAt < 3600e3) return 0;
    prunedAt = now();
    return q('DELETE FROM insight_chat WHERE date < ?').run(now() - R.chatDays * DAY).changes;
  }

  return { admin, handle, auth, onChatMessage, prune, sql, summary, funnel, players, chat, support, schema, pid, close: () => (clearTimeout(idle), kill()) };
}
