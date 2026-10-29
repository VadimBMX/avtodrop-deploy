// Admin «Логи» (src/logs.js, src/serverlog.js, public/admin-logs.js): the event feed (empty DB, sources, filters,
// cursor paging, CSV), sessions and their write throttle, server-log redaction / capture / pruning, and who may see what.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createApp } from '../server.js';
import { createServerLog, makeRedactor, KEEP_ROWS } from '../src/serverlog.js';
import { SESSION_WRITE_MS, SESSION_GAP_MS, FEED_PAGE } from '../src/logs.js';

const T0 = Date.parse('2026-10-20T10:00:00Z');
function setup() {
  const db = openDb(':memory:');
  let t = T0;
  const g = createGame(db, { now: () => t, notify: () => {}, admins: [1] });
  return { db, g, clock: (ms) => (t += ms), now: () => t };
}

test('logs: every tab answers on an empty database', () => {
  const { g } = setup();
  const F = g.adminCall('local', 'logs/feed', {});
  assert.deepEqual(F.list, []);
  assert.equal(F.more, false);
  assert.equal(F.cursor, null);
  assert.equal(F.window, '24h');
  for (const w of ['1h', '7d', '30d']) assert.equal(g.adminCall('local', 'logs/feed', { window: w, types: ['drop', 'pay', 'bogus'], q: 'x' }).list.length, 0);
  const E = g.adminCall('local', 'logs/export', {});
  assert.equal(E.n, 0);
  assert.match(E.csv, /^time_utc,type,player_id,player,event,amount,currency,counterpart_id,counterpart\r\n$/);
  const S = g.adminCall('local', 'logs/sessions', {});
  assert.deepEqual(S.list, []);
  assert.equal(S.today.sessions, 0);
  assert.equal(S.today.hours.length, 24);
  const V = g.adminCall('local', 'logs/server', {});
  assert.deepEqual(V.list, []);
  assert.equal(V.counts.h24.error, 0);
  assert.equal(V.counts.hours.length, 24);
});

test('logs: the feed merges sources newest first, filters by player / type / text, pages by cursor without gaps', () => {
  const { db, g, clock } = setup();
  g.ensureUser({ id: 2, first_name: 'Ann', username: 'ann' });
  clock(1000);
  g.ensureUser({ id: 3, first_name: 'Bob', username: 'bob' }, 'ref_2');
  db.prepare('UPDATE users SET balance = 100000000, slots = 500').run();
  // several drops at the same millisecond: the cursor must not lose or repeat them
  for (let i = 0; i < 130; i++) {
    if (i % 10 === 0) clock(1000);
    g.api['case/open'](2, { caseId: 'rust' });
  }
  clock(1000);
  g.createPromo('LOGTEST', 5000, 10, 7);
  clock(1000);
  g.api.promo(3, { code: 'LOGTEST' });
  clock(1000);
  g.adminCall('local', 'money', { id: 3, amount: 777, confirm: true, reason: 'тест логів' });
  clock(1000);
  const F = g.adminCall('local', 'logs/feed', {});
  assert.equal(F.list.length, FEED_PAGE);
  assert.ok(F.more && F.cursor);
  for (let i = 1; i < F.list.length; i++) assert.ok(F.list[i - 1].t >= F.list[i].t, 'newest first');
  assert.equal(F.list[0].type, 'admin');
  assert.match(F.list[0].text, /^local: гроші · \+777/);
  assert.equal(F.list[0].uid, 3);
  assert.equal(F.list[1].type, 'gift', 'the admin grant also leaves the player a gift');
  assert.equal(F.list[1].amount, 777);
  assert.equal(F.list[2].type, 'promo');
  assert.equal(F.list[2].amount, 5000);
  // page through everything: each event once
  const seen = new Set(F.list.map((e) => e.k));
  let cur = F.cursor, pages = 1;
  while (cur) {
    const P = g.adminCall('local', 'logs/feed', { cursor: cur });
    for (const e of P.list) {
      assert.ok(!seen.has(e.k), 'no repeats ' + e.k);
      seen.add(e.k);
    }
    cur = P.cursor;
    if (++pages > 10) break;
  }
  const drops = [...seen].filter((k) => k.startsWith('d')).length;
  assert.equal(drops, 130);
  assert.ok([...seen].some((k) => k.startsWith('u')), 'signups are there');
  // player filter by @username and by id; type filter; text filter
  const bob = g.adminCall('local', 'logs/feed', { player: '@Bob' });
  assert.ok(bob.list.length >= 3 && bob.list.every((e) => e.uid === 3 || e.other === 3));
  assert.ok(bob.list.some((e) => e.type === 'signup' && e.other === 2), 'invited by Ann');
  assert.deepEqual(g.adminCall('local', 'logs/feed', { player: '3', types: ['promo'] }).list.map((e) => e.type), ['promo']);
  assert.throws(() => g.adminCall('local', 'logs/feed', { player: '@nobody' }), /не знайдено/);
  const onlyDrops = g.adminCall('local', 'logs/feed', { types: ['drop'] });
  assert.ok(onlyDrops.list.length === FEED_PAGE && onlyDrops.list.every((e) => e.type === 'drop'));
  assert.deepEqual(g.adminCall('local', 'logs/feed', { q: 'logtest' }).list.map((e) => e.type), ['promo', 'admin'], 'the use and the bot creating the code');
  // the window: two days later the last 24 h are empty, 7 days still has it all
  clock(2 * 86400e3);
  assert.equal(g.adminCall('local', 'logs/feed', {}).list.length, 0);
  assert.equal(g.adminCall('local', 'logs/feed', { window: '7d', types: ['promo'] }).list.length, 1);
});

test('logs: CSV export of the current filter — header, quoting, cap, and an admin_log line', () => {
  const { db, g, clock } = setup();
  g.ensureUser({ id: 4, first_name: 'Ім’я, "з" комою' });
  db.prepare('UPDATE users SET balance = 100000000').run();
  for (let i = 0; i < 5; i++) (clock(1000), g.api['case/open'](4, { caseId: 'rust' }));
  const E = g.adminCall('local', 'logs/export', { types: ['drop', 'signup'], window: '24h' });
  assert.equal(E.n, 6);
  assert.equal(E.truncated, false);
  const lines = E.csv.trim().split('\r\n');
  assert.equal(lines.length, 7);
  assert.match(lines[1], /^2026-10-20T10:00:05\.000Z,Кейси,4,"Ім’я, ""з"" комою",Відкрив «/);
  assert.match(lines[6], /,Реєстрації,4,/);
  const log = db.prepare("SELECT admin, details FROM admin_log WHERE action = 'logs-export'").get();
  assert.equal(log.admin, 'local');
  assert.deepEqual(JSON.parse(log.details).types.sort(), ['drop', 'signup']);
  assert.equal(JSON.parse(log.details).rows, 6);
});

test('logs: sessions — one row per visit, last_at written at most once a minute, a new one after 30 min of silence', () => {
  const { db, g, clock } = setup();
  g.ensureUser({ id: 5, first_name: 'S' });
  const a = g.sessions.hit(5, 'ref_9');
  assert.equal(a.fresh, true);
  const writes = () => db.prepare('SELECT last_at FROM sessions WHERE id = ?').get(a.id).last_at;
  // polls every 4 s for 50 s: no writes
  for (let i = 0; i < 12; i++) {
    clock(4000);
    const r = g.sessions.hit(5, 'ignored');
    assert.equal(r.fresh, false);
    assert.equal(r.wrote, false);
  }
  assert.equal(writes(), T0);
  clock(SESSION_WRITE_MS);
  assert.equal(g.sessions.hit(5).wrote, true);
  assert.equal(writes(), T0 + 48000 + SESSION_WRITE_MS);
  // after a gap a new session starts with the new source
  clock(SESSION_GAP_MS + 1000);
  const b = g.sessions.hit(5, 'tgchannel');
  assert.equal(b.fresh, true);
  assert.notEqual(b.id, a.id);
  const rows = db.prepare('SELECT source FROM sessions ORDER BY id').all().map((r) => r.source);
  assert.deepEqual(rows, ['ref_9', 'tgchannel']);
  // a bad start parameter is stored as none
  g.ensureUser({ id: 6, first_name: 'T' });
  g.sessions.hit(6, 'bad param; DROP');
  assert.equal(db.prepare('SELECT source FROM sessions WHERE user_id = 6').get().source, null);
  const S = g.adminCall('local', 'logs/sessions', {});
  assert.equal(S.list.length, 3);
  assert.equal(S.list[0].uid, 6);
  assert.equal(S.list[2].ms, 48000 + SESSION_WRITE_MS);
  assert.equal(S.list[2].note, 'посилання друга / картка дропу');
  assert.equal(S.today.sessions, 3);
  assert.equal(S.today.players, 2);
  assert.deepEqual(g.adminCall('local', 'logs/sessions', { source: '-' }).list.map((s) => s.uid), [6]);
  assert.deepEqual(g.adminCall('local', 'logs/sessions', { source: 'tgchannel' }).list.map((s) => s.uid), [5]);
  assert.equal(g.adminCall('local', 'logs/sessions', { player: '6' }).list.length, 1);
  // pruned after 30 days
  clock(31 * 86400e3);
  g.logs.prune(true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
});

test('logs: the redactor removes bot tokens, the exact secrets, initData and long hex', () => {
  const token = '7712345678:AAHk3jz-Qw_ErTyUiOpAsDfGhJkLzXcVbNm';
  const key = 'super-secret-admin-key-42';
  const r = makeRedactor([token, key, '', null, 'abc']);
  const out = r(`token ${token} key=${key} other 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123 `
    + 'query_id=AAE&user=%7B%22id%22%3A5%7D&auth_date=1700000000&hash=0123abcd&signature=xyz '
    + 'x-init-data: query_id=1 initData="foo" seed 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 ok');
  for (const bad of [token, key, '123456789:ABCDEF', '%7B%22id', '1700000000', '0123abcd', 'xyz', '"foo"', '9f86d081884c7d659a2feaa0c55ad015']) assert.ok(!out.includes(bad), bad + ' leaked: ' + out);
  assert.match(out, /\[secret\]/);
  assert.match(out, /\[bot-token\]/);
  assert.match(out, /hash=\[redacted\]/);
  assert.match(out, /\[hex\]/);
  assert.match(out, / ok$/);
  assert.equal(r('плейн текст без секретів'), 'плейн текст без секретів');
});

test('logs: the server log keeps a ring of every line and stores warnings / errors (redacted, pruned to 14 days / 20k)', () => {
  const db = openDb(':memory:');
  let t = T0;
  const s = createServerLog({ db, now: () => t, secrets: ['the-admin-key-123'], ring: 5 });
  const printed = [];
  const log = s.wrap((...a) => printed.push(a.join(' ')));
  log('Bot @x connected');
  log('auction sweep:', new Error('boom the-admin-key-123'));
  log('Увага: something odd');
  for (let i = 0; i < 4; i++) log('line', i);
  assert.equal(printed.length, 7, 'still printed');
  assert.equal(s.size(), 5, 'ring keeps the last N');
  const rows = db.prepare('SELECT level, msg, stack FROM server_log ORDER BY id').all();
  assert.deepEqual(rows.map((r) => r.level), ['error', 'warn']);
  assert.ok(!rows[0].msg.includes('the-admin-key-123') && rows[0].msg.includes('[secret]'));
  assert.ok(rows[0].stack.includes('Error: boom [secret]'));
  assert.equal(s.query({ level: 'error' }).list.length, 1);
  assert.equal(s.query({ level: 'warn' }).list.length, 2);
  assert.equal(s.query({ level: 'all', q: 'LINE 3' }).list.length, 1);
  assert.equal(s.query({ level: 'warn', q: 'boom' }).list.length, 1);
  assert.deepEqual(s.counts().h1, { error: 1, warn: 1 });
  // console capture: a line printed by the wrapped log isn't recorded twice; plain console lines are
  const fake = { log() {}, info() {}, warn() {}, error() {} };
  const restore = s.captureConsole(fake);
  fake.error('static warm-up:', new TypeError('x'));
  const before = s.size();
  assert.equal(s.query({ level: 'error' }).list[0].msg, 'static warm-up: TypeError: x');
  restore();
  fake.error('not captured any more');
  assert.equal(s.size(), before);
  // pruning: 14 days, then at most KEEP_ROWS
  t += 15 * 86400e3;
  log('fresh error', new Error('e'));
  s.prune(true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM server_log').get().n, 1);
  const ins = db.prepare("INSERT INTO server_log (ts, level, msg) VALUES (?, 'error', 'x')");
  db.exec('BEGIN');
  for (let i = 0; i < KEEP_ROWS + 50; i++) ins.run(t);
  db.exec('COMMIT');
  s.prune(true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM server_log').get().n, KEEP_ROWS);
  // a log call never throws, even with the database closed
  db.close();
  assert.doesNotThrow(() => log('after close', new Error('still fine')));
});

test('logs: helpers see the feed and sessions, never the server logs; strangers nothing', () => {
  const { g } = setup();
  for (const id of [1, 3, 4]) g.ensureUser({ id, first_name: 'U' + id });
  g.admin.role('tg:1', { id: 3, role: 'helper' });
  g.admin.role('tg:1', { id: 4, role: 'admin' });
  assert.ok(Array.isArray(g.adminCall('tg:3', 'logs/feed', {}).list));
  assert.ok(Array.isArray(g.adminCall('tg:3', 'logs/sessions', {}).list));
  assert.ok(typeof g.adminCall('tg:3', 'logs/export', {}).csv === 'string');
  assert.throws(() => g.adminCall('tg:3', 'logs/server', {}), /Немає прав/);
  assert.throws(() => g.admin['logs/server']('tg:3', {}), /Немає прав/);
  assert.ok(Array.isArray(g.adminCall('tg:4', 'logs/server', { level: 'error' }).list), 'an admin may');
  assert.ok(Array.isArray(g.adminCall('tg:1', 'logs/server', {}).list), 'the owner may');
  for (const a of ['logs/feed', 'logs/sessions', 'logs/server', 'logs/export']) assert.throws(() => g.adminCall('tg:999', a, {}), /Немає прав/, a);
  // the page hides the tab from helpers
  const js = fs.readFileSync(new URL('../public/admin-logs.js', import.meta.url), 'utf8');
  assert.match(js, /c\.state\.role === 'helper' \? \[\] : \[\['server', 'Сервер'\]\]/);
  assert.match(fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8'), /data-go="logs"/);
});

test('logs: over HTTP — app opens make sessions with their source, a failing request is logged with method + path only', async () => {
  const app = createApp({ dbFile: ':memory:', log: () => {}, dev: true, adminKey: 'k-0123456789abcdef' });
  await new Promise((r) => app.server.listen(0, r));
  try {
    const base = `http://localhost:${app.server.address().port}`;
    const dev = (u) => ({ 'content-type': 'application/json', 'x-dev-user': encodeURIComponent(JSON.stringify(u)) });
    for (let i = 0; i < 3; i++) assert.equal((await fetch(base + '/api/me', { method: 'POST', headers: dev({ id: 11, first_name: 'Ivan', start_param: 'tgchannel' }), body: '{}' })).status, 200);
    await fetch(base + '/api/me', { method: 'POST', headers: dev({ id: 12, first_name: 'Olha' }), body: '{}' });
    const rows = app.db.prepare('SELECT user_id, source FROM sessions ORDER BY id').all();
    assert.deepEqual(rows.map((r) => [r.user_id, r.source]), [[11, 'tgchannel'], [12, null]]);
    // a handler that throws: 500 for the player, one error line for the admin, without the body or the headers
    const orig = app.game.api.me;
    app.game.api.me = () => {
      throw new Error('kaboom');
    };
    const r = await fetch(base + '/api/me', { method: 'POST', headers: { ...dev({ id: 11, first_name: 'Ivan' }), 'x-admin-key': 'k-0123456789abcdef' }, body: JSON.stringify({ secret: 'body-value-xyz' }) });
    app.game.api.me = orig;
    assert.equal(r.status, 500);
    const adm = await fetch(base + '/api/admin/logs/server', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'error' }) });
    assert.equal(adm.status, 200);
    const L = await adm.json();
    const e = L.list.find((x) => /kaboom/.test(x.msg));
    assert.ok(e, 'logged');
    assert.match(e.msg, /^server error: POST \/api\/me Error: kaboom/);
    assert.ok(!JSON.stringify(L).includes('body-value-xyz') && !JSON.stringify(L).includes('k-0123456789abcdef') && !JSON.stringify(L).includes('Ivan'));
    assert.ok(e.stack.includes('kaboom'));
    // the feed over HTTP
    const F = await (await fetch(base + '/api/admin/logs/feed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    assert.ok(F.list.some((x) => x.type === 'signup' && x.uid === 12));
  } finally {
    app.close();
  }
});
