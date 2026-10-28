// «Заїзд дня» on the server (the rules — car of the day, prizes — are in public/dayrace.js, shared with the app).
// A run is an ordinary solo drag race in `races` (rival.dayrace = the Kyiv day): game.js sends race/finish for it here,
// and the finish goes through the same dragRun as every drag race (the server's own green light, the launch and
// shift timestamps replayed by S.dragReplay, the server's clock). The car is the day's model in stock form (no parts,
// no paint), so only the driver counts. Attempts are counted at the start (a run abandoned halfway is used up).
// The midnight settlement is lazy, like the weekly race: the first call after Kyiv midnight ranks every unsettled day
// and writes each finisher's place and prize once (dayrace_days is the guard); the prizes wait in the rewards center.
import * as S from '../public/shared.js';
import * as D from '../public/dayrace.js';

const META = 'dayrace_cars'; // { day: { model, by } } — the admins' choices ('tg:…' / 'key') and frozen days ('auto')
const MAX = D.DAYRACE.attempts;
const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' });
const kyivHour = (t) => Number(HOUR.format(new Date(t)));
const round3 = (x) => Math.round(x * 1000) / 1000;

// ctx: the game's own helpers (src/game.js passes them in; nothing here reaches into the game otherwise).
export function createDayRace(ctx) {
  const { db, q, now, rnd, dayOf, fail, int, name, metaGet, metaSet, dragRun, startLimit, addKeys, addFragments, xp, track, alog, isGameError } = ctx;

  // ---------- the car of a day ----------
  function loadCars() {
    try {
      const v = JSON.parse(metaGet(META) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }
  function saveCars(ov) {
    const old = D.addDays(dayOf(now()), -40);
    metaSet(META, JSON.stringify(Object.fromEntries(Object.entries(ov).filter(([d]) => d >= old))));
  }
  // Today's car is written down the first time anyone asks for it, so a deploy that changes D.CARS can't swap the car
  // in the middle of a day.
  let frozenDay = null;
  function carOf(day) {
    const ov = loadCars();
    const model = D.dayCar(day, ov);
    if (day === dayOf(now()) && frozenDay !== day) {
      if (!ov[day]) {
        ov[day] = { model, by: 'auto' };
        saveCars(ov);
      }
      frozenDay = day;
    }
    return model;
  }
  // The day's car as the race and the screen use it: the model's own stock numbers, nothing installed.
  function stockOf(model) {
    const st = S.carStats({ model });
    return { model, hp: st.hp, kg: st.kg, grip: st.grip, shift: 0, base: st.base, et: st.et, look: null };
  }

  // ---------- the board ----------
  // Banned players and disqualified results are not on it. Order: time, then who set it first, then id.
  const BOARD = 'FROM dayrace_best b JOIN users u ON u.id = b.user_id WHERE b.day = ? AND b.dq = 0 AND u.banned = 0';
  const totalOf = (day) => q(`SELECT COUNT(*) n ${BOARD}`).get(day).n;
  const bestOf = (uid, day) => q('SELECT * FROM dayrace_best WHERE day = ? AND user_id = ?').get(day, uid) || null;
  const triesOf = (uid, day) => q('SELECT n FROM dayrace_tries WHERE day = ? AND user_id = ?').get(day, uid)?.n || 0;
  const atPlace = (day, place) => q(`SELECT b.user_id, b.time, b.at ${BOARD} ORDER BY b.time, b.at, b.user_id LIMIT 1 OFFSET ?`).get(day, place - 1) || null;
  function placeOf(row) {
    if (!row || row.dq) return null;
    return q(`SELECT COUNT(*) n ${BOARD} AND (b.time < ? OR b.time = ? AND (b.at < ? OR b.at = ? AND b.user_id < ?))`)
      .get(row.day, row.time, row.time, row.at, row.at, row.user_id).n + 1;
  }
  const rowOut = (r, place, uid) => ({ place, id: r.user_id, name: name(r.user_id), time: r.time, me: r.user_id === uid });
  const topList = (day, uid, limit = 100) => q(`SELECT b.user_id, b.time, b.at ${BOARD} ORDER BY b.time, b.at, b.user_id LIMIT ?`).all(day, limit).map((r, i) => rowOut(r, i + 1, uid));

  // Friends: linked by an invite either way, plus players met in a finished trade, trade room or live race (small,
  // bounded reads).
  function friendIds(uid) {
    const ids = new Set();
    const ref = q('SELECT referrer_id FROM users WHERE id = ?').get(uid)?.referrer_id;
    if (ref) ids.add(ref);
    for (const r of q('SELECT id FROM users WHERE referrer_id = ? LIMIT 500').all(uid)) ids.add(r.id);
    for (const r of q("SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END id FROM trades WHERE status = 'done' AND (from_id = ? OR to_id = ?) LIMIT 300").all(uid, uid, uid)) ids.add(r.id);
    for (const r of q("SELECT CASE WHEN host_id = ? THEN guest_id ELSE host_id END id FROM trade_rooms WHERE status = 'done' AND (host_id = ? OR guest_id = ?) LIMIT 300").all(uid, uid, uid)) ids.add(r.id);
    for (const r of q("SELECT CASE WHEN creator_id = ? THEN opponent_id ELSE creator_id END id FROM pvp WHERE status = 'done' AND (creator_id = ? OR opponent_id = ?) LIMIT 300").all(uid, uid, uid)) ids.add(r.id);
    ids.delete(uid);
    ids.delete(null);
    ids.delete(0);
    return [...ids];
  }
  const ofIds = (day, ids) => q(`SELECT b.user_id, b.time, b.at ${BOARD} AND b.user_id IN (SELECT value FROM json_each(?)) ORDER BY b.time, b.at, b.user_id`).all(day, JSON.stringify(ids));
  function friendsBoard(uid, day) {
    const ids = friendIds(uid).slice(0, 500);
    const rows = ofIds(day, [uid, ...ids]);
    const raced = rows.filter((r) => r.user_id !== uid).length;
    return { list: rows.map((r, i) => ({ ...rowOut(r, i + 1, uid), global: placeOf({ day, ...r }) })), friends: ids.length, waiting: ids.length - raced };
  }

  // ---------- ghosts (public/dayrace.js DAYRACE.ghosts) ----------
  // Shown next to the board while it has fewer than `below` real times; never stored, never ranked, never paid. One
  // list per day (kept in memory): yesterday's real times when yesterday's car was of today's class (anonymous, scaled
  // to today's car), the rest from the driver model. Yesterday is over, so its times no longer change.
  const ghostDays = new Map();
  function ghostsOf(day, model = carOf(day)) {
    const G = D.DAYRACE.ghosts;
    if (!G?.n || totalOf(day) >= G.below) return [];
    const key = day + '|' + model;
    if (!ghostDays.has(key)) {
      const y = D.addDays(day, -1);
      const rows = q(`SELECT b.model, b.time ${BOARD} AND b.time < 99 ORDER BY b.time, b.at, b.user_id LIMIT 200`).all(y);
      const same = rows.length && S.MODELS[rows[0].model]?.cls === S.MODELS[model]?.cls;
      const real = same ? D.spread(rows, G.n).map((r) => ({ ghost: true, src: 'yday', name: 'Привид · вчорашній заїзд', time: D.scaleGhost(r.time, r.model, model) })) : [];
      const list = [...real, ...D.aiGhosts(day, model, G.n - real.length)].sort((a, b) => a.time - b.time);
      if (ghostDays.size > 4) ghostDays.clear();
      ghostDays.set(key, list);
    }
    return ghostDays.get(key);
  }

  // ---------- the player's screen and the «Гонки» tile ----------
  const attemptsOf = (used) => ({ used, left: Math.max(0, MAX - used), max: MAX });
  function brief(uid) {
    settle();
    const day = dayOf(now()), model = carOf(day), mine = bestOf(uid, day);
    const ghosts = ghostsOf(day, model);
    return { day, model, ...attemptsOf(triesOf(uid, day)), time: mine?.time ?? null, place: placeOf(mine), total: totalOf(day), endsAt: S.kyivMidnightOf(day, 1), ready: pending(uid).length,
      ghosts: ghosts.length, ghostsBeaten: D.ghostsBeaten(ghosts, mine?.time) };
  }
  function view(uid) {
    settle();
    const day = dayOf(now()), model = carOf(day), mine = bestOf(uid, day), total = totalOf(day);
    const y = D.addDays(day, -1), yRow = bestOf(uid, y), yDay = q('SELECT model, total FROM dayrace_days WHERE day = ?').get(y);
    return {
      day, endsAt: S.kyivMidnightOf(day, 1), car: stockOf(model), tomorrow: D.dayCar(D.addDays(day, 1), loadCars()),
      attempts: attemptsOf(triesOf(uid, day)),
      me: mine ? { time: mine.time, place: placeOf(mine), at: mine.at, dq: !!mine.dq } : null,
      total, topN: D.topCount(total), board: topList(day, uid), friends: friendsBoard(uid, day), ghosts: ghostsOf(day, model),
      yesterday: yRow?.place ? { day: y, model: yRow.model, time: yRow.time, place: yRow.place, field: yRow.field, prize: JSON.parse(yRow.prize || 'null'), claimed: !!yRow.claimed_at }
        : yDay ? { day: y, model: yDay.model, field: yDay.total } : null,
      ready: pending(uid).length,
    };
  }

  // ---------- a run ----------
  // The ghost on the other lane: the next place up (or your own record when you lead); before your first time the
  // middle of the board, or the car's typical run while the board is nearly empty.
  function ghostFor(uid, day, car) {
    const mine = bestOf(uid, day);
    const place = placeOf(mine);
    if (place > 1) {
      const r = atPlace(day, place - 1);
      if (r) return { kind: 'next', name: `${place - 1}-й · ${name(r.user_id)}`, time: r.time };
    }
    if (mine && place != null) return { kind: 'best', name: 'Твій рекорд', time: mine.time };
    const n = totalOf(day);
    if (n >= D.DAYRACE.ghostMin) {
      const r = atPlace(day, Math.floor(n / 2) + 1);
      if (r) return { kind: 'median', name: 'Середина таблиці', time: r.time };
    }
    return { kind: 'par', name: 'Еталон', time: car.et };
  }
  function start(uid) {
    settle();
    startLimit(uid, 'races');
    const t = now(), day = dayOf(t), model = carOf(day);
    const used = triesOf(uid, day);
    if (used >= MAX) fail(`Спроби на сьогодні закінчились (${MAX} з ${MAX}) — нова машина опівночі`);
    q('INSERT INTO dayrace_tries (day, user_id, n) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1').run(day, uid);
    q("UPDATE races SET status = 'expired' WHERE user_id = ? AND status = 'running'").run(uid);
    const car = stockOf(model);
    const ghost = ghostFor(uid, day, car);
    const greenMs = S.RACE_GREEN[0] + Math.floor(rnd() * (S.RACE_GREEN[1] - S.RACE_GREEN[0]));
    const rival = { id: 'dayrace', label: 'Заїзд дня', name: ghost.name, model, hp: car.hp, time: ghost.time, ghost: ghost.kind };
    // rival.me: the stock car fixed at the start (the replay runs on it; myForm counts these runs like any other).
    const rec = { ...rival, dayrace: day, me: { base: car.base, shift: 0 }, greenMs };
    const id = Number(q('INSERT INTO races (user_id, car_id, rival, entry, prize, created_at) VALUES (?, 0, ?, 0, 0, ?)').run(uid, JSON.stringify(rec), t).lastInsertRowid);
    return { raceId: id, car, rival: { ...rival, dayrace: true, look: null }, greenMs, shiftPoints: S.SHIFT_POINTS, attempts: attemptsOf(used + 1) };
  }
  function isRun(uid, raceId) {
    const id = Number(raceId);
    if (!Number.isSafeInteger(id) || id < 1) return false;
    const r = q('SELECT rival FROM races WHERE id = ? AND user_id = ?').get(id, uid);
    try {
      return !!(r && JSON.parse(r.rival).dayrace);
    } catch {
      return false;
    }
  }
  function finish(uid, { raceId, ...body }) {
    const race = q('SELECT * FROM races WHERE id = ? AND user_id = ?').get(int(raceId, 1, 1e15, 'ID заїзду'), uid);
    if (!race || race.status !== 'running') fail('Заїзд уже завершено');
    const rv = JSON.parse(race.rival);
    // The board takes replayed runs only (launch + shift timestamps); an app from before them can't take part.
    if (body.launch == null) fail('Онови гру: у Заїзді дня рахуються лише заїзди з перевіркою');
    const t = now(), elapsed = t - race.created_at;
    const stats = rv.me;
    const run = dragRun(stats, rv.greenMs ?? S.RACE_GREEN[0], body, elapsed);
    const expired = elapsed > 3 * 60e3;
    const time = expired ? 99 : run.time;
    const day = rv.dayrace;
    // A run started before midnight and finished after it belongs to a day that is over: shown, not counted.
    const counted = !expired && day === dayOf(t);
    const before = bestOf(uid, day);
    const ghosts = counted ? ghostsOf(day, rv.model) : []; // the ones this run was chasing (they leave at the 5th real time)
    const prevPlace = counted ? placeOf(before) : null;
    let newBest = false;
    if (counted && (!before || time < before.time)) {
      newBest = true;
      const ideal = S.raceTime(stats, S.START.minReaction, Array(S.SHIFTS).fill('perfect'));
      const flag = time <= ideal + D.DAYRACE.flagMargin ? 1 : 0; // near-perfect: the admins can look at it
      q(`INSERT INTO dayrace_best (day, user_id, model, time, at, race_id, flag) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, user_id) DO UPDATE SET model = excluded.model, time = excluded.time, at = excluded.at, race_id = excluded.race_id, flag = excluded.flag`)
        .run(day, uid, rv.model, time, t, race.id, flag);
    }
    const mine = bestOf(uid, day);
    const place = counted ? placeOf(mine) : null;
    const total = totalOf(day);
    let next = null, lead = null;
    if (place > 1) {
      const r = atPlace(day, place - 1);
      if (r) next = { place: place - 1, name: name(r.user_id), time: r.time, gap: round3(mine.time - r.time) };
    } else if (place === 1 && total > 1) {
      const r = atPlace(day, 2);
      if (r) lead = { name: name(r.user_id), time: r.time, gap: round3(r.time - mine.time) };
    }
    const result = {
      win: time < rv.time, time, rivalTime: rv.time, diff: round3(Math.abs(time - rv.time)), prize: 0, entry: 0,
      jump: run.jump, perfectStart: run.perfectStart, reaction: run.reaction, shifts: run.shifts, corrected: run.corrected,
      dayrace: { day, model: rv.model, counted, expired, late: !expired && !counted, newBest, best: mine?.time ?? null, prevBest: before?.time ?? null,
        place, prevPlace, total, next, lead, ghost: rv.ghost, ghosts: ghosts.length ? { n: ghosts.length, beaten: D.ghostsBeaten(ghosts, mine?.time), before: D.ghostsBeaten(ghosts, before?.time) } : null, ghostName: rv.name, attempts: attemptsOf(triesOf(uid, day)) },
    };
    q("UPDATE races SET status = 'done', result = ? WHERE id = ?").run(JSON.stringify(result), race.id);
    // A real drag run: it counts as a race (XP, the «заїзди» tasks), never as a win; no money moves.
    q('UPDATE users SET races = races + 1 WHERE id = ?').run(uid);
    xp(uid, 'race');
    track(uid, 'race');
    const perfect = run.shifts.filter((s) => s === 'perfect').length;
    if (perfect) track(uid, 'perfect', perfect);
    return result;
  }

  // ---------- midnight: places and prizes, exactly once per day ----------
  // A day is settled by inserting its dayrace_days row (INSERT OR IGNORE: only one caller ever gets the change).
  // `settledDay` only skips the look-up once a check found nothing left: a settlement inside a call that later fails
  // is rolled back with it, and the next call does it again.
  let settledDay = null;
  function settle() {
    const today = dayOf(now());
    if (settledDay === today) return 0;
    let n = 0;
    db.tx(() => {
      const days = q('SELECT DISTINCT b.day FROM dayrace_best b LEFT JOIN dayrace_days d ON d.day = b.day WHERE b.day >= ? AND b.day < ? AND d.day IS NULL ORDER BY b.day')
        .all(D.addDays(today, -14), today).map((r) => r.day);
      for (const day of days) n += settleDay(day);
      if (!days.length) settledDay = today;
    });
    return n;
  }
  function settleDay(day) {
    const rows = q(`SELECT b.user_id ${BOARD} ORDER BY b.time, b.at, b.user_id`).all(day);
    const model = q('SELECT model FROM dayrace_best WHERE day = ? LIMIT 1').get(day)?.model || D.dayCar(day, loadCars());
    if (!q('INSERT OR IGNORE INTO dayrace_days (day, model, total, settled_at) VALUES (?, ?, ?, ?)').run(day, model, rows.length, now()).changes) return 0;
    const field = rows.length;
    const save = q('UPDATE dayrace_best SET place = ?, field = ?, prize = ? WHERE day = ? AND user_id = ? AND place IS NULL');
    rows.forEach((r, i) => {
      const place = i + 1, p = D.prizeOf(place, field);
      save.run(place, field, JSON.stringify(p), day, r.user_id);
      if (!p.badge) return;
      // The badge keeps the best place ever reached; the in-game feed says it (no bot message in the night).
      q(`INSERT INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, 'dayrace', ?, ?, NULL, ?, ?)
         ON CONFLICT (user_id, key) DO UPDATE SET title = excluded.title, tier = excluded.tier, place = excluded.place, created_at = excluded.created_at
         WHERE badges.place IS NULL OR excluded.place < badges.place`).run(r.user_id, D.badgeTitle(place), D.badgeTier(place), place, now());
      q('INSERT INTO events (user_id, text, created_at) VALUES (?, ?, ?)')
        .run(r.user_id, `🏁 Заїзд дня ${D.dayLabel(day)}: №${place} з ${field}! Ключ «${S.CASE_BY_ID[p.podiumKey]?.name}» і значок «${D.badgeTitle(place)}» — забери в «Нагородах»`, now());
    });
    return field;
  }

  // ---------- prizes in the rewards center ----------
  function pending(uid) {
    return q('SELECT * FROM dayrace_best WHERE user_id = ? AND day >= ? AND prize IS NOT NULL AND claimed_at IS NULL ORDER BY day')
      .all(uid, D.addDays(dayOf(now()), -D.DAYRACE.keepDays));
  }
  const caseName = (id) => S.CASE_BY_ID[id]?.name || id;
  function prizeText(p) {
    const parts = [`фрагмент ключа «${caseName(p.caseId)}»`];
    if (p.topKey) parts.push(`ключ «${caseName(p.topKey)}»`);
    if (p.podiumKey) parts.push(`ключ «${caseName(p.podiumKey)}»`);
    if (p.badge) parts.push(`значок «${D.badgeTitle(p.badge)}»`);
    return parts.join(' + ');
  }
  function claims(uid) {
    settle();
    return pending(uid).map((r) => ({ key: 'drace:' + r.day, kind: 'drace', id: r.day, title: `Заїзд дня ${D.dayLabel(r.day)}: ${r.place}-й з ${r.field}`, sub: prizeText(JSON.parse(r.prize)) }));
  }
  function claim(uid, { day } = {}) {
    settle();
    if (!D.isDay(day)) fail('Некоректний день');
    const r = bestOf(uid, day);
    if (!r?.prize) fail('Нагорода за цей день ще не готова');
    if (r.claimed_at || !q('UPDATE dayrace_best SET claimed_at = ? WHERE day = ? AND user_id = ? AND claimed_at IS NULL').run(now(), day, uid).changes) fail('Нагороду вже забрано');
    const p = JSON.parse(r.prize);
    const keys = [];
    const fromFrags = p.fragments ? addFragments(uid, p.caseId, p.fragments) : 0;
    if (fromFrags) keys.push({ caseId: p.caseId, count: fromFrags, fragments: true });
    for (const k of [p.topKey, p.podiumKey]) if (k) (addKeys(uid, k, 1), keys.push({ caseId: k, count: 1 }));
    return { day, place: r.place, field: r.field, model: r.model, time: r.time, prize: p, text: prizeText(p), keys, title: `Заїзд дня ${D.dayLabel(day)} · ${r.place}-й` };
  }
  // «Забрати все»: the day prizes first, then everything else; keys join the reveal (before the cars, as there).
  function rewardsAll(uid, base) {
    const got = pending(uid).map((r) => claim(uid, { day: r.day }));
    let r;
    try {
      r = base();
    } catch (e) {
      if (!got.length || !isGameError(e)) throw e;
      r = { n: 0, kinds: [], money: 0, parts: 0, slots: 0, fuel: false, cosmetics: [], reveal: [] };
    }
    if (!got.length) return r;
    const order = { rcase: 0, key: 1, car: 2 };
    const keys = got.flatMap((g) => g.keys.map((k) => ({ kind: 'key', caseId: k.caseId, count: k.count, title: g.title })));
    return { ...r, n: r.n + got.length, kinds: [...r.kinds, ...got.map(() => 'drace')], dayrace: got.map((g) => ({ day: g.day, place: g.place, text: g.text })),
      reveal: [...r.reveal, ...keys].sort((a, b) => order[a.kind] - order[b.kind]) };
  }

  // ---------- the 19:00 bot reminder (src/reminders.js applies quiet hours, 2 a day, idle and opt-outs) ----------
  // Adds a 'dayrace' item for players with the feature open who haven't started a run today, from remindHour on;
  // players with nothing else ready join the list with this one item.
  const firstName = (id) => {
    const u = q('SELECT first_name, username FROM users WHERE id = ?').get(id);
    return u?.first_name || (u?.username ? '@' + u.username : 'Гравець');
  };
  function remindText(uid, day, car, leader) {
    const head = `🏁 Заїзд дня: ${car.name}.`;
    const ids = friendIds(uid);
    const f = ids.length ? ofIds(day, ids)[0] : null;
    if (f) return `${head} Твій друг ${firstName(f.user_id)} — ${D.fmtTime(f.time)} с. Поб’єш?`;
    if (leader) return `${head} Лідер — ${D.fmtTime(leader.time)} с. ${MAX} безкоштовні спроби — поб’єш?`;
    return `${head} Ще ніхто не проїхав — ${MAX} безкоштовні спроби, стань першим!`;
  }
  function remind(list, rules) {
    const t = now();
    if (kyivHour(t) < D.DAYRACE.remindHour) return list;
    settle();
    const day = dayOf(t), car = S.MODELS[carOf(day)];
    const at = S.kyivMidnightOf(day) + D.DAYRACE.remindHour * 3600e3;
    const rows = q(`SELECT u.* FROM users u WHERE u.push_off = 0 AND u.push_blocked = 0 AND u.banned = 0 AND u.level >= ? AND u.last_seen BETWEEN ? AND ?
      AND NOT (u.push_day = ? AND u.push_count >= ?) AND NOT EXISTS (SELECT 1 FROM dayrace_tries r WHERE r.day = ? AND r.user_id = u.id)`)
      .all(S.unlockLevel('dayrace'), t - rules.inactiveDays * 86400e3, t - rules.idleMin * 60e3, day, rules.maxPerDay, day);
    if (!rows.length) return list;
    const byId = new Map(list.map((c) => [c.uid, c]));
    const leader = atPlace(day, 1);
    for (const u of rows) {
      let sent = {};
      try {
        sent = JSON.parse(u.push_sent || '{}') || {};
      } catch {}
      if (sent.dayrace && dayOf(sent.dayrace) === day) continue; // told today already
      if (u.push_last && t - u.push_last < rules.minGapH * 3600e3) continue; // pickReminder would refuse it anyway
      const item = { kind: 'dayrace', at, text: remindText(u.id, day, car, leader) };
      const c = byId.get(u.id);
      if (c) c.ready.push(item);
      else list.push({ uid: u.id, lastSeen: u.last_seen, pushOff: false, blocked: false, pushDay: u.push_day, pushCount: u.push_count, pushLast: u.push_last, sent, ready: [item] });
    }
    return list;
  }

  // ---------- sharing ----------
  // The caption of a shared day result (server share/prepare and the app's fallback): the player's own time only.
  function caption(uid, { day } = {}) {
    const d = D.isDay(day) ? day : dayOf(now());
    const r = bestOf(uid, d);
    if (!r) fail('У цьому Заїзді дня в тебе ще немає часу');
    const place = r.place ?? placeOf(r), total = r.field ?? totalOf(d);
    const m = S.MODELS[r.model];
    return { day: d, model: r.model, time: r.time, place, total,
      caption: `🏁 Заїзд дня ${D.dayLabel(d)}: ${m?.name || r.model} — ${D.fmtTime(r.time)} с${place ? `, ${place}-й з ${total}` : ''}. Поб’єш мій час?\nОднакова машина для всіх, ${MAX} безкоштовні спроби 👇` };
  }

  // ---------- admin ----------
  function adminView() {
    const today = dayOf(now());
    carOf(today);
    const ov = loadCars();
    const schedule = [];
    for (let i = 0; i < 30; i++) {
      const day = D.addDays(today, i), o = ov[day];
      schedule.push({ day, model: D.dayCar(day, ov), scheduled: D.scheduledCar(day), by: o && o.by !== 'auto' ? o.by : null });
    }
    const top = q('SELECT b.user_id, b.time, b.at, b.flag, b.dq, u.banned FROM dayrace_best b JOIN users u ON u.id = b.user_id WHERE b.day = ? ORDER BY b.dq, u.banned, b.time, b.at, b.user_id LIMIT 30')
      .all(today).map((r) => ({ id: r.user_id, name: name(r.user_id), time: r.time, at: r.at, flag: !!r.flag, dq: !!r.dq, banned: !!r.banned }));
    return {
      today, schedule, top, total: totalOf(today), tries: q('SELECT COUNT(*) n, COALESCE(SUM(n), 0) runs FROM dayrace_tries WHERE day = ?').get(today),
      locked: !!q('SELECT 1 FROM dayrace_tries WHERE day = ? LIMIT 1').get(today),
      past: q('SELECT day, model, total, settled_at FROM dayrace_days ORDER BY day DESC LIMIT 10').all(),
      cars: D.CARS, rules: D.DAYRACE,
    };
  }
  function adminSet(who, { day, model }) {
    const today = dayOf(now());
    if (!D.isDay(day) || day < today || day > D.addDays(today, 60)) fail('День: від сьогодні до +60 днів');
    const m = model == null || model === '' ? null : String(model);
    if (m && (!S.MODELS[m] || S.MODELS[m].secret)) fail('Невідома модель');
    if (day === today && q('SELECT 1 FROM dayrace_tries WHERE day = ? LIMIT 1').get(day)) fail('Сьогодні вже є заїзди — машину дня змінити не можна, лише майбутні дні');
    const ov = loadCars();
    const from = D.dayCar(day, ov);
    if (m) ov[day] = { model: m, by: String(who) };
    else delete ov[day];
    saveCars(ov);
    if (day === today) frozenDay = null; // written down again (as the new choice, or the schedule's car) on next use
    const to = D.dayCar(day, ov);
    alog(who, 'dayrace-set', null, { day, from, to });
    return { day, model: to };
  }
  function adminDq(who, { day, id, dq }) {
    if (!D.isDay(day)) fail('Некоректний день');
    if (q('SELECT 1 FROM dayrace_days WHERE day = ?').get(day)) fail('Цей день уже підсумовано');
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    if (!q('UPDATE dayrace_best SET dq = ? WHERE day = ? AND user_id = ?').run(dq ? 1 : 0, day, uid).changes) fail('Результату немає');
    alog(who, 'dayrace-dq', uid, { day, dq: !!dq });
    return {};
  }

  return {
    api: { dayrace: view, 'dayrace/start': start, 'dayrace/claim': claim, 'dayrace/caption': caption },
    gates: { 'dayrace/start': 'dayrace' },
    admin: { dayrace: () => adminView(), 'dayrace/set': adminSet, 'dayrace/dq': adminDq },
    mutating: ['dayrace/set', 'dayrace/dq'],
    isRun, finish, settle, brief, claims, rewardsAll, remind, carOf, friendIds,
  };
}
