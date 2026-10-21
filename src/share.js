// Drop cards for sharing: the app draws a JPEG on a canvas and uploads it here; Telegram needs a public URL for
// stories (WebApp.shareToStory) and for a photo message (savePreparedInlineMessage → WebApp.shareMessage).
// Kept in memory only (Telegram fetches the picture within seconds of the share), with hard limits: JPEG only,
// SHARE.maxBytes per card, a few cards per player per minute, SHARE.maxTotal bytes / SHARE.maxCount cards in all,
// each card lives SHARE.ttlMs. Ids are random (128 bit), so cards can't be listed or guessed.
import crypto from 'node:crypto';

export const SHARE = { maxBytes: 600 * 1024, maxTotal: 48 * 1024 * 1024, maxCount: 400, ttlMs: 24 * 3600e3, perMinute: 6, maxW: 1440, maxH: 2560 };

// Width × height from a baseline/progressive JPEG's SOF marker, or null when it isn't a well-formed JPEG.
export function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const mk = buf[i + 1];
    if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

export function createShareStore({ now = () => Date.now(), limits = SHARE } = {}) {
  const cards = new Map(); // id → { buf, uid, at }
  const recent = new Map(); // uid → [times of the last uploads]
  let total = 0;
  const drop = (id) => {
    const c = cards.get(id);
    if (!c) return;
    total -= c.buf.length;
    cards.delete(id);
  };
  function sweep() {
    const t = now();
    for (const [id, c] of cards) if (t - c.at > limits.ttlMs) drop(id); // Map keeps insertion order: oldest first
    while (cards.size && (total > limits.maxTotal || cards.size > limits.maxCount)) drop(cards.keys().next().value);
  }
  return {
    // Returns { id } or { error, code }.
    put(uid, buf) {
      if (!Buffer.isBuffer(buf) || !buf.length) return { error: 'Порожня картинка', code: 400 };
      if (buf.length > limits.maxBytes) return { error: 'Картинка завелика', code: 413 };
      const size = jpegSize(buf);
      if (!size || !size.w || !size.h || size.w > limits.maxW || size.h > limits.maxH) return { error: 'Потрібна картинка JPEG', code: 415 };
      const t = now();
      const list = (recent.get(uid) || []).filter((x) => t - x < 60e3);
      if (list.length >= limits.perMinute) return { error: 'Забагато поширень, зачекай хвилинку', code: 429 };
      list.push(t);
      if (recent.size > 10000) recent.clear();
      recent.set(uid, list);
      const id = crypto.randomBytes(16).toString('hex');
      cards.set(id, { buf, uid, at: t });
      total += buf.length;
      sweep();
      return { id };
    },
    get(id) {
      if (!/^[0-9a-f]{32}$/.test(String(id))) return null;
      const c = cards.get(id);
      if (!c) return null;
      if (now() - c.at > limits.ttlMs) return drop(id), null;
      return c;
    },
    size: () => ({ count: cards.size, bytes: total }),
  };
}
