// d1-intro (owner 5.11: «the intro at the start shows for literally a millisecond»). The «Асфальт» splash in
// index.html used to live inside #view, so the first render() wiped it the moment /api/me answered. Now it sits on
// <body> (index.html; moving the node would restart its CSS entrance) and leaves on its own clock:
//   · the first launch of the day: it stays at least SPLASH_DAY_MS from page start (the logo / tape / light-sweep
//     entrance in style.css «d1 splash» plays out, the bar fills);
//   · any later launch that day: at least SPLASH_AGAIN_MS, so it never just flashes;
//   · it never holds anything up: the game renders underneath straight away, a tap on the splash once the data is in
//     lets it go at once, and a hard cap (SPLASH_MAX_MS after the data) means it can't hang.
// whenSplashGone(fn) runs fn after it has faded (or at once): the newcomer intro starts over a clean screen.
export const SPLASH_DAY_MS = 2200;
export const SPLASH_AGAIN_MS = 750;
const FADE_MS = 420;
const DAY_KEY = 'avtodrop-splash-day';

let el = null, ready = false, gone = false, minAt = 0, holds = 0;
const waiting = [];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const reduced = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// Called first thing at boot: finds the splash and sets its clock.
export function liftSplash(doc = document) {
  el = doc.querySelector('body > .s2-splash');
  if (!el) return finish();
  let first = true;
  try {
    first = localStorage.getItem(DAY_KEY) !== today();
    localStorage.setItem(DAY_KEY, today());
  } catch {}
  const hold = reduced() ? Math.min(SPLASH_AGAIN_MS, 600) : first ? SPLASH_DAY_MS : SPLASH_AGAIN_MS;
  minAt = hold; // performance.now() counts from the page's start, like the CSS entrance
  el.classList.add('lifted', first ? 'sp-day' : 'sp-again');
  // the bar fills over the hold that is left (it already started with the page)
  const bar = el.querySelector('.s2-sp-bar b');
  if (bar) bar.style.animationDuration = `${Math.max(400, hold - performance.now())}ms`;
  el.addEventListener('click', () => ready && finish());
}

// The data is in and the first screen is drawn: the splash goes when its minimum time is up.
export function splashReady() {
  if (ready) return;
  ready = true;
  if (!el) return finish();
  el.classList.add('ready');
  setTimeout(finish, Math.max(0, minAt - performance.now())); // a hold, if any, finishes it on release
}

// Something that must be on screen before the splash leaves (the newcomer intro, loaded on demand) holds it; the
// returned function lets go. Never longer than 3 s.
export function holdSplash() {
  if (gone) return () => {};
  holds++;
  let on = true;
  const release = () => {
    if (!on) return;
    on = false;
    holds--;
    if (ready && !holds && performance.now() >= minAt) finish();
  };
  setTimeout(release, 3000);
  return release;
}

function finish() {
  if (gone || holds) return;
  gone = true;
  const done = () => {
    el?.remove();
    waiting.splice(0).forEach((fn) => {
      try {
        fn();
      } catch {}
    });
  };
  if (!el) return done();
  el.classList.add('out');
  setTimeout(done, reduced() ? 0 : FADE_MS);
}

export function whenSplashGone(fn) {
  if (gone && !el?.isConnected) return fn();
  waiting.push(fn);
}
export const splashUp = () => !!el?.isConnected;
