import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { createStatic } from '../src/static.js';

const CARS = new URL('../public/cars', import.meta.url).pathname;

// Raw HTTP (fetch would hide content-encoding by decompressing).
function get(port, p, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withApp(fn) {
  const app = createApp({ dbFile: ':memory:', dev: true, log: () => {} });
  const port = await app.start(0);
  try {
    await fn(port);
  } finally {
    app.close();
  }
}

test('static: gzip and brotli when accepted, identity otherwise, Vary set', () => withApp(async (port) => {
  const plain = await get(port, '/app.js');
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers.vary, 'Accept-Encoding');
  const gz = await get(port, '/app.js', { 'accept-encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gz.headers.vary, 'Accept-Encoding');
  assert.ok(gz.body.length < plain.body.length / 2);
  assert.deepEqual(zlib.gunzipSync(gz.body), plain.body);
  const br = await get(port, '/style.css', { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.deepEqual(zlib.brotliDecompressSync(br.body), (await get(port, '/style.css')).body);
  // q=0 refuses an encoding.
  assert.equal((await get(port, '/style.css', { 'accept-encoding': 'br;q=0, gzip' })).headers['content-encoding'], 'gzip');
  // Photos are already compressed: sent as they are.
  const photo = fs.readdirSync(CARS).find((f) => f.endsWith('.webp'));
  if (photo) assert.equal((await get(port, `/cars/${photo}`, { 'accept-encoding': 'gzip, br' })).headers['content-encoding'], undefined);
  // Security headers stay on static files.
  assert.match(gz.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(gz.headers['x-content-type-options'], 'nosniff');
}));

test('static: matching ETag → 304, changed or missing ETag → 200', () => withApp(async (port) => {
  const first = await get(port, '/style.css', { 'accept-encoding': 'gzip' });
  assert.ok(first.headers.etag);
  const again = await get(port, '/style.css', { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal(again.headers.etag, first.headers.etag);
  // The same version under another encoding (or a weak tag) still matches.
  assert.equal((await get(port, '/style.css', { 'if-none-match': `W/${first.headers.etag}` })).status, 304);
  assert.equal((await get(port, '/style.css', { 'if-none-match': '"something-else"' })).status, 200);
  const idx = await get(port, '/');
  assert.equal((await get(port, '/', { 'if-none-match': idx.headers.etag })).status, 304);
  // Photos also answer If-Modified-Since.
  const photo = fs.readdirSync(CARS).find((f) => f.endsWith('.webp'));
  if (photo) {
    const p = await get(port, `/cars/${photo}`);
    assert.ok(p.headers['last-modified']);
    assert.equal((await get(port, `/cars/${photo}`, { 'if-modified-since': p.headers['last-modified'] })).status, 304);
  }
}));

test('static: index.html no-cache, versioned assets immutable, wrong version not immutable', () => withApp(async (port) => {
  const idx = await get(port, '/');
  assert.equal(idx.headers['cache-control'], 'no-cache');
  assert.equal((await get(port, '/index.html')).headers['cache-control'], 'no-cache');
  const html = idx.body.toString();
  const app = /src="(app\.js\?v=[\w-]+)"/.exec(html)?.[1];
  const css = /href="(style\.css\?v=[\w-]+)"/.exec(html)?.[1];
  assert.ok(app && css, 'index.html references carry ?v=<hash>');
  assert.match(html, /<link rel="modulepreload" href="shared\.js\?v=[\w-]+">/);
  assert.match(html, /icons\.svg\?v=[\w-]+#i-gift/);
  for (const u of [app, css]) assert.equal((await get(port, '/' + u)).headers['cache-control'], 'public, max-age=31536000, immutable');
  // Imports inside modules and fonts inside CSS are versioned too, and those URLs are immutable.
  const js = (await get(port, '/' + app)).body.toString();
  const shared = /from '\.\/(shared\.js\?v=[\w-]+)'/.exec(js)?.[1];
  assert.ok(shared);
  assert.equal((await get(port, '/' + shared)).headers['cache-control'], 'public, max-age=31536000, immutable');
  const font = /url\('(fonts\/[^']+\?v=[\w-]+)'\)/.exec((await get(port, '/fonts.css')).body.toString())?.[1];
  assert.ok(font);
  assert.equal((await get(port, '/' + font)).headers['cache-control'], 'public, max-age=31536000, immutable');
  // Old or made-up versions get the current file but must be revalidated, never pinned for a year.
  assert.equal((await get(port, '/app.js?v=old')).headers['cache-control'], 'no-cache');
  assert.equal((await get(port, '/app.js')).headers['cache-control'], 'no-cache');
  // Car photos from /api/config carry their hash; plain photo URLs: a day + stale-while-revalidate.
  const images = JSON.parse((await get(port, '/api/config')).body).images;
  const [, img] = Object.entries(images)[0] || [];
  if (img) {
    assert.match(img, /^cars\/[^?]+\?v=[\w-]+$/);
    assert.equal((await get(port, '/' + img)).headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.match((await get(port, '/' + img.split('?')[0])).headers['cache-control'], /max-age=86400, stale-while-revalidate/);
  }
}));

test('static: API responses stay no-store (compressed when large), errors no-store, traversal blocked', () => withApp(async (port) => {
  const cfg = await get(port, '/api/config', { 'accept-encoding': 'gzip' });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.headers['cache-control'], 'no-store');
  assert.equal(cfg.headers.etag, undefined);
  assert.equal(cfg.headers['content-encoding'], 'gzip');
  assert.ok(JSON.parse(zlib.gunzipSync(cfg.body)).images);
  const me = await get(port, '/api/me', { 'x-dev-user': encodeURIComponent(JSON.stringify({ id: 9, first_name: 'T' })) }, 'POST');
  assert.equal(me.headers['cache-control'], 'no-store');
  assert.equal(JSON.parse(me.body).id, 9);
  assert.equal((await get(port, '/no-such-file.js')).headers['cache-control'], 'no-store');
  assert.equal((await get(port, '/no-such-file.js')).status, 404);
  assert.equal((await get(port, '/..%2fserver.js')).status, 403);
  assert.equal((await get(port, '/cars')).status, 404);
  const head = await get(port, '/app.js', {}, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
}));

test('static: a changed dependency changes the hash of everything that imports it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avst-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), '<head></head><script type="module" src="a.js"></script>');
    fs.writeFileSync(path.join(dir, 'a.js'), "import { b } from './b.js';\nexport const a = () => `<use href=\"icons.svg#x\"/>`;");
    fs.writeFileSync(path.join(dir, 'b.js'), "import './a.js';\nexport const b = 1;"); // a cycle must not hang
    fs.writeFileSync(path.join(dir, 'icons.svg'), '<svg/>');
    const st = createStatic({ root: dir, mime: {}, recheckMs: 0 });
    const a1 = st.entry('a.js').hash, i1 = st.entry('index.html').hash;
    assert.match(st.entry('a.js').body.toString(), /\.\/b\.js\?v=[\w-]+/);
    assert.match(st.entry('a.js').body.toString(), /icons\.svg\?v=[\w-]+#x/);
    assert.match(st.entry('index.html').body.toString(), /modulepreload" href="b\.js\?v=/);
    fs.writeFileSync(path.join(dir, 'b.js'), "import './a.js';\nexport const b = 2; // changed");
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(dir, 'b.js'), t, t);
    assert.notEqual(st.entry('a.js').hash, a1);
    assert.notEqual(st.entry('index.html').hash, i1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
