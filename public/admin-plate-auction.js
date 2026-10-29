// Admin «🔨 Аукціон номера» (in «Номери і авто»): launch an auction for a free plate (номер, стартова ціна, крок,
// тривалість у годинах) with a live preview, the open and finished auctions with leader / bids / end, and «Скасувати»
// (the leader gets his bid back). Owner and admins only; server: src/plate-auction.js.
import * as S from './shared.js';

let prevTimer = null;

export async function plateAuctionPanel({ api, esc, ic, plate, money, short, date, userLink, role }) {
  if (role === 'helper') return '';
  let v;
  try {
    v = await api('plate-auction/list');
  } catch (e) {
    return `<div class="panel"><h2>🔨 Аукціон номера</h2><div class="empty bad">${esc(e.message)}</div></div>`;
  }
  const R = v.rules;
  const left = (t) => {
    const ms = Math.max(0, t - v.now), h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
    return h ? `${h} год ${m} хв` : `${m} хв`;
  };
  const st = { open: ['іде', 'green'], done: ['завершено', ''], cancelled: ['скасовано', 'red'] };
  const rows = v.list.map((a) => `<tr><td>${plate(a.text)}<div class="small muted">${esc(a.cls)} · ${esc(a.label)}</div></td>
    <td><span class="badge ${st[a.status]?.[1] || ''}">${st[a.status]?.[0] || esc(a.status)}</span></td>
    <td class="num">${a.topBid ? money(a.topBid) : `<span class="muted">старт ${short(a.startPrice)}</span>`}<div class="small muted">крок ${short(a.step)}</div></td>
    <td>${a.leaderId ? userLink({ id: a.leaderId, name: a.leader }) : '<span class="muted">—</span>'}<div class="small muted">${a.bids} ставок</div></td>
    <td class="nowrap">${a.status === 'open' ? `ще ${left(a.endsAt)}` : date(a.settledAt)}<div class="small muted">${date(a.endsAt)}${a.extended ? ` · +${Math.round(a.extended / 60e3)} хв` : ''}</div></td>
    <td>${a.status === 'open' ? `<button class="btn red sm" data-act="paCancel" data-id="${a.id}" data-text="${esc(a.text)}" data-top="${a.topBid || 0}" data-leader="${esc(a.leader || '')}">Скасувати</button>` : ''}</td></tr>`).join('');
  return `<div class="panel pa-admin"><h2>🔨 Аукціон номера <span class="sub">відкритих ${v.list.filter((a) => a.status === 'open').length}/${R.maxOpen}</span></h2>
    <p class="small muted">Вільний номер виставляється на аукціон; поки він іде, у грі з’являється вкладка, банер і одноразове вікно, а в групу йде новина. Гроші ставок зникають (стік), переможець отримує номер на склад. Ставка в останні ${R.antiSnipeMs / 60e3} хв відсуває кінець на ${R.antiSnipeMs / 60e3} хв від неї (разом не більше +${R.extendCapMs / 60e3} хв).</p>
    <form class="pa-form-a" id="paForm">
      <label class="field"><span>Номер</span><input id="paText" placeholder="AA 7777 AA (можна кирилицею)" autocomplete="off"></label>
      <label class="field"><span>Стартова ціна, ₴</span><input id="paStart" inputmode="numeric" placeholder="напр. 1 000 000" autocomplete="off"></label>
      <label class="field"><span>Крок, ₴</span><input id="paStep" inputmode="numeric" placeholder="напр. 50 000" autocomplete="off"></label>
      <label class="field"><span>Тривалість, год (${String(R.hoursMin).replace('.', ',')}–${R.hoursMax})</span><input id="paHours" inputmode="decimal" value="24" autocomplete="off"></label>
    </form>
    <div class="pa-prev" id="paPrev"><span class="muted small">Введи номер — тут буде прев’ю і перевірка, чи він вільний</span></div>
    <div class="row end"><button class="btn" data-act="paCreate" id="paCreate" disabled>${ic('license')} Запустити аукціон</button></div>
    ${rows ? `<div class="tbl-wrap"><table class="stack"><tr><th>Номер</th><th>Статус</th><th class="num">Ставка</th><th>Лідер</th><th>Кінець</th><th></th></tr>${rows}</table></div>` : '<div class="empty">Аукціонів ще не було</div>'}</div>`;
}

const num = (sel) => Number(String(document.querySelector(sel)?.value || '').replace(/[^\d]/g, '')) || 0;

export function plateAuctionAfter({ api, esc, plate, money }) {
  const inp = document.querySelector('#paText');
  if (!inp) return;
  const btn = document.querySelector('#paCreate'), out = document.querySelector('#paPrev');
  const check = () => {
    clearTimeout(prevTimer);
    btn.disabled = true;
    const raw = inp.value.trim();
    if (raw.length < 8) return void (out.innerHTML = '<span class="muted small">Введи номер — тут буде прев’ю і перевірка, чи він вільний</span>');
    prevTimer = setTimeout(async () => {
      try {
        const r = await api('check-plate', { text: raw });
        if (inp.value.trim() !== raw) return;
        const [lo, hi] = S.PLATE_VALUE[r.cls] || [0, 0];
        const value = Math.round((lo + hi) / 2 / 100) * 100, dealer = Math.floor(value * 0.5);
        const bad = r.error || (r.owner ? `Уже має ${esc(r.owner.name)}` : r.auction ? 'Цей номер уже на аукціоні' : '');
        out.innerHTML = `<div class="verdict ${bad ? 'taken' : 'free'}">${plate(r.text)}<div><b class="${bad ? 'bad' : 'win'}">${bad ? (r.error ? esc(r.error) : bad) : 'Вільний — можна виставляти'}</b>
          ${r.error ? '' : `<div class="small">${esc(r.cls)} · ${esc(r.label)} · ${esc(r.region || '')} · вартість для переможця ${money(value)} · мін. старт ${money(dealer)} (ціна дилера)</div>`}</div></div>`;
        btn.disabled = !!bad;
        btn.dataset.text = r.text;
        btn.dataset.min = String(dealer);
        const s = document.querySelector('#paStart');
        if (!bad && !num('#paStart')) s.value = dealer.toLocaleString('uk-UA');
        const stp = document.querySelector('#paStep');
        if (!bad && !num('#paStep')) { const raw = dealer / 20, mag = 10 ** Math.floor(Math.log10(Math.max(100, raw))); stp.value = Math.max(100, Math.round(raw / mag) * mag).toLocaleString('uk-UA'); }
      } catch (e) {
        out.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
      }
    }, 250);
  };
  inp.addEventListener('input', check);
}

export function plateAuctionActions({ mutate, toast, esc, plate, money }) {
  return {
    paCreate: (d, el) => {
      const text = el.dataset.text, startPrice = num('#paStart'), step = num('#paStep');
      const hours = Number(String(document.querySelector('#paHours')?.value || '').replace(',', '.'));
      if (!text) return toast('Спершу введи вільний номер', true);
      if (!startPrice || !step) return toast('Вкажи стартову ціну і крок', true);
      if (startPrice < Number(el.dataset.min || 0)) return toast(`Стартова ціна — не менше ${money(Number(el.dataset.min))}`, true);
      return mutate('plate-auction/create', { text, startPrice, step, hours },
        { title: 'Запустити аукціон номера', button: 'Запустити',
          summary: `${plate(text)} · старт ${money(startPrice)} · крок ${money(step)} · ${esc(String(hours).replace('.', ','))} год<div class="small muted">У грі з’явиться вкладка й вікно для всіх гравців, у групу піде новина.</div>` },
        (r) => `Аукціон ${r.auction.text} запущено`);
    },
    paCancel: (d) => mutate('plate-auction/cancel', { id: Number(d.id) },
      { title: `Скасувати аукціон ${d.text}`, danger: true, button: 'Скасувати аукціон',
        summary: Number(d.top) ? `Лідер ${esc(d.leader)} отримає назад ${money(Number(d.top))}. Номер ніхто не отримає.` : 'Ставок ще не було. Номер ніхто не отримає.' }, 'Аукціон скасовано'),
  };
}
