// «Мої бізнеси» on the server (rules and numbers: public/business.js; the app: public/business-ui.js). Own table
// (IF NOT EXISTS): user_business — one row per owned business: building level, the three branch steps, the box
// (banked ₴ + cash_at: the box is banked + rate × hours since cash_at, at most the cap — computed lazily, no cron),
// manager_until (Stars «Менеджер»), bought_at.
// Money: buy / upgrades through pay(), «Зібрати» through addMoney() — the API wrapper in game.js labels them as
// 'biz/buy', 'biz/upgrade', 'biz/collect' in money_src; the manager's auto-collect as 'biz/manager' (srcWrap).
// Every call that can change the rate or the cap (an upgrade, a VIP purchase, the manager) banks the box first, so
// the time a full box stood still never turns into money afterwards.
import * as B from '../public/business.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS user_business (uid INTEGER NOT NULL, biz_id TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1,
  eq INTEGER NOT NULL DEFAULT 0, staff INTEGER NOT NULL DEFAULT 0, ads INTEGER NOT NULL DEFAULT 0,
  banked INTEGER NOT NULL DEFAULT 0, cash_at INTEGER NOT NULL, manager_until INTEGER NOT NULL DEFAULT 0, bought_at INTEGER NOT NULL,
  PRIMARY KEY (uid, biz_id)) WITHOUT ROWID;`;
const H = 3600e3;

export function createBusiness(ctx) {
  const { db, q, now, fail, addMoney, pay, userRow, vipOf, srcWrap } = ctx;
  db.exec(SCHEMA);
  const managerPay = srcWrap('biz/manager', addMoney);

  // Clubs holding a city district give their members +B.BIZ.districtBonus income.
  // TODO(districts): return B.BIZ.districtBonus when the player's club holds a district (clubs/districts come later).
  // eslint-disable-next-line no-unused-vars
  const districtBonus = (uid) => 0;

  const ORDER = Object.fromEntries(B.BIZ.list.map((b, i) => [b.id, i]));
  const rows = (uid) => q('SELECT * FROM user_business WHERE uid = ?').all(uid).sort((a, b) => (ORDER[a.biz_id] ?? 99) - (ORDER[b.biz_id] ?? 99));
  const rowOf = (uid, id) => q('SELECT * FROM user_business WHERE uid = ? AND biz_id = ?').get(uid, id) || null;
  const owns = (uid, id) => !!q('SELECT 1 FROM user_business WHERE uid = ? AND biz_id = ?').get(uid, id);
  const shape = (r) => ({ id: r.biz_id, level: r.level, eq: r.eq, staff: r.staff, ads: r.ads });
  function bizId(v) {
    const id = String(v ?? '');
    if (!Object.hasOwn(B.BIZ_BY_ID, id)) fail('Невідомий бізнес');
    return id;
  }

  // Rate, cap and box of one row at t.
  function stateOf(r, vip, t, district) {
    const row = shape(r);
    const rate = B.rateOf(row, district), capH = B.capHoursOf(row, vip);
    const cap = Math.floor(rate * capH);
    const mgr = r.manager_until > t;
    const box = B.boxAt({ banked: r.banked, cashAt: r.cash_at, rate, capH, managerUntil: r.manager_until }, t);
    const full = !mgr && box >= cap;
    const fullAt = mgr || full || !rate ? 0 : Math.ceil(r.cash_at + ((cap - r.banked) / rate) * H);
    return { row, rate, capH, cap, box, full, fullAt, mgr };
  }
  // A working manager takes everything earned up to now (or up to his last day) to the balance, uncapped.
  function settle(uid) {
    const t = now();
    const list = rows(uid);
    if (!list.some((r) => r.manager_until > r.cash_at)) return list;
    const district = districtBonus(uid);
    let got = 0;
    for (const r of list) {
      if (!(r.manager_until > r.cash_at)) continue;
      const e = Math.min(t, r.manager_until);
      const amt = Math.floor(r.banked + (B.rateOf(shape(r), district) * (e - r.cash_at)) / H);
      q('UPDATE user_business SET banked = 0, cash_at = ? WHERE uid = ? AND biz_id = ?').run(e, uid, r.biz_id);
      got += amt;
    }
    if (got > 0) managerPay(uid, got);
    return rows(uid);
  }
  // Freeze what is in the box now (before the rate or the cap changes).
  function bank(uid, r, vip = vipOf(uid)) {
    const t = now();
    const s = stateOf(r, vip, t, districtBonus(uid));
    q('UPDATE user_business SET banked = ?, cash_at = ? WHERE uid = ? AND biz_id = ?').run(s.box, t, uid, r.biz_id);
  }
  const bankAll = (uid) => {
    const vip = vipOf(uid);
    for (const r of settle(uid)) bank(uid, r, vip);
  };

  // The full page: every business (owned or not), what it earns and holds, what the next steps cost.
  function list(uid) {
    const u = userRow(uid), t = now(), vip = vipOf(uid), district = districtBonus(uid);
    const own = new Map(settle(uid).map((r) => [r.biz_id, r]));
    let totalRate = 0, totalBox = 0;
    const out = B.BIZ.list.map((b) => {
      const r = own.get(b.id);
      const base = { id: b.id, name: b.name, level: b.level, price: b.price, income: b.income, perk: B.PERK_TEXT[b.id] };
      if (!r) return { ...base, owned: false, unlocked: (u.level || 1) >= b.level, canBuy: (u.level || 1) >= b.level && u.balance >= b.price };
      const s = stateOf(r, vip, t, district);
      totalRate += s.rate;
      totalBox += s.box;
      const next = Object.fromEntries(B.BRANCH_KEYS.map((k) => [k, B.stepCost(b.id, k, r[k])]));
      return { ...base, owned: true, lvl: r.level, eq: r.eq, staff: r.staff, ads: r.ads, rate: s.rate, capH: s.capH, cap: s.cap, box: s.box, full: s.full, fullAt: s.fullAt,
        manager: s.mgr ? r.manager_until : 0, next, build: { cost: B.buildCost(b.id, r.level), ready: B.buildReady(shape(r)), need: r.level < B.BIZ_MAX_LVL ? B.BIZ.build[r.level].need : null },
        boughtAt: r.bought_at };
    });
    return { list: out, totalRate, totalBox, district, vip, now: t, mgrStars: B.BIZ.manager.stars, mgrDays: B.BIZ.manager.days };
  }

  function buy(uid, { id }) {
    const bid = bizId(id), b = B.BIZ_BY_ID[bid], u = userRow(uid);
    if ((u.level || 1) < b.level) fail(`${b.name} відкривається з ${b.level}-го рівня`);
    if (owns(uid, bid)) fail('Цей бізнес уже твій');
    pay(uid, b.price);
    const t = now();
    q('INSERT INTO user_business (uid, biz_id, cash_at, bought_at) VALUES (?, ?, ?, ?)').run(uid, bid, t, t);
    return { id: bid, paid: b.price, biz: list(uid) };
  }

  function upgrade(uid, { id, branch }) {
    const bid = bizId(id);
    const r = settle(uid).find((x) => x.biz_id === bid);
    if (!r) fail('Спершу купи цей бізнес');
    const br = String(branch ?? '');
    let cost, col;
    if (br === 'build') {
      if (r.level >= B.BIZ_MAX_LVL) fail('Будівля вже максимального рівня');
      if (!B.buildReady(shape(r))) fail(`Рівень ${r.level + 1} — коли всі гілки на ${B.BIZ.build[r.level].need}+`);
      cost = B.buildCost(bid, r.level);
      col = 'level';
    } else if (B.BRANCH_KEYS.includes(br)) {
      cost = B.stepCost(bid, br, r[br]);
      if (cost == null) fail(`«${B.BIZ.branches[br].name}» уже на максимумі`);
      col = br;
    } else fail('Невідома гілка');
    bank(uid, r); // income so far at the old rate and cap
    pay(uid, cost);
    q(`UPDATE user_business SET ${col} = ${col} + 1 WHERE uid = ? AND biz_id = ?`).run(uid, bid);
    return { id: bid, branch: br, paid: cost, biz: list(uid) };
  }

  // «Зібрати» one business ({ id }) or every one ({ all: true }).
  function collect(uid, { id, all }) {
    const t = now(), vip = vipOf(uid), district = districtBonus(uid);
    const pick = all ? null : bizId(id);
    const list0 = settle(uid).filter((r) => !pick || r.biz_id === pick);
    if (pick && !list0.length) fail('Спершу купи цей бізнес');
    let got = 0;
    for (const r of list0) {
      got += stateOf(r, vip, t, district).box;
      q('UPDATE user_business SET banked = 0, cash_at = ? WHERE uid = ? AND biz_id = ?').run(t, uid, r.biz_id);
    }
    if (got > 0) addMoney(uid, got);
    return { got, biz: list(uid) };
  }

  // Compact state for `me`: the home screen's income labels.
  function brief(uid) {
    const t = now(), vip = vipOf(uid), district = districtBonus(uid);
    const list0 = settle(uid);
    if (!list0.length) return { biz: [], bizTotalBox: 0 };
    const biz = list0.map((r) => {
      const s = stateOf(r, vip, t, district);
      return { id: r.biz_id, lvl: r.level, box: s.box, rate: s.rate, cap: s.cap, full: s.full, ...(s.mgr ? { mgr: r.manager_until } : {}) };
    });
    return { biz, bizTotalBox: biz.reduce((a, x) => a + x.box, 0) };
  }

  // ---------- passive perks (only while owned) ----------
  function perks(uid) {
    const has = new Set(q('SELECT biz_id FROM user_business WHERE uid = ?').all(uid).map((r) => r.biz_id));
    const P = B.BIZ.perks;
    return {
      fuelExtra: has.has('gas') ? P.gasTank : 0,
      regenMult: has.has('gas') ? 1 + P.gasRegen : 1,
      shineMult: has.has('wash') ? 1 + P.washShine : 1,
      partsMult: has.has('sto') ? 1 - P.stoParts : 1,
      sellMult: has.has('salon') ? 1 + P.salonSell : 1,
    };
  }

  // ---------- «Менеджер» (Stars item bizmgr-<id>) ----------
  function itemCheck(uid, itemId) {
    const bid = B.bizOfItem(itemId);
    if (bid && !owns(uid, bid)) fail('Менеджера можна найняти лише у свій бізнес');
  }
  function applyManager(uid, itemId) {
    const bid = B.bizOfItem(itemId);
    const r = settle(uid).find((x) => x.biz_id === bid);
    if (!r) return { item: itemId }; // sold in between (can't happen: businesses are never sold) — nothing to extend
    bank(uid, r); // the box so far (capped as it was); from now on he takes it uncapped
    const until = Math.max(r.manager_until, now()) + B.BIZ.manager.days * 86400e3;
    q('UPDATE user_business SET manager_until = ? WHERE uid = ? AND biz_id = ?').run(until, uid, bid);
    return { item: itemId, biz: bid, managerUntil: until };
  }

  return {
    api: { biz: list, 'biz/buy': buy, 'biz/upgrade': upgrade, 'biz/collect': collect },
    brief, perks, owns, bankAll, itemCheck, applyManager, districtBonus,
  };
}
