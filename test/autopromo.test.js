// «Автопромо» (src/autopromo.js): the code goes to the /promohere topic with the configured amount / activations /
// life, within the day window; nothing goes without a target or when switched off; a failed send leaves no code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createAutoPromo, normalizeAutoPromo, inWindow, windowLen } from '../src/autopromo.js';
import * as S from '../public/shared.js';

test('autopromo: posts a fresh code to the topic, inside the window, then plans the next', async () => {
  const db = openDb(':memory:');
  let t = S.kyivParse('2026-10-29T14:00');
  const sent = [];
  const ap = createAutoPromo({ db, now: () => t, api: async (m, p) => sent.push([m, p]), random: () => 0.5, log: () => {} });
  await ap.tick();
  assert.equal(sent.length, 0, 'no target yet');
  ap.setTarget({ chat: -1001234567, thread: 9, title: 'Чат' });
  db.prepare("UPDATE meta SET value = ? WHERE key = 'autopromo_next'").run(JSON.stringify(t - 1));
  await ap.tick();
  assert.equal(sent.length, 1);
  const [, p] = sent[0];
  assert.equal(p.message_thread_id, 9);
  const code = /<code>([A-Z0-9]+)<\/code>/.exec(p.text)[1];
  const row = db.prepare('SELECT * FROM promos WHERE code = ?').get(code);
  const c = normalizeAutoPromo({});
  assert.ok(row.amount >= c.min && row.amount <= c.max);
  assert.ok(row.uses_left >= c.usesMin && row.uses_left <= c.usesMax);
  assert.equal(row.expires_at, t + c.ttlMin * 60e3);
  const next = ap.status().nextAt;
  assert.ok(next > t);
  const h = Number(S.kyivLocal(next).slice(11, 13));
  assert.ok(h >= c.from && h < c.to, 'the next one is inside the window');
  // Off: nothing.
  await ap.admin('autopromo/set', { on: false }, { role: 'owner' });
  t = next + 1;
  await ap.tick();
  assert.equal(sent.length, 1);
});

test('autopromo: a failed send leaves no code; the window rolls over midnight', async () => {
  const db = openDb(':memory:');
  const t = S.kyivParse('2026-10-29T23:30');
  const ap = createAutoPromo({ db, now: () => t, api: async () => { throw new Error('chat not found'); }, random: () => 0.5, log: () => {} });
  ap.setTarget({ chat: -1001234567 });
  await ap.admin('autopromo/set', { from: 10, to: 23 }, { role: 'owner' });
  await assert.rejects(ap.postOne(), /chat not found/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM promos').get().n, 0);
  const next = ap.planNext(t);
  assert.equal(S.kyivDateOf(next), '2026-10-30');
  assert.ok(Number(S.kyivLocal(next).slice(11, 13)) >= 10);
  assert.equal(ap.status().log[0].ok, 0);
});

test('autopromo: an overnight window (18 → 6) and round the clock', async () => {
  assert.deepEqual([normalizeAutoPromo({ from: 5, to: 5 }).from, normalizeAutoPromo({ from: 5, to: 5 }).to], [0, 24]);
  assert.equal(normalizeAutoPromo({ perDay: 12 }).perDay, 12);
  const n = normalizeAutoPromo({ from: 18, to: 6 });
  assert.deepEqual([n.from, n.to], [18, 6]);
  assert.ok(inWindow(n, 23.5) && inWindow(n, 2) && inWindow(n, 18) && !inWindow(n, 6) && !inWindow(n, 12));
  assert.equal(windowLen(n), 12);
  for (const [at, cfg] of [['2026-10-29T12:00', { from: 18, to: 6 }], ['2026-10-29T03:00', { from: 18, to: 6 }], ['2026-10-29T03:00', { from: 0, to: 24 }]]) {
    const db = openDb(':memory:');
    const t = S.kyivParse(at);
    const ap = createAutoPromo({ db, now: () => t, api: async () => ({}), random: () => 0.5, log: () => {} });
    ap.setTarget({ chat: -1001234567 });
    await ap.admin('autopromo/set', { ...cfg, perDay: 6 }, { role: 'owner' });
    const next = ap.status().nextAt, c = normalizeAutoPromo(cfg);
    const h = Number(S.kyivLocal(next).slice(11, 13)) + Number(S.kyivLocal(next).slice(14, 16)) / 60;
    assert.ok(next > t && next - t < 24 * 3600e3, at);
    assert.ok(inWindow(c, h), `${at} ${JSON.stringify(cfg)} → ${S.kyivLocal(next)}`);
  }
});

test('autopromo: a new post deletes the earlier promo posts from the chat (owner 13.11), once each', async () => {
  const db = openDb(':memory:');
  let t = S.kyivParse('2026-11-13T14:00');
  let n = 100;
  const calls = [];
  const api = async (m, p) => {
    calls.push([m, p]);
    if (m === 'deleteMessage' && p.message_id === 101) throw new Error('message to delete not found');
    return m === 'sendMessage' ? { message_id: ++n } : true;
  };
  const ap = createAutoPromo({ db, now: () => t, api, random: () => 0.5, log: () => {} });
  ap.setTarget({ chat: -1001234567, thread: 9, title: 'Чат' });
  await ap.admin('autopromo/now', {}, { role: 'owner' });
  assert.deepEqual(calls.filter((c) => c[0] === 'deleteMessage'), [], 'nothing to delete before the first post');
  t += 60e3;
  await ap.admin('autopromo/now', {}, { role: 'owner' });
  t += 60e3;
  await ap.admin('autopromo/now', {}, { role: 'owner' });
  const dels = calls.filter((c) => c[0] === 'deleteMessage').map((c) => c[1].message_id);
  assert.deepEqual(dels, [101, 102], 'each earlier post deleted once (a failed delete is not retried)');
  const left = db.prepare('SELECT msg_id FROM autopromo_log WHERE gone = 0').all().map((r) => r.msg_id);
  assert.deepEqual(left, [103], 'only the newest post stays');
});
