// Physics 22.10 (owner: «як я програв, коли стільки сил маю»): factory tyres per model, power above the grip still
// counts, and a lost race with more power says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/shared.js';

const byName = (n) => S.ALL_MODELS.find((m) => m.name === n && !m.secret).id;
const kit = (id, t) => Object.fromEntries(S.partKeysOf(id).map((k) => [k, t]));
const hale = (pw) => 5.825 * Math.cbrt(2.2046 / pw);
const regular = S.ALL_MODELS.filter((m) => !m.secret);

test('physics: monotone — more power, more grip or less weight is never slower', () => {
  const r = S.seededRand(5);
  for (let i = 0; i < 3000; i++) {
    const hp = 50 + r() * 4000, kg = 800 + r() * 2000, g = 0.35 + r() * 0.9;
    const t = S.raceBaseTime(hp, kg, g);
    assert.ok(S.raceBaseTime(hp * 1.05, kg, g) < t + 1e-12, 'power');
    assert.ok(S.raceBaseTime(hp, kg, g + 0.05) <= t + 1e-12, 'grip');
    assert.ok(S.raceBaseTime(hp, kg * 0.97, g) < t + 1e-12, 'weight');
  }
});

test('physics: D and C cars are as before (factory tyres 0.35 hold their power); faster stock cars are those with more hp/kg', () => {
  for (const m of regular.filter((x) => x.cls === 'D' || x.cls === 'C')) {
    assert.equal(S.tyreGrip(m.id), 0.35, m.name);
    assert.equal(S.carStats({ model: m.id }).base, Math.round(hale(m.hp / m.kg) * 1000) / 1000, m.name);
  }
  const l = regular.map((m) => ({ pw: m.hp / m.kg, t: S.carStats({ model: m.id }).base })).sort((a, b) => a.pw - b.pw);
  for (let i = 1; i < l.length; i++) assert.ok(l[i].t <= l[i - 1].t + 1e-9, 'stock order follows hp/kg');
  // A hypercar leaves the factory on better tyres than a Lada, and still spins a little.
  const evija = byName('Lotus Evija');
  assert.ok(S.tyreGrip(evija) > 0.6 && S.tyreGrip(byName('ВАЗ-2107')) === 0.35);
  assert.ok(S.carStats({ model: evija }).slip > 0.3);
});

test('physics: at the top power keeps mattering — no common ceiling for race-kitted hypercars; grip parts still pay', () => {
  const t = (n) => S.carStats({ model: byName(n), parts: kit(byName(n), 'race') }).base;
  assert.ok(t('SSC Tuatara') < t('Lotus Evija') - 0.2 && t('Lotus Evija') < t('Ferrari SF90 Stradale') - 0.5);
  const ev = byName('Lotus Evija');
  const grip = S.carStats({ model: ev, parts: { suspension: 'race', wheels: 'race' } }).base;
  assert.ok(S.carStats({ model: ev }).base - grip > 0.4, 'grip parts on a stock hypercar');
});

test('physics: the two owner cases — a tuned 2608 hp Tuatara outruns «Шериф»; a stock Evija loses to the Race-kitted P1 of «Король Лондона» and is told why', () => {
  const sheriff = S.BOSS_BY_ID['us-sheriff'], king = S.BOSS_BY_ID['gb-king'];
  const tuatara = { model: byName('SSC Tuatara'), parts: { eng: 'race', turbo: 'race', exhaust: 'race' } };
  assert.equal(S.carStats(tuatara).hp, 2608);
  assert.ok(S.carStats(tuatara).base < sheriff.base - 1, `${S.carStats(tuatara).base} vs ${sheriff.base}`);
  assert.deepEqual(S.raceWhy(tuatara, { model: sheriff.model, parts: S.bossParts(sheriff) }, { time: 8, rivalTime: 7.9 }).length, 1);
  assert.match(S.raceWhy(tuatara, { model: sheriff.model, parts: S.bossParts(sheriff) }, { time: 8, rivalTime: 7.9 })[0], /старті й передачах/);
  const evija = { model: byName('Lotus Evija'), parts: {} };
  const why = S.raceWhy(evija, { model: king.model, parts: S.bossParts(king) }, { time: 8.1, rivalTime: 7.8 });
  assert.equal(why.length, 2);
  assert.ok(why.some((x) => /тюнінгу Race \(1433 к\.с\. замість 916/.test(x)), why.join(' / '));
  assert.ok(why.some((x) => /Колеса буксували — втрачено \d,\d\d с\. Шини й підвіска Race/.test(x)), why.join(' / '));
  // With Race tyres and suspension the same Evija is faster than the boss car.
  assert.ok(S.carStats({ ...evija, parts: { suspension: 'race', wheels: 'race' } }).base < king.base);
  // Nothing to explain after a win or with less power.
  assert.deepEqual(S.raceWhy(evija, { model: king.model, parts: S.bossParts(king) }, { time: 7.7, rivalTime: 7.8 }), []);
  assert.deepEqual(S.raceWhy({ model: byName('ВАЗ-2107'), parts: {} }, { model: king.model, parts: {} }, { time: 20, rivalTime: 9 }), []);
});
