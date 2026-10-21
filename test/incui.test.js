// Garage income shown = income credited: S.garageIncome (the client's per-car count for cards, tiles and the header)
// gives the same total as the server's rate and as what «Забрати» pays; cars past the slots earn nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const T0 = Date.parse('2026-10-22T08:00:00Z');
const H = 3600e3;
function setup() {
  const db = openDb(':memory:');
  let t = T0;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5 });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  return { db, g, call, advance: (ms) => (t += ms), now: () => t };
}
// Exactly what public/app.js garageInc() passes in.
const clientIncome = (me) => S.garageIncome({
  cars: me.cars.map((c) => ({ ...c, plateValue: c.plate?.value || 0, dirtAt: me.now })),
  slots: me.slots, claimed: me.claims.filter((k) => k.startsWith('set:')).map((k) => k.slice(4)), t: me.now,
  cut: !S.UNLOCK_BY_KEY.wash || me.unlocked.includes('wash'),
});
const JDM = S.SET_BY_ID.jdm;

test('shared garageIncome = server rate = what collect credits (country, set, shine, dirt, slot limit)', () => {
  const { db, g, call, advance, now } = setup();
  const u = 1;
  g.ensureUser({ id: u, first_name: 'U' });
  db.prepare('UPDATE users SET slots = 6, level = 5, level_seen = 5, cap_level = 3 WHERE id = ?').run(u);
  // 6 JDM cars (one country, set claimed), 2 cheap UA cars, 1 car on the market: 9 cars, 6 slots, 1 listed → the
  // 5 best earn, the rest show «не заробляє».
  const jdm = JDM.models.map((m) => g.giveCar(u, m).id);
  const ua = ['zaz-sens', 'vaz-2107'].map((m) => g.giveCar(u, m).id);
  const listed = g.giveCar(u, 'opel-vectra-a').id;
  db.prepare("UPDATE cars SET status = 'market' WHERE id = ?").run(listed);
  db.prepare('INSERT INTO claims (user_id, key) VALUES (?, ?)').run(u, 'set:jdm');
  db.prepare('UPDATE cars SET shine_until = ? WHERE id = ?').run(now() + 6 * H, jdm[0]);
  db.prepare('UPDATE cars SET dirt = 80, dirt_at = ? WHERE id = ?').run(now(), jdm[1]);
  db.prepare('UPDATE users SET banked = 0, income_at = ? WHERE id = ?').run(now(), u);

  const me = call(u, 'me');
  const inc = clientIncome(me);
  assert.equal(Math.round(inc.rate), me.income.rate, 'client total = server rate');
  const earning = Object.entries(inc.cars).filter(([, e]) => e.earning);
  assert.equal(earning.length, 5, 'slots 6 − 1 listed');
  assert.equal(inc.idle, 3);
  assert.ok(Math.abs(earning.reduce((s, [, e]) => s + e.rate, 0) - inc.rate) < 1e-6, 'cards add up to the header');
  for (const id of ua) assert.equal(inc.cars[id].earning, false, 'cheap cars past the slots earn nothing');
  assert.equal(inc.cars[listed], undefined);
  const e0 = inc.cars[jdm[0]];
  assert.equal(e0.country, S.COUNTRY_BONUS.income);
  assert.ok(e0.set > 0);
  assert.equal(e0.wash, 1 + S.WASH.shine);
  assert.ok(Math.abs(e0.rate - e0.clean * (1 + e0.set) * (1 + e0.country) * e0.wash) < 1e-6);
  assert.ok(inc.cars[jdm[1]].wash < 1, 'the dirty car earns less');

  // Without the dirty car's changing dirt the rate holds for 3 h: collect pays rate × 3 h.
  db.prepare('UPDATE cars SET dirt = 0, dirt_at = ? WHERE id = ?').run(now(), jdm[1]);
  const steady = clientIncome(call(u, 'me')).rate;
  db.prepare('UPDATE users SET banked = 0, income_at = ? WHERE id = ?').run(now(), u);
  advance(3 * H);
  db.prepare('UPDATE cars SET dirt = 0, dirt_at = ? WHERE owner_id = ?').run(now(), u); // dirt stays < 50%: no cut
  const got = call(u, 'collect').got;
  assert.ok(Math.abs(got - steady * 3) <= 1, `${got} vs ${steady * 3}`);

  // With dirt sliding, the rate shown now still equals the server's now.
  db.prepare('UPDATE cars SET dirt = 90, dirt_at = ? WHERE id = ?').run(now(), jdm[2]);
  advance(H);
  const me2 = call(u, 'me');
  assert.ok(Math.abs(clientIncome(me2).rate - me2.income.rate) <= 1);
});
