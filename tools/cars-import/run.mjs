// One command for a batch of generated car pictures:  npm run cars-import -- <folder|archive.zip> [--force] [--test]
//   [--only 183,190] [--rembg auto|always|never] [--no-ocr]
//
// 1. import.py <folder> --apply : cut-outs, report.json, contact sheets; the pictures without errors go to public/cars
//    (--force: all of them)
// 2. register.mjs               : shared.js <cars-import> block, factory-colour bake + paint masks (green.py),
//                                 car-photos.js, thumbnails, race wheels
// 3. import.py --sheet-only     : the sheets again, now with the baked factory colour
// 4. --test                     : npm test
// Then look at tools/cars-import/out/sheet-*.jpg and commit. Nothing is pushed or deployed.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const args = process.argv.slice(2);
const folder = args.find((a, i) => !a.startsWith('--') && !['--only', '--rembg'].includes(args[i - 1]));
if (!folder) {
  console.log('usage: npm run cars-import -- <folder|archive.zip> [--force] [--test] [--only 183,190] [--rembg auto|always|never] [--no-ocr]');
  process.exit(1);
}
const PY = ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import numpy, scipy, PIL'], { stdio: 'ignore' }).status === 0);
if (!PY) {
  console.error('Python 3 with numpy, scipy and pillow is needed: pip install numpy scipy pillow "rembg[cpu]"');
  process.exit(1);
}
const pass = [];
for (const k of ['--only', '--rembg']) if (args.includes(k)) pass.push(k, args[args.indexOf(k) + 1]);
for (const k of ['--force', '--no-ocr']) if (args.includes(k)) pass.push(k);

function step(title, cmd, argv) {
  console.log(`\n=== ${title}`);
  const r = spawnSync(cmd, argv, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n${title}: failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

const IMPORT = path.join(HERE, 'import.py');
step('1/3 cut-outs, report, sheets', PY, ['-I', IMPORT, path.resolve(folder), '--apply', ...pass]);
step('2/3 register in the game (shared.js, bake, masks, photo list, thumbs, race wheels)', process.execPath, [path.join(HERE, 'register.mjs')]);
step('3/3 sheets with the factory colour', PY, ['-I', IMPORT, '--sheet-only']);
if (args.includes('--test')) step('npm test', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test']);
console.log(`\nDone. Check tools/cars-import/out/sheet-*.jpg and out/report.json, then commit (git add public tools test).`);
