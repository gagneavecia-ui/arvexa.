// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : 3.0.0 — Simplifiée, pas d'interférence avec Firebase
// ================================================================

const CACHE_VERSION = 'arvexa-v3.0.0';

// ⚡ On cache UNIQUEMENT les fichiers vraiment statiques
const STATIC_ASSETS = [
  './icon.png',
  './manifest.json',
  './offline.html'
];

// ================================================================
// INSTALLATION
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v3.0.0...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((url) => {
          return cache.add(url).catch(() => {});
        })
      );
    })
  );
});

// ================================================================
// ACTIVATION
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation v3.0.0...');
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (name !== CACHE_VERSION) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ================================================================
// FETCH — Stratégie minimale
// ================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // ⚡ Ignorer TOUT ce qui n'est pas de notre domaine
  if (url.origin !== self.location.origin) return;

  // ⚡ IMPORTANT : Ne JAMAIS toucher aux requêtes Firebase
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis') ||
      url.pathname.includes('/api/')) {
    return;
  }

  // ⚡ Ne JAMAIS intercepter les fichiers HTML/JS/CSS
  // → toujours réseau direct (pas de cache)
  if (url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      request.destination === 'document' ||
      request.destination === 'script' ||
      request.destination === 'style') {
    return;
  }

  // ⚡ Cache uniquement les images et icônes
  if (request.destination === 'image' ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.jpeg') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.webp') ||
      url.pathname.endsWith('.ico')) {
    event.respondWith(handleCacheFirst(request));
    return;
  }

  // Pour tout le reste : laisser passer (pas d'interception)
});

// ================================================================
// HANDLER
// ================================================================
async function handleCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('', { status: 404 });
  }
}

// ================================================================
// MESSAGE
// ================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Service Worker v3.0.0 chargé');
