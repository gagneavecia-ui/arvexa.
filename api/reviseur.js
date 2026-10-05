// ================================================================
// API RÉVISEUR — ARVEXA School
// Génère des fiches de révision, flashcards et quiz via IA
// Quota : 2 essais gratuits/jour (comptes gratuits), illimité (Premium)
// ================================================================

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);
const ALLOWED_ACTIONS = new Set(['generate', 'quiz']);

// ⚡ QUOTA GRATUIT
const FREE_REVISEUR_LIMIT = 2;
module.exports.config = { maxDuration: 60 };

let adminServices;

// ────────────────────────────────────────────────────────────────
// INITIALISATION FIREBASE ADMIN
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
// UTILITAIRES
// ────────────────────────────────────────────────────────────────
function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
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
  const active =
    data.premium === true ||
    data.isUnlocked === true ||
    data.hasDeposited === true;
  if (!active) return false;
  const end =
    data.subscriptionEndDate?.toDate?.() ||
    (data.subscriptionEndDate?.seconds
      ? new Date(data.subscriptionEndDate.seconds * 1000)
      : null);
  return !end || end.getTime() > Date.now();
}

// ────────────────────────────────────────────────────────────────
// GESTION DU QUOTA GRATUIT (transaction atomique)
// ────────────────────────────────────────────────────────────────
function getUsageDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function reserveFreeGeneration(uid) {
  const { db, FieldValue } = getAdminServices();
  const userRef = db.collection('users').doc(uid);
  const usageDate = getUsageDate();
  const usageRef = userRef.collection('reviseurUsage').doc(usageDate);

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const usageSnapshot = await transaction.get(usageRef);

    if (!userSnapshot.exists) {
      throw new Error('profile_missing');
    }

    // Premium → pas de quota
    if (isPremiumUser(userSnapshot.data())) {
      return { premium: true, reserved: false };
    }

    const used = Number(usageSnapshot.data()?.count || 0);

    // Quota atteint ?
    if (used >= FREE_REVISEUR_LIMIT) {
      return { premium: false, reserved: false, limitReached: true, used };
    }

    // Incrémenter le compteur
    transaction.set(
      usageRef,
      { count: used + 1, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return { premium: false, reserved: true, usageDate, used: used + 1 };
  });
}

async function releaseFreeGeneration(uid, usageDate) {
  const { db, FieldValue } = getAdminServices();
  const usageRef = db
    .collection('users')
    .doc(uid)
    .collection('reviseurUsage')
    .doc(usageDate);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(usageRef);
    const used = Math.max(0, Number(snapshot.data()?.count || 0) - 1);
    transaction.set(
      usageRef,
      { count: used, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  });
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
// PROMPTS ENRICHIS
// ────────────────────────────────────────────────────────────────
function fichePrompt(subject, chapter) {
  return `Tu es un professeur expert du BAC au Niger. Tu prépares une FICHE DE RÉVISION PREMIUM pour un élève de Terminale D.

Matière : ${subject}
Chapitre : ${chapter}

Génère une fiche de révision structurée en JSON valide. Réponds UNIQUEMENT avec un objet JSON, sans markdown, sans texte avant ou après.

Schéma exact :
{
  "chapterTitle": "Titre du chapitre",
  "sections": [
    {
      "title": "Titre de la section",
      "content": "Contenu avec **mots-clés** en gras et formules LaTeX."
    }
  ],
  "keyPoints": [
    "Point clé 1 à retenir absolument",
    "Point clé 2",
    "Point clé 3",
    "Point clé 4",
    "Point clé 5"
  ],
  "examTraps": [
    {
      "trap": "Piège classique au BAC",
      "solution": "Comment l'éviter"
    }
  ],
  "commonMistakes": [
    "Erreur fréquente 1",
    "Erreur fréquente 2",
    "Erreur fréquente 3"
  ]
}

═══ RÈGLES LATEX — TRÈS IMPORTANTES ═══

1. TOUTE formule mathématique doit être entourée de délimiteurs :
   - Formule INLINE (dans une phrase) : $...$
     Exemple : "La fonction $f(x) = x^2$ est croissante."
   - Formule DISPLAY (isolée, centrée) : $$...$$
     Exemple : "$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$"

2. Utilise UNIQUEMENT la syntaxe LaTeX valide. Jamais de symboles Unicode :
   ❌ "π" → ✅ "$\\pi$"
   ❌ "√2" → ✅ "$\\sqrt{2}$"
   ❌ "x²" → ✅ "$x^{2}$"
   ❌ "lim x→0" → ✅ "$\\lim_{x \\to 0}$"
   ❌ "1/2" → ✅ "$\\frac{1}{2}$"
   ❌ "×" → ✅ "$\\times$"
   ❌ "≤" → ✅ "$\\leq$"
   ❌ "∞" → ✅ "$\\infty$"
   ❌ "∫" → ✅ "$\\int$"
   ❌ "∑" → ✅ "$\\sum$"

3. Commandes LaTeX autorisées :
   - Fractions : \\frac{a}{b}
   - Racines : \\sqrt{x}, \\sqrt[n]{x}
   - Exposants : x^{n}, e^{x}
   - Indices : x_{n}, u_{n+1}
   - Fonctions : \\sin, \\cos, \\tan, \\ln, \\log, \\exp
   - Limites : \\lim_{x \\to a}
   - Sommes : \\sum_{i=1}^{n}
   - Intégrales : \\int_{a}^{b}
   - Grecques : \\alpha, \\beta, \\gamma, \\theta, \\pi, \\lambda, \\mu, \\sigma
   - Relation : \\leq, \\geq, \\neq, \\approx, \\equiv
   - Ensemble : \\in, \\notin, \\subset, \\cup, \\cap
   - Flèches : \\to, \\Rightarrow, \\Leftrightarrow

4. Ne mets JAMAIS de formule dans un bloc de code markdown (\`\`\`).
5. Ne mets JAMAIS de formule entre simples quotes ou guillemets.
6. Chaque formule doit être TESTÉE mentalement — vérifie les accolades.

═══ CONTENU DES SECTIONS ═══
- Exactement 5 à 7 sections
- Chaque section traite un point clé (définitions, propriétés, formules, méthodes)
- Utilise **gras** pour les termes importants
- Contenu concis mais complet

═══ RÈGLES POUR LES CHAMPS ENRICHIS ═══
- keyPoints : 5 à 8 points essentiels à mémoriser absolument pour le BAC
- examTraps : 2 à 4 pièges classiques d'examen (ce sur quoi les élèves perdent des points)
- commonMistakes : 3 à 5 erreurs fréquentes que font les élèves sur ce chapitre

- Pas de données personnelles
- Pas de commentaires hors JSON`;
}

function flashcardPrompt(subject, chapter, count = 10) {
  return `Tu es un professeur expert du BAC au Niger. Tu prépares des FLASHCARDS pour un élève de Terminale D.

Matière : ${subject}
Chapitre : ${chapter}

Génère exactement ${count} flashcards sous forme de JSON valide. Réponds UNIQUEMENT avec un objet JSON, sans markdown, sans texte avant ou après.

Schéma exact :
{
  "chapterTitle": "Titre du chapitre",
  "flashcards": [
    {
      "question": "Question courte et claire",
      "answer": "Réponse concise avec formules LaTeX.",
      "hint": "Indice court ou null"
    }
  ]
}

═══ RÈGLES LATEX ═══
- Formule inline : $...$ → "La dérivée de $x^2$ est $2x$."
- Formule display : $$...$$ → "$$\\frac{d}{dx}(x^2) = 2x$$"
- JAMAIS de symboles Unicode (π, √, ×, ≤, ∞, etc.)
- Toujours utiliser \\frac, \\sqrt, ^{}, _{}, \\pi, \\times, \\leq, \\infty
- Fonctions : \\sin, \\cos, \\tan, \\ln, \\log, \\lim, \\int, \\sum

═══ CONTENU ═══
- Exactement ${count} flashcards
- Questions directes (définitions, formules, propriétés)
- Réponses concises (1-3 lignes max)
- La DERNIÈRE flashcard doit être une question piège ou un cas limite
- "hint" : un indice utile pour aider à se rappeler (ou null si évident)

- Pas de données personnelles
- Pas de commentaires hors JSON`;
}

function quizPrompt(subject, chapter, session, difficulty = 2, count = 5) {
  const ficheContent = JSON.stringify(session).slice(0, 3000);
  const difficultyLabels = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile', 4: 'Niveau BAC' };
  const difficultyLabel = difficultyLabels[difficulty] || 'Moyen';

  return `Tu es un professeur expert du BAC au Niger. Tu crées un QUIZ pour vérifier les connaissances d'un élève de Terminale D.

Matière : ${subject}
Chapitre : ${chapter}
Difficulté : ${difficultyLabel} (${difficulty}/4)
Contenu de la révision : ${ficheContent}

Génère exactement ${count} questions à choix multiples en JSON valide. Réponds UNIQUEMENT avec un objet JSON, sans markdown, sans texte avant ou après.

Schéma exact :
{
  "quiz": [
    {
      "question": "Énoncé avec formules LaTeX si nécessaire",
      "options": [
        { "id": "A", "text": "Proposition avec LaTeX si nécessaire" },
        { "id": "B", "text": "Proposition avec LaTeX si nécessaire" },
        { "id": "C", "text": "Proposition avec LaTeX si nécessaire" },
        { "id": "D", "text": "Proposition avec LaTeX si nécessaire" }
      ],
      "correctAnswer": "A",
      "explanation": "Explication avec LaTeX si nécessaire",
      "difficulty": ${difficulty}
    }
  ]
}

═══ RÈGLES LATEX ═══
- Chaque formule mathématique doit être entre $...$ (inline) ou $$...$$ (display)
- JAMAIS de symboles Unicode bruts
- Exemples :
  ✅ "Quelle est la dérivée de $f(x) = x^3$ ?"
  ✅ Options : "$3x^2$", "$x^2$", "$3x$", "$x^4$"
  ✅ Explication : "En utilisant $\\frac{d}{dx}(x^n) = nx^{n-1}$..."
  ❌ "Quelle est la dérivée de f(x) = x³ ?"
  ❌ Options : "3x²", "x²", "3x"

- Nombres et variables : toujours en LaTeX ($x$, $3$, $\\pi$)
- Unités : utiliser \\, pour l'espace → "$9,81\\,m/s^2$"

═══ CONTENU ═══
- Exactement ${count} questions
- 4 options par question (A, B, C, D)
- Une seule bonne réponse
- Niveau : ${difficultyLabel}
- Commence par les questions les plus simples et termine par les plus difficiles
- Explications claires et pédagogiques
- Pas de données personnelles
- Pas de commentaires hors JSON`;
}

// ────────────────────────────────────────────────────────────────
// APPEL IA
// ────────────────────────────────────────────────────────────────
async function callProvider(provider, prompt, maxTokens = 4000) {
  const controller = new AbortController();
  // ⚡ Timeout réduit à 25s : si le provider traîne, on bascule au suivant
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

    // ⚡ Mistral ne supporte PAS response_format:json_object de la même façon
    // → on l'active uniquement pour Groq et OpenRouter
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

      // ⚡ Validation DANS la boucle : on ne retourne que si la structure est OK
      if (validator(data)) {
        console.log(`[AI] ✅ ${provider.name} a répondu avec une structure valide`);
        return data;
      }

      errors.push(`${provider.name}: structure invalide`);
      console.warn(`[AI] ⚠️ ${provider.name} : structure invalide, on essaie le suivant`);

    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI] ❌ ${provider.name} échec: ${error.message}`);
    }
  }

  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ────────────────────────────────────────────────────────────────
// VALIDATION DES RÉPONSES IA
// ────────────────────────────────────────────────────────────────
function validateFiche(data) {
  return (
    data &&
    typeof data === 'object' &&
    Array.isArray(data.sections) &&
    data.sections.length >= 3 &&
    data.sections.every((s) => s.title && s.content)
  );
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

// ────────────────────────────────────────────────────────────────
// FALLBACKS LOCAUX (si IA indisponible)
// ────────────────────────────────────────────────────────────────
function buildLocalFiche(body) {
  return {
    chapterTitle: body.chapter === 'all' ? 'Révision générale' : body.chapter,
    sections: [
      {
        title: 'Introduction',
        content: `Cette fiche couvre les notions essentielles du chapitre **${
          body.chapter === 'all' ? 'complet' : body.chapter
        }** en **${body.subject}**.`
      },
      {
        title: 'Définitions clés',
        content:
          '- **Définition 1** : à compléter avec ton cours.\\n- **Définition 2** : à compléter avec ton cours.\\n- **Définition 3** : à compléter avec ton cours.'
      },
      {
        title: 'Formules importantes',
        content:
          'Les formules principales à retenir :\\n\\n$F = ma$\\n\\n$E = mc^2$\\n\\nComplète avec les formules de ton cours.'
      },
      {
        title: 'Méthodes de résolution',
        content:
          "1. Lire attentivement l'énoncé\\n2. Identifier les données\\n3. Choisir la bonne formule\\n4. Calculer\\n5. Vérifier le résultat"
      },
      {
        title: 'Erreurs fréquentes',
        content:
          "- Oublier les unités\\n- Confondre les formules\\n- Ne pas vérifier le résultat\\n- Aller trop vite"
      }
    ]
  };
}

function buildLocalFlashcards(body) {
  return {
    chapterTitle: body.chapter === 'all' ? 'Révision générale' : body.chapter,
    flashcards: Array.from({ length: 10 }, (_, i) => ({
      question: `Question ${i + 1} sur ${
        body.chapter === 'all' ? 'le programme' : body.chapter
      }`,
      answer:
        'Réponse à compléter avec ton cours. Cette carte est un placeholder généré en mode hors-ligne.'
    }))
  };
}

// ────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ────────────────────────────────────────────────────────────────
module.exports = async function handler(request, response) {
  // ── Méthode ─────────────────────────────────────────────
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  // ── Rate limiting ───────────────────────────────────────
  if (rateLimited(clientIp(request))) {
    return jsonError(response, 429, 'Trop de demandes. Réessaie dans une minute.');
  }

  // ── Authentification ────────────────────────────────────
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

  // ── Body ────────────────────────────────────────────────
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'generate';

  if (!ALLOWED_ACTIONS.has(action)) {
    return jsonError(response, 400, 'Action invalide.');
  }

  // ── Validation matière / chapitre ───────────────────────
  if (!ALLOWED_SUBJECTS.has(body.subject)) {
    return jsonError(response, 400, 'Matière invalide.');
  }

  if (typeof body.chapter !== 'string' || body.chapter.length > 100) {
    return jsonError(response, 400, 'Chapitre invalide.');
  }

  // ── Réservation du quota (uniquement pour 'generate') ───
  let reservation = null;
  if (action === 'generate') {
    try {
      reservation = await reserveFreeGeneration(user.uid);
    } catch (error) {
      console.error('Quota check failed:', error.message);
      return jsonError(
        response,
        503,
        'La vérification de votre quota est temporairement indisponible.'
      );
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
  // ACTION : GÉNÉRATION (fiche ou flashcards)
  // ═══════════════════════════════════════════════════════
  if (action === 'generate') {
    if (!ALLOWED_MODES.has(body.mode)) {
      // Libérer le crédit si mode invalide
      if (reservation?.reserved) {
        try {
          await releaseFreeGeneration(user.uid, reservation.usageDate);
        } catch (_) {}
      }
      return jsonError(response, 400, 'Mode invalide.');
    }

    // ⚡ On prépare le prompt ET le validateur adapté au mode
    const isFlashcard = body.mode === 'flashcard';
    const prompt = isFlashcard
      ? flashcardPrompt(body.subject, body.chapter)
      : fichePrompt(body.subject, body.chapter);
    const validator = isFlashcard ? validateFlashcards : validateFiche;

    // ⚡ generateWithFallback valide chaque réponse DANS la boucle
    const data = await generateWithFallback(prompt, validator);

    return response.status(200).json({
      success: true,
      session: {
        ...data,
        subject: body.subject,
        chapter: body.chapter,
        mode: body.mode,
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
  // ACTION : QUIZ (gratuit — pas de quota)
  // ═══════════════════════════════════════════════════════
  if (action === 'quiz') {
    if (!body.session) {
      return jsonError(response, 400, 'Session manquante.');
    }

    const prompt = quizPrompt(body.subject, body.chapter, body.session);

    // ⚡ Validation DANS la boucle via generateWithFallback
    const data = await generateWithFallback(prompt, validateQuiz, 3000);

    return response.status(200).json({
      success: true,
      quiz: data.quiz
    });
  }

} catch (error) {
  console.error('Réviseur failed:', error.message);

  // ⚡ Libérer le crédit si on l'avait réservé et que la génération échoue
  if (reservation?.reserved && action === 'generate') {
    try {
      await releaseFreeGeneration(user.uid, reservation.usageDate);
      console.log('Crédit libéré suite à une erreur');
    } catch (releaseError) {
      console.error('Erreur libération crédit:', releaseError.message);
    }
  }

  // ── Fallback local pour la génération ──────────────────
  if (action === 'generate') {
    const fallback =
      body.mode === 'flashcard'
        ? buildLocalFlashcards(body)
        : buildLocalFiche(body);

    return response.status(200).json({
      success: true,
      session: {
        ...fallback,
        subject: body.subject,
        chapter: body.chapter,
        mode: body.mode
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

  // ── Quiz en échec total ────────────────────────────────
  return jsonError(
    response,
    503,
    'Le Réviseur est temporairement indisponible. Réessaie.'
  );
}
};
