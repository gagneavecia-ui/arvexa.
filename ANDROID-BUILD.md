# ARVEXA School — Application Android (Capacitor)

Cette branche transforme ARVEXA School en application Android installable via
Capacitor 7, sans retirer aucune fonctionnalité et sans toucher au
fonctionnement de la version web.

## Identité de l'application

| Élément | Valeur |
| --- | --- |
| Nom | ARVEXA School |
| Package ID | `com.arvexa.school` |
| Version | 1.0 (versionCode 1) |
| SDK cibles | minSdk 23 (Android 6.0) → targetSdk 35 (Android 15) |

## Architecture

- **Interface locale** : l'UI (HTML/CSS/JS, cours, examens, i18n, outils) est
  embarquée dans l'APK (`www/`) — l'app ne dépend pas du site distant pour
  afficher son interface.
- **API distantes conservées** : les fonctions serverless Vercel
  (`/api/*` : IA, examens, progressions, paiements SasPay, réinitialisation de
  mot de passe…) restent hébergées sur Vercel. Dans la WebView, `arvexa-native.js`
  route automatiquement les appels `/api/*` vers
  `https://arvexaschool.vercel.app/api/*` via `CapacitorHttp` (HTTP natif,
  sans problème CORS).
- **Firebase Auth + Firestore** : inchangés, le SDK web Firebase fonctionne
  dans la WebView (connexion email/mot de passe, données par compte).
- **PDF de cours** : non embarqués dans l'APK (~245 Mo évités) — servis en
  streaming depuis le site (en-tête CORS ajouté dans `vercel.json`).
- **Navigation native** : barre basse persistante à 5 onglets
  (Accueil · Réviser · Arv Progress · Assistant · Profil) injectée par
  `arvexa-native.js`/`arvexa-native.css` uniquement dans l'app.
- **Bouton Retour Android** : pilé via le plugin `App` (retour historique,
  sortie propre depuis la racine).
- **Barre de statut** : synchronisée avec le thème sombre/clair
  (`#0A0A0A` / `#F5F0E8`).
- **Service Worker** : désactivé dans l'app (ressources locales, aucune
  utilité) — la version web conserve le sien.

## Reconstruire l'APK

Prérequis : Node 18+, JDK 21 (Temurin), SDK Android (API 35).

```bash
npm install
npm run android:debug     # → android/app/build/outputs/apk/debug/app-debug.apk
npm run android:release   # → android/app/build/outputs/apk/release/app-release.apk
```

Signature release (variables d'environnement, jamais commitées) :

```bash
export ARVEXA_KEYSTORE_PATH=/chemin/arvexa-release.keystore
export ARVEXA_KEYSTORE_PASSWORD=********
export ARVEXA_KEY_ALIAS=arvexa-school
export ARVEXA_KEY_PASSWORD=********
npm run android:release
```

Sans ces variables, l'APK release est produit non signé (à signer ensuite
avec `apksigner`). Les APK debug sont signés automatiquement (clé de debug).

## CI (GitHub Actions)

`.github/workflows/build-android.yml` compile debug + release à chaque
poussée sur `main`/`android-capacitor`. Artefacts téléchargeables dans
l'onglet **Actions**.

Secrets optionnels pour la signature CI :

- `ARVEXA_KEYSTORE_BASE64` — keystore encodé en base64
  (`base64 -w0 arvexa-release.keystore`)
- `ARVEXA_KEYSTORE_PASSWORD`, `ARVEXA_KEY_ALIAS`, `ARVEXA_KEY_PASSWORD`

## Fichiers clés

| Fichier | Rôle |
| --- | --- |
| `arvexa-native.js` | Coquille native (shim API, nav basse, retour, statut) |
| `arvexa-native.css` | Style de la barre de navigation (palette ARVEXA) |
| `scripts/build-www.js` | Copie sélective des ressources web vers `www/` |
| `scripts/patch_html.py` | Injection de la coquille native dans les pages |
| `scripts/generate_assets.py` | Icônes launcher + splash screens Android |
| `capacitor.config.json` | Config Capacitor (`com.arvexa.school`) |
| `android/` | Projet Android natif (Gradle, manifest, ressources) |

## Version web

La version web reste exactement la même : `arvexa-native.js` s'auto-désactive
hors WebView (`Capacitor.isNativePlatform()`). Aucune règle métier, aucune
route et aucune API n'ont été modifiées ; la seule modification serveur est
l'ajout d'un en-tête CORS sur les PDF de cours dans `vercel.json`.
