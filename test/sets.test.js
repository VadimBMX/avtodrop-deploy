import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const T0 = Date.parse('2026-10-14T10:00:00Z');
function setup() {
  const db = openDb(':memory:');
  const clock = { t: T0 };
  const g = createGame(db, { now: () => clock.t, random: () => 0.5 });
  const mk = (id) => (g.ensureUser({ id, username: 'u' + id, first_name: 'U' + id }), id);
  const found = (id, models) => { for (const m of models) db.prepare('INSERT OR IGNORE INTO collection (user_id, model, at) VALUES (?, ?, ?)').run(id, m, clock.t); };
  const keys = (id, caseId) => db.prepare('SELECT count FROM keys WHERE user_id = ? AND case_id = ?').get(id, caseId)?.count || 0;
  const frags = (id, caseId) => db.prepare('SELECT count FROM fragments WHERE user_id = ? AND case_id = ?').get(id, caseId)?.count || 0;
  const parts = (id) => db.prepare('SELECT COALESCE(SUM(count), 0) n FROM parts WHERE user_id = ?').get(id).n;
  const balance = (id) => db.prepare('SELECT balance FROM users WHERE id = ?').get(id).balance;
  return { db, g, clock, mk, found, keys, frags, parts, balance };
}

test('set definitions: 12–20 sets of 4–8 existing, regular, distinct models; valid tiers, icons and rewards', () => {
  assert.ok(S.SETS.length >= 12 && S.SETS.length <= 20, `${S.SETS.length} sets`);
  assert.equal(new Set(S.SETS.map((s) => s.id)).size, S.SETS.length);
  const icons = new Set([...readFileSync(new URL('../public/icons.svg', import.meta.url), 'utf8').matchAll(/id="i-([a-z0-9-]+)"/g)].map((m) => m[1]));
  for (const s of S.SETS) {
    assert.ok(s.models.length >= 4 && s.models.length <= 8, s.id);
    assert.equal(new Set(s.models).size, s.models.length, `${s.id}: duplicate model`);
    for (const id of s.models) {
      const m = S.MODELS[id];
      assert.ok(m, `${s.id}: unknown model ${id}`);
      assert.ok(!m.secret, `${s.id}: ${id} is a secret/season car (never drops)`);
      assert.ok(S.CASES.some((cs) => !cs.starter && cs.pool(m.cls).some((x) => x.id === id) && cs.weights[m.cls]), `${s.id}: ${id} drops from no case`);
    }
    assert.ok(S.SET_TIERS[s.tier], s.id);
    const r = S.setReward(s);
    assert.ok(S.CASE_BY_ID[r.caseId] && S.TIER_BY_ID[r.tier], s.id);
    assert.ok(!('money' in r), 'set rewards are never cash');
    assert.ok(s.name && s.text, s.id);
    assert.ok(icons.has(s.icon), `${s.id}: no icon ${s.icon} in icons.svg`);
  }
  // Most sets mix countries; JDM, Soviet, German, muscle and China are one-country themes by nature.
  const mono = S.SETS.filter((s) => new Set(s.models.map((id) => S.MODELS[id].country)).size === 1).map((s) => s.id).sort();
  assert.deepEqual(mono, ['china', 'german', 'jdm', 'muscle', 'soviet']);
});

test('set rewards stay small next to the collection milestones', () => {
  const total = S.SETS.reduce((a, s) => a + S.setRewardValue(s), 0);
  const milestones = S.COLLECTION_MILESTONES.reduce((a, m) => a + m.money, 0);
  assert.ok(total < milestones * 0.6, `sets ${total} vs milestones ${milestones}`);
  assert.ok(total < S.COLLECTION_MILESTONES.at(-1).money, 'all sets together are worth less than the «Уся колекція» milestone');
  // Harder tiers pay more, and the income bonus stays at 1–2%.
  for (let i = 1; i < S.SET_TIERS.length; i++) assert.ok(S.setRewardValue({ tier: i }) > S.setRewardValue({ tier: i - 1 }));
  for (const t of S.SET_TIERS) assert.ok(t.income > 0 && t.income <= 0.02);
});

test('progress counts models ever found (the collection), not cars owned now', () => {
  const { g, mk, found, db } = setup();
  const id = mk(201);
  const jdm = S.SET_BY_ID.jdm;
  found(id, jdm.models.slice(0, 3));
  let st = g.api.sets(id).list.find((x) => x.id === 'jdm');
  assert.equal(st.have, 3);
  assert.equal(st.need, jdm.models.length);
  assert.equal(st.ready, false);
  // A car that was found and then sold still counts.
  db.prepare("DELETE FROM cars WHERE owner_id = ?").run(id);
  found(id, jdm.models.slice(3));
  st = g.api.sets(id).list.find((x) => x.id === 'jdm');
  assert.equal(st.have, st.need);
  assert.equal(st.ready, true);
  assert.equal(st.claimed, false);
  // A car bought from another player is not found: owning it without a collection row doesn't count.
  const other = mk(202);
  db.prepare('INSERT INTO cars (owner_id, model, tank, tank_at, created_at) VALUES (?, ?, 5, 0, 0)').run(other, jdm.models[0]);
  assert.equal(g.api.sets(other).list.find((x) => x.id === 'jdm').have, 0);
});

test('claim: not before the set is complete; then once — keys, parts, badge, banner gone; never cash', () => {
  const { g, mk, found, keys, parts, balance, db } = setup();
  const id = mk(203);
  const set = S.SET_BY_ID.german; // silver: a «Тюнінг-ательє» key + 2 Sport parts
  const r = S.setReward(set);
  found(id, set.models.slice(1));
  assert.throws(() => g.api['sets/claim'](id, { id: 'german' }), /Ще не зібрано/);
  assert.throws(() => g.api['sets/claim'](id, { id: 'nope' }), /Невідомий сет/);
  assert.throws(() => g.api['sets/claim'](id, { id: 'constructor' }), /Невідомий сет/);
  found(id, set.models);
  assert.ok(g.api.pulse(id).claims.some((c) => c.kind === 'set' && c.id === 'german'));
  const k0 = keys(id, r.caseId), p0 = parts(id), b0 = balance(id);
  const res = g.api['sets/claim'](id, { id: 'german' });
  assert.equal(res.reward.keys, r.count);
  assert.equal(res.reward.items.length, r.parts);
  assert.ok(res.reward.items.every((it) => it.tier === r.tier));
  assert.equal(keys(id, r.caseId), k0 + r.count);
  assert.equal(parts(id), p0 + r.parts);
  assert.equal(balance(id), b0, 'no money');
  const badge = db.prepare("SELECT * FROM badges WHERE user_id = ? AND key = 'set:german'").get(id);
  assert.equal(badge.title, S.setBadgeTitle(set));
  assert.equal(badge.tier, set.tier);
  assert.ok(g.api.me(id).badges.some((b) => b.key === 'set:german'));
  assert.ok(g.api.player(id, { id }).badges.some((b) => b.key === 'set:german'), 'shown on the player card');
  // Second claim pays nothing.
  assert.throws(() => g.api['sets/claim'](id, { id: 'german' }), /вже отримано/);
  assert.equal(keys(id, r.caseId), k0 + r.count);
  assert.equal(parts(id), p0 + r.parts);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM claims WHERE user_id = ? AND key = 'set:german'").get(id).n, 1);
  const st = g.api.sets(id).list.find((x) => x.id === 'german');
  assert.equal(st.claimed, true);
  assert.equal(st.ready, false);
  assert.ok(!g.api.pulse(id).claims.some((c) => c.kind === 'set' && c.id === 'german'));
});

test('bronze sets pay key fragments (a full set of 8 turns into a key)', () => {
  const { g, mk, found, keys, frags } = setup();
  const id = mk(204);
  const r = S.setReward(S.SET_BY_ID.soviet);
  assert.ok(r.frag && !r.count);
  found(id, S.SET_BY_ID.soviet.models);
  found(id, S.SET_BY_ID.people.models);
  const a = g.api['sets/claim'](id, { id: 'soviet' });
  assert.equal(a.reward.frag, r.frag);
  assert.equal(frags(id, r.caseId), r.frag % S.FRAGMENTS_PER_KEY);
  const b = g.api['sets/claim'](id, { id: 'people' });
  assert.equal(b.reward.newKeys, Math.floor((2 * r.frag) / S.FRAGMENTS_PER_KEY));
  assert.equal(keys(id, r.caseId), Math.floor((2 * r.frag) / S.FRAGMENTS_PER_KEY));
  assert.equal(frags(id, r.caseId), (2 * r.frag) % S.FRAGMENTS_PER_KEY);
});

test('claimed set: its cars earn the tier bonus; other cars and unclaimed sets do not', () => {
  const { g, mk, found, db, clock } = setup();
  const id = mk(205);
  db.prepare('UPDATE users SET slots = 40 WHERE id = ?').run(id);
  db.prepare('DELETE FROM cars WHERE owner_id = ?').run(id);
  const set = S.SET_BY_ID.jdm;
  const add = (m) => db.prepare("INSERT INTO cars (owner_id, model, tank, tank_at, created_at) VALUES (?, ?, 5, 0, 0)").run(id, m);
  add(set.models[0]); // in the set
  add('toyota-corolla-e120'); // not in it (another country, so the country bonus stays off)
  const rate = () => g.api.me(id).income.rate; // rounded to whole hryvnias
  const base = rate();
  assert.ok(base > 0);
  found(id, set.models);
  assert.equal(rate(), base, 'nothing before the claim');
  g.api['sets/claim'](id, { id: 'jdm' });
  const inc = S.carIncomeOf({ model: set.models[0], parts: {} });
  assert.ok(Math.abs(rate() - (base + inc * S.setIncome(set))) <= 1,`${rate()} vs ${base} + ${inc * S.setIncome(set)}`);
  // Bonuses of several sets with the same car don't add up: the largest counts.
  assert.equal(S.setIncomeBonus('mazda-rx-7-fd', ['jdm', 'drift', 'nineties']), 0.01);
  assert.equal(S.setIncomeBonus('vaz-2121-nyva', ['soviet', 'offroad']), 0.02);
  assert.equal(S.setIncomeBonus('vaz-2121-nyva', []), 0);
  void clock;
});
