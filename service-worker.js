// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : 1.0.1 — CORRIGÉE
// Ne touche PAS aux CDN externes (Firebase, Google Fonts, FontAwesome)
// ================================================================

const CACHE_VERSION = 'arvexa-v1.0.15';
const CACHE_STATIC = `${CACHE_VERSION}-static`;
const CACHE_DYNAMIC = `${CACHE_VERSION}-dynamic`;

// Fichiers LOCAUX à mettre en cache (uniquement ceux de ton site)
const ESSENTIAL_FILES = [
  './',
  './index.html',
  './login.html',
  './register.html',
  './onboarding.html',
  './matiere.html',
  './chapitre.html',
  './lecture.html',
  './abonnement.html',
  './profil.html',
  './formulaires.html',
  './calculatrice.html',
  './notifications.html',
  './offline.html',
  './groupe.html',
  './manifest.json',
  './icon.png',
  './tableau-periodique.html',
  './register-sw.js',
  './register-fcm-sw.js',
  './firebase-messaging-sw.js'
];

// ================================================================
// INSTALLATION
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installation...');

  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return Promise.all(
        ESSENTIAL_FILES.map((url) => {
          return cache.add(url).catch((err) => {
            console.warn('[SW] Impossible de cacher:', url, err);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// ================================================================
// ACTIVATION
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_STATIC && cacheName !== CACHE_DYNAMIC) {
            console.log('[SW] Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ================================================================
// FETCH — Interception
// ================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // ═══════════════════════════════════════════════════════════════
  // RÈGLE CRITIQUE : Ne JAMAIS intercepter les requêtes externes
  // ═══════════════════════════════════════════════════════════════

  // 1. Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // 2. Ignorer TOUTES les requêtes qui ne sont PAS de ton domaine
  //    (CDN, Firebase, Google Fonts, etc.)
  if (url.origin !== self.location.origin) {
    return; // Le navigateur gère directement
  }

  // 3. Ignorer les requêtes vers Firebase (au cas où)
  if (url.hostname.includes('firebase') || url.hostname.includes('gstatic')) {
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // À PARTIR D'ICI : Uniquement tes fichiers LOCAUX
  // ═══════════════════════════════════════════════════════════════

  // HTML : Network-first avec fallback cache
  if (request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(handleHTML(request));
    return;
  }

  // JSON : Network-first avec fallback cache
  if (url.pathname.endsWith('.json')) {
    event.respondWith(handleJSON(request));
    return;
  }

  // JS / CSS / Images LOCAUX : Cache-first
  if (url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      request.destination === 'image' ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.webp') ||
      url.pathname.endsWith('.ico')) {
    event.respondWith(handleStatic(request));
    return;
  }

  // Par défaut : Network-first
  event.respondWith(handleDefault(request));
});

// ================================================================
// HANDLERS
// ================================================================

// HTML : Network-first avec fallback cache + offline.html
async function handleHTML(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Offline → chercher dans le cache
    const cached = await caches.match(request);
    if (cached) return cached;

    // Vraiment rien → offline.html
    const offline = await caches.match('./offline.html');
    if (offline) return offline;

    // Fallback ultime
    return new Response('Hors ligne', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// JSON : Network-first avec fallback cache
async function handleJSON(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Pas de cache → retourner un JSON vide valide
    return new Response('{"parts":[]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

// Static : Cache-first avec update en arrière-plan
async function handleStatic(request) {
  const cached = await caches.match(request);

  if (cached) {
    // Mettre à jour en arrière-plan
    fetch(request).then((response) => {
      if (response && response.ok) {
        caches.open(CACHE_STATIC).then((cache) => {
          cache.put(request, response.clone());
        });
      }
    }).catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('', { status: 404 });
  }
}

// Default : Network-first avec fallback cache
async function handleDefault(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('', { status: 404 });
  }
}

// ================================================================
// MESSAGES
// ================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
});

// ================================================================
// ENREGISTREMENT DU SERVICE WORKER FCM
// ================================================================
// Le Service Worker FCM est enregistré depuis les pages HTML,
// mais on peut aussi le pré-enregistrer ici.
// (L'enregistrement réel se fait dans le code HTML)

console.log('[SW] Service Worker chargé. Version:', CACHE_VERSION);
