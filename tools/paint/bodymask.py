"""Offline body-mask builder for АВТОДРОП car photos (side view, facing right, transparent bg, wheels on the bottom edge).

Only numpy / scipy / PIL. Steps:
  1. car = alpha > 0.5
  2. wheels: from the bottom silhouette (lowest opaque pixel per column) -> two arcs under the sill -> circle (cx, r)
  3. paint reference: median Lab of the door band (between the wheels, 50-75% of the height)
  4. paint likelihood per pixel: chromatic paint -> hue + chroma distance; neutral paint (black/white/silver) ->
     lightness band + low chroma
  5. exclusions: wheel disks, dark wheel-arch gaps, glass (greenhouse = upper region, dark/low-chroma blobs not
     connected to the body), small specks; manual hints from hints.json (polygons to add / remove, extra tolerances)
  6. clean-up: keep components touching the main body, fill holes smaller than ~0.02% of the car, feather 1 px.
Output: <id>.mask.png (8-bit soft mask, same size as the photo).
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(__file__))
from colorlab import rgb2lab  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def load(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(np.float64) / 255
    return a[..., :3], a[..., 3]


def refine_tyre(lab, car, cx, ground, r0):
    """Tyre fit: the circle (touching the ground at cx) whose lower half has dark rubber just inside and no rubber
    just outside. Low cars show only a sliver of the arc under the sill, so the silhouette alone over-sizes them."""
    H, W = car.shape
    L, C = lab[..., 0], np.hypot(lab[..., 1], lab[..., 2])
    dark = car & (L < 32) & (C < 14)
    th = np.linspace(0.08 * np.pi, 0.92 * np.pi, 48)  # lower half (screen y grows downwards)
    best, br = -1, r0
    for r in np.linspace(0.55, 1.25, 36) * r0:
        cy = ground - r
        def at(k):
            x = np.clip(np.round(cx + k * r * np.cos(th)).astype(int), 0, W - 1)
            y = np.clip(np.round(cy + k * r * np.sin(th)).astype(int), 0, H - 1)
            return dark[y, x]
        sc = np.mean(at(0.93) & ~at(1.07)) + 0.5 * np.mean(at(0.93))
        if sc > best + 1e-9:
            best, br = sc, r
    return br, best


def find_wheels(car, lab=None):
    H, W = car.shape
    ys = np.arange(H)[:, None]
    bottom = np.where(car.any(0), (car * ys).max(0), -1)  # lowest opaque row per column
    cols = np.where(bottom >= 0)[0]
    x0, x1 = cols.min(), cols.max()
    mid = bottom[x0 + (x1 - x0) * 2 // 5: x0 + (x1 - x0) * 3 // 5]
    sill = np.median(mid)
    low = bottom > sill + max(3, 0.01 * H)
    lab, n = ndi.label(low)
    runs = []
    for i in range(1, n + 1):
        xs = np.where(lab == i)[0]
        depth = bottom[xs].max() - sill
        runs.append((depth * len(xs), xs))
    runs.sort(key=lambda t: -t[0])
    wheels = []
    for _, xs in runs[:2]:
        yb = bottom[xs]
        ground = yb.max()
        depth = ground - sill
        # contact centre from a low chord (bumpers and skirts that merge into the run sit higher)
        sel = xs[yb >= ground - max(2, 0.12 * depth)]
        cx = (sel.min() + sel.max()) / 2
        # every silhouette point of the tyre arc gives r = (dx^2 + h^2) / 2h for a circle touching the ground at cx.
        # Estimate each side separately from the lower part of the arc and keep the smaller one: a bumper lip or a
        # side skirt next to the wheel only ever makes one side look wider.
        side = []
        for sgn in (-1, 1):
            pts = [x for x in xs if (x - cx) * sgn > 0]
            est = []
            for x in pts:
                h = ground - bottom[x]
                if max(2, 0.08 * depth) <= h <= 0.6 * depth:
                    est.append(((x - cx) ** 2 + h * h) / (2 * h))
            if len(est) >= 3:
                side.append(float(np.median(est)))
        r = min(side) if side else 0.3 * depth
        if lab is not None:
            rt, sc = refine_tyre(lab, car, cx, ground, r)
            if sc > 0.9:  # a clear dark ring; otherwise (black car, white-wall tyres) keep the silhouette estimate
                r = rt
        wheels.append([cx, ground, r])
    wheels.sort()
    # both wheels of a car are about the same size: a much bigger estimate is a skirt/bumper artefact
    if len(wheels) == 2:
        lo = min(w[2] for w in wheels)
        for w in wheels:
            w[2] = min(w[2], lo * 1.08)
    return [(cx, g - r, r) for cx, g, r in wheels], sill


def disk(shape, cx, cy, r):
    yy, xx = np.ogrid[:shape[0], :shape[1]]
    return (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r


def poly_mask(shape, polys, W, H):
    im = Image.new('L', (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(im)
    for p in polys:  # points as fractions of width/height
        d.polygon([(x * W, y * H) for x, y in p], fill=255)
    return np.asarray(im) > 0


def enclosed_glass(L, car, refL, sill, hint, wheels):
    """Light neutral paint: glass is as light and as grey as the paint, but every window is framed by dark seals.
    Light regions in the greenhouse that the dark trim closes off from the background are glass. Frames have small
    gaps, so the trim is thickened 1..4 px and the glass found at any thickness counts. Tall thin regions are
    painted pillars, not glass."""
    H, W = car.shape
    dark = car & (L < refL - hint.get('glass_dark', 22))
    # background = transparent pixels connected to the image border (see-through glass leaves holes inside the car)
    bl, bn = ndi.label(~car)
    border = set(np.unique(np.concatenate([bl[0], bl[-1], bl[:, 0], bl[:, -1]])).tolist()) - {0}
    outside = ndi.binary_dilation(np.isin(bl, list(border)), iterations=2)
    top = np.where(car.any(1))[0].min()
    belt = top + hint.get('belt', 0.62) * (sill - top)
    min_size = hint.get('glass_min', 0.002) * car.sum()
    # the window seal along the beltline is often too light to close the glass off from the door: add a wall on the
    # greenhouse row with the most dark pixels between the wheels
    x0, x1 = int(wheels[0][0]), int(wheels[-1][0])
    r0, r1 = int(top + 0.25 * (sill - top)), int(belt)
    if r1 > r0 + 2 and x1 > x0:
        prof = dark[r0:r1, x0:x1].sum(1)
        yb = r0 + int(np.argmax(prof))
        dark = dark.copy()
        dark[yb - 1:yb + 2, :] |= car[yb - 1:yb + 2, :]
    out = np.zeros_like(car)
    for k in range(1, hint.get('glass_k', 4) + 1):
        free = car & ~ndi.binary_dilation(dark, iterations=k)
        lbl, n = ndi.label(free)
        if not n:
            continue
        touching = set(np.unique(lbl[outside & free]).tolist())
        sizes = ndi.sum(free, lbl, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        for i, sl in enumerate(ndi.find_objects(lbl), 1):
            if i in touching or sizes[i - 1] < min_size or sl[0].stop - 1 > belt:
                continue
            h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            if w < 0.45 * h:
                continue
            keep[i] = True
        out |= ndi.binary_dilation(keep[lbl], iterations=k + 1)
    return out & car


def build(path, hint=None):
    hint = hint or {}
    rgb, alpha = load(path)
    H, W = alpha.shape
    car = alpha > 0.5
    lab = rgb2lab(rgb)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(A, B)
    wheels, sill = find_wheels(car, lab)
    if hint.get('wheels'):
        wheels = [tuple(w) for w in hint['wheels']]

    wheel = np.zeros_like(car)
    arch = np.zeros_like(car)
    for cx, cy, r in wheels:
        wheel |= disk(car.shape, cx, cy, r * hint.get('wheel_k', 1.03))
        arch |= disk(car.shape, cx, cy, r * 1.32) & (np.arange(H)[:, None] > cy - r * 1.32)

    # paint reference: door band between the wheels
    (rx, _, rr), (fx, _, fr) = wheels[0], wheels[-1]
    band = np.zeros_like(car)
    y0, y1 = hint.get('ref_band', (0.52, 0.72))
    band[int(y0 * H):int(y1 * H), int(rx + rr * 1.4):int(fx - fr * 1.4)] = True
    band &= car
    ref = np.median(lab[band], 0)
    refC = float(np.hypot(ref[1], ref[2]))
    # dark paints have little Lab chroma even when clearly coloured (dark green Civic): scale the threshold with L
    chromatic = refC > hint.get('chroma_min', max(6, min(14, 0.4 * ref[0])))

    if chromatic:
        hue = np.arctan2(B, A)
        rh = np.arctan2(ref[2], ref[1])
        dh = np.abs((hue - rh + np.pi) % (2 * np.pi) - np.pi)
        # desaturated pixels (reflections, highlights) have a noisy hue: widen the tolerance for them
        tol = np.radians(hint.get('hue_tol', 28)) * (1 + 0.8 * np.clip((refC - C) / refC, 0, 1))
        # paint: hue close and chroma at least ~30% of the reference (shadows/highlights keep some colour)
        like = np.clip(1 - dh / tol, 0, 1) * np.clip((C - hint.get('c_floor', 0.18) * refC) / (0.2 * refC), 0, 1)
        # bright desaturated reflections sitting on the paint (filled later by hole-fill if enclosed)
    else:
        lo, hi = hint.get('l_band', (ref[0] - 35, ref[0] + 30))
        # chroma distance from the reference's a/b (not from grey), so blue-grey and beige-grey paints stay whole
        dab = np.hypot(A - ref[1], B - ref[2])
        like = (np.clip((L - lo) / 6, 0, 1) * np.clip((hi - L) / 6, 0, 1)
                * np.clip((hint.get('neutral_c', 16) - dab) / 6, 0, 1))
    like *= car
    if not chromatic and ref[0] > 30 and hint.get('glass_auto', True):
        # light neutral paint (white, silver, grey): glass is as light and as grey as the paint, but every window is
        # framed by dark seals. Light regions fully enclosed by dark trim in the greenhouse are glass.
        like[enclosed_glass(L, car, ref[0], sill, hint, wheels)] = 0
    if chromatic:
        # the arch lip overlaps the outer tyre ring; rims (may be body-coloured, e.g. Mini) stay excluded
        inner = np.zeros_like(car)
        for cx, cy, r in wheels:
            inner |= disk(car.shape, cx, cy, r * 0.9)
        like[inner | (wheel & (like < 0.8))] = 0
        wheel = inner
    elif ref[0] > 30:
        # light neutral paint: in the outer tyre ring only the dark rubber is excluded, the fender lip stays paint
        inner = np.zeros_like(car)
        for cx, cy, r in wheels:
            inner |= disk(car.shape, cx, cy, r * 0.9)
        like[inner | (wheel & (L < 28))] = 0
        wheel = inner | (wheel & (L < 28))
    else:
        like[wheel] = 0

    # dark wheel-arch gaps (not for dark paint: there the arch lip is paint too)
    if ref[0] > 30:
        like[arch & (L < min(25, ref[0] - 25))] = 0

    m = like > 0.5
    for p in ('remove', 'add'):
        if hint.get(p):
            pm = poly_mask(car.shape, hint[p], W, H) & car & ~wheel
            if p == 'remove':
                m &= ~pm
                like[pm] = 0
            else:
                m |= pm
                like[pm] = 1
    m = ndi.binary_opening(m, iterations=1)
    lbl, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, lbl, range(1, n + 1))
        big = sizes.max()
        keep = [i + 1 for i, s in enumerate(sizes) if s >= hint.get('min_part', 0.004) * big]
        m = np.isin(lbl, keep)
    # fill small enclosed holes (reflections, specks) but not big ones (windows, badges, handles stay)
    holes = ndi.binary_fill_holes(m) & ~m
    hl, hn = ndi.label(holes)
    if hn:
        hs = ndi.sum(holes, hl, range(1, hn + 1))
        lim = hint.get('hole_max', 0.0006) * car.sum()
        small = [i + 1 for i, s in enumerate(hs) if s <= lim]
        fill = np.isin(hl, small)
        # only fill holes that are not very dark (badges/handles/grilles are dark or chrome-bright)
        m |= fill
    m &= car & ~wheel
    if hint.get('edge'):
        # dark photos: the cut-out's dark fringe along the roofline / upper outline leaves a ragged unpainted rim on
        # light paints. Close the body against the background (radius `edge` px) above `edge_y` (fraction of the
        # height; default: the top of the wheels), so thin gaps between the paint and the silhouette are painted.
        # Windows are not touched: they are bounded by the body, not by the background.
        ey = hint.get('edge_y', min(cy - r for _, cy, r in wheels) / H)
        k = int(hint['edge'])
        st = disk((2 * k + 1, 2 * k + 1), k, k, k)
        pad = np.pad(m | ~car, k + 1, constant_values=True)
        closed = ndi.binary_erosion(ndi.binary_dilation(pad, st), st)[k + 1:-k - 1, k + 1:-k - 1]
        closed &= car & ~wheel & (np.arange(H)[:, None] < ey * H)
        m |= closed
        if hint.get('rim'):
            # a grey matting halo a few px wide along the outline: paint the outer `rim` px wherever paint is near
            rim = hint['rim']
            band = (ndi.distance_transform_edt(car) <= rim) & ndi.binary_dilation(m, iterations=int(rim) + 2)
            m |= band & car & ~wheel & (np.arange(H)[:, None] < ey * H)
    if hint.get('remove'):
        m &= ~poly_mask(car.shape, hint['remove'], W, H)
    # grow 2 px into anti-aliased silhouette edges and dark panel gaps that still look like the paint
    grow = ndi.binary_dilation(m, iterations=2) & ((like > 0.12) | (alpha < 0.97)) & (alpha > 0.05) & ~wheel
    if hint.get('remove'):
        grow &= ~poly_mask(car.shape, hint['remove'], W, H)
    m = m | grow
    if hint.get('smooth'):
        # ragged paint/trim boundaries (noisy threshold on dark photos): majority filter of the hard mask
        m = (ndi.gaussian_filter(m.astype(np.float64), hint['smooth']) > 0.5) & car & ~wheel
        if hint.get('remove'):
            m &= ~poly_mask(car.shape, hint['remove'], W, H)
    soft = np.clip(ndi.gaussian_filter(m.astype(np.float64), 0.7), 0, 1) * (alpha > 0.05)
    if chromatic:
        # colour spill: thin seals, panel gaps and the arch lip carry a tint of the old paint (a red line around a
        # white car). Within 4 px of the body, any pixel with the paint's hue gets recoloured in proportion to it.
        hue = np.arctan2(B, A)
        dh = np.abs((hue - np.arctan2(ref[2], ref[1]) + np.pi) % (2 * np.pi) - np.pi)
        spill = np.clip(1 - dh / np.radians(45), 0, 1) * np.clip((C - 6) / 10, 0, 1)
        near = ndi.binary_dilation(m, iterations=4) & ~wheel
        if hint.get('remove'):
            near &= ~poly_mask(car.shape, hint['remove'], W, H)
        soft = np.maximum(soft, spill * near)
    return dict(rgb=rgb, alpha=alpha, lab=lab, mask=soft, hard=m, wheels=wheels, sill=sill, ref=ref,
                chromatic=chromatic, car=car)


def debug_image(res):
    rgb, alpha, m = res['rgb'], res['alpha'], res['hard']
    out = rgb.copy()
    out[m] = out[m] * 0.35 + np.array([0.0, 1.0, 0.3]) * 0.65
    img = Image.fromarray((np.dstack([out, alpha]) * 255).astype(np.uint8))
    bg = Image.new('RGBA', img.size, (40, 40, 48, 255))
    bg.alpha_composite(img)
    d = ImageDraw.Draw(bg)
    for cx, cy, r in res['wheels']:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 0, 255), width=2)
    return bg.convert('RGB')


if __name__ == '__main__':
    src, outdir = sys.argv[1], sys.argv[2]
    hints = json.load(open(os.path.join(HERE, 'hints.json'))) if os.path.exists(os.path.join(HERE, 'hints.json')) else {}
    for cid in sys.argv[3:]:
        res = build(os.path.join(src, cid + '.webp'), hints.get(cid))
        Image.fromarray((res['mask'] * 255).astype(np.uint8)).save(os.path.join(outdir, cid + '.mask.png'))
        debug_image(res).save(os.path.join(outdir, cid + '.debug.png'))
        print(cid, 'wheels', [(round(a), round(b), round(c)) for a, b, c in res['wheels']], 'ref', np.round(res['ref'], 1),
              'chromatic', res['chromatic'], 'body px', int(res['hard'].sum()), 'car px', int(res['car'].sum()))
