export type EngineId = 'gemini' | 'deepl' | 'libretranslate';

export type TitleOver100 = 'truncate' | 'ai_shorten';
export type HashtagMode = 'keep' | 'translate';
export type ChapterMode = 'translate_labels' | 'keep';

export interface TranslateOptions {
  protectedTerms: string[];
  hashtagMode: HashtagMode;
  chapterMode: ChapterMode;
  titleOver100: TitleOver100;
}

export interface LocalizationResult {
  language: string;
  title: string;
  description: string;
}

export interface TranslateRequest {
  texts: string[];
  target: string;
  source: string;
  options: TranslateOptions;
}

export interface TranslationEngine {
  id: EngineId;
  translate(texts: string[], target: string, source: string, options: TranslateOptions): Promise<string[]>;
}

export interface EngineConfig {
  engine: EngineId;
  geminiApiKey?: string;
  deeplApiKey?: string;
  libreTranslateUrl?: string;
  libreTranslateApiKey?: string;
}

export interface AppSettings {
  selectedLanguages: string[];
  /** Snapshot of the last Translate click selection (for "Last used" preset). */
  lastUsedLanguages: string[];
  engine: EngineId;
  geminiApiKey: string;
  deeplApiKey: string;
  libreTranslateUrl: string;
  libreTranslateApiKey: string;
  oauthClientId: string;
  titleOver100: TitleOver100;
  hashtagMode: HashtagMode;
  chapterMode: ChapterMode;
  protectedTerms: string[];
  defaultSourceLanguage: string;
  dryRun: boolean;
  /** When true, do not re-translate languages that already have a localization. */
  skipExisting: boolean;
}

/** Keep in sync with languages.json presets.top10 */
const TOP10_DEFAULT = [
  'es',
  'pt',
  'hi',
  'id',
  'ru',
  'ja',
  'ko',
  'de',
  'fr',
  'ar',
];

export const DEFAULT_SETTINGS: AppSettings = {
  selectedLanguages: [...TOP10_DEFAULT],
  lastUsedLanguages: [...TOP10_DEFAULT],
  engine: 'gemini',
  geminiApiKey: '',
  deeplApiKey: '',
  libreTranslateUrl: 'http://localhost:5000',
  libreTranslateApiKey: '',
  oauthClientId: '',
  titleOver100: 'truncate',
  hashtagMode: 'keep',
  chapterMode: 'translate_labels',
  protectedTerms: ['Veil of Veles'],
  defaultSourceLanguage: 'en',
  dryRun: true,
  skipExisting: true,
};

export interface JobLogEntry {
  id: string;
  videoId: string;
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  ok: string[];
  failed: { language: string; error: string }[];
}

export interface VideoSnippet {
  title: string;
  description: string;
  categoryId?: string;
  tags?: string[];
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  channelId?: string;
}

export interface YoutubeVideo {
  id: string;
  snippet: VideoSnippet;
  localizations?: Record<string, { title: string; description: string }>;
}
