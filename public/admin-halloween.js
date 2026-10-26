// Admin «Хелловін»: when «Ніч Хелловіну» runs (calendar 29.10 00:00 – 2.11 23:59 Kyiv), the switch (за календарем /
// увімкнути зараз / вимкнути) and what players got. Server: src/halloween.js (admin 'halloween', 'halloween/mode').
// Dates in Kyiv time, whatever the admin's computer is set to.
const kyiv = (t) => new Date(t).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const MODE_TEXT = { auto: 'за календарем', on: 'увімкнено вручну', off: 'вимкнено вручну' };

export async function halloweenPage({ api, esc, date }) {
  const v = await api('halloween');
  const btn = (m, label, cls) => `<button class="btn sm ${cls}" data-act="hwMode" data-mode="${m}" ${v.mode === m ? 'disabled' : ''}>${label}</button>`;
  return `<div class="head"><h1>Ніч Хелловіну</h1><button class="btn ghost sm" data-act="reload">Оновити</button></div>
    <div class="panel"><h2>Режим <span class="sub">${v.on ? 'подія йде' : 'подія не йде'} · ${MODE_TEXT[v.mode]}</span></h2>
      <p class="small muted">За календарем подія йде з ${kyiv(v.start)} до ${kyiv(v.end - 60e3)} (Київ). «Увімкнути зараз» — запустити поза датами (напр. продовжити), «Вимкнути» — зупинити. Зароблене гравцями (рамка, тиражний «№ 13», ключі) не забирається. Лоти «Контейнер з привидом» без ставок знімаються, живі торги доходять до кінця. Ціни й шанси кейсів подія не змінює.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">${btn('auto', 'За календарем', 'ghost')}${btn('on', 'Увімкнути зараз', 'green')}${btn('off', 'Вимкнути', 'red')}</div></div>
    <div class="panel"><h2>Завдання ${esc(v.key)} <span class="sub">гравців з прогресом: ${v.players}</span></h2>
      <table><tr><th>Завдання</th><th class="num">Виконали</th></tr>${v.tasks.map((t) => `<tr><td>${esc(t.text)}</td><td class="num">${t.done}</td></tr>`).join('')}</table>
      <div class="small muted" style="margin-top:8px">Рамок «Гарбуз» у гравців: ${v.frames} · тиражних «№ 13» у грі: ${v.editions} · виграно «Контейнерів з привидом»: ${v.ghostLots}</div></div>
    <div class="panel"><h2>Журнал</h2>${v.history.length ? `<table>${v.history.map((h) => `<tr><td class="small nowrap muted">${date(h.at)}</td><td>${esc(h.admin)}</td><td>${esc(MODE_TEXT[h.details?.mode] || '')}</td></tr>`).join('')}</table>` : '<div class="empty">Перемикань ще не було</div>'}</div>`;
}

export function halloweenActions({ mutate }) {
  return {
    hwMode: (d) => mutate('halloween/mode', { mode: d.mode }, { title: `Ніч Хелловіну: ${MODE_TEXT[d.mode]}`, danger: d.mode === 'off', button: 'Застосувати',
      summary: d.mode === 'on' ? 'Подія запуститься зараз, незалежно від дат.' : d.mode === 'off' ? 'Подія зупиниться; зароблене лишається у гравців.' : 'Подія йтиме за календарем (29.10–2.11).' }, 'Режим змінено'),
  };
}
