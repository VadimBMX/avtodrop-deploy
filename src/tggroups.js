// The game's two Telegram groups (owner 27.10): the announcement channel (only admins post: updates, news, codes,
// and the auto-posts of src/channel.js) and the players' chat. The owner sets them in the admin panel («Канал» tab:
// @username or -100… id, plus an invite link for a private one), no server variables needed.
// A player who joins gets a one-time bonus per group (TGG.reward), checked with the Bot API (getChatMember: the bot
// must be an admin of the channel and a member of the chat — server.js does the call, this module only books it).
// Players who haven't joined hear about it from the bot now and then (kind 'tggroup' in src/reminders.js, with its
// usual limits — quiet hours, 2 reminders a day, idle players only): from level TGG.nudge.minLevel, a day after
// signing up, at most every TGG.nudge.everyD days and TGG.nudge.max times in all.
import * as S from '../public/shared.js';

export const TGG = {
  reward: { channel: { caseId: 'city', count: 1 }, chat: { caseId: 'city', count: 1 } },
  nudge: { minLevel: 2, minAgeH: 24, everyD: 3, max: 4 },
};
export const TGG_NAMES = { channel: 'Канал з анонсами', chat: 'Чат гравців' };
const ID_RE = /^(@[A-Za-z][A-Za-z0-9_]{3,31}|-100\d{5,15})$/;
const LINK_RE = /^https:\/\/t\.me\/[A-Za-z0-9_+/-]{3,80}$/;

export function normalizeGroups(c = {}) {
  const one = (id, link) => {
    const v = String(id || '').trim().replace(/^https:\/\/t\.me\//, '@');
    const ok = ID_RE.test(v) ? v : '';
    const l = String(link || '').trim();
    return { id: ok, link: LINK_RE.test(l) ? l : ok.startsWith('@') ? `https://t.me/${ok.slice(1)}` : '' };
  };
  const ch = one(c.channel, c.channelLink), cc = one(c.chat, c.chatLink);
  return { channel: ch.id, channelLink: ch.link, chat: cc.id, chatLink: cc.link };
}
export const rewardText = (r) => `${r.count} ${r.count === 1 ? 'ключ' : 'ключі'} «${S.CASE_BY_ID[r.caseId].name}»`;

export function createTgGroups({ db, q, now, fail, metaGet, metaSet, addKeys, event }) {
  db.exec(`CREATE TABLE IF NOT EXISTS tg_group_claims (user_id INTEGER NOT NULL, which TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, which));
    CREATE TABLE IF NOT EXISTS tg_group_nudge (user_id INTEGER PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, last INTEGER NOT NULL DEFAULT 0);`);
  const cfg = () => {
    try {
      return normalizeGroups(JSON.parse(metaGet('tggroups') || '{}'));
    } catch {
      return normalizeGroups({});
    }
  };
  const which = () => ['channel', 'chat'].filter((w) => cfg()[w]);
  const claimed = (uid) => new Set(q('SELECT which FROM tg_group_claims WHERE user_id = ?').all(uid).map((r) => r.which));

  // What the client shows: each configured group with its link, reward and whether the bonus is taken.
  function status(uid) {
    const c = cfg(), got = claimed(uid), list = which();
    if (!list.length) return null;
    return Object.fromEntries(list.map((w) => [w, { name: TGG_NAMES[w], link: c[`${w}Link`], reward: rewardText(TGG.reward[w]), claimed: got.has(w) }]));
  }
  // Books the bonus once the server has seen the player in the group (member = getChatMember said so).
  function claim(uid, w, member) {
    if (!TGG_NAMES[w] || !cfg()[w]) fail('Немає такої групи');
    if (claimed(uid).has(w)) fail('Бонус за цю групу вже отримано');
    if (!member) fail(w === 'channel' ? 'Ще не бачу тебе в каналі — підпишись і натисни ще раз' : 'Ще не бачу тебе в чаті — зайди в чат і натисни ще раз');
    const r = TGG.reward[w];
    q('INSERT INTO tg_group_claims (user_id, which, at) VALUES (?, ?, ?)').run(uid, w, now());
    addKeys(uid, r.caseId, r.count);
    event(uid, `📣 Бонус за ${w === 'channel' ? 'підписку на канал' : 'вступ у чат гравців'}: ${rewardText(r)}`);
    return { ok: true, reward: rewardText(r), groups: status(uid) };
  }
  function adminGet() {
    const c = cfg();
    const n = (w) => q('SELECT COUNT(*) n FROM tg_group_claims WHERE which = ?').get(w).n;
    return { ...c, claims: { channel: n('channel'), chat: n('chat') }, nudged: q('SELECT COUNT(*) n FROM tg_group_nudge WHERE n > 0').get().n, reward: { channel: rewardText(TGG.reward.channel), chat: rewardText(TGG.reward.chat) } };
  }
  function adminSet(body = {}) {
    const c = normalizeGroups(body);
    for (const w of ['channel', 'chat']) {
      if (String(body[w] || '').trim() && !c[w]) fail(`${TGG_NAMES[w]}: потрібен @нік (від 5 символів) або id -100…`);
      if (c[w] && !c[`${w}Link`]) fail(`${TGG_NAMES[w]}: для приватної групи потрібне посилання-запрошення https://t.me/+…`);
    }
    metaSet('tggroups', JSON.stringify(c));
    return adminGet();
  }

  // The bot reminder: adds a 'tggroup' item for players who haven't taken every group bonus yet (see the header).
  function remind(list, rules) {
    const groups = which();
    if (!groups.length) return list;
    const t = now(), N = TGG.nudge, c = cfg();
    const rows = q(`SELECT u.*, COALESCE(g.n, 0) g_n, COALESCE(g.last, 0) g_last,
        (SELECT COUNT(*) FROM tg_group_claims k WHERE k.user_id = u.id) g_claims
      FROM users u LEFT JOIN tg_group_nudge g ON g.user_id = u.id
      WHERE u.id > 0 AND u.level >= ? AND u.created_at <= ? AND u.push_off = 0 AND u.push_blocked = 0 AND u.banned = 0
        AND u.last_seen BETWEEN ? AND ? AND COALESCE(g.n, 0) < ?`)
      .all(N.minLevel, t - N.minAgeH * 3600e3, t - rules.inactiveDays * 86400e3, t - rules.idleMin * 60e3, N.max);
    if (!rows.length) return list;
    const byId = new Map(list.map((x) => [x.uid, x]));
    for (const u of rows) {
      let sent = {};
      try {
        sent = JSON.parse(u.push_sent || '{}') || {};
      } catch {}
      // Count the nudges the scheduler actually sent (push_sent.tggroup moves when one goes out).
      let n = u.g_n, last = u.g_last;
      if (sent.tggroup && sent.tggroup > last) {
        n++;
        last = sent.tggroup;
        q('INSERT INTO tg_group_nudge (user_id, n, last) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET n = excluded.n, last = excluded.last').run(u.id, n, last);
      }
      if (n >= N.max || u.g_claims >= groups.length || (last && t - last < N.everyD * 86400e3)) continue;
      const got = claimed(u.id), open = groups.filter((w) => !got.has(w));
      if (!open.length) continue;
      const names = open.map((w) => `${w === 'channel' ? 'канал з новинами' : 'чат гравців'} ${c[w].startsWith('@') ? c[w] : c[`${w}Link`]}`).join(' і ');
      const text = `📣 Заходь у ${names} — за ${open.length > 1 ? 'кожну' : 'вступ'} ${rewardText(TGG.reward[open[0]])} у подарунок. Забрати: Меню → «Наші групи в Telegram»`;
      const item = { kind: 'tggroup', at: t, text };
      const cand = byId.get(u.id);
      if (cand) {
        if (!cand.ready.some((r) => r.kind === 'tggroup')) cand.ready.push(item);
        continue;
      }
      const fresh = { uid: u.id, pushOff: false, blocked: false, lastSeen: u.last_seen, pushDay: u.push_day, pushCount: u.push_count, pushLast: u.push_last, mute: u.push_mute, sent, ready: [item] };
      list.push(fresh);
      byId.set(u.id, fresh);
    }
    return list;
  }
  return { cfg, status, claim, adminGet, adminSet, remind };
}
