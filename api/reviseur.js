// ================================================================
// API RÉVISEUR v6.0 — ARVEXA School
// - Fiche & Flashcards : cache permanent partagé (validé par admin)
// - Quiz : TOUJOURS nouveau (pas de cache + seed aléatoire)
// - Base connaissances : require statique (Vercel-safe)
// - Support chapter = 'all' (programme complet)
// ================================================================

// NOTE : fs/path supprimés — la base est chargée via require statique.

module.exports.config = { maxDuration: 60 };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestLog = new Map();

const FREE_REVISEUR_LIMIT = 2;

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);
const ALLOWED_ACTIONS = new Set(['generate', 'quiz', 'exercises', 'approveCache', 'listPendingCaches']);

const MAX_TOKENS = {
  FICHE: 8000,
  FLASHCARDS: 4000,
  QUIZ: 4000,
  EXERCISES: 8000
};

const NOTION_BATCH_SIZE = 4;
const MAX_BATCHES = 8;
const MAX_NOTIONS_ALL = 24;               // garde-fou pour chapter = 'all'
const KNOWLEDGE_CACHE_COLLECTION = 'knowledgeCache';

const KNOWLEDGE_MEMORY_CACHE = new Map();
let adminServices = null;

// ════════════════════════════════════════════════════════════════
// FIREBASE ADMIN
// ════════════════════════════════════════════════════════════════
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
    FieldValue: admin.firestore.FieldValue
  };
  return adminServices;
}

// ════════════════════════════════════════════════════════════════
// BASE DE CONNAISSANCES — chargement statique (Vercel-safe)
// ════════════════════════════════════════════════════════════════
const KNOWLEDGE_MODULES = {
  mathematiques: () => require('./bac-mathematiques.js')
  // physique:    () => require('./bac-physique.js'),   // décommenter quand le fichier existe
  // chimie:      () => require('./bac-chimie.js'),     // décommenter quand le fichier existe
  // svt:         () => require('./bac-svt.js')         // décommenter quand le fichier existe
};

function extractKnowledge(mod) {
  if (!mod) return null;
  return mod.BAC_MATHEMATIQUES
      || mod.BAC_PHYSIQUE
      || mod.BAC_CHIMIE
      || mod.BAC_SVT
      || (mod.chapitres ? mod : null);
}

function loadKnowledgeBase(subject) {
  if (KNOWLEDGE_MEMORY_CACHE.has(subject)) return KNOWLEDGE_MEMORY_CACHE.get(subject);

  const loader = KNOWLEDGE_MODULES[subject];
  if (!loader) {
    console.warn(`[REVISEUR] Aucun module pour "${subject}"`);
    KNOWLEDGE_MEMORY_CACHE.set(subject, null);
    return null;
  }

  try {
    const mod = loader();
    const data = extractKnowledge(mod);
    if (!data || !Array.isArray(data.chapitres)) {
      console.warn(`[REVISEUR] Base invalide pour "${subject}"`);
      KNOWLEDGE_MEMORY_CACHE.set(subject, null);
      return null;
    }
    console.log(`[REVISEUR] ✅ Base "${subject}" : ${data.chapitres.length} chapitres`);
    KNOWLEDGE_MEMORY_CACHE.set(subject, data);
    return data;
  } catch (err) {
    console.error(`[REVISEUR] ❌ Chargement "${subject}" :`, err.message);
    KNOWLEDGE_MEMORY_CACHE.set(subject, null);
    return null;
  }
}

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00A0\u2000-\u200B]/g, '')
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findChapter(knowledgeBase, chapterName) {
  if (!knowledgeBase || !chapterName) return null;
  const target = normalizeText(chapterName);
  if (!target) return null;

  for (const ch of knowledgeBase.chapitres || []) {
    if (normalizeText(ch.titre) === target || normalizeText(ch.id) === target) return ch;
  }
  for (const ch of knowledgeBase.chapitres || []) {
    const t = normalizeText(ch.titre);
    if (t && (t.includes(target) || target.includes(t))) return ch;
  }
  return null;
}

function getMandatoryNotions(chapter) {
  if (!chapter || !Array.isArray(chapter.notions)) return [];
  return chapter.notions.filter((n) => n.obligatoire !== false);
}

function collectAllNotions(knowledgeBase, max = MAX_NOTIONS_ALL) {
  const all = [];
  for (const ch of knowledgeBase.chapitres || []) {
    for (const n of getMandatoryNotions(ch)) {
      all.push(n);
      if (all.length >= max) return all;
    }
  }
  return all;
}

// ════════════════════════════════════════════════════════════════
// UTILITAIRES
// ════════════════════════════════════════════════════════════════
function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((t) => now - t < WINDOW_MS);
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
  try { return await getAdminServices().auth.verifyIdToken(match[1]); }
  catch (_) { return null; }
}

function isPremiumUser(data) {
  if (!data) return false;
  const active = data.premium === true || data.isUnlocked === true || data.hasDeposited === true;
  if (!active) return false;
  const end = data.subscriptionEndDate?.toDate?.() ||
    (data.subscriptionEndDate?.seconds ? new Date(data.subscriptionEndDate.seconds * 1000) : null);
  return !end || end.getTime() > Date.now();
}

async function isAdmin(uid) {
  try {
    const { db } = getAdminServices();
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return false;
    const data = snap.data();
    return data.role === 'admin' || data.email === 'gagneavecia@gmail.com';
  } catch (_) { return false; }
}

function cleanId(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
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
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

// ════════════════════════════════════════════════════════════════
// QUOTAS
// ════════════════════════════════════════════════════════════════
function getUsageDate() { return new Date().toISOString().slice(0, 10); }

async function reserveFreeGeneration(uid) {
  const { db, FieldValue } = getAdminServices();
  const userRef = db.collection('users').doc(uid);
  const usageDate = getUsageDate();
  const usageRef = userRef.collection('reviseurUsage').doc(usageDate);

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const usageSnapshot = await transaction.get(usageRef);
    if (!userSnapshot.exists) throw new Error('profile_missing');
    if (isPremiumUser(userSnapshot.data())) return { premium: true, reserved: false, usageDate };

    const used = Number(usageSnapshot.data()?.count || 0);
    if (used >= FREE_REVISEUR_LIMIT) return { premium: false, reserved: false, limitReached: true, used, usageDate };

    transaction.set(usageRef, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
      transaction.set(usageRef, { count: used, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
// PROVIDERS IA
// ════════════════════════════════════════════════════════════════
function getProviders() {
  return [
    {
      name: 'Groq', key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      supportsJsonMode: true, timeout: 45000, headers: {}
    },
    {
      name: 'OpenRouter', key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      supportsJsonMode: true, timeout: 50000,
      headers: { 'HTTP-Referer': process.env.APP_ORIGIN || '', 'X-Title': 'ARVEXA School' }
    },
    {
      name: 'Mistral', key: process.env.MISTRAL_API_KEY,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      supportsJsonMode: false, timeout: 45000, headers: {}
    }
  ].filter((p) => Boolean(p.key));
}

async function callProvider(provider, prompt, maxTokens) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeout || 45000);
  try {
    const body = {
      model: provider.model,
      temperature: provider.temperature || 0.25,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: 'Tu es un professeur expert du BAC au Niger. Tu produis EXCLUSIVEMENT du JSON valide, sans markdown. Toute formule mathématique est en LaTeX entre $...$ (inline) ou $$...$$ (display).' },
        { role: 'user', content: prompt }
      ]
    };
    if (provider.supportsJsonMode) body.response_format = { type: 'json_object' };

    const result = await fetch(provider.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}`, ...provider.headers },
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

    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithFallback(prompt, validator, maxTokens = 4000, temperature = 0.25) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const errors = [];
  for (const provider of providers) {
    try {
      provider.temperature = temperature;
      console.log(`[AI] Tentative ${provider.name}...`);
      const data = await callProvider(provider, prompt, maxTokens);
      if (!validator || validator(data)) {
        console.log(`[AI] ✅ ${provider.name} OK`);
        return data;
      }
      errors.push(`${provider.name}: structure invalide`);
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI] ❌ ${provider.name}: ${error.message}`);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ════════════════════════════════════════════════════════════════
// CACHE PERMANENT (fiche + flashcards)
// ════════════════════════════════════════════════════════════════
function buildCacheKey(subject, chapter, mode) {
  return `${subject}_${cleanId(chapter)}_${mode}`;
}

async function getApprovedCache(subject, chapter, mode) {
  try {
    const { db } = getAdminServices();
    const key = buildCacheKey(subject, chapter, mode);
    const ref = db.collection(KNOWLEDGE_CACHE_COLLECTION).doc(key);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (data.status !== 'approved' || !data.content) return null;

    ref.update({ usedCount: (data.usedCount || 0) + 1 }).catch(() => {});
    return data.content;
  } catch (error) {
    console.warn('[CACHE] Lecture échouée:', error.message);
    return null;
  }
}

async function saveCacheAsPending(subject, chapter, mode, content, uid) {
  try {
    const { db, FieldValue } = getAdminServices();
    const key = buildCacheKey(subject, chapter, mode);
    const ref = db.collection(KNOWLEDGE_CACHE_COLLECTION).doc(key);
    const snap = await ref.get();
    if (snap.exists && snap.data().status === 'approved') return;

    await ref.set({
      subject, chapter, mode,
      content,
      status: 'pending',
      generatedBy: uid,
      generatedAt: FieldValue.serverTimestamp(),
      usedCount: 0
    }, { merge: true });
    console.log(`[CACHE] Contenu enregistré en attente: ${key}`);
  } catch (error) {
    console.warn('[CACHE] Écriture échouée:', error.message);
  }
}

async function approveCache(cacheKey) {
  const { db, FieldValue } = getAdminServices();
  await db.collection(KNOWLEDGE_CACHE_COLLECTION).doc(cacheKey).update({
    status: 'approved',
    approvedAt: FieldValue.serverTimestamp()
  });
}

// ════════════════════════════════════════════════════════════════
// PROMPTS
// ════════════════════════════════════════════════════════════════
function serializeNotion(notion, index) {
  const lines = [];
  lines.push(`─── NOTION ${index + 1} ───`);
  lines.push(`id: ${notion.id}`);
  lines.push(`titre: ${notion.titre}`);
  if (notion.description) lines.push(`description: ${notion.description}`);
  if (Array.isArray(notion.formules)) notion.formules.forEach((f) => lines.push(`  • Formule: ${f}`));
  if (Array.isArray(notion.proprietes)) notion.proprietes.forEach((p) => lines.push(`  • Propriété: ${p}`));
  if (Array.isArray(notion.methodes)) notion.methodes.forEach((m) => lines.push(`  • Méthode: ${m}`));
  if (Array.isArray(notion.erreurs_frequentes)) notion.erreurs_frequentes.forEach((e) => lines.push(`  • Erreur: ${e}`));
  if (Array.isArray(notion.pieges_examen)) notion.pieges_examen.forEach((p) => lines.push(`  • Piège: ${p}`));
  return lines.join('\n');
}

// ── PROMPT FICHE ──
function buildFichePrompt(subjectLabel, chapterTitle, notions) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const N = notions.length;

  return `Tu es un professeur expert du BAC au Niger. Génère une FICHE DE RÉVISION ULTRA-DÉTAILLÉE.

Matière : ${subjectLabel}
Chapitre : ${chapterTitle}

═══════════════════════════════════════════════════════════════
NOTIONS À COUVRIR (${N} notions)
═══════════════════════════════════════════════════════════════
${notionsSerialized}

═══════════════════════════════════════════════════════════════
MISSION — GARANTIR 100% DE COUVERTURE
═══════════════════════════════════════════════════════════════
Tu DOIS générer EXACTEMENT ${N} sections (une par notion).
AUCUNE section ne doit être vide.
Chaque section contient les 6 blocs obligatoires.

RÈGLES LATEX :
- Formule inline : $...$ / Display : $$...$$
- JAMAIS de symboles Unicode bruts (π → $\\pi$, √ → $\\sqrt{}$, ² → $^{2}$)

FORMAT DE RÉPONSE (JSON UNIQUEMENT) :
{
  "chapterTitle": "${chapterTitle}",
  "sections": [
    {
      "notionId": "id-exact",
      "notionTitle": "Titre exact",
      "comprendre": "Intuition + définition formelle, 3-5 phrases",
      "formules": [
        { "latex": "$z = a + bi$", "condition": "pour $a,b \\in \\mathbb{R}$", "usage": "Définition" }
      ],
      "methode": {
        "title": "Méthode d'application",
        "steps": ["1. Première étape", "2. Deuxième étape", "3. Vérification"]
      },
      "exempleResolu": {
        "enonce": "Énoncé complet",
        "etapes": ["Étape 1 : ...", "Étape 2 : ...", "Étape 3 : ..."],
        "conclusion": "Résultat final"
      },
      "piegeBAC": {
        "trap": "Erreur classique",
        "solution": "Comment l'éviter"
      },
      "astuce": "Mnémo court"
    }
  ]
}

CONTRAINTES FINALES :
- EXACTEMENT ${N} sections
- Aucune section vide
- Chaque exemple résolu COMPLET et chiffré
- Réponds UNIQUEMENT avec le JSON`;
}

// ── PROMPT FLASHCARDS ──
function buildFlashcardsPrompt(subjectLabel, chapterTitle, notions) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const N = notions.length;
  const total = N * 4;

  return `Tu es un professeur expert du BAC au Niger. Génère ${total} FLASHCARDS (4 par notion).

Matière : ${subjectLabel}
Chapitre : ${chapterTitle}

NOTIONS :
${notionsSerialized}

RÈGLES :
- EXACTEMENT ${total} flashcards
- Pour chaque notion : 4 cartes (type "definition", "formule", "methode", "piege")
- Question max 120 car, réponse max 250 car
- LaTeX entre $...$

FORMAT :
{
  "chapterTitle": "${chapterTitle}",
  "flashcards": [
    { "notionId": "id", "type": "definition", "question": "...", "answer": "...", "hint": null, "difficulty": 1 }
  ]
}
Réponds UNIQUEMENT avec le JSON`;
}

// ── PROMPT QUIZ (avec seed aléatoire) ──
function buildQuizPrompt(subjectLabel, chapterTitle, notions, level, questionCount, seed) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');

  return `Tu es un professeur expert du BAC au Niger. Génère un QUIZ UNIQUE ET VARIÉ.

SEED (numéro de session unique) : ${seed}
Utilise ce seed pour VARIER les questions. À chaque session différente, tu dois générer des questions TOTALEMENT DIFFÉRENTES.

Matière : ${subjectLabel}
Chapitre : ${chapterTitle}
Difficulté : ${level}/4

NOTIONS :
${notionsSerialized}

RÈGLES :
- EXACTEMENT ${questionCount} questions
- 5 niveaux possibles (level 1 à 5)
- 4 options (A, B, C, D)
- UNE SEULE bonne réponse
- Varie les angles d'attaque (calcul direct, piège, application, comparaison...)

RÈGLES LATEX :
- Formule inline : $...$ / Display : $$...$$

FORMAT :
{
  "chapterTitle": "${chapterTitle}",
  "quiz": [
    {
      "notionId": "id",
      "level": 1,
      "question": "...",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
      "correctAnswer": "A",
      "explanation": "..."
    }
  ]
}
Réponds UNIQUEMENT avec le JSON`;
}

// ════════════════════════════════════════════════════════════════
// VALIDATIONS
// ════════════════════════════════════════════════════════════════
function validateFiche(data) {
  return data && Array.isArray(data.sections) && data.sections.length >= 1 &&
    data.sections.every((s) => s && s.notionTitle && typeof s.comprendre === 'string' && s.comprendre.length > 20);
}

function validateFlashcards(data) {
  return data && Array.isArray(data.flashcards) && data.flashcards.length >= 1 &&
    data.flashcards.every((c) => c && c.question && c.answer && c.notionId);
}

function validateQuiz(data) {
  return data && Array.isArray(data.quiz) && data.quiz.length >= 1 &&
    data.quiz.every((q) => q && q.question && Array.isArray(q.options) && q.options.length === 4 &&
      ['A','B','C','D'].includes(q.correctAnswer));
}

// ════════════════════════════════════════════════════════════════
// FALLBACK LOCAL
// ════════════════════════════════════════════════════════════════
function buildFallbackFiche(chapterTitle, notions) {
  const sections = notions.map((n) => {
    const formules = (n.formules || []).map((f) => ({ latex: f, condition: '', usage: '' }));
    const methodeSteps = (n.methodes || []).length > 0 ? n.methodes : ['Lire attentivement', 'Appliquer la formule', 'Vérifier'];
    const piegeTrap = (n.pieges_examen && n.pieges_examen[0]) || (n.erreurs_frequentes && n.erreurs_frequentes[0]) || 'À identifier en révisant';

    return {
      notionId: n.id,
      notionTitle: n.titre,
      comprendre: n.description || `Notion essentielle du chapitre ${chapterTitle}.`,
      formules: formules.length > 0 ? formules : [{ latex: 'À compléter', condition: '', usage: '' }],
      methode: { title: 'Méthode', steps: methodeSteps },
      exempleResolu: {
        enonce: `Exemple d'application de « ${n.titre} »`,
        etapes: ['Identifier les données', 'Appliquer la méthode', 'Vérifier le résultat'],
        conclusion: 'Voir le cours pour plus de détails'
      },
      piegeBAC: { trap: piegeTrap, solution: 'Relire la notion avant chaque exercice' },
      astuce: (n.proprietes && n.proprietes[0]) || 'Répète régulièrement.'
    };
  });

  return { chapterTitle, sections };
}

function buildFallbackFlashcards(chapterTitle, notions) {
  const cards = [];
  notions.forEach((n) => {
    cards.push({ notionId: n.id, type: 'definition', question: `C'est quoi « ${n.titre} » ?`, answer: n.description || 'Voir cours.', hint: null, difficulty: 1 });
    cards.push({ notionId: n.id, type: 'formule', question: `Formule de « ${n.titre} » ?`, answer: (n.formules && n.formules[0]) || 'Voir cours.', hint: null, difficulty: 1 });
    cards.push({ notionId: n.id, type: 'methode', question: `Comment appliquer « ${n.titre} » ?`, answer: (n.methodes && n.methodes[0]) || 'Voir méthode.', hint: null, difficulty: 2 });
    cards.push({ notionId: n.id, type: 'piege', question: `Piège de « ${n.titre} » ?`, answer: (n.pieges_examen && n.pieges_examen[0]) || 'Voir cours.', hint: null, difficulty: 2 });
  });
  return { chapterTitle, flashcards: cards };
}

function buildFallbackQuiz(chapterTitle, notions, count) {
  const quiz = [];
  const pool = notions.length > 0 ? notions : [{ id: 'default', titre: chapterTitle, description: 'Notion du chapitre' }];
  for (let i = 0; i < count; i++) {
    const n = pool[i % pool.length];
    quiz.push({
      notionId: n.id,
      level: 1,
      question: `Question de révision sur « ${n.titre} » (${i + 1})`,
      options: [
        { id: 'A', text: 'Réponse A' },
        { id: 'B', text: 'Réponse B' },
        { id: 'C', text: 'Réponse C' },
        { id: 'D', text: 'Réponse D' }
      ],
      correctAnswer: 'A',
      explanation: 'Quiz de secours — recharge la page pour retenter une génération IA.'
    });
  }
  return { chapterTitle, quiz };
}

// ════════════════════════════════════════════════════════════════
// GÉNÉRATION PAR LOTS
// ════════════════════════════════════════════════════════════════
async function generateFicheByBatches(subjectLabel, chapterTitle, notions) {
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, MAX_BATCHES);
  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const prompt = buildFichePrompt(subjectLabel, chapterTitle, batch);
      const data = await generateWithFallback(prompt, validateFiche, MAX_TOKENS.FICHE, 0.2);
      return { batch, data };
    })
  );

  const allSections = [];
  const missingBatches = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.data?.sections) allSections.push(...r.value.data.sections);
    else missingBatches.push(batches[i]);
  });
  missingBatches.forEach((batch) => {
    const fb = buildFallbackFiche(chapterTitle, batch);
    allSections.push(...fb.sections);
  });

  return { chapterTitle, sections: allSections };
}

async function generateFlashcardsByBatches(subjectLabel, chapterTitle, notions) {
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, MAX_BATCHES);
  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const prompt = buildFlashcardsPrompt(subjectLabel, chapterTitle, batch);
      const data = await generateWithFallback(prompt, validateFlashcards, MAX_TOKENS.FLASHCARDS, 0.25);
      return { batch, data };
    })
  );
  const allCards = [];
  const missingBatches = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.data?.flashcards) allCards.push(...r.value.data.flashcards);
    else missingBatches.push(batches[i]);
  });
  missingBatches.forEach((batch) => {
    const fb = buildFallbackFlashcards(chapterTitle, batch);
    allCards.push(...fb.flashcards);
  });
  return { chapterTitle, flashcards: allCards };
}

async function generateQuizByBatches(subjectLabel, chapterTitle, notions, level, totalCount, seed) {
  const countPerBatch = Math.max(3, Math.ceil(totalCount / 2));
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, 2);

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const prompt = buildQuizPrompt(subjectLabel, chapterTitle, batch, level, countPerBatch, seed);
      const data = await generateWithFallback(prompt, validateQuiz, MAX_TOKENS.QUIZ, 0.7);
      return { batch, data };
    })
  );

  const allQuestions = [];
  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value?.data?.quiz) allQuestions.push(...r.value.data.quiz);
  });

  if (allQuestions.length === 0) {
    console.warn('[REVISEUR] Quiz IA vide → fallback');
    return buildFallbackQuiz(chapterTitle, notions, totalCount);
  }
  return { chapterTitle, quiz: allQuestions.slice(0, totalCount) };
}

// ════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }
  if (rateLimited(clientIp(request))) return jsonError(response, 429, 'Trop de demandes.');

  let user;
  try { user = await verifyFirebaseToken(request); }
  catch (e) { return jsonError(response, 503, 'Service indisponible.'); }
  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'generate';

  if (!ALLOWED_ACTIONS.has(action)) return jsonError(response, 400, 'Action invalide.');
  if (!ALLOWED_SUBJECTS.has(body.subject)) return jsonError(response, 400, 'Matière invalide.');
  if (typeof body.chapter !== 'string' || body.chapter.length > 100) return jsonError(response, 400, 'Chapitre invalide.');

  // ── Admin : approuver un cache ──
  if (action === 'approveCache') {
    const admin = await isAdmin(user.uid);
    if (!admin) return jsonError(response, 403, 'Réservé aux admins.', 'ADMIN_REQUIRED');
    if (!body.cacheKey) return jsonError(response, 400, 'cacheKey requis.');
    try {
      await approveCache(body.cacheKey);
      return response.status(200).json({ success: true });
    } catch (e) {
      return jsonError(response, 500, e.message);
    }
  }

  // ── Admin : lister les caches en attente ──
  if (action === 'listPendingCaches') {
    const admin = await isAdmin(user.uid);
    if (!admin) return jsonError(response, 403, 'Réservé aux admins.', 'ADMIN_REQUIRED');
    try {
      const { db } = getAdminServices();
      const snap = await db.collection(KNOWLEDGE_CACHE_COLLECTION).where('status', '==', 'pending').get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return response.status(200).json({ success: true, items });
    } catch (e) {
      return jsonError(response, 500, e.message);
    }
  }

  // ── Chargement base ──
  const knowledgeBase = loadKnowledgeBase(body.subject);
  const subjectLabel = knowledgeBase?.matiereLabel ||
    { mathematiques: 'Mathématiques', physique: 'Physique', chimie: 'Chimie', svt: 'SVT' }[body.subject] ||
    body.subject;

  if (!knowledgeBase) {
    return jsonError(response, 400, `La matière « ${subjectLabel} » sera bientôt disponible.`, 'SUBJECT_NOT_READY');
  }

  let chapterData = null;
  let mandatoryNotions = [];
  let chapterTitle = body.chapter;

  if (body.chapter === 'all') {
    mandatoryNotions = collectAllNotions(knowledgeBase, MAX_NOTIONS_ALL);
    chapterTitle = 'Programme complet';
    chapterData = { titre: chapterTitle };
  } else {
    chapterData = findChapter(knowledgeBase, body.chapter);
    if (!chapterData) {
      console.warn(`[REVISEUR] Chapitre introuvable: "${body.chapter}"`);
      console.warn(`[REVISEUR] Disponibles:`, (knowledgeBase.chapitres || []).map((c) => c.titre));
      return jsonError(response, 400, `Chapitre « ${body.chapter} » introuvable.`, 'CHAPTER_NOT_FOUND');
    }
    mandatoryNotions = getMandatoryNotions(chapterData);
    chapterTitle = chapterData.titre;
  }

  const hasKnowledge = mandatoryNotions.length > 0;
  console.log(`[REVISEUR] ${action} | ${body.subject} > ${chapterTitle} | ${mandatoryNotions.length} notions`);

  // ── Réservation quota (generate seulement) ──
  let reservation = null;
  if (action === 'generate') {
    try {
      reservation = await reserveFreeGeneration(user.uid);
    } catch (error) {
      return jsonError(response, 503, 'Quota temporairement indisponible.');
    }
    if (reservation.limitReached) {
      return response.status(429).json({
        success: false,
        error: 'Limite gratuite atteinte. Passe à Premium.',
        code: 'FREE_REVISEUR_LIMIT',
        used: reservation.used,
        limit: FREE_REVISEUR_LIMIT
      });
    }
  }

  try {
    // ═══════════════════════════════════════════════════════
    // ACTION : GENERATE (fiche ou flashcards) — CACHÉ
    // ═══════════════════════════════════════════════════════
    if (action === 'generate') {
      if (!ALLOWED_MODES.has(body.mode)) {
        if (reservation?.reserved) { try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {} }
        return jsonError(response, 400, 'Mode invalide.');
      }

      const isFlashcard = body.mode === 'flashcard';

      // 1. Cache approuvé ?
      const cached = await getApprovedCache(body.subject, body.chapter, body.mode);
      if (cached) {
        console.log('[REVISEUR] ✅ Cache approuvé servi');
        if (reservation?.reserved && !reservation?.premium) {
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

      // 2. Génération IA
      let session;
      let source = 'ai';

      try {
        if (hasKnowledge) {
          session = isFlashcard
            ? await generateFlashcardsByBatches(subjectLabel, chapterTitle, mandatoryNotions)
            : await generateFicheByBatches(subjectLabel, chapterTitle, mandatoryNotions);
        } else {
          session = isFlashcard
            ? buildFallbackFlashcards(chapterTitle, [])
            : buildFallbackFiche(chapterTitle, []);
          source = 'fallback';
        }
      } catch (aiError) {
        console.warn('[REVISEUR] IA échouée:', aiError.message);
        session = isFlashcard
          ? buildFallbackFlashcards(chapterTitle, mandatoryNotions)
          : buildFallbackFiche(chapterTitle, mandatoryNotions);
        source = 'fallback';
      }

      // 3. Sauvegarde en pending (validation admin)
      if (hasKnowledge && source === 'ai') {
        saveCacheAsPending(body.subject, body.chapter, body.mode, session, user.uid).catch(() => {});
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
    // ACTION : QUIZ — PAS DE CACHE
    // ═══════════════════════════════════════════════════════
    if (action === 'quiz') {
      const count = Math.min(20, Math.max(5, Number(body.count) || 5));
      const level = Number(body.difficulty) || 2;
      const seed = hashString(Date.now() + '_' + user.uid + '_' + Math.random());

      console.log(`[REVISEUR] Quiz — seed: ${seed}`);

      let quizData;
      let source = 'ai';

      try {
        if (hasKnowledge) {
          quizData = await generateQuizByBatches(subjectLabel, chapterTitle, mandatoryNotions, level, count, seed);
        } else {
          quizData = buildFallbackQuiz(chapterTitle, [], count);
          source = 'fallback';
        }
      } catch (e) {
        console.warn('[REVISEUR] Quiz IA échoué:', e.message);
        quizData = buildFallbackQuiz(chapterTitle, mandatoryNotions, count);
        source = 'fallback';
      }

      return response.status(200).json({
        success: true,
        quiz: quizData.quiz || [],
        source,
        seed
      });
    }

    // ═══════════════════════════════════════════════════════
    // ACTION : EXERCISES — PAS DE CACHE
    // ═══════════════════════════════════════════════════════
    if (action === 'exercises') {
      const seed = hashString(Date.now() + '_' + user.uid);

      let exercisesData = { chapterTitle, exercises: [] };
      let source = 'ai';

      try {
        if (hasKnowledge) {
          const prompt = `Génère 4 exercices progressifs par notion.\nSeed: ${seed}\n\n${mandatoryNotions.map((n, i) => serializeNotion(n, i)).join('\n\n')}\n\nFormat JSON: {"exercises":[{"notionId":"...","level":1,"enonce":"...","indice":"...","correction":{"etapes":["..."],"reponse":"..."}}]}`;
          const data = await generateWithFallback(prompt, (d) => d && Array.isArray(d.exercises), MAX_TOKENS.EXERCISES, 0.6);
          exercisesData = { chapterTitle, exercises: data.exercises || [] };
        } else {
          source = 'fallback';
        }
      } catch (e) {
        console.warn('[REVISEUR] Exercices IA échoué:', e.message);
        source = 'fallback';
      }

      return response.status(200).json({ success: true, exercises: exercisesData.exercises || [], source, seed });
    }

    return jsonError(response, 400, 'Action inconnue.');

  } catch (error) {
    console.error(`Action "${action}" échouée:`, error.message);
    if (reservation?.reserved && action === 'generate') {
      try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
    }
    return jsonError(response, 503, 'Service temporairement indisponible.');
  }
};
