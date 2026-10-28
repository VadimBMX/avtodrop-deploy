// popups (night 28.10, wave N3; crit4 §3 №5): one self-opening window per app entry, by priority; the rest wait for
// the next entry (their «show once» keys untouched) or turn into a toast / banner. Garage diet (№4): the dream card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPopups, POP_PRI, NEW_ENTRY_MS } from '../public/popups.js';

// A hand-driven clock: timers run only when the test says so.
function harness({ calm = true, idle = true } = {}) {
  const env = { calm, idle, t: 0, timers: [], shown: [], lost: [] };
  env.pop = createPopups({
    calm: () => env.calm,
    idle: () => env.idle,
    now: () => env.t,
    later: (f, ms) => env.timers.push({ f, at: env.t + ms }),
  });
  env.run = (ms = 10000) => {
    env.t += ms;
    for (let guard = 0; guard < 50; guard++) {
      const due = env.timers.filter((x) => x.at <= env.t);
      if (!due.length) break;
      env.timers = env.timers.filter((x) => x.at > env.t);
      due.forEach((x) => x.f());
    }
  };
  env.offer = (kind, opts = {}) => env.pop.offer(kind, () => (opts.nothing ? false : (env.shown.push(kind), (env.idle = false), true)), () => env.lost.push(kind));
  env.close = () => (env.idle = true);
  return env;
}

test('popups: the mid player on entry — «Що нового», «Нагороди», «Бета-тест» and a bug-reward gift → only the gift', () => {
  const e = harness();
  assert.equal(e.offer('whatsnew'), 'queued');
  assert.equal(e.offer('rewards'), 'queued');
  assert.equal(e.offer('gift'), 'queued');
  e.pop.ready();
  assert.deepEqual(e.shown, ['gift']);
  // the beta-test ask comes 6 s later: not this entry
  assert.equal(e.offer('bugask'), 'denied');
  e.close();
  e.run(1000);
  assert.deepEqual(e.lost.sort(), ['rewards', 'whatsnew'], 'the losers are told (daily → its banner) once the screen is idle');
  e.pop.touch();
  assert.equal(e.offer('whatsnew'), 'denied', 'after the entry: announcements wait for the next entry');
  assert.deepEqual(e.shown, ['gift']);
});

test('popups: priority order — gift > level-up > what’s new (event) > daily rewards > beta test > home screen', () => {
  const order = Object.entries(POP_PRI).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  assert.deepEqual(order, ['gift', 'level', 'fueldeal', 'whatsnew', 'rewards', 'packoffer', 'bugask', 'homeask']);
  for (const [kinds, win] of [[['rewards', 'level', 'bugask'], 'level'], [['rewards', 'whatsnew'], 'whatsnew'], [['homeask', 'bugask'], 'bugask']]) {
    const e = harness();
    kinds.forEach((k) => e.offer(k));
    e.pop.ready();
    assert.deepEqual(e.shown, [win]);
  }
});

test('popups: nothing while not calm (race, case opening, first steps) — the choice waits, then shows one', () => {
  const e = harness({ calm: false });
  e.offer('rewards');
  e.offer('level');
  e.pop.ready();
  e.run(5000);
  assert.deepEqual(e.shown, []);
  e.calm = true;
  e.run(2000);
  assert.deepEqual(e.shown, ['level']);
});

test('popups: the fallback timer decides when the first pulse never comes back', () => {
  const e = harness();
  e.offer('whatsnew');
  e.run(6000);
  assert.deepEqual(e.shown, ['whatsnew']);
});

test('popups: nothing offered at the start — the first later offer takes the slot, the next one waits', () => {
  const e = harness();
  e.pop.ready();
  assert.equal(e.offer('bugask'), 'shown');
  assert.equal(e.offer('homeask'), 'denied');
});

test('popups: the entry window may come back (a gift closed by a tap outside), others may not', () => {
  const e = harness();
  e.offer('gift');
  e.pop.ready();
  e.close();
  assert.equal(e.offer('gift'), 'shown');
  assert.equal(e.offer('level'), 'denied');
});

test('popups: after the entry, the play still opens its windows (a level-up after a race, an admin gift) when calm', () => {
  const e = harness();
  e.offer('rewards');
  e.pop.ready();
  e.close();
  e.pop.touch(); // the player went on
  assert.equal(e.offer('level'), 'shown');
  e.close();
  e.calm = false;
  assert.equal(e.offer('gift'), 'busy');
  e.calm = true;
  assert.equal(e.offer('gift'), 'shown');
  assert.equal(e.offer('homeask'), 'denied');
});

test('popups: the closing tap does not end the entry (the window is still open at that moment)', () => {
  const e = harness();
  e.offer('whatsnew');
  e.pop.ready();
  e.pop.touch(); // idle is false: the story is on
  assert.equal(e.pop.state().over, false);
  e.close();
  e.pop.touch();
  assert.equal(e.pop.state().over, true);
});

test('popups: a show with nothing left to show (level already seen) leaves the slot to the next one', () => {
  const e = harness();
  e.offer('level', { nothing: true });
  e.offer('rewards');
  e.pop.ready();
  assert.deepEqual(e.shown, ['rewards']);
  assert.deepEqual(e.lost, []);
});

test('popups: back after a long time in the background is a new entry; a short switch is not', () => {
  const e = harness();
  e.offer('rewards');
  e.pop.ready();
  e.close();
  e.pop.touch();
  e.pop.visibility(true);
  e.t += 60e3;
  e.pop.visibility(false);
  assert.equal(e.offer('whatsnew'), 'denied');
  e.pop.visibility(true);
  e.t += NEW_ENTRY_MS;
  e.pop.visibility(false);
  assert.equal(e.offer('whatsnew'), 'queued');
  e.run(6000);
  assert.deepEqual(e.shown, ['rewards', 'whatsnew']);
});

// The wiring in app.js: every self-opening window goes through POP, and its «seen» key is set only inside the show.
test('popups: app.js routes every self-opening window through POP; keys are set only when shown', () => {
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const k of ['gift', 'level', 'whatsnew', 'rewards', 'bugask', 'homeask']) assert.ok(src.includes(`POP.offer('${k}'`), k);
  assert.ok(!/setTimeout\(\(\) => \{\s*if \(me\.level > me\.levelSeen[^]*?showLevelUp\(\)/.test(src), 'no direct level-up timers left');
  assert.ok(/POP\.offer\('bugask', \(\) => \{\s*try \{\s*localStorage\.setItem\(BUG_ASK_KEY/.test(src), 'beta-test key inside the show');
  assert.ok(/POP\.offer\('homeask', \(\) => \{\s*try \{\s*localStorage\.setItem\(HOME_ASK_KEY/.test(src), 'home-screen key inside the show');
  assert.ok(!/else if \(story === 'whatsnew'\) whatsNew\(\)/.test(src), 'what’s new goes through POP');
});
