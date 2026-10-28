// Night 28.10 economy check: what «Цілі дня» keys (+7-day run), «Таємний покупець», «Каністра» and «Більший бак» add
// to a player's day. Bots play the real engine (in-memory DB, fast clock) like tools/sim-economy.mjs, with fixed seeds,
// and every faucet is booked per bot and day.
//   node tools/sim-night.mjs [days=30] [active=6] [casual=6] [whales=3] [off=canister,tank,goals,buyer] [out.json]
//   ROOT=<another checkout> node tools/sim-night.mjs ...   — the same bots on another build (e.g. the one before the night)
// Bots: casual — 2 sessions a day (9, 21 Kyiv-ish UTC hours), finishes the three daily tasks on ~70% of days;
//       active — 5 sessions (8, 11, 14, 17, 21), finishes them every day;
//       whale  — a rich late player (level 50, 3 млрд ₴, 40 slots of A/S cars), 5 sessions, every day, buys no cases
//                (so his faucets are not drowned by the case loop) but opens every key he gets.
// Every session: starter case, claim everything (daily bonus → canister, tasks → +1 fuel each, goal key, run reward),
// collect income, race while there is fuel (best-EV rival, honest drag), sell one car to the buyer when one matches
// (never the best car), buy the next tank when it costs ≤ 20% of the money, open every key, then (casual/active) spend
// on the dearest case like sim-economy. The daily tasks are «finished» by setting progress = target (what they cost —
// a wash, a plate — is not counted; upper bound for the key income).
// Faucets: income, races (net of entry fees), tasks money, daily bonus, reward case, collections, achievements, newbie,
// goal keys (counted at the key's case sellEv when claimed), reward keys (achievement / collection keys of level 10+,
// at sellEv), buyer premium (the part above the dealer price).
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const ROOT = process.env.ROOT ? pathToFileURL(process.env.ROOT.replace(/\/?$/, '/')).href : new URL('../', import.meta.url).href;
const { openDb } = await import(ROOT + 'src/db.js');
const { createGame } = await import(ROOT + 'src/game.js');
const S = await import(ROOT + 'public/shared.js');
const { honestDrag } = await import(ROOT + 'test/race-helpers.js');

// ---------- `node tools/sim-night.mjs buyer [opens=300000]`: can the buyer be farmed with cases? ----------
// Independent of public/buyer.js's own reasoning: for every case and every deal it really has (plain day, case of the
// day, «Вихідні удачі», «Країна тижня») open-and-sell is measured by tools/sim-cases.mjs simCase (hidden boost, luck,
// losing-streak save, fragments — whatever that deal keeps), and the drop chance of every buyable request is taken
// from the deal's own weights WITH the hidden boost. A farm = open until the asked car drops, sell everything, take
// the premium (the highest roll, 0.6, cut by premCap). Per open: return = r × price + p × sell × prem. A case under 1
// must stay under 1 with the buyer on top.
if (process.argv[2] === 'buyer') {
  const B = await import(ROOT + 'public/buyer.js');
  const { simCase, dayOf } = await import(ROOT + 'tools/sim-cases.mjs');
  const N = Number(process.argv[3] || 3e5);
  // Per-class share with the guarantee steps folded in and the hidden boost (throw twice, keep the better class).
  const classShare = (cs, deal) => {
    const sh = S.effectiveWeights({ ...cs, weights: deal.weights });
    const cl = S.CLASS_ORDER.filter((c) => sh[c]);
    let F = 0, prev = 0;
    const out = {};
    for (const c of cl) {
      F += sh[c];
      const P = (1 - deal.boost) * F + deal.boost * F * F;
      out[c] = P - prev;
      prev = P;
    }
    return out;
  };
  const reqs = [...B.BUYABLE.map((m) => ({ model: m.id })), ...B.GROUPS];
  console.log(`opens per scenario: ${N}; prem = min(0.6, premCap); «farm» = return/price with the buyer on top`);
  console.log('case | deal | price | open-and-sell r | worst request | its prem | p per open | +buyer per open | r + buyer | farm net per offer');
  const rows = [];
  for (const cs of S.CASES.filter((c) => !c.starter)) {
    const deals = [['plain', S.caseDeal(cs, S.kyivDateOf(Date.parse('2026-11-02T12:00:00Z') + 400 * 864e5), { ...S.NO_EVENTS, noCaseOfDay: true })]];
    if (cs.group === 'rarity') {
      deals.push(['day', S.caseDeal(cs, dayOf(cs.id))]);
      deals.push(['luck', S.caseDeal(cs, dayOf(cs.id), S.eventEffects([{ id: 'luck' }]))]);
    } else deals.push(['country', S.caseDeal(cs, '2026-11-02', S.eventEffects([{ id: 'country', country: cs.country }]))]);
    for (const [name, deal] of deals) {
      const c2 = { ...cs, weights: deal.weights };
      const r = simCase(c2, S.pitySteps(c2), N, 11, deal).sell;
      const sh = classShare(cs, deal);
      let worst = null;
      for (const req of reqs) {
        let p = 0, ps = 0;
        for (const cls of Object.keys(sh)) {
          const list = cs.pool(cls);
          if (!list.length) continue;
          const w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
          list.forEach((m, i) => {
            if (!B.matches(req, m.id)) return;
            const pi = (sh[cls] * w[i]) / sw;
            p += pi;
            ps += pi * S.sellPriceOf(m.id);
          });
        }
        if (!p) continue;
        const prem = Math.floor(Math.min(B.BUYER.prem.stretch[1], B.premCap(req)) * 100) / 100;
        if (prem < B.BUYER.minPrem) continue;
        const add = ps * prem; // what the premium adds per open, on average
        if (!worst || add > worst.add) worst = { req, prem, p, add };
      }
      if (!worst) continue;
      const tot = r + worst.add / deal.price;
      const net = ((r - 1) * deal.price) / worst.p + worst.add / worst.p; // one offer: opens until the drop, then the premium
      rows.push({ cs: cs.id, deal: name, r, tot, net });
      console.log([cs.id, name, S.short(deal.price), r.toFixed(3), B.reqText(worst.req), worst.prem, (worst.p * 100).toFixed(2) + '%', S.short(Math.round(worst.add)), tot.toFixed(3) + (r < 1 && tot >= 1 ? ' FARMABLE' : ''), S.short(Math.round(net))].join(' | '));
    }
  }
  const bad = rows.filter((x) => x.r < 1 && x.tot >= 1);
  console.log(bad.length ? `\nFARMABLE: ${bad.map((x) => `${x.cs}/${x.deal} ${x.r.toFixed(3)}→${x.tot.toFixed(3)}`).join(', ')}` : '\nno case under 1 reaches 1 with the buyer on top');
  const above = rows.filter((x) => x.r >= 1);
  if (above.length) console.log(`cases already ≥ 1: the buyer adds at most +${Math.max(...above.map((x) => x.tot - x.r)).toFixed(4)} of the price per open`);
  process.exit(0);
}

const [DAYS = 30, ACTIVE = 6, CASUAL = 6, WHALES = 3] = process.argv.slice(2, 6).map(Number);
const OFF = new Set((process.argv.find((a) => a.startsWith('off=')) || 'off=').slice(4).split(',').filter(Boolean));
const OUT = process.argv.find((a) => a.endsWith('.json'));
if (OFF.has('canister') && S.CANISTER) Object.assign(S.CANISTER, { daily: 0, quest: 0 });

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
const R = rng(2810);
const T0 = Date.parse('2026-11-02T00:00:00Z'); // a Monday
const db = openDb(':memory:');
db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('buyer_seed', 'sim-night')").run();
let t = T0;
const g = createGame(db, { now: () => t, notify: () => {} });
const SESSIONS = { active: [8, 11, 14, 17, 21], casual: [9, 21], whale: [8, 11, 14, 17, 21] };
const GOAL_RATE = { active: 1, casual: 0.7, whale: 1 };
const SPEND = { active: 0.8, casual: 0.6, whale: 0 };
const bots = [];
const mk = (kind, n) => {
  for (let i = 0; i < n; i++) {
    const id = 910000 + bots.length;
    g.ensureUser({ id, first_name: kind + i });
    db.prepare('UPDATE users SET server_seed = ?, client_seed = ? WHERE id = ?').run(`night:${id}`, 'night', id);
    bots.push({ id, kind, days: [], tankDay: {} });
  }
};
mk('active', ACTIVE);
mk('casual', CASUAL);
mk('whale', WHALES);
// Whales: level 50, 3 млрд, 40 slots, the 30 dearest dealer-rate A/S cars (spread over countries by the sort).
const WHALE_CARS = S.ALL_MODELS.filter((m) => !m.secret && !m.edition && !m.homeOnly && !m.restored && ['A', 'S'].includes(m.cls)).sort((a, b) => b.price - a.price).slice(0, 30);
for (const b of bots.filter((x) => x.kind === 'whale')) {
  db.prepare('UPDATE users SET level = 50, xp = 0, balance = 3e9, slots = 40 WHERE id = ?').run(b.id);
  if (db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'intro'").get()) db.prepare('UPDATE users SET intro = 1 WHERE id = ?').run(b.id);
  for (const m of WHALE_CARS) g.giveCar(b.id, m.id);
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
const cur = (b) => (b.days[day] ||= { f: {}, races: 0, canister: 0, fuelUsed: 0, keysV: 0, buyer: 0, tank: 0, caseLoop: 0 });
const book = (b, cat, v) => (cur(b).f[cat] = (cur(b).f[cat] || 0) + v);
function booked(b, cat, fn) {
  const before = balOf(b);
  const r = fn();
  book(b, cat, balOf(b) - before);
  return r;
}
const keyValue = (list) => (list || []).reduce((s, k) => s + (S.CASE_BY_ID[k.caseId]?.sellEv || 0) * k.count, 0);

function finishTasks(b) {
  if (b.goalToday === undefined) return;
  if (!b.goalToday) return;
  const d = db.prepare('SELECT MAX(day) d FROM quests WHERE user_id = ?').get(b.id)?.d;
  if (d) db.prepare('UPDATE quests SET progress = target WHERE user_id = ? AND day = ?').run(b.id, d);
}
function claimAll(b) {
  for (const c of call(b, 'pulse').claims) {
    const cat = { daily: 'daily bonus', rcase: 'reward case', newbie: 'newbie', quest: 'tasks', coll: 'collection', rescue: 'rescue', ach: 'achievements', achAll: 'achievements' }[c.kind];
    if (c.kind === 'goalkey' || c.kind === 'gstreak') {
      if (OFF.has('goals')) continue;
      const r = tryCall(b, c.kind === 'goalkey' ? 'goals/key' : 'goals/streak');
      if (r) {
        const v = keyValue(r.keys);
        book(b, c.kind === 'goalkey' ? 'goal key' : 'goal run', v);
        cur(b).keysV += v;
      }
      continue;
    }
    if (!cat) continue;
    booked(b, cat, () => {
      let r = null;
      if (c.kind === 'daily') r = tryCall(b, 'rewards/daily');
      else if (c.kind === 'rcase') r = tryCall(b, 'rewards/case');
      else if (c.kind === 'newbie') r = tryCall(b, 'newbie/claim');
      else if (c.kind === 'quest') r = tryCall(b, 'quests/claim', { key: c.id });
      else if (c.kind === 'coll') r = tryCall(b, 'collection/claim', { key: c.id });
      else if (c.kind === 'rescue') r = tryCall(b, 'rescue/claim');
      else if (c.kind === 'ach' || c.kind === 'achAll') r = tryCall(b, 'ach/claim', c.kind === 'ach' ? { key: c.id } : {});
      cur(b).canister += r?.canister || r?.reward?.canister || 0;
      // Level 10+ achievements / collection pay keys instead of most of the money (S.lateMoney): booked at sellEv.
      const lateKeys = c.kind === 'coll' ? (r?.reward?.keys ? [r.reward.keys] : []) : c.kind === 'ach' || c.kind === 'achAll' ? r?.keys || [] : [];
      if (lateKeys.length) book(b, 'reward keys', keyValue(lateKeys));
    });
  }
}
function race(b) {
  for (let n = 0; n < 40; n++) {
    const me = call(b, 'me');
    if (me.fuel < 1) return;
    const car = me.cars.filter((c) => c.status === 'garage' && c.tank > 0).sort((x, y) => y.value - x.value)[0];
    if (!car) return;
    const { list } = call(b, 'race/rivals', { carId: car.id });
    const r = list.map((x) => ({ ...x, ev: (x.chance / 100) * x.prize - (1 - x.chance / 100) * x.entry })).sort((x, y) => y.ev - x.ev)[0];
    if (r.ev <= 0 || r.entry > me.balance) return;
    booked(b, 'races', () => {
      const st = call(b, 'race/start', { carId: car.id, rival: r.id });
      const reaction = 0.18 + R() * 0.2;
      const shifts = Array.from({ length: S.SHIFTS }, () => (R() < 0.35 ? 'perfect' : R() < 0.85 ? 'good' : 'late'));
      const run = honestDrag(st.car, st.greenMs, reaction, shifts);
      t += Math.ceil(run.ms) + 50;
      call(b, 'race/finish', { raceId: st.raceId, ...run.body });
    });
    cur(b).races++;
    t += 6e3;
  }
}
function buyer(b) {
  if (OFF.has('buyer')) return;
  const me = call(b, 'me');
  const o = me.buyer;
  if (!o || o.sold || !o.cars?.length || o.lastCar) return;
  const best = me.cars.filter((c) => c.status === 'garage').sort((x, y) => y.value - x.value)[0];
  const pick = o.cars.find((c) => c.id !== best?.id);
  if (!pick) return;
  const r = tryCall(b, 'buyer/sell', { carId: pick.id });
  if (r) {
    book(b, 'buyer premium', r.bonus);
    book(b, 'buyer dealer part', r.dealer); // a car sale, not a faucet (kept apart)
    cur(b).buyer += r.bonus;
  }
}
function tank(b) {
  if (OFF.has('tank') || !g.api['tank/upgrade']) return;
  for (let k = 0; k < 3; k++) {
    const me = call(b, 'me');
    const next = S.nextTank?.(me.tankLvl);
    if (!next || me.level < next.level || next.cost > me.balance * 0.2) return;
    if (!booked(b, 'tank (sink)', () => tryCall(b, 'tank/upgrade'))) return;
    b.tankDay[next.max] = day + 1;
  }
}
function makeRoom(b, free) {
  const me = call(b, 'me');
  const cars = me.cars.filter((c) => c.status === 'garage' && !S.MODELS[c.model].secret).sort((x, y) => x.value - y.value);
  const need = me.used + free - me.slots;
  if (need <= 0) return true;
  const sell = cars.slice(0, need).map((c) => c.id);
  if (sell.length < need || cars.length - sell.length < 1) return false;
  booked(b, 'case loop', () => call(b, 'sell', { carIds: sell }));
  return true;
}
function openKeys(b) {
  for (const [caseId, n] of Object.entries(call(b, 'me').keys || {})) {
    if (caseId === 'starter' || !S.CASE_BY_ID[caseId] || !n) continue;
    for (let left = n; left > 0;) {
      const k = [6, 3, 1].find((x) => x <= left);
      if (!makeRoom(b, k)) return;
      if (!booked(b, 'case loop', () => tryCall(b, 'case/open', { caseId, count: k }))) return;
      left -= k;
    }
  }
}
function spend(b, share) {
  if (!share) return;
  for (let guard = 0; guard < 10; guard++) {
    const me = call(b, 'me');
    if (me.slots < S.MAX_SLOTS && S.slotCost(me.slots) < me.balance * 0.15) {
      booked(b, 'slots (sink)', () => tryCall(b, 'buy-slot'));
      continue;
    }
    const capNext = S.CAP_LEVELS[me.capLevel + 1];
    if (capNext && capNext.cost < me.balance * 0.1) {
      booked(b, 'storage (sink)', () => tryCall(b, 'upgrade-cap'));
      continue;
    }
    const budget = me.balance * share;
    const cs = S.CASES.filter((c) => !c.starter && c.price <= budget).sort((x, y) => y.price - x.price)[0];
    if (!cs) return;
    const n = [6, 3, 1].find((k) => cs.price * k <= budget);
    if (!makeRoom(b, n)) return;
    booked(b, 'case loop', () => tryCall(b, 'case/open', { caseId: cs.id, count: n }));
  }
}

for (day = 0; day < DAYS; day++) {
  for (const b of bots) b.goalToday = R() < GOAL_RATE[b.kind];
  for (let h = 0; h < 24; h++) {
    t = T0 + (day * 24 + h) * 3600e3 + 7 * 60e3;
    for (const b of bots) {
      if (!SESSIONS[b.kind].includes(h)) continue;
      if (call(b, 'me').keys.starter) booked(b, 'case loop', () => tryCall(b, 'case/open', { caseId: 'starter', count: 1 }));
      claimAll(b);
      booked(b, 'income', () => tryCall(b, 'collect'));
      race(b);
      // The tasks get done during the day's last session (by then the bot has raced and collected).
      if (h === SESSIONS[b.kind][SESSIONS[b.kind].length - 1]) {
        finishTasks(b);
        call(b, 'me');
      }
      claimAll(b);
      buyer(b);
      tank(b);
      openKeys(b);
      spend(b, SPEND[b.kind]);
    }
  }
  for (const b of bots) {
    // Straight from the DB: a `me` here (past midnight Kyiv) would start tomorrow's buyer offer at night.
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(b.id);
    Object.assign(cur(b), { level: u.level, balance: u.balance, tankLvl: u.tank_lvl || 0, fuelMax: S.fuelMaxOf ? S.fuelMaxOf(u.tank_lvl || 0) : S.FUEL_MAX });
  }
}

const FAUCETS = ['income', 'races', 'tasks', 'daily bonus', 'reward case', 'collection', 'achievements', 'reward keys', 'newbie', 'rescue', 'goal key', 'goal run', 'buyer premium'];
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const out = { root: ROOT, off: [...OFF], days: DAYS, kinds: {} };
for (const kind of ['casual', 'active', 'whale']) {
  const bs = bots.filter((b) => b.kind === kind);
  if (!bs.length) continue;
  out.kinds[kind] = Array.from({ length: DAYS }, (_, d) => {
    const rows = bs.map((b) => b.days[d] || { f: {} });
    const by = Object.fromEntries(FAUCETS.map((k) => [k, mean(rows.map((r) => r.f[k] || 0))]));
    const total = rows.map((r) => FAUCETS.reduce((s, k) => s + (r.f[k] || 0), 0));
    return {
      day: d + 1, faucetMed: med(total), faucetMean: mean(total), by,
      races: mean(rows.map((r) => r.races || 0)), canister: mean(rows.map((r) => r.canister || 0)),
      level: med(rows.map((r) => r.level || 0)), balance: med(rows.map((r) => r.balance || 0)), 
      tankLvl: mean(rows.map((r) => r.tankLvl || 0)), fuelMax: mean(rows.map((r) => r.fuelMax || 15)),
      caseLoop: mean(rows.map((r) => r.f['case loop'] || 0)), sinks: mean(rows.map((r) => (r.f['tank (sink)'] || 0) + (r.f['slots (sink)'] || 0) + (r.f['storage (sink)'] || 0))),
    };
  });
  out[kind + 'Tank'] = bs.map((b) => b.tankDay);
}
const f = (n) => S.short(Math.round(n)).replace(' ₴', '');
console.log(`ROOT ${ROOT}  off=[${[...OFF]}]  days ${DAYS}`);
for (const [kind, rows] of Object.entries(out.kinds)) {
  console.log(`\n${kind}: day | faucet ₴/day med (mean) | races | canister ⛽ | tank | lvl | goal keys+run | buyer prem | balance`);
  for (const r of rows.filter((r) => [1, 2, 3, 5, 7, 14, 21, 30].includes(r.day) || r.day === DAYS)) {
    console.log(`  ${String(r.day).padStart(2)} | ${f(r.faucetMed)} (${f(r.faucetMean)}) | ${r.races.toFixed(1)} | ${r.canister.toFixed(1)} | ${r.fuelMax.toFixed(1)} | ${r.level} | ${f(r.by['goal key'] + r.by['goal run'])} | ${f(r.by['buyer premium'])} | ${f(r.balance)}`);
  }
  console.log('  tank days:', JSON.stringify(out[kind + 'Tank']));
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out));
