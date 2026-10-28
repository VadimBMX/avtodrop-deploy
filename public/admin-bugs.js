// Admin «🐞 Нагорода за баг»: the reward chooser (support ticket / player card), the «Знайдені баги» list and the
// counter for the player card. Server: src/bugbounty.js (admin 'bug-reward', 'bugs'); presets in public/bounty.js.
import * as S from './shared.js';
import * as B from './bounty.js';

const caseName = (id) => S.CASE_BY_ID[id]?.name || id;
const keysText = (keys) => (keys || []).map((k) => `${k.count} × ключ «${caseName(k.caseId)}»`).join(' + ');
export const bugRewardText = (money, keys) => [money ? S.fmt(money) : '', keysText(keys)].filter(Boolean).join(' + ') || '—';
const presetName = (p) => (p === B.BUG_CUSTOM ? 'Своя нагорода' : B.BUG_PRESETS[p]?.name || p);

// The «🐞 Нагорода за баг» button and, once opened, the three presets + a custom amount.
// `user` = { id, name }; `ticket` = the support message id (or null on the player card); `done` = the reward already
// given for this ticket (then just a mark).
export function bugChooser({ esc, user, ticket = null, done = null }) {
  if (done) return `<div class="bb-done small">🐞 <b>Нагороджено</b>: ${esc(presetName(done.preset))} · ${esc(S.short(done.money || 0))}</div>`;
  const k = ticket ? `t${ticket}` : `u${user.id}`;
  const data = `data-k="${k}" data-uid="${user.id}" data-name="${esc(user.name)}"${ticket ? ` data-ticket="${ticket}"` : ''}`;
  return `<div class="bb-box" id="bb-${k}">
    <button class="btn ghost sm bb-open" data-act="bugOpen" data-k="${k}">🐞 Нагорода за баг</button>
    <div class="bb-pick" hidden>
      <div class="bb-presets">${Object.entries(B.BUG_PRESETS).map(([p, v]) => `<button class="btn ghost sm bb-pre bb-${p}" data-act="bugPreset" data-p="${p}" ${data}>
        <b>${esc(v.name)}</b><span>${esc(bugRewardText(v.money, v.keys))}</span></button>`).join('')}</div>
      <div class="bb-custom row">
        <input class="grow" id="bbAmt-${k}" inputmode="decimal" placeholder="Своя сума: 500k, 2m">
        <select id="bbCase-${k}">${S.CASES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <input id="bbCnt-${k}" inputmode="numeric" placeholder="ключів" style="width:72px">
        <button class="btn ghost sm" data-act="bugPreset" data-p="${B.BUG_CUSTOM}" ${data}>Видати</button>
      </div>
      <input id="bbNote-${k}" maxlength="300" placeholder="Що знайшов (необов’язково) — у список «Знайдені баги» і гравцю">
    </div></div>`;
}

// One line for «Профіль і статистика» on the admin player card.
export const bugCardLine = (bugs, esc) => `<div><span>🐞 Знайдено багів</span><b>${bugs?.count || 0}${bugs?.badge ? ` <span class="badge blue">${esc(bugs.badge)}</span>` : ''}</b></div>`;

// «Знайдені баги»: every reward, newest first.
export async function bugsPage({ api, esc, date, userLink, offset = 0 }) {
  const v = await api('bugs', { offset });
  const t = v.total;
  const top = v.top.length ? v.top.map((r) => `${r.user ? userLink(r.user) : '—'} <b>${r.n}</b>`).join(' · ') : '—';
  const rows = v.list.map((r) => `<tr><td class="small nowrap">${date(r.at)}</td><td>${r.user ? userLink(r.user) : '—'}<div class="small muted">знахідок: ${r.count}</div></td>
    <td><span class="badge ${r.preset === 'serious' ? 'red' : r.preset === 'useful' ? 'amber' : ''}">${esc(presetName(r.preset))}</span><div class="small muted">${esc(bugRewardText(r.money, r.keys))}</div></td>
    <td class="small">${r.note ? esc(r.note) : ''}${r.ticket ? `<div><a data-act="bugTicket" data-id="${r.ticket.id}">звернення #${r.ticket.id}</a> <span class="muted">${esc(r.ticket.text)}</span></div>` : '<div class="muted">з картки гравця</div>'}</td>
    <td class="small muted hide-m">${esc(r.admin)}</td></tr>`).join('');
  return `<div class="head"><h1>🐞 Знайдені баги</h1><button class="btn ghost sm" data-act="reload">Оновити</button></div>
    <div class="panel"><h2>Підсумок <span class="sub">нагород ${t.n} · гравців ${t.players} · виплачено ${esc(S.short(t.money))}</span></h2>
      <p class="small muted">Нагороджувати — у «Підтримці» (кнопка під зверненням) або в картці гравця → Керування. Значок «Тестувальник» дається за 1 знахідку, «Головний тестувальник» — за 5.</p>
      <div class="small">Топ тестувальників: ${top}</div></div>
    <div class="panel">${rows ? `<div class="tbl-wrap"><table><tr><th>Коли</th><th>Гравець</th><th>Нагорода</th><th>Що знайшов</th><th class="hide-m">Хто видав</th></tr>${rows}</table></div>`
      : '<div class="empty">Ще нікого не нагороджено</div>'}</div>`;
}

export function bugsActions({ mutate, toast, go, state, esc, $ }) {
  // "1 000 000", "1.5m", "250k" → number (the same rules as the panel's money field).
  const parse = (v) => {
    const s = String(v || '').trim().toLowerCase().replace(/[\s_]/g, '').replace(',', '.');
    const m = /^(\d+(?:\.\d+)?)(k|к|m|м)?$/.exec(s);
    return !s ? 0 : m ? Math.round(Number(m[1]) * ({ k: 1e3, к: 1e3, m: 1e6, м: 1e6 }[m[2]] || 1)) : NaN;
  };
  return {
    bugOpen: (d) => {
      const box = $(`#bb-${d.k}`);
      const pick = box && $('.bb-pick', box);
      if (pick) pick.hidden = !pick.hidden;
    },
    bugPreset: (d) => {
      const body = { id: Number(d.uid), preset: d.p, note: $(`#bbNote-${d.k}`)?.value.trim() || '' };
      if (d.ticket) body.ticket = Number(d.ticket);
      let money, keys;
      if (d.p === B.BUG_CUSTOM) {
        money = parse($(`#bbAmt-${d.k}`)?.value);
        const n = parse($(`#bbCnt-${d.k}`)?.value);
        if (!Number.isFinite(money) || !Number.isFinite(n)) return toast('Сума або кількість ключів — числом', true);
        if (money > B.BUG_CUSTOM_MAX) return toast(`Не більше ${S.fmt(B.BUG_CUSTOM_MAX)}`, true);
        if (n > B.BUG_KEYS_MAX) return toast(`Не більше ${B.BUG_KEYS_MAX} ключів`, true);
        keys = n ? [{ caseId: $(`#bbCase-${d.k}`).value, count: n }] : [];
        if (!money && !keys.length) return toast('Вкажи суму або ключі', true);
        Object.assign(body, { amount: money, caseId: keys[0]?.caseId, count: n });
      } else ({ money, keys } = B.BUG_PRESETS[d.p]);
      const what = bugRewardText(money, keys);
      mutate('bug-reward', body, {
        title: `🐞 Нагорода за баг · ${presetName(d.p)}`, button: 'Нагородити',
        summary: `<b>${esc(d.name)}</b> <span class="muted small">${esc(d.uid)}</span> отримає <b class="win">${esc(what)}</b>
          <div class="small muted">Вікно в грі й повідомлення в боті «Дякуємо за знайдений баг 🐞 +…»${d.ticket ? `, і та ж відповідь у звернення #${esc(d.ticket)}` : ''}. Лічильник знахідок +1 (значок «Тестувальник» з 1-ї, «Головний» з 5-ї).</div>`,
      }, (r) => `Нагороджено · знахідок: ${r.count}${r.badge ? ` · значок «${r.badge}»` : ''}`);
    },
    // From «Знайдені баги» to the ticket in «Підтримка» (all messages, scrolled to it).
    bugTicket: (d) => {
      state.supOpen = false;
      go('support');
      let tries = 0;
      const find = () => {
        const el = document.getElementById(`sup${d.id}`);
        if (el) return el.scrollIntoView({ block: 'center' }), el.classList.add('bb-hl');
        if (++tries < 40) setTimeout(find, 100);
      };
      find();
    },
  };
}
