import type { EngineConfig, TranslationEngine, TranslateOptions } from '../types.js';
import {
  createGeminiEngine,
  resolveGeminiModel,
  preflightGemini,
  GEMINI_FALLBACK_MODEL,
  listGeminiModels,
  pickBestFlashModel,
  normalizeGeminiModelId,
  extractJsonObject,
  chatModelRank,
  isEligibleChatModel,
  isJsonModeUnsupportedError,
  generateContent,
} from './gemini.js';
import { createDeeplEngine, deeplSupports } from './deepl.js';
import { createLibreTranslateEngine } from './libre.js';

export {
  createGeminiEngine,
  createDeeplEngine,
  createLibreTranslateEngine,
  deeplSupports,
  resolveGeminiModel,
  preflightGemini,
  listGeminiModels,
  pickBestFlashModel,
  normalizeGeminiModelId,
  extractJsonObject,
  chatModelRank,
  isEligibleChatModel,
  isJsonModeUnsupportedError,
  generateContent,
  GEMINI_FALLBACK_MODEL,
};

function rememberJsonMode(config: EngineConfig, model: string, jsonMode: boolean) {
  const id = normalizeGeminiModelId(model);
  if (!config.geminiJsonModeByModel) config.geminiJsonModeByModel = {};
  config.geminiJsonModeByModel[id] = jsonMode;
  return config.onGeminiJsonModeResolved?.(id, jsonMode);
}

function knownJsonMode(config: EngineConfig, model: string): boolean | undefined {
  return config.geminiJsonModeByModel?.[normalizeGeminiModelId(model)];
}

export async function createEngine(config: EngineConfig): Promise<TranslationEngine> {
  switch (config.engine) {
    case 'gemini': {
      if (!config.geminiApiKey) throw new Error('Gemini API key is required');
      const { model, autoPicked } = await resolveGeminiModel(
        config.geminiApiKey,
        config.geminiModel,
        config.geminiAutoModel,
      );
      if (autoPicked) await config.onGeminiModelResolved?.(model);
      return createGeminiEngine(config.geminiApiKey, model, {
        onModelResolved: config.onGeminiModelResolved,
        jsonMode: knownJsonMode(config, model),
        onJsonModeResolved: (m, enabled) => rememberJsonMode(config, m, enabled),
      });
    }
    case 'deepl':
      if (!config.deeplApiKey) throw new Error('DeepL API key is required');
      return createDeeplEngine(config.deeplApiKey);
    case 'libretranslate':
      if (!config.libreTranslateUrl) throw new Error('LibreTranslate URL is required');
      return createLibreTranslateEngine(config.libreTranslateUrl, config.libreTranslateApiKey);
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
      if (!config.geminiApiKey) throw new Error('Gemini API key is required');
      const { model, autoPicked } = await resolveGeminiModel(
        config.geminiApiKey,
        config.geminiModel,
        config.geminiAutoModel,
        signal,
      );
      if (autoPicked) await config.onGeminiModelResolved?.(model);
      await preflightGemini(config.geminiApiKey, model, signal, {
        jsonMode: knownJsonMode(config, model),
        onJsonModeResolved: (enabled) => rememberJsonMode(config, model, enabled),
      });
      return { model };
    }
    case 'deepl': {
      if (!config.deeplApiKey) throw new Error('DeepL API key is required');
      const endpoint = config.deeplApiKey.endsWith(':fx')
        ? 'https://api-free.deepl.com/v2/translate'
        : 'https://api.deepl.com/v2/translate';
      const body = new URLSearchParams();
      body.append('text', '.');
      body.append('target_lang', 'EN');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${config.deeplApiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`DeepL ${res.status}: ${err.slice(0, 200)}`);
      }
      return {};
    }
    case 'libretranslate': {
      if (!config.libreTranslateUrl) throw new Error('LibreTranslate URL is required');
      const root = config.libreTranslateUrl.replace(/\/$/, '');
      const res = await fetch(`${root}/languages`, { signal });
      if (!res.ok) {
        throw new Error(`LibreTranslate ${res.status}: preflight failed`);
      }
      return {};
    }
    default:
      throw new Error(`Unknown engine: ${config.engine satisfies never}`);
  }
}

/** Translate title+description; fall back to Gemini if DeepL lacks the language. */
export async function translateTitleDescription(
  title: string,
  description: string,
  target: string,
  source: string,
  config: EngineConfig,
  options: TranslateOptions,
  geminiFallbackKey?: string,
): Promise<{ title: string; description: string }> {
  let engine = await createEngine(config);
  if (config.engine === 'deepl' && !deeplSupports(target)) {
    if (!geminiFallbackKey) {
      throw new Error(`DeepL unsupported language ${target} and no Gemini fallback key`);
    }
    const { model, autoPicked } = await resolveGeminiModel(
      geminiFallbackKey,
      config.geminiModel,
      config.geminiAutoModel,
      options.signal,
    );
    if (autoPicked) await config.onGeminiModelResolved?.(model);
    const useModel = model || GEMINI_FALLBACK_MODEL;
    engine = createGeminiEngine(geminiFallbackKey, useModel, {
      onModelResolved: config.onGeminiModelResolved,
      jsonMode: knownJsonMode(config, useModel),
      onJsonModeResolved: (m, enabled) => rememberJsonMode(config, m, enabled),
    });
  }
  const [t, d] = await engine.translate([title, description], target, source, options);
  return { title: t, description: d };
}
