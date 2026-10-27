// Admin events scheduler (Season 2 live-ops): planned game events in the table event_plan, created / edited / deleted in
// the admin panel («Події»). The game puts them into the events override (ov.planned) and the server applies them through
// the same S.eventsBetween → S.eventEffects as the weekly rotation: a Kyiv week with something planned runs by the plan,
// a week with nothing planned keeps the rotation. Only the existing levers exist (S.EVENTS, clamped by S.EVENT_CAPS /
// S.PLAN_CAPS): no case price, odds table or sell rate is touched beyond what the events already did.
// The default 8-week calendar (DEFAULT_PLAN, from 2.11.2026, after «Ніч Хелловіну») is seeded once on the live server
// (createGame opts.seedSchedule) and can be brought back from the panel; every slot has a seed id, so nothing doubles.
import * as S from '../public/shared.js';
import * as HW from '../public/halloween.js';

// Kyiv wall times. Week 1 starts on Tuesday 3.11: Monday 2.11 is still «Ніч Хелловіну» (till 23:59) — no overlap.
// Seasons in this window: S2 till 16.11 23:00, S3 till 30.11, S4 till 14.12, S5 till 28.12 (S.seasonEndOf).
const W = (seed, kind, from, to, title, params = {}) => ({ seed, kind, from, to, title, ...params });
export const DEFAULT_PLAN = [
  // Week 1 · старт Сезону 2 «Нічний Токіо»
  W('w1-country', 'country', '2026-11-03T00:00', '2026-11-09T00:00', 'Тиждень Японії', { country: 'JP' }),
  W('w1-xp', 'xp', '2026-11-03T00:00', '2026-11-05T00:00', 'Старт сезону: подвійний досвід'),
  W('w1-drift', 'drift', '2026-11-06T18:00', '2026-11-07T00:00', 'Ніч дрифту: Токіо'),
  W('w1-luck', 'luck', '2026-11-07T00:00', '2026-11-09T00:00', 'Вихідні удачі'),
  // Week 2
  W('w2-country', 'country', '2026-11-09T00:00', '2026-11-16T00:00', 'Тиждень Німеччини', { country: 'DE' }),
  W('w2-plates', 'plates', '2026-11-10T00:00', '2026-11-11T00:00', 'Щасливі номери'),
  W('w2-caseday', 'caseday', '2026-11-12T00:00', '2026-11-13T00:00', 'День спорткарів', { caseId: 'sport' }),
  W('w2-race', 'race', '2026-11-14T00:00', '2026-11-16T00:00', 'Гоночний уїкенд: фінал сезону'),
  // Week 3 · старт Сезону 3
  W('w3-country', 'country', '2026-11-16T00:00', '2026-11-23T00:00', 'Тиждень Італії', { country: 'IT' }),
  W('w3-xp', 'xp', '2026-11-17T00:00', '2026-11-19T00:00', 'Подвійний досвід'),
  W('w3-fuel', 'fuel', '2026-11-19T00:00', '2026-11-20T00:00', 'Подвійне паливо'),
  W('w3-drift', 'drift', '2026-11-20T18:00', '2026-11-21T00:00', 'Ніч дрифту'),
  W('w3-luck', 'luck', '2026-11-21T00:00', '2026-11-23T00:00', 'Вихідні удачі'),
  // Week 4
  W('w4-country', 'country', '2026-11-23T00:00', '2026-11-30T00:00', 'Тиждень США', { country: 'US' }),
  W('w4-plates', 'plates', '2026-11-24T00:00', '2026-11-25T00:00', 'Щасливі номери'),
  W('w4-caseday', 'caseday', '2026-11-26T00:00', '2026-11-27T00:00', 'День преміуму', { caseId: 'premium' }),
  W('w4-race', 'race', '2026-11-28T00:00', '2026-11-30T00:00', 'Гоночний уїкенд'),
  // Week 5 · старт Сезону 4
  W('w5-country', 'country', '2026-11-30T00:00', '2026-12-07T00:00', 'Тиждень Британії', { country: 'GB' }),
  W('w5-xp', 'xp', '2026-12-01T00:00', '2026-12-03T00:00', 'Подвійний досвід'),
  W('w5-fuel', 'fuel', '2026-12-03T00:00', '2026-12-04T00:00', 'Подвійне паливо'),
  W('w5-drift', 'drift', '2026-12-04T18:00', '2026-12-05T00:00', 'Ніч дрифту'),
  W('w5-luck', 'luck', '2026-12-05T00:00', '2026-12-07T00:00', 'Вихідні удачі'),
  // Week 6
  W('w6-country', 'country', '2026-12-07T00:00', '2026-12-14T00:00', 'Тиждень України', { country: 'UA' }),
  W('w6-plates', 'plates', '2026-12-08T00:00', '2026-12-09T00:00', 'Щасливі номери'),
  W('w6-caseday', 'caseday', '2026-12-10T00:00', '2026-12-11T00:00', 'День тюнінгу', { caseId: 'tuning' }),
  W('w6-race', 'race', '2026-12-12T00:00', '2026-12-14T00:00', 'Гоночний уїкенд'),
  // Week 7 · старт Сезону 5
  W('w7-country', 'country', '2026-12-14T00:00', '2026-12-21T00:00', 'Тиждень Китаю', { country: 'CN' }),
  W('w7-xp', 'xp', '2026-12-15T00:00', '2026-12-17T00:00', 'Подвійний досвід'),
  W('w7-fuel', 'fuel', '2026-12-17T00:00', '2026-12-18T00:00', 'Подвійне паливо'),
  W('w7-drift', 'drift', '2026-12-18T18:00', '2026-12-19T00:00', 'Ніч дрифту'),
  W('w7-luck', 'luck', '2026-12-19T00:00', '2026-12-21T00:00', 'Вихідні удачі'),
  // Week 8 · перед святами
  W('w8-country', 'country', '2026-12-21T00:00', '2026-12-28T00:00', 'Тиждень Японії: реванш', { country: 'JP' }),
  W('w8-plates', 'plates', '2026-12-22T00:00', '2026-12-23T00:00', 'Щасливі номери'),
  W('w8-caseday', 'caseday', '2026-12-24T00:00', '2026-12-25T00:00', 'Святвечір: День Еліти', { caseId: 'elite' }),
  W('w8-race', 'race', '2026-12-26T00:00', '2026-12-28T00:00', 'Різдвяний гоночний уїкенд'),
];

const DAY = 86400e3;
const SEED_META = 'event_plan_seeded';
const parse = (v) => {
  try {
    const o = JSON.parse(v || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
};

export function createSchedule(ctx) {
  const { q, now, fail, alog, metaGet, metaSet, ov, onChange } = ctx;
  const toEvent = (r) => {
    const p = parse(r.params);
    return { key: `plan:${r.id}`, id: r.kind, start: r.start, end: r.end, planId: r.id,
      ...(p.country ? { country: p.country } : {}), ...(p.caseId ? { caseId: p.caseId } : {}), ...(r.title ? { title: r.title } : {}) };
  };
  // What the game runs: planned events that can still matter (the longest one is 7 days).
  const planned = () => q('SELECT * FROM event_plan WHERE end > ? ORDER BY start, id').all(now() - 8 * DAY).map(toEvent);

  // A clean event from the admin's form (or a seed slot); fails with a reason the admin can act on.
  function check(b, exceptId = null) {
    const kind = String(b.kind ?? '');
    if (!Object.hasOwn(S.EVENTS, kind)) fail('Невідомий тип події');
    const start = typeof b.start === 'number' ? b.start : S.kyivParse(b.start);
    const end = typeof b.end === 'number' ? b.end : S.kyivParse(b.end);
    if (start == null || end == null) fail('Вкажи початок і кінець (дата й час, Київ)');
    const [hMin, hMax] = S.PLAN_CAPS.hours;
    const h = (end - start) / 3600e3;
    if (h < hMin || h > hMax) fail(`Тривалість — від ${hMin} год до ${hMax / 24} днів`);
    if (end <= now()) fail('Подія вже закінчилась би — обери майбутні дати');
    const title = String(b.title ?? '').trim().replace(/\s+/g, ' ');
    if (title.length > 48) fail('Назва — до 48 символів');
    const ev = { kind, start, end, title: title || null, params: {} };
    if (kind === 'country') {
      const c = String(b.country ?? '').toUpperCase();
      if (!S.MAIN_COUNTRIES.includes(c)) fail('Обери країну');
      ev.params.country = c;
    }
    if (kind === 'caseday') {
      const cs = S.CASE_BY_ID[String(b.caseId ?? '')];
      if (!cs || cs.group !== 'rarity' || cs.starter) fail('Обери кейс за рідкістю');
      ev.params.caseId = cs.id;
    }
    // «Ніч Хелловіну» is its own event: nothing planned on top of it.
    for (const y of new Set([S.kyivDateOf(start), S.kyivDateOf(end - 1)].map((d) => Number(d.slice(0, 4))))) {
      const w = HW.hwWindow(y);
      if (start < w.end && end > w.start) fail(`Перетинається з «${HW.HALLOWEEN.name}» (${S.kyivLocal(w.start).slice(5, 10)}–${S.kyivLocal(w.end - 1).slice(5, 10)}) — обери інші дати`);
    }
    const others = q('SELECT * FROM event_plan WHERE end > ? AND start < ? AND id IS NOT ?').all(start, end, exceptId).map(toEvent);
    for (const o of others) {
      const name = o.title || S.EVENTS[o.id].name, when = `${S.kyivLocal(o.start).replace('T', ' ')} – ${S.kyivLocal(o.end).replace('T', ' ')}`;
      if (o.id === kind) fail(`Уже заплановано «${name}» (${when}) — дві однакові події не йдуть одночасно`);
      if (S.EVENT_EXCLUSIVE.some((p) => p.includes(kind) && p.includes(o.id))) fail(`Не можна одночасно з «${name}» (${when})`);
      if ((kind === 'caseday' && o.id === 'luck') || (kind === 'luck' && o.id === 'caseday')) fail(`«Вихідні удачі» вимикають кейс дня — перетин з «${name}» (${when})`);
    }
    if (others.length >= S.PLAN_CAPS.parallel) fail(`У цей час уже ${others.length} подій — не більше ${S.PLAN_CAPS.parallel} одночасно`);
    return ev;
  }
  const changed = () => onChange?.(planned());
  const view = (r) => {
    const e = toEvent(r), t = now();
    return { planId: r.id, ...S.eventInfo({ ...e, planned: true }), preview: S.eventPreview(e), seed: r.seed || null, note: r.note || '',
      startLocal: S.kyivLocal(r.start), endLocal: S.kyivLocal(r.end), state: r.end <= t ? 'past' : r.start <= t ? 'live' : 'next',
      stopped: ov()?.stopped?.[e.key] != null };
  };

  function insert(ev, who, seed = null) {
    const t = now();
    return Number(q('INSERT INTO event_plan (kind, title, start, end, params, seed, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ev.kind, ev.title, ev.start, ev.end, JSON.stringify(ev.params), seed, String(who), t).lastInsertRowid);
  }
  // The default calendar: every slot not in the table yet and not over, if it fits next to what's already planned.
  function seed(who = 'system') {
    const added = [], skipped = [];
    for (const s of DEFAULT_PLAN) {
      if (q('SELECT 1 FROM event_plan WHERE seed = ?').get(s.seed)) continue;
      const start = S.kyivParse(s.from), end = S.kyivParse(s.to);
      if (end <= now()) continue;
      try {
        const ev = check({ kind: s.kind, start, end, title: s.title, country: s.country, caseId: s.caseId });
        insert(ev, who, s.seed);
        added.push(s.seed);
      } catch (e) {
        skipped.push({ seed: s.seed, title: s.title, why: e.message });
      }
    }
    metaSet(SEED_META, String(now()));
    changed();
    return { added: added.length, skipped };
  }
  // Seeded once per database (the live server passes opts.seedSchedule); the panel can bring missing slots back.
  function seedOnce() {
    if (metaGet(SEED_META)) return null;
    return seed('system');
  }

  // ---------- admin ----------
  function adminView() {
    const t = now();
    const rows = q('SELECT * FROM event_plan ORDER BY start, id').all();
    const upcoming = rows.filter((r) => r.end > t).map(view);
    const past = rows.filter((r) => r.end <= t).slice(-10).reverse().map(view);
    // The next 8 Kyiv weeks as players will get them: by the plan or by the weekly rotation.
    const pw = S.planWeeks(ov()?.planned) || new Set();
    const weeks = [];
    let m = S.kyivMondayOf(t);
    for (let i = 0; i < 8; i++) {
      const a = S.kyivMidnightOf(m), b = S.kyivMidnightOf(m, 7);
      weeks.push({ monday: m, mode: pw.has(m) ? 'plan' : 'auto',
        events: S.eventsBetween(a, b, ov()).filter((e) => e.start >= a || i === 0).map((e) => ({ ...S.eventInfo(e), stopped: !!e.stopped })) });
      m = S.kyivDateOf(b);
    }
    const hy = HW.hwYearOf(t), hw = HW.hwWindow(hy);
    return {
      now: t, nowLocal: S.kyivLocal(t), caps: S.PLAN_CAPS,
      kinds: Object.fromEntries(S.EVENT_IDS.map((id) => [id, { name: S.EVENTS[id].name, text: S.EVENTS[id].text, icon: S.EVENTS[id].icon, color: S.EVENTS[id].color, hours: S.EVENTS[id].days * 24 }])),
      countries: S.MAIN_COUNTRIES.map((c) => ({ id: c, name: S.COUNTRIES[c]?.name || c })),
      cases: S.CASES.filter((c) => c.group === 'rarity' && !c.starter).map((c) => ({ id: c.id, name: c.name, price: c.price })),
      upcoming, past, weeks,
      halloween: { name: HW.HALLOWEEN.name, start: hw.start, end: hw.end, startLocal: S.kyivLocal(hw.start), endLocal: S.kyivLocal(hw.end - 60e3), done: t >= hw.end },
      season: { id: S.seasonOf(t), endsAt: S.seasonEndOf(S.seasonOf(t)), endLocal: S.kyivLocal(S.seasonEndOf(S.seasonOf(t))) },
      defaults: { total: DEFAULT_PLAN.length, missing: DEFAULT_PLAN.filter((s) => S.kyivParse(s.to) > t && !rows.some((r) => r.seed === s.seed)).length },
    };
  }
  function adminSave(who, b) {
    const id = b.id == null || b.id === '' ? null : Number(b.id);
    if (id != null) {
      const r = q('SELECT * FROM event_plan WHERE id = ?').get(id);
      if (!r) fail('Подію не знайдено');
      if (r.end <= now()) fail('Подія вже минула — її не змінити');
      // A running event keeps its start (it already began); its end, title and settings can change.
      const live = r.start <= now();
      if (live && String(b.kind ?? r.kind) !== r.kind) fail('Подія вже йде — тип не змінити, зупини її й заплануй нову');
      const ev = check({ ...b, ...(live ? { start: r.start } : {}) }, id);
      q('UPDATE event_plan SET kind = ?, title = ?, start = ?, end = ?, params = ?, note = ?, updated_at = ? WHERE id = ?')
        .run(ev.kind, ev.title, ev.start, ev.end, JSON.stringify(ev.params), String(b.note ?? '').slice(0, 200) || null, now(), id);
      alog(who, 'plan-edit', null, { id, kind: ev.kind, title: ev.title, start: ev.start, end: ev.end, ...ev.params, was: { kind: r.kind, title: r.title, start: r.start, end: r.end } });
      changed();
      return { id };
    }
    const ev = check(b);
    const nid = insert(ev, who);
    if (b.note) q('UPDATE event_plan SET note = ? WHERE id = ?').run(String(b.note).slice(0, 200), nid);
    alog(who, 'plan-add', null, { id: nid, kind: ev.kind, title: ev.title, start: ev.start, end: ev.end, ...ev.params });
    changed();
    return { id: nid };
  }
  function adminDelete(who, { id }) {
    const r = q('SELECT * FROM event_plan WHERE id = ?').get(Number(id));
    if (!r) fail('Подію не знайдено');
    if (r.start <= now() && r.end > now()) fail('Подія вже йде — зупини її кнопкою «Зупинити» (так гравці побачать коректний кінець)');
    q('DELETE FROM event_plan WHERE id = ?').run(r.id);
    alog(who, 'plan-delete', null, { id: r.id, kind: r.kind, title: r.title, start: r.start, end: r.end });
    changed();
    return {};
  }
  function adminSeed(who) {
    const r = seed(who);
    alog(who, 'plan-seed', null, { added: r.added, skipped: r.skipped.length });
    return r;
  }

  return {
    planned, seed, seedOnce, check,
    admin: { schedule: () => adminView(), 'schedule/save': adminSave, 'schedule/delete': adminDelete, 'schedule/seed': adminSeed },
    mutating: ['schedule/save', 'schedule/delete', 'schedule/seed'],
  };
}
