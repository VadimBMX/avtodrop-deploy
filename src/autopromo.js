// «Автопромо» (owner 29.10: «можеш сам періодично кидати проміки в чат?»): the server posts a fresh promo code into
// the players' chat a few times a day, at random moments inside the day window (Kyiv), each with a few activations
// and a short life. The owner picks the topic once with /promohere written in it (src/bot.js); the admin panel
// («Промокоди») switches it on/off, sets how often, the amount range and the activations, posts one now and shows the
// last posts. State: meta 'autopromo' (settings + target), 'autopromo_next' (when the next one goes), table
// autopromo_log. Codes are ordinary rows of `promos` (the same «Меню → Промокод» redeem, one per player).
import * as S from '../public/shared.js';

export const AUTOPROMO_DEFAULTS = Object.freeze({ on: true, perDay: 3, min: 300000, max: 700000, usesMin: 5, usesMax: 8, ttlMin: 120, from: 0, to: 24 });
const LIM = { perDay: [1, 24], min: [10000, 5e7], max: [10000, 5e7], usesMin: [1, 100], usesMax: [1, 100], ttlMin: [15, 1440], from: [0, 23], to: [1, 24] };
const WORDS = ['NITRO', 'TURBO', 'DRIFT', 'GARAGE', 'BOOST', 'RACE', 'DROP', 'KEYS', 'FAST', 'V8', 'GHOST', 'NIGHT'];
const LINES = [
  (c, a, u) => `⚡️ Швидкий промік!\n<code>${c}</code> — +${a}\nЛише ${u} активацій — хто перший, той забрав 🏁`,
  (c, a, u) => `🎁 Промокод для своїх\n<code>${c}</code> — +${a}\n${u} активацій, поспішай 🔥`,
  (c, a, u) => `🏎 Хто тут не спить?\n<code>${c}</code> — +${a}\nТільки ${u} разів ⏳`,
  (c, a, u) => `💸 Ловіть гроші на кейси\n<code>${c}</code> — +${a}\n${u} активацій, далі — все 🙌`,
];
export const windowLen = (c) => ((c.to - c.from + 24) % 24) || 24;
export const inWindow = (c, h) => (h - c.from + 24) % 24 < windowLen(c);
const clamp = (v, [lo, hi], d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

export function normalizeAutoPromo(c = {}) {
  const d = AUTOPROMO_DEFAULTS, o = { on: c.on === undefined ? d.on : !!c.on };
  for (const k of Object.keys(LIM)) o[k] = clamp(c[k], LIM[k], d[k]);
  if (o.max < o.min) o.max = o.min;
  if (o.usesMax < o.usesMin) o.usesMax = o.usesMin;
  // to ≤ from is a window across midnight (18 → 6); the same hour on both ends (or 0 → 24) is round the clock
  if (o.to % 24 === o.from) { o.from = 0; o.to = 24; }
  return o;
}

export function createAutoPromo({ db, now = () => Date.now(), api = null, random = Math.random, log = console.error }) {
  const q = db.q;
  db.exec(`CREATE TABLE IF NOT EXISTS autopromo_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, code TEXT NOT NULL,
    amount INTEGER NOT NULL, uses INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT, by TEXT)`);
  const metaGet = (k) => {
    try {
      return JSON.parse(q('SELECT value FROM meta WHERE key = ?').get(k)?.value ?? 'null');
    } catch {
      return null;
    }
  };
  const metaSet = (k, v) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));
  const state = () => metaGet('autopromo') || {};
  const cfg = () => normalizeAutoPromo(state());
  const target = () => (state().target?.chat ? state().target : null);
  const kyivHour = (t) => Number(S.kyivLocal(t).slice(11, 13)) + Number(S.kyivLocal(t).slice(14, 16)) / 60;
  // The next moment: the day window split into perDay slots, a random point in the slot after `from` (±40 % jitter).
  // The window may run across midnight (owner 29.10: «в ніч також грають»): its length is counted modulo 24 h.
  function planNext(t = now()) {
    const c = cfg(), len = windowLen(c), gap = (len * 3600e3) / c.perDay;
    let next = t + gap * (0.6 + 0.8 * random());
    // Out of the window → a random point in the first slot of the next window.
    for (let k = 0; k < 3; k++) {
      const h = kyivHour(next);
      if (inWindow(c, h)) break;
      next += ((c.from - h + 24) % 24) * 3600e3 + gap * random() * 0.9;
    }
    metaSet('autopromo_next', next);
    return next;
  }
  const nextAt = () => metaGet('autopromo_next') || planNext();
  function makeCode() {
    for (let i = 0; i < 20; i++) {
      const c = WORDS[Math.floor(random() * WORDS.length)] + (100 + Math.floor(random() * 900));
      if (!q('SELECT 1 FROM promos WHERE code = ?').get(c)) return c;
    }
    return 'AD' + Date.now().toString(36).toUpperCase();
  }
  const roundTo = (n, s) => Math.round(n / s) * s;
  async function postOne(by = 'auto') {
    const c = cfg(), tg = target();
    if (!api) throw new Error('Бот не підключено');
    if (!tg) throw new Error('Не вибрано, куди кидати: напиши /promohere у темі чату');
    const amount = roundTo(c.min + (c.max - c.min) * random(), c.max >= 200000 ? 50000 : 10000) || c.min;
    const uses = c.usesMin + Math.floor(random() * (c.usesMax - c.usesMin + 1));
    const code = makeCode();
    q('INSERT OR REPLACE INTO promos (code, amount, uses_left, expires_at) VALUES (?, ?, ?, ?)').run(code, amount, uses, now() + c.ttlMin * 60e3);
    const text = LINES[Math.floor(random() * LINES.length)](code, S.fmt(amount), uses) + '\nВводити: Меню → Промокод';
    try {
      await api('sendMessage', { chat_id: tg.chat, ...(tg.thread > 0 ? { message_thread_id: tg.thread } : {}), text, parse_mode: 'HTML' });
      q('INSERT INTO autopromo_log (at, code, amount, uses, ok, by) VALUES (?, ?, ?, ?, 1, ?)').run(now(), code, amount, uses, by);
      return { code, amount, uses };
    } catch (e) {
      q('DELETE FROM promos WHERE code = ?').run(code); // nobody saw it — no stray code
      q('INSERT INTO autopromo_log (at, code, amount, uses, ok, error, by) VALUES (?, ?, ?, ?, 0, ?, ?)').run(now(), code, amount, uses, String(e.message).slice(0, 300), by);
      throw e;
    }
  }
  let busy = false, timer = null;
  async function tick() {
    if (busy || !api || !target() || !cfg().on) return;
    if (now() < nextAt()) return;
    busy = true;
    try {
      await postOne();
    } catch (e) {
      log('autopromo:', e.message);
    } finally {
      planNext();
      busy = false;
    }
  }
  function setTarget({ chat, thread = 0, title = '', by = null } = {}) {
    if (!/^-?\d{5,20}$/.test(String(chat ?? ''))) return null;
    const t = { chat: Number(chat), thread: Math.max(0, Math.floor(Number(thread)) || 0), title: String(title).slice(0, 128), at: now(), by };
    metaSet('autopromo', { ...state(), target: t });
    planNext();
    return t;
  }
  function status() {
    return { cfg: cfg(), defaults: AUTOPROMO_DEFAULTS, target: target(), nextAt: target() && cfg().on ? nextAt() : null, hasBot: !!api,
      log: q('SELECT at, code, amount, uses, ok, error, by FROM autopromo_log ORDER BY id DESC LIMIT 15').all()
        .map((r) => ({ ...r, left: q('SELECT uses_left FROM promos WHERE code = ?').get(r.code)?.uses_left ?? 0 })) };
  }
  async function admin(name, body = {}, { who = '?', role = null } = {}) {
    if (name === 'autopromo') return status();
    if (role !== 'owner' && role !== 'admin') return { error: 'Немає прав на цю дію', code: 403 };
    if (name === 'autopromo/set') {
      const next = normalizeAutoPromo({ ...cfg(), ...body });
      metaSet('autopromo', { ...state(), ...next });
      planNext();
      return status();
    }
    if (name === 'autopromo/now') {
      try {
        await postOne(String(who));
      } catch (e) {
        return { error: e.message, code: 400 };
      }
      return status();
    }
    return undefined;
  }
  return {
    tick, postOne, setTarget, status, admin, planNext,
    start(ms = 60e3) {
      if (timer || !api) return;
      timer = setInterval(() => tick(), ms);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
