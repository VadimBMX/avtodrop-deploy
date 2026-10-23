// «Вау»-moments: the full-screen celebration of a rare drop (A / S / secret / dream car), the share card (a 1080×1920
// JPEG drawn on a canvas for Telegram stories and chats) and the small dream-car helpers. No dependencies; the app
// passes its own helpers in with init() so this file never reaches into app.js.
import * as S from './shared.js';
import { carArt } from './car.js';
import * as FX from './fx.js';
import * as SFX from './sfx.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let ctx = { haptic: () => {}, esc: (s) => String(s), ic: () => '', showroom: '', onShare: null };
export function init(c) {
  ctx = { ...ctx, ...c };
}

// ---------- celebration ----------
// Which drop of a result list gets the takeover: a dream car first, otherwise the rarest A+ (the dearest on a tie).
// Fast mode keeps its pace: only S, secret cars and the dream get the takeover there.
export function pickDrop(results, { fast = false } = {}) {
  let best = null, bestScore = -1;
  for (const r of results || []) {
    const m = S.MODELS[r.car?.model];
    if (!m) continue;
    const rank = S.rankOf(m.cls);
    const eligible = r.dream || rank >= (fast ? 4 : 3);
    if (!eligible) continue;
    const score = (r.dream ? 10 : 0) + rank + Math.min(0.99, r.car.value / 1e12);
    if (score > bestScore) (best = r), (bestScore = score);
  }
  return best;
}
export const isOpen = () => !!document.querySelector('.wow');

// Per class: how big the show is. A = gold glow, S = the full show, X (secret) = cyan + star storm.
const TUNE = {
  3: { confetti: 0.8, burst: 60, power: 9, waves: 1, shake: false, rays: false },
  4: { confetti: 1.6, burst: 90, power: 13, waves: 2, shake: true, rays: true },
  5: { confetti: 1.4, burst: 90, power: 14, waves: 3, shake: true, rays: true },
};
const TITLES = { 3: 'ЛЕГЕНДАРНА!', 4: 'МІФІЧНА!', 5: 'СЕКРЕТНА!' };

// Showroom scene recoloured into the class colour (own ids, so it never clashes with the season card's copy).
const scenes = {};
function scene(color) {
  if (!ctx.showroom) return '';
  return (scenes[color] ||= ctx.showroom.replace(/\bsr(?=[A-Z])/g, 'ww').replace(/#ffc400/gi, color).replace(/#ffe27a/gi, color));
}

// result: one case result ({ car, isNew, dream }); casePrice: what one opening cost (for the ×multiplier).
// Resolves when the player taps through (or after a long idle), so the caller can then play the normal result.
// kicker / priceLabel (optional): the headline and the «×N …» label for other sources (the container auction).
export function celebrate(result, { casePrice = 0, onShare, kicker = '', priceLabel = 'від ціни кейсу' } = {}) {
  return new Promise((resolve) => {
    const { esc, ic, haptic } = ctx;
    const car = result.car, m = S.MODELS[car.model];
    const rank = Math.max(3, S.rankOf(m.cls)), dream = !!result.dream;
    const color = dream && rank < 4 ? '#ffc400' : S.CLASSES[m.cls].color;
    const t = TUNE[Math.min(5, rank)];
    // Honest numbers (reports/audit.md №1): the big figure is the sale — what the dealer pays right now — and «×N від
    // ціни кейсу» is that against the case (green only when it pays back); the collection price follows in grey. A
    // secret car can't be sold: its collection price is the figure.
    const sale = S.saleOf(car), main = sale ?? car.value;
    const mult = casePrice && sale != null ? sale / casePrice : 0;
    const el = document.createElement('div');
    el.className = `wow r${rank}${dream ? ' dream' : ''}${reduced ? ' still' : ''}`;
    el.style.setProperty('--c', color);
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `${m.name} — ${S.CLASSES[m.cls].name}`);
    el.innerHTML = `<div class="wow-bg"></div><div class="wow-sweep"></div>
      <div class="wow-body">
        <div class="wow-kicker">${dream ? `${ic('heart')} МАШИНА МРІЇ!` : kicker ? esc(kicker) : TITLES[Math.min(5, rank)]}</div>
        <div class="wow-stage"><div class="wow-rays"></div><div class="wow-scene">${scene(color)}</div>
          <div class="wow-refl" aria-hidden="true">${carArt(car.model, { look: car.look })}</div><div class="wow-car">${carArt(car.model, { look: car.look })}</div></div>
        <div class="wow-tags"><span class="stamp r${S.rankOf(m.cls)}" style="--c:${S.CLASSES[m.cls].color}"><b>${m.cls}</b>${S.CLASSES[m.cls].name}</span>${result.isNew ? `<span class="wow-new">${ic('sparkles')} Нова в колекції</span>` : ''}</div>
        <div class="wow-name">${esc(m.name)}</div>
        <div class="wow-val"><span class="wow-lbl">${sale == null ? 'Колекційна ціна' : 'Продаж'}</span><b class="wow-num">${S.fmt(main)}</b>${mult ? `<span class="wow-mult ${mult >= 1 ? 'up' : ''}">${S.multText(mult)} <small>${esc(priceLabel)}</small></span>` : ''}
          <span class="wow-coll">${sale == null ? 'трофей колекції — не продається' : `Колекційна ціна ${S.fmt(car.value)}${casePrice ? ` · ${S.multText(car.value / casePrice)} у колекції` : ''}${car.serial ? ` · тираж ${S.serialText(car.serial)}` : ''}`}</span></div>
        ${dream ? `<div class="wow-dream">${ic('trophy')} Мрію здійснено! Обери наступну в гаражі</div>` : ''}
        <div class="wow-acts"><button class="btn yellow wow-share" type="button">${ic('share')} Поділитися</button></div>
        <div class="wow-tap">Торкнись, щоб продовжити</div>
      </div>`;
    document.body.appendChild(el);
    const timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, reduced ? Math.min(ms, 200) : ms));
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      timers.forEach(clearTimeout);
      removeEventListener('keydown', onKey);
      el.classList.add('out');
      setTimeout(() => el.remove(), reduced ? 0 : 260);
      resolve();
    };
    const onKey = (e) => (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), close());
    addEventListener('keydown', onKey);
    el.addEventListener('click', (e) => {
      if (!el.classList.contains('ready')) return; // the first ~0.9 s can't be skipped by the tap that opened the case
      close();
      if (e.target.closest('.wow-share')) (onShare || ctx.onShare)?.(result); // the share sheet opens over the normal result
    });
    void el.offsetWidth;
    el.classList.add('in');
    // The sequence: dark-out → light sweep → the car slides in → hit (flash, burst, rays, confetti, sound) → details.
    SFX.tease(reduced ? 300 : 700);
    haptic('light');
    later(650, () => {
      el.classList.add('hit');
      const target = el.querySelector('.wow-car');
      const [x, y] = FX.centerOf(target);
      const pal = [color, '#ffffff', rank >= 5 ? '#a5f3fc' : '#ffd500'];
      FX.flash(color, rank >= 4 ? 0.45 : 0.28, 600);
      FX.burst(x, y, pal, { count: t.burst, power: t.power, shape: rank >= 4 ? 'mix' : 'spark', life: 90 });
      if (t.rays) FX.rays(el.querySelector('.wow-rays'), color, true);
      if (t.shake) FX.shake(el.querySelector('.wow-stage'), 420, rank >= 5);
      SFX.rare(Math.min(5, rank));
      if (dream) SFX.fanfare();
      haptic('heavy');
      later(160, () => haptic(rank >= 4 ? 'heavy' : 'medium'));
      later(380, () => haptic('success'));
      FX.tween(el.querySelector('.wow-num'), 0, main, 1100, S.fmt, 250);
    });
    later(900, () => el.classList.add('ready'));
    later(1000, () => FX.confetti([color, '#ffd500', '#ffffff', rank >= 5 ? '#22d3ee' : '#2f7bff'], t.confetti));
    for (let w = 1; w < t.waves; w++) later(1000 + w * 650, () => {
      const [x, y] = FX.centerOf(el.querySelector('.wow-car'));
      FX.burst(x, y, [color, '#fff', '#ffd500'], { count: 50, power: 15, shape: 'star', life: 100, gravity: 0.08 });
      if (w === 2) FX.confetti([color, '#ffffff', '#a5f3fc'], 0.9);
    });
    later(1500, () => FX.sparkle(el.querySelector('.wow-name'), [color, '#ffffff'], 12));
    timers.push(setTimeout(close, 25000)); // idle: never trap the player (not shortened under reduced motion)
  });
}

// ---------- share card: 1080×1920 JPEG ----------
const loadImg = (src) => new Promise((res) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = src;
});
// Text in a box: shrinks the font until it fits `maxW`, up to two lines.
function fitText(c, text, x, y, maxW, size, weight = 800, family = '"Fira Sans Condensed", "Arial Narrow", sans-serif') {
  let s = size, lines = [text];
  for (; s > size * 0.55; s -= 4) {
    c.font = `${weight} ${s}px ${family}`;
    if (c.measureText(text).width <= maxW) { lines = [text]; break; }
    const words = text.split(' ');
    let cut = -1;
    for (let i = words.length - 1; i > 0 && cut < 0; i--) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      if (c.measureText(a).width <= maxW && c.measureText(b).width <= maxW) cut = i;
    }
    if (cut > 0 && s <= size * 0.85) { lines = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')]; break; }
  }
  lines.forEach((l, i) => c.fillText(l, x, y + i * s * 1.05));
  return y + lines.length * s * 1.05;
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
// model + value (+ sale, mult, who, bot) → Blob (image/jpeg). sale: what the car sells for (null: a secret car);
// mult: the sale against the case price. The car photo comes from the same origin, so the canvas
// stays exportable; without a photo the drawn silhouette (SVG) is used.
export async function shareCard({ model, value, sale = null, mult = 0, who = '', bot = '' }) {
  const m = S.MODELS[model];
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const color = S.CLASSES[m.cls].color;
  try {
    await Promise.all(['800 80px "Fira Sans Condensed"', '700 40px "Fira Sans Condensed"', '600 40px Manrope'].map((f) => document.fonts?.load(f)));
  } catch {}
  // night showroom: asphalt-blue, violet haze in the class colour, two spotlight beams, a neon arc, a grid floor
  let g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#070912');
  g.addColorStop(0.55, '#0b0f1c');
  g.addColorStop(1, '#05070c');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(W / 2, 900, 40, W / 2, 900, 820);
  g.addColorStop(0, color + '66');
  g.addColorStop(0.35, '#5b3df044');
  g.addColorStop(1, '#00000000');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // two spotlights in the top corners, aimed at the turntable
  for (const side of [-1, 1]) {
    c.save();
    c.translate(W / 2 + side * 500, 470);
    c.rotate(side * 0.62);
    const b = c.createLinearGradient(0, 0, 0, 760);
    b.addColorStop(0, '#fff8e140');
    b.addColorStop(0.6, '#f1f4ff12');
    b.addColorStop(1, '#f1f4ff00');
    c.fillStyle = b;
    c.beginPath();
    c.moveTo(-14, 0);
    c.lineTo(14, 0);
    c.lineTo(170, 760);
    c.lineTo(-170, 760);
    c.fill();
    c.fillStyle = '#fffbea';
    c.globalAlpha = 0.9;
    c.beginPath();
    c.ellipse(0, 0, 20, 7, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  const floorY = 1040;
  c.save();
  c.strokeStyle = '#8494ff';
  c.globalAlpha = 0.28;
  c.lineWidth = 2;
  for (let k = -14; k <= 14; k++) {
    c.beginPath();
    c.moveTo(W / 2 + k * 28, floorY);
    c.lineTo(W / 2 + k * 150, H);
    c.stroke();
  }
  for (let i = 0, y = floorY; y < H; i++, y += 10 + i * i * 3) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(W, y);
    c.stroke();
  }
  c.restore();
  c.save();
  c.lineCap = 'round';
  for (const [w, a] of [[40, 0.08], [18, 0.2], [6, 1]]) {
    c.strokeStyle = color;
    c.globalAlpha = a;
    c.lineWidth = w;
    c.beginPath();
    c.ellipse(W / 2, floorY, 450, 430, 0, Math.PI, 0);
    c.stroke();
  }
  c.globalAlpha = 1;
  c.strokeStyle = '#ffffffcc';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(W / 2, floorY, 450, 430, 0, Math.PI, 0);
  c.stroke();
  c.restore();
  g = c.createRadialGradient(W / 2, floorY, 10, W / 2, floorY, 520);
  g.addColorStop(0, color + '55');
  g.addColorStop(1, color + '00');
  c.fillStyle = g;
  c.fillRect(0, floorY - 140, W, 380);
  // the car + its reflection on the glossy floor
  const holder = document.createElement('div');
  holder.innerHTML = carArt(model);
  const node = holder.firstElementChild;
  let img = null;
  if (node?.tagName === 'IMG') img = await loadImg(node.getAttribute('src'));
  else if (node) img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(node.outerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="420" ')));
  if (img) {
    const cw = 980, ch = (cw * (img.naturalHeight || 2)) / (img.naturalWidth || 5);
    const x = (W - cw) / 2, y = floorY + 30 - ch;
    c.save();
    c.shadowColor = '#000';
    c.shadowBlur = 40;
    c.shadowOffsetY = 18;
    if (m.filter) c.filter = m.filter; // a season car: another car's photo in its season colour (S.SEASON_CARS)
    c.drawImage(img, x, y, cw, ch);
    c.restore();
    c.save();
    c.translate(0, (floorY + 30) * 2);
    c.scale(1, -1);
    c.globalAlpha = 0.22;
    if (m.filter) c.filter = m.filter;
    c.drawImage(img, x, y, cw, ch);
    c.restore();
    g = c.createLinearGradient(0, floorY + 30, 0, floorY + 30 + ch * 0.7);
    g.addColorStop(0, '#0b0f1c00');
    g.addColorStop(1, '#070a12');
    c.fillStyle = g;
    c.fillRect(0, floorY + 30, W, ch * 0.7 + 2);
  }
  // header
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#ffc400';
  c.font = '800 112px "Fira Sans Condensed", "Arial Narrow", sans-serif';
  c.save();
  c.shadowColor = '#ffc40088';
  c.shadowBlur = 36;
  c.fillText('АВТОДРОП', W / 2, 300);
  c.restore();
  c.fillStyle = '#c3cad6';
  c.font = '700 44px "Fira Sans Condensed", "Arial Narrow", sans-serif';
  c.fillText(m.secret ? 'Я ВІДКРИВ СЕКРЕТНУ МАШИНУ' : 'Я ВИБИВ З КЕЙСА', W / 2, 380);
  // class stamp
  const label = `${m.cls}  ·  ${S.CLASSES[m.cls].name.toUpperCase()}`;
  c.font = '800 48px "Fira Sans Condensed", "Arial Narrow", sans-serif';
  const sw = c.measureText(label).width + 80;
  roundRect(c, (W - sw) / 2, 1190, sw, 80, 16);
  c.fillStyle = color + '33';
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = color;
  c.stroke();
  c.fillStyle = '#fff';
  c.fillText(label, W / 2, 1247);
  // name, value, multiplier
  c.fillStyle = '#ffffff';
  c.save();
  c.shadowColor = color;
  c.shadowBlur = 30;
  const y = fitText(c, m.name, W / 2, 1390, 960, 116);
  c.restore();
  // Honest numbers: the sale first (×N of the case only when the sale pays it back), the collection price under it in
  // grey; a two-line name leaves room for one compact line only (the call-to-action box starts at 1670).
  const coll = `Колекційна ціна ${S.fmt(value || m.price)}`;
  if (sale == null) {
    c.fillStyle = '#c3cad6';
    c.font = '600 46px Manrope, sans-serif';
    c.fillText(coll, W / 2, y + 24);
  } else if (y + 84 > 1640) {
    c.fillStyle = '#c3cad6';
    c.font = '600 40px Manrope, sans-serif';
    c.fillText(`Продаж ${S.short(sale)}  ·  колекційна ${S.short(value || m.price)}`, W / 2, y + 24);
  } else {
    c.fillStyle = '#ffffff';
    c.font = '700 50px Manrope, sans-serif';
    c.fillText(`Продаж ${S.fmt(sale)}${mult >= 1 ? `  ·  ${S.multText(mult)} від кейсу` : ''}`, W / 2, y + 24);
    c.fillStyle = '#8b919c';
    c.font = '600 38px Manrope, sans-serif';
    c.fillText(coll, W / 2, y + 84);
  }
  // call to action
  roundRect(c, 110, 1670, W - 220, 150, 28);
  c.fillStyle = '#ffc400';
  c.fill();
  c.fillStyle = '#1c1500';
  c.font = '800 58px "Fira Sans Condensed", "Arial Narrow", sans-serif';
  c.fillText('ПЕРШИЙ КЕЙС — БЕЗКОШТОВНО', W / 2, 1745);
  c.font = '700 38px Manrope, sans-serif';
  c.fillText(bot ? `@${bot} у Telegram` : 'АВТОДРОП у Telegram', W / 2, 1795);
  if (who) {
    c.fillStyle = '#8b919c';
    c.font = '600 34px Manrope, sans-serif';
    c.fillText(who.slice(0, 40), W / 2, 1880);
  }
  // JPEG (Telegram wants JPEG for a photo message); drop the quality if it comes out too big for the upload limit
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 590 * 1024) return blob;
  }
  return null;
}

// ---------- dream car ----------
// Worth (money + garage) against the dream's price, 0..1.
export const dreamProgress = (me, model) => Math.max(0, Math.min(1, (me.balance + (me.stats?.value || 0)) / (S.MODELS[model]?.price || 1)));
// "1 з 412" for a chance in percent.
export const oneIn = (pct) => (pct > 0 ? `1 з ${Math.max(1, Math.round(100 / pct)).toLocaleString('uk-UA').replace(/ /g, ' ')}` : '—');
