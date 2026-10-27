// Spinning wheels in the drag race (owner 27.10: «шоб крутились колеса, або просто ілюзію»).
// Over each wheel of the car photo sits a small disc showing the same photo, cropped to that wheel and clipped to a
// circle a bit inside the tyre (WW_CROP), turned by a Web Animation whose playbackRate follows the car's speed on the
// strip — so painted cars (only the body is repainted, the wheels stay as photographed) and season liveries (the CSS
// filter is copied) spin too. Above a few turns a second the turn rate is capped (a faster turn would strobe on a 60 Hz
// screen) and trailing copies + a soft rim haze stand in for motion blur. Positions are % of the photo, so the discs
// scale with the car. Nothing here touches the race maths: it only reads the metres app.js already draws.
// Wheel data: paint/meta.json (`wheels` [[cx, cy, r] rear, front] in photo px) or, for the green-key photos that have
// none there, WW_EXTRA (found by a tyre/rim ring fit on the race photo and checked by eye). No data → no discs.
import { MODELS } from './shared.js';
import { metaOf, loadPaintMeta, paintMetaReady } from './paint.js';

export const WW_CROP = 0.86; // disc radius / tyre radius: rim + some tyre, never the arch or the ground shadow
export const WW_CAP = 2.4; // max shown turns per second (5-spoke rim: 17°/frame at 60 Hz, still reads as forward)
const PXM = 9; // screen px per metre of track (DR_PXM in app.js)

// [photo w, photo h, wheels] for photos without (usable) wheels in paint/meta.json (Volga: the rear wheel hides under
// the skirt; Bolide: meta has two 1 px dots).
export const WW_EXTRA = {
  'bugatti-bolide': [857, 343, [[155, 272.7, 72.7], [695.2, 273.7, 76.7]]],
  'audi-100-c3-syhara': [909, 364, [[207.1, 304.9, 67.4], [734.2, 301.9, 65.4]]],
  'bmw-750i-e38-bumer': [912, 365, [[198.7, 299.9, 70.6], [770.1, 299.8, 73.3]]],
  'bmw-m5-e34': [917, 367, [[209, 303.5, 70.7], [771.2, 301.4, 70.4]]],
  'bmw-m5-e39': [936, 374, [[201.7, 306.5, 73.4], [782, 304.5, 73.8]]],
  'dodge-charger-r-t-1970': [885, 354, [[210.5, 295, 56.9], [710.1, 295.9, 58.4]]],
  'ferrari-enzo': [897, 359, [[144.5, 283.1, 80.1], [687.7, 289.1, 75.6]]],
  'ferrari-f40': [875, 350, [[164.2, 278.2, 78.2], [687.4, 278.2, 75.2]]],
  'ferrari-testarossa': [890, 356, [[164.2, 284.9, 74.4], [694.2, 284.9, 75.1]]],
  'haz-21-volha': [871, 348, [[705.5, 285.7, 64.4]]],
  'hummer-h2': [982, 393, [[200.1, 310.5, 74.6], [783.9, 309.5, 73]]],
  'koenigsegg-ccx': [880, 352, [[138.9, 274.9, 83], [717.7, 278.8, 78.6]]],
  'lada-priora': [925, 370, [[200.5, 307.1, 67.3], [752.2, 304, 69.7]]],
  'lamborghini-countach-lp5000-qv': [892, 357, [[163.5, 288.4, 67.5], [702.7, 290.4, 69.9]]],
  'luaz-969m-volyn': [1018, 407, [[268.7, 335.3, 65.5], [738.7, 334.3, 67.2]]],
  'mercedes-benz-e500-w124-vovchok': [894, 358, [[197.7, 294.1, 65.9], [751, 294.1, 69.2]]],
  'mercedes-benz-e55-amg-w210': [917, 367, [[204.8, 302.5, 70], [766.2, 302.5, 70.7]]],
  'mercedes-benz-s600-w140-kaban': [908, 363, [[209.8, 301.6, 65], [769.7, 301.6, 65.7]]],
  'mitsubishi-pajero-ii': [895, 358, [[232.7, 287.4, 65], [746.8, 287.4, 65]]],
  'nissan-skyline-gt-r-r32': [863, 345, [[175.4, 281.3, 65.8], [707.8, 278.4, 71.8]]],
  'porsche-959': [872, 349, [[206.4, 280.2, 72.1], [706.4, 277.2, 76.4]]],
  'porsche-carrera-gt': [899, 360, [[154.8, 284.7, 75.5], [718.2, 286.7, 80.3]]],
  'range-rover-supercharged-l322': [876, 350, [[197.6, 269.7, 79.7], [735, 268.7, 81.2]]],
  'toyota-camry-3-5-xv40': [929, 372, [[197.3, 302.2, 75.2], [764.8, 302.2, 77.2]]],
  'toyota-land-cruiser-200': [847, 339, [[192, 258.3, 78.5], [693.5, 267.7, 74.3]]],
  'vaz-2114': [912, 365, [[168.2, 296.8, 72.6], [733.6, 296.8, 73.6]]],
  'volkswagen-passat-b5': [927, 371, [[195.7, 301.6, 75.5], [765.1, 301.6, 78.2]]],
  'zaz-966-vukhatyi': [823, 329, [[188.8, 262.4, 66.7], [674.1, 262.1, 69.9]]],
};

// A tyre is 10–30% of the photo height (the detector behind meta.json once gave 1 px dots).
export const saneWheels = (m) => !!m.wheels?.length && m.wheels.every((q) => q[2] > 0.1 * m.h && q[2] < 0.3 * m.h);

// Wheel data for a race model: its own photo's, else the photo a season livery borrows (MODELS[id].img).
export function wheelData(id, meta = metaOf) {
  for (const k of [id, MODELS[id]?.img]) {
    if (!k) continue;
    const m = meta(k);
    if (m?.w && saneWheels(m)) return { w: m.w, h: m.h, wheels: m.wheels };
    const x = WW_EXTRA[k];
    if (x) return { w: x[0], h: x[1], wheels: x[2] };
  }
  return null;
}

// One disc in % of the photo box: left/top/size of the disc, and the background (the whole photo) sized and placed
// so the wheel centre lands in the middle of the disc. r = photo-px radius of the disc.
export function wheelBox(w, h, [cx, cy, rt], k = WW_CROP) {
  const r = rt * k, d = 2 * r;
  return { left: ((cx - r) / w) * 100, top: ((cy - r) / h) * 100, size: (d / w) * 100, bgW: (w / d) * 100, bgX: ((cx - r) / (w - d)) * 100, bgY: ((cy - r) / (h - d)) * 100, r };
}

// Shown turns per second for a car at v m/s with a wheel of rPx screen px: true rolling, capped; the blur level 0–3.
export function spinOf(v, rPx) {
  const real = v > 0.05 && rPx > 0 ? (v * PXM) / (2 * Math.PI * rPx) : 0;
  return { rate: Math.min(real, WW_CAP), lvl: real <= 0 ? 0 : real < WW_CAP * 0.9 ? 1 : real < WW_CAP * 2.2 ? 2 : 3 };
}

const f = (n) => n.toFixed(3);
const KEYS = [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }];

// The race scene's wheels: mount(E) after the scene is (re)built, tick(myM, rvM) every frame with the drawn metres.
export function raceWheels(R, { reduced = false } = {}) {
  const cars = { me: { model: R.car.model }, rv: { model: R.rival.model } };
  if (reduced || typeof Element === 'undefined' || !Element.prototype.animate) return { mount() {}, tick() {} };
  let last = 0;
  function build(who, bod) {
    const c = cars[who];
    bod.querySelector(':scope > .ww')?.remove();
    c.wheels = [];
    c.lvl = -1;
    c.m = null;
    const img = bod.querySelector('img');
    const d = img && wheelData(c.model);
    if (!d) return;
    const src = img.currentSrc || img.getAttribute('src');
    if (!src) return;
    const el = document.createElement('div');
    el.className = 'ww';
    el.style.aspectRatio = `${d.w} / ${d.h}`;
    if (img.style.filter) el.style.filter = img.style.filter;
    el.innerHTML = d.wheels.map((q) => {
      const b = wheelBox(d.w, d.h, q);
      return `<i class="ww-w" style="left:${f(b.left)}%;top:${f(b.top)}%;width:${f(b.size)}%;background-size:${f(b.bgW)}% auto;background-position:${f(b.bgX)}% ${f(b.bgY)}%"></i><b class="ww-g" style="left:${f(b.left)}%;top:${f(b.top)}%;width:${f(b.size)}%"></b>`;
    }).join('');
    // The photo URL goes in through CSSOM (a painted car's src can be a long blob/data URL; quotes stay safe).
    el.querySelectorAll('.ww-w').forEach((w) => (w.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`));
    bod.appendChild(el);
    c.el = el;
    c.W = bod.offsetWidth; // fixed in CSS (146 / 112 px): read once here, never in the frame loop
    c.rel = d.wheels.map((q) => (q[2] * WW_CROP) / d.w); // disc radius as a share of the car's width
    c.wheels = [...el.querySelectorAll('.ww-w')].map((w, i) => ({ a: w.animate(KEYS, { duration: 1000, iterations: Infinity }), rate: -1, rel: c.rel[i], rear: i === 0 && d.wheels.length > 1 }));
    c.wheels.forEach((w) => (w.a.playbackRate = 0, w.rate = 0));
    // A photo that changed size since the wheel data was taken: no discs rather than discs in the wrong place.
    const check = () => img.naturalWidth && Math.abs(img.naturalWidth / img.naturalHeight - d.w / d.h) > 0.02 && (el.remove(), (c.wheels = []));
    img.complete ? check() : img.addEventListener('load', check, { once: true });
  }
  const mount = (E) => {
    const go = () => (build('me', E.meB), build('rv', E.rvB));
    go();
    if (!paintMetaReady()) loadPaintMeta().then(() => E.meB.isConnected && paintMetaReady() && go());
  };
  return {
    mount,
    tick(myM, rvM) {
      const now = performance.now(), dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      for (const [who, m] of [['me', myM], ['rv', rvM]]) {
        const c = cars[who];
        if (!c.wheels?.length) continue;
        if (c.m == null) (c.m = m, c.v = 0);
        if (dt > 0) {
          const v = Math.max(0, (m - c.m) / dt);
          c.v += (v - c.v) * Math.min(1, dt * 12);
          if (m === c.m && v === 0) c.v *= 0.8; // stopped (start line, or a frame without movement)
        }
        c.m = m;
        if (c.v > 0.05 && c.go == null) c.go = now;
        let lvl = 0;
        for (const w of c.wheels) {
          const s = spinOf(c.v < 0.05 ? 0 : c.v, w.rel * c.W);
          // Launch: the rear wheel spins up first (the burnout smoke is already there).
          const rate = w.rear && c.go != null && now - c.go < 450 ? Math.max(s.rate, WW_CAP) : s.rate;
          lvl = Math.max(lvl, s.lvl);
          if (rate === 0 ? w.rate !== 0 : Math.abs(rate - w.rate) > 0.06 * Math.max(rate, w.rate)) {
            w.rate = rate;
            if (w.a.updatePlaybackRate) w.a.updatePlaybackRate(rate);
            else w.a.playbackRate = rate;
          }
        }
        if (lvl !== c.lvl) (c.lvl = lvl, c.el.dataset.s = String(lvl));
      }
    },
  };
}
