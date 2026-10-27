import type { TranslateOptions, TranslationEngine } from '../types.js';
import { withRetry } from '../retry.js';
import { isJsonModeUnsupportedError, isModelNotFoundError } from '../errors.js';
export { isJsonModeUnsupportedError } from '../errors.js';
import { YT_TITLE_MAX } from '../limits.js';
import { prepareForTranslation, restorePrepared } from '../text/placeholders.js';

/** Stable alias used when listing models fails. */
export const GEMINI_FALLBACK_MODEL = 'gemini-flash-latest';

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const EXCLUDE_RE =
  /image|tts|audio|live|embedding|aqa|vision|thinking-exp|robotics|computer-use|nano|learnlm|gemma/i;

/** Plain text chat: gemini-*-flash or gemini-*-pro (not specialty variants). */
const CHAT_RE = /^gemini-[\w.-]*-(flash|pro)(?:-|$)/i;

export type GeminiModelHooks = {
  /** Called when auto-pick (or 404 refresh) chooses a model — cache it. */
  onModelResolved?: (model: string) => void | Promise<void>;
  /**
   * Known JSON-mode capability for this model.
   * undefined = unknown (try responseMimeType); false = skip JSON mode.
   */
  jsonMode?: boolean;
  /** Persist per-model capability after discovery. */
  onJsonModeResolved?: (model: string, jsonMode: boolean) => void | Promise<void>;
};

function stripModelsPrefix(name: string): string {
  return name.replace(/^models\//, '').trim();
}

export function normalizeGeminiModelId(name: string): string {
  return stripModelsPrefix(name);
}

type ApiModel = {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
};

/** List model ids that support generateContent. */
export async function listGeminiModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${MODELS_URL}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { models?: ApiModel[] };
  const out: string[] = [];
  for (const m of data.models ?? []) {
    const methods = m.supportedGenerationMethods ?? [];
    if (!methods.includes('generateContent')) continue;
    if (!m.name) continue;
    out.push(normalizeGeminiModelId(m.name));
  }
  return out;
}

function versionKey(id: string): number[] {
  const nums = id.match(/\d+/g);
  return nums ? nums.map(Number) : [0];
}

function cmpVersionDesc(a: string, b: string): number {
  const av = versionKey(a);
  const bv = versionKey(b);
  const n = Math.max(av.length, bv.length);
  for (let i = 0; i < n; i++) {
    const d = (bv[i] ?? 0) - (av[i] ?? 0);
    if (d) return d;
  }
  return b.localeCompare(a);
}

/**
 * Rank eligible chat models. Higher is better. -1 = ineligible.
 * Prefer flash > pro, stable > preview/exp, non-lite > lite (lite last).
 */
export function chatModelRank(id: string): number {
  const lower = normalizeGeminiModelId(id).toLowerCase();
  if (!CHAT_RE.test(lower)) return -1;
  if (EXCLUDE_RE.test(lower)) return -1;

  const isFlash = lower.includes('-flash');
  const isPro = /(?:^|-)pro(?:-|$)/.test(lower);
  if (!isFlash && !isPro) return -1;

  const lite = lower.includes('lite');
  const preview = lower.includes('preview') || lower.includes('exp');

  // Tiers: non-lite first (100+), lite only as last resort (0–19)
  if (lite) {
    let score = isFlash ? 10 : 5;
    if (!preview) score += 4;
    return score;
  }
  let score = isFlash ? 100 : 50;
  if (!preview) score += 20;
  return score;
}

export function isEligibleChatModel(id: string): boolean {
  return chatModelRank(id) >= 0;
}

/**
 * Eligible chat models sorted best-first: stable flash → flash-lite → flash-preview → pro…
 */
export function rankEligibleChatModels(models: string[]): string[] {
  const eligible = [
    ...new Set(models.map(normalizeGeminiModelId).filter((id) => chatModelRank(id) >= 0)),
  ];
  eligible.sort((a, b) => {
    const sd = chatModelRank(b) - chatModelRank(a);
    if (sd) return sd;
    return cmpVersionDesc(a, b);
  });
  return eligible;
}

/**
 * Best plain-text chat model (flash/pro); lite only if nothing else.
 * Falls back to GEMINI_FALLBACK_MODEL if nothing matches.
 */
export function pickBestFlashModel(models: string[]): string {
  const ranked = rankEligibleChatModels(models);
  return ranked[0] ?? GEMINI_FALLBACK_MODEL;
}

/**
 * Resolve which model to use.
 * Configured text wins; else cached auto (if still eligible); else list+pick; else alias.
 */
export async function resolveGeminiModel(
  apiKey: string,
  configured?: string,
  cachedAuto?: string,
  signal?: AbortSignal,
): Promise<{ model: string; autoPicked: boolean }> {
  const configuredTrim = configured?.trim();
  if (configuredTrim && configuredTrim.toLowerCase() !== 'auto') {
    return { model: normalizeGeminiModelId(configuredTrim), autoPicked: false };
  }
  if (cachedAuto?.trim()) {
    const id = normalizeGeminiModelId(cachedAuto);
    if (isEligibleChatModel(id)) {
      return { model: id, autoPicked: true };
    }
  }
  try {
    const list = await listGeminiModels(apiKey, signal);
    const model = pickBestFlashModel(list);
    return { model, autoPicked: true };
  } catch {
    return { model: GEMINI_FALLBACK_MODEL, autoPicked: true };
  }
}

/**
 * Parse model text as JSON: strip ```json fences, else first {...} block.
 */
export function extractJsonObject(text: string): unknown {
  let body = text.trim();
  const fenced = body.match(/^```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();

  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error('Gemini returned non-JSON text');
  }
}

type GenOpts = {
  signal?: AbortSignal;
  useJsonMode: boolean;
  maxOutputTokens?: number;
  temperature?: number;
};

async function generateContentOnce(
  apiKey: string,
  model: string,
  prompt: string,
  opts: GenOpts,
): Promise<string> {
  const id = normalizeGeminiModelId(model);
  const url = `${MODELS_URL}/${encodeURIComponent(id)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = opts.maxOutputTokens;
  }
  if (opts.useJsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/**
 * Call generateContent; on JSON-mode 400, retry without MIME type and remember.
 */
export async function generateContent(
  apiKey: string,
  model: string,
  prompt: string,
  opts: {
    signal?: AbortSignal;
    jsonMode?: boolean;
    onJsonModeResolved?: (jsonMode: boolean) => void | Promise<void>;
    maxOutputTokens?: number;
    temperature?: number;
  } = {},
): Promise<string> {
  const tryJson = opts.jsonMode !== false;
  try {
    return await generateContentOnce(apiKey, model, prompt, {
      signal: opts.signal,
      useJsonMode: tryJson,
      maxOutputTokens: opts.maxOutputTokens,
      temperature: opts.temperature,
    });
  } catch (err) {
    if (!tryJson || !isJsonModeUnsupportedError(err)) throw err;
    await opts.onJsonModeResolved?.(false);
    const plainPrompt = `${prompt}\n\nOutput raw JSON only. No markdown fences.`;
    return await generateContentOnce(apiKey, model, plainPrompt, {
      signal: opts.signal,
      useJsonMode: false,
      maxOutputTokens: opts.maxOutputTokens,
      temperature: opts.temperature,
    });
  }
}

/** Same request shape as real translate calls (JSON mode + tiny JSON reply). */
export async function preflightGemini(
  apiKey: string,
  model: string,
  signal?: AbortSignal,
  caps?: {
    jsonMode?: boolean;
    onJsonModeResolved?: (jsonMode: boolean) => void | Promise<void>;
  },
): Promise<void> {
  const prompt = 'Reply with exactly: {"ok":true}';
  const raw = await generateContent(apiKey, model, prompt, {
    signal,
    jsonMode: caps?.jsonMode,
    onJsonModeResolved: caps?.onJsonModeResolved,
    temperature: 0,
    maxOutputTokens: 32,
  });
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini preflight returned unexpected payload');
  }
}

function buildPrompt(
  title: string,
  description: string,
  target: string,
  source: string,
  options: TranslateOptions,
): string {
  const rules = [
    `Translate from ${source} to ${target}.`,
    'Return ONLY valid JSON: {"title":"...","description":"..."}',
    'Keep placeholders like __PT_0__, __URL_0__, __AT_0__, __HT_0__, __TS_0__, __CHLINE_0__ exactly as-is.',
    'Keep URLs, @handles, and timestamps unchanged.',
    options.hashtagMode === 'keep'
      ? 'Do not translate hashtags (they are placeholders).'
      : 'You may translate hashtag words if present as plain text.',
    options.chapterMode === 'translate_labels'
      ? 'Translate chapter labels; leave timestamp placeholders untouched.'
      : 'Chapter lines are placeholders — leave them unchanged.',
    'Prefer a natural full title; length fitting happens afterward (do not truncate mid-phrase).',
    'Preserve line breaks in the description.',
  ];
  return `${rules.join('\n')}\n\nTITLE:\n${title}\n\nDESCRIPTION:\n${description}`;
}

/** Creative shorten for titles over 100 chars, respecting protected phrases. */
export async function geminiShortenTitle(
  apiKey: string,
  model: string,
  fullTitle: string,
  protectedPhrases: string[],
  signal?: AbortSignal,
  hooks: GeminiModelHooks = {},
): Promise<string> {
  const protectList =
    protectedPhrases.filter(Boolean).length > 0
      ? protectedPhrases.filter(Boolean).map((p) => `- ${p}`).join('\n')
      : '(none)';
  const prompt = [
    `Shorten this YouTube title to at most ${YT_TITLE_MAX} characters.`,
    'Return ONLY valid JSON: {"title":"..."}',
    'Keep meaning; prefer dropping or compressing the least important middle phrases.',
    'You MUST keep these protected phrases exactly (character-for-character) if present:',
    protectList,
    'Do not invent new brand names. Preserve separators like | — – when useful.',
    '',
    `TITLE:\n${fullTitle}`,
  ].join('\n');

  const raw = await generateContent(apiKey, normalizeGeminiModelId(model), prompt, {
    signal,
    jsonMode: hooks.jsonMode,
    onJsonModeResolved: hooks.onJsonModeResolved
      ? (enabled) => hooks.onJsonModeResolved!(normalizeGeminiModelId(model), enabled)
      : undefined,
  });
  const parsed = extractJsonObject(raw) as { title?: string };
  if (typeof parsed.title !== 'string' || !parsed.title.trim()) {
    throw new Error('Gemini shorten returned invalid JSON shape');
  }
  return parsed.title.trim();
}

export function createGeminiEngine(
  apiKey: string,
  model: string,
  hooks: GeminiModelHooks = {},
): TranslationEngine {
  let currentModel = normalizeGeminiModelId(model);
  let refreshedOnce = false;
  let jsonMode = hooks.jsonMode;

  return {
    id: 'gemini',
    async translate(texts, target, source, options) {
      const title = texts[0] ?? '';
      const description = texts[1] ?? '';
      const prepared = prepareForTranslation(title, description, options);
      const prompt = buildPrompt(prepared.title, prepared.description, target, source, options);
      const signal = options.signal;

      const rememberJsonMode = async (enabled: boolean) => {
        jsonMode = enabled;
        await hooks.onJsonModeResolved?.(currentModel, enabled);
      };

      const runOnce = async (useModel: string) => {
        const raw = await generateContent(apiKey, useModel, prompt, {
          signal,
          jsonMode,
          onJsonModeResolved: rememberJsonMode,
        });
        const parsed = extractJsonObject(raw) as { title?: string; description?: string };
        if (typeof parsed.title !== 'string' || typeof parsed.description !== 'string') {
          throw new Error('Gemini returned invalid JSON shape');
        }
        return { title: parsed.title, description: parsed.description };
      };

      const result = await withRetry(
        async () => {
          try {
            return await runOnce(currentModel);
          } catch (err) {
            if (!refreshedOnce && isModelNotFoundError(err)) {
              refreshedOnce = true;
              const list = await listGeminiModels(apiKey, signal);
              const picked = pickBestFlashModel(list);
              currentModel = picked;
              jsonMode = undefined;
              await hooks.onModelResolved?.(picked);
              return await runOnce(currentModel);
            }
            throw err;
          }
        },
        { label: 'gemini', signal },
      );

      const [outTitle, outDesc] = restorePrepared(prepared, result.title, result.description);
      // Full title kept; segment-aware / AI fit happens in translateTitleDescription.
      return [outTitle, outDesc];
    },
  };
}
