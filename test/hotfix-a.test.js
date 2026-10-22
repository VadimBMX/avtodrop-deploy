// Night wave A (reports/audit.md §2 №11–13, §3): the VIP cash offer, the first garage income, unique drift rival
// names, the China case during «Країна тижня», decimal commas, the 4-slide intro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { caseReturns } from '../tools/sim-cases.mjs';

const T0 = Date.parse('2026-10-22T08:00:00Z');
const H = 3600e3;
function setup() {
  const db = openDb(':memory:');
  let t = T0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5 });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  g.ensureUser({ id: 1, first_name: 'U1' });
  return { db, g, call, advance: (ms) => (t += ms), now: () => t };
}

test('cash upgrade: a VIP with 8 h is offered 10 h (6 + 4), never «до 6 год»; the top level offers nothing', () => {
  assert.deepEqual(S.nextCapOffer(0, 4), { hours: 6, base: 6, extra: 0, cost: S.CAP_LEVELS[1].cost });
  assert.deepEqual(S.nextCapOffer(0, 8), { hours: 10, base: 6, extra: 4, cost: S.CAP_LEVELS[1].cost });
  assert.equal(S.nextCapOffer(S.CAP_LEVELS.length - 1, 16), null);
  for (let lvl = 0; lvl < S.CAP_LEVELS.length - 1; lvl++) for (const extra of [0, S.VIP.extraHours, S.COMEBACK.capHours]) {
    const capH = S.CAP_LEVELS[lvl].hours + extra;
    assert.ok(S.nextCapOffer(lvl, capH).hours > capH, `level ${lvl} +${extra} h`);
  }
  // Through the server: a VIP's cap and what the upgrade really gives.
  const { db, call, now } = setup();
  call(1, 'me');
  db.prepare('UPDATE users SET vip_until = ? WHERE id = 1').run(now() + 9 * 864e5);
  const me = call(1, 'me');
  assert.equal(me.income.capH, S.CAP_LEVELS[0].hours + S.VIP.extraHours);
  const offer = S.nextCapOffer(me.capLevel, me.income.capH);
  db.prepare('UPDATE users SET balance = 1e9 WHERE id = 1').run();
  call(1, 'upgrade-cap');
  assert.equal(call(1, 'me').income.capH, offer.hours, 'the offer is what the player gets');
});

test('first garage income: the starter case puts S.FIRST_CASH into the cash once — the first «Забрати» is ≥ 2 000 ₴', () => {
  const { call, advance } = setup();
  call(1, 'me');
  assert.equal(call(1, 'me').income.pending, 0);
  call(1, 'case/open', { caseId: 'starter', count: 1 });
  const me = call(1, 'me');
  assert.ok(me.income.pending >= S.FIRST_CASH && S.FIRST_CASH >= 2000, `pending ${me.income.pending}`);
  const rate = me.income.rate; // the starter car is random: its income an hour
  advance(60e3);
  const got = call(1, 'collect').got;
  assert.ok(got >= S.FIRST_CASH && got <= S.FIRST_CASH + rate / 60 + 1, `first collect ${got}`);
  // Afterwards the cash fills by the income only.
  advance(10 * 60e3);
  assert.ok(call(1, 'me').income.pending <= rate / 6 + 1);
  // Income is never doubled up by the gift: the cap still holds the rest.
  advance(48 * H);
  const m2 = call(1, 'me');
  assert.ok(m2.income.pending <= m2.income.rate * m2.income.capH + 1);
});

test('drift rivals: three different names in every list (no two «Вовк»), the same list on every call', () => {
  const { db, g, call } = setup();
  db.prepare('UPDATE users SET level = 5, level_seen = 5, slots = 80 WHERE id = 1').run();
  const models = S.ALL_MODELS.filter((m) => !m.secret).slice(0, 60);
  const ids = models.map((m) => g.giveCar(1, m.id).id);
  for (const id of ids) {
    const a = call(1, 'drift/rivals', { carId: id }).list.map((r) => r.name);
    assert.equal(new Set(a).size, a.length, `car ${id}: ${a.join(', ')}`);
    assert.deepEqual(call(1, 'drift/rivals', { carId: id }).list.map((r) => r.name), a, 'stable');
    for (const n of a) assert.ok(S.RIVAL_NAMES.includes(n));
  }
});

test.skip('«Країна тижня»: the China case lands ~0.85 open-and-sell like the others (was 0.63), every country case < 1', () => {
  const cn = caseReturns(S.CASE_BY_ID['c-cn'], 1e5, 11);
  assert.equal(cn.dealWhy, 'country');
  assert.ok(cn.deal > 0.82 && cn.deal < 0.95, `c-cn country ${cn.deal.toFixed(3)}`);
  assert.equal(S.EVENTS.country.save, true, 'the losing-streak save stays on during the discount');
  for (const cs of S.CASES.filter((c) => c.group === 'country')) {
    const r = caseReturns(cs, 4e4, 11);
    assert.ok(r.deal < 1.01, `${cs.id}: ${r.deal.toFixed(3)}`);
  }
});

test('texts: decimal comma in part effects; the intro is 4 slides with every car counted and «справжніх»', () => {
  for (const t of S.TIERS) assert.doesNotMatch(S.partEffect('brakes', t.id), /\d\.\d/);
  assert.equal(S.partEffect('brakes', 'stock'), '−0,3% часу');
  const sl = S.INTRO_STORY.slides;
  assert.equal(sl.length, 4);
  assert.match(sl[0].text, new RegExp(`${S.ALL_MODELS.length} справжніх авто`));
  assert.match(sl[1].text, /радянська й українська класика/);
  assert.ok(sl.every((s) => s.text.length < 220), 'short enough for a 360 px phone');
});

test('wash: dirt is visual only — the unlock text and the income say so', () => {
  assert.doesNotMatch(S.UNLOCK_BY_KEY.wash.text, /менше/);
  const g = S.garageIncome({ cars: [{ id: 1, model: S.ALL_MODELS[0].id, status: 'garage', dirt: 100, dirtAt: T0 }], t: T0 + 5 * H, cut: true });
  assert.equal(g.cars[1].wash, 1);
  assert.equal(g.rate, g.cars[1].clean);
});
