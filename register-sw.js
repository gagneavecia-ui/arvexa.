// ================================================================
// REGISTER SERVICE WORKER — ARVEXA School
// Version : 5.0.0 — Charge aussi offline.js + analytics.js
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
    script.onerror = () => console.warn('[Offline] Impossible de charger offline.js');
    document.head.appendChild(script);
  }

  // ============================================================
  // 3. ⚡ INJECTION AUTOMATIQUE DE analytics.js
  // ============================================================
  function injectAnalytics() {
    if (document.getElementById('arvexaAnalyticsScript')) return;

    // Ne pas injecter sur les pages admin (l'admin a ses propres analytics)
    const path = window.location.pathname;
    if (path.includes('admin')) return;

    const script = document.createElement('script');
    script.id = 'arvexaAnalyticsScript';
    script.src = 'analytics.js';
    script.defer = true;
    script.type = 'module'; // ⚡ module pour pouvoir utiliser les imports Firebase
    script.onerror = () => console.warn('[Analytics] Impossible de charger analytics.js');
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectOffline();
      injectAnalytics();
    });
  } else {
    injectOffline();
    injectAnalytics();
  }

  // ============================================================
  // 4. LOGS RÉSEAU
  // ============================================================
  window.addEventListener('online', () => console.log('[SW] En ligne'));
  window.addEventListener('offline', () => console.log('[SW] Hors ligne'));
})();
