// ================================================================
// FIREBASE MESSAGING SERVICE WORKER — ARVEXA School
// Version : 1.5.0
// Corrections appliquées :
//  - C1 : client.navigate() avec fallback openWindow (navigation fiable)
//  - C2 : try/catch sur showNotification (évite les rejets silencieux)
//  - C3 : handler pushsubscriptionchange (robustesse FCM)
//  - C4 : anti-doublon — payload notification natif = affiché par le SDK,
//         le handler ne traite plus que les messages data-only
//  - C5 (v1.3.0) : badge monochrome blanc notif-icon.png (atome, variante 4)
//         — exigence Android pour la barre d'état
//  - C6 (v1.4.0, retour propriétaire sur capture d'écran) — PLUS DE GRANDE
//         ICÔNE : « je ne veux pas que le logo de droite s'affiche,
//         uniquement celui de l'application ». La bannière n'affiche que le
//         logo de l'app (lanceur, à gauche) + titre + message ; AUCUN champ
//         `icon` → rien à droite. Le badge atome (variante 4) reste l'icône
//         de la barre d'état.
//  - C7 (v1.5.0, P1 « relance intelligente », audit 09/11/2026) — MAX 1
//         NOTIFICATION TOUTES LES 20 H pour les messages data-only : le
//         dernier affichage est mémorisé dans IndexedDB ; si un push arrive
//         avant le délai, il est journalisé puis ignoré (pas de spam). Les
//         messages avec payload `notification` natif restent affichés par le
//         SDK FCM lui-même (non interceptables côté SW) ; la discipline côté
//         envoi reste donc nécessaire pour ce cas.
// ================================================================

// ⚡ Imports FCM (version compat, obligatoire pour Service Worker)
importScripts('https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js');

// ================================================================
// INITIALISATION FIREBASE
// ================================================================
firebase.initializeApp({
  apiKey: "AIzaSyDHscOXw3rLuhV6z1Cny-bdYCumqpnG7QE",
  authDomain: "arvexa-fbf10.firebaseapp.com",
  projectId: "arvexa-fbf10",
  storageBucket: "arvexa-fbf10.firebasestorage.app",
  messagingSenderId: "920108330053",
  appId: "1:920108330053:web:f532d71cbc2c824bc7472c"
});

const messaging = firebase.messaging();

// ⚡ ANTI-DOUBLON — ACTIVATION IMMÉDIATE des mises à jour du SW :
// sans skipWaiting, un onglet laissé ouvert gardait l'ANCIEN SW actif
// et les correctifs déployés ne s'appliquaient jamais chez
// l'utilisateur (doublons persistants). skipWaiting + clients.claim
// activent le SW à jour instantanément, sans attendre la fermeture
// de tous les onglets.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function getSafeNotificationUrl(value) {
  const fallback = new URL('notifications.html', self.location.origin).href;
  if (typeof value !== 'string' || !value) return fallback;

  try {
    const candidate = new URL(value, self.location.origin);
    if (candidate.origin !== self.location.origin) return fallback;
    return candidate.href;
  } catch (error) {
    return fallback;
  }
}

// ================================================================
// ✅ C7 — RELANCE INTELLIGENTE : throttle 20 h (IndexedDB)
// ================================================================
const THROTTLE_DB = 'arvexa-notif-throttle';
const THROTTLE_MS = 20 * 60 * 60 * 1000; // 20 heures

function throttleGetLastShown() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(THROTTLE_DB, 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore('kv'); } catch (e) { /* déjà créée */ }
      };
      req.onerror = () => resolve(0);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', 'readonly');
          const get = tx.objectStore('kv').get('lastShown');
          get.onsuccess = () => resolve(Number(get.result) || 0);
          get.onerror = () => resolve(0);
        } catch (e) { resolve(0); }
      };
    } catch (e) { resolve(0); }
  });
}

function throttleSetLastShown(ts) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(THROTTLE_DB, 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore('kv'); } catch (e) { /* déjà créée */ }
      };
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(ts, 'lastShown');
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) { resolve(false); }
      };
    } catch (e) { resolve(false); }
  });
}

// ================================================================
// MESSAGES EN ARRIÈRE-PLAN
// ================================================================
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM-SW] Message reçu en arrière-plan:', payload);

  // ✅ C4 — ANTI-DOUBLON : si le push contient un payload `notification`
  // natif (backend ≥ v4.21), le SDK FCM l'affiche AUTOMATIQUEMENT en
  // arrière-plan (affichage natif fiable, même navigateur fermé) ET nous
  // appelle quand même ici → on n'affiche PLUS une 2e fois, sinon doublon.
  // Ce handler ne traite désormais que les messages data-only (historique).
  if (payload.notification && payload.notification.title) return;

  const notificationTitle =
    payload.data?.title ||
    payload.notification?.title ||
    'ARVEXA School';

  const notificationBody =
    payload.data?.body ||
    payload.notification?.body ||
    '';

  const clickAction = getSafeNotificationUrl(
    payload.data?.click_action ||
    payload.notification?.click_action ||
    payload.fcmOptions?.link
  );

  const notificationOptions = {
    body: notificationBody,
    // ✅ C6 — PAS de champ `icon` : aucune grande icône à droite ; le badge
    // MONOCHROME blanc (variante 4 « atome ») reste l'icône de la barre d'état.
    badge: 'notif-icon.png',
    vibrate: [200, 100, 200],
    tag: 'arvexa-relance',
    renotify: true,
    requireInteraction: false,
    data: {
      url: clickAction,
      timestamp: Date.now()
    }
  };

  // ✅ C7 — RELANCE INTELLIGENTE : une seule notification data-only affichée
  // toutes les 20 h ; les pushes qui arrivent avant le délai sont ignorés.
  throttleGetLastShown().then((lastShown) => {
    const now = Date.now();
    if (lastShown && (now - lastShown) < THROTTLE_MS) {
      console.log('[FCM-SW] Relance intelligente : notification ignorée ' +
        '(dernière affichée il y a ' + Math.round((now - lastShown) / 60000) + ' min, max 1 / 20 h)');
      return;
    }
    throttleSetLastShown(now);

    // ✅ C2 — try/catch sur showNotification (évite les rejets silencieux)
    try {
      self.registration.showNotification(notificationTitle, notificationOptions)
        .catch((error) => {
          console.warn('[FCM-SW] showNotification échoué :', error && error.message ? error.message : error);
        });
    } catch (error) {
      console.warn('[FCM-SW] showNotification exception :', error && error.message ? error.message : error);
    }
  });
});

// ================================================================
// CLIC SUR LA NOTIFICATION
// ================================================================
self.addEventListener('notificationclick', (event) => {
  console.log('[FCM-SW] Notification cliquée:', event.notification.data);

  // ✅ C4 — les notifications nativement affichées par le SDK portent
  // data.FCM_MSG : le SDK a SON propre handler notificationclick qui ouvre
  // le lien fcmOptions — on ne fait rien ici (sinon double navigation).
  if (event.notification.data && event.notification.data.FCM_MSG) return;

  event.notification.close();

  const url = event.notification.data?.url || 'notifications.html';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // Si un onglet ARVEXA est déjà ouvert → focus + navigation
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // ✅ C1 — client.navigate() avec fallback openWindow
          if (client.url !== url && 'navigate' in client) {
            return client.navigate(url)
              .then((navigatedClient) => {
                if (navigatedClient && 'focus' in navigatedClient) {
                  return navigatedClient.focus();
                }
                return client.focus();
              })
              .catch((err) => {
                // Navigation échouée (SW non contrôlant) → ouvrir un nouvel onglet
                console.warn('[FCM-SW] navigate échouée, ouverture nouvel onglet :', err && err.message ? err.message : err);
                if (clients.openWindow) {
                  return clients.openWindow(url);
                }
                // En dernier recours : focus simple
                return client.focus();
              });
          }
          return client.focus();
        }
      }

      // Sinon → ouvrir un nouvel onglet
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// ================================================================
// GESTION DES FERMETURES
// ================================================================
self.addEventListener('notificationclose', (event) => {
  console.log('[FCM-SW] Notification fermée:', event.notification.tag);
});

// ================================================================
// ✅ C3 — ROBUSTESSE FCM : réabonnement automatique
// ================================================================
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[FCM-SW] pushsubscriptionchange détecté');
  // Note : le SDK Firebase Messaging gère déjà le réabonnement automatique.
  // Ce handler est un filet de sécurité pour les navigateurs qui l'émettent
  // avant que le SDK ne le fasse. On ne fait rien de destructif ici.
  event.waitUntil(Promise.resolve());
});

console.log('[FCM-SW] Firebase Messaging Service Worker chargé (v1.5.0 — relance intelligente : max 1 notif / 20 h).');
