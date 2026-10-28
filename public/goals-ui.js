// «Цілі дня» in the app (server src/goals.js, rules S.QUESTS / S.goalKey / S.goalStreakReward). Installed once by app.js:
//   · a compact card on «Гараж» right under the income card (inline content, not a top strip — the «одна смуга»
//     order of firsthour.js is untouched): 3 pips, the next goal, the day's key, the run; «Забрати ключ» when ready;
//   · the head card of «Завдання → Сьогодні» (goalsHead): the key, the run of 7 with the freeze, the rules;
//   · the two claims (goalkey, gstreak) in the rewards center / gift badge, banners and «Забрати все».
import * as S from './shared.js';

let X = null; // { me(), state(), H, AFTER, ic, esc, plural, countFix, guideOn, claimQuiet, revealRewards, refresh, toast, pulseSoon, closeModal, banners, hideBanner, openRewards, caseIcon, go, REWARD_KINDS, REWARD_IC, PAGE_CLAIMS }

const goalText = (x) => X.countFix(S.QUESTS[x.key]?.text.replace('{n}', x.target) || x.key);
const caseName = (id) => S.CASE_BY_ID[id]?.name || '';
const keysText = (list) => list.map((k) => `${k.count > 1 ? `${k.count} × ` : ''}ключ «${caseName(k.caseId)}»`).join(' + ');
const daysW = (n) => S.daysWord(n);

function pips(g) {
  return `<span class="gl-pips" aria-label="виконано ${g.done} з ${g.total}">${g.list.map((x) => {
    const share = Math.min(1, x.progress / x.target);
    return `<i class="${share >= 1 ? 'on' : ''}"><b style="width:${Math.round(share * 100)}%"></b></i>`;
  }).join('')}</span>`;
}
function streakChip(g) {
  if (!g.streak && !g.frozen) return '';
  return `<span class="gl-fire ${g.today ? 'lit' : ''}" title="Серія цілей">${X.ic('flame')}${g.streak}</span>`;
}

// «Гараж»: one card, one action at most.
export function goalsCard(g) {
  if (!g || !g.total) return '';
  const next = g.list.find((x) => x.progress < x.target);
  let sub, right;
  if (g.keyReady) {
    sub = `<b class="gl-ok">Ключ готовий</b><span class="muted ellipsis">«${X.esc(caseName(g.caseId))}»</span>`;
    right = `<button class="btn sm ghost gl-claim" data-act="goalKey">${X.ic('key')} Забрати</button>`;
  } else if (g.complete) {
    sub = `<span class="muted">Ключ отримано · нові цілі опівночі</span>`;
    right = '';
  } else {
    sub = `<span class="gl-next ellipsis">${next ? X.esc(goalText(next)) : ''}</span>`;
    right = `<span class="gl-key" title="За три цілі — ключ «${X.esc(caseName(g.caseId))}»">${X.ic('key')}${X.caseIcon(S.CASE_BY_ID[g.caseId])}</span>`;
  }
  return `<div class="card gl-card${g.keyReady ? ' ready' : ''}${g.complete && !g.keyReady ? ' quiet' : ''}" id="glCard" data-act="goalsOpen" role="button" aria-label="Цілі дня">
    <div class="gl-row"><b class="gl-t">${X.ic('target-arrow')} Цілі дня <span class="gl-n">${g.done}/${g.total}</span></b>${streakChip(g)}${pips(g)}</div>
    <div class="gl-row gl-sub"><span class="grow ellipsis">${sub}</span>${right}</div>
    ${g.streakReady ? `<button class="gl-sr" data-act="goalStreak">${X.ic('flame')} Серія ${g.streak} ${daysW(g.streak)} — забери ${X.esc(keysText([g.nextReward]))}</button>` : ''}</div>`;
}

// «Завдання → Сьогодні»: the head card above the three task cards.
export function goalsHead() {
  const g = X?.me()?.goals;
  if (!g || !g.total) return '';
  const inRun = g.streak % S.GOAL_STREAK.every, filled = g.streak && !inRun && !g.today ? 0 : inRun || (g.streak ? S.GOAL_STREAK.every : 0);
  const dots = Array.from({ length: S.GOAL_STREAK.every }, (_, i) => `<i class="${i < filled ? 'on' : ''}${i === filled - 1 && g.today ? ' now' : ''}">${i === S.GOAL_STREAK.every - 1 ? X.ic('gift') : ''}</i>`).join('');
  const togo = g.next - g.streak;
  const state = g.keyReady ? `<button class="btn sm ghost" data-act="goalKey">${X.ic('key')} Забрати ключ</button>`
    : g.complete ? `<span class="chip">${X.ic('check')} отримано</span>` : `<span class="chip">${g.done}/${g.total}</span>`;
  return `<div class="card gl-head">
    <div class="gl-row"><span class="gl-kic">${X.caseIcon(S.CASE_BY_ID[g.caseId])}</span><span class="grow"><b>Усі три цілі → ключ «${X.esc(caseName(g.caseId))}»</b>
      <span class="tiny muted">${g.complete ? 'Сьогодні виконано' : `Лишилось ${g.total - g.done} ${X.plural(g.total - g.done, ['ціль', 'цілі', 'цілей'])}`} · нові опівночі</span></span>${state}</div>
    <div class="gl-run"><div class="gl-row"><b class="gl-rt">${X.ic('flame')} Серія: ${g.streak} ${daysW(g.streak)}</b><span class="tiny muted">рекорд ${g.best}</span></div>
      <div class="gl-dots">${dots}</div>
      <div class="tiny muted">${g.streakReady ? `<b class="gl-ok">Нагорода за серію чекає</b>` : `Ще ${togo} ${daysW(togo)} з усіма цілями → ${X.esc(keysText([g.nextReward]))}`}${g.frozen ? ' · вчорашній пропуск врятувала заморозка' : ''}</div>
      ${g.streakReady ? `<button class="btn sm ghost mt" data-act="goalStreak">${X.ic('flame')} Забрати нагороду за серію</button>` : ''}
      <div class="gl-frz ${g.freezeReady ? 'on' : ''}">${X.ic('shield-check')} Заморозка: ${g.freezeReady ? 'є на цей тиждень — один пропущений день не обнулить серію' : 'цього тижня вже використана'}</div></div></div>`;
}

async function claim(name, title) {
  const r = await X.claimQuiet(name);
  if (!r) return;
  X.closeModal?.();
  X.toast(`${title}: ${keysText(r.keys)}`);
  X.pulseSoon();
  await X.revealRewards(r.keys.map((k) => ({ kind: 'key', caseId: k.caseId, count: k.count, title })));
}

function paintGarage() {
  const st = X.state(), view = document.getElementById('view');
  document.getElementById('glCard')?.remove();
  if (!view || st.page || st.tab !== 'garage' || st.garageView === 'showcase' || st.race || st.drift || X.guideOn()) return;
  const inc = document.getElementById('incomeCard');
  const html = goalsCard(X.me()?.goals);
  if (inc && html) inc.insertAdjacentHTML('afterend', html);
}

export function installGoals(ctx) {
  X = ctx;
  const { H, AFTER } = ctx;
  for (const k of ['goalkey', 'gstreak']) ctx.REWARD_KINDS.add(k);
  ctx.REWARD_IC.goalkey = 'key';
  ctx.REWARD_IC.gstreak = 'flame';
  ctx.PAGE_CLAIMS.quests.push('goalkey', 'gstreak'); // the page has its own buttons: no second «Забрати» in a banner
  const afterGarage = AFTER.garage;
  AFTER.garage = () => {
    afterGarage?.();
    paintGarage();
  };
  H.goalsOpen = () => {
    const st = X.state(); // straight to «Сьогодні» (go() would let the page pick the weekly tab)
    st.page = 'quests';
    st.questTab = 'day';
    st.questTabPicked = true;
    X.closeModal?.();
    window.scrollTo(0, 0);
    X.render();
  };
  H.goalKey = () => claim('goals/key', 'Цілі дня');
  H.goalStreak = () => claim('goals/streak', 'Серія цілей');
  const claimBase = H.bannerClaim, openBase = H.bannerOpen;
  H.bannerClaim = async (d) => {
    const b = X.banners.get(d.key), k = b?.data.claim?.kind;
    if (k !== 'goalkey' && k !== 'gstreak') return claimBase(d);
    X.hideBanner(d.key);
    return k === 'goalkey' ? H.goalKey() : H.goalStreak();
  };
  H.bannerOpen = (d) => {
    const b = X.banners.get(d.key), k = b?.data.kind;
    if (k !== 'goalkey' && k !== 'gstreak') return openBase(d);
    X.hideBanner(d.key);
    H.goalsOpen({});
  };
}
