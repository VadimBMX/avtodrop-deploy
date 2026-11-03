// s2-intro: the first-launch motion intro («Асфальт»). Seven scenes from S.INTRO_REEL — night city, a case drops and
// opens, a car rolls onto the turntable, the garage floors light up and earn, the drag start, the city map, the CTA.
// Everything is the game's own art (public/s2, public/cars) moved with CSS transforms and opacity (style.css block
// «Night intro»); JS here only builds the scenes, runs the clock and counts numbers up. No video, no libraries.
//   · tap = next scene (the left quarter = back), hold = pause, «Пропустити» = out at any moment;
//   · prefers-reduced-motion: every scene stands in its final frame and waits for «Далі» (no clock, nothing moves);
//   · playReel resolves through onDone('cta' | 'skip'); the caller decides where the player lands.
import * as S from './shared.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const grp = (n) => Math.round(n).toLocaleString('uk-UA').replace(/\s/g, ' ');
export const reelReduced = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// The art every scene needs, warmed up as soon as the intro starts (all of it is already on the server for the game).
export const REEL_ART = ['s2/bg/splash.webp', 's2/case/c-rust.webp', 's2/case/o-rust.webp', 's2/bg/stage-reveal.webp', 's2/bg/garage-full.webp',
  's2/bg/race-lobby.webp', 's2/city.webp', 's2/x-gift.webp'];
// Map pins for the city scene: the businesses (S.BIZ through S.INTRO_REEL's list) and two places, on city.webp's own
// 1750×775 grid (the same points the «Місто» tab uses).
const PINS = [
  { k: 'track', x: 1030, y: 178, t: 'Траса', c: '#ff8a1f' },
  { k: 'sto', x: 712, y: 150, t: 'СТО', c: '#ff8a1f' },
  { k: 'garage', x: 875, y: 222, t: 'Мій гараж', c: '#ffd400' },
  { k: 'wash', x: 716, y: 322, t: 'Мийка', c: '#22e3ff' },
  { k: 'gas', x: 1040, y: 316, t: 'Заправка', c: '#ffd400' },
  { k: 'salon', x: 1322, y: 360, t: 'Автосалон', c: '#5ee7f0' },
  { k: 'club', x: 1032, y: 470, t: 'Автоклуб', c: '#c084fc' },
];
const income = (id) => (S.MODELS[id] ? S.MODELS[id].price * S.incomeRateOf(id) : 0);

function sceneArt(key, { carArt }) {
  const R = S.INTRO_REEL.cars;
  switch (key) {
    case 'night':
      return `<img class="rl-bg rl-kb" src="s2/bg/splash.webp" alt="">
        <i class="rl-dark"></i><i class="rl-lamp l1"></i><i class="rl-lamp l2"></i><i class="rl-lamp l3"></i>
        <div class="rl-mark"><span class="rl-mark-w">АВТО<b>ДРОП</b></span><i class="rl-road"></i></div>`;
    case 'case': {
      const sparks = Array.from({ length: 14 }, (_, i) => `<i style="--a:${(i * 360) / 14 + (i % 2) * 9}deg;--d:${70 + (i % 4) * 22}px;--t:${(i % 3) * 60}ms"></i>`).join('');
      return `<i class="rl-floor"></i><i class="rl-cone"></i>
        <div class="rl-shake"><i class="rl-shadow"></i><i class="rl-rays"></i><i class="rl-flash"></i>
          <img class="rl-cimg c" src="s2/case/c-rust.webp" alt=""><img class="rl-cimg o" src="s2/case/o-rust.webp" alt="">
          <div class="rl-sparks">${sparks}</div><i class="rl-dust"></i></div>`;
    }
    case 'car': {
      const m = S.MODELS[R.hero], cls = S.CLASSES[m?.cls] || S.CLASSES.D;
      const ladder = S.CLASS_ORDER.filter((k) => k !== 'X' && S.CLASSES[k] && !S.CLASSES[k].secret).slice(0, 5);
      return `<div class="rl-box"><img class="rl-stage" src="s2/bg/stage-reveal.webp" alt=""><i class="rl-glow"></i>
        <div class="rl-car"><i class="rl-streaks"></i>${carArt(R.hero)}</div><i class="rl-sweep"></i></div>
        <div class="rl-tag"><span class="rl-cls" style="--c:${cls.color}">${esc(m?.cls || 'D')}</span><span class="rl-tag-t"><small>${esc(cls.name)}</small><b>${esc(m?.name || '')}</b></span>
          <b class="rl-price"><span data-to="${m?.price || 0}">${grp(m?.price || 0)}</span> ₴</b></div>
        <div class="rl-ladder">${ladder.map((k, i) => `<span style="--c:${S.CLASSES[k].color};--i:${i}" class="${k === m?.cls ? 'on' : ''}">${k}</span>`).join('<i>›</i>')}</div>`;
    }
    case 'garage': {
      const cars = R.garage.filter((id) => S.MODELS[id]);
      const total = cars.reduce((a, id) => a + income(id), 0);
      return `<div class="rl-gar"><img class="rl-gar-img" src="s2/bg/garage-full.webp" alt="">
          ${cars.map((id, i) => `<div class="rl-fl f${i}" style="--i:${i}"><i class="rl-fl-dark"></i><div class="rl-fl-car">${carArt(id)}</div><span class="rl-plus">+${grp(income(id))} ₴</span></div>`).join('')}
        </div>
        <div class="rl-cash"><small>Дохід гаража</small><b><span data-to="${Math.round(total)}">${grp(total)}</span> ₴<em>/год</em></b></div>`;
    }
    case 'race':
      return `<img class="rl-bg rl-lobby" src="s2/bg/race-lobby.webp" alt=""><i class="rl-dim"></i>
        <div class="rl-tree"><i class="a1"></i><i class="a1"></i><i class="a2"></i><i class="a2"></i><i class="a3"></i><i class="a3"></i><i class="g"></i><i class="g"></i></div>
        <div class="rl-lane"><i class="rl-speed"></i><div class="rl-racer">${carArt(R.race)}</div></div>
        <div class="rl-time"><small>реакція</small><b>0,214 с</b></div>`;
    case 'city':
      return `<div class="rl-map"><img src="s2/city.webp" alt="">${PINS.map((p, i) => `<span class="rl-pin" style="--x:${(p.x / 1750) * 100}%;--y:${(p.y / 775) * 100}%;--c:${p.c};--i:${i}"><i></i>${esc(p.t)}</span>`).join('')}</div><i class="rl-vign"></i>`;
    case 'go':
      return `<i class="rl-floor"></i><i class="rl-cone wide"></i><i class="rl-rays slow"></i>
        <div class="rl-gift"><img src="s2/x-gift.webp" alt=""><span class="rl-free">Безкоштовно</span></div>`;
  }
  return '';
}

// Counts every [data-to] in root up from 0 (ease-out, ~0.9 s), digits grouped. The final number is already in the
// DOM, so a skipped scene leaves the right value behind.
function countIn(root, delay, ms = 900) {
  if (reelReduced()) return;
  for (const n of root.querySelectorAll('[data-to]')) {
    const to = Number(n.dataset.to);
    if (!Number.isFinite(to) || !to) continue;
    n.textContent = '0';
    const t0 = performance.now() + delay;
    const step = (t) => {
      if (!n.isConnected) return;
      const k = Math.max(0, Math.min(1, (t - t0) / ms));
      n.textContent = grp(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
const COUNT_AT = { car: 1500, garage: 1300 };

export function playReel({ carArt, haptic = () => {}, again = false, onDone = () => {} } = {}) {
  const scenes = S.INTRO_REEL.scenes;
  const rm = reelReduced();
  REEL_ART.forEach((src) => (new Image().src = src));
  const el = document.createElement('div');
  el.className = `reel${rm ? ' rm' : ''}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Інтро АВТОДРОП');
  const timed = scenes.filter((s) => s.ms > 0);
  el.innerHTML = `<div class="rl-scenes">${scenes.map((s, i) => `<section class="rl-sc rl-s-${s.key}" data-i="${i}" aria-hidden="true">${sceneArt(s.key, { carArt })}</section>`).join('')}</div>
    <i class="rl-grad"></i>
    <div class="rl-top"><div class="rl-bars">${timed.map((s, i) => `<i style="--ms:${s.ms}ms"><b data-b="${i}"></b></i>`).join('')}</div>
      <button class="rl-skip" type="button">Пропустити</button></div>
    <div class="rl-cap" aria-live="polite"></div>
    <div class="rl-cta"><button class="rl-go" type="button">${esc(again ? S.INTRO_REEL.ctaAgain : S.INTRO_REEL.cta)}</button>${rm ? '<button class="rl-next" type="button">Далі</button>' : ''}</div>`;
  let i = -1, timer = null, left = 0, startedAt = 0, held = false, done = false;
  const cap = el.querySelector('.rl-cap');
  const show = (n) => {
    if (n < 0) n = 0;
    if (n >= scenes.length) n = scenes.length - 1;
    i = n;
    const s = scenes[i];
    el.dataset.scene = s.key;
    el.querySelectorAll('.rl-sc').forEach((sc, k) => {
      const on = k === i;
      if (on) {
        sc.classList.remove('on');
        void sc.offsetWidth; // restart the scene's animations when it comes back
      }
      sc.classList.toggle('on', on);
      sc.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    el.querySelectorAll('.rl-bars b').forEach((b, k) => {
      b.className = k < i ? 'done' : k === i ? 'run' : '';
      if (k === i) void b.offsetWidth;
    });
    cap.innerHTML = `<small class="rl-k"><span>${esc(s.kicker)}</span></small><h2 class="rl-t"><span>${esc(s.title)}</span></h2><p class="rl-p"><span>${esc(s.text)}</span></p>`;
    el.classList.toggle('last', !s.ms);
    countIn(el.querySelector(`.rl-sc[data-i="${i}"]`), COUNT_AT[s.key] || 0);
    if (i) haptic('light');
    clearTimeout(timer);
    if (!rm && s.ms) arm(s.ms);
  };
  const arm = (ms) => {
    left = ms;
    startedAt = performance.now();
    timer = setTimeout(() => show(i + 1), ms);
  };
  const close = (how) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), rm ? 0 : 320);
    onDone(how);
  };
  // hold = pause (the clock and every animation stop), release = go on from where it was
  const hold = (on) => {
    if (rm || held === on || !scenes[i]?.ms) return;
    held = on;
    el.classList.toggle('hold', on);
    if (on) {
      clearTimeout(timer);
      left -= performance.now() - startedAt;
    } else arm(Math.max(200, left));
  };
  let downAt = 0, holdT = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    downAt = performance.now();
    holdT = setTimeout(() => hold(true), 260);
  });
  const up = () => {
    clearTimeout(holdT);
    if (held) hold(false);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('click', (e) => {
    if (e.target.closest('.rl-skip')) return close('skip');
    if (e.target.closest('.rl-go')) return close('cta');
    if (e.target.closest('.rl-next')) return show(i + 1);
    if (performance.now() - downAt > 260) return; // that was a hold
    if (!scenes[i].ms && !e.target.closest('.rl-go')) return; // the last scene waits for its button
    show(e.clientX < window.innerWidth / 4 ? i - 1 : i + 1);
  });
  const onKey = (e) => {
    if (!el.isConnected) return document.removeEventListener('keydown', onKey);
    if (e.key === 'Escape') close('skip');
    else if (e.key === 'ArrowRight' || e.key === ' ') show(i + 1);
    else if (e.key === 'ArrowLeft') show(i - 1);
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
  show(0);
  return { close, show: (n) => show(n), el };
}
