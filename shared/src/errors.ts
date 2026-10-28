export type ErrorKind = 'fatal' | 'transient';

export type JobStopReason = 'fatal' | 'circuit' | 'aborted' | null;

const STATUS_RE = /\b([45]\d{2})\b/;

/** Extract HTTP status from engine error messages like "Gemini 404: …". */
export function extractHttpStatus(err: unknown): number | undefined {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(STATUS_RE);
  return m ? Number(m[1]) : undefined;
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))) {
    return true;
  }
  return false;
}

export function isModelNotFoundError(err: unknown): boolean {
  const status = extractHttpStatus(err);
  const msg = err instanceof Error ? err.message : String(err);
  if (status === 404) {
    return /model|not found|no longer available|NOT_FOUND/i.test(msg);
  }
  return /model.*(not found|no longer available)|NOT_FOUND.*model/i.test(msg);
}

/** 400 JSON mode / responseMimeType unsupported — recoverable via plain-text fallback. */
export function isJsonModeUnsupportedError(err: unknown): boolean {
  const status = extractHttpStatus(err);
  if (status !== undefined && status !== 400) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /JSON mode|responseMimeType|responseSchema/i.test(msg);
}

/** Daily / per-model quota (not short rate-limit). Pipeline may switch models/engines when auto-fallback is on. */
export function isQuotaExhaustedError(err: unknown): boolean {
  const status = extractHttpStatus(err);
  const msg = err instanceof Error ? err.message : String(err);
  // chrome.storage "QUOTA_BYTES quota exceeded" is a local disk limit, not an API quota.
  if (isStorageQuotaError(err)) return false;
  // DeepL Free/Pro: HTTP 456 = Quota exceeded
  if (status === 456) return true;
  if (status === 429 && /quota|RESOURCE_EXHAUSTED|daily|exceeded your current quota/i.test(msg)) {
    return true;
  }
  return /Quota exceeded/i.test(msg);
}

/** chrome.storage write rejected because the extension's storage quota is full. */
export function isStorageQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /QUOTA_BYTES|kQuotaBytes/i.test(msg);
}

/**
 * FATAL: invalid key, auth, model missing, daily quota exhausted.
 * TRANSIENT: rate limit 429, 5xx, network, JSON-mode-unsupported — safe to retry/fallback.
 */
export function classifyError(err: unknown): ErrorKind {
  if (isAbortError(err)) return 'fatal';

  const msg = err instanceof Error ? err.message : String(err);
  const status = extractHttpStatus(err);

  if (status === 401 || status === 403) return 'fatal';
  // Before API-key checks: INVALID_ARGUMENT in JSON-mode errors must stay recoverable
  if (isJsonModeUnsupportedError(err)) return 'transient';
  if (
    status === 400 &&
    /API_KEY_INVALID|api.?key.*(?:invalid|not valid)|(?:invalid|not valid).*api.?key/i.test(msg)
  ) {
    return 'fatal';
  }
  if (isModelNotFoundError(err)) return 'fatal';
  if (isQuotaExhaustedError(err)) return 'fatal';
  if (status === 429) return 'transient';
  if (status !== undefined && status >= 500) return 'transient';
  if (
    /network|fetch failed|Failed to fetch|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket|offline/i.test(
      msg,
    )
  ) {
    return 'transient';
  }
  // Unknown 4xx → treat as fatal so we stop rather than thrash
  if (status !== undefined && status >= 400 && status < 500) return 'fatal';
  return 'transient';
}

function engineFromErrorMessage(msg: string): string | undefined {
  if (/^DeepL\b/i.test(msg) || /\bDeepL\b/i.test(msg)) return 'DeepL';
  if (/^Gemini\b/i.test(msg) || /\bGemini\b/i.test(msg)) return 'Gemini';
  if (/LibreTranslate/i.test(msg)) return 'LibreTranslate';
  return undefined;
}

export function userFacingError(err: unknown): { summary: string; hint: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const status = extractHttpStatus(err);
  const engine = engineFromErrorMessage(msg);

  if (isStorageQuotaError(err)) {
    return {
      summary: 'Extension storage is full',
      hint: 'Clear the translation cache in Options, then use Retry for the remaining languages.',
    };
  }

  if (engine === 'DeepL' && (status === 401 || status === 403)) {
    return {
      summary: `DeepL ${status}`,
      hint: 'DeepL key invalid - check Options; Free keys end with :fx',
    };
  }
  if (engine === 'DeepL' && (status === 400 || status === undefined)) {
    const network =
      /network|fetch failed|Failed to fetch|CORS|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg);
    return {
      summary: status !== undefined ? `DeepL ${status}` : 'DeepL request failed',
      hint: network
        ? 'DeepL network/CORS error - check connectivity and Options key, then Retry.'
        : 'DeepL key invalid - check Options; Free keys end with :fx',
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    /API_KEY_INVALID|api.?key.*(?:invalid|not valid)|(?:invalid|not valid).*api.?key/i.test(msg)
  ) {
    return {
      summary: status !== undefined ? `${engine ?? 'Engine'} ${status}` : 'Invalid API key',
      hint:
        engine === 'DeepL'
          ? 'DeepL key invalid - check Options; Free keys end with :fx'
          : 'Open Options and paste a valid Gemini (or engine) API key, then Save.',
    };
  }
  if (isModelNotFoundError(err)) {
    return {
      summary: 'Gemini model not found',
      hint: 'Open Options → Model, click Load models, pick a flash model (or leave Auto), then Save.',
    };
  }
  if (isQuotaExhaustedError(err)) {
    return {
      summary:
        status !== undefined
          ? `${engine ?? 'API'} ${status}: quota exhausted`
          : 'API quota exhausted',
      hint: 'Daily quota is used up. Wait until reset, or use another API key / project.',
    };
  }
  if (status === 429) {
    return {
      summary: 'Rate limited',
      hint: 'Too many requests. Wait a moment and Retry.',
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      summary: 'Translation service error',
      hint: 'The API had a temporary failure. Retry in a bit.',
    };
  }
  if (engine && status !== undefined) {
    return {
      summary: `${engine} ${status}`,
      hint: 'Check Options (API key / model) and Retry.',
    };
  }
  return {
    summary: msg.slice(0, 160) || 'Translation failed',
    hint: 'Check Options (API key / model) and Retry.',
  };
}

/** Consecutive language failures; trip after `threshold` in a row. */
export class CircuitBreaker {
  private consecutive = 0;

  constructor(private readonly threshold = 3) {}

  recordSuccess(): void {
    this.consecutive = 0;
  }

  /** @returns true if the breaker tripped (should stop the job). */
  recordFailure(): boolean {
    this.consecutive += 1;
    return this.consecutive >= this.threshold;
  }

  get consecutiveFailures(): number {
    return this.consecutive;
  }

  get isTripped(): boolean {
    return this.consecutive >= this.threshold;
  }

  reset(): void {
    this.consecutive = 0;
  }
}
