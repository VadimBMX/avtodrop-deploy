// How fast open-and-sell grows money: P players each start with `start`× the case price, open the case up to N times
// (a free key first when there is one), sell every drop at once, and stop when they can't pay. Real API, normal day
// (no case of the day, no case event). Prints the median / p10 / p90 end balance and the share that went broke.
//   node tools/sim-loop.mjs [opens=100] [players=40] [start=10] [caseId,caseId...]
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { findTime } from './sim-events.mjs';

const N = Number(process.argv[2] || 100), P = Number(process.argv[3] || 40), START = Number(process.argv[4] || 10);
const ONLY = process.argv[5] ? process.argv[5].split(',') : null;
const pct = (a, k) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(k * (a.length - 1) + 0.5))];
const f = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' млрд' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : (n / 1e3).toFixed(0) + 'k');

export function loop(cs, seed) {
  let t = findTime((fx, date) => fx.topMult === 1 && !fx.countries.includes(cs.country) && S.caseOfDay(date) !== cs.id);
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => t, notify: () => {} });
  g.ensureUser({ id: 1, first_name: 'x' });
  db.prepare('UPDATE users SET balance = ?, slots = 40, level = 50, server_seed = ?, client_seed = ? WHERE id = 1').run(cs.price * START, `loop:${seed}:${cs.id}`, 'loop');
  g.giveCar(1, 'zaz-lanos');
  const bal = () => db.prepare('SELECT balance FROM users WHERE id = 1').get().balance;
  let opens = 0;
  for (; opens < N; opens++) {
    const keys = db.prepare('SELECT count FROM keys WHERE user_id = 1 AND case_id = ?').get(cs.id)?.count || 0;
    if (!keys && bal() < cs.price) break;
    const r = g.api['case/open'](1, { caseId: cs.id });
    g.api.sell(1, { carIds: r.results.map((x) => x.car.id) });
    t += 1000;
  }
  return { end: bal(), opens };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`start ${START}× price, up to ${N} opens, ${P} players, sell every drop`);
  console.log('case | price | start | median end | p10 | p90 | median end / start | broke before the end');
  for (const cs of S.CASES.filter((c) => !c.starter && (!ONLY || ONLY.includes(c.id)))) {
    const rs = Array.from({ length: P }, (_, i) => loop(cs, i));
    const ends = rs.map((r) => r.end), start = cs.price * START;
    console.log([cs.id, f(cs.price), f(start), f(pct(ends, 0.5)), f(pct(ends, 0.1)), f(pct(ends, 0.9)), (pct(ends, 0.5) / start).toFixed(2) + '×', Math.round((rs.filter((r) => r.opens < N).length / P) * 100) + '%'].join(' | '));
  }
}
