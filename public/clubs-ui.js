// «Автоклуби» in the app (rules public/clubs.js, server src/clubs.js). Installed once by app.js with its helpers:
//   · page «Клуб» (Меню → Автоклуби): without a club — the invite from a link, search, open clubs, «Створити клуб»,
//     the week's league; in a club — the head card (tag, place, points, treasury), the members, the treasury with the
//     week's perks, the league; «Запросити в клуб» is the one primary action;
//   · clubTag(row): the [TAG] chip next to a name in the rating, battles and the day's board;
//   · clubHub(): the row in «Меню»; clubFromLink(): a club_<code> deep link opens the page on the invite.
import * as S from './shared.js';
import * as C from './clubs.js';

let X = null; // { me, state, config, tg, H, PAGES, AFTER, PAGE_TITLES, api, act, toast, sheet, closeModal, confirmBox, go, render, ic, esc, initialOf, untilSpan, tickUntil, emptyLine }
let V = null; // the last `club` answer

export function installClubs(x) {
  X = x;
  X.PAGE_TITLES.club = 'Клуб';
  X.PAGES.club = page;
  X.AFTER.club = () => X.tickUntil();
  Object.assign(X.H, handlers);
}

const R = C.CLUB;
const n0 = (n) => Number(n || 0).toLocaleString('uk-UA');
const pts = (n) => `${n0(n)} ${C.plural(n, ['очко', 'очки', 'очок'])}`;
export const clubTag = (r) => (r?.tag ? `<span class="clb-tag">[${X.esc(r.tag)}]</span>` : '');
const tagBox = (tag, cls = '') => `<span class="clb-tagbox ${cls}">${X.esc(tag)}</span>`;

// ---------- entry points ----------
export function clubHub() {
  const { ic, esc } = X, me = X.me(), c = me.club;
  const info = c ? `${pts(c.pts)} за тиждень · твої ${n0(c.myPts)}` : me.level < R.joinLevel ? `${ic('lock')} з ${R.joinLevel}-го рівня` : 'ліга тижня з призами, клубна каса';
  return `<button class="hub-store clb-hub" data-act="go" data-page="club"><span class="hub-ic">${ic('users')}</span><span class="grow"><b class="ellipsis">${c ? `${tagBox(c.tag, 'sm')} ${esc(c.name)}` : 'Автоклуби'}</b>
    <span class="hub-i">${info}</span></span>${c?.ready ? `<span class="hub-cnt">${c.ready}</span>` : ''}<span class="chev">${ic('chevron-right')}</span></button>`;
}
// start_param club_<code> (t.me/<bot>/<app>?startapp=club_…), ?club=<code> (the bot's button) or, in DEV, ?start=club_<code>.
export function clubFromLink() {
  const p = new URLSearchParams(location.search);
  const sp = X.tg?.initDataUnsafe?.start_param || p.get('start') || '';
  const code = C.CLUB_PARAM.exec(sp)?.[1] || (C.INVITE_RE.test(p.get('club') || '') ? p.get('club') : null);
  if (!code) return false;
  const st = X.state();
  st.clubInvite = code;
  st.page = 'club';
  return true;
}
const linkOf = (code) => C.clubLink(X.config().bot, X.config().app, code) || (X.config().dev ? `${location.origin}/?club=${code}` : '');

// ---------- the page ----------
async function page() {
  const st = X.state();
  V = await X.api('club');
  let inv = null;
  if (st.clubInvite && !V.club) {
    try {
      inv = await X.api('club/peek', { code: st.clubInvite });
    } catch (e) {
      st.clubInvite = null;
      X.toast(e.message, true);
    }
  } else if (V.club) st.clubInvite = null;
  return V.club ? clubView(V) : lobby(V, inv);
}

function clubRow(r, { join = true, canJoin = true } = {}) {
  const { ic, esc } = X;
  const right = !join ? `<b class="nw">${n0(r.pts)}</b>`
    : r.full ? '<span class="chip">повний</span>'
      : !r.open ? `<span class="chip">${ic('lock')} за запрошенням</span>`
        : canJoin ? `<button class="btn sm ghost" data-act="clubJoin" data-id="${r.id}">Вступити</button>` : `<span class="lockchip">${ic('lock')} рів. ${R.joinLevel}</span>`;
  return `<div class="li clb-row">${tagBox(r.tag)}<div class="grow"><b class="ellipsis">${esc(r.name)}</b>
    <div class="tiny muted">${r.members}/${R.max} · ${pts(r.pts)}${r.place ? ` · #${r.place} у лізі` : ''}</div>${r.about ? `<div class="tiny muted ellipsis">${esc(r.about)}</div>` : ''}</div>${right}</div>`;
}

function lobby(v, inv) {
  const { ic, esc } = X, st = X.state();
  const invite = inv ? `<div class="card clb-invite"><div class="tiny muted">${ic('users')} Тебе запрошують до клубу</div>
      <div class="row mt">${tagBox(inv.club.tag, 'lg')}<div class="grow"><b class="disp clb-name">${esc(inv.club.name)}</b><div class="tiny muted">${inv.club.members}/${R.max} учасників · власник ${esc(inv.club.owner.name)}${inv.club.place ? ` · #${inv.club.place} у лізі` : ''}</div></div></div>
      ${inv.club.about ? `<div class="small muted mt">${esc(inv.club.about)}</div>` : ''}
      ${v.canJoin ? `<button class="btn mt" data-act="clubJoin" data-code="${esc(st.clubInvite)}" ${inv.club.members >= R.max ? 'disabled' : ''}>${inv.club.members >= R.max ? 'У клубі немає місць' : 'Вступити в клуб'}</button>`
        : `<div class="chip mt">${ic('lock')} Вступ — з ${R.joinLevel}-го рівня</div>`}</div>` : '';
  const list = v.list.length ? `<div class="list" id="clbList">${v.list.map((r) => clubRow(r, { canJoin: v.canJoin })).join('')}</div>`
    : X.emptyLine('users', 'Відкритих клубів поки немає — створи перший');
  const createBtn = v.canCreate ? `<button class="btn ${inv ? 'ghost' : ''}" data-act="clubCreateOpen">Створити клуб · ${S.fmt(R.createCost)}</button>`
    : `<button class="btn ghost" disabled>${ic('lock')} Створити клуб — з ${R.createLevel}-го рівня</button>`;
  return `${invite}<div class="card clb-hero"><span class="clb-emb">${ic('users')}</span><div class="grow"><b class="disp">Автоклуби</b>
      <div class="small muted">До ${R.max} гравців. Тег клубу видно в рейтингу, батлах і Заїзді дня. Перемоги учасників — очки в лізі тижня; топ-10 клубів отримують призи в понеділок о 00:00.</div></div></div>
    ${createBtn}
    <div class="h2"><span>Знайти клуб</span></div>
    <div class="clb-search"><input id="clbQ" placeholder="Тег або назва" maxlength="24" autocomplete="off" value="${esc(st.clubQ || '')}"><button class="btn sm ghost" data-act="clubSearch">${ic('target-arrow')} Знайти</button></div>
    <div class="h2"><span>${st.clubQ ? 'Знайдено' : 'Відкриті клуби'}</span><span>${v.list.length}</span></div>${list}
    ${leagueHtml(v, 10)}`;
}

function clubView(v) {
  const { ic, esc } = X, c = v.club, st = X.state();
  st.clubTab ||= 'members';
  const tabs = [['members', `Учасники · ${c.members.length}`], ['bank', 'Каса'], ['league', 'Ліга']];
  const body = st.clubTab === 'bank' ? bankHtml(c) : st.clubTab === 'league' ? leagueHtml(v, 50, c.id) : membersHtml(c);
  const claimRows = [
    c.claims.chest && !c.claims.chest.done ? `<div class="li"><span class="clb-mi">${ic('key')}</span><div class="grow"><b>Ключ тижня</b><div class="tiny muted">«${esc(S.CASE_BY_ID[c.claims.chest.caseId]?.name || '')}» · раз на тиждень</div></div>
      <button class="btn sm ghost" data-act="clubClaim" data-kind="chest" ${c.claims.chest.can ? '' : 'disabled'}>Забрати</button></div>` : '',
    c.claims.fuel && !c.claims.fuel.done ? `<div class="li"><span class="clb-mi">${ic('gas-station')}</span><div class="grow"><b>Пальне +${c.claims.fuel.n}</b><div class="tiny muted">раз на день</div></div>
      <button class="btn sm ghost" data-act="clubClaim" data-kind="fuel" ${c.claims.fuel.can ? '' : 'disabled'}>Забрати</button></div>` : '',
  ].filter(Boolean);
  return `<div class="card clb-head">
      <div class="row">${tagBox(c.tag, 'lg')}<div class="grow"><b class="disp clb-name ellipsis">${esc(c.name)}</b><div class="tiny muted">${C.ROLES[c.role]} · ${c.members.length}/${R.max} учасників</div></div>
        ${c.tg ? `<button class="btn sm ghost clb-tg" data-act="openLink" data-page="${esc(c.tg)}">${ic('share')} Група</button>` : ''}</div>
      ${c.about ? `<div class="small muted mt">${esc(c.about)}</div>` : ''}
      <div class="clb-stats"><div><b>${c.place ? '#' + c.place : '—'}</b><span>місце з ${c.clubs}</span></div><div><b>${n0(c.pts)}</b><span>очок тижня</span></div><div><b>${n0(c.myPts)}</b><span>твої очки</span></div><div><b>${S.short(c.treasury)}</b><span>у касі</span></div></div>
      <div class="tiny muted">${ic('clock')} Тиждень ліги закінчиться через ${X.untilSpan(c.weekEnd)}</div></div>
    ${c.counts ? '' : `<div class="card clb-note">${ic('clock')}<span>Твої перемоги почнуть приносити клубу очки, а бонуси — діяти через ${X.untilSpan(c.countsAt)}: 24 год після вступу, щоб ніхто не «стрибав» між клубами.</span></div>`}
    ${claimRows.length ? `<div class="h2"><span>Бонуси клубу для тебе</span></div><div class="list">${claimRows.join('')}</div>` : ''}
    <div class="seg clb-tabs mt">${tabs.map(([k, t]) => `<button class="${st.clubTab === k ? 'on' : ''}" data-act="clubTab" data-k="${k}">${t}</button>`).join('')}</div>
    <div id="clbBody">${body}</div>
    <button class="btn clb-cta" data-act="clubInvite">${ic('users')} Запросити в клуб</button>
    <div class="clb-foot">${c.role === 'owner' ? `<button class="btn outline sm" data-act="clubEditOpen">${ic('settings')} Налаштування</button>` : ''}
      <button class="btn outline sm clb-leave" data-act="clubLeave">${c.role === 'owner' && c.members.length === 1 ? 'Розпустити клуб' : 'Вийти з клубу'}</button></div>`;
}

function membersHtml(c) {
  const { ic, esc } = X;
  const rows = c.members.map((m) => `<button class="li clb-mem ${m.me ? 'me' : ''}" data-act="clubMember" data-id="${m.id}"><span class="lb-ava">${esc(X.initialOf(m.name))}</span>
    <span class="grow"><b class="ellipsis">${esc(m.name)}</b><span class="tiny muted">${m.role !== 'member' ? `<span class="clb-role ${m.role}">${C.ROLES[m.role]}</span> · ` : ''}рів. ${m.level}${m.donated ? ` · у касу ${S.short(m.donated)}` : ''}${m.counts ? '' : ' · новачок, очки з ' + new Date(m.countsAt).toLocaleString('uk-UA', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' })}</span></span>
    <b class="nw clb-pts">${n0(m.pts)}</b></button>`).join('');
  return `<div class="tiny muted clb-hint">${c.staff ? 'Торкнись учасника, щоб змінити роль або виключити.' : 'Очки тижня: драг і дрифт — 1, бос — 3, Заїзд дня — 2.'}</div><div class="list">${rows}</div>`;
}

function perkRow(c, k) {
  const { ic, esc } = X, p = R.perks[k], s = c.perks[k];
  let sub, state = '', btns = '';
  if (k === 'income') {
    const cur = s.have ? p.levels[s.have - 1] : null;
    sub = cur ? `Діє: +${cur.pct}% до зібраного доходу, до ${S.short(cur.cap)} на день кожному` : `+2/4/6% до зібраного доходу кожному (ліміт ${S.short(p.levels[0].cap)}–${S.short(p.levels[2].cap)} на день)`;
    if (cur) state = `<span class="chip ok">+${cur.pct}%</span>`;
    if (c.staff) btns = s.levels.filter((L) => L.cost != null).map((L) => `<button class="btn sm ghost" data-act="clubPerk" data-perk="income" data-level="${L.level}" data-cost="${L.cost}" ${c.treasury < L.cost ? 'disabled' : ''}>+${L.pct}% · ${S.short(L.cost)}</button>`).join('');
  } else {
    sub = k === 'chest' ? `Ключ «${esc(S.CASE_BY_ID[p.caseId]?.name || '')}» кожному учаснику раз на тиждень` : `+${p.n} пального кожному учаснику раз на день`;
    if (s.have) state = '<span class="chip ok">діє</span>';
    else if (c.staff) btns = `<button class="btn sm ghost" data-act="clubPerk" data-perk="${k}" data-cost="${s.cost}" ${c.treasury < s.cost ? 'disabled' : ''}>Купити · ${S.short(s.cost)}</button>`;
  }
  if (!state && !btns) state = `<span class="chip">не куплено</span>`;
  return `<div class="li clb-perk"><span class="clb-mi">${ic(p.icon)}</span><div class="grow"><b>${p.name}</b><div class="tiny muted">${sub}</div>${btns ? `<div class="clb-btns">${btns}</div>` : ''}</div>${state}</div>`;
}
const LOG = { donate: 'вніс у касу', perk: 'купив', create: 'створив клуб', join: 'вступив', leave: 'вийшов', kick: 'виключив', role: 'змінив роль:', transfer: 'передав клуб', edit: 'змінив', invite: 'оновив запрошення', prize: 'Приз ліги:', admin: 'Адміністрація змінила' };
const EDIT = { name: 'назву', about: 'опис', tg_url: 'посилання на групу', open: 'доступ' };
const noteOf = (l) => (l.kind === 'edit' ? String(l.note || '').split(',').map((k) => EDIT[k] || k).join(', ') : l.kind === 'perk' ? `«${l.note}»` : l.note || '');
function bankHtml(c) {
  const { ic, esc } = X;
  const log = c.log.length ? `<div class="list clb-log">${c.log.map((l) => `<div class="li"><div class="grow"><span class="small">${l.who ? `<b>${esc(l.who)}</b> ` : ''}${LOG[l.kind] || esc(l.kind)}${noteOf(l) ? ' ' + esc(noteOf(l)) : ''}</span>
      <div class="tiny muted">${new Date(l.at).toLocaleString('uk-UA', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' })}</div></div>${l.amount && ['donate', 'perk', 'prize'].includes(l.kind) ? `<b class="nw ${l.kind === 'perk' ? '' : 'win'}">${l.kind === 'perk' ? '−' : '+'}${S.short(l.amount)}</b>` : ''}</div>`).join('')}</div>` : X.emptyLine('coin', 'Поки порожньо');
  return `<div class="card clb-bank"><div class="row between"><span class="muted small">Клубна каса</span><b class="clb-big">${S.fmt(c.treasury)}</b></div>
      <div class="tiny muted">Внесено ${S.short(c.donated)} · витрачено ${S.short(c.spent)}. Гроші з каси не повертаються: їх витрачають власник і офіцери на бонуси для всіх.</div>
      <div class="clb-don"><input id="clbAmt" inputmode="numeric" placeholder="Сума, від ${n0(R.donateMin)}" autocomplete="off"><button class="btn sm ghost" data-act="clubDonate">Внести</button></div>
      <div class="clb-quick">${[100000, 1000000, 10000000].map((a) => `<button class="chip" data-act="clubAmt" data-n="${a}">${S.short(a)}</button>`).join('')}</div></div>
    <div class="h2"><span>Бонуси на цей тиждень</span><span>до пн 00:00</span></div>
    <div class="tiny muted clb-hint">Ціна — за кожного учасника (мінімум за ${R.minBill}). Діють для тих, хто в клубі понад 24 год.</div>
    <div class="list">${C.PERK_KEYS.map((k) => perkRow(c, k)).join('')}</div>
    <div class="h2"><span>Історія каси</span></div>${log}`;
}

function leagueHtml(v, limit, mineId = null) {
  const { ic, esc } = X;
  const list = (v.league || []).slice(0, limit);
  const rows = list.map((r) => `<div class="lb clb-lg ${r.id === mineId ? 'me' : ''}"><span class="pl">${r.place <= 3 && r.pts > 0 ? `<span class="medal m${r.place}">${r.place}</span>` : r.place}</span>${tagBox(r.tag)}
    <span class="grow ellipsis">${esc(r.name)}<span class="tiny muted"> · ${r.members}/${R.max}</span></span>${r.prizePlace && r.prizePlace <= R.prizes.length ? `<span class="chip ok">${S.short(C.prizeOf(r.prizePlace))}</span>` : ''}<b class="nw">${n0(r.pts)}</b></div>`).join('');
  const last = v.last?.top?.length ? `<div class="tiny muted clb-hint">Минулого тижня: ${v.last.top.map((t) => `${t.place}. [${esc(t.tag)}] ${esc(t.name)}`).join(' · ')}</div>` : '';
  return `<div class="h2"><span>Ліга тижня</span><span>${ic('clock')} ${X.untilSpan(v.weekEnd)}</span></div>
    <div class="card clb-rules tiny muted">Очки за перемоги учасників: драг ${R.points.drag}, дрифт ${R.points.drift}, бос ${R.points.boss}, Заїзд дня ${R.points.dayrace} (раз на день), до ${R.dayCap} на день кожному.
      Приз у понеділок о 00:00 — кожному учаснику з ${R.prizeMinPts}+ очками в клубах, де таких щонайменше ${R.prizeMembers}: 1 місце ${S.short(R.prizes[0])}, 2 — ${S.short(R.prizes[1])}, 3 — ${S.short(R.prizes[2])}, 4–10 — ${S.short(R.prizes[3])}.</div>
    ${rows ? `<div class="list">${rows}</div>` : X.emptyLine('trophy', 'Клубів ще немає')}${last}`;
}

// ---------- sheets ----------
function createSheet() {
  const { esc } = X;
  X.sheet('Новий клуб', `<div class="clb-form">
      <label>Тег — 4 літери або цифри<input id="clbTag" maxlength="4" placeholder="ЖИГА" autocomplete="off" style="text-transform:uppercase"></label>
      <label>Назва<input id="clbName" maxlength="24" placeholder="Жигулі назавжди" autocomplete="off"></label>
      <label>Опис (необов’язково)<input id="clbAbout" maxlength="${C.ABOUT_MAX}" placeholder="Ганяємо щовечора, приймаємо всіх" autocomplete="off"></label>
      <div class="li clb-open"><div class="grow"><b>Відкритий клуб</b><div class="tiny muted">Видно в списку, вступити може будь-хто. Вимкни — лише за посиланням.</div></div><button class="toggle on" id="clbOpen" data-act="clubToggle" aria-pressed="true" aria-label="Відкритий клуб"></button></div>
      <div class="tiny muted">Тег видно поруч з іменами учасників. Змінити його потім не можна.</div>
      <button class="btn" data-act="clubCreate">Створити · ${esc(S.fmt(R.createCost))}</button></div>`);
}
function editSheet() {
  const { esc } = X, c = V.club;
  X.sheet('Налаштування клубу', `<div class="clb-form">
      <label>Назва<input id="clbName" maxlength="24" value="${esc(c.name)}" autocomplete="off"></label>
      <label>Опис<input id="clbAbout" maxlength="${C.ABOUT_MAX}" value="${esc(c.about)}" autocomplete="off"></label>
      <label>Група в Telegram (t.me/…)<input id="clbTg" maxlength="80" value="${esc(c.tg || '')}" placeholder="t.me/mygroup" autocomplete="off"></label>
      <div class="li clb-open"><div class="grow"><b>Відкритий клуб</b><div class="tiny muted">Видно в списку, вступити може будь-хто.</div></div><button class="toggle ${c.open ? 'on' : ''}" id="clbOpen" data-act="clubToggle" aria-pressed="${c.open}" aria-label="Відкритий клуб"></button></div>
      <button class="btn" data-act="clubEdit">Зберегти</button></div>`);
}
function inviteSheet() {
  const { ic, esc } = X, c = V.club, link = linkOf(c.invite);
  X.sheet('Запросити в клуб', `<div class="clb-form">
      <div class="small muted">Друг відкриє посилання — і побачить запрошення до ${esc(C.tagText(c.tag))} ${esc(c.name)}. Новачок спершу пройде перші кроки (вступ — з ${R.joinLevel}-го рівня).</div>
      ${link ? `<div class="mono clb-link">${esc(link)}</div><button class="btn" data-act="clubShare">${ic('share')} Надіслати в Telegram</button><button class="btn ghost" data-act="clubCopy">${ic('copy')} Скопіювати</button>`
        : '<div class="small muted">Посилання з’явиться після підключення бота</div>'}
      ${c.staff ? `<button class="btn outline sm" data-act="clubNewInvite">${ic('refresh')} Нове посилання (старе перестане діяти)</button>` : ''}</div>`);
}
function memberSheet(m) {
  const { ic, esc } = X, c = V.club;
  const owner = c.role === 'owner';
  const canKick = !m.me && m.role !== 'owner' && (owner || (c.role === 'officer' && m.role === 'member'));
  const btns = [
    `<button class="btn ghost" data-act="playerCard" data-id="${m.id}">${ic('users')} Профіль гравця</button>`,
    owner && !m.me && m.role === 'member' ? `<button class="btn ghost" data-act="clubRole" data-id="${m.id}" data-role="officer">Зробити офіцером</button>` : '',
    owner && m.role === 'officer' ? `<button class="btn ghost" data-act="clubRole" data-id="${m.id}" data-role="member">Зняти з офіцерів</button>` : '',
    owner && !m.me ? `<button class="btn ghost" data-act="clubTransfer" data-id="${m.id}">${ic('crown')} Передати клуб</button>` : '',
    canKick ? `<button class="btn red" data-act="clubKick" data-id="${m.id}">Виключити з клубу</button>` : '',
  ].filter(Boolean).join('');
  X.sheet(esc(m.name), `<div class="clb-form"><div class="small muted">${C.ROLES[m.role]} · ${pts(m.pts)} цього тижня${m.donated ? ` · у касу ${S.short(m.donated)}` : ''}</div>${btns}</div>`);
}

// ---------- actions ----------
const after = async (name, body, ok) => {
  const r = await X.act(name, body, ok);
  if (r) X.closeModal();
  return r;
};
const memberOf = (id) => V?.club?.members.find((m) => m.id === Number(id));
const handlers = {
  clubTab: (d) => ((X.state().clubTab = d.k), X.render()),
  clubSearch: async () => {
    const st = X.state(), q = document.getElementById('clbQ')?.value.trim() || '';
    st.clubQ = q;
    try {
      const r = await X.api('club/list', { q });
      V.list = r.list;
      X.render();
    } catch (e) {
      X.toast(e.message, true);
    }
  },
  clubJoin: async (d) => {
    const body = d.code ? { code: d.code } : { id: Number(d.id) };
    const r = await X.act('club/join', body, (x) => `Ти в клубі ${C.tagText(x.club.tag)}! Очки підуть через 24 год`);
    if (r) X.state().clubInvite = null;
  },
  clubCreateOpen: () => createSheet(),
  clubToggle: (d, el) => (el.classList.toggle('on'), el.setAttribute('aria-pressed', el.classList.contains('on'))),
  clubCreate: async () => {
    const v = (id) => document.getElementById(id)?.value || '';
    const tag = C.tagNorm(v('clbTag'));
    if (!C.TAG_RE.test(tag)) return X.toast('Тег — рівно 4 літери або цифри, напр. ЖИГА', true);
    if (!(await X.confirmBox(`Створити клуб [${tag}] за ${S.fmt(R.createCost)}? Тег змінити не можна.`))) return;
    await after('club/create', { tag, name: v('clbName'), about: v('clbAbout'), open: document.getElementById('clbOpen')?.classList.contains('on') }, `Клуб [${tag}] створено!`);
  },
  clubEditOpen: () => editSheet(),
  clubEdit: () => {
    const v = (id) => document.getElementById(id)?.value ?? '';
    const tg = v('clbTg').trim();
    if (tg && C.tgLinkNorm(tg) === null) return X.toast('Посилання на групу — лише t.me/…', true);
    return after('club/edit', { name: v('clbName'), about: v('clbAbout'), tg, open: document.getElementById('clbOpen')?.classList.contains('on') }, 'Збережено');
  },
  clubInvite: () => inviteSheet(),
  clubShare: () => {
    const c = V.club, link = linkOf(c.invite);
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`Вступай у мій автоклуб ${C.tagText(c.tag)} ${c.name} в АВТОДРОП — ганяємо разом за призи ліги 🏁`)}`;
    X.tg?.openTelegramLink ? X.tg.openTelegramLink(url) : window.open(url, '_blank');
  },
  clubCopy: () => navigator.clipboard?.writeText(linkOf(V.club.invite)).then(() => X.toast('Посилання скопійовано'), () => X.toast(linkOf(V.club.invite))),
  clubNewInvite: async () => {
    if (!(await X.confirmBox('Створити нове посилання? Старе перестане діяти.'))) return;
    const r = await X.act('club/invite', {}, 'Нове посилання готове');
    if (r) (V = { ...V, club: r.club }, inviteSheet());
  },
  clubMember: (d) => {
    const m = memberOf(d.id);
    if (!m) return;
    if (!V.club.staff && !m.me) return X.H.playerCard({ id: m.id });
    memberSheet(m);
  },
  clubRole: (d) => after('club/role', { userId: Number(d.id), role: d.role }, d.role === 'officer' ? 'Призначено офіцером' : 'Тепер учасник'),
  clubTransfer: async (d) => {
    const m = memberOf(d.id);
    if (!(await X.confirmBox(`Передати клуб гравцю ${m?.name}? Ти станеш офіцером.`))) return;
    await after('club/transfer', { userId: Number(d.id) }, 'Клуб передано');
  },
  clubKick: async (d) => {
    const m = memberOf(d.id);
    if (!(await X.confirmBox(`Виключити ${m?.name}? Його очки цього тижня згорять.`))) return;
    await after('club/kick', { userId: Number(d.id) }, 'Виключено');
  },
  clubLeave: async () => {
    const c = V.club;
    const alone = c.role === 'owner' && c.members.length === 1;
    if (c.role === 'owner' && !alone) return X.toast('Спершу передай клуб іншому учаснику (торкнись його в списку)', true);
    if (!(await X.confirmBox(alone ? `Розпустити клуб ${C.tagText(c.tag)}? Гроші в касі (${S.fmt(c.treasury)}) згорять.` : `Вийти з ${C.tagText(c.tag)}? Твої очки цього тижня згорять, внески в касу не повертаються.`))) return;
    await X.act('club/leave', {}, alone ? 'Клуб розпущено' : 'Ти вийшов з клубу');
  },
  clubAmt: (d) => {
    const el = document.getElementById('clbAmt');
    if (el) el.value = Number(d.n).toLocaleString('uk-UA');
  },
  clubDonate: async () => {
    const n = Number(String(document.getElementById('clbAmt')?.value || '').replace(/\D/g, ''));
    if (!(n >= R.donateMin)) return X.toast(`Мінімум ${S.fmt(R.donateMin)}`, true);
    if (n > X.me().balance) return X.toast('Недостатньо гривень', true);
    if (!(await X.confirmBox(`Внести ${S.fmt(n)} у клубну касу? Гроші з каси не повертаються.`))) return;
    await X.act('club/donate', { amount: n }, `+${S.fmt(n)} у касу клубу`);
  },
  clubPerk: async (d) => {
    const p = R.perks[d.perk];
    const what = d.perk === 'income' ? `${p.name} +${p.levels[Number(d.level) - 1].pct}%` : p.name;
    if (!(await X.confirmBox(`Купити «${what}» до понеділка за ${S.fmt(Number(d.cost))} з каси?`))) return;
    await X.act('club/perk', { perk: d.perk, level: Number(d.level || 1) }, `«${what}» діє до понеділка`);
  },
  clubClaim: (d) => X.act('club/claim', { kind: d.kind }, (r) => (r.fuel ? `+${r.fuel} пального` : `Ключ «${S.CASE_BY_ID[r.caseId]?.name}» — у кейсах`)),
};
