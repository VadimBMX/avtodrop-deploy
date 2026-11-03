// ============================================================================================================================
// АВТОДРОП — THE ECONOMY CONFIG. Every number that sets a price, a payout, a chance of a dearer car or a money sink lives
// here, in one place, so an economy agent (or the owner) can tune the game without reading the rules code.
// No imports: public/shared.js and public/business.js read from it (shared.js imports business.js, so this file must not
// import either). The rules (how a number is used) stay in shared.js / business.js / src/*; only the numbers are here.
//
// Units: ₴ (in-game hryvnias) unless said otherwise; shares are 0…1; «/h» = per hour.
// Tools: `node tools/econ-sim.mjs` (player archetypes over 14 days on the real engine), `node tools/econ-audit.mjs table`
// (open-and-sell of every case on every day type), `node tools/econ-table.mjs` (the price table of every car and case).
// Tests that pin these numbers: test/econ-s2.test.js (the Season 2 targets), test/econ-ev.test.js, test/economy.test.js.
// ============================================================================================================================
export const ECON = {
  version: 's1',

  // ---------- car values ----------
  // Collection value («колекційна ціна») of a model = its place in its class ladder, log-spread from lo to hi
  // (shared.js MODELS: power-to-weight + prestige order the cars, the class sets the range).
  classes: {
    D: { lo: 40000, hi: 100000 },
    C: { lo: 200000, hi: 600000 },
    B: { lo: 2000000, hi: 8000000 },
    A: { lo: 12000000, hi: 45000000 },
    S: { lo: 60000000, hi: 300000000 },
  },
  // Secret cars (class X): the reward for a finished country collection. Value in ₴ (counts in the garage value, income
  // and rating; a secret car can never be sold).
  secrets: {
    UA: 500000000, JP: 625000000, DE: 1000000000, IT: 1500000000, US: 1000000000, GB: 1250000000, CN: 875000000,
  },
  seasonCar: 150000000, // the premium pass's level-30 car of every season (class X, never sold)
  countryRewardShare: 0.044, // money for a finished country collection = this × its secret car's value

  // ---------- instant sale to the dealer ----------
  sellRates: { D: 0.5, C: 0.45, B: 0.4, A: 0.35, S: 0.3, X: 0.3 }, // share of the model's value
  homeSellRate: 0.1, // UA collector cars (gold Soviet rarities)
  editionSell: 0.1, // «тиражні» cars
  restoredMult: 1.6, // a barn find restored to «R» is worth this × the base car
  // Per-case buy-back of a fresh drop: a number (× the class rate) or a per-class table of shares.
  originSell: {
    city: 0.79, tuning: 0.95, 'c-ua': 0.9,
    sport: { B: 0.28, A: 0.266, S: 0.4 },
    premium: { B: 0.3, A: 0.22, S: 0.4 },
    elite: { A: 0.22, S: 0.45 },
    'c-it': { B: 0.27, A: 0.245, S: 0.3 },
    'c-us': { B: 0.28, A: 0.259, S: 0.3 },
    'c-gb': { B: 0.27, A: 0.248, S: 0.3 },
  },

  // ---------- cases ----------
  // A case's pool = the cars of its classes priced inside [lo × price, hi × price] (country cases: no lower bound).
  caseCorridor: { lo: 0.5, hi: 12 },
  // id → { price, weights (class odds, %), pity: [[class, n, opts?]] (guarantee steps), hi (corridor top × price) }
  rarityCases: {
    rust: { price: 60000, weights: { D: 93.56, C: 6, B: 0.4, A: 0.04 }, pity: [['C', 25]], hi: 2000 },
    city: { price: 300000, weights: { C: 92.61, B: 7, A: 0.35, S: 0.04 }, pity: [['B', 30]], hi: 1000 },
    tuning: { price: 900000, weights: { C: 74.83, B: 24, A: 1.1, S: 0.07 }, pity: [['A', 200]], hi: 340 },
    sport: { price: 2000000, weights: { B: 92.15, A: 7.6, S: 0.25 }, pity: [['A', 30]], hi: 150 },
    premium: { price: 5000000, weights: { B: 55.2, A: 43, S: 1.8 }, pity: [], hi: 61 },
    elite: { price: 10000000, weights: { A: 94.5, S: 5.5 }, pity: [], hi: 31 },
  },
  countryCases: {
    UA: { price: 55000, weights: { D: 94.7, C: 5, A: 0.3 }, pity: [['C', 35], ['A', 300, { missing: true }]], hi: 460 },
    JP: { price: 450000, weights: { C: 92.67, B: 7, A: 0.3, S: 0.03 }, pity: [['B', 30]], hi: 400 },
    DE: { price: 400000, weights: { C: 93.68, B: 6, A: 0.3, S: 0.02 }, pity: [['B', 30]], hi: 570 },
    CN: { price: 480000, weights: { C: 90.3, B: 9, A: 0.6, S: 0.1 }, pity: [['B', 25]], hi: 400 },
    US: { price: 2400000, weights: { B: 83.4, A: 16, S: 0.6 }, pity: [], hi: 130 },
    GB: { price: 3100000, weights: { B: 87, A: 12.4, S: 0.6 }, pity: [], hi: 91 },
    IT: { price: 3200000, weights: { B: 89.5, A: 10, S: 0.5 }, pity: [], hi: 58 },
  },
  casePriceMult: {}, // safety valve: × price after the pool is fixed (same cars, dearer case)
  caseOfDayOff: 0.1, // the case of the day is this much cheaper (and has no hidden boost)
  boost: 0.15, // hidden chance to throw the class twice and keep the better one
  fragmentsPerKey: 8, // drops below the case price leave a fragment; this many make a free key

  // ---------- garage ----------
  startBalance: 250000,
  firstCash: 2500, // the first garage income, put in the cash box by the starter case
  startSlots: 6,
  maxSlots: 40,
  slot: { base: 50000, steep: 1.6, softFrom: 16, soft: 1.25 }, // place n costs base × steep^(min(n,softFrom)−start) × soft^(n−softFrom)
  showcase: { start: 4, max: 12, base: 300000 },
  // Garage income per hour, share of the car's value, by class (X: secret/season cars and parts/plates on a car).
  classIncome: { D: 0.07, C: 0.04, B: 0.016, A: 0.005, S: 0.0025, X: 0.0006 },
  capLevels: [{ hours: 4, cost: 0 }, { hours: 6, cost: 400000 }, { hours: 8, cost: 4000000 }, { hours: 12, cost: 40000000 }],

  // ---------- races ----------
  // Money per race for a good driver racing a car of value v: base × (v / ref)^pow (v capped at the top of class S).
  race: { base: 10000, ref: 40000, pow: 0.56 },
  fuel: { max: 15, regenMin: 20, tanks: [{ max: 18, cost: 2000000, level: 5 }, { max: 21, cost: 10000000, level: 10 }, { max: 25, cost: 50000000, level: 15 }] },

  // ---------- parts ----------
  partTiers: { stock: 8000, street: 25000, sport: 90000, pro: 350000, race: 1400000 },
  partCaseMarkup: 0.6, // a part case costs this × the average value of what it drops

  // ---------- progression ----------
  levelMoney: 15000, // level-up reward = levelMoney × level²
  questPay: 3.6,
  refReward: 1000000,

  // ---------- trading risk ----------
  upgrade: { maxCars: 6, minMult: 1.2, maxMult: 50, edge: 0.92, perExtraCar: 0.01, maxChance: 0.75 },
  tradeIn: { cars: 3, chance: 0.3, maxMult: 2.5 },

  // ---------- Stars (real money) ----------
  packs: [
    { id: 'p0', stars: 15, amount: 400000, title: '400 тис ₴' },
    { id: 'p1', stars: 50, amount: 1500000, title: '1,5 млн ₴' },
    { id: 'p2', stars: 150, amount: 5000000, title: '5 млн ₴', tag: '+11%' },
    { id: 'p3', stars: 500, amount: 19000000, title: '19 млн ₴', tag: '+27%' },
    { id: 'p4', stars: 1500, amount: 65000000, title: '65 млн ₴', tag: '+44%' },
  ],
  packScale: { level: 1.25, garageBase: 20e6, garagePow: 0.85, max: 25 },
  packOffer: { minLevel: 3, everyDays: 3, hours: 6, mult: 2 },
  firstBuyMult: 3,
  vip: { days: 14, stars: 300, fuelMult: 2, extraHours: 4, daily: 150000 },

  // ---------- «Мої бізнеси» (public/business.js) ----------
  biz: {
    list: [
      { id: 'wash', level: 3, price: 2_000_000, income: 30_000 },
      { id: 'gas', level: 5, price: 6_000_000, income: 80_000 },
      { id: 'sto', level: 8, price: 15_000_000, income: 180_000 },
      { id: 'salon', level: 15, price: 50_000_000, income: 500_000 },
    ],
    capHours: 4, vipCapHours: 8, growth: 1.75,
    salonSell: 0.05, stoParts: 0.15,
  },
};
