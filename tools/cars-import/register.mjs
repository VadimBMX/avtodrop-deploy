// Registers the season-2 batch in the game:  node tools/cars-import/register.mjs [--all | --ids a,b] [--reset] [--no-assets] [--root DIR]
//
// 1. Rewrites the generated <cars-import> block of public/shared.js from cars.json (names, specs, factory colours)
//    and economy.json (class, price, prestige, homeOnly — the economy owns that file). A car is registered when its
//    photo is in public/cars (or public/cars/base), when it was registered before, or with --all / --ids. A registered
//    car without a photo is only in PENDING_MODELS (out of the game), exactly like LATE_RAW. --reset forgets the old
//    block (only cars with a photo / --ids stay).
// 2. Unless --no-assets: bakes the green key photos (tools/paint/green.py: base, mask, paint/meta.json, factory
//    colour), then rewrites public/car-photos.js, the list thumbnails (cars/thumb + index.json) and the race wheel data
//    (race-wheels-data.js; a car the wheel tool can't seed gets seeds from the import report).
// 3. Prints every registered car with its class, price and the cases it drops from.
// --root DIR works on another copy of the project (the self-test uses that). Exit code 1 on a validation error.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const ROOT = path.resolve(opt('--root') || path.join(HERE, '..', '..'));
const PUB = path.join(ROOT, 'public');
const SHARED = path.join(PUB, 'shared.js');
const CATALOG = JSON.parse(fs.readFileSync(opt('--cars') || path.join(HERE, 'cars.json'), 'utf8')).cars;
const ECON = JSON.parse(fs.readFileSync(opt('--economy') || path.join(HERE, 'economy.json'), 'utf8')).cars;
const REPORT = opt('--report') || path.join(HERE, 'out', 'report.json');
const PY = ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import numpy, scipy, PIL'], { stdio: 'ignore' }).status === 0);
const BEGIN = '// <cars-import>\n', END = '// </cars-import>\n';

const die = (msg) => { console.error('register: ' + msg); process.exit(1); };
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
// a re-shot car already has a photo: it becomes a key car only once its green photo is in (a base, or import.py --apply)
const applied = () => { try { return JSON.parse(fs.readFileSync(REPORT, 'utf8')).applied || []; } catch { return []; } };
const hasGreen = (id) => fs.existsSync(path.join(PUB, 'cars', 'base', id + '.webp')) || applied().includes(id);
const hasPhoto = (id) => fs.existsSync(path.join(PUB, 'cars', id + '.webp')) || fs.existsSync(path.join(PUB, 'cars', 'base', id + '.webp'));

async function loadShared(file = SHARED) {
  // a fresh copy each time (the module cache would hand back the old one)
  return import(pathToFileURL(file).href + '?t=' + Date.now() + Math.random());
}

function currentBlock(src) {
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < a) die('no <cars-import> block in public/shared.js');
  const block = src.slice(a + BEGIN.length, b);
  const raw = [...block.matchAll(/^ {2}\['((?:[^'\\]|\\.)*)'/gm)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  const fac = [...block.matchAll(/^ {2}'([a-z0-9-]+)': \{ hex/gm)].map((m) => m[1]);
  return { a, b, raw, fac };
}

function render(rows, prices, prestige, homeOnly, factory) {
  const lines = [];
  if (!rows.length) lines.push('const IMPORT_RAW = [];');
  else {
    lines.push('const IMPORT_RAW = [');
    for (const r of rows) lines.push(`  [${[q(r.name), q(r.cls), r.hp, r.kg, q(r.body), q(r.country), r.year, ...(r.ev ? ["'ev'"] : [])].join(', ')}],`);
    lines.push('];');
  }
  const obj = (name, o, fmt) => {
    const e = Object.entries(o);
    if (!e.length) return lines.push(`const ${name} = {};`);
    lines.push(`const ${name} = {`);
    for (const [k, v] of e) lines.push(`  ${q(k)}: ${fmt(v)},`);
    lines.push('};');
  };
  obj('IMPORT_PRICE', prices, (v) => v);
  obj('IMPORT_PRESTIGE', prestige, (v) => v);
  lines.push(`const IMPORT_HOME_ONLY = [${homeOnly.map(q).join(', ')}];`);
  const fmtF = (f) => {
    const two = f.two ? `, two: { hex: ${q(f.two.hex)}, finish: ${q(f.two.finish || f.finish)}, side: ${q(f.two.side)}, at: ${f.two.at} }` : '';
    return `{ hex: ${q(f.hex)}, finish: ${q(f.finish)}, name: ${q(f.name)}, key: true${two} }`;
  };
  obj('IMPORT_FACTORY', factory, fmtF);
  return lines.join('\n') + '\n';
}

function run(cmd, argv, what) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) die(`${what} failed:\n${out}`);
  return out;
}

async function main() {
  const src = fs.readFileSync(SHARED, 'utf8');
  const cur = currentBlock(src);
  const byId = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
  const want = new Set();
  const ids = opt('--ids') ? opt('--ids').split(',').map((s) => s.trim()).filter(Boolean) : [];
  for (const id of ids) {
    const c = byId[id] || CATALOG.find((x) => x.alias.includes(id) || String(x.n) === id.replace(/^0+/, ''));
    if (!c) die(`unknown car ${id} (cars.json)`);
    want.add(c.id);
  }
  for (const c of CATALOG) {
    if (args.includes('--all') || (c.redo ? hasGreen(c.id) : hasPhoto(c.id))) want.add(c.id);
    if (!args.includes('--reset') && (cur.raw.includes(c.name) || cur.fac.includes(c.id))) want.add(c.id); // registered before: stays
  }

  // ---- validation against the game as it is without this block
  const blank = src.slice(0, cur.a + BEGIN.length) + render([], {}, {}, [], {}) + src.slice(cur.b);
  const tmp = path.join(PUB, `.shared-noimport-${process.pid}.js`);
  fs.writeFileSync(tmp, blank);
  let S0;
  try { S0 = await loadShared(tmp); } finally { fs.rmSync(tmp, { force: true }); }
  const old = new Map([...Object.values(S0.MODELS), ...Object.values(S0.PENDING_MODELS)].map((m) => [m.id, m]));
  const oldNames = new Set([...old.values()].map((m) => m.name));
  const rows = [], prices = {}, prestige = {}, homeOnly = [], factory = {}, errs = [];
  for (const c of CATALOG.filter((x) => want.has(x.id))) {
    const f = c.factory;
    if (!/^#[0-9a-f]{6}$/.test(f.hex) || !S0.PAINT_FINISH[f.finish]) errs.push(`${c.id}: bad factory colour`);
    if (S0.FACTORY_PAINT[c.id]) errs.push(`${c.id}: already in FACTORY_PAINT by hand`);
    if (c.redo) {
      if (!old.has(c.id)) errs.push(`${c.id}: redo car is not in the game`);
      factory[c.id] = f;
      continue;
    }
    if (S0.slug(c.name) !== c.id) errs.push(`${c.id}: id must be slug(name) = ${S0.slug(c.name)}`);
    if (old.has(c.id) || oldNames.has(c.name)) errs.push(`${c.id}: clashes with a car already in shared.js`);
    if (!S0.COUNTRIES[c.country]) errs.push(`${c.id}: unknown country ${c.country}`);
    const e = ECON[c.id];
    if (!e) { errs.push(`${c.id}: no entry in economy.json`); continue; }
    if (e.cls === 'X') { errs.push(`${c.id}: class X (secret) is a country collection reward — pick D–S in economy.json or add it to SECRETS by hand`); continue; }
    const K = S0.CLASSES[e.cls];
    if (!K || e.cls === 'X') { errs.push(`${c.id}: bad class ${e.cls}`); continue; }
    if (e.price != null && !(Number.isInteger(e.price) && e.price >= K.lo && e.price <= K.hi)) errs.push(`${c.id}: price ${e.price} outside class ${e.cls} (${K.lo}…${K.hi})`);
    if (e.prestige != null && !(Number.isInteger(e.prestige) && e.prestige >= -3 && e.prestige <= 3)) errs.push(`${c.id}: prestige must be -3…3`);
    rows.push({ ...c, cls: e.cls });
    if (e.price != null) prices[c.id] = e.price;
    if (e.prestige) prestige[c.name] = e.prestige;
    if (e.homeOnly) homeOnly.push(c.id);
    factory[c.id] = f;
  }
  if (errs.length) die('\n  ' + errs.join('\n  '));
  rows.sort((a, b) => a.n - b.n);
  const next = src.slice(0, cur.a + BEGIN.length) + render(rows, prices, prestige, homeOnly, factory) + src.slice(cur.b);
  if (next !== src) fs.writeFileSync(SHARED, next);
  console.log(`shared.js: ${rows.length} new car(s) + ${Object.keys(factory).length - rows.length} re-shot key photo(s) in the <cars-import> block`);

  // ---- assets: bake key photos, photo list, thumbs, race wheels
  if (!args.includes('--no-assets')) {
    if (!PY) die('python with numpy/scipy/pillow is needed for the assets (or pass --no-assets)');
    const keyIds = Object.keys(factory).filter((id) => hasPhoto(id));
    if (keyIds.length) {
      const out = run(PY, ['-I', path.join(ROOT, 'tools/paint/green.py'), '--root', ROOT, ...keyIds], 'green.py');
      process.stdout.write(out.split('\n').filter((l) => /: (ok|skipped)/.test(l)).map((l) => '  ' + l + '\n').join(''));
      // a photo that is not a green key photo (the generator ignored the brief): plain paint mask instead
      const skipped = [...out.matchAll(/^([a-z0-9-]+): skipped/gm)].map((m) => m[1]).filter((id) => fs.existsSync(path.join(PUB, 'cars', id + '.webp')));
      if (skipped.length && ROOT === path.resolve(HERE, '..', '..')) {
        console.log(`  not green — plain paint masks for: ${skipped.join(', ')}`);
        run(PY, ['-I', path.join(ROOT, 'tools/paint/masks.py'), ...skipped], 'masks.py');
      }
    }
    // car-photos.js (same output as tools/car_photos.mjs)
    const { photoIds, photosModule } = await import(pathToFileURL(path.join(ROOT, 'tools', 'car_photos.mjs')).href);
    const ph = photoIds(path.join(PUB, 'cars'));
    fs.writeFileSync(path.join(PUB, 'car-photos.js'), photosModule(ph));
    if (ROOT === path.resolve(HERE, '..', '..')) {
      run(PY, ['-I', path.join(ROOT, 'tools/car_thumbs.py')], 'car_thumbs.py');
      seedWheels(keyIds);
      run(PY, ['-I', path.join(ROOT, 'tools/race_wheels.py')], 'race_wheels.py');
    } else {
      console.log('  (--root: thumbnails and race wheels are only rebuilt in the real project)');
    }
  }

  // ---- what the game sees now
  const S = await loadShared();
  console.log('\n n   id                                   class  price         in game  cases');
  for (const c of CATALOG.filter((x) => want.has(x.id))) {
    const m = S.MODELS[c.id] || S.PENDING_MODELS[c.id];
    const live = !!S.MODELS[c.id];
    const cases = live ? S.CASES.filter((cs) => cs.weights[m.cls] && cs.pool(m.cls).some((x) => x.id === c.id)).map((cs) => cs.id).join(' ') : '';
    console.log(`${String(c.n).padStart(3, '0')}  ${c.id.padEnd(36)} ${m.cls.padEnd(5)}  ${String(m.price).padStart(12)}  ${live ? 'yes    ' : 'waiting'}  ${cases}${c.redo ? '  (re-shot key photo)' : ''}`);
  }
}

// Race wheels need a seed per wheel: green.py's mask meta usually has them; when it found none (or bogus ones), take
// the wheels import.py measured on the final canvas (report.json) into tools/race_wheels_seeds.json.
function seedWheels(ids) {
  const metaFile = path.join(PUB, 'paint', 'meta.json');
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')).cars : {};
  const rep = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : { cars: [] };
  const seedsFile = path.join(ROOT, 'tools', 'race_wheels_seeds.json');
  const seeds = JSON.parse(fs.readFileSync(seedsFile, 'utf8'));
  let changed = false;
  for (const id of ids) {
    const m = meta[id];
    const sane = m?.wheels?.length === 2 && m.wheels.every((w) => w[2] > 0.1 * m.h && w[2] < 0.3 * m.h);
    const r = rep.cars.find((x) => x.id === id && x.wheels?.length === 2);
    if (!sane && r && !seeds[id]) { seeds[id] = r.wheels; changed = true; console.log(`  race wheels: seeds for ${id} from the import report`); }
  }
  if (changed) {
    const body = Object.entries(seeds).map(([k, v]) => `  ${JSON.stringify(k)}: ${typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v).replace(/,/g, ', ')}`);
    fs.writeFileSync(seedsFile, '{\n' + body.join(',\n') + '\n}\n');
  }
}

await main();
