import type { EngineConfig, LocalizationResult, TranslateOptions } from '../types.js';
import { YT_TITLE_MAX } from '../limits.js';
import { finalizeTitle, protectedTitlePhrases } from '../title/finalize.js';
import { deeplSupports } from './deepl.js';
import {
  createGeminiEngine,
  GEMINI_FALLBACK_MODEL,
  geminiShortenTitle,
  resolveGeminiModel,
} from './gemini.js';
import { createEngine, knownJsonMode, rememberJsonMode } from './registry.js';

/** Translate title+description; fall back to Gemini if DeepL lacks the language. */
export async function translateTitleDescription(
  title: string,
  description: string,
  target: string,
  source: string,
  config: EngineConfig,
  options: TranslateOptions,
  geminiFallbackKey?: string,
): Promise<Omit<LocalizationResult, 'language'>> {
  let engine = await createEngine(config);
  let usedGemini = config.engine === 'gemini';
  let geminiModel = config.geminiAutoModel || config.geminiModel || GEMINI_FALLBACK_MODEL;

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
    geminiModel = useModel;
    usedGemini = true;
    engine = createGeminiEngine(geminiFallbackKey, useModel, {
      onModelResolved: config.onGeminiModelResolved,
      jsonMode: knownJsonMode(config, useModel),
      onJsonModeResolved: (m, enabled) => rememberJsonMode(config, m, enabled),
    });
  }
  const [fullTitle, d] = await engine.translate([title, description], target, source, options);

  let preferredFitted: string | undefined;
  if (
    options.titleOver100 === 'ai_shorten' &&
    fullTitle.length > YT_TITLE_MAX &&
    usedGemini &&
    (config.geminiApiKey?.trim() || geminiFallbackKey)
  ) {
    try {
      const key = (config.geminiApiKey?.trim() || geminiFallbackKey)!;
      const { model } = await resolveGeminiModel(
        key,
        geminiModel,
        config.geminiAutoModel,
        options.signal,
      );
      preferredFitted = await geminiShortenTitle(
        key,
        model || geminiModel,
        fullTitle,
        protectedTitlePhrases(fullTitle, options),
        options.signal,
        {
          jsonMode: knownJsonMode(config, model || geminiModel),
          onJsonModeResolved: (m, enabled) => rememberJsonMode(config, m, enabled),
        },
      );
    } catch {
      preferredFitted = undefined;
    }
  }

  const fitted = finalizeTitle(fullTitle, options, preferredFitted);
  return {
    title: fitted.title,
    description: d,
    fullTitle: fitted.fullTitle,
    shortened: fitted.shortened,
    removed: fitted.removed,
    autoTitle: fitted.autoTitle,
    reviewed: !fitted.shortened,
  };
}
