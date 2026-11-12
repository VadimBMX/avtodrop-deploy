# Ключ аналітики для Claude

Read-only access for Claude (an outside analyst) to the game's analytics, the players' chat and support, through a
revocable key. The full `ADMIN_KEY` is never needed or shown. Code: `src/insight.js`, `src/insight-anon.js`,
`src/insight-sql.js`, `public/admin-insight.js`; tests: `test/insight.test.js`.

## Issue / revoke (owner or admin)

1. Admin panel → **«Аналітика для Claude»** (side bar, under «Промокоди», owner/admin only; URL `admin.html#insight`).
2. Type a label (who the key is for) → **«Видати ключ для Claude»** → confirm.
3. The key (`ins_…`, 32 random bytes, base64url) is shown **once**, with a copy button and a ready `curl` line.
   The server keeps only its sha256, so a lost key cannot be recovered: switch it off and issue a new one.
4. The **«Ключі»** list shows every key: label, who issued it, when, last use, request count. **«Вимкнути»** stops a key
   at once (it can't be switched back on).

At most 3 keys are active at a time. Issue, revoke and use (`insight-use`, at most once an hour per key) go into
«Журнал дій» (admin_log). Helpers can't see or issue keys.

## Using the key

Send it as `Authorization: Bearer <key>` (or `x-insight-key: <key>`). Limit: 60 requests a minute per key; 20 wrong
keys from one address lock it out for 10 minutes. The key works only on `/api/insight/*`: it is refused by
`/api/admin/*` and by the player API, and the admin key is refused by `/api/insight/*`.

```sh
K=ins_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
H="Authorization: Bearer $K"
curl -H "$H" https://<game>/api/insight/summary?days=14     # per Kyiv day: new players, DAU, sessions, D1/D3/D7 cohorts,
                                                            # cases by case id, races by kind, drifts, PvP, battles,
                                                            # money created/destroyed by source group, Stars, businesses,
                                                            # clubs, war attacks, promo uses; `notes` say what isn't tracked
curl -H "$H" https://<game>/api/insight/funnel?days=30      # signup → intro → starter case → garage → collect → first race
                                                            # → L3 → L4 → drift → L5 → business → club → first payment → L10
curl -H "$H" "https://<game>/api/insight/players?limit=100&sort=level"   # sort: level xp money value cars created last_seen stars
curl -H "$H" "https://<game>/api/insight/chat?since=2026-11-01&limit=200&topic=Гонки"   # topic: thread id or part of its name
curl -H "$H" "https://<game>/api/insight/support?status=open"  # status: open answered closed all; kind: support ideas all
curl -H "$H" https://<game>/api/insight/schema              # the v_* views of the SQL sandbox
curl -H "$H" -H 'content-type: application/json' https://<game>/api/insight/sql \
  -d '{"sql":"SELECT case_id, COUNT(*) n FROM v_drops WHERE created_at > ? GROUP BY case_id ORDER BY n DESC","params":[1794000000000],"limit":100}'
```

### SQL sandbox

- One `SELECT` or `WITH` statement (no `RECURSIVE`, no writes, `ATTACH`, `PRAGMA`, `sqlite_*` / `pragma_*` names, no
  second statement). Tables after `FROM` / `JOIN` must be `v_*` views or the query's own CTEs.
- It runs in a separate child process on an **anonymized in-memory snapshot**: the game database is attached
  read-only, each allowlisted table is copied into `v_<table>` with player ids replaced by pseudonyms and identifying
  columns left out (`ALLOW` in `src/insight-anon.js`), then the source is detached and the connection set to
  `query_only`. So even a query that got past the check could only see anonymized data.
- At most 2000 rows (`limit` lowers it); a query running over 5 s is killed. The snapshot is rebuilt when it is
  older than 5 minutes.

## Anonymization rules (hard rule)

Nothing returned through `/api/insight/*` contains Telegram user ids, first / last names, usernames, phones, photo
urls, payment charge ids, private-group invite links, or any token / secret.

- A player id becomes `p` + the first 10 hex of HMAC-SHA256(secret, id). The secret is the bot token (`BOT_TOKEN`, or
  `ADMIN_KEY` when there is no bot; a random salt in `meta` on a test copy), so pseudonyms are the same in every
  endpoint and view and across restarts, but can't be turned back into ids by the analyst. Changing the bot token
  changes every pseudonym. Game bots (ids ≤ 0) show as `npc<n>`.
- Free text (support, answers, ideas, chat) is scrubbed: the author's own names and username, every known @username
  (with or without `@`), `t.me` / `tg://` links, phone numbers and digit runs of 7+ are replaced.
- Left out entirely: usernames, names, fair-play seeds, charge ids, club invite codes and Telegram links, admin
  names (`answered_by`, `created_by`, car_log reasons), race rival snapshots (they hold player names), admin_log,
  server logs, meta, trade-room chat, player event texts.
- Start parameters are folded (`ref_<id>` → `ref_…`, `ch_<id>` → `ch_…`, `club_<code>` → `club_…`).

**Limitation:** another person's name typed as a plain word (not a known @username) can't be recognised, and the
last name of a support author isn't stored by the game, so it can't be scrubbed from support texts.

## Players' chat log

The bot (getUpdates, already admin in the players' chat) stores messages **only from the chat set in «Канал» →
«Наші групи» → «Чат гравців»** (matched by `@username` or `-100…` id). Private chats and other groups are ignored, and
the bot still answers nothing in groups. Stored per message: text or caption (never files; the media kind only),
message id, topic id and name (from `forum_topic_created` / `forum_topic_edited`), date, reply-to id, the sender's
pseudonym (`sender_kind`: user, bot, anon_admin, channel), whether the sender is a game player and their level.
Edits (`edited_message`, now in `allowed_updates`) update the text. Service messages (joins, pins) are not stored.

**Retention:** rows older than 30 days are deleted by the server's sweeper (checked hourly). The log starts when this
release goes live — there is no history before it.

## What isn't tracked

Screen views and taps inside the app (only API calls are recorded), Stars invoices opened but not paid, leaving a
club (only current members have a join date), business upgrade history (only the first purchase is dated; upgrade
spending shows in money by source), and the chat before this release. The `notes` field of `summary` and `funnel`
says this per response.
