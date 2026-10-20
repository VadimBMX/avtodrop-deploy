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
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
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
CREATE TABLE IF NOT EXISTS invite_log (from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS invite_log_from ON invite_log(from_id, at);
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
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT NOT NULL, action TEXT NOT NULL, target INTEGER, details TEXT, created_at INTEGER NOT NULL
);
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
  // Stars on the account (season prizes), spent in the shop; VIP end time; garage slots bought for stars; starter pack.
  'ALTER TABLE users ADD COLUMN stars INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN vip_until INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN star_slots INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN starter_bought INTEGER NOT NULL DEFAULT 0',
  // Paint id (S.PAINTS) or NULL for the original colour.
  'ALTER TABLE cars ADD COLUMN paint TEXT',
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL + synchronous=NORMAL: commits don't wait for the disk (the database stays consistent after an app crash;
  // only a power cut could lose the last moments), which keeps many players' requests fast.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  for (const sql of MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  }
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
