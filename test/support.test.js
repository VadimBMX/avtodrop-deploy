import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

test('support: the player writes, admins are told in Telegram, the answer pops up in the game', () => {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-20T10:00:00Z');
  const sent = [];
  const g = createGame(db, { now: () => t, notify: (uid, text) => sent.push([uid, text]), admins: [777] });
  g.ensureUser({ id: 1, first_name: 'A' });
  assert.throws(() => g.api['support/send'](1, { text: 'ok' }), /кількома словами/);
  const { id } = g.api['support/send'](1, { text: 'Не прийшли зірки за оплату' });
  assert.ok(sent.some(([uid, text]) => uid === 777 && text.includes('Не прийшли зірки')), 'admin got it in Telegram');
  assert.throws(() => g.api['support/send'](1, { text: 'ще одне питання' }), /Зачекай/);
  assert.equal(g.admin.support('t', { open: true }).open, 1);
  g.admin['support/reply']('t', { id, text: 'Перевірили, гроші зараховано' });
  assert.equal(g.admin.support('t', { open: true }).open, 0);
  assert.equal(g.api['support/mine'](1).list[0].answer, 'Перевірили, гроші зараховано');
  const gift = g.api.pulse(1).gifts.find((x) => x.kind === 'message');
  assert.ok(gift.note.includes('Перевірили'), 'answer shows up as a window in the game');
  t += 61e3;
  const thanks = g.api['support/send'](1, { text: 'Дякую!' }).id;
  // «Дякую» is closed without an answer: off the open count, nothing reaches the player
  const gifts = g.api.pulse(1).gifts.length;
  assert.equal(g.admin.support('t', { open: true }).open, 1);
  g.admin['support/close']('t', { id: thanks });
  const all = g.admin.support('t', {});
  assert.equal(all.open, 0);
  assert.equal(all.list.find((m) => m.id === thanks).answer, null);
  assert.ok(all.list.find((m) => m.id === thanks).answeredAt);
  assert.equal(g.api.pulse(1).gifts.length, gifts);
  assert.ok(g.api['support/mine'](1).list[0].answeredAt);
});

test('support: the owner, every admin and every helper get the Telegram ping', () => {
  const db = openDb(':memory:');
  const sent = [];
  const g = createGame(db, { now: () => Date.parse('2026-10-20T10:00:00Z'), notify: (uid, text) => sent.push([uid, text]), admins: [1] });
  for (const id of [1, 2, 3, 4, 10]) g.ensureUser({ id, first_name: 'U' + id });
  g.admin.role('tg:1', { id: 2, role: 'admin' });
  g.admin.role('tg:1', { id: 3, role: 'helper' });
  sent.length = 0;
  g.api['support/send'](10, { text: 'Не прийшла машина' });
  const pinged = sent.filter(([, t]) => t.includes('Підтримка')).map(([u]) => u).sort();
  assert.deepEqual(pinged, [1, 2, 3]);
});
