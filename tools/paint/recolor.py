"""LAB recolour of the body mask: keeps the photo's shading and reflections, changes only the paint.
The game does the same per pixel in public/paint.js (keep the two in step: the review sheets come from this file).

Lightness: the body's own L distribution (p2 / p50 / p98) is remapped onto the target's tone range, so dark creases,
panel shading and reflections keep their order and relative contrast. Chroma: the target's a/b, faded toward neutral in
highlights (specular reflections stay white) and a little in deep shadow. Finishes: gloss (as is), metallic (a bit more
contrast + fine flake noise), matte (highlights flattened, no white speculars).
"""
import numpy as np

from colorlab import hex2lab, lab2rgb


def tone_range(Lt):
    # where the target's darkest / brightest paint should land (a real black car still has bright reflections)
    lo = Lt - min(0.62 * Lt, 38)
    hi = Lt + (100 - Lt) * 0.8
    return max(2, lo), min(99, hi)


def body_stats(res):
    """p2/p50/p98 of the body lightness; for crushed-black photos the rows of the studio gradient."""
    L = res['lab'][..., 0]
    hard = res['hard']
    p = np.percentile(L[hard], [2, 50, 98])
    dark = None
    if p[1] < 18:
        ys = np.where(hard.any(1))[0]
        dark = (int(ys.min()), int(ys.max()))
        p = np.percentile(adjusted_L(L, dark)[hard], [2, 50, 98])
    return {'p': p, 'dark': dark}


def adjusted_L(L, dark):
    if not dark:
        return L
    # dark source photo: whole panels are crushed to pure black, there is no shading to keep. Add a soft studio
    # gradient (lighter on top, darker toward the sills) only where the photo is near-black.
    y0, y1 = dark
    yn = np.clip((np.arange(L.shape[0]) - y0) / max(y1 - y0, 1), 0, 1)[:, None]
    return L + (1 - np.clip(L / 30, 0, 1)) * (6 + 18 * (1 - yn) ** 1.5)


def flake(shape):
    # same integer hash as public/paint.js: ((i * 2654435761) >>> 0) & 255
    i = np.arange(shape[0] * shape[1], dtype=np.uint64)
    return ((((i * np.uint64(2654435761)) & np.uint64(0xffffffff)) & np.uint64(255)).astype(np.float64) / 255).reshape(shape)


def key_curve(Tl):
    """Green key photos (tools/paint/green.py): the mid-tone green body has real shading over its whole range, so
    the mapping can shape it per target. Very dark paints: the part above the median is pushed down with a power
    curve (deep black panels, the bright studio reflections stay); very light paints: the median sits a little below
    the paint's own lightness (so highlights have room to read as gloss) and the shadows are lifted.
    Returns (mid, gamma above the median, gamma below the median). Same numbers as keyCurve() in public/paint.js."""
    mid = Tl - (Tl - 70) * 0.35 if Tl > 70 else Tl
    g_up = 1 + 1.5 * (45 - Tl) / 45 if Tl < 45 else 1.0
    g_dn = 1 - 0.45 * (Tl - 60) / 40 if Tl > 60 else 1.0
    return mid, g_up, g_dn


def shade_lab(l, T, p, finish='gloss', soft=False, key=False):
    """Source lightness array -> Lab of the target colour T with the photo's shading."""
    p2, p50, p98 = p
    Tl = T[0]
    lo, hi = tone_range(Tl)
    u = np.clip((l - p2) / max(1, p50 - p2), 0, 1)
    t = np.clip((l - p50) / max(1, p98 - p50), 0, 1)
    if key:
        Tl, g_up, g_dn = key_curve(Tl)
        u, t = u ** g_dn, t ** g_up
    Ln = np.where(l < p50, lo + (Tl - lo) * u, Tl + (hi - Tl) * t)
    if soft and Tl > 60:  # dark photo, light colour: flatten the noisy deep shadows a bit
        Ln = np.where(Ln < Tl, Tl - (Tl - Ln) * 0.7, Ln)
    if finish == 'matte':
        Ln = Tl + (Ln - Tl) * np.where(Ln > Tl, 0.35, 0.8)
    elif finish == 'metallic':
        Ln = np.clip(Tl + (Ln - Tl) * np.where(Ln > Tl, 1.1, 1.15), 1, 99)
    up = np.clip((Ln - Tl) / max(hi - Tl, 1), 0, 1)
    dn = np.clip((Tl - Ln) / max(Tl - lo, 1), 0, 1)
    if finish == 'matte':
        s = 1 - 0.15 * dn
    elif finish == 'metallic':
        s = (1 - 0.7 * up ** 1.1) * (1 - 0.15 * dn)
    else:
        s = (1 - 0.8 * up ** 1.3) * (1 - 0.25 * dn)
    return np.stack([Ln, T[1] * s, T[2] * s], -1)


def smooth_body(l, m, r=2):
    from scipy import ndimage as ndi
    w = (m > 0).astype(np.float64)
    k = 2 * r + 1
    num = ndi.uniform_filter(l * w, k, mode='constant')
    den = ndi.uniform_filter(w, k, mode='constant')
    return np.where((w > 0) & (den > 0), num / np.maximum(den, 1e-9), l)


def recolor(res, target, finish='gloss', strength=1.0):
    st = body_stats(res)
    l = adjusted_L(res['lab'][..., 0], st['dark'])
    soft = st['p'][1] < 30
    if soft:  # dark photos are noisy in the shadows (same as public/paint.js)
        l = smooth_body(l, np.round(res['mask'] * 15))
    rgb = lab2rgb(shade_lab(l, hex2lab(target), st['p'], finish, soft))
    if finish == 'metallic':  # fine ±3% flake on the result
        rgb = np.clip(rgb * (1 + (flake(l.shape) - 0.5) * 0.06)[..., None], 0, 1)
    k = (res['mask'] * strength)[..., None]
    return res['rgb'] * (1 - k) + rgb * k
