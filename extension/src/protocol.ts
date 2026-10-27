/**
 * Message protocol between content script / popup / options and the background
 * service worker. Message `type` strings are part of the runtime contract —
 * keep them stable.
 */
import type { ReviewAction, TranslateJob } from '@shared/job';
import type { AppSettings, ChannelSettings, LocalizationResult } from '@shared/types';

/** Long-lived port name for job progress streaming. */
export const JOB_PORT = 'vt-job';

export type BackgroundMessage =
  | { type: 'START_TRANSLATE'; videoId: string; languages?: string[]; skipExisting?: boolean }
  | { type: 'STOP_TRANSLATE' }
  | { type: 'CLEAR_JOB' }
  | { type: 'GET_JOB' }
  | { type: 'GET_WIDGET_POS' }
  | { type: 'SET_WIDGET_POS'; x: number; y: number }
  | { type: 'OPEN_STUDIO_FOR_JOB' }
  | { type: 'PUBLISH'; videoId: string; localizations: LocalizationResult[] }
  | { type: 'FETCH_VIDEO_META'; videoId: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: AppSettings }
  | { type: 'PATCH_SETTINGS'; partial: Partial<AppSettings> }
  | { type: 'GET_CHANNEL_SETTINGS'; channelId: string }
  | { type: 'PATCH_CHANNEL_SETTINGS'; channelId: string; partial: Partial<ChannelSettings> }
  | { type: 'GET_AUTH_STATE' }
  | { type: 'LOGIN' }
  | { type: 'ADD_CHANNEL' }
  | { type: 'REMOVE_CHANNEL'; channelId: string }
  | { type: 'SET_ACTIVE_CHANNEL'; channelId: string }
  | { type: 'CONNECT_CHANNEL'; expectedChannelId?: string }
  | { type: 'LOGOUT'; channelId?: string }
  | { type: 'OPEN_OPTIONS' }
  | { type: 'GET_TRANSLATION_CACHE_STATS' }
  | { type: 'CLEAR_TRANSLATION_CACHE' }
  | { type: 'GET_AUTO_PUBLISH_ACK' }
  | { type: 'ACK_AUTO_PUBLISH' }
  | { type: 'SET_AUTO_APPROVE'; enabled: boolean }
  | { type: 'REVIEW_LANG'; language: string; action: ReviewAction; title?: string };

export type BackgroundMessageType = BackgroundMessage['type'];

/** Messages pushed over the `vt-job` port. */
export type JobPortMessage =
  | { type: 'JOB_UPDATE'; job: TranslateJob | null }
  | { type: 'PONG'; job: TranslateJob | null };

export type BaseResponse = { ok: boolean; error?: string };

export type JobResponse = BaseResponse & { job?: TranslateJob | null };

export type StartTranslateResponse = JobResponse & { skippedAll?: boolean };

export type PublishResponse = BaseResponse & { published?: string[] };

export type SettingsResponse = BaseResponse & { settings?: AppSettings };

export type VideoMetaResponse = BaseResponse & {
  needsConnect?: boolean;
  videoId?: string;
  channelId?: string;
  channelTitle?: string;
  title?: string;
  description?: string;
  defaultLanguage?: string;
  existingLocalizations?: Record<string, { title: string; description: string }>;
  existingCodes?: string[];
  channelSettings?: ChannelSettings;
};
