// ================================================================
// ARV-PILOT — Configuration centrale
// Coefficients, matières, niveaux de priorité, types d'erreurs
// ================================================================

// ═══════════════════════════════════════════════════════════════
// COEFFICIENTS OFFICIELS
// ═══════════════════════════════════════════════════════════════
export const COEFFICIENTS = {
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
// MATIÈRES
// auto   = gérées automatiquement par ARVEXA (examens, quiz)
// manual = à saisir manuellement par l'élève
// ═══════════════════════════════════════════════════════════════
export const SUBJECTS = {
  mathematiques: { label: 'Mathématiques', shortLabel: 'Maths',  icon: '📐', coef: 5, mode: 'auto' },
  physique:       { label: 'Physique',      shortLabel: 'Phys.',  icon: '⚡', coef: 3, mode: 'auto' },
  chimie:         { label: 'Chimie',        shortLabel: 'Chim.',  icon: '🧪', coef: 2, mode: 'auto' },
  svt:            { label: 'SVT',           shortLabel: 'SVT',   icon: '🧬', coef: 5, mode: 'auto' },
  francais:       { label: 'Français',      shortLabel: 'Fran.', icon: '📖', coef: 3, mode: 'auto' },
  anglais:        { label: 'Anglais',       shortLabel: 'Angl.', icon: '🌍', coef: 2, mode: 'manual' },
  philosophie:    { label: 'Philosophie',   shortLabel: 'Philo', icon: '🤔', coef: 2, mode: 'manual' },
  histoire_geo:   { label: 'Histoire-Géo',  shortLabel: 'H-G',   icon: '🗺️', coef: 2, mode: 'manual' },
  eps:            { label: 'EPS',           shortLabel: 'EPS',   icon: '🏃', coef: 1, mode: 'manual' }
};

// ═══════════════════════════════════════════════════════════════
// NIVEAUX DE PRIORITÉ
// ═══════════════════════════════════════════════════════════════
export const PRIORITY_LEVELS = {
  high:   { label: 'Priorité élevée', short: 'Élevée',    color: '#d7654a', emoji: '🔴', score: 3 },
  medium: { label: 'À renforcer',     short: 'Renforcer', color: '#E0B84A', emoji: '🟠', score: 2 },
  low:    { label: 'Solide',          short: 'Solide',    color: '#45b47d', emoji: '🟢', score: 1 },
  none:   { label: 'Pas de données',  short: '—',         color: '#5A5A4A', emoji: '⚪', score: 0 }
};

// ═══════════════════════════════════════════════════════════════
// TYPES D'ÉVALUATIONS
// ═══════════════════════════════════════════════════════════════
export const EVALUATION_TYPES = {
  interro:      { label: 'Interrogation', icon: '📝', weight: 0.5 },
  devoir:       { label: 'Devoir',        icon: '📄', weight: 1 },
  composition:  { label: 'Composition',   icon: '📋', weight: 1.5 },
  exam_blanc:   { label: 'Examen blanc',  icon: '🎓', weight: 2 },
  bac_blanc:    { label: 'BAC blanc',     icon: '🏆', weight: 2.5 },
  autre:        { label: 'Autre',         icon: '📌', weight: 1 }
};

// ═══════════════════════════════════════════════════════════════
// TYPES D'ERREURS
// ═══════════════════════════════════════════════════════════════
export const ERROR_TYPES = {
  signe:        { label: 'Erreur de signe',        icon: '➕' },
  formule:      { label: 'Mauvaise formule',       icon: '📐' },
  methode:      { label: 'Mauvaise méthode',       icon: '🧭' },
  calcul:       { label: 'Erreur de calcul',       icon: '🔢' },
  enonce:       { label: 'Compréhension énoncé',   icon: '❓' },
  unite:        { label: 'Unité manquante',        icon: '📏' },
  raisonnement: { label: 'Raisonnement',           icon: '🧠' },
  redaction:    { label: 'Rédaction',              icon: '✍️' }
};

// ═══════════════════════════════════════════════════════════════
// NORMALISATION DES NOMS DE MATIÈRES
// ═══════════════════════════════════════════════════════════════
export function normalizeSubjectName(raw) {
  if (!raw) return null;
  const s = String(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z_]/g, '');

  const map = {
    mathematiques: 'mathematiques',
    maths: 'mathematiques',
    math: 'mathematiques',
    mathématiques: 'mathematiques',
    physique: 'physique',
    physiques: 'physique',
    chimie: 'chimie',
    svt: 'svt',
    francais: 'francais',
    français: 'francais',
    anglais: 'anglais',
    philosophie: 'philosophie',
    philo: 'philosophie',
    histoire_geo: 'histoire_geo',
    histoire_geographie: 'histoire_geo',
    histoire_geographie: 'histoire_geo',
    histoiregeo: 'histoire_geo',
    eps: 'eps'
  };

  return map[s] || s;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
export function getSubjectConfig(subjectKey) {
  return SUBJECTS[subjectKey] || { label: subjectKey, shortLabel: subjectKey, icon: '📚', coef: 1, mode: 'manual' };
}

export function getCoefficient(subjectKey) {
  return COEFFICIENTS[subjectKey] || 1;
}
