// ================================================================
// API PLANNER — ARVEXA School
// Planificateur Premium alimenté par IA (Groq → OpenRouter → Mistral)
// Analyse les examens de l'élève et génère un plan de révision personnalisé
// ================================================================

const MAX_REQUESTS_PER_WINDOW = 12;
const requestLog = new Map();

// ⚡ Cache des plans pour éviter les appels IA redondants
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 heures

// ⚡ Seuil pour considérer les données comme "solides"
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

// ⚡ Normalise le nom de matière (ex: "Mathématiques" → "mathematiques")
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
// AGRÉGATION DES DONNÉES DE L'ÉLÈVE
// ================================================================
// Construit un résumé analytique complet : moyennes par matière,
// points faibles par chapitre, évolution 30j, qualité des données
function aggregateStudentData(results) {
  const grouped = new Map();

  // ⚡ Groupement par matière
  results.forEach((entry) => {
    const key = normalizeSubjectKey(entry.subjectKey || entry.subject) || 'autre';
    if (!grouped.has(key)) {
      grouped.set(key, {
        subjectKey: key,
        label: SUBJECT_LABELS[key] || entry.subject || key,
        attempts: 0,
        totalScore: 0,
        scores: [],
        weakChapters: [],
        strongChapters: [],
        advices: [],
        lastDate: null,
        dates: []
      });
    }

    const item = grouped.get(key);
    const score = Number(entry.score ?? entry.totalScore ?? 0);
    if (!isNaN(score) && score >= 0 && score <= 20) {
      item.attempts += 1;
      item.totalScore += score;
      item.scores.push(score);
    }

    // ⚡ Extraction des chapitres faibles / forts depuis difficulties
    if (Array.isArray(entry.difficulties)) {
      entry.difficulties.forEach((diff) => {
        const s = Number(diff.score || 0);
        const max = Number(diff.maxScore || 5);
        const ratio = max > 0 ? s / max : 0;

        const chapterInfo = {
          number: diff.number,
          score: s,
          maxScore: max,
          advice: String(diff.advice || '').slice(0, 200)
        };

        if (ratio < 0.5) {
          item.weakChapters.push(chapterInfo);
        } else if (ratio >= 0.85) {
          item.strongChapters.push(chapterInfo);
        }
      });
    }

    // ⚡ Récupérer les advice texte
    if (Array.isArray(entry.difficulties)) {
      entry.difficulties.forEach((d) => {
        if (d.advice) item.advices.push(String(d.advice).slice(0, 200));
      });
    }

    const date = toDate(entry.date || entry.createdAt);
    if (date) {
      item.dates.push(date.getTime());
      item.lastDate = date;
    }
  });

  // ⚡ Calcul des moyennes, évolutions, priorités
  const subjects = [];
  grouped.forEach((item, key) => {
    const average = item.scores.length > 0
      ? round2(item.scores.reduce((a, b) => a + b, 0) / item.scores.length)
      : null;

    // ⚡ Évolution sur 30 jours
    let evolution = null;
    if (item.dates.length >= 2) {
      const now = Date.now();
      const cutoff = now - 30 * 24 * 60 * 60 * 1000;
      const recent = [];
      const previous = [];
      results.forEach((r) => {
        const rKey = normalizeSubjectKey(r.subjectKey || r.subject);
        if (rKey !== key) return;
        const d = toDate(r.date || r.createdAt);
        const s = Number(r.score ?? r.totalScore ?? 0);
        if (!d || isNaN(s)) return;
        if (d.getTime() >= cutoff) recent.push(s);
        else previous.push(s);
      });
      if (recent.length > 0 && previous.length > 0) {
        const avgR = recent.reduce((a, b) => a + b, 0) / recent.length;
        const avgP = previous.reduce((a, b) => a + b, 0) / previous.length;
        evolution = round2(avgR - avgP);
      }
    }

    // ⚡ Dédup des chapitres faibles (par numéro)
    const seenWeak = new Set();
    item.weakChapters = item.weakChapters
      .filter((c) => {
        if (seenWeak.has(c.number)) return false;
        seenWeak.add(c.number);
        return true;
      })
      .slice(0, 5);

    const seenStrong = new Set();
    item.strongChapters = item.strongChapters
      .filter((c) => {
        if (seenStrong.has(c.number)) return false;
        seenStrong.add(c.number);
        return true;
      })
      .slice(0, 3);

    // ⚡ Calcul du score de priorité
    let priorityScore = 0;
    if (average !== null && average < 12) {
      priorityScore += Math.min(40, (12 - average) * 5);
    }
    if (evolution !== null && evolution < -0.5) {
      priorityScore += 15;
    }
    if (item.weakChapters.length >= 2) {
      priorityScore += 15;
    } else if (item.weakChapters.length === 1) {
      priorityScore += 8;
    }

    let priorityLevel = 'none';
    if (average === null) priorityLevel = 'none';
    else if (priorityScore >= 55) priorityLevel = 'high';
    else if (priorityScore >= 25) priorityLevel = 'medium';
    else priorityLevel = 'low';

    // ⚡ Type de priorité lisible
    let priorityLabel = 'Aucune donnée';
    if (priorityLevel === 'high') priorityLabel = 'Urgente';
    else if (priorityLevel === 'medium') priorityLabel = 'Importante';
    else if (priorityLevel === 'low') priorityLabel = 'Entretien';

    // ⚡ Minutes recommandées basées sur priorité
    let recommendedMinutes = 30;
    if (priorityLevel === 'high') recommendedMinutes = 120;
    else if (priorityLevel === 'medium') recommendedMinutes = 60;
    else if (priorityLevel === 'low') recommendedMinutes = 30;

    subjects.push({
      subjectKey: key,
      subject: item.label,
      attempts: item.attempts,
      averageScore: average,
      evolution,
      priority: priorityLabel,
      priorityLevel,
      priorityScore: Math.round(priorityScore),
      recommendedMinutes,
      weakChapters: item.weakChapters,
      strongChapters: item.strongChapters,
      advice: [...new Set(item.advices)].slice(0, 3),
      lastDate: item.lastDate ? item.lastDate.toISOString() : null
    });
  });

  // ⚡ Tri par priorité (plus haute en premier)
  subjects.sort((a, b) => b.priorityScore - a.priorityScore);

  // ⚡ Moyenne générale pondérée
  let totalWeighted = 0;
  let totalCoef = 0;
  subjects.forEach((s) => {
    if (s.averageScore === null) return;
    const coef = COEFFICIENTS[s.subjectKey] || 1;
    totalWeighted += s.averageScore * coef;
    totalCoef += coef;
  });
  const generalAverage = totalCoef > 0 ? round2(totalWeighted / totalCoef) : null;

  // ⚡ Qualité des données
  const totalAttempts = results.length;
  let dataQuality = 'insuffisante';
  let dataQualityLabel = 'Données insuffisantes';
  if (totalAttempts >= MIN_ATTEMPTS_FOR_SOLID) {
    dataQuality = 'solide';
    dataQualityLabel = 'Analyse solide';
  } else if (totalAttempts >= MIN_ATTEMPTS_FOR_LIMITED) {
    dataQuality = 'limitée';
    dataQualityLabel = 'Analyse limitée';
  }

  return {
    subjects,
    generalAverage,
    totalAttempts,
    dataQuality,
    dataQualityLabel,
    coefficients: COEFFICIENTS
  };
}

// ================================================================
// PROMPT IA POUR LE PLANIFICATEUR
// ================================================================
function plannerPrompt(aggregated) {
  const { subjects, generalAverage, totalAttempts, dataQuality } = aggregated;

  const subjectsSummary = subjects.map((s) => ({
    matiere: s.subject,
    moyenne: s.averageScore !== null ? `${s.averageScore}/20` : 'inconnue',
    tentatives: s.attempts,
    evolution_30j: s.evolution !== null ? `${s.evolution > 0 ? '+' : ''}${s.evolution} pt` : 'inconnue',
    priorite_actuelle: s.priority,
    chapitres_faibles: s.weakChapters.map((c) => `Ex${c.number} (${c.score}/${c.maxScore})`),
    chapitres_forts: s.strongChapters.map((c) => `Ex${c.number}`),
    conseils_detectes: s.advice.slice(0, 2)
  }));

  return `Tu es un coach pédagogique expert du BAC au Niger (Terminale D).
Ta mission : générer un PLAN DE RÉVISION HEBDOMADAIRE personnalisé pour un élève, à partir de ses résultats d'examens.

═══════════════════════════════════════════════════════════════
DONNÉES DE L'ÉLÈVE
═══════════════════════════════════════════════════════════════
Nombre total d'examens analysés : ${totalAttempts}
Qualité des données : ${dataQuality}
Moyenne générale pondérée : ${generalAverage !== null ? generalAverage + '/20' : 'non calculable'}

Détail par matière :
${JSON.stringify(subjectsSummary, null, 2)}

═══════════════════════════════════════════════════════════════
MISSION
═══════════════════════════════════════════════════════════════
Produis un plan de révision hebdomadaire (7 jours) sur mesure.

RÈGLES :
1. Priorise les matières avec priorité "Urgente" ou "Importante"
2. Cible les chapitres faibles identifiés (via chapitres_faibles)
3. Alterne les matières pour éviter la fatigue
4. Sois SPÉCIFIQUE : "Refaire Ex3 dérivées composées" ≠ "Réviser maths"
5. Tiens compte de l'évolution : si une matière baisse, c'est urgent
6. Si les données sont insuffisantes (< 3 examens), dis-le et propose des actions génériques mais utiles
7. Ton encourageant et personnalisé, jamais moralisateur

═══════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE (JSON UNIQUEMENT, sans markdown)
═══════════════════════════════════════════════════════════════
{
  "dataQuality": "${dataQuality}",
  "summary": "Résumé en 2-3 phrases de la situation de l'élève. Inclure les points forts et faibles principaux.",
  "weekGoal": "Objectif principal de la semaine, formulé clairement en 1-2 phrases.",
  "estimatedGain": "Gain estimé si l'élève suit le plan (ex: '+1.5 pt en maths')",
  "priorities": [
    {
      "subject": "Mathématiques",
      "subjectKey": "mathematiques",
      "averageScore": 11.5,
      "attempts": 3,
      "priority": "Urgente",
      "recommendedMinutes": 120,
      "weakChapters": ["Dérivées composées", "Intégrales"],
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
      "objective": "Maîtriser la règle de dérivation en chaîne"
    }
  ],
  "encouragement": "Message personnel court et motivant (1-2 phrases)."
}

CONTRAINTES :
- priorities : 2 à 5 matières max (les plus importantes)
- sessions : exactement 7 sessions (une par jour)
- Chaque session = 20 à 45 minutes (réaliste pour un élève)
- Français clair, ton direct et bienveillant
- Aucune donnée inventée : si une info est manquante, ne l'invente pas
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
// APPEL IA (avec timeout + Mistral sans response_format)
// ================================================================
async function callProvider(provider, prompt, maxTokens = 3000) {
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

    // ⚡ Mistral ne supporte PAS response_format:json_object
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
// VALIDATION DE LA STRUCTURE DU PLAN
// ================================================================
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (typeof plan.summary !== 'string' || plan.summary.length < 10) return false;
  if (typeof plan.weekGoal !== 'string' || plan.weekGoal.length < 10) return false;
  if (!Array.isArray(plan.priorities) || plan.priorities.length < 1) return false;
  if (!Array.isArray(plan.sessions) || plan.sessions.length < 5) return false;

  // ⚡ Vérifier que chaque priorité a les champs requis
  const validPriority = plan.priorities.every(
    (p) => p && typeof p.subject === 'string' && typeof p.priority === 'string'
  );
  if (!validPriority) return false;

  // ⚡ Vérifier que chaque session a les champs requis
  const validSession = plan.sessions.every(
    (s) => s && typeof s.day === 'number' &&
           typeof s.subject === 'string' &&
           typeof s.task === 'string'
  );
  if (!validSession) return false;

  return true;
}

// ================================================================
// GÉNÉRATION AVEC CASCADE IA + VALIDATION DANS LA BOUCLE
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
      console.warn(`[AI-PLANNER] ⚠️ ${provider.name} : structure invalide, on essaie le suivant`);

    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI-PLANNER] ❌ ${provider.name} échec: ${error.message}`);
    }
  }

  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ================================================================
// FALLBACK LOCAL ENRICHI (basé sur les vraies données, pas figé)
// ================================================================
function buildLocalPlan(aggregated) {
  const { subjects, generalAverage, totalAttempts, dataQuality, dataQualityLabel } = aggregated;

  // ⚡ Priorités basées sur les vraies données
  const priorities = subjects
    .filter((s) => s.averageScore !== null && s.priorityLevel !== 'none')
    .slice(0, 4)
    .map((s) => ({
      subject: s.subject,
      subjectKey: s.subjectKey,
      averageScore: s.averageScore,
      attempts: s.attempts,
      priority: s.priority,
      recommendedMinutes: s.recommendedMinutes,
      weakChapters: s.weakChapters.map((c) => `Exercice ${c.number}`),
      reason: s.evolution !== null && s.evolution < -0.5
        ? `Moyenne en baisse (${s.evolution} pt sur 30j)`
        : s.weakChapters.length > 0
          ? `${s.weakChapters.length} chapitre(s) faible(s) identifié(s)`
          : `Moyenne ${s.averageScore}/20`
    }));

  // ⚡ Sessions : on construit une semaine équilibrée
  const sessions = [];
  const prioritySubjects = priorities.length > 0
    ? priorities
    : subjects.filter((s) => s.averageScore !== null).slice(0, 3);

  const tasksByPriority = {
    'Urgente': (s) => s.weakChapters.length > 0
      ? `Refaire ${s.weakChapters[0].number ? 'Ex' + s.weakChapters[0].number : 'les exercices faibles'} de ${s.subject}`
      : `Revoir les bases de ${s.subject}`,
    'Importante': (s) => s.weakChapters.length > 0
      ? `S'entraîner sur les points faibles de ${s.subject}`
      : `Consolider ${s.subject}`,
    'Entretien': (s) => `Maintenir le niveau en ${s.subject} (exercices variés)`
  };

  for (let day = 1; day <= 7; day++) {
    if (prioritySubjects.length === 0) {
      sessions.push({
        day,
        subject: 'Organisation',
        subjectKey: 'general',
        durationMinutes: 30,
        task: 'Effectuer un premier examen pour créer tes priorités',
        objective: 'Obtenir une première analyse de ton niveau'
      });
      continue;
    }

    // ⚡ Alterner les matières (round-robin)
    const subject = prioritySubjects[(day - 1) % prioritySubjects.length];
    const taskFn = tasksByPriority[subject.priority] || tasksByPriority['Entretien'];

    sessions.push({
      day,
      subject: subject.subject,
      subjectKey: subject.subjectKey,
      durationMinutes: Math.min(subject.recommendedMinutes, 45),
      task: taskFn(subject),
      objective: `Progresser de 0.5 à 1 pt d'ici 2 semaines`
    });
  }

  // ⚡ Résumé basé sur les vraies données
  let summary;
  if (totalAttempts === 0) {
    summary = "Tu n'as encore passé aucun examen. Fais-en un pour qu'on puisse analyser ton niveau et te donner un plan personnalisé.";
  } else if (totalAttempts < 3) {
    const list = priorities.slice(0, 2).map((p) => p.subject).join(' et ');
    summary = `Analyse basée sur ${totalAttempts} examen${totalAttempts > 1 ? 's' : ''}. ${priorities.length > 0 ? `Concentre-toi en priorité sur ${list}.` : 'Continue à passer des examens pour affiner ton plan.'} Fais 2-3 examens supplémentaires pour un plan plus précis.`;
  } else {
    const list = priorities.slice(0, 2).map((p) => p.subject).join(' et ');
    summary = `Analyse basée sur ${totalAttempts} examens. ${list ? `Priorités actuelles : ${list}.` : 'Toutes les matières sont à niveau équilibré.'} ${generalAverage !== null ? `Moyenne générale : ${generalAverage}/20.` : ''}`;
  }

  // ⚡ Objectif de la semaine
  const weekGoal = priorities.length > 0
    ? `Renforcer ${priorities[0].subject}${priorities[1] ? ' et ' + priorities[1].subject : ''} en travaillant les chapitres faibles identifiés.`
    : "Passer 2 examens supplémentaires pour affiner ton analyse.";

  // ⚡ Gain estimé
  const estimatedGain = priorities.length > 0 && priorities[0].averageScore !== null
    ? `+${Math.min(2, Math.max(0.5, round2((12 - priorities[0].averageScore) * 0.3)))} pt en ${priorities[0].subject} avec 6h de travail ciblé`
    : "Gain non calculable sans plus de données";

  // ⚡ Encouragement
  let encouragement;
  if (totalAttempts === 0) {
    encouragement = "Commence par un examen, tu verras, c'est rapide et ça t'aide vraiment à progresser.";
  } else if (priorities.length > 0 && priorities[0].priority === 'Urgente') {
    encouragement = `Tu as identifié des faiblesses, c'est déjà un grand pas. En suivant ce plan, tu peux remonter rapidement.`;
  } else if (generalAverage !== null && generalAverage >= 14) {
    encouragement = `Bravo pour ton niveau actuel (${generalAverage}/20). Continue sur cette lancée pour sécuriser ta réussite.`;
  } else {
    encouragement = `Chaque session compte. Tiens ce rythme et tu verras des résultats d'ici 2 semaines.`;
  }

  return {
    dataQuality,
    dataQualityLabel,
    summary,
    weekGoal,
    estimatedGain,
    priorities,
    sessions,
    encouragement,
    generatedLocally: true,
    generatedAt: new Date().toISOString()
  };
}

// ================================================================
// CACHE FIRESTORE (6h)
// ================================================================
async function getCachedPlan(uid) {
  try {
    const { db } = getAdminServices();
    const cacheRef = db.collection('users').doc(uid).collection('plannerCache').doc('current');
    const snapshot = await cacheRef.get();
    if (!snapshot.exists) return null;

    const data = snapshot.data();
    const cachedAt = toDate(data.cachedAt);
    if (!cachedAt) return null;

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

    // ⚡ 1. Vérifier que c'est un compte Premium
    const userSnapshot = await db.collection('users').doc(uid).get();
    if (!isPremiumUser(userSnapshot.data())) {
      return jsonError(response, 403, 'Le planificateur est réservé aux comptes Premium.', 'PREMIUM_REQUIRED');
    }

    // ⚡ 2. Vérifier le cache (6h)
    const forceRefresh = request.query?.refresh === 'true' || request.body?.refresh === true;
    if (!forceRefresh) {
      const cached = await getCachedPlan(uid);
      if (cached) {
        console.log('[AI-PLANNER] ✅ Plan servi depuis le cache');
        return response.status(200).json({
          success: true,
          plan: cached,
          resultCount: cached._resultCount || 0,
          cached: true
        });
      }
    }

    // ⚡ 3. Récupérer les examens
    const snapshot = await db.collection('users').doc(uid)
      .collection('examResults')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const results = snapshot.docs.map((document) => document.data());

    // ⚡ 4. Agréger les données
    const aggregated = aggregateStudentData(results);
    console.log(`[AI-PLANNER] ${results.length} examens analysés, qualité: ${aggregated.dataQuality}`);

    // ⚡ 5. Tentative IA
    let plan;
    let aiSucceeded = false;

    try {
      const prompt = plannerPrompt(aggregated);
      plan = await generateWithFallback(prompt);
      aiSucceeded = true;
      console.log('[AI-PLANNER] ✅ Plan IA généré');
    } catch (aiError) {
      console.warn('[AI-PLANNER] ⚠️ Échec IA, fallback local:', aiError.message);
      plan = buildLocalPlan(aggregated);
    }

    // ⚡ 6. Enrichir avec des métadonnées
    const enrichedPlan = {
      ...plan,
      _resultCount: results.length,
      _dataQuality: aggregated.dataQuality,
      _dataQualityLabel: aggregated.dataQualityLabel,
      _generalAverage: aggregated.generalAverage,
      _aiGenerated: aiSucceeded,
      _generatedAt: new Date().toISOString()
    };

    // ⚡ 7. Sauvegarder en cache
    await savePlanToCache(uid, enrichedPlan, results.length);

    // ⚡ 8. Renvoyer
    return response.status(200).json({
      success: true,
      plan: enrichedPlan,
      resultCount: results.length,
      aiGenerated: aiSucceeded,
      cached: false
    });

  } catch (error) {
    console.error('[AI-PLANNER] Erreur critique:', error.message);
    return jsonError(response, 503, 'Le planificateur est temporairement indisponible. Réessaie dans quelques minutes.');
  }
};

// ⚡ Limite Vercel (60 s)
module.exports.config = { maxDuration: 60 };
