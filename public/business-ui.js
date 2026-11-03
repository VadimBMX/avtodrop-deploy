// «Мої бізнеси» in the app (rules public/business.js, server src/business.js). Installed once by app.js with its helpers.
//   · page 'biz': the total income, «Зібрати все», a card per business (owned: building, level, ₴/h, the box bar,
//     «Каса повна», «Зібрати»; open to buy: price, «Купити»; locked: the level it opens at);
//   · page 'bizOne': one business — the building of its level, the box ring with «Забрати», the three branches, the
//     building level, the «Менеджер» (⭐), the owner's perk;
//   · bizHubRow(): the entry row in «Меню» (the redesign will move it).
// The boxes count up on screen every second from the rate (the server is the truth on every call).
import * as S from './shared.js';
import * as B from './business.js';

let X = null; // { me, state, H, PAGES, AFTER, PAGE_TITLES, api, act, toast, go, render, ic, esc, serverNow, confirmBox }
let data = null; // the last 'biz' answer
let at = 0; // when it came (client clock)
let timer = null;

const grp = (n) => Math.floor(n).toLocaleString('uk-UA').replace(/\s/g, ' ');
const money = (n) => `${grp(n)} ₴`;
const img = (id, lvl) => `biz/${id}-${Math.min(B.BIZ_MAX_LVL, Math.max(1, lvl || 1))}.webp`;
const ICONS = { eq: 'tools', staff: 'users', ads: 'rocket' };
function hm(ms) {
  const m = Math.max(1, Math.ceil(ms / 60e3)), h = Math.floor(m / 60);
  return h ? `${h} год${m % 60 ? ` ${m % 60} хв` : ''}` : `${m} хв`; // as the garage's «повна через 3 год 56 хв»
}
// The box of business x now (client-side count-up from the last answer).
function boxNow(x) {
  const dt = Date.now() - at;
  const v = x.box + (x.rate * dt) / 3600e3;
  return Math.floor(x.manager ? v : Math.max(x.box, Math.min(v, x.cap)));
}

export function installBusiness(x) {
  X = x;
  X.PAGE_TITLES.biz = 'Мої бізнеси';
  X.PAGE_TITLES.bizOne = 'Бізнес';
  X.PAGES.biz = async () => (await load(), listView());
  X.PAGES.bizOne = async () => (await load(), oneView());
  X.AFTER.biz = startTick;
  X.AFTER.bizOne = startTick;
  Object.assign(X.H, handlers);
}
async function load() {
  data = await X.api('biz');
  at = Date.now();
}

// ---------- entry ----------
export function bizHubRow() {
  if (!X) return '';
  const m = X.me(), own = m.biz || [];
  const first = B.BIZ.list[0], open = (m.level || 1) >= first.level;
  const full = own.filter((b) => b.full).length;
  const info = own.length
    ? `${own.length}/${B.BIZ.list.length} · +${S.short(own.reduce((s, b) => s + b.rate, 0))}/год${m.bizTotalBox ? ` · каса ${S.short(m.bizTotalBox)}` : ''}`
    : open ? `${first.short} — ${S.short(first.price)}, +${S.short(first.income)}/год` : `з ${first.level}-го рівня`;
  return `<button class="hub-store bz-hub${open ? '' : ' locked'}" data-act="go" data-page="biz"><span class="hub-ic">${X.ic(open ? 'building-skyscraper' : 'lock')}</span>
    <span class="grow"><b>Мої бізнеси</b><span class="hub-i">${info}</span></span>${full ? `<span class="bz-dot">${full}</span>` : ''}<span class="chev">${X.ic('chevron-right')}</span></button>`;
}

// ---------- the list ----------
function listView() {
  const { ic } = X, m = X.me();
  const own = data.list.filter((b) => b.owned);
  const total = own.reduce((s, b) => s + boxNow(b), 0);
  const capH = B.BIZ.capHours, vipH = B.BIZ.vipCapHours;
  const head = `<div class="bz-sum">
    <div class="bz-sum-l"><small>Дохід усіх бізнесів</small><b class="disp"><span>+${grp(data.totalRate)} ₴</span><i>/год</i></b>
      <span class="bz-sum-s">${data.district ? `+${Math.round(data.district * 100)}% бонус району` : `бізнесів ${own.length} з ${B.BIZ.list.length} · каса до ${data.vip ? vipH : capH} год${data.vip ? ' (VIP)' : ''}`}</span></div>
    ${own.length ? '' : '<span class="bz-sum-s muted">Купи перший бізнес — і він приноситиме гроші, навіть коли тебе немає</span>'}
    <button class="bz-btn" data-act="bizCollect" data-all="1" ${total > 0 ? '' : 'disabled'} ${own.length ? '' : 'hidden'}><span data-bz-total>${total > 0 ? `Зібрати ${S.short(total)}` : 'Каса порожня'}</span></button></div>`;
  const cards = data.list.map((b) => {
    const meta = B.BIZ_BY_ID[b.id];
    if (b.owned) {
      const v = boxNow(b), pctv = b.manager ? 100 : Math.min(100, (v / Math.max(1, b.cap)) * 100);
      const full = !b.manager && v >= b.cap;
      return `<div class="bz-card${full ? ' full' : ''}" role="button" tabindex="0" data-act="bizOpen" data-id="${b.id}" style="--c:${meta.color}">
        <img class="bz-img" src="${img(b.id, b.lvl)}" alt="" loading="lazy">
        <span class="bz-mid"><b class="bz-nm">${X.esc(b.name)}</b><small>рів. ${b.lvl}</small><small><b class="bz-rate">+${grp(b.rate)} ₴/год</b></small>
          <span class="bz-bar"><i data-bz-bar="${b.id}" style="width:${pctv.toFixed(1)}%"></i></span></span>
        <span class="bz-right"><button class="bz-chip${full ? ' hot' : ''}" data-act="bizCollect" data-id="${b.id}" ${v > 0 ? '' : 'disabled'}>Зібрати</button>
          ${full ? '<span class="bz-full">Каса повна</span>' : b.manager ? `<span class="bz-need">${ic('crown')} менеджер</span>` : `<span class="bz-need" data-bz-box="${b.id}">${S.short(v)}</span>`}</span></div>`;
    }
    if (!b.unlocked) {
      return `<div class="bz-card locked"><img class="bz-img" src="${img(b.id, 1)}" alt="" loading="lazy">
        <span class="bz-mid"><b class="bz-nm">${X.esc(b.name)}</b><small>відкривається з рів. ${b.level}</small></span>
        <span class="bz-right bz-lock">${ic('lock')}</span></div>`;
    }
    const short = Math.max(0, b.price - m.balance);
    return `<div class="bz-card buy" style="--c:${meta.color}"><img class="bz-img" src="${img(b.id, 1)}" alt="" loading="lazy">
      <span class="bz-mid"><b class="bz-nm">${X.esc(b.name)}</b><small><b class="bz-rate">+${grp(b.income)} ₴/год</b></small><small>ціна ${S.short(b.price)}</small></span>
      <span class="bz-right"><button class="bz-chip hot" data-act="bizBuy" data-id="${b.id}" ${short ? 'disabled' : ''}>Купити</button>
        ${short ? `<span class="bz-need">ще ${S.short(short)}</span>` : ''}</span>
      <span class="bz-perkline">${ic('sparkles')} ${X.esc(b.perk)}</span></div>`;
  }).join('');
  const nextLocked = data.list.find((b) => !b.owned && !b.unlocked);
  const foot = nextLocked ? `<div class="bz-foot">${ic('plus')}<span><b>Наступний бізнес</b><small>${X.esc(nextLocked.name)} · з рів. ${nextLocked.level} · ${S.short(nextLocked.price)}</small></span></div>` : '';
  return `<div class="bz">${head}<div class="bz-list">${cards}</div>${foot}
    <div class="bz-note">Каса бізнесу наповнюється сама до ${capH} год доходу (з VIP — ${vipH} год, «Персонал» додає ще). Повна каса стоїть — заходь і збирай. Кожен бізнес ще й дає бонус у грі.</div></div>`;
}

// ---------- one business ----------
function oneView() {
  const { ic, esc } = X, m = X.me();
  const id = X.state().bizId;
  const b = data.list.find((x) => x.id === id && x.owned);
  if (!b) return listView();
  const meta = B.BIZ_BY_ID[b.id];
  const v = boxNow(b), full = !b.manager && v >= b.cap;
  const pctv = b.manager ? 1 : Math.min(1, v / Math.max(1, b.cap));
  const R = 34, C = 2 * Math.PI * R;
  const ring = `<svg viewBox="0 0 80 80" class="bz-ring"><circle cx="40" cy="40" r="${R}" class="bz-ring-bg"/><circle cx="40" cy="40" r="${R}" class="bz-ring-fg" data-bz-ring="${b.id}" stroke-dasharray="${(C * pctv).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/></svg>`;
  const fullIn = b.manager ? `Менеджер забирає сам` : full ? 'Каса повна!' : `Повна через ${hm(((b.cap - v) / Math.max(1, b.rate)) * 3600e3)}`;
  const steps = B.BRANCH_KEYS.reduce((s, k) => s + b[k], 0), maxSteps = B.BRANCH_KEYS.reduce((s, k) => s + B.BIZ.branches[k].steps, 0);
  const seg = Array.from({ length: maxSteps }, (_, i) => `<i${i < steps ? ' class="on"' : ''}></i>`).join('');
  const row = (k) => {
    const br = B.BIZ.branches[k], n = b[k], cost = b.next[k];
    const gain = k === 'staff' ? `+${br.capHours} год каси` : `+${Math.round(br.income * 100)}% доходу`;
    const btn = cost == null ? `<span class="bz-max">${ic('check')} макс.</span>`
      : `<button class="bz-cost${m.balance >= cost ? ' ok' : ''}" data-act="bizUp" data-id="${b.id}" data-br="${k}" ${m.balance >= cost ? '' : 'disabled'}>${S.short(cost).replace(' ₴', '')}</button>`;
    return `<div class="bz-row"><span class="bz-ic">${ic(ICONS[k])}</span><span class="bz-row-t"><b>${br.name}</b>
      <small>${cost == null ? `рів. ${n} з ${br.steps}` : `рів. ${n} → ${n + 1} · <em>${gain}</em>`}</small></span>${btn}</div>`;
  };
  const bc = b.build;
  const buildRow = bc.cost == null ? '' : `<div class="bz-row${bc.ready ? '' : ' dim'}"><span class="bz-ic">${ic('building-arch')}</span><span class="bz-row-t"><b>Будівля · рів. ${b.lvl + 1}</b>
      <small>${bc.ready ? `<em>×${String(B.BIZ.build[b.lvl].mult).replace('.', ',')} доходу</em> · нова будівля` : `коли всі гілки на ${bc.need}+`}</small></span>
      ${bc.ready ? `<button class="bz-cost${m.balance >= bc.cost ? ' ok' : ''}" data-act="bizUp" data-id="${b.id}" data-br="build" ${m.balance >= bc.cost ? '' : 'disabled'}>${S.short(bc.cost).replace(' ₴', '')}</button>` : `<span class="bz-max">${ic('lock')}</span>`}</div>`;
  const mgr = `<div class="bz-row bz-mgr"><span class="bz-ic">${ic('crown')}</span><span class="bz-row-t"><b>Менеджер</b>
      <small>${b.manager ? `працює ще <em>${hm(b.manager - X.serverNow())}</em> · каса без ліміту` : `сам забирає касу · ${data.mgrDays} днів`}</small></span>
      <button class="bz-cost star" data-act="bizMgr" data-id="${b.id}">⭐ ${data.mgrStars}</button></div>`;
  return `<div class="bz bz-one" style="--c:${meta.color}">
    <div class="bz-hero"><img src="${img(b.id, b.lvl)}" alt="${esc(b.name)}"></div>
    <div class="bz-kick">Твій бізнес · будівля ${b.lvl} з ${B.BIZ_MAX_LVL}</div>
    <div class="bz-title"><h2 class="disp">${esc(b.name)}</h2><span class="bz-lvl">${ic('arrow-big-up-lines')} Рів. ${b.lvl}</span></div>
    <div class="bz-seg" title="Покращення ${steps} з ${maxSteps}">${seg}</div>
    <div class="bz-boxcard"><div class="bz-ringw">${ring}<b data-bz-pct="${b.id}">${b.manager ? '∞' : `${Math.floor(pctv * 100)}%`}</b></div>
      <span class="bz-box-t"><small data-bz-in="${b.id}">${fullIn}</small><b class="disp" data-bz-box="${b.id}" data-fmt="full">${money(v)}</b><em>+${grp(b.rate)} ₴ / год</em></span>
      <button class="bz-btn" data-act="bizCollect" data-id="${b.id}" ${v > 0 ? '' : 'disabled'}>Забрати</button></div>
    ${B.BRANCH_KEYS.map(row).join('')}${buildRow}${mgr}
    <div class="bz-perk">${ic('sparkles')}<span><b>Бонус власника</b><small>${esc(b.perk)}</small></span></div>
    <button class="bz-back" data-act="go" data-page="biz">${ic('chevron-left')} Усі бізнеси</button></div>`;
}

// ---------- live count-up ----------
function startTick() {
  clearInterval(timer);
  timer = setInterval(() => {
    const root = document.querySelector('.bz');
    if (!root || !data) return clearInterval(timer);
    let total = 0;
    for (const b of data.list) {
      if (!b.owned) continue;
      const v = boxNow(b);
      total += v;
      const p = b.manager ? 1 : Math.min(1, v / Math.max(1, b.cap));
      for (const el of root.querySelectorAll(`[data-bz-box="${b.id}"]`)) el.textContent = el.dataset.fmt === 'full' ? money(v) : S.short(v);
      const bar = root.querySelector(`[data-bz-bar="${b.id}"]`);
      if (bar) bar.style.width = `${(p * 100).toFixed(1)}%`;
      const ring = root.querySelector(`[data-bz-ring="${b.id}"]`);
      if (ring) ring.setAttribute('stroke-dasharray', `${(2 * Math.PI * 34 * p).toFixed(1)} ${(2 * Math.PI * 34).toFixed(1)}`);
      const pc = root.querySelector(`[data-bz-pct="${b.id}"]`);
      if (pc && !b.manager) pc.textContent = `${Math.floor(p * 100)}%`;
      const inEl = root.querySelector(`[data-bz-in="${b.id}"]`);
      if (inEl && !b.manager) inEl.textContent = v >= b.cap ? 'Каса повна!' : `Повна через ${hm(((b.cap - v) / Math.max(1, b.rate)) * 3600e3)}`;
    }
    const t = root.querySelector('[data-bz-total]');
    if (t && total > 0) t.textContent = `Зібрати ${S.short(total)}`;
  }, 1000);
}

// ---------- actions ----------
const handlers = {
  bizOpen(d) {
    X.state().bizId = d.id;
    X.PAGE_TITLES.bizOne = B.BIZ_BY_ID[d.id]?.short || 'Бізнес';
    X.go('bizOne');
  },
  async bizBuy(d) {
    const b = B.BIZ_BY_ID[d.id];
    if (!b || !(await X.confirmBox(`Купити ${b.name} за ${S.fmt(b.price)}? Приносить +${S.fmt(b.income)}/год і ${B.PERK_TEXT[b.id]}.`))) return;
    const r = await X.act('biz/buy', { id: d.id }, `${b.name} — твій!`);
    if (r) handlers.bizOpen(d);
  },
  bizUp(d) {
    const name = d.br === 'build' ? 'Нова будівля' : B.BIZ.branches[d.br]?.name;
    X.act('biz/upgrade', { id: d.id, branch: d.br }, `${name}: покращено`);
  },
  bizCollect(d) {
    X.act('biz/collect', d.all ? { all: true } : { id: d.id }, (r) => (r.got ? `+${S.fmt(r.got)}` : 'Каса порожня'));
  },
  async bizMgr(d) {
    const item = B.mgrItemId(d.id), price = B.BIZ.manager.stars;
    // Stars already on the account (season prizes) pay at once; otherwise a Telegram Stars invoice.
    if ((X.me().stars || 0) >= price) return X.H.buyItemStars({ id: item, p: price });
    return X.H.buyItem({ id: item });
  },
};
