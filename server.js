import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { createGame, GameError } from './src/game.js';
import { verifyInitData } from './src/auth.js';
import { createBot } from './src/bot.js';
import { createSender, createReminders } from './src/reminders.js';
import { createStatic, compressSmall } from './src/static.js';
import { PACKS, PACKS_ON_SALE, REF_REWARD, MODELS, shareCaption, short } from './public/shared.js';
import { createShareStore, SHARE } from './src/share.js';
import { createChannel, START_PARAM as CHANNEL_START } from './src/channel.js';
import * as G from './public/ghost.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://t.me https://*.t.me https://telegram.org https://*.telegram.org; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org";
const SECURITY = { 'x-content-type-options': 'nosniff', 'content-security-policy': CSP, 'referrer-policy': 'no-referrer' };

export function createApp({ dbFile, token = '', dev = false, webappUrl = '', admins = [], adminKey = '', channelId = '', channelApi = null, log = console.error } = {}) {
  const db = openDb(dbFile);
  let bot = null, sender = null, reminders = null;
  // Instant events (trades, PvP, auctions, support) go first in the same rate-limited queue as the reminders;
  // admin broadcasts use the same queue at normal priority.
  const broadcast = (ids, text) => {
    if (!sender) return;
    for (const id of ids) sender.enqueue(id, text, { urgent: false });
  };
  const game = createGame(db, { notify: (uid, text) => sender?.enqueue(uid, text, { urgent: true }), admins, broadcast, seedSchedule: true });
  if (token) {
    bot = createBot({ token, webappUrl, admins, game, log, inline: (query, from) => inlineAnswer(query, from) });
    sender = createSender({ send: bot.sendMessage, onBlocked: game.push.block, isBlocked: game.push.isBlocked, log });
    game.flushStartupNotes(); // bot messages from start-up fixes (secret cars handed out by backfillSecrets)
    reminders = createReminders({ game, sender, markup: () => bot.playButton('🎁 Відкрити гру'), log });
    // Tell the team what changed in this release (once per changelog entry).
    try {
      game.announceUpdates(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'changelog.json'), 'utf8')));
    } catch (e) {
      log('changelog:', e.message);
    }
  }

  // Static files: gzip/brotli once per file version, ?v=<hash> URLs cached for a year, the rest revalidated (src/static.js).
  const statics = createStatic({ root: PUBLIC, mime: MIME, headers: SECURITY });

  // Photos dropped into public/cars/<model-id>.(webp|png|jpg) and public/parts/<part-type>.(…) are picked up automatically.
  // Their URLs carry ?v=<content hash>, so the browser keeps them for good and a replaced photo gets a new URL at once.
  const imagesCache = {};
  function folderImages(dir) {
    const c = imagesCache[dir];
    if (c && c.until > Date.now()) return c.map;
    const map = {};
    try {
      for (const f of fs.readdirSync(path.join(PUBLIC, dir))) {
        const m = /^([a-z0-9-]+)\.(webp|png|jpe?g)$/i.exec(f);
        if (m) map[m[1]] = statics.version(`${dir}/${f}`);
      }
    } catch {}
    imagesCache[dir] = { map, until: Date.now() + 30e3 };
    return map;
  }
  const carImages = () => folderImages('cars');

  const shares = createShareStore(); // drop cards uploaded for Telegram stories / shared messages (src/share.js)
  // Auto-posts to the Telegram channel (TG_CHANNEL_ID; src/channel.js). channelApi: a test's stand-in for the Bot API.
  const channel = createChannel({ db, channelId, api: channelApi || (bot ? bot.call : null), log,
    imageUrl: (model) => (httpsOrigin() && carImages()[model] ? httpsOrigin() + '/' + carImages()[model] : ''),
    cardUrl: (id) => (httpsOrigin() && shares.get(id) ? `${httpsOrigin()}/share/${id}.jpg` : ''),
    playUrl: () => (bot?.username ? (tgApp() ? `https://t.me/${bot.username}/${tgApp()}?startapp=${CHANNEL_START}` : `https://t.me/${bot.username}?start=${CHANNEL_START}`) : '') });
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
  // Wrong keys: 10 per address per 10 minutes, and 100 in total across all addresses (behind a proxy many players
  // share one address, and one attacker can have many).
  const KEY_WINDOW = 10 * 60e3, KEY_PER_IP = 10, KEY_TOTAL = 100;
  const keyFails = new Map(); // ip → [windowStart, count]
  const keyTotal = [0, 0];
  // A request that came through a reverse proxy (Caddy on the same host) is not "this computer".
  const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip'] && !req.headers.forwarded;
  const clientIp = (req) => `${req.socket.remoteAddress || '?'}|${String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()}`;
  function adminIdentity(req) {
    const ip = clientIp(req);
    const key = req.headers['x-admin-key'];
    if (key && adminKey) {
      const t = Date.now();
      if (t - keyTotal[0] > KEY_WINDOW) keyTotal.splice(0, 2, t, 0);
      const f = keyFails.get(ip);
      if ((f && t - f[0] < KEY_WINDOW && f[1] >= KEY_PER_IP) || keyTotal[1] >= KEY_TOTAL) return { error: 'Забагато невдалих спроб, зачекай 10 хвилин', code: 429 };
      const a = crypto.createHash('sha256').update(String(key)).digest(), b = crypto.createHash('sha256').update(adminKey).digest();
      if (crypto.timingSafeEqual(a, b)) return { who: 'key' };
      keyTotal[1]++;
      if (keyFails.size > 10000) keyFails.clear();
      if (!f || t - f[0] > KEY_WINDOW) keyFails.set(ip, [t, 1]);
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
    if (limited('admin:' + id.who)) return send(res, 429, { error: 'Забагато запитів, зачекай секунду' });
    const body = await readBody(req);
    if (name === 'channel' || name.startsWith('channel/')) {
      const r = await channel.admin(name, body, { who: id.who, role: id.who.startsWith('tg:') ? game.roleOf(Number(id.who.slice(3))) : 'owner' });
      if (r === undefined) return send(res, 404, { error: 'Невідомий метод' });
      return r.error ? send(res, r.code || 400, { error: r.error }) : send(res, 200, r);
    }
    if (name === 'whoami') return send(res, 200, { who: id.who, role: id.who.startsWith('tg:') ? game.roleOf(Number(id.who.slice(3))) : 'owner', dev, bot: bot?.username || null, outbox: sender ? sender.size() : 0 });
    // adminCall checks the role, and for actions that change something the confirm flag and the reason.
    const out = game.adminCall(id.who, name, body);
    if (out === undefined) return send(res, 404, { error: 'Невідомий метод' });
    return send(res, 200, out ?? {});
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
    const h = { 'content-type': type, 'cache-control': 'no-store', ...SECURITY };
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const z = type.startsWith('application/json') ? compressSmall(raw, res.req?.headers['accept-encoding']) : null;
    if (z) Object.assign(h, { 'content-encoding': z.kind, vary: 'Accept-Encoding' });
    res.writeHead(code, h);
    res.end(z ? z.body : raw);
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

  // Raw body (a share card JPEG) up to `max` bytes.
  function readRaw(req, max) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > max) {
          reject(new GameError('Картинка завелика'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  // Share a drop: the card picture (POST share/card, raw JPEG) and a prepared photo message with the player's referral
  // link for WebApp.shareMessage (POST share/prepare). Only cars from the player's own collection can be shared.
  async function handleShare(req, res, name, uid) {
    if (name === 'share/card') {
      // A declared size over the limit is answered before reading (a stream that lies is cut off by readRaw).
      if (Number(req.headers['content-length']) > SHARE.maxBytes) {
        res.setHeader('connection', 'close');
        return send(res, 413, { error: 'Картинка завелика' });
      }
      const r = shares.put(uid, await readRaw(req, SHARE.maxBytes));
      if (r.error) return send(res, r.code, { error: r.error });
      return send(res, 200, { id: r.id, path: `share/${r.id}.jpg` });
    }
    const body = await readBody(req);
    // A «Заїзд дня» result (body.dayrace = its day): the player's own time on that day's car, whatever his collection.
    const dr = body.dayrace ? game.api['dayrace/caption'](uid, { day: String(body.dayrace) }) : null;
    const m = MODELS[dr ? dr.model : String(body.model || '')];
    if (!m || (!dr && !db.q('SELECT 1 FROM collection WHERE user_id = ? AND model = ?').get(uid, m.id))) throw new GameError('Цієї машини немає у твоїй колекції');
    if (!bot?.username) throw new GameError('Поширення стане доступним після підключення бота');
    if (!/^https:\/\//.test(webappUrl)) throw new GameError('Потрібна https-адреса гри (WEBAPP_URL)');
    if (!shares.get(body.id)) throw new GameError('Картка застаріла, спробуй ще раз');
    const link = `https://t.me/${bot.username}?start=ref_${uid}`;
    const preparedId = await bot.prepareShare(uid, { photoUrl: `${new URL(webappUrl).origin}/share/${body.id}.jpg`, caption: `${dr ? dr.caption : shareCaption(m.id)}\n${link}`, link });
    if (!dr) channel.noteCard(uid, m.id, body.id); // the channel post about this car may use the same card
    return send(res, 200, { preparedId, link });
  }

  // Ghost challenges (public/ghost.js). The Mini App's short name (@BotFather → the app's link t.me/<bot>/<name>) makes
  // challenge links open the game itself (startapp=ch_<id>); without it they go through the bot (/start ch_<id>).
  const tgApp = () => (/^[A-Za-z0-9_]{3,64}$/.test(process.env.TG_APP_NAME || '') ? process.env.TG_APP_NAME : '');
  const httpsOrigin = () => (/^https:\/\//.test(webappUrl) ? new URL(webappUrl).origin : '');
  // POST challenge/prepare { id, card }: the challenge as a photo message for WebApp.shareMessage — the card picture
  // (uploaded with share/card) and «Прийняти виклик». The card is kept with the challenge for the bot's inline answers.
  async function handleChallengeShare(req, res, uid) {
    const body = await readBody(req);
    const info = game.challengeInfo(String(body.id ?? ''));
    if (!info || info.creatorId !== uid) throw new GameError('Це не твій виклик');
    if (!bot?.username) throw new GameError('Поширення стане доступним після підключення бота');
    if (!httpsOrigin()) throw new GameError('Потрібна https-адреса гри (WEBAPP_URL)');
    if (!shares.get(body.card)) throw new GameError('Картка застаріла, спробуй ще раз');
    game.challengeCard(uid, info.id, body.card);
    const link = G.challengeLink(bot.username, tgApp(), info.id);
    const preparedId = await bot.prepareShare(uid, { photoUrl: `${httpsOrigin()}/share/${body.card}.jpg`, caption: `${G.challengeCaption(info)}\n${link}`, link, button: '🏁 Прийняти виклик' });
    return send(res, 200, { preparedId, link });
  }
  // The bot's inline mode (@bot ch_<id> in any chat, or WebApp.switchInlineQuery from the challenge sheet): a live
  // challenge as its card (an article when the card is gone) with «Прийняти виклик». An empty query (or anything else):
  // the invitation with the player's own referral link, then up to 3 of their live challenges and their latest
  // «Заїзд дня» time; «дроп» — their rarest car as a card.
  function challengeResult(info) {
    const link = G.challengeLink(bot.username, tgApp(), info.id);
    const caption = G.challengeCaption(info);
    const reply_markup = { inline_keyboard: [[{ text: '🏁 Прийняти виклик', url: link }]] };
    const card = info.card && shares.get(info.card) && httpsOrigin() ? `${httpsOrigin()}/share/${info.card}.jpg` : '';
    if (card) return { type: 'photo', id: 'ch_' + info.id, photo_url: card, thumbnail_url: card, title: `Виклик: ${G.challengeLine(info.model, info.time)}`, caption, reply_markup };
    return { type: 'article', id: 'ch_' + info.id, title: `Виклик: ${G.challengeLine(info.model, info.time)}`, description: `${info.who} · драг 402 м · їдь проти привида`,
      input_message_content: { message_text: `${caption}\n${link}` }, reply_markup };
  }
  // A car photo as the article's thumbnail (Telegram takes JPEG/PNG there).
  const carThumb = (model) => {
    const p = carImages()[model];
    return p && httpsOrigin() && /\.(jpe?g|png)(\?|$)/i.test(p) ? `${httpsOrigin()}/${String(p).replace(/^\//, '')}` : '';
  };
  function inlineAnswer(query, from) {
    if (!bot?.username) return [];
    const qs = String(query || '').trim();
    const m = G.CH_PARAM.exec(qs);
    const info = m ? game.challengeInfo(m[1]) : null;
    if (info && !info.expired) return [challengeResult(info)];
    const uid = Number(from?.id) || 0;
    const link = `https://t.me/${bot.username}?start=ref_${uid}`;
    const play = (text = '🏎 Грати в АВТОДРОП') => ({ inline_keyboard: [[{ text, url: link }]] });
    const invite = { type: 'article', id: 'invite', title: 'Запросити в АВТОДРОП', description: 'Кейси зі справжніми авто, гонки й гараж. Перший кейс безкоштовно',
      input_message_content: { message_text: `${shareCaption()}\n${link}` }, reply_markup: play() };
    let mine = { challenges: [], dayrace: null, drop: null };
    try {
      if (uid) mine = game.push.inline(uid);
    } catch (e) {
      log('inline:', e.message);
    }
    const dropCard = () => {
      const d = mine.drop;
      if (!d) return null;
      const thumb = carThumb(d.id);
      return { type: 'article', id: 'drop_' + d.id.slice(0, 50), title: `Мій дроп: ${d.name}`, description: `Клас ${d.cls} · колекційна ціна ${short(d.price)}`,
        ...(thumb ? { thumbnail_url: thumb } : {}), input_message_content: { message_text: `${shareCaption(d.id)}\n${link}` }, reply_markup: play() };
    };
    if (/^(дроп|drop)/i.test(qs)) return [dropCard() || invite].concat(dropCard() ? [invite] : []);
    const recent = [];
    for (const id of mine.challenges) {
      const ch = game.challengeInfo(id);
      if (ch && !ch.expired) recent.push(challengeResult(ch));
    }
    if (mine.dayrace?.caption) {
      recent.splice(2, 0, { type: 'article', id: 'dr_' + mine.dayrace.day, title: 'Мій час у «Заїзді дня»', description: mine.dayrace.caption.split('\n')[0].replace(/^🏁 /, ''),
        input_message_content: { message_text: `${mine.dayrace.caption}\n${link}` }, reply_markup: play('🏁 Поїхати Заїзд дня') });
    }
    const out = [invite, ...recent.slice(0, 3)];
    const dc = dropCard();
    if (dc) out.push(dc);
    return out;
  }

  async function handleApi(req, res, name) {
    if (name === 'config') {
      // Community links (Telegram channel with news, players' chat) come from Railway variables; empty = button hidden.
      const community = { channel: process.env.TG_CHANNEL_URL || '', chat: process.env.TG_CHAT_URL || '' };
      // EMOJI_STATUS_ID: the custom emoji (🏁) the app offers for the Telegram status after a career milestone; empty = no offer.
      const emojiStatus = /^\d{5,25}$/.test(process.env.EMOJI_STATUS_ID || '') ? process.env.EMOJI_STATUS_ID : '';
      return send(res, 200, { dev, bot: bot?.username || null, stars: !!bot, packs: PACKS_ON_SALE ? PACKS : [], images: carImages(), partImages: folderImages('parts'), community, emojiStatus, app: tgApp(), inline: !!bot?.inline });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const uid = authenticate(req);
    if (!uid) return send(res, 401, { error: 'Відкрий гру через Telegram' });
    if (limited(uid)) return send(res, 429, { error: 'Забагато запитів, зачекай секунду' });
    if (game.isBanned(uid)) return send(res, 403, { error: 'Акаунт заблоковано адміністрацією' });
    if (name === 'share/card' || name === 'share/prepare') return await handleShare(req, res, name, uid);
    if (name === 'challenge/prepare') return await handleChallengeShare(req, res, uid);
    const body = await readBody(req);
    // «Показувати мене в каналі» (src/channel.js): opt-in, off by default.
    if (name === 'settings/channel') return send(res, 200, channel.setShow(uid, !!body.on));
    if (name === 'shop/invoice') {
      if (!bot) throw new GameError('Оплата зірками стане доступною після підключення бота');
      if (body.item) return send(res, 200, { link: await bot.itemInvoiceLink(uid, String(body.item), game.itemPrice(uid, String(body.item))) });
      if (!PACKS_ON_SALE) throw new GameError('Пакети гривень більше не продаються — загляни в «Стиль» і VIP');
      if (!PACKS.some((p) => p.id === body.pack)) throw new GameError('Невідомий пакет');
      return send(res, 200, { link: await bot.invoiceLink(uid, body.pack, game.packAmountFor(uid, body.pack)) });
    }
    // VIP subscription: cancel (cancel: true) or resume the renewal — Telegram first (editUserStarSubscription), then
    // the game. The subscription's id is its first charge; the latest renewal's charge is tried if Telegram refuses it.
    if (name === 'shop/sub') {
      if (!bot) throw new GameError('Оплата зірками стане доступною після підключення бота');
      const cancel = body.cancel !== false;
      const s = game.vipSub(uid);
      try {
        await bot.editStarSubscription(uid, s.chargeId, cancel);
      } catch (e) {
        if (!s.lastCharge || s.lastCharge === s.chargeId) throw new GameError('Telegram не змінив підписку — спробуй у Telegram: Налаштування → Мої зірки');
        await bot.editStarSubscription(uid, s.lastCharge, cancel).catch(() => {
          throw new GameError('Telegram не змінив підписку — спробуй у Telegram: Налаштування → Мої зірки');
        });
      }
      return send(res, 200, game.vipSubSet(uid, cancel));
    }
    if (name === 'ref') {
      const invited = db.q('SELECT COUNT(*) n, COALESCE(SUM(ref_paid), 0) paid FROM users WHERE referrer_id = ?').get(uid);
      return send(res, 200, { link: bot?.username ? `https://t.me/${bot.username}?start=ref_${uid}` : null, invited: invited.n, earned: invited.paid * REF_REWARD });
    }
    const fn = game.api[name];
    if (!fn) return send(res, 404, { error: 'Невідомий метод' });
    const out = fn(uid, body) ?? {};
    if (name === 'me') out.admin = canAdmin(req, uid);
    if (name === 'me' && channel.configured()) out.channelShow = channel.shows(uid);
    return send(res, 200, out);
  }

  async function serveStatic(req, res, pathname, v) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    if (!(await statics.serve(req, res, path.relative(PUBLIC, file).split(path.sep).join('/'), v))) send(res, 404, 'Not found', 'text/plain');
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

  // DEV only: start / stop / read the owner's test copy (tools/live-test.mjs: own bot, own DB, own tunnel).
  function devTestLive(res, action) {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const statusFile = path.join(root, 'data-test', 'status.json');
    const read = () => { try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { return null; } };
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const cur = read();
    if (action === 'start') {
      if (cur?.pid && alive(cur.pid) && cur.state !== 'stopped') return send(res, 200, { ok: true, already: true, ...cur });
      const child = spawn(process.execPath, [path.join(root, 'tools', 'live-test.mjs')], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      return send(res, 200, { ok: true, started: child.pid });
    }
    if (action === 'stop') {
      // Windows doesn't take children down with their parent: kill the whole tree, then anything still holding port 3300.
      if (process.platform === 'win32') {
        const ps = `${cur?.pid ? `taskkill /PID ${cur.pid} /T /F; ` : ''}Get-NetTCPConnection -LocalPort 3300 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like '*localhost:3300*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
        return execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 30e3 }, (err, out, errOut) => send(res, 200, { ok: true, stopped: cur?.pid || null, out: String(out), err: String(errOut || '') }));
      }
      if (cur?.pid && alive(cur.pid)) { try { process.kill(cur.pid); } catch {} }
      return send(res, 200, { ok: true, stopped: cur?.pid || null });
    }
    send(res, 200, { ok: true, ...(cur || { state: 'none' }), alive: !!(cur?.pid && alive(cur.pid)) });
  }

  const server = http.createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, 'http://x');
    try {
      if (pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
      // DEV only, from this computer: process new photos in raw-cars (`npm run cars`) or re-fit all photos to one canvas.
      // DEV only, from this computer: Railway CLI status / deploy (same as `railway up --detach` in the game folder).
      if ((pathname === '/api/dev/railway-status' || pathname === '/api/dev/deploy') && dev && isLocal(req) && req.method === 'POST') return devRailway(res, pathname.endsWith('deploy') ? ['up', '--detach'] : ['status']);
      if ((pathname === '/api/dev/cars' || pathname === '/api/dev/normalize') && dev && isLocal(req) && req.method === 'POST') return devCars(res, pathname.endsWith('normalize') ? 'normalize_cars.py' : 'prepare_cars.py');
      if (pathname.startsWith('/api/dev/test-live/') && dev && isLocal(req) && req.method === 'POST') return devTestLive(res, pathname.slice(19));
      if (pathname.startsWith('/api/admin/')) return await handleAdmin(req, res, pathname.slice(11));
      if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname.slice(5));
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
      const shareM = /^\/share\/([0-9a-f]{32})\.jpg$/.exec(pathname);
      if (shareM) {
        const c = shares.get(shareM[1]);
        if (!c) return send(res, 404, 'Not found', 'text/plain');
        res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': c.buf.length, 'cache-control': 'public, max-age=86400, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
        return res.end(req.method === 'HEAD' ? undefined : c.buf);
      }
      return await serveStatic(req, res, pathname, searchParams.get('v'));
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
    server, game, db, bot, sender, reminders, statics, shares, channel,
    async start(port) {
      if (bot) {
        try {
          log(`Bot @${await bot.start()} connected`);
          reminders.start();
        } catch (e) {
          log('Bot failed to start:', e.message);
        }
      }
      channel.start();
      await new Promise((r) => server.listen(port, r));
      return server.address().port;
    },
    close() {
      clearInterval(sweeper);
      channel.stop();
      reminders?.stop();
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
    channelId: process.env.TG_CHANNEL_ID || '', // @channel_name or -100…; the bot must be its admin (post messages)
  });
  const port = await app.start(Number(process.env.PORT) || 3100);
  // Hash and compress the static files right away so the first player after a deploy doesn't wait for brotli.
  app.statics.warm().catch((e) => console.error('static warm-up:', e));
  console.log(`АВТОДРОП: http://localhost:${port}${dev ? '  (DEV-режим: вхід без Telegram)' : ''}`);
  console.log(`Адмін-панель: http://localhost:${port}/admin.html`);
  if (process.env.ADMIN_KEY && process.env.ADMIN_KEY.length < 16) console.warn('Увага: ADMIN_KEY коротший за 16 символів — зроби його довгим і випадковим.');
  if (dev && token) console.warn('Увага: DEV=1 разом із BOT_TOKEN — будь-хто може увійти як будь-який гравець. Не вмикай це на сервері.');
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (app.close(), process.exit(0)));
}
