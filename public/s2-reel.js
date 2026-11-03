// «Прокрут» (Season 2, owner 03.11: «а то страшно відкривається і просто випадає»): the case drops, unlocks with a
// click and a seam of light opens, then a CS-style reel of car cards on an «Асфальт» strip runs right → left, slows
// down and stops on the car the SERVER already rolled — the strip is decoration only. ×3 / ×6: stacked rows that stop
// one after another. Used by s2-ui.js openAnim; app.js shows the normal result / reveal after it resolves.
//
// Honest strip (same rule as the S1 reel, commit d9f32d0): the winner is exactly r.results[i].car.model; every other
// card is a fresh draw by the case's odds (app.js weightedModel). Nothing rare is planted next to the winner: when the
// real neighbour happens to be rarer, the stop only leans a little towards it (a near-miss as often as the odds make one).
//
// The pure helpers (strip, stop position, card under the marker, motion curve) have no DOM and are tested in
// test/reel.test.js; playOpen() is the DOM part.
import * as S from './shared.js';

export const REEL = { N: 46, W: 38, NR: 12, WR: 7 }; // cards in a strip / the winner's index (NR/WR: reduced motion)

// The strip: index W is the winner, every other card comes from draw() (the case's odds).
export function buildStrip(winner, draw, { N = REEL.N, W = REEL.W } = {}) {
  return Array.from({ length: N }, (_, i) => (i === W ? winner : draw()));
}

// -1 / 1: lean the stop towards the rarer real neighbour (only when one of them outranks the winner), else 0.
export function leanOf(strip, W, rankOf = (id) => S.rankOf(S.MODELS[id]?.cls)) {
  const r = rankOf(strip[W]), prev = rankOf(strip[W - 1]), next = rankOf(strip[W + 1]);
  if (Math.max(prev, next) <= r) return 0;
  if (prev === next) return Math.random() < 0.5 ? -1 : 1;
  return prev > next ? -1 : 1;
}

// Where inside the winner card the marker ends, as a share of the card width from its centre (−0.5…0.5).
export function stopOffset(lean, rnd = Math.random) {
  const off = lean ? lean * (0.2 + rnd() * 0.14) : (rnd() - 0.5) * 0.56;
  return Math.max(-0.36, Math.min(0.36, off));
}

// Card i spans [i·step, i·step + cardW] inside the strip; the marker is the middle of the view.
// The strip's translateX is −x; this x puts the marker `off` card widths from the centre of card W.
export const stopX = ({ W, step, cardW, viewW, off = 0 }) => W * step + cardW / 2 + off * cardW - viewW / 2;
// The card under the marker for a strip position x (−1 when the marker is in a gap).
export function indexAt(x, { step, cardW, viewW }) {
  const c = x + viewW / 2, i = Math.floor(c / step);
  return c - i * step <= cardW ? i : -1;
}
// Settle overshoot past the stop, kept inside the winner card (the marker never visits a neighbour and comes back).
export const overshoot = (off, cardW, rnd = Math.random) => Math.max(0, Math.min(cardW * (0.06 + rnd() * 0.06), cardW * (0.46 - off)));

// Position over time: a short ramp-up, a long ease-out (velocity ∝ (1−u)^2.6) to target+over, then a settle back.
export function motion({ target, over = 0, spinMs, settleMs = 0, reduce = false }) {
  if (reduce) {
    const ms = spinMs;
    return { total: ms, at: (t) => (t >= ms ? target : target * (1 - Math.pow(1 - t / ms, 3))) };
  }
  const NE = 300, A = 0.035, prof = [0];
  for (let i = 1; i <= NE; i++) {
    const u = (i - 0.5) / NE;
    prof.push(prof[i - 1] + Math.min(1, u / A) * Math.pow(1 - u, 2.6));
  }
  const ease = (u) => {
    const f = Math.min(NE, Math.max(0, u * NE)), i = Math.floor(f);
    return (i >= NE ? prof[NE] : prof[i] + (prof[i + 1] - prof[i]) * (f - i)) / prof[NE];
  };
  const smooth = (u) => u * u * (3 - 2 * u), to = target + over;
  return {
    total: spinMs + settleMs,
    at: (t) => (t < spinMs ? to * ease(t / spinMs) : t < spinMs + settleMs ? target + over * (1 - smooth((t - spinMs) / settleMs)) : target),
  };
}

// One row per result: its strip, the winner's index and where it stops. The visible winner is always the server's car.
export function planReels(results, draw, { reduce = false, rnd = Math.random } = {}) {
  const N = reduce ? REEL.NR : REEL.N, W = reduce ? REEL.WR : REEL.W;
  return results.map((r) => {
    const winner = r.car.model, strip = buildStrip(winner, draw, { N, W });
    const off = stopOffset(leanOf(strip, W), rnd);
    return { winner, strip, W, off };
  });
}

// ---------- DOM ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clsOf = (id) => S.MODELS[id]?.cls || 'D';
const colOf = (id) => S.CLASSES[clsOf(id)]?.color || '#9aa4b2';
// The reel's own tick sound stays off unless switched on (localStorage 'avtodrop-reel-sound' = '1'); haptics carry it.
const reelSound = () => {
  try {
    return localStorage.getItem('avtodrop-reel-sound') === '1';
  } catch {
    return false;
  }
};

// env: { cs, r, caseArt(open?), carArt(id, opts), haptic(kind), SFX, draw(), fastPill, onFast() }
// Resolves when the reel(s) stopped and the winner glowed, or at once when «Швидко» is tapped.
export function playOpen(env) {
  const { cs, r } = env;
  const n = r.results.length;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const plans = planReels(r.results, env.draw, { reduce });
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = `s2-rov n${n > 1 ? (n > 3 ? 6 : 3) : 1}${reduce ? ' rm' : ''}`;
    // Card size: ×1 a big row; ×3 / ×6 as many rows as fit between the title and the pill (no scroll at 360×640).
    const vw = Math.min(innerWidth, 560), avail = innerHeight - 186;
    const gap = n > 3 ? 8 : 12;
    const rowH = n === 1 ? Math.min(178, avail) : Math.min(n > 3 ? 112 : 150, (avail - gap * (n - 1)) / n);
    const cardH = Math.round(rowH - (n === 1 ? 30 : 14));
    const cardW = Math.round(Math.min(vw * (n === 1 ? 0.36 : 0.3), cardH * (n === 1 ? 1.12 : 1.3)));
    ov.style.cssText = `--cw:${cardW}px;--ch:${cardH}px;--rh:${Math.round(rowH)}px;--rg:${gap}px`;
    const card = (id, i, W) => `<div class="rv-card${i === W ? ' rv-w' : ''}" data-m="${esc(id)}" style="--c:${colOf(id)}"><div class="rv-ph">${env.carArt(id, { thumb: true }).replace('loading="lazy"', 'loading="eager" decoding="async"')}</div>
      <div class="rv-bar"><b>${clsOf(id)}</b>${n === 1 ? `<span>${esc(S.CLASSES[clsOf(id)]?.name || '')}</span>` : ''}</div></div>`;
    ov.innerHTML = `<div class="rv-sky"></div>
      <div class="rv-intro"><div class="rv-case">${env.caseArt(false)}<i class="rv-seam"></i></div></div>
      <div class="rv-top">${esc(cs.name)}${n > 1 ? ` · ×${n}` : ''}</div>
      <div class="rv-reels">${n === 1 ? '<div class="rv-lamp" aria-hidden="true"><i></i></div>' : ''}${plans.map((p) => `<div class="rv-reel"><div class="rv-strip">${p.strip.map((id, i) => card(id, i, p.W)).join('')}</div><i class="rv-mark"></i></div>`).join('')}</div>
      <div class="s2-ov-skip">${env.fastPill}</div>`;
    document.body.appendChild(ov);

    const timers = [], anims = [];
    let done = false, raf = 0;
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const finish = (fast = false) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
      anims.forEach((a) => a.cancel?.());
      ov.classList.add('out');
      setTimeout(() => ov.remove(), fast ? 200 : 320);
      resolve();
    };
    // «Швидко»: the quick open goes on (stored) and the rest of the animation is skipped (as before the reel).
    ov.querySelector('.s2-fast')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.currentTarget.classList.add('on');
      e.currentTarget.setAttribute('aria-pressed', 'true');
      env.onFast?.();
      env.haptic('light');
      finish(true);
    });
    requestAnimationFrame(() => ov.classList.add('go'));

    // 1. Intro ≤ 1.1 s: the case drops in (0.38 s), the latch clicks (0.55 s), a calm seam of light opens; the reel
    //    fades in under it. Reduced motion: no intro.
    const T = reduce ? { click: 0, seam: 0, reel: 60 } : { click: 520, seam: 640, reel: 1020 };
    if (!reduce) {
      later(360, () => env.haptic('light'));
      later(T.click, () => (ov.classList.add('click'), env.haptic('medium'), env.SFX?.press?.()));
      later(T.seam, () => ov.classList.add('seam'));
    }
    later(T.reel, () => {
      if (done) return;
      ov.classList.add('reel');
      spin();
    });

    function spin() {
      const rows = [...ov.querySelectorAll('.rv-reel')];
      const st0 = rows[0].querySelector('.rv-strip');
      const step = st0.children[1].offsetLeft - st0.children[0].offsetLeft, cw = st0.children[0].offsetWidth; // one layout read
      const viewW = rows[0].clientWidth;
      const geo = { step, cardW: cw, viewW };
      const base = reduce ? 600 : n === 1 ? 4700 : 4300, gapMs = reduce ? 120 : 300;
      const lanes = plans.map((p, i) => {
        const target = stopX({ W: p.W, step, cardW: cw, viewW, off: p.off });
        const m = motion({ target, over: reduce ? 0 : overshoot(p.off, cw), spinMs: base + i * gapMs, settleMs: reduce ? 0 : 360, reduce });
        const strip = rows[i].querySelector('.rv-strip');
        // The curve is baked into keyframes (~every 16 ms): the compositor plays it even when the main thread is busy;
        // one transform per strip per frame, nothing else moves.
        const K = Math.max(2, Math.round(m.total / 16));
        const a = strip.animate(Array.from({ length: K + 1 }, (_, k) => ({ transform: `translate3d(${(-m.at((m.total * k) / K)).toFixed(1)}px,0,0)`, offset: k / K })),
          { duration: m.total, easing: 'linear', fill: 'forwards' });
        anims.push(a);
        return { p, m, a, row: rows[i], strip, last: -2, stopped: false, target };
      });
      let lastTick = 0;
      const sound = reelSound();
      const stopLane = (L, i) => {
        L.stopped = true;
        L.strip.style.transform = `translate3d(${-L.target}px,0,0)`;
        const rank = S.rankOf(clsOf(L.p.winner));
        L.row.style.setProperty('--c', colOf(L.p.winner));
        L.row.classList.add('stop', `r${rank}`);
        const lastRow = i === lanes.length - 1;
        env.haptic(rank >= 3 ? 'heavy' : rank >= 2 || lastRow ? 'medium' : 'light');
        if (lastRow || rank >= 2) env.SFX?.pop?.(rank);
        if (lastRow) later(reduce ? 250 : 450, () => finish());
      };
      const frame = () => {
        if (done) return;
        const now = performance.now();
        lanes.forEach((L, i) => {
          if (L.stopped) return;
          const t = Number(L.a.currentTime) || 0;
          const idx = indexAt(L.m.at(Math.min(t, L.m.total)), geo);
          if (idx !== L.last && idx >= 0) {
            // A light tap per card through the marker (all rows share one limiter: ≤ 1 per 55 ms, sparser while fast).
            if (L.last >= 0 && now - lastTick > (t < L.m.total * 0.45 ? 85 : 55)) {
              lastTick = now;
              env.haptic('light');
              if (sound) env.SFX?.tick?.(t < L.m.total * 0.5 ? 1 : 0.85);
            }
            L.last = idx;
          }
          if (t >= L.m.total) stopLane(L, i);
        });
        if (lanes.some((L) => !L.stopped)) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      // rAF pauses in a background tab while the animations still run: stop from timers then.
      lanes.forEach((L, i) => L.a.finished.then(() => later(150, () => !done && !L.stopped && stopLane(L, i))).catch(() => {}));
    }
  });
}
