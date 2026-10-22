// «Заїзд дня» share card: a 1080×1920 JPEG drawn on a canvas (the same sizes and upload path as the drop card in
// wow.js: POST share/card, then a story or a prepared chat message). Time, place and the day's car. Loaded by the app
// only when a player shares (dynamic import), so it costs nothing on start.
import * as S from './shared.js';
import * as D from './dayrace.js';
import { carArt } from './car.js';

const FONT = '"Fira Sans Condensed", "Arial Narrow", sans-serif';
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
// The largest font (from `size` down) that fits `text` into `maxW`.
function fit(c, text, maxW, size, weight = 800) {
  let s = size;
  for (; s > 24; s -= 3) {
    c.font = `${weight} ${s}px ${FONT}`;
    if (c.measureText(text).width <= maxW) break;
  }
  return s;
}
// A strip of chequered flag squares across the card at y.
function checker(c, y, W, sq = 36, rows = 2) {
  for (let r = 0; r < rows; r++) for (let x = 0, i = 0; x < W; x += sq, i++) {
    c.fillStyle = (i + r) % 2 ? '#f2f4f8' : '#0b0f16';
    c.fillRect(x, y + r * sq, sq, sq);
  }
}

// { model, time, place, total, day, who, bot } → Blob (image/jpeg) or null.
export async function dayRaceCard({ model, time, place = null, total = 0, day, who = '', bot = '' }) {
  const m = S.MODELS[model];
  if (!m) return null;
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const color = S.CLASSES[m.cls].color;
  try {
    await Promise.all(['800 80px "Fira Sans Condensed"', '700 40px "Fira Sans Condensed"', '600 40px Manrope'].map((f) => document.fonts?.load(f)));
  } catch {}
  // night strip: asphalt, a floodlight in the class colour, the strip's lane lines running to the horizon
  let g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#070912');
  g.addColorStop(0.5, '#0c111d');
  g.addColorStop(1, '#05070c');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(W / 2, 860, 30, W / 2, 860, 760);
  g.addColorStop(0, color + '5c');
  g.addColorStop(0.45, '#3d5bff22');
  g.addColorStop(1, '#00000000');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const floorY = 1010;
  c.save();
  c.strokeStyle = '#8494ff';
  c.globalAlpha = 0.22;
  c.lineWidth = 2;
  for (let k = -12; k <= 12; k++) {
    c.beginPath();
    c.moveTo(W / 2 + k * 26, floorY);
    c.lineTo(W / 2 + k * 160, H);
    c.stroke();
  }
  c.restore();
  checker(c, 0, W);
  // header
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#ffc400';
  c.font = `800 104px ${FONT}`;
  c.save();
  c.shadowColor = '#ffc40088';
  c.shadowBlur = 34;
  c.fillText('АВТОДРОП', W / 2, 250);
  c.restore();
  c.fillStyle = '#c3cad6';
  c.font = `700 46px ${FONT}`;
  c.fillText(`ЗАЇЗД ДНЯ · ${D.dayLabel(day)}`, W / 2, 328);
  c.fillStyle = '#8b919c';
  c.font = '600 34px Manrope, sans-serif';
  c.fillText('однакова машина для всіх', W / 2, 382);
  // the car on the strip + its reflection
  const holder = document.createElement('div');
  holder.innerHTML = carArt(model);
  const node = holder.firstElementChild;
  let img = null;
  if (node?.tagName === 'IMG') img = await loadImg(node.getAttribute('src'));
  else if (node) img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(node.outerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="420" ')));
  if (img) {
    const cw = 960, ch = (cw * (img.naturalHeight || 2)) / (img.naturalWidth || 5);
    const x = (W - cw) / 2, y = floorY + 20 - ch;
    c.save();
    c.shadowColor = '#000';
    c.shadowBlur = 40;
    c.shadowOffsetY = 18;
    if (m.filter) c.filter = m.filter;
    c.drawImage(img, x, y, cw, ch);
    c.restore();
    c.save();
    c.translate(0, (floorY + 20) * 2);
    c.scale(1, -1);
    c.globalAlpha = 0.18;
    if (m.filter) c.filter = m.filter;
    c.drawImage(img, x, y, cw, ch);
    c.restore();
    g = c.createLinearGradient(0, floorY + 20, 0, floorY + 20 + ch * 0.7);
    g.addColorStop(0, '#0c111d00');
    g.addColorStop(1, '#070a12');
    c.fillStyle = g;
    c.fillRect(0, floorY + 20, W, ch * 0.7 + 2);
  }
  // car name
  c.fillStyle = '#ffffff';
  c.save();
  c.shadowColor = color;
  c.shadowBlur = 26;
  c.font = `800 ${fit(c, m.name, 960, 92)}px ${FONT}`;
  c.fillText(m.name, W / 2, 1150);
  c.restore();
  // the time on a timing board
  const tb = { x: 150, y: 1200, w: W - 300, h: 210 };
  roundRect(c, tb.x, tb.y, tb.w, tb.h, 26);
  c.fillStyle = '#05070b';
  c.fill();
  c.lineWidth = 4;
  c.strokeStyle = '#ffc40099';
  c.stroke();
  c.fillStyle = '#8b919c';
  c.font = `700 34px ${FONT}`;
  c.fillText('МІЙ ЧАС НА 402 М', W / 2, tb.y + 52);
  c.fillStyle = '#ffc400';
  c.save();
  c.shadowColor = '#ffc400aa';
  c.shadowBlur = 24;
  c.font = `800 ${fit(c, `${D.fmtTime(time)} с`, tb.w - 60, 128)}px ${FONT}`;
  c.fillText(`${D.fmtTime(time)} с`, W / 2, tb.y + 172);
  c.restore();
  // the place («№38 серед 1 243 гравців»: no «з» next to digits, it reads as a 3 in this face)
  if (place) {
    const label = `№${place} серед ${total.toLocaleString('uk-UA')} ${total % 10 === 1 && total % 100 !== 11 ? 'гравця' : 'гравців'}`;
    c.font = `800 ${fit(c, label, W - 260, 50)}px ${FONT}`;
    const sw = c.measureText(label).width + 84;
    roundRect(c, (W - sw) / 2, 1446, sw, 84, 16);
    c.fillStyle = place <= 3 ? '#ffc40033' : color + '2e';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = place <= 3 ? '#ffc400' : color;
    c.stroke();
    c.fillStyle = '#fff';
    c.fillText(label, W / 2, 1506);
  }
  // call to action
  roundRect(c, 110, 1600, W - 220, 150, 28);
  c.fillStyle = '#ffc400';
  c.fill();
  c.fillStyle = '#1c1500';
  c.font = `800 62px ${FONT}`;
  c.fillText('ПОБ’ЄШ МІЙ ЧАС?', W / 2, 1677);
  const sub = `${bot ? `@${bot}` : 'АВТОДРОП'} у Telegram · ${D.DAYRACE.attempts} спроби безкоштовно`;
  c.font = `700 ${fit(c, sub, W - 300, 36, 700)}px ${FONT}`;
  c.fillText(sub, W / 2, 1727);
  if (who) {
    c.fillStyle = '#8b919c';
    c.font = '600 34px Manrope, sans-serif';
    c.fillText(who.slice(0, 40), W / 2, 1812);
  }
  checker(c, H - 72, W);
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 590 * 1024) return blob;
  }
  return null;
}
