#!/usr/bin/env python3
"""
patch_html.py — ARVEXA School → Android (Capacitor)
Injecte arvexa-native.css + arvexa-native.js dans toutes les pages HTML
racine. Idempotent : ne réinjecte pas si déjà présent.
Le script natif s'auto-désactive sur le web → version web inchangée.
"""
import glob
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

INJECT = (
    '<link rel="stylesheet" href="arvexa-native.css">\n'
    '  <script src="arvexa-native.js"></script>\n'
)

patched, skipped = 0, 0
for path in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
    name = os.path.basename(path)
    with open(path, encoding='utf-8', errors='ignore') as fh:
        html = fh.read()

    if 'arvexa-native.js' in html:
        skipped += 1
        continue

    # Injection juste avant </head> (le script est classique, non-différé :
    # il s'exécute avant tous les scripts defer/module des pages).
    if '</head>' in html.lower():
        idx = html.lower().index('</head>')
        html = html[:idx] + INJECT + '  ' + html[idx:]
    else:
        print(f'  [!] {name}: </head> introuvable, ignoré')
        continue

    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(html)
    patched += 1

print(f'Pages patchées : {patched} | déjà patchées : {skipped}')
if patched == 0 and skipped == 0:
    sys.exit('Aucune page HTML racine trouvée — vérifier le répertoire.')
