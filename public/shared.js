// Shared game data and formulas — imported by both the server and the mini app.

export const CURRENCY = '₴';

export const CLASSES = {
  // Each class starts about 2× above the one below: a rare drop is worth several times its case, never a hundred times,
  // so the cheap end of a case is never worthless next to its price (see CASE_CORRIDOR).
  D: { name: 'Звичайний', color: '#9aa4b2', lo: 40000, hi: 100000 },
  C: { name: 'Рідкісний', color: '#3b82f6', lo: 200000, hi: 600000 },
  B: { name: 'Епічний', color: '#a855f7', lo: 1200000, hi: 3500000 },
  A: { name: 'Легендарний', color: '#f59e0b', lo: 7000000, hi: 18000000 },
  S: { name: 'Міфічний', color: '#ef4444', lo: 40000000, hi: 120000000 },
  X: { name: 'Секретний', color: '#22d3ee', lo: 0, hi: 0 },
};
export const CLASS_ORDER = ['D', 'C', 'B', 'A', 'S', 'X'];
export const rankOf = (cls) => CLASS_ORDER.indexOf(cls);

export const COUNTRIES = {
  UA: { name: 'Україна/СРСР', flag: '🇺🇦' },
  JP: { name: 'Японія', flag: '🇯🇵' },
  DE: { name: 'Німеччина', flag: '🇩🇪' },
  IT: { name: 'Італія', flag: '🇮🇹' },
  US: { name: 'США', flag: '🇺🇸' },
  GB: { name: 'Британія', flag: '🇬🇧' },
  FR: { name: 'Франція', flag: '🇫🇷' },
  SE: { name: 'Швеція', flag: '🇸🇪' },
  KR: { name: 'Корея', flag: '🇰🇷' },
  CZ: { name: 'Чехія', flag: '🇨🇿' },
  HR: { name: 'Хорватія', flag: '🇭🇷' },
  RO: { name: 'Румунія', flag: '🇷🇴' },
  CN: { name: 'Китай', flag: '🇨🇳' },
};
// Countries with their own case, collection reward and secret car.
export const MAIN_COUNTRIES = ['UA', 'JP', 'DE', 'IT', 'US', 'GB', 'CN'];

// [name, class, hp, kg, body, country, year, 'ev'?] — 'ev' marks an electric car (it takes the electric parts).
// Prices come from the class range by power-to-weight; nothing is fixed, so adding a car reflows its class.
const RAW = [
  ['ЗАЗ-965 «Горбатий»', 'D', 27, 640, 'hatch', 'UA', 1960],
  ['ЗАЗ-968М «Запорожець»', 'D', 41, 840, 'hatch', 'UA', 1980],
  ['ЗАЗ-1102 «Таврія»', 'D', 51, 745, 'hatch', 'UA', 1990],
  ['ЗАЗ-1103 «Славута»', 'D', 51, 795, 'hatch', 'UA', 2000],
  ['ВАЗ-2101 «Копійка»', 'D', 64, 955, 'sedan', 'UA', 1975],
  ['ВАЗ-2106', 'D', 75, 1035, 'sedan', 'UA', 1985],
  ['ВАЗ-2107', 'D', 72, 1030, 'sedan', 'UA', 1995],
  ['ВАЗ-2109', 'D', 70, 915, 'hatch', 'UA', 1990],
  ['Москвич-412', 'D', 75, 1045, 'sedan', 'UA', 1975],
  ['ГАЗ-24 «Волга»', 'D', 95, 1420, 'sedan', 'UA', 1978],
  ['ЗАЗ Lanos', 'D', 86, 1030, 'sedan', 'UA', 2008],
  ['ЗАЗ Sens', 'D', 70, 1030, 'sedan', 'UA', 2006],
  ['ВАЗ-2121 «Нива»', 'D', 80, 1210, 'suv', 'UA', 1985],
  ['ВАЗ-2105 VFTS', 'C', 160, 900, 'sedan', 'UA', 1983],
  ['ГАЗ-24-24 «Волга» V8', 'C', 195, 1500, 'sedan', 'UA', 1980],
  // Gold (A) Soviet rarities: the hunt of the Ukrainian collection (home-case only, see below).
  ['ГАЗ-24-95 «Волга» 4x4', 'A', 95, 1500, 'sedan', 'UA', 1974],
  ['ВАЗ-2108 Group B', 'A', 300, 930, 'hatch', 'UA', 1986],
  ['ГАЗ-13 «Чайка»', 'A', 195, 2100, 'sedan', 'UA', 1965],
  ['ЗІЛ-41047', 'A', 315, 3335, 'sedan', 'UA', 1988],

  ['Fiat 500', 'D', 13, 470, 'hatch', 'IT', 1960],
  ['Fiat Uno', 'D', 45, 800, 'hatch', 'IT', 1988],
  ['Lancia Delta HF Integrale', 'C', 215, 1300, 'hatch', 'IT', 1992],
  ['Alfa Romeo Giulia Quadrifoglio', 'B', 510, 1580, 'sedan', 'IT', 2020],
  ['Ferrari 458 Italia', 'A', 570, 1380, 'super', 'IT', 2012],
  ['Lamborghini Huracán EVO', 'A', 640, 1420, 'super', 'IT', 2020],
  ['Lamborghini Urus', 'A', 650, 2200, 'suv', 'IT', 2021],
  ['Pagani Huayra', 'S', 730, 1350, 'super', 'IT', 2014],
  ['Lamborghini Aventador SVJ', 'S', 770, 1525, 'super', 'IT', 2019],
  ['Ferrari LaFerrari', 'S', 963, 1585, 'super', 'IT', 2014],
  ['Ferrari SF90 Stradale', 'S', 1000, 1570, 'super', 'IT', 2021],

  ['Toyota Corolla E120', 'D', 110, 1180, 'sedan', 'JP', 2003],
  ['Mitsubishi Lancer IX', 'D', 98, 1170, 'sedan', 'JP', 2006],
  ['Honda Civic EK', 'D', 115, 1050, 'hatch', 'JP', 1998],
  ['Mazda MX-5 NA', 'C', 116, 960, 'coupe', 'JP', 1992],
  ['Toyota Corolla AE86', 'C', 130, 950, 'coupe', 'JP', 1986],
  ['Nissan 200SX S13', 'C', 169, 1200, 'coupe', 'JP', 1990],
  ['Honda Civic Type R EP3', 'C', 200, 1200, 'hatch', 'JP', 2003],
  ['Subaru Impreza WRX GC8', 'C', 218, 1250, 'sedan', 'JP', 1998],
  ['Toyota Supra MK3', 'C', 232, 1520, 'coupe', 'JP', 1990],
  ['Toyota Land Cruiser 80', 'C', 205, 2200, 'suv', 'JP', 1995],
  ['Mitsubishi Lancer Evolution VI', 'C', 276, 1360, 'sedan', 'JP', 1999],
  ['Toyota Mark II JZX100', 'C', 280, 1470, 'sedan', 'JP', 1998],
  ['Nissan Silvia S15', 'B', 250, 1240, 'coupe', 'JP', 2001],
  ['Toyota GR Yaris', 'B', 261, 1280, 'hatch', 'JP', 2021],
  ['Honda NSX NA1', 'B', 274, 1370, 'super', 'JP', 1992],
  ['Mazda RX-7 FD', 'B', 280, 1280, 'coupe', 'JP', 1995],
  ['Mitsubishi Lancer Evolution IX', 'B', 286, 1400, 'sedan', 'JP', 2006],
  ['Subaru Impreza WRX STI', 'B', 300, 1430, 'sedan', 'JP', 2005],
  ['Toyota Supra A80', 'B', 330, 1510, 'coupe', 'JP', 1997],
  ['Nissan Skyline GT-R R34', 'B', 330, 1560, 'coupe', 'JP', 1999],
  ['Lexus IS F', 'B', 423, 1700, 'sedan', 'JP', 2010],
  ['Nissan GT-R R35', 'A', 570, 1750, 'coupe', 'JP', 2017],
  ['Lexus LFA', 'S', 560, 1480, 'super', 'JP', 2011],

  ['Volkswagen Golf II', 'D', 90, 920, 'hatch', 'DE', 1989],
  ['Volkswagen Passat B3', 'D', 115, 1180, 'wagon', 'DE', 1990],
  ['Opel Vectra A', 'D', 116, 1150, 'sedan', 'DE', 1993],
  ['Ford Sierra', 'D', 115, 1100, 'sedan', 'DE', 1988],
  ['BMW 325i E30', 'C', 171, 1200, 'sedan', 'DE', 1989],
  ['Mercedes-Benz 190E 2.3-16', 'C', 185, 1250, 'sedan', 'DE', 1988],
  ['Audi 80 quattro', 'C', 136, 1200, 'sedan', 'DE', 1985],
  ['Volkswagen Golf GTI Mk5', 'C', 200, 1340, 'hatch', 'DE', 2006],
  ['Volkswagen Golf GTI Mk7', 'C', 230, 1350, 'hatch', 'DE', 2015],
  ['BMW X5 E70', 'C', 355, 2200, 'suv', 'DE', 2010],
  ['BMW M3 E30', 'B', 238, 1200, 'sedan', 'DE', 1990],
  ['BMW M3 E46', 'B', 343, 1570, 'coupe', 'DE', 2003],
  ['Volkswagen Golf R', 'B', 320, 1480, 'hatch', 'DE', 2019],
  ['BMW M2 Competition', 'B', 410, 1550, 'coupe', 'DE', 2020],
  ['Audi RS4 B7', 'B', 420, 1650, 'wagon', 'DE', 2007],
  ['Mercedes-AMG C63 S', 'B', 510, 1750, 'sedan', 'DE', 2019],
  ['Porsche 911 Turbo S', 'A', 650, 1640, 'super', 'DE', 2021],
  ['BMW M5 CS', 'A', 635, 1825, 'sedan', 'DE', 2021],
  ['Mercedes-AMG GT R', 'A', 585, 1630, 'super', 'DE', 2019],
  ['Audi R8 V10 Plus', 'A', 610, 1590, 'super', 'DE', 2017],
  ['Mercedes-AMG G63', 'A', 585, 2560, 'suv', 'DE', 2021],
  ['Porsche Taycan Turbo S', 'A', 761, 2300, 'sedan', 'DE', 2021, 'ev'],
  ['Porsche 918 Spyder', 'S', 887, 1675, 'super', 'DE', 2015],
  ['Mercedes-AMG One', 'S', 1063, 1695, 'super', 'DE', 2023],

  ['Ford Mustang GT (2005)', 'C', 300, 1600, 'muscle', 'US', 2005],
  ['Jeep Wrangler', 'C', 284, 1900, 'suv', 'US', 2018],
  ['Ford Mustang (1967)', 'B', 320, 1450, 'muscle', 'US', 1967],
  ['Chevrolet Camaro SS', 'B', 455, 1680, 'muscle', 'US', 2019],
  ['Dodge Challenger SRT Hellcat', 'B', 717, 2000, 'muscle', 'US', 2019],
  ['Tesla Model 3 Performance', 'B', 510, 1850, 'sedan', 'US', 2022, 'ev'],
  ['Chevrolet Corvette C8', 'A', 495, 1530, 'super', 'US', 2021],
  ['Dodge Viper ACR', 'A', 645, 1560, 'muscle', 'US', 2017],
  ['Ford GT', 'A', 656, 1385, 'super', 'US', 2018],
  ['Shelby GT500', 'A', 760, 1900, 'muscle', 'US', 2020],
  ['Tesla Model S Plaid', 'A', 1020, 2160, 'sedan', 'US', 2022, 'ev'],
  ['SSC Tuatara', 'S', 1750, 1250, 'super', 'US', 2021],

  ['Mini Cooper S', 'C', 163, 1140, 'hatch', 'GB', 2003],
  ['Lotus Exige S', 'B', 345, 1176, 'coupe', 'GB', 2013],
  ['Aston Martin DBS Superleggera', 'A', 725, 1690, 'coupe', 'GB', 2019],
  ['McLaren 570S', 'A', 570, 1440, 'super', 'GB', 2016],
  ['McLaren Senna', 'S', 800, 1300, 'super', 'GB', 2019],
  ['McLaren P1', 'S', 916, 1490, 'super', 'GB', 2014],
  ['Aston Martin Valkyrie', 'S', 1160, 1100, 'super', 'GB', 2022],

  ['Daewoo Matiz', 'D', 52, 780, 'hatch', 'KR', 2005],
  ['Hyundai Accent', 'D', 97, 1060, 'sedan', 'KR', 2008],
  ['Chevrolet Aveo', 'D', 94, 1110, 'sedan', 'KR', 2008],
  ['Renault Logan', 'D', 87, 1050, 'sedan', 'RO', 2010],
  ['Škoda Octavia Tour', 'D', 102, 1200, 'wagon', 'CZ', 2006],
  ['Peugeot 205 GTI', 'C', 130, 875, 'hatch', 'FR', 1988],
  ['Renault Clio V6', 'C', 230, 1400, 'hatch', 'FR', 2003],
  ['Volvo 240 Turbo', 'C', 155, 1300, 'wagon', 'SE', 1984],
  ['Bugatti Veyron 16.4', 'S', 1001, 1890, 'super', 'FR', 2010],
  ['Bugatti Chiron Super Sport', 'S', 1600, 1995, 'super', 'FR', 2021],
  ['Bugatti Bolide', 'S', 1850, 1450, 'super', 'FR', 2024],
  ['Koenigsegg Agera RS', 'S', 1360, 1395, 'super', 'SE', 2017],
  ['Koenigsegg Jesko', 'S', 1600, 1420, 'super', 'SE', 2022],
  ['Rimac Nevera', 'S', 1914, 2300, 'super', 'HR', 2022, 'ev'],

  // Modern budget cars and electric cars of the old countries.
  ['ЗАЗ Forza', 'D', 109, 1050, 'hatch', 'UA', 2012],
  ['Volkswagen Polo', 'D', 90, 1100, 'hatch', 'DE', 2018],
  ['Toyota Yaris', 'D', 100, 1050, 'hatch', 'JP', 2018],
  ['Nissan Leaf', 'D', 150, 1580, 'hatch', 'JP', 2019, 'ev'],
  ['Tesla Model Y', 'C', 384, 1980, 'suv', 'US', 2022, 'ev'],
  ['Hyundai Ioniq 5 N', 'B', 650, 2235, 'suv', 'KR', 2024, 'ev'],
  ['Kia EV6 GT', 'B', 585, 2100, 'suv', 'KR', 2023, 'ev'],
  ['BMW i4 M50', 'B', 544, 2290, 'sedan', 'DE', 2022, 'ev'],
  ['Rivian R1T', 'B', 835, 3200, 'suv', 'US', 2022, 'ev'],
  ['Tesla Cybertruck Cyberbeast', 'A', 845, 3100, 'suv', 'US', 2024, 'ev'],
  ['Audi RS e-tron GT', 'A', 637, 2345, 'sedan', 'DE', 2022, 'ev'],
  ['GMC Hummer EV', 'A', 1000, 4100, 'suv', 'US', 2022, 'ev'],
  ['Lucid Air Sapphire', 'A', 1234, 2400, 'sedan', 'US', 2024, 'ev'],
  ['Lotus Evija', 'S', 2012, 1887, 'super', 'GB', 2023, 'ev'],

  // China: cheap petrol crossovers, the big electric brands and the hypercars of the last years.
  ['Chery Tiggo 7 Pro', 'D', 147, 1500, 'suv', 'CN', 2021],
  ['Haval Jolion', 'D', 143, 1430, 'suv', 'CN', 2021],
  ['Geely Coolray', 'D', 177, 1350, 'suv', 'CN', 2020],
  ['BYD Dolphin', 'D', 95, 1400, 'hatch', 'CN', 2023, 'ev'],
  ['Geely Monjaro', 'C', 238, 1800, 'suv', 'CN', 2022],
  ['BYD Atto 3', 'C', 204, 1750, 'suv', 'CN', 2022, 'ev'],
  ['BYD Seal', 'C', 313, 2055, 'sedan', 'CN', 2023, 'ev'],
  ['Li Auto L9', 'C', 449, 2520, 'suv', 'CN', 2022, 'ev'],
  ['BYD Han', 'B', 517, 2250, 'sedan', 'CN', 2021, 'ev'],
  ['Zeekr 001', 'B', 544, 2350, 'wagon', 'CN', 2021, 'ev'],
  ['Xiaomi SU7 Max', 'B', 673, 2205, 'sedan', 'CN', 2024, 'ev'],
  ['NIO ET7', 'B', 653, 2350, 'sedan', 'CN', 2022, 'ev'],
  ['Zeekr 001 FR', 'A', 1265, 2450, 'wagon', 'CN', 2023, 'ev'],
  ['Xiaomi SU7 Ultra', 'A', 1548, 2360, 'sedan', 'CN', 2025, 'ev'],
  ['Yangwang U8', 'A', 1197, 3460, 'suv', 'CN', 2023, 'ev'],
  ['Hongqi S9', 'S', 1400, 1900, 'super', 'CN', 2023],
  ['NIO EP9', 'S', 1360, 1735, 'super', 'CN', 2017, 'ev'],
  ['Yangwang U9', 'S', 1287, 2475, 'super', 'CN', 2024, 'ev'],
];

// Secret cars: one per main country, given for collecting every car of that country. Value ≈ 1.5–2× what finishing
// that collection costs on average with the country case (the rarest models decide it: Ukraine's four gold cars
// at 0.5% together, Italy's four mythics), so a quick collection can't hand out a fortune and a long hunt is worth it.
const SECRETS = [
  ['АВТОДРОП Прототип «Синьо-жовтий»', 2000, 1200, 'super', 'UA', 2026, 200000000],
  ['Toyota GR Super Sport', 1000, 1250, 'super', 'JP', 2024, 250000000],
  ['Mercedes-Benz CLK GTR', 612, 1000, 'super', 'DE', 1999, 400000000],
  ['Pagani Zonda R', 750, 1070, 'super', 'IT', 2009, 600000000],
  ['Hennessey Venom F5', 1817, 1360, 'super', 'US', 2022, 400000000],
  ['McLaren F1', 627, 1138, 'super', 'GB', 1995, 500000000],
  ['Yangwang U9 Xtreme', 3000, 2480, 'super', 'CN', 2025, 350000000, 'ev'],
];

// Stable id from the name, so cars can be added anywhere in the list without breaking saved games.
const TR = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ъ: '', ё: 'e' };
export function slug(s) {
  return s.toLowerCase().split('').map((ch) => (ch in TR ? TR[ch] : ch)).join('')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Price grows log-linearly with power-to-weight inside each class.
export const MODELS = {};
for (const cls of ['D', 'C', 'B', 'A', 'S']) {
  const list = RAW.filter((r) => r[1] === cls).sort((a, b) => a[2] / a[3] - b[2] / b[3]);
  const { lo, hi } = CLASSES[cls];
  list.forEach((r, k) => {
    const t = list.length > 1 ? k / (list.length - 1) : 0;
    const price = Math.round((lo * Math.pow(hi / lo, t)) / 1000) * 1000;
    const id = slug(r[0]);
    MODELS[id] = { id, name: r[0], cls, hp: r[2], kg: r[3], body: r[4], country: r[5], year: r[6], price, ev: r[7] === 'ev' };
  });
}
for (const [name, hp, kg, body, country, year, price, ev] of SECRETS) {
  const id = slug(name);
  MODELS[id] = { id, name, cls: 'X', hp, kg, body, country, year, price, secret: true, ev: ev === 'ev' };
}
// Season cars: the premium pass's level-30 reward of each season. A livery of a real car (its photo through a paint
// filter, `img` + `filter`) or its own photo, never in a case. Like a secret car it can't be sold, traded or burned in an upgrade,
// and it doesn't count in collections; it stays in the garage for good — the proof you were there that season.
export const SEASON_CARS = [
  { season: 1, name: 'BMW X5 M E70 «Monte Carlo Blue»', hp: 555, kg: 2380, body: 'suv', country: 'DE', year: 2010, price: 40000000 },
];
for (const c of SEASON_CARS) {
  const id = slug(c.name);
  MODELS[id] = { id, name: c.name, cls: 'X', hp: c.hp, kg: c.kg, body: c.body, country: c.country, year: c.year, price: c.price, secret: true, season: c.season, img: c.img, filter: c.filter };
  c.id = id;
}
// Home-case exclusives: the gold Soviet rarities drop only from the «Україна/СРСР» case (not from Міський or Еліта,
// not from the dealer), so finishing the Ukrainian collection is a real hunt.
for (const n of ['ГАЗ-24-95 «Волга» 4x4', 'ВАЗ-2108 Group B', 'ГАЗ-13 «Чайка»', 'ЗІЛ-41047']) MODELS[slug(n)].homeOnly = true;
export const ALL_MODELS = Object.values(MODELS);
export const SECRET_BY_COUNTRY = Object.fromEntries(ALL_MODELS.filter((m) => m.secret && !m.season).map((m) => [m.country, m.id]));
export const countryModels = (c) => ALL_MODELS.filter((m) => m.country === c && !m.secret);

// ---------- cases ----------
// A case has a fixed price and class odds. Every class pool is cut to a price CORRIDOR around the case price: the
// cheapest drop is worth at least `lo` of the price, the dearest at most `hi` times it. So a bad drop is a small loss,
// never a wipe-out, and a jackpot is a few times the price, not a hundred. Inside a class cheaper cars drop more often
// (weight ∝ 1/√price). On average a drop is worth ~1.7–2× the price; instantly selling every drop pays back ~60–70%,
// so open-and-sell never farms money (SELL_RATES), cases pay off by keeping cars.
export const CASE_CORRIDOR = { lo: 0.5, hi: 12 };
// Key fragments: every drop worth less than its case leaves a fragment of that case's key; FRAGMENTS_PER_KEY of them
// make a free key. With ~40–45% of drops below the price, a free case comes every ~18–20 paid opens.
export const FRAGMENTS_PER_KEY = 8;
// Instant sale by class: grey 60%, blue 50%, purple 45%, gold 40%, red 35%; no daily limit.
export const SELL_RATES = { D: 0.6, C: 0.5, B: 0.45, A: 0.4, S: 0.35, X: 0.35 };
export const sellPriceOf = (model) => Math.floor(MODELS[model].price * SELL_RATES[MODELS[model].cls]);

// Inside a class, cheaper cars drop more often (weight ∝ 1/√price), like in the original.
export function modelWeights(list) {
  return list.map((m) => 1 / Math.sqrt(m.price));
}
// Average of value(car) over what drops: the car's price by default, or what an instant sale would pay.
function caseEV(weights, pool, value = (m) => m.price) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let ev = 0;
  for (const [cls, w] of Object.entries(weights)) {
    const list = pool(cls);
    if (!list.length) continue;
    const mw = modelWeights(list);
    const sw = mw.reduce((a, b) => a + b, 0);
    ev += (w / total) * list.reduce((s, m, i) => s + (value(m) * mw[i]) / sw, 0);
  }
  return ev;
}
const niceRound = (n) => {
  const p = Math.pow(10, Math.max(3, Math.floor(Math.log10(n)) - 1));
  return Math.round(n / p) * p;
};

const byClass = (cls) => ALL_MODELS.filter((m) => m.cls === cls && !m.secret);
export const CASES = [
  // icon = id of a symbol in public/icons.svg
  { id: 'starter', name: 'Стартовий', icon: 'gift', group: 'gift', weights: { D: 100 }, starter: true },
  // Rarity cases: a ladder of prices, each about 2.5× the one before, so there is always a next step.
  { id: 'rust', name: 'Іржавий гараж', icon: 'tool', group: 'rarity', price: 60000, weights: { D: 93, C: 7 }, pity2: false },
  { id: 'city', name: 'Міський', icon: 'building-skyscraper', group: 'rarity', price: 300000, weights: { C: 90, B: 10 } },
  { id: 'tuning', name: 'Тюнінг-ательє', icon: 'tool', group: 'rarity', price: 900000, weights: { C: 42, B: 56, A: 2 } },
  { id: 'sport', name: 'Спорткар', icon: 'flag-3', group: 'rarity', price: 2000000, weights: { B: 86, A: 14 } },
  { id: 'premium', name: 'Преміум', icon: 'diamond', group: 'rarity', price: 5000000, weights: { B: 46, A: 51, S: 3 } },
  { id: 'elite', name: 'Еліта', icon: 'crown', group: 'rarity', price: 10000000, weights: { A: 89, S: 11 } },
];
// Country cases start cheap and have a wider ceiling (hi), so the country's dear cars — the ones its collection needs —
// can still drop from its own case, rarely. Ukraine's gold Soviet rarities drop only from here (homeOnly).
const COUNTRY_CASES = {
  UA: { price: 70000, weights: { D: 86, C: 13.7, A: 0.3 }, hi: 250 },
  JP: { price: 500000, weights: { C: 82, B: 17, A: 0.9, S: 0.1 }, hi: 240 },
  DE: { price: 550000, weights: { C: 80, B: 18.5, A: 1.4, S: 0.1 }, hi: 200 },
  CN: { price: 550000, weights: { D: 12, C: 69.5, B: 17.3, A: 0.9, S: 0.3 }, hi: 300 },
  US: { price: 2500000, weights: { B: 86, A: 13.5, S: 0.5 }, hi: 50 },
  GB: { price: 4000000, weights: { B: 72, A: 26.5, S: 1.5 }, hi: 35 },
  IT: { price: 4500000, weights: { B: 60, A: 38, S: 2 }, hi: 30 },
};
for (const c of MAIN_COUNTRIES) {
  const cc = COUNTRY_CASES[c];
  CASES.push({ id: 'c-' + c.toLowerCase(), name: COUNTRIES[c].name, icon: 'world', group: 'country', country: c, price: cc.price, weights: cc.weights, hi: cc.hi });
}
// Luck: a real run of bad luck builds up luck. The game keeps fading totals (over ~20 opens) of what the opened cases
// should have given on average (their expected value) and what the drops were actually worth; when drops come to
// well under half of that — a long stretch without anything good — each roll may be thrown twice and the better
// class kept (up to LUCK.max). A player who is truly broke (under LUCK.brokeCash of money and under LUCK.brokeBelow
// of money plus garage) gets LUCK.broke — a newcomer with the start balance is not broke.
// Luck only ever improves a roll, is never shown to players, and fades as soon as drops pay off again.
// Boost: on top of the odds shown, every case roll has this chance to throw the class twice and keep the better one
// (the shown odds are the minimum; players get a little more than promised).
export const BOOST = 0.25;
// Losing streak: after `streak` drops in a row worth less than the case price, the next roll is thrown up to
// `tries` times until a car worth the price comes; after `hardStreak` it is guaranteed (the cheapest such car).
export const LUCK = { decay: 0.95, threshold: 0.4, max: 0.5, broke: 0.6, brokeCash: 100000, brokeBelow: 500000, rescueHours: 12, streak: 4, tries: 4, hardStreak: 6 };
export const isBroke = (balance, garageValue) => balance < LUCK.brokeCash && balance + garageValue < LUCK.brokeBelow;
// expected / got: fading sums of the opened cases' expected values and of the drops' values.
export function luckChance(expected, got, broke = false) {
  let l = expected > 0 ? Math.max(0, Math.min(1, (LUCK.threshold - got / expected) / LUCK.threshold)) * LUCK.max : 0;
  if (broke) l = Math.max(l, LUCK.broke);
  return Math.round(l * 100) / 100;
}

// Pity: guaranteed at least the case's second class after PITY opens without it, and a purple (B) car after PITY2
// when B is the case's third class (Міський). Never a gold/red jackpot: that would be too pricey.
export const PITY = 30;
export const PITY2 = 40;
export const pityClasses = (cs) => {
  const cl = CLASS_ORDER.filter((c) => cs.weights[c]);
  return { first: cl[1] || null, second: cs.pity2 !== false && cl[2] === 'B' ? 'B' : null };
};
// Class shares with the guarantees folded in (they lift the real chance of the guaranteed class), so prices
// are based on what actually drops. A guarantee after n opens turns chance q of "this class or better" into
// q / (1 − (1 − q)^n); the extra goes to the guaranteed class and comes out of the classes below it.
export function effectiveWeights(cs) {
  const tw = Object.values(cs.weights).reduce((a, b) => a + b, 0);
  const sh = Object.fromEntries(Object.entries(cs.weights).map(([c, w]) => [c, w / tw]));
  const { first, second } = pityClasses(cs);
  for (const [g, n] of [[second, PITY2], [first, PITY]]) {
    if (!g) continue;
    const above = Object.keys(sh).filter((c) => rankOf(c) >= rankOf(g)), below = Object.keys(sh).filter((c) => rankOf(c) < rankOf(g));
    const q = above.reduce((s, c) => s + sh[c], 0), qb = 1 - q;
    const extra = q / (1 - Math.pow(1 - q, n)) - q;
    for (const c of below) sh[c] -= (extra * sh[c]) / qb;
    sh[g] += extra;
  }
  return sh;
}
for (const cs of CASES) {
  if (cs.starter) cs.price = 0;
  const lo = cs.price * CASE_CORRIDOR.lo, hi = cs.price * (cs.hi || CASE_CORRIDOR.hi);
  cs.pool = (cls) => byClass(cls)
    .filter((m) => (cs.country ? m.country === cs.country : !m.homeOnly))
    .filter((m) => cs.starter ? m.cls === 'D' && m.country === 'UA' : m.price >= lo && m.price <= hi);
  // A class the corridor leaves empty is dropped from the odds (nothing to give there).
  for (const cls of Object.keys(cs.weights)) if (!cs.pool(cls).length) delete cs.weights[cls];
  cs.ev = Math.round(caseEV(effectiveWeights(cs), cs.pool)); // average value of a drop (luck compares drops against it)
  cs.sellEv = Math.round(caseEV(effectiveWeights(cs), cs.pool, (m) => sellPriceOf(m.id)));
}
export const CASE_BY_ID = Object.fromEntries(CASES.map((c) => [c.id, c]));
// Case of the day: one rarity case (never the starter) is CASE_OF_DAY.off cheaper for the whole Kyiv day.
export const CASE_OF_DAY = { off: 0.2 };
const DAY_CASES = CASES.filter((c) => c.group === 'rarity');
export function caseOfDay(day) {
  let h = 0;
  for (const ch of String(day)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DAY_CASES[h % DAY_CASES.length].id;
}
export const casePrice = (cs, day) => (cs.id === caseOfDay(day) ? Math.round((cs.price * (1 - CASE_OF_DAY.off)) / 1000) * 1000 : cs.price);

// ---------- parts ----------
export const TIERS = [
  { id: 'stock', name: 'Stock', cls: 'D', price: 8000 },
  { id: 'street', name: 'Street', cls: 'C', price: 25000 },
  { id: 'sport', name: 'Sport', cls: 'B', price: 90000 },
  { id: 'pro', name: 'Pro', cls: 'A', price: 350000 },
  { id: 'race', name: 'Race', cls: 'S', price: 1400000 },
];
export const TIER_BY_ID = Object.fromEntries(TIERS.map((t, i) => [t.id, { ...t, index: i }]));
// Tier index of a part must be ≥ the car's class rank (X cars need Race parts).
export const minTierFor = (cls) => Math.min(rankOf(cls), TIERS.length - 1);
export const MERGE_CHANCE = [1, 0.8, 0.6, 0.4]; // stock→street, street→sport, sport→pro, pro→race
export const PART_SELL_RATE = 0.5;
export const PART_COOLDOWN_MIN = 20;

// effect values per tier [stock, street, sport, pro, race]
export const PARTS = {
  eng: { name: 'Двигун', icon: 'engine', stat: 'hp', fx: [0.02, 0.05, 0.09, 0.14, 0.2], hint: 'потужність' },
  turbo: { name: 'Турбіна', icon: 'tornado', stat: 'hp', fx: [0.02, 0.05, 0.09, 0.14, 0.2], hint: 'потужність' },
  exhaust: { name: 'Вихлоп', icon: 'wind', stat: 'hp', fx: [0.01, 0.02, 0.04, 0.06, 0.09], hint: 'потужність' },
  gearbox: { name: 'КПП', icon: 'manual-gearbox', stat: 'shift', fx: [0.1, 0.2, 0.35, 0.5, 0.65], hint: 'швидші перемикання' },
  suspension: { name: 'Підвіска', icon: 'arrow-autofit-height', stat: 'grip', fx: [0.02, 0.04, 0.07, 0.1, 0.14], hint: 'зчеплення на старті' },
  wheels: { name: 'Диски і шини', icon: 'circle-dot', stat: 'grip', fx: [0.03, 0.06, 0.1, 0.15, 0.2], hint: 'зчеплення на старті' },
  brakes: { name: 'Гальма', icon: 'disc', stat: 'et', fx: [0.003, 0.006, 0.01, 0.015, 0.02], hint: 'стабільність' },
  body: { name: 'Обвіс', icon: 'feather', stat: 'kg', fx: [0.01, 0.02, 0.03, 0.05, 0.07], hint: 'легша вага' },
  // Electric cars take these instead of engine, turbo, exhaust and gearbox (PETROL_ONLY / EV_ONLY).
  motor: { name: 'Електромотор', icon: 'bolt', stat: 'hp', fx: [0.03, 0.07, 0.12, 0.18, 0.25], hint: 'потужність', ev: true },
  battery: { name: 'Батарея', icon: 'battery', stat: 'hp', fx: [0.02, 0.05, 0.09, 0.14, 0.2], hint: 'потужність', ev: true },
  reducer: { name: 'Редуктор', icon: 'settings', stat: 'shift', fx: [0.1, 0.2, 0.35, 0.5, 0.65], hint: 'швидший розгін', ev: true },
};
export const PART_KEYS = Object.keys(PARTS);
const PETROL_ONLY = ['eng', 'turbo', 'exhaust', 'gearbox'];
const EV_ONLY = PART_KEYS.filter((k) => PARTS[k].ev);
// The part slots of a car: 8 for a petrol car, 7 for an electric one.
export const partKeysOf = (model) => PART_KEYS.filter((k) => (MODELS[model]?.ev ? !PETROL_ONLY.includes(k) : !EV_ONLY.includes(k)));
export const partFits = (model, type) => partKeysOf(model).includes(type);
export function partLabel(type, tier) {
  return `${PARTS[type].name} ${TIER_BY_ID[tier].name}`;
}
export function partEffect(type, tier) {
  const v = PARTS[type].fx[TIER_BY_ID[tier].index];
  const p = PARTS[type];
  if (p.stat === 'hp') return `+${Math.round(v * 100)}% к.с.`;
  if (p.stat === 'kg') return `−${Math.round(v * 100)}% ваги`;
  if (p.stat === 'grip') return `+${Math.round(v * 100)} зчеплення`;
  if (p.stat === 'shift') return `−${Math.round(v * 100)}% втрат на перемиканні`;
  return `−${(v * 100).toFixed(1)}% часу`;
}
export const PART_CASES = [
  { id: 'scrap', name: 'Розбірка', icon: 'tool', weights: { stock: 85, street: 14, sport: 1 } },
  { id: 'atelier', name: 'Тюнінг-ательє', icon: 'tools', weights: { stock: 30, street: 50, sport: 18, pro: 2 } },
  { id: 'racing', name: 'Гоночний цех', icon: 'bolt', weights: { street: 30, sport: 50, pro: 18, race: 2 } },
  { id: 'factory', name: 'Заводський тюнінг', icon: 'building-factory-2', weights: { sport: 40, pro: 50, race: 10 }, randomOnly: true },
];
for (const pc of PART_CASES) {
  const total = Object.values(pc.weights).reduce((a, b) => a + b, 0);
  const ev = Object.entries(pc.weights).reduce((s, [t, w]) => s + (w / total) * TIER_BY_ID[t].price, 0);
  pc.price = niceRound(ev * 0.6);
}
export const PART_CASE_BY_ID = Object.fromEntries(PART_CASES.map((c) => [c.id, c]));
export const PICK_PART_EXTRA = 0.15;

// ---------- plates (Ukrainian format "AA 1234 BC") ----------
// Official Ukrainian region codes: the 2004 series and the additional 2013 series for each region.
export const REGIONS = {
  AA: 'м. Київ', KA: 'м. Київ', AB: 'Вінницька', KB: 'Вінницька', AC: 'Волинська', KC: 'Волинська',
  AE: 'Дніпропетровська', KE: 'Дніпропетровська', AH: 'Донецька', KH: 'Донецька', AI: 'Київська', KI: 'Київська',
  AM: 'Житомирська', KM: 'Житомирська', AO: 'Закарпатська', KO: 'Закарпатська', AP: 'Запорізька', KP: 'Запорізька',
  AT: 'Івано-Франківська', KT: 'Івано-Франківська', AX: 'Харківська', KX: 'Харківська', BA: 'Кіровоградська', HA: 'Кіровоградська',
  BB: 'Луганська', HB: 'Луганська', BC: 'Львівська', HC: 'Львівська', BE: 'Миколаївська', HE: 'Миколаївська',
  BH: 'Одеська', HH: 'Одеська', BI: 'Полтавська', HI: 'Полтавська', BK: 'Рівненська', HK: 'Рівненська',
  BM: 'Сумська', HM: 'Сумська', BO: 'Тернопільська', HO: 'Тернопільська', BT: 'Херсонська', HT: 'Херсонська',
  BX: 'Хмельницька', HX: 'Хмельницька', CA: 'Черкаська', IA: 'Черкаська', CB: 'Чернігівська', IB: 'Чернігівська',
  CE: 'Чернівецька', IE: 'Чернівецька', AK: 'АР Крим', KK: 'АР Крим', CH: 'м. Севастополь', IH: 'м. Севастополь',
  II: 'Загальнодержавний', OO: 'Одеська',
};
export const PLATE_REGIONS = Object.keys(REGIONS);
export const regionOf = (text) => REGIONS[String(text).slice(0, 2)] || null;
export const PLATE_LETTERS = 'ABCEHIKMOPTX';
export const PLATE_VALUE = { D: [1500, 4000], C: [8000, 20000], B: [40000, 100000], A: [200000, 500000], S: [1000000, 2500000] };
// Plate of a chosen region: the class is a full random roll from ordinary to mythic (no tier to pick), and the
// region sets the price — the capital and the national ІІ series cost more, big oblast centres a bit more.
export const REGION_GEN = { weights: { D: 80, C: 15, B: 4.2, A: 0.75, S: 0.05 }, price: 15000 };
const REGION_PRICE = { AA: 60000, KA: 60000, II: 100000, OO: 30000, AE: 30000, KE: 30000, AX: 30000, KX: 30000, BC: 30000, HC: 30000, BH: 30000, HH: 30000, AI: 25000, KI: 25000 };
export const regionPrice = (code) => REGION_PRICE[code] || REGION_GEN.price;
// Regions for the picker: one row per region with all its codes.
export const REGION_LIST = Object.values(Object.entries(REGIONS).reduce((m, [code, name]) => ((m[name] ||= { name, codes: [] }).codes.push(code), m), {}))
  .sort((a, b) => (a.name === 'Загальнодержавний') - (b.name === 'Загальнодержавний') || a.name.replace('м. ', '').localeCompare(b.name.replace('м. ', ''), 'uk'));
export const PLATE_GEN = [
  { id: 'basic', name: 'Звичайний', price: 3000, weights: { D: 84, C: 16 } },
  { id: 'better', name: 'Покращений', price: 30000, weights: { C: 54, B: 44, A: 2 } },
  { id: 'pretty', name: 'Красивий', price: 250000, weights: { B: 30, A: 68.8, S: 1.2 } },
];
// "аа1234 вс" → "AA 1234 BC": Cyrillic look-alike letters become Latin, spacing is fixed. Partial input keeps its shape.
const CYR = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', І: 'I', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X' };
export function normalizePlate(s) {
  const t = String(s ?? '').toUpperCase().replace(/[АВСЕНІКМОРТХ]/g, (c) => CYR[c]).replace(/[^A-Z0-9]/g, '');
  const m = /^([A-Z]{2})(\d{4})([A-Z]{2})$/.exec(t);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : t;
}
// Classify a plate by its pattern.
export function plateInfo(text) {
  const m = /^([A-Z]{2}) (\d{4}) ([A-Z]{2})$/.exec(text || '');
  if (!m) return { cls: 'D', label: 'Номер' };
  const [, reg, d, suf] = m;
  const same = /^(\d)\1\1\1$/.test(d);
  if (/^000[1-9]$/.test(d)) return { cls: 'S', label: 'Номер з першої десятки' };
  if (same && reg === suf) return { cls: 'S', label: 'Повний дзеркальний комплект' };
  if (same) return { cls: 'A', label: 'Чотири однакові цифри' };
  if (/^[1-9]000$/.test(d)) return { cls: 'A', label: 'Кругле число' };
  if (/^00[1-9]\d$/.test(d)) return { cls: 'A', label: 'Номер з першої сотні' };
  if (d === '1234' || d === '4321' || d === '2345' || d === '6789' || d === '9876') return { cls: 'B', label: 'Послідовність цифр' };
  if (/(\d)\1\1/.test(d)) return { cls: 'B', label: 'Три однакові цифри' };
  if (d[0] === d[3] && d[1] === d[2]) return { cls: 'B', label: 'Дзеркальні цифри' };
  if (reg === suf) return { cls: 'C', label: 'Однакові літери' };
  if ((d[0] === d[1] && d[2] === d[3]) || (d[0] === d[2] && d[1] === d[3])) return { cls: 'C', label: 'Дві пари цифр' };
  if (/(\d)\1/.test(d)) return { cls: 'D', label: 'Дві однакові цифри поруч' };
  return { cls: 'D', label: 'Звичайний номер' };
}

// ---------- car stats ----------
// car = { model, parts: { eng: 'street', ... }, plateValue }
export function carValue(car) {
  const m = MODELS[car.model];
  if (!m) return 0; // a model removed from the game: worth nothing, never crashes a garage total
  let v = m.price;
  for (const k of partKeysOf(car.model)) if (car.parts?.[k]) v += TIER_BY_ID[car.parts[k]].price;
  return v + (car.plateValue || 0);
}
// Garage income per hour, as a share of the car's value, by class: cheap cars earn a bigger share so a new player
// isn't stuck waiting, expensive cars a smaller one so the late game doesn't print money.
// D 8% (a 60k car → 4.8k/h), C 4.5%, B 2%, A 0.8%, S 0.4%, secret cars 0.3%.
export const CLASS_INCOME = { D: 0.08, C: 0.045, B: 0.02, A: 0.008, S: 0.004, X: 0.003 };
export const incomeRateOf = (model) => CLASS_INCOME[MODELS[model].cls];
// Income per hour of a car: its class rate on the car itself; installed parts and the plate earn only the lowest
// rate (X), so dear parts on a cheap high-rate car can't print money.
// A full set: all parts installed and all of the same tier — +5% power (SET_BONUS).
export const SET_BONUS = { hp: 0.05 };
export function hasSet(car) {
  const tiers = partKeysOf(car.model).map((k) => car.parts?.[k]);
  return tiers.every((t) => t && t === tiers[0]);
}
export function carIncomeOf(car) {
  const m = MODELS[car.model];
  return m.price * CLASS_INCOME[m.cls] + (carValue(car) - m.price) * CLASS_INCOME.X;
}
// Three or more cars of one country earning in the garage: +10% to their income.
export const COUNTRY_BONUS = { cars: 3, income: 0.1 };
const fx = (car, key) => (car.parts?.[key] ? PARTS[key].fx[TIER_BY_ID[car.parts[key]].index] : 0);
export function carStats(car) {
  const m = MODELS[car.model];
  const power = m.ev ? fx(car, 'motor') + fx(car, 'battery') : fx(car, 'eng') + fx(car, 'turbo') + fx(car, 'exhaust');
  const hp = m.hp * (1 + power) * (hasSet(car) ? 1 + SET_BONUS.hp : 1);
  const kg = m.kg * (1 - fx(car, 'body'));
  const grip = 0.35 + fx(car, 'suspension') + fx(car, 'wheels');
  const shift = m.ev ? fx(car, 'reducer') : fx(car, 'gearbox');
  const base = raceBaseTime(hp, kg, grip) * (1 - fx(car, 'brakes'));
  const value = carValue(car);
  return {
    hp: Math.round(hp), kg: Math.round(kg), grip: Math.round(grip * 100) / 100, shift,
    base: Math.round(base * 1000) / 1000,
    et: Math.round((base + 0.2) * 100) / 100, // typical run: reaction 0.2 s, good shifts
    value, income: Math.round(carIncomeOf(car)), set: hasSet(car),
  };
}
// Hale quarter-mile formula plus a traction penalty for too much power on weak tyres.
export function raceBaseTime(hp, kg, grip) {
  const pw = hp / kg;
  return 5.825 * Math.cbrt((kg * 2.2046) / hp) + Math.max(0, pw - grip) * 2;
}

// ---------- race ----------
export const SHIFTS = 4; // gears 1→5
export const SHIFT_POINTS = [0.1, 0.24, 0.42, 0.65]; // fraction of the run where each shift is ideal
export const SHIFT_LOSS = { perfect: -0.04, good: 0, early: 0.12, late: 0.12, miss: 0.3 };
export const START = { perfectWindow: 0.15, perfectBonus: 0.987, jumpPenalty: 1.028 };
// reaction: seconds after green (negative = jump start). shifts: array of SHIFT_LOSS keys.
export function raceTime(stats, reaction, shifts) {
  let t = stats.base;
  if (reaction < 0) t *= START.jumpPenalty;
  else if (reaction <= START.perfectWindow) t *= START.perfectBonus;
  t += Math.max(0, reaction < 0 ? 0.25 : Math.min(reaction, 1.5));
  for (const q of shifts) t += (SHIFT_LOSS[q] ?? SHIFT_LOSS.miss) * (1 - stats.shift);
  return Math.round(t * 1000) / 1000;
}
export const FUEL_MAX = 15;
export const CAR_TANK = 5;
export const FUEL_REGEN_MIN = 20;
// entry / prize for class D; multiplied by CLASS_MULT
export const OPPONENTS = [
  { id: 'easy', name: 'Легкий', delta: [0.25, 0.6], entry: 600, prize: 2000 },
  { id: 'mid', name: 'Середній', delta: [-0.1, 0.15], entry: 1200, prize: 4000 },
  { id: 'hard', name: 'Складний', delta: [-0.55, -0.25], entry: 2500, prize: 8000 },
];
// Training: no entry fee, a small prize (a quarter of the easy rival's) — for learning the shifts without risk.
export const TRAINING = { id: 'train', name: 'Тренування', delta: [0.8, 1.3], share: 0.25 };
// Race entry/prize multiplier by class (kept for PvP-free tables and old saves).
export const CLASS_MULT = { D: 2.5, C: 8, B: 25, A: 120, S: 600, X: 1250 };
// Race prizes follow the price of the car model you race, whatever its class (parts help you win, they don't raise
// the stakes): the hard rival pays 18 000 × (price / 40 000)^0.65 — ~45% of a 40k car, ~2% of a 200M one — the
// medium one half that, the easy one a quarter; the entry is ~30% of the prize. A dearer car always races for more.
export function raceMoney(op, value) {
  const hard = OPPONENTS[OPPONENTS.length - 1].prize;
  const top = 18000 * Math.pow(Math.max(value, 1000) / 40000, 0.65);
  const prize = Math.max(1000, Math.round((top * op.prize) / hard / 1000) * 1000);
  return { prize, entry: Math.round((prize * op.entry) / op.prize / 1000) * 1000 };
}
// ---------- drift ----------
// A run is `corners` corners of cornerMs with straights of straightMs between them. Holding the gas swings the car
// wider (angle grows at `turn` °/s), letting go straightens it (`recover` °/s). In the green zone points come at
// `pps` a second × combo (×1.5 in the ideal middle band); past `spin` degrees the car spins out and the combo resets.
// A corner spent mostly in the zone without a spin is clean and raises the combo (up to comboMax).
// The car decides how hard that is: power makes the slide sharper, grip (suspension, tyres) widens the green zone.
export const DRIFT = { corners: 6, cornerMs: 3200, straightMs: 900, pps: 100, comboMax: 5, center: 35, spin: 70, clean: 0.6, idealBonus: 1.5 };
export const DRIFT_RIVALS = [
  { id: 'easy', name: 'Легкий', share: 0.42 },
  { id: 'mid', name: 'Середній', share: 0.6 },
  { id: 'hard', name: 'Складний', share: 0.75 },
];
export function driftModel(stats) {
  const pw = Math.min(1, stats.hp / stats.kg);
  const g = Math.max(0, Math.min(1, (stats.grip - 0.35) / 0.45));
  const half = 12 + 10 * g;
  return {
    turn: Math.round(35 + 60 * Math.pow(pw, 0.6)), recover: Math.round(45 + 70 * stats.grip),
    zone: [DRIFT.center - half, DRIFT.center + half], ideal: [DRIFT.center - half / 3, DRIFT.center + half / 3], spin: DRIFT.spin,
  };
}
// The best possible score: every corner clean and in the ideal band.
export const DRIFT_MAX = Math.round(DRIFT.pps * (DRIFT.cornerMs / 1000) * DRIFT.idealBonus
  * Array.from({ length: DRIFT.corners }, (_, i) => Math.min(DRIFT.comboMax, i + 1)).reduce((a, b) => a + b, 0));
export const DRIFT_MS = DRIFT.corners * DRIFT.cornerMs + (DRIFT.corners - 1) * DRIFT.straightMs;
export const RIVAL_NAMES = ['Ваня_Вихлоп', 'Kirill_M5', 'Lightning', 'Гоша_Форсаж', 'NightRider', 'Вовк', 'Дрифт_Кіт', 'Тарас_Турбо', 'BoostBoy', 'Сашко_GT', 'Оксана_V8', 'Mr.Stance', 'Лис_Нітро', 'Богдан_JDM', 'Карпатський_Дрифт', 'Kyiv_Racer', 'Львівський_Турбо', 'Одеса_Street', 'Шумахер_з_Борщагівки', 'Дизель'];
export const PVP_MIN_BET = 5000;
export const FEE = 0.05;

// ---------- dealer (bot seller on the market) ----------
// Every `hours` the dealer puts out a fresh batch of cars at fixed prices. Balance rules:
// - dealer prices are above a car's value (markup), so on average cases stay the cheaper way to get value;
//   the dealer sells certainty — the exact car you need for a collection — and every purchase is a money sink;
// - now and then a lot is a "deal" around the car's value, so checking the market is worth it;
// - each player may buy only `perPlayer` dealer cars per batch, so one rich player can't sweep everything;
// - the dealer never sells secret cars and never buys from players (the instant 40% sale stays the only exit).
export const DEALER = {
  hours: 3, lots: 10, perPlayer: 3,
  classWeights: { D: 34, C: 30, B: 22, A: 11, S: 3 },
  markup: [1.15, 1.45], dealChance: 0.15, deal: [0.95, 1.05],
};

// ---------- garage ----------
export const START_SLOTS = 6;
export const MAX_SLOTS = 40;
export const slotCost = (slots) => niceRound(50000 * Math.pow(1.6, slots - START_SLOTS));
export const CAP_LEVELS = [
  { hours: 4, cost: 0 },
  { hours: 6, cost: 1000000 },
  { hours: 8, cost: 10000000 },
  { hours: 12, cost: 100000000 },
];
export const SHOWCASE_START = 4;
export const SHOWCASE_MAX = 12;
export const showcaseCost = (n) => niceRound(300000 * Math.pow(2, n - SHOWCASE_START));

// ---------- levels, rewards, tasks ----------
// xp needed to go from lvl to lvl+1. An active player gets ~2,000–2,500 xp a day: level 5 after ~3 days, level 10 after ~3–4 weeks.
export const xpForLevel = (lvl) => Math.round(300 * Math.pow(lvl, 1.8));
export function levelReward(lvl) {
  const r = { money: 15000 * lvl * lvl };
  if (lvl % 5 === 0) r.caseId = lvl >= 15 ? 'sport' : 'city';
  if (lvl % 10 === 0) r.slots = 1;
  return r;
}
export const XP = { win: 25, race: 10, newCar: 20, daily: 30, task: 30, quest: 60, case: 5, plate: 5, merge: 10, install: 5, pvp: 30, trade: 30, market: 20, upgrade: 10, casino: 2 };
// Gambling-like actions share the daily cap so levels can't be farmed by spamming them.
export const CAPPED_XP = ['case', 'plate', 'merge', 'install', 'upgrade', 'casino'];
export const DAILY_XP_CAP = 300;

// 14 days; a missed day loses nothing — the next claim simply continues the series (it starts over every season).
export const DAILY_BONUS = [
  { money: 15000 },
  { parts: 3, tier: 'stock' },
  { money: 40000 },
  { parts: 2, tier: 'street' },
  { car: 'C', label: 'Машина' },
  { money: 120000 },
  { caseId: 'sport', label: 'Машина зі «Спорткара»', big: true },
  { money: 250000 },
  { parts: 2, tier: 'sport' },
  { car: 'B', label: 'Машина' },
  { money: 500000 },
  { parts: 1, tier: 'pro' },
  { money: 1000000 },
  { caseId: 'elite', label: 'Машина з «Еліти»', big: true },
];
export const REWARD_CASE_HOURS = 4;

export const NEWBIE_TASKS = [
  { key: 'open_starter', text: 'Відкрий стартовий кейс', money: 10000 },
  { key: 'collect', text: 'Забери дохід гаража', money: 20000 },
  { key: 'part_case', text: 'Відкрий кейс з деталями', money: 25000 },
  { key: 'install', text: 'Встанови деталь на машину', money: 30000 },
  { key: 'race', text: 'Проїдь заїзд', money: 30000 },
  { key: 'win', text: 'Виграй заїзд', money: 40000 },
  { key: 'plate', text: 'Згенеруй номер', money: 40000 },
  { key: 'open_case', text: 'Відкрий кейс з машиною', money: 50000 },
  { key: 'merge', text: 'Злий 3 деталі в одну', money: 75000 },
  { key: 'level3', text: 'Досягни 3 рівня', money: 150000 },
];
export const QUESTS = {
  open: { text: 'Відкрий {n} кейсів з машинами', range: [3, 8] },
  race: { text: 'Проїдь {n} заїздів', range: [3, 6] },
  win: { text: 'Виграй {n} заїздів', range: [2, 4] },
  perfect: { text: 'Зроби {n} ідеальних перемикань', range: [4, 10] },
  parts: { text: 'Відкрий {n} кейсів з деталями', range: [3, 8] },
  merge: { text: 'Злий деталі {n} раз', range: [1, 3] },
  collect: { text: 'Забери дохід гаража {n} раз', range: [2, 3] },
  pvp: { text: 'Зіграй {n} PvP-заїзд', range: [1, 2] },
  market: { text: 'Купи або продай авто на ринку', range: [1, 1] },
};

export const COLLECTION_MILESTONES = [
  { n: 5, money: 20000 },
  { n: 10, money: 60000, slots: 1 },
  { n: 20, money: 150000 },
  { n: 30, money: 400000, slots: 1 },
  { n: 45, money: 1500000 },
  { n: 60, money: 4000000, slots: 1 },
  { n: 80, money: 12000000 },
  { n: ALL_MODELS.filter((m) => !m.secret).length, money: 30000000, slots: 2, label: 'Уся колекція' },
];
// ---------- achievements ----------
// Each achievement has up to four tiers (bronze → diamond). Progress is counted from what the player has done —
// also before achievements existed — and each tier reached pays its reward once. `goals` are the thresholds of the
// measure named by `key` (see achievementProgress on the server); `labels` replace `text` where a tier needs words.
export const ACH_TIERS = [
  { name: 'Бронза', color: '#cd7f32' },
  { name: 'Срібло', color: '#c0c7d1' },
  { name: 'Золото', color: '#ffcc33' },
  { name: 'Діамант', color: '#7ee8fa' },
];
const REGULAR_MODELS = ALL_MODELS.filter((m) => !m.secret).length;
export const ACHIEVEMENTS = [
  { key: 'cases', title: 'Відкривач', icon: 'box', text: 'Відкрий {n} кейсів з машинами', goals: [10, 100, 1000, 5000], rewards: [6000, 62000, 625000, 5000000] },
  { key: 'wins', title: 'Гонщик', icon: 'flag-3', text: 'Виграй {n} заїздів', goals: [10, 100, 500, 2000], rewards: [6000, 62000, 625000, 5000000] },
  { key: 'pvp', title: 'Дуелянт', icon: 'bolt', text: 'Виграй {n} PvP-заїздів', goals: [1, 10, 50, 200], rewards: [12000, 125000, 1000000, 6250000] },
  { key: 'battles', title: 'Боєць', icon: 'flame', text: 'Виграй {n} кейс-батлів', goals: [1, 10, 50, 200], rewards: [12000, 125000, 1000000, 6250000] },
  { key: 'collection', title: 'Колекціонер', icon: 'books', text: 'Збери {n} різних машин', goals: [10, 40, 80, REGULAR_MODELS], rewards: [12000, 250000, 2500000, 12500000] },
  { key: 'rarest', title: 'Мисливець', icon: 'diamond', goals: [2, 3, 4, 5], rewards: [12000, 250000, 2500000, 12500000],
    labels: ['Отримай епічну (B) машину', 'Отримай легендарну (A) машину', 'Отримай міфічну (S) машину', 'Отримай секретну машину'] },
  { key: 'secrets', title: 'Секретні справи', icon: 'lock', text: 'Збери {n} секретних машин', goals: [1, 3, 6], rewards: [2500000, 12500000, 62500000] },
  { key: 'garage', title: 'Магнат', icon: 'building-warehouse', text: 'Гараж вартістю {n}', money: true, goals: [1e6, 100e6, 1e9, 10e9], rewards: [6000, 125000, 1250000, 10000000] },
  { key: 'level', title: 'Ветеран', icon: 'star', text: 'Досягни {n} рівня', goals: [5, 10, 20, 30], rewards: [12000, 125000, 1250000, 6250000] },
  { key: 'play', title: 'Свій у гаражі', icon: 'clock', text: 'Проведи в грі {n} год', hours: true, goals: [1, 10, 50, 200], rewards: [6000, 62000, 625000, 3750000] },
  { key: 'streak', title: 'Постійний', icon: 'calendar', text: 'Заходь {n} днів поспіль', goals: [3, 7, 14, 30], rewards: [6000, 38000, 250000, 1875000] },
  { key: 'merges', title: 'Механік', icon: 'tools', text: 'Злий деталі {n} раз', goals: [5, 50, 200, 1000], rewards: [6000, 62000, 500000, 3750000] },
  { key: 'tuned', title: 'Тюнер', icon: 'engine', goals: [1, 2, 3, 4], rewards: [12000, 125000, 1250000, 7500000],
    labels: ['Постав на машину всі 8 деталей', 'Машина з 8 деталями Sport або краще', 'Машина з 8 деталями Pro або краще', 'Машина з 8 деталями Race'] },
  { key: 'plates', title: 'Номерний знак', icon: 'license', goals: [1, 2, 3, 4], rewards: [6000, 62000, 625000, 5000000],
    labels: ['Май рідкісний (C) номер', 'Май епічний (B) номер', 'Май легендарний (A) номер', 'Май міфічний (S) номер'] },
  { key: 'friends', title: 'Душа компанії', icon: 'users', text: 'Приведи {n} друзів до 3 рівня', goals: [1, 3, 10, 30], rewards: [12000, 125000, 625000, 3750000] },
];
export const ACH_BY_KEY = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]));
export function achText(a, tier) {
  if (a.labels) return a.labels[tier];
  const g = a.goals[tier];
  return a.text.replace('{n}', a.money ? short(g) : String(g));
}

// Money for finishing a country collection (on top of its secret car): 15% of that secret car's value.
export const COUNTRY_REWARD = Object.fromEntries(MAIN_COUNTRIES.map((c) => [c, Math.round((MODELS[SECRET_BY_COUNTRY[c]].price * 0.15) / 10000) * 10000]));

// ---------- upgrade (CS-style: risk your cars for a chance at a pricier one) ----------
export const UPGRADE = { maxCars: 6, minMult: 1.2, maxMult: 50, edge: 0.92, perExtraCar: 0.01, maxChance: 0.75 };
// Value put in = model prices only; installed parts and plates go back to the warehouse either way.
// Each car beyond the first costs 1% of edge, so dumping a pile of cheap cars is slightly worse than one good car.
export const upgradeEdge = (cars = 1) => UPGRADE.edge - UPGRADE.perExtraCar * Math.max(0, cars - 1);
export const upgradeChance = (stake, targetPrice, cars = 1) => Math.min(UPGRADE.maxChance, (stake / targetPrice) * upgradeEdge(cars));

// ---------- casino (in-game hryvnias only, no cash-out) ----------
// maxBet caps a single bet; on roulette up to rouletteFields different fields per spin, adding up to rouletteTotal.
export const CASINO = { minBet: 1000, maxBet: 50000000, rouletteFields: 4, rouletteTotal: 200000000 };
export const CRASH = { k: 0.07, edge: 0.97, max: 1000 }; // multiplier = e^(k·seconds)
export const crashAt = (sec) => Math.floor(Math.exp(CRASH.k * Math.max(0, sec)) * 100) / 100;
export const MINES = { cells: 25, edge: 0.97, choices: [1, 3, 5, 10, 24] };
export function minesMult(mines, safe) {
  let m = MINES.edge;
  for (let i = 0; i < safe; i++) m *= (MINES.cells - i) / (MINES.cells - mines - i);
  return Math.floor(m * 100) / 100;
}
export const ROULETTE_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
export const ROULETTE_BETS = {
  red: { label: 'Червоне', pays: 1, win: (n) => ROULETTE_RED.includes(n) },
  black: { label: 'Чорне', pays: 1, win: (n) => n > 0 && !ROULETTE_RED.includes(n) },
  even: { label: 'Парне', pays: 1, win: (n) => n > 0 && n % 2 === 0 },
  odd: { label: 'Непарне', pays: 1, win: (n) => n % 2 === 1 },
  low: { label: '1–18', pays: 1, win: (n) => n >= 1 && n <= 18 },
  high: { label: '19–36', pays: 1, win: (n) => n >= 19 },
  d1: { label: '1–12', pays: 2, win: (n) => n >= 1 && n <= 12 },
  d2: { label: '13–24', pays: 2, win: (n) => n >= 13 && n <= 24 },
  d3: { label: '25–36', pays: 2, win: (n) => n >= 25 },
};
// Each reel shows one symbol; weights are per reel. pays = multiplier of the bet for three in a row.
export const SLOT_SYMBOLS = [
  { s: '🔧', w: 30, pays: 6 },
  { s: '🛞', w: 24, pays: 11 },
  { s: '⛽', w: 18, pays: 24 },
  { s: '🚗', w: 13, pays: 45 },
  { s: '🏎️', w: 8, pays: 120 },
  { s: '💎', w: 4, pays: 600 },
  { s: '7️⃣', w: 3, pays: 1100 },
];
// Two of a kind on the first two reels: small frequent wins keep the game lively.
export const SLOT_PAIR = { '🔧': 1, '🛞': 1, '⛽': 2, '🚗': 3, '🏎️': 5, '💎': 10, '7️⃣': 20 };
export function slotPayout(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) return SLOT_SYMBOLS.find((x) => x.s === a).pays;
  if (a === b && SLOT_PAIR[a]) return SLOT_PAIR[a];
  return 0;
}

export const WEEKLY_PRIZES = [3000000, 1500000, 1000000, 250000, 250000, 250000, 250000, 250000, 250000, 250000];
export const REF_REWARD = 1500000; // to the inviter when the friend reaches level 3
export const REF_FRIEND_BONUS = 150000;
export const START_BALANCE = 250000; // ~5 rusty-garage cases on top of the free starter one

// Packs grow with the player, so buying stays worth it with billions in the garage: the base amount × the larger of
// a level multiplier (×1.25 per level) and a garage multiplier ((garage / 20M)^0.85). Fixed when the invoice is made.
export const PACK_SCALE = { level: 1.25, garageBase: 20e6, garagePow: 0.85 };
export function packMult(level, garage) {
  return Math.max(1, Math.pow(PACK_SCALE.level, Math.max(0, level - 1)), Math.pow(Math.max(1, garage / PACK_SCALE.garageBase), PACK_SCALE.garagePow));
}
export const packAmount = (pack, level, garage) => niceRound(pack.amount * packMult(level, garage));
export const PACKS = [
  { id: 'p1', stars: 50, amount: 1500000, title: '1,5 млн ₴' },
  { id: 'p2', stars: 150, amount: 5000000, title: '5 млн ₴', tag: '+11%' },
  { id: 'p3', stars: 500, amount: 19000000, title: '19 млн ₴', tag: '+27%' },
  { id: 'p4', stars: 1500, amount: 65000000, title: '65 млн ₴', tag: '+44%' },
];

export function fmt(n) {
  return Math.round(n).toLocaleString('uk-UA').replace(/ /g, ' ') + ' ' + CURRENCY;
}
export function short(n) {
  const a = Math.abs(n);
  const t = (x, d) => x.toFixed(d).replace(/\.0+$/, '').replace('.', ',');
  if (a >= 1e9) return t(n / 1e9, a >= 1e10 ? 0 : 1) + ' млрд ₴';
  if (a >= 1e6) return t(n / 1e6, a >= 1e7 ? 0 : 1) + ' млн ₴';
  if (a >= 1e4) return Math.round(n / 1e3) + ' тис ₴';
  return fmt(n);
}

// ---------- seasons ----------
// A season lasts two weeks; season 1 starts 20.10.2026 at 00:00 Kyiv time. Nothing is wiped: cars, money and collections stay. Each
// season has its own pass (30 levels of season XP — the same XP the player earns anyway), its own rating by season
// XP with prizes in stars (spent in the shop), and a car you can only get that season.
export const SEASON = { start: Date.UTC(2026, 9, 19, 21), days: 14, levels: 30, premiumStars: 250 };
export const seasonOf = (t) => Math.max(1, Math.floor((t - SEASON.start) / (SEASON.days * 86400e3)) + 1);
export const seasonStartOf = (n) => SEASON.start + (n - 1) * SEASON.days * 86400e3;
export const seasonEndOf = (n) => seasonStartOf(n + 1);
// Season XP from one pass level to the next: an active player (~2,000 XP a day) reaches level 30 in about 12 days,
// a casual one gets halfway.
export const passXpFor = (lvl) => 300 + 40 * lvl;
export function passLevel(xp) {
  let lvl = 1, left = xp;
  while (lvl < SEASON.levels && left >= passXpFor(lvl)) left -= passXpFor(lvl++);
  return { level: lvl, xp: left, need: lvl < SEASON.levels ? passXpFor(lvl) : 0 };
}
const passMoney = (l) => niceRound(25000 * Math.pow(l, 1.5));
// Free and premium rewards for each level 2…30 (level 1 is where everyone starts).
export function passReward(season, lvl, premium) {
  if (!premium) {
    const r = { money: passMoney(lvl) };
    if (lvl === 5) r.caseId = 'city';
    if (lvl === 10) Object.assign(r, { caseId: 'sport', slots: 1 });
    if (lvl === 15) Object.assign(r, { parts: 2, tier: 'sport' });
    if (lvl === 20) Object.assign(r, { caseId: 'premium', slots: 1 });
    if (lvl === 25) Object.assign(r, { parts: 2, tier: 'pro' });
    if (lvl === 30) Object.assign(r, { caseId: 'elite', slots: 2 });
    return r;
  }
  if (lvl === 30) return { seasonCar: SEASON_CARS.find((c) => c.season === season)?.id || SEASON_CARS[SEASON_CARS.length - 1].id };
  if (lvl === 5) return { caseId: 'sport' };
  if (lvl === 10) return { caseId: 'elite' };
  if (lvl === 15) return { caseId: 'sport', count: 2 };
  if (lvl === 20) return { caseId: 'elite' };
  if (lvl === 25) return { caseId: 'elite', count: 2 };
  if (lvl % 2 === 0) return { money: passMoney(lvl) };
  return { parts: lvl < 10 ? 2 : 1, tier: lvl < 10 ? 'street' : lvl < 20 ? 'sport' : 'pro' };
}
// Season rating: by season XP. Prizes are stars on the player's account (spent in the shop) and a badge that stays.
export const SEASON_PRIZES = [500, 250, 250, 50, 50, 50, 50, 50, 50, 50];
export const SEASON_BADGE_TOP = 100;
export function seasonBadge(place) {
  if (place === 1) return { title: 'Чемпіон', tier: 3 };
  if (place <= 3) return { title: 'Призер', tier: 2 };
  if (place <= 10) return { title: 'Топ-10', tier: 1 };
  return { title: 'Топ-100', tier: 0 };
}

// ---------- VIP and the star shop ----------
export const VIP = { days: 14, stars: 300, fuelMult: 2, extraHours: 4, daily: 150000 };
// What stars buy besides money packs. Paid in Telegram Stars or from the stars on the account (season prizes).
// `slot` gets dearer with every slot bought for stars (×2), `starter` can be bought once.
export const SHOP_ITEMS = [
  { id: 'starter', name: 'Стартовий набір', stars: 99, once: true, money: 3000000, keys: { city: 2 }, vipDays: 3 },
  { id: 'vip', name: `VIP на ${VIP.days} днів`, stars: VIP.stars, vipDays: VIP.days },
  { id: 'pass', name: 'Преміум-пропуск сезону', stars: SEASON.premiumStars },
  { id: 'refuel', name: 'Заправити всі баки', stars: 25 },
  { id: 'cool', name: 'Охолодити деталі', stars: 10 },
  { id: 'slot', name: '+1 місце в гаражі', stars: 100 },
];
export const SHOP_BY_ID = Object.fromEntries(SHOP_ITEMS.map((i) => [i.id, i]));
export const shopPrice = (item, starSlots = 0) => (item.id === 'slot' ? item.stars * Math.pow(2, starSlots) : item.stars);

// "What's new" story shown once after an update (bump `id` to show it again).
export const WHATS_NEW = {
  id: 'economy-2',
  slides: [
    { icon: 'gift', title: 'Кейси стали чеснішими', text: 'Найдешевша машина в кейсі коштує не менше половини його ціни. Ціни машин переглянуто: прірви між класами більше немає.' },
    { icon: 'key', title: 'Фрагменти ключа', text: 'Машина дешевша за кейс залишає фрагмент. Вісім фрагментів — безкоштовне відкриття цього ж кейсу. Прогрес видно під кнопкою.' },
    { icon: 'shield-check', title: 'Гарантія на видноті', text: 'Під кейсом видно, через скільки відкриттів гарантовано випаде рідкісний клас.' },
    { icon: 'world', title: 'Китай і електро', text: '33 нові машини: BYD, Zeekr, Xiaomi, NIO, Yangwang, Tesla, Lucid, Rivian, Lotus Evija. Китай — нова країна з кейсом, колекцією та секретною машиною.' },
    { icon: 'bolt', title: 'Електродеталі', text: 'Електромобілі тюнінгуються мотором, батареєю й редуктором замість двигуна, турбіни, вихлопу та КПП.' },
    { icon: 'trophy', title: 'Сезон 1 стартував', text: 'Пропуск на 30 рівнів, рейтинг за досвідом із призами в зірках, щоденний бонус на 14 днів, VIP і магазин.' },
  ],
};
