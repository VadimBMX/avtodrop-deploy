#!/usr/bin/env node
// Перевірка запуску Сезону 2 (лише читання): node tools/s2-check.mjs <бекап-до-обнулення.db> <жива база.db>
// На VM (копія бекапу, яку може прочитати користувач гри): sudo -u avtodrop node /opt/avtodrop/tools/s2-check.mjs /tmp/s2-prewipe.db /data/avtodrop.db
// Порівнює базу після обнулення (src/season2.js) з бекапом, зробленим перед ним: компенсація кожного гравця (кредит
// = витрачені Stars × pct, рамки, «Ветеран», ключі за друзів), призові зірки S1 (раз), повернення за касу (раз),
// номери з аукціону з власниками, сироти, дублікати після рестартів, кредит = сума журналу. Гравці можуть уже грати:
// рівні / баланси перевіряються лише як «скинуто» для тих, хто ще нічого не робив (warn, не fail).
// Код виходу 0 = усе гаразд, 1 = є FAIL. Нічого не пише в бази.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../public/shared.js';

export function checkSeason2(prePath, livePath) {
  const pre = new DatabaseSync(prePath, { readOnly: true }), d = new DatabaseSync(livePath, { readOnly: true });
  const all = (db, s, ...a) => db.prepare(s).all(...a), get = (db, s, ...a) => db.prepare(s).get(...a);
  const R = S.S2_RESET, out = [], fails = [];
  const ok = (cond, msg, extra) => (cond ? out.push(`ok    ${msg}`) : (fails.push(msg), out.push(`FAIL  ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : ''}`)));
  const warn = (cond, msg) => out.push(`${cond ? 'ok   ' : 'warn '} ${msg}`);
  const meta = (k) => get(d, 'SELECT value FROM meta WHERE key = ?', k)?.value;
  try {
    ok(!get(pre, "SELECT 1 FROM meta WHERE key = 'season_reset_s2'"), 'бекап зроблено ДО обнулення');
    const at = Number(meta('season_reset_s2')) || 0;
    ok(at > 0, 'обнулення виконано (meta season_reset_s2)');
    if (!at) return { ok: false, lines: out, fails };
    ok(!!meta('s1_prize_restore_done') && !!meta('s1_auction_plates_restore'), 'прапорці призових зірок і номерів стоять');
    warn(!!meta('cap_refund_1'), `прапорець повернення за касу${meta('cap_refund_1') ? '' : ' — з’явиться після першого рестарту'}`);

    const preU = new Map(all(pre, 'SELECT id, level, stars, banned FROM users WHERE id > 0').map((u) => [u.id, u]));
    const arc = new Map(all(d, 'SELECT * FROM s1_archive').map((r) => [r.user_id, r]));
    ok(arc.size === preU.size && [...preU.keys()].every((id) => arc.has(id)), `архів S1: ${arc.size} гравців (у бекапі ${preU.size})`);

    const spent = new Map(all(pre, `SELECT user_id, SUM(stars) n FROM payments WHERE stars > 0 AND pack NOT LIKE 'refund:%' AND charge_id NOT LIKE 'legacy:%'
      GROUP BY user_id`).map((r) => [r.user_id, r.n]));
    const friends = new Map(all(pre, 'SELECT referrer_id id, COUNT(*) n FROM users WHERE ref_paid = 1 AND referrer_id IS NOT NULL GROUP BY referrer_id').map((r) => [r.id, r.n]));
    const log = new Map(all(d, 'SELECT user_id || \'|\' || what k, SUM(delta) s, COUNT(*) c FROM star_credit_log GROUP BY user_id, what').map((r) => [r.k, r]));
    const comp = `s${R.prevSeason}-comp`, prize = `s${R.prevSeason}-prize`;
    const bad = { credit: [], vet: [], keys: [], frames: [], prize: [] };
    let credUsers = 0, credTotal = 0, prizeUsers = 0, prizeTotal = 0;
    for (const [id, u] of preU) {
      const a = arc.get(id);
      if (!a) continue;
      const credit = Math.floor(((spent.get(id) || 0) * R.creditPct) / 100), l = log.get(`${id}|${comp}`);
      if (a.credit !== credit || (credit > 0 ? !l || l.s !== credit || l.c !== 1 : !!l)) bad.credit.push(id);
      if (credit > 0) (credUsers++, (credTotal += credit));
      const vet = S.veteranTierOf(u.level), b = get(d, 'SELECT tier FROM badges WHERE user_id = ? AND key = ?', id, S.VETERAN_S1.key);
      if (!!vet !== !!b || (vet && b.tier !== vet.tier)) bad.vet.push(id);
      if (a.keys !== Math.min(R.friendKeysMax, friends.get(id) || 0)) bad.keys.push(id);
      const want = JSON.parse(a.frames || '[]');
      const have = new Set(all(d, 'SELECT frame FROM user_frames WHERE user_id = ?', id).map((r) => r.frame));
      if (!want.every((f) => have.has(f)) || ((spent.get(id) || 0) > 0 && !want.includes('patron'))) bad.frames.push(id);
      const p = log.get(`${id}|${prize}`);
      if (u.stars > 0 ? !p || p.s !== u.stars || p.c !== 1 : !!p) bad.prize.push(id);
      if (u.stars > 0) (prizeUsers++, (prizeTotal += u.stars));
    }
    ok(!bad.credit.length, `кредит ⭐: ${credUsers} гравців, ${credTotal} ⭐ (= витрачені Stars × ${R.creditPct}%), по одному запису`, bad.credit.slice(0, 10));
    ok(!bad.prize.length, `призові зірки S1: ${prizeUsers} гравців, ${prizeTotal} ⭐, рівно раз`, bad.prize.slice(0, 10));
    ok(!bad.vet.length, `значок «${S.VETERAN_S1.title}»: ${get(d, 'SELECT COUNT(*) n FROM badges WHERE key = ?', S.VETERAN_S1.key).n}`, bad.vet.slice(0, 10));
    ok(!bad.keys.length, `ключі «${S.CASE_BY_ID[R.friendKey].name}» за друзів: ${[...arc.values()].reduce((s, a) => s + a.keys, 0)} у ${[...arc.values()].filter((a) => a.keys).length} гравців`, bad.keys.slice(0, 10));
    ok(!bad.frames.length, `рамки: ${get(d, 'SELECT COUNT(*) n FROM user_frames').n}`, bad.frames.slice(0, 10));
    const cb = all(d, 'SELECT u.id FROM users u WHERE u.star_credit <> COALESCE((SELECT SUM(delta) FROM star_credit_log l WHERE l.user_id = u.id), 0)');
    ok(!cb.length, 'кредит у кожного = сума його журналу (star_credit_log)', cb.slice(0, 10));

    const refunds = all(d, "SELECT target, COUNT(*) c FROM admin_log WHERE action = 'cap-refund' GROUP BY target");
    ok(refunds.every((r) => r.c === 1), `повернення за касу: ${refunds.length} гравців, кожному раз`);

    const kept = all(pre, `SELECT id, owner_id, text FROM plates WHERE text IN (SELECT text FROM plate_auctions WHERE status = 'done' AND top_bidder IS NOT NULL
      AND plate_id IS NOT NULL)`);
    const lost = kept.filter((p) => !get(d, 'SELECT 1 FROM plates WHERE id = ? AND owner_id = ? AND text = ?', p.id, p.owner_id, p.text));
    warn(!lost.length, `номери з аукціону: ${kept.length - lost.length} з ${kept.length} у своїх власників${lost.length ? ' (решту могли продати вже після старту)' : ''}`);

    const orphans = {
      cars: get(d, 'SELECT COUNT(*) n FROM cars c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.owner_id) AND c.owner_id <> 0').n,
      car_parts: get(d, 'SELECT COUNT(*) n FROM car_parts p WHERE NOT EXISTS (SELECT 1 FROM cars c WHERE c.id = p.car_id)').n,
      plates: get(d, 'SELECT COUNT(*) n FROM plates p WHERE (car_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cars c WHERE c.id = p.car_id)) OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.owner_id)').n,
      listings: get(d, 'SELECT COUNT(*) n FROM listings l WHERE NOT EXISTS (SELECT 1 FROM cars c WHERE c.id = l.car_id)').n,
      business: get(d, 'SELECT COUNT(*) n FROM user_business WHERE bought_at < ?', at).n,
    };
    ok(Object.values(orphans).every((n) => !n), 'сиріт немає (машини, деталі, номери, лоти, бізнеси з Сезону 1)', orphans);
    const dup = {
      events: all(d, "SELECT user_id FROM events WHERE created_at >= ? AND (text LIKE '🏁 Сезон ' || ? || ' стартував%' OR text LIKE '⭐ Повернули%') GROUP BY user_id, substr(text, 1, 12) HAVING COUNT(*) > 1", at, R.season).length,
      reset: get(d, "SELECT COUNT(*) n FROM admin_log WHERE action = 'season2-reset'").n,
      prizeLog: get(d, "SELECT COUNT(*) n FROM admin_log WHERE action = 's1-prize-restore'").n,
    };
    ok(dup.events === 0 && dup.reset === 1 && dup.prizeLog === 1, 'нічого не задубльовано після рестартів', dup);

    const fresh = all(d, `SELECT u.id, u.level, u.balance, u.stars FROM users u WHERE u.id > 0 AND NOT EXISTS (SELECT 1 FROM drops x WHERE x.user_id = u.id AND x.created_at >= ?)
      AND u.created_at < ?`, at, at);
    const notReset = fresh.filter((u) => u.level !== 1 || u.stars !== 0);
    warn(!notReset.length, `скинуто: рівень 1, зірки 0 у ${fresh.length - notReset.length} з ${fresh.length} гравців, що ще не грали в Сезоні ${R.season}`);
    const startMoney = fresh.filter((u) => u.balance === S.START_BALANCE).length;
    warn(true, `стартові гроші ${S.fmt(S.START_BALANCE)} у ${startMoney} з ${fresh.length} (інші могли вже забрати касу / подарунок)`);
    return { ok: !fails.length, lines: out, fails };
  } finally {
    pre.close();
    d.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [prePath, livePath] = process.argv.slice(2);
  if (!prePath || !livePath) {
    console.error('Використання: node tools/s2-check.mjs <бекап-до-обнулення.db> <жива база.db>');
    process.exit(2);
  }
  const r = checkSeason2(prePath, livePath);
  console.log(r.lines.join('\n'));
  console.log(r.ok ? '\nУСЕ ГАРАЗД' : `\nПРОБЛЕМИ: ${r.fails.length}`);
  process.exit(r.ok ? 0 : 1);
}
