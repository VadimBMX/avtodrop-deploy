// wIntro 2026-10-29: animated intros — the number marker, timing limits and the reduced-motion fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { markNumber } from '../public/intro-fx.js';

const CSS = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const block = CSS.slice(CSS.indexOf('/* ===== wIntro 2026-10-29'));
const APP = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('markNumber wraps the first stand-alone number only, never dates, times or «10-го»', () => {
  assert.equal(markNumber('Збирай гараж мрії: 177 справжніх авто — 12 класів'), 'Збирай гараж мрії: <span class="st-num" data-to="177">177</span> справжніх авто — 12 класів');
  assert.equal(markNumber('Щодня о 20:00 — аукціон'), 'Щодня о 20:00 — аукціон');
  assert.equal(markNumber('з 10-го рівня, 29.10 – 2.11'), 'з 10-го рівня, 29.10 – 2.11');
  assert.match(markNumber('Драг 402 м на вибування'), /data-to="402"/);
});

test('intro entrances stay within 0.9 s and only animate transform/opacity', () => {
  assert.ok(block.length > 1000);
  // delay + duration of every entrance in the story player and the level-up sheet (loops excluded)
  const rx = /\.(?:story[^{]*|lvup[^{]*)\{ animation: (\w+) ([\d.]+)s (?:([\d.]+)s )?/g;
  for (const m of block.matchAll(rx)) {
    if (/stSweep|stRing/.test(m[1])) continue;
    assert.ok(Number(m[2]) + Number(m[3] || 0) <= 0.92, `${m[1]} ends after 0.9 s`);
  }
  for (const kf of block.matchAll(/@keyframes (\w+) \{([^@]*?)\}\s*(?=@|\n@|$)/g)) assert.doesNotMatch(kf[2], /filter|blur|width|height|left|top/, kf[1]);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.story \*, \.story, \.lvup \*/);
});

test('the story player keeps tap-to-skip and taps are never blocked', () => {
  const f = APP.slice(APP.indexOf('function playStory('), APP.indexOf('// ---------- «Перші кроки»'));
  assert.match(f, /closest\('\.story-skip'\)\) return close\(\)/);
  assert.match(f, /IFX\.swipeNav\(el/);
  assert.doesNotMatch(f, /pointer-events:\s*none|disabled/);
});
