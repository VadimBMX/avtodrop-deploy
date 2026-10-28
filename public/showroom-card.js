// The share card of a «Шоурум»: a 1080×1350 JPEG (a portrait photo in a chat) drawn on a canvas — a lit showroom
// floor, the player's cars as they look (the painted picture when the car has paint or a livery), his name, the ♥
// count and «ПОСТАВ ♥». Same approach as public/challenge-card.js: same-origin pictures, so the canvas exports.
import * as S from './shared.js';
import { carArt } from './car.js';
import { renderLook } from './paint.js';

const DISP = '"Fira Sans Condensed", "Arial Narrow", sans-serif';
const loadImg = (src) => new Promise((res) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = src;
});
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function fit(c, text, x, y, maxW, size, weight = 800, family = DISP) {
  let s = size;
  for (; s > size * 0.5; s -= 3) {
    c.font = `${weight} ${s}px ${family}`;
    if (c.measureText(text).width <= maxW) break;
  }
  c.fillText(text, x, y);
  return s;
}
async function carImage(car) {
  const painted = car.look ? await renderLook(car.model, car.look).catch(() => null) : null;
  if (painted) return loadImg(painted);
  const holder = document.createElement('div');
  holder.innerHTML = carArt(car.model);
  const node = holder.firstElementChild;
  if (node?.tagName === 'IMG') return loadImg(node.getAttribute('src'));
  if (node) return loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(node.outerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="420" ')));
  return null;
}
function drawCar(c, img, m, cx, floorY, w) {
  if (!img) return;
  const h = (w * (img.naturalHeight || 2)) / (img.naturalWidth || 5);
  // the pool of light under the car in its class colour
  const g = c.createRadialGradient(cx, floorY, 10, cx, floorY, w * 0.6);
  g.addColorStop(0, S.CLASSES[m.cls].color + '55');
  g.addColorStop(1, '#00000000');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(cx, floorY, w * 0.62, w * 0.12, 0, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.shadowColor = '#000';
  c.shadowBlur = 30;
  c.shadowOffsetY = 12;
  if (m.filter) c.filter = m.filter;
  c.drawImage(img, cx - w / 2, floorY - h, w, h);
  c.restore();
}

// { cars: [{ model, look, stars }], who, likes, bot } → Blob (image/jpeg) or null.
export async function showroomCard({ cars, who = '', likes = 0, bot = '' }) {
  const list = (cars || []).filter((x) => S.MODELS[x.model]).slice(0, 3);
  if (!list.length) return null;
  const W = 1080, H = 1350, AM = '#ffc400';
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  try {
    await Promise.all([`800 80px ${DISP}`, `700 40px ${DISP}`, '600 40px Manrope'].map((f) => document.fonts?.load(f)));
  } catch {}
  // the hall: dark walls, a warm ceiling glow, a polished floor with light strips
  let g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#07080c');
  g.addColorStop(0.55, '#10131c');
  g.addColorStop(1, '#05060a');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(W / 2, 360, 20, W / 2, 360, 760);
  g.addColorStop(0, '#ffc40024');
  g.addColorStop(1, '#00000000');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const floorTop = 560;
  g = c.createLinearGradient(0, floorTop, 0, H);
  g.addColorStop(0, '#1a1e2a');
  g.addColorStop(1, '#07080c');
  c.fillStyle = g;
  c.fillRect(0, floorTop, W, H - floorTop);
  c.save();
  c.globalAlpha = 0.18;
  c.strokeStyle = '#ffe2a0';
  c.lineWidth = 3;
  for (let k = -6; k <= 6; k++) {
    c.beginPath();
    c.moveTo(W / 2 + k * 60, floorTop);
    c.lineTo(W / 2 + k * 260, H);
    c.stroke();
  }
  c.restore();
  // ceiling lamps
  for (const x of [180, 540, 900]) {
    g = c.createLinearGradient(x, 0, x, floorTop);
    g.addColorStop(0, '#fff3c855');
    g.addColorStop(1, '#fff3c800');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - 30, 0);
    c.lineTo(x + 30, 0);
    c.lineTo(x + 170, floorTop);
    c.lineTo(x - 170, floorTop);
    c.closePath();
    c.fill();
  }
  // header
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = AM;
  c.font = `800 64px ${DISP}`;
  c.save();
  c.shadowColor = '#ffc40088';
  c.shadowBlur = 26;
  c.fillText('АВТОДРОП', W / 2, 112);
  c.restore();
  c.font = `800 46px ${DISP}`;
  const kick = 'ШОУРУМ';
  const kw = c.measureText(kick).width + 90;
  roundRect(c, (W - kw) / 2, 150, kw, 72, 36);
  c.fillStyle = '#ffc4001a';
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = AM;
  c.stroke();
  c.fillStyle = '#fff4cc';
  c.fillText(kick, W / 2, 202);
  c.fillStyle = '#ffffff';
  fit(c, who || 'Гравець', W / 2, 318, 960, 84);
  c.fillStyle = '#c3cad6';
  const value = list.reduce((s, x) => s + (S.MODELS[x.model]?.price || 0), 0);
  fit(c, `${list.length} ${list.length === 1 ? 'машина' : 'машини'} · ${S.short(value)}`, W / 2, 380, 960, 44, 700);
  // the cars: the first big in the middle, the others smaller in front
  const imgs = await Promise.all(list.map(carImage));
  const m0 = S.MODELS[list[0].model];
  if (list.length === 1) drawCar(c, imgs[0], m0, W / 2, 860, 900);
  else {
    drawCar(c, imgs[0], m0, W / 2, 760, 760);
    if (list[1]) drawCar(c, imgs[1], S.MODELS[list[1].model], list[2] ? W * 0.27 : W / 2, 1010, list[2] ? 500 : 620);
    if (list[2]) drawCar(c, imgs[2], S.MODELS[list[2].model], W * 0.73, 1010, 500);
  }
  // names under the cars (class colour dot)
  c.font = `700 30px ${DISP}`;
  const names = list.map((x) => S.MODELS[x.model]);
  const label = (m, x, y, maxW, stars) => {
    c.fillStyle = S.CLASSES[m.cls].color;
    c.fillText(`${m.cls}${stars ? ` ${'★'.repeat(stars)}` : ''}`, x, y);
    c.fillStyle = '#e8ebf0';
    fit(c, m.name, x, y + 36, maxW, 32, 700);
  };
  if (list.length === 1) label(names[0], W / 2, 900, 900, list[0].stars);
  else {
    label(names[0], W / 2, 800, 760, list[0].stars);
    if (names[1]) label(names[1], list[2] ? W * 0.27 : W / 2, 1046, 460, list[1].stars);
    if (names[2]) label(names[2], W * 0.73, 1046, 460, list[2].stars);
  }
  // call to action with the like count
  roundRect(c, 90, 1120, W - 180, 130, 28);
  c.fillStyle = AM;
  c.fill();
  c.fillStyle = '#1c1500';
  c.font = `800 72px ${DISP}`;
  c.fillText('ПОСТАВ ♥', W / 2, 1200);
  c.font = '700 30px Manrope, sans-serif';
  c.fillText(likes ? `уже ♥ ${likes}` : 'перший лайк — твій', W / 2, 1236);
  c.fillStyle = '#8b919c';
  const foot = bot ? `@${bot}` : 'АВТОДРОП у Telegram';
  fit(c, foot, W / 2, 1306, 960, 32, 600, 'Manrope, sans-serif');
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 590 * 1024) return blob;
  }
  return null;
}
