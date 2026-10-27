"""Small copies of the car photos for lists: public/cars/thumb/<id>.webp, 480 px wide.

Garage tiles, case reels and race lists show a car 100–160 px wide (×3 on a phone screen = at most ~480 px), while a
photo is ~900 px wide. The game offers the small copy next to the photo (<img srcset>, the browser takes the one that
fits the size on screen), so lists load about a third of the bytes; big pictures (the car card, a drop) keep the photo.
cars/thumb/index.json keeps the hash of the photo each copy was made from (the same ?v= hash the server gives the
photo): a copy of an older photo is not offered until this is run again, so a replaced photo never shows stale.

Run after adding or replacing photos:  npm run car-thumbs   (only missing or outdated copies are made)
Needs Python 3 with Pillow.
"""
import base64, hashlib, json, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARS = os.path.join(ROOT, 'public', 'cars')
OUT = os.path.join(CARS, 'thumb')
WIDTH = 480
sys.stdout.reconfigure(encoding='utf-8')


def photo_hash(path):
    # src/static.js: sha256 of the file, base64url, first 12 characters
    return base64.urlsafe_b64encode(hashlib.sha256(open(path, 'rb').read()).digest()).decode().rstrip('=')[:12]


def main():
    os.makedirs(OUT, exist_ok=True)
    index_file = os.path.join(OUT, 'index.json')
    try:
        index = json.load(open(index_file, encoding='utf-8'))
    except (OSError, ValueError):
        index = {}
    made = kept = 0
    ids = set()
    for f in sorted(os.listdir(CARS)):
        m = re.match(r'^([a-z0-9-]+)\.(webp|png|jpe?g)$', f, re.I)
        if not m:
            continue
        ids.add(m.group(1))
        src, dst = os.path.join(CARS, f), os.path.join(OUT, m.group(1) + '.webp')
        h = photo_hash(src)
        if os.path.exists(dst) and index.get(m.group(1)) == h:
            kept += 1
            continue
        im = Image.open(src)
        im.load()
        if im.mode not in ('RGBA', 'RGB'):
            im = im.convert('RGBA')
        if im.width > WIDTH:
            im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        im.save(dst, 'WEBP', quality=82, method=6)
        index[m.group(1)] = h
        made += 1
    # copies of photos that are gone
    gone = 0
    for f in os.listdir(OUT):
        m = re.match(r'^([a-z0-9-]+)\.webp$', f)
        if m and m.group(1) not in ids:
            os.remove(os.path.join(OUT, f))
            index.pop(m.group(1), None)
            gone += 1
    with open(index_file, 'w', encoding='utf-8') as fh:
        json.dump({k: index[k] for k in sorted(index) if k in ids}, fh, indent=0)
        fh.write('\n')
    print(f'thumbs: {made} made, {kept} up to date, {gone} removed → public/cars/thumb/')


if __name__ == '__main__':
    main()
