// ================================================================
// API EXAM v6.2 — ARVEXA School
// Corrections : Cas B, Notes strictes, Niveau BAC, Schémas Physique
// v4.15 : heavy 3→5/min, 429+retryAfter (re-essai auto côté client), contrat de
// complétion IA (30/30 questions non vides), gradation Sujet 1→2, validation
// stricte des énoncés + rattrapage "presque complet" depuis le pool d'exercices
// v4.16 : VARIATION TOTALE — temperature 1.0 en génération, tirage aléatoire
// (contexte nigérien + approche + contrainte numérique) à CHAQUE appel, liste
// des énoncés déjà servis (avoidStatements client) interdits de recyclage,
// tirage ALÉATOIRE dans le pool de rattrapage (fini candidates[0])
// v4.17 : DES CALCULS, PAS DES HISTOIRES (référence fiches Pascal Lainé) — les
// matières scientifiques livrent des exercices de CALCUL PUR (expression /
// équation / données techniques à transformer) : au minimum 2 sur 3 par sujet,
// situation réelle devenue FACULTATIVE (max 1/sujet) ; tirage de TECHNIQUES de
// calcul (VARIATION_CALC_DRILLS) + angles de calcul (VARIATION_CALC_ANGLES) ;
// difficultés calibrées en exemples de calculs (easy (3+6i)/(-3-4i) → bac
// z^4+(3-6i)z^2-8-6i=0) ; matières littéraires inchangées (contexte imposé)
// ================================================================


const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW_LIGHT = 60;
// ✅ v4.15 — heavy 3→5/min : une classe entière derrière une IP partagée (CGNAT)
// essuyait des 429 dès les 3e génération ; 5/min reste prudent pour le quota Groq.
const MAX_REQUESTS_PER_WINDOW_HEAVY = 5;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt', 'philosophie', 'histoire', 'geographie']);
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'bac']);
const ALLOWED_DURATIONS = new Set([30, 60, 90, 120, 180]);
const ALLOWED_ACTIONS = new Set(['generate', 'correct', 'listExams', 'loadExam', 'deleteExam']);
const LIGHT_ACTIONS = new Set(['listExams', 'loadExam', 'deleteExam']);
const PREMIUM_ACTIONS = new Set(['listExams', 'loadExam']);
const REQUIRED_EXERCISES = 3;
const QUESTIONS_PER_EXERCISE = 5;
const TOTAL_POINTS = 20;
const FREE_EXAM_LIMIT = 2;
const POOL_COLLECTION = 'examPool';

const MAX_TOKENS = {
  GENERATE: 8000, // ✅ Baissé de 16000 à 8000 pour éviter les timeouts
  CORRECT: 8000,
  PROVIDER_DEFAULT: 8000
};

const SUBJECT_LABELS = {
  mathematiques: 'Mathématiques',
  physique: 'Physique',
  chimie: 'Chimie',
  svt: 'SVT',
  philosophie: 'Philosophie',
  histoire: 'Histoire',
  geographie: 'Géographie'
};

const CHOICE_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie']);

let adminServices = null;

function getAdminServices() {
  if (adminServices) return adminServices;
  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials) throw new Error('firebase_admin_not_configured');
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(credentials);
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  adminServices = {
    auth: admin.auth(),
    db: admin.firestore(),
    FieldValue: admin.firestore.FieldValue
  };
  return adminServices;
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

// ✅ v4.13 — buckets ISOLÉS light/heavy : avant, un seul compteur par IP était
// partagé — 3 lectures légères épuisaient le quota lourd (3/min) et
// bloquaient une génération au premier essai.
function rateLimited(ip, maxRequests, group) {
  const limit = typeof maxRequests === 'number' ? maxRequests : MAX_REQUESTS_PER_WINDOW_HEAVY;
  const key = `${ip}|${group || 'heavy'}`;
  const now = Date.now();
  const recent = (requestLog.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  requestLog.set(key, recent);
  if (requestLog.size > 5000) {
    for (const [k, v] of requestLog) {
      if (v.every((t) => now - t >= WINDOW_MS)) requestLog.delete(k);
    }
  }
  return recent.length > limit;
}

function jsonError(response, status, error, code) {
  const payload = { success: false, error };
  if (code) payload.code = code;
  return response.status(status).json(payload);
}

function applyCors(request, response) {
  const ALLOWED_ORIGINS = new Set([
    'https://arvexaschool.vercel.app',
    'https://admin-89.vercel.app',
    'http://localhost:3000',
    'http://localhost:5000'
  ]);
  // ✅ FIX (2026-10-26) — autoriser l'origine du déploiement courant (déduite
  // des en-têtes Vercel) et APP_ORIGIN, pour que le changement de domaine
  // Vercel ne casse plus les appels cross-origin.
  const envOrigin = (process.env.APP_ORIGIN || '').trim().replace(/\/+$/, '');
  if (envOrigin) ALLOWED_ORIGINS.add(envOrigin.startsWith('http') ? envOrigin : `https://${envOrigin}`);
  const selfProto = String(request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const selfHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
  if (selfHost) ALLOWED_ORIGINS.add(`${selfProto}://${selfHost}`);
  const origin = request.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
  }
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('Access-Control-Max-Age', '86400');
}

async function verifyFirebaseToken(request) {
  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try { return await getAdminServices().auth.verifyIdToken(match[1]); }
  catch (_) { return null; }
}

function isPremiumUser(data) {
  if (!data) return false;
  const status = data.subscriptionStatus || 'none';
  if (status === 'pending') return false;
  const hasPremium = data.premium === true || data.isUnlocked === true || data.hasDeposited === true;
  const end = data.subscriptionEndDate?.toDate?.() ||
    (data.subscriptionEndDate?.seconds ? new Date(data.subscriptionEndDate.seconds * 1000) : null);
  if (hasPremium && end) return end.getTime() > Date.now();
  if (status === 'expired') return false;
  if (hasPremium && !end) return true;
  return false;
}

function toISO(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v._seconds !== undefined) return new Date(v._seconds * 1000).toISOString();
  if (v.seconds !== undefined) return new Date(v.seconds * 1000).toISOString();
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return null;
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const UNICODE_TO_LATEX = {
  'π': '\\pi ', '√': '\\sqrt{}', '×': '\\times ', '÷': '\\div ',
  '≤': '\\leq ', '≥': '\\geq ', '≠': '\\neq ', '∞': '\\infty ',
  '→': '\\to ', '∈': '\\in ', '∑': '\\sum ', '∫': '\\int ',
  'Δ': '\\Delta ', 'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ',
  'θ': '\\theta ', 'λ': '\\lambda ', 'μ': '\\mu ', 'σ': '\\sigma ',
  '²': '^{2}', '³': '^{3}', '¹': '^{1}', '⁴': '^{4}', 'ⁿ': '^{n}',
  '·': '\\cdot ', '±': '\\pm ', '⁰': '^{0}'
};

function replaceUnicodeMath(text) {
  if (!text || typeof text !== 'string') return text;
  let r = text;
  for (const [u, l] of Object.entries(UNICODE_TO_LATEX)) r = r.split(u).join(l);
  return r;
}

function wrapOrphanLatex(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.includes('$')) return text;
  let r = text;
  r = r.replace(/(\\[a-zA-Z]+(?:\{[^}]*\}){1,3})/g, ' $$$1$$ ');
  r = r.replace(/(\\[a-zA-Z]+)(?![a-zA-Z{]|\$)/g, ' $$$1$$ ');
  r = r.replace(/([_^]\{[^}]*\})/g, ' $$$1$$ ');
  r = r.replace(/\${3,}/g, '$$').replace(/\$\s*\$/g, '').replace(/\s+/g, ' ').trim();
  return r;
}

function escapeHtmlOutsideLatex(text) {
  if (!text || typeof text !== 'string') return text;
  const parts = text.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }).join('');
}

function cleanText(text) {
  if (!text || typeof text !== 'string') return text;
  return escapeHtmlOutsideLatex(wrapOrphanLatex(replaceUnicodeMath(text)));
}

function deepClean(obj) {
  if (typeof obj === 'string') return cleanText(obj);
  if (Array.isArray(obj)) return obj.map(deepClean);
  if (obj && typeof obj === 'object') {
    const c = {};
    for (const k in obj) c[k] = deepClean(obj[k]);
    return c;
  }
  return obj;
}

function getUsageDate() { return new Date().toISOString().slice(0, 10); }

async function reserveFreeGeneration(uid) {
  const { db, FieldValue } = getAdminServices();
  const userRef = db.collection('users').doc(uid);
  const usageDate = getUsageDate();
  const usageRef = userRef.collection('examUsage').doc(usageDate);

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const usageSnapshot = await transaction.get(usageRef);
    if (!userSnapshot.exists) throw new Error('profile_missing');
    if (isPremiumUser(userSnapshot.data())) return { premium: true, reserved: false };
    const used = Number(usageSnapshot.data()?.count || 0);
    if (used >= FREE_EXAM_LIMIT) return { premium: false, reserved: false, limitReached: true, used };
    transaction.set(usageRef, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { premium: false, reserved: true, usageDate, used: used + 1 };
  });
}

async function releaseFreeGeneration(uid, usageDate) {
  if (!usageDate) return;
  try {
    const { db, FieldValue } = getAdminServices();
    const usageRef = db.collection('users').doc(uid).collection('examUsage').doc(usageDate);
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(usageRef);
      const used = Math.max(0, Number(snap.data()?.count || 0) - 1);
      transaction.set(usageRef, { count: used, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (_) {}
}

function getProviders() {
  const providers = [];
  if (process.env.GROQ_API_KEY) {
    providers.push(
      { name: 'Groq/gpt-oss-120b', key: process.env.GROQ_API_KEY, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', jsonMode: true, headers: {} },
      { name: 'Groq/llama-3.3-70b', key: process.env.GROQ_API_KEY, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', jsonMode: true, headers: {} },
      { name: 'Groq/gpt-oss-20b', key: process.env.GROQ_API_KEY, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', jsonMode: true, headers: {} },
      { name: 'Groq/llama-3.1-8b', key: process.env.GROQ_API_KEY, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.1-8b-instant', jsonMode: true, headers: {} }
    );
  }
  if (process.env.OPENROUTER_API_KEY) {
    const orHeaders = {
      'HTTP-Referer': process.env.APP_ORIGIN || '',
      'X-Title': 'ARVEXA Exam'
    };
    providers.push(
      { name: 'OpenRouter/inkling:free', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'thinkingmachines/inkling:free', jsonMode: true, headers: orHeaders },
      { name: 'OpenRouter/dots3:free', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'dots-studio/dots3-note-preview:free', jsonMode: true, headers: orHeaders },
      { name: 'OpenRouter/inkling-small:free', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'thinkingmachines/inkling-small:free', jsonMode: true, headers: orHeaders }
    );
  }
  if (process.env.MISTRAL_API_KEY) {
    providers.push(
      { name: 'Mistral/' + (process.env.MISTRAL_MODEL || 'open-mistral-nemo'), key: process.env.MISTRAL_API_KEY, endpoint: 'https://api.mistral.ai/v1/chat/completions', model: process.env.MISTRAL_MODEL || 'open-mistral-nemo', jsonMode: false, headers: {} }
    );
  }
  return providers;
}

async function callProvider(provider, prompt, maxTokens, temperature) {
  if (!maxTokens) maxTokens = MAX_TOKENS.PROVIDER_DEFAULT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000); // ✅ Augmenté à 45s
  try {
    console.log(`[AI] ${provider.name} | prompt: ${prompt.length} car | max_tokens: ${maxTokens}`);

    const body = {
      model: provider.model,
      // ✅ v4.16 — 1.0 pour la GÉNÉRATION (créativité maximale : finis les exercices
      // clonés d'une relance à l'autre), 0.3 conservé pour la CORRECTION (notation stable).
      temperature: typeof temperature === 'number' ? temperature : 0.3,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: 'Tu produis exclusivement du JSON valide. Tu respectes scrupuleusement le schéma demandé.' },
        { role: 'user', content: prompt }
      ]
    };
    if (provider.jsonMode) body.response_format = { type: 'json_object' };
    // gpt-oss = modèle de raisonnement : effort bas → tokens réservés au contenu
    if (/gpt-oss/.test(provider.model || '')) body.reasoning_effort = 'low';

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + provider.key
    };
    if (provider.headers) Object.assign(headers, provider.headers);

    const result = await fetch(provider.endpoint, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal
    });

    const data = await result.json().catch(() => null);
    if (!result.ok) {
      const msg = data?.error?.message || data?.message || ('HTTP ' + result.status);
      throw new Error(provider.name + ': ' + msg);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(provider.name + ': réponse vide');

    console.log(`[AI] ${provider.name} — réponse: ${content.length} car`);

    const cleaned = String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try { return JSON.parse(cleaned); }
    catch (e) {
      console.warn(`[AI] ${provider.name} — JSON invalide. Début: ${cleaned.slice(0, 200)}`);
      throw new Error(provider.name + ': JSON invalide');
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function saveExercisesToPool(exam, subject, difficulty, uid) {
  try {
    const { db, FieldValue } = getAdminServices();
    const batch = db.batch();
    let savedCount = 0;

    exam.subjects.forEach((subjectData) => {
      subjectData.exercises.forEach((exercise) => {
        if (!exercise.questions || exercise.questions.length === 0) return;
        const ref = db.collection(POOL_COLLECTION).doc();
        batch.set(ref, {
          subject,
          level: subjectData.level,
          difficulty,
          chapter: exam.chapter || 'all',
          title: exercise.title || 'Exercice',
          points: exercise.points || 6.67,
          statement: exercise.statement || '',
          questions: exercise.questions || [],
          source: 'ai',
          generatedBy: uid,
          createdAt: FieldValue.serverTimestamp(),
          usedCount: 0
        });
        savedCount++;
      });
    });

    if (savedCount > 0) {
      await batch.commit();
      console.log(`[POOL] ${savedCount} exercices sauvegardés pour ${subject}`);
    }
  } catch (e) {
    console.warn('[POOL] Erreur sauvegarde:', e.message);
  }
}

async function buildExamFromPool(config) {
  try {
    const { db, FieldValue } = getAdminServices();
    const snap = await db.collection(POOL_COLLECTION)
      .where('subject', '==', config.subject)
      .limit(200)
      .get();

    if (snap.empty) return null;

    const allEx = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let poolEx = allEx;
    if (config.chapter && config.chapter !== 'all') {
      const byChapter = allEx.filter((e) => e.chapter === config.chapter);
      if (byChapter.length >= 6) {
        poolEx = byChapter;
      }
    }

    let filtered = poolEx.filter((e) => e.difficulty === config.difficulty);
    if (filtered.length < 6) filtered = poolEx;

    const consolidation = filtered.filter((e) => e.level === 'consolidation');
    const approfondissement = filtered.filter((e) => e.level === 'approfondissement');

    if (consolidation.length < 3) {
      consolidation.push(...filtered.filter((e) => !consolidation.includes(e)));
    }
    if (approfondissement.length < 3) {
      approfondissement.push(...filtered.filter((e) => !approfondissement.includes(e)));
    }

    if (consolidation.length < 3 || approfondissement.length < 3) return null;

    consolidation.sort((a, b) => (a.usedCount || 0) - (b.usedCount || 0));
    approfondissement.sort((a, b) => (a.usedCount || 0) - (b.usedCount || 0));

    const pickedCons = shuffle(consolidation.slice(0, Math.min(8, consolidation.length))).slice(0, 3);
    const pickedApp = shuffle(approfondissement.slice(0, Math.min(8, approfondissement.length))).slice(0, 3);

    const batch = db.batch();
    [...pickedCons, ...pickedApp].forEach((ex) => {
      batch.update(db.collection(POOL_COLLECTION).doc(ex.id), {
        usedCount: FieldValue.increment(1),
        lastUsedAt: FieldValue.serverTimestamp()
      });
    });
    await batch.commit().catch(() => {});

    console.log('[POOL] Examen reconstruit depuis le pool');

    return repairExamStructure({
      subject: config.subject,
      level: config.level,
      duration: config.duration,
      totalPoints: TOTAL_POINTS,
      chapter: config.chapter,
      fromNotebook: false,
      subjects: [
        {
          id: 'subject_1',
          title: 'Sujet 1 — Consolidation',
          level: 'consolidation',
          instructions: 'Traitez les exercices dans le temps imparti.',
          exercises: pickedCons
        },
        {
          id: 'subject_2',
          title: 'Sujet 2 — Approfondissement',
          level: 'approfondissement',
          instructions: 'Traitez les exercices dans le temps imparti.',
          exercises: pickedApp
        }
      ],
      _fromPool: true
    }, config.subject);
  } catch (e) {
    console.warn('[POOL] Erreur reconstruction:', e.message);
    return null;
  }
}

async function buildUnavailableExam(config) {
  return {
    subject: config.subject,
    level: config.level,
    duration: config.duration,
    totalPoints: TOTAL_POINTS,
    chapter: config.chapter,
    fromNotebook: false,
    unavailable: true,
    message: 'Le service est temporairement indisponible. Merci de réessayer dans quelques minutes.',
    subjects: [
      { id: 'subject_1', title: 'Indisponible', level: 'consolidation', instructions: '', exercises: [] },
      { id: 'subject_2', title: 'Indisponible', level: 'approfondissement', instructions: '', exercises: [] }
    ]
  };
}

// ================================================================
// RÈGLES PÉDAGOGIQUES ET DE DIFFICULTÉ
// ================================================================

const LATEX_RULES = `
═══════════════════════════════════════════════════════════════
RÈGLES LATEX — OBLIGATOIRES
═══════════════════════════════════════════════════════════════
1. Formule mathématique TOUJOURS entre $...$ ou $$...$$.
2. INTERDIT de mettre du LaTeX brut sans $.
3. INTERDIT d'utiliser des symboles Unicode : π → $\\pi$, √ → $\\sqrt{}$, × → $\\times$, ≤ → $\\leq$, ≥ → $\\geq$, ∞ → $\\infty$, Δ → $\\Delta$, ² → $^2$, etc.
4. Fractions : $\\frac{...}{...}$. Vecteurs : $\\vec{u}$. Ensembles : $\\mathbb{R}$.
5. Unités avec petit espace : $9{,}81\\,\\text{m/s}^2$.
`;

const PEDAGOGY_RULES = `
═══════════════════════════════════════════════════════════════
MISSION PÉDAGOGIQUE (NIVEAU BAC NIGER)
═══════════════════════════════════════════════════════════════
Tu prépares un élève de Terminale D au Niger pour le BAC.
Les exercices doivent être :
- Réalistes (niveau BAC, comme les épreuves officielles)
- Progressifs (facile → difficile au sein du même exercice)
- Chaque question teste UNE notion précise, mais peut nécessiter plusieurs étapes.
- Les points sont FIXES : Exercice = 6.67 pts, Question = 1.33 pts.
- STYLE DE RÉFÉRENCE (matières scientifiques) — fiches de CALCULS type "Pascal Lainé" : l'exercice donne une expression, une équation ou des données techniques, et l'élève calcule, transforme, résout. La difficulté vient des CALCULS, pas d'un habillage narratif.
- INTERDIT de générer une question sans travail réel (simple recopie du cours) comme de noyer un calcul dans un long récit. L'élève doit réfléchir sur des CALCULS.
`;

const DIFFICULTY_RULES = {
  easy: `Niveau FACILE : Calculs directs en 1 ou 2 étapes. Application immédiate du cours. Pas de mélange de notions. (Ex. Maths : mettre sous la forme algébrique z = (3+6i)/(-3-4i) ; calculer (3+2i)(1-3i).)`,
  medium: `Niveau MOYEN : Calculs en 3 ou 4 étapes. Application du cours avec une petite réflexion. (Ex. Maths : écrire sous forme algébrique 2e^{2iπ/3} et ((1+i)/(2-i))² ; module et argument de (1+i)^9/(1-i)^7.)`,
  hard: `Niveau DIFFICILE : Calculs longs à plusieurs étapes. L'élève doit mobiliser plusieurs notions du chapitre. (Ex. Maths : module et argument de a = 3i(2+i)(4+2i)(1+i) en fonction de θ₀ ; calcul de ((1+i√3)/2)^{2010}.)`,
  bac: `Niveau BAC (TRÈS DIFFICILE) : Exercices de synthèse type "Pascal Laine" ou "Salissou Nazifi". 
  - Les calculs doivent être longs (équations du 3ème/4ème degré, changements de variable, trigonométrie inverse).
  - Mélanger plusieurs phases de mouvement ou plusieurs réactions.
  - L'élève doit utiliser un cahier de brouillon pour réussir.
  - Exemple Maths : "Résoudre z^4 + (3-6i)z^2 - 8 - 6i = 0".
  - Exemple Physique : "Une voiture et un motard se croisent, calculer l'instant et la position de dépassement."`
};

const PHYSICS_RULES = `
═══════════════════════════════════════════════════════════════
RÈGLES SPÉCIFIQUES PHYSIQUE
═══════════════════════════════════════════════════════════════
1. L'énoncé décrit une situation technique COURTE (1-2 phrases max, ex: un motard rattrape un camion) puis on passe immédiatement au CALCUL : équations horaires, théorèmes, applications numériques. Pas d'histoire longue.
2. LA PREMIÈRE QUESTION (1.a) EST OBLIGATOIREMENT DE TYPE "drawing" :
   - Demander de faire le schéma, de placer le repère, ou de tracer les vecteurs.
3. Les questions suivantes (1.b à 1.e) demandent des équations horaires, des calculs de distance/temps, ou des analyses graphiques.
`;

const CHEMISTRY_RULES = `
═══════════════════════════════════════════════════════════════
RÈGLES SPÉCIFIQUES CHIMIE
═══════════════════════════════════════════════════════════════
1. PAS de question de dessin. Toutes les questions sont de type "text" ou "choice".
2. L'énoncé ("statement") DOIT inclure un bloc "Données :" (masses molaires, volumes, concentrations).
3. Les questions doivent être progressives : 
   - Q1 : Équation de dissolution ou masse molaire.
   - Q2 : Calcul de concentration.
   - Q3 : Calcul de pH ou inventaire des espèces.
   - Q4 : Dilution ou électroneutralité.
`;

const STRUCTURE_CONTROL = `
═══════════════════════════════════════════════════════════════
CONTRÔLE STRUCTUREL OBLIGATOIRE
═══════════════════════════════════════════════════════════════
Ton JSON contient EXACTEMENT :
- "subjects" : tableau de 2 objets
- Chaque subject a : "id" ("subject_1" / "subject_2"), "title", "level", "instructions", "exercises" (3 objets)
- Chaque exercise a : "number" (1-3), "title", "points" (6.67), "statement", "questions" (5 objets)
- Chaque question a : "number" ("1.a"), "text", "points" (1.33), "type" ("choice", "text", ou "drawing")
  - Si "choice" : "options" (4 objets {id:A/B/C/D, text}) + "correctAnswer" (A/B/C/D)
  - Si "text" : PAS d'options, PAS de correctAnswer
  - Si "drawing" : PAS d'options, PAS de correctAnswer (utilisé uniquement en Physique Q1)

CONTRAT DE COMPLÉTION — ABSOLUMENT OBLIGATOIRE :
- Tu livres l'INTÉGRALITÉ des 30 questions (2 sujets × 3 exercices × 5 questions), JAMAIS une réponse partielle.
- CHAQUE question a un énoncé ("text") COMPLET et NON VIDE : la question posée, les données numériques et l'unité attendue.
- CHAQUE exercice a un "statement" non vide qui pose les données de ses 5 questions (expression à transformer, équation, données techniques ou courte situation).
- Si tu manques de place, raccourcis les formulations mais ne supprime JAMAIS une question et ne mets jamais "..." ou "".
- VÉRIFICATION FINALE AVANT DE RÉPONDRE : compte tes questions (15 par sujet). S'il en manque, complète-les AVANT d'émettre ta réponse.
- INTERDIT de renvoyer un commentaire, une excuse ou du texte hors JSON.
`;

// ═════════════════════════════════════════════════════════════
// ✅ v4.16 — VARIATION TOTALE À CHAQUE RELANCE
// Avant : temperature 0.3 + prompt strictement identique ⇒ l'IA resservait
// presque les mêmes exercices à chaque génération. Désormais : température
// créative (1.0) + tirage aléatoire d'un contexte nigérien, d'une approche
// pédagogique et d'une contrainte numérique à CHAQUE appel + liste des
// énoncés déjà servis à cet élève (interdits de recyclage).
// ═════════════════════════════════════════════════════════════
const GEN_TEMPERATURE = 1.0;
const VARIATION_SCIENCES = new Set(['mathematiques', 'physique', 'chimie', 'svt']);

function sanitizeAvoidList(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s) => typeof s === 'string')
    .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 140))
    .filter((s) => s.length >= 12)
    .slice(0, 18);
}

const VARIATION_CONTEXTS = {
  commun: [
    'le grand marché de Niamey un jour de forte affluence',
    'une coopérative maraîchère le long du fleuve',
    'un chantier de construction dans un nouveau quartier',
    'un trajet en car entre Niamey et Zinder',
    'un centre de santé intégré en zone rurale',
    'un forage et le ravitaillement en eau d\'un village',
    'une boutique multi services de quartier',
    'un champ de mil pendant l\'hivernage',
    'un club de jeunes et un tournoi de football inter-quartiers',
    'une station de recharge de téléphones à énergie solaire',
    'une tontine (gada) entre commerçantes',
    'un élevage de volailles familial',
    'un quai de chargement de marchandises au bord du fleuve',
    'une salle de classe lors de la rentrée scolaire',
    'un petit atelier de couture qui reçoit des commandes'
  ],
  mathematiques: [
    'un partage d\'héritage de bétail entre héritiers',
    'un prêt à intérêt simple chez un boutiquier',
    'le tracé d\'une parcelle rectangulaire à clôturer',
    'la progression des ventes d\'un étal de tissus',
    'un réservoir qui se remplit et se vide en même temps',
    'un crédit épargne au sein d\'une association de femmes'
  ],
  physique: [
    'un motard qui rattrape un camion sur la route de Filingué',
    'un ballon lancé depuis la terrasse d\'une maison',
    'un circuit d\'éclairage alimenté par un panneau solaire',
    'un chariot qui descend une rampe de chargement',
    'un seau d\'eau remonté au-dessus d\'un puits',
    'un chauffeur qui freine pour éviter un troupeau'
  ],
  chimie: [
    'une solution de soude préparée au laboratoire du lycée',
    'un engrais dilué avant épandage dans un champ',
    'le dosage d\'un vinaigre artisanal',
    'une dissolution de sel dans l\'eau du fleuve',
    'une pile artisanale à deux électrodes',
    'une analyse d\'eau de forage'
  ],
  svt: [
    'une enquête sur la transmission d\'un caractère dans une famille nigérienne',
    'une mare temporaire et sa vie pendant la saison des pluies',
    'la fermentation d\'un lait local',
    'une fleur disséquée en travaux pratiques',
    'le cycle de l\'eau observé pendant l\'hivernage',
    'un foyer qui s\'éclaire au biogaz'
  ],
  philosophie: [
    'un débat de jeunes sur le travail et la réussite',
    'un dialogue sur la liberté et la tradition',
    'un jugement rendu au village et la question de la justice',
    'une discussion sur la science et la croyance',
    'une réflexion sur l\'argent et le bonheur'
  ],
  histoire: [
    'les résistances à la pénétration coloniale au Sahel',
    'les grands empires et royaumes de l\'espace nigérien',
    'la marche du Niger vers l\'indépendance',
    'les institutions de la République nigérienne',
    'les routes transsahariennes et le commerce ancien'
  ],
  geographie: [
    'l\'exode rural et la croissance des villes du Niger',
    'une région du Niger face à la sécheresse',
    'l\'exploitation de l\'uranium et ses enjeux',
    'les échanges commerciaux transfrontaliers',
    'la mobilité des pasteurs et le peuplement'
  ]
};

const VARIATION_ANGLES = [
  'partir d\'une histoire vécue avant d\'introduire la notion',
  'faire construire ou estimer une grandeur avant de la calculer',
  'demander une comparaison entre deux situations distinctes',
  'faire interpréter le résultat obtenu en fin de question',
  'glisser une donnée superflue que l\'élève doit savoir écarter',
  'emboîter deux notions du programme dans le même exercice',
  'faire une question en deux sous-étapes (a puis b) qui se répondent',
  'terminer l\'exercice par une question de synthèse ouverte'
];

const VARIATION_NUMERIC = [
  'impose-toi des valeurs NON RONDES et inédites (ex. 7,5 ; 12,3 ; 17,25 ; 3/8 ; 2,4×10^3)',
  'impose-toi au moins deux valeurs décimales et une fraction dans chaque exercice',
  'impose-toi au moins une valeur en notation scientifique et une valeur impaire',
  'impose-toi des grandeurs réalistes (masses, distances, durées crédibles au Niger) différentes des valeurs habituelles'
];

const VARIATION_TEXT = [
  'appuie chaque argument sur un exemple précis, daté ou localisé',
  'impose-toi un vocabulaire technique du programme',
  'fais référence à une situation nigérienne concrète dans au moins une question',
  'varie les types de questions : une analyse, une mise en relation, un jugement argumenté'
];

// ✅ v4.17 — TECHNIQUES de calcul tirées au hasard à CHAQUE appel (matières
// scientifiques) : la variété vient du TYPE DE CALCUL demandé (style fiches
// Pascal Lainé : formes à transformer, équations à résoudre, modules/arguments,
// puissances élevées...) et non plus d'un contexte narratif imposé.
const VARIATION_CALC_DRILLS = {
  mathematiques: [
    'calculs de transformation directe : mettre sous forme algébrique a+ib des quotients, produits ou carrés (ex. z = (3+6i)/(-3-4i) ; ((1+i)/(2-i))²)',
    'calculs de module, argument, formes trigonométrique et exponentielle (ex. écrire 2e^{2iπ/3} sous forme algébrique ; module et argument d un produit comme 3i(2+i)(4+2i)(1+i))',
    'puissances élevées obtenues par la forme trigonométrique (ex. ((1+i√3)/2)^{2010} ; (1+i)^9/(1-i)^7)',
    'résolution d équations (degré 2, équation en z², changement de variable, discriminant)',
    'calculs d images, de limites, de dérivées, de tangentes, de variations',
    'suites : calculs de termes, de raison, de sommes, de seuil',
    'probabilités et dénombrement : calculs directs, arbres pondérés, espérance',
    'calcul vectoriel, coordonnées, distances, milieux, colinéarité'
  ],
  physique: [
    'équations horaires et mouvements : calculs de position, vitesse, instant de rencontre, distance',
    'applications en chaîne des théorèmes du cours : chaque grandeur calculée alimente la question suivante',
    'calculs électriques : loi d Ohm, puissance, énergie, associations de résistors',
    'conversions, notation scientifique et applications numériques rigoureuses avec unités'
  ],
  chimie: [
    'chaînes de calculs quantité de matière / masse molaire / concentration',
    'avancement, tableau d avancement, réactif limitant, rendement',
    'pH, Ka, dosage, dilution : calculs successifs à partir du bloc Données',
    'écriture et équilibrage d équations suivis d applications numériques'
  ],
  svt: [
    'génétique : croisements, échiquiers, proportions phénotypiques calculées',
    'calculs de pourcentages, proportions et taux à partir de données brutes',
    'lecture chiffrée de documents : courbes, tableaux, calculs de variation',
    'restitution structurée appuyée sur des données précises du chapitre'
  ]
};

// ✅ v4.17 — angles de variante 100% CALCUL (remplacent les angles narratifs
// pour les matières scientifiques ; les littéraires gardent VARIATION_ANGLES).
const VARIATION_CALC_ANGLES = [
  'emboîter deux notions du programme dans le même exercice de calcul',
  'faire une question en deux sous-étapes (a puis b) où le résultat de a sert au calcul de b',
  'demander la même grandeur par deux méthodes différentes (vérification croisée)',
  'glisser une expression astucieuse dont une transformation intermédiaire simplifie tout',
  'faire intervenir une valeur exacte puis sa valeur approchée demandée séparément',
  'insérer un "montrer que..." qui guide l élève vers la question suivante',
  'terminer l exercice par une question de synthèse qui combine les résultats précédents'
];

function buildVariationBlock(subject, avoidStatements) {
  const isScience = VARIATION_SCIENCES.has(subject);
  const pool = (VARIATION_CONTEXTS[subject] || []).concat(VARIATION_CONTEXTS.commun);
  const pick = (arr) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : '');
  let c1 = pick(pool);
  let c2 = pick(pool);
  for (let guard = 0; c2 === c1 && guard < 8; guard += 1) c2 = pick(pool);
  const d1 = pick(VARIATION_CALC_DRILLS[subject]);
  let d2 = pick(VARIATION_CALC_DRILLS[subject]);
  for (let guard = 0; d2 === d1 && guard < 8; guard += 1) d2 = pick(VARIATION_CALC_DRILLS[subject]);
  const angle = isScience ? pick(VARIATION_CALC_ANGLES) : pick(VARIATION_ANGLES);
  const constraint = isScience
    ? 'Contrainte numérique : ' + pick(VARIATION_NUMERIC)
    : 'Contrainte rédactionnelle : ' + pick(VARIATION_TEXT);
  const avoid = sanitizeAvoidList(avoidStatements);
  const avoidBlock = avoid.length
    ? '- ÉNONCÉS DÉJÀ SERVUS à cet élève lors de ses générations précédentes — INTERDIT de les reprendre tels quels, de changer seulement les noms ou les nombres, ou d\'en livrer une variante proche :\n' +
      avoid.map((s) => '  • ' + s).join('\n')
    : '';

  // ✅ v4.17 — sciences : DES CALCULS, PAS DES HISTOIRES (fiches type Pascal
  // Lainé). La situation réelle devient FACULTATIVE (1 exercice max par sujet)
  // et la variété vient d abord des TECHNIQUES de calcul tirées au hasard.
  // Littéraires : contexte imposé conservé (inchangé v4.16).
  const styleBlock = isScience
    ? '- STYLE DE RÉFÉRENCE OBLIGATOIRE — DES CALCULS, PAS DES HISTOIRES (fiches d\'entraînement type "Pascal Lainé") :\n' +
      '  • L\'exercice DONNE une expression, une équation ou des données techniques ; l\'élève calcule, transforme, résout. Pas de récit, pas d\'histoire.\n' +
      '  • Au minimum 2 exercices sur 3 PAR SUJET sont des calculs PURS (aucune histoire) ; au maximum 1 seul exercice par sujet peut être ancré dans une situation réelle.\n' +
      '  • La difficulté vient des calculs eux-mêmes (nombre d\'étapes, techniques combinées, expression astucieuse), JAMAIS d\'un habillage narratif.\n' +
      '  • Les valeurs restent CALCULABLES (résultats exacts ou arrondis propres ; moduli, angles et solutions simples quand le chapitre s\'y prête).\n' +
      '  • Tirage technique imposé Sujet 1 : ' + d1 + '\n' +
      '  • Tirage technique imposé Sujet 2 : ' + d2 + '\n' +
      '  • (Ces techniques imposent le STYLE de l\'exercice ; applique-les au chapitre exigé ci-dessus.)\n'
    : '';
  const contextLines = isScience
    ? '- Situation réelle DISPONIBLE (FACULTATIVE — au maximum 1 exercice sur 3 par sujet ; les 2 autres restent des calculs purs) pour Sujet 1 si vraiment nécessaire : ' + c1 + '\n' +
      '- Situation réelle DISPONIBLE (FACULTATIVE — même règle) pour Sujet 2 si vraiment nécessaire : ' + c2
    : '- Contexte imposé Sujet 1 (si compatible avec le contenu exigé) : ' + c1 + '\n' +
      '- Contexte imposé Sujet 2 (si compatible avec le contenu exigé) : ' + c2;

  return `══════════════════════════════════════════════════════════════
VARIATION OBLIGATOIRE — TIRAGE N° ${Math.floor(Math.random() * 900000000) + 100000000}
══════════════════════════════════════════════════════════════
Chaque appel doit produire un examen 100% INÉDIT : énoncés, valeurs, techniques et questions changent TOTALEMENT d'une génération à l'autre.
${styleBlock}${contextLines}
- Approche imposée : ${angle}
- ${constraint}
- INTERDIT de recycler les exercices classiques ou une génération précédente : même trame ou mêmes données = échec.
${avoidBlock}`;
}

function generationPrompt(config, avoidStatements) {
  const subjectLabel = SUBJECT_LABELS[config.subject] || config.subject;
  
  let specificRules = '';
  if (config.subject === 'physique') specificRules = PHYSICS_RULES;
  else if (config.subject === 'chimie') specificRules = CHEMISTRY_RULES;
  
  const diffRules = DIFFICULTY_RULES[config.difficulty] || DIFFICULTY_RULES.medium;
  const variationBlock = buildVariationBlock(config.subject, avoidStatements);

  return `Tu es un professeur expert du BAC au Niger.

${PEDAGOGY_RULES}
${specificRules}

MISSION : Génère DEUX sujets d'examen complets.

Matière : ${subjectLabel}
Niveau : ${config.level}
Chapitre : ${config.chapter === 'all' ? 'tous les chapitres' : config.chapter}
Difficulté exigée : ${config.difficulty}
RÈGLES DE DIFFICULTÉ :
${diffRules}

SUJET 1 — "Consolidation" (facile à moyen) : tester les bases.
SUJET 2 — "Approfondissement" (moyen à difficile) : aller plus loin.
GRADATION OBLIGATOIRE : le Sujet 2 doit être VISIBLEMENT plus difficile que le Sujet 1 (énoncés plus riches, plus d'étapes de calcul, notions combinées) tout en respectant la difficulté exigée ci-dessus. Interdit de livrer deux sujets de même difficulté.

${variationBlock}

${LATEX_RULES}

FORMAT JSON :
{
  "subject": "${config.subject}",
  "level": "${config.level}",
  "duration": ${config.duration},
  "totalPoints": 20,
  "chapter": "${config.chapter}",
  "subjects": [
    { "id": "subject_1", "title": "Sujet 1 — Consolidation", "level": "consolidation", "instructions": "...", "exercises": [] },
    { "id": "subject_2", "title": "Sujet 2 — Approfondissement", "level": "approfondissement", "instructions": "...", "exercises": [] }
  ]
}

${STRUCTURE_CONTROL}

Réponds UNIQUEMENT avec le JSON complet et valide.`;
}

function generationPromptFromNotebook(config, notebookContext, avoidStatements) {
  const subjectLabel = SUBJECT_LABELS[config.subject] || config.subject;
  
  let specificRules = '';
  if (config.subject === 'physique') specificRules = PHYSICS_RULES;
  else if (config.subject === 'chimie') specificRules = CHEMISTRY_RULES;
  
  const diffRules = DIFFICULTY_RULES[config.difficulty] || DIFFICULTY_RULES.medium;
  const variationBlock = buildVariationBlock(config.subject, avoidStatements);

  return `Tu es un professeur expert du BAC au Niger.

${PEDAGOGY_RULES}
${specificRules}

L'élève a étudié un chapitre dans son cahier. Génère DEUX sujets basés STRICTEMENT sur ce contenu.

Chapitre : ${notebookContext.chapterTitle}
Matière : ${subjectLabel}
Difficulté exigée : ${config.difficulty}
RÈGLES DE DIFFICULTÉ :
${diffRules}

═══════════════════════════════════════════════════════════════
CONTENU DU CHAPITRE ÉTUDIÉ
═══════════════════════════════════════════════════════════════
${notebookContext.contentText}

RÈGLE ABSOLUE : génère UNIQUEMENT à partir du contenu ci-dessus.

${variationBlock}

${LATEX_RULES}

FORMAT JSON :
{
  "subject": "${config.subject}",
  "level": "${config.level}",
  "duration": ${config.duration},
  "totalPoints": 20,
  "chapter": "${config.chapter}",
  "fromNotebook": true,
  "subjects": [
    { "id": "subject_1", "title": "Sujet 1 — Consolidation", "level": "consolidation", "instructions": "...", "exercises": [] },
    { "id": "subject_2", "title": "Sujet 2 — Approfondissement", "level": "approfondissement", "instructions": "...", "exercises": [] }
  ]
}

${STRUCTURE_CONTROL}

Réponds UNIQUEMENT avec le JSON.`;
}

function correctionPrompt(body) {
  const subject = body.exam.subjects.find((s) => s.id === body.subjectId) || body.exam.subjects[0];
  if (!subject) throw new Error('subject_not_found');

  const questionsDetail = [];
  subject.exercises.forEach((exercise, exIdx) => {
    exercise.questions.forEach((question, qIdx) => {
      const key = body.subjectId + ':' + exIdx + ':' + qIdx;
      questionsDetail.push({
        exerciseNumber: exercise.number || (exIdx + 1),
        exerciseStatement: exercise.statement || '',
        questionNumber: question.number || ((exIdx + 1) + '.' + (qIdx + 1)),
        questionText: question.text,
        type: question.type || 'text',
        options: question.options || null,
        points: Number(question.points) || 1.33,
        correctAnswer: question.correctAnswer || null,
        studentAnswer: body.answers[key] || null,
        answered: body.answers[key] !== null && body.answers[key] !== ''
      });
    });
  });

  return `Tu es un professeur correcteur expert du BAC au Niger. Ton rôle : corriger CHAQUE question avec une PÉDAGOGIE MAXIMALE, en attribuant une NOTE et une EXPLICATION à chaque question, sans exception.

${PEDAGOGY_RULES}

MISSION DE CORRECTION :
Pour CHAQUE question, tu dois produire une analyse pédagogique complète ET une note.

DONNÉES (les numéros "number" ci-dessous sont LA SEULE référence valide) :
${JSON.stringify(questionsDetail, null, 2)}

CE QUE TU DOIS GÉNÉRER POUR CHAQUE QUESTION (obligatoire, sans exception) :
1. "number" : REPRODUIS EXACTEMENT le numéro de la question dans les données (ex: "1.a", "2.c"). INTERDIT de renuméroter, de simplifier ou d'inventer un autre format.
2. "points" : la note décimale attribuée, entre 0 et maxPoints de la question.
3. "status" : "correct" (note max ou presque), "partial" (note intermédiaire), "wrong" (0 mais réponse fournie), "unanswered" (pas de réponse).
4. "explanation" : Explication complète (3-6 phrases), comme un prof qui explique la réponse attendue.
5. "steps" : Tableau des ÉTAPES du calcul (3 à 7 étapes) pour les questions de calcul.
6. "concept" : La notion/théorème testée (une phrase).
7. "whyWrong" : Si l'élève a raté, explication de SON erreur précise.
8. "commonMistake" : L'erreur classique.
9. "toReview" : Ce qu'il faut revoir.
10. "betterMethod" : Une astuce (si pertinent).
11. "feedback" : Message encourageant adapté à SA réponse.

BARÈME STRICT — RÈGLES DE NOTATION (à appliquer rigoureusement) :
- Réponse complète et juste → points = maxPoints (status "correct").
- Réponse contenant une partie correcte (bonne méthode, résultat partiel, idée juste mal formulée) → points PARTIELS entre 0.25×maxPoints et 0.75×maxPoints (status "partial").
- Réponse fournie mais entièrement fausse → 0 (status "wrong").
- Aucune réponse (null, vide) → 0 et status "unanswered".
- ⚠️ INTERDIT FORMEL de donner 0 à une réponse non vide si elle contient des éléments justes. Si l'élève a la bonne démarche ou le bon résultat, il gagne des points.
- ⚠️ Chaque question DOIT avoir "points" ET "status" ET "explanation" — une correction sans note ou sans explication est invalide.

CALCUL DES POINTS — CAS PARTICULIERS
- QCM : compare la réponse de l'élève à correctAnswer. Correcte = points maximaux. Fausse ou absente = 0.
- Texte libre : évalue le FOND (idées justes, démarche, résultat), pas la forme.

${LATEX_RULES}

FORMAT JSON :
{
  "score": 15.5,
  "totalScore": 20,
  "percentage": 77,
  "grade": "Bien",
  "exercises": [
    {
      "number": 1,
      "explanation": "Bilan de l'exercice (2-3 phrases)",
      "advice": "Conseil pour progresser",
      "questions": [
        { "number": "1.a", "points": 1.33, "status": "correct", "explanation": "...", "steps": ["..."], "concept": "...", "whyWrong": null, "commonMistake": "...", "toReview": "...", "betterMethod": "...", "feedback": "..." },
        { "number": "1.b", "points": 0.5, "status": "partial", "explanation": "...", "steps": [], "concept": "...", "whyWrong": "...", "commonMistake": "...", "toReview": "...", "betterMethod": null, "feedback": "..." }
      ]
    }
  ],
  "revisionTopics": ["Notion 1", "Notion 2"],
  "globalFeedback": {
    "strengths": ["Point fort 1"],
    "weaknesses": ["Faiblesse 1"],
    "encouragement": "Message personnalisé"
  }
}

⚠️ Le tableau "exercises" doit contenir les exercices dans le MÊME ORDRE que les données, chaque exercice avec TOUTES ses questions, numéros EXACTS identiques aux données.

CONTRAT DE COMPLÉTION — ABSOLUMENT OBLIGATOIRE :
- Tu rends un verdict (points + status + explanation) pour CHAQUE question des données, SANS EXCEPTION, dans le même ordre.
- Si une réponse d'élève est ambiguë ou mal formulée, tranche avec ton meilleur jugement professionnel — ne saute JAMAIS une question et ne renvoie jamais un objet partiel.
- INTERDIT de renvoyer du texte hors JSON.

Réponds UNIQUEMENT avec l'objet JSON.`;
}

function repairExamStructure(exam, subjectName) {
  if (!exam || typeof exam !== 'object') return null;
  const supportsChoices = CHOICE_SUBJECTS.has(subjectName);

  if (!Array.isArray(exam.subjects)) {
    if (Array.isArray(exam.exams)) exam.subjects = exam.exams;
    else if (Array.isArray(exam.sujets)) exam.subjects = exam.sujets;
    else return null;
  }
  if (exam.subjects.length === 0) return null;
  if (exam.subjects.length === 1) {
    const copy = JSON.parse(JSON.stringify(exam.subjects[0]));
    copy.id = 'subject_2';
    copy.title = 'Sujet 2 — Approfondissement';
    copy.level = 'approfondissement';
    copy.instructions = 'Approfondit votre maîtrise.';
    exam.subjects.push(copy);
  }
  exam.subjects = exam.subjects.slice(0, 2);

  exam.subjects.forEach((subject, sIdx) => {
    if (!subject.id) subject.id = 'subject_' + (sIdx + 1);
    if (!subject.title) subject.title = 'Sujet ' + (sIdx + 1);
    if (!subject.level) subject.level = sIdx === 0 ? 'consolidation' : 'approfondissement';
    
    // ✅ Instructions garanties et DIFFÉRENTES pour chaque sujet
    if (sIdx === 0) {
      subject.instructions = 'Consolidez vos bases avec des exercices progressifs pour maîtriser l\'essentiel du chapitre.';
    } else {
      subject.instructions = 'Allez plus loin avec des exercices exigeants pour viser le niveau BAC.';
    }

    if (!Array.isArray(subject.exercises)) subject.exercises = [];

    while (subject.exercises.length < REQUIRED_EXERCISES) {
      const num = subject.exercises.length + 1;
      subject.exercises.push({
        number: num, title: 'Exercice ' + num, points: 6.67,
        statement: '', questions: []
      });
    }
    subject.exercises = subject.exercises.slice(0, REQUIRED_EXERCISES);

    subject.exercises.forEach((exercise, eIdx) => {
      if (!exercise.number) exercise.number = eIdx + 1;
      if (!exercise.title) exercise.title = 'Exercice ' + (eIdx + 1);
      if (!exercise.points) exercise.points = 6.67;
      if (!exercise.statement) exercise.statement = '';
      if (!Array.isArray(exercise.questions)) exercise.questions = [];

      while (exercise.questions.length < QUESTIONS_PER_EXERCISE) {
        const qNum = exercise.questions.length + 1;
        exercise.questions.push({
          number: (eIdx + 1) + '.' + String.fromCharCode(96 + qNum),
          text: '', points: 1.33, type: 'text'
        });
      }
      exercise.questions = exercise.questions.slice(0, QUESTIONS_PER_EXERCISE);

      exercise.questions.forEach((question, qIdx) => {
        if (!question.number) question.number = (eIdx + 1) + '.' + String.fromCharCode(97 + qIdx);
        if (!question.text) question.text = question.question || '';
        if (!question.points) question.points = 1.33;

        // ✅ RÈGLE SPÉCIALE PHYSIQUE : La Q1 est TOUJOURS un dessin
        if (subjectName === 'physique' && qIdx === 0) {
          question.type = 'drawing';
          delete question.options;
          delete question.correctAnswer;
          if (!question.text.toLowerCase().includes('schéma') && !question.text.toLowerCase().includes('dessin')) {
             question.text = "Faire le schéma du dispositif en précisant le repère et les vecteurs. " + question.text;
          }
        } else {
          if (!question.type) {
            question.type = (Array.isArray(question.options) && question.options.length === 4) ? 'choice' : 'text';
          }

          if (question.type === 'choice') {
            if (!Array.isArray(question.options) || question.options.length !== 4) {
              question.type = 'text';
              delete question.options;
              delete question.correctAnswer;
            } else {
              const letters = ['A', 'B', 'C', 'D'];
              question.options = question.options.map((opt, oi) => {
                const text = typeof opt === 'string' ? opt : (opt?.text || opt?.label || String(opt || ''));
                return { id: letters[oi], text: String(text || '').trim() || ('Option ' + letters[oi]) };
              });

              let correct = question.correctAnswer;
              if (correct === null || correct === undefined) correct = 'A';
              else if (typeof correct === 'number') correct = letters[correct] || 'A';
              else {
                correct = String(correct).toUpperCase().trim();
                if (['A', 'B', 'C', 'D'].indexOf(correct) === -1) correct = 'A';
              }
              question.correctAnswer = correct;
            }
          } else {
            delete question.options;
            delete question.correctAnswer;
          }

          if (!supportsChoices && question.type === 'choice') {
            question.type = 'text';
            delete question.options;
            delete question.correctAnswer;
          }
        }
      });
    });
  });

  return exam;
}

function validateGeneratedExam(exam, subjectName) {
  const supportsChoices = CHOICE_SUBJECTS.has(subjectName);
  const validQuestion = (q) => {
    // ✅ v4.15 — une question SANS énoncé est inacceptable pour l'élève : invalide.
    if (!q || typeof q.text !== 'string' || !q.text.trim()) return false;
    if (subjectName === 'physique' && q.number && q.number.endsWith('a')) {
      return q.type === 'drawing';
    }
    if (!supportsChoices || q.type !== 'choice') return ['text', 'number', 'formula', 'choice', 'drawing'].indexOf(q.type) !== -1;
    return Array.isArray(q.options) && q.options.length === 4 && ['A', 'B', 'C', 'D'].indexOf(q.correctAnswer) !== -1;
  };
  return exam && Array.isArray(exam.subjects) && exam.subjects.length === 2 &&
    exam.subjects.every((s) =>
      Array.isArray(s.exercises) && s.exercises.length === REQUIRED_EXERCISES &&
      s.exercises.every((ex) =>
        Array.isArray(ex.questions) && ex.questions.length === QUESTIONS_PER_EXERCISE &&
        ex.questions.every(validQuestion)
      )
    );
}

// ✅ v4.15 — RATTRAPAGE "PRESQUE COMPLET" : une IA qui livre 13/15 questions
// valables ne doit pas jeter tout le sujet (ni pire, montrer des questions
// vides). On remplace les exercices fautifs par des exercices équivalents du
// pool d'exercices, puis on revalide STRICTEMENT. Si le pool ne suffit pas,
// le résultat est rejeté et le fournisseur suivant prend le relais.
const NEAR_MISS_MAX_EMPTY = 3;

function countEmptyQuestions(exam) {
  let n = 0;
  (exam && Array.isArray(exam.subjects) ? exam.subjects : []).forEach((s) =>
    ((s && s.exercises) || []).forEach((ex) =>
      ((ex && ex.questions) || []).forEach((q) => {
        if (!q || !String(q.text || '').trim()) n += 1;
      })
    )
  );
  return n;
}

function isNearMiss(exam, subjectName) {
  const empty = countEmptyQuestions(exam);
  if (empty === 0 || empty > NEAR_MISS_MAX_EMPTY) return false;
  const lenient = JSON.parse(JSON.stringify(exam));
  lenient.subjects.forEach((s) => (s.exercises || []).forEach((ex) =>
    (ex.questions || []).forEach((q) => {
      if (!String(q.text || '').trim()) q.text = 'placeholder';
    })
  ));
  return validateGeneratedExam(lenient, subjectName);
}

function patchExamFromPoolQuestions(exam, subjectName, poolExercises) {
  if (!exam || !Array.isArray(poolExercises) || !poolExercises.length) return null;
  const seen = new Set();
  exam.subjects.forEach((s) => (s.exercises || []).forEach((ex) => {
    seen.add(String(ex.title || '') + '|' + String(ex.statement || '').slice(0, 40));
  }));

  const pool = poolExercises.filter((p) =>
    p && Array.isArray(p.questions) && p.questions.length >= QUESTIONS_PER_EXERCISE &&
    p.questions.every((q) => String(q.text || '').trim())
  );
  if (!pool.length) return null;

  let patched = false;
  exam.subjects.forEach((subject) => {
    (subject.exercises || []).forEach((ex, eIdx) => {
      const hasEmpty = (ex.questions || []).some((q) => !String(q.text || '').trim());
      if (!hasEmpty) return;
      const sameLevel = pool.filter((p) => p.level === subject.level);
      const candidates = (sameLevel.length ? sameLevel : pool)
        .filter((p) => !seen.has(String(p.title || '') + '|' + String(p.statement || '').slice(0, 40)));
      // ✅ v4.16 — tirage ALÉATOIRE parmi les candidats : deux rattrapages ne
      // resservent pas mécaniquement le même exercice de secours.
      const pick = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
      if (!pick) return;
      seen.add(String(pick.title || '') + '|' + String(pick.statement || '').slice(0, 40));
      subject.exercises[eIdx] = {
        number: ex.number || (eIdx + 1),
        title: pick.title || ('Exercice ' + (eIdx + 1)),
        points: pick.points || 6.67,
        statement: pick.statement || '',
        questions: pick.questions
      };
      patched = true;
    });
  });

  if (!patched) return null;
  return repairExamStructure(exam, subjectName);
}

async function generateWithFallback(prompt, subjectName, poolLoader) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const startTime = Date.now();
  const TIME_BUDGET_MS = 85000;
  const errors = [];

  for (let i = 0; i < providers.length; i++) {
    const elapsed = Date.now() - startTime;
    if (elapsed > TIME_BUDGET_MS) {
      errors.push('time_budget_exceeded');
      break;
    }

    const provider = providers[i];
    try {
      console.log('[AI] Tentative ' + provider.name + '...');
      let rawExam = await callProvider(provider, prompt, MAX_TOKENS.GENERATE, GEN_TEMPERATURE);
      rawExam = repairExamStructure(rawExam, subjectName);

      if (validateGeneratedExam(rawExam, subjectName)) {
        console.log('[AI] OK ' + provider.name);
        return { exam: rawExam, provider: provider.name };
      }

      // ✅ v4.15 — rattrapage "presque complet" via le pool avant de rejeter
      if (isNearMiss(rawExam, subjectName) && typeof poolLoader === 'function') {
        const pool = await poolLoader().catch(() => null);
        if (pool && pool.length) {
          const patched = patchExamFromPoolQuestions(rawExam, subjectName, pool);
          if (patched && validateGeneratedExam(patched, subjectName)) {
            console.log('[AI] OK ' + provider.name + ' (+rattrapage pool)');
            return { exam: patched, provider: provider.name + '+pool' };
          }
        }
      }

      errors.push(provider.name + ': structure invalide');
    } catch (error) {
      errors.push(provider.name + ': ' + error.message);
      console.warn('[AI] FAIL ' + provider.name + ': ' + error.message);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ═══════════════════════════════════════════════════════════════
// CORRECTION ROBUSTE — matching, cohérence, explications garanties
// ═══════════════════════════════════════════════════════════════

function normQNumber(n) {
  // "1.a" / "1-A" / "1a" / "1 )" → "1a" — comparaison tolérante des numéros
  return String(n === null || n === undefined ? '' : n).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickAiNumber(aiQ) {
  return aiQ.number ?? aiQ.num ?? aiQ.questionNumber ?? aiQ.qNumber ?? aiQ.id ?? '';
}

function pickAiPoints(aiQ, maxQ) {
  const raw = aiQ.points ?? aiQ.note ?? aiQ.pts ?? (aiQ.score !== undefined && aiQ.score !== null && Number(aiQ.score) <= maxQ * 1.02 ? aiQ.score : undefined);
  let p = Number(raw);
  if (!isFinite(p) || raw === null || raw === undefined) return null;
  if (p > maxQ * 1.02) {
    // L'IA a parfois noté sur 20 alors que la question vaut maxQ : ramener à l'échelle
    if (p <= 20 && maxQ > 0) p = (p / 20) * maxQ;
    else p = maxQ;
  }
  return Math.max(0, Math.min(maxQ, p));
}

function pickAiStatus(aiQ) {
  const s = String(aiQ.status ?? aiQ.verdict ?? aiQ.result ?? '').toLowerCase();
  if (s.includes('part') || s.includes('moyen')) return 'partial';
  if (s.includes('correct') || s.includes('juste') || s.includes('bonne')) return 'correct';
  if (s.includes('wrong') || s.includes('faux') || s.includes('incorrect') || s.includes('false')) return 'wrong';
  if (s.includes('unanswered') || s.includes('empty') || s.includes('sans réponse') || s.includes('vide')) return 'unanswered';
  return '';
}

const STOPWORDS = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'au', 'aux', 'en', 'dans', 'pour', 'par', 'sur', 'que', 'qui', 'quoi', 'est', 'sont', 'ce', 'cet', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'il', 'elle', 'ils', 'elles', 'on', 'nous', 'vous', 'je', 'tu', 'se', 'plus', 'moins', 'comme', 'donc', 'alors', 'avec', 'sans', 'tout', 'toute', 'tous', 'toutes', 'etre', 'avoir', 'the', 'and', 'for', 'with', 'this', 'that']);

function tokenizeForSim(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]{3,}/g)
    ?.filter((w) => !STOPWORDS.has(w)) || [];
}

function similarityScore(studentText, expectedText) {
  const st = tokenizeForSim(studentText);
  const ex = tokenizeForSim(expectedText);
  if (st.length === 0 || ex.length === 0) return 0;
  const exSet = new Set(ex);
  let hit = 0;
  st.forEach((w) => { if (exSet.has(w)) hit++; });
  return hit / ex.length; // couverture des éléments attendus
}

function letterFromAiCorrectAnswer(aiAnswer, options) {
  const raw = String(aiAnswer || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  let m = upper.match(/^([ABCD])(?![A-Z])/) || upper.match(/^\(?([ABCD])\)?[).\:\s]/);
  if (m) return m[1];
  if (Array.isArray(options)) {
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const target = norm(raw);
    const found = options.find((o) => norm(o && o.text) === target || norm(o && o.id) === target);
    if (found && found.id) return String(found.id).toUpperCase();
  }
  return null;
}

function isAnswered(a) {
  return a !== null && a !== undefined && String(a).trim() !== '';
}

function mergeAiCorrection(deterministicResults, aiResult) {
  if (!aiResult || !Array.isArray(aiResult.exercises)) return;

  aiResult.exercises.forEach((aiEx, exIdx) => {
    let target = deterministicResults[exIdx];
    if (!target && aiEx && aiEx.number !== undefined) {
      target = deterministicResults.find((r) => String(r.exerciseResult.number) === String(aiEx.number));
    }
    if (!target) return;

    const aiQuestions = Array.isArray(aiEx.questions) ? aiEx.questions
      : Array.isArray(aiEx.results) ? aiEx.results
      : Array.isArray(aiEx.answers) ? aiEx.answers
      : [];
    const matched = new Set();

    aiQuestions.forEach((aiQ) => {
      if (!aiQ || typeof aiQ !== 'object') return;
      const numKey = normQNumber(pickAiNumber(aiQ));
      let match = null;
      if (numKey) {
        match = target.exerciseResult.questions.find((q) => !matched.has(q) && normQNumber(q.number) === numKey);
      }
      if (!match) {
        match = target.exerciseResult.questions.find((q) => !matched.has(q) && q.status === 'pending');
      }
      if (!match) return;
      matched.add(match);

      // 1) Champs pédagogiques (toujours, même pour les QCM déjà notés)
      if (aiQ.explanation) match.explanation = String(aiQ.explanation);
      if (Array.isArray(aiQ.steps) && aiQ.steps.length > 0) match.steps = aiQ.steps.map((s) => String(s));
      else if (typeof aiQ.steps === 'string' && aiQ.steps.trim()) match.steps = [aiQ.steps.trim()];
      if (aiQ.concept) match.concept = String(aiQ.concept);
      if (aiQ.whyWrong) match.whyWrong = String(aiQ.whyWrong);
      if (aiQ.commonMistake) match.commonMistake = String(aiQ.commonMistake);
      if (aiQ.toReview) match.toReview = String(aiQ.toReview);
      if (aiQ.betterMethod) match.betterMethod = String(aiQ.betterMethod);
      if (aiQ.feedback) match.feedback = String(aiQ.feedback);
      if (aiQ.correctAnswer && !match.correctAnswer) match.correctAnswer = String(aiQ.correctAnswer);

      // 2) QCM resté en attente faute de correctAnswer : re-note dès que l'IA le fournit
      if (String(match.type).toLowerCase() === 'choice' && match.status === 'pending') {
        const letter = letterFromAiCorrectAnswer(
          aiQ.correctAnswer || match.correctAnswer,
          target.exerciseResult._options ? target.exerciseResult._options[match.number] : null
        );
        if (letter) {
          match.correctAnswer = letter;
          const sa = String(match.studentAnswer || '').trim().toUpperCase();
          if (!isAnswered(match.studentAnswer)) {
            match.points = 0;
            match.status = 'unanswered';
          } else if (sa === letter) {
            match.points = Number(match.maxPoints) || 1.33;
            match.status = 'correct';
          } else {
            match.points = 0;
            match.status = 'wrong';
          }
        }
        return;
      }

      // 3) Note des questions texte en attente — JAMAIS de 0 silencieux
      if (match.status === 'pending') {
        if (!isAnswered(match.studentAnswer)) {
          match.points = 0;
          match.status = 'unanswered';
          return;
        }
        const maxQ = Number(match.maxPoints) || 1.33;
        let p = pickAiPoints(aiQ, maxQ);
        const st = pickAiStatus(aiQ);
        if (p === null && st === 'correct') p = maxQ;
        if (p === null && st === 'partial') p = round2(maxQ * 0.5);
        if (p === null && (st === 'wrong' || st === 'unanswered')) p = 0;
        if (p === null) {
          // L'IA n'a pas donné de note → note partielle prudente (jamais 0 par défaut)
          p = round2(maxQ * 0.5);
        }
        match.points = p;
        match.status = st || (p >= maxQ * 0.9 ? 'correct' : p > 0 ? 'partial' : 'wrong');
      }
    });

    if (aiEx.explanation) target.exerciseResult.explanation = String(aiEx.explanation);
    if (aiEx.advice) target.exerciseResult.advice = String(aiEx.advice);
  });
}

function enforceGradingCoherence(deterministicResults, aiGlobalScore) {
  let raw = 0;
  let maxAll = 0;
  let answeredTextCount = 0;
  let answeredTextMax = 0;

  deterministicResults.forEach((r) => {
    r.exerciseResult.questions.forEach((q) => {
      const maxQ = Number(q.maxPoints) || 1.33;
      maxAll += maxQ;
      const answered = isAnswered(q.studentAnswer);

      if (String(q.type).toLowerCase() === 'choice') {
        // QCM : note TOUJOURS déterministe
        if (!answered) {
          q.points = 0;
          q.status = 'unanswered';
        } else if (q.status === 'correct') {
          q.points = maxQ;
        } else {
          q.points = 0;
          if (q.status !== 'wrong' && q.status !== 'unanswered') q.status = 'wrong';
        }
      } else if (!answered) {
        q.points = 0;
        q.status = 'unanswered';
      } else {
        answeredTextCount++;
        answeredTextMax += maxQ;
        let p = Math.max(0, Math.min(maxQ, Number(q.points) || 0));
        if (q.status === 'correct' && p < maxQ * 0.8) p = maxQ; // le prof a validé → max
        if (p >= maxQ * 0.95) { p = maxQ; q.status = 'correct'; }
        else if (p > 0) { q.status = (q.status === 'correct') ? 'correct' : 'partial'; }
        else { q.status = 'wrong'; }
        q.points = round2(p);
      }
      raw += Number(q.points) || 0;
    });
  });

  // Filet de sécurité : l'IA donne un score global crédible mais la note calculée est nulle
  // alors que des réponses texte existent → redistribuer le score de l'IA (jamais 0 injuste).
  const s = Number(aiGlobalScore);
  if (isFinite(s) && s > 0.5 && raw < 0.5 && answeredTextCount > 0 && answeredTextMax > 0) {
    const targetSum = Math.min(answeredTextMax, (Math.min(20, s) / 20) * answeredTextMax);
    const per = targetSum / answeredTextCount;
    deterministicResults.forEach((r) => {
      r.exerciseResult.questions.forEach((q) => {
        const maxQ = Number(q.maxPoints) || 1.33;
        if (String(q.type).toLowerCase() !== 'choice' && isAnswered(q.studentAnswer)) {
          const p = Math.min(maxQ, per);
          q.points = round2(p);
          q.status = p >= maxQ * 0.95 ? 'correct' : p > 0 ? 'partial' : 'wrong';
        }
      });
    });
  }
}

function ensureEveryQuestionExplained(deterministicResults) {
  deterministicResults.forEach((r) => {
    r.exerciseResult.questions.forEach((q) => {
      const answered = isAnswered(q.studentAnswer);
      if (!q.explanation || !String(q.explanation).trim()) {
        if (String(q.type).toLowerCase() === 'choice') {
          if (q.status === 'correct') {
            q.explanation = `Bonne réponse : ${q.correctAnswer || '—'}. Tu as bien identifié la réponse attendue.`;
          } else if (q.status === 'unanswered') {
            q.explanation = q.correctAnswer
              ? `La bonne réponse était : ${q.correctAnswer}. Relis la question et retrouve cette information dans ton cours.`
              : 'Aucune réponse fournie pour cette question.';
          } else {
            q.explanation = q.correctAnswer
              ? `Ta réponse (${q.studentAnswer}) n'était pas la bonne. La bonne réponse était : ${q.correctAnswer}. Compare les deux options pour comprendre la nuance.`
              : 'Réponse incorrecte. Relis la question et ton cours sur ce point précis.';
          }
        } else if (!answered) {
          q.explanation = 'Aucune réponse fournie. Pour progresser : reprends la question au calme et mobilise le cours correspondant, même une réponse partielle rapporte des points.';
        } else {
          const base = q.correctAnswer ? `Réponse attendue : ${q.correctAnswer}. ` : '';
          q.explanation = base +
            (q.concept ? `Notion testée : ${q.concept}. ` : '') +
            "Le correcteur n'a pas pu produire d'analyse détaillée pour cette question cette fois-ci. Compare ta réponse aux éléments attendus et complète avec ton cours.";
        }
      }
      if (!q.feedback || !String(q.feedback).trim()) {
        q.feedback = q.status === 'correct' ? 'Très bien, continue comme ça !'
          : q.status === 'partial' ? 'Bonne base — il reste à préciser ta réponse.'
          : q.status === 'unanswered' ? "N'hésite pas à tenter une réponse la prochaine fois : même partielle, elle rapporte des points."
          : 'Reprends cette notion tranquillement : tu vas y arriver.';
      }
    });
    if (!r.exerciseResult.explanation || !String(r.exerciseResult.explanation).trim()) {
      const good = Number(r.exerciseResult.score) >= Number(r.exerciseResult.maxScore) * 0.5;
      r.exerciseResult.explanation = good
        ? 'Bilan : de solides bases sur cet exercice. Poursuis tes efforts pour viser le sans-faute.'
        : 'Bilan : cet exercice doit être revu. Reprends le cours correspondant, puis refais les questions manquées.';
    }
    if (!r.exerciseResult.advice || !String(r.exerciseResult.advice).trim()) {
      const good = Number(r.exerciseResult.score) >= Number(r.exerciseResult.maxScore) * 0.5;
      r.exerciseResult.advice = good
        ? "Continue à t'entraîner sur des exercices plus difficiles."
        : 'Revois les notions manquées avant de passer au prochain examen.';
    }
  });
}

function localFallbackCorrection(deterministicResults) {
  // L'IA est momentanément indisponible : on corrige localement pour TOUJOURS
  // donner une note et une explication (QCM déterministes + heuristique texte).
  deterministicResults.forEach((r) => {
    r.exerciseResult.questions.forEach((q) => {
      if (q.status !== 'pending') return;
      if (!isAnswered(q.studentAnswer)) {
        q.points = 0;
        q.status = 'unanswered';
        return;
      }
      const maxQ = Number(q.maxPoints) || 1.33;
      if (String(q.type).toLowerCase() === 'choice' && q.correctAnswer) {
        const sa = String(q.studentAnswer).trim().toUpperCase();
        const ca = String(q.correctAnswer).trim().toUpperCase();
        if (sa === ca) { q.points = maxQ; q.status = 'correct'; }
        else { q.points = 0; q.status = 'wrong'; }
        return;
      }
      if (q.correctAnswer) {
        const sim = similarityScore(q.studentAnswer, q.correctAnswer);
        if (sim >= 0.5) { q.points = maxQ; q.status = 'correct'; }
        else if (sim >= 0.25) { q.points = round2(maxQ * 0.5); q.status = 'partial'; }
        else { q.points = 0; q.status = 'wrong'; }
        return;
      }
      const t = String(q.studentAnswer).trim();
      const substantive = t.length >= 25 && t.split(/\s+/).length >= 5;
      q.points = round2(maxQ * (substantive ? 0.5 : 0.25));
      q.status = 'partial';
    });
  });
}

async function correctWithFallback(prompt) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');
  const errors = [];
  for (const provider of providers) {
    try {
      const result = await callProvider(provider, prompt, MAX_TOKENS.CORRECT);

      if (!result || typeof result !== 'object') {
        errors.push(provider.name + ': résultat non-objet');
        continue;
      }
      if (!Array.isArray(result.exercises) || result.exercises.length === 0) {
        errors.push(provider.name + ': exercises vide ou invalide');
        continue;
      }
      const hasValidExercises = result.exercises.every((ex) =>
        ex && Array.isArray(ex.questions) && ex.questions.length > 0
      );
      if (!hasValidExercises) {
        errors.push(provider.name + ': questions manquantes dans un exercice');
        continue;
      }
      if (typeof result.score !== 'number' || isNaN(result.score)) {
        errors.push(provider.name + ': score invalide');
        continue;
      }

      return { result, provider: provider.name };
    } catch (error) {
      errors.push(provider.name + ': ' + error.message);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

function correctQCMDeterministic(subject, subjectId, answers) {
  const exercises = [];
  subject.exercises.forEach((exercise, exIdx) => {
    const exRes = {
      number: exercise.number || (exIdx + 1),
      title: exercise.title || ('Exercice ' + (exIdx + 1)),
      score: 0,
      maxScore: 0,
      correctAnswers: 0,
      totalQuestions: exercise.questions.length,
      questions: [],
      wrongAnswers: [],
      explanation: '',
      advice: ''
    };
    const textQuestions = [];

    exercise.questions.forEach((question, qIdx) => {
      const key = subjectId + ':' + exIdx + ':' + qIdx;
      const studentAnswer = answers[key];
      const points = Number(question.points) || 1.33;
      exRes.maxScore += points;

      const qRes = {
        number: question.number || ((exIdx + 1) + '.' + (qIdx + 1)),
        questionText: question.text || '',
        type: question.type || 'text',
        studentAnswer: studentAnswer || null,
        correctAnswer: question.correctAnswer || null,
        points: 0,
        maxPoints: points,
        status: 'pending',
        feedback: '',
        explanation: '',
        steps: [],
        concept: '',
        whyWrong: null,
        commonMistake: null,
        toReview: null,
        betterMethod: null
      };

      if (question.type === 'choice' && Array.isArray(question.options)) {
        exRes._options = exRes._options || {};
        exRes._options[qRes.number] = question.options;
      }

      if (question.type === 'choice' && question.correctAnswer) {
        if (studentAnswer === question.correctAnswer) {
          qRes.status = 'correct';
          qRes.points = points;
          exRes.score += points;
          exRes.correctAnswers++;
        } else if (!studentAnswer) {
          qRes.status = 'unanswered';
        } else {
          qRes.status = 'wrong';
          exRes.wrongAnswers.push({
            number: qRes.number,
            studentAnswer,
            correctAnswer: question.correctAnswer,
            question: question.text
          });
        }
      } else {
        textQuestions.push({ exerciseIndex: exIdx, questionIndex: qIdx, questionResult: qRes });
      }
      exRes.questions.push(qRes);
    });
    exercises.push({ exerciseResult: exRes, textQuestions });
  });
  return exercises;
}

async function correctExamHybrid(exam, subjectId, answers, uid) {
  const subject = exam.subjects.find((s) => s.id === subjectId) || exam.subjects[0];
  if (!subject) throw new Error('subject_not_found');

  const hasAnyAnswer = Object.values(answers || {}).some(
    (a) => a !== null && a !== undefined && String(a).trim() !== ''
  );

  if (!hasAnyAnswer) {
    console.log('[EXAM] Aucune réponse fournie → note forcée à 0/20');

    const emptyExercises = subject.exercises.map((ex, exIdx) => ({
      number: ex.number || (exIdx + 1),
      title: ex.title || `Exercice ${exIdx + 1}`,
      score: 0,
      maxScore: Number(ex.points) || 6.67,
      correctAnswers: 0,
      totalQuestions: ex.questions.length,
      questions: ex.questions.map((q, qIdx) => ({
        number: q.number || `${exIdx + 1}.${qIdx + 1}`,
        questionText: q.text || '',
        type: q.type || 'text',
        studentAnswer: null,
        correctAnswer: q.correctAnswer || null,
        points: 0,
        maxPoints: Number(q.points) || 1.33,
        status: 'unanswered',
        feedback: 'Pas de réponse.',
        explanation: q.correctAnswer ? `La bonne réponse était : ${q.correctAnswer}` : 'Aucune réponse fournie.',
        steps: [],
        concept: '',
        whyWrong: null,
        commonMistake: null,
        toReview: null,
        betterMethod: null
      })),
      explanation: 'Aucune réponse fournie.',
      advice: 'Réponds aux questions la prochaine fois !'
    }));

    return {
      score: 0,
      totalScore: TOTAL_POINTS,
      percentage: 0,
      grade: 'Insuffisant',
      exercises: emptyExercises,
      revisionTopics: ['Revoir tout le chapitre'],
      globalFeedback: {
        strengths: [],
        weaknesses: ['Aucune réponse fournie'],
        encouragement: 'Il faut répondre aux questions pour être évalué !'
      }
    };
  }

  const deterministicResults = correctQCMDeterministic(subject, subjectId, answers);
  const hasTextQuestions = deterministicResults.some((r) => r.textQuestions.length > 0);

  let correctionMode = 'deterministic';
  let aiGlobalScore = null;

  if (hasTextQuestions) {
    try {
      const prompt = correctionPrompt({ exam: { ...exam, subjects: [subject] }, subjectId, answers });
      const aiResponse = await correctWithFallback(prompt);
      const aiResult = aiResponse.result;
      aiGlobalScore = aiResult ? aiResult.score : null;

      mergeAiCorrection(deterministicResults, aiResult);
      if (Array.isArray(aiResult?.revisionTopics)) deterministicResults.revisionTopics = aiResult.revisionTopics;
      if (aiResult?.globalFeedback) deterministicResults.globalFeedback = aiResult.globalFeedback;
      correctionMode = 'ai';
    } catch (error) {
      console.warn('AI correction failed → correction locale (note + explications garanties):', error.message);
      // ✅ L'IA est indisponible : on corrige QUAND MÊME localement. L'élève reçoit
      // toujours une note et une explication — jamais de correction refusée.
      localFallbackCorrection(deterministicResults);
      correctionMode = 'local';
      deterministicResults.globalFeedback = deterministicResults.globalFeedback || {};
      if (!Array.isArray(deterministicResults.globalFeedback.weaknesses) || deterministicResults.globalFeedback.weaknesses.length === 0) {
        deterministicResults.globalFeedback.weaknesses = ['Analyse détaillée momentanément indisponible : notes provisoires attribuées automatiquement.'];
      }
    }
  }

  enforceGradingCoherence(deterministicResults, correctionMode === 'ai' ? aiGlobalScore : null);
  ensureEveryQuestionExplained(deterministicResults);

  const finalExercises = deterministicResults.map((r) => r.exerciseResult);
  finalExercises.forEach((ex) => { delete ex._options; });

  let rawScore = 0;
  let maxPossibleScore = 0;
  finalExercises.forEach((ex) => {
    ex.questions.forEach((q) => {
      const qMax = Number(q.maxPoints) || 1.33;
      const qPts = Math.max(0, Math.min(qMax, Number(q.points) || 0));
      q.points = round2(qPts);
      q.maxPoints = round2(qMax);
      rawScore += qPts;
      maxPossibleScore += qMax;
      if (q.status === 'correct') ex.correctAnswers = (ex.correctAnswers || 0) + 1;
    });
  });

  let finalScore = maxPossibleScore > 0 ? (rawScore / maxPossibleScore) * TOTAL_POINTS : 0;
  finalScore = round2(Math.max(0, Math.min(TOTAL_POINTS, finalScore)));

  let sumExScore = 0;
  let sumExMax = 0;
  finalExercises.forEach((ex, idx) => {
    const isLast = idx === finalExercises.length - 1;
    const exMax = isLast
      ? round2(TOTAL_POINTS - sumExMax)
      : round2((ex.questions.reduce((s, q) => s + (Number(q.maxPoints) || 0), 0) / (maxPossibleScore || 1)) * TOTAL_POINTS);
    const exRaw = ex.questions.reduce((s, q) => s + (Number(q.points) || 0), 0);
    const exRawMax = ex.questions.reduce((s, q) => s + (Number(q.maxPoints) || 0), 0);
    const exScore = exRawMax > 0 ? round2((exRaw / exRawMax) * exMax) : 0;
    ex.maxScore = exMax;
    ex.score = Math.min(exScore, exMax);
    sumExMax += exMax;
    sumExScore += ex.score;
  });

  if (finalExercises.length > 0) {
    const last = finalExercises[finalExercises.length - 1];
    const drift = round2(finalScore - sumExScore);
    if (drift !== 0) {
      last.score = round2(Math.max(0, Math.min(last.maxScore, last.score + drift)));
    }
  }

  const percentage = Math.round((finalScore / TOTAL_POINTS) * 100);
  let grade = 'Insuffisant';
  if (percentage >= 90) grade = 'Excellent';
  else if (percentage >= 80) grade = 'Très bien';
  else if (percentage >= 70) grade = 'Bien';
  else if (percentage >= 60) grade = 'Assez bien';
  else if (percentage >= 50) grade = 'Passable';

  const revisionTopics = deterministicResults.revisionTopics || [];
  if (!revisionTopics.length) {
    finalExercises.forEach((ex) => {
      if (ex.score < ex.maxScore * 0.5) revisionTopics.push('Revoir ' + (ex.title || ('Exercice ' + ex.number)));
    });
  }

  const globalFeedback = deterministicResults.globalFeedback || {
    strengths: [],
    weaknesses: [],
    encouragement: percentage >= 70 ? 'Bon travail global !' : 'Continue tes efforts.'
  };

  return {
    score: finalScore,
    totalScore: TOTAL_POINTS,
    percentage,
    grade,
    exercises: finalExercises,
    revisionTopics,
    globalFeedback,
    correctionMode
  };
}

async function saveExamResult(uid, body, result) {
  const { db, FieldValue } = getAdminServices();
  const selected = body.exam.subjects.find((s) => s.id === body.subjectId) || body.exam.subjects[0];
  const difficulties = Array.isArray(result?.exercises) ? result.exercises.map((ex) => ({
    number: ex.number,
    score: Number(ex.score || 0),
    maxScore: Number(ex.maxScore || 6.67),
    advice: String(ex.advice || '').slice(0, 500)
  })) : [];

  await db.collection('users').doc(uid).collection('examResults').add({
    subject: SUBJECT_LABELS[body.exam.subject] || body.exam.subject,
    subjectKey: body.exam.subject,
    chapter: body.exam.chapter || 'all',
    chapterTitle: selected?.title || 'Examen',
    score: Number(result?.score || 0),
    totalScore: TOTAL_POINTS,
    percentage: Number(result?.percentage || 0),
    grade: result?.grade || null,
    result: { ...result, exercises: result?.exercises || [] },
    difficulties,
    answerCount: Object.values(body.answers || {}).filter(Boolean).length,
    examTitle: selected?.title || 'Examen',
    fromNotebook: Boolean(body.notebookContext),
    createdAt: FieldValue.serverTimestamp(),
    date: FieldValue.serverTimestamp()
  });
}

function validateConfig(body) {
  const config = {
    subject: String(body.subject || ''),
    level: String(body.level || ''),
    chapter: String(body.chapter || 'all'),
    difficulty: String(body.difficulty || ''),
    duration: Number(body.duration),
    exerciseCount: Number(body.exerciseCount)
  };
  if (!ALLOWED_SUBJECTS.has(config.subject)) return 'Matière invalide.';
  if (config.level !== 'Terminale D') return 'Niveau invalide.';
  if (!ALLOWED_DIFFICULTIES.has(config.difficulty)) return 'Difficulté invalide.';
  if (!ALLOWED_DURATIONS.has(config.duration)) return 'Durée invalide.';
  if (config.exerciseCount !== REQUIRED_EXERCISES) return 'Nombre d\'exercices invalide.';
  if (config.chapter.length > 100) return 'Chapitre invalide.';
  return null;
}

function validateCorrection(body) {
  if (!body.exam || !Array.isArray(body.exam.subjects) || !body.subjectId || !body.answers) {
    return 'Données invalides.';
  }
  const size = JSON.stringify(body).length;
  if (size > 500000) return 'Examen trop volumineux.';
  return null;
}

async function loadNotebookContext(uid, subject, chapterId, chapterTitle) {
  const { db } = getAdminServices();
  const notebookKey = subject;
  if (!notebookKey) return null;

  function normalizeText(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  }

  let chapterData = null;
  let actualChapterId = chapterId;

  const chapterRef = chapterId
    ? db.collection('users').doc(uid).collection('notebooks').doc(notebookKey)
        .collection('chapters').doc(chapterId).get()
    : null;

  const chaptersListPromise = !chapterId && chapterTitle
    ? db.collection('users').doc(uid).collection('notebooks').doc(notebookKey)
        .collection('chapters').get().catch(() => ({ docs: [] }))
    : null;

  const [chapterSnap, chaptersSnap] = await Promise.all([
    chapterRef || Promise.resolve(null),
    chaptersListPromise || Promise.resolve(null)
  ]);

  if (chapterSnap && chapterSnap.exists) {
    chapterData = { id: chapterId, ...chapterSnap.data() };
  } else if (chaptersSnap && chaptersSnap.docs) {
    const target = normalizeText(chapterTitle);
    const found = chaptersSnap.docs.find((d) => {
      const t = normalizeText(d.data().title);
      return t === target || t.includes(target) || target.includes(t);
    });
    if (found) {
      chapterData = { id: found.id, ...found.data() };
      actualChapterId = found.id;
    }
  }

  if (!chapterData) return null;

  const sectionsSnap = await db.collection('users').doc(uid)
    .collection('notebooks').doc(notebookKey)
    .collection('chapters').doc(actualChapterId)
    .collection('sections').orderBy('createdAt', 'asc').get();

  if (sectionsSnap.empty) return null;

  const sections = sectionsSnap.docs.slice(0, 8).map((d) => {
    const s = d.data();
    return { id: d.id, title: s.title || 'Section', rawInput: s.rawInput || '', analysis: s.analysis || {} };
  });

  const contentText = sections.map((s, i) => {
    let text = `━━━ SECTION ${i + 1} : ${s.title} ━━━\n`;
    text += 'Contenu : ' + s.rawInput.slice(0, 1200) + '\n';
    const a = s.analysis || {};
    if (a.explanation?.understanding) text += 'À comprendre : ' + String(a.explanation.understanding).slice(0, 300) + '\n';
    return text;
  }).join('\n\n');

  return {
    notebookKey, chapterId: actualChapterId,
    chapterTitle: chapterData.title || chapterTitle || 'Chapitre',
    sectionsCount: sections.length,
    contentText
  };
}

module.exports = async function handler(request, response) {
  applyCors(request, response);
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'generate';
  const isLight = LIGHT_ACTIONS.has(action);
  const rateLimit = isLight ? MAX_REQUESTS_PER_WINDOW_LIGHT : MAX_REQUESTS_PER_WINDOW_HEAVY;

  if (rateLimited(clientIp(request), rateLimit, isLight ? 'light' : 'heavy')) {
    // ✅ v4.15 — retryAfter : le client affiche un compte à rebours et RETENTE
    // TOUT SEUL au lieu d'afficher une erreur (technique du cahier v4.13).
    return response.status(429).json({
      success: false,
      error: isLight
        ? 'Service momentanément saturé. Réessaie dans quelques secondes.'
        : 'Beaucoup d\'élèves en ce moment. Réessaie dans une minute.',
      retryAfter: isLight ? 6 : 45
    });
  }

  const verifiedUser = await verifyFirebaseToken(request).catch(() => null);
  if (!verifiedUser) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  if (!ALLOWED_ACTIONS.has(action)) return jsonError(response, 400, 'Action invalide.');

  if (PREMIUM_ACTIONS.has(action)) {
    try {
      const { db } = getAdminServices();
      const userSnap = await db.collection('users').doc(verifiedUser.uid).get();
      if (!userSnap.exists) {
        return jsonError(response, 404, 'Profil utilisateur introuvable.');
      }
      if (!isPremiumUser(userSnap.data())) {
        return jsonError(
          response,
          403,
          'L\'historique des examens est réservé aux comptes Premium.',
          'PREMIUM_REQUIRED'
        );
      }
    } catch (e) {
      console.error('[HISTORIQUE] Premium check failed:', e.message);
      return jsonError(response, 503, 'Service temporairement indisponible.');
    }
  }

  if (action === 'listExams') {
    try {
      const { db } = getAdminServices();
      const limit = Math.min(100, Number(body.limit) || 50);
      const snap = await db.collection('users').doc(verifiedUser.uid)
        .collection('examResults')
        .orderBy('createdAt', 'desc').limit(limit).get();

      const exams = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          subject: data.subject || 'Examen',
          subjectKey: data.subjectKey || '',
          chapterTitle: data.chapterTitle || '',
          examTitle: data.examTitle || 'Examen',
          score: Number(data.score || 0),
          totalScore: Number(data.totalScore || 20),
          percentage: Number(data.percentage || 0),
          grade: data.grade || null,
          createdAt: toISO(data.createdAt)
        };
      });

      return response.status(200).json({ success: true, exams });
    } catch (e) {
      console.error('[HISTORIQUE EXAMS] error:', e.message);
      return jsonError(response, 500, 'Impossible de charger l\'historique.');
    }
  }

  if (action === 'loadExam') {
    if (!body.examId) return jsonError(response, 400, 'examId requis.');
    try {
      const { db } = getAdminServices();
      const ref = db.collection('users').doc(verifiedUser.uid).collection('examResults').doc(body.examId);
      const snap = await ref.get();
      if (!snap.exists) return jsonError(response, 404, 'Examen introuvable.');
      const data = snap.data();
      return response.status(200).json({
        success: true,
        exam: {
          id: snap.id,
          subject: data.subject,
          subjectKey: data.subjectKey || '',
          chapterTitle: data.chapterTitle || '',
          examTitle: data.examTitle || 'Examen',
          score: Number(data.score || 0),
          totalScore: Number(data.totalScore || 20),
          percentage: Number(data.percentage || 0),
          grade: data.grade || null,
          result: data.result || null,
          createdAt: toISO(data.createdAt)
        }
      });
    } catch (e) {
      return jsonError(response, 500, 'Erreur chargement.');
    }
  }

  if (action === 'deleteExam') {
    if (!body.examId) return jsonError(response, 400, 'examId requis.');
    try {
      const { db } = getAdminServices();
      await db.collection('users').doc(verifiedUser.uid).collection('examResults').doc(body.examId).delete();
      return response.status(200).json({ success: true });
    } catch (e) {
      return jsonError(response, 500, 'Erreur suppression.');
    }
  }

  if (action === 'generate') {
    const validationError = validateConfig(body);
    if (validationError) return jsonError(response, 400, validationError);

    const reservation = await reserveFreeGeneration(verifiedUser.uid).catch(() => null);
    if (!reservation) return jsonError(response, 503, 'Vérification du quota indisponible.');

    if (reservation.limitReached) {
      return response.status(429).json({
        success: false, error: 'Limite gratuite atteinte.',
        code: 'FREE_EXAM_LIMIT', used: reservation.used, limit: FREE_EXAM_LIMIT
      });
    }

    try {
      const providers = getProviders();
      if (!providers.length) throw new Error('provider_missing');

      let notebookContext = null;
      if (body.notebookContext && (body.notebookContext.chapterId || body.notebookContext.chapterTitle)) {
        try {
          notebookContext = await loadNotebookContext(
            verifiedUser.uid, body.subject,
            body.notebookContext.chapterId, body.notebookContext.chapterTitle
          );
        } catch (e) { console.warn('[EXAM] Contexte cahier échoué:', e.message); }
      }

      // ✅ v4.16 — anti-répétition : la liste des énoncés déjà servis vient du
      // client (localStorage de l'appareil), assainie puis injectée dans le prompt.
      const avoidStatements = sanitizeAvoidList(body.avoidStatements);
      const prompt = notebookContext
        ? generationPromptFromNotebook(body, notebookContext, avoidStatements)
        : generationPrompt(body, avoidStatements);

      // ✅ v4.15 — accès paresseux au pool pour le rattrapage des sujets presque complets
      const poolLoader = async () => {
        const { db } = getAdminServices();
        const snap = await db.collection(POOL_COLLECTION)
          .where('subject', '==', body.subject).limit(80).get();
        return snap.docs.map((d) => d.data() || {});
      };
      const genResult = await generateWithFallback(prompt, body.subject, poolLoader);
      let exam = genResult.exam;

      exam = deepClean(exam);

      await saveExercisesToPool(exam, body.subject, body.difficulty, verifiedUser.uid);

      exam.chapter = body.chapter;
      exam.fromNotebook = Boolean(notebookContext);
      exam.notebookSectionsCount = notebookContext?.sectionsCount || 0;

      return response.status(200).json({
        success: true,
        exam,
        meta: { provider: genResult.provider, fromNotebook: Boolean(notebookContext) }
      });
    } catch (error) {
      console.error('Exam generation failed:', error.message);
      if (reservation?.reserved) {
        try { await releaseFreeGeneration(verifiedUser.uid, reservation.usageDate); } catch (_) {}
      }

      const pooled = await buildExamFromPool(body);
      if (pooled) {
        return response.status(200).json({ success: true, exam: pooled, fallback: true, source: 'pool' });
      }

      return response.status(200).json({
        success: true,
        exam: await buildUnavailableExam(body),
        unavailable: true
      });
    }
  }

  if (action === 'correct') {
    const validationError = validateCorrection(body);
    if (validationError) return jsonError(response, 400, validationError);

    try {
      const result = await correctExamHybrid(body.exam, body.subjectId, body.answers, verifiedUser.uid);
      try { await saveExamResult(verifiedUser.uid, body, result); }
      catch (e) { console.error('Save exam result failed:', e.message); }

      return response.status(200).json({ success: true, result });
    } catch (error) {
      const msg = (error && error.message) ? error.message : String(error);
      console.error('Exam correction failed:', msg);

      // ✅ CAS B : correction réellement indisponible
      if (msg === 'CORRECTION_UNAVAILABLE') {
        return jsonError(
          response,
          503,
          'La correction est temporairement indisponible. Tes réponses sont conservées : réessaie dans quelques minutes.',
          'CORRECTION_UNAVAILABLE'
        );
      }

      console.error('Unexpected correction error:', (error && error.stack) || msg);
      return jsonError(response, 500, 'Une erreur inattendue est survenue pendant la correction.');
    }
  }

  return jsonError(response, 400, 'Action inconnue.');
};


// ✅ Config assignée APRÈS module.exports — visible par Vercel AU BUILD (pas seulement au runtime).
module.exports.config = { maxDuration: 90 };
