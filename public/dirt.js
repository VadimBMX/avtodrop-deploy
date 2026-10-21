// Dirt on the car photos (S.WASH): road dust and mud splashes near the sills and wheel arches, only on the body.
// The body is the paint mask (public/paint/<id>.png, the same one paint.js recolours with) when the car has a usable one;
// otherwise the lower part of the photo's cut-out, fading out towards the roof. The pattern is procedural and fixed per
// model, so a dirtier car keeps the same splashes and gets more. Rendered once per car look and dirt bucket (10% steps)
// to an object URL, one at a time between frames (like paint.js), so a garage of 50+ cars still scrolls smoothly.
// <img data-dirt="key"> elements (car.js carArt) get their picture swapped in once it's ready; the plain photo shows
// meanwhile. washScene() gives the hand-wash mini-game its clean car and the foam-and-mud layer to rub off.
import { loadPaintMeta, metaOf, maskUrl, photoUrl, renderLook, lookKey, parseKey } from './paint.js';

export const dirtBucket = (d) => Math.max(0, Math.min(10, Math.floor((d || 0) / 10)));
// "model|paint|livery|n~bucket" (the look part as paint.js lookKey, empty for a factory car); null when clean enough.
export function dirtKey(model, look, dirt) {
  const b = dirtBucket(dirt);
  return b < 1 ? null : `${lookKey(model, look) || `${model}|||`}~${b}`;
}
const done = new Map(); // key → url (null: could not render, keep the photo)
export const cachedDirt = (key) => done.get(key);

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
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Where the car stands on its photo: wheels [x, y, r], roof line and ground (from the paint meta, or a fair guess).
function geometry(meta, w, h) {
  const ok = meta?.wheels?.length && meta.w === w && meta.h === h;
  const wheels = ok ? meta.wheels : [[w * 0.2, h * 0.8, h * 0.17], [w * 0.8, h * 0.8, h * 0.17]];
  const ground = Math.min(h, Math.max(...wheels.map((q) => q[1] + q[2])));
  const top = ok && meta.top != null ? meta.top : h * 0.18;
  return { wheels, top, ground, x0: ok ? meta.x0 ?? 0 : 0, x1: ok ? meta.x1 ?? w : w };
}
// The body as an alpha canvas: the paint mask (grey levels → alpha), or the cut-out's lower part.
const masks = new Map();
async function bodyMask(model, photo) {
  const w = photo.naturalWidth || photo.width, h = photo.naturalHeight || photo.height;
  const k = `${model}:${w}x${h}`;
  if (masks.has(k)) return masks.get(k);
  await loadPaintMeta();
  const meta = metaOf(model);
  const c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  let ok = false;
  if (meta?.w === w && meta.h === h && !meta.off) {
    try {
      x.drawImage(await loadImg(maskUrl(model)), 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h), p = d.data;
      for (let o = 0; o < p.length; o += 4) (p[o + 3] = p[o]), (p[o] = p[o + 1] = p[o + 2] = 0);
      x.putImageData(d, 0, 0);
      ok = true;
    } catch {}
  }
  if (!ok) {
    const g = geometry(meta, w, h), H = g.ground - g.top;
    x.clearRect(0, 0, w, h);
    x.drawImage(photo, 0, 0, w, h);
    x.globalCompositeOperation = 'destination-in';
    const grad = x.createLinearGradient(0, g.top + H * 0.3, 0, g.top + H * 0.62);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = grad;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-over';
  }
  masks.set(k, c);
  while (masks.size > 6) masks.delete(masks.keys().next().value);
  return c;
}

// The dirt itself on a w×h layer: a dusty film heavier towards the ground, blotches, mud splashes thrown up around the
// wheel arches and along the sills, fine specks and a few drips. level 1..10; the same model always gets the same marks.
function drawDirt(x, model, level, w, h, g) {
  const k = Math.max(0.1, Math.min(1, level / 10)), s = w / 860, H = g.ground - g.top, span = g.x1 - g.x0;
  const R = (tag) => mulberry(hash(model + tag));
  const film = x.createLinearGradient(0, g.top, 0, g.ground);
  film.addColorStop(0, `rgba(120,98,70,${0.05 + 0.2 * k})`);
  film.addColorStop(0.55, `rgba(108,86,60,${0.1 + 0.32 * k})`);
  film.addColorStop(1, `rgba(88,66,44,${0.18 + 0.5 * k})`);
  x.fillStyle = film;
  x.fillRect(0, 0, w, h);
  // dried road dust: a light haze, what shows on dark paint (on light paint the brown above does the work)
  const dust = x.createLinearGradient(0, g.top + H * 0.25, 0, g.ground);
  dust.addColorStop(0, 'rgba(196,178,148,0)');
  dust.addColorStop(0.5, `rgba(196,178,148,${0.06 + 0.16 * k})`);
  dust.addColorStop(1, `rgba(186,166,134,${0.1 + 0.26 * k})`);
  x.fillStyle = dust;
  x.fillRect(0, 0, w, h);
  const blot = (r, n, dark) => {
    for (let i = 0; i < n; i++) {
      const px = g.x0 + r() * span, py = g.top + H * (0.3 + 0.7 * Math.pow(r(), 0.6)), rad = (18 + 55 * r()) * s, a = (0.08 + 0.22 * r()) * (0.5 + k);
      const gr = x.createRadialGradient(px, py, 0, px, py, rad);
      gr.addColorStop(0, `rgba(${dark ? '70,52,34' : '104,84,58'},${a})`);
      gr.addColorStop(1, 'rgba(90,70,48,0)');
      x.fillStyle = gr;
      x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
  };
  blot(R('b'), Math.round(8 + 34 * k), false);
  // Specks go into one path per colour and opacity step (a few fills instead of ~1500).
  const paths = new Map();
  const dot = (px, py, rad, a, col = '62,45,29') => {
    const key = `rgba(${col},${(Math.round(a * 6) / 6).toFixed(3)})`;
    let p = paths.get(key);
    if (!p) paths.set(key, (p = new Path2D()));
    const r = Math.max(0.5, rad);
    p.moveTo(px + r, py);
    p.arc(px, py, r, 0, Math.PI * 2);
  };
  const flush = () => {
    for (const [style, p] of paths) (x.fillStyle = style), x.fill(p);
    paths.clear();
  };
  // splashes around the arches: thrown up and back over the upper half of each wheel
  for (const [i, [wx, wy, wr]] of g.wheels.entries()) {
    const r = R('w' + i);
    const n = Math.round(30 + 160 * k);
    for (let j = 0; j < n; j++) {
      const th = Math.PI * (1.0 + r()), d = wr * (1.02 + 0.55 * Math.pow(r(), 1.6));
      dot(wx + Math.cos(th) * d, wy + Math.sin(th) * d * 0.9, (1 + 5.5 * Math.pow(r(), 3)) * s * (0.6 + 0.7 * k), 0.35 + 0.55 * r(), j % 4 ? '62,45,29' : '150,126,94');
    }
    blot(R('wb' + i), Math.round(2 + 6 * k), true);
  }
  // along the sills and bumpers, densest at the bottom
  {
    const r = R('s'), n = Math.round(50 + 260 * k);
    for (let j = 0; j < n; j++) dot(g.x0 + r() * span, g.ground - H * 0.42 * Math.pow(r(), 1.7), (0.9 + 4.5 * Math.pow(r(), 3)) * s * (0.6 + 0.7 * k), 0.3 + 0.6 * r(), j % 3 ? '62,45,29' : '140,116,86');
  }
  // fine dust specks all over the body
  {
    const r = R('f'), n = Math.round(120 + 700 * k);
    for (let j = 0; j < n; j++) dot(g.x0 + r() * span, g.top + H * r(), (0.5 + 1.1 * r()) * s, 0.14 + 0.3 * r(), j % 2 ? '96,78,56' : '178,160,130');
  }
  flush();
  // drips under the splashes once it's really dirty
  if (k >= 0.5) {
    const r = R('d'), n = Math.round(10 * k);
    x.lineCap = 'round';
    for (let j = 0; j < n; j++) {
      const px = g.x0 + r() * span, py = g.top + H * (0.45 + 0.3 * r()), len = (10 + 34 * r()) * s;
      x.strokeStyle = `rgba(74,56,38,${0.25 + 0.3 * r()})`;
      x.lineWidth = (1.2 + 2 * r()) * s;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + (r() - 0.5) * 2 * s, py + len);
      x.stroke();
    }
  }
}
// The dirt layer cut to the body, drawn at `scale` of the photo (the photo's own coordinates throughout).
async function dirtLayer(model, photo, level, scale = 1) {
  const w = photo.naturalWidth || photo.width, h = photo.naturalHeight || photo.height;
  const mask = await bodyMask(model, photo);
  const c = canvas(Math.round(w * scale), Math.round(h * scale)), x = c.getContext('2d');
  x.scale(scale, scale);
  drawDirt(x, model, level, w, h, geometry(metaOf(model), w, h));
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(mask, 0, 0, w, h);
  return c;
}
// The clean car as the game shows it: its paint/livery render when it has one, else the photo.
async function cleanCar(model, look) {
  const painted = lookKey(model, look) ? await renderLook(model, look) : null;
  return loadImg(painted || photoUrl(model));
}
const toUrl = (c) => new Promise((res) => {
  const data = () => { try { res(c.toDataURL('image/webp', 0.88)); } catch { res(null); } };
  if (!c.toBlob || typeof URL.createObjectURL !== 'function') return data();
  try {
    c.toBlob((b) => (b ? res(URL.createObjectURL(b)) : data()), 'image/webp', 0.88);
  } catch {
    data();
  }
});

let chain = Promise.resolve();
const pending = new Map();
// Garage pictures are kept at most this wide (a tile is ~170 CSS px, the car card ~360): less to draw and encode.
const MAX_W = 720;
const nextFrame = () => new Promise((r) => (typeof requestAnimationFrame === 'function' && !document.hidden ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 16)));
export function renderDirt(key) {
  if (done.has(key)) return Promise.resolve(done.get(key));
  if (pending.has(key)) return pending.get(key);
  const [lk, b] = key.split('~');
  const { model, look } = parseKey(lk);
  const p = (chain = chain.then(nextFrame).then(async () => {
    let url = null;
    try {
      const car = await cleanCar(model, look);
      const sc = Math.min(1, MAX_W / car.naturalWidth);
      const layer = await dirtLayer(model, car, Number(b), sc);
      await nextFrame(); // drawing the dirt and putting it on the car: two frames, not one long one
      const c = canvas(layer.width, layer.height), x = c.getContext('2d');
      x.drawImage(car, 0, 0, c.width, c.height);
      x.drawImage(layer, 0, 0);
      url = await toUrl(c);
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

function hydrate(root) {
  for (const img of root.querySelectorAll ? root.querySelectorAll('img[data-dirt]') : []) {
    const key = img.dataset.dirt;
    if (img.dataset.dirtied === key) continue;
    img.dataset.dirtied = key;
    const url = done.get(key);
    if (url) {
      img.src = url;
      continue;
    }
    if (done.has(key)) continue;
    renderDirt(key).then((u) => {
      if (u && img.dataset.dirt === key) img.src = u;
    });
  }
}
export function watchDirt(root = document.body) {
  hydrate(root);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(() => {
      queued = false;
      hydrate(root);
    });
  }).observe(root, { childList: true, subtree: true });
}

// ---------- hand wash mini-game ----------
// The clean car (an <img>) and, on a canvas of the same size, what covers it: the car's dirt (at least half-dirty, so
// there's something to wash) and thick foam over the whole cut-out. The game erases this canvas under the finger.
export async function washScene(model, look, dirt) {
  const car = await cleanCar(model, look);
  const w = car.naturalWidth, h = car.naturalHeight;
  const c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(await dirtLayer(model, car, Math.max(6, dirtBucket(dirt))), 0, 0);
  // foam: overlapping soapy bubbles, then cut to the car's outline
  const g = geometry(metaOf(model), w, h), s = w / 860, r = mulberry(hash(model + 'foam'));
  const foam = canvas(w, h), f = foam.getContext('2d');
  const n = Math.round(((g.x1 - g.x0) * (g.ground - g.top * 0.5)) / (520 * s * s));
  for (let i = 0; i < n; i++) {
    const px = g.x0 + r() * (g.x1 - g.x0), py = r() * h, rad = (9 + 20 * r()) * s;
    const gr = f.createRadialGradient(px - rad * 0.3, py - rad * 0.3, rad * 0.1, px, py, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.97)');
    gr.addColorStop(0.7, 'rgba(232,238,246,0.9)');
    gr.addColorStop(1, 'rgba(196,208,224,0.75)');
    f.fillStyle = gr;
    f.beginPath();
    f.arc(px, py, rad, 0, Math.PI * 2);
    f.fill();
  }
  f.globalCompositeOperation = 'destination-in';
  f.drawImage(car, 0, 0);
  x.globalAlpha = 0.92;
  x.drawImage(foam, 0, 0);
  x.globalAlpha = 1;
  return { car, cover: c, w, h };
}
