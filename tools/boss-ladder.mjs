// Career audit: for every boss (S.BOSSES) its car, pace and the odds a driver has against it in typical cars of the
// required class — the median and the fastest-quartile model, stock and with the class's usual kit — plus the final
// test car (Ferrari SF90 Stradale with a Race kit). Odds as the server's race math scores them (humanRun + oddsVs).
// Usage: node tools/boss-ladder.mjs
import * as S from '../public/shared.js';

const kitOf = (model, tier) => (tier ? Object.fromEntries(S.partKeysOf(model).map((k) => [k, tier])) : {});
const KIT = { D: 'street', C: 'sport', B: 'pro', A: 'pro', S: 'race' };
const regular = S.ALL_MODELS.filter((m) => !m.secret);
const byPace = (cls) => regular.filter((m) => m.cls === cls).sort((a, b) => S.carStats({ model: a.id }).base - S.carStats({ model: b.id }).base);
const pick = (cls, q) => { const l = byPace(cls); return l[Math.round((1 - q) * (l.length - 1))]; };
const sf90 = S.ALL_MODELS.find((m) => m.name === 'Ferrari SF90 Stradale').id;
const odds = (car, b, d = S.DRIVERS.good) => Math.round(S.oddsVs(S.driverTimes(S.carStats(car), d), S.bossOffsets(b), b.base) * 100);
const pct = (x) => String(x).padStart(3) + '%';

console.log('Odds: good driver (perfect driver in brackets). med/top = median / fastest-quartile model of the required class; +kit = full kit of the class tier (D Street, C Sport, B/A Pro, S Race).\n');
console.log(['#', 'boss', 'car', 'kit', 'driver', 'base', 'hp', 'req', 'med', 'med+kit', 'top', 'top+kit', 'SF90 Race', 'reward'].join(' | '));
for (const b of S.BOSSES) {
  const med = pick(b.req, 0.5), top = pick(b.req, 0.75);
  const k = KIT[b.req];
  const sf = { model: sf90, parts: kitOf(sf90, 'race') };
  const tk = { model: top.id, parts: kitOf(top.id, k) };
  console.log([b.n + 1, `${b.country} ${b.nick}`, S.MODELS[b.model].name, b.kit || '—', S.BOSS_AI[b.ai].name, b.base.toFixed(3), b.hp, b.req,
    pct(odds({ model: med.id }, b)), pct(odds({ model: med.id, parts: kitOf(med.id, k) }, b)), pct(odds({ model: top.id }, b)),
    `${pct(odds(tk, b))} (${odds(tk, b, S.DRIVERS.perfect)}%)`, `${pct(odds(sf, b))} (${odds(sf, b, S.DRIVERS.perfect)}%)`, S.bossRewardText(b.reward)].join(' | '));
}
console.log('\nReference cars:', ['D', 'C', 'B', 'A', 'S'].map((c) => `${c} med ${pick(c, 0.5).name}, top ${pick(c, 0.75).name}`).join('; '));
console.log('One-time money, whole ladder:', S.short(S.BOSSES.reduce((s, b) => s + b.reward.money, 0)));
