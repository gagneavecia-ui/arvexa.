// ================================================================
// API PROGRESS v3.0 — ARVEXA School
// Cahier de notes intelligent : Matières → Chapitres → Sections
// Modèle : users/{uid}/notebooks/{subject}/chapters/{chapterId}
//                              └── sections/{sectionId}
// ================================================================

module.exports.config = { maxDuration: 60 };

// ────────────────────────────────────────────────────────────────
// CONSTANTES
// ────────────────────────────────────────────────────────────────
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 40;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set([
  'mathematiques', 'physique', 'chimie', 'svt',
  'philosophie', 'histoire-geo', 'francais', 'anglais'
]);

const SUBJECT_INFO = {
  mathematiques: { label: 'Mathématiques',    icon: 'fa-square-root-variable', profile: 'scientific' },
  physique:      { label: 'Physique',         icon: 'fa-bolt',                 profile: 'scientific' },
  chimie:        { label: 'Chimie',           icon: 'fa-flask',                profile: 'scientific' },
  svt:           { label: 'SVT',              icon: 'fa-dna',                  profile: 'scientific' },
  philosophie:   { label: 'Philosophie',      icon: 'fa-brain',                profile: 'literary'   },
  'histoire-geo':{ label: 'Histoire-Géo',     icon: 'fa-earth-africa',         profile: 'literary'   },
  francais:      { label: 'Français',         icon: 'fa-book-open',            profile: 'literary'   },
  anglais:       { label: 'Anglais',          icon: 'fa-language',             profile: 'literary'   }
};

const MIN_CONTENT_LENGTH = 80;
const MAX_CONTENT_LENGTH = 15000;
const FREE_SECTION_LIMIT = 5;           // 5 sections/mois en gratuit

const ALLOWED_CAPTURE_MODES = new Set(['text', 'voice']);

const MAX_AI_TOKENS = 6000;

let adminServices = null;

// ────────────────────────────────────────────────────────────────
// INIT FIREBASE ADMIN
// ────────────────────────────────────────────────────────────────
function getAdminServices() {
  if (adminServices) return adminServices;

  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials || !credentials.trim()) {
    throw new Error('firebase_admin_not_configured');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(credentials);
  } catch (e) {
    throw new Error('firebase_admin_invalid_json');
  }

  if (!serviceAccount.project_id || !serviceAccount.private_key) {
    throw new Error('firebase_admin_invalid_credentials');
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  adminServices = {
    auth: admin.auth(),
    db: admin.firestore(),
    FieldValue: admin.firestore.FieldValue,
    Timestamp: admin.firestore.Timestamp
  };
  return adminServices;
}

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────
function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

function jsonError(response, status, error, code) {
  return response.status(status).json({
    success: false,
    error,
    ...(code ? { code } : {})
  });
}

function applyCors(request, response) {
  const ALLOWED_ORIGINS = [
    'https://arvexaschool.vercel.app',
    'https://admin-89.vercel.app',
    'http://localhost:3000',
    'http://localhost:5000'
  ];
  const origin = request.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
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
  try {
    const { auth } = getAdminServices();
    return await auth.verifyIdToken(match[1]);
  } catch (error) {
    console.error('[PROGRESS AUTH] failed:', error.message);
    return null;
  }
}

function isPremiumUser(data) {
  if (!data) return false;
  const active = data.premium === true || data.isUnlocked === true || data.hasDeposited === true;
  if (!active) return false;
  const end = data.subscriptionEndDate?.toDate?.() ||
    (data.subscriptionEndDate?.seconds ? new Date(data.subscriptionEndDate.seconds * 1000) : null);
  return !end || end.getTime() > Date.now();
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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function cleanId(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function formatRelativeDate(value) {
  const iso = toISO(value);
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h}h`;
  const day = Math.floor(h / 24);
  if (day < 7) return `il y a ${day}j`;
  if (day < 30) return `il y a ${Math.floor(day / 7)} sem.`;
  return d.toLocaleDateString('fr-FR');
}

// ────────────────────────────────────────────────────────────────
// FOURNISSEURS IA
// ────────────────────────────────────────────────────────────────
function getProviders() {
  return [
    {
      name: 'Groq', key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true
    },
    {
      name: 'OpenRouter', key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true,
      headers: {
        'HTTP-Referer': process.env.APP_ORIGIN || '',
        'X-Title': 'ARVEXA Notebook'
      }
    },
    {
      name: 'Mistral', key: process.env.MISTRAL_API_KEY,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      jsonMode: false
    }
  ].filter((p) => Boolean(p.key));
}

async function callProvider(provider, prompt, maxTokens = MAX_AI_TOKENS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const body = {
      model: provider.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: 'Tu produis EXCLUSIVEMENT du JSON valide, sans markdown, sans texte avant ou après. Toute formule mathématique utilise LaTeX entre $...$ ou $$...$$.'
        },
        { role: 'user', content: prompt }
      ]
    };

    if (provider.jsonMode) body.response_format = { type: 'json_object' };

    const result = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.key}`,
        ...(provider.headers || {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await result.json().catch(() => null);
    if (!result.ok) {
      const msg = data?.error?.message || `HTTP ${result.status}`;
      throw new Error(`${provider.name}: ${msg}`);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${provider.name}: réponse vide`);

    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithFallback(prompt, validator, maxTokens = MAX_AI_TOKENS) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const errors = [];
  for (const provider of providers) {
    try {
      console.log(`[AI] Tentative ${provider.name}...`);
      const data = await callProvider(provider, prompt, maxTokens);
      if (!validator || validator(data)) {
        console.log(`[AI] ✅ ${provider.name} OK`);
        return data;
      }
      errors.push(`${provider.name}: structure invalide`);
    } catch (e) {
      errors.push(`${provider.name}: ${e.message}`);
      console.warn(`[AI] ❌ ${provider.name}: ${e.message}`);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ────────────────────────────────────────────────────────────────
// PROMPTS — 2 profils (scientific / literary)
// ────────────────────────────────────────────────────────────────
function buildScientificPrompt({ subjectLabel, rawInput }) {
  return `Tu es un professeur expert du BAC au Niger, spécialiste de ${subjectLabel}.

Un élève vient de copier une petite partie de sa leçon. Tu vas l'expliquer comme un vrai professeur.

═══════════════════════════════════════════════════════════════
CONTENU COLLÉ PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}

═══════════════════════════════════════════════════════════════
RÈGLE ABSOLUE — ANTI-INVENTION
═══════════════════════════════════════════════════════════════
- Tu ne peux utiliser QUE le contenu fourni ci-dessus.
- INTERDICTION d'ajouter des connaissances extérieures.
- INTERDICTION d'inventer des formules, des exemples, des valeurs.
- Chaque élément doit être traçable à un passage du texte source.
- Si une information manque, écris : "Non précisé dans ta leçon."

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Inline : $...$  /  Display : $$...$$
- JAMAIS de symboles Unicode bruts (π → $\\pi$, √ → $\\sqrt{}$, ² → $^{2}$)

═══════════════════════════════════════════════════════════════
FORMAT JSON ATTENDU
═══════════════════════════════════════════════════════════════
{
  "sectionTitle": "Titre court (max 60 caractères)",
  "profile": "scientific",
  "summary": "Résumé en 3-4 phrases, uniquement à partir du texte",
  "keyIdeas": [
    "Idée clé 1 (extraite du texte)",
    "Idée clé 2",
    "Idée clé 3"
  ],
  "formulas": [
    {
      "latex": "$z = a + bi$",
      "condition": "avec $a, b \\in \\mathbb{R}$",
      "source": "extrait exact du texte élève"
    }
  ],
  "method": [
    "Étape 1 : ...",
    "Étape 2 : ...",
    "Étape 3 : ..."
  ],
  "example": {
    "enonce": "Exemple COMPLET et CHIFFRÉ construit à partir d'un cas du texte",
    "steps": ["Étape 1 : calcul détaillé", "Étape 2 : ...", "Étape 3 : ..."],
    "result": "Résultat final"
  },
  "trap": {
    "text": "Piège classique au BAC sur cette notion",
    "solution": "Comment l'éviter"
  },
  "questions": [
    {
      "q": "Question probable au BAC ?",
      "a": "Réponse extraite UNIQUEMENT du texte fourni",
      "source": "extrait exact du texte élève"
    }
  ],
  "exercises": [
    {
      "enonce": "Exercice d'application",
      "indice": "Indice pour aider",
      "correction": {
        "steps": ["Étape 1", "Étape 2", "Étape 3"],
        "reponse": "Résultat final"
      },
      "difficulty": 1
    }
  ]
}

CONTRAINTES FINALES :
- keyIdeas : 3 à 5
- formulas : 1 à 5 (si applicable)
- method : 2 à 5 étapes
- questions : 4 à 8
- exercises : 2 à 4
- Réponds UNIQUEMENT avec le JSON`;
}

function buildLiteraryPrompt({ subjectLabel, rawInput }) {
  return `Tu es un professeur expert du BAC au Niger, spécialiste de ${subjectLabel}.

Un élève vient de copier une petite partie de sa leçon. Tu vas l'expliquer comme un vrai professeur.

═══════════════════════════════════════════════════════════════
CONTENU COLLÉ PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}

═══════════════════════════════════════════════════════════════
RÈGLE ABSOLUE — ANTI-INVENTION
═══════════════════════════════════════════════════════════════
- Tu ne peux utiliser QUE le contenu fourni ci-dessus.
- INTERDICTION d'ajouter des connaissances extérieures.
- INTERDICTION d'inventer des dates, des noms, des citations.
- Chaque élément doit être traçable à un passage du texte source.
- Si une information manque, écris : "Non précisé dans ta leçon."

═══════════════════════════════════════════════════════════════
FORMAT JSON ATTENDU
═══════════════════════════════════════════════════════════════
{
  "sectionTitle": "Titre court (max 60 caractères)",
  "profile": "literary",
  "summary": "Résumé en 3-4 phrases, uniquement à partir du texte",
  "keyIdeas": [
    "Idée directrice 1 (extraite du texte)",
    "Idée directrice 2",
    "Idée directrice 3"
  ],
  "definitions": [
    {
      "term": "Terme important",
      "definition": "Définition extraite du texte",
      "source": "extrait exact"
    }
  ],
  "arguments": [
    {
      "thesis": "Thèse défendue dans le texte",
      "arguments": ["Argument 1", "Argument 2"],
      "source": "extrait exact"
    }
  ],
  "dates": [
    { "date": "Date ou période", "event": "Événement", "source": "extrait" }
  ],
  "vocabulary": [
    { "term": "Mot technique", "meaning": "Signification", "source": "extrait" }
  ],
  "questions": [
    {
      "q": "Question probable au BAC ?",
      "a": "Réponse extraite UNIQUEMENT du texte fourni",
      "source": "extrait exact du texte élève"
    }
  ],
  "planTypes": [
    {
      "title": "Plan dialectique possible",
      "parties": ["Thèse", "Antithèse", "Synthèse"],
      "source": "structuré à partir des arguments du texte"
    }
  ]
}

CONTRAINTES FINALES :
- keyIdeas : 3 à 5
- definitions : 2 à 6 (si applicable)
- arguments : 1 à 4 thèses
- questions : 4 à 8 (PRIORITÉ ABSOLUE)
- Réponds UNIQUEMENT avec le JSON`;
}

// ────────────────────────────────────────────────────────────────
// FALLBACK LOCAL si IA indisponible
// ────────────────────────────────────────────────────────────────
function buildFallbackAnalysis({ subjectLabel, rawInput, profile }) {
  return {
    sectionTitle: 'Analyse',
    profile,
    summary: rawInput.slice(0, 300) + (rawInput.length > 300 ? '...' : ''),
    keyIdeas: ['Contenu à structurer', 'IA indisponible — réessaie plus tard'],
    formulas: [],
    method: ['Lis le texte source'],
    example: null,
    trap: null,
    questions: [
      { q: 'Que retenir de cette partie ?', a: rawInput.slice(0, 200), source: rawInput.slice(0, 100) }
    ],
    exercises: [],
    definitions: [],
    arguments: [],
    dates: [],
    vocabulary: [],
    planTypes: []
  };
}

// ────────────────────────────────────────────────────────────────
// QUOTAS
// ────────────────────────────────────────────────────────────────
async function checkSectionQuota(uid) {
  const { db } = getAdminServices();
  const userSnap = await db.collection('users').doc(uid).get();
  const data = userSnap.data();
  if (isPremiumUser(data)) return { allowed: true, premium: true, used: 0, limit: Infinity };

  const period = monthKey();
  const ref = db.collection('users').doc(uid).collection('notebookQuota').doc(`sections-${period}`);
  const snap = await ref.get();
  const used = Number(snap.data()?.count || 0);

  if (used >= FREE_SECTION_LIMIT) {
    return { allowed: false, used, limit: FREE_SECTION_LIMIT, premium: false };
  }
  return { allowed: true, used, limit: FREE_SECTION_LIMIT, premium: false };
}

async function incrementSectionQuota(uid) {
  const { db, FieldValue } = getAdminServices();
  const period = monthKey();
  const ref = db.collection('users').doc(uid).collection('notebookQuota').doc(`sections-${period}`);
  await ref.set(
    { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function markDailyActivity(uid, inc = {}) {
  const { db, FieldValue } = getAdminServices();
  const dateKey = todayKey();
  const ref = db.collection('users').doc(uid).collection('dailyActivity').doc(dateKey);
  await ref.set({
    date: dateKey,
    sectionsCreated: FieldValue.increment(inc.sectionsCreated || 0),
    lastAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

// ═══════════════════════════════════════════════════════════════
// ACTION 1 — getDashboard
// ═══════════════════════════════════════════════════════════════
async function getDashboard(uid) {
  const { db } = getAdminServices();

  // Parcours des notebooks (8 matières possibles)
  const subjects = [];
  let totalChapters = 0;
  let totalSections = 0;

  for (const subjectKey of ALLOWED_SUBJECTS) {
    const info = SUBJECT_INFO[subjectKey];
    const chaptersSnap = await db
      .collection('users').doc(uid)
      .collection('notebooks').doc(subjectKey)
      .collection('chapters')
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get()
      .catch(() => ({ docs: [] }));

    if (chaptersSnap.docs.length === 0) continue;

    const chapters = chaptersSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: data.title || 'Chapitre',
        sectionsCount: data.sectionsCount || 0,
        last: formatRelativeDate(data.updatedAt || data.createdAt)
      };
    });

    const totalSubjectSections = chapters.reduce((s, c) => s + c.sectionsCount, 0);
    totalChapters += chapters.length;
    totalSections += totalSubjectSections;

    subjects.push({
      key: subjectKey,
      label: info.label,
      icon: info.icon,
      chaptersCount: chapters.length,
      sectionsCount: totalSubjectSections,
      last: chapters[0]?.last || ''
    });
  }

  // Tri : matières les plus récentes en premier
  subjects.sort((a, b) => b.sectionsCount - a.sectionsCount);

  // Streak
  const streak = await computeStreak(uid);

  // Activité récente : dernier chapitre modifié
  let recentActivity = [];
  if (subjects.length > 0) {
    const topSubject = subjects[0];
    const lastChaptersSnap = await db
      .collection('users').doc(uid)
      .collection('notebooks').doc(topSubject.key)
      .collection('chapters')
      .orderBy('updatedAt', 'desc')
      .limit(3)
      .get()
      .catch(() => ({ docs: [] }));

    recentActivity = lastChaptersSnap.docs.map((d) => {
      const data = d.data();
      return {
        subject: topSubject.key,
        subjectLabel: topSubject.label,
        chapterId: d.id,
        chapterTitle: data.title || 'Chapitre',
        sectionsCount: data.sectionsCount || 0,
        time: formatRelativeDate(data.updatedAt || data.createdAt)
      };
    });
  }

  return {
    success: true,
    summary: {
      subjectsCount: subjects.length,
      totalChapters,
      totalSections
    },
    streak,
    subjects,
    recentActivity
  };
}

async function computeStreak(uid) {
  const { db } = getAdminServices();
  const snap = await db.collection('users').doc(uid).collection('dailyActivity')
    .orderBy('date', 'desc').limit(90).get().catch(() => ({ docs: [] }));

  if (snap.docs.length === 0) return { current: 0, best: 0 };

  const activeDates = new Set(snap.docs.map((d) => d.data().date).filter(Boolean));
  let current = 0;
  const today = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (activeDates.has(key)) current++;
    else break;
  }

  const sorted = Array.from(activeDates).sort();
  let best = 0, run = 0, prev = null;
  sorted.forEach((dateStr) => {
    if (prev) {
      const diff = Math.round((new Date(dateStr) - new Date(prev)) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run);
    prev = dateStr;
  });

  return { current, best };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 2 — listChapters
// ═══════════════════════════════════════════════════════════════
async function listChapters(uid, body) {
  const { subject } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };

  const { db } = getAdminServices();
  const snap = await db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters')
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();

  const chapters = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title || 'Chapitre',
      sectionsCount: data.sectionsCount || 0,
      createdAt: toISO(data.createdAt),
      updatedAt: toISO(data.updatedAt),
      last: formatRelativeDate(data.updatedAt || data.createdAt)
    };
  });

  return { success: true, chapters };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 3 — createChapter
// ═══════════════════════════════════════════════════════════════
async function createChapter(uid, body) {
  const { subject, title } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    throw { status: 400, message: 'Titre trop court.' };
  }

  const { db, FieldValue } = getAdminServices();
  const cleanTitle = title.trim().slice(0, 100);

  const ref = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc();

  await ref.set({
    title: cleanTitle,
    sectionsCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  return {
    success: true,
    chapter: {
      id: ref.id,
      title: cleanTitle,
      sectionsCount: 0,
      last: 'à l\'instant'
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 4 — getChapter (chapitre + sections)
// ═══════════════════════════════════════════════════════════════
async function getChapter(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };

  const { db } = getAdminServices();
  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) throw { status: 404, message: 'Chapitre introuvable.' };

  const data = chapterSnap.data();

  const sectionsSnap = await chapterRef.collection('sections')
    .orderBy('createdAt', 'asc')
    .get();

  const sections = sectionsSnap.docs.map((d) => {
    const s = d.data();
    const analysis = s.analysis || {};
    const questionsCount = Array.isArray(analysis.questions) ? analysis.questions.length : 0;
    const exercisesCount = Array.isArray(analysis.exercises) ? analysis.exercises.length : 0;

    return {
      id: d.id,
      title: s.title || analysis.sectionTitle || 'Section',
      questionsCount,
      exercisesCount,
      time: formatRelativeDate(s.createdAt),
      status: 'done'
    };
  });

  return {
    success: true,
    chapter: {
      id: chapterId,
      title: data.title || 'Chapitre',
      subject,
      sectionsCount: sections.length,
      createdAt: toISO(data.createdAt),
      updatedAt: toISO(data.updatedAt)
    },
    sections
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 5 — createSection (avec analyse IA)
// ═══════════════════════════════════════════════════════════════
async function createSection(uid, body) {
  const { subject, chapterId, rawInput, mode = 'text' } = body;

  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };
  if (!rawInput || typeof rawInput !== 'string') throw { status: 400, message: 'Contenu manquant.' };
  if (rawInput.length < MIN_CONTENT_LENGTH) {
    throw { status: 400, message: `Contenu trop court (min ${MIN_CONTENT_LENGTH} caractères).` };
  }
  if (rawInput.length > MAX_CONTENT_LENGTH) {
    throw { status: 400, message: `Contenu trop long (max ${MAX_CONTENT_LENGTH}).` };
  }
  if (!ALLOWED_CAPTURE_MODES.has(mode)) {
    throw { status: 400, message: 'Mode de capture invalide.' };
  }

  // Quota
  const quota = await checkSectionQuota(uid);
  if (!quota.allowed) {
    throw {
      status: 429,
      message: `Limite gratuite atteinte (${quota.limit} sections/mois). Passe à Premium.`,
      code: 'FREE_SECTION_LIMIT'
    };
  }

  const { db, FieldValue } = getAdminServices();

  // Vérifie que le chapitre existe
  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) throw { status: 404, message: 'Chapitre introuvable.' };

  // Profil de la matière
  const info = SUBJECT_INFO[subject];
  const subjectLabel = info.label;
  const profile = info.profile;

  // Analyse IA
  let analysis;
  try {
    const prompt = profile === 'scientific'
      ? buildScientificPrompt({ subjectLabel, rawInput })
      : buildLiteraryPrompt({ subjectLabel, rawInput });

    analysis = await generateWithFallback(
      prompt,
      (d) => d && typeof d === 'object' && (d.summary || d.keyIdeas),
      MAX_AI_TOKENS
    );
  } catch (aiError) {
    console.warn('[PROGRESS] Fallback local :', aiError.message);
    analysis = buildFallbackAnalysis({ subjectLabel, rawInput, profile });
  }

  // Sauvegarde section
  const sectionRef = chapterRef.collection('sections').doc();
  const sectionId = sectionRef.id;

  await sectionRef.set({
    title: analysis.sectionTitle || 'Section',
    rawInput,
    mode,
    profile,
    analysis,
    userNotes: '',
    userImages: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  // Mise à jour compteur
  await chapterRef.set({
    sectionsCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  if (!quota.premium) await incrementSectionQuota(uid);
  await markDailyActivity(uid, { sectionsCreated: 1 });

  return {
    success: true,
    sectionId,
    section: {
      id: sectionId,
      title: analysis.sectionTitle || 'Section',
      rawInput,
      analysis,
      userNotes: '',
      userImages: []
    },
    quota: quota.premium
      ? { type: 'premium', unlimited: true }
      : { type: 'free', used: quota.used + 1, limit: FREE_SECTION_LIMIT }
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 6 — getSection
// ═══════════════════════════════════════════════════════════════
async function getSection(uid, body) {
  const { subject, chapterId, sectionId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };

  const { db } = getAdminServices();
  const ref = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId)
    .collection('sections').doc(sectionId);

  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: 'Section introuvable.' };

  const s = snap.data();
  return {
    success: true,
    section: {
      id: sectionId,
      title: s.title || 'Section',
      subject,
      chapterId,
      rawInput: s.rawInput || '',
      analysis: s.analysis || {},
      userNotes: s.userNotes || '',
      userImages: s.userImages || [],
      createdAt: toISO(s.createdAt),
      time: formatRelativeDate(s.createdAt)
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 7 — updateNotes
// ═══════════════════════════════════════════════════════════════
async function updateNotes(uid, body) {
  const { subject, chapterId, sectionId, userNotes } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };
  if (typeof userNotes !== 'string') throw { status: 400, message: 'userNotes invalide.' };

  const { db, FieldValue } = getAdminServices();
  const ref = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId)
    .collection('sections').doc(sectionId);

  await ref.set({
    userNotes: userNotes.slice(0, 5000),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 8 — deleteSection
// ═══════════════════════════════════════════════════════════════
async function deleteSection(uid, body) {
  const { subject, chapterId, sectionId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };

  const { db, FieldValue } = getAdminServices();
  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const sectionRef = chapterRef.collection('sections').doc(sectionId);
  const snap = await sectionRef.get();
  if (!snap.exists) throw { status: 404, message: 'Section introuvable.' };

  await sectionRef.delete();
  await chapterRef.set({
    sectionsCount: FieldValue.increment(-1),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 9 — deleteChapter
// ═══════════════════════════════════════════════════════════════
async function deleteChapter(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };

  const { db } = getAdminServices();
  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const snap = await chapterRef.get();
  if (!snap.exists) throw { status: 404, message: 'Chapitre introuvable.' };

  // Supprime toutes les sections
  const sectionsSnap = await chapterRef.collection('sections').get();
  const batch = db.batch();
  sectionsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(chapterRef);
  await batch.commit();

  return { success: true };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 10 — getFullLesson
// ═══════════════════════════════════════════════════════════════
async function getFullLesson(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };

  const { db } = getAdminServices();
  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) throw { status: 404, message: 'Chapitre introuvable.' };

  const sectionsSnap = await chapterRef.collection('sections')
    .orderBy('createdAt', 'asc')
    .get();

  const sections = sectionsSnap.docs.map((d) => {
    const s = d.data();
    return {
      id: d.id,
      title: s.title || 'Section',
      analysis: s.analysis || {},
      userNotes: s.userNotes || '',
      userImages: s.userImages || []
    };
  });

  return {
    success: true,
    chapter: {
      id: chapterId,
      title: chapterSnap.data().title || 'Chapitre',
      subject
    },
    sections
  };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  applyCors(request, response);

  if (request.method === 'OPTIONS') return response.status(204).end();

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  if (rateLimited(clientIp(request))) {
    return jsonError(response, 429, 'Trop de demandes. Réessaie.');
  }

  let user;
  try {
    user = await verifyFirebaseToken(request);
  } catch (e) {
    console.error('Auth error:', e.message);
    return jsonError(response, 503, 'Service temporairement indisponible.');
  }

  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action;
  const uid = user.uid;

  console.log(`[PROGRESS] ${action} | uid=${uid.slice(0, 8)}`);

  try {
    switch (action) {
      case 'getDashboard':    return response.status(200).json(await getDashboard(uid));
      case 'listChapters':    return response.status(200).json(await listChapters(uid, body));
      case 'createChapter':   return response.status(200).json(await createChapter(uid, body));
      case 'getChapter':      return response.status(200).json(await getChapter(uid, body));
      case 'createSection':   return response.status(200).json(await createSection(uid, body));
      case 'getSection':      return response.status(200).json(await getSection(uid, body));
      case 'updateNotes':     return response.status(200).json(await updateNotes(uid, body));
      case 'deleteSection':   return response.status(200).json(await deleteSection(uid, body));
      case 'deleteChapter':   return response.status(200).json(await deleteChapter(uid, body));
      case 'getFullLesson':   return response.status(200).json(await getFullLesson(uid, body));
      default:
        return jsonError(response, 400, `Action inconnue : "${action}"`);
    }
  } catch (error) {
    console.error(`[PROGRESS] "${action}" failed:`, error.message);
    if (error.stack) console.error(error.stack);
    if (error.status) {
      return jsonError(response, error.status, error.message, error.code);
    }
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
