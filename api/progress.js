// ================================================================
// API PROGRESS v8.0 — ARVEXA School
// Cahier intelligent multi-profils (sans images, sans Vrai/Faux)
// 6 profils : scientifique / svt / philosophie / histoire-geo /
//             francais / langue
// ================================================================

module.exports.config = { maxDuration: 90 };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set([
  'mathematiques', 'physique', 'chimie', 'svt',
  'philosophie', 'histoire-geo', 'francais', 'anglais'
]);

const SUBJECT_INFO = {
  mathematiques: { label: 'Mathématiques', profile: 'scientific' },
  physique:      { label: 'Physique',      profile: 'scientific' },
  chimie:        { label: 'Chimie',        profile: 'scientific' },
  svt:           { label: 'SVT',           profile: 'svt' },
  philosophie:   { label: 'Philosophie',   profile: 'philosophy' },
  'histoire-geo':{ label: 'Histoire-Géo',  profile: 'history' },
  francais:      { label: 'Français',      profile: 'french' },
  anglais:       { label: 'Anglais',       profile: 'language' }
};

const MIN_CONTENT_LENGTH = 40;
const MAX_CONTENT_LENGTH = 15000;

const FREE_SECTION_LIMIT = 5;

let adminServices = null;

// ────────────────────────────────────────────────────────────────
// FIREBASE ADMIN
// ────────────────────────────────────────────────────────────────
function getAdminServices() {
  if (adminServices) return adminServices;

  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials || !credentials.trim()) throw new Error('firebase_admin_not_configured');

  let serviceAccount;
  try { serviceAccount = JSON.parse(credentials); }
  catch (e) { throw new Error('firebase_admin_invalid_json'); }

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
  const status = data.subscriptionStatus || 'none';
  if (status === 'pending') return false;

  const hasPremium = data.premium === true ||
                     data.isUnlocked === true ||
                     data.hasDeposited === true;

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

function todayKey() { return new Date().toISOString().slice(0, 10); }
function monthKey()  { return new Date().toISOString().slice(0, 7); }

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
// NORMALISATION DES ENTRÉES CLAVIER
// ────────────────────────────────────────────────────────────────
function normalizeMathInput(text) {
  if (!text || typeof text !== 'string') return '';
  let r = text;
  r = r.replace(/([a-zA-Z0-9\)])\s*²/g, '$1^2');
  r = r.replace(/([a-zA-Z0-9\)])\s*³/g, '$1^3');
  r = r.replace(/([a-zA-Z0-9\)])\s*⁴/g, '$1^4');
  r = r.replace(/([a-zA-Z0-9\)])\s*⁵/g, '$1^5');
  r = r.replace(/√\s*\(([^)]+)\)/g, 'racine($1)');
  r = r.replace(/√\s*([a-zA-Z0-9]+)/g, 'racine($1)');
  r = r.replace(/≤/g, ' <= ');
  r = r.replace(/≥/g, ' >= ');
  r = r.replace(/≠/g, ' != ');
  r = r.replace(/∞/g, ' infini ');
  r = r.replace(/π/g, ' pi ');
  r = r.replace(/θ/g, ' theta ');
  r = r.replace(/α/g, ' alpha ');
  r = r.replace(/β/g, ' beta ');
  r = r.replace(/Δ/g, ' Delta ');
  r = r.replace(/∑/g, ' somme ');
  r = r.replace(/∫/g, ' integrale ');
  r = r.replace(/→/g, ' tend vers ');
  r = r.replace(/×/g, ' fois ');
  r = r.replace(/÷/g, ' divise par ');
  r = r.replace(/±/g, ' plus ou moins ');
  return r;
}

// ────────────────────────────────────────────────────────────────
// IA — FOURNISSEURS
// ────────────────────────────────────────────────────────────────
function getProviders() {
  return [
    {
      name: 'Groq',
      key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true
    },
    {
      name: 'OpenRouter',
      key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true,
      headers: {
        'HTTP-Referer': process.env.APP_ORIGIN || '',
        'X-Title': 'ARVEXA Notebook'
      }
    },
    {
      name: 'Mistral',
      key: process.env.MISTRAL_API_KEY,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      jsonMode: false
    }
  ].filter((p) => Boolean(p.key));
}

async function callProvider(provider, { systemPrompt, userPrompt, maxTokens = 4000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const body = {
      model: provider.model,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
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

    const rawContent = data?.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error(`${provider.name}: réponse vide`);

    const cleaned = String(rawContent).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      return { raw: cleaned };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function distributeTasks(tasks, providers) {
  return tasks.map((task, i) => ({
    ...task,
    provider: providers[i % providers.length]
  }));
}

async function runParallelTasks(tasks, providers) {
  const assignments = distributeTasks(tasks, providers);

  const results = await Promise.allSettled(
    assignments.map(({ provider, systemPrompt, userPrompt, maxTokens }) =>
      callProvider(provider, { systemPrompt, userPrompt, maxTokens })
    )
  );

  const fallbackedResults = await Promise.all(
    results.map(async (r, i) => {
      if (r.status === 'fulfilled') {
        return { status: 'fulfilled', value: r.value, task: tasks[i], provider: assignments[i].provider.name };
      }

      console.warn(`[FAN-OUT] Tâche "${tasks[i].name}" échouée sur ${assignments[i].provider.name}, fallback...`);

      for (const provider of providers) {
        if (provider.name === assignments[i].provider.name) continue;
        try {
          const value = await callProvider(provider, {
            systemPrompt: tasks[i].systemPrompt,
            userPrompt: tasks[i].userPrompt,
            maxTokens: tasks[i].maxTokens
          });
          return { status: 'fulfilled', value, task: tasks[i], provider: provider.name };
        } catch (e) {
          console.warn(`[FAN-OUT] Fallback ${provider.name} échoué pour "${tasks[i].name}": ${e.message}`);
        }
      }
      return { status: 'rejected', error: r.reason, task: tasks[i], provider: 'none' };
    })
  );

  return fallbackedResults;
}

// ────────────────────────────────────────────────────────────────
// FUSION
// ────────────────────────────────────────────────────────────────
function mergeAnalysis(results, profile) {
  const merged = {
    profile,
    sectionTitle: null,
    explanation: null,
    structure: null,
    questions: [],
    qcm: []
  };

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const data = r.value;
    const taskName = r.task.name;

    switch (taskName) {
      case 'extraction':
        merged.sectionTitle = data.sectionTitle || merged.sectionTitle;
        merged.extracted = data;
        break;
      case 'explanation':
        merged.explanation = data;
        merged.sectionTitle = data.sectionTitle || merged.sectionTitle;
        break;
      case 'structure':
        merged.structure = data;
        break;
      case 'questions':
        merged.questions = data.questions || [];
        break;
      case 'qcm':
        merged.qcm = data.qcm || [];
        break;
    }
  }

  return merged;
}

// ────────────────────────────────────────────────────────────────
// RÈGLES COMMUNES
// ────────────────────────────────────────────────────────────────
const LATEX_RULES = `
RÈGLE LATEX — OBLIGATOIRE :
- Toute formule mathématique DOIT être entre $...$ (inline) ou $$...$$ (display).
- INTERDIT : LaTeX brut sans $ (ex : "v = \\sqrt{x}" doit devenir "$v = \\sqrt{x}$").
- INTERDIT : symboles Unicode mathématiques bruts (π, √, ², ≤, ≥, ∞, →, ×, ·, ≠, ∈, ∑, ∫, Δ).
  Remplacer par $\\pi$, $\\sqrt{}$, $^{2}$, $\\leq$, $\\geq$, $\\infty$, $\\to$, $\\times$, $\\cdot$, $\\neq$, $\\in$, $\\sum$, $\\int$, $\\Delta$.
- Les formules du champ "latex" doivent contenir leurs propres $ (ex : "$z = a + bi$").
`.trim();

const PERIMETER_RULES = `
RÈGLE DE PÉRIMÈTRE STRICT :
- Tu travailles UNIQUEMENT sur la section fournie par l'élève.
- INTERDICTION de mentionner ou poser des questions sur des notions
  qui ne sont PAS dans la section fournie.
- INTERDICTION d'anticiper les autres parties du chapitre.
- INTERDICTION d'utiliser une connaissance externe au texte fourni
  (sauf pour la reformulation et la pédagogie).
`.trim();

// ═══════════════════════════════════════════════════════════════
// PROFIL 1 — SCIENTIFIQUE
// ═══════════════════════════════════════════════════════════════
function buildScientificPrompts({ subjectLabel, rawInput }) {
  const ctx = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction', maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de cours scientifique.

${ctx}

${PERIMETER_RULES}

Extrait UNIQUEMENT les concepts présents dans cette section.

Format JSON :
{
  "sectionTitle": "Titre court (max 60 caractères)",
  "mainConcepts": ["concept 1", "concept 2"],
  "formulas": ["formule 1"],
  "variables": [{"symbol": "x", "meaning": "signification", "unit": "unité si présente"}],
  "definitions": [{"term": "terme", "definition": "définition du cours"}]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation', maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur expert du BAC. Explique cette section comme à un élève qui découvre.

${ctx}

${PERIMETER_RULES}
${LATEX_RULES}

RÈGLE D'EXPLICATION :
- Chaque idée doit être EXPLIQUÉE en français simple.
- Pas de jargon non expliqué.
- Phrases complètes, pas des listes télégraphiques.
- Nombre de parties adapté au contenu (pas de quota).

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que tu dois comprendre en 2-3 phrases simples.",
  "parts": [
    {
      "partTitle": "Partie 1 : ...",
      "mainIdea": "Idée principale",
      "simpleExplanation": "Explication en français simple (3-6 phrases).",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "relations": ["Relation avec d'autres éléments du cours"],
      "example": "Exemple chiffré cohérent avec le cours",
      "toRemember": "Ce qu'il faut absolument retenir"
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Extrait la structure scientifique de cette section.

${ctx}

${PERIMETER_RULES}
${LATEX_RULES}

Ne mets QUE ce qui est présent. Si pas de formule → tableau vide. Si pas d'exemple → tableau vide.

Format JSON :
{
  "formulas": [
    {
      "latex": "$z = a + bi$",
      "description": "Description simple",
      "variables": [{"symbol": "a", "meaning": "partie réelle"}],
      "condition": "condition si présente"
    }
  ],
  "method": {
    "title": "Méthode d'application",
    "steps": ["Étape 1 : ...", "Étape 2 : ..."]
  },
  "examples": [
    {
      "enonce": "Énoncé de l'exemple",
      "steps": ["Étape 1", "Étape 2"],
      "result": "$résultat final$"
    }
  ],
  "traps": [
    {"trap": "Piège classique", "solution": "Comment l'éviter"}
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque de questions basée UNIQUEMENT sur cette section.

${ctx}

${PERIMETER_RULES}
${LATEX_RULES}

RÈGLE DE QUANTITÉ ADAPTATIVE :
- Analyse la richesse de la section.
- ~2 à 3 questions par notion importante identifiée.
- Ne force PAS de quota.
- Chaque question porte sur un élément RÉEL de la section.

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "definition" | "calcul" | "application" | "comprehension" | "analyse",
      "question": "...",
      "answer": "...",
      "mustHave": ["élément indispensable 1"],
      "importance": 1 | 2 | 3
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 3000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des QCM UNIQUEMENT sur cette section.

${ctx}

${PERIMETER_RULES}
${LATEX_RULES}

Nombre adaptatif : ~1 QCM par notion importante.

Format JSON :
{
  "qcm": [
    {
      "question": "...",
      "options": [
        {"id": "A", "text": "..."},
        {"id": "B", "text": "..."},
        {"id": "C", "text": "..."},
        {"id": "D", "text": "..."}
      ],
      "correct": "A",
      "explanation": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══════════════════════════════════════════════════════════════
// PROFIL 2 — SVT
// ═══════════════════════════════════════════════════════════════
function buildSvtPrompts({ subjectLabel, rawInput }) {
  const ctx = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction', maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de SVT.

${ctx}

${PERIMETER_RULES}

RÈGLE SVT : pas de formules. Priorise mécanismes, relations, étapes, définitions.

Format JSON :
{
  "sectionTitle": "...",
  "mainConcepts": ["..."],
  "terms": [{"term": "...", "definition": "..."}],
  "mechanisms": ["mécanisme 1"]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation', maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de SVT. Explique cette section comme à un élève qui découvre.

${ctx}

${PERIMETER_RULES}

RÈGLES SVT :
- Explication EN FRANÇAIS simple.
- Décris chaque MÉCANISME étape par étape.
- Explique les RELATIONS (organe A → organe B, cause → conséquence).
- Pas de formules inventées, pas de calculs inutiles.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que tu dois comprendre en 2-3 phrases.",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "...",
      "terms": [{"term": "...", "meaning": "..."}],
      "mechanism": {
        "description": "Description du mécanisme",
        "steps": ["Étape 1", "Étape 2"]
      },
      "relations": ["relation 1"],
      "toRemember": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 3000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de SVT.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "mechanisms": [
    {
      "name": "...",
      "steps": ["Étape 1", "Étape 2"],
      "relations": ["..."],
      "consequences": ["..."]
    }
  ],
  "definitions": [{"term": "...", "definition": "..."}],
  "classifications": [{"category": "...", "items": ["..."]}]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Banque de questions de SVT sur cette section UNIQUEMENT.

${ctx}

${PERIMETER_RULES}

Quantité adaptative : ~2 à 3 questions par notion importante.

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "definition" | "comprehension" | "mecanisme" | "relation" | "analyse",
      "question": "...",
      "answer": "...",
      "mustHave": ["..."],
      "importance": 1 | 2 | 3
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 3000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM de SVT sur cette section UNIQUEMENT.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [
    {
      "question": "...",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
      "correct": "A",
      "explanation": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══════════════════════════════════════════════════════════════
// PROFIL 3 — PHILOSOPHIE
// ═══════════════════════════════════════════════════════════════
function buildPhilosophyPrompts({ subjectLabel, rawInput }) {
  const ctx = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction', maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de philosophie.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "mainConcepts": ["..."],
  "theses": [{"author": "nom si présent", "thesis": "..."}],
  "arguments": ["..."],
  "objections": ["..."],
  "keyTerms": [{"term": "...", "definition": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation', maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de philosophie. Explique cette section COMME SI L'ÉLÈVE N'Y CONNAISSAIT RIEN.

${ctx}

${PERIMETER_RULES}

RÈGLES PHILO :
- VULGARISE chaque concept philosophique.
- Décompose chaque argument.
- Donne des exemples de la vie quotidienne.
- Situe l'auteur dans son contexte SI présent dans le cours.
- Ne résume PAS : explique en profondeur.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que tu dois comprendre en 2-3 phrases.",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "Explication longue et claire (5-10 phrases).",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "arguments": ["Argument 1", "Argument 2"],
      "everydayExamples": ["Exemple du quotidien 1"],
      "toRemember": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 3000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de philosophie.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "theses": [{"thesis": "...", "arguments": ["..."]}],
  "vocabulary": [{"term": "...", "meaning": "..."}],
  "plans": [{"title": "Plan possible", "parties": ["I. ...", "II. ...", "III. ..."]}]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Questions de philosophie sur cette section UNIQUEMENT.

${ctx}

${PERIMETER_RULES}

Chaque réponse doit être UNE PHRASE complète.

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "definition" | "comprehension" | "explication" | "comparaison" | "argumentation",
      "question": "...",
      "answer": "Une phrase complète.",
      "mustHave": ["..."],
      "importance": 1 | 2 | 3
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM de philosophie sur cette section.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [
    {
      "question": "...",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
      "correct": "A",
      "explanation": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══════════════════════════════════════════════════════════════
// PROFIL 4 — HISTOIRE-GÉO
// ═══════════════════════════════════════════════════════════════
function buildHistoryPrompts({ subjectLabel, rawInput }) {
  const ctx = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction', maxTokens: 1800,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section d'histoire-géographie.

${ctx}

${PERIMETER_RULES}

Extrait UNIQUEMENT les FAITS.

Format JSON :
{
  "sectionTitle": "...",
  "dates": [{"date": "...", "event": "..."}],
  "persons": [{"name": "...", "role": "..."}],
  "places": [{"place": "...", "stake": "..."}],
  "events": [{"event": "...", "date": "..."}],
  "causes": ["..."],
  "consequences": ["..."]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation', maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Présente cette section d'histoire-géo de manière CLAIRE et CONCISE.

${ctx}

${PERIMETER_RULES}

RÈGLE : résumé bref (5-10 phrases max) + accent sur les faits.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Résumé en 5-8 phrases.",
  "context": "...",
  "keyFacts": ["fait 1", "fait 2"]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section d'histoire-géo.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "timeline": [{"date": "...", "event": "..."}],
  "causesConsequences": [{"cause": "...", "consequence": "..."}],
  "keyFigures": [{"name": "...", "role": "..."}],
  "vocabulary": [{"term": "...", "meaning": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `BANQUE MASSIVE de questions d'histoire-géo sur cette section.

${ctx}

${PERIMETER_RULES}

RÈGLE HIST-GÉO : génère le MAX de questions sur les faits.
- 3 à 4 questions par fait important.
- Toutes les dates → au moins 1 question.
- Tous les personnages → au moins 1 question.

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "date" | "personnage" | "evenement" | "cause" | "consequence" | "analyse",
      "question": "...",
      "answer": "...",
      "mustHave": ["..."],
      "importance": 1 | 2 | 3
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM d'histoire-géo sur cette section.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [
    {
      "question": "...",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
      "correct": "A",
      "explanation": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══════════════════════════════════════════════════════════════
// PROFIL 5 — FRANÇAIS
// ═══════════════════════════════════════════════════════════════
function buildFrenchPrompts({ subjectLabel, rawInput }) {
  const ctx = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction', maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de français.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "mainConcepts": ["..."],
  "texts": [{"title": "...", "author": "..."}],
  "literaryDevices": ["..."],
  "movements": ["..."],
  "keyTerms": [{"term": "...", "definition": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation', maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de français. Explique cette section clairement.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "...",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "...",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "toRemember": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de français.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "literaryDevices": [{"name": "...", "definition": "...", "example": "..."}],
  "vocabulary": [{"term": "...", "meaning": "..."}],
  "texts": [{"title": "...", "author": "...", "analysis": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Questions de français sur cette section.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "definition" | "analyse" | "comprehension",
      "question": "...",
      "answer": "Une phrase complète.",
      "mustHave": ["..."],
      "importance": 1 | 2 | 3
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM de français.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [
    {
      "question": "...",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
      "correct": "A",
      "explanation": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══════════════════════════════════════════════════════════════
// PROFIL 6 — LANGUE (Anglais)
// ═══════════════════════════════════════════════════════════════
function buildLanguagePrompts({ subjectLabel, rawInput }) {
  const ctx = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction', maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section d'anglais.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "vocabulary": [{"english": "word", "french": "traduction"}],
  "grammarRules": [{"rule": "...", "explanation": "..."}],
  "structures": ["structure 1"],
  "keyTerms": [{"term": "...", "definition": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation', maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur d'anglais pour des FRANCOPHONES DÉBUTANTS.

${ctx}

${PERIMETER_RULES}

RÈGLES LANGUE :
- EXPLICATIONS TOUJOURS EN FRANÇAIS.
- EXEMPLES EN ANGLAIS avec TRADUCTION SYSTÉMATIQUE.
- Grammaire expliquée comme à un débutant.
- Vocabulaire : chaque mot anglais → traduction → exemple.
- Signale les pièges pour francophones.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que tu dois comprendre (en français).",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "Explication EN FRANÇAIS.",
      "keyTerms": [{"english": "word", "french": "traduction", "example": "example sentence"}],
      "examples": [{"english": "English sentence.", "french": "Traduction."}],
      "commonMistakes": [{"mistake": "erreur fréquente", "correction": "correction"}],
      "toRemember": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 3000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section d'anglais.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "vocabulary": [{"english": "...", "french": "...", "phonetic": "..."}],
  "grammar": [{"rule": "...", "explanation_fr": "...", "examples": [{"english": "...", "french": "..."}]}],
  "phrases": [{"english": "...", "french": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Questions d'anglais (en français pour la compréhension).

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "vocabulary" | "grammar" | "translation" | "comprehension",
      "question": "...",
      "answer": "...",
      "mustHave": ["..."],
      "importance": 1 | 2 | 3
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM d'anglais.

${ctx}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [
    {
      "question": "...",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
      "correct": "A",
      "explanation": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ────────────────────────────────────────────────────────────────
// SÉLECTION DU PROFIL
// ────────────────────────────────────────────────────────────────
function getPromptsForProfile(profile, context) {
  switch (profile) {
    case 'scientific': return buildScientificPrompts(context);
    case 'svt':        return buildSvtPrompts(context);
    case 'philosophy': return buildPhilosophyPrompts(context);
    case 'history':    return buildHistoryPrompts(context);
    case 'french':     return buildFrenchPrompts(context);
    case 'language':   return buildLanguagePrompts(context);
    default:           return buildScientificPrompts(context);
  }
}

// ────────────────────────────────────────────────────────────────
// POST-TRAITEMENT
// ────────────────────────────────────────────────────────────────
function wrapOrphanLatex(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.includes('$')) return text;
  let r = text;
  r = r.replace(/(\\[a-zA-Z]+(?:\{[^}]*\}){1,2})/g, ' $$$1$$ ');
  r = r.replace(/(\\[a-zA-Z]+)(?![a-zA-Z{]|\$)/g, ' $$$1$$ ');
  r = r.replace(/([_^]\{[^}]*\})/g, ' $$$1$$ ');
  r = r.replace(/\${3,}/g, '$$').replace(/\$\s*\$/g, '').replace(/\s+/g, ' ').trim();
  return r;
}

function deepClean(obj) {
  if (typeof obj === 'string') return wrapOrphanLatex(obj);
  if (Array.isArray(obj)) return obj.map(deepClean);
  if (obj && typeof obj === 'object') {
    const cleaned = {};
    for (const k in obj) cleaned[k] = deepClean(obj[k]);
    return cleaned;
  }
  return obj;
}

// ────────────────────────────────────────────────────────────────
// FALLBACK
// ────────────────────────────────────────────────────────────────
function buildFallbackAnalysis({ rawInput, profile }) {
  return {
    profile,
    sectionTitle: 'Section',
    explanation: {
      sectionTitle: 'Section',
      understanding: 'Analyse indisponible. Réessaie plus tard.',
      parts: [{
        partTitle: 'Contenu fourni',
        mainIdea: '',
        simpleExplanation: rawInput.slice(0, 500),
        keyTerms: [],
        toRemember: ''
      }]
    },
    structure: null,
    questions: [],
    qcm: [],
    fallback: true
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
// ACTIONS
// ═══════════════════════════════════════════════════════════════
async function getDashboard(uid) {
  const { db } = getAdminServices();
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
      chaptersCount: chapters.length,
      sectionsCount: totalSubjectSections,
      last: chapters[0]?.last || ''
    });
  }

  subjects.sort((a, b) => b.sectionsCount - a.sectionsCount);
  const streak = await computeStreak(uid);

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
    summary: { subjectsCount: subjects.length, totalChapters, totalSections },
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
    chapter: { id: ref.id, title: cleanTitle, sectionsCount: 0, last: 'à l\'instant' }
  };
}

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
    const qcmCount = Array.isArray(analysis.qcm) ? analysis.qcm.length : 0;

    return {
      id: d.id,
      title: s.title || 'Section',
      questionsCount,
      qcmCount,
      time: formatRelativeDate(s.createdAt)
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

async function createSection(uid, body) {
  const { subject, chapterId, rawInput } = body;

  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };
  if (!rawInput || typeof rawInput !== 'string') throw { status: 400, message: 'Contenu manquant.' };

  const trimmed = rawInput.trim();
  if (trimmed.length < MIN_CONTENT_LENGTH) {
    throw { status: 400, message: `Contenu trop court (min ${MIN_CONTENT_LENGTH} caractères).` };
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    throw { status: 400, message: `Contenu trop long (max ${MAX_CONTENT_LENGTH}).` };
  }

  const quota = await checkSectionQuota(uid);
  if (!quota.allowed) {
    throw {
      status: 429,
      message: `Limite gratuite atteinte (${quota.limit} sections/mois). Passe à Premium.`,
      code: 'FREE_SECTION_LIMIT'
    };
  }

  const { db, FieldValue } = getAdminServices();

  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) throw { status: 404, message: 'Chapitre introuvable.' };

  const info = SUBJECT_INFO[subject];
  const subjectLabel = info.label;
  const profile = info.profile;

  const normalizedInput = normalizeMathInput(trimmed);

  const context = { subjectLabel, rawInput: normalizedInput };
  const tasks = getPromptsForProfile(profile, context);
  const providers = getProviders();

  if (!providers.length) {
    throw { status: 503, message: 'Aucun fournisseur IA disponible.' };
  }

  console.log(`[FAN-OUT] ${tasks.length} tâches, ${providers.length} fournisseurs pour profil "${profile}"`);

  const results = await runParallelTasks(tasks, providers);
  let analysis = mergeAnalysis(results, profile);
  analysis = deepClean(analysis);

  const hasContent = analysis.explanation || analysis.questions.length > 0;
  if (!hasContent) {
    console.warn('[FAN-OUT] Tout a échoué → fallback');
    analysis = buildFallbackAnalysis({ rawInput: normalizedInput, profile });
  }

  const sectionRef = chapterRef.collection('sections').doc();
  const sectionId = sectionRef.id;

  await sectionRef.set({
    title: analysis.sectionTitle || analysis.explanation?.sectionTitle || 'Section',
    rawInput: trimmed,
    profile,
    analysis,
    userNotes: '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

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
      rawInput: trimmed,
      profile,
      analysis,
      userNotes: ''
    },
    meta: {
      profile,
      tasksCount: tasks.length,
      providersUsed: results.filter((r) => r.status === 'fulfilled').map((r) => r.provider)
    }
  };
}

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
      profile: s.profile || 'scientific',
      analysis: s.analysis || {},
      userNotes: s.userNotes || '',
      createdAt: toISO(s.createdAt),
      time: formatRelativeDate(s.createdAt)
    }
  };
}

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
    userNotes: userNotes.slice(0, 8000),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true };
}

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

  const sectionsSnap = await chapterRef.collection('sections').get();
  const batch = db.batch();
  sectionsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(chapterRef);
  await batch.commit();

  return { success: true };
}

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
      profile: s.profile || 'scientific',
      analysis: s.analysis || {},
      userNotes: s.userNotes || ''
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
// HANDLER
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

  console.log(`[PROGRESS v8] ${action} | uid=${uid.slice(0, 8)}`);

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
    console.error(`[PROGRESS v8] "${action}" failed:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
