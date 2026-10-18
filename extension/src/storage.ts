import type { TranslateJob } from '@shared/job';
import type {
  AppSettings,
  ChannelSettings,
  ConnectedChannel,
  JobLogEntry,
} from '@shared/types';
import { seedChannelSettings } from '@shared/channels';
import {
  emptyTranslationCache,
  markCachedPublished,
  putCachedTranslation,
  translationCacheStats,
  type CachedTranslation,
  type TranslationCacheStore,
} from '@shared/cache';
import { normalizeAppSettings, trimSettingsKeys } from '@shared/settings';

const SETTINGS_KEY = 'settings';
const JOBS_KEY = 'jobLogs';
const CHANNELS_KEY = 'channels';
const ACTIVE_CHANNEL_KEY = 'activeChannelId';
const CHANNEL_SETTINGS_KEY = 'channelSettings';
const GEMINI_AUTO_MODEL_KEY = 'geminiAutoModel';
const GEMINI_MODEL_CAPS_KEY = 'geminiModelCaps';
const GEMINI_EXHAUSTED_KEY = 'geminiExhaustedModels';
const ACTIVE_JOB_KEY = 'activeJob';
const WIDGET_POS_KEY = 'vtWidgetPos';
const TRANSLATION_CACHE_KEY = 'translationCache';
const AUTO_PUBLISH_ACK_KEY = 'autoPublishAcked';

/** Prefer session (cleared on browser restart); fall back to local. */
async function jobStore(): Promise<typeof chrome.storage.session | typeof chrome.storage.local> {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.get(ACTIVE_JOB_KEY);
      return chrome.storage.session;
    }
  } catch {
    // session unavailable (older Chrome / tests)
  }
  return chrome.storage.local;
}

type GeminiModelCaps = Record<string, { jsonMode?: boolean }>;

/** Legacy single-account keys — cleared on multi-channel write. */
const LEGACY_TOKEN_KEY = 'accessToken';
const LEGACY_TOKEN_EXP_KEY = 'accessTokenExpiresAt';
const LEGACY_ACCOUNT_KEY = 'accountEmail';

export async function getSettings(): Promise<AppSettings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  // Always read fresh from storage and trim keys — no in-memory cache.
  return normalizeAppSettings(
    (data[SETTINGS_KEY] as Partial<AppSettings> | undefined) ?? {},
  );
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: trimSettingsKeys(settings) });
}

export async function patchSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = trimSettingsKeys({ ...current, ...partial });
  await saveSettings(next);
  return next;
}

export async function getChannels(): Promise<Record<string, ConnectedChannel>> {
  const data = await chrome.storage.local.get(CHANNELS_KEY);
  return (data[CHANNELS_KEY] as Record<string, ConnectedChannel> | undefined) ?? {};
}

export async function getChannel(channelId: string): Promise<ConnectedChannel | null> {
  const channels = await getChannels();
  return channels[channelId] ?? null;
}

export async function upsertChannel(channel: ConnectedChannel): Promise<void> {
  const channels = await getChannels();
  channels[channel.id] = channel;
  await chrome.storage.local.set({ [CHANNELS_KEY]: channels });
  await chrome.storage.local.remove([
    LEGACY_TOKEN_KEY,
    LEGACY_TOKEN_EXP_KEY,
    LEGACY_ACCOUNT_KEY,
  ]);
  const active = await getActiveChannelId();
  if (!active) await setActiveChannelId(channel.id);
}

export async function removeChannel(channelId: string): Promise<void> {
  const channels = await getChannels();
  delete channels[channelId];
  const settingsMap = await getAllChannelSettings();
  delete settingsMap[channelId];
  const active = await getActiveChannelId();
  const nextActive =
    active === channelId
      ? (Object.keys(channels)[0] ?? null)
      : active && channels[active]
        ? active
        : (Object.keys(channels)[0] ?? null);
  await chrome.storage.local.set({
    [CHANNELS_KEY]: channels,
    [CHANNEL_SETTINGS_KEY]: settingsMap,
    [ACTIVE_CHANNEL_KEY]: nextActive,
  });
}

export async function getActiveChannelId(): Promise<string | null> {
  const data = await chrome.storage.local.get(ACTIVE_CHANNEL_KEY);
  return (data[ACTIVE_CHANNEL_KEY] as string | null | undefined) ?? null;
}

export async function setActiveChannelId(channelId: string | null): Promise<void> {
  await chrome.storage.local.set({ [ACTIVE_CHANNEL_KEY]: channelId });
}

export async function getAllChannelSettings(): Promise<Record<string, ChannelSettings>> {
  const data = await chrome.storage.local.get(CHANNEL_SETTINGS_KEY);
  return (data[CHANNEL_SETTINGS_KEY] as Record<string, ChannelSettings> | undefined) ?? {};
}

export async function getChannelSettings(channelId: string): Promise<ChannelSettings> {
  const map = await getAllChannelSettings();
  if (map[channelId]) return map[channelId];
  const channel = await getChannel(channelId);
  const global = await getSettings();
  return seedChannelSettings(channel?.title ?? '', {
    selectedLanguages: global.selectedLanguages,
    lastUsedLanguages: global.lastUsedLanguages,
    protectedTerms: global.protectedTerms,
    defaultSourceLanguage: global.defaultSourceLanguage,
  });
}

export async function saveChannelSettings(
  channelId: string,
  settings: ChannelSettings,
): Promise<void> {
  const map = await getAllChannelSettings();
  map[channelId] = settings;
  await chrome.storage.local.set({ [CHANNEL_SETTINGS_KEY]: map });
}

export async function patchChannelSettings(
  channelId: string,
  partial: Partial<ChannelSettings>,
): Promise<ChannelSettings> {
  const current = await getChannelSettings(channelId);
  const next = { ...current, ...partial };
  await saveChannelSettings(channelId, next);
  return next;
}

export async function ensureChannelSettingsSeeded(
  channelId: string,
  channelTitle: string,
): Promise<ChannelSettings> {
  const map = await getAllChannelSettings();
  if (map[channelId]) return map[channelId];
  const global = await getSettings();
  const seeded = seedChannelSettings(channelTitle, {
    selectedLanguages: global.selectedLanguages,
    lastUsedLanguages: global.lastUsedLanguages,
    protectedTerms: global.protectedTerms,
    defaultSourceLanguage: global.defaultSourceLanguage,
  });
  await saveChannelSettings(channelId, seeded);
  return seeded;
}

export async function appendJobLog(entry: JobLogEntry): Promise<void> {
  const data = await chrome.storage.local.get(JOBS_KEY);
  const jobs = (data[JOBS_KEY] as JobLogEntry[] | undefined) ?? [];
  jobs.unshift(entry);
  await chrome.storage.local.set({ [JOBS_KEY]: jobs.slice(0, 50) });
}

export async function getGeminiAutoModel(): Promise<string | undefined> {
  const data = await chrome.storage.local.get(GEMINI_AUTO_MODEL_KEY);
  const v = data[GEMINI_AUTO_MODEL_KEY] as string | undefined;
  return v?.trim() || undefined;
}

export async function setGeminiAutoModel(model: string): Promise<void> {
  await chrome.storage.local.set({ [GEMINI_AUTO_MODEL_KEY]: model });
}

async function getGeminiModelCaps(): Promise<GeminiModelCaps> {
  const data = await chrome.storage.local.get(GEMINI_MODEL_CAPS_KEY);
  return (data[GEMINI_MODEL_CAPS_KEY] as GeminiModelCaps | undefined) ?? {};
}

/** Map of model id → jsonMode (false = skip responseMimeType). */
export async function getGeminiJsonModeByModel(): Promise<Record<string, boolean>> {
  const caps = await getGeminiModelCaps();
  const out: Record<string, boolean> = {};
  for (const [id, c] of Object.entries(caps)) {
    if (typeof c?.jsonMode === 'boolean') out[id] = c.jsonMode;
  }
  return out;
}

export async function setGeminiModelJsonMode(model: string, jsonMode: boolean): Promise<void> {
  const caps = await getGeminiModelCaps();
  caps[model] = { ...caps[model], jsonMode };
  await chrome.storage.local.set({ [GEMINI_MODEL_CAPS_KEY]: caps });
}

/** modelId → epoch ms when quota recovers (Pacific midnight). */
export async function getGeminiExhaustedModels(): Promise<Record<string, number>> {
  const data = await chrome.storage.local.get(GEMINI_EXHAUSTED_KEY);
  const raw = (data[GEMINI_EXHAUSTED_KEY] as Record<string, number> | undefined) ?? {};
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [id, until] of Object.entries(raw)) {
    if (typeof until === 'number' && until > now) out[id] = until;
  }
  return out;
}

export async function setGeminiModelExhausted(model: string, untilMs: number): Promise<void> {
  const current = await getGeminiExhaustedModels();
  current[model] = untilMs;
  await chrome.storage.local.set({ [GEMINI_EXHAUSTED_KEY]: current });
}

export async function getActiveJob(): Promise<TranslateJob | null> {
  const store = await jobStore();
  const data = await store.get(ACTIVE_JOB_KEY);
  const job = data[ACTIVE_JOB_KEY] as TranslateJob | undefined;
  if (job) return job;
  // Migrate if saved under the other area
  if (store !== chrome.storage.local) {
    const local = await chrome.storage.local.get(ACTIVE_JOB_KEY);
    return (local[ACTIVE_JOB_KEY] as TranslateJob | undefined) ?? null;
  }
  return null;
}

export async function setActiveJob(job: TranslateJob | null): Promise<void> {
  const store = await jobStore();
  if (job) await store.set({ [ACTIVE_JOB_KEY]: job });
  else await store.remove(ACTIVE_JOB_KEY);
  // Mirror to local so tab reload after SW restart still sees finished jobs
  if (store !== chrome.storage.local) {
    if (job) await chrome.storage.local.set({ [ACTIVE_JOB_KEY]: job });
    else await chrome.storage.local.remove(ACTIVE_JOB_KEY);
  }
}

export type WidgetPos = { x: number; y: number };

export async function getWidgetPos(): Promise<WidgetPos | null> {
  const data = await chrome.storage.local.get(WIDGET_POS_KEY);
  return (data[WIDGET_POS_KEY] as WidgetPos | undefined) ?? null;
}

export async function setWidgetPos(pos: WidgetPos): Promise<void> {
  await chrome.storage.local.set({ [WIDGET_POS_KEY]: pos });
}

export async function getTranslationCache(): Promise<TranslationCacheStore> {
  const data = await chrome.storage.local.get(TRANSLATION_CACHE_KEY);
  const raw = data[TRANSLATION_CACHE_KEY] as TranslationCacheStore | undefined;
  if (!raw?.videos || typeof raw.videos !== 'object') return emptyTranslationCache();
  return raw;
}

export async function saveTranslationCache(store: TranslationCacheStore): Promise<void> {
  await chrome.storage.local.set({ [TRANSLATION_CACHE_KEY]: store });
}

export async function cacheTranslation(
  videoId: string,
  entry: Omit<CachedTranslation, 'touchedAt'> & { touchedAt?: number },
): Promise<void> {
  const store = await getTranslationCache();
  await saveTranslationCache(putCachedTranslation(store, videoId, entry));
}

export async function markTranslationsPublished(
  videoId: string,
  languages: string[],
): Promise<void> {
  const store = await getTranslationCache();
  await saveTranslationCache(markCachedPublished(store, videoId, languages));
}

export async function clearTranslationCache(): Promise<void> {
  await chrome.storage.local.remove(TRANSLATION_CACHE_KEY);
}

export async function getTranslationCacheStats(): Promise<{ videos: number; entries: number }> {
  return translationCacheStats(await getTranslationCache());
}

export async function getAutoPublishAcked(): Promise<boolean> {
  const data = await chrome.storage.local.get(AUTO_PUBLISH_ACK_KEY);
  return data[AUTO_PUBLISH_ACK_KEY] === true;
}

export async function setAutoPublishAcked(acked: boolean): Promise<void> {
  await chrome.storage.local.set({ [AUTO_PUBLISH_ACK_KEY]: acked });
}
