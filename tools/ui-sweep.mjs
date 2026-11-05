// Client sweep: opens every tab, page and sub-view of the app in Playwright (phone size) for a fresh player and a
// late-game one, and lists what looks broken: console errors, unhandled rejections, failed requests (4xx/5xx except
// the game's own 400 «GameError» answers, which are shown as toasts), and text on screen with NaN / undefined /
// «[object Object]» / Infinity / null, or negative money.
//   1. DEV=1 PORT=3517 DATA_DIR=<empty dir> node server.js
//   2. NODE_PATH=<dir with playwright> UI_URL=http://localhost:3517 node tools/ui-sweep.mjs [--shots=<dir>] [--clicks] [--today] [--who=none]
// --today adds the 05.11 checks (todayChecks below: intro A, splash, photos, paint, crates, EV parts); --who=none skips the sweep.
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
const NEW = 7_100_000 + (Date.now() % 1e5), VET = NEW + 1, FRIEND = NEW + 2, EDGE = NEW + 3;
const WHO = (arg('who') || 'new,vet,edge').split(',');
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
  // edge: broke (0 ₴), empty tank, XP piled over today's level cap, a car on the market
  await post('/api/me', {}, as(EDGE, 'uiedge' + EDGE));
  const eb = (await post('/api/me', {}, as(EDGE, 'uiedge' + EDGE))).body;
  await adm('give-car', { id: EDGE, model: 'vaz-2107' });
  const ec = (await post('/api/me', {}, as(EDGE, 'uiedge' + EDGE))).body?.cars || [];
  if (ec[1]) await post('/api/market/sell', { carId: ec[1].id, price: 50000 }, as(EDGE, 'uiedge' + EDGE));
  await adm('money', { id: EDGE, amount: -1e13 });
  await adm('set', { id: EDGE, field: 'xp', value: 5e6 });
  void eb;
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
  const push0 = out.push.bind(out);
  out.push = (f) => (process.env.UI_LIVE && console.log(`  [${f.kind}] ${f.where}: ${f.msg.slice(0, 200)}`), push0(f));
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
      document.querySelectorAll('.overlay, .intro, #intro, .confirm, #confirm').forEach((e) => e.remove?.());
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
  // pages that only open from a list with an id in state (a battle, a room, a lot, a business, a player) are skipped
  const CTX = new Set(['battle', 'room', 'lot', 'bizOne', 'user']);
  for (const p of views.pages) if (!CTX.has(p)) for (const s of SUB[p] || [[null, null]]) list.push({ tab: 'menu', page: p, sub: s });
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

// Leaving a race / drift that is still in its lights or 3·2·1 (n5-bugs): the header balance must refuse, and after any
// other way off the screen the bottom bar must work again (it said «Спочатку доїдь …» on every tab until a reload).
async function leaveRunCheck(browser, uid, name, out) {
  for (const [view, act] of [['race', 'startRace'], ['drift', 'startDrift']]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const where = `${name}:leave-${view}`;
    pg.on('pageerror', (e) => out.push({ kind: 'pageerror', where, msg: String(e?.stack || e).slice(0, 400) }));
    await pg.route('**/telegram-web-app.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await pg.route(/\/app\.js(\?.*)?$/, async (route) => {
      const resp = await route.fetch();
      route.fulfill({ response: resp, body: (await resp.text()) + '\n;window.__qa = { state, render, closeModal };\n' });
    });
    await pg.goto(`${URL0}/?as=${uid}&name=${name}${uid}`);
    await pg.waitForFunction(() => window.__qa, null, { timeout: 20000 });
    await pg.waitForTimeout(1500);
    await pg.getByText('Пропустити').click({ timeout: 1000 }).catch(() => {});
    const nav = (v) => pg.evaluate((v) => (window.__qa.closeModal(), Object.assign(window.__qa.state, { tab: 'race', page: null, raceView: v }), window.__qa.render()), v);
    await nav(view);
    await pg.waitForTimeout(2500);
    const b = pg.locator(`[data-act="${act}"]:not([data-rival="train"])`).first();
    if (!(await b.count())) {
      out.push({ kind: 'leave', where, msg: 'no rival to start (seed?)' });
      await ctx.close();
      continue;
    }
    const shut = () => pg.evaluate(() => (window.__qa.closeModal(), document.querySelectorAll('#modal').forEach((m) => (m.hidden = true))));
    await shut();
    await b.click({ timeout: 5000 });
    await pg.waitForTimeout(300);
    await shut();
    await pg.locator('#balance').click({ timeout: 5000 });
    await pg.waitForTimeout(300);
    const st = await pg.evaluate(() => [window.__qa.state.tab, window.__qa.state.page]);
    if (st[0] !== 'race' || st[1]) out.push({ kind: 'leave', where, msg: `the balance button left a running ${view}: ${st}` });
    await pg.evaluate(() => (Object.assign(window.__qa.state, { tab: 'menu', page: 'store' }), window.__qa.render())); // a banner / deep link
    await pg.waitForTimeout(2500);
    await pg.locator('#tabs button[data-tab="garage"]').click({ timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(500);
    const t = await pg.evaluate(() => window.__qa.state.tab);
    if (t !== 'garage') out.push({ kind: 'leave', where, msg: `the bottom bar stays locked after leaving a ${view} in its countdown (tab ${t})` });
    await ctx.close();
  }
}

// ---------- r3 (05.11 merges): --today ----------
// intro A for a newcomer at 320×568 / 430×932 (in the screen, skip and tap work), no intro for a veteran, the splash
// never stays (also when /api/me or /api/config fails), every car photo loads, every key car repaints, every country
// case shows its crate, the EV parts show on an EV car.
async function todayPage(browser, uid, name, out, { vp = [390, 844], route = null, where = name } = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 1, locale: 'uk-UA' });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => out.push({ kind: 'pageerror', where, msg: String(e?.stack || e).slice(0, 400) }));
  pg.on('console', (m) => m.type() === 'error' && !/telegram\.org|favicon|ERR_NAME|ERR_INTERNET|status of 5\d\d/i.test(m.text()) && !(route && /ERR_FAILED/.test(m.text())) && out.push({ kind: 'console', where, msg: m.text().slice(0, 300) }));
  await pg.route('**/telegram-web-app.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await pg.route(/\/app\.js(\?.*)?$/, async (r) => {
    const resp = await r.fetch();
    const body = (await resp.text()) + '\n;window.__qa = { state, render, closeModal, carSheet, me: () => me, PAINT, S, hasPhoto: (id) => !!config.images?.[id] };\n';
    r.fulfill({ response: resp, body, headers: { ...resp.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  if (route) await route(pg);
  const t0 = Date.now();
  await pg.goto(`${URL0}/?as=${uid}&name=${name}${uid}`, { waitUntil: 'load' });
  return { ctx, pg, t0 };
}
const splashGoneIn = async (pg, ms) => pg.waitForFunction(() => !document.querySelector('body > .s2-splash'), null, { timeout: ms }).then(() => true, () => false);
async function todayChecks(browser, out) {
  // 1. intro A for a newcomer, two phone sizes; skip on one, tap-to-end + CTA on the other
  for (const [i, [vp, how]] of [[[320, 568], 'skip'], [[320, 568], 'tap'], [[360, 640], 'tap'], [[430, 932], 'tap']].entries()) {
    const id = NEW + 100 + i, where = `intro-A ${vp.join('×')} ${how}`;
    const { ctx, pg } = await todayPage(browser, id, 'intro', out, { vp, where });
    if (!(await pg.waitForSelector('body > .reel.cine', { timeout: 15000 }).then(() => true, () => false))) {
      out.push({ kind: 'intro', where, msg: 'no cinematic intro A for a new player' });
      await ctx.close();
      continue;
    }
    if (!(await splashGoneIn(pg, 5000))) out.push({ kind: 'splash', where, msg: 'the splash is still up 5 s after the intro mounted' });
    const geo = () => pg.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect().toJSON() || null;
      const el = document.querySelector('.reel.cine');
      return { W: innerWidth, H: innerHeight, sw: document.documentElement.scrollWidth, cine: r('.reel.cine'), go: r('.cn-go'), skip: r('.cn-skip'), t: r('.cn-t'), p: r('.cn-p'), k: r('.cn-k'), hero: r('.cn-car[data-car="hero"] .cn-img'),
        top: (() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return e ? (e.closest('.reel.cine') ? 'cine' : e.closest('.s2-splash') ? 'splash' : e.tagName + '.' + e.className) : null; })(),
        cls: el?.className || '' };
    });
    const inside = (b, g) => b && b.width > 0 && b.left >= -1 && b.top >= -1 && b.right <= g.W + 1 && b.bottom <= g.H + 1;
    let g = await geo();
    if (g.top !== 'cine') out.push({ kind: 'intro', where, msg: `the centre of the screen is ${g.top}, not the intro` });
    if (!inside(g.cine, g) || g.cine.width < g.W - 1 || g.cine.height < g.H - 1) out.push({ kind: 'intro', where, msg: `the intro does not cover the screen: ${JSON.stringify(g.cine)}` });
    if (!inside(g.skip, g) || g.skip.height < 30) out.push({ kind: 'intro', where, msg: `«Пропустити» off screen or too small: ${JSON.stringify(g.skip)}` });
    if (g.sw > g.W + 1) out.push({ kind: 'intro', where, msg: `sideways scroll ${g.sw} > ${g.W}` });
    if (how === 'skip') {
      await pg.locator('.cn-skip').click({ timeout: 3000 });
      await pg.waitForTimeout(700);
      if (await pg.locator('body > .reel.cine').count()) out.push({ kind: 'intro', where, msg: '«Пропустити» did not close the intro' });
    } else {
      await pg.mouse.click(vp[0] / 2, vp[1] / 2); // a tap before the CTA: straight to the end frame
      await pg.waitForTimeout(500);
      g = await geo();
      if (!/\bdone\b/.test(g.cls)) out.push({ kind: 'intro', where, msg: `a tap did not jump to the end (${g.cls})` });
      for (const k of ['go', 't', 'p']) if (!inside(g[k], g)) out.push({ kind: 'intro', where, msg: `end frame: .cn-${k} outside the screen ${JSON.stringify(g[k])}` });
      // the end text must not sit on the hero car (its photo's bottom is the tyres' bottom)
      if (g.k && g.hero && g.k.top < g.hero.bottom - 10) out.push({ kind: 'intro', where, msg: `end frame: «Твій хід» (top ${Math.round(g.k.top)}) is on the hero car (tyres at ${Math.round(g.hero.bottom)})` });
      if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `today-intro-${vp.join('x')}.jpg`), type: 'jpeg', quality: 45 });
      await pg.locator('.cn-go').click({ timeout: 3000 });
      await pg.waitForTimeout(700);
      if (await pg.locator('body > .reel.cine').count()) out.push({ kind: 'intro', where, msg: 'the CTA did not close the intro' });
      const tab = await pg.evaluate(() => window.__qa.state.tab);
      if (tab !== 'cases') out.push({ kind: 'intro', where, msg: `after the CTA the tab is ${tab}, not the cases` });
    }
    await ctx.close();
  }
  // 2. a veteran (cases opened) and a player who saw the intro: no intro; the splash goes
  const SEEN = NEW + 110;
  await post('/api/me', {}, as(SEEN, 'uiseen' + SEEN));
  await post('/api/intro/seen', {}, as(SEEN, 'uiseen' + SEEN));
  for (const [id, n] of [[VET, 'vet'], [SEEN, 'seen']]) {
    const where = `no-intro ${n}`;
    const { ctx, pg } = await todayPage(browser, id, 'ui' + n, out, { where });
    if (!(await splashGoneIn(pg, 6000))) out.push({ kind: 'splash', where, msg: 'the splash is still up 6 s after load' });
    await pg.waitForTimeout(1500);
    if (await pg.locator('body > .reel').count()) out.push({ kind: 'intro', where, msg: 'an intro showed for a veteran' });
    await ctx.close();
  }
  // 3. the splash never stays: /api/me failing, /api/config failing, a tap
  for (const [label, rt] of [['me 500', (pg) => pg.route('**/api/me', (r) => r.fulfill({ status: 500, body: '{}' }))],
    ['config abort', (pg) => pg.route('**/api/config', (r) => r.abort())], ['paint meta abort', (pg) => pg.route('**/paint/meta.json*', (r) => r.abort())],
    ['config null', (pg) => pg.route('**/api/config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))],
    ['boot throws', (pg) => pg.route(/\/app\.js(\?.*)?$/, async (r) => { // any exception in boot (here thrown on purpose)
      const resp = await r.fetch();
      const body = (await resp.text()).replace('PAINT.watchLooks(document.body);', "PAINT.watchLooks(document.body); throw new Error('qa: boot threw');");
      r.fulfill({ response: resp, body, headers: { ...resp.headers(), 'content-length': String(Buffer.byteLength(body)) } });
    })]]) {
    const thrown = label === 'boot throws';
    const where = `splash ${label}`;
    const { ctx, pg } = await todayPage(browser, VET, 'uivet', out, { route: rt, where });
    if (!(await splashGoneIn(pg, 8000))) out.push({ kind: 'splash', where, msg: 'the splash never went away' });
    if (thrown) out.splice(0, out.length, ...out.filter((f) => !(f.where === where && /qa: boot threw/.test(f.msg))));
    await ctx.close();
  }
  // 4. photos, paint, crates, EV parts — as the veteran (level 40, an EV car given in seed)
  const where = 'art';
  const { ctx, pg } = await todayPage(browser, VET, 'uivet', out, { where });
  await pg.waitForFunction(() => window.__qa?.me?.(), null, { timeout: 20000 });
  await splashGoneIn(pg, 6000);
  const art = await pg.evaluate(async () => {
    const { S, PAINT } = window.__qa;
    const load = (src) => new Promise((ok) => {
      const im = new Image();
      im.onload = () => ok(im.naturalWidth > 0 ? null : 'empty');
      im.onerror = () => ok('error');
      im.src = src;
    });
    const bad = [];
    const ids = Object.keys(S.MODELS);
    for (let i = 0; i < ids.length; i += 24) {
      await Promise.all(ids.slice(i, i + 24).map(async (id) => {
        const m = S.MODELS[id], src = PAINT.photoUrl(m.img && !window.__qa.hasPhoto(id) ? m.img : id); // a livery uses its base model's photo
        if (m.secret && !src) return;
        const e = await load(src);
        if (e) bad.push(`photo ${id}: ${e} (${src})`);
      }));
    }
    const keys = Object.entries(S.FACTORY_PAINT).filter(([, v]) => v.key).map(([k]) => k);
    const paints = Object.keys(S.PAINT_BY_ID);
    let painted = 0;
    for (const [i, id] of keys.entries()) {
      if (!PAINT.canPaint(id)) {
        bad.push(`key car ${id}: no paint mask (canPaint false)`);
        continue;
      }
      const url = await PAINT.renderLook(id, { paint: paints[i % paints.length] });
      if (!url) bad.push(`key car ${id}: repaint failed`);
      else painted++;
    }
    return { bad, painted, keys: keys.length, photos: ids.length };
  });
  for (const b of art.bad) out.push({ kind: 'art', where, msg: b });
  console.log(`today: ${art.photos} photos checked, ${art.painted}/${art.keys} key cars repainted`);
  // country crates on the cases tab
  await pg.evaluate(() => (window.__qa.closeModal(), Object.assign(window.__qa.state, { tab: 'cases', page: null }), window.__qa.render()));
  await pg.waitForTimeout(1500);
  const crates = await pg.evaluate(async () => {
    const { S } = window.__qa;
    const want = [...new Set(S.CASES.filter((c) => c.country).map((c) => c.country.toLowerCase()))];
    const imgs = [...document.querySelectorAll('img.s2-cimg')];
    const shown = new Set(imgs.map((i) => /\/c-([a-z]+)\.webp/.exec(i.getAttribute('src'))?.[1]).filter(Boolean));
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
    const broken = imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src'));
    const opened = await Promise.all(want.map((k) => fetch(`s2/case/o-${k}.webp`).then((r) => (r.ok ? null : `o-${k} ${r.status}`))));
    const flags = [...document.querySelectorAll('.s2-cflag')].length;
    return { want, shown: [...shown], broken, opened: opened.filter(Boolean), flags };
  });
  for (const k of crates.want) if (!crates.shown.includes(k)) out.push({ kind: 'crate', where, msg: `country case ${k}: no crate on the cases tab (round flag instead?)` });
  for (const b of [...crates.broken, ...crates.opened]) out.push({ kind: 'crate', where, msg: `crate art did not load: ${b}` });
  // EV parts on an EV car's СТО
  const ev = await pg.evaluate(async () => {
    const Q = window.__qa, c = Q.me().cars.find((x) => Q.S.MODELS[x.model].ev && x.status === 'garage');
    if (!c) return { none: true };
    Q.state.carMode = 'tune';
    Q.carSheet(c.id);
    await new Promise((r) => setTimeout(r, 1200));
    const imgs = [...document.querySelectorAll('#sheet .s2t-p img')];
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
    const types = [...document.querySelectorAll('#sheet .s2t-p')].map((b) => b.dataset.type);
    return { model: c.model, types, srcs: imgs.map((i) => i.getAttribute('src')), broken: imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')) };
  });
  if (ev.none) out.push({ kind: 'ev', where, msg: 'no EV car in the garage (seed?)' });
  else {
    for (const t of ['motor', 'battery', 'reducer']) if (!ev.srcs.includes(`s2/pt/${t}.webp`)) out.push({ kind: 'ev', where, msg: `${ev.model}: no s2/pt/${t}.webp on the СТО (types ${ev.types.join(',')})` });
    for (const b of ev.broken) out.push({ kind: 'ev', where, msg: `${ev.model}: part art did not load ${b}` });
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'today-ev-sto.jpg'), type: 'jpeg', quality: 45 });
  }
  await ctx.close();
}

const browser = await chromium.launch();
await seed();
const res = [];
if (process.argv.includes('--today')) {
  await adm('give-car', { id: VET, model: 'tesla-model-y' });
  await todayChecks(browser, res);
}
if (WHO.includes('vet')) await leaveRunCheck(browser, VET, 'vet', res);
for (const [id, n] of [[NEW, 'new'], [VET, 'vet'], [EDGE, 'edge']].filter(([, n]) => WHO.includes(n))) {
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
