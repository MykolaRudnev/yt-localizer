import { describe, expect, it } from 'vitest';
import {
  CircuitBreaker,
  classifyError,
  extractHttpStatus,
  isModelNotFoundError,
  isQuotaExhaustedError,
  userFacingError,
} from './errors.js';

describe('classifyError', () => {
  it('marks invalid key / auth as fatal', () => {
    expect(classifyError(new Error('Gemini 400: API_KEY_INVALID'))).toBe('fatal');
    expect(classifyError(new Error('Gemini 401: Unauthorized'))).toBe('fatal');
    expect(classifyError(new Error('DeepL 403: Forbidden'))).toBe('fatal');
  });

  it('marks model-not-found 404 as fatal', () => {
    expect(
      classifyError(
        new Error('Gemini 404: models/gemini-2.0-flash is not found for API version'),
      ),
    ).toBe('fatal');
    expect(
      classifyError(new Error('Gemini 404: model no longer available, use models/gemini-3.x-flash')),
    ).toBe('fatal');
  });

  it('marks daily quota 429 as fatal, rate-limit 429 as transient', () => {
    const quota = new Error('Gemini 429: RESOURCE_EXHAUSTED You exceeded your current quota');
    expect(classifyError(quota)).toBe('fatal');
    expect(isQuotaExhaustedError(quota)).toBe(true);
    expect(isQuotaExhaustedError(new Error('Gemini 429: Rate limit exceeded, retry later'))).toBe(
      false,
    );
    expect(classifyError(new Error('Gemini 429: Rate limit exceeded, retry later'))).toBe(
      'transient',
    );
  });

  it('marks DeepL 456 Quota exceeded as quota-exhausted', () => {
    const err = new Error('DeepL 456: Quota exceeded');
    expect(isQuotaExhaustedError(err)).toBe(true);
    expect(classifyError(err)).toBe('fatal');
  });

  it('marks 5xx and network as transient', () => {
    expect(classifyError(new Error('Gemini 503: unavailable'))).toBe('transient');
    expect(classifyError(new Error('Failed to fetch'))).toBe('transient');
    expect(classifyError(new Error('network error ECONNRESET'))).toBe('transient');
  });

  it('marks JSON-mode / responseMimeType 400 as transient (recoverable)', () => {
    expect(
      classifyError(
        new Error('Gemini 400: JSON mode is not enabled for this model INVALID_ARGUMENT'),
      ),
    ).toBe('transient');
    expect(
      classifyError(new Error('Gemini 400: responseMimeType is not supported')),
    ).toBe('transient');
  });
});

describe('isModelNotFoundError / extractHttpStatus', () => {
  it('detects model 404', () => {
    const err = new Error('Gemini 404: model no longer available');
    expect(extractHttpStatus(err)).toBe(404);
    expect(isModelNotFoundError(err)).toBe(true);
  });
});

describe('userFacingError', () => {
  it('hints Options > Model for missing models', () => {
    const face = userFacingError(new Error('Gemini 404: model not found'));
    expect(face.summary).toMatch(/model/i);
    expect(face.hint).toMatch(/Options/i);
  });

  it('hints invalid API key', () => {
    const face = userFacingError(new Error('Gemini 400: API key not valid'));
    expect(face.summary).toMatch(/Invalid API key|400/i);
  });

  it('names DeepL + status and hints :fx for 403', () => {
    const face = userFacingError(new Error('DeepL 403: Forbidden'));
    expect(face.summary).toMatch(/DeepL 403/);
    expect(face.hint).toMatch(/:fx/);
  });
});

describe('CircuitBreaker', () => {
  it('trips after 3 consecutive failures', () => {
    const b = new CircuitBreaker(3);
    expect(b.recordFailure()).toBe(false);
    expect(b.recordFailure()).toBe(false);
    expect(b.recordFailure()).toBe(true);
    expect(b.isTripped).toBe(true);
  });

  it('resets streak on success', () => {
    const b = new CircuitBreaker(3);
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    expect(b.consecutiveFailures).toBe(0);
    expect(b.recordFailure()).toBe(false);
    expect(b.recordFailure()).toBe(false);
    expect(b.recordFailure()).toBe(true);
  });
});
