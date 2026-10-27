// Intro motion helpers (wIntro 2026-10-29): the story slides (newcomer intro, «Що нового»), the level-up sheet, the
// Halloween sheet and the season showroom use them. Everything visual is CSS (style.css «wIntro» block, transform and
// opacity only); here only what CSS can't do: counting a number up (requestAnimationFrame, ~0.6 s) and the swipe
// between slides. Under prefers-reduced-motion nothing moves: numbers are shown final, swipes still work.
export const reducedMotion = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// The number in node counts from data-from (0 by default) to data-to; the final value is already in the DOM, so an
// interrupted count or a removed node leaves the right number behind.
export function countUp(node, ms = 620) {
  const to = Number(node?.dataset.to), from = Number(node?.dataset.from) || 0;
  if (!Number.isFinite(to) || to === from || reducedMotion()) return;
  const t0 = performance.now();
  node.textContent = String(from);
  const step = (t) => {
    if (!node.isConnected) return;
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    node.textContent = String(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
export const countUpIn = (root, ms, delay = 0) => root && setTimeout(() => root.querySelectorAll('[data-to]').forEach((n) => countUp(n, ms)), delay);

// The first stand-alone 2–4-digit number of an (already escaped) text gets a span to count up: «177 справжніх авто»,
// «Драг 402 м», «До 20 гравців». Dates and times («20:00», «2.11») and «10-го» are left alone.
export const markNumber = (html) => html.replace(/(^|[\s(])(\d{2,4})(?=[\s)])/, (_, a, n) => `${a}<span class="st-num" data-to="${n}">${n}</span>`);

// Horizontal swipe on el: left → next(), right → prev(). While the finger moves, follow(dx) can drag the slide a
// little. Returns a function that says whether the click that ends this gesture should be ignored (it was a swipe).
export function swipeNav(el, { next, prev, follow = () => {} }) {
  let x0 = null, y0 = 0, id = null, swipedAt = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    x0 = e.clientX;
    y0 = e.clientY;
    id = e.pointerId;
  });
  el.addEventListener('pointermove', (e) => {
    if (x0 === null || e.pointerId !== id) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - y0)) follow(dx);
  });
  const end = (e) => {
    if (x0 === null || e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    follow(0);
    if (e.type === 'pointerup' && Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      swipedAt = performance.now();
      if (dx < 0) next();
      else prev();
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return () => performance.now() - swipedAt < 400;
}
