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

// ---------- r6 (06.11 merges, Season 2 «Місто» day): --r6 ----------
// At 320×568, 390×844, 430×932: the «Перші кроки» coach card reserves its own space (no overlap with the page top, no
// gap left once it folds, no jump of a scrolled page), it is not over a drop result; the DROP dock never covers the
// last row; ×N stays picked over an opening and the DROP tab goes back to the case list; «Майстерня» on the city map at
// levels 1/2/3; the war map is all free with «Знайти автоклуб» on screen; the pass card Д (Aurora's baked picture, the
// live layers for any other car) and the car card А; the race result cars on the road; no «Токіо» on the pass.
const R6_VP = (arg('vp') || '320x568,390x844,430x932').split(',').map((s) => s.split('x').map(Number));
async function r6Page(browser, uid, name, vp, out, where) {
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 1, locale: 'uk-UA' });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => out.push({ kind: 'pageerror', where: where(), msg: String(e?.stack || e).slice(0, 400) }));
  pg.on('console', (m) => m.type() === 'error' && !/telegram\.org|favicon|ERR_NAME|ERR_INTERNET/i.test(m.text()) && out.push({ kind: 'console', where: where(), msg: m.text().slice(0, 300) }));
  await pg.route('**/telegram-web-app.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await pg.route(/\/app\.js(\?.*)?$/, async (r) => {
    const resp = await r.fetch();
    const body = (await resp.text()) + '\n;window.__qa = { state, render, closeModal, carSheet, go, H, S, me: () => me, refresh };\n';
    r.fulfill({ response: resp, body, headers: { ...resp.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  await pg.goto(`${URL0}/?as=${uid}&name=${name}${uid}`, { waitUntil: 'load' });
  // iOS WebKit (the owner's iPhone, Telegram) has no scroll anchoring: Chromium would hide a jump of a scrolled page
  if (!process.env.R6_ANCHOR) await pg.addStyleTag({ content: 'html, body, #view { overflow-anchor: none; }' });
  await pg.waitForFunction(() => window.__qa?.me?.(), null, { timeout: 20000 });
  await splashGoneIn(pg, 8000);
  await pg.waitForTimeout(800);
  await pg.evaluate(() => document.querySelectorAll('body > .reel.cine').forEach((e) => e.querySelector('.cn-skip')?.click()));
  await pg.waitForTimeout(400);
  for (let i = 0; i < 4; i++) { // gift windows (the seed's admin money) would cover the screenshots
    const b = pg.locator('#modal:not([hidden]) button', { hasText: /Забрати/i });
    if (!(await b.count())) break;
    await b.first().click({ timeout: 1500 }).catch(() => {});
    await pg.waitForTimeout(500);
  }
  return { ctx, pg };
}
const r6nav = (pg, o) => pg.evaluate((o) => {
  const Q = window.__qa;
  Q.closeModal();
  Object.assign(Q.state, { page: null, race: null, drift: null, ...o });
  if (o.page) Q.go(o.page);
  else Q.render();
}, o);
// The page's top content (first painted element of #view) vs the coach card; the tab bar's top.
const coachGeo = (pg) => pg.evaluate(() => {
  const g = document.getElementById('guide'), v = document.getElementById('view');
  const first = [...(v?.children || [])].find((e) => e.getBoundingClientRect().height > 4 && getComputedStyle(e).visibility !== 'hidden');
  const fr = first?.getBoundingClientRect(), gr = g?.getBoundingClientRect();
  return { y: scrollY, guide: gr ? { top: gr.top, bottom: gr.bottom, out: g.classList.contains('out') } : null, first: fr ? { top: fr.top, abs: fr.top + scrollY, cls: first.className } : null,
    before: parseFloat(getComputedStyle(v, '::before').height) || 0, push: document.body.classList.contains('coach-push'), tabsTop: document.getElementById('tabs')?.getBoundingClientRect().top ?? innerHeight, H: innerHeight };
});
async function r6Checks(browser, out) {
  let where = 'r6';
  const W = () => where;
  const shot = async (pg, n) => SHOTS && pg.screenshot({ path: path.join(SHOTS, `r6-${n.replace(/[^a-z0-9.-]+/gi, '_')}.jpg`), type: 'jpeg', quality: 40 }).catch(() => {});
  let k = 0;
  for (const vp of R6_VP) {
    const tag = vp.join('×');
    // ---- a new player: coach card, DROP dock, ×N, DROP tab, achievements quiet
    const id = NEW + 300 + k++;
    await post('/api/me', {}, as(id, 'r6n' + id));
    await post('/api/intro/seen', {}, as(id, 'r6n' + id));
    const { ctx, pg } = await r6Page(browser, id, 'r6n', vp, out, W);
    for (const tab of ['garage', 'cases', 'city', 'menu']) {
      where = `${tag} new coach ${tab}`;
      await pg.evaluate(() => window.scrollTo(0, 0));
      await r6nav(pg, { tab, s2case: false, drop: null });
      await pg.evaluate(() => window.__qa.H.coachToggle?.()); // the card open by hand (the tall one: hint text + buttons)
      await pg.waitForTimeout(450);
      const g = await coachGeo(pg);
      if (!g.guide) {
        out.push({ kind: 'coach', where, msg: 'no coach card for a new player' });
        continue;
      }
      if (g.first && g.first.top < g.guide.bottom - 1) out.push({ kind: 'coach', where, msg: `the card (bottom ${Math.round(g.guide.bottom)}) covers the page top (${g.first.cls} at ${Math.round(g.first.top)})` });
      if (g.first && g.first.top - g.guide.bottom > 24) out.push({ kind: 'coach', where, msg: `a ${Math.round(g.first.top - g.guide.bottom)} px gap under the card` });
      if (tab === 'city') {
        const c = await pg.evaluate(() => {
          const r = (s) => document.querySelector(s)?.getBoundingClientRect();
          const sh = r('.s2-city > .s2-sheet'), map = r('#s2Map'), tabs = document.getElementById('tabs').getBoundingClientRect();
          return { sheet: sh && { top: sh.top, bottom: sh.bottom }, map: map && map.height, tabsTop: tabs.top, sw: document.documentElement.scrollHeight - innerHeight };
        });
        if (c.sheet && c.sheet.bottom > c.tabsTop + 1) out.push({ kind: 'coach', where, msg: `the city's bottom sheet goes under the bar while the card is down (sheet bottom ${Math.round(c.sheet.bottom)}, bar ${Math.round(c.tabsTop)})` });
        if (c.map != null && c.map < 110) out.push({ kind: 'coach', where, msg: `the city map is squeezed to ${Math.round(c.map)} px by the card` });
      }
      if (vp[0] === 390) await shot(pg, `${tag}-coach-${tab}`);
      // scrolled down, the card folding must not move what is under the finger
      const scrollable = await pg.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      if (scrollable <= 150 || tab === 'city') await pg.evaluate(() => window.__qa.H.coachToggle?.());
      if (scrollable > 150 && tab !== 'city') {
        // past the reserved strip (a strip still partly on screen just closes — that is not a jump)
        const sy = await pg.evaluate((g) => (window.scrollTo(0, Math.min(document.documentElement.scrollHeight - innerHeight, (g.guide?.bottom || 150) + 40)), scrollY), g);
        if (sy < (g.guide?.bottom || 0)) out.push({ kind: 'coach-skip', where, msg: `page too short to test the scrolled fold (${Math.round(sy)} px)` });
        await pg.waitForTimeout(100);
        // the element under the middle of the screen: where it is before and after (marked, so the same one is measured)
        const probe = () => pg.evaluate(() => {
          let e = document.querySelector('[data-r6probe]');
          if (!e) {
            // content only: a container round the strip (main, #view itself) moves with it by design
            const v = document.getElementById('view');
            for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7]) {
              const x = document.elementFromPoint(innerWidth / 2, innerHeight * fy);
              if (x && x !== v && v.contains(x) && !['sticky', 'fixed'].includes(getComputedStyle(x).position)) (e = x);
              if (e) break;
            }
            e?.setAttribute('data-r6probe', '1');
          }
          return e ? { top: e.getBoundingClientRect().top, sig: e.tagName + '.' + e.className } : null;
        });
        const a = await probe();
        await pg.evaluate(() => window.__qa.H.coachToggle?.()); // folds into the ring (the same coachFold as the 5 s timer)
        await pg.waitForTimeout(700);
        const b = await probe(), g2 = await coachGeo(pg);
        if (process.env.R6_DEBUG) console.log(where, scrollable, JSON.stringify(a), JSON.stringify(b), g2.before, g2.y);
        await pg.evaluate(() => document.querySelector('[data-r6probe]')?.removeAttribute('data-r6probe'));
        if (a && b && Math.abs(a.top - b.top) > 2) out.push({ kind: 'coach', where, msg: `the page jumped ${Math.round(b.top - a.top)} px while scrolled when the card folded` });
        if (g2.before > 1 && (!g2.guide || g2.guide.out)) out.push({ kind: 'coach', where, msg: `the card folded but the page still keeps ${Math.round(g2.before)} px for it` });
      }
    }
    // the case page: the dock never covers the last row
    where = `${tag} new dock`;
    await r6nav(pg, { tab: 'cases', drop: null, s2case: false });
    await pg.waitForTimeout(500);
    const dockCheck = async (label) => {
      const r = await pg.evaluate(async () => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise((ok) => setTimeout(ok, 350));
        const dock = document.querySelector('#view .s2-dock, #view .drop-dock');
        if (!dock) return { none: true };
        // the dock paints a solid strip under itself (::after, top 100%) over whatever follows it: that covers too
        const d0 = dock.getBoundingClientRect(), af = getComputedStyle(dock, '::after');
        const ds = getComputedStyle(dock);
        const strip = af.content && af.content !== 'none' && af.display !== 'none' && af.position === 'absolute' && ds.position !== 'static' && ds.overflow === 'visible' && ds.overflowY === 'visible' && !/paint|strict|content/.test(ds.contain) ? parseFloat(af.height) || 0 : 0;
        const d = { top: d0.top, bottom: d0.bottom + strip, left: d0.left, right: d0.right, height: d0.height };
        const tabs = document.getElementById('tabs').getBoundingClientRect();
        const bad = [];
        for (const e of document.querySelectorAll('#view button, #view .s2-cc, #view .card, #view .s2-cl-row, #view a, #view .tiny, #view .s2-note, #view .s2-card, #view h2, #view h3, #view b')) {
          if (dock.contains(e) || e.contains(dock) || !e.offsetParent) continue;
          const r = e.getBoundingClientRect();
          if (r.height < 4 || r.bottom <= 0) continue;
          // the strip (z −1 in the dock) is painted under a later box that is its own stacking context (the glass cards:
          // backdrop-filter, a transform…) — only plain content right after the dock is covered by it
          const ownLayer = (x) => {
            for (; x && x.id !== 'view'; x = x.parentElement) {
              const c = getComputedStyle(x);
              if (c.backdropFilter !== 'none' || c.transform !== 'none' || c.filter !== 'none' || c.isolation === 'isolate' || Number(c.opacity) < 1 || (c.position !== 'static' && c.zIndex !== 'auto')) return true;
            }
            return false;
          };
          const under = r.top < d0.bottom - 2 || !ownLayer(e);
          if (under && r.bottom > d.top + 2 && r.top < d.bottom - 2 && r.right > d.left && r.left < d.right) bad.push(`${e.tagName}.${e.className} «${(e.textContent || '').trim().slice(0, 30)}» ${Math.round(r.top)}–${Math.round(r.bottom)} under the dock ${Math.round(d.top)}–${Math.round(d.bottom)}`);
          else if (r.bottom > tabs.top + 2 && r.top < tabs.top) bad.push(`${e.tagName}.${e.className} «${(e.textContent || '').trim().slice(0, 30)}» under the bar`);
        }
        return { bad: bad.slice(0, 4), dockH: Math.round(d.height), dbg: [dock.className, ds.position, ds.zIndex, ds.overflow, ds.contain, af.content, af.display, af.height, af.top, af.zIndex].join(' ') };
      });
      if (r.none) return out.push({ kind: 'dock', where: `${where} ${label}`, msg: 'no dock' });
      for (const b of r.bad) out.push({ kind: 'dock', where: `${where} ${label}`, msg: b });
      if (process.env.R6_DEBUG) console.log('dock', label, r.dbg);
      return r;
    };
    await dockCheck('case list');
    const firstCase = await pg.evaluate(() => window.__qa.me().keys?.starter ? 'starter' : 'rust');
    await r6nav(pg, { tab: 'cases', drop: null, s2case: true, caseId: firstCase });
    await pg.waitForTimeout(500);
    await dockCheck('case page');
    // starter first (the guide), then a rust case ×3: the pick stays ×3 on the drop and after the DROP tab
    await post('/api/case/open', { caseId: 'starter', count: 1 }, as(id, 'r6n' + id));
    await adm('money', { id, amount: 5e7 });
    await pg.evaluate(() => window.__qa.refresh());
    await r6nav(pg, { tab: 'cases', drop: null, s2case: true, caseId: 'rust', fast: true });
    await pg.waitForTimeout(400);
    await pg.locator('#view [data-act="pickCount"][data-n="3"]').first().click({ timeout: 3000 }).catch(() => out.push({ kind: 'count', where, msg: 'no ×3 button' }));
    await pg.waitForTimeout(200);
    const open = pg.locator('#view [data-act="openCase"]').first();
    if (await open.count()) {
      await open.click({ timeout: 3000 });
      await pg.waitForFunction(() => window.__qa.state.drop?.length && !window.__qa.state.opening, null, { timeout: 20000 }).catch(() => out.push({ kind: 'count', where, msg: 'no drop after opening ×3' }));
      await pg.waitForTimeout(2600);
      where = `${tag} new drop`;
      if (await pg.locator('#guide:not(.out)').count()) out.push({ kind: 'coach', where, msg: 'the coach card is over the drop result' });
      const on = await pg.evaluate(() => [...document.querySelectorAll('#view [data-act="pickCount"].on')].map((b) => b.dataset.n));
      if (on.length && !on.every((n) => n === '3')) out.push({ kind: 'count', where, msg: `×3 not kept on the drop screen (on: ${on})` });
      await dockCheck('drop');
      if (vp[0] === 390 || vp[0] === 320) await shot(pg, `${tag}-drop3`);
      if (process.env.R6_STRIP) (await pg.addStyleTag({ content: '#view .drop-dock::after, #view .s2-dock::after { background: #f0f !important; }' }), await shot(pg, `${tag}-drop3-strip`));
      await pg.locator('#tabs button[data-tab="cases"]').click({ timeout: 3000 });
      await pg.waitForTimeout(500);
      const s = await pg.evaluate(() => ({ drop: window.__qa.state.drop, s2case: window.__qa.state.s2case, count: window.__qa.state.count, list: !!document.querySelector('#view [data-act="s2Pick"], #view .s2-cc, #view [data-act="s2Case"]') }));
      if (s.drop?.length) out.push({ kind: 'droptab', where, msg: 'DROP tab on a drop result did not close it' });
      if (s.s2case) out.push({ kind: 'droptab', where, msg: 'DROP tab on a drop result went to the case page, not the case list' });
      if (s.count !== 3) out.push({ kind: 'count', where, msg: `×N reset to ${s.count} after the DROP tab` });
      await r6nav(pg, { tab: 'cases', s2case: true, caseId: 'rust' });
      await pg.waitForTimeout(300);
      const on2 = await pg.evaluate(() => [...document.querySelectorAll('#view [data-act="pickCount"].on')].map((b) => b.dataset.n));
      if (on2.join() !== '3') out.push({ kind: 'count', where, msg: `the case page shows ×${on2} after an opening, not ×3` });
    } else out.push({ kind: 'count', where, msg: 'no open button on the rust case' });
    // no room: 2 free places, ×6 picked → the drop screen offers the count that fits; the wording names places
    where = `${tag} new noroom`;
    const me0 = (await post('/api/me', {}, as(id, 'r6n' + id))).body;
    await adm('set', { id, field: 'slots', value: me0.used + 2 });
    await pg.evaluate(() => window.__qa.refresh());
    await r6nav(pg, { tab: 'cases', s2case: true, caseId: 'rust', drop: null });
    await pg.locator('#view [data-act="pickCount"][data-n="6"]').first().click({ timeout: 3000 }).catch(() => {});
    await pg.waitForTimeout(300);
    const nr = await pg.evaluate(() => ({ t: document.querySelector('#view .s2-open, #view .s2-dock')?.textContent?.trim().slice(0, 120), note: document.querySelector('#view .s2-note')?.textContent?.trim() }));
    if (nr.t && /\bз\b\s*\d/.test(nr.t)) out.push({ kind: 'noroom', where, msg: `«з» between numbers reads as «3»: ${nr.t}` });
    await dockCheck('noroom case page');
    if (vp[0] === 320) await shot(pg, `${tag}-noroom`);
    await adm('set', { id, field: 'slots', value: 30 });
    // the war map: free districts, the banner, «Знайти автоклуб» on screen
    where = `${tag} new war`;
    await r6nav(pg, { tab: 'city', cityView: 'war' });
    await pg.waitForTimeout(700);
    const war = await pg.evaluate(() => {
      const b = document.querySelector('.s2-war .s2-btn')?.getBoundingClientRect(), tabs = document.getElementById('tabs').getBoundingClientRect();
      return { free: document.querySelectorAll('.s2-free polygon').length, soon: !!document.querySelector('.s2-war-soon'), leg: document.querySelectorAll('.s2-leg span').length,
        btn: b && { top: b.top, bottom: b.bottom }, tabsTop: tabs.top, own: [...document.querySelectorAll('.s2-pin-t small')].map((e) => e.textContent).filter((t) => t !== 'вільний') };
    });
    if (!war.free || !war.soon || war.leg) out.push({ kind: 'war', where, msg: `war map not neutral: ${JSON.stringify(war)}` });
    if (war.own.length) out.push({ kind: 'war', where, msg: `districts with an owner: ${war.own.join(', ')}` });
    if (!war.btn || war.btn.bottom > war.tabsTop + 1) out.push({ kind: 'war', where, msg: `«Знайти автоклуб» not on screen (${JSON.stringify(war.btn)}, bar ${Math.round(war.tabsTop)})` });
    if (vp[0] === 320) await shot(pg, `${tag}-war`);
    await ctx.close();
    // ---- «Майстерня» on the city map at levels 1/2/3
    for (const lvl of [1, 2, 3]) {
      const wid = NEW + 400 + k * 10 + lvl;
      where = `${tag} workshop L${lvl}`;
      await post('/api/me', {}, as(wid, 'r6w' + wid));
      await post('/api/intro/seen', {}, as(wid, 'r6w' + wid));
      if (lvl > 1) await adm('set', { id: wid, field: 'level', value: lvl });
      const { ctx: c2, pg: p2 } = await r6Page(browser, wid, 'r6w', vp, out, W);
      await r6nav(p2, { tab: 'city', cityView: 'city' });
      await p2.waitForTimeout(700);
      // drag the map to its left end (the building stands at x 168 of 1920)
      const m = await p2.locator('#s2Map').boundingBox();
      if (m) {
        await p2.mouse.move(m.x + 30, m.y + m.height / 2);
        await p2.mouse.down();
        await p2.mouse.move(m.x + m.width - 10, m.y + m.height / 2, { steps: 8 });
        await p2.mouse.up();
        await p2.mouse.move(m.x + 30, m.y + m.height / 2);
        await p2.mouse.down();
        await p2.mouse.move(m.x + m.width - 10, m.y + m.height / 2, { steps: 8 });
        await p2.mouse.up();
        await p2.waitForTimeout(900);
      }
      const lb = await p2.evaluate(() => {
        const e = document.querySelector('.s2-lb[data-k="workshop"]');
        if (!e) return null;
        const r = e.getBoundingClientRect(), mp = document.getElementById('s2Map').getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { text: e.textContent.trim(), hid: e.classList.contains('s2-hid'), inside: r.left >= mp.left - 1 && r.right <= mp.right + 1 && r.top >= mp.top - 1 && r.bottom <= mp.bottom + 1, top: hit && (hit === e || e.contains(hit)) };
      });
      if (!lb) {
        out.push({ kind: 'workshop', where, msg: 'no «Майстерня» building on the city map' });
        await c2.close();
        continue;
      }
      if (lb.hid || !lb.inside || !lb.top) out.push({ kind: 'workshop', where, msg: `the label can't be tapped after dragging to it: ${JSON.stringify(lb)}` });
      if (lvl < 3 && !/рів\.\s?3/.test(lb.text)) out.push({ kind: 'workshop', where, msg: `the label does not say the parts level: «${lb.text}»` });
      if (lvl >= 3 && /рів\./.test(lb.text)) out.push({ kind: 'workshop', where, msg: `a level chip at level ${lvl}: «${lb.text}»` });
      await p2.evaluate(() => document.querySelector('.s2-lb[data-k="workshop"]').click());
      await p2.waitForTimeout(700);
      const r = await p2.evaluate(() => ({ tab: window.__qa.state.tab, view: window.__qa.state.shopView, toast: document.getElementById('toast')?.hidden ? '' : document.getElementById('toast')?.textContent, h: document.querySelector('#view')?.textContent.slice(0, 80) }));
      const want = lvl === 1 ? { tab: 'city' } : lvl === 2 ? { tab: 'shop', view: 'wash' } : { tab: 'shop', view: 'cases' };
      if (r.tab !== want.tab || (want.view && r.view !== want.view)) out.push({ kind: 'workshop', where, msg: `tap → tab ${r.tab} / ${r.view}, expected ${JSON.stringify(want)} (toast «${r.toast}»)` });
      if (lvl === 1 && !/2-го рівня/.test(r.toast || '')) out.push({ kind: 'workshop', where, msg: `level 1: toast «${r.toast}»` });
      if (lvl === 2 && !/3-го рівня/.test(r.toast || '')) out.push({ kind: 'workshop', where, msg: `level 2: no word on the parts level (toast «${r.toast}»)` });
      if (vp[0] === 320) await shot(p2, `${tag}-workshop-L${lvl}`);
      await c2.close();
    }
    // ---- the veteran: pass card Д (Aurora + another car), car card А, race result
    const { ctx: c3, pg: p3 } = await r6Page(browser, VET, 'uivet', vp, out, W);
    for (const other of [null, 'ferrari-f40']) {
      where = `${tag} vet pass ${other || 'aurora'}`;
      if (other) await p3.route('**/api/season', async (r) => {
        const resp = await r.fetch();
        const j = await resp.json();
        r.fulfill({ response: resp, body: JSON.stringify({ ...j, car: other }), headers: { ...resp.headers(), 'content-type': 'application/json' } });
      });
      await r6nav(p3, { tab: 'menu', page: 'season' });
      await p3.waitForTimeout(1800);
      await p3.locator('.season-car').scrollIntoViewIfNeeded().catch(() => {});
      await p3.waitForTimeout(1200);
      const p = await p3.evaluate(async () => {
        const box = document.querySelector('.season-car .showroom.stg-d');
        if (!box) return { none: true, txt: document.querySelector('#view')?.textContent.slice(0, 200) };
        const imgs = [...box.querySelectorAll('img')];
        await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
        const b = box.getBoundingClientRect(), car = box.querySelector('.stg-car img, .stg-car svg')?.getBoundingClientRect();
        const bg = getComputedStyle(box).backgroundImage;
        return { baked: !!box.querySelector('.stg-baked'), broken: imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')), w: b.width, h: b.height,
          car: car && { l: car.left - b.left, r: b.right - car.right, t: car.top - b.top, b: b.bottom - car.bottom, w: car.width, h: car.height }, bg: /pass-showroom/.test(bg),
          tokyo: /Токіо/.test(document.getElementById('view').textContent), title: document.querySelector('.season-car b')?.textContent };
      });
      if (p.none) out.push({ kind: 'pass', where, msg: `no stage Д on the pass page: ${p.txt}` });
      else {
        if (!other && !p.baked) out.push({ kind: 'pass', where, msg: 'Aurora without its baked showroom picture' });
        if (other && p.baked) out.push({ kind: 'pass', where, msg: `${other} shows Aurora's baked picture` });
        if (!p.bg) out.push({ kind: 'pass', where, msg: 'no showroom background' });
        for (const s of p.broken) out.push({ kind: 'pass', where, msg: `image did not load ${s}` });
        if (!p.car || p.car.w < 50 || p.car.l < -1 || p.car.r < -1 || p.car.t < -1 || p.car.b < -1) out.push({ kind: 'pass', where, msg: `the live car is not inside the stage: ${JSON.stringify(p.car)} box ${Math.round(p.w)}×${Math.round(p.h)}` });
        if (p.tokyo) out.push({ kind: 'pass', where, msg: '«Токіо» on the pass page' });
      }
      await shot(p3, `${tag}-pass-${other || 'aurora'}`);
      if (other) await p3.unroute('**/api/season');
    }
    where = `${tag} vet car card`;
    const cs = await p3.evaluate(async () => {
      const Q = window.__qa, c = Q.me().cars.find((x) => x.status === 'garage');
      Q.closeModal();
      Q.carSheet(c.id);
      await new Promise((r) => setTimeout(r, 1200));
      const box = document.querySelector('#sheet .s2c-stage.stg-a, .s2c-stage.stg-a');
      if (!box) return { none: true };
      const b = box.getBoundingClientRect(), car = box.querySelector('.stg-car img, .stg-car svg')?.getBoundingClientRect();
      return { car: car && { l: car.left - b.left, r: b.right - car.right, t: car.top - b.top, b: b.bottom - car.bottom, w: car.width }, sw: document.documentElement.scrollWidth, W: innerWidth };
    });
    if (cs.none) out.push({ kind: 'carcard', where, msg: 'no stage А on the car card' });
    else if (!cs.car || cs.car.w < 50 || cs.car.t < -1 || cs.car.b < -1) out.push({ kind: 'carcard', where, msg: `car not inside stage А: ${JSON.stringify(cs.car)}` });
    await shot(p3, `${tag}-carcard`);
    await p3.evaluate(() => window.__qa.closeModal());
    await c3.close();
  }
}

const browser = await chromium.launch();
await seed();
if (process.argv.includes('--r6')) {
  const r6 = [];
  await r6Checks(browser, r6);
  for (const f of r6) console.log(`- [${f.kind}] ${f.where}: ${f.msg}`);
  console.log(`r6: ${r6.length} findings`);
  if (process.argv.includes('--r6only')) (await browser.close(), process.exit(r6.length ? 1 : 0));
}
const res = [];
if (process.argv.includes('--today')) {
  await adm('give-car', { id: VET, model: 'tesla-model-y' });
  await todayChecks(browser, res);
}
if (WHO.includes('vet')) await leaveRunCheck(browser, VET, 'vet', res);
// --ids=11,38: existing players of the database too (e.g. veterans on a copy after the Season 2 wipe)
const EXTRA = (arg('ids') || '').split(',').filter(Boolean).map((x) => [Number(x), 'id' + x]);
for (const [id, n] of [[NEW, 'new'], [VET, 'vet'], [EDGE, 'edge']].filter(([, n]) => WHO.includes(n)).concat(EXTRA)) {
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
