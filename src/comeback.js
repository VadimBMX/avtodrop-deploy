// r15 «Ми вас почули» (owner 13.11): a one-time comeback pack for every Season 1 player, by his S1 wealth at the wipe
// (rules: S.S1_COMEBACK in public/shared.js; admin block: public/admin-season2.js; gift window: public/app.js showGift).
//
// Own table s1_comeback (IF NOT EXISTS) — one row per player, ever (PRIMARY KEY user_id): what he was granted (tier,
// wealth, money, keys, premium keys), when, when he took it, when the bot message was queued.
//   • admin 'season2/comeback' (owner only, ADMIN_MUTATING: confirm) — grants a row to every archived player that has
//     none yet (s1_archive JOIN users; not banned at the wipe nor now; S1 level ≥ minLevel), one «s1comeback» gift
//     window and one event line each, then queues ONE bot message per new row (opts.broadcast: the shared, rate-limited
//     send queue; blocked chats are skipped there, players who turned the bot off with /stop are not messaged).
//     Running it again grants only players who have no row yet — nobody twice; a later change of the tier table can't
//     pay anyone again either (the row is the guard, not the tier).
//   • API 'comeback/s1' (the player taps «Забрати» in the gift window) — pays the row once (claimed_at IS NULL guard):
//     money through addMoney (money_src 'comeback/s1', metrics group «Ми вас почули»), keys through addKeys, and marks
//     the gift window seen. Until then nothing has been created — a player who never comes back costs nothing.
import * as S from '../public/shared.js';

const C = S.S1_COMEBACK;
const SCHEMA = `CREATE TABLE IF NOT EXISTS s1_comeback (user_id INTEGER PRIMARY KEY, tier INTEGER NOT NULL, wealth INTEGER NOT NULL,
  money INTEGER NOT NULL, keys INTEGER NOT NULL, premium INTEGER NOT NULL DEFAULT 0, granted_at INTEGER NOT NULL, granted_by TEXT,
  claimed_at INTEGER, notified_at INTEGER);`;
export const GIFT_KIND = 's1comeback';

export function createComeback(ctx) {
  const { db, q, now, fail, alog, actorRole, addMoney, addKeys, gift, broadcast, s2Done, name } = ctx;
  db.exec(SCHEMA);
  const hasArchive = () => !!q("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 's1_archive'").get();

  // Everyone who would get a pack now (no row yet), with his tier.
  function candidates() {
    if (!hasArchive()) return [];
    return q(`SELECT a.user_id, a.level, a.balance, a.garage_value FROM s1_archive a JOIN users u ON u.id = a.user_id
      WHERE a.banned = 0 AND u.banned = 0 AND a.level >= ? AND a.user_id NOT IN (SELECT user_id FROM s1_comeback) ORDER BY a.user_id`).all(C.minLevel)
      .map((r) => {
        const wealth = Math.max(0, (r.balance || 0) + (r.garage_value || 0));
        return { id: r.user_id, wealth, tier: S.s1ComebackTier(wealth) };
      });
  }
  function tally(rows) {
    const tiers = C.tiers.map((t) => ({ ...t, users: 0 }));
    for (const r of rows) tiers.find((t) => t.tier === r.tier.tier).users++;
    const sum = (f) => tiers.reduce((a, t) => a + t.users * f(t), 0);
    return { tiers, users: rows.length, money: sum((t) => t.money), keys: sum((t) => t.keys), premium: sum((t) => t.premium) };
  }
  // The admin block: the preview of what a run would give now, and what was given / taken so far.
  function status() {
    const g = q(`SELECT COUNT(*) users, COALESCE(SUM(money), 0) money, COALESCE(SUM(keys), 0) keys, COALESCE(SUM(premium), 0) premium,
      COALESCE(SUM(claimed_at IS NOT NULL), 0) claimed, COALESCE(SUM(CASE WHEN claimed_at IS NOT NULL THEN money END), 0) claimedMoney,
      COALESCE(SUM(notified_at IS NOT NULL), 0) notified, MIN(granted_at) firstAt, MAX(granted_at) lastAt FROM s1_comeback`).get();
    const byTier = Object.fromEntries(q('SELECT tier, COUNT(*) n, COALESCE(SUM(claimed_at IS NOT NULL), 0) c FROM s1_comeback GROUP BY tier').all().map((r) => [r.tier, { users: r.n, claimed: r.c }]));
    return {
      rules: { title: C.title, keyCase: C.keyCase, premiumCase: C.premiumCase, minLevel: C.minLevel, tiers: C.tiers },
      wiped: !!s2Done(), archived: hasArchive() ? q('SELECT COUNT(*) n FROM s1_archive').get().n : 0,
      preview: tally(candidates()), granted: { ...g, byTier }, done: g.users > 0,
    };
  }
  const botText = (t) => `🧡 Ми вас почули. Тебе чекає компенсація за Сезон ${S.S2_RESET.prevSeason}: ${S.s1ComebackText(t)}. Заходь забрати — @avtodrop2026_bot`;

  function grant(who) {
    if (actorRole(who) !== 'owner') fail('Видати «Ми вас почули» може лише власник');
    if (!s2Done()) fail(`Сезон ${S.S2_RESET.season} ще не запущено — архіву Сезону ${S.S2_RESET.prevSeason} немає`);
    const rows = candidates();
    const t = now();
    const ins = q('INSERT OR IGNORE INTO s1_comeback (user_id, tier, wealth, money, keys, premium, granted_at, granted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const given = [];
    for (const r of rows) {
      const tr = r.tier;
      if (!ins.run(r.id, tr.tier, r.wealth, tr.money, tr.keys, tr.premium, t, String(who)).changes) continue;
      const text = `Компенсація за Сезон ${S.S2_RESET.prevSeason}: ${S.s1ComebackText(tr)}`;
      gift(r.id, GIFT_KIND, { tier: tr.tier, money: tr.money, keys: tr.keys, caseId: C.keyCase, premium: tr.premium, premiumCase: C.premiumCase, season: S.S2_RESET.prevSeason }, null);
      q('INSERT INTO events (user_id, text, created_at) VALUES (?, ?, ?)').run(r.id, `🧡 ${C.title}. ${text} — забери у вікні подарунка.`, t);
      given.push({ id: r.id, tier: tr });
    }
    // One bot message per new row, through the shared send queue (normal priority, paced; blocked chats skipped there).
    const quiet = new Set(given.length ? q('SELECT id FROM users WHERE push_off = 1 OR push_blocked = 1').all().map((x) => x.id) : []);
    const send = given.filter((g) => !quiet.has(g.id));
    const mark = q('UPDATE s1_comeback SET notified_at = ? WHERE user_id = ? AND notified_at IS NULL');
    const byText = new Map();
    for (const g of send) {
      if (!mark.run(t, g.id).changes) continue;
      const txt = botText(g.tier);
      byText.set(txt, [...(byText.get(txt) || []), g.id]);
    }
    for (const [txt, ids] of byText) {
      try {
        broadcast?.(ids, txt, { play: '🧡 Забрати компенсацію' });
      } catch {}
    }
    const out = tally(given.map((g) => ({ tier: g.tier })));
    alog(who, 's1-comeback', null, { users: out.users, money: out.money, keys: out.keys, premium: out.premium, messages: send.length,
      tiers: Object.fromEntries(out.tiers.map((x) => [x.tier, x.users])) });
    return { ...status(), result: { ...out, messages: send.length, at: t } };
  }

  // The player takes it: once (claimed_at guard), then the window is seen.
  function claim(uid) {
    const r = q('SELECT * FROM s1_comeback WHERE user_id = ?').get(uid);
    if (!r) fail('Компенсації для тебе немає');
    const seen = () => q('UPDATE gifts SET shown = 1 WHERE user_id = ? AND kind = ? AND shown = 0').run(uid, GIFT_KIND);
    if (r.claimed_at || !q('UPDATE s1_comeback SET claimed_at = ? WHERE user_id = ? AND claimed_at IS NULL').run(now(), uid).changes) {
      seen();
      return { already: true, money: 0, keys: [] };
    }
    addMoney(uid, r.money);
    const keys = [{ caseId: C.keyCase, count: r.keys }];
    addKeys(uid, C.keyCase, r.keys);
    if (r.premium > 0) (addKeys(uid, C.premiumCase, r.premium), keys.push({ caseId: C.premiumCase, count: r.premium }));
    seen();
    alog('system', 's1-comeback-claim', uid, { tier: r.tier, money: r.money, keys: r.keys, premium: r.premium, name: name(uid) });
    return { already: false, money: r.money, keys, tier: r.tier };
  }

  return {
    api: { 'comeback/s1': (uid) => claim(uid) },
    admin: { 'season2/comeback': grant },
    mutating: ['season2/comeback'],
    status, candidates, claim, grant,
  };
}
