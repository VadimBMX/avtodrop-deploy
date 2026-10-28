// «Таємний покупець» — the rules, shared by the server (src/buyer.js) and the app (public/buyer-ui.js).
// Once a Kyiv day (from the market's level) an NPC buyer asks for ONE model, or «any <country> car of class X», and pays
// the dealer's price plus a premium for one matching car from the garage. The offer lives BUYER.hours from the moment it
// appears (the player's first visit of the day).
//
// Not an exploit: the only way to farm it is to open cases until the asked car drops. For every case the premium on
// the asked car times its drop chance (what the offer adds to one open, on average) is capped:
//   · a case whose open-and-sell is under its price (counted with BUYER.safety for the hidden boost, luck and key
//     fragments, and at the «Кейс дня» discount) stays under it: the extra is at most BUYER.lossShare of what an open
//     loses on average;
//   · a case already at or above its price (owner 22.10: some dear cases > 1, that's OK) gets at most BUYER.abovePar of
//     its price per open — the buyer never is the reason to farm it.
// premCap() is the largest premium that keeps both for every case dropping the car; the offer takes min(roll, cap)
// and a request whose cap is under BUYER.minPrem is not offered at all (test/buyer.test.js checks every case).
import * as S from './shared.js';

export const BUYER = {
  feature: 'market', // opens with the market (S.UNLOCKS, level 2)
  hours: 3,
  prem: { own: [0.25, 0.4], reach: [0.3, 0.5], stretch: [0.45, 0.6] }, // premium rolls by kind of request
  minPrem: 0.15, // under this a request is not worth a card: another one is picked
  safety: 1.1, // open-and-sell × this (hidden boost, luck, losing-streak save, key fragments)
  lossShare: 0.8,
  abovePar: 0.01,
  remindMin: 60, // the bot nudge «покупець чекає ще 1 год» — when this little is left (src/reminders.js limits apply)
  kinds: [['own', 0.5], ['reach', 0.35], ['stretch', 0.15]],
  groupShare: 0.4, // a reach/stretch request asks for «class + country» instead of one model this often
};

export const CITIES = ['Одеси', 'Львова', 'Харкова', 'Дніпра', 'Києва', 'Ужгорода', 'Чернівців', 'Полтави', 'Вінниці', 'Запоріжжя', 'Луцька', 'Миколаєва', 'Тернополя', 'Івано-Франківська'];
// {w}: what he wants (a model name or «будь-яку німецьку машину класу B»).
export const LINES = [
  'Шукаю {w} для колекції — плачу більше за дилера.',
  'Клієнт хоче {w}. Готовий доплатити, але чекаю недовго.',
  'Потрібна {w} на зйомки. Гроші одразу.',
  'Збираю гараж мрії — бракує {w}.',
  'Беру {w} без торгу. Дилер стільки не дасть.',
  'Є покупець на {w} за кордоном. Доплачу за швидкість.',
];
const ADJ = { UA: 'українську чи радянську', JP: 'японську', DE: 'німецьку', IT: 'італійську', US: 'американську', GB: 'британську', FR: 'французьку',
  SE: 'шведську', KR: 'корейську', CZ: 'чеську', HR: 'хорватську', RO: 'румунську', CN: 'китайську' };

// Cars the buyer deals in: dealer-rate cars only (no secret, edition/R-version or collector car — they keep their rules).
export const buyable = (m) => !!m && !m.secret && !m.edition && !m.homeOnly && !m.restored && m.cls in S.SELL_RATES && m.cls !== 'X';
export const BUYABLE = S.ALL_MODELS.filter(buyable);
const BUYABLE_IDS = new Set(BUYABLE.map((m) => m.id));

// req: { model } or { cls, country }.
export function matches(req, modelId) {
  const m = S.MODELS[modelId];
  if (!req || !buyable(m) || !BUYABLE_IDS.has(m.id)) return false;
  return req.model ? m.id === req.model : m.cls === req.cls && m.country === req.country;
}
export const reqModels = (req) => BUYABLE.filter((m) => matches(req, m.id));
export const reqKey = (req) => (req.model ? req.model : `${req.cls}:${req.country}`);
export function reqText(req) {
  if (req.model) return S.MODELS[req.model]?.name || req.model;
  return `будь-яку ${ADJ[req.country] || S.COUNTRIES[req.country]?.name || req.country} машину класу ${req.cls}`;
}
// Groups the buyer can ask for: a class + a country with at least two buyable models.
export const GROUPS = (() => {
  const by = new Map();
  for (const m of BUYABLE) by.set(`${m.cls}:${m.country}`, (by.get(`${m.cls}:${m.country}`) || 0) + 1);
  return [...by].filter(([, n]) => n >= 2).map(([k]) => ({ cls: k.split(':')[0], country: k.split(':')[1] }));
})();

// ---------- the cap ----------
const CASES = S.CASES.filter((c) => !c.starter);
const share = new Map(CASES.map((cs) => [cs.id, S.effectiveWeights(cs)]));
// The chance that one open of `cs` drops a car matching `req`, and the average dealer price of such a drop.
export function dropOf(cs, req) {
  const sh = share.get(cs.id);
  let p = 0, sell = 0;
  for (const cls of Object.keys(cs.weights)) {
    const list = cs.pool(cls);
    if (!list.length || !sh[cls]) continue;
    const mw = S.modelWeights(list), sw = mw.reduce((a, b) => a + b, 0);
    list.forEach((m, i) => {
      if (!matches(req, m.id)) return;
      const pi = (sh[cls] * mw[i]) / sw;
      p += pi;
      sell += pi * S.sellPriceOf(m.id);
    });
  }
  return { p, sell: p ? sell / p : 0 };
}
// The cheapest a case can be (rarity cases have «Кейс дня» days) and what one open may gain from the buyer at most.
const lowPrice = (cs) => (cs.group === 'rarity' ? cs.price * (1 - S.CASE_OF_DAY.off) : cs.price);
export function allowedPerOpen(cs) {
  const price = lowPrice(cs), back = cs.sellEv * BUYER.safety;
  return back < price ? BUYER.lossShare * (price - back) : BUYER.abovePar * price;
}
const capCache = new Map();
export function premCap(req) {
  const k = reqKey(req);
  if (capCache.has(k)) return capCache.get(k);
  let cap = Infinity;
  for (const cs of CASES) {
    const d = dropOf(cs, req);
    if (d.p > 0 && d.sell > 0) cap = Math.min(cap, allowedPerOpen(cs) / (d.p * d.sell));
  }
  capCache.set(k, cap);
  return cap;
}
// The case where a car for `req` drops most often (a cheaper one on a near tie) — the card's hint when the garage has
// none. [] when no case drops it (dealer / market only).
const casesCache = new Map();
export function casesFor(req) {
  const k = reqKey(req);
  if (!casesCache.has(k)) {
    const list = CASES.map((cs) => ({ id: cs.id, p: dropOf(cs, req).p, price: cs.price })).filter((x) => x.p > 0);
    const top = Math.max(0, ...list.map((x) => x.p));
    casesCache.set(k, list.filter((x) => x.p >= top * 0.8).sort((a, b) => a.price - b.price).slice(0, 1).map((x) => x.id));
  }
  return casesCache.get(k);
}
// What the buyer pays for a car whose dealer price is `sell`: the dealer's price plus the premium.
export const payOf = (sell, prem) => Math.floor(sell * (1 + prem));

// ---------- the request of the day ----------
// rnd: a seeded generator (the server's HMAC of uid + day). ctx: { own: [model ids in the garage], balance }.
// Returns { kind, req, prem, city, line } — always an offer (falls back to a stretch model with room for a premium).
export function pickRequest(rnd, { own = [], balance = 0, canSell = true } = {}) {
  const roll = rnd();
  let acc = 0, kind = 'stretch';
  for (const [k, w] of BUYER.kinds) if (roll < (acc += w)) {
    kind = k;
    break;
  }
  const ownModels = [...new Set(own)].filter((id) => buyable(S.MODELS[id]));
  if (kind === 'own' && (!ownModels.length || !canSell)) kind = 'reach';
  const tryReq = (req, k) => {
    const [lo, hi] = BUYER.prem[k];
    const cap = premCap(req);
    const prem = Math.floor(Math.min(lo + (hi - lo) * rnd(), cap) * 100) / 100;
    return prem >= BUYER.minPrem ? { kind: k, req, prem } : null;
  };
  let out = null;
  if (kind === 'own') {
    // Dearer cars first in line, but any of them can come up.
    const list = [...ownModels].sort((a, b) => S.MODELS[b].price - S.MODELS[a].price || (a < b ? -1 : 1));
    for (let i = 0; i < 4 && !out; i++) out = tryReq({ model: list[Math.floor(rnd() * list.length)] }, 'own');
    if (!out) kind = 'reach';
  }
  if (!out) {
    // A case the player can pay for now (the cheapest one at least); a stretch looks one or two price steps up.
    const byPrice = [...CASES].sort((a, b) => a.price - b.price);
    let top = byPrice.filter((c) => c.price <= Math.max(balance, byPrice[0].price)).length - 1;
    if (kind === 'stretch') top = Math.min(byPrice.length - 1, top + 1 + Math.floor(rnd() * 2));
    for (let i = 0; i < 8 && !out; i++) {
      const cs = byPrice[Math.max(0, top - Math.floor(rnd() * Math.min(3, top + 1)))];
      const sh = share.get(cs.id);
      // A class by its real share (a stretch takes the rarest class of the case), a model by its drop weight.
      const classes = Object.keys(cs.weights).filter((c) => cs.pool(c).length);
      let cls = classes[0];
      if (kind === 'stretch') cls = classes[classes.length - 1];
      else {
        let r = rnd(), a = 0;
        for (const c of classes) if (r < (a += sh[c])) {
          cls = c;
          break;
        }
      }
      const list = cs.pool(cls).filter((m) => buyable(m));
      if (!list.length) continue;
      const mw = S.modelWeights(list), sw = mw.reduce((x, y) => x + y, 0);
      let r = rnd() * sw, m = list[0];
      for (let j = 0; j < list.length; j++) if ((r -= mw[j]) <= 0) {
        m = list[j];
        break;
      }
      const group = { cls: m.cls, country: m.country };
      const useGroup = rnd() < BUYER.groupShare && GROUPS.some((g) => g.cls === group.cls && g.country === group.country);
      out = tryReq(useGroup ? group : { model: m.id }, kind);
    }
  }
  if (!out) {
    // Fallback: the dearest buyable model with room (always exists: S-class hypercars drop rarely).
    const room = BUYABLE.filter((m) => premCap({ model: m.id }) >= BUYER.prem.stretch[0]);
    out = tryReq({ model: room[Math.floor(rnd() * room.length)].id }, 'stretch');
  }
  const city = CITIES[Math.floor(rnd() * CITIES.length)];
  const line = LINES[Math.floor(rnd() * LINES.length)].replace('{w}', reqText(out.req));
  return { ...out, city, line };
}
