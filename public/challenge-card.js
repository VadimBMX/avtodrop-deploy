// The share card of a ghost challenge: a 1080×1350 JPEG (a portrait photo in a chat) drawn on a canvas — the night
// drag strip, the creator's car with its cyan ghost trail, the time to beat and «ПОБ’ЄШ?». No dependencies; the car
// photo comes from the same origin (carArt), so the canvas stays exportable; without a photo the drawn silhouette.
import * as S from './shared.js';
import { carArt } from './car.js';
import { chTime } from './ghost.js';

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
// Text shrunk until it fits maxW (one line).
function fit(c, text, x, y, maxW, size, weight = 800, family = DISP) {
  let s = size;
  for (; s > size * 0.5; s -= 3) {
    c.font = `${weight} ${s}px ${family}`;
    if (c.measureText(text).width <= maxW) break;
  }
  c.fillText(text, x, y);
  return s;
}
// The car picture as an <img>/<svg> element turned into a drawable image.
async function carImage(model) {
  const holder = document.createElement('div');
  holder.innerHTML = carArt(model);
  const node = holder.firstElementChild;
  if (node?.tagName === 'IMG') return loadImg(node.getAttribute('src'));
  if (node) return loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(node.outerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="420" ')));
  return null;
}
// The same picture tinted cyan (a ghost), on its own canvas: source-atop works everywhere (ctx.filter does not).
function tinted(img, w, h, color) {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w);
  cv.height = Math.ceil(h);
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0, w, h);
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = color;
  c.fillRect(0, 0, w, h);
  return cv;
}

// { model, time, hp (the car as it raced), who, bot } → Blob (image/jpeg) or null.
export async function challengeCard({ model, time, hp = 0, who = '', bot = '' }) {
  const m = S.MODELS[model];
  if (!m) return null;
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const cls = S.CLASSES[m.cls];
  const CY = '#3ee0ff', AM = '#ffc400';
  try {
    await Promise.all([`800 80px ${DISP}`, `700 40px ${DISP}`, '600 40px Manrope'].map((f) => document.fonts?.load(f)));
  } catch {}
  // night sky → violet haze → the strip
  let g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#05070d');
  g.addColorStop(0.5, '#0b1020');
  g.addColorStop(1, '#04060a');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(W / 2, 640, 30, W / 2, 640, 700);
  g.addColorStop(0, '#3ee0ff2e');
  g.addColorStop(0.45, '#5b3df022');
  g.addColorStop(1, '#00000000');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // skyline (seeded, so every card has the same city)
  const rnd = S.seededRand(402);
  const skyY = 760;
  for (let x = 0; x < W;) {
    const w = 40 + Math.floor(rnd() * 90), h = 60 + Math.floor(rnd() * 210);
    c.fillStyle = rnd() < 0.5 ? '#0f1628' : '#121a2e';
    c.fillRect(x, skyY - h, w, h);
    c.fillStyle = '#ffd27a';
    for (let wy = skyY - h + 14; wy < skyY - 10; wy += 18) for (let wx = x + 8; wx < x + w - 10; wx += 13) {
      if (rnd() < 0.13) (c.globalAlpha = 0.25 + rnd() * 0.5, c.fillRect(wx, wy, 5, 7));
    }
    c.globalAlpha = 1;
    x += w + Math.floor(rnd() * 8);
  }
  // the strip: a perspective grid and the start line
  const roadY = skyY;
  g = c.createLinearGradient(0, roadY, 0, H);
  g.addColorStop(0, '#0d1222');
  g.addColorStop(1, '#05070c');
  c.fillStyle = g;
  c.fillRect(0, roadY, W, H - roadY);
  c.save();
  c.strokeStyle = '#7f8cff';
  c.globalAlpha = 0.22;
  c.lineWidth = 2;
  for (let k = -16; k <= 16; k++) {
    c.beginPath();
    c.moveTo(W / 2 + k * 30, roadY);
    c.lineTo(W / 2 + k * 170, H);
    c.stroke();
  }
  for (let i = 0, y = roadY; y < H; i++, y += 8 + i * i * 2.6) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(W, y);
    c.stroke();
  }
  c.restore();
  // header
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = AM;
  c.font = `800 64px ${DISP}`;
  c.save();
  c.shadowColor = '#ffc40088';
  c.shadowBlur = 26;
  c.fillText('АВТОДРОП', W / 2, 118);
  c.restore();
  // «ВИКЛИК-ПРИВИД» pill in cyan
  c.font = `800 46px ${DISP}`;
  const kick = 'ВИКЛИК · ДРАГ 402 М';
  const kw = c.measureText(kick).width + 70;
  roundRect(c, (W - kw) / 2, 160, kw, 72, 36);
  c.fillStyle = '#3ee0ff1f';
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = CY;
  c.stroke();
  c.fillStyle = '#d8f8ff';
  c.fillText(kick, W / 2, 212);
  // the time to beat
  c.save();
  c.fillStyle = '#ffffff';
  c.shadowColor = CY;
  c.shadowBlur = 40;
  fit(c, `${chTime(time)} с`, W / 2, 400, 980, 190);
  c.restore();
  c.fillStyle = '#c3cad6';
  fit(c, `на ${m.name}`, W / 2, 470, 960, 56, 700);
  // the car with its ghost trail
  const img = await carImage(model);
  const floorY = 930;
  if (img) {
    const cw = 820, ch = (cw * (img.naturalHeight || 2)) / (img.naturalWidth || 5);
    const x = (W - cw) / 2 + 60, y = floorY - ch;
    const ghost = tinted(img, cw, ch, '#7eeaff');
    for (const [dx, a] of [[-180, 0.07], [-120, 0.13], [-60, 0.24]]) {
      c.globalAlpha = a;
      c.drawImage(ghost, x + dx, y, cw, ch);
    }
    c.globalAlpha = 1;
    c.save();
    c.shadowColor = '#000';
    c.shadowBlur = 36;
    c.shadowOffsetY = 16;
    if (m.filter) c.filter = m.filter; // a season car: another car's photo in its season colour
    c.drawImage(img, x, y, cw, ch);
    c.restore();
  }
  // class + power chips under the car
  c.font = `800 40px ${DISP}`;
  const chip = `${m.cls} · ${cls.name.toUpperCase()}  ·  ${hp || m.hp} К.С.`;
  const cwid = c.measureText(chip).width + 60;
  roundRect(c, (W - cwid) / 2, floorY + 26, cwid, 64, 14);
  c.fillStyle = cls.color + '33';
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = cls.color;
  c.stroke();
  c.fillStyle = '#fff';
  c.fillText(chip, W / 2, floorY + 72);
  // call to action
  roundRect(c, 90, 1080, W - 180, 150, 28);
  c.fillStyle = AM;
  c.fill();
  c.fillStyle = '#1c1500';
  c.font = `800 84px ${DISP}`;
  c.fillText("ПОБ’ЄШ?", W / 2, 1168);
  c.font = '700 34px Manrope, sans-serif';
  c.fillText('Їдь проти мого привида', W / 2, 1210);
  c.fillStyle = '#8b919c';
  c.font = '600 32px Manrope, sans-serif';
  const foot = [who && who.slice(0, 32), bot ? `@${bot}` : 'АВТОДРОП у Telegram'].filter(Boolean).join('  ·  ');
  fit(c, foot, W / 2, 1300, 960, 32, 600, 'Manrope, sans-serif');
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 590 * 1024) return blob;
  }
  return null;
}
