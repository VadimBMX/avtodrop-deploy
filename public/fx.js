// Visual effects for drops and rewards: canvas particles, flashes, light rays, shake, counters, flying coins.
// No dependencies. Only transform/opacity are animated on DOM nodes; particles live on one fixed canvas that
// stops its loop as soon as nothing is moving. Under prefers-reduced-motion: no shake or rays, fewer particles.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX = reduced ? 60 : 260; // hard cap on live particles (a mid phone keeps 60 fps well under this)
const SCALE = reduced ? 0.3 : 1; // particle counts under reduced motion

let canvas, ctx, raf = 0, W = 0, H = 0;
let particles = [];
function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  const resize = () => {
    const d = Math.min(1.5, devicePixelRatio || 1); // soft glowing sparks don't need retina pixels; 1.5 vs 3 is 4× less fill
    W = innerWidth;
    H = innerHeight;
    canvas.width = W * d;
    canvas.height = H * d;
    canvas.dpr = d;
  };
  resize();
  addEventListener('resize', resize);
}
// Glowing sprites are pre-rendered once per colour+shape: drawImage is far cheaper than shadowBlur per particle.
const sprites = new Map();
function sprite(shape, color) {
  const k = shape + color;
  let s = sprites.get(k);
  if (s) return s;
  const R = 32;
  s = document.createElement('canvas');
  s.width = s.height = R * 2;
  const c = s.getContext('2d');
  c.translate(R, R);
  if (shape === 'coin') {
    const g = c.createRadialGradient(-6, -8, 2, 0, 0, 24);
    g.addColorStop(0, '#fff6c2');
    g.addColorStop(0.45, '#ffcc1a');
    g.addColorStop(1, '#b37a00');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 24, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#8a5d00';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(0, 0, 16, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#8a5d00';
    c.font = 'bold 22px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('₴', 0, 1);
  } else {
    // '#fff' → '#ffffff' so an alpha suffix can be appended; anything that isn't hex falls back to white.
    color = /^#[0-9a-f]{3}$/i.test(color) ? '#' + [...color.slice(1)].map((x) => x + x).join('') : /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
    const glow = c.createRadialGradient(0, 0, 0, 0, 0, R);
    glow.addColorStop(0, color + 'cc');
    glow.addColorStop(0.35, color + '55');
    glow.addColorStop(1, color + '00');
    c.fillStyle = glow;
    c.fillRect(-R, -R, R * 2, R * 2);
    c.fillStyle = '#fff';
    if (shape === 'star') {
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const rr = i % 2 ? 4 : 14, a = (i * Math.PI) / 4;
        c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.closePath();
      c.fill();
    } else {
      c.beginPath();
      c.arc(0, 0, 5, 0, Math.PI * 2);
      c.fill();
    }
  }
  sprites.set(k, s);
  return s;
}
function loop() {
  const d = canvas.dpr, now = performance.now();
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, W, H);
  let n = 0;
  for (const p of particles) {
    if (p.life <= 0) continue;
    particles[n++] = p;
    p.life -= 1;
    if (p.path) {
      // Flying coin: a quadratic curve from start to target with ease-in, then a callback on arrival.
      // Time-based (not frame-based) so coins land on time even when frames drop.
      const t = Math.max(0, Math.min(1, (now - p.path.start) / p.path.dur)), e = t * t;
      p.life = 2;
      const { x0, y0, cx, cy, x1, y1 } = p.path;
      p.x = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * cx + e * e * x1;
      p.y = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * cy + e * e * y1;
      if (t >= 1) {
        p.life = 0;
        p.done?.();
      }
    } else {
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity;
      p.x += p.vx;
      p.y += p.vy;
    }
    p.rot += p.vr;
    ctx.globalAlpha = p.path ? 1 : Math.min(1, p.life / 30);
    if (p.shape === 'conf') {
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const f = Math.max(0.25, Math.abs(Math.cos(p.rot * 1.7))); // flutter: rotate, then squash along y
      ctx.setTransform(d * c, d * s, -d * s * f, d * c * f, p.x * d, p.y * d);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    } else {
      const img = sprite(p.shape, p.color), sz = p.size * (p.shape === 'coin' ? 1 : 3.2);
      ctx.drawImage(img, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
  }
  particles.length = n;
  ctx.globalAlpha = 1;
  raf = n ? requestAnimationFrame(loop) : 0;
  if (!n) ctx.clearRect(0, 0, W, H);
}
function add(list) {
  ensureCanvas();
  const room = MAX - particles.length;
  if (room <= 0) return;
  particles.push(...list.slice(0, room));
  if (!raf) raf = requestAnimationFrame(loop);
}
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const scaled = (n) => Math.max(1, Math.round(n * SCALE));

// Radial burst from a point (e.g. the centre of a dropped car).
export function burst(x, y, colors, { count = 60, power = 9, shape = 'spark', gravity = 0.12, life = 70 } = {}) {
  add(Array.from({ length: scaled(count) }, () => {
    const a = rand(0, Math.PI * 2), v = rand(power * 0.3, power);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.94, gravity, rot: rand(0, 6), vr: rand(-0.2, 0.2), size: rand(3, 7), color: pick(colors), shape: shape === 'mix' ? pick(['spark', 'star', 'conf']) : shape, life: rand(life * 0.6, life) };
  }));
}
// Confetti from both bottom corners.
export function confetti(colors, amount = 1) {
  const n = scaled(Math.round(55 * amount));
  ensureCanvas();
  const side = (x, dir) => Array.from({ length: n }, () => ({
    x, y: H + 10, vx: dir * rand(3, 8), vy: -rand(12, 21), drag: 0.985, gravity: 0.32, rot: rand(0, 6), vr: rand(-0.3, 0.3),
    size: rand(7, 12), color: pick(colors), shape: 'conf', life: rand(110, 160),
  }));
  add([...side(-10, 1), ...side(W + 10, -1)]);
}
// Twinkling stars around an element.
export function sparkle(el, colors, count = 14) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  add(Array.from({ length: scaled(count) }, () => ({
    x: rand(r.left, r.right), y: rand(r.top, r.bottom), vx: rand(-0.6, 0.6), vy: rand(-1.4, -0.2), drag: 0.98, gravity: 0, rot: 0, vr: rand(-0.05, 0.05),
    size: rand(4, 8), color: pick(colors), shape: 'star', life: rand(40, 80),
  })));
}
export function flash(color = '#fff', strength = 0.6, ms = 500) {
  const el = document.createElement('div');
  el.className = 'fx-flash';
  el.style.background = `radial-gradient(circle at 50% 40%, ${color}, transparent 70%)`;
  el.style.setProperty('--o', reduced ? Math.min(strength, 0.12) : strength);
  el.style.animationDuration = ms + 'ms';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms + 50);
}
// Never shake #app: it holds the fixed header/tab bar, and a transformed ancestor would un-fix them mid-shake.
export function shake(el = document.querySelector('#view'), ms = 450, strong = false) {
  if (reduced || !el) return;
  el.classList.remove('fx-shake', 'strong');
  void el.offsetWidth;
  el.classList.add('fx-shake');
  if (strong) el.classList.add('strong');
  el.style.animationDuration = ms + 'ms';
  setTimeout(() => el.classList.remove('fx-shake', 'strong'), ms);
}
// Rotating light rays behind an element.
export function rays(host, color, strong = false) {
  if (!host || reduced) return;
  host.querySelector(':scope > .fx-rays')?.remove();
  const el = document.createElement('div');
  el.className = 'fx-rays' + (strong ? ' strong' : '');
  el.style.setProperty('--c', color);
  host.prepend(el);
}
// Number tween with ease-out; `from` lets a balance count from its old value.
export function tween(el, from, to, ms, format, delay = 0) {
  if (!el) return;
  const id = (el._fxTw = (el._fxTw || 0) + 1); // a newer tween (or stopTween) on the same element wins
  if (reduced || from === to) return void (el.textContent = format(to), el.dataset.tweening = '');
  const t0 = performance.now() + delay;
  const step = (t) => {
    if (!el.isConnected || el._fxTw !== id) return;
    const k = Math.max(0, Math.min(1, (t - t0) / ms));
    el.textContent = format(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
    else el.dataset.tweening = '';
  };
  el.dataset.tweening = '1';
  requestAnimationFrame(step);
}
export function stopTween(el) {
  if (!el) return;
  el._fxTw = (el._fxTw || 0) + 1;
  el.dataset.tweening = '';
}
export const countUp =(el, to, ms, format) => tween(el, 0, to, ms, format);
export const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};
// Scale pop on any element (WAAPI, transform only).
export function popEl(el, scale = 1.12, ms = 420) {
  if (!el?.animate || reduced) return;
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})`, offset: 0.35 }, { transform: 'scale(.98)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' });
}
// Button press: a squash and a spring back.
export function press(el) {
  if (!el?.animate || reduced) return;
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.92)', offset: 0.3 }, { transform: 'scale(1.04)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
}
// Coins fly from a point to an element (the balance chip); onEach fires as each one lands.
export function coinFly([x, y], toEl, { count = 10, onEach, onDone } = {}) {
  if (!toEl) return onDone?.();
  let [tx, ty] = centerOf(toEl);
  ty = Math.max(14, ty); // header scrolled away: aim at the top edge above where the chip lives
  const n = Math.max(3, scaled(count));
  let left = n;
  const t0 = performance.now();
  add(Array.from({ length: n }, (_, i) => {
    const sx = x + rand(-26, 26), sy = y + rand(-14, 14);
    return { x: sx, y: sy, rot: 0, vr: 0, size: 18, color: '#ffcc1a', shape: 'coin', life: 2,
      path: { x0: sx, y0: sy, cx: (sx + tx) / 2 + rand(-90, 90), cy: Math.max(10, Math.min(sy, ty) - rand(40, 140)), x1: tx, y1: ty, start: t0 + i * 32, dur: rand(480, 620) },
      done: () => {
        onEach?.(n - left);
        if (--left === 0) onDone?.();
      } };
  }));
}
// "+12 345 ₴" rising under the balance chip, counting up as it goes.
export function gainLabel(toEl, amount, format) {
  if (!toEl) return;
  const r = toEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'fx-gain';
  el.style.left = `${Math.max(8, Math.min(innerWidth - 8, r.left + r.width / 2))}px`;
  // Claim banners can sit over the header: then the label goes just under them.
  const banners = document.getElementById('banners');
  const under = banners?.children.length ? banners.getBoundingClientRect().bottom : 0;
  el.style.top = `${Math.max(8, r.bottom + 6, under + 6)}px`;
  document.body.appendChild(el);
  tween(el, 0, amount, 650, (v) => '+' + format(v));
  setTimeout(() => el.remove(), 1700);
}

// Case drop on screen. Every class gets a glow + pop (CSS); B adds sparkles, A a burst in the class colour,
// S/X a bigger burst, rays, a brief flash and a short screen shake. «Нова в колекції» gets its own twinkle.
export function dropShow(rank, color, { host, target, newEl } = {}) {
  const [x, y] = target ? centerOf(target) : [innerWidth / 2, innerHeight / 3];
  const palette = [color, '#ffffff', color];
  if (target) sparkle(target, [color, '#ffffff'], 4 + rank * 2);
  if (rank >= 3) burst(x, y, palette, { count: rank >= 4 ? 85 : 55, power: rank >= 4 ? 12 : 8, shape: rank >= 4 ? 'mix' : 'spark', life: rank >= 4 ? 90 : 70 });
  if (rank >= 3) rays(host, color, rank >= 4);
  if (rank >= 4) {
    flash(color, 0.3, 550);
    shake(undefined, 380, rank >= 5);
    setTimeout(() => burst(x, y, [color, '#fff', '#ffd500'], { count: 50, power: 15, shape: 'star', life: 100, gravity: 0.08 }), 260);
  }
  if (newEl) setTimeout(() => sparkle(newEl, ['#ffd500', '#ffffff', color], 10), 450);
}
// Quiet effect (dealer/trade-in): a few sparkles in the rarity colour, soft rays and a faint glow for the rare ones.
export function reveal(rank, color, { host, target } = {}) {
  if (target) sparkle(target, [color, '#ffffff'], 4 + rank * 2);
  if (rank >= 3) rays(host, color, false);
  if (rank >= 4) flash(color, 0.12, 500);
}
// One call that scales the whole show with rarity (class rank 0 = D … 5 = X).
export function celebrate(rank, color, { host, target } = {}) {
  const [x, y] = target ? centerOf(target) : [innerWidth / 2, innerHeight / 3];
  const palette = [color, '#ffffff', '#ffd500'];
  if (rank >= 2) rays(host, color, rank >= 4);
  if (rank === 0) sparkle(target, [color, '#fff'], 10);
  if (rank >= 1) burst(x, y, palette, { count: 30 + rank * 20, power: 6 + rank * 1.5, shape: rank >= 3 ? 'mix' : 'spark' });
  if (rank >= 2) flash(color, 0.2 + rank * 0.08, 450 + rank * 80);
  if (rank >= 3) {
    confetti([color, '#ffd500', '#ffffff', '#2f7bff'], rank >= 4 ? 1.4 : 0.7);
    shake(undefined, 300 + rank * 50);
  }
  if (rank >= 4) setTimeout(() => burst(x, y, palette, { count: 90, power: 14, shape: 'mix', life: 100 }), 350);
}
