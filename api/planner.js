const MAX_REQUESTS_PER_WINDOW = 12;
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

function isPremiumUser(data) {
  if (!data) return false;
  const active = data.premium === true || data.isUnlocked === true || data.hasDeposited === true;
  if (!active) return false;
  const end = data.subscriptionEndDate?.toDate?.() || (data.subscriptionEndDate?.seconds ? new Date(data.subscriptionEndDate.seconds * 1000) : null);
  return !end || end.getTime() > Date.now();
}

function buildPlan(results) {
  const grouped = new Map();
  results.forEach((entry) => {
    const subject = entry.subject || 'Matière générale';
    const score = Number(entry.score || 0);
    const current = grouped.get(subject) || { subject, attempts: 0, total: 0, lastScore: score, advice: [] };
    current.attempts += 1;
    current.total += score;
    current.lastScore = score;
    (entry.difficulties || []).forEach((difficulty) => {
      if (difficulty.advice) current.advice.push(String(difficulty.advice).slice(0, 300));
    });
    grouped.set(subject, current);
  });

  const priorities = [...grouped.values()].map((item) => {
    const average = Math.round((item.total / item.attempts) * 100) / 100;
    const priority = average < 10 ? 'Urgente' : average < 14 ? 'Importante' : 'Entretien';
    return {
      subject: item.subject,
      averageScore: average,
      lastScore: item.lastScore,
      attempts: item.attempts,
      priority,
      recommendedMinutes: priority === 'Urgente' ? 45 : priority === 'Importante' ? 30 : 20,
      advice: [...new Set(item.advice)].slice(0, 3)
    };
  }).sort((a, b) => a.averageScore - b.averageScore);

  return {
    generatedAt: new Date().toISOString(),
    weekGoal: priorities.length ? 'Travaille d’abord la matière ayant la priorité la plus élevée, puis refais un examen ciblé.' : 'Termine un premier examen pour obtenir un planning personnalisé.',
    priorities,
    sessions: priorities.slice(0, 7).map((item, index) => ({
      day: index + 1,
      subject: item.subject,
      durationMinutes: item.recommendedMinutes,
      task: item.priority === 'Urgente' ? 'Revoir les notions faibles et refaire les exercices erronés.' : 'Réviser les méthodes puis refaire quelques questions chronométrées.'
    }))
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }
  if (rateLimited(clientIp(request))) return jsonError(response, 429, 'Trop de demandes. Réessaie dans une minute.');

  let user;
  try { user = await verifyFirebaseToken(request); } catch (_) { user = null; }
  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  try {
    const { db } = getAdminServices();
    const userSnapshot = await db.collection('users').doc(user.uid).get();
    if (!isPremiumUser(userSnapshot.data())) return jsonError(response, 403, 'Le planificateur est réservé aux comptes Premium.', 'PREMIUM_REQUIRED');
    const snapshot = await db.collection('users').doc(user.uid).collection('examResults').orderBy('createdAt', 'desc').limit(30).get();
    const results = snapshot.docs.map((document) => document.data());
    return response.status(200).json({ success: true, plan: buildPlan(results), resultCount: results.length });
  } catch (error) {
    console.error('Planner failed:', error.message);
    return jsonError(response, 503, 'Le planificateur est temporairement indisponible.');
  }
};
