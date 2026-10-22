// Admin «Заїзд дня»: the car of each of the next 30 days (an admin can pick another one; today only while nobody has
// started), today's board with the flagged near-perfect runs and disqualification until midnight, the settled days.
// Server: src/dayrace.js (admin 'dayrace', 'dayrace/set', 'dayrace/dq'); the schedule itself: public/dayrace.js.
import * as S from './shared.js';
import * as D from './dayrace.js';
import { carArt } from './car.js';

const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const wd = (day) => WD[new Date(day + 'T12:00:00Z').getUTCDay()];
const name = (esc, id) => esc(S.MODELS[id]?.name || id);

export async function dayRacePage({ api, esc, cls, userLink }) {
  const v = await api('dayrace');
  const m = S.MODELS[v.schedule[0].model];
  let place = 0;
  const rows = v.top.map((r) => {
    const off = r.dq || r.banned;
    if (!off) place++;
    return `<tr class="${off ? 'muted' : ''}"><td class="num">${off ? '—' : place}</td><td>${userLink(r)}</td><td class="num nowrap">${D.fmtTime(r.time)} с</td>
      <td>${r.flag ? '<span class="badge amber" title="Майже ідеальний заїзд">⚑ глянути</span>' : ''}${r.dq ? ' <span class="badge red">знято</span>' : ''}${r.banned ? ' <span class="badge red">бан</span>' : ''}</td>
      <td class="right"><button class="btn ghost sm" data-act="drDq" data-day="${v.today}" data-id="${r.id}" data-name="${esc(r.name)}" data-dq="${r.dq ? 0 : 1}">${r.dq ? 'Повернути' : 'Зняти'}</button></td></tr>`;
  }).join('');
  const today = `<div class="panel"><h2>Сьогодні · ${D.dayLabel(v.today)} <span class="sub">у таблиці ${v.total} · почали ${v.tries.n} · спроб ${v.tries.runs}</span></h2>
    <div class="row" style="gap:12px;align-items:center;margin-bottom:10px"><span class="dr-adm-art">${carArt(m.id)}</span>
      <div><b>${name(esc, m.id)}</b> ${cls(m.cls)}<div class="muted small">${v.locked ? 'Заїзди вже йдуть — машину дня не змінити' : 'Ще ніхто не стартував — машину можна змінити'}</div></div></div>
    ${v.top.length ? `<div class="tbl-wrap"><table><tr><th class="num">#</th><th>Гравець</th><th class="num">Час</th><th></th><th></th></tr>${rows}</table></div>` : '<div class="empty">Ще ніхто не проїхав</div>'}
    <p class="small muted">⚑ — час у межах ${String(D.DAYRACE.flagMargin).replace('.', ',')} с від ідеального заїзду цієї машини (реакція 0,10 с і 4 ідеальні перемикання). Таке можливо, але варто глянути на гравця. Зняти результат можна до опівночі; після підсумку день не змінюється. Нагороди за місця — коли проїхали щонайменше ${D.DAYRACE.minField}.</p></div>`;
  const picks = D.CARS.map((id) => `<option value="${id}">${name(esc, id)} · ${S.MODELS[id].cls}</option>`).join('');
  const others = S.CLASS_ORDER.map((c) => {
    const list = S.ALL_MODELS.filter((x) => x.cls === c && !x.secret && !D.CARS.includes(x.id));
    return list.length ? `<optgroup label="Інші · клас ${c}">${list.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const sched = v.schedule.map((s, i) => {
    const mm = S.MODELS[s.model];
    const fixed = i === 0 && v.locked;
    return `<tr><td class="nowrap">${D.dayLabel(s.day)} <span class="muted small">${wd(s.day)}${i === 0 ? ' · сьогодні' : ''}</span></td><td>${cls(mm?.cls || 'D')} ${name(esc, s.model)}${s.by ? ' <span class="badge amber">вибрано вручну</span>' : ''}</td>
      <td class="right">${s.by && !fixed ? `<button class="btn ghost sm" data-act="drClear" data-day="${s.day}">Як за розкладом</button>` : ''}</td></tr>`;
  }).join('');
  const schedule = `<div class="panel"><h2>Розклад на 30 днів <span class="sub">${D.CARS.length} машин у добірці, кожна раз за цикл</span></h2>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <select id="drDay">${v.schedule.map((s, i) => `<option value="${s.day}" ${i === 0 && v.locked ? 'disabled' : ''} ${i === 1 ? 'selected' : ''}>${D.dayLabel(s.day)} ${wd(s.day)}${i === 0 ? ' (сьогодні)' : ''}</option>`).join('')}</select>
      <select id="drModel"><optgroup label="Добірка заїзду дня">${picks}</optgroup>${others}</select>
      <button class="btn sm" data-act="drSet">Призначити</button></div>
    <div class="tbl-wrap"><table>${sched}</table></div></div>`;
  const past = `<div class="panel"><h2>Підсумовані дні</h2>${v.past.length ? `<div class="tbl-wrap"><table><tr><th>День</th><th>Машина</th><th class="num">Проїхали</th></tr>
    ${v.past.map((p) => `<tr><td>${D.dayLabel(p.day)}</td><td>${name(esc, p.model)}</td><td class="num">${p.total}</td></tr>`).join('')}</table></div>` : '<div class="empty">Ще жодного</div>'}</div>`;
  return `<div class="head"><h1>Заїзд дня</h1></div><div class="grid2 dr-adm">${today}${schedule}<div class="wide">${past}</div></div>`;
}

// Panel buttons: every change goes through the confirm dialog with a reason (server: ADMIN_MUTATING).
export function dayRaceActions({ mutate, esc, $ }) {
  return {
    drSet: () => {
      const day = $('#drDay').value, model = $('#drModel').value;
      return mutate('dayrace/set', { day, model }, { title: 'Машина заїзду дня', button: 'Призначити',
        summary: `<div>${esc(D.dayLabel(day))}: <b>${name(esc, model)}</b></div><div class="small muted">Усі гравці того дня їдуть на ній у заводському вигляді.</div>` }, 'Розклад змінено');
    },
    drClear: (d) => mutate('dayrace/set', { day: d.day, model: null }, { title: 'Повернути машину за розкладом', button: 'Повернути',
      summary: `<div>${esc(D.dayLabel(d.day))}: <b>${name(esc, D.scheduledCar(d.day))}</b></div>` }, 'Розклад змінено'),
    drDq: (d) => mutate('dayrace/dq', { day: d.day, id: Number(d.id), dq: d.dq === '1' }, { title: d.dq === '1' ? 'Зняти результат із заїзду дня' : 'Повернути результат', danger: d.dq === '1',
      button: d.dq === '1' ? 'Зняти' : 'Повернути', summary: `<div>${esc(d.name)} (${esc(d.id)}) · ${esc(D.dayLabel(d.day))}</div><div class="small muted">Знятий результат не бере участі в таблиці й нагородах цього дня.</div>` },
    d.dq === '1' ? 'Результат знято' : 'Результат повернуто'),
  };
}
