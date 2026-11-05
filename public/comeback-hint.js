// Come-back hint (owner 05.11, sim-report «стіна першої сесії»): a newbie whose tank just ran dry is told, once, when
// to come back — «Повернись о HH:MM — каса і паливо будуть повні» (Kyiv time). Pure rules here so tests can check them;
// app.js shows the line at the end of a drag race result and on the empty-tank cards («Гонки», «Гараж»).
//   · newbie: an account younger than COMEBACK_HINT.maxAgeDays;
//   · when: the tank is empty (the hint names the moment both the tank and the garage cash box are full);
//   · once per session: the line stays while that first empty tank lasts, and never comes back after it (createHintSession).

export const COMEBACK_HINT = { maxAgeDays: 3, minAheadMin: 10 };
const HM = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });

// When the garage cash box is full (income: me.income — rate per hour, capH, since, banked); null with no income.
export function cashFullAt(income) {
  if (!income || !(income.rate > 0)) return null;
  const cap = income.rate * income.capH;
  return income.since + Math.max(0, (cap - (income.banked || 0)) / income.rate) * 3600e3;
}

// The hint for this moment, or null: { at, text }.
export function comebackHint({ now, createdAt, fuel, fuelFullAt, income }) {
  if (!createdAt || now - createdAt > COMEBACK_HINT.maxAgeDays * 86400e3) return null;
  if (fuel > 0 || !fuelFullAt) return null;
  const at = Math.max(fuelFullAt, cashFullAt(income) || 0);
  if (at - now < COMEBACK_HINT.minAheadMin * 60e3) return null; // back in a few minutes anyway
  const when = DAY.format(at) === DAY.format(now) ? `о ${HM.format(at)}` : `завтра о ${HM.format(at)}`;
  const what = cashFullAt(income) ? 'каса і паливо будуть повні' : 'бак буде повний';
  return { at, text: `Повернись ${when} — ${what}` };
}

// Once per session: the first hint is kept (the same time on every redraw) while the tank stays empty; when fuel is
// back, the session's hint is used up.
export function createHintSession() {
  let hint = null, done = false;
  return (s) => {
    if (done) return null;
    if (hint) {
      if (s.fuel > 0) {
        done = true;
        return null;
      }
      return hint;
    }
    hint = comebackHint(s);
    return hint;
  };
}
