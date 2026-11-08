// ================================================================
// API FLASHCARDS v1.0 — ARVEXA School
// Génération IA de flashcards PAR CHAPITRE ET PAR SECTION (v8.21)
// Demande propriétaire : « les flashcards sont générés en fonction du
// chapitre et de la section dans laquelle l'utilisateur est ».
//
// Architecture copiée sur api/progress.js (mêmes fournisseurs, mêmes
// replis, même auth) — endpoint DÉDIÉ pour ne pas toucher le cahier :
//   POST /api/flashcards { subject, subjectLabel, chapterTitle, sectionTitle, content }
//   Authorization: Bearer <Firebase idToken>
//   → { success: true, cards: [{ recto, verso }, ...] }   (5-12 cartes)
//
// Bornes : content ≤ 14 000 car., ≤ 20 cartes, recto ≤ 300, verso ≤ 600.
// Rate limit : 5 générations / minute / IP.
// ================================================================

const WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 5;
const requestLog = new Map();

var ALLOWED_SUBJECTS = new Set([
  'mathematiques', 'physique', 'chimie', 'svt',
  'philosophie', 'histoire', 'geographie', 'anglais'
]);

var SUBJECT_INFO = {
  mathematiques: { label: 'Mathématiques', profile: 'scientific' },
  physique:      { label: 'Physique',      profile: 'scientific' },
  chimie:        { label: 'Chimie',        profile: 'scientific' },
  svt:           { label: 'SVT',           profile: 'svt' },
  philosophie:   { label: 'Philosophie',   profile: 'philosophy' },
  histoire:      { label: 'Histoire',      profile: 'history' },
  geographie:    { label: 'Géographie',    profile: 'history' },
  anglais:       { label: 'Anglais',       profile: 'language' }
};

// ────────────────────────────────────────────────────────────────
// FIREBASE ADMIN (identique à progress.js)
// ────────────────────────────────────────────────────────────────
let adminServices = null;

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

  adminServices = { auth: admin.auth() };
  return adminServices;
}

async function verifyFirebaseToken(request) {
  const header = String(request.headers.authorization || '');
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  const auth = getAdminServices().auth;
  return await auth.verifyIdToken(match[1]);
}

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────
function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

function rateLimited(ip) {
  const key = ip + '|flashcards';
  const now = Date.now();
  const recent = (requestLog.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  requestLog.set(key, recent);
  if (requestLog.size > 5000) {
    for (const [k, v] of requestLog) {
      if (v.every((t) => now - t >= WINDOW_MS)) requestLog.delete(k);
    }
  }
  return recent.length > RATE_LIMIT;
}

function jsonError(response, status, error, code) {
  return response.status(status).json({ success: false, error, ...(code ? { code } : {}) });
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
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('Access-Control-Max-Age', '86400');
}

// Nettoyage du contenu source : texte brut lisible pour l'IA
function cleanContent(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let r = raw;
  // Balises HTML → texte (les fragments de cours arrivent en HTML)
  r = r.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  r = r.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  r = r.replace(/<h[1-6][^>]*>/gi, '\n\n## ');
  r = r.replace(/<\/h[1-6]>/gi, '\n');
  r = r.replace(/<li[^>]*>/gi, '\n- ');
  r = r.replace(/<br\s*\/?>/gi, '\n');
  r = r.replace(/<\/(p|div|tr|table|ul|ol)>/gi, '\n');
  r = r.replace(/<[^>]+>/g, ' ');
  r = r.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  r = r.replace(/[ \t]+/g, ' ');
  r = r.replace(/\n{3,}/g, '\n\n');
  return r.trim();
}

// ────────────────────────────────────────────────────────────────
// PROMPT — profils par matière (esprit des prompts de progress.js)
// ────────────────────────────────────────────────────────────────
const PROFILE_HINTS = {
  scientific: 'Formules, définitions et méthodes : une carte par formule ou par notion clé, le recto pose la question (ou donne l\'énoncé type), le verso donne la réponse avec la formule exacte et une explication courte.',
  svt: 'Mécanismes, définitions et schémas : une carte par mécanisme/structure, le recto interroge (rôle, étapes, structure), le verso explique clairement en 1-3 phrases.',
  philosophy: 'Notions, auteurs et distinctions conceptuelles : le recto pose une question d\'analyse ou cite une thèse, le verso donne la réponse argumentée avec l\'auteur pertinent si utile.',
  history: 'Dates, acteurs, causes et conséquences : le recto interroge (date, événement, acteur, « pourquoi »), le verso répond précisément avec le contexte nigérien/africain quand le contenu s\'y prête.',
  language: 'Vocabulaire, règles de grammaire et expressions : le recto pose le mot/la règle (ou la traduction à trouver), le verso donne la réponse avec un court exemple d\'usage.'
};

function buildPrompts({ subjectLabel, profile, chapterTitle, sectionTitle, content }) {
  const hint = PROFILE_HINTS[profile] || PROFILE_HINTS.scientific;
  const systemPrompt = `Tu es un professeur expert qui prépare des élèves nigériens au BAC. Tu crées des FLASHCARDS de révision en français, adaptées à la matière ${subjectLabel}.

RÈGLES ABSOLUES :
1. Tu réponds UNIQUEMENT avec un objet JSON valide : {"cards":[{"recto":"...","verso":"..."}]}
2. Entre 8 et 12 cartes. Chaque carte couvre UNE seule idée.
3. RECTO = question courte et précise (ou notion à définir, ou énoncé à compléter). Jamais de réponse dans le recto.
4. VERSO = réponse exacte, autonome, en 1 à 3 phrases courtes (ou la formule + son rôle). Pas de « voir le cours ».
5. ${hint}
6. Fidèle au contenu fourni — n'invente pas de notion absente du cours.
7. Style direct, niveau élève de lycée. Pas de markdown, pas de LaTeX complexe (écrire v0 = v0 + a·t, x², etc.).

EXEMPLE de sortie :
{"cards":[{"recto":"Qu'est-ce que la vitesse moyenne ?","verso":"Distance totale divisée par le temps total : v = d / t. Elle s'exprime en m/s ou km/h."}]}`;

  const userPrompt = `Matière : ${subjectLabel}
Chapitre : ${chapterTitle || '(non précisé)'}
Section : ${sectionTitle || '(non précisé)'}

CONTENU DE LA SECTION (source unique) :
"""
${content}
"""

Crée 8 à 12 flashcards couvrant les notions ESSENTIELLES de cette section (définitions, formules, dates, mécanismes, méthodes). Réponds uniquement avec le JSON {"cards":[...]}.`;

  return { systemPrompt, userPrompt };
}

// ────────────────────────────────────────────────────────────────
// IA — FOURNISSEURS (identique progress.js : Groq → OpenRouter → Mistral → Gemini)
// ────────────────────────────────────────────────────────────────
function getProviders() {
  return [
    {
      name: 'Groq',
      key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true
    },
    {
      name: 'OpenRouter',
      key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true,
      headers: {
        'HTTP-Referer': process.env.APP_ORIGIN || '',
        'X-Title': 'ARVEXA Flashcards'
      }
    },
    {
      name: 'Mistral',
      key: process.env.MISTRAL_API_KEY,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      jsonMode: true
    },
    {
      name: 'Gemini',
      key: process.env.GEMINI_API_KEY,
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent`,
      gemini: true
    }
  ].filter((p) => Boolean(p.key));
}

function escapeControlCharsInJsonStrings(s) {
  if (!s || typeof s !== 'string') return s;
  let out = '';
  let inStr = false, esc = false;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const ch = s[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (ch === '\\' && inStr) {
      const next = i + 1 < n ? s[i + 1] : '';
      if (next === 'u' && /^[0-9a-fA-F]{4}/.test(s.slice(i + 2, i + 6))) { out += ch; esc = true; continue; }
      if ('"\\/'.includes(next)) { out += ch; esc = true; continue; }
      out += '\\\\';
      continue;
    }
    if (inStr) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
    }
    out += ch;
  }
  return out;
}

function escapeInnerQuotes(s) {
  if (!s || typeof s !== 'string') return s;
  let out = '';
  let inStr = false, esc = false;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const ch = s[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') {
      if (!inStr) { inStr = true; out += ch; continue; }
      let j = i + 1;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
      const next = j < n ? s[j] : '';
      if (next === '' || ':,}]'.includes(next)) { inStr = false; out += ch; }
      else { out += '\\"'; }
      continue;
    }
    out += ch;
  }
  return out;
}

function repairJson(str) {
  if (!str || typeof str !== 'string') return null;
  let s = String(str).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(s); } catch (_) {}
  const firstBrace = s.indexOf('{');
  if (firstBrace === -1) return null;
  const lastBrace = s.lastIndexOf('}');
  let candidate = (lastBrace > firstBrace) ? s.slice(firstBrace, lastBrace + 1) : s.slice(firstBrace);
  try { return JSON.parse(candidate); } catch (_) {}
  const stack = [];
  let inString = false, escape = false;
  for (const ch of candidate) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
  }
  let suffix = '';
  if (escape) candidate = candidate.slice(0, -1);
  if (inString) suffix += '"';
  while (stack.length) suffix += stack.pop();
  candidate += suffix;
  try { return JSON.parse(candidate); } catch (_) {}
  return null;
}

async function callProvider(provider, { systemPrompt, userPrompt, maxTokens = 2500, deadline }) {
  const controller = new AbortController();
  const timeouts = { 'Groq': 18000, 'OpenRouter': 28000, 'Mistral': 40000, 'Gemini': 35000 };
  const baseTimeout = timeouts[provider.name] || 20000;
  const remaining = deadline ? Math.max(5000, deadline - Date.now()) : baseTimeout;
  const timeoutMs = Math.min(baseTimeout, remaining);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let rawContent = null;

    if (provider.gemini) {
      const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 }
        }
      };
      const result = await fetch(`${provider.endpoint}?key=${provider.key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const data = await result.json().catch(() => null);
      if (!result.ok) {
        const msg = data?.error?.message || `HTTP ${result.status}`;
        throw new Error(`${provider.name}: ${msg}`);
      }
      rawContent = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!rawContent) throw new Error(`${provider.name}: réponse vide`);
    } else {
      const body = {
        model: provider.model,
        temperature: 0.3,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      };
      if (provider.jsonMode) body.response_format = { type: 'json_object' };

      const result = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.key}`,
          ...(provider.headers || {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const data = await result.json().catch(() => null);
      if (!result.ok) {
        const msg = data?.error?.message || `HTTP ${result.status}`;
        throw new Error(`${provider.name}: ${msg}`);
      }
      rawContent = data?.choices?.[0]?.message?.content;
      if (!rawContent) throw new Error(`${provider.name}: réponse vide`);
    }

    const repaired = repairJson(escapeInnerQuotes(escapeControlCharsInJsonStrings(rawContent)));
    if (!repaired) throw new Error(`${provider.name}: JSON illisible`);
    return repaired;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateCards({ subjectLabel, profile, chapterTitle, sectionTitle, content }) {
  const providers = getProviders();
  if (!providers.length) throw Object.assign(new Error('Aucun fournisseur IA configuré.'), { code: 'NO_PROVIDER' });

  const { systemPrompt, userPrompt } = buildPrompts({ subjectLabel, profile, chapterTitle, sectionTitle, content });
  const deadline = Date.now() + 55000;
  const failures = [];

  for (const provider of providers) {
    try {
      const parsed = await callProvider(provider, { systemPrompt, userPrompt, deadline });
      const rawCards = Array.isArray(parsed?.cards) ? parsed.cards
        : Array.isArray(parsed) ? parsed : [];
      const cards = rawCards
        .map((c) => ({
          recto: String(c?.recto ?? c?.question ?? c?.front ?? '').trim().slice(0, 300),
          verso: String(c?.verso ?? c?.reponse ?? c?.answer ?? c?.back ?? '').trim().slice(0, 600)
        }))
        .filter((c) => c.recto.length >= 3 && c.verso.length >= 1);
      if (cards.length >= 5) return cards.slice(0, 20);
      failures.push(`${provider.name}: ${cards.length} carte(s) seulement`);
    } catch (e) {
      failures.push(e.message);
      console.error(`[FLASHCARDS] ${e.message}`);
    }
  }
  throw Object.assign(
    new Error('Génération impossible pour le moment. Réessaie dans quelques instants. (' + failures.join(' | ') + ')'),
    { code: 'ALL_PROVIDERS_FAILED' }
  );
}

// ════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  applyCors(request, response);

  if (request.method === 'OPTIONS') return response.status(204).end();

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  if (rateLimited(clientIp(request))) {
    return jsonError(response, 429, 'Trop de générations à la suite. Réessaie dans une minute.', 'RATE_LIMIT');
  }

  let user;
  try { user = await verifyFirebaseToken(request); }
  catch (e) {
    console.error('[FLASHCARDS] Auth error:', e.message);
    return jsonError(response, 503, 'Service temporairement indisponible.');
  }
  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const subject = String(body.subject || '').toLowerCase();
  const info = SUBJECT_INFO[subject];

  if (!ALLOWED_SUBJECTS.has(subject) || !info) {
    return jsonError(response, 400, 'Matière non prise en charge.', 'BAD_SUBJECT');
  }

  const content = cleanContent(String(body.content || ''));
  if (content.length < 80) {
    return jsonError(response, 400, 'Contenu de la section trop court pour créer des flashcards.', 'CONTENT_TOO_SHORT');
  }

  const subjectLabel = String(body.subjectLabel || info.label).slice(0, 60);
  const chapterTitle = String(body.chapterTitle || '').slice(0, 120);
  const sectionTitle = String(body.sectionTitle || '').slice(0, 160);

  console.log(`[FLASHCARDS] uid=${user.uid.slice(0, 8)} subject=${subject} content=${content.length}`);

  try {
    const cards = await generateCards({
      subjectLabel,
      profile: info.profile,
      chapterTitle,
      sectionTitle,
      content: content.slice(0, 14000)
    });
    return response.status(200).json({ success: true, cards, provider: 'auto' });
  } catch (error) {
    console.error('[FLASHCARDS] generation failed:', error.message);
    if (error.code) return jsonError(response, 502, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};

// CONFIG VERCEL — assignée APRÈS module.exports (visible au build)
module.exports.config = { maxDuration: 60 };
