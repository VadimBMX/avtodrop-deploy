// «Перша година» (audit3 §3 №2, №3, №5): small pure rules the app uses, kept here so tests can check them.
//   · topStripPick — at most one strip on top of «Гараж»/«Меню», by priority; the rest wait (badges on the gift / «Меню»);
//   · raceCarChoice — the race car: the player's own pick lives for the session while the garage stays the same,
//     otherwise the best car that can go (a full tank first, then the fastest);
//   · bossWall — a boss the player almost surely can't beat now: show «що робити» instead of a bright «Кинути виклик»;
//   · bigSpend — a purchase big enough to ask «точно?» with the amount (≥ 10 млн or ≥ 20% of the balance);
//   · spendConfirm — that question as an own sheet (not tg.showConfirm: the amount has to be big and clear).
import * as S from './shared.js';

// Strips on top of the home screens, most important first: the steps pill, rewards, the event, the barn, the next level.
export const STRIP_ORDER = ['guide', 'rewards', 'event', 'barn', 'level'];
export function topStripPick(present) {
  const have = new Set(present);
  const keep = STRIP_ORDER.find((k) => have.has(k)) || null;
  return { keep, hide: STRIP_ORDER.filter((k) => k !== keep && have.has(k)) };
}

// The garage as the race picker sees it: which cars are there (a car bought, sold or won changes it).
export const garageSig = (garage) => garage.map((c) => c.id).sort((a, b) => a - b).join(',');
export const bestRaceCar = (garage) => [...garage].sort((a, b) => (b.tank > 0) - (a.tank > 0) || a.et - b.et || a.id - b.id)[0] || null;
// picked/pickedSig: chosen by hand in this session; saved: { id, sig } kept in the browser from an earlier one.
export function raceCarChoice(garage, { picked = null, pickedSig = null, saved = null } = {}) {
  const sig = garageSig(garage), has = (id) => garage.some((c) => c.id === id);
  if (picked != null && pickedSig === sig && has(picked)) return { id: picked, picked: true, sig };
  if (saved && saved.sig === sig && has(saved.id)) return { id: saved.id, picked: true, sig };
  return { id: bestRaceCar(garage)?.id ?? null, picked: false, sig };
}

// «СРСР · Радянська класика» only for a Soviet-era design (the 1990s ВАЗ-2107/2109 still are; ВАЗ-2114 2010 and
// Lada Priora 2012 are modern Ukrainian-market cars). app.js adds the brand check (SOVIET_RE).
export const sovietEra = (m) => (m?.year || 0) < 2000;

// Below this chance (%) a boss fight is a wall: the button turns quiet and asks first, the card says what helps.
export const BOSS_WALL_CHANCE = 10;
export const bossWall = (s) => !!s && !s.beaten && !!s.open && s.fits !== false && s.chance != null && s.chance < BOSS_WALL_CHANCE;

// «Точно?» for spends this big: from 10 млн, or a fifth of the balance (and never for pocket money).
export const BIG_SPEND = { abs: 10e6, share: 0.2, min: 100e3 };
export const bigSpend = (amount, balance) => amount >= BIG_SPEND.abs || (amount >= BIG_SPEND.min && amount >= BIG_SPEND.share * Math.max(0, balance || 0));

// The strips as the modules draw them (each module keeps drawing its own; this only decides which one is seen):
// the steps pill (#guide), the rewards/claim banners (#banners, above the view), «Ніч Хелловіну» (#hwBanner),
// the barn row (#brRow), the next-level chip (#nextUl). On «Гараж» and «Меню» only one shows; a hidden event or barn
// lights the dot on «Меню» (both live there), hidden rewards are on the gift badge. When the shown one goes (a
// banner's 9 s are over, a reward is taken), the next one comes in by itself.
const STRIP_SEL = { guide: '#view > #guide', event: '#view > #hwBanner', barn: '#view > #brRow', level: '#view > #nextUl' };
export function installTopStrip({ state }) {
  const view = document.getElementById('view');
  if (!view) return;
  let watched = null;
  const run = () => {
    const box = document.getElementById('banners');
    if (box && box !== watched) (watched = box), obs.observe(box, { childList: true });
    const st = state(), home = !st.page && !st.race && !st.drift && ['garage', 'menu'].includes(st.tab);
    const els = Object.fromEntries(Object.entries(STRIP_SEL).map(([k, sel]) => [k, document.querySelector(sel)]));
    const hasBanner = !!box?.querySelector('.banner:not(.out)');
    const present = [...Object.keys(els).filter((k) => els[k]), ...(hasBanner ? ['rewards'] : [])];
    const { keep, hide } = home ? topStripPick(present) : { keep: null, hide: [] };
    for (const [k, el] of Object.entries(els)) el?.classList.toggle('fh-off', hide.includes(k));
    box?.classList.toggle('fh-off', hide.includes('rewards') && !box.querySelector('.banner.invite:not(.out)')); // a PvP call never waits
    const dot = document.getElementById('menuDot');
    if (dot && home && st.tab === 'garage' && (hide.includes('event') || hide.includes('barn'))) dot.hidden = false;
    document.body.dataset.fhStrip = home ? keep || '' : '';
  };
  const obs = new MutationObserver(() => run());
  obs.observe(view, { childList: true });
  if (view.parentElement) obs.observe(view.parentElement, { childList: true }); // #banners is made lazily next to the header
  const top = document.querySelector('#app .top');
  if (top?.parentElement && top.parentElement !== view.parentElement) obs.observe(top.parentElement, { childList: true });
  run();
  return run;
}

const escH = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
// Resolves true on «Купити», false on «Скасувати» or a tap outside. Under the threshold it says yes at once.
export function spendConfirm({ title, amount, balance, note = 'Не повертається.', ok = 'Купити', force = false }) {
  if (!force && !bigSpend(amount, balance)) return Promise.resolve(true);
  return new Promise((res) => {
    const box = document.createElement('div');
    box.className = 'confirm fh-spend';
    const share = balance > 0 ? Math.round((amount / balance) * 100) : 0;
    box.innerHTML = `<div class="confirm-card" role="dialog" aria-modal="true"><div class="fh-sp-t">${escH(title)}</div>
      <b class="fh-sp-amt">${escH(S.fmt(amount))}</b>
      <div class="fh-sp-sub">${balance > 0 ? `${share >= 1 ? `${share}% твого балансу · ` : ''}лишиться ${escH(S.short(Math.max(0, balance - amount)))}` : ''}</div>
      <div class="fh-sp-note">${escH(note)}</div>
      <div class="btns"><button class="btn ghost" data-ok="0">Скасувати</button><button class="btn yellow" data-ok="1">${escH(ok)}</button></div></div>`;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ok]');
      if (!b && e.target !== box) return;
      e.stopPropagation();
      box.remove();
      res(b?.dataset.ok === '1');
    });
    document.body.append(box);
  });
}
