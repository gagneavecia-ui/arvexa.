// ================================================================
// REGISTER SERVICE WORKER — ARVEXA School
// Version : 2.0.0
// À inclure dans toutes les pages avec :
// <script src="register-sw.js" defer></script>
// ================================================================

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // VÉRIFIER LE SUPPORT
  // ═══════════════════════════════════════════════════════════════
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Service Worker non supporté par ce navigateur');
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // REGISTRE AU CHARGEMENT
  // ═══════════════════════════════════════════════════════════════
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js?v=' + Date.now(), {
      scope: './',
      updateViaCache: 'none'
    })
    .then((registration) => {
      console.log('[SW] Service Worker enregistré. Scope:', registration.scope);

      // ⚡ Forcer la vérification de mise à jour immédiatement
      registration.update().catch((err) => {
        console.warn('[SW] Impossible de vérifier les mises à jour:', err);
      });

      // ⚡ Vérifier les mises à jour toutes les 30 minutes
      setInterval(() => {
        registration.update().catch(() => {});
      }, 30 * 60 * 1000);

      // ⚡ Détecter les nouvelles versions
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        console.log('[SW] Nouvelle version en cours d\'installation...');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // ⚡ Nouvelle version prête
            console.log('[SW] Nouvelle version disponible');
            showUpdateNotification(registration);
          }
        });
      });
    })
    .catch((error) => {
      console.error('[SW] Erreur d\'enregistrement:', error);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // DÉTECTER LES CHANGEMENTS DE CONTROLEUR
  // ═══════════════════════════════════════════════════════════════
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    console.log('[SW] Nouveau Service Worker actif. Rechargement...');
    window.location.reload();
  });

  // ═══════════════════════════════════════════════════════════════
  // NOTIFICATION DE MISE À JOUR
  // ═══════════════════════════════════════════════════════════════
  function showUpdateNotification(registration) {
    // Supprimer une notification existante
    const existing = document.getElementById('arvexa-sw-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'arvexa-sw-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(120px);
      background: linear-gradient(135deg, #E0B84A, #B8860B);
      color: #0A0A0A;
      padding: 14px 24px;
      border-radius: 30px;
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 14px;
      font-weight: 700;
      z-index: 999999;
      box-shadow: 0 12px 40px rgba(184, 134, 11, 0.4);
      transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      max-width: calc(100% - 32px);
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    `;

    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </svg>
      <span>Nouvelle version disponible — Appuie ici</span>
    `;

    // ⚡ Au clic : activer la nouvelle version et recharger
    toast.addEventListener('click', () => {
      // Envoyer le message SKIP_WAITING au nouveau worker
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      // Fallback : recharger après un court délai
      setTimeout(() => {
        window.location.reload();
      }, 500);
    });

    document.body.appendChild(toast);

    // Animer l'entrée
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // ⚡ Ne PAS disparaître automatiquement — reste jusqu'au clic
    // ou disparaît après 30 secondes
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.transform = 'translateX(-50%) translateY(120px)';
        setTimeout(() => toast.remove(), 500);
      }
    }, 30000);
  }

  // ═══════════════════════════════════════════════════════════════
  // DÉTECTION ONLINE/OFFLINE
  // ═══════════════════════════════════════════════════════════════
  window.addEventListener('online', () => {
    console.log('[SW] Connexion rétablie');
  });

  window.addEventListener('offline', () => {
    console.log('[SW] Connexion perdue');
  });

  console.log('[SW] Register v2.0.0 initialisé');
})();
