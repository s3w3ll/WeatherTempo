#!/usr/bin/env python3
"""Renders the iOS app icon (1024x1024, opaque) from the WeatherTempo mark in favicon.svg.

  python ios/tools/make-app-icon.py

The web favicon is a circle on a transparent square; iOS wants a full-bleed opaque square
(it applies its own rounded mask), so this redraws the same artwork edge to edge:
a warm sunrise gradient, the blue -> pink -> orange temperature curve, and its peak dot.
Drawn at 4x and downsampled for clean anti-aliasing.
"""
import os
import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "WeatherTempo", "Assets.xcassets", "AppIcon.appiconset", "AppIcon.png")
SIZE, SS = 1024, 4
N = SIZE * SS
U = N / 64.0   # favicon.svg is drawn in a 64-unit box

def hex2rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

# ── Background: linear gradient from bottom-left #ffe9d2 to top-right #ffd0c2 ──
y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
t = ((x / SIZE) + (1 - y / SIZE)) / 2          # 0 at bottom-left, 1 at top-right
c0, c1 = np.array(hex2rgb("#ffe9d2")), np.array(hex2rgb("#ffd0c2"))
bg = (c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None]).round().astype(np.uint8)
base = Image.fromarray(bg, "RGB").convert("RGBA")

# ── Foreground at 4x on a transparent layer ──
fg = Image.new("RGBA", (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(fg)

def bezier(p0, p1, p2, p3, steps=1500):
    out = []
    for i in range(steps + 1):
        s = i / steps
        a, b, c, e = (1 - s) ** 3, 3 * (1 - s) ** 2 * s, 3 * (1 - s) * s ** 2, s ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]))
    return out

# M 10 46 C 18 46, 20 18, 32 18 S 46 46, 54 46   (the S reflects the previous control point)
path = bezier((10, 46), (18, 46), (20, 18), (32, 18)) + bezier((32, 18), (44, 18), (46, 46), (54, 46))
xs = [p[0] for p in path]
x_min, x_max = min(xs), max(xs)
stops = [(0.0, hex2rgb("#5b8def")), (0.5, hex2rgb("#e8326c")), (1.0, hex2rgb("#ffaa3d"))]

def curve_color(px):
    u = (px - x_min) / (x_max - x_min)
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if u <= b:
            k = (u - a) / (b - a)
            return tuple(int(round(ca[i] + (cb[i] - ca[i]) * k)) for i in range(3)) + (255,)
    return stops[-1][1] + (255,)

r = 2.0 * U   # stroke-width 4 -> radius 2 units, round caps
for px, py in path:
    d.ellipse([px * U - r, py * U - r, px * U + r, py * U + r], fill=curve_color(px))

def dot(cx, cy, rad, fill):
    d.ellipse([cx * U - rad * U, cy * U - rad * U, cx * U + rad * U, cy * U + rad * U], fill=fill)

dot(10, 46, 2.8, hex2rgb("#5b8def") + (255,))
dot(54, 46, 2.8, hex2rgb("#5b8def") + (255,))
# peak dot: r=3.5 fill with a 1.5 stroke centred on the edge -> cream ring out to r=4.25, orange core to r=2.75
dot(32, 18, 4.25, hex2rgb("#fff8e6") + (255,))
dot(32, 18, 2.75, hex2rgb("#ffaa3d") + (255,))

fg = fg.resize((SIZE, SIZE), Image.LANCZOS)
icon = Image.alpha_composite(base, fg).convert("RGB")   # opaque: App Store icons must not have alpha
os.makedirs(os.path.dirname(OUT), exist_ok=True)
icon.save(OUT, "PNG", optimize=True)
print("wrote", os.path.normpath(OUT), icon.size, icon.mode)
