/* ═══════════════════════════════════════════════════════════════════
   ARVEXA SCHOOL — ARVEXA-COUNTRY.JS
   ✅ v8.10 — PAYS LIÉ AU COMPTE (zéro cache d'appareil) + VERROU SERVEUR
   (base v8.9 : choix de pays forcé + programmes communautaires par pays)
   ═══════════════════════════════════════════════════════════════════
   Demande propriétaire (récapitulée) :
   « Il faut que j'utilise l'intelligence artificielle. La modification ne
     touche AUCUNE page à part le réviseur et exam. La matière scientifique
     qu'on a dans matière (HTML) ne change pas, elle reste intacte.
     Au lieu que l'utilisateur choisisse son pays après être rentré, dès
     qu'il rentre dans la page en étant nouveau, un pop-up FORCÉ lui fait
     choisir son pays. Une fois confirmé, c'est fixe : il ne peut plus
     changer de pays. Pour le choix de chapitre, il remplit progressivement
     les chapitres (il les ajoute au fur et à mesure). Cette modification
     s'adapte UNIQUEMENT aux matières littéraires qui changent entre les
     pays : les matières scientifiques sont toutes les mêmes. »

   Fonctionnement :
   1. POP-UP FORCÉ — exam.html / reviseur.html appellent
      ArvexaCountry.ready() puis maybeShowForcedModal() après l'auth :
      si le pays n'est pas encore confirmé, une modale BLOQUANTE (sans
      croix, sans Échap, sans clic extérieur) demande le pays (recherche
      insensible aux accents, Niger en premier avec « Programme intégré »).
      La sélection exige une CONFIRMATION explicite → le pays est alors
      VERROUILLÉ définitivement dans le COMPTE (users/{uid}.country +
      users/{uid}.countryConfirmedAt, verrou garanti aussi par les règles
      Firestore). Le pop-up ne réapparaît jamais POUR CE COMPTE.
   2. PROGRAMME INTÉGRÉ — le Niger (défaut) garde exactement l'expérience
      actuelle : les chapitres préprogrammés restent servis à l'identique.
   3. MATIÈRES SCIENTIFIQUES (maths, physique, chimie, svt) — identiques
      dans tous les pays : le programme intégré est servi à tout le monde,
      quel que soit le pays confirmé.
   4. MATIÈRES LITTÉRAIRES (philosophie, histoire, géographie) — si le
      pays confirmé ≠ Niger, la liste de chapitres n'est PAS préremplie :
      l'élève ajoute SES chapitres progressivement (bouton « Ajouter un
      chapitre »). Chaque chapitre est stocké dans Firestore en mentionnant
      le pays (curricula/{PAYS}_{matiere}/chapters/{slug} avec addedBy) →
      tout élève du MÊME pays voit directement les chapitres déjà listés et
      la liste se complète au fur et à mesure. Cache local des CHAPITRES
      communautaires uniquement (donc publics, pas personnels) pour
      l'offline ; si Firestore refuse (règles pas encore déployées / hors
      ligne), le chapitre reste utilisable localement sur l'appareil.
      ✅ v8.10 — le CHOIX DE PAYS, lui, n'est JAMAIS mis en cache d'appareil.
   5. Design 100 % tokens du site (arvexa-ui.css) → thèmes sombre ET clair
      automatiques. i18n EN via window.ARVEXA_LANG quand disponible.

   Aucune autre page n'est affectée : matiere.html et chapitre.html ne
   chargent PAS ce module et restent strictement intactes.
   ═══════════════════════════════════════════════════════════════════ */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, orderBy, getDocs, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ─── Config (identique aux pages : projet arvexa-fbf10) ─────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDHscOXw3rLuhV6z1Cny-bdYCumqpnG7QE",
  authDomain: "arvexa-fbf10.firebaseapp.com",
  projectId: "arvexa-fbf10",
  storageBucket: "arvexa-fbf10.firebasestorage.app",
  messagingSenderId: "920108330053",
  appId: "1:920108330053:web:f532d71cbc2c824bc7472c"
};

// ─── Les 54 pays d'Afrique (identiques à whatsapp.html v8.3) ────────
// [iso, drapeau, indicatif, nom FR, nom EN] — tri alphabétique FR.
const AFRIQUE = [
  ['ZA','🇿🇦','+27','Afrique du Sud','South Africa'],
  ['DZ','🇩🇿','+213','Algérie','Algeria'],
  ['AO','🇦🇴','+244','Angola','Angola'],
  ['BJ','🇧🇯','+229','Bénin','Benin'],
  ['BW','🇧🇼','+267','Botswana','Botswana'],
  ['BF','🇧🇫','+226','Burkina Faso','Burkina Faso'],
  ['BI','🇧🇮','+257','Burundi','Burundi'],
  ['CM','🇨🇲','+237','Cameroun','Cameroon'],
  ['CV','🇨🇻','+238','Cap-Vert','Cape Verde'],
  ['KM','🇰🇲','+269','Comores','Comoros'],
  ['CG','🇨🇬','+242','Congo-Brazzaville','Republic of the Congo'],
  ['CI','🇨🇮','+225','Côte d’Ivoire','Ivory Coast'],
  ['DJ','🇩🇯','+253','Djibouti','Djibouti'],
  ['EG','🇪🇬','+20','Égypte','Egypt'],
  ['ER','🇪🇷','+291','Érythrée','Eritrea'],
  ['SZ','🇸🇿','+268','Eswatini','Eswatini'],
  ['ET','🇪🇹','+251','Éthiopie','Ethiopia'],
  ['GA','🇬🇦','+241','Gabon','Gabon'],
  ['GM','🇬🇲','+220','Gambie','Gambia'],
  ['GH','🇬🇭','+233','Ghana','Ghana'],
  ['GN','🇬🇳','+224','Guinée','Guinea'],
  ['GW','🇬🇼','+245','Guinée-Bissau','Guinea-Bissau'],
  ['GQ','🇬🇶','+240','Guinée équatoriale','Equatorial Guinea'],
  ['KE','🇰🇪','+254','Kenya','Kenya'],
  ['LS','🇱🇸','+266','Lesotho','Lesotho'],
  ['LR','🇱🇷','+231','Liberia','Liberia'],
  ['LY','🇱🇾','+218','Libye','Libya'],
  ['MG','🇲🇬','+261','Madagascar','Madagascar'],
  ['MW','🇲🇼','+265','Malawi','Malawi'],
  ['ML','🇲🇱','+223','Mali','Mali'],
  ['MA','🇲🇦','+212','Maroc','Morocco'],
  ['MR','🇲🇷','+222','Mauritanie','Mauritania'],
  ['MU','🇲🇺','+230','Maurice','Mauritius'],
  ['MZ','🇲🇿','+258','Mozambique','Mozambique'],
  ['NA','🇳🇦','+264','Namibie','Namibia'],
  ['NE','🇳🇪','+227','Niger','Niger'],
  ['NG','🇳🇬','+234','Nigéria','Nigeria'],
  ['UG','🇺🇬','+256','Ouganda','Uganda'],
  ['CF','🇨🇫','+236','République centrafricaine','Central African Republic'],
  ['CD','🇨🇩','+243','République démocratique du Congo','DR Congo'],
  ['RW','🇷🇼','+250','Rwanda','Rwanda'],
  ['ST','🇸🇹','+239','São Tomé-et-Príncipe','São Tomé and Príncipe'],
  ['SN','🇸🇳','+221','Sénégal','Senegal'],
  ['SC','🇸🇨','+248','Seychelles','Seychelles'],
  ['SL','🇸🇱','+232','Sierra Leone','Sierra Leone'],
  ['SO','🇸🇴','+252','Somalie','Somalia'],
  ['SD','🇸🇩','+249','Soudan','Sudan'],
  ['SS','🇸🇸','+211','Soudan du Sud','South Sudan'],
  ['TZ','🇹🇿','+255','Tanzanie','Tanzania'],
  ['TD','🇹🇩','+235','Tchad','Chad'],
  ['TG','🇹🇬','+228','Togo','Togo'],
  ['TN','🇹🇳','+216','Tunisie','Tunisia'],
  ['ZM','🇿🇲','+260','Zambie','Zambia'],
  ['ZW','🇿🇼','+263','Zimbabwe','Zimbabwe']
].map(([iso, flag, dial, fr, en]) => ({ iso, flag, dial, fr, en }));
console.assert(AFRIQUE.length === 54, '[Country] 54 pays attendus, trouvé :', AFRIQUE.length);

const NIGER_ISO = 'NE';
const LS_CURR_PREFIX = 'arvexa-curricula-'; // + {ISO}_{subject} → {chapters, at}
// (Cache CURRICULA uniquement : chapitres publics de la communauté, jamais
// le choix de pays — supprimé en v8.10, voir « ÉTAT » ci-dessous.)
const MAX_CHAPTERS = 80;
const TITLE_MAX = 120;

// Matières littéraires : le programme change d'un pays à l'autre.
// Les scientifiques (mathematiques, physique, chimie, svt) sont les mêmes
// partout → programme intégré servi à tout le monde.
const LITERARY_SUBJECTS = new Set(['philosophie', 'histoire', 'geographie']);

// ─── i18n (chaînes FR par défaut, EN uniquement si la langue choisie est EN) ──
function tr(s) {
  try {
    if (window.ARVEXA_LANG && typeof window.ARVEXA_LANG.t === 'function'
        && typeof window.ARVEXA_LANG.get === 'function'
        && window.ARVEXA_LANG.get() === 'en') {
      return window.ARVEXA_LANG.t(s);
    }
  } catch (e) {}
  return s;
}

// ─── ÉTAT ───────────────────────────────────────────────────────────
// ✅ v8.10 — ZÉRO cache d'appareil pour le choix de pays : `state` vit en
// mémoire le temps de la page et sa source de vérité est users/{uid}
// (Firestore). Conséquence voulue : sur le MÊME appareil, un NOUVEAU
// compte repasse par le pop-up de choix de pays, exactement comme demandé.
let state = { code: NIGER_ISO, confirmed: false, at: 0 };
let currentUser = null;
let readyPromise = null;
let readyResolved = false;
const curriculaCache = new Map();   // subject → [{slug,title,addedBy,local}]
const currUnsubs = new Map();       // subject → unsubscribe()

// ✅ v8.10 — purge de l'ancien cache d'appareil (v8.9) : le choix de pays
// ne doit jamais survivre au compte, même sur un vieil appareil déjà v8.9.
try { localStorage.removeItem('arvexa-country'); } catch (e) {}

function emit(name, detail) {
  try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (e) {}
}

function countryInfo(code) {
  return AFRIQUE.find((c) => c.iso === code) || null;
}

// ─── FIREBASE — instance DÉDIÉE (jamais de conflit d'initialisation) ─
let _app = null, _auth = null, _db = null;
function fb() {
  if (_db) return { auth: _auth, db: _db };
  try {
    _app = getApps().find((a) => a.name === 'arvexa-country') || null;
    if (!_app) _app = initializeApp(FIREBASE_CONFIG, 'arvexa-country');
    _auth = getAuth(_app);
    _db = getFirestore(_app);
  } catch (e) {
    console.warn('[Country] Firebase indisponible :', e && e.code);
    _db = _db || null;
  }
  return { auth: _auth, db: _db };
}

// ─── PRÊT (lecture du profil une fois, pour le multi-appareils) ─────
// Si le compte a DÉJÀ un pays confirmé (autre appareil), on l'adopte
// silencieusement : le pop-up ne s'affiche pas deux fois.
function ready() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    const finish = () => { if (!readyResolved) { readyResolved = true; resolve(getCountry()); } };
    const timer = setTimeout(finish, 1600); // ne jamais bloquer la page
    try {
      const { auth, db } = fb();
      if (!auth || !db) { clearTimeout(timer); return finish(); }
      onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (!user) { clearTimeout(timer); return finish(); }
        // ✅ v8.10 — la SEULE source du pays est le compte Firestore.
        // Plus aucune adoption depuis un cache d'appareil et PLUS AUCUN
        // push automatique : l'ancien code poussait le pays lu en local
        // dans le profil — un nouveau compte sur le même appareil héritait
        // donc du pays de l'ancien compte (fuite corrigée). Profil sans
        // pays → needsCountryPopup() reste vrai → pop-up forcé.
        getDoc(doc(db, 'users', user.uid)).then((snap) => {
          if (currentUser === user && snap && snap.exists() && !state.confirmed) {
            const d = snap.data();
            if (d.country && d.countryConfirmedAt) {
              state = { code: d.country, confirmed: true, at: Date.now() };
              emit('arvexa-country-change', { code: state.code, confirmed: true, fromProfile: true });
            }
          }
          clearTimeout(timer);
          finish();
        }).catch(() => { clearTimeout(timer); finish(); });
      }, () => { clearTimeout(timer); finish(); });
    } catch (e) { clearTimeout(timer); finish(); }
  });
  return readyPromise;
}

function pushProfile(uid) {
  try {
    const { db } = fb();
    if (!db || !uid) return;
    updateDoc(doc(db, 'users', uid), {
      country: state.code,
      countryConfirmedAt: new Date().toISOString()
    }).catch(() => {});
  } catch (e) {}
}

// ─── CONFIRMATION DU PAYS (verrou définitif) ────────────────────────
function confirmCountry(code) {
  const info = countryInfo(code);
  if (!info) return;
  state = { code: info.iso, confirmed: true, at: Date.now() };
  // ✅ v8.10 — aucune écriture locale : le verrou ne vit que dans le compte.
  try {
    const { auth } = fb();
    if (auth && auth.currentUser) pushProfile(auth.currentUser.uid);
  } catch (e) {}
  emit('arvexa-country-change', { code: info.iso, confirmed: true });
}

// ─── API PUBLIQUE — pays ────────────────────────────────────────────
function getCountry() {
  return { code: state.code, confirmed: state.confirmed, info: countryInfo(state.code) };
}
function isNiger() { return state.code === NIGER_ISO; }
function isConfirmed() { return state.confirmed === true; }
function needsCountryPopup() { return !state.confirmed; }

// ─── SLUG (identifiant stable du chapitre, partage par pays) ────────
function slugify(title) {
  return String(title || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'chapitre';
}

// ─── CACHE LOCAL CURRICULUM ─────────────────────────────────────────
function currKey(subject) { return `${state.code}_${subject}`; }
function currLSKey(subject) { return LS_CURR_PREFIX + currKey(subject); }

function readCache(subject) {
  try {
    const raw = localStorage.getItem(currLSKey(subject));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.chapters) ? parsed.chapters : null;
  } catch (e) { return null; }
}

function writeCache(subject, chapters) {
  try {
    localStorage.setItem(currLSKey(subject), JSON.stringify({ chapters, at: Date.now() }));
  } catch (e) {}
}

function mergeChapters(a, b) {
  const seen = new Map();
  [...(a || []), ...(b || [])].forEach((ch) => {
    if (!ch || typeof ch.title !== 'string') return;
    const t = ch.title.trim();
    if (!t) return;
    const s = ch.slug || slugify(t);
    if (!seen.has(s)) seen.set(s, { slug: s, title: t, addedBy: ch.addedBy || null, local: !!ch.local });
    else if (!ch.local && seen.get(s).local) seen.set(s, { ...seen.get(s), addedBy: ch.addedBy || seen.get(s).addedBy, local: false });
  });
  return [...seen.values()].sort((x, y) => x.title.localeCompare(y.title, 'fr'));
}

// ─── API PUBLIQUE — curriculum communautaire ────────────────────────
function useCommunity(subject) {
  return !isNiger() && LITERARY_SUBJECTS.has(subject);
}

function getCurriculum(subject) {
  if (!useCommunity(subject)) return null;
  if (curriculaCache.has(subject)) return curriculaCache.get(subject);
  const cached = readCache(subject) || [];
  curriculaCache.set(subject, cached);
  return cached;
}

function setCurriculumCache(subject, chapters, emitEvent) {
  curriculaCache.set(subject, chapters);
  writeCache(subject, chapters);
  if (emitEvent) emit('arvexa-curricula-change', { subject, count: chapters.length });
}

// Lecture Firestore + fusion cache (le cache reste utile hors ligne).
async function loadCurriculum(subject) {
  if (!useCommunity(subject)) return null;
  const cached = getCurriculum(subject) || [];
  const { db } = fb();
  if (!db) return cached;
  try {
    const snap = await getDocs(query(collection(db, 'curricula', currKey(subject), 'chapters'), orderBy('order', 'asc')));
    const remote = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      if (typeof data.title === 'string' && data.title.trim()) {
        remote.push({ slug: d.id, title: data.title.trim(), addedBy: data.addedBy || null, local: false });
      }
    });
    const merged = mergeChapters(cached, remote);
    setCurriculumCache(subject, merged, true);
    return merged;
  } catch (e) {
    console.warn('[Country] Lecture programme :', e && e.code);
    return cached;
  }
}

// Temps réel (matière ouverte) : les ajouts des autres élèves arrivent vite.
function watchCurriculum(subject, callback) {
  if (!useCommunity(subject)) return () => {};
  loadCurriculum(subject);
  const { db } = fb();
  if (!db) return () => {};
  // Anti-doublon : un seul listener par matière (updateChapters peut être
  // rappelé à chaque changement de matière / re-render de la page hôte).
  if (currUnsubs.has(subject)) return currUnsubs.get(subject);
  try {
    const unsub = onSnapshot(query(collection(db, 'curricula', currKey(subject), 'chapters'), orderBy('order', 'asc')),
      (snap) => {
        const remote = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          if (typeof data.title === 'string' && data.title.trim()) {
            remote.push({ slug: d.id, title: data.title.trim(), addedBy: data.addedBy || null, local: false });
          }
        });
        const merged = mergeChapters(readCache(subject) || [], remote);
        setCurriculumCache(subject, merged, true);
        if (typeof callback === 'function') callback(merged);
      },
      (err) => { console.warn('[Country] Snapshot programme :', err && err.code); });
    currUnsubs.set(subject, unsub);
    return unsub;
  } catch (e) { return () => {}; }
}

// Ajout d'un chapitre (remplissage progressif, stocké avec le pays).
async function addChapter(subject, rawTitle) {
  const title = String(rawTitle || '').trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX);
  if (!title || !useCommunity(subject)) return { ok: false, reason: 'invalide' };
  const list = getCurriculum(subject) || [];
  const slug = slugify(title);
  if (list.some((c) => c.slug === slug)) return { ok: false, reason: 'existe', title };

  const uid = (currentUser && currentUser.uid) || null;
  // 1. Optimiste local (l'élève voit son chapitre immédiatement, même offline)
  const next = mergeChapters(list, [{ slug, title, addedBy: uid, local: true }]);
  if (next.length > MAX_CHAPTERS) return { ok: false, reason: 'limite' };
  setCurriculumCache(subject, next, true);

  // 2. Firestore partagé (mention du pays dans le chemin + addedBy)
  const { db } = fb();
  if (!db) return { ok: true, local: true, title, slug };
  try {
    await setDoc(doc(db, 'curricula', currKey(subject), 'chapters', slug), {
      title,
      order: title.toLowerCase(),
      addedBy: uid || 'anonyme',
      addedAt: serverTimestamp()
    });
    await setDoc(doc(db, 'curricula', currKey(subject)), {
      country: state.code,
      subject: String(subject).slice(0, 40),
      updatedAt: serverTimestamp(),
      updatedBy: uid // ✅ v8.10 — doit être l'utilisateur connecté (règle Firestore)
    });
    // C'est parti pour le temps réel : la copie distante remplace le marqueur local
    try {
      const fresh = (curriculaCache.get(subject) || []).map((c) => (c.slug === slug ? { ...c, local: false } : c));
      setCurriculumCache(subject, fresh, false);
    } catch (e) {}
    return { ok: true, shared: true, title, slug };
  } catch (e) {
    console.warn('[Country] Partage du chapitre :', e && e.code);
    return { ok: true, local: true, title, slug, offline: true };
  }
}

// Retrait : uniquement ses propres ajouts (règle Firestore identique).
async function removeChapter(subject, slug) {
  const list = getCurriculum(subject) || [];
  const target = list.find((c) => c.slug === slug);
  if (!target) return { ok: false, reason: 'absent' };
  if (target.addedBy && currentUser && target.addedBy !== currentUser.uid) {
    return { ok: false, reason: 'not-owner' };
  }
  setCurriculumCache(subject, list.filter((c) => c.slug !== slug), true);
  const { db } = fb();
  if (!db) return { ok: true };
  try {
    await deleteDoc(doc(db, 'curricula', currKey(subject), 'chapters', slug));
    return { ok: true };
  } catch (e) {
    return { ok: true, local: true };
  }
}

// ─── TOAST ──────────────────────────────────────────────────────────
function toast(message) {
  try {
    const el = document.createElement('div');
    el.className = 'axc-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 30);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, 3200);
  } catch (e) {}
}

// ─── CSS INJECTÉ (tokens du site → sombre ET clair automatiques) ────
function injectCss() {
  if (document.getElementById('arvexa-country-css')) return;
  const style = document.createElement('style');
  style.id = 'arvexa-country-css';
  style.textContent = `
    .axc-overlay{position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;
      padding:18px;background:rgba(0,0,0,.62);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .25s ease}
    .axc-overlay.show{opacity:1;pointer-events:auto}
    .axc-modal{width:min(430px,100%);max-height:84vh;display:flex;flex-direction:column;overflow:hidden;
      background:linear-gradient(180deg,var(--bg-surface,#141414) 0%,var(--bg-dark,#0A0A0A) 100%);
      border:1px solid rgba(var(--rgb-soft,255,255,255),.14);border-radius:var(--radius-lg,20px);
      box-shadow:0 24px 64px rgba(0,0,0,.55);transform:translateY(14px) scale(.98);transition:transform .25s ease}
    .axc-overlay.show .axc-modal{transform:translateY(0) scale(1)}
    .axc-head{padding:22px 22px 6px;text-align:center}
    .axc-head .axc-globe{font-size:34px;line-height:1;display:inline-block;filter:drop-shadow(0 4px 14px rgba(224,184,74,.25))}
    .axc-title{margin:10px 0 0;font-family:'Playfair Display',Georgia,serif;font-size:22px;color:var(--text-light,#F5F0E8)}
    .axc-title em{font-style:italic;color:var(--accent-bright,#E0B84A)}
    .axc-sub{margin:8px 0 0;font-size:13px;line-height:1.55;color:var(--text-dim,#8A8A7A)}
    .axc-body{padding:14px 22px 8px;display:flex;flex-direction:column;gap:10px;min-height:0}
    .axc-search{position:relative}
    .axc-search i{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--text-muted,#5A5A4A)}
    .axc-search input{width:100%;box-sizing:border-box;padding:12px 14px 12px 36px;font-size:14px;color:var(--text-light,#F5F0E8);
      background:var(--input-bg,rgba(184,134,11,.05));border:1px solid var(--input-border,rgba(255,255,255,.14));
      border-radius:var(--radius-sm,10px);outline:none;transition:border-color .2s}
    .axc-search input:focus{border-color:var(--input-border-focus,rgba(184,134,11,.7))}
    .axc-search input::placeholder{color:var(--text-muted,#5A5A4A)}
    .axc-list{min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:2px;margin:0 -4px;padding:2px 4px}
    .axc-item{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;padding:11px 13px;cursor:pointer;text-align:left;
      background:transparent;border:1px solid transparent;border-radius:var(--radius-sm,10px);
      color:var(--text-light,#F5F0E8);font-size:14.5px;transition:background .15s,border-color .15s}
    .axc-item:hover{background:var(--accent-dim,rgba(184,134,11,.08));border-color:rgba(var(--rgb-soft,255,255,255),.1)}
    .axc-item .axc-flag{font-size:19px;line-height:1;flex:0 0 auto}
    .axc-item .axc-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .axc-item .axc-chip{flex:0 0 auto;font-size:10px;font-weight:600;letter-spacing:.02em;padding:3px 8px;border-radius:var(--radius-pill,999px);
      background:var(--accent-dim,rgba(184,134,11,.08));color:var(--accent-bright,#E0B84A);border:1px solid rgba(184,134,11,.28)}
    .axc-item.selected{background:var(--accent-dim,rgba(184,134,11,.1));border-color:var(--accent,#B8860B)}
    .axc-confirm{padding:18px 22px 22px;display:none;flex-direction:column;gap:14px}
    .axc-confirm.show{display:flex}
    .axc-confirm-country{display:flex;align-items:center;gap:12px;justify-content:center;font-size:17px;color:var(--text-light,#F5F0E8)}
    .axc-confirm-country .axc-flag{font-size:30px}
    .axc-note{font-size:12.5px;line-height:1.55;color:var(--text-dim,#8A8A7A);background:var(--accent-dim,rgba(184,134,11,.07));
      border:1px solid rgba(184,134,11,.22);border-radius:var(--radius-sm,10px);padding:10px 12px}
    .axc-note b{color:var(--accent-bright,#E0B84A)}
    .axc-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
    .axc-btn{flex:1 1 auto;min-width:fit-content;padding:12px 18px;border-radius:var(--radius-pill,999px);font-size:14px;font-weight:600;
      cursor:pointer;border:none;transition:transform .15s,box-shadow .15s,opacity .15s;display:inline-flex;align-items:center;justify-content:center;gap:8px}
    .axc-btn:active{transform:scale(.98)}
    .axc-btn-ghost{background:rgba(var(--rgb-soft,255,255,255),.07);color:var(--text-light,#F5F0E8);border:1px solid rgba(var(--rgb-soft,255,255,255),.14)}
    .axc-btn-gold{background:linear-gradient(135deg,var(--accent-bright,#E0B84A),var(--accent,#B8860B));color:var(--on-gold,#0A0A0A);
      box-shadow:0 6px 18px rgba(184,134,11,.35)}
    .axc-btn-gold:hover{box-shadow:0 8px 22px rgba(184,134,11,.45)}
    .axc-foot{padding:0 22px 18px;text-align:center;font-size:11.5px;color:var(--text-muted,#5A5A4A)}
    /* Modale d'ajout de chapitres */
    .axc-entry-row{display:flex;gap:8px}
    .axc-entry-row input{flex:1;min-width:0;box-sizing:border-box;padding:12px 14px;font-size:14px;color:var(--text-light,#F5F0E8);
      background:var(--input-bg,rgba(184,134,11,.05));border:1px solid var(--input-border,rgba(255,255,255,.14));
      border-radius:var(--radius-sm,10px);outline:none;transition:border-color .2s}
    .axc-entry-row input:focus{border-color:var(--input-border-focus,rgba(184,134,11,.7))}
    .axc-entry-row input::placeholder{color:var(--text-muted,#5A5A4A)}
    .axc-entry-add{flex:0 0 auto;padding:0 18px;border-radius:var(--radius-sm,10px);font-size:14px;font-weight:600;border:none;cursor:pointer;
      background:linear-gradient(135deg,var(--accent-bright,#E0B84A),var(--accent,#B8860B));color:var(--on-gold,#0A0A0A)}
    .axc-entry-list{display:flex;flex-wrap:wrap;gap:8px;overflow-y:auto;max-height:230px;padding:2px}
    .axc-chip-item{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;font-size:13px;color:var(--text-light,#F5F0E8);
      background:var(--block-bg,rgba(255,255,255,.05));border:1px solid rgba(var(--rgb-soft,255,255,255),.12);border-radius:var(--radius-pill,999px)}
    .axc-chip-remove{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;cursor:pointer;
      background:rgba(var(--rgb-soft,255,255,255),.1);color:var(--text-dim,#8A8A7A);font-size:10px;border:none;padding:0}
    .axc-chip-remove:hover{background:var(--danger,#B85C3A);color:#fff}
    .axc-empty-mini{font-size:12.5px;color:var(--text-muted,#5A5A4A);text-align:center;padding:14px 0}
    .axc-add-option{display:flex;align-items:center;gap:10px;padding:11px 13px;margin-top:6px;cursor:pointer;font-size:14px;font-weight:600;
      color:var(--accent-bright,#E0B84A);border:1px dashed rgba(184,134,11,.4);border-radius:var(--radius-sm,10px);
      background:var(--accent-dim,rgba(184,134,11,.06));transition:background .15s}
    .axc-add-option:hover{background:rgba(184,134,11,.12)}
    .axc-exam-extra{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:wrap}
    .axc-add-inline{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;
      border:1px dashed rgba(184,134,11,.4);border-radius:var(--radius-pill,999px);background:var(--accent-dim,rgba(184,134,11,.06));
      color:var(--accent-bright,#E0B84A);transition:background .15s}
    .axc-add-inline:hover{background:rgba(184,134,11,.12)}
    .axc-country-hint{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim,#8A8A7A);
      background:var(--block-bg,rgba(255,255,255,.05));border:1px solid rgba(var(--rgb-soft,255,255,255),.1);
      border-radius:var(--radius-pill,999px);padding:5px 11px;vertical-align:middle}
    .axc-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,16px);z-index:99999;max-width:88vw;
      background:var(--bg-surface,#141414);color:var(--text-light,#F5F0E8);border:1px solid rgba(184,134,11,.35);
      border-radius:var(--radius-pill,999px);padding:11px 20px;font-size:13.5px;box-shadow:0 12px 32px rgba(0,0,0,.45);
      opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;overflow-wrap:anywhere}
    .axc-toast.show{opacity:1;transform:translate(-50%,0)}
    @media (prefers-reduced-motion: reduce){.axc-overlay,.axc-modal,.axc-toast{transition-duration:.01ms !important}}
  `;
  document.head.appendChild(style);
}

// ─── POP-UP FORCÉ DE CHOIX DE PAYS ──────────────────────────────────
// Bloquant : sans croix, sans Échap, sans clic extérieur.
let forcedOpen = false;
function maybeShowForcedModal(onDone) {
  if (state.confirmed || forcedOpen) return false;
  injectCss();
  forcedOpen = true;
  let pendingCode = null;

  const overlay = document.createElement('div');
  overlay.className = 'axc-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="axc-modal">
      <div class="axc-head">
        <span class="axc-globe">🌍</span>
        <h2 class="axc-title">${tr('Bienvenue sur Arvexa')} — <em>${tr('choisis ton pays')}</em></h2>
        <p class="axc-sub">${tr('Ton programme s’adapte à ton pays. Ce choix est définitif : il ne pourra plus être modifié.')}</p>
      </div>
      <div class="axc-body">
        <div class="axc-search">
          <i class="fas fa-search"></i>
          <input type="text" id="axcSearch" placeholder="${tr('Chercher ton pays…')}" autocomplete="off">
        </div>
        <div class="axc-list" id="axcList"></div>
        <div class="axc-confirm" id="axcConfirmStep">
          <div class="axc-confirm-country" id="axcConfirmCountry"></div>
          <div class="axc-note" id="axcConfirmNote"></div>
          <div class="axc-actions">
            <button type="button" class="axc-btn axc-btn-ghost" id="axcBack">${tr('Retour')}</button>
            <button type="button" class="axc-btn axc-btn-gold" id="axcConfirmBtn"><i class="fas fa-check"></i> ${tr('Oui, c’est mon pays')}</button>
          </div>
        </div>
      </div>
      <div class="axc-foot">${tr('Matières scientifiques : programme commun à toute l’Afrique francophone · Matières littéraires : chapitres de ton pays')}</div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const listEl = overlay.querySelector('#axcList');
  const searchEl = overlay.querySelector('#axcSearch');
  const confirmStep = overlay.querySelector('#axcConfirmStep');
  const confirmCountryEl = overlay.querySelector('#axcConfirmCountry');
  const confirmNoteEl = overlay.querySelector('#axcConfirmNote');

  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '');

  function renderList(filter) {
    const q = norm(filter);
    const niger = AFRIQUE.find((c) => c.iso === NIGER_ISO);
    const others = AFRIQUE
      .filter((c) => c.iso !== NIGER_ISO)
      .filter((c) => !q || norm(c.fr).includes(q) || norm(c.en).includes(q) || c.dial.includes(q))
      .sort((a, b) => a.fr.localeCompare(b.fr, 'fr'));
    const items = [];
    if (!q || norm(niger.fr).includes(q)) {
      items.push(`<button type="button" class="axc-item" data-iso="${niger.iso}">
        <span class="axc-flag">${niger.flag}</span><span class="axc-name">${niger.fr}</span>
        <span class="axc-chip">${tr('Programme intégré ✨')}</span></button>`);
    }
    items.push(others.map((c) => `<button type="button" class="axc-item" data-iso="${c.iso}">
      <span class="axc-flag">${c.flag}</span><span class="axc-name">${c.fr}</span></button>`).join(''));
    listEl.innerHTML = items.join('') || `<div class="axc-empty-mini">${tr('Aucun pays trouvé')}</div>`;
    listEl.querySelectorAll('.axc-item').forEach((el) => {
      el.addEventListener('click', () => pick(el.dataset.iso));
    });
  }

  function pick(iso) {
    const info = countryInfo(iso);
    if (!info) return;
    pendingCode = iso;
    confirmCountryEl.innerHTML = `<span class="axc-flag">${info.flag}</span><span>${info.fr}</span>`;
    confirmNoteEl.innerHTML = info.iso === NIGER_ISO
      ? `<b>${tr('Le Niger')} :</b> ${tr('le programme complet (cours, exercices, corrections, examens) est déjà intégré à Arvexa.')}<br>${tr('Ce choix est définitif.')}`
      : `<b>${info.fr} :</b> ${tr('pour les matières littéraires (philosophie, histoire, géographie), tu ajouteras progressivement les chapitres que tu étudies à l’école — partagés avec les élèves de ton pays.')}<br>${tr('Ce choix est définitif.')}`;
    confirmStep.classList.add('show');
    listEl.style.display = 'none';
    searchEl.closest('.axc-search').style.display = 'none';
  }

  function unpick() {
    pendingCode = null;
    confirmStep.classList.remove('show');
    listEl.style.display = 'flex';
    searchEl.closest('.axc-search').style.display = '';
    searchEl.focus();
  }

  function finish() {
    overlay.classList.remove('show');
    document.body.style.overflow = '';
    setTimeout(() => overlay.remove(), 260);
    forcedOpen = false;
    if (typeof onDone === 'function') onDone(getCountry());
  }

  overlay.querySelector('#axcConfirmBtn').addEventListener('click', () => {
    if (!pendingCode) return;
    const info = countryInfo(pendingCode);
    confirmCountry(pendingCode);
    toast(`${tr('Pays confirmé')} : ${info.flag} ${info.fr}`);
    finish();
  });
  overlay.querySelector('#axcBack').addEventListener('click', unpick);
  searchEl.addEventListener('input', () => renderList(searchEl.value));
  searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = listEl.querySelector('.axc-item'); if (first) first.click(); } });

  renderList('');
  requestAnimationFrame(() => { overlay.classList.add('show'); setTimeout(() => searchEl.focus(), 300); });
  return true;
}

// ─── MODALE D'AJOUT PROGRESSIF DE CHAPITRES ─────────────────────────
let entryOpen = false;
function openChapterEntry(subject, subjectLabel, opts) {
  opts = opts || {};
  if (entryOpen) return;
  injectCss();
  entryOpen = true;
  const c = getCountry();
  const info = c.info || {};

  const overlay = document.createElement('div');
  overlay.className = 'axc-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="axc-modal">
      <div class="axc-head">
        <span class="axc-globe">📚</span>
        <h2 class="axc-title">${tr('Chapitres de')} <em>${subjectLabel || subject}</em></h2>
        <p class="axc-sub">${info.flag ? info.flag + ' ' + info.fr + ' · ' : ''}${tr('Ajoute les chapitres que tu étudies à l’école, un par un. Ils seront partagés avec les élèves de ton pays.')}</p>
      </div>
      <div class="axc-body">
        <div class="axc-entry-row">
          <input type="text" id="axcEntryInput" maxlength="${TITLE_MAX}" placeholder="${tr('Ex : La dialectique marxiste')}">
          <button type="button" class="axc-entry-add" id="axcEntryAdd">${tr('Ajouter')}</button>
        </div>
        <div class="axc-entry-list" id="axcEntryList"></div>
        <div class="axc-actions" style="margin-top:4px">
          <button type="button" class="axc-btn axc-btn-gold" id="axcEntryDone"><i class="fas fa-check"></i> ${tr('Terminé')}</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const input = overlay.querySelector('#axcEntryInput');
  const listEl = overlay.querySelector('#axcEntryList');
  const uid = (currentUser && currentUser.uid) || null;

  function renderList() {
    const list = getCurriculum(subject) || [];
    if (!list.length) {
      listEl.innerHTML = `<div class="axc-empty-mini">${tr('Aucun chapitre pour l’instant — ajoute le premier !')}</div>`;
      return;
    }
    listEl.innerHTML = list.map((ch) => {
      const mine = ch.local || !ch.addedBy || (uid && ch.addedBy === uid);
      const rm = mine ? `<button type="button" class="axc-chip-remove" data-slug="${ch.slug}" title="${tr('Retirer')}" aria-label="${tr('Retirer')}"><i class="fas fa-times"></i></button>` : '';
      return `<span class="axc-chip-item">${rm}<span>${ch.title}</span></span>`;
    }).join('');
    listEl.querySelectorAll('.axc-chip-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        removeChapter(subject, btn.dataset.slug);
      });
    });
  }

  async function submit() {
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    const res = await addChapter(subject, value);
    if (!res.ok && res.reason === 'existe') toast(tr('Ce chapitre est déjà dans la liste'));
    else if (!res.ok && res.reason === 'limite') toast(tr('Limite de chapitres atteinte'));
    else if (res.ok && res.shared) toast(`${tr('Chapitre partagé')} ✨`);
    else if (res.ok) toast(res.offline ? tr('Chapitre ajouté (sera partagé en ligne)') : tr('Chapitre ajouté'));
    renderList();
    input.focus();
  }

  overlay.querySelector('#axcEntryAdd').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) done(); });

  // ✅ v8.9 — la liste suit les ajouts/retraits EN DIRECT (les siens et ceux
  // des autres élèves du même pays, via le temps réel du programme).
  const onCurrChange = () => { if (entryOpen && document.body.contains(overlay)) renderList(); };
  window.addEventListener('arvexa-curricula-change', onCurrChange);

  function done() {
    overlay.classList.remove('show');
    document.body.style.overflow = '';
    window.removeEventListener('arvexa-curricula-change', onCurrChange);
    setTimeout(() => overlay.remove(), 260);
    entryOpen = false;
    if (typeof opts.onDone === 'function') opts.onDone();
  }
  overlay.querySelector('#axcEntryDone').addEventListener('click', done);

  renderList();
  requestAnimationFrame(() => { overlay.classList.add('show'); setTimeout(() => input.focus(), 300); });
}

// ─── API EXPORTÉE ───────────────────────────────────────────────────
const ArvexaCountry = {
  countries: AFRIQUE,
  ready, getCountry, isNiger, isConfirmed, needsCountryPopup, confirmCountry,
  useCommunity, getCurriculum, loadCurriculum, watchCurriculum,
  addChapter, removeChapter, slugify, maybeShowForcedModal, openChapterEntry, toast,
  LITERARY_SUBJECTS
};
window.ArvexaCountry = ArvexaCountry;
export default ArvexaCountry;

// CSS injecté automatiquement au chargement du module (les pages hôtes
// affichent des éléments .axc-* dès leur premier rendu).
try { injectCss(); } catch (e) {}
