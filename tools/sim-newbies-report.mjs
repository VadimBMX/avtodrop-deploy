// Merges runs of tools/sim-newbies.mjs (one JSON per seed) into medians and P10/P90 per persona.
//   node tools/sim-newbies-report.mjs <runs dir> [--vs <other runs dir>] [--json out.json]
// Without --vs: the full report (markdown on stdout). With --vs: a before → after table of the key numbers.
import fs from 'node:fs';
import path from 'node:path';
import * as S from '../public/shared.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const load = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('newbies-') && f.endsWith('.json')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f))).bots);
const q = (a, p) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const med = (a) => q(a, 0.5);
const share = (a, f) => (a.length ? a.filter(f).length / a.length : 0);
const money = (n) => (n == null ? '—' : S.short(Math.round(n)).replace(' ₴', ''));
const mins = (m) => (m == null ? '—' : m < 120 ? Math.round(m) + ' хв' : (m / 60).toFixed(1) + ' год');
const pct = (x) => Math.round(x * 100) + '%';
const tri = (a, f = money) => `${f(med(a))} (${f(q(a, 0.1))}–${f(q(a, 0.9))})`;
const RANK = ['D', 'C', 'B', 'A', 'S', 'X'];
const MARKS = [5, 30, 120, 300, 600, 1200];

function metrics(bots) {
  const per = {};
  for (const kind of [...new Set(bots.map((b) => b.kind))]) {
    const bs = bots.filter((b) => b.kind === kind);
    const m = { n: bs.length, marks: {}, days: {} };
    for (const k of MARKS) {
      const st = bs.map((b) => b.marks[k]).filter(Boolean);
      if (st.length < bs.length / 2) continue;
      m.marks[k] = { worth: st.map((s) => s.worth), bal: st.map((s) => s.balance), level: st.map((s) => s.level), cases: st.map((s) => s.cases),
        day: st.map((s) => s.day), A: share(st, (s) => RANK.indexOf(s.best) >= 3), B: share(st, (s) => RANK.indexOf(s.best) >= 2), S: share(st, (s) => RANK.indexOf(s.best) >= 4),
        newbie: st.map((s) => (s.newbie === 'done' ? 8 : s.newbie)) };
    }
    for (const d of [1, 2, 3, 5, 7]) {
      const st = bs.map((b) => b.days[d - 1]).filter(Boolean);
      if (!st.length) continue;
      m.days[d] = { worth: st.map((s) => s.worth), bal: st.map((s) => s.balance), level: st.map((s) => s.level), cases: st.map((s) => s.cases),
        biz: st.map((s) => s.biz), min: st.map((s) => s.min), A: share(st, (s) => RANK.indexOf(s.best) >= 3), S: share(st, (s) => RANK.indexOf(s.best) >= 4),
        flow: Object.fromEntries([...new Set(st.flatMap((s) => Object.keys(s.flow)))].map((c) => [c, st.reduce((a, s) => a + (s.flow[c] || 0), 0) / st.length])) };
    }
    m.firstA = bs.map((b) => b.firstCls.A?.min); m.firstAday = bs.map((b) => b.firstCls.A?.day); m.hasA = share(bs, (b) => b.firstCls.A);
    m.firstS = bs.map((b) => b.firstCls.S?.min); m.firstSday = bs.map((b) => b.firstCls.S?.day); m.hasS = share(bs, (b) => b.firstCls.S);
    m.newbieDone = bs.map((b) => b.newbieDone?.min); m.newbieDoneDay = bs.map((b) => b.newbieDone?.day); m.hasNewbie = share(bs, (b) => b.newbieDone);
    m.biz1 = bs.map((b) => b.biz[0]?.min); m.biz1day = bs.map((b) => b.biz[0]?.day); m.hasBiz = share(bs, (b) => b.biz.length); m.bizN = bs.map((b) => b.biz.length);
    m.idle = bs.map((b) => b.idle); m.empty = bs.map((b) => b.empty / b.sessions); m.emptyMax = bs.map((b) => b.emptyMax);
    m.broke = bs.map((b) => b.broke / b.sessions); m.brokeMax = bs.map((b) => b.brokeMax);
    m.capLost = bs.map((b) => b.capLostShare); m.levelCapped = bs.map((b) => b.capSessions / b.sessions); m.xpOver = bs.map((b) => b.xpOver);
    // Past the newbie hour: worth ×10 inside 60 minutes in the game from at least 2 млн (30-minute samples).
    const big = (b) => { const h = b.hourly, ev = []; for (let i = 0; i < h.length; i++) { if (h[i][2] < 2e6) continue; const j = h.findIndex((x, k) => k > i && x[0] - h[i][0] <= 60 && x[2] >= 10 * h[i][2]); if (j > 0) { ev.push(h[i][0]); i = j; } } return ev; };
    m.big = bs.map((b) => big(b).length); m.hasBig = share(bs, (b) => big(b).length); m.bigMin = bs.flatMap((b) => big(b));
    m.expl = bs.map((b) => b.explosions.length); m.hasExpl = share(bs, (b) => b.explosions.length);
    m.explMin = bs.flatMap((b) => b.explosions.map((e) => e.min)); m.explNewCls = share(bs.flatMap((b) => b.explosions), (e) => e.cls === 'new class');
    m.lagNewbie = bs.flatMap((b) => b.spend.filter((s) => s.kind === 'newbie').map((s) => s.lag));
    m.lagLevel = bs.flatMap((b) => b.spend.filter((s) => s.kind === 'level').map((s) => s.lag));
    m.lagNull = share(bs.flatMap((b) => b.spend), (s) => s.lag == null);
    m.play = med(bs.map((b) => b.play)); m.acted = med(bs.map((b) => b.acted));
    // Worth gained per hour in the game, hour by hour (from the 30-minute samples).
    const at = (b, mm) => { let v = null; for (const x of b.hourly) { if (x[0] <= mm) v = x[2]; else break; } return v; };
    m.perHour = [1, 2, 3, 5, 10, 20].map((h) => ({ h, gain: bs.map((b) => { const a = at(b, (h - 1) * 60), z = at(b, h * 60); return a != null && z != null && b.play >= h * 60 ? z - a : null; }) }));
    m.flowTotal = Object.fromEntries([...new Set(bs.flatMap((b) => Object.keys(b.flow)))].map((c) => [c, bs.reduce((a, b) => a + (b.flow[c] || 0), 0) / bs.length]));
    per[kind] = m;
  }
  return per;
}

function full(per) {
  const L = [];
  const p = (s = '') => L.push(s);
  const kinds = Object.keys(per);
  p(`# Newbies on the real engine — ${per[kinds[0]].n} bots per persona, medians (P10–P90)\n`);
  p('## Worth (cash + collection value of cars) by minutes in the game');
  p('| persona | ' + MARKS.map((k) => mins(k)).join(' | ') + ' |'); p('|' + '---|'.repeat(MARKS.length + 1));
  for (const k of kinds) p(`| ${k} | ` + MARKS.map((x) => (per[k].marks[x] ? tri(per[k].marks[x].worth) : '—')).join(' | ') + ' |');
  p('\n## Cash / level / cases / has A / «Перші кроки» step at those minutes (medians)');
  p('| persona | ' + MARKS.map((k) => mins(k)).join(' | ') + ' |'); p('|' + '---|'.repeat(MARKS.length + 1));
  for (const k of kinds) p(`| ${k} | ` + MARKS.map((x) => { const r = per[k].marks[x]; return r ? `${money(med(r.bal))} · L${med(r.level)} · ${med(r.cases)}к · A ${pct(r.A)} · step ${med(r.newbie)} · day ${med(r.day).toFixed(1)}` : '—'; }).join(' | ') + ' |');
  p('\n## Worth gained per hour in the game (median, hour N)');
  p('| persona | ' + per[kinds[0]].perHour.map((x) => 'h' + x.h).join(' | ') + ' |'); p('|' + '---|'.repeat(7));
  for (const k of kinds) p(`| ${k} | ` + per[k].perHour.map((x) => money(med(x.gain))).join(' | ') + ' |');
  p('\n## By day (end of the UTC day)');
  p('| persona | day | in game | cash | worth | level | cases | biz | has A | has S |'); p('|' + '---|'.repeat(10));
  for (const k of kinds) for (const d of [1, 3, 7]) { const r = per[k].days[d]; if (r) p(`| ${k} | ${d} | ${mins(med(r.min))} | ${tri(r.bal)} | ${tri(r.worth)} | ${med(r.level)} (${q(r.level, 0.1)}–${q(r.level, 0.9)}) | ${med(r.cases)} | ${med(r.biz)} | ${pct(r.A)} | ${pct(r.S)} |`); }
  p('\n## Milestones (minutes in the game; share of bots that got there in 7 days)');
  p('| persona | first A | first S | S reached | «Перші кроки» done | done | 1st business | biz bought | businesses at d7 |'); p('|' + '---|'.repeat(9));
  for (const k of kinds) { const m = per[k]; p(`| ${k} | ${mins(med(m.firstA))} (d${med(m.firstAday) ?? '—'}) ${pct(m.hasA)} | ${mins(med(m.firstS))} (d${med(m.firstSday) ?? '—'}) | ${pct(m.hasS)} | ${mins(med(m.newbieDone))} (d${med(m.newbieDoneDay) ?? '—'}) | ${pct(m.hasNewbie)} | ${mins(med(m.biz1))} (d${med(m.biz1day) ?? '—'}) | ${pct(m.hasBiz)} | ${med(m.bizN)} |`); }
  p('\n## Pain signals');
  p('| persona | idle share | empty sessions | max empty run | broke sessions | max broke run | garage income lost to the cap | sessions at the level cap | explosions ×10/1h (bots, med n) | ×10/1h from ≥2 млн (bots, at) | reward spent in (newbie / level, min) |'); p('|' + '---|'.repeat(11));
  for (const k of kinds) { const m = per[k]; p(`| ${k} | ${pct(med(m.idle))} | ${pct(med(m.empty))} | ${med(m.emptyMax)} | ${pct(med(m.broke))} | ${med(m.brokeMax)} (P90 ${q(m.brokeMax, 0.9)}) | ${pct(med(m.capLost))} (P90 ${pct(q(m.capLost, 0.9))}) | ${pct(med(m.levelCapped))} | ${pct(m.hasExpl)} · ${med(m.expl)} · at ${mins(med(m.explMin))} · new class ${pct(m.explNewCls)} | ${pct(m.hasBig)} · at ${mins(med(m.bigMin))} | ${med(m.lagNewbie) ?? '—'} / ${med(m.lagLevel) ?? '—'} |`); }
  p('\n## Money flow per bot (mean), day 1 / day 3 / day 7 / all 7 days');
  for (const k of kinds) {
    const m = per[k];
    const cats = Object.keys(m.flowTotal).sort((a, b) => m.flowTotal[b] - m.flowTotal[a]);
    p(`\n**${k}** — ` + cats.map((c) => `${c}: ${[1, 3, 7].map((d) => money(m.days[d]?.flow[c] || 0)).join(' / ')} / **${money(m.flowTotal[c])}**`).join('; '));
    const src = cats.filter((c) => m.flowTotal[c] > 0).reduce((a, c) => a + m.flowTotal[c], 0), sink = -cats.filter((c) => m.flowTotal[c] < 0).reduce((a, c) => a + m.flowTotal[c], 0);
    p(`  sources ${money(src)} · sinks ${money(sink)} · free sources (rewards+level+Перші кроки+keys) ${pct(['rewards', 'level rewards', 'Перші кроки', 'keys (free opens)', 'starter'].reduce((a, c) => a + Math.max(0, m.flowTotal[c] || 0), 0) / src)}`);
  }
  return L.join('\n');
}

const KEY = (m) => ({
  'worth 5 хв': med(m.marks[5]?.worth || []), 'worth 30 хв': med(m.marks[30]?.worth || []), 'worth 2 год': med(m.marks[120]?.worth || []),
  'cash 30 хв': med(m.marks[30]?.bal || []), 'worth d1': med(m.days[1]?.worth || []), 'worth d3': med(m.days[3]?.worth || []), 'worth d7': med(m.days[7]?.worth || []),
  'P90 worth d7': q(m.days[7]?.worth || [], 0.9), 'level d7': med(m.days[7]?.level || []), 'first S, хв': med(m.firstS), 'S by d7': m.hasS, 'biz by d7': m.hasBiz,
  'big expl': m.hasBig, idle: med(m.idle), 'broke sess': med(m.broke), 'cap lost': med(m.capLost), 'expl bots': m.hasExpl,
});
const A = opt('vs');
const dir = args.find((x) => !x.startsWith('--') && x !== A && x !== opt('json'));
const per = metrics(load(dir));
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(per));
if (!A) console.log(full(per));
else {
  const per2 = metrics(load(A));
  const fmt = (k, v) => (v == null ? '—' : /хв/.test(k) && !/worth|cash/.test(k) ? mins(v) : /S by|biz by|idle|broke|cap lost|expl/.test(k) ? pct(v) : /level/.test(k) ? String(v) : money(v));
  console.log(`# before (${dir}) → after (${A})\n`);
  const keys = Object.keys(KEY(per[Object.keys(per)[0]]));
  console.log('| persona | ' + keys.join(' | ') + ' |'); console.log('|' + '---|'.repeat(keys.length + 1));
  for (const k of Object.keys(per)) {
    if (!per2[k]) continue;
    const x = KEY(per[k]), y = KEY(per2[k]);
    console.log(`| ${k} | ` + keys.map((c) => `${fmt(c, x[c])} → ${fmt(c, y[c])}`).join(' | ') + ' |');
  }
}
