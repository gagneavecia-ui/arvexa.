// ═══════════════════════════════════════════════════════════════════
// ARVEXA — API STREAK-TRIAL (v8.25 — P2 RÉTENTION)
// Récompense de la boucle rétention : « 7 jours de série 🔥 → 24 h de
// Premium offerts » (roadmap P2 approuvée, audit 09/11/2026).
// ─────────────────────────────────────────────────────────────────
// SÉCURITÉ / HONNÊTETÉ :
//  - Le client ne peut JAMAIS s'auto-attribuer le premium : tous les
//    champs d'abonnement sont verrouillés côté règles Firestore et
//    écrits ICI uniquement (SDK admin, horloge serveur).
//  - Éligibilité vérifiée SERVEUR : la série cloud (progression/streak)
//    OU l'activité réelle (progression/course.dailyActivity) doit
//    montrer ≥ STREAK_REQUIS jours consécutifs (1 trou toléré = congé 🛡️).
//  - UN SEUL essai par compte à vie (streakTrialUsed, écrit serveur).
//  - L'essai = un abonnement de 24 h (isUnlocked + premium + endDate) :
//    TOUTES les portes premium (client isUserPremium + les 4 API
//    isPremiumUser) s'ouvrent puis se referment SEULES à l'expiration —
//    zéro code de gating à modifier, zéro fuite après 24 h.
// POST { Authorization: Bearer <idToken> } → { success, until, streak }
// ═══════════════════════════════════════════════════════════════════

let adminServices = null;

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

async function verifyUser(request) {
  try {
    const match = String(request.headers.authorization || '').match(/^Bearer (.+)$/i);
    if (!match) return null;
    return await getAdminServices().auth.verifyIdToken(match[1]);
  } catch (_) { return null; }
}

const STREAK_REQUIS = 7;
const JOUR_MS = 24 * 60 * 60 * 1000;

// Jours consécutifs calculés côté serveur depuis l'activité réelle
// (dailyActivity = { 'YYYY-MM-DD': nb sections lues }) — 1 trou toléré.
function joursConsecutifsDepuisActivite(dailyActivity) {
  if (!dailyActivity || typeof dailyActivity !== 'object') return 0;
  const jours = Object.keys(dailyActivity)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number(dailyActivity[d]) > 0)
    .sort();
  if (!jours.length) return 0;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const hier = new Date(Date.now() - JOUR_MS).toISOString().slice(0, 10);
  // La série doit être « vivante » : marquée aujourd'hui ou hier.
  if (jours[jours.length - 1] !== aujourdhui && jours[jours.length - 1] !== hier) return 0;
  let best = 1, run = 1;
  for (let i = 1; i < jours.length; i++) {
    const prev = new Date(jours[i - 1] + 'T00:00:00Z').getTime();
    const cur = new Date(jours[i] + 'T00:00:00Z').getTime();
    const ecart = Math.round((cur - prev) / JOUR_MS);
    if (ecart === 1) run += 1;
    else if (ecart === 2) run += 1; // 🛡️ congé : un trou pardonné
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

module.exports = async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return response.status(204).end();
  }
  response.setHeader('Access-Control-Allow-Origin', '*');

  if (request.method !== 'POST') {
    return response.status(405).json({ success: false, error: 'POST requis.' });
  }

  let user;
  try { user = await verifyUser(request); }
  catch (_) { return response.status(503).json({ success: false, error: 'Service temporairement indisponible.' }); }
  if (!user) return response.status(401).json({ success: false, error: 'Connexion requise.', code: 'AUTH_REQUIRED' });
  const uid = user.uid;

  try {
    const { db, FieldValue } = getAdminServices();
    const userRef = db.collection('users').doc(uid);

    // 1) Un seul essai à vie + pas pendant un abonnement actif.
    const userSnap = await userRef.get();
    if (!userSnap.exists) return response.status(404).json({ success: false, error: 'Profil introuvable.' });
    const data = userSnap.data() || {};
    if (data.streakTrialUsed) {
      return response.status(409).json({
        success: false, error: 'Ton essai de 24 h a déjà été utilisé.', code: 'ALREADY_USED'
      });
    }
    const end = data.subscriptionEndDate?.toDate?.() ||
      (data.subscriptionEndDate?.seconds ? new Date(data.subscriptionEndDate.seconds * 1000) : null);
    const premiumActif = (data.premium === true || data.isUnlocked === true || data.hasDeposited === true)
      && (!end || end.getTime() > Date.now());
    if (premiumActif) {
      return response.status(409).json({
        success: false, error: 'Tu es déjà Premium — garde ta série pour la suite 🔥', code: 'PREMIUM_ACTIVE'
      });
    }

    // 2) Éligibilité : série cloud ≥ 7 OU activité réelle serveur ≥ 7 jours.
    let streak = 0;
    try {
      const streakSnap = await userRef.collection('progression').doc('streak').get();
      if (streakSnap.exists) {
        const s = streakSnap.data() || {};
        const count = Math.max(0, Math.min(730, Number(s.count) || 0));
        const last = String(s.last || '');
        const aujourdhui = new Date().toISOString().slice(0, 10);
        const hier = new Date(Date.now() - JOUR_MS).toISOString().slice(0, 10);
        // La série revendiquée doit être VIVANTE (marquée aujourd'hui/hier).
        streak = (last === aujourdhui || last === hier) ? count : 0;
      }
    } catch (_) { /* streak absent → activité réelle ci-dessous */ }
    let serieReelle = streak;
    if (serieReelle < STREAK_REQUIS) {
      try {
        const courseSnap = await userRef.collection('progression').doc('course').get();
        const act = courseSnap.exists ? (courseSnap.data() || {}).dailyActivity : null;
        serieReelle = Math.max(serieReelle, joursConsecutifsDepuisActivite(act));
      } catch (_) { /* pas d'activité */ }
    }

    if (serieReelle < STREAK_REQUIS) {
      return response.status(400).json({
        success: false,
        error: `Il te faut ${STREAK_REQUIS} jours de série 🔥 — tu es à ${serieReelle}. Continue !`,
        code: 'NOT_ELIGIBLE', streak: serieReelle
      });
    }

    // 3) Attribution (horloge serveur) — réécriture anti-course : on relit
    //    streakTrialUsed DANS la transaction d'écriture.
    const until = new Date(Date.now() + JOUR_MS);
    let concurrence = false;
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(userRef);
      if ((fresh.data() || {}).streakTrialUsed) { concurrence = true; return; }
      tx.set(userRef, {
        premium: true,
        isUnlocked: true,
        subscriptionStatus: 'active',
        subscriptionPlan: 'essai-serie-24h',
        subscriptionStartDate: FieldValue.serverTimestamp(),
        subscriptionEndDate: until,
        streakTrialUsed: true,
        streakTrialAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    if (concurrence) {
      return response.status(409).json({ success: false, error: 'Essai déjà utilisé.', code: 'ALREADY_USED' });
    }

    console.log(`[STREAK-TRIAL] 24 h offertes à ${uid.slice(0, 8)} (série ${serieReelle})`);
    return response.status(200).json({
      success: true, until: until.toISOString(), streak: serieReelle,
      message: '🎁 24 h de Premium activées — profites-en à fond !'
    });
  } catch (e) {
    console.error('[STREAK-TRIAL] Erreur:', e.message);
    return response.status(500).json({ success: false, error: 'Erreur serveur.' });
  }
};

module.exports.config = { maxDuration: 30 };
