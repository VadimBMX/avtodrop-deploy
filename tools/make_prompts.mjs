// Builds docs/car-prompts.txt: one numbered, self-contained image prompt per car, all in the same style.
// Run: npm run prompts   (re-run after adding cars; numbers follow the order of MODELS in public/shared.js)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_MODELS } from '../public/shared.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Latin names help image models recognise Soviet/Ukrainian cars.
const LATIN = {
  'zaz-965-horbatyi': 'ZAZ-965 Zaporozhets "Humpback" Soviet microcar', 'zaz-968m-zaporozhets': 'ZAZ-968M Zaporozhets Soviet small car with side air intakes',
  'zaz-1102-tavriia': 'ZAZ-1102 Tavria Ukrainian 3-door hatchback', 'zaz-1103-slavuta': 'ZAZ-1103 Slavuta Ukrainian 5-door liftback',
  'vaz-2101-kopiika': 'VAZ-2101 Lada Zhiguli', 'vaz-2106': 'VAZ-2106 Lada', 'vaz-2107': 'VAZ-2107 Lada', 'vaz-2109': 'VAZ-2109 Lada Samara',
  'moskvych-412': 'Moskvich-412', 'haz-24-volha': 'GAZ-24 Volga', 'zaz-lanos': 'ZAZ Lanos (Daewoo Lanos)', 'zaz-sens': 'ZAZ Sens',
  'vaz-2121-nyva': 'VAZ-2121 Lada Niva 3-door', 'vaz-2105-vfts': 'VAZ-2105 VFTS Group B rally car with wide box arches', 'haz-24-24-volha-v8': 'GAZ-24-24 Volga V8',
  'zaz-forza': 'ZAZ Forza (Chery A13) compact hatchback', 'haz-24-95-volha-4x4': 'GAZ-24-95 Volga 4x4 (lifted all-wheel-drive Volga sedan)',
  'haz-13-chaika': 'GAZ-13 Chaika Soviet limousine', 'zil-41047': 'ZIL-41047 Soviet state limousine', 'vaz-2108-group-b': 'VAZ-2108 Lada Samara Group B rally prototype with wide arches',
  'yangwang-u9-xtreme': 'BYD Yangwang U9 Xtreme electric hypercar, track edition with big rear wing',
};
const BODY = {
  sedan: '4-door sedan', hatch: 'hatchback', coupe: '2-door coupe', super: 'low mid-engine supercar',
  suv: 'SUV', muscle: '2-door American muscle car', wagon: 'station wagon',
};
const MODERN = ['glossy red', 'pearl white', 'dark blue metallic', 'silver metallic', 'gloss black', 'bright yellow', 'racing green', 'orange', 'graphite grey', 'light blue metallic'];
const SOVIET = ['beige', 'pale blue', 'white', 'cherry red', 'olive green', 'light grey', 'mustard yellow'];

function prompt(m, i) {
  const name = LATIN[m.id] || (m.secret && m.country === 'UA' ? 'AVTODROP Prototype, a futuristic Ukrainian hypercar concept' : m.name.replace(/[«»]/g, '"'));
  let color = (m.country === 'UA' && !m.secret ? SOVIET : MODERN)[i % (m.country === 'UA' ? SOVIET.length : MODERN.length)];
  if (m.secret && m.country === 'UA') color = 'two-tone: blue upper half and yellow lower half (Ukrainian flag colours)';
  const condition = m.secret && m.country === 'UA' ? 'concept car' : m.ev ? 'electric car, stock factory condition, aero wheels, no exhaust pipes' : 'stock factory condition, original wheels';
  return `Photorealistic studio photo of a ${m.year} ${name}, ${BODY[m.body] || 'car'}, ${color} paint, ${condition}. `
    + 'Strict side view: perfect 90-degree profile, the car faces to the RIGHT, camera at wheel height, no perspective, no 3/4 angle. '
    + 'The entire car fits in the frame with empty space on all sides, wheels straight. '
    + 'Soft even studio lighting, realistic reflections, small soft shadow under the tyres. '
    + 'Plain flat light-grey background (#D9D9D9) with nothing else. '
    + 'No text, no watermark, no added logos, no licence plate, no people. Landscape 16:9.';
}

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
lines.push('');
lines.push('Якщо вже маєш картинку з прозорим фоном — можна покласти її одразу в');
lines.push('C:\\Users\\vdm\\Desktop\\avtodrop\\public\\cars\\  з назвою ID машини (напр. vaz-2107.png).');
lines.push('');
lines.push(`Всього машин: ${ALL_MODELS.length}`);
lines.push('');
// Cars without a photo yet come first, so it is clear what to generate.
const haveImg = new Set(fs.existsSync(path.join(ROOT, 'public', 'cars')) ? fs.readdirSync(path.join(ROOT, 'public', 'cars')).map((f) => f.replace(/\.(webp|png|jpe?g)$/i, '')) : []);
const missing = ALL_MODELS.map((m, i) => [m, i]).filter(([m]) => !haveImg.has(m.id) && !(m.img && haveImg.has(m.img)));
lines.push(`БЕЗ ФОТО (${missing.length}): ${missing.map(([m, i]) => `${String(i + 1).padStart(3, '0')} ${m.name}`).join(' · ')}`);
lines.push('');
ALL_MODELS.forEach((m, i) => {
  const n = String(i + 1).padStart(3, '0');
  lines.push('--------------------------------------------------------------------------');
  lines.push(`${n} | ${m.id} | ${m.name} | клас ${m.cls}`);
  lines.push(`PROMPT: ${prompt(m, i)}`);
});
lines.push('--------------------------------------------------------------------------');
const out = path.join(ROOT, 'docs', 'car-prompts.txt');
fs.writeFileSync(out, '\ufeff' + lines.join('\r\n') + '\r\n');
console.log(`written ${out} (${ALL_MODELS.length} cars)`);
