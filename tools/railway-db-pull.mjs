// Забирає базу гри з Railway (знімок через VACUUM INTO, тобто цілісний навіть під навантаженням) у data-backup/.
// Потрібен Railway CLI, залогінений і прив'язаний до проєкту (railway link) у цій папці. Запуск: tools\railway-db-pull.cmd
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data-backup');
fs.mkdirSync(OUT, { recursive: true });

// Виконується всередині контейнера на Railway (node:24). Без лапок усередині — передається як base64.
const remote = `
const { DatabaseSync } = require('node:sqlite'); const fs = require('fs');
const src = (process.env.DATA_DIR || '/data') + '/avtodrop.db';
const snap = '/tmp/avtodrop-snap.db';
try { fs.unlinkSync(snap); } catch {}
const d = new DatabaseSync(src, { readOnly: true });
d.exec("VACUUM INTO '" + snap + "'"); d.close();
const b = fs.readFileSync(snap); fs.unlinkSync(snap);
process.stdout.write('<<DB>>' + b.toString('base64') + '<<END>>');
`;
const js = `eval(Buffer.from('${Buffer.from(remote).toString('base64')}','base64').toString())`;

// railway ssh потребує SSH-ключ, зареєстрований у Railway. Робимо окремий ключ для цього без запитань.
const home = process.env.USERPROFILE || process.env.HOME;
const key = path.join(home, '.ssh', 'railway_avtodrop');
if (!fs.existsSync(key)) {
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
  const g = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '""', '-C', 'avtodrop-pc', '-f', `"${key}"`], { shell: true, stdio: 'inherit' });
  if (g.status !== 0) { console.error('Не вдалося створити SSH-ключ (ssh-keygen)'); process.exit(1); }
  console.log('Реєструю ключ у Railway…');
  spawnSync('railway', ['ssh', 'keys', 'add', '--key', `"${key}.pub"`, '--name', 'avtodrop-pc'], { cwd: ROOT, shell: true, stdio: 'inherit' });
}

console.log('Підключаюсь до Railway і знімаю базу…');
const r = spawnSync('railway', ['ssh', '-i', `"${key}"`, '--', 'node', '-e', `"${js}"`], { cwd: ROOT, shell: true, maxBuffer: 2e9, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'latin1' });
const out = r.stdout || '';
const m = /<<DB>>([\s\S]*?)<<END>>/.exec(out);
if (!m) {
  console.error('\nНе отримав базу. Відповідь Railway:\n' + out.slice(0, 2000));
  process.exit(1);
}
const buf = Buffer.from(m[1].replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
const file = path.join(OUT, `railway-${stamp}.db`);
fs.writeFileSync(file, buf);

const d = new DatabaseSync(file, { readOnly: true });
const ok = d.prepare('PRAGMA integrity_check').get();
const users = d.prepare('SELECT count(*) n FROM users').get().n;
const cars = d.prepare('SELECT count(*) n FROM cars').get().n;
d.close();
fs.mkdirSync(path.join(ROOT, 'migration'), { recursive: true });
fs.copyFileSync(file, path.join(ROOT, 'migration', 'avtodrop.db'));
console.log(`\nГотово: ${file} (копія в migration\\avtodrop.db)`);
console.log(`Розмір ${(buf.length / 1048576).toFixed(1)} МБ, перевірка: ${ok.integrity_check}, гравців: ${users}, машин: ${cars}`);
if (ok.integrity_check !== 'ok') process.exit(2);
