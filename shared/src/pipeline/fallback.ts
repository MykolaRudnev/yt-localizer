import {
  deeplSupports,
  GEMINI_FALLBACK_MODEL,
  normalizeGeminiModelId,
  rankEligibleChatModels,
} from '../engines/index.js';
import { isExhausted, type ExhaustionMap } from '../quota.js';
import { trimSettingsKeys } from '../settings.js';
import type { AppSettings, EngineConfig, EngineId } from '../types.js';

/** Settings a translate job needs (global + per-channel merged, plus Gemini runtime caches). */
export type JobSettings = Pick<
  AppSettings,
  | 'engine'
  | 'geminiApiKey'
  | 'geminiModel'
  | 'deeplApiKey'
  | 'libreTranslateUrl'
  | 'libreTranslateApiKey'
  | 'titleOver100'
  | 'protectLastSegment'
  | 'hashtagMode'
  | 'chapterMode'
  | 'protectedTerms'
  | 'defaultSourceLanguage'
> & {
  autoFallbackOnQuota?: boolean;
  geminiThrottleMs?: number;
  geminiAutoModel?: string;
  geminiJsonModeByModel?: Record<string, boolean>;
  geminiExhaustedModels?: ExhaustionMap;
};

export type GeminiHooks = Pick<
  EngineConfig,
  'onGeminiModelResolved' | 'onGeminiJsonModeResolved' | 'onGeminiModelExhausted'
>;

export type FallbackSlot =
  | { engine: 'gemini'; model: string }
  | { engine: 'deepl' }
  | { engine: 'libretranslate' };

export function engineDisplayName(id: EngineId): string {
  if (id === 'gemini') return 'Gemini';
  if (id === 'deepl') return 'DeepL';
  return 'LibreTranslate';
}

/** Note when DeepL is skipped for an unsupported target and another engine is used. */
export function deeplUnsupportedFallbackNote(
  language: string,
  usedEngine: EngineId,
): string {
  return `DeepL doesn't support ${language} → ${engineDisplayName(usedEngine)}`;
}

export function buildEngineConfig(
  settings: JobSettings,
  hooks?: GeminiHooks,
): EngineConfig {
  const trimmed = trimSettingsKeys({
    geminiApiKey: settings.geminiApiKey,
    deeplApiKey: settings.deeplApiKey,
    libreTranslateUrl: settings.libreTranslateUrl,
    libreTranslateApiKey: settings.libreTranslateApiKey,
    geminiModel: settings.geminiModel,
  });
  return {
    engine: settings.engine,
    geminiApiKey: trimmed.geminiApiKey,
    geminiModel: trimmed.geminiModel,
    geminiAutoModel: settings.geminiAutoModel?.trim(),
    geminiJsonModeByModel: settings.geminiJsonModeByModel
      ? { ...settings.geminiJsonModeByModel }
      : undefined,
    geminiExhaustedModels: settings.geminiExhaustedModels
      ? { ...settings.geminiExhaustedModels }
      : undefined,
    deeplApiKey: trimmed.deeplApiKey,
    libreTranslateUrl: trimmed.libreTranslateUrl,
    libreTranslateApiKey: trimmed.libreTranslateApiKey,
    onGeminiModelResolved: hooks?.onGeminiModelResolved,
    onGeminiJsonModeResolved: hooks?.onGeminiJsonModeResolved,
    onGeminiModelExhausted: hooks?.onGeminiModelExhausted,
  };
}

/**
 * Build Gemini model list for fallback: configured model first (if set), then ranked eligible.
 */
export function buildGeminiModelFallbackList(
  listed: string[],
  configured?: string,
  exhausted: ExhaustionMap = {},
  nowMs = Date.now(),
): string[] {
  const ranked = rankEligibleChatModels(listed);
  const pool = ranked.length ? ranked : [GEMINI_FALLBACK_MODEL];
  const trim = configured?.trim();
  let ordered = pool;
  if (trim && trim.toLowerCase() !== 'auto') {
    const id = normalizeGeminiModelId(trim);
    ordered = [id, ...pool.filter((m) => m !== id)];
  }
  return ordered.filter((m) => !isExhausted(exhausted, m, nowMs));
}

export function buildFallbackSlots(opts: {
  primary: EngineId;
  geminiModels: string[];
  hasDeepl: boolean;
  hasLibre: boolean;
  autoFallback: boolean;
}): FallbackSlot[] {
  const slots: FallbackSlot[] = [];
  const pushGemini = () => {
    for (const model of opts.geminiModels) slots.push({ engine: 'gemini', model });
  };
  const pushDeepl = () => {
    if (opts.hasDeepl) slots.push({ engine: 'deepl' });
  };
  const pushLibre = () => {
    if (opts.hasLibre) slots.push({ engine: 'libretranslate' });
  };

  if (!opts.autoFallback) {
    if (opts.primary === 'gemini') pushGemini();
    else if (opts.primary === 'deepl') pushDeepl();
    else pushLibre();
    return slots;
  }

  if (opts.primary === 'gemini') {
    pushGemini();
    pushDeepl();
    pushLibre();
  } else if (opts.primary === 'deepl') {
    pushDeepl();
    pushGemini();
    pushLibre();
  } else {
    pushLibre();
    pushGemini();
    pushDeepl();
  }
  return slots;
}

export function configForSlot(base: EngineConfig, slot: FallbackSlot): EngineConfig {
  if (slot.engine === 'gemini') {
    return { ...base, engine: 'gemini', geminiModel: slot.model };
  }
  return { ...base, engine: slot.engine };
}

export function slotUsable(
  slot: FallbackSlot,
  language: string,
  exhausted: ExhaustionMap,
  nowMs: number,
): boolean {
  if (slot.engine === 'gemini') return !isExhausted(exhausted, slot.model, nowMs);
  if (slot.engine === 'deepl') return deeplSupports(language);
  return true;
}

export function anySlotLeft(
  slots: FallbackSlot[],
  exhausted: ExhaustionMap,
  nowMs: number,
): boolean {
  return slots.some((s) => {
    if (s.engine === 'gemini') return !isExhausted(exhausted, s.model, nowMs);
    return true; // deepl/libre may still help for some languages
  });
}
