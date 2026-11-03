// «Війна районів» demo data (public/s2-ui.js warMap draws it). Pure, so test/war-demo.test.js checks it in node.
// District corners g: the block's top surface on public/s2/world.webp (1584×672) — left, back, right, front.
// Owner 03.11 (play-report №4: the demo showed the player's own club holding Поділ and Лук’янівка): while the war is
// «Скоро» the map belongs only to made-up demo clubs, never to the player's club. None of them wears the game's yellow
// or the generic club emblem e0 (that is the look of «Автоклуби» and of the player's own UI); a demo club whose name or
// tag happens to match the player's club leaves its districts neutral (warDemo), so his club is never shown as an owner.
export const DEMO_CLUBS = {
  wolves: { name: 'Сірі вовки', short: 'Вовки', tag: 'ВОВК', c: '#39e58c', e: 4 },
  turbo: { name: 'Турбо', short: 'Турбо', tag: 'ТУРБ', c: '#3d8bff', e: 1 },
  bmw: { name: 'BMW Club', short: 'BMW', tag: 'BMWC', c: '#b06cff', e: 2 },
  dk: { name: 'Drift Kings', short: 'DK', tag: 'DK', c: '#ff3d5a', e: 3 },
};
const NEUTRAL = '#8a8b90';
export const DISTRICTS = [
  { n: 'Оболонь', fight: ['dk', 'wolves'], g: [[17, 230], [314, 65], [462, 155], [165, 320]] },
  { n: 'Поділ', club: 'wolves', g: [[287, 362], [516, 225], [669, 325], [440, 462]] },
  { n: 'Лук’янівка', club: 'wolves', g: [[17, 500], [219, 365], [442, 495], [240, 630]] },
  { n: 'Печерськ', club: 'bmw', g: [[732, 367], [922, 250], [1110, 345], [920, 462]] },
  { n: 'Троєщина', club: 'turbo', g: [[980, 150], [1182, 20], [1337, 147], [1135, 277]] },
  { n: 'Дарниця', club: 'turbo', g: [[1172, 320], [1369, 180], [1569, 290], [1372, 430]] },
  { n: 'Позняки', club: 'dk', g: [[955, 525], [1147, 415], [1367, 535], [1175, 645]] },
];
// The demo as drawn for this player: { districts: [{ n, g, c, c2, fight, club: {name, e} | null }], legend: [[club, count]] }.
// `myClub` (me().club: { tag, name }) only ever takes districts away (to neutral), never gets one.
export function warDemo(myClub) {
  const low = (x) => String(x || '').trim().toLowerCase();
  const mine = [low(myClub?.name), low(myClub?.tag)].filter(Boolean);
  const clash = (k) => !!myClub && [DEMO_CLUBS[k].name, DEMO_CLUBS[k].short, DEMO_CLUBS[k].tag].some((x) => mine.includes(low(x)));
  const districts = DISTRICTS.map((d) => {
    if (d.fight) {
      const [a, b] = d.fight.filter((k) => !clash(k));
      if (a && b) return { n: d.n, g: d.g, fight: true, c: DEMO_CLUBS[a].c, c2: DEMO_CLUBS[b].c, club: null };
      return { n: d.n, g: d.g, fight: false, c: NEUTRAL, club: null };
    }
    return clash(d.club) ? { n: d.n, g: d.g, fight: false, c: NEUTRAL, club: null } : { n: d.n, g: d.g, fight: false, c: DEMO_CLUBS[d.club].c, club: DEMO_CLUBS[d.club] };
  });
  const legend = Object.keys(DEMO_CLUBS).filter((k) => !clash(k)).map((k) => [DEMO_CLUBS[k], DISTRICTS.filter((d) => d.club === k).length]).filter(([, n]) => n);
  return { districts, legend };
}
