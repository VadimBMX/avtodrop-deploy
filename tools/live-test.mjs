// Test copy of the game for the owner: its own bot (data-test/bot-token.txt), its own database (data-test/), its own Cloudflare
// tunnel on port 3300. Real players and the real database are not touched. Never runs in DEV mode.
// Started and stopped from the local dev server (/api/dev/test-live) or by hand: node tools/live-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = '3300';
const DATA = path.join(ROOT, 'data-test');
const exe = path.join(ROOT, 'tools', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
fs.mkdirSync(DATA, { recursive: true });
const testEnv = path.join(DATA, 'bot-token.txt');
const status = (s) => fs.writeFileSync(path.join(DATA, 'status.json'), JSON.stringify({ ...s, pid: process.pid, at: Date.now() }));

const token = (fs.existsSync(testEnv) ? fs.readFileSync(testEnv, 'utf8') : '').replace(/^BOT_TOKEN=/m, '').trim();
if (!token) { status({ state: 'error', error: 'Немає токена тестового бота в data-test/bot-token.txt' }); process.exit(1); }
if (!fs.existsSync(exe)) { status({ state: 'error', error: 'Немає tools/bin/cloudflared.exe' }); process.exit(1); }

// The dev server that may have started us runs with DEV=1 and an empty BOT_TOKEN: drop those so this copy is a
// normal (non-dev) game with the test bot. Values set here win over the files given with --env-file.
const env = { ...process.env };
for (const k of ['DEV', 'BOT_TOKEN', 'DATA_DIR', 'PORT', 'WEBAPP_URL']) delete env[k];
Object.assign(env, { BOT_TOKEN: token, DATA_DIR: DATA, PORT });

let server = null, url = null, stopping = false;
function startServer() {
  const args = fs.existsSync(path.join(ROOT, '.env')) ? ['--env-file=.env', 'server.js'] : ['server.js'];
  server = spawn(process.execPath, args, { cwd: ROOT, stdio: 'ignore', env: { ...env, WEBAPP_URL: url } });
  server.on('exit', (code) => {
    if (stopping) return;
    status({ state: 'restarting', url, code });
    setTimeout(startServer, 3000);
  });
  status({ state: 'running', url });
}
const tunnel = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
const onOutput = (buf) => {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buf));
  if (!m || url) return;
  url = m[0];
  startServer();
};
tunnel.stdout.on('data', onOutput);
tunnel.stderr.on('data', onOutput);
tunnel.on('exit', (code) => { status({ state: 'stopped', code }); stop(code ?? 1); });
function stop(code = 0) {
  stopping = true;
  server?.kill();
  tunnel.kill();
  process.exit(code);
}
status({ state: 'starting' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { status({ state: 'stopped' }); stop(0); });
