// popups (crit4 §3 №5): at most ONE window opens by itself per app entry.
// Before, a mid player got «Що нового» → «Нагороди» → «Бета-тест» in a row on opening the app, and the bug-reward
// thanks waited behind them. Now every self-opening window asks here first (`offer`), and:
// - during the first moments of an entry (until `ready()`: the first pulse has told about gifts) the offers are
//   collected and the one with the highest priority is shown; the others are not shown and NOT marked as seen
//   (their «show once» keys stay unset), so they come on a later entry, still exactly once;
// - a lost level-up becomes a toast (its `onLose`), the lost daily rewards window leaves its banner — a badge, not a
//   window;
// - once the entry's window was shown, only it may show again (a gift closed by a tap outside comes back, the gift
//   queue goes on); when it is closed and the player has done something (`touch`), the entry is over: from then on
//   only windows that the play itself causes (a level-up after a race, a gift from the admin) open, never the
//   announcements (what's new, beta test, home screen, the daily rewards) — those wait for the next entry;
// - nothing opens while a race, a case opening, the first-steps focus, a story or another window is on (`calm`);
// - a new entry: the app is reloaded, or it comes back after NEW_ENTRY_MS in the background.
// Windows the player opens himself never come here.
export const POP_PRI = { gift: 100, level: 80, whatsnew: 60, plateauction: 55, rewards: 50, vipsale: 78, hwintro: 75, ideaask: 72, fueldeal: 70, contest: 65, packoffer: 30, bugask: 20, homeask: 10 };
// Windows the play causes (allowed after the entry is over); the rest are entry-only announcements.
export const POP_PLAY = new Set(['gift', 'level', 'fueldeal']); // fueldeal: the tank just ran dry in play
export const NEW_ENTRY_MS = 30 * 60e3;
export const READY_FALLBACK_MS = 5000;

// calm(): nothing on screen that a window must not cover; idle(): no window/story open (the entry's window is closed).
export function createPopups({ calm = () => true, idle = () => true, now = () => Date.now(), later = (f, ms) => setTimeout(f, ms) } = {}) {
  let cands = new Map(); // kind → { show, onLose }
  let decided = false; // the collection window of this entry is over
  let holder = null; // the kind shown this entry
  let over = false; // the entry is over (its window closed and the player went on)
  let lost = []; // onLose callbacks to run once the screen is idle
  let hiddenAt = 0;
  const log = [];

  // A show function returns false when it has nothing to show any more (the level was seen, the bonus claimed
  // meanwhile): then the slot stays free for the next one.
  const show = (kind, fn) => {
    const was = holder;
    holder = kind;
    if (fn() === false) {
      holder = was;
      return 'denied';
    }
    log.push(kind);
    return 'shown';
  };
  const flushLost = () => {
    if (!lost.length) return;
    if (!idle()) return void later(flushLost, 700);
    const l = lost;
    lost = [];
    for (const f of l) try { f(); } catch {}
  };
  let waiting = false;
  function pick() {
    waiting = false;
    if (!cands.size || holder) return;
    if (!calm()) return void ((waiting = true), later(pick, 1200)); // e.g. the first steps' focus or a link that opened a race
    const list = [...cands.entries()].sort((a, b) => (POP_PRI[b[0]] || 0) - (POP_PRI[a[0]] || 0));
    cands = new Map();
    for (let i = 0; i < list.length; i++) {
      if (show(list[i][0], list[i][1].show) !== 'shown') continue;
      for (const [, c] of list.slice(i + 1)) if (c.onLose) lost.push(c.onLose);
      later(flushLost, 700);
      return;
    }
  }
  // 'shown' — opened now; 'queued' — waits for the entry's choice; 'busy' — not now, ask again later (the caller's
  // own retry); 'denied' — not this entry (the caller leaves its «seen» key alone; a level-up turns into a toast).
  function offer(kind, fn, onLose) {
    if (over) {
      if (!POP_PLAY.has(kind)) return 'denied';
      return calm() ? show(kind, fn) : 'busy';
    }
    if (holder) return holder === kind && calm() ? show(kind, fn) : holder === kind ? 'busy' : 'denied';
    cands.set(kind, { show: fn, onLose });
    if (!decided) return 'queued';
    // The choice is made but nothing was shown yet (nothing was offered, or the best one waits for a calm moment):
    // this offer competes with whatever still waits.
    if (!waiting) pick();
    return holder === kind ? 'shown' : 'queued';
  }
  // The entry's offers are in (the first pulse is back, or the fallback timer ran out): show the best one.
  function ready() {
    if (decided) return;
    decided = true;
    pick();
  }
  // Any tap of the player: once the entry's window is closed, the entry is over.
  function touch() {
    if (!over && holder && decided && idle()) over = true;
  }
  // visibilitychange: back after a long time in the background — a new entry.
  function visibility(hidden) {
    if (hidden) return void (hiddenAt = now());
    if (hiddenAt && now() - hiddenAt >= NEW_ENTRY_MS) {
      cands = new Map();
      decided = false;
      holder = null;
      over = false;
      later(ready, READY_FALLBACK_MS);
    }
    hiddenAt = 0;
  }
  later(ready, READY_FALLBACK_MS);
  return { offer, ready, touch, visibility, state: () => ({ decided, holder, over, queued: [...cands.keys()], log: [...log] }) };
}
