// «Війна районів» while it is «Скоро» (owner 03.11, play-report №4): the demo map belongs only to made-up clubs; the
// player's own club is never drawn as an owner, even when his club's name or tag matches a demo club.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warDemo, DEMO_CLUBS, DISTRICTS, WAR_LIVE } from '../public/war-demo.js';

const owners = (v) => v.districts.filter((d) => d.club).map((d) => d.club.name);

test('war map before the launch (r4-ux): every district free — no club, no contest, no legend; the player\'s club changes nothing', () => {
  assert.equal(WAR_LIVE, false);
  for (const mine of [null, { tag: 'ВОВК', name: 'Сірі вовки' }, { tag: 'ЖИГА', name: 'Жигулі' }]) {
    const v = warDemo(mine);
    assert.equal(v.districts.length, DISTRICTS.length);
    assert.ok(v.districts.every((d) => d.free && !d.club && !d.fight), JSON.stringify(mine));
    assert.deepEqual(v.legend, []);
  }
});

test('war demo (preview, live): only made-up clubs, none in the game yellow or the generic club emblem', () => {
  const v = warDemo(null, { live: true });
  assert.equal(v.districts.length, DISTRICTS.length);
  const demo = Object.values(DEMO_CLUBS).map((c) => c.name);
  for (const n of owners(v)) assert.ok(demo.includes(n), n);
  for (const c of Object.values(DEMO_CLUBS)) {
    assert.notEqual(c.c.toLowerCase(), '#ffd400', `${c.name}: the yellow is the player's own UI colour`);
    assert.notEqual(c.e, 0, `${c.name}: e0 is the emblem of «Автоклуби» itself`);
  }
  assert.equal(v.legend.reduce((a, [, n]) => a + n, 0), owners(v).length, 'the legend counts what the map shows');
  assert.ok(v.districts.some((d) => d.fight), 'one contested district stays in the demo');
});

test('war demo: the player\'s club is never an owner — a matching demo club leaves its districts neutral', () => {
  for (const c of Object.values(DEMO_CLUBS)) {
    for (const mine of [{ tag: c.tag, name: 'Інша назва' }, { tag: 'ZZZZ', name: c.name }, { tag: 'ZZZZ', name: ` ${c.name.toUpperCase()} ` }, { tag: 'ZZZZ', name: c.short }]) {
      const v = warDemo(mine, { live: true });
      assert.ok(!owners(v).includes(c.name), `${c.name} still owns a district for ${JSON.stringify(mine)}`);
      assert.ok(!v.legend.some(([cl]) => cl.name === c.name));
      for (const d of v.districts) if (d.fight) assert.ok(![d.c, d.c2].includes(c.c), 'not a claimant either');
    }
  }
  // A club with another name changes nothing.
  assert.deepEqual(owners(warDemo({ tag: 'ЖИГА', name: 'Жигулі назавжди' }, { live: true })), owners(warDemo(null, { live: true })));
});
