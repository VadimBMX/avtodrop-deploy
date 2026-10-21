// Economy check for game events (S.EVENTS) through the real API: a rich player opens a case N times while an event runs,
// sells every drop, and we compare what the sales (plus free keys from fragments) bring with the money actually paid.
// Rule: open-and-sell < S.EVENT_CAPS.sellMax (0.85) of the price paid for every case during every event.
//   node tools/sim-events.mjs [opens=4000] [caseId,caseId...]
// Scenarios: «none» (no case event; the rarity case on a plain day), «day» (rarity case on its case-of-day, no event),
// «luck» (Вихідні удачі), «country» (Країна тижня on this country). Seeds are fixed, so a run is reproducible.
// Also prints the plate generators during «Щасливі номери» and the race / fuel caps.
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';

const DAY = 86400e3;
const kyivNoon = (date) => S.kyivMidnightOf(date) + 12 * 3600e3;
// A moment (noon Kyiv) in the next weeks where `pred(fx, date)` holds.
export function findTime(pred, from = Date.parse('2026-11-02T00:00:00Z')) {
  for (let i = 0; i < 400; i++) {
    const date = S.kyivDateOf(from + i * DAY);
    const t = kyivNoon(date);
    if (pred(S.effectsAt(t), date, t)) return t;
  }
  throw new Error('no such day');
}
// One run: returns { paid, keyOpens, opens, sell, value, below } for `n` paid opens of `cs` at clock `t0`.
// `prep(game)` may start events through the admin API.
export function runCase(cs, t0, n, prep = null, seed = 'sim') {
  let t = t0;
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'x' });
  db.prepare('UPDATE users SET balance = 1e15, slots = 40, level = 50, server_seed = ?, client_seed = ? WHERE id = 1').run(`${seed}:${cs.id}`, 'events');
  g.giveCar(1, 'zaz-lanos');
  if (prep) prep(g);
  const deal = S.caseDeal(cs, S.kyivDateOf(t), S.effectsAt(t, JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'events_override'").get()?.value || 'null')));
  const bal = db.prepare('SELECT balance FROM users WHERE id = 1');
  let paid = 0, sell = 0, value = 0, below = 0, opens = 0, keyOpens = 0;
  while (opens < n) {
    const b0 = bal.get().balance;
    const r = g.api['case/open'](1, { caseId: cs.id });
    const spent = b0 - bal.get().balance;
    const m = S.MODELS[r.results[0].car.model];
    paid += spent;
    sell += S.sellPriceOf(m.id);
    value += m.price;
    if (spent) {
      opens++;
      if (m.price < spent) below++;
    } else keyOpens++;
    g.api.sell(1, { carIds: [r.results[0].car.id] });
    t += 1000;
  }
  return { paid, sell, value, below, opens, keyOpens, price: deal.price, deal };
}
const T = {
  none: (cs) => findTime((fx, date) => fx.topMult === 1 && !fx.countries.includes(cs.country) && S.caseOfDay(date) !== cs.id),
  day: (cs) => findTime((fx, date) => fx.topMult === 1 && S.caseOfDay(date) === cs.id),
  luck: () => findTime((fx) => fx.topMult > 1),
};
// The country of the week for a given country: stop whatever country runs and start this one through the admin API.
const startCountry = (c) => (g) => {
  const ev = g.admin['game-events']('sim');
  for (const e of ev.active.filter((x) => x.id === 'country')) g.admin['game-events/stop']('sim', { key: e.key });
  g.admin['game-events/start']('sim', { event: 'country', country: c, hours: 72 });
};
export function scenarios(cs) {
  if (cs.group === 'rarity') return [['none', T.none(cs)], ['day', T.day(cs)], ['luck', T.luck()]];
  return [['none', T.none(cs)], ['country', T.none(cs), startCountry(cs.country)]];
}
// Exact expected instant-sale return of one paid open under a deal (S.caseDeal): class odds with the guarantees folded
// in (S.effectiveWeights), the hidden boost (throw twice, keep the better class) and the free opens from fragments.
// Only the losing-streak save and the player's own luck are left out — `margin` covers them where they apply.
export function staticSell(cs, deal) {
  const sh = S.effectiveWeights({ ...cs, weights: deal.weights });
  const cl = S.CLASS_ORDER.filter((c) => sh[c]);
  let F = 0, prev = 0, sell = 0, below = 0;
  for (const c of cl) {
    F += sh[c];
    const B = (1 - deal.boost) * F + deal.boost * F * F, p = B - prev;
    prev = B;
    const list = cs.pool(c), w = S.modelWeights(list), sw = w.reduce((a, b) => a + b, 0);
    list.forEach((m, i) => {
      sell += (p * w[i] * S.sellPriceOf(m.id)) / sw;
      if (m.price < deal.price) below += (p * w[i]) / sw;
    });
  }
  const free = deal.fragments ? below / S.FRAGMENTS_PER_KEY : 0;
  return (sell * (1 + free)) / deal.price;
}
// Plate generators: EV of an instant sale (half the value) against the price, with and without «Щасливі номери».
export function plateCheck() {
  const fx = S.eventEffects([{ id: 'plates' }]);
  const ev = (w) => {
    const tw = Object.values(w).reduce((a, b) => a + b, 0);
    return Object.entries(w).reduce((s, [c, x]) => s + (x / tw) * ((S.PLATE_VALUE[c][0] + S.PLATE_VALUE[c][1]) / 2) * 0.5, 0);
  };
  const rows = S.PLATE_GEN.map((g) => ({ id: g.id, price: g.price, event: S.platePriceOf(g.price, g.id, fx), sell: ev(g.weights) }));
  const regions = [...new Set(S.PLATE_REGIONS.map((r) => S.regionPrice(r)))].sort((a, b) => a - b);
  for (const p of regions) rows.push({ id: 'region ' + p, price: p, event: S.platePriceOf(p, 'region', fx), sell: ev(S.REGION_GEN.weights) });
  return rows.map((r) => ({ ...r, base: r.sell / r.price, during: r.sell / r.event }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const N = Number(process.argv[2] || 4000);
  const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
  console.log(`opens per run: ${N}; sell ratio = (instant sales of all drops) / (money paid); free keys count as drops with no price`);
  console.log('case | scenario | price paid | real sell | real EV | below price | free keys/paid');
  let worst = 0, worstDay = 0;
  for (const cs of S.CASES.filter((c) => !c.starter && (!ONLY || ONLY.includes(c.id)))) {
    for (const [name, t0, prep] of scenarios(cs)) {
      const r = runCase(cs, t0, N, prep);
      const sell = r.sell / r.paid;
      if (name === 'luck' || name === 'country') worst = Math.max(worst, sell);
      if (name === 'day') worstDay = Math.max(worstDay, sell);
      console.log([cs.id, name, r.price, sell.toFixed(3), (r.value / r.paid).toFixed(3), ((r.below / r.opens) * 100).toFixed(0) + '%', ((r.keyOpens / r.opens) * 100).toFixed(1) + '%'].join(' | '));
    }
  }
  console.log(`worst sell ratio during an event: ${worst.toFixed(3)} (limit ${S.EVENT_CAPS.sellMax}); case of the day without events (not an event, for reference): ${worstDay.toFixed(3)}`);
  console.log('\nplates | price | during «Щасливі номери» | sell EV | sell/price | during');
  for (const r of plateCheck()) console.log([r.id, r.price, r.event, Math.round(r.sell), r.base.toFixed(3), r.during.toFixed(3)].join(' | '));
  console.log(`\nrace prize ×${S.EVENTS.race.prizeMult} (cap ×${S.EVENT_CAPS.prizeMult}); fuel ×${S.EVENTS.fuel.fuelMult} (cap ×${S.EVENT_CAPS.fuelMult}, with VIP ≤ ×${S.EVENT_CAPS.fuelTotal}); exclusive: ${S.EVENT_EXCLUSIVE.map((p) => p.join('+')).join(', ')}`);
}
