// ================================================================
// FIREBASE MESSAGING SERVICE WORKER — ARVEXA School
// Version : 1.0.0
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
// MESSAGES EN ARRIÈRE-PLAN
// ================================================================
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM-SW] Message reçu en arrière-plan:', payload);

  const notificationTitle = payload.notification?.title || payload.data?.title || 'ARVEXA School';
  const notificationBody = payload.notification?.body || payload.data?.body || '';
  const notificationIcon = payload.notification?.icon || 'icon.png';
  const clickAction = getSafeNotificationUrl(
    payload.data?.click_action || payload.fcmOptions?.link
  );

  const notificationOptions = {
    body: notificationBody,
    icon: notificationIcon,
    badge: 'icon.png',
    vibrate: [200, 100, 200],
    tag: 'arvexa-notification-' + Date.now(),
    renotify: true,
    requireInteraction: false,
    data: {
      url: clickAction,
      timestamp: Date.now()
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// ================================================================
// CLIC SUR LA NOTIFICATION
// ================================================================
self.addEventListener('notificationclick', (event) => {
  console.log('[FCM-SW] Notification cliquée:', event.notification.data);
  event.notification.close();

  const url = event.notification.data?.url || 'notifications.html';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // Si un onglet ARVEXA est déjà ouvert → focus
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Naviguer vers la page de destination
          if (client.url !== url && 'navigate' in client) {
            client.navigate(url);
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

console.log('[FCM-SW] Firebase Messaging Service Worker chargé.');
