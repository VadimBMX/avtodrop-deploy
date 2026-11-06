// r9-bg: the «Фони вітрини» scenes (S.STYLE_ITEMS kind showcase), drawn in code and written into public/style.css
// between the markers `/* r9-bg */` … `/* /r9-bg */`.   Usage: node tools/showcase_bg.mjs        (rewrites the block)
//
// Each backdrop is a class on the showcase grid / the shop preview (app.js showcaseBackdrop, styleView): `.sc-<look>`.
// One scene = a 400 × 300 SVG covering the box from the bottom up (on a long showcase: full width along the bottom, the
// sky gradient + a star tile above it), plus two animated layers in ::before / ::after: the same 400 × 300 box (aspect-ratio
// 4 / 3, bottom 0), so they line up with the scene at any size. They move only with opacity / transform and stop under
// prefers-reduced-motion.
import fs from 'node:fs';

const f = (v) => +v.toFixed(1);
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
// Many small rects of a few colours → one path per (fill, opacity step): far lighter than one <rect> each.
const R = (x, y, w, h) => `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`;
function bucket() {
  const m = new Map();
  return {
    add(fill, op, d) { const k = `${fill}|${Math.round(op * 5) / 5}`; m.set(k, (m.get(k) || '') + d); },
    get size() { return m.size; },
    out: () => [...m].map(([k, d]) => { const [fill, op] = k.split('|'); return `<path d='${d}' fill='${fill}'${+op < 1 ? ` opacity='${op}'` : ''}/>`; }).join(''),
  };
}
const svg = (body, defs = '') => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'>${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
const url = (s) => `url("data:image/svg+xml,${encodeURIComponent(s.replace(/\s+/g, ' ').replace(/> </g, '><')).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%27/g, "'")}")`;
const lg = (id, stops, x2 = 0, y2 = 1, extra = '') => `<linearGradient id='${id}' x1='0' y1='0' x2='${x2}' y2='${y2}'${extra}>${stops.map(([o, c, a = 1]) => `<stop offset='${o}' stop-color='${c}' stop-opacity='${a}'/>`).join('')}</linearGradient>`;
const rg = (id, stops, extra = '') => `<radialGradient id='${id}'${extra}>${stops.map(([o, c, a = 1]) => `<stop offset='${o}' stop-color='${c}' stop-opacity='${a}'/>`).join('')}</radialGradient>`;
// Stars for the sky above a tall showcase: a 200 × 150 tile.
function starTile(seed, n, tint = '#fff') {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) d += `<circle cx='${f(r() * 200)}' cy='${f(r() * 150)}' r='${f(0.35 + r() * 0.6)}' fill='${tint}' opacity='${f(0.25 + r() * 0.6)}'/>`;
  return url(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 150'>${d}</svg>`);
}
function stars(seed, n, y0, y1, rMax = 1, tint = '#fff') {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = f(r() * 400), y = f(y0 + r() * (y1 - y0)), s = 0.4 + r() * rMax;
    d += `<circle cx='${x}' cy='${y}' r='${f(s)}' fill='${tint}' opacity='${f(0.45 + r() * 0.55)}'/>`;
    if (s > 1.1) d += `<circle cx='${x}' cy='${y}' r='${f(s * 3)}' fill='${tint}' opacity='.12'/>`;
  }
  return d;
}

// ---------- «Нічне місто»: three layers of towers, lit windows, a spire with a beacon, a neon billboard ----------
function city() {
  const G = 268; // street level
  const r = rng(7);
  const wins = { lit: bucket(), a: bucket() };
  const row = (seed, fill, wMin, wMax, hMin, hMax, win, rim) => {
    const q = rng(seed);
    let out = '', dark = '', rims = '', x = -6;
    while (x < 404) {
      const w = wMin + q() * (wMax - wMin), h = hMin + q() * (hMax - hMin), top = G - h;
      out += R(x, top, w, h + 2);
      if (rim) rims += R(x, top, w, 1);
      if (q() < 0.3) out += R(x + w * 0.3, top - 6, w * 0.25, 6);
      if (q() < 0.2) out += R(x + w * 0.6, top - 14, 1, 14);
      if (win) {
        const [ww, wh, gx, gy, pLit, pA] = win;
        for (let yy = top + 5; yy < G - 6; yy += gy) for (let xx = x + 3; xx + ww < x + w - 2; xx += gx) {
          const v = q(), warm = q() < 0.72;
          const c = warm ? (q() < 0.5 ? '#ffd27a' : '#ffb85c') : '#a9e4ff';
          if (v < pLit) wins.lit.add(c, 0.55 + q() * 0.45, R(xx, yy, ww, wh));
          else if (v < pLit + pA) wins.a.add(c, 1, R(xx, yy, ww, wh));
          else if (v < pLit + pA + 0.25) dark += R(xx, yy, ww, wh);
        }
      }
      x += w + (q() < 0.25 ? 2 + q() * 6 : 0);
    }
    return `<path d='${out}' fill='${fill}'/>${rims ? `<path d='${rims}' fill='${rim}' opacity='.55'/>` : ''}${dark ? `<path d='${dark}' fill='#2a3566' opacity='.5'/>` : ''}`;
  };
  const far = row(11, '#1b2452', 9, 20, 70, 150, [1.4, 2, 4, 5, 0.1, 0.03], '#3a4a8f');
  const farLit = wins.lit.out(); wins.lit = bucket();
  const mid = row(23, '#10173a', 18, 34, 46, 118, [2.2, 3, 5, 6, 0.2, 0.06], '#4a3f86');
  const midLit = wins.lit.out(); wins.lit = bucket();
  const near = row(37, '#070a18', 28, 50, 26, 80, [3, 4, 7, 8, 0.18, 0.07]);
  const nearLit = wins.lit.out(); wins.lit = bucket();
  // the spire (x 292) and the neon billboard on a near roof
  const spire = `<path d='M284 ${G}V118H300V${G}Z' fill='#141c45'/><path d='M287 118V96H297V118Z' fill='#141c45'/><path d='M291.4 96V46H292.6V96Z' fill='#3a4a8f'/>
    <rect x='284' y='118' width='16' height='1' fill='#6b7cff' opacity='.7'/>${Array.from({ length: 22 }, (_, i) => `<rect x='${286 + (i % 3) * 4.4}' y='${124 + Math.floor(i / 3) * 9}' width='2.2' height='3.2' fill='${i % 4 ? '#9fe0ff' : '#ffd27a'}' opacity='${f(0.4 + r() * 0.5)}'/>`).join('')}`;
  const board = (glow) => `<g transform='translate(176 150) scale(.8)'>${glow ? `<rect x='-3' y='-3' width='68' height='24' rx='4' fill='#ff2bd6' opacity='.16'/>` : ''}
    <rect x='0' y='0' width='62' height='18' rx='2.5' fill='#12051c' stroke='${glow ? '#ff7ae6' : '#5a2050'}' stroke-width='1.6'/>
    <text x='31' y='13.6' text-anchor='middle' font-family='Arial Black,Arial,sans-serif' font-weight='900' font-size='12.5' letter-spacing='1.5' fill='${glow ? '#fff0fb' : '#4a1a42'}'>АВТО</text>
    ${glow ? `<rect x='2.5' y='15' width='57' height='1.2' fill='#4ff0ff'/>` : ''}<rect x='10' y='18' width='1.4' height='10' fill='#05060c'/><rect x='50' y='18' width='1.4' height='10' fill='#05060c'/></g>`;
  const defs = lg('g', [[0, '#3b1d63', 0], [0.55, '#4a2470', 0.5], [0.85, '#c2456e', 0.42], [1, '#ff8a4a', 0.5]]) + lg('s', [[0, '#05060c'], [1, '#0b0d18']]);
  const street = `<rect y='${G}' width='400' height='${300 - G}' fill='url(#s)'/><rect y='${G}' width='400' height='1' fill='#ff9d5c' opacity='.35'/>
    <path d='M0 281H400' stroke='#ffb347' stroke-width='.8' opacity='.5' stroke-dasharray='30 6 12 9'/><path d='M0 287H400' stroke='#ff3b3b' stroke-width='.8' opacity='.45' stroke-dasharray='18 10 40 7'/>
    ${Array.from({ length: 9 }, (_, i) => `<circle cx='${22 + i * 45}' cy='${G - 14}' r='1.4' fill='#ffe2a6'/><circle cx='${22 + i * 45}' cy='${G - 14}' r='6' fill='#ffcf70' opacity='.12'/><rect x='${21.5 + i * 45}' y='${G - 14}' width='1' height='14' fill='#05060c'/>`).join('')}`;
  const base = svg(`<rect y='110' width='400' height='${G - 110}' fill='url(#g)'/><circle cx='250' cy='40' r='12' fill='#f1ecd9' opacity='.9'/><circle cx='250' cy='40' r='30' fill='#f1ecd9' opacity='.06'/><circle cx='245' cy='37' r='3' fill='#d8d2bd' opacity='.6'/><circle cx='254' cy='45' r='2' fill='#d8d2bd' opacity='.5'/>
    ${far}${farLit}${spire}${mid}${midLit}${near}${nearLit}${board(false)}${street}`, defs);
  const a = svg(wins.a.out());
  const b = svg(`${board(true)}<circle cx='292' cy='45' r='2' fill='#ff3b3b'/><circle cx='292' cy='45' r='7' fill='#ff3b3b' opacity='.25'/><circle cx='287' cy='96' r='1.3' fill='#ff3b3b'/><circle cx='297' cy='96' r='1.3' fill='#ff3b3b'/>`);
  return { base, a, b, sky: 'linear-gradient(180deg, #03050d, #0a1030 55%, #1a1a48)', stars: starTile(3, 26), rim: '#6f8cff55' };
}

// ---------- «Гоночний трек»: a night circuit under floodlights — grandstand, start gantry, chequered line ----------
function track() {
  const r = rng(19);
  const T0 = 210, T1 = 262; // the asphalt band
  const cb = bucket(), gb = bucket();
  for (let i = 0; i < 260; i++) {
    const x = 60 + r() * 280, y = 162 + r() * 32;
    cb.add(['#e9ecf5', '#ff5a5a', '#ffd24a', '#5ab0ff', '#c7cbd6'][i % 5], 0.25 + r() * 0.5, R(x, y, 1.3, 1.3));
  }
  for (let i = 0; i < 150; i++) { const s = 0.6 + r(); gb.add(i % 3 ? '#4a4d55' : '#111216', 0.6, R(r() * 400, T0 + 4 + r() * (T1 - T0 - 6), s, s)); }
  const crowd = cb.out(), grain = gb.out();
  const kb = (odd) => Array.from({ length: 20 }, (_, i) => `M${(2 * i + odd) * 10 - 1} ${T0}h10l-2 5h-10z`).join('');
  const kerb = `<path d='${kb(0)}' fill='#e0251b'/><path d='${kb(1)}' fill='#f2f2f2'/>`;
  // chequered start / finish line, slanted for the view from the pit wall
  let chk = '';
  for (let row = 0; row < 13; row++) for (let col = 0; col < 3; col++) {
    const y = T0 + 5 + row * 3.6, x = 200 + col * 4 - (y - T0) * 0.22;
    if ((row + col) % 2 === 0) chk += `M${f(x)} ${f(y)}h4l-.8 3.6h-4z`;
  }
  chk = `<path d='${chk}' fill='#f4f4f4'/>`;
  const tower = (x, top, s = 1) => `<path d='M${x - 1.6 * s} 214V${top + 8}H${x + 1.6 * s}V214Z' fill='#1b2130'/><path d='M${x - 1.6 * s} ${top + 30}L${x + 1.6 * s} ${top + 44}M${x + 1.6 * s} ${top + 54}L${x - 1.6 * s} ${top + 68}' stroke='#2a3245' stroke-width='.6'/>
    <rect x='${x - 14 * s}' y='${top}' width='${28 * s}' height='${11 * s}' rx='1.2' fill='#202737'/>
    ${Array.from({ length: 10 }, (_, i) => `<circle cx='${f(x - 11.2 * s + (i % 5) * 5.6 * s)}' cy='${f(top + 3 * s + Math.floor(i / 5) * 5 * s)}' r='${f(1.6 * s)}' fill='#fffbe6'/>`).join('')}
    <ellipse cx='${x}' cy='${top + 5 * s}' rx='${24 * s}' ry='${12 * s}' fill='#eef4ff' opacity='.16'/><ellipse cx='${x}' cy='${top + 5 * s}' rx='${48 * s}' ry='${26 * s}' fill='#cfe0ff' opacity='.06'/>`;
  const beam = (x, top, x1, x2, op) => `<path d='M${x - 12} ${top + 9}L${x + 12} ${top + 9}L${x2} ${T1}L${x1} ${T1}Z' fill='url(#bm)' opacity='${op}'/>`;
  const defs = lg('bm', [[0, '#f4f8ff', 0.55], [0.6, '#dfe8ff', 0.16], [1, '#dfe8ff', 0.04]]) + lg('hz', [[0, '#9fb7ff', 0], [0.7, '#5d6f9e', 0.32], [1, '#2a3550', 0.5]])
    + lg('as', [[0, '#2a2d34'], [1, '#17181c']]) + lg('wl', [[0, '#3a3e48'], [0.15, '#262930'], [1, '#121317']]) + rg('pool', [[0, '#e9f0ff', 0.2], [1, '#e9f0ff', 0]]);
  const towers = tower(80, 40, 1.05) + tower(320, 40, 1.05) + tower(152, 92, 0.75) + tower(248, 92, 0.75);
  const gantry = `<path d='M166 ${T1}V146H169V${T1}ZM231 ${T1}V146H234V${T1}Z' fill='#2b3140'/><rect x='160' y='140' width='80' height='12' rx='1.5' fill='#15181f' stroke='#3a4152' stroke-width='.6'/>
    ${Array.from({ length: 5 }, (_, i) => `<circle cx='${174 + i * 13}' cy='146' r='2.6' fill='#2a0b0b'/>`).join('')}`;
  const base = svg(`<rect y='60' width='400' height='155' fill='url(#hz)'/>${towers}
    <path d='M48 196L64 154H336L352 196Z' fill='#0e121b'/><path d='M40 156L60 140H340L360 156Z' fill='#1a2030'/><path d='M40 156H360' stroke='#5a6a90' stroke-width='.8' opacity='.8'/>
    ${Array.from({ length: 6 }, (_, i) => `<path d='M${58 - i * 2} ${162 + i * 6}H${342 + i * 2}' stroke='#222a3a' stroke-width='.7'/>`).join('')}${crowd}
    <rect x='44' y='196' width='312' height='12' fill='#090b10'/><rect x='70' y='198' width='120' height='8' rx='1' fill='#141a26'/><rect x='210' y='198' width='120' height='8' rx='1' fill='#141a26'/>
    <text x='130' y='204.9' text-anchor='middle' font-family='Arial Black,Arial,sans-serif' font-weight='900' font-size='7' letter-spacing='2' fill='#ffd400' opacity='.9'>АВТОДРОП</text>
    <text x='270' y='204.9' text-anchor='middle' font-family='Arial Black,Arial,sans-serif' font-weight='900' font-size='7' letter-spacing='2' fill='#ffffff' opacity='.75'>ФІНІШ</text>
    <rect x='-2' y='208' width='404' height='3' fill='#0b0c10'/>
    <rect y='${T0}' width='400' height='${T1 - T0}' fill='url(#as)'/>${grain}
    <ellipse cx='95' cy='238' rx='80' ry='22' fill='url(#pool)'/><ellipse cx='305' cy='238' rx='80' ry='22' fill='url(#pool)'/><ellipse cx='200' cy='240' rx='70' ry='16' fill='url(#pool)'/>
    <path d='M0 236H400' stroke='#101114' stroke-width='9' opacity='.5'/>${kerb}<path d='M0 ${T1 - 3}H400' stroke='#e8e8e8' stroke-width='1.3'/>
    <path d='M${f(200 - 0.22 * 5)} ${T0 + 5}L${f(212 - 0.22 * 5)} ${T0 + 5}L${f(212 - 0.22 * 52)} ${T0 + 52}L${f(200 - 0.22 * 52)} ${T0 + 52}Z' fill='#111'/>${chk}${gantry}
    <rect y='${T1}' width='400' height='${300 - T1}' fill='url(#wl)'/><path d='M0 ${T1}H400' stroke='#7c8496' stroke-width='.8'/>
    ${Array.from({ length: 8 }, (_, i) => `<rect x='${8 + i * 50}' y='${T1 + 9}' width='34' height='9' rx='1' fill='${['#ffd400', '#e0251b', '#1f6fff', '#f2f2f2'][i % 4]}' opacity='.16'/>`).join('')}
    <path d='M0 ${T1 + 24}H400' stroke='#000' stroke-width='.6' opacity='.5'/>`, defs);
  // ::before — the floodlight beams breathing, the start lights on
  const a = svg(`${beam(80, 40, 20, 175, 0.9)}${beam(320, 40, 225, 380, 0.9)}${beam(152, 92, 105, 215, 0.6)}${beam(248, 92, 185, 295, 0.6)}
    ${Array.from({ length: 5 }, (_, i) => `<circle cx='${174 + i * 13}' cy='146' r='6' fill='#ff2a2a' opacity='.22'/><circle cx='${174 + i * 13}' cy='146' r='2.4' fill='#ff4040'/><circle cx='${173.3 + i * 13}' cy='145.3' r='.8' fill='#ffd0d0'/>`).join('')}`, defs);
  // ::after — a car's light trail along the straight (the whole layer slides across)
  const b = svg(`<path d='M120 238H215' stroke='url(#tr)' stroke-width='3' stroke-linecap='round'/><path d='M140 238H215' stroke='url(#tr2)' stroke-width='1' stroke-linecap='round'/>
    <circle cx='216' cy='237.4' r='2.2' fill='#fff'/><circle cx='216' cy='237.4' r='8' fill='#eaf2ff' opacity='.3'/><ellipse cx='232' cy='238' rx='18' ry='3' fill='#eaf2ff' opacity='.18'/>`,
  lg('tr', [[0, '#ff2a2a', 0], [0.6, '#ff3a2a', 0.55], [1, '#ffd0c0', 0.9]], 1, 0) + lg('tr2', [[0, '#fff', 0], [1, '#fff', 0.9]], 1, 0));
  return { base, a, b, sky: 'linear-gradient(180deg, #020309, #070b16 60%, #10172a)', stars: starTile(5, 14), rim: '#ffffff1f' };
}

// ---------- «Неоновий гараж»: a synthwave floor running at you, a striped sun, wireframe hills, neon pillars ----------
function neon() {
  const H = 186; // horizon
  let vert = '';
  for (let k = -14; k <= 14; k++) vert += `M200 ${H}L${200 + k * 34} 300`;
  // horizontal floor lines at distances 140·q^k from the horizon: scaling by 1/q around the horizon brings line k to
  // line k-1, so the ::before animation loops without a seam.
  const q = 0.72;
  let hor = '';
  for (let k = 0; k < 16; k++) { const y = H + 140 * q ** k; hor += `M-40 ${f(y * 100) / 100}H440`; }
  const hill = (pts, fill) => `<path d='M${pts.map(([x, y]) => `${x} ${y}`).join('L')}L${pts.at(-1)[0]} ${H}L${pts[0][0]} ${H}Z' fill='${fill}'/><path d='M${pts.map(([x, y]) => `${x} ${y}`).join('L')}' fill='none' stroke='#ff5ad8' stroke-width='1' stroke-linejoin='round'/>`;
  const sunStripes = [0, 1, 2, 3, 4, 5].map((i) => `<rect x='120' y='${150 + i * 6.6 + i * i * 0.5}' width='160' height='${1.2 + i * 0.7}' fill='#000'/>`).join('');
  const defs = lg('sky', [[0, '#1a0533', 0], [0.6, '#5a0f6b', 0.5], [1, '#ff2bd6', 0.55]]) + lg('sun', [[0, '#fff3a0'], [0.35, '#ffb347'], [0.7, '#ff4fa0'], [1, '#c02bd6']])
    + `<mask id='m'><rect width='400' height='${H}' fill='#fff'/>${sunStripes}</mask>` + lg('fl', [[0, '#2a0745'], [1, '#07020f']]) + rg('fg', [[0, '#ff2bd6', 0.32], [1, '#ff2bd6', 0]], " cx='.5' cy='0' r='.75'");
  const tube = (x, c, hi) => `<path d='M${x} 20V${H + 40}' stroke='${c}' stroke-width='9' opacity='.14' stroke-linecap='round'/><path d='M${x} 20V${H + 40}' stroke='${c}' stroke-width='4' opacity='.4' stroke-linecap='round'/><path d='M${x} 20V${H + 40}' stroke='${hi}' stroke-width='1.6' stroke-linecap='round'/>`;
  const base = svg(`<rect y='60' width='400' height='${H - 60}' fill='url(#sky)'/>
    <circle cx='200' cy='166' r='70' fill='#ff4fa0' opacity='.12'/><circle cx='200' cy='166' r='54' fill='url(#sun)' mask='url(#m)'/>
    ${hill([[0, 150], [28, 132], [52, 152], [80, 128], [112, 160], [140, 176]], '#14052c')}${hill([[260, 178], [290, 150], [318, 166], [350, 126], [376, 146], [400, 136]], '#14052c')}
    <path d='M28 132L44 186M80 128L76 186M350 126L340 186M290 150L300 186' stroke='#9b3dff' stroke-width='.6' opacity='.6'/>
    <rect y='${H}' width='400' height='${300 - H}' fill='url(#fl)'/><rect y='${H}' width='400' height='${300 - H}' fill='url(#fg)'/>
    <path d='${vert}' stroke='#b44dff' stroke-width='3' opacity='.18' fill='none'/><path d='${vert}' stroke='#c77dff' stroke-width='.9' fill='none'/>
    <rect y='${H - 3}' width='400' height='8' fill='#ff7ae6' opacity='.22'/><path d='M0 ${H}H400' stroke='#ffe0f8' stroke-width='1.3'/>
    ${tube(14, '#ff2bd6', '#ffd0f5')}${tube(386, '#14e1ff', '#d8fbff')}`, defs);
  const a = svg(`<path d='${hor}' stroke='#ff3fd6' stroke-width='3' opacity='.22' fill='none'/><path d='${hor}' stroke='#ff7ae6' stroke-width='1' fill='none'/>`);
  // the neon flicker: brighter tubes and the horizon line
  const b = svg(`${tube(14, '#ff2bd6', '#fff')}${tube(386, '#14e1ff', '#fff')}<rect y='${H - 6}' width='400' height='12' fill='#ff2bd6' opacity='.16'/><path d='M0 ${H}H400' stroke='#fff' stroke-width='.7'/>`);
  return { base, a, b, sky: 'linear-gradient(180deg, #050109, #12042a 60%, #1f0638)', stars: starTile(9, 18, '#ffd6fb'), rim: '#ff2bd655' };
}

// ---------- «Карпати»: ridges at dawn, layered in haze, mist in the valleys, the last stars fading ----------
function ridge(seed, y0, amp, rough, n = 64) {
  const r = rng(seed);
  const pts = [];
  let a = 0, b = 0;
  for (let i = 0; i <= n; i++) {
    a += (r() - 0.5) * rough;
    a *= 0.86;
    b = Math.sin(i / n * Math.PI * (1.2 + (seed % 5) * 0.3) + seed) * amp + a * amp;
    pts.push([f((i / n) * 420 - 10), f(y0 - Math.abs(b) - (r() < 0.12 ? r() * amp * 0.5 : 0))]);
  }
  return pts;
}
function mount() {
  const ridges = [
    [ridge(3, 182, 34, 0.9), '#8f7bb6'], [ridge(8, 198, 26, 0.9), '#6a5c9c'], [ridge(14, 214, 22, 1.1), '#463f78'],
    [ridge(21, 236, 20, 1.2), '#2a2b55'], [ridge(29, 262, 16, 1.3), '#141933'],
  ];
  const path = (pts, fill) => `<path d='M${pts.map(([x, y]) => `${x} ${y}`).join('L')}L410 300L-10 300Z' fill='${fill}'/>`;
  const firs = (pts, seed) => {
    const r = rng(seed);
    let d = '';
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 2; k++) {
      if (r() < 0.25) continue;
      const t = r(), x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t + 2, h = 6 + r() * 9, w = h * 0.32;
      d += `M${f(x)} ${f(y - h)}L${f(x + w)} ${f(y)}L${f(x - w)} ${f(y)}Z`;
    }
    return d;
  };
  const mist = (y, h, op) => `<rect x='-20' y='${y}' width='440' height='${h}' fill='url(#mi)' opacity='${op}'/>`;
  const defs = lg('dawn', [[0, '#2a2560', 0], [0.45, '#7a4f8f', 0.55], [0.75, '#e0837a', 0.75], [1, '#ffc27a', 0.95]]) + rg('sun', [[0, '#fff6d8', 0.95], [0.25, '#ffd79a', 0.55], [1, '#ff9d6a', 0]])
    + lg('mi', [[0, '#fff2e8', 0], [0.5, '#ffe6dc', 0.8], [1, '#fff2e8', 0]]);
  const base = svg(`<rect y='30' width='400' height='190' fill='url(#dawn)'/><circle cx='262' cy='176' r='110' fill='url(#sun)'/><circle cx='262' cy='176' r='13' fill='#fff8e2'/>
    ${stars(41, 14, 0, 90, 0.6)}
    ${path(...ridges[0])}${mist(170, 26, 0.45)}${path(...ridges[1])}${mist(190, 22, 0.4)}${path(...ridges[2])}${mist(208, 24, 0.35)}
    ${path(...ridges[3])}<path d='${firs(ridges[3][0], 5)}' fill='#22234a'/>${mist(232, 22, 0.25)}${path(...ridges[4])}<path d='${firs(ridges[4][0], 9)}' fill='#0c1026'/>
    <path d='M${ridges[0][0].map(([x, y]) => `${x} ${y}`).join('L')}' fill='none' stroke='#ffd9b0' stroke-width='.9' opacity='.55'/>`, defs);
  // ::before — mist drifting in the valleys
  const a = svg(`${mist(186, 18, 0.55)}${mist(204, 16, 0.5)}${mist(226, 20, 0.45)}<ellipse cx='120' cy='214' rx='90' ry='7' fill='#fff2ea' opacity='.35'/><ellipse cx='310' cy='238' rx='110' ry='8' fill='#fff2ea' opacity='.28'/>`, defs);
  // ::after — the stars still out over the ridges, fading as the sun comes up
  const b = svg(stars(77, 38, 0, 130, 1.1));
  return { base, a, b, sky: 'linear-gradient(180deg, #070823, #141540 55%, #2a2560)', stars: starTile(13, 30), rim: '#f4bd6844' };
}

// ---------- «Київ уночі» (150 ⭐): Dnipro, the cable-stayed bridge, Lavra and the Motherland on the right bank ----------
function kyiv() {
  const W = 214; // water line
  const r = rng(53);
  let left = '';
  const lw = bucket();
  let x = -4;
  while (x < 150) {
    const w = 8 + r() * 14, h = 18 + r() * (x < 90 ? 50 : 30), top = W - 10 - h;
    left += R(x, top, w, h + 10);
    for (let yy = top + 3; yy < W - 12; yy += 4) for (let xx = x + 1.5; xx < x + w - 2; xx += 3.2) if (r() < 0.22) lw.add(r() < 0.75 ? '#ffd27a' : '#bfe6ff', 0.5 + r() * 0.5, R(xx, yy, 1.3, 1.8));
    x += w + r() * 3;
  }
  // reflections: soft columns under the lights
  const rb = bucket(), rbA = bucket();
  const col = (cx, w, h, c, op, A = false) => {
    for (let k = 0; k < 6; k++) { const ww = w * (1 - k * 0.12) * (0.6 + r() * 0.5); (A ? rbA : rb).add(c, op * (1 - k * 0.14), R(cx - ww / 2 + (r() - 0.5) * w * 0.5, W + 2 + k * h / 6 + r() * 2, ww, 0.6 + r() * 0.8)); }
  };
  for (let i = 0; i < 34; i++) col(-2 + i * 12.3, 3, 30, '#ffcf70', 0.6, i % 2 === 0);
  col(222, 8, 50, '#ffd76a', 0.8, true); col(256, 10, 44, '#ffd76a', 0.7); col(322, 7, 70, '#d6e2f2', 0.75, true); col(112, 4, 60, '#e6f0ff', 0.6);
  for (let i = 0; i < 20; i++) col(8 + r() * 140, 2.5, 22, '#ffd27a', 0.35, i % 3 === 0);
  // the bridge (x 112 pylon)
  const P = 112, PT = 92;
  let cables = '';
  for (let i = 1; i <= 9; i++) {
    const yy = PT + 6 + i * 2.6;
    cables += `M${P} ${f(yy)}L${f(P - 12 - i * 10.5)} 199M${P} ${f(yy)}L${f(P + 12 + i * 10.5)} 199`;
  }
  const lamps = Array.from({ length: 34 }, (_, i) => `<circle cx='${f(-2 + i * 12.3)}' cy='196.6' r='.65' fill='#ffe9b8'/><circle cx='${f(-2 + i * 12.3)}' cy='196.6' r='2.4' fill='#ffcf70' opacity='.2'/>`).join('');
  const bridge = `<path d='${cables}' stroke='#b9c8ff' stroke-width='.55' opacity='.7' fill='none'/>
    <path d='M${P - 3.6} ${W}L${P - 2.4} ${PT}H${P + 2.4}L${P + 3.6} ${W}Z' fill='#1b2140'/><path d='M${P - 2.4} ${PT}H${P + 2.4}' stroke='#cfe0ff' stroke-width='.8'/><rect x='${P - 0.5}' y='${PT + 4}' width='1' height='100' fill='#9fb6ff' opacity='.5'/>
    <circle cx='${P}' cy='${PT - 2}' r='1.6' fill='#ff4040'/><circle cx='${P}' cy='${PT - 2}' r='5' fill='#ff4040' opacity='.2'/>
    <rect x='-4' y='198' width='408' height='4.5' fill='#0d1122'/><rect x='-4' y='197.6' width='408' height='.9' fill='#5a6aa0'/>
    ${Array.from({ length: 9 }, (_, i) => `<rect x='${20 + i * 46}' y='202' width='3.6' height='${W - 202}' fill='#0d1122'/>`).join('')}${lamps}`;
  // the right bank: hills, the Lavra bell tower and domes, the Motherland monument (x 356)
  const hill = `<path d='M150 ${W}C190 196 214 166 240 160C270 152 300 156 330 146C360 138 384 140 404 136V${W}Z' fill='#0b1024'/>
    <path d='M150 ${W}C190 196 214 166 240 160C270 152 300 156 330 146C360 138 384 140 404 136' fill='none' stroke='#2a3566' stroke-width='.8'/>`;
  const dome = (cx, cy, s) => `<path d='M${cx - 3.2 * s} ${cy}C${cx - 3.6 * s} ${cy - 3.4 * s} ${cx - 0.6 * s} ${cy - 4.2 * s} ${cx} ${cy - 6.6 * s}C${cx + 0.6 * s} ${cy - 4.2 * s} ${cx + 3.6 * s} ${cy - 3.4 * s} ${cx + 3.2 * s} ${cy}Z' fill='url(#gd)'/><path d='M${cx} ${cy - 6.6 * s}V${cy - 9.6 * s}M${cx - 1.2 * s} ${cy - 8.4 * s}H${cx + 1.2 * s}' stroke='#ffd76a' stroke-width='.5'/>`;
  const lavra = `<rect x='249' y='136' width='14' height='24' fill='url(#fac)'/><rect x='250.5' y='120' width='11' height='16' fill='url(#fac)'/><rect x='252' y='107' width='8' height='13' fill='url(#fac)'/><rect x='253.3' y='97' width='5.4' height='10' fill='url(#fac)'/>
    ${[[252, 142], [256, 142], [260, 142], [253.4, 125], [257.4, 125], [254.6, 111], [257.4, 111]].map(([a, b]) => `<rect x='${a}' y='${b}' width='1.4' height='4' rx='.7' fill='#3a3122'/>`).join('')}
    <path d='M249 136H263M250.5 120H261.5M252 107H260' stroke='#fff8e0' stroke-width='.6'/>${dome(256, 97, 0.9)}
    <rect x='278' y='140' width='26' height='16' fill='url(#fac)'/>${dome(291, 140, 1.25)}${dome(282, 140, 0.8)}${dome(300, 140, 0.8)}<rect x='283' y='145' width='2' height='5' rx='1' fill='#3a3122'/><rect x='290' y='145' width='2' height='5' rx='1' fill='#3a3122'/><rect x='297' y='145' width='2' height='5' rx='1' fill='#3a3122'/>
    <circle cx='256' cy='120' r='26' fill='#ffd76a' opacity='.08'/><circle cx='291' cy='140' r='20' fill='#ffd76a' opacity='.07'/>`;
  const MX = 322;
  const motherland = `<circle cx='${MX}' cy='98' r='34' fill='#cfe0ff' opacity='.07'/>
    <path d='M${MX - 9} 143L${MX - 6} 116H${MX + 6}L${MX + 9} 143Z' fill='url(#st)'/><path d='M${MX - 6} 116H${MX + 6}' stroke='#e9f1ff' stroke-width='.6'/>
    <path d='M${MX - 3.4} 116L${MX - 4.2} 100C${MX - 4.4} 94 ${MX - 3} 90 ${MX - 1.4} 88.6L${MX - 1.2} 86.4C${MX - 1.8} 85 ${MX - 1} 83.4 ${MX} 83.4C${MX + 1} 83.4 ${MX + 1.8} 85 ${MX + 1.2} 86.4L${MX + 1.6} 88.6L${MX + 4.4} 86L${MX + 6.2} 79L${MX + 7.4} 79.4L${MX + 6} 88.4L${MX + 3.6} 92.4L${MX + 4} 116Z' fill='url(#st)'/>
    <path d='M${MX + 6.7} 79.5L${MX + 9.4} 52.5L${MX + 10.3} 52.6L${MX + 7.8} 79.7Z' fill='#e9f1ff'/><path d='M${MX + 5} 79.2L${MX + 9.4} 79.9' stroke='#cfdcef' stroke-width='1'/>
    <ellipse cx='${MX - 6}' cy='96' rx='3.6' ry='5.4' fill='url(#st)' stroke='#8fa0b8' stroke-width='.4'/>`;
  const defs = lg('gl', [[0, '#3a1f5c', 0], [0.6, '#5a2c66', 0.45], [1, '#d9774a', 0.4]]) + lg('rv', [[0, '#14204a'], [0.4, '#0a1230'], [1, '#04081a']])
    + lg('gd', [[0, '#fff3b0'], [0.5, '#ffc93a'], [1, '#a8700a']], 1, 1) + lg('fac', [[0, '#f4efe0'], [1, '#b9b09a']], 1, 0) + lg('st', [[0, '#f2f6ff'], [0.6, '#b9c6da'], [1, '#6f7f99']], 1, 0);
  const base = svg(`<rect y='90' width='400' height='${W - 90}' fill='url(#gl)'/><circle cx='150' cy='34' r='9' fill='#f3eedb' opacity='.85'/><circle cx='150' cy='34' r='24' fill='#f3eedb' opacity='.06'/>
    <path d='${left}' fill='#141a3a'/>${lw.out()}${hill}<g transform='translate(-34 4)'>${lavra}</g>${motherland}
    <rect y='${W}' width='400' height='${300 - W}' fill='url(#rv)'/><path d='M0 ${W}H400' stroke='#3a4a80' stroke-width='.8'/>${rb.out()}${bridge}
    <path d='M0 286C80 282 160 290 240 285S360 282 400 286V300H0Z' fill='#03050c' opacity='.8'/>`, defs);
  // ::before — the light columns shimmering on the water
  const a = svg(rbA.out() + `<path d='M0 232H400M0 250H400M0 268H400' stroke='#8fb0ff' stroke-width='.5' opacity='.18' stroke-dasharray='14 9 4 12'/>`);
  // ::after — cars crossing the bridge: headlights one way, tail lights the other
  const b = svg(`<path d='M90 199.6H190' stroke='url(#hl)' stroke-width='1.6' stroke-linecap='round'/><circle cx='191' cy='199.6' r='1.3' fill='#fff'/><circle cx='191' cy='199.6' r='5' fill='#fff' opacity='.25'/>
    <path d='M230 200.6H320' stroke='url(#tl)' stroke-width='1.4' stroke-linecap='round'/><circle cx='229' cy='200.6' r='1.1' fill='#ff4040'/><circle cx='229' cy='200.6' r='4' fill='#ff4040' opacity='.3'/>`,
  lg('hl', [[0, '#fff', 0], [1, '#fff6e0', 0.85]], 1, 0) + lg('tl', [[0, '#ff3030', 0.8], [1, '#ff3030', 0]], 1, 0));
  return { base, a, b, sky: 'linear-gradient(180deg, #03040d, #080c22 55%, #121738)', stars: starTile(17, 22), rim: '#ffd76a44' };
}

// ---------- «Аврора» (150 ⭐): northern lights over snowy rooftops ----------
// The glow under a curtain: from its wavy lower edge down to y 240 (so the sky under the lights is not a dark band).
function curtainGlow(seed, y0, amp) {
  const ph = rng(seed)() * 6;
  let d = 'M-10 240';
  for (let i = 0; i <= 70; i++) { const xx = -10 + i * 6; d += `L${xx} ${f(y0 - 6 + Math.sin(xx / 70 + ph) * amp + Math.sin(xx / 23 + ph * 2) * amp * 0.35)}`; }
  return `<path d='${d}L410 240Z' fill='url(#glw)'/>`;
}
function curtain(seed, y0, amp, len, cMain) {
  const r = rng(seed);
  const d = bucket();
  const ph = r() * 6;
  for (let i = 0; i <= 140; i++) {
    const xx = -10 + i * 3;
    const yb = y0 + Math.sin(xx / 70 + ph) * amp + Math.sin(xx / 23 + ph * 2) * amp * 0.35;
    const h = len * (0.45 + r() * 0.55) * (0.6 + 0.4 * Math.sin(xx / 47 + ph));
    d.add(`url(#${cMain})`, 0.35 + r() * 0.65, R(xx, yb - h, 3.4, h + 6));
  }
  return d.out();
}
function aurora() {
  const G = 240;
  const r = rng(91);
  let roofs = '', snow = '', flat = '', flatSnow = '';
  const wb = bucket();
  let x = -6;
  while (x < 404) {
    const w = 22 + r() * 34, h = 18 + r() * 34, top = G - h + (r() < 0.5 ? 10 : 0), kind = r();
    if (kind < 0.45) {
      const ridge = top - 10 - r() * 8;
      roofs += `<path d='M${f(x)} ${f(top)}L${f(x + w / 2)} ${f(ridge)}L${f(x + w)} ${f(top)}V300H${f(x)}Z' fill='#050a12'/>`;
      snow += `<path d='M${f(x + 1)} ${f(top - 0.6)}L${f(x + w / 2)} ${f(ridge)}L${f(x + w - 1)} ${f(top - 0.6)}' fill='none' stroke='#bff5df' stroke-width='1.2' opacity='.55'/>`;
    } else {
      flat += R(x, top, w, 300 - top);
      flatSnow += R(x, top - 1.2, w, 1.6);
      if (r() < 0.5) flat += R(x + w * 0.2, top - 12, 7, 12) + R(x + w * 0.2 - 1, top - 13, 9, 2);
    }
    for (let yy = top + 6; yy < 290; yy += 9) for (let xx = x + 4; xx < x + w - 5; xx += 8) if (r() < 0.16) wb.add('#ffcf7a', 0.55 + r() * 0.45, R(xx, yy, 3, 4));
    x += w;
  }
  const tvt = `<path d='M330 ${G}L333 120H335L338 ${G}Z' fill='#060b14'/><rect x='328.5' y='150' width='11' height='5' rx='1' fill='#060b14'/><path d='M334 120V78' stroke='#060b14' stroke-width='1.2'/><circle cx='334' cy='78' r='1.3' fill='#ff4040'/>`;
  const ug = (id, y1, y2, stops) => `<linearGradient id='${id}' gradientUnits='userSpaceOnUse' x1='0' y1='${y1}' x2='0' y2='${y2}'>${stops.map(([o, c, a]) => `<stop offset='${o}' stop-color='${c}' stop-opacity='${a}'/>`).join('')}</linearGradient>`;
  const defs = ug('ag', 40, 160, [[0, '#b05cff', 0], [0.35, '#8a6bff', 0.35], [0.7, '#36f5b0', 0.75], [1, '#c8ffe8', 0.95]])
    + ug('ag2', 20, 130, [[0, '#ff5ad8', 0], [0.4, '#b06bff', 0.45], [0.8, '#4dffc4', 0.6], [1, '#e6fff4', 0.85]])
    + lg('hz', [[0, '#0f4a44', 0.35], [1, '#1d6a5a', 0.45]]) + ug('glw', 140, 240, [[0, '#5affc0', 0.42], [0.35, '#2fbf8f', 0.2], [1, '#1d6a5a', 0.08]]) + lg('sn', [[0, '#0c1a22'], [1, '#03060b']]);
  const base = svg(`${stars(61, 30, 0, 200, 0.8)}<rect y='150' width='400' height='${G - 140}' fill='url(#hz)'/>
    ${curtainGlow(12, 150, 20)}<g opacity='.5'>${curtain(5, 150, 16, 80, 'ag')}</g>${tvt}${roofs}<path d='${flat}' fill='#060b14'/>${snow}<path d='${flatSnow}' fill='#d6fff0' opacity='.5'/>${wb.out()}
    <rect y='288' width='400' height='12' fill='url(#sn)'/>`, defs);
  const a = svg(curtain(12, 150, 20, 105, 'ag'), defs);
  const b = svg(curtain(33, 112, 22, 70, 'ag2'), defs);
  return { base, a, b, sky: 'linear-gradient(180deg, #010308, #02101a 55%, #04202a)', stars: starTile(21, 30, '#e6fff4'), rim: '#36f5b055' };
}

// ---------- CSS ----------
// look → [scene, ::before animation, ::after animation]
const SCENES = {
  city: [city, 'scA 7s steps(1, end) infinite', 'scNeon 4.6s linear infinite'],
  track: [track, 'scBreath 5s ease-in-out infinite alternate', 'scTrail 3.8s cubic-bezier(.5,0,.6,1) infinite'],
  neon: [neon, 'scFloor 1.5s linear infinite', 'scNeon 5.2s linear infinite'],
  mount: [mount, 'scMist 16s ease-in-out infinite alternate', 'scFade 9s ease-in-out infinite alternate'],
  kyiv: [kyiv, 'scShimmer 2.6s ease-in-out infinite alternate', 'scCross 6s linear infinite'],
  aurora: [aurora, 'scAurA 9s ease-in-out infinite alternate', 'scAurB 12s ease-in-out infinite alternate'],
};
export function css() {
  const out = [];
  const looks = Object.keys(SCENES);
  const all = (suffix = '') => looks.map((l) => `.sc-${l}${suffix}`).join(', ');
  const grids = (suffix = '') => looks.map((l) => `.grid.sc-${l}${suffix}`).join(', ');
  out.push(`/* r9-bg */
/* «Фони вітрини» redrawn (owner 06.11: the flat rectangles looked cheap) — generated by tools/showcase_bg.mjs, edit there.
   A 400 × 300 scene covering the box from the bottom up; ::before / ::after are two animated layers in the same 4 : 3
   box (height max(75cqw, 100%) = what cover gives), moving only with opacity / transform. */
${all()} { position: relative; isolation: isolate; overflow: hidden; container-type: inline-size; }
${grids()} { padding: 10px; border-radius: 14px; }
${all('::before')}, ${all('::after')} { content: ''; position: absolute; z-index: -1; left: 50%; bottom: 0; height: max(75cqw, 100%); aspect-ratio: 4 / 3; translate: -50% 0; background: center / 100% 100% no-repeat; pointer-events: none; will-change: transform, opacity; }
/* a long showcase (4+ rows): the scene at full width along the bottom, the starry sky above it, instead of a deep zoom */
${grids(':has(> :nth-child(7))')} { background-size: 100% auto, 200px 150px, auto; }
${grids(':has(> :nth-child(7))::before')}, ${grids(':has(> :nth-child(7))::after')} { height: 75cqw; }
/* the cars stay readable: see-through at the top (the scene shows round the car), solid under the name and the price
   (the s2 slab rule has an id inside :is(), hence the same prefix here) */
${grids(' .car')}, ${looks.map((l) => `body.s2 :is(#view, #modal) .grid.sc-${l} .car`).join(', ')} {
  background: radial-gradient(58% 13% at 50% var(--fy, 52%), color-mix(in srgb, var(--c, #888) 26%, transparent), transparent 76%),
    linear-gradient(180deg, #16171b38, #16171b5c 40%, #16171bd9 63%, #16171bf0 78%);
  box-shadow: inset 0 0 0 1px #ffffff1f, inset 0 -3px 0 color-mix(in srgb, var(--c, #555) 85%, #000), 0 8px 18px -6px #000a; }
${grids(' .slot')} { background: #16171b8c; }
.grid.sc-track { padding-top: 10px; }
.sty-pv.sty-bg${looks.map((l) => `.sc-${l}`).join(', .sty-pv.sty-bg')} { background-color: #05060c; }`);
  const kf = [];
  for (const [look, [draw, animA, animB]] of Object.entries(SCENES)) {
    const s = draw();
    out.push(`.sc-${look} { background: ${url(s.base)} center bottom / cover no-repeat, ${s.stars} center top / 200px 150px repeat, ${s.sky}; box-shadow: inset 0 0 0 1px ${s.rim}; }
.sc-${look}::before { background-image: ${url(s.a)}; animation: ${animA}; }
.sc-${look}::after { background-image: ${url(s.b)}; animation: ${animB}; }`);
  }
  // the neon floor scales round the horizon (y 186 of 300 = 62 %); the light trails slide across
  out.push(`.sc-neon::before { transform-origin: 50% 62%; }
.sc-track::after { transform: translateX(-70%); }
.sc-kyiv::after { transform: translateX(-60%); }
.sc-kyiv::before { transform-origin: 50% 71.3%; }
.sc-aurora::before, .sc-aurora::after { transform-origin: 50% 60%; }`);
  kf.push(`@keyframes scA { 0% { opacity: 1; } 14% { opacity: .1; } 19% { opacity: 1; } 47% { opacity: .2; } 61% { opacity: 1; } 78% { opacity: .35; } 84% { opacity: 1; } }
@keyframes scNeon { 0%, 61%, 66%, 70%, 100% { opacity: 1; } 63%, 68% { opacity: .25; } 86% { opacity: .82; } }
@keyframes scBreath { from { opacity: .62; } to { opacity: 1; } }
@keyframes scTrail { 0% { transform: translateX(-70%); opacity: 0; } 6% { opacity: 1; } 42% { opacity: 1; } 48% { transform: translateX(70%); opacity: 0; } 100% { transform: translateX(70%); opacity: 0; } }
@keyframes scFloor { from { transform: scaleY(1); } to { transform: scaleY(${f(1 / 0.72 * 1000) / 1000}); } }
@keyframes scMist { from { transform: translateX(-5%); opacity: .55; } to { transform: translateX(5%); opacity: 1; } }
@keyframes scFade { from { opacity: 1; } to { opacity: .15; } }
@keyframes scShimmer { from { transform: scaleX(1) scaleY(.94); opacity: .55; } to { transform: scaleX(1.02) scaleY(1.06); opacity: 1; } }
@keyframes scCross { 0% { transform: translateX(-60%); opacity: 0; } 8% { opacity: 1; } 92% { opacity: 1; } 100% { transform: translateX(60%); opacity: 0; } }
@keyframes scAurA { from { transform: translateX(-3%) skewX(-6deg) scaleY(.92); opacity: .6; } to { transform: translateX(3%) skewX(5deg) scaleY(1.08); opacity: 1; } }
@keyframes scAurB { from { transform: translateX(4%) skewX(6deg); opacity: .9; } to { transform: translateX(-4%) skewX(-5deg); opacity: .35; } }
@media (prefers-reduced-motion: reduce) { ${all('::before')}, ${all('::after')} { animation: none; } .sc-track::after, .sc-kyiv::after { opacity: 0; } }
/* /r9-bg */`);
  return out.concat(kf).join('\n') + '\n';
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const file = new URL('../public/style.css', import.meta.url);
  const cur = fs.readFileSync(file, 'utf8');
  const block = css();
  const i = cur.indexOf('/* r9-bg */'), j = cur.indexOf('/* /r9-bg */');
  const next = i >= 0 && j > i ? cur.slice(0, i) + block + cur.slice(j + '/* /r9-bg */\n'.length) : cur.replace(/\n*$/, '\n') + block;
  fs.writeFileSync(file, next);
  console.log(`style.css: r9-bg block ${(block.length / 1024).toFixed(1)} KB`);
}
