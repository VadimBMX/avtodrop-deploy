// Texts pass (wText 2026-10-29): the «Що нового» slides of the autumn update say what the rules say, they are shown
// once per player (any device), and the house style holds — one apostrophe (’), «драг», «пальне».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { createGame } from '../src/game.js';
import * as S from '../public/shared.js';
import { HALLOWEEN } from '../public/halloween.js';
import { CLUB } from '../public/clubs.js';
import { TOURNEY } from '../public/tourney.js';
import { PRESTIGE } from '../public/prestige.js';
import { EVENING } from '../public/containers.js';

const slide = (title) => S.WHATS_NEW.slides.find((s) => s.title.startsWith(title));

test('«Що нового»: seven slides of the autumn update, icons that exist, short texts', () => {
  assert.notEqual(S.WHATS_NEW.id, 'economy-2');
  assert.deepEqual(S.WHATS_NEW.slides.map((s) => s.title.split(' ·')[0]),
    ['Ніч Хелловіну', 'Причал', 'Автоклуби', 'Турнір вихідних', 'Сарайна знахідка', 'Престиж', 'Сезон 2']);
  const svg = fs.readFileSync(new URL('../public/icons.svg', import.meta.url), 'utf8');
  for (const s of S.WHATS_NEW.slides) {
    assert.ok(svg.includes(`id="i-${s.icon}"`), s.icon);
    assert.ok(s.text.length <= 190, `${s.title}: ${s.text.length}`);
    assert.ok(s.tag && s.tag.length <= 26, s.title);
    assert.match(s.c, /^#[0-9a-f]{6}$/i);
  }
});

test('«Що нового»: the numbers match the rules', () => {
  assert.equal(slide('Ніч Хелловіну').tag, `${HALLOWEEN.from[1]}.${HALLOWEEN.from[0]} – ${HALLOWEEN.to[1]}.${HALLOWEEN.to[0]}`);
  assert.ok(slide('Причал').text.includes(`о ${EVENING.hour}:00`) && slide('Причал').tag.includes(`${EVENING.hour}:00`));
  const cl = slide('Автоклуби');
  assert.equal(cl.tag, `з ${CLUB.joinLevel}-го рівня`);
  assert.ok(cl.text.includes(`До ${CLUB.max} гравців`) && cl.text.includes(`з ${CLUB.createLevel}-го рівня`));
  const tr = slide('Турнір вихідних');
  assert.deepEqual([TOURNEY.regOpen, TOURNEY.regClose, TOURNEY.stages[0].slice(0, 2)], [[0, 18], [1, 12], [2, 20]]); // пт 18:00, сб 12:00, нд 20:00
  assert.ok(tr.text.includes('до суботи 12:00') && tr.tag === 'пт 18:00 → нд 20:00');
  assert.ok(slide('Сарайна знахідка').text.includes(`×${String(S.R_MULT).replace('.', ',')}`));
  const pr = slide('Престиж');
  assert.equal(pr.tag, `з ${PRESTIGE.level}-го рівня`);
  assert.equal(PRESTIGE.garage, 500e6);
  assert.ok(pr.text.includes('від 500 млн') && pr.text.includes(`+${Math.round(S.STAR_INCOME * 100)}%`));
  // Season 2 starts on 2.11 at 23:00 Kyiv time.
  const s2 = S.seasonStartOf(2);
  assert.equal(S.kyivLocal(s2), '2026-11-02T23:00');
  const t = S.kyivLocal(s2);
  assert.equal(slide('Сезон 2').tag, `з ${Number(t.slice(8, 10))}.${Number(t.slice(5, 7))}, ${t.slice(11, 16)}`);
  assert.ok(slide('Сезон 2').title.includes(S.SEASON_THEMES[2].name) && slide('Сезон 2').text.includes(S.SEASON_CARS[1].name));
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
