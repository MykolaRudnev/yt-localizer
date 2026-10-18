import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GEMINI_FALLBACK_MODEL,
  chatModelRank,
  extractJsonObject,
  generateContent,
  isEligibleChatModel,
  normalizeGeminiModelId,
  pickBestFlashModel,
} from './gemini.js';
import { classifyError, isJsonModeUnsupportedError } from '../errors.js';

describe('pickBestFlashModel / chatModelRank', () => {
  it('prefers stable flash over preview, lite, and pro', () => {
    const picked = pickBestFlashModel([
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash-preview-05-20',
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-1.5-pro',
      'gemini-2.5-pro',
    ]);
    expect(picked).toBe('gemini-2.5-flash');
  });

  it('excludes specialty models (image, tts, live, embedding, gemma, …)', () => {
    const pool = [
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-preview-tts',
      'gemini-2.0-flash-live-001',
      'text-embedding-004',
      'aqa',
      'gemini-robotics-er-1.5-preview',
      'gemini-2.5-computer-use-preview-10-2025',
      'learnlm-2.0-flash-experimental',
      'gemma-3-27b-it',
      'gemini-2.0-flash-thinking-exp',
      'gemini-2.5-flash',
    ];
    expect(pickBestFlashModel(pool)).toBe('gemini-2.5-flash');
    for (const id of pool.slice(0, -1)) {
      expect(isEligibleChatModel(id)).toBe(false);
    }
  });

  it('allows lite only as last fallback among chat models', () => {
    expect(
      pickBestFlashModel(['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite-preview']),
    ).toBe('gemini-2.0-flash-lite');
    expect(chatModelRank('gemini-2.5-flash')).toBeGreaterThan(
      chatModelRank('gemini-2.0-flash-lite'),
    );
  });

  it('picks pro when no flash chat model exists', () => {
    expect(pickBestFlashModel(['gemini-1.5-pro', 'embedding-001'])).toBe('gemini-1.5-pro');
  });

  it('falls back to alias when nothing eligible', () => {
    expect(pickBestFlashModel(['embedding-001', 'gemma-3-4b'])).toBe(GEMINI_FALLBACK_MODEL);
  });

  it('strips models/ prefix', () => {
    expect(normalizeGeminiModelId('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });
});

describe('extractJsonObject', () => {
  it('parses raw JSON', () => {
    expect(extractJsonObject('{"title":"a","description":"b"}')).toEqual({
      title: 'a',
      description: 'b',
    });
  });

  it('strips markdown fences', () => {
    const text = '```json\n{"title":"x","description":"y"}\n```';
    expect(extractJsonObject(text)).toEqual({ title: 'x', description: 'y' });
  });

  it('extracts first {...} block from prose', () => {
    const text = 'Sure!\n{"title":"t","description":"d"}\nHope that helps.';
    expect(extractJsonObject(text)).toEqual({ title: 't', description: 'd' });
  });
});

describe('JSON mode fallback path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries without responseMimeType and remembers jsonMode:false', async () => {
    const bodies: unknown[] = [];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls += 1;
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          generationConfig?: { responseMimeType?: string };
        };
        bodies.push(body.generationConfig);
        if (calls === 1) {
          return {
            ok: false,
            status: 400,
            text: async () =>
              'JSON mode is not enabled for this model (INVALID_ARGUMENT)',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: '```json\n{"ok":true}\n```' }],
                },
              },
            ],
          }),
        };
      }),
    );

    const remembered: boolean[] = [];
    const text = await generateContent('key', 'gemini-2.5-flash', 'Reply {"ok":true}', {
      jsonMode: undefined,
      onJsonModeResolved: (m) => {
        remembered.push(m);
      },
    });

    expect(calls).toBe(2);
    expect(bodies[0]).toMatchObject({ responseMimeType: 'application/json' });
    expect(bodies[1]).not.toHaveProperty('responseMimeType');
    expect(remembered).toEqual([false]);
    expect(extractJsonObject(text)).toEqual({ ok: true });
  });

  it('skips JSON mode when jsonMode is already false', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls += 1;
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          generationConfig?: { responseMimeType?: string };
        };
        expect(body.generationConfig?.responseMimeType).toBeUndefined();
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          }),
        };
      }),
    );

    await generateContent('key', 'gemini-2.5-flash', 'hi', { jsonMode: false });
    expect(calls).toBe(1);
  });
});

describe('classifyError JSON mode', () => {
  it('treats JSON-mode 400 as transient, invalid key still fatal', () => {
    const jsonErr = new Error(
      'Gemini 400: JSON mode is not enabled for this model (INVALID_ARGUMENT)',
    );
    expect(isJsonModeUnsupportedError(jsonErr)).toBe(true);
    expect(classifyError(jsonErr)).toBe('transient');
    expect(classifyError(new Error('Gemini 400: API_KEY_INVALID'))).toBe('fatal');
  });
});
