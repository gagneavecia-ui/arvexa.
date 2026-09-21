// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : 6.0.0 — Download par matière + stats + cleanup
// ================================================================

const CACHE_VERSION = 'arvexa-v6.0.0';
const CACHE_SHELL = 'arvexa-shell-v6';
const CACHE_COURS = 'arvexa-cours-v6';
const CACHE_IMAGES = 'arvexa-images-v6';
const CACHE_MANIFESTS = 'arvexa-manifests-v6';

const ALL_CACHES = [CACHE_SHELL, CACHE_COURS, CACHE_IMAGES, CACHE_MANIFESTS];

const PRECACHE_SHELL = [
  './', './index.html', './offline.html', './auth-choice.html',
  './login.html', './register.html', './onboarding.html',
  './profil.html', './abonnement.html', './notifications.html',
  './matiere.html', './chapitre.html', './lecture.html',
  './calculatrice.html', './formulaires.html', './tableau-periodique.html',
  './outils.html', './planificateur.html', './reviseur.html',
  './exam.html', './groupe.html', './conditions.html',
  './confidentialite.html', './404.html', './manifest.json', './icon.png'
];

// ================================================================
// INSTALLATION
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v6.0.0...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) =>
      Promise.all(
        PRECACHE_SHELL.map((url) =>
          cache.add(url).catch((e) => console.warn('[SW] Précache échec:', url))
        )
      )
    )
  );
});

// ================================================================
// ACTIVATION
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation v6.0.0...');
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.map((n) => !ALL_CACHES.includes(n) ? caches.delete(n) : null)
      )
    ).then(() => self.clients.claim())
  );
});

// ================================================================
// FETCH
// ================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Ignorer Firebase / API / CDN externes
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('googleusercontent') ||
      url.hostname.includes('cloudflare') ||
      url.pathname.startsWith('/api/')) {
    return;
  }

  // Manifests JSON
  if (url.pathname.includes('/cours/') && url.pathname.endsWith('.json')) {
    event.respondWith(handleManifestRequest(request));
    return;
  }

  // Contenu cours HTML
  if (url.pathname.includes('/cours/') && url.pathname.endsWith('.html')) {
    event.respondWith(handleCoursRequest(request));
    return;
  }

  // Pages principales
  if (request.mode === 'navigate' ||
      request.destination === 'document' ||
      url.pathname.endsWith('.html')) {
    event.respondWith(handlePageRequest(request));
    return;
  }

  // Images / fonts / css / js
  if (request.destination === 'image' ||
      request.destination === 'font' ||
      request.destination === 'style' ||
      request.destination === 'script' ||
      /\.(png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf|otf)$/i.test(url.pathname)) {
    event.respondWith(handleAssetRequest(request, CACHE_IMAGES));
    return;
  }
});

// ================================================================
// HANDLERS
// ================================================================
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
  } catch {
    return new Response(JSON.stringify({ parts: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }
}

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
  } catch {
    const offlinePage = await caches.match('./offline.html');
    return offlinePage || new Response(
      '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Hors ligne</title></head><body style="background:#0A0A0A;color:#F5F0E8;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center;margin:0"><div><h1>Contenu indisponible</h1><p>Ce chapitre n\'a pas été téléchargé.</p><p><a href="./index.html" style="color:#E0B84A">Retour</a></p></div></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function handlePageRequest(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_SHELL);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match('./offline.html');
    return offline || new Response('Hors ligne', { status: 503 });
  }
}

async function handleAssetRequest(request, cacheName) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request).then((r) => {
    if (r && r.ok) {
      caches.open(cacheName).then((c) => c.put(request, r.clone()));
    }
    return r;
  }).catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }
  const r = await networkPromise;
  return r || new Response('', { status: 404 });
}

// ================================================================
// MESSAGES
// ================================================================
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }

  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
    );
    return;
  }

  // Download global (liste complète)
  if (data.type === 'DOWNLOAD_ALL') {
    event.waitUntil(downloadAllFiles(data.files || [], event.source));
    return;
  }

  // ⭐ NOUVEAU : download filtré (matières)
  if (data.type === 'DOWNLOAD_FILTERED') {
    event.waitUntil(downloadAllFiles(data.files || [], event.source, data.matieres));
    return;
  }

  // Cache URL unique
  if (data.type === 'CACHE_URL') {
    event.waitUntil(cacheUrl(data.url));
    return;
  }

  // Stats globales
  if (data.type === 'STATS') {
    event.waitUntil(sendStats(event.source));
    return;
  }

  // ⭐ NOUVEAU : stats par matière (taille + fichiers)
  if (data.type === 'STATS_BY_MATIERE') {
    event.waitUntil(sendStatsByMatiere(event.source));
    return;
  }

  // ⭐ NOUVEAU : nettoyer une matière spécifique
  if (data.type === 'CLEAR_MATIERE') {
    event.waitUntil(clearMatiere(data.matiere));
    return;
  }
});

// ================================================================
// TÉLÉCHARGEMENT EN MASSE
// ================================================================
async function downloadAllFiles(files, client, filterMatieres = null) {
  const total = files.length;
  let done = 0;
  let failed = 0;
  let downloadedBytes = 0;

  const cache = await caches.open(CACHE_COURS);
  const manifestCache = await caches.open(CACHE_MANIFESTS);

  for (const file of files) {
    // Filtre par matière
    if (filterMatieres && filterMatieres.length > 0) {
      const match = filterMatieres.some((m) => file.includes(`/cours/${m}/`));
      if (!match) continue;
    }

    try {
      const already = await caches.match(file);
      if (already) {
        // Compter la taille si déjà caché
        const blob = await already.clone().blob();
        downloadedBytes += blob.size;
        done++;
      } else {
        const response = await fetch(file);
        if (response && response.ok) {
          const clone = response.clone();
          const blob = await clone.blob();
          downloadedBytes += blob.size;

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
    } catch {
      failed++;
    }

    if (client) {
      client.postMessage({
        type: 'DOWNLOAD_PROGRESS',
        done, failed, total,
        percent: Math.round(((done + failed) / total) * 100),
        bytes: downloadedBytes
      });
    }
  }

  if (client) {
    client.postMessage({
      type: 'DOWNLOAD_COMPLETE',
      done, failed, total,
      bytes: downloadedBytes
    });
  }
}

async function cacheUrl(url) {
  try {
    if (await caches.match(url)) return;
    const response = await fetch(url);
    if (response && response.ok) {
      const cacheName = url.includes('/cours/')
        ? (url.endsWith('.json') ? CACHE_MANIFESTS : CACHE_COURS)
        : CACHE_SHELL;
      const cache = await caches.open(cacheName);
      cache.put(url, response);
    }
  } catch {}
}

// ================================================================
// STATS GLOBALES
// ================================================================
async function sendStats(client) {
  if (!client) return;
  const stats = { shell: 0, cours: 0, manifests: 0, images: 0, totalBytes: 0 };

  try {
    const cachesList = [
      { name: CACHE_SHELL, key: 'shell' },
      { name: CACHE_COURS, key: 'cours' },
      { name: CACHE_MANIFESTS, key: 'manifests' },
      { name: CACHE_IMAGES, key: 'images' }
    ];

    for (const { name, key } of cachesList) {
      const c = await caches.open(name);
      const keys = await c.keys();
      stats[key] = keys.length;

      // Calcul de la taille
      for (const req of keys) {
        try {
          const res = await c.match(req);
          if (res) {
            const blob = await res.clone().blob();
            stats.totalBytes += blob.size;
          }
        } catch {}
      }
    }
  } catch {}

  client.postMessage({ type: 'STATS_RESULT', stats });
}

// ================================================================
// STATS PAR MATIÈRE
// ================================================================
async function sendStatsByMatiere(client) {
  if (!client) return;

  const matieres = ['mathematiques', 'physique', 'chimie', 'svt'];
  const stats = {};

  for (const m of matieres) {
    stats[m] = { files: 0, bytes: 0, cached: 0 };
  }

  try {
    const cache = await caches.open(CACHE_COURS);
    const keys = await cache.keys();

    for (const req of keys) {
      const url = req.url;
      for (const m of matieres) {
        if (url.includes(`/cours/${m}/`)) {
          stats[m].files++;
          try {
            const res = await cache.match(req);
            if (res) {
              const blob = await res.clone().blob();
              stats[m].bytes += blob.size;
            }
          } catch {}
          break;
        }
      }
    }
  } catch {}

  client.postMessage({ type: 'STATS_BY_MATIERE_RESULT', stats });
}

// ================================================================
// NETTOYER UNE MATIÈRE
// ================================================================
async function clearMatiere(matiere) {
  if (!matiere) return;

  try {
    const cache = await caches.open(CACHE_COURS);
    const manifestCache = await caches.open(CACHE_MANIFESTS);

    const coursKeys = await cache.keys();
    const manifestKeys = await manifestCache.keys();

    for (const req of coursKeys) {
      if (req.url.includes(`/cours/${matiere}/`)) {
        await cache.delete(req);
      }
    }
    for (const req of manifestKeys) {
      if (req.url.includes(`/cours/${matiere}/`)) {
        await manifestCache.delete(req);
      }
    }
  } catch (e) {
    console.warn('[SW] Erreur clearMatiere:', e);
  }
}

console.log('[SW] Service Worker v6.0.0 chargé');
