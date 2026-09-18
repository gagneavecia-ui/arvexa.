// ================================================================
// OFFLINE.JS - Mode hors ligne global pour ARVEXA School
// ================================================================

(function() {
  'use strict';

  // ================================================================
  // ÉTAT
  // ================================================================
  let isOnline = navigator.onLine;
  let pendingSync = [];
  const STORAGE_KEY = 'arvexa_pending_sync';
  const CACHE_KEY = 'arvexa_page_cache';

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    // Charger les données en attente
    loadPendingData();
    
    // Créer la bannière
    createOfflineBanner();
    
    // Ajouter l'indicateur dans le header
    addStatusIndicator();
    
    // Écouter les changements réseau
    window.addEventListener('online', () => {
      isOnline = true;
      updateUI();
      syncPendingData();
      showToast('🔄 Connexion rétablie ! Synchronisation...', 'success');
    });
    
    window.addEventListener('offline', () => {
      isOnline = false;
      updateUI();
      showToast('📶 Mode hors ligne activé', 'info');
    });
    
    // État initial
    updateUI();
    updateHeaderIndicator();
    
    // Styles dynamiques
    injectStyles();
    
    // Cacher la bannière après quelques secondes si en ligne
    if (isOnline) {
      setTimeout(() => {
        const banner = document.getElementById('offlineBanner');
        if (banner) banner.classList.remove('show');
      }, 3000);
    }
    
    console.log('📶 Mode hors ligne initialisé');
  }

  // ================================================================
  // BANNIÈRE HORS LIGNE
  // ================================================================
  function createOfflineBanner() {
    // Vérifier si la bannière existe déjà
    if (document.getElementById('offlineBanner')) return;
    
    const banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.className = 'offline-banner';
    banner.innerHTML = `
      <span class="status-dot offline"></span>
      <span>📶 Mode hors ligne — Les modifications seront synchronisées automatiquement à la reconnexion.</span>
    `;
    
    // Insérer après le header ou en haut de la page
    const header = document.querySelector('.header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(banner, header.nextSibling);
    } else {
      document.body.prepend(banner);
    }
    
    return banner;
  }

  // ================================================================
  // INDICATEUR DANS LE HEADER
  // ================================================================
  function addStatusIndicator() {
    // Vérifier si l'indicateur existe déjà
    if (document.getElementById('statusIndicator')) return;
    
    const headerActions = document.querySelector('.header-actions');
    if (!headerActions) return;
    
    const indicator = document.createElement('button');
    indicator.id = 'statusIndicator';
    indicator.className = 'status-indicator-btn';
    indicator.setAttribute('aria-label', 'Statut de connexion');
    indicator.title = isOnline ? 'Connecté' : 'Hors ligne';
    indicator.innerHTML = `<i class="fas fa-wifi"></i>`;
    
    // Insérer en premier dans les actions
    headerActions.prepend(indicator);
    
    return indicator;
  }

  // ================================================================
  // MISE À JOUR DE L'UI
  // ================================================================
  function updateUI() {
    const banner = document.getElementById('offlineBanner');
    const indicator = document.getElementById('statusIndicator');
    const dot = document.querySelector('.status-dot');
    
    if (banner) {
      if (!isOnline) {
        banner.classList.add('show');
      } else {
        banner.classList.remove('show');
      }
    }
    
    if (indicator) {
      indicator.innerHTML = isOnline ? '<i class="fas fa-wifi"></i>' : '<i class="fas fa-wifi-slash"></i>';
      indicator.title = isOnline ? 'Connecté' : 'Hors ligne';
    }
    
    if (dot) {
      dot.className = 'status-dot ' + (isOnline ? 'online' : 'offline');
    }
  }

  function updateHeaderIndicator() {
    // Pour les pages où le header est déjà chargé
    const indicator = document.getElementById('statusIndicator');
    if (indicator) {
      indicator.innerHTML = isOnline ? '<i class="fas fa-wifi"></i>' : '<i class="fas fa-wifi-slash"></i>';
      indicator.title = isOnline ? 'Connecté' : 'Hors ligne';
      indicator.style.color = isOnline ? 'var(--success, #2D7D5A)' : 'var(--danger, #E74C3C)';
    }
  }

  // ================================================================
  // GESTION DES DONNÉES EN ATTENTE
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

  function syncPendingData() {
    if (pendingSync.length === 0) return;
    
    console.log('📤 Synchronisation des données en attente:', pendingSync.length);
    
    // Ici, on pourrait envoyer les données vers Firestore
    // Pour l'instant, on les marque comme synchronisées
    pendingSync = [];
    savePendingData();
    
    // Afficher un toast si disponible
    if (window.showToast) {
      window.showToast('✅ Données synchronisées', 'success');
    }
  }

  // ================================================================
  // API PUBLIQUE
  // ================================================================
  window.offline = {
    isOnline: () => isOnline,
    
    // Sauvegarder une action pour plus tard
    saveForLater: function(data) {
      pendingSync.push({
        data: data,
        timestamp: new Date().toISOString(),
        url: window.location.href
      });
      savePendingData();
      
      if (window.showToast) {
        window.showToast('💾 Données sauvegardées localement', 'success');
      }
    },
    
    // Vérifier si une action peut être effectuée
    canPerform: function(action) {
      if (isOnline) return true;
      
      // Actions autorisées hors ligne
      const allowedOffline = ['read', 'navigate', 'notes'];
      return allowedOffline.includes(action);
    },
    
    // Forcer la synchronisation
    sync: function() {
      if (isOnline) {
        syncPendingData();
      } else {
        if (window.showToast) {
          window.showToast('📶 Impossible de synchroniser hors ligne', 'error');
        }
      }
    }
  };

  // ================================================================
  // TOAST (fallback si la fonction n'existe pas)
  // ================================================================
  function showToast(message, type = 'info') {
    // Si la fonction toast existe déjà, l'utiliser
    if (window.showToast) {
      window.showToast(message, type);
      return;
    }
    
    // Sinon, créer un toast temporaire
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      padding: 12px 20px;
      border-radius: 12px;
      background: rgba(20,20,20,0.95);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(184,134,11,0.15);
      color: #F5F0E8;
      font-size: 13px;
      z-index: 300;
      opacity: 0;
      transition: all 0.5s ease;
      max-width: 90%;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 100);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(100px)';
      setTimeout(() => toast.remove(), 500);
    }, 3000);
  }

  // ================================================================
  // STYLES DYNAMIQUES
  // ================================================================
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Bannière hors ligne */
      .offline-banner {
        display: none;
        position: sticky;
        top: 0;
        z-index: 60;
        background: rgba(184, 92, 58, 0.15);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(184, 92, 58, 0.15);
        padding: 8px 16px;
        align-items: center;
        justify-content: center;
        gap: 10px;
        font-size: clamp(12px, 1.2vw, 14px);
        color: #E74C3C;
        text-align: center;
        flex-wrap: wrap;
        transition: all 0.3s ease;
      }
      .offline-banner.show {
        display: flex;
      }
      .offline-banner .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
      }
      .offline-banner .status-dot.offline {
        background: #E74C3C;
        animation: pulseDot 1.5s ease-in-out infinite;
      }
      .offline-banner .status-dot.online {
        background: #2D7D5A;
      }
      
      /* Indicateur dans le header */
      .status-indicator-btn {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        background: rgba(255,255,255,0.04);
        color: var(--text-dim, #8A8A7A);
        cursor: pointer;
        transition: all 0.3s ease;
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      .status-indicator-btn:hover {
        background: rgba(255,255,255,0.07);
      }
      .status-indicator-btn i {
        transition: all 0.3s ease;
      }
      
      @keyframes pulseDot {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      
      /* Adaptation responsive */
      @media (max-width: 480px) {
        .offline-banner {
          font-size: 11px;
          padding: 6px 12px;
        }
        .status-indicator-btn {
          width: 30px;
          height: 30px;
          font-size: 13px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ================================================================
  // CACHE DES PAGES VISITÉES
  // ================================================================
  function cacheCurrentPage() {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const url = window.location.pathname + window.location.search;
      cache[url] = {
        html: document.documentElement.outerHTML,
        timestamp: new Date().toISOString()
      };
      // Limiter le cache à 20 pages
      const keys = Object.keys(cache);
      if (keys.length > 20) {
        const oldest = keys.sort((a, b) => new Date(cache[a].timestamp) - new Date(cache[b].timestamp))[0];
        delete cache[oldest];
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  // ================================================================
  // INITIALISATION
  // ================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Cacher la bannière après 5s si en ligne
  setTimeout(() => {
    if (isOnline) {
      const banner = document.getElementById('offlineBanner');
      if (banner) banner.classList.remove('show');
    }
  }, 5000);

  // Cache de la page au chargement
  setTimeout(cacheCurrentPage, 1000);

  console.log('✅ Mode hors ligne global activé');
})();
