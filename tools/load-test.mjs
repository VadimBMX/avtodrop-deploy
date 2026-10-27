// Load test: N simulated players against a running server, as the Mini App calls it — `pulse` every 4 s, `me` every
// 20 s, and a screen or an action every ~12 s (quests, leaderboard, weekly, containers, dayrace, achievements, collect,
// opening a case). Prints p50/p95/max per call, the throughput and the errors.
//
//   node tools/load-test.mjs [url=http://localhost:3100] [players=300] [seconds=60] [firstId=100000]
//
// Auth: with LOAD_TOKEN=<the server's BOT_TOKEN> the calls carry signed Telegram initData (the production path, one
// HMAC check per player thanks to the server's auth cache); otherwise the DEV header (server started with DEV=1).
// Never point this at the live server.
import { signInitData } from '../src/auth.js';

const [url = 'http://localhost:3100', nArg = '300', secArg = '60', firstArg = '100000'] = process.argv.slice(2);
const N = Number(nArg), SECONDS = Number(secArg), FIRST = Number(firstArg);
const TOKEN = process.env.LOAD_TOKEN || '';
const CASE = process.env.LOAD_CASE || '';

const lat = new Map(); // name → [ms]
const errors = new Map(); // name → { status: count }
let calls = 0;
function headersFor(id) {
  const user = { id, first_name: 'P' + (id - FIRST), username: 'p' + (id - FIRST) };
  if (TOKEN) return { 'content-type': 'application/json', 'accept-encoding': 'br, gzip', 'x-init-data': signInitData({ user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000)) }, TOKEN) };
  return { 'content-type': 'application/json', 'accept-encoding': 'br, gzip', 'x-dev-user': encodeURIComponent(JSON.stringify(user)) };
}
async function call(h, name, body = {}) {
  const t = performance.now();
  let status = 0;
  try {
    const r = await fetch(`${url}/api/${name}`, { method: name === 'config' ? 'GET' : 'POST', headers: h, body: name === 'config' ? undefined : JSON.stringify(body) });
    status = r.status;
    await r.arrayBuffer();
  } catch {
    status = -1;
  }
  const ms = performance.now() - t;
  calls++;
  if (!lat.has(name)) lat.set(name, []);
  lat.get(name).push(ms);
  if (status !== 200 && !(status === 400 && name !== 'me' && name !== 'pulse')) {
    const e = errors.get(name) || {};
    e[status] = (e[status] || 0) + 1;
    errors.set(name, e);
  }
  return status;
}
const ACTIONS = [['quests'], ['leaderboard'], ['weekly'], ['containers'], ['dayrace'], ['achievements'], ['collect'], ['case/open', () => ({ caseId: CASE, count: 1 })]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const end = Date.now() + SECONDS * 1000;
async function player(i) {
  const id = FIRST + i;
  const h = headersFor(id);
  await sleep(Math.random() * 10e3); // players arrive over the first 10 s
  await call(h, 'config');
  await call(h, 'me');
  await call(h, 'pulse');
  let nextMe = Date.now() + 20e3, nextAct = Date.now() + 4e3 + Math.random() * 16e3;
  while (Date.now() < end) {
    await sleep(4000 + (Math.random() - 0.5) * 400);
    if (Date.now() >= end) break;
    await call(h, 'pulse');
    if (Date.now() >= nextMe) {
      await call(h, 'me');
      nextMe += 20e3;
    }
    if (Date.now() >= nextAct) {
      const [name, body] = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
      if (name !== 'case/open' || CASE) await call(h, name, body ? body() : {});
      nextAct = Date.now() + 8e3 + Math.random() * 8e3;
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: N }, (_, i) => player(i)));
const secs = (Date.now() - t0) / 1000;
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
const rows = [...lat].sort((a, b) => b[1].length - a[1].length).map(([name, a]) => {
  const s = [...a].sort((x, y) => x - y);
  return { name, n: s.length, p50: +pct(s, 0.5).toFixed(1), p95: +pct(s, 0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
});
const all = [...lat.values()].flat().sort((x, y) => x - y);
console.log(JSON.stringify({ url, players: N, seconds: +secs.toFixed(1), calls, rps: +(calls / secs).toFixed(1), p50: +pct(all, 0.5).toFixed(1), p95: +pct(all, 0.95).toFixed(1), rows, errors: Object.fromEntries(errors) }, null, 1));
