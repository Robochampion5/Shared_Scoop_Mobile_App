// api/translate.js — Sarvam AI Translation Microservice
// Vercel Serverless Function (Node 18+ runtime)
//
// POST /api/translate
// Body: { text: string, target_language?: string }
//
// Env vars required (set in Vercel dashboard):
//   SARVAM_API_KEY  — Bearer token for api.sarvam.ai
//
// Sarvam AI translation docs:
//   https://docs.sarvam.ai/api-reference-docs/translate

// ─── CORS headers ─────────────────────────────────────────────────────────────
// Applied to every response (including 4xx / 5xx) so the mobile client
// never sees an opaque CORS block masking the real error.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Sarvam supported target language codes ───────────────────────────────────
const VALID_LANGUAGES = new Set([
  'hi-IN', 'bn-IN', 'kn-IN', 'ml-IN', 'mr-IN',
  'od-IN', 'pa-IN', 'ta-IN', 'te-IN', 'gu-IN', 'en-IN',
]);

const DEFAULT_LANGUAGE = 'hi-IN';
const SARVAM_ENDPOINT = 'https://api.sarvam.ai/translate';
// Conservative timeout: Sarvam can be slow under load; 10s is safe for a serverless budget
const REQUEST_TIMEOUT_MS = 10_000;

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // ── Preflight (CORS) ────────────────────────────────────────────────────────
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── Method guard ────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed', allowed: 'POST' });
  }

  // ── Input validation ────────────────────────────────────────────────────────
  const { text, target_language } = req.body ?? {};

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Missing or empty "text" field in request body.' });
  }

  const targetLang = target_language ?? DEFAULT_LANGUAGE;
  if (!VALID_LANGUAGES.has(targetLang)) {
    return res.status(400).json({
      error: `Unsupported target_language: "${targetLang}".`,
      supported: [...VALID_LANGUAGES],
    });
  }

  // ── API key guard ───────────────────────────────────────────────────────────
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    console.error('[translate] SARVAM_API_KEY env var is not set.');
    return res.status(500).json({ error: 'Server configuration error: missing SARVAM_API_KEY.' });
  }

  // ── Sarvam AI fetch with timeout ────────────────────────────────────────────
  try {
    // AbortController provides a clean timeout without an external library
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let sarvamRes;
    try {
      sarvamRes = await fetch(SARVAM_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': apiKey,
        },
        body: JSON.stringify({
          input: text.trim(),
          source_language_code: 'en-IN',
          target_language_code: targetLang,
          speaker_gender: 'Male',
          mode: 'formal',
          model: 'mayura:v1',
        }),
        signal: controller.signal,
      });
    } finally {
      // Always clear the timeout, even if fetch threw
      clearTimeout(timeoutId);
    }

    // ── DEFENSIVE: read raw text first ────────────────────────────────────────
    // Sarvam's CDN may return an HTML error page instead of JSON on edge failures.
    // Never call .json() blindly — it throws SyntaxError on HTML responses.
    const rawText = await sarvamRes.text();
    console.log(`[translate] Sarvam HTTP ${sarvamRes.status} | body[:200]: ${rawText.slice(0, 200)}`);

    if (rawText.trimStart().startsWith('<')) {
      return res.status(502).json({
        error: 'Sarvam AI returned an unexpected HTML response (possible CDN/gateway error).',
        sarvam_status: sarvamRes.status,
        raw_preview: rawText.slice(0, 300),
      });
    }

    let sarvamData;
    try {
      sarvamData = JSON.parse(rawText);
    } catch {
      return res.status(502).json({
        error: 'Sarvam AI returned non-JSON response.',
        sarvam_status: sarvamRes.status,
        raw_preview: rawText.slice(0, 300),
      });
    }

    // ── Sarvam error passthrough ───────────────────────────────────────────────
    if (!sarvamRes.ok) {
      return res.status(502).json({
        error: 'Sarvam AI translation request failed.',
        sarvam_status: sarvamRes.status,
        sarvam_error: sarvamData,
      });
    }

    // ── Success ───────────────────────────────────────────────────────────────
    // Sarvam returns: { translated_text: string, ... }
    return res.status(200).json({
      translated_text: sarvamData.translated_text ?? sarvamData.output ?? '',
      source_language: sarvamData.source_language_code ?? 'auto',
      target_language: targetLang,
    });

  } catch (err) {
    // AbortError = our timeout fired; any other Error = unexpected network failure
    const isTimeout = err.name === 'AbortError';
    console.error(`[translate] ${isTimeout ? 'Timeout' : 'Unexpected error'}:`, err.message);

    return res.status(500).json({
      error: isTimeout
        ? `Sarvam AI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Try again.`
        : 'Internal server error during translation. See Vercel function logs.',
      detail: err.message,
    });
  }
}
