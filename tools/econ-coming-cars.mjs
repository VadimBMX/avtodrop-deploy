// PROPOSAL — the 58 cars David is generating for Season 2 (prompts 183–240, scratchpad/david/avtodrop-mashyny-dlya-davyda.txt),
// priced «virtually» so the economy is designed for the whole ~240-car roster. NOT in the game: no photos yet, nothing in
// public/shared.js reads this file. When a photo arrives, move the row into LATE_RAW of public/shared.js (same format) —
// LATE_RAW prices a car between its neighbours by score, exactly like comingPrice() below, so no car already in a garage
// changes its price. The three redos (154 Lada Priora, 089 Mercedes-AMG C63 S, 030 Haval Jolion) are already in the game
// and keep their price.
//
// [n, name, class David wrote, class proposed, hp, kg, body, country, year, ev?, prestige, why the class changed]
// hp/kg/year: factory figures of the generation in the prompt (rounded). Prestige: the same −3…+3 scale as shared.js.
import * as S from '../public/shared.js';

export const COMING = [
  [183, 'BMW M5 E60', 'B', 'B', 507, 1830, 'sedan', 'DE', 2008, false, 0],
  [184, 'BMW M5 F10', 'A', 'B', 560, 1870, 'sedan', 'DE', 2014, false, 0, 'a 2014 sedan next to the Ferrari 458 (A) is out of line; top of B'],
  [185, 'BMW X5 4.8is E53', 'C', 'C', 360, 2200, 'suv', 'DE', 2005, false, 0],
  [186, 'BMW M4 F82', 'A', 'B', 431, 1497, 'coupe', 'DE', 2016, false, 0, 'the M3 E30 / E46 are B; their successor too'],
  [187, 'BMW M3 E36', 'B', 'B', 321, 1460, 'coupe', 'DE', 1997, false, 1],
  [188, 'BMW M3 E92', 'B', 'B', 420, 1580, 'coupe', 'DE', 2010, false, 1],
  [189, 'BMW M8 Competition', 'A', 'B', 625, 1885, 'coupe', 'DE', 2020, false, 0, 'a GT, not a supercar; top of B'],
  [190, 'Toyota Land Cruiser 100', 'C', 'C', 235, 2450, 'suv', 'JP', 2005, false, 2],
  [191, 'Toyota Land Cruiser Prado 150', 'C', 'C', 280, 2200, 'suv', 'JP', 2015, false, 0],
  [192, 'Mazda 3 MPS', 'C', 'C', 260, 1385, 'hatch', 'JP', 2008, false, 0],
  [193, 'Mazda 6 MPS', 'C', 'C', 260, 1590, 'sedan', 'JP', 2006, false, 0],
  [194, 'Toyota GR Supra A90', 'A', 'B', 387, 1495, 'coupe', 'JP', 2020, false, 0, 'the A80 legend is B (7,7 млн); the A90 must not outrank it'],
  [195, 'Nissan 350Z', 'C', 'C', 287, 1430, 'coupe', 'JP', 2006, false, 1],
  [196, 'Honda S2000', 'B', 'B', 240, 1250, 'coupe', 'JP', 2002, false, 2],
  [197, 'Toyota Chaser Tourer V JZX100', 'C', 'C', 280, 1450, 'sedan', 'JP', 1998, false, 2],
  [198, 'Mitsubishi Lancer X', 'D', 'D', 143, 1300, 'sedan', 'JP', 2010, false, 0],
  [199, 'Toyota Camry XV70', 'D', 'D', 206, 1550, 'sedan', 'JP', 2019, false, 0],
  [200, 'Chery Tiggo 8 Pro', 'D', 'D', 197, 1650, 'suv', 'CN', 2022, false, -1],
  [201, 'Geely Atlas (2024)', 'D', 'D', 218, 1700, 'suv', 'CN', 2024, false, -1],
  [202, 'Haval H6', 'D', 'D', 201, 1600, 'suv', 'CN', 2022, false, -1],
  [203, 'Haval Dargo', 'D', 'D', 218, 1700, 'suv', 'CN', 2023, false, -1],
  [204, 'Tank 300', 'C', 'C', 227, 2150, 'suv', 'CN', 2022, false, 0],
  [205, 'Tank 500', 'C', 'C', 354, 2500, 'suv', 'CN', 2023, false, 0],
  [206, 'BYD Song Plus', 'D', 'D', 218, 1900, 'suv', 'CN', 2023, true, -1],
  [207, 'BYD Tang EV', 'C', 'C', 517, 2560, 'suv', 'CN', 2023, true, -1],
  [208, 'Lynk & Co 01', 'D', 'D', 190, 1700, 'suv', 'CN', 2021, false, -1],
  [209, 'Exeed RX', 'C', 'C', 261, 1750, 'suv', 'CN', 2023, false, -1],
  [210, 'Changan UNI-V', 'D', 'D', 188, 1475, 'hatch', 'CN', 2023, false, 0],
  [211, 'Hongqi H9', 'B', 'B', 360, 2050, 'sedan', 'CN', 2021, false, 1],
  [212, 'Zeekr 7X', 'B', 'B', 646, 2490, 'suv', 'CN', 2024, true, -1],
  [213, 'Xpeng G9', 'B', 'B', 551, 2400, 'suv', 'CN', 2023, true, -1],
  [214, 'Aito M9', 'A', 'B', 524, 2780, 'suv', 'CN', 2024, true, -1, 'a 70 000 $ family SUV can\'t sit with the Ford GT; B'],
  [215, 'Denza Z9 GT', 'A', 'B', 966, 2700, 'coupe', 'CN', 2025, true, -1, 'fast on paper, heavy EV GT; B like the BYD Han / Zeekr 001'],
  [216, 'MG Cyberster', 'A', 'B', 503, 1985, 'coupe', 'CN', 2024, true, 0, 'an EV roadster, below the A supercars'],
  [217, 'Xiaomi YU7', 'A', 'B', 690, 2400, 'suv', 'CN', 2025, true, 0, 'the SU7 Max is B; the SUV sibling can\'t be a class higher'],
  [218, 'ВАЗ-2110', 'D', 'D', 79, 1035, 'sedan', 'UA', 2000, false, 1],
  [219, 'ВАЗ-2115', 'D', 'D', 79, 1000, 'sedan', 'UA', 2005, false, 0],
  [220, 'Škoda Octavia RS A5', 'C', 'C', 200, 1400, 'sedan', 'CZ', 2008, false, 0],
  [221, 'Volkswagen Passat B6', 'D', 'D', 200, 1500, 'sedan', 'DE', 2007, false, 0],
  [222, 'Audi A6 C5', 'D', 'D', 180, 1500, 'sedan', 'DE', 2001, false, 0],
  [223, 'Mercedes-Benz E500 W211', 'C', 'C', 306, 1800, 'sedan', 'DE', 2005, false, 0],
  [224, 'Opel Astra G', 'D', 'D', 101, 1150, 'hatch', 'DE', 2000, false, 0],
  [225, 'Daewoo Nexia', 'D', 'D', 75, 1025, 'sedan', 'KR', 2005, false, 1],
  [226, 'Renault Duster', 'D', 'D', 114, 1300, 'suv', 'FR', 2014, false, 0],
  [227, 'Kia Sportage', 'D', 'D', 177, 1550, 'suv', 'KR', 2018, false, -1],
  [228, 'Audi RS6 Avant C8', 'A', 'A', 600, 2075, 'wagon', 'DE', 2020, false, 1],
  [229, 'Audi RS6 C5', 'B', 'B', 450, 1865, 'wagon', 'DE', 2003, false, 1],
  [230, 'Mercedes-AMG E63 W212', 'B', 'B', 557, 1840, 'sedan', 'DE', 2012, false, 0],
  [231, 'Mercedes-AMG CLS 63 C218', 'B', 'B', 557, 1870, 'sedan', 'DE', 2013, false, 0],
  [232, 'Porsche Cayenne Turbo', 'A', 'A', 550, 2175, 'suv', 'DE', 2018, false, -1],
  [233, 'Porsche 911 GT3 RS (992)', 'S', 'A', 525, 1450, 'super', 'DE', 2023, false, 2, 'a 300 000 $ track car, not a hypercar; top of A'],
  [234, 'Volkswagen Touareg R50', 'C', 'C', 350, 2500, 'suv', 'DE', 2008, false, 0],
  [235, 'Lamborghini Revuelto', 'X', 'S', 1015, 1772, 'super', 'IT', 2024, false, 1, 'X = a collection reward; a series car belongs in S (IT case)'],
  [236, 'Lamborghini Murciélago LP640', 'S', 'A', 640, 1665, 'super', 'IT', 2007, false, 2, 'the Countach / Testarossa are A; its generation too'],
  [237, 'Ferrari 812 Superfast', 'S', 'S', 800, 1630, 'super', 'IT', 2018, false, 1],
  [238, 'McLaren 765LT', 'S', 'S', 765, 1339, 'super', 'GB', 2021, false, 1],
  [239, 'Bugatti Tourbillon', 'X', 'X', 1800, 1995, 'super', 'FR', 2026, false, 3, 'proposal: the Season 3 pass car or the reward for «Уся колекція» (open decision)'],
  [240, 'Koenigsegg Gemera', 'S', 'S', 1700, 1880, 'super', 'SE', 2025, false, 1],
].map(([n, name, clsDavid, cls, hp, kg, body, country, year, ev, prestige, why]) => ({ n, id: S.slug(name), name, clsDavid, cls, hp, kg, body, country, year, ev, prestige, why: why || '' }));

// Price of a coming car: between its two neighbours in its class by score (log-interpolated), the same rule as LATE_RAW.
// The score is shared.js's: power-to-weight scaled 0…1 inside the class + PRESTIGE_STEP × prestige.
const ROSTER = [...S.ALL_MODELS, ...Object.values(S.PENDING_MODELS)].filter((m) => !m.secret && !m.edition);
export function comingPrice(c, X_VALUE = 2e9) {
  if (c.cls === 'X') return X_VALUE;
  const rows = ROSTER.filter((m) => m.cls === c.cls);
  const pw = (m) => Math.log(m.hp / m.kg);
  const lo = Math.min(...rows.map(pw)), hi = Math.max(...rows.map(pw));
  const score = (m) => (hi > lo ? (pw(m) - lo) / (hi - lo) : 0) + S.PRESTIGE_STEP * (m.prestige || 0);
  const ladder = rows.map((m) => ({ s: score(m), price: m.price })).sort((a, b) => a.s - b.s || a.price - b.price);
  const sc = score(c);
  const k = ladder.findIndex((x) => x.s > sc);
  if (k === 0) return ladder[0].price;
  if (k < 0) return ladder[ladder.length - 1].price;
  const a = ladder[k - 1], b = ladder[k], t = b.s > a.s ? (sc - a.s) / (b.s - a.s) : 0.5;
  return Math.round((a.price * Math.pow(b.price / a.price, t)) / 1000) * 1000;
}
