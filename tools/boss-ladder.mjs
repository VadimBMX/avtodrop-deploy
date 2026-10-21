// Career audit: for every boss (S.BOSSES) its car, pace, class window and the odds a driver has against it in typical
// cars of the window — the median and the fastest-quartile model of the lowest class (stock and with the class's usual
// kit), the fastest-quartile model of the highest class with its kit, for a country final the best car of that country
// in the window — plus the final test car (Ferrari SF90 Stradale with a Race kit: «—» where the window keeps it out)
// and «Реванш · складний» (S.bossHard) for the top car of the window. Odds as the server's race math scores them
// (humanRun + oddsVs). Usage: node tools/boss-ladder.mjs
import * as S from '../public/shared.js';

const kitOf = (model, tier) => (tier ? Object.fromEntries(S.partKeysOf(model).map((k) => [k, tier])) : {});
const KIT = { D: 'street', C: 'sport', B: 'pro', A: 'pro', S: 'race', X: 'race' };
const regular = S.ALL_MODELS.filter((m) => !m.secret);
const pace = (m) => S.carStats({ model: m.id }).base;
const byPace = (cls, f = () => true) => regular.filter((m) => m.cls === cls && f(m)).sort((a, b) => pace(a) - pace(b));
const pick = (cls, q, f) => { const l = byPace(cls, f); return l.length ? l[Math.round((1 - q) * (l.length - 1))] : null; };
const sf90 = S.ALL_MODELS.find((m) => m.name === 'Ferrari SF90 Stradale').id;
const odds = (car, b, d = S.DRIVERS.good) => Math.round(S.oddsVs(S.driverTimes(S.carStats(car), d), S.bossOffsets(b), b.base) * 100);
const pct = (x) => (x == null ? '  —' : String(x).padStart(3) + '%');
const topCls = (b) => (b.max === 'X' ? 'S' : b.max);

console.log('Odds: good driver (perfect driver in brackets). min med/top = median / fastest-quartile model of the lowest class of the window;');
console.log('max top+kit = fastest-quartile model of the highest class with its kit (D Street, C Sport, B/A Pro, S Race); own = best car of the country in the window (+kit).\n');
console.log(['#', 'boss', 'car', 'kit', 'driver', 'base', 'hp', 'window', 'min med', 'min med+kit', 'min top', 'min top+kit', 'max top+kit', 'own best+kit', 'SF90 Race', 'hard: kit·driver·base', 'hard vs max top+kit', 'reward'].join(' | '));
let sfWins = 0, sfFits = 0;
for (const b of S.BOSSES) {
  const fit = (m) => S.bossFits(b, m.id);
  const lo = b.req, hi = topCls(b);
  const med = pick(lo, 0.5, fit), top = pick(lo, 0.75, fit), mtop = pick(hi, 0.75, fit);
  const withKit = (m) => (m ? { model: m.id, parts: kitOf(m.id, KIT[m.cls]) } : null);
  const o = (car) => (car ? odds(car, b) : null);
  let own = '';
  if (b.own) {
    const best = regular.filter(fit).map((m) => ({ m, t: S.carStats(withKit(m)).base })).sort((x, y) => x.t - y.t)[0];
    own = best ? `${best.m.name} ${pct(o(withKit(best.m)))} (${odds(withKit(best.m), b, S.DRIVERS.perfect)}%)` : 'нема';
  }
  const sfOk = S.bossFits(b, sf90), sf = { model: sf90, parts: kitOf(sf90, 'race') };
  const sfOdds = sfOk ? o(sf) : null;
  if (sfOk) (sfFits++, sfOdds >= 90 && sfWins++);
  const h = S.bossHard(b);
  console.log([b.n + 1, `${b.country} ${b.nick}`, S.MODELS[b.model].name, b.kit || '—', S.BOSS_AI[b.ai].name, b.base.toFixed(3), b.hp, S.bossWindowText(b) + (b.own ? ' +країна' : ''),
    pct(o(med && { model: med.id })), pct(o(withKit(med))), pct(o(top && { model: top.id })), pct(o(withKit(top))), pct(o(withKit(mtop))), own || '—',
    sfOk ? `${pct(sfOdds)} (${odds(sf, b, S.DRIVERS.perfect)}%)` : '  —', `${h.kit}·${S.BOSS_AI[h.ai].name}·${h.base.toFixed(3)}`,
    mtop ? `${pct(odds(withKit(mtop), h))} (${odds(withKit(mtop), h, S.DRIVERS.perfect)}%)` : '—', S.bossRewardText(b.reward)].join(' | '));
}
console.log(`\nSF90 Race fits ${sfFits} of ${S.BOSSES.length} bosses and wins ≥90% against ${sfWins} (before the class windows: every boss fitted it).`);
console.log('Reference cars:', ['D', 'C', 'B', 'A', 'S'].map((c) => `${c} med ${pick(c, 0.5).name}, top ${pick(c, 0.75).name}`).join('; '));
console.log('One-time money, whole ladder:', S.short(S.BOSSES.reduce((s, b) => s + b.reward.money, 0)));
