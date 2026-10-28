// Economy audit (reports/econ-fable/economy.md): every repeatable money loop measured with the real roll (tools/sim-cases.mjs
// simCase copies src/game.js rollCase) on every day type, plus the chained loops around the cases.
//   node tools/econ-audit.mjs table [opens=200000]            — open-and-sell per case: plain / case of the day / luck weekend /
//                                                               country of the week / case battle (no boost, no fragments) / bot battle
//   node tools/econ-audit.mjs fit [target=0.9] [opens=100000] — the buy-back share (S.ORIGIN_SELL) per case that puts a plain day at
//                                                               `target` and prints every day type with it
//   node tools/econ-audit.mjs chains                          — trade-in, upgrade, plates, country collections and secret cars, season
//                                                               pass, level rewards, Stars packs, garage income, races
//   node tools/econ-audit.mjs compound [hours=1.5] [opens/h=440] — a player who opens the best case ×6 and sells everything at once
//   ORIGIN='{"city":0.78,...}' node tools/econ-audit.mjs table   — the same with another buy-back table (an option under review)
import * as S from '../public/shared.js';
import { pickWeighted, pickModel, classEntries } from '../src/game.js';
import { simCase, caseReturns, dayOf } from './sim-cases.mjs';

if (process.env.ORIGIN) Object.assign(S.ORIGIN_SELL, JSON.parse(process.env.ORIGIN));
const CASES = S.CASES.filter((c) => !c.starter);
const f3 = (x) => (x == null ? '—' : x.toFixed(3));
const pct = (x) => (x * 100).toFixed(x < 0.01 ? 2 : 1) + '%';
const money = (n) => S.short(Math.round(n));

// Every day type of a case: { plain, day (case of the day) | country (country of the week), luck (rarity only), battle (a case
// battle with a person: shown odds + guarantee, no hidden boost, no fragments, no streak save), bot (battle with Петрович: shown
// odds only) }.
export function allDays(cs, N = 2e5, seed = 7) {
  const r = caseReturns(cs, N, seed);
  const plainDeal = { price: cs.price, boost: 0, fragments: false, save: false };
  const out = { plain: r.normal, deal: r.deal, dealWhy: r.dealWhy, dealPrice: r.dealPrice, luck: r.luck ?? null,
    battle: simCase(cs, S.pitySteps(cs), N, seed, plainDeal).sell, bot: simCase(cs, [], N, seed, plainDeal).sell };
  out.max = Math.max(out.plain, out.deal, out.luck ?? 0, out.battle, out.bot);
  return out;
}
// Static expectation: sellEv / price with the guarantee folded in and the hidden boost (no luck, no save, no fragments).
export function staticSell(cs, boost = S.BOOST) {
  const sh = S.effectiveWeights(cs);
  const cl = S.CLASS_ORDER.filter((c) => sh[c]);
  let F = 0, prev = 0, ev = 0;
  for (const c of cl) {
    F += sh[c];
    const P = (1 - boost) * F + boost * F * F;
    const share = P - prev;
    prev = P;
    const list = cs.pool(c), w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
    ev += share * list.reduce((s, m, i) => s + (S.sellPriceOf(m.id, Infinity, cs.id) * w[i]) / sw, 0);
  }
  return ev / cs.price;
}

function table(N) {
  console.log(`opens per scenario ${N}; sell = instant sale of every drop / money paid. ORIGIN_SELL = ${JSON.stringify(S.ORIGIN_SELL)}`);
  console.log('case | price | ×buy-back | static | plain | deal day (price) | luck weekend | battle (person) | battle (bot) | worst');
  const rows = [];
  for (const cs of CASES) {
    const d = allDays(cs, N);
    rows.push({ id: cs.id, ...d });
    console.log([cs.id, money(cs.price), '×' + (+S.originSellOf(cs.id).toFixed(3)), f3(staticSell(cs)), f3(d.plain), `${d.dealWhy} ${money(d.dealPrice)} ${f3(d.deal)}`, f3(d.luck), f3(d.battle), f3(d.bot), f3(d.max) + (d.max >= 1 ? '  >1 !!' : '')].join(' | '));
  }
  const bad = rows.filter((r) => r.max >= 1);
  console.log(bad.length ? `\nABOVE 1: ${bad.map((r) => `${r.id} ${f3(r.max)}`).join(', ')}` : '\nevery case under 1 on every day type');
  return rows;
}

// The buy-back share that puts a plain day at `target` (sell is linear in the share except for the UA collector cars, so one
// Monte Carlo at share 1 gives it; the collector part of UA is measured apart).
function fit(target, N) {
  console.log(`target plain day ${target}; opens ${N}`);
  console.log('case | now plain | share | plain | deal | luck | battle | bot | worst');
  const out = {};
  for (const cs of CASES) {
    const saved = S.ORIGIN_SELL[cs.id];
    delete S.ORIGIN_SELL[cs.id];
    const base = caseReturns(cs, N, 7).normal;
    let k = 1;
    if (base > target) {
      // UA: the gold cars sell for HOME_SELL_RATE whatever the share — measure the fixed part at share → 0.
      S.ORIGIN_SELL[cs.id] = 1e-6;
      const fixed = caseReturns(cs, N, 7).normal;
      k = Math.max(0.3, Math.min(1, Math.round(((target - fixed) / (base - fixed)) * 100) / 100));
    }
    if (k < 1) S.ORIGIN_SELL[cs.id] = k;
    else delete S.ORIGIN_SELL[cs.id];
    if (k < 1) out[cs.id] = k;
    const d = allDays(cs, N);
    console.log([cs.id, f3(base), k < 1 ? '×' + k : '—', f3(d.plain), `${d.dealWhy} ${f3(d.deal)}`, f3(d.luck), f3(d.battle), f3(d.bot), f3(d.max)].join(' | '));
    if (saved != null) S.ORIGIN_SELL[cs.id] = saved;
    else if (k < 1) delete S.ORIGIN_SELL[cs.id];
  }
  console.log('\nORIGIN_SELL =', JSON.stringify(out));
  return out;
}

// ---------- chained loops ----------
const avgOf = (list, f = (m) => m.price) => {
  const w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
  return list.reduce((s, m, i) => s + (f(m) * w[i]) / sw, 0);
};
function tradeIn() {
  console.log('\n== Trade-in (3 cars of one class → 1): value and instant sale of the result against the sale of the three ==');
  console.log('class | stake (3 × typical) | E[value out] / stake | E[sale out] / sale of the 3 in');
  for (const cls of ['D', 'C', 'B', 'A']) {
    const list = S.ALL_MODELS.filter((m) => m.cls === cls && !m.secret && !m.homeOnly);
    const up = S.CLASS_ORDER[S.rankOf(cls) + 1];
    for (const stakeMult of [3]) {
      const typical = avgOf(list);
      const stake = typical * stakeMult;
      const poolOf = (k) => S.ALL_MODELS.filter((m) => m.cls === k && !m.secret && !m.homeOnly && m.price <= stake * S.TRADE_IN.maxMult);
      const pu = poolOf(up).length ? poolOf(up) : S.ALL_MODELS.filter((m) => m.cls === up && !m.secret && !m.homeOnly).sort((a, b) => a.price - b.price).slice(0, 3);
      const ps = poolOf(cls);
      const evVal = S.TRADE_IN.chance * avgOf(pu) + (1 - S.TRADE_IN.chance) * avgOf(ps);
      const evSell = S.TRADE_IN.chance * avgOf(pu, (m) => S.sellPriceOf(m.id)) + (1 - S.TRADE_IN.chance) * avgOf(ps, (m) => S.sellPriceOf(m.id));
      const sellIn = stake * S.SELL_RATES[cls];
      console.log([cls + '→' + up, money(stake), f3(evVal / stake), f3(evSell / sellIn)].join(' | '));
    }
  }
}
function upgrade() {
  console.log('\n== Upgrade (stake → target at chance stake/target × edge) ==');
  const e = S.upgradeEdge(1);
  console.log(`E[value out] / stake = ${e} (1 car), ${S.upgradeEdge(6)} (6 cars); the result sells at the TARGET class rate, so E[sale out] / sale of the stake:`);
  for (const [from, to] of [['D', 'C'], ['C', 'B'], ['B', 'A'], ['A', 'S'], ['S', 'S']]) console.log(`  ${from} → ${to}: ${f3((e * S.SELL_RATES[to]) / S.SELL_RATES[from])}`);
}
function plates() {
  console.log('\n== Plates: generation price → E[plate value] → instant sale (50%) ==');
  const val = (cls) => (S.PLATE_VALUE[cls][0] + S.PLATE_VALUE[cls][1]) / 2;
  for (const g of S.PLATE_GEN) {
    const tw = Object.values(g.weights).reduce((a, b) => a + b, 0);
    const ev = Object.entries(g.weights).reduce((s, [c, w]) => s + (w / tw) * val(c), 0);
    console.log(`  ${g.id} ${money(g.price)}: E[value] ${money(ev)} (${f3(ev / g.price)} of the price), sale ${f3((ev * 0.5) / g.price)}; on «Щасливі номери» (−20%) ${f3((ev * 0.5) / (g.price * 0.8))}`);
  }
  const tw = Object.values(S.REGION_GEN.weights).reduce((a, b) => a + b, 0);
  const ev = Object.entries(S.REGION_GEN.weights).reduce((s, [c, w]) => s + (w / tw) * val(c), 0);
  for (const code of ['AB', 'AA', 'II']) {
    const p = S.regionPrice(code), m = S.plateRegionMult(code + ' 1234 BC');
    console.log(`  region ${code} ${money(p)}: E[value] ${money(ev * m)}, sale ${f3((ev * m * 0.5) / p)}; −20% ${f3((ev * m * 0.5) / (p * 0.8))}`);
  }
}
// How much a country collection costs with its own case (open until every car of the case's pool has dropped; luck, boost,
// guarantee and the {missing} gold step as in the game; every drop sold at once), against what it pays.
function collections(N = 400) {
  console.log('\n== Country collections: open the country case until every car of its pool dropped (median of ' + N + ' runs) ==');
  console.log('country | cars | median opens | money paid | sold at once | net cost | reward ₴ | secret car | car income/h | race EV (easy) /race');
  for (const c of S.MAIN_COUNTRIES) {
    const cs = S.CASE_BY_ID['c-' + c.toLowerCase()];
    const need = S.countryNeed(c).map((m) => m.id);
    const classes = classEntries(cs.weights), steps = S.pitySteps(cs);
    const pools = Object.fromEntries(classes.map(([cl]) => [cl, cs.pool(cl)]));
    const runs = [];
    let R = (() => { let a = 12345; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    for (let run = 0; run < N; run++) {
      const have = new Set();
      const cnt = steps.map(() => 0);
      let opens = 0, sold = 0, frags = 0, keys = 0, paid = 0;
      while (have.size < need.length && opens < 20000) {
        const isPaid = keys === 0;
        if (isPaid) paid++;
        else keys--;
        opens++;
        let cls = pickWeighted(classes, R());
        if (R() < S.BOOST) {
          const again = pickWeighted(classes, R());
          if (S.rankOf(again) > S.rankOf(cls)) cls = again;
        }
        let due = -1;
        for (let i = steps.length - 1; i >= 0; i--) if (S.rankOf(cls) < S.rankOf(steps[i].cls) && cnt[i] + 1 >= steps[i].n) { cls = steps[i].cls; due = i; break; }
        let pool = pools[cls];
        if (due >= 0 && steps[due].missing) { const miss = pool.filter((m) => !have.has(m.id)); if (miss.length) pool = miss; }
        const model = S.MODELS[pickModel(pool, R())];
        steps.forEach((s, i) => {
          const hit = S.rankOf(cls) >= S.rankOf(s.cls) && (!s.missing || pools[s.cls].every((m) => have.has(m.id) || m.id === model.id) || !have.has(model.id));
          cnt[i] = hit ? 0 : cnt[i] + 1;
        });
        have.add(model.id);
        sold += S.sellPriceOf(model.id, Infinity, cs.id);
        if (isPaid && model.price < cs.price && ++frags >= S.FRAGMENTS_PER_KEY) { frags -= S.FRAGMENTS_PER_KEY; keys++; }
      }
      runs.push({ opens, paid: paid * cs.price, sold });
    }
    runs.sort((a, b) => a.opens - b.opens);
    const med = runs[N >> 1];
    const secret = S.MODELS[S.SECRET_BY_COUNTRY[c]];
    const race = S.raceMoney(S.OPPONENTS[0], secret.price);
    console.log([c, need.length, med.opens, money(med.paid), money(med.sold), money(med.paid - med.sold), money(S.COUNTRY_REWARD[c]), money(secret.price), money(secret.price * S.CLASS_INCOME.X), money(0.8 * S.raceEv(secret.price))].join(' | '));
  }
}
function pass() {
  console.log('\n== Season pass, free track: money over levels 2…30 by garage income rate ==');
  for (const rate of [0, 300e3, 1e6, 3.5e6, 10e6, 30e6]) {
    let sum = 0;
    for (let l = 2; l <= S.SEASON.levels; l++) sum += S.passReward(2, l, false, rate).money || 0;
    console.log(`  rate ${money(rate)}/h → ${money(sum)} per season (${money(sum / S.SEASON.days)}/day; ${rate ? f3(sum / (rate * 24 * S.SEASON.days)) : '—'} of the season's income)`);
  }
}
function levels() {
  console.log('\n== Level rewards (15 000 × L²) ==');
  for (const L of [5, 10, 15, 20, 30, 40, 50]) {
    let m = 0, keys = [];
    for (let l = 2; l <= L; l++) { const r = S.levelReward(l); m += r.money; if (r.caseId) keys.push(r.caseId); }
    let xp = 0;
    for (let l = 1; l < L; l++) xp += S.xpForLevel(l);
    console.log(`  to level ${L}: ${money(m)} + keys ${keys.length} (${[...new Set(keys)].join('/')}), xp ${xp} (= ${Math.ceil(xp / S.CASE_XP_CAP)} days of case xp at the cap)`);
  }
}
function packs() {
  console.log('\n== Stars packs: ₴ per pack by level / garage (S.packMult; «Мега-пропозиція» ×2 on top) ==');
  console.log('level | garage | mult | p1 50⭐ | p4 1500⭐ | p1 at ×2');
  for (const [lvl, gar] of [[1, 0], [5, 2e6], [10, 50e6], [15, 300e6], [20, 2e9], [25, 5e9], [30, 20e9], [40, 50e9], [50, 100e9]]) {
    const m = S.packMult(lvl, gar);
    console.log(`  ${lvl} | ${money(gar)} | ×${m.toFixed(1)} | ${money(S.packAmount(S.PACKS[0], lvl, gar))} | ${money(S.packAmount(S.PACKS[3], lvl, gar))} | ${money(S.packAmount(S.PACKS[0], lvl, gar) * S.PACK_OFFER.mult)}`);
  }
}
function income() {
  console.log('\n== Garage income per hour by class (model price × CLASS_INCOME) and payback of a case by income ==');
  for (const cs of CASES) {
    const sh = S.effectiveWeights(cs);
    let inc = 0;
    for (const [c, p] of Object.entries(sh)) inc += p * avgOf(cs.pool(c), (m) => m.price * S.CLASS_INCOME[c]);
    console.log(`  ${cs.id.padEnd(8)} E[income/h of a drop] ${money(inc).padStart(12)} → the case pays back by income in ${(cs.price / inc / 24).toFixed(1)} days (cap 4 h: ${(cs.price / inc / 4).toFixed(0)} collects)`);
  }
  console.log('\n== Races: expected gain per race for a GOOD driver (S.raceEv × OPPONENTS.ev) and per 72 races a day (tank 15 + 1 per 20 min) ==');
  for (const v of [60e3, 400e3, 4e6, 25e6, 150e6, 300e6, 1e9, 1.5e9]) console.log(`  car ${money(v).padStart(10)}: easy ${money(0.8 * S.raceEv(v)).padStart(9)}/race, mid ${money(S.raceEv(v)).padStart(9)}/race → up to ${money(72 * S.raceEv(v))}/day`);
}
function chains() {
  tradeIn(); upgrade(); plates(); collections(); pass(); levels(); packs(); income();
}

// ---------- the compounding exploit: open the best case ×6 and sell at once ----------
function compound(hours, perHour) {
  const N = Math.round(hours * perHour);
  console.log(`\n== «Швидке відкриття» + «Продати все»: ${N} opens in ${hours} h (${perHour}/h), always the dearest case that fits ×6 and returns > 1 on the day ==`);
  const rates = Object.fromEntries(CASES.map((cs) => [cs.id, { plain: caseReturns(cs, 5e4, 3).normal, deal: caseReturns(cs, 5e4, 3).deal }]));
  for (const dayType of ['plain', 'deal']) {
    for (const start of [250e3, 5e6, 50e6]) {
      let bal = start, opens = 0, log = [];
      while (opens < N) {
        const cs = CASES.filter((c) => c.price * 6 <= bal && rates[c.id][dayType] > 1.0).sort((a, b) => b.price - a.price)[0]
          || CASES.filter((c) => c.price <= bal).sort((a, b) => rates[b.id][dayType] - rates[a.id][dayType])[0];
        if (!cs) break;
        const n = cs.price * 6 <= bal ? 6 : 1;
        const price = dayType === 'deal' && cs.group === 'rarity' ? Math.round((cs.price * 0.9) / 1000) * 1000 : dayType === 'deal' && cs.group === 'country' ? Math.round((cs.price * 0.85) / 1000) * 1000 : cs.price;
        bal += n * price * (rates[cs.id][dayType] - 1);
        opens += n;
        if ([60, 300, 657, 1320].includes(opens) || opens >= N) log.push(`${opens} opens: ${money(bal)} (${cs.id})`);
      }
      console.log(`  ${dayType} day, start ${money(start)}: ${log.join(' → ')}`);
    }
  }
}

// The buy-back share that puts the WORST day type (plain, case of the day / country of the week, luck weekend, battles) at
// `target`: every return is linear in the share (UA: minus the fixed collector part), so two Monte Carlos per case give it.
function fitMax(target, N) {
  console.log(`target worst day ${target}; opens ${N}`);
  console.log('case | share | plain | deal | luck | battle | bot | worst');
  const out = {};
  const days = (d) => ({ plain: d.plain, deal: d.deal, luck: d.luck ?? 0, battle: d.battle, bot: d.bot });
  for (const cs of CASES) {
    const saved = S.ORIGIN_SELL[cs.id];
    delete S.ORIGIN_SELL[cs.id];
    const full = days(allDays(cs, N));
    S.ORIGIN_SELL[cs.id] = 1e-6;
    const fixed = days(allDays(cs, N));
    let k = 1;
    for (const t of Object.keys(full)) if (full[t] > target) k = Math.min(k, (target - fixed[t]) / (full[t] - fixed[t]));
    k = Math.max(0.3, Math.floor(k * 100) / 100);
    if (k < 1) (S.ORIGIN_SELL[cs.id] = k), (out[cs.id] = k);
    else delete S.ORIGIN_SELL[cs.id];
    const d = allDays(cs, N, 11); // another seed: a check, not the fit itself
    console.log([cs.id, k < 1 ? '×' + k : '—', f3(d.plain), `${d.dealWhy} ${f3(d.deal)}`, f3(d.luck), f3(d.battle), f3(d.bot), f3(d.max)].join(' | '));
    if (saved != null) S.ORIGIN_SELL[cs.id] = saved;
    else delete S.ORIGIN_SELL[cs.id];
  }
  console.log('\nORIGIN_SELL =', JSON.stringify(out));
  return out;
}

// ---------- Option «jackpot» (owner 28.10: «треба забрати гарантію дропа … настрій у клієнта пропаде») ----------
// A case without the guarantee step of its top class (NOPITY), with a per-class sale table (JACKPOT, see S.ORIGIN_SELL):
// what one open returns on every day type, and how a SESSION of 10 / 30 / 100 opens ends — the share of sessions in
// profit, the median and the p90, how often the red comes and what it pays (× the case price). Each drop is sold for its
// own sale (no class averaging), so the spread is real.
//   JACKPOT='{"elite":{"A":0.26,"S":0.45}}' NOPITY=elite,premium node tools/econ-audit.mjs jackpot [sessions=20000]
export function noTopPity(cs) {
  const top = S.CLASS_ORDER.filter((c) => cs.weights[c]).pop();
  return { ...cs, pity: (cs.pity || []).filter(([c]) => c !== top) };
}
export function sessions(cs, opens, n = 20000, seed = 17, deal = { price: cs.price, boost: S.BOOST, fragments: true, save: true }) {
  const R = (() => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const classes = classEntries(deal.weights || cs.weights), steps = S.pitySteps(cs), top = classes[classes.length - 1][0];
  const pools = Object.fromEntries(classes.map(([c]) => [c, cs.pool(c)]));
  const cheapestWin = classes.flatMap(([c]) => pools[c]).filter((m) => m.price >= cs.price).sort((a, b) => a.price - b.price)[0];
  const expected = cs.ev;
  const out = [], topMult = [];
  let topHits = 0, allOpens = 0;
  for (let s = 0; s < n; s++) {
    const cnt = steps.map(() => 0);
    let paid = 0, sold = 0, streak = 0, frags = 0, keys = 0, spent = 0, got = 0, k = 0;
    while (k < opens) {
      const isPaid = keys === 0;
      if (isPaid) (paid += deal.price, k++);
      else keys--;
      allOpens++;
      const luck = 1 - (1 - deal.boost) * (1 - S.luckChance(spent, got));
      let cls = pickWeighted(classes, R());
      if (luck > 0 && R() < luck) { const again = pickWeighted(classes, R()); if (S.rankOf(again) > S.rankOf(cls)) cls = again; }
      for (let i = steps.length - 1; i >= 0; i--) if (S.rankOf(cls) < S.rankOf(steps[i].cls) && cnt[i] + 1 >= steps[i].n) { cls = steps[i].cls; break; }
      steps.forEach((st, i) => (cnt[i] = S.rankOf(cls) >= S.rankOf(st.cls) ? 0 : cnt[i] + 1));
      let model = S.MODELS[pickModel(pools[cls], R())];
      if (deal.save && streak >= S.LUCK.streak && model.price < cs.price) {
        for (let i = 0; i < S.LUCK.tries && model.price < cs.price; i++) { const c2 = pickWeighted(classes, R()); const m2 = S.MODELS[pickModel(pools[c2], R())]; if (m2.price > model.price) model = m2; }
        if (streak >= S.LUCK.hardStreak && model.price < cs.price && cheapestWin) model = cheapestWin;
      }
      spent = spent * S.LUCK.decay + expected;
      got = got * S.LUCK.decay + model.price;
      streak = model.price >= cs.price ? 0 : streak + 1;
      if (isPaid && deal.fragments && model.price < deal.price && ++frags >= S.FRAGMENTS_PER_KEY) (frags -= S.FRAGMENTS_PER_KEY, keys++);
      const sale = S.sellPriceOf(model.id, Infinity, cs.id);
      sold += sale;
      if (model.cls === top) (topHits++, topMult.push(sale / deal.price));
    }
    out.push(sold / paid);
  }
  out.sort((a, b) => a - b);
  topMult.sort((a, b) => a - b);
  const q = (arr, x) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(x * arr.length))] : 0);
  return { mean: out.reduce((a, b) => a + b, 0) / out.length, profit: out.filter((r) => r >= 1).length / out.length, p10: q(out, 0.1), med: q(out, 0.5), p90: q(out, 0.9), x2: out.filter((r) => r >= 2).length / out.length,
    topPer100: (100 * topHits) / allOpens, topMed: q(topMult, 0.5), topLo: q(topMult, 0.1), topHi: q(topMult, 0.9) };
}
// The sale share of a class out of a case (works on a build without S.caseSellShare too).
const shareOf = (id, c) => (S.caseSellShare ? S.caseSellShare(id, c) : S.SELL_RATES[c] * S.originSellOf(id));
function jackpot(n) {
  const J = process.env.JACKPOT ? JSON.parse(process.env.JACKPOT) : null;
  const NOPITY = new Set((process.env.NOPITY || '').split(',').filter(Boolean));
  const ids = J ? Object.keys(J) : ['elite', 'premium', 'sport', 'c-it', 'c-us', 'c-gb'];
  const before = Object.fromEntries(ids.map((id) => [id, S.ORIGIN_SELL[id]]));
  const row = (label, cs, deal) => {
    const d = allDays(cs, 1e5);
    const s = [10, 30, 100].map((o) => sessions(cs, o, n, 17, deal));
    console.log(`  ${label.padEnd(26)} plain ${f3(d.plain)} deal ${f3(d.deal)} luck ${f3(d.luck)} battle ${f3(d.battle)} worst ${f3(d.max)} | red: ${s[2].topPer100.toFixed(2)}/100 opens, pays ×${s[2].topLo.toFixed(1)}–${s[2].topMed.toFixed(1)}–${s[2].topHi.toFixed(1)} | `
      + s.map((x, i) => `${[10, 30, 100][i]} opens: profit ${pct(x.profit)} ×2+ ${pct(x.x2)} med ${x.med.toFixed(2)} p90 ${x.p90.toFixed(2)}`).join(' | '));
  };
  for (const id of ids) {
    const cs0 = S.CASE_BY_ID[id];
    console.log(`\n== ${id} (${money(cs0.price)}) ==`);
    // Class parts: p (boost, guarantee) × average value and sale.
    const sh = S.effectiveWeights(cs0);
    const cl = S.CLASS_ORDER.filter((c) => sh[c]);
    let F = 0, prev = 0;
    for (const c of cl) {
      F += sh[c];
      const P = (1 - S.BOOST) * F + S.BOOST * F * F, p = P - prev;
      prev = P;
      const list = cs0.pool(c), w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
      const avgV = list.reduce((s, m, i) => s + (m.price * w[i]) / sw, 0);
      console.log(`  ${c}: ${pct(p)} of opens (1 in ${(1 / p).toFixed(1)}), ${list.length} cars ${money(Math.min(...list.map((m) => m.price)))}–${money(Math.max(...list.map((m) => m.price)))}, avg value ${money(avgV)} = ×${(avgV / cs0.price).toFixed(1)} the case; sale now ${pct(shareOf(id, c))} → ×${((avgV * shareOf(id, c)) / cs0.price).toFixed(1)}`);
    }
    row('now (hotfix 71a02c6)', cs0);
    if (J) {
      S.ORIGIN_SELL[id] = J[id];
      const cs = NOPITY.has(id) ? noTopPity(cs0) : cs0;
      row(`jackpot${NOPITY.has(id) ? ' (no top guarantee)' : ''}`, cs);
      for (const c of cl) console.log(`    ${c} sells for ${pct(shareOf(id, c))} of its value`);
      S.ORIGIN_SELL[id] = before[id];
    } else row('no top guarantee only', noTopPity(cs0));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode = 'table', a1, a2] = process.argv.slice(2);
  if (mode === 'jackpot') jackpot(Number(a1 || 2e4));
  else if (mode === 'table') table(Number(a1 || 2e5));
  else if (mode === 'fit') fit(Number(a1 || 0.9), Number(a2 || 1e5));
  else if (mode === 'fitmax') fitMax(Number(a1 || 0.95), Number(a2 || 1e5));
  else if (mode === 'chains') chains();
  else if (mode === 'compound') compound(Number(a1 || 1.5), Number(a2 || 440));
  else if (mode === 'all') { table(Number(a1 || 1e5)); chains(); compound(1.5, 440); }
}
