// Tiny WebAudio synth for game feedback: no audio files, every sound is a few oscillators with short envelopes.
// Silent until the first user gesture (browsers require it anyway), while the page / Telegram app is in the
// background, and when the player switches «Звук» off in the menu (remembered per device).
const KEY = 'avtodrop-sound';
const VOLUME = 0.16; // quiet by default: feedback, not a casino floor
let ac = null, master = null, unlocked = false, hidden = document.hidden, enabled = true;
try {
  enabled = localStorage.getItem(KEY) !== '0';
} catch {}

function unlock() {
  if (unlocked) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ac = new AC();
    master = ac.createGain();
    master.gain.value = VOLUME;
    master.connect(ac.destination);
    ac.resume?.();
    unlocked = true;
  } catch {
    ac = null;
  }
  for (const t of ['pointerdown', 'touchstart', 'keydown']) removeEventListener(t, unlock, true);
}
for (const t of ['pointerdown', 'touchstart', 'keydown']) addEventListener(t, unlock, { capture: true, passive: true });

function setHidden(h) {
  hidden = h;
  if (!ac) return;
  try {
    h ? ac.suspend() : ac.resume();
  } catch {}
}
document.addEventListener('visibilitychange', () => setHidden(document.hidden));
try {
  const tg = window.Telegram?.WebApp;
  tg?.onEvent?.('deactivated', () => setHidden(true));
  tg?.onEvent?.('activated', () => setHidden(document.hidden));
} catch {}

export const isOn = () => enabled;
export function setOn(on) {
  enabled = !!on;
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {}
}
const ready = () => enabled && unlocked && !hidden && ac && ac.state !== 'closed';

// One voice: oscillator → gain envelope (fast attack, exponential decay) → optional low-pass → master.
function tone({ f = 440, f2 = 0, type = 'sine', at = 0, dur = 0.12, vol = 0.5, attack = 0.004, lp = 0 }) {
  const t = ac.currentTime + at;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = g;
  if (lp) {
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = lp;
    g.connect(flt);
    out = flt;
  }
  o.connect(g);
  out.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}
// Short filtered noise burst (whoosh / shaker).
let noiseBuf = null;
function noise({ at = 0, dur = 0.2, vol = 0.3, from = 800, to = 3000, q = 1.2 }) {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ac.currentTime + at;
  const s = ac.createBufferSource(), flt = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf;
  flt.type = 'bandpass';
  flt.Q.value = q;
  flt.frequency.setValueAtTime(from, t);
  flt.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(flt).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}
const safe = (fn) => (...a) => {
  if (!ready()) return;
  try {
    fn(...a);
  } catch {}
};
let lastTick = 0;
// A card passing the gate: a soft wooden click, throttled so a fast reel doesn't buzz.
export const tick = safe((pitch = 1) => {
  const now = performance.now();
  if (now - lastTick < 38) return;
  lastTick = now;
  tone({ f: 1500 * pitch, f2: 700 * pitch, type: 'triangle', dur: 0.035, vol: 0.35 });
});
// A symbol landing (plates): a slightly brighter click.
export const land = safe((i = 0) => tone({ f: 660 + i * 40, f2: 330, type: 'square', dur: 0.05, vol: 0.12, lp: 2400 }));
// Rising anticipation drone (rare plates / reel tease).
export const tease = safe((ms = 900) => {
  const d = ms / 1000;
  tone({ f: 220, f2: 520, type: 'sawtooth', dur: d, vol: 0.06, attack: d * 0.6, lp: 1200 });
  noise({ dur: d, vol: 0.05, from: 400, to: 2400 });
});
// Result pop, brighter for rarer classes (rank 0 = D … 5 = X).
export const pop = safe((rank = 0) => {
  const base = [392, 440, 523, 587, 659, 784][Math.max(0, Math.min(5, rank))];
  tone({ f: base, f2: base * 2, type: 'triangle', dur: 0.16, vol: 0.45 });
  tone({ f: base * 1.5, type: 'sine', at: 0.05, dur: 0.22, vol: 0.25 });
});
// Coin: two quick high pings (the classic "coin" interval).
export const coin = safe((at = 0) => {
  tone({ f: 988, type: 'square', at, dur: 0.07, vol: 0.12, lp: 5000 });
  tone({ f: 1319, type: 'square', at: at + 0.06, dur: 0.16, vol: 0.12, lp: 5000 });
});
// Win: a short major arpeggio.
export const win = safe(() => {
  [523, 659, 784, 1047].forEach((f, i) => tone({ f, type: 'triangle', at: i * 0.075, dur: 0.22 + (i === 3 ? 0.2 : 0), vol: 0.35 }));
});
// Rare drop (A/S/X): a shimmering chord with a whoosh; bigger for higher ranks.
export const rare = safe((rank = 3) => {
  noise({ dur: 0.45, vol: 0.12, from: 600, to: 6000 });
  const chord = rank >= 4 ? [523, 659, 784, 1047, 1319] : [440, 554, 659, 880];
  chord.forEach((f, i) => {
    tone({ f, type: 'sine', at: 0.04 + i * 0.05, dur: 0.9 + i * 0.1, vol: 0.18, attack: 0.02 });
    tone({ f: f * 2.01, type: 'sine', at: 0.04 + i * 0.05, dur: 0.6, vol: 0.05 });
  });
  if (rank >= 4) tone({ f: 110, f2: 55, type: 'sine', dur: 0.5, vol: 0.5 });
});
// Lose: a soft descending blip, never harsh.
export const lose = safe(() => {
  tone({ f: 330, f2: 220, type: 'triangle', dur: 0.22, vol: 0.3 });
  tone({ f: 247, f2: 165, type: 'triangle', at: 0.12, dur: 0.3, vol: 0.25 });
});
// Button press on claim buttons.
export const press = safe(() => tone({ f: 420, f2: 260, type: 'sine', dur: 0.06, vol: 0.3 }));
// Celebration (level-up, set done, achievement): arpeggio + sparkle.
export const fanfare = safe(() => {
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, type: 'triangle', at: i * 0.07, dur: 0.3, vol: 0.3 }));
  noise({ at: 0.3, dur: 0.5, vol: 0.06, from: 3000, to: 9000, q: 3 });
});
// Hand wash: a short wet swish under the finger (throttled), and a splash with a bright "clean" ping at the end.
let lastScrub = 0;
export const scrub = safe((speed = 1) => {
  const now = performance.now();
  if (now - lastScrub < 110) return;
  lastScrub = now;
  const s = Math.max(0.6, Math.min(1.6, speed));
  noise({ dur: 0.16, vol: 0.05 * s, from: 700 * s, to: 2200 * s, q: 0.7 });
  if (Math.random() < 0.25) tone({ f: 1800 + Math.random() * 900, f2: 2600, type: 'sine', at: 0.03, dur: 0.05, vol: 0.03 });
});
export const splash = safe(() => {
  noise({ dur: 0.5, vol: 0.12, from: 3000, to: 500, q: 0.6 });
  [1319, 1760, 2637].forEach((f, i) => tone({ f, type: 'sine', at: 0.25 + i * 0.07, dur: 0.35, vol: 0.12 }));
});
