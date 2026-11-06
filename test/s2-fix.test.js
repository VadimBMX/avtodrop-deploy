// s2-fix: the player's look on the server (users.helmet + users.frame; S.PROFILE_FRAMES / S.frameAllowed: owned, by
// level, VIP, club owner) and in every list of players; the «Автомийка» perk on the shine's income bonus (S.washFactor
// washBonus — the same formula on the server and in the app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import * as B from '../public/business.js';

const H = 3600e3, DAY = 86400e3;
const CAR = S.ALL_MODELS.find((m) => m.cls === 'B' && !m.secret && !m.edition && !m.homeOnly && !m.season && !m.restored && !S.isCollector(m.id));

function setup() {
  let t = Date.parse('2026-11-03T10:00:00Z');
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, admins: [1], notify: () => {}, random: () => 0.5, allUnlocked: true, partCooldownMs: 0 });
  const call = (uid, name, body = {}) => g.api[name](uid, body);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const mk = (id, level = 1) => {
    g.ensureUser({ id, first_name: 'U' + id, username: 'u' + id });
    run('UPDATE users SET level = ?, level_seen = ?, balance = 1e10, slots = 20 WHERE id = ?', level, level, id);
    return id;
  };
  return { db, g, call, run, get, mk, add: (ms) => (t += ms), at: () => t };
}

test('frames: every id is drawn in code (public/frames.js), one rule for who may wear what', () => {
  for (const f of S.PROFILE_FRAMES) {
    assert.ok(f.name && f.hint, f.id);
    assert.equal([f.lvl, f.vip, f.club, f.own].filter(Boolean).length, 1, `${f.id}: exactly one way to get it`);
  }
  for (let h = 0; h < S.HELMETS; h++) assert.ok(fs.existsSync(new URL(`../public/s2/av/h${h}.webp`, import.meta.url)));
  assert.equal(S.frameAllowed('rust', { level: 1 }), true);
  assert.equal(S.frameAllowed('gold', { level: 14 }), false);
  assert.equal(S.frameAllowed('gold', { level: 15 }), true);
  assert.equal(S.frameAllowed('vip', { level: 99 }), false);
  assert.equal(S.frameAllowed('vip', { vip: true }), true);
  assert.equal(S.frameAllowed('club_leader', { clubOwner: true }), true);
  assert.equal(S.frameAllowed('patron', { level: 99, vip: true }), false);
  assert.equal(S.frameAllowed('patron', { owned: new Set(['patron']) }), true);
  assert.equal(S.frameAllowed('patron', { owned: ['patron'] }), true);
  assert.equal(S.frameAllowed('__proto__', {}), false);
  assert.equal(S.helmetDefault(14), 5);
});

test('look: helmet on the server, frames by level / VIP / club / owned, me.helmet · me.frame · me.frames', () => {
  const T = setup();
  const u = T.mk(14, 12);
  let me = T.call(u, 'me');
  assert.equal(me.helmet, S.helmetDefault(u), 'a new player: the helmet by id');
  assert.equal(me.frame, null);
  assert.deepEqual(me.frames, []);
  // helmet
  assert.equal(T.call(u, 'frames/helmet', { helmet: 7 }).helmet, 7);
  assert.equal(T.call(u, 'me').helmet, 7);
  for (const bad of [-1, 9, 1.5, 'x', null]) assert.throws(() => T.call(u, 'frames/helmet', { helmet: bad }), /Невідомий шолом/);
  // level frames: up to the player's level
  const list = T.call(u, 'frames').list;
  const allowed = list.filter((f) => f.allowed).map((f) => f.id);
  assert.deepEqual(allowed, ['rust', 'steel', 'racer']);
  assert.equal(T.call(u, 'frames/equip', { id: 'racer' }).equipped, 'racer');
  assert.throws(() => T.call(u, 'frames/equip', { id: 'gold' }), /з 15-го рівня/);
  assert.throws(() => T.call(u, 'frames/equip', { id: 'vip' }), /поки діє VIP/);
  assert.throws(() => T.call(u, 'frames/equip', { id: 'club_leader' }), /власника автоклубу/);
  assert.throws(() => T.call(u, 'frames/equip', { id: 'patron' }), /ще немає/);
  // VIP: wearable while active, hidden (not removed) after it runs out
  T.run('UPDATE users SET vip_until = ? WHERE id = ?', T.at() + DAY, u);
  T.call(u, 'frames/equip', { id: 'vip' });
  assert.equal(T.call(u, 'me').frame, 'vip');
  T.add(2 * DAY);
  assert.equal(T.call(u, 'me').frame, null, 'VIP over: the frame is not shown');
  assert.equal(T.get('SELECT frame FROM users WHERE id = ?', u).frame, 'vip', 'the pick stays (comes back with VIP)');
  // club owner
  T.run("INSERT INTO clubs (id, tag, name, owner_id, invite, created_at) VALUES (1, 'ЖИГА', 'Жига', ?, 'inv', ?)", u, T.at());
  T.run("INSERT INTO club_members (user_id, club_id, role, joined_at) VALUES (?, 1, 'owner', ?)", u, T.at());
  T.call(u, 'frames/equip', { id: 'club_leader' });
  assert.equal(T.call(u, 'me').frame, 'club_leader');
  // owned (granted) frames
  T.run("INSERT INTO user_frames (user_id, frame, source, at) VALUES (?, 'patron', 'test', ?)", u, T.at());
  assert.deepEqual(T.call(u, 'me').frames, ['patron']);
  const p = T.call(u, 'frames').list.find((f) => f.id === 'patron');
  assert.equal(p.owned && p.allowed, true);
  T.call(u, 'frames/equip', { id: 'patron' });
  assert.equal(T.call(u, 'me').frame, 'patron');
  assert.equal(T.call(u, 'frames/equip', { id: '' }).equipped, null);
});

test('look: other players carry helmet + frame in the rating, the card, club members, the trade hall, market sellers', () => {
  const T = setup();
  const a = T.mk(21, 20), b = T.mk(22, 3);
  T.call(a, 'frames/helmet', { helmet: 3 });
  T.call(a, 'frames/equip', { id: 'neon' });
  T.g.giveCar(a, CAR.id);
  T.g.giveCar(a, CAR.id);
  T.g.giveCar(b, CAR.id);
  const row = (list, id) => list.find((x) => x.id === id);
  for (const type of ['all', 'week', 'season']) {
    const lb = T.call(b, 'leaderboard', { type });
    if (row(lb.list, a)) assert.deepEqual([row(lb.list, a).helmet, row(lb.list, a).frame], [3, 'neon'], type);
  }
  assert.deepEqual([row(T.call(b, 'leaderboard', { type: 'all' }).list, b).helmet, row(T.call(b, 'leaderboard', { type: 'all' }).list, b).frame], [S.helmetDefault(b), null]);
  const card = T.call(b, 'player', { id: a });
  assert.deepEqual([card.helmet, card.frame], [3, 'neon']);
  // club members
  T.run("INSERT INTO clubs (id, tag, name, owner_id, invite, created_at) VALUES (1, 'ЖИГА', 'Жига', ?, 'inv', ?)", a, T.at());
  T.run("INSERT INTO club_members (user_id, club_id, role, joined_at) VALUES (?, 1, 'owner', ?), (?, 1, 'member', ?)", a, T.at(), b, T.at());
  const mem = T.call(b, 'club').club.members;
  assert.deepEqual([row(mem, a).helmet, row(mem, a).frame], [3, 'neon']);
  // the trade hall (online players)
  T.call(a, 'me');
  const hall = T.call(b, 'hall', {});
  assert.deepEqual([row(hall.online, a).helmet, row(hall.online, a).frame], [3, 'neon']);
  // market sellers
  const carId = T.get('SELECT id FROM cars WHERE owner_id = ?', a).id;
  T.call(a, 'market/sell', { carId, price: 1e6 });
  const lot = T.call(b, 'market/list', {}).list.find((l) => l.sellerId === a);
  assert.deepEqual(lot.sellerLook, { helmet: 3, frame: 'neon' });
  // a frame the player no longer may wear is not shown anywhere
  T.run('UPDATE users SET level = 5 WHERE id = ?', a);
  assert.equal(T.call(b, 'player', { id: a }).frame, null);
  assert.equal(row(T.call(b, 'leaderboard', { type: 'all' }).list, a).frame, null);
});

test('«Автомийка»: +50% to the shine income bonus (only while owned), the same in S.garageIncome and on the server', () => {
  assert.equal(B.BIZ.perks.washBonus, 0.5);
  assert.match(B.PERK_TEXT.wash, /бонус блиску до доходу \+50%/);
  const t = 1e12;
  assert.equal(S.washFactor(0, 0, t + 1, t), 1 + S.WASH.shine);
  assert.equal(S.washFactor(0, 0, t + 1, t, true, 1.5), 1 + S.WASH.shine * 1.5);
  assert.equal(S.washFactor(0, 0, t - 1, t, true, 1.5), 1, 'no shine, no bonus');
  // averaged over a stretch where it shines half the time
  assert.ok(Math.abs(S.washFactorAvg(0, 0, t + H, t, t + 2 * H, true, 1.5) - (1 + S.WASH.shine * 0.75)) < 1e-12);
  const cars = [{ id: 1, model: CAR.id, status: 'garage', dirt: 0, shineUntil: t + H }];
  const g1 = S.garageIncome({ cars, t }), g2 = S.garageIncome({ cars, t, washBonus: 1.5 });
  assert.ok(Math.abs(g2.rate / g1.rate - (1 + S.WASH.shine * 1.5) / (1 + S.WASH.shine)) < 1e-12);

  const T = setup();
  const u = T.mk(31, 20), v = T.mk(32, 20);
  const cu = T.g.giveCar(u, CAR.id).id, cv = T.g.giveCar(v, CAR.id).id;
  T.call(u, 'wash/hand', { carId: cu });
  T.call(v, 'wash/hand', { carId: cv });
  const before = T.call(u, 'me').income.rate;
  assert.equal(before, T.call(v, 'me').income.rate);
  T.call(u, 'biz/buy', { id: 'wash' });
  const me = T.call(u, 'me');
  assert.equal(me.bizPerks.wash, 1.5);
  assert.equal(T.call(v, 'me').bizPerks.wash, 1);
  const clean = before / (1 + S.WASH.shine);
  assert.ok(Math.abs(me.income.rate - clean * (1 + S.WASH.shine * 1.5)) < 1e-6, 'server: shine bonus ×1.5');
  // the app's count (app.js garageInc: S.garageIncome with me.bizPerks.wash) gives the server's rate
  const client = S.garageIncome({
    cars: me.cars.map((c) => ({ ...c, plateValue: c.plate?.value || 0, dirtAt: me.now })),
    slots: me.slots, claimed: me.claims.filter((k) => k.startsWith('set:')).map((k) => k.slice(4)), t: T.at(), cut: true, washBonus: me.bizPerks.wash,
  });
  assert.ok(Math.abs(client.rate - me.income.rate) < 1e-6);
  // earned so far: the bonus only from the purchase on (the garage was banked before it)
  T.add(H);
  const pend = T.call(u, 'me').income.pending;
  assert.ok(Math.abs(pend - Math.floor(me.income.rate)) <= 1, `${pend} vs ${me.income.rate}`);
  // once the shine is over, owning the wash adds nothing
  T.add(S.WASH.shineHours * 1.5 * H);
  assert.equal(T.call(u, 'me').income.rate, T.call(v, 'me').income.rate);
});

test('popups: the Season 2 compensation window may open over the newbie guide focus (calm gets the kind), others wait', async () => {
  const { createPopups } = await import('../public/popups.js');
  const timers = [], shown = [];
  let guide = true;
  const pop = createPopups({ calm: (kind) => kind === 's2welcome' || !guide, idle: () => true, now: () => 0, later: (f) => timers.push(f) });
  pop.offer('level', () => (shown.push('level'), true));
  pop.offer('s2welcome', () => (shown.push('s2welcome'), true));
  pop.ready();
  assert.deepEqual(shown, ['s2welcome']);
  // without it only the guide-blocked windows are queued: nothing opens until the focus ends
  const shown2 = [], timers2 = [];
  const pop2 = createPopups({ calm: (kind) => kind === 's2welcome' || !guide, idle: () => true, now: () => 0, later: (f) => timers2.push(f) });
  pop2.offer('whatsnew', () => (shown2.push('whatsnew'), true));
  pop2.ready();
  assert.deepEqual(shown2, []);
  guide = false;
  timers2.splice(0).forEach((f) => f());
  assert.deepEqual(shown2, ['whatsnew']);
  // the app passes the kind: s2welcome is the only one let through the guide's focus
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /calm: \(kind\) => popIdle\(\) && \(kind === 's2welcome' \|\| !guideOn\(\)\)/);
});
