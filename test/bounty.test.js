import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as B from '../public/bounty.js';

function setup() {
  const db = openDb(':memory:');
  let t = Date.parse('2026-10-31T10:00:00Z');
  const sent = [];
  const g = createGame(db, { now: () => t, notify: (uid, text) => sent.push([uid, text]), admins: [1] });
  for (const id of [1, 2, 3, 10, 11]) g.ensureUser({ id, first_name: 'U' + id });
  g.admin.role('tg:1', { id: 2, role: 'admin' });
  g.admin.role('tg:1', { id: 3, role: 'helper' });
  const ticket = (uid, text) => {
    t += 61e3;
    return g.api['support/send'](uid, { text }).id;
  };
  return { db, g, sent, ticket, tick: (ms) => (t += ms) };
}
const keyCount = (db, uid, caseId) => db.prepare('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(uid, caseId)?.count || 0;
const balance = (db, uid) => db.prepare('SELECT balance FROM users WHERE id = ?').get(uid).balance;

test('bounty: a preset from a ticket pays money + keys, answers the ticket, sends the bot thanks and one gift window', () => {
  const { db, g, sent, ticket } = setup();
  const id = ticket(10, 'Ціна в дилера вища за ринок у 10 разів');
  const before = balance(db, 10), keysBefore = keyCount(db, 10, 'city');
  sent.length = 0;
  const r = g.adminCall('tg:1', 'bug-reward', { id: 10, preset: 'useful', ticket: id, note: 'дилер: ціна ×10', confirm: true });
  assert.equal(r.count, 1);
  assert.equal(r.badge, 'Тестувальник');
  assert.equal(balance(db, 10) - before, 1_000_000);
  assert.equal(keyCount(db, 10, 'city') - keysBefore, 1);
  // The bot message (via event → notify) and the events feed.
  const msg = sent.find(([u]) => u === 10)?.[1] || '';
  assert.match(msg, /^Дякуємо за знайдений баг 🐞 \+1 000 000 ₴ \+ ключ «Міський»/);
  assert.match(msg, /Значок «Тестувальник»/);
  // The ticket is answered with the same text.
  const mine = g.api['support/mine'](10).list.find((m) => m.id === id);
  assert.equal(mine.answer, msg);
  // One gift window (not three: the money / keys paths are quiet here).
  const gifts = g.api.pulse(10).gifts;
  assert.deepEqual(gifts.map((x) => x.kind), ['bug']);
  assert.equal(gifts[0].data.amount, 1_000_000);
  assert.deepEqual(gifts[0].data.keys, [{ caseId: 'city', count: 1 }]);
  assert.match(gifts[0].note, /дилер/);
  // The usual admin_log rows: money, keys and the reward itself.
  const log = db.prepare("SELECT action FROM admin_log WHERE target = 10 AND action IN ('money', 'keys', 'bug-reward') ORDER BY id").all().map((x) => x.action);
  assert.deepEqual(log, ['money', 'keys', 'bug-reward']);
  // The ticket shows as rewarded; a second reward for it is refused.
  assert.equal(g.admin.support('tg:1', {}).list.find((m) => m.id === id).bug.preset, 'useful');
  assert.throws(() => g.adminCall('tg:1', 'bug-reward', { id: 10, preset: 'small', ticket: id, confirm: true }), /вже видано/);
});

test('bounty: an already answered ticket keeps its answer, the thanks go below it', () => {
  const { g, ticket } = setup();
  const id = ticket(10, 'Не відкривається гараж');
  g.admin['support/reply']('tg:1', { id, text: 'Полагодили, дякуємо' });
  g.adminCall('tg:1', 'bug-reward', { id: 10, preset: 'serious', ticket: id, confirm: true });
  const a = g.api['support/mine'](10).list.find((m) => m.id === id).answer;
  assert.match(a, /^Полагодили, дякуємо\n\nДякуємо за знайдений баг 🐞 \+5 000 000 ₴ \+ 2 ключі «Спорткар»/);
});

test('bounty: roles — owner needs no reason, an admin does and cannot reward himself, a helper cannot reward', () => {
  const { g, ticket } = setup();
  assert.throws(() => g.adminCall('tg:2', 'bug-reward', { id: 10, preset: 'small', confirm: true }), /причину/);
  g.adminCall('tg:2', 'bug-reward', { id: 10, preset: 'small', confirm: true, reason: 'знайшов баг з ціною' });
  assert.throws(() => g.adminCall('tg:2', 'bug-reward', { id: 2, preset: 'small', confirm: true, reason: 'сам собі' }), /Свій акаунт/);
  assert.throws(() => g.adminCall('tg:3', 'bug-reward', { id: 10, preset: 'small', confirm: true, reason: 'хелпер' }), /Немає прав/);
  assert.throws(() => g.adminCall('tg:1', 'bug-reward', { id: 10, preset: 'small' }), /не підтверджено/);
  // The ticket must be this player's.
  const other = ticket(11, 'Баг з кейсом');
  assert.throws(() => g.adminCall('tg:1', 'bug-reward', { id: 10, preset: 'small', ticket: other, confirm: true }), /іншого гравця/);
  // Helpers may look at the list.
  assert.equal(g.adminCall('tg:3', 'bugs', {}).total.n, 1);
  // The reason went to the log.
  const row = g.admin.log('tg:1', { action: 'bug-reward' }).list[0];
  assert.match(row.details, /знайшов баг з ціною/);
  assert.match(g.admin.log('tg:1', { action: 'money' }).list[0].details, /знайшов баг з ціною/);
});

test('bounty: custom reward — amount and/or keys, limits checked', () => {
  const { db, g } = setup();
  const before = balance(db, 11);
  g.adminCall('tg:1', 'bug-reward', { id: 11, preset: 'custom', amount: 750000, caseId: 'sport', count: 3, confirm: true });
  assert.equal(balance(db, 11) - before, 750000);
  assert.equal(keyCount(db, 11, 'sport'), 3);
  g.adminCall('tg:1', 'bug-reward', { id: 11, preset: 'custom', caseId: 'city', count: 1, confirm: true }); // keys only
  assert.throws(() => g.adminCall('tg:1', 'bug-reward', { id: 11, preset: 'custom', confirm: true }), /суму або ключі/);
  assert.throws(() => g.adminCall('tg:1', 'bug-reward', { id: 11, preset: 'custom', amount: B.BUG_CUSTOM_MAX + 1, confirm: true }), /Сума/);
  assert.throws(() => g.adminCall('tg:1', 'bug-reward', { id: 11, preset: 'custom', count: 2, caseId: 'nope', confirm: true }), /Невідомий кейс/);
  assert.throws(() => g.adminCall('tg:1', 'bug-reward', { id: 11, preset: 'mega', confirm: true }), /Обери нагороду/);
});

test('bounty: counter, «Тестувальник» at 1, «Головний тестувальник» at 5 — in the profile, the player card and the rating', () => {
  const { g } = setup();
  for (let i = 1; i <= 5; i++) {
    const r = g.adminCall('tg:1', 'bug-reward', { id: 10, preset: 'small', confirm: true });
    assert.equal(r.count, i);
    assert.equal(r.badge, i === 1 ? 'Тестувальник' : i === 5 ? 'Головний тестувальник' : null);
  }
  const badge = (list) => list.find((b) => b.key === 'tester');
  assert.equal(badge(g.api.me(10).badges).title, 'Головний тестувальник');
  assert.equal(badge(g.api.player(11, { id: 10 }).badges).tier, 3);
  const card = g.admin.user('tg:1', { id: 10 });
  assert.equal(card.bugs.count, 5);
  assert.equal(card.bugs.badge, 'Головний тестувальник');
  for (const type of ['all', 'week', 'season']) {
    const row = g.api.leaderboard(10, { type }).list.find((r) => r.id === 10);
    if (row) assert.equal(row.tester, 3, type);
  }
  // «Знайдені баги»: newest first, with the counter and summary.
  const v = g.admin.bugs('tg:1', {});
  assert.equal(v.list.length, 5);
  assert.equal(v.total.money, 5 * 250000);
  assert.equal(v.top[0].n, 5);
  assert.equal(v.list[0].count, 5);
});

test('bounty: the panel and the app know the new pieces (icon, gift window, admin view)', () => {
  const svg = readFileSync(new URL('../public/icons.svg', import.meta.url), 'utf8');
  assert.match(svg, /id="i-bug"/);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /g\.kind === 'bug'/);
  const adm = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  assert.match(adm, /VIEWS\.bugs/);
  const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /data-go="bugs"/);
  assert.equal(B.BUG_PRESETS.useful.keys[0].caseId, 'city');
  assert.equal(B.BUG_PRESETS.serious.keys[0].caseId, 'sport');
});
