// Роздає файли з папки migration/ (архів гри, setup.sh, база) через тимчасовий Cloudflare-тунель, щоб машина на
// Google Cloud забрала їх однією командою. Адреса тунелю пишеться у migration/url.txt. Запуск: tools\serve-migration.cmd
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'migration');
const PORT = 3500;
const ALLOWED = new Set(['avtodrop.tar.gz', 'setup.sh', 'update.sh', 'backup.sh', 'avtodrop.db']);
fs.mkdirSync(DIR, { recursive: true });
const exe = path.join(ROOT, 'tools', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
if (!fs.existsSync(exe)) { console.error('Немає tools/bin/cloudflared.exe'); process.exit(1); }

http.createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0].slice(1));
  const file = path.join(DIR, name);
  if (!ALLOWED.has(name) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  const st = fs.statSync(file);
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size });
  fs.createReadStream(file).pipe(res);
  console.log(new Date().toISOString(), req.socket.remoteAddress, name, st.size);
}).listen(PORT, '127.0.0.1');

const tunnel = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let url = null;
const onOut = (b) => {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(b));
  if (!m || url) return;
  url = m[0];
  fs.writeFileSync(path.join(DIR, 'url.txt'), url);
  console.log('\nФайли доступні за адресою:', url);
  for (const f of fs.readdirSync(DIR)) if (ALLOWED.has(f)) console.log('  ', f, (fs.statSync(path.join(DIR, f)).size / 1048576).toFixed(1), 'МБ');
  console.log('\nЦе вікно має лишатись відкритим, поки машина Google не забере файли.');
};
tunnel.stdout.on('data', onOut);
tunnel.stderr.on('data', onOut);
tunnel.on('exit', (code) => { console.error('Тунель закрився', code); process.exit(1); });
