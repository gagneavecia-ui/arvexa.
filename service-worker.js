// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : 2.0.0 — Anti-cache des versions
// ================================================================

const CACHE_VERSION = 'arvexa-v2.0.0';
const CACHE_STATIC = `${CACHE_VERSION}-static`;

// ⚡ SEULEMENT les fichiers statiques qui changent rarement
// ⚠️ On NE cache PAS les HTML/JS/CSS pour toujours avoir la dernière version
const STATIC_ASSETS = [
  './icon.png',
  './manifest.json',
  './offline.html'
];

// ================================================================
// INSTALLATION
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v2.0.0...');

  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((url) => {
          return cache.add(url).catch((err) => {
            console.warn('[SW] Impossible de cacher:', url, err);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// ================================================================
// ACTIVATION — Supprime TOUS les anciens caches
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation v2.0.0...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // ⚡ Supprime tous les caches qui ne sont pas de la version actuelle
          if (cacheName !== CACHE_STATIC) {
            console.log('[SW] Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ================================================================
// FETCH — Stratégie anti-cache
// ================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // 2. Ignorer toutes les requêtes externes (Firebase, CDN, etc.)
  if (url.origin !== self.location.origin) return;

  // 3. Ignorer Firebase / gstatic
  if (url.hostname.includes('firebase') || url.hostname.includes('gstatic')) return;

  // ═══════════════════════════════════════════════════════════════
  // HTML, JS, CSS, JSON → TOUJOURS NETWORK (jamais de cache)
  // ═══════════════════════════════════════════════════════════════

  if (url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.json') ||
      request.destination === 'document') {
    event.respondWith(handleNetworkFirst(request));
    return;
  }

  // ⚡ IMAGES/ICÔNES → Cache-first (changent rarement)
  if (request.destination === 'image' ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.jpeg') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.webp') ||
      url.pathname.endsWith('.ico') ||
      url.pathname.endsWith('.gif')) {
    event.respondWith(handleCacheFirst(request));
    return;
  }

  // Autres (fonts, etc.) → Network-first
  event.respondWith(handleNetworkFirst(request));
});

// ================================================================
// HANDLERS
// ================================================================

/**
 * Network-first : essaie le réseau en premier.
 * Si le réseau échoue (hors ligne), utilise le cache.
 */
async function handleNetworkFirst(request) {
  try {
    const response = await fetch(request, {
      cache: 'no-store'
    });
    return response;
  } catch (error) {
    // Hors ligne → essayer le cache
    const cached = await caches.match(request);
    if (cached) return cached;

    // Si c'est une page HTML → servir offline.html
    if (request.destination === 'document' ||
        request.url.endsWith('.html')) {
      const offline = await caches.match('./offline.html');
      if (offline) return offline;
    }

    // Fallback ultime
    return new Response('Hors ligne', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/**
 * Cache-first : utilise le cache en priorité.
 * Si absent, va chercher sur le réseau et met en cache.
 */
async function handleCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

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

// ================================================================
// MESSAGES
// ================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((names) => {
      return Promise.all(names.map((name) => caches.delete(name)));
    }).then(() => {
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'CACHE_CLEARED' });
        });
      });
    });
  }
});

console.log('[SW] Service Worker v2.0.0 chargé');
