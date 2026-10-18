import type { TranslateOptions, TranslationEngine } from '../types.js';
import { withRetry } from '../retry.js';
import { isModelNotFoundError } from '../errors.js';
import {
  applyTitleLimit,
  prepareForTranslation,
  restoreAfterTranslation,
} from '../text.js';

/** Stable alias used when listing models fails. */
export const GEMINI_FALLBACK_MODEL = 'gemini-flash-latest';

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiModelHooks = {
  /** Called when auto-pick (or 404 refresh) chooses a model — cache it. */
  onModelResolved?: (model: string) => void | Promise<void>;
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

function flashScore(id: string): number {
  const lower = id.toLowerCase();
  if (!lower.includes('flash')) return -1;
  const lite = lower.includes('lite');
  const preview = lower.includes('preview') || lower.includes('exp');
  if (!lite && !preview) return 3;
  if (!lite && preview) return 2;
  if (lite && !preview) return 1;
  return 0;
}

/**
 * Newest available *-flash model; non-lite, non-preview preferred.
 * Falls back to GEMINI_FALLBACK_MODEL if nothing matches.
 */
export function pickBestFlashModel(models: string[]): string {
  const flash = models
    .map(normalizeGeminiModelId)
    .filter((id) => flashScore(id) >= 0);
  if (!flash.length) return GEMINI_FALLBACK_MODEL;
  flash.sort((a, b) => {
    const sd = flashScore(b) - flashScore(a);
    if (sd) return sd;
    return cmpVersionDesc(a, b);
  });
  return flash[0];
}

/**
 * Resolve which model to use.
 * Configured text wins; else cached auto; else list+pick; else alias.
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
    return { model: normalizeGeminiModelId(cachedAuto), autoPicked: true };
  }
  try {
    const list = await listGeminiModels(apiKey, signal);
    const model = pickBestFlashModel(list);
    return { model, autoPicked: true };
  } catch {
    return { model: GEMINI_FALLBACK_MODEL, autoPicked: true };
  }
}

async function generateContent(
  apiKey: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const id = normalizeGeminiModelId(model);
  const url = `${MODELS_URL}/${encodeURIComponent(id)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
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

/** Cheap key+model check before starting a job. */
export async function preflightGemini(
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<void> {
  const id = normalizeGeminiModelId(model);
  const url = `${MODELS_URL}/${encodeURIComponent(id)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Reply with exactly: {"ok":true}' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 16 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
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
    options.titleOver100 === 'ai_shorten'
      ? 'Title must be at most 100 characters; shorten creatively if needed.'
      : 'Prefer a natural title; length will be truncated later if needed.',
    'Preserve line breaks in the description.',
  ];
  return `${rules.join('\n')}\n\nTITLE:\n${title}\n\nDESCRIPTION:\n${description}`;
}

export function createGeminiEngine(
  apiKey: string,
  model: string,
  hooks: GeminiModelHooks = {},
): TranslationEngine {
  let currentModel = normalizeGeminiModelId(model);
  let refreshedOnce = false;

  return {
    id: 'gemini',
    async translate(texts, target, source, options) {
      const title = texts[0] ?? '';
      const description = texts[1] ?? '';
      const prepared = prepareForTranslation(title, description, options);
      const prompt = buildPrompt(prepared.title, prepared.description, target, source, options);
      const signal = options.signal;

      const runOnce = async (useModel: string) => {
        const raw = await generateContent(apiKey, useModel, prompt, signal);
        const parsed = JSON.parse(raw) as { title?: string; description?: string };
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
              await hooks.onModelResolved?.(picked);
              return await runOnce(currentModel);
            }
            throw err;
          }
        },
        { label: 'gemini', signal },
      );

      let outTitle = restoreAfterTranslation(result.title, prepared.maps);
      let outDesc = restoreAfterTranslation(result.description, prepared.maps);
      outTitle = applyTitleLimit(outTitle, options.titleOver100);
      return [outTitle, outDesc];
    },
  };
}
