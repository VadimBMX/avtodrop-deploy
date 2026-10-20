import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { createGame, GameError } from './src/game.js';
import { verifyInitData } from './src/auth.js';
import { createBot } from './src/bot.js';
import { PACKS, REF_REWARD } from './public/shared.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const CSP = "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org";

export function createApp({ dbFile, token = '', dev = false, webappUrl = '', admins = [], adminKey = '', log = console.error } = {}) {
  const db = openDb(dbFile);
  let bot = null;
  const game = createGame(db, { notify: (uid, text) => bot?.notify(uid, text), admins });
  if (token) bot = createBot({ token, webappUrl, admins, game, log });

  // Photos dropped into public/cars/<model-id>.(webp|png|jpg) and public/parts/<part-type>.(…) are picked up automatically.
  const imagesCache = {};
  function folderImages(dir) {
    const c = imagesCache[dir];
    if (c && c.until > Date.now()) return c.map;
    const map = {};
    try {
      for (const f of fs.readdirSync(path.join(PUBLIC, dir))) {
        const m = /^([a-z0-9-]+)\.(webp|png|jpe?g)$/i.exec(f);
        if (m) map[m[1]] = `${dir}/${f}`;
      }
    } catch {}
    imagesCache[dir] = { map, until: Date.now() + 30e3 };
    return map;
  }
  const carImages = () => folderImages('cars');

  const authCache = new Map(); // initData → { uid, until }
  const hits = new Map(); // uid → [windowStart, count]

  function authenticate(req) {
    const init = req.headers['x-init-data'];
    if (init && token) {
      const c = authCache.get(init);
      if (c && c.until > Date.now()) return c.uid;
      const v = verifyInitData(String(init), token);
      if (!v) return null;
      game.ensureUser(v.user, v.startParam);
      if (authCache.size > 5000) authCache.clear();
      authCache.set(init, { uid: v.user.id, until: Date.now() + 10 * 60e3 });
      return v.user.id;
    }
    if (dev && req.headers['x-dev-user']) {
      try {
        const u = JSON.parse(decodeURIComponent(String(req.headers['x-dev-user'])));
        game.ensureUser(u, u.start_param);
        return u.id;
      } catch {
        return null;
      }
    }
    return null;
  }
  // Admin access: ADMIN_KEY in the x-admin-key header, a Telegram admin (ADMIN_IDS) inside the Mini App,
  // or, in DEV mode only, any request from this computer.
  const keyFails = new Map(); // ip → [windowStart, count]
  const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  function adminIdentity(req) {
    const ip = req.socket.remoteAddress || '?';
    const key = req.headers['x-admin-key'];
    if (key && adminKey) {
      const f = keyFails.get(ip);
      if (f && Date.now() - f[0] < 10 * 60e3 && f[1] >= 10) return { error: 'Забагато невдалих спроб, зачекай 10 хвилин', code: 429 };
      const a = Buffer.from(String(key)), b = Buffer.from(adminKey);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { who: 'key' };
      if (!f || Date.now() - f[0] > 10 * 60e3) keyFails.set(ip, [Date.now(), 1]);
      else f[1]++;
      return { error: 'Невірний ключ', code: 401 };
    }
    const init = req.headers['x-init-data'];
    if (init && token) {
      const v = verifyInitData(String(init), token);
      // Owners from ADMIN_IDS, plus admins and helpers given rights in the panel.
      if (v && game.roleOf(v.user.id)) return { who: `tg:${v.user.id}` };
      return { error: 'Немає доступу', code: 403 };
    }
    if (dev && isLocal(req)) return { who: 'local' };
    return { error: 'Потрібен ключ адміністратора', code: 401 };
  }
  async function handleAdmin(req, res, name) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const id = adminIdentity(req);
    if (id.error) return send(res, id.code, { error: id.error });
    const body = await readBody(req);
    if (name === 'whoami') return send(res, 200, { who: id.who, role: id.who.startsWith('tg:') ? game.roleOf(Number(id.who.slice(3))) : 'owner', dev, bot: bot?.username || null });
    const fn = game.admin[name];
    if (!fn) return send(res, 404, { error: 'Невідомий метод' });
    return send(res, 200, fn(id.who, body) ?? {});
  }
  const canAdmin = (req, uid) => !!game.roleOf(uid) || (dev && isLocal(req));

  function limited(uid) {
    const t = Date.now();
    const h = hits.get(uid);
    if (!h || t - h[0] > 10e3) {
      hits.set(uid, [t, 1]);
      return false;
    }
    return ++h[1] > 60;
  }

  function send(res, code, body, type = 'application/json; charset=utf-8') {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP, 'referrer-policy': 'no-referrer' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 32 * 1024) {
          reject(new GameError('Запит завеликий'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!size) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) || {});
        } catch {
          reject(new GameError('Некоректний JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  async function handleApi(req, res, name) {
    if (name === 'config') {
      // Community links (Telegram channel with news, players' chat) come from Railway variables; empty = button hidden.
      const community = { channel: process.env.TG_CHANNEL_URL || '', chat: process.env.TG_CHAT_URL || '' };
      return send(res, 200, { dev, bot: bot?.username || null, stars: !!bot, packs: PACKS, images: carImages(), partImages: folderImages('parts'), community });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const uid = authenticate(req);
    if (!uid) return send(res, 401, { error: 'Відкрий гру через Telegram' });
    if (limited(uid)) return send(res, 429, { error: 'Забагато запитів, зачекай секунду' });
    if (game.isBanned(uid)) return send(res, 403, { error: 'Акаунт заблоковано адміністрацією' });
    const body = await readBody(req);
    if (name === 'shop/invoice') {
      if (!bot) throw new GameError('Оплата зірками стане доступною після підключення бота');
      if (body.item) return send(res, 200, { link: await bot.itemInvoiceLink(uid, String(body.item), game.itemPrice(uid, String(body.item))) });
      if (!PACKS.some((p) => p.id === body.pack)) throw new GameError('Невідомий пакет');
      return send(res, 200, { link: await bot.invoiceLink(uid, body.pack, game.packAmountFor(uid, body.pack)) });
    }
    if (name === 'ref') {
      const invited = db.q('SELECT COUNT(*) n, COALESCE(SUM(ref_paid), 0) paid FROM users WHERE referrer_id = ?').get(uid);
      return send(res, 200, { link: bot?.username ? `https://t.me/${bot.username}?start=ref_${uid}` : null, invited: invited.n, earned: invited.paid * REF_REWARD });
    }
    const fn = game.api[name];
    if (!fn) return send(res, 404, { error: 'Невідомий метод' });
    const out = fn(uid, body) ?? {};
    if (name === 'me') out.admin = canAdmin(req, uid);
    return send(res, 200, out);
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
    });
  }

  function devRailway(res, args) {
    const root = path.dirname(fileURLToPath(import.meta.url));
    // shell: true so Windows finds railway.cmd / railway.exe on PATH.
    execFile('railway', args, { cwd: root, timeout: 10 * 60e3, maxBuffer: 8e6, shell: true }, (err, out, errOut) => {
      send(res, 200, { ok: !err, out: String(out), err: String(errOut || (err && err.message) || '') });
    });
  }
  function devCars(res, script) {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const py = process.platform === 'win32' ? 'python' : 'python3';
    execFile(py, ['-I', path.join(root, 'tools', script)], { cwd: root, timeout: 15 * 60e3, maxBuffer: 8e6, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (err, out, errOut) => {
      send(res, 200, { ok: !err, out: String(out), err: String(errOut || (err && err.message) || '') });
    });
  }

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    try {
      if (pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
      // DEV only, from this computer: process new photos in raw-cars (`npm run cars`) or re-fit all photos to one canvas.
      // DEV only, from this computer: Railway CLI status / deploy (same as `railway up --detach` in the game folder).
      if ((pathname === '/api/dev/railway-status' || pathname === '/api/dev/deploy') && dev && isLocal(req) && req.method === 'POST') return devRailway(res, pathname.endsWith('deploy') ? ['up', '--detach'] : ['status']);
      if ((pathname === '/api/dev/cars' || pathname === '/api/dev/normalize') && dev && isLocal(req) && req.method === 'POST') return devCars(res, pathname.endsWith('normalize') ? 'normalize_cars.py' : 'prepare_cars.py');
      if (pathname.startsWith('/api/admin/')) return await handleAdmin(req, res, pathname.slice(11));
      if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname.slice(5));
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
      return serveStatic(req, res, pathname);
    } catch (e) {
      if (e instanceof GameError) return send(res, 400, { error: e.message });
      log('server error:', e);
      if (!res.headersSent) send(res, 500, { error: 'Помилка сервера, спробуй ще раз' });
    }
  });

  const sweeper = setInterval(() => {
    try {
      game.settleAuctions();
    } catch (e) {
      log('auction sweep:', e);
    }
  }, 15e3);
  sweeper.unref();

  return {
    server, game, db, bot,
    async start(port) {
      if (bot) {
        try {
          log(`Bot @${await bot.start()} connected`);
        } catch (e) {
          log('Bot failed to start:', e.message);
        }
      }
      await new Promise((r) => server.listen(port, r));
      return server.address().port;
    },
    close() {
      clearInterval(sweeper);
      bot?.stop();
      server.close();
      db.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.BOT_TOKEN || '';
  const dev = process.env.DEV === '1' || !token;
  const dbFile = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'avtodrop.db');
  // Moving to a new host: a snapshot shipped as src/seed/avtodrop.db becomes the database on the very first start
  // (only when there is no database yet, so it can never overwrite live data).
  const seed = path.join(ROOT, 'src', 'seed', 'avtodrop.db');
  if (!fs.existsSync(dbFile) && fs.existsSync(seed)) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    fs.copyFileSync(seed, dbFile);
    console.log('База перенесена зі знімка src/seed/avtodrop.db');
  }
  const app = createApp({
    dbFile,
    token, dev,
    webappUrl: process.env.WEBAPP_URL || '',
    admins: (process.env.ADMIN_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean),
    adminKey: process.env.ADMIN_KEY || '',
  });
  const port = await app.start(Number(process.env.PORT) || 3100);
  console.log(`АВТОДРОП: http://localhost:${port}${dev ? '  (DEV-режим: вхід без Telegram)' : ''}`);
  console.log(`Адмін-панель: http://localhost:${port}/admin.html`);
  if (dev && token) console.warn('Увага: DEV=1 разом із BOT_TOKEN — будь-хто може увійти як будь-який гравець. Не вмикай це на сервері.');
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (app.close(), process.exit(0)));
}
