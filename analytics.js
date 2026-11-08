// ================================================================
// ANALYTICS — ARVEXA School v4.1 (ultra-robuste, page-safe, universel, anti-perte persistante)
// Ne bloque JAMAIS la page. Toutes les erreurs sont silencieuses.
//
// v4 (2026-11-05) — fin du « l'analytique ne marche pas chez moi » :
//  1. TOUT LE MONDE est suivi, y compris le compte propriétaire/admin
//     (avant : exclu → quand le propriétaire testait, RIEN ne s'écrivait
//     et la page admin affichait des zéros → fausse panne). Les vues
//     « élèves uniquement » restent possibles côté console admin.
//  2. PREMIER FLUSH À 8 s (avant 30 s) : une visite test courte écrit
//     quand même ses données avant la fermeture.
//  3. Écoute de `pagehide` (fiable sur mobile) en plus de beforeunload
//     et visibilitychange.
//  4. FLUSH SANS PERTE : le snapshot est remis dans la file si l'import
//     Firebase ou l'écriture échoue (réseau coupé…) — rien n'est perdu,
//     nouvelle tentative au prochain tick / retour du réseau.
//  5. SECOURS REST : sur les réseaux qui cassent le canal WebChannel du
//     SDK Firestore (« WebChannelConnection RPC 'Write' stream transport
//     errored » — observé sur connexions mobiles/proxy, la cause réelle
//     du « l'analytique ne marche pas chez moi » après la réparation des
//     règles), l'écriture repart par l'API REST HTTPS simple
//     (lecture-modification-écriture, mêmes règles Firestore).
// ================================================================

(function () {
  'use strict';

  // ⚡ Protection : si déjà initialisé, on sort
  if (window.__arvexaAnalyticsInit) return;
  window.__arvexaAnalyticsInit = true;

  // ✅ PRIV — mécanisme d'opt-out conforme à la politique de confidentialité :
  // l'élève peut désactiver la télémétrie locale à tout moment :
  //   localStorage.setItem('arvexa_analytics_optout', '1')
  // (aucune donnée n'est collectée ni envoyée tant que ce drapeau est présent)
  try {
    if (localStorage.getItem('arvexa_analytics_optout') === '1'
        || navigator.doNotTrack === '1') {
      console.info('[Analytics] Collecte désactivée (opt-out).');
      return;
    }
  } catch (e) {}

  // ⚡ Protection globale : n'importe quelle erreur ici ne doit pas
  //    affecter la page
  try {

    // ─────────────────────────────────────────────────────────────
    // CONFIG
    // ─────────────────────────────────────────────────────────────
    const FIREBASE_CONFIG = {
      apiKey: "AIzaSyDHscOXw3rLuhV6z1Cny-bdYCumqpnG7QE",
      authDomain: "arvexa-fbf10.firebaseapp.com",
      projectId: "arvexa-fbf10",
      storageBucket: "arvexa-fbf10.firebasestorage.app",
      messagingSenderId: "920108330053",
      appId: "1:920108330053:web:f532d71cbc2c824bc7472c"
    };

    const START_DELAY = 3000;        // démarrer 3s après le chargement
    const FIRST_FLUSH_DELAY = 8000;  // ⚡ v4 : premier flush 8s après le début du suivi
    const FLUSH_INTERVAL = 30000;    // flush toutes les 30s
    const SESSION_TIMEOUT = 30 * 60 * 1000;
    const SESSION_KEY = 'arvexa_analytics_session';
    const LAST_ACTIVE_KEY = 'arvexa_analytics_last_active';
    // ⚡ v4.1 — queue PERSISTÉE : si l'écriture échoue ET que l'onglet meurt,
    // les compteurs survivent et repartent à la prochaine visite (zéro perte).
    const QUEUE_KEY = 'arvexa_analytics_queue_v4';

    // ─────────────────────────────────────────────────────────────
    // ÉTAT
    // ─────────────────────────────────────────────────────────────
    let firebase = null;
    let auth = null;
    let db = null;
    let currentUid = null;
    let queue = null;
    let flushTimer = null;
    let firstFlushTimer = null;
    let pageEntryTime = Date.now();
    let currentSessionId = null;
    let isFlushing = false;
    let isStarted = false;

    // ─────────────────────────────────────────────────────────────
    // UTILITAIRES
    // ─────────────────────────────────────────────────────────────
    const now = () => Date.now();

    const getDeviceType = () => {
      try {
        const w = window.innerWidth;
        if (w < 768) return 'mobile';
        if (w < 1024) return 'tablet';
        return 'desktop';
      } catch (e) { return 'unknown'; }
    };

    const getTimeOfDay = () => {
      try {
        const h = new Date().getHours();
        if (h < 6) return 'nuit';
        if (h < 12) return 'matin';
        if (h < 18) return 'apresmidi';
        if (h < 22) return 'soir';
        return 'nuit';
      } catch (e) { return 'matin'; }
    };

    const getDayOfWeek = () => {
      try {
        const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
        return days[new Date().getDay()];
      } catch (e) { return 'lundi'; }
    };

    const getTodayKey = () => {
      try { return new Date().toISOString().slice(0, 10); }
      catch (e) { return '2026-01-01'; }
    };

    const cleanKey = (s) => {
      try { return String(s || '').replace(/[.\/\s#?=&]/g, '_').slice(0, 60); }
      catch (e) { return 'unknown'; }
    };

    const detectPage = () => {
      try {
        const path = window.location.pathname
          .replace(/^\//, '')
          .replace(/\.html$/, '')
          .replace(/\/$/, '');
        return cleanKey(path || 'index');
      } catch (e) { return 'index'; }
    };

    const detectSubject = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        return {
          subject: params.get('subject') || null,
          chapter: params.get('chapter') || null,
          tab: params.get('tab') || null
        };
      } catch (e) {
        return { subject: null, chapter: null, tab: null };
      }
    };

    // ─────────────────────────────────────────────────────────────
    // QUEUE
    // ─────────────────────────────────────────────────────────────
    function resetQueue() {
      queue = {
        date: getTodayKey(),
        pages: {},
        features: {},
        byTimeOfDay: {},
        byDayOfWeek: {},
        contents: {},
        results: [],
        totalTime: 0,
        sessions: 0,
        device: getDeviceType()
      };
    }

    // ─────────────────────────────────────────────────────────────
    // ⚡ v4.1 — PERSISTANCE DE LA QUEUE (localStorage)
    // ─────────────────────────────────────────────────────────────
    function saveQueue() {
      try { if (queue) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) {}
    }
    function clearSavedQueue() {
      try { localStorage.removeItem(QUEUE_KEY); } catch (e) {}
    }
    function loadPersistedQueue() {
      try {
        const raw = localStorage.getItem(QUEUE_KEY);
        if (!raw) return null;
        const q = JSON.parse(raw);
        if (!q || typeof q !== 'object' || !q.date) return null;
        return q;
      } catch (e) { return null; }
    }
    function hasQueueData(q) {
      try {
        return !!q && (
          (q.totalTime || 0) > 0 ||
          Object.keys(q.pages || {}).length > 0 ||
          Object.keys(q.features || {}).length > 0 ||
          Object.keys(q.contents || {}).length > 0 ||
          (q.results || []).length > 0 ||
          (q.sessions || 0) > 0
        );
      } catch (e) { return false; }
    }

    // ─────────────────────────────────────────────────────────────
    // SESSION
    // ─────────────────────────────────────────────────────────────
    function initSession() {
      try {
        const last = parseInt(localStorage.getItem(LAST_ACTIVE_KEY) || '0', 10);
        const existing = localStorage.getItem(SESSION_KEY);

        if (!existing || (now() - last) > SESSION_TIMEOUT) {
          currentSessionId = 'sess_' + now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          localStorage.setItem(SESSION_KEY, currentSessionId);
          if (queue) queue.sessions++;
        } else {
          currentSessionId = existing;
        }
        localStorage.setItem(LAST_ACTIVE_KEY, String(now()));
      } catch (e) {
        currentSessionId = 'sess_' + now();
      }
    }

    // ─────────────────────────────────────────────────────────────
    // TRACKERS
    // ─────────────────────────────────────────────────────────────
    function trackPageView() {
      try {
        if (!queue) resetQueue();
        const page = detectPage();
        queue.pages[page] = (queue.pages[page] || 0) + 1;
        saveQueue();
      } catch (e) {}
    }

    function trackTimeSpent() {
      try {
        if (!queue) resetQueue();
        const duration = Math.round((now() - pageEntryTime) / 1000);
        if (duration > 2 && duration < 3600) {
          queue.totalTime += duration;
          const tod = getTimeOfDay();
          const dow = getDayOfWeek();
          queue.byTimeOfDay[tod] = (queue.byTimeOfDay[tod] || 0) + duration;
          queue.byDayOfWeek[dow] = (queue.byDayOfWeek[dow] || 0) + duration;
        }
        pageEntryTime = now();
        saveQueue();
      } catch (e) {}
    }

    function trackAutoFeature() {
      try {
        if (!queue) resetQueue();
        const page = detectPage();

        // ⚡ v4.1 — carte COMPLÈTE des pages du site (l'ancienne oubliait
        // accueil, mathmind, outils, whatsapp, sons, diagnostic, historiques,
        // ARV-PILOT (page réelle = « arv »)… → leur usage n'apparaissait nulle part)
        const featureMap = {
          '': 'accueil',
          index: 'accueil',
          calculatrice: 'calculatrice',
          formulaires: 'formulaire',
          'tableau-periodique': 'tableau_periodique',
          exam: 'mode_examen',
          'exam-history': 'exam_history',
          arv: 'arv_pilot',
          'arv-progress': 'arv_progress',
          quotidien: 'question_du_jour',
          classement: 'classement',
          'ma-journee': 'ma_journee',
          demo: 'demo_quiz',
          planificateur: 'planificateur',
          abonnement: 'abonnement',
          profil: 'profil',
          notifications: 'notifications',
          lecture: 'lecture',
          chapitre: 'chapitre',
          matiere: 'matiere',
          mathmind: 'mathmind',
          outils: 'outils',
          whatsapp: 'whatsapp',
          sons: 'sons',
          diagnostic: 'diagnostic',
          onboarding: 'onboarding',
          'auth-choice': 'auth_choice'
        };

        const feature = featureMap[page];
        if (feature) {
          queue.features[feature] = (queue.features[feature] || 0) + 1;
        }
      } catch (e) {}
    }

    function trackContent() {
      try {
        if (!queue) resetQueue();
        const info = detectSubject();
        if (info.subject) {
          const key = 'subject_' + cleanKey(info.subject);
          queue.contents[key] = (queue.contents[key] || 0) + 1;
          // ⚡ v4.1 — chapitre PRÉCIS (pour savoir ce que l'élève a le plus aimé)
          if (info.chapter) {
            const ck = 'chapter_' + cleanKey(info.subject) + '_' + cleanKey(info.chapter);
            queue.contents[ck] = (queue.contents[ck] || 0) + 1;
          }
          saveQueue();
        }
      } catch (e) {}
    }

    // ─────────────────────────────────────────────────────────────
    // FLUSH (v4 : sans perte — le snapshot revient dans la file si
    // l'import ou l'écriture échoue)
    // ─────────────────────────────────────────────────────────────
    function mergeSnapshotBack(snapshot) {
      // Rien n'a pu partir → on remet les compteurs dans la file
      // pour une nouvelle tentative au prochain flush.
      try {
        if (!queue) resetQueue();
        queue.date = snapshot.date || queue.date;
        Object.entries(snapshot.pages || {}).forEach(([k, v]) => {
          queue.pages[k] = (queue.pages[k] || 0) + v;
        });
        Object.entries(snapshot.features || {}).forEach(([k, v]) => {
          queue.features[k] = (queue.features[k] || 0) + v;
        });
        Object.entries(snapshot.byTimeOfDay || {}).forEach(([k, v]) => {
          queue.byTimeOfDay[k] = (queue.byTimeOfDay[k] || 0) + v;
        });
        Object.entries(snapshot.byDayOfWeek || {}).forEach(([k, v]) => {
          queue.byDayOfWeek[k] = (queue.byDayOfWeek[k] || 0) + v;
        });
        Object.entries(snapshot.contents || {}).forEach(([k, v]) => {
          queue.contents[k] = (queue.contents[k] || 0) + v;
        });
        queue.totalTime += snapshot.totalTime || 0;
        queue.sessions += snapshot.sessions || 0;
        if (snapshot.results && snapshot.results.length) {
          queue.results = queue.results.concat(snapshot.results).slice(-50);
        }
        saveQueue(); // ⚡ v4.1 — la queue en attente survit à une fermeture d'onglet
      } catch (e) {}
    }

    async function flush() {
      try {
        if (isFlushing || !queue || !currentUid || !db) return;

        const hasData =
          queue.totalTime > 0 ||
          Object.keys(queue.pages).length > 0 ||
          Object.keys(queue.features).length > 0 ||
          Object.keys(queue.contents).length > 0 ||
          queue.results.length > 0;
        if (!hasData) return;

        isFlushing = true;

        const snapshot = JSON.parse(JSON.stringify(queue));
        const currentDate = snapshot.date;
        resetQueue();

        // Import dynamique (silencieux en cas d'échec)
        let doc, setDoc, addDoc, collection, serverTimestamp, increment;
        try {
          const fsMod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js');
          doc = fsMod.doc;
          setDoc = fsMod.setDoc;
          addDoc = fsMod.addDoc;
          collection = fsMod.collection;
          serverTimestamp = fsMod.serverTimestamp;
          increment = fsMod.increment;
        } catch (e) {
          mergeSnapshotBack(snapshot); // ⚡ v4 : rien n'est perdu
          isFlushing = false;
          return;
        }

        const aggRef = doc(db, 'users', currentUid, 'analytics_daily', currentDate);

        const updates = {
          date: currentDate,
          device: snapshot.device,
          lastSeenAt: serverTimestamp()
        };

        Object.entries(snapshot.pages).forEach(([k, v]) => {
          updates[`pages.${k}`] = increment(v);
        });
        Object.entries(snapshot.features).forEach(([k, v]) => {
          updates[`features.${k}`] = increment(v);
        });
        Object.entries(snapshot.byTimeOfDay).forEach(([k, v]) => {
          updates[`byTimeOfDay.${k}`] = increment(v);
        });
        Object.entries(snapshot.byDayOfWeek).forEach(([k, v]) => {
          updates[`byDayOfWeek.${k}`] = increment(v);
        });
        Object.entries(snapshot.contents).forEach(([k, v]) => {
          updates[`contents.${k}`] = increment(v);
        });

        if (snapshot.totalTime > 0) updates.totalTime = increment(snapshot.totalTime);
        if (snapshot.sessions > 0) updates.sessions = increment(snapshot.sessions);

        if (snapshot.results.length > 0) {
          const resultsRef = collection(db, 'users', currentUid, 'analytics_daily', currentDate, 'results');
          await Promise.all(
            snapshot.results.map((r) =>
              addDoc(resultsRef, { ...r, createdAt: serverTimestamp() }).catch(() => {})
            )
          );
          updates.resultsCount = increment(snapshot.results.length);
        }

        // ⚡ v4 — COURANT PRINCIPAL : SDK Firestore (rapide, hors ligne OK).
        // Si le canal WebChannel du SDK plante (réseaux mobiles/proxies :
        // « WebChannelConnection RPC 'Write' stream transport errored »)
        // ou dépasse 9 s → SECOURS REST (HTTPS simple, sans WebChannel,
        // lecture-modification-écriture, mêmes règles Firestore).
        let sdkOk = false;
        try {
          await Promise.race([
            setDoc(aggRef, updates, { merge: true }).then(() => { sdkOk = true; }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('sdk_timeout')), 9000))
          ]);
        } catch (sdkErr) {
          console.warn('[Analytics] SDK write KO → secours REST :', (sdkErr && sdkErr.message) || sdkErr);
        }

        if (!sdkOk) {
          try {
            await restWrite(snapshot);
            clearSavedQueue(); // ⚡ v4.1 — parti par REST → queue vide
          } catch (restErr) {
            console.warn('[Analytics] REST write KO → snapshot remis en file :', (restErr && restErr.message) || restErr);
            // ⚡ v4 : aucune des deux voies n'a marché → snapshot remis
            // dans la file, nouvelle tentative au prochain flush.
            mergeSnapshotBack(snapshot);
          }
        } else {
          clearSavedQueue(); // ⚡ v4.1 — parti par SDK → queue vide
        }
      } catch (e) {
        // silencieux
      } finally {
        isFlushing = false;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // ⚡ v4 — SECOURS REST : écriture Firestore via l'API REST HTTPS
    // (pas de WebChannel, pas de SDK — passe à travers les proxies).
    // Lecture du doc → addition des compteurs → PATCH avec updateMask
    // (forme exacte validée par les règles v5).
    // ─────────────────────────────────────────────────────────────
    async function restWrite(snapshot) {
      if (!auth || !auth.currentUser || !currentUid) throw new Error('rest: pas d utilisateur');
      const idToken = await auth.currentUser.getIdToken();
      const proj = FIREBASE_CONFIG.projectId;
      const base = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents`;
      const docPath = `users/${currentUid}/analytics_daily/${snapshot.date}`;
      const docUrl = `${base}/${docPath}`;
      const hdrs = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` };

      // 1) lire l'état actuel (peut ne pas exister)
      let cur = { pages: {}, features: {}, byTimeOfDay: {}, byDayOfWeek: {}, contents: {}, totalTime: 0, sessions: 0, resultsCount: 0 };
      try {
        const r = await fetch(docUrl, { headers: { 'Authorization': `Bearer ${idToken}` }, keepalive: true });
        if (r.ok) {
          const j = await r.json();
          const gv = (name) => {
            try {
              const m = j.fields && j.fields[name] && j.fields[name].mapValue && j.fields[name].mapValue.fields || {};
              const out = {};
              Object.entries(m).forEach(([k, v]) => { out[k] = parseInt(v.integerValue || '0', 10) || 0; });
              return out;
            } catch (e) { return {}; }
          };
          cur.pages = gv('pages');
          cur.features = gv('features');
          cur.byTimeOfDay = gv('byTimeOfDay');
          cur.byDayOfWeek = gv('byDayOfWeek');
          cur.contents = gv('contents');
          cur.totalTime = parseInt((j.fields && j.fields.totalTime && j.fields.totalTime.integerValue) || '0', 10) || 0;
          cur.sessions = parseInt((j.fields && j.fields.sessions && j.fields.sessions.integerValue) || '0', 10) || 0;
          cur.resultsCount = parseInt((j.fields && j.fields.resultsCount && j.fields.resultsCount.integerValue) || '0', 10) || 0;
        }
      } catch (e) { /* doc absent → create via PATCH */ }

      // 2) additionner le snapshot (valeurs ABSOLUES)
      const addAll = (dst, src) => Object.entries(src || {}).forEach(([k, v]) => { dst[k] = (dst[k] || 0) + v; });
      addAll(cur.pages, snapshot.pages);
      addAll(cur.features, snapshot.features);
      addAll(cur.byTimeOfDay, snapshot.byTimeOfDay);
      addAll(cur.byDayOfWeek, snapshot.byDayOfWeek);
      addAll(cur.contents, snapshot.contents);
      cur.totalTime += snapshot.totalTime || 0;
      cur.sessions += snapshot.sessions || 0;

      const mp = (m) => ({ mapValue: { fields: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { integerValue: String(v) }])) } });

      const fields = {
        date: { stringValue: snapshot.date },
        device: { stringValue: String(snapshot.device || 'unknown').slice(0, 20) },
        lastSeenAt: { timestampValue: new Date().toISOString() },
        pages: mp(cur.pages),
        features: mp(cur.features),
        byTimeOfDay: mp(cur.byTimeOfDay),
        byDayOfWeek: mp(cur.byDayOfWeek),
        contents: mp(cur.contents),
        totalTime: { integerValue: String(cur.totalTime) },
        sessions: { integerValue: String(cur.sessions) }
      };
      if (snapshot.results.length > 0) fields.resultsCount = { integerValue: String(cur.resultsCount + snapshot.results.length) };

      const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`);
      const url = `${docUrl}?${mask.join('&')}`;
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: hdrs,
        body: JSON.stringify({ fields }),
        keepalive: true // ⚡ v4.1 : survit à la fermeture de l'onglet
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`rest ${resp.status} ${t.slice(0, 120)}`);
      }

      // 3) résultats (exams/qcm) — best effort via REST
      if (snapshot.results.length > 0) {
        try {
          await Promise.all(snapshot.results.map((r) =>
            fetch(`${base}/${docPath}/results`, {
              method: 'POST',
              headers: hdrs,
              body: JSON.stringify({
                fields: {
                  kind: { stringValue: String(r.kind || '').slice(0, 40) },
                  subject: { stringValue: String(r.subject || '').slice(0, 40) },
                  score: { integerValue: String(Number(r.score) || 0) },
                  total: { integerValue: String(Number(r.total) || 0) },
                  ts: { integerValue: String(r.ts || Date.now()) },
                  createdAt: { timestampValue: new Date().toISOString() }
                }
              })
            }).catch(() => {})
          ));
        } catch (e) { /* best effort */ }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────────────────────
    function startFlushTimer() {
      try {
        if (flushTimer) clearInterval(flushTimer);
        flushTimer = setInterval(() => {
          try { trackTimeSpent(); } catch (e) {}
          flush();
        }, FLUSH_INTERVAL);
      } catch (e) {}
    }

    function bindLifecycle() {
      try {
        document.addEventListener('visibilitychange', () => {
          try {
            if (document.visibilityState === 'hidden') {
              trackTimeSpent();
              flush();
            } else {
              pageEntryTime = now();
              initSession();
            }
          } catch (e) {}
        });

        window.addEventListener('beforeunload', () => {
          try { trackTimeSpent(); flush(); } catch (e) {}
        });

        // ⚡ v4 : pagehide est l'événement fiable sur iOS/Android —
        // beforeunload seul manquait beaucoup de fermetures mobiles.
        window.addEventListener('pagehide', () => {
          try { trackTimeSpent(); flush(); } catch (e) {}
        });

        window.addEventListener('online', () => {
          try { flush(); } catch (e) {}
        });
      } catch (e) {}
    }

    // ─────────────────────────────────────────────────────────────
    // DÉMARRAGE
    // ─────────────────────────────────────────────────────────────
// ⚡ v4 — TOUT LE MONDE est suivi (plus d'exclusion admin côté client).
// L'ancien comportement créait un piège : le propriétaire testait le site
// avec son propre compte → aucune écriture → la console admin affichait
// des zéros → « l'analytique ne marche pas ». Les vues « élèves seuls »
// restent disponibles côté console (filtre inclure/exclure le propriétaire).
async function startTracking(uid) {
  try {
    currentUid = uid;
    resetQueue();
    // ⚡ v4.1 — restaurer une queue laissée par une session précédente
    // (visite interrompue avant que l'écriture ne parte) → elle repartira
    // vers SON propre doc daté au prochain flush (date == dateKey, règles OK).
    try {
      const saved = loadPersistedQueue();
      if (saved && hasQueueData(saved)) {
        queue = saved;
        console.log('📊 [Analytics] queue restaurée (' + saved.date + ')');
      }
    } catch (e) {}
    initSession();
    trackPageView();
    trackAutoFeature();
    trackContent();
    startFlushTimer();
    // ⚡ v4 : premier flush rapide — la preuve d'activité part vite,
    // même sur une visite test de quelques secondes.
    try {
      if (firstFlushTimer) clearTimeout(firstFlushTimer);
      firstFlushTimer = setTimeout(() => {
        try { trackTimeSpent(); } catch (e) {}
        try { flush(); } catch (e) {}
      }, FIRST_FLUSH_DELAY);
    } catch (e) {}
    flush();
    isStarted = true;
    console.log('📊 [Analytics] Tracking actif pour', uid);
  } catch (e) {
    console.warn('[Analytics] startTracking error:', e.message);
  }
}

    function stopTracking() {
      try {
        trackTimeSpent();
        flush().finally(() => {
          currentUid = null;
          if (flushTimer) clearInterval(flushTimer);
          if (firstFlushTimer) clearTimeout(firstFlushTimer);
          isStarted = false;
        });
      } catch (e) {}
    }

    // ─────────────────────────────────────────────────────────────
    // INITIALISATION FIREBASE (silencieuse, robuste)
    // ─────────────────────────────────────────────────────────────
    async function initFirebase() {
      try {
        // Import dynamique des modules Firebase
        const appMod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js');

        const initializeApp = appMod.initializeApp;
        const getApps = appMod.getApps;
        const getApp = appMod.getApp;
        const getAuth = authMod.getAuth;
        const onAuthStateChanged = authMod.onAuthStateChanged;
        const initializeFirestore = fsMod.initializeFirestore;
        const persistentLocalCache = fsMod.persistentLocalCache;
        const persistentSingleTabManager = fsMod.persistentSingleTabManager;
        const getFirestore = fsMod.getFirestore;

        // Réutiliser l'app existante si possible, sinon créer
        const app = (getApps && getApps().length > 0)
          ? getApp()
          : initializeApp(FIREBASE_CONFIG);

        auth = getAuth(app);

        try {
          db = initializeFirestore(app, {
            localCache: persistentLocalCache({
              tabManager: persistentSingleTabManager()
            })
          });
        } catch (e) {
          // Si déjà initialisé → récupérer l'instance
          db = getFirestore(app);
        }

        // Écouter l'utilisateur Firebase
        onAuthStateChanged(auth, (user) => {
          try {
            if (user && (!currentUid || currentUid !== user.uid)) {
              startTracking(user.uid);
            } else if (!user && currentUid) {
              stopTracking();
            }
          } catch (e) {}
        });

        console.log('📊 [Analytics] Firebase prêt (attente auth)');
      } catch (e) {
        console.warn('[Analytics] Init échouée (silencieux):', e.message);
        // On abandonne silencieusement, la page continue normalement
      }
    }

    // ─────────────────────────────────────────────────────────────
    // LANCEMENT DIFFÉRÉ (pour ne pas ralentir la page)
    // ─────────────────────────────────────────────────────────────
    function boot() {
      // Attendre 3 secondes avant de démarrer
      setTimeout(() => {
        initFirebase();
      }, START_DELAY);

      bindLifecycle();
    }

    // Démarrer quand le DOM est prêt
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }

    // ─────────────────────────────────────────────────────────────
    // API PUBLIQUE (optionnelle, pour les pages qui veulent tracker plus)
    // ─────────────────────────────────────────────────────────────
    window.arvexaAnalytics = {
      trackResult: (data) => {
        try {
          if (!queue) resetQueue();
          queue.results.push({
            kind: cleanKey(data.kind),
            subject: cleanKey(data.subject || ''),
            score: Number(data.score) || 0,
            total: Number(data.total) || 0,
            difficulty: data.difficulty ? cleanKey(data.difficulty) : null,
            ts: now()
          });
          if (queue.results.length > 50) queue.results = queue.results.slice(-50);
        } catch (e) {}
      },
      trackFeature: (name, extra) => {
        try {
          if (!queue) resetQueue();
          const key = cleanKey(name);
          queue.features[key] = (queue.features[key] || 0) + 1;
        } catch (e) {}
      },
      trackContent: (data) => {
        try {
          if (!queue) resetQueue();
          if (data.subject) {
            const key = 'subject_' + cleanKey(data.subject);
            queue.contents[key] = (queue.contents[key] || 0) + 1;
          }
        } catch (e) {}
      },
      flush: () => { try { flush(); } catch (e) {} },
      _queue: () => { try { return JSON.parse(JSON.stringify(queue || {})); } catch (e) { return {}; } },
      _uid: () => currentUid
    };

    console.log('📊 ARVEXA Analytics v4.1 (universel, sans perte, queue persistante) — démarrage dans 3s');

  } catch (globalError) {
    // ⚡ N'importe quelle erreur → silencieux total, la page n'est PAS affectée
    console.warn('[Analytics] Erreur globale (page protégée):', globalError.message);
  }

})();
