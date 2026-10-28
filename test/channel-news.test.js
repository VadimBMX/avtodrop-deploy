import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createChannel } from '../src/channel.js';

test('channel news: only changelog entries marked `news` go to the group, once, and only when a target is set', async () => {
  const db = openDb(':memory:');
  const calls = [];
  let t = Date.parse('2026-10-29T12:00:00Z');
  const ch = createChannel({ db, api: async (m, p) => calls.push([m, p]), now: () => t, log: () => {} });
  const log = [
    { id: '2026-10-29-big', title: '29.10 — Аукціон рідкісних машин', short: ['x'], news: ['Щонеділі аукціон <рідкісних> машин'], items: ['a'] },
    { id: '2026-10-28-small', title: '28.10 — дрібниці', short: ['y'], items: ['b'] },
    { id: '2026-10-01-old', title: 'старе', news: true, short: ['z'], items: ['c'] },
  ];
  assert.equal((await ch.postNews(log)).sent, 0); // nowhere to post yet
  ch.setTarget({ chat: -1001234567, thread: 7 });
  assert.equal((await ch.postNews()).sent, 1);
  assert.equal(calls.length, 1);
  const [m, p] = calls[0];
  assert.equal(m, 'sendMessage');
  assert.equal(p.message_thread_id, 7);
  assert.match(p.text, /<b>Аукціон рідкісних машин<\/b>/);
  assert.match(p.text, /&lt;рідкісних&gt;/);
  assert.doesNotMatch(p.text, /дрібниці|старе/);
  assert.equal((await ch.postNews(log)).sent, 0); // not again
});
