// ================================================================
// API EXAM v2.0 — ARVEXA School
// Génération + Correction d'examens
// Aligné sur le niveau de progress.js :
//   - Fan-out multi-providers (Groq / OpenRouter / Mistral)
//   - Mode cahier (utilise les sections de l'élève)
//   - 2 sujets différenciés (Consolidation / Approfondissement)
//   - Prompt enrichi et pédagogique
//   - Correction hybride (QCM déterministe + texte IA)
// ================================================================

module.exports.config = { maxDuration: 90 };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set(['Mathématiques', 'Physique', 'Chimie', 'SVT', 'Français']);
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'bac']);
const ALLOWED_DURATIONS = new Set([30, 60, 90, 120, 180]);
const REQUIRED_EXERCISES = 5;
const QUESTIONS_PER_EXERCISE = 10;
const FREE_EXAM_LIMIT = 2;

let adminServices = null;

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
    console.error('[EXAM AUTH] failed:', error.message);
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

// ⚡ Normalise matière exam → clé cahier
function examSubjectToNotebookKey(examSubject) {
  const map = {
    'Mathématiques': 'mathematiques',
    'Physique': 'physique',
    'Chimie': 'chimie',
    'SVT': 'svt',
    'Français': 'francais',
    'Philosophie': 'philosophie',
    'Histoire-Géographie': 'histoire-geo',
    'Anglais': 'anglais'
  };
  return map[examSubject] || null;
}

// ⚡ Normalise matière → clé pour stockage
function normalizeSubjectKey(raw) {
  if (!raw) return null;
  const s = String(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z_]/g, '');

  const map = {
    mathematiques: 'mathematiques', maths: 'mathematiques', math: 'mathematiques',
    physique: 'physique', physiques: 'physique',
    chimie: 'chimie',
    svt: 'svt',
    francais: 'francais',
    anglais: 'anglais',
    philosophie: 'philosophie', philo: 'philosophie',
    histoire_geo: 'histoire_geo', histoiregeo: 'histoire_geo'
  };
  return map[s] || s;
}

// ⚡ Détection floue de chapitre
function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findChapterFuzzy(chapters, targetTitle) {
  if (!Array.isArray(chapters) || !targetTitle) return null;
  const target = normalizeText(targetTitle);
  if (!target) return null;

  for (const c of chapters) {
    if (normalizeText(c.title) === target) return c;
  }

  if (target.length > 3) {
    for (const c of chapters) {
      const t = normalizeText(c.title);
      if (t.length > 3 && (t.includes(target) || target.includes(t))) {
        return c;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// CHARGEMENT DU CONTEXTE CAHIER
// ═══════════════════════════════════════════════════════════════
async function loadNotebookContext(uid, subject, chapterId, chapterTitle) {
  const { db } = getAdminServices();
  const notebookKey = examSubjectToNotebookKey(subject);
  if (!notebookKey) return null;

  let actualChapterId = chapterId;
  let chapterData = null;

  if (chapterId) {
    const chapterRef = db
      .collection('users').doc(uid)
      .collection('notebooks').doc(notebookKey)
      .collection('chapters').doc(chapterId);
    const snap = await chapterRef.get();
    if (snap.exists) {
      chapterData = { id: chapterId, ...snap.data() };
    }
  }

  if (!chapterData && chapterTitle) {
    const chaptersSnap = await db
      .collection('users').doc(uid)
      .collection('notebooks').doc(notebookKey)
      .collection('chapters')
      .get()
      .catch(() => ({ docs: [] }));

    const allChapters = chaptersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const found = findChapterFuzzy(allChapters, chapterTitle);
    if (found) {
      chapterData = found;
      actualChapterId = found.id;
    }
  }

  if (!chapterData) return null;

  const sectionsSnap = await db
    .collection('users').doc(uid)
    .collection('notebooks').doc(notebookKey)
    .collection('chapters').doc(actualChapterId)
    .collection('sections')
    .orderBy('createdAt', 'asc')
    .get();

  if (sectionsSnap.docs.length === 0) return null;

  const sections = sectionsSnap.docs.map((d) => {
    const s = d.data();
    return {
      id: d.id,
      title: s.title || 'Section',
      rawInput: s.rawInput || '',
      analysis: s.analysis || {}
    };
  });

  // Construire un texte lisible pour le prompt
  const contentText = sections.map((s, i) => {
    let text = `━━━ SECTION ${i + 1} : ${s.title} ━━━\n`;
    text += `Contenu source :\n${s.rawInput.slice(0, 3000)}\n\n`;

    const a = s.analysis || {};
    if (a.explanation?.understanding) {
      text += `À comprendre : ${a.explanation.understanding}\n`;
    }
    if (Array.isArray(a.explanation?.parts)) {
      a.explanation.parts.forEach((p) => {
        text += `\n• ${p.partTitle || 'Partie'} :\n`;
        if (p.mainIdea) text += `  Idée : ${p.mainIdea}\n`;
        if (p.simpleExplanation) text += `  Explication : ${p.simpleExplanation}\n`;
        if (p.toRemember) text += `  À retenir : ${p.toRemember}\n`;
      });
    }
    if (Array.isArray(a.questions)) {
      text += `\nQuestions déjà posées :\n`;
      a.questions.forEach((q, j) => {
        text += `  Q${j + 1} : ${q.question}\n`;
      });
    }
    if (a.structure) {
      const st = a.structure;
      if (Array.isArray(st.formulas) && st.formulas.length > 0) {
        text += `\nFormules clés :\n`;
        st.formulas.forEach((f) => { text += `  - ${f.latex || ''}\n`; });
      }
      if (Array.isArray(st.definitions) && st.definitions.length > 0) {
        text += `\nDéfinitions :\n`;
        st.definitions.forEach((d) => { text += `  - ${d.term} : ${d.definition}\n`; });
      }
      if (Array.isArray(st.mechanisms) && st.mechanisms.length > 0) {
        text += `\nMécanismes :\n`;
        st.mechanisms.forEach((m) => {
          text += `  - ${m.name || ''}\n`;
          if (Array.isArray(m.steps)) {
            m.steps.forEach((step, si) => { text += `    ${si + 1}. ${step}\n`; });
          }
        });
      }
      if (Array.isArray(st.timeline) && st.timeline.length > 0) {
        text += `\nChronologie :\n`;
        st.timeline.forEach((t) => { text += `  - ${t.date} : ${t.event}\n`; });
      }
    }
    return text;
  }).join('\n\n');

  return {
    notebookKey,
    chapterId: actualChapterId,
    chapterTitle: chapterData.title || chapterTitle || 'Chapitre',
    sectionsCount: sections.length,
    contentText
  };
}

// ────────────────────────────────────────────────────────────────
// PROVIDERS IA (aligné sur progress.js)
// ────────────────────────────────────────────────────────────────
function getProviders() {
  return [
    {
      name: 'Groq',
      key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true,
      headers: {}
    },
    {
      name: 'OpenRouter',
      key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true,
      headers: {
        'HTTP-Referer': process.env.APP_ORIGIN || '',
        'X-Title': 'ARVEXA Exam'
      }
    },
    {
      name: 'Mistral',
      key: process.env.MISTRAL_API_KEY,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      jsonMode: false,
      headers: {}
    }
  ].filter((p) => Boolean(p.key));
}

async function callProvider(provider, prompt, maxTokens = 14000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40000);

  try {
    const body = {
      model: provider.model,
      temperature: 0.25,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: 'Tu produis exclusivement du JSON valide.' },
        { role: 'user', content: prompt }
      ]
    };

    if (provider.jsonMode) body.response_format = { type: 'json_object' };

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

    const cleaned = String(content)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timeout);
  }
}

// ────────────────────────────────────────────────────────────────
// QUOTA
// ────────────────────────────────────────────────────────────────
function getUsageDate() { return new Date().toISOString().slice(0, 10); }

async function reserveFreeGeneration(uid) {
  const { db, FieldValue } = getAdminServices();
  const userRef = db.collection('users').doc(uid);
  const usageDate = getUsageDate();
  const usageRef = userRef.collection('examUsage').doc(usageDate);

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const usageSnapshot = await transaction.get(usageRef);

    if (!userSnapshot.exists) throw new Error('profile_missing');
    if (isPremiumUser(userSnapshot.data())) return { premium: true, reserved: false };

    const used = Number(usageSnapshot.data()?.count || 0);
    if (used >= FREE_EXAM_LIMIT) {
      return { premium: false, reserved: false, limitReached: true, used };
    }

    transaction.set(usageRef, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { premium: false, reserved: true, usageDate, used: used + 1 };
  });
}

async function releaseFreeGeneration(uid, usageDate) {
  if (!usageDate) return;
  const { db, FieldValue } = getAdminServices();
  const usageRef = db.collection('users').doc(uid).collection('examUsage').doc(usageDate);
  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(usageRef);
      const used = Math.max(0, Number(snapshot.data()?.count || 0) - 1);
      transaction.set(usageRef, { count: used, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (_) {}
}

// ────────────────────────────────────────────────────────────────
// SAUVEGARDE RÉSULTAT
// ────────────────────────────────────────────────────────────────
async function saveExamResult(uid, body, result) {
  const { db, FieldValue } = getAdminServices();
  const selected = body.exam.subjects.find((subject) => subject.id === body.subjectId) || body.exam.subjects[0];
  const difficulties = Array.isArray(result?.exercises) ? result.exercises.map((exercise) => ({
    number: exercise.number,
    score: Number(exercise.score || 0),
    maxScore: Number(exercise.maxScore || 5),
    advice: String(exercise.advice || '').slice(0, 500)
  })) : [];

  await db.collection('users').doc(uid).collection('examResults').add({
    subject: body.exam.subject,
    subjectKey: normalizeSubjectKey(body.exam.subject),
    subjectId: body.subjectId,
    chapter: body.exam.chapter || 'all',
    chapterTitle: selected?.title || 'Examen',
    score: Number(result?.score ?? result?.totalScore ?? 0),
    totalScore: 20,
    percentage: Number(result?.percentage ?? Math.round((Number(result?.score ?? 0) / 20) * 100)),
    grade: result?.grade || null,
    result: { ...result, exercises: difficulties },
    difficulties,
    answerCount: Object.values(body.answers || {}).filter(Boolean).length,
    examTitle: selected?.title || 'Examen',
    fromNotebook: Boolean(body.notebookContext),
    notebookChapterId: body.notebookContext?.chapterId || null,
    createdAt: FieldValue.serverTimestamp(),
    date: FieldValue.serverTimestamp()
  });
}

// ────────────────────────────────────────────────────────────────
// VALIDATION
// ────────────────────────────────────────────────────────────────
function validateConfig(body) {
  const config = {
    subject: String(body.subject || ''),
    level: String(body.level || ''),
    chapter: String(body.chapter || 'all'),
    difficulty: String(body.difficulty || ''),
    duration: Number(body.duration),
    exerciseCount: Number(body.exerciseCount)
  };
  if (!ALLOWED_SUBJECTS.has(config.subject)) return 'Matière invalide.';
  if (config.level !== 'Terminale D') return 'Niveau invalide.';
  if (!ALLOWED_DIFFICULTIES.has(config.difficulty)) return 'Difficulté invalide.';
  if (!ALLOWED_DURATIONS.has(config.duration)) return 'Durée invalide.';
  if (config.exerciseCount !== REQUIRED_EXERCISES) return 'Chaque sujet doit contenir 5 exercices.';
  if (config.chapter.length > 100) return 'Chapitre invalide.';
  return null;
}

function validateCorrection(body) {
  if (!body.exam || !Array.isArray(body.exam.subjects) || !body.subjectId || !body.answers || typeof body.answers !== 'object') return 'Données de correction invalides.';
  if (JSON.stringify(body).length > 250000) return 'Examen trop volumineux.';
  return null;
}

// ────────────────────────────────────────────────────────────────
// PROMPT GÉNÉRATION — MODE CAHIER
// ────────────────────────────────────────────────────────────────
function generationPromptFromNotebook(config, notebookContext) {
  const choiceSubjects = new Set(['Mathématiques', 'Physique', 'Chimie']);
  const questionFormat = choiceSubjects.has(config.subject)
    ? 'Pour les questions de calcul, utilise type "choice" avec exactement quatre propositions : options=[{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}] et correctAnswer parmi A, B, C ou D. Pour les questions de raisonnement, démonstration ou rédaction, utilise type "text".'
    : 'Pour chaque question, utilise le type "text" sauf si c\'est un QCM.';

  return `Tu es un professeur expert du BAC au Niger, spécialiste de ${config.subject}.

L'élève a étudié un chapitre précis dans son cahier. Tu dois générer DEUX sujets d'examen basés STRICTEMENT sur ce contenu.

═══════════════════════════════════════════════════════════════
CONTENU DU CHAPITRE ÉTUDIÉ PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
Chapitre : ${notebookContext.chapterTitle}
Matière : ${config.subject}
Nombre de sections étudiées : ${notebookContext.sectionsCount}

${notebookContext.contentText}

═══════════════════════════════════════════════════════════════
RÈGLE ABSOLUE DE PÉRIMÈTRE
═══════════════════════════════════════════════════════════════
1. Tu génères l'examen UNIQUEMENT à partir du contenu ci-dessus.
2. INTERDICTION d'inventer, d'ajouter ou de compléter avec des connaissances externes.
3. Toutes les questions doivent porter sur des éléments RÉELLEMENT présents dans le contenu fourni.
4. Si le contenu fourni ne couvre pas une partie du programme, l'examen reste limité à ce qui est fourni.
5. Chaque question doit être "traçable" à un passage du contenu.

═══════════════════════════════════════════════════════════════
STRUCTURE DES DEUX SUJETS — DIFFÉRENCIÉS PAR NIVEAU
═══════════════════════════════════════════════════════════════

SUJET 1 — Niveau "Consolidation" (facile à moyen)
- Vise à VÉRIFIER la maîtrise des notions de base
- Questions directes : définitions, mécanismes, formules
- Applications simples et classiques
- Répartition : environ 40% QCM + 60% texte
- Difficulté progressive : commence facile, termine moyen
- Instructions : "Ce sujet vérifie votre compréhension des notions essentielles."

SUJET 2 — Niveau "Approfondissement" (moyen à difficile)
- Vise à TESTER la capacité de raisonnement et d'analyse
- MÊMES notions que le Sujet 1, MAIS sous des angles plus exigeants
- Applications composées (plusieurs étapes), pièges classiques du BAC
- Répartition : environ 30% QCM + 70% texte
- Difficulté progressive : commence moyen, termine difficile
- Instructions : "Ce sujet approfondit votre maîtrise et vous prépare aux questions complexes du BAC."

Les 2 sujets couvrent TOUT le contenu, mais sous des angles différents.

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Formules entre $...$ (inline) ou $$...$$ (display)
- JAMAIS de symboles Unicode bruts (π, √, ², ≤, ∞, →)
- Utilise $\\pi$, $\\sqrt{}$, $^{2}$, $\\leq$, $\\infty$, $\\to$

${questionFormat}

═══════════════════════════════════════════════════════════════
FORMAT JSON ATTENDU
═══════════════════════════════════════════════════════════════
{
  "subject": "${config.subject}",
  "level": "${config.level}",
  "duration": ${config.duration},
  "totalPoints": 20,
  "chapter": "${config.chapter}",
  "fromNotebook": true,
  "subjects": [
    {
      "id": "subject_1",
      "title": "Sujet 1 — Consolidation",
      "instructions": "Ce sujet vérifie votre compréhension des notions essentielles.",
      "level": "consolidation",
      "exercises": [
        {
          "number": 1,
          "title": "Titre de l'exercice",
          "points": 4,
          "statement": "Énoncé complet de l'exercice.",
          "questions": [
            {
              "number": "1.a",
              "text": "Question ?",
              "points": 0.4,
              "type": "choice",
              "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
              "correctAnswer": "A"
            }
          ]
        }
      ]
    },
    {
      "id": "subject_2",
      "title": "Sujet 2 — Approfondissement",
      "instructions": "Ce sujet approfondit votre maîtrise et vous prépare aux questions complexes du BAC.",
      "level": "approfondissement",
      "exercises": []
    }
  ]
}

CONTRAINTES FINALES :
- Chaque sujet : EXACTEMENT 5 exercices
- Chaque exercice : EXACTEMENT 10 questions
- Chaque sujet : total de 20 points
- Score des exercices : 4 pts chacun
- Toutes les questions basées sur le contenu fourni
- Réponds UNIQUEMENT avec le JSON valide`;
}

// ────────────────────────────────────────────────────────────────
// PROMPT GÉNÉRATION — MODE NORMAL
// ────────────────────────────────────────────────────────────────
function generationPrompt(config) {
  const choiceSubjects = new Set(['Mathématiques', 'Physique', 'Chimie']);
  const questionFormat = choiceSubjects.has(config.subject)
    ? 'Pour les questions de calcul, utilise type "choice" avec exactement quatre propositions et correctAnswer parmi A, B, C ou D. Pour les questions de raisonnement, démonstration ou rédaction, utilise type "text".'
    : 'Pour chaque question, utilise le type "text" sauf si c\'est un QCM.';

  return `Tu es un professeur expert du BAC au Niger, spécialiste de ${config.subject}.

MISSION : Génère DEUX sujets d'examen de niveau Terminale D, de difficulté comparable mais avec des angles pédagogiques différents.

Matière : ${config.subject}
Niveau : ${config.level}
Chapitre : ${config.chapter === 'all' ? 'tous les chapitres du programme' : config.chapter}
Difficulté demandée : ${config.difficulty}
Durée : ${config.duration} minutes

═══════════════════════════════════════════════════════════════
STRUCTURE DES DEUX SUJETS
═══════════════════════════════════════════════════════════════

SUJET 1 — Niveau "Consolidation" (facile à moyen)
- Vise à vérifier les notions fondamentales
- Questions directes, applications simples
- 40% QCM + 60% texte
- Difficulté progressive : facile → moyen

SUJET 2 — Niveau "Approfondissement" (moyen à difficile)
- MÊMES notions, angles plus exigeants
- Applications composées, pièges classiques du BAC
- 30% QCM + 70% texte
- Difficulté progressive : moyen → difficile

═══════════════════════════════════════════════════════════════
RÈGLES LATEX
═══════════════════════════════════════════════════════════════
- Formules entre $...$ ou $$...$$
- JAMAIS de symboles Unicode bruts (π, √, ², ≤, ∞, →)

${questionFormat}

═══════════════════════════════════════════════════════════════
FORMAT JSON ATTENDU
═══════════════════════════════════════════════════════════════
{
  "subject": "${config.subject}",
  "level": "${config.level}",
  "duration": ${config.duration},
  "totalPoints": 20,
  "chapter": "${config.chapter}",
  "fromNotebook": false,
  "subjects": [
    {
      "id": "subject_1",
      "title": "Sujet 1 — Consolidation",
      "instructions": "Ce sujet vérifie votre compréhension des notions essentielles.",
      "level": "consolidation",
      "exercises": [...]
    },
    {
      "id": "subject_2",
      "title": "Sujet 2 — Approfondissement",
      "instructions": "Ce sujet approfondit votre maîtrise et vous prépare aux questions complexes du BAC.",
      "level": "approfondissement",
      "exercises": [...]
    }
  ]
}

CONTRAINTES :
- Chaque sujet : 5 exercices × 10 questions = 50 questions
- Total : 20 points par sujet
- Réponds UNIQUEMENT avec le JSON`;
}

// ────────────────────────────────────────────────────────────────
// PROMPT CORRECTION
// ────────────────────────────────────────────────────────────────
function correctionPrompt(body) {
  const subject = body.exam.subjects.find((s) => s.id === body.subjectId);
  if (!subject) throw new Error('subject_not_found');

  const questionsDetail = [];
  subject.exercises.forEach((exercise, exIdx) => {
    exercise.questions.forEach((question, qIdx) => {
      const key = `${body.subjectId}:${exIdx}:${qIdx}`;
      const studentAnswer = body.answers[key] || null;

      questionsDetail.push({
        exerciseNumber: exercise.number || exIdx + 1,
        exerciseTitle: exercise.title || `Exercice ${exIdx + 1}`,
        questionNumber: question.number || `${exIdx + 1}.${qIdx + 1}`,
        questionText: question.text,
        type: question.type || 'text',
        points: Number(question.points) || 0.4,
        options: question.options || null,
        correctAnswer: question.correctAnswer || null,
        studentAnswer: studentAnswer,
        answered: studentAnswer !== null && studentAnswer !== ''
      });
    });
  });

  return `Tu es un professeur correcteur expert du BAC au Niger (Terminale D).
Tu corriges un examen de ${body.exam.subject} sur le chapitre "${subject.title || 'Général'}".

═══════════════════════════════════════════════════════════════
MISSION
═══════════════════════════════════════════════════════════════
Pour CHAQUE question :
1. Compare la réponse de l'élève à la bonne réponse
2. Attribue les points (0 = faux, total = juste, partiel si justifié)
3. Explique PRÉCISÉMENT où est l'erreur (si erreur)
4. Félicite si c'est juste (avec une astuce bonus)
5. Propose une meilleure méthode si elle existe
6. Suggère un point à revoir (notion précise)

═══════════════════════════════════════════════════════════════
RÈGLES DE NOTATION
═══════════════════════════════════════════════════════════════
- QCM (type "choice") : réponse exacte = tous les points, sinon 0
- Texte libre : évalue sur le fond, la méthode, la rigueur
- Réponse vide : 0 point + conseil de ne jamais laisser vide
- Ne dépasse jamais les points de la question

═══════════════════════════════════════════════════════════════
DONNÉES DE L'EXAMEN
═══════════════════════════════════════════════════════════════
${JSON.stringify(questionsDetail, null, 2)}

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "score": 0,
  "totalScore": 20,
  "percentage": 0,
  "grade": "Insuffisant",
  "exercises": [
    {
      "number": 1,
      "title": "Nombres complexes",
      "score": 3.2,
      "maxScore": 4,
      "correctAnswers": 8,
      "totalQuestions": 10,
      "questions": [
        {
          "number": "1.1",
          "questionText": "Calculer le module de z = 3 + 4i",
          "type": "choice",
          "studentAnswer": "B",
          "correctAnswer": "A",
          "points": 0.4,
          "maxPoints": 0.4,
          "status": "correct",
          "feedback": "🎉 Bravo ! Tu as bien appliqué la formule |z| = √(a²+b²).",
          "betterMethod": "Pour gagner du temps, mémorise les triplets pythagoriciens.",
          "toReview": null
        }
      ],
      "explanation": "Bon travail global.",
      "advice": "Concentre-toi sur les valeurs remarquables."
    }
  ],
  "revisionTopics": ["Notion 1", "Notion 2"],
  "globalFeedback": {
    "strengths": ["Point fort 1"],
    "weaknesses": ["Point faible 1"],
    "encouragement": "Continue !"
  }
}

═══════════════════════════════════════════════════════════════
IMPORTANT
═══════════════════════════════════════════════════════════════
- Émojis dans feedback : 🎉, ❌, ⏭️, 💡, 📖
- Chaque feedback : 2-4 phrases max, pédagogique
- "betterMethod" : astuce ou meilleure méthode
- "toReview" : notion précise à revoir (null si tout bon)
- Réponds UNIQUEMENT avec l'objet JSON`;
}

// ────────────────────────────────────────────────────────────────
// VALIDATION EXAMEN
// ────────────────────────────────────────────────────────────────
function validateGeneratedExam(exam, subjectName) {
  const supportsChoices = ['Mathématiques', 'Physique', 'Chimie'].includes(subjectName);
  const validQuestion = (question) => {
    if (!supportsChoices || question.type !== 'choice') {
      return ['text', 'number', 'formula', 'choice'].includes(question.type);
    }
    return Array.isArray(question.options) && question.options.length === 4
      && question.options.every((option) => option?.id && option?.text)
      && ['A', 'B', 'C', 'D'].includes(question.correctAnswer);
  };
  return exam && typeof exam === 'object' && Array.isArray(exam.subjects) && exam.subjects.length === 2
    && exam.subjects.every((subject) =>
      Array.isArray(subject.exercises) && subject.exercises.length === REQUIRED_EXERCISES
      && subject.exercises.every((exercise) =>
        Array.isArray(exercise.questions) && exercise.questions.length === QUESTIONS_PER_EXERCISE
        && exercise.questions.every(validQuestion)
      )
    );
}

// ────────────────────────────────────────────────────────────────
// GÉNÉRATION AVEC FALLBACK
// ────────────────────────────────────────────────────────────────
async function generateWithFallback(prompt, subjectName) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const errors = [];

  for (const provider of providers) {
    try {
      console.log(`[AI] Tentative ${provider.name}...`);
      const exam = await callProvider(provider, prompt);

      if (validateGeneratedExam(exam, subjectName)) {
        console.log(`[AI] ${provider.name} — structure valide`);
        return { exam, provider: provider.name };
      }

      errors.push(`${provider.name}: structure invalide`);
      console.warn(`[AI] ${provider.name} : structure invalide`);

    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI] ${provider.name} échec: ${error.message}`);
    }
  }

  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

async function correctWithFallback(prompt) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const errors = [];

  for (const provider of providers) {
    try {
      console.log(`[AI] Correction avec ${provider.name}...`);
      const result = await callProvider(provider, prompt, 16000);

      if (result && typeof result === 'object' && Array.isArray(result.exercises)) {
        console.log(`[AI] ${provider.name} — correction valide`);
        return { result, provider: provider.name };
      }

      errors.push(`${provider.name}: structure invalide`);

    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI] ${provider.name} correction échouée: ${error.message}`);
    }
  }

  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ────────────────────────────────────────────────────────────────
// FALLBACK LOCAL
// ────────────────────────────────────────────────────────────────
function buildLocalExam(config) {
  const useChoices = ['Mathématiques', 'Physique', 'Chimie'].includes(config.subject);
  const options = useChoices ? [
    { id: 'A', text: 'Réponse A' },
    { id: 'B', text: 'Réponse B' },
    { id: 'C', text: 'Réponse C' },
    { id: 'D', text: 'Réponse D' }
  ] : null;

  const buildSubjects = (id, title, level, instructions) => ({
    id,
    title,
    level,
    instructions,
    exercises: Array.from({ length: REQUIRED_EXERCISES }, (_, exerciseIndex) => ({
      number: exerciseIndex + 1,
      title: `Exercice ${exerciseIndex + 1}`,
      points: 4,
      statement: `Énoncé de l'exercice ${exerciseIndex + 1}. Montrez votre méthode et concluez.`,
      questions: Array.from({ length: QUESTIONS_PER_EXERCISE }, (_, questionIndex) => ({
        number: `${exerciseIndex + 1}.${questionIndex + 1}`,
        text: `Question ${questionIndex + 1} sur le thème ${config.chapter === 'all' ? 'principal' : config.chapter}.`,
        points: 0.4,
        type: useChoices ? 'choice' : 'text',
        ...(options ? { options, correctAnswer: 'A' } : {})
      }))
    }))
  });

  return {
    subject: config.subject,
    level: config.level,
    duration: config.duration,
    totalPoints: 20,
    chapter: config.chapter,
    fromNotebook: false,
    subjects: [
      buildSubjects('subject_1', 'Sujet 1 — Consolidation', 'consolidation',
        'Ce sujet vérifie votre compréhension des notions essentielles.'),
      buildSubjects('subject_2', 'Sujet 2 — Approfondissement', 'approfondissement',
        'Ce sujet approfondit votre maîtrise et vous prépare aux questions complexes du BAC.')
    ]
  };
}

// ═══════════════════════════════════════════════════════════════
// CORRECTION QCM DÉTERMINISTE
// ═══════════════════════════════════════════════════════════════
function correctQCMDeterministic(subject, subjectId, answers) {
  const exercises = [];

  subject.exercises.forEach((exercise, exIdx) => {
    const exerciseResult = {
      number: exercise.number || exIdx + 1,
      title: exercise.title || `Exercice ${exIdx + 1}`,
      score: 0,
      maxScore: 0,
      correctAnswers: 0,
      totalQuestions: exercise.questions.length,
      questions: [],
      wrongAnswers: [],
      explanation: '',
      advice: ''
    };

    const textQuestions = [];

    exercise.questions.forEach((question, qIdx) => {
      const key = `${subjectId}:${exIdx}:${qIdx}`;
      const studentAnswer = answers[key];
      const points = Number(question.points) || 0.4;
      exerciseResult.maxScore += points;

      const questionResult = {
        number: question.number || `${exIdx + 1}.${qIdx + 1}`,
        questionText: question.text,
        type: question.type || 'text',
        studentAnswer: studentAnswer || null,
        correctAnswer: question.correctAnswer || null,
        points: 0,
        maxPoints: points,
        status: 'pending',
        feedback: '',
        betterMethod: null,
        toReview: null
      };

      if (question.type === 'choice' && question.correctAnswer) {
        if (studentAnswer === question.correctAnswer) {
          questionResult.status = 'correct';
          questionResult.points = points;
          exerciseResult.score += points;
          exerciseResult.correctAnswers++;
        } else if (!studentAnswer) {
          questionResult.status = 'unanswered';
        } else {
          questionResult.status = 'wrong';
          exerciseResult.wrongAnswers.push({
            number: questionResult.number,
            studentAnswer: studentAnswer,
            correctAnswer: question.correctAnswer,
            question: question.text
          });
        }
      } else {
        textQuestions.push({
          exerciseIndex: exIdx,
          questionIndex: qIdx,
          questionResult
        });
      }

      exerciseResult.questions.push(questionResult);
    });

    exercises.push({ exerciseResult, textQuestions });
  });

  return exercises;
}

async function correctExamHybrid(exam, subjectId, answers, uid) {
  const subject = exam.subjects.find((s) => s.id === subjectId);
  if (!subject) throw new Error('subject_not_found');

  const deterministicResults = correctQCMDeterministic(subject, subjectId, answers);
  const hasTextQuestions = deterministicResults.some((r) => r.textQuestions.length > 0);

  if (hasTextQuestions) {
    try {
      const prompt = correctionPrompt({
        exam: { ...exam, subjects: [subject] },
        subjectId,
        answers
      });
      const { result: aiResult } = await correctWithFallback(prompt);

      if (Array.isArray(aiResult?.exercises)) {
        aiResult.exercises.forEach((aiEx, exIdx) => {
          const target = deterministicResults[exIdx];
          if (!target) return;

          const aiQuestions = Array.isArray(aiEx.questions) ? aiEx.questions : [];

          aiQuestions.forEach((aiQ) => {
            const match = target.exerciseResult.questions.find(
              (q) => String(q.number) === String(aiQ.number)
            );
            if (!match) return;

            if (match.status === 'pending') {
              match.points = Number(aiQ.points) || 0;
              match.status = aiQ.status || (match.points > 0 ? 'correct' : 'wrong');
              if (match.status === 'correct') {
                target.exerciseResult.score += match.points;
                target.exerciseResult.correctAnswers++;
              }
            }
            match.feedback = aiQ.feedback || match.feedback;
            match.betterMethod = aiQ.betterMethod || match.betterMethod;
            match.toReview = aiQ.toReview || match.toReview;
            if (aiQ.correctAnswer) match.correctAnswer = aiQ.correctAnswer;
          });

          if (aiEx.explanation) target.exerciseResult.explanation = aiEx.explanation;
          if (aiEx.advice) target.exerciseResult.advice = aiEx.advice;
        });
      }

      if (Array.isArray(aiResult?.revisionTopics)) {
        deterministicResults.revisionTopics = aiResult.revisionTopics;
      }
      if (aiResult?.globalFeedback) {
        deterministicResults.globalFeedback = aiResult.globalFeedback;
      }
    } catch (error) {
      console.warn('AI correction failed, deterministic only:', error.message);
      deterministicResults.forEach(({ textQuestions, exerciseResult }) => {
        textQuestions.forEach(({ questionResult }) => {
          questionResult.status = 'unanswered';
          questionResult.feedback = 'Correction IA temporairement indisponible. Réessaie plus tard.';
        });
        if (!exerciseResult.explanation) {
          exerciseResult.explanation = 'Correction partielle : QCM corrigés automatiquement.';
        }
      });
    }
  }

  const finalExercises = deterministicResults.map((r) => r.exerciseResult);
  const rawScore = finalExercises.reduce((sum, ex) => sum + ex.score, 0);
  const score = Math.min(20, Math.round(rawScore * 100) / 100);
  const percentage = Math.round((score / 20) * 100);

  let grade = 'Insuffisant';
  if (percentage >= 90) grade = 'Excellent';
  else if (percentage >= 80) grade = 'Très bien';
  else if (percentage >= 70) grade = 'Bien';
  else if (percentage >= 60) grade = 'Assez bien';
  else if (percentage >= 50) grade = 'Passable';

  let revisionTopics = deterministicResults.revisionTopics || [];
  if (!revisionTopics.length) {
    finalExercises.forEach((ex) => {
      if (ex.score < ex.maxScore * 0.5) {
        revisionTopics.push(`Revoir ${ex.title || `Exercice ${ex.number}`}`);
      }
    });
  }

  const globalFeedback = deterministicResults.globalFeedback || {
    strengths: [],
    weaknesses: [],
    encouragement: percentage >= 70 ? 'Bon travail global !' : 'Continue tes efforts.'
  };

  return {
    score,
    totalScore: 20,
    percentage,
    grade,
    exercises: finalExercises,
    revisionTopics,
    globalFeedback
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
    return jsonError(response, 429, 'Vous avez atteint votre limite de génération.');
  }

  const firebaseConfigured = Boolean(process.env.FIREBASE_ADMIN_CREDENTIALS);
  let verifiedUser = null;

  try {
    verifiedUser = await verifyFirebaseToken(request);
  } catch (error) {
    console.error('Firebase token verification failed:', error.message);
  }

  if (!verifiedUser && !firebaseConfigured) {
    verifiedUser = { uid: 'local-fallback-user' };
  } else if (!verifiedUser) {
    return jsonError(response, 401, 'Connexion requise.');
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'generate';

  // ═══════════════════════════════════════════════════════════
  // ACTION : GÉNÉRATION
  // ═══════════════════════════════════════════════════════════
  if (action === 'generate') {
    const validationError = validateConfig(body);
    if (validationError) return jsonError(response, 400, validationError);

    if (!firebaseConfigured || verifiedUser.uid === 'local-fallback-user') {
      return response.status(200).json({ success: true, exam: buildLocalExam(body) });
    }

    let reservation;
    try {
      reservation = await reserveFreeGeneration(verifiedUser.uid);
    } catch (error) {
      console.error('Exam usage check failed:', error.message);
      return jsonError(response, 503, 'La vérification du quota est temporairement indisponible.');
    }

    if (reservation.limitReached) {
      return response.status(429).json({
        success: false,
        error: 'Limite gratuite atteinte.',
        code: 'FREE_EXAM_LIMIT',
        used: reservation.used,
        limit: FREE_EXAM_LIMIT
      });
    }

    try {
      const providers = getProviders();
      if (!providers.length) {
        return response.status(200).json({ success: true, exam: buildLocalExam(body) });
      }

      // ⚡ Charger le contexte cahier si demandé
      let notebookContext = null;
      if (body.notebookContext?.chapterId || body.notebookContext?.chapterTitle) {
        try {
          notebookContext = await loadNotebookContext(
            verifiedUser.uid,
            body.subject,
            body.notebookContext.chapterId,
            body.notebookContext.chapterTitle
          );
          if (notebookContext) {
            console.log(`[EXAM] Contexte cahier chargé : ${notebookContext.sectionsCount} sections`);
          } else {
            console.log('[EXAM] Contexte cahier vide, mode normal');
          }
        } catch (e) {
          console.warn('[EXAM] Erreur chargement cahier:', e.message);
        }
      }

      const prompt = notebookContext
        ? generationPromptFromNotebook(body, notebookContext)
        : generationPrompt(body);

      const { exam, provider } = await generateWithFallback(prompt, body.subject);

      const examWithMeta = {
        ...exam,
        chapter: body.chapter,
        fromNotebook: Boolean(notebookContext),
        notebookSectionsCount: notebookContext?.sectionsCount || 0
      };

      return response.status(200).json({
        success: true,
        exam: examWithMeta,
        meta: {
          provider,
          fromNotebook: Boolean(notebookContext),
          sectionsUsed: notebookContext?.sectionsCount || 0
        }
      });

    } catch (error) {
      console.error('Exam generation failed:', error.message);

      if (reservation?.reserved) {
        try { await releaseFreeGeneration(verifiedUser.uid, reservation.usageDate); } catch (_) {}
      }

      return response.status(200).json({ success: true, exam: buildLocalExam(body) });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ACTION : CORRECTION
  // ═══════════════════════════════════════════════════════════
  if (action === 'correct') {
    const validationError = validateCorrection(body);
    if (validationError) return jsonError(response, 400, validationError);

    try {
      const result = await correctExamHybrid(
        body.exam,
        body.subjectId,
        body.answers,
        verifiedUser.uid
      );

      if (firebaseConfigured && verifiedUser.uid !== 'local-fallback-user') {
        try { await saveExamResult(verifiedUser.uid, body, result); }
        catch (saveError) { console.error('Exam result save failed:', saveError.message); }
      }

      return response.status(200).json({ success: true, result });

    } catch (error) {
      console.error('Exam correction failed:', error.message);

      return response.status(200).json({
        success: true,
        result: {
          score: 0,
          totalScore: 20,
          percentage: 0,
          grade: 'Indéterminé',
          exercises: [],
          revisionTopics: [],
          globalFeedback: {
            strengths: [],
            weaknesses: [],
            encouragement: 'La correction est temporairement indisponible. Réessaie dans quelques minutes.'
          }
        }
      });
    }
  }

  return jsonError(response, 400, 'Action invalide.');
};
