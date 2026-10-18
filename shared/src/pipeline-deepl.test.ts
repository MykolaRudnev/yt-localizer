import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deeplUnsupportedFallbackNote,
  translateAllLanguages,
} from './pipeline.js';

const baseSettings = {
  engine: 'deepl' as const,
  geminiApiKey: 'gemini-key',
  geminiModel: '',
  deeplApiKey: 'deepl-key:fx',
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

describe('DeepL primary engine behaviour', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('primary DeepL preflight 403 is fatal — does not call Gemini', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        urls.push(u);
        if (u.includes('deepl.com')) {
          return {
            ok: false,
            status: 403,
            text: async () => 'Forbidden',
            json: async () => ({}),
          };
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );

    const result = await translateAllLanguages(
      'Hello',
      'World',
      ['es', 'de'],
      baseSettings,
      undefined,
      { geminiModelList: ['gemini-2.5-flash'] },
    );

    expect(result.stopReason).toBe('fatal');
    expect(result.ok).toHaveLength(0);
    expect(result.fatalSummary).toMatch(/DeepL/);
    expect(result.fatalHint).toMatch(/:fx/);
    expect(urls.some((u) => u.includes('generativelanguage'))).toBe(false);
    expect(urls.every((u) => u.includes('deepl'))).toBe(true);
  });

  it('DeepL unsupported language falls back per-language to Gemini', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('deepl.com')) {
          const body = String(init?.body ?? '');
          // preflight: one text=; translate: two
          if (body.split('text=').length < 3) {
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
        if (u.includes('generativelanguage')) {
          return geminiOkJson('नमस्ते', 'दुनिया');
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );

    const notes: string[] = [];
    const engines: string[] = [];
    const headerEngines: string[] = [];

    const result = await translateAllLanguages(
      'Hello',
      'World',
      ['es', 'hi'],
      baseSettings,
      (p) => {
        if (!p.language && p.engine) headerEngines.push(p.engine);
        if (p.status === 'ok' && p.engine) engines.push(p.engine);
        if (p.note) notes.push(p.note);
      },
      { geminiModelList: ['gemini-2.5-flash'] },
    );

    expect(result.stopReason).toBeNull();
    expect(result.ok.map((r) => r.language)).toEqual(['es', 'hi']);
    expect(engines).toEqual(['deepl', 'gemini']);
    expect(notes.some((n) => n === deeplUnsupportedFallbackNote('hi', 'gemini'))).toBe(
      true,
    );
    // Job header stays on DeepL (primary that passed preflight)
    expect(headerEngines[0]).toBe('deepl');
    expect(headerEngines.every((e) => e === 'deepl')).toBe(true);
  });

  it('trims DeepL key so :fx free endpoint is used', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return {
          ok: false,
          status: 403,
          text: async () => 'Forbidden',
          json: async () => ({}),
        };
      }),
    );

    await translateAllLanguages(
      'Hello',
      'World',
      ['es'],
      { ...baseSettings, deeplApiKey: '  secret:fx\n', geminiApiKey: '' },
      undefined,
      { skipPreflight: false },
    );

    expect(urls[0]).toContain('api-free.deepl.com');
    expect(urls.some((u) => u.includes('api.deepl.com/v2') && !u.includes('api-free'))).toBe(
      false,
    );
  });

  it('DeepL 456 quota on preflight falls back to Gemini when auto-fallback on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('deepl.com')) {
          return {
            ok: false,
            status: 456,
            text: async () => 'Quota exceeded',
            json: async () => ({}),
          };
        }
        if (u.includes('generativelanguage')) {
          if (u.includes('/models?')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                models: [
                  {
                    name: 'models/gemini-2.5-flash',
                    supportedGenerationMethods: ['generateContent'],
                  },
                ],
              }),
            };
          }
          return geminiOkJson('Hola', 'Mundo');
        }
        throw new Error(`unexpected ${u}`);
      }),
    );

    const headerEngines: string[] = [];
    const result = await translateAllLanguages(
      'Hello',
      'World',
      ['es'],
      baseSettings,
      (p) => {
        if (!p.language && p.engine) headerEngines.push(p.engine);
      },
      { geminiModelList: ['gemini-2.5-flash'] },
    );

    expect(result.ok).toHaveLength(1);
    expect(result.stopReason).toBeNull();
    expect(headerEngines.at(-1)).toBe('gemini');
  });
});
