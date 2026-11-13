// Admin «Сезон 2»: the one-shot wipe with compensation. Before it runs: the dry-run numbers (players, who gets star
// credit and how much, frames, veteran tiers, friend keys, VIP subscribers (credit only), the S1 top-10 «Легенда S1») and the guarded
// run (owner only; the phrase S.S2_RESET.phrase, the confirm dialog). After: what was given and how much credit is spent.
// Server: src/season2.js (admin 'season2', 'season2/reset'); the «Легенда S1» cars: src/game.js 'season2/legend-cars'.
import * as S from './shared.js';

const n = (v) => Math.round(v || 0).toLocaleString('uk-UA');
const mln = (v) => S.short(Math.round(v || 0));

// r15 «Ми вас почули» (src/comeback.js, S.S1_COMEBACK): the tier preview, the «Видати» button (owner), and after the run
// what was given and how many took it. Running again gives only players who have nothing yet (e.g. unbanned since).
function comebackPanel(c, { esc, date, owner }) {
  if (!c) return '';
  const C = S.S1_COMEBACK, city = S.CASE_BY_ID[C.keyCase]?.name, prem = S.CASE_BY_ID[C.premiumCase]?.name;
  const bound = (t, i) => { const hi = C.tiers[i + 1]?.min; return hi ? `${t.min ? mln(t.min) : '0'} – ${mln(hi)}` : `≥ ${mln(t.min)}`; };
  const pv = c.preview || { tiers: [] }, g = c.granted || {};
  const pack = (money, keys, premium) => `${mln(money)} + ${n(keys)}×«${esc(city)}»${premium ? ` + ${n(premium)}×«${esc(prem)}»` : ''}`;
  const rows = C.tiers.map((t, i) => { const p = pv.tiers.find((x) => x.tier === t.tier) || { users: 0 }, gt = g.byTier?.[t.tier] || { users: 0, claimed: 0 };
    return `<tr><td>${bound(t, i)}</td><td>${pack(t.money, t.keys, t.premium)}</td><td class="num"><b>${n(p.users)}</b></td>${c.done ? `<td class="num">${n(gt.users)} / ${n(gt.claimed)}</td>` : ''}</tr>`; }).join('');
  const table = `<div style="overflow-x:auto"><table class="cb-tiers small"><tr><th>Багатство S1</th><th>Пакет</th><th class="num">${c.done ? 'Нові' : 'Гравців'}</th>${c.done ? '<th class="num">Видано / забрали</th>' : ''}</tr>${rows}
    <tr><td><b>Разом</b></td><td><b>${pack(pv.money, pv.keys, pv.premium)}</b></td><td class="num"><b>${n(pv.users)}</b></td>${c.done ? `<td class="num"><b>${n(g.users)} / ${n(g.claimed)}</b></td>` : ''}</tr></table></div>
    <p class="small muted">Багатство — гроші + вартість гаража на момент обнулення. Разом до видачі: <b>${n(pv.money)} ₴</b>, <b>${n(pv.keys)}</b> ключів «${esc(city)}»${pv.premium ? `, <b>${n(pv.premium)}</b> «${esc(prem)}»` : ''}.</p>`;
  const res = c.result ? `<p class="ok">Готово: видано <b>${n(c.result.users)}</b> гравцям · ${n(c.result.money)} ₴ · ${n(c.result.keys)} ключів · повідомлень у бот: ${n(c.result.messages)}</p>` : '';
  const done = c.done ? `<p><b>✅ Видано ${date(g.firstAt)}</b>${g.lastAt !== g.firstAt ? ` (востаннє ${date(g.lastAt)})` : ''}: <b>${n(g.users)}</b> гравців · ${n(g.money)} ₴ · ${n(g.keys)} «${esc(city)}»${g.premium ? ` · ${n(g.premium)} «${esc(prem)}»` : ''} · повідомлень у бот: ${n(g.notified)} · <b>забрали ${n(g.claimed)}</b> (${n(g.claimedMoney)} ₴)</p>` : '';
  const btn = !c.wiped ? '<div class="empty">Спершу — запуск Сезону 2 (архів Сезону 1)</div>'
    : !owner ? '<div class="empty">Видати може лише власник</div>'
      : pv.users ? `<button class="btn" data-act="cbRun" data-users="${pv.users}" data-money="${pv.money}" data-keys="${pv.keys}">${c.done ? `Видати ще ${n(pv.users)} новим` : 'Видати'}</button>` : c.done ? '<p class="small muted">Усім уже видано — повторно нічого не видається.</p>' : '<div class="empty">В архіві нікого</div>';
  return `<div class="panel" id="cbPanel"><h2>🧡 ${esc(C.title)} <span class="sub">компенсація за Сезон ${S.S2_RESET.prevSeason}, один раз на гравця</span></h2>
    <p class="small muted">Кожному з архіву Сезону 1 (крім забанених) — за багатством на момент обнулення. Гравець бачить вікно подарунка «${esc(C.title)} 🧡» і забирає кнопкою; бот надсилає одне повідомлення з кнопкою гри (крім тих, хто вимкнув бота). Гроші з’являються, лише коли гравець забирає (метрика «${esc(C.title)}»).</p>
    ${done}${res}${table}${btn}</div>`;
}
// r15 «×2 тиждень» (S.EVENTS.x2 via the scheduler, src/schedule.js 'boost' / 'boost/set').
function boostPanel(b, { date }) {
  if (!b) return '';
  const cur = b.live || b.next;
  const state = b.live ? `<p><b class="ok">● Іде</b> з ${date(b.live.start)} до <b>${date(b.live.end)}</b></p>` : b.next ? `<p><b>Заплановано</b>: ${date(b.next.start)} – ${date(b.next.end)}</p>`
    : `<p class="muted">Вимкнено${b.last ? ` · востаннє ${date(b.last.start)} – ${date(b.last.end)}` : ''}</p>`;
  return `<div class="panel" id="bstPanel"><h2>⚡ ×2 тиждень <span class="sub">гонки ×${b.moneyMult} · бізнеси ×${b.bizMult}</span></h2>
    <p class="small muted">Призи драгу, дрифту й босів ×${b.moneyMult} (внесок той самий), дохід бізнесів ×${b.bizMult} — лише за час, поки діє. З «Гоночним уїкендом» не складається. Гравці бачать значок «×2 тиждень» у гонках і бізнесах та подію в «Події».</p>
    ${state}<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><label class="small">Кінець (Київ) <input type="datetime-local" id="bstEnd" value="${b.defaultEndLocal}"></label>
    <button class="btn" data-act="bstOn">${b.live ? 'Змінити кінець' : `Увімкнути (${b.days} днів або до вказаного)`}</button>${cur ? '<button class="btn danger" data-act="bstOff">Вимкнути</button>' : ''}</div></div>`;
}

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
        <p>Гравців в архіві S${R.prevSeason}: <b>${n(a.users)}</b> · кредит отримали: <b>${n(a.creditUsers)}</b> · видано кредиту: <b>${n(a.credit)} ⭐</b>${a.prizeStars ? ` · повернуто призових: <b>${n(a.prizeStars)} ⭐</b> (${n(a.prizeUsers)} гравц.)` : ''}
        · витрачено: <b>${n(a.creditSpent)} ⭐</b> · лишилось: <b>${n(a.creditLeft)} ⭐</b> · ключів за друзів: <b>${n(a.keys)}</b> · вікно компенсації побачили: <b>${n(a.seen)}</b></p></div>
      <div class="panel"><h2>Легенда S${R.prevSeason}</h2>${legends}</div>
      <div class="panel"><h2>Машини «${esc(S.LEGEND_CAR.tag)}» <span class="sub">${esc(S.MODELS[S.LEGEND_CAR.model]?.name || S.LEGEND_CAR.model)} для топ-${S.SEASON_PRIZES.length} призових місць S${R.prevSeason}</span></h2>
        ${v.legendCarsAt ? `<p>Видано ${date(v.legendCarsAt)} — повторно нічого не видається.</p>`
          : state?.role === 'owner' ? `<p class="small muted">Назавжди: не продається і не передається. Видається один раз.</p><button class="btn" data-act="s2Legend">Видати машини «${esc(S.LEGEND_CAR.tag)}»</button>` : '<div class="empty">Видати може лише власник</div>'}</div>
      ${comebackPanel(v.comeback, { esc, date, owner: state?.role === 'owner' })}${boostPanel(v.boost, { date })}`;
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
    // r15 «Ми вас почули» (src/comeback.js 'season2/comeback'): owner only, once per player.
    cbRun: (ds) => {
      const d = ds || {};
      return mutate('season2/comeback', {}, { title: `Видати «${S.S1_COMEBACK.title}»?`, button: 'Видати',
        summary: `${Number(d.users || 0).toLocaleString('uk-UA')} гравців Сезону 1 · ${Number(d.money || 0).toLocaleString('uk-UA')} ₴ · ${Number(d.keys || 0).toLocaleString('uk-UA')} ключів «${S.CASE_BY_ID[S.S1_COMEBACK.keyCase]?.name}». Кожен отримає вікно подарунка й одне повідомлення від бота. Повторно нікому не видається.` }, 'Компенсацію видано');
    },
    bstOn: () => {
      const end = document.getElementById('bstEnd')?.value || '';
      return mutate('boost/set', { on: true, end }, { title: 'Увімкнути «×2 тиждень»?', button: 'Увімкнути',
        summary: `Призи гонок і дохід бізнесів ×2 до ${end.replace('T', ' ') || '+7 днів'} (Київ).` }, '«×2 тиждень» увімкнено');
    },
    bstOff: () => mutate('boost/set', { on: false }, { title: 'Вимкнути «×2 тиждень»?', danger: true, button: 'Вимкнути', summary: 'Множник закінчиться зараз; зароблене під час нього лишається.' }, '«×2 тиждень» вимкнено'),
    // Owner 06.11: the «Легенда S1» cars (src/game.js 'season2/legend-cars'), after the wipe, once.
    s2Legend: () => mutate('season2/legend-cars', {}, { title: `Видати «${S.LEGEND_CAR.tag}»?`, button: 'Видати',
      summary: `${S.MODELS[S.LEGEND_CAR.model]?.name || S.LEGEND_CAR.model} — кожному з топ-${S.SEASON_PRIZES.length} Сезону ${S.S2_RESET.prevSeason}. Один раз.` }, 'Машини видано'),
    s2Run: () => {
      const phrase = document.getElementById('s2Phrase')?.value || '';
      if (phrase.trim().toUpperCase() !== S.S2_RESET.phrase) return toast(`Введи фразу «${S.S2_RESET.phrase}»`, true);
      return mutate('season2/reset', { phrase }, { title: `Запустити Сезон ${S.S2_RESET.season}?`, danger: true, button: 'Обнулити й видати компенсацію',
        summary: 'Прогрес усіх гравців буде стерто, компенсація видасться одразу. Повторно запустити не можна.' }, 'Сезон запущено');
    },
  };
}
