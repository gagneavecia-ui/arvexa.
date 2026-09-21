// ================================================================
// REGISTER SERVICE WORKER — ARVEXA School
// Version : 4.0.0 — Charge aussi offline.js
// ================================================================

(function () {
  'use strict';

  // ============================================================
  // 1. ENREGISTREMENT DU SERVICE WORKER
  // ============================================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('service-worker.js', {
          scope: './',
          updateViaCache: 'none'
        })
        .then((registration) => {
          console.log('[SW] Enregistré. Scope:', registration.scope);

          // Écouter les mises à jour en arrière-plan
          registration.addEventListener('updatefound', () => {
            console.log('[SW] Mise à jour détectée en arrière-plan');
          });
        })
        .catch((error) => {
          console.error('[SW] Erreur:', error);
        });
    });
  }

  // ============================================================
  // 2. INJECTION AUTOMATIQUE DE offline.js
  // ============================================================
  function injectOffline() {
    if (document.getElementById('arvexaOfflineScript')) return;

    const script = document.createElement('script');
    script.id = 'arvexaOfflineScript';
    script.src = 'offline.js';
    script.defer = true;
    script.onerror = () => {
      console.warn('[Offline] Impossible de charger offline.js');
    };
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectOffline);
  } else {
    injectOffline();
  }

  // ============================================================
  // 3. LOGS RÉSEAU
  // ============================================================
  window.addEventListener('online', () => {
    console.log('[SW] En ligne');
  });

  window.addEventListener('offline', () => {
    console.log('[SW] Hors ligne');
  });
})();
