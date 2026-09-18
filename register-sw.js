// ================================================================
// REGISTER SERVICE WORKER — ARVEXA School
// À inclure dans toutes les pages avec :
// <script src="register-sw.js" defer></script>
// ================================================================

(function() {
  'use strict';

  // Vérifier le support
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Service Worker non supporté par ce navigateur');
    return;
  }

  // Enregistrer au chargement
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js', {
      scope: './'
    })
    .then((registration) => {
      console.log('[SW] ✅ Service Worker enregistré. Scope:', registration.scope);

      // Vérifier les mises à jour
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Nouvelle version disponible
            console.log('[SW] Nouvelle version disponible');
            showUpdateNotification();
          }
        });
      });
    })
    .catch((error) => {
      console.error('[SW] ❌ Erreur d\'enregistrement:', error);
    });
  });

  // ================================================================
  // NOTIFICATION DE MISE À JOUR
  // ================================================================
  function showUpdateNotification() {
    // Créer un petit toast discret
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: linear-gradient(135deg, rgba(184, 134, 11, 0.95), rgba(184, 134, 11, 0.85));
      color: #0A0A0A;
      padding: 12px 20px;
      border-radius: 30px;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      font-weight: 600;
      z-index: 999999;
      box-shadow: 0 8px 32px rgba(184, 134, 11, 0.35);
      transition: transform 0.4s cubic-bezier(0.25, 1, 0.5, 1);
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      max-width: 90%;
    `;
    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </svg>
      <span>Nouvelle version disponible — Appuie pour actualiser</span>
    `;

    toast.addEventListener('click', () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      }
      setTimeout(() => window.location.reload(), 300);
    });

    document.body.appendChild(toast);

    // Animer l'entrée
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Disparaître après 10 secondes
    setTimeout(() => {
      toast.style.transform = 'translateX(-50%) translateY(100px)';
      setTimeout(() => toast.remove(), 400);
    }, 10000);
  }

  // ================================================================
  // DÉTECTION ONLINE/OFFLINE
  // ================================================================
  window.addEventListener('online', () => {
    console.log('[SW] 🟢 Connexion rétablie');
  });

  window.addEventListener('offline', () => {
    console.log('[SW] 🔴 Connexion perdue');
  });

})();