// Client sweep: opens every tab, page and sub-view of the app in Playwright (phone size) for a fresh player and a
// late-game one, and lists what looks broken: console errors, unhandled rejections, failed requests (4xx/5xx except
// the game's own 400 «GameError» answers, which are shown as toasts), and text on screen with NaN / undefined /
// «[object Object]» / Infinity / null, or negative money.
//   1. DEV=1 PORT=3517 DATA_DIR=<empty dir> node server.js
//   2. NODE_PATH=<dir with playwright> UI_URL=http://localhost:3517 node tools/ui-sweep.mjs [--shots=<dir>] [--clicks]
// The page's module is given a test hook (window.__qa: go, state, PAGES, TABS, render) by appending one line to
// app.js on its way to the browser: nothing in public/ changes. --clicks also taps every [data-act] button once per
// screen (a chaos pass: it may spend the test player's money) and closes what opens.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL0 = process.env.UI_URL || 'http://localhost:3517';
const arg = (k) => process.argv.find((x) => x.startsWith(`--${k}=`))?.split('=')[1];
const SHOTS = arg('shots');
const CLICKS = process.argv.includes('--clicks');
const ONLY = arg('only');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const post = async (p, body, headers = {}) => {
  const r = await fetch(URL0 + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, body: j };
};
const as = (id, name) => ({ 'x-dev-user': encodeURIComponent(JSON.stringify({ id, first_name: name, username: name })) });
const adm = (name, body) => post('/api/admin/' + name, { confirm: true, reason: 'ui sweep', ...body });

// ---------- players ----------
const NEW = 7_100_000 + (Date.now() % 1e5), VET = NEW + 1, FRIEND = NEW + 2;
async function seed() {
  for (const [id, n] of [[NEW, 'uinew'], [VET, 'uivet'], [FRIEND, 'uifriend']]) await post('/api/me', {}, as(id, n + id));
  await adm('money', { id: VET, amount: 5e9 });
  await adm('money', { id: FRIEND, amount: 5e8 });
  for (const f of [['level', 40], ['slots', 30], ['xp', 10]]) await adm('set', { id: VET, field: f[0], value: f[1] });
  await adm('set', { id: FRIEND, field: 'level', value: 12 });
  const models = ['vaz-2107', 'bmw-m3-e30', 'nissan-skyline-r34', 'ferrari-f40', 'lamborghini-aventador', 'porsche-911-gt3'];
  for (const m of models) await adm('give-car', { id: VET, model: m });
  for (const m of models.slice(0, 2)) await adm('give-car', { id: FRIEND, model: m });
  await adm('keys', { id: VET, caseId: 'city', count: 3 });
  await adm('part', { id: VET, type: 'eng', tier: 'street', count: 3 });
  await adm('give-plate', { id: VET, text: 'AA7777AA' });
  await adm('casino-mode', { mode: 'on' });
  const h = as(VET, 'uivet' + VET);
  const me = (await post('/api/me', {}, h)).body;
  const cars = (me?.cars || []).map((c) => c.id);
  await post('/api/case/open', { caseId: 'rust', count: 3 }, h);
  await post('/api/biz/buy', { id: 'wash' }, h);
  await post('/api/club/create', { tag: 'QAUI', name: 'Клуб QA' }, h);
  if (cars[1]) await post('/api/market/sell', { carId: cars[1], price: 500000 }, h);
  if (cars[2]) await post('/api/auction/create', { carId: cars[2], startPrice: 100000, hours: 6 }, h);
  if (cars[3]) await post('/api/pvp/create', { carId: cars[3], bet: 100000 }, h);
  await post('/api/trade/create', { to: FRIEND, give: cars[4] ? [cars[4]] : [], giveMoney: 1000 }, h);
  await post('/api/room/create', {}, h);
  await post('/api/battle/create', { caseId: 'rust', count: 1 }, h);
}

// ---------- scanning ----------
const BAD_TEXT = /\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b|(^|[\s(])null([\s,.)]|$)|-\d[\d\s ]*\s?₴|₴\s?-\d/;
async function scan(page, where, out) {
  const hits = await page.evaluate((re) => {
    const rx = new RegExp(re);
    const res = [];
    const walk = (n) => {
      if (n.nodeType === 3) {
        const t = n.textContent;
        if (rx.test(t) && n.parentElement && n.parentElement.offsetParent !== null) res.push(t.trim().slice(0, 120));
      } else if (n.nodeType === 1 && !['SCRIPT', 'STYLE', 'TEMPLATE'].includes(n.tagName)) n.childNodes.forEach(walk);
    };
    walk(document.body);
    for (const el of document.querySelectorAll('[title],[alt],[placeholder]')) for (const a of ['title', 'alt', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && rx.test(v)) res.push(`${a}="${v.slice(0, 80)}"`);
    }
    return res;
  }, BAD_TEXT.source);
  for (const h of hits) out.push({ kind: 'text', where, msg: h });
}

async function sweep(browser, uid, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'uk-UA' });
  const page = await ctx.newPage();
  const out = [];
  let where = 'boot';
  page.on('console', (m) => {
    if (m.type() === 'error' && !/telegram\.org|favicon|ERR_NAME|ERR_INTERNET|net::ERR_FAILED.*telegram/i.test(m.text())) out.push({ kind: 'console', where, msg: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) => out.push({ kind: 'pageerror', where, msg: String(e?.stack || e).slice(0, 400) }));
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.startsWith(URL0)) return;
    if (r.status() >= 500 || (r.status() >= 400 && r.status() !== 400 && r.status() !== 429)) out.push({ kind: 'http', where, msg: `${r.status()} ${u.slice(URL0.length)}` });
  });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(URL0) && !/aborted/i.test(r.failure()?.errorText || '')) out.push({ kind: 'reqfail', where, msg: `${r.failure()?.errorText} ${r.url().slice(URL0.length)}` });
  });
  await page.route('**/telegram-web-app.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route(/\/app\.js(\?.*)?$/, async (route) => {
    const resp = await route.fetch();
    const body = (await resp.text()) + '\n;window.__qa = { go, state, PAGES, TABS, render, me: () => me, closeModal };\n';
    route.fulfill({ response: resp, body, headers: { ...resp.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  await page.goto(`${URL0}/?as=${uid}&name=${name}${uid}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__qa && window.__qa.me && window.__qa.me(), null, { timeout: 20000 }).catch(() => out.push({ kind: 'boot', where, msg: 'no __qa / me after 20 s' }));
  await page.waitForTimeout(1500);
  // close intro / welcome windows that cover the screen
  const closeAll = async () => {
    await page.evaluate(() => {
      try {
        window.__qa.closeModal();
      } catch {}
      document.querySelectorAll('.overlay, .intro, #intro').forEach((e) => e.remove?.());
    });
  };
  await closeAll();
  const views = await page.evaluate(() => ({ tabs: Object.keys(window.__qa.TABS || {}), pages: Object.keys(window.__qa.PAGES || {}) }));
  const SUB = {
    garage: [['garageView', 'cars']],
    race: [['raceView', 'race'], ['raceView', 'drift'], ['raceView', 'pvp']],
    shop: [['shopView', 'cases'], ['shopView', 'paint'], ['shopView', 'wash']],
    market: [['marketTab', 'buy'], ['marketTab', 'auction'], ['marketTab', 'pier']],
    quests: [['questTab', 'day'], ['questTab', 'week']],
    store: [['storeView', 'shop'], ['storeView', 'style']],
    trades: [['tradesTab', 'hall']],
  };
  const list = [];
  for (const t of views.tabs) for (const s of SUB[t] || [[null, null]]) list.push({ tab: t, page: null, sub: s });
  for (const p of views.pages) for (const s of SUB[p] || [[null, null]]) list.push({ tab: 'menu', page: p, sub: s });
  for (const v of list) {
    where = `${name}:${v.page ? 'page/' + v.page : 'tab/' + v.tab}${v.sub[0] ? '.' + v.sub[1] : ''}`;
    if (ONLY && !where.includes(ONLY)) continue;
    await page.evaluate((v) => {
      const Q = window.__qa;
      Q.state.tab = v.tab;
      if (v.sub[0]) Q.state[v.sub[0]] = v.sub[1];
      if (v.page) Q.go(v.page);
      else {
        Q.state.page = null;
        Q.render();
      }
    }, v).catch((e) => out.push({ kind: 'nav', where, msg: String(e).slice(0, 200) }));
    await page.waitForTimeout(900);
    await scan(page, where, out);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${where.replace(/[^a-z0-9.-]+/gi, '_')}.jpg`), type: 'jpeg', quality: 45 }).catch(() => {});
    if (CLICKS) {
      const n = await page.locator('[data-act]:visible').count();
      for (let i = 0; i < Math.min(n, 25); i++) {
        const el = page.locator('[data-act]:visible').nth(i);
        const act = await el.getAttribute('data-act').catch(() => null);
        if (!act || /delete|reset|leave|disband|cancel|logout|share|invoice|stars|pay/i.test(act)) continue;
        const w0 = where;
        where = `${w0} click:${act}`;
        await el.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(500);
        await scan(page, where, out);
        await closeAll();
        where = w0;
        // a click may have navigated: put the screen back
        await page.evaluate((v) => {
          const Q = window.__qa;
          Q.state.tab = v.tab;
          if (v.sub[0]) Q.state[v.sub[0]] = v.sub[1];
          Q.state.race = null;
          Q.state.drift = null;
          if (v.page) Q.go(v.page);
          else (Q.state.page = null, Q.render());
        }, v).catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  }
  await ctx.close();
  return { list: list.length, out };
}

const browser = await chromium.launch();
await seed();
const res = [];
for (const [id, n] of [[NEW, 'new'], [VET, 'vet']]) {
  const r = await sweep(browser, id, n);
  console.log(`${n}: ${r.list} screens, ${r.out.length} findings`);
  res.push(...r.out);
}
await browser.close();
const seen = new Map();
for (const f of res) {
  const k = f.kind + '|' + f.msg.replace(/\d+/g, '#');
  if (!seen.has(k)) seen.set(k, { ...f, n: 0, wheres: new Set() });
  seen.get(k).n++;
  seen.get(k).wheres.add(f.where);
}
for (const f of seen.values()) console.log(`- [${f.kind}] ×${f.n} ${f.msg}\n    at ${[...f.wheres].slice(0, 6).join(', ')}`);
process.exit(seen.size ? 1 : 0);
