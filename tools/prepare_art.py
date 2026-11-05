"""Game art (not cars) from generated pictures:  npm run art

Put each picture into raw-art/ under the same path it has in public/, any image extension:
    raw-art/s2/case/c-ua.png   -> public/s2/case/c-ua.webp   (closed crate: 320x320, centred, ~81% wide)
    raw-art/s2/case/o-ua.png   -> public/s2/case/o-ua.webp   (open crate: 420x420, centred, ~83% wide)
    raw-art/s2/pt/motor.png    -> public/s2/pt/motor.webp    (part icon: fits 240x240, cropped to the object)
    raw-art/biz/gas-1.png      -> public/biz/gas-1.webp      (business: fits 342x342, cropped to the object)
    raw-art/s2/bg/splash.png   -> public/s2/bg/splash.webp   (background: no cut-out, resized to 1080 px wide)
The background is removed with rembg (as `npm run cars`) unless the picture already has transparency; only the
largest object is kept (stray specks go). Processed originals move to raw-art/done/. Same sizes as the art audit of
05.11 (docs: the art report / prompts.md). Needs:  pip install "rembg[cpu]" pillow
"""
import os
import shutil
import sys
from collections import deque

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw-art')
DONE = os.path.join(RAW, 'done')
PUB = os.path.join(ROOT, 'public')
sys.stdout.reconfigure(encoding='utf-8')


# same as tools/prepare_cars.py (that file runs on import, so it is copied, not imported)
def keep_main_object(img):
    """Keep only the largest connected blob (the car); drops leftover specks of background."""
    alpha = img.getchannel('A')
    w, h = alpha.size
    sw = 240
    sh = max(1, int(h * sw / w))
    small = alpha.resize((sw, sh), Image.BILINEAR).point(lambda v: 255 if v > 60 else 0).filter(ImageFilter.MinFilter(3))
    px = small.load()
    label = [[0] * sw for _ in range(sh)]
    sizes, n = {}, 0
    for y in range(sh):
        for x in range(sw):
            if px[x, y] and not label[y][x]:
                n += 1
                label[y][x] = n
                q, cnt = deque([(x, y)]), 0
                while q:
                    cx, cy = q.popleft()
                    cnt += 1
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < sw and 0 <= ny < sh and px[nx, ny] and not label[ny][nx]:
                            label[ny][nx] = n
                            q.append((nx, ny))
                sizes[n] = cnt
    if not sizes:
        return img
    main = max(sizes, key=sizes.get)
    keep = Image.new('L', (sw, sh), 0)
    kp = keep.load()
    for y in range(sh):
        for x in range(sw):
            if label[y][x] == main:
                kp[x, y] = 255
    keep = keep.filter(ImageFilter.MaxFilter(7)).resize((w, h), Image.BILINEAR).point(lambda v: 255 if v > 100 else 0)
    img.putalpha(Image.composite(alpha, Image.new('L', (w, h), 0), keep))
    return img


def spec(rel):
    """(kind, size, fill): 'canvas' = square canvas of `size`, object `fill` of its width; 'fit' = cropped to the
    object, longest side ≤ size; 'bg' = opaque picture, `size` px wide."""
    d, name = os.path.split(rel.replace('\\', '/'))
    if d == 's2/case':
        return ('canvas', 420, 0.83) if name.startswith('o-') else ('canvas', 320, 0.81)
    if d in ('s2/bg', 'promo') or rel in ('s2/city', 's2/world'):
        return ('bg', 1080, 0)
    if d == 'biz':
        return ('fit', 342, 0)
    if d in ('s2/pt', 's2/key', 's2/pack'):
        return ('fit', 240, 0)
    if d == 'parts':
        return ('fit', 600, 0)
    return ('fit', 320, 0)


def has_alpha(img):
    return img.mode in ('RGBA', 'LA') and img.getchannel('A').getextrema()[0] < 250


def place(cut, kind, size, fill):
    bbox = cut.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    if not bbox:
        raise ValueError('no object found in the picture')
    obj = cut.crop(bbox)
    if kind == 'fit':
        obj.thumbnail((size, size), Image.LANCZOS)
        return obj
    sc = min(size * fill / obj.width, size * 0.92 / obj.height)
    obj = obj.resize((max(1, round(obj.width * sc)), max(1, round(obj.height * sc))), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.alpha_composite(obj, ((size - obj.width) // 2, (size - obj.height) // 2))
    return out


def main():
    os.makedirs(RAW, exist_ok=True)
    files = []
    for dp, dn, fn in os.walk(RAW):
        dn[:] = [x for x in dn if os.path.join(dp, x) != DONE]
        files += [os.path.join(dp, f) for f in sorted(fn) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
    if not files:
        print(f'{RAW} is empty: put pictures there under their public/ path (raw-art/s2/case/c-ua.png ...).')
        return
    session = remove = None
    ok = bad = 0
    for f in files:
        rel = os.path.splitext(os.path.relpath(f, RAW))[0].replace('\\', '/')
        kind, size, fill = spec(rel)
        try:
            img = Image.open(f)
            if kind == 'bg':
                img = img.convert('RGB')
                if img.width > size:
                    img = img.resize((size, round(img.height * size / img.width)), Image.LANCZOS)
            else:
                if has_alpha(img):
                    cut = img.convert('RGBA')
                else:
                    if session is None:
                        from rembg import new_session, remove  # noqa: PLC0415 (loading the model takes a few seconds)
                        session = new_session('isnet-general-use')
                    cut = remove(img.convert('RGB'), session=session, post_process_mask=True)
                img = place(keep_main_object(cut), kind, size, fill)
            out = os.path.join(PUB, rel + '.webp')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            img.save(out, 'WEBP', quality=88, method=6)
            dst = os.path.join(DONE, os.path.relpath(f, RAW))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(f, dst)
            print(f'  ok {os.path.relpath(f, RAW)} -> public/{rel}.webp ({img.width}x{img.height})')
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f'  FAIL {os.path.relpath(f, RAW)}: {e}')
            bad += 1
    print(f'done: {ok} ok, {bad} failed. The game picks new pictures up on the next load (hard refresh).')


if __name__ == '__main__':
    main()
