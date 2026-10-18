import { DEFAULT_SETTINGS, type AppSettings } from './types.js';

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
