// Auto-posts of notable events to the game's Telegram channel (env TG_CHANNEL_ID; empty = the whole thing is off).
// Events: a «Міфічний» (S) drop from a case, a secret car, a «тиражна» car, a container jackpot on «Причал» (posted only
// after the winner opened it — no spoilers), the «Бос усіх босів» beaten, the weekly race results.
// It only reads the database (a scan once a minute from cursors kept in `meta`), so the game code has no hooks.
// Rate limit: at most cfg.maxPerHour posts in any hour; S drops gather into a digest (cfg.digest); when the hour's
// last slot is reached everything waiting goes out as one digest. A player's name is shown only when he turned on
// «Показувати мене в каналі» (channel_optin; default OFF — opt-in), otherwise «Хтось із гравців».
// Pictures: the player's own share card (src/share.js, uploaded when he shared that car — only for opted-in players),
// otherwise the car photo as a large link preview above the text.
import * as S from '../public/shared.js';

export const CHANNEL_DEFAULTS = Object.freeze({
  on: false, maxPerHour: 4, digest: true, digestMin: 60, jackpotX: 2.5,
  kinds: Object.freeze({ drop: true, secret: true, edition: true, jackpot: true, boss: true, weekly: true }),
});
export const CHANNEL_KINDS = { drop: 'Міфічні дропи (S)', secret: 'Секретні авто', edition: 'Тиражні авто', jackpot: 'Джекпоти контейнерів', boss: 'Бос усіх босів', weekly: 'Топ тижня' };
const LIMITS = { maxPerHour: [1, 20], digestMin: [15, 360], jackpotX: [1.5, 20] };
const PRIORITY = { weekly: 0, boss: 1, jackpot: 2, secret: 3, edition: 4, drop: 5, test: 6 };
export const STALE_MS = 12 * 3600e3; // an event that waited longer is dropped (old news)
const DIGEST_FLUSH = 8; // this many S drops go out as a digest without waiting for digestMin
const DIGEST_LINES = 10;
const MAX_PENDING = 200;
export const FINAL_BOSS = 'it-boss';
export const START_PARAM = 'tgchannel'; // signups from the channel's button (metrics: source «link»)

const clamp = (v, [lo, hi], d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
export function normalizeCfg(c = {}) {
  const k = c.kinds && typeof c.kinds === 'object' ? c.kinds : {};
  return {
    on: !!c.on,
    maxPerHour: Math.round(clamp(c.maxPerHour, LIMITS.maxPerHour, CHANNEL_DEFAULTS.maxPerHour)),
    digest: c.digest === undefined ? CHANNEL_DEFAULTS.digest : !!c.digest,
    digestMin: Math.round(clamp(c.digestMin, LIMITS.digestMin, CHANNEL_DEFAULTS.digestMin)),
    jackpotX: Math.round(clamp(c.jackpotX, LIMITS.jackpotX, CHANNEL_DEFAULTS.jackpotX) * 10) / 10,
    kinds: Object.fromEntries(Object.keys(CHANNEL_KINDS).map((x) => [x, k[x] === undefined ? CHANNEL_DEFAULTS.kinds[x] : !!k[x]])),
  };
}

// What to post now. pending: events { kind, at, … }; sent: times of the posts already made; lastDigest: when the last
// S-drop digest went out. Returns { posts: [{ type: 'single' | 'digest', events }], keep } — keep waits for later.
export function planPosts(pending, { now, sent = [], cfg, lastDigest = 0 }) {
  const fresh = pending.filter((e) => now - e.at < STALE_MS).sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.at - b.at);
  let budget = cfg.maxPerHour - sent.filter((t) => now - t < 3600e3).length;
  const queue = fresh.filter((e) => !(cfg.digest && e.kind === 'drop'));
  const drops = cfg.digest ? fresh.filter((e) => e.kind === 'drop') : [];
  const dropsDue = drops.length > 0 && (drops.length >= DIGEST_FLUSH || now - lastDigest >= cfg.digestMin * 60e3);
  const group = (events) => ({ type: events.length === 1 ? 'single' : 'digest', events });
  const posts = [];
  let dropsUsed = false;
  while (budget > 0 && queue.length) {
    const wanted = queue.length + (dropsDue ? 1 : 0);
    if (budget === 1 && wanted > 1) {
      // The hour's last slot: whatever waits goes out together.
      posts.push(group([...queue.splice(0), ...(dropsDue ? drops : [])]));
      dropsUsed = dropsDue;
      budget--;
      break;
    }
    posts.push(group([queue.shift()]));
    budget--;
  }
  if (!dropsUsed && dropsDue && budget > 0) {
    posts.push(group(drops));
    dropsUsed = true;
  }
  const keep = [...queue, ...(dropsUsed ? [] : drops)];
  return { posts, keep };
}

// ---------- texts (HTML parse mode) ----------
export const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const carName = (id) => escHtml(S.MODELS[id]?.name || id);
const who = (e) => (e.name ? `<b>${escHtml(e.name)}</b>` : 'Хтось із гравців');
const serialText = (n) => (n ? ` № ${String(n).padStart(3, '0')}` : '');
const ratio = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
const TAGS = { drop: '#міфічний', secret: '#секретне', edition: '#тиражне', jackpot: '#причал', boss: '#бос', weekly: '#тиждень' };
const MEDALS = ['🥇', '🥈', '🥉'];
const dm = (t) => new Date(t).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });

// One line per event, for digests.
export function eventLine(e) {
  if (e.kind === 'drop') return `🔴 ${who(e)} — ${carName(e.model)} з кейса «${escHtml(S.CASE_BY_ID[e.caseId]?.name || e.caseId)}»`;
  if (e.kind === 'secret') return `🗝 ${who(e)} — секретна ${carName(e.model)}`;
  if (e.kind === 'edition') return `🏷 ${who(e)} — тиражна ${carName(e.model)}${serialText(e.serial)}`;
  if (e.kind === 'jackpot') return `📦 ${who(e)} — ${carName(e.model)} з контейнера за ${S.short(e.price)} (×${ratio(e.value / e.price)})`;
  if (e.kind === 'boss') return `👑 ${who(e)} переміг Боса всіх босів`;
  if (e.kind === 'weekly') return `🏆 Гонка тижня: перше місце — ${e.top[0] ? who(e.top[0]) : '—'}`;
  return `✨ ${escHtml(e.text || '')}`;
}

export function eventText(e) {
  const m = S.MODELS[e.model];
  if (e.kind === 'drop') {
    return `🔥 <b>Міфічний дроп!</b>\n\n${who(e)} вибиває <b>${carName(e.model)}</b> з кейса «${escHtml(S.CASE_BY_ID[e.caseId]?.name || e.caseId)}».\n💰 Вартість авто: ${S.short(m?.price || 0)}\n\nКлас S — найрідкісніший у кейсах. Наступний може бути твоїм 👇\n\n${TAGS.drop}`;
  }
  if (e.kind === 'secret') {
    return `🗝 <b>Секретне авто!</b>\n\n${who(e)} відкриває секретну <b>${carName(e.model)}</b>. Секретні машини не випадають із кейсів — їх дають за зібрані колекції.\n\n${TAGS.secret}`;
  }
  if (e.kind === 'edition') {
    return `🏷 <b>Тиражна машина${serialText(e.serial)}</b>\n\n${who(e)} забирає <b>${carName(e.model)}</b> — заводська ліврея й власний номер у тиражі.\n\n${TAGS.edition}`;
  }
  if (e.kind === 'jackpot') {
    return `📦 <b>Джекпот на Причалі!</b>\n\n${who(e)} бере контейнер за ${S.short(e.price)}, а всередині — <b>${carName(e.model)}${e.ed ? ` (тиражна${serialText(e.serial)})` : ''}</b> вартістю ${S.short(e.value)}.\nЦе ×${ratio(e.value / e.price)} до ставки 🤯\n\n${TAGS.jackpot}`;
  }
  if (e.kind === 'boss') {
    const b = S.BOSS_BY_ID[FINAL_BOSS];
    return `👑 <b>Бос усіх босів переможений!</b>\n\n${who(e)} пройшов усю кар’єру — сім країн, ${S.BOSSES.length} суперників — і обійшов ${escHtml(b.nick)} на ${carName(b.model)}${e.best ? ` за ${String(e.best.toFixed(3)).replace('.', ',')} с` : ''}.\n\nПовага. Хто наступний? 🏁\n\n${TAGS.boss}`;
  }
  if (e.kind === 'weekly') {
    const lines = e.top.map((r, i) => `${MEDALS[i]} ${who(r)} — +${S.short(r.growth)} до гаража · приз ${S.short(S.WEEKLY_PRIZES[i])}`);
    const end = new Date(e.week + 'T12:00:00Z').getTime() + 6 * 86400e3;
    return `🏆 <b>Гонка тижня ${dm(new Date(e.week + 'T12:00:00Z'))}–${dm(end)}: підсумки</b>\n\n${lines.join('\n')}\n\nПризи вже в гаражах. Новий тиждень іде — топ-10 отримують гривні 💰\n\n${TAGS.weekly}`;
  }
  return `✨ ${escHtml(e.text || 'Тестовий пост АВТОДРОП')}`;
}

export function digestText(events) {
  const lines = events.slice(0, DIGEST_LINES).map(eventLine);
  const more = events.length - lines.length;
  return `⚡ <b>Гаряче в АВТОДРОПі</b>\n\n${lines.join('\n')}${more > 0 ? `\n…і ще ${more}` : ''}\n\nВідкривай кейси — наступним можеш бути ти 👇`;
}

// ---------- the poster ----------
// api(method, params) → Promise (the bot's Bot API call; rejects with e.code / e.retryAfter). imageUrl(model) → a public
// https URL of the car photo or ''. cardUrl(id) → the share card's public URL while it lives, or ''. playUrl → the button.
export function createChannel({ db, channelId = '', api = null, imageUrl = () => '', cardUrl = () => '', playUrl = () => '', now = () => Date.now(), log = console.error }) {
  const q = db.q;
  db.exec(`CREATE TABLE IF NOT EXISTS channel_optin (user_id INTEGER PRIMARY KEY, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS channel_posts (kind TEXT NOT NULL, ref TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, ref)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS channel_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1,
      ok INTEGER NOT NULL, test INTEGER NOT NULL DEFAULT 0, text TEXT, error TEXT);`);
  const metaGet = (k) => {
    try {
      return JSON.parse(q('SELECT value FROM meta WHERE key = ?').get(k)?.value ?? 'null');
    } catch {
      return null;
    }
  };
  const metaSet = (k, v) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));
  const chId = () => (typeof channelId === 'function' ? channelId() : channelId) || '';
  const configured = () => !!(chId() && api);
  const cfg = () => normalizeCfg(metaGet('channel_cfg') || {});
  const maxId = (t) => q(`SELECT COALESCE(MAX(id), 0) m FROM ${t}`).get().m;
  let pending = [];
  const cards = new Map(); // `${uid}:${model}` → share card id (the player shared that car)

  // ---------- privacy ----------
  const shows = (uid) => !!q('SELECT 1 FROM channel_optin WHERE user_id = ?').get(uid);
  function setShow(uid, on) {
    if (on) q('INSERT OR IGNORE INTO channel_optin (user_id, at) VALUES (?, ?)').run(uid, now());
    else q('DELETE FROM channel_optin WHERE user_id = ?').run(uid);
    return { channelShow: !!on };
  }
  // The name for the channel, or null (not opted in → anonymous). Banned players' events are skipped altogether.
  function shownName(uid) {
    const u = q('SELECT u.username, u.first_name, u.banned, o.user_id opt FROM users u LEFT JOIN channel_optin o ON o.user_id = u.id WHERE u.id = ?').get(uid);
    if (!u || u.banned) return undefined;
    if (!u.opt) return null;
    return u.username ? '@' + u.username : u.first_name || null;
  }
  const once = (kind, ref) => q('INSERT OR IGNORE INTO channel_posts (kind, ref, at) VALUES (?, ?, ?)').run(kind, String(ref), now()).changes > 0;

  // ---------- finding events ----------
  function scan() {
    const c = cfg();
    const cur = metaGet('channel_cur') || {};
    const since = cur.since || now();
    const found = [];
    const add = (e) => {
      if (!c.kinds[e.kind]) return;
      const name = shownName(e.uid);
      if (name === undefined) return; // banned or gone
      found.push({ ...e, name });
    };
    const topDrop = maxId('drops');
    if (cur.drop != null && topDrop > cur.drop) {
      for (const r of q("SELECT id, user_id, case_id, item, created_at FROM drops WHERE id > ? AND id <= ? AND cls = 'S' AND forced <> 3 ORDER BY id").all(cur.drop, topDrop)) {
        if (S.MODELS[r.item] && S.CASE_BY_ID[r.case_id]) add({ kind: 'drop', uid: r.user_id, model: r.item, caseId: r.case_id, at: r.created_at, ref: r.id });
      }
    }
    const topCar = maxId('cars');
    if (cur.car != null && topCar > cur.car) {
      for (const r of q('SELECT id, owner_id, model, serial, origin, created_at FROM cars WHERE id > ? AND id <= ? ORDER BY id').all(cur.car, topCar)) {
        const m = S.MODELS[r.model];
        if (!m || r.origin === 'container') continue; // containers: posted when opened (below)
        if (m.secret) add({ kind: 'secret', uid: r.owner_id, model: r.model, at: r.created_at, ref: r.id });
        else if (m.edition) add({ kind: 'edition', uid: r.owner_id, model: r.model, serial: r.serial, at: r.created_at, ref: r.id });
      }
    }
    for (const L of q("SELECT id, top_bidder, top_bid, model, ed, serial, settled_at FROM container_lots WHERE status = 'done' AND opened = 1 AND top_bidder > 0 AND settled_at > ?").all(since)) {
      const m = S.MODELS[L.model];
      if (!m || !L.top_bid) continue;
      const kind = m.price / L.top_bid >= c.jackpotX ? 'jackpot' : L.ed ? 'edition' : null;
      if (kind && c.kinds[kind] && once('lot', L.id)) add({ kind, uid: L.top_bidder, model: L.model, price: L.top_bid, value: m.price, ed: !!L.ed, serial: L.serial, at: now(), ref: L.id });
    }
    for (const r of q('SELECT user_id, best, beaten_at FROM boss_runs WHERE boss = ? AND beaten_at > ?').all(FINAL_BOSS, since)) {
      if (c.kinds.boss && once('boss', r.user_id)) add({ kind: 'boss', uid: r.user_id, best: r.best, at: r.beaten_at, ref: r.user_id });
    }
    for (const w of q('SELECT week_id, settled_at FROM weeks WHERE settled_at > ?').all(since)) {
      if (!c.kinds.weekly || !once('weekly', w.week_id)) continue;
      const rows = q(`SELECT id, CASE WHEN week_id = ? THEN total_value - week_start_value WHEN last_week_id = ? THEN last_week_growth END g
                      FROM users WHERE (week_id = ? OR last_week_id = ?) AND banned = 0 AND lb_hidden = 0 ORDER BY g DESC, id LIMIT 3`).all(w.week_id, w.week_id, w.week_id, w.week_id).filter((r) => r.g > 0);
      if (rows.length) found.push({ kind: 'weekly', week: w.week_id, at: w.settled_at, ref: w.week_id, top: rows.map((r) => ({ uid: r.id, name: shownName(r.id) || null, growth: r.g })) });
    }
    metaSet('channel_cur', { since, drop: topDrop, car: topCar });
    pending.push(...found);
    if (pending.length > MAX_PENDING) pending = pending.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.at - a.at).slice(0, MAX_PENDING);
    return found.length;
  }

  // ---------- sending ----------
  function button() {
    const url = playUrl();
    return url ? { inline_keyboard: [[{ text: '🏎 Грати в АВТОДРОП', url }]] } : undefined;
  }
  function pictureOf(e) {
    if (!e.model) return { photo: '', preview: '' };
    const id = e.name && e.uid ? cards.get(`${e.uid}:${e.model}`) : null;
    const card = id ? cardUrl(id) : '';
    const m = S.MODELS[e.model];
    return { photo: card, preview: card ? '' : imageUrl(m?.img || m?.base || e.model) };
  }
  async function post(p, { test = false } = {}) {
    const e = p.events[0];
    const text = p.type === 'digest' ? digestText(p.events) : eventText(e);
    const pic = p.type === 'single' ? pictureOf(e) : { photo: '', preview: '' };
    const reply_markup = button();
    const params = pic.photo
      ? { chat_id: chId(), photo: pic.photo, caption: text.slice(0, 1024), parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) }
      : { chat_id: chId(), text, parse_mode: 'HTML', link_preview_options: pic.preview ? { url: pic.preview, prefer_large_media: true, show_above_text: true } : { is_disabled: true }, ...(reply_markup ? { reply_markup } : {}) };
    const kind = p.type === 'digest' ? 'digest' : e.kind;
    try {
      await api(pic.photo ? 'sendPhoto' : 'sendMessage', params);
      q('INSERT INTO channel_log (at, kind, n, ok, test, text) VALUES (?, ?, ?, 1, ?, ?)').run(now(), kind, p.events.length, test ? 1 : 0, text.slice(0, 1500));
      return { ok: true };
    } catch (err) {
      q('INSERT INTO channel_log (at, kind, n, ok, test, text, error) VALUES (?, ?, ?, 0, ?, ?, ?)').run(now(), kind, p.events.length, test ? 1 : 0, text.slice(0, 1500), String(err.message).slice(0, 300));
      log('channel post:', err.message);
      return { ok: false, error: err.message, retryAfter: err.retryAfter };
    }
  }

  let busy = false, pauseUntil = 0;
  async function tick() {
    if (!configured() || busy || now() < pauseUntil) return;
    const c = cfg();
    if (!c.on) return void (pending = []);
    busy = true;
    try {
      scan();
      const sent = q('SELECT at FROM channel_log WHERE ok = 1 AND test = 0 AND at > ?').all(now() - 3600e3).map((r) => r.at);
      const lastDigest = metaGet('channel_digest_at') || 0;
      const { posts, keep } = planPosts(pending, { now: now(), sent, cfg: c, lastDigest });
      pending = keep;
      for (const p of posts) {
        const r = await post(p);
        if (p.events.some((e) => e.kind === 'drop')) metaSet('channel_digest_at', now());
        if (r.retryAfter) {
          // Telegram asked to slow down: this post and the rest wait.
          pending.push(...p.events, ...posts.slice(posts.indexOf(p) + 1).flatMap((x) => x.events));
          pauseUntil = now() + r.retryAfter * 1000;
          break;
        }
      }
    } catch (e) {
      log('channel tick:', e.message);
    } finally {
      busy = false;
    }
  }
  let timer = null;

  // ---------- admin ----------
  function status() {
    const c = cfg();
    return {
      configured: configured(), hasChannel: !!chId(), hasBot: !!api, cfg: c, defaults: normalizeCfg({}), kinds: CHANNEL_KINDS,
      pending: pending.length, optins: q('SELECT COUNT(*) n FROM channel_optin').get().n,
      lastHour: q('SELECT COUNT(*) n FROM channel_log WHERE ok = 1 AND test = 0 AND at > ?').get(now() - 3600e3).n,
      log: q('SELECT at, kind, n, ok, test, text, error FROM channel_log ORDER BY id DESC LIMIT 20').all(),
    };
  }
  function alog(who, action, details) {
    q('INSERT INTO admin_log (admin, action, target, details, created_at) VALUES (?, ?, NULL, ?, ?)').run(String(who), action, JSON.stringify(details), now());
  }
  async function admin(name, body = {}, { who = '?', role = null } = {}) {
    if (name === 'channel') return status();
    if (name !== 'channel/set' && name !== 'channel/test') return undefined;
    if (role !== 'owner' && role !== 'admin') return { error: 'Немає прав на цю дію', code: 403 };
    const reason = String(body.reason ?? '').trim().slice(0, 300);
    if (body.confirm !== true) return { error: 'Дію не підтверджено', code: 400 };
    if (reason.length < 3 && role !== 'owner') return { error: 'Вкажи причину (від 3 символів) — вона піде в журнал дій', code: 400 };
    if (name === 'channel/set') {
      const old = cfg();
      const next = normalizeCfg({ ...old, ...body, kinds: { ...old.kinds, ...(body.kinds || {}) } });
      metaSet('channel_cfg', next);
      // Switched on: start from now — nothing from before goes out.
      if (next.on && !old.on) metaSet('channel_cur', { since: now(), drop: maxId('drops'), car: maxId('cars') });
      if (!next.on) pending = [];
      alog(who, 'channel-set', { from: old, to: next, reason });
      return status();
    }
    if (name === 'channel/test') {
      if (!configured()) return { error: chId() ? 'Бот не підключено (BOT_TOKEN)' : 'Не задано TG_CHANNEL_ID', code: 400 };
      const ev = { kind: 'test', at: now(), text: String(body.text || '').trim().slice(0, 500) || 'Тестовий пост: автопости АВТОДРОПу підключено ✅' };
      const r = await post({ type: 'single', events: [ev] }, { test: true });
      alog(who, 'channel-test', { ok: r.ok, error: r.error || null, reason });
      if (!r.ok) return { error: `Telegram: ${r.error}`, code: 400 };
      return status();
    }
    return undefined;
  }

  return {
    configured, shows, setShow, scan, tick, admin, status, planPosts,
    get pending() {
      return pending;
    },
    // The player shared a drop card of this car (server.js share/prepare): reuse it for his post.
    noteCard(uid, model, id) {
      if (cards.size > 5000) cards.clear();
      cards.set(`${uid}:${model}`, id);
    },
    start(ms = 60e3) {
      if (!configured() || timer) return;
      timer = setInterval(() => tick(), ms);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
