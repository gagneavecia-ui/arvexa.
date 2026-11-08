/* ═══════════════════════════════════════════════════════════════════
   ARVEXA SCHOOL — ARVEXA-STREAK.JS (v1 — v8.23)
   La SÉRIE 🔥 : compteur de jours d'étude consécutifs (demande P0 du
   propriétaire, audit 09/11/2026 : « construire Question du Jour + Série »).
   ─────────────────────────────────────────────────────────────────
   RÈGLE (v1) :
     • Un jour devient « actif » quand l'élève fait un vrai effort :
       ARVEXA_STREAK.mark('quotidien')  → les 4 questions du jour faites
       ARVEXA_STREAK.mark('cours')      → une partie de cours lue (lecture.html)
       ARVEXA_STREAK.mark('test')       → un « Test moi » soumis (exam.html)
     • Un seul mark par jour suffit (les appels du même jour sont idempotents).
     • 🛡️ CONGÉ (freeze) : si l'élève rate UN jour, 1 congé est consommé et
       la série continue ; 2 jours ratés d'affilée = série remise à 1.
     • Recharge : la réserve de congés (max 1) est recréditée à chaque
       multiple de 7 jours de série.
   STOCKAGE : localStorage 'arvexa-streak-v1' — LOCAL À L'APPAREIL pour
   cette version (la synchronisation du compte viendra plus tard ; aucune
   donnée personnelle n'est en jeu, juste un compteur de motivation).
   API : ARVEXA_STREAK.get()  → { count, best, freeze, activeToday }
         ARVEXA_STREAK.mark() → met à jour et émet 'arvexa-streak-change'.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'arvexa-streak-v1';
  var DAY_MS = 86400000;

  function dayKey(d) {
    var dt = (d instanceof Date) ? d : new Date();
    var m = String(dt.getMonth() + 1).padStart(2, '0');
    var j = String(dt.getDate()).padStart(2, '0');
    return dt.getFullYear() + '-' + m + '-' + j;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return null;
      return {
        last: (typeof s.last === 'string') ? s.last : '',
        count: (typeof s.count === 'number' && isFinite(s.count) && s.count >= 0) ? Math.floor(s.count) : 0,
        best: (typeof s.best === 'number' && isFinite(s.best) && s.best >= 0) ? Math.floor(s.best) : 0,
        freeze: (typeof s.freeze === 'number' && isFinite(s.freeze)) ? Math.min(1, Math.max(0, Math.floor(s.freeze))) : 1
      };
    } catch (e) { return null; }
  }

  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* quota — tant pis */ }
  }

  function emit(state) {
    try {
      window.dispatchEvent(new CustomEvent('arvexa-streak-change', { detail: state }));
    } catch (e) { /* vieux navigateurs */ }
  }

  /* ── État courant (lecture pure, sans écriture) ─────────────────── */
  function get() {
    var s = load();
    var today = dayKey();
    if (!s) return { count: 0, best: 0, freeze: 1, activeToday: false };
    return {
      count: s.count || 0,
      best: s.best || 0,
      freeze: (typeof s.freeze === 'number') ? s.freeze : 1,
      activeToday: s.last === today
    };
  }

  /* ── Marquer l'activité du jour (idempotent) ────────────────────── */
  function mark() {
    var today = dayKey();
    var s = load();
    if (!s) s = { last: '', count: 0, best: 0, freeze: 1 };

    if (s.last === today) {
      emit(get());
      return get(); // déjà actif aujourd'hui — rien à changer
    }

    var hier = dayKey(new Date(Date.now() - DAY_MS));
    var avantHier = dayKey(new Date(Date.now() - 2 * DAY_MS));

    if (s.last === hier) {
      s.count += 1;
    } else if (s.last === avantHier && s.freeze > 0) {
      s.freeze -= 1; // 🛡️ congé consommé : le jour manqué est pardonné
      s.count += 1;
    } else {
      s.count = 1;   // rupture (ou premier jour)
    }

    // Recharge hebdomadaire du congé (max 1 en réserve)
    if (s.count > 0 && s.count % 7 === 0) s.freeze = 1;

    s.last = today;
    if (s.count > s.best) s.best = s.count;
    save(s);
    emit(get());
    return get();
  }

  window.ARVEXA_STREAK = { get: get, mark: mark };
  console.log('🔥 ARVEXA — module Série chargé (arvexa-streak.js v1)');
})();
