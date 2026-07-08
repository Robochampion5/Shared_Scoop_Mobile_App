// src/lib/sarvam.ts — Sarvam AI Translation Utility
//
// Architectural contract:
//   - All network I/O routes through the Vercel proxy at /api/translate.
//     The mobile client never holds the SARVAM_API_KEY — it lives server-side.
//   - API key is resolved by the Vercel function from process.env.SARVAM_API_KEY.
//     This file receives the Vercel URL from process.env.EXPO_PUBLIC_VERCEL_URL.
//   - Throws a typed SarvamError on HTTP 401, 429, 500, and network failures.
//   - AbortController enforces a hard 12-second client-side timeout independent
//     of the server-side timeout — prevents Hermes thread hang on flaky networks.

// ─── Supported language codes ─────────────────────────────────────────────────
export const SARVAM_LANGUAGES = [
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'pa-IN', label: 'Punjabi' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'od-IN', label: 'Odia' },
  { code: 'en-IN', label: 'English (IN)' },
] as const;

export type SarvamLangCode = typeof SARVAM_LANGUAGES[number]['code'];

// ─── Error type ───────────────────────────────────────────────────────────────
export interface SarvamError {
  code: 'UNAUTHORIZED' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'NETWORK_TIMEOUT' | 'PARSE_ERROR' | 'UNKNOWN';
  httpStatus: number;
  message: string;
  raw?: string;
}

// ─── Response shape from /api/translate ──────────────────────────────────────
interface TranslateProxyResponse {
  translated_text: string;
  source_language_code?: string;
  target_language_code?: string;
}

// ─── Main export ─────────────────────────────────────────────────────────────
/**
 * translateWithSarvam
 *
 * Calls the Vercel proxy at /api/translate, which injects the SARVAM_API_KEY
 * server-side. Returns the translated string and measured latency.
 *
 * @param text         Source string (max ~5000 characters per Sarvam limit)
 * @param targetLang   BCP-47 code from SARVAM_LANGUAGES
 * @returns            { translatedText, latencyMs }
 * @throws             SarvamError with structured code + message
 */
export async function translateWithSarvam(
  text: string,
  targetLang: SarvamLangCode
): Promise<{ translatedText: string; latencyMs: number }> {


  // Hard client-side timeout — independent of the server's AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  const t0 = Date.now();

  let response: Response;
  let rawText: string;

  try {
    // ⚠️ HACKATHON BYPASS: Hitting Sarvam directly. Remove after demo!
    response = await fetch(`${process.env.EXPO_PUBLIC_VERCEL_URL}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target_language: targetLang }),
      signal: controller.signal,
    });
  } catch (fetchErr: any) {
    clearTimeout(timeoutId);
    // AbortError means our 12s timeout fired
    if (fetchErr?.name === 'AbortError') {
      const err: SarvamError = {
        code: 'NETWORK_TIMEOUT',
        httpStatus: 0,
        message: 'Request timed out after 12 seconds. Check network connectivity.',
      };
      throw err;
    }
    const err: SarvamError = {
      code: 'UNKNOWN',
      httpStatus: 0,
      message: fetchErr?.message ?? 'Network request failed.',
    };
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const latencyMs = Date.now() - t0;

  // Read raw text first — Vercel 4xx/5xx can return HTML error pages
  try {
    rawText = await response.text();
  } catch {
    const err: SarvamError = {
      code: 'PARSE_ERROR',
      httpStatus: response.status,
      message: 'Could not read response body.',
    };
    throw err;
  }

  // ── HTTP error classification ──────────────────────────────────────────────
  if (!response.ok) {
    const isHtml = rawText.trimStart().startsWith('<');

    const baseErr = {
      httpStatus: response.status,
      raw: isHtml ? rawText.slice(0, 300) : rawText,
    };

    if (response.status === 401) {
      const err: SarvamError = {
        ...baseErr,
        code: 'UNAUTHORIZED',
        message: 'Sarvam API key is invalid or missing (HTTP 401). Set SARVAM_API_KEY in Vercel.',
      };
      throw err;
    }

    if (response.status === 429) {
      const err: SarvamError = {
        ...baseErr,
        code: 'RATE_LIMITED',
        message: 'Sarvam rate limit exceeded (HTTP 429). Back off and retry.',
      };
      throw err;
    }

    if (response.status >= 500) {
      const err: SarvamError = {
        ...baseErr,
        code: 'SERVER_ERROR',
        message: isHtml
          ? `Vercel returned an HTML error page (HTTP ${response.status}). The /api/translate route may not be deployed.`
          : `Server error (HTTP ${response.status}): ${rawText.slice(0, 200)}`,
      };
      throw err;
    }

    // Catch-all 4xx
    const err: SarvamError = {
      ...baseErr,
      code: 'UNKNOWN',
      message: `Unexpected HTTP ${response.status}: ${rawText.slice(0, 200)}`,
    };
    throw err;
  }

  // ── Safe JSON parse ────────────────────────────────────────────────────────
  let parsed: TranslateProxyResponse;
  try {
    parsed = JSON.parse(rawText) as TranslateProxyResponse;
  } catch {
    const err: SarvamError = {
      code: 'PARSE_ERROR',
      httpStatus: response.status,
      message: `Response is not valid JSON: ${rawText.slice(0, 200)}`,
      raw: rawText,
    };
    throw err;
  }

  if (!parsed.translated_text) {
    const err: SarvamError = {
      code: 'PARSE_ERROR',
      httpStatus: response.status,
      message: `Sarvam response missing 'translated_text' field. Got: ${rawText.slice(0, 200)}`,
      raw: rawText,
    };
    throw err;
  }

  return { translatedText: parsed.translated_text, latencyMs };
}
