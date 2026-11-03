"""Generated car pictures (brief 183-240 + re-shots) -> game-ready cutouts, a review sheet and a problem report.

    python -I tools/cars-import/import.py <folder|archive.zip> [--out DIR] [--apply] [--force] [--only 183,190]
                                         [--rembg auto|always|never] [--sheet-only]

Per picture (183.png, 183f.png = force a mirror, bmw-m5-e60.png, "BMW M5 E60.jpg" ... any of png/jpg/webp):
  1. match it to its car in cars.json (by number, id, alias or name; the newest file wins a duplicate);
  2. background: modelled from the picture border (flat colour or a smooth gradient, grey #808080 as the brief asks,
     green #3FAE49 or anything else); the car is what is not reachable from the border in background colour, so
     green paint inside the body is never keyed; a soft alpha only on a thin edge band, colours un-mixed from the
     background there (no grey/green halo), green spill despilled where the edge is not paint (tyres, glass, chrome);
     background seen through the car: "glass" (kept semi-transparent) or "gap" (cleared); rembg (isnet) takes over
     the silhouette on hard cases (background in the key colour, uneven background, key and model disagree);
  3. floor / shadow under the tyres removed, the car levelled on its wheels, turned to face right like every photo in
     public/cars (silhouette compared with the existing cars + red tail lights on the green body);
  4. cropped to the car, scaled (canvas ~900 px wide, never upscaled) and put on the game canvas exactly as
     tools/normalize_cars.py does (2.5:1, wheels on the bottom edge, the car touching the sides), webp q86;
  5. problems per picture -> report.json: wrong_angle, cropped, background_left, background_not_flat, low_resolution,
     text_or_logo, wrong_car, not_key_green, green_parts, see_through_glass, facing_uncertain (+ info: flipped,
     levelled, shadow_removed, rembg). error = regenerate, warn = look at the sheet, info = fixed automatically;
  6. contact sheet(s) sheet-NN.jpg: picture | cutout | factory colour (after register) | 2 cars of the same class.
--apply copies every cutout without an error (all with --force) to public/cars/<id>.webp (the green photo; register.mjs
then bakes the factory colour and makes the paint mask). --sheet-only redraws the sheets from report.json.
Needs numpy, scipy, pillow (+ tesseract for text, rembg or the onnx shim for hard cases; both optional).
"""
import datetime
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'paint'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from colorlab import rgb2lab  # noqa: E402
from bodymask import find_wheels  # noqa: E402
from normalize_cars import CANVAS_RATIO, fit_canvas  # noqa: E402

TARGET_W = 900          # canvas width of a new photo (existing photos: p5-p95 757-939 px, median 870)
LOWRES_WARN = 760       # car length in the source below this -> warn (the photo would be upscaled / soft)
LOWRES_ERR = 560
WORK_MAX = 2400         # pictures wider than this are processed at this width (the output is 900 px anyway)
KEY_HUE = (95, 205)     # Lab hue window of the key green (as tools/paint/green.py)
EXTS = ('.png', '.jpg', '.jpeg', '.webp')
DARK_BG = (27, 30, 38)
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:  # noqa: BLE001
    pass


# ------------------------------------------------------------------ catalogue / matching
def slugify(s):
    tr = dict(zip('абвгґдеєжзиіїйклмнопрстуфхцчшщьюяыэъё',
                  ['a', 'b', 'v', 'h', 'g', 'd', 'e', 'ie', 'zh', 'z', 'y', 'i', 'i', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'r',
                   's', 't', 'u', 'f', 'kh', 'ts', 'ch', 'sh', 'sch', '', 'iu', 'ia', 'y', 'e', '', 'e']))
    import unicodedata
    s = ''.join(tr.get(c, c) for c in s.lower())
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def load_catalog(path=None):
    return json.load(open(path or os.path.join(HERE, 'cars.json'), encoding='utf-8'))['cars']


def match_files(folder, cars, only=None):
    """-> {car id: (path, force_flip)}, unmatched [paths], duplicates [(path, id)]"""
    by_n = {c['n']: c for c in cars}
    keys = {}
    for c in cars:
        for k in [c['id'], slugify(c['name'])] + c.get('alias', []):
            keys[k] = c
    files = []
    for dp, _, fs in os.walk(folder):
        if os.sep + '__MACOSX' in dp:
            continue
        files += [os.path.join(dp, f) for f in fs if f.lower().endswith(EXTS) and not f.startswith('.')]
    found, unmatched, dup = {}, [], []
    for p in sorted(files, key=lambda p: os.path.getmtime(p)):  # oldest first: a newer file replaces it
        stem = os.path.splitext(os.path.basename(p))[0].strip()
        flip = False
        c = None
        m = re.match(r'^0*(\d{1,3})(f?)(?!\d)', stem.lower())
        if m and int(m.group(1)) in by_n:
            c, flip = by_n[int(m.group(1))], m.group(2) == 'f'
        else:
            s = slugify(stem)
            if s.endswith('-f') and s[:-2] in keys:
                s, flip = s[:-2], True
            s2 = re.sub(r'-(\d|v\d+|copy|final)$', '', s)
            c = keys.get(s) or keys.get(s2)
            if not c:
                near = difflib.get_close_matches(s, list(keys), n=1, cutoff=0.82)
                c = keys[near[0]] if near else None
        if not c:
            unmatched.append(p)
            continue
        if only and str(c['n']) not in only and c['id'] not in only:
            continue
        if c['id'] in found:
            dup.append((found[c['id']][0], c['id']))
        found[c['id']] = (p, flip)
    return found, unmatched, dup


# ------------------------------------------------------------------ library of existing photos (facing / scale refs)
def profile(alpha, n=64):
    a = alpha > 128
    ys, xs = np.where(a)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    H, W = a.shape
    cols = np.linspace(0, W - 1, n).astype(int)
    top = np.array([np.argmax(a[:, c]) if a[:, c].any() else H for c in cols]) / H
    rows = np.linspace(0, H - 1, 24).astype(int)
    left = np.array([np.argmax(a[r]) if a[r].any() else W for r in rows]) / W
    right = np.array([np.argmax(a[r][::-1]) if a[r].any() else W for r in rows]) / W
    return np.concatenate([top, left * 0.7, right * 0.7])


def mirror_profile(p, n=64):
    return np.concatenate([p[:n][::-1], p[n + 24:], p[n:n + 24]])


class Library:
    """Every photo in public/cars (all face right, transparent, wheels on the bottom edge) -> silhouette profiles."""

    def __init__(self, root, exclude=()):
        self.dir = os.path.join(root, 'public', 'cars')
        cache = os.path.join(HERE, 'out', '.library.json')
        names = sorted(f[:-5] for f in os.listdir(self.dir) if f.endswith('.webp'))
        stamp = {n: os.path.getmtime(os.path.join(self.dir, n + '.webp')) for n in names}
        data = {}
        try:
            data = json.load(open(cache))
        except (OSError, ValueError):
            pass
        changed = False
        for n in names:
            if data.get(n, {}).get('t') != stamp[n]:
                a = np.asarray(Image.open(os.path.join(self.dir, n + '.webp')).convert('RGBA'))[..., 3]
                ys, xs = np.where(a > 128)
                data[n] = {'t': stamp[n], 'p': profile(a).round(4).tolist(),
                           'hl': round(float((ys.max() - ys.min() + 1) / (xs.max() - xs.min() + 1)), 4)}
                changed = True
        data = {n: data[n] for n in names}
        if changed:
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            json.dump(data, open(cache, 'w'))
        self.ids = [n for n in names if n not in exclude]
        self.P = np.array([data[n]['p'] for n in self.ids])
        self.hl = {n: data[n]['hl'] for n in names}
        # typical distance of a photo to its 5 nearest neighbours (leave-one-out): the "is this a side view" yardstick
        D = np.linalg.norm(self.P[:, None] - self.P[None], axis=2)
        np.fill_diagonal(D, np.inf)
        self.nn = np.sort(D, axis=1)[:, :5].mean(1)

    def facing(self, alpha):
        """> 0: faces right like the library; < 0: faces left. Also the side-view outlier score (1 = typical)."""
        p = profile(alpha)
        d0 = np.sort(np.linalg.norm(self.P - p, axis=1))[:5].mean()
        d1 = np.sort(np.linalg.norm(self.P - mirror_profile(p), axis=1))[:5].mean()
        return float((d1 - d0) / (d1 + d0 + 1e-9)), float(min(d0, d1) / np.percentile(self.nn, 95))


def models_info(root):
    code = ("import { pathToFileURL } from 'node:url';"
            "const S = await import(pathToFileURL(process.argv[1]).href);"
            "console.log(JSON.stringify([...Object.values(S.MODELS), ...Object.values(S.PENDING_MODELS)]"
            ".filter((m) => !m.secret).map((m) => ({ id: m.id, cls: m.cls, body: m.body, name: m.name }))));")
    try:
        out = subprocess.run(['node', '--input-type=module', '-e', code, os.path.join(root, 'public', 'shared.js')],
                             capture_output=True, text=True, check=True, timeout=60)
        return {m['id']: m for m in json.loads(out.stdout)}
    except Exception as e:  # noqa: BLE001
        print('  (could not read shared.js for the reference cars:', e, ')')
        return {}


# ------------------------------------------------------------------ rembg (optional)
_REMBG = []


def rembg_mask(img):
    """isnet mask 0..1 or None. Real rembg (pip install "rembg[cpu]") or the onnx shim (env CARS_IMPORT_REMBG=dir)."""
    if not _REMBG:
        sess = None
        extra = os.environ.get('CARS_IMPORT_REMBG')
        if extra and extra not in sys.path:
            sys.path.insert(0, extra)
        try:
            from rembg import new_session  # noqa: PLC0415
            sess = new_session('isnet-general-use')
        except Exception as e:  # noqa: BLE001
            print('  rembg not available:', type(e).__name__, str(e)[:80])
        _REMBG.append(sess)
    s = _REMBG[0]
    if s is None:
        return None
    if hasattr(s, 'mask'):
        m = s.mask(img)
    else:
        m = s.predict(img.convert('RGB'))[0]
    return np.asarray(m.convert('L').resize(img.size, Image.BILINEAR)).astype(np.float64) / 255


# ------------------------------------------------------------------ helpers
def disk_struct(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def largest_with_parts(mask, keep_frac=0.0005):
    """Largest component + the pieces right next to it (a bumper tip, mirror or wing split off by a thin seam in the
    background colour): any component of at least keep_frac of the main one within ~1.5 % of its length."""
    lab, n = ndi.label(mask)
    if n == 0:
        return mask, 0, 0
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    big = int(np.argmax(sizes)) + 1
    main = lab == big
    if n == 1:
        return main, 0, 0
    xs = np.where(main.any(0))[0]
    reach = max(12, 0.015 * (xs[-1] - xs[0] + 1))
    dist = ndi.distance_transform_edt(~main)
    keep, dropped = [big], 0
    for i in range(1, n + 1):
        if i == big:
            continue
        near = ndi.minimum(dist, lab, i) <= reach
        if near and sizes[i - 1] >= max(20, keep_frac * sizes[big - 1]):
            keep.append(i)
        else:
            dropped += int(sizes[i - 1])
    return np.isin(lab, keep), dropped, n - len(keep)


def bg_model(lab, b):
    """Background Lab map from the border frame: a robust quadratic surface per channel. -> map, spread (dE p95)."""
    H, W = lab.shape[:2]
    m = np.zeros((H, W), bool)
    m[:b], m[-b:], m[:, :b], m[:, -b:] = True, True, True, True
    ys, xs = np.where(m)
    step = max(1, len(ys) // 20000)
    ys, xs = ys[::step], xs[::step]
    v = lab[ys, xs]
    med = np.median(v, 0)
    keep = np.linalg.norm(v - med, axis=1) < max(8, 3 * np.median(np.linalg.norm(v - med, axis=1)) + 2)
    u, w = xs / W - 0.5, ys / H - 0.5
    A = np.column_stack([np.ones_like(u), u, w, u * u, u * w, w * w])
    coef = []
    for c in range(3):
        sel = keep.copy()
        for _ in range(2):
            k, *_ = np.linalg.lstsq(A[sel], v[sel, c], rcond=None)
            r = v[:, c] - A @ k
            sel = keep & (np.abs(r) < max(2.5, 3 * np.median(np.abs(r[sel]))))
        coef.append(k)
    yy, xx = np.mgrid[0:H, 0:W]
    U, Wv = xx / W - 0.5, yy / H - 0.5
    B = np.stack([c[0] + c[1] * U + c[2] * Wv + c[3] * U * U + c[4] * U * Wv + c[5] * Wv * Wv for c in coef], -1)
    Bb = B[ys, xs]
    flat_spread = float(np.percentile(np.linalg.norm(Bb - med, axis=1), 98))
    resid = float(np.percentile(np.linalg.norm(v[keep] - B[ys[keep], xs[keep]], axis=1), 95))
    border_bad = float(1 - keep.mean())  # share of the frame that is not background (car or junk on the edge)
    return B, med, flat_spread, resid, border_bad


def lab_hue_chroma(lab):
    return np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360, np.hypot(lab[..., 1], lab[..., 2])


def tesseract_words(img):
    """Words tesseract reads with confidence (text / watermark / plate check). [] when tesseract is missing."""
    if not shutil.which('tesseract'):
        return None
    tmp = os.path.join(HERE, 'out', f'.ocr-{os.getpid()}.png')
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    im = img.convert('L')
    if im.width > 1800:
        im = im.resize((1800, round(im.height * 1800 / im.width)), Image.LANCZOS)
    im.save(tmp)
    try:
        out = subprocess.run(['tesseract', tmp, '-', '--psm', '11', 'tsv'], capture_output=True, text=True, timeout=60).stdout
    except Exception:  # noqa: BLE001
        return None
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    words = []
    for line in out.splitlines()[1:]:
        f = line.split('\t')
        if len(f) == 12 and f[11].strip():
            t, conf = f[11].strip(), float(f[10])
            alnum = re.sub(r'[^0-9A-Za-zА-Яа-яІіЇїЄє]', '', t)
            if conf >= 85 and len(alnum) >= 4 and not re.fullmatch(r'(.)\1+', alnum):
                words.append({'text': t, 'conf': round(conf), 'box': [int(f[6]), int(f[7]), int(f[8]), int(f[9])]})
    return words


# ------------------------------------------------------------------ the cutout
def cut_car(path, car, lib, opts, override):
    P = []  # problems

    def prob(code, sev, msg):
        P.append({'code': code, 'sev': sev, 'msg': msg})

    src = Image.open(path)
    src.load()
    src_size = src.size
    img = src.convert('RGB')
    scale0 = 1.0
    if img.width > WORK_MAX:
        scale0 = WORK_MAX / img.width
        img = img.resize((WORK_MAX, round(img.height * scale0)), Image.LANCZOS)
    rgb = np.asarray(img).astype(np.float64) / 255
    H, W = rgb.shape[:2]
    lab = rgb2lab(rgb)
    hue, chroma = lab_hue_chroma(lab)

    # ---- background
    b = max(4, round(0.012 * min(H, W)))
    B, bmed, spread, resid, border_bad = bg_model(lab, b)
    bh, bc = (np.degrees(np.arctan2(bmed[2], bmed[1])) % 360, float(np.hypot(bmed[1], bmed[2])))
    bg_kind = 'grey' if bc < 10 else ('green' if KEY_HUE[0] < bh < KEY_HUE[1] and bc > 18 else 'colour')
    d = np.linalg.norm(lab - B, axis=-1)
    noise = max(1.0, resid)
    t_lo = max(5.0, 2.2 * noise)
    t_hi = t_lo + 14
    t_mid = (t_lo + t_hi) / 2
    if spread > 4.5:
        prob('background_not_flat', 'warn', f'background is not one flat colour (spread dE {spread:.0f}: gradient, vignette or floor)')

    # ---- colour key: background = bg-coloured pixels reachable from the border
    low = d < t_mid
    lab_low, _ = ndi.label(low)
    edge_ids = np.unique(np.concatenate([lab_low[0], lab_low[-1], lab_low[:, 0], lab_low[:, -1]]))
    edge_ids = edge_ids[edge_ids > 0]
    outside = np.isin(lab_low, edge_ids)
    solid_key, dropped_px, dropped_n = largest_with_parts(~outside)
    method = 'key'

    # ---- hard cases: the silhouette from rembg
    mode = opts.get('rembg', 'auto')
    if override.get('rembg'):
        mode = 'always'
    hard_why = []
    if bg_kind == 'green':
        hard_why.append('background in the key green')
    if resid > 6:
        hard_why.append('uneven background')
    if solid_key.mean() > 0.85 or solid_key.mean() < 0.03:
        hard_why.append('key found no car')
    ml = None
    model_shadow = 0
    if mode in ('always', 'auto'):  # auto: whenever rembg is installed (~4 s a picture); key only without it
        ml = rembg_mask(img)
    solid = solid_key
    iou = None
    if ml is not None:
        mlb = ml > 0.5
        mlb, _, _ = largest_with_parts(mlb)
        iou = float((mlb & solid_key).sum() / max(1, (mlb | solid_key).sum()))
        if hard_why or iou < 0.9:
            # model silhouette, but bg-coloured holes the key sees (gaps, see-through glass) stay holes
            filled = ndi.binary_fill_holes(mlb)
            solid = mlb | (filled & ~low)
            solid = ndi.binary_opening(solid, disk_struct(1))
            solid, dropped_px, dropped_n = largest_with_parts(solid)
            method = 'rembg'
            prob('rembg', 'info', 'silhouette from rembg (' + (', '.join(hard_why) or f'key/rembg overlap {iou:.2f}') + ')')
        else:
            # key silhouette; where the body edge is close to the background colour (a dark crease against grey)
            # the key is weak: the model decides those pixels
            weak = d < t_hi + 6
            near = ndi.binary_dilation(solid_key, disk_struct(4)) & ~ndi.binary_erosion(solid_key, disk_struct(4))
            solid = (solid_key & ~(near & weak & (ml < 0.15))) | (near & weak & (ml > 0.6))
            solid, dropped_px, dropped_n = largest_with_parts(solid)
            method = 'key+rembg'
        ysk = np.where(solid_key.any(1))[0]
        if len(ysk):
            zone = np.zeros_like(solid)
            zone[ysk[0] + int(0.65 * (ysk[-1] - ysk[0])):] = True
            model_shadow = int((solid_key & ~solid & zone).sum())
    elif hard_why and mode != 'never':
        prob('background_left', 'warn', 'hard background (' + ', '.join(hard_why) + ') and no rembg: check the edges')

    if solid.sum() < 0.02 * H * W:
        prob('wrong_car', 'error', 'no car found in the picture')
        return None, P, {}

    # ---- cropped: the car touches the picture edge
    touch = {'top': solid[0].mean(), 'bottom': solid[-1].mean(), 'left': solid[:, 0].mean(), 'right': solid[:, -1].mean()}
    cut_sides = [k for k, v in touch.items() if v > 0.004]
    if cut_sides:
        prob('cropped', 'error', 'the car touches the picture edge (' + ', '.join(cut_sides) + '): something is cut off')

    # ---- background seen through the car: gaps (cleared) vs glass (kept semi-transparent)
    ys, xs = np.where(solid)
    cy0, cy1, cx0, cx1 = ys.min(), ys.max(), xs.min(), xs.max()
    ch = cy1 - cy0 + 1
    area = solid.sum()
    gy_, gx_ = np.gradient(ndi.gaussian_filter(lab[..., 0], 1.0))
    flat = np.hypot(gx_, gy_) < 1.5
    inner = solid & (d < t_lo) & flat
    inner = ndi.binary_opening(inner, disk_struct(2))
    wh0, _ = find_wheels(solid, lab)
    yy0, xx0 = np.ogrid[:H, :W]
    for wcx, wcy, wr in wh0:
        inner &= (xx0 - wcx) ** 2 + (yy0 - wcy) ** 2 > (1.05 * wr) ** 2
    hl, hn = ndi.label(inner)
    glass = np.zeros_like(solid)
    gaps = np.zeros_like(solid)
    see = gap_px = 0
    key_green = solid & (chroma > 20) & (hue > KEY_HUE[0]) & (hue < KEY_HUE[1])
    for i, sl in enumerate(ndi.find_objects(hl), 1):
        m = hl[sl] == i
        n = m.sum()
        if n < 0.0004 * area:
            continue
        yc = (sl[0].start + sl[0].stop) / 2
        in_cabin = cy0 + 0.05 * ch < yc < cy0 + 0.6 * ch
        # framed by paint = a grey reflection on the body (keep it); framed by seals / pillars / chrome = see-through
        reg = np.zeros_like(solid)
        reg[sl] = m
        ring = ndi.binary_dilation(reg, disk_struct(3)) & ~reg & solid
        on_paint = (key_green & ring).sum() / max(1, ring.sum())
        if on_paint > 0.5 and not override.get('gaps'):
            continue
        kind = override.get('gaps') or ('glass' if in_cabin and n > 0.002 * area else 'gap')
        if kind == 'glass':
            glass |= reg
            see += n
        elif kind == 'transparent':
            gaps |= reg
        elif np.median(d[sl][m]) < 0.6 * t_lo:
            gap_px += n
    if gap_px > 0.004 * area:
        prob('background_left', 'warn', f'background colour inside the car outside the windows ({gap_px / area:.1%}): a gap '
             '(under a wing?) kept opaque; clear it with overrides.json {"<n>": {"gaps": "transparent"}}')
    if see > 0.004 * area:
        prob('see_through_glass', 'warn', f'background visible through the windows ({see / area:.1%} of the car): kept as '
             'semi-transparent tinted glass; regenerate if it looks wrong')

    # ---- alpha: solid inside, soft only on a thin band at the silhouette, colours un-mixed there
    solid_h = solid & ~gaps
    er = ndi.binary_erosion(solid_h, disk_struct(2))
    di = ndi.binary_dilation(solid_h, disk_struct(1))
    band = di & ~er
    a_key = np.clip((d - t_lo) / (t_hi - t_lo), 0, 1)
    alpha = solid_h.astype(np.float64)
    if method == 'rembg':
        a_edge = np.maximum(a_key, np.clip((ml - 0.25) / 0.5, 0, 1)) if bg_kind != 'green' else np.clip((ml - 0.2) / 0.6, 0, 1)
    elif ml is not None:
        a_edge = np.where(d < t_hi + 6, np.clip((ml - 0.2) / 0.6, 0, 1), a_key)
    else:
        a_edge = a_key
    alpha[band] = a_edge[band]
    soft = ndi.gaussian_filter(alpha, 0.7)
    alpha[band] = soft[band]
    pin = ndi.binary_fill_holes(alpha > 0.5) & (alpha <= 0.5) & ~glass & ~gaps
    pl, pn = ndi.label(pin)
    if pn:
        small = np.isin(pl, 1 + np.where(ndi.sum(pin, pl, range(1, pn + 1)) <= 12)[0])
        alpha[small] = 1
    alpha[glass] = np.clip(0.55 + 0.45 * a_key[glass], 0.55, 0.85)
    alpha[~di] = 0
    Brgb = rgb_from_lab(B)
    out = rgb.copy()
    mix = (alpha > 0.02) & (alpha < 0.98)
    a3 = np.maximum(alpha[mix], 0.02)[:, None]
    unmixed = np.clip((rgb[mix] - (1 - a3) * Brgb[mix]) / a3, 0, 1)
    # un-mixing is unstable at low alpha (noise / soft highlights blow up into light wisps): there the colour comes
    # from the nearest solid pixel inside the car, blended into the un-mixed colour as alpha grows
    core = (alpha >= 0.98) & ~glass
    if core.any():
        _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
        inside = rgb[iy[mix], ix[mix]]
        t = np.clip((alpha[mix] - 0.35) / 0.4, 0, 1)[:, None]
        out[mix] = unmixed * t + inside * (1 - t)
    else:
        out[mix] = unmixed
    out[glass] = np.clip((rgb[glass] - (1 - alpha[glass])[:, None] * Brgb[glass]) / alpha[glass][:, None], 0, 1) * 0.55 + 0.03
    # despill: green on edge pixels that are not paint (tyres, glass, chrome against the background)
    green = solid & (chroma > 20) & (hue > KEY_HUE[0]) & (hue < KEY_HUE[1])
    near_paint = ndi.binary_dilation(green, disk_struct(3))
    sp = (band | glass) & ~near_paint
    mx = np.maximum(out[..., 0], out[..., 2])
    out[..., 1] = np.where(sp & (out[..., 1] > mx), mx, out[..., 1])
    if bg_kind == 'green':  # a green background leaves spill on everything near the outline
        ring = band & ~ndi.binary_erosion(green, disk_struct(2))
        out[..., 1] = np.where(ring & (out[..., 1] > mx + 0.02) & (alpha < 0.9), mx + 0.02, out[..., 1])
    alpha[alpha < 0.02] = 0

    # ---- floor / shadow under the car
    carm = alpha > 0.5
    shadow_px, ml = remove_floor(carm, alpha, lab, B, ml, img, mode)
    shadow_px += model_shadow
    if shadow_px > 0.004 * area:
        prob('shadow_removed', 'info', f'shadow/floor under the car removed ({shadow_px / area:.1%} of the car)')
    carm = alpha > 0.5
    if not carm.any():
        prob('wrong_car', 'error', 'nothing left after removing the background')
        return None, P, {}

    # ---- level on the wheels
    wheels, _ = find_wheels(carm, lab)
    lvl = 0.0
    if len(wheels) == 2:
        (x1, y1, r1), (x2, y2, r2) = wheels
        ang = np.degrees(np.arctan2((y2 + r2) - (y1 + r1), x2 - x1))
        if 0.4 < abs(ang) <= 4:
            lvl = float(ang)
        elif abs(ang) > 4:
            prob('wrong_angle', 'warn', f'the wheels are not on one level ({ang:.1f} deg): tilted or not a side view')
    rgba = np.dstack([out, alpha])
    im = Image.fromarray(np.round(rgba * 255).astype(np.uint8), 'RGBA')
    if lvl:
        im = im.rotate(lvl, resample=Image.BICUBIC, expand=True)
        prob('levelled', 'info', f'levelled on its wheels ({lvl:+.1f} deg)')

    # ---- crop, facing, scale, canvas
    bbox = im.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    im = im.crop(bbox)
    a8 = np.asarray(im)[..., 3]
    car_len_src = im.width / scale0
    score, outlier = lib.facing(a8)
    red = red_light_score(np.asarray(im).astype(np.float64) / 255)
    s = score + (0.35 * red if red is not None else 0)
    flip = s < 0
    if override.get('flip') is not None:
        flip = bool(override['flip'])
    elif opts.get('force_flip'):
        flip = True
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
        prob('flipped', 'info', 'mirrored to face right like the other photos')
    if abs(s) < 0.08 and override.get('flip') is None and not opts.get('force_flip'):
        prob('facing_uncertain', 'warn', f'not sure which way the car faces (score {s:+.2f}): check the sheet; '
             'force with 183f.png or overrides.json {"183": {"flip": true}}')
    if outlier > 1.6:
        prob('wrong_angle', 'warn' if outlier < 2.4 else 'error',
             f'the silhouette is unlike any side-view photo in the game ({outlier:.1f}x the usual distance): 3/4 view, '
             'perspective or a cut-off part')

    hl_ratio = im.height / im.width
    k = min(1.0, TARGET_W / max(im.width, im.height * CANVAS_RATIO))
    if k < 1:
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    if car_len_src < LOWRES_ERR:
        prob('low_resolution', 'error', f'the car is only {car_len_src:.0f} px long in the picture (need >= {LOWRES_WARN})')
    elif car_len_src < LOWRES_WARN:
        prob('low_resolution', 'warn', f'the car is {car_len_src:.0f} px long in the picture: the photo will be soft')
    # the existing photos sit hard on the bottom and side edges (alpha 255 there): drop the faint feather rows
    b128 = im.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
    if b128:
        im = im.crop((b128[0], 0, b128[2], b128[3]))
    canvas = fit_canvas(im)

    # ---- body: key green coverage, green wheels / glass
    fin = np.asarray(canvas).astype(np.float64) / 255
    fa = fin[..., 3] > 0.5
    flab = rgb2lab(fin[..., :3])
    fh, fc = lab_hue_chroma(flab)
    fgreen = fa & (fc > 20) & (fh > KEY_HUE[0]) & (fh < KEY_HUE[1])
    gshare = fgreen.sum() / max(1, fa.sum())
    fw, _ = find_wheels(fa, flab)
    if gshare < 0.15:
        prob('not_key_green', 'error' if not car.get('allow_plain') else 'warn',
             f'only {gshare:.0%} of the car is the key green: it cannot be repainted (regenerate with one green body)')
    elif gshare < 0.3:
        prob('not_key_green', 'warn', f'only {gshare:.0%} of the car is key green (two-tone, carbon or decals?)')
    for cx, cy, r in fw:
        yy, xx = np.ogrid[:fa.shape[0], :fa.shape[1]]
        dm = ((xx - cx) ** 2 + (yy - cy) ** 2 <= (0.8 * r) ** 2) & fa
        if dm.sum() and (fgreen & dm).sum() / dm.sum() > 0.25:
            prob('green_parts', 'error', 'green wheels: the rims would be repainted with the body (regenerate)')
            break

    # ---- body type / wrong car (silhouette proportions vs cars of the same body in the game)
    ref = car.get('_body_hl')
    if ref and ref[2] >= 4:
        mu, sd = ref[0], max(ref[1], 0.025)
        z = (hl_ratio - mu) / sd
        if z > 2.8 and hl_ratio / mu > 1.3:
            prob('wrong_angle', 'warn', f'far too tall for a side view of a {car.get("body")} (height/length {hl_ratio:.2f}, '
                 f'{car.get("body")}s in the game {mu:.2f}+-{sd:.2f}): 3/4 view, perspective or the wrong car')
        elif abs(z) > 2.6:
            prob('wrong_car', 'warn', f'proportions unlike a {car.get("body")} (height/length {hl_ratio:.2f}, '
                 f'{car.get("body")}s in the game {mu:.2f}+-{sd:.2f}): wrong model or body type?')
    if hl_ratio > 0.62:
        prob('wrong_angle', 'error', f'height/length {hl_ratio:.2f}: not a side view')

    # ---- junk outside the car (text, logos, watermark sparkle) and text on the picture
    junk = (d > t_hi + 8) & ~ndi.binary_dilation(solid, disk_struct(8))
    jl, jn = ndi.label(junk)
    js = ndi.sum(junk, jl, range(1, jn + 1)) if jn else []
    junk_n = int(sum(1 for v in js if v > max(25, 0.00003 * H * W)))
    if junk_n:
        prob('text_or_logo', 'warn', f'{junk_n} mark(s) on the background (text, logo or watermark) — removed with it')
    words = tesseract_words(img) if opts.get('ocr', True) else None
    if words:
        # spokes and tyre lettering read as words: ignore anything inside a wheel
        k_ocr = W / min(W, 1800)
        words = [w for w in words if not in_wheel(w, k_ocr, wh0)]
    if words:
        on_car = [w['text'] for w in words]
        strong = len(on_car) >= 2 or any(len(re.sub(r'[^0-9A-Za-zА-Яа-яІіЇїЄє]', '', t)) >= 5 for t in on_car)
        prob('text_or_logo', 'error' if strong else 'warn',
             'text in the picture: ' + ', '.join(on_car[:6]) + ' (badges, plate or watermark: regenerate)')
    if dropped_n and dropped_px > 0.002 * area:
        prob('background_left', 'info', f'{dropped_n} loose piece(s) next to the car dropped')
    # bg-coloured opaque pixels hugging the silhouette = a halo / leftover background
    halo = (np.linalg.norm(flab - np.array(bmed), axis=-1) < t_lo) & fa & ~ndi.binary_erosion(fa, disk_struct(3))
    rim = fa & ~ndi.binary_erosion(fa, disk_struct(3))
    if rim.sum() and halo.sum() / rim.sum() > 0.12:
        prob('background_left', 'warn', f'background colour on {halo.sum() / rim.sum():.0%} of the outline: halo or leftover background')

    info = {'src_size': list(src_size), 'method': method, 'bg': {'kind': bg_kind, 'lab': [round(float(v), 1) for v in bmed],
            'spread': round(spread, 1), 'resid': round(resid, 1)}, 'iou_rembg': None if iou is None else round(iou, 3),
            'facing': {'silhouette': round(score, 3), 'red_lights': None if red is None else round(red, 3), 'flipped': flip},
            'outlier': round(outlier, 2), 'levelled': round(lvl, 2), 'car_px_src': round(car_len_src),
            'out_size': list(canvas.size), 'green_share': round(float(gshare), 3), 'hl': round(hl_ratio, 3),
            'wheels': [[round(float(a), 1), round(float(b), 1), round(float(c), 1)] for a, b, c in fw]}
    return canvas, P, info


def in_wheel(w, k, wheels):
    x, y = (w['box'][0] + w['box'][2] / 2) * k, (w['box'][1] + w['box'][3] / 2) * k
    return any((x - cx) ** 2 + (y - cy) ** 2 <= (1.1 * r) ** 2 for cx, cy, r in wheels)


def rgb_from_lab(lab):
    from colorlab import lab2rgb  # noqa: PLC0415
    return np.clip(lab2rgb(lab), 0, 1)


def remove_floor(car, alpha, lab, B, ml, img, mode):
    """Clears a floor / shadow / reflection under the car (in place on alpha). -> (pixels removed, rembg mask).

    A shadow pixel is in the bottom 35 % of the car, in the background hue but darker, smooth, lighter than tyre
    rubber / black trim, and below every non-shadow pixel of its column (under the tyres, under the sills); it must
    belong to a wide flat blob on the bottom of the car. When rembg is available it has the last word there."""
    H, W = car.shape
    if not car.any():
        return 0, ml
    ys, xs = np.where(car)
    y0, y1 = ys.min(), ys.max()
    ch = y1 - y0 + 1
    L = lab[..., 0]
    dl = lab - B
    chroma_shift = np.hypot(dl[..., 1], dl[..., 2])
    bgL = float(np.median(B[..., 0]))
    shade = car & (dl[..., 0] < -3) & (chroma_shift < 8 + 0.2 * np.abs(dl[..., 0])) & (L > max(24, 0.42 * bgL))
    gy, gx = np.gradient(ndi.gaussian_filter(L, 1.2))
    shade &= np.hypot(gx, gy) < 2.5
    zone = np.zeros_like(car)
    zone[y0 + int(0.65 * ch):] = True
    cand = shade & zone
    # below everything that is not shadow in the same column
    solid_nc = car & ~cand
    rows = np.arange(H)[:, None]
    low_nc = np.where(solid_nc.any(0), (solid_nc * rows).max(0), -1)
    cand &= rows > low_nc[None, :]
    removed = 0
    sel = np.zeros_like(car)
    lab_c, n = ndi.label(ndi.binary_closing(cand, disk_struct(2)) & cand)
    for i, sl in enumerate(ndi.find_objects(lab_c), 1):
        if sl is None:
            continue
        m = lab_c[sl] == i
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if sl[0].stop >= y1 - 1 and w > 3 * h and w > 0.1 * (xs.max() - xs.min()) and m.sum() > 0.001 * car.sum():
            sel[sl] |= m
    if sel.sum() > 0.002 * car.sum() and ml is None and mode != 'never':
        ml = rembg_mask(img)
    if ml is not None and sel.any():
        sel &= ml < 0.5  # the model sees car there: keep it
    if sel.any():
        reg = ndi.binary_dilation(sel, disk_struct(1)) & car & zone & (rows > low_nc[None, :] - 1)
        removed += int(reg.sum())
        alpha[reg] = 0
    car2 = alpha > 0.5
    if not car2.any():
        return removed, ml
    # anything left well below the tyre contact line (a reflection under the car)
    wheels, sill = find_wheels(car2, lab)
    if len(wheels) == 2 and all(0.05 * ch < r < 0.4 * ch for _, _, r in wheels):
        ground = max(cy + r for _, cy, r in wheels)
        below = np.zeros_like(car2)
        below[int(np.ceil(ground + 0.04 * ch)):] = True
        below &= alpha > 0
        removed += int((below & car2).sum())
        alpha[below] = 0
    keep, _, _ = largest_with_parts(alpha > 0.5)
    lost = (alpha > 0.5) & ~keep
    alpha[lost] = 0
    alpha[~ndi.binary_dilation(keep, disk_struct(2))] = 0
    return removed + int(lost.sum()), ml


def red_light_score(rgba):
    """+1: red tail lights on the left end (car faces right), -1: on the right. None when the body itself is red or
    no lights are seen."""
    a = rgba[..., 3] > 0.5
    lab = rgb2lab(rgba[..., :3])
    h, c = lab_hue_chroma(lab)
    red = a & (c > 35) & ((h < 45) | (h > 340)) & (lab[..., 0] > 20) & (lab[..., 0] < 75)
    tot = red.sum()
    if tot < 0.0008 * a.sum() or tot > 0.04 * a.sum():
        return None
    H, W = a.shape
    band = np.zeros_like(a)
    band[int(0.15 * H):int(0.85 * H)] = True
    e = int(0.2 * W)
    left, right = (red & band)[:, :e].sum(), (red & band)[:, -e:].sum()
    if left + right < 0.6 * tot:
        return None
    return float((left - right) / (left + right))


# ------------------------------------------------------------------ sheet
def font(size):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
              'C:/Windows/Fonts/arial.ttf', os.path.join(ROOT, 'public', 'fonts', 'Inter-Regular.ttf')]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def tile(im, tw, th, bg=DARK_BG):
    t = Image.new('RGB', (tw, th), bg)
    if im is None:
        return t
    im = im.convert('RGBA')
    k = min(tw / im.width, th / im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    t.paste(im, ((tw - im.width) // 2, th - im.height), im)
    return t


def pick_refs(car, cls, models, lib_ids, hl, n=2):
    same = [m for m in models.values() if m['cls'] == cls and m['id'] in lib_ids and m['id'] != car['id']]
    if not same:
        return []
    mine = car.get('hl') or 0.4
    same.sort(key=lambda m: (m['body'] != car.get('body'), abs(hl.get(m['id'], 0.4) - mine), m['id']))
    return [m['id'] for m in same[:n]]


def write_sheets(report, root, out_dir, per=8):
    cars_dir = os.path.join(root, 'public', 'cars')
    models = models_info(root)
    eco = json.load(open(os.path.join(HERE, 'economy.json'), encoding='utf-8'))['cars']
    lib_ids = {f[:-5] for f in os.listdir(cars_dir) if f.endswith('.webp')} - {r['id'] for r in report['cars']}
    hl = {}
    try:
        hl = {k: v['hl'] for k, v in json.load(open(os.path.join(HERE, 'out', '.library.json'))).items()}
    except (OSError, ValueError):
        pass
    TW, TH, LH = 300, 120, 34
    cols = ['picture', 'cutout (green)', 'factory colour', 'same class', 'same class']
    f1, f2 = font(15), font(12)
    rows = [r for r in report['cars']]
    paths = []
    for s in range(0, len(rows), per):
        part = rows[s:s + per]
        sheet = Image.new('RGB', (TW * len(cols), 26 + len(part) * (TH + LH + 8)), (16, 18, 24))
        d = ImageDraw.Draw(sheet)
        for i, c in enumerate(cols):
            d.text((i * TW + 8, 6), c, fill=(150, 160, 175), font=f2)
        y = 26
        for r in part:
            cls = eco.get(r['id'], {}).get('cls') or (models.get(r['id']) or {}).get('cls') or r.get('briefCls')
            col = {'error': (255, 90, 90), 'warn': (255, 196, 80), 'ok': (120, 220, 140)}[r['status']]
            d.rectangle([0, y, 5, y + TH + LH], fill=col)
            title = f"{r['n']:03d}  {r['name']}  ·  {cls}  ·  {r['status'].upper()}"
            d.text((12, y + 2), title, fill=(235, 238, 245), font=f1)
            msg = '; '.join(f"{p['code']}" + ('!' if p['sev'] == 'error' else '') for p in r['problems'] if p['sev'] != 'info')
            inf = ', '.join(p['code'] for p in r['problems'] if p['sev'] == 'info')
            d.text((12, y + 19), (msg or 'no problems') + (f'   [{inf}]' if inf else ''), fill=col, font=f2)
            yy = y + LH
            src = Image.open(r['file']).convert('RGB') if r.get('file') and os.path.exists(r['file']) else None
            cut = Image.open(r['cutout']) if r.get('cutout') and os.path.exists(r['cutout']) else None
            baked = None
            pub = os.path.join(cars_dir, r['id'] + '.webp')
            if os.path.exists(os.path.join(cars_dir, 'base', r['id'] + '.webp')) and os.path.exists(pub):
                baked = Image.open(pub)
            refs = pick_refs({'id': r['id'], 'body': r.get('body') or (models.get(r['id']) or {}).get('body'), 'hl': r.get('info', {}).get('hl')},
                             cls, models, lib_ids, hl)
            tiles = [tile(src, TW - 6, TH, (60, 60, 60)), tile(cut, TW - 6, TH), tile(baked, TW - 6, TH)]
            for rid in refs:
                tiles.append(tile(Image.open(os.path.join(cars_dir, rid + '.webp')), TW - 6, TH))
            for i, t in enumerate(tiles):
                sheet.paste(t, (i * TW + 3, yy))
            for i, rid in enumerate(refs):
                d.text((TW * (3 + i) + 8, yy + 2), rid, fill=(140, 150, 165), font=f2)
            if baked is None:
                d.text((TW * 2 + 10, yy + TH // 2 - 6), 'after register.mjs', fill=(90, 96, 110), font=f2)
            y += TH + LH + 8
        p = os.path.join(out_dir, f'sheet-{s // per + 1:02d}.jpg')
        sheet.save(p, quality=86)
        paths.append(p)
    return paths


# ------------------------------------------------------------------ main
def main():
    argv = sys.argv[1:]

    def take(k, default=None):
        if k in argv:
            i = argv.index(k)
            v = argv[i + 1]
            del argv[i:i + 2]
            return v
        return default

    out_dir = os.path.abspath(take('--out', os.path.join(HERE, 'out')))
    root = os.path.abspath(take('--root', ROOT))
    only = take('--only')
    only = set(only.split(',')) if only else None
    rembg = take('--rembg', 'auto')
    catalog_path = take('--cars')
    lib_exclude = take('--lib-exclude')
    flags = {a for a in argv if a.startswith('--')}
    argv = [a for a in argv if not a.startswith('--')]
    os.makedirs(out_dir, exist_ok=True)
    rep_path = os.path.join(out_dir, 'report.json')
    if '--sheet-only' in flags:
        report = json.load(open(rep_path, encoding='utf-8'))
        for p in write_sheets(report, root, out_dir):
            print('sheet:', p)
        return
    if not argv:
        sys.exit(__doc__)
    folder = os.path.abspath(argv[0])
    if zipfile.is_zipfile(folder):
        ex = os.path.join(out_dir, 'unzipped')
        shutil.rmtree(ex, ignore_errors=True)
        with zipfile.ZipFile(folder) as z:
            for n in z.namelist():
                if n.lower().endswith(EXTS) and '..' not in n and not n.startswith('/'):
                    z.extract(n, ex)
        folder = ex
    cars = load_catalog(catalog_path)
    overrides = {}
    op = os.path.join(HERE, 'overrides.json')
    if os.path.exists(op):
        overrides = {k: v for k, v in json.load(open(op, encoding='utf-8')).items() if not k.startswith('_')}
    found, unmatched, dup = match_files(folder, cars, only)
    print(f'{len(found)} picture(s) matched, {len(unmatched)} unmatched, {len(dup)} duplicate(s) (newest kept)')
    models = models_info(root)
    lib_ex = set(found) | set(filter(None, (lib_exclude or os.environ.get('CARS_IMPORT_LIB_EXCLUDE', '')).split(',')))
    lib = Library(root, exclude=lib_ex)
    # height/length of the cars of each body type (wrong-car check)
    by_body = {}
    for mid, m in models.items():
        if mid in lib.hl and mid not in lib_ex:
            by_body.setdefault(m['body'], []).append(lib.hl[mid])
    cut_dir = os.path.join(out_dir, 'cars')
    os.makedirs(cut_dir, exist_ok=True)
    report = {'generated': datetime.datetime.now().isoformat(timespec='seconds'), 'folder': folder, 'cars': [],
              'unmatched': unmatched, 'duplicates': [{'file': p, 'id': i} for p, i in dup],
              'missing': [], 'applied': []}
    for c in sorted(cars, key=lambda c: c['n']):
        if c['id'] not in found:
            if not only or str(c['n']) in only or c['id'] in only:
                report['missing'].append(c['n'])
            continue
        path, force_flip = found[c['id']]
        body = c.get('body') or (models.get(c['id']) or {}).get('body')
        vals = by_body.get(body, [])
        car = dict(c, body=body, _body_hl=(float(np.mean(vals)), float(np.std(vals)), len(vals)) if vals else None)
        ov = overrides.get(str(c['n'])) or overrides.get(c['id']) or {}
        try:
            canvas, probs, info = cut_car(path, car, lib, {'rembg': rembg, 'force_flip': force_flip,
                                                          'ocr': '--no-ocr' not in flags}, ov)
        except Exception as e:  # noqa: BLE001 — one bad picture must not stop the batch
            import traceback
            traceback.print_exc()
            canvas, probs, info = None, [{'code': 'failed', 'sev': 'error', 'msg': f'{type(e).__name__}: {e}'}], {}
        if ov.get('accept'):
            for p in probs:
                if p['sev'] == 'error' and p['code'] in ov['accept']:
                    p['sev'], p['msg'] = 'warn', p['msg'] + ' (accepted in overrides.json)'
        cut_path = None
        if canvas is not None:
            cut_path = os.path.join(cut_dir, c['id'] + '.webp')
            canvas.save(cut_path, 'WEBP', quality=86, method=6)
        status = 'error' if any(p['sev'] == 'error' for p in probs) or canvas is None else \
            'warn' if any(p['sev'] == 'warn' for p in probs) else 'ok'
        row = {'n': c['n'], 'id': c['id'], 'name': c['name'], 'briefCls': c['briefCls'], 'redo': bool(c.get('redo')), 'body': body,
               'file': path, 'cutout': cut_path, 'status': status, 'problems': probs, 'info': info,
               'wheels': info.get('wheels')}
        report['cars'].append(row)
        tag = {'ok': 'OK  ', 'warn': 'WARN', 'error': 'ERR '}[status]
        print(f"  {tag} {c['n']:03d} {c['id']:<34} " + '; '.join(p['msg'] for p in probs if p['sev'] != 'info')[:220], flush=True)
    if '--apply' in flags:
        dst = os.path.join(root, 'public', 'cars')
        for r in report['cars']:
            if r['cutout'] and (r['status'] != 'error' or '--force' in flags):
                shutil.copyfile(r['cutout'], os.path.join(dst, r['id'] + '.webp'))
                report['applied'].append(r['id'])
        print(f"applied {len(report['applied'])} cutout(s) to public/cars"
              + (f" (skipped {sum(1 for r in report['cars'] if r['status'] == 'error')} with errors; --force takes them too)"
                 if '--force' not in flags else ''))
    json.dump(report, open(rep_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    sheets = write_sheets(report, root, out_dir)
    n = {k: sum(1 for r in report['cars'] if r['status'] == k) for k in ('ok', 'warn', 'error')}
    print(f"\nreport: {rep_path}\nsheets: {', '.join(sheets)}\n{n['ok']} ok, {n['warn']} to check, {n['error']} to regenerate; "
          f"{len(report['missing'])} of the batch not in this folder; unmatched files: {len(unmatched)}")
    for p in unmatched:
        print('  unmatched:', p)


if __name__ == '__main__':
    main()
