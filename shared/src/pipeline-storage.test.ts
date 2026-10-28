import { afterEach, describe, expect, it, vi } from 'vitest';
import { lruOverflow } from './cache.js';
import { classifyError, isQuotaExhaustedError, isStorageQuotaError, userFacingError } from './errors.js';
import { translateAllLanguages } from './pipeline.js';

const STORAGE_FULL = new Error(
  'Resource::kQuotaBytes quota exceeded (QUOTA_BYTES quota exceeded)',
);

const settings = {
  engine: 'gemini' as const,
  geminiApiKey: 'test-key',
  geminiModel: '',
  deeplApiKey: '',
  libreTranslateUrl: '',
  libreTranslateApiKey: '',
  titleOver100: 'truncate' as const,
  protectLastSegment: true,
  hashtagMode: 'keep' as const,
  chapterMode: 'translate_labels' as const,
  protectedTerms: [] as string[],
  defaultSourceLanguage: 'en',
  autoFallbackOnQuota: true,
  geminiThrottleMs: 0,
};

describe('chrome.storage quota is not an API quota', () => {
  it('is recognised as a storage error, never as engine quota', () => {
    expect(isStorageQuotaError(STORAGE_FULL)).toBe(true);
    expect(isQuotaExhaustedError(STORAGE_FULL)).toBe(false);
    expect(userFacingError(STORAGE_FULL).summary).toBe('Extension storage is full');
  });

  it('keeps real Gemini / DeepL quota errors as quota', () => {
    expect(isQuotaExhaustedError(new Error('Gemini 429: RESOURCE_EXHAUSTED quota'))).toBe(true);
    expect(isQuotaExhaustedError(new Error('DeepL 456: Quota exceeded'))).toBe(true);
    expect(classifyError(new Error('Gemini 429: rate limit'))).toBe('transient');
  });
});

describe('translateAllLanguages when saving a result fails', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops with the save error and does not mark models exhausted or retranslate', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ title: 'T', description: 'D' }) }] } }],
      }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const exhausted: string[] = [];

    await expect(
      translateAllLanguages('Title', 'Desc', ['de', 'fr'], settings, undefined, {
        skipPreflight: true,
        geminiModelList: ['gemini-2.5-flash', 'gemini-2.0-flash'],
        onGeminiModelExhausted: (m) => {
          exhausted.push(m);
        },
        onLanguageOk: () => {
          throw STORAGE_FULL;
        },
      }),
    ).rejects.toThrow(/quota exceeded/i);

    expect(exhausted).toEqual([]);
    // One translate call for "de" only — no second model, no "fr".
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('lruOverflow', () => {
  it('drops the least recently touched videos beyond the cap', () => {
    expect(lruOverflow({ a: 3, b: 1, c: 2 }, 2)).toEqual(['b']);
    expect(lruOverflow({ a: 1 }, 2)).toEqual([]);
  });
});
