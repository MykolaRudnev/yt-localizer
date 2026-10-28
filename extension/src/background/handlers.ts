import { markCachedReviewed } from '@shared/cache';
import { reduceJob } from '@shared/job';
import { addChannel, getAuthState, logout } from '../oauth';
import type { BackgroundMessage } from '../protocol';
import {
  clearTranslationCache,
  getAutoPublishAcked,
  getChannelSettings,
  getChannels,
  getSettings,
  getTranslationCacheStats,
  getVideoTranslationCache,
  getWidgetPos,
  patchChannelSettings,
  patchSettings,
  saveSettings,
  setActiveChannelId,
  setAutoPublishAcked,
  saveVideoTranslationCache,
  setWidgetPos,
} from '../storage';
import { loadJob, persistJob, updateJob } from './job-store';
import { publish } from './publish';
import { abortIfRunning, startTranslate, stopTranslate } from './translate-job';
import { fetchVideoMeta } from './video-access';

export async function handleMessage(message: BackgroundMessage): Promise<unknown> {
  switch (message.type) {
    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'GET_SETTINGS':
      return { ok: true, settings: await getSettings() };
    case 'SAVE_SETTINGS':
      await saveSettings(message.settings);
      return { ok: true, settings: await getSettings() };
    case 'PATCH_SETTINGS':
      return { ok: true, settings: await patchSettings(message.partial) };
    case 'SET_AUTO_APPROVE':
      return setAutoApprove(message.enabled);
    case 'GET_CHANNEL_SETTINGS':
      return { ok: true, settings: await getChannelSettings(message.channelId) };
    case 'PATCH_CHANNEL_SETTINGS': {
      const settings = await patchChannelSettings(message.channelId, message.partial);
      if (message.partial.selectedLanguages || message.partial.lastUsedLanguages) {
        await patchSettings({
          selectedLanguages: settings.selectedLanguages,
          lastUsedLanguages: settings.lastUsedLanguages,
        });
      }
      return { ok: true, settings };
    }
    case 'GET_AUTH_STATE':
      return { ok: true, ...(await getAuthState()) };
    case 'LOGIN':
    case 'ADD_CHANNEL': {
      const channel = await addChannel();
      return { ok: true, ...(await getAuthState()), channel };
    }
    case 'CONNECT_CHANNEL': {
      const channel = await addChannel();
      if (message.expectedChannelId && channel.id !== message.expectedChannelId) {
        return {
          ok: false,
          error: `Connected ${channel.title}, but this video belongs to a different channel. Pick the matching Google/Brand account.`,
          channel,
          ...(await getAuthState()),
        };
      }
      return { ok: true, ...(await getAuthState()), channel };
    }
    case 'REMOVE_CHANNEL':
    case 'LOGOUT':
      await logout(message.channelId);
      return { ok: true, ...(await getAuthState()) };
    case 'SET_ACTIVE_CHANNEL': {
      const channels = await getChannels();
      if (!channels[message.channelId]) {
        throw new Error('Unknown channel');
      }
      await setActiveChannelId(message.channelId);
      return { ok: true, ...(await getAuthState()) };
    }
    case 'FETCH_VIDEO_META':
      return fetchVideoMeta(message.videoId);
    case 'GET_JOB':
      return { ok: true, job: await loadJob() };
    case 'CLEAR_JOB':
      abortIfRunning();
      await persistJob(null);
      return { ok: true };
    case 'GET_WIDGET_POS':
      return { ok: true, pos: await getWidgetPos() };
    case 'SET_WIDGET_POS':
      await setWidgetPos({ x: message.x, y: message.y });
      return { ok: true };
    case 'OPEN_STUDIO_FOR_JOB':
      return openStudioForJob();
    case 'START_TRANSLATE':
      return startTranslate(message.videoId, message.languages, message.skipExisting);
    case 'STOP_TRANSLATE':
      stopTranslate();
      return { ok: true };
    case 'PUBLISH':
      return publish(message.videoId, message.localizations);
    case 'GET_TRANSLATION_CACHE_STATS':
      return { ok: true, ...(await getTranslationCacheStats()) };
    case 'CLEAR_TRANSLATION_CACHE':
      await clearTranslationCache();
      return { ok: true, videos: 0, entries: 0 };
    case 'GET_AUTO_PUBLISH_ACK':
      return { ok: true, acked: await getAutoPublishAcked() };
    case 'ACK_AUTO_PUBLISH':
      await setAutoPublishAcked(true);
      return { ok: true };
    case 'REVIEW_LANG':
      return reviewLanguage(message);
    default:
      return { ok: false, error: 'Unknown message' };
  }
}

/** Persist the option and apply it to the active job (approve pending / revoke unpublished). */
async function setAutoApprove(enabled: boolean) {
  const settings = await patchSettings({ autoApproveReview: enabled });
  const job = await loadJob();
  const next = job ? await updateJob(job.id, { type: 'set_auto_approve', enabled }) : null;
  return { ok: true, settings, job: next ?? job };
}

async function reviewLanguage(message: Extract<BackgroundMessage, { type: 'REVIEW_LANG' }>) {
  const cur = await loadJob();
  if (!cur) return { ok: false, error: 'No active job' };
  const next = reduceJob(cur, {
    type: 'review',
    language: message.language,
    action: message.action,
    title: message.title,
  });
  if (!next) return { ok: false, error: 'Review failed' };
  await persistJob(next);
  const st = next.langStates[message.language];
  // Only a user decision clears the cached review gate (auto-approve is per job).
  if (st?.status === 'ok' && st.title != null && !st.autoApproved) {
    const store = await getVideoTranslationCache(next.videoId);
    await saveVideoTranslationCache(
      next.videoId,
      markCachedReviewed(store, next.videoId, message.language, st.title),
    );
  }
  return { ok: true, job: next };
}

async function openStudioForJob() {
  const job = await loadJob();
  if (!job) return { ok: false, error: 'No active job' };
  const url = `https://studio.youtube.com/video/${job.videoId}/edit`;
  const tabs = await chrome.tabs.query({ url: 'https://studio.youtube.com/*' });
  const match = tabs.find((t) => t.url?.includes(job.videoId));
  if (match?.id != null) {
    await chrome.tabs.update(match.id, { active: true, url });
    if (match.windowId != null) await chrome.windows.update(match.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  return { ok: true };
}
