// Visual effects for drops: particles, flashes, light rays, shake, counters. No dependencies.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let canvas, ctx, raf = 0;
let particles = [];
function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  const resize = () => {
    const d = devicePixelRatio || 1;
    canvas.width = innerWidth * d;
    canvas.height = innerHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
}
function loop() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + p.gravity;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 1;
    const a = Math.min(1, p.life / 30);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === 'spark') {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.shape === 'star') {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      star(p.size);
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    ctx.restore();
  }
  raf = particles.length ? requestAnimationFrame(loop) : 0;
}
function star(r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.35 : r;
    const a = (i * Math.PI) / 4;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
function add(list) {
  if (reduced) return;
  ensureCanvas();
  particles.push(...list);
  if (!raf) raf = requestAnimationFrame(loop);
}
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Radial burst from a point (e.g. the centre of a dropped car).
export function burst(x, y, colors, { count = 60, power = 9, shape = 'spark', gravity = 0.12, life = 70 } = {}) {
  add(Array.from({ length: count }, () => {
    const a = rand(0, Math.PI * 2), v = rand(power * 0.3, power);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.94, gravity, rot: 0, vr: rand(-0.2, 0.2), size: rand(3, 7), color: pick(colors), shape: shape === 'mix' ? pick(['spark', 'star', 'conf']) : shape, life: rand(life * 0.6, life) };
  }));
}
// Confetti from both bottom corners.
export function confetti(colors, amount = 1) {
  const n = Math.round(70 * amount);
  const side = (x, dir) => Array.from({ length: n }, () => ({
    x, y: innerHeight + 10, vx: dir * rand(3, 9), vy: -rand(12, 22), drag: 0.985, gravity: 0.32, rot: rand(0, 6), vr: rand(-0.3, 0.3),
    size: rand(7, 12), color: pick(colors), shape: 'conf', life: rand(110, 170),
  }));
  add([...side(-10, 1), ...side(innerWidth + 10, -1)]);
}
// Twinkling stars around an element.
export function sparkle(el, colors, count = 14) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  add(Array.from({ length: count }, () => ({
    x: rand(r.left, r.right), y: rand(r.top, r.bottom), vx: rand(-0.6, 0.6), vy: rand(-1.4, -0.2), drag: 0.98, gravity: 0, rot: 0, vr: rand(-0.05, 0.05),
    size: rand(4, 8), color: pick(colors), shape: 'star', life: rand(40, 80),
  })));
}
export function flash(color = '#fff', strength = 0.6, ms = 500) {
  if (reduced) return;
  const el = document.createElement('div');
  el.className = 'fx-flash';
  el.style.background = `radial-gradient(circle at 50% 40%, ${color}, transparent 70%)`;
  el.style.setProperty('--o', strength);
  el.style.animationDuration = ms + 'ms';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms + 50);
}
export function shake(el, ms = 450) {
  if (reduced || !el) return;
  el.classList.remove('fx-shake');
  void el.offsetWidth;
  el.classList.add('fx-shake');
  el.style.animationDuration = ms + 'ms';
  setTimeout(() => el.classList.remove('fx-shake'), ms);
}
// Rotating light rays behind an element.
export function rays(host, color, strong = false) {
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'fx-rays' + (strong ? ' strong' : '');
  el.style.setProperty('--c', color);
  host.prepend(el);
}
export function countUp(el, to, ms, format) {
  if (!el) return;
  if (reduced) return void (el.textContent = format(to));
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = format(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
export const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

// Quiet effect for case drops: a few sparkles in the rarity colour, soft rays and a faint glow only for the rare ones
// (no confetti, bursts or shaking — those got tiring on every case).
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
  if (rank >= 1) burst(x, y, palette, { count: 30 + rank * 25, power: 6 + rank * 1.5, shape: rank >= 3 ? 'mix' : 'spark' });
  if (rank >= 2) flash(color, 0.25 + rank * 0.1, 450 + rank * 80);
  if (rank >= 3) {
    confetti([color, '#ffd500', '#ffffff', '#2f7bff'], rank >= 4 ? 1.6 : 0.8);
    shake(document.querySelector('#app'), 400 + rank * 80);
  }
  if (rank >= 4) setTimeout(() => burst(x, y, palette, { count: 120, power: 14, shape: 'mix', life: 110 }), 350);
}
