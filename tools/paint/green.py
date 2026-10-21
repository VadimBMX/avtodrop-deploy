"""Green "key" car photos -> body mask + factory-colour photo:  npm run green-cars [-- id ... ] [--sheets DIR]

The 27 cars of prompts 151-177 are generated with every painted panel in one medium-bright metallic green
(KEY_GREEN in public/shared.js). For each such car this
  1. keeps the green original as public/cars/base/<id>.webp (a green public/cars/<id>.webp, e.g. straight from
     `npm run cars` or the cloud cutter, is moved there on the first run),
  2. builds the body mask from the green hue cluster (glass, lights, chrome, black trim, tyres are not green and stay
     out; panel gaps, badges and specular highlights inside the green are filled in) -> public/paint/<id>.png and the
     car's entry in public/paint/meta.json (as tools/paint/masks.py, plus `base` = hash of the green photo and
     `factory` = the colour it was baked in),
  3. bakes public/cars/<id>.webp in the factory colour (FACTORY_PAINT in public/shared.js) with exactly the maths
     public/paint.js uses for a key car, so the game shows the baked photo everywhere at no cost and a player's
     repaint (from the green base) looks the same as the factory photo would,
  4. rewrites public/car-photos.js (tools/car_photos.mjs) so the car is in the game.
Idempotent: every run rebuilds from the green base. With no ids: every car that has a base, or a green photo, and a
FACTORY_PAINT entry. --root DIR works on another copy of the project (tests, previews); --sheets DIR writes review
contact sheets (green base | mask | factory | black | white | red | silver); --prompts writes
docs/car-prompts-green.txt (the Gemini prompts with the paint colour replaced by the key green).
meta.baked = hash of the baked photo: a public/cars/<id>.webp with another hash that is green is a new base.
Only numpy / scipy / pillow + node.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bodymask import disk, find_wheels  # noqa: E402
from colorlab import hex2lab, lab2rgb, rgb2lab  # noqa: E402
from recolor import flake, shade_lab, smooth_body  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
SHEET_COLOURS = [('#141518', 'gloss'), ('#eceeef', 'gloss'), ('#b5121b', 'gloss'), ('#b9bdc3', 'metallic')]


class NotKey(Exception):
    pass


def paths(root):
    pub = os.path.join(root, 'public')
    return {'cars': os.path.join(pub, 'cars'), 'base': os.path.join(pub, 'cars', 'base'),
            'paint': os.path.join(pub, 'paint'), 'meta': os.path.join(pub, 'paint', 'meta.json'), 'shared': os.path.join(pub, 'shared.js')}


def factory_data(shared):
    """FACTORY_PAINT and KEY_GREEN straight from public/shared.js (one source of truth)."""
    code = ("import { pathToFileURL } from 'node:url';"
            "const S = await import(pathToFileURL(process.argv[1]).href);"
            "console.log(JSON.stringify({ factory: S.FACTORY_PAINT, green: S.KEY_GREEN }));")
    out = subprocess.run(['node', '--input-type=module', '-e', code, shared], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


# ---------------------------------------------------------------- mask
def green_mask(rgb, alpha):
    """Soft body mask (0..1) of a green key photo. rgb 0..1 float, alpha 0..1."""
    car = alpha > 0.5
    lab = rgb2lab(rgb)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b)
    hue = np.degrees(np.arctan2(b, a)) % 360
    sel = car & (C > 20) & (hue > 95) & (hue < 205)
    if sel.sum() < 0.12 * car.sum():
        raise NotKey(f'only {sel.sum() / max(1, car.sum()):.0%} of the car is green')
    hc = float(np.median(hue[sel]))
    dh = np.abs((hue - hc + 180) % 360 - 180)
    # membership: hue within ~25 deg of the key (fading out by 40), chroma above a floor that grows with lightness
    # (dark green shadows keep little chroma, black trim / tyres / tinted glass have almost none)
    cthr = 4 + 0.10 * L
    soft = np.clip((40 - dh) / 15, 0, 1) * np.clip((C - cthr) / (0.8 * cthr), 0, 1)
    core = car & (soft > 0.5)
    area = car.sum()
    # drop green specks off the body (reflections in glass / chrome): components < 0.05% of the car
    lab_, n = ndi.label(core)
    if n:
        sizes = ndi.sum(core, lab_, range(1, n + 1))
        core = np.isin(lab_, 1 + np.where(sizes >= 0.0005 * area)[0])
    # panel gaps, door seams, thin dark creases: a small closing
    st = disk((5, 5), 2, 2, 2.2)
    closed = ndi.binary_closing(np.pad(core, 3), structure=st)[3:-3, 3:-3] & car
    # holes in the green: small ones (badges, handles, specks) are body; bigger ones only when they are specular
    # highlights (bright, low chroma, a trace of green); windows and chrome strips stay out
    holes = ndi.binary_fill_holes(closed) & ~closed
    hl, hn = ndi.label(holes)
    fill = np.zeros_like(holes)
    for i, sl in enumerate(ndi.find_objects(hl), 1):
        if sl is None:
            continue
        m = hl[sl] == i
        n_px = m.sum()
        Lm = L[sl][m]
        tint = np.mean((dh[sl][m] < 45) & (C[sl][m] > 3))
        if n_px < 0.0015 * area or (n_px < 0.03 * area and Lm.mean() > 78 and tint > 0.3):
            fill[sl] |= m
    hard = closed | fill
    # anti-aliased rim: against the background or glass the edge pixel is part green -> its own green membership
    ring = ndi.binary_dilation(hard, iterations=2) & ~hard & (alpha > 0)
    mask = hard.astype(np.float64)
    mask[ring] = np.clip(soft[ring] * 1.25, 0, 1)
    return mask, lab, car


def build(base_path):
    im = Image.open(base_path).convert('RGBA')
    px = np.asarray(im)
    rgb8, alpha = px[..., :3], px[..., 3].astype(np.float64) / 255
    mask, lab, car = green_mask(rgb8.astype(np.float64) / 255, alpha)
    wheels, _ = find_wheels(car, lab)
    for cx, cy, r in wheels:  # the tyre and rim are never paint (green reflections in polished rims)
        mask[disk(mask.shape, cx, cy, r * 0.97)] = 0
    q = np.round(mask * 15).astype(np.uint8)
    hard = q >= 8
    if hard.sum() < 0.1 * car.sum():
        raise NotKey('body not found')
    L = lab[..., 0]
    p = np.percentile(L[hard], [2, 50, 98])
    ys, xs = np.where(hard)
    meta = {'w': int(px.shape[1]), 'h': int(px.shape[0]),
            'wheels': [[round(float(a), 1), round(float(b), 1), round(float(c), 1)] for a, b, c in wheels],
            'top': int(ys.min()), 'x0': int(xs.min()), 'x1': int(xs.max()),
            'p': [round(float(v), 2) for v in p]}
    return {'rgb8': rgb8, 'alpha8': px[..., 3], 'q': q, 'meta': meta}


# ---------------------------------------------------------------- render (twin of paintPixels in public/paint.js)
Q = 4


def shade_lut(hexc, p, finish, soft, key=True):
    l = np.arange(100 * Q + 1) / Q
    rgb = lab2rgb(shade_lab(l[None, :], hex2lab(hexc), p, finish, soft, key))[0]
    return np.clip(np.round(rgb * 255), 0, 255)  # Uint8ClampedArray: round half to even


def render(rgb8, q, meta, paint=None, two=None, key=True):
    """paint/two: {'hex', 'finish'[, 'side', 'at']}. Returns uint8 RGB, the same pixels paint.js produces."""
    h, w = q.shape
    M = q.astype(np.float64) * 17
    s = rgb8.astype(np.float64)
    Lsrc = rgb2lab(s / 255)[..., 0]
    soft = meta['p'][1] < 30
    if soft:
        Lsrc = smooth_body(Lsrc, q)
    Lq = np.clip(np.floor(Lsrc * Q + 0.5), 0, 100 * Q).astype(int)
    if key:  # green spill outside the body -> neutral
        c = np.maximum(s[..., 0], s[..., 2])
        s[..., 1] = np.where((M < 255) & (s[..., 1] > c), c, s[..., 1])
    if not paint:
        return s.astype(np.uint8)
    finish = paint.get('finish', 'gloss')
    out = shade_lut(paint['hex'], meta['p'], finish, soft, key)[Lq]
    if two:
        lut2 = shade_lut(two['hex'], meta['p'], two.get('finish', finish), soft, key)[Lq]
        ground = max(cy + r for _, cy, r in meta['wheels'])
        ys = meta['top'] + (ground - meta['top']) * two['at']
        t = np.clip(np.arange(h) - ys + 0.5, 0, 1)[:, None, None]
        u = t if two.get('side') == 'below' else 1 - t
        out = out + (lut2 - out) * u
    if finish == 'metallic' or (two and two.get('finish') == 'metallic'):
        out = out * (1 + (flake((h, w)) - 0.5) * 0.06)[..., None]
    k = (M / 255)[..., None]
    res = s * (1 - k) + out * k
    return np.clip(np.round(res), 0, 255).astype(np.uint8)


def save_webp(rgb, alpha8, path):
    Image.fromarray(np.dstack([rgb, alpha8]), 'RGBA').save(path, 'WEBP', quality=88, method=6)


# ---------------------------------------------------------------- per car
def sha(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:10]


def looks_green(path):
    try:
        px = np.asarray(Image.open(path).convert('RGBA')).astype(np.float64) / 255
        green_mask(px[..., :3], px[..., 3])
        return True
    except NotKey:
        return False


def one(cid, P, factory, old=None):
    base = os.path.join(P['base'], cid + '.webp')
    photo = os.path.join(P['cars'], cid + '.webp')
    # public/cars/<id>.webp is either our own bake (its hash is in meta as `baked`) or a new green photo just cut by
    # `npm run cars` / the cloud cutter, which becomes the base (a re-generated car replaces the old base)
    fresh = os.path.exists(photo) and sha(photo) != (old or {}).get('baked')
    if fresh and looks_green(photo):
        os.makedirs(P['base'], exist_ok=True)
        shutil.copyfile(photo, base)
    elif not os.path.exists(base):
        raise NotKey('no green photo in public/cars or public/cars/base' if not os.path.exists(photo)
                     else 'public/cars photo is not a green key photo (use npm run paint-masks for it)')
    res = build(base)
    meta = res['meta']
    f = {k: factory[k] for k in ('hex', 'finish') if k in factory}
    if factory.get('two'):
        f['two'] = factory['two']
    meta['base'] = sha(base)
    meta['factory'] = f
    Image.fromarray(res['q'] * 17, 'L').save(os.path.join(P['paint'], cid + '.png'), optimize=True, bits=4)
    baked = render(res['rgb8'], res['q'], meta, f, f.get('two'))
    save_webp(baked, res['alpha8'], photo)
    meta['baked'] = sha(photo)
    return meta, res


def sheet_row(cid, res, meta):
    from masks import fit, rgba  # noqa: PLC0415 — only for --sheets
    a = res['alpha8'].astype(np.float64) / 255
    dbg = res['rgb8'].astype(np.float64) / 255 * 0.35
    dbg[..., 0] += res['q'] / 15 * 0.65
    tiles = [fit(rgba(res['rgb8'] / 255, a)), fit(rgba(dbg, a)),
             fit(Image.open(os.path.join(res['paths']['cars'], cid + '.webp')).convert('RGBA'))]
    for hexc, fin in SHEET_COLOURS:
        tiles.append(fit(rgba(render(res['rgb8'], res['q'], meta, {'hex': hexc, 'finish': fin}) / 255, a)))
    from PIL import ImageDraw  # noqa: PLC0415
    tw, th = tiles[0].size
    row = Image.new('RGB', (tw * len(tiles), th + 20), (24, 26, 32))
    for i, t in enumerate(tiles):
        row.paste(t, (i * tw, 20))
    ImageDraw.Draw(row).text((6, 2), f'{cid}  p={meta["p"]}  factory {meta["factory"]["hex"]} {meta["factory"]["finish"]}', fill=(235, 235, 235))
    return np.asarray(row)


KEY_PHRASE = ('every painted body panel (doors, wings, bonnet, boot, roof, pillars, bumpers, mirrors) in ONE uniform '
              'medium-bright metallic green paint ({green}, like a chroma-key green with fine metallic flake), a single '
              'colour with no two-tone, stripes or decals{keep}; glass, lights, chrome, black plastic trim, tyres and '
              'wheels in their normal colours, stock factory condition')


def write_prompts(root, fac, green):
    """docs/car-prompts-green.txt: the prompts of the key cars from docs/car-prompts.txt with the paint colour
    replaced by the key green (numbers unchanged, so raw-cars/<number>.png still finds its car)."""
    import re  # noqa: PLC0415
    src = os.path.join(root, 'docs', 'car-prompts.txt')
    lines = open(src, encoding='utf-8-sig').read().splitlines()
    out = ['АВТОДРОП — green "key" prompts for the new cars (generated by `npm run green-cars -- --prompts`).',
           'Same numbers as docs/car-prompts.txt. Save the picture as raw-cars/<number>.png, then: npm run cars (or the',
           'cloud cutter) → npm run green-cars → the car is in the game in its factory colour (FACTORY_PAINT in shared.js).',
           'The green must be ONE even colour on all paint; regenerate if Gemini adds a second colour, stripes or a green tint',
           'on the glass/wheels.', '']
    n = 0
    for i, line in enumerate(lines):
        m = re.match(r'^(\d{3}) \| ([a-z0-9-]+) \|', line)
        if not m or not fac.get(m.group(2), {}).get('key') or i + 1 >= len(lines):
            continue
        prompt = lines[i + 1]
        pm = re.search(r', ([^,]+?) paint, stock factory condition', prompt)
        if not pm:
            continue
        colour = pm.group(1)
        keep = re.search(r'\bwith (a khaki canvas top|dark tinted windows|exposed carbon fibre details)', colour)
        keep = f' (keep {keep.group(1)} as they are, not green)' if keep else ''
        new = prompt[:pm.start()] + ', ' + KEY_PHRASE.format(green=green.upper(), keep=keep) + prompt[pm.end():]
        out += ['-' * 74, line, f'Factory colour (baked by green-cars): {fac[m.group(2)].get("name", "")} {fac[m.group(2)]["hex"]}', new]
        n += 1
    path = os.path.join(root, 'docs', 'car-prompts-green.txt')
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(out) + '\n')
    print(f'{path}: {n} prompts')


def main():
    argv = sys.argv[1:]
    if '--prompts' in argv:
        root = REPO
        data = factory_data(paths(root)['shared'])
        return write_prompts(root, data['factory'], data['green'])
    opt = {}
    for k in ('--root', '--sheets'):
        if k in argv:
            i = argv.index(k)
            opt[k] = argv[i + 1]
            del argv[i:i + 2]
    root = os.path.abspath(opt.get('--root', REPO))
    P = paths(root)
    data = factory_data(P['shared'])
    fac = data['factory']
    os.makedirs(P['paint'], exist_ok=True)
    if argv:
        ids = argv
    else:
        have = set(f[:-5] for f in os.listdir(P['base'])) if os.path.isdir(P['base']) else set()
        ids = sorted(i for i in fac if fac[i].get('key') and (i in have or os.path.exists(os.path.join(P['cars'], i + '.webp'))))
    meta = json.load(open(P['meta'], encoding='utf-8')).get('cars', {}) if os.path.exists(P['meta']) else {}
    rows, ok = [], 0
    for cid in ids:
        if cid not in fac:
            print(f'{cid}: no FACTORY_PAINT entry in public/shared.js — skipped')
            continue
        try:
            m, res = one(cid, P, fac[cid], meta.get(cid))
        except NotKey as e:
            print(f'{cid}: skipped ({e})')
            continue
        meta[cid] = m
        ok += 1
        print(f'{cid}: ok  p={m["p"]}  factory {fac[cid]["hex"]} {fac[cid]["finish"]}', flush=True)
        if '--sheets' in opt:
            res['paths'] = P
            rows.append(sheet_row(cid, res, m))
    meta = {k: meta[k] for k in sorted(meta)}
    ver = hashlib.sha1(json.dumps(meta, sort_keys=True).encode()).hexdigest()[:10]
    with open(P['meta'], 'w', encoding='utf-8') as fh:
        json.dump({'v': ver, 'cars': meta}, fh, ensure_ascii=False, separators=(',', ':'))
    if rows and '--sheets' in opt:
        os.makedirs(opt['--sheets'], exist_ok=True)
        for n in range(0, len(rows), 6):
            part = rows[n:n + 6]
            wmax = max(r.shape[1] for r in part)
            part = [np.pad(r, ((0, 0), (0, wmax - r.shape[1]), (0, 0))) for r in part]
            Image.fromarray(np.vstack(part)).save(os.path.join(opt['--sheets'], f'green-{n // 6 + 1:02d}.jpg'), quality=85)
    # the car list the game reads (a car of NEW_RAW enters the game once its photo is listed)
    if ok and os.path.exists(os.path.join(root, 'tools', 'car_photos.mjs')):
        subprocess.run(['node', os.path.join(root, 'tools', 'car_photos.mjs')], check=False)
    print(f'{ok} green car(s) done')


if __name__ == '__main__':
    main()
