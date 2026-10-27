"""
Pulse chat wallpaper: an original, detailed hand-drawn doodle set (line art only) drawn as one 1000px tile and shown
at 450px, so the pattern is dense.

Scenes: a kid riding a bicycle and two kids sharing one, kids picking apples under a tree with a rabbit and a small
dog, kids skipping rope, kids drumming, a kid in a wheelchair with a friend, multi-tier pagodas with stairs, a thatched
village round hut, a globe. Packed around them: peace doves with olive branches, flowers and sunflowers, basketballs,
smiling suns, smileys, hearts, burgers, pizza slices, ice cream cones, phones, a tablet clock, clouds, chat icons.

    python3 scripts/chat_wallpaper.py src/assets/chat-wallpaper-light.svg '#c8bcad' 0.28
    python3 scripts/chat_wallpaper.py src/assets/chat-wallpaper-dark.svg '#e9edef' 0.06

src/index.css (.chat-wallpaper) uses those two files.
"""
import math
import random
import sys

W = H = 1000

def _k(s):
    return lambda v: round(v * s, 1)

def leaf(x, y, ang, L, s=1.0):
    """An almond leaf from (x, y) pointing at angle ang (degrees), with a midrib."""
    k = _k(s)
    a = math.radians(ang)
    ex, ey = x + math.cos(a) * k(L), y + math.sin(a) * k(L)
    nx, ny = -math.sin(a) * k(L) * 0.32, math.cos(a) * k(L) * 0.32
    mx, my = (x + ex) / 2, (y + ey) / 2
    return (f'<path d="M{x:.1f} {y:.1f} Q{mx+nx:.1f} {my+ny:.1f} {ex:.1f} {ey:.1f} Q{mx-nx:.1f} {my-ny:.1f} {x:.1f} {y:.1f} Z"/>'
            f'<path d="M{x:.1f} {y:.1f} L{(x+ex*2)/3:.1f} {(y+ey*2)/3:.1f}"/>')

def flower_stem(x, y, s=1.0, petals=7):
    """Flower head centred at (x, y) with a curved stem and two leaves."""
    k = _k(s)
    out = []
    for i in range(petals):
        a = 2 * math.pi * i / petals
        cx, cy = x + math.cos(a) * k(13), y + math.sin(a) * k(13)
        out.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{k(10)}" ry="{k(6)}" transform="rotate({math.degrees(a):.0f} {cx:.1f} {cy:.1f})"/>')
    out.append(f'<circle cx="{x}" cy="{y}" r="{k(6)}"/>')
    out.append(f'<path d="M{x-k(2)} {y-k(1)}h.01M{x+k(2)} {y+k(1)}h.01M{x+k(1)} {y-k(3)}h.01"/>')
    sx, sy = x, y + k(19)
    out.append(f'<path d="M{sx} {sy} q{-k(6)} {k(30)} {k(2)} {k(58)}"/>')
    out.append(leaf(sx - k(3), sy + k(30), 200, 22, s))
    out.append(leaf(sx - k(1), sy + k(40), -25, 20, s))
    return ''.join(out)

def sun_face(x, y, s=1.0):
    k = _k(s)
    rays = []
    for i in range(16):
        a = 2 * math.pi * i / 16
        r1, r2 = k(22), k(32 if i % 2 == 0 else 27)
        rays.append(f'M{x+math.cos(a)*r1:.1f} {y+math.sin(a)*r1:.1f} L{x+math.cos(a)*r2:.1f} {y+math.sin(a)*r2:.1f}')
    return (f'<circle cx="{x}" cy="{y}" r="{k(17)}"/><path d="{" ".join(rays)}"/>'
            f'<path d="M{x-k(7)} {y-k(4)} q{k(2)} {-k(3)} {k(4)} 0 M{x+k(3)} {y-k(4)} q{k(2)} {-k(3)} {k(4)} 0 M{x-k(8)} {y+k(5)} q{k(8)} {k(8)} {k(16)} 0"/>')

def dove2(x, y, s=1.0, flip=False):
    """A dove in flight carrying an olive branch; (x, y) = body centre."""
    k = _k(s)
    f = -1 if flip else 1
    X = lambda v: round(x + f * v * s, 1)
    Y = lambda v: round(y + v * s, 1)
    body = (f'<path d="M{X(-34)} {Y(6)} Q{X(-16)} {Y(-2)} {X(0)} {Y(-2)} Q{X(18)} {Y(-4)} {X(26)} {Y(-14)} Q{X(32)} {Y(-19)} {X(38)} {Y(-15)}'
            f' L{X(44)} {Y(-13)} L{X(38)} {Y(-10)} Q{X(34)} {Y(4)} {X(16)} {Y(10)} Q{X(-4)} {Y(16)} {X(-18)} {Y(14)} Z"/>')
    tail = f'<path d="M{X(-18)} {Y(14)} L{X(-40)} {Y(22)} L{X(-36)} {Y(12)} L{X(-44)} {Y(8)} L{X(-34)} {Y(6)}"/>'
    wing = (f'<path d="M{X(-4)} {Y(-2)} Q{X(-12)} {Y(-30)} {X(-2)} {Y(-46)} Q{X(6)} {Y(-34)} {X(10)} {Y(-40)} Q{X(14)} {Y(-26)} {X(20)} {Y(-30)}'
            f' Q{X(18)} {Y(-14)} {X(10)} {Y(-4)}"/>'
            f'<path d="M{X(-2)} {Y(-30)} Q{X(2)} {Y(-18)} {X(4)} {Y(-8)} M{X(8)} {Y(-28)} Q{X(10)} {Y(-16)} {X(9)} {Y(-6)}"/>')
    eye = f'<circle cx="{X(32)}" cy="{Y(-14)}" r="{k(1.2)}"/>'
    branch = (f'<path d="M{X(42)} {Y(-11)} Q{X(52)} {Y(-8)} {X(62)} {Y(-12)}"/>'
              + leaf(X(48), Y(-9), -60 if not flip else 240, 9, s) + leaf(X(54), Y(-10), 40 if not flip else 140, 9, s)
              + leaf(X(60), Y(-12), -40 if not flip else 220, 8, s))
    return body + tail + wing + eye + branch

def pagoda2(x, y, s=1.0, tiers=4):
    """Multi-tier pagoda standing on (x, y): spire, upturned eaves, window rows, hall with door, steps."""
    k = _k(s)
    out = []
    top = y - k(30) - tiers * k(26)
    out.append(f'<path d="M{x} {top-k(26)} v{k(26)}"/>')
    out += [f'<circle cx="{x}" cy="{top-k(26)}" r="{k(2.5)}"/>', f'<path d="M{x-k(4)} {top-k(18)} h{k(8)} M{x-k(5)} {top-k(12)} h{k(10)}"/>']
    for i in range(tiers):
        ty = top + i * k(26)
        w = k(22 + i * 9)
        ww = w - k(8)
        out.append(f'<path d="M{x-w-k(8)} {ty+k(6)} Q{x-w} {ty+k(8)} {x-w+k(4)} {ty+k(2)} Q{x} {ty-k(8)} {x+w-k(4)} {ty+k(2)} Q{x+w} {ty+k(8)} {x+w+k(8)} {ty+k(6)}"/>')
        out.append(f'<path d="M{x-w-k(8)} {ty+k(6)} Q{x} {ty+k(13)} {x+w+k(8)} {ty+k(6)}"/>')
        out.append(f'<path d="M{x-ww} {ty+k(10)} v{k(16)} M{x+ww} {ty+k(10)} v{k(16)}"/>')
        n = 2 + i
        for j in range(n):
            wx = x - ww + k(5) + j * ((2 * ww - k(10)) / max(n - 1, 1)) - k(2)
            out.append(f'<rect x="{wx:.1f}" y="{ty+k(14):.1f}" width="{k(4)}" height="{k(7)}" rx="{k(1)}"/>')
    hy = top + tiers * k(26)
    hw = k(22 + tiers * 9)
    out.append(f'<path d="M{x-hw} {hy+k(6)} h{2*hw} M{x-hw+k(6)} {hy+k(6)} v{k(18)} M{x+hw-k(6)} {hy+k(6)} v{k(18)}"/>')
    out.append(f'<path d="M{x-k(7)} {hy+k(24)} v{-k(12)} h{k(14)} v{k(12)}"/>')
    out.append(f'<path d="M{x-hw-k(4)} {hy+k(24)} h{2*hw+k(8)} M{x-hw-k(8)} {hy+k(30)} h{2*hw+k(16)} M{x-k(10)} {hy+k(24)} l{-k(3)} {k(6)} M{x+k(10)} {hy+k(24)} l{k(3)} {k(6)}"/>')
    return ''.join(out)

def hut2(x, y, s=1.0):
    """Thatched round hut on the ground line (x, y): layered domed thatch, round wall, arched door, small window."""
    k = _k(s)
    out = []
    eave_y, apex_y, rw = y - k(34), y - k(78), k(46)
    out.append(f'<path d="M{x-rw-k(6)} {eave_y} Q{x-rw+k(4)} {apex_y+k(6)} {x} {apex_y} Q{x+rw-k(4)} {apex_y+k(6)} {x+rw+k(6)} {eave_y}"/>')
    # layered thatch rows, each a scalloped band
    for r in range(4):
        yy = eave_y - r * k(10)
        half = rw + k(6) - r * k(9)
        n = 9 - r
        seg = 2 * half / n
        d = f'M{x-half:.1f} {yy:.1f}' + ''.join(f' q{seg/2:.1f} {k(4):.1f} {seg:.1f} 0' for _ in range(n))
        out.append(f'<path d="{d}"/>')
        for i in range(n):  # straw strokes
            sx = x - half + seg * (i + 0.5)
            out.append(f'<path d="M{sx:.1f} {yy-k(7):.1f} l{k(0.5)} {k(5)}"/>')
    out.append(f'<path d="M{x-k(2)} {apex_y} l{k(2)} {-k(7)} l{k(2)} {k(7)}"/>')
    wall = rw - k(6)
    out.append(f'<path d="M{x-wall} {eave_y+k(3)} v{k(31)} M{x+wall} {eave_y+k(3)} v{k(31)} M{x-wall-k(8)} {y} q{wall+k(8)} {k(6)} {2*wall+k(16)} 0"/>')
    out.append(f'<path d="M{x-k(9)} {y+k(2)} v{-k(16)} a{k(9)} {k(9)} 0 0 1 {k(18)} 0 v{k(16)}"/>')
    out.append(f'<path d="M{x+k(18)} {y-k(18)} a{k(5)} {k(5)} 0 0 1 {k(10)} 0 v{k(6)} h{-k(10)} z"/>')
    out.append(f'<path d="M{x-wall-k(16)} {y+k(2)} l{k(3)} {-k(6)} l{k(2)} {k(6)} l{k(3)} {-k(8)} l{k(2)} {k(8)}"/>')   # grass
    return ''.join(out)

# hand-made continent outlines on a unit circle (roughly Africa/Europe and the Americas)
_LANDS = [
    [(-0.05, -0.92), (0.3, -0.85), (0.45, -0.68), (0.2, -0.62), (-0.1, -0.7)],
    [(-0.15, -0.55), (0.1, -0.62), (0.25, -0.45), (0.15, -0.3), (0.32, -0.12), (0.38, 0.12), (0.22, 0.42), (0.06, 0.58), (-0.02, 0.36),
     (-0.12, 0.12), (-0.28, 0.02), (-0.26, -0.22)],
    [(-0.78, -0.35), (-0.55, -0.55), (-0.42, -0.32), (-0.5, -0.12), (-0.62, 0.02), (-0.5, 0.25), (-0.56, 0.5), (-0.7, 0.3), (-0.82, 0.0)],
    [(0.5, -0.45), (0.72, -0.36), (0.8, -0.1), (0.66, 0.02), (0.55, -0.12)],
]

def globe2(x, y, s=1.0):
    k = _k(s)
    r = k(30)
    out = [f'<circle cx="{x}" cy="{y}" r="{r}"/>']
    for land in _LANDS:
        pts = [(x + px * r, y + py * r) for px, py in land]
        d = f'M{pts[0][0]:.1f} {pts[0][1]:.1f}'
        for i in range(1, len(pts) + 1):
            a, b = pts[i - 1], pts[i % len(pts)]
            d += f' Q{a[0]:.1f} {a[1]:.1f} {(a[0]+b[0])/2:.1f} {(a[1]+b[1])/2:.1f}'
        out.append(f'<path d="{d} Z"/>')
    out.append(f'<path d="M{x-r-k(6)} {y+k(10)} q{r+k(6)} {k(16)} {2*r+k(12)} {-k(4)}"/>')     # orbit swoosh
    return ''.join(out)

def phone2(x, y, s=1.0):
    """Smartphone with an app grid; (x, y) = top-left."""
    k = _k(s)
    out = [f'<rect x="{x}" y="{y}" width="{k(44)}" height="{k(80)}" rx="{k(8)}"/>', f'<path d="M{x+k(16)} {y+k(5)} h{k(12)}"/>',
           f'<rect x="{x+k(4)}" y="{y+k(10)}" width="{k(36)}" height="{k(60)}" rx="{k(2)}"/>']
    for r in range(4):
        for c in range(3):
            out.append(f'<rect x="{x+k(8)+c*k(10)}" y="{y+k(15)+r*k(13)}" width="{k(7)}" height="{k(7)}" rx="{k(2)}"/>')
    out.append(f'<circle cx="{x+k(22)}" cy="{y+k(75)}" r="{k(2.5)}"/>')
    return ''.join(out)

def tablet_clock(x, y, s=1.0):
    k = _k(s)
    cx, cy = x + k(30), y + k(38)
    ticks = ' '.join(f'M{cx+math.cos(a)*k(15):.1f} {cy+math.sin(a)*k(15):.1f} L{cx+math.cos(a)*k(18):.1f} {cy+math.sin(a)*k(18):.1f}'
                     for a in [i * math.pi / 6 for i in range(12)])
    return (f'<rect x="{x}" y="{y}" width="{k(60)}" height="{k(76)}" rx="{k(8)}"/><rect x="{x+k(5)}" y="{y+k(8)}" width="{k(50)}" height="{k(60)}" rx="{k(3)}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{k(20)}"/><path d="{ticks}"/><path d="M{cx} {cy} v{-k(12)} M{cx} {cy} l{k(9)} {k(5)}"/>')

def icecream2(x, y, s=1.0):
    """Cone with two scoops; (x, y) = cone tip."""
    k = _k(s)
    top = y - k(46)
    return (f'<path d="M{x} {y} L{x-k(15)} {top} H{x+k(15)} Z"/>'
            f'<path d="M{x-k(9)} {top+k(8)} L{x+k(5)} {top+k(30)} M{x-k(2)} {top+k(2)} L{x+k(10)} {top+k(20)}'
            f' M{x+k(9)} {top+k(8)} L{x-k(5)} {top+k(30)} M{x+k(2)} {top+k(2)} L{x-k(10)} {top+k(20)}"/>'
            # lower scoop: dome resting on the rim with a dripping edge
            f'<path d="M{x-k(18)} {top} A{k(18)} {k(16)} 0 0 1 {x+k(18)} {top} q{-k(3)} {k(4)} {-k(6)} {k(1)} q{-k(2)} {k(7)} {-k(5)} {k(1)}'
            f' q{-k(4)} {k(3)} {-k(8)} {k(0)} q{-k(3)} {k(6)} {-k(6)} {k(0)} q{-k(4)} {k(3)} {-k(11)} {-k(2)}"/>'
            # upper scoop
            f'<path d="M{x-k(12)} {top-k(14)} A{k(12)} {k(12)} 0 1 1 {x+k(12)} {top-k(14)}"/>'
            f'<circle cx="{x}" cy="{top-k(36)}" r="{k(3)}"/>')

def pizza2(x, y, s=1.0):
    """Pizza slice; (x, y) = tip."""
    k = _k(s)
    return (f'<path d="M{x} {y} L{x-k(26)} {y-k(62)} Q{x} {y-k(72)} {x+k(26)} {y-k(62)} Z"/>'
            f'<path d="M{x-k(24)} {y-k(57)} Q{x} {y-k(66)} {x+k(24)} {y-k(57)}"/>'
            f'<circle cx="{x-k(8)}" cy="{y-k(44)}" r="{k(5)}"/><circle cx="{x+k(9)}" cy="{y-k(40)}" r="{k(4.5)}"/>'
            f'<circle cx="{x}" cy="{y-k(22)}" r="{k(4)}"/><path d="M{x-k(5)} {y-k(30)}h.01M{x+k(6)} {y-k(52)}h.01"/>')

def burger2(x, y, s=1.0):
    k = _k(s)
    seeds = ' '.join(f'M{x+dx*s:.1f} {y+dy*s:.1f} l{k(2)} {-k(1)}' for dx, dy in [(-14, -10), (-4, -14), (8, -12), (16, -7), (-20, -4), (2, -6)])
    return (f'<path d="M{x-k(30)} {y} Q{x-k(30)} {y-k(24)} {x} {y-k(24)} Q{x+k(30)} {y-k(24)} {x+k(30)} {y} Z"/><path d="{seeds}"/>'
            f'<path d="M{x-k(32)} {y+k(4)} q{k(4)} {k(5)} {k(8)} 0 t{k(8)} 0 t{k(8)} 0 t{k(8)} 0 t{k(8)} 0 t{k(8)} 0 t{k(8)} 0 t{k(8)} 0"/>'
            f'<rect x="{x-k(30)}" y="{y+k(8)}" width="{k(60)}" height="{k(9)}" rx="{k(4)}"/>'
            f'<path d="M{x-k(31)} {y+k(20)} h{k(62)} q0 {k(10)} {-k(9)} {k(10)} h{-k(44)} q{-k(9)} 0 {-k(9)} {-k(10)} z"/>')

def bike2(x, y, s=1.0):
    """A bicycle on the ground line; x = rear wheel centre."""
    k = _k(s)
    r = k(26)
    ry = y - r
    fx = x + k(92)
    bb = (x + k(40), ry)
    seat = (x + k(30), ry - k(38))
    head = (x + k(76), ry - k(40))
    spokes = lambda cx: ' '.join(f'M{cx} {ry} L{cx+math.cos(a)*r*0.92:.1f} {ry+math.sin(a)*r*0.92:.1f}' for a in [i * math.pi / 4 for i in range(8)])
    return (f'<circle cx="{x}" cy="{ry}" r="{r}" fill="none" fill-opacity="0"/><circle cx="{fx}" cy="{ry}" r="{r}" fill="none" fill-opacity="0"/><path d="{spokes(x)} {spokes(fx)}" fill="none" fill-opacity="0"/>'
            f'<path d="M{x} {ry} L{bb[0]} {bb[1]} L{seat[0]} {seat[1]} Z M{bb[0]} {bb[1]} L{head[0]} {head[1]} L{seat[0]+k(4)} {seat[1]+k(6)} M{head[0]} {head[1]} L{fx} {ry}"/>'
            f'<path d="M{seat[0]-k(9)} {seat[1]-k(3)} q{k(9)} {-k(4)} {k(16)} 0"/><path d="M{head[0]} {head[1]} l{-k(3)} {-k(12)} q{k(6)} {-k(2)} {k(12)} {k(3)}"/>'
            f'<circle cx="{bb[0]}" cy="{bb[1]}" r="{k(6)}" fill="none" fill-opacity="0"/><path d="M{bb[0]} {bb[1]} l{k(6)} {k(8)} h{k(5)}"/>')

def child(x, y, s=1.0, hair='boy', arms='down', mood='smile', legs=True):
    """Friendlier kid: (x, y) = head centre. Head, hair, face, T-shirt, shorts/skirt, legs, shoes."""
    k = _k(s)
    out = [f'<circle cx="{x}" cy="{y}" r="{k(12)}"/>']
    if hair == 'boy':
        out.append(f'<path d="M{x-k(12)} {y-k(1)} q{k(0)} {-k(14)} {k(13)} {-k(13)} q{k(12)} {k(1)} {k(11)} {k(10)} q{-k(6)} {-k(5)} {-k(13)} {-k(4)} q{-k(6)} {k(1)} {-k(11)} {k(7)}"/>')
    else:
        out.append(f'<path d="M{x-k(13)} {y+k(6)} q{-k(2)} {-k(20)} {k(13)} {-k(19)} q{k(15)} {k(1)} {k(13)} {k(19)} M{x-k(11)} {y-k(4)} q{k(8)} {-k(2)} {k(12)} {-k(9)}"/>')
        out.append(f'<path d="M{x+k(12)} {y-k(6)} q{k(9)} {k(1)} {k(8)} {k(12)}"/>')
    out.append(f'<path d="M{x-k(4.5)} {y}h.01M{x+k(4.5)} {y}h.01"/>')
    out.append(f'<path d="M{x-k(5)} {y+k(5)} q{k(5)} {k(5)} {k(10)} 0"/>' if mood == 'smile' else f'<path d="M{x-k(5)} {y+k(4)} q{k(5)} {k(8)} {k(10)} 0 z"/>')
    by = y + k(12)
    out.append(f'<path d="M{x-k(10)} {by+k(14)} q{-k(1)} {-k(12)} {k(4)} {-k(13)} h{k(12)} q{k(5)} {k(1)} {k(4)} {k(13)}"/>')     # shoulders
    out.append(f'<path d="M{x-k(9)} {by+k(4)} v{k(18)} h{k(18)} v{-k(18)}"/>')                                                       # shirt
    if hair == 'boy':
        out.append(f'<path d="M{x-k(9)} {by+k(22)} v{k(8)} h{k(8)} v{-k(6)} M{x+k(1)} {by+k(24)} v{k(6)} h{k(8)} v{-k(8)}"/>')       # shorts
    else:
        out.append(f'<path d="M{x-k(9)} {by+k(22)} l{-k(4)} {k(10)} h{k(26)} l{-k(4)} {-k(10)}"/>')                                   # skirt
    if legs:
        out.append(f'<path d="M{x-k(5)} {by+k(31)} v{k(12)} h{-k(5)} M{x+k(5)} {by+k(31)} v{k(12)} h{k(5)}"/>')                      # legs + shoes
    if arms == 'up':
        out.append(f'<path d="M{x-k(9)} {by+k(6)} l{-k(10)} {-k(14)} M{x+k(9)} {by+k(6)} l{k(10)} {-k(14)}"/>')
    elif arms == 'out':
        out.append(f'<path d="M{x-k(9)} {by+k(6)} l{-k(12)} {k(8)} M{x+k(9)} {by+k(6)} l{k(12)} {k(8)}"/>')
    elif arms == 'down':
        out.append(f'<path d="M{x-k(9)} {by+k(6)} l{-k(5)} {k(14)} M{x+k(9)} {by+k(6)} l{k(5)} {k(14)}"/>')
    return ''.join(out)

def kids_on_bike(x, y, s=1.0):
    """Two kids sharing a bicycle; x = rear wheel centre, y = ground."""
    k = _k(s)
    ry = y - k(26)
    seat_x, seat_y = x + k(30), ry - k(38)
    bb_x = x + k(40)
    out = [bike2(x, y, s)]
    hx, hy = seat_x + k(8), seat_y - k(40)                # rider: hips on the saddle
    out.append(child(hx, hy, s, 'boy', 'none', legs=False))
    out.append(f'<path d="M{hx+k(9)} {hy+k(18)} L{x+k(73)} {ry-k(50)}"/>')                          # arms to the handlebar
    out.append(f'<path d="M{hx-k(2)} {hy+k(42)} L{bb_x+k(4)} {ry-k(10)} l{k(2)} {k(10)} h{k(5)}"/>')     # leg to the pedal
    gx, gy = seat_x - k(14), seat_y - k(34)              # passenger behind, hugging
    out.append(child(gx, gy, s * 0.9, 'girl', 'none', legs=False))
    out.append(f'<path d="M{gx+k(8)} {gy+k(17)} q{k(10)} {k(6)} {k(20)} {k(2)}"/>')
    out.append(f'<path d="M{gx} {gy+k(39)} l{k(6)} {k(14)} h{k(5)}"/>')
    out.append(f'<path d="M{x-k(34)} {y+k(1)} q{k(30)} {k(4)} {k(60)} 0 t{k(80)} 0"/>')               # ground swoosh
    return ''.join(out)

def rabbit(x, y, s=1.0):
    k = _k(s)
    return (f'<path d="M{x-k(12)} {y} q{-k(4)} {-k(20)} {k(6)} {-k(24)} q{k(14)} {-k(2)} {k(14)} {k(18)} q{k(0)} {k(6)} {-k(6)} {k(6)} z"/>'
            f'<circle cx="{x+k(8)}" cy="{y-k(30)}" r="{k(8)}"/><path d="M{x+k(4)} {y-k(36)} q{-k(4)} {-k(18)} {k(2)} {-k(22)} q{k(3)} {k(10)} {k(2)} {k(20)}'
            f' M{x+k(10)} {y-k(37)} q{k(0)} {-k(18)} {k(7)} {-k(20)} q{k(1)} {k(10)} {-k(3)} {k(19)}"/><path d="M{x+k(11)} {y-k(31)}h.01"/>'
            f'<circle cx="{x-k(14)}" cy="{y-k(8)}" r="{k(3)}"/>')

def fox(x, y, s=1.0):
    k = _k(s)
    return (f'<path d="M{x-k(10)} {y} q{-k(2)} {-k(18)} {k(6)} {-k(22)} l{k(12)} {k(0)} q{k(6)} {k(10)} {k(2)} {k(22)} z"/>'
            f'<path d="M{x-k(2)} {y-k(22)} l{-k(6)} {-k(16)} l{k(6)} {k(4)} l{k(8)} {-k(2)} l{k(6)} {-k(6)} l{k(1)} {k(12)} l{k(4)} {k(6)} l{-k(10)} {k(4)}"/>'
            f'<path d="M{x-k(10)} {y-k(4)} q{-k(22)} {k(2)} {-k(20)} {-k(18)} q{k(8)} {k(4)} {k(12)} {k(10)}"/><path d="M{x+k(4)} {y-k(30)}h.01"/>')

def apple_tree(x, y, s=1.0):
    """Tree on the ground line at (x, y) with apples, two kids picking and one holding a basket, a rabbit and a fox."""
    k = _k(s)
    out = [f'<path d="M{x-k(8)} {y} q{k(4)} {-k(30)} {k(0)} {-k(70)} M{x+k(8)} {y} q{-k(2)} {-k(32)} {k(4)} {-k(70)} M{x} {y-k(60)} l{-k(14)} {-k(14)} M{x+k(2)} {y-k(56)} l{k(16)} {-k(12)}"/>']
    # bumpy canopy
    cx, cy, R = x, y - k(108), k(52)
    pts = 14
    d = ''
    for i in range(pts + 1):
        a = 2 * math.pi * i / pts
        px, py = cx + math.cos(a) * R, cy + math.sin(a) * R * 0.85
        if i == 0:
            d = f'M{px:.1f} {py:.1f}'
        else:
            pa = 2 * math.pi * (i - 0.5) / pts
            qx, qy = cx + math.cos(pa) * (R + k(12)), cy + math.sin(pa) * (R + k(12)) * 0.85
            d += f' Q{qx:.1f} {qy:.1f} {px:.1f} {py:.1f}'
    out.append(f'<path d="{d} Z"/>')
    for ax, ay in [(-30, -120), (-10, -138), (18, -128), (34, -104), (-26, -94), (6, -100), (-4, -120), (26, -146)]:
        out.append(f'<circle cx="{x+ax*s:.1f}" cy="{y+ay*s:.1f}" r="{k(4)}"/><path d="M{x+ax*s:.1f} {y+(ay-4)*s:.1f} l{k(1)} {-k(3)}"/>')
    out.append(child(x - k(70), y - k(56), s, 'girl', 'none'))
    out.append(f'<path d="M{x-k(78)} {y-k(36)} h{k(18)} l{-k(3)} {k(12)} h{-k(12)} z M{x-k(78)} {y-k(36)} q{k(9)} {-k(10)} {k(18)} 0"/>')   # basket
    out.append(child(x - k(36), y - k(60), s, 'boy', 'up'))
    out.append(child(x + k(60), y - k(58), s, 'boy', 'up'))
    out.append(rabbit(x - k(12), y, s * 0.9))
    out.append(dog(x + k(32), y, s * 0.9))
    out.append(f'<path d="M{x-k(100)} {y+k(2)} q{k(100)} {k(6)} {k(200)} 0"/>')
    return ''.join(out)

def smiley2(x, y, s=1.0):
    k = _k(s)
    return f'<circle cx="{x}" cy="{y}" r="{k(22)}"/><path d="M{x-k(8)} {y-k(6)} v{k(4)} M{x+k(8)} {y-k(6)} v{k(4)} M{x-k(11)} {y+k(6)} q{k(11)} {k(12)} {k(22)} 0"/>'

def heart2(x, y, s=1.0):
    k = _k(s)
    return f'<path d="M{x} {y+k(20)} C{x-k(30)} {y} {x-k(22)} {y-k(22)} {x} {y-k(10)} C{x+k(22)} {y-k(22)} {x+k(30)} {y} {x} {y+k(20)} Z"/>'

def cloud2(x, y, s=1.0):
    k = _k(s)
    return f'<path d="M{x-k(24)} {y} h{k(50)} a{k(10)} {k(10)} 0 0 0 {-k(6)} {-k(18)} a{k(13)} {k(13)} 0 0 0 {-k(24)} {-k(6)} a{k(10)} {k(10)} 0 0 0 {-k(20)} {k(24)} z"/>'

def thumbs(x, y, s=1.0):
    k = _k(s)
    return (f'<rect x="{x}" y="{y}" width="{k(8)}" height="{k(18)}" rx="{k(2)}"/>'
            f'<path d="M{x+k(8)} {y+k(2)} l{k(6)} {-k(10)} q{k(2)} {-k(6)} {k(6)} {-k(3)} q{k(2)} {k(4)} {k(-1)} {k(9)} h{k(9)} q{k(4)} {k(1)} {k(3)} {k(5)} l{-k(3)} {k(11)} q{-k(1)} {k(4)} {-k(5)} {k(4)} h{-k(15)}"/>')

def picture(x, y, s=1.0):
    k = _k(s)
    return f'<rect x="{x}" y="{y}" width="{k(28)}" height="{k(22)}" rx="{k(3)}"/><path d="M{x+k(3)} {y+k(19)} l{k(8)} {-k(9)} l{k(6)} {k(6)} l{k(4)} {-k(4)} l{k(5)} {k(7)}"/><circle cx="{x+k(20)}" cy="{y+k(7)}" r="{k(2.5)}"/>'

def swirl(x, y, s=1.0):
    k = _k(s)
    return f'<path d="M{x} {y} q{k(8)} {-k(8)} {k(16)} 0 t{k(16)} 0"/>'

def tuft(x, y, s=1.0):
    k = _k(s)
    return f'<path d="M{x-k(8)} {y} q{k(2)} {-k(8)} {-k(1)} {-k(14)} M{x} {y} q{k(0)} {-k(10)} {k(1)} {-k(18)} M{x+k(8)} {y} q{-k(2)} {-k(8)} {k(2)} {-k(13)}"/>'

def small_heart(x, y, s=1.0):
    return heart2(x, y, s * 0.35)

def skipping2(x, y, s=1.0):
    """Three kids skipping rope; (x, y) = middle kid's head."""
    k = _k(s)
    out = [child(x - k(44), y + k(8), s, 'boy', 'out'), child(x, y - k(8), s, 'girl', 'up'), child(x + k(44), y + k(8), s, 'girl', 'out')]
    out.append(f'<path d="M{x-k(65)} {y+k(34)} C{x-k(55)} {y-k(60)} {x+k(55)} {y-k(60)} {x+k(65)} {y+k(34)}"/>')
    out.append(f'<path d="M{x-k(14)} {y+k(62)} q{k(14)} {-k(5)} {k(28)} 0" stroke-dasharray="3 4"/>')   # hop marks
    return ''.join(out)

def drums2(x, y, s=1.0):
    """A kid drumming on a hand drum, a friend dancing; (x, y) = drummer's head."""
    k = _k(s)
    out = [child(x, y, s, 'boy', 'none')]
    out.append(f'<path d="M{x-k(9)} {y+k(18)} l{-k(10)} {-k(10)} l{-k(4)} {-k(10)} M{x+k(9)} {y+k(18)} l{k(10)} {-k(10)} l{k(4)} {-k(10)}"/>')  # arms + sticks
    dx, dy = x + k(40), y + k(34)
    out.append(f'<ellipse cx="{dx}" cy="{dy}" rx="{k(16)}" ry="{k(5)}"/>'
               f'<path d="M{dx-k(16)} {dy} l{k(4)} {k(22)} q{k(12)} {k(5)} {k(24)} 0 l{k(4)} {-k(22)}"/>'
               f'<path d="M{dx-k(14)} {dy+k(6)} l{k(7)} {k(14)} l{k(7)} {-k(14)} l{k(7)} {k(14)} l{k(7)} {-k(14)}"/>')
    out.append(child(x + k(84), y + k(4), s * 0.95, 'girl', 'up'))
    out.append(f'<path d="M{x+k(70)} {y-k(18)} q{k(4)} {-k(6)} {k(8)} 0 M{x+k(100)} {y-k(16)} q{k(4)} {-k(6)} {k(8)} 0"/>')   # music lines
    return ''.join(out)

def wheelchair2(x, y, s=1.0):
    """A kid in a wheelchair waving, a friend beside; (x, y) = big wheel centre."""
    k = _k(s)
    out = [f'<circle cx="{x}" cy="{y}" r="{k(26)}" fill="none" fill-opacity="0"/><circle cx="{x}" cy="{y}" r="{k(21)}" fill="none" fill-opacity="0"/><circle cx="{x}" cy="{y}" r="{k(3)}" fill="none" fill-opacity="0"/>',
           f'<path d="M{x-k(21)} {y} h{k(42)} M{x} {y-k(21)} v{k(42)}" fill="none" fill-opacity="0"/>',
           f'<circle cx="{x+k(40)}" cy="{y+k(20)}" r="{k(6)}" fill="none" fill-opacity="0"/>',
           f'<path d="M{x-k(8)} {y-k(46)} v{k(34)} h{k(40)} l{k(8)} {k(24)} M{x-k(8)} {y-k(46)} h{-k(10)} M{x+k(32)} {y-k(12)} v{k(26)}"/>']
    hx, hy = x + k(8), y - k(66)
    out.append(child(hx, hy, s, 'boy', 'up', legs=False))
    out.append(f'<path d="M{hx-k(6)} {hy+k(42)} h{k(22)} v{k(18)} h{k(6)} M{hx+k(2)} {hy+k(42)} h{k(18)}"/>')
    out.append(child(x + k(70), y - k(52), s * 0.95, 'girl', 'out'))
    return ''.join(out)


def roundhut2(x, y, s=1.0):
    """Traditional village round hut on the ground line (x, y): tall conical thatch with straw lines and a ragged
    fringe, a tied top knot, round mud wall and an arched doorway."""
    k = _k(s)
    apex, eave, rw = y - k(92), y - k(40), k(50)
    out = [f'<path d="M{x} {apex} L{x-rw-k(6)} {eave} Q{x} {eave+k(10)} {x+rw+k(6)} {eave} Z"/>',
           f'<path d="M{x-k(3)} {apex+k(1)} l{k(3)} {-k(9)} l{k(3)} {k(9)} M{x-k(5)} {apex+k(7)} h{k(10)}"/>']
    for t in [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8]:                       # straw lines from the top
        out.append(f'<path d="M{x + t*k(6):.1f} {apex + k(10):.1f} L{x + t*(rw+k(2)):.1f} {eave + k(2) + abs(t)*-k(2):.1f}"/>')
    for r in (0.38, 0.66):                                                           # binding rings
        yy, half = apex + (eave - apex) * r, (rw + k(6)) * r
        out.append(f'<path d="M{x-half:.1f} {yy:.1f} Q{x} {yy+k(5):.1f} {x+half:.1f} {yy:.1f}"/>')
    fringe = ''.join(f'M{x-rw-k(4)+i*k(8):.1f} {eave+k(1)+math.sin(i)*k(1.5):.1f} l{k(1):.1f} {k(6):.1f} ' for i in range(14))
    out.append(f'<path d="{fringe}"/>')
    wall = rw - k(8)
    out.append(f'<path d="M{x-wall} {eave+k(6)} v{k(34)} M{x+wall} {eave+k(6)} v{k(34)} M{x-wall-k(10)} {y} q{wall+k(10)} {k(7)} {2*wall+k(20)} 0"/>')
    out.append(f'<path d="M{x-k(10)} {y+k(2)} v{-k(18)} a{k(10)} {k(10)} 0 0 1 {k(20)} 0 v{k(18)}"/>')
    out.append(f'<path d="M{x-wall+k(6)} {y-k(20)} h{k(10)} M{x+wall-k(16)} {y-k(14)} h{k(10)}"/>')  # mud texture
    out.append(f'<path d="M{x-wall-k(18)} {y+k(2)} l{k(3)} {-k(7)} l{k(2)} {k(7)} l{k(3)} {-k(9)} l{k(2)} {k(9)}"/>')
    return ''.join(out)

def kid_on_bike(x, y, s=1.0):
    """One kid riding a bicycle with a front basket; x = rear wheel centre, y = ground."""
    k = _k(s)
    ry = y - k(26)
    seat_x, seat_y = x + k(30), ry - k(38)
    out = [bike2(x, y, s)]
    hx, hy = seat_x + k(8), seat_y - k(40)
    out.append(child(hx, hy, s, 'girl', 'none', legs=False))
    out.append(f'<path d="M{hx+k(9)} {hy+k(18)} L{x+k(73)} {ry-k(50)}"/>')
    out.append(f'<path d="M{hx-k(2)} {hy+k(42)} L{x+k(44)} {ry-k(10)} l{k(2)} {k(10)} h{k(5)}"/>')
    bx, by = x + k(80), ry - k(52)
    out.append(f'<path d="M{bx} {by} h{k(20)} l{-k(3)} {k(14)} h{-k(14)} z M{bx+k(6)} {by} v{k(14)} M{bx+k(12)} {by} v{k(14)}"/>')
    out.append(f'<path d="M{x-k(34)} {y+k(1)} q{k(30)} {k(4)} {k(60)} 0 t{k(80)} 0"/>')
    return ''.join(out)

def sunflower(x, y, s=1.0):
    """Sunflower head at (x, y): seed disc with a dotted centre, two rings of petals, stem with leaves."""
    k = _k(s)
    out = []
    for ring, (n, r, L, off) in enumerate([(14, 15, 11, 0), (14, 15, 9, math.pi / 14)]):
        for i in range(n):
            a = 2 * math.pi * i / n + off
            bx, by = x + math.cos(a) * k(r), y + math.sin(a) * k(r)
            tx, ty = x + math.cos(a) * k(r + L), y + math.sin(a) * k(r + L)
            nx, ny = -math.sin(a) * k(4), math.cos(a) * k(4)
            out.append(f'<path d="M{bx+nx:.1f} {by+ny:.1f} Q{tx:.1f} {ty:.1f} {bx-nx:.1f} {by-ny:.1f}"/>')
    out.append(f'<circle cx="{x}" cy="{y}" r="{k(15)}"/><circle cx="{x}" cy="{y}" r="{k(10)}"/>')
    seeds = ' '.join(f'M{x+dx*s:.1f} {y+dy*s:.1f}h.01' for dx, dy in [(-4, -4), (3, -5), (5, 1), (-1, 4), (-5, 2), (1, -1), (6, -3), (-3, 7)])
    out.append(f'<path d="{seeds}"/>')
    sy = y + k(26)
    out.append(f'<path d="M{x} {sy} q{-k(5)} {k(34)} {k(3)} {k(64)}"/>')
    out.append(leaf(x - k(2), sy + k(30), 200, 26, s))
    out.append(leaf(x, sy + k(42), -20, 24, s))
    return ''.join(out)

def basketball2(x, y, s=1.0):
    k = _k(s)
    r = k(20)
    return (f'<circle cx="{x}" cy="{y}" r="{r}"/><path d="M{x-r} {y} h{2*r} M{x} {y-r} v{2*r}"/>'
            f'<path d="M{x-k(14)} {y-k(14)} q{k(8)} {k(14)} 0 {k(28)} M{x+k(14)} {y-k(14)} q{-k(8)} {k(14)} 0 {k(28)}"/>')

def dog(x, y, s=1.0):
    """A small sitting dog; (x, y) = where it sits on the ground."""
    k = _k(s)
    return (f'<path d="M{x-k(12)} {y} q{-k(2)} {-k(16)} {k(4)} {-k(20)} l{k(8)} {k(0)} q{k(6)} {k(8)} {k(2)} {k(20)} z"/>'
            f'<circle cx="{x+k(4)}" cy="{y-k(26)}" r="{k(9)}"/><path d="M{x-k(4)} {y-k(30)} q{-k(6)} {k(2)} {-k(4)} {k(12)} M{x+k(11)} {y-k(32)} q{k(6)} {k(4)} {k(3)} {k(12)}"/>'
            f'<path d="M{x+k(1)} {y-k(27)}h.01M{x+k(7)} {y-k(27)}h.01M{x+k(4)} {y-k(23)} v{k(2)}"/><path d="M{x-k(12)} {y-k(6)} q{-k(10)} {-k(2)} {-k(8)} {-k(12)}"/>')

def dot(x, y, r=4):
    return f'<circle cx="{x}" cy="{y}" r="{r}"/>'

def sparkle(x, y, s=1.0):
    k = _k(s)
    return f'<path d="M{x} {y-k(6)} v{k(12)} M{x-k(6)} {y} h{k(12)}"/>'

# rough footprint of each motif at scale 1: (centre dx, centre dy, radius) from the (x, y) it is drawn at
FOOT = {
    flower_stem: (0, 30, 48), sun_face: (0, 0, 33), dove2: (9, -12, 52), pagoda2: (0, -80, 82), hut2: (0, -38, 58),
    globe2: (0, 0, 38), phone2: (22, 40, 44), tablet_clock: (30, 38, 46), icecream2: (0, -42, 44), pizza2: (0, -36, 40),
    burger2: (0, 5, 34), bike2: (46, -40, 72), kids_on_bike: (42, -55, 88), apple_tree: (0, -80, 108),
    skipping2: (0, 22, 80), drums2: (45, 30, 76), wheelchair2: (32, -26, 76), smiley2: (0, 0, 24), heart2: (0, 0, 24),
    roundhut2: (0, -44, 62), kid_on_bike: (46, -55, 86), sunflower: (0, 30, 50), basketball2: (0, 0, 22),
    cloud2: (0, -12, 30), thumbs: (12, 4, 16), picture: (14, 11, 18), tuft: (0, -8, 12), swirl: (16, -2, 18),
}

# hand-placed scenes and signature pieces
items = [
    (pagoda2, 190, 400, 1.0, {}),
    (kids_on_bike, 330, 380, 1.1, {}),
    (apple_tree, 790, 330, 1.0, {}),
    (pagoda2, 610, 250, 0.85, {}),
    (roundhut2, 830, 540, 1.0, {}),
    (kid_on_bike, 60, 950, 1.0, {}),
    (skipping2, 500, 610, 1.0, {}),
    (drums2, 110, 690, 1.0, {}),
    (wheelchair2, 690, 800, 1.0, {}),
    (globe2, 560, 450, 1.2, {}),
]

# packed around them: (motif, scale, how many), placed round-robin so every kind gets its share before the gaps close
QUOTA = [
    (dove2, 1.0, 9), (flower_stem, 1.0, 6), (sunflower, 0.95, 5), (roundhut2, 0.7, 3), (pagoda2, 0.6, 3),
    (kid_on_bike, 0.7, 3), (burger2, 1.0, 5), (icecream2, 1.0, 5), (pizza2, 1.0, 5), (phone2, 0.95, 4),
    (globe2, 0.9, 4), (sun_face, 1.0, 5), (basketball2, 1.1, 5), (tablet_clock, 0.85, 2), (kids_on_bike, 0.65, 1),
    (smiley2, 1.0, 10), (heart2, 0.9, 10), (cloud2, 1.0, 8), (thumbs, 1.2, 4), (picture, 1.2, 4),
    (flower_stem, 0.65, 6), (sunflower, 0.6, 4), (dove2, 0.6, 5), (sun_face, 0.7, 4), (basketball2, 0.8, 4),
]
FILLERS = [(tuft, 1.0), (swirl, 1.0), (heart2, 0.35), (smiley2, 0.5), (cloud2, 0.55)]

def circle(f, x, y, s):
    dx, dy, r = FOOT[f]
    return (x + dx * s, y + dy * s, r * s)

def torus_gap(a, b):
    """Space between two footprints on the repeating tile (negative = overlap)."""
    ddx = abs(a[0] - b[0]) % W; ddx = min(ddx, W - ddx)
    ddy = abs(a[1] - b[1]) % H; ddy = min(ddy, H - ddy)
    return math.hypot(ddx, ddy) - a[2] - b[2]

def packed(pad=8, seed=5):
    """Hand-placed scenes first, then the quota round-robin, then small fillers and dots in whatever gaps remain."""
    rnd = random.Random(seed)
    placed = list(items)
    circles = [circle(f, x, y, s) for f, x, y, s, kw in placed]

    def try_place(f, s, gap, attempts):
        for _ in range(attempts):
            sc = s * rnd.uniform(0.92, 1.08)
            x, y = rnd.uniform(0, W), rnd.uniform(0, H)
            c = circle(f, x, y, sc)
            if all(torus_gap(c, o) >= gap for o in circles):
                kw = {'flip': True} if f is dove2 and rnd.random() < 0.5 else {}
                placed.append((f, round(x, 1), round(y, 1), round(sc, 2), kw))
                circles.append(c)
                return True
        return False

    left = [[f, s, n] for f, s, n in QUOTA]
    while any(q[2] > 0 for q in left):
        progress = False
        for q in left:
            if q[2] > 0:
                if try_place(q[0], q[1], pad, 400):
                    q[2] -= 1
                    progress = True
                else:
                    q[2] = 0          # no room left for this kind
        if not progress:
            break
    for _ in range(70):
        f, s = rnd.choice(FILLERS)
        try_place(f, s, 5, 200)
    dots = []
    for _ in range(6000):
        if len(dots) >= 120:
            break
        x, y = rnd.uniform(0, W), rnd.uniform(0, H)
        c = (x, y, 5)
        if all(torus_gap(c, o) >= 3 for o in circles):
            circles.append(c)
            dots.append(sparkle(round(x, 1), round(y, 1)) if rnd.random() < 0.15 else dot(round(x, 1), round(y, 1), 2.5 if rnd.random() < 0.5 else 4))
    return placed, dots

def tile(color, opacity, stroke=3):  # shown at 450px (0.45x): about 1.35px lines on screen
    placed, dots = packed()
    body = ''.join(f(x, y, s, **kw) for f, x, y, s, kw in placed) + ''.join(dots)
    # drawn once, then repeated around the tile (<use>) so shapes crossing an edge continue on the next tile
    uses = ''.join(f'<use href="#d" x="{dx}" y="{dy}"/>' for dx in (-W, 0, W) for dy in (-H, 0, H))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            # fill="none" on the drawing itself too: no shape (wheels included) may ever be filled, whatever the renderer
            f'<defs><g id="d" fill="none">{body}</g></defs>'
            # the fade is one group opacity, not stroke-opacity: stroke-opacity applies to every line on its own, so where
            # lines overlap (8 spokes meeting at a hub, spokes over a rim) they stacked up and the wheels glowed
            f'<g opacity="{opacity}" fill="none" stroke="{color}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">{uses}</g></svg>')

if __name__ == '__main__':
    out = sys.argv[1]
    open(out, 'w').write(tile(sys.argv[2] if len(sys.argv) > 2 else '#c8bcad', sys.argv[3] if len(sys.argv) > 3 else '0.28'))
