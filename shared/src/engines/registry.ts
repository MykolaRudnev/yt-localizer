import type { EngineConfig, TranslationEngine } from '../types.js';
import { createDeeplEngine, preflightDeepl } from './deepl.js';
import {
  createGeminiEngine,
  normalizeGeminiModelId,
  preflightGemini,
  resolveGeminiModel,
} from './gemini.js';
import { createLibreTranslateEngine, preflightLibreTranslate } from './libre.js';

/** Cache a model's JSON-mode capability on the config and notify the host. */
export function rememberJsonMode(config: EngineConfig, model: string, jsonMode: boolean) {
  const id = normalizeGeminiModelId(model);
  if (!config.geminiJsonModeByModel) config.geminiJsonModeByModel = {};
  config.geminiJsonModeByModel[id] = jsonMode;
  return config.onGeminiJsonModeResolved?.(id, jsonMode);
}

export function knownJsonMode(config: EngineConfig, model: string): boolean | undefined {
  return config.geminiJsonModeByModel?.[normalizeGeminiModelId(model)];
}

function requireKey(value: string | undefined, message: string): string {
  const v = value?.trim();
  if (!v) throw new Error(message);
  return v;
}

export async function createEngine(config: EngineConfig): Promise<TranslationEngine> {
  switch (config.engine) {
    case 'gemini': {
      const key = requireKey(config.geminiApiKey, 'Gemini API key is required');
      const { model, autoPicked } = await resolveGeminiModel(
        key,
        config.geminiModel,
        config.geminiAutoModel,
      );
      if (autoPicked) await config.onGeminiModelResolved?.(model);
      return createGeminiEngine(key, model, {
        onModelResolved: config.onGeminiModelResolved,
        jsonMode: knownJsonMode(config, model),
        onJsonModeResolved: (m, enabled) => rememberJsonMode(config, m, enabled),
      });
    }
    case 'deepl':
      return createDeeplEngine(requireKey(config.deeplApiKey, 'DeepL API key is required'));
    case 'libretranslate': {
      const url = requireKey(config.libreTranslateUrl, 'LibreTranslate URL is required');
      return createLibreTranslateEngine(url, config.libreTranslateApiKey?.trim());
    }
    default:
      throw new Error(`Unknown engine: ${config.engine satisfies never}`);
  }
}

/** Cheap validation before starting a multi-language job. Returns resolved Gemini model when applicable. */
export async function preflightEngine(
  config: EngineConfig,
  signal?: AbortSignal,
): Promise<{ model?: string }> {
  switch (config.engine) {
    case 'gemini': {
      const key = requireKey(config.geminiApiKey, 'Gemini API key is required');
      const { model, autoPicked } = await resolveGeminiModel(
        key,
        config.geminiModel,
        config.geminiAutoModel,
        signal,
      );
      if (autoPicked) await config.onGeminiModelResolved?.(model);
      await preflightGemini(key, model, signal, {
        jsonMode: knownJsonMode(config, model),
        onJsonModeResolved: (enabled) => rememberJsonMode(config, model, enabled),
      });
      return { model };
    }
    case 'deepl':
      await preflightDeepl(requireKey(config.deeplApiKey, 'DeepL API key is required'), signal);
      return {};
    case 'libretranslate':
      await preflightLibreTranslate(
        requireKey(config.libreTranslateUrl, 'LibreTranslate URL is required'),
        signal,
      );
      return {};
    default:
      throw new Error(`Unknown engine: ${config.engine satisfies never}`);
  }
}
