// «Сарайна знахідка» — the rules, shared by the server (src/barn.js), the app (public/barn-ui.js), tests and
// tools/sim-barn.mjs. You find a rotten classic (a free one every week, sometimes in a won container), restore it in
// four stages of 6–12 real hours — each eats parts from the warehouse and some money — and get its «R» version
// (S.R_OF: ×1,6 value and income, own livery and badge, not in cases, not in collections, tradeable).
// Economy (tools/sim-barn.mjs): a restoration costs ≈ 0,9–1,1 of the base car (money + parts at what they cost to get),
// the dealer pays for the R what a plain base car sells for (0,3–0,5 of the base) — so restoring to sell is a loss;
// what you win is ×1,6 garage value and income in one garage slot, after ~36 h.
import * as S from './shared.js';

export const BARN = {
  maxFinds: 3, // finds waiting in the shed (not started); a weekly find can't be taken and a container rolls none above it
  rushPerHour: 0.03, // «Прискорити»: per started hour left, this share of the base car's price (hryvnias only, never Stars)
  rushMin: 1000,
  // A won container hides a find: flooded («junk») lots more often. Rolled once per lot from its own committed salt.
  lotChance: { junk: 0.35, normal: 0.06 },
};

// Money per stage = share × base price × MONEY_F[class] (parts make up the rest of the cost; cheap D cars pay mostly
// in parts, the dear ones mostly in money — see tools/sim-barn.mjs).
export const MONEY_F = { D: 0.3, C: 0.85, B: 0.95, A: 0.95, S: 0.95 };
// Parts tier a stage takes, by the car's class: one below what the class normally needs (D/C both take Stock), so
// the junk tiers of the warehouse have a use; any better tier is accepted too, the cheapest goes first.
export const PART_TIER = { D: 'stock', C: 'stock', B: 'street', A: 'sport', S: 'pro' };
// parts: [type, n]; 'any' = any part type (the interior eats whatever lies around).
export const STAGES = [
  { id: 'body', name: 'Кузов', icon: 'car', hours: 8, money: 0.25, parts: [['body', 2], ['suspension', 1]], ready: 'Кузов готовий', verb: 'Варимо й рихтуємо кузов' },
  { id: 'engine', name: 'Двигун', icon: 'engine', hours: 12, money: 0.3, parts: [['eng', 1], ['gearbox', 1], ['exhaust', 1]], ready: 'Двигун готовий', verb: 'Перебираємо двигун' },
  { id: 'interior', name: 'Салон', icon: 'adjustments', hours: 6, money: 0.15, parts: [['any', 3]], ready: 'Салон готовий', verb: 'Перешиваємо салон' },
  { id: 'paint', name: 'Фарба', icon: 'spray', hours: 10, money: 0.3, parts: [['wheels', 1], ['brakes', 1]], ready: 'Фарба висохла', verb: 'Фарбуємо' },
];
export const STAGE_HOURS = STAGES.reduce((s, x) => s + x.hours, 0);

// Where finds come from. Weekly: the class by the player's level (A/S only late and rare). Containers: by the lot's tier.
export const WEEKLY_ODDS = [
  { level: 1, w: { D: 100 } },
  { level: 6, w: { D: 70, C: 30 } },
  { level: 10, w: { D: 45, C: 40, B: 13, A: 1.8, S: 0.2 } },
];
export const LOT_ODDS = {
  odesa: { D: 75, C: 25 },
  customs: { C: 70, B: 30 },
  japan: { B: 85, A: 13, S: 2 },
  ghost: { C: 60, B: 40 },
};
export const weeklyOdds = (level) => [...WEEKLY_ODDS].reverse().find((o) => level >= o.level).w;
export const poolOf = (cls) => S.BARN_MODELS.filter((id) => S.MODELS[id].cls === cls);

// u1, u2 in [0, 1): class, then the model inside it (all equally likely).
export function pickFind(w, u1, u2) {
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let x = u1 * total, cls = Object.keys(w)[0];
  for (const [c, p] of Object.entries(w)) {
    if (x < p) {
      cls = c;
      break;
    }
    x -= p;
  }
  const pool = poolOf(cls);
  return pool[Math.min(pool.length - 1, Math.floor(u2 * pool.length))];
}

export const stageMoney = (model, i) => Math.round((S.MODELS[model].price * STAGES[i].money * MONEY_F[S.MODELS[model].cls]) / 100) * 100;
export const totalMoney = (model) => STAGES.reduce((s, _, i) => s + stageMoney(model, i), 0);
export const partTierOf = (model) => PART_TIER[S.MODELS[model].cls];
export const partsCount = () => STAGES.reduce((s, x) => s + x.parts.reduce((a, [, n]) => a + n, 0), 0);
export function rushCost(model, msLeft) {
  if (msLeft <= 0) return 0;
  return Math.max(BARN.rushMin, Math.round((Math.ceil(msLeft / 3600e3) * S.MODELS[model].price * BARN.rushPerHour) / 100) * 100);
}
// The «R» car a find becomes and what it's worth.
export const rOf = (model) => S.R_OF[model];

// Which warehouse parts a stage takes: inv = [{ type, tier, available }]. The cheapest accepted tier first; for
// 'any', the most plentiful type of that tier first. → { take: [{ type, tier, n }], missing: [{ type, tier, n }] }.
export function partsPlan(model, i, inv) {
  const min = S.TIER_BY_ID[partTierOf(model)].index;
  const left = new Map(inv.filter((p) => S.TIER_BY_ID[p.tier] && S.PARTS[p.type] && S.TIER_BY_ID[p.tier].index >= min && p.available > 0).map((p) => [p.type + ':' + p.tier, { ...p, n: p.available }]));
  const take = [], missing = [];
  const grab = (key, k) => {
    const e = left.get(key);
    const n = Math.min(e.n, k);
    e.n -= n;
    const t = take.find((x) => x.type === e.type && x.tier === e.tier);
    if (t) t.n += n;
    else take.push({ type: e.type, tier: e.tier, n });
    return n;
  };
  const byTier = (a, b) => S.TIER_BY_ID[a.tier].index - S.TIER_BY_ID[b.tier].index;
  for (const [type, need] of STAGES[i].parts) {
    if (type === 'any') continue;
    let k = need;
    for (const e of [...left.values()].filter((e) => e.type === type).sort(byTier)) if (k > 0 && e.n > 0) k -= grab(e.type + ':' + e.tier, k);
    if (k > 0) missing.push({ type, tier: partTierOf(model), n: k });
  }
  for (const [type, need] of STAGES[i].parts) {
    if (type !== 'any') continue;
    let k = need;
    while (k > 0) {
      const e = [...left.values()].filter((x) => x.n > 0).sort((a, b) => byTier(a, b) || b.n - a.n || (a.type < b.type ? -1 : 1))[0];
      if (!e) break;
      k -= grab(e.type + ':' + e.tier, 1);
    }
    if (k > 0) missing.push({ type: 'any', tier: partTierOf(model), n: k });
  }
  return { take, missing };
}
// What a part list costs at tier price (for the sim and the «на що підуть» line).
export const partsValue = (list) => list.reduce((s, p) => s + S.TIER_BY_ID[p.tier].price * p.n, 0);
export const partName = (type, tier) => (type === 'any' ? `будь-які деталі ${S.TIER_BY_ID[tier].name}+` : S.partLabel(type, tier));

// The look of a find on its way: rust and dirt fade stage by stage (the app's carArt dirt + a CSS rust filter).
export const rustOf = (done) => [1, 0.65, 0.45, 0.25, 0][done] ?? 0;
export const dirtOf = (done) => [100, 70, 50, 30, 0][done] ?? 0;
