// Economy stress test: bots play the real game engine (in-memory DB, fast-forwarded clock) for N days and we watch
// how money, garage value and car classes grow, where money comes from and where it goes.
//   node tools/sim-economy.mjs [days=30] [activeBots=20] [casualBots=20]
// Active bots log in 6 times a day, casual ones twice. Every session a bot: claims everything claimable (daily bonus,
// reward case, quests, newbie tasks, collection rewards), collects garage income, races while it has fuel, buys a
// garage slot when it is cheap compared with its money, and spends most of its money on the dearest case it can
// afford, selling its weakest cars first to make room.
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const DAYS = Number(process.argv[2] || 30), ACTIVE = Number(process.argv[3] || 20), CASUAL = Number(process.argv[4] || 20);
const db = openDb(':memory:');
let t = Date.parse('2026-11-02T00:00:00Z'); // a Monday
const g = createGame(db, { now: () => t, notify: () => {} });
const bots = [];
for (let i = 0; i < ACTIVE + CASUAL; i++) {
  const id = 900000 + i;
  g.ensureUser({ id, first_name: 'bot' + i });
  bots.push({ id, kind: i < ACTIVE ? 'active' : 'casual', firstAt: {} });
}
const SESSIONS = { active: [8, 11, 14, 17, 20, 23], casual: [9, 21] };
const flow = {}; // money by category: + sources, − sinks
const add = (k, v) => (flow[k] = (flow[k] || 0) + v);
const call = (b, name, body) => g.api[name](b.id, body);
const tryCall = (b, name, body) => {
  try {
    return call(b, name, body);
  } catch {
    return null;
  }
};
// Runs fn and books the balance change under `cat`.
function booked(b, cat, fn) {
  const before = call(b, 'me').balance;
  const r = fn();
  add(cat, call(b, 'me').balance - before);
  return r;
}
const rankOf = (m) => S.rankOf(S.MODELS[m].cls);

function claimAll(b) {
  for (const c of call(b, 'pulse').claims) {
    const cat = { daily: 'daily bonus', rcase: 'reward case', newbie: 'newbie tasks', quest: 'quests', coll: 'collection', income: 'income', rescue: 'rescue', ach: 'achievements', achAll: 'achievements' }[c.kind];
    booked(b, cat, () => {
      if (c.kind === 'daily') tryCall(b, 'rewards/daily');
      else if (c.kind === 'rcase') tryCall(b, 'rewards/case');
      else if (c.kind === 'newbie') tryCall(b, 'newbie/claim');
      else if (c.kind === 'quest') tryCall(b, 'quests/claim', { key: c.id });
      else if (c.kind === 'coll') tryCall(b, 'collection/claim', { key: c.id });
      else if (c.kind === 'rescue') tryCall(b, 'rescue/claim');
      else if (c.kind === 'ach' || c.kind === 'achAll') tryCall(b, 'ach/claim', c.kind === 'ach' ? { key: c.id } : {});
    });
  }
}
function race(b) {
  for (let n = 0; n < 15; n++) {
    const me = call(b, 'me');
    if (me.fuel < 1) return;
    const car = me.cars.filter((c) => c.status === 'garage' && c.tank > 0).sort((x, y) => y.value - x.value)[0];
    if (!car) return;
    const { list } = call(b, 'race/rivals', { carId: car.id });
    // The rival with the best expected profit.
    const r = list.map((x) => ({ ...x, ev: (x.chance / 100) * x.prize - (1 - x.chance / 100) * x.entry })).sort((x, y) => y.ev - x.ev)[0];
    if (r.ev <= 0 || r.entry > me.balance) return;
    booked(b, 'races', () => {
      const st = call(b, 'race/start', { carId: car.id, rival: r.id });
      const reaction = 0.18 + Math.random() * 0.2;
      const shifts = Array.from({ length: S.SHIFTS }, () => (Math.random() < 0.35 ? 'perfect' : Math.random() < 0.85 ? 'good' : 'late'));
      call(b, 'race/finish', { raceId: st.raceId, reaction, shifts });
    });
  }
}
// Sell the weakest cars (never the last one, never secret) until `free` slots are open.
function makeRoom(b, free) {
  const me = call(b, 'me');
  const cars = me.cars.filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret).sort((x, y) => x.value - y.value);
  const need = me.used + free - me.slots;
  if (need <= 0) return true;
  const sell = cars.slice(0, need).map((c) => c.id);
  if (sell.length < need || cars.length - sell.length < 1) return false;
  booked(b, 'instant sale', () => call(b, 'sell', { carIds: sell }));
  return true;
}
function spend(b, share) {
  for (let guard = 0; guard < 10; guard++) {
    const me = call(b, 'me');
    // Buy a garage slot when it costs under 15% of the money.
    if (me.slots < S.MAX_SLOTS && S.slotCost(me.slots) < me.balance * 0.15) {
      booked(b, 'garage slots', () => tryCall(b, 'buy-slot'));
      continue;
    }
    const capNext = S.CAP_LEVELS[me.capLevel + 1];
    if (capNext && capNext.cost < me.balance * 0.1) {
      booked(b, 'income storage', () => tryCall(b, 'upgrade-cap'));
      continue;
    }
    const budget = me.balance * share;
    const cs = S.CASES.filter((c) => !c.starter && c.price <= budget).sort((x, y) => y.price - x.price)[0];
    if (!cs) return;
    const n = [6, 3, 1].find((k) => cs.price * k <= budget);
    if (!makeRoom(b, n)) return;
    booked(b, 'cases', () => tryCall(b, 'case/open', { caseId: cs.id, count: n }));
  }
}
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const report = [];
for (let day = 0; day < DAYS; day++) {
  for (let h = 0; h < 24; h++) {
    t = Date.parse('2026-11-02T00:00:00Z') + (day * 24 + h) * 3600e3 + 7 * 60e3;
    for (const b of bots) {
      if (!SESSIONS[b.kind].includes(h)) continue;
      // Starter case first.
      if (call(b, 'me').keys.starter) tryCall(b, 'case/open', { caseId: 'starter', count: 1 });
      claimAll(b);
      booked(b, 'income', () => tryCall(b, 'collect'));
      race(b);
      claimAll(b);
      spend(b, b.kind === 'active' ? 0.8 : 0.6);
      const me = call(b, 'me');
      for (const c of me.cars) {
        const cls = S.MODELS[c.model].cls;
        if (b.firstAt[cls] == null) b.firstAt[cls] = day + h / 24;
      }
    }
  }
  for (const b of bots) {
    const n = db.prepare("SELECT COUNT(*) n FROM claims WHERE user_id = ? AND key LIKE 'c%'").get(b.id).n;
    if (n && b.firstSecret == null) b.firstSecret = day + 1;
  }
  if ([0, 1, 2, 4, 6, 9, 13, 20, 29, 44, 59].includes(day) || day === DAYS - 1) {
    const row = { day: day + 1 };
    for (const kind of ['active', 'casual']) {
      const ms = bots.filter((b) => b.kind === kind).map((b) => call(b, 'me'));
      row[kind] = {
        money: pct(ms.map((m) => m.balance), 0.5), garage: pct(ms.map((m) => m.stats.value), 0.5),
        incomeH: pct(ms.map((m) => m.income.rate), 0.5), level: pct(ms.map((m) => m.level), 0.5),
        slots: pct(ms.map((m) => m.slots), 0.5), coll: pct(ms.map((m) => m.collection.length), 0.5),
        best: S.CLASS_ORDER[pct(ms.map((m) => Math.max(...m.cars.map((c) => rankOf(c.model)))), 0.5)],
      };
    }
    report.push(row);
  }
}
const f = (n) => S.short(n).replace(' ₴', '').padStart(9);
console.log(`\n${ACTIVE} active + ${CASUAL} casual bots, ${DAYS} days (medians)`);
console.log('day │ ACTIVE  money    garage    income/h lvl slots coll best │ CASUAL  money    garage    income/h lvl slots coll best');
for (const r of report) {
  const s = (x) => `${f(x.money)} ${f(x.garage)} ${f(x.incomeH)} ${String(x.level).padStart(3)} ${String(x.slots).padStart(5)} ${String(x.coll).padStart(4)}   ${x.best}`;
  console.log(`${String(r.day).padStart(3)} │ ${s(r.active)} │ ${s(r.casual)}`);
}
console.log('\nFirst car of each class (median day; − = not reached by half of the bots):');
for (const kind of ['active', 'casual']) {
  const bs = bots.filter((b) => b.kind === kind);
  console.log(`  ${kind.padEnd(7)} ` + ['C', 'B', 'A', 'S'].map((c) => {
    const days = bs.map((b) => b.firstAt[c] ?? Infinity);
    const m = pct(days, 0.5);
    return `${c}: ${m === Infinity ? '−' : 'day ' + (m + 1).toFixed(1)}`;
  }).join('   ') + `   first secret: ${(() => { const m = pct(bs.map((b) => b.firstSecret ?? Infinity), 0.5); return m === Infinity ? '−' : 'day ' + m; })()}`);
}
console.log('\nMoney flow over all bots (+ came in, − went out):');
for (const [k, v] of Object.entries(flow).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${S.short(v).padStart(14)}`);
for (const kind of ['active', 'casual']) {
  const ids = bots.filter((b) => b.kind === kind).map((b) => b.id);
  const done = db.prepare(`SELECT key, COUNT(*) n FROM claims WHERE key LIKE 'c%' AND user_id IN (${ids.join(',')}) GROUP BY key`).all();
  console.log(`Country collections finished (${kind}, of ${ids.length}): ${done.map((r) => `${r.key.slice(1)} ×${r.n}`).join(', ') || 'none'}`);
}
// Losing streaks: drops in a row worth less than their case.
const streaks = [];
let paid = 0, back = 0;
for (const b of bots) {
  let cur = 0, worst = 0;
  for (const r of db.prepare("SELECT case_id, item FROM drops WHERE user_id = ? AND case_id <> 'starter' ORDER BY id").all(b.id)) {
    const price = S.CASE_BY_ID[r.case_id].price, v = S.MODELS[r.item].price;
    paid += price;
    back += v;
    cur = v >= price ? 0 : cur + 1;
    worst = Math.max(worst, cur);
  }
  streaks.push(worst);
}
console.log(`Longest losing streak per bot: median ${pct(streaks, 0.5)}, worst ${Math.max(...streaks)}; drops were worth ${((back / paid) * 100).toFixed(0)}% of what cases cost`);
const d = db.prepare("SELECT COUNT(*) n, SUM(forced = 2) lucky, SUM(forced = 1) pity FROM drops WHERE case_id <> 'starter'").get();
console.log(`Case drops: ${d.n}, improved by luck ${((d.lucky / d.n) * 100).toFixed(1)}%, by a guarantee ${((d.pity / d.n) * 100).toFixed(1)}%`);
