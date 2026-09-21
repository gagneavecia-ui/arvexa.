// ================================================================
// REGISTER SERVICE WORKER — ARVEXA School
// Version : 2.0.1 — Anti-boucle
// ================================================================

(function() {
  'use strict';

  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Non supporté');
    return;
  }

  // ⚡ État global anti-boucle
  let isReloading = false;
  let registrationRef = null;

  window.addEventListener('load', () => {
    // ⚡ URL FIXE — pas de timestamp (sinon boucle infinie)
    const swUrl = 'service-worker.js';

    navigator.serviceWorker.register(swUrl, {
      scope: './',
      updateViaCache: 'none'
    })
    .then((registration) => {
      registrationRef = registration;
      console.log('[SW] ✅ Enregistré. Scope:', registration.scope);

      // ⚡ Vérifie MAJ une fois au démarrage (sans forcer le rechargement)
      setTimeout(() => {
        registration.update().catch(() => {});
      }, 1000);

      // ⚡ Vérifie périodiquement (1h)
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);

      // ═══════════════════════════════════════════════════════════
      // DÉTECTION NOUVELLE VERSION
      // ═══════════════════════════════════════════════════════════
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        console.log('[SW] 🔄 Nouvelle version en cours d\'installation');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // ⚡ Une nouvelle version est prête → proposer MAJ
              console.log('[SW] 📦 Nouvelle version prête');
              showUpdateNotification(newWorker);
            } else {
              console.log('[SW] 🆕 Première installation');
            }
          }
        });
      });
    })
    .catch((error) => {
      console.error('[SW] ❌ Erreur:', error);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // RECHARGEMENT UNIQUEMENT QUAND L'UTILISATEUR CLIQUE
  // ═══════════════════════════════════════════════════════════════
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // ⚡ Ne PAS recharger automatiquement — laisse l'utilisateur décider
    console.log('[SW] 🔄 Contrôleur changé (rechargement manuel uniquement)');
  });

  // ═══════════════════════════════════════════════════════════════
  // NOTIFICATION VISUELLE DE MISE À JOUR
  // ═══════════════════════════════════════════════════════════════
  function showUpdateNotification(worker) {
    if (document.getElementById('arvexa-sw-update-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'arvexa-sw-update-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(120px);
      background: linear-gradient(135deg, #E0B84A, #B8860B);
      color: #0A0A0A;
      padding: 14px 24px;
      border-radius: 30px;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 700;
      z-index: 999999;
      box-shadow: 0 12px 40px rgba(184, 134, 11, 0.45);
      transition: transform 0.45s cubic-bezier(0.25, 1, 0.5, 1);
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      max-width: 92%;
      user-select: none;
    `;
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </svg>
      <span>Mise à jour disponible</span>
      <span style="opacity:.7;">• Appuie pour actualiser</span>
    `;

    toast.addEventListener('click', () => {
      if (isReloading) return;
      isReloading = true;

      // ⚡ Envoie SKIP_WAITING au nouveau SW
      worker.postMessage({ type: 'SKIP_WAITING' });

      // ⚡ Attends que le contrôleur change, puis recharge UNE FOIS
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });

      // ⚡ Filet de sécurité : recharge après 1s si pas de controllerchange
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    });

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // ⚡ Disparaît après 15 secondes (mais reste cliquable dans le temps)
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.transform = 'translateX(-50%) translateY(120px)';
        setTimeout(() => toast.remove(), 500);
      }
    }, 15000);
  }

  // ═══════════════════════════════════════════════════════════════
  // ONLINE / OFFLINE
  // ═══════════════════════════════════════════════════════════════
  window.addEventListener('online', () => console.log('[SW] 🟢 En ligne'));
  window.addEventListener('offline', () => console.log('[SW] 🔴 Hors ligne'));

  // ═══════════════════════════════════════════════════════════════
  // API PUBLIQUE
  // ═══════════════════════════════════════════════════════════════
  window.arvexaSW = {
    checkForUpdate: () => {
      if (registrationRef) registrationRef.update().catch(() => {});
    },
    clearCache: () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
      }
    }
  };

})();
