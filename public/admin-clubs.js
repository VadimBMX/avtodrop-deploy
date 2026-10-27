// Admin «Автоклуби»: every club with its league points, members and treasury, the last settled weeks, and the tools for
// a club breaking the rules (reset tag / name / description / group link, disband). Server: src/clubs.js (admin 'clubs').
import * as S from './shared.js';

const WHAT = { tag: 'тег', name: 'назву', about: 'опис', tg: 'посилання на групу' };

export async function clubsPage({ api, esc, date, userLink }) {
  const v = await api('clubs');
  const t = v.totals;
  const rows = v.clubs.map((c) => `<tr><td><b>[${esc(c.tag)}]</b> ${esc(c.name)}<div class="small muted">${userLink(c.owner)} · ${c.open ? 'відкритий' : 'за запрошенням'}${c.tg ? ` · ${esc(c.tg)}` : ''}</div>${c.about ? `<div class="small muted">${esc(c.about)}</div>` : ''}</td>
    <td class="num">${c.members}</td><td class="num">${c.pts}${c.prizePlace ? `<div class="small muted">приз. ${c.prizePlace}</div>` : ''}</td><td class="num">${S.short(c.treasury)}<div class="small muted">внес. ${S.short(c.donated)} · витр. ${S.short(c.spent)}</div></td>
    <td class="nowrap">${['tag', 'name', 'about', 'tg'].map((w) => `<button class="btn ghost sm" data-act="clubReset" data-id="${c.id}" data-what="${w}" data-tag="${esc(c.tag)}">${w === 'tg' ? 'група' : WHAT[w]}</button>`).join(' ')}
      <button class="btn red sm" data-act="clubDisband" data-id="${c.id}" data-tag="${esc(c.tag)}">розпустити</button></td></tr>`).join('');
  const weeks = v.weeks.length ? `<table><tr><th>Тиждень</th><th>Топ</th><th class="num">Виплачено</th></tr>${v.weeks.map((w) => `<tr><td class="nowrap">${esc(w.week)}<div class="small muted">${date(w.at)}</div></td>
    <td class="small">${(w.top || []).map((x) => `${x.place}. [${esc(x.tag)}] ${x.pts} оч. · ${x.paid}×${S.short(x.prize)}`).join('<br>') || '—'}</td><td class="num">${S.short(w.paid || 0)}</td></tr>`).join('')}</table>` : '<div class="empty">Ще жоден тиждень не підбито</div>';
  return `<div class="head"><h1>Автоклуби</h1><button class="btn ghost sm" data-act="reload">Оновити</button></div>
    <div class="panel"><h2>Підсумок <span class="sub">клубів ${t.n} · учасників ${v.members}</span></h2>
      <p class="small muted">У касах зараз ${S.short(t.treasury)} · внесено за весь час ${S.short(t.donated)} · витрачено на бонуси ${S.short(t.spent)}. Гроші з кас не повертаються (стік). Ліга підбивається в понеділок о 00:00 (Київ).</p></div>
    <div class="panel"><h2>Клуби</h2>${rows ? `<div class="tbl-wrap"><table><tr><th>Клуб</th><th class="num">Людей</th><th class="num">Очки тижня</th><th class="num">Каса</th><th></th></tr>${rows}</table></div>` : '<div class="empty">Клубів ще немає</div>'}</div>
    <div class="panel"><h2>Ліга: останні тижні</h2>${weeks}</div>`;
}

export function clubsActions({ mutate }) {
  return {
    clubReset: (d) => mutate('clubs/reset', { id: Number(d.id), what: d.what }, { title: `[${d.tag}]: скинути ${WHAT[d.what]}`, button: 'Скинути',
      summary: 'Замінимо на нейтральне значення, власник отримає сповіщення. Клуб, учасники й каса лишаються.' }, 'Скинуто'),
    clubDisband: (d) => mutate('clubs/disband', { id: Number(d.id) }, { title: `Розпустити клуб [${d.tag}]`, danger: true, button: 'Розпустити',
      summary: 'Усі учасники вийдуть із клубу, гроші в касі згорять, очки тижня зникнуть. Скасувати не можна.' }, 'Клуб розпущено'),
  };
}
