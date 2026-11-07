// Admin «🔨 Аукціон машини» (owner 07.11; in «Номери і авто», under the plate auction): launch an auction for any model
// (default the Supra «Neon Tokyo», S.CAR_AUCTION_MODEL), start price, step, hours (48 by default); the open and finished
// auctions with leader / bids / end, the bid history, and «Скасувати» (the leader gets his bid back). Owner and admins
// only; server: src/car-auction.js. The won car is a limited one: players can trade it, the state never buys it.
import * as S from './shared.js';

export async function carAuctionPanel({ api, esc, ic, money, short, date, userLink, role }) {
  if (role === 'helper') return '';
  let v;
  try {
    v = await api('car-auction/list');
  } catch (e) {
    return `<div class="panel"><h2>🔨 Аукціон машини</h2><div class="empty bad">${esc(e.message)}</div></div>`;
  }
  const R = v.rules;
  const left = (t) => {
    const ms = Math.max(0, t - v.now), h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
    return h ? `${h} год ${m} хв` : `${m} хв`;
  };
  const st = { open: ['іде', 'green'], done: ['завершено', ''], cancelled: ['скасовано', 'red'] };
  const tm = (t) => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const hist = (a) => (a.history?.length
    ? `<details class="small"><summary>${a.bids} ставок — історія</summary>${a.history.map((b) => `<div class="row between"><span>${esc(b.name)}</span><b>${money(b.amount)}</b><span class="muted">${tm(b.at)}</span></div>`).join('')}</details>`
    : `<div class="small muted">${a.bids} ставок</div>`);
  const rows = v.list.map((a) => `<tr><td><b>${esc(a.name)}</b><div class="small muted">${esc(a.cls)} · ${esc(a.model)}${a.carId ? ` · авто #${a.carId}` : ''}</div></td>
    <td><span class="badge ${st[a.status]?.[1] || ''}">${st[a.status]?.[0] || esc(a.status)}</span></td>
    <td class="num">${a.topBid ? money(a.topBid) : `<span class="muted">старт ${short(a.startPrice)}</span>`}<div class="small muted">крок ${short(a.step)}</div></td>
    <td>${a.leaderId ? userLink({ id: a.leaderId, name: a.leader }) : '<span class="muted">—</span>'}${hist(a)}</td>
    <td class="nowrap">${a.status === 'open' ? `ще ${left(a.endsAt)}` : date(a.settledAt)}<div class="small muted">${date(a.endsAt)}${a.extended ? ` · +${Math.round(a.extended / 60e3)} хв` : ''}</div></td>
    <td>${a.status === 'open' ? `<button class="btn red sm" data-act="caCancel" data-id="${a.id}" data-name="${esc(a.name)}" data-top="${a.topBid || 0}" data-leader="${esc(a.leader || '')}">Скасувати</button>` : ''}</td></tr>`).join('');
  const models = S.ALL_MODELS.filter((m) => !m.edition);
  const opt = (m) => `<option value="${m.id}"${m.id === v.defaultModel ? ' selected' : ''}>${esc(m.name)} — ${short(m.price)}${m.secret ? (m.season ? ` (сезон ${m.season})` : ' (секретна)') : ''}</option>`;
  const nOpen = v.list.filter((a) => a.status === 'open').length;
  return `<div class="panel pa-admin ca-admin"><h2>🔨 Аукціон машини <span class="sub">відкритих ${nOpen}/${R.maxOpen}</span></h2>
    <p class="small muted">Нова машина обраної моделі виставляється на аукціон; поки він іде, у грі є картка «Наживо · Аукціон машини», а в групу йде новина. Гроші ставок зникають (стік), переможець отримує машину в гараж. <b>Лімітована машина:</b> її можна продати на ринку, виставити на аукціон гравців і обміняти, але <b>не можна продати державі</b> (продаж, покупець, трейд-ін, апгрейд). Ставка в останні ${R.antiSnipeMs / 60e3} хв відсуває кінець на ${R.antiSnipeMs / 60e3} хв від неї (разом не більше +${R.extendCapMs / 60e3} хв).</p>
    <form class="pa-form-a" id="caForm">
      <label class="field"><span>Машина</span><select id="caModel">${S.CLASS_ORDER.map((c) => `<optgroup label="Клас ${c} · ${S.CLASSES[c].name}">${models.filter((m) => m.cls === c).map(opt).join('')}</optgroup>`).join('')}</select></label>
      <label class="field"><span>Стартова ціна, ₴</span><input id="caStart" inputmode="numeric" value="${R.startDefault.toLocaleString('uk-UA')}" autocomplete="off"></label>
      <label class="field"><span>Крок, ₴</span><input id="caStep" inputmode="numeric" value="${R.stepDefault.toLocaleString('uk-UA')}" autocomplete="off"></label>
      <label class="field"><span>Тривалість, год (${String(R.hoursMin).replace('.', ',')}–${R.hoursMax})</span><input id="caHours" inputmode="decimal" value="${R.hoursDefault}" autocomplete="off"></label>
    </form>
    <div class="row end"><button class="btn" data-act="caCreate" ${nOpen >= R.maxOpen ? 'disabled' : ''}>${ic('car')} Запустити аукціон машини</button></div>
    ${rows ? `<div class="tbl-wrap"><table class="stack"><tr><th>Машина</th><th>Статус</th><th class="num">Ставка</th><th>Лідер · ставки</th><th>Кінець</th><th></th></tr>${rows}</table></div>` : '<div class="empty">Аукціонів машин ще не було</div>'}</div>`;
}

const num = (sel) => Number(String(document.querySelector(sel)?.value || '').replace(/[^\d]/g, '')) || 0;

export function carAuctionActions({ mutate, toast, esc, money }) {
  return {
    caCreate: () => {
      const model = document.querySelector('#caModel')?.value, startPrice = num('#caStart'), step = num('#caStep');
      const hours = Number(String(document.querySelector('#caHours')?.value || '').replace(',', '.'));
      const m = S.MODELS[model];
      if (!m) return toast('Обери машину', true);
      if (!startPrice || !step) return toast('Вкажи стартову ціну і крок', true);
      if (!Number.isFinite(hours) || hours <= 0) return toast('Вкажи тривалість у годинах', true);
      return mutate('car-auction/create', { model, startPrice, step, hours },
        { title: 'Запустити аукціон машини', button: 'Запустити',
          summary: `<b>${esc(m.name)}</b> · старт ${money(startPrice)} · крок ${money(step)} · ${esc(String(hours).replace('.', ','))} год<div class="small muted">У грі з’явиться картка для всіх гравців, у групу піде новина. Переможець отримає лімітовану машину: продати можна лише гравцям.</div>` },
        () => `Аукціон ${m.name} запущено`);
    },
    caCancel: (d) => mutate('car-auction/cancel', { id: Number(d.id) },
      { title: `Скасувати аукціон ${d.name}`, danger: true, button: 'Скасувати аукціон',
        summary: Number(d.top) ? `Лідер ${esc(d.leader)} отримає назад ${money(Number(d.top))}. Машину ніхто не отримає.` : 'Ставок ще не було. Машину ніхто не отримає.' }, 'Аукціон скасовано'),
  };
}
