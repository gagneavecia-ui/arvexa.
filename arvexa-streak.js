/* ═══════════════════════════════════════════════════════════════════
   ARVEXA SCHOOL — ARVEXA-STREAK.JS (v2 — v8.25)
   La SÉRIE 🔥 : compteur de jours d'étude consécutifs (P0 rétention
   v8.23) + SYNC CLOUD MULTI-APPAREILS (P2 v8.25).
   ─────────────────────────────────────────────────────────────────
   RÈGLE :
     • Un jour devient « actif » quand l'élève fait un vrai effort :
       ARVEXA_STREAK.mark('quotidien')  → les 4 questions du jour faites
       ARVEXA_STREAK.mark('cours')      → une partie de cours lue (lecture.html)
       ARVEXA_STREAK.mark('test')       → un « Test moi » soumis (exam.html)
     • Un seul mark par jour suffit (les appels du même jour sont idempotents).
     • 🛡️ CONGÉ (freeze) : si l'élève rate UN jour, 1 congé est consommé et
       la série continue ; 2 jours ratés d'affilée = série remise à 1.
     • Recharge : la réserve de congés (max 1) est recréditée à chaque
       multiple de 7 jours de série.
   STOCKAGE :
     • LOCAL d'abord (localStorage 'arvexa-streak-v1') — l'app marche
       toujours hors ligne, la série est locale-first.
     • CLOUD ensuite (Firestore users/{uid}/progression/streak, règle v6 :
       champs exacts {count, best, freeze, last} bornés) — au LOGIN :
         - le CLOUD plus fort que le local → adopté (reprise sur un autre
           téléphone / après un effacement du navigateur) ;
         - le LOCAL plus fort (marques faites hors ligne) → poussé.
       À chaque mark : écriture cloud différée (4 s) et silencieuse.
       Règle de fusion : le MAXIMUM des deux l'emporte, jamais d'écrasement
       brutal — un compteur de motivation ne se régresse pas.
   API : ARVEXA_STREAK.get()      → { count, best, freeze, activeToday }
         ARVEXA_STREAK.mark()     → met à jour et émet 'arvexa-streak-change'
         ARVEXA_STREAK.adoptCloud(s) → fusion cloud→local (retourne l'état)
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
    queueCloudPush();
    emit(get());
    return get();
  }

  /* ═══════════════════════════════════════════════════════════════
     SYNC CLOUD (v8.25) — Firestore users/{uid}/progression/streak
     Import dynamique du SDK modulaire (la page hôte partage son app
     [DEFAULT]) ; TOUT échec est silencieux : le local reste la source
     de vérité immédiate, le cloud n'est qu'une sauvegarde + pont
     multi-appareils. Aucune donnée personnelle : 4 compteurs.
     ═══════════════════════════════════════════════════════════════ */
  var SDK_BASE = 'https://www.gstatic.com/firebasejs/12.12.1/';
  var fbPromise = null;
  var cloudPushTimer = null;
  var cloudPullDone = false;

  function fb() {
    if (!fbPromise) {
      fbPromise = Promise.all([
        import(SDK_BASE + 'firebase-app.js'),
        import(SDK_BASE + 'firebase-auth.js'),
        import(SDK_BASE + 'firebase-firestore.js')
      ]).then(function (mods) {
        var appMod = mods[0], authMod = mods[1], fsMod = mods[2];
        var app;
        try { app = appMod.getApp(); } catch (e) { app = null; }
        if (!app) {
          try {
            app = appMod.getApps().find(function (a) { return a.options && a.options.projectId; }) || null;
          } catch (e2) { app = null; }
        }
        if (!app) return null; // page sans Firebase configuré → pas de cloud
        return { authMod: authMod, fsMod: fsMod, auth: authMod.getAuth(app), db: fsMod.getFirestore(app) };
      }).catch(function () { return null; });
    }
    return fbPromise;
  }

  function sanitizeState(s) {
    var clean = load() || { last: '', count: 0, best: 0, freeze: 1 };
    if (s && typeof s === 'object') {
      if (typeof s.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.last)) clean.last = s.last;
      if (typeof s.count === 'number' && isFinite(s.count) && s.count >= 0) clean.count = Math.min(730, Math.floor(s.count));
      if (typeof s.best === 'number' && isFinite(s.best) && s.best >= 0) clean.best = Math.min(730, Math.floor(s.best));
      if (typeof s.freeze === 'number' && isFinite(s.freeze)) clean.freeze = Math.min(1, Math.max(0, Math.floor(s.freeze)));
    }
    if (clean.count > clean.best) clean.best = clean.count;
    return clean;
  }

  /* Fusion cloud → local : le maximum l'emporte (jamais de régression).
     Le cloud n'est adopté que si sa série est plus forte ET vivante. */
  function adoptCloud(cloud) {
    if (!cloud || typeof cloud !== 'object') return get();
    var local = load() || { last: '', count: 0, best: 0, freeze: 1 };
    var cCount = Math.min(730, Math.max(0, Math.floor(Number(cloud.count) || 0)));
    var cBest = Math.min(730, Math.max(0, Math.floor(Number(cloud.best) || 0)));
    var cFreeze = Math.min(1, Math.max(0, Math.floor(Number(cloud.freeze))));
    var cLast = (typeof cloud.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cloud.last)) ? cloud.last : '';
    if (cCount <= local.count) return get(); // local déjà aussi fort → rien
    var merged = {
      last: cLast || local.last,
      count: cCount,
      best: Math.max(cBest, cCount, local.best),
      freeze: cFreeze
    };
    save(merged);
    emit(get());
    return get();
  }

  function pushCloud() {
    fb().then(function (r) {
      if (!r) return;
      r.authMod.onAuthStateChanged(r.auth, function (user) {
        if (!user) return;
        var s = load();
        if (!s) return;
        var ref = r.fsMod.doc(r.db, 'users', user.uid, 'progression', 'streak');
        r.fsMod.setDoc(ref, {
          count: Math.min(730, Math.max(0, Math.floor(s.count || 0))),
          best: Math.min(730, Math.max(0, Math.floor(s.best || 0))),
          freeze: Math.min(1, Math.max(0, Math.floor(s.freeze === undefined ? 1 : s.freeze))),
          last: /^\d{4}-\d{2}-\d{2}$/.test(s.last || '') ? s.last : ''
        }, { merge: true }).catch(function () { /* hors ligne : retenté au prochain mark */ });
      });
    }).catch(function () { });
  }

  function queueCloudPush() {
    if (cloudPushTimer) clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(pushCloud, 4000); // différé : jamais dans le chemin critique
  }

  function pullCloud() {
    if (cloudPullDone) return;
    cloudPullDone = true;
    fb().then(function (r) {
      if (!r) return;
      r.authMod.onAuthStateChanged(r.auth, function (user) {
        if (!user) return;
        var ref = r.fsMod.doc(r.db, 'users', user.uid, 'progression', 'streak');
        r.fsMod.getDoc(ref).then(function (snap) {
          if (!snap.exists) { pushCloud(); return; } // premier envoi
          adoptCloud(snap.data());
        }).catch(function () { /* hors ligne : local inchangé */ });
      });
    }).catch(function () { });
  }

  window.ARVEXA_STREAK = { get: get, mark: mark, adoptCloud: adoptCloud };
  console.log('🔥 ARVEXA — module Série chargé (arvexa-streak.js v2, cloud multi-appareils)');

  // Tissage : au repos (après chargement), on récupère la série du compte.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(pullCloud, 1200); });
  } else {
    setTimeout(pullCloud, 1200);
  }
  // Multi-onglets : une marque dans un autre onglet re-déclenche la synchro.
  window.addEventListener('storage', function (e) {
    if (e && e.key === KEY) { emit(get()); queueCloudPush(); }
  });
})();
