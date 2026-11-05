// Layout checker: «чи нічого кривого нема». Visits every tab, page and the main sheets of АВТОДРОП as two players
// (a new one, and a rich level-30 VIP with a long name, 40 cars with long names, ~9,9 млрд and an empty tank) at
// 320×568, 360×640, 390×844, 430×932 and flags, programmatically:
//   hscroll    the page scrolls sideways
//   offscreen  an element that can't be scrolled into the screen (outside the viewport even after scrolling to it)
//   under-bar / under-head / under-sticky   an element still covered by the floating bottom bar, the header or a
//              sticky dock after scrolling to it (the last row under the dock, etc.)
//   overlap    one control/text painted over another (hit test), text-over-text (text-node box intersection)
//   clip       text cut by overflow:hidden without an ellipsis
//   ellnum     an ellipsis on a number (money, timers, counts)
//   wrapnum    a short number/value broken over two lines («9 940 000 000 / ₴»)
//   tap        a control smaller than 36 px
//   img        an image that failed, is broken or has a 0 size; a missing icon symbol
//   centre     an image whose visible pixels sit off the centre of its frame (helmet, car, badge)
//   z          the toast under an open sheet/confirm
//   trap       an inner scroll box taller than 70 % of the screen (the page can't be scrolled past it)
//
//   DEV=1 PORT=3471 DATA_DIR=/tmp/lc node server.js                       (another terminal)
//   NODE_PATH=<playwright> LC_URL=http://localhost:3471 LC_DB=/tmp/lc/avtodrop.db LC_OUT=/tmp/lc-out node tools/layout-check.mjs
// Options (env): LC_VP=320,390 (viewports by width), LC_ONLY=garage,store (state-name substrings), LC_WHO=rich|new,
//   LC_SHOTS=0 (no screenshots; default: a JPG of every state with issues), LC_LABEL=before (name of the JSON summary).
// Output: <LC_OUT>/<label>.json (all issues) and a per-screen count table on stdout. Exit code 0 always (it's a report).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL0 = process.env.LC_URL || 'http://localhost:3471';
const OUT = process.env.LC_OUT || './layout-out';
const LABEL = process.env.LC_LABEL || 'run';
const SHOTS = process.env.LC_SHOTS !== '0';
const VPS = [[320, 568], [360, 640], [390, 844], [430, 932]].filter(([w]) => !process.env.LC_VP || process.env.LC_VP.split(',').map(Number).includes(w));
const ONLY = process.env.LC_ONLY ? process.env.LC_ONLY.split(',') : null;
const WHO = process.env.LC_WHO ? process.env.LC_WHO.split(',') : ['new', 'rich'];
const BASE = Number(process.env.LC_BASE) || 7e8 + (Date.now() % 1e6) * 10;
mkdirSync(join(OUT, 'shots'), { recursive: true });

// ------------------------------------------------------------------ seeding (DEV server, admin from localhost)
const hdr = (u) => ({ 'x-dev-user': encodeURIComponent(JSON.stringify(u)) });
async function post(path, body, headers = {}) {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(URL0 + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
    if (r.status === 429) {
      await new Promise((ok) => setTimeout(ok, 800));
      continue;
    }
    const j = await r.json().catch(() => null);
    if (r.status !== 200) console.log(`  seed: ${path} → ${r.status} ${j?.error || ''}`);
    return j;
  }
}
const admin = (name, body) => post('/api/admin/' + name, { confirm: true, reason: 'layout check', ...body });
const LONG_NAME = 'Олександр-Костянтин Ступка-Яременко';
const RICH_CARS = [
  'mercedes-benz-s600-w140-kaban--black', 'mercedes-benz-s600-w140-kaban', 'lamborghini-countach-lp5000-qv--white', 'ford-mustang-gt-2005--hw13',
  'dodge-charger-r-t-1970--fury', 'nissan-gt-r-r35-midnight-purple', 'nissan-skyline-gt-r-r34-sezon-1', 'toyota-supra-a80--night',
  'moskvych-412--rally', 'bmw-750i-e38-bumer--bumer', 'mercedes-benz-e500-w124-vovchok', 'maserati-granturismo-mc-stradale',
  'avtodrop-prototyp-syno-zhovtyi', 'lamborghini-countach-lp5000-qv--r',
];
async function seed() {
  const S = await import('../public/shared.js');
  const fresh = { id: BASE + 1, first_name: 'Новачок', username: 'Новачок' };
  const rich = { id: BASE + 2, first_name: LONG_NAME, username: LONG_NAME };
  await post('/api/me', {}, hdr(fresh));
  const r = (n, b) => post('/api/' + n, b, hdr(rich));
  await r('me');
  await r('intro/seen');
  await r('story/seen');
  await r('guide/off');
  await admin('set', { id: rich.id, field: 'level', value: 30 });
  await admin('set', { id: rich.id, field: 'slots', value: S.MAX_SLOTS });
  await admin('set', { id: rich.id, field: 'showcase_slots', value: S.SHOWCASE_MAX });
  await admin('money', { id: rich.id, amount: 9_940_000_000 });
  await admin('grant-premium', { id: rich.id, what: 'vip', days: 300 });
  await admin('grant-premium', { id: rich.id, what: 'pass' });
  const models = [...RICH_CARS, ...Object.keys(S.MODELS).filter((k) => !RICH_CARS.includes(k)).sort((a, b) => S.MODELS[b].price - S.MODELS[a].price)].slice(0, S.MAX_SLOTS);
  for (const model of models) await admin('give-car', { id: rich.id, model });
  for (const type of Object.keys(S.PARTS).slice(0, 6)) for (const tier of Object.keys(S.TIER_BY_ID)) await admin('part', { id: rich.id, type, tier, count: 3 });
  for (const caseId of Object.keys(S.CASE_BY_ID)) await admin('keys', { id: rich.id, caseId, count: 12 });
  await admin('give-plate', { id: rich.id, text: 'AA 7777 AA', value: 25_000_000 });
  await r('level/seen');
  // An empty tank: the longest refill timer. Straight into the test database (LC_DB), when given.
  if (process.env.LC_DB && existsSync(process.env.LC_DB)) {
    const db = new DatabaseSync(process.env.LC_DB);
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = ?').run(Date.now(), rich.id);
    db.close();
  }
  return { new: fresh, rich };
}

// ------------------------------------------------------------------ states
const TABS = ['city', 'garage', 'cases', 'bazaar', 'menu', 'race', 'shop'];
const PAGES = ['store', 'season', 'quests', 'collection', 'plates', 'market', 'trades', 'tradeNew', 'battles', 'leaderboard', 'upgrade',
  'casino', 'tradein', 'friends', 'promo', 'fair', 'events', 'achievements', 'support', 'challenges', 'dayrace', 'news', 'contest',
  'barn', 'biz', 'club', 'plateAuction', 'showroom', 'tourney'];
// Sheet openers that only show something (no money moves). The first visible one of each kind on a screen is opened.
const OPENERS = ['car', 'carSellMenu', 'carPlate', 'carPaint', 'part', 'keys', 'odds', 'howTo', 'honestHelp', 'streakOpen', 'goalsOpen',
  'eventsOpen', 'casePicker', 'navOpen', 'fuelGifts', 'profileOpen', 'settingsOpen', 'playerCard', 'plateView', 'bossCard', 'refOpen',
  'collMissing', 'dreamPick', 'showcasePick', 'regionPick', 'tnmOpen', 'drOpen', 'challengeOpen', 'upCar', 'bCasePicker', 'prPick',
  'prBoard', 'prHall', 'washPick', 'lotFair', 'bossPickCar', 'pickRaceCar', 'itemSellPartPick', 'itemSellPlatePick'];
// View switches inside a screen (segments, sub-tabs): every variant that isn't the current one is visited too.
const SWITCHES = ['gView', 's2City', 'mKind', 'mTab', 'itemTab', 'raceView', 'shopView', 'collTab', 'questTab', 'lbType', 'tradesTab', 'storeView'];
const want = (name) => !ONLY || ONLY.some((o) => name.includes(o));

// ------------------------------------------------------------------ the in-page analysis
// Runs in the page; returns [{k: kind, s: short selector, t: text, d: detail}]. Restores every scroll position it touches.
function analyze(opts) {
  const W = innerWidth, H = innerHeight, out = [];
  const add = (k, el, d = '') => out.push({ k, s: sel(el), t: txt(el), d });
  function sel(el) {
    if (!el || el.nodeType !== 1) return '?';
    const parts = [];
    for (let e = el, n = 0; e && e.nodeType === 1 && n < 3; e = e.parentElement, n++) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += '#' + e.id;
      const c = [...e.classList].filter((x) => !/^(on|in|i)$/.test(x)).slice(0, 2);
      if (c.length) s += '.' + c.join('.');
      if (e.dataset?.act) s += `[${e.dataset.act}]`;
      parts.unshift(s);
      if (e.id) break;
    }
    return parts.join('>');
  }
  const txt = (el) => (el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const cs = (el) => getComputedStyle(el);
  // The top layer: an open confirm / story / reel / sheet, else the app.
  const layer = document.querySelector('.confirm') || document.querySelector('.story') || document.querySelector('body > .reel') ||
    (!document.querySelector('#modal').hidden ? document.querySelector('#modal') : null) || document.querySelector('#app');
  function visible(el) {
    if (!el.isConnected || el.closest('[hidden], #toast, .coach:not(.open)')) return false;
    const dt = el.closest('details:not([open])');
    if (dt && !el.closest('summary')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    let op = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = cs(e);
      if (s.display === 'none' || (e === el && s.visibility === 'hidden')) return false;
      op *= Number(s.opacity);
      if (op < 0.1) return false;
    }
    return cs(el).visibility !== 'hidden';
  }
  // Scroll boxes (vertical or horizontal) and the document.
  const scrollable = (e) => {
    const s = cs(e);
    return ((/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) || (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1));
  };
  const saved = new Map();
  const remember = (e) => saved.has(e) || saved.set(e, [e.scrollLeft, e.scrollTop]);
  const doc = document.scrollingElement;
  remember(doc);
  // Bring el to the centre of every scroll box around it (innermost first), like scrollIntoView but never scrolling an
  // overflow:hidden box (that would hide the clipping we look for).
  function reveal(el) {
    for (let e = el.parentElement; e; e = e.parentElement) {
      if (e === document.body || e === document.documentElement) break;
      if (!scrollable(e)) continue;
      remember(e);
      const r = el.getBoundingClientRect(), b = e.getBoundingClientRect();
      e.scrollTop += (r.top + r.height / 2) - (b.top + b.height / 2);
      e.scrollLeft += (r.left + r.width / 2) - (b.left + b.width / 2);
    }
    const r = el.getBoundingClientRect();
    if (cs(el).position !== 'fixed') doc.scrollTop += (r.top + r.height / 2) - H / 2;
  }
  // The part of el's box not cut away by its overflow:hidden/clip ancestors (null = cut away completely).
  function clipRect(el) {
    let r = el.getBoundingClientRect();
    let x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = cs(e);
      if (s.position === 'fixed') {
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const b = e.getBoundingClientRect();
          x1 = Math.max(x1, b.left); x2 = Math.min(x2, b.right); y1 = Math.max(y1, b.top); y2 = Math.min(y2, b.bottom);
        }
        break;
      }
      const b = e.getBoundingClientRect();
      if (s.overflowX !== 'visible') (x1 = Math.max(x1, b.left), x2 = Math.min(x2, b.right));
      if (s.overflowY !== 'visible') (y1 = Math.max(y1, b.top), y2 = Math.min(y2, b.bottom));
    }
    return x2 - x1 < 1 || y2 - y1 < 1 ? null : { left: x1, top: y1, right: x2, bottom: y2 };
  }
  const restore = () => {
    for (const [e, [l, t]] of [...saved].reverse()) (e.scrollLeft = l, e.scrollTop = t);
  };
  const interactive = (e) => e.matches('button, a[href], input:not([type=hidden]), select, textarea, [data-act], [role=button], summary');

  // 1. sideways page scroll
  if (doc.scrollWidth > W + 1) {
    const offenders = [...layer.querySelectorAll('*')].filter((e) => {
      if (!visible(e)) return false;
      const c = clipRect(e);
      if (!c || !(c.right > W + 1 || c.left < -1)) return false;
      for (let p = e.parentElement; p; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(cs(p).overflowX) && p !== document.body && p !== document.documentElement) return false;
      return true;
    });
    const top = offenders.filter((e) => !offenders.includes(e.parentElement)).slice(0, 3);
    out.push({ k: 'hscroll', s: top.map(sel).join(' | ') || '?', t: '', d: `scrollWidth ${doc.scrollWidth} > ${W}` });
  }
  // Candidates: controls, leaf texts and images of the top layer.
  const all = [...layer.querySelectorAll('*')];
  const textEls = all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !e.closest('svg, script, style, noscript'));
  const ctrls = all.filter((e) => interactive(e) && !e.disabled);
  const imgs = all.filter((e) => e.tagName === 'IMG');
  const cands = [...new Set([...ctrls, ...textEls, ...imgs])].filter(visible).slice(0, 900);
  const bar = document.querySelector('#tabs'), head = document.querySelector('header.top');
  // a toast is transient and an <img> box is mostly transparent pixels: neither counts as covering
  const own = (el, hit) => !hit || el === hit || el.contains(hit) || hit.contains(el) || hit.tagName === 'IMG' || !!hit.closest('#toast, .coach:not(.open)');
  // (the first-steps coach card drops under the header for ~5 s and folds back into its ring by itself)
  const stickyOf = (e) => {
    for (let p = e; p && p !== document.body; p = p.parentElement) if (/(sticky|fixed)/.test(cs(p).position)) return p;
    return null;
  };
  const tapSmall = [];
  // The hit area: the box, grown by an absolutely placed ::before/::after with negative insets (a common tap-area trick).
  function hitSize(el, r) {
    let w = r.width, h = r.height;
    for (const pe of ['::before', '::after']) {
      const s = getComputedStyle(el, pe);
      if (s.content === 'none' || s.position !== 'absolute' || s.pointerEvents === 'none') continue;
      const v = (x) => (x.endsWith('px') ? parseFloat(x) : 0);
      w = Math.max(w, r.width - v(s.left) - v(s.right));
      h = Math.max(h, r.height - v(s.top) - v(s.bottom));
    }
    return [w, h];
  }
  for (const el of cands) {
    reveal(el);
    const c = clipRect(el), r = el.getBoundingClientRect();
    const isCtrl = ctrls.includes(el);
    // 2. can't be brought on screen
    if (c && (c.left < -1 || c.right > W + 1 || c.top < -1 || c.bottom > H + 1)) {
      if (!(c.top > H || c.bottom < 0) || isCtrl) add('offscreen', el, `${Math.round(c.left)},${Math.round(c.top)}–${Math.round(c.right)},${Math.round(c.bottom)}`);
      continue;
    }
    if (!c) continue;
    // 3. covered (hit test at the centre and 4 inner points of the visible part)
    const pts = [[0.5, 0.5], [0.2, 0.3], [0.8, 0.3], [0.2, 0.7], [0.8, 0.7]];
    const hits = pts.map(([fx, fy]) => document.elementFromPoint(c.left + (c.right - c.left) * fx, c.top + (c.bottom - c.top) * fy));
    const foreign = hits.filter((h) => !own(el, h));
    const centreForeign = !own(el, hits[0]);
    if (foreign.length >= 3 || (isCtrl && centreForeign)) {
      const h = (centreForeign ? hits[0] : foreign[0]);
      if (h && !(el.tagName === 'IMG' && !isCtrl)) {
        const kind = bar?.contains(h) ? 'under-bar' : head?.contains(h) ? 'under-head' : stickyOf(h) && stickyOf(h) !== stickyOf(el) ? 'under-sticky' : 'overlap';
        add(kind, el, 'by ' + sel(h) + (txt(h) ? ` «${txt(h).slice(0, 20)}»` : ''));
      }
    }
    // 4. tap size
    const [hw, hh] = hitSize(el, r);
    if (isCtrl && (hw < 36 || hh < 36) && !el.matches('input[type=checkbox], input[type=radio]')) {
      // a bigger clickable ancestor counts as the target (a link around an icon etc.)
      const big = el.parentElement?.closest('button, a[href], [data-act], label');
      if (!big || big.getBoundingClientRect().height < 36) tapSmall.push(el), add('tap', el, `${Math.round(hw)}×${Math.round(hh)}`);
    }
  }
  restore();
  // 5. text clipped / ellipsis on numbers — text nodes against their overflow-clipping ancestors (at rest)
  const NUM = /\d[\d\s ,.]*\s*(тис|млн|млрд|₴|%|★|⭐|грн|км\/год|к\.с\.)|\d{1,2}:\d{2}|^\s*[×x+−-]?\d[\d\s ,.]*\s*$/i;
  for (const el of textEls) {
    if (!visible(el)) continue;
    const s = cs(el);
    const ell = s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    const clamp = s.webkitLineClamp && s.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 2;
    if (ell || clamp) {
      if (NUM.test(el.textContent) && el.textContent.trim().length <= 24) add('ellnum', el, ell ? `ellipsis ${el.clientWidth}/${el.scrollWidth}` : 'line-clamp');
      continue;
    }
    // own text range against the clipping ancestors
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const tr = rg.getBoundingClientRect();
    // a short value (money, timer, count) broken over two lines: «+9 940 000 000 / ₴»
    const tx = el.textContent.trim();
    const bare = /^[+−-]?\s*[\d\s ,.]+\s*(тис|млн|млрд)?\s*(₴|★|%)?$/.test(tx);
    if (tx.length <= 26 && NUM.test(tx) && /\d/.test(tx) && (s.display !== 'inline' || bare)) {
      const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top / 4)));
      if (tops.size > 1) add('wrapnum', el, `${tops.size} lines`);
    }
    if (tr.width < 1) continue;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const ps = cs(p);
      const hx = /(hidden|clip)/.test(ps.overflowX), hy = /(hidden|clip)/.test(ps.overflowY);
      if (/(auto|scroll)/.test(ps.overflowX + ps.overflowY)) break;
      // a pan/map viewport or a moving strip (case reel, ticker): content beyond its edge is by design
      const pan = p.scrollWidth > p.clientWidth * 1.3 || p.scrollHeight > p.clientHeight * 1.6 || !!el.closest('.reel, [class*=strip], [class*=ticker], [class*=marquee], .s2-pan');
      if ((hx || hy) && ps.display !== 'inline' && !pan) {
        const b = p.getBoundingClientRect();
        const pl = parseFloat(ps.borderLeftWidth), pt = parseFloat(ps.borderTopWidth);
        const cx = hx && (tr.left < b.left + pl - 2 || tr.right > b.left + pl + p.clientWidth + 2);
        const cy = hy && (tr.top < b.top + pt - 3 || tr.bottom > b.top + pt + p.clientHeight + 3);
        if ((cx || cy) && !(p !== el && cs(p).textOverflow === 'ellipsis')) {
          add('clip', el, `${cx ? 'x' : ''}${cy ? 'y' : ''} by ${p === el ? 'self' : sel(p)} text ${Math.round(tr.width)}×${Math.round(tr.height)} box ${p.clientWidth}×${p.clientHeight}`);
        }
        if (ps.position === 'fixed') break;
        if (cx || cy) break;
      }
      if (ps.position === 'fixed') break;
    }
  }
  // 6. text over text (text-node boxes of different elements intersecting)
  const boxes = [];
  for (const el of textEls) {
    if (!visible(el)) continue;
    const rg = document.createRange();
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 2 && r.height > 2) boxes.push({ el, r, c: clipRect(el), st: stickyOf(el) });
    }
  }
  const seenPair = new Set();
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el) || !a.c || !b.c || a.st !== b.st) continue;
    const x = Math.min(a.r.right, b.r.right, a.c.right, b.c.right) - Math.max(a.r.left, b.r.left, a.c.left, b.c.left);
    const y = Math.min(a.r.bottom, b.r.bottom, a.c.bottom, b.c.bottom) - Math.max(a.r.top, b.r.top, a.c.top, b.c.top);
    if (x < 3 || y < Math.min(a.r.height, b.r.height) * 0.35) continue;
    // stacked layers: only a pair painted on the same screen spot, both actually visible there
    const key = sel(a.el) + '|' + sel(b.el);
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    out.push({ k: 'overlap', s: sel(a.el), t: txt(a.el), d: `text over «${txt(b.el).slice(0, 24)}» (${sel(b.el)}) ${Math.round(x)}×${Math.round(y)}` });
  }
  // 7. images
  for (const im of imgs) {
    if (im.closest('[hidden]') || cs(im).display === 'none') continue;
    const r = im.getBoundingClientRect();
    if (im.complete && im.getAttribute('src') && im.naturalWidth === 0) add('img', im, 'broken ' + im.getAttribute('src').slice(-40));
    else if (visible(im.parentElement || im) && (r.width < 1 || r.height < 1) && cs(im).visibility !== 'hidden' && im.getAttribute('src')) add('img', im, '0-size');
  }
  for (const u of layer.querySelectorAll('use')) {
    const id = (u.getAttribute('href') || '').split('#')[1];
    const local = (u.getAttribute('href') || '').startsWith('#');
    if (id && (local ? !document.getElementById(id) : opts.icons && !opts.icons.includes(id))) add('img', u.closest('svg'), 'missing icon #' + id);
  }
  // 8. scroll traps: an inner vertical scroll box taller than 70 % of the screen inside a scrolling page/sheet
  for (const e of all) {
    if (!visible(e)) continue;
    const s = cs(e);
    if (!/(auto|scroll)/.test(s.overflowY) || e.scrollHeight <= e.clientHeight + 4) continue;
    if (e.matches('.sheet, #modal') || s.position === 'fixed') continue;
    let outer = null;
    for (let p = e.parentElement; p; p = p.parentElement) if (p === doc || (/(auto|scroll)/.test(cs(p).overflowY) && p.scrollHeight > p.clientHeight + 4)) { outer = p; break; }
    if (outer && e.clientHeight > H * 0.7) add('trap', e, `inner scroll ${e.clientHeight}px in ${outer === doc ? 'page' : sel(outer)}`);
  }
  return out;
}

// The toast above whatever is open (sheet, confirm).
function zCheck() {
  const t = document.querySelector('#toast');
  const was = t.hidden;
  t.innerHTML = '<span class="toast-tx">перевірка шару</span>';
  t.className = 'toast in';
  t.hidden = false;
  const r = t.getBoundingClientRect();
  const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const ok = h && t.contains(h);
  t.hidden = was;
  return ok ? [] : [{ k: 'z', s: '#toast', t: '', d: 'toast under ' + (h ? h.tagName.toLowerCase() + '.' + [...h.classList].join('.') : '?') }];
}

// Images whose visible pixels sit off the centre of their frame: helmets, frames, car art, badges.
async function centreCheck() {
  const out = [];
  const layer = !document.querySelector('#modal').hidden ? document.querySelector('#modal') : document.querySelector('#app');
  const imgs = [...layer.querySelectorAll('.s2-hel img, [class*=ava] img, [class*=frame] img, .art img, [class*=badge] img, [class*=car] img, .showroom img, [class*=hel] img')]
    .filter((im) => im.complete && im.naturalWidth > 0 && im.getBoundingClientRect().width > 16 && !im.closest('[hidden]')).slice(0, 60);
  const cache = window.__lcBox || (window.__lcBox = new Map());
  for (const im of imgs) {
    const src = im.currentSrc || im.src;
    let box = cache.get(src);
    if (!box) {
      try {
        const w = Math.min(160, im.naturalWidth), h = Math.round(im.naturalHeight * (w / im.naturalWidth));
        const cv = new OffscreenCanvas(w, h), cx = cv.getContext('2d');
        cx.drawImage(im, 0, 0, w, h);
        const d = cx.getImageData(0, 0, w, h).data;
        let x1 = w, y1 = h, x2 = -1, y2 = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) (x < x1 && (x1 = x), x > x2 && (x2 = x), y < y1 && (y1 = y), y > y2 && (y2 = y));
        box = x2 < 0 ? { none: true } : { x1: x1 / w, x2: (x2 + 1) / w, y1: y1 / h, y2: (y2 + 1) / h, opaque: x1 === 0 && y1 === 0 && x2 === w - 1 && y2 === h - 1 };
      } catch {
        box = { none: true };
      }
      cache.set(src, box);
    }
    if (box.none || box.opaque) continue;
    // where the content lands on screen, honouring object-fit: contain/cover and object-position
    const r = im.getBoundingClientRect(), s = getComputedStyle(im);
    let dw = r.width, dh = r.height, ox = 0, oy = 0;
    const ar = im.naturalWidth / im.naturalHeight;
    if (s.objectFit === 'contain' || s.objectFit === 'cover' || s.objectFit === 'scale-down') {
      const fitW = s.objectFit === 'cover' ? r.width / r.height < ar : r.width / r.height > ar;
      if (s.objectFit === 'cover' ? fitW : !fitW) (dw = r.width, dh = r.width / ar); else (dh = r.height, dw = r.height * ar);
      const [px, py] = s.objectPosition.split(' ').map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
      ox = (r.width - dw) * px; oy = (r.height - dh) * py;
    }
    const cx = r.left + ox + dw * (box.x1 + box.x2) / 2, cy = r.top + oy + dh * (box.y1 + box.y2) / 2;
    // the frame: the nearest ancestor that is a visible box (background, border or a different size)
    let f = im.parentElement;
    while (f && f.parentElement) {
      const fr = f.getBoundingClientRect(), fs = getComputedStyle(f);
      const boxy = fs.backgroundImage !== 'none' || (fs.backgroundColor !== 'rgba(0, 0, 0, 0)') || parseFloat(fs.borderTopWidth) > 0 || fs.borderRadius !== '0px';
      if (boxy && (Math.abs(fr.width - r.width) > 2 || Math.abs(fr.height - r.height) > 2 || f.matches('.s2-hel'))) break;
      if (fr.width > r.width * 3) { f = im.parentElement; break; }
      f = f.parentElement;
    }
    const fr = f.getBoundingClientRect();
    if (fr.width > r.width * 1.6 || fr.height > r.height * 1.8) continue; // art placed inside a big card, not framed
    const dx = (cx - (fr.left + fr.width / 2)) / fr.width, dy = (cy - (fr.top + fr.height / 2)) / fr.height;
    const round = /hel|ava|badge|frame/.test(im.parentElement.className + ' ' + f.className);
    if (Math.abs(dx) > 0.08 || (round && Math.abs(dy) > 0.1)) {
      out.push({ k: 'centre', s: f.tagName.toLowerCase() + '.' + [...f.classList].slice(0, 2).join('.') + '>img', t: (im.getAttribute('src') || '').slice(-28), d: `content off centre dx ${(dx * 100).toFixed(0)}% dy ${(dy * 100).toFixed(0)}%` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ driving the app
async function settle(page, ms = 450) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  // finish CSS animations/transitions so boxes are final
  await page.evaluate(() => document.getAnimations().forEach((a) => {
    try {
      if (a.effect?.getTiming().iterations !== Infinity) a.finish();
    } catch {}
  })).catch(() => {});
}
// Close what opened by itself (intro, story, level-up, offers) — each one is checked first as its own state.
async function dismiss(page, record) {
  for (let i = 0; i < 8; i++) {
    const what = await page.evaluate(() => {
      if (document.querySelector('body > .reel')) return 'reel';
      if (document.querySelector('.story')) return 'story';
      if (document.querySelector('.confirm')) return 'confirm';
      if (document.querySelector('.wow, .wow-ov, [class^=hwi]')) return 'wow';
      if (!document.querySelector('#modal').hidden) return 'modal:' + (document.querySelector('#sheet h3')?.textContent || '').slice(0, 30);
      return null;
    });
    if (!what) return;
    if (record && !/^(reel|wow)/.test(what)) await record('popup ' + what);
    await page.evaluate(() => {
      const skip = document.querySelector('.story-skip, .reel .rv-skip, .reel [class*=skip], .hwi-skip, [class*=wow] [class*=close], [class*=wow] [class*=skip]');
      if (skip) return skip.click();
      if (document.querySelector('body > .reel')) return document.querySelector('body > .reel').remove();
      const ok = document.querySelector('#sheet [data-act="giftOk"]'); // a gift window: «Забрати» marks it seen
      if (ok) return ok.click();
      const c = document.querySelector('.confirm [data-ok="0"]');
      if (c) return c.click();
      const x = document.querySelector('#sheet .x');
      if (x) x.click();
      if (!document.querySelector('#modal').hidden) document.querySelector('#modal').hidden = true;
    });
    await settle(page, 350);
  }
}
const goPage = (page, p) => page.evaluate((p) => {
  const b = document.createElement('button');
  b.dataset.act = 'go';
  b.dataset.page = p;
  b.hidden = true;
  document.body.append(b);
  b.click();
  b.remove();
}, p);
const goTab = (page, t) => page.evaluate((t) => document.querySelector(`#tabs button[data-tab="${t}"]`)?.click(), t);

// The rich player's big money gift window («+9 940 000 000 ₴») shows again on every viewport (test DB only).
function regift(uid) {
  if (!process.env.LC_DB || !existsSync(process.env.LC_DB)) return;
  const db = new DatabaseSync(process.env.LC_DB);
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare("UPDATE gifts SET shown = 0 WHERE user_id = ? AND kind = 'money'").run(uid);
  db.close();
}
async function runPlayer(browser, who, user, [w, h], icons, results) {
  if (who === 'rich') regift(user.id);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'uk-UA' });
  await ctx.route(/telegram\.org/, (r) => r.abort());
  const page = await ctx.newPage();
  const failed = [];
  page.on('response', (r) => r.request().resourceType() === 'image' && r.status() >= 400 && failed.push(r.url().replace(URL0, '')));
  page.on('requestfailed', (r) => r.resourceType() === 'image' && !/telegram/.test(r.url()) && failed.push(r.url().replace(URL0, '') + ' (failed)'));
  page.on('pageerror', (e) => results.errors.push(`${who}@${w}: ${e.message.slice(0, 160)}`));
  const vp = `${w}x${h}`;
  const record = async (name) => {
    if (!want(name)) return;
    await settle(page);
    failed.length = 0;
    let issues = await page.evaluate(analyze, { icons }).catch((e) => [{ k: 'error', s: '', t: '', d: e.message.slice(0, 200) }]);
    issues = issues.concat(await page.evaluate(zCheck).catch(() => []), await page.evaluate(centreCheck).catch(() => []));
    await page.waitForTimeout(50);
    for (const u of [...new Set(failed)]) issues.push({ k: 'img', s: 'request', t: '', d: 'failed ' + u.slice(0, 80) });
    const id = `${who}|${name}`;
    (results.states[id] ||= {})[vp] = issues;
    const n = issues.length;
    process.stdout.write(`  ${vp} ${who} ${name}: ${n}\n`);
    if (SHOTS && n) {
      const file = `${LABEL}-${who}-${name.replace(/[^\wа-яіїєґ-]+/gi, '_').slice(0, 40)}-${w}.jpg`;
      await page.screenshot({ path: join(OUT, 'shots', file), type: 'jpeg', quality: 40, fullPage: false }).catch(() => {});
    }
  };
  await page.goto(`${URL0}/?as=${user.id}&name=${encodeURIComponent(user.first_name)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tabs', { timeout: 15000 });
  await settle(page, 1800);
  await dismiss(page, record);
  // the tabs and pages, then the sheets each one opens
  const screens = [...TABS.map((t) => ['tab', t]), ...PAGES.map((p) => ['page', p])];
  for (const [kind, s] of screens) {
    const name = `${kind === 'tab' ? 'tab' : 'pg'}:${s}`;
    if (!want(name) && !ONLY?.some((o) => o.startsWith(name + '>'))) continue;
    await (kind === 'tab' ? goTab(page, s) : goPage(page, s));
    await settle(page, 700);
    await dismiss(page, null);
    if (kind === 'page') await page.evaluate(() => document.querySelector('#title')?.textContent).catch(() => {});
    await record(name);
    // the other views of this screen (segments / sub-tabs)
    const views = await page.evaluate((SW) => [...document.querySelectorAll('#view [data-act]')]
      .filter((e) => SW.includes(e.dataset.act) && e.dataset.k && !e.classList.contains('on') && !e.closest('[hidden]') && e.getClientRects().length)
      .map((e) => [e.dataset.act, e.dataset.k]).filter(([a, k], i, l) => l.findIndex(([a2, k2]) => a2 === a && k2 === k) === i), SWITCHES);
    for (const [a, k] of views.slice(0, 8)) {
      const vname = `${name}~${a}=${k}`;
      if (!want(vname)) continue;
      await page.evaluate(([a, k]) => document.querySelector(`#view [data-act="${a}"][data-k="${k}"]`)?.click(), [a, k]);
      await settle(page, 600);
      const opened = await page.evaluate(() => !document.querySelector('#modal').hidden);
      await record(vname + (opened ? ' (locked sheet)' : ''));
      await dismiss(page, null);
      await (kind === 'tab' ? goTab(page, s) : goPage(page, s));
      await settle(page, 400);
    }
    // the garage's car list (Машини) for the sheets of the long-named cars
    if (s === 'garage') await page.evaluate(() => document.querySelector('#view [data-act="gView"][data-k="cars"]')?.click()), await settle(page, 500);
    // the sheets this screen opens
    const acts = await page.evaluate((OPENERS) => {
      const seen = new Set(), list = [];
      for (const e of document.querySelectorAll('#app [data-act]')) {
        const a = e.dataset.act;
        if (!OPENERS.includes(a) || seen.has(a) || e.closest('[hidden]') || !e.getClientRects().length) continue;
        seen.add(a);
        list.push(a);
      }
      return list;
    }, OPENERS);
    for (const a of acts) {
      const sname = `${name}>${a}`;
      if (!want(sname)) continue;
      // the longest-named one (the «Кабан» car sheet rather than the first car)
      await page.evaluate((a) => {
        const els = [...document.querySelectorAll(`#app [data-act="${a}"]`)].filter((e) => !e.closest('[hidden]') && e.getClientRects().length);
        (els.find((e) => /Кабан/.test(e.textContent)) || els.sort((x, y) => y.textContent.length - x.textContent.length)[0])?.click();
      }, a);
      await settle(page, 600);
      const open = await page.evaluate(() => !document.querySelector('#modal').hidden || !!document.querySelector('.confirm, .story'));
      if (open) await record(sname);
      await dismiss(page, null);
      // an opener may have navigated: get back to the screen
      await (kind === 'tab' ? goTab(page, s) : goPage(page, s));
      await settle(page, 400);
      if (s === 'garage') await page.evaluate(() => document.querySelector('#view [data-act="gView"][data-k="cars"]')?.click()), await settle(page, 400);
    }
  }
  // header sheets
  for (const [name, selr] of [['hdr:gift', '#gift'], ['hdr:avatar', '#avatar'], ['hdr:balance', '#balance']]) {
    if (!want(name)) continue;
    await goTab(page, 'city');
    await settle(page, 400);
    await page.evaluate((s) => document.querySelector(s)?.click(), selr);
    await settle(page, 700);
    await record(name);
    await dismiss(page, null);
  }
  await ctx.close();
}

// ------------------------------------------------------------------ main
const t0 = Date.now();
console.log(`layout check → ${URL0}, out ${OUT}, label ${LABEL}`);
const users = await seed();
const icons = await fetch(URL0 + '/icons.svg').then((r) => r.text()).then((s) => [...s.matchAll(/<symbol[^>]*id="([^"]+)"/g)].map((m) => m[1])).catch(() => null);
const browser = await chromium.launch();
const results = { url: URL0, at: new Date().toISOString(), viewports: VPS.map(([w, h]) => `${w}x${h}`), states: {}, errors: [] };
for (const vp of VPS) for (const who of WHO) {
  console.log(`== ${who} @ ${vp.join('×')}`);
  try {
    await runPlayer(browser, who, users[who], vp, icons, results);
  } catch (e) {
    results.errors.push(`${who}@${vp[0]}: ${e.message.slice(0, 200)}`);
    console.log('  !! ' + e.message.slice(0, 200));
  }
}
await browser.close();
writeFileSync(join(OUT, LABEL + '.json'), JSON.stringify(results, null, 1));
// summary: per screen, issues per kind summed over the viewports
const kinds = ['hscroll', 'offscreen', 'under-bar', 'under-head', 'under-sticky', 'overlap', 'clip', 'ellnum', 'wrapnum', 'tap', 'img', 'centre', 'z', 'trap', 'error'];
const rows = Object.entries(results.states).map(([id, byVp]) => {
  const c = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (const list of Object.values(byVp)) for (const i of list) c[i.k] = (c[i.k] || 0) + 1;
  return [id, c, Object.values(c).reduce((a, b) => a + b, 0)];
});
console.log('\nstate'.padEnd(44) + kinds.map((k) => k.slice(0, 6).padStart(7)).join('') + '  total');
for (const [id, c, n] of rows) console.log(id.padEnd(43) + kinds.map((k) => String(c[k] || '').padStart(7)).join('') + String(n).padStart(7));
const tot = Object.fromEntries(kinds.map((k) => [k, rows.reduce((a, [, c]) => a + (c[k] || 0), 0)]));
console.log('TOTAL'.padEnd(43) + kinds.map((k) => String(tot[k]).padStart(7)).join('') + String(Object.values(tot).reduce((a, b) => a + b, 0)).padStart(7));
if (results.errors.length) console.log('\npage errors:\n  ' + [...new Set(results.errors)].slice(0, 20).join('\n  '));
console.log(`\n${rows.length} states, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
