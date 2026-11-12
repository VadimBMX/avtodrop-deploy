// «Ключ аналітики для Claude» (src/insight.js, src/insight-anon.js, src/insight-sql.js, public/admin-insight.js,
// docs/INSIGHT.md): the read-only key (issue / revoke / hash-only / shown once), its auth (only /api/insight/*), the rate
// limit, anonymization of every endpoint, the SQL sandbox rules, and the players' chat log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../server.js';
import { openDb } from '../src/db.js';
import { createGame, dayOf } from '../src/game.js';
import { createBot } from '../src/bot.js';
import { createInsight } from '../src/insight.js';
import { checkSql, scrubText, pseudonym, ALLOW, viewName } from '../src/insight-anon.js';

const ADMIN = 'ADMIN_SECRET_KEY_0123456789';
const P = [
  { id: 4242424242, username: 'zaboronenyi_nik', first_name: 'ЗАБОРОНЕНЕ_ІМЯ', last_name: 'ПРІЗВИЩЕ_ТАЄМНЕ' },
  { id: 4242424243, username: 'secret_racer77', first_name: 'Таємниця' },
  { id: 4242424244, username: 'hidden_owner', first_name: 'Невидимка' },
];
const CHAT = { id: -1001234567890, username: 'avtodrop_chat', type: 'supergroup', title: 'АВТОДРОП чат', is_forum: true };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function boot() {
  const app = createApp({ dbFile: ':memory:', adminKey: ADMIN, log: () => {} });
  const port = await app.start(0);
  const base = `http://localhost:${port}`;
  const admin = (name, body = {}, headers = { 'x-admin-key': ADMIN }) =>
    fetch(`${base}/api/admin/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: await r.json() }));
  const get = (p, headers = {}) => fetch(`${base}/api/insight/${p}`, { headers }).then(async (r) => ({ status: r.status, text: await r.text() }));
  const post = (p, body, headers = {}) => fetch(`${base}/api/insight/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, text: await r.text() }));
  return { app, base, admin, get, post };
}

test('insight keys: issued once in plaintext, only the sha256 is stored, listed without it, revoked, capped, owner/admin only', async () => {
  const { app, admin } = await boot();
  try {
    assert.equal((await admin('insight/issue', { label: 'Claude' })).status, 400, 'needs confirm');
    const r = await admin('insight/issue', { label: 'Claude', confirm: true });
    assert.equal(r.status, 200);
    const token = r.j.token;
    assert.match(token, /^ins_[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
    const row = app.db.prepare('SELECT * FROM insight_keys WHERE id = ?').get(r.j.key.id);
    assert.equal(row.hash, sha(token));
    assert.equal(row.label, 'Claude');
    assert.equal(row.created_by, 'key');
    // The plaintext is nowhere in the database and never comes back.
    for (const { name } of app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
      const rows = app.db.prepare(`SELECT * FROM "${name}"`).all();
      assert.ok(!JSON.stringify(rows).includes(token.slice(4)), `token in ${name}`);
    }
    const list = await admin('insight');
    assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(list.j).includes(token.slice(4)));
    assert.equal(list.j.keys[0].active, true);
    // Up to 3 active keys.
    await admin('insight/issue', { label: 'b', confirm: true });
    await admin('insight/issue', { label: 'c', confirm: true });
    const fourth = await admin('insight/issue', { label: 'd', confirm: true });
    assert.equal(fourth.status, 400);
    assert.match(fourth.j.error, /активні ключі/);
    // Revoke: logged, then a new key can be issued.
    const rv = await admin('insight/revoke', { id: r.j.key.id, confirm: true });
    assert.equal(rv.status, 200);
    assert.equal(rv.j.keys.find((k) => k.id === r.j.key.id).active, false);
    assert.equal((await admin('insight/issue', { label: 'e', confirm: true })).status, 200);
    const acts = app.db.prepare("SELECT action FROM admin_log WHERE action LIKE 'insight-%'").all().map((x) => x.action);
    assert.ok(acts.includes('insight-issue') && acts.includes('insight-revoke'));
    // Helpers can't see or issue keys; admins (role) can.
    assert.equal(app.insight.admin('insight', {}, { who: 'tg:1', role: 'helper' }).code, 403);
    assert.equal(app.insight.admin('insight/issue', { confirm: true }, { who: 'tg:1', role: 'helper' }).code, 403);
    assert.equal(app.insight.admin('insight/issue', { confirm: true }, { who: 'tg:1', role: 'admin' }).code, 400, 'an admin needs a reason');
    assert.ok(app.insight.admin('insight/issue', { confirm: true, reason: 'аналітика' }, { who: 'tg:1', role: 'admin' }).token === undefined, 'max 3 active keys still applies');
    // Without any admin auth the admin endpoint is closed.
    assert.equal((await admin('insight', {}, {})).status, 401);
  } finally {
    app.close();
  }
});

test('insight auth: missing / wrong / revoked keys are refused; the key opens nothing outside /api/insight; admin key does not open insight', async () => {
  const { app, base, admin, get } = await boot();
  try {
    const { j } = await admin('insight/issue', { label: 'Claude', confirm: true });
    const token = j.token;
    assert.equal((await get('schema')).status, 401);
    assert.equal((await get('schema', { authorization: 'Bearer ins_wrong' })).status, 401);
    assert.equal((await get('schema', { authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await get('schema', { 'x-insight-key': token })).status, 200);
    assert.equal((await get('summary', { 'x-admin-key': ADMIN })).status, 401, 'the admin key is not an insight key');
    assert.equal((await get('summary', { authorization: `Bearer ${ADMIN}` })).status, 401);
    // The insight key on the admin API and the player API, in every header it could be put in.
    for (const h of [{ authorization: `Bearer ${token}` }, { 'x-insight-key': token }, { 'x-admin-key': token }]) {
      assert.equal((await admin('whoami', {}, h)).status, 401, JSON.stringify(Object.keys(h)));
      assert.equal((await admin('insight/issue', { confirm: true }, h)).status, 401);
      const me = await fetch(`${base}/api/me`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: '{}' });
      assert.equal(me.status, 401);
    }
    assert.ok(app.db.prepare('SELECT last_used_at FROM insight_keys WHERE id = ?').get(j.key.id).last_used_at > 0, 'last_used_at updated');
    assert.ok(app.db.prepare("SELECT 1 FROM admin_log WHERE action = 'insight-use'").get(), 'use is audited');
    await admin('insight/revoke', { id: j.key.id, confirm: true });
    assert.equal((await get('schema', { authorization: `Bearer ${token}` })).status, 401, 'revoked');
    // GET only on the read endpoints, POST only on sql.
    const k2 = (await admin('insight/issue', { label: 'x', confirm: true })).j.token;
    assert.equal((await get('sql', { authorization: `Bearer ${k2}` })).status, 405);
    assert.equal((await get('nope', { authorization: `Bearer ${k2}` })).status, 404);
  } finally {
    app.close();
  }
});

test('insight rate limit: 60 requests a minute per key', async () => {
  const { app, admin, get } = await boot();
  try {
    const token = (await admin('insight/issue', { label: 'Claude', confirm: true })).j.token;
    const codes = [];
    for (let i = 0; i < 62; i++) codes.push((await get('schema', { authorization: `Bearer ${token}` })).status);
    assert.equal(codes.filter((c) => c === 200).length, 60);
    assert.deepEqual(codes.slice(60), [429, 429]);
  } finally {
    app.close();
  }
});

function seed(app) {
  const { db, game } = app;
  for (const p of P) game.ensureUser(p);
  db.prepare("UPDATE users SET start_param = 'ref_4242424243', referrer_id = 4242424243 WHERE id = 4242424242").run();
  const t = Date.now();
  const ins = (sql, ...a) => db.prepare(sql).run(...a);
  ins("INSERT INTO clubs (id, tag, name, about, tg_url, owner_id, invite, created_at) VALUES (1, 'NEON', 'Neon Riders', 'пиши @zaboronenyi_nik', 'https://t.me/+SECRETINVITE', 4242424244, 'invcode9', ?)", t);
  ins('INSERT INTO club_members (user_id, club_id, role, joined_at) VALUES (4242424242, 1, ?, ?)', 'member', t);
  ins("INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, created_at) VALUES (4242424242, 'rust', 'vaz-2107', 'D', 'h', 'zaboronenyi_nik', 1, ?)", t);
  ins('INSERT INTO races (user_id, car_id, rival, entry, prize, created_at) VALUES (4242424242, 1, ?, 0, 0, ?)', JSON.stringify({ id: 'ghost', name: 'ЗАБОРОНЕНЕ_ІМЯ' }), t);
  ins("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES ('CHARGE_SECRET_XYZ', 4242424242, 'item:vip', 250, 0, ?)", t);
  ins("INSERT INTO vip_subs (user_id, charge_id, last_charge, stars, started_at, expires_at) VALUES (4242424242, 'CHARGE_SECRET_SUB', 'CHARGE_SECRET_SUB2', 250, ?, ?)", t, t + 1e9);
  ins("INSERT INTO user_business (uid, biz_id, cash_at, bought_at) VALUES (4242424242, 'wash', ?, ?)", t, t);
  ins("INSERT INTO war_attacks (round, club_id, district, by_id, at) VALUES ('r1', 1, 'podil', 4242424242, ?)", t);
  ins("INSERT INTO sessions (user_id, started_at, last_at, source) VALUES (4242424242, ?, ?, 'ref_4242424243')", t, t + 60e3);
  ins("INSERT INTO car_log (car_id, model, from_uid, to_uid, kind, reason, actor, at) VALUES (1, 'vaz-2107', 4242424242, 4242424243, 'moved', 'admin:give (tg:4242424244)', 4242424244, ?)", t);
  ins("INSERT INTO trade_chat (room_id, user_id, text, created_at) VALUES (1, 4242424242, 'ЗАБОРОНЕНЕ_ІМЯ', ?)", t);
  ins("INSERT INTO support (user_id, text, created_at, answer, answered_at, answered_by) VALUES (4242424242, ?, ?, 'Привіт, ЗАБОРОНЕНЕ_ІМЯ!', ?, 'tg:4242424244')",
    'Я ЗАБОРОНЕНЕ_ІМЯ, мій id 4242424242, пиши @zaboronenyi_nik або secret_racer77, чат https://t.me/+SECRETINVITE, тел +380 50 123 45 67', t, t);
  ins("INSERT INTO support (user_id, text, created_at) VALUES (4242424243, 'не працює звук', ?)", t);
  ins("INSERT INTO ideas (user_id, text, tags, created_at) VALUES (4242424243, 'звук машин — я Таємниця', 'mech', ?)", t);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('tggroups', ?)").run(JSON.stringify({ chat: '@avtodrop_chat' }));
}
const FORBIDDEN = [...P.flatMap((p) => [String(p.id), p.username, p.first_name, p.last_name].filter(Boolean)), 'CHARGE_SECRET', 'SECRETINVITE', 'invcode9', ADMIN, 'tg:42'];
const assertClean = (label, text) => {
  const low = text.toLowerCase();
  for (const f of FORBIDDEN) assert.ok(!low.includes(f.toLowerCase()), `${label} leaks «${f}»: ${text.slice(Math.max(0, low.indexOf(f.toLowerCase()) - 80), low.indexOf(f.toLowerCase()) + 80)}`);
};

test('insight anonymization: no Telegram id, username, name, charge id, invite or secret in any endpoint or any v_* view', async () => {
  const { app, admin, get, post } = await boot();
  try {
    seed(app);
    const msg = (id, from, text, extra = {}) => ({ message_id: id, date: Math.floor(Date.now() / 1000), chat: CHAT, from, text, ...extra });
    const f0 = { id: P[0].id, is_bot: false, first_name: P[0].first_name, last_name: P[0].last_name, username: P[0].username };
    assert.ok(app.insight.onChatMessage({ message_id: 9, date: Math.floor(Date.now() / 1000), chat: CHAT, from: f0, message_thread_id: 9, forum_topic_created: { name: '🏁 Гонки' } }) === false);
    assert.ok(app.insight.onChatMessage(msg(10, f0, 'Я ЗАБОРОНЕНЕ_ІМЯ ПРІЗВИЩЕ_ТАЄМНЕ, кличте @hidden_owner або hidden_owner, +380501234567', { is_topic_message: true, message_thread_id: 9,
      reply_to_message: { message_id: 9, forum_topic_created: { name: '🏁 Гонки' }, chat: CHAT } })));
    assert.ok(app.insight.onChatMessage(msg(11, { id: 777000111, is_bot: false, first_name: 'Невидимка' }, 'дякую Невидимка', { reply_to_message: { message_id: 10, from: f0, chat: CHAT, text: 'x' } })));
    const token = (await admin('insight/issue', { label: 'Claude', confirm: true })).j.token;
    const H = { authorization: `Bearer ${token}` };
    const all = [];
    for (const p of ['', 'summary?days=7', 'funnel?days=30', 'players?limit=500', 'players?sort=stars', 'chat?since=0', 'support', 'support?kind=ideas', 'support?status=answered', 'schema']) {
      const r = await get(p, H);
      assert.equal(r.status, 200, p + ' ' + r.text);
      assertClean(p || 'index', r.text);
      all.push(r.text);
    }
    const pid = pseudonym(ADMIN, P[0].id);
    assert.match(pid, /^p[0-9a-f]{10}$/);
    const players = JSON.parse(all[3]).players;
    const me = players.find((x) => x.player === pid);
    assert.ok(me, 'pseudonym = p + 10 hex of HMAC(ADMIN_KEY, uid)');
    assert.equal(me.club, 'NEON');
    assert.equal(me.starsSpent, 250);
    const sum = JSON.parse(all[1]);
    const today = sum.series.at(-1);
    assert.equal(today.newPlayers, 3);
    assert.equal(today.cases.rust, 1);
    assert.equal(today.stars.stars, 250);
    assert.equal(today.business.byBiz.wash, 1);
    assert.equal(today.war.attacks, 1);
    assert.equal(today.races.byKind.ghost, 1);
    assert.ok(sum.notes.length > 3);
    const sup = JSON.parse(all[6]);
    const t1 = sup.tickets.find((x) => x.author === pid);
    assert.equal(t1.status, 'answered');
    assert.match(t1.text, /\[ім’я\]/);
    assert.match(t1.text, /\[посилання\]/);
    assert.match(t1.text, /\[телефон\]/);
    assert.equal(sup.ideas[0].category, 'Механіки');
    const chat = JSON.parse(all[5]);
    assert.equal(chat.messages.length, 2);
    assert.equal(chat.messages[0].sender, pid);
    assert.equal(chat.messages[0].topic, '🏁 Гонки');
    assert.equal(chat.messages[0].isPlayer, true);
    assert.equal(chat.messages[1].isPlayer, false);
    assert.equal(chat.messages[1].replyTo, 10);
    assert.deepEqual(chat.topics.map((x) => x.name), ['🏁 Гонки']);
    // Every view of the sandbox, whole (a second key: one key is limited to 60 requests a minute).
    const H2 = { authorization: `Bearer ${(await admin('insight/issue', { label: 'Claude 2', confirm: true })).j.token}` };
    for (const [i, t] of Object.keys(ALLOW).entries()) {
      const r = await post('sql', { sql: `SELECT * FROM ${viewName(t)}` }, i < 40 ? H : H2);
      assert.equal(r.status, 200, `${t}: ${r.text}`);
      assertClean(viewName(t), r.text);
    }
    const u = JSON.parse((await post('sql', { sql: 'SELECT id, referrer_id, start_param FROM v_users WHERE id = ?', params: [pid] }, H2)).text);
    assert.deepEqual(u.rows, [{ id: pid, referrer_id: pseudonym(ADMIN, P[1].id), start_param: 'ref_…' }]);
    const j = JSON.parse((await post('sql', { sql: 'SELECT c.tag, COUNT(*) n FROM v_club_members m JOIN v_clubs c ON c.id = m.club_id JOIN v_users u ON u.id = m.user_id GROUP BY c.tag' }, H2)).text);
    assert.deepEqual(j.rows, [{ tag: 'NEON', n: 1 }], 'pseudonyms join across views');
  } finally {
    app.close();
  }
});

test('insight sql: only one SELECT / WITH on v_* views; writes, ATTACH, PRAGMA, several statements, real tables are refused', async () => {
  for (const s of ['INSERT INTO v_users VALUES (1)', 'UPDATE v_users SET level = 1', 'DELETE FROM v_users', "ATTACH DATABASE 'x.db' AS x", 'PRAGMA table_info(users)',
    'SELECT 1; SELECT 2', 'SELECT 1; DELETE FROM v_users', 'SELECT * FROM users', 'SELECT * FROM main.users', 'SELECT * FROM sqlite_master', 'SELECT * FROM pragma_table_info(\'users\')',
    'WITH x AS (SELECT 1) DELETE FROM v_users', 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x FROM c', 'SELECT load_extension(\'x\')',
    'VACUUM', 'CREATE TABLE t (a)', 'DROP TABLE v_users', 'REPLACE INTO v_users VALUES (1)', 'SELECT * FROM v_users JOIN payments', 'select * from "users"', '', 'BEGIN']) {
    assert.ok(checkSql(s).error, `should refuse: ${s}`);
  }
  for (const s of ['SELECT 1', 'select * from v_users;', "SELECT replace(text, 'a', 'b') FROM v_support", "WITH a AS (SELECT * FROM v_drops) SELECT case_id, COUNT(*) FROM a GROUP BY 1",
    "SELECT CASE WHEN level > 3 THEN 'hi' ELSE 'lo' END FROM v_users -- note ; DELETE", "SELECT ';' || 'DELETE FROM users' FROM v_users", 'SELECT * FROM v_users u JOIN v_cars c ON c.owner_id = u.id']) {
    assert.ok(!checkSql(s).error, `should allow: ${s} → ${checkSql(s).error}`);
  }
  // Rows are capped; a query that runs too long is stopped and the next one works (a fresh sandbox).
  const db = openDb(':memory:');
  createGame(db, { notify: () => {} });
  const ins = createInsight({ db, dbFile: ':memory:', secret: 's', dayOf, opts: { sqlTimeoutMs: 1500 } });
  try {
    const ten = 'WITH a(x) AS (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10))';
    const big = await ins.sql({ sql: `${ten} SELECT a1.x FROM a a1, a a2, a a3, a a4` });
    assert.equal(big.rows.length, 2000);
    assert.equal(big.truncated, true);
    const few = await ins.sql({ sql: `${ten} SELECT x FROM a`, limit: 3 });
    assert.equal(few.rows.length, 3);
    const real = await ins.sql({ sql: 'SELECT name FROM v_users, users' });
    assert.equal(real.code, 400);
    assert.match(real.error, /v_\*/);
    const slow = await ins.sql({ sql: `${ten} SELECT COUNT(*) FROM a a1, a a2, a a3, a a4, a a5, a a6, a a7, a a8, a a9, a a10, a a11` });
    assert.equal(slow.code, 408);
    const again = await ins.sql({ sql: 'SELECT COUNT(*) n FROM v_users' });
    assert.deepEqual(again.rows, [{ n: 0 }]);
    assert.equal((await ins.sql({ sql: 'SELECT ?', params: [{ a: 1 }] })).code, 400, 'params must be plain values');
  } finally {
    ins.close();
    db.close();
  }
});

test('insight chat log: only the configured players\' chat, pseudonymous, bots and anonymous admins marked, edits, 30-day sweep', () => {
  const db = openDb(':memory:');
  let t = Date.parse('2026-11-10T12:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {} });
  g.ensureUser(P[0]);
  let cfg = { chat: '@avtodrop_chat' };
  const ins = createInsight({ db, secret: 'bot-token', now: () => t, dayOf, groupsCfg: () => cfg });
  const sec = Math.floor(t / 1000);
  const from = { id: P[0].id, is_bot: false, first_name: P[0].first_name, username: P[0].username };
  const m = (id, extra) => ({ message_id: id, date: sec, chat: CHAT, from, text: `привіт ${id}`, ...extra });
  assert.equal(ins.onChatMessage(m(1)), true);
  assert.equal(ins.onChatMessage({ ...m(2), chat: { id: -100999, type: 'supergroup', username: 'other_group' } }), false, 'another group');
  assert.equal(ins.onChatMessage({ ...m(3), chat: { id: P[0].id, type: 'private' } }), false, 'private chat');
  assert.equal(ins.onChatMessage({ message_id: 4, date: sec, chat: CHAT, from, new_chat_members: [from] }), false, 'service message');
  assert.equal(ins.onChatMessage(m(5, { from: { id: 8000000001, is_bot: true, first_name: 'SomeBot', username: 'some_bot' } })), true);
  assert.equal(ins.onChatMessage(m(6, { from: { id: 1087968824, is_bot: true, first_name: 'Group', username: 'GroupAnonymousBot' }, sender_chat: { id: CHAT.id, type: 'supergroup', title: 'x' } })), true);
  assert.equal(ins.onChatMessage(m(7, { text: undefined, photo: [{ file_id: 'FILEID_SECRET' }], caption: 'моя тачка' })), true);
  const rows = db.prepare('SELECT * FROM insight_chat ORDER BY message_id').all();
  assert.deepEqual(rows.map((r) => r.message_id), [1, 5, 6, 7]);
  assert.equal(rows[0].sender, pseudonym('bot-token', P[0].id));
  assert.equal(rows[0].is_player, 1);
  assert.equal(rows[0].level, 1);
  assert.equal(rows[1].sender_kind, 'bot');
  assert.equal(rows[2].sender_kind, 'anon_admin');
  assert.equal(rows[2].sender, null);
  assert.equal(rows[3].media, 'photo');
  assert.equal(rows[3].text, 'моя тачка');
  assert.ok(!JSON.stringify(rows).includes('FILEID_SECRET') && !JSON.stringify(rows).includes(String(P[0].id)) && !JSON.stringify(rows).includes(P[0].username));
  // An edit updates the text.
  assert.equal(ins.onChatMessage({ ...m(1), text: 'виправлено', edit_date: sec + 60 }, { edited: true }), true);
  assert.equal(db.prepare('SELECT text, edited_at FROM insight_chat WHERE message_id = 1').get().text, 'виправлено');
  // A chat set by its -100 id.
  cfg = { chat: String(CHAT.id) };
  assert.equal(ins.onChatMessage({ ...m(8), chat: { id: CHAT.id, type: 'supergroup' } }), true);
  // 30 days later the old rows go, a fresh one stays.
  t += 31 * 86400e3;
  assert.equal(ins.onChatMessage({ ...m(9), date: Math.floor(t / 1000) }), true);
  assert.equal(ins.prune(true), 5);
  assert.deepEqual(db.prepare('SELECT message_id FROM insight_chat').all().map((r) => r.message_id), [9]);
  ins.close();
  db.close();
});

test('insight chat log: the bot passes group messages and edits to the log and still answers nothing there', async () => {
  const db = openDb(':memory:');
  const g = createGame(db, { notify: () => {} });
  const seen = [], calls = [];
  const realFetch = globalThis.fetch;
  let polls = 0, done, bot;
  const finished = new Promise((r) => (done = r));
  const from = { id: 5, is_bot: false, first_name: 'U5' };
  const updates = [
    { message: { message_id: 1, date: 1, chat: CHAT, from, text: '/start' } },
    { edited_message: { message_id: 1, date: 1, edit_date: 2, chat: CHAT, from, text: 'змінено' } },
    { message: { message_id: 2, date: 1, chat: { id: 5, type: 'private' }, from, text: 'привіт' } },
  ];
  globalThis.fetch = async (url, opt) => {
    const method = String(url).split('/').pop(), body = JSON.parse(opt.body || '{}');
    calls.push([method, body]);
    let result = true;
    if (method === 'getMe') result = { username: 'avtodrop_test_bot' };
    if (method === 'getMyDescription') result = { description: '' };
    if (method === 'getMyShortDescription') result = { short_description: '' };
    if (method === 'getUpdates') {
      polls++;
      result = polls === 1 ? updates.map((u, i) => ({ update_id: i + 1, ...u })) : [];
      if (polls === 2) (bot.stop(), done());
    }
    return { json: async () => ({ ok: true, result }) };
  };
  try {
    bot = createBot({ token: 'T', webappUrl: '', game: g, log: () => {}, onChatMessage: (m, o) => seen.push([m.message_id, m.chat.type, !!o.edited]) });
    await bot.start();
    await finished;
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(seen, [[1, 'supergroup', false], [1, 'supergroup', true]], 'group messages and edits only, never the private chat');
  assert.ok(calls.find(([m]) => m === 'getUpdates')[1].allowed_updates.includes('edited_message'));
  assert.equal(calls.filter(([m, b]) => m === 'sendMessage' && b.chat_id === CHAT.id).length, 0, 'nothing posted into the group');
  db.close();
});

test('insight scrub: names, @nicks, known usernames, invite links, phones and long ids', () => {
  const s = scrubText('Я Іван Петренко, @ivan_p, ivan_p, https://t.me/+AbC t.me/joinchat/x, tel +38 (050) 123-45-67, id 123456789, 500000 ₴', ['Іван', 'Петренко'], new Set(['ivan_p']));
  assert.ok(!/Іван|Петренко|ivan_p|AbC|joinchat|123456789|050/.test(s), s);
  assert.match(s, /500000 ₴/, 'game amounts under 7 digits stay');
});
