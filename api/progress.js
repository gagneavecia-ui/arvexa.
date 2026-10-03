// ================================================================
// API PROGRESS — ARV-PROGRESS (moteur de progression ARVEXA)
// Version 1.0 — MVP Phase 1
// ================================================================

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestLog = new Map();

// ⚡ Quotas FREE
const FREE_COURSE_LIMIT_MONTHLY = 2;    // 2 captures de cours / mois
const FREE_QUIZ_LIMIT_WEEKLY = 5;       // 5 quiz / semaine

// ⚡ Limites IA
const MAX_CONTENT_LENGTH = 15000;
const MIN_CONTENT_LENGTH = 100;

// ⚡ Modèles IA
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

// ⚡ Config matières
const SUBJECTS = {
  mathematiques: { label: 'Mathématiques', icon: 'fa-square-root-variable' },
  physique: { label: 'Physique', icon: 'fa-bolt' },
  chimie: { label: 'Chimie', icon: 'fa-flask' },
  svt: { label: 'SVT', icon: 'fa-dna' }
};

// ⚡ Algorithme de répétition espacée (SM-2 simplifié)
const REVIEW_INTERVALS_DAYS = [1, 2, 4, 7, 14, 30, 60, 90];

let adminServices = null;

// ────────────────────────────────────────────────────────────────
// INIT FIREBASE ADMIN
// ────────────────────────────────────────────────────────────────
function getAdminServices() {
  if (adminServices) return adminServices;

  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials || !credentials.trim()) {
    const err = new Error('firebase_admin_not_configured');
    err.details = 'FIREBASE_ADMIN_CREDENTIALS is missing or empty.';
    throw err;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(credentials);
  } catch (parseError) {
    const err = new Error('firebase_admin_invalid_json');
    err.details = 'Invalid JSON: ' + parseError.message;
    throw err;
  }

  if (!serviceAccount.project_id) {
    throw new Error('firebase_admin_missing_project');
  }

  if (!serviceAccount.private_key || serviceAccount.private_key.length < 100) {
    throw new Error('firebase_admin_invalid_key');
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    try {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (initError) {
      throw new Error('firebase_admin_init_failed: ' + initError.message);
    }
  }

  adminServices = {
    auth: admin.auth(),
    db: admin.firestore(),
    FieldValue: admin.firestore.FieldValue
  };

  console.log('[PROGRESS] Firebase init OK:', serviceAccount.project_id);
  return adminServices;
}

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────
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
  try {
    const { auth } = getAdminServices();
    return await auth.verifyIdToken(match[1]);
  } catch (error) {
    console.error('[AUTH] verifyIdToken failed:', error.message);
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

function sanitizeString(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen).replace(/[\u0000-\u001f]/g, '').trim();
}

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function weekKey() {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (24 * 60 * 60 * 1000));
}

// ────────────────────────────────────────────────────────────────
// QUOTAS
// ────────────────────────────────────────────────────────────────
async function checkAndIncrementQuota(uid, type, limit) {
  const { db, FieldValue } = getAdminServices();
  const periodKey = type === 'quiz' ? weekKey() : monthKey();
  const quotaRef = db.collection('users').doc(uid).collection('progressUsage').doc(`${type}_${periodKey}`);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(quotaRef);
    const used = Number(snap.data()?.count || 0);

    if (used >= limit) {
      return { allowed: false, used, limit };
    }

    transaction.set(quotaRef, {
      count: used + 1,
      type,
      periodKey,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return { allowed: true, used: used + 1, limit };
  });
}

// ────────────────────────────────────────────────────────────────
// IA — APPEL PROVIDER AVEC FALLBACK
// ────────────────────────────────────────────────────────────────
function getProviders() {
  return [
    {
      name: 'Groq',
      key: process.env.GROQ_API_KEY,
      endpoint: GROQ_ENDPOINT,
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      headers: {}
    },
    {
      name: 'OpenRouter',
      key: process.env.OPENROUTER_API_KEY,
      endpoint: OPENROUTER_ENDPOINT,
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      headers: {
        'HTTP-Referer': process.env.APP_ORIGIN || 'https://arvexaschool.vercel.app',
        'X-Title': 'ARVEXA School - ARV-PROGRESS'
      }
    },
    {
      name: 'Mistral',
      key: process.env.MISTRAL_API_KEY,
      endpoint: MISTRAL_ENDPOINT,
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      headers: {}
    }
  ].filter((p) => Boolean(p.key));
}

async function callAI(prompt, maxTokens = 4000) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  let lastError = null;

  for (const provider of providers) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      try {
        const res = await fetch(provider.endpoint, {
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
              { role: 'system', content: 'Tu es un professeur expert du BAC au Niger. Tu réponds UNIQUEMENT avec du JSON valide, sans markdown, sans commentaires.' },
              { role: 'user', content: prompt }
            ]
          }),
          signal: controller.signal
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`${provider.name} HTTP ${res.status}`);

        const content = data?.choices?.[0]?.message?.content;
        if (!content) throw new Error(`${provider.name} réponse vide`);

        const cleaned = content
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        return JSON.parse(cleaned);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      console.warn(`[AI] ${provider.name} indisponible:`, error.message);
      lastError = error;
    }
  }

  throw new Error('all_providers_failed: ' + (lastError?.message || 'unknown'));
}

// ────────────────────────────────────────────────────────────────
// IA — PROMPT ANALYSE DE COURS
// ────────────────────────────────────────────────────────────────
function courseAnalysisPrompt({ subject, subjectLabel, title, content }) {
  return `Tu es un professeur expert du BAC au Niger. Tu analyses un cours fourni par un élève de Terminale et tu structures ce cours en notions pédagogiques essentielles.

Matière : ${subjectLabel}
Titre fourni (peut être vide) : "${title || '(non fourni)'}"

CONTENU DU COURS :
"""
${content}
"""

MISSION :
1. Analyse ce cours et identifie les notions pédagogiques essentielles qu'il contient.
2. Chaque notion doit être une UNITÉ APPRENABLE indépendante (15-45 minutes de travail).
3. Entre 3 et 10 notions maximum selon la richesse du cours.
4. Détecte les prérequis nécessaires pour chaque notion.
5. Pour chaque notion, génère EXACTEMENT 3 questions de compréhension avec 4 options.

═══ RÈGLES DE DÉCOUPAGE DES NOTIONS ═══
- Une notion = un concept clair, une formule clé, ou une méthode.
- Ne PAS découper trop finement (ex : pas une notion par formule).
- Ne PAS regrouper trop largement (ex : pas tout un chapitre en 1 notion).
- Maximum 10 notions.
- Chaque notion doit pouvoir être testée en 30 secondes.

═══ FORMAT DE RÉPONSE (JSON uniquement) ═══
{
  "courseTitle": "Titre du cours (si vide, propose-en un)",
  "chapterTitle": "Nom du chapitre global",
  "detectedSubject": "${subject}",
  "notions": [
    {
      "id": "notion-slug-1",
      "title": "Titre court de la notion",
      "summary": "Résumé en 1-2 phrases.",
      "difficulty": 2,
      "importance": 5,
      "prerequisites": ["notion-slug-prev"],
      "keyConcepts": ["concept1", "concept2"],
      "formulas": ["formule1 en LaTeX si applicable"],
      "questions": [
        {
          "id": "q1",
          "text": "Question claire sur la notion",
          "options": [
            { "id": "A", "text": "Proposition A" },
            { "id": "B", "text": "Proposition B" },
            { "id": "C", "text": "Proposition C" },
            { "id": "D", "text": "Proposition D" }
          ],
          "correctAnswer": "A",
          "explanation": "Brève explication"
        }
      ]
    }
  ]
}

═══ RÈGLES POUR LES QUESTIONS ═══
- Exactement 3 questions par notion.
- 4 options (A, B, C, D) par question.
- Une seule bonne réponse.
- Questions courtes et claires.
- CorrectAnswer = A, B, C ou D.
- Utilise LaTeX entre $...$ pour les formules.

═══ RÈGLES IMPORTANTES ═══
- difficulty : 1 (facile) à 5 (difficile)
- importance : 1 (bonus) à 5 (essentiel BAC)
- prerequisites : liste d'IDs de notions du MÊME cours (vides si aucun prérequis)
- Ne JAMAIS inventer d'information absente du cours fourni.
- Si le cours est illisible ou trop court, renvoie une liste vide avec un champ "error".

Réponds UNIQUEMENT avec l'objet JSON.`;
}

// ────────────────────────────────────────────────────────────────
// TRAITEMENT D'UN COURS — Analyse + Sauvegarde + Quiz
// ────────────────────────────────────────────────────────────────
async function analyzeCourse(uid, { subject, title, content }) {
  const { db, FieldValue } = getAdminServices();

  // 1) Validation
  if (!SUBJECTS[subject]) throw { status: 400, message: 'Matière invalide.' };
  const cleanContent = sanitizeString(content, MAX_CONTENT_LENGTH);
  if (cleanContent.length < MIN_CONTENT_LENGTH) {
    throw { status: 400, message: `Contenu trop court (min ${MIN_CONTENT_LENGTH} caractères).` };
  }

  const cleanTitle = sanitizeString(title, 100);
  const subjectLabel = SUBJECTS[subject].label;

  // 2) Appel IA pour analyse
  const prompt = courseAnalysisPrompt({
    subject,
    subjectLabel,
    title: cleanTitle,
    content: cleanContent
  });

  let analysis;
  try {
    analysis = await callAI(prompt, 6000);
  } catch (error) {
    console.error('[PROGRESS] AI analysis failed:', error.message);
    throw { status: 503, message: 'Analyse temporairement indisponible. Réessaie.' };
  }

  // 3) Validation de la structure
  if (!analysis || !Array.isArray(analysis.notions)) {
    throw { status: 500, message: 'Structure d\'analyse invalide.' };
  }

  const notions = analysis.notions
    .filter((n) => n && n.title && Array.isArray(n.questions))
    .slice(0, 10);

  if (notions.length === 0) {
    throw { status: 422, message: 'Aucune notion détectée. Vérifie que ton cours contient du contenu pédagogique.' };
  }

  // 4) Sauvegarder le cours
  const courseId = generateId('course');
  const courseRef = db.collection('users').doc(uid).collection('courses').doc(courseId);

  const courseData = {
    id: courseId,
    subject,
    subjectLabel,
    title: cleanTitle || analysis.courseTitle || 'Cours sans titre',
    chapterTitle: analysis.chapterTitle || '',
    content: cleanContent,
    notionsCount: notions.length,
    source: 'text',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  await courseRef.set(courseData);

  // 5) Sauvegarder les notions + créer la maîtrise initiale + file de révision
  const batch = db.batch();
  const now = new Date();

  const allNotions = [];
  const initialQuiz = [];

  for (let i = 0; i < notions.length; i++) {
    const n = notions[i];
    const notionId = `${courseId}_${n.id || generateId('notion')}`;

    const notionRef = courseRef.collection('notions').doc(notionId);
    const notionData = {
      id: notionId,
      courseId,
      subject,
      subjectLabel,
      title: sanitizeString(n.title, 120),
      summary: sanitizeString(n.summary, 300),
      difficulty: Math.max(1, Math.min(5, Number(n.difficulty) || 2)),
      importance: Math.max(1, Math.min(5, Number(n.importance) || 3)),
      prerequisites: Array.isArray(n.prerequisites) ? n.prerequisites.slice(0, 10) : [],
      keyConcepts: Array.isArray(n.keyConcepts) ? n.keyConcepts.slice(0, 10) : [],
      formulas: Array.isArray(n.formulas) ? n.formulas.slice(0, 5) : [],
      createdAt: FieldValue.serverTimestamp(),
      order: i
    };
    batch.set(notionRef, notionData);
    allNotions.push(notionData);

    // Maîtrise initiale (toutes les dimensions à 0)
    const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);
    batch.set(masteryRef, {
      notionId,
      courseId,
      subject,
      title: notionData.title,
      understanding: 0,
      memory: 0,
      recall: 0,
      application: 0,
      confidence: 0,
      globalScore: 0,
      lastReviewedAt: null,
      nextReviewAt: new Date(now.getTime() + REVIEW_INTERVALS_DAYS[0] * 24 * 60 * 60 * 1000),
      reviewCount: 0,
      errorCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // File de révision (première révision dans 1 jour)
    const reviewItemId = notionId;
    const reviewRef = db.collection('users').doc(uid).collection('reviewQueue').doc(reviewItemId);
    batch.set(reviewRef, {
      id: reviewItemId,
      notionId,
      courseId,
      subject,
      title: notionData.title,
      dueAt: new Date(now.getTime() + REVIEW_INTERVALS_DAYS[0] * 24 * 60 * 60 * 1000),
      intervalIndex: 0,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    // Quiz initial : prendre les 3 questions de la 1ère notion pour démarrer
    // (ou 5 questions mélangées des 2 premières notions)
    if (Array.isArray(n.questions)) {
      n.questions.forEach((q, qIdx) => {
        if (q && q.text && Array.isArray(q.options) && q.options.length === 4 && q.correctAnswer) {
          initialQuiz.push({
            id: `${notionId}_q${qIdx}`,
            notionId,
            notionTitle: notionData.title,
            text: sanitizeString(q.text, 300),
            options: q.options.slice(0, 4).map((o) => ({
              id: sanitizeString(o.id, 5),
              text: sanitizeString(o.text, 200)
            })),
            correctAnswer: sanitizeString(q.correctAnswer, 5),
            explanation: sanitizeString(q.explanation, 400)
          });
        }
      });
    }
  }

  await batch.commit();

  // 6) Limiter le quiz initial à 5 questions (mélangées)
  const shuffledQuiz = initialQuiz.sort(() => Math.random() - 0.5).slice(0, 5);

  return {
    success: true,
    courseId,
    notionsCount: notions.length,
    initialQuiz: shuffledQuiz
  };
}

// ────────────────────────────────────────────────────────────────
// DASHBOARD — Récupérer toutes les données pour l'interface
// ────────────────────────────────────────────────────────────────
async function getDashboard(uid) {
  const { db } = getAdminServices();

  // 1) Récupérer toutes les maîtrises
  const masterySnap = await db.collection('users').doc(uid).collection('mastery').get();
  const masteries = masterySnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // 2) Statistiques globales
  let mastered = 0;
  let reinforce = 0;
  let critical = 0;
  let totalScore = 0;

  masteries.forEach((m) => {
    const score = Number(m.globalScore || 0);
    totalScore += score;
    if (score >= 75) mastered++;
    else if (score >= 40) reinforce++;
    else critical++;
  });

  const totalNotions = masteries.length;
  const percentUpToDate = totalNotions > 0
    ? Math.round(totalScore / totalNotions)
    : 0;

  // 3) Progression par matière
  const subjectProgressMap = {};
  masteries.forEach((m) => {
    const s = m.subject;
    if (!SUBJECTS[s]) return;
    if (!subjectProgressMap[s]) subjectProgressMap[s] = { total: 0, score: 0 };
    subjectProgressMap[s].total++;
    subjectProgressMap[s].score += Number(m.globalScore || 0);
  });

  const subjectProgress = Object.entries(subjectProgressMap)
    .map(([key, data]) => ({
      key,
      label: SUBJECTS[key].label,
      icon: SUBJECTS[key].icon,
      percent: data.total > 0 ? Math.round(data.score / data.total) : 0,
      notionsCount: data.total
    }))
    .sort((a, b) => b.percent - a.percent);

  // 4) Cours récents
  const coursesSnap = await db
    .collection('users').doc(uid).collection('courses')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();

  const recentCourses = coursesSnap.docs.map((d) => {
    const c = d.data();
    const courseMasteries = masteries.filter((m) => m.courseId === c.id);
    const courseScore = courseMasteries.length > 0
      ? Math.round(courseMasteries.reduce((sum, m) => sum + Number(m.globalScore || 0), 0) / courseMasteries.length)
      : 0;

    const created = toISO(c.createdAt);
    const days = created ? daysBetween(created, new Date().toISOString()) : 0;
    let addedLabel = 'aujourd\'hui';
    if (days === 1) addedLabel = 'hier';
    else if (days > 1 && days < 30) addedLabel = `il y a ${days} jours`;

    return {
      id: d.id,
      title: c.title || 'Cours',
      subjectLabel: SUBJECTS[c.subject]?.label || '',
      icon: SUBJECTS[c.subject]?.icon || 'fa-book',
      notionsCount: c.notionsCount || courseMasteries.length,
      masteryPercent: courseScore,
      addedLabel
    };
  });

  // 5) Plan du jour
  const todayPlan = await buildTodayPlan(uid, masteries);

  return {
    success: true,
    summary: {
      percentUpToDate,
      totalNotions,
      mastered,
      reinforce,
      critical
    },
    subjectProgress,
    recentCourses,
    todayPlan
  };
}

// ────────────────────────────────────────────────────────────────
// PLAN DU JOUR — ARV-PILOT simplifié (Phase 1)
// ────────────────────────────────────────────────────────────────
async function buildTodayPlan(uid, masteries) {
  const { db } = getAdminServices();
  const now = new Date();

  // 1) Notions dues aujourd'hui (nextReviewAt <= now)
  const dueMasteries = masteries
    .filter((m) => {
      const due = toISO(m.nextReviewAt);
      if (!due) return false;
      return new Date(due).getTime() <= now.getTime();
    })
    .sort((a, b) => {
      // Priorité : score faible > importance élevée > ancienneté
      const scoreDiff = Number(a.globalScore || 0) - Number(b.globalScore || 0);
      if (Math.abs(scoreDiff) > 15) return scoreDiff;
      return new Date(toISO(a.nextReviewAt)).getTime() - new Date(toISO(b.nextReviewAt)).getTime();
    })
    .slice(0, 5);

  // 2) Construire les items
  const plan = dueMasteries.map((m) => {
    const score = Number(m.globalScore || 0);
    let task = 'Réviser';
    let duration = 8;

    if (score < 30) {
      task = 'Revoir la base';
      duration = 12;
    } else if (score < 60) {
      task = 'S\'entraîner';
      duration = 10;
    } else {
      task = 'Réactiver';
      duration = 6;
    }

    return {
      id: m.notionId || m.id,
      kind: 'revision',
      notionId: m.notionId || m.id,
      title: m.title || 'Notion',
      subject: m.subject,
      subjectLabel: SUBJECTS[m.subject]?.label || '',
      icon: SUBJECTS[m.subject]?.icon || 'fa-book',
      duration,
      task,
      score
    };
  });

  // 3) Ajouter un test surprise (1 fois sur 3 si assez de notions)
  if (masteries.length >= 5 && Math.random() < 0.35) {
    plan.push({
      id: 'surprise_test',
      kind: 'surprise_test',
      title: 'Test surprise',
      subjectLabel: 'Toutes matières',
      icon: 'fa-bullseye',
      duration: 6,
      task: 'Commencer'
    });
  }

  return plan;
}

// ────────────────────────────────────────────────────────────────
// SUBMIT QUIZ — Enregistrer les réponses et mettre à jour la maîtrise
// ────────────────────────────────────────────────────────────────
async function submitQuiz(uid, { courseId, answers }) {
  const { db, FieldValue } = getAdminServices();

  if (!courseId || !Array.isArray(answers) || answers.length === 0) {
    throw { status: 400, message: 'Données de quiz invalides.' };
  }

  // 1) Récupérer le cours et ses notions
  const courseRef = db.collection('users').doc(uid).collection('courses').doc(courseId);
  const courseSnap = await courseRef.get();
  if (!courseSnap.exists) throw { status: 404, message: 'Cours introuvable.' };

  // 2) Calculer les résultats par notion
  const notionResults = {}; // notionId → { correct, total }

  answers.forEach((a) => {
    const notionId = a.notionId || courseId;
    if (!notionResults[notionId]) notionResults[notionId] = { correct: 0, total: 0 };
    notionResults[notionId].total++;
    if (a.isCorrect) notionResults[notionId].correct++;
  });

  // 3) Mettre à jour la maîtrise pour chaque notion évaluée
  const batch = db.batch();

  let totalCorrect = 0;
  let totalQuestions = answers.length;

  Object.entries(notionResults).forEach(([notionId, res]) => {
    const ratio = res.total > 0 ? res.correct / res.total : 0;
    const score = Math.round(ratio * 100);

    totalCorrect += res.correct;

    const masteryRef = db.collection('users').doc(uid).collection('mastery').doc(notionId);

    // Mise à jour incrémentale : on prend en compte l'ancien score et on mélange
    batch.set(masteryRef, {
      understanding: FieldValue.increment(score * 0.5),
      memory: FieldValue.increment(score * 0.3),
      recall: FieldValue.increment(score * 0.4),
      application: FieldValue.increment(score * 0.3),
      confidence: FieldValue.increment(score * 0.4),
      globalScore: FieldValue.increment(score * 0.5),
      lastReviewedAt: FieldValue.serverTimestamp(),
      reviewCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Programmer la prochaine révision
    const masterySnap = masteries; // placeholder — pas utilisé ici
    const nextReviewDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const reviewRef = db.collection('users').doc(uid).collection('reviewQueue').doc(notionId);
    batch.set(reviewRef, {
      dueAt: nextReviewDate,
      status: score >= 60 ? 'reviewed' : 'pending',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  // 4) Enregistrer la tentative
  const attemptId = generateId('attempt');
  const attemptRef = db.collection('users').doc(uid).collection('attempts').doc(attemptId);
  batch.set(attemptRef, {
    id: attemptId,
    courseId,
    answers,
    score: totalCorrect,
    total: totalQuestions,
    createdAt: FieldValue.serverTimestamp()
  });

  await batch.commit();

  // 5) Calculer le score global
  const scorePercent = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

  let message = 'Ta maîtrise a été mise à jour.';
  if (scorePercent >= 80) message = 'Excellent ! Niveau de compréhension très élevé.';
  else if (scorePercent >= 60) message = 'Bonne compréhension. Continue comme ça.';
  else if (scorePercent >= 40) message = 'Compréhension partielle. Une révision aidera.';
  else message = 'Revois cette notion bientôt pour consolider.';

  return {
    success: true,
    score: totalCorrect,
    total: totalQuestions,
    percent: scorePercent,
    message
  };
}

// ────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ────────────────────────────────────────────────────────────────
module.exports = async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(204).end();

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  if (rateLimited(clientIp(request))) {
    return jsonError(response, 429, 'Trop de demandes. Réessaie.');
  }

  // Auth
  let user;
  try {
    user = await verifyFirebaseToken(request);
  } catch (e) {
    console.error('[PROGRESS] Auth error:', e.message);
    return jsonError(response, 503, 'Service temporairement indisponible.');
  }

  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action;

  try {
    const { db } = getAdminServices();
    const userSnap = await db.collection('users').doc(user.uid).get();
    const userData = userSnap.data();
    const isPremium = isPremiumUser(userData);

    switch (action) {
      // ═══ ANALYSE D'UN COURS (quotas FREE) ═══
      case 'analyzeCourse': {
        if (!isPremium) {
          const quota = await checkAndIncrementQuota(user.uid, 'course', FREE_COURSE_LIMIT_MONTHLY);
          if (!quota.allowed) {
            return response.status(429).json({
              success: false,
              error: 'Quota mensuel atteint. Passe à Premium pour des captures illimitées.',
              code: 'FREE_COURSE_LIMIT',
              used: quota.used,
              limit: quota.limit
            });
          }
        }
        return response.status(200).json(await analyzeCourse(user.uid, body));
      }

      // ═══ DASHBOARD ═══
      case 'getDashboard': {
        return response.status(200).json(await getDashboard(user.uid));
      }

      // ═══ SOUMETTRE UN QUIZ (quotas FREE) ═══
      case 'submitQuiz': {
        if (!isPremium) {
          const quota = await checkAndIncrementQuota(user.uid, 'quiz', FREE_QUIZ_LIMIT_WEEKLY);
          if (!quota.allowed) {
            return response.status(429).json({
              success: false,
              error: 'Quota hebdomadaire de quiz atteint.',
              code: 'FREE_QUIZ_LIMIT',
              used: quota.used,
              limit: quota.limit
            });
          }
        }
        return response.status(200).json(await submitQuiz(user.uid, body));
      }

      // ═══ À VENIR ═══
      case 'review':
        return jsonError(response, 501, 'Fonctionnalité en cours de développement.');

      case 'surpriseTest':
        return jsonError(response, 501, 'Fonctionnalité en cours de développement.');

      default:
        return jsonError(response, 400, `Action inconnue : "${action}"`);
    }
  } catch (error) {
    console.error(`[PROGRESS] action="${action}" error:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message);
    return jsonError(response, 500, 'Erreur serveur : ' + error.message);
  }
};
