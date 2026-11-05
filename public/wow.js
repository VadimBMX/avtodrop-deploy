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

// s2-screens (owner 03.11: the red sunburst + «МІФІЧНА!» looked like the old design and scary): a calm label over the
// turntable instead of a shout; the class colour only lights the rim and the floor.
const TITLES = { 3: 'Легендарний дроп', 4: 'Міфічний дроп', 5: 'Секретна машина' };

// result: one case result ({ car, isNew, dream }); casePrice: what one opening cost (for the ×multiplier).
// Resolves when the player taps through (or after a long idle), so the caller can then play the normal result.
// kicker / priceLabel (optional): the headline and the «×N …» label for other sources (the container auction).
// kickerTone: 'warn' sets the headline as a sentence-case warning chip (a flooded container) instead of the hero word.
export function celebrate(result, { casePrice = 0, onShare, kicker = '', priceLabel = 'від ціни кейсу', kickerTone = '' } = {}) {
  return new Promise((resolve) => {
    const { esc, ic, haptic } = ctx;
    const car = result.car, m = S.MODELS[car.model];
    const rank = Math.max(3, S.rankOf(m.cls)), dream = !!result.dream;
    const color = dream && rank < 4 ? '#ffd400' : S.CLASSES[m.cls].color;
    // Honest numbers (reports/audit.md №1): the big figure is the sale — what the dealer pays right now — and «×N від
    // ціни кейсу» is that against the case (green only when it pays back); the collection price follows in grey. A
    // secret car can't be sold: its collection price is the figure.
    const sale = S.saleOf(car), main = sale ?? car.value;
    const mult = casePrice && sale != null ? sale / casePrice : 0;
    const el = document.createElement('div');
    el.className = `wow r${rank}${dream ? ' dream' : ''}${reduced ? ' still' : ''}${kickerTone ? ' k-' + kickerTone : ''}`;
    el.style.setProperty('--c', color);
    // D-reveal: the backdrop lives on its own layer under the particle canvas (z 30) and the takeover above it, so the
    // confetti and bursts fly between the scene and the text instead of over the name and the price.
    const under = document.createElement('div');
    under.className = `wow-under${reduced ? ' still' : ''}`;
    under.style.setProperty('--c', color);
    under.innerHTML = '<div class="wow-bg"></div><div class="wow-sweep"></div>';
    const bigShare = dream || rank >= 4; // S / secret / dream: sharing is the point, so it stays the main button
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `${m.name} — ${S.CLASSES[m.cls].name}`);
    el.innerHTML = `<div class="wow-body">
        <div class="wow-kicker">${dream ? `${ic('heart')} Машина мрії` : kicker ? esc(kicker) : `<i class="wow-dot"></i>${TITLES[Math.min(5, rank)]}`}</div>
        <div class="wow-stage"><i class="wow-floor"></i><i class="wow-rim"></i><i class="wow-dark"></i>
          <div class="wow-car">${carArt(car.model, { look: car.look })}<i class="wow-shine"></i></div></div>
        <div class="wow-tags"><span class="stamp r${S.rankOf(m.cls)}" style="--c:${S.CLASSES[m.cls].color}"><b>${m.cls}</b>${S.CLASSES[m.cls].name}</span>${result.isNew ? `<span class="wow-new">${ic('sparkles')} Нова в колекції</span>` : ''}</div>
        <div class="wow-name">${esc(m.name)}</div>
        <div class="wow-val"><span class="wow-lbl">${sale == null ? 'Колекційна ціна' : 'Продаж'}</span><b class="wow-num">${S.fmt(main)}</b>${mult ? `<span class="wow-mult ${mult >= 1 ? 'up' : ''}">${S.multText(mult)} <small>${esc(priceLabel)}</small></span>` : ''}
          <span class="wow-coll">${sale == null ? 'трофей колекції — не продається' : `Колекційна ціна ${S.fmt(car.value)}${casePrice ? ` · ${S.multText(car.value / casePrice)} у колекції` : ''}${car.serial ? ` · тираж ${S.serialText(car.serial)}` : ''}`}</span></div>
        ${dream ? `<div class="wow-dream">${ic('trophy')} Мрію здійснено! Обери наступну в гаражі</div>` : ''}
        <div class="wow-acts btns">${bigShare
          ? `<button class="btn ghost wow-next" type="button">Далі</button><button class="btn yellow wow-share" type="button">${ic('share')} Поділитися</button>`
          : `<button class="btn ghost wow-share" type="button">${ic('share')} Поділитися</button><button class="btn yellow wow-next" type="button">Далі</button>`}</div>
      </div>`;
    document.body.append(under, el);
    const timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, reduced ? Math.min(ms, 200) : ms));
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      timers.forEach(clearTimeout);
      removeEventListener('keydown', onKey);
      el.classList.add('out');
      under.classList.add('out');
      setTimeout(() => (el.remove(), under.remove()), reduced ? 0 : 260);
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
    under.classList.add('in');
    // The sequence: dark-out → light sweep → the car slides in → hit (flash, burst, rays, confetti, sound) → details.
    SFX.tease(reduced ? 300 : 700);
    haptic('light');
    // s2-screens: the asphalt reveal, all within ~1.2 s — the street lamps flicker on (CSS, 0–0.5 s), the car settles on
    // the turntable, then the hit: the rim and the floor light up in the class colour and a shine sweeps the car once.
    later(650, () => {
      el.classList.add('hit');
      SFX.rare(Math.min(5, rank));
      if (dream) SFX.fanfare();
      haptic(rank >= 4 ? 'heavy' : 'medium');
      later(380, () => haptic('success'));
      FX.tween(el.querySelector('.wow-num'), 0, main, 700, S.fmt, 120);
    });
    later(900, () => el.classList.add('ready'));
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
export async function shareCard({ model, value, sale = null, mult = 0, who = '', bot = '', serial = null }) {
  const m = S.MODELS[model];
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const color = S.CLASSES[m.cls].color;
  try {
    await Promise.all(['800 80px "Fira Sans Condensed"', '700 40px "Fira Sans Condensed"', '600 40px Inter', '800 40px Inter'].map((f) => document.fonts?.load(f)));
  } catch {}
  // «Асфальт» (design pass 05.11; was the S1 night showroom with a violet haze, a neon arc and a blue grid floor): a
  // matte asphalt night, two sodium lamps over a concrete turntable, a faint class-colour light behind the car
  let g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#07080b');
  g.addColorStop(0.55, '#121317');
  g.addColorStop(1, '#07080b');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(W / 2, 900, 40, W / 2, 900, 700);
  g.addColorStop(0, color + '30');
  g.addColorStop(1, '#00000000');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // two spotlights in the top corners, aimed at the turntable
  for (const side of [-1, 1]) {
    c.save();
    c.translate(W / 2 + side * 500, 470);
    c.rotate(side * 0.62);
    const b = c.createLinearGradient(0, 0, 0, 760);
    b.addColorStop(0, '#ffd27a48');
    b.addColorStop(0.6, '#ffc85a14');
    b.addColorStop(1, '#ffc85a00');
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
  // the concrete turntable: a top-lit disc with a thick dark edge (the slabs' look)
  c.save();
  c.fillStyle = '#0d0e11';
  c.beginPath();
  c.ellipse(W / 2, floorY + 44, 480, 112, 0, 0, Math.PI * 2);
  c.fill();
  g = c.createLinearGradient(0, floorY - 70, 0, floorY + 90);
  g.addColorStop(0, '#4a4d55');
  g.addColorStop(1, '#25272c');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(W / 2, floorY + 20, 480, 110, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#ffffff22';
  c.lineWidth = 3;
  c.beginPath();
  c.ellipse(W / 2, floorY + 20, 478, 108, 0, Math.PI, 0);
  c.stroke();
  c.restore();
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
    g.addColorStop(0, '#0f101300');
    g.addColorStop(1, '#0a0b0e');
    c.fillStyle = g;
    c.fillRect(0, floorY + 30, W, ch * 0.7 + 2);
  }
  // header
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  // the wordmark as on the splash: «АВТО» white + «ДРОП» yellow, no glow; the yellow dashed road marking under it
  c.font = '800 112px "Fira Sans Condensed", "Arial Narrow", sans-serif';
  const wa = c.measureText('АВТО').width, wd = c.measureText('ДРОП').width, wx = (W - wa - wd) / 2;
  c.textAlign = 'left';
  c.fillStyle = '#f2f3f5';
  c.fillText('АВТО', wx, 300);
  c.fillStyle = '#ffd400';
  c.fillText('ДРОП', wx + wa, 300);
  c.textAlign = 'center';
  c.fillStyle = '#ffd400';
  for (let x = 140; x < W - 140; x += 52) c.fillRect(x, 412, 28, 6);
  c.fillStyle = '#c9cacd';
  c.font = '700 44px "Fira Sans Condensed", "Arial Narrow", sans-serif';
  c.fillText(m.secret ? 'Я ВІДКРИВ СЕКРЕТНУ МАШИНУ' : m.edition ? 'Я ВИГРАВ НА «ПРИЧАЛІ»' : 'Я ВИБИВ З КЕЙСА', W / 2, 376);
  // A «тиражна»: the blue «ТИРАЖ № 007» stamp under the header (as on the reveal).
  if (m.edition) {
    const st = `ТИРАЖНА${serial ? '  ' + S.serialText(serial) : ''}`;
    c.font = '800 46px "Fira Sans Condensed", "Arial Narrow", sans-serif';
    const tw = c.measureText(st).width + 64;
    c.save();
    c.translate(W / 2, 452);
    c.rotate(-0.035);
    roundRect(c, -tw / 2, -40, tw, 72, 12);
    c.fillStyle = '#22d3ee22';
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = '#22d3ee';
    c.stroke();
    c.fillStyle = '#a5f3fc';
    c.fillText(st, 0, 14);
    c.restore();
  }
  // class stamp
  const label = `${m.cls}  ·  ${S.CLASSES[m.cls].name.toUpperCase()}`;
  c.font = '800 48px "Fira Sans Condensed", "Arial Narrow", sans-serif';
  const sw = c.measureText(label).width + 80;
  roundRect(c, (W - sw) / 2, 1196, sw, 80, 18);
  c.fillStyle = '#131417';
  c.fill();
  roundRect(c, (W - sw) / 2, 1190, sw, 80, 18);
  c.fillStyle = '#2a2c32';
  c.fill();
  c.fillStyle = color;
  roundRect(c, (W - sw) / 2 + 18, 1212, 10, 36, 4);
  c.fill();
  c.fillStyle = '#fff';
  c.fillText(label, W / 2, 1247);
  // name, value, multiplier
  c.fillStyle = '#ffffff';
  c.save();
  c.shadowColor = '#000';
  c.shadowBlur = 18;
  const y = fitText(c, m.name.toUpperCase(), W / 2, 1390, 960, 116);
  c.restore();
  // Honest numbers: the sale first (×N of the case only when the sale pays it back), the collection price under it in
  // grey; a two-line name leaves room for one compact line only (the call-to-action box starts at 1670).
  const coll = `Колекційна ціна ${S.fmt(value || m.price)}`;
  if (sale == null) {
    c.fillStyle = '#c9cacd';
    c.font = '600 46px Inter, sans-serif';
    c.fillText(coll, W / 2, y + 24);
  } else if (y + 84 > 1640) {
    c.fillStyle = '#c9cacd';
    c.font = '600 40px Inter, sans-serif';
    c.fillText(`Продаж ${S.short(sale)}  ·  колекційна ${S.short(value || m.price)}`, W / 2, y + 24);
  } else {
    c.fillStyle = '#ffffff';
    c.font = '700 50px Inter, sans-serif';
    c.fillText(`Продаж ${S.fmt(sale)}${mult >= 1 ? `  ·  ${S.multText(mult)} від кейсу` : ''}`, W / 2, y + 24);
    c.fillStyle = '#909194';
    c.font = '600 38px Inter, sans-serif';
    c.fillText(coll, W / 2, y + 84);
  }
  // call to action
  roundRect(c, 110, 1684, W - 220, 150, 32);
  c.fillStyle = '#a87f00';
  c.fill();
  roundRect(c, 110, 1670, W - 220, 150, 32);
  c.fillStyle = '#ffd400';
  c.fill();
  c.fillStyle = '#111';
  c.font = '800 58px "Fira Sans Condensed", "Arial Narrow", sans-serif';
  c.fillText('ПЕРШИЙ КЕЙС — БЕЗКОШТОВНО', W / 2, 1745);
  c.font = '700 38px Inter, sans-serif';
  c.fillText(bot ? `@${bot} у Telegram` : 'АВТОДРОП у Telegram', W / 2, 1795);
  if (who) {
    c.fillStyle = '#909194';
    c.font = '600 34px Inter, sans-serif';
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
