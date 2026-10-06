// ================================================================
// API RÉVISEUR v3.0 — ARVEXA School
// Génération GARANTIE de fiches/flashcards/quiz
// Lecture de la base de connaissances (bac-mathematiques.json, etc.)
// Vérification de complétude + retry ciblé
// ================================================================

const fs = require('fs');
const path = require('path');

// ────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);
const ALLOWED_ACTIONS = new Set(['generate', 'quiz']);

const FREE_REVISEUR_LIMIT = 2;
module.exports.config = { maxDuration: 60 };

// Cache des bases de connaissances chargées en mémoire
const KNOWLEDGE_CACHE = new Map();

let adminServices;

// ────────────────────────────────────────────────────────────────
// FIREBASE ADMIN
// ────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────
// BASE DE CONNAISSANCES — Chargement
// ────────────────────────────────────────────────────────────────
/**
 * Charge le JSON de la matière depuis la racine du projet.
 * Retourne null si le fichier n'existe pas.
 * Met en cache pour éviter les lectures répétées.
 */
function loadKnowledgeBase(subject) {
  if (KNOWLEDGE_CACHE.has(subject)) {
    return KNOWLEDGE_CACHE.get(subject);
  }

  const filename = `bac-${subject}.json`;
  const filePath = path.join(process.cwd(), filename);

  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[REVISEUR] Base de connaissances absente : ${filename}`);
      KNOWLEDGE_CACHE.set(subject, null);
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    console.log(`[REVISEUR] ✅ Base chargée : ${filename} (${data.chapitres?.length || 0} chapitres)`);
    KNOWLEDGE_CACHE.set(subject, data);
    return data;
  } catch (error) {
    console.error(`[REVISEUR] Erreur chargement ${filename}:`, error.message);
    KNOWLEDGE_CACHE.set(subject, null);
    return null;
  }
}

/**
 * Trouve un chapitre dans la base à partir de son nom (fuzzy match).
 */
function findChapter(knowledgeBase, chapterName) {
  if (!knowledgeBase || !chapterName) return null;

  const normalize = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  const target = normalize(chapterName);

  // Match exact d'abord
  for (const ch of knowledgeBase.chapitres || []) {
    if (normalize(ch.titre) === target || normalize(ch.id) === target) {
      return ch;
    }
  }

  // Match partiel ensuite
  for (const ch of knowledgeBase.chapitres || []) {
    const chNorm = normalize(ch.titre);
    if (chNorm.includes(target) || target.includes(chNorm)) {
      return ch;
    }
  }

  return null;
}

/**
 * Retourne toutes les notions obligatoires d'un chapitre.
 */
function getMandatoryNotions(chapter) {
  if (!chapter || !Array.isArray(chapter.notions)) return [];
  return chapter.notions.filter((n) => n.obligatoire !== false);
}

/**
 * Vérifie si une notion est présente dans une fiche générée.
 * Compare par id ou par titre (normalisé).
 */
function isNotionCovered(notion, sections) {
  if (!Array.isArray(sections)) return false;

  const normalize = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  const notionIdNorm = normalize(notion.id);
  const notionTitleNorm = normalize(notion.titre);

  return sections.some((section) => {
    const sectionTitleNorm = normalize(section.title || section.titre || '');
    const sectionContentNorm = normalize(section.content || '');

    // Match sur le titre (exact ou inclusion)
    if (sectionTitleNorm.includes(notionTitleNorm)) return true;
    if (notionTitleNorm.includes(sectionTitleNorm) && sectionTitleNorm.length > 4) return true;

    // Match sur l'id
    if (sectionContentNorm.includes(notionIdNorm)) return true;

    return false;
  });
}

// ────────────────────────────────────────────────────────────────
// UTILITAIRES
// ────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────
// QUOTA
// ────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────
// PROVIDERS IA
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
        'X-Title': 'ARVEXA School'
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

// ────────────────────────────────────────────────────────────────
// PROMPTS — Version v3 (avec notions obligatoires explicites)
// ────────────────────────────────────────────────────────────────
function fichePromptWithNotions(subjectLabel, chapterTitle, notions) {
  const notionsList = notions.map((n, i) =>
    `${i + 1}. [${n.id}] ${n.titre} — ${n.description || ''}`
  ).join('\n');

  return `Tu es un professeur expert du BAC au Niger. Tu prépares une FICHE DE RÉVISION COMPLÈTE pour un élève de Terminale D.

Matière : ${subjectLabel}
Chapitre : ${chapterTitle}

═══════════════════════════════════════════════════════════════
MISSION — GARANTIR 100% DE COUVERTURE
═══════════════════════════════════════════════════════════════
Tu DOIS générer EXACTEMENT une section par notion ci-dessous.
Il y a ${notions.length} notions obligatoires → ${notions.length} sections MINIMUM.
NE SAUTE AUCUNE NOTION.

LISTE DES NOTIONS OBLIGATOIRES :
${notionsList}

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Toute formule entre $...$ (inline) ou $$...$$ (display)
- JAMAIS de symboles Unicode bruts (π → $\\pi$, √ → $\\sqrt{}$, ² → $^{2}$)
- Commandes autorisées : \\frac, \\sqrt, ^{}, _{}, \\lim, \\int, \\sum,
  \\sin, \\cos, \\tan, \\ln, \\log, \\alpha...\\omega, \\times, \\div, \\leq,
  \\geq, \\neq, \\infty, \\to, \\Rightarrow

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "chapterTitle": "${chapterTitle}",
  "sections": [
    {
      "title": "Titre de la section (reprend le titre de la notion)",
      "content": "Contenu avec **mots-clés** en gras et formules LaTeX."
    }
  ],
  "keyPoints": [
    "Point clé 1",
    "Point clé 2",
    "Point clé 3",
    "Point clé 4",
    "Point clé 5"
  ],
  "examTraps": [
    { "trap": "Piège classique", "solution": "Comment l'éviter" }
  ],
  "commonMistakes": [
    "Erreur fréquente 1",
    "Erreur fréquente 2"
  ]
}

CONTRAINTES :
- Exactement ${notions.length} sections (une par notion)
- Chaque section a un titre clair
- keyPoints : 5 à 8 points essentiels
- examTraps : 2 à 4 pièges
- commonMistakes : 3 à 5 erreurs
- Pas de données personnelles
- Réponds UNIQUEMENT avec le JSON`;
}

function flashcardPromptWithNotions(subjectLabel, chapterTitle, notions, count) {
  const notionsList = notions.map((n) => `- [${n.id}] ${n.titre}`).join('\n');

  return `Tu es un professeur expert du BAC au Niger. Tu prépares des FLASHCARDS pour un élève de Terminale D.

Matière : ${subjectLabel}
Chapitre : ${chapterTitle}

NOTIONS À COUVRIR :
${notionsList}

Génère exactement ${count} flashcards couvrant TOUTES les notions ci-dessus.
Chaque notion doit avoir AU MOINS 1 flashcard.

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Formule inline : $...$ / Display : $$...$$
- JAMAIS de symboles Unicode bruts
- Toujours utiliser \\frac, \\sqrt, ^{}, _{}, \\pi, \\times, \\leq, \\infty

═══════════════════════════════════════════════════════════════
FORMAT (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "chapterTitle": "${chapterTitle}",
  "flashcards": [
    {
      "notionId": "id-de-la-notion",
      "question": "Question courte et claire",
      "answer": "Réponse concise avec LaTeX si besoin",
      "hint": "Indice court ou null"
    }
  ]
}

CONTRAINTES :
- Exactement ${count} flashcards
- Chaque flashcard a un notionId valide (voir liste)
- Question courte, réponse concise
- Dernière flashcard : question piège
- Réponds UNIQUEMENT avec le JSON`;
}

function quizPromptWithNotions(subjectLabel, chapterTitle, notions, difficulty, count) {
  const notionsList = notions.map((n) => `- [${n.id}] ${n.titre}`).join('\n');
  const difficultyLabels = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile', 4: 'Niveau BAC' };
  const difficultyLabel = difficultyLabels[difficulty] || 'Moyen';

  return `Tu es un professeur expert du BAC au Niger. Tu crées un QUIZ pour un élève de Terminale D.

Matière : ${subjectLabel}
Chapitre : ${chapterTitle}
Difficulté : ${difficultyLabel} (${difficulty}/4)

NOTIONS À COUVRIR :
${notionsList}

Génère exactement ${count} questions à choix multiples couvrant ces notions.

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Formule inline : $...$ / Display : $$...$$
- JAMAIS de symboles Unicode bruts
- Exemples : "$3x^2$", "$\\frac{1}{2}$", "$\\lim_{x \\to 0}$"

═══════════════════════════════════════════════════════════════
FORMAT (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "quiz": [
    {
      "notionId": "id-notion",
      "question": "Énoncé avec LaTeX si besoin",
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

CONTRAINTES :
- Exactement ${count} questions
- 4 options par question
- Une seule bonne réponse
- Commence facile, termine difficile
- Réponds UNIQUEMENT avec le JSON`;
}

// ────────────────────────────────────────────────────────────────
// VALIDATION DES RÉPONSES IA
// ────────────────────────────────────────────────────────────────
function validateFiche(data) {
  return data && typeof data === 'object' &&
    Array.isArray(data.sections) && data.sections.length >= 3 &&
    data.sections.every((s) => s.title && s.content);
}

function validateFlashcards(data) {
  return data && typeof data === 'object' &&
    Array.isArray(data.flashcards) && data.flashcards.length >= 3 &&
    data.flashcards.every((c) => c.question && c.answer);
}

function validateQuiz(data) {
  return data && typeof data === 'object' &&
    Array.isArray(data.quiz) && data.quiz.length >= 3 &&
    data.quiz.every((q) =>
      q.question && Array.isArray(q.options) && q.options.length === 4 &&
      q.options.every((o) => o.id && o.text) &&
      ['A', 'B', 'C', 'D'].includes(q.correctAnswer)
    );
}

// ────────────────────────────────────────────────────────────────
// VÉRIFICATION DE COMPLÉTUDE
// ────────────────────────────────────────────────────────────────
function checkCompleteness(sections, notions) {
  const missing = [];
  for (const notion of notions) {
    if (!isNotionCovered(notion, sections)) {
      missing.push(notion);
    }
  }
  return {
    complete: missing.length === 0,
    total: notions.length,
    covered: notions.length - missing.length,
    missing
  };
}

// ────────────────────────────────────────────────────────────────
// RETRY CIBLÉ SUR NOTIONS MANQUANTES
// ────────────────────────────────────────────────────────────────
async function retryMissingNotions(subjectLabel, chapterTitle, missingNotions, existingSections) {
  if (missingNotions.length === 0) return existingSections;

  console.log(`[AI-RETRY] ${missingNotions.length} notion(s) manquante(s), retry ciblé...`);

  const notionsList = missingNotions.map((n) => `- [${n.id}] ${n.titre} — ${n.description || ''}`).join('\n');

  const prompt = `Tu es un professeur expert du BAC au Niger.

Chapitre : ${chapterTitle} (${subjectLabel})

Il te manque ${missingNotions.length} section(s) de fiche. Génère UNIQUEMENT ces sections.

NOTIONS MANQUANTES :
${notionsList}

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "sections": [
    {
      "title": "Titre de la section",
      "content": "Contenu avec **gras** et formules $LaTeX$."
    }
  ]
}

- Toute formule entre $...$ ou $$...$$
- JAMAIS de symboles Unicode bruts (π, √, ²...)
- Exactement ${missingNotions.length} sections
- Réponds UNIQUEMENT avec le JSON`;

  try {
    const data = await generateWithFallback(prompt, validateFiche, 2000);
    if (Array.isArray(data.sections)) {
      return [...existingSections, ...data.sections];
    }
  } catch (error) {
    console.warn('[AI-RETRY] Échec retry:', error.message);
  }

  return existingSections;
}

// ────────────────────────────────────────────────────────────────
// FALLBACK LOCAL (si base de connaissances disponible)
// ────────────────────────────────────────────────────────────────
function buildLocalFicheFromNotions(chapterTitle, notions) {
  return {
    chapterTitle,
    sections: notions.map((n) => ({
      title: n.titre,
      content: [
        n.description || '',
        n.formules && n.formules.length > 0 ? '\n\n**Formules** :\n' + n.formules.map((f) => `- ${f}`).join('\n') : '',
        n.proprietes && n.proprietes.length > 0 ? '\n\n**Propriétés** :\n' + n.proprietes.map((p) => `- ${p}`).join('\n') : ''
      ].filter(Boolean).join('')
    })),
    keyPoints: notions.slice(0, 5).map((n) => n.titre),
    examTraps: notions
      .filter((n) => n.pieges_examen && n.pieges_examen.length > 0)
      .slice(0, 3)
      .map((n) => ({ trap: n.pieges_examen[0], solution: 'Voir le cours.' })),
    commonMistakes: notions
      .filter((n) => n.erreurs_frequentes && n.erreurs_frequentes.length > 0)
      .slice(0, 5)
      .map((n) => n.erreurs_frequentes[0])
  };
}

function buildLocalFlashcardsFromNotions(chapterTitle, notions, count) {
  const flashcards = [];
  notions.forEach((n) => {
    if (flashcards.length >= count) return;
    flashcards.push({
      notionId: n.id,
      question: `Que retenir de "${n.titre}" ?`,
      answer: n.description || 'Voir le cours.',
      hint: n.formules && n.formules[0] ? n.formules[0] : null
    });
  });
  // Compléter si nécessaire
  while (flashcards.length < count && notions.length > 0) {
    const n = notions[flashcards.length % notions.length];
    flashcards.push({
      notionId: n.id,
      question: `Formule ou propriété de "${n.titre}" ?`,
      answer: (n.formules && n.formules[0]) || 'Voir le cours.',
      hint: null
    });
  }
  return { chapterTitle, flashcards: flashcards.slice(0, count) };
}

// ────────────────────────────────────────────────────────────────
// HANDLER
// ────────────────────────────────────────────────────────────────
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

  // ═══════════════════════════════════════════════════════════════
  // Chargement de la base de connaissances
  // ═══════════════════════════════════════════════════════════════
  const knowledgeBase = loadKnowledgeBase(body.subject);
  const chapterData = knowledgeBase ? findChapter(knowledgeBase, body.chapter) : null;
  const mandatoryNotions = chapterData ? getMandatoryNotions(chapterData) : [];
  const hasKnowledge = mandatoryNotions.length > 0;

  const subjectLabel = knowledgeBase?.matiereLabel ||
    { mathematiques: 'Mathématiques', physique: 'Physique', chimie: 'Chimie', svt: 'SVT' }[body.subject] ||
    body.subject;

  const chapterTitle = chapterData?.titre || body.chapter;

  console.log(`[REVISEUR] Subject: ${body.subject}, Chapter: ${body.chapter}, Notions: ${mandatoryNotions.length}, Mode: ${hasKnowledge ? 'GARANTI' : 'LIBRE'}`);

  // ═══════════════════════════════════════════════════════════════
  // Quota
  // ═══════════════════════════════════════════════════════════════
  let reservation = null;
  if (action === 'generate') {
    try {
      reservation = await reserveFreeGeneration(user.uid);
    } catch (error) {
      console.error('Quota check failed:', error.message);
      return jsonError(response, 503, 'La vérification de votre quota est temporairement indisponible.');
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
    // ═══════════════════════════════════════════════════════════════
    // ACTION : GÉNÉRATION
    // ═══════════════════════════════════════════════════════════════
    if (action === 'generate') {
      if (!ALLOWED_MODES.has(body.mode)) {
        if (reservation?.reserved) {
          try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
        }
        return jsonError(response, 400, 'Mode invalide.');
      }

      const isFlashcard = body.mode === 'flashcard';
      const flashCount = Number(body.count) || 10;

      let data;
      let mode = 'free'; // free | guaranteed | fallback

      try {
        if (hasKnowledge) {
          // ═══ MODE GARANTI ═══
          const prompt = isFlashcard
            ? flashcardPromptWithNotions(subjectLabel, chapterTitle, mandatoryNotions, flashCount)
            : fichePromptWithNotions(subjectLabel, chapterTitle, mandatoryNotions);

          const validator = isFlashcard ? validateFlashcards : validateFiche;
          data = await generateWithFallback(prompt, validator, isFlashcard ? 4000 : 6000);

          // Vérification de complétude (uniquement pour les fiches)
          if (!isFlashcard) {
            const check = checkCompleteness(data.sections || [], mandatoryNotions);
            if (!check.complete) {
              console.log(`[REVISEUR] ⚠️ Complétude : ${check.covered}/${check.total}, retry ciblé...`);
              data.sections = await retryMissingNotions(
                subjectLabel,
                chapterTitle,
                check.missing,
                data.sections || []
              );
              // 2e vérification
              const finalCheck = checkCompleteness(data.sections, mandatoryNotions);
              console.log(`[REVISEUR] Complétude finale : ${finalCheck.covered}/${finalCheck.total}`);
              mode = finalCheck.complete ? 'guaranteed' : 'partial';
            } else {
              mode = 'guaranteed';
            }
          } else {
            mode = 'guaranteed';
          }
        } else {
          // ═══ MODE LIBRE (pas de base) ═══
          console.log('[REVISEUR] Pas de base de connaissances pour ce chapitre, mode libre');
          const prompt = isFlashcard
            ? flashcardPromptWithNotions(subjectLabel, chapterTitle, [], flashCount)
            : fichePromptWithNotions(subjectLabel, chapterTitle, []);
          const validator = isFlashcard ? validateFlashcards : validateFiche;
          data = await generateWithFallback(prompt, validator, isFlashcard ? 4000 : 6000);
          mode = 'free';
        }
      } catch (aiError) {
        console.warn('[REVISEUR] Fallback local :', aiError.message);

        if (hasKnowledge) {
          data = isFlashcard
            ? buildLocalFlashcardsFromNotions(chapterTitle, mandatoryNotions, flashCount)
            : buildLocalFicheFromNotions(chapterTitle, mandatoryNotions);
        } else {
          data = isFlashcard
            ? { chapterTitle, flashcards: [] }
            : { chapterTitle, sections: [] };
        }
        mode = 'fallback';
      }

      return response.status(200).json({
        success: true,
        session: {
          ...data,
          subject: body.subject,
          chapter: body.chapter,
          mode: body.mode,
          generationMode: mode,
          notionsCovered: hasKnowledge ? mandatoryNotions.length : 0,
          generatedAt: new Date().toISOString()
        },
        quota: reservation?.premium
          ? { type: 'premium', unlimited: true }
          : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // ACTION : QUIZ (gratuit, pas de quota)
    // ═══════════════════════════════════════════════════════════════
    if (action === 'quiz') {
      if (!body.session) {
        return jsonError(response, 400, 'Session manquante.');
      }

      const difficulty = Number(body.difficulty) || 2;
      const quizCount = Number(body.count) || 5;

      let data;
      try {
        const prompt = hasKnowledge
          ? quizPromptWithNotions(subjectLabel, chapterTitle, mandatoryNotions, difficulty, quizCount)
          : quizPromptWithNotions(subjectLabel, chapterTitle, [], difficulty, quizCount);

        data = await generateWithFallback(prompt, validateQuiz, 3000);
      } catch (e) {
        console.warn('[REVISEUR] Quiz generation failed:', e.message);
        return jsonError(response, 503, 'Impossible de générer le quiz. Réessaie.');
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

    return jsonError(response, 503, 'Le Réviseur est temporairement indisponible. Réessaie.');
  }
};
