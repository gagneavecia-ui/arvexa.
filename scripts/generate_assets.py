#!/usr/bin/env python3
"""
generate_assets.py — ARVEXA School → Android
Génère icônes launcher (toutes densités + adaptatives) et écrans splash
(portrait/paysage, toutes densités) à partir de icon.png.
Style : Cinematic Luxury — fond noir #0A0A0A, or #B8860B / #E0B84A.
"""
from PIL import Image, ImageDraw, ImageFont, ImageOps
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
SRC = Image.open(os.path.join(ROOT, 'icon.png')).convert('RGBA')

INK = (10, 10, 10, 255)        # #0A0A0A
GOLD = (184, 134, 11, 255)     # #B8860B
GOLD_BRIGHT = (224, 184, 74, 255)  # #E0B84A
CREAM = (245, 240, 232, 255)   # #F5F0E8

# ── Icônes launcher (classiques) ──────────────────────────────
DENSITIES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}


def make_round(img, size):
    """Disque plein avec l'icône dedans (ic_launcher_round)."""
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((0, 0, size, size), fill=255)
    out = img.resize((size, size), Image.LANCZOS)
    out.putalpha(mask)
    return out


for dpi, size in DENSITIES.items():
    folder = os.path.join(RES, f'mipmap-{dpi}')
    os.makedirs(folder, exist_ok=True)

    # ic_launcher : carré aux coins arrondis (léger), fond noir
    base = Image.new('RGBA', (size, size), INK)
    icon = SRC.resize((size, size), Image.LANCZOS)
    base.alpha_composite(icon)
    base.save(os.path.join(folder, 'ic_launcher.png'))

    # ic_launcher_round : disque
    make_round(base, size).save(os.path.join(folder, 'ic_launcher_round.png'))

    # ic_launcher_foreground : 66 % de la zone (padding sécurité adaptive)
    fg_size = size * 3  # hi-res puis downscale pour netteté
    fg = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
    ic = SRC.resize((int(fg_size * 0.62), int(fg_size * 0.62)), Image.LANCZOS)
    off = (fg_size - ic.width) // 2
    fg.alpha_composite(ic, (off, off))
    fg = fg.resize((size, size), Image.LANCZOS)
    fg.save(os.path.join(folder, 'ic_launcher_foreground.png'))

print('Icônes launcher : OK')

# ── Fond adaptatif : noir cinématique ─────────────────────────
with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0A0A0A</color>\n</resources>\n')

# ── Splash screens ────────────────────────────────────────────
# Portrait et paysage, toutes densités. Logo centré sur fond noir,
# filigrane or discret + liseré « ARVEXA School ».
FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]


def find_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make_splash(w, h):
    img = Image.new('RGB', (w, h), INK)
    d = ImageDraw.Draw(img)

    # Liseré doré horizontal centré derrière le logo (ligne cinématique)
    cy = h // 2
    line_h = max(2, h // 480)
    d.rectangle([0, cy - int(h * 0.115), w, cy - int(h * 0.115) + line_h], fill=(184, 134, 11, 255))

    # Logo centré (55 % de la plus petite dimension)
    m = min(w, h)
    logo = SRC.resize((int(m * 0.42), int(m * 0.42)), Image.LANCZOS)
    off = ((w - logo.width) // 2, cy - logo.height // 2 - int(m * 0.02))
    img.paste(logo, off, logo)

    # Texte « ARVEXA School » sous le logo, or lumineux
    fs = max(14, m // 22)
    font = find_font(fs)
    text = 'ARVEXA School'
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (w - tw) // 2
    ty = cy + int(m * 0.115)
    d.text((tx, ty), text, font=font, fill=GOLD_BRIGHT)

    # Sous-titre discret crème
    fs2 = max(11, m // 42)
    font2 = find_font(fs2)
    text2 = 'Reussir. Progresse. Rayonne.'
    bbox2 = d.textbbox((0, 0), text2, font=font2)
    tw2 = bbox2[2] - bbox2[0]
    d.text(((w - tw2) // 2, ty + th + int(m * 0.02)), text2, font=font2, fill=CREAM)
    return img


SPLASH = {
    'drawable': (480, 320),
    'drawable-land-mdpi': (480, 320), 'drawable-land-hdpi': (800, 480),
    'drawable-land-xhdpi': (960, 720), 'drawable-land-xxhdpi': (1600, 960),
    'drawable-land-xxxhdpi': (1920, 1080),
    'drawable-port-mdpi': (320, 480), 'drawable-port-hdpi': (480, 800),
    'drawable-port-xhdpi': (720, 960), 'drawable-port-xxhdpi': (960, 1600),
    'drawable-port-xxxhdpi': (1080, 1920),
}

for folder, (w, h) in SPLASH.items():
    folder_path = os.path.join(RES, folder)
    os.makedirs(folder_path, exist_ok=True)
    make_splash(w, h).save(os.path.join(folder_path, 'splash.png'))

print('Splash screens : OK')

# Nettoyage : splash v24 éventuel (biome)
v24 = os.path.join(RES, 'drawable-v24')
if os.path.isdir(v24):
    for f in os.listdir(v24):
        if f.startswith('splash'):
            os.remove(os.path.join(v24, f))
print('Assets Android générés.')
