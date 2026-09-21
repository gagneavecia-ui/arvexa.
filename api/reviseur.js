// ================================================================
// API RÉVISEUR — ARVEXA School
// Génère des fiches de révision, flashcards et quiz via IA
// Vérification stricte du statut Premium côté serveur
// ================================================================

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);
const ALLOWED_ACTIONS = new Set(['generate', 'quiz']);

let adminServices;

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
  return response.status(status).json({ success: false, error, ...(code ? { code } : {}) });
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

// ────────────────────────────────────────────────────────────────
// PROMPTS
// ────────────────────────────────────────────────────────────────
function fichePrompt(subject, chapter) {
  return `Tu es un professeur expert du BAC au Niger. Tu prépares une FICHE DE RÉVISION pour un élève de Terminale D.

Matière : ${subject}
Chapitre : ${chapter}

Génère une fiche de révision structurée en JSON valide. Réponds UNIQUEMENT avec un objet JSON, sans markdown.

Schéma exact :
{
  "chapterTitle": "Titre du chapitre",
  "sections": [
    {
      "title": "Titre de la section",
      "content": "Contenu avec **mots-clés** en gras et formules en LaTeX entre $...$. Utilise \\n pour les sauts de ligne."
    }
  ]
}

Règles :
- Exactement 5 à 7 sections
- Chaque section traite un point clé (définitions, propriétés, formules, méthodes)
- Utilise **gras** pour les termes importants
- Formules LaTeX entre $...$ ou $$...$$
- Contenu concis mais complet
- Pas de données personnelles
- Pas de commentaires hors JSON`;
}

function flashcardPrompt(subject, chapter) {
  return `Tu es un professeur expert du BAC au Niger. Tu prépares des FLASHCARDS pour un élève de Terminale D.

Matière : ${subject}
Chapitre : ${chapter}

Génère 10 flashcards sous forme de JSON valide. Réponds UNIQUEMENT avec un objet JSON, sans markdown.

Schéma exact :
{
  "chapterTitle": "Titre du chapitre",
  "flashcards": [
    {
      "question": "Question courte et claire",
      "answer": "Réponse concise avec formules LaTeX entre $...$ si nécessaire"
    }
  ]
}

Règles :
- Exactement 10 flashcards
- Questions directes (définitions, formules, propriétés)
- Réponses concises (1-3 lignes max)
- Formules LaTeX entre $...$
- Pas de données personnelles
- Pas de commentaires hors JSON`;
}

function quizPrompt(subject, chapter, session) {
  const ficheContent = JSON.stringify(session).slice(0, 3000);
  return `Tu es un professeur expert du BAC au Niger. Tu crées un QUIZ pour vérifier les connaissances d'un élève de Terminale D.

Matière : ${subject}
Chapitre : ${chapter}
Contenu de la révision : ${ficheContent}

Génère 5 questions à choix multiples en JSON valide. Réponds UNIQUEMENT avec un objet JSON, sans markdown.

Schéma exact :
{
  "quiz": [
    {
      "question": "Énoncé de la question",
      "options": [
        { "id": "A", "text": "Proposition A" },
        { "id": "B", "text": "Proposition B" },
        { "id": "C", "text": "Proposition C" },
        { "id": "D", "text": "Proposition D" }
      ],
      "correctAnswer": "A",
      "explanation": "Explication de la bonne réponse"
    }
  ]
}

Règles :
- Exactement 5 questions
- 4 options par question (A, B, C, D)
- Une seule bonne réponse
- Niveau Terminale D
- Explications claires avec formules LaTeX entre $...$
- Pas de données personnelles
- Pas de commentaires hors JSON`;
}

// ────────────────────────────────────────────────────────────────
// APPEL IA
// ────────────────────────────────────────────────────────────────
async function callProvider(provider, prompt, maxTokens = 4000) {
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
        temperature: 0.3,
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

    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithFallback(prompt) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  for (const provider of providers) {
    try {
      return await callProvider(provider, prompt);
    } catch (error) {
      console.warn(`${provider.name} indisponible:`, error.message);
    }
  }
  throw new Error('all_providers_failed');
}

// ────────────────────────────────────────────────────────────────
// VALIDATION
// ────────────────────────────────────────────────────────────────
function validateFiche(data) {
  return data && typeof data === 'object'
    && Array.isArray(data.sections)
    && data.sections.length >= 3
    && data.sections.every((s) => s.title && s.content);
}

function validateFlashcards(data) {
  return data && typeof data === 'object'
    && Array.isArray(data.flashcards)
    && data.flashcards.length >= 5
    && data.flashcards.every((c) => c.question && c.answer);
}

function validateQuiz(data) {
  return data && typeof data === 'object'
    && Array.isArray(data.quiz)
    && data.quiz.length >= 3
    && data.quiz.every((q) =>
      q.question
      && Array.isArray(q.options)
      && q.options.length === 4
      && q.options.every((o) => o.id && o.text)
      && ['A', 'B', 'C', 'D'].includes(q.correctAnswer)
    );
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

  // Auth
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

  // Vérifier Premium
  const { db } = getAdminServices();
  const userDoc = await db.collection('users').doc(user.uid).get();
  if (!isPremiumUser(userDoc.data())) {
    return jsonError(response, 403, 'Le Réviseur est réservé aux comptes Premium.', 'PREMIUM_REQUIRED');
  }

  // Body
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'generate';

  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonError(response, 400, 'Action invalide.');
  }

  // Validation
  if (!ALLOWED_SUBJECTS.has(body.subject)) {
    return jsonError(response, 400, 'Matière invalide.');
  }

  if (typeof body.chapter !== 'string' || body.chapter.length > 100) {
    return jsonError(response, 400, 'Chapitre invalide.');
  }

  try {
    // ─────────────────────────────────────────
    // ACTION : génération de fiche ou flashcards
    // ─────────────────────────────────────────
    if (action === 'generate') {
      if (!ALLOWED_MODES.has(body.mode)) {
        return jsonError(response, 400, 'Mode invalide.');
      }

      const prompt = body.mode === 'flashcard'
        ? flashcardPrompt(body.subject, body.chapter)
        : fichePrompt(body.subject, body.chapter);

      const data = await generateWithFallback(prompt);

      // Validation
      if (body.mode === 'flashcard' && !validateFlashcards(data)) {
        throw new Error('invalid_flashcard_structure');
      }
      if (body.mode === 'fiche' && !validateFiche(data)) {
        throw new Error('invalid_fiche_structure');
      }

      return response.status(200).json({
        success: true,
        session: {
          ...data,
          subject: body.subject,
          chapter: body.chapter,
          mode: body.mode,
          generatedAt: new Date().toISOString()
        }
      });
    }

    // ─────────────────────────────────────────
    // ACTION : génération du quiz
    // ─────────────────────────────────────────
    if (action === 'quiz') {
      if (!body.session) {
        return jsonError(response, 400, 'Session manquante.');
      }

      const prompt = quizPrompt(body.subject, body.chapter, body.session);
      const data = await generateWithFallback(prompt, 3000);

      if (!validateQuiz(data)) {
        throw new Error('invalid_quiz_structure');
      }

      return response.status(200).json({
        success: true,
        quiz: data.quiz
      });
    }

  } catch (error) {
    console.error('Réviseur failed:', error.message);

    // Fallback local si tous les providers échouent
    if (action === 'generate') {
      const fallback = body.mode === 'flashcard'
        ? buildLocalFlashcards(body)
        : buildLocalFiche(body);
      return response.status(200).json({
        success: true,
        session: { ...fallback, subject: body.subject, chapter: body.chapter, mode: body.mode }
      });
    }

    return jsonError(response, 503, 'Le Réviseur est temporairement indisponible. Réessaie.');
  }
};

// ────────────────────────────────────────────────────────────────
// FALLBACKS LOCAUX
// ────────────────────────────────────────────────────────────────
function buildLocalFiche(body) {
  return {
    chapterTitle: body.chapter === 'all' ? 'Révision générale' : body.chapter,
    sections: [
      {
        title: 'Introduction',
        content: `Cette fiche couvre les notions essentielles du chapitre **${body.chapter === 'all' ? 'complet' : body.chapter}** en **${body.subject}**.`
      },
      {
        title: 'Définitions clés',
        content: '- **Définition 1** : à compléter avec ton cours.\\n- **Définition 2** : à compléter avec ton cours.\\n- **Définition 3** : à compléter avec ton cours.'
      },
      {
        title: 'Formules importantes',
        content: 'Les formules principales à retenir :\\n\\n$F = ma$\\n\\n$E = mc^2$\\n\\nComplète avec les formules de ton cours.'
      },
      {
        title: 'Méthodes de résolution',
        content: '1. Lire attentivement l\'énoncé\\n2. Identifier les données\\n3. Choisir la bonne formule\\n4. Calculer\\n5. Vérifier le résultat'
      },
      {
        title: 'Erreurs fréquentes',
        content: '- Oublier les unités\\n- Confondre les formules\\n- Ne pas vérifier le résultat\\n- Aller trop vite'
      }
    ]
  };
}

function buildLocalFlashcards(body) {
  return {
    chapterTitle: body.chapter === 'all' ? 'Révision générale' : body.chapter,
    flashcards: Array.from({ length: 10 }, (_, i) => ({
      question: `Question ${i + 1} sur ${body.chapter === 'all' ? 'le programme' : body.chapter}`,
      answer: 'Réponse à compléter avec ton cours. Cette carte est un placeholder généré en mode hors-ligne.'
    }))
  };
}
