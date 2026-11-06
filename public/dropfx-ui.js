// «Ефект дропу» in the app (r5-shop, owner 06.11): where the effect plays and where it is bought / switched.
//   · the drop result (AFTER.cases): the worn effect when the car lands — ×1 on the stage, ×3 / ×6 on every tile
//     (lighter), fast mode («Швидко») a short version; after a rare drop's full-screen show it plays once that closes;
//   · the store's «Стиль» tab: the «Ефект дропу» section (styleSection, called from app.js styleView) — a looping
//     preview on a sample car per effect, buy / switch on / off; a promo card on the «Магазин» tab;
//   · «Мій вигляд» (s2-ui.js lookSheet): a section added under the frames, by wrapping its two handlers (no edit there).
// Engine: public/dropfx.js. Server: the «Стиль» shop path, slot `dropfx` (me.dropfx).
import * as S from './shared.js';
import * as DFX from './dropfx.js';

let X = null;
const me = () => X.me();
const st = () => X.state();
const owned = (it) => (me()?.claims || []).includes(it.cos);
// The car shown in previews: the player's dearest car, else the season's Porsche «Aurora».
const AURORA = Object.keys(S.MODELS).find((id) => /Aurora/.test(S.MODELS[id].name)) || Object.keys(S.MODELS)[0];
function sampleModel() {
  const c = (me()?.cars || []).filter((x) => x.status !== 'auction').sort((a, b) => b.value - a.value)[0];
  return c?.model || AURORA;
}
const stage = (look, cls = '') => `<div class="dfx-pv ${cls}" data-fx="${look}"><div class="a-car"><div class="art">${X.carArt(sampleModel())}</div></div></div>`;

// ---------- looping previews (only while on screen) ----------
const players = new WeakMap();
let io = null;
function watchPreviews(root = document) {
  io ||= new IntersectionObserver((ents) => {
    for (const e of ents) {
      const el = e.target, p = players.get(el);
      if (e.isIntersecting && !p) players.set(el, DFX.play(el, el.dataset.fx, { tier: 'preview', loop: true, drop: true, period: 2900 }));
      else if (!e.isIntersecting && p) (p.stop(), players.delete(el));
    }
  }, { threshold: 0.25 });
  root.querySelectorAll('.dfx-pv[data-fx]:not(.off)').forEach((el) => io.observe(el));
}

// ---------- the store ----------
// The section in «Стиль» (app.js styleView): 2 × 2 cards, each a live preview, the name, a hint and its button.
export function styleSection(sh, buyBtns) {
  const worn = me()?.dropfx || null;
  const card = (it) => {
    const own = owned(it), on = worn === it.cos;
    const btn = !own ? buyBtns({ id: it.id, price: it.stars }, sh, 'yellow')
      : on ? `<button class="btn sm ghost on" data-act="dfxEquip" data-id="">${X.ic('check')} Увімкнено</button>`
      : `<button class="btn sm" data-act="dfxEquip" data-id="${it.cos}">Увімкнути</button>`;
    return `<div class="dfx-card fx-${it.look}${own ? ' own' : ''}${on ? ' on' : ''}">${stage(it.look)}<div class="dfx-tx"><b>${X.esc(it.short)}</b><small>${own ? `${X.ic('check')} твоє${on ? ' · грає' : ''}` : X.esc(it.hint)}</small></div>${btn}</div>`;
  };
  return `<div class="h2 dfx-h" id="dfxSec"><span>${X.ic(S.DROPFX.icon)} ${S.DROPFX.title}</span><span>${X.ic('star')} ${S.DROPFX.stars}</span></div>
    <div class="tiny muted sty-where">${X.esc(S.DROPFX.where)}. Бачиш лише ти. Один увімкнений за раз, куплені — назавжди.</div>
    <div class="dfx-grid">${S.DROPFX_ITEMS.map(card).join('')}</div>`;
}
// The «Магазин» tab: one promo card under the «Стиль» entry, with the worn (or the first) effect playing.
function storeAfter() {
  if (st().storeView === 'style') return watchPreviews();
  const anchor = document.querySelector('.st-style-promo');
  if (!anchor || document.querySelector('.dfx-promo')) return;
  const look = S.dropFxLook(me()?.dropfx) || 'gold';
  const n = S.DROPFX_ITEMS.filter(owned).length;
  anchor.insertAdjacentHTML('afterend', `<button class="card dfx-promo" data-act="dfxGo">${stage(look, 'sm')}<div class="dfx-promo-tx"><span class="dfx-new">нове</span><b>${S.DROPFX.title}</b>
    <small>${n ? `твоїх: ${n} з ${S.DROPFX_ITEMS.length}` : 'золотий дощ, блискавка, вогонь, хром — коли машина стає на стіл'}</small><span class="dfx-promo-p">${X.ic('star')} ${S.DROPFX.stars}<i>${X.ic('chevron-right')}</i></span></div></button>`);
  watchPreviews();
}

// ---------- «Мій вигляд» ----------
function lookSection() {
  const worn = me()?.dropfx || null, look = S.dropFxLook(worn);
  const chip = (it) => {
    const own = owned(it), on = worn === it.cos;
    return `<button class="dfx-chip fx-${it.look}${on ? ' on' : ''}${own ? '' : ' lock'}" data-act="${own ? 'dfxPick' : 'dfxGo'}" data-id="${on ? '' : it.cos}"><i class="dfx-dot"></i><span>${X.esc(it.short)}</span>${own ? (on ? X.ic('check') : '') : `<em>${X.ic('lock')}</em>`}</button>`;
  };
  return `<div class="dfx-look" id="dfxLook"><div class="s2-h"><b>${S.DROPFX.title}</b><span>${look ? 'грає на твоїх дропах' : S.DROPFX_ITEMS.some(owned) ? 'вимкнено' : `${X.ic('star')} ${S.DROPFX.stars} кожен`}</span></div>
    ${stage(look || 'gold', 'sm' + (look ? '' : ' off'))}<div class="dfx-chips">${S.DROPFX_ITEMS.map(chip).join('')}</div></div>`;
}
function addLookSection() {
  const sh = document.getElementById('sheet');
  if (!sh || sh.querySelector('.sheet-head h3')?.textContent !== 'Мій вигляд') return;
  sh.querySelector('#dfxLook')?.remove();
  sh.insertAdjacentHTML('beforeend', lookSection());
  watchPreviews(sh);
}

// ---------- the drop result ----------
function playOnDrop(d, late) {
  const look = S.dropFxLook(me()?.dropfx);
  if (!look || st().tab !== 'cases') return;
  const fast = !!st().fast;
  if (d.length === 1) {
    const host = document.querySelector('.s2-res .a-stage');
    if (host) DFX.play(host, look, { tier: fast ? 'short' : 'full', delay: late ? 120 : 400 });
    return;
  }
  document.querySelectorAll('.a-multi .a-gt-st').forEach((host, i) => DFX.play(host, look, { tier: fast ? 'tshort' : 'tile', delay: (late ? 80 : 400) + i * (fast ? 60 : 110) }));
}

export function installDropFx(x) {
  X = x;
  const casesBase = X.AFTER.cases;
  X.AFTER.cases = (...a) => {
    const s = st(), d = s.drop;
    const fresh = s.fx?.type === 'case' && d && !d.dfxDone;
    const r = casesBase?.(...a);
    if (!fresh) return r;
    if (st().fx?.type === 'case') { // a rare drop's full-screen show is up: AFTER.cases runs again when it closes
      d.dfxWait = true;
      return r;
    }
    d.dfxDone = true;
    try {
      playOnDrop(d, !!d.dfxWait);
    } catch {}
    return r;
  };
  const storeBase = X.AFTER.store;
  X.AFTER.store = (...a) => {
    const r = storeBase?.(...a);
    try {
      storeAfter();
    } catch {}
    return r;
  };
  // «Мій вигляд»: s2-ui.js draws the sheet; the effect section goes under it after each redraw.
  for (const k of ['s2Look', 's2SetLook']) {
    const base = X.H[k];
    if (!base) continue;
    X.H[k] = async (...a) => {
      const r = await base(...a);
      addLookSection();
      return r;
    };
  }
  Object.assign(X.H, {
    dfxEquip: (d) => X.act('style/equip', { slot: S.DROPFX.slot, id: d.id || '' }, d.id ? 'Ефект увімкнено — грає на твоїх дропах' : 'Ефект вимкнено'),
    dfxPick: async (d) => {
      try {
        const r = await X.api('style/equip', { slot: S.DROPFX.slot, id: d.id || '' });
        me().dropfx = r.dropfx;
        X.haptic?.('light');
        addLookSection();
      } catch (e) {
        X.toast(e.message, true);
      }
    },
    dfxGo: () => {
      X.closeModal?.();
      st().storeView = 'style';
      st().tab = 'menu';
      X.go('store');
      setTimeout(() => document.getElementById('dfxSec')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 260);
    },
  });
}
