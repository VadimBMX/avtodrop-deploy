// «🐞 Нагорода за баг» (open beta): the admin rewards a player for a found bug — from a support ticket or the player
// card. The money and keys go through the panel's own give paths (adminMoney / adminGiveKeys, so admin_log gets the
// usual «Гроші» / «Ключі» rows with the reason), plus one «bug-reward» row and a row in bug_rewards. The player gets
// one gift window, an event (and the bot message) «Дякуємо за знайдений баг 🐞 +…», the answer in the ticket, and
// the profile badge «Тестувальник» (1 find) / «Головний тестувальник» (5 finds).
// Roles: the action is in ADMIN_MUTATING + ADMIN_ON_PLAYER (game.js) — the owner needs no reason, an admin does and
// can't reward himself; helpers can't (not in HELPER_ACTIONS) but may look at the list.
import * as S from '../public/shared.js';
import * as B from '../public/bounty.js';

export function createBugBounty({ q, now, fail, int, userRow, brief, adminMoney, adminGiveKeys, alog, event, gift }) {
  const keysText = (keys) => keys.map((k) => `${k.count > 1 ? `${k.count} ключі` : 'ключ'} «${S.CASE_BY_ID[k.caseId]?.name || k.caseId}»`).join(' + ');
  const rewardText = (money, keys) => [money ? S.fmt(money) : '', keysText(keys)].filter(Boolean).join(' + ');
  const countOf = (uid) => q('SELECT COUNT(*) n FROM bug_rewards WHERE user_id = ?').get(uid).n;

  // What to pay: a preset, or a custom amount (+ optional keys of one case).
  function resolve({ preset, amount, caseId, count }) {
    if (Object.hasOwn(B.BUG_PRESETS, String(preset))) {
      const p = B.BUG_PRESETS[preset];
      return { preset, money: p.money, keys: p.keys.map((k) => ({ ...k })) };
    }
    if (preset !== B.BUG_CUSTOM) fail('Обери нагороду');
    const money = amount ? int(amount, 0, B.BUG_CUSTOM_MAX, 'Сума') : 0;
    const n = count ? int(count, 0, B.BUG_KEYS_MAX, 'Кількість ключів') : 0;
    if (n && !S.CASE_BY_ID[caseId]) fail('Невідомий кейс');
    const keys = n ? [{ caseId, count: n }] : [];
    if (!money && !keys.length) fail('Вкажи суму або ключі');
    return { preset: B.BUG_CUSTOM, money, keys };
  }

  function reward(who, { id, ticket, note, ...pick }) {
    const uid = int(id, 1, Number.MAX_SAFE_INTEGER, 'ID');
    userRow(uid);
    let t = null;
    if (ticket != null && ticket !== '') {
      t = q('SELECT * FROM support WHERE id = ?').get(int(ticket, 1, Number.MAX_SAFE_INTEGER, 'Звернення'));
      if (!t) fail('Звернення не знайдено');
      if (t.user_id !== uid) fail('Це звернення іншого гравця');
      if (q('SELECT 1 FROM bug_rewards WHERE ticket_id = ?').get(t.id)) fail('За це звернення нагороду вже видано');
    }
    const r = resolve(pick);
    const what = String(note ?? '').trim().slice(0, 300) || null;
    const label = r.preset === B.BUG_CUSTOM ? 'Своя нагорода' : B.BUG_PRESETS[r.preset].name;
    const logNote = `🐞 Нагорода за баг · ${label}${t ? ` · звернення #${t.id}` : ''}`;
    if (r.money) adminMoney(who, { id: uid, amount: r.money, note: logNote }, { quiet: true });
    for (const k of r.keys) adminGiveKeys(who, { id: uid, caseId: k.caseId, count: k.count }, { quiet: true });
    const rid = Number(q('INSERT INTO bug_rewards (user_id, ticket_id, preset, money, keys, note, admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid, t?.id ?? null, r.preset, r.money, JSON.stringify(r.keys), what, String(who), now()).lastInsertRowid);
    // The badge: set on the first find, raised at 5 (never lowered).
    const n = countOf(uid);
    const b = B.bugBadgeFor(n);
    const had = q("SELECT tier FROM badges WHERE user_id = ? AND key = 'tester'").get(uid)?.tier ?? -1;
    const newBadge = b && b.tier > had ? b.title : null;
    if (newBadge) {
      q(`INSERT INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, 'tester', ?, ?, NULL, NULL, ?)
        ON CONFLICT (user_id, key) DO UPDATE SET title = excluded.title, tier = excluded.tier, created_at = excluded.created_at WHERE excluded.tier > badges.tier`).run(uid, b.title, b.tier, now());
    }
    const thanks = `Дякуємо за знайдений баг 🐞 +${rewardText(r.money, r.keys)}${newBadge ? `. Значок «${newBadge}» тепер у твоєму профілі` : ''}`;
    event(uid, thanks); // the events feed and the bot message
    gift(uid, 'bug', { amount: r.money, keys: r.keys, count: n, badge: newBadge, preset: r.preset }, what ? `Знахідка: ${what}` : null);
    if (t) {
      // The ticket gets the thanks as its answer (or below the answer already given).
      const answer = t.answer ? `${t.answer}\n\n${thanks}` : thanks;
      q('UPDATE support SET answer = ?, answered_at = COALESCE(answered_at, ?), answered_by = COALESCE(answered_by, ?) WHERE id = ?').run(answer, now(), String(who), t.id);
    }
    alog(who, 'bug-reward', uid, { preset: r.preset, money: r.money, keys: r.keys, ticket: t?.id ?? null, note: what, count: n });
    return { id: rid, count: n, badge: newBadge, text: thanks };
  }

  // «Знайдені баги»: every reward, newest first, with a short summary for the owner.
  function list({ offset } = {}) {
    const off = offset ? int(offset, 0, 1e9, 'Зсув') : 0;
    const rows = q(`SELECT b.*, s.text ticket_text FROM bug_rewards b LEFT JOIN support s ON s.id = b.ticket_id ORDER BY b.id DESC LIMIT 100 OFFSET ?`).all(off);
    return {
      list: rows.map((r) => ({ id: r.id, user: brief(r.user_id), at: r.created_at, preset: r.preset, money: r.money, keys: JSON.parse(r.keys || '[]'),
        note: r.note, admin: r.admin, ticket: r.ticket_id ? { id: r.ticket_id, text: (r.ticket_text || '').slice(0, 160) } : null, count: countOf(r.user_id) })),
      total: q('SELECT COUNT(*) n, COALESCE(SUM(money), 0) money, COUNT(DISTINCT user_id) players FROM bug_rewards').get(),
      top: q('SELECT user_id, COUNT(*) n FROM bug_rewards GROUP BY user_id ORDER BY n DESC, MIN(id) LIMIT 5').all().map((r) => ({ user: brief(r.user_id), n: r.n })),
      presets: B.BUG_PRESETS,
    };
  }

  // The admin player card: how many finds were rewarded, the badge, the last few.
  const forUser = (uid) => ({
    count: countOf(uid), badge: B.bugBadgeFor(countOf(uid))?.title || null,
    last: q('SELECT preset, money, ticket_id ticket, created_at at FROM bug_rewards WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(uid),
  });
  // Support tickets that already got a reward (the panel shows «нагороджено» instead of the button).
  function ticketMarks(list) {
    for (const m of list || []) {
      const r = q('SELECT preset, money, created_at at FROM bug_rewards WHERE ticket_id = ?').get(m.id);
      m.bug = r || null;
    }
    return list;
  }
  // Rating rows: the tester tier (1 / 3) for the little 🐞 next to the name.
  function tagRows(list) {
    for (const r of list || []) {
      if (!r || !r.id) continue;
      const t = q("SELECT tier FROM badges WHERE user_id = ? AND key = 'tester'").get(r.id)?.tier;
      if (t) r.tester = t;
    }
    return list;
  }
  return { reward, list, forUser, ticketMarks, tagRows, countOf };
}
