// r15 (owner 13.11): «Ми вас почули» — the one-time comeback pack for Season 1 players (src/comeback.js, S.S1_COMEBACK),
// «×2 тиждень» (S.EVENTS.x2: race prizes and business income ×2 while it runs, src/schedule.js 'boost/set'), and the
// easier start (S.START_BALANCE 5 млн for new sign-ups, XP steps 3→4 … 7→8 cut).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as B from '../public/business.js';
import * as M from '../src/metrics.js';

const H = 3600e3, DAY = 86400e3;
const T0 = Date.parse('2026-11-13T10:00:00Z');
const OWNER = 1000;

function setup({ wiped = true } = {}) {
  const db = openDb(':memory:');
  const clock = { t: T0 };
  const sent = [];
  const g = createGame(db, { now: () => clock.t, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [OWNER],
    broadcast: (ids, text, o) => sent.push({ ids: [...ids], text, o }) });
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const adm = (name, body = {}, who = `tg:${OWNER}`) => g.adminCall(who, name, { confirm: true, reason: 'тест r15', ...body });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  if (wiped) run("INSERT INTO meta (key, value) VALUES ('season_reset_s2', ?)", String(T0 - 7 * DAY));
  const archive = (id, { level = 10, balance = 0, garage = 0, banned = 0 } = {}) => {
    g.ensureUser({ id, first_name: 'U' + id });
    run(`INSERT INTO s1_archive (user_id, level, xp, season_xp, garage_value, balance, cars, stars_spent, friends_l3, banned, created_at)
      VALUES (?, ?, 0, 0, ?, ?, 0, 0, 0, ?, ?)`, id, level, garage, balance, banned, T0 - 7 * DAY);
  };
  return { db, g, clock, sent, run, get, all, adm, call, archive };
}

// ---------- «Ми вас почули» ----------
test('comeback: tiers by S1 wealth (balance + garage), boundaries inclusive, the premium key is «Еліта» (dearest regular case)', () => {
  const T = (w) => S.s1ComebackTier(w).tier;
  assert.equal(T(0), 1);
  assert.equal(T(-5), 1);
  assert.equal(T(99_999_999), 1);
  assert.equal(T(100_000_000), 2);
  assert.equal(T(999_999_999), 2);
  assert.equal(T(1_000_000_000), 3);
  assert.equal(T(9_999_999_999), 3);
  assert.equal(T(10_000_000_000), 4);
  assert.equal(T(7.7e9), 3, '«У меня было 7,7 миллиардов» → 40 млн + 5 keys');
  assert.deepEqual(S.S1_COMEBACK.tiers.map((t) => [t.money, t.keys, t.premium]), [[5e6, 2, 0], [15e6, 3, 0], [40e6, 5, 0], [100e6, 5, 1]]);
  assert.equal(S.S1_COMEBACK.keyCase, 'city');
  const regular = S.CASES.filter((c) => c.group === 'rarity' && !c.starter).sort((a, b) => b.price - a.price);
  assert.equal(S.S1_COMEBACK.premiumCase, regular[0].id);
  assert.equal(regular[0].id, 'elite');
  assert.equal(S.s1ComebackText(S.S1_COMEBACK.tiers[0]), '+5 000 000 ₴ і 2 ключі «Міський»');
  assert.equal(S.s1ComebackText(S.S1_COMEBACK.tiers[3]), '+100 000 000 ₴, 5 ключів «Міський» і 1 ключ «Еліта»');
});

test('comeback: owner only, only s1_archive players (not banned), gift + one bot message each, run twice → granted once', () => {
  const s = setup();
  s.archive(1, { balance: 400_000, garage: 0, level: 1 }); // tier 1
  s.archive(2, { balance: 50_000_000, garage: 50_000_000 }); // exactly 100 млн → tier 2
  s.archive(3, { balance: 7.0e9, garage: 0.7e9 }); // 7,7 млрд → tier 3
  s.archive(4, { balance: 1e9, garage: 9.5e9 }); // tier 4
  s.archive(5, { balance: 1e12, banned: 1 }); // banned at the wipe
  s.archive(6, { balance: 1e6 });
  s.run('UPDATE users SET banned = 1 WHERE id = 6'); // banned now
  s.archive(7, { balance: 1e6 });
  s.run('UPDATE users SET push_off = 1 WHERE id = 7'); // turned the bot off: the gift, no message
  s.g.ensureUser({ id: 50, first_name: 'New' }); // a Season 2 newcomer: nothing
  s.g.ensureUser({ id: 77, first_name: 'Adm' });
  s.run("UPDATE users SET role = 'admin' WHERE id = 77");

  const st = s.adm('season2').comeback;
  assert.equal(st.done, false);
  assert.equal(st.preview.users, 5);
  assert.deepEqual(st.preview.tiers.map((t) => t.users), [2, 1, 1, 1]);
  assert.equal(st.preview.money, 5e6 * 2 + 15e6 + 40e6 + 100e6);
  assert.equal(st.preview.keys, 2 * 2 + 3 + 5 + 5);
  assert.equal(st.preview.premium, 1);

  assert.throws(() => s.adm('season2/comeback', {}, 'tg:77'), /лише власник/);
  assert.throws(() => s.g.adminCall(`tg:${OWNER}`, 'season2/comeback', {}), /не підтверджено/);
  const bal0 = s.get('SELECT balance FROM users WHERE id = 3').balance;
  const r = s.adm('season2/comeback');
  assert.equal(r.result.users, 5);
  assert.equal(r.result.messages, 4);
  assert.equal(s.get('SELECT balance FROM users WHERE id = 3').balance, bal0, 'nothing is paid before the player takes it');
  // one gift window each, only archived players
  const gifts = s.all("SELECT user_id, data FROM gifts WHERE kind = 's1comeback' ORDER BY user_id");
  assert.deepEqual(gifts.map((x) => x.user_id), [1, 2, 3, 4, 7]);
  assert.deepEqual(JSON.parse(gifts.find((x) => x.user_id === 4).data), { tier: 4, money: 100e6, keys: 5, caseId: 'city', premium: 1, premiumCase: 'elite', season: 1 });
  // one bot message each (not the /stop player), through the shared queue, with the game button
  const ids = s.sent.flatMap((m) => m.ids).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 2, 3, 4]);
  assert.ok(s.sent.every((m) => m.o?.play && /^🧡 Ми вас почули\. Тебе чекає компенсація за Сезон 1: \+/.test(m.text) && /@avtodrop2026_bot$/.test(m.text)));
  assert.ok(s.sent.some((m) => m.ids.includes(3) && m.text.includes('+40 000 000 ₴ і 5 ключів «Міський»')));

  // twice: nothing new, no second message; a changed tier table can't pay again either
  const again = s.adm('season2/comeback');
  assert.equal(again.result.users, 0);
  assert.equal(s.sent.flatMap((m) => m.ids).length, 4);
  assert.equal(s.get("SELECT COUNT(*) n FROM gifts WHERE kind = 's1comeback'").n, 5);
  const was = S.S1_COMEBACK.tiers[0].money;
  S.S1_COMEBACK.tiers[0].money = 9e6;
  try {
    assert.equal(s.adm('season2/comeback').result.users, 0);
  } finally {
    S.S1_COMEBACK.tiers[0].money = was;
  }
  const after = s.adm('season2').comeback;
  assert.equal(after.done, true);
  assert.equal(after.granted.users, 5);
  assert.equal(after.preview.users, 0);
});

test('comeback: the player takes it once — money (money_src comeback/s1 → «Ми вас почули»), keys, the window goes', () => {
  const s = setup();
  s.archive(4, { balance: 2e10 });
  s.archive(1, { balance: 1000 });
  s.adm('season2/comeback');
  const pulse = s.call(4, 'pulse');
  assert.ok(pulse.gifts.some((x) => x.kind === 's1comeback'), 'the gift window waits');
  const b0 = s.get('SELECT balance FROM users WHERE id = 4').balance;
  const r = s.call(4, 'comeback/s1');
  assert.equal(r.already, false);
  assert.equal(r.money, 100e6);
  assert.deepEqual(r.keys, [{ caseId: 'city', count: 5 }, { caseId: 'elite', count: 1 }]);
  assert.equal(s.get('SELECT balance FROM users WHERE id = 4').balance, b0 + 100e6);
  assert.equal(s.get("SELECT count FROM keys WHERE user_id = 4 AND case_id = 'city'").count, 5);
  assert.equal(s.get("SELECT count FROM keys WHERE user_id = 4 AND case_id = 'elite'").count, 1);
  assert.ok(!s.call(4, 'pulse').gifts.some((x) => x.kind === 's1comeback'), 'seen after taking');
  // twice: nothing
  const r2 = s.call(4, 'comeback/s1');
  assert.equal(r2.already, true);
  assert.equal(s.get('SELECT balance FROM users WHERE id = 4').balance, b0 + 100e6);
  assert.equal(s.get("SELECT count FROM keys WHERE user_id = 4 AND case_id = 'city'").count, 5);
  // money_src label and its own metrics group
  const src = s.get("SELECT SUM(created) n FROM money_src WHERE src = 'comeback/s1'").n;
  assert.equal(src, 100e6);
  assert.equal(M.groupOf('comeback/s1'), 's1comeback');
  assert.equal(M.groupOf('comeback'), 'rewards', 'the «з поверненням» gift keeps its group');
  // a Season 2 newcomer has nothing to take
  s.g.ensureUser({ id: 60, first_name: 'N' });
  assert.throws(() => s.call(60, 'comeback/s1'), /немає/);
  const st = s.adm('season2').comeback;
  assert.equal(st.granted.claimed, 1);
  assert.equal(st.granted.claimedMoney, 100e6);
});

test('comeback: refused before the Season 2 wipe (no archive yet)', () => {
  const s = setup({ wiped: false });
  s.archive(1, { balance: 1 });
  assert.throws(() => s.adm('season2/comeback'), /ще не запущено/);
  assert.equal(s.get('SELECT COUNT(*) n FROM s1_comeback').n, 0);
});

// ---------- «×2 тиждень» ----------
test('x2 week: race, drift and boss prizes ×2 while on (entries the same), back after the end; the admin switch', () => {
  const s = setup();
  s.g.ensureUser({ id: 1, first_name: 'R' });
  s.run('UPDATE users SET balance = 1e12, level = 30, level_seen = 30, slots = 40 WHERE id = 1');
  const carId = s.g.giveCar(1, 'bmw-m3-e46').id;
  const drag = () => s.call(1, 'race/rivals', { carId }).list.filter((x) => x.id !== 'train');
  const drift = () => s.call(1, 'drift/rivals', { carId }).list;
  const d0 = drag(), f0 = drift();
  const st0 = s.adm('boost');
  assert.equal(st0.on, false);
  assert.throws(() => s.adm('boost/set', { on: false }), /не йде/);
  const on = s.adm('boost/set', { on: true });
  assert.equal(on.on, true);
  assert.equal(on.live.end - on.live.start, 7 * DAY, '7 days by default');
  assert.ok(s.call(1, 'me').gameEvents.active.some((e) => e.id === 'x2' && e.title === '×2 тиждень'), 'players see it in «Події»');
  const d1 = drag(), f1 = drift();
  for (let i = 0; i < d0.length; i++) {
    assert.equal(d1[i].entry, d0[i].entry, 'entry unchanged');
    assert.ok(Math.abs(d1[i].prize - 2 * d0[i].prize) <= 100, `drag ${d0[i].id}: ${d0[i].prize} → ${d1[i].prize}`);
  }
  for (let i = 0; i < f0.length; i++) {
    assert.equal(f1[i].entry, f0[i].entry);
    assert.ok(Math.abs(f1[i].prize - 2 * f0[i].prize) <= 1000, `drift ${f0[i].id}`);
  }
  // the started race keeps the boosted prize (server-authoritative: stored at the start)
  const st = s.call(1, 'race/start', { carId, rival: d1[0].id });
  assert.equal(s.get('SELECT prize FROM races WHERE id = ?', st.raceId).prize, d1[0].prize);
  // the race weekend never adds up with it: the higher wins
  assert.equal(S.eventPrize(100000, { prizeMult: 1.25, moneyMult: 2 }), 200000);
  assert.equal(S.eventPrize(100000, { prizeMult: 1.25, moneyMult: 1 }), 125000);
  assert.equal(S.boostMoney(300000, S.eventEffects([{ id: 'x2' }])), 600000);
  assert.equal(S.boostMoney(300000, S.NO_EVENTS), 300000);
  // a new end while it runs; then past the end everything is back
  const end = on.live.start + 3 * DAY;
  assert.equal(s.adm('boost/set', { on: true, end: S.kyivLocal(end) }).live.end, end);
  s.clock.t = end + 60e3;
  assert.equal(s.adm('boost').on, false);
  assert.deepEqual(drag().map((x) => x.prize), d0.map((x) => x.prize));
  // off right away
  s.adm('boost/set', { on: true });
  assert.equal(s.adm('boost').on, true);
  const off = s.adm('boost/set', { on: false });
  assert.equal(off.on, false);
  assert.deepEqual(drag().map((x) => x.prize), d0.map((x) => x.prize));
  // the x2 week never switches a week's rotation off
  assert.equal(S.planWeeks([{ id: 'x2', start: T0, end: T0 + 7 * DAY }]).size, 0);
});

test('x2 week: business boxes fill ×2 only inside the window — banked at the start and at the end', () => {
  // pure rules first: rate 1000/h, cap 4 h
  const w = [{ start: 10 * H, end: 12 * H, mult: 2 }];
  assert.equal(B.boxAt({ banked: 0, cashAt: 0, rate: 1000, capH: 4, boosts: w }, 2 * H), 2000, 'before: plain');
  assert.equal(B.boxAt({ banked: 0, cashAt: 9 * H, rate: 1000, capH: 4, boosts: w }, 11 * H), 1000 + 2000, '1 h plain + 1 h ×2');
  assert.equal(B.boxAt({ banked: 0, cashAt: 9 * H, rate: 1000, capH: 10, boosts: w }, 13 * H), 1000 + 4000 + 1000, 'across both edges');
  assert.equal(B.boxAt({ banked: 0, cashAt: 9 * H, rate: 1000, capH: 4, boosts: w }, 13 * H), 5000, 'over the plain cap after the end: kept, not grown');
  // a box full at the boosted cap keeps it after the end (never cut down), and stops there
  assert.equal(B.boxAt({ banked: 0, cashAt: 8 * H, rate: 1000, capH: 1, boosts: w }, 12 * H), 2000);
  assert.equal(B.boxAt({ banked: 0, cashAt: 8 * H, rate: 1000, capH: 1, boosts: w }, 20 * H), 2000);
  // the manager (uncapped)
  assert.equal(Math.round(B.earnedBetween(1000, 9 * H, 13 * H, w)), 6000);
  assert.equal(B.boxAt({ banked: 0, cashAt: 9 * H, rate: 1000, capH: 1, managerUntil: 99 * H, boosts: w }, 13 * H), 6000);

  // on the server
  const s = setup();
  s.g.ensureUser({ id: 1, first_name: 'B' });
  s.run('UPDATE users SET balance = 1e12, level = 30, level_seen = 30 WHERE id = 1');
  s.call(1, 'biz/buy', { id: 'wash' });
  const rate = B.rateOf({ id: 'wash', level: 1, eq: 0, staff: 0, ads: 0 });
  const capH = B.capHoursOf({ staff: 0 }, false);
  assert.ok(capH >= 3);
  s.clock.t += 1 * H; // 1 h plain
  s.adm('boost/set', { on: true, end: S.kyivLocal(s.clock.t + 1 * H) });
  const mid = s.call(1, 'biz').list.find((b) => b.id === 'wash');
  assert.equal(mid.rate, 2 * rate, 'the shown rate is ×2 while on');
  assert.equal(mid.cap, Math.floor(2 * rate * capH));
  s.clock.t += 1 * H; // 1 h ×2 — the boost ends now
  s.clock.t += 1 * H; // 1 h plain again
  const after = s.call(1, 'biz').list.find((b) => b.id === 'wash');
  assert.equal(after.rate, rate, 'back to ×1');
  assert.ok(Math.abs(after.box - 4 * rate) <= 1, `1 h + 2 h + 1 h = 4 h of income: ${after.box} vs ${4 * rate}`);
  const b0 = s.get('SELECT balance FROM users WHERE id = 1').balance;
  const got = s.call(1, 'biz/collect', { id: 'wash' }).got;
  assert.equal(got, after.box);
  assert.equal(s.get('SELECT balance FROM users WHERE id = 1').balance, b0 + got);
  // without any boost, the old numbers exactly
  s.clock.t += 2 * H;
  assert.equal(s.call(1, 'biz').list.find((b) => b.id === 'wash').box, Math.floor(rate * 2));
});

// ---------- the easier start ----------
test('start balance: 5 000 000 ₴ for new sign-ups only, existing players untouched', () => {
  assert.equal(S.START_BALANCE, 5_000_000);
  const s = setup();
  s.g.ensureUser({ id: 1, first_name: 'Old' });
  s.run('UPDATE users SET balance = 123456 WHERE id = 1');
  s.g.ensureUser({ id: 1, first_name: 'Old' }); // signs in again
  assert.equal(s.get('SELECT balance FROM users WHERE id = 1').balance, 123456);
  s.g.ensureUser({ id: 2, first_name: 'New' });
  assert.equal(s.get('SELECT balance FROM users WHERE id = 2').balance, 5_000_000);
  assert.equal(s.get("SELECT SUM(created) n FROM money_src WHERE src = 'signup'").n, 2 * 5_000_000, 'both sign-ups (the first made 1 before the update)');
});

test('XP curve: 4–8 cut, 1–3 and 9+ unchanged, monotonic; a player mid-level levels up with every reward exactly once', () => {
  const old = S.XP_TABLE_R14;
  assert.deepEqual(S.XP_TABLE.slice(0, 2), old.slice(0, 2), 'L1→2, L2→3 unchanged');
  assert.deepEqual(S.XP_TABLE.slice(7), old.slice(7), '8→9 onwards unchanged');
  for (let l = 3; l <= 7; l++) assert.ok(S.xpForLevel(l) < old[l - 1], `step ${l}→${l + 1} cut`);
  for (let l = 2; l <= 40; l++) assert.ok(S.xpForLevel(l) >= S.xpForLevel(l - 1), `monotonic: ${l}`);
  for (let l = 4; l <= 40; l++) assert.ok(S.xpForLevel(l) > S.xpForLevel(l - 1), `step ${l} > step ${l - 1}`);
  const cum = (t, n) => t.slice(0, n - 1).reduce((a, b) => a + b, 0);
  assert.ok(cum(S.XP_TABLE, 4) < cum(old, 4) && cum(S.XP_TABLE, 8) < cum(old, 8) / 1.5);

  // A player at level 4 with 1500 XP inside it (old step 1600, new 800): his next XP levels him up — every level's
  // reward once (money_src 'level'), never again.
  const s = setup();
  s.g.ensureUser({ id: 1, first_name: 'L' });
  s.run('UPDATE users SET level = 4, level_seen = 4, xp = 1500 WHERE id = 1');
  s.call(1, 'rewards/daily');
  const after = s.get('SELECT level, xp FROM users WHERE id = 1');
  assert.ok(after.level >= 5, `levelled up: ${after.level}`);
  let need = 0;
  for (let l = 4; l < after.level; l++) need += S.xpForLevel(l);
  assert.ok(need <= 1500 + 500 && after.xp < S.xpForLevel(after.level), 'XP spent on the levels, the rest inside the new one');
  let money = 0;
  for (let l = 5; l <= after.level; l++) money += S.levelReward(l).money;
  const paid = () => s.get("SELECT COALESCE(SUM(created), 0) n FROM money_src WHERE src = 'level'").n;
  assert.equal(paid(), money, 'each skipped level paid exactly once');
  s.call(1, 'me');
  s.call(1, 'pulse');
  assert.equal(paid(), money);
  assert.equal(s.get('SELECT level FROM users WHERE id = 1').level, after.level);
  // a player above level 8 keeps his level and XP
  s.g.ensureUser({ id: 9, first_name: 'Hi' });
  s.run('UPDATE users SET level = 12, level_seen = 12, xp = 100 WHERE id = 9');
  s.call(9, 'me');
  assert.deepEqual({ ...s.get('SELECT level, xp FROM users WHERE id = 9') }, { level: 12, xp: 100 });
});
