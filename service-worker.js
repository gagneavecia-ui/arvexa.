// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : 4.0.0 — Mode hors ligne robuste
// ================================================================

const CACHE_VERSION = 'arvexa-v4.0.0';
const CACHE_STATIC = 'arvexa-static-v4';
const CACHE_PAGES = 'arvexa-pages-v4';
const CACHE_IMAGES = 'arvexa-images-v4';

// Pages précachées au premier chargement (shell)
const PRECACHE_PAGES = [
  './index.html',
  './offline.html',
  './auth-choice.html',
  './login.html'
];

// Assets statiques précachés
const PRECACHE_STATIC = [
  './icon.png',
  './manifest.json'
];

// ================================================================
// INSTALLATION
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v4.0.0...');
  self.skipWaiting();

  event.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC).then((cache) =>
        Promise.all(PRECACHE_STATIC.map((url) =>
          cache.add(url).catch(() => {})
        ))
      ),
      caches.open(CACHE_PAGES).then((cache) =>
        Promise.all(PRECACHE_PAGES.map((url) =>
          cache.add(url).catch(() => {})
        ))
      )
    ])
  );
});

// ================================================================
// ACTIVATION — nettoyage des vieux caches
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation v4.0.0...');
  event.waitUntil(
    caches.keys().then((names) => {
      const validCaches = [CACHE_STATIC, CACHE_PAGES, CACHE_IMAGES];
      return Promise.all(
        names.map((name) => {
          if (!validCaches.includes(name)) {
            console.log('[SW] Suppression ancien cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ================================================================
// FETCH — Routage par type
// ================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignorer les méthodes non-GET
  if (request.method !== 'GET') return;

  // Ignorer les protocoles non HTTP(S)
  if (!url.protocol.startsWith('http')) return;

  // ⚡ NE JAMAIS toucher aux requêtes Firebase / API
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('cloudflare') ||
      url.hostname.includes('jsdelivr') ||
      url.pathname.startsWith('/api/')) {
    return;
  }

  // 1️⃣ NAVIGATION (pages HTML) → network-first avec fallback offline
  if (request.mode === 'navigate' ||
      request.destination === 'document' ||
      url.pathname.endsWith('.html')) {
    event.respondWith(handlePageRequest(request));
    return;
  }

  // 2️⃣ IMAGES → cache-first
  if (request.destination === 'image' ||
      /\.(png|jpg|jpeg|svg|webp|gif|ico)$/i.test(url.pathname)) {
    event.respondWith(handleImageRequest(request));
    return;
  }

  // 3️⃣ FONTS / CSS / JS externes → cache-first avec stale-while-revalidate
  if (request.destination === 'font' ||
      request.destination === 'style' ||
      request.destination === 'script') {
    event.respondWith(handleAssetRequest(request));
    return;
  }

  // 4️⃣ RESTE → passe réseau, pas d'interception
});

// ================================================================
// HANDLERS
// ================================================================

// --- PAGES HTML : network-first, fallback cache, puis offline.html
async function handlePageRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      // Mettre à jour le cache
      const cache = await caches.open(CACHE_PAGES);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Réseau indisponible → cache
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback : page offline
    const offlinePage = await caches.match('./offline.html');
    if (offlinePage) return offlinePage;

    // Dernier recours : réponse minimale
    return new Response(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Hors ligne</title>
      <style>body{background:#0A0A0A;color:#F5F0E8;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:20px}
      a{color:#E0B84A}</style></head><body><div><h1>Pas de connexion</h1>
      <p>Vérifie ton réseau et réessaie.</p></div></body></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// --- IMAGES : cache-first
async function handleImageRequest(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_IMAGES);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Image placeholder si hors ligne et pas en cache
    return new Response('', { status: 404 });
  }
}

// --- ASSETS (CSS/JS/fonts) : stale-while-revalidate
async function handleAssetRequest(request) {
  const cached = await caches.match(request);

  const networkPromise = fetch(request).then((response) => {
    if (response && response.ok) {
      caches.open(CACHE_STATIC).then((cache) => {
        cache.put(request, response.clone());
      });
    }
    return response;
  }).catch(() => null);

  if (cached) {
    // Retourner cache ET mettre à jour en arrière-plan
    networkPromise.catch(() => {});
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  return new Response('', { status: 404 });
}

// ================================================================
// MESSAGES (depuis les pages)
// ================================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Permet à une page de demander le nettoyage des caches
  if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.map((n) => caches.delete(n)))
      )
    );
  }
});

console.log('[SW] Service Worker v4.0.0 chargé');
