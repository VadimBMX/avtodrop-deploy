// Owner metrics for the admin «Метрики» tab: the arithmetic over rows that src/game.js (adminMetrics) reads from the
// database. Kept apart from the game so cohorts and the funnel can be tested with fixed rows and a fixed clock.
//
// Definitions (all days are Kyiv days, 'YYYY-MM-DD'; inside this file a day is a whole number, see dayNum):
//   active on a day — made any API call that day (user_days; markDay writes it at most every 15 s per player).
//   cohort          — the players who signed up on one day. Dk = the share of them active again on day signup + k.
//                     A day that hasn't come yet is null; today is `partial` (the day isn't over yet). The average Dk
//                     counts only finished days, weighted by cohort size.
//   WAU of a day    — players active on any of the 7 days ending that day.
//   session         — calls with no gap over SESSION_GAP_MS between them; a new day starts a new one.
//   funnel          — the first time each step happened (table funnel). «За 24 год» counts players who signed up at
//                     least 24 h ago and made the step within 24 h of signing up; «будь-коли» counts every player in
//                     the window. Only players who signed up after the funnel started recording (meta funnel_since).
//   source          — the deep-link parameter of the first start (users.start_param): ref_<id> a friend's link (drop
//                     cards share it too), ch_<id> a challenge, anything else another link; none — organic.

export const DAY_MS = 86400e3;
export const SESSION_GAP_MS = 30 * 60e3;
export const RETENTION_DAYS = [1, 3, 7, 14, 30];
// Steps in the order the game leads a newcomer (S.GUIDE_PATH: drop → «У гараж» → collect → race), then levels.
export const FUNNEL_STEPS = [
  { key: 'intro', name: 'Побачив інтро' },
  { key: 'drop', name: 'Перший дроп' },
  { key: 'garage', name: 'Машина в гараж' },
  { key: 'collect', name: 'Перший збір доходу' },
  { key: 'race', name: 'Перший заїзд' },
  { key: 'L3', name: 'Рівень 3' },
  { key: 'L4', name: 'Рівень 4' },
];
// Steps the app reports itself (they leave no other trace on the server): the «У гараж» tap on the drop screen.
export const CLIENT_STEPS = new Set(['garage']);
// Steps written after a successful API call of that name.
export const FUNNEL_AFTER = { 'intro/seen': 'intro', 'case/open': 'drop', collect: 'collect', 'race/finish': 'race' };
export const FIRST_DAY_LEVELS = [3, 4, 5];
export const FUNNEL_LEVEL_MAX = 10; // level marks L2…L10
// What to aim for two weeks after the release (reports/audit.md, «Що міряти»).
export const TARGETS = { d1: 0.35, d7: 0.12, l4: 0.6, viral: 0.25 };
export const SOURCES = [
  { key: 'ref', name: 'Посилання друга' },
  { key: 'challenge', name: 'Виклик (ch_)' },
  { key: 'link', name: 'Інше посилання' },
  { key: 'organic', name: 'Органіка' },
  { key: 'legacy', name: 'З першої версії' },
];
// money_src.src → group. A prefix ending in '/' matches every call under it; any other entry matches itself and
// its sub-calls ('weekly' → 'weekly', 'weekly/claim'). The first matching group wins.
export const MONEY_GROUPS = [
  { key: 'cases', name: 'Кейси й батли', src: ['case/open', 'parts/open', 'battle/'] },
  { key: 'sales', name: 'Продаж дилеру', src: ['sell', 'parts/sell', 'parts/sell-junk', 'plate/sell', 'dealer/'] },
  { key: 'races', name: 'Гонки, дрифт, PvP', src: ['race/', 'boss/', 'drift/', 'pvp/'] },
  { key: 'garage', name: 'Дохід гаража', src: ['collect'] },
  { key: 'upkeep', name: 'Гараж і тюнінг', src: ['buy-slot', 'upgrade-cap', 'buy-showcase', 'showcase', 'wash/', 'car/', 'plate/', 'parts/', 'upgrade', 'dream/'] },
  { key: 'rewards', name: 'Нагороди', src: ['rewards', 'newbie/', 'quests/', 'weekly', 'ach/', 'sets/', 'collection/', 'season', 'promo', 'rescue/', 'gifts/', 'comeback'] },
  { key: 'levels', name: 'Рівні й реферали', src: ['level'] },
  { key: 'start', name: 'Старт новачка', src: ['signup'] },
  { key: 'containers', name: 'Причал (контейнери)', src: ['containers'] },
  { key: 'market', name: 'Ринок, аукціон, обміни', src: ['market/', 'auction', 'trade/', 'room/'] },
  { key: 'casino', name: 'Казино', src: ['casino/'] },
  { key: 'shop', name: 'Магазин ⭐', src: ['shop'] },
  { key: 'admin', name: 'Адмінка', src: ['admin'] },
];
const OTHER = { key: 'other', name: 'Інше' };

const dayNums = new Map();
export function dayNum(d) {
  let n = dayNums.get(d);
  if (n === undefined) {
    n = Math.round(Date.parse(d + 'T00:00:00Z') / DAY_MS);
    if (dayNums.size < 5000) dayNums.set(d, n);
  }
  return n;
}
export const dayStr = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

// Kyiv is a whole number of hours ahead of UTC, so every UTC hour lies inside one Kyiv day: cache the day per hour.
export function hourDay(dayOf) {
  const cache = new Map();
  return (t) => {
    const h = Math.floor(t / 3600e3);
    let d = cache.get(h);
    if (d === undefined) cache.set(h, (d = dayOf(h * 3600e3)));
    return d;
  };
}

// SQL for the Kyiv day ('YYYY-MM-DD') of a ms timestamp column, valid for times in [from, to]: the UTC offset of
// every stretch comes from the same time-zone data as dayOf (Intl), checked hour by hour, so daylight saving is right.
const KYIV_H = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric' });
function kyivOffsetMs(t) {
  const p = Object.fromEntries(KYIV_H.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour) - Math.floor(t / 3600e3) * 3600e3;
}
export function kyivDaySql(col, from, to) {
  const spans = []; // [until, offset]: the offset holds for times before `until`
  let off = kyivOffsetMs(from);
  for (let h = Math.floor(from / 3600e3) + 1; h * 3600e3 <= to; h++) {
    const o = kyivOffsetMs(h * 3600e3);
    if (o !== off) {
      spans.push([h * 3600e3, off]);
      off = o;
    }
  }
  const cases = spans.map(([until, o]) => `WHEN ${col} < ${until} THEN ${o}`).join(' ');
  return `date((${col} + ${cases ? `CASE ${cases} ELSE ${off} END` : off}) / 1000, 'unixepoch')`;
}

// The deep-link parameter as stored: letters, digits, _ and -, at most 64 (Telegram allows 64); anything else → null.
export function cleanStartParam(p) {
  const s = typeof p === 'string' ? p.trim().slice(0, 64) : '';
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}
export function signupSource({ startParam, referrerId, legacy }) {
  if (legacy) return 'legacy';
  const p = startParam || '';
  if (/^ref_\d+$/.test(p)) return 'ref';
  if (/^ch_/.test(p)) return 'challenge';
  if (p) return 'link';
  return referrerId ? 'ref' : 'organic'; // players from before start_param was stored
}

export function groupOf(src) {
  const s = String(src || '');
  for (const g of MONEY_GROUPS) if (g.src.some((p) => s === p || s.startsWith(p.endsWith('/') ? p : p + '/'))) return g.key;
  return OTHER.key;
}

const share = (n, base) => (base ? n / base : null);
function median(list) {
  if (!list.length) return null;
  const a = [...list].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// activity rows [{ day: 'YYYY-MM-DD', user_id, sessions }] → who was active when, and per-day totals.
export function indexActivity(rows) {
  const byUser = new Map(), byDay = new Map();
  for (const r of rows) {
    const d = dayNum(r.day);
    let s = byUser.get(r.user_id);
    if (!s) byUser.set(r.user_id, (s = new Set()));
    s.add(d);
    let x = byDay.get(d);
    if (!x) byDay.set(d, (x = { dau: 0, sessions: 0, counted: 0 }));
    x.dau++;
    if (r.sessions > 0) {
      x.sessions += r.sessions;
      x.counted++;
    }
  }
  return { byUser, byDay };
}

// WAU for every day: each player adds one to the 7 days starting at each active day, without counting a day twice.
export function wauByDay(byUser) {
  const wau = new Map();
  for (const set of byUser.values()) {
    let covered = -Infinity;
    for (const a of [...set].sort((x, y) => x - y)) {
      for (let d = Math.max(a, covered + 1); d <= a + 6; d++) wau.set(d, (wau.get(d) || 0) + 1);
      covered = a + 6;
    }
  }
  return wau;
}

// users [{ id, day }] (day = signup day number) → one row per day from `first` to `today` and the average Dk.
export function retention({ users, byUser, first, today, ks = RETENTION_DAYS }) {
  const byDay = new Map();
  for (const u of users) {
    if (!byDay.has(u.day)) byDay.set(u.day, []);
    byDay.get(u.day).push(u);
  }
  const acc = Object.fromEntries(ks.map((k) => [k, { n: 0, base: 0 }]));
  const cohorts = [];
  for (let c = first; c <= today; c++) {
    const list = byDay.get(c) || [];
    const d = {};
    for (const k of ks) {
      const at = c + k;
      if (at > today) {
        d[k] = null;
        continue;
      }
      const n = list.filter((u) => byUser.get(u.id)?.has(at)).length;
      d[k] = { n, pct: share(n, list.length), partial: at === today };
      if (at < today) {
        acc[k].n += n;
        acc[k].base += list.length;
      }
    }
    cohorts.push({ day: dayStr(c), size: list.length, d });
  }
  const avg = Object.fromEntries(ks.map((k) => [k, acc[k].base ? { ...acc[k], pct: acc[k].n / acc[k].base } : null]));
  return { cohorts, avg };
}

// users [{ id, createdAt }], marks [{ user_id, step, at }] → each step within 24 h and ever, median time to it.
export function funnel({ users, marks, now }) {
  const at = new Map();
  for (const m of marks) {
    let o = at.get(m.user_id);
    if (!o) at.set(m.user_id, (o = {}));
    o[m.step] = m.at;
  }
  const firstDay = (u, step) => {
    const t = at.get(u.id)?.[step];
    return t != null && t - u.createdAt <= DAY_MS;
  };
  // One pass over the players: minutes to each step (ever) and first-day counts among the mature ones.
  const keys = [...new Set([...FUNNEL_STEPS.map((s) => s.key), ...FIRST_DAY_LEVELS.map((l) => 'L' + l)])];
  const mins = Object.fromEntries(keys.map((k) => [k, []])), d1 = Object.fromEntries(keys.map((k) => [k, 0]));
  let mature = 0;
  for (const u of users) {
    const o = at.get(u.id), old = u.createdAt <= now - DAY_MS;
    if (old) mature++;
    if (!o) continue;
    for (const k of keys) {
      const t = o[k];
      if (t == null) continue;
      mins[k].push(Math.max(0, (t - u.createdAt) / 60e3));
      if (old && t - u.createdAt <= DAY_MS) d1[k]++;
    }
  }
  let prev = null;
  const steps = FUNNEL_STEPS.map((s) => {
    const n = d1[s.key], ever = mins[s.key].length;
    const out = { key: s.key, name: s.name, d1: n, d1Pct: share(n, mature), fromPrev: prev == null ? null : share(n, prev),
      ever, everPct: share(ever, users.length), medianMin: median(mins[s.key]) };
    prev = n;
    return out;
  });
  const levels = FIRST_DAY_LEVELS.map((l) => ({ level: l, n: d1['L' + l], pct: share(d1['L' + l], mature) }));
  return { users: users.length, mature, steps, levels, firstDay };
}

// Where players came from and how each source plays: D1 (finished days only) and L4 within the first 24 h.
export function sources({ users, byUser, today, now, firstDay }) {
  const total = users.length;
  return SOURCES.map((s) => {
    const list = users.filter((u) => u.source === s.key);
    const d1Base = list.filter((u) => u.day + 1 < today);
    const d1 = d1Base.filter((u) => byUser.get(u.id)?.has(u.day + 1)).length;
    const l4Base = list.filter((u) => u.tracked && u.createdAt <= now - DAY_MS);
    const l4 = l4Base.filter((u) => firstDay(u, 'L4')).length;
    return { key: s.key, name: s.name, n: list.length, pct: share(list.length, total),
      d1: { n: d1, base: d1Base.length, pct: share(d1, d1Base.length) }, l4: { n: l4, base: l4Base.length, pct: share(l4, l4Base.length) } };
  }).filter((s) => s.n || s.key !== 'legacy');
}

// rows [{ day, src, created, destroyed }] → per group: totals over the window, daily net, the biggest calls inside.
export function moneyBySource({ rows, days }) {
  const groups = [...MONEY_GROUPS, OTHER].map((g) => ({ key: g.key, name: g.name, created: 0, destroyed: 0, net: 0, byDay: {}, srcs: {} }));
  const by = Object.fromEntries(groups.map((g) => [g.key, g]));
  for (const r of rows) {
    const g = by[groupOf(r.src)];
    g.created += r.created;
    g.destroyed += r.destroyed;
    g.byDay[r.day] = (g.byDay[r.day] || 0) + r.created - r.destroyed;
    g.srcs[r.src] = (g.srcs[r.src] || 0) + r.created + r.destroyed;
  }
  const out = groups.filter((g) => g.created || g.destroyed).map((g) => ({
    key: g.key, name: g.name, created: g.created, destroyed: g.destroyed, net: g.created - g.destroyed,
    series: days.map((d) => g.byDay[d] || 0),
    top: Object.entries(g.srcs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([src]) => src),
  }));
  const tracked = rows.length ? rows.reduce((m, r) => (r.day < m ? r.day : m), rows[0].day) : null;
  return { groups: out, since: tracked, total: { created: out.reduce((s, g) => s + g.created, 0), destroyed: out.reduce((s, g) => s + g.destroyed, 0) } };
}

// Everything the tab shows, from the rows of the window [first, today] (day numbers).
//   users    [{ id, createdAt, day, source, tracked }] — signed up in the window (tracked = after funnel_since)
//   activity [{ day, user_id, sessions }]              — user_days from first − 6 (WAU of the first day)
//   marks    [{ user_id, step, at }]                   — funnel rows of the tracked players
//   money    [{ day, src, created, destroyed }]        — money_src from the first day
export function buildMetrics({ today, first, users, activity, marks, money, now, funnelSince }) {
  const T = typeof today === 'number' ? today : dayNum(today);
  const { byUser, byDay } = indexActivity(activity);
  const wau = wauByDay(byUser);
  const newBy = new Map();
  for (const u of users) newBy.set(u.day, (newBy.get(u.day) || 0) + 1);
  const days = [];
  for (let d = first; d <= T; d++) days.push(d);
  const series = days.map((d) => {
    const x = byDay.get(d);
    return { day: dayStr(d), newUsers: newBy.get(d) || 0, dau: x?.dau || 0, wau: wau.get(d) || 0, sessions: x?.counted ? x.sessions / x.counted : null };
  });
  const tracked = users.filter((u) => u.tracked);
  const f = funnel({ users: tracked, marks, now });
  const { firstDay, ...fOut } = f;
  const src = sources({ users, byUser, today: T, now, firstDay });
  const viral = src.filter((s) => s.key === 'ref' || s.key === 'challenge').reduce((n, s) => n + s.n, 0);
  return {
    today: dayStr(T), first: dayStr(first), days: days.map(dayStr), series, funnelSince: funnelSince || null,
    retention: retention({ users, byUser, first, today: T }), funnel: fOut, sources: src,
    viral: { n: viral, pct: share(viral, users.length) },
    money: moneyBySource({ rows: money, days: days.map(dayStr) }),
    targets: TARGETS, ks: RETENTION_DAYS, sessionGapMin: SESSION_GAP_MS / 60e3,
  };
}
