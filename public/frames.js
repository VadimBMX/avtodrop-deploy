// Profile frames drawn in code (owner 06.11: the flat webp rings looked cheap). S.PROFILE_FRAMES says who may wear
// which; this module draws them: frameHtml(id) → a stack of layers in one 100 × 100 box (viewBox -50…50, centre 0,0):
//   · CSS layers (<i>): conic-gradient metal bodies, glows and sheens, masked to the ring in public/style.css (.pf-*);
//   · SVG layers: bevels, rivets, checks, crowns, flames, arcs — gradients / patterns live once in a hidden <svg>
//     (ensureDefs) so 30+ rows in the rating stay light.
// Every frame has the same hole: the ring runs from r = 35.5 to r = 46 (ornaments up to ~50), so the helmet sits in
// the same place in all of them (public/s2-ui.js FRAME_HOLE). Animated parts are separate layers that move only with
// transform / opacity, and only while the frame carries `.live` — given by frameWatch() to frames marked data-live
// (header, profile, look picker, shop, licence) that are on screen, never under prefers-reduced-motion. Rows in the
// rating get the still pose, which is a finished picture on its own.
export const RING = { in: 35.5, out: 46 };

const f2 = (v) => +v.toFixed(2);
const pt = (r, a) => { const t = (a * Math.PI) / 180; return [f2(r * Math.sin(t)), f2(-r * Math.cos(t))]; }; // 0° = top, clockwise
const P = (r, a) => pt(r, a).join(',');
const range = (n, fn) => Array.from({ length: n }, (_, i) => fn(i, (i * 360) / n)).join('');
function rng(seed) { // small deterministic PRNG: the same speckles on every render
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
// A slice of a band between radii r1 < r2 and angles a1 < a2.
function seg(r1, r2, a1, a2) {
  const lg = a2 - a1 > 180 ? 1 : 0;
  return `M${P(r2, a1)}A${r2} ${r2} 0 ${lg} 1 ${P(r2, a2)}L${P(r1, a2)}A${r1} ${r1} 0 ${lg} 0 ${P(r1, a1)}Z`;
}
const circ = (r, attrs) => `<circle r="${r}" fill="none" ${attrs}/>`;
const band = (r1, r2, paint, extra = '') => circ(f2((r1 + r2) / 2), `stroke="${paint}" stroke-width="${f2(r2 - r1)}" ${extra}`);
// The bevel every frame shares: lit outer edge on top, lit inner edge below, a dark seam to the hole and to the page.
const bevel = (ri = RING.in, ro = RING.out, k = 1) => `${circ(ro + 0.7, `stroke="#000" stroke-opacity="${0.45 * k}" stroke-width="1.4"`)}
  ${circ(ro - 0.45, `stroke="url(#pfHiT)" stroke-width=".9"`)}${circ(ri + 0.45, `stroke="url(#pfHiB)" stroke-width=".9"`)}
  ${circ(ri - 0.2, `stroke="#000" stroke-opacity=".75" stroke-width=".8"`)}${circ(ri + 1.2, `stroke="url(#pfShT)" stroke-width="1.6"`)}`;
// A 4-point glint.
const glint = (x, y, s, fill = '#fff') => `<path d="M${x},${f2(y - s)}Q${f2(x + s * 0.14)},${f2(y - s * 0.14)} ${f2(x + s)},${y}Q${f2(x + s * 0.14)},${f2(y + s * 0.14)} ${x},${f2(y + s)}Q${f2(x - s * 0.14)},${f2(y + s * 0.14)} ${f2(x - s)},${y}Q${f2(x - s * 0.14)},${f2(y - s * 0.14)} ${x},${f2(y - s)}Z" fill="${fill}"/>`;
const sphere = (r, a, s, g) => { const [x, y] = pt(r, a); return `<circle cx="${x}" cy="${y}" r="${s}" fill="url(#${g})"/>`; };
const sphereXY = (x, y, s, g) => `<circle cx="${x}" cy="${y}" r="${s}" fill="url(#${g})"/>`;
// A five-point star (centre x, y; outer radius s).
function star(x, y, s, fill, rot = 0) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.45 : s, t = ((rot + i * 36) * Math.PI) / 180;
    d += `${i ? 'L' : 'M'}${f2(x + r * Math.sin(t))},${f2(y - r * Math.cos(t))}`;
  }
  return `<path d="${d}Z" fill="${fill}"/>`;
}
// A flame tongue standing out of radius rb at angle a: height h, half-width w (degrees), curl (degrees at the tip).
function tongue(rb, a, h, w, curl = 0) {
  const L = P(rb, a - w), R = P(rb, a + w), tip = P(rb + h, a + curl);
  return `M${L}C${P(rb + h * 0.38, a - w * 1.15)} ${P(rb + h * 0.78, a - w * 0.25 + curl * 0.6)} ${tip}C${P(rb + h * 0.66, a + w * 0.45 + curl * 0.4)} ${P(rb + h * 0.3, a + w * 1.2)} ${R}Z`;
}
function flames(seed, n, rb, hMin, hMax, wMin, wMax) {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n + (r() - 0.5) * (200 / n);
    d += tongue(rb, a, hMin + r() * (hMax - hMin), wMin + r() * (wMax - wMin), (r() - 0.5) * 14);
  }
  return d;
}
// A jagged electric arc along the ring from a1 to a2 around radius rc, with a few sparks off it.
function bolt(seed, rc, a1, a2, jit = 2.6) {
  const r = rng(seed);
  const pts = [];
  for (let a = a1; a <= a2; a += 4 + r() * 4) pts.push(P(rc + (r() - 0.5) * 2 * jit, a));
  let d = `M${pts.join('L')}`;
  for (let k = 0; k < 2; k++) {
    const a = a1 + (a2 - a1) * (0.25 + r() * 0.5), out = r() > 0.35 ? 1 : -1;
    let rr = rc, aa = a;
    d += `M${P(rr, aa)}`;
    for (let s = 0; s < 3; s++) (rr += out * (1.6 + r() * 2.2), aa += (r() - 0.5) * 9, d += `L${P(rr, aa)}`);
  }
  return d;
}
const svg = (cls, body, style = '') => `<svg class="pf-l ${cls}" viewBox="-50 -50 100 100" focusable="false"${style ? ` style="${style}"` : ''}>${body}</svg>`;
// A glint on its own layer, twinkling (scale) round its own centre while live.
const spk = (cls, x, y, s, fill) => svg(`pf-spk ${cls}`, glint(x, y, s, fill), `transform-origin:${x + 50}% ${y + 50}%`);
const lay = (cls) => `<i class="pf-l ${cls}"></i>`;

// ---------- shared paint servers ----------
const DEFS = `<linearGradient id="pfHiT" gradientUnits="userSpaceOnUse" x1="0" y1="-50" x2="0" y2="50"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".33" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="pfHiB" gradientUnits="userSpaceOnUse" x1="0" y1="-50" x2="0" y2="50"><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".6"/></linearGradient>
<linearGradient id="pfShT" gradientUnits="userSpaceOnUse" x1="0" y1="-40" x2="0" y2="40"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".5" stop-color="#000" stop-opacity="0"/></linearGradient>
<linearGradient id="pfGloss" gradientUnits="userSpaceOnUse" x1="-20" y1="-48" x2="12" y2="20"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".4" stop-color="#fff" stop-opacity=".08"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="pfSphGold" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fffbe0"/><stop offset=".35" stop-color="#f3c64a"/><stop offset=".8" stop-color="#8a5a10"/><stop offset="1" stop-color="#5a3806"/></radialGradient>
<radialGradient id="pfSphRust" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#e7a877"/><stop offset=".4" stop-color="#9b5427"/><stop offset="1" stop-color="#3a1b0b"/></radialGradient>
<radialGradient id="pfSphSteel" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="#b9c1ca"/><stop offset="1" stop-color="#363c44"/></radialGradient>
<radialGradient id="pfSphBronze" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffe2b8"/><stop offset=".4" stop-color="#c0803e"/><stop offset="1" stop-color="#4a2a10"/></radialGradient>
<radialGradient id="pfGemRed" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffe0e4"/><stop offset=".3" stop-color="#ff3550"/><stop offset=".75" stop-color="#9a0018"/><stop offset="1" stop-color="#4a000a"/></radialGradient>
<radialGradient id="pfGemBlue" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#e6f2ff"/><stop offset=".3" stop-color="#3d8bff"/><stop offset=".75" stop-color="#0b2f8a"/><stop offset="1" stop-color="#04133d"/></radialGradient>
<radialGradient id="pfGemWhite" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#d8eeff"/><stop offset="1" stop-color="#5d7fa6"/></radialGradient>
<radialGradient id="pfGemPurple" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffe6ff"/><stop offset=".3" stop-color="#d04dff"/><stop offset=".75" stop-color="#5a0f8a"/><stop offset="1" stop-color="#2a0545"/></radialGradient>
<radialGradient id="pfGemGreen" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#e6fff0"/><stop offset=".3" stop-color="#2fe08a"/><stop offset=".75" stop-color="#086b3a"/><stop offset="1" stop-color="#02301a"/></radialGradient>
<linearGradient id="pfGoldV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4c2"/><stop offset=".3" stop-color="#f6cc4e"/><stop offset=".62" stop-color="#b47c12"/><stop offset=".8" stop-color="#e8b53a"/><stop offset="1" stop-color="#6b4507"/></linearGradient>
<linearGradient id="pfGoldD" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".4" stop-color="#e5ad2c"/><stop offset="1" stop-color="#7a4f09"/></linearGradient>
<linearGradient id="pfSilverV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#d3dae2"/><stop offset=".65" stop-color="#7d8792"/><stop offset=".82" stop-color="#c3cbd4"/><stop offset="1" stop-color="#4b535c"/></linearGradient>
<linearGradient id="pfBronzeV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd9a8"/><stop offset=".35" stop-color="#cf8c48"/><stop offset=".7" stop-color="#7a4518"/><stop offset="1" stop-color="#40220a"/></linearGradient>
<linearGradient id="pfYellowV" gradientUnits="userSpaceOnUse" x1="0" y1="-50" x2="0" y2="50"><stop offset="0" stop-color="#fff07a"/><stop offset=".45" stop-color="#ffd400"/><stop offset="1" stop-color="#b88a00"/></linearGradient>
<radialGradient id="pfFlame" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="55"><stop offset=".72" stop-color="#fff8c8"/><stop offset=".79" stop-color="#ffd84a"/><stop offset=".86" stop-color="#ff8a00"/><stop offset=".93" stop-color="#ee3300" stop-opacity=".95"/><stop offset="1" stop-color="#a00c00" stop-opacity="0"/></radialGradient>
<radialGradient id="pfFlameDeep" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="56"><stop offset=".74" stop-color="#ffb000"/><stop offset=".86" stop-color="#ff4a00"/><stop offset=".94" stop-color="#b81000" stop-opacity=".9"/><stop offset="1" stop-color="#600000" stop-opacity="0"/></radialGradient>
<radialGradient id="pfEmber" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="52"><stop offset=".8" stop-color="#ffcf4a"/><stop offset=".88" stop-color="#ff5a00"/><stop offset="1" stop-color="#8a0d00" stop-opacity="0"/></radialGradient>
<radialGradient id="pfPuff" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e9ecf2" stop-opacity=".55"/><stop offset=".55" stop-color="#b9bfca" stop-opacity=".25"/><stop offset="1" stop-color="#9aa1ad" stop-opacity="0"/></radialGradient>
<radialGradient id="pfPuffV" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#d9c7ff" stop-opacity=".5"/><stop offset=".55" stop-color="#8f7ad0" stop-opacity=".22"/><stop offset="1" stop-color="#5a4a90" stop-opacity="0"/></radialGradient>
<linearGradient id="pfIceA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#c9f1ff"/><stop offset="1" stop-color="#5fbfe8"/></linearGradient>
<linearGradient id="pfIceB" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fe2fb"/><stop offset="1" stop-color="#2a86c4"/></linearGradient>
<linearGradient id="pfCarbA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c5058"/><stop offset=".5" stop-color="#16171a"/><stop offset="1" stop-color="#3c4047"/></linearGradient>
<linearGradient id="pfCarbB" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a2d33"/><stop offset=".5" stop-color="#08090a"/><stop offset="1" stop-color="#24272c"/></linearGradient>
<pattern id="pfCarb" width="4.4" height="4.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4.4" height="4.4" fill="#0e0f11"/><rect x=".1" y=".1" width="2" height="2" rx=".3" fill="url(#pfCarbA)"/><rect x="2.3" y="2.3" width="2" height="2" rx=".3" fill="url(#pfCarbA)"/><rect x="2.3" y=".1" width="2" height="2" rx=".3" fill="url(#pfCarbB)"/><rect x=".1" y="2.3" width="2" height="2" rx=".3" fill="url(#pfCarbB)"/></pattern>
<filter id="pfBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.5"/></filter><filter id="pfSoft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".45"/></filter>
<radialGradient id="pfLeaf" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#fff2b0"/><stop offset=".45" stop-color="#e2a92a"/><stop offset="1" stop-color="#7a4d08"/></radialGradient>`;

// Asphalt grain (season2): one 9-unit tile of light and dark specks, repeated.
const ASPH = (() => {
  const r = rng(31);
  let d = '<rect width="9" height="9" fill="#2b2c2f"/>';
  for (let i = 0; i < 26; i++) d += `<circle cx="${f2(r() * 9)}" cy="${f2(r() * 9)}" r="${f2(0.16 + r() * 0.34)}" fill="${i % 3 ? '#8b8d92' : '#0e0f10'}" fill-opacity="${f2(0.4 + r() * 0.4)}"/>`;
  return `<pattern id="pfAsph" width="9" height="9" patternUnits="userSpaceOnUse">${d}</pattern>`;
})();
let defsIn = false;
export function ensureDefs() {
  if (defsIn || typeof document === 'undefined' || !document.body) return;
  defsIn = true;
  const d = document.createElement('div');
  d.innerHTML = `<svg id="pfDefs" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>${DEFS}${ASPH}</defs></svg>`;
  document.body.prepend(d.firstChild);
}

// ---------- the frames ----------
const R1 = RING.in, R2 = RING.out, RM = (R1 + R2) / 2;
// Speckles inside the band (rust pits, asphalt grain…).
function speckle(seed, n, r1, r2, s1, s2, fill, op) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(r1 + r() * (r2 - r1), r() * 360);
    out += `<circle cx="${x}" cy="${y}" r="${f2(s1 + r() * (s2 - s1))}" fill="${fill}" fill-opacity="${f2(op * (0.5 + r() * 0.5))}"/>`;
  }
  return out;
}
const crown = (fillId = 'pfGoldV', gems = true, y0 = -36.5, w = 12.5, h = 14.5) => {
  const top = y0 - h;
  const d = `M${-w},${y0}L${f2(-w - 1.4)},${f2(top + 2.5)}L${f2(-w * 0.48)},${f2(top + 6.8)}L0,${top}L${f2(w * 0.48)},${f2(top + 6.8)}L${f2(w + 1.4)},${f2(top + 2.5)}L${w},${y0}Z`;
  return `<path d="${d}" fill="#000" fill-opacity=".45" transform="translate(0 1.2)"/><path d="${d}" fill="url(#${fillId})" stroke="#4a2e03" stroke-width=".6" stroke-linejoin="round"/>
    <path d="M${-w + 0.4},${f2(y0 - 2.6)}H${f2(w - 0.4)}" stroke="#5a3a05" stroke-width=".7" stroke-opacity=".6"/>
    ${sphereXY(f2(-w - 1.4), f2(top + 2.2), 1.6, 'pfSphGold')}${sphereXY(0, f2(top - 0.4), 1.9, 'pfSphGold')}${sphereXY(f2(w + 1.4), f2(top + 2.2), 1.6, 'pfSphGold')}
    ${gems ? `${sphereXY(0, f2(y0 - 5.6), 2.2, 'pfGemRed')}${sphereXY(f2(-w * 0.55), f2(y0 - 4.6), 1.5, 'pfGemBlue')}${sphereXY(f2(w * 0.55), f2(y0 - 4.6), 1.5, 'pfGemBlue')}` : ''}`;
};
// Laurel branch along the ring's outside, from angle a1 to a2 (dir +1 clockwise).
function laurel(a1, a2, r = 44.6, fill = 'url(#pfLeaf)', n = 9) {
  let out = '';
  const dir = Math.sign(a2 - a1);
  for (let i = 0; i < n; i++) {
    const a = a1 + ((a2 - a1) * i) / (n - 1);
    const s = 1 - (i / n) * 0.35;
    for (const side of [-1, 1]) {
      const [x, y] = pt(r + side * 2.3 * s, a);
      const rot = a + (side > 0 ? 35 : -35) * dir + (dir > 0 ? 0 : 180);
      out += `<ellipse cx="${x}" cy="${y}" rx="${f2(1.25 * s)}" ry="${f2(3 * s)}" transform="rotate(${f2(rot)} ${x} ${y})" fill="${fill}" stroke="#4a2e03" stroke-width=".35"/>`;
    }
  }
  const lg = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return `<path d="M${P(r, a1)}A${r} ${r} 0 ${lg} ${dir > 0 ? 1 : 0} ${P(r, a2)}" fill="none" stroke="#6b4508" stroke-width=".8"/>${out}`;
}

// Polished metal with a recessed channel of beads (L15 «Золото»; the podium's bronze).
const goldLike = (bead, ch, hi, lo) => [lay('pf-band'),
  svg('pf-d', `${band(38.4, 43.2, ch, 'stroke-opacity=".55"')}${circ(38.4, `stroke="${hi}" stroke-opacity=".55" stroke-width=".5"`)}${circ(43.2, `stroke="${lo}" stroke-opacity=".8" stroke-width=".55"`)}
    ${range(28, (i, a) => sphere(40.8, a, 1.45, bead))}
    ${bevel(R1, R2, 1)}`), spk('pf-spk1', -31, -33, 4.2)];

// Smoke: soft tendrils curling round the ring (blurred strokes) and a few puffs; `tint` = the stroke colour.
function wisps(seed, n, r0, tint, op) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n + r() * 20, len = 40 + r() * 50, ra = r0 + r() * 2.5, rb = ra + 2.5 + r() * 4;
    const m = a + len / 2;
    out += `<path d="M${P(ra, a)}Q${P(rb + 2.5, m)} ${P(rb, a + len)}" fill="none" stroke="${tint}" stroke-opacity="${f2(op * (0.6 + r() * 0.4))}" stroke-width="${f2(2.2 + r() * 2.6)}" stroke-linecap="round"/>`;
  }
  return `<g filter="url(#pfBlur)">${out}</g>`;
}
// Wind-blown flames: all tips lean clockwise (`lean` degrees), so the ring reads as one fire, not a saw blade.
function fireRing(seed, n, rb, hMin, hMax, wMin, wMax, lean) {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n + (r() - 0.5) * (240 / n);
    d += tongue(rb, a, hMin + r() * (hMax - hMin), wMin + r() * (wMax - wMin), lean * (0.6 + r() * 0.8));
  }
  return d;
}

const DRAW = {
  // ---- level frames: humble → loud ----
  rust: () => [lay('pf-band'),
    svg('pf-d', `${speckle(11, 70, R1 + 0.6, R2 - 0.6, 0.35, 1.25, '#2a1206', 0.75)}${speckle(12, 34, R1 + 0.6, R2 - 0.6, 0.25, 0.7, '#e08a45', 0.6)}
      ${circ(R1 + 2.1, 'stroke="#2e1608" stroke-opacity=".7" stroke-width=".7"')}${circ(R2 - 2.1, 'stroke="#2e1608" stroke-opacity=".7" stroke-width=".7"')}
      ${range(8, (i, a) => `${sphere(RM, a + 22.5, 2.25, 'pfSphRust')}${(() => { const [x, y] = pt(RM, a + 22.5); return `<circle cx="${x}" cy="${y}" r="2.25" fill="none" stroke="#1e0d04" stroke-width=".45"/>`; })()}`)}
      ${bevel(R1, R2, 1)}`)],
  steel: () => [lay('pf-band'),
    svg('pf-d', `${circ(RM, 'stroke="#2b3036" stroke-width=".9"')}${circ(RM + 0.75, 'stroke="#fff" stroke-opacity=".45" stroke-width=".5"')}
      ${range(4, (i, a) => { const [x, y] = pt(RM, a + 45); const hex = range(6, (k, b) => `${k ? 'L' : 'M'}${f2(x + 2.5 * Math.sin(((b + 30) * Math.PI) / 180))},${f2(y - 2.5 * Math.cos(((b + 30) * Math.PI) / 180))}`) + 'Z';
        return `<path d="${hex}" fill="url(#pfSphSteel)" stroke="#2a2f35" stroke-width=".5"/><circle cx="${x}" cy="${y}" r=".9" fill="#454c55"/>`; })}
      ${range(4, (i, a) => `<path d="${seg(R2 - 1.7, R2 - 0.9, a - 8, a + 8)}" fill="#1f2328" fill-opacity=".55"/>`)}
      ${bevel(R1, R2, 1)}`)],
  racer: () => [svg('pf-d', `${band(R1, R2, '#141518')}
      ${range(24, (i, a) => `<path d="${seg(37.8, RM, a, a + 15)}" fill="${i % 2 ? '#f4f4f2' : '#16171a'}"/><path d="${seg(RM, 43.7, a, a + 15)}" fill="${i % 2 ? '#16171a' : '#f4f4f2'}"/>`)}
      ${band(R1, 37.8, 'url(#pfYellowV)')}${band(43.7, R2, 'url(#pfYellowV)')}
      ${circ(37.8, 'stroke="#000" stroke-opacity=".6" stroke-width=".5"')}${circ(43.7, 'stroke="#000" stroke-opacity=".6" stroke-width=".5"')}
      ${band(R1, R2, 'url(#pfGloss)')}
      <path d="M-3.2,-49.6L0,-46.2L3.2,-49.6Z" fill="#ffd400" stroke="#000" stroke-width=".5" stroke-linejoin="round"/>
      ${bevel(R1, R2, 1)}`)],
  gold: () => goldLike('pfSphGold', '#3d2603', '#fff3c4', '#4a2e03'),
  bronze: () => goldLike('pfSphBronze', '#3a1c06', '#ffe0bd', '#3a1c06'),
  neon: () => [lay('pf-glow'), lay('pf-band'),
    svg('pf-d', `${circ(R1 + 1, 'stroke="#2d333d" stroke-width="2"')}${circ(R2 - 1, 'stroke="#2d333d" stroke-width="2"')}
      ${circ(44.2, 'stroke="#a46bff" stroke-opacity=".9" stroke-width=".7"')}
      <g class="pf-tube">${circ(RM, 'stroke="#20e4ff" stroke-width="3.2" stroke-opacity=".55"')}${circ(RM, 'stroke="#7ff4ff" stroke-width="1.8"')}${circ(RM, 'stroke="#f2feff" stroke-width=".7"')}</g>
      ${range(6, (i, a) => { const [x, y] = pt(RM, a + 30); return `<rect x="${f2(x - 1.3)}" y="${f2(y - 2.9)}" width="2.6" height="5.8" rx=".6" transform="rotate(${a + 30} ${x} ${y})" fill="url(#pfSilverV)" stroke="#0b0d11" stroke-width=".4"/>`; })}
      ${bevel(R1, R2, 1)}`)],
  smoke: () => [svg('pf-smk pf-smk1', wisps(41, 9, 44.5, '#cbbcff', 0.55)),
    lay('pf-band'),
    svg('pf-d', `${circ(RM, 'stroke="#000" stroke-opacity=".4" stroke-width=".6"')}${circ(RM + 0.6, 'stroke="#c9b8ff" stroke-opacity=".25" stroke-width=".4"')}${bevel(R1, R2, 1)}${band(R1, R2, 'url(#pfGloss)', 'opacity=".7"')}`),
    svg('pf-smk pf-smk2', wisps(83, 6, 43.5, '#eef0f6', 0.42))],
  inferno: () => [lay('pf-glow'),
    svg('pf-fl pf-fl1', `<path d="${flames(7, 22, 43, 3.2, 7.2, 3.2, 5.5)}" fill="url(#pfFlameDeep)"/>`),
    lay('pf-band'),
    svg('pf-d pf-lava', (() => { const r = rng(5); let d = ''; for (let i = 0; i < 9; i++) { const a = i * 40 + r() * 20; let rr = R1 + 1 + r() * 2, aa = a; d += `M${P(rr, aa)}`; for (let s = 0; s < 4; s++) (rr += 1.6 + r() * 1.6, aa += (r() - 0.5) * 12, d += `L${P(Math.min(rr, R2 - 1), aa)}`); }
      return `<path d="${d}" fill="none" stroke="#ff5a00" stroke-width="1.6" stroke-opacity=".55" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#ffd36a" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round"/>`; })()
      + `${circ(R1 + 0.6, 'stroke="#ff7a1a" stroke-width="1.1" stroke-opacity=".9"')}${circ(R2 - 0.5, 'stroke="#ffb347" stroke-width=".6" stroke-opacity=".6"')}${bevel(R1, R2, 0.8)}`),
    svg('pf-emb', speckle(21, 16, 47, 51, 0.35, 0.8, '#ffd36a', 1))],
  // ---- special frames ----
  vip: () => [lay('pf-band'),
    svg('pf-d', `${band(R1, 37.6, 'url(#pfGoldV)')}${band(43.9, R2, 'url(#pfGoldV)')}${circ(37.6, 'stroke="#2a1a02" stroke-width=".5"')}${circ(43.9, 'stroke="#2a1a02" stroke-width=".5"')}
      ${range(12, (i, a) => (a === 0 ? '' : i % 3 === 0 ? sphere(RM, a, 1.7, 'pfGemWhite') : `<circle cx="${pt(RM, a)[0]}" cy="${pt(RM, a)[1]}" r=".75" fill="#e7b83c"/>`))}
      ${band(R1, R2, 'url(#pfGloss)', 'opacity=".55"')}${bevel(R1, R2, 1)}${crown('pfGoldV', true, -37, 11.5, 13)}`), spk('pf-spk1', 31, -31, 3.6)],
  club_leader: () => [lay('pf-band'),
    svg('pf-d', `${band(R1, 37.4, 'url(#pfSilverV)')}${band(44.1, R2, 'url(#pfSilverV)')}
      ${range(18, (i, a) => (a > 330 || a < 30 ? '' : star(...pt(RM, a), 1.25, '#dfe6ee')))}
      ${band(R1, R2, 'url(#pfGloss)', 'opacity=".5"')}${bevel(R1, R2, 1)}
      <path d="M0,-51.5C4.5,-50 8.6,-50.2 10.6,-50.6V-42C10.6,-37.5 5.6,-34 0,-32.2C-5.6,-34 -10.6,-37.5 -10.6,-42V-50.6C-8.6,-50.2 -4.5,-50 0,-51.5Z" fill="#000" fill-opacity=".45" transform="translate(0 1.2)"/>
      <path d="M0,-51.5C4.5,-50 8.6,-50.2 10.6,-50.6V-42C10.6,-37.5 5.6,-34 0,-32.2C-5.6,-34 -10.6,-37.5 -10.6,-42V-50.6C-8.6,-50.2 -4.5,-50 0,-51.5Z" fill="url(#pfSilverV)" stroke="#2a3038" stroke-width=".6"/>
      <path d="M0,-49.3C3.6,-48.2 6.6,-48.2 8.4,-48.5V-42.3C8.4,-38.8 4.5,-36.2 0,-34.7C-4.5,-36.2 -8.4,-38.8 -8.4,-42.3V-48.5C-6.6,-48.2 -3.6,-48.2 0,-49.3Z" fill="#163a8c"/>
      ${star(0, -42.3, 5, '#ffd400')}`)],
  patron: () => [lay('pf-band'),
    svg('pf-d', `${band(R1, 37.3, 'url(#pfGoldV)')}${band(44.2, R2, 'url(#pfGoldV)')}
      ${range(24, (i, a) => { const [x, y] = pt(RM, a + 7.5); return `<path d="M${P(RM - 2.2, a)}Q${x},${y} ${P(RM + 2.2, a)}" fill="none" stroke="#f0c04a" stroke-width=".5" stroke-opacity=".75"/>`; })}
      ${range(8, (i, a) => (a === 0 ? '' : sphere(RM, a, 1.35, i % 2 ? 'pfGemPurple' : 'pfSphGold')))}
      ${band(R1, R2, 'url(#pfGloss)', 'opacity=".55"')}${bevel(R1, R2, 1)}
      <path d="M0,-33.6C-3.4,-37 -9.6,-41 -9.6,-46.2C-9.6,-49.6 -6.9,-51.6 -4.6,-51.6C-2.6,-51.6 -1,-50.4 0,-48.6C1,-50.4 2.6,-51.6 4.6,-51.6C6.9,-51.6 9.6,-49.6 9.6,-46.2C9.6,-41 3.4,-37 0,-33.6Z" fill="url(#pfGoldV)" stroke="#4a2e03" stroke-width=".6"/>
      <path d="M0,-36.6C-2.6,-39.4 -7.1,-42.4 -7.1,-46C-7.1,-48.2 -5.5,-49.5 -4.1,-49.5C-2.4,-49.5 -1,-48.2 0,-46.4C1,-48.2 2.4,-49.5 4.1,-49.5C5.5,-49.5 7.1,-48.2 7.1,-46C7.1,-42.4 2.6,-39.4 0,-36.6Z" fill="url(#pfGemRed)"/>
      <path d="M-4.6,-47.6Q-3.4,-48.8 -1.9,-47.9" fill="none" stroke="#fff" stroke-width=".7" stroke-linecap="round" stroke-opacity=".9"/>`)],
  legend_s1: () => [lay('pf-glow'), lay('pf-band'),
    svg('pf-d', `${bevel(R1, R2, 1)}${band(R1, R2, 'url(#pfGloss)', 'opacity=".6"')}${laurel(165, 20, 46.2)}${laurel(195, 340, 46.2)}
      ${star(0, -46.6, 4.6, 'url(#pfGoldV)')}
      <circle cx="0" cy="44.6" r="6.6" fill="#000" fill-opacity=".45"/><circle cx="0" cy="43.8" r="6.4" fill="url(#pfGoldV)" stroke="#4a2e03" stroke-width=".6"/><circle cx="0" cy="43.8" r="4.7" fill="#2a1a03"/>
      <text x="0" y="45.95" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="5.6" fill="#ffd84a" letter-spacing="-.3">S1</text>`), spk('pf-spk1', -30, -32, 3.8)],
  veteran_s1: () => [lay('pf-band'),
    svg('pf-d', `${circ(38.2, 'stroke="#3a1f08" stroke-width=".55" stroke-opacity=".7"')}${circ(43.3, 'stroke="#3a1f08" stroke-width=".55" stroke-opacity=".7"')}
      ${range(10, (i, a) => (a === 180 ? '' : `${star(pt(RM, a)[0], pt(RM, a)[1] + 0.4, 3, '#2a1505', a)}${star(...pt(RM, a), 2.9, 'url(#pfGoldD)', a)}`))}
      ${bevel(R1, R2, 1)}
      <path d="M-7,38.8H7V47.6L0,51.6L-7,47.6Z" fill="#000" fill-opacity=".45" transform="translate(0 1)"/><path d="M-7,38.8H7V47.6L0,51.6L-7,47.6Z" fill="url(#pfBronzeV)" stroke="#3a1f08" stroke-width=".6"/>
      <path d="M-4.6,42.2L0,44.8L4.6,42.2M-4.6,45.4L0,48L4.6,45.4" fill="none" stroke="#ffe6c0" stroke-width="1.2" stroke-linejoin="round"/>`)],
  season2: () => [svg('pf-d', `${band(R1, R2, 'url(#pfAsph)')}
      ${circ(R1 + 1.25, 'stroke="#e8e8e2" stroke-width=".8"')}${circ(R2 - 1.25, 'stroke="#e8e8e2" stroke-width=".8"')}
      ${circ(RM, 'stroke="#ffd400" stroke-width="1.5" stroke-dasharray="4.6 3.15"')}
      ${band(R1, R2, 'url(#pfGloss)', 'opacity=".35"')}${bevel(R1, R2, 1)}
      <rect x="-8" y="-51" width="16" height="9.4" rx="2.2" fill="#000" fill-opacity=".45" transform="translate(0 1)"/><rect x="-8" y="-51" width="16" height="9.4" rx="2.2" fill="#ffd400" stroke="#111" stroke-width=".7"/>
      <text x="0" y="-43.6" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="7" fill="#111" letter-spacing="-.2">S2</text>`)],
  king: () => [lay('pf-rays'), lay('pf-glow'), lay('pf-band'),
    svg('pf-d', `${band(38, 43.5, '#5a0612')}${band(38, 43.5, 'url(#pfGloss)', 'opacity=".5"')}${circ(38, 'stroke="#3a2502" stroke-width=".6"')}${circ(43.5, 'stroke="#3a2502" stroke-width=".6"')}
      ${range(10, (i, a) => (a === 0 ? '' : `${sphere(40.75, a, 2.05, 'pfSphGold')}${sphere(40.75, a, 1.35, i % 2 ? 'pfGemBlue' : 'pfGemRed')}`))}
      ${bevel(R1, R2, 1)}${crown('pfGoldV', true, -36.6, 13.5, 15.5)}`), spk('pf-spk1', -32, -30, 4.2), spk('pf-spk2', 34, 22, 3)],
  halloween: () => [lay('pf-glow'), lay('pf-band'),
    svg('pf-d', `${range(14, (i, a) => `<path d="M${P(R1 + 0.4, a)}Q${P(RM, a - 3)} ${P(R2 - 0.4, a)}" fill="none" stroke="#7a2c03" stroke-width=".9" stroke-opacity=".7"/>`)}
      ${band(R1, R2, 'url(#pfGloss)', 'opacity=".6"')}${bevel(R1, R2, 1)}
      <path d="M-1.4,-44.6C-1.2,-48.4 0.4,-50.6 3,-51.6" fill="none" stroke="#3d6b1a" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M3.4,-47.4c3,-2.8 6.6,-2 7.6,.4c-2.8,1 -5.4,.8 -7.6,-.4z" fill="#4f8a22"/>
      ${range(3, (i) => { const [x, y] = pt(49, 125 + i * 55); return `<path d="M${f2(x - 3.4)},${y}q1.2,-1.6 2.2,-.4q.6,-1.4 1.2,0q.6,-1.4 1.2,0q1,-1.2 2.2,.4q-1.6,-.2 -2.2,1.2q-.6,-.9 -1.2,0q-.6,-.9 -1.2,0q-.6,-1.4 -2.2,-1.2z" fill="#1a0f22"/>`; })}`)],
  diamond: () => [lay('pf-glow'),
    svg('pf-d', `${band(R1, R2, '#9fd6f5')}
      ${range(20, (i, a) => `<path d="M${P(R1, a)}L${P(R2, a + 9)}L${P(R1, a + 18)}Z" fill="url(#pfIceA)"/><path d="M${P(R2, a + 9)}L${P(R1, a + 18)}L${P(R2, a + 27)}Z" fill="url(#pfIceB)"/>`)}
      ${range(20, (i, a) => `<path d="M${P(R1, a)}L${P(R2, a + 9)}L${P(R1, a + 18)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".3"/>`)}
      ${range(6, (i, a) => sphere(R2 - 0.2, a + 9, 1.3, 'pfGemWhite'))}
      ${bevel(R1, R2, 1)}`), spk('pf-spk1', -30, -33, 4.6), spk('pf-spk2', 33, 20, 3.4)],
  drift: () => [svg('pf-smk pf-smk2', wisps(121, 8, 45, '#e6e8ee', 0.5)),
    svg('pf-d', `${band(R1, R2, '#141517')}
      ${range(26, (i, a) => `<path d="M${P(R2 - 0.2, a - 4)}L${P(RM + 0.8, a + 1.5)}L${P(R2 - 0.2, a + 7)}L${P(R2 - 0.2, a + 4.4)}L${P(RM + 2.6, a + 1.5)}L${P(R2 - 0.2, a - 1.4)}Z" fill="#33363b"/>`)}
      ${circ(R1 + 2.4, 'stroke="#25272b" stroke-width="2.6"')}${circ(R1 + 2.4, 'stroke="#ffd400" stroke-width=".6" stroke-dasharray="6 3"')}
      ${band(R1, R2, 'url(#pfGloss)', 'opacity=".4"')}${bevel(R1, R2, 1)}`)],

  // ---- premium (Telegram Stars) — animated while .live ----
  fire: () => [lay('pf-glow'),
    svg('pf-fl pf-fl1', `<path d="${fireRing(101, 12, 43, 9, 16, 6.5, 10, 11)}" fill="url(#pfFlameDeep)" filter="url(#pfSoft)"/>`),
    svg('pf-fl pf-fl2', `<path d="${fireRing(202, 16, 43.5, 6, 12, 5, 8, 13)}" fill="url(#pfFlame)" filter="url(#pfSoft)"/>`),
    lay('pf-band'),
    svg('pf-d', `${circ(R1 + 0.7, 'stroke="#ffb34a" stroke-width="1.2"')}${circ(R2 - 0.6, 'stroke="#ffd36a" stroke-width=".8" stroke-opacity=".8"')}${bevel(R1, R2, 0.6)}`),
    svg('pf-fl pf-fl3', `<path d="${fireRing(303, 11, 45, 3.5, 7.5, 3.5, 6, 15)}" fill="url(#pfFlame)" opacity=".95"/>`),
    svg('pf-emb', speckle(77, 14, 49, 54, 0.35, 0.8, '#ffe28a', 1))],
  neon_pulse: () => [
    `<span class="pf-l pf-np pf-np-p">${lay('pf-glow pf-gp')}${svg('', `${circ(43.4, 'stroke="#ff2bd6" stroke-width="3.4" stroke-opacity=".5"')}${circ(43.4, 'stroke="#ff7ae6" stroke-width="1.9"')}${circ(43.4, 'stroke="#fff0fb" stroke-width=".7"')}`)}</span>`,
    `<span class="pf-l pf-np pf-np-c">${lay('pf-glow pf-gc')}${svg('', `${circ(38.1, 'stroke="#14e1ff" stroke-width="3.2" stroke-opacity=".5"')}${circ(38.1, 'stroke="#7df1ff" stroke-width="1.8"')}${circ(38.1, 'stroke="#f0feff" stroke-width=".7"')}`)}</span>`,
    svg('pf-d', `${circ(RM, 'stroke="#0b0d12" stroke-width="1.4" stroke-opacity=".9"')}${circ(R1, 'stroke="#000" stroke-width=".8"')}${circ(R2 + 0.4, 'stroke="#000" stroke-opacity=".5" stroke-width=".8"')}
      ${range(4, (i, a) => { const [x, y] = pt(RM, a + 45); return `<rect x="${f2(x - 1.2)}" y="${f2(y - 4.8)}" width="2.4" height="9.6" rx=".7" transform="rotate(${a + 45} ${x} ${y})" fill="url(#pfSilverV)" stroke="#07080b" stroke-width=".4"/>`; })}`)],
  lightning: () => [lay('pf-glow'), lay('pf-band'),
    svg('pf-d', `${circ(R1 + 0.6, 'stroke="#58b6ff" stroke-width=".9" stroke-opacity=".9"')}${circ(R2 - 0.6, 'stroke="#58b6ff" stroke-width=".7" stroke-opacity=".7"')}${bevel(R1, R2, 0.8)}
      <path d="${bolt(9, RM, 0, 360, 1.1)}" fill="none" stroke="#7cc8ff" stroke-width=".5" stroke-opacity=".45"/>`),
    ...[[1, 0, 100], [2, 130, 215], [3, 230, 330], [4, 60, 150]].map(([k, a1, a2]) => {
      const d = bolt(500 + k * 31, RM, a1, a2);
      return svg(`pf-arc pf-arc${k}`, `<path d="${d}" fill="none" stroke="#2f8cff" stroke-width="2.6" stroke-opacity=".45" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#bfe6ff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width=".4" stroke-linecap="round" stroke-linejoin="round"/>`);
    })],
  gold_pure: () => [lay('pf-glow'), lay('pf-band'),
    svg('pf-d', `${range(36, (i, a) => `<path d="${seg(R2 - 1.9, R2, a, a + 10)}" fill="${i % 2 ? '#fff4c4' : '#a8730e'}" fill-opacity=".55"/>`)}
      ${range(36, (i, a) => `<path d="${seg(R1, R1 + 1.6, a, a + 10)}" fill="${i % 2 ? '#7a4f09' : '#ffe9a0'}" fill-opacity=".5"/>`)}
      ${circ(RM, 'stroke="#fff6d0" stroke-opacity=".5" stroke-width=".45"')}
      ${range(4, (i, a) => `${sphere(RM, a, 2.3, 'pfSphGold')}${sphere(RM, a, 1.55, 'pfGemWhite')}`)}
      ${bevel(R1, R2, 1)}`),
    lay('pf-sheen'),
    spk('pf-spk1', -30.5, -33.5, 4.6), spk('pf-spk2', 34, 21, 3.4)],
  ice: () => [lay('pf-glow'),
    svg('pf-d', (() => {
      const r = rng(61);
      let sh = '';
      for (let i = 0; i < 22; i++) {
        const a = i * (360 / 22) + (r() - 0.5) * 8, h = 3.5 + r() * 6.5, w = 2.2 + r() * 2.4, rb = R2 - 2;
        const tip = P(rb + h, a + (r() - 0.5) * 6), L = P(rb, a - w), Rr = P(rb, a + w), mid = P(rb + h * 0.35, a);
        sh += `<path d="M${L}L${tip}L${mid}Z" fill="url(#pfIceA)"/><path d="M${Rr}L${tip}L${mid}Z" fill="url(#pfIceB)"/>`;
      }
      return sh;
    })()),
    lay('pf-band'),
    svg('pf-d2', `${speckle(66, 40, R1 + 0.5, R2 - 0.5, 0.2, 0.6, '#fff', 0.85)}
      ${range(12, (i, a) => `<path d="M${P(R1 + 0.8, a + 9)}L${P(R1 + 3.4, a + 12)}M${P(R1 + 0.8, a + 9)}L${P(R1 + 2.8, a + 5)}" stroke="#fff" stroke-opacity=".7" stroke-width=".45" stroke-linecap="round"/>`)}
      ${bevel(R1, R2, 0.7)}`),
    lay('pf-sheen'),
    spk('pf-spk1', -31, -32, 4.2, '#f2fdff'), spk('pf-spk2', 33, 23, 3.2, '#f2fdff'), spk('pf-spk3', -26, 34, 2.6, '#f2fdff')],
  carbon: () => [svg('pf-d', `${band(R1, R2, 'url(#pfCarb)')}
      ${band(41.9, 43.6, '#ffd400')}${band(44.1, 44.7, '#ffd400')}${circ(41.9, 'stroke="#000" stroke-width=".35"')}${circ(44.7, 'stroke="#000" stroke-width=".35"')}
      ${band(R1, R2, 'url(#pfGloss)', 'opacity=".8"')}${circ(R1 + 0.8, 'stroke="#4a4e56" stroke-width=".5"')}${circ(R2 - 0.8, 'stroke="#4a4e56" stroke-width=".5"')}
      ${bevel(R1, R2, 1)}`),
    lay('pf-sheen')],
};

// A frame as HTML (fills its positioned parent; s2-ui.js avatar puts the helmet under it). `live`: may move.
const MEMO = new Map(); // id → its layers (drawn once)
export function frameHtml(id, { live = false } = {}) {
  const k = Object.hasOwn(DRAW, id) ? id : 'rust';
  ensureDefs();
  if (!MEMO.has(k)) MEMO.set(k, DRAW[k]().join(''));
  return `<span class="pf pf-${k}"${live ? ' data-live=""' : ''} aria-hidden="true">${MEMO.get(k)}</span>`;
}
export const frameIds = () => Object.keys(DRAW);

// ---------- motion: only frames marked data-live, only while on screen, never with reduced motion ----------
let watching = false;
export function frameWatch() {
  if (watching || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
  watching = true;
  const rm = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const io = new IntersectionObserver((es) => {
    for (const e of es) e.target.classList.toggle('live', e.isIntersecting && !rm?.matches);
  }, { rootMargin: '40px' });
  const seen = new WeakSet();
  const scan = (root) => {
    if (!root.querySelectorAll) return;
    const list = root.matches?.('.pf[data-live]') ? [root] : root.querySelectorAll('.pf[data-live]');
    for (const el of list) if (!seen.has(el)) (seen.add(el), io.observe(el));
  };
  const drop = (root) => {
    if (!root.querySelectorAll) return;
    const list = root.matches?.('.pf[data-live]') ? [root] : root.querySelectorAll('.pf[data-live]');
    for (const el of list) if (seen.has(el) && !el.isConnected) (seen.delete(el), io.unobserve(el));
  };
  new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.removedNodes) if (n.nodeType === 1) drop(n);
      for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
  rm?.addEventListener?.('change', () => { if (rm.matches) document.querySelectorAll('.pf.live').forEach((el) => el.classList.remove('live')); });
}
