// Admin «Події»: what runs now (with «Зупинити»), the next 8 weeks as players get them (plan or weekly rotation), and the
// events scheduler — create / edit / delete planned events with Kyiv dates and a live preview of what each one does
// (S.eventPreview, the same rules as the server). Server: src/schedule.js ('schedule', 'schedule/save', 'schedule/delete',
// 'schedule/seed') and the existing 'game-events' / 'game-events/stop'.
import * as S from './shared.js';

const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
// 'YYYY-MM-DDTHH:MM' (Kyiv) → «пт 06.11 18:00»
const when = (loc) => `${WD[new Date(loc.slice(0, 10) + 'T00:00:00Z').getUTCDay()]} ${loc.slice(8, 10)}.${loc.slice(5, 7)}${loc.slice(11) === '00:00' ? '' : ' ' + loc.slice(11)}`;
const range = (a, b) => {
  // an end at 00:00 reads as the last day itself («пт 06.11 18:00 – 24:00», «сб 07.11 – нд 08.11»)
  if (b.slice(11) !== '00:00') return `${when(a)} – ${a.slice(0, 10) === b.slice(0, 10) ? b.slice(11) : when(b)}`;
  const last = S.kyivLocal(S.kyivParse(b) - 60e3).slice(0, 10);
  if (last === a.slice(0, 10)) return a.slice(11) === '00:00' ? when(a) : `${when(a)} – 24:00`;
  return `${when(a)} – ${when(last + 'T00:00')}`;
};
// «до пн 09.11 18:00»; an end at 00:00 is the end of the day before («до кінця пт 06.11»)
const endText = (loc) => (loc.slice(11) === '00:00' ? `до кінця ${when(S.kyivLocal(S.kyivParse(loc) - 60e3).slice(0, 10) + 'T00:00')}` : `до ${when(loc)}`);
let form = null; // the event being created / edited (null = the form is closed)
let last = null; // the last 'schedule' answer (kinds, countries, cases for the form)

function chip(e, esc, ic) {
  return `<span class="evp-chip" style="--c:${e.color}">${ic(e.icon)}${esc(e.title)}</span>`;
}
function formHtml(v, esc) {
  const f = form;
  const opt = (val, label, cur) => `<option value="${esc(val)}" ${String(cur) === String(val) ? 'selected' : ''}>${esc(label)}</option>`;
  return `<div class="panel evp-form" id="evpForm"><h2>${f.id ? 'Редагувати подію' : 'Нова подія'} <span class="sub">час — Київ</span></h2>
    <div class="evp-grid">
      <label class="field"><span>Тип</span><select id="evpKind">${Object.entries(v.kinds).map(([id, k]) => opt(id, k.name, f.kind)).join('')}</select></label>
      <label class="field"><span>Назва для гравців (необов’язково)</span><input id="evpTitle" maxlength="48" value="${esc(f.title || '')}" placeholder="${esc(v.kinds[f.kind]?.name || '')}"></label>
      <label class="field"><span>Початок</span><input id="evpStart" type="datetime-local" value="${esc(f.start)}" ${f.live ? 'disabled' : ''}></label>
      <label class="field"><span>Кінець</span><input id="evpEnd" type="datetime-local" value="${esc(f.end)}"></label>
      <label class="field" id="evpCountryF" ${f.kind === 'country' ? '' : 'hidden'}><span>Країна</span><select id="evpCountry">${v.countries.map((c) => opt(c.id, c.name, f.country)).join('')}</select></label>
      <label class="field" id="evpCaseF" ${f.kind === 'caseday' ? '' : 'hidden'}><span>Кейс дня</span><select id="evpCase">${v.cases.map((c) => opt(c.id, `${c.name} · ${S.short(c.price)}`, f.caseId)).join('')}</select></label>
    </div>
    <div class="evp-prev" id="evpPrev"></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn green sm" data-act="evpSave">${f.id ? 'Зберегти' : 'Запланувати'}</button><button class="btn ghost sm" data-act="evpCancel">Скасувати</button></div></div>`;
}
function previewHtml() {
  if (!form || !last) return '';
  const k = last.kinds[form.kind];
  const lines = S.eventPreview({ id: form.kind, country: form.country, caseId: form.caseId });
  const a = S.kyivParse(form.start), b = S.kyivParse(form.end);
  const h = a != null && b != null ? (b - a) / 3600e3 : null;
  const dur = h == null ? 'вкажи дати' : h <= 0 ? 'кінець раніше за початок' : h < 48 ? `${Math.round(h * 10) / 10} год` : `${Math.round((h / 24) * 10) / 10} дн`;
  return `<b style="color:${k.color}">Що зробить «${form.title || k.name}»</b> <span class="muted small">· ${dur}</span><ul>${lines.map((l) => `<li>${l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</li>`).join('')}</ul>`;
}

export async function eventsPage({ api, esc, ic }) {
  const [v, ge] = await Promise.all([api('schedule'), api('game-events')]);
  last = v;
  const act = ge.active.length ? `<table>${ge.active.map((e) => `<tr><td>${chip(e, esc, ic)}${e.planned ? ' <span class="badge">план</span>' : e.forced ? ' <span class="badge">вручну</span>' : ''}</td>
      <td class="small muted nowrap">${esc(endText(S.kyivLocal(e.end)))}</td><td class="num"><button class="btn red sm" data-act="evpStop" data-key="${esc(e.key)}" data-title="${esc(e.title)}">Зупинити</button></td></tr>`).join('')}</table>`
    : '<div class="empty">Зараз нічого не йде</div>';
  const weeks = v.weeks.map((w) => `<div class="evp-week ${w.mode}"><div class="evp-wh"><b>${esc(w.monday.slice(8, 10))}.${esc(w.monday.slice(5, 7))}</b><span class="badge ${w.mode === 'plan' ? 'green' : ''}">${w.mode === 'plan' ? 'за планом' : 'авто-ротація'}</span></div>
      ${w.events.map((e) => `<div class="evp-wrow">${chip(e, esc, ic)}<span class="small muted">${esc(range(S.kyivLocal(e.start), S.kyivLocal(e.end)))}${e.stopped ? ' · зупинено' : ''}</span></div>`).join('') || '<div class="small muted">—</div>'}</div>`).join('');
  const row = (e) => `<tr class="${e.state}"><td class="nowrap small">${esc(range(e.startLocal, e.endLocal))}${e.state === 'live' ? ' <span class="badge green">йде</span>' : ''}${e.stopped ? ' <span class="badge red">зупинено</span>' : ''}</td>
      <td>${chip(e, esc, ic)}<ul class="evp-pl">${e.preview.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></td>
      <td class="num nowrap">${e.state === 'past' ? '' : `<button class="btn ghost sm" data-act="evpEdit" data-id="${e.planId}">Змінити</button> ${e.state === 'live' ? '' : `<button class="btn ghost sm red-t" data-act="evpDel" data-id="${e.planId}" data-title="${esc(e.title)}">Видалити</button>`}`}</td></tr>`;
  const hw = v.halloween;
  return `<div class="head"><h1>Події й розклад</h1><button class="btn ghost sm" data-act="reload">${ic('refresh')} Оновити</button><button class="btn sm" data-act="evpNew">${ic('plus')} Нова подія</button></div>
    ${form ? formHtml(v, esc) : ''}
    <div class="panel"><h2>Зараз у грі <span class="sub">Київ ${esc(v.nowLocal.replace('T', ' '))} · Сезон ${v.season.id} до ${esc(when(v.season.endLocal))}</span></h2>${act}</div>
    <div class="panel"><h2>Найближчі 8 тижнів <span class="sub">тиждень з плановими подіями йде за планом, без них — за авто-ротацією</span></h2><div class="evp-weeks">${weeks}</div></div>
    <div class="panel"><h2>Розклад <span class="sub">${v.upcoming.length} запланованих · одночасно не більше ${v.caps.parallel}</span></h2>
      <div class="evp-hw small ${hw.done ? 'muted' : ''}">${ic('ghost')} «${esc(hw.name)}» ${esc(when(hw.startLocal))} – ${esc(when(hw.endLocal))} — окрема подія, вкладка «Хелловін»${hw.done ? ' · завершено' : ''}. На ці дні нічого не планується.</div>
      ${v.upcoming.length ? `<div class="tbl-wrap"><table class="evp-tbl">${v.upcoming.map(row).join('')}</table></div>` : '<div class="empty">Нічого не заплановано — йде авто-ротація</div>'}
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn ghost sm" data-act="evpSeed" ${v.defaults.missing ? '' : 'disabled'}>Типовий календар · ${v.defaults.missing ? `додати ${v.defaults.missing} з ${v.defaults.total}` : 'уже в розкладі'}</button></div>
      <p class="small muted">Події лише вмикають уже наявні механіки (S.EVENTS у межах лімітів): ціни кейсів, шанси й відсоток продажу поза ними не змінюються. Зупинити подію, що йде, — кнопкою «Зупинити» вгорі.</p></div>
    ${v.past.length ? `<details class="panel"><summary>Минулі (${v.past.length})</summary><table class="evp-tbl">${v.past.map(row).join('')}</table></details>` : ''}`;
}

export function eventsAfter({ $ }) {
  const el = $('#evpForm');
  if (!el) return;
  const sync = () => {
    form = { ...form, kind: $('#evpKind').value, title: $('#evpTitle').value.trim(), start: form.live ? form.start : $('#evpStart').value, end: $('#evpEnd').value,
      country: $('#evpCountry').value, caseId: $('#evpCase').value };
    $('#evpCountryF').hidden = form.kind !== 'country';
    $('#evpCaseF').hidden = form.kind !== 'caseday';
    $('#evpTitle').placeholder = last.kinds[form.kind]?.name || '';
    $('#evpPrev').innerHTML = previewHtml();
  };
  el.addEventListener('input', sync);
  el.addEventListener('change', sync);
  $('#evpPrev').innerHTML = previewHtml();
  el.scrollIntoView?.({ block: 'nearest' });
}

export function eventsActions({ mutate, render, esc }) {
  const nextSat = () => {
    const t = Date.now();
    let d = S.kyivDateOf(t);
    while (new Date(d + 'T00:00:00Z').getUTCDay() !== 6) d = S.kyivDateOf(S.kyivMidnightOf(d, 1));
    return d;
  };
  return {
    evpNew: () => {
      const d = nextSat();
      form = { kind: 'luck', title: '', start: `${d}T00:00`, end: `${S.kyivDateOf(S.kyivMidnightOf(d, 2))}T00:00`, country: 'JP', caseId: 'sport' };
      render();
    },
    evpEdit: (d) => {
      const e = last?.upcoming.find((x) => x.planId === Number(d.id));
      if (!e) return;
      form = { id: e.planId, kind: e.id, title: e.title === S.eventInfo({ id: e.id, country: e.country, caseId: e.caseId }).title ? '' : e.title, start: e.startLocal, end: e.endLocal,
        country: e.country || 'JP', caseId: e.caseId || 'sport', live: e.state === 'live' };
      render();
    },
    evpCancel: () => ((form = null), render()),
    evpSave: async () => {
      const f = form, k = last.kinds[f.kind];
      const body = { id: f.id, kind: f.kind, title: f.title, start: f.start, end: f.end, country: f.country, caseId: f.caseId };
      const r = await mutate('schedule/save', body, { title: f.id ? 'Змінити подію' : 'Запланувати подію', button: f.id ? 'Зберегти' : 'Запланувати',
        summary: `<b>${esc(f.title || k.name)}</b> · ${esc(f.start.replace('T', ' '))} – ${esc(f.end.replace('T', ' '))} (Київ)<div class="evp-prev">${previewHtml()}</div>` }, f.id ? 'Збережено' : 'Заплановано');
      if (r) ((form = null), render());
    },
    evpDel: (d) => mutate('schedule/delete', { id: Number(d.id) }, { title: 'Видалити подію з розкладу', danger: true, button: 'Видалити', summary: `«${esc(d.title)}» не відбудеться.` }, 'Видалено'),
    evpStop: (d) => mutate('game-events/stop', { key: d.key }, { title: 'Зупинити подію', danger: true, button: 'Зупинити', summary: `«${esc(d.title)}» закінчиться зараз; зароблене гравцями лишається.` }, 'Зупинено'),
    evpSeed: () => mutate('schedule/seed', {}, { title: 'Типовий календар на 8 тижнів', button: 'Додати', summary: 'Додасть у розклад відсутні події типового календаря (з 3.11, після Хелловіну). Те, що вже заплановано, не зміниться; події, що перетнулися б із запланованими, пропускаються.' },
      (r) => `Додано ${r.added}${r.skipped.length ? `, пропущено ${r.skipped.length}` : ''}`),
  };
}
