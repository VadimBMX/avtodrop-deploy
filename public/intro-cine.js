// d1-intro (owner 5.11: «a damn amazing intro for beginners… cars flying into the frame, several, so it's WOW»).
// Two cinematic first-launch intros. The owner picked A (5.11): it is the newcomer intro, no flag; B stays dormant
// behind ?intro=B. «Як грати» still replays the 7-scene reel (intro-reel.js). Both run ~5 s to the free-case CTA, on
// the game's real car photos (side views, transparent ground) moved by one requestAnimationFrame clock: every
// transform is a pure function of the time t, so a tap jumps straight to the last frame and reduced motion simply
// draws that frame once.
//   A «Нічний заліт»: an RX-7 rolls in out of the dark with only its lamps lit, the street lights up, it rips
//     across the back lane, an R34 the other way, then the hero Aventador SVJ blasts in, brakes hard with brake lights and tyre smoke, the camera
//     settles, АВТОДРОП slams down with the hazard tape, a light sweep runs over the car, the CTA.
//   B «Драг-старт»: a tight shot on the hero's rear wheel at the line, the tree counts down (3 ambers, green), the
//     camera pulls back to three cars side by side; on green — smoke, shake, the world streams past (dashes, lamp
//     posts, speed lines), the cars swap places, the hero pulls away, all three blow out of frame; white flash, the
//     poster: three cars on the stage, АВТОДРОП slam, sweep, the CTA.
// Only transform/opacity on a dozen elements per frame plus one canvas for smoke and speed lines (DPR ≤ 1.5).
// The root is `body > .reel.cine` so the app's «intro on screen» checks (popIdle, introReel) see it like the reel.
import * as S from './shared.js';
import { wheelData, wheelHtml, WW_CAP } from './race-wheels.js'; // the drag race's wheel discs (race-wheels-data.js)

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const reduced = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// literal paths: the static server versions them (src/static.js)
const IMG = {
  rx7: 'cars/mazda-rx-7-fd.webp',
  r34: 'cars/nissan-skyline-gt-r-r34.webp',
  svj: 'cars/lamborghini-aventador-svj.webp',
  supra: 'cars/toyota-supra-a80.webp',
  huracan: 'cars/lamborghini-huracan-evo.webp',
  aurora: 'cars/porsche-911-turbo-s-aurora.webp',
  city: 's2/bg/race-bg2.webp',
  stage: 's2/bg/car-card.webp',
};
const MODEL = { rx7: 'mazda-rx-7-fd', r34: 'nissan-skyline-gt-r-r34', svj: 'lamborghini-aventador-svj', supra: 'toyota-supra-a80', huracan: 'lamborghini-huracan-evo', aurora: 'porsche-911-turbo-s-aurora' };
// Lamp points measured on each photo (fractions of its width / height, the car facing right): the headlight lens and
// the tail lamp. The glow and the beam start exactly there and ride with the car (a left-moving car is the mirrored
// photo, so its points mirror with it).
export const LAMPS = {
  rx7: { head: [0.975, 0.7], tail: [0.025, 0.54] },
  r34: { head: [0.955, 0.6], tail: [0.02, 0.52] },
  svj: { head: [0.945, 0.655], tail: [0.045, 0.59] },
  supra: { head: [0.96, 0.62], tail: [0.025, 0.5] },
  huracan: { head: [0.965, 0.675], tail: [0.04, 0.56] },
  aurora: { head: [0.93, 0.585], tail: [0.04, 0.57] },
};
export const CINE = {
  A: { name: 'Нічний заліт', cars: { far: 'rx7', mid: 'r34', hero: 'svj' }, end: 4700, cta: 3900 },
  B: { name: 'Драг-старт', cars: { far: 'supra', mid: 'huracan', hero: 'aurora' }, end: 5600, cta: 4800 },
};

// ---- tiny maths ----
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const eOut = (k) => 1 - Math.pow(1 - k, 3);
const eOut4 = (k) => 1 - Math.pow(1 - k, 4);
const eIn = (k) => k * k * k;
const eIO = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const eBack = (k) => 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
const bump = (t, a, b) => Math.sin(Math.PI * seg(t, a, b));
const rnd = (a, b) => a + Math.random() * (b - a);

const pc = ([x, y]) => `left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%`;
const carHtml = (k, key, flip = false) => {
  const src = IMG[key], lamp = LAMPS[key], d = wheelData(MODEL[key]);
  const wheels = d ? `<div class="ww" data-s="0" style="aspect-ratio:${d.w} / ${d.h}">${d.wheels.map((q) => wheelHtml(d, q)).join('')}</div>` : '';
  return `<div class="cn-car${flip ? ' flip' : ''}" data-car="${k}" data-model="${MODEL[key]}">
  <div class="cn-body"><img class="cn-g2" src="${src}" alt=""><img class="cn-g1" src="${src}" alt=""><img class="cn-img" src="${src}" alt="">${wheels}
    <i class="cn-tail" style="${pc(lamp.tail)}"></i><i class="cn-head" style="${pc(lamp.head)}"></i><i class="cn-sweep" style="-webkit-mask-image:url(${src});mask-image:url(${src})"><b></b></i></div>
  <img class="cn-refl" src="${src}" alt=""></div>`;
};

function sceneHtml(v, again) {
  const C = CINE[v].cars, go = S.INTRO_REEL.scenes.at(-1);
  const tape = `Сезон ${String(S.S2_RESET.season).padStart(2, '0')} · Місто`;
  const world = v === 'A'
    ? `<div class="cn-bg"><img src="${IMG.city}" alt=""></div><i class="cn-wet"></i>
       <i class="cn-night"></i>
       ${carHtml('far', C.far)}${carHtml('mid', C.mid, true)}${carHtml('hero', C.hero)}`
    : `<div class="cn-world"><div class="cn-bg"><img src="${IMG.city}" alt=""></div><i class="cn-road"></i><i class="cn-dash d1"></i><i class="cn-dash d2"></i>
         <div class="cn-posts">${'<i></i>'.repeat(5)}</div>
         ${carHtml('far', C.far)}${carHtml('mid', C.mid)}${carHtml('hero', C.hero)}</div>
       <div class="cn-poster"><img class="cn-stage" src="${IMG.stage}" alt=""><i class="cn-cone"></i>
         ${carHtml('pl', C.far, true)}${carHtml('pr', C.mid)}${carHtml('ph', C.hero)}</div>
       <div class="cn-tree"><i class="st"></i><i class="a"></i><i class="a"></i><i class="a"></i><i class="g"></i></div>`;
  return `<div class="cn-cam">${world}<canvas class="cn-fx"></canvas></div>
    <i class="cn-dark"></i><i class="cn-vign"></i>
    <div class="cn-mark"><span class="cn-word">АВТО<b>ДРОП</b></span><span class="cn-tape"><em>${esc(tape)}</em></span></div>
    <i class="cn-flash"></i>
    <div class="cn-end"><small class="cn-k">${esc(go.kicker)}</small><h2 class="cn-t">${esc(go.title)}</h2><p class="cn-p">${esc(go.text)}</p>
      <button class="cn-go" type="button">${esc(again ? S.INTRO_REEL.ctaAgain : S.INTRO_REEL.cta)}</button></div>
    <button class="cn-skip" type="button">Пропустити</button><small class="cn-hint">торкнись — одразу до кейсу</small>`;
}

// ---- smoke / sparks / speed lines on one canvas ----
function makeFx(canvas) {
  const ctx = canvas.getContext('2d');
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const sc = sprite.getContext('2d'), g = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(214,218,226,.55)');
  g.addColorStop(0.5, 'rgba(170,176,188,.25)');
  g.addColorStop(1, 'rgba(150,156,168,0)');
  sc.fillStyle = g;
  sc.fillRect(0, 0, 64, 64);
  const P = [];
  let dpr = 1, W = 0, H = 0;
  return {
    size(w, h) {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = w;
      H = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    },
    smoke(x, y, o = {}) {
      if (P.length > 220) return;
      P.push({ k: 's', x, y, vx: o.vx ?? rnd(-0.03, 0.03), vy: o.vy ?? rnd(-0.06, -0.02), r: o.r ?? rnd(10, 22), gr: o.gr ?? rnd(0.03, 0.06), a: o.a ?? 0.6, life: o.life ?? rnd(1300, 2200), age: 0 });
    },
    spark(x, y, vx, vy) {
      P.push({ k: 'k', x, y, vx, vy, life: rnd(260, 520), age: 0 });
    },
    line(y, v, len, a = 0.5) {
      P.push({ k: 'l', x: W + len, y, vx: -v, len, a, life: (W + len * 2) / v, age: 0 });
    },
    clear() {
      P.length = 0;
    },
    step(dt) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.age += dt;
        if (p.age >= p.life) {
          P.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const f = 1 - p.age / p.life;
        if (p.k === 's') {
          p.r += p.gr * dt;
          p.vx *= 0.995;
          ctx.globalAlpha = p.a * f * Math.min(1, p.age / 120);
          ctx.drawImage(sprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        } else if (p.k === 'k') {
          p.vy += 0.0012 * dt;
          ctx.globalAlpha = f;
          ctx.strokeStyle = '#ffd36a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 18, p.y - p.vy * 18);
          ctx.stroke();
        } else {
          ctx.globalAlpha = p.a * Math.min(1, f * 3);
          ctx.fillStyle = '#e8ecf5';
          ctx.fillRect(p.x, p.y, p.len, 1.6);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}

// one shake from several impulses {t, amp, dur}
const shakeAt = (t, list) => {
  let x = 0, y = 0;
  list.forEach((s, i) => {
    const k = (t - s.t) / s.dur;
    if (k < 0 || k > 1) return;
    const a = s.amp * (1 - k) * (1 - k);
    x += a * Math.sin(t * 0.093 + i * 1.7);
    y += a * Math.cos(t * 0.117 + i * 2.3);
  });
  return [x, y];
};

export function playCine(v, { haptic = () => {}, again = false, onDone = () => {}, after = (f) => f() } = {}) {
  v = CINE[v] ? v : 'A';
  const def = CINE[v];
  const rm = reduced();
  const el = document.createElement('div');
  el.className = `reel cine cine-${v.toLowerCase()}${rm ? ' rm' : ''}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Інтро АВТОДРОП');
  el.innerHTML = sceneHtml(v, again);
  document.body.appendChild(el);

  const q = (s) => el.querySelector(s);
  const cam = q('.cn-cam'), fx = makeFx(q('.cn-fx'));
  const cars = {};
  el.querySelectorAll('.cn-car').forEach((c) => {
    cars[c.dataset.car] = { el: c, body: c.querySelector('.cn-body'), g1: c.querySelector('.cn-g1'), g2: c.querySelector('.cn-g2'), tail: c.querySelector('.cn-tail'), head: c.querySelector('.cn-head'), sweep: c.querySelector('.cn-sweep b'), refl: c.querySelector('.cn-refl'), img: c.querySelector('.cn-img'), ww: c.querySelector('.ww'), w: 0, turn: 0 };
    const d = wheelData(c.dataset.model), C = cars[c.dataset.car];
    if (C.ww && d) {
      // the disc photo goes in through CSSOM (as race-wheels.js does); r = mean wheel radius as a share of the photo width
      const url = `url("${(C.img.currentSrc || C.img.getAttribute('src')).replace(/"/g, '%22')}")`;
      C.ww.querySelectorAll('.ww-p').forEach((p) => (p.style.backgroundImage = url));
      C.spin = [...C.ww.querySelectorAll('.ww-s')];
      C.r = d.wheels.reduce((a, q) => a + Math.sqrt(q.a * q.b), 0) / d.wheels.length / d.w;
    }
  });
  const N = {
    bg: q('.cn-bg'), dark: q('.cn-dark'), night: q('.cn-night'), flash: q('.cn-flash'), mark: q('.cn-word'), tape: q('.cn-tape'),
    k: q('.cn-k'), t: q('.cn-t'), p: q('.cn-p'), go: q('.cn-go'), skip: q('.cn-skip'), hint: q('.cn-hint'),
    road: q('.cn-dash.d1'), road2: q('.cn-dash.d2'), posts: [...el.querySelectorAll('.cn-posts i')], world: q('.cn-world'), poster: q('.cn-poster'),
    tree: [...el.querySelectorAll('.cn-tree i')], treeBox: q('.cn-tree'), stage: q('.cn-stage'), cone: q('.cn-cone'),
  };
  let W = 0, H = 0;
  const L = {};
  const layout = () => {
    W = el.clientWidth;
    H = el.clientHeight;
    fx.size(W, H);
    // lanes: the ground line (y of the tyres) and the car width per depth
    L.gF = H * 0.556;
    L.gM = H * 0.614;
    L.gH = H * 0.672;
    L.wF = Math.min(W * 0.5, 300);
    L.wM = Math.min(W * 0.74, 430);
    L.wH = Math.min(W * 1.02, 560);
    const ws = { far: L.wF, mid: L.wM, hero: L.wH, pl: Math.min(W * 0.5, 290), pr: Math.min(W * 0.5, 290), ph: Math.min(W * 0.96, 540) };
    for (const k in cars) {
      cars[k].w = ws[k];
      cars[k].el.style.width = `${ws[k]}px`;
    }
  };
  layout();

  // The wheels roll with the car's speed over the road (px/ms): true rolling turns, capped at the race's WW_CAP (a
  // faster turn strobes at 60 Hz), the level 0–3 brings the race's trailing copies / rim haze / blur streak.
  let DT = 0; // ms since the last drawn frame (0 on a jump: the wheels keep their angle)
  const roll = (c, ground) => {
    if (!c.spin) return;
    const rPx = c.r * c.w, real = ground > 0.002 ? (ground * 1000) / (2 * Math.PI * rPx) : 0;
    c.turn = (c.turn + Math.min(real, WW_CAP) * 360 * (DT / 1000)) % 360;
    const lvl = real <= 0 ? 0 : real < WW_CAP * 0.9 ? 1 : real < WW_CAP * 2.2 ? 2 : 3;
    if (String(lvl) !== c.ww.dataset.s) c.ww.dataset.s = String(lvl);
    const tr = `rotate(${c.turn.toFixed(1)}deg)`;
    c.spin.forEach((s) => (s.style.transform = tr));
  };
  // place a car: x = its left edge, g = the ground line; r = pitch in deg; vx = speed px/ms on screen (the ghost
  // trail); ground = its speed over the road (the wheels), the screen speed unless the world moves under it
  const put = (c, x, g, r = 0, vx = 0, o = 1, ground = Math.abs(vx)) => {
    roll(c, o ? ground : 0);
    const h = c.w / 2.5;
    c.el.style.transform = `translate3d(${x.toFixed(1)}px,${(g - h * 0.95).toFixed(1)}px,0) rotate(${r.toFixed(2)}deg)`;
    c.el.style.opacity = o;
    const s = Math.min(1, Math.abs(vx) / 2.2), d = Math.min(c.w * 0.32, Math.abs(vx) * 55);
    c.g1.style.transform = `translateX(${(-d * 0.45).toFixed(1)}px)`;
    c.g2.style.transform = `translateX(${(-d).toFixed(1)}px)`;
    c.g1.style.opacity = (0.5 * s).toFixed(2);
    c.g2.style.opacity = (0.26 * s).toFixed(2);
  };
  const tf = (n, x = 0, y = 0, s = 1, r = 0, o = 1) => {
    if (!n) return;
    n.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${s.toFixed(3)}) rotate(${r.toFixed(2)}deg)`;
    n.style.opacity = o.toFixed(3);
  };
  const ctaIn = (t, t0) => {
    [N.k, N.t, N.p, N.go].forEach((n, i) => {
      const e = eOut(seg(t, t0 + i * 110, t0 + i * 110 + 420));
      tf(n, 0, 24 * (1 - e), 1, 0, e);
    });
    el.classList.toggle('cta', t >= t0 + 330);
  };
  const slam = (t, t0) => {
    const k = seg(t, t0, t0 + 230), o = seg(t, t0, t0 + 90);
    const sq = t > t0 + 230 ? 1 - 0.05 * bump(t, t0 + 230, t0 + 430) : 2.7 - 1.7 * eIn(k);
    tf(N.mark, 0, 0, sq, 0, o);
    const tk = seg(t, t0 + 200, t0 + 520);
    N.tape.style.transform = `rotate(-4deg) scaleX(${eBack(tk).toFixed(3)})`;
    N.tape.style.opacity = seg(t, t0 + 200, t0 + 300).toFixed(2);
  };
  const sweep = (c, t, t0) => c && (c.sweep.style.transform = `translateX(${lerp(-120, 320, eIO(seg(t, t0, t0 + 750))).toFixed(1)}%) skewX(-18deg)`);

  // ----- A: «Нічний заліт» -----
  const A = {
    shakes: [{ t: 0, amp: 1.4, dur: 950 }, { t: 1300, amp: 4, dur: 350 }, { t: 1640, amp: 7, dur: 420 }, { t: 2700, amp: 13, dur: 560 }, { t: 3230, amp: 9, dur: 420 }],
    taps: [[960, 'medium'], [1640, 'light'], [2700, 'heavy'], [3230, 'rigid']],
    // the RX-7 rolls in out of the dark with only its own lamps lit, then rips across once the street lights up
    farX: (t) => (t < 1050 ? lerp(-L.wF * 0.98, -L.wF * 0.42, eOut(seg(t, 0, 1050))) : lerp(-L.wF * 0.42, W + 80, eIn(seg(t, 1050, 1600)) * 0.55 + seg(t, 1050, 1600) * 0.45)),
    midX: (t) => lerp(W + 40, -L.wM - 80, seg(t, 1360, 1980)),
    heroX: (t) => lerp(-L.wH * 1.3, (W - L.wH) / 2 - W * 0.01, eOut4(seg(t, 1900, 2760))),
    frame(t, dt, live) {
      const [sx, sy] = shakeAt(t, this.shakes);
      const z = 1.12 - 0.12 * eOut(seg(t, 1900, 2950));
      const tilt = 0.9 * bump(t, 1050, 1980) - 0.5 * bump(t, 2500, 3100);
      cam.style.transformOrigin = `50% 62%`;
      cam.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0) scale(${z.toFixed(4)}) rotate(${tilt.toFixed(2)}deg)`;
      tf(N.bg, -34 * eOut(seg(t, 1900, 2950)) + 10 * bump(t, 1050, 1980), 0, 1.06);
      N.dark.style.opacity = '0';
      const nk = seg(t, 960, 1250);
      N.night.style.opacity = (1 - nk).toFixed(3);
      const lit = (0.16 + 0.84 * nk).toFixed(3); // the car itself is unlit in the dark: only its lamps show
      [cars.far.img, cars.far.ww, cars.far.refl].forEach((n) => n && (n.style.filter = nk < 1 ? `brightness(${lit})` : ''));
      N.flash.style.opacity = (0.55 * (seg(t, 900, 960) - seg(t, 960, 1300)) + 0.4 * (seg(t, 3200, 3230) - seg(t, 3230, 3480))).toFixed(3);
      const fx0 = this.farX(t), mx0 = this.midX(t), hx0 = this.heroX(t);
      put(cars.far, fx0, L.gF, 0, (fx0 - this.farX(t - 16)) / 16, t < 1640 ? 1 : 0);
      cars.far.head.style.opacity = '1';
      cars.far.tail.style.opacity = '0.5';
      put(cars.mid, mx0, L.gM, 0, (mx0 - this.midX(t - 16)) / 16, t > 1350 && t < 2000 ? 1 : 0);
      cars.mid.head.style.opacity = '1';
      cars.mid.tail.style.opacity = '0.5';
      const hv = (hx0 - this.heroX(t - 16)) / 16;
      const pitch = 1.9 * bump(t, 2250, 2900) - 0.7 * bump(t, 2900, 3250);
      put(cars.hero, hx0, L.gH, pitch, hv, t > 1890 ? 1 : 0);
      cars.hero.tail.style.opacity = (0.35 + 0.65 * (seg(t, 2150, 2250) - seg(t, 2950, 3300))).toFixed(2);
      cars.hero.head.style.opacity = '1';
      sweep(cars.hero, t, 3450);
      slam(t, 3000);
      ctaIn(t, def.cta);
      if (!live) return;
      // smoke off both tyres while the hero brakes, a burst when it stops, idle haze after
      const hw = cars.hero.w, hh = hw / 2.5;
      if (t > 2150 && t < 2880) {
        const n = dt * (0.12 + 0.3 * (1 - seg(t, 2150, 2880)));
        for (let i = 0; i < n; i++) {
          fx.smoke(hx0 + hw * rnd(0.16, 0.25), L.gH - hh * 0.06, { vx: rnd(-0.08, 0.02), vy: rnd(-0.07, -0.02), r: rnd(12, 24) });
          if (Math.random() < 0.6) fx.smoke(hx0 + hw * rnd(0.74, 0.82), L.gH - hh * 0.06, { vx: rnd(-0.05, 0.05), r: rnd(10, 20) });
        }
      }
      if (t >= 2700 && t - dt < 2700) {
        for (let i = 0; i < 34; i++) fx.smoke(hx0 + hw * rnd(0.05, 0.95), L.gH - hh * rnd(0, 0.2), { vx: rnd(-0.22, 0.22), vy: rnd(-0.14, -0.03), r: rnd(18, 40), gr: rnd(0.05, 0.09), a: 0.5 });
        for (let i = 0; i < 14; i++) fx.spark(hx0 + hw * 0.8, L.gH - 4, rnd(0.2, 0.7), rnd(-0.5, -0.1));
      }
      if (t > 3000 && Math.random() < dt * 0.012) fx.smoke(rnd(0, W), L.gH + rnd(-10, 6), { vx: rnd(-0.02, 0.02), vy: rnd(-0.02, -0.005), r: rnd(30, 60), gr: 0.02, a: 0.22, life: 3200 });
      // speed lines with each pass
      if ((t > 1050 && t < 1950) || (t > 1900 && t < 2500)) for (let i = 0; i < dt * 0.06; i++) fx.line(rnd(H * 0.35, H * 0.72), rnd(2.4, 4.2), rnd(60, 180), rnd(0.15, 0.45));
    },
  };

  // ----- B: «Драг-старт» -----
  const X0 = () => W * 0.9; // the start line: all three noses on it
  const B = {
    shakes: [{ t: 330, amp: 1.5, dur: 220 }, { t: 630, amp: 1.8, dur: 220 }, { t: 930, amp: 2.2, dur: 240 }, { t: 1250, amp: 12, dur: 600 }, { t: 3800, amp: 6, dur: 300 }, { t: 4230, amp: 9, dur: 420 }],
    taps: [[330, 'light'], [630, 'light'], [930, 'light'], [1250, 'heavy'], [3800, 'medium'], [4230, 'rigid']],
    // world speed (px/ms) and the distance it has travelled, integrated in closed form
    speed: (t) => (t < 1250 ? 0 : t < 2300 ? 3.0 * Math.pow((t - 1250) / 1050, 2) : 3.0),
    dist(t) {
      if (t < 1250) return 0;
      const a = Math.min(t, 2300) - 1250;
      return 3.0 * Math.pow(a, 3) / (3 * 1050 * 1050) + (t > 2300 ? 3.0 * (t - 2300) : 0);
    },
    // each car's x (its nose, then minus its width): all three noses on the line → the Huracan jumps first, the
    // hero bogs then reels it in and pulls ahead, the Supra fades back → all three out of frame to the right
    cx(k, t) {
      const w = cars[k].w, X = X0();
      const out = (t0) => eIn(seg(t, t0, t0 + 480)) * (W * 1.7);
      const a = (t0, t1) => eIO(seg(t, t0, t1));
      let nose;
      if (k === 'hero') nose = X - W * 0.06 * a(1250, 1700) + W * 0.24 * a(1700, 3100) + 6 * Math.sin(t / 170) * seg(t, 1400, 1600) + out(3300);
      else if (k === 'mid') nose = X + W * 0.16 * a(1250, 2000) - W * 0.2 * a(2100, 3100) + out(3390);
      else nose = X + W * 0.07 * a(1250, 1900) - W * 0.2 * a(1900, 3100) + out(3460);
      return nose - w;
    },
    frame(t, dt, live) {
      const [sx, sy] = shakeAt(t, this.shakes);
      const race = t >= 1250 && t < 3800;
      const vib = race ? 1.4 : 0;
      const jx = vib * Math.sin(t * 0.21), jy = vib * Math.cos(t * 0.27);
      // camera: a 2.3× close-up on the hero's rear wheel pulls back to the full line by the green
      const hero = cars.hero, hw = hero.w, hh = hw / 2.5;
      const k0 = eIO(seg(t, 150, 1250));
      const z = lerp(2.3, 1, k0) + 0.07 * eOut(seg(t, 1300, 2000)) - 0.07 * seg(t, 3000, 3700);
      const fxp = lerp(this.cx('hero', 0) + hw * 0.24, W / 2, k0), fyp = lerp(L.gH - hh * 0.3, H * 0.56, k0);
      const tilt = -1.3 * seg(t, 1300, 1900) + 1.3 * seg(t, 3000, 3600);
      const poster = t >= 3800;
      el.classList.toggle('ph-poster', poster);
      if (!poster) {
        cam.style.transformOrigin = '0 0';
        cam.style.transform = `translate3d(${(W / 2 + sx + jx).toFixed(1)}px,${(H * 0.56 + sy + jy).toFixed(1)}px,0) rotate(${tilt.toFixed(2)}deg) scale(${z.toFixed(4)}) translate(${(-fxp).toFixed(1)}px,${(-fyp).toFixed(1)}px)`;
      } else {
        const pz = 1.08 - 0.08 * eOut(seg(t, 3800, 4500));
        cam.style.transformOrigin = '50% 62%';
        cam.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0) scale(${pz.toFixed(4)})`;
      }
      // the world streams past
      const d = this.dist(t);
      tf(N.bg, -Math.min(40, d * 0.006), 0, 1.08);
      const period = 120;
      N.road.style.transform = `translate3d(${(-(d % period)).toFixed(1)}px,0,0)`;
      N.road2.style.transform = `translate3d(${(-((d * 1.15) % period)).toFixed(1)}px,0,0)`;
      const sp = W * 0.9;
      N.posts.forEach((p, i) => {
        const x = ((i * sp - d * 0.8) % (sp * N.posts.length) + sp * N.posts.length) % (sp * N.posts.length) - sp * 0.5;
        p.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
      });
      // cars
      const v = this.speed(t);
      for (const k of ['far', 'mid', 'hero']) {
        const c = cars[k], x = this.cx(k, t), xv = (x - this.cx(k, t - 16)) / 16;
        const g = { far: L.gF, mid: L.gM, hero: L.gH }[k];
        const idle = t < 1250 ? 0.6 * Math.sin(t * 0.33 + k.length) : 0;
        const pitch = -2.4 * bump(t, 1250, 1800) * (k === 'hero' ? 1 : 0.7);
        put(c, x, g + idle, pitch, xv + v * 0.9, poster ? 0 : 1, Math.max(0, xv + v));
        c.tail.style.opacity = t < 1250 ? '0.55' : '0.3';
        c.head.style.opacity = '1';
      }
      // the tree
      N.tree.forEach((n, i) => n.classList.toggle('on', i === 0 ? t < 1700 : i < 4 ? t >= 330 + (i - 1) * 300 && t < 1250 : t >= 1250 && t < 2000));
      N.treeBox.style.opacity = (1 - seg(t, 1800, 2200)).toFixed(2);
      N.flash.style.opacity = (seg(t, 3740, 3800) - seg(t, 3800, 4250) + 0.4 * (seg(t, 4210, 4230) - seg(t, 4230, 4500))).toFixed(3);
      N.dark.style.opacity = (0.55 * (1 - seg(t, 0, 500))).toFixed(3);
      // the poster: three cars settle on the stage
      const pk = eOut(seg(t, 3800, 4500));
      const pg = H * 0.62;
      put(cars.pl, W * 0.5 - cars.pl.w * 1.02 - 40 * (1 - pk), pg - H * 0.035, 0, 0, poster ? 1 : 0);
      put(cars.pr, W * 0.5 + cars.pr.w * 0.02 + 40 * (1 - pk), pg - H * 0.035, 0, 0, poster ? 1 : 0);
      put(cars.ph, (W - cars.ph.w) / 2 + 60 * (1 - pk), H * 0.67, 0, poster ? 1.6 * (1 - pk) : 0, poster ? 1 : 0);
      cars.ph.tail.style.opacity = '0.4';
      cars.ph.head.style.opacity = '1';
      tf(N.cone, 0, 0, 1, 0, poster ? seg(t, 3900, 4400) : 0);
      sweep(cars.ph, t, 4450);
      slam(t, 4000);
      ctaIn(t, def.cta);
      if (!live) return;
      // smoke: idle exhaust at the line, a wall of it on the green, a trail while they launch, haze on the stage
      for (const k of ['far', 'mid', 'hero']) {
        const c = cars[k], x = this.cx(k, t), g = { far: L.gF, mid: L.gM, hero: L.gH }[k], ch = c.w / 2.5;
        if (t < 1250 && Math.random() < dt * 0.01) fx.smoke(x + c.w * 0.02, g - ch * 0.18, { vx: rnd(-0.05, -0.02), vy: rnd(-0.03, -0.01), r: rnd(4, 9), gr: 0.02, a: 0.4, life: 900 });
        if (t >= 1250 && t - dt < 1250) for (let i = 0; i < 16; i++) fx.smoke(x + c.w * rnd(0.12, 0.28), g - ch * 0.05, { vx: rnd(-0.3, -0.05), vy: rnd(-0.12, -0.02), r: rnd(16, 34), gr: rnd(0.06, 0.1), a: 0.55 });
        if (t > 1250 && t < 2100 && Math.random() < dt * 0.05) fx.smoke(x + c.w * 0.2, g - ch * 0.05, { vx: -v * 0.8 - rnd(0.05, 0.2), vy: rnd(-0.05, -0.01), r: rnd(12, 24), gr: 0.06, a: 0.45 });
      }
      if (race) for (let i = 0; i < dt * 0.05 * Math.min(1, v / 1.5); i++) fx.line(rnd(H * 0.3, H * 0.75), rnd(3, 5), rnd(80, 220), rnd(0.12, 0.4));
      if (t >= 3800 && t - dt < 3800) fx.clear();
      if (poster && Math.random() < dt * 0.014) fx.smoke(rnd(-40, W + 40), H * 0.67 + rnd(-8, 8), { vx: rnd(-0.02, 0.02), vy: rnd(-0.015, -0.004), r: rnd(30, 70), gr: 0.025, a: 0.2, life: 3400 });
    },
  };

  const P = v === 'A' ? A : B;
  let t = 0, last = 0, raf = 0, done = false, started = false;
  const tick = (now) => {
    if (done) return;
    const dt = Math.min(50, last ? now - last : 16);
    last = now;
    const prev = t;
    t += dt;
    for (const [at, kind] of P.taps) if (prev < at && t >= at) haptic(kind);
    DT = dt;
    P.frame(t, dt, true);
    fx.step(dt);
    if (t >= def.end) el.classList.add('done');
    raf = requestAnimationFrame(tick);
  };
  const toEnd = () => {
    if (t >= def.end) return;
    t = def.end;
    fx.clear();
    DT = 0;
    P.frame(t, 16, false);
    el.classList.add('done', 'skipped');
  };
  const close = (how) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    el.classList.add('out');
    setTimeout(() => el.remove(), rm ? 0 : 320);
    onDone(how);
  };
  const onResize = () => {
    layout();
    if (rm || !started) P.frame(rm ? def.end : t, 16, false);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close('skip');
    else if (e.key === 'Enter' && t >= def.cta) close('cta');
    else if (e.key === ' ' || e.key === 'ArrowRight') toEnd();
  };
  addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', (e) => {
    if (e.target.closest('.cn-skip')) return close('skip');
    if (e.target.closest('.cn-go')) return close('cta');
    if (t < def.cta) {
      haptic('light');
      toEnd();
    }
  });

  if (rm) {
    t = def.end;
    P.frame(t, 16, false);
    el.classList.add('done');
    return { close, el };
  }
  P.frame(0, 16, false);
  // start once the photos are decoded (the splash has usually warmed them), never later than 1.2 s
  const srcs = [...new Set([...el.querySelectorAll('img')].map((i) => i.currentSrc || i.src))];
  const ready = Promise.all(srcs.map((s) => {
    const im = new Image();
    im.src = s;
    return im.decode ? im.decode().catch(() => {}) : Promise.resolve();
  }));
  after(() => Promise.race([ready, new Promise((r) => setTimeout(r, 1200))]).then(() => {
    if (done || started) return;
    started = true;
    raf = requestAnimationFrame(tick);
  }));
  return { close, el, toEnd };
}
