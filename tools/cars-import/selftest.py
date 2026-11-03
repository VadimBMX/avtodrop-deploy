"""Self-test of import.py on synthetic pictures:  python -I tools/cars-import/selftest.py [--keep]

Real green key photos from public/cars/base (cut-outs whose true alpha we know) are put back on a Gemini-like
background (1920x1080, #808080 grey as the brief asks, or #3FAE49 green) and spoiled on purpose: mirrored, cut off by
the edge, a floor shadow, text and a watermark, low resolution, tilted, squashed like a 3/4 view, a plain (not green)
car, an SUV under a coupe's number, an uneven background. import.py runs on the folder (nothing in public/ changes)
and the test checks that every spoiled picture is flagged with the right problem and every fixable one comes out
fixed: same silhouette as the original (alpha IoU), facing right, wheels on the bottom edge, the game canvas.
Writes tools/cars-import/selftest-out/ (pictures, report.json, sheets). Exit code 1 if a check fails.
"""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, 'selftest-out')
SRC = os.path.join(OUT, 'in')
BASE = os.path.join(ROOT, 'public', 'cars', 'base')
GREY, GREEN = (128, 128, 128), (0x3F, 0xAE, 0x49)


def car(cid):
    return Image.open(os.path.join(BASE, cid + '.webp')).convert('RGBA')


def compose(fg, bg=GREY, size=(1920, 1080), length=1500, pos=None, grad=False):
    fg = fg.resize((length, round(fg.height * length / fg.width)), Image.LANCZOS)
    W, H = size
    if grad:  # vignette + vertical gradient, like a studio backdrop
        yy, xx = np.mgrid[0:H, 0:W]
        r = np.hypot((xx - W / 2) / W, (yy - H / 2) / H)
        g = np.clip(np.array(bg, float)[None, None] * (1.08 - 0.5 * r[..., None]) * (0.95 + 0.1 * yy[..., None] / H), 0, 255)
        canvas = Image.fromarray(g.astype(np.uint8), 'RGB').convert('RGBA')
    else:
        canvas = Image.new('RGBA', size, bg + (255,))
    x, y = pos or ((W - fg.width) // 2, (H - fg.height) // 2 + 60)
    canvas.alpha_composite(fg, (x, y))
    return canvas.convert('RGB'), (x, y, fg.width, fg.height)


def shadow(img, box):
    x, y, w, h = box
    sh = Image.new('L', img.size, 0)
    ImageDraw.Draw(sh).ellipse([x - 30, y + h - 26, x + w + 30, y + h + 22], fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    dark = Image.new('RGB', img.size, (40, 40, 40))
    return Image.composite(dark, img, sh)


def text(img, on_car_xy):
    d = ImageDraw.Draw(img)
    f = None
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf']:
        if os.path.exists(p):
            f = ImageFont.truetype(p, 64)
    f = f or ImageFont.load_default()
    d.text((80, 60), 'SPORT EDITION', fill=(20, 20, 20), font=f)
    d.text(on_car_xy, 'TURBO', fill=(250, 250, 250), font=f)
    # the Gemini sparkle in the corner
    cx, cy = img.width - 70, img.height - 70
    d.polygon([(cx, cy - 30), (cx + 8, cy - 8), (cx + 30, cy), (cx + 8, cy + 8), (cx, cy + 30), (cx - 8, cy + 8), (cx - 30, cy), (cx - 8, cy - 8)], fill=(235, 235, 235))
    return img


def squash34(fg):
    """A crude 3/4 view: the car foreshortened and sheared (front bigger than the rear)."""
    w, h = fg.size
    fg = fg.resize((int(w * 0.62), h), Image.LANCZOS)
    w2 = fg.width
    coeffs = find_coeffs([(0, 0), (w2, -0.12 * h), (w2, 1.12 * h), (0, h)], [(0, 0), (w2, 0), (w2, h), (0, h)])
    return fg.transform((w2, int(h * 1.25)), Image.PERSPECTIVE, coeffs, Image.BICUBIC)


def find_coeffs(pa, pb):
    A = []
    for p1, p2 in zip(pa, pb):
        A.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        A.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    return np.linalg.solve(np.array(A, float), np.array(pb, float).reshape(8)).tolist()


# (number, file stem, source car, how, expected problem codes, must NOT have, check silhouette vs original)
CASES = [
    (183, '183', 'bmw-m5-e39', 'clean grey', set(), {'flipped', 'cropped', 'wrong_angle'}, True),
    (184, '184', 'mercedes-benz-e55-amg-w210', 'mirrored', {'flipped'}, {'cropped'}, True),
    (185, 'BMW X5 4.8is E53', 'toyota-land-cruiser-200', 'named by car, mirrored, floor shadow', {'flipped', 'shadow_removed'}, {'cropped'}, True),
    (186, '186', 'porsche-959', 'cut off by the right edge', {'cropped'}, set(), False),
    (187, '187', 'nissan-skyline-gt-r-r32', 'green background (hard case)', set(), {'cropped', 'not_key_green'}, True),
    (188, '188', 'bmw-750i-e38-bumer', 'text + watermark', {'text_or_logo'}, set(), True),
    (189, '189', 'ferrari-testarossa', 'low resolution', {'low_resolution'}, set(), True),
    (190, '190', 'mitsubishi-pajero-ii', 'tilted 2.5 deg', {'levelled'}, {'wrong_angle'}, False),
    (191, '191', 'audi-100-c3-syhara', '3/4 view (squashed + perspective)', {'wrong_angle'}, set(), False),
    (192, '192', None, 'plain photo, not key green (vaz-2107)', {'not_key_green'}, set(), False),
    (194, 'toyota-supra-a90', 'toyota-land-cruiser-200', 'an SUV under a coupe (brief id as name)', {'wrong_car'}, set(), False),
    (196, '196', 'bmw-m5-e34', 'clear (see-through) windows', {'see_through_glass'}, {'cropped'}, False),
    (195, '195f', 'koenigsegg-ccx', 'uneven background, forced flip suffix', {'background_not_flat', 'flipped'}, {'cropped'}, False),
]


def clear_windows(fg):
    """The dark glass of the upper body made see-through (alpha 0): the background shows through the windows."""
    a = np.asarray(fg).astype(np.float64)
    H = a.shape[0]
    ys = np.where(a[..., 3] > 128)[0]
    lum = a[..., :3].mean(-1)
    sat = a[..., :3].max(-1) - a[..., :3].min(-1)
    win = (a[..., 3] > 128) & (lum < 70) & (sat < 25)
    win[int(ys.min() + 0.45 * (ys.max() - ys.min())):] = False
    from scipy import ndimage as ndi  # noqa: PLC0415
    win = ndi.binary_opening(win, iterations=2)
    a[..., 3][win] = 0
    return Image.fromarray(a.astype(np.uint8), 'RGBA'), win


def iou(a, b):
    return float((a & b).sum() / max(1, (a | b).sum()))


def main():
    keep = '--keep' in sys.argv
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(SRC)
    truth, truth_win = {}, {}
    for n, stem, cid, how, *_ in CASES:
        if cid is None:
            fg = Image.open(os.path.join(ROOT, 'public', 'cars', 'vaz-2107.webp')).convert('RGBA')
        else:
            fg = car(cid)
        gt = fg
        bg, grad, pos, length = GREY, False, None, 1500
        if 'mirrored' in how:
            fg = fg.transpose(Image.FLIP_LEFT_RIGHT)
        if 'forced flip' in how:
            fg = fg.transpose(Image.FLIP_LEFT_RIGHT)
        if 'green background' in how:
            bg = GREEN
        if 'uneven' in how:
            grad = True
        if 'cut off' in how:
            pos = (1920 - 1300, 380)
        if 'low resolution' in how:
            length = 480
        if 'see-through' in how:
            fg, win = clear_windows(fg)
            truth_win[n] = win
        if 'tilted' in how:
            fg = fg.rotate(2.5, resample=Image.BICUBIC, expand=True)
        if '3/4' in how:
            fg = squash34(fg)
            length = 1000
        img, box = compose(fg, bg, length=length, pos=pos, grad=grad)
        if 'shadow' in how:
            img = shadow(img, box)
        if 'text' in how:
            img = text(img, (box[0] + box[2] // 2 - 120, box[1] + int(box[3] * 0.55)))
        img.save(os.path.join(SRC, stem + '.png'))
        truth[n] = gt
    env = dict(os.environ)
    # a real new car is not in the game yet: compare it with the other cars only (its baked twin would be a perfect match)
    env['CARS_IMPORT_LIB_EXCLUDE'] = ','.join(c[2] for c in CASES if c[2])
    cmd = [sys.executable, '-I', os.path.join(HERE, 'import.py'), SRC, '--out', OUT]
    print('$', ' '.join(cmd))
    r = subprocess.run(cmd, env=env, text=True)
    if r.returncode:
        sys.exit('import.py failed')
    rep = json.load(open(os.path.join(OUT, 'report.json'), encoding='utf-8'))
    by_n = {c['n']: c for c in rep['cars']}
    fails = 0
    print('\n n   case                                       result')
    for n, stem, cid, how, want, wont, check in CASES:
        c = by_n.get(n)
        msgs = []
        if not c:
            msgs.append('not matched')
        else:
            codes = {p['code'] for p in c['problems']}
            miss = want - codes
            if 'failed' in codes:
                msgs.append('crashed: ' + next(p['msg'] for p in c['problems'] if p['code'] == 'failed'))
            extra = wont & codes
            if miss:
                msgs.append('missed ' + ','.join(sorted(miss)))
            if extra:
                msgs.append('false ' + ','.join(sorted(extra)))
            if check and c['cutout']:
                out = Image.open(c['cutout']).convert('RGBA')
                gt = truth[n]
                gt_c = gt.crop(gt.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox())
                from normalize_cars import fit_canvas  # noqa: PLC0415
                gt_c = fit_canvas(gt_c).resize(out.size, Image.LANCZOS)
                A, G = np.asarray(out)[..., 3] > 128, np.asarray(gt_c)[..., 3] > 128
                Gm = G[:, ::-1]
                s, sm = iou(A, G), iou(A, Gm)
                if s < 0.95:
                    msgs.append(f'silhouette IoU {s:.3f} (mirror {sm:.3f})')
                # wheels on the bottom edge, car touching the sides
                a = np.asarray(out)[..., 3]
                if not (a[-1].max() > 128 and a[:, 0].max() > 20 and a[:, -1].max() > 20):
                    msgs.append('not on the canvas edges')
                if abs(out.width / out.height - 2.5) > 0.01:
                    msgs.append('canvas not 2.5:1')
                c['iou'] = round(s, 4)
        if c and n in truth_win and c['cutout']:
            # the windows come out as semi-transparent glass, not holes and not opaque grey
            out = np.asarray(Image.open(c['cutout']).convert('RGBA')).astype(np.float64)
            w = truth_win[n]
            ys, xs = np.where(np.asarray(truth[n])[..., 3] > 20)
            w = w[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
            wi = np.asarray(Image.fromarray(w.astype(np.uint8) * 255).resize((out.shape[1], round(out.shape[1] * w.shape[0] / w.shape[1])), Image.NEAREST)) > 128
            off = out.shape[0] - wi.shape[0]
            wa = out[off:, :, 3][wi] / 255
            if len(wa) and not (0.45 < np.median(wa) < 0.95):
                msgs.append(f'window alpha {np.median(wa):.2f} (want semi-transparent)')
            c['glass_alpha'] = round(float(np.median(wa)), 2) if len(wa) else None
        ok = not msgs
        fails += not ok
        detail = f" IoU {c.get('iou')}" if c and c.get('iou') else ''
        detail += f" glass alpha {c.get('glass_alpha')}" if c and c.get('glass_alpha') is not None else ''
        print(f"{n:03d}  {how:<42} {'PASS' if ok else 'FAIL: ' + '; '.join(msgs)}{detail}"
              f"   [{', '.join(sorted({p['code'] for p in c['problems']})) if c else ''}]")
    print(f"\n{len(CASES) - fails}/{len(CASES)} cases pass. Sheets and report in {OUT}")
    if not keep:
        shutil.rmtree(os.path.join(OUT, 'unzipped'), ignore_errors=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    main()
