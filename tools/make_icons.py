"""Генерирует PNG-иконки приложения (гильош-розетка). Запуск: python tools/make_icons.py"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / "icons"
ROOT.mkdir(exist_ok=True)

INK = (18, 17, 23)
MINT = (127, 224, 194)
VIOLET = (167, 139, 250)
BRASS = (217, 184, 113)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    s = 4
    S = size * s
    img = Image.new("RGB", (S, S), INK)
    d = ImageDraw.Draw(img)
    cx = cy = S / 2
    R = S * (0.30 if maskable else 0.38)
    k, n = 9, 30
    w = max(1, int(S * 0.0035))
    for j in range(n):
        rot = j * 2 * math.pi / (k * n)
        pts = []
        for i in range(721):
            t = i / 720 * 2 * math.pi
            r = R * (0.62 + 0.3 * math.sin(k * t) + 0.08 * math.sin(3 * t + j * 0.15))
            pts.append((cx + r * math.cos(t + rot), cy + r * math.sin(t + rot)))
        tcol = j / (n - 1)
        col = mix(MINT, VIOLET, tcol * 2) if tcol < 0.5 else mix(VIOLET, BRASS, (tcol - 0.5) * 2)
        d.line(pts, fill=col, width=w, joint="curve")
    # внутренняя розетка
    for j in range(14):
        rot = j * 2 * math.pi / (12 * 14)
        pts = []
        for i in range(721):
            t = i / 720 * 2 * math.pi
            r = R * 0.4 * (0.6 + 0.28 * math.sin(12 * t) + 0.1 * math.sin(4 * t))
            pts.append((cx + r * math.cos(t + rot), cy + r * math.sin(t + rot)))
        d.line(pts, fill=mix(BRASS, MINT, j / 13), width=w, joint="curve")
    return img.resize((size, size), Image.LANCZOS)


draw_icon(180).save(ROOT / "apple-touch-icon.png")
draw_icon(192).save(ROOT / "icon-192.png")
draw_icon(512).save(ROOT / "icon-512.png")
draw_icon(512, maskable=True).save(ROOT / "icon-maskable-512.png")
print("icons ok")
