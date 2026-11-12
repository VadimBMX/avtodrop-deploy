// Admin «Аналітика для Claude» (docs/INSIGHT.md, src/insight.js): the owner issues a read-only key for Claude, sees it
// once (copy button), lists the keys with last use, and switches a key off. Owner and admins only. The key opens only
// /api/insight/* — anonymized analytics, the players' chat and support — never the admin panel or the game.
let shown = null; // { token, label } — the plaintext of the key just issued, kept only in this page until hidden

export async function insightPage({ api, esc, date, ic }) {
  const v = await api('insight');
  const origin = location.origin;
  const keyBox = shown ? `<div class="panel ins-new"><h2>${ic('key')} Новий ключ «${esc(shown.label)}»</h2>
      <p class="small"><b>Скопіюй зараз — більше його не буде видно.</b> На сервері зберігається лише його відбиток (sha256), тож відновити ключ не можна: загубиться — видай новий, а цей вимкни.</p>
      <div class="row ins-token" style="gap:8px;flex-wrap:wrap;align-items:center"><input id="insToken" readonly value="${esc(shown.token)}" style="flex:1 1 100%;min-width:0;font-family:monospace">
        <button class="btn sm" data-act="insCopy">${ic('copy')} Копіювати</button><button class="btn ghost sm" data-act="insHide">Я зберіг — сховати</button></div>
      <p class="small muted" style="margin-top:8px">Передай ключ Claude, наприклад так:</p>
      <pre class="small" style="white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all">curl -H "Authorization: Bearer ${esc(shown.token)}" ${esc(origin)}/api/insight/summary?days=14</pre></div>` : '';
  const rows = v.keys.map((k) => `<tr class="${k.active ? '' : 'muted'}"><td><b>${esc(k.label)}</b><div class="small muted">#${k.id}</div></td>
      <td>${k.active ? '<span class="badge green">активний</span>' : `<span class="badge red">вимкнено</span><div class="small muted">${date(k.revokedAt)}</div>`}</td>
      <td class="small nowrap">${date(k.createdAt)}<div class="muted">${esc(k.createdBy)}</div></td>
      <td class="small nowrap">${k.lastUsedAt ? date(k.lastUsedAt) : '<span class="muted">ще не було</span>'}<div class="muted">запитів: ${k.uses}</div></td>
      <td>${k.active ? `<button class="btn red sm" data-act="insRevoke" data-id="${k.id}" data-label="${esc(k.label)}">Вимкнути</button>` : ''}</td></tr>`).join('');
  return `<div class="head"><h1>Аналітика для Claude</h1><span class="badge ${v.active ? 'green' : ''}">активних ключів ${v.active}/${v.max}</span><button class="btn ghost sm" style="margin-left:auto" data-act="reload">Оновити</button></div>
    ${keyBox}
    <div class="grid2">
      <div class="panel"><h2>Видати ключ для Claude</h2>
        <p class="small muted">Ключ дає Claude <b>лише читання</b> аналітики гри, чату гравців і звернень у підтримку — через <code>/api/insight/*</code>. Адмінку й гру він не відкриває, нічого не змінює. Гравці там без імен, ніків і Telegram-ID: замість них псевдоніми на кшталт <code>p3f9a01c2be</code>. До ${v.perMin} запитів на хвилину. Ключ можна вимкнути будь-коли.</p>
        <label class="field"><span>Підпис (для кого ключ)</span><input id="insLabel" maxlength="60" value="Claude" autocomplete="off"></label>
        <div class="row end"><button class="btn" data-act="insIssue" ${v.active >= v.max ? 'disabled' : ''}>${ic('key')} Видати ключ для Claude</button></div>
        ${v.active >= v.max ? `<div class="small bad">Уже ${v.max} активні ключі — спершу вимкни непотрібний.</div>` : ''}</div>
      <div class="panel"><h2>Що бачить Claude</h2>
        <ul class="small" style="margin:0;padding-left:18px;line-height:1.6">
          <li>Щоденна зведена статистика, воронка новачків, список гравців (псевдоніми)</li>
          <li>Чат гравців — тексти без файлів, ${v.chatDays} днів (старіші видаляються)</li>
          <li>Звернення в підтримку та ідеї гравців — текст очищено від імен, ніків, посилань і телефонів</li>
          <li>SQL лише на читання — по знеособлених таблицях <code>v_*</code></li></ul>
        <details class="small" style="margin-top:8px"><summary>Адреси</summary>${v.endpoints.map((e) => `<div><code>${esc(e)}</code></div>`).join('')}</details></div>
    </div>
    <div class="panel"><h2>Ключі</h2>${rows ? `<div class="tbl-wrap"><table class="stack"><tr><th>Ключ</th><th>Стан</th><th>Видано</th><th>Останнє використання</th><th></th></tr>${rows}</table></div>` : '<div class="empty">Ключів ще не видавали</div>'}
      <p class="small muted">Видача, вимкнення й використання ключів записуються в «Журнал дій».</p></div>`;
}

export function insightActions({ mutate, toast, esc, $, render }) {
  return {
    insIssue: () => {
      const label = ($('#insLabel')?.value || '').trim() || 'Claude';
      return mutate('insight/issue', { label },
        { title: 'Видати ключ для Claude', button: 'Видати ключ',
          summary: `Підпис: <b>${esc(label)}</b><div class="small muted">Ключ відкриє лише читання знеособленої аналітики, чату й підтримки (<code>/api/insight/*</code>). Його покажуть один раз — одразу скопіюй.</div>` },
        (r) => ((shown = { token: r.token, label: r.key.label }), 'Ключ видано — скопіюй його'));
    },
    insRevoke: (d) => mutate('insight/revoke', { id: Number(d.id) },
      { title: `Вимкнути ключ «${d.label}»`, danger: true, button: 'Вимкнути ключ', summary: 'Ключ одразу перестане працювати. Увімкнути його знову не можна — за потреби видай новий.' }, 'Ключ вимкнено'),
    insCopy: async () => {
      const inp = $('#insToken');
      if (!inp) return;
      try {
        await navigator.clipboard.writeText(inp.value);
      } catch {
        inp.select();
        document.execCommand?.('copy');
      }
      toast('Ключ скопійовано');
    },
    insHide: () => ((shown = null), render()),
  };
}
