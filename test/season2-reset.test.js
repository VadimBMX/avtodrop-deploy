// «Сезон 02» (src/season2.js): the one-shot wipe — dry run, the snapshot that survives it, what goes and what stays,
// the compensation (star credit, frames, «Ветеран Сезону 1» from S1 level 3, friend keys capped at 20; a VIP subscription
// is credit only — no VIP days carried),
// the guard against a second run, the star credit in the shop (same goods as an invoice), frames, the welcome window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { welcomeLines } from '../public/season2-ui.js';

const DAY = 86400e3;
const S1_T = Date.parse('2026-10-28T10:00:00Z'); // Season 1 (19.10 21:00 UTC – 2.11 21:00 UTC)
const S2_T = Date.parse('2026-11-03T10:00:00Z');

// Players: 1 — big payer, level 22, Season 1 leader; 2 — level 12, brought 22 friends to level 3; 3…24 — those friends;
// 30 — banned, the top season XP; 31 — hidden from the ratings, level 5; 32 — an admin; 33 — a VIP subscriber; 34 — fresh (level 1).
function setup() {
  const db = openDb(':memory:');
  let t = S1_T;
  const g = createGame(db, { now: () => t, notify: () => {}, random: () => 0.5, allUnlocked: true, admins: [1000] });
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const mk = (id, ref) => g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id }, ref ? `ref_${ref}` : undefined);
  for (const id of [1, 2, 30, 31, 32, 33, 34]) mk(id);
  for (let id = 3; id <= 24; id++) mk(id, 2);
  run('UPDATE users SET ref_paid = 1 WHERE referrer_id = 2');
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  // progress to be wiped
  call(1, 'case/open', { caseId: 'starter' });
  call(2, 'case/open', { caseId: 'starter' });
  run('UPDATE users SET level = 22, balance = 9e9, stars = 250 WHERE id = 1');
  run('UPDATE users SET level = 12 WHERE id = 2');
  run("UPDATE users SET banned = 1, ban_reason = 'чит' WHERE id = 30");
  run('UPDATE users SET lb_hidden = 1, level = 5 WHERE id = 31');
  run("UPDATE users SET role = 'admin' WHERE id = 32");
  // the Season 1 rating
  const xp = { 30: 99999, 1: 9000, 31: 8000, 2: 7000 };
  for (let id = 3; id <= 24; id++) xp[id] = 100 + id;
  for (const [id, v] of Object.entries(xp)) run('UPDATE users SET season_id = 1, season_xp = ? WHERE id = ?', v, Number(id));
  // payments: user 1 paid 300 (VIP) + 150 (pack) + 50 refunded + an imported first-version payment — credit = 450
  g.creditItem({ chargeId: 'c-vip', userId: 1, itemId: 'vip', stars: S.VIP.stars });
  g.creditPayment({ chargeId: 'c-p2', userId: 1, packId: 'p2', stars: 150, amount: 5000000 });
  run("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES ('c-ref', 1, 'refund:vip', 50, 0, ?)", t);
  run("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES ('legacy:x', 1, 'p1', 75, 0, ?)", t);
  // user 33: VIP subscription paid till 20 days from now
  g.creditItem({ chargeId: 'c-sub', userId: 33, itemId: 'vipsub', stars: S.VIP_SUB.stars, recurring: true, first: true, expires: t + 20 * DAY });
  // assorted progress rows
  const carId = get('SELECT id FROM cars WHERE owner_id = 1').id;
  run('INSERT INTO listings (seller_id, car_id, price, created_at) VALUES (1, ?, 1000, ?)', carId, t);
  run("INSERT INTO battles (creator_id, case_id, count, price, created_at) VALUES (2, 'city', 1, 1, ?)", t);
  run("INSERT INTO plates (owner_id, text, cls, value, created_at) VALUES (1, 'AA0001AA', 'S', 100, ?)", t);
  run("INSERT INTO trophies (user_id, k, cost, at) VALUES (1, 0, 1, ?)", t);
  run("INSERT INTO race_streak (user_id, n) VALUES (1, 5)");
  run("INSERT INTO claims (user_id, key) VALUES (1, 'a:cases:0'), (1, 'intro'), (1, 'story:x'), (1, 'cos:x:frame-neon')");
  run("INSERT INTO clubs (id, tag, name, owner_id, invite, treasury, created_at) VALUES (1, 'ЖИГА', 'Жига', 1, 'inv', 777, ?)", t);
  run("INSERT INTO club_members (user_id, club_id, role, joined_at, donated) VALUES (1, 1, 'owner', ?, 500), (2, 1, 'member', ?, 0)", t, t);
  run("INSERT INTO club_points (week, club_id, user_id, pts) VALUES ('2026-10-26', 1, 1, 40)");
  run("INSERT INTO support (user_id, text, created_at) VALUES (2, 'help', ?)", t);
  run("INSERT INTO ideas (user_id, text, created_at) VALUES (2, 'more cars', ?)", t);
  return { db, g, call, run, get, all, at: () => t, setT: (v) => (t = v) };
}
const ownerReset = (g, body = {}) => g.adminCall('key', 'season2/reset', { confirm: true, phrase: S.S2_RESET.phrase, ...body });

test('season 2: the dry run reports and changes nothing', () => {
  const e = setup();
  e.setT(S2_T);
  const before = { cars: e.get('SELECT COUNT(*) n FROM cars').n, bal: e.get('SELECT balance FROM users WHERE id = 1').balance };
  const v = e.g.admin.season2('key', {});
  assert.equal(v.done, false);
  assert.equal(v.users, 29);
  assert.deepEqual(v.credit, { users: 2, total: 450 + S.VIP_SUB.stars, pct: 100 });
  assert.equal(v.patrons, 2);
  assert.deepEqual(v.veterans, { 1: 1, 2: 1, 3: 1 }, 'bronze only from S1 level 3: just 31 (level 5); the level-1 accounts get nothing');
  assert.deepEqual(v.friendKeys, { users: 1, total: 20, max: 20 });
  assert.equal(v.vipSubs, 1);
  // not settled yet → counted live: banned 30 is out of the board, hidden 31 is out of the legends
  assert.deepEqual(v.legends.map((l) => l.id), [1, 2, 24, 23, 22, 21, 20, 19, 18, 17]);
  assert.equal(v.legends[0].place, 1);
  const dry = ownerReset(e.g, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.credit.total, v.credit.total);
  assert.equal(e.get('SELECT COUNT(*) n FROM cars').n, before.cars);
  assert.equal(e.get('SELECT balance FROM users WHERE id = 1').balance, before.bal);
  assert.equal(e.get('SELECT COUNT(*) n FROM s1_archive').n, 0);
  assert.equal(e.get("SELECT value FROM meta WHERE key = 'season_reset_s2'"), undefined);
});

test('season 2: the wipe — progress goes, accounts / friends / clubs / payments / bans / roles / support stay; the archive survives', () => {
  const e = setup();
  e.setT(S2_T);
  const pay = e.get('SELECT COUNT(*) n, SUM(stars) s FROM payments').n;
  const r = ownerReset(e.g, { reason: 'новий сезон' });
  assert.equal(r.done, true);
  // wiped
  for (const t of ['cars', 'plates', 'listings', 'battles', 'trophies', 'race_streak', 'club_points', 'collection']) assert.equal(e.get(`SELECT COUNT(*) n FROM ${t}`).n, 0, t);
  for (const u of e.all('SELECT * FROM users')) {
    assert.equal(u.balance, S.START_BALANCE);
    assert.equal(u.level, 1);
    assert.equal(u.xp, 0);
    assert.equal(u.season_xp, 0);
    assert.equal(u.cases_opened, 0);
    assert.equal(u.stars, 0);
    assert.equal(u.style, '{}');
  }
  assert.deepEqual(e.all("SELECT key FROM claims WHERE user_id = 1 ORDER BY key").map((x) => x.key), ['intro', 'story:x']);
  assert.equal(e.get("SELECT count FROM keys WHERE user_id = 34 AND case_id = 'starter'").count, 1);
  assert.equal(e.get('SELECT COUNT(*) n FROM keys WHERE user_id = 34').n, 1);
  // kept
  const u1 = e.get('SELECT * FROM users WHERE id = 1');
  assert.equal(u1.username, 'u1');
  assert.equal(u1.first_name, 'U1');
  assert.equal(e.get('SELECT referrer_id FROM users WHERE id = 3').referrer_id, 2);
  assert.equal(e.get('SELECT banned FROM users WHERE id = 30').banned, 1);
  assert.equal(e.get('SELECT role FROM users WHERE id = 32').role, 'admin');
  assert.equal(e.get('SELECT COUNT(*) n FROM payments').n, pay);
  assert.equal(e.get('SELECT COUNT(*) n FROM club_members').n, 2);
  assert.equal(e.get('SELECT treasury FROM clubs WHERE id = 1').treasury, 0);
  assert.equal(e.get('SELECT donated FROM club_members WHERE user_id = 1').donated, 0);
  assert.equal(e.get('SELECT COUNT(*) n FROM support').n, 1);
  assert.equal(e.get('SELECT COUNT(*) n FROM ideas').n, 1);
  // the archive: what the player had in Season 1
  const a = e.get('SELECT * FROM s1_archive WHERE user_id = 1');
  assert.equal(a.level, 22);
  assert.equal(a.season_xp, 9000);
  assert.equal(a.stars_spent, 450);
  assert.ok(a.garage_value > 0 && a.cars === 1);
  assert.equal(e.get('SELECT friends_l3 FROM s1_archive WHERE user_id = 2').friends_l3, 22);
  // Season 1 settled by the run (its top-100 badges gave the places): 30 was banned, so 1 is first
  assert.equal(a.season_place, 1);
  assert.ok(e.get("SELECT 1 FROM seasons WHERE season_id = 1"));
  assert.ok(e.get("SELECT 1 FROM admin_log WHERE action = 'season2-reset'"));
  // the deleted cars are in the car history
  assert.ok(e.get("SELECT COUNT(*) n FROM car_log WHERE kind = 'gone'").n >= 2);
});

test('season 2: compensation — credit 100%, frames, veteran tiers from level 3, friend keys capped at 20, VIP subscription: credit only', () => {
  const e = setup();
  e.setT(S2_T);
  ownerReset(e.g);
  const me1 = e.call(1, 'me');
  assert.equal(me1.starCredit, 450);
  assert.equal(e.call(1, 'shop').starCredit, 450);
  assert.equal(me1.frame, 'legend_s1');
  assert.deepEqual(e.call(1, 'frames').list.filter((f) => f.owned).map((f) => f.id), ['patron', 'legend_s1', 'veteran_s1']);
  assert.equal(e.call(2, 'me').frame, 'legend_s1');
  assert.equal(e.call(34, 'me').frame, null, 'level 1 in Season 1: no veteran frame');
  assert.equal(e.call(34, 'me').starCredit, 0);
  assert.equal(e.call(31, 'me').frame, 'veteran_s1', 'hidden from the ratings: no legend');
  // veteran badge by Season 1 level: gold / silver / bronze
  const vet = (uid) => e.get("SELECT tier FROM badges WHERE user_id = ? AND key = 'veteran_s1'", uid)?.tier;
  assert.deepEqual([vet(1), vet(2), vet(31), vet(34)], [3, 2, 1, undefined]);
  assert.ok(e.call(34, 'player', { id: 1 }).badges.some((b) => b.key === 'veteran_s1' && b.title === 'Ветеран Сезону 1 · золото'));
  // 22 friends at level 3 → 20 «Міський» keys; «Душа компанії» still counts the 22
  assert.equal(e.call(2, 'me').keys.city, 20);
  assert.equal(e.call(2, 'achievements').list.find((x) => x.key === 'friends').value, 22);
  // VIP subscription: its Stars come back as credit, the VIP days are NOT carried too (owner 3.11)
  assert.equal(e.call(33, 'me').starCredit, S.VIP_SUB.stars);
  assert.equal(e.get('SELECT vip_until FROM users WHERE id = 33').vip_until, 0);
  assert.equal(e.call(33, 'me').vip, false);
  assert.equal(e.call(1, 'me').vip, false, 'one-off VIP does not carry over (its stars came back as credit)');
  // rating rows and the player card show the frame; the card shows the veteran badge
  const lb = e.call(34, 'leaderboard', { type: 'all' });
  assert.equal(lb.list.find((x) => x.id === 1).frame, 'legend_s1');
  const card = e.call(34, 'player', { id: 1 });
  assert.equal(card.frame, 'legend_s1');
  assert.equal(card.veteranS1.tier, 3);
});

test('season 2: the guard — owner only, the phrase, confirm, and never twice', () => {
  const e = setup();
  e.setT(S2_T);
  assert.throws(() => e.g.adminCall('tg:32', 'season2/reset', { confirm: true, phrase: S.S2_RESET.phrase, reason: 'новий сезон' }), /лише власник/);
  assert.throws(() => e.g.adminCall('key', 'season2/reset', { phrase: S.S2_RESET.phrase }), /не підтверджено/);
  assert.throws(() => e.g.adminCall('key', 'season2/reset', { confirm: true, phrase: 'так' }), /СЕЗОН 2/);
  assert.equal(e.get('SELECT COUNT(*) n FROM s1_archive').n, 0);
  ownerReset(e.g);
  const credit = e.get('SELECT star_credit FROM users WHERE id = 1').star_credit;
  e.run('UPDATE users SET balance = 123 WHERE id = 1');
  assert.throws(() => ownerReset(e.g), /вже запущено/);
  assert.throws(() => ownerReset(e.g, { dryRun: true }), /вже запущено/);
  assert.equal(e.get('SELECT balance FROM users WHERE id = 1').balance, 123, 'the second run changed nothing');
  assert.equal(e.get('SELECT star_credit FROM users WHERE id = 1').star_credit, credit);
  const st = e.g.admin.season2('key', {});
  assert.equal(st.done, true);
  assert.equal(st.archive.credit, 450 + S.VIP_SUB.stars);
  assert.equal(st.legends[0].id, 1);
  // helpers don't even see it
  e.run("UPDATE users SET role = 'helper' WHERE id = 32");
  assert.throws(() => e.g.admin.season2('tg:32', {}), /Немає прав/);
});

test('season 2: buying with the star credit gives the same goods as an invoice and takes the credit', () => {
  const e = setup();
  e.setT(S2_T);
  ownerReset(e.g);
  // a quote changes nothing
  assert.deepEqual(e.call(1, 'shop/credit', { item: 'vip' }), { price: S.VIP.stars, credit: 450, enough: true });
  assert.equal(e.call(1, 'me').starCredit, 450);
  // VIP: the same days an invoice gives (user 34 pays a Telegram invoice for comparison)
  const r = e.call(1, 'shop/credit', { item: 'vip', confirm: true });
  e.g.creditItem({ chargeId: 'cmp-vip', userId: 34, itemId: 'vip', stars: S.VIP.stars });
  assert.equal(r.starCredit, 150);
  assert.equal(e.get('SELECT vip_until FROM users WHERE id = 1').vip_until, e.get('SELECT vip_until FROM users WHERE id = 34').vip_until);
  assert.equal(e.get('SELECT vip_until FROM users WHERE id = 1').vip_until, S2_T + S.VIP.days * DAY);
  // no payment row (credit is not money), a log row instead
  assert.equal(e.get("SELECT COUNT(*) n FROM payments WHERE user_id = 1 AND created_at >= ?", S2_T).n, 0);
  assert.deepEqual(e.all('SELECT delta, what, balance FROM star_credit_log WHERE user_id = 1 ORDER BY id').map((x) => ({ ...x })),
    [{ delta: 450, what: 's1-comp', balance: 450 }, { delta: -300, what: 'item:vip', balance: 150 }]);
  // a hryvnia pack: what its invoice would give now
  const want = e.g.packAmountFor(1, 'p2');
  const bal = e.get('SELECT balance FROM users WHERE id = 1').balance;
  assert.equal(e.call(1, 'shop/credit', { pack: 'p2', confirm: true }).amount, want);
  assert.equal(e.get('SELECT balance FROM users WHERE id = 1').balance, bal + want);
  assert.equal(e.call(1, 'me').starCredit, 0);
  // not enough credit: told so, and a confirmed buy fails without touching anything
  assert.equal(e.call(1, 'shop/credit', { item: 'starter' }).enough, false);
  assert.throws(() => e.call(1, 'shop/credit', { item: 'starter', confirm: true }), /не вистачає/);
  assert.equal(e.call(1, 'shop').starterBought, false);
  // the shop's own checks hold: a once-only pack twice, an owned cosmetic
  e.run('UPDATE users SET star_credit = 1000 WHERE id = 2');
  e.call(2, 'shop/credit', { item: 'starter', confirm: true });
  assert.equal(e.get('SELECT balance FROM users WHERE id = 2').balance, S.START_BALANCE + S.SHOP_BY_ID.starter.money);
  assert.equal(e.call(2, 'me').keys.city, 20 + S.SHOP_BY_ID.starter.keys.city);
  assert.throws(() => e.call(2, 'shop/credit', { item: 'starter', confirm: true }), /лише один раз/);
  e.call(2, 'shop/credit', { item: 'frame-neon', confirm: true });
  assert.equal(e.call(2, 'me').style.frame, 'cos:x:frame-neon');
  assert.throws(() => e.call(2, 'shop/credit', { item: 'frame-neon', confirm: true }), /вже твій/);
  // the VIP subscription bought with credit: its 30 days, no Telegram subscription row
  e.call(2, 'shop/credit', { item: 'vipsub', confirm: true });
  assert.equal(e.get('SELECT vip_until FROM users WHERE id = 2').vip_until, S2_T + (S.SHOP_BY_ID.starter.vipDays + S.VIP_SUB.days) * DAY); // the starter pack's VIP days, then the subscription's
  assert.equal(e.get('SELECT 1 FROM vip_subs WHERE user_id = 2'), undefined);
  assert.throws(() => e.call(2, 'shop/credit', { item: 'nope' }), /Невідомий товар/);
});

test('season 2: frames — list, equip only owned, take off; the welcome window once', () => {
  const e = setup();
  e.setT(S2_T);
  assert.equal(e.call(1, 'me').s2Welcome, null, 'nothing before the wipe');
  ownerReset(e.g);
  const f = e.call(1, 'frames');
  assert.equal(f.list.length, S.PROFILE_FRAMES.length);
  assert.ok(f.list.every((x) => x.img === `s2/fr/f${x.fr}.webp`));
  for (const id of ['patron', 'legend_s1', 'veteran_s1', 'vip', 'season2', 'king', 'halloween', 'club_leader', 'diamond', 'drift', 'racer', 'lightning', 'rust']) assert.ok(S.FRAME_BY_ID[id], id);
  assert.throws(() => e.call(1, 'frames/equip', { id: 'king' }), /ще немає/);
  assert.throws(() => e.call(1, 'frames/equip', { id: '__proto__' }), /Невідома рамка/);
  assert.equal(e.call(1, 'frames/equip', { id: 'patron' }).equipped, 'patron');
  assert.equal(e.call(1, 'me').frame, 'patron');
  assert.equal(e.call(1, 'frames/equip', { id: '' }).equipped, null);
  // welcome: the payload lists the compensation, seen → gone
  const w = e.call(2, 'me').s2Welcome;
  assert.equal(w.keys, 20);
  assert.equal(w.veteran.tier, 2);
  assert.deepEqual(w.frames, ['legend_s1', 'veteran_s1']);
  const lines = welcomeLines(w).map((l) => l[1]);
  assert.ok(lines.some((l) => l.includes('20 ключів «Міський»')));
  assert.ok(lines.some((l) => l.includes('Легенда S1')));
  const w1 = e.call(1, 'me').s2Welcome;
  assert.equal(w1.credit, 450);
  assert.ok(welcomeLines(w1)[0][1].startsWith('450 ⭐'));
  assert.equal(e.call(33, 'me').s2Welcome.vipSub, true);
  assert.equal(e.call(33, 'me').s2Welcome.vipUntil, undefined);
  assert.ok(welcomeLines(e.call(33, 'me').s2Welcome).some((l) => l[1] === 'VIP-підписка' && l[2].includes('кредиті')));
  e.call(2, 's2/welcome-seen');
  assert.equal(e.call(2, 'me').s2Welcome, null);
  assert.ok(e.call(1, 'me').s2Welcome, 'per player');
  // a player who joins after the wipe gets no window and no frame
  e.g.ensureUser({ id: 500, first_name: 'New' });
  assert.equal(e.call(500, 'me').s2Welcome, null);
  assert.equal(e.call(500, 'me').frame, null);
});
