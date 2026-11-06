// «Ефект дропу» (r5-shop, owner 06.11): the bought case-open effect that plays when the dropped car lands on the result
// stage (S.DROPFX_ITEMS: gold · bolt · fire · chrome). No dependencies, no DOM animation but canvas opacity.
//
// Two canvases per stage: one behind the car (the far half of the turntable, the floor glow) and one in front (the
// near half, sparks, the light on the car). Every frame is a pure function of the time since the start (all particles
// are seeded up front): the same code draws the reduced-motion still, the shop preview loop and the real drop.
// Glows are pre-rendered sprites drawn with 'lighter' (no shadowBlur); the light on the car is a gradient masked by the
// car photo itself (drawImage + destination-in on a small offscreen canvas). One rAF ticker for every stage on screen.
//
// play(host, look, { tier, delay, loop, reduce }) → { stop() }
//   host  — a positioned box that holds `.a-car` (the result stage, a ×3/×6 tile, a shop preview);
//   tier  — 'full' (×1 result), 'tile' (×3 / ×6: fewer, smaller), 'short' (fast mode: ~0.75 s);
//   loop  — replay every `period` ms (shop previews; `drop` also re-drops the car photo each time).
const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
export const reducedMotion = () => RM.matches;

const TIERS = {
  full: { n: 1, speed: 1, dpr: 2 },
  tile: { n: 0.55, speed: 1.12, dpr: 1.5 },
  short: { n: 0.5, speed: 2.1, dpr: 2 },
  tshort: { n: 0.42, speed: 2.1, dpr: 1.5 }, // ×3 / ×6 in fast mode
  preview: { n: 0.62, speed: 1, dpr: 2 }, // the shop / look-picker cards
};
export const DURATION = { gold: 1.9, bolt: 1.55, fire: 1.95, chrome: 1.6 }; // seconds at speed 1
const SOFT = { fire: 1.5 }; // all glow, no hard edges: fewer pixels to fill (−45 % fill at the same look)

// ---------- tiny seeded rng ----------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const env = (t, a, b, c) => (t <= a ? 0 : t < b ? (t - a) / (b - a) : t < c ? 1 - (t - b) / (c - b) : 0); // 0→1→0
const lerp = (a, b, k) => a + (b - a) * k;
function mix(c1, c2, k) {
  return [lerp(c1[0], c2[0], k) | 0, lerp(c1[1], c2[1], k) | 0, lerp(c1[2], c2[2], k) | 0];
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------- sprites (made once) ----------
const SP = new Map();
function sprite(key, make, R = 32) {
  let s = SP.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = R * 2;
  make(s.getContext('2d'), R);
  SP.set(key, s);
  return s;
}
// A soft round glow of a colour (core → transparent).
const glow = (c, core = 0.9) => sprite('g' + c + core, (x, R) => {
  const g = x.createRadialGradient(R, R, 0, R, R, R);
  g.addColorStop(0, rgb(c, core));
  g.addColorStop(0.25, rgb(c, core * 0.45));
  g.addColorStop(0.6, rgb(c, core * 0.12));
  g.addColorStop(1, rgb(c, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, R * 2, R * 2);
});
// A four-point glint (two thin crossed streaks and a hot centre).
const glint = (c) => sprite('x' + c, (x, R) => {
  x.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[R, R * 0.07], [R * 0.07, R]]) {
    const g = x.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, rgb([255, 255, 255], 1));
    g.addColorStop(0.3, rgb(c, 0.55));
    g.addColorStop(1, rgb(c, 0));
    x.fillStyle = g;
    x.save();
    x.translate(R, R);
    x.scale(w / R, h / R);
    x.beginPath();
    x.arc(0, 0, R, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
  const g = x.createRadialGradient(R, R, 0, R, R, R * 0.3);
  g.addColorStop(0, '#fff');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, R * 2, R * 2);
});
// A gold coin face (lit) and its far side (darker): rim, inner ring, a soft specular.
const coin = (back) => sprite('coin' + back, (x, R) => {
  const r = R * 0.92;
  const g = x.createLinearGradient(R - r, R - r, R + r, R + r);
  if (back) (g.addColorStop(0, '#8a5d12'), g.addColorStop(0.5, '#c58f22'), g.addColorStop(1, '#5c3b07'));
  else (g.addColorStop(0, '#fff3b8'), g.addColorStop(0.35, '#ffd24a'), g.addColorStop(0.7, '#d9971a'), g.addColorStop(1, '#8c5a0c'));
  x.fillStyle = g;
  x.beginPath();
  x.arc(R, R, r, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = back ? 'rgba(60,35,0,.7)' : 'rgba(120,70,0,.55)';
  x.lineWidth = R * 0.07;
  x.beginPath();
  x.arc(R, R, r * 0.72, 0, Math.PI * 2);
  x.stroke();
  x.strokeStyle = back ? 'rgba(255,220,140,.25)' : 'rgba(255,250,220,.8)';
  x.lineWidth = R * 0.05;
  x.beginPath();
  x.arc(R, R, r * 0.95, Math.PI * 1.05, Math.PI * 1.6);
  x.stroke();
}, 24);

// ---------- one stage ----------
function measure(host) {
  const hb = host.getBoundingClientRect();
  const carEl = host.querySelector('.a-car') || host;
  const cb = carEl.getBoundingClientRect();
  const W = hb.width, H = hb.height;
  const car = { x: cb.left - hb.left, y: cb.top - hb.top, w: cb.width, h: cb.height };
  const cx = car.x + car.w / 2, gy = car.y + car.h * 0.94; // the wheels stand on the bottom of the photo box
  const rx = car.w * 0.56, ry = rx * 0.2;
  return { W, H, car, cx, gy, rx, ry, img: carEl.querySelector('.art img') };
}
// The car photo as an alpha mask in the car box (object-fit: contain; object-position: 50% 100%).
function carMask(G, dpr) {
  const img = G.img;
  if (!img || !img.complete || !img.naturalWidth || G.car.w < 4) return null;
  const w = Math.ceil(G.car.w * dpr), h = Math.ceil(G.car.h * dpr);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
  try {
    cv.getContext('2d').drawImage(img, (w - iw) / 2, h - ih, iw, ih);
  } catch {
    return null;
  }
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  return { cv, tmp, tc: tmp.getContext('2d'), w, h, dpr };
}
// Light on the car: paint(c, w, h) in device pixels of the car box, kept only where the car is, added onto ctx.
function onCar(ctx, G, M, alpha, paint) {
  if (!M || alpha <= 0.004) return;
  const { tc, w, h } = M;
  tc.globalCompositeOperation = 'source-over';
  tc.clearRect(0, 0, w, h);
  paint(tc, w, h);
  tc.globalCompositeOperation = 'destination-in';
  tc.drawImage(M.cv, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(M.tmp, G.car.x, G.car.y, G.car.w, G.car.h);
  ctx.globalAlpha = 1;
}
const put = (ctx, s, x, y, w, h = w, a = 1) => {
  if (a <= 0.004) return;
  ctx.globalAlpha = a > 1 ? 1 : a;
  ctx.drawImage(s, x - w / 2, y - h / 2, w, h);
};
// A narrow specular band across the car box at x (device px), tilted; `bw` = half width as a share of the box width.
function band(c, w, h, x, bw, col, a = 1) {
  const d = w * bw; // the gradient runs across the band (almost horizontal), so the band itself stands tilted ~25°
  const g = c.createLinearGradient(x - d, 0, x + d, d * 0.9);
  g.addColorStop(0, rgb(col, 0));
  g.addColorStop(0.42, rgb(col, 0.12 * a));
  g.addColorStop(0.5, rgb(col, a));
  g.addColorStop(0.58, rgb(col, 0.12 * a));
  g.addColorStop(1, rgb(col, 0));
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}
// A ring on the turntable in a few additive passes (wide faint → thin hot core); far / near half.
function ring(ctx, G, r, far, passes, lw) {
  ctx.globalCompositeOperation = 'lighter';
  for (const [wm, c, al] of passes) {
    if (al <= 0.004) continue;
    ctx.globalAlpha = Math.min(1, al);
    ctx.strokeStyle = rgb(c);
    ctx.lineWidth = Math.max(0.6, lw * wm);
    arcHalf(ctx, G, G.rx * r, G.ry / G.rx, far);
    ctx.stroke();
  }
}
// Half an ellipse ring: the far half (behind the car) or the near half (in front).
const arcHalf = (ctx, G, r, k, far) => (ctx.beginPath(), ctx.ellipse(G.cx, G.gy, r, r * k, 0, far ? Math.PI : 0, far ? Math.PI * 2 : Math.PI));

// ---------- the four effects ----------
// Each build(G, n, seed) returns { dur, draw(b, f, t) } — b / f: the back and front 2d contexts (CSS px), t in seconds.
const BUILD = {
  // «Золотий дощ»: coins tumble down around the car (catching the light as they flip), land on the turntable with a
  // spark and a glint; a warm floor glow and a slow golden sheen across the car.
  gold(G, n, seed) {
    const R = rng(seed), H = Math.max(G.H, 190); // sizes: a small ×3 / ×6 tile still reads
    const coins = Array.from({ length: Math.max(6, Math.round(54 * n)) }, () => {
      const land = G.gy + (R() - 0.45) * G.ry * 2.2;
      const x = G.cx + (R() * 2 - 1) * G.rx * 1.25;
      const t0 = -0.32 + R() * 0.95, g = H * (3.4 + R() * 1.2), v0 = H * (0.25 + R() * 0.35); // some already falling as the car lands
      const y0 = -H * (0.08 + R() * 0.12);
      const fall = (-v0 + Math.sqrt(v0 * v0 + 2 * g * (land - y0))) / g; // time to the floor
      const near = (land - G.gy) / (G.ry * 1.2); // nearer coins a touch bigger
      return { x, land, t0, g, v0, y0, fall, s: H * (0.065 + R() * 0.035) * (1 + near * 0.18) * (n < 0.6 ? 1.15 : 1), w: 9 + R() * 8, p: R() * 6.3, tilt: (R() - 0.5) * 0.9, drift: (R() - 0.5) * G.rx * 0.25, front: land > G.gy };
    });
    const sparks = [];
    for (const c of coins) {
      const k = Math.round(2 + R() * 2);
      for (let i = 0; i < k; i++) sparks.push({ c, a: -Math.PI / 2 + (R() - 0.5) * 2.4, v: H * (0.35 + R() * 0.5), life: 0.28 + R() * 0.3 });
    }
    const twinkles = Array.from({ length: Math.max(3, Math.round(16 * n)) }, () => ({ x: G.cx + (R() * 2 - 1) * G.rx * 1.2, y: G.gy - R() * G.car.h * 1.5, t: 0.35 + R() * 1.1, s: H * (0.06 + R() * 0.05) }));
    const gc = glow([255, 196, 64]), gw = glow([255, 236, 170]), gl = glint([255, 214, 110]);
    return {
      dur: DURATION.gold,
      draw(b, f, t, M) {
        // floor glow: blooms as the first coins land, fades slowly
        const fl = env(t, 0, 0.3, 1.9) * 0.8;
        b.globalCompositeOperation = f.globalCompositeOperation = 'lighter';
        put(b, gc, G.cx, G.gy, G.rx * 2.8, G.ry * 5, fl);
        put(f, gc, G.cx, G.gy + G.ry * 0.6, G.rx * 2.2, G.ry * 2.2, fl * 0.5);
        // the landing beat: a warm bloom under the car and a thin gold ring running out over the turntable
        put(b, gw, G.cx, G.gy, G.rx * 1.9, G.ry * 3.4, env(t, 0, 0.04, 0.45) * 1);
        const rk = clamp01(t / 0.65), ra = (1 - rk) * (rk < 0.05 ? rk / 0.05 : 1);
        const gp = [[5, [255, 170, 40], 0.16 * ra], [1.8, [255, 205, 90], 0.5 * ra], [0.6, [255, 248, 215], 0.9 * ra]];
        ring(b, G, 0.4 + easeOut(rk) * 0.7, true, gp, H * 0.006);
        ring(f, G, 0.4 + easeOut(rk) * 0.7, false, gp, H * 0.006);
        for (const c of coins) {
          const dt = t - c.t0;
          if (dt < 0) continue;
          const ctx = c.front ? f : b;
          if (dt < c.fall) {
            const y = c.y0 + c.v0 * dt + 0.5 * c.g * dt * dt, x = c.x + c.drift * (dt / c.fall);
            const ph = c.p + c.w * dt, sx = Math.cos(ph);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = Math.min(1, dt * 8);
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(c.tilt + dt * 1.5);
            ctx.scale(Math.max(0.1, Math.abs(sx)), 1);
            ctx.drawImage(coin(sx < 0), -c.s / 2, -c.s / 2, c.s, c.s);
            ctx.restore();
            // the face turns to the light: a short specular flash
            ctx.globalCompositeOperation = 'lighter';
            put(ctx, gw, x, y, c.s * 1.6, c.s * 1.6, Math.pow(Math.max(0, sx), 14) * 0.7);
          } else {
            // landed: lies flat on the turntable for a moment, a glint, then gone
            const lt = dt - c.fall, a = 1 - clamp01(lt / 0.42);
            if (a <= 0) continue;
            const x = c.x + c.drift;
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = a;
            ctx.save();
            ctx.translate(x, c.land);
            ctx.scale(1, 0.32);
            ctx.drawImage(coin(false), -c.s / 2, -c.s / 2, c.s, c.s);
            ctx.restore();
            ctx.globalCompositeOperation = 'lighter';
            put(ctx, gl, x, c.land, c.s * 2.4, c.s * 2.4, env(lt, 0, 0.05, 0.3) * 0.9);
          }
        }
        // sparks off each landing: short warm streaks
        for (const s of sparks) {
          const lt = t - s.c.t0 - s.c.fall;
          if (lt < 0 || lt > s.life) continue;
          const ctx = s.c.front ? f : b, k = lt / s.life;
          const x0 = s.c.x + s.c.drift, y0 = s.c.land;
          const px = (u) => x0 + Math.cos(s.a) * s.v * u, py = (u) => y0 + Math.sin(s.a) * s.v * u + 1.6 * H * u * u;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - k) * 0.9;
          ctx.strokeStyle = rgb(mix([255, 250, 220], [255, 170, 40], k));
          ctx.lineWidth = Math.max(0.8, H * 0.006);
          ctx.beginPath();
          ctx.moveTo(px(Math.max(0, lt - 0.05)), py(Math.max(0, lt - 0.05)));
          ctx.lineTo(px(lt), py(lt));
          ctx.stroke();
        }
        f.globalCompositeOperation = 'lighter';
        for (const w of twinkles) put(f, gl, w.x, w.y, w.s, w.s, env(t, w.t, w.t + 0.12, w.t + 0.4) * 0.85);
        // a slow golden sheen across the car
        const sw = clamp01((t - 0.15) / 0.75);
        onCar(f, G, M, env(t, 0.15, 0.3, 0.9) * 0.95, (c, w, h) => band(c, w, h, lerp(-0.3, 1.3, sw) * w, 0.09, [255, 222, 140]));
        b.globalAlpha = f.globalAlpha = 1;
      },
    };
  },

  // «Блискавка»: two–three bolts strike the turntable (flickering, re-forking every few frames), each with a blue-white
  // flash that lights the car, a burst at the impact and electric arcs crawling along the turntable's edge.
  bolt(G, n, seed) {
    const R = rng(seed), H = Math.max(G.H, 190); // sizes: a small ×3 / ×6 tile still reads
    const k = n < 0.6 ? 2 : 3;
    const strikes = Array.from({ length: k }, (_, i) => {
      // the hits land on the near rim of the turntable, left / right of the car, never on the same side twice in a row
      const side = i % 2 ? 1 : -1, a = Math.PI / 2 + side * (0.55 + R() * 0.55);
      const ex = G.cx + Math.cos(a) * G.rx * 0.95, ey = G.gy + Math.sin(a) * G.ry * 0.95;
      return { t: [0, 0.26, 0.55][i] + R() * 0.06, sx: ex + (R() - 0.5) * G.rx * 0.5, ex, ey, seed: (R() * 1e9) | 0, front: Math.sin(a) > 0, big: i === 0,
        sparks: Array.from({ length: Math.max(5, Math.round(14 * n)) }, () => ({ a: -Math.PI / 2 + (R() - 0.5) * 2.8, v: H * (0.4 + R() * 0.7), life: 0.2 + R() * 0.3 })) };
    });
    const arcs = Array.from({ length: Math.max(4, Math.round(12 * n)) }, () => ({ t: 0.05 + R() * 1.0, a: R() * Math.PI * 2, len: 0.25 + R() * 0.35, seed: (R() * 1e9) | 0 }));
    const gb = glow([110, 170, 255]), gw = glow([220, 236, 255]);
    // A jagged path from (x0,y0) to (x1,y1): midpoint displacement, a fresh shape every 45 ms of the flicker.
    const path = (x0, y0, x1, y1, s, depth = 6, amp = 0.16) => {
      const r = rng(s);
      let pts = [[x0, y0], [x1, y1]];
      let d = Math.hypot(x1 - x0, y1 - y0) * amp;
      for (let l = 0; l < depth; l++, d *= 0.55) {
        const nx = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const o = (r() - 0.5) * 2 * d;
          nx.push(pts[i], [(ax + bx) / 2 + (-(by - ay) / len) * o, (ay + by) / 2 + ((bx - ax) / len) * o]);
        }
        nx.push(pts[pts.length - 1]);
        pts = nx;
      }
      return pts;
    };
    const stroke = (ctx, pts, w, a) => {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = ctx.lineCap = 'round';
      for (const [lw, c, al] of [[w * 12, [60, 110, 255], 0.07], [w * 5, [90, 150, 255], 0.2], [w * 2.2, [160, 205, 255], 0.6], [w, [255, 255, 255], 1]]) {
        ctx.globalAlpha = al * a;
        ctx.strokeStyle = rgb(c);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
    };
    return {
      dur: DURATION.bolt,
      draw(b, f, t, M) {
        let flash = 0, lit = 0;
        for (const s of strikes) {
          const dt = t - s.t;
          if (dt < -0.001) continue;
          // the bolt: 3 flickers in ~170 ms
          if (dt < 0.17) {
            const fl = Math.floor(dt / 0.045), on = fl === 1 ? 0.45 : 1;
            const pts = path(s.sx, -H * 0.05, s.ex, s.ey, s.seed + fl);
            const w = Math.max(0.9, H * (s.big ? 0.007 : 0.005));
            stroke(s.front ? f : b, pts, w, on);
            // one fork off the upper half
            const j = (pts.length * (0.3 + (fl % 2) * 0.15)) | 0, [fx, fy] = pts[j];
            stroke(s.front ? f : b, path(fx, fy, fx + (s.ex > G.cx ? 1 : -1) * G.rx * 0.35, fy + H * 0.22, s.seed + 7 + fl, 4, 0.22), w * 0.6, on * 0.7);
          }
          flash = Math.max(flash, (s.big ? 0.42 : 0.26) * Math.exp(-dt / 0.07) * (dt < 0.17 ? 1 : 0.6));
          lit = Math.max(lit, Math.exp(-dt / 0.12));
          // impact: a hot point, a blue bloom on the floor
          const ctx = s.front ? f : b;
          ctx.globalCompositeOperation = 'lighter';
          put(ctx, gw, s.ex, s.ey, H * 0.26, H * 0.14, env(dt, 0, 0.02, 0.35) * 0.95);
          // a small shock ring on the floor at the hit
          const sk = clamp01(dt / 0.3);
          if (sk < 1) {
            ctx.globalAlpha = (1 - sk) * 0.8;
            ctx.strokeStyle = 'rgb(170,210,255)';
            ctx.lineWidth = Math.max(0.7, H * 0.006 * (1 - sk));
            ctx.beginPath();
            ctx.ellipse(s.ex, s.ey, H * (0.02 + easeOut(sk) * 0.2), H * (0.006 + easeOut(sk) * 0.05), 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          put(b, gb, s.ex, s.ey, G.rx * 1.3, G.ry * 3, env(dt, 0, 0.03, 0.6) * 0.55);
          for (const p of s.sparks) {
            if (dt > p.life) continue;
            const k2 = dt / p.life, px = (u) => s.ex + Math.cos(p.a) * p.v * u, py = (u) => s.ey + Math.sin(p.a) * p.v * u + 2.2 * H * u * u;
            ctx.globalAlpha = (1 - k2) * 0.95;
            ctx.strokeStyle = rgb(mix([255, 255, 255], [120, 180, 255], k2));
            ctx.lineWidth = Math.max(0.7, H * 0.005);
            ctx.beginPath();
            ctx.moveTo(px(Math.max(0, dt - 0.035)), py(Math.max(0, dt - 0.035)));
            ctx.lineTo(px(dt), py(dt));
            ctx.stroke();
          }
        }
        // the turntable charged: blue floor glow + arcs crawling along its edge
        const charge = env(t, 0, 0.12, 1.5);
        put(b, gb, G.cx, G.gy, G.rx * 2.6, G.ry * 4.6, charge * 0.42 * (0.85 + 0.15 * Math.sin(t * 70)));
        for (const a of arcs) {
          const dt = t - a.t;
          if (dt < 0 || dt > 0.09) continue;
          const steps = 7, pts = [];
          for (let i = 0; i <= steps; i++) {
            const ang = a.a + (a.len * i) / steps;
            pts.push([G.cx + Math.cos(ang) * G.rx * 1.02, G.gy + Math.sin(ang) * G.ry * 1.02]);
          }
          // jitter the arc points
          const r = rng(a.seed + ((dt / 0.03) | 0));
          for (const p of pts) p[1] += (r() - 0.5) * H * 0.03;
          stroke(Math.sin(a.a + a.len / 2) > 0 ? f : b, pts, Math.max(0.6, H * 0.0035), 0.85);
        }
        // the flash: the whole stage, and the car lit from above
        if (flash > 0.01) {
          f.globalCompositeOperation = 'lighter';
          f.globalAlpha = flash;
          f.fillStyle = 'rgb(150,190,255)';
          f.fillRect(0, 0, G.W, G.H);
        }
        onCar(f, G, M, lit * 0.32, (c, w, h) => {
          const g = c.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, 'rgba(210,230,255,1)');
          g.addColorStop(0.35, 'rgba(120,170,255,.3)');
          g.addColorStop(0.6, 'rgba(120,170,255,0)');
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
        });
        b.globalAlpha = f.globalAlpha = 1;
      },
    };
  },

  // «Вогняний вибух»: a burst ring of flame runs out over the turntable from under the car, tongues of fire rise off it,
  // embers drift up long after; the car is lit warm from below.
  fire(G, n, seed) {
    const R = rng(seed), H = Math.max(G.H, 190); // sizes: a small ×3 / ×6 tile still reads
    const segs = Math.max(24, Math.round(52 * n));
    const ring_ = Array.from({ length: segs }, (_, i) => ({ a: (i / segs) * Math.PI * 2 + R() * 0.1, j: R(), s: 0.8 + R() * 0.5 }));
    const tongues = Array.from({ length: Math.max(12, Math.round(44 * n)) }, () => ({ a: R() * Math.PI * 2, t: 0.02 + R() * 0.42, r: 0.7 + R() * 0.4, v: H * (0.3 + R() * 0.35), life: 0.35 + R() * 0.4, s: H * (0.09 + R() * 0.08), dx: (R() - 0.5) * H * 0.12 }));
    const embers = Array.from({ length: Math.max(8, Math.round(30 * n)) }, () => ({ a: R() * Math.PI * 2, r: 0.3 + R() * 1.3, t: 0.1 + R() * 0.5, life: 0.9 + R() * 0.9, v: H * (0.18 + R() * 0.28), w: 2 + R() * 4, p: R() * 6.3, s: Math.max(1, H * (0.006 + R() * 0.006)) }));
    const HOT = [255, 240, 200], ORA = [255, 140, 30], RED = [190, 40, 10];
    const fireCol = (k) => (k < 0.35 ? mix(HOT, ORA, k / 0.35) : mix(ORA, RED, (k - 0.35) / 0.65));
    const glows = Array.from({ length: 6 }, (_, i) => glow(fireCol(i / 5), 0.85));
    const gOf = (k) => glows[Math.min(5, Math.round(k * 5))];
    const gEm = glow([255, 214, 150], 1);
    const fa = n < 0.7 ? 0.65 : 1; // lighter flames on the ×3 / ×6 tiles
    return {
      dur: DURATION.fire,
      draw(b, f, t, M) {
        b.globalCompositeOperation = f.globalCompositeOperation = 'lighter';
        // the burst: a hot core under the car, then a floor glow that cools
        put(b, gOf(0), G.cx, G.gy, G.rx * 1.6, G.ry * 3.2, env(t, 0, 0.04, 0.4) * 0.9);
        put(b, gOf(0.5), G.cx, G.gy, G.rx * 3, G.ry * 5.5, env(t, 0, 0.12, 1.8) * 0.5);
        // the ring running out (far half behind the car, near half in front)
        const rk = easeOut(t / 0.7), rad = 0.3 + rk * 0.85, fade = 1 - clamp01((t - 0.2) / 0.75);
        if (fade > 0) {
          // a continuous ring of fire (wide deep red → orange → a hot thin core), then flame licks along it
          const fp = [[7, RED, 0.24 * fade], [3.5, ORA, 0.32 * fade], [1.4, [255, 190, 80], 0.5 * fade], [0.45, HOT, 0.6 * fade]];
          ring(b, G, rad, true, fp, H * 0.009 * (1 - rk * 0.4));
          ring(f, G, rad, false, fp, H * 0.009 * (1 - rk * 0.4));
          for (const s of ring_) {
            const wob = 1 + 0.05 * Math.sin(s.a * 7 + t * 18 + s.j * 6);
            const x = G.cx + Math.cos(s.a) * G.rx * rad * wob, y = G.gy + Math.sin(s.a) * G.ry * rad * wob;
            const ctx = Math.sin(s.a) > 0 ? f : b, sz = H * 0.11 * s.s * (1 - rk * 0.35);
            const lick = 0.55 + 0.45 * Math.sin(t * 24 + s.j * 9);
            // a flame: a wide warm body and a narrow hot tip above it
            put(ctx, gOf(clamp01(0.45 + rk * 0.4 + s.j * 0.15)), x, y - sz * 0.45 * lick, sz * 0.8, sz * 1.5 * lick, fade * 0.55 * fa);
            put(ctx, gOf(clamp01(rk * 0.5 + s.j * 0.2)), x, y - sz * 0.8 * lick, sz * 0.38, sz * 1.9 * lick, fade * 0.75 * fa);
          }
        }
        // tongues of flame: rise, lean, shrink, cool from white-yellow to deep red
        for (const p of tongues) {
          const dt = t - p.t;
          if (dt < 0 || dt > p.life) continue;
          const k = dt / p.life, r0 = (0.3 + easeOut(p.t / 0.7) * 0.85) * p.r;
          const x = G.cx + Math.cos(p.a) * G.rx * r0 + p.dx * k, y = G.gy + Math.sin(p.a) * G.ry * r0 - p.v * dt - 0.5 * H * 0.6 * dt * dt;
          const sz = p.s * (1 - k * 0.6);
          put(Math.sin(p.a) > 0 ? f : b, gOf(k), x, y, sz * 0.6, sz * 1.6, (1 - k) * (k < 0.1 ? k / 0.1 : 1) * 0.9);
        }
        // embers: tiny bright points drifting up with a sway, flickering
        for (const e of embers) {
          const dt = t - e.t;
          if (dt < 0 || dt > e.life) continue;
          const k = dt / e.life;
          const x = G.cx + Math.cos(e.a) * G.rx * e.r + Math.sin(e.p + dt * e.w) * H * 0.03, y = G.gy + Math.sin(e.a) * G.ry * e.r - e.v * dt;
          const a = (1 - k) * (0.65 + 0.35 * Math.sin(e.p * 3 + dt * 30));
          put(f, gEm, x, y, e.s * 2.4, e.s * 2.4, a);
          put(f, gOf(0.4 + k * 0.5), x, y, e.s * 7, e.s * 7, a * 0.3);
        }
        // the car lit warm from below
        onCar(f, G, M, env(t, 0, 0.06, 1.2) * 0.42, (c, w, h) => {
          const g = c.createLinearGradient(0, h, 0, 0);
          g.addColorStop(0, 'rgba(255,150,40,.95)');
          g.addColorStop(0.3, 'rgba(255,90,20,.3)');
          g.addColorStop(0.55, 'rgba(255,90,20,0)');
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
        });
        b.globalAlpha = f.globalAlpha = 1;
      },
    };
  },

  // «Хромована хвиля»: a polished-metal shockwave runs out over the turntable (bright core, thin cyan / magenta
  // fringes, a second fainter echo), a specular band sweeps across the car body with a few glints, silver flecks fly.
  chrome(G, n, seed) {
    const R = rng(seed), H = Math.max(G.H, 190); // sizes: a small ×3 / ×6 tile still reads
    const flecks = Array.from({ length: Math.max(6, Math.round(18 * n)) }, () => ({ a: R() * Math.PI * 2, v: 0.9 + R() * 0.9, t: 0.02 + R() * 0.1, life: 0.45 + R() * 0.4, s: Math.max(1, H * (0.006 + R() * 0.006)) }));
    const glints = Array.from({ length: 3 }, (_, i) => ({ u: 0.25 + i * 0.25 + (R() - 0.5) * 0.1, v: 0.25 + R() * 0.3 }));
    const gw = glow([235, 242, 255]), gl = glint([200, 225, 255]);
    const wave = (ctx, r, far, a, lw) => {
      if (a <= 0.005) return;
      ctx.globalCompositeOperation = 'lighter';
      for (const [dr, c, al, w] of [[1.03, [90, 210, 255], 0.35, 1.4], [0.97, [255, 110, 200], 0.28, 1.4], [1, [235, 240, 248], 0.9, 1], [1, [255, 255, 255], 0.25, 4]]) {
        ctx.globalAlpha = al * a;
        ctx.strokeStyle = rgb(c);
        ctx.lineWidth = lw * w;
        arcHalf(ctx, G, G.rx * r * dr, G.ry / G.rx, far);
        ctx.stroke();
      }
    };
    return {
      dur: DURATION.chrome,
      draw(b, f, t, M) {
        b.globalCompositeOperation = f.globalCompositeOperation = 'lighter';
        put(b, gw, G.cx, G.gy, G.rx * 2.2, G.ry * 3.6, env(t, 0, 0.05, 0.9) * 0.45);
        for (const [d, amp] of [[0, 1], [0.13, 0.45]]) {
          const k = clamp01((t - d) / 0.85), r = 0.25 + easeOut(k) * 1.0, a = amp * Math.pow(1 - k, 1.4) * (k < 0.04 ? k / 0.04 : 1);
          const lw = Math.max(0.8, H * 0.012 * (1 - k * 0.7));
          wave(b, r, true, a, lw);
          wave(f, r, false, a, lw);
        }
        for (const p of flecks) {
          const dt = t - p.t;
          if (dt < 0 || dt > p.life) continue;
          const k = dt / p.life, r = 0.35 + easeOut(k) * 1.5 * p.v;
          const x = G.cx + Math.cos(p.a) * G.rx * r, y = G.gy + Math.sin(p.a) * G.ry * r - Math.sin(k * Math.PI) * H * 0.05;
          const ctx = Math.sin(p.a) > 0 ? f : b;
          ctx.globalAlpha = (1 - k) * 0.9;
          ctx.fillStyle = '#e8eef6';
          ctx.fillRect(x - p.s / 2, y - p.s / 2, p.s, p.s);
        }
        // the specular sweep across the body, left → right, with an anamorphic streak at its top
        const sw = clamp01((t - 0.12) / 0.7), sa = env(t, 0.1, 0.25, 0.95);
        onCar(f, G, M, sa * 0.85, (c, w, h) => {
          const x = lerp(-0.3, 1.3, sw) * w;
          band(c, w, h, x, 0.07, [255, 255, 255]);
          band(c, w, h, x - w * 0.09, 0.025, [215, 232, 255], 0.7); // a thinner second highlight just behind
        });
        put(f, gw, G.car.x + lerp(-0.3, 1.3, sw) * G.car.w, G.car.y + G.car.h * 0.3, G.car.w * 0.7, H * 0.014, sa * 0.45);
        for (const g of glints) {
          const at = 0.12 + g.u * 0.7;
          put(f, gl, G.car.x + g.u * G.car.w, G.car.y + g.v * G.car.h, H * 0.16, H * 0.16, env(t, at - 0.02, at + 0.05, at + 0.32) * 0.9);
        }
        b.globalAlpha = f.globalAlpha = 1;
      },
    };
  },
};
export const LOOKS = Object.keys(BUILD);

// ---------- the ticker ----------
const live = new Set();
let raf = 0;
function tick(now) {
  for (const s of live) s.frame(now);
  raf = live.size ? requestAnimationFrame(tick) : 0;
}
const wake = () => (raf ||= requestAnimationFrame(tick));

export function play(host, look, { tier = 'full', delay = 0, loop = false, period = 2700, drop = false, reduce = reducedMotion(), seed } = {}) {
  const T = TIERS[tier] || TIERS.full;
  if (!host || !BUILD[look]) return { stop() {} };
  const mk = (cls) => {
    const c = document.createElement('canvas');
    c.className = 'dfx-c ' + cls;
    c.setAttribute('aria-hidden', 'true');
    host.appendChild(c);
    return c;
  };
  const cb = mk('dfx-b'), cf = mk('dfx-f');
  const b = cb.getContext('2d'), f = cf.getContext('2d');
  let G = null, M = null, fx = null, start = 0, stopped = false, runs = 0, dpr = 1, shownAt = 0, dropAnim = null;
  const setup = () => {
    G = measure(host);
    dpr = Math.min(T.dpr, SOFT[look] || 9, devicePixelRatio || 1);
    for (const c of [cb, cf]) (c.width = Math.max(1, Math.round(G.W * dpr)), c.height = Math.max(1, Math.round(G.H * dpr)));
    M = carMask(G, dpr);
    fx = BUILD[look](G, T.n, seed ?? ((Math.random() * 1e9) | 0) + runs * 7919);
  };
  const render = (t) => {
    for (const [c, x] of [[cb, b], [cf, f]]) {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, c.width, c.height);
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    fx.draw(b, f, t, M);
  };
  const s = {
    frame(now) {
      if (stopped) return;
      if (!host.isConnected) return s.stop();
      if (!start) return;
      const t = ((now - start) / 1000) * T.speed;
      if (t < 0) return;
      if (t > fx.dur) {
        render(fx.dur);
        if (!loop) return s.stop();
        live.delete(s);
        b.clearRect(0, 0, cb.width, cb.height);
        f.clearRect(0, 0, cf.width, cf.height);
        restart(Math.max(0, period - fx.dur * 1000 / T.speed));
        return;
      }
      render(t);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      live.delete(s);
      clearTimeout(s.tm);
      dropAnim?.cancel?.();
      cb.remove();
      cf.remove();
    },
  };
  // A preview's car drops again each loop (the same curve as the result stage), the effect hits as it lands.
  const LAND = 380;
  function restart(wait) {
    s.tm = setTimeout(() => {
      if (stopped || !host.isConnected) return s.stop();
      const art = drop && host.querySelector('.a-car .art');
      if (art?.animate && !reduce) dropAnim = art.animate([{ transform: 'translateY(-14%) scale(.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 550, easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'backwards' });
      s.tm = setTimeout(() => {
        if (stopped) return;
        runs++;
        setup();
        start = performance.now();
        live.add(s);
        wake();
      }, drop && !reduce ? LAND : 0);
    }, wait);
  }
  if (reduce) {
    // Reduced motion: one still frame at the effect's peak, faded in and out by opacity only (a preview keeps it).
    s.tm = setTimeout(() => {
      if (stopped || !host.isConnected) return;
      setup();
      render({ gold: 0.75, bolt: 0.03, fire: 0.3, chrome: 0.4 }[look]);
      for (const c of [cb, cf]) c.classList.add('dfx-still');
      if (!loop) s.tm = setTimeout(() => (cb.classList.add('dfx-out'), cf.classList.add('dfx-out'), (s.tm = setTimeout(() => s.stop(), 700))), 1400);
    }, delay);
    return s;
  }
  shownAt = delay;
  restart(shownAt);
  return s;
}

// One still frame at time t (seconds at speed 1) on a host — the reduced-motion still uses the same draw; also handy to
// look at an effect frame by frame. Returns a remover.
export function frameAt(host, look, t, { tier = 'full', seed = 1 } = {}) {
  const T = TIERS[tier] || TIERS.full;
  if (!host || !BUILD[look]) return () => {};
  const G = measure(host), dpr = Math.min(T.dpr, SOFT[look] || 9, devicePixelRatio || 1), cs = [];
  const ctxs = ['dfx-b', 'dfx-f'].map((cls) => {
    const c = document.createElement('canvas');
    c.className = 'dfx-c ' + cls;
    c.width = Math.round(G.W * dpr);
    c.height = Math.round(G.H * dpr);
    host.appendChild(c);
    cs.push(c);
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return x;
  });
  BUILD[look](G, T.n, seed).draw(ctxs[0], ctxs[1], t, carMask(G, dpr));
  return () => cs.forEach((c) => c.remove());
}
