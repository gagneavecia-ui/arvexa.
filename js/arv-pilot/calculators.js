// ================================================================
// ARV-PILOT — Moteur de calcul (100% déterministe)
// Aucun appel IA ici. Que des mathématiques pures.
// ================================================================

import { COEFFICIENTS, normalizeSubjectName, getCoefficient } from './config.js';

// ═══════════════════════════════════════════════════════════════
// MOYENNE D'UNE MATIÈRE
// Sources : examens (examResults) + quiz (revisionSessions) + notes manuelles (grades)
// ═══════════════════════════════════════════════════════════════
export function computeSubjectAverage(subject, { examResults = [], revisionSessions = [], grades = [] }) {
  const scores = [];

  // 1. Examens
  examResults.forEach((r) => {
    if (normalizeSubjectName(r.subject) === subject) {
      const s = Number(r.score);
      if (!isNaN(s) && s >= 0 && s <= 20) scores.push(s);
    }
  });

  // 2. Quiz (reviseur)
  revisionSessions.forEach((s) => {
    if (s.type === 'quiz_result' && normalizeSubjectName(s.subject) === subject) {
      const score = Number(s.score);
      if (!isNaN(score) && score >= 0 && score <= 20) scores.push(score);
    }
  });

  // 3. Notes manuelles
  grades.forEach((g) => {
    if (normalizeSubjectName(g.subject) === subject) {
      const score = Number(g.score);
      const max = Number(g.maxScore) || 20;
      if (!isNaN(score) && score >= 0 && max > 0) {
        scores.push((score / max) * 20);
      }
    }
  });

  if (scores.length === 0) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return round2(sum / scores.length);
}

// ═══════════════════════════════════════════════════════════════
// MOYENNE GÉNÉRALE PONDÉRÉE
// ⚡ Ne compte QUE les matières avec notes
// ═══════════════════════════════════════════════════════════════
export function computeGeneralAverage(subjectAverages) {
  let totalWeighted = 0;
  let totalCoef = 0;

  Object.entries(subjectAverages).forEach(([subject, avg]) => {
    if (avg === null || avg === undefined) return;
    const coef = getCoefficient(subject);
    totalWeighted += avg * coef;
    totalCoef += coef;
  });

  if (totalCoef === 0) return null;
  return round2(totalWeighted / totalCoef);
}

// ═══════════════════════════════════════════════════════════════
// NOMBRE D'ÉVALUATIONS (par matière)
// ═══════════════════════════════════════════════════════════════
export function countEvaluations(subject, { examResults = [], revisionSessions = [], grades = [] }) {
  let count = 0;

  examResults.forEach((r) => {
    if (normalizeSubjectName(r.subject) === subject) count++;
  });

  revisionSessions.forEach((s) => {
    if (s.type === 'quiz_result' && normalizeSubjectName(s.subject) === subject) count++;
  });

  grades.forEach((g) => {
    if (normalizeSubjectName(g.subject) === subject) count++;
  });

  return count;
}

// ═══════════════════════════════════════════════════════════════
// NOMBRE D'EXERCICES + TAUX DE RÉUSSITE
// ═══════════════════════════════════════════════════════════════
export function computeExerciseStats(subject, { examResults = [], revisionSessions = [] }) {
  let total = 0;
  let success = 0;

  // Exercices des examens
  examResults.forEach((r) => {
    if (normalizeSubjectName(r.subject) !== subject) return;
    const difficulties = Array.isArray(r.difficulties) ? r.difficulties : [];
    difficulties.forEach((d) => {
      total++;
      const score = Number(d.score) || 0;
      const max = Number(d.maxScore) || 5;
      if (score / max >= 0.5) success++;
    });
  });

  // Quiz du reviseur (chaque question = 1 exercice)
  revisionSessions.forEach((s) => {
    if (s.type !== 'quiz_result') return;
    if (normalizeSubjectName(s.subject) !== subject) return;
    const correct = Number(s.correct) || 0;
    const totalQ = Number(s.total) || 0;
    total += totalQ;
    success += correct;
  });

  if (total === 0) return { total: 0, success: 0, rate: null };
  return {
    total,
    success,
    rate: Math.round((success / total) * 100)
  };
}

// ═══════════════════════════════════════════════════════════════
// TEMPS DE RÉVISION (en secondes)
// ═══════════════════════════════════════════════════════════════
export function computeRevisionTime(subject, { revisionSessions = [] }) {
  let totalSeconds = 0;

  revisionSessions.forEach((s) => {
    if (subject && normalizeSubjectName(s.subject) !== subject) return;
    const t = Number(s.duration) || 0;
    if (!isNaN(t)) totalSeconds += t;
  });

  return totalSeconds;
}

// ═══════════════════════════════════════════════════════════════
// CHAPITRES RÉVISÉS
// ═══════════════════════════════════════════════════════════════
export function countChaptersRevised(subject, { revisionSessions = [], examResults = [] }) {
  const chapters = new Set();

  revisionSessions.forEach((s) => {
    if (subject && normalizeSubjectName(s.subject) !== subject) return;
    if (s.chapter) chapters.add(s.chapter);
  });

  examResults.forEach((r) => {
    if (subject && normalizeSubjectName(r.subject) !== subject) return;
    if (r.chapter && r.chapter !== 'all') chapters.add(r.chapter);
  });

  return chapters.size;
}

// ═══════════════════════════════════════════════════════════════
// ÉVOLUTION (delta entre 2 périodes)
// ═══════════════════════════════════════════════════════════════
export function computeEvolution(items, getScore, getDate, periodDays = 30) {
  if (!items || items.length < 2) return null;

  const now = Date.now();
  const cutoff = now - periodDays * 24 * 60 * 60 * 1000;

  const recent = [];
  const previous = [];

  items.forEach((item) => {
    const score = getScore(item);
    if (score === null) return;
    const date = getDate(item);
    if (!date) return;
    const time = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (isNaN(time)) return;

    if (time >= cutoff) recent.push(score);
    else previous.push(score);
  });

  if (recent.length === 0 || previous.length === 0) return null;

  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgPrevious = previous.reduce((a, b) => a + b, 0) / previous.length;

  return round2(avgRecent - avgPrevious);
}

// ═══════════════════════════════════════════════════════════════
// PRIORITÉ (score multi-facteurs)
// ═══════════════════════════════════════════════════════════════
export function computePriority(subject, data) {
  const { average, exerciseRate, errorCount = 0, daysSinceLastWork = 0 } = data;

  // Pas de données → pas de priorité
  if (average === null && exerciseRate === null) {
    return { level: 'none', score: 0, reasons: ['Aucune donnée disponible'] };
  }

  let score = 0;
  const reasons = [];

  // 1. Moyenne faible (max 40 pts)
  if (average !== null && average < 12) {
    const penalty = Math.min(40, (12 - average) * 5);
    score += penalty;
    reasons.push(`Moyenne faible (${average}/20)`);
  }

  // 2. Taux de réussite faible (max 30 pts)
  if (exerciseRate !== null && exerciseRate < 70) {
    const penalty = Math.min(30, (70 - exerciseRate) * 0.6);
    score += penalty;
    reasons.push(`Taux de réussite faible (${exerciseRate}%)`);
  }

  // 3. Erreurs récurrentes (max 15 pts)
  if (errorCount >= 2) {
    score += Math.min(15, errorCount * 3);
    reasons.push(`${errorCount} erreurs récurrentes`);
  }

  // 4. Absence de travail récent (max 15 pts)
  if (daysSinceLastWork > 10) {
    score += Math.min(15, (daysSinceLastWork - 10) * 0.5);
    reasons.push(`Non travaillé depuis ${daysSinceLastWork} jours`);
  }

  let level = 'low';
  if (score >= 55) level = 'high';
  else if (score >= 25) level = 'medium';

  return { level, score: Math.round(score), reasons };
}

// ═══════════════════════════════════════════════════════════════
// DÉTECTION D'ERREURS RÉCURRENTES
// ═══════════════════════════════════════════════════════════════
export function detectFrequentErrors(examResults, subject = null) {
  const errorCounts = {};

  examResults.forEach((r) => {
    if (subject && normalizeSubjectName(r.subject) !== subject) return;
    const difficulties = Array.isArray(r.difficulties) ? r.difficulties : [];
    difficulties.forEach((d) => {
      const errors = Array.isArray(d.errors) ? d.errors : [];
      errors.forEach((e) => {
        const type = typeof e === 'string' ? e : e.type;
        if (!type) return;
        errorCounts[type] = (errorCounts[type] || 0) + 1;
      });
    });
  });

  return Object.entries(errorCounts)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
}

// ═══════════════════════════════════════════════════════════════
// DÉTECTION DE TENDANCE (progression / stagnation / baisse)
// ═══════════════════════════════════════════════════════════════
export function detectTrend(items, getScore, getDate, minPoints = 3) {
  if (!items || items.length < minPoints) {
    return { trend: 'insufficient', label: 'Données insuffisantes', delta: 0 };
  }

  const sorted = items
    .map((item) => ({ score: getScore(item), date: getDate(item) }))
    .filter((x) => x.score !== null && x.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (sorted.length < minPoints) {
    return { trend: 'insufficient', label: 'Données insuffisantes', delta: 0 };
  }

  const recent = sorted.slice(-minPoints);
  const delta = round2(recent[recent.length - 1].score - recent[0].score);

  if (delta > 0.5) return { trend: 'progress', label: 'En progression', delta };
  if (delta < -0.5) return { trend: 'decline', label: 'En baisse', delta };
  return { trend: 'stable', label: 'Stable', delta };
}

// ═══════════════════════════════════════════════════════════════
// NIVEAU DE PRÉPARATION (basé sur données réelles)
// ═══════════════════════════════════════════════════════════════
export function computeReadiness(dataPoints, generalAverage) {
  if (dataPoints < 5) return { level: 'insufficient', label: 'Données insuffisantes' };
  if (generalAverage === null) return { level: 'insufficient', label: 'Données insuffisantes' };

  if (generalAverage >= 14) return { level: 'solid', label: 'Préparation solide' };
  if (generalAverage >= 11) return { level: 'progressing', label: 'En progression' };
  return { level: 'reinforce', label: 'À renforcer' };
}

// ═══════════════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════════════
export function round2(n) {
  if (n === null || n === undefined) return null;
  return Math.round(n * 100) / 100;
}

export function formatTime(seconds) {
  if (!seconds || seconds < 60) return '0 min';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function formatEvolution(delta) {
  if (delta === null || delta === undefined) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(2)}`;
}

export function daysSince(dateValue) {
  if (!dateValue) return null;
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}
