// QA run: plays АВТОДРОП end to end like real players through the HTTP API of a running DEV server.
//   PORT=3417 DATA_DIR=/tmp/x DEV=1 node server.js     (another terminal)
//   QA_URL=http://localhost:3417 QA_DB=/tmp/x/avtodrop.db node tools/qa-run.mjs [phase…]
// Phases: newbie cases market trades races tune biz clubs misc s2 (the one-shot Season 2 wipe: run last) conc persist.
// QA_DB: the server's database (payments and VIP subscriptions are seeded straight into it for the s2 phase).
// Persistence: `conc` prints «PERSIST {...}»; restart the server and run `QA_PERSIST='{...}' node tools/qa-run.mjs persist`.
// Each phase prints what it did; anything suspicious goes to the «PROBLEMS» list at the end (exit code 1 if any).
// Dev users sign in by the x-dev-user header; admin calls from this computer count as the owner (DEV mode only).
import { setTimeout as sleep } from 'node:timers/promises';
import * as S from '../public/shared.js';

const URL0 = process.env.QA_URL || 'http://localhost:3417';
const BASE = Number(process.env.QA_BASE) || 1e8 + (Date.now() % 1e7) * 10; // fresh players every run
const problems = [];
const notes = [];
const bad = (msg, extra) => (problems.push(msg + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')), console.log('  !! ' + msg));
const note = (msg) => (notes.push(msg), console.log('  · ' + msg));

async function raw(path, body, headers = {}, retry = true) {
  for (let i = 0; retry && i < 30; i++) {
    const r = await raw(path, body, headers, false);
    if (r.status !== 429) return r;
    await sleep(1000); // 60 calls / 10 s per player (server.js limited)
  }
  const r = await fetch(URL0 + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, body: j };
}
const hdr = (u) => ({ 'x-dev-user': encodeURIComponent(JSON.stringify(u)) });
// A player: p.call(name, body) → body (throws on HTTP error unless {soft:true}); p.try(name, body) → {status, body}.
function player(id, first_name, extra = {}) {
  const u = { id, first_name, ...extra };
  const p = {
    id, name: first_name,
    async try(name, body) {
      return raw('/api/' + name, body, hdr(u));
    },
    async burst(name, body) { // no retry on 429: for the double-tap tests
      return raw('/api/' + name, body, hdr(u), false);
    },
    async call(name, body) {
      const r = await raw('/api/' + name, body, hdr(u));
      if (r.status !== 200) {
        bad(`${first_name}: ${name} → ${r.status} ${r.body?.error}`, body);
        return null;
      }
      return r.body;
    },
    async me() {
      return (await raw('/api/me', {}, hdr(u))).body;
    },
  };
  return p;
}
async function admin(name, body) {
  const r = await raw('/api/admin/' + name, { confirm: true, reason: 'qa run', ...body });
  if (r.status !== 200) bad(`admin ${name} → ${r.status} ${r.body?.error}`, body);
  return r.body;
}
const bal = async (p) => (await p.me()).balance;
const eq = (what, got, want) => {
  if (got !== want) bad(`${what}: got ${got}, want ${want}`);
};
// A legacy drag run: the server checks the time on its own clock, so retry while it says the run isn't over.
async function finishRace(p, raceId, extra = {}) {
  for (let i = 0; i < 40; i++) {
    const r = await p.try('race/finish', { raceId, reaction: 0.25, shifts: ['good', 'good', 'good', 'good'], ...extra });
    if (r.status === 200) return r.body;
    if (!/не закінчився/.test(r.body?.error || '')) return bad(`${p.name}: race/finish → ${r.body?.error}`), null;
    await sleep(500);
  }
  bad(`${p.name}: race never finished`);
  return null;
}

// ---------------------------------------------------------------- phases
const phases = {};
const P = {}; // players shared between phases

phases.newbie = async () => {
  console.log('\n== new player: first 30 minutes');
  const a = (P.a = player(BASE + 1, 'Андрій'));
  const m0 = await a.me();
  eq('start balance', m0.balance, S.START_BALANCE);
  if (!m0.keys?.starter) bad('no starter key', m0.keys);
  if (!m0.intro) bad('intro not pending for a new player');
  await a.call('intro/seen');
  if ((await a.me()).intro) bad('intro still pending after intro/seen');
  // Starter case with the key.
  const st = await a.call('case/open', { caseId: 'starter', count: 1 });
  if (!st?.results?.length) bad('starter case gave nothing', st);
  const m1 = await a.me();
  eq('balance after starter (key)', m1.balance, S.START_BALANCE);
  if (m1.cars.length !== 1) bad('starter: cars', m1.cars.length);
  if (m1.keys.starter) bad('starter key not spent', m1.keys);
  // Second starter open must fail (no key, starter case not buyable?).
  const st2 = await a.try('case/open', { caseId: 'starter', count: 1 });
  note(`second starter open → ${st2.status} ${st2.body?.error || 'ok'}`);
  if (st2.status === 200 && (await bal(a)) === S.START_BALANCE) bad('second starter open free', st2.body);
  // Guide: claim step 1.
  const nb = m1.newbie;
  if (!nb?.ready) bad('newbie step 1 not ready after starter', nb);
  const b1 = await bal(a);
  const c1 = await a.call('newbie/claim');
  eq('newbie claim money', (await bal(a)) - b1, c1?.got);
  const c1b = await a.try('newbie/claim');
  if (c1b.status === 200) bad('newbie claim twice', c1b.body);
  // collect (step 2)
  await sleep(1100);
  const col = await a.call('collect');
  note(`collect → ${JSON.stringify(col).slice(0, 120)}`);
  const m2 = await a.me();
  if (m2.newbie?.key === 'collect' && !m2.newbie.ready) bad('collect step not ready after collect', m2.newbie);
  if (m2.newbie?.ready) await a.call('newbie/claim');
  // daily bonus
  const d0 = await bal(a);
  const d = await a.call('rewards/daily');
  note(`daily → ${JSON.stringify(d).slice(0, 160)}`);
  const d2 = await a.try('rewards/daily');
  if (d2.status === 200) bad('daily twice the same day', d2.body);
  if (d?.reward?.money && (await bal(a)) - d0 < d.reward.money) bad('daily money not credited', { d, diff: (await bal(a)) - d0 });
  // First race.
  const m3 = await a.me();
  const car = m3.cars[0];
  const rv = await a.call('race/rivals', { carId: car.id });
  const rival = rv?.list?.[0];
  if (!rival) return bad('no rivals', rv);
  const b2 = await bal(a);
  const rs = await a.call('race/start', { carId: car.id, rival: rival.id });
  eq('race entry paid', b2 - (await bal(a)), rival.entry);
  const rf = await finishRace(a, rs.raceId);
  const b3 = await bal(a);
  eq('race payout', b3 - b2, rf.win ? rival.prize : -rival.entry);
  const rf2 = await a.try('race/finish', { raceId: rs.raceId, reaction: 0.25, shifts: ['good', 'good', 'good', 'good'] });
  if (rf2.status === 200) bad('race finished twice', rf2.body);
  note(`first race: ${rf.win ? 'won' : 'lost'} ${rf.time} vs ${rf.rivalTime}`);
  // Claim whatever guide steps are ready.
  for (let i = 0; i < 5; i++) {
    const m = await a.me();
    if (!m.newbie?.ready) break;
    await a.call('newbie/claim');
  }
  // First business: what does the city offer at level 1?
  const biz = await a.call('biz');
  const cheap = biz?.list?.filter((b) => b.unlocked).sort((x, y) => x.price - y.price)[0];
  note(`biz: ${biz?.list?.length} total, unlocked ${biz?.list?.filter((b) => b.unlocked).map((b) => b.id + ':' + b.price).join(',')}`);
  if (cheap) {
    const bb = await bal(a);
    if (bb >= cheap.price) {
      await a.call('biz/buy', { id: cheap.id });
      eq('biz price paid', bb - (await bal(a)), cheap.price);
      const again = await a.try('biz/buy', { id: cheap.id });
      if (again.status === 200) bad('biz bought twice');
    } else note(`can't afford first business ${cheap.id} ${cheap.price} with ${bb}`);
  }
  const m4 = await a.me();
  note(`after 1st session: lvl ${m4.level} xp ${m4.xp}/${m4.xpNeed} bal ${m4.balance} cars ${m4.cars.length} newbie ${m4.newbie?.step}:${m4.newbie?.key}`);
};


// A ready mid-game player: level, money and a few cars, made through the admin API (owner in DEV).
async function veteran(id, nm, { level = 12, money = 2e9, cars = ['fiat-uno', 'daewoo-matiz', 'zaz-sens', 'vaz-2109', 'hummer-h2'] } = {}) {
  const p = player(id, nm);
  await p.me();
  await p.call('intro/seen');
  await p.call('case/open', { caseId: 'starter', count: 1 });
  await admin('set', { id, field: 'level', value: level });
  await admin('set', { id, field: 'slots', value: 20 });
  await admin('money', { id, amount: money });
  for (const model of cars) if (!S.MODELS[model]) bad('qa: no model ' + model); else await admin('give-car', { id, model });
  return p;
}
const cheapest = (cars) => [...cars].sort((a, b) => a.value - b.value);
// Sum of money a player owns plus what the cars would bring now (used for "money from nothing" checks).
async function worth(p) {
  const m = await p.me();
  return { bal: m.balance, cars: m.cars.length, ids: m.cars.map((c) => c.id).sort((a, b) => a - b) };
}

phases.cases = async () => {
  console.log('\n== cases ×1/×3/×6, keys, fragments');
  const b = (P.b = await veteran(BASE + 2, 'Богдан', { level: 6, money: 50e6 }));
  for (const n of [1, 3, 6]) {
    const m0 = await b.me();
    const r = await b.call('case/open', { caseId: 'rust', count: n });
    if (!r) continue;
    const m1 = await b.me();
    const paidOpens = n - Math.min(n, m0.keys.rust || 0);
    eq(`rust ×${n} price`, m0.balance - m1.balance, r.price * paidOpens);
    eq(`rust ×${n} cars`, m1.cars.length - m0.cars.length, n);
    eq(`rust ×${n} results`, r.results.length, n);
    const fr = r.results.filter((x) => x.fragment).length;
    eq(`rust ×${n} fragments`, fr, r.fragments);
  }
  // Keys: give 2 city keys, open ×3 → 2 keys + 1 paid.
  await admin('keys', { id: b.id, caseId: 'city', count: 2 });
  const m0 = await b.me();
  const r = await b.call('case/open', { caseId: 'city', count: 3 });
  const m1 = await b.me();
  eq('city ×3 with 2 keys paid', m0.balance - m1.balance, r.price);
  eq('city keys left', m1.keys.city || 0, 0);
  // keyOnly with no key → refuse, no charge.
  const ko = await b.try('case/open', { caseId: 'city', count: 1, keyOnly: true });
  if (ko.status === 200) bad('keyOnly opened without a key', ko.body);
  eq('keyOnly refused: balance', (await b.me()).balance, m1.balance);
  // expect lower than price → refused
  const ex = await b.try('case/open', { caseId: 'city', count: 1, expect: 1 });
  if (ex.status === 200) bad('expect=1 still charged', ex.body);
  eq('expect refused: balance', (await b.me()).balance, m1.balance);
  // invalid counts
  for (const c of [2, 0, -1, 7, 1.5, 'x']) {
    const t = await b.try('case/open', { caseId: 'rust', count: c });
    if (t.status === 200) bad(`case/open count=${c} accepted`, t.body);
  }
  // Fragments: open rust until a key appears from fragments.
  let got = 0, opens = 0;
  for (let i = 0; i < 12 && !got; i++) {
    const me = await b.me();
    if (me.slots - me.cars.length < 6) {
      const sellIds = cheapest(me.cars).slice(0, me.cars.length - 4).map((c) => c.id);
      await b.call('sell', { carIds: sellIds });
    }
    const r6 = await b.call('case/open', { caseId: 'rust', count: 6 });
    opens += 6;
    got += r6?.newKeys || 0;
  }
  note(`fragments: ${opens} rust opens → ${got} key(s) from fragments (need ${S.FRAGMENTS_PER_KEY})`);
  // Garage full: slot count enforced.
  const me = await b.me();
  const free = me.slots - me.cars.filter((c) => c.status === 'garage').length;
  note(`garage ${me.cars.length}/${me.slots}, free ${free}`);
  // history / fairness
  const h = await b.call('case/history');
  if (!Array.isArray(h) || !h.length) bad('case/history empty', h);
};

phases.market = async () => {
  console.log('\n== selling, collection, market, buying from another player');
  const s = (P.s = await veteran(BASE + 3, 'Світлана', { level: 8, money: 20e6, cars: ['fiat-uno', 'daewoo-matiz', 'zaz-sens', 'vaz-2109', 'hummer-h2', 'jeep-wrangler'] }));
  const t = (P.t = await veteran(BASE + 4, 'Тарас', { level: 8, money: 20e6 }));
  let ms = await s.me();
  // sell one car instantly
  const sc = cheapest(ms.cars)[0];
  const b0 = ms.balance;
  const sold = await s.call('sell', { carIds: [sc.id] });
  ms = await s.me();
  eq('instant sell credited', ms.balance - b0, sold?.got);
  if (sold && Math.abs(sold.got - sc.sell) > Math.max(2, sc.sell * 0.06)) bad('sell price differs from the card', { card: sc.sell, got: sold.got });
  // sell same car again
  const again = await s.try('sell', { carIds: [sc.id] });
  if (again.status === 200) bad('sold a car twice');
  // duplicate ids in one call
  const dup = cheapest(ms.cars)[0];
  const b1 = ms.balance;
  const d = await s.try('sell', { carIds: [dup.id, dup.id] });
  ms = await s.me();
  if (d.status === 200 && ms.balance - b1 > dup.sell * 1.1) bad('sell with duplicate ids paid twice', { got: d.body, sell: dup.sell });
  // collection claim (none expected) and sets
  const col = await s.call('sets');
  note(`sets: ${Object.keys(col || {}).join(',')}`);
  // list on market
  ms = await s.me();
  const lc = cheapest(ms.cars)[0];
  const price = Math.max(1000, Math.round(lc.value * 1.1));
  await s.call('market/sell', { carId: lc.id, price });
  const lst = await t.call('market/list', {});
  const lot = lst?.list?.find((l) => l.car?.id === lc.id);
  if (!lot) return bad('listing not visible to another player');
  // seller can't buy own
  const own = await s.try('market/buy', { id: lot.id });
  if (own.status === 200) bad('bought own lot');
  // the listed car can't be sold / raced / traded while on the market
  const sl = await s.try('sell', { carIds: [lc.id] });
  if (sl.status === 200) bad('sold a car that is on the market');
  const sb = (await s.me()).balance, tb = (await t.me()).balance;
  // double tap buy from two buyers at once
  const u = (P.u = await veteran(BASE + 5, 'Уляна', { level: 8, money: 20e6 }));
  const [r1, r2] = await Promise.all([t.burst('market/buy', { id: lot.id }), u.burst('market/buy', { id: lot.id })]);
  const wins = [r1, r2].filter((r) => r.status === 200).length;
  eq('market lot bought by exactly one', wins, 1);
  const sa = (await s.me()).balance, ta = (await t.me()).balance, ua = (await u.me()).balance;
  eq('seller got price minus fee', sa - sb, Math.floor(price * (1 - S.FEE)));
  const spent = tb - ta + (20e6 + 0 - ua > 0 ? 0 : 0);
  if (r1.status === 200) eq('buyer paid', tb - ta, price);
  const tm = await t.me();
  if (r1.status === 200 && !tm.cars.some((c) => c.id === lc.id)) bad('bought car not in buyer garage');
  note(`market: sold ${lc.model} for ${price}, spent ${spent}`);
  // dealer
  const dl = lst.list.filter((l) => l.dealer).sort((a, b) => a.price - b.price)[0];
  if (dl) {
    const b2 = (await t.me()).balance;
    const r = await t.try('market/buy', { id: dl.id });
    if (r.status === 200) eq('dealer price paid', b2 - (await t.me()).balance, dl.price);
    else note(`dealer buy → ${r.body?.error}`);
  }
  // cancel own listing
  ms = await s.me();
  const lc2 = cheapest(ms.cars.filter((c) => c.status === 'garage'))[0];
  await s.call('market/sell', { carId: lc2.id, price: 5000 });
  const l2 = (await s.call('market/list', {})).list.find((l) => l.car?.id === lc2.id);
  await s.call('market/cancel', { id: l2.id });
  if ((await s.me()).cars.find((c) => c.id === lc2.id)?.status !== 'garage') bad('cancelled lot car not back in garage');
  // items market: parts
  await admin('part', { id: s.id, type: 'eng', tier: 'street', count: 2 });
  const it = await s.try('market/item-sell', { kind: 'part', type: 'eng', tier: 'street', count: 1, price: 20000 });
  if (it.status !== 200) note(`item-sell → ${it.body?.error}`);
  else {
    const items = await t.call('market/items', { kind: 'part' });
    const il = items?.list?.find((x) => x.sellerId === s.id || x.mine === false);
    if (il) {
      const tb2 = (await t.me()).balance;
      const rb = await t.try('market/item-buy', { id: il.id });
      if (rb.status === 200) eq('item-buy price', tb2 - (await t.me()).balance, il.price);
      else note(`item-buy → ${rb.body?.error}`);
    } else note('item lot not found in market/items ' + JSON.stringify(items).slice(0, 200));
  }
};

phases.trades = async () => {
  console.log('\n== trades, rooms, auctions, plates');
  const s = P.s || (P.s = await veteran(BASE + 3, 'Світлана', { level: 8, money: 20e6 }));
  const t = P.t || (P.t = await veteran(BASE + 4, 'Тарас', { level: 8, money: 20e6 }));
  let ms = await s.me(), mt = await t.me();
  const g = cheapest(ms.cars.filter((c) => c.status === 'garage'))[0], r = cheapest(mt.cars.filter((c) => c.status === 'garage'))[0];
  const tr = await s.call('trade/create', { to: t.id, give: [g.id], get: [r.id], giveMoney: 1000, getMoney: 0 });
  const sb = ms.balance, tb = mt.balance;
  // accept twice in parallel
  const [a1, a2] = await Promise.all([t.burst('trade/accept', { id: tr.id }), t.burst('trade/accept', { id: tr.id })]);
  eq('trade accepted once', [a1, a2].filter((x) => x.status === 200 && !x.body?.stale).length, 1);
  ms = await s.me();
  mt = await t.me();
  eq('trade: giver paid 1000', sb - ms.balance, 1000);
  eq('trade: taker got 1000', mt.balance - tb, 1000);
  if (!mt.cars.some((c) => c.id === g.id) || !ms.cars.some((c) => c.id === r.id)) bad('trade cars not swapped');
  // trade with money the giver no longer has
  const tr2 = await s.call('trade/create', { to: t.id, give: [], get: [cheapest(mt.cars)[0].id], giveMoney: ms.balance, getMoney: 0 });
  await admin('money', { id: s.id, amount: -ms.balance + 10 });
  const st = await t.call('trade/accept', { id: tr2.id });
  if (!st?.stale) bad('trade accepted although the giver has no money', st);
  await admin('money', { id: s.id, amount: 20e6 });
  // Rooms
  const room = await s.call('room/create', { note: 'qa' });
  await t.call('room/join', { id: room.id });
  ms = await s.me();
  mt = await t.me();
  const hc = cheapest(ms.cars.filter((c) => c.status === 'garage'))[0];
  await s.call('room/offer', { id: room.id, add: hc.id, money: 5000 });
  await t.call('room/offer', { id: room.id, money: 0 });
  let rs = await s.call('room/state', { id: room.id });
  const sb2 = (await s.me()).balance, tb2 = (await t.me()).balance;
  await s.call('room/ready', { id: room.id, version: rs.version, ready: true });
  // host sells the car before the guest confirms
  const before = await t.call('room/ready', { id: room.id, version: rs.version, ready: true });
  if (!before?.done) bad('room swap not done', before);
  eq('room: host paid 5000', sb2 - (await s.me()).balance, 5000);
  eq('room: guest got 5000', (await t.me()).balance - tb2, 5000);
  if (!(await t.me()).cars.some((c) => c.id === hc.id)) bad('room car not moved to guest');
  // room: car on the table sold before ready → stale
  const room2 = await s.call('room/create', {});
  if (room2.id === room.id) bad('room/create returned the finished room', room2);
  await t.call('room/join', { id: room2.id });
  ms = await s.me();
  const c2 = cheapest(ms.cars.filter((c) => c.status === 'garage'))[0];
  await s.call('room/offer', { id: room2.id, add: c2.id });
  rs = await s.call('room/state', { id: room2.id });
  await s.call('sell', { carIds: [c2.id] });
  await s.call('room/ready', { id: room2.id, version: rs.version, ready: true });
  const rr = await t.call('room/ready', { id: room2.id, version: rs.version, ready: true });
  if (rr?.done) bad('room swap of a sold car went through', rr);
  await s.call('room/leave', { id: room2.id });
  // Auctions
  ms = await s.me();
  const ac = cheapest(ms.cars.filter((c) => c.status === 'garage'))[0];
  await s.call('auction/create', { carId: ac.id, startPrice: 10000, hours: 1 });
  const al = await t.call('auction/list');
  const au = al?.list?.find((x) => x.car?.id === ac.id);
  if (!au) bad('auction not listed');
  else {
    const u = P.u || (P.u = await veteran(BASE + 5, 'Уляна', { level: 8, money: 20e6 }));
    const tb3 = (await t.me()).balance, ub3 = (await u.me()).balance;
    await t.call('auction/bid', { id: au.id, amount: 10000 });
    await u.call('auction/bid', { id: au.id, amount: 10500 });
    eq('outbid refunded', (await t.me()).balance, tb3);
    eq('bidder escrow', ub3 - (await u.me()).balance, 10500);
    // parallel bids at the same minimum
    const [x1, x2] = await Promise.all([t.burst('auction/bid', { id: au.id, amount: 11025 }), t.burst('auction/bid', { id: au.id, amount: 11025 })]);
    const okN = [x1, x2].filter((x) => x.status === 200).length;
    note(`parallel same bids: ${okN} accepted`);
    const tb4 = (await t.me()).balance;
    if (tb3 - tb4 !== 11025 * (okN ? 1 : 0)) bad('auction double bid escrow wrong', { paid: tb3 - tb4, okN });
    const cancel = await s.try('auction/cancel', { id: au.id });
    if (cancel.status === 200) bad('auction cancelled with bids');
  }
  // Plates
  const pg = await s.try('plate/generate', { gen: 'basic' });
  if (pg.status !== 200) bad('plate/generate failed ' + pg.body?.error);
  else {
    ms = await s.me();
    const pl = ms.plates[ms.plates.length - 1];
    const car = ms.cars.find((c) => c.status === 'garage');
    await s.call('plate/attach', { plateId: pl.id, carId: car.id });
    ms = await s.me();
    if (ms.cars.find((c) => c.id === car.id)?.plate?.id !== pl.id && ms.cars.find((c) => c.id === car.id)?.plate == null) bad('plate not on car');
    // sell the car with the plate: the plate should come back to the player
    const others = ms.cars.filter((c) => c.status === 'garage' && c.id !== car.id);
    if (others.length) {
      await s.call('sell', { carIds: [car.id] });
      ms = await s.me();
      if (!ms.plates.some((p) => p.id === pl.id)) bad('plate lost when its car was sold');
    }
    const b5 = (await s.me()).balance;
    const ps = await s.call('plate/sell', { plateId: pl.id });
    eq('plate sold credit', (await s.me()).balance - b5, ps?.got);
    const ps2 = await s.try('plate/sell', { plateId: pl.id });
    if (ps2.status === 200) bad('plate sold twice');
  }
  // plate auction page
  const pa = await s.try('plateAuction', {});
  note(`plateAuction → ${pa.status} ${pa.body?.error || Object.keys(pa.body || {}).join(',')}`);
};


// A replayed run (launch + shift times): no shifts → the limiter shifts late. Waits until the server lets it finish.
async function finishReplay(p, name, body, greenMs) {
  for (let i = 0; i < 60; i++) {
    const r = await p.try(name, { ...body, launch: greenMs + 260, shiftAt: [] });
    if (r.status === 200) return r.body;
    if (!/не закінчився/.test(r.body?.error || '')) return bad(`${p.name}: ${name} → ${r.body?.error}`), null;
    await sleep(500);
  }
  return bad(`${p.name}: ${name} never finished`), null;
}

phases.races = async () => {
  console.log('\n== races: drag, drift, boss, PvP, day race, tourney, battles');
  const r = (P.r = await veteran(BASE + 6, 'Роман', { level: 10, money: 50e6, cars: ['fiat-uno', 'hummer-h2', 'toyota-gr-yaris'] }));
  const k = (P.k = await veteran(BASE + 7, 'Катя', { level: 10, money: 50e6, cars: ['fiat-uno', 'hummer-h2', 'toyota-gr-yaris'] }));
  let m = await r.me();
  const car = m.cars.find((c) => c.model === 'toyota-gr-yaris');
  // drag with the replay protocol
  const rv = await r.call('race/rivals', { carId: car.id });
  const riv = rv.list[rv.list.length - 1];
  const b0 = (await r.me()).balance;
  const st = await r.call('race/start', { carId: car.id, rival: riv.id });
  const early = await r.try('race/finish', { raceId: st.raceId, launch: st.greenMs + 260, shiftAt: [] });
  if (early.status === 200) bad('race finished before it could have ended (no wall-clock check)', early.body);
  const fin = await finishReplay(r, 'race/finish', { raceId: st.raceId }, st.greenMs);
  if (fin) eq('drag replay money', (await r.me()).balance - b0, fin.win ? riv.prize : -riv.entry);
  // finishing someone else's race
  const st2 = await r.call('race/start', { carId: car.id, rival: riv.id });
  const other = await k.try('race/finish', { raceId: st2.raceId, reaction: 0.3, shifts: ['good', 'good', 'good', 'good'] });
  if (other.status === 200) bad('finished another player\'s race', other.body);
  // double finish in parallel
  await sleep(9000);
  const [f1, f2] = await Promise.all([1, 2].map(() => r.burst('race/finish', { raceId: st2.raceId, reaction: 0.3, shifts: ['good', 'good', 'good', 'good'] })));
  eq('race finish paid once', [f1, f2].filter((x) => x.status === 200).length, 1);
  // drift (legacy finish: capped, can't win)
  const dr = await r.call('drift/rivals', { carId: car.id });
  if (dr?.list?.length) {
    const b1 = (await r.me()).balance;
    const ds = await r.call('drift/start', { carId: car.id, rival: dr.list[0].id });
    eq('drift entry', b1 - (await r.me()).balance, dr.list[0].entry);
    await sleep(S.DRIFT_COUNT_MS + 20000);
    const df = await r.call('drift/finish', { runId: ds.runId, score: 1e9, clean: 3, spins: 0 });
    if (df?.win) bad('legacy drift with score 1e9 won', df);
    const df2 = await r.try('drift/finish', { runId: ds.runId, score: 1, clean: 0, spins: 0 });
    if (df2.status === 200) bad('drift finished twice');
    // training: free
    const b2 = (await r.me()).balance;
    const tr = await r.call('drift/start', { carId: car.id, rival: 'train' });
    eq('drift training free', (await r.me()).balance, b2);
    note(`drift training run ${tr?.runId}`);
  }
  // boss
  const bl = await r.call('boss/list', { carId: car.id });
  const nb = bl?.list?.find((b) => b.open && !b.beaten);
  note(`bosses: ${bl?.list?.length}, next ${nb?.id} fits=${nb?.fits}`);
  if (nb) {
    const fit = (await r.me()).cars.find((c) => S.bossFits(S.BOSS_BY_ID[nb.id], c.model));
    if (fit) {
      const bs = await r.call('boss/start', { carId: fit.id, boss: nb.id });
      if (bs) {
        const bf = await finishReplay(r, 'race/finish', { raceId: bs.raceId }, bs.greenMs);
        note(`boss ${nb.id}: ${bf?.win ? 'won' : 'lost'} ${JSON.stringify(bf?.boss || {}).slice(0, 160)}`);
      }
    } else note('no car fits the first boss');
    const hard = await r.try('boss/start', { carId: car.id, boss: nb.id, hard: true });
    if (hard.status === 200 && !(await r.call('boss/list', { carId: car.id })).list.find((b) => b.id === nb.id)?.beaten) bad('hard boss rematch before the first win');
  }
  // PvP: create (offline creator → autopilot accept)
  const pb = (await r.me()).balance, kb = (await k.me()).balance;
  const bet = Math.max(S.PVP_MIN_BET, 10000);
  const pv = await r.call('pvp/create', { carId: car.id, bet });
  eq('pvp bet escrow', pb - (await r.me()).balance, bet);
  const kc = (await k.me()).cars.find((c) => c.model === 'toyota-gr-yaris');
  const [pa1, pa2] = await Promise.all([k.burst('pvp/accept', { id: pv.id, carId: kc.id }), k.burst('pvp/accept', { id: pv.id, carId: kc.id })]);
  eq('pvp accepted once', [pa1, pa2].filter((x) => x.status === 200).length, 1);
  const acc = [pa1, pa2].find((x) => x.status === 200)?.body;
  const pa = (await r.me()).balance, ka = (await k.me()).balance;
  const prize = Math.floor(bet * 2 * (1 - S.FEE));
  eq('pvp money conserved (minus fee)', pa - pb + (ka - kb), prize - 2 * bet);
  note(`pvp: ${acc?.win ? 'Катя' : 'Роман'} won`);
  // pvp cancel refund
  const pv2 = await r.call('pvp/create', { carId: car.id, bet });
  const [c1, c2] = await Promise.all([r.burst('pvp/cancel', { id: pv2.id }), r.burst('pvp/cancel', { id: pv2.id })]);
  eq('pvp cancel refunded once', [c1, c2].filter((x) => x.status === 200).length, 1);
  // live pvp request: creator online → pending → answer → live → finish both
  const pv3 = await r.call('pvp/create', { carId: car.id, bet });
  await r.me();
  const rq = await k.call('pvp/request', { id: pv3.id, carId: kc.id });
  if (rq?.offline) note('pvp request: creator counted offline');
  else if (rq) {
    const an = await r.call('pvp/answer', { id: pv3.id, yes: true });
    const wait = an.greenAt - an.now + 200;
    await sleep(Math.max(0, an.startAt - an.now) + 500);
    let done = 0;
    for (let i = 0; i < 40 && done < 2; i++) {
      done = 0;
      for (const p of [r, k]) {
        const x = await p.try('pvp/finish', { id: pv3.id, launch: an.greenAt - an.startAt + 250, shiftAt: [] });
        if (x.status === 200 && (x.body.status === 'done' || x.body.me?.done)) done++;
      }
      await sleep(700);
    }
    const stt = await r.call('pvp/state', { id: pv3.id });
    if (stt?.status !== 'done') bad('live pvp never finished', stt);
    note(`live pvp: ${stt?.status} win=${stt?.win} (wait ${wait})`);
  }
  // day race
  m = await r.me();
  const dv = await r.call('dayrace');
  if (dv) {
    const ds = await r.call('dayrace/start');
    if (ds) {
      const df = await finishReplay(r, 'race/finish', { raceId: ds.raceId }, ds.greenMs);
      note(`dayrace: time ${df?.time} ${JSON.stringify(df?.dayrace || df?.board || {}).slice(0, 120)}`);
      const legacy = await r.call('dayrace/start');
      if (legacy) {
        await sleep(9000);
        const lf = await r.try('race/finish', { raceId: legacy.raceId, reaction: 0.2, shifts: ['perfect', 'perfect', 'perfect', 'perfect'] });
        if (lf.status === 200) bad('day race accepted a legacy (unchecked) run', lf.body);
      }
    }
  }
  // tourney
  const tv = await r.call('tourney');
  note(`tourney phase ${tv?.phase}, reg ${new Date(tv?.regOpen).toISOString()}`);
  const tj = await r.try('tourney/join', { carId: car.id });
  note(`tourney/join now → ${tj.status} ${tj.body?.error || 'ok'}`);
  // battles
  const kb2 = (await k.me()).balance, rb2 = (await r.me()).balance;
  const bt = await r.call('battle/create', { caseId: 'rust', count: 3 });
  eq('battle escrow', rb2 - (await r.me()).balance, S.CASE_BY_ID.rust.price * 3);
  const [j1, j2] = await Promise.all([k.burst('battle/join', { id: bt.id }), k.burst('battle/join', { id: bt.id })]);
  eq('battle joined once', [j1, j2].filter((x) => x.status === 200).length, 1);
  const res = [j1, j2].find((x) => x.status === 200)?.body;
  const rm = await r.me(), km = await k.me();
  eq('battle join paid', kb2 - km.balance + (res?.result?.consolation?.soldFor && res.winnerId === r.id ? res.result.consolation.soldFor : 0), S.CASE_BY_ID.rust.price * 3);
  note(`battle: winner ${res?.winnerId === r.id ? 'Роман' : res?.winnerId === k.id ? 'Катя' : 'draw'}; cars Р ${rm.cars.length} К ${km.cars.length}`);
  const bt2 = await r.call('battle/create', { caseId: 'rust', count: 1 });
  const [x1, x2] = await Promise.all([r.burst('battle/cancel', { id: bt2.id }), r.burst('battle/cancel', { id: bt2.id })]);
  eq('battle cancel refunded once', [x1, x2].filter((x) => x.status === 200).length, 1);
};


phases.tune = async () => {
  console.log('\n== tuning, parts, paint, wash, fuel');
  const w = (P.w = await veteran(BASE + 8, 'Василь', { level: 10, money: 50e6, cars: ['fiat-uno', 'hummer-h2'] }));
  let m = await w.me();
  const car = m.cars.find((c) => c.model === 'hummer-h2');
  // part cases
  const b0 = m.balance;
  const po = await w.call('parts/open', { caseId: 'scrap', count: 5 });
  eq('parts/open price', b0 - (await w.me()).balance - (po?.autoSold?.got ? -po.autoSold.got : 0), po?.price);
  const quick = await w.try('parts/open', { caseId: 'scrap', count: 1 });
  if (quick.status === 200) bad('part case cooldown not enforced');
  // give 6 street engines → merge, install, uninstall (cooling), market sell refused while cooling
  await admin('part', { id: w.id, type: 'eng', tier: 'street', count: 6 });
  const mg = await w.call('parts/merge', { type: 'eng', tier: 'street' });
  note(`merge street→sport: ${mg?.ok}`);
  const ins = await w.call('parts/install', { carId: car.id, type: 'eng', tier: 'street' });
  if (!ins?.car?.parts?.eng) bad('installed part not on car', ins?.car?.parts);
  m = await w.me();
  const invBefore = m.parts.find((p) => p.type === 'eng' && p.tier === 'street');
  await w.call('parts/uninstall', { carId: car.id, type: 'eng' });
  m = await w.me();
  const invAfter = m.parts.find((p) => p.type === 'eng' && p.tier === 'street');
  note(`street eng: before ${JSON.stringify(invBefore)} after ${JSON.stringify(invAfter)}`);
  const best = await w.call('parts/install-best', { carId: car.id });
  note(`install-best: ${best?.changes?.length} changes, dt ${best?.dt}`);
  // sell parts: more than owned
  const sp = await w.try('parts/sell', { type: 'eng', tier: 'street', count: 999 });
  if (sp.status === 200) bad('sold more parts than owned', sp.body);
  const neg = await w.try('parts/sell', { type: 'eng', tier: 'street', count: -5 });
  if (neg.status === 200) bad('sold a negative number of parts', neg.body);
  // paint
  const colors = S.PAINT_COLORS.map((c) => c.id);
  const pb = (await w.me()).balance;
  const pt = await w.try('car/paint', { carId: car.id, color: colors[0] });
  if (pt.status === 200) eq('paint price', pb - (await w.me()).balance, pt.body.paid);
  else note(`paint → ${pt.body?.error}`);
  const pr = await w.try('car/paint-reset', { carId: car.id });
  note(`paint-reset → ${pr.status}`);
  // wash: hand ×3 free then refused; auto paid
  for (let i = 0; i < S.WASH.hand; i++) await w.call('wash/hand', { carId: car.id });
  const h4 = await w.try('wash/hand', { carId: car.id });
  if (h4.status === 200) bad('4th free hand wash in a day');
  const wb = (await w.me()).balance;
  const wa = await w.call('wash/auto', { carIds: [car.id] });
  eq('auto wash price', wb - (await w.me()).balance, wa?.paid);
  const wd = await w.try('wash/auto', { carIds: [car.id, car.id] });
  if (wd.status === 200) bad('auto wash with a duplicate id accepted');
  // fuel: race until the tank is empty, then refused
  m = await w.me();
  note(`fuel ${m.fuel}/${m.fuelMax}, spare ${m.fuelSpare}`);
  const uno = m.cars.find((c) => c.model === 'fiat-uno');
  let races = 0;
  for (let i = 0; i < 30; i++) {
    const me = await w.me();
    if (me.fuel < 1) break;
    const rv = await w.call('race/rivals', { carId: uno.id });
    const st = await w.try('race/start', { carId: uno.id, rival: rv.list[0].id });
    if (st.status !== 200) {
      if (/хвилину/.test(st.body?.error)) {
        await sleep(15000);
        continue;
      }
      note(`race start refused at fuel ${me.fuel}: ${st.body?.error}`);
      break;
    }
    races++;
  }
  m = await w.me();
  const empty = await w.try('race/start', { carId: uno.id, rival: (await w.call('race/rivals', { carId: uno.id })).list[0].id });
  if (m.fuel < 1 && empty.status === 200) bad('raced with an empty tank');
  if (m.fuel < 0) bad('negative fuel', m.fuel);
  note(`ran ${races} races (abandoned), fuel now ${m.fuel}; empty-tank start → ${empty.status} ${empty.body?.error}`);
  // tank upgrade / slots / cap
  const tb = (await w.me()).balance;
  const tu = await w.try('tank/upgrade');
  note(`tank/upgrade → ${tu.status} ${tu.body?.error || ''} paid ${tb - (await w.me()).balance}`);
  const sb = (await w.me()).balance, sl = (await w.me()).slots;
  const bs = await w.try('buy-slot');
  if (bs.status === 200) {
    eq('slot +1', (await w.me()).slots, sl + 1);
    eq('slot price', sb - (await w.me()).balance, S.slotCost(sl));
  } else note(`buy-slot → ${bs.body?.error}`);
  const cb = await w.try('upgrade-cap');
  note(`upgrade-cap → ${cb.status} ${cb.body?.error || ''}`);
  // upgrade (risk cars)
  m = await w.me();
  const cheap = cheapest(m.cars.filter((c) => c.status === 'garage' && c.id !== car.id)).slice(0, 1);
  if (cheap.length) {
    const ug = await w.try('upgrade', { carIds: cheap.map((c) => c.id), target: 'hummer-h2' });
    note(`upgrade → ${ug.status} ${ug.body?.error || JSON.stringify(ug.body).slice(0, 120)}`);
  }
  // trade-in: 3 D cars
  for (const mdl of ['fiat-uno', 'daewoo-matiz', 'zaz-sens']) await admin('give-car', { id: w.id, model: mdl });
  m = await w.me();
  const ds = m.cars.filter((c) => S.MODELS[c.model].cls === 'D' && c.status === 'garage').slice(0, 3);
  const n0 = m.cars.length;
  const ti = await w.try('dealer/tradein', { carIds: ds.map((c) => c.id) });
  if (ti.status === 200) eq('trade-in 3→1', (await w.me()).cars.length, n0 - 2);
  else note(`tradein → ${ti.body?.error}`);
};

phases.biz = async () => {
  console.log('\n== businesses');
  const z = (P.z = await veteran(BASE + 9, 'Зіна', { level: 16, money: 100e6, cars: ['fiat-uno'] }));
  const B = await import('../public/business.js');
  let l = await z.call('biz');
  for (const b of l.list) {
    const bb = (await z.me()).balance;
    const r = await z.call('biz/buy', { id: b.id });
    if (r) eq(`buy ${b.id}`, bb - (await z.me()).balance, b.price);
  }
  // double buy in parallel of an owned one → refused
  const [d1, d2] = await Promise.all([z.burst('biz/buy', { id: 'wash' }), z.burst('biz/buy', { id: 'wash' })]);
  if ([d1, d2].some((x) => x.status === 200)) bad('bought an owned business again');
  // upgrade branches
  l = await z.call('biz');
  const wash = l.list.find((b) => b.id === 'wash');
  for (const br of B.BRANCH_KEYS) {
    const bb = (await z.me()).balance;
    const r = await z.try('biz/upgrade', { id: 'wash', branch: br });
    if (r.status === 200) eq(`upgrade ${br}`, bb - (await z.me()).balance, wash.next[br]);
    else note(`biz/upgrade ${br} → ${r.body?.error}`);
  }
  const bu = await z.try('biz/upgrade', { id: 'wash', branch: 'build' });
  note(`build w/o branches → ${bu.status} ${bu.body?.error || ''}`);
  const bad1 = await z.try('biz/upgrade', { id: 'wash', branch: 'constructor' });
  if (bad1.status === 200) bad('biz/upgrade with branch=constructor accepted');
  const bad2 = await z.try('biz/buy', { id: '__proto__' });
  if (bad2.status === 200) bad('biz/buy __proto__ accepted');
  // collect: wait, then collect twice in parallel
  await sleep(4000);
  const c0 = (await z.me()).balance;
  const [c1, c2] = await Promise.all([z.burst('biz/collect', { all: true }), z.burst('biz/collect', { all: true })]);
  const got = [c1, c2].reduce((s, x) => s + (x.body?.got || 0), 0);
  eq('biz collect paid what it said', (await z.me()).balance - c0, got);
  const ex = (l.totalRate * 6) / 3600; // ~6 s of income at most
  if (got > ex * 3 + 10) bad('biz collect paid more than the time allows', { got, ratePerH: l.totalRate });
  note(`biz: rate ${l.totalRate}/h, collected ${got} after ~4 s`);
  // perks: wash/gas/sto/salon in effect
  const m = await z.me();
  note(`biz perks: fuelMax ${m.fuelMax}`);
  // level gate
  const low = await veteran(BASE + 10, 'Лев', { level: 2, money: 100e6, cars: [] });
  const lg = await low.try('biz/buy', { id: 'wash' });
  if (lg.status === 200) bad('business bought below its level');
};

phases.clubs = async () => {
  console.log('\n== clubs');
  const C = (await import('../public/clubs.js')).CLUB;
  const o = (P.o = await veteran(BASE + 11, 'Олег', { level: 10, money: 50e6, cars: [] }));
  const j = (P.j = await veteran(BASE + 12, 'Юля', { level: 10, money: 50e6, cars: [] }));
  const tag = 'Q' + String(BASE).slice(-3);
  const ob = (await o.me()).balance;
  const [k1, k2] = await Promise.all([o.burst('club/create', { tag, name: 'QA Клуб ' + tag.slice(1), open: true }), o.burst('club/create', { tag, name: 'QA Клуб ' + tag.slice(1), open: true })]);
  eq('club created once', [k1, k2].filter((x) => x.status === 200).length, 1);
  eq('club cost', ob - (await o.me()).balance, C.createCost);
  const club = [k1, k2].find((x) => x.status === 200)?.body?.club;
  if (!club) return;
  const cid = club.id ?? club.club?.id;
  const jr = await j.call('club/join', { id: cid });
  if (!jr) return;
  const jb = (await j.me()).balance;
  await j.call('club/donate', { amount: C.donateMin });
  eq('donate paid', jb - (await j.me()).balance, C.donateMin);
  const dn = await j.try('club/donate', { amount: -1000 });
  if (dn.status === 200) bad('negative donation accepted');
  const v = await o.call('club');
  note(`club: treasury ${v?.club?.treasury ?? v?.treasury}, members ${v?.club?.members?.length ?? v?.members?.length}`);
  // owner leaves with members → refused; member leaves; owner leaves → disband
  const ol = await o.try('club/leave');
  if (ol.status === 200) bad('owner left a club with members');
  await j.call('club/leave');
  const j2 = await j.try('club/join', { id: cid });
  note(`rejoin → ${j2.status}`);
};

phases.misc = async () => {
  console.log('\n== garage slots, VIP, level-ups, achievements, goals, pass, quests, promo');
  const x = (P.x = await veteran(BASE + 13, 'Ярема', { level: 3, money: 20e6, cars: [] }));
  // level-up through XP
  const m0 = await x.me();
  await admin('set', { id: x.id, field: 'xp', value: m0.xpNeed + 5 });
  const m1 = await x.me();
  note(`xp set over need: level ${m0.level} → ${m1.level}, xp ${m1.xp}/${m1.xpNeed}`);
  await x.call('case/open', { caseId: 'rust', count: 1 });
  const m2 = await x.me();
  note(`after a case: level ${m2.level} xp ${m2.xp}/${m2.xpNeed} levelSeen ${m2.levelSeen}`);
  const ls = await x.try('level/seen');
  note(`level/seen → ${ls.status}`);
  // achievements
  const ach = await x.call('achievements');
  const ready = (ach?.list || []).filter((a) => a.ready || a.claimable);
  note(`achievements: ${ach?.list?.length}, ready ${ready.length}`);
  for (const a of ready) {
    const b = (await x.me()).balance;
    const [r1, r2] = await Promise.all([x.burst('ach/claim', { key: a.key }), x.burst('ach/claim', { key: a.key })]);
    if ([r1, r2].filter((r) => r.status === 200).length > 1) bad('achievement claimed twice ' + a.key);
    note(`ach ${a.key}: +${(await x.me()).balance - b}`);
  }
  // goals / quests
  const g = await x.call('goals');
  note(`goals: ${JSON.stringify(g).slice(0, 200)}`);
  const qs = await x.call('quests');
  for (const qq of qs?.list || []) {
    if (qq.progress >= qq.target && !qq.claimed) {
      const [r1, r2] = await Promise.all([x.burst('quests/claim', { key: qq.key }), x.burst('quests/claim', { key: qq.key })]);
      if ([r1, r2].filter((r) => r.status === 200).length > 1) bad('quest claimed twice');
    }
  }
  // season pass
  const se = await x.call('season');
  note(`season: lvl ${se?.level} ready ${se?.ready} premium ${se?.premium}`);
  // rewards/all, reward case (not ready)
  const ra = await x.try('rewards/all');
  note(`rewards/all → ${ra.status} ${ra.body?.error || JSON.stringify(ra.body).slice(0, 150)}`);
  const rc = await x.try('rewards/case');
  note(`rewards/case → ${rc.status} ${rc.body?.error || ''}`);
  // shop: buy with stars (none) → refused, no state change
  const sh = await x.try('shop/stars', { item: 'vip' });
  if (sh.status === 200) bad('shop/stars bought VIP with 0 stars');
  // garage slots buy up to max with money
  const sl = (await x.me()).slots;
  const r = await x.try('buy-slot');
  note(`buy-slot from ${sl}: ${r.status} ${r.body?.error || ''}`);
  // showcase put/take
  const m3 = await x.me();
  const c = m3.cars[0];
  if (c && m3.cars.length > 1) {
    await x.call('showcase', { carId: c.id, put: true });
    const sold = await x.try('sell', { carIds: [c.id] });
    note(`sell a showcase car → ${sold.status} ${sold.body?.error || ''}`);
  }
  // promo junk
  const pr = await x.try('promo', { code: 'NOPE-' + BASE });
  if (pr.status === 200) bad('unknown promo accepted');
  // style/frames
  const fr = await x.call('frames');
  note(`frames: ${fr?.list?.length} equipped ${fr?.equipped}`);
  const fe = await x.try('frames/equip', { id: 'legend_s1' });
  if (fe.status === 200) bad('equipped legend_s1 without owning it');
  const fh = await x.try('frames/helmet', { helmet: 9999 });
  if (fh.status === 200) bad('helmet 9999 accepted');
  // VIP via admin, then daily with VIP extra
  await admin('grant-premium', { id: x.id, what: 'vip', days: 3 });
  const mv = await x.me();
  if (!mv.vip) bad('VIP not active after admin grant');
  note(`vip until ${new Date(mv.vipUntil).toISOString()}`);
};


// Writes straight into the server's database (payments and VIP subscriptions have no DEV API: they come from Telegram).
async function dbExec(sql, ...args) {
  if (!process.env.QA_DB) return bad('QA_DB not set: can\'t seed payments'), null;
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(process.env.QA_DB);
  d.exec('PRAGMA busy_timeout = 5000');
  try {
    return d.prepare(sql).run(...args);
  } finally {
    d.close();
  }
}
async function dbAll(sql, ...args) {
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(process.env.QA_DB);
  d.exec('PRAGMA busy_timeout = 5000');
  try {
    return d.prepare(sql).all(...args);
  } finally {
    d.close();
  }
}
async function levelUp(p, to) {
  let m = await p.me();
  let need = 0;
  for (let l = m.level; l < to; l++) need += S.xpForLevel(l);
  await admin('set', { id: p.id, field: 'xp', value: need - m.xp + m.xp + 1 });
  await p.call('rewards/daily'); // any XP gain runs the level-up loop
  m = await p.me();
  if (m.level < to) bad(`levelUp: ${p.name} stuck at ${m.level} (want ${to})`);
}

phases.s2 = async () => {
  console.log('\n== Season 2 reset on a populated DB');
  const st0 = await admin('season2', {});
  if (st0?.done) return note('season 2 already done on this DB — skip');
  // A patron with a VIP subscription, 3 friends at level 3 (one more below 3), a club, businesses and a few cars.
  const pat = (P.pat = await veteran(BASE + 20, 'Меценат', { level: 21, money: 30e6, cars: ['hummer-h2', 'toyota-gr-yaris'] }));
  await dbExec("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES (?, ?, 'item:vip', 300, 0, ?)", 'qa-' + BASE + '-1', pat.id, Date.now());
  await dbExec("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES (?, ?, 'item:vipsub', 499, 0, ?)", 'qa-' + BASE + '-2', pat.id, Date.now());
  await dbExec("INSERT INTO payments (charge_id, user_id, pack, stars, amount, created_at) VALUES (?, ?, 'refund:vip', 300, 0, ?)", 'qa-' + BASE + '-3', pat.id, Date.now());
  await dbExec('INSERT OR REPLACE INTO vip_subs (user_id, charge_id, last_charge, stars, started_at, renewed_at, expires_at, renewals, canceled) VALUES (?, ?, ?, 499, ?, NULL, ?, 0, 0)',
    pat.id, 'qa-' + BASE + '-2', 'qa-' + BASE + '-2', Date.now(), Date.now() + 20 * 86400e3);
  await admin('grant-premium', { id: pat.id, what: 'vip', days: 14 });
  const friends = [];
  for (let i = 0; i < 4; i++) {
    const f = player(BASE + 30 + i, 'Друг' + i, { start_param: 'ref_' + pat.id });
    await f.me();
    await f.call('intro/seen');
    await f.call('case/open', { caseId: 'starter', count: 1 });
    if (i < 3) await levelUp(f, 3);
    friends.push(f);
  }
  const C = (await import('../public/clubs.js')).CLUB;
  const tag = 'S' + String(BASE).slice(-3);
  await pat.call('club/create', { tag, name: 'Сезонний ' + tag.slice(1) });
  const cl = await pat.call('club');
  const cid = cl?.club?.id;
  await friends[0].call('club/join', { id: cid });
  await friends[0].call('club/donate', { amount: C.donateMin });
  await pat.call('biz/buy', { id: 'wash' });
  await pat.call('frames/helmet', { helmet: 3 });
  // live items that hold escrow / money
  const mp = await pat.me();
  const g = cheapest(mp.cars)[0];
  await pat.call('market/sell', { carId: g.id, price: 10000 });
  const t = P.t || (P.t = await veteran(BASE + 4, 'Тарас', { level: 8, money: 20e6 }));
  const bt = await t.call('battle/create', { caseId: 'rust', count: 1 });
  const pv = await t.call('pvp/create', { carId: (await t.me()).cars[0].id, bet: S.PVP_MIN_BET });
  const before = {
    pat: await pat.me(), ref: (await dbAll('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND ref_paid = 1', pat.id))[0].n,
    payments: (await dbAll('SELECT COUNT(*) n FROM payments'))[0].n, users: (await dbAll('SELECT COUNT(*) n FROM users'))[0].n,
  };
  note(`before: patron lvl ${before.pat.level} bal ${before.pat.balance} vip ${before.pat.vip} friends L3 ${before.ref}`);
  // dry run, then wrong phrase, then the real thing; a second run must fail.
  const dry = await admin('season2/reset', { dryRun: true });
  note(`dry run: users ${dry?.users} credit ${JSON.stringify(dry?.credit)} friendKeys ${JSON.stringify(dry?.friendKeys)}`);
  const wrong = await raw('/api/admin/season2/reset', { confirm: true, reason: 'qa', phrase: 'сезон 3' });
  if (wrong.status === 200) bad('season reset ran with a wrong phrase');
  const [r1, r2] = await Promise.all([raw('/api/admin/season2/reset', { confirm: true, reason: 'qa', phrase: 'сезон 2' }), raw('/api/admin/season2/reset', { confirm: true, reason: 'qa', phrase: 'СЕЗОН 2' })]);
  eq('season reset ran exactly once', [r1, r2].filter((r) => r.status === 200).length, 1);
  const after = await pat.me();
  eq('patron balance = start', after.balance, S.START_BALANCE);
  eq('patron level 1', after.level, 1);
  eq('patron cars', after.cars.length, 0);
  eq('patron starter key', after.keys.starter, 1);
  eq('patron city keys = friends', after.keys.city || 0, Math.min(3, S.S2_RESET.friendKeysMax));
  eq('patron star credit = stars spent (no refunds)', after.starCredit, 799);
  if (after.vip) bad('VIP days carried over after the reset (owner said credit only)');
  if (!after.frames?.includes('patron')) bad('patron frame missing', after.frames);
  if (!after.frames?.includes('veteran_s1')) bad('veteran frame missing', after.frames);
  if (after.frame !== 'patron' && after.frame !== 'legend_s1') bad('worn frame after reset', after.frame);
  if (after.helmet !== 3) bad('helmet not kept', after.helmet);
  if (!after.badges?.some((b) => b.key === 'veteran_s1')) bad('veteran badge missing', after.badges);
  if (!after.s2Welcome) bad('no welcome window after reset');
  else note(`welcome: ${JSON.stringify(after.s2Welcome)}`);
  // kept: payments, users, referrals, club membership
  eq('payments kept', (await dbAll('SELECT COUNT(*) n FROM payments'))[0].n, before.payments);
  eq('users kept', (await dbAll('SELECT COUNT(*) n FROM users'))[0].n, before.users);
  eq('referrals kept', (await dbAll('SELECT COUNT(*) n FROM users WHERE referrer_id = ? AND ref_paid = 1', pat.id))[0].n, before.ref);
  const cl2 = await pat.call('club');
  if (!cl2?.club) bad('club lost after reset');
  else {
    eq('club treasury zeroed', cl2.club.treasury ?? 0, 0);
    eq('club members kept', cl2.club.members?.length, 2);
  }
  // businesses: a Season 1 business must not survive the wipe
  const bz = await pat.call('biz');
  const owned = bz?.list?.filter((b) => b.owned).map((b) => b.id) || [];
  if (owned.length) bad('businesses survived the Season 2 wipe: ' + owned.join(','));
  // market / battles / pvp gone, Тарас's escrow? (money reset anyway)
  const ml = await t.call('market/list', {});
  if (ml?.list?.some((l) => !l.dealer)) bad('player listings survived the wipe');
  if (!ml?.list?.some((l) => l.dealer)) bad('dealer market empty right after the wipe');
  const bl = await t.call('battle/list');
  if (bl?.open?.length) bad('open battles survived the wipe');
  // friends: level 1, no compensation keys (they invited nobody), veteran? friend at level 3 → bronze
  const fm = await friends[0].me();
  eq('friend balance', fm.balance, S.START_BALANCE);
  if (!fm.badges?.some((b) => b.key === 'veteran_s1')) bad('L3 friend has no bronze veteran badge');
  const fm3 = await friends[3].me();
  if (fm3.badges?.some((b) => b.key === 'veteran_s1')) bad('friend below L3 got the veteran badge');
  // VIP subscription row: still "active" in the shop while VIP is off?
  const sh = await pat.call('shop');
  note(`after reset: shop.sub ${JSON.stringify(sh?.sub)} vip ${after.vip} starCredit ${sh?.starCredit}`);
  // Owner 3.11: the subscription's Stars become credit, its days are not carried; the Telegram subscription itself runs on.
  if (sh?.sub?.active && !after.vip) note('after reset: «Підписка діє» in the shop while VIP is off (by the owner\'s rule; confusing UI)');
  // star credit: buy VIP 14 days with credit, double tap
  const price = (await pat.call('shop/credit', { item: 'vip' }))?.price;
  const [c1, c2] = await Promise.all([pat.burst('shop/credit', { item: 'vip', confirm: true }), pat.burst('shop/credit', { item: 'vip', confirm: true })]);
  const okN = [c1, c2].filter((x) => x.status === 200).length;
  const after2 = await pat.me();
  eq('credit spent', after2.starCredit, 799 - price * okN);
  if (after2.starCredit < 0) bad('negative star credit');
  note(`credit: vip price ${price}, bought ${okN}×, left ${after2.starCredit}, vip ${after2.vip}`);
  const vs = await pat.try('shop/credit', { item: 'vipsub', confirm: true });
  note(`credit vipsub → ${vs.status} ${vs.body?.error || ''}`);
  await pat.call('s2/welcome-seen');
  if ((await pat.me()).s2Welcome) bad('welcome still shown after s2/welcome-seen');
  // new season play: starter case works again
  const so = await pat.call('case/open', { caseId: 'starter', count: 1 });
  if (!so?.results?.length) bad('starter case after reset gave nothing');
  const so2 = await pat.call('case/open', { caseId: 'city', count: 3, keyOnly: true });
  if (!so2) bad('friend keys can\'t be opened');
};


phases.conc = async () => {
  console.log('\n== concurrency: double taps');
  const c = (P.c = await veteran(BASE + 40, 'Дабл', { level: 10, money: 1, cars: ['fiat-uno', 'daewoo-matiz', 'zaz-sens'] }));
  // exactly enough money for ONE rust case, tap ×5 in parallel
  let m = await c.me();
  await admin('money', { id: c.id, amount: S.CASE_BY_ID.rust.price - m.balance });
  m = await c.me();
  const n0 = m.cars.length;
  const rs = await Promise.all(Array.from({ length: 5 }, () => c.burst('case/open', { caseId: 'rust', count: 1 })));
  m = await c.me();
  eq('one case paid of 5 taps', rs.filter((r) => r.status === 200).length, 1);
  eq('balance after taps', m.balance, 0);
  eq('cars after taps', m.cars.length, n0 + 1);
  if (m.balance < 0) bad('negative balance', m.balance);
  // sell the same car ×4 at once
  const car = cheapest(m.cars)[0];
  const ss = await Promise.all(Array.from({ length: 4 }, () => c.burst('sell', { carIds: [car.id] })));
  eq('car sold once', ss.filter((r) => r.status === 200).length, 1);
  eq('balance = one sale', (await c.me()).balance, ss.find((r) => r.status === 200)?.body.got);
  // list the same car on market + auction + trade room at once
  m = await c.me();
  const car2 = m.cars[0];
  const x = await Promise.all([c.burst('market/sell', { carId: car2.id, price: 5000 }), c.burst('auction/create', { carId: car2.id, startPrice: 5000, hours: 1 }), c.burst('pvp/create', { carId: car2.id, bet: S.PVP_MIN_BET })]);
  const listed = x.slice(0, 2).filter((r) => r.status === 200).length;
  eq('car on market OR auction, not both', listed, 1);
  // daily, newbie, collect ×4
  await sleep(10500);
  for (const name of ['rewards/daily', 'collect', 'newbie/claim', 'rewards/all', 'streak/claim', 'weekly/chest']) {
    const rr = await Promise.all(Array.from({ length: 4 }, () => c.burst(name, name === 'weekly/chest' ? { days: 1 } : {})));
    const ok = rr.filter((r) => r.status === 200).length;
    // newbie: two ready steps in a row are two claims
    if (ok > 1 && name !== 'newbie/claim') bad(`${name}: ${ok} of 4 parallel taps paid`);
    note(`${name} ×4 → ${ok} ok`);
  }
  // dealer: more parallel buys than the per-player limit
  await admin('money', { id: c.id, amount: 1e9 });
  const ml = await c.call('market/list', {});
  const dl = ml.list.filter((l) => l.dealer).slice(0, S.DEALER.perPlayer + 2);
  const db = await Promise.all(dl.map((l) => c.burst('market/buy', { id: l.id })));
  const okD = db.filter((r) => r.status === 200).length;
  if (okD > S.DEALER.perPlayer) bad(`dealer: ${okD} bought, limit ${S.DEALER.perPlayer}`);
  note(`dealer parallel: ${okD}/${dl.length} (limit ${S.DEALER.perPlayer})`);
  // admin money negative can't go below zero
  await admin('money', { id: c.id, amount: -1e13 });
  eq('admin −1e13 floors at 0', (await c.me()).balance, 0);
  // garage: 1 free slot, ×1 open twice in parallel
  await admin('money', { id: c.id, amount: 1e8 });
  m = await c.me();
  await sleep(10500); // rate limit window
  const inGarage = (cars) => cars.filter((q) => q.status !== 'showcase').length; // market / auction lots take a place too
  await admin('set', { id: c.id, field: 'slots', value: inGarage(m.cars) + 1 });
  const g2 = await Promise.all([1, 2, 3].map(() => c.burst('case/open', { caseId: 'rust', count: 1 })));
  m = await c.me();
  eq('one slot → one car', g2.filter((r) => r.status === 200).length, 1);
  if (!g2.some((r) => r.status === 200)) note('slot opens: ' + g2.map((r) => r.body?.error).join(' | '));
  if (inGarage(m.cars) > m.slots) bad('garage over its slots after parallel opens');
  P.persist = { id: c.id, balance: m.balance, cars: m.cars.map((q) => q.id).sort((a, b) => a - b) };
  console.log('PERSIST ' + JSON.stringify(P.persist));
};

// Run after a server restart with QA_PERSIST='<json printed by conc>'.
phases.persist = async () => {
  if (!process.env.QA_PERSIST) return;
  console.log('\n== persistence after restart');
  const want = JSON.parse(process.env.QA_PERSIST);
  const p = player(want.id, 'Дабл');
  const m = await p.me();
  eq('balance kept over restart', m.balance, want.balance);
  eq('cars kept over restart', JSON.stringify(m.cars.map((q) => q.id).sort((a, b) => a - b)), JSON.stringify(want.cars));
};

const only = process.argv.slice(2);
for (const [k, fn] of Object.entries(phases)) {
  if (only.length && !only.includes(k)) continue;
  try {
    await fn();
  } catch (e) {
    bad(`phase ${k} crashed: ${e.stack}`);
  }
}
console.log('\n== PROBLEMS (' + problems.length + ')');
for (const p of problems) console.log(' - ' + p);
process.exitCode = problems.length ? 1 : 0;
