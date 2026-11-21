"""Генерирует PNG-иконки приложения. Запуск: python tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / "icons"
ROOT.mkdir(exist_ok=True)


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    s = 4  # supersampling
    S = size * s
    img = Image.new("RGBA", (S, S), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    # мягкий вертикальный градиент
    for y in range(S):
        t = y / S
        c = int(28 - 18 * t)
        d.line([(0, y), (S, y)], fill=(c, c, c + 2, 255))
    pad = 0.30 if maskable else 0.22
    x0, x1 = S * pad, S * (1 - pad)
    w = x1 - x0
    # три столбика: расходы растут, затем падают — символ контроля
    bars = [(0.00, 0.55, (255, 69, 58)), (0.36, 0.85, (255, 255, 255)), (0.72, 0.38, (48, 209, 88))]
    bw = w * 0.28
    base = S * (1 - pad)
    r = bw * 0.28
    for off, hgt, col in bars:
        bx = x0 + w * off
        top = base - w * hgt
        d.rounded_rectangle([bx, top, bx + bw, base], radius=r, fill=col + (255,))
    return img.resize((size, size), Image.LANCZOS)


draw_icon(180).convert("RGB").save(ROOT / "apple-touch-icon.png")
draw_icon(192).save(ROOT / "icon-192.png")
draw_icon(512).save(ROOT / "icon-512.png")
draw_icon(512, maskable=True).save(ROOT / "icon-maskable-512.png")
print("icons ok")
