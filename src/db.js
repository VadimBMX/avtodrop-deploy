import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT, first_name TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  referrer_id INTEGER, ref_paid INTEGER NOT NULL DEFAULT 0,
  slots INTEGER NOT NULL, showcase_slots INTEGER NOT NULL,
  cap_level INTEGER NOT NULL DEFAULT 0,
  income_at INTEGER NOT NULL, banked REAL NOT NULL DEFAULT 0,
  fuel INTEGER NOT NULL, fuel_at INTEGER NOT NULL,
  server_seed TEXT NOT NULL, client_seed TEXT NOT NULL, nonce INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1, level_seen INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0,
  xp_day TEXT, xp_day_capped INTEGER NOT NULL DEFAULT 0,
  newbie_step INTEGER NOT NULL DEFAULT 0, newbie_flags TEXT NOT NULL DEFAULT '[]',
  streak INTEGER NOT NULL DEFAULT 0, streak_day TEXT,
  reward_case_at INTEGER NOT NULL DEFAULT 0,
  total_value INTEGER NOT NULL DEFAULT 0,
  week_id TEXT, week_start_value INTEGER NOT NULL DEFAULT 0,
  last_week_id TEXT, last_week_growth INTEGER,
  cases_opened INTEGER NOT NULL DEFAULT 0, races INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, merges INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_seen INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(lower(username)) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'garage',
  tank INTEGER NOT NULL, tank_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cars_owner ON cars(owner_id, status);
CREATE TABLE IF NOT EXISTS car_parts (car_id INTEGER NOT NULL, type TEXT NOT NULL, tier TEXT NOT NULL, PRIMARY KEY (car_id, type));

CREATE TABLE IF NOT EXISTS parts (user_id INTEGER, type TEXT, tier TEXT, count INTEGER NOT NULL, PRIMARY KEY (user_id, type, tier));
CREATE TABLE IF NOT EXISTS parts_cool (user_id INTEGER NOT NULL, type TEXT NOT NULL, tier TEXT NOT NULL, until INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS plates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL, text TEXT NOT NULL UNIQUE, cls TEXT NOT NULL, value INTEGER NOT NULL,
  car_id INTEGER UNIQUE, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plates_owner ON plates(owner_id);

CREATE TABLE IF NOT EXISTS keys (user_id INTEGER, case_id TEXT, count INTEGER NOT NULL, PRIMARY KEY (user_id, case_id));
-- Key fragments (S.FRAGMENTS_PER_KEY): a drop worth less than its case leaves one; a full set becomes a key.
CREATE TABLE IF NOT EXISTS fragments (user_id INTEGER, case_id TEXT, count INTEGER NOT NULL, PRIMARY KEY (user_id, case_id));
CREATE TABLE IF NOT EXISTS collection (user_id INTEGER, model TEXT, at INTEGER, PRIMARY KEY (user_id, model));
CREATE TABLE IF NOT EXISTS claims (user_id INTEGER, key TEXT, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS pity (user_id INTEGER, case_id TEXT, count INTEGER NOT NULL, PRIMARY KEY (user_id, case_id));

CREATE TABLE IF NOT EXISTS drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, case_id TEXT NOT NULL, item TEXT NOT NULL, cls TEXT NOT NULL,
  seed_hash TEXT NOT NULL, client_seed TEXT NOT NULL, nonce INTEGER NOT NULL, forced INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drops_user ON drops(user_id, id);
CREATE TABLE IF NOT EXISTS revealed_seeds (user_id INTEGER, seed TEXT, seed_hash TEXT, revealed_at INTEGER);

CREATE TABLE IF NOT EXISTS rivals (user_id INTEGER, car_id INTEGER, sig TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, car_id));
CREATE TABLE IF NOT EXISTS races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, car_id INTEGER NOT NULL, rival TEXT NOT NULL,
  entry INTEGER NOT NULL, prize INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running',
  result TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL, car_id INTEGER NOT NULL UNIQUE, price INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL, car_id INTEGER NOT NULL, start_price INTEGER NOT NULL,
  top_bid INTEGER, top_bidder INTEGER, bids INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auctions_open ON auctions(status, ends_at);
-- Parts and plates on the player market (S.ITEM_MARKET). A part lot holds its pieces (taken off the warehouse);
-- a plate lot points at the plate, which stays in plates and is locked while listed. item_key groups lots and sales
-- for the "good price" median: "part:<type>:<tier>" or "plate:<class>". price is for the whole lot, base per piece.
CREATE TABLE IF NOT EXISTS item_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, seller_id INTEGER NOT NULL, kind TEXT NOT NULL, item_key TEXT NOT NULL,
  part_type TEXT, part_tier TEXT, plate_id INTEGER UNIQUE, count INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL, base INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS item_listings_kind ON item_listings(kind, id);
CREATE INDEX IF NOT EXISTS item_listings_seller ON item_listings(seller_id);
CREATE INDEX IF NOT EXISTS item_listings_expiry ON item_listings(expires_at);
CREATE TABLE IF NOT EXISTS item_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, item_key TEXT NOT NULL, seller_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL,
  part_type TEXT, part_tier TEXT, plate_text TEXT, count INTEGER NOT NULL, price INTEGER NOT NULL, fee INTEGER NOT NULL,
  base INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS item_sales_key ON item_sales(item_key, id);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
  give_money INTEGER NOT NULL DEFAULT 0, get_money INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_users ON trades(from_id, to_id, status);
CREATE TABLE IF NOT EXISTS trade_items (trade_id INTEGER NOT NULL, car_id INTEGER NOT NULL, side TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS pvp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL, car_id INTEGER NOT NULL, snapshot TEXT NOT NULL, bet INTEGER NOT NULL,
  opponent_id INTEGER, opp_car_id INTEGER, opp_snapshot TEXT,
  winner_id INTEGER, result TEXT, status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS pvp_status ON pvp(status, id);

CREATE TABLE IF NOT EXISTS quests (
  user_id INTEGER, day TEXT, key TEXT, target INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  reward INTEGER NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day, key)
);
CREATE TABLE IF NOT EXISTS crash_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, bet INTEGER NOT NULL, point REAL NOT NULL,
  auto REAL, started_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running', cashout REAL
);
CREATE INDEX IF NOT EXISTS crash_user ON crash_games(user_id, id);
CREATE TABLE IF NOT EXISTS mines_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, bet INTEGER NOT NULL, mines INTEGER NOT NULL,
  layout TEXT NOT NULL, revealed TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'running', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mines_user ON mines_games(user_id, id);
CREATE TABLE IF NOT EXISTS weeks (week_id TEXT PRIMARY KEY, settled_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS promos (code TEXT PRIMARY KEY, amount INTEGER NOT NULL, uses_left INTEGER NOT NULL, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS promo_uses (code TEXT, user_id INTEGER, PRIMARY KEY (code, user_id));
CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, pack TEXT NOT NULL, stars INTEGER NOT NULL,
  amount INTEGER NOT NULL, created_at INTEGER NOT NULL
);
-- VIP as a Telegram Stars subscription (S.VIP_SUB), one row per player: the first payment's charge id (Telegram's id of
-- the subscription, for editUserStarSubscription), the latest renewal's, the end of the paid period, renewal switched off.
CREATE TABLE IF NOT EXISTS vip_subs (
  user_id INTEGER PRIMARY KEY, charge_id TEXT NOT NULL, last_charge TEXT, stars INTEGER NOT NULL, started_at INTEGER NOT NULL,
  renewed_at INTEGER, expires_at INTEGER NOT NULL, renewals INTEGER NOT NULL DEFAULT 0, canceled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id, id);
CREATE TABLE IF NOT EXISTS trade_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, host_id INTEGER NOT NULL, guest_id INTEGER, invited_id INTEGER, note TEXT,
  status TEXT NOT NULL DEFAULT 'open', version INTEGER NOT NULL DEFAULT 1,
  host_money INTEGER NOT NULL DEFAULT 0, guest_money INTEGER NOT NULL DEFAULT 0,
  host_ready INTEGER NOT NULL DEFAULT 0, guest_ready INTEGER NOT NULL DEFAULT 0,
  host_seen INTEGER NOT NULL, guest_seen INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trade_rooms_status ON trade_rooms(status, host_seen);
CREATE TABLE IF NOT EXISTS trade_room_items (room_id INTEGER NOT NULL, user_id INTEGER NOT NULL, car_id INTEGER NOT NULL, PRIMARY KEY (room_id, car_id));
CREATE TABLE IF NOT EXISTS trade_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL, user_id INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trade_chat_room ON trade_chat(room_id, id);
CREATE TABLE IF NOT EXISTS battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id INTEGER NOT NULL, opponent_id INTEGER, case_id TEXT NOT NULL, count INTEGER NOT NULL,
  price INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', winner_id INTEGER, result TEXT, created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS battles_status ON battles(status, id);
-- Race streak (S.RACE_STREAK): Kyiv days in a row with a race. n race days in the current run, which began on start;
-- day = the last race day; best = the longest run; freeze = the last missed day a weekly freeze covered; ready = JSON
-- list of milestones reached and not yet claimed ([{ m, start }]).
CREATE TABLE IF NOT EXISTS race_streak (
  user_id INTEGER PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, day TEXT, start TEXT, best INTEGER NOT NULL DEFAULT 0,
  freeze TEXT, ready TEXT NOT NULL DEFAULT '[]'
);
-- «Цілі дня» (src/goals.js): a row per Kyiv day with all three daily tasks done — the key it gives (fixed at that
-- moment) and whether it was taken; goal_streak is the run of such days, kept like race_streak (ready: [{ m, day, caseId, count }]).
CREATE TABLE IF NOT EXISTS goal_days (
  user_id INTEGER NOT NULL, day TEXT NOT NULL, case_id TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS goal_streak (
  user_id INTEGER PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, day TEXT, start TEXT, best INTEGER NOT NULL DEFAULT 0,
  freeze TEXT, ready TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
-- Players of the first (pre-reset) version: who invited them, how many Stars they donated, whether we've thanked them.
CREATE TABLE IF NOT EXISTS legacy (id INTEGER PRIMARY KEY, referrer_id INTEGER, stars INTEGER NOT NULL DEFAULT 0, thanked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS dealer_buys (batch INTEGER NOT NULL, user_id INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (batch, user_id));
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, note TEXT,
  shown INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gifts_user ON gifts(user_id, shown);
-- A car an admin set to drop for a player: it comes out of the next opened case that contains it.
CREATE TABLE IF NOT EXISTS rigged_drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, model TEXT NOT NULL,
  created_at INTEGER NOT NULL, used_at INTEGER
);
CREATE INDEX IF NOT EXISTS rigged_user ON rigged_drops(user_id, used_at);
CREATE TABLE IF NOT EXISTS drift_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, car_id INTEGER NOT NULL, rival TEXT NOT NULL,
  target INTEGER NOT NULL, entry INTEGER NOT NULL, prize INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running',
  result TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drift_user ON drift_runs(user_id, status);
-- Messages to support from the game, and the admin's answer.
CREATE TABLE IF NOT EXISTS support (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL,
  answer TEXT, answered_at INTEGER, answered_by TEXT
);
CREATE INDEX IF NOT EXISTS support_user ON support(user_id, id);
-- «🐞 Нагорода за баг» (src/bugbounty.js): one row per rewarded find — preset, what was paid, the ticket it came from.
CREATE TABLE IF NOT EXISTS bug_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, ticket_id INTEGER, preset TEXT NOT NULL, money INTEGER NOT NULL DEFAULT 0,
  keys TEXT, note TEXT, admin TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bug_rewards_user ON bug_rewards(user_id);
CREATE INDEX IF NOT EXISTS bug_rewards_ticket ON bug_rewards(ticket_id);
CREATE TABLE IF NOT EXISTS invite_log (from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS invite_log_from ON invite_log(from_id, at);
-- Ghost challenges (public/ghost.js): a finished drag run (race_id, one challenge per run) a friend races against.
-- car: the creator's car as it raced ({ model, hp, kg, cls, base, shift, parts, look }); run: { reaction, shiftAt,
-- shifts } — the ghost; day: the Kyiv day it was thrown (the daily limit). accepted / beaten: players who finished a
-- run against it / beat it; recruits: new players who came by its link (they became the creator's referrals).
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY, creator_id INTEGER NOT NULL, race_id INTEGER NOT NULL UNIQUE, car TEXT NOT NULL, run TEXT NOT NULL,
  time REAL NOT NULL, day TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0, beaten INTEGER NOT NULL DEFAULT 0, recruits INTEGER NOT NULL DEFAULT 0, card TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS challenges_creator ON challenges(creator_id, created_at);
-- One row per player who started a race against a challenge: starts (the first is free of fuel), finished runs, the
-- best time, the first win, the prize paid for it and its Kyiv day (the daily cap); defended: the creator was paid
-- for this player's first loss, on that Kyiv day (his daily cap).
CREATE TABLE IF NOT EXISTS challenge_tries (
  challenge_id TEXT NOT NULL, user_id INTEGER NOT NULL, starts INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0,
  best REAL, won_at INTEGER, prize INTEGER NOT NULL DEFAULT 0, prize_day TEXT, defend_pay INTEGER NOT NULL DEFAULT 0, defend_day TEXT,
  first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (challenge_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS challenge_tries_user ON challenge_tries(user_id, last_at);
CREATE INDEX IF NOT EXISTS challenge_tries_defend ON challenge_tries(defend_day);
-- For achievement progress (wins and friends are counted on every poll).
CREATE INDEX IF NOT EXISTS pvp_winner ON pvp(winner_id);
CREATE INDEX IF NOT EXISTS battles_winner ON battles(winner_id);
CREATE INDEX IF NOT EXISTS users_referrer ON users(referrer_id);
CREATE TABLE IF NOT EXISTS seasons (season_id INTEGER PRIMARY KEY, settled_at INTEGER NOT NULL);
-- Badges that stay for good (season top-100 places).
CREATE TABLE IF NOT EXISTS badges (
  user_id INTEGER NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, tier INTEGER NOT NULL DEFAULT 0, season INTEGER, place INTEGER,
  created_at INTEGER NOT NULL, PRIMARY KEY (user_id, key)
);
-- Career (S.BOSSES): one row per boss a player has raced; beaten_at is set once, by the first win (its one-time reward).
CREATE TABLE IF NOT EXISTS boss_runs (
  user_id INTEGER NOT NULL, boss TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  best REAL, beaten_at INTEGER, PRIMARY KEY (user_id, boss)
);
-- «Заїзд дня» (public/dayrace.js, src/dayrace.js). Runs are ordinary drag races in \`races\` (rival.dayrace = the day).
-- Attempts per player and Kyiv day (counted at the start); each player's best finished time of the day (the board;
-- place / field / prize are written once, by the midnight settlement; claimed_at when the prize was taken); the days
-- already settled (one row each — the guard that pays a day exactly once).
CREATE TABLE IF NOT EXISTS dayrace_tries (day TEXT NOT NULL, user_id INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS dayrace_best (
  day TEXT NOT NULL, user_id INTEGER NOT NULL, model TEXT NOT NULL, time REAL NOT NULL, at INTEGER NOT NULL, race_id INTEGER,
  flag INTEGER NOT NULL DEFAULT 0, dq INTEGER NOT NULL DEFAULT 0, place INTEGER, field INTEGER, prize TEXT, claimed_at INTEGER,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX IF NOT EXISTS dayrace_best_board ON dayrace_best(day, time, at);
CREATE INDEX IF NOT EXISTS dayrace_best_user ON dayrace_best(user_id, day);
CREATE TABLE IF NOT EXISTS dayrace_days (day TEXT PRIMARY KEY, model TEXT NOT NULL, total INTEGER NOT NULL, settled_at INTEGER NOT NULL);
-- «Турнір вихідних» (public/tourney.js, src/tourney.js); tid = the Friday of the week. Entries (one car per player);
-- the week's draw (its row is the guard that draws once); brackets (done_at: prizes paid once); matches (a/b: the
-- side as JSON — a player {uid, seed} or a bot; *_uid for look-ups; best time, its moment, runs used, the best run for
-- the ghost, the run in progress); prizes (one row per player and week: the guard that pays once).
CREATE TABLE IF NOT EXISTS tourney_entries (tid TEXT NOT NULL, user_id INTEGER NOT NULL, car_id INTEGER NOT NULL, model TEXT NOT NULL, cls TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tid, user_id));
CREATE TABLE IF NOT EXISTS tourney_weeks (tid TEXT PRIMARY KEY, built_at INTEGER NOT NULL, field INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tourney_brackets (
  tid TEXT NOT NULL, bracket TEXT NOT NULL, cls TEXT NOT NULL, size INTEGER NOT NULL, humans INTEGER NOT NULL,
  champion TEXT, done_at INTEGER, PRIMARY KEY (tid, bracket)
);
CREATE TABLE IF NOT EXISTS tourney_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tid TEXT NOT NULL, bracket TEXT NOT NULL, round INTEGER NOT NULL, slot INTEGER NOT NULL,
  opens_at INTEGER NOT NULL, deadline INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'wait',
  a TEXT, a_uid INTEGER, a_best REAL, a_at INTEGER, a_tries INTEGER NOT NULL DEFAULT 0, a_run TEXT, a_live INTEGER,
  b TEXT, b_uid INTEGER, b_best REAL, b_at INTEGER, b_tries INTEGER NOT NULL DEFAULT 0, b_run TEXT, b_live INTEGER,
  winner INTEGER, how TEXT, decided_at INTEGER, sent TEXT, UNIQUE (tid, bracket, round, slot)
);
CREATE INDEX IF NOT EXISTS tourney_matches_due ON tourney_matches(status, opens_at);
CREATE INDEX IF NOT EXISTS tourney_matches_a ON tourney_matches(a_uid, tid);
CREATE INDEX IF NOT EXISTS tourney_matches_b ON tourney_matches(b_uid, tid);
CREATE TABLE IF NOT EXISTS tourney_prizes (
  tid TEXT NOT NULL, user_id INTEGER NOT NULL, bracket TEXT NOT NULL, cls TEXT NOT NULL, place INTEGER NOT NULL, prize TEXT NOT NULL,
  at INTEGER NOT NULL, PRIMARY KEY (tid, user_id)
);
-- Weekly route (S.WEEKLY_QUESTS): four tasks per player and Kyiv week (Monday date). Chest claims live in claims
-- under "wk:<week>:<days>".
CREATE TABLE IF NOT EXISTS weekly_quests (
  user_id INTEGER, week TEXT, key TEXT, target INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, week, key)
);
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT NOT NULL, action TEXT NOT NULL, target INTEGER, details TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_log_target ON admin_log(target, id);
-- Admin dashboard: which (Kyiv) days each player was in the game, and the hryvnias that appeared in / left the economy
-- per day (every addMoney / pay; player-to-player deals count on both sides, the net is the real change of money supply).
CREATE TABLE IF NOT EXISTS user_days (day TEXT NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (day, user_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS money_days (day TEXT PRIMARY KEY, created INTEGER NOT NULL DEFAULT 0, destroyed INTEGER NOT NULL DEFAULT 0);
-- Owner metrics (admin «Метрики»): a player's days in order (cohorts, WAU); the first time each first-session step
-- happened (intro, drop, garage, collect, race, L2…L10); money_days split by what moved the money (the API call,
-- admin action or system job, grouped in src/metrics.js).
CREATE INDEX IF NOT EXISTS user_days_user ON user_days(user_id, day);
CREATE TABLE IF NOT EXISTS funnel (user_id INTEGER NOT NULL, step TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, step)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS money_src (
  day TEXT NOT NULL, src TEXT NOT NULL, created INTEGER NOT NULL DEFAULT 0, destroyed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, src)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS drops_time ON drops(created_at);
CREATE INDEX IF NOT EXISTS users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS payments_time ON payments(created_at);
-- «Причал», the container auction (public/containers.js, src/containers.js). One row per lot; model/ed/junk/salt/bots/
-- seed/pending never leave the server before status = 'done'. top_bidder < 0 is a bot (public/containers.js botOf);
-- the leader's bid is held in escrow (taken from users.balance, given back when outbid). status: waiting (no human bid
-- yet) | live | done | cancelled. opened: the winner has watched the doors open.
CREATE TABLE IF NOT EXISTS container_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tier TEXT NOT NULL, model TEXT NOT NULL, ed INTEGER NOT NULL DEFAULT 0,
  junk INTEGER NOT NULL DEFAULT 0, hints TEXT NOT NULL, commit_hash TEXT NOT NULL, salt TEXT NOT NULL, seed INTEGER NOT NULL,
  bots TEXT NOT NULL, pending TEXT, ev INTEGER NOT NULL DEFAULT 0,
  top_bid INTEGER NOT NULL DEFAULT 0, top_bidder INTEGER, bids INTEGER NOT NULL DEFAULT 0, humans INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting', live_at INTEGER, ends_at INTEGER NOT NULL, opened INTEGER NOT NULL DEFAULT 0,
  car_id INTEGER, serial INTEGER, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS container_lots_open ON container_lots(status, ends_at);
CREATE INDEX IF NOT EXISTS container_lots_bidder ON container_lots(top_bidder, status);
-- Every bid (amount > 0) and every bot's «пас» (amount 0) of a lot, for its feed.
CREATE TABLE IF NOT EXISTS container_bids (lot_id INTEGER NOT NULL, bidder INTEGER NOT NULL, amount INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS container_bids_lot ON container_bids(lot_id, at);
-- The next serial number of each «тиражна» edition (S.EDITION_CARS).
CREATE TABLE IF NOT EXISTS edition_serials (model TEXT PRIMARY KEY, next INTEGER NOT NULL DEFAULT 1);
-- «Контейнери 2.0»: «Огляд експерта» bought by a player on a lot (one per lot and player; value: the revealed fact, JSON)
-- and the players who asked to be reminded of «Вечірній аукціон» (a push 30 min before 20:00).
CREATE TABLE IF NOT EXISTS container_expert (lot_id INTEGER NOT NULL, user_id INTEGER NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL,
  price INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (lot_id, user_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS container_subs (user_id INTEGER PRIMARY KEY, at INTEGER NOT NULL);
-- «Сарайна знахідка» (src/barn.js): a find per row — status 'found' | 'work' | 'done' | 'dropped'; done = stages finished,
-- run_until = end of the running stage (NULL between stages); spent/parts/rushed = what the restoration ate. source:
-- 'week:<monday>' or 'lot:<id>', UNIQUE per player (a weekly find can't be taken twice). barn_lots: each won container
-- rolled once for a find inside (model NULL = none).
CREATE TABLE IF NOT EXISTS barn_finds (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, model TEXT NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'found', done INTEGER NOT NULL DEFAULT 0, run_until INTEGER, spent INTEGER NOT NULL DEFAULT 0,
  parts INTEGER NOT NULL DEFAULT 0, rushed INTEGER NOT NULL DEFAULT 0, car_id INTEGER, created_at INTEGER NOT NULL, started_at INTEGER, done_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS barn_finds_src ON barn_finds(user_id, source);
CREATE INDEX IF NOT EXISTS barn_finds_work ON barn_finds(status, run_until);
CREATE TABLE IF NOT EXISTS barn_lots (lot_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, model TEXT, at INTEGER NOT NULL);
-- «Ніч Хелловіну» (src/halloween.js): event task progress per event year ('hw2026'), player and task; done_at is set
-- once (the task is paid then), prize: what it paid (JSON).
CREATE TABLE IF NOT EXISTS hw_tasks (event TEXT NOT NULL, user_id INTEGER NOT NULL, task TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER, prize TEXT, PRIMARY KEY (event, user_id, task)) WITHOUT ROWID;
-- Admin events scheduler (src/schedule.js): planned game events (kind = an S.EVENTS id) with Kyiv-time windows [start, end)
-- in ms; params: JSON { country?, caseId? }; seed: the default calendar's slot id (so it is seeded once).
CREATE TABLE IF NOT EXISTS event_plan (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT, start INTEGER NOT NULL,
  end INTEGER NOT NULL, params TEXT, note TEXT, seed TEXT UNIQUE, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS event_plan_end ON event_plan (end);
-- «Престиж» (src/prestige.js): a car's restyle ★ (they stay with the car whoever owns it), when the last ★ was done
-- (one per car per 24 h) and how much was paid for them; trophies bought in the «Трофейна зала» (k = 0…9, in order).
CREATE TABLE IF NOT EXISTS car_restyle (car_id INTEGER PRIMARY KEY, stars INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0, spent INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS car_restyle_gone AFTER DELETE ON cars BEGIN DELETE FROM car_restyle WHERE car_id = old.id; END;
CREATE TABLE IF NOT EXISTS trophies (user_id INTEGER NOT NULL, k INTEGER NOT NULL, cost INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, k)) WITHOUT ROWID;
-- «Таємний покупець» (src/buyer.js, public/buyer.js): one offer per player per Kyiv day. req: JSON { model } or
-- { cls, country }; prem: the premium share; expires_at = created_at + 3 h. Sold: the car, its model, what was paid in
-- all (paid) and the part above the dealer's price (bonus).
CREATE TABLE IF NOT EXISTS buyer_offers (user_id INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, req TEXT NOT NULL, prem REAL NOT NULL,
  city TEXT NOT NULL, line TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, sold_at INTEGER, car_id INTEGER, sold_model TEXT,
  paid INTEGER NOT NULL DEFAULT 0, bonus INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS buyer_offers_open ON buyer_offers(expires_at, sold_at);
-- Lookups by player that had no index of their own (EXPLAIN QUERY PLAN showed a full scan): incoming trades and room
-- invites (every me / pulse), parts cooling down (inventory), barn finds (me), who is online (the trade hall).
CREATE INDEX IF NOT EXISTS trades_to ON trades(to_id, status);
CREATE INDEX IF NOT EXISTS trade_rooms_invited ON trade_rooms(invited_id, status);
CREATE INDEX IF NOT EXISTS parts_cool_user ON parts_cool(user_id, until);
CREATE INDEX IF NOT EXISTS barn_finds_user ON barn_finds(user_id, status);
CREATE INDEX IF NOT EXISTS users_seen ON users(last_seen);
-- Desktop admin dashboard (src/admin-pc.js): which UTC hours (ms / 1 h) each player made a call in, for «активні за
-- годину» today and yesterday; kept for three days.
CREATE TABLE IF NOT EXISTS user_hours (hour INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (hour, user_id)) WITHOUT ROWID;
-- Admin «Логи» (src/logs.js, src/serverlog.js, public/admin-logs.js). server_log: warnings and errors of the server
-- process (redacted before they are written; 14 days, at most ~20k rows, pruned by the sweeper). sessions: a player's
-- visits — started on the first API call after a gap over 30 min, last_at moved at most once a minute (30 days).
CREATE TABLE IF NOT EXISTS server_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level TEXT NOT NULL, msg TEXT NOT NULL, stack TEXT);
CREATE INDEX IF NOT EXISTS server_log_ts ON server_log(ts);
CREATE INDEX IF NOT EXISTS server_log_level ON server_log(level, ts);
CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, started_at INTEGER NOT NULL, last_at INTEGER NOT NULL, source TEXT);
CREATE INDEX IF NOT EXISTS sessions_time ON sessions(started_at);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, started_at);
-- «Стрічка подій» reads every source newest first over a time window: each needs an index on its time column
-- (drops_time, users_created, payments_time exist above; car_log_at and promo_uses_at come after their tables / columns).
CREATE INDEX IF NOT EXISTS trades_upd ON trades(updated_at);
CREATE INDEX IF NOT EXISTS trade_rooms_upd ON trade_rooms(updated_at);
CREATE INDEX IF NOT EXISTS listings_time ON listings(created_at);
CREATE INDEX IF NOT EXISTS item_listings_time ON item_listings(created_at);
CREATE INDEX IF NOT EXISTS item_sales_time ON item_sales(created_at);
CREATE INDEX IF NOT EXISTS auctions_time ON auctions(created_at);
CREATE INDEX IF NOT EXISTS gifts_time ON gifts(created_at);
CREATE INDEX IF NOT EXISTS support_time ON support(created_at);
CREATE INDEX IF NOT EXISTS races_time ON races(created_at);
CREATE INDEX IF NOT EXISTS pvp_fin ON pvp(finished_at);
CREATE INDEX IF NOT EXISTS battles_fin ON battles(finished_at);
CREATE INDEX IF NOT EXISTS container_bids_at ON container_bids(at);
CREATE INDEX IF NOT EXISTS container_lots_settled ON container_lots(settled_at);
CREATE INDEX IF NOT EXISTS invite_log_at ON invite_log(at);
CREATE INDEX IF NOT EXISTS admin_log_time ON admin_log(created_at);
`;
// Columns added after the first release; ALTER fails harmlessly when they already exist.
const MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN ban_reason TEXT',
  // "Do not disturb": nobody can invite this player to a trade or a live race.
  'ALTER TABLE users ADD COLUMN no_invites INTEGER NOT NULL DEFAULT 0',
  // Live PvP: request time, start/green times (server ms), both players' progress (0..1) and finished runs.
  'ALTER TABLE pvp ADD COLUMN req_at INTEGER',
  'ALTER TABLE pvp ADD COLUMN start_at INTEGER',
  'ALTER TABLE pvp ADD COLUMN green_at INTEGER',
  'ALTER TABLE pvp ADD COLUMN c_u REAL NOT NULL DEFAULT 0',
  'ALTER TABLE pvp ADD COLUMN o_u REAL NOT NULL DEFAULT 0',
  'ALTER TABLE pvp ADD COLUMN c_run TEXT',
  'ALTER TABLE pvp ADD COLUMN o_run TEXT',
  // Case battles: the creator agreed that «Дилер Петрович» (S.BATTLE_BOT) sits in when nobody joins in time.
  // Battles open before this column get 0, so no bot ever joins them.
  'ALTER TABLE battles ADD COLUMN bot_ok INTEGER NOT NULL DEFAULT 0',
  // Luck (see S.LUCK): fading totals of case spending and drop value, and when the free rescue case was last given.
  'ALTER TABLE users ADD COLUMN luck_spent REAL NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN luck_got REAL NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN rescue_at INTEGER NOT NULL DEFAULT 0',
  // Luck switched on by an admin: this chance for the next luck_bonus_left case rolls.
  'ALTER TABLE users ADD COLUMN luck_bonus REAL NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN luck_bonus_left INTEGER NOT NULL DEFAULT 0',
  // Time spent with the game open on screen (summed between the app's polls), and when the last poll came.
  'ALTER TABLE users ADD COLUMN play_ms INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN play_at INTEGER NOT NULL DEFAULT 0',
  // Owner metrics: the deep-link parameter the player arrived with (ref_<id>, ch_<id>, …; NULL = opened the bot
  // directly), the last moment counted for sessions (a gap over 30 min starts a new one, src/metrics.js), and the
  // sessions of each day (0 on days from before the counting began).
  'ALTER TABLE users ADD COLUMN start_param TEXT',
  'ALTER TABLE users ADD COLUMN session_at INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE user_days ADD COLUMN sessions INTEGER NOT NULL DEFAULT 0',
  // Drops in a row worth less than their case (S.LUCK.streak).
  'ALTER TABLE users ADD COLUMN bad_streak INTEGER NOT NULL DEFAULT 0',
  // Instant sales at the full rate today (S.SELL_DAILY): the day and how much was sold.
  'ALTER TABLE users ADD COLUMN sold_day TEXT',
  'ALTER TABLE users ADD COLUMN sold_full INTEGER NOT NULL DEFAULT 0',
  // Rights in the admin panel given from the panel: 'admin' (everything) or 'helper' (players, support, messages).
  'ALTER TABLE users ADD COLUMN role TEXT',
  // Seasons (S.SEASON): the season the counters below belong to, season XP, the season whose premium pass is bought.
  'ALTER TABLE users ADD COLUMN season_id INTEGER',
  'ALTER TABLE users ADD COLUMN season_xp INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN premium_season INTEGER NOT NULL DEFAULT 0',
  // Progression version of the player's row: 0 = the old XP curve (S.xpForLevelV1) and the 10-task newbie track,
  // 1 = the XP table and «Перші кроки». New players get 1 at sign-up; every row with 0 (players from before, or rows
  // merged in from an older database) is migrated once at the next start (game.js migrateProgress).
  'ALTER TABLE users ADD COLUMN prog_v INTEGER NOT NULL DEFAULT 0',
  // Stars on the account (season prizes), spent in the shop; VIP end time; garage slots bought for stars; starter pack.
  'ALTER TABLE users ADD COLUMN stars INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN vip_until INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN star_slots INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN starter_bought INTEGER NOT NULL DEFAULT 0',
  // «Стиль» (S.STYLE_SLOTS): what the player wears per slot, JSON {frame, showcase, name, glow} of cosmetic ids ('' = off).
  "ALTER TABLE users ADD COLUMN style TEXT NOT NULL DEFAULT '{}'",
  // Paint 2.0 (S.PAINT_COLORS): the car's body colour id, NULL = factory. The column comes from the first CSS repaint,
  // whose colour ids are kept, so cars painted back then stay painted.
  'ALTER TABLE cars ADD COLUMN paint TEXT',
  // Best plate class (rank: C 1 … S 4) the player generated himself — the "Номерний знак" achievement counts this, so a
  // plate that came with a traded car doesn't count and selling one doesn't lose it. The second statement runs once,
  // when the column is added: plates owned at that moment count as generated.
  ['ALTER TABLE users ADD COLUMN plate_best INTEGER NOT NULL DEFAULT 0',
    `UPDATE users SET plate_best = COALESCE((SELECT MAX(CASE cls WHEN 'C' THEN 1 WHEN 'B' THEN 2 WHEN 'A' THEN 3 WHEN 'S' THEN 4 ELSE 0 END)
       FROM plates WHERE owner_id = users.id), 0)`],
  // Bot reminders (src/reminders.js): switched off by the player (settings or /stop); Telegram answered 403 (bot blocked or
  // never started); the Kyiv day and how many reminders went out that day; when each kind was last sent ({kind: ms}).
  'ALTER TABLE users ADD COLUMN push_off INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN push_blocked INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN push_day TEXT',
  'ALTER TABLE users ADD COLUMN push_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN push_last INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE users ADD COLUMN push_sent TEXT NOT NULL DEFAULT '{}'",
  // Comeback gift (S.COMEBACK): when it was last given, and until when the longer income cap lasts.
  'ALTER TABLE users ADD COLUMN comeback_at INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN comeback_cap_until INTEGER NOT NULL DEFAULT 0',
  // Livery on the car's body (S.LIVERIES), NULL = none.
  'ALTER TABLE cars ADD COLUMN livery TEXT',
  // Progressive unlock (S.UNLOCKS): features a player keeps open below their level. Filled once, when the ladder
  // arrives, so nobody loses what they already used: level 5+ keeps everything; below that each feature with a trace
  // of use; upgrade and slots/roulette leave no trace, so they stay open from level 3 (crash/mines games count too).
  ["ALTER TABLE users ADD COLUMN feats TEXT NOT NULL DEFAULT '[]'",
    `UPDATE users SET feats = (SELECT json_group_array(k) FROM (
       SELECT 'parts' k WHERE users.level >= 5 OR users.merges > 0 OR EXISTS (SELECT 1 FROM parts WHERE user_id = users.id AND count > 0)
         OR EXISTS (SELECT 1 FROM car_parts cp JOIN cars c ON c.id = cp.car_id WHERE c.owner_id = users.id)
       UNION ALL SELECT 'drift' WHERE users.level >= 5 OR EXISTS (SELECT 1 FROM drift_runs WHERE user_id = users.id)
       UNION ALL SELECT 'plates' WHERE users.level >= 5 OR users.plate_best > 0 OR EXISTS (SELECT 1 FROM plates WHERE owner_id = users.id)
       UNION ALL SELECT 'paint' WHERE users.level >= 5 OR EXISTS (SELECT 1 FROM cars WHERE owner_id = users.id AND (paint IS NOT NULL OR livery IS NOT NULL))
       UNION ALL SELECT 'tradein' WHERE users.level >= 5 OR EXISTS (SELECT 1 FROM drops WHERE user_id = users.id AND case_id = 'tradein')
       UNION ALL SELECT 'market' WHERE users.level >= 5 OR EXISTS (SELECT 1 FROM listings WHERE seller_id = users.id)
         OR EXISTS (SELECT 1 FROM item_listings WHERE seller_id = users.id) OR EXISTS (SELECT 1 FROM item_sales WHERE seller_id = users.id OR buyer_id = users.id)
         OR EXISTS (SELECT 1 FROM dealer_buys WHERE user_id = users.id)
       UNION ALL SELECT 'pvp' WHERE users.level >= 5 OR EXISTS (SELECT 1 FROM pvp WHERE creator_id = users.id OR opponent_id = users.id)
       UNION ALL SELECT 'trades' WHERE users.level >= 5 OR EXISTS (SELECT 1 FROM trades WHERE from_id = users.id OR to_id = users.id)
         OR EXISTS (SELECT 1 FROM trade_rooms WHERE host_id = users.id OR guest_id = users.id)
       UNION ALL SELECT 'auction' WHERE users.level >= 5 OR EXISTS (SELECT 1 FROM auctions WHERE seller_id = users.id OR top_bidder = users.id)
       UNION ALL SELECT 'battles' WHERE users.level >= 5 OR EXISTS (SELECT 1 FROM battles WHERE creator_id = users.id OR opponent_id = users.id)
       UNION ALL SELECT 'upgrade' WHERE users.level >= 3
       UNION ALL SELECT 'casino' WHERE users.level >= 3 OR EXISTS (SELECT 1 FROM crash_games WHERE user_id = users.id)
         OR EXISTS (SELECT 1 FROM mines_games WHERE user_id = users.id)))`],
  // Dream car (S.dreamChances): the model the player is aiming for and when it was chosen (NULL = none yet).
  'ALTER TABLE users ADD COLUMN dream_car TEXT',
  'ALTER TABLE users ADD COLUMN dream_at INTEGER NOT NULL DEFAULT 0',
  // Car wash (S.WASH): dirt % at dirt_at (it grows by the hour from there), until when the car shines after a wash.
  // Cars already in the game start clean, with the clock running from the upgrade (dirt_at 0 would mean "no clock").
  'ALTER TABLE cars ADD COLUMN dirt REAL NOT NULL DEFAULT 0',
  ['ALTER TABLE cars ADD COLUMN dirt_at INTEGER NOT NULL DEFAULT 0',
    "UPDATE cars SET dirt_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000"],
  'ALTER TABLE cars ADD COLUMN shine_until INTEGER NOT NULL DEFAULT 0',
  // Free hand washes used on the Kyiv day wash_day.
  'ALTER TABLE users ADD COLUMN wash_day TEXT',
  'ALTER TABLE users ADD COLUMN wash_hand INTEGER NOT NULL DEFAULT 0',
  // The case a car came out of (S.ORIGIN_SELL: its instant-sale share); NULL for the cars from before, the dealer, rewards.
  'ALTER TABLE cars ADD COLUMN origin TEXT',
  // The serial number of a «тиражна» car (S.EDITION_CARS: «№ 007»); NULL for every other car.
  'ALTER TABLE cars ADD COLUMN serial INTEGER',
  // Car-case xp has its own daily cap (S.CASE_XP_CAP): the Kyiv day and how much of it is used.
  'ALTER TABLE users ADD COLUMN xp_case_day TEXT',
  'ALTER TABLE users ADD COLUMN xp_case_used INTEGER NOT NULL DEFAULT 0',
  // Reminder groups the player switched off (src/reminders.js PUSH_GROUPS ids, comma-separated).
  "ALTER TABLE users ADD COLUMN push_mute TEXT NOT NULL DEFAULT ''",
  // Owner 27.10: an admin can hide a player from the ratings (and the weekly prizes) and show him again.
  'ALTER TABLE users ADD COLUMN lb_hidden INTEGER NOT NULL DEFAULT 0',
  // «Мега-пропозиція» on hryvnia packs (S.PACK_OFFER): until when it runs and when the next one may start.
  'ALTER TABLE users ADD COLUMN pack_offer_until INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN pack_offer_next INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN fuel_deal_until INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN fuel_deal_next INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE users ADD COLUMN day_deal_day TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE users ADD COLUMN vip_sale_until INTEGER NOT NULL DEFAULT 0',
  // «Більший бак» (S.TANK_UPGRADES): steps of the shared tank bought for ₴, 0 = the plain S.FUEL_MAX.
  'ALTER TABLE users ADD COLUMN tank_lvl INTEGER NOT NULL DEFAULT 0',
  // Part cases: the tiers sold to the dealer right as they drop (S.TIERS ids, comma-separated; '' = none) and the
  // last opening (the S.PART_COOLDOWN_MS pause is counted from it).
  "ALTER TABLE users ADD COLUMN parts_autosell TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE users ADD COLUMN parts_open_at INTEGER NOT NULL DEFAULT 0',
  // Admin «Логи»: when a promo code was used and what it gave (NULL on uses from before — they stay out of the feed).
  'ALTER TABLE promo_uses ADD COLUMN at INTEGER',
  'ALTER TABLE promo_uses ADD COLUMN amount INTEGER',
  // «Обнулити прогрес»: when the player was last reset — achievements count PvP / battle wins and invited friends only
  // from then on (that history stays in its tables), so the tiers can't be claimed a second time.
  'ALTER TABLE users ADD COLUMN reset_at INTEGER NOT NULL DEFAULT 0',
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL + synchronous=NORMAL: commits don't wait for the disk (the database stays consistent after an app crash;
  // only a power cut could lose the last moments), which keeps many players' requests fast.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // An entry may be [alter, backfill]: the backfill runs only when the column was really added (once per database).
  for (const m of MIGRATIONS) {
    const [sql, backfill] = Array.isArray(m) ? m : [m];
    try {
      db.exec(sql);
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
      continue;
    }
    if (backfill) db.exec(backfill);
  }
  // Car history (owner 29.10: «пропала машина — подивись логи»): every car that leaves a garage, changes hands or goes
  // to the market / an auction / the showcase is written to car_log by triggers — whatever code path does it. The
  // reason comes from car_ctx (one row): game.js puts the API call or admin action there before running it.
  db.exec(`CREATE TABLE IF NOT EXISTS car_ctx (id INTEGER PRIMARY KEY CHECK (id = 1), reason TEXT, actor INTEGER, at INTEGER);
    INSERT OR IGNORE INTO car_ctx (id, reason, actor, at) VALUES (1, 'system', NULL, NULL);
    CREATE TABLE IF NOT EXISTS car_log (id INTEGER PRIMARY KEY AUTOINCREMENT, car_id INTEGER NOT NULL, model TEXT NOT NULL,
      from_uid INTEGER, to_uid INTEGER, status_from TEXT, status_to TEXT, kind TEXT NOT NULL, reason TEXT, actor INTEGER, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS car_log_from ON car_log(from_uid, id);
    CREATE INDEX IF NOT EXISTS car_log_to ON car_log(to_uid, id);
    CREATE INDEX IF NOT EXISTS car_log_car ON car_log(car_id, id);
    CREATE INDEX IF NOT EXISTS car_log_at ON car_log(at);
    CREATE INDEX IF NOT EXISTS promo_uses_at ON promo_uses(at);
    CREATE TRIGGER IF NOT EXISTS car_log_del AFTER DELETE ON cars BEGIN
      INSERT INTO car_log (car_id, model, from_uid, to_uid, status_from, status_to, kind, reason, actor, at)
      SELECT OLD.id, OLD.model, OLD.owner_id, NULL, OLD.status, NULL, 'gone', c.reason, c.actor,
        COALESCE(c.at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) FROM car_ctx c WHERE c.id = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS car_log_owner AFTER UPDATE OF owner_id ON cars WHEN OLD.owner_id IS NOT NEW.owner_id BEGIN
      INSERT INTO car_log (car_id, model, from_uid, to_uid, status_from, status_to, kind, reason, actor, at)
      SELECT NEW.id, NEW.model, OLD.owner_id, NEW.owner_id, OLD.status, NEW.status, 'moved', c.reason, c.actor,
        COALESCE(c.at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) FROM car_ctx c WHERE c.id = 1;
    END;
    CREATE TRIGGER IF NOT EXISTS car_log_status AFTER UPDATE OF status ON cars WHEN OLD.status IS NOT NEW.status AND OLD.owner_id IS NEW.owner_id BEGIN
      INSERT INTO car_log (car_id, model, from_uid, to_uid, status_from, status_to, kind, reason, actor, at)
      SELECT NEW.id, NEW.model, NEW.owner_id, NEW.owner_id, OLD.status, NEW.status, 'status', c.reason, c.actor,
        COALESCE(c.at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) FROM car_ctx c WHERE c.id = 1;
    END;`);
  const cache = new Map();
  db.q = (sql) => {
    let st = cache.get(sql);
    if (!st) cache.set(sql, (st = db.prepare(sql)));
    return st;
  };
  let depth = 0;
  db.tx = (fn) => {
    if (depth) return fn();
    depth++;
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      depth--;
    }
  };
  return db;
}
