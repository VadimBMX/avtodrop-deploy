// Car artwork: a real photo from public/cars/<id>.webp when it exists, otherwise a drawn silhouette.
import { MODELS, CLASSES } from './shared.js';

let IMAGES = {};
export function setImages(map) {
  IMAGES = map || {};
}

// [body path, window path, rear wheel x, front wheel x, wheel r]
const BODIES = {
  sedan: ['M10 62 L13 49 Q16 44 30 43 L64 40 L88 27 Q93 24 101 24 L140 24 Q150 24 158 31 L171 41 L198 45 Q210 47 211 56 L211 63 Q211 66 207 66 L13 66 Q10 66 10 62Z',
    'M92 30 L101 27 L121 27 L121 40 L75 40Z M125 27 L140 27 Q147 27 153 32 L162 40 L125 40Z', 52, 168, 13],
  hatch: ['M12 62 L13 46 Q15 40 24 31 L38 25 L128 24 Q138 24 146 31 L160 41 L190 45 Q202 47 203 56 L203 63 Q203 66 199 66 L15 66 Q12 66 12 62Z',
    'M30 32 L41 28 L84 28 L84 40 L22 40Z M88 28 L127 28 Q135 28 141 33 L150 40 L88 40Z', 48, 162, 13],
  coupe: ['M10 62 L12 51 Q14 46 30 45 L70 42 L98 29 Q104 27 112 27 L138 28 Q146 29 154 35 L166 43 L200 47 Q212 49 212 58 L212 63 Q212 66 208 66 L13 66 Q10 66 10 62Z',
    'M80 41 L101 31 L120 31 L120 41Z M124 31 L137 31 Q144 32 150 36 L157 41 L124 41Z', 52, 172, 13],
  super: ['M8 61 L10 54 Q12 50 30 48 L82 44 L110 33 Q116 31 124 31 L141 32 Q151 33 161 39 L177 46 L207 50 Q215 52 215 58 L215 62 Q215 65 211 65 L11 65 Q8 65 8 61Z',
    'M94 44 L113 35 L139 35 Q148 36 156 41 L161 44Z', 52, 174, 14],
  suv: ['M10 62 L10 40 Q10 34 18 32 L40 30 L52 14 Q55 10 62 10 L150 10 Q158 10 162 16 L174 32 L200 36 Q210 38 210 48 L210 63 Q210 66 206 66 L13 66 Q10 66 10 62Z',
    'M55 31 L64 15 L100 15 L100 31Z M104 15 L148 15 Q154 15 157 19 L166 31 L104 31Z', 50, 166, 15],
  muscle: ['M8 62 L10 49 Q12 45 26 44 L58 42 L80 28 Q85 25 93 25 L124 25 Q133 25 140 31 L152 41 L202 45 Q213 47 214 56 L214 63 Q214 66 210 66 L11 66 Q8 66 8 62Z',
    'M84 31 L93 28 L108 28 L108 41 L66 41Z M112 28 L124 28 Q131 28 136 33 L143 41 L112 41Z', 50, 174, 14],
  wagon: ['M10 62 L10 44 Q10 39 16 35 L28 23 Q32 21 39 21 L140 22 Q150 22 158 30 L172 41 L198 45 Q210 47 211 56 L211 63 Q211 66 207 66 L13 66 Q10 66 10 62Z',
    'M30 36 L38 26 L82 26 L82 39 L22 39Z M86 26 L121 26 L121 39 L86 39Z M125 26 L140 26 Q147 27 153 32 L161 39 L125 39Z', 52, 168, 13],
};
const PAINTS = ['#c1121f', '#e9ecef', '#1d3557', '#457b9d', '#ffb703', '#fb8500', '#2a9d8f', '#8d99ae', '#1b1f24', '#6a4c93', '#06d6a0', '#ef476f', '#adb5bd', '#118ab2', '#9b2226', '#3d405b'];
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function svg(modelId) {
  const m = MODELS[modelId];
  const [body, win, rx, fx, r] = BODIES[m.body] || BODIES.sedan;
  const paint = m.secret && m.country === 'UA' ? 'url(#ua)' : PAINTS[hash(modelId) % PAINTS.length];
  const id = 'g' + (hash(modelId) % 1e6);
  const wheel = (x) => `<circle cx="${x}" cy="66" r="${r}" fill="#0b0b0b"/><circle cx="${x}" cy="66" r="${r * 0.58}" fill="#a3acb7"/><circle cx="${x}" cy="66" r="${r * 0.2}" fill="#2b2b2b"/>`;
  return `<svg viewBox="0 0 220 84" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></linearGradient>
<linearGradient id="ua" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="#0057b7"/><stop offset=".5" stop-color="#ffd500"/></linearGradient></defs>
<ellipse cx="110" cy="79" rx="100" ry="4" fill="#000" opacity=".5"/>
<path d="${body}" fill="${paint}"/><path d="${body}" fill="url(#${id})"/>
<path d="${win}" fill="#0b1119" opacity=".9"/>
<rect x="${fx + 22}" y="47" width="10" height="4" rx="2" fill="#fff7c2"/><rect x="12" y="49" width="6" height="4" rx="2" fill="#ff3b3b"/>
${wheel(rx)}${wheel(fx)}</svg>`;
}

export function carArt(modelId, { glow = false, silhouette = false } = {}) {
  const m = MODELS[modelId];
  if (!m) return '';
  const style = glow ? ` style="--c:${CLASSES[m.cls].color}"` : '';
  const cls = [glow ? 'glow' : '', silhouette ? 'silhouette' : ''].join(' ');
  // Season liveries use another model's photo through a paint filter (MODELS[id].img / .filter).
  const src = IMAGES[modelId] || (m.img && IMAGES[m.img]);
  if (src) {
    const st = [glow ? `--c:${CLASSES[m.cls].color}` : '', m.filter ? `filter:${m.filter}${glow ? ' drop-shadow(0 0 14px var(--c))' : ''}` : ''].filter(Boolean).join(';');
    return `<img src="${src}" alt="" class="${cls}"${st ? ` style="${st}"` : ''} loading="lazy" draggable="false">`;
  }
  return svg(modelId).replace('<svg ', `<svg class="${cls}"${style} `);
}
