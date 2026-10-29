// Desktop admin (src/admin-pc.js, public/admin-pc.js): the live dashboard, the player extras, economy, the database
// browser's permissions and safety, the CSV export, and the installable-app files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createApp } from '../server.js';
import { csvField, csvLine, MASK } from '../src/admin-pc.js';

const T0 = Date.parse('2026-10-20T10:00:00Z');
function setup() {
  const db = openDb(':memory:');
  let t = T0;
  const g = createGame(db, { now: () => t, notify: () => {}, admins: [1] });
  return { db, g, clock: (ms) => (t += ms) };
}

test('admin-pc: the dashboard, economy and player extras answer with numbers on an empty database', () => {
  const { g } = setup();
  const L = g.adminCall('local', 'pc/live', { days: 14 });
  assert.equal(L.online.n, 0);
  assert.deepEqual(Object.keys(L.cmp), ['today', 'yesterday', 'yesterdayByNow']);
  for (const side of Object.values(L.cmp)) for (const v of Object.values(side)) assert.equal(typeof v, 'number');
  for (const k of ['signups', 'opens', 'stars', 'active']) assert.equal(L.hours.today[k].length, 24);
  assert.equal(L.days.length, 14);
  const E = g.adminCall('local', 'pc/economy', { window: '30d' });
  assert.equal(E.window, '30d');
  assert.deepEqual(E.cases, []);
  assert.equal(E.supply.balance, 0);
  assert.equal(g.adminCall('local', 'pc/economy', { window: 'bogus' }).window, '24h');
  g.ensureUser({ id: 5, first_name: 'П' });
  const P = g.adminCall('local', 'pc/player', { id: 5 });
  assert.equal(P.days.length, 14);
  assert.deepEqual(P.suspicious, []);
});

test('admin-pc: the dashboard counts today, case opens by case with real vs theoretical return, a balance jump', () => {
  const { db, g, clock } = setup();
  for (const id of [2, 3]) g.ensureUser({ id, first_name: 'U' + id });
  db.prepare('UPDATE users SET balance = 10000000').run();
  g.adminPc.snapshot();
  for (let i = 0; i < 3; i++) g.api['case/open'](2, { caseId: 'rust' });
  const L = g.adminCall('local', 'pc/live', {});
  assert.equal(L.cmp.today.newUsers, 2);
  assert.equal(L.cmp.today.opens, 3);
  assert.equal(L.online.n, 2);
  assert.equal(L.hours.today.opens.reduce((a, b) => a + b, 0), 3);
  const E = g.adminCall('local', 'pc/economy', {});
  const rust = E.cases.find((c) => c.id === 'rust');
  assert.equal(rust.opens, 3);
  assert.equal(rust.spent, 3 * 60000);
  assert.ok(rust.evRet > 0 && rust.sellRet > 0 && rust.ret > 0);
  // a day later the balance of player 3 jumped by 30M: an anomaly, and «Підозріле» on his card
  clock(25 * 3600e3);
  db.prepare('UPDATE users SET balance = balance + 30000000, last_seen = ? WHERE id = 3').run(T0 + 25 * 3600e3);
  const E2 = g.adminCall('local', 'pc/economy', {});
  assert.ok(E2.anomalies.grew.some((u) => u.id === 3 && u.grow === 30000000));
  assert.ok(g.adminCall('local', 'pc/player', { id: 3 }).suspicious.some((s) => /стрибок/.test(s.title)));
});

test('admin-pc: helpers see the dashboard and the player extras, never the economy or the database', () => {
  const { g } = setup();
  for (const id of [1, 3, 4]) g.ensureUser({ id, first_name: 'U' + id });
  g.admin.role('tg:1', { id: 3, role: 'helper' });
  g.admin.role('tg:1', { id: 4, role: 'admin' });
  assert.ok(g.adminCall('tg:3', 'pc/live', {}).online);
  assert.ok(g.adminCall('tg:3', 'pc/player', { id: 4 }).days);
  for (const a of ['pc/economy', 'db/tables', 'db/rows', 'db/export']) assert.throws(() => g.adminCall('tg:3', a, { table: 'users' }), /Немає прав/, a);
  assert.ok(g.adminCall('tg:4', 'db/tables', {}).tables.length > 20, 'an admin may browse');
  assert.throws(() => g.adminCall('tg:999', 'pc/live', {}), /Немає прав/);
});

test('admin-pc: the database browser takes only real tables and open columns; values are bound, secrets masked', () => {
  const { db, g } = setup();
  g.ensureUser({ id: 7, first_name: "Robert'); DROP TABLE users;--" });
  const r = g.adminCall('local', 'db/rows', { table: 'users', filters: [{ col: 'first_name', op: 'has', value: "'); DROP" }] });
  assert.equal(r.total.n, 1);
  assert.equal(r.rows[0].server_seed, MASK);
  assert.equal(r.rows[0].client_seed, MASK);
  assert.ok(r.cols.find((c) => c.name === 'server_seed').hidden);
  // a value that looks like SQL is a value: nothing matches, nothing breaks
  assert.equal(g.adminCall('local', 'db/rows', { table: 'users', filters: [{ col: 'id', op: 'eq', value: '1 OR 1=1' }] }).total.n, 0);
  const bad = [
    [{ table: 'users; DROP TABLE users' }, /Невідома таблиця/],
    [{ table: 'sqlite_master' }, /Невідома таблиця/],
    [{ table: 'users', sort: 'id DESC; DROP TABLE users' }, /Невідома колонка/],
    [{ table: 'users', sort: 'server_seed' }, /прихована/],
    [{ table: 'users', filters: [{ col: 'server_seed', op: 'has', value: 'a' }] }, /прихована/],
    [{ table: 'users', filters: [{ col: '"id"', op: 'eq', value: 1 }] }, /Невідома колонка/],
    [{ table: 'users', filters: [{ col: 'id', op: 'LIKE', value: 1 }] }, /Невідома умова/],
    [{ table: 'users', filters: 'id=1' }, /Некоректні фільтри/],
  ];
  for (const [b, re] of bad) assert.throws(() => g.adminCall('local', 'db/rows', b), re, JSON.stringify(b));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1, 'still there');
  // an open «Причал» lot's content stays hidden (and can't be filtered on); a finished one shows
  db.prepare("INSERT INTO container_lots (tier, model, hints, commit_hash, salt, seed, bots, ends_at, created_at, status) VALUES ('odesa', 'lada-2107', '{}', 'h', 's', 1, '[]', 1, 1, 'live')").run();
  db.prepare("INSERT INTO container_lots (tier, model, hints, commit_hash, salt, seed, bots, ends_at, created_at, status) VALUES ('odesa', 'lada-2106', '{}', 'h', 's', 1, '[]', 1, 1, 'done')").run();
  const lots = g.adminCall('local', 'db/rows', { table: 'container_lots', sort: 'id', dir: 'asc' }).rows;
  assert.equal(lots[0].model, MASK);
  assert.equal(lots[1].model, 'lada-2106');
  assert.equal(lots[1].salt, MASK);
  assert.throws(() => g.adminCall('local', 'db/rows', { table: 'container_lots', filters: [{ col: 'model', op: 'eq', value: 'lada-2107' }] }), /прихована/);
  // each look and each export goes into the action log (paging the same view is one look)
  g.adminCall('local', 'db/rows', { table: 'users', offset: 50 });
  g.adminCall('local', 'db/rows', { table: 'users', offset: 100 });
  const looks = db.prepare("SELECT details FROM admin_log WHERE action = 'db-browse'").all().map((x) => JSON.parse(x.details));
  assert.equal(looks.filter((x) => x.table === 'users' && !x.filters.length).length, 1);
  g.adminCall('local', 'db/export', { table: 'users' });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_log WHERE action = 'db-export'").get().n, 1);
});

test('admin-pc: CSV export quotes separators, quotes and line breaks, and defuses spreadsheet formulas', () => {
  assert.equal(csvField(null), '');
  assert.equal(csvField(42), '42');
  assert.equal(csvField(-5), '-5');
  assert.equal(csvField('-5'), '-5');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('він сказав "так"'), '"він сказав ""так"""');
  assert.equal(csvField('два\nрядки'), '"два\nрядки"');
  assert.equal(csvField('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField('+380'), "'+380");
  assert.equal(csvField('@nick'), "'@nick");
  assert.equal(csvField('-x'), "'-x");
  assert.equal(csvLine([1, 'Тарас', null, 'a"b']), '1,Тарас,,"a""b"');
  const { g } = setup();
  g.ensureUser({ id: 9, first_name: 'Ім’я, "з" комою' });
  const r = g.adminCall('local', 'db/export', { table: 'users', filters: [{ col: 'id', op: 'eq', value: '9' }] });
  assert.equal(r.n, 1);
  const [head, row] = r.csv.split('\r\n');
  assert.ok(head.startsWith('id,username,first_name,'));
  assert.ok(row.startsWith('9,,"Ім’я, ""з"" комою",'));
  assert.ok(row.includes(MASK), 'seeds stay masked in the file');
});

test('admin-pc: the panel is installable — manifest served as JSON, icons, a service worker that never touches the API', async () => {
  const man = JSON.parse(fs.readFileSync(new URL('../public/admin.webmanifest', import.meta.url), 'utf8'));
  assert.equal(man.start_url, '/admin.html');
  assert.equal(man.display, 'standalone');
  assert.ok(man.icons.some((i) => i.sizes === '512x512') && man.icons.some((i) => i.sizes === '192x192'));
  const html = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="manifest" href="admin\.webmanifest">/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /id="installBtn"/);
  for (const v of ['live', 'economy', 'db']) assert.match(html, new RegExp(`data-go="${v}"`));
  assert.match(html, /data-go="economy" data-admin-only/);
  assert.match(html, /data-go="db" data-admin-only/);
  const sw = fs.readFileSync(new URL('../public/admin-sw.js', import.meta.url), 'utf8');
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /req\.method !== 'GET'/);
  const js = fs.readFileSync(new URL('../public/admin-pc.js', import.meta.url), 'utf8');
  assert.match(js, /register\('admin-sw\.js', \{ scope: '\.\/admin\.html' \}\)/);
  assert.match(js, /beforeinstallprompt/);
  const app = createApp({ dbFile: ':memory:', log: () => {}, dev: true });
  await new Promise((r) => app.server.listen(0, r));
  try {
    const base = `http://localhost:${app.server.address().port}`;
    const m = await fetch(base + '/admin.webmanifest');
    assert.equal(m.status, 200);
    assert.match(m.headers.get('content-type'), /^application\/manifest\+json/);
    for (const p of ['/admin-icon-192.png', '/admin-icon-512.png']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'image/png');
    }
    assert.match((await fetch(base + '/admin-sw.js')).headers.get('content-type'), /javascript/);
    // the HTTP admin endpoint: DEV + this computer = owner; the browser answers
    const r = await fetch(base + '/api/admin/db/tables', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 200);
    const bad = await fetch(base + '/api/admin/db/rows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table: 'nope' }) });
    assert.equal(bad.status, 400);
  } finally {
    app.close();
  }
});
