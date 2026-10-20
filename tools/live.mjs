// Real launch from this computer: opens a free Cloudflare tunnel (https), then starts the game with the bot from .env.
// Run: npm run live   — stop with Ctrl+C.
// The tunnel stays up for the whole session, so its address (and the bot's "Грати" button) does not change when the
// game is updated: the server runs under `node --watch` and restarts by itself when its code changes.
// The address only changes when this script itself is restarted (e.g. after a reboot); the bot then updates its button.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '3100';
const exe = path.join(ROOT, 'tools', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
if (!fs.existsSync(path.join(ROOT, '.env'))) {
  console.error('Немає файлу .env — скопіюй .env.example у .env і впиши BOT_TOKEN.');
  process.exit(1);
}
if (!fs.existsSync(exe)) {
  console.error(`Немає ${exe}. Завантаж cloudflared: https://github.com/cloudflare/cloudflared/releases`);
  process.exit(1);
}

let server = null, url = null, stopping = false;
function startServer() {
  // Variables already in the environment win over .env, so WEBAPP_URL here overrides the empty one in the file.
  server = spawn(process.execPath, ['--watch', '--env-file=.env', 'server.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, WEBAPP_URL: url, PORT } });
  server.on('exit', (code) => {
    if (stopping) return;
    // Keep the tunnel (and its address) alive; bring the game back after a crash.
    console.log(`Сервер зупинився (${code}), перезапускаю через 3 с…`);
    setTimeout(startServer, 3000);
  });
}
const tunnel = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
const onOutput = (buf) => {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buf));
  if (!m || url) return;
  url = m[0];
  console.log(`\nТунель відкрито: ${url}`);
  startServer();
};
tunnel.stdout.on('data', onOutput);
tunnel.stderr.on('data', onOutput);
tunnel.on('exit', (code) => {
  console.log(`Тунель закрився (${code}). Запусти гру знову.`);
  stop(code ?? 1);
});
function stop(code = 0) {
  stopping = true;
  server?.kill();
  tunnel.kill();
  process.exit(code);
}
console.log('Відкриваю тунель Cloudflare…');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(0));
