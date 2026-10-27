import { TOP10_CODES } from './langs.js';
import type { AppSettings, ChannelSettings } from './types.js';

export const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = {
  selectedLanguages: [...TOP10_CODES],
  lastUsedLanguages: [...TOP10_CODES],
  protectedTerms: [],
  defaultSourceLanguage: 'en',
  autoPublish: false,
};

export const DEFAULT_SETTINGS: AppSettings = {
  selectedLanguages: [...TOP10_CODES],
  lastUsedLanguages: [...TOP10_CODES],
  engine: 'gemini',
  geminiApiKey: '',
  geminiModel: '',
  deeplApiKey: '',
  libreTranslateUrl: 'http://localhost:5000',
  libreTranslateApiKey: '',
  oauthClientId: '',
  titleOver100: 'truncate',
  protectLastSegment: true,
  autoApproveReview: false,
  hashtagMode: 'keep',
  chapterMode: 'translate_labels',
  protectedTerms: [],
  defaultSourceLanguage: 'en',
  dryRun: true,
  skipExisting: true,
  autoFallbackOnQuota: true,
  geminiThrottleMs: 4000,
};

/** Trim whitespace/newlines from secrets and URLs (save + use). */
export function trimSettingsKeys<T extends Partial<AppSettings>>(settings: T): T {
  const out = { ...settings };
  if (typeof out.geminiApiKey === 'string') out.geminiApiKey = out.geminiApiKey.trim();
  if (typeof out.deeplApiKey === 'string') out.deeplApiKey = out.deeplApiKey.trim();
  if (typeof out.libreTranslateApiKey === 'string') {
    out.libreTranslateApiKey = out.libreTranslateApiKey.trim();
  }
  if (typeof out.libreTranslateUrl === 'string') {
    out.libreTranslateUrl = out.libreTranslateUrl.trim();
  }
  if (typeof out.oauthClientId === 'string') out.oauthClientId = out.oauthClientId.trim();
  if (typeof out.geminiModel === 'string') out.geminiModel = out.geminiModel.trim();
  return out;
}

/** Merge with defaults and trim keys — used by Options save and storage reads. */
export function normalizeAppSettings(partial: Partial<AppSettings>): AppSettings {
  return trimSettingsKeys({ ...DEFAULT_SETTINGS, ...partial });
}
