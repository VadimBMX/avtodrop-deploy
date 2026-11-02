// Admin «Сезон 2»: the one-shot wipe with compensation. Before it runs: the dry-run numbers (players, who gets star
// credit and how much, frames, veteran tiers, friend keys, VIP subscribers (credit only), the S1 top-10 «Легенда S1») and the guarded
// run (owner only; the phrase S.S2_RESET.phrase, the confirm dialog). After: what was given and how much credit is spent.
// Server: src/season2.js (admin 'season2', 'season2/reset').
import * as S from './shared.js';

const n = (v) => Math.round(v || 0).toLocaleString('uk-UA');

export async function season2Page({ api, esc, date, state }) {
  const v = await api('season2');
  const R = S.S2_RESET;
  const vet = S.VETERAN_S1.tiers.map((t) => `${t.name} (рівень ${t.minLevel}+): <b>${n(v.veterans?.[t.tier])}</b>`).join(' · ');
  const legends = v.legends?.length
    ? `<table><tr><th>#</th><th>Гравець</th><th class="num">Місце S${R.prevSeason}</th><th class="num">Сезонний досвід</th><th class="num">Рівень</th></tr>${v.legends.map((l) => `<tr><td>${l.rank}</td><td><a data-user="${l.id}">${esc(l.name)}</a> <span class="muted small">${l.id}</span></td><td class="num">${l.place ?? '—'}</td><td class="num">${n(l.seasonXp)}</td><td class="num">${l.level}</td></tr>`).join('')}</table>`
    : '<div class="empty">Рейтинг сезону порожній</div>';
  if (v.done) {
    const a = v.archive || {};
    return `<div class="head"><h1>Сезон ${R.season}</h1><button class="btn ghost sm" data-act="reload">Оновити</button></div>
      <div class="panel"><h2>Запущено <span class="sub">${date(v.at)}</span></h2>
        <p>Гравців в архіві S${R.prevSeason}: <b>${n(a.users)}</b> · кредит отримали: <b>${n(a.creditUsers)}</b> · видано кредиту: <b>${n(a.credit)} ⭐</b>
        · витрачено: <b>${n(a.creditSpent)} ⭐</b> · лишилось: <b>${n(a.creditLeft)} ⭐</b> · ключів за друзів: <b>${n(a.keys)}</b> · вікно компенсації побачили: <b>${n(a.seen)}</b></p></div>
      <div class="panel"><h2>Легенда S${R.prevSeason}</h2>${legends}</div>`;
  }
  const owner = state?.role === 'owner';
  return `<div class="head"><h1>Сезон ${R.season}</h1><button class="btn ghost sm" data-act="reload">Перерахувати</button></div>
    <div class="panel"><h2>Пробний прогін <span class="sub">нічого не змінює</span></h2>
      <p>Гравців: <b>${n(v.users)}</b> · гривень у грі: <b>${n(v.money)}</b> · вартість гаражів: <b>${n(v.garage)}</b></p>
      <p>Кредит зірок (${v.credit.pct}% витраченого в S${R.prevSeason}): <b>${n(v.credit.users)}</b> гравців, разом <b>${n(v.credit.total)} ⭐</b> · рамка «Меценат»: <b>${n(v.patrons)}</b></p>
      <p>«${esc(S.VETERAN_S1.title)}»: ${vet}</p>
      <p>Ключі «${esc(S.CASE_BY_ID[R.friendKey].name)}» за друзів (до ${v.friendKeys.max}): <b>${n(v.friendKeys.users)}</b> гравців, <b>${n(v.friendKeys.total)}</b> ключів · VIP-підписників (лише кредит, без днів VIP): <b>${n(v.vipSubs)}</b></p>
      <p class="small muted">Буде стерто зараз: ${Object.entries(v.wipe || {}).map(([k, c]) => `${esc(k)} ${n(c)}`).join(' · ')}</p></div>
    <div class="panel"><h2>Легенда S${R.prevSeason} <span class="sub">топ-${R.legendTop} рейтингу «Сезон»</span></h2>${legends}</div>
    <div class="panel"><h2>Запуск <span class="sub">один раз, назавжди</span></h2>
      <p class="small muted">Обнуляє прогрес усіх гравців (гроші, машини, ключі, деталі, номери, рівні, колекцію, досягнення, пропуск, стріки, вітрини, лоти й торги, бали клубів) і одразу видає компенсацію. Лишаються акаунти, друзі, клуби, платежі, бани й ролі, підтримка та ідеї. Скасувати не можна — зроби копію бази перед запуском.</p>
      ${owner ? `<div class="row" style="gap:8px;flex-wrap:wrap"><input id="s2Phrase" placeholder="Введи: ${esc(R.phrase)}" autocomplete="off" style="max-width:220px">
        <button class="btn danger" data-act="s2Run">Запустити Сезон ${R.season}</button></div>` : '<div class="empty">Запустити може лише власник</div>'}</div>`;
}

export function season2Actions({ mutate, toast }) {
  return {
    s2Run: () => {
      const phrase = document.getElementById('s2Phrase')?.value || '';
      if (phrase.trim().toUpperCase() !== S.S2_RESET.phrase) return toast(`Введи фразу «${S.S2_RESET.phrase}»`, true);
      return mutate('season2/reset', { phrase }, { title: `Запустити Сезон ${S.S2_RESET.season}?`, danger: true, button: 'Обнулити й видати компенсацію',
        summary: 'Прогрес усіх гравців буде стерто, компенсація видасться одразу. Повторно запустити не можна.' }, 'Сезон запущено');
    },
  };
}
