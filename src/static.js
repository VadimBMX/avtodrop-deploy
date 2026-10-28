// Static files from public/: compression, caching and asset versioning without a build step.
//
// Versioning: HTML, JS and CSS are rewritten in memory so every local reference carries ?v=<content hash>
// (src/href in HTML, module imports in JS, url() in CSS, "icons.svg#…" in JS templates). A file's hash is taken
// over its *rewritten* text, so when shared.js changes, the hash of every module importing it changes too and the
// whole chain gets new URLs. URLs whose ?v matches the current hash are cached for a year (immutable); HTML and
// anything unversioned is revalidated on every use (no-cache + ETag → 304), so a new deploy reaches players on
// their next launch and a Telegram webview can never keep old JS.
// Compression: gzip and brotli for text types, done once per file version (keyed by mtime + size) and kept in memory.
// Comments: CSS and JS go out without their comments (src/minify.js; ~20% fewer bytes after brotli), before the
// rewrite above, so a commented-out import is neither versioned nor preloaded. strip: false serves them as written.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { stripCss, stripJs } from './minify.js';

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.txt', '.map']);
const REWRITE = new Set(['.html', '.js', '.mjs', '.css']);
const IMAGES = new Set(['.webp', '.png', '.jpg', '.jpeg']);
export const IMMUTABLE = 'public, max-age=31536000, immutable';
// Car photos, part photos and paint masks under their plain URL: a day fresh, then served from cache while it
// revalidates in the background for up to a week. The game itself asks for them with ?v=<hash> (see /api/config).
export const PHOTO = 'public, max-age=86400, stale-while-revalidate=604800';
export const REVALIDATE = 'no-cache';

const SKIP = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/?api\/)/i;

// Accept-Encoding → 'br' | 'gzip' | null (q=0 means "not this one").
export function pickEncoding(accept) {
  const want = {};
  for (const part of String(accept || '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)).find(Boolean);
    want[name.trim()] = q ? Number(q[1]) : 1;
  }
  if (want.br > 0) return 'br';
  if (want.gzip > 0) return 'gzip';
  return null;
}

// Small dynamic bodies (API JSON): compressed per response with fast settings; null = send as is.
export function compressSmall(buf, accept) {
  if (buf.length < 1024) return null;
  const kind = pickEncoding(accept);
  if (kind === 'br') return { kind, body: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }) };
  if (kind === 'gzip') return { kind, body: zlib.gzipSync(buf, { level: 6 }) };
  return null;
}

export function createStatic({ root, mime, headers = {}, recheckMs = 1000, strip = true }) {
  const cache = new Map(); // rel path → entry

  function hashOf(buf) {
    return crypto.createHash('sha256').update(buf).digest('base64url').slice(0, 12);
  }

  // Resolve a reference found in `fromDir` and return it with ?v=<hash>, or null to leave it as it is.
  function versioned(spec, fromDir, deps, stack) {
    if (!spec || SKIP.test(spec)) return null;
    const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(spec);
    if (!m || !m[1] || m[2]) return null;
    const target = m[1].startsWith('/') ? path.posix.normalize(m[1].slice(1)) : path.posix.normalize(path.posix.join(fromDir, m[1]));
    if (!target || target.startsWith('..') || target.startsWith('/')) return null;
    const d = entry(target, stack);
    if (!d) return null;
    deps.set(target, d.hash);
    return `${m[1]}?v=${d.hash}${m[3] || ''}`;
  }

  function rewrite(rel, text, deps, imports, stack) {
    const ext = path.extname(rel);
    const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    if (ext === '.css') {
      return text
        .replace(/url\(\s*(["']?)([^"')\s]+)\1\s*\)/g, (all, q, spec) => {
          const v = versioned(spec, dir, deps, stack);
          return v ? `url(${q}${v}${q})` : all;
        })
        .replace(/(@import\s+)(["'])([^"']+)\2/g, (all, pre, q, spec) => {
          const v = versioned(spec, dir, deps, stack);
          return v ? `${pre}${q}${v}${q}` : all;
        });
    }
    if (ext === '.js' || ext === '.mjs') {
      return text
        .replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]+)\2/g, (all, pre, q, spec) => {
          const v = versioned(spec, dir, deps, stack);
          if (!v) return all;
          if (!/\(\s*$/.test(pre)) imports.add(path.posix.normalize(path.posix.join(dir, spec.split(/[?#]/)[0])));
          return `${pre}${q}${v}${q}`;
        })
        // <use href="icons.svg#…"> built inside templates: relative to the page, which lives at the root.
        .replace(/\bicons\.svg(?=#)/g, (all) => versioned(all, '', deps, stack)?.replace(/#.*$/, '') || all);
    }
    // HTML
    let out = text.replace(/(\s(?:src|href)=)(["'])([^"']*)\2/g, (all, pre, q, spec) => {
      const v = versioned(spec, dir, deps, stack);
      return v ? `${pre}${q}${v}${q}` : all;
    });
    // Module preloads: the browser fetches the whole import tree in parallel with app.js instead of discovering it
    // one level at a time (each level costs a round trip on a phone network).
    const pre = new Map();
    for (const [, src] of text.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"'?#]+)["']/g)) {
      const start = path.posix.normalize(src.startsWith('/') ? src.slice(1) : path.posix.join(dir, src));
      const walk = (r) => {
        const e = entry(r, stack);
        if (!e) return;
        for (const i of e.imports) {
          if (i === start || pre.has(i)) continue;
          const d = entry(i, stack);
          if (!d) continue;
          pre.set(i, d.hash);
          walk(i);
        }
      };
      walk(start);
    }
    if (pre.size && /<\/head>/i.test(out)) {
      const links = [...pre].map(([r, h]) => `<link rel="modulepreload" href="${r}?v=${h}">`).join('\n  ');
      out = out.replace(/<\/head>/i, `  ${links}\n</head>`);
    }
    return out;
  }

  function depsValid(e, stack) {
    for (const [dep, h] of e.deps) {
      if (stack.has(dep)) continue;
      const d = entry(dep, stack);
      if (!d || d.hash !== h) return false;
    }
    return true;
  }

  // Current version of a file (rel = path inside root, no leading slash), or null when it isn't a file.
  function entry(rel, stack = new Set()) {
    const now = Date.now();
    const old = cache.get(rel);
    if (old && now - old.checked < recheckMs) return old;
    // Import cycle: use what we have (or leave that one reference unversioned) instead of recursing forever.
    if (stack.has(rel)) return old || null;
    const abs = path.join(root, rel);
    if (!abs.startsWith(root + path.sep)) return null;
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      cache.delete(rel);
      return null;
    }
    if (!st.isFile()) return null;
    stack.add(rel);
    try {
      if (old && old.mtimeMs === st.mtimeMs && old.size === st.size && depsValid(old, stack)) {
        old.checked = now;
        return old;
      }
      const ext = path.extname(rel).toLowerCase();
      let body = fs.readFileSync(abs);
      const deps = new Map();
      const imports = new Set();
      if (REWRITE.has(ext)) {
        let text = body.toString('utf8');
        if (strip) text = ext === '.css' ? stripCss(text) : ext === '.js' || ext === '.mjs' ? stripJs(text) : text;
        body = Buffer.from(rewrite(rel, text, deps, imports, stack), 'utf8');
      }
      const e = { rel, ext, mtimeMs: st.mtimeMs, size: st.size, mtime: st.mtime, body, hash: hashOf(body), deps, imports, enc: {}, checked: now };
      cache.set(rel, e);
      return e;
    } finally {
      stack.delete(rel);
    }
  }

  // Compressed bodies are built once per version, in the background thread pool, and shared by all requests.
  function encoded(e, kind) {
    if (!(kind in e.enc)) {
      const p = kind === 'br'
        ? brotli(e.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: e.body.length, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT } })
        : gzip(e.body, { level: 9 });
      e.enc[kind] = p.then((b) => (b.length < e.body.length ? b : null)).catch(() => null);
    }
    return e.enc[kind];
  }

  const etagMatches = (inm, hash) => String(inm || '').split(',').some((t) => {
    const v = t.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
    return v === '*' || v.replace(/-(br|gz)$/, '') === hash;
  });

  // Serve rel (already checked to stay inside root). Returns false when there is no such file.
  async function serve(req, res, rel, v) {
    const e = entry(rel);
    if (!e) return false;
    const compressible = COMPRESSIBLE.has(e.ext);
    let cacheControl;
    if (v && v === e.hash) cacheControl = IMMUTABLE;
    else if (IMAGES.has(e.ext) && /^(cars|parts|paint)\//.test(rel)) cacheControl = PHOTO;
    else cacheControl = REVALIDATE;
    let kind = compressible && e.body.length > 512 ? pickEncoding(req.headers['accept-encoding']) : null;
    let body = e.body;
    if (kind) {
      const b = await encoded(e, kind === 'br' ? 'br' : 'gz');
      if (b) body = b;
      else kind = null;
    }
    const h = {
      ...headers,
      'content-type': mime[e.ext] || 'application/octet-stream',
      'cache-control': cacheControl,
      etag: `"${e.hash}${kind === 'br' ? '-br' : kind === 'gzip' ? '-gz' : ''}"`,
    };
    // Rewritten files depend on other files, so their own mtime says nothing; they revalidate by ETag only.
    if (!REWRITE.has(e.ext)) h['last-modified'] = e.mtime.toUTCString();
    if (compressible) h.vary = 'Accept-Encoding';
    const inm = req.headers['if-none-match'];
    const ims = req.headers['if-modified-since'];
    if (inm ? etagMatches(inm, e.hash) : ims && h['last-modified'] && Date.parse(ims) >= Math.floor(e.mtimeMs / 1000) * 1000) {
      delete h['content-type'];
      res.writeHead(304, h);
      res.end();
      return true;
    }
    if (kind) h['content-encoding'] = kind;
    h['content-length'] = body.length;
    res.writeHead(200, h);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  // URL of a file with its version, e.g. version('cars/x.webp') → 'cars/x.webp?v=abc'; unknown files unchanged.
  function version(rel) {
    const e = entry(rel);
    return e ? `${rel}?v=${e.hash}` : rel;
  }

  // Hash and compress every text file ahead of time (after a deploy the first player shouldn't wait for brotli).
  async function warm(dir = '') {
    let list = [];
    try {
      list = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      const rel = dir ? `${dir}/${d.name}` : d.name;
      if (d.isDirectory()) await warm(rel);
      else if (d.isFile()) {
        const e = entry(rel);
        if (e && COMPRESSIBLE.has(e.ext) && e.body.length > 512) await Promise.all([encoded(e, 'br'), encoded(e, 'gz')]);
      }
    }
  }

  return { serve, version, warm, entry };
}
