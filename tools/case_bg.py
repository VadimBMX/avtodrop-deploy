"""Backdrops for the case stage (public/case-bg/<key>.svg): one scene per case — a rusty garage, a night city, a tuning
workshop, a race track, a diamond vault, a gold art-deco hall, and a waving flag for every country case.

They sit at the very bottom of #stage::before (under the haze, the neon arc and the lamps), so they stay dim: the reel
cards and the dropped car are what the eye should find. The middle (where the cards run) is darkened by a vignette.
Plain SVG, no filters (cheap phones), ~1–4 KB each. Rerun: python3 tools/case_bg.py
"""
import math
import os
import random

W, H = 420, 300
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'case-bg')

# the dark middle where the reel runs; flags and scenes fade into the page colour towards the bottom
VIGNETTE = (
    '<radialGradient id="v" cx="50%" cy="52%" r="60%"><stop offset="0" stop-color="#0b0e14" stop-opacity=".78"/>'
    '<stop offset=".55" stop-color="#0b0e14" stop-opacity=".45"/><stop offset="1" stop-color="#0b0e14" stop-opacity="0"/></radialGradient>'
)


def svg(defs, body, vignette=True):
    v = f'<rect width="{W}" height="{H}" fill="url(#v)"/>' if vignette else ''
    # soft top and bottom edges: the scene fades in under the lamps and out below the floor line (no hard seams)
    fade = ('<linearGradient id="fm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/>'
            '<stop offset=".24" stop-color="#fff"/><stop offset=".6" stop-color="#fff"/><stop offset=".86" stop-color="#fff" stop-opacity="0"/></linearGradient>'
            f'<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="url(#fm)"/></mask>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMin slice">'
            f'<defs>{VIGNETTE}{fade}{defs}</defs><g mask="url(#m)">{body}{v}</g></svg>')


def f(x):
    return f'{x:.1f}'.rstrip('0').rstrip('.')


# A flag on a waving cloth: the flag is drawn flat, then light/dark vertical bands fake the folds; the whole thing is dim.
WAVE = ('<linearGradient id="w" x1="0" y1="0" x2="1" y2="0">'
        + ''.join(f'<stop offset="{i / 12:.3f}" stop-color="{"#000" if i % 2 else "#fff"}" stop-opacity="{.32 if i % 2 else .07}"/>' for i in range(13))
        + '</linearGradient>')


def flag(inner, op=.42, extra_defs=''):
    return svg(WAVE + extra_defs, f'<g opacity="{op}">{inner}</g><rect width="{W}" height="{H}" fill="url(#w)"/>')


def stars5(cx, cy, r, fill, rot=-90):
    pts = []
    for i in range(10):
        a = math.radians(rot + i * 36)
        rr = r if i % 2 == 0 else r * .4
        pts.append(f'{f(cx + rr * math.cos(a))},{f(cy + rr * math.sin(a))}')
    return f'<polygon points="{" ".join(pts)}" fill="{fill}"/>'


def ua():
    return flag(f'<rect width="{W}" height="150" fill="#0057b7"/><rect y="150" width="{W}" height="150" fill="#ffd700"/>', .4)


def jp():
    # a red sun on a pale cloth (only the disc — no rays)
    return flag(f'<rect width="{W}" height="{H}" fill="#e9e6e1" opacity=".55"/><circle cx="210" cy="132" r="92" fill="#bc002d"/>', .4)


def de():
    return flag(f'<rect width="{W}" height="100" fill="#111"/><rect y="100" width="{W}" height="100" fill="#dd0000"/><rect y="200" width="{W}" height="100" fill="#ffce00"/>', .45)


def it():
    return flag(f'<rect width="140" height="{H}" fill="#009246"/><rect x="140" width="140" height="{H}" fill="#f1f2f1"/><rect x="280" width="140" height="{H}" fill="#ce2b37"/>', .36)


def us():
    sh = H / 13
    stripes = ''.join(f'<rect y="{f(i * sh)}" width="{W}" height="{f(sh)}" fill="#b22234"/>' for i in range(0, 13, 2))
    canton = f'<rect width="190" height="{f(sh * 7)}" fill="#3c3b6e"/>'
    st = ''.join(stars5(16 + c * 32 + (16 if r % 2 else 0), 13 + r * 17.5, 5.5, '#fff') for r in range(9) for c in range(6 if r % 2 == 0 else 5))
    return flag(f'<rect width="{W}" height="{H}" fill="#eee"/>{stripes}{canton}{st}', .38)


def gb():
    # Union Jack, stretched to the stage (diagonals from corner to corner)
    return flag(
        f'<rect width="{W}" height="{H}" fill="#012169"/>'
        f'<path d="M0 0L{W} {H}M{W} 0L0 {H}" stroke="#fff" stroke-width="54"/>'
        f'<path d="M0 0L{W} {H}M{W} 0L0 {H}" stroke="#c8102e" stroke-width="18"/>'
        f'<path d="M{W / 2} 0V{H}M0 {H / 2}H{W}" stroke="#fff" stroke-width="80"/>'
        f'<path d="M{W / 2} 0V{H}M0 {H / 2}H{W}" stroke="#c8102e" stroke-width="46"/>', .4)


def cn():
    big = stars5(70, 70, 40, '#ffde00')
    small = ''.join(stars5(x, y, 13, '#ffde00', rot) for x, y, rot in ((136, 30, -60), (160, 58, -80), (160, 96, -100), (136, 124, -120)))
    return flag(f'<rect width="{W}" height="{H}" fill="#de2910"/>{big}{small}', .42)


def rust():
    rnd = random.Random(7)
    # corrugated metal wall: ridges as thin light/dark lines
    ridges = ''.join(f'<path d="M{x} 0V{H}" stroke="#5a3a22" stroke-width="5" opacity=".55"/><path d="M{x + 3} 0V{H}" stroke="#9b6a3e" stroke-width="1" opacity=".35"/>' for x in range(0, W, 14))
    # rust streaks running down from the bolts
    streaks = ''.join(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{w / 2}" fill="url(#rs)" opacity="{o:.2f}"/>'
        for x, y, w, h, o in ((rnd.randrange(0, W), rnd.randrange(0, 60), rnd.randrange(8, 26), rnd.randrange(60, 170), rnd.uniform(.35, .7)) for _ in range(14)))
    bolts = ''.join(f'<circle cx="{x}" cy="{y}" r="2.2" fill="#c08a52" opacity=".5"/>' for y in (22, 128) for x in range(7, W, 28))
    # tool board on both sides: a wrench, a hammer, a tyre
    tools = (
        '<g fill="none" stroke="#e0a066" stroke-width="3" stroke-linecap="round" opacity=".45">'
        '<path d="M40 60l30 34"/><circle cx="36" cy="55" r="9"/><circle cx="74" cy="99" r="6"/>'
        '<path d="M380 52v52M366 52h28"/><circle cx="340" cy="78" r="22"/><circle cx="340" cy="78" r="10"/></g>'
        '<path d="M0 40h' + str(W) + '" stroke="#2a1a0e" stroke-width="2" opacity=".6"/>')
    defs = '<linearGradient id="rs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9662a"/><stop offset="1" stop-color="#d9662a" stop-opacity="0"/></linearGradient>'
    return svg(defs, f'<rect width="{W}" height="{H}" fill="#24160c" opacity=".7"/>{ridges}{streaks}{bolts}{tools}')


def city():
    rnd = random.Random(3)
    stars = ''.join(f'<circle cx="{rnd.randrange(W)}" cy="{rnd.randrange(0, 110)}" r="{rnd.choice((.6, .8, 1.1))}" fill="#fff" opacity="{rnd.uniform(.3, .8):.2f}"/>' for _ in range(46))
    moon = '<circle cx="330" cy="46" r="17" fill="#e9eefc" opacity=".55"/><circle cx="337" cy="41" r="15" fill="#0d1424" opacity=".9"/>'
    # two rows of towers: far (lighter blue) and near (dark) with lit windows
    def row(seed, base, hmin, hmax, fill, wop):
        r = random.Random(seed)
        x, out = -6, ''
        while x < W:
            w, h = r.randrange(18, 40), r.randrange(hmin, hmax)
            out += f'<rect x="{x}" y="{base - h}" width="{w}" height="{h + 60}" fill="{fill}"/>'
            for wy in range(base - h + 6, base + 50, 9):
                for wx in range(x + 4, x + w - 4, 7):
                    if r.random() < .28:
                        out += f'<rect x="{wx}" y="{wy}" width="3" height="4" fill="#ffd36b" opacity="{wop}"/>'
            if r.random() < .3:
                out += f'<path d="M{x + w // 2} {base - h}v-14" stroke="{fill}" stroke-width="2"/><circle cx="{x + w // 2}" cy="{base - h - 14}" r="1.6" fill="#ff4d4d"/>'
            x += w + r.randrange(0, 5)
        return out
    defs = '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1424"/><stop offset="1" stop-color="#1b3a8a" stop-opacity=".55"/></linearGradient>'
    return svg(defs, f'<rect width="{W}" height="{H}" fill="url(#sky)" opacity=".85"/>{stars}{moon}'
               f'<g opacity=".55">{row(11, 200, 60, 130, "#22345e", .5)}</g><g opacity=".85">{row(5, 225, 30, 95, "#111a2e", .75)}</g>')


def tuning():
    # hexagon grille, neon tubes on the walls, a couple of gear outlines
    hexes = ''
    r = 14
    for row in range(0, 13):
        for col in range(0, 18):
            cx = col * r * 1.75 + (r * .875 if row % 2 else 0)
            cy = row * r * 1.52
            pts = ' '.join(f'{f(cx + r * math.cos(math.radians(60 * k + 30)))},{f(cy + r * math.sin(math.radians(60 * k + 30)))}' for k in range(6))
            hexes += f'<polygon points="{pts}"/>'
    gear = lambda cx, cy, R: (
        f'<g transform="translate({cx} {cy})" fill="none" stroke="#22e6d0" stroke-width="2.5" opacity=".38">'
        f'<circle r="{R}"/><circle r="{R * .4}"/>'
        + ''.join(f'<rect x="-4" y="{-R - 7}" width="8" height="9" transform="rotate({k * 45})"/>' for k in range(8)) + '</g>')
    tubes = ('<g stroke-linecap="round" fill="none">'
             '<path d="M18 40L70 200" stroke="#22e6d0" stroke-width="3" opacity=".55"/><path d="M18 40L70 200" stroke="#22e6d0" stroke-width="10" opacity=".12"/>'
             '<path d="M402 40L350 200" stroke="#d946ef" stroke-width="3" opacity=".55"/><path d="M402 40L350 200" stroke="#d946ef" stroke-width="10" opacity=".12"/></g>')
    return svg('', f'<rect width="{W}" height="{H}" fill="#0c1820" opacity=".7"/><g fill="none" stroke="#2fd3c6" stroke-width="1" opacity=".18">{hexes}</g>'
               f'{gear(64, 70, 22)}{gear(362, 92, 16)}{tubes}')


def sport():
    # chequered flags in the top corners, speed streaks, red-white kerb on the horizon
    sq = 13
    def chequer(x0, y0, cols, rows, skew):
        out = ''
        for r in range(rows):
            for c in range(cols):
                if (r + c) % 2 == 0:
                    x, y = x0 + c * sq, y0 + r * sq + math.sin(c / 1.6) * 5
                    out += f'<rect x="{f(x)}" y="{f(y)}" width="{sq}" height="{sq}"/>'
        return f'<g fill="#fff" transform="skewY({skew})" transform-origin="{x0} {y0}">{out}</g>'
    streaks = ''.join(f'<path d="M{x} {y}h{l}" stroke="#ff4040" stroke-width="{w}" stroke-linecap="round" opacity="{o}"/>'
                      for x, y, l, w, o in ((-10, 120, 120, 2, .5), (310, 104, 130, 2, .5), (-20, 150, 90, 1.4, .4), (340, 160, 100, 1.4, .4), (20, 90, 70, 1, .35), (330, 76, 80, 1, .35)))
    kerb = ''.join(f'<path d="M{x} 212l20 0l-8 16h-20z" fill="{"#e11d2e" if (x // 20) % 2 else "#f2f2f2"}"/>' for x in range(-20, W + 20, 20))
    return svg('', f'<rect width="{W}" height="{H}" fill="#1a0b0e" opacity=".6"/>'
               f'<g opacity=".4">{chequer(-8, 8, 8, 5, -8)}{chequer(322, 8, 8, 5, 8)}</g>{streaks}<g opacity=".45">{kerb}</g>')


def premium():
    rnd = random.Random(9)
    # argyle (diamond lattice) in silver on deep teal, a few sparkles
    lat = ''.join(f'<path d="M{x} 0L{x + H} {H}M{x} 0L{x - H} {H}"/>' for x in range(-H, W + H, 34))
    sparks = ''.join(
        f'<path d="M{x} {y - s}Q{x} {y} {x + s} {y}Q{x} {y} {x} {y + s}Q{x} {y} {x - s} {y}Q{x} {y} {x} {y - s}z" fill="#d6f6ff" opacity="{o:.2f}"/>'
        for x, y, s, o in ((rnd.randrange(10, W - 10), rnd.randrange(10, 150), rnd.choice((4, 5, 7)), rnd.uniform(.35, .8)) for _ in range(12)))
    gem = ('<g fill="none" stroke="#9eeaff" stroke-width="2" opacity=".4" transform="translate(210 46)">'
           '<path d="M-26 -10h52l12 14-38 40-38-40z"/><path d="M-38 4h76M-14 -10l-6 14 20 40 20-40-6-14"/></g>')
    defs = '<linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a2a33"/><stop offset="1" stop-color="#062026" stop-opacity=".3"/></linearGradient>'
    return svg(defs, f'<rect width="{W}" height="{H}" fill="url(#pg)" opacity=".85"/><g stroke="#8fdcf0" stroke-width=".8" opacity=".22">{lat}</g>{sparks}{gem}')


def elite():
    rnd = random.Random(4)
    # black and gold art deco: a sunburst from the top centre, stepped deco frames at the sides, gold dust, a crown
    rays = ''.join(
        f'<path d="M210 -10L{f(210 + 520 * math.cos(math.radians(a - 1.6)))} {f(-10 + 520 * math.sin(math.radians(a - 1.6)))}L{f(210 + 520 * math.cos(math.radians(a + 1.6)))} {f(-10 + 520 * math.sin(math.radians(a + 1.6)))}z"/>'
        for a in range(18, 163, 9))
    deco = ''.join(f'<path d="M{x0} {H}V{90 + i * 18}h{d * (30 - i * 8)}" fill="none"/>' for x0, d in ((10, 1), (W - 10, -1)) for i in range(3))
    dust = ''.join(f'<circle cx="{rnd.randrange(W)}" cy="{rnd.randrange(0, 170)}" r="{rnd.choice((.7, 1, 1.4))}" fill="#ffd36b" opacity="{rnd.uniform(.3, .9):.2f}"/>' for _ in range(40))
    crown = ('<g transform="translate(210 30)" fill="none" stroke="#ffd36b" stroke-width="2.4" stroke-linejoin="round" opacity=".6">'
             '<path d="M-24 12L-28 -10L-12 2L0 -16L12 2L28 -10L24 12z"/><path d="M-24 18h48"/></g>')
    defs = '<linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf5a" stop-opacity=".35"/><stop offset=".6" stop-color="#ffcf5a" stop-opacity="0"/></linearGradient>'
    return svg(defs, f'<rect width="{W}" height="{H}" fill="#120e05" opacity=".75"/><g fill="url(#eg)">{rays}</g>'
               f'<g stroke="#c9a04a" stroke-width="2" opacity=".45">{deco}</g>{dust}{crown}')


def starter():
    rnd = random.Random(2)
    cols = ('#ffc400', '#ff5d8f', '#4fc3ff', '#7cff6b', '#b18cff')
    conf = ''.join(
        f'<rect x="{rnd.randrange(W)}" y="{rnd.randrange(0, 200)}" width="{rnd.choice((4, 5, 6))}" height="{rnd.choice((8, 10, 12))}" rx="1" fill="{rnd.choice(cols)}" opacity="{rnd.uniform(.35, .75):.2f}" transform="rotate({rnd.randrange(-60, 60)})" transform-origin="center"/>'
        for _ in range(60))
    ribbon = '<path d="M0 30C110 70 310 -10 420 40" stroke="#ffc400" stroke-width="10" fill="none" opacity=".25"/>'
    return svg('', f'{ribbon}{conf}')


SCENES = {'rust': rust, 'city': city, 'tuning': tuning, 'sport': sport, 'premium': premium, 'elite': elite, 'starter': starter,
          'c-ua': ua, 'c-jp': jp, 'c-de': de, 'c-it': it, 'c-us': us, 'c-gb': gb, 'c-cn': cn}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for k, fn in SCENES.items():
        with open(os.path.join(OUT, k + '.svg'), 'w') as fh:
            fh.write(fn())
    print(' '.join(f'{k}:{os.path.getsize(os.path.join(OUT, k + ".svg"))}' for k in SCENES))
