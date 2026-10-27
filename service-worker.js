// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : OFFLINE v2.2 — Navigation instantanée
// ================================================================

const SW_VERSION = 'arvexa-offline-v4.12'; // v4.12 : notification SW_ACTIVATED post-claim (détection de mise à jour sans course) + propagation fiable — propagation fiable des mises à jour — les pages HTML passent en NETWORK-FIRST (réseau d'abord avec garde-fou 2,5 s → repli cache ; appareil hors ligne déclaré → cache instantané ; le fetch de fond continue de rafraîchir le cache même après un repli) pour que chaque correction déployée arrive sur les téléphones dès la 1re ouverture, même après des jours de PWA ouverte ; precache avec timeout 8 s par URL (fini les installations qui pendent en réseau instable et retardent skipWaiting) ; toast « Nouvelle version installée » dans register-sw (clic = application immédiate). Cause racine : stale-while-revalidate servait l'ancien HTML indéfiniment quand la revalidation d'arrière-plan échouait (réseau 3G instable), d'où « c'est pas réglé » malgré des fixs déployés. v4.11 : écran maintenu allumé pendant les générations IA — wake-lock.js (Wake Lock natif Android/iOS + repli vidéo muette NoSleep pour navigateurs anciens, compteur de références multi-générations, ré-acquisition au retour d'arrière-plan) intégré aux pages arv, exam (génération + correction), reviseur, reviseur-history, exam-history, planificateur et arv-progress ; wake-lock.js precaché. v4.10 : fix QCM « le test sort de sa zone » — les options longues débordaient hors de l'écran (espaces insécables U+00A0 émis par l'IA → texte insécable + span flex sans min-width:0). Fix triple : serveur cleanLatexText normalise U+00A0/U+202F en espaces normaux sur TOUTE l'analyse ; cahier safeText normalise à l'affichage (sections déjà stockées réparées) + CSS .qcm-option (flex-start, min-width:0, span break-word) ; exam .answer-option/.question-title idem. v4.9 : fix UI — modales formulaire (détail d'une formule) et notifications : haut en dôme géant (border-radius 999px) → arrondi normal 20px comme les autres pages. v4.8 : dictée vocale v3 — anti-répétitions (fusion sans chevauchement des segments que le moteur re-transcrit après chaque relance + compression des bégaiements « le le »), cap recalibré 2 500 caractères (budget IA). v4.7 : dictée vocale reconstruite — flux 2 étapes scrollables dans « Ajouter une section » (étape 1 texte centré → étape 2 bouton enregistrer centré), durée illimitée (relance auto), cap 15 000 caractères, aperçu live, erreurs micro explicites. v4.6 : serveur progress v8.6 « édition complète » — explications prof enrichies, banque de questions exhaustive 10-40, QCM 8-12 imposés, anglais ré-ajouté au cahier (toujours sans mode examen), normalisation Q&R/QCM côté serveur. v4.5 : cahier (arv-progress) adapté au serveur progress v8.5 restauré tel quel — actions v9 retirées (progression/goals/sessions/quota/markSectionStudied), rendu contexte+faits clés histoire-géo ; connexion exam (useNotebook) inchangée. // v4.3 : notebook + exam — matière Anglais (cahier, sans mode examen), banque de questions élargie, QCM 8, bouton « Retourner à mon cahier », dictée vocale reconstruite (zéro doublon). v4.2 : réviseur « en dur » — accueil du réviseur peint pré-CDN depuis un snapshot local par chapitre (LRU 12, TTL 12 h), hydratation de l'état (notions incluses), revalidation silencieuse /api/reviseur conservant le cache en cas d'erreur réseau, statut blocked/paused via docSWR (arvexa-cache.js). v4.1 : audit stabilité — precache étendu (JS partagés bac-date/auth-guard/katex-utils/analytics/offline/onboarding-tour/register-fcm-sw/firebase-messaging-sw + pages auth-choice/login/404) pour un offline fiable dès l'installation. v4.0 : // v4.0 : accueil « en dur » — tableau de bord restauré pré-CDN depuis les caches locaux (countdown BAC, date/citation du jour, compteurs de lecture, badges), splash épuré (nom du site + cercle), anti-flash instant/ready. v3.9 : cache-first universel — arvexa-cache.js (readCacheDoc/docSWR : lecture cache IndexedDB Firestore instantanée + revalidation serveur arrière-plan), appliqué à arv, arv-progress, exam, exam-history, reviseur-history, tableau-periodique, formulaires ; préchauffage 1×/session dans l'index (matières+chapters+notifications). v3.8 : accueil instantané — splash 1er chargement de session + snapshot de session (retour accueil sans rechargement visible, pill de synchro). v3.8 : accueil instantané — splash de chargement au 1er chargement de session uniquement (#appSplash), snapshot de session pour restaurer l'accueil sans rechargement visible (Firestore actualise en arrière-plan + pill discrète). v3.7 : couverture i18n complète — +228 clés (abonnement, légal, examens, badges, toasts, titres de pages), apostrophes unifiées dans norm(), motifs Niveau/Partie/session/badges/mois, titres <title> ajoutés aux pages. v3.6 : bilingue FR/EN — arvexa-i18n.js (dictionnaire + MutationObserver + persistance 'arvexa-lang' + sync multi-onglets), sélecteur Langue dans profil.html. Précédent v3.5 : : mode clair global — tokens [data-theme=light] dans arvexa-ui.css, theme.js (persistance + meta theme-color + sync multi-onglets), boot anti-flash inline sur toutes les pages, couleurs codées en dur thémables (rgb triplets), toggle Apparence dans profil.html
const CACHE_STATIC = `${SW_VERSION}-static`;
const CACHE_HTML = `${SW_VERSION}-html`;
// Garde-fous réseau : les HTML attendent le réseau au max HTML_NET_TIMEOUT avant de
// retomber sur le cache (fraîcheur garantie en ligne, réactivité préservée hors ligne).
const HTML_NET_TIMEOUT = 2500;
const PRECACHE_TIMEOUT = 8000;

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
  './wake-lock.js',
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
// Chaque URL du precache est bornée dans le temps (PRECACHE_TIMEOUT) : en réseau
// instable, l'installation ne peut plus pendre des minutes et retarder skipWaiting.
function precacheOne(cache, url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PRECACHE_TIMEOUT);
  return fetch(new Request(url, { signal: ctl.signal }))
    .then((response) => {
      if (response && response.ok) return cache.put(url, response);
      console.warn('[SW] Précache ignoré :', url);
    })
    .catch(() => {
      console.warn('[SW] Précache ignoré :', url);
    })
    .finally(() => clearTimeout(timer));
}

self.addEventListener('install', (event) => {
  console.log(`[SW] Install ${SW_VERSION}`);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => Promise.all(PRECACHE.map((url) => precacheOne(cache, url))))
      .then(() => self.skipWaiting())
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
    .then(() => self.clients.matchAll())
    .then((clients) => clients.forEach((client) =>
      client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION })
    ))
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

// 🔄 HTML : NETWORK-FIRST avec garde-fou (remplace stale-while-revalidate)
// En ligne → le réseau d'abord : chaque page servie est LA version déployée,
// les correctifs arrivent sur les téléphones dès la première ouverture.
// Appareil hors ligne déclaré → cache instantané (zéro latence).
// Réseau lent/échoué → cache sous HTML_NET_TIMEOUT, puis le fetch continue
// en tâche de fond pour rafraîchir le cache de la prochaine fois.
function offlineFallback(req) {
  return caches.open(CACHE_STATIC)
    .then((staticCache) => staticCache.match(req))
    .then((cachedStatic) => {
      if (cachedStatic) return cachedStatic;
      return caches.match('./offline.html');
    })
    .then((offline) => {
      if (offline) return offline;
      return new Response(
        '<!DOCTYPE html><html lang="fr"><body><h1>Hors ligne</h1><p>Page non disponible.</p></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    });
}

async function handleHTML(req) {
  const cache = await caches.open(CACHE_HTML);
  const cached = await cache.match(req);

  // Mode avion / pas de connectivité déclarée → cache direct
  if (self.navigator && self.navigator.onLine === false && cached) return cached;

  // La promesse réseau vit au-delà du garde-fou : si elle aboutit après un
  // repli sur cache, elle rafraîchit quand même le cache pour la prochaine fois.
  const netPromise = fetch(req)
    .then((response) => {
      if (response && response.ok) cache.put(req, response.clone());
      return response;
    })
    .catch(() => null);

  let served = null;
  try {
    served = await Promise.race([
      netPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('HTML_NET_TIMEOUT')), HTML_NET_TIMEOUT)
      ),
    ]);
    if (served) return served;
  } catch (e) {
    // réseau trop lent → repli cache ci-dessous
  }

  if (cached) return cached;

  // Pas de cache (première visite) : laisser le fetch initial une vraie chance
  try {
    served = await netPromise;
    if (served) return served;
  } catch (e) {}

  return offlineFallback(req);
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
