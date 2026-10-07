// ================================================================
// API PROGRESS v5.0 — ARVEXA School
// Cahier de notes intelligent : Matières → Chapitres → Sections
// Approche LaTeX : tout en inline $...$ partout, validation stricte
// ================================================================

module.exports.config = { maxDuration: 60 };

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

const MIN_CONTENT_LENGTH = 40;
const MAX_CONTENT_LENGTH = 15000;
const FREE_SECTION_LIMIT = 5;

const MAX_AI_TOKENS = 6000;

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

function todayKey() { return new Date().toISOString().slice(0, 10); }
function monthKey() { return new Date().toISOString().slice(0, 7); }

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
// NORMALISATION DES ENTRÉES ÉCRITES AU CLAVIER
// ────────────────────────────────────────────────────────────────
function normalizeMathInput(text) {
  if (!text || typeof text !== 'string') return '';

  let result = text;

  // Puissances (Unicode → notation texte)
  result = result.replace(/([a-zA-Z0-9\)])\s*²/g, '$1^2');
  result = result.replace(/([a-zA-Z0-9\)])\s*³/g, '$1^3');
  result = result.replace(/([a-zA-Z0-9\)])\s*⁴/g, '$1^4');
  result = result.replace(/([a-zA-Z0-9\)])\s*⁵/g, '$1^5');
  result = result.replace(/([a-zA-Z0-9\)])\s*⁰/g, '$1^0');
  result = result.replace(/([a-zA-Z0-9\)])\s*¹/g, '$1^1');

  // Racines
  result = result.replace(/√\s*\(([^)]+)\)/g, 'racine($1)');
  result = result.replace(/√\s*([a-zA-Z0-9]+)/g, 'racine($1)');

  // Symboles math → texte
  result = result.replace(/≤/g, ' <= ');
  result = result.replace(/≥/g, ' >= ');
  result = result.replace(/≠/g, ' != ');
  result = result.replace(/∞/g, ' infini ');
  result = result.replace(/π/g, ' pi ');
  result = result.replace(/θ/g, ' theta ');
  result = result.replace(/α/g, ' alpha ');
  result = result.replace(/β/g, ' beta ');
  result = result.replace(/γ/g, ' gamma ');
  result = result.replace(/λ/g, ' lambda ');
  result = result.replace(/μ/g, ' mu ');
  result = result.replace(/σ/g, ' sigma ');
  result = result.replace(/Δ/g, ' Delta ');
  result = result.replace(/∑/g, ' somme ');
  result = result.replace(/∫/g, ' integrale ');
  result = result.replace(/→/g, ' tend vers ');
  result = result.replace(/⇔/g, ' <=> ');
  result = result.replace(/⇒/g, ' => ');
  result = result.replace(/×/g, ' fois ');
  result = result.replace(/÷/g, ' divise par ');
  result = result.replace(/±/g, ' plus ou moins ');
  result = result.replace(/≈/g, ' environ ');

  // Fractions textuelles
  result = result.replace(/(\d+)\s*\/\s*(\d+)/g, '$1 sur $2');

  return result;
}

// ────────────────────────────────────────────────────────────────
// IA — FOURNISSEURS
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
      temperature: 0.25,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: 'Tu produis EXCLUSIVEMENT du JSON valide, sans markdown, sans texte avant ou après. Toute formule mathématique DOIT être entre $...$ (inline) ou $$...$$ (display).'
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
        console.log(`[AI] ${provider.name} OK`);
        return data;
      }
      errors.push(`${provider.name}: structure invalide`);
    } catch (e) {
      errors.push(`${provider.name}: ${e.message}`);
      console.warn(`[AI] ${provider.name}: ${e.message}`);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ────────────────────────────────────────────────────────────────
// POST-TRAITEMENT LATEX
// Enrobe automatiquement les LaTeX orphelins dans les champs texte
// ────────────────────────────────────────────────────────────────
function wrapOrphanLatex(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // Détecte les commandes LaTeX isolées et les entoure de $
  // Ex : "v = \sqrt{GM/R} avec..." → "v = $\sqrt{GM/R}$ avec..."
  // Mais on évite de doubler les délimiteurs existants

  // Cas 1 : passage "text = \command{...} text" hors $
  result = result.replace(
    /([^$]|^)(\\[a-zA-Z]+(?:\{[^}]*\})*(?:[_^]\{[^}]*\})*)/g,
    (match, before, latex) => {
      // Vérifie qu'on n'est pas déjà dans un $...$
      return `${before}$$${latex}$$`;
    }
  );

  // Nettoyage : élimine les $$ $$ vides ou en double
  result = result.replace(/\${3,}/g, '$$');
  result = result.replace(/\$\s*\$/g, '');

  return result;
}

// Valide la structure générale d'une analyse
function validateAnalysis(data, profile) {
  if (!data || typeof data !== 'object') return false;
  if (!data.summary && !data.keyIdeas) return false;

  // Vérification : pas de \ orphelin hors des $...$
  const fieldsToCheck = [
    data.summary,
    ...(Array.isArray(data.keyIdeas) ? data.keyIdeas : []),
    ...(Array.isArray(data.method) ? data.method : []),
    data.trap?.text,
    data.trap?.solution,
    data.example?.enonce,
    ...(Array.isArray(data.example?.steps) ? data.example.steps : []),
    data.example?.result
  ].filter((x) => typeof x === 'string');

  for (const field of fieldsToCheck) {
    // Cherche un \command qui n'est pas entre $...$
    // Méthode : on retire tous les $...$ puis on regarde s'il reste des \
    const withoutMath = field.replace(/\$[^$]*\$/g, '');
    if (/\\[a-zA-Z]/.test(withoutMath)) {
      console.warn(`[VALIDATION] LaTeX orphelin détecté : "${field.slice(0, 80)}"`);
      return false;
    }
  }

  return true;
}

// ────────────────────────────────────────────────────────────────
// RÈGLE LATEX — bloc commun
// ────────────────────────────────────────────────────────────────
const LATEX_RULES = `
═══════════════════════════════════════════════════════════════
RÈGLE LATEX — ABSOLUE, ULTRA-STRICTE, NON NÉGOCIABLE
═══════════════════════════════════════════════════════════════
C'est la règle la plus importante de ta mission. Lis-la 2 fois.

PRINCIPE UNIQUE :
TOUT symbole ou formule mathématique DOIT être entre $ et $.
Un backslash \ SANS $ autour s'affiche EN TEXTE BRUT chez l'élève.

═══════════════════════════════════════════════════════════════
RÈGLE 1 — Délimiteurs obligatoires
═══════════════════════════════════════════════════════════════
Chaque formule commence ET finit par $.

❌ INTERDIT :
"v = \\sqrt{GM/R}"

✅ CORRECT :
"$v = \\sqrt{GM/R}$"

═══════════════════════════════════════════════════════════════
RÈGLE 2 — Le champ formulas[].latex CONTIENT DÉJÀ les $
═══════════════════════════════════════════════════════════════
⚠️ IMPORTANT : le champ "latex" de formulas[] DOIT contenir les $ lui-même.

❌ INTERDIT :
{ "latex": "z = a + bi" }

✅ CORRECT :
{ "latex": "$z = a + bi$" }

Pour les formules affichées en grand, utilise $$ :
{ "latex": "$$z = a + bi$$" }

═══════════════════════════════════════════════════════════════
RÈGLE 3 — Une phrase = plusieurs $...$ si besoin
═══════════════════════════════════════════════════════════════
Chaque formule dans une phrase est entourée séparément.

❌ INTERDIT :
"Le module vaut |z| = \\sqrt{a^2 + b^2} donc..."

✅ CORRECT :
"Le module vaut $|z| = \\sqrt{a^2 + b^2}$ donc..."

═══════════════════════════════════════════════════════════════
RÈGLE 4 — Unités dans \\text{}
═══════════════════════════════════════════════════════════════
Pour les unités, utilise \\text{} :

❌ INTERDIT :
"5 m\\cdot s^{-1}"

✅ CORRECT :
"$5\\ \\text{m}\\cdot\\text{s}^{-1}$"

═══════════════════════════════════════════════════════════════
RÈGLE 5 — Zéro symbole Unicode
═══════════════════════════════════════════════════════════════
INTERDIT : π √ ² ³ ≤ ≥ ∞ → × · ≠ ∈ ∑ ∫ Δ α β θ λ μ
AUTORISÉ : $\\pi$ $\\sqrt{}$ $^{2}$ $^{3}$ $\\leq$ $\\geq$ $\\infty$ $\\to$
          $\\times$ $\\cdot$ $\\neq$ $\\in$ $\\sum$ $\\int$ $\\Delta$
          $\\alpha$ $\\beta$ $\\theta$ $\\lambda$ $\\mu$

═══════════════════════════════════════════════════════════════
RÈGLE 6 — Virgule décimale française
═══════════════════════════════════════════════════════════════
Utilise $6{,}67$ et non $6,67$ (sinon KaTeX ajoute un espace).

═══════════════════════════════════════════════════════════════
VÉRIFICATION OBLIGATOIRE — AVANT DE RÉPONDRE
═══════════════════════════════════════════════════════════════
Passe en revue CHAQUE champ de ton JSON :
1. Y a-t-il un \\ hors des $...$ ? → Corrige.
2. Y a-t-il un symbole Unicode (π, √, ²...) ? → Corrige en LaTeX.
3. Le champ formulas[].latex contient-il bien les $ ?
4. Chaque $ ouvert est-il fermé ?

Si UNE SEULE réponse est "non" → corrige AVANT de répondre.
`;

// ────────────────────────────────────────────────────────────────
// PROMPT SCIENTIFIQUE
// ────────────────────────────────────────────────────────────────
function buildScientificPrompt({ subjectLabel, rawInput }) {
  return `Tu es un professeur expert du BAC au Niger, spécialiste de ${subjectLabel}.

Un élève vient de copier une partie de sa leçon. Ta mission est DOUBLE :
1. Lui expliquer CLAIREMENT cette partie
2. L'ENRICHIR avec les meilleures méthodes, astuces et exercices

═══════════════════════════════════════════════════════════════
CONTENU COLLÉ PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}

${LATEX_RULES}

═══════════════════════════════════════════════════════════════
MISSION
═══════════════════════════════════════════════════════════════
Tu PEUX et DOIS utiliser tes connaissances pour :
- Donner les méthodes LES PLUS RAPIDES et LES PLUS CLAIRES
- Ajouter des astuces de calcul
- Proposer des exemples chiffrés variés
- Signaler les pièges classiques du BAC
- Fournir des EXERCICES progressifs avec CORRECTIONS détaillées

Le contenu de l'élève est le POINT DE DÉPART.
Tu enrichis, tu ne te limites pas.

═══════════════════════════════════════════════════════════════
FORMAT JSON ATTENDU
═══════════════════════════════════════════════════════════════
{
  "sectionTitle": "Titre court (max 60 caractères)",
  "profile": "scientific",
  "summary": "Résumé en 3-4 phrases avec formules inline $...$ si besoin",
  "keyIdeas": [
    "Idée clé 1 avec $formule$ si besoin",
    "Idée clé 2",
    "Idée clé 3"
  ],
  "formulas": [
    {
      "latex": "$z = a + bi$",
      "condition": "avec $a, b \\in \\mathbb{R}$",
      "usage": "Définition"
    }
  ],
  "method": [
    "Étape 1 : description avec $formule$ si besoin",
    "Étape 2 : ...",
    "Étape 3 : ..."
  ],
  "example": {
    "enonce": "Énoncé avec $valeurs$ chiffrées",
    "steps": [
      "Étape 1 : calcul avec $formule$",
      "Étape 2 : ...",
      "Étape 3 : ..."
    ],
    "result": "$z = 4 - i$"
  },
  "trap": {
    "text": "Piège classique au BAC",
    "solution": "Comment l'éviter"
  },
  "exercises": [
    {
      "enonce": "Exercice d'application",
      "indice": "Indice avec $formule$ si besoin",
      "correction": {
        "steps": [
          "Étape 1 avec $calcul$",
          "Étape 2 avec $calcul$"
        ],
        "reponse": "$résultat final$"
      },
      "difficulty": 1
    }
  ]
}

CONTRAINTES :
- keyIdeas : 3 à 5
- formulas : 1 à 5
- method : 2 à 5 étapes
- exercises : 2 à 4 exercices

⚠️ RAPPEL FINAL ULTRA-IMPORTANT :
- Le champ formulas[].latex DOIT contenir les $ (ex: "$z = a + bi$")
- AUCUN \\ hors des $...$ dans les champs texte
- AUCUN symbole Unicode (π, √, ², ≤, ∞, →, ×, ·, ≠)

Réponds UNIQUEMENT avec le JSON`;
}

// ────────────────────────────────────────────────────────────────
// PROMPT LITTÉRAIRE
// ────────────────────────────────────────────────────────────────
function buildLiteraryPrompt({ subjectLabel, rawInput }) {
  return `Tu es un professeur expert du BAC au Niger, spécialiste de ${subjectLabel}.

Un élève vient de copier une partie de sa leçon. Ta mission est STRICTE :
tu dois l'aider à retenir uniquement ce qu'il a collé, sans rien inventer.

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
RÈGLE DE RÉDACTION DES RÉPONSES
═══════════════════════════════════════════════════════════════
- Chaque réponse doit être UNE SEULE PHRASE complète.
- La phrase doit répondre réellement à la question.
- Sujet + verbe + complément obligatoires.
- INTERDICTION d'un mot seul ou d'un bout de phrase.
- INTERDICTION d'un développement de plusieurs paragraphes.

Exemple :
Q : "Qu'est-ce que l'homme ?"
✅ "L'homme est un être vivant qui vit sur la Terre."
❌ "vivant" ou "être vivant"

═══════════════════════════════════════════════════════════════
FORMAT JSON ATTENDU
═══════════════════════════════════════════════════════════════
{
  "sectionTitle": "Titre court (max 60 caractères)",
  "profile": "literary",
  "summary": "Résumé en 3-4 phrases, uniquement à partir du texte",
  "keyIdeas": [
    "Idée directrice 1",
    "Idée directrice 2"
  ],
  "definitions": [
    {
      "term": "Terme",
      "definition": "Une phrase complète qui définit le terme selon le texte",
      "source": "extrait exact du texte élève"
    }
  ],
  "arguments": [
    {
      "thesis": "Thèse du texte",
      "arguments": ["Argument 1", "Argument 2"],
      "source": "extrait exact"
    }
  ],
  "dates": [
    { "date": "Date", "event": "Événement", "source": "extrait" }
  ],
  "vocabulary": [
    { "term": "Mot", "meaning": "Signification", "source": "extrait" }
  ],
  "questions": [
    {
      "q": "Question probable au BAC ?",
      "a": "UNE phrase complète qui répond, tirée du texte",
      "source": "extrait exact du texte élève"
    }
  ]
}

CONTRAINTES :
- keyIdeas : 3 à 5
- definitions : 2 à 6
- questions : 4 à 8 (PRIORITÉ)

⚠️ RAPPEL : si le texte contient des formules ou symboles,
entoure-les de $...$. Sinon reste en texte simple.

Réponds UNIQUEMENT avec le JSON`;
}

// ────────────────────────────────────────────────────────────────
// POST-TRAITEMENT APRÈS IA
// Corrige automatiquement les oublis
// ────────────────────────────────────────────────────────────────
function postProcessAnalysis(analysis, profile) {
  if (!analysis) return analysis;

  // Traite les champs texte : wrap les LaTeX orphelins
  if (typeof analysis.summary === 'string') {
    analysis.summary = wrapOrphanLatex(analysis.summary);
  }

  if (Array.isArray(analysis.keyIdeas)) {
    analysis.keyIdeas = analysis.keyIdeas.map((x) =>
      typeof x === 'string' ? wrapOrphanLatex(x) : x
    );
  }

  if (Array.isArray(analysis.method)) {
    analysis.method = analysis.method.map((x) =>
      typeof x === 'string' ? wrapOrphanLatex(x) : x
    );
  }

  // Formules : s'assurer que chaque latex a ses $
  if (Array.isArray(analysis.formulas)) {
    analysis.formulas = analysis.formulas.map((f) => {
      if (!f || typeof f !== 'object') return f;
      let latex = f.latex || '';
      // Si pas de $, on en ajoute
      if (latex && !latex.includes('$')) {
        f.latex = `$${latex}$`;
      }
      // Condition : wrap orphelins
      if (typeof f.condition === 'string') {
        f.condition = wrapOrphanLatex(f.condition);
      }
      return f;
    });
  }

  // Exemple
  if (analysis.example) {
    if (typeof analysis.example.enonce === 'string') {
      analysis.example.enonce = wrapOrphanLatex(analysis.example.enonce);
    }
    if (Array.isArray(analysis.example.steps)) {
      analysis.example.steps = analysis.example.steps.map((x) =>
        typeof x === 'string' ? wrapOrphanLatex(x) : x
      );
    }
    if (typeof analysis.example.result === 'string') {
      analysis.example.result = wrapOrphanLatex(analysis.example.result);
    }
  }

  // Trap
  if (analysis.trap) {
    if (typeof analysis.trap.text === 'string') {
      analysis.trap.text = wrapOrphanLatex(analysis.trap.text);
    }
    if (typeof analysis.trap.solution === 'string') {
      analysis.trap.solution = wrapOrphanLatex(analysis.trap.solution);
    }
  }

  // Exercices
  if (Array.isArray(analysis.exercises)) {
    analysis.exercises = analysis.exercises.map((ex) => {
      if (typeof ex.enonce === 'string') ex.enonce = wrapOrphanLatex(ex.enonce);
      if (typeof ex.indice === 'string') ex.indice = wrapOrphanLatex(ex.indice);
      if (ex.correction) {
        if (Array.isArray(ex.correction.steps)) {
          ex.correction.steps = ex.correction.steps.map((x) =>
            typeof x === 'string' ? wrapOrphanLatex(x) : x
          );
        }
        if (typeof ex.correction.reponse === 'string') {
          ex.correction.reponse = wrapOrphanLatex(ex.correction.reponse);
        }
      }
      return ex;
    });
  }

  // Questions
  if (Array.isArray(analysis.questions)) {
    analysis.questions = analysis.questions.map((q) => {
      if (typeof q.q === 'string') q.q = wrapOrphanLatex(q.q);
      if (typeof q.a === 'string') q.a = wrapOrphanLatex(q.a);
      return q;
    });
  }

  // Définitions
  if (Array.isArray(analysis.definitions)) {
    analysis.definitions = analysis.definitions.map((d) => {
      if (typeof d.definition === 'string') d.definition = wrapOrphanLatex(d.definition);
      return d;
    });
  }

  // Arguments
  if (Array.isArray(analysis.arguments)) {
    analysis.arguments = analysis.arguments.map((arg) => {
      if (Array.isArray(arg.arguments)) {
        arg.arguments = arg.arguments.map((x) =>
          typeof x === 'string' ? wrapOrphanLatex(x) : x
        );
      }
      return arg;
    });
  }

  return analysis;
}

// ────────────────────────────────────────────────────────────────
// FALLBACK LOCAL
// ────────────────────────────────────────────────────────────────
function buildFallbackAnalysis({ rawInput, profile }) {
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
    vocabulary: []
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
      icon: info.icon,
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
    chapter: {
      id: ref.id,
      title: cleanTitle,
      sectionsCount: 0,
      last: 'à l\'instant'
    }
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
// ACTION 5 — createSection
// ═══════════════════════════════════════════════════════════════
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

  // Normalisation
  const normalizedInput = normalizeMathInput(trimmed);

  // Analyse IA
  let analysis;
  try {
    const prompt = profile === 'scientific'
      ? buildScientificPrompt({ subjectLabel, rawInput: normalizedInput })
      : buildLiteraryPrompt({ subjectLabel, rawInput: normalizedInput });

    analysis = await generateWithFallback(
      prompt,
      (d) => d && typeof d === 'object' && (d.summary || d.keyIdeas),
      MAX_AI_TOKENS
    );

    // Post-traitement : corriger les LaTeX orphelins
    analysis = postProcessAnalysis(analysis, profile);

    // Validation
    if (!validateAnalysis(analysis, profile)) {
      console.warn('[PROGRESS] Validation échouée — on retente une fois');
      const retryData = await generateWithFallback(
        prompt + '\n\n⚠️ ATTENTION : la génération précédente contenait du LaTeX SANS $ autour. Cette fois, VÉRIFIE BIEN que CHAQUE formule est entre $...$.',
        (d) => d && typeof d === 'object' && (d.summary || d.keyIdeas),
        MAX_AI_TOKENS
      );
      analysis = postProcessAnalysis(retryData, profile);
    }

  } catch (aiError) {
    console.warn('[PROGRESS] Fallback local :', aiError.message);
    analysis = buildFallbackAnalysis({ rawInput: normalizedInput, profile });
  }

  const sectionRef = chapterRef.collection('sections').doc();
  const sectionId = sectionRef.id;

  await sectionRef.set({
    title: analysis.sectionTitle || 'Section',
    rawInput: trimmed,
    profile,
    analysis,
    userNotes: '',
    userImages: [],
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
      analysis,
      userNotes: '',
      userImages: []
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
  // Post-traite à la lecture aussi (sécurité pour anciennes sections)
  const analysis = postProcessAnalysis(s.analysis || {}, s.profile || 'scientific');

  return {
    success: true,
    section: {
      id: sectionId,
      title: s.title || 'Section',
      subject,
      chapterId,
      rawInput: s.rawInput || '',
      profile: s.profile || 'scientific',
      analysis,
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
    const analysis = postProcessAnalysis(s.analysis || {}, s.profile || 'scientific');
    return {
      id: d.id,
      title: s.title || 'Section',
      analysis,
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
    if (error.status) return jsonError(response, error.status, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
