#!/usr/bin/env node
/**
 * build-www.js — ARVEXA School → Android (Capacitor)
 * Copie les ressources web du dépôt vers www/ (embarquées dans l'APK).
 * Exclut tout ce qui est serveur/CI/outillage — le client embarque
 * uniquement ce que la WebView utilise réellement.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'www');

const EXCLUDE_DIRS = new Set([
  'api',            // fonctions serverless Vercel (restent sur Vercel)
  '.git', '.github', '.idea',
  'node_modules', 'www', 'android', 'scripts', 'dist',
]);

/* Fichiers serveur/CI/outillage : inutiles dans l'APK */
const EXCLUDE_FILES = new Set([
  'vercel.json', 'firebase.json', 'firestore.rules', 'storage.rules',
  '.env.example', '.gitignore', 'package.json', 'package-lock.json',
  'build-cache-manifest.js', 'cache-manifest.json', '.write-test',
  'DEPLOYMENT.md', 'DEPLOIEMENT.md', 'README.md', 'PUBLIER.md',
  'AUTH-FLOW.md', 'CORRECTIONS.md', 'SECURITY-AUDIT.md',
  'capacitor.config.json', 'capacitor.config.ts',
]);

/* Les 470 PDF de cours (≈ 245 Mo) ne sont pas embarqués dans l'APK
   (optimisation pour téléphones modestes) : en mode natif, lecture.html
   les sert en streaming depuis le site (en-tête CORS dédié dans
   vercel.json). Fonctionnalité conservée — pas de perte. */
const EXCLUDE_EXT = new Set(['.pdf']);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      copyDir(s, d);
    } else {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      if (EXCLUDE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      fs.copyFileSync(s, d);
    }
  }
}

fs.rmSync(DEST, { recursive: true, force: true });
copyDir(ROOT, DEST);

let files = 0, bytes = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else { files++; bytes += fs.statSync(p).size; }
  }
})(DEST);

console.log(`www/ prêt : ${files} fichiers, ${(bytes / 1024 / 1024).toFixed(1)} Mo`);
