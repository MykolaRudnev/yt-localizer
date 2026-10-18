import type {
  EngineConfig,
  LocalizationResult,
  TitleRemovalInfo,
  TranslationEngine,
  TranslateOptions,
} from '../types.js';
import { fitTitle, isDurationPhrase, YT_TITLE_MAX } from '../text.js';
import {
  createGeminiEngine,
  resolveGeminiModel,
  preflightGemini,
  GEMINI_FALLBACK_MODEL,
  listGeminiModels,
  pickBestFlashModel,
  rankEligibleChatModels,
  normalizeGeminiModelId,
  extractJsonObject,
  chatModelRank,
  isEligibleChatModel,
  isJsonModeUnsupportedError,
  generateContent,
  geminiShortenTitle,
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
  rankEligibleChatModels,
  normalizeGeminiModelId,
  extractJsonObject,
  chatModelRank,
  isEligibleChatModel,
  isJsonModeUnsupportedError,
  generateContent,
  geminiShortenTitle,
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
      const key = config.geminiApiKey?.trim();
      if (!key) throw new Error('Gemini API key is required');
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
    case 'deepl': {
      const key = config.deeplApiKey?.trim();
      if (!key) throw new Error('DeepL API key is required');
      return createDeeplEngine(key);
    }
    case 'libretranslate': {
      const url = config.libreTranslateUrl?.trim();
      if (!url) throw new Error('LibreTranslate URL is required');
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
      const key = config.geminiApiKey?.trim();
      if (!key) throw new Error('Gemini API key is required');
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
    case 'deepl': {
      const key = config.deeplApiKey?.trim();
      if (!key) throw new Error('DeepL API key is required');
      const endpoint = key.endsWith(':fx')
        ? 'https://api-free.deepl.com/v2/translate'
        : 'https://api.deepl.com/v2/translate';
      const body = new URLSearchParams();
      body.append('text', '.');
      body.append('target_lang', 'EN');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${key}`,
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
      const url = config.libreTranslateUrl?.trim();
      if (!url) throw new Error('LibreTranslate URL is required');
      const root = url.replace(/\/$/, '');
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

function protectedTitlePhrases(fullTitle: string, options: TranslateOptions): string[] {
  const phrases: string[] = [];
  const protectLast = options.protectLastSegment !== false;
  // Rough segment split for AI prompt
  const segs = fullTitle.split(/\s*[|—–·]\s*|\s+-\s+|\s*:\s*/u).map((s) => s.trim()).filter(Boolean);
  if (segs[0]) phrases.push(segs[0]);
  for (const seg of segs) {
    if (isDurationPhrase(seg)) phrases.push(seg);
  }
  if (protectLast && segs.length > 1) phrases.push(segs[segs.length - 1]);
  for (const term of options.protectedTerms) {
    if (term && fullTitle.toLowerCase().includes(term.toLowerCase())) phrases.push(term);
  }
  return [...new Set(phrases)];
}

function finalizeTitle(
  fullTitle: string,
  options: TranslateOptions,
  preferredFitted?: string,
): {
  title: string;
  fullTitle: string;
  shortened: boolean;
  removed: TitleRemovalInfo[];
  autoTitle: string;
} {
  const fitOpts = {
    protectedTerms: options.protectedTerms,
    protectLastSegment: options.protectLastSegment,
    max: YT_TITLE_MAX,
  };
  let fitted = preferredFitted
    ? fitTitle(preferredFitted, fitOpts)
    : fitTitle(fullTitle, fitOpts);
  // If AI produced a shorter title, still compare against full translation
  if (preferredFitted && preferredFitted !== fullTitle) {
    const safety = fitTitle(preferredFitted, fitOpts);
    const shortened = safety.title !== fullTitle || fullTitle.length > YT_TITLE_MAX;
    return {
      title: safety.title,
      fullTitle,
      shortened: shortened || safety.shortened,
      removed: safety.removed.length
        ? safety.removed
        : shortened
          ? [{ text: '(AI shortened)', kind: 'shortened' as const }]
          : [],
      autoTitle: safety.title,
    };
  }
  return {
    title: fitted.title,
    fullTitle,
    shortened: fitted.shortened,
    removed: fitted.removed,
    autoTitle: fitted.title,
  };
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
