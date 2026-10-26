// Race «scene mode» (D-race): while a drag or drift run is on screen (#view > .drag / .d2 — solo, boss, PvP, the
// day's race), <body> gets .racing: the tab bar hides and the header shrinks to the balance (style.css, D-race block),
// and the page starts from the top so the HUD is never under the header. Any other screen drops the class — the
// result screens included — so nothing in the race code has to remember to undo it.
export function watchScene(view = document.getElementById('view')) {
  if (!view) return;
  const sync = () => {
    const on = !!view.querySelector(':scope > .drag, :scope > .d2');
    if (on === document.body.classList.contains('racing')) return;
    document.body.classList.toggle('racing', on);
    if (on) window.scrollTo(0, 0);
  };
  new MutationObserver(sync).observe(view, { childList: true });
  sync();
}
