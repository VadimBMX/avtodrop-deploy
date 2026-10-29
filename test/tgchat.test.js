// Auto-posts into a forum topic (2026-10-31-tgchat): the owner's /here in a group topic stores the target, channel.js
// posts there with message_thread_id (and falls back to the channel after «Скинути»); «Мітки посилань» in the metrics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createChannel } from '../src/channel.js';
import { createBot, HERE_TEXT } from '../src/bot.js';
import * as M from '../src/metrics.js';
import { tagLink, tagsPanel } from '../public/admin-metrics.js';
import { targetPanel } from '../public/admin-channel.js';

const T0 = Date.parse('2026-10-28T12:00:00Z');
const wait = async (cond, n = 200) => {
  for (let i = 0; i < n && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(cond(), 'timed out');
};

function channelSetup(channelId = '@avtodrop_news') {
  const db = openDb(':memory:');
  let t = T0;
  createGame(db, { now: () => t, notify: () => {} });
  const posts = [];
  const api = async (method, params) => (posts.push({ method, ...params }), { message_id: posts.length });
  const ch = createChannel({ db, channelId, api, now: () => t, log: () => {} });
  const as = (role) => (name, body = {}) => ch.admin(name, { confirm: true, reason: 'тест', ...body }, { who: 'x', role });
  return { db, ch, posts, owner: as('owner'), helper: as('helper') };
}

test('channel target: /here topic wins over the channel, posts carry message_thread_id, «Скинути» falls back', async () => {
  const { db, ch, posts, owner, helper } = channelSetup();
  // No target: the channel, no thread.
  await owner('channel/test', { text: 'a' });
  assert.equal(posts[0].chat_id, '@avtodrop_news');
  assert.equal(posts[0].message_thread_id, undefined);
  assert.equal(ch.status().target, null);
  assert.equal(ch.status().channel, '@avtodrop_news');
  // Bad chat ids are refused.
  assert.equal(ch.setTarget({ chat: '@nope', thread: 3 }), null);
  assert.equal(ch.setTarget({}), null);
  // A topic.
  const t = ch.setTarget({ chat: -1001234567890, thread: 7, title: 'АВТОДРОП чат', topic: '📣 Новини та оновлення', forum: true, by: 5 });
  assert.equal(t.thread, 7);
  const st = ch.status();
  assert.deepEqual({ chat: st.target.chat, thread: st.target.thread, topic: st.target.topic }, { chat: -1001234567890, thread: 7, topic: '📣 Новини та оновлення' });
  assert.ok(st.configured);
  await owner('channel/test', { text: 'b' });
  assert.equal(posts[1].chat_id, -1001234567890);
  assert.equal(posts[1].message_thread_id, 7);
  assert.ok(db.prepare("SELECT 1 FROM admin_log WHERE action = 'channel-target'").get(), 'logged');
  // The general topic (thread 0): no thread id.
  ch.setTarget({ chat: -1001234567890, thread: 0, title: 'АВТОДРОП чат', forum: true, by: 5 });
  await owner('channel/test', { text: 'c' });
  assert.equal(posts[2].chat_id, -1001234567890);
  assert.equal('message_thread_id' in posts[2], false);
  // Reset: helpers can't, the owner can; then back to the channel.
  assert.equal((await helper('channel/target-clear')).code, 403);
  assert.equal((await ch.admin('channel/target-clear', {}, { who: 'x', role: 'owner' })).code, 400, 'needs confirm');
  assert.equal((await owner('channel/target-clear')).target, null);
  await owner('channel/test', { text: 'd' });
  assert.equal(posts[3].chat_id, '@avtodrop_news');
  assert.equal(posts[3].message_thread_id, undefined);
});

test('channel target: works with no channel at all; auto-posts go to the topic with the usual limits', async () => {
  const { db, ch, posts, owner } = channelSetup('');
  assert.equal(ch.configured(), false);
  assert.match((await owner('channel/test')).error, /\/here/);
  ch.setTarget({ chat: -1009999999, thread: 12, title: 'Чат', topic: 'Новини', forum: true, by: 5 });
  assert.equal(ch.configured(), true);
  await owner('channel/set', { on: true, maxPerHour: 1 });
  db.prepare("INSERT INTO meta (key, value) VALUES ('channel_cur', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ since: T0 - 1, drop: 0, car: 0 }));
  ch.pending.push({ kind: 'test', at: T0, text: 'x' }, { kind: 'test', at: T0, text: 'y' });
  await ch.tick();
  assert.equal(posts.length, 1, 'one post an hour → the two go out as one digest');
  assert.equal(posts[0].chat_id, -1009999999);
  assert.equal(posts[0].message_thread_id, 12);
  assert.match(posts[0].text, /Гаряче в АВТОДРОПі/);
});

test('admin «Канал»: the target block shows the topic, the reset button, the /here hint', () => {
  const esc = (s) => String(s).replace(/</g, '&lt;');
  const date = () => '28.10';
  const withTopic = targetPanel({ target: { chat: -100123, thread: 7, title: 'АВТОДРОП', topic: 'Новини' }, channel: '@news' }, { esc, date });
  assert.match(withTopic, /Тема групи:.*«АВТОДРОП» → «Новини»/s);
  assert.match(withTopic, /data-act="chTargetClear"/);
  assert.match(withTopic, /у канал @news/);
  const general = targetPanel({ target: { chat: -100123, thread: 0, title: 'АВТОДРОП' }, channel: '' }, { esc, date });
  assert.match(general, /загальна тема/);
  const none = targetPanel({ target: null, channel: '@news' }, { esc, date });
  assert.match(none, /Канал:<\/b> @news/);
  assert.doesNotMatch(none, /chTargetClear/);
  assert.match(none, /\/here/);
});

test('bot /here: owner only, groups only; stores chat + topic, «✅» in the topic, both messages deleted later', async () => {
  const realFetch = globalThis.fetch, realSI = globalThis.setInterval;
  globalThis.setInterval = () => ({ unref() {} });
  const calls = [], updates = [];
  let mid = 100;
  globalThis.fetch = async (u, opts = {}) => {
    const method = String(u).split('/').pop(), params = JSON.parse(opts.body || '{}');
    calls.push({ method, params, at: Date.now() });
    let result = true;
    if (method === 'getMe') result = { id: 1, username: 'avtodrop_bot' };
    else if (method === 'getMyDescription') result = { description: '' };
    else if (method === 'getMyShortDescription') result = { short_description: '' };
    else if (method === 'sendMessage') result = { message_id: ++mid };
    else if (method === 'getUpdates') result = await new Promise((r) => setTimeout(() => r(updates.splice(0)), 10));
    return { json: async () => ({ ok: true, result }) };
  };
  const db = openDb(':memory:');
  const game = createGame(db, { allUnlocked: true });
  const got = [];
  const bot = createBot({ token: 'T', webappUrl: 'https://game.example/', admins: [5], game, here: (t) => (got.push(t), t), hereCleanMs: 40, log: () => {} });
  const G = { id: -1001234567890, type: 'supergroup', is_forum: true, title: 'АВТОДРОП чат' };
  try {
    await bot.start();
    const topic = { message_thread_id: 7, is_topic_message: true, reply_to_message: { message_id: 7, forum_topic_created: { name: '📣 Новини та оновлення' } } };
    updates.push({ update_id: 1, message: { message_id: 50, from: { id: 9, first_name: 'Гравець' }, chat: G, text: '/here', ...topic } });
    updates.push({ update_id: 2, message: { message_id: 51, from: { id: 5, first_name: 'Власник' }, chat: { id: 5, type: 'private' }, text: '/here' } });
    updates.push({ update_id: 3, message: { message_id: 52, from: { id: 5, first_name: 'Власник' }, chat: G, text: '/here@avtodrop_bot', ...topic } });
    await wait(() => calls.filter((c) => c.method === 'deleteMessage').length >= 2);
    assert.equal(got.length, 1, 'only the owner in the group');
    assert.deepEqual(got[0], { chat: G.id, thread: 7, title: 'АВТОДРОП чат', topic: '📣 Новини та оновлення', forum: true, by: 5 });
    const reply = calls.find((c) => c.method === 'sendMessage' && c.params.chat_id === G.id);
    assert.equal(reply.params.text, HERE_TEXT);
    assert.equal(reply.params.message_thread_id, 7);
    const dels = calls.filter((c) => c.method === 'deleteMessage');
    assert.deepEqual(dels.map((d) => d.params.message_id).sort((a, b) => a - b), [52, 101], 'the command and the bot\'s reply (message 101)');
    assert.ok(dels[0].at - reply.at >= 30, 'deleted after a pause, not at once');
    assert.equal(calls.filter((c) => c.method === 'sendMessage' && c.params.chat_id === 5).length, 0, 'private /here: nothing');
    // The general topic: thread 0, the reply without a thread id.
    updates.push({ update_id: 4, message: { message_id: 60, from: { id: 5, first_name: 'Власник' }, chat: G, text: '/here' } });
    await wait(() => got.length === 2 && calls.filter((c) => c.method === 'deleteMessage').length >= 4);
    assert.equal(got[1].thread, 0);
    assert.equal(got[1].topic, '');
    const r2 = calls.filter((c) => c.method === 'sendMessage' && c.params.chat_id === G.id)[1];
    assert.equal('message_thread_id' in r2.params, false);
    // Owner 29.10: an admin writing «анонімно» (as the group: GroupAnonymousBot + sender_chat = the group) counts.
    updates.push({ update_id: 5, message: { message_id: 70, from: { id: 1087968824, first_name: 'Group', username: 'GroupAnonymousBot' }, sender_chat: { id: G.id, type: 'supergroup', title: G.title }, chat: G, text: '/here', ...topic } });
    // …but a post as some other channel/chat does not.
    updates.push({ update_id: 6, message: { message_id: 71, from: { id: 136817688, first_name: 'Channel' }, sender_chat: { id: -100999, type: 'channel', title: 'чужий' }, chat: G, text: '/here', ...topic } });
    await wait(() => got.length >= 3);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(got.length, 3, 'the anonymous group admin, not the foreign channel');
    assert.equal(got[2].thread, 7);
  } finally {
    bot.stop();
    await new Promise((r) => setTimeout(r, 30));
    globalThis.fetch = realFetch;
    globalThis.setInterval = realSI;
  }
});

test('server: the owner\'s /here reaches channel.js; the admin test post goes into that topic', async () => {
  const { createApp } = await import('../server.js');
  const realFetch = globalThis.fetch;
  const calls = [], updates = [];
  globalThis.fetch = async (u, opts = {}) => {
    if (!String(u).startsWith('https://api.telegram.org/')) return realFetch(u, opts);
    const method = String(u).split('/').pop(), params = JSON.parse(opts.body || '{}');
    calls.push({ method, params });
    let result = true;
    if (method === 'getMe') result = { id: 1, username: 'avtodrop_bot' };
    else if (method === 'getMyDescription') result = { description: '' };
    else if (method === 'getMyShortDescription') result = { short_description: '' };
    else if (method === 'sendMessage') result = { message_id: calls.length };
    else if (method === 'getUpdates') result = await new Promise((r) => setTimeout(() => r(updates.splice(0)), 15));
    return { json: async () => ({ ok: true, result }) };
  };
  const app = createApp({ dbFile: ':memory:', dev: true, token: 'T', webappUrl: 'https://game.example/', admins: [5], log: () => {} });
  const port = await app.start(0);
  const admin = (name, body = {}) => realFetch(`http://localhost:${port}/api/admin/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    assert.equal((await admin('channel')).configured, false);
    updates.push({ update_id: 1, message: { message_id: 70, from: { id: 5, first_name: 'Власник' }, chat: { id: -1005550001, type: 'supergroup', is_forum: true, title: 'АВТОДРОП' }, text: '/here', is_topic_message: true, message_thread_id: 3 } });
    await wait(() => calls.some((c) => c.method === 'sendMessage' && c.params.text === HERE_TEXT));
    const st = await admin('channel');
    assert.equal(st.configured, true);
    assert.equal(st.target.chat, -1005550001);
    assert.equal(st.target.thread, 3);
    await admin('channel/test', { confirm: true, reason: 'тест', text: 'привіт тема' });
    const post = calls.find((c) => c.method === 'sendMessage' && /привіт тема/.test(c.params.text));
    assert.equal(post.params.chat_id, -1005550001);
    assert.equal(post.params.message_thread_id, 3);
    assert.equal((await admin('channel/target-clear', { confirm: true, reason: 'тест' })).target, null);
  } finally {
    app.close();
    await new Promise((r) => setTimeout(r, 60));
    globalThis.fetch = realFetch;
  }
});

// ---------- «Мітки посилань» ----------
test('startTags: personal links folded, per day for 30 days, 7/30 totals, sorted by the week, the tail grouped', () => {
  const today = M.dayNum('2026-10-28');
  const rows = [
    { day: today, param: 'tiktok' }, { day: today, param: 'tiktok' }, { day: today - 8, param: 'tiktok' }, { day: today - 1, param: 'insta_gavr' },
    { day: today - 2, param: 'ref_123' }, { day: today - 3, param: 'ref_456' }, { day: today, param: 'ch_abc' },
    { day: today - 10, param: 'tgchannel' }, { day: today - 20, param: null }, { day: today - 40, param: 'old' }, { day: today, param: 'club_ab12cd34' },
  ];
  const r = M.startTags({ rows, today });
  assert.equal(r.days.length, 30);
  assert.equal(r.days.at(-1), '2026-10-28');
  const by = Object.fromEntries(r.tags.map((t) => [t.tag, t]));
  assert.equal(by.tiktok.d7, 2);
  assert.equal(by.tiktok.byDay.at(-1), 2);
  assert.equal(by.tiktok.d30, 3);
  assert.equal(by['ref_…'].d7, 2);
  assert.equal(by['ch_…'].d7, 1);
  assert.equal(by['club_…'].d7, 1);
  assert.equal(by.tgchannel.d7, 0);
  assert.equal(by.tgchannel.d30, 1);
  assert.equal(by[''].d30, 1);
  assert.equal(by.old, undefined, 'outside 30 days');
  assert.equal(r.tags[0].tag, 'tiktok');
  assert.match(by.tgchannel.note, /автопостах/);
  const many = Array.from({ length: 40 }, (_, i) => ({ day: today, param: 'src' + i }));
  const g = M.startTags({ rows: many, today });
  assert.equal(g.tags.length, M.TAG_ROWS);
  assert.equal(g.tags.at(-1).tag, '*');
  assert.equal(g.tags.reduce((a, t) => a + t.d7, 0), 40);
});

test('admin metrics carry tags from users.start_param; the panel renders 7 and 30 days and the link hint', () => {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-28T09:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {}, admins: [1] });
  g.ensureUser({ id: 11, first_name: 'A' }, 'tiktok');
  g.ensureUser({ id: 12, first_name: 'B' }, 'tiktok');
  g.ensureUser({ id: 13, first_name: 'C' }, 'ref_11');
  g.ensureUser({ id: 14, first_name: 'D' }, 'bad param!');
  g.ensureUser({ id: 15, first_name: 'E' });
  t += 86400e3;
  g.ensureUser({ id: 16, first_name: 'F' }, 'insta_gavr');
  const m = g.adminCall('local', 'metrics', { days: 14 });
  const by = Object.fromEntries(m.tags.tags.map((x) => [x.tag, x]));
  assert.equal(by.tiktok.d7, 2);
  assert.equal(by['ref_…'].d7, 1);
  assert.equal(by[''].d7, 2, 'no or invalid parameter');
  assert.equal(by.insta_gavr.byDay.at(-1), 1);
  assert.equal(by.tiktok.byDay.at(-2), 2);
  const esc = (s) => String(s).replace(/</g, '&lt;');
  const html = tagsPanel(m.tags, { esc });
  assert.match(html, /Мітки посилань/);
  assert.match(html, /id="mtag7" checked/);
  assert.match(html, /<code>tiktok<\/code>/);
  assert.match(html, /https:\/\/t\.me\/avtodrop2026_bot\?start=&lt;мітка&gt;/);
  assert.equal(tagLink('insta_gavr'), 'https://t.me/avtodrop2026_bot?start=insta_gavr');
  assert.equal(tagLink('інста'), null);
  assert.equal(tagLink('a-b'), null);
  assert.equal(tagLink(''), null);
});
