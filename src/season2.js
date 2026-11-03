// «Сезон 02»: the one-shot season wipe with compensation, profile frames and the star credit (rules: S.S2_RESET,
// S.PROFILE_FRAMES, S.VETERAN_S1 in public/shared.js; the welcome window: public/season2-ui.js; admin: public/admin-season2.js).
//
// The wipe (admin 'season2/reset', owner only, ADMIN_MUTATING + the phrase S.S2_RESET.phrase) runs in ONE transaction:
//   1. settles Season 1's rating if nobody has yet (its prizes and top-100 badges: the places are archived);
//   2. snapshots what the compensation needs into s1_archive (per player: level, season XP and place, garage value,
//      balance, cars, Stars spent, friends brought to level 3, VIP subscription end) — this table is never wiped;
//   3. wipes every player's progress (the list below);
//   4. grants the compensation (star credit, frames, «Ветеран Сезону 1» from S1 level 3, «Міський» keys for friends)
//      and leaves the welcome window pending (s1_archive.welcome_seen = 0). Owner 3.11: a running VIP subscription
//      is NOT carried over as days — its Stars are already in the credit (no double compensation);
//   5. writes the marker meta 'season_reset_s2' — a second run fails, and the transaction makes it all-or-nothing.
//
// What happens to each table (db.js and the modules' own tables):
//   WIPED (all rows): cars (car_parts, rivals with them; car_restyle by its trigger), parts, parts_cool, plates, keys,
//     fragments, collection, pity, races, drift_runs, challenges, challenge_tries, listings, auctions, item_listings,
//     item_sales (Season 1 prices would skew the market medians), trades, trade_items, trade_rooms, trade_room_items,
//     pvp, battles, crash_games, mines_games, quests, weekly_quests, race_streak, goal_days, goal_streak, dealer_buys,
//     boss_runs, dayrace_tries, dayrace_best, tourney_entries, tourney_brackets, tourney_matches, badges (the veteran
//     badge is written back), trophies, buyer_offers, barn_finds, hw_tasks, container_expert, showroom, showroom_likes,
//     club_points, club_day, club_wins, club_goal, club_perks, user_business («Мої бізнеси» bought before the wipe).
//   PARTLY: claims (kept: 'intro', 'story:*', 'guide-off', 'home-screen', 'emoji:*' — seen-once flags, not progress);
//     trade_chat (room chats go, the hall chat stays); gifts (kept, all marked shown — pending windows were about
//     Season 1 things); container_lots (waiting / live lots cancelled — their escrow was Season 1 money; done lots stay
//     as history, marked opened); plate_auctions (an open auction stays, its bids are dropped); clubs (kept, treasury
//     and donations zeroed) and club_members (kept, donated zeroed).
//   users: the account (id, username, first name), referrer and ref_paid, role, ban, lb_hidden, settings (push, no
//     invites, autosell), fairness seeds, deep-link source, idea answers, reset_at (so «Душа компанії» keeps counting
//     friends) stay; money → S.START_BALANCE, slots, showcase, cap, fuel, tank, level, XP, newbie track, unlocks,
//     streaks, counters, season XP and pass, VIP, prize stars, star slots, starter pack, «Стиль», luck, dream car,
//     deals / offers are reset as for a new player, plus one starter key.
//   KEPT untouched: payments, vip_subs, legacy, events, support, ideas, bug_rewards, invite_log, promos, promo_uses,
//     drops, revealed_seeds, rigged_drops, admin_log, car_log (the deleted cars are logged there as 'gone'), user_days,
//     money_days, money_src, funnel, sessions, user_hours, server_log, wealth_snap, meta, weeks, seasons, dayrace_days,
//     tourney_weeks, tourney_prizes, club_weeks, club_claims, club_log, showroom_weeks, barn_lots, container_bids,
//     container_subs, edition_serials, event_plan, plate_auction_bids of finished auctions, tg_group_claims,
//     tg_group_nudge, channel_*, autopromo_log, user_frames, s1_archive, star_credit_log.
import * as S from '../public/shared.js';

const R = S.S2_RESET;
const MARKER = `season_reset_s${R.season}`;
const KEEP_CLAIMS = "key = 'intro' OR key LIKE 'story:%' OR key = 'guide-off' OR key = 'home-screen' OR key LIKE 'emoji:%'";
const WIPE_ALL = ['car_parts', 'rivals', 'cars', 'parts', 'parts_cool', 'plates', 'keys', 'fragments', 'collection', 'pity', 'races', 'drift_runs',
  'challenges', 'challenge_tries', 'listings', 'auctions', 'item_listings', 'item_sales', 'trades', 'trade_items', 'trade_rooms', 'trade_room_items',
  'pvp', 'battles', 'crash_games', 'mines_games', 'quests', 'weekly_quests', 'race_streak', 'goal_days', 'goal_streak', 'dealer_buys', 'boss_runs',
  'dayrace_tries', 'dayrace_best', 'tourney_entries', 'tourney_brackets', 'tourney_matches', 'badges', 'trophies', 'buyer_offers', 'barn_finds',
  'hw_tasks', 'container_expert', 'showroom', 'showroom_likes', 'club_points', 'club_day', 'club_wins', 'club_goal', 'club_perks',
  // s2-sec: «Мої бізнеси» bought between the release and the wipe were paid with Season 1 money (and their boxes hold
  // it): they go too. A «Менеджер» bought with Stars is already in the star credit (payments are counted).
  'user_business'];

export function createSeason2(ctx) {
  const { db, q, now, fail, name, userRow, addMoney, event, alog, itemPrice, applyItem, packAmountFor, settleSeason, weekOf, metaGet, metaSet,
    moneyFlow, actorRole } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS s1_archive (user_id INTEGER PRIMARY KEY, level INTEGER NOT NULL, xp INTEGER NOT NULL, season_xp INTEGER NOT NULL,
      season_place INTEGER, garage_value INTEGER NOT NULL, balance INTEGER NOT NULL, cars INTEGER NOT NULL, stars_spent INTEGER NOT NULL,
      friends_l3 INTEGER NOT NULL, vip_sub_until INTEGER, prize_stars INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0,
      legend INTEGER, veteran INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0, keys INTEGER NOT NULL DEFAULT 0,
      frames TEXT NOT NULL DEFAULT '[]', welcome_seen INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS user_frames (user_id INTEGER NOT NULL, frame TEXT NOT NULL, source TEXT, at INTEGER NOT NULL,
      PRIMARY KEY (user_id, frame)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS star_credit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta INTEGER NOT NULL,
      what TEXT NOT NULL, balance INTEGER NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS star_credit_log_user ON star_credit_log(user_id, id);`);
  const has = (table) => !!q("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  const doneAt = () => Number(metaGet(MARKER)) || 0;

  // ---------- the snapshot (also the dry run's numbers) ----------
  // Stars spent: every real Telegram payment of the player — not refunds, not the first version's imported ones
  // ('legacy:'), not the season-prize stars on the account (those never were payments).
  function snapshot() {
    const t = now();
    const spent = new Map(q(`SELECT user_id, SUM(stars) n FROM payments WHERE stars > 0 AND pack NOT LIKE 'refund:%' AND charge_id NOT LIKE 'legacy:%'
      GROUP BY user_id`).all().map((r) => [r.user_id, r.n]));
    const friends = new Map(q('SELECT referrer_id id, COUNT(*) n FROM users WHERE ref_paid = 1 AND referrer_id IS NOT NULL GROUP BY referrer_id').all().map((r) => [r.id, r.n]));
    const cars = new Map(q('SELECT owner_id id, COUNT(*) n FROM cars GROUP BY owner_id').all().map((r) => [r.id, r.n]));
    const subs = new Map(q('SELECT user_id, expires_at FROM vip_subs WHERE expires_at > ?').all(t).map((r) => [r.user_id, r.expires_at]));
    // The Season 1 rating (the app's main board, «Сезон»: season XP). Settled → its badges hold the official places
    // (top 100); not settled yet → counted the same way the settlement would (banned players out).
    const prev = R.prevSeason;
    const place = new Map();
    const badges = q('SELECT user_id, place FROM badges WHERE key = ? AND place IS NOT NULL').all(`s${prev}`);
    if (badges.length) for (const b of badges) place.set(b.user_id, b.place);
    else {
      q('SELECT id FROM users WHERE season_id = ? AND season_xp > 0 AND banned = 0 AND id > 0 ORDER BY season_xp DESC, id LIMIT ?').all(prev, S.SEASON_BADGE_TOP)
        .forEach((r, i) => place.set(r.id, i + 1));
    }
    // «Легенда S1»: the top of that board, without players an admin hid from the ratings or banned.
    const hidden = new Set(q('SELECT id FROM users WHERE lb_hidden = 1 OR banned = 1').all().map((r) => r.id));
    const legends = [...place.entries()].filter(([id]) => !hidden.has(id)).sort((a, b) => a[1] - b[1]).slice(0, R.legendTop);
    const legendRank = new Map(legends.map(([id], i) => [id, i + 1]));
    const rows = [];
    for (const u of q('SELECT id, level, xp, season_id, season_xp, total_value, balance, stars, banned FROM users WHERE id > 0 ORDER BY id').all()) {
      const starsSpent = spent.get(u.id) || 0, nFriends = friends.get(u.id) || 0;
      const vet = S.veteranTierOf(u.level);
      const legend = legendRank.get(u.id) || null;
      const frames = R.framePriority.filter((f) => (f === 'legend_s1' ? legend : f === 'patron' ? starsSpent >= 1 : f === 'veteran_s1' ? !!vet : false));
      rows.push({
        user_id: u.id, level: u.level, xp: u.xp, season_xp: u.season_id === prev ? u.season_xp : 0, season_place: place.get(u.id) || null,
        garage_value: u.total_value, balance: u.balance, cars: cars.get(u.id) || 0, stars_spent: starsSpent, friends_l3: nFriends,
        vip_sub_until: subs.get(u.id) || null, prize_stars: u.stars, banned: u.banned ? 1 : 0, legend, veteran: vet ? vet.tier : 0,
        credit: Math.floor((starsSpent * R.creditPct) / 100), keys: Math.min(R.friendKeysMax, nFriends), frames,
      });
    }
    return rows;
  }

  function report(rows) {
    const sumBy = (k) => rows.reduce((a, r) => a + r[k], 0);
    const wipe = {};
    for (const t of ['cars', 'plates', 'keys', 'parts', 'listings', 'auctions', 'item_listings', 'battles', 'pvp', 'badges', 'claims', 'showroom']) {
      if (has(t)) wipe[t] = q(`SELECT COUNT(*) n FROM ${t}`).get().n;
    }
    return {
      done: !!doneAt(), at: doneAt() || null, season: R.season, prevSeason: R.prevSeason, phrase: R.phrase,
      users: rows.length, money: sumBy('balance'), garage: sumBy('garage_value'),
      credit: { users: rows.filter((r) => r.credit > 0).length, total: sumBy('credit'), pct: R.creditPct },
      patrons: rows.filter((r) => r.frames.includes('patron')).length,
      veterans: Object.fromEntries(S.VETERAN_S1.tiers.map((t) => [t.tier, rows.filter((r) => r.veteran === t.tier).length])),
      friendKeys: { users: rows.filter((r) => r.keys > 0).length, total: sumBy('keys'), max: R.friendKeysMax },
      vipSubs: rows.filter((r) => r.vip_sub_until).length, // credit only, no VIP days (owner 3.11)
      legends: rows.filter((r) => r.legend).sort((a, b) => a.legend - b.legend)
        .map((r) => ({ rank: r.legend, place: r.season_place, id: r.user_id, name: name(r.user_id), seasonXp: r.season_xp, level: r.level, value: r.garage_value })),
      wipe,
    };
  }

  // ---------- the wipe ----------
  function wipe(t) {
    const before = q('SELECT COALESCE(SUM(balance), 0) n, COUNT(*) c FROM users').get();
    // Lots whose escrow was Season 1 money: cancelled; finished ones stay as history (their car is gone: marked opened).
    if (has('container_lots')) {
      q("UPDATE container_lots SET status = 'cancelled', settled_at = ? WHERE status IN ('waiting', 'live')").run(t);
      q("UPDATE container_lots SET opened = 1 WHERE status = 'done'").run();
    }
    if (has('plate_auctions')) {
      q("DELETE FROM plate_auction_bids WHERE auction_id IN (SELECT id FROM plate_auctions WHERE status = 'open')").run();
      q("UPDATE plate_auctions SET top_bid = NULL, top_bidder = NULL, bids = 0 WHERE status = 'open'").run();
    }
    for (const table of WIPE_ALL) if (has(table)) q(`DELETE FROM ${table}`).run();
    q(`DELETE FROM claims WHERE NOT (${KEEP_CLAIMS})`).run();
    q('DELETE FROM trade_chat WHERE room_id <> 0').run();
    q('UPDATE gifts SET shown = 1 WHERE shown = 0').run();
    if (has('clubs')) {
      q('UPDATE clubs SET treasury = 0, donated = 0, spent = 0').run();
      q('UPDATE club_members SET donated = 0').run();
    }
    q(`UPDATE users SET balance = ?, slots = ?, showcase_slots = ?, cap_level = 0, income_at = ?, banked = 0, fuel = ?, fuel_at = ?,
       level = 1, level_seen = 1, xp = 0, xp_day = NULL, xp_day_capped = 0, xp_case_day = NULL, xp_case_used = 0, newbie_step = 0, newbie_flags = '[]', feats = '[]',
       streak = 0, streak_day = NULL, reward_case_at = 0, total_value = 0, week_id = ?, week_start_value = 0, last_week_id = NULL, last_week_growth = NULL,
       cases_opened = 0, races = 0, wins = 0, merges = 0, season_id = ?, season_xp = 0, premium_season = 0, vip_until = 0, vip_sale_until = 0,
       play_ms = 0, plate_best = 0, luck_spent = 0, luck_got = 0, luck_bonus = 0, luck_bonus_left = 0, bad_streak = 0, rescue_at = 0,
       star_slots = 0, stars = 0, starter_bought = 0, style = '{}', dream_car = NULL, dream_at = 0, comeback_at = 0, comeback_cap_until = 0,
       tank_lvl = 0, sold_day = NULL, sold_full = 0, wash_day = NULL, wash_hand = 0, pack_offer_until = 0, pack_offer_next = 0,
       fuel_deal_until = 0, fuel_deal_next = 0, day_deal_day = '', parts_open_at = 0, frame = NULL, star_credit = 0`)
      .run(S.START_BALANCE, S.START_SLOTS, S.SHOWCASE_START, t, S.FUEL_MAX, t, weekOf(t), S.seasonOf(t));
    q("INSERT INTO keys (user_id, case_id, count) SELECT id, 'starter', 1 FROM users").run();
    moneyFlow(before.c * S.START_BALANCE - before.n);
  }

  // ---------- the compensation ----------
  const grantFrame = (uid, id, source, t = now()) => q('INSERT OR IGNORE INTO user_frames (user_id, frame, source, at) VALUES (?, ?, ?, ?)').run(uid, id, source, t);
  function creditAdd(uid, delta, what) {
    q('UPDATE users SET star_credit = star_credit + ? WHERE id = ?').run(delta, uid);
    const bal = q('SELECT star_credit FROM users WHERE id = ?').get(uid).star_credit;
    q('INSERT INTO star_credit_log (user_id, delta, what, balance, at) VALUES (?, ?, ?, ?, ?)').run(uid, delta, what, bal, now());
    return bal;
  }
  function compensate(r, t) {
    const uid = r.user_id;
    if (r.credit > 0) creditAdd(uid, r.credit, `s${R.prevSeason}-comp`);
    for (const f of r.frames) grantFrame(uid, f, `s${R.prevSeason}-comp`, t);
    if (r.frames.length) q('UPDATE users SET frame = ? WHERE id = ?').run(r.frames[0], uid);
    const vet = S.VETERAN_S1.tiers.find((x) => x.tier === r.veteran);
    if (vet) {
      q('INSERT OR REPLACE INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)')
        .run(uid, S.VETERAN_S1.key, `${S.VETERAN_S1.title} · ${vet.name}`, vet.tier, R.prevSeason, t);
    }
    if (r.keys > 0) q('INSERT INTO keys (user_id, case_id, count) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET count = count + excluded.count').run(uid, R.friendKey, r.keys);
    const parts = [r.credit ? `${r.credit} ⭐ кредиту в магазині` : '', r.keys ? `${r.keys} ${S.CASE_BY_ID[R.friendKey].name.replace(/ий$/, 'их')} ключів` : '', vet ? `значок «${S.VETERAN_S1.title}»` : ''].filter(Boolean);
    q('INSERT INTO events (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, `🏁 Сезон ${R.season} стартував — прогрес обнулено для всіх.${parts.length ? ` Твоя компенсація: ${parts.join(', ')}.` : ''}`, t);
  }

  function run(who, { dryRun = false } = {}) {
    if (doneAt()) fail(`Сезон ${R.season} вже запущено ${new Date(doneAt()).toISOString().slice(0, 16).replace('T', ' ')} UTC — повторно не можна`);
    if (!dryRun) settleSeason(); // Season 1's prizes and top-100 badges first: their places go into the archive
    const rows = snapshot();
    if (dryRun) return { dryRun: true, ...report(rows) };
    const t = now();
    const out = report(rows);
    const ins = q(`INSERT INTO s1_archive (user_id, level, xp, season_xp, season_place, garage_value, balance, cars, stars_spent, friends_l3, vip_sub_until,
      prize_stars, banned, legend, veteran, credit, keys, frames, welcome_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`);
    q('DELETE FROM s1_archive').run(); // never filled before the marker; a clean slate in case of a half-imported copy
    for (const r of rows) {
      ins.run(r.user_id, r.level, r.xp, r.season_xp, r.season_place, r.garage_value, r.balance, r.cars, r.stars_spent, r.friends_l3, r.vip_sub_until,
        r.prize_stars, r.banned, r.legend, r.veteran, r.credit, r.keys, JSON.stringify(r.frames), t);
    }
    wipe(t);
    for (const r of rows) compensate(r, t);
    metaSet(MARKER, t);
    alog(who, 'season2-reset', null, { users: out.users, credit: out.credit, patrons: out.patrons, veterans: out.veterans, friendKeys: out.friendKeys,
      vipSubs: out.vipSubs, legends: out.legends.map((l) => l.id), wipe: out.wipe });
    return { ...out, done: true, at: t };
  }

  // ---------- the look: helmet + frame (S.PROFILE_FRAMES, S.frameAllowed, S.HELMETS) ----------
  // users.helmet: 0…S.HELMETS-1, NULL = the default by id (S.helmetDefault). users.frame: the frame picked; it is shown
  // only while S.frameAllowed says the player may wear it (owned in user_frames, or free by level / VIP / club owner).
  const ownedFrames = (uid) => q('SELECT frame, source, at FROM user_frames WHERE user_id = ? ORDER BY at, frame').all(uid).filter((r) => S.FRAME_BY_ID[r.frame]);
  const inList = (ids) => ids.map(() => '?').join(',');
  function clubOwners(ids) {
    if (!ids.length || !has('clubs')) return new Set();
    return new Set(q(`SELECT owner_id FROM clubs WHERE owner_id IN (${inList(ids)})`).all(...ids).map((r) => r.owner_id));
  }
  // What decides the frames a player may wear: { level, vip, clubOwner, owned }.
  function wearCtx(u, owned, owners, t = now()) {
    return { level: u.level, vip: (u.vip_until || 0) > t, clubOwner: owners.has(u.id), owned };
  }
  // The look of many players at once (rating rows, cards, club members, trade rooms, battles…): { id → { helmet, frame } }.
  function looksOf(ids) {
    const list = [...new Set((ids || []).filter((x) => Number.isSafeInteger(x) && x > 0))];
    const out = {};
    if (!list.length) return out;
    for (let i = 0; i < list.length; i += 400) {
      const part = list.slice(i, i + 400);
      const rows = q(`SELECT id, helmet, frame, level, vip_until FROM users WHERE id IN (${inList(part)})`).all(...part);
      const worn = rows.filter((r) => r.frame && S.FRAME_BY_ID[r.frame]);
      const ownIds = worn.filter((r) => S.FRAME_BY_ID[r.frame].own).map((r) => r.id);
      const owned = new Set(ownIds.length ? q(`SELECT user_id, frame FROM user_frames WHERE user_id IN (${inList(ownIds)})`).all(...ownIds).map((r) => `${r.user_id}:${r.frame}`) : []);
      const owners = clubOwners(worn.filter((r) => S.FRAME_BY_ID[r.frame].club).map((r) => r.id));
      const t = now();
      for (const r of rows) {
        const ok = r.frame && S.FRAME_BY_ID[r.frame] && S.frameAllowed(r.frame, wearCtx(r, owned.has(`${r.id}:${r.frame}`) ? [r.frame] : [], owners, t));
        out[r.id] = { helmet: Number.isInteger(r.helmet) ? r.helmet : S.helmetDefault(r.id), frame: ok ? r.frame : null };
      }
    }
    return out;
  }
  const lookOf = (uid) => looksOf([uid])[uid] || { helmet: S.helmetDefault(uid), frame: null };
  const frameOf = (uid) => lookOf(uid).frame;
  // The worn frame of many players at once: { id → frame } (players without one are left out).
  function framesOf(ids) {
    return Object.fromEntries(Object.entries(looksOf(ids)).filter(([, l]) => l.frame).map(([id, l]) => [id, l.frame]));
  }
  // Puts `helmet` and `frame` on every object (or nested player object via `pick`) that has a player id.
  function lookRows(rows, pick = (r) => r) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    const objs = rows.map(pick).filter((o) => o && typeof o === 'object' && Number.isSafeInteger(o.id) && o.id > 0);
    const L = looksOf(objs.map((o) => o.id));
    for (const o of objs) if (L[o.id]) (o.helmet = L[o.id].helmet, o.frame = L[o.id].frame);
    return rows;
  }
  function framesList(uid) {
    const u = q('SELECT id, level, vip_until FROM users WHERE id = ?').get(uid);
    const own = new Map(ownedFrames(uid).map((r) => [r.frame, r]));
    const ctx = wearCtx(u, [...own.keys()], clubOwners([uid]));
    const look = lookOf(uid);
    return {
      equipped: look.frame, helmet: look.helmet, helmets: S.HELMETS,
      list: S.PROFILE_FRAMES.map((f) => ({ ...f, owned: own.has(f.id), allowed: S.frameAllowed(f.id, ctx), at: own.get(f.id)?.at || null })),
    };
  }
  function frameEquip(uid, { id }) {
    const want = id ? String(id) : '';
    if (want) {
      if (!Object.hasOwn(S.FRAME_BY_ID, want)) fail('Невідома рамка');
      const u = q('SELECT id, level, vip_until FROM users WHERE id = ?').get(uid);
      if (!S.frameAllowed(want, wearCtx(u, ownedFrames(uid).map((r) => r.frame), clubOwners([uid])))) {
        const f = S.FRAME_BY_ID[want];
        fail(f.lvl ? `Рамка «${f.name}» відкривається з ${f.lvl}-го рівня` : f.vip ? 'Рамка VIP — поки діє VIP' : f.club ? 'Ця рамка — для власника автоклубу' : 'Цієї рамки в тебе ще немає');
      }
    }
    q('UPDATE users SET frame = ? WHERE id = ?').run(want || null, uid);
    return framesList(uid);
  }
  function helmetSet(uid, { helmet }) {
    const h = helmet == null || helmet === '' ? NaN : Number(helmet);
    if (!Number.isInteger(h) || h < 0 || h >= S.HELMETS) fail('Невідомий шолом');
    q('UPDATE users SET helmet = ? WHERE id = ?').run(h, uid);
    return framesList(uid);
  }
  const framesOwned = (uid) => ownedFrames(uid).map((r) => r.frame);

  // ---------- the star credit in the shop ----------
  // Same goods as a paid invoice: an item goes through itemPrice (every check: once-only, owned cosmetic, the day deal,
  // the VIP sale price…) and applyItem; a hryvnia pack gives what its invoice would give now (packAmountFor). Without
  // `confirm` it only tells the price and whether the credit covers it (the app then opens a Telegram invoice instead).
  // The VIP subscription bought with credit is its 30 days of VIP, without renewal (there is no Telegram subscription).
  function creditBuy(uid, { item, pack, confirm } = {}) {
    const u = userRow(uid);
    let price, give, what, label;
    if (pack != null && pack !== '') {
      if (!S.PACKS_ON_SALE) fail('Пакети гривень більше не продаються — загляни в «Стиль» і VIP');
      const p = S.PACKS.find((x) => x.id === String(pack));
      if (!p) fail('Невідомий пакет');
      const amount = packAmountFor(uid, p.id);
      [price, what, label] = [p.stars, 'pack:' + p.id, `пакет ${S.short(amount)} ₴`];
      give = () => (addMoney(uid, amount), { amount });
    } else {
      const id = String(item ?? '');
      if (!Object.hasOwn(S.SHOP_BY_ID, id)) fail('Невідомий товар');
      price = itemPrice(uid, id);
      [what, label] = ['item:' + id, S.SHOP_BY_ID[id].name];
      give = () => applyItem(uid, id);
    }
    const enough = u.star_credit >= price;
    if (confirm !== true) return { price, credit: u.star_credit, enough };
    if (!q('UPDATE users SET star_credit = star_credit - ? WHERE id = ? AND star_credit >= ?').run(price, uid, price).changes) fail('Кредиту не вистачає — оплати через Telegram Stars');
    const bal = q('SELECT star_credit FROM users WHERE id = ?').get(uid).star_credit;
    q('INSERT INTO star_credit_log (user_id, delta, what, balance, at) VALUES (?, ?, ?, ?, ?)').run(uid, -price, what, bal, now());
    const out = give();
    event(uid, `⭐ ${label} — оплачено кредитом Сезону ${R.prevSeason} (−${price} ⭐, лишилось ${bal} ⭐)`);
    return { ...out, paid: price, starCredit: bal };
  }

  // ---------- the welcome window ----------
  function welcome(uid) {
    if (!doneAt()) return null;
    const a = q('SELECT * FROM s1_archive WHERE user_id = ?').get(uid);
    if (!a || a.welcome_seen) return null;
    const vet = S.VETERAN_S1.tiers.find((x) => x.tier === a.veteran);
    return {
      season: R.season, credit: a.credit, starsSpent: a.stars_spent, keys: a.keys, caseId: R.friendKey, friends: a.friends_l3,
      frames: JSON.parse(a.frames || '[]'), veteran: vet ? { tier: vet.tier, name: vet.name, title: S.VETERAN_S1.title } : null,
      legend: a.legend, level: a.level, vipSub: !!a.vip_sub_until, // its Stars are in the credit; the VIP days are not carried
    };
  }
  function welcomeSeen(uid) {
    q('UPDATE s1_archive SET welcome_seen = 1 WHERE user_id = ?').run(uid);
    return {};
  }
  const veteranOf = (uid) => {
    const b = q('SELECT tier, title FROM badges WHERE user_id = ? AND key = ?').get(uid, S.VETERAN_S1.key);
    return b ? { tier: b.tier, title: b.title } : null;
  };

  // ---------- admin ----------
  function adminStatus() {
    const st = report(doneAt() ? [] : snapshot());
    if (doneAt()) {
      const a = q(`SELECT COUNT(*) users, COALESCE(SUM(credit), 0) credit, COALESCE(SUM(credit > 0), 0) creditUsers, COALESCE(SUM(keys), 0) keys,
        COALESCE(SUM(welcome_seen), 0) seen FROM s1_archive`).get();
      const left = q('SELECT COALESCE(SUM(star_credit), 0) n FROM users').get().n;
      return { ...st, archive: { ...a, creditLeft: left, creditSpent: a.credit - left },
        legends: q('SELECT user_id, legend, season_place, season_xp, level FROM s1_archive WHERE legend IS NOT NULL ORDER BY legend').all()
          .map((r) => ({ rank: r.legend, place: r.season_place, id: r.user_id, name: name(r.user_id), seasonXp: r.season_xp, level: r.level })) };
    }
    return st;
  }
  function adminReset(who, b) {
    if (actorRole(who) !== 'owner') fail('Запустити новий сезон може лише власник');
    if (b.dryRun === true) return run(who, { dryRun: true });
    if (String(b.phrase ?? '').trim().toUpperCase() !== R.phrase) fail(`Для запуску введи фразу «${R.phrase}»`);
    return run(who);
  }

  return {
    api: {
      frames: (uid) => framesList(uid), 'frames/equip': frameEquip, 'frames/helmet': helmetSet, 'shop/credit': creditBuy, 's2/welcome-seen': welcomeSeen,
    },
    admin: { season2: () => adminStatus(), 'season2/reset': adminReset },
    mutating: ['season2/reset'],
    run, snapshot, welcome, frameOf, framesOf, looksOf, lookOf, lookRows, framesOwned, veteranOf, grantFrame, creditAdd, doneAt,
  };
}
