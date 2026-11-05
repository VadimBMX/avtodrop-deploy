// HTTP fuzz against a running DEV server: every API endpoint with raw odd bodies (not JSON, null, an array, a string,
// a prototype-polluting object, a huge body, a wrong content type) and bursts of the same call in parallel. Anything
// answered with 5xx (or a dropped connection) is listed. Only DEV test players (x-dev-user header) are used.
//   DEV=1 PORT=3517 DATA_DIR=<empty dir> node server.js
//   FUZZ_URL=http://localhost:3517 [FUZZ_DB=<dir>/avtodrop.db] node tools/fuzz-http.mjs
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';

const URL0 = process.env.FUZZ_URL || 'http://localhost:3517';
const names = Object.keys(createGame(openDb(':memory:'), { notify: () => {} }).api).filter((n) => !/^(support\/send|hall\/chat|room\/chat|ideas)$/.test(n));
const extra = ['share/card', 'share/prepare', 'challenge/prepare', 'showroom/prepare', 'settings/channel', 'tggroups/claim', 'shop/invoice', 'shop/sub', 'ref', 'nope', '../admin/money', '%2e%2e/admin/users'];
const uid = 7_300_000 + (Date.now() % 1e5);
const hdr = (id) => ({ 'x-dev-user': encodeURIComponent(JSON.stringify({ id, first_name: 'http', username: 'http' + id })) });
const BODIES = [
  ['not json', '{"a":', 'application/json'],
  ['null', 'null', 'application/json'],
  ['array', '[1,2,3]', 'application/json'],
  ['string', '"x"', 'application/json'],
  ['number', '42', 'application/json'],
  ['proto', '{"__proto__":{"admin":true,"balance":1e9},"constructor":{"prototype":{"x":1}},"id":"__proto__","carId":"constructor"}', 'application/json'],
  ['deep', '{"a":' + '['.repeat(5000) + ']'.repeat(5000) + '}', 'application/json'],
  ['huge', JSON.stringify({ text: 'x'.repeat(3e6) }), 'application/json'],
  ['form', 'a=1&b=2', 'application/x-www-form-urlencoded'],
  ['empty', '', 'application/json'],
];
const problems = [];
async function send(path, body, type, id = uid) {
  try {
    const r = await fetch(URL0 + '/api/' + path, { method: 'POST', headers: { 'content-type': type, ...hdr(id) }, body });
    const txt = await r.text();
    if (r.status >= 500) problems.push(`${r.status} /api/${path} [${body.slice(0, 40)}] ${txt.slice(0, 120)}`);
    return r.status;
  } catch (e) {
    if (body.length < 1e6) problems.push(`DROP /api/${path} [${body.slice(0, 40)}] ${e.message}`);
    return 0;
  }
}
await send('me', '{}', 'application/json');
let n = 0;
for (const name of [...names, ...extra]) {
  for (const [, body, type] of BODIES) {
    const st = await send(name, body, type);
    n++;
    if (st === 429) await new Promise((r) => setTimeout(r, 1100));
  }
}
// bursts: the same call ×8 at once (double taps / retries) from a second player
const id2 = uid + 1;
await send('me', '{}', 'application/json', id2);
for (const name of ['collect', 'rewards/daily', 'case/open', 'parts/open', 'plate/generate', 'biz/collect', 'goals/key', 'season/claim', 'newbie/claim', 'rewards/all']) {
  const body = JSON.stringify(name === 'case/open' ? { caseId: 'starter', count: 1 } : name === 'parts/open' ? { caseId: 'scrap', count: 1 } : { all: true });
  await Promise.all(Array.from({ length: 8 }, () => send(name, body, 'application/json', id2)));
  n += 8;
}
// r3: «Заправка новачка» ×8 at once on an empty tank — filled once. Needs the server's database file (FUZZ_DB, the
// DATA_DIR's avtodrop.db) to empty the tank, since no API does that.
if (process.env.FUZZ_DB) {
  const { DatabaseSync } = await import('node:sqlite');
  const fdb = new DatabaseSync(process.env.FUZZ_DB);
  const id3 = uid + 2;
  await send('me', '{}', 'application/json', id3);
  fdb.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = ?').run(Date.now(), id3);
  const st = await Promise.all(Array.from({ length: 8 }, () => send('fuel/newbie', '{}', 'application/json', id3)));
  n += 8;
  const used = fdb.prepare('SELECT newbie_fuel FROM users WHERE id = ?').get(id3).newbie_fuel;
  if (st.filter((s) => s === 200).length !== 1 || used !== 1) problems.push(`fuel/newbie ×8 at once: ${st.join(',')} → newbie_fuel ${used} (want one 200 and 1)`);
  fdb.close();
}
console.log(`${n} requests, ${problems.length} problem(s)`);
for (const p of [...new Set(problems)].slice(0, 80)) console.log('- ' + p);
process.exit(problems.length ? 1 : 0);
