/* ================================================================
   arvexa-native.js — COQUILLE NATIVE ANDROID — ARVEXA School
   Version : 1.0.0
   Rôle :
     - S'active UNIQUEMENT quand la page tourne dans l'app Android
       (Capacitor). Sur le web (Vercel), ce fichier ne fait RIEN :
       la version web initiale reste 100 % inchangée.
     - 1. Shims d'appels API : /api/* est servi par les fonctions
       serverless Vercel (IA, examens, progressions, paiements…).
       Dans la WebView (origine https://localhost), les appels
       relatifs ne peuvent pas joindre Vercel et l'absence d'en-têtes
       CORS bloquerait les appels absolus → les appels /api/* sont
       routés via CapacitorHttp (HTTP natif, insensible au CORS).
     - 2. Désactivation propre du Service Worker (inutile et contre-
       productif dans l'app : les ressources sont locales).
     - 3. Barre de navigation basse persistante à 5 onglets
       (Accueil, Réviser, Arv Progress, Arv-Assistant, Profil) avec
       la palette « Cinematic Luxury Academic Technology ».
     - 4. Barre de statut synchronisée avec le thème sombre/clair.
     - 5. Bouton Retour Android (pile WebView, sortie sur l'accueil).
     - 6. Liens externes (paiement SasPay, etc.) → navigateur système.
   ================================================================ */
(function () {
  'use strict';

  /* ── Détection de la plateforme native ───────────────────────── */
  var isNative = false;
  try {
    isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  } catch (e) { isNative = false; }

  if (!isNative) return; // ← Version web : aucun changement de comportement.

  window.ARVEXA_NATIVE = true;

  var API_BASE = 'https://arvexaschool.vercel.app';
  var Plugins = window.Capacitor.Plugins || {};
  var capHttp = Plugins.CapacitorHttp || null;
  var appPlugin = Plugins.App || null;
  var statusBar = Plugins.StatusBar || null;
  var splash = Plugins.SplashScreen || null;

  /* ══ 1. SHIM FETCH : /api/* → HTTP natif CapacitorHttp ═════════ */
  if (capHttp && typeof window.fetch === 'function') {
    var origFetch = window.fetch.bind(window);

    function headersToObject(headers) {
      var obj = {};
      if (!headers) return obj;
      if (typeof Headers === 'function' && headers instanceof Headers) {
        headers.forEach(function (v, k) { obj[k] = v; });
      } else if (Array.isArray(headers)) {
        headers.forEach(function (h) { if (h && h.length) obj[h[0]] = h[1]; });
      } else {
        try { for (var k in headers) obj[k] = headers[k]; } catch (e) {}
      }
      return obj;
    }

    window.fetch = function (input, init) {
      var url = '';
      try {
        url = (typeof input === 'string') ? input : (input && input.url) || '';
        var idx = url.indexOf('/api/');
        var isApi = idx === 0 || (url.indexOf('./api/') === 0) ||
                    (url.indexOf('://') === -1 && idx > 0 && url.slice(0, idx).indexOf('/') === -1);
        if (!isApi) return origFetch(input, init);

        var path = url.slice(idx);
        var method = String((init && init.method) || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
        var absUrl = API_BASE + path;
        var headers = headersToObject(init && init.headers);

        /* Corps : JSON parsé (sérialisation fiable par CapacitorHttp) */
        var data;
        var body = (init && init.body) || (typeof input === 'object' && input && input.body) || null;
        if (body) {
          if (typeof body === 'string') {
            var ct = String(headers['Content-Type'] || headers['content-type'] || '').toLowerCase();
            if (ct.indexOf('json') >= 0) { try { data = JSON.parse(body); } catch (e) { data = body; } }
            else data = body;
          } else if (typeof URLSearchParams === 'function' && body instanceof URLSearchParams) {
            data = body.toString();
          } else {
            data = body;
          }
        }

        return capHttp.request({
          url: absUrl,
          method: method,
          headers: headers,
          data: data
        }).then(function (res) {
          var status = res.status || 200;
          var raw = res.data;
          var text = (typeof raw === 'string') ? raw : (function () { try { return JSON.stringify(raw); } catch (e) { return String(raw); } })();
          var ct2 = (res.headers && (res.headers['content-type'] || res.headers['Content-Type'])) || 'application/json';
          try {
            return new Response(text, { status: status, headers: { 'content-type': ct2 } });
          } catch (e) {
            /* Filet : Response indisponible → réponse minimale compatible .json() */
            return {
              ok: status >= 200 && status < 300,
              status: status,
              headers: { get: function () { return ct2; } },
              json: function () { return Promise.resolve(typeof raw === 'string' ? JSON.parse(raw) : raw); },
              text: function () { return Promise.resolve(text); }
            };
          }
        }, function (err) {
          /* Erreur réseau native → mimétique d'un échec fetch */
          throw err;
        });
      } catch (e) {
        console.warn('[ARVEXA-NATIVE] shim fetch /api :', e);
        return origFetch(input, init);
      }
    };
    console.log('[ARVEXA-NATIVE] Shim /api/* actif → ' + API_BASE);
  }

  /* ══ 2. SERVICE WORKER : neutralisé dans l'app ══════════════════ */
  try {
    if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new Error('[ARVEXA-NATIVE] Service Worker désactivé (ressources locales)'));
      };
    }
  } catch (e) {}

  /* ══ 3. BARRE DE NAVIGATION BASSE — 5 ONGLETS ═══════════════════ */
  var NO_NAV_PAGES = [
    'login.html', 'register.html', 'auth-choice.html', 'forgot-password.html',
    'onboarding.html', 'whatsapp.html', 'diagnostic.html', 'demo.html',
    'offline.html', '404.html', 'conditions.html', 'confidentialite.html'
  ];

  var TABS = [
    { file: 'index.html',        icon: 'fa-house',          label: 'Accueil' },
    { file: 'parcours.html',     icon: 'fa-book-open',      label: 'Réviser' },
    { file: 'arv-progress.html', icon: 'fa-chart-line',     label: 'Arv Progress' },
    { file: 'arv.html',          icon: 'fa-robot',          label: 'Assistant' },
    { file: 'profil.html',       icon: 'fa-user',           label: 'Profil' }
  ];

  function currentFile() {
    var p = (location.pathname || '').split('/').pop();
    if (!p || p === '' ) p = 'index.html';
    return p.toLowerCase();
  }

  function buildNav() {
    if (document.getElementById('arvx-nav')) return;
    var page = currentFile();
    if (NO_NAV_PAGES.indexOf(page) !== -1) return;

    var nav = document.createElement('nav');
    nav.className = 'arvx-nav';
    nav.id = 'arvx-nav';
    nav.setAttribute('aria-label', 'Navigation principale');

    var html = '';
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      var active = (page === t.file) ? ' arvx-tab-active' : '';
      html += '<a href="' + t.file + '" class="arvx-tab' + active + '" data-file="' + t.file + '"' +
              (active ? ' aria-current="page"' : '') + '>' +
              '<span class="arvx-tab-ico"><i class="fas ' + t.icon + '" aria-hidden="true"></i></span>' +
              '<span class="arvx-tab-label">' + t.label + '</span></a>';
    }
    nav.innerHTML = html;
    document.body.appendChild(nav);
    document.body.classList.add('arvx-has-nav');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildNav);
  } else {
    buildNav();
  }

  /* ══ 4. BARRE DE STATUT synchronisée au thème ═══════════════════ */
  function applyStatusBar() {
    if (!statusBar) return;
    var light = false;
    try { light = document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) {}
    try {
      statusBar.setBackgroundColor({ color: light ? '#F5F0E8' : '#0A0A0A' });
      statusBar.setStyle({ style: light ? 'LIGHT' : 'DARK' });
      if (statusBar.setOverlaysWebView) statusBar.setOverlaysWebView({ overlay: false });
    } catch (e) {
      console.warn('[ARVEXA-NATIVE] statusbar:', e);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyStatusBar);
  } else {
    applyStatusBar();
  }
  /* Suit les changements de thème (theme.js bascule data-theme) */
  try {
    var mo = new MutationObserver(function () { applyStatusBar(); });
    if (document.documentElement) {
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  } catch (e) {}

  /* ══ 5. BOUTON RETOUR ANDROID ═══════════════════════════════════ */
  try {
    if (appPlugin && appPlugin.addListener) {
      appPlugin.addListener('backButton', function (data) {
        var canGoBack = !!(data && data.canGoBack);
        if (canGoBack) {
          window.history.back();
        } else {
          /* Sur la racine : quitter proprement (ergonomie Android) */
          appPlugin.exitApp();
        }
      });
    }
  } catch (e) {}

  /* ══ 6. LIENS EXTERNES → navigateur système ═════════════════════ */
  try {
    var origOpen = window.open;
    window.open = function (url, target) {
      try {
        if (url && /^https?:\/\//i.test(String(url)) &&
            String(url).indexOf('localhost') === -1) {
          if (appPlugin && appPlugin.openUrl) {
            appPlugin.openUrl({ url: String(url) });
            return null;
          }
        }
      } catch (e) {}
      return origOpen.apply(window, arguments);
    };
  } catch (e) {}

  /* ══ 7. SPLASH : sécurité de masquage ═══════════════════════════ */
  try {
    window.addEventListener('load', function () {
      if (splash && splash.hide) { setTimeout(function () { splash.hide().catch(function () {}); }, 150); }
    });
  } catch (e) {}

  /* ══ 8. CLAVIER : remontée des champs de saisie ═════════════════ */
  try {
    var kb = Plugins.Keyboard;
    if (kb && kb.setResizeMode) kb.setResizeMode({ mode: 'resize' });
  } catch (e) {}

  console.log('[ARVEXA-NATIVE] Coquille Android active v1.0.0');
})();
