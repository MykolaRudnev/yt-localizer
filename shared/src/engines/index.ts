import type { EngineConfig, TranslationEngine, TranslateOptions } from '../types.js';
import { createGeminiEngine } from './gemini.js';
import { createDeeplEngine, deeplSupports } from './deepl.js';
import { createLibreTranslateEngine } from './libre.js';

export { createGeminiEngine, createDeeplEngine, createLibreTranslateEngine, deeplSupports };

export function createEngine(config: EngineConfig): TranslationEngine {
  switch (config.engine) {
    case 'gemini':
      if (!config.geminiApiKey) throw new Error('Gemini API key is required');
      return createGeminiEngine(config.geminiApiKey);
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
  let engine = createEngine(config);
  if (config.engine === 'deepl' && !deeplSupports(target)) {
    if (!geminiFallbackKey) {
      throw new Error(`DeepL unsupported language ${target} and no Gemini fallback key`);
    }
    engine = createGeminiEngine(geminiFallbackKey);
  }
  const [t, d] = await engine.translate([title, description], target, source, options);
  return { title: t, description: d };
}
