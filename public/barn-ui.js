// «Сарайна знахідка» in the app (rules public/barn.js, server src/barn.js). Installed once by app.js with its helpers:
//   · the «Сарай» page (Меню → Сарай): the weekly find, the restoration in work (rusty photo → stages → R), the shed;
//   · a slim row on «Гараж» when something waits (a stage is done, or this week's find);
//   · a «Реставрація» row in the menu (injected, the menu itself is not edited).
// Rotten look: the base car's photo with dirt.js mud (carArt dirt) under a CSS rust filter (--rust), both fading stage
// by stage; the «R» shows its own livery (S.MODELS[r].filter, like the editions).
import * as S from './shared.js';
import * as B from './barn.js';

let X = null; // { me(), state(), api, act, H, ic, esc, sheet, go, carArt, untilSpan, confirmBox, toast, FX, render, closeModal, isOpen, lockChip }
let data = null, timer = 0;
const COPPER = '#b5653a';

const srcText = (s) => (s === 'week' ? 'знахідка тижня' : s === 'lot' ? 'з контейнера' : 'знахідка');
const sh = (n) => S.short(n);
function rusty(model, done, cls = '') {
  return `<div class="br-art ${cls}" style="--rust:${B.rustOf(done)}">${X.carArt(model, { dirt: B.dirtOf(done) })}</div>`;
}
const rArt = (find, cls = '') => `<div class="br-art br-shine ${cls}">${X.carArt(find.r)}<span class="br-badge">R</span></div>`;
function track(f) {
  return `<div class="br-track">${B.STAGES.map((st, i) => {
    const state = i < f.done ? 'ok' : i === f.done && f.runUntil ? 'run' : i === f.done ? 'next' : '';
    return `<div class="br-st ${state}"><span class="br-dot">${X.ic(i < f.done ? 'check' : st.icon)}</span><small>${st.name}</small></div>`;
  }).join('<i class="br-ln"></i>')}</div>`;
}
const partList = (list) => list.map((p) => `${B.partName(p.type, p.tier)} ×${p.n}`).join(', ');

// The restoration in work: one card, one main action.
function workCard(f, primary) {
  const m = S.MODELS[f.model], st = B.STAGES[f.done];
  let body = '';
  if (f.ready) {
    body = `${rArt(f, 'lg')}<div class="br-ttl"><b>${X.esc(S.MODELS[f.r].name)}</b><span class="chip br-chip">${X.ic('sparkles')}×${String(S.R_MULT).replace('.', ',')} вартість і дохід</span></div>
      <button class="btn" data-act="barnClaim" data-id="${f.id}">${X.ic('sparkles')} Забрати R-версію</button>`;
  } else if (f.runUntil) {
    const total = st.hours * 3600e3, pct = Math.max(2, Math.min(100, ((total - f.left) / total) * 100));
    body = `${rusty(f.model, f.done, 'lg')}${track(f)}
      <div class="br-run"><span>${X.ic('clock')} ${st.verb}: ще ${X.untilSpan(f.runUntil)}</span><div class="progress br-prog"><i style="width:${pct}%"></i></div></div>
      <button class="btn ghost" data-act="barnRush" data-id="${f.id}" data-cost="${f.rush}">${X.ic('rocket')} Прискорити · ${sh(f.rush)}</button>
      <div class="tiny muted mt">Бот напише, щойно етап буде готовий.</div>`;
  } else if (f.next) {
    const n = f.next, nst = B.STAGES[n.i], short = n.missing.length > 0;
    body = `${rusty(f.model, f.done, 'lg')}${track(f)}
      <div class="br-need"><div class="small"><b>Етап ${n.i + 1}/4 · ${nst.name}</b> · ${nst.hours} год</div>
        <div class="small muted">${short ? `<span class="br-miss">${X.ic('info-circle')} Не вистачає: ${X.esc(partList(n.missing))}</span>` : `Зі складу піде: ${X.esc(partList(n.take))}`}</div></div>
      ${short ? `<button class="btn ghost" data-act="barnParts">${X.ic('tool')} До майстерні — кейси з деталями</button>`
        : `<button class="btn${primary ? '' : ' ghost'}" data-act="barnStart" data-id="${f.id}">${X.ic(nst.icon)} ${f.done ? 'Далі' : 'Почати'}: ${nst.name} · ${sh(n.money)}</button>`}`;
  }
  return `<div class="card br-work" style="--c:${S.CLASSES[m.cls].color}">
    <div class="br-head"><span class="stamp r${S.rankOf(m.cls)}" style="--c:${S.CLASSES[m.cls].color}"><b>${m.cls}</b></span><b class="grow ellipsis">${X.esc(m.name)}</b><span class="chip">${m.year}</span></div>
    ${body}
    <div class="br-vals small muted"><span>Зараз ${sh(f.value)}</span>${X.ic('arrow-right')}<span>R: <b class="br-v">${sh(f.rValue)}</b> колекційна</span><span>· дилер за R ${sh(f.rSale)}</span></div>
    ${f.spent ? `<div class="tiny muted">Вкладено: ${sh(f.spent)} і деталі</div>` : ''}</div>`;
}

function waitingRow(f, busy) {
  const m = S.MODELS[f.model];
  return `<div class="li br-row"><div class="br-mini" style="--c:${S.CLASSES[m.cls].color}">${rusty(f.model, 0)}</div>
    <div class="grow"><b class="ellipsis">${X.esc(m.name)}</b><div class="tiny muted">${m.cls}-клас · ${srcText(f.source)} · R = ${sh(f.rValue)}</div></div>
    ${busy ? '' : `<button class="btn sm ghost" data-act="barnStart" data-id="${f.id}">Почати</button>`}
    <button class="br-x" data-act="barnDrop" data-id="${f.id}" aria-label="Прибрати знахідку">${X.ic('trash')}</button></div>`;
}

async function page() {
  data = await X.api('barn');
  const v = data, work = v.finds.find((f) => f.status === 'work'), wait = v.finds.filter((f) => f.status === 'found');
  clearTimeout(timer);
  if (work?.runUntil) timer = setTimeout(() => X.state().page === 'barn' && X.render(), Math.min(2 ** 31 - 1, work.left + 1200));
  // One yellow on the screen: the restoration's next step if there is one, otherwise the weekly find.
  const workPrimary = !!work && (work.ready || (!work.runUntil && work.next && !work.next.missing.length));
  const wk = v.weekly;
  const weekly = wk.ready
    ? `<div class="card br-week"><div class="br-week-h">${X.ic('building-warehouse')}<div class="grow"><b>Знахідка тижня</b><div class="small muted">Раз на тиждень — безкоштовно. Класика D–B, з рівня 10 зрідка A і S.</div></div></div>
       <button class="btn${workPrimary ? ' ghost' : ''}" data-act="barnWeekly">${X.ic('key')} Оглянути сарай</button></div>`
    : `<div class="br-week-off small muted">${X.ic('clock')}<span>${wk.full ? `У сараї ${v.max} знахідки — почни реставрацію або прибери одну` : `Наступна знахідка тижня — у понеділок, через ${X.untilSpan(wk.nextAt)}`}</span></div>`;
  const intro = `<div class="br-intro small muted">Знаходиш гнилу класику — за 4 етапи по 6–12 год відновлюєш її деталями зі складу й грошима. На виході — <b class="br-v">R-версія</b>: ×${String(S.R_MULT).replace('.', ',')} вартості й доходу, своя ліврея й номер, у кейсах її немає.</div>`;
  const shed = wait.length ? `<div class="h2"><span>У сараї</span><span>${wait.length}/${v.max}</span></div><div class="list">${wait.map((f) => waitingRow(f, !!work)).join('')}</div>
    ${work ? '<div class="tiny muted">Реставрація — по одній машині. Наступну почнеш, щойно забереш R.</div>' : ''}` : '';
  const doneList = v.done.length ? `<div class="h2"><span>Відреставровано</span><span>${v.restored}</span></div><div class="list">${v.done.map((f) => `<div class="li br-row"><div class="br-mini">${rArt(f)}</div>
    <div class="grow"><b class="ellipsis">${X.esc(S.MODELS[f.r].name)}</b><div class="tiny muted">вкладено ${sh(f.spent)} · колекційна ${sh(f.rValue)}</div></div></div>`).join('')}</div>` : '';
  const empty = !work && !wait.length ? `<div class="card br-empty">${rusty('haz-24-volha', 0)}<div class="small muted">Сарай порожній. Знахідки дає «Знахідка тижня» і зрідка виграні контейнери на «Причалі» (особливо після повені).</div></div>` : '';
  const rules = `<div class="tiny muted br-rules">Етапи: кузов → двигун → салон → фарба. Деталі — того ж типу, рівня класу машини або нижчого на один (Stock для D/C), краща теж підійде: спершу йдуть найдешевші. Прискорення — лише за гривні. R-версію можна продати на ринку й обміняти; дилер платить за неї як за звичайну, у колекції не рахується, апгрейд і трейд-ін — ні.</div>`;
  return `<div class="br">${intro}${work ? workCard(work, workPrimary) : ''}${weekly}${empty}${shed}${doneList}${rules}</div>`;
}

// ---------- actions ----------
async function doAct(name, body, ok) {
  const r = await X.act(name, body, ok);
  return r;
}
function foundSheet(model) {
  const m = S.MODELS[model];
  X.sheet('Знахідка в сараї', `<div class="br-found">${rusty(model, 0, 'lg')}<div class="br-ttl"><b>${X.esc(m.name)}</b><span class="chip">${m.cls}-клас · ${m.year}</span></div>
    <div class="small muted">Гнила, але ціла. Після 4 етапів стане <b class="br-v">${X.esc(S.MODELS[S.R_OF[model]].name)}</b> за ${sh(S.MODELS[S.R_OF[model]].price)}.</div>
    <button class="btn mt" data-act="closeModal">До сараю</button></div>`);
}
function planSheet(f) {
  const m = S.MODELS[f.model], n = f.next, st = B.STAGES[n.i], short = n.missing.length > 0;
  X.sheet(X.esc(m.name), `<div class="br-found">${rusty(f.model, 0, 'lg')}${track(f)}
    <div class="br-need" style="text-align:left"><div class="small"><b>Етап 1/4 · ${st.name}</b> · ${st.hours} год · ${sh(n.money)}</div>
      <div class="small muted">${short ? `<span class="br-miss">${X.ic('info-circle')} Не вистачає: ${X.esc(partList(n.missing))}</span>` : `Зі складу піде: ${X.esc(partList(n.take))}`}</div>
      <div class="tiny muted">Усього 4 етапи ≈ ${B.STAGE_HOURS} год і ${sh(B.totalMoney(f.model))}; на виході ${X.esc(S.MODELS[f.r].name)} за ${sh(f.rValue)}.</div></div>
    ${short ? `<button class="btn ghost" data-act="barnParts">${X.ic('tool')} До майстерні — кейси з деталями</button>`
      : `<button class="btn" data-act="barnGo" data-id="${f.id}">${X.ic(st.icon)} Почати: ${st.name} · ${sh(n.money)}</button>`}</div>`);
}
function install(ctx) {
  X = ctx;
  const { H } = ctx;
  ctx.PAGES.barn = page;
  ctx.PAGE_TITLES.barn = 'Сарай';
  ctx.PAGE_FEATURE.barn = 'parts';
  H.barnWeekly = async () => {
    const r = await doAct('barn/weekly', {});
    if (r?.found) foundSheet(r.found.model);
  };
  // From the shed: a sheet with what the first stage takes (missing parts → the workshop, no request at all).
  H.barnStart = async (d) => {
    const f = data?.finds.find((x) => x.id === Number(d.id));
    if (f && f.status === 'found' && f.next) return planSheet(f);
    return H.barnGo(d);
  };
  H.barnGo = async (d) => {
    const f = data?.finds.find((x) => x.id === Number(d.id));
    const st = f ? B.STAGES[f.done] : null;
    X.closeModal();
    await doAct('barn/start', { id: Number(d.id) }, st ? `Етап «${st.name}» почався — ${st.hours} год` : 'Етап почався');
  };
  H.barnRush = async (d) => {
    if (!(await X.confirmBox(`Завершити етап зараз за ${sh(Number(d.cost))}?`))) return;
    await doAct('barn/rush', { id: Number(d.id) }, 'Етап завершено');
  };
  H.barnClaim = async (d) => {
    const r = await doAct('barn/claim', { id: Number(d.id) });
    if (!r?.car) return;
    const m = S.MODELS[r.car.model];
    const [x, y] = [innerWidth / 2, innerHeight * 0.4];
    X.FX?.burst?.(x, y, [COPPER, '#ffffff', S.CLASSES[m.cls].color], { count: 40, power: 6, shape: 'mix' });
    X.sheet('Реставрацію завершено', `<div class="br-found">${rArt({ r: r.car.model }, 'lg')}<div class="br-ttl"><b>${X.esc(m.name)}</b><span class="chip br-chip">R ${S.serialText(r.car.serial)}</span></div>
      <div class="small muted">Колекційна ${sh(m.price)} · дохід ×${String(S.R_MULT).replace('.', ',')}. ${r.car.showcase ? 'Гараж повний — машина на вітрині.' : 'Уже в гаражі.'}</div>
      <button class="btn mt" data-act="closeModal">Чудово</button></div>`);
  };
  H.barnDrop = async (d) => {
    if (!(await X.confirmBox('Прибрати знахідку? Нічого не повертається.'))) return;
    await doAct('barn/drop', { id: Number(d.id) }, 'Знахідку прибрано');
  };
  H.barnParts = () => {
    const st = X.state();
    st.page = null;
    st.tab = 'shop';
    st.shopView = 'cases';
    X.closeModal();
    X.render();
  };
  const view = document.getElementById('view');
  if (view) new MutationObserver(() => paint()).observe(view, { childList: true });
}

// ---------- garage row + menu row (injected after the screen renders) ----------
function rowText(b) {
  // A stage that ended since the last `me` counts as ready too (the server settles it on the next call).
  if (b.active && !b.ready && b.active.runUntil && b.active.runUntil <= (X.serverNow?.() ?? Date.now())) b = { ...b, ready: true, active: { ...b.active, done: b.active.done + 1 } };
  if (b.active && b.ready) {
    const st = B.STAGES[b.active.done];
    return b.active.done >= B.STAGES.length ? `${S.MODELS[b.active.model].name}: реставрацію завершено — забери R` : `${S.MODELS[b.active.model].name}: ${b.active.done ? `${B.STAGES[b.active.done - 1].ready.toLowerCase()} — далі «${st.name}»` : 'можна починати'}`;
  }
  if (b.weekly) return 'Знахідка тижня чекає в сараї';
  return null;
}
function paint() {
  const st = X.state(), b = X.me()?.barn, view = document.getElementById('view');
  if (!view) return;
  // Garage: one slim row, only when something waits.
  const oldG = document.getElementById('brRow');
  const txt = b && !st.page && st.tab === 'garage' && !st.race && !st.drift ? rowText(b) : null;
  if (!txt) oldG?.remove();
  else if (!oldG || oldG.dataset.sig !== txt || oldG.parentNode !== view) {
    oldG?.remove();
    const el = document.createElement('button');
    el.id = 'brRow';
    el.className = 'br-row-g';
    el.dataset.act = 'go';
    el.dataset.page = 'barn';
    el.dataset.sig = txt;
    el.innerHTML = `<span class="br-ic">${X.ic('building-warehouse')}</span><span class="grow ellipsis"><b>Сарай</b> · ${X.esc(txt)}</span>${X.ic('chevron-right')}`;
    const after = document.getElementById('hwBanner') || document.getElementById('nextUl');
    if (after && after.parentNode === view) after.after(el);
    else view.prepend(el);
  }
  // Menu: a «Реставрація» row before «Ризикнути».
  if (st.tab === 'menu' && !st.page && !document.getElementById('brHub')) {
    const heads = [...view.querySelectorAll('.hub-h')];
    const risk = heads.find((h) => /Ризикнути/.test(h.textContent)) || heads[heads.length - 1];
    if (!risk) return;
    const open = X.isOpen('parts');
    const info = !open ? X.lockChip('parts') : b?.active ? `${X.esc(S.MODELS[b.active.model].name)} · ${b.ready ? '<span class="acc">етап готовий</span>' : `етап ${b.active.done + 1}/4`}` : b?.weekly ? 'знахідка тижня чекає' : `${b?.finds || 0} у сараї · R-версії ×1,6`;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="hub-h"><span>Реставрація</span></div><button class="hub-store br-hub${open ? '' : ' locked'}" id="brHub" data-act="${open ? 'go' : 'locked'}" data-page="barn" data-k="parts">
      <span class="hub-ic">${X.ic('building-warehouse')}</span><span class="grow"><b>Сарайна знахідка</b><span class="hub-i">${info}</span></span>${b?.ready || b?.weekly ? '<span class="hub-cnt">!</span>' : ''}<span class="chev">${X.ic('chevron-right')}</span></button>`;
    risk.before(...wrap.children);
  }
}

export { install as installBarn };
