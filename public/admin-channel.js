// Admin «Канал»: auto-posts of notable events to the Telegram channel (src/channel.js; admin 'channel', 'channel/set',
// 'channel/test'). The switch, the hourly limit and digest, which events go out, a test post and the last posts.
const KIND_NAME = { drop: 'Міфічний дроп', secret: 'Секретне', edition: 'Тиражне', jackpot: 'Джекпот', boss: 'Бос босів', weekly: 'Топ тижня', digest: 'Дайджест', test: 'Тест' };

export async function channelPage({ api, esc, date }) {
  const v = await api('channel');
  const c = v.cfg;
  const warn = !v.hasChannel ? 'Не задано змінну TG_CHANNEL_ID (@назва_каналу або -100…) — автопости вимкнені.'
    : !v.hasBot ? 'Бот не підключено (BOT_TOKEN) — постити нікому.' : '';
  const kinds = Object.entries(v.kinds).map(([k, t]) => `<label class="row" style="gap:6px;margin:4px 0"><input type="checkbox" data-kind="${k}" ${c.kinds[k] ? 'checked' : ''}> ${esc(t)}</label>`).join('');
  const num = (id, val, min, max, step = 1) => `<input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${val}" style="width:90px">`;
  const log = v.log.length ? `<div class="tbl-wrap"><table><tr><th>Коли</th><th>Що</th><th>Текст</th></tr>${v.log.map((r) => `<tr class="${r.ok ? '' : 'bad'}">
      <td class="small nowrap muted">${date(r.at)}</td><td class="nowrap">${esc(KIND_NAME[r.kind] || r.kind)}${r.n > 1 ? ` ×${r.n}` : ''}${r.test ? ' <span class="badge">тест</span>' : ''}${r.ok ? '' : ' <span class="badge red">помилка</span>'}</td>
      <td class="small">${esc(String(r.text || '').replace(/<[^>]+>/g, '').slice(0, 160))}${r.error ? `<div class="small bad">${esc(r.error)}</div>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">Постів ще не було</div>';
  return `<div class="head"><h1>Канал</h1><button class="btn ghost sm" data-act="reload">Оновити</button></div>
    ${warn ? `<div class="panel"><div class="bad">${esc(warn)}</div></div>` : ''}
    <div class="grid2">
      <div class="panel"><h2>Автопости <span class="sub">${c.on ? 'увімкнено' : 'вимкнено'} · за годину: ${v.lastHour}/${c.maxPerHour} · у черзі: ${v.pending}</span></h2>
        <p class="small muted">Раз на хвилину гра шукає нові події й постить їх у канал. Ім’я гравця — лише якщо він сам увімкнув «Показувати мене в каналі» (увімкнули: ${v.optins}); інакше «Хтось із гравців». Джекпот контейнера йде в канал лише після того, як переможець його відкрив. Після вмикання постяться тільки нові події.</p>
        <label class="row" style="gap:6px;margin:6px 0"><input type="checkbox" id="chOn" ${c.on ? 'checked' : ''}> <b>Постити в канал</b></label>
        <div class="row" style="gap:8px;align-items:center;margin:6px 0">Не більше ${num('chMax', c.maxPerHour, 1, 20)} постів на годину</div>
        <label class="row" style="gap:6px;margin:6px 0"><input type="checkbox" id="chDigest" ${c.digest ? 'checked' : ''}> Міфічні дропи збирати в дайджест</label>
        <div class="row" style="gap:8px;align-items:center;margin:6px 0">Дайджест не частіше, ніж раз на ${num('chDigestMin', c.digestMin, 15, 360, 5)} хв</div>
        <div class="row" style="gap:8px;align-items:center;margin:6px 0">Джекпот: авто дорожче за ставку щонайменше в ${num('chJackpot', c.jackpotX, 1.5, 20, 0.5)} раза</div>
        <h2 style="margin-top:12px">Які події</h2>${kinds}
        <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn green sm" data-act="chSave" ${v.hasChannel ? '' : 'disabled'}>Зберегти</button></div></div>
      <div class="panel"><h2>Тестовий пост</h2>
        <p class="small muted">Надсилає один пост у канал зараз (навіть коли автопости вимкнені) — перевірити, що бот є адміністратором каналу. У ліміт не рахується.</p>
        <textarea id="chTest" rows="3" maxlength="500" placeholder="Тестовий пост: автопости АВТОДРОПу підключено ✅" style="width:100%"></textarea>
        <div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost sm" data-act="chTest" ${v.configured ? '' : 'disabled'}>Надіслати тест</button></div></div>
    </div>
    <div class="panel"><h2>Останні пости</h2>${log}</div>`;
}

export function channelActions({ mutate, $ }) {
  return {
    chSave: () => {
      const kinds = Object.fromEntries([...document.querySelectorAll('[data-kind]')].map((el) => [el.dataset.kind, el.checked]));
      const body = { on: $('#chOn').checked, maxPerHour: Number($('#chMax').value), digest: $('#chDigest').checked, digestMin: Number($('#chDigestMin').value), jackpotX: Number($('#chJackpot').value), kinds };
      return mutate('channel/set', body, { title: body.on ? 'Автопости в канал: увімкнути' : 'Автопости в канал: вимкнути', danger: !body.on, button: 'Зберегти',
        summary: `Не більше ${body.maxPerHour} постів на годину${body.digest ? `, міфічні дропи — дайджестом раз на ${body.digestMin} хв` : ''}.` }, 'Налаштування каналу збережено');
    },
    chTest: () => mutate('channel/test', { text: $('#chTest').value }, { title: 'Тестовий пост у канал', button: 'Надіслати', summary: 'Пост одразу з’явиться в каналі — його бачитимуть підписники.' }, 'Тест надіслано'),
  };
}
