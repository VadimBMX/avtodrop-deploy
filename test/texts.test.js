// Texts pass (wText 2026-10-29, Season 2 story 2026-11-03): the «Що нового» slides say what the rules say, they are shown
// once per player (any device), and the house style holds — one apostrophe (’), «драг», «пальне».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { BIZ } from '../public/business.js';
import { welcomeLines } from '../public/season2-ui.js';

const slide = (title) => S.WHATS_NEW.slides.find((s) => s.title.startsWith(title));

test('«Що нового»: the Season 2 «Місто» story — 5–7 slides, icons that exist, short texts', () => {
  assert.ok(!['economy-2', 'autumn-2026'].includes(S.WHATS_NEW.id), 'a new id, so everyone sees it once');
  assert.deepEqual(S.WHATS_NEW.slides.map((s) => s.title.split(' ·')[0]),
    ['Сезон 2', 'Мапа міста', 'Бізнеси', 'Покращення бізнесу', 'Компенсація', 'Пропуск', 'Новий вигляд']);
  assert.ok(S.WHATS_NEW.slides.length >= 5 && S.WHATS_NEW.slides.length <= 7);
  const svg = fs.readFileSync(new URL('../public/icons.svg', import.meta.url), 'utf8');
  for (const s of S.WHATS_NEW.slides) {
    assert.ok(svg.includes(`id="i-${s.icon}"`), s.icon);
    assert.ok(s.text.length <= 190, `${s.title}: ${s.text.length}`);
    assert.ok(s.tag && s.tag.length <= 26, s.title);
    assert.match(s.c, /^#[0-9a-f]{6}$/i);
    assert.doesNotMatch(s.title + s.text + s.tag, /Хеллов|гарбуз|осінн/i, `${s.title}: stale wording`);
  }
});

test('«Що нового»: the numbers match the rules', () => {
  // the businesses: names, the first level, the box hours — from BIZ, whatever the rebalance sets
  const bz = slide('Бізнеси');
  assert.equal(bz.tag, `з ${Math.min(...BIZ.list.map((b) => b.level))}-го рівня`);
  for (const b of BIZ.list) assert.ok(bz.text.toLowerCase().includes(b.short.toLowerCase()), b.short);
  assert.ok(bz.text.includes(`${BIZ.capHours} год`) && bz.text.includes(`з VIP — ${BIZ.vipCapHours}`));
  const up = slide('Покращення бізнесу');
  for (const k of ['eq', 'staff', 'ads']) assert.ok(up.text.includes(`«${BIZ.branches[k].name}»`), k);
  // the compensation: what the wipe really gives
  const c = slide('Компенсація');
  assert.ok(c.text.startsWith(`${S.S2_RESET.creditPct}% зірок`));
  assert.ok(c.text.includes(`«${S.FRAME_BY_ID.patron.name}»`) && c.text.includes(`«${S.FRAME_BY_ID.legend_s1.name}» — топ-${S.S2_RESET.legendTop}`));
  assert.ok(c.text.includes(`«${S.VETERAN_S1.title}» — з ${S.VETERAN_S1.tiers[0].minLevel}-го рівня`));
  assert.ok(c.text.includes(`ключ «${S.CASE_BY_ID[S.S2_RESET.friendKey].name}»`));
  assert.equal(c.tag, `для гравців Сезону ${S.S2_RESET.prevSeason}`);
  assert.ok(slide('Сезон 2').title.startsWith(`Сезон ${S.S2_RESET.season}`));
  // the pass
  const ps = slide('Пропуск');
  assert.ok(ps.title.includes(S.SEASON_THEMES[2].name) && ps.text.startsWith(`${S.SEASON.levels} рівнів`));
  assert.ok(ps.text.includes(S.SEASON_CARS.find((x) => x.season === 2).name));
  // no prices or odds written by hand
  for (const s of S.WHATS_NEW.slides) assert.doesNotMatch(s.text, /₴|млн|⭐|\d+ зір/, s.title);
});

test('«Що нового»: once per player — seen on one device, not shown on another', () => {
  const db = openDb(':memory:');
  const g = createGame(db, { now: () => Date.parse('2026-10-29T10:00:00Z'), notify: () => {}, random: () => 0.5 });
  g.ensureUser({ id: 7, first_name: 'Оля' });
  g.api['case/open'](7, { caseId: 'starter' });
  let me = g.api.me(7, {});
  assert.equal(S.storyFor(me), 'whatsnew');
  g.api['story/seen'](7, {});
  g.api['story/seen'](7, {}); // a second device: nothing changes
  me = g.api.me(7, {});
  assert.equal(S.storyFor(me, false), null);
});

test('house style: one apostrophe (’), «драг» and «пальне» in the player texts', () => {
  const dirs = ['../public/', '../src/'];
  for (const d of dirs) {
    for (const f of fs.readdirSync(new URL(d, import.meta.url)).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(new URL(d + f, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /[а-яіїєґА-ЯІЇЄҐ]\\?'[яюєїЯЮЄЇ]/, `${f}: ASCII apostrophe in a Ukrainian word`);
      assert.doesNotMatch(src, /Подвійне палив|Подвійним палив|(?<![а-яіїєґА-ЯІЇЄҐ])[Дд]рег(?![а-яіїєґ]*ат)/u, `${f}: «паливо»/«дрег»`);
    }
  }
});

test('Season 2 welcome window: each line says what and why; key words agree with the number', () => {
  const base = { credit: 0, frames: [], veteran: null, level: 2, keys: 0, friends: 0, caseId: S.S2_RESET.friendKey, vipSub: false };
  assert.deepEqual(welcomeLines(base), [], 'nothing to list → the window says the starter case waits');
  const one = welcomeLines({ ...base, keys: 1, friends: 1 });
  assert.equal(one[0][1], `1 ключ «${S.CASE_BY_ID[S.S2_RESET.friendKey].name}»`);
  assert.ok(!one[0][2].includes('максимум'));
  const capped = welcomeLines({ ...base, keys: S.S2_RESET.friendKeysMax, friends: S.S2_RESET.friendKeysMax + 3 });
  assert.ok(capped[0][2].includes(`максимум ${S.S2_RESET.friendKeysMax}`));
  const fr = welcomeLines({ ...base, frames: ['patron', 'veteran_s1'] });
  assert.ok(fr[0][2].endsWith('уже на аватарі') && !fr[1][2].includes('аватарі'), 'the first frame is the worn one');
  const cr = welcomeLines({ ...base, credit: 120 });
  assert.ok(cr[0][1].startsWith('120 ⭐') && cr[0][2].startsWith(`${S.S2_RESET.creditPct}% зірок`) && cr[0][2].includes('«Стиль»'));
});
