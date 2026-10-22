// Workshop maths shared by the server (parts/install-best, parts/sell-junk) and the app: what a part really does to
// a car's 402 m time, the best kit from the warehouse for one car, which car a part suits and which parts no car needs.
// Read-only over shared.js (carStats, PARTS, TIERS): no economy numbers live here.
import * as S from './shared.js';

// Smaller differences than this (s) count as no difference — the least the app can show («−0,01 с»): no swap for
// less, no part spent where it gives «≈0 с», no «Поставити на …» that changes nothing.
export const TUNE_EPS = 0.005;
// What imprecise shifts cost an AVERAGE driver per run without a gearbox (s), by the car's base time: a fast car has
// short shift zones, so the gearbox matters there and is worth almost nothing in a slow car. Fitted to
// S.humanRun(S.DRIVERS.average) for bases 5…24 s (within 0.001 s); the gearbox cuts it by its share (S.raceTime).
export const shiftSlip = (base) => 0.11 * Math.exp(-0.255 * (base - 7));
// The time the workshop compares: the card's 402 m time (S.carStats et — reaction 0.2 s, good shifts) plus what an
// average driver loses on shifts with this gearbox. Not rounded to hundredths.
export function tuneTime(car) {
  const st = S.carStats(car);
  return st.base + 0.2 + shiftSlip(st.base) * (1 - st.shift);
}
const withPart = (car, type, tier) => {
  const parts = { ...(car.parts || {}) };
  if (tier) parts[type] = tier;
  else delete parts[type];
  return { model: car.model, parts };
};
const idx = (tier) => (tier ? S.TIER_BY_ID[tier].index : -1);
// The wheels spin: more power per kilo than the tyres hold (factory tyres + grip parts: S.carStats traction). Since
// physics 22.10 the power above that still counts for S.TRACTION.over, so it never makes the car slower.
export const spinning = (car) => {
  const st = S.carStats(car);
  return st.hp / st.kg > st.traction + 1e-9;
};
// Can this car take this part at all: the slot exists (petrol / electric) and the tier is not below the car's class.
export const canTake = (model, type, tier) => !!S.MODELS[model] && S.partFits(model, type) && idx(tier) >= S.minTierFor(S.MODELS[model].cls);

// Effect of putting `tier` of `type` into that slot of the car, replacing what is there (tier null: taking it off).
// dt < 0 — the car gets faster. spin: an upgrade that makes the car slower — the wheels spin (more power, less weight
// or a set bonus the tyres can't hold); worse: a lower tier than the one installed.
export function partGain(car, type, tier) {
  const next = withPart(car, type, tier);
  const dt = tuneTime(next) - tuneTime(car);
  const cur = car.parts?.[type] || null;
  const up = idx(tier) > idx(cur);
  // slip: a power or weight part that helps, but on tyres that can't hold it all (grip parts would give more).
  const slip = dt < -TUNE_EPS && up && ['hp', 'kg'].includes(S.PARTS[type].stat) && spinning(next);
  return { dt, spin: dt > TUNE_EPS && up && spinning(next), slip, worse: !up && tier !== cur && !!tier, same: tier === cur };
}
// What the installed part in that slot gives the car now (dt < 0: it makes the car faster; > 0 with spin: it slows it).
export function partShare(car, type) {
  const cur = car.parts?.[type];
  if (!cur) return null;
  const dt = tuneTime(car) - tuneTime(withPart(car, type, null));
  return { dt, spin: dt > TUNE_EPS && spinning(car) };
}

// The fastest kit for one car from what is on its slots now plus the free pieces on the warehouse (stock: inventory
// rows { type, tier, available }; cooling pieces don't count). Swapped-out parts go back to the warehouse. Exact, not
// greedy:
//  - grip, brakes and gearbox only ever help, so outside a set each takes its best option (never taken off);
//  - power and weight can hurt (wheelspin), so every combination of those slots is tried, taking an installed
//    power/weight part off included (a Bolide on factory tyres is faster without its engine parts);
//  - a set (every slot the same tier, +5% power) is tried for every tier it can be built in, and a kit that turned
//    into a set by itself is also tried with the set broken (the bonus can make a spinning car slower).
// Ties (within TUNE_EPS) go to fewer changes, then more value installed, so the same garage always gets the same kit.
// Returns { parts, changes: [{ type, from, to, dt }], before, after, dt } (dt < 0: faster; change dt: what that change
// gives in the new kit).
export function bestTune(car, stock = []) {
  const m = S.MODELS[car.model];
  const cur = { ...(car.parts || {}) };
  const keys = m ? S.partKeysOf(car.model) : [];
  const before = m ? tuneTime({ model: car.model, parts: cur }) : 0;
  if (!m) return { parts: cur, changes: [], before, after: before, dt: 0 };
  const free = new Set(stock.filter((p) => p.available > 0).map((p) => p.type + ':' + p.tier));
  // Options per slot: what is there now (null = empty), then every free tier the car can take, highest first.
  const opts = Object.fromEntries(keys.map((k) => [k, [cur[k] || null, ...[...S.TIERS].reverse().map((t) => t.id)
    .filter((t) => t !== cur[k] && free.has(k + ':' + t) && canTake(car.model, k, t))]]));
  const fxOf = (k, t) => (t ? S.PARTS[k].fx[S.TIER_BY_ID[t].index] : 0);
  const mono = keys.filter((k) => ['grip', 'et', 'shift'].includes(S.PARTS[k].stat));
  const free2 = keys.filter((k) => !mono.includes(k));
  for (const k of free2) if (cur[k]) opts[k].push(null);
  // Monotone slots, best option first (ties: keep what is there).
  const ranked = Object.fromEntries(mono.map((k) => [k, opts[k].map((t, i) => ({ t, i })).sort((a, b) => fxOf(k, b.t) - fxOf(k, a.t) || a.i - b.i).map((x) => x.t)]));
  const value = (p) => keys.reduce((s, k) => s + (p[k] ? S.TIER_BY_ID[p[k]].price : 0), 0);
  const changed = (p) => keys.filter((k) => (p[k] || null) !== (cur[k] || null)).length;
  const timeOf = (p) => tuneTime({ model: car.model, parts: p });
  const clean = (p) => Object.fromEntries(Object.entries(p).filter(([, t]) => t));
  const seen = [];
  const consider = (p) => {
    const q = clean(p);
    seen.push({ p: q, t: timeOf(q), n: changed(q), v: value(q) });
  };
  const isSet = (p) => keys.every((k) => p[k] && p[k] === p[keys[0]]);
  // Every combination of the power/weight slots, the monotone ones at their best.
  const walk = (i, p) => {
    if (i < free2.length) {
      for (const t of opts[free2[i]]) walk(i + 1, { ...p, [free2[i]]: t });
      return;
    }
    const top = { ...p };
    for (const k of mono) top[k] = ranked[k][0];
    consider(top);
    if (isSet(top)) for (const k of mono) if (ranked[k].length > 1) consider({ ...top, [k]: ranked[k][1] });
  };
  walk(0, {});
  for (const t of S.TIERS) if (keys.every((k) => opts[k].includes(t.id))) consider(Object.fromEntries(keys.map((k) => [k, t.id])));
  consider(cur); // doing nothing is always a candidate
  // Of the kits within TUNE_EPS of the fastest: fewest changes, then most value, then the first tried.
  const tMin = Math.min(...seen.map((c) => c.t));
  const best = seen.filter((c) => c.t <= tMin + TUNE_EPS).reduce((a, c) => (c.n < a.n || (c.n === a.n && c.v > a.v) ? c : a));
  // Changes that give nothing (the kit stays within TUNE_EPS of the fastest without them) are left out.
  let p = { ...best.p };
  for (const k of keys) {
    if ((p[k] || null) === (cur[k] || null)) continue;
    const back = clean({ ...p, [k]: cur[k] || null });
    if (timeOf(back) <= tMin + TUNE_EPS) p = back;
  }
  let after = timeOf(p);
  if (before - after < TUNE_EPS) (p = cur), (after = before);
  const changes = keys.filter((k) => (p[k] || null) !== (cur[k] || null)).map((k) => ({
    type: k, from: cur[k] || null, to: p[k] || null, dt: after - timeOf(clean({ ...p, [k]: cur[k] || null })),
  }));
  return { parts: p, changes, before, after, dt: after - before };
}

// Cars the player can put a part on right now (in the garage or on the showcase).
const installable = (c) => !c.status || c.status === 'garage' || c.status === 'showcase';
// Every car that can take this part, with what it would do there, most useful first.
export function partTargets(cars, type, tier) {
  return cars.filter((c) => installable(c) && canTake(c.model, type, tier))
    .map((c) => ({ car: c, ...partGain(c, type, tier), t: tuneTime(c) }))
    .sort((a, b) => a.dt - b.dt || a.t - b.t || (a.car.id ?? 0) - (b.car.id ?? 0));
}
// Where «Поставити на …» puts a part: the player's fastest car that it makes faster (ties: the bigger gain).
export function bestTarget(cars, type, tier) {
  const ok = partTargets(cars, type, tier).filter((x) => x.dt < -TUNE_EPS);
  return ok.sort((a, b) => a.t - b.t || a.dt - b.dt || (a.car.id ?? 0) - (b.car.id ?? 0))[0] || null;
}
// Parts no car of the player needs: every car that can take the part (its slot exists and its class allows the tier)
// already holds the same tier or a better one there, or no car can take it at all. cars: every car the player owns
// (on the market too); inventory: rows { type, tier, available }. Returns [{ type, tier, count }] (free pieces only).
export function junkParts(cars, inventory) {
  return inventory.filter((p) => p.available > 0 && S.PARTS[p.type] && S.TIER_BY_ID[p.tier])
    .filter((p) => cars.every((c) => !canTake(c.model, p.type, p.tier) || idx(c.parts?.[p.type]) >= idx(p.tier)))
    .map((p) => ({ type: p.type, tier: p.tier, count: p.available }));
}
// «−0,12 с» / «+0,28 с» / «≈0 с»: a time change with a decimal comma (negative = faster).
export const fmtDt = (dt) => (Math.abs(dt) < TUNE_EPS ? '≈0 с' : `${dt < 0 ? '−' : '+'}${Math.abs(dt).toFixed(2).replace('.', ',')} с`);
