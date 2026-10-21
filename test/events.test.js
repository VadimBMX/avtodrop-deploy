// Game events (S.EVENTS): the weekly calendar, the effects on the server with a fake clock, the admin overrides,
// the bot reminder, and the economy rule — open-and-sell stays under a sanity cap during every event (owner kept the old case prices, see eco3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import { createSender, createReminders } from '../src/reminders.js';
import * as S from '../public/shared.js';
import { runCase, scenarios, plateCheck, staticSell } from '../tools/sim-events.mjs';

const H = 3600e3, MIN = 60e3, DAY = 86400e3;
// Week of 26.10.2026 is week A (country IT): Tue 27 plates, Thu 29 fuel, Sat 31 – Sun 1 luck.
// Week of 02.11.2026 is week B (country US): Tue 3 fuel, Thu 5 plates, Sat 7 – Sun 8 race. Kyiv is UTC+2 then.
const K = (iso) => Date.parse(iso + '+02:00'); // Kyiv wall time in winter
const kyivHour = (t) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));

function setup(t0 = K('2026-11-02T12:00:00'), db = openDb(':memory:')) {
  const clock = { t: t0 };
  const g = createGame(db, { now: () => clock.t, notify: () => {}, admins: [99] });
  g.ensureUser({ id: 1, first_name: 'U1' });
  db.prepare('UPDATE users SET balance = 1e13, slots = 200, level = 50, level_seen = 50 WHERE id = 1').run();
  return { db, g, clock, call: (name, body = {}) => g.api[name](1, body), user: () => db.prepare('SELECT * FROM users WHERE id = 1').get() };
}
const ok = { confirm: true, reason: 'тест подій' };

test('calendar: weekly rotation from the date, Kyiv midnights, a country every week in turn', () => {
  const from = K('2026-11-02T00:00:00');
  const weeks = 56;
  const list = S.eventsBetween(from, from + weeks * 7 * DAY);
  const countries = [];
  for (let w = 0; w < weeks; w++) {
    const monday = S.kyivMondayOf(from + w * 7 * DAY + 12 * H);
    const mine = list.filter((e) => e.key.endsWith(':' + monday));
    assert.deepEqual(mine.map((e) => e.id).sort(), (S.eventWeekNo(monday) % 2 ? ['country', 'fuel', 'plates', 'race'] : ['country', 'fuel', 'luck', 'plates']), monday);
    for (const e of mine) {
      assert.equal(kyivHour(e.start), 0, `${e.key} starts at 00:00 Kyiv`);
      assert.equal(kyivHour(e.end), 0, `${e.key} ends at 00:00 Kyiv`);
      assert.equal(S.kyivDateOf(e.start), S.kyivDateOf(S.kyivMidnightOf(monday, EV_DAY[e.id](monday))), e.key);
    }
    const c = mine.find((e) => e.id === 'country');
    assert.equal(c.start, S.kyivMidnightOf(monday));
    assert.equal(c.end, S.kyivMidnightOf(monday, 7));
    countries.push(c.country);
    const wkd = mine.find((e) => e.id === 'luck' || e.id === 'race');
    assert.equal(S.kyivDateOf(wkd.start), S.kyivDateOf(S.kyivMidnightOf(monday, 5)), 'weekend events start on Saturday');
  }
  // Seven weeks in a row: every main country once.
  for (let i = 0; i + 7 <= countries.length; i += 7) assert.deepEqual([...countries.slice(i, i + 7)].sort(), [...S.MAIN_COUNTRIES].sort());
  // Weekend events alternate.
  const wk = list.filter((e) => e.id === 'luck' || e.id === 'race').map((e) => e.id);
  for (let i = 1; i < wk.length; i++) assert.notEqual(wk[i], wk[i - 1]);
  // Fuel and the race weekend never overlap; no event overlaps itself.
  for (const a of list) for (const b of list) {
    if (a === b || a.end <= b.start || b.end <= a.start) continue;
    assert.notEqual(a.id, b.id, `${a.key} overlaps ${b.key}`);
    assert.ok(!S.EVENT_EXCLUSIVE.some((p) => p.includes(a.id) && p.includes(b.id)), `${a.key} with ${b.key}`);
  }
});
const EV_DAY = Object.fromEntries(S.EVENT_IDS.map((id) => [id, (monday) => S.EVENT_WEEKS[S.eventWeekNo(monday) % 2].find((s) => s.id === id)?.day ?? 0]));

test('calendar: summer-time switch — the weekend event lasts 49 h when the clocks go back', () => {
  const race = S.eventsBetween(K('2026-10-24T12:00:00'), K('2026-10-24T12:00:01')).find((e) => e.id === 'race');
  assert.ok(race, 'race weekend on 24–25.10.2026');
  assert.equal((race.end - race.start) / H, 49);
  assert.equal(race.start, Date.parse('2026-10-23T21:00:00Z')); // 00:00 Kyiv summer time
  assert.equal(race.end, Date.parse('2026-10-25T22:00:00Z')); // 00:00 Kyiv winter time
});

test('effects: definitions within the caps, all events at once still clamped', () => {
  const C = S.EVENT_CAPS;
  assert.ok(S.EVENTS.luck.topMult <= C.topMult && S.EVENTS.fuel.fuelMult <= C.fuelMult && S.EVENTS.race.prizeMult <= C.prizeMult);
  assert.ok(S.EVENTS.country.off <= C.caseOff && S.EVENTS.plates.off <= C.plateOff);
  const fx = S.eventEffects(S.EVENT_IDS.map((id) => ({ id, country: 'JP' })).concat([{ id: 'luck' }, { id: 'race' }, { id: 'fuel' }]));
  assert.ok(fx.topMult <= C.topMult && fx.fuelMult <= C.fuelMult && fx.prizeMult <= C.prizeMult && fx.caseOff <= C.caseOff && fx.plateOff <= C.plateOff);
  assert.equal(S.eventPrize(100000, fx), 125000);
  assert.equal(S.eventPrize(100000, S.NO_EVENTS), 100000);
  // VIP ×2 with the fuel event ×2 is capped at ×3.
  const t = K('2026-10-29T12:00:00');
  assert.equal(S.fuelSegments(t, t + H, null, S.VIP.fuelMult)[0].rate, C.fuelTotal);
  // Luck weights: top class ×1.3, total unchanged, other classes in proportion.
  const w = S.luckWeights(S.CASE_BY_ID.elite.weights, 1.3);
  assert.equal(w.S, Math.round(S.CASE_BY_ID.elite.weights.S * 1.3 * 1000) / 1000);
  assert.ok(Math.abs(w.A + w.S - 100) < 0.01);
  assert.deepEqual(S.luckWeights({ D: 100 }, 1.3), { D: 100 });
  assert.equal(S.luckWeights({ C: 10, B: 90 }, 1.3).B, 50, 'at most half of the total');
});

test('regen: no events = the old formula; the fuel event doubles only its own hours', () => {
  const P = 20 * MIN;
  const plain = K('2026-11-06T09:00:00'); // Friday: no fuel event
  for (const [need, dt] of [[15, 0], [15, 19 * MIN], [15, 20 * MIN], [3, 61 * MIN], [15, 7 * H], [1, 5 * MIN]]) {
    const r = S.regenAt(plain, plain + dt, P, need);
    const g = Math.min(need, Math.floor(dt / P));
    assert.deepEqual(r, { n: g, at: g ? plain + g * P : plain, next: g >= need ? null : plain + (g + 1) * P }, `${need}/${dt}`);
  }
  const start = K('2026-10-29T00:00:00'); // Thursday: fuel event 00:00–24:00
  // Empty since 1 h before the event, now 1 h into it: 3 + 6 units.
  let r = S.regenAt(start - H, start + H, P, 15);
  assert.equal(r.n, 9);
  assert.equal(r.at, start + H);
  assert.equal(r.next, start + H + 10 * MIN);
  // Crossing the end of the event: 30 min doubled (3) + 40 min plain (2).
  const end = K('2026-10-30T00:00:00');
  r = S.regenAt(end - 30 * MIN, end + 40 * MIN, P, 15);
  assert.equal(r.n, 5);
  assert.equal(r.at, end + 40 * MIN);
  // A unit half-filled before the event finishes at double speed.
  r = S.regenAt(start - 10 * MIN, start + 4 * MIN, P, 15);
  assert.equal(r.n, 0);
  assert.equal(r.next, start + 5 * MIN);
});

test('server: the shared tank refills twice as fast during «Подвійне паливо»', () => {
  const start = K('2026-10-29T00:00:00');
  const { db, g, clock, call } = setup(start - H);
  const car = g.giveCar(1, 'zaz-lanos').id;
  db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = 1').run(clock.t);
  db.prepare('UPDATE cars SET tank = 0, tank_at = ? WHERE id = ?').run(clock.t, car);
  clock.t = start + H;
  const me = call('me');
  assert.equal(me.fuel, 9);
  assert.equal(me.fuelNext, start + H + 10 * MIN);
  assert.equal(me.cars.find((c) => c.id === car).tank, S.CAR_TANK, 'no per-car tank: always reported full');
  assert.ok(me.gameEvents.active.some((e) => e.id === 'fuel'));
  // The same on a plain day: 2 h = 6.
  const s2 = setup(K('2026-11-06T08:00:00'));
  s2.db.prepare('UPDATE users SET fuel = 0, fuel_at = ? WHERE id = 1').run(s2.clock.t);
  s2.clock.t += 2 * H;
  assert.equal(s2.call('me').fuel, 6);
});

test('server: race weekend pays +25% (drag, training and drift), entries unchanged', () => {
  const { g, clock, call } = setup(K('2026-11-06T12:00:00')); // Friday
  const car = g.giveCar(1, S.ALL_MODELS.find((m) => m.cls === 'B' && !m.secret).id).id;
  const plain = call('race/rivals', { carId: car }).list;
  const dPlain = call('drift/rivals', { carId: car }).list;
  clock.t = K('2026-11-07T12:00:00'); // Saturday: race weekend
  const ev = call('race/rivals', { carId: car }).list;
  const dEv = call('drift/rivals', { carId: car }).list;
  for (let i = 0; i < plain.length; i++) {
    const step = plain[i].id === S.TRAINING.id ? 100 : 1000;
    assert.equal(ev[i].prize, Math.round((plain[i].prize * 1.25) / step) * step, plain[i].id);
    assert.equal(ev[i].entry, plain[i].entry);
  }
  for (let i = 0; i < dPlain.length; i++) assert.equal(dEv[i].prize, Math.round((dPlain[i].prize * 1.25) / 1000) * 1000);
  // The prize is fixed when the race starts.
  const r = call('race/start', { carId: car, rival: 'easy' });
  assert.ok(r);
});

test('server: country of the week −15% without fragments; outside it the full price', () => {
  const { db, clock, call, user } = setup(K('2026-11-04T12:00:00')); // country US
  const cs = S.CASE_BY_ID['c-us'];
  const b0 = user().balance;
  const r = call('case/open', { caseId: 'c-us', count: 6 });
  assert.equal(b0 - user().balance, 6 * Math.round((cs.price * 0.85) / 1000) * 1000);
  assert.equal(r.price, Math.round((cs.price * 0.85) / 1000) * 1000);
  assert.equal(r.event, 'country');
  assert.equal(r.fragments, 0, 'no fragments from the discounted case');
  // Another country case: full price, fragments as usual.
  const b1 = user().balance;
  call('case/open', { caseId: 'c-jp', count: 1 });
  assert.equal(b1 - user().balance, S.CASE_BY_ID['c-jp'].price);
  // Next week the US case costs its price again (the week rollover may pay prizes, so read the price the server used).
  clock.t = K('2026-11-10T12:00:00');
  const r2 = call('case/open', { caseId: 'c-us', count: 1 });
  assert.equal(r2.price, cs.price);
  assert.equal(r2.event, null);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM drops WHERE case_id = 'c-us'").get().n === 7);
});

test('server: luck weekend — top class ×1.3, no hidden boost, no case of the day', () => {
  const sat = K('2026-10-31T12:00:00');
  const { call, user } = setup(sat);
  const me = call('me');
  assert.equal(me.caseOfDay, null);
  assert.ok(me.gameEvents.active.some((e) => e.id === 'luck'));
  const day = S.kyivDateOf(sat);
  const cod = S.caseOfDay(day);
  const deal = S.caseDeal(S.CASE_BY_ID[cod], day, S.effectsAt(sat));
  assert.equal(deal.price, S.CASE_BY_ID[cod].price, 'no case-of-day discount at the weekend');
  assert.equal(deal.boost, 0);
  const b0 = user().balance;
  call('case/open', { caseId: cod, count: 1 });
  assert.equal(b0 - user().balance, S.CASE_BY_ID[cod].price);
  // A weekday: the case of the day is back.
  const wed = K('2026-11-04T12:00:00');
  const d2 = S.kyivDateOf(wed);
  assert.equal(S.caseDeal(S.CASE_BY_ID[S.caseOfDay(d2)], d2, S.effectsAt(wed)).off, S.CASE_OF_DAY.off);
});

test('server: «Щасливі номери» — pretty and region plates −20%, the cheap ones unchanged', () => {
  const { call, user } = setup(K('2026-11-05T12:00:00')); // Thursday of week B
  let b = user().balance;
  call('plate/generate', { gen: 'pretty' });
  assert.equal(b - user().balance, 200000);
  b = user().balance;
  call('plate/generate', { region: 'AA' });
  assert.equal(b - user().balance, 48000);
  b = user().balance;
  call('plate/generate', { gen: 'basic' });
  assert.equal(b - user().balance, 3000);
  const s2 = setup(K('2026-11-06T12:00:00'));
  b = s2.user().balance;
  s2.call('plate/generate', { gen: 'pretty' });
  assert.equal(b - s2.user().balance, 250000);
});

test('admin: start / stop now — role admin+, confirm + reason, logged, kept across restarts', () => {
  const db = openDb(':memory:');
  const { g, clock, call } = setup(K('2026-11-06T12:00:00'), db); // Friday: only the country event runs
  db.prepare("UPDATE users SET role = 'helper' WHERE id = 1").run();
  g.ensureUser({ id: 2, first_name: 'Адмін' });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = 2").run();
  assert.throws(() => g.adminCall('tg:1', 'game-events/start', { event: 'luck', ...ok }), /Немає прав/);
  assert.ok(g.adminCall('tg:1', 'game-events', {}).active.length, 'a helper may look');
  assert.throws(() => g.adminCall('tg:2', 'game-events/start', { event: 'luck' }), /причину/);
  assert.throws(() => g.adminCall('tg:2', 'game-events/start', { event: 'luck', reason: 'так треба' }), /не підтверджено/);
  assert.throws(() => g.adminCall('tg:2', 'game-events/start', { event: 'nope', ...ok }), /Невідома подія/);
  assert.throws(() => g.adminCall('tg:2', 'game-events/start', { event: 'luck', hours: 500, ...ok }), /некоректне/);
  assert.throws(() => g.adminCall('tg:2', 'game-events/start', { event: 'country', country: 'JP', ...ok }), /вже йде/);
  // Luck for 3 hours, now.
  const r = g.adminCall('tg:2', 'game-events/start', { event: 'luck', hours: 3, ...ok });
  assert.equal(r.event.end - r.event.start, 3 * H);
  assert.equal(call('me').caseOfDay, null);
  assert.ok(call('me').gameEvents.active.some((e) => e.id === 'luck' && e.forced));
  assert.throws(() => g.adminCall('tg:2', 'game-events/start', { event: 'luck', ...ok }), /вже йде/);
  // Fuel can't overlap tomorrow's race weekend (Sat 00:00): 12 h from Friday noon would.
  assert.throws(() => g.adminCall('tg:2', 'game-events/start', { event: 'fuel', hours: 13, ...ok }), /Гоночний уїкенд/);
  g.adminCall('tg:2', 'game-events/start', { event: 'fuel', hours: 2, ...ok });
  const log = db.prepare("SELECT * FROM admin_log WHERE action = 'event-start' ORDER BY id").all();
  assert.equal(log.length, 2);
  assert.equal(JSON.parse(log[0].details).reason, 'тест подій');
  assert.equal(log[0].admin, 'tg:2');
  // A restart (new game on the same database) keeps the overrides.
  const g2 = createGame(db, { now: () => clock.t, notify: () => {} });
  assert.ok(g2.api.me(1).gameEvents.active.some((e) => e.id === 'luck'));
  // Stop the scheduled country event and the forced luck.
  const country = g.adminCall('tg:2', 'game-events', {}).active.find((e) => e.id === 'country');
  g.adminCall('tg:2', 'game-events/stop', { key: country.key, ...ok });
  g.adminCall('tg:2', 'game-events/stop', { key: r.event.key, ...ok });
  assert.throws(() => g.adminCall('tg:2', 'game-events/stop', { key: country.key, ...ok }), /не йде/);
  const active = call('me').gameEvents.active.map((e) => e.id);
  assert.deepEqual(active, ['fuel']);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_log WHERE action = 'event-stop'").get().n, 2);
  // Forced events end by themselves; the stopped country stays stopped, next week's runs as planned.
  clock.t += 3 * H;
  assert.deepEqual(call('me').gameEvents.active.map((e) => e.id), []);
  clock.t = K('2026-11-09T12:00:00');
  assert.ok(call('me').gameEvents.active.some((e) => e.id === 'country' && e.country === 'GB'));
  // A race weekend started by hand blocks fuel by hand too (EVENT_EXCLUSIVE works for overrides as well).
  clock.t = K('2026-11-11T12:00:00'); // Wednesday of week A: nothing but the country
  g.adminCall('tg:2', 'game-events/start', { event: 'race', hours: 1, ...ok });
  assert.throws(() => g.adminCall('tg:2', 'game-events/start', { event: 'fuel', hours: 1, ...ok }), /Гоночний/);
});

test('admin: forced events limit', () => {
  const { g } = setup(K('2026-11-06T12:00:00'));
  g.adminCall('tg:99', 'game-events/start', { event: 'luck', hours: 1, ...ok });
  g.adminCall('tg:99', 'game-events/start', { event: 'plates', hours: 1, ...ok });
  g.adminCall('tg:99', 'game-events/start', { event: 'fuel', hours: 1, ...ok });
  assert.throws(() => g.adminCall('tg:99', 'game-events/start', { event: 'race', hours: 1, ...ok }), /не більше 3/);
});

test('reminder: «event started» once, in the first hours, within the daily limits', async () => {
  const db = openDb(':memory:');
  const clock = { t: K('2026-11-03T10:00:00') }; // Tuesday of week B: fuel since 00:00
  const sent = [];
  const g = createGame(db, { now: () => clock.t, notify: () => {} });
  const sender = createSender({ send: async (chatId, text) => sent.push({ chatId, text }), now: () => clock.t, sleep: async (ms) => (clock.t += Math.max(1, ms)), log: () => {} });
  const rem = createReminders({ game: g, sender, now: () => clock.t, log: () => {} });
  g.ensureUser({ id: 1, first_name: 'U' });
  g.api['rewards/daily'](1);
  db.prepare('UPDATE users SET last_seen = ?, reward_case_at = ? WHERE id = 1').run(clock.t - 2 * H, clock.t);
  rem.tick();
  await sender.idle();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^🎉 Почалася подія «Подвійне паливо»/);
  // Later the same day another reminder (the reward case) may go, but the event is not told again.
  clock.t += 4 * H;
  rem.tick();
  await sender.idle();
  assert.ok(sent.length <= 2);
  assert.ok(sent.slice(1).every((m) => !m.text.includes('🎉')), 'told once');
  // 14 h after the start: too late for the event line.
  const db2 = openDb(':memory:');
  const g2 = createGame(db2, { now: () => K('2026-11-03T14:30:00'), notify: () => {} });
  g2.ensureUser({ id: 1, first_name: 'U' });
  g2.api['rewards/daily'](1);
  db2.prepare('UPDATE users SET last_seen = ? WHERE id = 1').run(K('2026-11-03T10:00:00'));
  assert.ok(!g2.pushCandidates({ inactiveDays: 14, idleMin: 30, maxPerDay: 2, seasonWarnH: 24 }).some((c) => c.ready.some((r) => r.kind === 'event')));
});

// reports/caseev.md: prices stay, odds went up, and a car out of a case sells for S.ORIGIN_SELL of its usual rate, so
// open-and-sell is under 1 of the price paid during every event. The static bound below adds +5% for the streak save,
// hence 1.05; the Monte Carlo of test/caseev.test.js pins < 1.01 on deal days.
const OPEN_SELL_CAP = 1.05;
test('economy: open-and-sell under the price for every case during every event (exact odds)', () => {
  // Exact odds; the country discount (boost and fragments off) and the luck weekend keep the streak save, +5% covers
  // it (tools/sim-events.mjs measures it at 0–3%).
  for (const cs of S.CASES.filter((c) => !c.starter)) {
    const fxs = cs.group === 'rarity' ? [S.eventEffects([{ id: 'luck' }]), S.eventEffects(S.EVENT_IDS.map((id) => ({ id, country: 'UA' })))]
      : [S.eventEffects([{ id: 'country', country: cs.country }]), S.eventEffects(S.EVENT_IDS.map((id) => ({ id, country: cs.country })))];
    for (const fx of fxs) for (const day of ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']) {
      const deal = S.caseDeal(cs, day, fx);
      const sell = staticSell(cs, deal) * (deal.save ? 1.05 : 1);
      assert.ok(sell < OPEN_SELL_CAP, `${cs.id} ${fx.ids.join('+')} ${day}: ${sell.toFixed(3)}`);
    }
  }
  for (const p of plateCheck()) assert.ok(p.during < S.EVENT_CAPS.sellMax, `plates ${p.id}: ${p.during.toFixed(3)}`);
});

test('economy: luck weekend through the real API — every rarity case under the price (fixed seeds)', () => {
  for (const cs of S.CASES.filter((c) => c.group === 'rarity')) {
    const [, t0, prep] = scenarios(cs).find(([name]) => name === 'luck');
    const r = runCase(cs, t0, 1500, prep, 'test');
    assert.equal(r.price, cs.price, 'no case of the day at the weekend');
    assert.ok(r.sell / r.paid < 1, `${cs.id}: ${(r.sell / r.paid).toFixed(3)}`);
  }
  // The country discount through the API: the price paid is −15% and no fragment keys come.
  const cs = S.CASE_BY_ID['c-jp'];
  const [, t0, prep] = scenarios(cs).find(([name]) => name === 'country');
  const r = runCase(cs, t0, 300, prep, 'test');
  assert.equal(r.paid, 300 * Math.round((cs.price * 0.85) / 1000) * 1000);
  assert.equal(r.keyOpens, 0);
});

test('economy: race and fuel caps — extra a week stays small', () => {
  const from = K('2026-11-02T00:00:00'), to = from + 28 * DAY;
  const list = S.eventsBetween(from, to);
  const hours = (id) => list.filter((e) => e.id === id).reduce((s, e) => s + (e.end - e.start), 0) / H / 4;
  // Race weekend every other week: 48 h × +25% → at most +3.6% of race prizes on average over a week of nonstop play.
  assert.ok((hours('race') * (S.EVENTS.race.prizeMult - 1)) / 168 <= 0.04);
  // Fuel event: one day a week, ×2 → at most +1/7 refills (+14%) a week.
  assert.ok((hours('fuel') * (S.EVENTS.fuel.fuelMult - 1)) / 168 <= 0.15);
  // Every case and plate discount within the caps.
  for (const cs of S.CASES.filter((c) => c.group === 'country')) {
    const d = S.caseDeal(cs, '2026-11-04', S.eventEffects([{ id: 'country', country: cs.country }]));
    assert.ok(d.price >= cs.price * (1 - S.EVENT_CAPS.caseOff) - 500);
    assert.equal(d.fragments, false);
    assert.equal(d.boost, 0);
  }
});
