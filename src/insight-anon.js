// «Ключ аналітики» (docs/INSIGHT.md): the anonymization rules shared by src/insight.js (the JSON endpoints, the chat
// log) and src/insight-sql.js (the read-only SQL sandbox).
//
// Hard rule: nothing that leaves /api/insight/* may carry a Telegram user id, a first / last name, a username, a phone,
// a photo url, a payment charge id, an invite link or any token / secret. Player ids become a pseudonym:
//   p + the first 10 hex of HMAC-SHA256(server secret, uid)
// The secret is the bot token (or ADMIN_KEY, or a random salt kept in meta on a test copy), so a pseudonym stays the
// same across restarts and joins between tables, but the analyst can't turn it back into an id.
import crypto from 'node:crypto';
import { startTag } from './metrics.js';

export function pseudonym(secret, uid) {
  if (uid == null || uid === '') return null;
  const n = Number(uid);
  // Game bots in the container auction / battles have ids ≤ 0: not people, kept readable.
  if (Number.isFinite(n) && n <= 0) return n === 0 ? null : `npc${-n}`;
  return 'p' + crypto.createHmac('sha256', String(secret)).update(String(uid)).digest('hex').slice(0, 10);
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Free text written by players (support, ideas, the chat): the author's own names, every known @username, t.me links
// (private invites), phone numbers and long digit runs (Telegram ids) are cut out. Names of other people typed in plain
// words can't be recognised — see docs/INSIGHT.md.
export function scrubText(text, names = [], usernames = null) {
  if (text == null) return null;
  let s = String(text);
  for (const n of names) {
    const v = String(n ?? '').trim();
    if (v.length >= 3) s = s.replace(new RegExp(escRe(v), 'giu'), '[ім’я]');
  }
  s = s.replace(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[^\s)\]]*/gi, '[посилання]');
  s = s.replace(/tg:\/\/[^\s)\]]*/gi, '[посилання]');
  s = s.replace(/@[A-Za-z0-9_]{3,32}/g, '@[нік]');
  if (usernames && usernames.size) s = s.replace(/[A-Za-z0-9_]{4,32}/g, (w) => (usernames.has(w.toLowerCase()) ? '[нік]' : w));
  s = s.replace(/\+\d[\d\s\-()]{7,}\d/g, '[телефон]');
  s = s.replace(/\d{7,}/g, '[id]');
  return s;
}

// The deep-link parameter folded the way «Мітки посилань» shows it: ref_<uid> → ref_…, ch_<id> → ch_…, club_… .
export const sourceTag = (p) => (p == null ? null : startTag(p));

// ---------- the SQL sandbox allowlist ----------
// Source table → exposed as v_<name> (or `view`) with only these columns. 'col' as is, 'col:u' → pseudonym,
// 'col:s' → scrubbed text, 'col:t' → start tag, { as, sql } → an expression over the source row (alias t).
// Everything not listed (usernames, names, seeds, charge ids, invite codes, admin names, rival snapshots with player
// names, car_log reasons with admin ids, server logs, admin_log, meta…) is simply not in the snapshot.
const AUTHOR = (col = 'user_id') => `(SELECT username FROM src.users WHERE id = t.${col}), (SELECT first_name FROM src.users WHERE id = t.${col})`;
const raceKind = `CASE WHEN json_valid(t.rival) THEN CASE WHEN json_extract(t.rival, '$.dayrace') IS NOT NULL THEN 'dayrace'
  WHEN json_extract(t.rival, '$.tourney') IS NOT NULL THEN 'tourney' ELSE json_extract(t.rival, '$.id') END END`;
export const ALLOW = {
  users: { cols: ['id:u', 'referrer_id:u', 'level', 'xp', 'season_xp', 'balance', 'total_value', 'slots', 'cases_opened', 'races', 'wins', 'merges',
    'streak', 'stars', 'star_credit', 'vip_until', 'premium_season', 'tank_lvl', 'frame', 'banned', 'lb_hidden', 'play_ms', 'start_param:t', 'created_at', 'last_seen'],
    note: 'гравці; id — псевдонім, start_param згорнуто в мітку (ref_…, ch_…, club_…)' },
  cars: { cols: ['id', 'owner_id:u', 'model', 'status', 'origin', 'serial', 'paint', 'livery', 'legend', 'no_state_sale', 'created_at'] },
  collection: { cols: ['user_id:u', 'model', 'at'] },
  drops: { cols: ['id', 'user_id:u', 'case_id', 'item', 'cls', 'forced', 'created_at'], note: 'кожен відкритий кейс (машини й деталі)' },
  races: { cols: ['id', 'user_id:u', 'car_id', { as: 'kind', sql: raceKind }, 'entry', 'prize', 'status', 'created_at'],
    note: 'драг-заїзди; kind: id суперника, boss, ghost, dayrace, tourney' },
  drift_runs: { cols: ['id', 'user_id:u', 'car_id', 'target', 'entry', 'prize', 'status', 'created_at'] },
  boss_runs: { cols: ['user_id:u', 'boss', 'tries', 'wins', 'best', 'beaten_at'] },
  pvp: { cols: ['id', 'creator_id:u', 'opponent_id:u', 'winner_id:u', 'bet', 'status', 'created_at', 'finished_at'] },
  battles: { cols: ['id', 'creator_id:u', 'opponent_id:u', 'winner_id:u', 'case_id', 'count', 'price', 'status', 'bot_ok', 'created_at', 'finished_at'] },
  user_days: { cols: ['day', 'user_id:u', 'sessions'], note: 'Київські дні, коли гравець робив запити (DAU, когорти)' },
  sessions: { cols: ['id', 'user_id:u', 'started_at', 'last_at', 'source:t'], note: 'візити: новий після 30 хв тиші (30 днів)' },
  funnel: { cols: ['user_id:u', 'step', 'at'], note: 'перший раз кожного кроку: intro, drop, garage, collect, race, L2…L10' },
  money_src: { cols: ['day', 'src', 'created', 'destroyed'], note: 'гривні, що з’явились / зникли за день, за джерелом (API-виклик)' },
  money_days: { cols: ['day', 'created', 'destroyed'] },
  payments: { cols: ['user_id:u', 'pack', 'stars', 'amount', 'created_at'], note: 'оплати зірками; pack: item:<id>, renew:<id>, refund:<id> або пакет' },
  vip_subs: { cols: ['user_id:u', 'stars', 'started_at', 'renewed_at', 'expires_at', 'renewals', 'canceled'] },
  star_case_rolls: { cols: ['user_id:u', 'paid', 'won', 'created_at'] },
  star_credit_log: { cols: ['id', 'user_id:u', 'delta', 'what', 'balance', 'at'] },
  user_business: { cols: ['uid:u', 'biz_id', 'level', 'eq', 'staff', 'ads', 'banked', 'manager_until', 'bought_at'] },
  clubs: { cols: ['id', 'tag', 'name', 'open', 'owner_id:u', 'treasury', 'donated', 'spent', 'created_at'] },
  club_members: { cols: ['user_id:u', 'club_id', 'role', 'joined_at', 'donated'], note: 'лише теперішні учасники' },
  club_points: { cols: ['week', 'club_id', 'user_id:u', 'pts'] },
  club_day: { cols: ['user_id:u', 'day', 'pts', 'dr', 'bonus'] },
  club_wins: { cols: ['week', 'club_id', 'user_id:u', 'n'] },
  club_goal: { cols: ['week', 'club_id', 'target', 'done'] },
  club_perks: { cols: ['club_id', 'week', 'perk', 'level', 'paid', 'by_id:u', 'at'] },
  club_log: { cols: ['id', 'club_id', 'user_id:u', 'kind', 'amount', 'at'] },
  club_weeks: { cols: ['week', 'settled_at'] },
  war_attacks: { cols: ['round', 'club_id', 'district', 'by_id:u', 'at'] },
  war_holdings: { cols: ['district', 'club_id', 'since', 'week'] },
  war_rounds: { cols: ['round', 'week', 'forced', 'settled_at'] },
  keys: { cols: ['user_id:u', 'case_id', 'count'] },
  fragments: { cols: ['user_id:u', 'case_id', 'count'] },
  parts: { cols: ['user_id:u', 'type', 'tier', 'count'] },
  quests: { cols: ['user_id:u', 'day', 'key', 'target', 'progress', 'reward', 'claimed'] },
  weekly_quests: { cols: ['user_id:u', 'week', 'key', 'target', 'progress', 'claimed'] },
  goal_days: { cols: ['user_id:u', 'day', 'case_id', 'claimed', 'at'] },
  listings: { cols: ['id', 'seller_id:u', 'car_id', 'price', 'created_at'] },
  auctions: { cols: ['id', 'seller_id:u', 'car_id', 'start_price', 'top_bid', 'top_bidder:u', 'bids', 'ends_at', 'status', 'created_at'] },
  item_sales: { cols: ['id', 'kind', 'item_key', 'seller_id:u', 'buyer_id:u', 'count', 'price', 'fee', 'base', 'created_at'] },
  trades: { cols: ['id', 'from_id:u', 'to_id:u', 'give_money', 'get_money', 'status', 'created_at', 'updated_at'] },
  container_lots: { cols: ['id', 'tier', 'model', 'ed', 'junk', 'ev', 'top_bid', 'top_bidder:u', 'bids', 'humans', 'status', 'ends_at', 'created_at', 'settled_at'] },
  barn_finds: { cols: ['id', 'user_id:u', 'model', 'status', 'done', 'spent', 'parts', 'rushed', 'created_at', 'done_at'] },
  dayrace_best: { cols: ['day', 'user_id:u', 'model', 'time', 'at', 'dq', 'place', 'field', 'prize'] },
  dayrace_tries: { cols: ['day', 'user_id:u', 'n'] },
  tourney_entries: { cols: ['tid', 'user_id:u', 'model', 'cls', 'at'] },
  tourney_prizes: { cols: ['tid', 'user_id:u', 'bracket', 'cls', 'place', 'prize', 'at'] },
  challenges: { cols: ['creator_id:u', 'time', 'day', 'created_at', 'accepted', 'beaten', 'recruits'] },
  car_log: { cols: ['id', 'car_id', 'model', 'from_uid:u', 'to_uid:u', 'status_from', 'status_to', 'kind', 'at'] },
  car_auctions: { cols: ['id', 'model', 'start_price', 'step', 'ends_at', 'created_at', 'status', 'top_bid', 'top_bidder:u', 'bids', 'settled_at'] },
  car_auction_bids: { cols: ['id', 'auction_id', 'user_id:u', 'amount', 'at'] },
  plate_auctions: { cols: ['id', 'cls', 'start_price', 'step', 'ends_at', 'created_at', 'status', 'top_bid', 'top_bidder:u', 'bids', 'settled_at', 'value'] },
  plate_auction_bids: { cols: ['id', 'auction_id', 'user_id:u', 'amount', 'at'] },
  showroom_likes: { cols: ['viewer_id:u', 'owner_id:u', 'day', 'at'] },
  promo_uses: { cols: ['code', 'user_id:u', 'at', 'amount'] },
  tg_group_claims: { cols: ['user_id:u', 'which', 'at'] },
  invite_log: { cols: ['from_id:u', 'to_id:u', 'at'] },
  badges: { cols: ['user_id:u', 'key', 'tier', 'season', 'place', 'created_at'] },
  wealth_snap: { cols: ['hour', 'user_id:u', 'balance', 'value'] },
  support: { cols: ['id', 'user_id:u', { as: 'text', sql: `insight_scrub(t.text, ${AUTHOR()})` }, 'created_at', { as: 'answer', sql: `insight_scrub(t.answer, ${AUTHOR()})` }, 'answered_at'],
    note: 'звернення в підтримку; текст очищено від імен, ніків, посилань, телефонів' },
  ideas: { cols: ['id', 'user_id:u', { as: 'text', sql: `insight_scrub(t.text, ${AUTHOR()})` }, 'tags', 'created_at'], note: 'ідеї гравців; tags — ключі S.IDEA_TAGS (mech = Механіки)' },
  bug_rewards: { cols: ['id', 'user_id:u', 'ticket_id', 'preset', 'money', 'created_at'] },
  insight_chat: { view: 'v_chat', cols: ['id', 'message_id', 'thread_id', 'topic', 'date', 'edited_at', 'reply_to', 'sender', 'sender_kind', 'is_player', 'level', 'media', 'text'],
    note: 'чат гравців (30 днів); уже псевдонімізовано при записі' },
};
export const viewName = (table) => ALLOW[table].view || `v_${table}`;

// The SELECT that fills one v_ table from src.<table>, over the columns the source really has (older databases).
export function selectFor(table, have) {
  const spec = ALLOW[table];
  const parts = [];
  for (const c of spec.cols) {
    if (typeof c === 'object') {
      parts.push(`${c.sql} AS "${c.as}"`);
      continue;
    }
    const [col, kind] = c.split(':');
    if (!have.has(col)) continue;
    const ref = `t."${col}"`;
    parts.push(kind === 'u' ? `insight_pid(${ref}) AS "${col}"` : kind === 's' ? `insight_scrub(${ref}, NULL, NULL) AS "${col}"` : kind === 't' ? `insight_tag(${ref}) AS "${col}"` : `${ref} AS "${col}"`);
  }
  return parts.length ? `SELECT ${parts.join(', ')} FROM src."${table}" t` : null;
}
// Columns of each view as documented at GET /api/insight/schema.
export function schemaDoc() {
  return Object.keys(ALLOW).map((t) => ({
    view: viewName(t), from: t, note: ALLOW[t].note || null,
    columns: ALLOW[t].cols.map((c) => (typeof c === 'object' ? { name: c.as, kind: c.as === 'kind' ? 'derived' : 'scrubbed text' }
      : { name: c.split(':')[0], kind: { u: 'pseudonym', s: 'scrubbed text', t: 'start tag' }[c.split(':')[1]] || 'value' })),
  }));
}

// ---------- read-only SQL: a conservative check before the query reaches the sandbox ----------
// One SELECT / WITH statement; no statement keyword that could write, attach or change settings; no sqlite_* /
// pragma_* names; tables after FROM / JOIN must be v_* views or the query's own CTE names. The sandbox itself holds
// only the anonymized v_* tables and runs with query_only, so this is the first of two walls, not the only one.
const FORBIDDEN = new Set(['ATTACH', 'DETACH', 'PRAGMA', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'VACUUM', 'REINDEX', 'ANALYZE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'RECURSIVE', 'TRANSACTION', 'TRIGGER', 'LOAD_EXTENSION', 'UPSERT', 'CONFLICT']);
export function checkSql(sql) {
  const bad = (error) => ({ error });
  if (typeof sql !== 'string' || !sql.trim()) return bad('Потрібен sql (рядок)');
  if (sql.length > 20000) return bad('Запит задовгий (до 20000 символів)');
  const toks = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); if (e < 0) return bad('Незакритий коментар'); i = e + 2; continue; }
    if (c === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= n) return bad('Незакритий рядок');
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      toks.push({ t: 'str' });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1, v = '';
      for (;;) {
        if (j >= n) return bad('Незакритий ідентифікатор');
        if (sql[j] === close) { if (close !== ']' && sql[j + 1] === close) { v += close; j += 2; continue; } break; }
        v += sql[j++];
      }
      toks.push({ t: 'id', v, q: true });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j])) j++;
      toks.push({ t: 'id', v: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] || ''))) { let j = i + 1; while (j < n && /[0-9A-Za-z_.]/.test(sql[j])) j++; toks.push({ t: 'num' }); i = j; continue; }
    if (c === '?' || c === ':' || c === '@' || c === '$') { let j = i + 1; while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++; toks.push({ t: 'param' }); i = j; continue; }
    toks.push({ t: 'p', v: c });
    i++;
  }
  // Single statement: a ';' only at the very end.
  while (toks.length && toks[toks.length - 1].t === 'p' && toks[toks.length - 1].v === ';') toks.pop();
  if (toks.some((k) => k.t === 'p' && k.v === ';')) return bad('Лише один запит (без ;)');
  if (!toks.length) return bad('Порожній запит');
  const first = toks[0].t === 'id' && !toks[0].q ? toks[0].v.toUpperCase() : '';
  if (first !== 'SELECT' && first !== 'WITH') return bad('Дозволено лише SELECT / WITH');
  const ctes = new Set();
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t !== 'id') continue;
    const up = tk.v.toUpperCase(), low = tk.v.toLowerCase();
    if (!tk.q && FORBIDDEN.has(up)) return bad(`Заборонено в запиті: ${up}`);
    if (!tk.q && up === 'REPLACE' && !(toks[k + 1]?.t === 'p' && toks[k + 1].v === '(')) return bad('Заборонено в запиті: REPLACE');
    if (low.startsWith('sqlite_') || low.startsWith('pragma_') || low === 'load_extension') return bad(`Заборонено в запиті: ${tk.v}`);
    // A CTE: name [ (cols) ] AS [NOT] [MATERIALIZED] (
    let m = k + 1;
    if (toks[m]?.t === 'p' && toks[m].v === '(') {
      let depth = 0;
      for (; m < toks.length; m++) {
        if (toks[m].t === 'p' && toks[m].v === '(') depth++;
        else if (toks[m].t === 'p' && toks[m].v === ')' && --depth === 0) { m++; break; }
      }
    }
    if (toks[m]?.t === 'id' && toks[m].v.toUpperCase() === 'AS') {
      let a = m + 1;
      while (toks[a]?.t === 'id' && ['NOT', 'MATERIALIZED'].includes(toks[a].v.toUpperCase())) a++;
      if (toks[a]?.t === 'p' && toks[a].v === '(') ctes.add(low);
    }
  }
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t !== 'id' || tk.q || !['FROM', 'JOIN'].includes(tk.v.toUpperCase())) continue;
    let nx = toks[k + 1];
    if (!nx || nx.t !== 'id') continue; // a sub-query «FROM (»
    if (['main', 'temp'].includes(nx.v.toLowerCase()) && toks[k + 2]?.t === 'p' && toks[k + 2].v === '.') nx = toks[k + 3];
    if (!nx || nx.t !== 'id') return bad('Незрозуміла назва таблиці');
    const low = nx.v.toLowerCase();
    if (!low.startsWith('v_') && !ctes.has(low) && !['json_each', 'json_tree'].includes(low)) return bad(`Дозволено лише v_* таблиці (див. /api/insight/schema), а не «${nx.v}»`);
  }
  return { sql: sql.trim().replace(/;+\s*$/, '') };
}
