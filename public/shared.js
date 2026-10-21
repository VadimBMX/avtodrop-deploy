// Shared game data and formulas — imported by both the server and the mini app.

export const CURRENCY = '₴';

export const CLASSES = {
  // Each class starts at least 1.33× above the top of the one below: a rare drop is worth several times its case, never
  // a hundred times, so the cheap end of a case is never worthless next to its price (see CASE_CORRIDOR). The upper
  // classes are wide, so dream cars feel dear (hypercars up to 300M); D/C stay cheap for beginners.
  D: { name: 'Звичайний', color: '#9aa4b2', lo: 40000, hi: 100000 },
  C: { name: 'Рідкісний', color: '#3b82f6', lo: 200000, hi: 600000 },
  B: { name: 'Епічний', color: '#a855f7', lo: 2000000, hi: 8000000 },
  A: { name: 'Легендарний', color: '#f59e0b', lo: 12000000, hi: 45000000 },
  S: { name: 'Міфічний', color: '#ef4444', lo: 60000000, hi: 300000000 },
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
// Prices come from the class range by power-to-weight and PRESTIGE (below); nothing is fixed, so adding a car reflows its class.
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
  ['Yangwang U9', 'A', 1287, 2475, 'super', 'CN', 2024, 'ev'],
];

// Secret cars: one per main country, given for collecting every car of that country. Value ≈ 1.5–2× what finishing
// that collection costs on average with the country case (the rarest models decide it: Ukraine's four gold cars
// at 0.5% together, Italy's four mythics), so a quick collection can't hand out a fortune and a long hunt is worth it.
const SECRETS = [
  ['АВТОДРОП Прототип «Синьо-жовтий»', 2000, 1200, 'super', 'UA', 2026, 500000000],
  ['Toyota GR Super Sport', 1000, 1250, 'super', 'JP', 2024, 625000000],
  ['Mercedes-Benz CLK GTR', 612, 1000, 'super', 'DE', 1999, 1000000000],
  ['Pagani Zonda R', 750, 1070, 'super', 'IT', 2009, 1500000000],
  ['Hennessey Venom F5', 1817, 1360, 'super', 'US', 2022, 1000000000],
  ['McLaren F1', 627, 1138, 'super', 'GB', 1995, 1250000000],
  ['Yangwang U9 Xtreme', 3000, 2480, 'super', 'CN', 2025, 875000000, 'ev'],
];

// Stable id from the name, so cars can be added anywhere in the list without breaking saved games.
const TR = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ъ: '', ё: 'e' };
export function slug(s) {
  return s.toLowerCase().split('').map((ch) => (ch in TR ? TR[ch] : ch)).join('')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Prestige: what a car means to a player beyond its power-to-weight — icon status, real-world value and rarity, era.
// −3 (mass-market, or fast only on paper: heavy EV sedans, new budget crossovers) … +3 (legend: R34, AE86, F40-type
// icons, cult Soviet classics). Not listed = 0. It only reorders cars inside their class: the class keeps the same
// ladder of prices (lo…hi), so case corridors, average drop value and income per class stay as they were.
export const PRESTIGE_STEP = 0.2;
const PRESTIGE = {
  // ---- D ----
  'Fiat 500': 3,                 // cult classic (1957–75), collectible, far above its 13 hp
  'ЗАЗ-965 «Горбатий»': 2,       // Soviet/Ukrainian cult classic, collectible
  'ГАЗ-24 «Волга»': 3,           // status car of the USSR, a classic for UA players
  'ВАЗ-2101 «Копійка»': 1,       // the first Zhiguli, cult
  'ВАЗ-2121 «Нива»': 1,          // holds value, legendary off-roader
  'ЗАЗ-968М «Запорожець»': 1,    // cult, meme value
  'Honda Civic EK': 1,           // JDM cult
  'Daewoo Matiz': -2,            // the cheapest-car meme
  'Fiat Uno': -2,
  'ЗАЗ-1102 «Таврія»': -2,
  'ЗАЗ Sens': -2,
  'ЗАЗ-1103 «Славута»': -1,
  'ВАЗ-2109': -1,
  'Opel Vectra A': -2,
  'Ford Sierra': -2,
  'Volkswagen Passat B3': -2,
  'Geely Coolray': -2,           // new budget crossover: top of D only by hp
  'Haval Jolion': -1,
  'Chery Tiggo 7 Pro': -1,
  'BYD Dolphin': 1,              // new EV, real price above old cars
  'Nissan Leaf': 0,
  'Toyota Yaris': 0,
  'Volkswagen Polo': 1,
  // ---- C ----
  'Lancia Delta HF Integrale': 3, // rally legend, dearest real-world C
  'Toyota Corolla AE86': 3,      // Initial D icon
  'Mitsubishi Lancer Evolution VI': 2, // Tommi Mäkinen
  'ВАЗ-2105 VFTS': 3,            // rally Lada, UA/Soviet legend
  'ГАЗ-24-24 «Волга» V8': 3,     // KGB chase car, rare
  'Mercedes-Benz 190E 2.3-16': 2,
  'Toyota Land Cruiser 80': 3,   // holds value, legend; last only by power-to-weight
  'Mazda MX-5 NA': 2,
  'Toyota Mark II JZX100': 1,
  'Nissan 200SX S13': 1,
  'Peugeot 205 GTI': 1,
  'BMW 325i E30': 1,
  'Renault Clio V6': 1,
  'Toyota Supra MK3': 0,
  'Volvo 240 Turbo': 0,
  'Audi 80 quattro': 1,
  'Tesla Model Y': -2,           // mass-market EV crossover
  'Li Auto L9': -1,
  'BYD Seal': 0,
  'BYD Atto 3': 0,
  'Geely Monjaro': 0,
  'Jeep Wrangler': -1,
  'BMW X5 E70': -1,
  'Ford Mustang GT (2005)': -1,
  'Volkswagen Golf GTI Mk7': -1,
  'Mini Cooper S': -1,
  // ---- B ----
  'Nissan Skyline GT-R R34': 3,  // Fast & Furious / Gran Turismo icon, $150–300k today
  'Toyota Supra A80': 3,
  'Honda NSX NA1': 3,
  'Mazda RX-7 FD': 3,
  'BMW M3 E30': 3,               // homologation classic, dearer than any new M
  'Ford Mustang (1967)': 2,
  'BMW M3 E46': 1,
  'Nissan Silvia S15': 1,
  'Lotus Exige S': 0,
  'Mitsubishi Lancer Evolution IX': 0,
  'Subaru Impreza WRX STI': 0,
  'Tesla Model 3 Performance': -2, // mass EV sedan
  'BYD Han': -1,
  'Zeekr 001': -1,
  'Kia EV6 GT': -2,
  'Hyundai Ioniq 5 N': -1,
  'NIO ET7': -2,
  'BMW i4 M50': -1,
  'Rivian R1T': -1,
  'Xiaomi SU7 Max': -2,
  'Toyota GR Yaris': -1,
  'Volkswagen Golf R': -1,
  'Alfa Romeo Giulia Quadrifoglio': -1, // $80k sedan, top of B only by hp
  'Chevrolet Camaro SS': -1,
  'Dodge Challenger SRT Hellcat': -2, // $70k muscle car: top of B only by hp
  // ---- A ----
  'Ford GT': 3,                  // 1350 built, $1M today
  'Ferrari 458 Italia': 3,
  'Lamborghini Huracán EVO': 2,
  'Aston Martin DBS Superleggera': 2,
  'Porsche 911 Turbo S': 2,
  'Dodge Viper ACR': 1,
  'McLaren 570S': 1,
  'Audi R8 V10 Plus': 1,
  'Mercedes-AMG GT R': 1,
  'Lamborghini Urus': 2,
  'Nissan GT-R R35': 1,
  'Mercedes-AMG G63': 1,
  'ВАЗ-2108 Group B': 0,         // home-only rarity, keeps mid-A
  'ГАЗ-13 «Чайка»': 1,           // Soviet state limousine
  'ЗІЛ-41047': 1,                // Politburo limousine
  'ГАЗ-24-95 «Волга» 4x4': 1,    // 5 built for Brezhnev
  'Chevrolet Corvette C8': -1,   // $70k car, mid of A only by hp
  'Tesla Model S Plaid': -2,     // $90k family sedan, A only for drag pace
  'Lucid Air Sapphire': -2,      // luxury EV sedan
  'Zeekr 001 FR': -2,            // $110k wagon
  'Xiaomi SU7 Ultra': -2,        // $75k sedan: was the dearest A, above Ford GT
  'Yangwang U8': -1,
  'Yangwang U9': -2,             // $230k BYD supercar: moved S → A (not a hypercar)
  'Tesla Cybertruck Cyberbeast': -1,
  'GMC Hummer EV': -1,
  'Audi RS e-tron GT': -1,
  'Shelby GT500': -1,
  'BMW M5 CS': 0,
  'Porsche Taycan Turbo S': -1,
  // ---- S ----
  'Bugatti Bolide': 3,
  'Ferrari LaFerrari': 3,
  'Bugatti Chiron Super Sport': 2,
  'Koenigsegg Agera RS': 2,
  'Pagani Huayra': 3,
  'McLaren P1': 3,
  'Porsche 918 Spyder': 3,
  'Bugatti Veyron 16.4': 3,
  'Aston Martin Valkyrie': 2,
  'Mercedes-AMG One': 3, // F1 engine, $3M+ today
  'Lexus LFA': 3,
  'Koenigsegg Jesko': 1,
  'McLaren Senna': 0,
  'Lamborghini Aventador SVJ': 2, // poster car, the competitor's top player car
  'Ferrari SF90 Stradale': -1,   // series plug-in hybrid, $500k
  'SSC Tuatara': -2,             // fastest on paper, little heritage
  'Lotus Evija': -2,
  'Rimac Nevera': -2,
  'Hongqi S9': -2,               // near-concept, unknown to players
  'NIO EP9': -1,
};
export const prestigeOf = (name) => PRESTIGE[name] || 0;

// Price grows log-linearly with the car's place in its class. The place comes from a score: power-to-weight
// (log, scaled 0…1 inside the class) plus PRESTIGE_STEP × prestige, so specs order cars of equal standing and
// prestige lifts an icon over a newer but faster nobody. Ties go to power-to-weight.
export const MODELS = {};
for (const cls of ['D', 'C', 'B', 'A', 'S']) {
  const pw = (r) => Math.log(r[2] / r[3]);
  const rows = RAW.filter((r) => r[1] === cls);
  const pwLo = Math.min(...rows.map(pw)), pwHi = Math.max(...rows.map(pw));
  const score = (r) => (pwHi > pwLo ? (pw(r) - pwLo) / (pwHi - pwLo) : 0) + PRESTIGE_STEP * prestigeOf(r[0]);
  const list = rows.sort((a, b) => score(a) - score(b) || pw(a) - pw(b));
  const { lo, hi } = CLASSES[cls];
  list.forEach((r, k) => {
    const t = list.length > 1 ? k / (list.length - 1) : 0;
    const price = Math.round((lo * Math.pow(hi / lo, t)) / 1000) * 1000;
    const id = slug(r[0]);
    MODELS[id] = { id, name: r[0], cls, hp: r[2], kg: r[3], body: r[4], country: r[5], year: r[6], price, ev: r[7] === 'ev', prestige: prestigeOf(r[0]) };
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
  { season: 1, name: 'BMW X5 M E70 «Monte Carlo Blue»', hp: 555, kg: 2380, body: 'suv', country: 'DE', year: 2010, price: 150000000 },
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
// (weight ∝ 1/√price). Owner decision (eco3): the case prices are the old ones while the B/A/S cars got dear, so the
// grey/blue cases pay back ~0.8 on instant sale and the dear ones ×1.5–2.8 (accepted; see CASE_PRICE_MULT, FRESH_SELL).
export const CASE_CORRIDOR = { lo: 0.5, hi: 12 };
// Key fragments: every drop worth less than its case leaves a fragment of that case's key; FRAGMENTS_PER_KEY of them
// make a free key. With ~40–80% of drops below the price, a free case comes every ~10–20 paid opens.
export const FRAGMENTS_PER_KEY = 8;
// Instant sale by class: grey 60%, blue 55%, purple 50%, gold 45%, red and secret 40%; no daily limit. With boost, luck,
// the losing-streak save and key fragments counted, open-and-sell is ~0.8 for the cheap cases and ×1.5–2.8 for the dear
// ones (owner decision, tools/sim-events.mjs; tools/sim-loop.mjs shows how fast a loop grows money).
export const SELL_RATES = { D: 0.6, C: 0.55, B: 0.5, A: 0.45, S: 0.4, X: 0.4 };
// Safety valve 1 (off: rate 1). A car obtained less than `hours` ago sells instantly at `rate` × its usual price, so
// «open and sell at once» can be cooled down without touching players who sell older cars. E.g. { rate: 0.6, hours: 24 }.
export const FRESH_SELL = { rate: 1, hours: 24 };
// ageMs: how long ago the car was obtained (unknown = an old car, the full rate).
export const sellPriceOf = (model, ageMs = Infinity) =>
  Math.floor(MODELS[model].price * SELL_RATES[MODELS[model].cls] * (ageMs < FRESH_SELL.hours * 3600e3 ? FRESH_SELL.rate : 1));

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
  // Old prices (owner decision, eco3) with the odds of eco2; `hi` keeps the dear cars (Bolide 300M, AMG One …) in the
  // pools now that the corridor is relative to a lower price.
  { id: 'rust', name: 'Іржавий гараж', icon: 'tool', group: 'rarity', price: 60000, weights: { D: 97.2, C: 2.8 }, pity2: false },
  { id: 'city', name: 'Міський', icon: 'building-skyscraper', group: 'rarity', price: 300000, weights: { C: 97, B: 3 } },
  { id: 'tuning', name: 'Тюнінг-ательє', icon: 'tool', group: 'rarity', price: 900000, weights: { C: 82.5, B: 17.2, A: 0.3 }, hi: 18 },
  { id: 'sport', name: 'Спорткар', icon: 'flag-3', group: 'rarity', price: 2000000, weights: { B: 90.5, A: 9.5 }, hi: 23 },
  { id: 'premium', name: 'Преміум', icon: 'diamond', group: 'rarity', price: 5000000, weights: { B: 42.8, A: 54, S: 3.2 }, hi: 61 },
  { id: 'elite', name: 'Еліта', icon: 'crown', group: 'rarity', price: 10000000, weights: { A: 88.3, S: 11.7 }, hi: 31 },
];
// Country cases start cheap and have a wider ceiling (hi), so the country's dear cars — the ones its collection needs —
// can still drop from its own case, rarely. Ukraine's gold Soviet rarities drop only from here (homeOnly).
const COUNTRY_CASES = {
  UA: { price: 55000, weights: { D: 98.2, C: 1.746, A: 0.054 }, hi: 460 },
  JP: { price: 450000, weights: { C: 96.76, B: 3.06, A: 0.162, S: 0.018 }, hi: 400 },
  DE: { price: 400000, weights: { C: 98.32, B: 1.554, A: 0.118, S: 0.008 }, hi: 560 },
  CN: { price: 480000, weights: { C: 97.776, B: 2.08, A: 0.108, S: 0.036 }, hi: 400 },
  US: { price: 2400000, weights: { B: 82.3, A: 17.06, S: 0.64 }, hi: 130 },
  GB: { price: 3100000, weights: { B: 73.46, A: 25.12, S: 1.42 }, hi: 90 },
  IT: { price: 3200000, weights: { B: 74, A: 24.7, S: 1.3 }, hi: 55 },
};
for (const c of MAIN_COUNTRIES) {
  const cc = COUNTRY_CASES[c];
  CASES.push({ id: 'c-' + c.toLowerCase(), name: COUNTRIES[c].name, icon: 'world', group: 'country', country: c, price: cc.price, weights: { ...cc.weights }, hi: cc.hi });
}
// Luck: a real run of bad luck builds up luck. The game keeps fading totals (over ~20 opens) of what the opened cases
// should have given on average (their expected value) and what the drops were actually worth; when drops come to
// well under half of that — a long stretch without anything good — each roll may be thrown twice and the better
// class kept (up to LUCK.max). A player who is truly broke (under LUCK.brokeCash of money and under LUCK.brokeBelow
// of money plus garage) gets LUCK.broke — a newcomer with the start balance is not broke.
// Luck only ever improves a roll, is never shown to players, and fades as soon as drops pay off again.
// Boost: on top of the odds shown, every case roll has this chance to throw the class twice and keep the better one
// (the shown odds are the minimum; players get a little more than promised).
export const BOOST = 0.15;
// Losing streak: after `streak` drops in a row worth less than the case price, the next roll is thrown up to
// `tries` times until a car worth the price comes; after `hardStreak` it is guaranteed (the cheapest such car).
// newbie: a player's first `newbieOpens` case opens get at least `newbie` luck, so the start is not a losing streak.
// Rescue: a free «Іржавий гараж» every rescueHours when truly broke, or every softHours when there is not enough money
// for any case and money plus garage stays under softBelow (a few cheap cars that would sell for little).
export const LUCK = { decay: 0.95, threshold: 0.3, max: 0.5, broke: 0.6, brokeCash: 100000, brokeBelow: 500000, rescueHours: 12, softHours: 24, softBelow: 1500000,
  newbie: 0.5, newbieOpens: 10, streak: 6, tries: 2, hardStreak: 10 };
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
// Safety valve 2 (off: {}). Price multiplier per case id, e.g. { elite: 1.6, 'c-gb': 2 }: the case costs more but drops
// exactly the same cars (the pool and odds are fixed at the old price), so open-and-sell falls by that factor.
export const CASE_PRICE_MULT = {};
for (const cs of CASES) {
  if (cs.starter) cs.price = 0;
  // Country cases have no lower bound: every car of the country in the case's classes drops from its own case
  // (the cheap Land Cruiser 80 or BYD Atto 3 too), so a country collection never depends on another case.
  const lo = cs.country ? 0 : cs.price * CASE_CORRIDOR.lo, hi = cs.price * (cs.hi || CASE_CORRIDOR.hi);
  cs.pool = (cls) => byClass(cls)
    .filter((m) => (cs.country ? m.country === cs.country : !m.homeOnly))
    .filter((m) => cs.starter ? m.cls === 'D' && m.country === 'UA' : m.price >= lo && m.price <= hi);
  // A class the corridor leaves empty is dropped from the odds (nothing to give there).
  for (const cls of Object.keys(cs.weights)) if (!cs.pool(cls).length) delete cs.weights[cls];
  // Safety valve 2 (off: empty). The price goes up after the pool is fixed, so the same cars drop for more money.
  if (!cs.starter && CASE_PRICE_MULT[cs.id] > 0) cs.price = niceRound(cs.price * CASE_PRICE_MULT[cs.id]);
  cs.ev = Math.round(caseEV(effectiveWeights(cs), cs.pool)); // average value of a drop (luck compares drops against it)
  cs.sellEv = Math.round(caseEV(effectiveWeights(cs), cs.pool, (m) => sellPriceOf(m.id)));
}
export const CASE_BY_ID = Object.fromEntries(CASES.map((c) => [c.id, c]));
// Case of the day: one rarity case (never the starter) is CASE_OF_DAY.off cheaper for the whole Kyiv day; its hidden
// boost is CASE_OF_DAY.boost instead of BOOST (that is what keeps the discount from farming money).
export const CASE_OF_DAY = { off: 0.1, boost: 0 };
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
// Pause between two openings of part cases (server-checked), so the whole stock can't be emptied in seconds.
export const PART_COOLDOWN_MS = 10000;

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
// D 5% (a 60k car → 3k/h), C 3%, B 1.3%, A 0.5%, S 0.25%, secret cars (and parts/plates on top of a car) 0.06%: a kept
// drop pays its case back in ~2–3 days of play (owner chose a softer cut than tools/sim.mjs suggests). Secret cars are
// 2.5× dearer since the wide class ranges, so their rate is 2.5× lower and they earn as before.
export const CLASS_INCOME = { D: 0.05, C: 0.03, B: 0.013, A: 0.005, S: 0.0025, X: 0.0006 };
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
// minReaction: nobody reacts to a light faster than ~0.1 s — a tap sooner after green was a lucky guess, so it
// gets no perfect-start bonus (and no false-start penalty either).
export const START = { perfectWindow: 0.15, perfectBonus: 0.987, jumpPenalty: 1.028, minReaction: 0.1 };
export const perfectStartOf = (reaction) => reaction >= START.minReaction && reaction <= START.perfectWindow;
// reaction: seconds after green (negative = jump start). shifts: array of SHIFT_LOSS keys.
export function raceTime(stats, reaction, shifts) {
  let t = stats.base;
  if (reaction < 0) t *= START.jumpPenalty;
  else if (perfectStartOf(reaction)) t *= START.perfectBonus;
  t += Math.max(0, reaction < 0 ? 0.25 : Math.min(reaction, 1.5));
  for (const q of shifts) t += (SHIFT_LOSS[q] ?? SHIFT_LOSS.miss) * (1 - stats.shift);
  return Math.round(t * 1000) / 1000;
}
// ---------- drag race timeline (shared so the server can replay a run from its tap times) ----------
// The run plays RACE_SPEED times faster than race time. The server picks when the light turns green (RACE_GREEN ms
// after the lights start); the client reports when it launched (ms after the lights started) and when each shift
// happened (ms after launch), and the server recomputes the reaction and every shift quality from those.
export const RACE_SPEED = 2.3;
export const RACE_GREEN = [2200, 3400];
export const RACE_LATE_START = 1500; // ms after green the car launches by itself
export const SHIFT_AUTO_RPM = 1.02; // the needle hitting the limiter shifts by itself ('late')
// ms of slack the server allows: a claimed quality must be reachable within [tap − back, tap + fwd]; a shift that
// happened after the limiter point counts as a tap only within `hitch` (a frame stall), later it is 'late'.
export const DRAG_TOL = { back: 20, fwd: 5, hitch: 250, end: 5, wall: 300 };
export const reactionOf = (launchMs, greenMs) => (launchMs < greenMs ? -1 : Math.min(3, (launchMs - greenMs) / 1000));
export const msToTau = (ms) => (ms / 1000) * RACE_SPEED;
// Progress of the run: u = (tau − react) / drive, where drive follows the time projected from the shifts so far.
export function dragDrive(stats, reaction, shifts) {
  const react = reaction < 0 ? 0.25 : reaction;
  const T = raceTime(stats, reaction, [...shifts, ...Array(Math.max(0, SHIFTS - shifts.length)).fill('good')]);
  return { react, drive: Math.max(0.5, T - react) };
}
export function dragU(stats, reaction, shifts, tau) {
  const { react, drive } = dragDrive(stats, reaction, shifts);
  return Math.max(0, Math.min(1, (tau - react) / drive));
}
// Needle position for shift i (0-based), counted from the progress segStart where the last shift happened.
export function shiftRpm(i, segStart, u) {
  const ideal = SHIFT_POINTS[i];
  if (ideal == null) return 0.5 + 0.4 * Math.min(1, (u - segStart) / Math.max(0.05, 1 - segStart));
  return 0.3 + 0.58 * ((u - segStart) / Math.max(0.03, ideal - segStart));
}
export const tapQuality = (rpm) => (rpm < 0.7 ? 'early' : rpm < 0.82 ? 'good' : rpm <= 0.94 ? 'perfect' : 'good');
// Replays a run: shiftAt = ms after launch of each shift (taps and limiter shifts), claims = the qualities the client
// showed. A claim is kept when it is no better than the server's, or reachable within DRAG_TOL; otherwise the
// server's quality stands. Returns { shifts, endMs (ms from launch to the finish line), corrected } or { error }.
export function dragReplay(stats, reaction, shiftAt, claims = []) {
  if (!Array.isArray(shiftAt) || shiftAt.length > SHIFTS) return { error: 'shifts' };
  const shifts = [];
  let seg = 0, prev = 0, corrected = 0, endTau = null;
  for (let i = 0; i < SHIFTS; i++) {
    const { react, drive } = dragDrive(stats, reaction, shifts);
    const tauEnd = react + drive;
    const uAt = (tau) => Math.max(0, Math.min(1, (tau - react) / drive));
    const uLate = seg + ((SHIFT_AUTO_RPM - 0.3) / 0.58) * Math.max(0.03, SHIFT_POINTS[i] - seg);
    if (i >= shiftAt.length) {
      // No more shifts reported: either the limiter shifted (it would have, before the finish) or the run ended.
      if (uLate < 1) {
        shifts.push('late');
        seg = uLate;
        continue;
      }
      endTau = tauEnd;
      break;
    }
    const at = shiftAt[i];
    if (typeof at !== 'number' || !Number.isFinite(at) || at < prev) return { error: 'timing' };
    prev = at;
    let tau = msToTau(at);
    if (tau >= tauEnd + msToTau(DRAG_TOL.end)) return { error: 'after-finish' };
    const tauLate = react + uLate * drive;
    let q;
    if (uLate < 1 && tau > tauLate + msToTau(DRAG_TOL.hitch)) {
      q = 'late'; // the limiter would have shifted long before this
      tau = tauLate;
      corrected++;
    } else {
      const qAt = (x) => tapQuality(shiftRpm(i, seg, uAt(x)));
      q = qAt(tau);
      const claim = claims?.[i];
      if (typeof claim === 'string' && Object.hasOwn(SHIFT_LOSS, claim) && claim !== q) {
        const a = tau - msToTau(DRAG_TOL.back), b = tau + msToTau(DRAG_TOL.fwd);
        let near = false;
        for (let k = 0; k <= 10 && !near; k++) near = qAt(a + ((b - a) * k) / 10) === claim;
        if (SHIFT_LOSS[claim] >= SHIFT_LOSS[q] || near) q = claim;
        else corrected++;
      }
    }
    seg = uAt(tau);
    shifts.push(q);
  }
  if (endTau == null) {
    const { react, drive } = dragDrive(stats, reaction, shifts);
    endTau = react + drive;
  }
  while (shifts.length < SHIFTS) shifts.push('late');
  return { shifts, endMs: (endTau / RACE_SPEED) * 1000, corrected };
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
// the stakes): the hard rival pays 18 000 × (price / 40 000)^0.55 — ~45% of a 40k car, ~1% of a 200M one — the
// medium one half that, the easy one a quarter; the entry is ~30% of the prize. A dearer car always races for more.
export function raceMoney(op, value) {
  const hard = OPPONENTS[OPPONENTS.length - 1].prize;
  const top = 18000 * Math.pow(Math.max(value, 1000) / 40000, 0.55);
  const prize = Math.max(1000, Math.round((top * op.prize) / hard / 1000) * 1000);
  return { prize, entry: Math.round((prize * op.entry) / op.prize / 1000) * 1000 };
}
// ---------- drift («Дрифт 2.0») ----------
// A run is a track of DRIFT.corners corners (fast sweepers, medium corners, hairpins; left and right) with straights
// between them, laid out from a track seed. One control: the gas. On a straight holding it accelerates, letting go
// brakes. In a corner holding it swings the car wider (angle grows at `turn` °/s) and keeps the speed up, letting go
// straightens it (`recover` °/s) and scrubs speed. Every corner has its own ideal angle (`center`): the faster the
// car goes compared with the corner's `vref`, the more it is pushed out to the edge and the more angle it needs to
// hold the line — too little angle and it runs wide («Знесло!»), past `spin` degrees it spins out («Розворот!»).
// Points come per metre while the angle is in the corner's green zone: ×1.5 in the ideal middle band, ×0.7 off the
// racing line, × speed (0.6…1.3 of vref). A corner spent mostly in the zone without a spin or running wide is clean;
// consecutive clean corners multiply that corner's points by the combo (×1, ×1,5, ×2 … up to ×3 from the 5th clean
// corner in a row); a dirty one resets it and a spin halves the corner. The car decides how hard that is: power
// gives speed and a sharper slide, grip (suspension, tyres) widens the green zone, straightens faster and pushes the
// car out less.
export const DRIFT = { corners: 7, comboMax: 5, comboStep: 0.5, center: 36, spin: 70, clean: 0.6, idealBonus: 1.5, offLine: 0.7, ppm: 12, lead: 34, tail: 34, vStart: 16 };
export const DRIFT_CORNERS = {
  fast: { name: 'Швидкий', len: 62, center: 28, vref: 32, deg: 70 },
  mid: { name: 'Середній', len: 50, center: 36, vref: 26, deg: 100 },
  hair: { name: 'Шпилька', len: 40, center: 44, vref: 20, deg: 160 },
};
// The combo multiplier after `streak` clean corners in a row.
export const driftMult = (streak) => (streak < 1 ? 1 : 1 + DRIFT.comboStep * (Math.min(DRIFT.comboMax, streak) - 1));
// Rival targets are a share of the track's par: what an average driver (driftBot at skill 0.5) scores on that day's
// track in the car's stock form, so parts still help. Tuned with tools/sim-drift.mjs so an average player beats the
// easy rival ~90% of the time, the medium ~55%, the hard ~20%.
export const DRIFT_RIVALS = [
  { id: 'easy', name: 'Легкий', share: 0.73 },
  { id: 'mid', name: 'Середній', share: 0.9 },
  { id: 'hard', name: 'Складний', share: 1.12 },
];
export function driftModel(stats) {
  const pw = Math.min(1, stats.hp / stats.kg);
  const g = Math.max(0, Math.min(1, (stats.grip - 0.35) / 0.45));
  const half = Math.round((12 + 6 * g) * 10) / 10;
  return {
    turn: Math.round(35 + 60 * Math.pow(pw, 0.6)), recover: Math.round(45 + 70 * stats.grip), half,
    zone: [DRIFT.center - half, DRIFT.center + half], ideal: [DRIFT.center - half / 3, DRIFT.center + half / 3], spin: DRIFT.spin,
    vmax: Math.round((24 + 20 * Math.sqrt(pw)) * 10) / 10, acc: Math.round((5 + 8 * Math.pow(pw, 0.6)) * 10) / 10,
    lat: Math.round((1.15 - 0.25 * g) * 100) / 100,
  };
}
// A ceiling for any track: every corner the longest, in the ideal band, on the line, at top speed factor, full combo.
const DRIFT_CMAX = Math.max(...Object.values(DRIFT_CORNERS).map((c) => c.len));
export const DRIFT_MAX = Math.round(DRIFT.ppm * DRIFT_CMAX * DRIFT.idealBonus * 1.3
  * Array.from({ length: DRIFT.corners }, (_, i) => driftMult(i + 1)).reduce((a, b) => a + b, 0));
// The drift physics runs in fixed DRIFT_STEP-ms steps with noise from the server's seed, so the server replays the
// player's gas log step for step and gets exactly the score the player saw. The step uses only + − × / and
// comparisons (no Math.sin/pow), which IEEE-754 makes bit-identical in every JS engine (V8 on the server and Android,
// JavaScriptCore on iOS).
export const DRIFT_STEP = 5;
export const DRIFT_COUNT_MS = 2100; // the 3 · 2 · 1 countdown before the run
export const DRIFT_NOISE = 55; // °/s of random wobble per step
export const DRIFT_MS = 60000; // hard time limit of a run (an honest one takes ~25–35 s)
export const DRIFT_VMIN = 10, DRIFT_BRAKE = 10; // m/s the car never drops below; m/s² of braking on a straight
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The day's track from its seed: a lead-in straight, DRIFT.corners corners (2 fast sweepers, 3 medium, 2 hairpins in
// a shuffled order) with 22–46 m straights between them, and a run-out to the finish. The direction of each corner
// mostly turns the road back towards its start heading, so the drawn track never wanders off in a spiral.
export function driftTrack(seed) {
  const rand = mulberry32((seed ^ 0x5bd1e995) >>> 0), N = DRIFT.corners;
  const ks = ['fast', 'fast', 'mid', 'mid', 'mid', 'hair', 'hair'];
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ks[i], ks[j]] = [ks[j], ks[i]];
  }
  const segs = [{ kind: 'straight', len: DRIFT.lead }];
  let heading = 0;
  ks.forEach((k, i) => {
    const c = DRIFT_CORNERS[k];
    let dir = heading > 0 ? -1 : heading < 0 ? 1 : rand() < 0.5 ? -1 : 1;
    if (rand() < 0.3 && Math.abs(heading) < 120) dir = -dir;
    heading += dir * c.deg;
    segs.push({ kind: k, corner: i, dir, len: c.len, center: c.center, vref: c.vref, deg: c.deg });
    if (i < N - 1) segs.push({ kind: 'straight', len: 22 + Math.floor(rand() * 25) });
  });
  segs.push({ kind: 'straight', len: DRIFT.tail });
  let at = 0;
  for (const g of segs) (g.from = at, at += g.len, g.to = at);
  return { seed, segs, length: at };
}
export function driftSim(model, track, seed) {
  const dt = DRIFT_STEP / 1000, segs = track.segs, rand = mulberry32(seed >>> 0), half = model.half, h3 = half / 3;
  const s = { t: 0, hold: false, ang: 0, v: DRIFT.vStart, y: 0, pos: 0, seg: 0, wob: 0, score: 0, streak: 0, combo: 1, maxCombo: 0,
    clean: 0, spins: 0, wides: 0, spinUntil: -1, inZone: false, done: false, cur: null, corners: [], log: [], events: [] };
  const beginCorner = (g) => {
    s.cur = { i: g.corner, kind: g.kind, dir: g.dir, base: 0, zone: 0, ideal: 0, line: 0, vs: 0, dist: 0, spun: false, wide: false };
    s.events.push({ k: 'corner', i: g.corner });
  };
  const endCorner = (g) => {
    const c = s.cur, len = g.len;
    const clean = !c.spun && !c.wide && c.zone >= len * DRIFT.clean;
    if (clean) (s.streak++, s.clean++);
    else s.streak = 0;
    const mult = clean ? driftMult(s.streak) : 1;
    const base = Math.floor(c.spun ? c.base / 2 : c.base);
    const pts = Math.floor(base * mult);
    const grade = c.spun ? 'spin' : c.wide ? 'wide' : !clean ? 'weak' : c.ideal >= len * 0.35 && c.line >= c.zone * 0.8 ? 'perfect' : 'clean';
    s.score += pts;
    s.combo = driftMult(s.streak);
    if (mult > s.maxCombo) s.maxCombo = mult;
    const rec = { i: c.i, kind: c.kind, dir: c.dir, base, mult, pts, grade, zone: Math.round((c.zone / len) * 100), ideal: Math.round((c.ideal / len) * 100),
      line: c.zone ? Math.round((c.line / c.zone) * 100) : 0, kmh: c.dist ? Math.round((c.vs / c.dist) * 3.6) : 0 };
    s.corners.push(rec);
    s.events.push({ k: 'end', ...rec });
    s.cur = null;
  };
  // Gas pressed / released: applies from the next step and is logged by step index.
  s.input = (hold) => {
    if (s.done || hold === s.hold) return;
    s.hold = hold;
    s.log.push(s.t / DRIFT_STEP);
  };
  s.step = () => {
    if (s.done) return;
    s.t += DRIFT_STEP;
    const g = segs[s.seg];
    // Wobble: a slowly wandering push plus a fast jitter, both from the seed; the car never sits still.
    s.wob = (s.wob + (rand() - 0.5) * 0.5) * 0.985;
    if (s.wob > 1.5) s.wob = 1.5;
    else if (s.wob < -1.5) s.wob = -1.5;
    const jit = rand() - 0.5;
    let ds;
    if (g.kind !== 'straight') {
      if (!s.cur) beginCorner(g);
      const c = s.cur, spinning = s.t <= s.spinUntil;
      if (!spinning) {
        s.ang += ((s.hold ? model.turn : -model.recover) + s.wob * 22 + jit * DRIFT_NOISE) * dt;
        if (s.ang < 0) s.ang = 0;
        const scrub = s.ang * 0.07;
        s.v += (s.hold ? model.acc * 0.8 * (1 - s.v / model.vmax) - scrub : -2.5 - scrub) * dt;
        if (s.ang >= model.spin) {
          s.spins++;
          s.streak = 0;
          s.combo = 1;
          c.spun = true;
          s.spinUntil = s.t + 700;
          s.ang = 0;
          s.v *= 0.6;
          s.events.push({ k: 'spin' });
        }
      } else s.v -= 6 * dt;
      if (s.v < DRIFT_VMIN) s.v = DRIFT_VMIN;
      // The line: speed pushes the car out (more on weak grip), the drift angle pulls it in.
      const r = s.v / g.vref;
      s.y += (r * r * model.lat - s.ang / g.center) * 0.9 * dt;
      if (s.y < -1) s.y = -1;
      if (s.y >= 1) {
        if (!c.wide) {
          c.wide = true;
          s.wides++;
          s.streak = 0;
          s.combo = 1;
          s.v *= 0.8;
          s.y = 0.85;
          s.events.push({ k: 'wide' });
        } else s.y = 1;
      }
      ds = s.v * dt;
      let inZone = false;
      if (!spinning) {
        const d = s.ang - g.center;
        inZone = d >= -half && d <= half;
        if (inZone) {
          const ideal = d >= -h3 && d <= h3, onLine = s.y >= -0.75 && s.y <= 0.45;
          const q = r < 0.6 ? 0.6 : r > 1.3 ? 1.3 : r;
          c.base += DRIFT.ppm * ds * (ideal ? DRIFT.idealBonus : 1) * (onLine ? 1 : DRIFT.offLine) * q;
          c.zone += ds;
          if (ideal) c.ideal += ds;
          if (onLine) c.line += ds;
          if (!s.inZone) s.events.push({ k: 'zone' });
        }
      }
      s.inZone = inZone;
      c.vs += s.v * ds;
      c.dist += ds;
    } else {
      s.v += (s.hold ? model.acc * (1 - s.v / model.vmax) : -DRIFT_BRAKE) * dt;
      if (s.v < DRIFT_VMIN) s.v = DRIFT_VMIN;
      s.ang -= model.recover * 1.5 * dt;
      if (s.ang < 0) s.ang = 0;
      s.y -= s.y * 1.5 * dt;
      s.inZone = false;
      ds = s.v * dt;
    }
    s.pos += ds;
    if (s.pos >= g.to) {
      if (s.cur) endCorner(g);
      s.seg++;
      if (s.seg >= segs.length) s.done = true;
      else if (segs[s.seg].kind === 'straight') s.events.push({ k: 'straight', next: segs[s.seg + 1]?.corner ?? -1 });
    }
    if (!s.done && s.t >= DRIFT_MS) {
      if (s.cur) endCorner(segs[s.seg]);
      s.done = true;
    }
  };
  s.advance = (ms) => {
    while (!s.done && s.t + DRIFT_STEP <= ms) s.step();
  };
  return s;
}
// Replays a gas log (step indexes where the gas flipped); { error } when the log is malformed.
export function driftReplay(model, track, seed, log) {
  const last = DRIFT_MS / DRIFT_STEP;
  if (!Array.isArray(log) || log.length > 20000) return { error: 'log' };
  for (let k = 0; k < log.length; k++) if (!Number.isSafeInteger(log[k]) || log[k] < 0 || log[k] > last || (k && log[k] < log[k - 1])) return { error: 'log' };
  const s = driftSim(model, track, seed);
  let k = 0;
  while (!s.done) {
    while (k < log.length && log[k] === s.t / DRIFT_STEP) (s.hold = !s.hold, k++);
    s.step();
  }
  return { score: s.score, clean: s.clean, spins: s.spins, wides: s.wides, maxCombo: s.maxCombo, corners: s.corners, ms: s.t };
}
// The most a car can score on a track: every metre in the ideal band, on the line, at the top speed factor, with the
// full combo from the first corners on; less the distance it takes (at least at the slowest speed) to swing from what
// is left of the angle after the straight into the corner's green zone.
export function driftCap(model, track) {
  const rise = model.turn + 1.5 * 22 + DRIFT_NOISE / 2;
  let pts = 0, before = 0;
  for (const g of track.segs) {
    if (g.kind === 'straight') {
      before = g.len;
      continue;
    }
    const carry = Math.max(0, model.spin - (model.recover * 1.5 * before) / model.vmax);
    const entry = (Math.max(0, g.center - model.half - carry) / rise) * DRIFT_VMIN;
    pts += DRIFT.ppm * Math.max(0, g.len - entry) * DRIFT.idealBonus * 1.3 * driftMult(g.corner + 1);
  }
  return Math.min(DRIFT_MAX, Math.ceil(pts));
}
// A driver with human limits, for tuning rivals and computing the par: sees the car `lag` ms late (260 ms at skill 0,
// 80 ms at skill 1), aims at the corner's ideal angle with a per-corner error and dead band that shrink with skill,
// adds angle when the car runs wide (more often with skill), and brakes for the next corner to roughly its vref
// (a careless driver sometimes forgets). Frames at `fps`. Deterministic for (seed, rs).
export function driftBot(model, track, seed, { skill = 0.5, rs = 1, fps = 60 } = {}) {
  const sim = driftSim(model, track, seed), rnd = mulberry32((rs * 2654435761) >>> 0), segs = track.segs;
  const lag = Math.round((260 - 180 * skill) / (1000 / fps));
  const hist = [];
  let aim = 0, hyst = 0, entry = 0, seen = -1, next = -1, careless = false;
  for (let f = 1; !sim.done; f++) {
    hist.push([sim.ang, sim.y, sim.v, sim.seg]);
    if (hist.length > lag + 1) hist.shift();
    const [ang, y, v, si] = hist[0], g = segs[si];
    let hold;
    if (g.kind !== 'straight') {
      if (g.corner !== seen) {
        seen = g.corner;
        aim = g.center + (rnd() - 0.5) * 2 * (1 - skill) * 10;
        hyst = 1 + (1 - skill) * 6;
      }
      const a = aim + (y > 0.4 && rnd() < 0.3 + 0.7 * skill ? 7 : 0);
      hold = ang < a - hyst ? true : ang > a + hyst ? false : sim.hold;
    } else {
      const nx = segs[si + 1];
      if (nx && nx.kind !== 'straight') {
        if (nx.corner !== next) {
          next = nx.corner;
          entry = nx.vref * (1.05 + (rnd() - 0.5) * (1 - skill) * 0.5);
          careless = rnd() < (1 - skill) * 0.4;
        }
        hold = careless || v < entry;
      } else hold = true;
    }
    sim.input(hold);
    sim.advance((f * 1000) / fps);
  }
  return { log: sim.log, score: sim.score, clean: sim.clean, spins: sim.spins, wides: sim.wides, corners: sim.corners, ms: sim.t };
}
// The par of a track for a car: the mean score of an average driver over a few fixed runs (cached).
const driftParCache = new Map();
export function driftPar(model, track) {
  const key = `${track.seed}|${model.turn}|${model.recover}|${model.half}|${model.vmax}|${model.acc}|${model.lat}`;
  let p = driftParCache.get(key);
  if (p == null) {
    let sum = 0;
    for (let k = 1; k <= 10; k++) sum += driftBot(model, track, 7919 * k, { skill: 0.5, rs: k }).score;
    p = Math.round(sum / 10);
    if (driftParCache.size > 2000) driftParCache.clear();
    driftParCache.set(key, p);
  }
  return p;
}
export const RIVAL_NAMES = ['Ваня_Вихлоп', 'Kirill_M5', 'Lightning', 'Гоша_Форсаж', 'NightRider', 'Вовк', 'Дрифт_Кіт', 'Тарас_Турбо', 'BoostBoy', 'Сашко_GT', 'Оксана_V8', 'Mr.Stance', 'Лис_Нітро', 'Богдан_JDM', 'Карпатський_Дрифт', 'Kyiv_Racer', 'Львівський_Турбо', 'Одеса_Street', 'Шумахер_з_Борщагівки', 'Дизель'];
export const PVP_MIN_BET = 5000;
export const FEE = 0.05;
// Parts and plates on the player market (same FEE as cars). Price per piece must stay within minRate…maxRate of the
// item's base value (tier price of a part, value of a plate): too cheap or too dear a lot would just move money between
// a player's own accounts. Lots expire after `hours` and the item goes back. «Вигідна ціна»: a piece price at most
// dealRate of the reference — the median price/base ratio of recent sales (refDays, last refSales) and other sellers'
// lots of the same part tier / plate class, once there are refMin of them; with fewer, the base value itself.
export const ITEM_MARKET = { lots: 10, vipLots: 20, hours: 72, minRate: 0.5, maxRate: 3, dealRate: 0.8, refDays: 14, refSales: 30, refMin: 3, maxCount: 50 };
export const itemPriceRange = (base, count = 1) => [Math.ceil(base * ITEM_MARKET.minRate) * count, Math.floor(base * ITEM_MARKET.maxRate) * count];
export function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Reference ratio from samples (price / base); a lot is a good deal when its piece price ≤ dealRate × ratio × base.
export const itemRefRatio = (samples) => (samples.length >= ITEM_MARKET.refMin ? median(samples) : 1);
export const isItemDeal = (unit, base, ratio) => unit <= ITEM_MARKET.dealRate * ratio * base;

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

// ---------- weekly route ----------
// Four weekly tasks (Kyiv week, Monday 00:00), picked per player and week from this pool. Only solo actions: nothing
// here is faster with a second account (no PvP, battles or market deals). Each pays WEEKLY_FRAG fragments of the
// player's level key (FRAGMENTS_PER_KEY of them make a key, so all four ≈ one key) + XP.quest.
export const WEEKLY_QUESTS = {
  open: { text: 'Відкрий {n} кейсів з машинами', range: [20, 30] },
  win: { text: 'Виграй {n} заїздів', range: [12, 20] },
  collect: { text: 'Забери дохід гаража {n} раз', range: [8, 12] },
  merge: { text: 'Злий деталі {n} раз', range: [4, 6] },
  country: { text: 'Відкрий {n} кейсів країн', range: [3, 5] },
  perfect: { text: 'Зроби {n} ідеальних перемикань', range: [25, 40] },
  drift: { text: 'Проїдь {n} дрифт-заїздів', range: [4, 6] },
  parts: { text: 'Відкрий {n} кейсів з деталями', range: [8, 12] },
};
export const WEEKLY_COUNT = 4;
export const WEEKLY_FRAG = 2;
// A day of the week is active when at least this many of its three daily tasks were claimed (real play, not a login).
export const WEEK_ACTIVE_QUESTS = 2;
// Chests for active days. key: level keys; frag: fragments of the level key; parts: parts of the level's tier;
// fuel: a full shared tank. A 7/7 week gives at most ≈2¼ level keys (tasks 1, chests 1¼) + 5 parts — no money;
// test/weekly.test.js keeps it under 20% (in instant-sale value) of what the week's daily tasks pay.
export const WEEK_CHEST = [
  { days: 3, parts: 5 },
  { days: 5, frag: 2, fuel: true },
  { days: 7, key: 1 },
];
// The key that fits a level; low levels get cheap keys so fresh second accounts can't farm dear cars to pass on.
// Steps are set so a 7/7 week stays under 20% of the week's daily-task money on every level (sport from 28; the
// premium key — 13M since the wide class ranges — is too dear for a weekly chest).
export const levelKey = (lvl) => (lvl < 5 ? 'rust' : lvl < 10 ? 'city' : lvl < 28 ? 'tuning' : 'sport');
export const levelPartTier = (lvl) => (lvl < 10 ? 'stock' : lvl < 20 ? 'street' : 'sport');

// ---------- comeback ----------
// Away minDays+ (level minLevel+, account older than minAgeDays, at most once per cooldownDays): full shared tank and
// every car's tank + one small key. Away bigDays+: also the level key and, for capFor hours, an income cap longer by
// capHours (like VIP; the two don't add up — the larger one counts). No money: the longer cap only lets income keep
// coming while the player is away less often.
export const COMEBACK = { minDays: 3, bigDays: 7, minLevel: 5, minAgeDays: 7, cooldownDays: 14, capHours: 4, capFor: 24 };
export const comebackKey = (lvl) => (lvl < 10 ? 'rust' : 'city');

export const COLLECTION_MILESTONES = [
  { n: 5, money: 20000 },
  { n: 10, money: 60000, slots: 1 },
  { n: 20, money: 150000 },
  { n: 30, money: 350000, slots: 1 },
  { n: 45, money: 1100000 },
  { n: 60, money: 5000000, slots: 1 },
  { n: 80, money: 15000000 },
  { n: ALL_MODELS.filter((m) => !m.secret).length, money: 75000000, slots: 2, label: 'Уся колекція' },
];
// ---------- achievements ----------
// Each achievement has up to four tiers (bronze → diamond). Progress is counted from what the player has done —
// also before achievements existed — and each tier reached pays its reward once. `goals` are the thresholds of the
// measure named by `key` (see achievementProgress on the server); `labels` replace `text` where a tier needs words.
// Balance: achievements are a bonus, not income. A whole track pays back roughly 0.05–0.3 of what reaching it really
// costs (money lost, not money turned into cars); early tiers are thousands, never millions. A reward is either a
// sum of money or { money, caseId, count, parts, tier, fuel } — keys and parts where they are healthier than cash.
// Measures that are cheap to repeat are guarded on the server: PvP wins and case battles count one win per rival per
// day (no farming against a second account), plates count the best plate the player generated himself (a plate that
// came with a traded car doesn't count).
export const ACH_TIERS = [
  { name: 'Бронза', color: '#cd7f32' },
  { name: 'Срібло', color: '#c0c7d1' },
  { name: 'Золото', color: '#ffcc33' },
  { name: 'Діамант', color: '#7ee8fa' },
];
const REGULAR_MODELS = ALL_MODELS.filter((m) => !m.secret).length;
export const ACHIEVEMENTS = [
  { key: 'cases', title: 'Відкривач', icon: 'box', text: 'Відкрий {n} кейсів з машинами', goals: [10, 100, 1000, 5000],
    rewards: [8000, 60000, { money: 300000, caseId: 'city' }, { money: 2500000, caseId: 'sport' }] },
  { key: 'wins', title: 'Гонщик', icon: 'flag-3', text: 'Виграй {n} заїздів', goals: [10, 100, 500, 2000],
    rewards: [5000, { money: 30000, fuel: 1 }, { money: 150000, fuel: 1 }, { money: 600000, fuel: 1 }] },
  { key: 'pvp', title: 'Дуелянт', icon: 'bolt', text: 'Виграй {n} PvP-заїздів (з одним суперником — 1 на день)', goals: [1, 10, 50, 200],
    rewards: [10000, 50000, 200000, 750000] },
  { key: 'battles', title: 'Боєць', icon: 'flame', text: 'Виграй {n} кейс-батлів (з одним суперником — 1 на день)', goals: [1, 10, 50, 200],
    rewards: [10000, 50000, 200000, 750000] },
  { key: 'collection', title: 'Колекціонер', icon: 'books', text: 'Збери {n} різних машин', goals: [10, 40, 80, REGULAR_MODELS],
    rewards: [10000, 50000, 500000, 5000000] },
  { key: 'rarest', title: 'Мисливець', icon: 'diamond', goals: [2, 3, 4, 5], rewards: [10000, 75000, 750000, 2000000],
    labels: ['Отримай епічну (B) машину', 'Отримай легендарну (A) машину', 'Отримай міфічну (S) машину', 'Отримай секретну машину'] },
  { key: 'secrets', title: 'Секретні справи', icon: 'lock', text: 'Збери {n} секретних машин', goals: [1, 3, 6], rewards: [1000000, 4000000, 12000000] },
  { key: 'garage', title: 'Магнат', icon: 'building-warehouse', text: 'Гараж вартістю {n}', money: true, goals: [1e6, 250e6, 2.5e9, 25e9], rewards: [5000, 100000, 1000000, 5000000] },
  { key: 'level', title: 'Ветеран', icon: 'star', text: 'Досягни {n} рівня', goals: [5, 10, 20, 30], rewards: [10000, 60000, 500000, 2500000] },
  { key: 'play', title: 'Свій у гаражі', icon: 'clock', text: 'Проведи в грі {n} год', hours: true, goals: [1, 10, 50, 200],
    rewards: [5000, { money: 25000, fuel: 1 }, { money: 100000, fuel: 1 }, { money: 300000, fuel: 1 }] },
  { key: 'streak', title: 'Постійний', icon: 'calendar', text: 'Забери щоденний бонус {n} днів', goals: [3, 7, 14, 30], rewards: [5000, 20000, 75000, 300000] },
  { key: 'merges', title: 'Механік', icon: 'tools', text: 'Злий деталі {n} раз', goals: [5, 50, 200, 1000],
    rewards: [5000, { parts: 1, tier: 'sport' }, { parts: 1, tier: 'pro' }, { parts: 1, tier: 'race' }] },
  { key: 'tuned', title: 'Тюнер', icon: 'engine', goals: [1, 2, 3, 4], rewards: [5000, 60000, 300000, 1500000],
    labels: ['Постав на машину всі 8 деталей', 'Машина з 8 деталями Sport або краще', 'Машина з 8 деталями Pro або краще', 'Машина з 8 деталями Race'] },
  { key: 'plates', title: 'Номерний знак', icon: 'license', goals: [1, 2, 3, 4], rewards: [3000, 10000, 50000, 500000],
    labels: ['Згенеруй рідкісний (C) номер', 'Згенеруй епічний (B) номер', 'Згенеруй легендарний (A) номер', 'Згенеруй міфічний (S) номер'] },
  { key: 'friends', title: 'Душа компанії', icon: 'users', text: 'Приведи {n} друзів до 3 рівня', goals: [1, 3, 10, 30], rewards: [10000, 40000, 150000, 500000] },
];
export const ACH_BY_KEY = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]));
export function achText(a, tier) {
  if (a.labels) return a.labels[tier];
  const g = a.goals[tier];
  return a.text.replace('{n}', a.money ? short(g) : String(g));
}
// A tier reward as an object ({ money } for a plain sum).
export const achReward = (rw) => (typeof rw === 'number' ? { money: rw } : { money: 0, ...rw });
// What a reward is worth at list prices (keys at the case price, parts at the tier price, a tank refill ~ nothing).
export function achRewardValue(rw) {
  const r = achReward(rw);
  return (r.money || 0) + (r.caseId ? CASE_BY_ID[r.caseId].price * (r.count || 1) : 0) + (r.parts ? TIER_BY_ID[r.tier].price * r.parts : 0);
}
// Short text for the reward: "300 тис ₴ + ключ «Міський» + повний бак".
export function achRewardText(rw) {
  const r = achReward(rw), out = [];
  if (r.money) out.push(short(r.money));
  if (r.caseId) out.push(`${(r.count || 1) > 1 ? r.count + ' × ' : ''}ключ «${CASE_BY_ID[r.caseId].name}»`);
  if (r.parts) out.push(`${r.parts > 1 ? r.parts + ' × ' : ''}деталь ${TIER_BY_ID[r.tier].name}`);
  if (r.fuel) out.push('повний бак');
  return out.join(' + ');
}

// Money for finishing a country collection (on top of its secret car): 4.4% of that secret car's value (the same sums
// as 11% before the secret cars became 2.5× dearer).
export const COUNTRY_REWARD = Object.fromEntries(MAIN_COUNTRIES.map((c) => [c, Math.round((MODELS[SECRET_BY_COUNTRY[c]].price * 0.044) / 10000) * 10000]));

// ---------- collection sets ----------
// Themed sets that cut across countries. A set counts models ever found (the collection table — bought or traded cars
// don't count, as everywhere), not cars owned now. Finishing one pays once (claims key "set:<id>"): a badge for the
// player card, a key and parts by the set's tier, and a small permanent income bonus for the set's cars in the garage
// (the largest bonus of the claimed sets a car is in; bonuses don't add up). No cash.
// Tiers follow the simulated effort to finish the set from zero (tools/sim-sets.mjs: expected opens with the best
// case for each missing car; net loss = spend − instant sale of every drop): bronze ≲ 3 M of net loss, silver ≲ 25 M,
// gold ≲ 300 M, diamond above. A reward is worth 1–8% of that loss in instant-sale terms (the cheap Soviet set ≈ 20%,
// but that is 0.1 M), and all sets together ≈ 21 M — less than the single «Уся колекція» milestone (30 M + 2 slots).
export const SET_TIERS = [
  { name: 'Бронза', reward: { caseId: 'city', frag: 4, parts: 2, tier: 'stock' }, income: 0.01 },
  { name: 'Срібло', reward: { caseId: 'tuning', count: 1, parts: 2, tier: 'sport' }, income: 0.01 },
  { name: 'Золото', reward: { caseId: 'sport', count: 1, parts: 2, tier: 'pro' }, income: 0.02 },
  { name: 'Діамант', reward: { caseId: 'premium', count: 1, parts: 1, tier: 'race' }, income: 0.02 },
];
export const SETS = [
  { id: 'people', name: 'Народні авто', icon: 'car', tier: 0, text: 'Те, на чому їздила вся країна',
    models: ['zaz-lanos', 'daewoo-matiz', 'renault-logan', 'chevrolet-aveo', 'hyundai-accent', 'volkswagen-golf-ii', 'toyota-corolla-e120'] },
  { id: 'soviet', name: 'Радянська класика', icon: 'star', tier: 0, text: 'Копійка, Волга, Нива і компанія',
    models: ['vaz-2101-kopiika', 'vaz-2106', 'moskvych-412', 'haz-24-volha', 'vaz-2121-nyva', 'zaz-968m-zaporozhets', 'zaz-965-horbatyi'] },
  { id: 'nineties', name: '90-ті', icon: 'clock', tier: 1, text: 'Дев\'яності на парковці біля під\'їзду',
    models: ['vaz-2109', 'zaz-1102-tavriia', 'opel-vectra-a', 'volkswagen-passat-b3', 'mazda-mx-5-na', 'nissan-200sx-s13', 'toyota-mark-ii-jzx100', 'bmw-m3-e30'] },
  { id: 'wagons', name: 'Універсали', icon: 'building-warehouse', tier: 1, text: 'Багажник більший за амбіції — або ні',
    models: ['volkswagen-passat-b3', 'skoda-octavia-tour', 'volvo-240-turbo', 'audi-rs4-b7', 'zeekr-001'] },
  { id: 'hothatch', name: 'Хот-хетчі', icon: 'flame', tier: 1, text: 'Маленькі, злі й швидкі',
    models: ['peugeot-205-gti', 'volkswagen-golf-gti-mk5', 'volkswagen-golf-gti-mk7', 'honda-civic-type-r-ep3', 'renault-clio-v6', 'mini-cooper-s'] },
  { id: 'drift', name: 'Дрифт-корч', icon: 'tool', tier: 1, text: 'Задній привід і боком у поворот',
    models: ['toyota-corolla-ae86', 'nissan-200sx-s13', 'nissan-silvia-s15', 'toyota-mark-ii-jzx100', 'bmw-325i-e30', 'ford-mustang-gt-2005'] },
  { id: 'jdm', name: 'JDM-легенди', icon: 'flag-3', tier: 1, text: 'Герої «Форсажу» та японських гір',
    models: ['toyota-supra-a80', 'nissan-skyline-gt-r-r34', 'mazda-rx-7-fd', 'honda-nsx-na1', 'mitsubishi-lancer-evolution-vi', 'subaru-impreza-wrx-gc8'] },
  { id: 'rally', name: 'Ралі: група B і WRC', icon: 'world', tier: 1, text: 'Від ВАЗ VFTS до GR Yaris',
    models: ['vaz-2105-vfts', 'lancia-delta-hf-integrale', 'audi-80-quattro', 'subaru-impreza-wrx-sti', 'mitsubishi-lancer-evolution-ix', 'toyota-gr-yaris'] },
  { id: 'german', name: 'Німецька трійка', icon: 'engine', tier: 1, text: 'BMW, Mercedes, Audi — по дві легенди',
    models: ['bmw-m3-e30', 'bmw-m3-e46', 'mercedes-benz-190e-2-3-16', 'mercedes-amg-c63-s', 'audi-80-quattro', 'audi-rs4-b7'] },
  { id: 'china', name: 'Китайський прорив', icon: 'bolt', tier: 1, text: 'BYD, Zeekr, Xiaomi, NIO',
    models: ['byd-dolphin', 'geely-monjaro', 'byd-seal', 'byd-han', 'zeekr-001', 'xiaomi-su7-max', 'nio-et7'] },
  { id: 'ev', name: 'Електрореволюція', icon: 'battery', tier: 2, text: 'Від Leaf до Taycan — без жодної краплі бензину',
    models: ['nissan-leaf', 'byd-dolphin', 'tesla-model-y', 'tesla-model-3-performance', 'hyundai-ioniq-5-n', 'kia-ev6-gt', 'porsche-taycan-turbo-s'] },
  { id: 'muscle', name: 'Американські мускул-кари', icon: 'flame', tier: 2, text: 'V8, дим і пряма',
    models: ['ford-mustang-1967', 'ford-mustang-gt-2005', 'chevrolet-camaro-ss', 'dodge-challenger-srt-hellcat', 'shelby-gt500', 'dodge-viper-acr'] },
  { id: 'offroad', name: 'Позашляховики', icon: 'world', tier: 2, text: 'Куди асфальт не веде',
    models: ['vaz-2121-nyva', 'toyota-land-cruiser-80', 'jeep-wrangler', 'bmw-x5-e70', 'lamborghini-urus', 'mercedes-amg-g63'] },
  { id: 'super10', name: 'Суперкари 2010-х', icon: 'diamond', tier: 2, text: 'Плакати на стіні — тепер у гаражі',
    models: ['ferrari-458-italia', 'lamborghini-huracan-evo', 'mclaren-570s', 'audi-r8-v10-plus', 'porsche-911-turbo-s', 'nissan-gt-r-r35', 'chevrolet-corvette-c8'] },
  { id: 'hyper', name: 'Гіперкари', icon: 'crown', tier: 3, text: 'Свята трійця та її друзі',
    models: ['porsche-918-spyder', 'ferrari-laferrari', 'mclaren-p1', 'bugatti-veyron-16-4', 'pagani-huayra', 'lexus-lfa'] },
  { id: 'club1000', name: 'Клуб 1000+ к.с.', icon: 'rocket', tier: 3, text: 'Понад тисячу сил — і жодних компромісів',
    models: ['bugatti-chiron-super-sport', 'koenigsegg-jesko', 'rimac-nevera', 'ssc-tuatara', 'lotus-evija', 'nio-ep9'] },
];
export const SET_BY_ID = Object.fromEntries(SETS.map((s) => [s.id, s]));
export const setReward = (set) => SET_TIERS[set.tier].reward;
export const setIncome = (set) => SET_TIERS[set.tier].income;
export const setBadgeTitle = (set) => `Сет «${set.name}»`;
// What a set's reward is worth if cashed out at once: the key at its case's instant-sale average, parts at half price.
export function setRewardValue(set) {
  const r = setReward(set);
  return Math.round(CASE_BY_ID[r.caseId].sellEv * ((r.count || 0) + (r.frag || 0) / FRAGMENTS_PER_KEY) + TIER_BY_ID[r.tier].price * PART_SELL_RATE * r.parts);
}
// "ключ «Тюнінг-ательє» + 2 × деталь Sport + +1% доходу"
export function setRewardText(set) {
  const r = setReward(set), out = [];
  if (r.count) out.push(`${r.count > 1 ? r.count + ' × ' : ''}ключ «${CASE_BY_ID[r.caseId].name}»`);
  if (r.frag) out.push(`${r.frag} фрагменти ключа «${CASE_BY_ID[r.caseId].name}»`);
  if (r.parts) out.push(`${r.parts > 1 ? r.parts + ' × ' : ''}деталь ${TIER_BY_ID[r.tier].name}`);
  out.push(`+${Math.round(setIncome(set) * 100)}% доходу машинам сету`);
  return out.join(' + ');
}
// Found models of a set; `have` is a Set (or array) of model ids from the collection.
export function setProgress(set, have) {
  const h = have instanceof Set ? have : new Set(have);
  const got = set.models.filter((id) => h.has(id));
  return { have: got.length, need: set.models.length, done: got.length === set.models.length, got };
}
// Income bonus of a model from claimed sets (claimed: iterable of set ids): the largest one, never a sum.
export function setIncomeBonus(model, claimed) {
  let b = 0;
  for (const id of claimed) {
    const s = SET_BY_ID[id];
    if (s && s.models.includes(model)) b = Math.max(b, setIncome(s));
  }
  return b;
}

// ---------- upgrade (CS-style: risk your cars for a chance at a pricier one) ----------
// Trade-in at the dealer: three cars of one class go in, one car comes out — of the next class with `chance`, else
// of the same class. The car out is drawn from that class with price up to `maxMult` × what went in, cheaper cars more
// often, so three cheap cars can't buy a jackpot. On average ~85% of the value goes back: a fair way to clear doubles.
export const TRADE_IN = { cars: 3, chance: 0.3, maxMult: 2.5 };
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
const passMoney = (l) => niceRound(16000 * Math.pow(l, 1.5));
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

// ---------- first minutes of a new player ----------
// "How to play" stories: shown once to a player who has never opened a case (remembered on the server as the claim
// 'intro'). Seeing them also counts as having seen the current WHATS_NEW, so a new player doesn't get "what's new" on top.
export const INTRO_STORY = {
  id: 'intro-1',
  last: 'Відкрити кейс!',
  slides: [
    { icon: 'car-turbine', title: 'Вітаю в АВТОДРОП', text: `Збирай гараж мрії: ${ALL_MODELS.filter((m) => !m.secret).length} справжні авто — від «Запорожця» до Bugatti. Відкривай кейси, ганяй, торгуй.` },
    { icon: 'gift', title: 'Перший кейс — безкоштовно', text: 'Стартовий кейс уже чекає: усередині українська класика. Відкрий його одразу після цих слайдів.' },
    { icon: 'diamond', title: 'Кейси і класи', text: 'Кожен кейс — шанс на рідкісне авто. Класи: D → C → B → A → S, від звичайних до міфічних. Скільки лишилось до гарантії — видно під кейсом.' },
    { icon: 'coin', title: 'Гараж заробляє', text: 'Кожна машина приносить дохід щогодини, навіть коли гра закрита. Заходь і тисни «Забрати». Непотрібне авто продай одразу з кейсу.' },
    { icon: 'flag-3', title: 'Гонки', text: 'Дрег на 402 м: жми «ГАЗ» рівно на зелений і перемикай передачі в зеленій зоні. Перемога — гроші й досвід, тюнінг — більше к.с.' },
    { icon: 'books', title: 'Колекції і секретки', text: `Збери всі машини однієї країни — отримаєш секретну, якої немає в жодному кейсі. ${MAIN_COUNTRIES.length} країн — ${MAIN_COUNTRIES.length} секреток.` },
    { icon: 'calendar', title: 'Щодня — подарунок', text: `Щоденний бонус на ${DAILY_BONUS.length} днів: на 7-й — авто зі «Спорткара», на 14-й — з «Еліти». Плюс сезонний пропуск на ${SEASON.levels} рівнів.` },
  ],
};
// Which story the app shows at start. `localSeen`: WHATS_NEW already shown in this browser.
export function storyFor(me, localSeen = false) {
  if (me.intro) return 'intro';
  if (me.cars.length && !localSeen && !me.claims.includes('story:' + WHATS_NEW.id)) return 'whatsnew';
  return null;
}
// First steps after the stories: one highlighted action at a time. Rewards are the ones the game already has
// (newbie tasks, the daily bonus) — the guide only points at them. 'keep' is the drop screen (known to the app only).
export const GUIDE_PATH = ['starter', 'keep', 'collect', 'race', 'daily']; // the dots on the hint card
export const GUIDE_STEPS = [
  { key: 'starter', tab: 'cases', target: '[data-act="openCase"]', title: 'Відкрий стартовий кейс', text: 'Він безкоштовний — тисни кнопку й дивись, що випаде.' },
  { key: 'keep', tab: 'cases', target: '[data-act="toGarage"]', title: 'Залиш або продай', text: '«У гараж» — машина заробляє й їздить у гонках. «Продати» — гроші одразу.' },
  // Only when the garage is empty (the starter car was sold): a car is needed for income and races.
  { key: 'case', tab: 'cases', target: '[data-act="openCase"]', title: 'Відкрий кейс з машиною', text: '«Іржавий гараж» — найдешевший. Машина в гаражі заробляє гроші й їздить у гонках.', extra: true },
  { key: 'collect', tab: 'garage', target: '[data-act="collect"]', title: 'Забери дохід гаража', text: 'Машина вже заробила кілька гривень. Тисни «Забрати» — і так щоразу, як заходиш.' },
  { key: 'race', tab: 'race', target: '.rival', title: 'Проїдь перший заїзд', text: 'Обери суперника. На світлофорі жми «ГАЗ» на зелений, передачі — у зеленій зоні.' },
  { key: 'daily', tab: null, target: '#gift', title: 'Забери щоденний бонус', text: 'Подарунок угорі екрана. Заходь щодня — на 7-й день машина зі «Спорткара».' },
];
// p: { introSeen (the player came through the intro stories), off (hints turned off), keys, garage (cars in the garage), flags (newbie flags), races, streak, dailyReady }.
export function guideStep(p) {
  if (!p.introSeen || p.off) return null;
  if (p.keys?.starter) return 'starter';
  const needCollect = !p.flags.includes('collect'), needRace = !p.races;
  if (!p.garage && (needCollect || needRace)) return 'case';
  if (needCollect) return 'collect';
  if (needRace) return 'race';
  if (!p.streak && p.dailyReady) return 'daily';
  return null;
}

// ---------- events ----------
// Scheduled game events. The calendar is a weekly rotation computed from the date (Europe/Kyiv), so nobody has to start
// anything by hand. An admin can start an event now or stop a running one (admin `events/start`, `events/stop`); those
// overrides ({ forced: [...], stopped: { key: at } }) are the only state. Every effect is clamped by EVENT_CAPS. The case
// effects are paid for out of the hidden boost and the key fragments, so open-and-sell stays under EVENT_CAPS.sellMax
// of the price actually paid during any event (test/events.test.js, tools/sim-events.mjs).
export const EVENTS = {
  luck: { name: 'Вихідні удачі', icon: 'clover', color: '#30d158', days: 2, topMult: 1.3, boost: 0,
    text: 'Кейси за рідкістю: шанс найвищого класу ×1,3. Кейс дня на вихідних відпочиває.' },
  fuel: { name: 'Подвійне паливо', icon: 'gas-station', color: '#ff9f0a', days: 1, fuelMult: 2,
    text: 'Загальний бак і баки машин наповнюються вдвічі швидше (з VIP — утричі).' },
  race: { name: 'Гоночний уїкенд', icon: 'flag-3', color: '#ff3b30', days: 2, prizeMult: 1.25,
    text: 'Призи за перемоги в драгу й дрифті +25%. Внесок той самий.' },
  country: { name: 'Країна тижня', icon: 'world', color: '#0a84ff', days: 7, off: 0.15, boost: 0, fragments: false, save: false,
    text: 'Кейс країни −15%. Знижений кейс не дає фрагментів ключа.' },
  plates: { name: 'Щасливі номери', icon: 'license', color: '#bf5af2', days: 1, off: 0.2, gens: ['pretty', 'region'],
    text: '«Красивий» номер і номери областей −20%.' },
};
export const EVENT_IDS = Object.keys(EVENTS);
// Hard limits, whatever the definitions or the admin overrides say.
//   topMult — the top class of a rarity case at most ×1.3; fuelMult — the event refills at most ×2, fuelTotal — with VIP at
//   most ×3; prizeMult — race prizes at most +25%; caseOff / plateOff — discounts; forced — admin starts: at most 3 at once,
//   1–72 h; sellMax — open-and-sell of any case during any event returns less than this share of the price paid.
export const EVENT_CAPS = { topMult: 1.3, fuelMult: 2, fuelTotal: 3, prizeMult: 1.25, caseOff: 0.15, plateOff: 0.2, forcedMax: 3, forcedHours: [1, 72], sellMax: 0.85 };
// Never at the same time: double fuel means more races, and the race weekend pays more for each.
export const EVENT_EXCLUSIVE = [['fuel', 'race']];
// Weekly rotation; day 0 = Monday, every slot starts at 00:00 Kyiv and lasts EVENTS[id].days days.
//   Week A (even): Tue «Щасливі номери», Thu «Подвійне паливо», Sat–Sun «Вихідні удачі».
//   Week B (odd):  Tue «Подвійне паливо», Thu «Щасливі номери», Sat–Sun «Гоночний уїкенд».
//   «Країна тижня» runs Monday to Sunday every week, the countries in turn (MAIN_COUNTRIES order).
export const EVENT_WEEKS = [
  [{ id: 'country', day: 0 }, { id: 'plates', day: 1 }, { id: 'fuel', day: 3 }, { id: 'luck', day: 5 }],
  [{ id: 'country', day: 0 }, { id: 'fuel', day: 1 }, { id: 'plates', day: 3 }, { id: 'race', day: 5 }],
];
const KYIV_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
// How far the Kyiv wall clock is ahead of UTC at t (2 or 3 hours).
function kyivAhead(t) {
  const p = Object.fromEntries(KYIV_PARTS.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}
const addDate = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400e3).toISOString().slice(0, 10);
// 00:00 Kyiv time of a calendar date ('YYYY-MM-DD') plus `days` days — right across the summer-time switches.
export function kyivMidnightOf(date, days = 0) {
  const g = Date.parse(addDate(date, days) + 'T00:00:00Z');
  return g - kyivAhead(g - kyivAhead(g));
}
export const kyivDateOf = (t) => new Date(t + kyivAhead(t)).toISOString().slice(0, 10);
export function kyivMondayOf(t) {
  const d = kyivDateOf(t);
  return addDate(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
}
// Weeks since Monday 1970-01-05: decides week A/B and the country of the week.
export const eventWeekNo = (monday) => Math.round((Date.parse(monday + 'T00:00:00Z') - Date.UTC(1970, 0, 5)) / (7 * 86400e3));
const weekCache = new Map();
function weekEvents(monday) {
  let list = weekCache.get(monday);
  if (list) return list;
  const n = eventWeekNo(monday);
  list = EVENT_WEEKS[n % 2].map((s) => {
    const e = { key: `${s.id}:${monday}`, id: s.id, start: kyivMidnightOf(monday, s.day), end: kyivMidnightOf(monday, s.day + EVENTS[s.id].days) };
    if (s.id === 'country') e.country = MAIN_COUNTRIES[n % MAIN_COUNTRIES.length];
    return e;
  });
  if (weekCache.size > 64) weekCache.clear();
  weekCache.set(monday, list);
  return list;
}
// Every event (scheduled or started by an admin) that overlaps [from, to), with admin stops applied, by start time.
export function eventsBetween(from, to, ov = null) {
  const out = [];
  for (let m = kyivMondayOf(from - 86400e3); kyivMidnightOf(m) < to; m = addDate(m, 7)) out.push(...weekEvents(m));
  for (const f of ov?.forced || []) if (EVENTS[f.id]) out.push({ ...f, forced: true });
  return out
    .map((e) => {
      const s = ov?.stopped?.[e.key];
      return s != null && s < e.end ? { ...e, end: Math.max(e.start, s), stopped: true } : e;
    })
    .filter((e) => e.end > e.start && e.end > from && e.start < to)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
export const activeEvents = (t, ov = null) => eventsBetween(t, t + 1, ov);
// What the running events do together, clamped.
export function eventEffects(list) {
  const fx = { ids: [], topMult: 1, fuelMult: 1, prizeMult: 1, countries: [], caseOff: 0, plateOff: 0, plateGens: [], noCaseOfDay: false };
  for (const e of list) {
    const d = EVENTS[e.id];
    if (!d) continue;
    if (!fx.ids.includes(e.id)) fx.ids.push(e.id);
    if (e.id === 'luck') {
      fx.topMult = Math.max(fx.topMult, Math.min(EVENT_CAPS.topMult, d.topMult));
      fx.noCaseOfDay = true;
    } else if (e.id === 'fuel') fx.fuelMult = Math.max(fx.fuelMult, Math.min(EVENT_CAPS.fuelMult, d.fuelMult));
    else if (e.id === 'race') fx.prizeMult = Math.max(fx.prizeMult, Math.min(EVENT_CAPS.prizeMult, d.prizeMult));
    else if (e.id === 'country' && MAIN_COUNTRIES.includes(e.country)) {
      if (!fx.countries.includes(e.country)) fx.countries.push(e.country);
      fx.caseOff = Math.min(EVENT_CAPS.caseOff, d.off);
    } else if (e.id === 'plates') {
      fx.plateOff = Math.min(EVENT_CAPS.plateOff, d.off);
      fx.plateGens = d.gens;
    }
  }
  return fx;
}
export const NO_EVENTS = eventEffects([]);
export const effectsAt = (t, ov = null) => eventEffects(activeEvents(t, ov));
// «Вихідні удачі»: the top class weight × mult (at most half of all), the other classes give it up in proportion.
export function luckWeights(w, mult) {
  const cl = CLASS_ORDER.filter((c) => w[c]);
  if (cl.length < 2 || mult <= 1) return w;
  const top = cl[cl.length - 1], tw = cl.reduce((s, c) => s + w[c], 0);
  const nt = Math.min(w[top] * Math.min(mult, EVENT_CAPS.topMult), tw / 2);
  const k = (tw - nt) / (tw - w[top]);
  return Object.fromEntries(cl.map((c) => [c, Math.round((c === top ? nt : w[c] * k) * 1000) / 1000]));
}
// A case right now: its price (case of the day or the country of the week), class weights, the hidden boost and whether
// paid opens leave key fragments (and whether the losing-streak save works). The luck weekend replaces the hidden boost
// and the case of the day; the country discount replaces the boost, the fragments and the streak save — that is what
// keeps open-and-sell under EVENT_CAPS.sellMax (tools/sim-events.mjs).
export function caseDeal(cs, day, fx = NO_EVENTS) {
  const deal = { price: cs.price, weights: cs.weights, boost: BOOST, fragments: true, save: true, off: 0, why: null };
  if (cs.starter) return { ...deal, price: 0, boost: 0, fragments: false };
  if (cs.group === 'rarity') {
    // The case of the day pays for its discount out of the hidden boost (the shown odds stay as they are).
    if (!fx.noCaseOfDay && cs.id === caseOfDay(day)) Object.assign(deal, { price: casePrice(cs, day), off: CASE_OF_DAY.off, boost: CASE_OF_DAY.boost, why: 'day' });
    if (fx.topMult > 1) Object.assign(deal, { weights: luckWeights(cs.weights, fx.topMult), boost: EVENTS.luck.boost, why: deal.why || 'luck' });
  } else if (cs.group === 'country' && fx.countries.includes(cs.country)) {
    Object.assign(deal, { price: Math.round((cs.price * (1 - fx.caseOff)) / 1000) * 1000, off: fx.caseOff, boost: EVENTS.country.boost, fragments: EVENTS.country.fragments, save: EVENTS.country.save, why: 'country' });
  }
  return deal;
}
// Plate generation price: gen is a PLATE_GEN id or 'region' (a chosen region).
export const platePriceOf = (price, gen, fx = NO_EVENTS) => (fx.plateGens.includes(gen) ? Math.round((price * (1 - fx.plateOff)) / 100) * 100 : price);
// Race prize during the race weekend (entries stay as they are).
export const eventPrize = (prize, fx = NO_EVENTS, step = 1000) => (fx.prizeMult > 1 ? Math.round((prize * Math.min(fx.prizeMult, EVENT_CAPS.prizeMult)) / step) * step : prize);
// Fuel refill speed over [a, b): VIP × the fuel event, at most EVENT_CAPS.fuelTotal.
export function fuelSegments(a, b, ov = null, vip = 1) {
  const evs = b > a ? eventsBetween(a, b, ov).filter((e) => EVENTS[e.id].fuelMult) : [];
  const cuts = [...new Set([a, b, ...evs.flatMap((e) => [e.start, e.end])])].filter((x) => x >= a && x <= b).sort((x, y) => x - y);
  const segs = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    const ev = evs.some((e) => e.start <= mid && mid < e.end) ? Math.min(EVENT_CAPS.fuelMult, EVENTS.fuel.fuelMult) : 1;
    segs.push({ a: cuts[i], b: cuts[i + 1], rate: Math.min(EVENT_CAPS.fuelTotal, vip * ev) });
  }
  return segs;
}
// Units refilled since `from` (at most `need`), one per periodMs at rate 1: n, when the last of them came (at; `from`
// when none did) and when the next one comes (null when full). The rate changes exactly at the event's start and end,
// so a fuel event never refills time that passed before it began.
export function regenAt(from, t, periodMs, need, ov = null, vip = 1) {
  if (need <= 0) return { n: 0, at: t, next: null };
  const horizon = from + Math.ceil((need * periodMs) / vip);
  const segs = fuelSegments(from, horizon, ov, vip);
  const timeOf = (target) => {
    let e = 0;
    for (const s of segs) {
      const len = (s.b - s.a) * s.rate;
      if (e + len >= target - 1e-6) return s.a + (target - e) / s.rate;
      e += len;
    }
    return horizon;
  };
  let eff = 0;
  for (const s of segs) {
    if (s.a >= t) break;
    eff += (Math.min(s.b, t) - s.a) * s.rate;
  }
  const n = Math.min(need, Math.floor(eff / periodMs + 1e-9));
  return { n, at: n ? Math.round(timeOf(n * periodMs)) : from, next: n >= need ? null : Math.ceil(timeOf((n + 1) * periodMs) - 1e-6) };
}
// For the client: an event with its name, text and times.
export function eventInfo(e) {
  const d = EVENTS[e.id];
  const country = e.country ? COUNTRIES[e.country]?.name : null;
  return { key: e.key, id: e.id, name: d.name, icon: d.icon, color: d.color, text: d.text, start: e.start, end: e.end, country: e.country || null,
    title: country ? `${d.name}: ${country}` : d.name, forced: !!e.forced };
}

// ---------- paint shop (Фарба 2.0) ----------
// A paint recolours only the car's body on its photo (mask from tools/paint, renderer in public/paint.js); a livery is
// drawn on the same body on top of the paint. Both belong to one car item, travel with it in trades and on the market,
// and give nothing: the sell value stays the same, so the money spent is a pure sink. Prices are a share of the model's
// price (so they follow the economy's car prices); back to the factory colour / off with the livery is free.
// The first eleven ids are those of the old CSS repaint: cars painted back then keep their colour.
export const PAINT_COLORS = [
  { id: 'white', name: 'Білий', hex: '#eceeef', finish: 'gloss' },
  { id: 'black', name: 'Чорний', hex: '#141518', finish: 'gloss' },
  { id: 'red', name: 'Червоний', hex: '#b5121b', finish: 'gloss' },
  { id: 'orange', name: 'Помаранчевий', hex: '#e2591b', finish: 'gloss' },
  { id: 'yellow', name: 'Жовтий', hex: '#f2c300', finish: 'gloss' },
  { id: 'green', name: 'Зелений', hex: '#1d6b3a', finish: 'gloss' },
  { id: 'teal', name: 'Бірюзовий', hex: '#12867f', finish: 'gloss' },
  { id: 'blue', name: 'Синій', hex: '#1f4fa8', finish: 'gloss' },
  { id: 'purple', name: 'Фіолетовий', hex: '#5a2a8a', finish: 'gloss' },
  { id: 'pink', name: 'Рожевий', hex: '#d2367f', finish: 'gloss' },
  { id: 'graphite', name: 'Графіт', hex: '#4a4e55', finish: 'metallic' },
  { id: 'silver', name: 'Срібло', hex: '#b9bdc3', finish: 'metallic' },
  { id: 'midnight', name: 'Нічний синій', hex: '#1a2a5e', finish: 'metallic' },
  { id: 'cherry', name: 'Вишня', hex: '#6e0f1c', finish: 'metallic' },
  { id: 'matteblack', name: 'Чорний мат', hex: '#1d1e21', finish: 'matte' },
  { id: 'nardo', name: 'Нардо', hex: '#8a8d8f', finish: 'matte' },
];
export const PAINT_BY_ID = Object.fromEntries(PAINT_COLORS.map((p) => [p.id, p]));
export const PAINT_FINISH = { gloss: 'глянець', metallic: 'металік', matte: 'мат' };
export const LIVERIES = [
  { id: 'stripes', name: 'Смуги', hint: 'дві смуги вздовж кузова' },
  { id: 'race', name: 'Гоночна', hint: 'смуга й номер у колі' },
  { id: 'ua', name: 'Синьо-жовта', hint: 'верх синій, низ жовтий' },
  { id: 'camo', name: 'Камуфляж', hint: 'піксельний' },
  { id: 'fade', name: 'Захід сонця', hint: 'градієнт помаранчевий → фіолетовий' },
];
export const LIVERY_BY_ID = Object.fromEntries(LIVERIES.map((l) => [l.id, l]));
export const PAINT = { rate: 0.03, min: 5000, liveryRate: 0.05, liveryMin: 8000 };
const paintRound = (x) => (x < 1e6 ? Math.round(x / 1000) * 1000 : Math.round(x / 10000) * 10000);
export const paintPrice = (model) => Math.max(PAINT.min, paintRound((MODELS[model]?.price || 0) * PAINT.rate));
export const liveryPrice = (model) => Math.max(PAINT.liveryMin, paintRound((MODELS[model]?.price || 0) * PAINT.liveryRate));
