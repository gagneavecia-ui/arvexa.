// ================================================================
// API PLANNER v2.0 — ARVEXA School
// Planificateur Premium alimenté par IA
// Cascade : Groq → OpenRouter → Mistral → Fallback local enrichi
// Cache intelligent + invalidation auto si nouvel examen
// ================================================================

const MAX_REQUESTS_PER_WINDOW = 12;
const requestLog = new Map();

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 heures

const MIN_ATTEMPTS_FOR_SOLID = 5;
const MIN_ATTEMPTS_FOR_LIMITED = 2;

let adminServices;

// ================================================================
// FIREBASE ADMIN
// ================================================================
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

// ================================================================
// UTILITAIRES
// ================================================================
function jsonError(response, status, error, code) {
  return response.status(status).json({ success: false, error, ...(code ? { code } : {}) });
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((time) => now - time < 60000);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
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
  const end =
    data.subscriptionEndDate?.toDate?.() ||
    (data.subscriptionEndDate?.seconds ? new Date(data.subscriptionEndDate.seconds * 1000) : null);
  return !end || end.getTime() > Date.now();
}

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
    histoire_geo: 'histoire_geo', histoiregeo: 'histoire_geo',
    eps: 'eps'
  };
  return map[s] || s;
}

const SUBJECT_LABELS = {
  mathematiques: 'Mathématiques',
  physique: 'Physique',
  chimie: 'Chimie',
  svt: 'SVT',
  francais: 'Français',
  anglais: 'Anglais',
  philosophie: 'Philosophie',
  histoire_geo: 'Histoire-Géo',
  eps: 'EPS'
};

const SUBJECT_ICONS = {
  mathematiques: 'fa-square-root-variable',
  physique: 'fa-bolt',
  chimie: 'fa-flask',
  svt: 'fa-dna',
  francais: 'fa-book-open',
  anglais: 'fa-globe',
  philosophie: 'fa-brain',
  histoire_geo: 'fa-landmark',
  eps: 'fa-person-running'
};

const COEFFICIENTS = {
  mathematiques: 5,
  physique: 3,
  chimie: 2,
  svt: 5,
  francais: 3,
  anglais: 2,
  philosophie: 2,
  histoire_geo: 2,
  eps: 1
};

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds !== undefined) return new Date(value.seconds * 1000);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function round2(n) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

// ================================================================
// AGRÉGATION INTELLIGENTE DES DONNÉES
// ================================================================
function aggregateStudentData(results) {
  // ⚡ Déclaré en premier pour être dispo partout
  const totalAttempts = results.length;

  const grouped = new Map();
  let oldestDate = null;
  let newestDate = null;

  results.forEach((entry) => {
    const key = normalizeSubjectKey(entry.subjectKey || entry.subject) || 'autre';
    if (!grouped.has(key)) {
      grouped.set(key, {
        subjectKey: key,
        label: SUBJECT_LABELS[key] || entry.subject || key,
        icon: SUBJECT_ICONS[key] || 'fa-book',
        coefficient: COEFFICIENTS[key] || 1,
        attempts: 0,
        totalScore: 0,
        scores: [],
        weakChapters: [],
        strongChapters: [],
        advices: [],
        dates: [],
        exams: []
      });
    }

    const item = grouped.get(key);
    const score = Number(entry.score ?? entry.totalScore ?? 0);
    if (!isNaN(score) && score >= 0 && score <= 20) {
      item.attempts += 1;
      item.totalScore += score;
      item.scores.push(score);
      item.exams.push({
        score,
        date: toDate(entry.date || entry.createdAt),
        title: entry.chapterTitle || entry.examTitle || 'Examen'
      });
    }

    if (Array.isArray(entry.difficulties)) {
      entry.difficulties.forEach((diff) => {
        const s = Number(diff.score || 0);
        const max = Number(diff.maxScore || 5);
        const ratio = max > 0 ? s / max : 0;

        const chapterInfo = {
          number: diff.number,
          score: round2(s),
          maxScore: round2(max),
          ratio: round2(ratio),
          advice: String(diff.advice || '').slice(0, 200)
        };

        if (ratio < 0.5) item.weakChapters.push(chapterInfo);
        else if (ratio >= 0.85) item.strongChapters.push(chapterInfo);
      });
    }

    const date = toDate(entry.date || entry.createdAt);
    if (date) {
      item.dates.push(date.getTime());
      if (!oldestDate || date < oldestDate) oldestDate = date;
      if (!newestDate || date > newestDate) newestDate = date;
    }
  });

  // ═══ ANALYSE PAR MATIÈRE ═══
  const subjects = [];
  grouped.forEach((item, key) => {
    const average = item.scores.length > 0
      ? round2(item.scores.reduce((a, b) => a + b, 0) / item.scores.length)
      : null;

    // Évolution 30j
    let evolution = null;
    if (item.exams.length >= 2) {
      const now = Date.now();
      const cutoff = now - 30 * 24 * 60 * 60 * 1000;
      const recent = item.exams.filter((e) => e.date && e.date.getTime() >= cutoff).map((e) => e.score);
      const previous = item.exams.filter((e) => e.date && e.date.getTime() < cutoff).map((e) => e.score);
      if (recent.length > 0 && previous.length > 0) {
        const avgR = recent.reduce((a, b) => a + b, 0) / recent.length;
        const avgP = previous.reduce((a, b) => a + b, 0) / previous.length;
        evolution = round2(avgR - avgP);
      }
    }

    // Dédup chapitres
    const dedup = (arr) => {
      const seen = new Set();
      return arr.filter((c) => {
        if (seen.has(c.number)) return false;
        seen.add(c.number);
        return true;
      });
    };
    item.weakChapters = dedup(item.weakChapters).sort((a, b) => a.ratio - b.ratio).slice(0, 6);
    item.strongChapters = dedup(item.strongChapters).slice(0, 4);

    // Tendance
    let trend = 'stable';
    if (evolution !== null && evolution > 0.5) trend = 'hausse';
    else if (evolution !== null && evolution < -0.5) trend = 'baisse';

    // Score de priorité
    let priorityScore = 0;
    if (average !== null && average < 12) priorityScore += Math.min(40, (12 - average) * 5);
    if (evolution !== null && evolution < -0.5) priorityScore += 15;
    if (item.weakChapters.length >= 2) priorityScore += 15;
    else if (item.weakChapters.length === 1) priorityScore += 8;
    if (item.attempts >= 3) priorityScore += 3; // bonus pour historique fiable
    priorityScore = Math.min(100, Math.round(priorityScore));

    let priorityLevel = 'none';
    if (average === null) priorityLevel = 'none';
    else if (priorityScore >= 55) priorityLevel = 'high';
    else if (priorityScore >= 25) priorityLevel = 'medium';
    else priorityLevel = 'low';

    const priorityLabel = {
      high: 'Urgente',
      medium: 'Importante',
      low: 'Entretien',
      none: 'Aucune donnée'
    }[priorityLevel];

    // Minutes recommandées (proportionnelles au coef et à la priorité)
    const coef = COEFFICIENTS[key] || 1;
    let baseMinutes = 30;
    if (priorityLevel === 'high') baseMinutes = 120;
    else if (priorityLevel === 'medium') baseMinutes = 60;
    const recommendedMinutes = Math.min(180, baseMinutes * Math.ceil(coef / 3));

    subjects.push({
      subjectKey: key,
      subject: item.label,
      icon: item.icon,
      coefficient: coef,
      attempts: item.attempts,
      averageScore: average,
      evolution,
      trend,
      priority: priorityLabel,
      priorityLevel,
      priorityScore,
      recommendedMinutes,
      weakChapters: item.weakChapters,
      strongChapters: item.strongChapters,
      advice: [...new Set(item.advices)].slice(0, 3),
      lastDate: item.dates.length > 0 ? new Date(Math.max(...item.dates)).toISOString() : null
    });
  });

  subjects.sort((a, b) => b.priorityScore - a.priorityScore);

  // ═══ MOYENNE GÉNÉRALE PONDÉRÉE ═══
  let totalWeighted = 0;
  let totalCoef = 0;
  subjects.forEach((s) => {
    if (s.averageScore === null) return;
    totalWeighted += s.averageScore * s.coefficient;
    totalCoef += s.coefficient;
  });
  const generalAverage = totalCoef > 0 ? round2(totalWeighted / totalCoef) : null;

  // ═══ SCORE DE PRÉPARATION (0-100) ═══
  // Combine : moyenne, régularité, évolution, couverture matières
  let readinessScore = 0;
  if (generalAverage !== null) {
    readinessScore = (generalAverage / 20) * 60; // 60 pts max sur la moyenne
  }
  const subjectsWithData = subjects.filter((s) => s.averageScore !== null).length;
  readinessScore += Math.min(20, subjectsWithData * 4); // 20 pts sur la couverture
  const evolutions = subjects.filter((s) => s.evolution !== null);
  if (evolutions.length > 0) {
    const avgEvo = evolutions.reduce((a, b) => a + b.evolution, 0) / evolutions.length;
    readinessScore += Math.min(20, Math.max(-10, avgEvo * 10)); // 20 pts sur l'évolution
  }
  readinessScore = Math.max(0, Math.min(100, Math.round(readinessScore)));

  let readinessLevel = 'insuffisant';
  let readinessLabel = 'Données insuffisantes';
  if (totalAttempts >= 3 && generalAverage !== null) {
    if (readinessScore >= 75) { readinessLevel = 'solide'; readinessLabel = 'Préparation solide'; }
    else if (readinessScore >= 55) { readinessLevel = 'progressing'; readinessLabel = 'En progression'; }
    else { readinessLevel = 'reinforce'; readinessLabel = 'À renforcer'; }
  }

  // ═══ OBJECTIF INTELLIGENT ═══
  // Si l'élève a une moyenne de 8, viser 12 d'un coup est irréaliste.
  // On propose un objectif progressif.
  let targetScore = 12;
  let targetHorizon = '4 semaines';
  if (generalAverage !== null) {
    if (generalAverage < 8) { targetScore = round2(generalAverage + 2); targetHorizon = '6 semaines'; }
    else if (generalAverage < 11) { targetScore = round2(generalAverage + 1.5); targetHorizon = '4 semaines'; }
    else if (generalAverage < 13) { targetScore = round2(Math.min(14, generalAverage + 1)); targetHorizon = '3 semaines'; }
    else if (generalAverage < 15) { targetScore = round2(Math.min(16, generalAverage + 0.5)); targetHorizon = '3 semaines'; }
    else { targetScore = round2(Math.min(18, generalAverage + 0.5)); targetHorizon = '4 semaines'; }
  }

  // ═══ QUALITÉ DES DONNÉES ═══
  let dataQualityLabel = 'Données insuffisantes';
  if (totalAttempts >= MIN_ATTEMPTS_FOR_SOLID) {
    dataQuality = 'solide';
    dataQualityLabel = 'Analyse solide';
  } else if (totalAttempts >= MIN_ATTEMPTS_FOR_LIMITED) {
    dataQuality = 'limitée';
    dataQualityLabel = 'Analyse limitée';
  }

  // ═══ ALERTES ═══
  const alerts = [];
  subjects.forEach((s) => {
    if (s.evolution !== null && s.evolution < -1) {
      alerts.push({
        type: 'danger',
        icon: 'fa-arrow-trend-down',
        title: `${s.subject} en baisse`,
        message: `-${Math.abs(s.evolution)} pt sur les 30 derniers jours`
      });
    }
    if (s.attempts >= 3 && s.averageScore !== null && s.averageScore < 8) {
      alerts.push({
        type: 'warning',
        icon: 'fa-exclamation-triangle',
        title: `${s.subject} critique`,
        message: `Moyenne ${s.averageScore}/20 sur ${s.attempts} examens`
      });
    }
  });
  if (totalAttempts > 0) {
    const lastDate = newestDate;
    if (lastDate) {
      const daysSince = Math.floor((Date.now() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
      if (daysSince > 10) {
        alerts.push({
          type: 'info',
          icon: 'fa-clock',
          title: 'Reprise recommandée',
          message: `Ton dernier examen date de ${daysSince} jours`
        });
      }
    }
  }

  return {
    subjects,
    generalAverage,
    totalAttempts,
    dataQuality,
    dataQualityLabel,
    readinessScore,
    readinessLevel,
    readinessLabel,
    targetScore,
    targetHorizon,
    alerts,
    coefficients: COEFFICIENTS,
    oldestDate: oldestDate ? oldestDate.toISOString() : null,
    newestDate: newestDate ? newestDate.toISOString() : null
  };
}

// ================================================================
// PROMPT IA v2 (ultra-structuré)
// ================================================================
function plannerPrompt(aggregated) {
  const {
    subjects, generalAverage, totalAttempts, dataQuality,
    readinessScore, readinessLabel, targetScore, targetHorizon
  } = aggregated;

  const subjectsSummary = subjects.map((s) => ({
    matiere: s.subject,
    subjectKey: s.subjectKey,
    coefficient: s.coefficient,
    moyenne: s.averageScore !== null ? `${s.averageScore}/20` : 'inconnue',
    tentatives: s.attempts,
    tendance: s.trend,
    evolution_30j: s.evolution !== null ? `${s.evolution > 0 ? '+' : ''}${s.evolution} pt` : 'inconnue',
    priorite_actuelle: s.priority,
    chapitres_faibles: s.weakChapters.map((c) => `Ex${c.number} (${c.score}/${c.maxScore})`),
    chapitres_forts: s.strongChapters.map((c) => `Ex${c.number}`)
  }));

  return `Tu es un coach pédagogique expert du BAC au Niger (Terminale D).
Ta mission : générer un PLAN DE RÉVISION HEBDOMADAIRE COMPLET pour un élève.

═══════════════════════════════════════════════════════════════
CONTEXTE DE L'ÉLÈVE
═══════════════════════════════════════════════════════════════
Examens analysés : ${totalAttempts}
Qualité des données : ${dataQuality}
Moyenne générale pondérée : ${generalAverage !== null ? generalAverage + '/20' : 'non calculable'}
Score de préparation : ${readinessScore}/100 (${readinessLabel})
Objectif calculé par le système : ${targetScore}/20 en ${targetHorizon}

Détail par matière :
${JSON.stringify(subjectsSummary, null, 2)}

═══════════════════════════════════════════════════════════════
MISSION
═══════════════════════════════════════════════════════════════
Produis un plan de révision hebdomadaire sur 7 jours.

RÈGLES CRITIQUES :
1. Priorise les matières "Urgente" et "Importante"
2. Cible SPÉCIFIQUEMENT les chapitres faibles (utilise les numéros d'exercices fournis)
3. Alterne les matières pour éviter la fatigue cognitive
4. Chaque session doit être CONCRÈTE : "Refaire Ex3 (dérivées composées), faire 5 exercices du même type" ≠ "Réviser maths"
5. Si évolution négative → mentionne-la dans le summary
6. Sois encourageant mais honnête : pas de fausses promesses
7. Si données insuffisantes (< 3 examens), propose des actions génériques utiles ET recommande de passer plus d'examens
8. Utilise un ton PROFESSIONNEL et BIENVEILLANT, jamais moralisateur

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT)
═══════════════════════════════════════════════════════════════
{
  "dataQuality": "${dataQuality}",
  "readinessLevel": "${readinessLabel}",
  "summary": "Résumé analytique en 3-4 phrases. Inclut : niveau global, points forts, points faibles, tendance.",
  "weekGoal": "Objectif principal de la semaine, formulé clairement et de façon actionnable.",
  "estimatedGain": "Gain estimé si le plan est suivi (ex: '+1.5 pt en maths')",
  "targetScore": ${targetScore},
  "targetHorizon": "${targetHorizon}",
  "swot": {
    "strengths": ["Force 1", "Force 2"],
    "weaknesses": ["Faiblesse 1", "Faiblesse 2"],
    "opportunities": ["Opportunité 1"],
    "threats": ["Menace 1"]
  },
  "priorities": [
    {
      "subject": "Mathématiques",
      "subjectKey": "mathematiques",
      "averageScore": 11.5,
      "attempts": 3,
      "priority": "Urgente",
      "recommendedMinutes": 120,
      "weakChapters": ["Ex3 - Dérivées composées", "Ex5 - Intégrales"],
      "reason": "Moyenne faible ET en baisse. 2 exercices critiques identifiés."
    }
  ],
  "sessions": [
    {
      "day": 1,
      "subject": "Mathématiques",
      "subjectKey": "mathematiques",
      "durationMinutes": 30,
      "task": "Revoir les dérivées composées (cours + 5 exercices ciblés)",
      "objective": "Maîtriser la règle de dérivation en chaîne",
      "method": "1) Relire le cours 10 min 2) Faire 3 exercices guidés 3) Faire 2 exercices seuls 4) Vérifier les corrections"
    }
  ],
  "weeklyOverview": {
    "totalHours": 4.5,
    "focusSubject": "Mathématiques",
    "secondarySubject": "Physique"
  },
  "encouragement": "Message personnel de 2-3 phrases basé sur l'historique réel de l'élève.",
  "nextReviewDate": "Date suggérée pour refaire un point (format ISO)"
}

CONTRAINTES :
- priorities : 2 à 5 matières (les plus importantes)
- sessions : exactement 7 sessions (une par jour)
- Chaque session entre 20 et 60 minutes
- swot : 2-4 items par catégorie
- Ton professionnel, précis, jamais vague
- Aucune donnée inventée
- Réponds UNIQUEMENT avec l'objet JSON`;
}

// ================================================================
// PROVIDERS IA
// ================================================================
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

// ================================================================
// APPEL IA
// ================================================================
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

// ================================================================
// VALIDATION
// ================================================================
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (typeof plan.summary !== 'string' || plan.summary.length < 20) return false;
  if (typeof plan.weekGoal !== 'string' || plan.weekGoal.length < 10) return false;
  if (!Array.isArray(plan.priorities) || plan.priorities.length < 1) return false;
  if (!Array.isArray(plan.sessions) || plan.sessions.length < 5) return false;

  const validPriority = plan.priorities.every(
    (p) => p && typeof p.subject === 'string' && typeof p.priority === 'string'
  );
  if (!validPriority) return false;

  const validSession = plan.sessions.every(
    (s) => s && typeof s.day === 'number' &&
           typeof s.subject === 'string' &&
           typeof s.task === 'string'
  );
  if (!validSession) return false;

  return true;
}

// ================================================================
// CASCADE IA
// ================================================================
async function generateWithFallback(prompt) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const errors = [];

  for (const provider of providers) {
    try {
      console.log(`[AI-PLANNER] Tentative ${provider.name}...`);
      const plan = await callProvider(provider, prompt);

      if (validatePlan(plan)) {
        console.log(`[AI-PLANNER] ✅ ${provider.name} a généré un plan valide`);
        return plan;
      }

      errors.push(`${provider.name}: structure invalide`);
      console.warn(`[AI-PLANNER] ⚠️ ${provider.name} : structure invalide`);
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI-PLANNER] ❌ ${provider.name} échec: ${error.message}`);
    }
  }

  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ================================================================
// FALLBACK LOCAL ENRICHI
// ================================================================
function buildLocalPlan(aggregated) {
  const {
    subjects, generalAverage, totalAttempts, dataQuality, dataQualityLabel,
    readinessScore, readinessLevel, readinessLabel, targetScore, targetHorizon, alerts
  } = aggregated;

  const priorities = subjects
    .filter((s) => s.averageScore !== null && s.priorityLevel !== 'none')
    .slice(0, 5)
    .map((s) => ({
      subject: s.subject,
      subjectKey: s.subjectKey,
      icon: s.icon,
      averageScore: s.averageScore,
      attempts: s.attempts,
      priority: s.priority,
      recommendedMinutes: s.recommendedMinutes,
      weakChapters: s.weakChapters.map((c) => `Ex${c.number} (${c.score}/${c.maxScore})`),
      reason: s.evolution !== null && s.evolution < -0.5
        ? `Moyenne en baisse (${s.evolution} pt sur 30j)`
        : s.weakChapters.length > 0
          ? `${s.weakChapters.length} chapitre(s) faible(s) identifié(s)`
          : `Moyenne ${s.averageScore}/20`
    }));

  // Construction des sessions
  const sessions = [];
  const prioritySubjects = priorities.length > 0
    ? priorities
    : subjects.filter((s) => s.averageScore !== null).slice(0, 3);

  const getTask = (subject) => {
    if (subject.weakChapters.length > 0) {
      const wc = subject.weakChapters[0];
      return {
        task: `Refaire ${wc} de ${subject.subject} + 3 exercices du même type`,
        objective: `Maîtriser ce chapitre (${wc})`,
        method: '1) Relire le cours 2) Refaire l\'exercice 3) Faire 3 exercices similaires 4) Vérifier'
      };
    }
    if (subject.priority === 'Urgente') {
      return {
        task: `Revoir les bases de ${subject.subject} + 5 exercices progressifs`,
        objective: `Renforcer les fondamentaux`,
        method: '1) Fiche de synthèse 2) Exercices faciles 3) Exercices moyens 4) Auto-évaluation'
      };
    }
    return {
      task: `Consolider ${subject.subject} avec des exercices variés`,
      objective: `Maintenir et progresser`,
      method: '1) Exercices mixtes 2) Chronométrer 3) Corriger'
    };
  };

  for (let day = 1; day <= 7; day++) {
    if (prioritySubjects.length === 0) {
      sessions.push({
        day,
        subject: 'Organisation',
        subjectKey: 'general',
        durationMinutes: 30,
        task: 'Effectuer un premier examen pour créer tes priorités',
        objective: 'Obtenir une première analyse',
        method: 'Va dans Mode Examen, choisis une matière, fais un sujet'
      });
      continue;
    }
    const subject = prioritySubjects[(day - 1) % prioritySubjects.length];
    const taskInfo = getTask(subject);
    sessions.push({
      day,
      subject: subject.subject,
      subjectKey: subject.subjectKey,
      durationMinutes: Math.min(subject.recommendedMinutes || 30, 45),
      ...taskInfo
    });
  }

  // SWOT basique
  const strengths = subjects
    .filter((s) => s.averageScore !== null && s.averageScore >= 14)
    .map((s) => `${s.subject} (${s.averageScore}/20)`);

  const weaknesses = subjects
    .filter((s) => s.averageScore !== null && s.averageScore < 10)
    .map((s) => `${s.subject} (${s.averageScore}/20)`);

  const opportunities = [
    'Des chapitres précis identifiés pour progresser',
    'Un plan structuré = gain de temps'
  ];

  const threats = [];
  subjects.forEach((s) => {
    if (s.evolution !== null && s.evolution < -0.5) {
      threats.push(`${s.subject} en baisse`);
    }
  });
  if (totalAttempts < 3) threats.push('Manque d\'examens pour analyse fiable');

  // Summary
  let summary;
  if (totalAttempts === 0) {
    summary = "Aucun examen enregistré. Commence par un examen pour qu'on puisse analyser ton niveau et te proposer un plan adapté.";
  } else if (totalAttempts < 3) {
    const names = priorities.slice(0, 2).map((p) => p.subject).join(' et ');
    summary = `Analyse basée sur ${totalAttempts} examen${totalAttempts > 1 ? 's' : ''}. ${priorities.length > 0 ? `Tes priorités identifiées : ${names}.` : ''} Passe 2-3 examens supplémentaires pour affiner ton plan.`;
  } else {
    const names = priorities.slice(0, 2).map((p) => p.subject).join(' et ');
    summary = `Analyse basée sur ${totalAttempts} examens. ${generalAverage !== null ? `Moyenne générale : ${generalAverage}/20.` : ''} ${names ? `Priorités actuelles : ${names}.` : 'Toutes les matières sont à niveau équilibré.'}`;
  }

  return {
    dataQuality,
    readinessLevel,
    summary,
    weekGoal: priorities.length > 0
      ? `Renforcer ${priorities[0].subject}${priorities[1] ? ' et ' + priorities[1].subject : ''} en travaillant les chapitres faibles.`
      : "Passer 2 examens supplémentaires pour affiner l'analyse.",
    estimatedGain: priorities.length > 0 && priorities[0].averageScore !== null
      ? `+${Math.min(2, Math.max(0.5, round2((12 - priorities[0].averageScore) * 0.3)))} pt en ${priorities[0].subject}`
      : "Non calculable",
    targetScore,
    targetHorizon,
    swot: { strengths, weaknesses, opportunities, threats },
    priorities,
    sessions,
    weeklyOverview: {
      totalHours: round2(sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60),
      focusSubject: priorities[0]?.subject || 'Général',
      secondarySubject: priorities[1]?.subject || null
    },
    encouragement: generalAverage !== null && generalAverage >= 14
      ? `Bravo pour ton niveau (${generalAverage}/20). Continue pour sécuriser ta réussite.`
      : `Chaque session compte. Tiens ce rythme et tu verras des résultats d'ici 2 semaines.`,
    nextReviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    generatedLocally: true,
    generatedAt: new Date().toISOString()
  };
}

// ================================================================
// CACHE INTELLIGENT (avec invalidation auto si nouvel examen)
// ================================================================
async function getCachedPlan(uid, resultCount) {
  try {
    const { db } = getAdminServices();
    const cacheRef = db.collection('users').doc(uid).collection('plannerCache').doc('current');
    const snapshot = await cacheRef.get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    const cachedAt = toDate(data.cachedAt);
    if (!cachedAt) return null;

    // ⚡ Invalidation si nouvel examen détecté
    if (resultCount && data.resultCount !== undefined && data.resultCount !== resultCount) {
      console.log(`[AI-PLANNER] Cache invalidé : ${data.resultCount} → ${resultCount} examens`);
      return null;
    }

    const age = Date.now() - cachedAt.getTime();
    if (age > CACHE_TTL_MS) return null;

    return data.plan || null;
  } catch (_) {
    return null;
  }
}

async function savePlanToCache(uid, plan, resultCount) {
  try {
    const { db, FieldValue } = getAdminServices();
    const cacheRef = db.collection('users').doc(uid).collection('plannerCache').doc('current');
    await cacheRef.set({
      plan,
      resultCount,
      cachedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn('Cache save failed:', e.message);
  }
}

// ================================================================
// HANDLER
// ================================================================
module.exports = async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  if (rateLimited(clientIp(request))) {
    return jsonError(response, 429, 'Trop de demandes. Réessaie dans une minute.');
  }

  let user;
  try {
    user = await verifyFirebaseToken(request);
  } catch (_) {
    user = null;
  }

  if (!user) {
    return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');
  }

  try {
    const { db } = getAdminServices();
    const uid = user.uid;

    // Premium check
    const userSnapshot = await db.collection('users').doc(uid).get();
    if (!isPremiumUser(userSnapshot.data())) {
      return jsonError(response, 403, 'Le planificateur est réservé aux comptes Premium.', 'PREMIUM_REQUIRED');
    }

    // Récupérer les examens
    const snapshot = await db.collection('users').doc(uid)
      .collection('examResults')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const results = snapshot.docs.map((d) => d.data());
    const resultCount = results.length;

    // Check cache
    const forceRefresh = request.query?.refresh === 'true' || request.body?.refresh === true;
    if (!forceRefresh) {
      const cached = await getCachedPlan(uid, resultCount);
      if (cached) {
        console.log('[AI-PLANNER] ✅ Plan servi depuis le cache');
        return response.status(200).json({
          success: true,
          plan: cached,
          resultCount,
          cached: true
        });
      }
    }

    // Agréger
    const aggregated = aggregateStudentData(results);
    console.log(`[AI-PLANNER] ${resultCount} examens, qualité: ${aggregated.dataQuality}, readiness: ${aggregated.readinessScore}`);

    // Tentative IA
    let plan;
    let aiSucceeded = false;

    try {
      const prompt = plannerPrompt(aggregated);
      plan = await generateWithFallback(prompt);
      aiSucceeded = true;
      console.log('[AI-PLANNER] ✅ Plan IA généré');
    } catch (aiError) {
      console.warn('[AI-PLANNER] ⚠️ Fallback local:', aiError.message);
      plan = buildLocalPlan(aggregated);
    }

    // Enrichir avec métadonnées calculées côté serveur
    const enrichedPlan = {
      ...plan,
      _meta: {
        resultCount,
        dataQuality: aggregated.dataQuality,
        dataQualityLabel: aggregated.dataQualityLabel,
        generalAverage: aggregated.generalAverage,
        readinessScore: aggregated.readinessScore,
        readinessLevel: aggregated.readinessLevel,
        readinessLabel: aggregated.readinessLabel,
        targetScore: aggregated.targetScore,
        targetHorizon: aggregated.targetHorizon,
        alerts: aggregated.alerts,
        aiGenerated: aiSucceeded,
        generatedAt: new Date().toISOString()
      }
    };

    await savePlanToCache(uid, enrichedPlan, resultCount);

    return response.status(200).json({
      success: true,
      plan: enrichedPlan,
      resultCount,
      aiGenerated: aiSucceeded,
      cached: false
    });

  } catch (error) {
    console.error('[AI-PLANNER] Erreur critique:', error.message);
    return jsonError(response, 503, 'Le planificateur est temporairement indisponible. Réessaie dans quelques minutes.');
  }
};

module.exports.config = { maxDuration: 60 };
