// Telegram polish (2026-10-28-telegram): reminder groups, the notify API for clubs/tournaments, hourly getMe,
// the command menu, /garage and /settings, richer inline answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createSender, createReminders, pickReminder, mutedKinds, groupOf, KINDS, PUSH_GROUPS } from '../src/reminders.js';
import { createBot, COMMANDS, ME_EVERY, garageText, settingsText } from '../src/bot.js';
import * as S from '../public/shared.js';

const H = 3600e3;
const T0 = Date.parse('2026-10-14T10:00:00Z'); // 13:00 Kyiv

function setup() {
  const db = openDb(':memory:');
  const clock = { t: T0 };
  const now = () => clock.t;
  const sent = [];
  let sender;
  const g = createGame(db, { now, notify: (uid, text) => sender.enqueue(uid, text, { urgent: true }), allUnlocked: true });
  sender = createSender({ send: async (chatId, text) => sent.push({ chatId, text }), now, sleep: async (ms) => (clock.t += Math.max(1, ms)), onBlocked: g.push.block, isBlocked: g.push.isBlocked, log: () => {} });
  const rem = createReminders({ game: g, sender, now, log: () => {} });
  const mk = (id) => (g.ensureUser({ id, username: 'u' + id, first_name: 'U' + id }), id);
  const tick = async () => {
    const r = rem.tick();
    await sender.idle();
    return r;
  };
  return { db, g, clock, sent, sender, mk, tick };
}

test('reminder groups: every kind has a group, muted groups drop their kinds', () => {
  for (const k of KINDS) assert.ok(groupOf(k), `${k} has a group`);
  assert.ok(KINDS.includes('club') && KINDS.includes('tourney'));
  assert.deepEqual([...mutedKinds('bonus,nope')].sort(), ['daily', 'goals', 'rcase', 'tggroup']);
  const c = { lastSeen: T0 - 2 * H, pushDay: null, pushCount: 0, pushLast: 0, sent: {}, ready: [{ kind: 'daily', at: T0, text: 'a' }, { kind: 'fuel', at: T0, text: 'b' }] };
  assert.deepEqual(pickReminder(c, T0), ['daily', 'fuel']);
  assert.deepEqual(pickReminder({ ...c, mute: 'bonus' }, T0), ['fuel']);
  assert.equal(pickReminder({ ...c, mute: 'bonus,garage' }, T0), null);
  assert.equal(pickReminder({ ...c, ready: [{ kind: 'weird', at: T0, text: 'x' }] }, T0), null, 'unknown kinds never go out');
});

test('settings/push-group switches a group; the scheduler respects it; me carries the groups', async () => {
  const { g, mk, clock, tick, sent } = setup();
  mk(1);
  const me = g.api.me(1);
  assert.deepEqual(me.pushMute, []);
  assert.deepEqual(me.pushGroups.map((x) => x.id), PUSH_GROUPS.map((x) => x.id));
  assert.deepEqual(g.api['settings/push-group'](1, { group: 'bonus', on: false }), { pushMute: ['bonus'] });
  assert.throws(() => g.api['settings/push-group'](1, { group: 'x', on: false }), /Невідомий/);
  assert.deepEqual(g.api['settings/push-group'](1, { group: 'garage', on: false }), { pushMute: ['bonus', 'garage'] });
  clock.t += 2 * H;
  await tick();
  assert.equal(sent.length, 0, 'bonus, reward case and full tank are ready, both groups are off');
  g.api['settings/push-group'](1, { group: 'bonus', on: true });
  assert.deepEqual(g.api.me(1).pushMute, ['garage']);
  clock.t += 3 * H;
  await tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^🎁 Щоденний бонус чекає — день 1\n📦 Кейс нагород готовий\n\n/);
  assert.doesNotMatch(sent[0].text, /Бак/);
  assert.match(sent[0].text, /\/stop/);
});

test('notify API: push.source adds club/tourney reminders under the usual limits; push.send respects switches', async () => {
  const { g, mk, clock, tick, sent, sender } = setup();
  mk(1);
  mk(2);
  for (const id of [1, 2]) for (const grp of ['bonus', 'garage']) g.api['settings/push-group'](id, { group: grp, on: false });
  g.push.source((t) => [{ uid: 1, kind: 'club', at: t, text: '🏆 Твій клуб на 2-му місці ліги' }, { uid: 2, kind: 'tourney', at: t, text: '🏁 Турнір стартує за годину' }, { uid: 3, kind: 'club', text: 'nobody' }]);
  g.push.source(() => {
    throw new Error('broken feature');
  });
  g.api['settings/push-group'](2, { group: 'social', on: false });
  clock.t += 2 * H;
  await tick();
  assert.deepEqual(sent.map((m) => m.chatId), [1]);
  assert.match(sent[0].text, /^🏆 Твій клуб/);
  // Instant: player 2 switched «Клуб і турніри» off.
  assert.equal(g.push.send(1, 'club', '🎉 Клуб виграв тиждень'), true);
  assert.equal(g.push.send(2, 'tourney', 'x'), false);
  g.push.set(1, false); // /stop
  assert.equal(g.push.send(1, 'club', 'y'), false);
  await sender.idle();
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /Клуб виграв тиждень/);
});

test('push.summary and push.inline: garage, live challenges, the best drop', () => {
  const { g, mk, db, clock } = setup();
  mk(1);
  const best = S.ALL_MODELS.filter((m) => !m.secret).sort((a, b) => b.price - a.price)[0];
  g.giveCar(1, best.id);
  const s = g.push.summary(1);
  assert.equal(s.best.id, best.id);
  assert.ok(s.cars >= 1);
  assert.match(garageText(s), new RegExp(`найкраще — ${best.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(garageText(null), /порожній/);
  for (const [i, id] of ['aaaaaaaaa1', 'aaaaaaaaa2', 'aaaaaaaaa3', 'aaaaaaaaa4', 'aaaaaaaaa5'].entries()) {
    db.prepare('INSERT INTO challenges (id, creator_id, race_id, car, run, time, day, created_at, expires_at) VALUES (?, 1, ?, ?, ?, 12.3, ?, ?, ?)')
      .run(id, i + 1, JSON.stringify({ model: best.id }), '{}', '2026-10-14', clock.t + i, i === 4 ? clock.t - 1 : clock.t + 86400e3);
  }
  const inl = g.push.inline(1);
  assert.deepEqual(inl.challenges, ['aaaaaaaaa4', 'aaaaaaaaa3', 'aaaaaaaaa2'], 'newest live 3');
  assert.equal(inl.drop.id, best.id);
  assert.equal(inl.dayrace, null);
  assert.match(settingsText({ off: true }), /вимкнено/);
  assert.match(settingsText({ mute: ['bonus'], groups: PUSH_GROUPS }), /▫️ Бонуси[\s\S]*✅ Гараж/);
});

test('bot: getMe re-read hourly (inline switched on in BotFather), Ukrainian command menu, /garage and /settings', async () => {
  const realFetch = globalThis.fetch, realSI = globalThis.setInterval;
  const calls = [], updates = [];
  let inlineFlag = false;
  const timers = [];
  globalThis.setInterval = (fn, ms) => {
    timers.push({ fn, ms });
    return { unref() {} };
  };
  globalThis.fetch = async (u, opts = {}) => {
    const method = String(u).split('/').pop(), params = JSON.parse(opts.body || '{}');
    calls.push({ method, params });
    let result = true;
    if (method === 'getMe') result = { id: 1, username: 'avtodrop_bot', supports_inline_queries: inlineFlag };
    else if (method === 'getMyDescription') result = { description: '' };
    else if (method === 'getMyShortDescription') result = { short_description: '' };
    else if (method === 'getUpdates') result = await new Promise((r) => setTimeout(() => r(updates.splice(0)), 10));
    return { json: async () => ({ ok: true, result }) };
  };
  const db = openDb(':memory:');
  const game = createGame(db, { allUnlocked: true });
  game.ensureUser({ id: 7, first_name: 'Оля' });
  const bot = createBot({ token: 'T', webappUrl: 'https://game.example/', admins: [5], game, log: () => {} });
  try {
    await bot.start();
    assert.equal(bot.inline, false);
    const me = timers.find((t) => t.ms === ME_EVERY);
    assert.ok(me, 'hourly getMe timer');
    inlineFlag = true;
    await me.fn();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(bot.inline, true, 'inline mode picked up without a restart');
    const cmds = calls.filter((c) => c.method === 'setMyCommands');
    assert.deepEqual(cmds[0].params.commands, COMMANDS);
    assert.deepEqual(COMMANDS.map((c) => c.command), ['start', 'garage', 'settings', 'help', 'paysupport', 'stop']);
    assert.ok(cmds.some((c) => c.params.scope?.chat_id === 5 && c.params.commands.some((x) => x.command === 'admin')), 'admin commands in admin chats');
    assert.equal(calls.find((c) => c.method === 'setChatMenuButton').params.menu_button.type, 'web_app');
    updates.push({ update_id: 1, message: { message_id: 1, from: { id: 7, first_name: 'Оля' }, chat: { id: 7, type: 'private' }, text: '/garage' } });
    updates.push({ update_id: 2, message: { message_id: 2, from: { id: 7, first_name: 'Оля' }, chat: { id: 7, type: 'private' }, text: '/settings' } });
    updates.push({ update_id: 3, message: { message_id: 3, from: { id: 7, first_name: 'Оля' }, chat: { id: 7, type: 'private' }, text: '/help' } });
    for (let i = 0; i < 100 && calls.filter((c) => c.method === 'sendMessage').length < 3; i++) await new Promise((r) => setTimeout(r, 10));
    const msgs = calls.filter((c) => c.method === 'sendMessage').map((c) => c.params);
    assert.match(msgs[0].text, /Твій гараж · рівень 1/);
    assert.equal(msgs[0].reply_markup.inline_keyboard[0][0].text, '🚗 Відкрити гараж');
    assert.match(msgs[1].text, /✅ Бонуси/);
    assert.match(msgs[2].text, /@avtodrop_bot/);
    // In a group the bot stays quiet; only the owner's /welcome in a topic posts, pins and removes the command.
    const G = { id: -1009, type: 'supergroup', is_forum: true };
    updates.push({ update_id: 4, message: { message_id: 40, from: { id: 7, first_name: 'Оля' }, chat: G, text: '/start' } });
    updates.push({ update_id: 5, message: { message_id: 41, from: { id: 7, first_name: 'Оля' }, chat: G, text: '/welcome', is_topic_message: true, message_thread_id: 3 } });
    updates.push({ update_id: 6, message: { message_id: 42, from: { id: 5, first_name: 'Власник' }, chat: G, text: '/welcome@avtodrop_bot', is_topic_message: true, message_thread_id: 3 } });
    for (let i = 0; i < 100 && !calls.some((c) => c.method === 'deleteMessage'); i++) await new Promise((r) => setTimeout(r, 10));
    const inGroup = calls.filter((c) => c.method === 'sendMessage' && c.params.chat_id === -1009);
    assert.equal(inGroup.length, 1);
    assert.equal(inGroup[0].params.message_thread_id, 3);
    assert.match(inGroup[0].params.text, /Ласкаво просимо в АВТОДРОП/);
    assert.ok(calls.some((c) => c.method === 'pinChatMessage'));
    assert.equal(calls.find((c) => c.method === 'deleteMessage').params.message_id, 42);
  } finally {
    bot.stop();
    await new Promise((r) => setTimeout(r, 30));
    globalThis.fetch = realFetch;
    globalThis.setInterval = realSI;
  }
});

test('server inline: empty query → invite + recent challenges + day race + drop; «дроп» → the drop card first', async () => {
  const { createApp } = await import('../server.js');
  const realFetch = globalThis.fetch;
  const calls = [], updates = [];
  globalThis.fetch = async (u, opts = {}) => {
    if (!String(u).startsWith('https://api.telegram.org/')) return realFetch(u, opts);
    const method = String(u).split('/').pop(), params = JSON.parse(opts.body || '{}');
    calls.push({ method, params });
    let result = true;
    if (method === 'getMe') result = { id: 1, username: 'avtodrop_bot', supports_inline_queries: true };
    else if (method === 'getMyDescription') result = { description: '' };
    else if (method === 'getMyShortDescription') result = { short_description: '' };
    else if (method === 'getUpdates') result = await new Promise((r) => setTimeout(() => r(updates.splice(0)), 15));
    return { json: async () => ({ ok: true, result }) };
  };
  const app = createApp({ dbFile: ':memory:', dev: true, token: 'T', webappUrl: 'https://game.example/', log: () => {} });
  await app.start(0);
  const ask = async (id, query) => {
    updates.push({ update_id: calls.length + 10, inline_query: { id, from: { id: 1 }, query, offset: '' } });
    for (let i = 0; i < 200; i++) {
      const a = calls.find((c) => c.method === 'answerInlineQuery' && c.params.inline_query_id === id);
      if (a) return a.params.results;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timeout');
  };
  try {
    app.game.ensureUser({ id: 1, first_name: 'Тарас' });
    const best = S.ALL_MODELS.filter((m) => !m.secret).sort((a, b) => b.price - a.price)[0];
    app.game.giveCar(1, best.id);
    const snap = { model: best.id };
    for (const [i, id] of ['bbbbbbbbb1', 'bbbbbbbbb2'].entries()) {
      app.db.prepare('INSERT INTO challenges (id, creator_id, race_id, car, run, time, day, created_at, expires_at) VALUES (?, 1, ?, ?, ?, 11.5, ?, ?, ?)')
        .run(id, i + 1, JSON.stringify(snap), '{}', '2026-10-28', Date.now() + i, Date.now() + 86400e3);
    }
    const r = await ask('q1', '');
    assert.equal(r[0].id, 'invite');
    assert.deepEqual(r.slice(1, 3).map((x) => x.id), ['ch_bbbbbbbbb2', 'ch_bbbbbbbbb1']);
    assert.equal(r.at(-1).id.startsWith('drop_'), true);
    assert.match(r.at(-1).input_message_content.message_text, /start=ref_1/);
    assert.ok(r.every((x) => x.id.length <= 64));
    assert.equal(new Set(r.map((x) => x.id)).size, r.length);
    const d = await ask('q2', 'дроп');
    assert.match(d[0].title, /^Мій дроп: /);
    assert.match(d[0].input_message_content.message_text, /Я вибив/);
    const c = await ask('q3', 'ch_bbbbbbbbb1');
    assert.equal(c.length, 1);
    assert.equal(c[0].id, 'ch_bbbbbbbbb1');
  } finally {
    app.close();
    await new Promise((r) => setTimeout(r, 60));
    globalThis.fetch = realFetch;
  }
});
