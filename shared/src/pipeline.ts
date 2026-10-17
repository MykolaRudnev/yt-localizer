import { translateTitleDescription } from './engines/index.js';
import type {
  AppSettings,
  EngineConfig,
  LocalizationResult,
  TranslateOptions,
} from './types.js';

export type ProgressCb = (info: {
  language: string;
  index: number;
  total: number;
  status: 'ok' | 'error' | 'running';
  error?: string;
}) => void;

export async function translateAllLanguages(
  title: string,
  description: string,
  languages: string[],
  settings: Pick<
    AppSettings,
    | 'engine'
    | 'geminiApiKey'
    | 'deeplApiKey'
    | 'libreTranslateUrl'
    | 'libreTranslateApiKey'
    | 'titleOver100'
    | 'hashtagMode'
    | 'chapterMode'
    | 'protectedTerms'
    | 'defaultSourceLanguage'
  >,
  onProgress?: ProgressCb,
): Promise<{ ok: LocalizationResult[]; failed: { language: string; error: string }[] }> {
  const options: TranslateOptions = {
    protectedTerms: settings.protectedTerms,
    hashtagMode: settings.hashtagMode,
    chapterMode: settings.chapterMode,
    titleOver100: settings.titleOver100,
  };
  const config: EngineConfig = {
    engine: settings.engine,
    geminiApiKey: settings.geminiApiKey,
    deeplApiKey: settings.deeplApiKey,
    libreTranslateUrl: settings.libreTranslateUrl,
    libreTranslateApiKey: settings.libreTranslateApiKey,
  };

  const ok: LocalizationResult[] = [];
  const failed: { language: string; error: string }[] = [];
  const source = settings.defaultSourceLanguage || 'en';
  const total = languages.length;

  for (let i = 0; i < languages.length; i++) {
    const language = languages[i];
    onProgress?.({ language, index: i, total, status: 'running' });
    try {
      const result = await translateTitleDescription(
        title,
        description,
        language,
        source,
        config,
        options,
        settings.geminiApiKey,
      );
      ok.push({ language, title: result.title, description: result.description });
      onProgress?.({ language, index: i, total, status: 'ok' });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ language, error });
      onProgress?.({ language, index: i, total, status: 'error', error });
    }
  }

  return { ok, failed };
}
