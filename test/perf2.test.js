// perf2 (night 28.10): comments stripped from served CSS/JS, unhinted fonts, the drag race's start without
// a decode hitch and without a forced layout per gear change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripCss, stripJs } from '../src/minify.js';
import { createStatic } from '../src/static.js';

const PUB = new URL('../public/', import.meta.url).pathname;
const read = (f) => fs.readFileSync(PUB + f, 'utf8');

test('stripCss: comments go, strings / url() / token boundaries stay', () => {
  assert.equal(stripCss('/* a */\n.a { color: red; } /* b */\n'), '.a { color: red; } \n');
  assert.equal(stripCss('.a::after { content: "/* not a comment */"; }'), '.a::after { content: "/* not a comment */"; }');
  assert.equal(stripCss(".a { background: url(data:image/svg+xml;utf8,<svg>/*x*/</svg>); }"), ".a { background: url(data:image/svg+xml;utf8,<svg>/*x*/</svg>); }");
  assert.equal(stripCss('.a { margin: 1px/**/2px; }'), '.a { margin: 1px/**/2px; }'); // would join into one token
  assert.equal(stripCss('.a/* x */.b { }'), '.a.b { }');
  assert.equal(stripCss('.a { color: red; /* unterminated'), '.a { color: red; /* unterminated'); // gives up: original
  for (const f of fs.readdirSync(PUB).filter((f) => f.endsWith('.css'))) {
    const src = read(f), out = stripCss(src);
    assert.equal(stripCss(out), out, `${f}: idempotent`);
    assert.ok(!/\/\*(?!\*\/)/.test(out.replace(/"[^"\n]*"|'[^'\n]*'/g, '')), `${f}: no comments left`);
    const braces = (t) => (t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"\n]*"|'[^'\n]*'/g, '').match(/[{}]/g) || []).length;
    assert.equal(braces(out), braces(src), `${f}: the same rules`);
  }
});

test('stripJs: whole-line and end-of-line comments go; strings, templates, regexes, division stay', () => {
  const src = [
    '// header',
    'const a = 1; // trailing',
    '  /* block',
    '     comment */',
    "const u = 'http://x.y/*z*/'; const v = \"//q\";",
    'const t = `line',
    '// inside a template: stays',
    '${a /* in expr */ + 1} /* text */`;',
    'const r = /\\/\\/+[/*]/g, d = a / 2 / 1; // after division',
    'const s = x => x /* mid */ + 1;',
    '',
  ].join('\n');
  const out = stripJs(src);
  assert.equal(out, [
    'const a = 1;',
    "const u = 'http://x.y/*z*/'; const v = \"//q\";",
    'const t = `line',
    '// inside a template: stays',
    '${a /* in expr */ + 1} /* text */`;',
    'const r = /\\/\\/+[/*]/g, d = a / 2 / 1;',
    'const s = x => x /* mid */ + 1;',
    '',
  ].join('\n'));
  assert.equal(stripJs('const t = `never closed // x'), 'const t = `never closed // x'); // gives up: original
  assert.equal(stripJs("const s = 'broken\n// x"), "const s = 'broken\n// x");
});

test('stripJs: every public module still parses after stripping (node --check) and gets smaller', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avmin-'));
  try {
    let before = 0, after = 0;
    for (const f of fs.readdirSync(PUB).filter((f) => f.endsWith('.js'))) {
      const src = read(f), out = stripJs(src);
      before += src.length;
      after += out.length;
      assert.equal(stripJs(out), out, `${f}: idempotent`);
      const p = path.join(dir, f.replace(/\.js$/, '.mjs'));
      fs.writeFileSync(p, out);
      const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    }
    assert.ok(after < before * 0.9, `${before} → ${after}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('static: CSS and JS are served without comments (strip: false keeps them)', () => {
  const st = createStatic({ root: PUB.replace(/\/$/, ''), mime: {}, recheckMs: 0 });
  const css = st.entry('style.css').body.toString(), js = st.entry('app.js').body.toString();
  assert.ok(!css.includes('Design system "Premium motorsport"'));
  assert.match(css, /\.racebtn/);
  assert.ok(!js.includes('// ---------- infrastructure ----------'));
  assert.match(js, /from '\.\/shared\.js\?v=[\w-]+'/);
  assert.ok(css.length < read('style.css').length * 0.95 && js.length < read('app.js').length * 0.95);
  const raw = createStatic({ root: PUB.replace(/\/$/, ''), mime: {}, recheckMs: 0, strip: false });
  assert.ok(raw.entry('style.css').body.toString().includes('Design system "Premium motorsport"'));
});

test('fonts: every url in fonts.css exists and is smaller than the hinted original, the preload is one of them', () => {
  const css = read('fonts.css');
  const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 10);
  for (const u of urls) assert.ok(fs.existsSync(PUB + u), u);
  // Fira without hinting: each Latin file ~18 KB (was ~25 KB), each Cyrillic ~7 KB (was ~11.5 KB).
  for (const u of urls.filter((u) => u.includes('Fira'))) assert.ok(fs.statSync(PUB + u).size < (u.includes('latin') ? 20000 : 8500), u);
  const pre = /<link rel="preload" href="([^"]+)" as="font"/.exec(read('index.html'))[1];
  assert.ok(urls.includes(pre), pre);
});

test('drag race: photos decoded before the lights (solo only, capped), no forced layout per shift', () => {
  const app = read('app.js');
  const fn = (head) => { const i = app.indexOf(head); assert.ok(i >= 0, head); return app.slice(i, app.indexOf('\n}', i) + 2); };
  const run = fn('function runRace() {');
  assert.match(run, /!R\.live/);
  assert.match(run, /i\.decode\(\)/);
  assert.match(run, /setTimeout\(r, 700\)/);
  assert.match(run, /state\.race === R && R\.phase === 'lights' && runRaceNow\(\)/);
  assert.ok(app.includes('function runRaceNow() {'));
  const scene = fn('function drScene(E0, R) {');
  assert.match(scene, /if \(E\.me\.classList\.contains\('fl'\)\) \{\s*E\.me\.classList\.remove\('fl'\);\s*void E\.me\.offsetWidth;/);
  assert.match(scene, /animationName === 'drFlame'/);
  const ww = read('race-wheels.js');
  assert.equal((ww.match(/offsetWidth/g) || []).length, 2);
  assert.match(ww, /build\('rv', E\.rvB\);\s*\/\/[^\n]*\n[^\n]*\n\s*cars\.me\.W = E\.meB\.offsetWidth;/);
});
