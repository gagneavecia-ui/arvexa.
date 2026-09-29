// ================================================================
// ANALYTICS — ARVEXA School v2 (autonome)
// S'auto-connecte à Firebase, s'auto-branche, aucun code à ajouter
// dans les pages. Juste inclus via register-sw.js.
// ================================================================

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  doc,
  setDoc,
  addDoc,
  collection,
  serverTimestamp,
  increment
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js';

// ================================================================
// FIREBASE CONFIG (même projet que le reste)
// ================================================================
const firebaseConfig = {
  apiKey: "AIzaSyDHscOXw3rLuhV6z1Cny-bdYCumqpnG7QE",
  authDomain: "arvexa-fbf10.firebaseapp.com",
  projectId: "arvexa-fbf10",
  storageBucket: "arvexa-fbf10.firebasestorage.app",
  messagingSenderId: "920108330053",
  appId: "1:920108330053:web:f532d71cbc2c824bc7472c"
};

// ================================================================
// INITIALISATION — réutilise l'app existante si déjà créée
// ================================================================
let app, auth, db;

try {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager()
    })
  });
} catch (e) {
  // Si Firestore a déjà été initialisé par la page → récupérer l'instance
  try {
    app = getApps()[0];
    auth = getAuth(app);
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js');
    db = getFirestore(app);
  } catch (e2) {
    console.error('[Analytics] Init Firebase échouée:', e2.message);
  }
}

// ================================================================
// CONFIG
// ================================================================
const FLUSH_INTERVAL = 30000;          // flush toutes les 30s
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30min = nouvelle session

const SESSION_KEY = 'arvexa_analytics_session';
const LAST_ACTIVE_KEY = 'arvexa_analytics_last_active';

// ================================================================
// ÉTAT
// ================================================================
let currentUid = null;
let queue = null;
let flushTimer = null;
let pageEntryTime = Date.now();
let currentSessionId = null;
let isFlushing = false;
let isInitialized = false;

// ================================================================
// UTILITAIRES
// ================================================================
const now = () => Date.now();

const getDeviceType = () => {
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
};

const getTimeOfDay = () => {
  const h = new Date().getHours();
  if (h < 6) return 'nuit';
  if (h < 12) return 'matin';
  if (h < 18) return 'apresmidi';
  if (h < 22) return 'soir';
  return 'nuit';
};

const getDayOfWeek = () => {
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return days[new Date().getDay()];
};

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const cleanKey = (s) => String(s || '').replace(/[.\/\s#?=&]/g, '_').slice(0, 60);

// Détecte la page actuelle à partir de l'URL
const detectPage = () => {
  const path = window.location.pathname
    .replace(/^\//, '')
    .replace(/\.html$/, '')
    .replace(/\/$/, '');
  return cleanKey(path || 'index');
};

// Détecte la matière / le chapitre depuis l'URL (query params)
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

// ================================================================
// QUEUE
// ================================================================
function resetQueue() {
  queue = {
    date: getTodayKey(),
    pages: {},
    features: {},
    byTimeOfDay: {},
    byDayOfWeek: {},
    contents: {},
    totalTime: 0,
    sessions: 0,
    device: getDeviceType()
  };
}

// ================================================================
// SESSION
// ================================================================
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

// ================================================================
// TRACKERS
// ================================================================
function trackPageView() {
  if (!queue) resetQueue();
  const page = detectPage();
  queue.pages[page] = (queue.pages[page] || 0) + 1;
}

function trackTimeSpent() {
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
}

function trackFeature(featureName, extra = {}) {
  if (!queue) resetQueue();
  const key = cleanKey(featureName);
  queue.features[key] = (queue.features[key] || 0) + 1;
}

function trackContent() {
  if (!queue) resetQueue();
  const info = detectSubject();
  if (info.subject) {
    const key = 'subject_' + cleanKey(info.subject);
    queue.contents[key] = (queue.contents[key] || 0) + 1;
  }
}

// ⚡ Détection automatique de la fonctionnalité utilisée (basée sur la page)
function trackAutoFeature() {
  if (!queue) resetQueue();
  const page = detectPage();

  const featureMap = {
    calculatrice: 'calculatrice',
    formulaires: 'formulaire',
    'tableau-periodique': 'tableau_periodique',
    exam: 'mode_examen',
    reviseur: 'reviseur',
    'arv-pilot': 'arv_pilot',
    groupe: 'groupe',
    planificateur: 'planificateur',
    abonnement: 'abonnement',
    profil: 'profil',
    notifications: 'notifications',
    lecture: 'lecture',
    chapitre: 'chapitre',
    matiere: 'matiere'
  };

  const feature = featureMap[page];
  if (feature) {
    queue.features[feature] = (queue.features[feature] || 0) + 1;
  }
}

// ================================================================
// API PUBLIQUE INTERNE
// ================================================================
function trackResult({ kind, subject, score, total, difficulty }) {
  if (!queue) resetQueue();
  if (!queue.results) queue.results = [];
  queue.results.push({
    kind: cleanKey(kind),
    subject: cleanKey(subject || ''),
    score: Number(score) || 0,
    total: Number(total) || 0,
    difficulty: difficulty ? cleanKey(difficulty) : null,
    ts: now()
  });
  if (queue.results.length > 50) queue.results = queue.results.slice(-50);
}

// ================================================================
// FLUSH
// ================================================================
async function flush() {
  if (isFlushing || !queue || !currentUid) return;

  const hasData =
    queue.totalTime > 0 ||
    Object.keys(queue.pages).length > 0 ||
    Object.keys(queue.features).length > 0 ||
    (queue.results && queue.results.length > 0);
  if (!hasData) return;

  isFlushing = true;

  const snapshot = JSON.parse(JSON.stringify(queue));
  const currentDate = snapshot.date;
  resetQueue();

  try {
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

    // Résultats dans une sous-collection légère
    if (snapshot.results && snapshot.results.length > 0) {
      const resultsRef = collection(db, 'users', currentUid, 'analytics_daily', currentDate, 'results');
      await Promise.all(
        snapshot.results.map((r) =>
          addDoc(resultsRef, { ...r, createdAt: serverTimestamp() }).catch(() => {})
        )
      );
      updates.resultsCount = increment(snapshot.results.length);
    }

    await setDoc(aggRef, updates, { merge: true });
  } catch (e) {
    console.warn('[Analytics] flush error:', e.message);
  } finally {
    isFlushing = false;
  }
}

// ================================================================
// LIFECYCLE
// ================================================================
function startFlushTimer() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => {
    trackTimeSpent();
    flush();
  }, FLUSH_INTERVAL);
}

function bindLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      trackTimeSpent();
      flush();
    } else {
      pageEntryTime = now();
      initSession();
    }
  });

  window.addEventListener('beforeunload', () => {
    trackTimeSpent();
    flush();
  });

  window.addEventListener('online', () => flush());
}

// ================================================================
// DÉMARRAGE
// ================================================================
function startTracking(uid) {
  currentUid = uid;
  resetQueue();
  initSession();
  trackPageView();
  trackAutoFeature();
  trackContent();
  startFlushTimer();
  flush();
  isInitialized = true;
  console.log('📊 [Analytics] Tracking actif pour', uid);
}

function stopTracking() {
  trackTimeSpent();
  flush().finally(() => {
    currentUid = null;
    if (flushTimer) clearInterval(flushTimer);
    isInitialized = false;
  });
}

// ⚡ ÉCOUTE AUTOMATIQUE DE L'UTILISATEUR FIREBASE
if (auth) {
  onAuthStateChanged(auth, (user) => {
    if (user && (!currentUid || currentUid !== user.uid)) {
      startTracking(user.uid);
    } else if (!user && currentUid) {
      stopTracking();
    }
  });
}

bindLifecycle();

// ================================================================
// API PUBLIQUE (pour les pages qui veulent tracker plus)
// ================================================================
window.arvexaAnalytics = {
  trackResult,
  trackFeature,
  trackPageView,
  trackTimeSpent,
  flush,
  _queue: () => JSON.parse(JSON.stringify(queue || {})),
  _uid: () => currentUid
};

console.log('📊 ARVEXA Analytics v2 (autonome) — en attente de connexion...');
