"""Measures the profile frames' holes and the helmets' outline for the avatar (public/s2-ui.js HOLES / HELMET_FIT).

  python -I tools/frame_holes.py            → prints the HOLES table and HELMET_FIT to paste into public/s2-ui.js

Frame f<N> (public/s2/fr): the transparent region (alpha < 128) around the picture's middle; the helmet goes in its
largest inscribed circle (centre x, centre y, radius — shares of the picture's width / height / width), so ornaments
that poke into the hole (crowns, the neon skyline, the smoke) never cover it. The dark disc behind the helmet gets its
own radius: along 360 rays from that centre, the farthest first hit of a solid pixel (alpha >= 200), so the disc fills
the whole visible hole and its edge stays under the frame.
Helmets h<N> (public/s2/av): the smallest circle round the outline (alpha > 64), as shares of the 160 px picture —
the helmet is drawn with that circle's centre on the hole's centre, so it is equally far from the ring all round.
"""
import glob
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 's2')


def frame_hole(path):
    im = Image.open(path)
    w, h = im.size
    a = np.asarray(im.getchannel('A'))
    lab, _ = nd.label(a < 128)
    hole = lab == lab[h // 2, w // 2]
    dt = nd.distance_transform_edt(hole)
    iy, ix = np.unravel_index(dt.argmax(), dt.shape)
    r = float(dt.max())
    cx, cy = ix + 0.5, iy + 0.5
    far = r
    for k in range(360):
        t = k * math.pi / 180
        d = r
        while True:
            x, y = int(cx + d * math.cos(t)), int(cy + d * math.sin(t))
            if not (0 <= x < w and 0 <= y < h) or a[y, x] >= 200:
                break
            d += 0.5
        far = max(far, min(d, r * 1.25))
    return [cx / w, cy / h, r / w, w, h, far / w]


def helmet_circle(path):
    a = np.asarray(Image.open(path).getchannel('A'))
    n = a.shape[1]
    ys, xs = np.nonzero(a > 64)
    X, Y = xs + 0.5, ys + 0.5
    best = None
    for cx in np.arange(n * 0.4, n * 0.6, 0.25):
        for cy in np.arange(n * 0.4, n * 0.6, 0.25):
            r = float(np.sqrt(((X - cx) ** 2 + (Y - cy) ** 2).max()))
            if best is None or r < best[0]:
                best = (r, cx, cy)
    return best[1] / n, best[2] / n, best[0] / n


def main():
    frames = sorted(glob.glob(os.path.join(ROOT, 'fr', 'f*.webp')), key=lambda p: int(os.path.basename(p)[1:-5]))
    rows = []
    for p in frames:
        cx, cy, r, w, h, rb = frame_hole(p)
        rows.append(f"{os.path.basename(p)[:-5]}: [{cx:.4f}, {cy:.4f}, {r:.4f}, {w}, {h}, {rb:.4f}]")
    print('const HOLES = {\n  ' + ',\n  '.join(', '.join(rows[i:i + 3]) for i in range(0, len(rows), 3)) + ' };')
    hs = [helmet_circle(p) for p in sorted(glob.glob(os.path.join(ROOT, 'av', 'h*.webp')))]
    cx, cy, r = (sum(v[i] for v in hs) / len(hs) for i in range(3))
    spread = max(max(abs(v[0] - cx), abs(v[1] - cy), abs(v[2] - r)) for v in hs)
    print(f'const HELMET_FIT = [{cx:.4f}, {cy:.4f}, {r:.4f}]; // spread between helmets {spread:.4f}')


if __name__ == '__main__':
    main()
