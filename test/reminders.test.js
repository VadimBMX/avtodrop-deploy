import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame, dayOf } from '../src/game.js';
import { createSender, createReminders, pickReminder, isQuiet, PUSH } from '../src/reminders.js';
import * as S from '../public/shared.js';

const H = 3600e3, MIN = 60e3;
// 2026-10-14 is summer time in Kyiv (UTC+3): 10:00Z = 13:00 Kyiv.
const T0 = Date.parse('2026-10-14T10:00:00Z');

function setup({ t0 = T0, failWith = null } = {}) {
  const db = openDb(':memory:');
  const clock = { t: t0 };
  const now = () => clock.t;
  const sent = [];
  let fail = failWith;
  const send = async (chatId, text, extra) => {
    if (fail) {
      const f = typeof fail === 'function' ? fail(chatId) : fail;
      if (f) throw Object.assign(new Error('fail'), f);
    }
    sent.push({ at: clock.t, chatId, text, extra });
  };
  let sender;
  const g = createGame(db, { now, notify: (uid, text) => sender.enqueue(uid, text, { urgent: true }), allUnlocked: true });
  sender = createSender({ send, now, sleep: async (ms) => (clock.t += Math.max(1, ms)), onBlocked: g.push.block, isBlocked: g.push.isBlocked, log: () => {} });
  const markup = { inline_keyboard: [[{ text: '🎁 Відкрити гру', web_app: { url: 'https://x.test/' } }]] };
  const rem = createReminders({ game: g, sender, now, markup, log: () => {} });
  const mk = (id) => (g.ensureUser({ id, username: 'u' + id, first_name: 'U' + id }), id);
  const tick = async () => {
    const r = rem.tick();
    await sender.idle();
    return r;
  };
  return { db, g, clock, sent, sender, rem, mk, tick, setFail: (f) => (fail = f), user: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) };
}

test('quiet hours are 22:00–09:00 Kyiv', () => {
  assert.equal(isQuiet(Date.parse('2026-10-14T18:59:00Z')), false); // 21:59
  assert.equal(isQuiet(Date.parse('2026-10-14T19:00:00Z')), true); // 22:00
  assert.equal(isQuiet(Date.parse('2026-10-15T05:59:00Z')), true); // 08:59
  assert.equal(isQuiet(Date.parse('2026-10-15T06:00:00Z')), false); // 09:00
  assert.equal(isQuiet(Date.parse('2026-12-15T07:30:00Z')), false); // 09:30 in winter (UTC+2)
  assert.equal(isQuiet(Date.parse('2026-12-15T06:30:00Z')), true); // 08:30 in winter
});

test('pickReminder: idle, inactive, day limit, gap, one per kind, same readiness once', () => {
  const t = T0;
  const base = { lastSeen: t - 2 * H, pushDay: null, pushCount: 0, pushLast: 0, sent: {}, ready: [{ kind: 'fuel', at: t - H }, { kind: 'daily', at: t }] };
  assert.deepEqual(pickReminder(base, t), ['daily', 'fuel']);
  assert.equal(pickReminder({ ...base, lastSeen: t - 29 * MIN }, t), null, 'active in the last 30 min');
  assert.equal(pickReminder({ ...base, lastSeen: t - 15 * 86400e3 }, t), null, 'inactive >14 days');
  assert.equal(pickReminder({ ...base, pushDay: dayOf(t), pushCount: 2, pushLast: t - 5 * H }, t), null, 'max 2 per day');
  assert.deepEqual(pickReminder({ ...base, pushDay: '2026-10-13', pushCount: 2, pushLast: t - 20 * H }, t), ['daily', 'fuel'], 'counter resets next day');
  assert.equal(pickReminder({ ...base, pushDay: dayOf(t), pushCount: 1, pushLast: t - H }, t), null, 'gap after the first reminder');
  assert.deepEqual(pickReminder({ ...base, pushDay: dayOf(t), pushCount: 1, pushLast: t - 4 * H, sent: { daily: t - 4 * H } }, t), ['fuel'], 'daily already sent today');
  // Fuel told yesterday; the tank emptied and filled again since → a new reminder. The same full tank → not again.
  assert.deepEqual(pickReminder({ ...base, sent: { fuel: t - 20 * H } }, t), ['daily', 'fuel']);
  assert.equal(pickReminder({ ...base, ready: [{ kind: 'fuel', at: t - 30 * H }], sent: { fuel: t - 20 * H } }, t), null);
  assert.equal(pickReminder({ ...base, pushOff: true }, t), null);
  assert.equal(pickReminder({ ...base, blocked: true }, t), null);
  assert.equal(pickReminder(base, Date.parse('2026-10-14T20:00:00Z')), null, 'quiet hours');
});

test('idle player gets one bundled message with the Mini App button', async () => {
  const { mk, clock, tick, sent, user } = setup();
  mk(1);
  clock.t += 2 * H;
  const r = await tick();
  assert.equal(r.sent, 1);
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.chatId, 1);
  // A fresh player: daily bonus unclaimed, reward case ready, full tank — all in one message, in this order.
  assert.match(m.text, /^🎁 Щоденний бонус чекає — день 1\n📦 Кейс нагород готовий\n⛽ Бак повний/);
  assert.match(m.text, /\/stop/);
  assert.ok(m.extra.reply_markup.inline_keyboard[0][0].web_app.url);
  const u = user(1);
  assert.equal(u.push_count, 1);
  assert.deepEqual(Object.keys(JSON.parse(u.push_sent)).sort(), ['daily', 'fuel', 'rcase']);
  // Nothing new is ready: later ticks the same day send nothing.
  for (let i = 0; i < 10; i++) {
    clock.t += 30 * MIN;
    await tick();
  }
  assert.equal(sent.length, 1);
});

test('no reminder to an active player, during quiet hours, or after 14 days away', async () => {
  const { mk, clock, tick, sent, g, db } = setup();
  mk(1);
  clock.t += 2 * H;
  g.api.me(1); // opened the game just now
  clock.t += 10 * MIN;
  await tick();
  assert.equal(sent.length, 0);
  // 21:30 Kyiv: allowed; but set the clock to 23:00 Kyiv first.
  clock.t = Date.parse('2026-10-14T20:00:00Z');
  await tick();
  assert.equal(sent.length, 0, 'quiet hours');
  clock.t = Date.parse('2026-10-15T06:05:00Z'); // 09:05 Kyiv
  await tick();
  assert.equal(sent.length, 1, 'sent once the quiet hours end');
  db.prepare('UPDATE users SET last_seen = ?, push_day = NULL, push_count = 0, push_last = 0, push_sent = ? WHERE id = 1').run(clock.t - 15 * 86400e3, '{}');
  clock.t += 4 * H;
  await tick();
  assert.equal(sent.length, 1, 'inactive >14 days');
});

test('at most 2 reminders a day, never the same kind twice', async () => {
  const { mk, clock, tick, sent, db, g, user } = setup();
  mk(1);
  g.api['rewards/daily'](1);
  db.prepare('UPDATE users SET reward_case_at = ?, fuel = 0, fuel_at = ? WHERE id = 1').run(clock.t, clock.t);
  clock.t += 2 * H;
  await tick();
  assert.equal(sent.length, 0, 'nothing ready yet');
  clock.t += 2 * H + MIN; // reward case ready (4 h)
  await tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^📦 Кейс нагород готовий/);
  clock.t = Date.parse('2026-10-14T18:30:00Z'); // 21:30 Kyiv, tank full (15 × 20 min = 5 h)
  await tick();
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /^⛽ Бак повний/);
  // A third kind becomes ready (a new reward case) — the daily limit holds.
  db.prepare('UPDATE users SET reward_case_at = ? WHERE id = 1').run(clock.t - 5 * H);
  clock.t += 20 * MIN;
  await tick();
  assert.equal(sent.length, 2);
  assert.equal(user(1).push_count, 2);
  // Next morning: daily bonus + the new reward case (tank already told about).
  clock.t = Date.parse('2026-10-15T07:00:00Z');
  await tick();
  assert.equal(sent.length, 3);
  // (Thursday 15.10 is a «Подвійне паливо» day in the event calendar: its line comes first in the same message.)
  assert.match(sent[2].text, /^(🎉 Почалася подія «Подвійне паливо»[^\n]*\n)?🎁 Щоденний бонус чекає — день 2\n📦 Кейс нагород готовий\n\n/);
});

test('garage income at its cap and season ending are reminded', async () => {
  const { mk, clock, tick, sent, db, g } = setup();
  mk(1);
  g.api['rewards/daily'](1);
  g.giveCar(1, S.ALL_MODELS.find((m) => m.cls === 'B').id);
  const season = S.seasonOf(clock.t);
  db.prepare('UPDATE users SET reward_case_at = ?, season_id = ?, season_xp = 50, income_at = ?, banked = 0 WHERE id = 1').run(clock.t, season, clock.t);
  // Jump to 10 h before the season ends (clamped to daytime Kyiv is not needed for the check below).
  clock.t = S.seasonEndOf(season) - 10 * H;
  db.prepare('UPDATE users SET last_seen = ?, income_at = ?, fuel = 0, fuel_at = ?, reward_case_at = ?, streak_day = ? WHERE id = 1').run(clock.t - 6 * H, clock.t - 6 * H, clock.t, clock.t, dayOf(clock.t));
  if (isQuiet(clock.t)) return; // season boundary at night in Kyiv: nothing to check here
  await tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /💰 Гараж заповнений: .+ чекає/);
  assert.match(sent[0].text, /🏁 Сезон закінчується за 10 год/);
});

test('403 from Telegram marks the player and stops everything to them; /start-like unblock resumes', async () => {
  const { mk, clock, tick, sent, setFail, user, g, sender } = setup();
  mk(1);
  mk(2);
  setFail((id) => (id === 1 ? { code: 403 } : null));
  clock.t += 2 * H;
  await tick();
  assert.equal(user(1).push_blocked, 1);
  assert.equal(user(2).push_blocked, 0);
  assert.deepEqual(sent.map((m) => m.chatId), [2]);
  assert.equal(sender.stats.blocked, 1);
  setFail(null);
  // Instant events to a blocked player are skipped too; next day nothing is scheduled for them.
  sender.enqueue(1, 'event', { urgent: true });
  clock.t += 24 * H;
  await tick();
  assert.ok(!sent.some((m) => m.chatId === 1));
  // The player wrote to the bot again.
  g.push.unblock(1);
  clock.t += 3 * H;
  await tick();
  assert.ok(sent.some((m) => m.chatId === 1));
});

test('toggle in settings and /stop switch reminders off; events still come', async () => {
  const { mk, clock, tick, sent, g, sender } = setup();
  mk(1);
  assert.equal(g.api.me(1).pushOn, true, 'on by default');
  assert.deepEqual(g.api['settings/push'](1, { on: false }), { pushOn: false });
  assert.equal(g.api.me(1).pushOn, false);
  clock.t += 2 * H;
  await tick();
  assert.equal(sent.length, 0);
  sender.enqueue(1, '🔔 Тобі запропонували обмін', { urgent: true });
  await sender.idle();
  assert.equal(sent.length, 1, 'instant events are not reminders');
  g.api['settings/push'](1, { on: true });
  clock.t += 2 * H;
  await tick();
  assert.equal(sent.length, 2);
  assert.ok(g.push.set(1, false), '/stop');
  assert.equal(g.push.isOff(1), true);
  assert.equal(g.push.set(999, false), false, 'unknown player');
});

test('send queue: ≤25 per second, urgent first, 429 waits retry_after', async () => {
  const { sender, sent, clock, setFail } = setup();
  for (let i = 0; i < 60; i++) sender.enqueue(1000 + i, 'r' + i);
  sender.enqueue(1, 'urgent', { urgent: true });
  await sender.idle();
  assert.equal(sent.length, 61);
  assert.equal(sent[0].text, 'urgent', 'urgent goes ahead of reminders queued before it');
  for (let i = 0; i < sent.length; i++) {
    const inWindow = sent.filter((m) => m.at >= sent[i].at && m.at < sent[i].at + 1000).length;
    assert.ok(inWindow <= PUSH.rate, `window at ${i}: ${inWindow}`);
  }
  // 429 once: the message is retried after retry_after seconds.
  let once = true;
  setFail(() => (once ? ((once = false), { code: 429, retryAfter: 3 }) : null));
  const t = clock.t;
  sender.enqueue(5, 'again');
  await sender.idle();
  const m = sent.at(-1);
  assert.equal(m.text, 'again');
  assert.ok(m.at - t >= 3000);
});

test('game events go through the queue', async () => {
  const { g, sent, sender, mk } = setup();
  mk(1);
  mk(2);
  g.giveCar(1, S.ALL_MODELS.find((m) => m.cls === 'D').id);
  const carId = g.api.me(1).cars[0].id;
  g.api['trade/create'](1, { to: 2, give: [carId], getMoney: 1000 });
  await sender.idle();
  assert.ok(g.api.events(2).list.some((e) => /пропонує тобі обмін/.test(e.text)), 'stored in the game');
  assert.ok(sent.some((m) => m.chatId === 2 && /пропонує тобі обмін/.test(m.text)), 'sent through the queue');
});
