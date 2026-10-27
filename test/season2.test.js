// Season 2 «Нічний Токіо» (S.SEASON_THEMES, SEASON2_CAR_OPTIONS) and the events scheduler (src/schedule.js): the season
// starts by itself when season 1 ends, its car and six cosmetics, season 1 untouched; planned events run through
// S.eventEffects on the server, the default 8-week calendar fits the rules, the admin CRUD refuses what breaks them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { DEFAULT_PLAN } from '../src/schedule.js';
import * as S from '../public/shared.js';
import * as HW from '../public/halloween.js';

const H = 3600e3, DAY = 86400e3;
const K = (iso) => Date.parse(iso + '+02:00'); // Kyiv wall time in winter
const ok = { confirm: true, reason: 'тест розкладу' };

function setup(t0, { seed = false, db = openDb(':memory:') } = {}) {
  const clock = { t: t0 };
  const g = createGame(db, { now: () => clock.t, notify: () => {}, admins: [99], seedSchedule: seed, random: () => 0.5, allUnlocked: true });
  g.ensureUser({ id: 1, first_name: 'U1' });
  db.prepare('UPDATE users SET balance = 1e12, slots = 50, level = 30, level_seen = 30 WHERE id = 1').run();
  const adm = (name, body = {}) => g.adminCall('tg:99', name, body);
  return { db, g, clock, adm, call: (name, body = {}) => g.api[name](1, body) };
}

test('season 2: starts when season 1 ends (2.11 23:00 Kyiv), its car is a real model in a livery', () => {
  const end1 = S.seasonEndOf(1);
  assert.equal(new Date(end1).toISOString(), '2026-11-02T21:00:00.000Z', 'season 1 ends 2.11 at 23:00 Kyiv (start fixed in UTC)');
  assert.equal(S.seasonOf(end1 - 1), 1);
  assert.equal(S.seasonOf(end1), 2);
  assert.equal(new Date(S.seasonEndOf(2)).toISOString(), '2026-11-16T21:00:00.000Z');
  const car1 = S.passReward(1, 30, true).seasonCar, car2 = S.passReward(2, 30, true).seasonCar;
  assert.equal(S.MODELS[car1].name, 'BMW X5 M E70 «Monte Carlo Blue»', 'season 1 prize unchanged');
  assert.equal(car2, S.SEASON2_CAR_OPTIONS[0].id, 'the first option is the default');
  const m = S.MODELS[car2];
  assert.equal(m.season, 2);
  assert.ok(m.secret && m.cls === 'X' && m.filter);
  assert.ok(fs.existsSync(new URL(`../public/cars/${m.img}.webp`, import.meta.url)), 'the livery uses an existing photo');
  assert.equal(S.SEASON2_CAR_OPTIONS.length, 3);
  for (const o of S.SEASON2_CAR_OPTIONS) assert.ok(fs.existsSync(new URL(`../public/cars/${o.img}.webp`, import.meta.url)), o.name);
  assert.ok(!S.ALL_MODELS.filter((x) => !x.season).some((x) => x.id === car2), 'never in a case pool');
});

test('season 2: six themed cosmetics (every 5 levels incl. 30), season 1 keeps its five', () => {
  assert.deepEqual(Object.keys(S.passCosmetics(1)).map(Number), [5, 10, 15, 20, 25]);
  assert.deepEqual(Object.keys(S.passCosmetics(2)).map(Number), [5, 10, 15, 20, 25, 30]);
  const c2 = [5, 10, 15, 20, 25, 30].map((l) => S.passCosmetic(2, l));
  assert.deepEqual(c2.map((c) => c.kind), ['livery', 'frame', 'showcase', 'gold', 'badge', 'glow']);
  assert.equal(new Set(c2.map((c) => c.name)).size, 6);
  assert.ok(c2.every((c) => !/Сезон 2/.test(c.name)), 'themed names');
  assert.equal(S.passCosmetic(1, 5).name, 'Ліврея «Сезон 1»', 'season 1 names unchanged');
  assert.equal(S.passCosmetic(1, 30), null);
  assert.equal(S.styleLook('cos:s1:frame'), 'season');
  assert.equal(S.styleLook('cos:s2:frame'), 'season2');
  assert.equal(S.styleLook('cos:s2:glow'), 'season2');
  assert.equal(S.LIVERY_BY_ID.szn2.name, 'Неон Сібуя');
  assert.equal(S.LIVERY_BY_ID.szn2g.cos, 'cos:s2:gold');
  // The newest season frame / glow is worn by default; an explicit pick wins.
  const claims = ['cos:s1:frame', 'cos:s2:frame', 'cos:s2:glow'];
  assert.deepEqual(S.styleWorn(claims, {}).frame, 'cos:s2:frame');
  assert.deepEqual(S.styleWorn(claims, { frame: 'cos:s1:frame' }).frame, 'cos:s1:frame');
  assert.equal(S.styleWorn(claims, {}).glow, 'cos:s2:glow');
  // Rewards scaled exactly like season 1 (money follows the garage income), level-30 free adds the glow.
  for (let l = 2; l <= 30; l++) {
    for (const rate of [0, 3.5e6]) {
      const a = S.passReward(1, l, false, rate), b = S.passReward(2, l, false, rate);
      assert.equal(b.money, a.money, `free ${l}`);
      assert.equal(b.caseId, a.caseId);
      const pa = S.passReward(1, l, true, rate), pb = S.passReward(2, l, true, rate);
      if (l < 30) assert.deepEqual(pb, pa, `premium ${l}`);
    }
  }
  assert.equal(S.passReward(2, 30, false).cosmetic, 'cos:s2:glow');
});

test('season 2 on the server: the pass rolls over, the car and the cosmetics are given, season 1 items stay', () => {
  const { db, g, clock, call } = setup(Date.parse('2026-10-30T12:00:00Z'));
  // A season-1 player with the X5 M and the season-1 frame.
  const x5 = S.passReward(1, 30, true).seasonCar;
  db.prepare("INSERT INTO claims (user_id, key) VALUES (1, 'cos:s1:frame')").run();
  g.giveCar(1, x5);
  assert.equal(call('season').id, 1);
  clock.t = S.seasonEndOf(1) + 3 * H;
  let s = call('season');
  assert.equal(s.id, 2);
  assert.equal(s.car, S.SEASON2_CAR_OPTIONS[0].id);
  assert.equal(s.level, 1, 'a fresh pass');
  let total = 0;
  for (let l = 1; l < S.SEASON.levels; l++) total += S.passXpFor(l);
  db.prepare('UPDATE users SET season_xp = ?, season_id = 2, premium_season = 2 WHERE id = 1').run(total);
  s = call('season');
  assert.equal(s.level, 30);
  const r = call('season/claim');
  assert.ok(r.got.some((x) => x.carOut?.model === S.SEASON2_CAR_OPTIONS[0].id), 'the season-2 car');
  const me = call('me');
  for (const k of ['livery', 'frame', 'showcase', 'gold', 'badge', 'glow']) assert.ok(me.claims.includes(`cos:s2:${k}`), k);
  assert.ok(me.claims.includes('cos:s1:frame'), 'season 1 frame stays');
  assert.ok(me.cars.some((c) => c.model === x5), 'season 1 car stays');
  assert.ok(db.prepare("SELECT 1 FROM badges WHERE user_id = 1 AND key = 'cos:s2:badge'").get());
});

test('default calendar: 8 weeks from 2.11, after Halloween, no clashes, only existing levers', () => {
  const hw = HW.hwWindow(2026);
  const evs = DEFAULT_PLAN.map((s) => ({ ...s, start: S.kyivParse(s.from), end: S.kyivParse(s.to) }));
  const first = Math.min(...evs.map((e) => e.start)), last = Math.max(...evs.map((e) => e.end));
  assert.ok(first >= hw.end, 'nothing before Halloween ends');
  assert.equal(S.kyivDateOf(first), '2026-11-03');
  assert.equal(S.kyivDateOf(last - 1), '2026-12-27');
  assert.equal(new Set(evs.map((e) => S.kyivMondayOf(e.start))).size, 8, 'eight weeks');
  for (const e of evs) {
    assert.ok(S.EVENTS[e.kind], e.seed);
    assert.ok(e.end > e.start && (e.end - e.start) / H <= S.PLAN_CAPS.hours[1], e.seed);
    assert.ok(e.title && e.title.length <= 48);
  }
  for (const a of evs) for (const b of evs) {
    if (a === b || !(a.start < b.end && b.start < a.end)) continue;
    assert.notEqual(a.kind, b.kind, `${a.seed} / ${b.seed}`);
    assert.ok(!S.EVENT_EXCLUSIVE.some((p) => p.includes(a.kind) && p.includes(b.kind)), `${a.seed} / ${b.seed}`);
    assert.ok(!(a.kind === 'caseday' && b.kind === 'luck'), `${a.seed} / ${b.seed}`);
  }
  // Every week has a country, and the named examples are there.
  for (let w = 1; w <= 8; w++) assert.ok(evs.some((e) => e.seed === `w${w}-country`));
  for (const t of ['Тиждень Японії', 'Вихідні удачі', 'Ніч дрифту: Токіо', 'Старт сезону: подвійний досвід']) assert.ok(evs.some((e) => e.title === t), t);
  // No more generous than the rotation it replaces: luck / race / fuel / plates days over 8 weeks ≤ the rotation's.
  const rot = S.eventsBetween(S.kyivParse('2026-11-02T00:00'), S.kyivParse('2026-12-28T00:00'));
  const days = (list, id, k = 'id') => list.filter((e) => e[k] === id).reduce((n, e) => n + (e.end - e.start), 0) / DAY;
  for (const id of ['luck', 'race', 'fuel', 'plates']) assert.ok(days(evs, id, 'kind') <= days(rot, id) + 0.01, id);
});

test('scheduler on the server: seeded once, applied through eventEffects, the rotation off in planned weeks', () => {
  const db = openDb(':memory:');
  const { g, clock, call } = setup(K('2026-10-26T12:00:00'), { seed: true, db });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM event_plan').get().n, DEFAULT_PLAN.length);
  createGame(db, { now: () => clock.t, notify: () => {}, seedSchedule: true }); // a restart doesn't seed again
  assert.equal(db.prepare('SELECT COUNT(*) n FROM event_plan').get().n, DEFAULT_PLAN.length);
  // Halloween week: the rotation still runs (nothing planned in it).
  assert.ok(call('me').gameEvents.active.some((e) => e.id === 'country' && !e.planned));
  // Tue 3.11: «Тиждень Японії» + double XP from the plan; the rotation's Tue fuel (week B) is off.
  clock.t = K('2026-11-03T12:00:00');
  const act = call('me').gameEvents.active;
  assert.deepEqual(act.map((e) => e.id).sort(), ['country', 'xp']);
  assert.equal(act.find((e) => e.id === 'country').title, 'Тиждень Японії');
  assert.equal(act.find((e) => e.id === 'country').country, 'JP');
  // Double pass XP: the daily bonus gives 2× season XP, the level XP as usual.
  const u0 = db.prepare('SELECT xp, level, season_xp FROM users WHERE id = 1').get();
  call('rewards/daily');
  const u1 = db.prepare('SELECT xp, level, season_xp FROM users WHERE id = 1').get();
  assert.equal(u1.season_xp - (u0.season_xp || 0), 2 * S.XP.daily);
  assert.ok(u1.level > u0.level || u1.xp - u0.xp === S.XP.daily);
  // The country discount through the real deal.
  const jp = S.CASE_BY_ID['c-jp'];
  assert.equal(S.caseDeal(jp, '2026-11-03', S.eventEffects(act)).price, Math.round((jp.price * 0.85) / 1000) * 1000);
  // Case of the day theme on Thu 12.11: «Спорткар».
  clock.t = K('2026-11-12T10:00:00');
  assert.equal(call('me').caseOfDay, 'sport');
  const fx = S.eventEffects(call('me').gameEvents.active);
  assert.equal(S.caseDeal(S.CASE_BY_ID.sport, '2026-11-12', fx).price, 1800000);
  assert.equal(S.caseDeal(S.CASE_BY_ID.sport, '2026-11-12', fx).why, 'day');
  // Drift night Fri 6.11 18:00–24:00: drift prizes +25%, drag unchanged.
  const car = g.giveCar(1, S.ALL_MODELS.find((m) => m.cls === 'B' && !m.secret).id).id;
  clock.t = K('2026-11-06T16:00:00');
  const d0 = call('drift/rivals', { carId: car }).list, r0 = call('race/rivals', { carId: car }).list;
  clock.t = K('2026-11-06T20:00:00');
  const d1 = call('drift/rivals', { carId: car }).list, r1 = call('race/rivals', { carId: car }).list;
  for (let i = 0; i < d0.length; i++) assert.equal(d1[i].prize, Math.round((d0[i].prize * 1.25) / 1000) * 1000);
  for (let i = 0; i < r0.length; i++) assert.equal(r1[i].prize, r0[i].prize);
  // Luck weekend from the plan: no case of the day.
  clock.t = K('2026-11-07T12:00:00');
  assert.equal(call('me').caseOfDay, null);
  // After the 8 weeks: the rotation is back.
  clock.t = K('2027-01-05T12:00:00');
  assert.ok(call('me').gameEvents.active.some((e) => e.id === 'country' && !e.planned));
});

test('scheduler admin: create, edit, delete, preview; refuses clashes, Halloween, the past; helpers only look', () => {
  const { db, g, clock, adm, call } = setup(K('2027-01-04T10:00:00'));
  const v0 = adm('schedule');
  assert.equal(v0.upcoming.length, 0);
  assert.equal(v0.weeks.length, 8);
  assert.ok(v0.weeks.every((w) => w.mode === 'auto'));
  assert.throws(() => adm('schedule/save', { kind: 'luck', start: '2027-01-09T00:00', end: '2027-01-11T00:00' }), /підтвердження|confirm|причин/i);
  const { id } = adm('schedule/save', { kind: 'luck', title: 'Зимові вихідні удачі', start: '2027-01-09T00:00', end: '2027-01-11T00:00', ...ok });
  let v = adm('schedule');
  assert.equal(v.upcoming.length, 1);
  assert.equal(v.upcoming[0].title, 'Зимові вихідні удачі');
  assert.ok(v.upcoming[0].preview.some((l) => /×1,3/.test(l)));
  assert.equal(v.weeks[0].mode, 'plan');
  assert.ok(!v.weeks[0].events.some((e) => e.id === 'country'), 'the planned week has no rotation');
  // Clashes.
  assert.throws(() => adm('schedule/save', { kind: 'luck', start: '2027-01-10T00:00', end: '2027-01-12T00:00', ...ok }), /Уже заплановано/);
  assert.throws(() => adm('schedule/save', { kind: 'caseday', caseId: 'elite', start: '2027-01-10T00:00', end: '2027-01-11T00:00', ...ok }), /кейс дня/);
  adm('schedule/save', { kind: 'race', start: '2027-01-16T00:00', end: '2027-01-18T00:00', ...ok });
  assert.throws(() => adm('schedule/save', { kind: 'fuel', start: '2027-01-17T00:00', end: '2027-01-18T00:00', ...ok }), /Не можна одночасно/);
  assert.throws(() => adm('schedule/save', { kind: 'xp', start: '2027-10-30T00:00', end: '2027-10-31T00:00', ...ok }), /Хелловін/);
  assert.throws(() => adm('schedule/save', { kind: 'xp', start: '2027-01-01T00:00', end: '2027-01-02T00:00', ...ok }), /минул|закінчилась/);
  assert.throws(() => adm('schedule/save', { kind: 'xp', start: '2027-01-20T00:00', end: '2027-01-29T00:00', ...ok }), /Тривалість/);
  assert.throws(() => adm('schedule/save', { kind: 'country', start: '2027-01-20T00:00', end: '2027-01-21T00:00', ...ok }), /країну/);
  assert.throws(() => adm('schedule/save', { kind: 'caseday', caseId: 'starter', start: '2027-01-20T00:00', end: '2027-01-21T00:00', ...ok }), /рідкістю/);
  assert.throws(() => adm('schedule/save', { kind: 'nope', start: '2027-01-20T00:00', end: '2027-01-21T00:00', ...ok }), /Невідомий/);
  // Edit: move the luck weekend; helpers can look but not change.
  adm('schedule/save', { id, kind: 'luck', title: '', start: '2027-01-23T00:00', end: '2027-01-25T00:00', ...ok });
  v = adm('schedule');
  const e = v.upcoming.find((x) => x.planId === id);
  assert.equal(e.startLocal, '2027-01-23T00:00');
  assert.equal(e.title, 'Вихідні удачі');
  g.ensureUser({ id: 5, first_name: 'H' });
  db.prepare("UPDATE users SET role = 'helper' WHERE id = 5").run();
  assert.ok(g.adminCall('tg:5', 'schedule', {}).upcoming.length);
  assert.throws(() => g.adminCall('tg:5', 'schedule/delete', { id, ...ok }), /прав/);
  // It runs on its dates, can be stopped (not deleted) while running.
  clock.t = K('2027-01-23T12:00:00');
  const live = call('me').gameEvents.active.find((x) => x.id === 'luck');
  assert.ok(live?.planned);
  assert.throws(() => adm('schedule/delete', { id, ...ok }), /зупини/);
  adm('game-events/stop', { key: live.key, ...ok });
  assert.ok(!call('me').gameEvents.active.some((x) => x.id === 'luck'));
  // Delete a future one; everything is in the admin log.
  const race = adm('schedule').upcoming.find((x) => x.id === 'race');
  assert.equal(race, undefined, 'the race weekend of 16.01 is over');
  const { id: id2 } = adm('schedule/save', { kind: 'drift', start: '2027-01-29T18:00', end: '2027-01-30T00:00', ...ok });
  adm('schedule/delete', { id: id2, ...ok });
  assert.ok(!adm('schedule').upcoming.some((x) => x.planId === id2));
  const acts = db.prepare("SELECT action FROM admin_log WHERE action LIKE 'plan-%'").all().map((r) => r.action);
  assert.deepEqual([...new Set(acts)].sort(), ['plan-add', 'plan-delete', 'plan-edit']);
});

test('scheduler: the default calendar can be brought back, deleted slots return, nothing doubles', () => {
  const { db, adm } = setup(K('2026-10-27T10:00:00'));
  let r = adm('schedule/seed', ok);
  assert.equal(r.added, DEFAULT_PLAN.length);
  assert.equal(r.skipped.length, 0);
  const one = db.prepare("SELECT id FROM event_plan WHERE seed = 'w2-race'").get().id;
  adm('schedule/delete', { id: one, ...ok });
  assert.equal(adm('schedule').defaults.missing, 1);
  r = adm('schedule/seed', ok);
  assert.equal(r.added, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM event_plan').get().n, DEFAULT_PLAN.length);
  // eventPreview covers every kind with real numbers.
  for (const id of S.EVENT_IDS) assert.ok(S.eventPreview({ id, country: 'JP', caseId: 'sport' }).length, id);
  assert.match(S.eventPreview({ id: 'caseday', caseId: 'sport' })[0], /2 млн → 1,8 млн|2,0 млн → 1,8 млн|→/);
});
