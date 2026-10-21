// Builds docs/car-prompts.txt: one numbered, self-contained image prompt per car, all in the same style.
// Run: npm run prompts   (re-run after adding cars)
// Numbers are permanent: a car already in the file keeps its number and its prompt text (raw-cars/<number>.png is
// matched by that number, and prompts may have been fixed by hand). A car not yet in the file — also one from NEW_RAW
// still waiting for its photo — gets the next free number. To regenerate one car's prompt, delete its block first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_MODELS, PENDING_MODELS } from '../public/shared.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Latin names help image models recognise Soviet/Ukrainian cars (and pin down the generation of the others).
const LATIN = {
  'zaz-965-horbatyi': 'ZAZ-965 Zaporozhets "Humpback" Soviet microcar', 'zaz-968m-zaporozhets': 'ZAZ-968M Zaporozhets Soviet small car with side air intakes',
  'zaz-1102-tavriia': 'ZAZ-1102 Tavria Ukrainian 3-door hatchback', 'zaz-1103-slavuta': 'ZAZ-1103 Slavuta Ukrainian 5-door liftback',
  'vaz-2101-kopiika': 'VAZ-2101 Lada Zhiguli', 'vaz-2106': 'VAZ-2106 Lada', 'vaz-2107': 'VAZ-2107 Lada', 'vaz-2109': 'VAZ-2109 Lada Samara',
  'moskvych-412': 'Moskvich-412', 'haz-24-volha': 'GAZ-24 Volga', 'zaz-lanos': 'ZAZ Lanos (Daewoo Lanos)', 'zaz-sens': 'ZAZ Sens',
  'vaz-2121-nyva': 'VAZ-2121 Lada Niva 3-door', 'vaz-2105-vfts': 'VAZ-2105 VFTS Group B rally car with wide box arches', 'haz-24-24-volha-v8': 'GAZ-24-24 Volga V8',
  'zaz-forza': 'ZAZ Forza (Chery A13) compact hatchback', 'haz-24-95-volha-4x4': 'GAZ-24-95 Volga 4x4 (lifted all-wheel-drive Volga sedan)',
  'haz-13-chaika': 'GAZ-13 Chaika Soviet limousine', 'zil-41047': 'ZIL-41047 Soviet state limousine', 'vaz-2108-group-b': 'VAZ-2108 Lada Samara Group B rally prototype with wide arches',
  'yangwang-u9-xtreme': 'BYD Yangwang U9 Xtreme electric hypercar, track edition with big rear wing',
  // new cult cars (NEW_RAW)
  'zaz-966-vukhatyi': 'ZAZ-966 Zaporozhets Soviet small car with the big side air intakes ("ears") behind the doors',
  'luaz-969m-volyn': 'LuAZ-969M Volyn small Soviet/Ukrainian 4x4 off-roader with a canvas soft top',
  'haz-21-volha': 'GAZ-21 Volga with the chrome "whale-tooth" grille and the leaping deer on the bonnet',
  'vaz-2114': 'VAZ-2114 Lada Samara (5-door, 2010 facelift)',
  'lada-priora': 'Lada Priora (VAZ-2170)',
  'audi-100-c3-syhara': 'Audi 100 C3 (the aerodynamic "cigar" body)',
  'volkswagen-passat-b5': 'Volkswagen Passat B5.5',
  'mitsubishi-pajero-ii': 'Mitsubishi Pajero II (second generation, 5-door) with the spare wheel on the rear door',
  'toyota-camry-3-5-xv40': 'Toyota Camry XV40 3.5 V6',
  'mercedes-benz-e500-w124-vovchok': 'Mercedes-Benz E500 W124 with flared wheel arches',
  'mercedes-benz-s600-w140-kaban': 'Mercedes-Benz S600 W140, long-wheelbase version with chrome trim',
  'bmw-750i-e38-bumer': 'BMW 750iL E38, long-wheelbase version',
  'mercedes-benz-e55-amg-w210': 'Mercedes-Benz E55 AMG W210 with the twin oval headlights',
  'toyota-land-cruiser-200': 'Toyota Land Cruiser 200 V8',
  'nissan-skyline-gt-r-r32': 'Nissan Skyline GT-R R32 (BNR32)',
  'range-rover-supercharged-l322': 'Range Rover Supercharged L322',
  'dodge-charger-r-t-1970': 'Dodge Charger R/T with hidden headlights behind the full-width black grille',
  'porsche-959': 'Porsche 959', 'ferrari-testarossa': 'Ferrari Testarossa with the side strakes',
  'lamborghini-countach-lp5000-qv': 'Lamborghini Countach LP5000 Quattrovalvole (no rear wing)',
  'porsche-carrera-gt': 'Porsche Carrera GT', 'ferrari-f40': 'Ferrari F40 with its fixed rear wing', 'ferrari-enzo': 'Ferrari Enzo', 'koenigsegg-ccx': 'Koenigsegg CCX',
};
// Brand or iconic colour per car (cars not listed take the old colour rotation).
const COLOR = {
  'zaz-966-vukhatyi': 'light cream yellow', 'luaz-969m-volyn': 'bright orange with a khaki canvas top', 'haz-21-volha': 'two-tone: ivory roof and pale turquoise body',
  'vaz-2114': 'silver "Snow Queen" metallic', 'lada-priora': 'gloss black with dark tinted windows', 'audi-100-c3-syhara': 'Tornado red',
  'volkswagen-passat-b5': 'Indigo blue metallic', 'mitsubishi-pajero-ii': 'two-tone: dark green metallic upper body and silver lower body',
  'toyota-camry-3-5-xv40': 'gloss black', 'mercedes-benz-e500-w124-vovchok': 'Brilliant silver metallic', 'mercedes-benz-s600-w140-kaban': 'Obsidian black metallic',
  'bmw-750i-e38-bumer': 'Cosmos black metallic', 'mercedes-benz-e55-amg-w210': 'Tanzanite blue metallic', 'bmw-m5-e34': 'Jet black',
  'bmw-m5-e39': 'Avus blue metallic', 'toyota-land-cruiser-200': 'pearl white', 'nissan-skyline-gt-r-r32': 'Gun Grey metallic',
  'range-rover-supercharged-l322': 'Fuji white', 'dodge-charger-r-t-1970': 'gloss black', 'hummer-h2': 'bright yellow',
  'porsche-959': 'Grand Prix white', 'ferrari-testarossa': 'white', 'lamborghini-countach-lp5000-qv': 'Rosso Siviglia red',
  'porsche-carrera-gt': 'Guards red', 'ferrari-f40': 'Rosso Corsa red', 'ferrari-enzo': 'Giallo Modena yellow', 'koenigsegg-ccx': 'bright orange with exposed carbon fibre details',
};
const BODY = {
  sedan: '4-door sedan', hatch: 'hatchback', coupe: '2-door coupe', super: 'low mid-engine supercar',
  suv: 'SUV', muscle: '2-door American muscle car', wagon: 'station wagon',
};
// Cars stored as `super` that are not mid-engined (so the prompt doesn't change their shape).
const BODY_TEXT = { 'zaz-966-vukhatyi': '2-door sedan', 'porsche-959': 'rear-engine 2-door supercar with the integrated rear wing' };
const MODERN = ['glossy red', 'pearl white', 'dark blue metallic', 'silver metallic', 'gloss black', 'bright yellow', 'racing green', 'orange', 'graphite grey', 'light blue metallic'];
const SOVIET = ['beige', 'pale blue', 'white', 'cherry red', 'olive green', 'light grey', 'mustard yellow'];

export function prompt(m, i) {
  const name = LATIN[m.id] || (m.secret && m.country === 'UA' ? 'AVTODROP Prototype, a futuristic Ukrainian hypercar concept' : m.name.replace(/[«»]/g, '"'));
  let color = COLOR[m.id] || (m.country === 'UA' && !m.secret ? SOVIET : MODERN)[i % (m.country === 'UA' ? SOVIET.length : MODERN.length)];
  if (m.secret && m.country === 'UA') color = 'two-tone: blue upper half and yellow lower half (Ukrainian flag colours)';
  const condition = m.secret && m.country === 'UA' ? 'concept car' : m.ev ? 'electric car, stock factory condition, aero wheels, no exhaust pipes' : 'stock factory condition, original wheels';
  return `Photorealistic studio photo of a ${m.year} ${name}, ${BODY_TEXT[m.id] || BODY[m.body] || 'car'}, ${color} paint, ${condition}. `
    + 'Strict side view: perfect 90-degree profile, the car faces to the RIGHT, camera at wheel height, no perspective, no 3/4 angle. '
    + 'The entire car fits in the frame with empty space on all sides, wheels straight. '
    + 'Soft even studio lighting, realistic reflections, small soft shadow under the tyres. '
    + 'Plain flat light-grey background (#D9D9D9) with nothing else. '
    + 'No text, no watermark, no added logos, no licence plate, no people. Landscape 16:9.';
}

// Existing blocks of docs/car-prompts.txt: id → { num, head, prompt }.
export function readPrompts(text) {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/), out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d{3}) \| ([a-z0-9-]+) \| /.exec(lines[i]);
    if (m && lines[i + 1]?.startsWith('PROMPT: ')) out.set(m[2], { num: Number(m[1]), head: lines[i], prompt: lines[i + 1] });
  }
  return out;
}

// Catalogue order (classes D→S, then secret and season cars), the cars waiting for a photo after the others.
export const CATALOG = [...ALL_MODELS, ...Object.values(PENDING_MODELS)];

export function buildPrompts(oldText) {
  const old = readPrompts(oldText || '');
  let next = Math.max(0, ...[...old.values()].map((b) => b.num)) + 1;
  const blocks = CATALOG.map((m) => {
    const b = old.get(m.id);
    if (b) return { ...b, m };
    const num = next++;
    return { num, m, head: `${String(num).padStart(3, '0')} | ${m.id} | ${m.name} | клас ${m.cls}`, prompt: `PROMPT: ${prompt(m, num - 1)}` };
  }).sort((a, b) => a.num - b.num);
  const haveImg = new Set(fs.existsSync(path.join(ROOT, 'public', 'cars')) ? fs.readdirSync(path.join(ROOT, 'public', 'cars')).map((f) => f.replace(/\.(webp|png|jpe?g)$/i, '')) : []);
  const missing = blocks.filter(({ m }) => !haveImg.has(m.id) && !(m.img && haveImg.has(m.img)));
  const lines = [];
  lines.push('АВТОДРОП — промпти для картинок машин');
  lines.push('======================================');
  lines.push('');
  lines.push('ЯК КОРИСТУВАТИСЯ');
  lines.push('1. Копіюй промпт машини повністю (рядок після «PROMPT:») у Gemini або інший генератор.');
  lines.push('   Якщо машина вийшла не збоку або дивиться ліворуч — просто згенеруй ще раз.');
  lines.push('2. Збережи картинку в теку  C:\\Users\\vdm\\Desktop\\avtodrop\\raw-cars\\');
  lines.push('   і назви її НОМЕРОМ машини з цього файлу: 001.png, 002.jpg, 057.webp ...');
  lines.push('3. Запусти в теці гри команду:  npm run cars');
  lines.push('   Вона сама вирізає фон, обрізає, перевертає за потреби й кладе картинку в гру.');
  lines.push('   Гра підхопить нові картинки протягом 30 секунд, перезапускати нічого не треба.');
  lines.push('   НОВА машина (без фото її ще немає в грі — номери 151+) з\'явиться після перезапуску сервера');
  lines.push('   або деплою: npm run cars сам допише її в public/car-photos.js. Потім: npm run paint-masks -- <ID>.');
  lines.push('');
  lines.push('Якщо вже маєш картинку з прозорим фоном — можна покласти її одразу в');
  lines.push('C:\\Users\\vdm\\Desktop\\avtodrop\\public\\cars\\  з назвою ID машини (напр. vaz-2107.png) і запустити  npm run car-photos');
  lines.push('');
  lines.push(`Всього машин: ${blocks.length}`);
  lines.push('');
  lines.push(`БЕЗ ФОТО (${missing.length}): ${missing.map((b) => `${String(b.num).padStart(3, '0')} ${b.m.name}`).join(' · ')}`);
  lines.push('');
  for (const b of blocks) {
    lines.push('--------------------------------------------------------------------------');
    lines.push(b.head);
    lines.push(b.prompt);
  }
  lines.push('--------------------------------------------------------------------------');
  return { text: '\ufeff' + lines.join('\r\n') + '\r\n', blocks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(ROOT, 'docs', 'car-prompts.txt');
  const { text, blocks } = buildPrompts(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '');
  fs.writeFileSync(out, text);
  console.log(`written ${out} (${blocks.length} cars)`);
}
