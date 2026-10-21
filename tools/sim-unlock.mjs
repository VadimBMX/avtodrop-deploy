// How fast a typical newcomer levels up, in minutes of active play, and when each S.UNLOCKS step opens for them.
//   node tools/sim-unlock.mjs [players=30] [sessions=8]
// The bot plays the real API (in-memory DB, faked clock) like a first-week player: starter case, newbie tasks in
// order, drag races until the tank is empty (easy rival, else training), daily bonus and tasks, the reward case, cheap
// cases it can easily afford (price ≤ ⅓ balance), and — once unlocked — a part case, an install, a merge and a plate.
// Each action adds the seconds it takes in the app (animation + taps + a little reading); sessions are 3 h apart
// (the tank refills ~9 races in that time). Prints the median active minutes to reach each level and the unlock ladder.
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { honestDrag } from '../test/race-helpers.js';

const P = Number(process.argv[2] || 30), SESSIONS = Number(process.argv[3] || 8);
const COST = { open: 15, keep: 4, collect: 4, claim: 4, parts: 10, install: 20, merge: 10, plate: 12, raceMenu: 15 };
const READ = 1.3; // reading / browsing overhead on top of the bare action time

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function newbie(seed, sessions = SESSIONS) {
  const R = lcg(seed * 7919 + 1);
  const t0 = Date.parse('2026-11-03T08:00:00Z');
  let t = t0, active = 0;
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, notify: () => {}, random: lcg(seed * 104729 + 3) });
  const id = 1000 + seed;
  g.ensureUser({ id, first_name: 'n' });
  const spend = (sec) => ((active += sec * READ), (t += sec * READ * 1000));
  const levelAt = {}, levelDay = {};
  const lvl = () => db.prepare('SELECT level FROM users WHERE id = ?').get(id).level;
  const bal = () => db.prepare('SELECT balance FROM users WHERE id = ?').get(id).balance;
  const note = () => {
    const l = lvl();
    for (let k = 2; k <= l; k++) (levelAt[k] ??= active / 60), (levelDay[k] ??= (t - t0) / 86400e3);
  };
  const call = (name, body = {}, sec = 0) => {
    try {
      const r = g.api[name](id, body);
      spend(sec);
      note();
      return r;
    } catch (e) {
      if (e?.constructor?.name !== 'GameError') throw e;
      return null;
    }
  };
  const cars = () => db.prepare("SELECT id, model FROM cars WHERE owner_id = ? AND status = 'garage' ORDER BY id").all(id);
  const claimAll = () => {
    const pl = call('pulse');
    for (const c of pl?.claims || []) {
      if (c.kind === 'daily') call('rewards/daily', {}, COST.claim);
      else if (c.kind === 'rcase') call('rewards/case', {}, COST.claim);
      else if (c.kind === 'newbie') call('newbie/claim', {}, COST.claim);
      else if (c.kind === 'quest') call('quests/claim', { key: c.id }, COST.claim);
      else if (c.kind === 'coll') call('collection/claim', { key: c.id }, COST.claim);
    }
  };
  const race = () => {
    const list = cars().sort((a, b) => S.MODELS[b.model].price - S.MODELS[a.model].price);
    for (const c of list.slice(0, 4)) {
      const rv = call('race/rivals', { carId: c.id });
      if (!rv) continue;
      let pick = rv.list.find((x) => x.id === 'easy');
      if (!pick || pick.entry > bal()) pick = rv.list.find((x) => x.id === 'train');
      const s = call('race/start', { carId: c.id, rival: pick.id }, COST.raceMenu);
      if (!s) continue;
      const reaction = Math.max(0.12, Math.min(0.8, 0.3 + (R() + R() + R() - 1.5) * 0.15));
      const wanted = Array.from({ length: S.SHIFTS }, () => (R() < 0.25 ? 'perfect' : R() < 0.7 ? 'good' : 'late'));
      const d = honestDrag(s.car, s.greenMs, reaction, wanted);
      spend(Math.ceil(d.ms) / 1000 / READ);
      call('race/finish', { raceId: s.raceId, ...d.body });
      return true;
    }
    return false;
  };
  const freeSlot = () => {
    const u = db.prepare('SELECT slots FROM users WHERE id = ?').get(id);
    const list = cars();
    if (list.length < u.slots) return true;
    const cheap = list.sort((a, b) => S.MODELS[a.model].price - S.MODELS[b.model].price)[0];
    return !!call('sell', { carIds: [cheap.id] }, COST.keep);
  };
  const tutorial = () => {
    call('parts/open', { caseId: 'scrap', type: 'body', count: 1 }, COST.parts);
    const inv = db.prepare('SELECT type, tier, count FROM parts WHERE user_id = ? AND count > 0').all(id);
    const c = cars().find((x) => !S.MODELS[x.model].ev);
    const part = inv.find((x) => S.partFits(c?.model, x.type));
    if (c && part) call('parts/install', { carId: c.id, type: part.type, tier: part.tier }, COST.install);
    call('plate/generate', { gen: 'basic' }, COST.plate);
    if (!db.prepare("SELECT 1 FROM parts WHERE user_id = ? AND count >= 3 AND tier <> 'race'").get(id)) call('parts/open', { caseId: 'scrap', type: 'body', count: 3 }, COST.parts);
    const m = db.prepare("SELECT type, tier FROM parts WHERE user_id = ? AND count >= 3 AND tier <> 'race'").get(id);
    if (m) call('parts/merge', m, COST.merge);
  };
  for (let s = 0; s < sessions; s++) {
    if (s === 0) {
      call('case/open', { caseId: 'starter' }, COST.open);
      spend(COST.keep);
    }
    claimAll();
    call('collect', {}, COST.collect);
    claimAll();
    tutorial();
    claimAll();
    for (let i = 0; i < 20 && race(); i++) if (i % 3 === 2) claimAll();
    claimAll();
    for (let i = 0; i < 3; i++) {
      const cs = S.CASES.filter((c) => !c.starter && !c.country && S.casePrice(c, '2026-11-03') <= bal() / 3).sort((a, b) => b.price - a.price)[0];
      if (!cs || !freeSlot() || !call('case/open', { caseId: cs.id }, COST.open + COST.keep)) break;
    }
    claimAll();
    t += 3 * 3600e3; // next session
  }
  return { levelAt, levelDay, level: lvl(), active: active / 60 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runs = Array.from({ length: P }, (_, i) => newbie(i + 1));
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)] : null);
  console.log(`${P} newcomers, ${SESSIONS} sessions 3 h apart; median active play ${med(runs.map((r) => r.active)).toFixed(0)} min, median end level ${med(runs.map((r) => r.level))}`);
  console.log('level | reached by | median active minutes | median day (sessions 3 h apart, round the clock) | opens');
  for (let l = 2; l <= 12; l++) {
    const hit = runs.map((r) => r.levelAt[l]).filter((x) => x != null);
    if (!hit.length) continue;
    const day = med(runs.map((r) => r.levelDay[l]).filter((x) => x != null));
    const opens = S.UNLOCKS ? S.UNLOCKS.filter((u) => u.level === l).map((u) => u.key).join(', ') : '';
    console.log(`${l} | ${hit.length}/${P} | ${med(hit).toFixed(0)} | ${day.toFixed(1)} | ${opens}`);
  }
}
