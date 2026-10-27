// «Турнір вихідних» in the app (rules public/tourney.js, server src/tourney.js): a tile on «Гонки», the tournament
// screen (registration with a car, my match with the ghost to beat, the bracket by class, prizes, the hall of
// champions), a run on the usual drag scene (runRace; the server finishes it through race/finish with the replay) and
// its result. app.js calls installTourney() once at the end; nothing in app.js above is edited.
import * as S from './shared.js';
import * as TRS from './tourney.js';

const T = TRS.TOURNEY;
const HM = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const hhmm = (t) => HM.format(new Date(t));
const when = (t) => `${WD[new Date(S.kyivDateOf(t) + 'T00:00:00Z').getUTCDay()]} ${hhmm(t)}`;
const dayLabel = (tid) => `${tid.slice(8, 10)}.${tid.slice(5, 7)}`;
const tm = (t) => (t == null ? '—' : `${TRS.fmtTime(t)} с`);
const SEEN = 'tnmSeen';

export function installTourney(x) {
  const { api, H, PAGES, AFTER, TABS, PAGE_TITLES, render, go, refresh, ic, esc, carArt, miniCar, clsBadge, M, plural, toast, untilSpan, emptyBox,
    raceScreen, runRace, raceSheetHtml, resultFx, hideClaimBanners, drSeen, dragCoach, carTile, prefGet, prefSet } = x;
  const me = () => x.me(), state = () => x.state();
  let data = null;
  PAGE_TITLES.tourney = 'Турнір'; // the header: «Турнір вихідних» didn't fit next to a long balance (the page's hero has the full name)

  // ---------- the «Гонки» tile ----------
  function tile() {
    const b = me()?.tourney;
    if (!b) return '';
    const my = b.my;
    let line, hot = false;
    if (b.phase === 'reg') {
      line = b.entry ? `ти в сітці класу <b>${b.entry}</b> · жеребкування через ${untilSpan(b.regClose)}` : `реєстрація відкрита · ще ${untilSpan(b.regClose)}`;
      hot = !b.entry;
    } else if (b.phase === 'run' && my) {
      if (my.status === 'open' && my.canRun) ((line = `<b>${my.roundName}</b> готовий · до ${hhmm(my.deadline)} · спроб ${my.tries.left}`), (hot = true));
      else if (my.status === 'open') line = `${my.roundName}: чекаємо на суперника до ${hhmm(my.deadline)}`;
      else if (my.status === 'wait') line = `далі <b>${my.roundName}</b> — ${when(my.opens)}`;
      else if (my.champion) line = '<b>ти чемпіон!</b>';
      else line = `ти дійшов до: ${TRS.placeText(my.place).toLowerCase()} · фінал нд 20:00`;
    } else if (b.phase === 'run') line = `іде турнір · фінал нд 20:00`;
    else line = my?.champion ? `<b>ти чемпіон</b> · новий турнір через ${untilSpan(b.nextRegOpen)}` : `реєстрація в пт 18:00 · через ${untilSpan(b.nextRegOpen)}`;
    const tag = hot ? `<em>${b.phase === 'reg' ? 'реєстрація' : 'твій хід'}</em>` : !prefGet(SEEN) ? '<em>нове</em>' : '';
    return `<button class="tnm-tile${hot ? ' hot' : ''}" data-act="tnmOpen"><span class="tnm-ti">${ic('trophy')}</span>
      <span class="grow"><span class="tnm-th">Турнір вихідних${tag}</span><span class="tnm-tl">${line}</span></span><span class="chev">${ic('chevron-right')}</span></button>`;
  }
  {
    const base = TABS.race;
    TABS.race = async () => {
      if (state().race?.rival?.tourney) state().race = null; // back from the tournament: the tab starts fresh
      const html = await base();
      const s = state();
      if ((s.race && s.race.phase !== 'idle') || s.drift) return html;
      const below = '<div class="dr-below" id="drBelow">';
      // no «Гонки» block yet (no car): a player below the tournament's level isn't shown its tile above the empty screen
      return html.includes(below) ? html.replace(below, below + tile()) : (me()?.level || 1) < TRS.TOURNEY.minLevel ? html : tile() + html;
    };
  }
  H.tnmOpen = () => {
    state().race = null;
    go('tourney');
  };

  // ---------- the screen ----------
  PAGES.tourney = async () => {
    const s = state();
    if (s.race?.rival?.tourney) return s.race.phase === 'done' ? result() : raceScreen();
    data = await api('tourney', s.tnmBracket ? { bracket: s.tnmBracket } : {});
    prefSet(SEEN, 1);
    return page(data);
  };
  AFTER.tourney = () => {
    if (state().race?.rival?.tourney) resultFx();
  };

  function hero(v) {
    const ph = v.phase;
    const chip = ph === 'reg' ? `${ic('clock')} реєстрація ще ${untilSpan(v.regClose)}` : ph === 'run' ? `${ic('flag-3')} іде · фінал ${when(TRS.windowOf(v.tid, 16, 3).opens)}`
      : `${ic('calendar')} наступний — пт 18:00, через ${untilSpan(v.nextRegOpen)}`;
    const steps = [['пт 18:00', 'реєстрація', ph === 'reg'], ['сб 12:00', 'сітки', false], ['сб–нд', 'раунди 3 год', ph === 'run'], ['нд 20:00', 'фінал', false]];
    return `<div class="card tnm-hero"><div class="tnm-hero-top"><span class="chip">${ic('trophy')} ${dayLabel(v.tid)}–${dayLabel(TRS.addDays(v.tid, 2))}</span><span class="chip">${chip}</span></div>
      <b class="tnm-hero-t">Турнір вихідних</b>
      <div class="tnm-hero-s">Драг 402 м на вибування. Сітки за класом машини — «Лада» не зустріне Jesko. Кожен матч — заїзд проти привида суперника.</div>
      <div class="tnm-steps">${steps.map(([a, b, on]) => `<span class="${on ? 'on' : ''}"><b>${a}</b>${b}</span>`).join('')}</div></div>`;
  }
  function page(v) {
    const parts = [hero(v)];
    if (v.phase === 'reg') parts.push(regCard(v));
    if (v.my) parts.push(myCard(v));
    else if (v.phase === 'run' && !v.my) parts.push(`<div class="card tnm-note">${ic('info-circle')}<span>Цього тижня ти не в сітці. Наступна реєстрація — у п’ятницю о 18:00.</span></div>`);
    if (v.brackets.length) parts.push(bracketHtml(v));
    else if (v.phase !== 'reg') parts.push(emptyBox('trophy', 'Сіток ще немає', v.phase === 'done' ? 'Минулого тижня ніхто не зареєструвався — стань першим у п’ятницю' : 'Сітки складаються в суботу о 12:00'));
    parts.push(prizesHtml(v), hallHtml(v), rulesHtml());
    return parts.join('');
  }
  // Registration: one car of your garage — its class is your bracket.
  function regCard(v) {
    const garage = me().cars.filter((c) => c.status === 'garage').sort((a, b) => a.et - b.et);
    if (v.level < T.minLevel) return `<div class="card tnm-reg"><div class="hook-t">${ic('lock')} Турнір — з ${T.minLevel}-го рівня</div><div class="small muted">Ти на рівні ${v.level}. Досвід дають гонки, завдання й нові машини.</div></div>`;
    const s = state();
    if (v.entry && !s.tnmPicking) {
      const m = M(v.entry.model);
      return `<div class="card tnm-reg on"><div class="row between"><span class="hook-t">${ic('check')} Ти зареєстрований</span>${clsBadge(v.entry.cls)}</div>
        <div class="tnm-reg-car">${m ? miniCar(m.id) : ''}<div class="grow"><b class="ellipsis">${esc(m?.name || '')}</b><div class="tiny muted">сітка класу ${v.entry.cls} · ${v.counts[v.entry.cls] || 1} ${plural(v.counts[v.entry.cls] || 1, ['гравець', 'гравці', 'гравців'])} поки що</div></div></div>
        <div class="small muted">Жеребкування в суботу о 12:00 — бот напише, з ким твій перший матч.</div>
        <div class="btns"><button class="btn ghost" data-act="tnmRepick">Змінити машину</button><button class="btn outline" data-act="tnmLeave">Скасувати</button></div></div>`;
    }
    if (!garage.length) return `<div class="card tnm-reg">${emptyBox('car', 'Потрібна машина в гаражі', 'Зареєструватися можна з будь-якою своєю машиною')}</div>`;
    if (!garage.some((c) => c.id === s.tnmCar)) s.tnmCar = (v.entry && garage.find((c) => c.id === v.entry.carId)?.id) || garage[0].id;
    const car = garage.find((c) => c.id === s.tnmCar), cls = TRS.bracketCls(M(car.model).cls);
    return `<div class="card tnm-reg"><div class="hook-t">${ic('flag-3')} Реєстрація · безкоштовно</div>
      <div class="small muted">Обери машину: її клас — твоя сітка. Можна змінити до суботи 12:00.</div>
      <div class="carpick tnm-pick">${garage.map((c) => carTile(c, { act: 'tnmPick', sel: c.id === s.tnmCar })).join('')}</div>
      <div class="tnm-cls">${Object.keys(T.keys).map((k) => `<span class="${k === cls ? 'on' : ''}">${clsBadge(k)} ${v.counts[k] || 0}</span>`).join('')}</div>
      <button class="btn yellow btn2" data-act="tnmJoin"><span>${ic('trophy')} ${v.entry ? 'Зберегти машину' : 'Зареєструватися'}</span><small>${esc(M(car.model).name)} · сітка ${cls}</small></button></div>`;
  }
  H.tnmPick = (d) => {
    state().tnmCar = Number(d.id);
    const y = window.scrollY, sx = document.querySelector('.tnm-pick')?.scrollLeft || 0;
    render().then(() => {
      window.scrollTo(0, y);
      const p = document.querySelector('.tnm-pick');
      if (p) p.scrollLeft = sx;
    });
  };
  H.tnmRepick = () => {
    state().tnmPicking = true;
    render();
  };
  H.tnmJoin = async (d, el) => {
    if (el) el.disabled = true;
    try {
      await api('tourney/join', { carId: state().tnmCar });
      state().tnmPicking = false;
      toast('Ти в турнірі! Жеребкування — у суботу о 12:00');
    } catch (e) {
      toast(e.message, true);
    }
    await refresh();
  };
  H.tnmLeave = async () => {
    try {
      await api('tourney/leave');
      toast('Реєстрацію скасовано');
    } catch (e) {
      toast(e.message, true);
    }
    await refresh();
  };

  // My match: who is on the other lane, the time to beat, runs left, the deadline; or how far I got.
  function myCard(v) {
    const my = v.my;
    const pips = (left, max) => `<span class="dr-pips">${Array.from({ length: max }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('')}</span>`;
    if (my.champion || my.place === 1) {
      const pz = my.prize;
      return `<div class="card tnm-champ"><span class="tnm-cup">${ic('trophy')}</span><b class="tnm-champ-t">Ти чемпіон!</b><div class="small muted">клас ${my.cls} · ${dayLabel(v.tid)}</div>
        ${pz ? `<div class="tnm-prize-l">${prizeLine(pz)}</div>` : ''}</div>`;
    }
    if (my.status === 'done' && !my.won) {
      return `<div class="card tnm-my out"><div class="row between"><span class="hook-t">${ic('flag-3')} Твій турнір</span>${clsBadge(my.cls)}</div>
        <div class="tnm-out">Ти дійшов до: <b>${TRS.placeText(my.place)}</b></div>
        ${my.prize ? `<div class="tnm-prize-l">${prizeLine(my.prize) || 'без нагороди — у матчі не було жодного заїзду'}</div>` : `<div class="small muted">Нагороди — після фіналу в неділю.</div>`}</div>`;
    }
    const m = my.match, mine = m.a?.me ? m.a : m.b, opp = m.a?.me ? m.b : m.a;
    const head = `<div class="row between"><span class="hook-t">${ic(my.final ? 'crown' : 'flag-3')} ${my.final ? 'Ти у фіналі!' : `Твій матч · ${my.roundName}`}</span>${clsBadge(my.cls)}</div>`;
    if (my.status === 'wait' || (my.status === 'done' && my.won)) {
      const nx = my.status === 'wait' ? { name: my.roundName, opens: m.opens, deadline: m.deadline } : my.next;
      return `<div class="card tnm-my">${head}<div class="tnm-wait">${ic('clock')}<span>${my.status === 'done' ? `Перемога! Далі — <b>${nx.name}</b>` : `<b>${nx.name}</b>`}: ${when(nx.opens)}–${hhmm(nx.deadline)}<small>${opp ? `суперник — ${esc(opp.name)}` : 'суперник визначиться в іншому матчі'}</small></span></div></div>`;
    }
    const lane = my.lane || {};
    const laneTxt = lane.kind === 'bot' ? `${esc(lane.driver || '')} водій · час зафіксовано` : lane.kind === 'ghost' ? 'привид його найкращого заїзду' : 'ще не їхав — його звичний час';
    const vs = `<div class="chg-vs tnm-vs"><div><small>Ти</small><b class="ellipsis">${esc(M(mine.model)?.name || '')}</b><span>${mine.time != null ? `найкращий ${tm(mine.time)}` : 'ще без часу'}</span></div>
      <i>VS</i><div><small>${lane.kind === 'ghost' ? ic('ghost') : lane.kind === 'bot' ? ic('settings') : ic('users')} ${esc(opp?.name || '')}</small><b class="ellipsis">${esc(M(lane.model)?.name || '')}</b><span>${tm(lane.time)} · ${laneTxt}</span></div></div>`;
    const btn = my.canRun ? `<button class="btn yellow btn2" data-act="tnmStart"><span>${ic('flag-3')} Їхати</span><small>спроба ${my.tries.used + 1} з ${my.tries.max} · без пального</small></button>`
      : `<button class="btn" disabled>Спроби використано — чекаємо на суперника до ${hhmm(m.deadline)}</button>`;
    return `<div class="card tnm-my">${head}${vs}
      <div class="row between tnm-dl"><span class="small muted">${ic('clock')} до ${hhmm(m.deadline)} · лишилось ${untilSpan(m.deadline)}</span>${pips(my.tries.left, my.tries.max)}</div>
      ${btn}<div class="tiny muted">Рахується кращий із ${my.tries.max} заїздів. Не встигнеш до дедлайну — поразка.</div></div>`;
  }
  H.tnmStart = async (d, el) => {
    if (el) el.disabled = true;
    let r;
    try {
      r = await api('tourney/start');
    } catch (e) {
      toast(e.message, true);
      return refresh();
    }
    hideClaimBanners();
    const s = state();
    s.race = { phase: 'lights', id: r.raceId, car: r.car, rival: r.rival, greenMs: r.greenMs, reaction: null, shifts: [], gear: 1, result: null, coach: !me().stats.races };
    s.page = 'tourney';
    window.scrollTo(0, 0);
    await render();
    if (s.race.coach && !drSeen()) return dragCoach(s.race);
    runRace();
  };
  H.tnmBack = () => {
    state().race = null;
    window.scrollTo(0, 0);
    refresh();
  };
  H.tnmAgain = () => {
    state().race = null;
    return H.tnmStart();
  };

  // The bracket: one class at a time, every round with its window; the current round open.
  function bracketHtml(v) {
    const b = v.bracket;
    if (!b) return '';
    const tabs = v.brackets.length > 1 ? `<div class="seg tnm-tabs">${v.brackets.map((x) => `<button class="${x.bracket === b.bracket ? 'on' : ''}" data-act="tnmBracket" data-b="${x.bracket}">${x.bracket} · ${x.humans}</button>`).join('')}</div>` : '';
    const t = v.now;
    const cur = b.rounds.findIndex((r) => t < r.deadline);
    const side = (p, won, m) => {
      if (!p) return '<div class="tnm-sd tbd"><span class="grow muted">—</span></div>';
      const tag = p.bot ? `<span class="tnm-bot">${ic('settings')}</span>` : '';
      return `<div class="tnm-sd${p.me ? ' me' : ''}${won ? ' won' : ''}"><span class="tnm-seed">${p.seed}</span>${tag}<span class="grow ellipsis">${esc(p.name)}</span>
        <span class="tnm-t">${p.time != null ? TRS.fmtTime(p.time) : m.status === 'open' && !p.bot ? `${p.tries}/${T.tries}` : ''}</span>${won ? ic('check', 'tnm-ok') : ''}</div>`;
    };
    const rounds = b.rounds.map((r, i) => {
      const live = t >= r.opens && t < r.deadline;
      const body = r.matches.map((m) => (m ? `<div class="tnm-m ${m.status}${m.a?.me || m.b?.me ? ' mine' : ''}">${side(m.a, m.status === 'done' && m.winner === 0, m)}${side(m.b, m.status === 'done' && m.winner === 1, m)}${m.how === 'noshow' || m.how === 'noshow2' ? '<small class="tnm-how">неявка</small>' : ''}</div>`
        : '<div class="tnm-m tbd"><div class="tnm-sd tbd"><span class="grow muted">переможець пари</span></div><div class="tnm-sd tbd"><span class="grow muted">переможець пари</span></div></div>')).join('');
      return `<details class="tnm-r"${i === cur || (cur < 0 && i === b.rounds.length - 1) ? ' open' : ''}><summary><b>${r.name}</b><span class="${live ? 'live' : ''}">${live ? 'іде · до ' + hhmm(r.deadline) : `${when(r.opens)}–${hhmm(r.deadline)}`}</span></summary><div class="tnm-ms">${body}</div></details>`;
    }).join('');
    const champ = b.champion ? `<div class="card tnm-cw">${ic('crown')}<div class="grow"><b class="ellipsis">${esc(b.champion.name)}${b.champion.bot ? ' · бот' : ''}</b><div class="tiny muted">чемпіон класу ${b.cls} · ${esc(M(b.champion.model)?.name || '')} · ${tm(b.champion.time)}</div></div></div>` : '';
    return `<div class="h2"><span>Сітка ${b.bracket}</span><span>${b.size} учасників · ${b.humans} ${plural(b.humans, ['гравець', 'гравці', 'гравців'])}</span></div>${tabs}${champ}<div class="tnm-tree">${rounds}</div>`;
  }
  H.tnmBracket = (d) => {
    state().tnmBracket = d.b;
    const y = window.scrollY;
    render().then(() => window.scrollTo(0, y));
  };
  const caseName = (id) => esc(S.CASE_BY_ID[id]?.name || id);
  function prizeLine(pz) {
    const bits = [];
    if (pz.money) bits.push(`<b class="win">+${S.short(pz.money)}</b>`);
    for (const k of pz.keys) bits.push(`${ic('key')} ${caseName(k)}`);
    if (pz.badge) bits.push(`${ic('star')} значок`);
    if (pz.frame) bits.push(`${ic('license')} рамка «Чемпіон»`);
    return bits.join(' · ');
  }
  function prizesHtml(v) {
    const cls = v.my?.cls || v.entry?.cls || state().tnmPrizeCls || 'C';
    const rows = [[1, 'Чемпіон'], [2, 'Фінал'], [3, 'Півфінал'], [5, '1/4 фіналу']].map(([p, t]) => `<div class="tnm-pz"><span class="tnm-pz-p">${p === 1 ? ic('crown') : ''}${t}</span><span class="tnm-pz-v">${prizeLine(TRS.prizeFor(cls, p))}</span></div>`).join('');
    const play = TRS.prizeFor(cls, 17, true);
    return `<div class="card tnm-prizes"><div class="row between"><span class="hook-t">${ic('gift')} Нагороди · клас ${cls}</span>
      <span class="tnm-pcls">${Object.keys(T.keys).map((k) => `<button class="${k === cls ? 'on' : ''}" data-act="tnmPrizeCls" data-c="${k}">${k}</button>`).join('')}</span></div>
      ${rows}<div class="tnm-pz"><span class="tnm-pz-p">Участь</span><span class="tnm-pz-v"><b class="win">+${S.short(play.money)}</b> за хоч один заїзд</span></div>
      <div class="tiny muted">Нагороди нараховуються одразу після фіналу класу. Значок і рамка номера «Чемпіон» — лише за турнір, у магазині їх немає.</div></div>`;
  }
  H.tnmPrizeCls = (d) => {
    state().tnmPrizeCls = d.c;
    if (data && document.querySelector('.tnm-prizes')) document.querySelector('.tnm-prizes').outerHTML = prizesHtml({ ...data, my: null, entry: null });
  };
  function hallHtml(v) {
    if (!v.hall.length) return `<div class="h2"><span>Зала чемпіонів</span></div>${emptyBox('crown', 'Поки порожньо', 'Перший чемпіон з’явиться в неділю ввечері')}`;
    return `<div class="h2"><span>Зала чемпіонів</span><span>${v.hall.length}</span></div><div class="list tnm-hall">${v.hall.map((h) => `<div class="li${h.uid && h.uid === me().id ? ' me' : ''}">${h.model && M(h.model) ? miniCar(h.model) : ''}<div class="grow">
      <div class="row between"><b class="ellipsis">${esc(h.name || '')}${h.bot ? ` <span class="tnm-bot">${ic('settings')}</span>` : ''}${h.titles > 1 ? ` <span class="chip">×${h.titles}</span>` : ''}</b>${clsBadge(h.cls)}</div>
      <div class="tiny muted ellipsis">${dayLabel(h.tid)} · ${esc(M(h.model)?.name || '')} · ${tm(h.time)}</div></div></div>`).join('')}</div>`;
  }
  const rulesHtml = () => `<details class="dr-how tnm-rules"><summary>${ic('info-circle')} Правила</summary><div class="tiny muted">
    Реєстрація — з п’ятниці 18:00 до суботи 12:00, безкоштовно, з однією машиною (її клас — твоя сітка; секретні машини їдуть з класом S).
    О 12:00 — жеребкування: сітка на 16 (понад 16 гравців — на 32), вільні місця займають боти — справжні машини класу й водії від «Новачка» до «Профі».
    Кожен раунд — вікно на 3 години (сб 12:00, 15:00, 18:00; нд 16:00; фінал — нд 20:00). У матчі в кожного ${T.tries} заїзди, рахується кращий;
    їдеш проти привида найкращого заїзду суперника (у бота — його зафіксований час). При однаковому часі перемагає той, хто проїхав раніше. Хто не має часу до дедлайну — програє; якщо обидва — проходить вищий посів.
    Заїзди не витрачають пальне. Сервер перевіряє кожен заїзд — старт і всі перемикання, як у звичайному драгу.</div></details>`;

  // ---------- the result of a run ----------
  function result() {
    const R = state().race, r = R.result, tr = r.tourney || {};
    const startTxt = r.jump ? 'Фальстарт −8%' : r.perfectStart ? 'Ідеальний старт +4%' : r.reaction >= 1.5 ? 'Пізній старт' : `Реакція ${TRS.fmtTime(r.reaction)} с`;
    let amount, note;
    if (!tr.counted) ((amount = 'Не зараховано'), (note = tr.expired ? 'заїзд тривав понад 3 хвилини' : 'час матчу вже вийшов'));
    else if (tr.champion) ((amount = 'Ти чемпіон!'), (note = 'нагорода вже на рахунку'));
    else if (tr.decided && tr.won) ((amount = 'Матч виграно'), (note = tr.next ? `далі — ${tr.next.name}, ${when(tr.next.opens)}` : ''));
    else if (tr.decided) ((amount = 'Матч програно'), (note = 'дякуємо за гру — побачимось у п’ятницю'));
    else ((amount = tr.newBest ? 'Новий найкращий час' : 'Без покращення'), (note = tr.tries?.left ? `ще ${tr.tries.left} ${plural(tr.tries.left, ['спроба', 'спроби', 'спроб'])} до ${hhmm(tr.deadline)}` : 'чекаємо на суперника'));
    const who = tr.kind === 'ghost' ? `Привид · ${R.rival.name}` : tr.kind === 'bot' ? `${R.rival.name} · бот` : `${R.rival.name} · звичний час`;
    const again = !tr.decided && tr.counted !== false && tr.tries?.left ? `<button class="btn yellow btn2" data-act="tnmAgain"><span>${ic('refresh')} Ще спроба</span><small>${tr.tries.left} з ${tr.tries.max} · без пального</small></button>` : '';
    return raceSheetHtml({ tag: `${ic('trophy')} Турнір · ${esc(tr.round || '')} · клас ${esc(tr.cls || '')}`, win: r.win, diff: r.diff, amount, note,
      rows: [{ who: 'Ти', model: R.car.model, look: R.car.look, time: r.time, won: r.win, sub: tr.best != null ? `найкращий ${tm(tr.best)}` : `${R.car.hp} к.с.` },
        { who, model: R.rival.model, look: R.rival.look, time: r.rivalTime, won: !r.win, sub: `${R.rival.hp} к.с.` }], start: startTxt, shifts: r.shifts })
      + `<div class="dr-btns tnm-rbtns">${again}<button class="btn ${again ? 'outline' : 'yellow'}" data-act="tnmBack">До сітки</button></div>`;
  }
  return { tile };
}
