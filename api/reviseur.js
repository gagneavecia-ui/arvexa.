// ================================================================
// API RÉVISEUR v4.0 — ARVEXA School
// Moteur pédagogique complet et garanti
//
// Objectif : RIEN NE MANQUE, RIEN N'EST IMPOSSIBLE
//   - Fiches ultra-riches (6 sections obligatoires par notion)
//   - Flashcards typées (définition, formule, méthode, piège)
//   - Quiz à 5 niveaux de difficulté
//   - Exercices à 4 niveaux + corrections détaillées
//   - Cache partagé Firestore (généré 1 fois, servi à tous)
//   - Adaptation au niveau de maîtrise de l'élève
//   - Fallback local enrichi (utilise le JSON directement)
//   - Génération par lots parallèles (robuste)
// ================================================================

const fs = require('fs');
const path = require('path');

module.exports.config = { maxDuration: 60 };

// ════════════════════════════════════════════════════════════════
// SECTION 1 — CONFIGURATION
// ════════════════════════════════════════════════════════════════
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestLog = new Map();

const FREE_REVISEUR_LIMIT = 2;

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);
const ALLOWED_ACTIONS = new Set(['generate', 'quiz', 'exercises']);

const MAX_TOKENS = {
  FICHE: 8000,
  FLASHCARDS: 4000,
  QUIZ: 4000,
  EXERCISES: 8000
};

const NOTION_BATCH_SIZE = 4;      // notions par requête IA
const MAX_BATCHES = 8;            // limite de sécurité
const KNOWLEDGE_CACHE_COLLECTION = 'knowledgeCache';

// Cache mémoire (évite les relectures disque)
const KNOWLEDGE_MEMORY_CACHE = new Map();

// Services Firebase Admin
let adminServices = null;

// ════════════════════════════════════════════════════════════════
// SECTION 2 — FIREBASE ADMIN
// ════════════════════════════════════════════════════════════════
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
    FieldValue: admin.firestore.FieldValue
  };

  return adminServices;
}

// ════════════════════════════════════════════════════════════════
// SECTION 3 — BASE DE CONNAISSANCES
// ════════════════════════════════════════════════════════════════
function loadKnowledgeBase(subject) {
  if (KNOWLEDGE_MEMORY_CACHE.has(subject)) {
    return KNOWLEDGE_MEMORY_CACHE.get(subject);
  }

  const filename = `bac-${subject}.json`;
  const filePath = path.join(process.cwd(), filename);

  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[REVISEUR] Base absente : ${filename}`);
      KNOWLEDGE_MEMORY_CACHE.set(subject, null);
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    console.log(`[REVISEUR] ✅ Base chargée : ${filename} (${data.chapitres?.length || 0} chapitres)`);
    KNOWLEDGE_MEMORY_CACHE.set(subject, data);
    return data;
  } catch (error) {
    console.error(`[REVISEUR] Erreur chargement ${filename}:`, error.message);
    KNOWLEDGE_MEMORY_CACHE.set(subject, null);
    return null;
  }
}

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findChapter(knowledgeBase, chapterName) {
  if (!knowledgeBase || !chapterName) return null;

  const target = normalizeText(chapterName);

  for (const ch of knowledgeBase.chapitres || []) {
    if (normalizeText(ch.titre) === target || normalizeText(ch.id) === target) {
      return ch;
    }
  }

  for (const ch of knowledgeBase.chapitres || []) {
    const chNorm = normalizeText(ch.titre);
    if (chNorm.includes(target) || target.includes(chNorm)) {
      return ch;
    }
  }

  return null;
}

function getMandatoryNotions(chapter) {
  if (!chapter || !Array.isArray(chapter.notions)) return [];
  return chapter.notions.filter((n) => n.obligatoire !== false);
}

function isNotionCovered(notion, sections) {
  if (!Array.isArray(sections)) return false;
  const notionIdNorm = normalizeText(notion.id);
  const notionTitleNorm = normalizeText(notion.titre);

  return sections.some((section) => {
    const sectionTitle = section.title || section.titre || '';
    const sectionTitleNorm = normalizeText(sectionTitle);
    const sectionContentNorm = normalizeText(section.content || section.notionTitle || '');

    if (sectionTitleNorm.includes(notionTitleNorm)) return true;
    if (notionTitleNorm.includes(sectionTitleNorm) && sectionTitleNorm.length > 4) return true;
    if (sectionContentNorm.includes(notionIdNorm)) return true;
    if (section.notionId && section.notionId === notion.id) return true;

    return false;
  });
}

// ════════════════════════════════════════════════════════════════
// SECTION 4 — UTILITAIRES
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

function hashString(str) {
  let hash = 5381;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return Math.abs(hash).toString(36);
}

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// ════════════════════════════════════════════════════════════════
// SECTION 5 — QUOTAS
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
    if (isPremiumUser(userSnapshot.data())) {
      return { premium: true, reserved: false, usageDate };
    }

    const used = Number(usageSnapshot.data()?.count || 0);
    if (used >= FREE_REVISEUR_LIMIT) {
      return { premium: false, reserved: false, limitReached: true, used, usageDate };
    }

    transaction.set(usageRef, {
      count: used + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return { premium: false, reserved: true, usageDate, used: used + 1 };
  });
}

async function releaseFreeGeneration(uid, usageDate) {
  if (!usageDate) return;
  const { db, FieldValue } = getAdminServices();
  const usageRef = db.collection('users').doc(uid).collection('reviseurUsage').doc(usageDate);
  try {
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(usageRef);
      const used = Math.max(0, Number(snap.data()?.count || 0) - 1);
      transaction.set(usageRef, {
        count: used,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
// SECTION 6 — PROVIDERS IA
// ════════════════════════════════════════════════════════════════
function getProviders() {
  return [
    {
      name: 'Groq',
      key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      supportsJsonMode: true,
      timeout: 45000,
      headers: {}
    },
    {
      name: 'OpenRouter',
      key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      supportsJsonMode: true,
      timeout: 50000,
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
      supportsJsonMode: false,
      timeout: 45000,
      headers: {}
    }
  ].filter((p) => Boolean(p.key));
}

async function callProvider(provider, prompt, maxTokens) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeout || 45000);

  try {
    const body = {
      model: provider.model,
      temperature: 0.25,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: 'Tu es un professeur expert du BAC au Niger. Tu produis EXCLUSIVEMENT du JSON valide, sans markdown, sans texte avant ou après. Toute formule mathématique est en LaTeX entre $...$ (inline) ou $$...$$ (display).'
        },
        { role: 'user', content: prompt }
      ]
    };

    if (provider.supportsJsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const result = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.key}`,
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

      if (!validator || validator(data)) {
        console.log(`[AI] ✅ ${provider.name} a répondu valide`);
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
// SECTION 7 — CACHE PARTAGÉ FIRESTORE
// ════════════════════════════════════════════════════════════════
function buildCacheKey(subject, chapter, mode, notionIds, level) {
  const notionHash = hashString((notionIds || []).join('-'));
  return `${subject}_${cleanId(chapter)}_${mode}_${level}_${notionHash}`;
}

async function getSharedCache(subject, chapter, mode, notionIds, level) {
  try {
    const { db } = getAdminServices();
    const key = buildCacheKey(subject, chapter, mode, notionIds, level);
    const ref = db.collection(KNOWLEDGE_CACHE_COLLECTION).doc(key);
    const snap = await ref.get();
    if (!snap.exists) return null;

    const data = snap.data();
    if (!data.content) return null;

    // Cache valide 90 jours
    const cachedAt = data.cachedAt?.toDate?.() || data.cachedAt;
    if (cachedAt) {
      const ageDays = (Date.now() - new Date(cachedAt).getTime()) / (24 * 60 * 60 * 1000);
      if (ageDays > 90) return null;
    }

    // Incrémenter compteur d'utilisation en arrière-plan (non bloquant)
    ref.update({ usedCount: (data.usedCount || 0) + 1 }).catch(() => {});

    return data.content;
  } catch (error) {
    console.warn('[CACHE] Lecture échouée:', error.message);
    return null;
  }
}

async function setSharedCache(subject, chapter, mode, notionIds, level, content, quality) {
  try {
    const { db, FieldValue } = getAdminServices();
    const key = buildCacheKey(subject, chapter, mode, notionIds, level);
    const ref = db.collection(KNOWLEDGE_CACHE_COLLECTION).doc(key);

    await ref.set({
      subject,
      chapter,
      mode,
      level,
      notionIds,
      content,
      quality: quality || 'ai',
      cachedAt: FieldValue.serverTimestamp(),
      usedCount: FieldValue.increment(1)
    }, { merge: true });
  } catch (error) {
    console.warn('[CACHE] Écriture échouée:', error.message);
  }
}

// ════════════════════════════════════════════════════════════════
// SECTION 8 — ADAPTATION AU NIVEAU DE MAÎTRISE
// ════════════════════════════════════════════════════════════════
async function getUserMasteryMap(uid, notionIds) {
  const { db } = getAdminServices();
  const map = {};

  try {
    const chunks = chunk(notionIds, 10);
    for (const batch of chunks) {
      const snap = await db.collection('users').doc(uid).collection('mastery')
        .where('__name__', 'in', batch)
        .get()
        .catch(() => ({ docs: [] }));

      snap.docs.forEach((d) => {
        const m = d.data();
        map[d.id] = {
          score: Number(m.score) || 0,
          attempts: Number(m.totalAttempts) || 0,
          lastAt: m.lastAttemptAt?.toDate?.() || null
        };
      });
    }
  } catch (error) {
    console.warn('[MASTERY] Lecture échouée:', error.message);
  }

  return map;
}

function computeAdaptiveLevel(masteryMap, notionIds) {
  if (!notionIds || notionIds.length === 0) return 'standard';

  const scores = notionIds
    .map((id) => masteryMap[id]?.score)
    .filter((s) => typeof s === 'number');

  if (scores.length === 0) return 'bases'; // aucune donnée → on part des bases

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  if (avg < 40) return 'bases';
  if (avg < 75) return 'standard';
  return 'avance';
}

function getLevelPromptInstructions(level) {
  switch (level) {
    case 'bases':
      return `
NIVEAU : BASES (élève en difficulté)
- Utilise un vocabulaire SIMPLE et accessible
- Décompose CHAQUE étape
- Exemples TRÈS détaillés avec chiffres simples
- Rappelle les prérequis au début de chaque section
- Prévois un exemple "ultra-simple" PUIS un exemple "simple"
- Plus d'analogies concrètes
- Ne va PAS au-delà du programme de base`;

    case 'avance':
      return `
NIVEAU : AVANCÉ (élève qui maîtrise)
- Va droit au but, pas de rappel de base
- Focalise-toi sur les CAS LIMITES et pièges subtils
- Exemples de niveau BAC et au-delà
- Ajoute des RACCOURCIS et astuces d'expert
- Inclus des liens avec d'autres chapitres
- Propose des exercices de SYNTHÈSE
- Fais des remarques de type "ce que le correcteur attend"`;

    default:
      return `
NIVEAU : STANDARD
- Équilibre entre théorie et pratique
- Exemples clairs avec étapes numérotées
- Méthodes pas-à-pas standard
- Pièges classiques du BAC`;
  }
}

// ════════════════════════════════════════════════════════════════
// SECTION 9 — PROMPTS ULTRA-RICHES
// ════════════════════════════════════════════════════════════════

// ── Helper : sérialiser une notion pour le prompt
function serializeNotion(notion, index) {
  const lines = [];
  lines.push(`─────────── NOTION ${index + 1} ───────────`);
  lines.push(`id: ${notion.id}`);
  lines.push(`titre: ${notion.titre}`);
  if (notion.description) lines.push(`description: ${notion.description}`);

  if (Array.isArray(notion.formules) && notion.formules.length > 0) {
    lines.push(`FORMULES (à intégrer obligatoirement) :`);
    notion.formules.forEach((f) => lines.push(`  • ${f}`));
  }

  if (Array.isArray(notion.proprietes) && notion.proprietes.length > 0) {
    lines.push(`PROPRIÉTÉS (à intégrer) :`);
    notion.proprietes.forEach((p) => lines.push(`  • ${p}`));
  }

  if (Array.isArray(notion.methodes) && notion.methodes.length > 0) {
    lines.push(`MÉTHODES (à intégrer) :`);
    notion.methodes.forEach((m) => lines.push(`  • ${m}`));
  }

  if (Array.isArray(notion.erreurs_frequentes) && notion.erreurs_frequentes.length > 0) {
    lines.push(`ERREURS FRÉQUENTES (à inclure dans pièges) :`);
    notion.erreurs_frequentes.forEach((e) => lines.push(`  • ${e}`));
  }

  if (Array.isArray(notion.pieges_examen) && notion.pieges_examen.length > 0) {
    lines.push(`PIÈGES EXAMEN (à inclure) :`);
    notion.pieges_examen.forEach((p) => lines.push(`  • ${p}`));
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// PROMPT FICHE — 6 sections obligatoires par notion
// ────────────────────────────────────────────────────────────────
function buildFichePrompt(subjectLabel, chapterTitle, notions, level) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const notionCount = notions.length;
  const levelInstructions = getLevelPromptInstructions(level);

  return `Tu es un professeur expert du BAC au Niger, spécialisé en ${subjectLabel} pour la Terminale D.

MISSION : Générer une FICHE DE RÉVISION ULTRA-RICHE pour le chapitre "${chapterTitle}".
${levelInstructions}

═══════════════════════════════════════════════════════════════
NOTIONS À COUVRIR (${notionCount} notions)
═══════════════════════════════════════════════════════════════
${notionsSerialized}

═══════════════════════════════════════════════════════════════
RÈGLES ABSOLUES
═══════════════════════════════════════════════════════════════
1. Tu DOIS générer EXACTEMENT ${notionCount} sections (une par notion ci-dessus)
2. Tu DOIS intégrer OBLIGATOIREMENT toutes les formules fournies
3. Tu DOIS intégrer OBLIGATOIREMENT toutes les propriétés fournies
4. Tu DOIS intégrer OBLIGATOIREMENT toutes les méthodes fournies
5. Tu DOIS intégrer OBLIGATOIREMENT les erreurs et pièges fournis
6. Chaque section doit contenir les 6 blocs :
   🎯 comprendre (intuition + définition)
   📐 formules (avec conditions d'application)
   🧮 methode (étapes numérotées)
   ✅ exempleResolu (énoncé + étapes + conclusion)
   ⚠️ piegeBAC (l'erreur #1 à éviter + comment l'éviter)
   💡 astuce (mnémotechnique ou raccourci)

═══════════════════════════════════════════════════════════════
RÈGLES LATEX — ABSOLUMENT OBLIGATOIRES
═══════════════════════════════════════════════════════════════
- Formule inline : $...$  → "Soit $f(x) = x^2$"
- Formule display : $$...$$ → "$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$"
- JAMAIS de symboles Unicode bruts :
  ❌ π → ✅ $\\pi$
  ❌ √2 → ✅ $\\sqrt{2}$
  ❌ x² → ✅ $x^{2}$
  ❌ 1/2 → ✅ $\\frac{1}{2}$
  ❌ → → ✅ $\\to$
  ❌ ∫ → ✅ $\\int$
  ❌ ≤ → ✅ $\\leq$
  ❌ ∞ → ✅ $\\infty$
  ❌ Δ → ✅ $\\Delta$
- Commandes autorisées : \\frac, \\sqrt, ^{}, _{}, \\lim, \\int, \\sum, \\sin, \\cos, \\tan, \\ln, \\log, \\alpha...\\omega, \\times, \\div, \\leq, \\geq, \\neq, \\infty, \\to, \\Rightarrow, \\Leftrightarrow

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "chapterTitle": "${chapterTitle}",
  "level": "${level}",
  "sections": [
    {
      "notionId": "id-exact-de-la-notion",
      "notionTitle": "Titre exact de la notion",
      "comprendre": "Texte de 3-5 phrases : intuition puis définition formelle. Utilise $LaTeX$ si besoin.",
      "formules": [
        {
          "latex": "$z = a + bi$",
          "condition": "Pour tout $a, b \\in \\mathbb{R}$",
          "usage": "Définit tout nombre complexe"
        }
      ],
      "methode": {
        "title": "Titre court de la méthode",
        "steps": [
          "1. Première étape concrète",
          "2. Deuxième étape",
          "3. Vérification finale"
        ]
      },
      "exempleResolu": {
        "enonce": "Énoncé complet et concret",
        "etapes": [
          "Étape 1 : on identifie...",
          "Étape 2 : on calcule...",
          "Étape 3 : on conclut..."
        ],
        "conclusion": "$|z| = 5$"
      },
      "piegeBAC": {
        "trap": "L'erreur classique : confondre partie réelle et imaginaire",
        "solution": "Toujours noter Re(z) = a et Im(z) = b avant de calculer"
      },
      "astuce": "Astuce courte, mnémotechnique ou raccourci"
    }
  ],
  "keyPoints": [
    "Point clé 1 transversal au chapitre",
    "Point clé 2",
    "Point clé 3",
    "Point clé 4",
    "Point clé 5"
  ],
  "examTraps": [
    { "trap": "Piège transversal 1", "solution": "Comment l'éviter" }
  ],
  "commonMistakes": [
    "Erreur fréquente 1 (globale)",
    "Erreur fréquente 2"
  ],
  "recap": [
    "Récap final 1 : l'essentiel à retenir",
    "Récap final 2"
  ]
}

CONTRAINTES FINALES :
- EXACTEMENT ${notionCount} sections
- Aucune section vide
- Aucun "à compléter"
- Chaque exemple résolu doit être COMPLET et chiffré
- Réponds UNIQUEMENT avec le JSON`;
}

// ────────────────────────────────────────────────────────────────
// PROMPT FLASHCARDS — 4 par notion, typées
// ────────────────────────────────────────────────────────────────
function buildFlashcardsPrompt(subjectLabel, chapterTitle, notions, level) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const notionCount = notions.length;
  const cardsPerNotion = 4;
  const totalCards = notionCount * cardsPerNotion;
  const levelInstructions = getLevelPromptInstructions(level);

  return `Tu es un professeur expert du BAC au Niger. Tu crées des FLASHCARDS de mémorisation active.

Chapitre : "${chapterTitle}" — ${subjectLabel}
${levelInstructions}

═══════════════════════════════════════════════════════════════
NOTIONS À COUVRIR (${notionCount} notions × ${cardsPerNotion} flashcards = ${totalCards} flashcards)
═══════════════════════════════════════════════════════════════
${notionsSerialized}

═══════════════════════════════════════════════════════════════
RÈGLES ABSOLUES
═══════════════════════════════════════════════════════════════
1. Génère EXACTEMENT ${totalCards} flashcards (${cardsPerNotion} par notion)
2. Pour CHAQUE notion, génère exactement 4 flashcards, une de chaque TYPE :
   - "definition" : question sur la définition/le concept
   - "formule" : question sur une formule à retenir
   - "methode" : question sur la méthode/le processus
   - "piege" : question sur l'erreur fréquente ou le piège BAC
3. Question COURTE (max 120 caractères)
4. Réponse CONCISE (max 250 caractères)
5. Chaque flashcard doit avoir un notionId valide
6. Hint utile ou null

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Formule inline : $...$ / Display : $$...$$
- JAMAIS de symboles Unicode bruts
- Exemples : "$\\frac{1}{2}$", "$x^{2}$", "$\\pi$"

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "chapterTitle": "${chapterTitle}",
  "level": "${level}",
  "flashcards": [
    {
      "notionId": "id-notion",
      "type": "definition",
      "question": "Qu'est-ce qu'un nombre complexe sous forme algébrique ?",
      "answer": "Un nombre de la forme $z = a + bi$ avec $a, b \\in \\mathbb{R}$ et $i^2 = -1$.",
      "hint": "Regarde la partie réelle et imaginaire",
      "difficulty": 1
    },
    {
      "notionId": "id-notion",
      "type": "formule",
      "question": "Comment calcule-t-on le module de $z = a + bi$ ?",
      "answer": "$|z| = \\sqrt{a^2 + b^2}$",
      "hint": null,
      "difficulty": 1
    },
    {
      "notionId": "id-notion",
      "type": "methode",
      "question": "Étapes pour calculer un argument ?",
      "answer": "1) Calculer $|z|$. 2) $\\cos\\theta = a/|z|$, $\\sin\\theta = b/|z|$. 3) Identifier $\\theta$ modulo $2\\pi$.",
      "hint": "Pense aux valeurs remarquables",
      "difficulty": 2
    },
    {
      "notionId": "id-notion",
      "type": "piege",
      "question": "Piège fréquent sur les arguments ?",
      "answer": "Oublier le modulo $2\\pi$ dans la réponse finale.",
      "hint": null,
      "difficulty": 2
    }
  ]
}

CONTRAINTES FINALES :
- EXACTEMENT ${totalCards} flashcards
- 4 types différents PAR notion
- difficulty entre 1 et 3
- Réponds UNIQUEMENT avec le JSON`;
}

// ────────────────────────────────────────────────────────────────
// PROMPT QUIZ — 5 niveaux de difficulté
// ────────────────────────────────────────────────────────────────
function buildQuizPrompt(subjectLabel, chapterTitle, notions, level, questionCount) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const levelInstructions = getLevelPromptInstructions(level);

  return `Tu es un professeur expert du BAC au Niger. Tu crées un QUIZ à choix multiples.

Chapitre : "${chapterTitle}" — ${subjectLabel}
${levelInstructions}

═══════════════════════════════════════════════════════════════
NOTIONS À TESTER
═══════════════════════════════════════════════════════════════
${notionsSerialized}

═══════════════════════════════════════════════════════════════
RÈGLES ABSOLUES
═══════════════════════════════════════════════════════════════
1. Génère EXACTEMENT ${questionCount} questions
2. CHAQUE question a un NIVEAU (level : 1 à 5) :
   - Niveau 1 : Reconnaissance (définition, formule directe)
   - Niveau 2 : Application directe (calcul simple)
   - Niveau 3 : Combinaison (2 notions ensemble)
   - Niveau 4 : Niveau BAC (raisonnement complet)
   - Niveau 5 : Piège / synthèse (détecter l'erreur, cas limite)
3. Répartis les questions sur les 5 niveaux (au moins 1 par niveau)
4. CHAQUE question a exactement 4 options (A, B, C, D)
5. UNE SEULE bonne réponse
6. Chaque question a un notionId valide
7. Chaque question indique quelle méthode est testée

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Formule inline : $...$ / Display : $$...$$
- JAMAIS de symboles Unicode bruts

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "chapterTitle": "${chapterTitle}",
  "level": "${level}",
  "quiz": [
    {
      "notionId": "id-notion",
      "level": 1,
      "question": "Quelle est la partie réelle de $z = 3 + 4i$ ?",
      "options": [
        { "id": "A", "text": "3" },
        { "id": "B", "text": "4" },
        { "id": "C", "text": "$3+4i$" },
        { "id": "D", "text": "$4i$" }
      ],
      "correctAnswer": "A",
      "explanation": "La partie réelle de $z = a + bi$ est $a$, donc ici $3$.",
      "methodTested": "Identifier la partie réelle"
    },
    {
      "notionId": "id-notion",
      "level": 3,
      "question": "Résoudre $z^2 = -4$ dans $\\mathbb{C}$",
      "options": [
        { "id": "A", "text": "$z = 2i$" },
        { "id": "B", "text": "$z = \\pm 2i$" },
        { "id": "C", "text": "$z = -2$" },
        { "id": "D", "text": "Pas de solution" }
      ],
      "correctAnswer": "B",
      "explanation": "$z^2 = -4 = 4i^2$, donc $z = \\pm 2i$.",
      "methodTested": "Résolution d'équation dans ℂ"
    }
  ]
}

CONTRAINTES FINALES :
- EXACTEMENT ${questionCount} questions
- Au moins 1 question par niveau (1 à 5)
- 4 options par question
- Réponds UNIQUEMENT avec le JSON`;
}

// ────────────────────────────────────────────────────────────────
// PROMPT EXERCICES — 4 niveaux par notion
// ────────────────────────────────────────────────────────────────
function buildExercisesPrompt(subjectLabel, chapterTitle, notions, level) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const notionCount = notions.length;
  const exercisesPerNotion = 4;
  const totalExercises = notionCount * exercisesPerNotion;
  const levelInstructions = getLevelPromptInstructions(level);

  return `Tu es un professeur expert du BAC au Niger. Tu crées des EXERCICES avec corrections détaillées.

Chapitre : "${chapterTitle}" — ${subjectLabel}
${levelInstructions}

═══════════════════════════════════════════════════════════════
NOTIONS À COUVRIR (${notionCount} notions × ${exercisesPerNotion} exercices = ${totalExercises} exercices)
═══════════════════════════════════════════════════════════════
${notionsSerialized}

═══════════════════════════════════════════════════════════════
RÈGLES ABSOLUES
═══════════════════════════════════════════════════════════════
1. Génère EXACTEMENT ${totalExercises} exercices (${exercisesPerNotion} par notion)
2. Pour CHAQUE notion, 4 exercices de niveaux progressifs :
   - Niveau 1 : Application directe (1 étape)
   - Niveau 2 : Combinaison (2-3 étapes)
   - Niveau 3 : Niveau BAC (raisonnement complet)
   - Niveau 4 : Piège / cas limite (subtilité)
3. Chaque exercice a un indice (pour aider sans donner la réponse)
4. Chaque exercice a une correction DÉTAILLÉE étape par étape
5. Points : niveau 1 = 1, niveau 2 = 2, niveau 3 = 3, niveau 4 = 4

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Formule inline : $...$ / Display : $$...$$
- JAMAIS de symboles Unicode bruts

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "chapterTitle": "${chapterTitle}",
  "level": "${level}",
  "exercises": [
    {
      "notionId": "id-notion",
      "level": 1,
      "points": 1,
      "enonce": "Calculer le module de $z = 3 + 4i$.",
      "indice": "Utilise $|z| = \\sqrt{a^2 + b^2}$.",
      "correction": {
        "etapes": [
          "On identifie $a = 3$ et $b = 4$.",
          "On applique $|z| = \\sqrt{a^2 + b^2} = \\sqrt{9 + 16} = \\sqrt{25}$.",
          "On conclut : $|z| = 5$."
        ],
        "reponse": "$|z| = 5$"
      }
    },
    {
      "notionId": "id-notion",
      "level": 4,
      "points": 4,
      "enonce": "Résoudre $z^2 - 2z + 5 = 0$ dans $\\mathbb{C}$.",
      "indice": "Calcule $\\Delta$, puis utilise $\\sqrt{\\Delta}$ en complexe.",
      "correction": {
        "etapes": [
          "$\\Delta = (-2)^2 - 4 \\cdot 1 \\cdot 5 = 4 - 20 = -16$.",
          "$\\sqrt{\\Delta} = \\sqrt{-16} = 4i$.",
          "$z = \\frac{2 \\pm 4i}{2} = 1 \\pm 2i$."
        ],
        "reponse": "$z_1 = 1 + 2i$ et $z_2 = 1 - 2i$."
      }
    }
  ]
}

CONTRAINTES FINALES :
- EXACTEMENT ${totalExercises} exercices
- 4 niveaux progressifs PAR notion
- Chaque correction a au moins 2 étapes
- Réponds UNIQUEMENT avec le JSON`;
}

// ════════════════════════════════════════════════════════════════
// SECTION 10 — VALIDATIONS STRUCTURELLES
// ════════════════════════════════════════════════════════════════
function validateFiche(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.sections) || data.sections.length < 1) return false;

  return data.sections.every((s) =>
    s &&
    typeof s === 'object' &&
    (s.notionId || s.notionTitle) &&
    typeof s.comprendre === 'string' &&
    s.comprendre.length > 20
  );
}

function validateFlashcards(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.flashcards) || data.flashcards.length < 1) return false;

  const validTypes = new Set(['definition', 'formule', 'methode', 'piege']);

  return data.flashcards.every((c) =>
    c &&
    typeof c.question === 'string' &&
    c.question.length > 5 &&
    typeof c.answer === 'string' &&
    c.answer.length > 3 &&
    c.notionId &&
    validTypes.has(c.type)
  );
}

function validateQuiz(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.quiz) || data.quiz.length < 1) return false;

  return data.quiz.every((q) =>
    q &&
    typeof q.question === 'string' &&
    q.question.length > 5 &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    q.options.every((o) => o && o.id && o.text) &&
    ['A', 'B', 'C', 'D'].includes(q.correctAnswer)
  );
}

function validateExercises(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.exercises) || data.exercises.length < 1) return false;

  return data.exercises.every((e) =>
    e &&
    typeof e.enonce === 'string' &&
    e.enonce.length > 10 &&
    e.correction &&
    Array.isArray(e.correction.etapes) &&
    e.correction.etapes.length >= 2
  );
}

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

// ════════════════════════════════════════════════════════════════
// SECTION 11 — FALLBACK LOCAL ENRICHI (utilise le JSON direct)
// ════════════════════════════════════════════════════════════════
function buildFallbackFiche(chapterTitle, notions) {
  const sections = notions.map((n) => {
    const formules = (n.formules || []).map((f) => ({
      latex: f,
      condition: 'Voir cours',
      usage: 'À retenir'
    }));

    const methodeSteps = (n.methodes || []).map((m, i) => `${i + 1}. ${m}`);
    if (methodeSteps.length === 0) {
      methodeSteps.push('1. Lire attentivement la notion');
      methodeSteps.push('2. Identifier les formules clés');
      methodeSteps.push('3. Faire des exercices d\'application');
    }

    const piegeTrap = (n.pieges_examen && n.pieges_examen[0]) ||
      (n.erreurs_frequentes && n.erreurs_frequentes[0]) ||
      'À identifier en révisant';

    return {
      notionId: n.id,
      notionTitle: n.titre,
      comprendre: n.description || `Notion essentielle du chapitre ${chapterTitle}.`,
      formules: formules.length > 0 ? formules : [{ latex: 'À compléter', condition: '', usage: '' }],
      methode: {
        title: 'Méthode d\'application',
        steps: methodeSteps
      },
      exempleResolu: {
        enonce: `Exemple d'application de « ${n.titre} » — à compléter avec ton cours.`,
        etapes: [
          'Étape 1 : Identifier la donnée',
          'Étape 2 : Appliquer la formule',
          'Étape 3 : Vérifier le résultat'
        ],
        conclusion: 'Voir correction détaillée'
      },
      piegeBAC: {
        trap: piegeTrap,
        solution: 'Relire la notion avant chaque exercice'
      },
      astuce: (n.proprietes && n.proprietes[0]) || 'Répète cette notion régulièrement.'
    };
  });

  return {
    chapterTitle,
    level: 'standard',
    sections,
    keyPoints: notions.slice(0, 5).map((n) => n.titre),
    examTraps: notions
      .filter((n) => n.pieges_examen && n.pieges_examen.length > 0)
      .slice(0, 4)
      .map((n) => ({ trap: n.pieges_examen[0], solution: 'Voir le cours' })),
    commonMistakes: notions
      .filter((n) => n.erreurs_frequentes && n.erreurs_frequentes.length > 0)
      .slice(0, 5)
      .map((n) => n.erreurs_frequentes[0]),
    recap: notions.slice(0, 5).map((n) => `Retenir : ${n.titre}`)
  };
}

function buildFallbackFlashcards(chapterTitle, notions, level) {
  const flashcards = [];

  notions.forEach((n) => {
    // 4 types par notion
    flashcards.push({
      notionId: n.id,
      type: 'definition',
      question: `Qu'est-ce que « ${n.titre} » ?`,
      answer: n.description || 'Voir le cours.',
      hint: null,
      difficulty: 1
    });

    flashcards.push({
      notionId: n.id,
      type: 'formule',
      question: `Formule clé de « ${n.titre} » ?`,
      answer: (n.formules && n.formules[0]) || 'Voir le cours.',
      hint: null,
      difficulty: 1
    });

    flashcards.push({
      notionId: n.id,
      type: 'methode',
      question: `Comment appliquer « ${n.titre} » ?`,
      answer: (n.methodes && n.methodes[0]) || 'Voir la méthode dans le cours.',
      hint: null,
      difficulty: 2
    });

    flashcards.push({
      notionId: n.id,
      type: 'piege',
      question: `Piège fréquent sur « ${n.titre} » ?`,
      answer: (n.pieges_examen && n.pieges_examen[0]) ||
        (n.erreurs_frequentes && n.erreurs_frequentes[0]) ||
        'À identifier en révisant.',
      hint: null,
      difficulty: 2
    });
  });

  return { chapterTitle, level, flashcards };
}

function buildFallbackQuiz(chapterTitle, notions, count, level) {
  const questions = [];
  const perNotion = Math.max(1, Math.ceil(count / Math.max(1, notions.length)));

  notions.forEach((n) => {
    const q1 = {
      notionId: n.id,
      level: 1,
      question: `Quel est le bon énoncé pour « ${n.titre} » ?`,
      options: [
        { id: 'A', text: n.description || n.titre },
        { id: 'B', text: 'Aucune réponse ci-dessus' },
        { id: 'C', text: 'À voir dans le cours' },
        { id: 'D', text: 'Toutes les réponses' }
      ],
      correctAnswer: 'A',
      explanation: 'Voir la définition complète dans la fiche.',
      methodTested: 'Reconnaissance de la définition'
    };
    questions.push(q1);

    if (perNotion >= 2 && questions.length < count) {
      questions.push({
        notionId: n.id,
        level: 2,
        question: `Formule principale de « ${n.titre} » ?`,
        options: [
          { id: 'A', text: (n.formules && n.formules[0]) || 'À voir dans le cours' },
          { id: 'B', text: 'Aucune' },
          { id: 'C', text: 'Différente' },
          { id: 'D', text: 'Impossible à exprimer' }
        ],
        correctAnswer: 'A',
        explanation: 'La formule principale est donnée dans la fiche.',
        methodTested: 'Mémorisation de formule'
      });
    }
  });

  return { chapterTitle, level, quiz: questions.slice(0, count) };
}

function buildFallbackExercises(chapterTitle, notions, level) {
  const exercises = [];

  notions.forEach((n) => {
    for (let lvl = 1; lvl <= 4; lvl++) {
      exercises.push({
        notionId: n.id,
        level: lvl,
        points: lvl,
        enonce: `Exercice ${lvl} sur « ${n.titre} » — à compléter avec un énoncé précis.`,
        indice: (n.methodes && n.methodes[0]) || 'Relis la méthode dans la fiche.',
        correction: {
          etapes: [
            `Étape 1 : Identifie la donnée de « ${n.titre} ».`,
            `Étape 2 : Applique ${
              (n.formules && n.formules[0]) || 'la formule principale'
            }.`,
            'Étape 3 : Vérifie le résultat.'
          ],
          reponse: 'Voir la correction complète en cours.'
        }
      });
    }
  });

  return { chapterTitle, level, exercises };
}

// ════════════════════════════════════════════════════════════════
// SECTION 12 — GÉNÉRATION PAR LOTS PARALLÈLES
// ════════════════════════════════════════════════════════════════

// Génère en parallèle par lots de NOTION_BATCH_SIZE
async function generateFicheByBatches(subjectLabel, chapterTitle, notions, level) {
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, MAX_BATCHES);

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const prompt = buildFichePrompt(subjectLabel, chapterTitle, batch, level);
      const data = await generateWithFallback(prompt, validateFiche, MAX_TOKENS.FICHE);
      return { batch, data };
    })
  );

  const allSections = [];
  const missingBatches = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.data?.sections) {
      allSections.push(...r.value.data.sections);
    } else {
      missingBatches.push(batches[i]);
      console.warn(`[FICHE] Batch ${i} échoué:`, r.reason?.message || 'unknown');
    }
  });

  // Traitement des batches échoués via fallback
  const fallbackSections = [];
  missingBatches.forEach((batch) => {
    const fb = buildFallbackFiche(chapterTitle, batch);
    fallbackSections.push(...fb.sections);
  });

  const finalSections = [...allSections, ...fallbackSections];

  // Récupérer les keyPoints / examTraps / commonMistakes du 1er batch valide
  const firstValid = results.find((r) => r.status === 'fulfilled' && r.value?.data);
  const extra = firstValid?.value?.data || {};

  return {
    chapterTitle,
    level,
    sections: finalSections,
    keyPoints: extra.keyPoints || notions.slice(0, 5).map((n) => n.titre),
    examTraps: extra.examTraps || [],
    commonMistakes: extra.commonMistakes || [],
    recap: extra.recap || []
  };
}

async function generateFlashcardsByBatches(subjectLabel, chapterTitle, notions, level) {
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, MAX_BATCHES);

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const prompt = buildFlashcardsPrompt(subjectLabel, chapterTitle, batch, level);
      const data = await generateWithFallback(prompt, validateFlashcards, MAX_TOKENS.FLASHCARDS);
      return { batch, data };
    })
  );

  const allCards = [];
  const missingBatches = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.data?.flashcards) {
      allCards.push(...r.value.data.flashcards);
    } else {
      missingBatches.push(batches[i]);
    }
  });

  missingBatches.forEach((batch) => {
    const fb = buildFallbackFlashcards(chapterTitle, batch, level);
    allCards.push(...fb.flashcards);
  });

  return { chapterTitle, level, flashcards: allCards };
}

async function generateQuizByBatches(subjectLabel, chapterTitle, notions, level, totalCount) {
  const countPerBatch = Math.ceil(totalCount / Math.max(1, Math.min(MAX_BATCHES, chunk(notions, NOTION_BATCH_SIZE).length)));
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, MAX_BATCHES);

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const prompt = buildQuizPrompt(subjectLabel, chapterTitle, batch, level, countPerBatch);
      const data = await generateWithFallback(prompt, validateQuiz, MAX_TOKENS.QUIZ);
      return { batch, data };
    })
  );

  const allQuestions = [];
  const missingBatches = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.data?.quiz) {
      allQuestions.push(...r.value.data.quiz);
    } else {
      missingBatches.push(batches[i]);
    }
  });

  missingBatches.forEach((batch) => {
    const fb = buildFallbackQuiz(chapterTitle, batch, countPerBatch, level);
    allQuestions.push(...fb.quiz);
  });

  return { chapterTitle, level, quiz: allQuestions.slice(0, totalCount) };
}

async function generateExercisesByBatches(subjectLabel, chapterTitle, notions, level) {
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, MAX_BATCHES);

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const prompt = buildExercisesPrompt(subjectLabel, chapterTitle, batch, level);
      const data = await generateWithFallback(prompt, validateExercises, MAX_TOKENS.EXERCISES);
      return { batch, data };
    })
  );

  const allExercises = [];
  const missingBatches = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.data?.exercises) {
      allExercises.push(...r.value.data.exercises);
    } else {
      missingBatches.push(batches[i]);
    }
  });

  missingBatches.forEach((batch) => {
    const fb = buildFallbackExercises(chapterTitle, batch, level);
    allExercises.push(...fb.exercises);
  });

  return { chapterTitle, level, exercises: allExercises };
}

// ════════════════════════════════════════════════════════════════
// SECTION 13 — HANDLER PRINCIPAL
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

  // ═══ Chargement base de connaissances ═══
  const knowledgeBase = loadKnowledgeBase(body.subject);
  const chapterData = knowledgeBase ? findChapter(knowledgeBase, body.chapter) : null;
  const mandatoryNotions = chapterData ? getMandatoryNotions(chapterData) : [];
  const hasKnowledge = mandatoryNotions.length > 0;

  const subjectLabel = knowledgeBase?.matiereLabel ||
    { mathematiques: 'Mathématiques', physique: 'Physique', chimie: 'Chimie', svt: 'SVT' }[body.subject] ||
    body.subject;

  const chapterTitle = chapterData?.titre || body.chapter;

  console.log(`[REVISEUR] ${action} | ${body.subject} > ${body.chapter} | ${mandatoryNotions.length} notions`);

  // ═══ Réservation quota (generate seulement) ═══
  let reservation = null;
  if (action === 'generate') {
    try {
      reservation = await reserveFreeGeneration(user.uid);
    } catch (error) {
      console.error('Quota check failed:', error.message);
      return jsonError(response, 503, 'La vérification du quota est temporairement indisponible.');
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
    // ACTION : GENERATE (fiche ou flashcards)
    // ═══════════════════════════════════════════════════════
    if (action === 'generate') {
      if (!ALLOWED_MODES.has(body.mode)) {
        if (reservation?.reserved) {
          try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
        }
        return jsonError(response, 400, 'Mode invalide.');
      }

      const isFlashcard = body.mode === 'flashcard';

      // ═══ Adaptation au niveau ═══
      const notionIds = mandatoryNotions.map((n) => n.id);
      let level = 'standard';
      if (body.level && body.level !== 'auto') {
        level = body.level;
      } else if (notionIds.length > 0) {
        const masteryMap = await getUserMasteryMap(user.uid, notionIds);
        level = computeAdaptiveLevel(masteryMap, notionIds);
      }

      // ═══ Cache partagé ═══
      const cached = await getSharedCache(
        body.subject,
        body.chapter,
        body.mode,
        notionIds,
        level
      );

      if (cached) {
        console.log('[REVISEUR] ✅ Servi depuis le cache partagé');
        if (!reservation?.premium && reservation?.reserved) {
          // Le cache ne consomme pas le quota
          try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
        }
        return response.status(200).json({
          success: true,
          session: { ...cached, subject: body.subject, chapter: body.chapter, mode: body.mode },
          source: 'cache',
          quota: reservation?.premium
            ? { type: 'premium', unlimited: true }
            : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
        });
      }

      // ═══ Génération ═══
      let session;
      let source = 'ai';

      try {
        if (hasKnowledge) {
          session = isFlashcard
            ? await generateFlashcardsByBatches(subjectLabel, chapterTitle, mandatoryNotions, level)
            : await generateFicheByBatches(subjectLabel, chapterTitle, mandatoryNotions, level);
        } else {
          // Pas de base → fallback local direct
          session = isFlashcard
            ? buildFallbackFlashcards(chapterTitle, [], level)
            : buildFallbackFiche(chapterTitle, []);
          source = 'fallback';
        }
      } catch (aiError) {
        console.warn('[REVISEUR] Tous les batches IA ont échoué:', aiError.message);
        session = hasKnowledge
          ? (isFlashcard
              ? buildFallbackFlashcards(chapterTitle, mandatoryNotions, level)
              : buildFallbackFiche(chapterTitle, mandatoryNotions))
          : (isFlashcard
              ? { chapterTitle, level, flashcards: [] }
              : { chapterTitle, level, sections: [] });
        source = 'fallback';
      }

      // ═══ Mise en cache partagée ═══
      if (hasKnowledge && source === 'ai') {
        setSharedCache(
          body.subject,
          body.chapter,
          body.mode,
          notionIds,
          level,
          session,
          'ai'
        ).catch(() => {});
      }

      return response.status(200).json({
        success: true,
        session: {
          ...session,
          subject: body.subject,
          chapter: body.chapter,
          mode: body.mode,
          generationMode: source,
          notionsCovered: hasKnowledge ? mandatoryNotions.length : 0,
          generatedAt: new Date().toISOString()
        },
        source,
        quota: reservation?.premium
          ? { type: 'premium', unlimited: true }
          : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
      });
    }

    // ═══════════════════════════════════════════════════════
    // ACTION : QUIZ (gratuit, pas de quota)
    // ═══════════════════════════════════════════════════════
    if (action === 'quiz') {
      const count = Math.min(20, Math.max(5, Number(body.count) || 5));

      const notionIds = mandatoryNotions.map((n) => n.id);
      let level = 'standard';
      if (body.level && body.level !== 'auto') {
        level = body.level;
      } else if (notionIds.length > 0) {
        const masteryMap = await getUserMasteryMap(user.uid, notionIds);
        level = computeAdaptiveLevel(masteryMap, notionIds);
      }

      // ═══ Cache ═══
      const cached = await getSharedCache(body.subject, body.chapter, 'quiz', notionIds, level);
      if (cached) {
        console.log('[REVISEUR] Quiz servi depuis cache');
        return response.status(200).json({ success: true, quiz: cached.quiz || [], source: 'cache' });
      }

      // ═══ Génération ═══
      let quizData;
      let source = 'ai';

      try {
        if (hasKnowledge) {
          quizData = await generateQuizByBatches(subjectLabel, chapterTitle, mandatoryNotions, level, count);
        } else {
          quizData = buildFallbackQuiz(chapterTitle, [], count, level);
          source = 'fallback';
        }
      } catch (e) {
        console.warn('[REVISEUR] Quiz IA échoué:', e.message);
        quizData = hasKnowledge
          ? buildFallbackQuiz(chapterTitle, mandatoryNotions, count, level)
          : { chapterTitle, level, quiz: [] };
        source = 'fallback';
      }

      if (hasKnowledge && source === 'ai') {
        setSharedCache(body.subject, body.chapter, 'quiz', notionIds, level, quizData, 'ai').catch(() => {});
      }

      return response.status(200).json({ success: true, quiz: quizData.quiz || [], source });
    }

    // ═══════════════════════════════════════════════════════
    // ACTION : EXERCISES (nouveau — gratuit)
    // ═══════════════════════════════════════════════════════
    if (action === 'exercises') {
      const notionIds = mandatoryNotions.map((n) => n.id);
      let level = 'standard';
      if (body.level && body.level !== 'auto') {
        level = body.level;
      } else if (notionIds.length > 0) {
        const masteryMap = await getUserMasteryMap(user.uid, notionIds);
        level = computeAdaptiveLevel(masteryMap, notionIds);
      }

      const cached = await getSharedCache(body.subject, body.chapter, 'exercises', notionIds, level);
      if (cached) {
        return response.status(200).json({
          success: true,
          exercises: cached.exercises || [],
          source: 'cache'
        });
      }

      let exercisesData;
      let source = 'ai';

      try {
        if (hasKnowledge) {
          exercisesData = await generateExercisesByBatches(subjectLabel, chapterTitle, mandatoryNotions, level);
        } else {
          exercisesData = buildFallbackExercises(chapterTitle, [], level);
          source = 'fallback';
        }
      } catch (e) {
        console.warn('[REVISEUR] Exercices IA échoués:', e.message);
        exercisesData = hasKnowledge
          ? buildFallbackExercises(chapterTitle, mandatoryNotions, level)
          : { chapterTitle, level, exercises: [] };
        source = 'fallback';
      }

      if (hasKnowledge && source === 'ai') {
        setSharedCache(body.subject, body.chapter, 'exercises', notionIds, level, exercisesData, 'ai').catch(() => {});
      }

      return response.status(200).json({
        success: true,
        exercises: exercisesData.exercises || [],
        source
      });
    }

    return jsonError(response, 400, 'Action inconnue.');

  } catch (error) {
    console.error(`Réviseur action "${action}" échouée:`, error.message);
    if (error.stack) console.error(error.stack);

    // Libérer quota si nécessaire
    if (reservation?.reserved && action === 'generate') {
      try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
    }

    return jsonError(response, 503, 'Le Réviseur est temporairement indisponible. Réessaie dans quelques instants.');
  }
};
