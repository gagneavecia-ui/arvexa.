// ================================================================
// API PILOT — ARVEXA School
// Agrège toutes les données de l'élève pour ARV-PILOT
// Lit : examResults, revisionSessions, grades
// Renvoie : statistiques complètes par matière
// ================================================================

const MAX_REQUESTS_PER_WINDOW = 15;
const requestLog = new Map();

let adminServices;

function getAdminServices() {
  if (adminServices) return adminServices;
  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials) throw new Error('firebase_admin_not_configured');
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(credentials);
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  adminServices = { auth: admin.auth(), db: admin.firestore() };
  return adminServices;
}

function jsonError(response, status, error, code) {
  return response.status(status).json({ success: false, error, ...(code ? { code } : {}) });
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
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

// ═══════════════════════════════════════════════════════════════
// COEFFICIENTS
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// NORMALISATION MATIÈRE
// ═══════════════════════════════════════════════════════════════
function normalizeSubjectName(raw) {
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

// ═══════════════════════════════════════════════════════════════
// AGRÉGATION
// ═══════════════════════════════════════════════════════════════
function buildPilotData(examResults, revisionSessions, grades) {
  const subjectKeys = Object.keys(COEFFICIENTS);
  const subjectStats = {};

  subjectKeys.forEach((subject) => {
    const scores = [];
    let evaluations = 0;
    let exercisesTotal = 0;
    let exercisesSuccess = 0;
    let revisionTime = 0;
    const chapters = new Set();
    const dates = [];

    // ── Examens ─────────────────────────────
    examResults.forEach((r) => {
      if (normalizeSubjectName(r.subject) !== subject) return;

      const score = Number(r.score);
      if (!isNaN(score) && score >= 0 && score <= 20) {
        scores.push(score);
        evaluations++;
      }

      const diff = Array.isArray(r.difficulties) ? r.difficulties : [];
      diff.forEach((d) => {
        exercisesTotal++;
        const s = Number(d.score) || 0;
        const max = Number(d.maxScore) || 5;
        if (s / max >= 0.5) exercisesSuccess++;
      });

      if (r.chapter && r.chapter !== 'all') chapters.add(r.chapter);

      const date = r.createdAt?.toDate?.() || r.createdAt;
      if (date) dates.push(new Date(date).getTime());
    });

    // ── Quiz (reviseur) ─────────────────────
    revisionSessions.forEach((s) => {
      if (s.type !== 'quiz_result') return;
      if (normalizeSubjectName(s.subject) !== subject) return;

      const score = Number(s.score);
      if (!isNaN(score) && score >= 0 && score <= 20) {
        scores.push(score);
        evaluations++;
      }

      exercisesTotal += Number(s.total) || 0;
      exercisesSuccess += Number(s.correct) || 0;

      if (s.chapter) chapters.add(s.chapter);

      const date = s.createdAt?.toDate?.() || s.createdAt;
      if (date) dates.push(new Date(date).getTime());
    });

    // ── Temps de révision ────────────────────
    revisionSessions.forEach((s) => {
      if (normalizeSubjectName(s.subject) !== subject) return;
      revisionTime += Number(s.duration) || 0;
    });

    // ── Notes manuelles ─────────────────────
    grades.forEach((g) => {
      if (normalizeSubjectName(g.subject) !== subject) return;

      const score = Number(g.score);
      const max = Number(g.maxScore) || 20;
      if (!isNaN(score) && max > 0) {
        scores.push((score / max) * 20);
        evaluations++;
      }

      if (g.chapter) chapters.add(g.chapter);

      const date = g.date?.toDate?.() || g.createdAt?.toDate?.() || g.date;
      if (date) dates.push(new Date(date).getTime());
    });

    // ── Moyennes ────────────────────────────
    const average = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
      : null;

    const successRate = exercisesTotal > 0
      ? Math.round((exercisesSuccess / exercisesTotal) * 100)
      : null;

    // ── Évolution 30 jours ──────────────────
    const now = Date.now();
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const recent = [];
    const previous = [];

    // ⚠️ On regroupe les scores avec leur date
    const datedScores = [];
    examResults.forEach((r) => {
      if (normalizeSubjectName(r.subject) !== subject) return;
      const score = Number(r.score);
      const date = r.createdAt?.toDate?.() || r.createdAt;
      if (!isNaN(score) && date) datedScores.push({ score, time: new Date(date).getTime() });
    });
    revisionSessions.forEach((s) => {
      if (s.type !== 'quiz_result') return;
      if (normalizeSubjectName(s.subject) !== subject) return;
      const score = Number(s.score);
      const date = s.createdAt?.toDate?.() || s.createdAt;
      if (!isNaN(score) && date) datedScores.push({ score, time: new Date(date).getTime() });
    });

    datedScores.forEach((x) => {
      if (x.time >= cutoff) recent.push(x.score);
      else previous.push(x.score);
    });

    let evolution = null;
    if (recent.length > 0 && previous.length > 0) {
      const avgR = recent.reduce((a, b) => a + b, 0) / recent.length;
      const avgP = previous.reduce((a, b) => a + b, 0) / previous.length;
      evolution = Math.round((avgR - avgP) * 100) / 100;
    }

    // ── Priorité ────────────────────────────
    let priorityScore = 0;
    const reasons = [];

    if (average !== null && average < 12) {
      priorityScore += Math.min(40, (12 - average) * 5);
      reasons.push(`Moyenne faible (${average.toFixed(2)}/20)`);
    }
    if (successRate !== null && successRate < 70) {
      priorityScore += Math.min(30, (70 - successRate) * 0.6);
      reasons.push(`Taux de réussite faible (${successRate}%)`);
    }
    if (evaluations === 0) {
      reasons.push('Aucune évaluation');
    }
    const lastDate = dates.length > 0 ? Math.max(...dates) : null;
    if (lastDate) {
      const daysSince = Math.floor((now - lastDate) / (24 * 60 * 60 * 1000));
      if (daysSince > 10) {
        priorityScore += Math.min(15, (daysSince - 10) * 0.5);
        reasons.push(`Non travaillé depuis ${daysSince} jours`);
      }
    }

    let priorityLevel = 'none';
    if (average === null && successRate === null) priorityLevel = 'none';
    else if (priorityScore >= 55) priorityLevel = 'high';
    else if (priorityScore >= 25) priorityLevel = 'medium';
    else priorityLevel = 'low';

    subjectStats[subject] = {
      subject,
      average,
      evaluations,
      exercisesTotal,
      exercisesSuccess,
      successRate,
      evolution,
      revisionTime,
      chaptersCount: chapters.size,
      priority: { level: priorityLevel, score: Math.round(priorityScore), reasons },
      lastWorkDate: lastDate ? new Date(lastDate).toISOString() : null
    };
  });

  // ── Moyenne générale pondérée ─────────────
  let totalWeighted = 0;
  let totalCoef = 0;
  Object.entries(subjectStats).forEach(([subject, stats]) => {
    if (stats.average === null) return;
    const coef = COEFFICIENTS[subject] || 1;
    totalWeighted += stats.average * coef;
    totalCoef += coef;
  });
  const generalAverage = totalCoef > 0
    ? Math.round((totalWeighted / totalCoef) * 100) / 100
    : null;

  // ── Stats globales ────────────────────────
  let globalExercises = 0;
  let globalSuccess = 0;
  let globalTime = 0;
  Object.values(subjectStats).forEach((s) => {
    globalExercises += s.exercisesTotal;
    globalSuccess += s.exercisesSuccess;
    globalTime += s.revisionTime;
  });

  const globalSuccessRate = globalExercises > 0
    ? Math.round((globalSuccess / globalExercises) * 100)
    : null;

  // ── Data points ───────────────────────────
  const dataPoints = examResults.length + revisionSessions.length + grades.length;

  // ── Préparation ───────────────────────────
  let readiness = { level: 'insufficient', label: 'Données insuffisantes' };
  if (dataPoints >= 5 && generalAverage !== null) {
    if (generalAverage >= 14) readiness = { level: 'solid', label: 'Préparation solide' };
    else if (generalAverage >= 11) readiness = { level: 'progressing', label: 'En progression' };
    else readiness = { level: 'reinforce', label: 'À renforcer' };
  }

  // ── Plan d'action ─────────────────────────
  const priorities = Object.values(subjectStats)
    .filter((s) => s.priority.level === 'high' || s.priority.level === 'medium')
    .sort((a, b) => b.priority.score - a.priority.score);

  const actionPlan = priorities.slice(0, 3).map((s) => ({
    subject: s.subject,
    level: s.priority.level,
    reason: s.priority.reasons[0] || 'À travailler',
    action: s.average !== null && s.average < 10
      ? 'Revoir les bases'
      : s.successRate !== null && s.successRate < 60
        ? 'Faire 5 exercices ciblés'
        : 'Réviser les notions clés'
  }));

  return {
    generalAverage,
    subjectStats,
    globalStats: {
      exercisesTotal: globalExercises,
      exercisesSuccess: globalSuccess,
      successRate: globalSuccessRate,
      revisionTime: globalTime,
      evaluations: examResults.length + revisionSessions.filter((s) => s.type === 'quiz_result').length + grades.length
    },
    dataPoints,
    readiness,
    actionPlan,
    meta: {
      examCount: examResults.length,
      quizCount: revisionSessions.filter((s) => s.type === 'quiz_result').length,
      gradeCount: grades.length
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
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

    // ─── Récupérer les 3 collections en parallèle ───
    const [examSnap, revisionSnap, gradesSnap] = await Promise.all([
      db.collection('users').doc(uid).collection('examResults')
        .orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ docs: [] })),
      db.collection('users').doc(uid).collection('revisionSessions')
        .orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ docs: [] })),
      db.collection('users').doc(uid).collection('grades')
        .orderBy('date', 'desc').limit(100).get().catch(() => ({ docs: [] }))
    ]);

    const examResults = examSnap.docs.map((d) => d.data());
    const revisionSessions = revisionSnap.docs.map((d) => d.data());
    const grades = gradesSnap.docs.map((d) => d.data());

    // ─── Agréger ───
    const pilotData = buildPilotData(examResults, revisionSessions, grades);

    return response.status(200).json({
      success: true,
      ...pilotData
    });

  } catch (error) {
    console.error('ARV-PILOT failed:', error.message);
    return jsonError(response, 503, 'Le service d\'analyse est temporairement indisponible.');
  }
};
