// ================================================================
// API RÉVISEUR v2.0 — ARVEXA School
// Génère des fiches, flashcards et quiz GARANTIS COMPLETS
// Utilise la base bac-mathematiques.js pour ne rien oublier
// ================================================================

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);
const ALLOWED_ACTIONS = new Set(['generate', 'quiz']);

const FREE_REVISEUR_LIMIT = 2;
const MAX_REGENERATION_ATTEMPTS = 2;   // Nombre max de tentatives pour compléter
const COVERAGE_THRESHOLD = 0.95;       // 95% minimum de couverture

module.exports.config = { maxDuration: 60 };

let adminServices;

// ════════════════════════════════════════════════════════════════
// BASE DE CONNAISSANCES
// ════════════════════════════════════════════════════════════════
let BAC_MATHEMATIQUES = null;

function loadBacMathematiques() {
  if (BAC_MATHEMATIQUES) return BAC_MATHEMATIQUES;
  try {
    BAC_MATHEMATIQUES = require('./bac-mathematiques');
    return BAC_MATHEMATIQUES;
  } catch (error) {
    console.warn('[REVISEUR] Base bac-mathematiques indisponible:', error.message);
    return null;
  }
}

/**
 * Charge la base de connaissances pour une matière donnée.
 * Retourne null si la matière n'a pas encore de base.
 */
function getBaseForSubject(subject) {
  if (subject === 'mathematiques') {
    const bac = loadBacMathematiques();
    return bac ? bac.BAC_MATHEMATIQUES : null;
  }
  // Autres matières : pas encore de base
  return null;
}

/**
 * Trouve un chapitre dans la base par son titre.
 */
function findChapitreByTitle(base, chapterTitle) {
  if (!base || !chapterTitle) return null;
  const normalized = String(chapterTitle).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return base.chapitres.find((c) => {
    const cNorm = c.titre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return cNorm.includes(normalized) || normalized.includes(cNorm) || c.id === chapterTitle;
  }) || null;
}

// ════════════════════════════════════════════════════════════════
// FIREBASE ADMIN
// ════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════
// UTILITAIRES
// ════════════════════════════════════════════════════════════════
function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((time) => now - time < WINDOW_MS);
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

async function verifyFirebaseToken(request) {
  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return await getAdminServices().auth.verifyIdToken(match[1]);
  } catch (_) {
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

// ════════════════════════════════════════════════════════════════
// QUOTA
// ════════════════════════════════════════════════════════════════
function getUsageDate() {
  return new Date().toISOString().slice(0, 10);
}

async function reserveFreeGeneration(uid) {
  const { db, FieldValue } = getAdminServices();
  const userRef = db.collection('users').doc(uid);
  const usageDate = getUsageDate();
  const usageRef = userRef.collection('reviseurUsage').doc(usageDate);

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const usageSnapshot = await transaction.get(usageRef);

    if (!userSnapshot.exists) throw new Error('profile_missing');
    if (isPremiumUser(userSnapshot.data())) return { premium: true, reserved: false };

    const used = Number(usageSnapshot.data()?.count || 0);
    if (used >= FREE_REVISEUR_LIMIT) {
      return { premium: false, reserved: false, limitReached: true, used };
    }

    transaction.set(usageRef, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { premium: false, reserved: true, usageDate, used: used + 1 };
  });
}

async function releaseFreeGeneration(uid, usageDate) {
  const { db, FieldValue } = getAdminServices();
  const usageRef = db.collection('users').doc(uid).collection('reviseurUsage').doc(usageDate);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(usageRef);
    const used = Math.max(0, Number(snapshot.data()?.count || 0) - 1);
    transaction.set(usageRef, { count: used, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

// ════════════════════════════════════════════════════════════════
// PROVIDERS
// ════════════════════════════════════════════════════════════════
function getProviders() {
  return [
    {
      name: 'Groq', key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b', headers: {}
    },
    {
      name: 'OpenRouter', key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      headers: { 'HTTP-Referer': process.env.APP_ORIGIN || '', 'X-Title': 'ARVEXA School' }
    },
    {
      name: 'Mistral', key: process.env.MISTRAL_API_KEY,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest', headers: {}
    }
  ].filter((p) => Boolean(p.key));
}

async function callProvider(provider, prompt, maxTokens = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const body = {
      model: provider.model,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: 'Tu produis exclusivement du JSON valide.' },
        { role: 'user', content: prompt }
      ]
    };

    if (provider.name === 'Groq' || provider.name === 'OpenRouter') {
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
    if (!result.ok) {
      const msg = data?.error?.message || data?.message || `HTTP ${result.status}`;
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

async function generateWithFallback(prompt, validator, maxTokens = 4000) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const errors = [];
  for (const provider of providers) {
    try {
      console.log(`[AI] Tentative ${provider.name}...`);
      const data = await callProvider(provider, prompt, maxTokens);
      if (validator(data)) {
        console.log(`[AI] ✅ ${provider.name} a répondu avec une structure valide`);
        return data;
      }
      errors.push(`${provider.name}: structure invalide`);
      console.warn(`[AI] ⚠️ ${provider.name} : structure invalide`);
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI] ❌ ${provider.name} échec: ${error.message}`);
    }
  }

  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ════════════════════════════════════════════════════════════════
// PROMPTS — AVEC BASE DE CONNAISSANCES
// ════════════════════════════════════════════════════════════════

/**
 * Prompt FICHE — Garanti complet (1 section par notion obligatoire)
 */
function fichePromptWithBase(subject, chapter, base, chapitre) {
  const notionsList = chapitre.notions.map((n, i) => {
    return `  ${i + 1}. [${n.id}] ${n.titre}
     Description : ${n.description}
     Formules : ${(n.formules || []).join(' | ')}
     Propriétés : ${(n.proprietes || []).join(' | ')}
     Méthodes : ${(n.methodes || []).join(' | ')}
     Erreurs : ${(n.erreurs_frequentes || []).join(' | ')}
     Pièges : ${(n.pieges_examen || []).join(' | ')}`;
  }).join('\n\n');

  return `Tu es un professeur expert du BAC au Niger. Tu prépares une FICHE DE RÉVISION COMPLÈTE et GARANTIE.

Matière : ${base.matiereLabel}
Chapitre : ${chapitre.titre}
Nombre de notions obligatoires : ${chapitre.notions.length}

═══════════════════════════════════════════════════════════════
RÈGLE ABSOLUE : COUVERTURE 100%
═══════════════════════════════════════════════════════════════
Tu DOIS générer UNE SECTION DE FICHE pour CHAQUE notion obligatoire listée ci-dessous.
Aucune notion ne doit être oubliée. Aucune notion ne doit être fusionnée avec une autre.
Chaque section doit être autonome et pédagogique.

═══════════════════════════════════════════════════════════════
NOTIONS OBLIGATOIRES À COUVRIR
═══════════════════════════════════════════════════════════════
${notionsList}

═══════════════════════════════════════════════════════════════
RÈGLES LATEX — TRÈS IMPORTANTES
═══════════════════════════════════════════════════════════════
1. Toute formule mathématique DOIT être entre délimiteurs :
   • Inline : $...$  → "La fonction $f(x) = x^2$ est croissante."
   • Display : $$...$$  → "$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$"
2. JAMAIS de symboles Unicode bruts :
   ❌ "π" → ✅ "$\\pi$"
   ❌ "√2" → ✅ "$\\sqrt{2}$"
   ❌ "x²" → ✅ "$x^{2}$"
   ❌ "1/2" → ✅ "$\\frac{1}{2}$"
   ❌ "≤" → ✅ "$\\leq$"
   ❌ "∞" → ✅ "$\\infty$"
3. Commandes autorisées : \\frac, \\sqrt, ^{}, _{}, \\lim, \\int, \\sum,
   \\sin, \\cos, \\tan, \\ln, \\log, \\alpha...\\omega, \\times, \\div,
   \\leq, \\geq, \\neq, \\infty, \\to, \\Rightarrow, \\Leftrightarrow

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "chapterTitle": "${chapitre.titre}",
  "sections": [
    {
      "notionId": "${chapitre.notions[0].id}",
      "title": "${chapitre.notions[0].titre}",
      "content": "Contenu pédagogique complet avec formules LaTeX, méthodes, exemples."
    }
    // ... UNE SECTION PAR NOTION OBLIGATOIRE
  ],
  "keyPoints": [
    "Point clé 1",
    "Point clé 2",
    "Point clé 3"
  ],
  "examTraps": [
    { "trap": "Piège", "solution": "Solution" }
  ],
  "commonMistakes": [
    "Erreur fréquente"
  ]
}

CONTRAINTES :
- EXACTEMENT ${chapitre.notions.length} sections (une par notion obligatoire)
- Chaque section : notionId EXACT + title + content pédagogique
- Content : 3-6 phrases avec formules LaTeX
- Ne mets JAMAIS de texte avant ou après le JSON
- Ne mets JAMAIS de commentaires dans le JSON`;
}

/**
 * Prompt FLASHCARDS — Garanti complet
 */
function flashcardPromptWithBase(subject, chapter, base, chapitre, count = 10) {
  const notionsList = chapitre.notions.map((n, i) =>
    `  ${i + 1}. [${n.id}] ${n.titre} — ${n.description}`
  ).join('\n');

  const cardsPerNotion = Math.max(1, Math.floor(count / chapitre.notions.length));

  return `Tu es un professeur expert du BAC au Niger. Tu prépares des FLASHCARDS de mémorisation.

Matière : ${base.matiereLabel}
Chapitre : ${chapitre.titre}
Nombre de flashcards demandé : ${count}
Nombre de notions obligatoires : ${chapitre.notions.length}

═══════════════════════════════════════════════════════════════
RÈGLE ABSOLUE : COUVERTURE 100%
═══════════════════════════════════════════════════════════════
Chaque notion obligatoire DOIT être couverte par AU MOINS 1 flashcard.
Aucune notion ne doit être oubliée.

═══════════════════════════════════════════════════════════════
NOTIONS OBLIGATOIRES
═══════════════════════════════════════════════════════════════
${notionsList}

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Inline : $...$ / Display : $$...$$
- JAMAIS de symboles Unicode bruts
- Formules : \\frac, \\sqrt, ^{}, _{}, \\sin, \\cos, \\pi, \\infty

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "chapterTitle": "${chapitre.titre}",
  "flashcards": [
    {
      "notionId": "${chapitre.notions[0].id}",
      "question": "Question courte",
      "answer": "Réponse concise avec LaTeX si besoin",
      "hint": "Indice ou null"
    }
  ]
}

CONTRAINTES :
- EXACTEMENT ${count} flashcards
- Chaque flashcard a un notionId EXACT de la liste
- Chaque notion doit avoir AU MOINS 1 flashcard
- La DERNIÈRE flashcard doit être un cas limite ou piège
- Ne mets JAMAIS de texte avant ou après le JSON`;
}

/**
 * Prompt QUIZ — Garanti complet
 */
function quizPromptWithBase(subject, chapter, session, base, chapitre, count = 5, difficulty = 2) {
  const notionsList = chapitre.notions.map((n) =>
    `  [${n.id}] ${n.titre}`
  ).join('\n');

  const difficultyLabels = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile', 4: 'Niveau BAC' };

  const ficheContent = session && session.sections
    ? JSON.stringify(session.sections).slice(0, 3000)
    : '';

  return `Tu es un professeur expert du BAC au Niger. Tu crées un QUIZ de vérification.

Matière : ${base.matiereLabel}
Chapitre : ${chapitre.titre}
Difficulté : ${difficultyLabels[difficulty] || 'Moyen'}
Nombre de questions : ${count}

═══════════════════════════════════════════════════════════════
RÈGLE ABSOLUE : COUVERTURE DES NOTIONS
═══════════════════════════════════════════════════════════════
Répartis les questions sur les notions obligatoires.
Si possible, 1 question par notion (max ${count} notions).

═══════════════════════════════════════════════════════════════
NOTIONS À TESTER
═══════════════════════════════════════════════════════════════
${notionsList}

${ficheContent ? `Contenu de la fiche : ${ficheContent}` : ''}

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Formules entre $...$ (inline) ou $$...$$ (display)
- JAMAIS de symboles Unicode bruts
- Exemples : "$3x^2$", "$\\frac{1}{2}$", "$\\lim_{x \\to 0}$"

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "quiz": [
    {
      "notionId": "${chapitre.notions[0].id}",
      "question": "Question",
      "options": [
        { "id": "A", "text": "Option A" },
        { "id": "B", "text": "Option B" },
        { "id": "C", "text": "Option C" },
        { "id": "D", "text": "Option D" }
      ],
      "correctAnswer": "A",
      "explanation": "Explication pédagogique courte"
    }
  ]
}

CONTRAINTES :
- EXACTEMENT ${count} questions
- 4 options par question
- Chaque question a un notionId EXACT de la liste
- Niveau : ${difficultyLabels[difficulty] || 'Moyen'}
- Ne mets JAMAIS de texte avant ou après le JSON`;
}

// ════════════════════════════════════════════════════════════════
// PROMPTS — SANS BASE (fallback)
// ════════════════════════════════════════════════════════════════
function fichePromptSimple(subject, chapter) {
  return `Tu es un professeur expert du BAC au Niger. Tu prépares une FICHE DE RÉVISION.

Matière : ${subject}
Chapitre : ${chapter}

Génère une fiche structurée en JSON valide.

{
  "chapterTitle": "Titre du chapitre",
  "sections": [
    { "title": "Titre section", "content": "Contenu avec **gras** et formules LaTeX." }
  ],
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "examTraps": [{ "trap": "Piège", "solution": "Solution" }],
  "commonMistakes": ["Erreur 1", "Erreur 2"]
}

RÈGLES LATEX :
- Formules entre $...$ ou $$...$$
- JAMAIS de symboles Unicode bruts
- Commandes : \\frac, \\sqrt, ^{}, _{}, \\sin, \\cos, \\pi, \\infty

- 5 à 7 sections
- Réponds UNIQUEMENT avec le JSON`;
}

function flashcardPromptSimple(subject, chapter, count = 10) {
  return `Tu es un professeur expert du BAC au Niger. Tu prépares ${count} FLASHCARDS.

Matière : ${subject}
Chapitre : ${chapter}

{
  "chapterTitle": "Titre",
  "flashcards": [
    { "question": "...", "answer": "...", "hint": "..." }
  ]
}

RÈGLES LATEX : $...$ ou $$...$$
EXACTEMENT ${count} flashcards.
Réponds UNIQUEMENT avec le JSON`;
}

function quizPromptSimple(subject, chapter, session, count = 5, difficulty = 2) {
  const ficheContent = JSON.stringify(session).slice(0, 3000);
  return `Tu es un professeur expert du BAC au Niger. Tu crées un QUIZ.

Matière : ${subject}
Chapitre : ${chapter}
Contenu : ${ficheContent}

{
  "quiz": [
    {
      "question": "...",
      "options": [
        { "id": "A", "text": "..." },
        { "id": "B", "text": "..." },
        { "id": "C", "text": "..." },
        { "id": "D", "text": "..." }
      ],
      "correctAnswer": "A",
      "explanation": "..."
    }
  ]
}

RÈGLES LATEX : $...$ ou $$...$$
EXACTEMENT ${count} questions, 4 options chacune.
Réponds UNIQUEMENT avec le JSON`;
}

// ════════════════════════════════════════════════════════════════
// VALIDATION
// ════════════════════════════════════════════════════════════════
function validateFiche(data) {
  return (
    data &&
    typeof data === 'object' &&
    Array.isArray(data.sections) &&
    data.sections.length >= 3 &&
    data.sections.every((s) => s.title && s.content)
  );
}

function validateFicheWithCoverage(data, chapitre) {
  if (!validateFiche(data)) return false;
  // Vérifier que chaque notion obligatoire a sa section
  const notionIdsInFiche = new Set(
    data.sections.map((s) => s.notionId).filter(Boolean)
  );
  const missingNotions = chapitre.notions.filter(
    (n) => !notionIdsInFiche.has(n.id)
  );
  if (missingNotions.length > 0) {
    console.warn(`[COVERAGE] ${missingNotions.length} notion(s) manquante(s):`,
      missingNotions.map((n) => n.id).join(', '));
    return false;
  }
  return true;
}

function validateFlashcards(data) {
  return (
    data &&
    typeof data === 'object' &&
    Array.isArray(data.flashcards) &&
    data.flashcards.length >= 5 &&
    data.flashcards.every((c) => c.question && c.answer)
  );
}

function validateFlashcardsWithCoverage(data, chapitre) {
  if (!validateFlashcards(data)) return false;
  const notionIdsInCards = new Set(
    data.flashcards.map((c) => c.notionId).filter(Boolean)
  );
  const missingNotions = chapitre.notions.filter(
    (n) => !notionIdsInCards.has(n.id)
  );
  if (missingNotions.length > 0) {
    console.warn(`[COVERAGE] ${missingNotions.length} notion(s) manquante(s) en flashcards`);
    return false;
  }
  return true;
}

function validateQuiz(data) {
  return (
    data &&
    typeof data === 'object' &&
    Array.isArray(data.quiz) &&
    data.quiz.length >= 3 &&
    data.quiz.every(
      (q) =>
        q.question &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        q.options.every((o) => o.id && o.text) &&
        ['A', 'B', 'C', 'D'].includes(q.correctAnswer)
    )
  );
}

// ════════════════════════════════════════════════════════════════
// GÉNÉRATION AVEC VÉRIFICATION DE COUVERTURE + RETRY
// ════════════════════════════════════════════════════════════════
async function generateWithCoverageGuarantee(promptFn, validator, chapitre, maxTokens = 6000) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_REGENERATION_ATTEMPTS; attempt++) {
    try {
      console.log(`[COVERAGE] Tentative ${attempt}/${MAX_REGENERATION_ATTEMPTS}`);
      const prompt = promptFn(attempt);
      const data = await generateWithFallback(prompt, (d) => validator(d, chapitre), maxTokens);

      // Vérification de couverture
      if (validator(data, chapitre)) {
        console.log(`[COVERAGE] ✅ Couverture 100% validée`);
        return data;
      }

      lastError = new Error('Couverture incomplète');
      console.warn(`[COVERAGE] ⚠️ Tentative ${attempt} : couverture incomplète, retry...`);

    } catch (error) {
      lastError = error;
      console.warn(`[COVERAGE] ⚠️ Tentative ${attempt} échouée:`, error.message);
    }
  }

  throw lastError || new Error('Impossible de garantir la couverture');
}

// ════════════════════════════════════════════════════════════════
// FALLBACKS LOCAUX
// ════════════════════════════════════════════════════════════════
function buildLocalFicheWithBase(chapitre) {
  return {
    chapterTitle: chapitre.titre,
    sections: chapitre.notions.map((n) => ({
      notionId: n.id,
      title: n.titre,
      content: `${n.description}\n\nFormules : ${(n.formules || []).join(' | ')}`
    })),
    keyPoints: chapitre.notions.slice(0, 5).map((n) => n.titre),
    examTraps: chapitre.notions[0]?.pieges_examen?.map((p) => ({
      trap: p, solution: 'À retenir'
    })) || [],
    commonMistakes: chapitre.notions[0]?.erreurs_frequentes || []
  };
}

function buildLocalFlashcardsWithBase(chapitre, count = 10) {
  const cards = [];
  chapitre.notions.forEach((n) => {
    cards.push({
      notionId: n.id,
      question: `Que retenir de "${n.titre}" ?`,
      answer: n.description,
      hint: (n.formules || [])[0] || null
    });
  });
  return {
    chapterTitle: chapitre.titre,
    flashcards: cards.slice(0, count)
  };
}

function buildLocalFiche(body) {
  return {
    chapterTitle: body.chapter === 'all' ? 'Révision générale' : body.chapter,
    sections: [
      { title: 'Introduction', content: `Fiche de révision — ${body.chapter}` },
      { title: 'Définitions clés', content: 'À compléter avec ton cours.' },
      { title: 'Formules importantes', content: 'À compléter avec ton cours.' },
      { title: 'Méthodes', content: 'À compléter.' },
      { title: 'Erreurs fréquentes', content: 'À compléter.' }
    ],
    keyPoints: ['À retenir'],
    examTraps: [],
    commonMistakes: []
  };
}

function buildLocalFlashcards(body, count = 10) {
  return {
    chapterTitle: body.chapter === 'all' ? 'Révision générale' : body.chapter,
    flashcards: Array.from({ length: count }, (_, i) => ({
      question: `Question ${i + 1}`,
      answer: 'À compléter.',
      hint: null
    }))
  };
}

// ════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  if (rateLimited(clientIp(request))) {
    return jsonError(response, 429, 'Trop de demandes. Réessaie dans une minute.');
  }

  let user;
  try {
    user = await verifyFirebaseToken(request);
  } catch (error) {
    console.error('Auth error:', error.message);
    return jsonError(response, 503, 'Service temporairement indisponible.');
  }

  if (!user) {
    return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'generate';

  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonError(response, 400, 'Action invalide.');
  }
  if (!ALLOWED_SUBJECTS.has(body.subject)) {
    return jsonError(response, 400, 'Matière invalide.');
  }
  if (typeof body.chapter !== 'string' || body.chapter.length > 100) {
    return jsonError(response, 400, 'Chapitre invalide.');
  }

  // ═══ Réservation du quota (génération uniquement) ═══
  let reservation = null;
  if (action === 'generate') {
    try {
      reservation = await reserveFreeGeneration(user.uid);
    } catch (error) {
      console.error('Quota check failed:', error.message);
      return jsonError(response, 503, 'Vérification de votre quota temporairement indisponible.');
    }

    if (reservation.limitReached) {
      return response.status(429).json({
        success: false,
        error: 'Limite gratuite atteinte. Passe à Premium pour générer sans limite.',
        code: 'FREE_REVISEUR_LIMIT',
        used: reservation.used,
        limit: FREE_REVISEUR_LIMIT
      });
    }
  }

  try {
    // ═══════════════════════════════════════════════════════
    // ACTION : GÉNÉRATION
    // ═══════════════════════════════════════════════════════
    if (action === 'generate') {
      if (!ALLOWED_MODES.has(body.mode)) {
        if (reservation?.reserved) {
          try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
        }
        return jsonError(response, 400, 'Mode invalide.');
      }

      // ═══ Charger la base de connaissances ═══
      const base = getBaseForSubject(body.subject);
      const chapitre = base ? findChapitreByTitle(base, body.chapter) : null;

      const isFlashcard = body.mode === 'flashcard';
      const count = Number(body.count) || 10;

      let data;
      let usedBase = false;

      if (base && chapitre) {
        // ═══ MODE GARANTI (avec base de connaissances) ═══
        console.log(`[REVISEUR] Mode garanti — chapitre "${chapitre.titre}" (${chapitre.notions.length} notions)`);
        usedBase = true;

        if (isFlashcard) {
          data = await generateWithCoverageGuarantee(
            () => flashcardPromptWithBase(body.subject, body.chapter, base, chapitre, count),
            validateFlashcardsWithCoverage,
            chapitre,
            6000
          );
        } else {
          data = await generateWithCoverageGuarantee(
            () => fichePromptWithBase(body.subject, body.chapter, base, chapitre),
            validateFicheWithCoverage,
            chapitre,
            8000
          );
        }
      } else {
        // ═══ MODE SIMPLE (pas de base pour cette matière) ═══
        console.log(`[REVISEUR] Mode simple — pas de base pour "${body.subject}" / "${body.chapter}"`);

        if (isFlashcard) {
          data = await generateWithFallback(
            flashcardPromptSimple(body.subject, body.chapter, count),
            validateFlashcards,
            4000
          );
        } else {
          data = await generateWithFallback(
            fichePromptSimple(body.subject, body.chapter),
            validateFiche,
            4000
          );
        }
      }

      return response.status(200).json({
        success: true,
        session: {
          ...data,
          subject: body.subject,
          chapter: body.chapter,
          mode: body.mode,
          usedBase,                                              // ⚡ Nouveau
          coverage: usedBase ? '100%' : 'standard',              // ⚡ Nouveau
          generatedAt: new Date().toISOString()
        },
        quota: reservation?.premium
          ? { type: 'premium', unlimited: true }
          : {
              type: 'free',
              used: reservation?.used,
              limit: FREE_REVISEUR_LIMIT
            }
      });
    }

    // ═══════════════════════════════════════════════════════
    // ACTION : QUIZ
    // ═══════════════════════════════════════════════════════
    if (action === 'quiz') {
      if (!body.session) {
        return jsonError(response, 400, 'Session manquante.');
      }

      const base = getBaseForSubject(body.subject);
      const chapitre = base ? findChapitreByTitle(base, body.chapter) : null;
      const difficulty = Number(body.difficulty) || 2;
      const count = Number(body.count) || 5;

      let data;

      if (base && chapitre) {
        // Quiz garanti avec notions
        console.log(`[REVISEUR] Quiz garanti — ${chapitre.notions.length} notions disponibles`);
        data = await generateWithFallback(
          quizPromptWithBase(body.subject, body.chapter, body.session, base, chapitre, count, difficulty),
          validateQuiz,
          4000
        );
      } else {
        // Quiz simple
        data = await generateWithFallback(
          quizPromptSimple(body.subject, body.chapter, body.session, count, difficulty),
          validateQuiz,
          3000
        );
      }

      return response.status(200).json({
        success: true,
        quiz: data.quiz
      });
    }

  } catch (error) {
    console.error('Réviseur failed:', error.message);

    if (reservation?.reserved && action === 'generate') {
      try {
        await releaseFreeGeneration(user.uid, reservation.usageDate);
        console.log('Crédit libéré suite à une erreur');
      } catch (releaseError) {
        console.error('Erreur libération crédit:', releaseError.message);
      }
    }

    // Fallback local
    if (action === 'generate') {
      const base = getBaseForSubject(body.subject);
      const chapitre = base ? findChapitreByTitle(base, body.chapter) : null;

      const fallback = body.mode === 'flashcard'
        ? (chapitre ? buildLocalFlashcardsWithBase(chapitre, body.count || 10) : buildLocalFlashcards(body, body.count || 10))
        : (chapitre ? buildLocalFicheWithBase(chapitre) : buildLocalFiche(body));

      return response.status(200).json({
        success: true,
        session: {
          ...fallback,
          subject: body.subject,
          chapter: body.chapter,
          mode: body.mode,
          usedBase: Boolean(chapitre),
          coverage: chapitre ? 'fallback' : 'local'
        },
        quota: reservation?.premium
          ? { type: 'premium', unlimited: true }
          : {
              type: 'free',
              used: reservation?.used,
              limit: FREE_REVISEUR_LIMIT
            },
        fallback: true
      });
    }

    return jsonError(response, 503, 'Le Réviseur est temporairement indisponible. Réessaie.');
  }
};
