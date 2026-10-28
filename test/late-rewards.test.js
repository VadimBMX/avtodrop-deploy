import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

// crit4 §3 №2 (owner): from level 10 achievements and collection rewards pay mostly in keys of the «Цілі дня» ladder.
function setup() {
  const db = openDb(':memory:');
  const t = Date.parse('2026-10-31T10:00:00Z');
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const mk = (id, level) => {
    g.ensureUser({ id, first_name: 'U' + id });
    db.prepare('UPDATE users SET level = ?, xp = 0, balance = 0 WHERE id = ?').run(level, id);
    return id;
  };
  const keys = (id) => Object.fromEntries(db.prepare('SELECT case_id, count FROM keys WHERE user_id = ?').all(id).map((r) => [r.case_id, r.count]));
  return { db, g, call, mk, keys };
}

test('late rewards: rule — level < 10 unchanged, keys never dearer than the money they replace', () => {
  for (const a of S.ACHIEVEMENTS) a.rewards.forEach((rw, i) => {
    assert.deepEqual(S.achLate(rw, i, 9), S.achReward(rw), `${a.key}:${i} at level 9`);
    for (const lvl of [10, 12, 25, 50, 80]) {
      const r = S.achReward(rw), L = S.achLate(rw, i, lvl);
      const extra = L.lateKey ? L.lateKey.count : (L.count || 0) - (r.count || 0) * (L.caseId === r.caseId ? 1 : 0);
      if (!extra && !L.lateKey) { assert.equal(L.money, r.money); continue; }
      const k = L.lateKey || { caseId: L.caseId, count: L.count - (r.count || 1) };
      const ladder = ['rust', 'city', 'tuning', 'sport'];
      assert.ok(ladder.indexOf(k.caseId) <= ladder.indexOf(S.goalKey(lvl)), 'never above the goal key');
      assert.ok(k.count <= S.ACH_LATE_KEYS[i]);
      assert.ok(L.money <= r.money * 0.2 + 100);
      const cs = S.CASE_BY_ID[k.caseId];
      assert.ok(k.count * Math.max(cs.price, cs.sellEv) <= r.money * 0.8 + 1, `${a.key}:${i} lvl ${lvl}: keys ≤ the money cut`);
    }
  });
  assert.equal(S.lateMoney(5000, 50, 1).money, 5000, 'a small sum stays money');
});

test('late rewards: achievement claim at level 30 pays the cut + tuning keys; level 9 the old way', () => {
  const { call, mk, keys } = setup();
  mk(1, 30);
  mk(2, 9);
  // «Ветеран» 10 000 / 60 000 / 500 000 / 2 500 000 at level 30: bronze and silver stay money (too small for a key),
  // gold → 100 000 + 1 «Міський» (a step down: a «Тюнінг» key is dearer than 400 000), diamond → 500 000 + 2 «Тюнінг».
  const r30 = call(1, 'ach/claim', { key: 'level' });
  assert.equal(r30.tiers, 4);
  assert.equal(r30.got, 10000 + 60000 + 100000 + 500000);
  assert.deepEqual(r30.keys, [{ caseId: 'city', count: 1 }, { caseId: 'tuning', count: 2 }]);
  assert.equal(keys(1).tuning, 2);
  assert.match(r30.text, /2 × ключ «Тюнінг-ательє»/);
  const r9 = call(2, 'ach/claim', { key: 'level' });
  assert.equal(r9.got, 10000);
  assert.equal(keys(2).tuning, undefined);
  // A dear tier at level 12: secrets bronze 1 M → 200 000 + 1 «Міський» (300 000 ≤ 800 000).
  const out = S.achLate(1000000, 0, 12);
  assert.deepEqual(out, { money: 200000, lateKey: { caseId: 'city', count: 1 } });
  assert.match(S.achRewardText(out), /ключ «Міський»/);
});

test('late rewards: collection milestone and «Забрати все» at level 12 give keys in reveal', () => {
  const { db, call, mk, keys } = setup();
  mk(1, 12);
  const models = S.ALL_MODELS.filter((m) => !m.secret && !m.season).slice(0, 45);
  const ins = db.prepare('INSERT OR IGNORE INTO collection (user_id, model) VALUES (1, ?)');
  for (const m of models) ins.run(m.id);
  const pulse = call(1, 'pulse').claims.filter((c) => c.kind === 'coll');
  const n45 = pulse.find((c) => c.id === 'n45');
  assert.equal(n45.money, 220000); // 1.1 M × 0.2
  assert.match(n45.sub, /ключ «Міський»/);
  const bal = db.prepare('SELECT balance FROM users WHERE id = 1').get().balance;
  const all = call(1, 'rewards/all');
  const expMoney = S.COLLECTION_MILESTONES.filter((m) => m.n <= 45).reduce((s, m) => s + S.lateMoney(m.money, 12, S.milestoneLateKeys(m)).money, 0);
  const got = db.prepare('SELECT balance FROM users WHERE id = 1').get().balance - bal;
  assert.ok(got >= expMoney, 'collection money at least the cut sums (other rewards may add)');
  const k = all.reveal.filter((x) => x.kind === 'key' && x.title === 'Нагорода за колекцію');
  assert.ok(k.length >= 1);
  assert.ok(k.every((x) => x.caseId === 'city' || x.caseId === 'rust'), 'the level-12 key or a step down');
  assert.ok((keys(1).city || 0) >= 1);
});

test('late rewards: country collection at level 9 pays the full sum, at 10+ the cut and two keys', () => {
  const { db, call, mk, keys } = setup();
  const c = 'UA', need = S.countryNeed(c);
  for (const [id, level] of [[1, 9], [2, 25]]) {
    mk(id, level);
    const ins = db.prepare('INSERT OR IGNORE INTO collection (user_id, model) VALUES (?, ?)');
    for (const m of need) ins.run(id, m.id);
  }
  const r1 = call(1, 'collection/claim', { key: 'c' + c });
  assert.equal(r1.reward.money, S.COUNTRY_REWARD[c]);
  assert.equal(r1.reward.keys, undefined);
  const r2 = call(2, 'collection/claim', { key: 'c' + c });
  assert.equal(r2.reward.money, Math.round(S.COUNTRY_REWARD[c] * 0.2 / 100) * 100);
  assert.deepEqual(r2.reward.keys, { caseId: 'tuning', count: 2 });
  assert.equal(keys(2).tuning, 2);
  assert.ok(r2.reward.secret, 'the secret car stays');
});
