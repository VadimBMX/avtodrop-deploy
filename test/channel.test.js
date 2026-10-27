// Auto-posts to the Telegram channel (src/channel.js): the hourly limit and digests, which events go out (S drops,
// secret / edition cars, opened container jackpots, the final boss, the weekly top), opt-in names only, no backlog
// after switching on, no repeats, admin rights / confirm, and the player's privacy switch over HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createApp } from '../server.js';
import { createChannel, planPosts, normalizeCfg, eventText, digestText, STALE_MS, FINAL_BOSS } from '../src/channel.js';
import * as S from '../public/shared.js';

const T0 = Date.parse('2026-10-28T12:00:00Z');
const cfgOf = (o = {}) => normalizeCfg({ on: true, ...o });
const ev = (kind, at, extra = {}) => ({ kind, at, ...extra });
const S_CASE = S.CASES.find((c) => S.CASE_BY_ID[c.id] && c.id).id;
const S_MODEL = S.ALL_MODELS.find((m) => m.cls === 'S' && !m.secret).id;
const SECRET = S.ALL_MODELS.find((m) => m.secret).id;

test('normalizeCfg: defaults off, limits clamped, unknown kinds ignored', () => {
  const d = normalizeCfg({});
  assert.equal(d.on, false);
  assert.equal(d.maxPerHour, 4);
  assert.equal(d.digest, true);
  const c = normalizeCfg({ on: 1, maxPerHour: 999, digestMin: 1, jackpotX: 'x', kinds: { boss: false, evil: true } });
  assert.equal(c.on, true);
  assert.equal(c.maxPerHour, 20);
  assert.equal(c.digestMin, 15);
  assert.equal(c.jackpotX, 2.5);
  assert.equal(c.kinds.boss, false);
  assert.equal(c.kinds.evil, undefined);
});

test('planPosts: hourly budget, the last slot gathers the rest, S drops wait for the digest', () => {
  const now = T0;
  // 3 singles, budget 4 → 3 posts, highest priority first.
  let r = planPosts([ev('secret', now - 5), ev('weekly', now - 1, { top: [] }), ev('boss', now - 2)], { now, cfg: cfgOf() });
  assert.deepEqual(r.posts.map((p) => p.events[0].kind), ['weekly', 'boss', 'secret']);
  assert.equal(r.keep.length, 0);
  // budget 2 (2 sent in the last hour), 3 singles → 1 single + 1 digest of 2.
  r = planPosts([ev('secret', now), ev('boss', now), ev('jackpot', now)], { now, cfg: cfgOf(), sent: [now - 10e3, now - 20e3, now - 4000e3] });
  assert.equal(r.posts.length, 2);
  assert.equal(r.posts[0].type, 'single');
  assert.equal(r.posts[1].type, 'digest');
  assert.equal(r.posts[1].events.length, 2);
  // budget 0 → nothing, everything kept.
  r = planPosts([ev('boss', now)], { now, cfg: cfgOf({ maxPerHour: 1 }), sent: [now - 1000] });
  assert.equal(r.posts.length, 0);
  assert.equal(r.keep.length, 1);
  // S drops: the digest waits for digestMin after the last one…
  const drops = [ev('drop', now), ev('drop', now)];
  r = planPosts(drops, { now, cfg: cfgOf(), lastDigest: now - 10 * 60e3 });
  assert.equal(r.posts.length, 0);
  assert.equal(r.keep.length, 2);
  // …then goes out as one post.
  r = planPosts(drops, { now, cfg: cfgOf(), lastDigest: now - 61 * 60e3 });
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0].type, 'digest');
  // 8 drops flush at once; digest off → each drop is a single (within the budget).
  r = planPosts(Array.from({ length: 8 }, () => ev('drop', now)), { now, cfg: cfgOf(), lastDigest: now });
  assert.equal(r.posts.length, 1);
  r = planPosts(drops, { now, cfg: cfgOf({ digest: false }), lastDigest: now });
  assert.deepEqual(r.posts.map((p) => p.type), ['single', 'single']);
  // Stale news is dropped.
  r = planPosts([ev('boss', now - STALE_MS - 1)], { now, cfg: cfgOf() });
  assert.equal(r.posts.length + r.keep.length, 0);
});

test('texts: anonymous without opt-in, names escaped, digest capped', () => {
  const anon = eventText({ kind: 'drop', model: S_MODEL, caseId: S_CASE, name: null });
  assert.match(anon, /Хтось із гравців/);
  const named = eventText({ kind: 'boss', name: '<b>Вася</b>', best: 9.123 });
  assert.match(named, /&lt;b&gt;Вася&lt;\/b&gt;/);
  assert.match(named, /9,123 с/);
  const d = digestText(Array.from({ length: 13 }, () => ({ kind: 'drop', model: S_MODEL, caseId: S_CASE, name: null })));
  assert.match(d, /і ще 3/);
});

function setup({ cfg = { on: true, maxPerHour: 20, digest: false } } = {}) {
  let t = T0;
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {}, allUnlocked: true });
  const posts = [];
  const api = async (method, params) => (posts.push({ method, ...params }), { message_id: posts.length });
  const ch = createChannel({ db, channelId: '@avtodrop_test', api, now: () => t, log: () => {}, imageUrl: (m) => `https://x.test/cars/${m}.webp`, playUrl: () => 'https://t.me/bot?start=tgchannel' });
  const mk = (id, name, username) => (g.ensureUser({ id, first_name: name, username }), id);
  const owner = (name, body = {}) => ch.admin(name, { confirm: true, reason: 'тест', ...body }, { who: 'key', role: 'owner' });
  const drop = (uid, cls = 'S', forced = 0, item = S_MODEL) => db.prepare('INSERT INTO drops (user_id, case_id, item, cls, seed_hash, client_seed, nonce, forced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid, S_CASE, item, cls, 'h', 'c', 1, forced, t);
  const lot = (uid, model, bid, opened) => db.prepare(`INSERT INTO container_lots (tier, model, ed, hints, commit_hash, salt, seed, bots, top_bid, top_bidder, status, ends_at, opened, created_at, settled_at)
    VALUES ('t1', ?, 0, '[]', 'h', 's', 1, '[]', ?, ?, 'done', ?, ?, ?, ?)`).run(model, bid, uid, t, opened ? 1 : 0, t, t).lastInsertRowid;
  return { db, g, ch, posts, mk, owner, drop, lot, cfg, add: (ms) => (t += ms), at: () => t };
}

test('channel: nothing from before switching on; then S drops, secrets, jackpots, the boss and the week go out once', async () => {
  const s = setup();
  const a = s.mk(10, 'Аня', 'anya'), b = s.mk(11, 'Богдан');
  s.drop(a); // before switching on — never posted
  await s.ch.tick();
  assert.equal(s.posts.length, 0, 'off by default');
  await s.owner('channel/set', s.cfg);
  s.add(1000);
  await s.ch.tick();
  assert.equal(s.posts.length, 0, 'no backlog');

  s.drop(a); // S drop
  s.drop(b, 'A'); // not S
  s.drop(b, 'S', 3); // admin-rigged: skipped
  s.g.giveCar(b, SECRET); // secret car
  const big = S.MODELS[S_MODEL];
  s.lot(a, S_MODEL, Math.floor(big.price / 5), true); // ×5 jackpot, opened
  s.lot(b, S_MODEL, Math.floor(big.price / 5), false); // not opened yet → no spoiler
  s.db.prepare('INSERT INTO boss_runs (user_id, boss, tries, wins, best, beaten_at) VALUES (?, ?, 3, 1, 9.5, ?)').run(b, FINAL_BOSS, s.at());
  s.add(1000);
  await s.ch.tick();
  const kinds = s.posts.map((p) => p.text || p.caption);
  assert.equal(s.posts.length, 4, kinds.join('\n---\n'));
  assert.ok(kinds.some((x) => /Міфічний дроп/.test(x)));
  assert.ok(kinds.some((x) => /Секретне авто/.test(x)));
  assert.ok(kinds.some((x) => /Джекпот на Причалі/.test(x) && /×5/.test(x)));
  assert.ok(kinds.some((x) => /Бос усіх босів переможений/.test(x)));
  // Nobody opted in → no names anywhere.
  assert.ok(kinds.every((x) => !/anya|Аня|Богдан/.test(x)));
  assert.ok(s.posts.every((p) => p.chat_id === '@avtodrop_test' && p.parse_mode === 'HTML' && p.reply_markup.inline_keyboard[0][0].url.includes('tgchannel')));
  assert.ok(s.posts.some((p) => p.link_preview_options?.url?.startsWith('https://x.test/cars/')), 'the car photo as a preview');

  // Repeat tick: nothing again. Opening the second container later posts it then.
  await s.ch.tick();
  assert.equal(s.posts.length, 4);
  s.db.prepare('UPDATE container_lots SET opened = 1 WHERE top_bidder = ?').run(b);
  await s.ch.tick();
  assert.equal(s.posts.length, 5);

  // Opt-in: the name appears.
  s.ch.setShow(a, true);
  s.drop(a);
  await s.ch.tick();
  assert.match(s.posts.at(-1).text, /@anya/);
  // Banned players are skipped.
  s.db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(a);
  s.drop(a);
  await s.ch.tick();
  assert.equal(s.posts.length, 6);
});

test('channel: weekly top after the week is settled, names only for opted-in players', async () => {
  const s = setup();
  const a = s.mk(20, 'А', 'top1'), b = s.mk(21, 'Б', 'top2');
  await s.owner('channel/set', s.cfg);
  s.ch.setShow(a, true);
  const prev = '2026-10-19';
  s.db.prepare('UPDATE users SET week_id = ?, week_start_value = 0, total_value = ? WHERE id = ?').run(prev, 5e6, a);
  s.db.prepare('UPDATE users SET week_id = ?, week_start_value = 0, total_value = ? WHERE id = ?').run(prev, 3e6, b);
  s.add(1000);
  s.db.prepare('INSERT INTO weeks (week_id, settled_at) VALUES (?, ?)').run(prev, s.at());
  await s.ch.tick();
  assert.equal(s.posts.length, 1);
  const x = s.posts[0].text;
  assert.match(x, /Гонка тижня 19\.10–25\.10/);
  assert.match(x, /🥇 <b>@top1<\/b>/);
  assert.match(x, /🥈 Хтось із гравців/);
  assert.ok(!/top2/.test(x));
});

test('channel: hourly limit turns a burst into a digest; admin rights and confirm', async () => {
  const s = setup();
  const a = s.mk(30, 'В');
  await s.owner('channel/set', { on: true, maxPerHour: 2, digest: true, digestMin: 60 });
  for (let i = 0; i < 5; i++) s.g.giveCar(a, SECRET);
  s.add(1000);
  await s.ch.tick();
  assert.equal(s.posts.length, 2);
  assert.match(s.posts[1].text, /Гаряче в АВТОДРОПі/);
  // The hour is used up: new events wait.
  s.g.giveCar(a, SECRET);
  await s.ch.tick();
  assert.equal(s.posts.length, 2);
  assert.equal(s.ch.pending.length, 1);
  s.add(3601e3);
  await s.ch.tick();
  assert.equal(s.posts.length, 3);

  assert.equal((await s.ch.admin('channel/set', { on: false, confirm: true, reason: 'тест' }, { who: 'tg:5', role: 'helper' })).code, 403);
  assert.match((await s.ch.admin('channel/set', { on: false, reason: 'тест' }, { who: 'key', role: 'owner' })).error, /не підтверджено/);
  assert.match((await s.ch.admin('channel/set', { on: false, confirm: true }, { who: 'tg:2', role: 'admin' })).error, /причину/); // an admin needs a reason, the owner doesn't
  assert.equal(s.ch.status().cfg.on, true);
  const st = await s.owner('channel/test', { text: 'Привіт, канал' });
  assert.equal(st.log[0].test, 1);
  assert.match(s.posts.at(-1).text, /Привіт, канал/);
  assert.ok(s.db.prepare("SELECT 1 FROM admin_log WHERE action = 'channel-test'").get());
});

test('server: the privacy switch is off by default and only exists when TG_CHANNEL_ID is set; admin endpoints', async () => {
  const posts = [];
  const app = createApp({ dbFile: ':memory:', dev: true, channelId: '-1001', channelApi: async (m, p) => posts.push([m, p]), log: () => {} });
  const port = await app.start(0);
  const dev = { 'x-dev-user': encodeURIComponent(JSON.stringify({ id: 7, first_name: 'Тест' })), 'content-type': 'application/json' };
  const post = (p, body = {}, headers = dev) => fetch(`http://localhost:${port}${p}`, { method: 'POST', headers, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: await r.json() }));
  try {
    assert.equal((await post('/api/me')).j.channelShow, false, 'opt-in: off by default');
    assert.equal((await post('/api/settings/channel', { on: true })).j.channelShow, true);
    assert.equal((await post('/api/me')).j.channelShow, true);
    assert.equal((await post('/api/settings/channel', { on: false })).j.channelShow, false);
    const st = await post('/api/admin/channel', {}, { 'content-type': 'application/json' });
    assert.equal(st.status, 200);
    assert.equal(st.j.configured, true);
    assert.equal(st.j.cfg.on, false);
    assert.equal((await post('/api/admin/channel/test', { confirm: true, reason: 'перевірка' }, { 'content-type': 'application/json' })).status, 200);
    assert.equal(posts.length, 1);
    assert.equal(posts[0][1].chat_id, '-1001');
    assert.equal((await post('/api/admin/channel/nope', {}, { 'content-type': 'application/json' })).status, 404);
  } finally {
    app.close();
  }
  const plain = createApp({ dbFile: ':memory:', dev: true, log: () => {} });
  const p2 = await plain.start(0);
  try {
    const me = await (await fetch(`http://localhost:${p2}/api/me`, { method: 'POST', headers: dev })).json();
    assert.equal(me.channelShow, undefined, 'no channel → no switch in the settings');
    const r = await fetch(`http://localhost:${p2}/api/admin/channel/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, reason: 'перевірка' }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /TG_CHANNEL_ID/);
  } finally {
    plain.close();
  }
});
