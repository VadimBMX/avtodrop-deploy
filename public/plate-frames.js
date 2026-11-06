// r9-plates: plate frames («Рамки номерів», S.STYLE_ITEMS kind 'frame') drawn in code, in the same family as the
// helmet frames (public/frames.js). plate() in app.js adds plateFrameInner(<its classes>) inside every framed plate:
//   .plf-r  — the rim itself (a rounded ring round the plate, masked to the ring in style.css), with .plf-s inside it
//             (a sheen / lava / glint that may move along the rim);
//   .plf-a / .plf-b / .plf-c — what stands out of the rim: flames, arcs, neon tubes, sparkles (per look, in CSS).
// All of it is CSS on these few empty tags, so 30+ plates on the market stay light. The animated (100 ⭐) looks move
// only while the frame carries `.live`: plateFrameWatch() gives it to animated frames that are on screen, never under
// prefers-reduced-motion. Without `.live` every look is a finished still picture.
export const PLATE_LOOKS = ['neon', 'carbon', 'chrome', 'flame', 'ua', 'blaze', 'volt', 'pulse', 'gild'];
export const PLATE_ANIM = ['blaze', 'volt', 'pulse', 'gild'];
const LOOK_RE = new RegExp(`\\bpf-(${PLATE_LOOKS.join('|')})\\b`);

// The layers for a plate whose class list is `cls` (' pf-neon' …); '' for no frame or a season / event frame
// (those stay a plain ring in CSS).
export function plateFrameInner(cls) {
  const m = LOOK_RE.exec(String(cls || ''));
  if (!m) return '';
  const anim = PLATE_ANIM.includes(m[1]);
  return `<i class="plf"${anim ? ' data-anim=""' : ''} aria-hidden="true"><i class="plf-r"><i class="plf-s"></i></i><i class="plf-a"></i><i class="plf-b"></i><i class="plf-c"></i></i>`;
}

let watching = false;
export function plateFrameWatch() {
  if (watching || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
  watching = true;
  const rm = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const io = new IntersectionObserver((es) => {
    for (const e of es) e.target.classList.toggle('live', e.isIntersecting && !rm?.matches);
  }, { rootMargin: '40px' });
  const seen = new WeakSet();
  const each = (root, fn) => {
    if (!root.querySelectorAll) return;
    if (root.matches?.('.plf[data-anim]')) fn(root);
    else root.querySelectorAll('.plf[data-anim]').forEach(fn);
  };
  new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.removedNodes) if (n.nodeType === 1) each(n, (el) => { if (seen.has(el) && !el.isConnected) (seen.delete(el), io.unobserve(el)); });
      for (const n of m.addedNodes) if (n.nodeType === 1) each(n, (el) => { if (!seen.has(el)) (seen.add(el), io.observe(el)); });
    }
  }).observe(document.body, { childList: true, subtree: true });
  each(document.body, (el) => (seen.add(el), io.observe(el)));
  rm?.addEventListener?.('change', () => { if (rm.matches) document.querySelectorAll('.plf.live').forEach((el) => el.classList.remove('live')); });
}
