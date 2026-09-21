// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : 5.0.0 — Cache complet + contenu cours
// ================================================================

const CACHE_VERSION = 'arvexa-v5.0.0';
const CACHE_SHELL = 'arvexa-shell-v5';      // Pages de base
const CACHE_COURS = 'arvexa-cours-v5';      // Contenu cours/exo/corr
const CACHE_IMAGES = 'arvexa-images-v5';    // Images/fonts/icônes
const CACHE_MANIFESTS = 'arvexa-manifests-v5'; // JSON de chapitres

const ALL_CACHES = [CACHE_SHELL, CACHE_COURS, CACHE_IMAGES, CACHE_MANIFESTS];

// ================================================================
// SHELL (pages de base précachées)
// ================================================================
const PRECACHE_SHELL = [
  './',
  './index.html',
  './offline.html',
  './auth-choice.html',
  './login.html',
  './register.html',
  './onboarding.html',
  './profil.html',
  './abonnement.html',
  './notifications.html',
  './matiere.html',
  './chapitre.html',
  './lecture.html',
  './calculatrice.html',
  './formulaires.html',
  './tableau-periodique.html',
  './outils.html',
  './planificateur.html',
  './reviseur.html',
  './exam.html',
  './groupe.html',
  './conditions.html',
  './confidentialite.html',
  './404.html',
  './manifest.json',
  './icon.png'
];

// ================================================================
// INSTALLATION
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v5.0.0...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => {
      // addAll échoue si UN seul fichier manque → on utilise add() individuel
      return Promise.all(
        PRECACHE_SHELL.map((url) =>
          cache.add(url).catch((e) => {
            console.warn('[SW] Échec précache:', url, e.message);
          })
        )
      );
    })
  );
});

// ================================================================
// ACTIVATION
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation v5.0.0...');
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (!ALL_CACHES.includes(name)) {
            console.log('[SW] Suppression ancien cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ================================================================
// FETCH — Routage intelligent
// ================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignorer méthodes non-GET et protocoles non-HTTP
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // ⚡ NE JAMAIS toucher aux requêtes Firebase / API externes
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('googleusercontent') ||
      url.hostname.includes('cloudflare') ||
      url.pathname.startsWith('/api/')) {
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 1️⃣ MANIFESTS JSON (cours/*.json) → cache-first permanent
  // ─────────────────────────────────────────────────────────────
  if (url.pathname.includes('/cours/') && url.pathname.endsWith('.json')) {
    event.respondWith(handleManifestRequest(request));
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 2️⃣ CONTENU COURS HTML (cours/*/*.html) → cache-first permanent
  // ─────────────────────────────────────────────────────────────
  if (url.pathname.includes('/cours/') && url.pathname.endsWith('.html')) {
    event.respondWith(handleCoursRequest(request));
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 3️⃣ PAGES HTML principales → network-first avec fallback
  // ─────────────────────────────────────────────────────────────
  if (request.mode === 'navigate' ||
      request.destination === 'document' ||
      url.pathname.endsWith('.html')) {
    event.respondWith(handlePageRequest(request));
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 4️⃣ IMAGES / FONTS / ICÔNES → cache-first
  // ─────────────────────────────────────────────────────────────
  if (request.destination === 'image' ||
      request.destination === 'font' ||
      /\.(png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf|otf)$/i.test(url.pathname)) {
    event.respondWith(handleAssetRequest(request, CACHE_IMAGES));
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 5️⃣ CSS / JS externes → stale-while-revalidate
  // ─────────────────────────────────────────────────────────────
  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(handleAssetRequest(request, CACHE_IMAGES));
    return;
  }

  // Autres : laisser passer
});

// ================================================================
// HANDLERS
// ================================================================

// --- MANIFESTS : cache-first
async function handleManifestRequest(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_MANIFESTS);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response(
      JSON.stringify({ parts: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// --- COURS HTML : cache-first permanent
async function handleCoursRequest(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_COURS);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Fallback : page offline
    const offlinePage = await caches.match('./offline.html');
    if (offlinePage) return offlinePage;

    return new Response(
      '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Hors ligne</title></head><body style="background:#0A0A0A;color:#F5F0E8;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center;margin:0"><div><h1>Contenu indisponible</h1><p>Ce chapitre n\'a pas encore été téléchargé.</p><p><a href="./index.html" style="color:#E0B84A">Retour à l\'accueil</a></p></div></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// --- PAGES HTML principales : network-first avec fallback
async function handlePageRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_SHELL);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    const offlinePage = await caches.match('./offline.html');
    if (offlinePage) return offlinePage;

    return new Response('Hors ligne', { status: 503 });
  }
}

// --- ASSETS (images, fonts, css, js) : cache-first avec revalidate
async function handleAssetRequest(request, cacheName) {
  const cached = await caches.match(request);

  const networkPromise = fetch(request).then((response) => {
    if (response && response.ok) {
      caches.open(cacheName).then((cache) => {
        cache.put(request, response.clone());
      });
    }
    return response;
  }).catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const response = await networkPromise;
  if (response) return response;
  return new Response('', { status: 404 });
}

// ================================================================
// MESSAGES depuis les pages
// ================================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;

  // ─── SKIP_WAITING
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // ─── CLEAR_CACHES
  if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.map((n) => caches.delete(n)))
      )
    );
    return;
  }

  // ─── DOWNLOAD_ALL : télécharge toute une liste de fichiers
  if (event.data.type === 'DOWNLOAD_ALL') {
    event.waitUntil(
      downloadAllFiles(event.data.files || [], event.source)
    );
    return;
  }

  // ─── CACHE_URL : cache une URL unique
  if (event.data.type === 'CACHE_URL') {
    event.waitUntil(cacheUrl(event.data.url));
    return;
  }

  // ─── STATS : renvoie le nombre d'éléments en cache
  if (event.data.type === 'STATS') {
    event.waitUntil(sendStats(event.source));
    return;
  }
});

// ================================================================
// TÉLÉCHARGEMENT EN MASSE
// ================================================================
async function downloadAllFiles(files, client) {
  const total = files.length;
  let done = 0;
  let failed = 0;

  const cache = await caches.open(CACHE_COURS);
  const manifestCache = await caches.open(CACHE_MANIFESTS);

  for (const file of files) {
    try {
      // Vérifier si déjà en cache
      const already = await caches.match(file);
      if (already) {
        done++;
      } else {
        const response = await fetch(file);
        if (response && response.ok) {
          if (file.endsWith('.json')) {
            await manifestCache.put(file, response);
          } else {
            await cache.put(file, response);
          }
          done++;
        } else {
          failed++;
        }
      }
    } catch (e) {
      failed++;
    }

    // Progress
    if (client) {
      client.postMessage({
        type: 'DOWNLOAD_PROGRESS',
        done,
        failed,
        total,
        percent: Math.round(((done + failed) / total) * 100)
      });
    }
  }

  if (client) {
    client.postMessage({
      type: 'DOWNLOAD_COMPLETE',
      done,
      failed,
      total
    });
  }
}

// ================================================================
// CACHE URL UNIQUE
// ================================================================
async function cacheUrl(url) {
  try {
    const already = await caches.match(url);
    if (already) return;

    const response = await fetch(url);
    if (response && response.ok) {
      const cacheName = url.includes('/cours/')
        ? (url.endsWith('.json') ? CACHE_MANIFESTS : CACHE_COURS)
        : CACHE_SHELL;
      const cache = await caches.open(cacheName);
      cache.put(url, response);
    }
  } catch (e) {
    // Ignore
  }
}

// ================================================================
// STATS
// ================================================================
async function sendStats(client) {
  if (!client) return;

  const stats = {
    shell: 0,
    cours: 0,
    manifests: 0,
    images: 0
  };

  try {
    const shellCache = await caches.open(CACHE_SHELL);
    stats.shell = (await shellCache.keys()).length;

    const coursCache = await caches.open(CACHE_COURS);
    stats.cours = (await coursCache.keys()).length;

    const manifestCache = await caches.open(CACHE_MANIFESTS);
    stats.manifests = (await manifestCache.keys()).length;

    const imgCache = await caches.open(CACHE_IMAGES);
    stats.images = (await imgCache.keys()).length;
  } catch (e) {}

  client.postMessage({ type: 'STATS_RESULT', stats });
}

console.log('[SW] Service Worker v5.0.0 chargé');
