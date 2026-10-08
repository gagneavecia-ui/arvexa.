// ================================================================
// API PROGRESS v6.0 — ARVEXA School
// Cahier intelligent multi-profils + fan-out IA + vision
// 6 profils : scientifique / svt / philosophie / histoire-geo /
//             francais / langue
// ================================================================

module.exports.config = { maxDuration: 90 };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;
const requestLog = new Map();

// ────────────────────────────────────────────────────────────────
// CONFIG GLOBALE
// ────────────────────────────────────────────────────────────────
const ALLOWED_SUBJECTS = new Set([
  'mathematiques', 'physique', 'chimie', 'svt',
  'philosophie', 'histoire-geo', 'francais', 'anglais'
]);

const SUBJECT_INFO = {
  mathematiques: { label: 'Mathématiques',  profile: 'scientific' },
  physique:      { label: 'Physique',       profile: 'scientific' },
  chimie:        { label: 'Chimie',         profile: 'scientific' },
  svt:           { label: 'SVT',            profile: 'svt' },
  philosophie:   { label: 'Philosophie',    profile: 'philosophy' },
  'histoire-geo':{ label: 'Histoire-Géo',   profile: 'history' },
  francais:      { label: 'Français',       profile: 'french' },
  anglais:       { label: 'Anglais',        profile: 'language' }
};

const MIN_CONTENT_LENGTH = 40;
const MAX_CONTENT_LENGTH = 15000;

const FREE_SECTION_LIMIT = 5;      // 5 sections/mois pour les gratuits
const FREE_MAX_IMAGES = 3;         // 3 images max par section en gratuit
const PREMIUM_MAX_IMAGES = 10;     // 10 images max par section en premium

const MAX_IMAGE_SIZE_BASE64 = 700 * 1024;      // ~700 Ko base64 par image
const MAX_TOTAL_IMAGES_SIZE = 6 * 1024 * 1024; // 6 Mo total par section

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
function getTextProviders() {
  return [
    {
      name: 'Groq',
      key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true,
      vision: false
    },
    {
      name: 'OpenRouter',
      key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true,
      vision: true,
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
      jsonMode: false,
      vision: false
    }
  ].filter((p) => Boolean(p.key));
}

function getVisionProviders() {
  return getTextProviders().filter((p) => p.vision);
}

// Appel générique — supporte texte ET images
async function callProvider(provider, { systemPrompt, userPrompt, images = [], maxTokens = 4000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    // Construction du contenu (texte + images)
    let content;
    if (images && images.length > 0 && provider.vision) {
      content = [{ type: 'text', text: userPrompt }];
      for (const img of images) {
        content.push({
          type: 'image_url',
          image_url: { url: img.dataUrl }
        });
      }
    } else {
      content = userPrompt;
    }

    const body = {
      model: provider.model,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content }
      ]
    };

    if (provider.jsonMode && !images.length) {
      body.response_format = { type: 'json_object' };
    }

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

    // Si JSON mode attendu, on parse ; sinon on renvoie brut
    const cleaned = String(rawContent).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // Pas de JSON valide → on renvoie { raw: texte }
      return { raw: cleaned };
    }
  } finally {
    clearTimeout(timeout);
  }
}

// Distribution round-robin des tâches
function distributeTasks(tasks, providers) {
  return tasks.map((task, i) => ({
    ...task,
    provider: providers[i % providers.length]
  }));
}

// Exécution parallèle avec fallback
async function runParallelTasks(tasks, providers) {
  const assignments = distributeTasks(tasks, providers);

  const results = await Promise.allSettled(
    assignments.map(({ provider, systemPrompt, userPrompt, images, maxTokens }) =>
      callProvider(provider, { systemPrompt, userPrompt, images, maxTokens })
    )
  );

  // Fallback pour les tâches échouées
  const fallbackedResults = await Promise.all(
    results.map(async (r, i) => {
      if (r.status === 'fulfilled') {
        return { status: 'fulfilled', value: r.value, task: tasks[i], provider: assignments[i].provider.name };
      }

      console.warn(`[FAN-OUT] Tâche "${tasks[i].name}" échouée sur ${assignments[i].provider.name}, fallback...`);

      // Essaie les autres fournisseurs
      for (const provider of providers) {
        if (provider.name === assignments[i].provider.name) continue;
        try {
          const value = await callProvider(provider, {
            systemPrompt: tasks[i].systemPrompt,
            userPrompt: tasks[i].userPrompt,
            images: tasks[i].images,
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
// FUSION FINALE
// ────────────────────────────────────────────────────────────────
function mergeAnalysis(results, profile) {
  const merged = {
    profile,
    sectionTitle: null,
    explanation: null,
    structure: null,
    questions: [],
    qcm: [],
    trueFalse: [],
    imagesAnalysis: []
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
      case 'qcm_tf':
        merged.qcm = data.qcm || [];
        merged.trueFalse = data.trueFalse || [];
        break;
      case 'images':
        merged.imagesAnalysis = data.imagesAnalysis || [];
        break;
    }
  }

  return merged;
}

// ────────────────────────────────────────────────────────────────
// RÈGLES COMMUNES À TOUS LES PROMPTS
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
RÈGLE DE PÉRIMÈTRE STRICT (TRÈS IMPORTANTE) :
- Tu travailles UNIQUEMENT sur la section fournie par l'élève.
- INTERDICTION de mentionner, expliquer ou poser des questions sur des notions
  qui ne sont PAS dans la section fournie.
- INTERDICTION d'anticiper les autres parties du chapitre.
- INTERDICTION d'utiliser une connaissance externe au texte fourni (sauf pour
  la reformulation et la pédagogie).
- Si tu identifies un lien avec une notion absente, ignore-le.
`.trim();

// ────────────────────────────────────────────────────────────────
// PROMPTS PAR PROFIL
// ────────────────────────────────────────────────────────────────

// ═══ PROFIL 1 : SCIENTIFIQUE (Maths, Physique, Chimie) ═══
function buildScientificPrompts({ subjectLabel, rawInput, images }) {
  const baseContext = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
${images.length > 0 ? `IMAGES FOURNIES : ${images.length} image(s) à analyser.` : ''}
`.trim();

  return [
    // Tâche 1 — Extraction des concepts
    {
      name: 'extraction',
      maxTokens: 1500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de cours scientifique.

${baseContext}

${PERIMETER_RULES}

Extrait UNIQUEMENT les concepts présents dans cette section.

Format JSON :
{
  "sectionTitle": "Titre court de la section (max 60 caractères)",
  "mainConcepts": ["concept 1", "concept 2"],
  "formulas": ["formule 1", "formule 2"],
  "variables": [{"symbol": "x", "meaning": "signification", "unit": "unité si présente"}],
  "definitions": [{"term": "terme", "definition": "définition du cours"}],
  "methods": ["méthode 1", "méthode 2"]
}

Réponds UNIQUEMENT avec le JSON.`
    },

    // Tâche 2 — Explication pédagogique
    {
      name: 'explanation',
      maxTokens: 4000,
      images: images.slice(0, 3),
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur expert du BAC. Explique cette section comme à un élève qui découvre.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}

RÈGLE D'EXPLICATION :
- Chaque idée doit être EXPLIQUÉE en français simple.
- Pas de jargon non expliqué.
- Utilise des phrases complètes, pas des listes télégraphiques.
- Nombre de parties = nombre d'idées distinctes dans la section.
- Ne force PAS un nombre fixe de parties : adapte-toi au contenu.

${images.length > 0 ? `
RÈGLE IMAGES :
- Analyse les images fournies.
- Décris ce qu'elles montrent.
- Relie-les au texte.
- Explique les schémas, montages ou courbes.
` : ''}

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
      "example": "Exemple chiffré complet du cours ou cohérent avec le cours",
      "toRemember": "Ce qu'il faut absolument retenir"
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },

    // Tâche 3 — Structure (formules + méthode + exemples)
    {
      name: 'structure',
      maxTokens: 3500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Extrait la structure scientifique de cette section.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}

Ne mets QUE ce qui est présent dans la section. Si la section ne contient pas de formule,
laisse le tableau vide. Si elle ne contient pas d'exercice, laisse le tableau vide.

Format JSON :
{
  "formulas": [
    {
      "latex": "$z = a + bi$",
      "description": "Description simple",
      "variables": [{"symbol": "a", "meaning": "partie réelle"}],
      "condition": "condition d'application si présente"
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

    // Tâche 4 — Questions
    {
      name: 'questions',
      maxTokens: 4000,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque de questions basée UNIQUEMENT sur cette section.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}

RÈGLE DE QUANTITÉ ADAPTATIVE :
- Analyse la richesse de la section.
- Nombre de questions ≈ 2 à 3 par notion importante identifiée.
- Ne force PAS un quota.
- Si la section est petite → peu de questions (5-8).
- Si la section est riche → beaucoup (15-25).
- Chaque question doit porter sur un élément RÉEL de la section.
- Pas de questions redondantes.

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "definition" | "calcul" | "application" | "comprehension" | "analyse",
      "question": "...",
      "answer": "...",
      "mustHave": ["élément indispensable 1", "élément 2"],
      "importance": 1 | 2 | 3
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },

    // Tâche 5 — QCM + Vrai/Faux
    {
      name: 'qcm_tf',
      maxTokens: 3000,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des QCM et Vrai/Faux UNIQUEMENT sur cette section.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}

Nombre adaptatif : environ 1 QCM par notion importante.

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
  ],
  "trueFalse": [
    {
      "statement": "...",
      "answer": true,
      "justification": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ PROFIL 2 : SVT ═══
function buildSvtPrompts({ subjectLabel, rawInput, images }) {
  const baseContext = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de SVT.

${baseContext}

${PERIMETER_RULES}

RÈGLE SVT : Ce n'est PAS une matière de formules. Priorise :
- les mécanismes biologiques,
- les relations entre organes / structures,
- les étapes,
- les définitions biologiques.

Si la section ne contient pas de formule, N'INVENTE PAS de formule.

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
      name: 'explanation',
      maxTokens: 4500,
      images: images.slice(0, 3),
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de SVT. Explique cette section comme à un élève qui découvre.

${baseContext}

${PERIMETER_RULES}

RÈGLES SVT :
- Explication EN FRANÇAIS simple.
- Décris chaque MÉCANISME étape par étape.
- Explique les RELATIONS (organe A → organe B, cause → conséquence).
- Utilise des termes biologiques précis MAIS explique-les.
- Pas de formules inventées.
- Pas de calculs inutiles.

${images.length > 0 ? `
RÈGLE IMAGES :
- Analyse les schémas d'organes, cycles, coupes, expériences.
- Décris ce que l'image montre.
- Explique le lien avec le texte.
` : ''}

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
      "relations": ["relation 1", "relation 2"],
      "toRemember": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 3000,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de SVT.

${baseContext}

${PERIMETER_RULES}

N'invente JAMAIS de formule. Si la section ne contient pas de formule → tableau vide.

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
      name: 'questions',
      maxTokens: 4000,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque de questions de SVT sur cette section UNIQUEMENT.

${baseContext}

${PERIMETER_RULES}

Quantité adaptative : ~2 à 3 questions par notion importante.

Types : définition, compréhension, mécanisme, relation, comparaison, analyse.

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "definition",
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
      name: 'qcm_tf',
      maxTokens: 3000,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM et Vrai/Faux de SVT sur cette section UNIQUEMENT.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}],
  "trueFalse": [{"statement": "...", "answer": true, "justification": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ PROFIL 3 : PHILOSOPHIE ═══
function buildPhilosophyPrompts({ subjectLabel, rawInput, images }) {
  const baseContext = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de philosophie.

${baseContext}

${PERIMETER_RULES}

RÈGLE PHILO : ce n'est PAS une matière de formules. Priorise :
- les concepts philosophiques,
- les thèses,
- les arguments,
- les objections.

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
      name: 'explanation',
      maxTokens: 5000,
      images: images.slice(0, 3),
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de philosophie. Explique cette section COMME SI L'ÉLÈVE N'Y CONNAISSAIT RIEN.

${baseContext}

${PERIMETER_RULES}

RÈGLES PHILO (explication maximale) :
- VULGARISE chaque concept philosophique.
- Décompose chaque argument.
- Donne des exemples de la vie quotidienne pour illustrer.
- Situe l'auteur dans son contexte SI présent dans le cours.
- Utilise des phrases simples, pas de jargon non expliqué.
- Ne résume PAS : explique en profondeur.
- Nombre de parties adapté à la richesse.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que tu dois comprendre en 2-3 phrases simples.",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "Explication longue et claire (5-10 phrases).",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "arguments": ["Argument 1", "Argument 2"],
      "everydayExamples": ["Exemple du quotidien 1", "Exemple 2"],
      "toRemember": "..."
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 3000,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de philosophie.

${baseContext}

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
      name: 'questions',
      maxTokens: 4000,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des questions de philosophie sur cette section UNIQUEMENT.

${baseContext}

${PERIMETER_RULES}

Types : définition, compréhension, explication, comparaison, argumentation.

Chaque réponse doit être UNE PHRASE complète (pas un mot).

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "definition",
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
      name: 'qcm_tf',
      maxTokens: 2500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM et Vrai/Faux de philosophie sur cette section.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}],
  "trueFalse": [{"statement": "...", "answer": true, "justification": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ PROFIL 4 : HISTOIRE-GÉO ═══
function buildHistoryPrompts({ subjectLabel, rawInput, images }) {
  const baseContext = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1800,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section d'histoire-géographie.

${baseContext}

${PERIMETER_RULES}

Extrait UNIQUEMENT les FAITS présents :
- Dates
- Lieux
- Personnages
- Événements
- Causes
- Conséquences

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
      name: 'explanation',
      maxTokens: 2500,
      images: images.slice(0, 3),
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Présente cette section d'histoire-géo de manière CLAIRE et CONCISE.

${baseContext}

${PERIMETER_RULES}

RÈGLE HIST-GÉO : résumé bref (5-10 phrases max) + accent sur les faits.
PAS d'explication longue comme en philo.

${images.length > 0 ? `
RÈGLE IMAGES :
- Si carte : décris-la, localise, explique les enjeux.
- Si frise : relève les dates.
- Si tableau : décris-le.
` : ''}

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
      name: 'structure',
      maxTokens: 2500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section d'histoire-géo.

${baseContext}

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
      name: 'questions',
      maxTokens: 4500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une BANQUE MASSIVE de questions d'histoire-géo sur cette section.

${baseContext}

${PERIMETER_RULES}

RÈGLE HIST-GÉO : génère le MAX de questions possibles basées sur les faits.
- 3 à 4 questions par fait important.
- Toutes les dates → au moins 1 question.
- Tous les personnages → au moins 1 question.
- Toutes les causes/conséquences → au moins 1 question.

Objectif : l'élève peut se tester sur CHAQUE fait de la section.

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
      name: 'qcm_tf',
      maxTokens: 3500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM et Vrai/Faux d'histoire-géo sur cette section.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}],
  "trueFalse": [{"statement": "...", "answer": true, "justification": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ PROFIL 5 : FRANÇAIS ═══
function buildFrenchPrompts({ subjectLabel, rawInput, images }) {
  const baseContext = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de français.

${baseContext}

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
      name: 'explanation',
      maxTokens: 4000,
      images: images.slice(0, 3),
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de français. Explique cette section clairement.

${baseContext}

${PERIMETER_RULES}

RÈGLES :
- Explication des textes / mouvements / procédés littéraires.
- Vulgarise les figures de style.
- Explique les termes techniques.
- Ne résume pas : explique.

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
      name: 'structure',
      maxTokens: 2500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de français.

${baseContext}

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
      name: 'questions',
      maxTokens: 3500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des questions de français sur cette section.

${baseContext}

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
      name: 'qcm_tf',
      maxTokens: 2500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM et Vrai/Faux de français.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}],
  "trueFalse": [{"statement": "...", "answer": true, "justification": "..."}]
}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ PROFIL 6 : LANGUE (Anglais) ═══
function buildLanguagePrompts({ subjectLabel, rawInput, images }) {
  const baseContext = `
Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════
`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section d'anglais.

${baseContext}

${PERIMETER_RULES}

RÈGLE LANGUE : extraire le vocabulaire, la grammaire, les structures.

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
      name: 'explanation',
      maxTokens: 4500,
      images: images.slice(0, 3),
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur d'anglais pour des FRANCOPHONES DÉBUTANTS.

${baseContext}

${PERIMETER_RULES}

RÈGLES LANGUE (IMPORTANT) :
- EXPLICATIONS TOUJOURS EN FRANÇAIS.
- EXEMPLES EN ANGLAIS avec TRADUCTION SYSTÉMATIQUE.
- Grammaire expliquée comme à un débutant.
- Vocabulaire : chaque mot anglais → traduction → exemple.
- Signale les pièges pour francophones (faux-amis, structures différentes).
- Format exemple : "English example. → Traduction française."

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que tu dois comprendre (en français).",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "Explication EN FRANÇAIS (5-10 phrases).",
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
      name: 'structure',
      maxTokens: 3000,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section d'anglais.

${baseContext}

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
      name: 'questions',
      maxTokens: 3500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des questions d'anglais (en français pour la compréhension).

${baseContext}

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
      name: 'qcm_tf',
      maxTokens: 2500,
      images: [],
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM et Vrai/Faux d'anglais.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}],
  "trueFalse": [{"statement": "...", "answer": true, "justification": "..."}]
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
// IMAGES — VALIDATION
// ────────────────────────────────────────────────────────────────
function validateImages(images, isPremium) {
  if (!Array.isArray(images)) images = [];
  const maxImages = isPremium ? PREMIUM_MAX_IMAGES : FREE_MAX_IMAGES;

  if (images.length > maxImages) {
    throw {
      status: 400,
      message: `Maximum ${maxImages} images par section.`
    };
  }

  const normalized = images.map((img, i) => {
    if (!img || typeof img !== 'object') throw { status: 400, message: `Image ${i + 1} invalide.` };

    const dataUrl = img.dataUrl || '';
    if (!dataUrl.startsWith('data:image/')) {
      throw { status: 400, message: `Image ${i + 1} : format non supporté.` };
    }
    if (dataUrl.length > MAX_IMAGE_SIZE_BASE64) {
      throw { status: 400, message: `Image ${i + 1} trop volumineuse (max ~500 Ko).` };
    }
    return {
      dataUrl,
      caption: (img.caption || '').slice(0, 200)
    };
  });

  const totalSize = normalized.reduce((s, img) => s + img.dataUrl.length, 0);
  if (totalSize > MAX_TOTAL_IMAGES_SIZE) {
    throw { status: 400, message: 'Total des images trop lourd.' };
  }

  return normalized;
}

// ────────────────────────────────────────────────────────────────
// POST-TRAITEMENT (wrap LaTeX orphelins)
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
// FALLBACK LOCAL
// ────────────────────────────────────────────────────────────────
function buildFallbackAnalysis({ rawInput, profile }) {
  return {
    profile,
    sectionTitle: 'Section',
    explanation: {
      sectionTitle: 'Section',
      understanding: 'Analyse automatique indisponible. Contenu brut disponible ci-dessous.',
      parts: [{
        partTitle: 'Contenu',
        mainIdea: 'Contenu fourni',
        simpleExplanation: rawInput.slice(0, 500),
        keyTerms: [],
        toRemember: 'Réessayer plus tard.'
      }]
    },
    structure: null,
    questions: [],
    qcm: [],
    trueFalse: [],
    imagesAnalysis: [],
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
// ACTION 1 — getDashboard
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
    chapter: { id: ref.id, title: cleanTitle, sectionsCount: 0, last: 'à l\'instant' }
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTION 4 — getChapter
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
    const qcmCount = Array.isArray(analysis.qcm) ? analysis.qcm.length : 0;

    return {
      id: d.id,
      title: s.title || 'Section',
      questionsCount,
      qcmCount,
      imagesCount: Array.isArray(s.images) ? s.images.length : 0,
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
// ACTION 5 — createSection (fan-out multi-profils + images)
// ═══════════════════════════════════════════════════════════════
async function createSection(uid, body) {
  const { subject, chapterId, rawInput } = body;
  let { images } = body;

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

  const isPremium = quota.premium;
  const normalizedImages = validateImages(images, isPremium);

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

  // Fan-out : génération des prompts selon le profil
  const context = { subjectLabel, rawInput: normalizedInput, images: normalizedImages };
  const tasks = getPromptsForProfile(profile, context);
  const providers = getTextProviders();

  if (!providers.length) {
    throw { status: 503, message: 'Aucun fournisseur IA disponible.' };
  }

  console.log(`[FAN-OUT] ${tasks.length} tâches, ${providers.length} fournisseurs pour profil "${profile}"`);

  // Exécution parallèle
  const results = await runParallelTasks(tasks, providers);

  // Fusion
  let analysis = mergeAnalysis(results, profile);

  // Post-traitement LaTeX
  analysis = deepClean(analysis);

  // Fallback si rien n'a fonctionné
  const hasContent = analysis.explanation || analysis.questions.length > 0;
  if (!hasContent) {
    console.warn('[FAN-OUT] Tout a échoué → fallback');
    analysis = buildFallbackAnalysis({ rawInput: normalizedInput, profile });
  }

  // Sauvegarde
  const sectionRef = chapterRef.collection('sections').doc();
  const sectionId = sectionRef.id;

  await sectionRef.set({
    title: analysis.sectionTitle || analysis.explanation?.sectionTitle || 'Section',
    rawInput: trimmed,
    profile,
    images: normalizedImages.map((img) => ({ dataUrl: img.dataUrl, caption: img.caption })),
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
      images: normalizedImages,
      userNotes: ''
    },
    meta: {
      profile,
      tasksCount: tasks.length,
      providersUsed: results.filter((r) => r.status === 'fulfilled').map((r) => r.provider)
    }
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
      profile: s.profile || 'scientific',
      analysis: s.analysis || {},
      images: s.images || [],
      userNotes: s.userNotes || '',
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
    userNotes: userNotes.slice(0, 8000),
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
      profile: s.profile || 'scientific',
      analysis: s.analysis || {},
      images: s.images || [],
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

  console.log(`[PROGRESS v6] ${action} | uid=${uid.slice(0, 8)}`);

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
    console.error(`[PROGRESS v6] "${action}" failed:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
