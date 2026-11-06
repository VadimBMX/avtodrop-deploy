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
  version: 's2',

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
  // S2 rule: ≈ 1.5 × the median NET cash cost of finishing the collection with its own case (money paid − instant sale of
  // every duplicate; tools/econ-table.mjs «collections»), never under 1.25 × the dearest car of that collection. S1 values
  // ignored the resale: UA paid 500 млн for ~13 млн net (×39, «за 5–10 хвилин»), DE paid 1 млрд for ~1,7 млрд net (×0,6).
  secrets: {
    UA: 30000000, JP: 450000000, DE: 1800000000, IT: 2700000000, US: 400000000, GB: 2000000000, CN: 600000000,
  },
  seasonCar: 150000000, // the premium pass's level-30 car of every season (class X, never sold)
  countryRewardShare: 0.05, // money for a finished country collection = this × its secret car's value

  // ---------- instant sale to the dealer ----------
  sellRates: { D: 0.5, C: 0.5, B: 0.5, A: 0.5, S: 0.5, X: 0.5 }, // share of the model's value
  homeSellRate: 0.1, // UA collector cars (gold Soviet rarities)
  editionSell: 0.1, // «тиражні» cars
  restoredMult: 1.6, // a barn find restored to «R» is worth this × the base car
  // Per-case buy-back of a fresh drop: a number (× the class rate) or a per-class table of shares.
  originSell: {},

  // ---------- cases ----------
  // A case's pool = the cars of its classes priced inside [lo × price, hi × price] (country cases: no lower bound).
  caseCorridor: { lo: 0.6, hi: 12 },
  // id → { price, weights (class odds, %), pity: [[class, n, opts?]] (guarantee steps), hi (corridor top × price) }
  rarityCases: {
    rust: { price: 65000, weights: { D: 95, C: 4.65, B: 0.32, A: 0.03 }, pity: [['C', 25]], hi: 2000 },
    city: { price: 450000, weights: { C: 95.5, B: 4.2, A: 0.27, S: 0.03 }, pity: [['B', 30]], hi: 1000 },
    tuning: { price: 1000000, lo: 0.5, weights: { C: 84.36, B: 14.8, A: 0.8, S: 0.04 }, pity: [['A', 200]], hi: 340 },
    sport: { price: 3700000, weights: { B: 93.9, A: 5.9, S: 0.2 }, pity: [['A', 30]], hi: 150 },
    premium: { price: 9000000, weights: { B: 66.8, A: 31.9, S: 1.3 }, pity: [], hi: 61 },
    elite: { price: 19000000, weights: { A: 94, S: 6 }, pity: [], hi: 31 },
  },
  countryCases: {
    UA: { price: 70000, weights: { D: 94.2, C: 5.5, A: 0.3 }, pity: [['C', 35], ['A', 300, { missing: true }]], hi: 460 },
    JP: { price: 450000, lo: 0.45, weights: { C: 95.6, B: 4.2, A: 0.18, S: 0.02 }, pity: [['B', 30], ['S', 2500, { missing: true }]], hi: 400 },
    DE: { price: 500000, lo: 0.45, weights: { C: 94.62, B: 5.1, A: 0.26, S: 0.02 }, pity: [['B', 30], ['S', 2500, { missing: true }]], hi: 570 },
    CN: { price: 280000, lo: 0.45, weights: { C: 97.63, B: 2.2, A: 0.15, S: 0.02 }, pity: [['B', 25], ['S', 2500, { missing: true }]], hi: 400 },
    US: { price: 4200000, lo: 0.5, weights: { B: 85.2, A: 14.3, S: 0.5 }, pity: [['S', 500, { missing: true }]], hi: 130 },
    GB: { price: 5500000, lo: 0.5, weights: { B: 90.2, A: 9.3, S: 0.5 }, pity: [['S', 500, { missing: true }]], hi: 91 },
    IT: { price: 6000000, lo: 0.5, weights: { B: 88.8, A: 10.7, S: 0.5 }, pity: [['S', 500, { missing: true }]], hi: 58 },
  },
  casePriceMult: {}, // safety valve: × price after the pool is fixed (same cars, dearer case)
  caseOfDayOff: 0.1, // the case of the day is this much cheaper (and has no hidden boost)
  boost: 0.15, // hidden chance to throw the class twice and keep the better one
  fragmentsPerKey: 8, // drops below the case price leave a fragment; this many make a free key

  // ---------- garage ----------
  startBalance: 500000,
  firstCash: 2500, // the first garage income, put in the cash box by the starter case
  startSlots: 6,
  maxSlots: 40,
  slot: { base: 50000, steep: 1.6, softFrom: 16, soft: 1.25 }, // place n costs base × steep^(min(n,softFrom)−start) × soft^(n−softFrom)
  showcase: { start: 4, max: 12, base: 300000 },
  // Garage income per hour, share of the car's value, by class (X: secret/season cars and parts/plates on a car).
  classIncome: { D: 0.08, C: 0.05, B: 0.016, A: 0.004, S: 0.002, X: 0.0006 },
  // The garage cash holds this many hours of income, with VIP vipHours — the same rule as the businesses (biz below).
  // David 04.11: no paid cap upgrades any more (were 6 / 8 / 12 h for 400 тис / 4 млн / 40 млн; refunded once).
  garageCap: { hours: 4, vipHours: 8 },

  // ---------- races ----------
  // Money per race for a good driver racing a car of value v: base × (v / ref)^pow (v capped at the top of class S).
  race: { base: 20000, ref: 40000, pow: 0.5 },
  fuel: { max: 15, regenMin: 20, tanks: [{ max: 18, cost: 2000000, level: 5 }, { max: 21, cost: 10000000, level: 10 }, { max: 25, cost: 50000000, level: 15 }] },

  // ---------- parts ----------
  partTiers: { stock: 8000, street: 25000, sport: 90000, pro: 350000, race: 1400000 },
  partCaseMarkup: 0.6, // a part case costs this × the average value of what it drops

  // ---------- progression ----------
  // Daily level cap (David 04.11, «попробуємо»): on the Nth Kyiv day since sign-up — or since the Season 2 wipe / an admin
  // reset, whichever is later — a player can be at most level perDay × N (day 1 → 3, day 2 → 6, …). XP is never lost:
  // it keeps piling up over the cap and the levels (each with its reward, once) come the next day. perDay 0 = no cap.
  levelCap: { perDay: 3 },
  levelMoney: 25000, // 04.11 (David: «2,5 млн за 5 хв — забагато»; was 40 000) level-up reward = levelMoney × level²
  questPay: 3.6,
  // «Перші кроки» (S.NEWBIE_TASKS): money per step, in the order of the track.
  newbieMoney: { open_starter: 15000, collect: 20000, race: 30000, daily: 15000, win: 50000, open_case: 60000, install: 60000, level3: 150000 }, // 04.11: 400 тис total (was 1 010 000)
  refReward: 1000000,
  // d2-wall (sim-report «стіна першої сесії»): a newcomer's first long session ran dry at ~8 min (15 fuel, start money in
  // cases, nothing left to do). Only for an account younger than these hours (users.created_at) — veterans never see it:
  //   fuelRefills: free full tanks on an empty tank in the first fuelHours (users.newbie_fuel counts them);
  //   rcaseMin: the reward case comes every rcaseMin minutes (not REWARD_CASE_HOURS) while the last one was taken in the
  //   account's first rcaseHours — 4 cases in the first 1.5 h instead of 1.
  // Tuned on tools/sim-newbies.mjs (3 seeds, 7 for the edge personas): the wall of a long first session moves from minute
  // 7 to 12; day-7 worth +2…17% (2 refills + every 20 min for 2 h gave +20…37% earned income — too much for veterans-to-be).
  newbie: { fuelRefills: 1, fuelHours: 24, rcaseMin: 30, rcaseHours: 1.5 },

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
  packScale: { level: 1.2, garageBase: 20e6, garagePow: 0.8, max: 10 },
  packOffer: { minLevel: 3, everyDays: 3, hours: 6, mult: 1.5 },
  firstBuyMult: 2,
  vip: { days: 14, stars: 300, fuelMult: 2, extraHours: 4, daily: 150000 }, // extraHours = garageCap.vipHours − garageCap.hours

  // ---------- «Мої бізнеси» (public/business.js) ----------
  biz: {
    // owner 06.11: prices ×2 (the first business felt too cheap); incomes unchanged
    list: [
      { id: 'wash', level: 3, price: 4_000_000, income: 60_000 },
      { id: 'gas', level: 5, price: 12_000_000, income: 160_000 },
      { id: 'sto', level: 7, price: 30_000_000, income: 360_000 },
      { id: 'salon', level: 10, price: 100_000_000, income: 1_000_000 },
    ],
    capHours: 4, vipCapHours: 8, growth: 1.5,
    salonSell: 0.02, stoParts: 0.15,
  },
  // ---------- «Зірковий кейс» (David 06.11) ----------
  // Bought ONLY for real Telegram Stars (an invoice; never the virtual star credit or the stars on the account — that
  // would be a stars → credit → case → credit loop). Drops VIRTUAL stars onto users.star_credit (the shop balance).
  // [stars, chance %]: the chances sum to 100, EV = Σ stars × chance = 41.65 ⭐ < 50 ⭐ — the house keeps ~16.7%
  // (the brief said «≈ 46.6»; the table as given sums to 41.65)
  // (test/r11-starcase.test.js pins both). Shown to players as «Шанси» (Telegram wants odds disclosed).
  starCase: {
    stars: 50,
    prizes: [[10, 30], [20, 25], [30, 18], [50, 13], [75, 8], [150, 4.5], [500, 1.2], [1000, 0.3]],
  },
};
