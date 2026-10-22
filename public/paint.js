// Paint 2.0 renderer: recolours only the car's body on its photo and draws liveries on it.
// Inputs: the photo (public/cars/<id>.webp) and its body mask + numbers (public/paint/<id>.png, meta.json), both made
// offline by `npm run paint-masks` (tools/paint — the review sheets there use the same maths as this file).
// The body's own lightness (p2/p50/p98) is mapped onto the target colour's tone range, so shading, panel lines and
// reflections stay; wheels, glass, lights, chrome and black plastic are outside the mask and stay as photographed.
// Results are cached per car+look as object URLs (data: URLs where blobs fail), rendered one at a time between frames
// so a garage full of painted cars still scrolls smoothly. Anything missing (mask, canvas) → the plain photo.
// Green key cars (meta.base, `npm run green-cars` / tools/paint/green.py): the game shows the photo baked in the factory
// colour; a look is rendered from the green original public/cars/base/<id>.webp (key tone curve, green spill outside
// the body neutralised), and a livery without a paint sits on the factory colour (meta.factory, two-tone included).
import * as S from './shared.js';

let META = null;
let metaP = null;
let photoOf = (id) => `cars/${id}.webp`;
export function setPhotoSource(fn) {
  photoOf = fn;
}
export function loadPaintMeta() {
  metaP ||= fetch('paint/meta.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => (META = m))
    .catch(() => null);
  return metaP;
}
export const paintMetaReady = () => !!META;
// For the dirt layer (dirt.js): a car's mask entry, its mask URL and the photo the game shows.
export const metaOf = (id) => META?.cars?.[id] || null;
export const maskUrl = (id) => `paint/${id}.png?v=${META?.v || ''}`;
export const photoUrl = (id) => photoOf(id);
export const canPaint = (id) => !!(META?.cars?.[id]?.w && !META.cars[id].off);
// Green key cars (meta.base, made by `npm run green-cars`): paint starts from the green original in public/cars/base,
// not from the photo the game shows (that one is baked in the factory colour); other cars paint their own photo.
export const paintSource = (id, meta, photo = photoOf) => (meta?.base ? `cars/base/${id}.webp?v=${meta.base}` : photo(id));
// The colour(s) a look puts on the body: the chosen paint, or for a key car without one its factory colour (as baked).
export function lookPaints(look, meta) {
  const pc = S.PAINT_BY_ID[look?.paint];
  if (pc) return { pc, two: null };
  const f = meta?.base ? meta.factory : null;
  return { pc: f || null, two: f?.two || null };
}

// "model|paint|livery|n" — what an <img data-look> asks for; null for a factory car.
export function lookKey(model, look) {
  if (!look || (!look.paint && !look.livery)) return null;
  return `${model}|${look.paint || ''}|${look.livery || ''}|${look.livery === 'race' ? look.n || 0 : ''}`;
}
const done = new Map(); // key → url (or null: could not render, keep the photo)
export const cachedLook = (key) => done.get(key);

// ---------- colour maths (sRGB ↔ CIE Lab, D65) ----------
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
function rgb2lab(r, g, b) {
  r = LIN[r]; g = LIN[g]; b = LIN[b];
  const x = fLab((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = fLab(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = fLab((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const fInv = (f) => (f * f * f > 216 / 24389 ? f * f * f : (116 * f - 16) / (24389 / 27));
const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function lab2rgb(L, a, b, out, o) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = fInv(fx) * 0.95047, Y = fInv(fy), Z = fInv(fz) * 1.08883;
  out[o] = 255 * gam(cl01(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z));
  out[o + 1] = 255 * gam(cl01(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z));
  out[o + 2] = 255 * gam(cl01(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z));
}
const hexLab = (h) => rgb2lab(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));

// Same as tools/paint/recolor.py shade_lab(): source lightness → target colour with the photo's shading.
const Q = 4; // lightness steps per unit in the lookup tables (0..100 → 401 entries)
// Green key photos only (recolor.py key_curve): [mid, gamma above the median, gamma below] for a target lightness —
// deep blacks with bright reflections, whites with a gloss highlight range and lifted shadows.
export function keyCurve(Tl) {
  return [Tl > 70 ? Tl - (Tl - 70) * 0.35 : Tl, Tl < 45 ? 1 + (1.5 * (45 - Tl)) / 45 : 1, Tl > 60 ? 1 - (0.45 * (Tl - 60)) / 40 : 1];
}
export function shadeLut(T, p, finish, soft = false, key = false) {
  const [p2, p50, p98] = p;
  let Tl = T[0];
  const lo = Math.max(2, Tl - Math.min(0.62 * Tl, 38)), hi = Math.min(99, Tl + (100 - Tl) * 0.8);
  const [kMid, gUp, gDn] = key ? keyCurve(Tl) : [Tl, 1, 1];
  Tl = kMid;
  const lut = new Uint8ClampedArray(101 * Q * 3 + 3);
  for (let q = 0; q <= 100 * Q; q++) {
    const l = q / Q;
    let Ln = l < p50 ? lo + (Tl - lo) * Math.pow(cl01((l - p2) / Math.max(1, p50 - p2)), gDn) : Tl + (hi - Tl) * Math.pow(cl01((l - p50) / Math.max(1, p98 - p50)), gUp);
    // dark photo, light colour: the photo's deep shadows are mostly noise, so they're flattened a bit
    if (soft && Tl > 60 && Ln < Tl) Ln = Tl - (Tl - Ln) * 0.7;
    if (finish === 'matte') Ln = Tl + (Ln - Tl) * (Ln > Tl ? 0.35 : 0.8);
    else if (finish === 'metallic') Ln = Math.min(99, Math.max(1, Tl + (Ln - Tl) * (Ln > Tl ? 1.1 : 1.15)));
    const up = cl01((Ln - Tl) / Math.max(hi - Tl, 1)), dn = cl01((Tl - Ln) / Math.max(Tl - lo, 1));
    const s = finish === 'matte' ? 1 - 0.15 * dn : finish === 'metallic' ? (1 - 0.7 * Math.pow(up, 1.1)) * (1 - 0.15 * dn) : (1 - 0.8 * Math.pow(up, 1.3)) * (1 - 0.25 * dn);
    lab2rgb(Ln, T[1] * s, T[2] * s, lut, q * 3);
  }
  return lut;
}

// ---------- loading ----------
const loadImg = (src) => new Promise((res, rej) => {
  const i = new Image();
  i.decoding = 'async';
  i.onload = () => res(i);
  i.onerror = rej;
  i.src = src;
});
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
// Per car: photo pixels, mask (0..255) and quantised body lightness. A few are kept for the paint screen's preview.
const prepared = new Map();
async function prepare(id) {
  if (prepared.has(id)) {
    const p = prepared.get(id);
    prepared.delete(id);
    prepared.set(id, p);
    return p;
  }
  const job = (async () => {
    await loadPaintMeta();
    const meta = META?.cars?.[id];
    if (!meta?.w || meta.off) return null;
    const [photo, mask] = await Promise.all([loadImg(paintSource(id, meta)), loadImg(`paint/${id}.png?v=${META.v}`)]);
    const w = photo.naturalWidth, h = photo.naturalHeight;
    if (w !== meta.w || h !== meta.h) return null; // photo changed after the mask was made
    const c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(photo, 0, 0);
    const src = x.getImageData(0, 0, w, h);
    x.clearRect(0, 0, w, h);
    x.drawImage(mask, 0, 0, w, h);
    const md = x.getImageData(0, 0, w, h).data;
    const n = w * h, M = new Uint8Array(n), Lq = new Uint16Array(n), Lf = new Float32Array(n), s = src.data;
    const dark = meta.dark;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const m = md[o];
      if (!m) continue;
      M[i] = m;
      let L = 116 * fLab(0.2126729 * LIN[s[o]] + 0.7151522 * LIN[s[o + 1]] + 0.072175 * LIN[s[o + 2]]) - 16;
      if (dark) { // crushed-black photo: soft studio gradient where the paint is near-black (recolor.py adjusted_L)
        const yn = cl01((((i / w) | 0) - dark[0]) / Math.max(dark[1] - dark[0], 1));
        L += (1 - cl01(L / 30)) * (6 + 18 * Math.pow(1 - yn, 1.5));
      }
      Lf[i] = L;
    }
    // green key photo: green spill outside the body (edges, reflections in glass and chrome) → neutral (green.py despill)
    if (meta.base) for (let i = 0, o = 0; i < n; i++, o += 4) if (M[i] < 255) { const c = Math.max(s[o], s[o + 2]); if (s[o + 1] > c) s[o + 1] = c; }
    // dark photos are noisy in the shadows: smooth the body lightness a little (mask-weighted 5×5 box, as recolor.py)
    const Ls = meta.p[1] < 30 ? smoothBody(Lf, M, w, h, 2) : Lf;
    for (let i = 0; i < n; i++) if (M[i]) Lq[i] = Math.max(0, Math.min(100 * Q, Math.round(Ls[i] * Q)));
    return { id, w, h, src, M, Lq, meta };
  })();
  prepared.set(id, job);
  while (prepared.size > 4) prepared.delete(prepared.keys().next().value);
  return job.catch(() => (prepared.delete(id), null));
}

function smoothBody(L, M, w, h, r) {
  const tmpV = new Float32Array(w * h), tmpW = new Float32Array(w * h), outV = new Float32Array(w * h), outW = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { // horizontal
    let sv = 0, sw = 0;
    const row = y * w;
    for (let x = -r; x < w + r; x++) {
      const a = x + r, b = x - r - 1;
      if (a < w && a >= 0 && M[row + a]) { sv += L[row + a]; sw++; }
      if (b >= 0 && b < w && M[row + b]) { sv -= L[row + b]; sw--; }
      if (x >= 0 && x < w) { tmpV[row + x] = sv; tmpW[row + x] = sw; }
    }
  }
  for (let x = 0; x < w; x++) { // vertical
    let sv = 0, sw = 0;
    for (let y = -r; y < h + r; y++) {
      const a = y + r, b = y - r - 1;
      if (a < h && a >= 0) { sv += tmpV[a * w + x]; sw += tmpW[a * w + x]; }
      if (b >= 0 && b < h) { sv -= tmpV[b * w + x]; sw -= tmpW[b * w + x]; }
      if (y >= 0 && y < h) { outV[y * w + x] = sv; outW[y * w + x] = sw; }
    }
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = M[i] && outW[i] > 0 ? outV[i] / outW[i] : L[i];
  return out;
}

// ---------- liveries: a colour layer on the body, shaded like the paint ----------
function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function blurNorm(f, w, h, r) {
  const o = new Float32Array(f.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, k = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += f[yy * w + xx]; k++; }
    }
    o[y * w + x] = s / k;
  }
  let mn = 1, mx = 0;
  for (const v of o) { if (v < mn) mn = v; if (v > mx) mx = v; }
  for (let i = 0; i < o.length; i++) o[i] = (o[i] - mn) / (mx - mn || 1);
  return o;
}
function liveryLayer(car, kind, num, lightPaint) {
  const { w, h, meta } = car;
  const c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  const ws = meta.wheels, [rx, , rr] = ws[0], [fx, , fr] = ws[ws.length - 1];
  const ground = Math.max(...ws.map((q) => q[1] + q[2])), top = meta.top, H = ground - top;
  if (kind === 'stripes') {
    const y = top + H * 0.5, t = H * 0.045;
    x.fillStyle = lightPaint ? '#17191d' : '#f4f4f4';
    x.fillRect(0, y - t, w, 2 * t);
    x.fillStyle = '#c8102e';
    x.fillRect(0, y + t * 1.6, w, t * 0.7);
  } else if (kind === 'race') {
    const cx = (rx + fx) / 2, cy = top + H * 0.58, R = ((rr + fr) / 2) * 0.6;
    x.fillStyle = lightPaint ? '#c8102e' : '#f4f4f4';
    x.fillRect(0, cy - R * 0.32, w, R * 0.64);
    x.fillStyle = '#f7f7f7';
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#111';
    x.font = `800 ${Math.round(R * 1.15)}px "Fira Sans Condensed", Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(num || 7), cx, cy + R * 0.06);
  } else if (kind === 'ua') {
    const y = top + H * 0.5;
    x.fillStyle = '#0057b7'; x.fillRect(0, 0, w, y);
    x.fillStyle = '#ffd500'; x.fillRect(0, y, w, h - y);
  } else if (kind === 'camo') {
    const cols = ['#4b5320', '#6b6b3a', '#2f3322', '#8a7f5a'];
    const cell = Math.max(4, Math.round(w / 150)), rnd = mulberry(3);
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const fields = [0, 1, 2].map(() => blurNorm(Float32Array.from({ length: gw * gh }, rnd), gw, gh, 2));
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const k = gy * gw + gx;
      let best = 3, bv = 0.52;
      fields.forEach((f, j) => { if (f[k] > bv) { bv = f[k]; best = j; } });
      x.fillStyle = cols[best];
      x.fillRect(gx * cell, gy * cell, cell, cell);
    }
  } else if (/^szn\d+g?$/.test(kind)) {
    // Season livery (pass reward): the lower body in the season colour under a neon line, «S<n>» on the door.
    const gold = kind.endsWith('g'), n = kind.replace(/\D/g, '');
    const y = top + H * 0.56, t = Math.max(2, H * 0.035);
    x.fillStyle = gold ? '#c9a227' : '#3b1d7a';
    x.fillRect(0, y, w, h - y);
    x.fillStyle = gold ? '#151515' : '#ffc400';
    x.fillRect(0, y - t, w, t);
    const cx = (rx + fx) / 2, cy = top + H * 0.42, bw = H * 0.5, bh = H * 0.3;
    x.fillStyle = gold ? '#151515' : '#ffc400';
    x.beginPath();
    x.roundRect ? x.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, bh * 0.22) : x.rect(cx - bw / 2, cy - bh / 2, bw, bh);
    x.fill();
    x.fillStyle = gold ? '#e8c34a' : '#1a0f33';
    x.font = `800 ${Math.round(bh * 0.78)}px "Fira Sans Condensed", Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('S' + n, cx, cy + bh * 0.04);
  } else if (kind === 'fade') {
    // 32 bands instead of a smooth gradient: few distinct colours → one shading table each
    const a = [0xff, 0x5f, 0x1f], b = [0x7b, 0x1f, 0xa2], x0 = meta.x0, x1 = meta.x1, n = 32;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      x.fillStyle = `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * t)).join(',')})`;
      const xa = k === 0 ? 0 : x0 + ((x1 - x0) * k) / n, xb = k === n - 1 ? w : x0 + ((x1 - x0) * (k + 1)) / n;
      x.fillRect(Math.floor(xa), 0, Math.ceil(xb - xa) + 1, h);
    }
  } else if (kind === 'xneon') {
    // «Стиль» · Нічний неон: a near-black body, a cyan neon line along the sill with a magenta one under it, a thin
    // cyan line on the shoulder.
    x.fillStyle = '#14151f'; x.fillRect(0, 0, w, h);
    const t = Math.max(2, H * 0.03);
    x.fillStyle = '#00e5ff'; x.fillRect(0, top + H * 0.62, w, t);
    x.fillStyle = '#ff2bd6'; x.fillRect(0, top + H * 0.62 + t * 1.8, w, t * 0.7);
    x.fillStyle = '#00e5ff'; x.fillRect(0, top + H * 0.36, w, Math.max(1, t * 0.5));
  } else if (kind === 'xcarbon') {
    // «Стиль» · Карбон: a 2×2 twill weave in two dark greys, a thin red pinstripe.
    const c = Math.max(3, Math.round(w / 110));
    for (let gy = 0; gy * c < h; gy++) for (let gx = 0; gx * c < w; gx++) {
      x.fillStyle = ((gx + gy) >> 1) & 1 ? '#2e3138' : '#1b1d22';
      x.fillRect(gx * c, gy * c, c, c);
    }
    x.fillStyle = '#d0142c'; x.fillRect(0, top + H * 0.5, w, Math.max(1, H * 0.012));
  } else if (kind === 'xchrome') {
    // «Стиль» · Chrome: mirror bands — light sky on top, the dark horizon at the waist, the bright ground reflection low.
    const stops = [[0, [242, 245, 249]], [0.42, [150, 158, 170]], [0.5, [52, 58, 70]], [0.58, [196, 202, 212]], [1, [120, 128, 140]]];
    const n = 28;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      let i = 0;
      while (i < stops.length - 2 && f > stops[i + 1][0]) i++;
      const [f0, a] = stops[i], [f1, b] = stops[i + 1], u = Math.min(1, Math.max(0, (f - f0) / (f1 - f0)));
      x.fillStyle = `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * u)).join(',')})`;
      const ya = k === 0 ? 0 : top + (H * k) / n, yb = k === n - 1 ? h : top + (H * (k + 1)) / n;
      x.fillRect(0, Math.floor(ya), w, Math.ceil(yb - ya) + 1);
    }
  }
  return x.getImageData(0, 0, w, h).data;
}

// ---------- render ----------
function paintPixels(car, look) {
  const { w, h, src, M, Lq, meta } = car;
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h);
  const d = out.data, s = src.data;
  const keyBase = !!meta.base;
  const { pc, two } = lookPaints(look, meta);
  const finish = pc?.finish || 'gloss';
  const soft = meta.p[1] < 30;
  const lut = pc ? shadeLut(hexLab(pc.hex), meta.p, finish, soft, keyBase) : null;
  // two-tone factory paint: the second colour on the rows above / below the split (one anti-aliased row at the seam)
  const lut2 = two ? shadeLut(hexLab(two.hex), meta.p, two.finish || finish, soft, keyBase) : null;
  const ground = Math.max(...meta.wheels.map((q) => q[1] + q[2]));
  const ySplit = two ? meta.top + (ground - meta.top) * two.at : 0;
  const flake = finish === 'metallic' || two?.finish === 'metallic';
  const lightPaint = pc ? hexLab(pc.hex)[0] > 70 : meta.p[1] > 70;
  const lay = look.livery && S.LIVERY_BY_ID[look.livery] ? liveryLayer(car, look.livery, look.n, lightPaint) : null;
  const luts = new Map();
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const m = M[i];
    if (!m) continue;
    const q = Lq[i];
    let r = s[o], g = s[o + 1], b = s[o + 2];
    if (lut) {
      r = lut[q * 3]; g = lut[q * 3 + 1]; b = lut[q * 3 + 2];
      if (lut2) {
        const t = cl01(((i / w) | 0) - ySplit + 0.5), u = two.side === 'below' ? t : 1 - t;
        if (u) { r += (lut2[q * 3] - r) * u; g += (lut2[q * 3 + 1] - g) * u; b += (lut2[q * 3 + 2] - b) * u; }
      }
      if (flake) { // metallic flake: a fine ±3% sparkle on the result
        const f = 1 + ((((i * 2654435761) >>> 0) & 255) / 255 - 0.5) * 0.06;
        r *= f; g *= f; b *= f;
      }
    }
    if (lay && lay[o + 3]) {
      const key = ((lay[o] >> 2) << 12) | ((lay[o + 1] >> 2) << 6) | (lay[o + 2] >> 2);
      let lt = luts.get(key);
      if (!lt) luts.set(key, (lt = shadeLut(rgb2lab(lay[o], lay[o + 1], lay[o + 2]), meta.p, finish, soft, keyBase)));
      const a = lay[o + 3] / 255;
      r = r * (1 - a) + lt[q * 3] * a; g = g * (1 - a) + lt[q * 3 + 1] * a; b = b * (1 - a) + lt[q * 3 + 2] * a;
    }
    const k = m / 255;
    d[o] = s[o] * (1 - k) + r * k; d[o + 1] = s[o + 1] * (1 - k) + g * k; d[o + 2] = s[o + 2] * (1 - k) + b * k;
  }
  return out;
}
const toUrl = (c) => new Promise((res) => {
  const data = () => { try { res(c.toDataURL('image/webp', 0.9)); } catch { res(null); } };
  if (!c.toBlob || typeof URL.createObjectURL !== 'function') return data();
  try {
    c.toBlob((b) => (b ? res(URL.createObjectURL(b)) : data()), 'image/webp', 0.9);
  } catch {
    data();
  }
});

// One render at a time, a frame apart.
let chain = Promise.resolve();
const pending = new Map();
const nextFrame = () => new Promise((r) => (typeof requestAnimationFrame === 'function' && !document.hidden ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 16)));
export function renderLook(model, look) {
  const key = lookKey(model, look);
  if (!key) return Promise.resolve(null);
  if (done.has(key)) return Promise.resolve(done.get(key));
  if (pending.has(key)) return pending.get(key);
  const p = (chain = chain.then(nextFrame).then(async () => {
    let url = null;
    try {
      const car = await prepare(model);
      if (car) {
        const c = canvas(car.w, car.h);
        c.getContext('2d').putImageData(paintPixels(car, look), 0, 0);
        url = await toUrl(c);
      }
    } catch {
      url = null;
    }
    done.set(key, url);
    pending.delete(key);
    return url;
  }));
  pending.set(key, p);
  return p;
}
export function parseKey(key) {
  const [model, paint, livery, n] = String(key).split('|');
  return { model, look: { paint: paint || null, livery: livery || null, n: Number(n) || 0 } };
}

// Every <img data-look="key"> in the page gets its painted picture once it's ready (watching the DOM, so screens
// don't have to call anything). The plain photo shows meanwhile and stays if the render fails.
function hydrate(root) {
  const imgs = root.querySelectorAll ? root.querySelectorAll('img[data-look]') : [];
  for (const img of imgs) {
    const key = img.dataset.look;
    if (img.dataset.painted === key) continue;
    img.dataset.painted = key;
    const url = done.get(key);
    if (url) {
      img.src = url;
      continue;
    }
    if (done.has(key)) continue;
    const { model, look } = parseKey(key);
    renderLook(model, look).then((u) => {
      if (u && img.dataset.look === key) img.src = u;
    });
  }
}
export function watchLooks(root = document.body) {
  loadPaintMeta();
  hydrate(root);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    // after the screen has rendered
    (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(() => {
      queued = false;
      hydrate(root);
    });
  }).observe(root, { childList: true, subtree: true });
}
