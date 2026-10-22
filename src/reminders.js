// Bot reminders: a rate-limited send queue (every bot message goes through it) and a scheduler that, every few minutes,
// tells idle players what is waiting for them in the game (full tank, garage income at its cap, daily bonus, reward case,
// season ending). Telegram itself is injected (`send`), so tests run with a fake send and a fake clock.
import { dayOf } from './game.js';

export const PUSH = {
  maxPerDay: 2, // proactive reminders per player per Kyiv day (instant events — trades, PvP, auctions — don't count)
  quietFrom: 22, quietTo: 9, // Europe/Kyiv hours with no reminders
  idleMin: 30, // the player was in the game less than this long ago → no reminder
  inactiveDays: 14, // not seen for longer → we stop writing
  minGapH: 3, // the second reminder of the day comes at least this long after the first
  seasonWarnH: 24,
  rate: 25, // messages per second, all chats together (Telegram allows ≈30)
  everyMin: 5,
};
// The order of lines in a bundled message. 'event': a game event began (S.EVENTS) — same limits as the rest
// (2 a day, quiet hours, idle players only); each event is told once and only in its first hours (game.js EVENT_PUSH_H).
// 'dayrace': «Заїзд дня» from 19:00 Kyiv for players who haven't raced it today (src/dayrace.js remind), same limits.
export const KINDS = ['event', 'dayrace', 'daily', 'income', 'rcase', 'fuel', 'season'];

const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' });
export const kyivHour = (t) => Number(HOUR.format(new Date(t)));
export function isQuiet(t, rules = PUSH) {
  const h = kyivHour(t);
  return rules.quietFrom > rules.quietTo ? h >= rules.quietFrom || h < rules.quietTo : h >= rules.quietFrom && h < rules.quietTo;
}

// Which of the player's ready reminders go out now (in KINDS order), or null. `c` comes from game.pushCandidates().
export function pickReminder(c, t, rules = PUSH) {
  if (c.pushOff || c.blocked || !c.lastSeen) return null;
  if (isQuiet(t, rules)) return null;
  if (t - c.lastSeen < rules.idleMin * 60e3) return null;
  if (t - c.lastSeen > rules.inactiveDays * 86400e3) return null;
  const day = dayOf(t);
  if ((c.pushDay === day ? c.pushCount : 0) >= rules.maxPerDay) return null;
  if (c.pushLast && t - c.pushLast < rules.minGapH * 3600e3) return null;
  const kinds = c.ready
    .filter((r) => {
      const last = c.sent[r.kind];
      // One of a kind per day, and the same "ready" moment (this full tank, this reward case) is told only once.
      return !last || (dayOf(last) !== day && r.at > last);
    })
    .map((r) => r.kind)
    .sort((a, b) => KINDS.indexOf(a) - KINDS.indexOf(b));
  return kinds.length ? kinds : null;
}

export function reminderText(items) {
  return items.map((r) => r.text).join('\n') + '\n\nВимкнути нагадування: /stop';
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// A send queue with a global rate limit. Urgent messages (instant events) go before reminders.
// send(chatId, text, extra) → Promise; a rejection with e.code 403 marks the player blocked, 429 waits retry_after.
export function createSender({ send, now = Date.now, sleep = realSleep, rate = PUSH.rate, onBlocked = () => {}, isBlocked = () => false, log = console.error, maxQueue = 20000 }) {
  const urgent = [], normal = [];
  const stamps = []; // send times in the last second
  const inflight = new Set();
  const stats = { sent: 0, blocked: 0, failed: 0, retried: 0, dropped: 0 };
  let pausedUntil = 0;
  let running = null;

  function enqueue(chatId, text, { urgent: isUrgent = false, extra } = {}) {
    if (urgent.length + normal.length >= maxQueue) {
      stats.dropped++;
      return false;
    }
    (isUrgent ? urgent : normal).push({ chatId, text, extra, tries: 0, urgent: isUrgent });
    kick();
    return true;
  }
  function kick() {
    if (running) return;
    // Started on the next microtask, so messages queued in one go are taken by priority.
    running = Promise.resolve().then(pump).catch((e) => log('send queue:', e.message)).finally(() => {
      running = null;
      if (urgent.length + normal.length) kick();
    });
  }
  function deliver(m) {
    // The request starts right now (at its stamp time); a synchronous throw counts as a failed send.
    let started;
    try {
      started = Promise.resolve(send(m.chatId, m.text, m.extra));
    } catch (e) {
      started = Promise.reject(e);
    }
    const p = started
      .then(() => {
        stats.sent++;
      }, (e) => {
        if (e?.code === 403) {
          stats.blocked++;
          try {
            onBlocked(m.chatId);
          } catch (err) {
            log('mark blocked:', err.message);
          }
        } else if (e?.code === 429 && m.tries < 3) {
          stats.retried++;
          m.tries++;
          pausedUntil = Math.max(pausedUntil, now() + (Number(e.retryAfter) || 1) * 1000);
          (m.urgent ? urgent : normal).unshift(m);
          kick();
        } else {
          stats.failed++;
          log('bot send:', e?.message || e);
        }
      })
      .finally(() => inflight.delete(p));
    inflight.add(p);
  }
  async function pump() {
    while (urgent.length || normal.length) {
      let t = now();
      if (t < pausedUntil) {
        await sleep(pausedUntil - t);
        continue;
      }
      while (stamps.length && stamps[0] <= t - 1000) stamps.shift();
      if (stamps.length >= rate) {
        await sleep(stamps[0] + 1000 - t);
        continue;
      }
      const m = urgent.shift() || normal.shift();
      let skip = false;
      try {
        skip = isBlocked(m.chatId);
      } catch {}
      if (skip) continue;
      stamps.push(t);
      deliver(m);
    }
  }
  async function idle() {
    while (running || inflight.size) {
      await running;
      await Promise.all([...inflight]);
    }
  }
  return { enqueue, idle, size: () => urgent.length + normal.length, stats };
}

// The scheduler. game: pushCandidates(), pushMark(uid, kinds, t). markup: reply_markup with the Mini App button.
export function createReminders({ game, sender, now = Date.now, rules = PUSH, markup, log = console.error }) {
  let timer = null;
  function tick() {
    const t = now();
    if (isQuiet(t, rules)) return { quiet: true, sent: 0 };
    // Telegram is slow or down: don't pile up more; the players not marked are picked up by a later tick.
    if (sender.size() > 5000) return { busy: true, sent: 0 };
    let sent = 0;
    for (const c of game.pushCandidates(rules)) {
      const kinds = pickReminder(c, t, rules);
      if (!kinds) continue;
      const items = kinds.map((k) => c.ready.find((r) => r.kind === k));
      game.pushMark(c.uid, kinds, t);
      const rm = typeof markup === 'function' ? markup() : markup;
      sender.enqueue(c.uid, reminderText(items), { extra: rm ? { reply_markup: rm } : undefined });
      sent++;
    }
    return { sent };
  }
  return {
    tick,
    start(everyMs = rules.everyMin * 60e3) {
      if (timer) return;
      timer = setInterval(() => {
        try {
          tick();
        } catch (e) {
          log('reminders:', e.message);
        }
      }, everyMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
