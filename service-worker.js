// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : OFFLINE v2.2 — Navigation instantanée
// ================================================================

const SW_VERSION = 'arvexa-offline-v4.3'; // v4.3 : notebook + exam — matière Anglais (cahier, sans mode examen), banque de questions élargie, QCM 8, bouton « Retourner à mon cahier », dictée vocale reconstruite (zéro doublon). v4.2 : réviseur « en dur » — accueil du réviseur peint pré-CDN depuis un snapshot local par chapitre (LRU 12, TTL 12 h), hydratation de l'état (notions incluses), revalidation silencieuse /api/reviseur conservant le cache en cas d'erreur réseau, statut blocked/paused via docSWR (arvexa-cache.js). v4.1 : audit stabilité — precache étendu (JS partagés bac-date/auth-guard/katex-utils/analytics/offline/onboarding-tour/register-fcm-sw/firebase-messaging-sw + pages auth-choice/login/404) pour un offline fiable dès l'installation. v4.0 : // v4.0 : accueil « en dur » — tableau de bord restauré pré-CDN depuis les caches locaux (countdown BAC, date/citation du jour, compteurs de lecture, badges), splash épuré (nom du site + cercle), anti-flash instant/ready. v3.9 : cache-first universel — arvexa-cache.js (readCacheDoc/docSWR : lecture cache IndexedDB Firestore instantanée + revalidation serveur arrière-plan), appliqué à arv, arv-progress, exam, exam-history, reviseur-history, tableau-periodique, formulaires ; préchauffage 1×/session dans l'index (matières+chapters+notifications). v3.8 : accueil instantané — splash 1er chargement de session + snapshot de session (retour accueil sans rechargement visible, pill de synchro). v3.8 : accueil instantané — splash de chargement au 1er chargement de session uniquement (#appSplash), snapshot de session pour restaurer l'accueil sans rechargement visible (Firestore actualise en arrière-plan + pill discrète). v3.7 : couverture i18n complète — +228 clés (abonnement, légal, examens, badges, toasts, titres de pages), apostrophes unifiées dans norm(), motifs Niveau/Partie/session/badges/mois, titres <title> ajoutés aux pages. v3.6 : bilingue FR/EN — arvexa-i18n.js (dictionnaire + MutationObserver + persistance 'arvexa-lang' + sync multi-onglets), sélecteur Langue dans profil.html. Précédent v3.5 : : mode clair global — tokens [data-theme=light] dans arvexa-ui.css, theme.js (persistance + meta theme-color + sync multi-onglets), boot anti-flash inline sur toutes les pages, couleurs codées en dur thémables (rgb triplets), toggle Apparence dans profil.html
const CACHE_STATIC = `${SW_VERSION}-static`;
const CACHE_HTML = `${SW_VERSION}-html`;

// ⚡ Toutes les pages HTML de l'app pour précache complet
const PRECACHE = [
  './',
  './index.html',
  './matiere.html',
  './chapitre.html',
  './lecture.html',
  './profil.html',
  './reviseur.html',
  './exam.html',
  './exam-history.html',
  './abonnement.html',
  './notifications.html',
  './outils.html',
  './formulaires.html',
  './planificateur.html',
  './tableau-periodique.html',
  './arv-progress.html',
  './offline.html',
  './manifest.json',
  './perf.css',
  './arvexa-ui.css',
  './theme.js',
  './arvexa-i18n.js',
  './arvexa-cache.js',
  './register-sw.js',
  './arvexa-confirm.js',
  './icon.png',
  // v4.1 — offline fiable dès l'installation : JS partagés + pages d'auth
  './bac-date.js',
  './auth-guard.js',
  './katex-utils.js',
  './analytics.js',
  './offline.js',
  './onboarding-tour.js',
  './register-fcm-sw.js',
  './firebase-messaging-sw.js',
  './auth-choice.html',
  './login.html',
  './404.html'
];

// Ne JAMAIS intercepter
const NEVER_CACHE_HOSTS = [
  'firebaseio.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseapp.com',
  'firebasestorage.app',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com'
];

const NEVER_CACHE_PREFIXES = ['/api/'];

// ═══ INSTALL ═══
self.addEventListener('install', (event) => {
  console.log(`[SW] Install ${SW_VERSION}`);
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch(() => {
            console.warn('[SW] Précache ignoré :', url);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ═══ ACTIVATE ═══
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activate ${SW_VERSION}`);
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => !n.startsWith(SW_VERSION))
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// ═══ FETCH ═══
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (NEVER_CACHE_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  if (NEVER_CACHE_HOSTS.some((h) => url.hostname.includes(h))) return;

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(handleHTML(req));
    return;
  }

  if (
    req.destination === 'style' ||
    req.destination === 'script' ||
    req.destination === 'font' ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.json')
  ) {
    event.respondWith(handleStatic(req));
    return;
  }

  if (req.destination === 'image') {
    event.respondWith(handleImage(req));
    return;
  }

  event.respondWith(handleGeneric(req));
});

// ═══ STRATÉGIES ═══

// ⚡ HTML : STALE-WHILE-REVALIDATE
// Sert immédiatement depuis le cache, met à jour en arrière-plan
async function handleHTML(req) {
  const cache = await caches.open(CACHE_HTML);
  const cached = await cache.match(req);

  // Lancer la mise à jour en arrière-plan (non bloquant)
  const networkUpdate = fetch(req)
    .then((response) => {
      if (response && response.ok) {
        cache.put(req, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // ⚡ Si on a du cache → réponse INSTANTANÉE + MAJ silencieuse
  if (cached) {
    networkUpdate.catch(() => {}); // fire-and-forget correct
    return cached;
  }

  // Sinon → attendre le réseau (première visite)
  try {
    const response = await networkUpdate;
    if (response) return response;
    throw new Error('network failed');
  } catch (e) {
    const staticCache = await caches.open(CACHE_STATIC);
    const cachedStatic = await staticCache.match(req);
    if (cachedStatic) return cachedStatic;

    const offline = await caches.match('./offline.html');
    if (offline) return offline;

    return new Response(
      '<!DOCTYPE html><html lang="fr"><body><h1>Hors ligne</h1><p>Page non disponible.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// ⚡ Static : stale-while-revalidate (déjà correct)
async function handleStatic(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((response) => {
      if (response && response.ok) cache.put(req, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || new Response('', { status: 504 });
}

async function handleImage(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const response = await fetch(req);
    if (response && response.ok) cache.put(req, response.clone());
    return response;
  } catch (e) {
    return new Response('', { status: 204 });
  }
}

async function handleGeneric(req) {
  const cache = await caches.open(CACHE_HTML);
  try {
    const response = await fetch(req);
    if (response && response.ok) cache.put(req, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || new Response('', { status: 504 });
  }
}

// ═══ HANDLERS MESSAGE ═══
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'DOWNLOAD_ALL' && Array.isArray(data.files) && port) {
    downloadAllFiles(data.files, port);
  }

  if (data.type === 'CACHE_URL' && data.url) {
    cacheUrl(data.url);
  }

  if (data.type === 'STATS' && port) {
    getStats(port);
  }
});

async function downloadAllFiles(files, port) {
  const total = files.length;
  let done = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const url = files[i];
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) {
        const cache = await caches.open(CACHE_HTML);
        await cache.put(url, response);
        done++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }

    const percent = Math.round(((done + failed) / total) * 100);
    port.postMessage({
      type: 'DOWNLOAD_PROGRESS',
      done, failed, total, percent
    });
  }

  port.postMessage({
    type: 'DOWNLOAD_COMPLETE',
    done, failed, total
  });
}

async function cacheUrl(url) {
  try {
    const response = await fetch(url, { cache: 'reload' });
    if (response.ok) {
      const cache = await caches.open(CACHE_HTML);
      await cache.put(url, response);
    }
  } catch (e) {}
}

async function getStats(port) {
  try {
    const names = await caches.keys();
    const stats = {};
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      stats[name.replace(`${SW_VERSION}-`, '')] = keys.length;
    }
    port.postMessage({ type: 'STATS_RESULT', stats });
  } catch (e) {
    port.postMessage({ type: 'STATS_RESULT', stats: {} });
  }
}

console.log(`[SW] ${SW_VERSION} prêt — navigation instantanée active`);
