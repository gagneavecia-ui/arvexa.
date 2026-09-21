// ================================================================
// REGISTER SERVICE WORKER — ARVEXA School
// Version simplifiée — pas de rechargement automatique
// ================================================================

(function() {
  'use strict';

  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Non supporté');
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js', {
      scope: './',
      updateViaCache: 'none'
    })
    .then((registration) => {
      console.log('[SW] Enregistré. Scope:', registration.scope);

      // Vérifier les mises à jour (sans forcer de rechargement)
      registration.addEventListener('updatefound', () => {
        console.log('[SW] Mise à jour détectée en arrière-plan');
      });
    })
    .catch((error) => {
      console.error('[SW] Erreur:', error);
    });
  });

  // ⚡ NE PAS recharger automatiquement sur controllerchange
  // Le rechargement se fera naturellement au prochain chargement de page

  window.addEventListener('online', () => {
    console.log('[SW] En ligne');
  });

  window.addEventListener('offline', () => {
    console.log('[SW] Hors ligne');
  });
})();
