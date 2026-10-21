"""Paint 2.0 body masks for every car photo:  npm run paint-masks  [-- id ... ] [--sheets DIR]

For each public/cars/<id>.webp this writes public/paint/<id>.png — the body mask (4-bit grey PNG on the photo's own
canvas: 0 = keep the photo, 15 = paint) — and one entry in public/paint/meta.json that the game reads:
  w, h            photo size (a mask is used only when it still matches the photo)
  wheels          [[cx, cy, r], ...]   (liveries are placed from these)
  top, x0, x1     body bounding box
  p               body lightness p2 / p50 / p98 (the recolour maps this range onto the target colour)
  dark            [y0, y1] for photos shot black: the renderer adds a soft studio gradient between these rows
  off             reason — paint is disabled for this car (set by hand in hints.json after looking at the sheets)
Manual fixes per car go to tools/paint/hints.json (see bodymask.py for the keys).
--sheets DIR also writes review contact sheets (photo, mask, three colours per car) to DIR.
With no ids every photo is processed. Only numpy / scipy / pillow are needed.
"""
import hashlib
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bodymask import build, debug_image  # noqa: E402
from recolor import body_stats, recolor  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
CARS = os.path.join(ROOT, 'public', 'cars')
OUT = os.path.join(ROOT, 'public', 'paint')
META = os.path.join(OUT, 'meta.json')
HINTS = os.path.join(HERE, 'hints.json')
SHEET_COLOURS = [('#1f4fa8', 'gloss'), ('#eceeef', 'gloss'), ('#f2c300', 'gloss')]


def load_hints():
    return json.load(open(HINTS, encoding='utf-8')) if os.path.exists(HINTS) else {}


def one(args):
    cid, hint, sheets = args
    path = os.path.join(CARS, cid + '.webp')
    try:
        return _one(cid, path, hint, sheets)
    except Exception as e:  # noqa: BLE001 — a photo the detector can't read: paint off for it
        return cid, {'off': f'mask failed: {type(e).__name__}'}, None


def _one(cid, path, hint, sheets):
    res = build(path, hint)
    if res['hard'].sum() < 0.05 * res['car'].sum():
        raise ValueError('body not found')
    q = np.round(res['mask'] * 15).astype(np.uint8)
    # 4-bit grey: 16 levels are plenty for the anti-aliased edge and compress ~2x better than 8-bit
    Image.fromarray(q * 17, 'L').convert('L').save(os.path.join(OUT, cid + '.png'), optimize=True, bits=4)
    ys, xs = np.where(res['hard'])
    st = body_stats(res)
    meta = {'w': int(res['alpha'].shape[1]), 'h': int(res['alpha'].shape[0]),
            'wheels': [[round(float(a), 1), round(float(b), 1), round(float(c), 1)] for a, b, c in res['wheels']],
            'top': int(ys.min()), 'x0': int(xs.min()), 'x1': int(xs.max()),
            'p': [round(float(v), 2) for v in st['p']]}
    if st['dark']:
        meta['dark'] = [int(v) for v in st['dark']]
    if hint and hint.get('off'):
        meta['off'] = hint['off']
    share = float(res['hard'].sum() / max(1, res['car'].sum()))
    meta_share = round(share, 3)
    row = None
    if sheets:
        row = sheet_row(cid, res, meta_share, bool(hint), (hint or {}).get('off'))
    return cid, meta, row


FONT = None
for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'):
    if os.path.exists(f):
        FONT = ImageFont.truetype(f, 15)
TW, TH = 300, 130


def fit(img):
    img = img.copy()
    img.thumbnail((TW, TH - 4), Image.LANCZOS)
    t = Image.new('RGB', (TW, TH), (52, 54, 62))
    t.paste(img, ((TW - img.width) // 2, TH - img.height), img if img.mode == 'RGBA' else None)
    return t


def rgba(rgb, alpha):
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), alpha]) * 255).astype(np.uint8), 'RGBA')


def sheet_row(cid, res, share, hinted, off):
    tiles = [fit(rgba(res['rgb'], res['alpha'])), fit(debug_image(res))]
    for hexc, fin in SHEET_COLOURS:
        tiles.append(fit(rgba(recolor(res, hexc, fin), res['alpha'])))
    row = Image.new('RGB', (TW * len(tiles), TH + 20), (24, 26, 32))
    for i, t in enumerate(tiles):
        row.paste(t, (i * TW, 20))
    d = ImageDraw.Draw(row)
    d.text((6, 2), f'{cid}  body {share:.2f}  {"hint" if hinted else "auto"}  {"chromatic" if res["chromatic"] else "neutral"}'
           + (f'  OFF: {off}' if off else ''), fill=(255, 120, 120) if off else (235, 235, 235), font=FONT)
    return np.asarray(row)


def main():
    argv = sys.argv[1:]
    sheets = None
    if '--sheets' in argv:
        i = argv.index('--sheets')
        sheets = argv[i + 1]
        del argv[i:i + 2]
        os.makedirs(sheets, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    ids = argv or sorted(f[:-5] for f in os.listdir(CARS) if f.endswith('.webp'))
    # green key cars (public/cars/base/<id>.webp) get their mask and photo from `npm run green-cars`: never here
    key = [c for c in ids if os.path.exists(os.path.join(CARS, 'base', c + '.webp'))]
    if key:
        print('green key base, use npm run green-cars:', ' '.join(key))
        ids = [c for c in ids if c not in key]
    hints = load_hints()
    meta = {}
    if os.path.exists(META):
        old = json.load(open(META, encoding='utf-8')).get('cars', {})
        meta = old if argv else {k: v for k, v in old.items() if v.get('base')}
    rows = []
    with ProcessPoolExecutor(max(1, min(4, os.cpu_count() or 1))) as ex:
        for cid, m, row in ex.map(one, [(c, hints.get(c), bool(sheets)) for c in ids]):
            meta[cid] = m
            if row is not None:
                rows.append((cid, row))
            print(cid, 'OFF ' + m['off'] if m.get('off') else 'ok', flush=True)
    # drop entries of photos that no longer exist
    meta = {k: meta[k] for k in sorted(meta) if os.path.exists(os.path.join(CARS, k + '.webp'))}
    for k in list(meta):
        if 'w' not in meta[k] and os.path.exists(os.path.join(OUT, k + '.png')):
            os.remove(os.path.join(OUT, k + '.png'))
    ver = hashlib.sha1(json.dumps(meta, sort_keys=True).encode()).hexdigest()[:10]
    with open(META, 'w', encoding='utf-8') as f:
        json.dump({'v': ver, 'cars': meta}, f, ensure_ascii=False, separators=(',', ':'))
    if sheets and rows:
        per = 8
        for n in range(0, len(rows), per):
            part = [r for _, r in rows[n:n + per]]
            Image.fromarray(np.vstack(part)).save(os.path.join(sheets, f'sheet-{n // per + 1:02d}.jpg'), quality=82)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    off = [k for k, v in meta.items() if v.get('off')]
    print(f'{len(meta)} cars, paint off for {len(off)}, public/paint = {size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
