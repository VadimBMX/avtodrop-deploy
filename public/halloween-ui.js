// «Ніч Хелловіну» in the app (rules public/halloween.js, server src/halloween.js). Installed once by app.js with the
// app's helpers; everything here reads me.halloween (null when the event is off, so all of it hides by itself):
//   · body.hw-on — the CSS of the night drag scene, the ghost container skin and the small touches (style.css «hw-»);
//   · a slim banner on top of «Гараж» and «Меню» (in the flow, never over content; like the rewards banner, never on «Кейси») → the event sheet;
//   · the night drift palette and its pumpkins/bats (app.js driftScene asks hwNight() and draws hwDriftDeco()).
import * as HW from './halloween.js';

let X = null; // { me(), state(), H, ic, esc, sheet, go, api }

export const hwNight = () => !!X?.me()?.halloween?.on;

// Small pictures, drawn once: a pumpkin and a bat (inline SVG, no image files).
export const PUMPKIN_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 7c-1-3 1-5 3-5" stroke="#3f7d2c" stroke-width="2.4" fill="none" stroke-linecap="round"/><ellipse cx="10.5" cy="18.5" rx="7.5" ry="10" fill="#e8620c"/><ellipse cx="21.5" cy="18.5" rx="7.5" ry="10" fill="#e8620c"/><ellipse cx="16" cy="18.5" rx="7" ry="10.5" fill="#ff8a1f"/><path d="M10 16l3 2-3 1.5zM22 16l-3 2 3 1.5zM11 23c2 2 8 2 10 0l-2 .5-1-1-1 1.2-1-1.2-1 1.2-1-1.2-1 1z" fill="#2a1200"/></svg>';
const BAT_SVG = '<svg viewBox="0 0 40 16" aria-hidden="true"><path d="M20 5c1-2 2-2 3 0 3-3 8-4 12-2-2 1-3 3-3 5-2-1-4 0-5 2-1-1-3-1-4 0-1-1-3-1-4 0-1-2-3-3-5-2 0-2-1-4-3-5 4-2 9-1 12 2 1-2 2-2 3 0z" fill="#4a2d60"/></svg>';

function untilText(h) {
  if (!h.end) return 'увімкнено адміністрацією';
  const d = new Date(h.end - 1);
  return `до ${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'numeric', timeZone: 'Europe/Kyiv' })} 23:59`;
}
// The banner on «Гараж» and «Меню»: in the page flow (prepended), one line, tap → the tasks.
function banner(h) {
  const done = h.tasks.filter((t) => t.done).length;
  const el = document.createElement('button');
  el.id = 'hwBanner';
  el.className = 'hw-banner';
  el.dataset.act = 'hwOpen';
  el.setAttribute('aria-label', `${HW.HALLOWEEN.name}: завдання події`);
  el.innerHTML = `<span class="hw-pk">${PUMPKIN_SVG}</span><span class="hw-bt"><b>${HW.HALLOWEEN.name}</b><small>${untilText(h)} · завдання ${done}/${h.tasks.length}</small></span>
    <span class="hw-bats" aria-hidden="true"><i>${BAT_SVG}</i><i>${BAT_SVG}</i></span><span class="hw-go">${X.ic('chevron-right')}</span>`;
  return el;
}
function paint() {
  const h = X.me()?.halloween, st = X.state();
  document.body.classList.toggle('hw-on', !!h?.on);
  const view = document.getElementById('view');
  const old = document.getElementById('hwBanner');
  const want = !!h?.on && !st.page && !st.race && !st.drift && !st.opening && ['garage', 'menu'].includes(st.tab);
  if (!want) return old?.remove();
  const sig = `${st.tab}:${h.tasks.map((t) => t.progress).join(',')}`;
  if (old && old.dataset.sig === sig && old.parentNode === view) return;
  old?.remove();
  const el = banner(h);
  el.dataset.sig = sig;
  const after = document.getElementById('nextUl');
  if (after && after.parentNode === view) after.after(el);
  else view.prepend(el);
}

// The event sheet: what's on, the tasks with progress and prizes, the ghost container.
function openSheet() {
  const h = X.me()?.halloween;
  if (!h) return;
  const { ic, esc } = X;
  const rows = h.tasks.map((t) => `<div class="li hw-task${t.done ? ' done' : ''}"><span class="ic tint" style="--c:${t.done ? '#30d158' : HW.HALLOWEEN.color}">${ic(t.done ? 'check' : t.icon)}</span>
    <div class="grow"><b>${esc(t.text)}</b><div class="tiny muted">${t.done && t.prize ? esc(t.prize.text) : `нагорода: ${esc(t.reward)}`}</div>
    ${t.done ? '' : `<div class="progress hw-prog"><i style="width:${Math.round((t.progress / t.n) * 100)}%"></i></div>`}</div><span class="small ${t.done ? 'acc' : 'muted'} nw">${t.progress}/${t.n}</span></div>`).join('');
  X.sheet(HW.HALLOWEEN.name, `<div class="hw-sheet-head"><span class="hw-pk lg">${PUMPKIN_SVG}</span><div class="grow"><b>${untilText(h)}</b>
      <div class="small muted">Нічна траса дрифту й драгу, «Контейнер з привидом» на «Причалі», рамка «Гарбуз». Ціни й шанси кейсів — як завжди.</div></div></div>
    <div class="h2"><span>Завдання події</span><span>${h.tasks.filter((t) => t.done).length}/${h.tasks.length}</span></div>
    <div class="list">${rows}</div>
    <div class="tiny muted mt">Рахуються лише дії під час події. Нагорода приходить сама, щойно завдання виконано. Усе зароблене лишається й після Хелловіну.</div>
    <button class="btn mt hw-ghost-btn" data-act="pierGo">${ic('box')} Контейнер з привидом</button>`);
}

// Night drift (app.js driftScene): palette and the decorations drawn on the canvas.
export const HW_DRIFT = { grass: '#120c19', specks: ['#1b1224', '#0c0811'], kerbA: '#ff7a1a', kerbB: '#141016', edge: '#c9b9a6', asphalt: '#26232b', dash: '#ff9a3c88' };
let pumpkinImg = null, batImg = null, vign = null;
const svgImg = (svg) => {
  const im = new Image();
  im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  return im;
};
// World space: a glowing pumpkin by the road every ~n samples (both sides in turn). xs/ys/hs: the track's samples.
export function hwDriftPumpkins(ctx, xs, ys, hs, from, to, half) {
  pumpkinImg ||= svgImg(PUMPKIN_SVG);
  if (!pumpkinImg.complete) return;
  for (let i = from - (from % 45); i <= to; i += 45) {
    if (i < 0 || i >= xs.length) continue;
    const side = (i / 45) % 2 ? 1 : -1, off = half + 26;
    const x = xs[i] + side * Math.cos(hs[i]) * off, y = ys[i] + side * Math.sin(hs[i]) * off; // heading 0 = up: (cos, sin) is across the road
    ctx.fillStyle = 'rgba(255,122,26,.16)';
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(pumpkinImg, x - 10, y - 10, 20, 20);
  }
}
// Screen space: darkness at the edges and two bats crossing the top.
export function hwDriftOverlay(ctx, W, H, now) {
  if (!vign || vign.width !== Math.round(W) || vign.height !== Math.round(H)) {
    vign = document.createElement('canvas');
    vign.width = Math.round(W);
    vign.height = Math.round(H);
    const g = vign.getContext('2d'), gr = g.createRadialGradient(W / 2, H * 0.62, Math.min(W, H) * 0.25, W / 2, H * 0.62, Math.max(W, H) * 0.75);
    gr.addColorStop(0, 'rgba(8,4,14,0)');
    gr.addColorStop(1, 'rgba(8,4,14,.72)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }
  ctx.drawImage(vign, 0, 0, W, H);
  batImg ||= svgImg(BAT_SVG);
  if (!batImg.complete) return;
  for (let k = 0; k < 2; k++) {
    const p = ((now / (9000 + k * 3100)) + k * 0.45) % 1;
    const x = -40 + p * (W + 80), y = 34 + k * 26 + Math.sin(now / 260 + k) * 6;
    const flap = 0.55 + 0.45 * Math.abs(Math.sin(now / 90 + k));
    ctx.drawImage(batImg, x - 14, y - 6 * flap, 28, 12 * flap);
  }
}

export function installHalloween(ctx) {
  X = ctx;
  ctx.H.hwOpen = openSheet;
  const view = document.getElementById('view');
  if (view) new MutationObserver(() => paint()).observe(view, { childList: true });
}
