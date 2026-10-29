// Admin «Логи» (public/admin-logs.js): «Стрічка подій» — one feed of what happens in the game, read from the tables
// that already keep it; «Входи гравців» — sessions; «Сервер» — server_log and the in-memory ring (src/serverlog.js).
// Read-only except for the sessions table (hit(), at most one write per player per SESSION_WRITE_MS) and the
// admin_log line of a CSV export.
//
// Cost of the feed on a big database: every source is one query over an indexed time column (src/db.js: drops_time,
// car_log_at, races_time, admin_log_time, …), bounded by the window and LIMIT per source; the merge is in JS (the
// same as a UNION ALL … ORDER BY t DESC LIMIT n, but each source keeps its own index). A type or text filter is
// applied after the merge, so a rare match may take several rounds — at most FEED_ROUNDS per page.
import * as S from '../public/shared.js';
import * as M from './metrics.js';
import { csvLine } from './admin-pc.js';

const HOUR = 3600e3, DAY = 86400e3;
export const FEED_PAGE = 100;
export const FEED_ROUNDS = 25;
export const FEED_EXPORT_CAP = 20000;
export const WINDOWS = { '1h': HOUR, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };
export const SESSION_GAP_MS = M.SESSION_GAP_MS; // 30 min without a call ends a session
export const SESSION_WRITE_MS = 60e3; // last_at moves at most once a minute per player
export const SESSION_KEEP_DAYS = 30;
export const SESSION_PAGE = 100;

// Types of the feed (the chips). Colours and icons for the page live in public/admin-logs.js.
export const FEED_TYPES = {
  signup: 'Реєстрації', drop: 'Кейси', sell: 'Продаж дилеру', car: 'Рух авто', trade: 'Обміни', market: 'Ринок', auction: 'Аукціони',
  pay: 'Оплати ⭐', promo: 'Промокоди', gift: 'Подарунки', support: 'Підтримка', race: 'Гонки', battle: 'Батли й PvP',
  container: 'Причал', invite: 'Запрошення', admin: 'Дії адмінів',
};
const STATUS = { garage: 'гараж', showcase: 'вітрина', market: 'ринок', auction: 'аукціон', battle: 'батл', pvp: 'PvP', trade: 'обмін', room: 'кімната обміну', club: 'клуб', tourney: 'турнір', container: 'Причал' };
// What the reason in car_log (the API call or admin action that moved a car) means, for the common ones.
const REASONS = {
  sell: 'продано дилеру', 'buyer/sell': 'продано таємному покупцю', upgrade: 'апгрейд (злиття)', 'market/buy': 'купівля на ринку', 'market/sell': 'виставлено на ринок',
  'market/cancel': 'знято з ринку', 'auction/create': 'на аукціон', 'auction/cancel': 'знято з аукціону', 'trade/accept': 'обмін', 'room/ready': 'кімната обміну',
  'battle/create': 'батл', 'battle/join': 'батл', 'pvp/create': 'PvP', 'pvp/accept': 'PvP', tradein: 'трейд-ін', system: 'система', 'showcase/set': 'вітрина',
  'auction-settle': 'аукціон завершено',
};
const SELL_REASONS = new Set(['sell', 'buyer/sell']);
// admin_log actions in words (the panel's own list in public/admin.js ACTIONS is longer; the rest show as they are)
const ADMIN_ACTIONS = {
  money: 'гроші', 'give-car': 'видав авто', 'remove-car': 'вилучив авто', part: 'деталі', keys: 'ключі', set: 'параметр', ban: 'бан', unban: 'розбан',
  reset: 'обнулив', 'give-plate': 'видав номер', 'remove-plate': 'забрав номер', message: 'повідомлення', 'market-remove': 'зняв лот', promo: 'промокод',
  'promo-delete': 'видалив промокод', support: 'відповідь підтримки', role: 'права', luck: 'підкрутка', rig: 'гарантована машина', broadcast: 'розсилка',
  'casino-mode': 'режим казино', 'db-browse': 'перегляд бази', 'db-export': 'експорт бази', 'logs-export': 'експорт логів', 'bug-reward': 'нагорода за баг',
  'event-start': 'запуск події', 'event-stop': 'зупинка події', 'lb-hide': 'приховав з рейтингу', 'lb-show': 'повернув у рейтинг',
};
const modelName = (id) => S.MODELS[id]?.name || id || '?';
const caseName = (id) => S.CASE_BY_ID[id]?.name || S.PART_CASE_BY_ID[id]?.name || id;
const partName = (type, tier) => `${S.PARTS[type]?.name || type} · ${S.TIER_BY_ID[tier]?.name || tier}`;
const cut = (s, n = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const reasonText = (r) => {
  if (!r) return '';
  if (REASONS[r]) return REASONS[r];
  const a = /^admin:([a-z/-]+)/.exec(r);
  return a ? `адмін: ${a[1]}` : r;
};
function itemValue(caseId, item) {
  if (String(item).includes(':')) return S.TIER_BY_ID[String(item).split(':')[1]]?.price || 0;
  return S.MODELS[item]?.price || 0;
}
function itemName(item) {
  if (String(item).includes(':')) {
    const [type, tier] = String(item).split(':');
    return partName(type, tier);
  }
  return modelName(item);
}
const json = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export function createLogs({ db, q, now, int, fail, name, adminName, kyivOffset, serverLog, alog }) {
  // ---------- the feed's sources ----------
  // Each: the types it can produce, its query (time column t; :uid conditions as `user`), and how a row reads.
  // SQL gets (since, before, [uid…], limit); every row has t and a unique k.
  const SOURCES = [
    { id: 'u', types: ['signup'], user: 'id = ?', n: 1,
      sql: (w) => `SELECT id, referrer_id, start_param, created_at t FROM users WHERE id > 0 AND created_at >= ? AND created_at <= ? ${w} ORDER BY created_at DESC LIMIT ?`,
      row: (r) => ({ type: 'signup', uid: r.id, other: r.referrer_id || null, text: `Новий гравець${r.referrer_id ? ' за запрошенням' : ''}${r.start_param ? ` · мітка ${r.start_param}` : ''}` }) },
    { id: 'd', types: ['drop'], user: 'user_id = ?', n: 1,
      sql: (w) => `SELECT id, user_id, case_id, item, cls, forced, created_at t FROM drops WHERE created_at >= ? AND created_at <= ? ${w} ORDER BY created_at DESC LIMIT ?`,
      row: (r) => ({ type: 'drop', uid: r.user_id, text: `Відкрив «${caseName(r.case_id)}» → ${itemName(r.item)} (${r.cls})${r.forced ? ' · гарантована' : ''}`, amount: itemValue(r.case_id, r.item), cur: '₴' }) },
    { id: 'c', types: ['sell', 'car'], user: '(from_uid = ? OR to_uid = ?)', n: 2,
      sql: (w) => `SELECT id, model, from_uid, to_uid, status_from, status_to, kind, reason, at t FROM car_log WHERE at >= ? AND at <= ? ${w} ORDER BY at DESC LIMIT ?`,
      row: (r) => {
        const m = modelName(r.model), why = reasonText(r.reason);
        if (r.kind === 'gone' && SELL_REASONS.has(r.reason)) {
          const md = S.MODELS[r.model];
          return { type: 'sell', uid: r.from_uid, text: `Продав «${m}» ${r.reason === 'sell' ? 'дилеру' : 'таємному покупцю'}`, amount: md && !md.secret ? Math.floor(md.price * (S.SELL_RATES[md.cls] || 0)) : null, cur: '₴', approx: true };
        }
        if (r.kind === 'gone') return { type: 'car', uid: r.from_uid, text: `«${m}» зникло з гаража${why ? ` · ${why}` : ''}` };
        if (r.kind === 'moved') return { type: 'car', uid: r.from_uid, other: r.to_uid, text: `«${m}» перейшло іншому гравцю${why ? ` · ${why}` : ''}` };
        return { type: 'car', uid: r.from_uid, text: `«${m}»: ${STATUS[r.status_from] || r.status_from || '?'} → ${STATUS[r.status_to] || r.status_to || '?'}${why ? ` · ${why}` : ''}` };
      } },
    { id: 't', types: ['trade'], user: '(from_id = ? OR to_id = ?)', n: 2,
      sql: (w) => `SELECT id, from_id, to_id, give_money, get_money, status, updated_at t FROM trades WHERE updated_at >= ? AND updated_at <= ? ${w} ORDER BY updated_at DESC LIMIT ?`,
      row: (r) => ({ type: 'trade', uid: r.from_id, other: r.to_id,
        text: `${{ open: 'Запропонував обмін', done: 'Обмін завершено', cancelled: 'Обмін скасовано', invalid: 'Обмін став недійсним', declined: 'Обмін відхилено' }[r.status] || `Обмін: ${r.status}`}${r.give_money ? ` · віддає ${S.short(r.give_money)}` : ''}${r.get_money ? ` · просить ${S.short(r.get_money)}` : ''}` }) },
    { id: 'tr', types: ['trade'], user: '(host_id = ? OR guest_id = ?)', n: 2,
      sql: (w) => `SELECT id, host_id, guest_id, host_money, guest_money, status, updated_at t FROM trade_rooms WHERE status IN ('done', 'closed') AND updated_at >= ? AND updated_at <= ? ${w} ORDER BY updated_at DESC LIMIT ?`,
      row: (r) => ({ type: 'trade', uid: r.host_id, other: r.guest_id || null,
        text: `Кімната обміну #${r.id}: ${r.status === 'done' ? 'угоду укладено' : 'закрита'}${r.status === 'done' && (r.host_money || r.guest_money) ? ` · гривні ${S.short(r.host_money)} / ${S.short(r.guest_money)}` : ''}` }) },
    { id: 'l', types: ['market'], user: 'l.seller_id = ?', n: 1,
      sql: (w) => `SELECT l.id, l.seller_id, l.price, c.model, l.created_at t FROM listings l LEFT JOIN cars c ON c.id = l.car_id WHERE l.created_at >= ? AND l.created_at <= ? ${w} ORDER BY l.created_at DESC LIMIT ?`,
      row: (r) => ({ type: 'market', uid: r.seller_id, text: `Виставив «${modelName(r.model)}» на ринок`, amount: r.price, cur: '₴' }) },
    { id: 'il', types: ['market'], user: 'seller_id = ?', n: 1,
      sql: (w) => `SELECT id, seller_id, kind, part_type, part_tier, item_key, count, price, created_at t FROM item_listings WHERE created_at >= ? AND created_at <= ? ${w} ORDER BY created_at DESC LIMIT ?`,
      row: (r) => ({ type: 'market', uid: r.seller_id, text: `Виставив лот: ${r.kind === 'part' ? `${partName(r.part_type, r.part_tier)} × ${r.count}` : `номер (${String(r.item_key).split(':')[1] || '?'})`}`, amount: r.price, cur: '₴' }) },
    { id: 'is', types: ['market'], user: '(seller_id = ? OR buyer_id = ?)', n: 2,
      sql: (w) => `SELECT id, seller_id, buyer_id, kind, part_type, part_tier, plate_text, count, price, fee, created_at t FROM item_sales WHERE created_at >= ? AND created_at <= ? ${w} ORDER BY created_at DESC LIMIT ?`,
      row: (r) => ({ type: 'market', uid: r.seller_id, other: r.buyer_id, text: `Продав на ринку: ${r.kind === 'part' ? `${partName(r.part_type, r.part_tier)} × ${r.count}` : `номер ${r.plate_text || ''}`} · комісія ${S.short(r.fee)}`, amount: r.price, cur: '₴' }) },
    { id: 'a', types: ['auction'], user: '(a.seller_id = ? OR a.top_bidder = ?)', n: 2,
      sql: (w) => `SELECT a.id, a.seller_id, a.top_bidder, a.start_price, a.top_bid, a.bids, a.status, c.model, a.created_at t FROM auctions a LEFT JOIN cars c ON c.id = a.car_id WHERE a.created_at >= ? AND a.created_at <= ? ${w} ORDER BY a.created_at DESC LIMIT ?`,
      row: (r) => ({ type: 'auction', uid: r.seller_id, other: r.top_bidder || null,
        text: `Аукціон${r.model ? ` «${modelName(r.model)}»` : ` #${r.id}`}: старт ${S.short(r.start_price)} · ${r.bids} ставок · ${{ open: 'триває', done: 'завершено', cancelled: 'скасовано' }[r.status] || r.status}`, amount: r.top_bid || r.start_price, cur: '₴' }) },
    { id: 'p', types: ['pay'], user: 'user_id = ?', n: 1,
      sql: (w) => `SELECT charge_id, user_id, pack, stars, amount, created_at t FROM payments WHERE charge_id NOT LIKE 'legacy:%' AND created_at >= ? AND created_at <= ? ${w} ORDER BY created_at DESC LIMIT ?`,
      key: (r) => r.charge_id,
      row: (r) => {
        const p = String(r.pack);
        const text = p.startsWith('refund:') ? `Повернення зірок: ${p.slice(7)}` : p.startsWith('renew:') ? `Продовження підписки: ${p.slice(6)}` : p.startsWith('item:') ? `Купив за зірки: ${p.slice(5)}` : `Купив пакет ${p}${r.amount ? ` (+${S.short(r.amount)})` : ''}`;
        return { type: 'pay', uid: r.user_id, text, amount: p.startsWith('refund:') ? -r.stars : r.stars, cur: '⭐' };
      } },
    { id: 'pr', types: ['promo'], user: 'user_id = ?', n: 1,
      sql: (w) => `SELECT rowid id, code, user_id, amount, at t FROM promo_uses WHERE at >= ? AND at <= ? ${w} ORDER BY at DESC LIMIT ?`,
      row: (r) => ({ type: 'promo', uid: r.user_id, text: `Промокод ${r.code}`, amount: r.amount, cur: '₴' }) },
    // Broadcast messages are one gift row per player (thousands at one moment): they are in «Дії адмінів» instead.
    { id: 'g', types: ['gift'], user: 'user_id = ?', n: 1,
      sql: (w) => `SELECT id, user_id, kind, data, note, created_at t FROM gifts WHERE kind <> 'message' AND created_at >= ? AND created_at <= ? ${w} ORDER BY created_at DESC LIMIT ?`,
      row: (r) => {
        const d = json(r.data) || {};
        const what = { ref: 'бонус за запрошення', comeback: 'подарунок за повернення', money: 'гривні від адміна', car: 'авто від адміна', keys: 'ключі від адміна', part: 'деталь від адміна',
          plate: 'номер від адміна', bug: 'нагорода за баг', secret: 'секретне авто', thanks: 'подяка донатеру' }[r.kind] || r.kind;
        const extra = d.model ? ` · ${modelName(d.model)}` : d.caseId ? ` · ${caseName(d.caseId)}${d.count ? ` × ${d.count}` : ''}` : '';
        return { type: 'gift', uid: r.user_id, text: `Подарунок: ${what}${extra}${r.note ? ` · «${cut(r.note, 80)}»` : ''}`, amount: Number(d.money ?? d.amount) || null, cur: '₴' };
      } },
    { id: 's', types: ['support'], user: 'user_id = ?', n: 1,
      sql: (w) => `SELECT id, user_id, text, answered_at, created_at t FROM support WHERE created_at >= ? AND created_at <= ? ${w} ORDER BY created_at DESC LIMIT ?`,
      row: (r) => ({ type: 'support', uid: r.user_id, text: `Звернення #${r.id}: «${cut(r.text, 120)}»${r.answered_at ? ' · є відповідь' : ''}` }) },
    { id: 'r', types: ['race'], user: 'user_id = ?', n: 1,
      sql: (w) => `SELECT id, user_id, entry, prize, json_extract(result, '$.win') win, json_extract(result, '$.time') time, created_at t FROM races WHERE status = 'done' AND created_at >= ? AND created_at <= ? ${w} ORDER BY created_at DESC LIMIT ?`,
      row: (r) => ({ type: 'race', uid: r.user_id, text: `Драг-заїзд: ${r.win ? 'перемога' : 'поразка'}${r.time != null ? ` · ${Number(r.time).toFixed(3)} с` : ''}${r.entry ? ` · внесок ${S.short(r.entry)}` : ''}`, amount: r.win ? r.prize : r.entry ? -r.entry : null, cur: '₴' }) },
    { id: 'v', types: ['battle'], user: '(creator_id = ? OR opponent_id = ?)', n: 2,
      sql: (w) => `SELECT id, creator_id, opponent_id, winner_id, bet, finished_at t FROM pvp WHERE status = 'done' AND finished_at >= ? AND finished_at <= ? ${w} ORDER BY finished_at DESC LIMIT ?`,
      row: (r) => ({ type: 'battle', uid: r.creator_id, other: r.opponent_id, text: `PvP-заїзд: ${r.winner_id ? `переміг ${name(r.winner_id)}` : 'нічия'}`, amount: r.bet, cur: '₴' }) },
    { id: 'b', types: ['battle'], user: '(creator_id = ? OR opponent_id = ?)', n: 2,
      sql: (w) => `SELECT id, creator_id, opponent_id, winner_id, case_id, count, price, status, finished_at t FROM battles WHERE finished_at >= ? AND finished_at <= ? ${w} ORDER BY finished_at DESC LIMIT ?`,
      row: (r) => ({ type: 'battle', uid: r.creator_id, other: r.opponent_id || null, text: `Кейс-батл «${caseName(r.case_id)}» × ${r.count}: ${r.status === 'cancelled' ? 'скасовано' : r.winner_id ? `переміг ${name(r.winner_id)}` : 'нічия'}`, amount: r.price * r.count, cur: '₴' }) },
    { id: 'cb', types: ['container'], user: 'bidder = ?', n: 1,
      sql: (w) => `SELECT rowid id, lot_id, bidder, amount, at t FROM container_bids WHERE bidder > 0 AND amount > 0 AND at >= ? AND at <= ? ${w} ORDER BY at DESC LIMIT ?`,
      row: (r) => ({ type: 'container', uid: r.bidder, text: `Ставка на лот Причалу #${r.lot_id}`, amount: r.amount, cur: '₴' }) },
    { id: 'cl', types: ['container'], user: 'top_bidder = ?', n: 1,
      sql: (w) => `SELECT id, tier, top_bidder, top_bid, model, settled_at t FROM container_lots WHERE status = 'done' AND top_bidder > 0 AND settled_at >= ? AND settled_at <= ? ${w} ORDER BY settled_at DESC LIMIT ?`,
      row: (r) => ({ type: 'container', uid: r.top_bidder, text: `Виграв лот Причалу #${r.id} (${r.tier}) → ${modelName(r.model)}`, amount: r.top_bid, cur: '₴' }) },
    // invite_log keeps only the last minute (it is the anti-spam window of trade / race invites).
    { id: 'iv', types: ['invite'], user: '(from_id = ? OR to_id = ?)', n: 2,
      sql: (w) => `SELECT rowid id, from_id, to_id, at t FROM invite_log WHERE at >= ? AND at <= ? ${w} ORDER BY at DESC LIMIT ?`,
      row: (r) => ({ type: 'invite', uid: r.from_id, other: r.to_id, text: 'Запросив гравця (обмін / заїзд)' }) },
    { id: 'al', types: ['admin'], user: 'target = ?', n: 1,
      sql: (w) => `SELECT id, admin, action, target, details, created_at t FROM admin_log WHERE created_at >= ? AND created_at <= ? ${w} ORDER BY created_at DESC LIMIT ?`,
      row: (r) => {
        const d = json(r.details) || {};
        const bits = [d.amount != null ? `${d.amount >= 0 ? '+' : ''}${S.short(d.amount)}` : '', d.model ? modelName(d.model) : '', d.code || '', d.table || '', d.text ? `«${cut(d.text, 70)}»` : '', d.reason ? `причина: ${cut(d.reason, 70)}` : ''].filter(Boolean);
        return { type: 'admin', uid: r.target || null, admin: adminName(r.admin), text: `${adminName(r.admin)}: ${ADMIN_ACTIONS[r.action] || r.action}${bits.length ? ` · ${bits.join(' · ')}` : ''}`, amount: typeof d.amount === 'number' ? d.amount : null, cur: '₴' };
      } },
  ];

  function resolvePlayer(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (/^\d{1,16}$/.test(s)) return Number(s);
    const u = q('SELECT id FROM users WHERE lower(username) = lower(?)').get(s.replace(/^@/, '').slice(0, 64));
    if (!u) fail('Гравця не знайдено');
    return u.id;
  }
  function filterOf(b = {}) {
    const span = WINDOWS[b.window] ? WINDOWS[b.window] : DAY;
    const types = new Set((Array.isArray(b.types) ? b.types : []).map(String).filter((t) => Object.hasOwn(FEED_TYPES, t)));
    return { window: WINDOWS[b.window] ? b.window : '24h', span, uid: resolvePlayer(b.player), types, text: String(b.q ?? '').trim().toLowerCase().slice(0, 100) };
  }
  // cursor "t~k1,k2": continue at time t, skipping the rows already shown at exactly that millisecond
  function cursorOf(c, t0) {
    const m = /^(\d{1,16})~([\w:,.-]{0,4000})$/.exec(String(c ?? ''));
    return m ? { t: Number(m[1]), skip: new Set(m[2] ? m[2].split(',') : []) } : { t: t0, skip: new Set() };
  }
  const cursorStr = (c) => `${c.t}~${[...c.skip].join(',')}`;

  // One page (need rows) of the feed after cursor; names filled in.
  function collect(b, need, rounds) {
    const f = filterOf(b), t = now(), since = t - f.span;
    const srcs = SOURCES.filter((s) => !f.types.size || s.types.some((x) => f.types.has(x)));
    let cur = cursorOf(b.cursor, t);
    const out = [];
    let more = true;
    const names = new Map();
    const nm = (id) => {
      if (id == null) return null;
      if (!names.has(id)) names.set(id, name(id));
      return names.get(id);
    };
    for (let round = 0; round < rounds && out.length < need; round++) {
      const per = Math.min(2000, Math.max(need - out.length, 20)) + cur.skip.size;
      const rows = [];
      let full = false;
      for (const s of srcs) {
        const args = [since, cur.t];
        if (f.uid != null) for (let i = 0; i < s.n; i++) args.push(f.uid);
        const list = q(s.sql(f.uid != null ? `AND ${s.user}` : '')).all(...args, per);
        if (list.length >= per) full = true;
        for (const r of list) rows.push({ r, s, t: r.t, k: `${s.id}${s.key ? s.key(r) : r.id}`.replace(/[^\w:.-]/g, '') });
      }
      rows.sort((a, b2) => b2.t - a.t || (a.k < b2.k ? -1 : a.k > b2.k ? 1 : 0));
      const fresh = rows.filter((x) => !(x.t === cur.t && cur.skip.has(x.k)));
      // Only the first `per` rows are known to be complete (a source that hit its limit may have more just below).
      const take = full ? fresh.slice(0, per - cur.skip.size) : fresh;
      if (!take.length) {
        more = false;
        break;
      }
      for (const x of take) {
        if (x.t !== cur.t) cur = { t: x.t, skip: new Set() };
        cur.skip.add(x.k);
        const e = x.s.row(x.r);
        if (f.types.size && !f.types.has(e.type)) continue;
        const ev = { k: x.k, t: x.t, type: e.type, uid: e.uid ?? null, name: nm(e.uid ?? null), other: e.other ?? null, otherName: nm(e.other ?? null), text: e.text,
          amount: e.amount ?? null, cur: e.amount != null ? e.cur || '₴' : null, approx: !!e.approx };
        if (f.text && !`${ev.text} ${ev.name || ''} ${ev.otherName || ''} ${ev.uid ?? ''}`.toLowerCase().includes(f.text)) continue;
        out.push(ev);
        if (out.length >= need) break;
      }
      if (!full && out.length < need && take.length === fresh.length) {
        more = false;
        break;
      }
    }
    return { f, list: out, cursor: more ? cursorStr(cur) : null, more };
  }
  function feed(b = {}) {
    const r = collect(b, FEED_PAGE, FEED_ROUNDS);
    return { list: r.list, cursor: r.cursor, more: r.more, window: r.f.window, player: r.f.uid, types: FEED_TYPES, now: now() };
  }
  function feedCsv(who, b = {}) {
    const r = collect({ ...b, cursor: null }, FEED_EXPORT_CAP + 1, 30);
    const list = r.list.slice(0, FEED_EXPORT_CAP);
    const head = ['time_utc', 'type', 'player_id', 'player', 'event', 'amount', 'currency', 'counterpart_id', 'counterpart'];
    const lines = [csvLine(head), ...list.map((e) => csvLine([new Date(e.t).toISOString(), FEED_TYPES[e.type] || e.type, e.uid, e.name, e.text, e.amount, e.cur, e.other, e.otherName]))];
    alog(who, 'logs-export', null, { window: r.f.window, player: r.f.uid, types: [...r.f.types], q: r.f.text || null, rows: list.length, truncated: r.list.length > FEED_EXPORT_CAP });
    return { n: list.length, truncated: r.list.length > FEED_EXPORT_CAP, csv: lines.join('\r\n') + '\r\n' };
  }

  // ---------- sessions ----------
  // uid → { id, w: last_at written, seen: last call } — the throttle; refilled from the table after a restart.
  const live = new Map();
  function hit(uid, source) {
    const t = now();
    let s = live.get(uid);
    if (!s) {
      const r = q('SELECT id, last_at FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 1').get(uid);
      if (r) s = { id: r.id, w: r.last_at, seen: r.last_at };
    }
    if (s && t - s.seen <= SESSION_GAP_MS && t >= s.seen) {
      s.seen = t;
      let wrote = false;
      if (t - s.w >= SESSION_WRITE_MS) {
        q('UPDATE sessions SET last_at = ? WHERE id = ?').run(t, s.id);
        s.w = t;
        wrote = true;
      }
      live.set(uid, s);
      return { id: s.id, fresh: false, wrote };
    }
    const src = M.cleanStartParam(source);
    const id = Number(q('INSERT INTO sessions (user_id, started_at, last_at, source) VALUES (?, ?, ?, ?)').run(uid, t, t, src).lastInsertRowid);
    if (live.size > 50000) live.clear();
    live.set(uid, { id, w: t, seen: t });
    return { id, fresh: true, wrote: true };
  }
  const tagNote = (src) => {
    const tag = M.startTag(src || '');
    return M.TAG_NOTES[tag] || '';
  };
  function dayStart(t) {
    const off = kyivOffset(t);
    return Math.floor((t + off) / DAY) * DAY - off;
  }
  function sessions(b = {}) {
    const t = now(), t0 = dayStart(t);
    const uid = resolvePlayer(b.player);
    const src = b.source == null || b.source === '' ? undefined : b.source === '-' ? null : M.cleanStartParam(b.source) ?? '\u0000';
    const offset = Math.max(0, Math.min(1e6, Math.floor(Number(b.offset) || 0)));
    const w = ['started_at >= ?'], a = [t - SESSION_KEEP_DAYS * DAY];
    if (uid != null) (w.push('user_id = ?'), a.push(uid));
    if (src === null) w.push('source IS NULL');
    else if (src !== undefined) (w.push('source = ?'), a.push(src));
    const list = q(`SELECT id, user_id, started_at, last_at, source FROM sessions WHERE ${w.join(' AND ')} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...a, SESSION_PAGE + 1, offset)
      .map((r) => ({ id: r.id, uid: r.user_id, name: name(r.user_id), start: r.started_at, last: r.last_at, ms: r.last_at - r.started_at, live: t - r.last_at < 3 * 60e3, source: r.source, note: tagNote(r.source) }));
    const today = q('SELECT COUNT(*) n, COUNT(DISTINCT user_id) u, AVG(last_at - started_at) avg FROM sessions WHERE started_at >= ?').get(t0);
    const top = q('SELECT source, COUNT(*) n, COUNT(DISTINCT user_id) u FROM sessions WHERE started_at >= ? GROUP BY source ORDER BY n DESC LIMIT 8').all(t0)
      .map((r) => ({ source: r.source, n: r.n, u: r.u, note: tagNote(r.source) }));
    const sources = q('SELECT source, COUNT(*) n FROM sessions WHERE started_at >= ? GROUP BY source ORDER BY n DESC LIMIT 60').all(t - SESSION_KEEP_DAYS * DAY).map((r) => ({ source: r.source, n: r.n }));
    // Sessions started per Kyiv hour today (the little chart).
    const off = kyivOffset(t), hours = new Array(24).fill(0);
    for (const r of q('SELECT (CAST((started_at + ?) / 3600000 AS INTEGER) % 24) h, COUNT(*) n FROM sessions WHERE started_at >= ? GROUP BY h').all(off, t0)) hours[r.h] = r.n;
    return {
      list: list.slice(0, SESSION_PAGE), more: list.length > SESSION_PAGE, offset, pageSize: SESSION_PAGE, now: t,
      today: { sessions: today.n, players: today.u, avgMs: Math.round(today.avg || 0), top, hours }, sources, gapMin: SESSION_GAP_MS / 60e3,
    };
  }

  // ---------- server ----------
  function server(b = {}) {
    const level = ['warn', 'error'].includes(b.level) ? b.level : 'all';
    const r = serverLog.query({ level, q: b.q, before: b.before });
    return { ...r, level, counts: serverLog.counts(), startedAt: serverLog.startedAt, ring: { size: serverLog.size(), max: serverLog.ringSize }, now: now() };
  }

  let prunedAt = 0;
  function prune(force = false) {
    const t = now();
    if (!force && t - prunedAt < HOUR) return 0;
    prunedAt = t;
    const n = q('DELETE FROM sessions WHERE started_at < ?').run(t - SESSION_KEEP_DAYS * DAY).changes;
    return n + serverLog.prune(true);
  }
  return { feed, feedCsv, hit, sessions, server, prune, SOURCES };
}
