/* ═══════════════════════════════════════════════════════════════════
   ARVEXA SCHOOL — ARVEXA-VIVANT.JS
   🔊 BROUILLON v1.4 — CHARGEUR « SONS SEULS » (mascotte retirée)
   ═══════════════════════════════════════════════════════════════════
   Une SEULE ligne par page (avant </body>) :
       <script src="arvexa-vivant.js"></script>
   …qui charge maintenant UNIQUEMENT le moteur de sons arvexa-sound.js.

   ✅ Consigne propriétaire (v1.4) : « on va enlever le personnage, la
   mascotte, et laisser uniquement le son » — plus AUCUN personnage sur
   les pages (ni Élias, ni Arvy) : la mascotte ne s'affiche plus, mais
   TOUS les sons du site restent, avec de nouveaux timbres, et chacun
   est déclenché directement par les événements du site (résultats
   d'examen, révision prête, plan rafraîchi, pays confirmé, pop-up
   Premium, confirmations, retour du réseau, premier tap de la session,
   tap sur un bouton…). Page de test : sons.html

   L'ancien chargeur v1.3 chargeait la mascotte Élias (arvexa-elias.js)
   ou le hibou Arvy (?mascot=arvy → arvexa-mascot.js) : ces deux
   fichiers restent dans le dépôt mais ne sont PLUS chargés.
   Pour réafficher un personnage plus tard : rebrancher l'appel
   load('arvexa-elias.js') ci-dessous.
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

  // v1.4 — uniquement le son ; aucun personnage n'est chargé.
  load('arvexa-sound.js');

  // Réactivation de la mascotte Élias si un jour souhaitée :
  // load('arvexa-sound.js', function () { load('arvexa-elias.js'); });
})();
