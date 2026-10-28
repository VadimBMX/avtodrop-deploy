// Progression and newcomer sim for the economy audit (reports/econ-fable/economy.md). Bots play the real engine
// (in-memory DB, fast clock, fixed seeds) like tools/sim-night.mjs; every profile is a way real players play:
//   seller   — a newcomer who opens the cheapest case he can pay for with ALL his money and sells every drop at once
//              but his best car («відкрив — продав»); 3 sessions a day; an average driver.
//   keeper   — a newcomer who keeps his cars, spends 60% of his money on the dearest case that fits, sells the cheapest
//              car only when the garage is full; 3 sessions; an average driver.
//   casual   — 2 sessions a day, keeps cars, spends 60%.
//   active   — 5 sessions a day, keeps cars, spends 80%.
//   whale    — level 50, 3 млрд ₴, 40 slots, the 30 dearest A/S cars; 5 sessions; opens the dearest case ×6 with 30% of
//              his money each session and keeps the drops that beat his worst car.
//   grinder  — the exploit profile: level 10, 20 млн ₴, 8 sessions a day; every session opens the case with the best
//              open-and-sell return (×6, with all his money, up to 60 opens a session) and sells every drop at once.
//   node tools/sim-progress.mjs [days=30] [profiles=seller,keeper,casual,active,whale,grinder] [n=4] [out.json]
//   ROOT=<another checkout> node tools/sim-progress.mjs ...   — the same bots on another build
// Prints per profile and day (1, 2, 3, 7, 14, 30): median balance, garage value, income/h, level, cases opened a day,
// min balance seen, rescue keys taken, «stuck» sessions (under one cheap case, empty tank, nothing to claim).
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const ROOT = process.env.ROOT ? pathToFileURL(process.env.ROOT.replace(/\/?$/, '/')).href : new URL('../', import.meta.url).href;
const { openDb } = await import(ROOT + 'src/db.js');
const { createGame } = await import(ROOT + 'src/game.js');
const S = await import(ROOT + 'public/shared.js');
const { honestDrag } = await import(ROOT + 'test/race-helpers.js');
const { caseReturns } = await import(ROOT + 'tools/sim-cases.mjs');

const DAYS = Number(process.argv[2] || 30);
const PROFILES = (process.argv[3] || 'seller,keeper,casual,active,whale,grinder').split(',');
const N = Number(process.argv[4] || 4);
const OUT = process.argv.find((a) => a.endsWith('.json'));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(2811);
const T0 = Date.parse('2026-11-02T00:00:00Z'); // a Monday: the UA country week, the case of the day rotates
const db = openDb(':memory:');
db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('buyer_seed', 'sim-progress')").run();
let t = T0;
const g = createGame(db, { now: () => t, notify: () => {}, random: rng(99) });
const SESS = { seller: [10, 15, 21], keeper: [10, 15, 21], casual: [9, 21], active: [8, 11, 14, 17, 21], whale: [8, 11, 14, 17, 21], grinder: [8, 10, 12, 14, 16, 18, 20, 22] };
const SPEND = { seller: 1, keeper: 0.6, casual: 0.6, active: 0.8, whale: 0.3, grinder: 1 };
// Driver: reaction window and shift quality odds [perfect, good] (the rest late).
const DRIVER = { seller: [0.25, 0.5, 0.15, 0.6], keeper: [0.25, 0.5, 0.15, 0.6], casual: [0.18, 0.2, 0.35, 0.85], active: [0.18, 0.2, 0.35, 0.85], whale: [0.18, 0.2, 0.35, 0.85], grinder: [0.18, 0.2, 0.35, 0.85] };
// The plain-day open-and-sell of every case on this build (fixed seed, 50k opens) — what the grinder chases.
const RET = Object.fromEntries(S.CASES.filter((c) => !c.starter).map((c) => [c.id, caseReturns(c, 5e4, 3).normal]));

const bots = [];
for (const kind of PROFILES) {
  for (let i = 0; i < N; i++) {
    const id = 920000 + bots.length;
    g.ensureUser({ id, first_name: kind + i });
    db.prepare('UPDATE users SET server_seed = ?, client_seed = ? WHERE id = ?').run(`prog:${id}`, 'prog', id);
    bots.push({ id, kind, days: [], minBal: Infinity, rescues: 0, stuck: 0, sessions: 0 });
  }
}
const WHALE_CARS = S.ALL_MODELS.filter((m) => !m.secret && !m.edition && !m.homeOnly && !m.restored && ['A', 'S'].includes(m.cls)).sort((a, b) => b.price - a.price).slice(0, 30);
for (const b of bots) {
  if (b.kind === 'whale') {
    db.prepare('UPDATE users SET level = 50, xp = 0, balance = 3e9, slots = 40, cases_opened = 500 WHERE id = ?').run(b.id);
    for (const m of WHALE_CARS) g.giveCar(b.id, m.id);
  } else if (b.kind === 'grinder') {
    db.prepare('UPDATE users SET level = 10, xp = 0, balance = 20e6, slots = 12, cases_opened = 100 WHERE id = ?').run(b.id);
    g.giveCar(b.id, 'bmw-m3-e46');
  }
  if (b.kind === 'whale' || b.kind === 'grinder') {
    if (db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'intro'").get()) db.prepare('UPDATE users SET intro = 1 WHERE id = ?').run(b.id);
    db.prepare("INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, 'intro')").run(b.id);
  }
}

const call = (b, name, body) => g.api[name](b.id, body);
const tryCall = (b, name, body) => {
  if (!g.api[name]) return null;
  try {
    return call(b, name, body);
  } catch {
    return null;
  }
};
const balOf = (b) => db.prepare('SELECT balance FROM users WHERE id = ?').get(b.id).balance;
let day = 0;
const cur = (b) => (b.days[day] ||= { f: {}, opens: 0, races: 0, sold: 0 });
const book = (b, cat, v) => (cur(b).f[cat] = (cur(b).f[cat] || 0) + v);
function booked(b, cat, fn) {
  const before = balOf(b);
  const r = fn();
  book(b, cat, balOf(b) - before);
  return r;
}
function claimAll(b) {
  let claims = [];
  try {
    claims = call(b, 'pulse').claims || [];
  } catch {
    return;
  }
  if (claims.some((c) => c.kind === 'rescue')) b.rescues++;
  for (const c of claims) {
    const cat = { daily: 'daily', rcase: 'reward case', newbie: 'newbie', quest: 'goals', coll: 'collection', rescue: 'rescue', ach: 'achievements', achAll: 'achievements', pass: 'season pass', goalkey: 'goal key', gstreak: 'goal run', set: 'sets', weekly: 'weekly', wchest: 'weekly', fire: 'streak' }[c.kind];
    if (!cat) continue;
    booked(b, cat, () => {
      if (c.kind === 'daily') tryCall(b, 'rewards/daily');
      else if (c.kind === 'rcase') tryCall(b, 'rewards/case');
      else if (c.kind === 'newbie') tryCall(b, 'newbie/claim');
      else if (c.kind === 'quest') tryCall(b, 'quests/claim', { key: c.id });
      else if (c.kind === 'coll') tryCall(b, 'collection/claim', { key: c.id });
      else if (c.kind === 'rescue') tryCall(b, 'rescue/claim');
      else if (c.kind === 'ach' || c.kind === 'achAll') tryCall(b, 'ach/claim', c.kind === 'ach' ? { key: c.id } : {});
      else if (c.kind === 'pass') tryCall(b, 'season/claim');
      else if (c.kind === 'goalkey') tryCall(b, 'goals/key');
      else if (c.kind === 'gstreak') tryCall(b, 'goals/streak');
      else if (c.kind === 'set') tryCall(b, 'sets/claim', { id: c.id });
      else if (c.kind === 'weekly') tryCall(b, 'weekly/claim', { key: c.id });
      else if (c.kind === 'wchest') tryCall(b, 'weekly/chest', { days: c.id });
      else if (c.kind === 'fire') tryCall(b, 'streak/claim');
    });
  }
}
// The daily goals get «done» at the day's last session (what they cost — a wash, a plate — is not counted).
function finishGoals(b) {
  const d = db.prepare('SELECT MAX(day) d FROM quests WHERE user_id = ?').get(b.id)?.d;
  if (d) db.prepare('UPDATE quests SET progress = target WHERE user_id = ? AND day = ?').run(b.id, d);
}
function race(b) {
  const [r0, r1, pP, pG] = DRIVER[b.kind];
  for (let n = 0; n < 40; n++) {
    const me = call(b, 'me');
    if (me.fuel < 1) return;
    const car = me.cars.filter((c) => c.status === 'garage').sort((x, y) => y.value - x.value)[0];
    if (!car) return;
    let list;
    try {
      ({ list } = call(b, 'race/rivals', { carId: car.id }));
    } catch {
      return;
    }
    const r = list.map((x) => ({ ...x, ev: (x.chance / 100) * x.prize - (1 - x.chance / 100) * x.entry })).sort((x, y) => y.ev - x.ev)[0];
    if (!r || r.ev <= 0 || r.entry > me.balance) return;
    booked(b, 'races', () => {
      const st = call(b, 'race/start', { carId: car.id, rival: r.id });
      const reaction = r0 + R() * r1;
      const shifts = Array.from({ length: S.SHIFTS }, () => (R() < pP ? 'perfect' : R() < pG ? 'good' : 'late'));
      const run = honestDrag(st.car, st.greenMs, reaction, shifts);
      t += Math.ceil(run.ms) + 50;
      call(b, 'race/finish', { raceId: st.raceId, ...run.body });
    });
    cur(b).races++;
    t += 6e3;
  }
}
// Sell the cheapest cars (never the last one, never a secret car) until `free` slots are open.
function makeRoom(b, free) {
  const me = call(b, 'me');
  const cars = me.cars.filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret).sort((x, y) => x.value - y.value);
  const need = me.used + free - me.slots;
  if (need <= 0) return true;
  const sell = cars.slice(0, need).map((c) => c.id);
  if (sell.length < need || cars.length - sell.length < 1) return false;
  booked(b, 'sales', () => call(b, 'sell', { carIds: sell }));
  cur(b).sold += sell.length;
  return true;
}
// Sell everything but the best car (seller, grinder).
function sellAll(b) {
  const me = call(b, 'me');
  const cars = me.cars.filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret).sort((x, y) => y.value - x.value);
  const ids = cars.slice(1).map((c) => c.id);
  if (!ids.length) return;
  booked(b, 'sales', () => tryCall(b, 'sell', { carIds: ids }));
  cur(b).sold += ids.length;
}
function openKeys(b) {
  for (const [caseId, n] of Object.entries(call(b, 'me').keys || {})) {
    if (!S.CASE_BY_ID[caseId] || !n) continue;
    for (let left = n; left > 0;) {
      const k = caseId === 'starter' ? 1 : [6, 3, 1].find((x) => x <= left && x <= call(b, 'me').slots - 1);
      if (!makeRoom(b, k)) return;
      const r = booked(b, 'cases', () => tryCall(b, 'case/open', { caseId, count: k }));
      if (!r) return;
      cur(b).opens += k;
      left -= k;
    }
  }
}
function spend(b) {
  const share = SPEND[b.kind];
  const maxOpens = b.kind === 'grinder' ? 60 : b.kind === 'whale' ? 6 : 18;
  let opens = 0;
  for (let guard = 0; guard < 20 && opens < maxOpens; guard++) {
    const me = call(b, 'me');
    if (b.kind !== 'grinder' && b.kind !== 'seller') {
      if (me.slots < S.MAX_SLOTS && S.slotCost(me.slots) < me.balance * 0.15) {
        booked(b, 'slots (sink)', () => tryCall(b, 'buy-slot'));
        continue;
      }
      const capNext = S.CAP_LEVELS[me.capLevel + 1];
      if (capNext && capNext.cost < me.balance * 0.1) {
        booked(b, 'storage (sink)', () => tryCall(b, 'upgrade-cap'));
        continue;
      }
      const tankNext = S.nextTank?.(me.tankLvl);
      if (tankNext && me.level >= tankNext.level && tankNext.cost < me.balance * 0.2 && g.api['tank/upgrade']) {
        booked(b, 'tank (sink)', () => tryCall(b, 'tank/upgrade'));
        continue;
      }
    }
    const budget = me.balance * share;
    let cs;
    if (b.kind === 'grinder') cs = S.CASES.filter((c) => !c.starter && c.price * 6 <= budget).sort((x, y) => RET[y.id] - RET[x.id] || y.price - x.price)[0];
    else if (b.kind === 'seller') cs = S.CASES.filter((c) => !c.starter && c.price <= budget).sort((x, y) => x.price - y.price)[0]; // the cheapest he can pay for
    else cs = S.CASES.filter((c) => !c.starter && c.price <= budget).sort((x, y) => y.price - x.price)[0];
    if (!cs) return;
    const n = [6, 3, 1].find((k) => cs.price * k <= budget && k <= me.slots - 1); // one car always stays
    if (!n || !makeRoom(b, n)) return;
    const r = booked(b, 'cases', () => tryCall(b, 'case/open', { caseId: cs.id, count: n }));
    if (!r) return;
    opens += n;
    cur(b).opens += n;
    if (b.kind === 'seller' || b.kind === 'grinder') sellAll(b);
  }
}

for (day = 0; day < DAYS; day++) {
  for (let h = 0; h < 24; h++) {
    t = T0 + (day * 24 + h) * 3600e3 + 7 * 60e3;
    for (const b of bots) {
      if (!SESS[b.kind].includes(h)) continue;
      b.sessions++;
      const me0 = call(b, 'me');
      const claims = (tryCall(b, 'pulse')?.claims || []).length;
      // Stuck: not even the cheapest case, an empty tank and nothing to claim — the player can only wait.
      if (me0.balance < S.CASE_BY_ID['c-ua'].price && me0.fuel < 1 && !claims && !Object.values(me0.keys || {}).some(Boolean)) b.stuck++;
      b.minBal = Math.min(b.minBal, me0.balance);
      if (me0.keys?.starter) {
        booked(b, 'cases', () => tryCall(b, 'case/open', { caseId: 'starter', count: 1 }));
        cur(b).opens++;
      }
      claimAll(b);
      booked(b, 'income', () => tryCall(b, 'collect'));
      race(b);
      if (h === SESS[b.kind][SESS[b.kind].length - 1]) {
        finishGoals(b);
        call(b, 'me');
      }
      claimAll(b);
      openKeys(b);
      spend(b);
      b.minBal = Math.min(b.minBal, balOf(b));
    }
  }
  for (const b of bots) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(b.id);
    const me = call(b, 'me');
    Object.assign(cur(b), { level: u.level, balance: u.balance, garage: u.total_value, income: me.income.rate, cars: me.cars.length, slots: u.slots, coll: me.collection.length });
  }
}

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f = (n) => S.short(Math.round(n)).replace(' ₴', '');
const out = { root: ROOT, days: DAYS, n: N, ret: RET, kinds: {} };
console.log(`ROOT ${ROOT}  days ${DAYS}  bots per profile ${N}`);
console.log('plain-day open-and-sell on this build: ' + Object.entries(RET).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
for (const kind of PROFILES) {
  const bs = bots.filter((b) => b.kind === kind);
  out.kinds[kind] = {
    rows: Array.from({ length: DAYS }, (_, d) => {
      const rows = bs.map((b) => b.days[d] || { f: {} });
      const faucet = (k) => mean(rows.map((r) => r.f[k] || 0));
      return { day: d + 1, balance: med(rows.map((r) => r.balance || 0)), garage: med(rows.map((r) => r.garage || 0)), income: med(rows.map((r) => r.income || 0)),
        level: med(rows.map((r) => r.level || 0)), opens: mean(rows.map((r) => r.opens || 0)), races: mean(rows.map((r) => r.races || 0)), cars: med(rows.map((r) => r.cars || 0)),
        f: Object.fromEntries(['cases', 'sales', 'races', 'income', 'daily', 'goals', 'goal key', 'newbie', 'rescue', 'achievements', 'collection', 'season pass', 'reward case', 'slots (sink)', 'storage (sink)', 'tank (sink)'].map((k) => [k, faucet(k)])) };
    }),
    minBal: bs.map((b) => b.minBal), rescues: bs.map((b) => b.rescues), stuck: bs.map((b) => b.stuck), sessions: bs[0]?.sessions || 0,
  };
  console.log(`\n${kind}: day | balance | garage | income/h | lvl | cars | opens/day | races/day | cases net/day | sales/day | races net/day | income/day | rewards/day`);
  for (const r of out.kinds[kind].rows.filter((r) => [1, 2, 3, 7, 14, 21, 30].includes(r.day) || r.day === DAYS)) {
    const rewards = ['daily', 'goals', 'goal key', 'newbie', 'rescue', 'achievements', 'collection', 'season pass', 'reward case'].reduce((s, k) => s + r.f[k], 0);
    console.log(`  ${String(r.day).padStart(2)} | ${f(r.balance)} | ${f(r.garage)} | ${f(r.income)} | ${r.level} | ${r.cars} | ${r.opens.toFixed(1)} | ${r.races.toFixed(1)} | ${f(r.f.cases)} | ${f(r.f.sales)} | ${f(r.f.races)} | ${f(r.f.income)} | ${f(rewards)}`);
  }
  console.log(`  min balance per bot: ${out.kinds[kind].minBal.map(f).join(', ')} · rescue keys: ${out.kinds[kind].rescues.join(', ')} · stuck sessions (of ${out.kinds[kind].sessions}): ${out.kinds[kind].stuck.join(', ')}`);
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out));
