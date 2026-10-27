import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { normalizeGroups, TGG } from '../src/tggroups.js';
import { PUSH, pickReminder } from '../src/reminders.js';

const setup = () => {
  let t = Date.parse('2026-10-28T12:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, notify: () => {}, admins: [1] });
  return { db, g, adv: (ms) => (t += ms), now: () => t };
};
const set = (g, body) => g.adminCall('tg:1', 'tggroups/set', { ...body, confirm: true, reason: 'test' });

test('tggroups: normalize ids and links', () => {
  assert.deepEqual(normalizeGroups({ channel: '@avto_news', chat: 'https://t.me/avto_chat' }), { channel: '@avto_news', channelLink: 'https://t.me/avto_news', chat: '@avto_chat', chatLink: 'https://t.me/avto_chat' });
  assert.equal(normalizeGroups({ channel: 'bad name!' }).channel, '');
  assert.equal(normalizeGroups({ chat: '-1001234567', chatLink: 'https://t.me/+AbCdEf' }).chatLink, 'https://t.me/+AbCdEf');
});

test('tggroups: hidden until set; the bonus only for a member, once per group', () => {
  const { g } = setup();
  g.ensureUser({ id: 1, first_name: 'O' });
  g.ensureUser({ id: 5, first_name: 'P' });
  assert.equal(g.api.me(5).groups, null);
  assert.throws(() => set(g, { channel: '-100123456' }), /посилання-запрошення/);
  set(g, { channel: '@avto_news', chat: '@avto_chat' });
  assert.equal(g.api.me(5).groups.channel.claimed, false);
  assert.throws(() => g.tgGroups.claim(5, 'channel', false), /Ще не бачу тебе в каналі/);
  const keys0 = g.api.me(5).keys?.[TGG.reward.channel.caseId] || 0;
  const r = g.tgGroups.claim(5, 'channel', true);
  assert.equal(r.groups.channel.claimed, true);
  assert.equal((g.api.me(5).keys?.[TGG.reward.channel.caseId] || 0) - keys0, TGG.reward.channel.count);
  assert.throws(() => g.tgGroups.claim(5, 'channel', true), /вже отримано/);
  // The client can't book it through the plain API (no such handler).
  assert.equal(g.api['tggroups/claim'], undefined);
});

test('tggroups: the reminder — level 2+, a day old, every 3 days, at most 4 times, stops once both are taken', () => {
  const { db, g, adv, now } = setup();
  g.ensureUser({ id: 1, first_name: 'O' });
  set(g, { channel: '@avto_news', chat: '@avto_chat' });
  g.ensureUser({ id: 7, first_name: 'P' });
  const seen = () => db.prepare('UPDATE users SET last_seen = ?, level = 3 WHERE id = 7').run(now() - 3600e3);
  const items = () => (g.pushCandidates(PUSH).find((c) => c.uid === 7)?.ready || []).filter((r) => r.kind === 'tggroup');
  seen();
  assert.equal(items().length, 0, 'not on the first day');
  adv(25 * 3600e3);
  seen();
  const it = items();
  assert.equal(it.length, 1);
  assert.match(it[0].text, /@avto_news/);
  // Mark it sent the way the scheduler does, then it waits 3 days.
  const sendIt = () => db.prepare('UPDATE users SET push_sent = ? WHERE id = 7').run(JSON.stringify({ tggroup: now() }));
  let n = 0;
  for (let k = 0; k < 6; k++) {
    seen();
    if (items().length) (n++, sendIt());
    adv(3600e3);
    seen();
    assert.equal(items().length, 0, 'not again within 3 days');
    adv(3 * 86400e3);
  }
  seen();
  items();
  assert.equal(n, TGG.nudge.max);
  assert.ok(pickReminder);
});

test('rating: an admin hides a player from the boards and the weekly prizes, and shows him again', () => {
  const { db, g } = setup();
  g.ensureUser({ id: 1, first_name: 'O' });
  for (const id of [11, 12, 13]) g.ensureUser({ id, first_name: 'P' + id });
  db.prepare('UPDATE users SET total_value = 1000000 * id').run();
  const ids = () => g.api.leaderboard(11, { type: 'all' }).list.map((x) => x.id);
  assert.equal(ids()[0], 13);
  g.adminCall('tg:1', 'lb-hide', { id: 13, hidden: true, confirm: true, reason: 'test' });
  assert.ok(!ids().includes(13));
  assert.equal(g.api.leaderboard(11, { type: 'all' }).list[0].place, 1);
  assert.equal(g.adminCall('tg:1', 'user', { id: 13 }).user.lbHidden, true);
  g.adminCall('tg:1', 'lb-hide', { id: 13, hidden: false, confirm: true, reason: 'test' });
  assert.ok(ids().includes(13));
});
