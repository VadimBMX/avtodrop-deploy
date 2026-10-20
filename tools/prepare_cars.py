"""Turn generated car pictures into game-ready images.

Put pictures into raw-cars/ named by the car number from docs/car-prompts.txt (001.png, 057.jpg ...)
or by the car id (vaz-2107.png). Add an "f" after the number to mirror it (005f.png) if the car faces left.
Then run:  npm run cars
Each picture gets its background removed, is cropped to the car, resized and saved as public/cars/<id>.webp.
Processed originals are moved to raw-cars/done/.

Needs Python 3 with:  pip install "rembg[cpu]" pillow
"""
import os, re, shutil, sys
from collections import deque
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw-cars')
DONE = os.path.join(RAW, 'done')
OUT = os.path.join(ROOT, 'public', 'cars')
# Part pictures (docs/part-prompts.txt) are named by part type and go to public/parts/<type>.webp.
PART_OUT = os.path.join(ROOT, 'public', 'parts')
PART_KEYS = {'eng', 'turbo', 'exhaust', 'gearbox', 'suspension', 'wheels', 'brakes', 'body', 'motor', 'battery', 'reducer'}
PROMPTS = os.path.join(ROOT, 'docs', 'car-prompts.txt')
sys.stdout.reconfigure(encoding='utf-8')


def car_index():
    by_num, ids = {}, set()
    for line in open(PROMPTS, encoding='utf-8-sig'):
        m = re.match(r'^(\d{3}) \| ([a-z0-9-]+) \| (.+?) \|', line)
        if m:
            by_num[int(m.group(1))] = (m.group(2), m.group(3))
            ids.add(m.group(2))
    return by_num, ids


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


def main():
    if not os.path.exists(PROMPTS):
        sys.exit('Немає docs/car-prompts.txt — спочатку запусти: npm run prompts')
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(DONE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    by_num, ids = car_index()
    # Numbered pictures dropped straight into public/cars by mistake are picked up too.
    for f in os.listdir(OUT):
        if re.match(r'^\d{1,3}f?\.(png|jpe?g|webp)$', f, re.I):
            shutil.move(os.path.join(OUT, f), os.path.join(RAW, f))
    files =[f for f in sorted(os.listdir(RAW)) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
    if not files:
        print(f'Тека {RAW} порожня. Поклади туди картинки з назвою-номером машини (001.png ...).')
        return
    from rembg import new_session, remove  # imported late: loading the model takes a few seconds
    session = new_session('isnet-general-use')
    ok, bad = 0, 0
    for f in files:
        stem = os.path.splitext(f)[0].strip().lower()
        flip = False
        m = re.match(r'^(\d{1,3})(f?)\b', stem)
        if stem in PART_KEYS:
            try:
                os.makedirs(PART_OUT, exist_ok=True)
                src = Image.open(os.path.join(RAW, f)).convert('RGB')
                cut = keep_main_object(remove(src, session=session, post_process_mask=True))
                bbox = cut.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
                if not bbox:
                    raise ValueError('не знайдено деталь на картинці')
                cut = cut.crop(bbox)
                cut.thumbnail((600, 600), Image.LANCZOS)
                cut.save(os.path.join(PART_OUT, f'{stem}.webp'), 'WEBP', quality=86, method=6)
                shutil.move(os.path.join(RAW, f), os.path.join(DONE, f))
                print(f'  ✓ {f} → public/parts/{stem}.webp  (деталь, {cut.width}×{cut.height})')
                ok += 1
            except Exception as e:
                print(f'  ✗ {f}: {e}')
                bad += 1
            continue
        if m:
            num, flip = int(m.group(1)), m.group(2) == 'f'
            if num not in by_num:
                print(f'  ✗ {f}: немає машини з номером {num:03d}')
                bad += 1
                continue
            car_id, name = by_num[num]
        elif stem.rstrip('f') in ids or stem in ids:
            car_id = stem if stem in ids else stem.rstrip('f')
            flip = car_id != stem
            name = car_id
        else:
            print(f'  ✗ {f}: назви файл номером машини (напр. 001.png) або її ID')
            bad += 1
            continue
        try:
            src = Image.open(os.path.join(RAW, f)).convert('RGB')
            cut = keep_main_object(remove(src, session=session, post_process_mask=True))
            bbox = cut.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
            if not bbox:
                raise ValueError('не знайдено машину на картинці')
            cut = cut.crop(bbox)
            if flip:
                cut = cut.transpose(Image.FLIP_LEFT_RIGHT)
            cut.thumbnail((1200, 600), Image.LANCZOS)
            dst = os.path.join(OUT, f'{car_id}.webp')
            cut.save(dst, 'WEBP', quality=86, method=6)
            shutil.move(os.path.join(RAW, f), os.path.join(DONE, f))
            print(f'  ✓ {f} → public/cars/{car_id}.webp  ({name}, {cut.width}×{cut.height}{", віддзеркалено" if flip else ""})')
            ok += 1
        except Exception as e:  # keep going with the rest of the batch
            print(f'  ✗ {f}: {e}')
            bad += 1
    print(f'Готово: {ok} оброблено, {bad} з помилками. Гра підхопить картинки протягом 30 секунд.')


main()
