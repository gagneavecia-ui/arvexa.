// ================================================================
// API PROGRESS v2.0 — ARVEXA School
// Moteur d'apprentissage actif :
//   Envoyer cours → Comprendre → Mémoriser → Tester → Progresser
// ================================================================

// ────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt']);
const ALLOWED_CAPTURE_MODES = new Set(['text', 'voice']);
const MIN_CONTENT_LENGTH = 100;
const MAX_CONTENT_LENGTH = 15000;
const MAX_NOTIONS_PER_COURSE = 12;

const FREE_CAPTURE_LIMIT = 3;         // 3 cours ajoutés / mois

// SRS constants (SM-2 simplifié)
const SRS_MIN_EASINESS = 1.3;
const SRS_MAX_EASINESS = 2.8;
const SRS_DEFAULT_EASINESS = 2.5;
const SRS_MAX_INTERVAL_DAYS = 180;

const ERROR_CATEGORIES = [
  'formula_error',
  'calculation_error',
  'comprehension_error',
  'method_error',
  'forgetting',
  'confusion',
  'prerequisite_gap'
];

const SUBJECT_LABELS = {
  mathematiques: { label: 'Mathématiques', icon: 'fa-square-root-variable' },
  physique: { label: 'Physique', icon: 'fa-bolt' },
  chimie: { label: 'Chimie', icon: 'fa-flask' },
  svt: { label: 'SVT', icon: 'fa-dna' }
};

// Analyse IA unique : notions + fiche + flashcards + quiz
const MAX_AI_TOKENS = 8000;

let adminServices = null;

// ────────────────────────────────────────────────────────────────
// INIT FIREBASE ADMIN
// ────────────────────────────────────────────────────────────────
function getAdminServices() {
  if (adminServices) return adminServices;

  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials || !credentials.trim()) {
    const err = new Error('firebase_admin_not_configured');
    err.details = 'FIREBASE_ADMIN_CREDENTIALS manquant.';
    throw err;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(credentials);
  } catch (parseError) {
    const err = new Error('firebase_admin_invalid_json');
    err.details = 'JSON invalide: ' + parseError.message;
    throw err;
  }

  if (!serviceAccount.project_id || !serviceAccount.private_key) {
    const err = new Error('firebase_admin_invalid_credentials');
    err.details = 'Clés manquantes dans les credentials.';
    throw err;
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    try {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (initError) {
      const err = new Error('firebase_admin_init_failed');
      err.details = initError.message;
      throw err;
    }
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
  return String(
    request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown'
  ).split(',')[0].trim();
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
    console.error('[PROGRESS AUTH] verifyIdToken failed:', error.message);
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
  return new Date().toISOString().slice(0, 7); // YYYY-MM
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

// ────────────────────────────────────────────────────────────────
// HASH (pour cache)
// ────────────────────────────────────────────────────────────────
function contentHash(text) {
  // Hash léger (djb2). Pas cryptographique, suffisant pour du cache.
  let hash = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return Math.abs(hash).toString(36);
}

// ────────────────────────────────────────────────────────────────
// SRS — Spaced Repetition System (SM-2 simplifié)
// ────────────────────────────────────────────────────────────────
function computeNextReview(mastery, lastCorrect, responseTimeSeconds) {
  let easiness = Number(mastery?.easiness) || SRS_DEFAULT_EASINESS;
  let interval = Number(mastery?.interval) || 1;
  let repetitions = Number(mastery?.repetitions) || 0;

  if (!lastCorrect) {
    // Échec → repart de zéro
    repetitions = 0;
    interval = 1;
    easiness = Math.max(SRS_MIN_EASINESS, easiness - 0.2);
  } else {
    repetitions++;

    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 3;
    } else {
      interval = Math.min(SRS_MAX_INTERVAL_DAYS, Math.round(interval * easiness));
    }

    // Bonus / malus selon la vitesse de réponse
    if (responseTimeSeconds != null) {
      if (responseTimeSeconds < 8) {
        easiness = Math.min(SRS_MAX_EASINESS, easiness + 0.15);
      } else if (responseTimeSeconds > 30) {
        easiness = Math.max(SRS_MIN_EASINESS, easiness - 0.1);
      }
    } else {
      easiness = Math.min(SRS_MAX_EASINESS, easiness + 0.05);
    }
  }

  const next = new Date();
  next.setDate(next.getDate() + interval);

  return {
    easiness: Math.round(easiness * 100) / 100,
    interval,
    repetitions,
    nextReviewAt: next
  };
}

// ────────────────────────────────────────────────────────────────
// SCORE DE MAÎTRISE UNIFIÉ (0-100)
// ────────────────────────────────────────────────────────────────
function computeMasteryScore(history, totalAttempts, totalCorrect) {
  if (!Array.isArray(history) || history.length === 0) return 0;

  // Fenêtre : 10 derniers essais
  const recent = history.slice(-10);

  // Pondération par récence : chaque essai compte plus que le précédent
  let weighted = 0;
  let weightSum = 0;
  recent.forEach((h, i) => {
    const w = Math.pow(1.2, i);
    weightSum += w;
    if (h.correct) weighted += w;
  });

  if (weightSum === 0) return 0;

  const ratio = weighted / weightSum; // 0..1

  // Bonus de volume : plus l'élève a travaillé, plus le score est stable
  const volumeBonus = Math.min(0.1, (totalAttempts || 0) / 100);

  const score = Math.round(Math.min(1, ratio + volumeBonus) * 100);
  return Math.max(0, Math.min(100, score));
}

// ────────────────────────────────────────────────────────────────
// CATÉGORISATION D'ERREURS (heuristique simple, sans IA)
// ────────────────────────────────────────────────────────────────
function categorizeError(question, studentAnswer, correctAnswer) {
  if (!studentAnswer) return 'forgetting';

  const q = String(question || '').toLowerCase();

  // Heuristiques basiques par mots-clés
  if (/formule|expression|équation|equation/.test(q)) {
    return 'formula_error';
  }
  if (/calculer|calcule|résoudre|resoudre/.test(q) && studentAnswer !== correctAnswer) {
    return 'calculation_error';
  }
  if (/pourquoi|expliquer|justifier|démontrer|demontrer/.test(q)) {
    return 'comprehension_error';
  }
  if (/méthode|methode|étape|etape/.test(q)) {
    return 'method_error';
  }
  if (/confusion|différence|difference/.test(q)) {
    return 'confusion';
  }

  return 'comprehension_error';
}

// ────────────────────────────────────────────────────────────────
// QUOTAS
// ────────────────────────────────────────────────────────────────
async function checkCaptureQuota(uid) {
  const { db } = getAdminServices();

  const userSnap = await db.collection('users').doc(uid).get();
  const data = userSnap.data();

  if (isPremiumUser(data)) {
    return { allowed: true, premium: true, used: 0, limit: Infinity };
  }

  const period = monthKey(); // YYYY-MM
  const quotaRef = db.collection('users').doc(uid).collection('progressQuota').doc(`captures-${period}`);
  const quotaSnap = await quotaRef.get();
  const used = Number(quotaSnap.data()?.count || 0);

  if (used >= FREE_CAPTURE_LIMIT) {
    return { allowed: false, used, limit: FREE_CAPTURE_LIMIT, premium: false };
  }

  return { allowed: true, used, limit: FREE_CAPTURE_LIMIT, premium: false };
}

async function incrementCaptureQuota(uid) {
  const { db, FieldValue } = getAdminServices();
  const period = monthKey();
  const quotaRef = db.collection('users').doc(uid).collection('progressQuota').doc(`captures-${period}`);
  await quotaRef.set(
    { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// ────────────────────────────────────────────────────────────────
// FOURNISSEURS IA
// ────────────────────────────────────────────────────────────────
function getProviders() {
  return [
    {
      name: 'Groq',
      key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      headers: {}
    },
    {
      name: 'OpenRouter',
      key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      headers: {
        'HTTP-Referer': process.env.APP_ORIGIN || '',
        'X-Title': 'ARVEXA Progress'
      }
    },
    {
      name: 'Mistral',
      key: process.env.MISTRAL_API_KEY,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      headers: {}
    }
  ].filter((p) => Boolean(p.key));
}

async function callProvider(provider, prompt, maxTokens = MAX_AI_TOKENS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const body = {
      model: provider.model,
      temperature: 0.25,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: 'Tu produis exclusivement du JSON valide, sans markdown, sans texte avant ou après.' },
        { role: 'user', content: prompt }
      ]
    };

    // Mistral ne supporte pas response_format comme Groq/OpenRouter
    if (provider.name !== 'Mistral') {
      body.response_format = { type: 'json_object' };
    }

    const result = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.key}`,
        ...provider.headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await result.json().catch(() => null);
    if (!result.ok) throw new Error(`${provider.name} HTTP ${result.status}`);

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${provider.name} réponse vide`);

    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithFallback(prompt, maxTokens = MAX_AI_TOKENS) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const errors = [];
  for (const provider of providers) {
    try {
      return await callProvider(provider, prompt, maxTokens);
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI] ${provider.name} indisponible:`, error.message);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ────────────────────────────────────────────────────────────────
// NORMALISATION LATEX (dictée vocale)
// ────────────────────────────────────────────────────────────────
function normalizeLatexInput(text) {
  if (!text || typeof text !== 'string') return '';

  const replacements = [
    [/\b(\w)\s*au carr[ée]\b/gi, '$1^2'],
    [/\b(\w)\s*au cube\b/gi, '$1^3'],
    [/\b(\w)\s*carr[ée]\b/gi, '$1^2'],
    [/\bracine\s+carr[ée]e?\s+de\s+/gi, '\\sqrt{'],
    [/\bracine\s+de\s+/gi, '\\sqrt{'],
    [/\bf\s*prime\s+de\s+(\w)/gi, "f'($1)"],
    [/\bf\s*prime\b/gi, "f'"],
    [/\bg\s*prime\s+de\s+(\w)/gi, "g'($1)"],
    [/\bint[ée]grale\s+de\s+([^\s]+)\s+[àa]\s+([^\s]+)/gi, '\\int_{$1}^{$2}'],
    [/\blimite\s+quand\s+(\w)\s+tend\s+vers\s+([^\s,;]+)/gi, '\\lim_{$1 \\to $2}'],
    [/\b(\w)\s+indice\s+(\d+)/gi, '$1_{$2}'],
    [/\b(\w)\s+index\s+(\d+)/gi, '$1_{$2}'],
    [/\bdelta\b/gi, '\\Delta'],
    [/\balpha\b/gi, '\\alpha'],
    [/\bbeta\b/gi, '\\beta'],
    [/\bgamma\b/gi, '\\gamma'],
    [/\bpi\b/gi, '\\pi'],
    [/\btheta\b/gi, '\\theta'],
    [/\blambda\b/gi, '\\lambda'],
    [/\bmu\b/gi, '\\mu'],
    [/\bsigma\b/gi, '\\sigma'],
    [/\bfois\b/gi, '\\times'],
    [/\bdivis[ée]\s+par\b/gi, '\\div'],
    [/\bplus\s+ou\s+moins\b/gi, '\\pm'],
    [/\binf[ée]rieur\s+ou\s+[ée]gal\b/gi, '\\leq'],
    [/\bsup[ée]rieur\s+ou\s+[ée]gal\b/gi, '\\geq'],
    [/\bdiff[ée]rent\s+de\b/gi, '\\neq'],
    [/\binfini\b/gi, '\\infty']
  ];

  let result = text;
  replacements.forEach(([pattern, replacement]) => {
    result = result.replace(pattern, replacement);
  });

  return result;
}

// ────────────────────────────────────────────────────────────────
// PROMPT UNIQUE — Analyse cours complète
// (notions + fiche + flashcards + quiz initial)
// ────────────────────────────────────────────────────────────────
function buildFullCourseAnalysisPrompt({ subject, title, content, mode }) {
  const subjectLabel = SUBJECT_LABELS[subject]?.label || subject;
  const modeLabel = mode === 'voice' ? 'dictée vocale' : 'saisie texte';

  return `Tu es un professeur expert du BAC au Niger, spécialisé en ${subjectLabel} pour la Terminale.

Un élève vient d'ajouter un cours via ${modeLabel}. Tu vas générer une ANALYSE COMPLÈTE et PÉDAGOGIQUE.

═══════════════════════════════════════════════════════════════
CONTENU DU COURS
═══════════════════════════════════════════════════════════════
Titre : ${title || '(sans titre)'}
Matière : ${subjectLabel}

${content}

═══════════════════════════════════════════════════════════════
MISSION — 4 ÉTAPES EN UNE SEULE ANALYSE
═══════════════════════════════════════════════════════════════
1. Identifier 5 à ${MAX_NOTIONS_PER_COURSE} notions essentielles du cours
2. Générer une FICHE DE RÉVISION complète et enrichie
3. Générer 10 FLASHCARDS de mémorisation
4. Générer 5 QUESTIONS de quiz de compréhension

═══════════════════════════════════════════════════════════════
RÈGLES LATEX — TRÈS IMPORTANTES
═══════════════════════════════════════════════════════════════
- Toute formule DOIT être entourée de délimiteurs :
  • Inline : $...$  → "Soit $f(x) = x^2$"
  • Display : $$...$$  → "$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$"
- JAMAIS de symboles Unicode bruts :
  ❌ "π" → ✅ "$\\pi$"
  ❌ "√2" → ✅ "$\\sqrt{2}$"
  ❌ "x²" → ✅ "$x^{2}$"
  ❌ "1/2" → ✅ "$\\frac{1}{2}$"
  ❌ "→" → ✅ "$\\to$"
  ❌ "∫" → ✅ "$\\int$"
  ❌ "∑" → ✅ "$\\sum$"
  ❌ "Δ" → ✅ "$\\Delta$"
  ❌ "≤" → ✅ "$\\leq$"
  ❌ "∞" → ✅ "$\\infty$"

- Commandes autorisées :
  \\frac, \\sqrt, ^{}, _{}, \\lim, \\int, \\sum, \\sin, \\cos, \\tan,
  \\ln, \\log, \\alpha...\\omega, \\times, \\div, \\leq, \\geq, \\neq,
  \\infty, \\to, \\Rightarrow, \\Leftrightarrow

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "courseTitle": "Titre court et clair du cours",
  "chapter": "Chapitre identifié (ex: Dérivation, Dynamique...)",
  "summary": {
    "oneLiner": "Phrase de 15 mots max qui résume tout le cours",
    "keyPoints": [
      "Point clé 1",
      "Point clé 2",
      "Point clé 3",
      "Point clé 4",
      "Point clé 5"
    ],
    "mnemonics": [
      "Astuce mnémotechnique 1 si pertinent",
      "Astuce 2"
    ],
    "mustRemember": [
      "$formule_1$ à connaître par cœur",
      "$formule_2$",
      "Définition essentielle"
    ]
  },
  "sections": [
    {
      "title": "Titre de la section",
      "content": "Contenu avec **mots-clés** en gras et formules LaTeX."
    }
  ],
  "examTraps": [
    {
      "trap": "Piège classique au BAC",
      "solution": "Comment l'éviter"
    }
  ],
  "commonMistakes": [
    "Erreur fréquente 1",
    "Erreur fréquente 2"
  ],
  "illisibleZones": [
    "« Cette formule semble incomplète. Peux-tu préciser ? »"
  ],
  "notions": [
    {
      "id": "notion-1-slug-court",
      "name": "Nom court de la notion (max 60 caractères)",
      "description": "Description en 1-2 phrases claires",
      "importance": 3,
      "difficulty": 2,
      "prerequisites": [],
      "keyFormula": "$formule$ si pertinent ou null",
      "commonMistake": "Erreur fréquente à éviter"
    }
  ],
  "flashcards": [
    {
      "notionId": "notion-1-slug-court",
      "question": "Question courte (max 120 caractères)",
      "answer": "Réponse claire (max 250 caractères)",
      "hint": "Indice court ou null"
    }
  ],
  "initialQuiz": [
    {
      "id": "q-1",
      "notionId": "notion-1-slug-court",
      "text": "Question avec formules LaTeX si besoin",
      "type": "choice",
      "options": [
        { "id": "A", "text": "Proposition A" },
        { "id": "B", "text": "Proposition B" },
        { "id": "C", "text": "Proposition C" },
        { "id": "D", "text": "Proposition D" }
      ],
      "correctAnswer": "A",
      "explanation": "Explication courte de la bonne réponse"
    }
  ]
}

═══════════════════════════════════════════════════════════════
RÈGLES FINALES
═══════════════════════════════════════════════════════════════
- 5 à ${MAX_NOTIONS_PER_COURSE} notions (obligatoire)
- 5 à 8 sections de fiche
- 3 à 5 points clés
- 2 à 4 pièges d'examen
- 3 à 5 erreurs fréquentes
- 10 flashcards exactement
- 5 questions de quiz exactement
- 4 options par question de quiz
- importance : 1 (peu) à 5 (crucial)
- difficulty : 1 (facile) à 5 (très difficile)
- Si le contenu est trop court (< 100 caractères), retourne { "error": "content_too_short" }
- Ne mets JAMAIS de texte avant ou après le JSON
- Ne mets JAMAIS de commentaires dans le JSON`;
}

// ────────────────────────────────────────────────────────────────
// FALLBACK LOCAL (si IA indisponible)
// ────────────────────────────────────────────────────────────────
function buildLocalCourseAnalysis(body) {
  const subjectLabel = SUBJECT_LABELS[body.subject]?.label || body.subject;

  const notions = Array.from({ length: 5 }, (_, i) => ({
    id: cleanId(`notion-${i + 1}`),
    name: `Notion ${i + 1}`,
    description: `À compléter avec ton cours (${subjectLabel}).`,
    importance: 3,
    difficulty: 2,
    prerequisites: [],
    keyFormula: null,
    commonMistake: 'À identifier en révisant'
  }));

  return {
    courseTitle: body.title || `Cours de ${subjectLabel}`,
    chapter: 'Général',
    summary: {
      oneLiner: `Cours de ${subjectLabel} en attente d'analyse complète.`,
      keyPoints: [
        'Lire le cours en entier avant de réviser',
        'Identifier les notions clés',
        'Faire des exercices d\'application',
        'Vérifier sa compréhension',
        'Revoir régulièrement'
      ],
      mnemonics: ['Astuce : révise en petites sessions courtes et régulières.'],
      mustRemember: ['Complète cette fiche avec tes notes.']
    },
    sections: [
      {
        title: 'Contenu du cours',
        content: body.content.slice(0, 1000) + (body.content.length > 1000 ? '...' : '')
      }
    ],
    examTraps: [
      { trap: 'Aller trop vite', solution: 'Prends le temps de comprendre chaque étape.' }
    ],
    commonMistakes: [
      'Apprendre par cœur sans comprendre',
      'Ne pas faire d\'exercices'
    ],
    illisibleZones: [],
    notions,
    flashcards: notions.flatMap((n, i) => [
      {
        notionId: n.id,
        question: `Que retenir de la notion "${n.name}" ?`,
        answer: 'Réponse à compléter avec ton cours.',
        hint: null
      },
      {
        notionId: n.id,
        question: `Formule ou point clé de "${n.name}" ?`,
        answer: 'À compléter.',
        hint: null
      }
    ]).slice(0, 10),
    initialQuiz: notions.slice(0, 5).map((n, i) => ({
      id: `q-${i + 1}`,
      notionId: n.id,
      text: `Question sur la notion "${n.name}" ?`,
      type: 'choice',
      options: [
        { id: 'A', text: 'Réponse A' },
        { id: 'B', text: 'Réponse B' },
        { id: 'C', text: 'Réponse C' },
        { id: 'D', text: 'Réponse D' }
      ],
      correctAnswer: 'A',
      explanation: 'Correction locale (IA indisponible).'
    }))
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 1 — getDashboard
// ═══════════════════════════════════════════════════════════════
async function getDashboard(uid) {
  const { db } = getAdminServices();

  // 1. Maîtrise globale
  const masterySnap = await db.collection('users').doc(uid).collection('mastery').limit(500).get();

  let totalNotions = 0;
  let mastered = 0;
  let reinforce = 0;
  let critical = 0;
  let totalScore = 0;
  const allMastery = [];
  const subjectStats = {};

  masterySnap.docs.forEach((docSnap) => {
    const m = docSnap.data();
    const score = Number(m.score) || 0;
    const subject = m.subject || 'mathematiques';

    if (!subjectStats[subject]) {
      subjectStats[subject] = {
        key: subject,
        label: SUBJECT_LABELS[subject]?.label || subject,
        icon: SUBJECT_LABELS[subject]?.icon || 'fa-book',
        scores: []
      };
    }
    subjectStats[subject].scores.push(score);

    totalNotions++;
    totalScore += score;

    if (score >= 75) mastered++;
    else if (score >= 45) reinforce++;
    else critical++;

    allMastery.push({ id: docSnap.id, ...m, computedScore: score });
  });

  const percentUpToDate = totalNotions > 0 ? Math.round(totalScore / totalNotions) : 0;

  const subjectProgress = Object.values(subjectStats).map((s) => ({
    key: s.key,
    label: s.label,
    icon: s.icon,
    percent: s.scores.length > 0
      ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length)
      : 0
  }));

  // 2. Streak (jours consécutifs d'activité)
  const streak = await computeStreak(uid);

  // 3. Cours récents
  const coursesSnap = await db.collection('users').doc(uid).collection('courses')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();

  const recentCourses = await Promise.all(coursesSnap.docs.map(async (docSnap) => {
    const c = docSnap.data();
    const notionIds = c.notionIds || [];
    let courseScore = 0;
    let counted = 0;

    for (const nid of notionIds.slice(0, 20)) {
      const m = allMastery.find((x) => x.id === nid);
      if (m) { courseScore += m.computedScore; counted++; }
    }

    const masteryPercent = counted > 0 ? Math.round(courseScore / counted) : 0;

    return {
      id: docSnap.id,
      title: c.title || 'Cours',
      subjectLabel: SUBJECT_LABELS[c.subject]?.label || '',
      icon: SUBJECT_LABELS[c.subject]?.icon || 'fa-book',
      notionsCount: c.notionsCount || 0,
      masteredCount: notionIds.filter((nid) => {
        const m = allMastery.find((x) => x.id === nid);
        return m && m.computedScore >= 75;
      }).length,
      masteryPercent,
      addedLabel: formatRelativeDate(c.createdAt)
    };
  }));

  // 4. Plan du jour (notions à réviser)
  const todayPlan = await buildTodayPlan(uid, allMastery);

  // 5. Lacunes actives
  const weaknessesSnap = await db.collection('users').doc(uid).collection('weaknesses')
    .orderBy('lastDetectedAt', 'desc')
    .limit(5)
    .get();

  const activeWeaknesses = weaknessesSnap.docs.map((d) => {
    const w = d.data();
    const labels = {
      formula_error: 'Erreurs de formule',
      calculation_error: 'Erreurs de calcul',
      comprehension_error: 'Erreurs de compréhension',
      method_error: 'Erreurs de méthode',
      forgetting: 'Oublis fréquents',
      confusion: 'Confusion entre notions',
      prerequisite_gap: 'Prérequis insuffisants'
    };
    return {
      id: d.id,
      type: w.type,
      label: labels[w.type] || w.type,
      count: w.count || 0,
      suggestedFix: w.suggestedFix || '',
      subject: w.subject || null,
      subjectLabel: w.subject ? (SUBJECT_LABELS[w.subject]?.label || w.subject) : null
    };
  });

  return {
    success: true,
    summary: {
      percentUpToDate,
      totalNotions,
      mastered,
      reinforce,
      critical
    },
    streak,
    todayPlan,
    subjectProgress,
    recentCourses,
    activeWeaknesses
  };
}

// ────────────────────────────────────────────────────────────────
// CALCUL DU STREAK
// ────────────────────────────────────────────────────────────────
async function computeStreak(uid) {
  const { db } = getAdminServices();

  const snap = await db.collection('users').doc(uid).collection('dailyActivity')
    .orderBy('date', 'desc')
    .limit(60)
    .get()
    .catch(() => ({ docs: [] }));

  if (snap.docs.length === 0) return { current: 0, best: 0, history: [] };

  const activeDates = new Set(
    snap.docs
      .map((d) => d.data().date)
      .filter((date) => date)
  );

  // Streak actuel : remonte depuis aujourd'hui
  let current = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (activeDates.has(key)) current++;
    else break;
  }

  // Meilleur streak : parcourt l'historique
  const sorted = Array.from(activeDates).sort();
  let best = 0;
  let run = 0;
  let prev = null;

  sorted.forEach((dateStr) => {
    if (prev) {
      const prevDate = new Date(prev);
      const currDate = new Date(dateStr);
      const diffDays = Math.round((currDate - prevDate) / (24 * 60 * 60 * 1000));
      if (diffDays === 1) run++;
      else run = 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prev = dateStr;
  });

  const history = sorted.slice(-30); // 30 derniers jours d'activité

  return { current, best, history };
}

// ────────────────────────────────────────────────────────────────
// PLAN DU JOUR
// ────────────────────────────────────────────────────────────────
async function buildTodayPlan(uid, allMastery) {
  const items = [];
  const now = Date.now();

  // 1. Notions à réviser (SRS : nextReviewAt <= maintenant)
  const candidates = allMastery
    .filter((m) => {
      const next = toISO(m.nextReviewAt);
      return !next || new Date(next).getTime() <= now + 12 * 60 * 60 * 1000;
    })
    .sort((a, b) => {
      // Priorité : score faible d'abord, puis nextReviewAt ancien
      if (a.computedScore !== b.computedScore) return a.computedScore - b.computedScore;
      const aNext = toISO(a.nextReviewAt) || '9999';
      const bNext = toISO(b.nextReviewAt) || '9999';
      return aNext.localeCompare(bNext);
    })
    .slice(0, 4);

  candidates.forEach((m, i) => {
    const subject = m.subject || 'mathematiques';
    const subjInfo = SUBJECT_LABELS[subject];
    items.push({
      id: `revision-${m.id}-${i}`,
      kind: 'revision',
      notionId: m.id,
      title: m.notionName || 'Notion',
      subject,
      subjectLabel: subjInfo?.label || '',
      icon: subjInfo?.icon || 'fa-book',
      duration: m.computedScore < 30 ? 12 : m.computedScore < 60 ? 9 : 7,
      task: m.computedScore < 30 ? 'Réviser' : m.computedScore < 60 ? 'S\'entraîner' : 'Réactiver'
    });
  });

  // 2. Ajouter un test surprise si assez de notions
  if (allMastery.length >= 5) {
    const hasWeak = allMastery.some((m) => m.computedScore < 50);
    if (hasWeak) {
      items.push({
        id: 'surprise-today',
        kind: 'surprise_test',
        title: 'Test surprise',
        duration: 6,
        task: 'Tester mes réflexes'
      });
    }
  }

  return items;
}

// ═══════════════════════════════════════════════════════════════
// ACTION 2 — analyzeCourse (texte/voix)
// ═══════════════════════════════════════════════════════════════
async function analyzeCourse(uid, body) {
  const { subject, title, content, mode = 'text' } = body;

  if (!ALLOWED_SUBJECTS.has(subject)) {
    throw { status: 400, message: 'Matière invalide.' };
  }
  if (!content || typeof content !== 'string') {
    throw { status: 400, message: 'Contenu manquant.' };
  }
  if (content.length < MIN_CONTENT_LENGTH) {
    throw { status: 400, message: `Contenu trop court (min ${MIN_CONTENT_LENGTH} caractères).` };
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw { status: 400, message: `Contenu trop long (max ${MAX_CONTENT_LENGTH} caractères).` };
  }
  if (!ALLOWED_CAPTURE_MODES.has(mode)) {
    throw { status: 400, message: 'Mode de capture invalide.' };
  }

  // Quota
  const quota = await checkCaptureQuota(uid);
  if (!quota.allowed) {
    throw {
      status: 429,
      message: `Limite gratuite atteinte (${quota.limit} cours/mois). Passe à Premium pour continuer.`,
      code: 'FREE_CAPTURE_LIMIT'
    };
  }

  // Normaliser LaTeX (dictée vocale)
  const normalizedContent = normalizeLatexInput(content);

  // ── CACHE : cherche une analyse existante similaire ──
  const hash = contentHash(normalizedContent + subject + (title || ''));
  const { db, FieldValue } = getAdminServices();

  const cacheRef = db.collection('users').doc(uid).collection('analysisCache').doc(hash);
  const cacheSnap = await cacheRef.get();

  if (cacheSnap.exists()) {
    const cached = cacheSnap.data();
    const ageDays = (Date.now() - (toISO(cached.cachedAt) ? new Date(toISO(cached.cachedAt)).getTime() : 0)) / (24 * 60 * 60 * 1000);
    if (ageDays < 30) {
      console.log('[PROGRESS] Cache hit pour analyse cours');
      // Incrémenter le quota quand même (c'est un nouveau cours pour l'élève)
      if (!quota.premium) await incrementCaptureQuota(uid);
      return {
        success: true,
        cached: true,
        courseId: null,
        analysis: cached.analysis,
        notionsCount: (cached.analysis.notions || []).length,
        message: 'Analyse récupérée depuis le cache.'
      };
    }
  }

  // ── APPEL IA ──
  let analysis;
  try {
    const prompt = buildFullCourseAnalysisPrompt({
      subject,
      title,
      content: normalizedContent,
      mode
    });

    analysis = await generateWithFallback(prompt, MAX_AI_TOKENS);

    if (analysis.error === 'content_too_short') {
      throw { status: 400, message: 'Contenu trop court pour être analysé.' };
    }
  } catch (aiError) {
    console.warn('[PROGRESS] Fallback local :', aiError.message);
    analysis = buildLocalCourseAnalysis({ subject, title, content: normalizedContent, mode });
  }

  // Limiter le nombre de notions
  const notions = Array.isArray(analysis.notions)
    ? analysis.notions.slice(0, MAX_NOTIONS_PER_COURSE)
    : [];

  if (notions.length === 0) {
    throw { status: 500, message: 'Analyse échouée. Réessaie avec un contenu plus structuré.' };
  }

  // ── SAUVEGARDE FIRESTORE ──
  const courseRef = db.collection('users').doc(uid).collection('courses').doc();
  const courseId = courseRef.id;

  const notionIds = notions.map((n) => cleanId(n.id || n.name));

  await courseRef.set({
    subject,
    title: analysis.courseTitle || title || 'Cours',
    chapter: analysis.chapter || null,
    content: normalizedContent.slice(0, 8000),
    summary: analysis.summary || null,
    sections: analysis.sections || [],
    examTraps: analysis.examTraps || [],
    commonMistakes: analysis.commonMistakes || [],
    illisibleZones: analysis.illisibleZones || [],
    notionIds,
    notionsCount: notions.length,
    captureMode: mode,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  // Notions + maîtrise initiale
  const batch = db.batch();

  notions.forEach((n) => {
    const notionId = cleanId(n.id || n.name);
    const notionRef = courseRef.collection('notions').doc(notionId);

    batch.set(notionRef, {
      id: notionId,
      name: n.name || 'Notion',
      description: n.description || '',
      importance: Math.max(1, Math.min(5, Number(n.importance) || 3)),
      difficulty: Math.max(1, Math.min(5, Number(n.difficulty) || 2)),
      prerequisites: Array.isArray(n.prerequisites) ? n.prerequisites : [],
      keyFormula: n.keyFormula || null,
      commonMistake: n.commonMistake || null,
      courseId,
      subject,
      createdAt: FieldValue.serverTimestamp()
    });

    const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);
    batch.set(masteryRef, {
      notionId,
      notionName: n.name || 'Notion',
      courseId,
      subject,
      score: 0,
      easiness: SRS_DEFAULT_EASINESS,
      interval: 1,
      repetitions: 0,
      nextReviewAt: FieldValue.serverTimestamp(),
      history: [],
      totalAttempts: 0,
      totalCorrect: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await batch.commit();

  // Cache l'analyse
  await cacheRef.set({
    analysis,
    cachedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  // Incrémenter le quota (si non-Premium)
  if (!quota.premium) await incrementCaptureQuota(uid);

  return {
    success: true,
    cached: false,
    courseId,
    notionsCount: notions.length,
    analysis,
    message: `${notions.length} notion(s) extraite(s). Fiche + flashcards + quiz prêts !`
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 3 — getCourseDetail
// ═══════════════════════════════════════════════════════════════
async function getCourseDetail(uid, body) {
  const { courseId } = body;
  if (!courseId) throw { status: 400, message: 'courseId requis.' };

  const { db } = getAdminServices();

  const courseRef = db.collection('users').doc(uid).collection('courses').doc(courseId);
  const courseSnap = await courseRef.get();

  if (!courseSnap.exists) throw { status: 404, message: 'Cours introuvable.' };

  const course = courseSnap.data();

  const notionsSnap = await courseRef.collection('notions').get();
  const notions = notionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Récupérer la maîtrise de chaque notion
  const masterySnap = await db.collection('users').doc(uid).collection('mastery')
    .where('courseId', '==', courseId)
    .get();

  const masteryMap = {};
  masterySnap.docs.forEach((d) => {
    const m = d.data();
    masteryMap[d.id] = {
      score: Number(m.score) || 0,
      nextReviewAt: toISO(m.nextReviewAt),
      totalAttempts: m.totalAttempts || 0
    };
  });

  const notionsWithMastery = notions.map((n) => ({
    ...n,
    mastery: masteryMap[n.id] || { score: 0, nextReviewAt: null, totalAttempts: 0 }
  }));

  return {
    success: true,
    course: {
      id: courseId,
      subject: course.subject,
      subjectLabel: SUBJECT_LABELS[course.subject]?.label || '',
      title: course.title,
      chapter: course.chapter,
      summary: course.summary,
      sections: course.sections || [],
      examTraps: course.examTraps || [],
      commonMistakes: course.commonMistakes || [],
      createdAt: toISO(course.createdAt)
    },
    notions: notionsWithMastery
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 4 — reviewFlashcard (feedback actif)
// ═══════════════════════════════════════════════════════════════
async function reviewFlashcard(uid, body) {
  const { notionId, rating } = body;

  if (!notionId) throw { status: 400, message: 'notionId requis.' };
  if (!['easy', 'medium', 'hard'].includes(rating)) {
    throw { status: 400, message: 'Rating invalide.' };
  }

  const { db, FieldValue } = getAdminServices();

  const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);
  const snap = await masteryRef.get();
  if (!snap.exists) throw { status: 404, message: 'Notion introuvable.' };

  const m = snap.data();
  const isCorrect = rating === 'easy'; // seul "easy" compte comme succès pour le SRS
  const isFailure = rating === 'hard';

  // Mise à jour historique
  const history = Array.isArray(m.history) ? [...m.history] : [];
  history.push({
    date: new Date().toISOString(),
    correct: isCorrect,
    rating,
    source: 'flashcard'
  });
  if (history.length > 50) history.splice(0, history.length - 50);

  const totalAttempts = (Number(m.totalAttempts) || 0) + 1;
  const totalCorrect = (Number(m.totalCorrect) || 0) + (isCorrect ? 1 : 0);

  // Recalcul du score
  const score = computeMasteryScore(history, totalAttempts, totalCorrect);

  // SRS
  const srs = computeNextReview(
    { easiness: m.easiness, interval: m.interval, repetitions: m.repetitions },
    !isFailure,
    null
  );

  await masteryRef.set({
    score,
    history,
    totalAttempts,
    totalCorrect,
    easiness: srs.easiness,
    interval: srs.interval,
    repetitions: srs.repetitions,
    nextReviewAt: srs.nextReviewAt,
    lastAttemptAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  // Track activité quotidienne
  await markDailyActivity(uid, { reviewed: 1, correct: isCorrect ? 1 : 0 });

  return {
    success: true,
    newScore: score,
    nextReviewIn: srs.interval
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 5 — generateQuiz
// ═══════════════════════════════════════════════════════════════
async function generateQuiz(uid, body) {
  const { courseId, count = 5, difficulty = 2 } = body;
  if (!courseId) throw { status: 400, message: 'courseId requis.' };

  const { db } = getAdminServices();

  const courseRef = db.collection('users').doc(uid).collection('courses').doc(courseId);
  const courseSnap = await courseRef.get();
  if (!courseSnap.exists) throw { status: 404, message: 'Cours introuvable.' };

  const course = courseSnap.data();
  const notionsSnap = await courseRef.collection('notions').get();
  const notions = notionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (notions.length === 0) throw { status: 400, message: 'Aucune notion dans ce cours.' };

  const subjectLabel = SUBJECT_LABELS[course.subject]?.label || course.subject;

  const prompt = `Tu es un professeur expert du BAC au Niger. Génère un quiz en JSON.

Matière : ${subjectLabel}
Chapitre : ${course.chapter || course.title}
Notions : ${notions.map((n) => `- ${n.name}: ${n.description}`).join('\n')}
Difficulté : ${difficulty}/4
Nombre de questions : ${count}

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Formules entre $...$ (inline) ou $$...$$ (display)
- JAMAIS de symboles Unicode bruts
- Exemples : "$3x^2$", "$\\frac{1}{2}$", "$\\lim_{x \\to 0}$"

═══════════════════════════════════════════════════════════════
FORMAT (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "quiz": [
    {
      "notionId": "id-notion-concernée",
      "text": "Question",
      "options": [
        { "id": "A", "text": "Option A" },
        { "id": "B", "text": "Option B" },
        { "id": "C", "text": "Option C" },
        { "id": "D", "text": "Option D" }
      ],
      "correctAnswer": "A",
      "explanation": "Explication pédagogique"
    }
  ]
}

- Exactement ${count} questions
- 4 options par question
- Une seule bonne réponse
- Commence facile, termine difficile`;

  let quizData;
  try {
    quizData = await generateWithFallback(prompt, 4000);
    if (!Array.isArray(quizData.questions) && !Array.isArray(quizData.quiz)) {
      throw new Error('format invalide');
    }
  } catch (e) {
    // Fallback local
    quizData = {
      quiz: notions.slice(0, count).map((n, i) => ({
        notionId: n.id,
        text: `Question sur "${n.name}"`,
        options: [
          { id: 'A', text: 'Réponse A' },
          { id: 'B', text: 'Réponse B' },
          { id: 'C', text: 'Réponse C' },
          { id: 'D', text: 'Réponse D' }
        ],
        correctAnswer: 'A',
        explanation: 'Correction locale.'
      }))
    };
  }

  const questions = quizData.quiz || quizData.questions || [];

  return {
    success: true,
    questions: questions.slice(0, count)
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 6 — submitQuiz
// ═══════════════════════════════════════════════════════════════
async function submitQuiz(uid, body) {
  const { courseId, answers = [] } = body;

  if (!Array.isArray(answers) || answers.length === 0) {
    throw { status: 400, message: 'Aucune réponse fournie.' };
  }

  const { db, FieldValue } = getAdminServices();

  const correct = answers.filter((a) => a.isCorrect).length;
  const total = answers.length;
  const scorePercent = Math.round((correct / total) * 100);

  // Enregistrer la session
  const sessionRef = db.collection('users').doc(uid).collection('sessions').doc();
  await sessionRef.set({
    type: 'quiz',
    courseId: courseId || null,
    score: correct,
    total,
    scorePercent,
    answers: answers.map((a) => ({
      notionId: a.notionId || null,
      questionText: (a.text || '').slice(0, 400),
      selected: a.selected || null,
      correct: a.correct || null,
      isCorrect: Boolean(a.isCorrect)
    })),
    createdAt: FieldValue.serverTimestamp()
  });

  // Mise à jour de la maîtrise pour chaque notion
  const notionGroups = {};
  answers.forEach((a) => {
    if (!a.notionId) return;
    if (!notionGroups[a.notionId]) notionGroups[a.notionId] = [];
    notionGroups[a.notionId].push(a);
  });

  for (const [notionId, notionAnswers] of Object.entries(notionGroups)) {
    await updateMasteryFromAnswers(uid, notionId, notionAnswers);
  }

  // Activité quotidienne
  await markDailyActivity(uid, { reviewed: total, correct });

  // Détection de lacunes
  const detected = await detectWeaknesses(uid, answers);

  // Message personnalisé
  let message = 'Ta maîtrise a été mise à jour.';
  if (scorePercent >= 90) message = '🎉 Excellent ! Notion bientôt maîtrisée.';
  else if (scorePercent >= 70) message = '👍 Bien joué ! Continue comme ça.';
  else if (scorePercent >= 50) message = '💪 Bon début, une révision de plus s\'impose.';
  else message = '📚 Cette notion a besoin de plus de travail.';

  return {
    success: true,
    score: correct,
    total,
    scorePercent,
    message,
    weaknessDetected: detected.length > 0
  };
}

// ────────────────────────────────────────────────────────────────
// MISE À JOUR MAÎTRISE À PARTIR DES RÉPONSES
// ────────────────────────────────────────────────────────────────
async function updateMasteryFromAnswers(uid, notionId, answers) {
  const { db, FieldValue } = getAdminServices();

  const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);
  const snap = await masteryRef.get();
  if (!snap.exists) return;

  const m = snap.data();
  const history = Array.isArray(m.history) ? [...m.history] : [];

  // Ajouter chaque réponse à l'historique
  answers.forEach((a) => {
    history.push({
      date: new Date().toISOString(),
      correct: Boolean(a.isCorrect),
      source: 'quiz'
    });
  });

  if (history.length > 50) history.splice(0, history.length - 50);

  const totalAttempts = (Number(m.totalAttempts) || 0) + answers.length;
  const totalCorrect = (Number(m.totalCorrect) || 0) + answers.filter((a) => a.isCorrect).length;

  const score = computeMasteryScore(history, totalAttempts, totalCorrect);

  // SRS : le quiz est considéré comme correct si ≥ 60% de réussite sur la notion
  const correctRate = answers.filter((a) => a.isCorrect).length / answers.length;
  const srs = computeNextReview(
    { easiness: m.easiness, interval: m.interval, repetitions: m.repetitions },
    correctRate >= 0.6,
    null
  );

  await masteryRef.set({
    score,
    history,
    totalAttempts,
    totalCorrect,
    easiness: srs.easiness,
    interval: srs.interval,
    repetitions: srs.repetitions,
    nextReviewAt: srs.nextReviewAt,
    lastAttemptAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

// ═══════════════════════════════════════════════════════════════
// ACTION 7 — getReviewQueue
// ═══════════════════════════════════════════════════════════════
async function getReviewQueue(uid) {
  const { db } = getAdminServices();

  const now = new Date();
  const masterySnap = await db.collection('users').doc(uid).collection('mastery')
    .where('nextReviewAt', '<=', now)
    .limit(20)
    .get()
    .catch(() => ({ docs: [] }));

  const items = masterySnap.docs.map((d) => {
    const m = d.data();
    return {
      notionId: d.id,
      notionName: m.notionName || 'Notion',
      subject: m.subject,
      subjectLabel: SUBJECT_LABELS[m.subject]?.label || '',
      score: Number(m.score) || 0,
      nextReviewAt: toISO(m.nextReviewAt)
    };
  });

  return { success: true, items };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 8 — getStreak
// ═══════════════════════════════════════════════════════════════
async function getStreak(uid) {
  const streak = await computeStreak(uid);
  return { success: true, ...streak };
}

// ═══════════════════════════════════════════════════════════════
// UTILITAIRES INTERNES
// ═══════════════════════════════════════════════════════════════

// Marque une activité quotidienne (pour streak)
async function markDailyActivity(uid, { reviewed = 0, correct = 0 } = {}) {
  const { db, FieldValue } = getAdminServices();
  const dateKey = todayKey();
  const ref = db.collection('users').doc(uid).collection('dailyActivity').doc(dateKey);

  await ref.set({
    date: dateKey,
    reviewed: FieldValue.increment(reviewed),
    correct: FieldValue.increment(correct),
    lastAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

// Détecte les faiblesses à partir des réponses
async function detectWeaknesses(uid, answers) {
  const { db, FieldValue } = getAdminServices();

  // Grouper les mauvaises réponses par catégorie
  const wrongByCategory = {};
  answers.forEach((a) => {
    if (a.isCorrect) return;
    const cat = categorizeError(a.text, a.selected, a.correct);
    wrongByCategory[cat] = (wrongByCategory[cat] || 0) + 1;
  });

  const detected = [];

  for (const [category, count] of Object.entries(wrongByCategory)) {
    if (count < 3) continue; // seuil

    const weaknessId = cleanId(`weakness-${category}`);
    const ref = db.collection('users').doc(uid).collection('weaknesses').doc(weaknessId);
    const existing = await ref.get();

    const existingCount = existing.exists ? Number(existing.data().count || 0) : 0;

    await ref.set({
      type: category,
      count: existingCount + count,
      lastDetectedAt: FieldValue.serverTimestamp(),
      suggestedFix: 'Refais quelques exercices sur cette notion.',
      resolved: false
    }, { merge: true });

    detected.push(category);
  }

  return detected;
}

// ────────────────────────────────────────────────────────────────
// FORMAT RELATIVE DATE
// ────────────────────────────────────────────────────────────────
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

  if (!user) {
    return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action;
  const uid = user.uid;

  try {
    switch (action) {
      case 'getDashboard':      return response.status(200).json(await getDashboard(uid));
      case 'analyzeCourse':     return response.status(200).json(await analyzeCourse(uid, body));
      case 'getCourseDetail':   return response.status(200).json(await getCourseDetail(uid, body));
      case 'reviewFlashcard':   return response.status(200).json(await reviewFlashcard(uid, body));
      case 'generateQuiz':      return response.status(200).json(await generateQuiz(uid, body));
      case 'submitQuiz':        return response.status(200).json(await submitQuiz(uid, body));
      case 'getReviewQueue':    return response.status(200).json(await getReviewQueue(uid));
      case 'getStreak':         return response.status(200).json(await getStreak(uid));
      default:
        return jsonError(response, 400, `Action inconnue : "${action}"`);
    }
  } catch (error) {
    console.error(`Progress action "${action}" failed:`, error.message);
    if (error.stack) console.error(error.stack);
    if (error.status) {
      return jsonError(response, error.status, error.message, error.code);
    }
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
