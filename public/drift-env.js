// The drift track's surroundings (owner 27.10: «красивішу плантацію… будто на якому треку дрифтим»): mown grass,
// gravel traps on the corners, tyre stacks on their outside, armco along the whole track, АВТОДРОП boards on the
// straights, trees, grandstands with a crowd at the start and the finish, and at night light poles with a glow.
// Everything is laid out once from the track samples (deterministic, the same every run of a track) and drawn in
// world space between the scene's road window `from…to`; sprites are pre-rendered so a frame is only drawImage calls.
// Pure decoration: nothing here touches the physics or the score.

const hash = (n) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const sprite = (w, h, paint) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'));
  return c;
};

// The grass pattern: two-tone mowing stripes with a few specks.
export function grassTile(night, colors) {
  return sprite(96, 96, (g) => {
    const a = night ? colors?.grass || '#0f1a13' : '#1a2b1e', b = night ? '#0c150f' : '#162619';
    g.fillStyle = a;
    g.fillRect(0, 0, 96, 96);
    g.fillStyle = b;
    g.fillRect(0, 0, 96, 48);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = night ? (i % 2 ? '#14211a' : '#09110c') : i % 2 ? '#1f3324' : '#122017';
      g.fillRect((i * 37) % 96, (i * 53 + (i >> 2) * 11) % 96, 2, 2);
    }
  });
}

export function driftEnv(G, HALF, segs, { night = false } = {}) {
  const { xs, ys, hs, kd, start } = G, last = xs.length - 1;
  // Road samples in a coarse grid: decorations keep clear of every part of the road, not only their own sample.
  const CELL = 64, grid = new Map();
  for (let i = 0; i <= last; i += 2) {
    const key = `${Math.floor(xs[i] / CELL)},${Math.floor(ys[i] / CELL)}`;
    (grid.get(key) || grid.set(key, []).get(key)).push(i);
  }
  const clear = (x, y, r) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), n = Math.ceil(r / CELL);
    for (let a = cx - n; a <= cx + n; a++) for (let b = cy - n; b <= cy + n; b++) {
      for (const i of grid.get(`${a},${b}`) || []) if ((xs[i] - x) ** 2 + (ys[i] - y) ** 2 < r * r) return false;
    }
    return true;
  };
  // Across the road at sample i (heading 0 = up): (cos h, sin h) points to the right.
  const at = (i, d) => [xs[i] + Math.cos(hs[i]) * d, ys[i] + Math.sin(hs[i]) * d];

  // ---------- sprites ----------
  const trees = [0, 1, 2].map((v) => sprite(64, 64, (g) => {
    const r = 15 + v * 5;
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.arc(36, 36, r, 0, Math.PI * 2); g.fill();
    const base = night ? ['#0f2a1a', '#143522', '#1b4029'] : ['#1f5a32', '#27693b', '#2f7a45'];
    g.fillStyle = base[0];
    g.beginPath(); g.arc(30, 30, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = base[1];
    for (const [dx, dy, k] of [[-5, -4, 0.62], [6, -2, 0.55], [0, 6, 0.5]]) { g.beginPath(); g.arc(30 + dx, 30 + dy, r * k, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = base[2];
    g.beginPath(); g.arc(25, 24, r * 0.38, 0, Math.PI * 2); g.fill();
  }));
  const tyre = sprite(14, 14, (g) => {
    g.fillStyle = '#0d0d0f';
    g.beginPath(); g.arc(7, 7, 6.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = night ? '#3a3540' : '#4b5563';
    g.beginPath(); g.arc(7, 7, 2.6, 0, Math.PI * 2); g.fill();
  });
  const board = sprite(64, 12, (g) => {
    g.fillStyle = '#facc15';
    g.fillRect(0, 0, 64, 12);
    g.fillStyle = '#111';
    g.font = '900 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('АВТОДРОП', 32, 6.5);
  });
  const stand = sprite(150, 54, (g) => {
    g.fillStyle = '#1f2937';
    g.fillRect(0, 0, 150, 54);
    g.fillStyle = '#374151';
    for (let r = 0; r < 4; r++) g.fillRect(4, 6 + r * 12, 142, 8);
    const crowd = ['#ef4444', '#f8fafc', '#3b82f6', '#facc15', '#22c55e', '#f97316', '#a855f7', '#e5e7eb'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 28; c++) {
      if (hash(r * 97 + c) < 0.18) continue;
      g.fillStyle = crowd[Math.floor(hash(r * 31 + c * 7 + 5) * crowd.length)];
      g.beginPath(); g.arc(8 + c * 5, 10 + r * 12, 1.9, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#b91c1c';
    g.fillRect(0, 0, 150, 4); // the roof edge
  });
  const glow = night && sprite(120, 120, (g) => {
    const gr = g.createRadialGradient(60, 60, 0, 60, 60, 60);
    gr.addColorStop(0, 'rgba(255,214,140,.32)');
    gr.addColorStop(1, 'rgba(255,214,140,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 120, 120);
  });

  // ---------- layout ----------
  const items = []; // { i, kind, x, y, rot, v }
  // Armco both sides along the whole track: offset polylines, drawn as one stroke per side in the window.
  const ARM = HALF + 62;
  const armL = [], armR = [], okL = [], okR = [];
  for (let i = 0; i <= last; i++) {
    armL.push(at(i, -ARM));
    armR.push(at(i, ARM));
    // A point of armco that would come near another part of the road (inside a hairpin) is left out.
    okL.push(kd[i] !== -1 && clear(armL[i][0], armL[i][1], ARM - 6));
    okR.push(kd[i] !== 1 && clear(armR[i][0], armR[i][1], ARM - 6));
  }
  // Gravel traps: a band on the outside of each corner only (offset line, not a symmetric stroke).
  const GRAV = HALF + 30, gravel = [];
  for (let i = 0; i <= last; i++) gravel.push(kd[i] ? at(i, -kd[i] * GRAV) : null);
  // Tyre stacks on the outside of each corner (two rows), boards on the straights, light poles at night.
  segs.forEach((g, s) => {
    const a = start[s], b = s + 1 < segs.length ? start[s + 1] : last;
    if (g.kind !== 'straight') {
      const side = -g.dir; // the outside of the corner (the line pushes the car there)
      for (let i = a; i < b; i += 3) for (const d of [HALF + 50, HALF + 57]) {
        const [x, y] = at(i, side * d);
        items.push({ i, kind: 'tyre', x, y });
      }
    } else {
      for (let i = a + 18; i < b - 10; i += 34) {
        const side = (i / 34) % 2 < 1 ? 1 : -1;
        const [x, y] = at(i, side * (ARM - 8));
        items.push({ i, kind: 'board', x, y, rot: hs[i] + (side > 0 ? Math.PI / 2 : -Math.PI / 2) });
      }
    }
    if (night) {
      for (let i = a + 6; i < b; i += 26) {
        const side = (i / 26) % 2 < 1 ? 1 : -1, [x, y] = at(i, side * (ARM + 10));
        items.push({ i, kind: 'lamp', x, y });
      }
    }
  });
  // Grandstands by the start and the finish line, on whichever side has room.
  for (const i of [Math.min(last, 14), Math.max(0, start[segs.length - 1] + 6)]) {
    for (const side of [1, -1]) {
      const [x, y] = at(i, side * (ARM + 44));
      if (!clear(x, y, HALF + 60)) continue;
      items.push({ i, kind: 'stand', x, y, rot: hs[i] + (side > 0 ? Math.PI / 2 : -Math.PI / 2) });
      break;
    }
  }
  // Trees: a few per sample stretch on both sides, past the armco, never near any part of the road.
  for (let i = 0; i <= last; i += 3) {
    for (const side of [1, -1]) {
      const h1 = hash(i * 2 + (side > 0 ? 1 : 0));
      if (h1 < 0.3) continue;
      const d = ARM + 30 + hash(i * 7 + side) * 220, [x, y] = at(i, side * d);
      if (!clear(x, y, ARM + 22)) continue;
      items.push({ i, kind: 'tree', x, y, v: Math.floor(hash(i * 13 + side) * 3) });
    }
  }
  items.sort((p, q) => p.i - q.i);
  const order = { tyre: 0, board: 1, lamp: 2, stand: 3, tree: 4 };

  return {
    // Under the road: the gravel traps (wide bands on the corners only), and the armco.
    under(ctx, from, to, road) {
      ctx.lineWidth = 46;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = night ? '#2a2630' : '#4d4535';
      ctx.setLineDash([]);
      ctx.beginPath();
      let gOpen = false;
      for (let i = from; i <= to; i++) {
        const q = gravel[i];
        if (!q) { gOpen = false; continue; }
        if (!gOpen) { ctx.moveTo(q[0], q[1]); gOpen = true; } else ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = night ? '#6b6474' : '#9ca3af';
      ctx.setLineDash([]);
      // The inside of a corner has no armco (on a hairpin its offset line would loop over itself).
      for (const [side, ok] of [[armL, okL], [armR, okR]]) {
        ctx.beginPath();
        let open = false;
        for (let i = from; i <= to; i++) {
          if (!ok[i]) { open = false; continue; }
          if (!open) { ctx.moveTo(side[i][0], side[i][1]); open = true; } else ctx.lineTo(side[i][0], side[i][1]);
        }
        ctx.stroke();
      }
    },
    // Over the grass beside the road (after the road itself): tyres, boards, stands, trees, lamps.
    over(ctx, from, to, camH) {
      const lo = from - 30, hi = to + 30;
      const vis = items.filter((it) => it.i >= lo && it.i <= hi).sort((p, q) => order[p.kind] - order[q.kind]);
      for (const it of vis) {
        if (it.kind === 'tyre') ctx.drawImage(tyre, it.x - 7, it.y - 7);
        else if (it.kind === 'tree') {
          const s = trees[it.v];
          ctx.save();
          ctx.translate(it.x, it.y);
          ctx.rotate(camH); // the shadow always falls the same way on screen
          ctx.drawImage(s, -32, -32);
          ctx.restore();
        } else if (it.kind === 'board' || it.kind === 'stand') {
          const s = it.kind === 'board' ? board : stand;
          ctx.save();
          ctx.translate(it.x, it.y);
          ctx.rotate(it.rot);
          ctx.drawImage(s, -s.width / 2, -s.height / 2);
          ctx.restore();
        } else if (it.kind === 'lamp') {
          ctx.drawImage(glow, it.x - 60, it.y - 60);
          ctx.fillStyle = '#d1d5db';
          ctx.beginPath(); ctx.arc(it.x, it.y, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    },
  };
}

// Screen-space speed streaks: faint lines rushing down the sides of the view, more and brighter with speed (0…1).
export function speedLines() {
  const lines = Array.from({ length: 14 }, (_, k) => ({ x: hash(k * 3) , y: hash(k * 5 + 1), l: 0.6 + hash(k * 7) * 0.8 }));
  return (ctx, W, H, speed, dt) => {
    if (speed <= 0.05) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of lines) {
      p.y += dt * (0.6 + speed * 2.4) * p.l;
      if (p.y > 1.15) (p.y -= 1.3), (p.x = hash(Math.floor(p.y * 1e6) + p.x * 1e3));
      const x = p.x < 0.5 ? p.x * 0.36 * W : W - (1 - p.x) * 0.36 * W; // keep to the sides, clear of the car
      const y = p.y * H, len = (18 + 46 * speed) * p.l;
      ctx.strokeStyle = `rgba(255,255,255,${(0.05 + 0.13 * speed).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y - len); ctx.lineTo(x, y); ctx.stroke();
    }
    ctx.restore();
  };
}
