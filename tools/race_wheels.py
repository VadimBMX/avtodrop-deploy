"""Wheel discs for the drag race (public/race-wheels.js): fits each wheel of every car photo and writes
public/race-wheels-data.js.

    python -I tools/race_wheels.py [--report out.json] [--only id,id]

For every photo in public/cars/*.webp and each wheel seed (paint/meta.json `wheels` when sane, else
tools/race_wheels_seeds.json):
  1. rim edge: along 360 rays from the seed centre, the outermost strong bright->dark step (rim lip -> tyre);
     a robust least-squares ellipse through those points gives the wheel's centre, axes and tilt (photos are
     slightly perspective, so many wheels are not circles).
  2. disc: that ellipse scaled out into the tyre band (never past the tyre), centre nudged +-2 px, picked by the
     wobble score below.
  3. wobble score: the disc's pixels in the wheel's own (circular) plane compared with themselves rotated by 30,
     45 and 90 degrees over the outer ring (0.55-1 of the disc: rim lip and tyre, the part that must not move when
     the wheel turns) - mean absolute luminance difference, 0-255. Spokes are inside the ring and do not count.
A wheel whose rim edge does not fit an ellipse, or that still wobbles after refining, is written as blur-only:
the race shows a spinning streak over it instead of turning the photo.
Output per car: [photo w, photo h, [[cx, cy, a, b, tilt deg, spin 1/0], ...]] with a, b the disc semi-axes along
the tilted x / y. Every number is in photo px.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / 'public'
GEOM_MAX = 3.5       # rim-lip swing (peak-to-peak, photo px; ~0.55 css px on the 146 px race car) to still turn
SEAM_MAX = 0.06      # share of the disc edge that is not tyre (arch / ground / background caught in the disc)
FIT_MAX = 0.035      # rim-edge ellipse RMS residual / rim radius above which the fit is not trusted
COVER_MIN = 0.45     # share of the rays that must land on the fitted rim edge
ANG = np.deg2rad(np.arange(360))


def lum(path):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)
    L = 0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]
    al = a[..., 3] / 255
    return L * al + 15 * (1 - al)  # transparent shows the dark race backdrop


def sample(L, x, y):
    return ndi.map_coordinates(L, [y, x], order=1, mode='nearest')


def fit_ellipse(x, y):
    """Direct least-squares ellipse (Fitzgibbon); returns cx, cy, a, b, tilt (rad) or None."""
    D = np.column_stack([x * x, x * y, y * y, x, y, np.ones_like(x)])
    Sm = D.T @ D
    C = np.zeros((6, 6)); C[0, 2] = C[2, 0] = 2; C[1, 1] = -1
    try:
        w, v = np.linalg.eig(np.linalg.solve(Sm, C))
    except np.linalg.LinAlgError:
        return None
    w = np.real(w); v = np.real(v)
    for i in np.argsort(-np.abs(w)):
        p = v[:, i]
        A, B, Cc, Dd, E, F = p
        if 4 * A * Cc - B * B <= 0:
            continue
        den = B * B - 4 * A * Cc
        cx = (2 * Cc * Dd - B * E) / den
        cy = (2 * A * E - B * Dd) / den
        M0 = np.array([[A, B / 2], [B / 2, Cc]])
        F0 = F + A * cx * cx + B * cx * cy + Cc * cy * cy + Dd * cx + E * cy
        ev, evec = np.linalg.eigh(M0)
        if np.any(ev * -F0 <= 0):
            continue
        ax = np.sqrt(-F0 / ev)
        # semi-axis along the more horizontal eigenvector = a
        i0 = int(np.argmax(np.abs(evec[0])))
        a, b = ax[i0], ax[1 - i0]
        t = math.atan2(evec[1, i0], evec[0, i0])
        if t > math.pi / 2: t -= math.pi
        if t < -math.pi / 2: t += math.pi
        return cx, cy, a, b, t
    return None


def ell_dist(x, y, e):
    cx, cy, a, b, t = e
    c, s = math.cos(t), math.sin(t)
    u = (x - cx) * c + (y - cy) * s
    v = -(x - cx) * s + (y - cy) * c
    rr = np.sqrt((u / a) ** 2 + (v / b) ** 2)
    return (rr - 1) * math.sqrt(a * b)  # ~px off the curve


def rim_edge(L, cx, cy, r):
    rho = np.arange(0.3 * r, 1.08 * r, 0.5)
    X = cx + np.cos(ANG)[:, None] * rho[None]
    Y = cy + np.sin(ANG)[:, None] * rho[None]
    P = sample(L, X.ravel(), Y.ravel()).reshape(X.shape)
    P = ndi.gaussian_filter1d(P, 1.5, axis=1)
    g = -np.gradient(P, axis=1)  # bright -> dark going outward
    pts = []
    lim = rho <= 0.97 * r
    for k in range(360):
        gk = np.where(lim, g[k], 0)
        m = gk.max()
        if m < 3:
            continue
        idx = np.where((gk > 0.55 * m) & (gk >= np.roll(gk, 1)) & (gk >= np.roll(gk, -1)))[0]
        if not len(idx):
            continue
        j = idx.max()
        pts.append((X[k, j], Y[k, j]))
    return np.array(pts)


def robust_fit(pts, r):
    if len(pts) < 40:
        return None, 1.0, 0.0, pts[:0]
    keep = np.ones(len(pts), bool)
    e = None
    for _ in range(6):
        e = fit_ellipse(pts[keep, 0], pts[keep, 1])
        if e is None:
            return None, 1.0, 0.0, pts[:0]
        d = np.abs(ell_dist(pts[:, 0], pts[:, 1], e))
        mad = np.median(d[keep]) + 1e-6
        keep = d < max(2.5 * 1.4826 * mad, 0.012 * r)
        if keep.sum() < 40:
            return None, 1.0, keep.mean(), pts[:0]
    d = ell_dist(pts[keep, 0], pts[keep, 1], e)
    rms = float(np.sqrt(np.mean(d * d)))
    return e, rms / math.sqrt(e[2] * e[3]), keep.sum() / 360, pts[keep]


def ring_img(L, cx, cy, a, b, t, ring):
    """Disc pixels in the wheel plane on the outer ring: rows = ring radii (share of the disc), cols = 360 angles."""
    c, s = math.cos(t), math.sin(t)
    U = np.cos(ANG)[None] * ring[:, None]
    V = np.sin(ANG)[None] * ring[:, None]
    x = cx + c * a * U - s * b * V
    y = cy + s * a * U + c * b * V
    return sample(L, x.ravel(), y.ravel()).reshape(U.shape)


def seam(L, cx, cy, a, b, t):
    """Share of the disc edge (outer 4 %) that is not tyre: pixels > 40 levels off the edge's median - an arch,
    the ground or the background caught in the disc, which would swing round when it turns."""
    ring = np.linspace(0.96, 1.0, 3)
    I = ring_img(L, cx, cy, a, b, t, ring).mean(0)
    return float(np.mean(np.abs(I - np.median(I)) > 40))


def seeds_for(meta, extra, cid):
    m = meta.get(cid) or {}
    ws = m.get('wheels') or []
    if ws and all(0.1 * m['h'] < q[2] < 0.3 * m['h'] for q in ws):
        return ws
    return extra.get(cid) or []


def p2p(pts, cx, cy, a, b, t):
    """How far the rim lip swings when the disc turns: peak-to-peak (5-95 %) of the lip's distance from the disc's
    own outline, photo px. A circle disc: a = b = None (radius = the median distance)."""
    if not len(pts):
        return None
    if a is None:
        d = np.hypot(pts[:, 0] - cx, pts[:, 1] - cy)
        d = d - np.median(d)
    else:
        d = ell_dist(pts[:, 0], pts[:, 1], (cx, cy, a, b, t))
    lo, hi = np.percentile(d, [5, 95])
    return float(hi - lo)


def solve(L, seed):
    cx0, cy0, r = seed
    H, W = L.shape
    pts = rim_edge(L, cx0, cy0, r)
    e, res, cover, inl = robust_fit(pts, r)
    ok_fit = e is not None and res < FIT_MAX and cover > COVER_MIN and 0.35 * r < math.sqrt(e[2] * e[3]) < 1.0 * r \
        and 0.78 < e[3] / e[2] < 1.22 and math.hypot(e[0] - cx0, e[1] - cy0) < 0.25 * r
    # the disc the race showed before: a circle of 0.86 r on the seed centre
    old = dict(geom=p2p(inl, cx0, cy0, None, None, 0) if ok_fit else None, seam=seam(L, cx0, cy0, 0.86 * r, 0.86 * r, 0.0))
    if not ok_fit:
        return dict(old=old, new=None, res=round(res, 4), cover=round(cover, 3), spin=0, disc=[cx0, cy0, 0.86 * r, 0.86 * r, 0.0])
    ecx, ecy, ea, eb, et = e
    rim = math.sqrt(ea * eb)
    best = None
    for sc in np.arange(1.05, max(1.06, min(1.22, 0.95 * r / rim)) + 1e-9, 0.02):
        a, b = ea * sc, eb * sc
        if ecx - a < 1 or ecx + a > W - 1 or ecy - b < 1 or ecy + b > H:
            continue
        sv = seam(L, ecx, ecy, a, b, et) + 0.3 * abs(sc - 1.1)  # a disc just outside the lip is best
        if best is None or sv < best[0]:
            best = (sv, a, b)
    if best is None:
        return dict(old=old, new=None, res=round(res, 4), cover=round(cover, 3), spin=0, disc=[cx0, cy0, 0.86 * r, 0.86 * r, 0.0])
    _, a, b = best
    new = dict(geom=p2p(inl, ecx, ecy, ea, eb, et), seam=seam(L, ecx, ecy, a, b, et))
    spin = int(new['geom'] <= GEOM_MAX and new['seam'] <= SEAM_MAX)
    return dict(old=old, new=new, res=round(res, 4), cover=round(cover, 3), spin=spin, disc=[ecx, ecy, a, b, math.degrees(et)])


def main():
    args = sys.argv[1:]
    report = args[args.index('--report') + 1] if '--report' in args else None
    only = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
    meta = json.loads((PUB / 'paint/meta.json').read_text())['cars']
    extra = {k: v for k, v in json.loads((ROOT / 'tools/race_wheels_seeds.json').read_text()).items() if k != '_'}
    out, rep = {}, {}
    for p in sorted((PUB / 'cars').glob('*.webp')):
        cid = p.stem
        if only and cid not in only:
            continue
        seeds = seeds_for(meta, extra, cid)
        if not seeds:
            continue
        L = lum(p)
        H, W = L.shape
        rows, rr = [], []
        for q in seeds:
            s = solve(L, q)
            cx, cy, a, b, t = s['disc']
            rows.append([round(cx, 1), round(cy, 1), round(a, 1), round(b, 1), round(t, 1), s['spin']])
            rr.append({k: v for k, v in s.items() if k != 'disc'})
        out[cid] = [W, H, rows]
        rep[cid] = rr
        print(cid, [[float(v) for v in r] for r in rows], json.dumps([(x['old'], x['new']) for x in rr]), flush=True)
    if not only:
        body = ',\n'.join(f"  '{k}': {json.dumps(v, separators=(', ', ': '))}" for k, v in out.items())
        (PUB / 'race-wheels-data.js').write_text(
            '// Generated by tools/race_wheels.py - do not edit by hand. Per car photo: [w, h, [[cx, cy, a, b, tilt deg, spin], ...]]\n'
            '// (photo px; a, b = disc semi-axes along the tilted x / y; spin 0 = blur-only: the photo is not turned).\n'
            f'export const WW_DATA = {{\n{body},\n}};\n')
    if report:
        Path(report).write_text(json.dumps(rep))


if __name__ == '__main__':
    main()
