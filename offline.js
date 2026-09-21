// ================================================================
// OFFLINE.JS — ARVEXA School
// Version : 2.0.0 — Bannière + indicateur + sync
// ================================================================

(function () {
  'use strict';

  if (window.__arvexaOfflineInit) return;
  window.__arvexaOfflineInit = true;

  const STORAGE_KEY = 'arvexa_pending_sync';
  const FCM_DISMISSED_KEY = 'arvexa_offline_dismissed';

  let isOnline = navigator.onLine;
  let pendingSync = [];
  let bannerEl = null;
  let indicatorEl = null;

  // ================================================================
  // DONNÉES EN ATTENTE
  // ================================================================
  function loadPendingData() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      pendingSync = data ? JSON.parse(data) : [];
    } catch (e) {
      pendingSync = [];
    }
  }

  function savePendingData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingSync));
    } catch (e) {}
  }

  // ================================================================
  // BANNIÈRE
  // ================================================================
  function createBanner() {
    if (bannerEl) return bannerEl;

    bannerEl = document.createElement('div');
    bannerEl.id = 'arvexaOfflineBanner';
    bannerEl.className = 'arvexa-offline-banner';
    bannerEl.innerHTML = `
      <span class="arvexa-offline-dot"></span>
      <span class="arvexa-offline-text">
        Mode hors ligne — consultation uniquement
      </span>
      <button class="arvexa-offline-retry" type="button" aria-label="Réessayer">
        <i class="fas fa-rotate-right"></i>
      </button>
    `;

    // Insérer juste après le header, ou au début du body
    const header = document.querySelector('.header, .site-header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(bannerEl, header.nextSibling);
    } else {
      document.body.insertBefore(bannerEl, document.body.firstChild);
    }

    // Bouton réessayer
    bannerEl.querySelector('.arvexa-offline-retry')
      .addEventListener('click', () => {
        window.location.reload();
      });

    return bannerEl;
  }

  // ================================================================
  // INDICATEUR (dans le header)
  // ================================================================
  function createIndicator() {
    if (indicatorEl) return indicatorEl;

    // Chercher les header-actions (index, profil, abonnement, notifs)
    const actions = document.querySelector('.header-actions')
      || document.querySelector('.header-right')
      || document.querySelector('.site-header');

    if (!actions) return null;

    indicatorEl = document.createElement('button');
    indicatorEl.id = 'arvexaOfflineIndicator';
    indicatorEl.className = 'arvexa-offline-indicator';
    indicatorEl.type = 'button';
    indicatorEl.setAttribute('aria-label', 'Statut de connexion');
    indicatorEl.title = 'Statut de connexion';
    indicatorEl.innerHTML = '<i class="fas fa-wifi"></i>';

    indicatorEl.addEventListener('click', () => {
      if (!navigator.onLine) {
        showToast('📶 Tu es hors ligne', 'error');
      } else {
        showToast('✅ Connecté', 'success');
      }
    });

    // Insérer au début de header-actions
    actions.insertBefore(indicatorEl, actions.firstChild);
    return indicatorEl;
  }

  // ================================================================
  // MISE À JOUR UI
  // ================================================================
  function updateUI() {
    // Bannière
    if (bannerEl) {
      bannerEl.classList.toggle('show', !isOnline);
    }

    // Indicateur
    if (indicatorEl) {
      indicatorEl.classList.toggle('online', isOnline);
      indicatorEl.classList.toggle('offline', !isOnline);
      indicatorEl.innerHTML = isOnline
        ? '<i class="fas fa-wifi"></i>'
        : '<i class="fas fa-wifi-slash"></i>';
      indicatorEl.title = isOnline ? 'Connecté' : 'Hors ligne';
    }

    // Attribut global pour le CSS
    document.documentElement.setAttribute(
      'data-online',
      isOnline ? 'true' : 'false'
    );
  }

  // ================================================================
  // TOAST LOCAL (évite d'écraser un toast global)
  // ================================================================
  let toastTimer = null;
  function showToast(message, type = 'info') {
    // Si la page a déjà une fonction showToast, l'utiliser
    if (typeof window.arvexaShowToast === 'function') {
      window.arvexaShowToast(message, type);
      return;
    }

    let toast = document.getElementById('arvexaOfflineToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'arvexaOfflineToast';
      toast.className = 'arvexa-offline-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.remove('success', 'error', 'info');
    toast.classList.add(type, 'show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  // ================================================================
  // ÉVÉNEMENTS RÉSEAU
  // ================================================================
  function bindNetworkEvents() {
    window.addEventListener('online', () => {
      isOnline = true;
      updateUI();
      showToast('✅ Connexion rétablie', 'success');
      // Tenter une sync
      setTimeout(syncPendingData, 500);
    });

    window.addEventListener('offline', () => {
      isOnline = false;
      updateUI();
      showToast('📶 Mode hors ligne activé', 'info');
    });
  }

  // ================================================================
  // SYNCHRONISATION
  // ================================================================
  async function syncPendingData() {
    loadPendingData();
    if (pendingSync.length === 0) return;

    const items = [...pendingSync];
    const failed = [];

    for (const item of items) {
      try {
        const success = await trySyncItem(item);
        if (!success) failed.push(item);
      } catch (e) {
        failed.push(item);
      }
    }

    pendingSync = failed;
    savePendingData();

    const successCount = items.length - failed.length;
    if (successCount > 0) {
      showToast(
        `✅ ${successCount} élément${successCount > 1 ? 's' : ''} synchronisé${successCount > 1 ? 's' : ''}`,
        'success'
      );
    }
  }

  // Tentative d'envoi vers Firestore si dispo
  async function trySyncItem(item) {
    // Seulement si Firestore est disponible dans la page
    if (!window.__arvexaSync) return false;
    try {
      return await window.__arvexaSync(item);
    } catch (e) {
      return false;
    }
  }

  // ================================================================
  // STYLES
  // ================================================================
  function injectStyles() {
    if (document.getElementById('arvexaOfflineStyles')) return;

    const style = document.createElement('style');
    style.id = 'arvexaOfflineStyles';
    style.textContent = `
      /* === BANNIÈRE HORS LIGNE === */
      .arvexa-offline-banner {
        display: none;
        position: sticky;
        top: 0;
        z-index: 999;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        background: linear-gradient(90deg, rgba(184,92,58,.18), rgba(184,92,58,.10));
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(184,92,58,.2);
        color: #FFB8A0;
        font-family: 'Inter', sans-serif;
        font-size: 12.5px;
        font-weight: 600;
        letter-spacing: 0.2px;
        animation: arvexaBannerIn 0.3s cubic-bezier(0.25,1,0.5,1);
      }
      .arvexa-offline-banner.show {
        display: flex;
      }
      .arvexa-offline-banner .arvexa-offline-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #E74C3C;
        box-shadow: 0 0 8px #E74C3C;
        flex-shrink: 0;
        animation: arvexaPulseDot 1.5s ease-in-out infinite;
      }
      .arvexa-offline-banner .arvexa-offline-text {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .arvexa-offline-banner .arvexa-offline-retry {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 1px solid rgba(255,184,160,.25);
        background: rgba(255,255,255,.04);
        color: #FFB8A0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        transition: all 0.2s ease;
        flex-shrink: 0;
      }
      .arvexa-offline-banner .arvexa-offline-retry:hover {
        background: rgba(255,184,160,.15);
        border-color: rgba(255,184,160,.5);
      }

      /* === INDICATEUR HEADER === */
      .arvexa-offline-indicator {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        background: rgba(255,255,255,.04);
        color: #8A8A7A;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: all 0.25s ease;
        flex-shrink: 0;
        position: relative;
      }
      .arvexa-offline-indicator.online {
        color: #3AB67E;
      }
      .arvexa-offline-indicator.offline {
        color: #E74C3C;
        animation: arvexaPulseIndicator 2s ease-in-out infinite;
      }
      .arvexa-offline-indicator:hover {
        background: rgba(255,255,255,.08);
      }
      .arvexa-offline-indicator::after {
        content: '';
        position: absolute;
        top: 6px;
        right: 6px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: transparent;
        transition: background 0.3s ease;
      }
      .arvexa-offline-indicator.online::after {
        background: #3AB67E;
        box-shadow: 0 0 6px #3AB67E;
      }
      .arvexa-offline-indicator.offline::after {
        background: #E74C3C;
        box-shadow: 0 0 6px #E74C3C;
      }

      /* === TOAST LOCAL === */
      .arvexa-offline-toast {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(-80px);
        padding: 12px 20px;
        border-radius: 12px;
        background: rgba(20,22,20,.96);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(224,184,74,.3);
        color: #F5F0E8;
        font-family: 'Inter', sans-serif;
        font-size: 13px;
        font-weight: 500;
        z-index: 10000;
        opacity: 0;
        pointer-events: none;
        transition: all 0.4s cubic-bezier(0.25,1,0.5,1);
        max-width: 90%;
        box-shadow: 0 12px 40px rgba(0,0,0,.5);
        text-align: center;
      }
      .arvexa-offline-toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .arvexa-offline-toast.success { border-color: rgba(58,182,126,.5); }
      .arvexa-offline-toast.error { border-color: rgba(231,76,60,.5); }
      .arvexa-offline-toast.info { border-color: rgba(224,184,74,.5); }

      /* === ANIMATIONS === */
      @keyframes arvexaBannerIn {
        from { opacity: 0; transform: translateY(-100%); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes arvexaPulseDot {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.3); }
      }
      @keyframes arvexaPulseIndicator {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }

      /* === RÉDUCTION MOTION === */
      @media (prefers-reduced-motion: reduce) {
        .arvexa-offline-banner,
        .arvexa-offline-dot,
        .arvexa-offline-indicator,
        .arvexa-offline-toast {
          animation: none !important;
          transition: none !important;
        }
      }

      /* === RESPONSIVE === */
      @media (max-width: 480px) {
        .arvexa-offline-banner {
          font-size: 11.5px;
          padding: 7px 10px;
        }
        .arvexa-offline-indicator {
          width: 32px;
          height: 32px;
          font-size: 13px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    injectStyles();
    loadPendingData();

    const boot = () => {
      createBanner();
      createIndicator();
      bindNetworkEvents();
      updateUI();

      // Sync automatique au démarrage si en ligne
      if (isOnline && pendingSync.length > 0) {
        setTimeout(syncPendingData, 1500);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  // ================================================================
  // API PUBLIQUE
  // ================================================================
  window.arvexaOffline = {
    isOnline: () => isOnline,

    /**
     * File une action pour sync ultérieure.
     * @param {object} data — payload à synchroniser
     */
    queue: function (data) {
      pendingSync.push({
        data: data,
        url: window.location.href,
        timestamp: new Date().toISOString()
      });
      savePendingData();
    },

    /**
     * Vérifie si une action peut être effectuée hors ligne.
     */
    canPerform: function (action) {
      if (isOnline) return true;
      const allowed = ['read', 'navigate', 'notes', 'calculator', 'formula'];
      return allowed.includes(action);
    },

    /**
     * Force la synchronisation manuelle.
     */
    sync: function () {
      if (isOnline) {
        syncPendingData();
      } else {
        showToast('📶 Impossible de synchroniser hors ligne', 'error');
      }
    },

    /**
     * Récupère la liste des actions en attente.
     */
    pending: function () {
      loadPendingData();
      return [...pendingSync];
    },

    /**
     * Enregistre un handler de sync personnalisé.
     * Usage : window.__arvexaSync = async (item) => { ... return true/false; }
     */
    setSyncHandler: function (fn) {
      window.__arvexaSync = fn;
    },

    // Exposer le toast
    toast: showToast
  };

  // Boot immédiat
  init();

  console.log('✅ ARVEXA — Mode hors ligne prêt');
})();
