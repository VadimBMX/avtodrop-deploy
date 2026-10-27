// «Турнір вихідних» on the server (the rules — schedule, sizes, prizes — are in public/tourney.js, shared with the app).
// Registration Fri 18:00 → Sat 12:00 Kyiv, free, one car (its class is the bracket). At 12:00 the brackets are drawn:
// players seeded by their car's base time, empty seats filled with bots (a real car of the class from the honest rival
// roster S.rivalCandidates near the entrants' median, a driver of S.rivalDriver skill — the stronger the seed, the
// better the driver). Rounds run in fixed windows (TOURNEY.stages), asynchronously: each side has TOURNEY.tries drag
// runs, the best time counts, every run is raced against the ghost of the other side's best run (G.ghostPlan — the same
// stored-run replay as the ghost challenges) or a bot's time fixed when the match opens. A run is an ordinary drag
// race in `races` (rival.tourney = the match): game.js sends race/finish for it here and it goes through the same
// dragRun as every drag race (server green light, launch + shift timestamps replayed, the server's clock). A match is
// decided as soon as its result can't change, else at the deadline (no time = a loss; neither — the higher seed).
// Everything advances lazily, like the day race: tick() on every call (and every few minutes from the reminders'
// scheduler) draws the week, opens the rounds whose window began, closes the ones whose deadline passed; the final's
// result pays the bracket's prizes once (tourney_brackets.done_at + one tourney_prizes row per player are the guards).
import crypto from 'node:crypto';
import * as S from '../public/shared.js';
import * as G from '../public/ghost.js';
import * as TR from '../public/tourney.js';

const T = TR.TOURNEY;
const h32 = (s) => parseInt(crypto.createHash('sha256').update(s).digest('hex').slice(0, 8), 16);
const round3 = (x) => Math.round(x * 1000) / 1000;
const HM = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hhmm = (t) => HM.format(new Date(t));
const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const whenText = (t) => `${WD[new Date(S.kyivDateOf(t) + 'T00:00:00Z').getUTCDay()]} ${hhmm(t)}`;
const SIDES = ['a', 'b'];
const other = (s) => (s === 'a' ? 'b' : 'a');
const parse = (v) => {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y), n = a.length;
  return n % 2 ? a[n >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

// ctx: the game's own helpers (src/game.js passes them in; nothing here reaches into the game otherwise).
export function createTourney(ctx) {
  const { q, now, rnd, fail, int, name, ownCar, carOut, carRow, dragRun, startLimit, addMoney, addKeys, grantCosmetic, event, xp, track, userRow } = ctx;

  const matchRow = (id) => q('SELECT * FROM tourney_matches WHERE id = ?').get(id) || null;
  const bracketRow = (tid, br) => q('SELECT * FROM tourney_brackets WHERE tid = ? AND bracket = ?').get(tid, br) || null;
  const entryOf = (tid, uid) => q('SELECT * FROM tourney_entries WHERE tid = ? AND user_id = ?').get(tid, uid) || null;
  // The player's latest match of a week (the one that matters: current, or the one he went out in).
  const myMatch = (tid, uid) => q('SELECT * FROM tourney_matches WHERE tid = ? AND (a_uid = ? OR b_uid = ?) ORDER BY round DESC LIMIT 1').get(tid, uid, uid) || null;
  const sideOfUid = (m, uid) => (m.a_uid === uid ? 'a' : m.b_uid === uid ? 'b' : null);
  const sideName = (p) => (!p ? '—' : p.bot ? p.bot.name : name(p.uid));
  // The car a player's side races with as the bracket last saw it: his best run's car, else his entry's car.
  function carOfUid(tid, uid) {
    const e = entryOf(tid, uid);
    const c = e && carRow(e.car_id);
    const o = c && c.owner_id === uid ? carOut(c) : null;
    return o || (e ? { id: 0, model: e.model, look: null } : null);
  }
  const snapOf = (c) => ({ model: c.model, cls: S.MODELS[c.model].cls, hp: c.hp, kg: c.kg, base: c.base, shift: c.shift || 0, parts: c.parts || {}, look: c.look || null });

  // ---------- bots: honest cars, honest drivers ----------
  function makeBots(tid, bracket, cls, n, mid) {
    if (n <= 0) return [];
    const pool = S.rivalCandidates(cls).filter((c) => c.cls === cls && c.kit !== 'tuned');
    const rand = S.seededRand(h32(`bots:${tid}:${bracket}`));
    const names = [...S.RIVAL_NAMES];
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    return Array.from({ length: n }, (_, j) => {
      const f = n > 1 ? j / (n - 1) : 0;
      const target = mid * (1 + T.botSlow[0] + (T.botSlow[1] - T.botSlow[0]) * f);
      const near = pool.map((c) => [Math.abs(c.base - target), c]).sort((x, y) => x[0] - y[0]).slice(0, 4);
      const c = near[Math.floor(rand() * near.length)][1];
      const skill = Math.round((T.botSkill[1] - (T.botSkill[1] - T.botSkill[0]) * f) * 100) / 100;
      const nm = names[j % names.length] + (j >= names.length ? ` ${Math.floor(j / names.length) + 1}` : '');
      return { bot: { name: nm, model: c.model, parts: c.parts, hp: c.hp, base: c.base, skill, driver: S.rivalLevel(skill) } };
    });
  }
  // A bot's run in a match: the rival AI of its skill in its car, from a seed of the match (the same on every replay).
  const botTime = (m, s, p) => S.rivalRun(S.seededRand(h32(`run:${m.tid}:${m.bracket}:${m.round}:${m.slot}:${s}`)), { base: p.bot.base, shift: 0, ai: S.rivalDriver(p.bot.skill) });

  // ---------- the draw (Sat 12:00) ----------
  function build(tid) {
    if (now() < TR.regCloseOf(tid) || q('SELECT 1 FROM tourney_weeks WHERE tid = ?').get(tid)) return 0;
    const entries = q('SELECT e.* FROM tourney_entries e JOIN users u ON u.id = e.user_id WHERE e.tid = ? AND u.banned = 0 ORDER BY e.at, e.user_id').all(tid);
    q('INSERT INTO tourney_weeks (tid, built_at, field) VALUES (?, ?, ?)').run(tid, now(), entries.length);
    for (const cls of S.CLASS_ORDER) {
      const list = entries.filter((e) => e.cls === cls).map((e) => {
        const c = carOfUid(tid, e.user_id);
        return { e, base: c?.base ?? S.carStats({ model: e.model }).base };
      }).sort((x, y) => x.base - y.base || x.e.at - y.e.at);
      if (!list.length) continue;
      const groups = Math.ceil(list.length / T.sizes[1]);
      for (let g = 0; g < groups; g++) {
        const members = list.filter((_, i) => i % groups === g);
        const bracket = groups > 1 ? `${cls}${g + 1}` : cls;
        const size = TR.sizeFor(members.length);
        const bots = makeBots(tid, bracket, cls, size - members.length, median(members.map((x) => x.base)));
        const seeds = [...members.map((x) => ({ uid: x.e.user_id })), ...bots].map((p, i) => ({ ...p, seed: i + 1 }));
        q('INSERT INTO tourney_brackets (tid, bracket, cls, size, humans) VALUES (?, ?, ?, ?, ?)').run(tid, bracket, cls, size, members.length);
        const order = TR.seedOrder(size), w = TR.windowOf(tid, size, 0);
        for (let k = 0; k < size / 2; k++) {
          const a = seeds[order[2 * k] - 1], b = seeds[order[2 * k + 1] - 1];
          q('INSERT INTO tourney_matches (tid, bracket, round, slot, opens_at, deadline, a, a_uid, b, b_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(tid, bracket, 0, k, w.opens, w.deadline, JSON.stringify(a), a.uid ?? null, JSON.stringify(b), b.uid ?? null);
          for (const [me, op] of [[a, b], [b, a]]) {
            if (me.uid) event(me.uid, `🏆 Турнір вихідних: ти в сітці класу ${cls} (${size} учасників, посів №${me.seed}). ${TR.roundName(size, 0)} — ${whenText(w.opens)}–${hhmm(w.deadline)}, суперник — ${sideName(op)}`);
          }
        }
      }
    }
    return 1;
  }

  // ---------- a match: open, decide, advance ----------
  function stateOf(m, s) {
    const p = parse(m[s]);
    const live = m[s + '_live'];
    return { s, p, best: m[s + '_best'], at: m[s + '_at'], seed: p?.seed ?? 99,
      done: !!p?.bot || (m[s + '_tries'] >= T.tries && !(live && now() - live < T.runMs + 5e3)) };
  }
  const better = (x, y) => x.best != null && (y.best == null || x.best < y.best || (x.best === y.best && x.at < y.at));
  // [winner (0 = a, 1 = b), how] or null while the result can still change.
  function verdict(m, force) {
    const A = stateOf(m, 'a'), B = stateOf(m, 'b');
    const bySeed = () => [A.seed < B.seed ? 0 : 1, 'noshow2'];
    if (force || (A.done && B.done)) {
      if (A.best == null && B.best == null) return bySeed();
      if (A.best == null || B.best == null) return [A.best == null ? 1 : 0, 'noshow'];
      return [better(A, B) ? 0 : 1, 'time'];
    }
    if (A.done && better(B, A)) return [1, A.best == null ? 'noshow' : 'time'];
    if (B.done && better(A, B)) return [0, B.best == null ? 'noshow' : 'time'];
    return null;
  }
  function decide(m, force = false) {
    if (!m || m.status !== 'open') return 0;
    const v = verdict(m, force);
    if (!v) return 0;
    if (!q("UPDATE tourney_matches SET status = 'done', winner = ?, how = ?, decided_at = ? WHERE id = ? AND status = 'open'").run(v[0], v[1], now(), m.id).changes) return 0;
    advance(matchRow(m.id));
    return 1;
  }
  function advance(m) {
    const br = bracketRow(m.tid, m.bracket);
    const ws = m.winner ? 'b' : 'a';
    if (m.round >= TR.roundsOf(br.size) - 1) return finishBracket(br, m, ws);
    const r = m.round + 1, slot = m.slot >> 1, side = m.slot & 1 ? 'b' : 'a';
    const w = TR.windowOf(m.tid, br.size, r);
    q('INSERT OR IGNORE INTO tourney_matches (tid, bracket, round, slot, opens_at, deadline) VALUES (?, ?, ?, ?, ?, ?)').run(m.tid, m.bracket, r, slot, w.opens, w.deadline);
    q(`UPDATE tourney_matches SET ${side} = ?, ${side}_uid = ? WHERE tid = ? AND bracket = ? AND round = ? AND slot = ? AND ${side} IS NULL`)
      .run(m[ws], m[ws + '_uid'], m.tid, m.bracket, r, slot);
  }
  function openDue() {
    const t = now();
    const due = q("SELECT * FROM tourney_matches WHERE status = 'wait' AND opens_at <= ? AND a IS NOT NULL AND b IS NOT NULL ORDER BY id").all(t);
    for (const m of due) {
      for (const s of SIDES) {
        const p = parse(m[s]);
        if (p.bot) q(`UPDATE tourney_matches SET ${s}_best = ?, ${s}_at = ?, ${s}_tries = ? WHERE id = ?`).run(botTime(m, s, p), m.opens_at, T.tries, m.id);
      }
      if (!q("UPDATE tourney_matches SET status = 'open' WHERE id = ? AND status = 'wait'").run(m.id).changes) continue;
      const br = bracketRow(m.tid, m.bracket), final = TR.stageOf(br.size, m.round) === 0;
      if (t < m.deadline) {
        for (const s of SIDES) {
          const uid = m[s + '_uid'];
          if (!uid) continue;
          const op = sideName(parse(m[other(s)]));
          event(uid, final ? `🔥 Ти у фіналі Турніру вихідних (клас ${br.cls})! Суперник — ${op}. ${T.tries} спроби до ${hhmm(m.deadline)}, пальне не потрібне`
            : `🏁 Турнір вихідних: твій матч ${TR.roundName(br.size, m.round)} готовий — суперник ${op}. ${T.tries} спроби до ${hhmm(m.deadline)}, пальне не потрібне`);
        }
      }
      decide(matchRow(m.id));
    }
    return due.length;
  }
  function closeDue() {
    const rows = q("SELECT * FROM tourney_matches WHERE status = 'open' AND deadline <= ? ORDER BY id").all(now());
    for (const m of rows) decide(m, true);
    return rows.length;
  }
  // Everything that is due, until nothing changes (a closed round may feed a round that is already due).
  function tick() {
    const t = now(), tid = TR.tidOf(t);
    let n = build(tid) + build(TR.addDays(tid, -7)), guard = 0;
    do n = openDue() + closeDue();
    while (n && ++guard < 40);
    return guard;
  }

  // ---------- prizes: once per bracket, once per player ----------
  function finishBracket(br, m, ws) {
    const p = parse(m[ws]);
    const run = parse(m[ws + '_run']);
    const champ = p.bot ? { bot: true, name: p.bot.name, model: p.bot.model, time: m[ws + '_best'] }
      : { uid: p.uid, name: name(p.uid), model: run?.car?.model || carOfUid(m.tid, p.uid)?.model || null, time: m[ws + '_best'] };
    if (!q('UPDATE tourney_brackets SET champion = ?, done_at = ? WHERE tid = ? AND bracket = ? AND done_at IS NULL').run(JSON.stringify(champ), now(), br.tid, br.bracket).changes) return;
    payBracket(br, p.bot ? null : p.uid);
  }
  function payBracket(br, champUid) {
    const all = q('SELECT * FROM tourney_matches WHERE tid = ? AND bracket = ? ORDER BY round, slot').all(br.tid, br.bracket);
    const humans = new Set(all.filter((m) => m.round === 0).flatMap((m) => [m.a_uid, m.b_uid]).filter(Boolean));
    for (const uid of humans) {
      const mine = all.filter((m) => sideOfUid(m, uid));
      const played = mine.some((m) => m[sideOfUid(m, uid) + '_tries'] > 0);
      const lost = mine.find((m) => m.status === 'done' && m.winner !== (sideOfUid(m, uid) === 'a' ? 0 : 1));
      const place = uid === champUid ? 1 : lost ? TR.placeOfLoss(br.size, lost.round) : TR.placeOfLoss(br.size, 0);
      const pz = TR.prizeFor(br.cls, place, played);
      if (!q('INSERT OR IGNORE INTO tourney_prizes (tid, user_id, bracket, cls, place, prize, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(br.tid, uid, br.bracket, br.cls, place, JSON.stringify(pz), now()).changes) continue;
      if (!pz.money && !pz.keys.length) continue;
      if (pz.money) addMoney(uid, pz.money);
      for (const k of pz.keys) addKeys(uid, k, 1);
      if (pz.badge) {
        const [title, tier] = TR.BADGE[pz.badge];
        q(`INSERT INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, 'tourney', ?, ?, NULL, ?, ?)
           ON CONFLICT (user_id, key) DO UPDATE SET title = excluded.title, tier = excluded.tier, place = excluded.place, created_at = excluded.created_at
           WHERE badges.place IS NULL OR excluded.place < badges.place`).run(uid, title, tier, place, now());
      }
      if (pz.frame) grantCosmetic(uid, T.frame);
      const keys = pz.keys.map((k) => `ключ «${S.CASE_BY_ID[k]?.name || k}»`).join(', ');
      event(uid, place === 1
        ? `🏆 Ти чемпіон Турніру вихідних (клас ${br.cls})! +${S.fmt(pz.money)}, ${keys}, значок «${TR.BADGE[1][0]}» і рамка номера «Чемпіон»`
        : `🏁 Турнір вихідних (клас ${br.cls}): ${TR.placeText(place).toLowerCase()}. Нагорода: +${S.fmt(pz.money)}${keys ? `, ${keys}` : ''}`);
    }
  }

  // ---------- a run ----------
  // What the other lane holds: a bot's fixed time, the ghost of the other player's best run, or — before his first
  // run — his car's typical time (it decides nothing: the match waits for his run or the deadline).
  function laneOf(m, o) {
    const p = parse(m[o]);
    const base = { id: 'tourney', label: 'Турнір' };
    if (p.bot) return { ...base, kind: 'bot', name: p.bot.name, model: p.bot.model, parts: p.bot.parts, hp: p.bot.hp, base: p.bot.base, shift: 0, look: null, time: m[o + '_best'], driver: p.bot.driver };
    const run = parse(m[o + '_run']);
    if (run && m[o + '_best'] != null) {
      const c = run.car;
      return { ...base, kind: 'ghost', name: name(p.uid), model: c.model, parts: c.parts, hp: c.hp, base: c.base, shift: c.shift, look: c.look, time: m[o + '_best'],
        plan: G.ghostPlan(c, run.reaction, run.shiftAt, run.shifts) };
    }
    const c = carOfUid(m.tid, p.uid) || {};
    const st = c.base ? c : S.carStats({ model: c.model });
    return { ...base, kind: 'par', name: name(p.uid), model: c.model, parts: c.parts || {}, hp: st.hp, base: st.base, shift: st.shift || 0, look: c.look || null,
      time: m[o + '_best'] ?? st.et };
  }
  const triesOut = (used) => ({ used, left: Math.max(0, T.tries - used), max: T.tries });
  function start(uid, { carId } = {}) {
    tick();
    startLimit(uid, 'races');
    const tid = TR.tidOf(now());
    const m = myMatch(tid, uid);
    if (!m || m.status === 'done') fail('Зараз у тебе немає матчу');
    if (m.status === 'wait') fail(`Матч відкриється ${whenText(m.opens_at)}`);
    if (now() >= m.deadline) fail('Час матчу вийшов');
    const s = sideOfUid(m, uid);
    if (m[s + '_tries'] >= T.tries) fail('Спроби в цьому матчі закінчились — чекай на суперника');
    const br = bracketRow(tid, m.bracket);
    const e = entryOf(tid, uid);
    const c = ownCar(uid, carId ?? e?.car_id);
    const car = carOut(c);
    if (TR.bracketCls(S.MODELS[car.model].cls) !== br.cls) fail(`У цій сітці їдуть лише машини класу ${br.cls}`);
    q("UPDATE races SET status = 'expired' WHERE user_id = ? AND status = 'running'").run(uid);
    q(`UPDATE tourney_matches SET ${s}_tries = ${s}_tries + 1, ${s}_live = ? WHERE id = ?`).run(now(), m.id);
    const lane = laneOf(m, other(s));
    const greenMs = S.RACE_GREEN[0] + Math.floor(rnd() * (S.RACE_GREEN[1] - S.RACE_GREEN[0]));
    const rec = { ...lane, tourney: m.id, side: s, round: TR.roundName(br.size, m.round), cls: br.cls, me: snapOf(car), greenMs };
    const raceId = Number(q('INSERT INTO races (user_id, car_id, rival, entry, prize, created_at) VALUES (?, ?, ?, 0, 0, ?)').run(uid, c.id, JSON.stringify(rec), now()).lastInsertRowid);
    return { raceId, car, rival: { ...lane, tourney: true, round: rec.round }, greenMs, shiftPoints: S.SHIFT_POINTS, tries: triesOut(m[s + '_tries'] + 1) };
  }
  function isRun(uid, raceId) {
    const id = Number(raceId);
    if (!Number.isSafeInteger(id) || id < 1) return false;
    const r = q('SELECT rival FROM races WHERE id = ? AND user_id = ?').get(id, uid);
    return !!(r && parse(r.rival)?.tourney);
  }
  function finish(uid, { raceId, ...body }) {
    const race = q('SELECT * FROM races WHERE id = ? AND user_id = ?').get(int(raceId, 1, 1e15, 'ID заїзду'), uid);
    if (!race || race.status !== 'running') fail('Заїзд уже завершено');
    const rv = JSON.parse(race.rival);
    if (body.launch == null || !Array.isArray(body.shiftAt)) fail('Онови гру: у турнірі рахуються лише заїзди з перевіркою');
    const t = now(), elapsed = t - race.created_at;
    const run = dragRun(rv.me, rv.greenMs, body, elapsed); // the server's own replay: a forged report gets the true time
    const expired = elapsed > T.runMs;
    const time = expired ? 99 : run.time;
    const s = rv.side, o = other(s);
    let m = matchRow(rv.tourney);
    const counted = !!m && !expired && m.status === 'open' && t < m.deadline;
    const before = m?.[s + '_best'] ?? null;
    let newBest = false;
    if (counted && (before == null || time < before)) {
      newBest = true;
      const reaction = S.reactionOf(Number(body.launch), rv.greenMs);
      const shiftAt = body.shiftAt.map(Number);
      const plan = G.ghostPlan(rv.me, reaction, shiftAt, run.shifts);
      // The ghost the other side will race: kept only if its replay ends exactly at the judged time.
      const ghost = Math.abs(plan.time - time) <= 0.0005 ? JSON.stringify({ reaction, shiftAt, shifts: plan.shifts, car: rv.me }) : null;
      q(`UPDATE tourney_matches SET ${s}_best = ?, ${s}_at = ?, ${s}_run = ? WHERE id = ?`).run(time, t, ghost, m.id);
    }
    if (m) q(`UPDATE tourney_matches SET ${s}_live = NULL WHERE id = ?`).run(m.id);
    if (m && m.status === 'open') {
      m = matchRow(m.id);
      // The other player hears once that there is a time to beat (only while he still has runs and time).
      const ou = m[o + '_uid'], sent = parse(m.sent) || {};
      if (newBest && before == null && ou && !sent['ran_' + s] && m[o + '_tries'] < T.tries) {
        q('UPDATE tourney_matches SET sent = ? WHERE id = ?').run(JSON.stringify({ ...sent, ['ran_' + s]: t }), m.id);
        event(ou, `👻 Турнір: ${name(uid)} проїхав за ${TR.fmtTime(time)} с — твоя черга до ${hhmm(m.deadline)}`);
      }
      decide(m);
    }
    m = m && matchRow(m.id);
    const br = m && bracketRow(m.tid, m.bracket);
    const decided = m?.status === 'done';
    const won = decided ? m.winner === (s === 'a' ? 0 : 1) : null;
    let next = null;
    if (won && br && m.round < TR.roundsOf(br.size) - 1) next = { name: TR.roundName(br.size, m.round + 1), ...TR.windowOf(m.tid, br.size, m.round + 1) };
    const result = {
      win: time < rv.time, time, rivalTime: rv.time, diff: round3(Math.abs(time - rv.time)), prize: 0, entry: 0,
      jump: run.jump, perfectStart: run.perfectStart, reaction: run.reaction, shifts: run.shifts, corrected: run.corrected,
      tourney: { match: rv.tourney, round: rv.round, cls: rv.cls, kind: rv.kind, opponent: rv.name, counted, expired, late: !expired && !counted,
        newBest, best: m?.[s + '_best'] ?? null, prevBest: before, oppTime: m?.[o + '_best'] ?? null, tries: triesOut(m?.[s + '_tries'] ?? T.tries),
        decided, won, how: m?.how || null, next, champion: !!(won && !next), deadline: m?.deadline ?? null },
    };
    q("UPDATE races SET status = 'done', result = ? WHERE id = ?").run(JSON.stringify(result), race.id);
    // A real drag run: it counts as a race (XP, the «заїзди» tasks), never as a win; no money moves here.
    q('UPDATE users SET races = races + 1 WHERE id = ?').run(uid);
    xp(uid, 'race');
    track(uid, 'race');
    const perfect = run.shifts.filter((x) => x === 'perfect').length;
    if (perfect) track(uid, 'perfect', perfect);
    return result;
  }

  // ---------- registration ----------
  function join(uid, { carId } = {}) {
    tick();
    const tid = TR.tidOf(now());
    if (TR.phaseAt(tid, now()) !== 'reg') fail(`Реєстрація — з п'ятниці 18:00 до суботи 12:00`);
    if ((userRow(uid).level || 1) < T.minLevel) fail(`Турнір — з ${T.minLevel}-го рівня`);
    const c = ownCar(uid, carId);
    const cls = TR.bracketCls(S.MODELS[c.model].cls);
    q('INSERT INTO tourney_entries (tid, user_id, car_id, model, cls, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (tid, user_id) DO UPDATE SET car_id = excluded.car_id, model = excluded.model, cls = excluded.cls')
      .run(tid, uid, c.id, c.model, cls, now());
    return view(uid);
  }
  function leave(uid) {
    tick();
    const tid = TR.tidOf(now());
    if (TR.phaseAt(tid, now()) !== 'reg') fail('Сітки вже складено — вийти не можна');
    q('DELETE FROM tourney_entries WHERE tid = ? AND user_id = ?').run(tid, uid);
    return view(uid);
  }

  // ---------- the screen ----------
  function sideOut(m, s, uid) {
    const p = parse(m[s]);
    if (!p) return null;
    const run = parse(m[s + '_run']);
    const model = p.bot ? p.bot.model : run?.car?.model || carOfUid(m.tid, p.uid)?.model || null;
    return { name: sideName(p), bot: !!p.bot, me: !!p.uid && p.uid === uid, uid: p.uid || null, seed: p.seed, model, driver: p.bot?.driver || null,
      time: m.status === 'wait' ? null : m[s + '_best'], tries: p.bot ? null : m[s + '_tries'] };
  }
  const matchOut = (m, uid) => ({ id: m.id, round: m.round, slot: m.slot, status: m.status, opens: m.opens_at, deadline: m.deadline, winner: m.winner, how: m.how,
    a: sideOut(m, 'a', uid), b: sideOut(m, 'b', uid) });
  function treeOf(tid, bracket, uid) {
    const br = bracketRow(tid, bracket);
    if (!br) return null;
    const rows = q('SELECT * FROM tourney_matches WHERE tid = ? AND bracket = ? ORDER BY round, slot').all(tid, bracket);
    const rounds = Array.from({ length: TR.roundsOf(br.size) }, (_, r) => {
      const n = br.size >> (r + 1);
      return { round: r, name: TR.roundName(br.size, r), ...TR.windowOf(tid, br.size, r),
        matches: Array.from({ length: n }, (_, k) => {
          const m = rows.find((x) => x.round === r && x.slot === k);
          return m ? matchOut(m, uid) : null;
        }) };
    });
    return { bracket: br.bracket, cls: br.cls, size: br.size, humans: br.humans, champion: parse(br.champion), done: !!br.done_at, rounds };
  }
  // My match now: whose lane, what time to beat, runs left; or how far I got.
  function mineOf(tid, uid) {
    const m = myMatch(tid, uid);
    if (!m) return null;
    const br = bracketRow(tid, m.bracket), s = sideOfUid(m, uid), o = other(s);
    const out = { bracket: m.bracket, cls: br.cls, size: br.size, round: m.round, roundName: TR.roundName(br.size, m.round), final: TR.stageOf(br.size, m.round) === 0, match: matchOut(m, uid),
      tries: triesOut(m[s + '_tries']), best: m[s + '_best'], status: m.status };
    if (m.status === 'open') {
      const lane = laneOf(m, o);
      out.lane = { kind: lane.kind, name: lane.name, model: lane.model, hp: lane.hp, time: lane.time, driver: lane.driver || null };
      out.canRun = m[s + '_tries'] < T.tries && now() < m.deadline;
    }
    if (m.status === 'done') {
      const won = m.winner === (s === 'a' ? 0 : 1);
      out.won = won;
      out.champion = won && out.final;
      if (won && !out.final) out.next = { name: TR.roundName(br.size, m.round + 1), ...TR.windowOf(tid, br.size, m.round + 1) };
      if (!won) out.place = TR.placeOfLoss(br.size, m.round);
      if (out.champion) out.place = 1;
    }
    const pz = q('SELECT place, prize FROM tourney_prizes WHERE tid = ? AND user_id = ?').get(tid, uid);
    if (pz) ((out.place = pz.place), (out.prize = parse(pz.prize)));
    return out;
  }
  function hall() {
    const rows = q('SELECT tid, bracket, cls, champion FROM tourney_brackets WHERE done_at IS NOT NULL ORDER BY tid DESC, bracket LIMIT ?').all(T.hall);
    const titles = new Map(q("SELECT user_id, COUNT(*) n FROM tourney_prizes WHERE place = 1 GROUP BY user_id").all().map((r) => [r.user_id, r.n]));
    return rows.map((r) => {
      const c = parse(r.champion) || {};
      return { tid: r.tid, bracket: r.bracket, cls: r.cls, name: c.name, uid: c.uid || null, bot: !!c.bot, model: c.model, time: c.time, titles: c.uid ? titles.get(c.uid) || 1 : 0 };
    });
  }
  function view(uid, { bracket } = {}) {
    tick();
    const t = now(), tid = TR.shownTid(t), phase = TR.phaseAt(tid, t);
    const nextTid = TR.tidOf(t) === tid ? TR.addDays(tid, 7) : TR.tidOf(t);
    const e = entryOf(tid, uid);
    const brackets = q('SELECT bracket, cls, size, humans, done_at FROM tourney_brackets WHERE tid = ?').all(tid)
      .sort((x, y) => S.CLASS_ORDER.indexOf(x.cls) - S.CLASS_ORDER.indexOf(y.cls) || x.bracket.localeCompare(y.bracket))
      .map((b) => ({ bracket: b.bracket, cls: b.cls, size: b.size, humans: b.humans, done: !!b.done_at }));
    const my = mineOf(tid, uid);
    const pick = brackets.find((b) => b.bracket === bracket)?.bracket || my?.bracket || brackets[0]?.bracket || null;
    const counts = Object.fromEntries(q('SELECT cls, COUNT(*) n FROM tourney_entries WHERE tid = ? GROUP BY cls').all(tid).map((r) => [r.cls, r.n]));
    return {
      tid, phase, now: t, regOpen: TR.regOpenOf(tid), regClose: TR.regCloseOf(tid), end: TR.endOf(tid), nextTid, nextRegOpen: TR.regOpenOf(nextTid),
      level: userRow(uid).level || 1, entry: e ? { carId: e.car_id, cls: e.cls, model: e.model, at: e.at } : null,
      counts, field: Object.values(counts).reduce((a, n) => a + n, 0), brackets, bracket: pick ? treeOf(tid, pick, uid) : null, my, hall: hall(),
    };
  }
  // The «Гонки» tile: phase, my registration, my match.
  function brief(uid) {
    tick();
    const t = now(), tid = TR.shownTid(t), phase = TR.phaseAt(tid, t);
    const e = entryOf(tid, uid), my = mineOf(tid, uid);
    const nextTid = TR.tidOf(t) === tid ? TR.addDays(tid, 7) : TR.tidOf(t);
    return { tid, phase, regClose: TR.regCloseOf(tid), end: TR.endOf(tid), nextRegOpen: TR.regOpenOf(nextTid), entry: e ? e.cls : null,
      my: my ? { roundName: my.roundName, status: my.status, final: my.final, canRun: !!my.canRun, tries: my.tries, opens: my.match.opens, deadline: my.match.deadline,
        lane: my.lane ? { name: my.lane.name, time: my.lane.time, kind: my.lane.kind } : null, won: my.won ?? null, place: my.place ?? null, champion: !!my.champion } : null };
  }

  return {
    api: { tourney: view, 'tourney/join': join, 'tourney/leave': leave, 'tourney/start': start },
    isRun, finish, tick, brief, view,
  };
}
