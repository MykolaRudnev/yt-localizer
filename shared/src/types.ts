export type EngineId = 'gemini' | 'deepl' | 'libretranslate';

export type TitleOver100 = 'truncate' | 'ai_shorten';
export type HashtagMode = 'keep' | 'translate';
export type ChapterMode = 'translate_labels' | 'keep';

export interface TranslateOptions {
  protectedTerms: string[];
  hashtagMode: HashtagMode;
  chapterMode: ChapterMode;
  titleOver100: TitleOver100;
  /** Abort in-flight engine requests when the job is stopped. */
  signal?: AbortSignal;
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
  /** Explicit model id, or empty/"auto" for runtime auto-pick. */
  geminiModel?: string;
  /** Cached auto-picked model from a previous list+pick. */
  geminiAutoModel?: string;
  /**
   * Per-model JSON-mode capability (false = skip responseMimeType).
   * Missing key = unknown (try JSON mode first).
   */
  geminiJsonModeByModel?: Record<string, boolean>;
  /** modelId → epoch ms when daily quota recovers (Pacific midnight). */
  geminiExhaustedModels?: Record<string, number>;
  deeplApiKey?: string;
  libreTranslateUrl?: string;
  libreTranslateApiKey?: string;
  onGeminiModelResolved?: (model: string) => void | Promise<void>;
  onGeminiJsonModeResolved?: (model: string, jsonMode: boolean) => void | Promise<void>;
  onGeminiModelExhausted?: (model: string, untilMs: number) => void | Promise<void>;
}

/** Per-channel prefs (languages / terms / source lang). Engine keys stay global. */
export interface ChannelSettings {
  selectedLanguages: string[];
  /** Snapshot of the last Translate click selection (for "Last used" preset). */
  lastUsedLanguages: string[];
  protectedTerms: string[];
  defaultSourceLanguage: string;
}

/** Connected YouTube channel + OAuth tokens (stored in chrome.storage.local). */
export interface ConnectedChannel {
  id: string;
  title: string;
  thumbnailUrl: string;
  email: string | null;
  accessToken: string;
  /** Epoch ms when accessToken expires. */
  expiresAt: number;
  /** Present only if the OAuth response included refresh_token. */
  refreshToken?: string;
}

export interface AppSettings {
  engine: EngineId;
  geminiApiKey: string;
  /**
   * Gemini model id (e.g. gemini-2.5-flash). Empty or "auto" = auto-pick newest flash.
   */
  geminiModel: string;
  deeplApiKey: string;
  libreTranslateUrl: string;
  libreTranslateApiKey: string;
  oauthClientId: string;
  titleOver100: TitleOver100;
  hashtagMode: HashtagMode;
  chapterMode: ChapterMode;
  dryRun: boolean;
  /** When true, do not re-translate languages that already have a localization. */
  skipExisting: boolean;
  /**
   * On Gemini quota exhaustion, try next model then DeepL → LibreTranslate.
   * Default ON.
   */
  autoFallbackOnQuota: boolean;
  /** Min interval between Gemini API calls (ms). Default 4000. */
  geminiThrottleMs: number;
  /**
   * Defaults used when seeding a newly connected channel's settings.
   * Prefer per-channel settings for active translate jobs.
   */
  selectedLanguages: string[];
  lastUsedLanguages: string[];
  protectedTerms: string[];
  defaultSourceLanguage: string;
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

export const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = {
  selectedLanguages: [...TOP10_DEFAULT],
  lastUsedLanguages: [...TOP10_DEFAULT],
  protectedTerms: ['Veil of Veles'],
  defaultSourceLanguage: 'en',
};

export const DEFAULT_SETTINGS: AppSettings = {
  selectedLanguages: [...TOP10_DEFAULT],
  lastUsedLanguages: [...TOP10_DEFAULT],
  engine: 'gemini',
  geminiApiKey: '',
  geminiModel: '',
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
  autoFallbackOnQuota: true,
  geminiThrottleMs: 4000,
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
  channelTitle?: string;
}

export interface YoutubeVideo {
  id: string;
  snippet: VideoSnippet;
  localizations?: Record<string, { title: string; description: string }>;
}
