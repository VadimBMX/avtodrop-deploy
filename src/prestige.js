// «Престиж» on the server (rules: public/prestige.js). Two tables (src/db.js): car_restyle — a car's ★, when the last
// one was done and what was paid (it belongs to the car, so a trade or a market sale moves it with the car; a trigger
// drops the row when the car is gone), and trophies — the «Трофейна зала» items a player bought. Every purchase is a
// plain hryvnia payment (pay → money_days / money_src as 'prestige/restyle' and 'prestige/trophy'): no Stars, no keys.
import * as S from '../public/shared.js';
import * as P from '../public/prestige.js';

const OPEN_KEY = 'prestige-open';

export function createPrestige(ctx) {
  const { q, now, fail, pay, bank, ownCar, carChanged, userRow, restyleOf, name, styleOf } = ctx;
  const tell = (uid, text) => q('INSERT INTO events (user_id, text, created_at) VALUES (?, ?, ?)').run(uid, text, now());
  const trophyCount = (uid) => q('SELECT COUNT(*) n FROM trophies WHERE user_id = ?').get(uid).n;
  const ever = (uid) => !!q('SELECT 1 FROM claims WHERE user_id = ? AND key = ?').get(uid, OPEN_KEY);

  // Open now (level 10 + garage ≥ 500 млн) or opened before: stays open even if the garage shrinks later. The first
  // time it opens the player gets a line in «Сповіщення».
  function isOpen(uid, u = userRow(uid)) {
    if (ever(uid)) return true;
    if (!P.prestigeOpen({ level: u.level, value: u.total_value })) return false;
    q('INSERT OR IGNORE INTO claims (user_id, key) VALUES (?, ?)').run(uid, OPEN_KEY);
    tell(uid, '🏆 Відкрито «Престиж»: рестайлінг ★1–★5 для машин A, S і секретних (+3% доходу за ★) і «Трофейна зала». Меню → Престиж');
    return true;
  }
  function needOpen(uid) {
    if (!isOpen(uid)) fail(`«Престиж» відкривається з ${P.PRESTIGE.level} рівня, коли гараж коштує від ${S.short(P.PRESTIGE.garage)}`);
  }

  // ---------- «Рестайлінг» ----------
  function restyle(uid, { carId }) {
    needOpen(uid);
    const c = ownCar(uid, carId, ['garage', 'showcase']);
    if (!P.canRestyle(c.model)) fail('Рестайлінг — лише для машин класу A, S і секретних');
    const r = restyleOf(c.id) || { stars: 0, at: 0, spent: 0 };
    if (r.stars >= P.PRESTIGE.max) fail(`У цієї машини вже ${P.STAR}5 — максимум`);
    if (!P.starReady(r.at, now())) {
      const min = Math.ceil((P.nextStarAt(r.at) - now()) / 60e3);
      fail(`Майстерня ще працює над цією машиною: наступна ${P.STAR} через ${min >= 60 ? `${Math.floor(min / 60)} год ${min % 60} хв` : `${min} хв`}`);
    }
    const cost = P.restyleCost(c.model, r.stars);
    bank(uid); // the income up to now at the old rate; the new ★ earns from now on
    pay(uid, cost);
    const stars = r.stars + 1, t = now();
    q('INSERT INTO car_restyle (car_id, stars, at, spent) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET stars = excluded.stars, at = excluded.at, spent = car_restyle.spent + ?')
      .run(c.id, stars, t, cost, cost);
    carChanged(c.id); // open trade offers with this car showed it with fewer ★
    return { carId: c.id, model: c.model, stars, cost, nextAt: stars < P.PRESTIGE.max ? P.nextStarAt(t) : 0, bonus: P.starBonus(stars) };
  }
  // A restyled car can't be burned in an upgrade or a trade-in (its ★ would be lost for nothing); a sale is allowed
  // (the app warns), a trade or the market takes the ★ along.
  function noStars(carIds) {
    const ids = Array.isArray(carIds) ? carIds.map(Number).filter(Number.isFinite) : [];
    if (!ids.length) return;
    const r = q(`SELECT car_id FROM car_restyle WHERE stars > 0 AND car_id IN (${ids.map(() => '?').join(',')}) LIMIT 1`).get(...ids);
    if (r) fail(`Машина з ${P.STAR} рестайлінгу не йде в апгрейд чи трейд-ін — її ★ пропали б. Продай її або обміняй`);
  }

  // ---------- «Трофейна зала» ----------
  function trophyBuy(uid) {
    needOpen(uid);
    const k = trophyCount(uid);
    const t = P.TROPHIES[k];
    if (!t) fail('Трофейна зала заповнена — усі 10 трофеїв твої');
    pay(uid, t.cost);
    q('INSERT INTO trophies (user_id, k, cost, at) VALUES (?, ?, ?, ?)').run(uid, k, t.cost, now());
    const title = P.trophyTitle(k + 1);
    const fresh = title && P.TROPHY_TITLES.some((x) => x.n === k + 1);
    if (fresh) {
      q("INSERT INTO badges (user_id, key, title, tier, season, place, created_at) VALUES (?, 'prestige', ?, ?, NULL, NULL, ?) ON CONFLICT DO UPDATE SET title = excluded.title, tier = excluded.tier, created_at = excluded.created_at")
        .run(uid, title.title, title.tier, now());
      tell(uid, `🏆 Трофейна зала: ${k + 1} трофеїв — титул «${title.title}» у твоєму профілі`);
    }
    return { k, trophy: t, n: k + 1, title: fresh ? title.title : null };
  }

  // ---------- state ----------
  const restyleSpentOf = (uid) => q('SELECT COALESCE(SUM(r.spent), 0) n FROM car_restyle r JOIN cars c ON c.id = r.car_id WHERE c.owner_id = ?').get(uid).n;
  const trophySpentOf = (uid) => q('SELECT COALESCE(SUM(cost), 0) n FROM trophies WHERE user_id = ?').get(uid).n;
  // «Статок»: the garage's collection value + what is in its ★ + the trophies.
  const WEALTH = `SELECT u.id, u.total_value
      + COALESCE((SELECT SUM(t.cost) FROM trophies t WHERE t.user_id = u.id), 0)
      + COALESCE((SELECT SUM(r.spent) FROM car_restyle r JOIN cars c ON c.id = r.car_id WHERE c.owner_id = u.id), 0) score FROM users u`;
  function brief(uid) {
    const u = userRow(uid), n = trophyCount(uid);
    return { open: isOpen(uid, u), trophies: n, title: P.trophyTitle(n)?.title || null };
  }
  function state(uid) {
    const u = userRow(uid), open = isOpen(uid, u), n = trophyCount(uid);
    const cars = q("SELECT c.id, c.model, r.stars, r.at, r.spent FROM car_restyle r JOIN cars c ON c.id = r.car_id WHERE c.owner_id = ? AND r.stars > 0 ORDER BY r.stars DESC, r.spent DESC").all(uid);
    const restyleSpent = cars.reduce((s, c) => s + c.spent, 0), trophySpent = trophySpentOf(uid);
    return {
      open, need: { level: P.PRESTIGE.level, garage: P.PRESTIGE.garage }, level: u.level, value: u.total_value,
      trophies: q('SELECT k, cost, at FROM trophies WHERE user_id = ? ORDER BY k').all(uid), n,
      next: P.TROPHIES[n] ? { k: n, cost: P.TROPHIES[n].cost } : null,
      title: P.trophyTitle(n)?.title || null,
      restyled: cars.map((c) => ({ carId: c.id, model: c.model, stars: c.stars, nextAt: c.stars < P.PRESTIGE.max ? P.nextStarAt(c.at) : 0, spent: c.spent })),
      spent: { restyle: restyleSpent, trophies: trophySpent },
      wealth: u.total_value + restyleSpent + trophySpent,
      offer: P.firstOffer({ balance: u.balance, slots: u.slots, capLevel: u.cap_level }),
      now: now(),
    };
  }
  function board(uid) {
    const list = q(`${WEALTH} ORDER BY score DESC, id LIMIT 50`).all().map((r, i) => {
      const n = trophyCount(r.id);
      return { place: i + 1, id: r.id, name: name(r.id), score: r.score, me: r.id === uid, style: styleOf(r.id), trophies: n, title: P.trophyTitle(n)?.title || null };
    });
    const mine = q(`${WEALTH} WHERE u.id = ?`).get(uid)?.score || 0;
    const place = q(`SELECT COUNT(*) n FROM (${WEALTH}) w WHERE w.score > ? OR (w.score = ? AND w.id < ?)`).get(mine, mine, uid).n + 1;
    return { list, type: 'wealth', me: { place, score: mine } };
  }
  // For the player card: the trophies, the title and the best restyled car («Легенда: Ferrari F40 ★5»).
  function card(pid) {
    const n = trophyCount(pid);
    const best = q('SELECT c.model, r.stars FROM car_restyle r JOIN cars c ON c.id = r.car_id WHERE c.owner_id = ? AND r.stars > 0 ORDER BY r.stars DESC, r.spent DESC LIMIT 1').get(pid);
    return { trophies: n, title: P.trophyTitle(n)?.title || null, best: best ? { model: best.model, stars: best.stars } : null };
  }

  return {
    isOpen, brief, state, board, card, noStars, restyleSpentOf,
    api: { prestige: (uid) => state(uid), 'prestige/restyle': restyle, 'prestige/trophy': (uid) => trophyBuy(uid) },
  };
}
