// Boss intro (D-race): a fight-poster card between «Кинути виклик» and the start lights — the boss's car slides in
// from the right facing you, yours from the left, «VS» lands on the seam, then the boss's name, driver stars and taunt.
// 2.2 s, a tap anywhere skips it; with reduced motion it is a still card for 1 s. Pure DOM: the caller passes ready
// (escaped) HTML, so this module knows nothing about the game. It only delays the start: runRace() is called after
// the promise resolves, so the server's race clock (greenMs, "finished too soon") is untouched.
// wIntro polish: speed streaks behind both cars, the class floor lights flicker on as each car stops, a shock ring
// under «VS», one light sweep over the boss (CSS «wIntro»).
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {{ place: string, meArt: string, meCar: string, meColor: string, bossArt: string, bossCar: string,
 *   bossColor: string, nick: string, driver: string, taunt: string }} o  HTML strings, already escaped
 * @returns {Promise<void>} resolves when the card is gone (timeout or tap)
 */
export function bossIntro(o) {
  return new Promise((done) => {
    const rm = reduced();
    const ms = rm ? 1000 : 2200;
    const el = document.createElement('div');
    el.className = `boss-in${rm ? ' rm' : ''}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Бос виходить на старт');
    el.tabIndex = -1;
    el.style.setProperty('--me', o.meColor);
    el.style.setProperty('--bc', o.bossColor);
    el.style.setProperty('--ms', `${ms}ms`);
    el.innerHTML = `<div class="boss-in-place">${o.place}</div>
      <div class="boss-in-stage">
        <i class="boss-in-seam"></i>
        <div class="boss-in-car bs"><i class="boss-in-streak" aria-hidden="true"></i><span class="boss-in-art">${o.bossArt}</span><span class="boss-in-who">${o.bossCar}</span></div>
        <i class="boss-in-ring" aria-hidden="true"></i><b class="boss-in-vs" aria-hidden="true">VS</b>
        <div class="boss-in-car me"><i class="boss-in-streak" aria-hidden="true"></i><span class="boss-in-art">${o.meArt}</span><span class="boss-in-who"><b>Ти</b> · ${o.meCar}</span></div>
      </div>
      <div class="boss-in-name"><b>${o.nick}</b><div class="boss-in-drv">${o.driver}</div><q class="boss-in-taunt">${o.taunt}</q></div>
      <div class="boss-in-skip">Торкнись, щоб пропустити</div>
      <i class="boss-in-time"></i>`;
    let over = false;
    const close = () => {
      if (over) return;
      over = true;
      clearTimeout(t);
      el.classList.add('out');
      setTimeout(() => (el.remove(), done()), rm ? 0 : 180);
    };
    const t = setTimeout(close, ms);
    el.addEventListener('pointerdown', close, { once: true });
    el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') && close());
    document.body.appendChild(el);
    el.focus({ preventScroll: true });
  });
}
