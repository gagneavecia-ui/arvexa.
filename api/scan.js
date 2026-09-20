const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const requestLog = new Map();
// Vercel limits serverless request bodies; keep room for JSON/base64 overhead.
const MAX_IMAGE_LENGTH = 3 * 1024 * 1024;
const ALLOWED_ACTIONS = new Set(['analyze', 'action']);
let adminAuth;

function getAdminAuth() {
  if (adminAuth) return adminAuth;
  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials) throw new Error('firebase_admin_not_configured');
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(credentials);
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  adminAuth = admin.auth();
  return adminAuth;
}

async function verifyFirebaseToken(request) {
  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try { return await getAdminAuth().verifyIdToken(match[1]); } catch (_) { return null; }
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

function errorResponse(response, status, error) {
  return response.status(status).json({ success: false, error });
}

function providers() {
  return [
    { name: 'Groq', key: process.env.GROQ_API_KEY, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct' },
    { name: 'OpenRouter', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.0-flash-001' },
    { name: 'Mistral', key: process.env.MISTRAL_API_KEY, endpoint: 'https://api.mistral.ai/v1/chat/completions', model: process.env.MISTRAL_VISION_MODEL || 'pixtral-large-latest' }
  ].filter((provider) => Boolean(provider.key));
}

function buildMessages(body) {
  const system = 'Tu es ARV-SCAN, assistant pédagogique. Réponds uniquement avec un objet JSON valide, sans markdown ni texte avant ou après. Les formules doivent être en LaTeX entre $...$ ou $$...$$.';
  if (body.action === 'analyze') {
    return [
      { role: 'system', content: system },
      { role: 'user', content: [
        { type: 'text', text: body.prompt },
        { type: 'image_url', image_url: { url: body.image } }
      ] }
    ];
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${body.prompt}\nAnalyse structurée: ${JSON.stringify(body.analysis)}` }
  ];
}

async function callProvider(provider, messages, maxTokens) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const result = await fetch(provider.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}`, ...(provider.name === 'OpenRouter' ? { 'HTTP-Referer': process.env.APP_ORIGIN || '', 'X-Title': 'ARVEXA School' } : {}) },
      body: JSON.stringify({ model: provider.model, messages, temperature: 0.2, max_tokens: Math.min(Number(maxTokens) || 900, 1400), ...(provider.name === 'Mistral' ? {} : { response_format: { type: 'json_object' } }) }),
      signal: controller.signal
    });
    const data = await result.json().catch(() => null);
    if (!result.ok) throw new Error(`${provider.name} HTTP ${result.status}`);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${provider.name} réponse vide`);
    return JSON.parse(content);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return errorResponse(response, 405, 'Méthode non autorisée.'); }
  if (rateLimited(clientIp(request))) return errorResponse(response, 429, 'Trop de demandes. Réessaie dans une minute.');
  let verifiedUser;
  try { verifiedUser = await verifyFirebaseToken(request); } catch (error) {
    console.error('ARV-SCAN auth configuration failed:', error.message);
    return errorResponse(response, 503, 'Service d’authentification temporairement indisponible.');
  }
  if (!verifiedUser) return errorResponse(response, 401, 'Connexion requise.');

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  if (!ALLOWED_ACTIONS.has(body.action)) return errorResponse(response, 400, 'Action ARV-SCAN invalide.');
  if (body.action === 'analyze') {
    if (typeof body.image !== 'string' || !body.image.startsWith('data:image/')) return errorResponse(response, 400, 'Image invalide.');
    if (body.image.length > MAX_IMAGE_LENGTH) return errorResponse(response, 413, 'Image trop lourde.');
    if (typeof body.prompt !== 'string' || body.prompt.length > 8000) return errorResponse(response, 400, 'Demande invalide.');
  } else if (typeof body.prompt !== 'string' || body.prompt.length > 8000 || !body.analysis) {
    return errorResponse(response, 400, 'Action invalide.');
  }

  const availableProviders = providers();
  if (!availableProviders.length) return errorResponse(response, 503, 'Service IA temporairement indisponible.');
  const messages = buildMessages(body);
  for (const provider of availableProviders) {
    try {
      const result = await callProvider(provider, messages, body.maxTokens);
      return response.status(200).json({ success: true, result });
    } catch (error) {
      console.warn(`${provider.name} ARV-SCAN indisponible:`, error.message);
    }
  }
  return errorResponse(response, 502, 'Impossible de traiter cette image pour le moment.');
};
