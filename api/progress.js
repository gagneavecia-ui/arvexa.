// ================================================================
// API PROGRESS — ARVEXA School
// Moteur de progression intelligent ARV-PROGRESS
// Version : 1.0.0
// ================================================================

// ────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt']);
const ALLOWED_CAPTURE_MODES = new Set(['text', 'photo', 'voice']);
const MIN_CONTENT_LENGTH = 100;
const MAX_CONTENT_LENGTH = 15000;
const MAX_NOTIONS_PER_COURSE = 15;
const FREE_CAPTURE_LIMIT = 2;          // 2 captures gratuites / mois
const FREE_SURPRISE_LIMIT = 5;         // 5 tests surprise / semaine

const SUBJECT_LABELS = {
  mathematiques: { label: 'Mathématiques', icon: 'fa-square-root-variable' },
  physique: { label: 'Physique', icon: 'fa-bolt' },
  chimie: { label: 'Chimie', icon: 'fa-flask' },
  svt: { label: 'SVT', icon: 'fa-dna' }
};

const ERROR_CATEGORIES = [
  'formula_error',       // erreur de formule
  'calculation_error',   // erreur de calcul
  'comprehension_error', // erreur de compréhension
  'method_error',        // erreur de méthode
  'forgetting',          // oubli
  'confusion',           // confusion entre notions
  'prerequisite_gap'     // prérequis insuffisant
];

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

function weekKey() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - start) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((days + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
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

async function callProvider(provider, prompt, maxTokens = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const result = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.key}`,
        ...provider.headers
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.25,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Tu produis exclusivement du JSON valide.' },
          { role: 'user', content: prompt }
        ]
      }),
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

async function generateWithFallback(prompt, maxTokens = 6000) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  for (const provider of providers) {
    try {
      return await callProvider(provider, prompt, maxTokens);
    } catch (error) {
      console.warn(`${provider.name} indisponible:`, error.message);
    }
  }
  throw new Error('all_providers_failed');
}

// ────────────────────────────────────────────────────────────────
// NORMALISATION LATEX
// ────────────────────────────────────────────────────────────────
function normalizeLatexInput(text) {
  if (!text || typeof text !== 'string') return '';

  // Corrections courantes de transcription vocale / OCR
  const replacements = [
    // Exposants vocaux
    [/\b(\w)\s*au carr[ée]\b/gi, '$1^2'],
    [/\b(\w)\s*au cube\b/gi, '$1^3'],
    [/\b(\w)\s*carr[ée]\b/gi, '$1^2'],
    // Racines
    [/\bracine\s+carr[ée]e?\s+de\s+/gi, '\\sqrt{'],
    [/\bracine\s+de\s+/gi, '\\sqrt{'],
    // Fonctions
    [/\bf\s*prime\s+de\s+(\w)/gi, "f'($1)"],
    [/\bf\s*prime\b/gi, "f'"],
    [/\bg\s*prime\s+de\s+(\w)/gi, "g'($1)"],
    // Intégrales
    [/\bint[ée]grale\s+de\s+([^\s]+)\s+[àa]\s+([^\s]+)/gi, '\\int_{$1}^{$2}'],
    // Limites
    [/\blimite\s+quand\s+(\w)\s+tend\s+vers\s+([^\s,;]+)/gi, '\\lim_{$1 \\to $2}'],
    // Indices
    [/\b(\w)\s+indice\s+(\d+)/gi, '$1_{$2}'],
    [/\b(\w)\s+index\s+(\d+)/gi, '$1_{$2}'],
    // Symboles grecs
    [/\bdelta\b/gi, '\\Delta'],
    [/\balpha\b/gi, '\\alpha'],
    [/\bbeta\b/gi, '\\beta'],
    [/\bgamma\b/gi, '\\gamma'],
    [/\bpi\b/gi, '\\pi'],
    [/\btheta\b/gi, '\\theta'],
    [/\blambda\b/gi, '\\lambda'],
    [/\bmu\b/gi, '\\mu'],
    [/\bsigma\b/gi, '\\sigma'],
    // Opérations
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
// PROMPTS IA
// ────────────────────────────────────────────────────────────────
function buildCourseAnalysisPrompt({ subject, title, content, mode }) {
  const subjectLabel = SUBJECT_LABELS[subject]?.label || subject;

  return `Tu es un professeur expert du BAC au Niger, spécialisé en ${subjectLabel} pour la Terminale.

Un élève vient d'ajouter un cours via le mode "${mode}". Analyse-le et génère une structure pédagogique complète.

═══════════════════════════════════════════════════════════════
CONTENU DU COURS
═══════════════════════════════════════════════════════════════
Titre : ${title || '(sans titre)'}
Matière : ${subjectLabel}

${content}

═══════════════════════════════════════════════════════════════
MISSION
═══════════════════════════════════════════════════════════════
1. Identifier les notions essentielles du cours (3 à 10 notions)
2. Détecter les zones illisibles (si le texte est bizarre / incomplet)
3. Générer un résumé ultra-mémorisable
4. Générer 5 questions de quiz pour tester la compréhension
5. Formuler des formules au format LaTeX valide
6. Identifier les prérequis nécessaires

═══════════════════════════════════════════════════════════════
RÈGLES LATEX — TRÈS IMPORTANTES
═══════════════════════════════════════════════════════════════
- Toute formule mathématique DOIT être entourée de délimiteurs :
  • Inline : $...$  →  "Soit $f(x) = x^2$"
  • Display : $$...$$  →  "$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$"
- Utilise UNIQUEMENT la syntaxe LaTeX valide, JAMAIS de symboles Unicode bruts :
  ❌ "π" → ✅ "$\\pi$"
  ❌ "√2" → ✅ "$\\sqrt{2}$"
  ❌ "x²" → ✅ "$x^{2}$"
  ❌ "f'(x)" → ✅ "$f'(x)$" ou "$f\\,'(x)$"
  ❌ "→" → ✅ "$\\to$"
  ❌ "∫" → ✅ "$\\int$"
  ❌ "∑" → ✅ "$\\sum$"
  ❌ "Δ" → ✅ "$\\Delta$"
  ❌ "≤" → ✅ "$\\leq$"
  ❌ "∞" → ✅ "$\\infty$"
- Commandes autorisées : \\frac, \\sqrt, ^{}, _{}, \\lim, \\int, \\sum, \\sin, \\cos, \\tan, \\ln, \\log, \\alpha...\\omega, \\times, \\div, \\leq, \\geq, \\neq, \\infty, \\to, \\Rightarrow, \\Leftrightarrow

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "courseTitle": "Titre court et clair du cours",
  "subject": "${subject}",
  "chapter": "Chapitre identifié (ex: Dérivation, Dynamique...)",
  "summary": {
    "oneLiner": "Phrase de 15 mots max qui résume tout le cours",
    "keyPoints": [
      "Point clé 1 (max 100 caractères)",
      "Point clé 2",
      "Point clé 3",
      "Point clé 4",
      "Point clé 5",
      "Point clé 6",
      "Point clé 7"
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
  "illisibleZones": [
    "« Cette formule semble incomplète. Peux-tu préciser ? »"
  ],
  "notions": [
    {
      "id": "notion-1-slug-court",
      "name": "Nom court de la notion (max 60 caractères)",
      "description": "Description en 1-2 phrases claires",
      "importance": 1,
      "difficulty": 2,
      "prerequisites": [],
      "keyFormula": "$formule$ si pertinent ou null",
      "commonMistake": "Erreur fréquente à éviter",
      "exampleIfNeeded": "Court exemple si utile"
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
- 3 à 10 notions maximum (pas plus, pas moins)
- 5 questions dans initialQuiz
- importance : 1 (peu important) à 5 (crucial pour le BAC)
- difficulty : 1 (facile) à 5 (très difficile)
- Pour matières scientifiques, les options de QCM doivent contenir des formules LaTeX
- Si le contenu est trop court (<100 caractères), retourne { "error": "content_too_short" }
- Si tu détectes des zones illisibles (OCR ou transcription bizarre), liste-les dans illisibleZones
- Ne mets JAMAIS de texte avant ou après le JSON
- Ne mets JAMAIS de commentaires dans le JSON`;
}

function buildFlashcardsPrompt({ notion, subject }) {
  const subjectLabel = SUBJECT_LABELS[subject]?.label || subject;

  return `Tu es un professeur expert qui crée des flashcards de mémorisation pour un élève de Terminale en ${subjectLabel}.

Notion : ${notion.name}
Description : ${notion.description || ''}
Formule clé : ${notion.keyFormula || 'Aucune'}

Crée 10 flashcards pour mémoriser cette notion. Chaque flashcard a un recto (question courte) et un verso (réponse claire et mémorisable).

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Inline : $...$  →  "La dérivée de $x^2$ est $2x$"
- Display : $$...$$ pour les formules isolées
- JAMAIS de symboles Unicode bruts (π, √, ×, ≤, ∞...)

═══════════════════════════════════════════════════════════════
FORMAT (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "flashcards": [
    {
      "front": "Question courte (max 120 caractères)",
      "back": "Réponse claire (max 250 caractères) avec LaTeX si besoin",
      "hint": "Indice court optionnel ou null"
    }
  ]
}

Règles :
- 10 flashcards exactement
- Recto : questions directes (Qu'est-ce que...? Comment calculer...? Quelle est la formule de...?)
- Verso : réponses concises mais complètes
- La dernière flashcard doit être une question piège ou un cas limite
- Ne mets JAMAIS de texte avant ou après le JSON`;
}

function buildQuizPrompt({ notion, difficulty = 2, subject }) {
  const subjectLabel = SUBJECT_LABELS[subject]?.label || subject;

  return `Tu es un professeur expert qui crée un quiz pour un élève de Terminale en ${subjectLabel}.

Notion : ${notion.name}
Description : ${notion.description || ''}
Formule clé : ${notion.keyFormula || 'Aucune'}
Niveau de difficulté demandé : ${difficulty}/5

Crée 5 questions à choix multiples pour tester la compréhension de cette notion.

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Inline : $...$  →  "Quelle est la dérivée de $f(x) = x^3$ ?"
- Options : "$3x^2$", "$x^2$", "$3x$", "$x^4$"
- JAMAIS de symboles Unicode bruts

═══════════════════════════════════════════════════════════════
FORMAT (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "questions": [
    {
      "id": "q-1",
      "text": "Question avec LaTeX si besoin",
      "options": [
        { "id": "A", "text": "Option A" },
        { "id": "B", "text": "Option B" },
        { "id": "C", "text": "Option C" },
        { "id": "D", "text": "Option D" }
      ],
      "correctAnswer": "B",
      "explanation": "Explication pédagogique courte (1-2 phrases)",
      "errorCategory": "formula_error"
    }
  ]
}

errorCategory doit être parmi : formula_error, calculation_error, comprehension_error, method_error, forgetting, confusion, prerequisite_gap

Règles :
- 5 questions exactement
- 4 options par question
- Une seule bonne réponse
- Niveau ${difficulty}/5 respecté
- Ne mets JAMAIS de texte avant ou après le JSON`;
}

function buildSurpriseTestPrompt({ notions, subject, count = 5 }) {
  const subjectLabel = SUBJECT_LABELS[subject]?.label || subject;

  return `Tu es un professeur expert qui prépare un test surprise pour un élève de Terminale en ${subjectLabel}.

Notions à tester (fragiles ou importantes) :
${notions.map((n, i) => `${i + 1}. ${n.name} : ${n.description || ''}`).join('\n')}

Génère ${count} questions mélangées pour tester ces notions de façon imprévisible, comme une interrogation surprise.

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Inline : $...$ / Display : $$...$$
- JAMAIS de symboles Unicode bruts

═══════════════════════════════════════════════════════════════
FORMAT (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "test": [
    {
      "id": "q-1",
      "notionId": "notion-id-correspondant",
      "text": "Question",
      "options": [
        { "id": "A", "text": "Option A" },
        { "id": "B", "text": "Option B" },
        { "id": "C", "text": "Option C" },
        { "id": "D", "text": "Option D" }
      ],
      "correctAnswer": "A",
      "explanation": "Explication",
      "errorCategory": "method_error"
    }
  ]
}

Règles :
- ${count} questions
- Mélange les notions (pas 5 questions sur la même notion)
- Niveau BAC Terminale
- Ne mets JAMAIS de texte avant ou après le JSON`;
}

function buildErrorAnalysisPrompt({ question, studentAnswer, correctAnswer, notion }) {
  return `Tu es un professeur correcteur expert. Analyse l'erreur de l'élève.

Notion : ${notion?.name || 'Inconnue'}
Question : ${question}
Réponse de l'élève : ${studentAnswer || '(vide)'}
Bonne réponse : ${correctAnswer}

Catégorise cette erreur dans UNE des catégories suivantes :
- formula_error : erreur de formule
- calculation_error : erreur de calcul
- comprehension_error : erreur de compréhension
- method_error : erreur de méthode
- forgetting : oubli
- confusion : confusion entre notions
- prerequisite_gap : prérequis insuffisant

═══════════════════════════════════════════════════════════════
FORMAT (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "category": "formula_error",
  "feedback": "Explication courte de l'erreur (max 200 caractères)",
  "tip": "Conseil pour éviter cette erreur",
  "prerequisite": "Notion prérequise à renforcer ou null"
}

Ne mets JAMAIS de texte avant ou après le JSON.`;
}

// ────────────────────────────────────────────────────────────────
// CALCULS DÉTERMINISTES
// ────────────────────────────────────────────────────────────────

// Courbe de l'oubli SM-2 simplifiée
function computeNextReviewDate(masteryScore, reviewCount) {
  const baseIntervals = [1, 3, 7, 14, 30, 60, 120];
  let baseDays;

  if (masteryScore >= 80) baseDays = baseIntervals[Math.min(reviewCount, 6)];
  else if (masteryScore >= 60) baseDays = Math.ceil(baseIntervals[Math.min(reviewCount, 6)] * 0.7);
  else if (masteryScore >= 40) baseDays = Math.ceil(baseIntervals[Math.min(reviewCount, 6)] * 0.4);
  else baseDays = 1;

  const next = new Date();
  next.setDate(next.getDate() + baseDays);
  return next;
}

// Score de maîtrise global d'une notion
function computeMasteryScore(mastery) {
  if (!mastery) return 0;
  const { understanding = 0, memory = 0, recall = 0, application = 0, confidence = 0 } = mastery;
  // Pondération : l'application et la mémoire pèsent plus
  return Math.round(
    understanding * 0.2 +
    memory * 0.25 +
    recall * 0.2 +
    application * 0.25 +
    confidence * 0.1
  );
}

// Détection de faiblesse
function detectWeakness(attempts) {
  if (!attempts || attempts.length < 3) return null;

  const recent = attempts.slice(-5);
  const wrong = recent.filter((a) => !a.isCorrect);

  if (wrong.length < 3) return null;

  // Compter par catégorie d'erreur
  const categories = {};
  wrong.forEach((a) => {
    if (a.errorCategory) {
      categories[a.errorCategory] = (categories[a.errorCategory] || 0) + 1;
    }
  });

  // Trouver la catégorie dominante
  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;

  const [category, count] = sorted[0];
  if (count < 3) return null;

  return { category, count };
}

// ────────────────────────────────────────────────────────────────
// QUOTAS
// ────────────────────────────────────────────────────────────────
async function checkCaptureQuota(uid) {
  const { db } = getAdminServices();

  const userSnap = await db.collection('users').doc(uid).get();
  const data = userSnap.data();

  if (isPremiumUser(data)) {
    return { allowed: true, premium: true };
  }

  // FREE : 2 captures / mois
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const quotaRef = db.collection('users').doc(uid).collection('progressQuota').doc(`captures-${monthKey}`);
  const quotaSnap = await quotaRef.get();
  const used = Number(quotaSnap.data()?.count || 0);

  if (used >= FREE_CAPTURE_LIMIT) {
    return { allowed: false, used, limit: FREE_CAPTURE_LIMIT, premium: false };
  }

  return { allowed: true, used, limit: FREE_CAPTURE_LIMIT, premium: false };
}

async function incrementCaptureQuota(uid) {
  const { db, FieldValue } = getAdminServices();
  const monthKey = new Date().toISOString().slice(0, 7);
  const quotaRef = db.collection('users').doc(uid).collection('progressQuota').doc(`captures-${monthKey}`);
  await quotaRef.set({ count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function checkSurpriseQuota(uid) {
  const { db } = getAdminServices();
  const userSnap = await db.collection('users').doc(uid).get();
  const data = userSnap.data();

  if (isPremiumUser(data)) return { allowed: true, premium: true };

  const weekK = weekKey();
  const quotaRef = db.collection('users').doc(uid).collection('progressQuota').doc(`surprise-${weekK}`);
  const quotaSnap = await quotaRef.get();
  const used = Number(quotaSnap.data()?.count || 0);

  if (used >= FREE_SURPRISE_LIMIT) {
    return { allowed: false, used, limit: FREE_SURPRISE_LIMIT, premium: false };
  }

  return { allowed: true, used, limit: FREE_SURPRISE_LIMIT, premium: false };
}

async function incrementSurpriseQuota(uid) {
  const { db, FieldValue } = getAdminServices();
  const weekK = weekKey();
  const quotaRef = db.collection('users').doc(uid).collection('progressQuota').doc(`surprise-${weekK}`);
  await quotaRef.set({ count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// ────────────────────────────────────────────────────────────────
// ACTIONS
// ────────────────────────────────────────────────────────────────

// ═══ 1. getDashboard ═══
async function getDashboard(uid) {
  const { db } = getAdminServices();

  // Lire les notions + mastery
  const masterySnap = await db.collection('users').doc(uid).collection('mastery').limit(500).get();

  let totalNotions = 0;
  let mastered = 0;
  let reinforce = 0;
  let critical = 0;
  let totalScore = 0;

  const subjectStats = {};
  const allMastery = [];

  masterySnap.docs.forEach((docSnap) => {
    const m = docSnap.data();
    const score = computeMasteryScore(m);
    const subject = m.subject || 'mathematiques';

    if (!subjectStats[subject]) {
      subjectStats[subject] = { key: subject, label: SUBJECT_LABELS[subject]?.label || subject, icon: SUBJECT_LABELS[subject]?.icon || 'fa-book', scores: [] };
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

  // Progression par matière
  const subjectProgress = Object.values(subjectStats).map((s) => ({
    key: s.key,
    label: s.label,
    icon: s.icon,
    percent: s.scores.length > 0 ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length) : 0
  }));

  // Cours récents
  const coursesSnap = await db.collection('users').doc(uid).collection('courses')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();

  const recentCourses = await Promise.all(coursesSnap.docs.map(async (docSnap) => {
    const c = docSnap.data();
    const notionsCount = c.notionsCount || 0;

    // Calculer la maîtrise moyenne du cours
    const notionIds = c.notionIds || [];
    let courseScore = 0;
    let counted = 0;

    for (const nid of notionIds.slice(0, 20)) {
      const m = allMastery.find((x) => x.id === nid);
      if (m) {
        courseScore += m.computedScore;
        counted++;
      }
    }

    const masteryPercent = counted > 0 ? Math.round(courseScore / counted) : 0;

    return {
      id: docSnap.id,
      title: c.title || 'Cours',
      subjectLabel: SUBJECT_LABELS[c.subject]?.label || '',
      icon: SUBJECT_LABELS[c.subject]?.icon || 'fa-book',
      notionsCount,
      masteryPercent,
      addedLabel: formatRelativeDate(c.createdAt)
    };
  }));

  // Plan du jour
  const dailyPlan = await buildTodayPlan(uid, allMastery);

  return {
    success: true,
    summary: {
      percentUpToDate,
      totalNotions,
      mastered,
      reinforce,
      critical
    },
    todayPlan: dailyPlan,
    subjectProgress,
    recentCourses
  };
}

// ═══ 2. analyzeCourse ═══
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
      message: `Limite gratuite atteinte (${quota.limit} captures/mois). Passe à Premium pour continuer.`,
      code: 'FREE_CAPTURE_LIMIT'
    };
  }

  // Normaliser le LaTeX dans le contenu (dictée vocale, OCR)
  const normalizedContent = normalizeLatexInput(content);

  // Analyser avec IA
  const prompt = buildCourseAnalysisPrompt({
    subject,
    title,
    content: normalizedContent,
    mode
  });

  const analysis = await generateWithFallback(prompt, 8000);

  if (analysis.error === 'content_too_short') {
    throw { status: 400, message: 'Contenu trop court pour être analysé.' };
  }
  if (!Array.isArray(analysis.notions) || analysis.notions.length === 0) {
    throw { status: 500, message: 'Analyse échouée. Réessaie avec un contenu plus structuré.' };
  }

  // Limiter le nombre de notions
  const notions = analysis.notions.slice(0, MAX_NOTIONS_PER_COURSE);

  // Sauvegarder le cours
  const { db, FieldValue } = getAdminServices();
  const courseRef = db.collection('users').doc(uid).collection('courses').doc();
  const courseId = courseRef.id;

  const notionIds = notions.map((n) => cleanId(n.id || n.name));

  await courseRef.set({
    subject,
    title: analysis.courseTitle || title || 'Cours',
    chapter: analysis.chapter || null,
    content: normalizedContent.slice(0, 8000), // Stocker une version limitée
    summary: analysis.summary || null,
    illisibleZones: analysis.illisibleZones || [],
    notionIds,
    notionsCount: notions.length,
    captureMode: mode,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  // Sauvegarder les notions
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
      example: n.exampleIfNeeded || null,
      courseId,
      subject,
      createdAt: FieldValue.serverTimestamp()
    });

    // Créer la maîtrise initiale (vide)
    const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);
    batch.set(masteryRef, {
      notionId,
      notionName: n.name || 'Notion',
      courseId,
      subject,
      understanding: 0,
      memory: 0,
      recall: 0,
      application: 0,
      confidence: 0,
      lastReviewedAt: null,
      nextReviewAt: FieldValue.serverTimestamp(),
      reviewCount: 0,
      createdAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await batch.commit();

  // Incrémenter le quota
  if (!quota.premium) await incrementCaptureQuota(uid);

  // Quiz initial
  const initialQuiz = Array.isArray(analysis.initialQuiz) ? analysis.initialQuiz.slice(0, 5) : [];

  return {
    success: true,
    courseId,
    notionsCount: notions.length,
    initialQuiz,
    message: `${notions.length} notion(s) extraite(s). Prêt pour le quiz initial !`
  };
}

// ═══ 3. generateQuiz ═══
async function generateQuiz(uid, body) {
  const { notionId, difficulty = 2 } = body;
  if (!notionId) throw { status: 400, message: 'notionId requis.' };

  const { db } = getAdminServices();

  // Récupérer la notion
  const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);
  const masterySnap = await masteryRef.get();
  if (!masterySnap.exists) throw { status: 404, message: 'Notion introuvable.' };

  const mastery = masterySnap.data();
  const subject = mastery.subject || 'mathematiques';

  // Récupérer le cours parent
  const notion = {
    name: mastery.notionName || 'Notion',
    description: '',
    keyFormula: null
  };

  if (mastery.courseId) {
    const notionSnap = await db.collection('users').doc(uid).collection('courses').doc(mastery.courseId)
      .collection('notions').doc(notionId).get();
    if (notionSnap.exists) {
      const n = notionSnap.data();
      notion.description = n.description || '';
      notion.keyFormula = n.keyFormula || null;
    }
  }

  const prompt = buildQuizPrompt({ notion, difficulty, subject });
  const data = await generateWithFallback(prompt, 4000);

  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw { status: 500, message: 'Génération du quiz échouée.' };
  }

  return {
    success: true,
    questions: data.questions.slice(0, 5)
  };
}

// ═══ 4. submitQuiz ═══
async function submitQuiz(uid, body) {
  const { courseId, notionId, answers = [] } = body;

  if (!Array.isArray(answers) || answers.length === 0) {
    throw { status: 400, message: 'Aucune réponse fournie.' };
  }

  const { db, FieldValue } = getAdminServices();

  // Calculer le score
  const correct = answers.filter((a) => a.isCorrect).length;
  const total = answers.length;
  const scorePercent = Math.round((correct / total) * 100);

  // Enregistrer la tentative
  const attemptRef = db.collection('users').doc(uid).collection('attempts').doc();
  await attemptRef.set({
    type: 'quiz',
    courseId: courseId || null,
    notionId: notionId || null,
    score: correct,
    total,
    scorePercent,
    answers: answers.map((a) => ({
      questionIndex: a.questionIndex,
      text: (a.text || '').slice(0, 300),
      selected: a.selected || null,
      correct: a.correct || null,
      isCorrect: Boolean(a.isCorrect)
    })),
    createdAt: FieldValue.serverTimestamp()
  });

  // Mettre à jour la maîtrise si on a un notionId
  if (notionId) {
    const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);
    const masterySnap = await masteryRef.get();
    const m = masterySnap.exists ? masterySnap.data() : {};

    // Augmenter la compréhension (proportionnelle au score)
    const understandingGain = Math.round(scorePercent * 0.3);
    const applicationGain = Math.round(scorePercent * 0.25);
    const recallGain = Math.round(scorePercent * 0.2);

    const newUnderstanding = Math.min(100, (Number(m.understanding) || 0) + understandingGain);
    const newApplication = Math.min(100, (Number(m.application) || 0) + applicationGain);
    const newRecall = Math.min(100, (Number(m.recall) || 0) + recallGain);

    const newMastery = {
      understanding: newUnderstanding,
      memory: Number(m.memory) || 0,
      recall: newRecall,
      application: newApplication,
      confidence: Number(m.confidence) || 0
    };
    const newScore = computeMasteryScore(newMastery);
    const reviewCount = (Number(m.reviewCount) || 0) + 1;
    const nextReviewAt = computeNextReviewDate(newScore, reviewCount);

    await masteryRef.set({
      ...newMastery,
      lastReviewedAt: FieldValue.serverTimestamp(),
      nextReviewAt,
      reviewCount,
      lastScore: scorePercent,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

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
    message
  };
}

// ═══ 5. generateFlashcards ═══
async function generateFlashcards(uid, body) {
  const { notionId } = body;
  if (!notionId) throw { status: 400, message: 'notionId requis.' };

  const { db } = getAdminServices();
  const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);
  const masterySnap = await masteryRef.get();
  if (!masterySnap.exists) throw { status: 404, message: 'Notion introuvable.' };

  const m = masterySnap.data();
  const subject = m.subject || 'mathematiques';

  const notion = {
    name: m.notionName || 'Notion',
    description: '',
    keyFormula: null
  };

  if (m.courseId) {
    const notionSnap = await db.collection('users').doc(uid).collection('courses').doc(m.courseId)
      .collection('notions').doc(notionId).get();
    if (notionSnap.exists) {
      const n = notionSnap.data();
      notion.description = n.description || '';
      notion.keyFormula = n.keyFormula || null;
    }
  }

  const prompt = buildFlashcardsPrompt({ notion, subject });
  const data = await generateWithFallback(prompt, 4000);

  if (!Array.isArray(data.flashcards) || data.flashcards.length === 0) {
    throw { status: 500, message: 'Génération des flashcards échouée.' };
  }

  return {
    success: true,
    flashcards: data.flashcards.slice(0, 10)
  };
}

// ═══ 6. reviewFlashcard ═══
async function reviewFlashcard(uid, body) {
  const { notionId, flashcardIndex, rating } = body;

  if (!notionId || typeof flashcardIndex !== 'number') {
    throw { status: 400, message: 'Paramètres manquants.' };
  }
  if (!['easy', 'medium', 'hard'].includes(rating)) {
    throw { status: 400, message: 'Rating invalide.' };
  }

  const { db, FieldValue } = getAdminServices();

  // Enregistrer la tentative
  await db.collection('users').doc(uid).collection('attempts').add({
    type: 'flashcard',
    notionId,
    flashcardIndex,
    rating,
    createdAt: FieldValue.serverTimestamp()
  });

  // Mettre à jour la mémoire
  const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);
  const masterySnap = await masteryRef.get();
  const m = masterySnap.exists ? masterySnap.data() : {};

  const gainByRating = { easy: 15, medium: 8, hard: 3 };
  const gain = gainByRating[rating] || 0;

  const newMemory = Math.min(100, (Number(m.memory) || 0) + gain);
  const newConfidence = Math.min(100, (Number(m.confidence) || 0) + Math.round(gain * 0.5));

  const newMastery = {
    understanding: Number(m.understanding) || 0,
    memory: newMemory,
    recall: Number(m.recall) || 0,
    application: Number(m.application) || 0,
    confidence: newConfidence
  };
  const newScore = computeMasteryScore(newMastery);
  const reviewCount = (Number(m.reviewCount) || 0) + 1;
  const nextReviewAt = computeNextReviewDate(newScore, reviewCount);

  await masteryRef.set({
    ...newMastery,
    lastReviewedAt: FieldValue.serverTimestamp(),
    nextReviewAt,
    reviewCount,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true };
}

// ═══ 7. getSurpriseTest ═══
async function getSurpriseTest(uid, body) {
  const { count = 5 } = body;

  // Quota
  const quota = await checkSurpriseQuota(uid);
  if (!quota.allowed) {
    throw {
      status: 429,
      message: `Limite de tests surprise atteinte (${quota.limit}/semaine). Passe à Premium.`,
      code: 'FREE_SURPRISE_LIMIT'
    };
  }

  const { db } = getAdminServices();

  // Prendre les notions fragiles
  const masterySnap = await db.collection('users').doc(uid).collection('mastery').limit(100).get();

  const candidates = [];
  masterySnap.docs.forEach((docSnap) => {
    const m = docSnap.data();
    const score = computeMasteryScore(m);
    if (score < 75 && (m.notionName || m.notionId)) {
      candidates.push({ id: docSnap.id, ...m, computedScore: score });
    }
  });

  if (candidates.length === 0) {
    throw { status: 400, message: 'Pas assez de notions fragiles pour un test surprise.' };
  }

  // Trier par fragilité (les plus faibles d'abord)
  candidates.sort((a, b) => a.computedScore - b.computedScore);

  // Prendre les 8 plus fragiles
  const selected = candidates.slice(0, 8);

  // Détecter la matière dominante
  const subjectCounts = {};
  selected.forEach((n) => {
    const s = n.subject || 'mathematiques';
    subjectCounts[s] = (subjectCounts[s] || 0) + 1;
  });
  const dominantSubject = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])[0][0];

  const notions = selected.map((n) => ({
    id: n.id,
    name: n.notionName || 'Notion',
    description: ''
  }));

  const prompt = buildSurpriseTestPrompt({
    notions,
    subject: dominantSubject,
    count
  });

  const data = await generateWithFallback(prompt, 5000);
  if (!Array.isArray(data.test) || data.test.length === 0) {
    throw { status: 500, message: 'Génération du test surprise échouée.' };
  }

  // Incrémenter le quota
  if (!quota.premium) await incrementSurpriseQuota(uid);

  return {
    success: true,
    subject: dominantSubject,
    subjectLabel: SUBJECT_LABELS[dominantSubject]?.label || dominantSubject,
    test: data.test.slice(0, count)
  };
}

// ═══ 8. submitSurpriseTest ═══
async function submitSurpriseTest(uid, body) {
  const { answers = [], subject } = body;

  if (!Array.isArray(answers) || answers.length === 0) {
    throw { status: 400, message: 'Aucune réponse fournie.' };
  }

  const { db, FieldValue } = getAdminServices();
  const correct = answers.filter((a) => a.isCorrect).length;
  const total = answers.length;
  const scorePercent = Math.round((correct / total) * 100);

  // Enregistrer
  await db.collection('users').doc(uid).collection('attempts').add({
    type: 'surprise_test',
    subject: subject || 'mixed',
    score: correct,
    total,
    scorePercent,
    answers: answers.map((a) => ({
      notionId: a.notionId || null,
      text: (a.text || '').slice(0, 300),
      selected: a.selected || null,
      correct: a.correct || null,
      isCorrect: Boolean(a.isCorrect)
    })),
    createdAt: FieldValue.serverTimestamp()
  });

  // Mettre à jour chaque notion touchée
  const notionIds = [...new Set(answers.map((a) => a.notionId).filter(Boolean))];
  for (const nid of notionIds) {
    const relatedAnswers = answers.filter((a) => a.notionId === nid);
    const notionCorrect = relatedAnswers.filter((a) => a.isCorrect).length;
    const notionTotal = relatedAnswers.length;
    const notionPercent = Math.round((notionCorrect / notionTotal) * 100);

    const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(nid);
    const masterySnap = await masteryRef.get();
    if (!masterySnap.exists) continue;

    const m = masterySnap.data();
    const newRecall = Math.min(100, (Number(m.recall) || 0) + Math.round(notionPercent * 0.2));
    const newApplication = Math.min(100, (Number(m.application) || 0) + Math.round(notionPercent * 0.15));

    const newMastery = {
      understanding: Number(m.understanding) || 0,
      memory: Number(m.memory) || 0,
      recall: newRecall,
      application: newApplication,
      confidence: Number(m.confidence) || 0
    };
    const newScore = computeMasteryScore(newMastery);
    const reviewCount = (Number(m.reviewCount) || 0) + 1;

    await masteryRef.set({
      ...newMastery,
      lastReviewedAt: FieldValue.serverTimestamp(),
      nextReviewAt: computeNextReviewDate(newScore, reviewCount),
      reviewCount,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  return {
    success: true,
    score: correct,
    total,
    scorePercent,
    message: scorePercent >= 70 ? '🎉 Excellent !' : '💪 Continue à réviser.'
  };
}

// ═══ 9. analyzeErrors ═══
async function analyzeErrors(uid, body) {
  const { notionId, question, studentAnswer, correctAnswer } = body;

  if (!question || !correctAnswer) {
    throw { status: 400, message: 'Données manquantes.' };
  }

  const { db, FieldValue } = getAdminServices();

  // Récupérer la notion
  let notion = null;
  if (notionId) {
    const snap = await db.collection('users').doc(uid).collection('mastery').doc(notionId).get();
    if (snap.exists) notion = snap.data();
  }

  // Analyser avec IA
  const prompt = buildErrorAnalysisPrompt({
    question,
    studentAnswer,
    correctAnswer,
    notion: notion ? { name: notion.notionName } : null
  });

  let analysis;
  try {
    analysis = await generateWithFallback(prompt, 1500);
  } catch (e) {
    analysis = {
      category: 'comprehension_error',
      feedback: 'Analyse automatique indisponible.',
      tip: 'Revois la notion en détail.',
      prerequisite: null
    };
  }

  if (!ERROR_CATEGORIES.includes(analysis.category)) {
    analysis.category = 'comprehension_error';
  }

  // Enregistrer l'analyse
  await db.collection('users').doc(uid).collection('errorAnalyses').add({
    notionId: notionId || null,
    question: question.slice(0, 500),
    studentAnswer: (studentAnswer || '').slice(0, 300),
    correctAnswer: correctAnswer.slice(0, 300),
    category: analysis.category,
    feedback: (analysis.feedback || '').slice(0, 500),
    tip: (analysis.tip || '').slice(0, 500),
    prerequisite: analysis.prerequisite || null,
    createdAt: FieldValue.serverTimestamp()
  });

  // Détecter une faiblesse
  const recentSnap = await db.collection('users').doc(uid).collection('errorAnalyses')
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();

  const recent = recentSnap.docs.map((d) => d.data());
  const sameCategory = recent.filter((e) => e.category === analysis.category).length;

  if (sameCategory >= 3) {
    // Créer ou mettre à jour une faiblesse
    const weaknessId = cleanId(`weakness-${analysis.category}`);
    const weaknessRef = db.collection('users').doc(uid).collection('weaknesses').doc(weaknessId);
    const existing = await weaknessRef.get();
    const existingCount = existing.exists ? (Number(existing.data().count) || 0) : 0;

    await weaknessRef.set({
      type: analysis.category,
      count: existingCount + 1,
      lastDetectedAt: FieldValue.serverTimestamp(),
      suggestedFix: analysis.tip || 'Refais quelques exercices sur cette notion.',
      subject: notion?.subject || null
    }, { merge: true });
  }

  return {
    success: true,
    category: analysis.category,
    feedback: analysis.feedback,
    tip: analysis.tip,
    prerequisite: analysis.prerequisite,
    weaknessDetected: sameCategory >= 3
  };
}

// ═══ 10. getWeaknesses ═══
async function getWeaknesses(uid) {
  const { db } = getAdminServices();

  const snap = await db.collection('users').doc(uid).collection('weaknesses')
    .orderBy('lastDetectedAt', 'desc')
    .limit(20)
    .get();

  const labels = {
    formula_error: 'Erreurs de formule',
    calculation_error: 'Erreurs de calcul',
    comprehension_error: 'Erreurs de compréhension',
    method_error: 'Erreurs de méthode',
    forgetting: 'Oublis fréquents',
    confusion: 'Confusion entre notions',
    prerequisite_gap: 'Prérequis insuffisants'
  };

  const weaknesses = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: data.type,
      label: labels[data.type] || data.type,
      count: data.count || 0,
      suggestedFix: data.suggestedFix || '',
      subject: data.subject || null,
      lastDetectedAt: toISO(data.lastDetectedAt)
    };
  });

  return { success: true, weaknesses };
}

// ═══ 11. getReviewQueue ═══
async function getReviewQueue(uid) {
  const { db } = getAdminServices();

  // Récupérer les notions à réviser aujourd'hui
  const now = new Date();
  const masterySnap = await db.collection('users').doc(uid).collection('mastery')
    .where('nextReviewAt', '<=', now)
    .limit(20)
    .get();

  const items = masterySnap.docs.map((d) => {
    const m = d.data();
    return {
      notionId: d.id,
      notionName: m.notionName || 'Notion',
      subject: m.subject,
      subjectLabel: SUBJECT_LABELS[m.subject]?.label || '',
      score: computeMasteryScore(m),
      nextReviewAt: toISO(m.nextReviewAt)
    };
  });

  return { success: true, items };
}

// ═══ 12. getFlashcards ═══
async function getFlashcards(uid, body) {
  const { notionId } = body;
  if (!notionId) throw { status: 400, message: 'notionId requis.' };

  // Simplement générer (retour direct)
  return await generateFlashcards(uid, body);
}

// ═══ 13. getSubjectProgress ═══
async function getSubjectProgress(uid) {
  const dashboard = await getDashboard(uid);
  return {
    success: true,
    subjectProgress: dashboard.subjectProgress
  };
}

// ────────────────────────────────────────────────────────────────
// PLAN DU JOUR
// ────────────────────────────────────────────────────────────────
async function buildTodayPlan(uid, allMastery) {
  const items = [];

  // Filtrer les notions à réviser
  const now = Date.now();
  const candidates = allMastery
    .filter((m) => {
      const next = toISO(m.nextReviewAt);
      return !next || new Date(next).getTime() <= now + 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => a.computedScore - b.computedScore)
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

  // Ajouter un test surprise si possible
  if (allMastery.length >= 5) {
    items.push({
      id: 'surprise-today',
      kind: 'surprise_test',
      title: 'Test surprise',
      duration: 6,
      task: 'Commencer'
    });
  }

  return items;
}

// ────────────────────────────────────────────────────────────────
// UTILITAIRE
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

// ────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ────────────────────────────────────────────────────────────────
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

  // Vérification Firebase
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
      case 'getDashboard':         return response.status(200).json(await getDashboard(uid));
      case 'analyzeCourse':        return response.status(200).json(await analyzeCourse(uid, body));
      case 'generateQuiz':         return response.status(200).json(await generateQuiz(uid, body));
      case 'submitQuiz':           return response.status(200).json(await submitQuiz(uid, body));
      case 'generateFlashcards':   return response.status(200).json(await generateFlashcards(uid, body));
      case 'getFlashcards':        return response.status(200).json(await getFlashcards(uid, body));
      case 'reviewFlashcard':      return response.status(200).json(await reviewFlashcard(uid, body));
      case 'getSurpriseTest':      return response.status(200).json(await getSurpriseTest(uid, body));
      case 'submitSurpriseTest':   return response.status(200).json(await submitSurpriseTest(uid, body));
      case 'analyzeErrors':        return response.status(200).json(await analyzeErrors(uid, body));
      case 'getWeaknesses':        return response.status(200).json(await getWeaknesses(uid));
      case 'getReviewQueue':       return response.status(200).json(await getReviewQueue(uid));
      case 'getSubjectProgress':   return response.status(200).json(await getSubjectProgress(uid));
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
