import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextPacificMidnightMs } from './quota.js';
import {
  buildFallbackSlots,
  buildGeminiModelFallbackList,
  translateAllLanguages,
} from './pipeline.js';

const baseSettings = {
  engine: 'gemini' as const,
  geminiApiKey: 'test-key',
  geminiModel: '',
  deeplApiKey: '',
  libreTranslateUrl: '',
  libreTranslateApiKey: '',
  titleOver100: 'truncate' as const,
  hashtagMode: 'keep' as const,
  chapterMode: 'translate_labels' as const,
  protectedTerms: [] as string[],
  defaultSourceLanguage: 'en',
  autoFallbackOnQuota: true,
  geminiThrottleMs: 0,
};

function geminiOkJson(title: string, description: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ title, description }) }],
          },
        },
      ],
    }),
    text: async () => '',
  };
}

function geminiQuota() {
  return {
    ok: false,
    status: 429,
    text: async () => 'RESOURCE_EXHAUSTED You exceeded your current quota',
    json: async () => ({}),
  };
}

describe('buildGeminiModelFallbackList / buildFallbackSlots', () => {
  it('ranks flash stable before lite and preview; skips exhausted', () => {
    const now = Date.now();
    const until = nextPacificMidnightMs(now);
    const list = buildGeminiModelFallbackList(
      [
        'gemini-2.0-flash-lite',
        'gemini-2.5-flash-preview-05-20',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
      ],
      '',
      { 'gemini-2.5-flash': until },
      now,
    );
    expect(list[0]).toBe('gemini-2.0-flash');
    expect(list).not.toContain('gemini-2.5-flash');
    expect(list.indexOf('gemini-2.0-flash-lite')).toBeGreaterThan(
      list.indexOf('gemini-2.5-flash-preview-05-20'),
    );
  });

  it('puts configured model first', () => {
    const list = buildGeminiModelFallbackList(
      ['gemini-2.5-flash', 'gemini-2.0-flash-lite'],
      'gemini-2.0-flash-lite',
    );
    expect(list[0]).toBe('gemini-2.0-flash-lite');
  });

  it('builds Gemini → DeepL → Libre chain when auto-fallback on', () => {
    const slots = buildFallbackSlots({
      primary: 'gemini',
      geminiModels: ['gemini-2.5-flash', 'gemini-2.0-flash-lite'],
      hasDeepl: true,
      hasLibre: true,
      autoFallback: true,
    });
    expect(slots.map((s) => (s.engine === 'gemini' ? s.model : s.engine))).toEqual([
      'gemini-2.5-flash',
      'gemini-2.0-flash-lite',
      'deepl',
      'libretranslate',
    ]);
  });

  it('uses only primary engine when auto-fallback off', () => {
    const slots = buildFallbackSlots({
      primary: 'gemini',
      geminiModels: ['gemini-2.5-flash'],
      hasDeepl: true,
      hasLibre: true,
      autoFallback: false,
    });
    expect(slots).toEqual([{ engine: 'gemini', model: 'gemini-2.5-flash' }]);
  });
});

describe('translateAllLanguages quota fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('switches to next Gemini model on quota and continues', async () => {
    const exhausted: string[] = [];
    const usedModels: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/models?')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              models: [
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
                {
                  name: 'models/gemini-2.0-flash-lite',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
            }),
          };
        }
        if (u.includes('gemini-2.5-flash')) {
          usedModels.push('gemini-2.5-flash');
          return geminiQuota();
        }
        if (u.includes('gemini-2.0-flash-lite')) {
          usedModels.push('gemini-2.0-flash-lite');
          return geminiOkJson('T', 'D');
        }
        return geminiOkJson('T', 'D');
      }),
    );

    const progress: { language: string; engine?: string; model?: string; status: string }[] = [];
    const result = await translateAllLanguages(
      'Hello',
      'World',
      ['es', 'de'],
      baseSettings,
      (p) => {
        if (p.language && (p.status === 'ok' || p.status === 'running')) {
          progress.push({
            language: p.language,
            engine: p.engine,
            model: p.model,
            status: p.status,
          });
        }
      },
      {
        skipPreflight: true,
        geminiModelList: ['gemini-2.5-flash', 'gemini-2.0-flash-lite'],
        onGeminiModelExhausted: (m) => {
          exhausted.push(m);
        },
      },
    );

    expect(exhausted).toContain('gemini-2.5-flash');
    expect(result.ok.map((r) => r.language)).toEqual(['es', 'de']);
    expect(result.stopReason).toBeNull();
    expect(result.ok).toHaveLength(2);
    const okProgress = progress.filter((p) => p.status === 'ok');
    expect(okProgress.every((p) => p.engine === 'gemini')).toBe(true);
    expect(okProgress.every((p) => p.model === 'gemini-2.0-flash-lite')).toBe(true);
  });

  it('falls through to DeepL when all Gemini models exhausted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('generativelanguage')) {
          return geminiQuota();
        }
        if (u.includes('deepl.com')) {
          const body = String(init?.body ?? '');
          // preflight uses single text; translate uses two
          if (!body.includes('text=') || body.split('text=').length < 3) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ translations: [{ text: '.' }] }),
              text: async () => '',
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              translations: [{ text: 'Hola' }, { text: 'Mundo' }],
            }),
            text: async () => '',
          };
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );

    const engines: string[] = [];
    const result = await translateAllLanguages(
      'Hello',
      'World',
      ['es'],
      { ...baseSettings, deeplApiKey: 'deepl-key:fx' },
      (p) => {
        if (p.status === 'ok' && p.engine) engines.push(p.engine);
      },
      {
        skipPreflight: true,
        geminiModelList: ['gemini-2.5-flash'],
      },
    );

    // First call quotas gemini, then deepl succeeds
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0].title).toBe('Hola');
    expect(engines).toContain('deepl');
  });

  it('stops with clear summary when everything is exhausted', async () => {
    const now = Date.UTC(2024, 5, 15, 18, 0, 0);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => geminiQuota()),
    );

    const result = await translateAllLanguages(
      'Hello',
      'World',
      ['es', 'de', 'fr'],
      {
        ...baseSettings,
        geminiExhaustedModels: {
          'gemini-2.5-flash': nextPacificMidnightMs(now),
        },
      },
      undefined,
      {
        skipPreflight: true,
        geminiModelList: ['gemini-2.5-flash'],
        nowMs: now,
      },
    );

    expect(result.ok).toHaveLength(0);
    expect(result.pending.length).toBeGreaterThan(0);
    expect(result.stopReason).toBe('fatal');
    expect(result.fatalSummary).toMatch(/0 done/);
    expect(result.fatalSummary).toMatch(/remaining/);
    expect(result.fatalSummary).toMatch(/resets at/);
  });

  it('does not abort on quota when auto-fallback is on — retries same language', async () => {
    let flashCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('gemini-2.5-flash')) {
          flashCalls += 1;
          return geminiQuota();
        }
        if (u.includes('gemini-2.0-flash-lite')) {
          return geminiOkJson('Ok', 'Desc');
        }
        return geminiOkJson('Ok', 'Desc');
      }),
    );

    const result = await translateAllLanguages(
      'Hi',
      'There',
      ['ja'],
      baseSettings,
      undefined,
      {
        skipPreflight: true,
        geminiModelList: ['gemini-2.5-flash', 'gemini-2.0-flash-lite'],
      },
    );

    expect(flashCalls).toBeGreaterThanOrEqual(1);
    expect(result.ok.map((r) => r.language)).toEqual(['ja']);
    expect(result.failed).toEqual([]);
  });

  it('reuses lookupCache hits without calling the engine', async () => {
    const fetchMock = vi.fn(async () => geminiOkJson('live', 'live'));
    vi.stubGlobal('fetch', fetchMock);

    const okMeta: { language: string; cached: boolean }[] = [];
    const result = await translateAllLanguages(
      'Hello',
      'World',
      ['es', 'de'],
      baseSettings,
      undefined,
      {
        skipPreflight: true,
        geminiModelList: ['gemini-2.5-flash'],
        lookupCache: (lang) =>
          lang === 'es'
            ? { language: 'es', title: 'Cached', description: 'From cache' }
            : null,
        onLanguageOk: (r, meta) => {
          okMeta.push({ language: r.language, cached: meta.cached });
        },
      },
    );

    expect(result.ok).toEqual([
      { language: 'es', title: 'Cached', description: 'From cache' },
      { language: 'de', title: 'live', description: 'live' },
    ]);
    expect(okMeta).toEqual([
      { language: 'es', cached: true },
      { language: 'de', cached: false },
    ]);
    // Cache hit skips generateContent; only the miss should call the API.
    expect(fetchMock).toHaveBeenCalled();
    const urls = (fetchMock.mock.calls as unknown as [string][]).map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes(':generateContent'))).toHaveLength(1);
  });
});
