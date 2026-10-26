// «Ніч Хелловіну» — a seasonal event (rules shared by the server src/halloween.js, the app and the tests).
// It runs by itself every year from 29.10 00:00 to 2.11 23:59 Kyiv time; an admin can force it on or off (meta
// 'halloween_mode': 'on' | 'off', anything else = by the calendar). While it runs: the «Контейнер з привидом» lot on
// «Причал» (public/containers.js EVENT_TIERS), the night drift track and drag scene, a pumpkin plate frame, and five
// event tasks. It changes no case price or odds, no sell rate, no race prize. After it ends everything earned stays
// (the frame is a claim, the №13 is a car) and the event content hides.
import * as S from './shared.js';

export const HALLOWEEN = {
  id: 'halloween',
  name: 'Ніч Хелловіну',
  from: [10, 29], // month, day: the first day (00:00 Kyiv)
  to: [11, 2], // the last day (till 23:59:59 Kyiv)
  color: '#ff7a1a',
};
export const HW_MODES = ['auto', 'on', 'off'];
const pad = (n) => String(n).padStart(2, '0');
// [start, end) of the event in the given year (ms, Kyiv midnights, right across the summer-time switch on 25.10).
export function hwWindow(year) {
  return { start: S.kyivMidnightOf(`${year}-${pad(HALLOWEEN.from[0])}-${pad(HALLOWEEN.from[1])}`), end: S.kyivMidnightOf(`${year}-${pad(HALLOWEEN.to[0])}-${pad(HALLOWEEN.to[1])}`, 1) };
}
export const hwYearOf = (t) => Number(S.kyivDateOf(t).slice(0, 4));
export const hwInWindow = (t) => {
  const w = hwWindow(hwYearOf(t));
  return t >= w.start && t < w.end;
};
// Is it on at t: the admin's switch wins, otherwise the calendar.
export const hwActive = (t, mode = 'auto') => (mode === 'on' ? true : mode === 'off' ? false : hwInWindow(t));
// The event's key for its tasks and rewards (a fresh set every year).
export const hwKey = (t) => `hw${hwYearOf(t)}`;

// The limited plate frame (S.EVENT_COSMETICS) and the event edition «№ 13» (S.EVENT_EDITIONS).
export const HW_FRAME = 'cos:e:hw-pumpkin';
export const HW_EDITION = 'ford-mustang-gt-2005--hw13';
// The last task's prize: this chance of the №13, otherwise one level key. Shown to the player as it is.
export const HW_EDITION_CHANCE = 0.13;

// Event tasks: counted only while the event runs (the same actions as the daily/weekly tasks, S.WEEKLY_QUESTS keys),
// each paid once, automatically when it is done. Keys are the player's level key (S.levelKey), like the weekly route,
// so a fresh second account can't farm dear keys. The fifth one is done when the four above are.
export const HW_TASKS = [
  { id: 'collect', track: 'collect', n: 3, icon: 'coin', text: 'Забери дохід гаража 3 рази', reward: { frame: true } },
  { id: 'open', track: 'open', n: 13, icon: 'gift', text: 'Відкрий 13 кейсів з машинами', reward: { keys: 1 } },
  { id: 'win', track: 'win', n: 13, icon: 'flag-3', text: 'Виграй 13 заїздів (драг або дрифт)', reward: { keys: 1 } },
  { id: 'drift', track: 'drift', n: 3, icon: 'tornado', text: 'Проїдь 3 нічні дрифт-заїзди', reward: { keys: 1 } },
  { id: 'all', all: true, n: 4, icon: 'ghost', text: 'Виконай чотири завдання вище', reward: { edition: HW_EDITION_CHANCE, keys: 1 } },
];
export const HW_TASK_BY = Object.fromEntries(HW_TASKS.map((t) => [t.id, t]));
// What a task pays, in words (the key's name is the player's level key).
export function hwRewardText(task, level) {
  const r = task.reward, key = S.CASE_BY_ID[S.levelKey(level)]?.name || 'кейс';
  if (r.frame) return 'Рамка номера «Гарбуз»';
  if (r.edition) return `${Math.round(r.edition * 100)}% — тиражний «№ 13», інакше ключ «${key}»`;
  return `${r.keys > 1 ? `${r.keys} ключі` : 'Ключ'} «${key}»`;
}
