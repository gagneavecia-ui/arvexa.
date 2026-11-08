/*! arvexa-flashcards.js — v1.0 — ARVEXA School
================================================================
FLASHCARDS PAR CHAPITRE ET PAR SECTION (v8.21 — demande propriétaire :
« dans la page résumé on va ajouter des flashcards pour chaque chapitre
et chaque section… l'utilisateur se teste directement et révise » +
« les flashcards sont générés en fonction du chapitre et de la section
dans laquelle l'utilisateur est donc dans chaque section et dans chaque
leçon complet il y aura le bouton pour générer des flashcards »).

CE QUE FAIT CE MODULE :
  1. GÉNÉRATION — un bouton 🃏 dans chapitre.html (chaque section) et dans
     lecture.html (chaque leçon terminée) appelle generate() → POST
     /api/flashcards (IA, mêmes fournisseurs que le cahier) → 8-12 cartes
     recto/verso SAUVEGARDÉES pour la section exacte où se trouve l'élève.
     Le bouton devient « Revoir » quand le paquet existe déjà (un paquet
     unique par section = coût IA maîtrisé, rien à acheter).
  2. RÉVISION — overlay de révision ARVEXA (n'importe quelle page) :
     carte recto → tap pour retourner → « Je savais ✅ » / « À revoir 🔁 ».
     Répétition espacée LEITNER : boîte 1 = +1 jour, boîte 2 = +3 jours,
     boîte 3 = +7 jours. « À revoir » retourne en boîte 1.
  3. HUB — arv-progress.html (« Résumé ») liste tous les paquets groupés
     par matière → chapitre → section, avec le nombre de cartes à revoir.

GARANTIES (alignées sur arvexa-sync.js v1.2) :
  - OFFLINE-FIRST : les paquets vivent en localStorage (« arvexa-flashcards-v1 »),
    la révision fonctionne 100 % hors ligne. La GÉNÉRATION exige le réseau
    (message honnête, jamais de faux succès).
  - ISOLATION PAR COMPTE : les données locales sont archivées par uid
    (stash) ; un changement de compte restaure LE stash du compte entrant
    ou part d'un état vide — jamais d'adoption silencieuse. Garde
    anti-course : l'uid est capturé avant chaque écriture cloud.
  - CLOUD : users/{uid}/progression/flashcards (règles Firestore v3/v4
    existantes : create/update propriétaire, champs bornés non concernés —
    AUCUN changement de règles nécessaire).
  - CLÉS DE SECTION : le format est EXACTEMENT celui des sections lues
    (readParts) « matiere_chapitre_onglet_partie » — le hub peut donc
    retittrer chaque paquet avec les vrais titres du cours.

EXPOSÉ : window.ArvexaFlashcards
================================================================ */
(function () {
  'use strict';

  var root = window;
  var VERSION = 'v1.0';
  var LS_KEY = 'arvexa-flashcards-v1';
  var STASH_PFX = 'arvexa-flashcards-stash_';

  // Limites (miroir des bornes serveur de api/flashcards.js)
  var MAX_CARDS = 20;
  var MAX_RECTO = 300;
  var MAX_VERSO = 600;
  var MAX_DECKS = 200;
  var SESSION_CAP = 30; // cartes max par session de révision

  // Leitner : délais en jours par boîte
  var BOX_DAYS = { 1: 1, 2: 3, 3: 7 };

  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyDHscOXw3rLuhV6z1Cny-bdYCumqpnG7QE",
    authDomain: "arvexa-fbf10.firebaseapp.com",
    projectId: "arvexa-fbf10",
    storageBucket: "arvexa-fbf10.firebasestorage.app",
    messagingSenderId: "920108330053",
    appId: "1:920108330053:web:f532d71cbc2c824bc7472c"
  };
  var SDK = 'https://www.gstatic.com/firebasejs/12.12.1/';

  // ── ÉTAT ────────────────────────────────────────────────
  var state = {
    uid: null, authUnsub: null, fbPromise: null,
    data: { uid: null, decks: {}, srs: {} },
    pushTimer: null, pushInFlight: false, pushQueued: false
  };

  // ── UTILITAIRES ─────────────────────────────────────────
  function lsGet(k, d) {
    try { var v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  }
  function lsSet(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function todayISO(offsetDays) {
    var d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function emit(name, detail) {
    try { root.dispatchEvent(new CustomEvent('arvexa-flashcards-' + name, { detail: detail || {} })); } catch (e) {}
  }

  // Clé de section — IDENTIQUE au format readParts (matiere_chapitre_onglet_partie)
  function deckKey(subject, chapter, tab, part) {
    return subject + '_' + chapter + '_' + (tab || 'cours') + '_' + part;
  }

  function getData() {
    if (!state.data.decks) state.data = { uid: null, decks: {}, srs: {} };
    return state.data;
  }

  function save() {
    lsSet(LS_KEY, state.data);
    schedulePush();
    emit('changed', { decks: Object.keys(state.data.decks || {}).length });
  }

  // ── STASH / ISOLATION PAR COMPTE ────────────────────────
  function stashFor(uid) {
    if (!uid) return null;
    return lsGet(STASH_PFX + uid, null);
  }
  function saveStash(uid) {
    if (!uid) return;
    lsSet(STASH_PFX + uid, state.data);
  }
  function loadDataFor(uid) {
    // ✅ v1.0.1 — 1) les données locales DÉJÀ chargées appartiennent-elles à ce
    // compte ? (cas nominal : boot() a lu localStorage avant le event auth —
    // ne jamais les écraser, sinon les paquets « disparaissent » entre deux pages)
    if (state.data && state.data.uid === uid && state.data.decks) return;
    // 2) stash local du compte entrant
    var stash = stashFor(uid);
    if (stash && stash.decks) { state.data = stash; return; }
    // 3) sinon état VIDE — jamais les données d'un autre compte
    //    (isolation stricte, même garantie qu'arvexa-sync.js v1.2)
    state.data = { uid: uid, decks: {}, srs: {} };
  }

  // ── FIREBASE (paresseux — réutilise l'app [DEFAULT] de la page) ──
  function fb() {
    if (state.fbPromise) return state.fbPromise;
    state.fbPromise = Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js')
    ]).then(function (mods) {
      var appMod = mods[0], authMod = mods[1], fsMod = mods[2];
      var app = null;
      try { app = appMod.getApps().find(function (a) { return a.name === '[DEFAULT]'; }) || null; } catch (e) {}
      if (!app) app = appMod.initializeApp(FIREBASE_CONFIG);
      var auth = authMod.getAuth(app);
      var db = fsMod.getFirestore(app);
      return { app: app, auth: auth, db: db, authMod: authMod, fsMod: fsMod };
    }).catch(function (e) {
      state.fbPromise = null;
      throw e;
    });
    return state.fbPromise;
  }

  function cloudRef(F) {
    if (!state.uid) return null;
    try { return F.fsMod.doc(F.db, 'users', state.uid, 'progression', 'flashcards'); }
    catch (e) { return null; }
  }

  // ── SYNC CLOUD (push débouncé + pull au login) ──────────
  function schedulePush() {
    if (state.pushTimer) clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(function () { push(); }, 2500);
  }

  function push() {
    if (!state.uid || state.pushInFlight) { if (state.uid) state.pushQueued = true; return Promise.resolve(false); }
    state.pushInFlight = true;
    var myUid = state.uid; // garde anti-course
    return fb().then(function (F) {
      var ref = cloudRef(F);
      if (!ref || state.uid !== myUid) return false;
      var d = getData();
      return F.fsMod.setDoc(ref, {
        decks: d.decks,
        srs: d.srs,
        syncedAtMs: Date.now(),
        updatedAt: F.fsMod.serverTimestamp()
      }, { merge: true }).then(function () {
        saveStash(myUid);
        return true;
      });
    }).catch(function () { return false; }).then(function (ok) {
      state.pushInFlight = false;
      if (state.pushQueued) { state.pushQueued = false; setTimeout(push, 800); }
      return ok;
    });
  }

  function syncDown() {
    if (!state.uid) return Promise.resolve(false);
    var myUid = state.uid;
    return fb().then(function (F) {
      var ref = cloudRef(F);
      if (!ref) return false;
      return F.fsMod.getDoc(ref).then(function (snap) {
        if (state.uid !== myUid) return false; // compte changé entre-temps
        if (!snap || !snap.exists()) { saveStash(myUid); return false; }
        var cloud = snap.data() || {};
        var cloudDecks = cloud.decks && typeof cloud.decks === 'object' ? cloud.decks : {};
        var cloudSrs = cloud.srs && typeof cloud.srs === 'object' ? cloud.srs : {};
        var local = getData();
        var localNewer = (local.updatedAtMs || 0) >= (cloud.syncedAtMs || 0);
        // Fusion prudente : paquets absents du local adoptés depuis le cloud ;
        // en cas de doublon, la version la plus récente gagne (updatedAtMs).
        var mergedDecks = Object.assign({}, cloudDecks);
        Object.keys(local.decks || {}).forEach(function (k) {
          var l = local.decks[k], c = cloudDecks[k];
          if (!c || (l.updatedAtMs || 0) >= (c.updatedAtMs || 0)) mergedDecks[k] = l;
        });
        var mergedSrs = Object.assign({}, cloudSrs);
        Object.keys(local.srs || {}).forEach(function (k) {
          var l = local.srs[k] || {}, c = cloudSrs[k] || {};
          var out = {};
          Object.keys(l).forEach(function (cid) { out[cid] = l[cid]; });
          Object.keys(c).forEach(function (cid) {
            var lv = out[cid], cv = c[cid];
            if (!lv || (cv.lastReviewedAtMs || 0) >= (lv.lastReviewedAtMs || 0)) out[cid] = cv;
          });
          mergedSrs[k] = out;
        });
        state.data = {
          uid: myUid,
          decks: mergedDecks,
          srs: mergedSrs,
          updatedAtMs: Math.max(local.updatedAtMs || 0, cloud.syncedAtMs || 0)
        };
        save();
        saveStash(myUid);
        emit('synced', {});
        return true;
      });
    }).catch(function () { return false; });
  }

  function attachAuth() {
    if (state.authUnsub) return;
    fb().then(function (F) {
      state.authUnsub = F.authMod.onAuthStateChanged(F.auth, function (user) {
        var prevUid = state.uid;
        state.uid = user ? user.uid : null;
        if (state.uid && state.uid !== prevUid) {
          if (prevUid) saveStash(prevUid);       // archive l'ancien compte
          loadDataFor(state.uid);                // stash du compte entrant ou vide
          syncDown();                            // puis le cloud complète
        } else if (!state.uid && prevUid) {
          saveStash(prevUid);
          state.data = { uid: null, decks: {}, srs: {} };
        }
      });
    }).catch(function () { /* hors ligne : tout marche en local */ });
  }

  // ── LECTURE PUBLIQUE ────────────────────────────────────
  function getDeck(key) { return getData().decks[key] || null; }
  function hasDeck(key) { return !!getDeck(key); }

  function deckSrs(key) {
    var s = getData().srs[key];
    return s && typeof s === 'object' ? s : {};
  }

  function isDue(entry) {
    if (!entry) return true; // carte jamais revue = nouvelle = à revoir maintenant
    return new Date(entry.due).getTime() <= Date.now();
  }

  function dueCards(key) {
    var deck = getDeck(key);
    if (!deck) return [];
    var srs = deckSrs(key);
    return (deck.cards || []).filter(function (c) { return isDue(srs[c.id]); });
  }

  function dueCount(key) {
    if (key) return dueCards(key).length;
    var n = 0;
    var d = getData();
    Object.keys(d.decks || {}).forEach(function (k) { n += dueCards(k).length; });
    return n;
  }

  function listDecks() {
    var d = getData();
    return Object.keys(d.decks || {}).map(function (k) {
      var deck = d.decks[k];
      return {
        key: k,
        subject: deck.subject,
        subjectLabel: deck.subjectLabel || deck.subject,
        chapterTitle: deck.chapterTitle || '',
        sectionTitle: deck.sectionTitle || '',
        cardsCount: (deck.cards || []).length,
        due: dueCards(k).length,
        updatedAtMs: deck.updatedAtMs || 0
      };
    }).sort(function (a, b) { return b.updatedAtMs - a.updatedAtMs; });
  }

  // ── GÉNÉRATION (IA via /api/flashcards) ─────────────────
  // opts = { key, subject, subjectLabel, chapterTitle, sectionTitle, content }
  function generate(opts) {
    if (!opts || !opts.key || !opts.subject || !opts.content) {
      return Promise.reject(new Error('Paramètres manquants'));
    }
    if (hasDeck(opts.key)) {
      return Promise.reject(Object.assign(new Error('Paquet déjà existant'), { code: 'EXISTS' }));
    }
    if (!navigator.onLine) {
      return Promise.reject(Object.assign(new Error('Connexion requise pour générer des flashcards'), { code: 'OFFLINE' }));
    }
    return fb().then(function (F) {
      var user = F.auth.currentUser;
      if (!user) { throw Object.assign(new Error('Connecte-toi pour générer des flashcards'), { code: 'NEED_AUTH' }); }
      return user.getIdToken().then(function (token) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 45000) : null;
        return fetch('/api/flashcards', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({
            subject: opts.subject,
            subjectLabel: opts.subjectLabel || opts.subject,
            chapterTitle: opts.chapterTitle || '',
            sectionTitle: opts.sectionTitle || '',
            content: String(opts.content).slice(0, 14000)
          }),
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (r) {
          if (timer) clearTimeout(timer);
          if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
            throw Object.assign(new Error(j.error || 'Génération impossible (' + r.status + ')'), { code: j.code || 'API_' + r.status });
          });
          return r.json();
        }).catch(function (e) {
          if (timer) clearTimeout(timer);
          throw e;
        });
      });
    }).then(function (j) {
      var cards = (j && Array.isArray(j.cards)) ? j.cards : [];
      cards = cards.slice(0, MAX_CARDS).map(function (c, i) {
        return {
          id: 'k' + i,
          recto: String(c.recto || '').slice(0, MAX_RECTO),
          verso: String(c.verso || '').slice(0, MAX_VERSO)
        };
      }).filter(function (c) { return c.recto && c.verso; });
      if (!cards.length) throw new Error('Aucune carte générée — réessaie');
      var d = getData();
      var now = Date.now();
      d.decks[opts.key] = {
        subject: opts.subject,
        subjectLabel: opts.subjectLabel || opts.subject,
        chapterTitle: opts.chapterTitle || '',
        sectionTitle: opts.sectionTitle || '',
        cards: cards,
        createdAtMs: now,
        updatedAtMs: now
      };
      d.updatedAtMs = now;
      // purge des paquets les plus anciens si le compte dépasse MAX_DECKS
      var keys = Object.keys(d.decks);
      if (keys.length > MAX_DECKS) {
        keys.sort(function (a, b) { return (d.decks[a].updatedAtMs || 0) - (d.decks[b].updatedAtMs || 0); });
        keys.slice(0, keys.length - MAX_DECKS).forEach(function (k) { delete d.decks[k]; delete d.srs[k]; });
      }
      save();
      return d.decks[opts.key];
    });
  }

  // ── RÉVISION (SRS + overlay) ────────────────────────────
  function gradeCard(key, cardId, knew) {
    var d = getData();
    var srs = d.srs[key] = d.srs[key] || {};
    var prev = srs[cardId] || { box: 1, reviews: 0 };
    var box = knew ? Math.min(3, (prev.box || 1) + 1) : 1;
    srs[cardId] = {
      box: box,
      due: todayISO(BOX_DAYS[box]),
      lastResult: knew ? 'savais' : 'revoir',
      lastReviewedAtMs: Date.now(),
      reviews: (prev.reviews || 0) + 1
    };
    save();
  }

  function deleteDeck(key) {
    var d = getData();
    delete d.decks[key];
    delete d.srs[key];
    d.updatedAtMs = Date.now();
    save();
  }

  // ── INTERFACE (styles + overlay injectés une seule fois) ──
  var CSS_INJECTED = false;
  var STYLE_ID = 'arvexa-flashcards-css';

  var CSS = ''
    + '.afc-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:var(--radius-pill,999px);'
    + 'border:1px solid var(--accent,#B8860B);background:var(--accent-dim,rgba(184,134,11,.08));color:var(--accent-bright,#E0B84A);'
    + 'font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:transform .15s,background .15s;text-decoration:none;}'
    + '.afc-btn:hover{background:var(--accent,#B8860B);color:#0A0A0A;transform:translateY(-1px);}'
    + '.afc-btn[disabled]{opacity:.55;cursor:progress;transform:none;}'
    + '.afc-btn.is-busy{opacity:.55;pointer-events:none;}'
    + '.afc-cta{display:flex;align-items:center;gap:12px;width:100%;text-align:left;margin:14px 0 4px;padding:14px 16px;'
    + 'border-radius:var(--radius,16px);border:1px solid var(--accent,#B8860B);background:var(--accent-dim,rgba(184,134,11,.08));'
    + 'color:inherit;font:inherit;cursor:pointer;transition:background .15s;}'
    + '.afc-cta:hover{background:var(--accent,#B8860B);color:#0A0A0A;}'
    + '.afc-cta i{font-size:18px;color:var(--accent-bright,#E0B84A);}'
    + '.afc-cta:hover i{color:inherit;}'
    + '.afc-cta-title{font-weight:700;font-size:14px;}'
    + '.afc-cta-sub{font-size:12px;opacity:.75;margin-top:2px;}'
    + '.afc-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;'
    + 'background:rgba(0,0,0,.75);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .2s;}'
    + '.afc-overlay.show{opacity:1;pointer-events:auto;}'
    + '.afc-modal{width:100%;max-width:480px;max-height:92vh;overflow:auto;border-radius:var(--radius-lg,20px);'
    + 'background:var(--bg-surface,#141414);border:1px solid rgba(184,134,11,.25);box-shadow:var(--shadow,0 8px 32px rgba(0,0,0,.4));'
    + 'padding:20px;color:var(--text,#F5F0E8);transform:translateY(12px);transition:transform .2s;}'
    + '.afc-overlay.show .afc-modal{transform:translateY(0);}'
    + '.afc-head{display:flex;align-items:center;gap:10px;margin-bottom:4px;}'
    + '.afc-head-title{font-weight:800;font-size:16px;flex:1;}'
    + '.afc-head-title em{color:var(--accent-bright,#E0B84A);font-style:normal;}'
    + '.afc-close{background:none;border:none;color:var(--text-dim,#8A8A7A);font-size:18px;cursor:pointer;padding:4px;}'
    + '.afc-sub{font-size:12px;color:var(--text-dim,#8A8A7A);margin-bottom:14px;}'
    + '.afc-dots{display:flex;gap:5px;margin:2px 0 14px;flex-wrap:wrap;}'
    + '.afc-dot{width:9px;height:9px;border-radius:50%;background:var(--bg-elev,#1A1A1A);border:1px solid var(--text-muted,#5A5A4A);}'
    + '.afc-dot.done{background:var(--accent,#B8860B);border-color:var(--accent,#B8860B);}'
    + '.afc-dot.knew{background:#3E9B4F;border-color:#3E9B4F;}'
    + '.afc-dot.again{background:#C0392B;border-color:#C0392B;}'
    + '.afc-scene{perspective:1200px;}'
    + '.afc-card{position:relative;width:100%;min-height:240px;cursor:pointer;transform-style:preserve-3d;'
    + 'transition:transform .45s cubic-bezier(.2,.7,.3,1);}'
    + '.afc-card.flipped{transform:rotateY(180deg);}'
    + '.afc-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;'
    + 'padding:22px;border-radius:var(--radius-lg,20px);border:1px solid rgba(184,134,11,.35);'
    + 'background:var(--bg-elev,#1A1A1A);overflow:auto;}'
    + '.afc-face.verso{transform:rotateY(180deg);background:var(--accent-dim,rgba(184,134,11,.08));}'
    + '.afc-face-label{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-bright,#E0B84A);}'
    + '.afc-face-text{font-size:17px;line-height:1.55;font-weight:600;white-space:pre-wrap;word-break:break-word;}'
    + '.afc-tap-hint{font-size:11px;color:var(--text-dim,#8A8A7A);}'
    + '.afc-actions{display:flex;gap:10px;margin-top:16px;}'
    + '.afc-actions button{flex:1;padding:12px 10px;border-radius:var(--radius,16px);font:inherit;font-size:14px;font-weight:700;'
    + 'cursor:pointer;border:1px solid transparent;transition:transform .15s;}'
    + '.afc-actions button:active{transform:scale(.97);}'
    + '.afc-btn-revoir{background:rgba(192,57,43,.12);border-color:#C0392B;color:#E07B6E;}'
    + '.afc-btn-savais{background:rgba(62,155,79,.12);border-color:#3E9B4F;color:#7BCB8B;}'
    + '.afc-btn-revoir[disabled],.afc-btn-savais[disabled]{opacity:.35;pointer-events:none;}'
    + '.afc-end{text-align:center;padding:26px 8px;}'
    + '.afc-end-big{font-size:42px;margin-bottom:10px;}'
    + '.afc-end-title{font-size:18px;font-weight:800;margin-bottom:6px;}'
    + '.afc-end-sub{font-size:13px;color:var(--text-dim,#8A8A7A);line-height:1.6;}'
    + '.afc-end-stats{display:flex;gap:10px;justify-content:center;margin:16px 0;}'
    + '.afc-end-chip{padding:8px 14px;border-radius:var(--radius-pill,999px);font-size:13px;font-weight:700;'
    + 'border:1px solid var(--text-muted,#5A5A4A);}'
    + '.afc-end-chip.knew{color:#7BCB8B;border-color:#3E9B4F;}'
    + '.afc-end-chip.again{color:#E07B6E;border-color:#C0392B;}'
    + '.afc-msg{padding:26px 8px;text-align:center;font-size:14px;line-height:1.7;color:var(--text-dim,#8A8A7A);}'
    + '.afc-spin{width:26px;height:26px;margin:0 auto 12px;border-radius:50%;border:3px solid var(--accent-dim,rgba(184,134,11,.15));'
    + 'border-top-color:var(--accent-bright,#E0B84A);animation:afc-spin .8s linear infinite;}'
    + '@keyframes afc-spin{to{transform:rotate(360deg);}}'
    + '.afc-list{display:flex;flex-direction:column;gap:8px;margin-top:8px;}'
    + '.afc-list-item{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:var(--radius-sm,10px);'
    + 'border:1px solid var(--text-muted,#5A5A4A);background:var(--bg-elev,#1A1A1A);cursor:pointer;transition:background .15s;}'
    + '.afc-list-item:hover{background:var(--accent-dim,rgba(184,134,11,.08));}'
    + '.afc-list-item .t{flex:1;font-size:13px;font-weight:600;line-height:1.4;}'
    + '.afc-list-item .t small{display:block;font-weight:500;color:var(--text-dim,#8A8A7A);font-size:11px;margin-top:2px;}'
    + '.afc-badge{min-width:26px;text-align:center;padding:3px 8px;border-radius:var(--radius-pill,999px);font-size:11px;font-weight:800;}'
    + '.afc-badge.due{background:var(--accent,#B8860B);color:#0A0A0A;}'
    + '.afc-badge.ok{background:rgba(62,155,79,.15);color:#7BCB8B;}'
    + '.afc-del{background:none;border:none;color:var(--text-dim,#8A8A7A);cursor:pointer;padding:6px;font-size:14px;}'
    + '.afc-del:hover{color:#E07B6E;}'
    + '.afc-slot{display:block;margin-top:9px;}'
    + '.afc-chip{padding:6px 12px;font-size:12px;}'
    + '.afc-cta .afc-badge{margin-left:auto;}'
    + '.afc-cta .afc-badge.ok{background:rgba(62,155,79,.15);}'
    + '.afc-cta .afc-badge.due{background:var(--accent,#B8860B);color:#0A0A0A;}';

  function injectStyles() {
    if (CSS_INJECTED) return;
    if (!document.getElementById(STYLE_ID)) {
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    CSS_INJECTED = true;
  }

  // ── OVERLAY DE RÉVISION ─────────────────────────────────
  var overlayEl = null;

  function ensureOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
    injectStyles();
    overlayEl = document.createElement('div');
    overlayEl.className = 'afc-overlay';
    overlayEl.innerHTML =
      '<div class="afc-modal" role="dialog" aria-modal="true">'
      + '<div class="afc-head"><div class="afc-head-title">🃏 <em>Flashcards</em></div>'
      + '<button class="afc-close" type="button" aria-label="Fermer"><i class="fas fa-times"></i></button></div>'
      + '<div class="afc-sub"></div>'
      + '<div class="afc-body"></div>'
      + '</div>';
    document.body.appendChild(overlayEl);
    overlayEl.querySelector('.afc-close').addEventListener('click', closeReview);
    overlayEl.addEventListener('click', function (e) { if (e.target === overlayEl) closeReview(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('show')) closeReview();
    });
    return overlayEl;
  }

  function closeReview() {
    if (overlayEl) overlayEl.classList.remove('show');
  }

  // Ouvre l'overlay sur un paquet : intro → cartes → bilan
  function review(key) {
    var deck = getDeck(key);
    if (!deck) return;
    var ov = ensureOverlay();
    var sub = ov.querySelector('.afc-sub');
    var body = ov.querySelector('.afc-body');
    var title = ov.querySelector('.afc-head-title');
    title.innerHTML = '🃏 <em>' + escapeHtml(deck.subjectLabel || deck.subject || '') + '</em>';
    sub.textContent = (deck.chapterTitle ? deck.chapterTitle + ' · ' : '') + (deck.sectionTitle || '');

    var queue = dueCards(key).slice(0, SESSION_CAP);
    if (!queue.length) {
      body.innerHTML = '<div class="afc-end">'
        + '<div class="afc-end-big">🎉</div>'
        + '<div class="afc-end-title">Rien à revoir pour l\'instant !</div>'
        + '<div class="afc-end-sub">Toutes les cartes de ce paquet sont maîtrisées.<br>Reviens demain — la répétition espacée te rappellera les cartes au bon moment.</div>'
        + '</div>';
      ov.classList.add('show');
      return;
    }

    var idx = 0, knewCount = 0, againCount = 0;
    var results = []; // 'knew' | 'again' par index
    queue.sort(function (a, b) {
      var srs = deckSrs(key);
      var da = srs[a.id] ? new Date(srs[a.id].due).getTime() : 0;
      var db = srs[b.id] ? new Date(srs[b.id].due).getTime() : 0;
      return da - db;
    });

    function dots() {
      return '<div class="afc-dots">' + queue.map(function (_, i) {
        var cls = 'afc-dot' + (i < idx ? (results[i] === 'knew' ? ' knew' : ' again') : '');
        return '<span class="' + cls + '"></span>';
      }).join('') + '</div>';
    }

    function renderCard() {
      if (idx >= queue.length) return renderEnd();
      var c = queue[idx];
      body.innerHTML = dots()
        + '<div class="afc-scene"><div class="afc-card" id="afcCard">'
        + '<div class="afc-face"><div class="afc-face-label">Question</div>'
        + '<div class="afc-face-text">' + escapeHtml(c.recto) + '</div>'
        + '<div class="afc-tap-hint">👆 Touche la carte pour voir la réponse</div></div>'
        + '<div class="afc-face verso"><div class="afc-face-label">Réponse</div>'
        + '<div class="afc-face-text">' + escapeHtml(c.verso) + '</div></div>'
        + '</div></div>'
        + '<div class="afc-actions">'
        + '<button type="button" class="afc-btn-revoir" id="afcAgain" disabled>🔁 À revoir</button>'
        + '<button type="button" class="afc-btn-savais" id="afcKnew" disabled>✅ Je savais</button>'
        + '</div>'
        + '<div class="afc-sub" style="margin-top:10px;text-align:center;">Carte ' + (idx + 1) + ' / ' + queue.length + '</div>';
      var cardEl = body.querySelector('#afcCard');
      var bAgain = body.querySelector('#afcAgain');
      var bKnew = body.querySelector('#afcKnew');
      cardEl.addEventListener('click', function () {
        cardEl.classList.add('flipped');
        bAgain.disabled = false;
        bKnew.disabled = false;
      });
      bAgain.addEventListener('click', function () { answer(false); });
      bKnew.addEventListener('click', function () { answer(true); });
    }

    function answer(knew) {
      var c = queue[idx];
      gradeCard(key, c.id, knew);
      results[idx] = knew ? 'knew' : 'again';
      if (knew) knewCount++; else againCount++;
      idx++;
      renderCard();
    }

    function renderEnd() {
      var remaining = Math.max(0, dueCount(key));
      body.innerHTML = '<div class="afc-end">'
        + '<div class="afc-end-big">' + (againCount === 0 ? '🏆' : '💪') + '</div>'
        + '<div class="afc-end-title">Session terminée !</div>'
        + '<div class="afc-end-stats">'
        + '<span class="afc-end-chip knew">✅ ' + knewCount + ' su</span>'
        + '<span class="afc-end-chip again">🔁 ' + againCount + ' à revoir</span>'
        + '</div>'
        + '<div class="afc-end-sub">'
        + (againCount > 0
          ? 'Les cartes « à revoir » reviennent <strong>demain</strong>.<br>Les cartes maîtrisées : dans 3 à 7 jours — la répétition espacée fait le travail.'
          : 'Tout est maîtrisé ! Prochaine révision de ce paquet : dans quelques jours.')
        + (remaining > 0 ? '<br><br><strong>' + remaining + '</strong> carte(s) encore dues dans ce paquet.' : '')
        + '</div>'
        + '<div class="afc-actions"><button type="button" class="afc-btn" id="afcEndClose">Fermer</button></div>'
        + '</div>';
      body.querySelector('#afcEndClose').addEventListener('click', closeReview);
    }

    renderCard();
    ov.classList.add('show');
  }

  // ── OVERLAY DE GÉNÉRATION (états : chargement / erreur) ──
  function showGenerating(chapterTitle, sectionTitle) {
    var ov = ensureOverlay();
    ov.querySelector('.afc-head-title').innerHTML = '🃏 <em>Génération…</em>';
    ov.querySelector('.afc-sub').textContent = (chapterTitle ? chapterTitle + ' · ' : '') + (sectionTitle || '');
    ov.querySelector('.afc-body').innerHTML = '<div class="afc-msg"><div class="afc-spin"></div>'
      + 'ARVEXA lit la section et crée tes flashcards…<br><small>Cela prend quelques secondes.</small></div>';
    ov.classList.add('show');
  }

  function showError(msg) {
    var ov = ensureOverlay();
    ov.querySelector('.afc-head-title').innerHTML = '🃏 <em>Oups</em>';
    ov.querySelector('.afc-body').innerHTML = '<div class="afc-msg">⚠️ ' + escapeHtml(msg)
      + '<br><br><button type="button" class="afc-btn" id="afcErrClose">Fermer</button></div>';
    ov.querySelector('#afcErrClose').addEventListener('click', closeReview);
    ov.classList.add('show');
  }

  // ── BOUTON DE GÉNÉRATION RÉUTILISABLE ───────────────────
  // options = { key, subject, subjectLabel, chapterTitle, sectionTitle, content,
  //             variant: 'btn'|'cta', labels: {add, review, busy} }
  // Renvoie l'élément bouton ; le clic génère le paquet OU ouvre la révision.
  function makeButton(options) {
    injectStyles();
    var o = options || {};
    var l = o.labels || {};
    var L = {
      add: l.add || '🃏 Générer des flashcards',
      review: l.review || '🃏 Revoir mes flashcards',
      busy: l.busy || '🃏 Génération…'
    };
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = o.variant === 'cta' ? 'afc-cta' : 'afc-btn';
    function paint() {
      btn.classList.remove('is-busy'); // fin de génération → redevient cliquable
      var exists = hasDeck(o.key);
      var due = exists ? dueCount(o.key) : 0;
      if (!exists) btn.innerHTML = L.add;
      else btn.innerHTML = L.review + ' <span class="afc-badge ' + (due ? 'due' : 'ok') + '" style="margin-left:6px;">'
        + (due ? due + ' à revoir' : 'à jour ✓') + '</span>';
    }
    paint();
    btn.addEventListener('click', function (e) {
      // ✅ v8.21 — stopPropagation : dans chapitre.html le bouton vit DANS la
      // carte cliquable de la partie (openPart) — sans ça, le clic déclenche
      // aussi la navigation vers lecture.html.
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (btn.classList.contains('is-busy')) return;
      if (hasDeck(o.key)) { review(o.key); return; }
      btn.classList.add('is-busy');
      btn.innerHTML = L.busy;
      showGenerating(o.chapterTitle, o.sectionTitle);
      var ready = (o.content != null)
        ? Promise.resolve(o.content)
        : (typeof o.contentLoader === 'function' ? o.contentLoader() : Promise.reject(new Error('Contenu indisponible')));
      ready.then(function (content) {
        return generate(Object.assign({}, o, { content: content }));
      }).then(function () {
        closeReview();
        paint();
        emit('generated', { key: o.key });
      }).catch(function (e) {
        showError(friendlyError(e));
        btn.classList.remove('is-busy');
        paint();
      });
    });
    // le bouton se repeint si les données changent (sync, génération ailleurs)
    root.addEventListener('arvexa-flashcards-changed', paint);
    return btn;
  }

  function friendlyError(e) {
    var code = e && e.code;
    if (code === 'OFFLINE') return 'Tu es hors ligne. Reconnecte-toi pour générer des flashcards — la révision, elle, marche toujours sans réseau.';
    if (code === 'NEED_AUTH') return 'Connecte-toi pour générer et garder tes flashcards sur tous tes appareils.';
    if (code === 'EXISTS') return 'Ce paquet existe déjà. Ouvre-le pour réviser.';
    return (e && e.message) ? e.message : 'Génération impossible — réessaie dans un instant.';
  }

  // ── AMORÇAGE ────────────────────────────────────────────
  function boot() {
    var local = lsGet(LS_KEY, null);
    if (local && local.decks) state.data = local;
    attachAuth();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── API PUBLIQUE ────────────────────────────────────────
  root.ArvexaFlashcards = {
    version: VERSION,
    deckKey: deckKey,
    getDeck: getDeck,
    hasDeck: hasDeck,
    dueCount: dueCount,
    dueCards: dueCards,
    listDecks: listDecks,
    generate: generate,
    review: review,
    deleteDeck: deleteDeck,
    gradeCard: gradeCard,
    makeButton: makeButton,
    closeReview: closeReview,
    MAX_CARDS: MAX_CARDS,
    SESSION_CAP: SESSION_CAP
  };

})();
