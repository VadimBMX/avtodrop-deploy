// «Виклик-привид» (ghost challenge): a finished drag run kept as a challenge a friend races against. Shared by the
// server (src/game.js: create / accept / validate) and the app (the ghost car on the drag scene, the share card).
//
// The ghost is the stored run replayed on the very timeline the player's own car uses (S.dragDrive / S.dragU): the
// same reaction, the same gear changes at the same moments with the qualities the server judged, so it crosses the
// line exactly at the stored time — whoever opens the challenge sees the same race.
import { SHIFTS, SHIFT_POINTS, SHIFT_AUTO_RPM, DRAG_TOL, msToTau, dragDrive, dragU, raceTime, raceMoney, OPPONENTS, MODELS } from './shared.js';

// perDay: challenges a player can throw per Kyiv day; ttlDays: how long one can be accepted; maxAgeH: a run older
// than this can't become a challenge; winPays / defendPays: prized wins of an accepter / paid defences of a creator
// per Kyiv day; defendShare: a defence pays this share of the easy rival's prize; listDays: how far back «Виклики» go.
export const CHALLENGE = { perDay: 10, ttlDays: 7, maxAgeH: 24, winPays: 5, defendPays: 5, defendShare: 0.25, listDays: 30 };
export const CH_ID = /^[0-9a-f]{10}$/;
export const CH_PARAM = /^ch_([0-9a-f]{10})$/;

// The moments the stored run changed gear. reaction: s after green (−1 = a jump start); shiftAt: ms after launch of
// every shift as the app reported it; shifts: the qualities the server judged (dragReplay). A shift reported after the
// limiter point is moved back to it, as dragReplay does; a shift never reported happened on the limiter.
// Returns { reaction, shifts (all SHIFTS), at (tau of each shift, race s after launch), time (= raceTime) }.
export function ghostPlan(stats, reaction, shiftAt = [], shifts = []) {
  const full = Array.from({ length: SHIFTS }, (_, i) => shifts[i] || 'late');
  const at = [];
  let seg = 0;
  for (let i = 0; i < SHIFTS; i++) {
    const { react, drive } = dragDrive(stats, reaction, full.slice(0, i));
    const uLate = seg + ((SHIFT_AUTO_RPM - 0.3) / 0.58) * Math.max(0.03, SHIFT_POINTS[i] - seg);
    const tauLate = react + uLate * drive;
    let tau;
    if (i < shiftAt.length && Number.isFinite(shiftAt[i])) {
      tau = msToTau(shiftAt[i]);
      if (uLate < 1 && tau > tauLate + msToTau(DRAG_TOL.hitch)) tau = tauLate;
    } else if (uLate < 1) tau = tauLate;
    else break; // the run was over before this gear
    at.push(tau);
    seg = Math.max(0, Math.min(1, (tau - react) / drive));
  }
  return { reaction, shifts: full, at, time: raceTime(stats, reaction, full) };
}
// Progress 0..1 of the ghost at tau (race s after launch), exactly as the drag scene moves the player's car: the
// gears changed so far, the rest projected; after the last stored gear change the whole run, so it ends at plan.time.
export function ghostU(stats, plan, tau) {
  let k = 0;
  while (k < plan.at.length && plan.at[k] <= tau) k++;
  return dragU(stats, plan.reaction, k >= plan.at.length ? plan.shifts : plan.shifts.slice(0, k), tau);
}
// When the ghost starts rolling and how long its run takes from there (race s), for the scene's speed and roll-out.
export function ghostDrive(stats, plan) {
  return dragDrive(stats, plan.reaction, plan.shifts);
}

// Money: the game pays, never the other player (no bets). A win over a challenge pays the easy rival's prize of the
// cheaper of the two cars; a defence pays the creator a share of the easy prize of his car.
export const winPrize = (priceA, priceB) => raceMoney(OPPONENTS[0], Math.min(priceA, priceB)).prize;
export const defendPay = (price) => Math.max(500, Math.round((raceMoney(OPPONENTS[0], price).prize * CHALLENGE.defendShare) / 100) * 100);

// The link in a shared challenge: the Mini App itself when its short name is known (startapp — Telegram opens the game
// with start_param ch_<id>), otherwise the bot (/start ch_<id>, the bot answers with a «Прийняти виклик» button).
export function challengeLink(bot, app, id) {
  if (!bot || !CH_ID.test(String(id))) return '';
  return app ? `https://t.me/${bot}/${app}?startapp=ch_${id}` : `https://t.me/${bot}?start=ch_${id}`;
}
export const chTime = (t) => Number(t).toFixed(3).replace('.', ',');
// «11,842 с на Toyota Supra A80. Поб’єш?»
export const challengeLine = (model, time) => `${chTime(time)} с на ${MODELS[model]?.name || 'машині'}. Поб’єш?`;
export function challengeCaption({ who = '', model, time }) {
  return `🏁 ${who ? who + ' кидає виклик: ' : 'Виклик: '}${challengeLine(model, time)}\n👻 Їдь проти мого привида — драг 402 м в АВТОДРОП. Перший кейс безкоштовно 👇`;
}
