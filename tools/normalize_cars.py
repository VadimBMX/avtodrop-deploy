"""Put every car photo on a canvas of the same shape (CANVAS_RATIO wide : 1 high), wheels on the bottom edge.

Shown with object-fit: contain, all cars then come out at the same scale: same length on screen, and a tall SUV
really looks taller than a low hypercar (instead of every car being blown up to fill its box).
Run once over public/cars:  python -I tools/normalize_cars.py   (safe to repeat: it re-crops first).
"""
import os
import sys
from PIL import Image

CANVAS_RATIO = 2.5
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'cars')


def fit_canvas(img):
    img = img.convert('RGBA')
    bbox = img.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    if w / h >= CANVAS_RATIO:
        cw, ch = w, round(w / CANVAS_RATIO)
    else:  # taller than the canvas (Fiat 500, big SUVs): pad the sides instead
        cw, ch = round(h * CANVAS_RATIO), h
    canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    canvas.paste(img, ((cw - w) // 2, ch - h))
    return canvas


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    n = 0
    for f in sorted(os.listdir(OUT)):
        if not f.lower().endswith('.webp'):
            continue
        p = os.path.join(OUT, f)
        fit_canvas(Image.open(p)).save(p, 'WEBP', quality=86, method=6)
        n += 1
    print(f'Готово: {n} фото на однаковому полотні {CANVAS_RATIO}:1')


if __name__ == '__main__':
    main()
