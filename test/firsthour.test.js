// «Перша година» (audit3 §3 №2, №3, №5, №7, №8; public/firsthour.js): one strip on top of the garage, the race car
// that doesn't stick forever, the boss wall, «точно?» before big spends, free drift training from an empty tank
// (open from level 1 on the server), and the small honesty texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as FH from '../public/firsthour.js';

const src = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('firsthour: at most one strip on top — guide > rewards > event > barn > level', () => {
  assert.deepEqual(FH.topStripPick(['level', 'barn', 'event', 'rewards']), { keep: 'rewards', hide: ['event', 'barn', 'level'] });
  assert.deepEqual(FH.topStripPick(['level', 'barn', 'event']), { keep: 'event', hide: ['barn', 'level'] });
  assert.deepEqual(FH.topStripPick(['level', 'barn']), { keep: 'barn', hide: ['level'] });
  assert.deepEqual(FH.topStripPick(['level', 'guide', 'rewards']), { keep: 'guide', hide: ['rewards', 'level'] });
  assert.deepEqual(FH.topStripPick(['level']), { keep: 'level', hide: [] });
  assert.deepEqual(FH.topStripPick([]), { keep: null, hide: [] });
});

test('firsthour: the race car — best by default, a hand pick lives while the garage is the same', () => {
  const vaz = { id: 1, et: 18.0, tank: 1 }, kopiika = { id: 2, et: 19.2, tank: 1 }, empty = { id: 3, et: 16.5, tank: 0 };
  const g = [vaz, kopiika, empty];
  // Nothing picked: a car that can go first, then the fastest.
  assert.equal(FH.raceCarChoice(g).id, 1);
  assert.equal(FH.raceCarChoice(g).picked, false);
  // Picked by hand in this session: kept while the garage keeps the same cars.
  const sig = FH.garageSig(g);
  assert.deepEqual(FH.raceCarChoice(g, { picked: 2, pickedSig: sig }), { id: 2, picked: true, sig });
  // A new (faster) car arrives: the pick is dropped and the new best car is the default — no sticking forever.
  const bmw = { id: 9, et: 15.1, tank: 1 }, g2 = [...g, bmw];
  assert.equal(FH.raceCarChoice(g2, { picked: 2, pickedSig: sig }).id, 9);
  assert.equal(FH.raceCarChoice(g2, { picked: 2, pickedSig: sig, saved: { id: 2, sig } }).id, 9); // nor from the browser
  // After a restart with the same garage the saved pick is back; a sold picked car falls back to the best.
  assert.equal(FH.raceCarChoice(g, { saved: { id: 2, sig } }).id, 2);
  assert.equal(FH.raceCarChoice([vaz, empty], { picked: 2, pickedSig: sig }).id, 1);
  // The signature ignores order.
  assert.equal(FH.garageSig([kopiika, vaz]), FH.garageSig([vaz, kopiika]));
  // app.js: automatic picks are never saved (only markRaceCarPick writes the pref), the old forever-pref is gone.
  const app = src('app.js');
  assert.ok(!/prefSet\('raceCar', state\.raceCar\)/.test(app));
  assert.ok(!/prefSet\('raceCar', alt\.id\)/.test(app));
  assert.equal((app.match(/prefSet\('raceCar'/g) || []).length, 1);
});

test('firsthour: boss wall — under 10% (open, fitting, not beaten) the card says what to do and the fight asks first', () => {
  assert.equal(FH.bossWall({ open: true, fits: true, chance: 0 }), true);
  assert.equal(FH.bossWall({ open: true, fits: true, chance: 9 }), true);
  assert.equal(FH.bossWall({ open: true, fits: true, chance: 10 }), false);
  assert.equal(FH.bossWall({ open: true, fits: true, chance: 0, beaten: true }), false); // a rematch is a choice
  assert.equal(FH.bossWall({ open: true, fits: false, chance: 0 }), false); // wrong class has its own hint
  assert.equal(FH.bossWall({ open: false, fits: true, chance: 0 }), false);
  assert.equal(FH.bossWall({ open: true, fits: true, chance: null }), false);
  const app = src('app.js');
  assert.match(app, /H\.startBossRisky = async/);
  assert.match(app, /bossWall\(s\) \? bossWallHelp\(b, s, car\) \+ bossRiskyBtn\(b, s\)/);
});

test('firsthour: «точно?» for spends ≥ 10 млн or ≥ 20% of the balance; trophies and restyles always ask', () => {
  assert.equal(FH.bigSpend(10e6, 1e9), true);
  assert.equal(FH.bigSpend(9.9e6, 1e9), false);
  assert.equal(FH.bigSpend(200e3, 1e6), true);
  assert.equal(FH.bigSpend(199e3, 1e6), false);
  assert.equal(FH.bigSpend(50e3, 100e3), false); // pocket money never asks
  const pr = src('prestige-ui.js');
  assert.match(pr, /H\.prTrophy = async \(d, el\) => \{\n\s+if \(!\(await spendConfirm\(\{[^\n]*force: true/);
  assert.match(pr, /spendConfirm\(\{ title: `Рестайлінг[^\n]*force: true/);
  assert.match(src('barn-ui.js'), /spendConfirm\(\{ title: `\$\{S\.MODELS\[f\.model\]\.name\}: етап/);
});

test('firsthour: free drift training from level 1 with an empty tank (no fuel, no unlock leak); paid drift stays locked', () => {
  const T0 = Date.parse('2026-10-30T10:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => T0, notify: () => {}, random: () => 0.5, admins: [1] });
  g.ensureUser({ id: 7, first_name: 'Н' });
  const call = (name, body = {}) => g.api[name](7, body);
  call('case/open', { caseId: 'starter' });
  const car = call('me').cars[0];
  db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = 7').run(T0);
  assert.equal(call('me').level, 1);
  const r = call('drift/start', { carId: car.id, rival: 'train' });
  assert.equal(r.rival.training, true);
  assert.equal(r.rival.entry, 0);
  assert.equal(call('me').fuel, 0);
  assert.deepEqual(call('me').unlocked, []);
  assert.throws(() => call('drift/start', { carId: car.id, rival: 'easy' }), /відкриється на рівні 2/);
  assert.throws(() => call('drift/rivals', { carId: car.id }), /відкриється на рівні 2/);
  // The client lets the training through with 0 fuel and offers it on the empty-tank card.
  const app = src('app.js');
  assert.match(app, /if \(d\.rival !== 'train' && fuelNow\(\) < 1\) return fuelNudge\(\)/);
  assert.match(app, /data-act="fuelTrain"/);
});

test('firsthour: texts — origin by era, fragment rule names the collection price, neutral Halloween line, counter casing', () => {
  const M = (id) => S.ALL_MODELS.find((m) => m.id === id);
  assert.equal(FH.sovietEra(M('vaz-2114')), false);
  assert.equal(FH.sovietEra(M('lada-priora')), false);
  assert.equal(FH.sovietEra(M('vaz-2101-kopiika')), true);
  assert.equal(FH.sovietEra(M('haz-21-volha')), true);
  const app = src('app.js');
  assert.match(app, /const isSoviet = \(m\) => SOVIET_RE\.test\(m\.name\) && sovietEra\(m\)/);
  assert.ok(!/SOVIET_RE\.test\(m\.name\) \?/.test(app));
  // The server gives a fragment when the model's collection price is under the case price — the text says exactly that.
  assert.match(fs.readFileSync(new URL('../src/game.js', import.meta.url), 'utf8'), /S\.MODELS\[model\]\.price < price/);
  assert.match(app, /колекційна ціна нижча за ціну кейсу/);
  assert.ok(!app.includes('Кожна машина дешевша за кейс'));
  assert.ok(!src('halloween-ui.js').includes('адміністрацією'));
  assert.match(src('style.css'), /\.rvl-n \{ text-transform: none;/);
});
