// ================================================================
// REGISTER SERVICE WORKER — ARVEXA School
// Version : 2.0.0 — Anti-cache agressif
// ================================================================

(function() {
  'use strict';

  // Vérifier le support
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Service Worker non supporté');
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // ÉTAT GLOBAL
  // ═══════════════════════════════════════════════════════════════
  let isRefreshing = false;
  let registrationRef = null;

  // ═══════════════════════════════════════════════════════════════
  // ENREGISTREMENT
  // ═══════════════════════════════════════════════════════════════
  window.addEventListener('load', () => {
    // ⚡ Version horodatée pour forcer la détection de mise à jour
    const swUrl = 'service-worker.js?v=' + Date.now();

    navigator.serviceWorker.register(swUrl, {
      scope: './',
      updateViaCache: 'none'  // ⚡ N'utilise JAMAIS le cache HTTP pour le SW
    })
    .then((registration) => {
      registrationRef = registration;
      console.log('[SW] ✅ Service Worker enregistré. Scope:', registration.scope);

      // ⚡ Force la vérification immédiate d'une mise à jour
      registration.update().catch(() => {});

      // ⚡ Vérifie périodiquement (toutes les 30 min)
      setInterval(() => {
        registration.update().catch(() => {});
      }, 30 * 60 * 1000);

      // ═══════════════════════════════════════════════════════════
      // DÉTECTION D'UNE NOUVELLE VERSION
      // ═══════════════════════════════════════════════════════════
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        console.log('[SW] 🔄 Nouvelle version détectée, installation...');

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // ⚡ Une ancienne version est active → nouvelle version prête
              console.log('[SW] 📦 Nouvelle version prête');
              activateNewVersion(newWorker);
            } else {
              // ⚡ Première installation
              console.log('[SW] 🆕 Première installation terminée');
            }
          }
        });
      });

      // ⚡ Si un SW est déjà en attente (cas rare)
      if (registration.waiting && navigator.serviceWorker.controller) {
        console.log('[SW] ⏳ Un SW est déjà en attente');
        activateNewVersion(registration.waiting);
      }

    })
    .catch((error) => {
      console.error('[SW] ❌ Erreur d\'enregistrement:', error);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ACTIVATION AUTOMATIQUE D'UNE NOUVELLE VERSION
  // ═══════════════════════════════════════════════════════════════
  function activateNewVersion(worker) {
    // ⚡ Demande au nouveau SW de prendre le contrôle immédiatement
    worker.postMessage({ type: 'SKIP_WAITING' });

    // ⚡ Notification visuelle à l'utilisateur
    showUpdateNotification();
  }

  // ═══════════════════════════════════════════════════════════════
  // DÉTECTION DU CHANGEMENT DE CONTRÔLEUR → RECHARGEMENT
  // ═══════════════════════════════════════════════════════════════
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isRefreshing) return;
    isRefreshing = true;

    console.log('[SW] 🔄 Contrôleur changé, rechargement...');

    // ⚡ Petit délai pour laisser le SW s'installer proprement
    setTimeout(() => {
      window.location.reload();
    }, 200);
  });

  // ═══════════════════════════════════════════════════════════════
  // NOTIFICATION VISUELLE DE MISE À JOUR
  // ═══════════════════════════════════════════════════════════════
  function showUpdateNotification() {
    // ⚡ Éviter les doublons
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
      <span>Nouvelle version disponible</span>
      <span style="opacity:.7;">• Appuie pour actualiser</span>
    `;

    toast.addEventListener('click', () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      }
      setTimeout(() => window.location.reload(), 300);
    });

    document.body.appendChild(toast);

    // ⚡ Animation d'entrée
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // ⚡ Disparaît après 12 secondes
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.transform = 'translateX(-50%) translateY(120px)';
        setTimeout(() => toast.remove(), 500);
      }
    }, 12000);
  }

  // ═══════════════════════════════════════════════════════════════
  // DÉTECTION ONLINE/OFFLINE
  // ═══════════════════════════════════════════════════════════════
  window.addEventListener('online', () => {
    console.log('[SW] 🟢 Connexion rétablie');
  });

  window.addEventListener('offline', () => {
    console.log('[SW] 🔴 Connexion perdue');
  });

  // ═══════════════════════════════════════════════════════════════
  // EXPOSITION API PUBLIQUE (optionnel)
  // ═══════════════════════════════════════════════════════════════
  window.arvexaSW = {
    // ⚡ Force une vérification de mise à jour
    checkForUpdate: () => {
      if (registrationRef) {
        registrationRef.update().catch(() => {});
      }
    },
    // ⚡ Force la purge de tout le cache
    clearCache: () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
      }
    },
    // ⚡ Force le rechargement
    reload: () => {
      window.location.reload();
    }
  };

})();
