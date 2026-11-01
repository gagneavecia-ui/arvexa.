/* ═══════════════════════════════════════════════════════════════════
   ARVEXA SCHOOL — ARVEXA-VIVANT.JS
   ✨ BROUILLON v1.0 — CHARGEUR UNIQUE « SITE VIVANT »
   ═══════════════════════════════════════════════════════════════════
   Une SEULE ligne par page (avant </body>) :
       <script src="arvexa-vivant.js"></script>
   …qui charge ensuite le moteur de sons puis la mascotte Arvy.
   Pour TOUT retirer du site : supprimer les 3 fichiers + la ligne.
   Aucun autre fichier du site n'est nécessaire au fonctionnement.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__ARVEXA_VIVANT__) return;
  window.__ARVEXA_VIVANT__ = true;

  function load(src, next) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = function () { if (next) next(); };
    s.onerror = function () { console.warn('[Vivant] ' + src + ' indisponible'); };
    document.head.appendChild(s);
  }

  // 1. Le moteur de sons d'abord (la mascotte lit son état).
  load('arvexa-sound.js', function () {
    // 2. Puis Arvy.
    load('arvexa-mascot.js');
  });
})();
