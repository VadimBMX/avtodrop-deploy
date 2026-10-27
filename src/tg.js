// Telegram polish on the game side: per-group reminder switches (users.push_mute), a small notify API for features
// that come later (clubs, tournaments: game.push.source / game.push.send), and data for the bot — /garage summary
// and the cards of the inline mode (recent challenges, the day-race result, the rarest drop).
import * as S from '../public/shared.js';
import { PUSH_GROUPS, groupOf, mutedKinds } from './reminders.js';

export function createTg(ctx) {
  const { q, now, dayOf, fail, handlers, push, incomeState, garageCount, notify, log = () => {} } = ctx;
  const GROUP_IDS = PUSH_GROUPS.map((g) => g.id);
  const muteOf = (uid) => String(q('SELECT push_mute FROM users WHERE id = ?').get(uid)?.push_mute || '').split(',').filter((g) => GROUP_IDS.includes(g));

  // POST settings/push-group { group, on }: one group of reminders on or off.
  function setGroup(uid, { group, on }) {
    const g = String(group || '');
    if (!GROUP_IDS.includes(g)) fail('Невідомий тип нагадувань');
    const set = new Set(muteOf(uid));
    if (on) set.delete(g);
    else set.add(g);
    q('UPDATE users SET push_mute = ? WHERE id = ?').run(GROUP_IDS.filter((x) => set.has(x)).join(','), uid);
    return { pushMute: muteOf(uid) };
  }

  // Reminder sources of other features: fn(t, rules) → [{ uid, kind, at, text }]. `kind` must be one of KINDS
  // ('club', 'tourney' are reserved); the usual limits apply (2 a day, quiet hours, idle players, the player's switches).
  const sources = [];
  function source(fn) {
    if (typeof fn === 'function') sources.push(fn);
  }
  // An instant message for a feature event (your club won the week, the tournament starts): urgent, goes at once,
  // doesn't count towards the 2 a day — unless the player switched its group (or all reminders, /stop) off.
  function send(uid, kind, text) {
    const g = groupOf(kind);
    const u = q('SELECT push_off, push_blocked, push_mute FROM users WHERE id = ?').get(uid);
    if (!u || u.push_blocked || (g && (u.push_off || mutedKinds(u.push_mute).has(kind)))) return false;
    try {
      notify(uid, String(text));
    } catch {}
    return true;
  }

  // The candidates of the base scheduler + items from the sources, each with the player's switched-off groups.
  function wrapCandidates(base) {
    return (rules) => {
      const list = base(rules);
      const t = now();
      const byId = new Map(list.map((c) => [c.uid, c]));
      for (const fn of sources) {
        let items = [];
        try {
          items = fn(t, rules) || [];
        } catch (e) {
          log('push source:', e.message);
        }
        for (const it of items) {
          if (!it || !it.uid || !it.kind || !it.text) continue;
          let c = byId.get(it.uid);
          if (!c) {
            const u = q(`SELECT * FROM users WHERE id = ? AND push_off = 0 AND push_blocked = 0 AND banned = 0 AND last_seen BETWEEN ? AND ?`)
              .get(it.uid, t - rules.inactiveDays * 86400e3, t - rules.idleMin * 60e3);
            if (!u) continue;
            let sent = {};
            try {
              sent = JSON.parse(u.push_sent || '{}') || {};
            } catch {}
            c = { uid: u.id, lastSeen: u.last_seen, pushOff: false, blocked: false, pushDay: u.push_day, pushCount: u.push_count, pushLast: u.push_last, sent, ready: [] };
            list.push(c);
            byId.set(c.uid, c);
          }
          c.ready.push({ kind: it.kind, at: it.at ?? t, text: String(it.text) });
        }
      }
      // Few players switch groups off: one query for all of them.
      const muted = new Map(q("SELECT id, push_mute FROM users WHERE push_mute <> ''").all().map((r) => [r.id, r.push_mute]));
      for (const c of list) if (muted.has(c.uid)) c.mute = muted.get(c.uid);
      return list;
    };
  }

  // The bot's /garage: a short summary with the play button.
  function summary(uid) {
    const u = q('SELECT * FROM users WHERE id = ?').get(uid);
    if (!u) return null;
    const inc = incomeState(u);
    const cap = inc.rate * inc.capH;
    const best = bestCar(uid);
    return { balance: u.balance, cars: garageCount(uid), level: u.level, rate: inc.rate, pending: Math.floor(inc.pending), full: inc.rate > 0 && inc.pending >= Math.floor(cap) - 1, best };
  }
  // The most valuable car the player holds (not the secret ones' prices — they count the same way).
  function bestCar(uid) {
    let best = null;
    for (const r of q("SELECT model FROM cars WHERE owner_id = ?").all(uid)) {
      const m = S.MODELS[r.model];
      if (m && (!best || m.price > best.price)) best = { id: r.model, name: m.name, cls: m.cls, price: m.price };
    }
    return best;
  }
  // Inline mode: up to 3 of the player's live challenges (newest first), the latest day-race result, the best drop.
  function inline(uid) {
    const t = now();
    const challenges = q('SELECT id FROM challenges WHERE creator_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 3').all(uid, t).map((r) => r.id);
    let dayrace = null;
    const cap = handlers['dayrace/caption'];
    if (cap) {
      for (const day of [dayOf(t), dayOf(t - 86400e3)]) {
        try {
          dayrace = { day, ...cap(uid, { day }) };
          break;
        } catch {}
      }
    }
    return { challenges, dayrace, drop: bestCar(uid) };
  }

  // The settings sheet needs the switched-off groups.
  const meBase = handlers.me;
  const groupsOut = PUSH_GROUPS.map(({ id, title, hint }) => ({ id, title, hint }));
  handlers.me = (uid, b) => ({ ...meBase(uid, b), pushMute: muteOf(uid), pushGroups: groupsOut });
  handlers['settings/push-group'] = setGroup;
  push.candidates = wrapCandidates(push.candidates);
  Object.assign(push, { source, send, summary, inline, muteOf, groups: PUSH_GROUPS });
  return { setGroup, source, send, summary, inline };
}
