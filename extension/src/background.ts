import {
  mergeSettingsForChannel,
  orderChannelsForProbe,
  selectChannelForVideo,
  tokenMatchesVideoChannel,
} from '@shared/channels';
import { filterLanguagesForTranslate } from '@shared/langs';
import { translateAllLanguages } from '@shared/pipeline';
import {
  DEFAULT_SETTINGS,
  type ChannelSettings,
  type JobLogEntry,
  type LocalizationResult,
} from '@shared/types';
import {
  ensureDefaultLanguage,
  listVideo,
  updateLocalizations,
} from '@shared/youtube';
import { addChannel, getAuthState, getValidAccessToken, logout } from './oauth';
import {
  appendJobLog,
  getActiveChannelId,
  getChannelSettings,
  getChannels,
  getGeminiAutoModel,
  getGeminiExhaustedModels,
  getGeminiJsonModeByModel,
  getSettings,
  patchChannelSettings,
  patchSettings,
  saveSettings,
  setActiveChannelId,
  setGeminiAutoModel,
  setGeminiModelExhausted,
  setGeminiModelJsonMode,
} from './storage';

type Msg =
  | { type: 'START_TRANSLATE'; videoId: string; languages?: string[]; skipExisting?: boolean }
  | { type: 'STOP_TRANSLATE' }
  | { type: 'PUBLISH'; videoId: string; localizations: LocalizationResult[] }
  | { type: 'FETCH_VIDEO_META'; videoId: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'PATCH_SETTINGS'; partial: Partial<typeof DEFAULT_SETTINGS> }
  | { type: 'GET_CHANNEL_SETTINGS'; channelId: string }
  | { type: 'PATCH_CHANNEL_SETTINGS'; channelId: string; partial: Partial<ChannelSettings> }
  | { type: 'GET_AUTH_STATE' }
  | { type: 'LOGIN' }
  | { type: 'ADD_CHANNEL' }
  | { type: 'REMOVE_CHANNEL'; channelId: string }
  | { type: 'SET_ACTIVE_CHANNEL'; channelId: string }
  | { type: 'CONNECT_CHANNEL'; expectedChannelId?: string }
  | { type: 'LOGOUT'; channelId?: string }
  | { type: 'OPEN_OPTIONS' };

/** Active job abort — STOP_TRANSLATE cancels in-flight requests. */
let activeJobAbort: AbortController | null = null;

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get('settings');
  if (!data.settings) {
    await saveSettings({ ...DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message: Msg, sender, sendResponse) => {
  handleMessage(message, sender.tab?.id)
    .then(sendResponse)
    .catch((err: unknown) => {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  return true;
});

async function handleMessage(message: Msg, tabId?: number): Promise<unknown> {
  switch (message.type) {
    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'GET_SETTINGS':
      return { ok: true, settings: await getSettings() };
    case 'PATCH_SETTINGS': {
      const settings = await patchSettings(message.partial);
      return { ok: true, settings };
    }
    case 'GET_CHANNEL_SETTINGS':
      return {
        ok: true,
        settings: await getChannelSettings(message.channelId),
      };
    case 'PATCH_CHANNEL_SETTINGS': {
      const settings = await patchChannelSettings(message.channelId, message.partial);
      // Mirror language selection into global defaults for popup status count.
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
    case 'LOGOUT':
      await logout(message.channelId);
      return { ok: true, ...(await getAuthState()) };
    case 'FETCH_VIDEO_META':
      return fetchVideoMeta(message.videoId);
    case 'START_TRANSLATE':
      return startTranslate(message.videoId, tabId, message.languages, message.skipExisting);
    case 'STOP_TRANSLATE':
      activeJobAbort?.abort();
      return { ok: true };
    case 'PUBLISH':
      return publish(message.videoId, message.localizations);
    default:
      return { ok: false, error: 'Unknown message' };
  }
}

async function notifyTab(tabId: number | undefined, payload: unknown) {
  if (tabId == null) return;
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    // tab may have navigated
  }
}

type ResolvedVideo = {
  video: Awaited<ReturnType<typeof listVideo>>;
  channelId: string;
  token: string;
};

/**
 * Probe connected tokens until we find one that owns the video.
 * Never returns a token whose channelId ≠ video.snippet.channelId.
 */
async function resolveVideoAccess(videoId: string): Promise<
  | { ok: true; resolved: ResolvedVideo }
  | {
      ok: false;
      needsConnect: true;
      channelId?: string;
      channelTitle?: string;
      error: string;
    }
> {
  const channels = await getChannels();
  const ordered = orderChannelsForProbe(channels, await getActiveChannelId());

  if (!ordered.length) {
    return {
      ok: false,
      needsConnect: true,
      error: 'No YouTube channels connected. Add one in the VeilTranslate popup.',
    };
  }

  let discovered: { channelId: string; channelTitle: string } | null = null;

  for (const ch of ordered) {
    try {
      const token = await getValidAccessToken(ch.id);
      const video = await listVideo(videoId, token);
      const videoChannelId = video.snippet.channelId;
      if (!videoChannelId) {
        throw new Error('Video has no channelId in snippet');
      }
      discovered = {
        channelId: videoChannelId,
        channelTitle: video.snippet.channelTitle ?? videoChannelId,
      };

      if (tokenMatchesVideoChannel(ch, videoChannelId)) {
        return {
          ok: true,
          resolved: { video, channelId: videoChannelId, token },
        };
      }
      // Wrong account could still list a public video — keep probing / report connect.
    } catch {
      // try next channel
    }
  }

  if (discovered) {
    const match = selectChannelForVideo(channels, discovered.channelId);
    if (match) {
      // Token was stale during probe; try once more with matching channel only.
      const token = await getValidAccessToken(match.id);
      const video = await listVideo(videoId, token);
      if (tokenMatchesVideoChannel(match, video.snippet.channelId)) {
        return {
          ok: true,
          resolved: { video, channelId: match.id, token },
        };
      }
    }
    return {
      ok: false,
      needsConnect: true,
      channelId: discovered.channelId,
      channelTitle: discovered.channelTitle,
      error: `This video belongs to ${discovered.channelTitle}, connect it`,
    };
  }

  return {
    ok: false,
    needsConnect: true,
    error:
      'Could not access this video with any connected channel. Connect the channel that owns it.',
  };
}

async function fetchVideoMeta(videoId: string) {
  const access = await resolveVideoAccess(videoId);
  if (!access.ok) {
    return {
      ok: false,
      needsConnect: true,
      channelId: access.channelId,
      channelTitle: access.channelTitle,
      error: access.error,
    };
  }
  const { video, channelId } = access.resolved;
  const channelSettings = await getChannelSettings(channelId);
  return {
    ok: true,
    videoId: video.id,
    title: video.snippet.title,
    description: video.snippet.description,
    defaultLanguage: video.snippet.defaultLanguage,
    channelId,
    channelTitle: video.snippet.channelTitle ?? channelId,
    existingLocalizations: video.localizations ?? {},
    existingCodes: Object.keys(video.localizations ?? {}),
    channelSettings,
  };
}

async function startTranslate(
  videoId: string,
  tabId: number | undefined,
  languagesOverride?: string[],
  skipExistingOverride?: boolean,
) {
  activeJobAbort?.abort();
  const abort = new AbortController();
  activeJobAbort = abort;

  try {
    const access = await resolveVideoAccess(videoId);
    if (!access.ok) {
      throw new Error(access.error);
    }
    const { video: listed, channelId, token } = access.resolved;
    let video = listed;

    const global = await getSettings();
    const channelPrefs = await getChannelSettings(channelId);
    const settings = mergeSettingsForChannel(global, channelPrefs);

    const selected =
      languagesOverride?.length ? languagesOverride : settings.selectedLanguages;

    if (!selected.length) {
      throw new Error('Select at least one language.');
    }
    if (settings.engine === 'gemini' && !settings.geminiApiKey) {
      throw new Error('Gemini API key missing. Open Options to add it.');
    }
    if (settings.engine === 'deepl' && !settings.deeplApiKey) {
      throw new Error('DeepL API key missing. Open Options to add it.');
    }

    await patchChannelSettings(channelId, {
      selectedLanguages: selected,
      lastUsedLanguages: selected,
    });

    if (!video.snippet.defaultLanguage) {
      if (settings.dryRun) {
        video = {
          ...video,
          snippet: {
            ...video.snippet,
            defaultLanguage: settings.defaultSourceLanguage || 'en',
          },
        };
        await notifyTab(tabId, {
          type: 'VT_STATUS',
          message: `Dry-run: would set defaultLanguage=${video.snippet.defaultLanguage}`,
        });
      } else {
        video = await ensureDefaultLanguage(
          video,
          token,
          settings.defaultSourceLanguage || 'en',
        );
      }
    }

    if (video.snippet.channelId !== channelId) {
      throw new Error('Refusing to translate: token channel does not match video channel.');
    }

    const skipExisting = skipExistingOverride ?? settings.skipExisting;
    const langs = filterLanguagesForTranslate(selected, video.localizations, {
      skipExisting,
      defaultLanguage: video.snippet.defaultLanguage,
    });

    if (!langs.length) {
      return {
        ok: true,
        dryRun: settings.dryRun,
        channelId,
        source: {
          title: video.snippet.title,
          description: video.snippet.description,
          defaultLanguage: video.snippet.defaultLanguage,
        },
        existingLocalizations: video.localizations ?? {},
        results: [] as LocalizationResult[],
        failed: [] as { language: string; error: string }[],
        skippedAll: true,
      };
    }

    const title = video.snippet.title;
    const description = video.snippet.description;
    const geminiAutoModel = await getGeminiAutoModel();
    const geminiJsonModeByModel = await getGeminiJsonModeByModel();
    const geminiExhaustedModels = await getGeminiExhaustedModels();

    await notifyTab(tabId, {
      type: 'VT_PROGRESS',
      language: '',
      index: 0,
      total: langs.length,
      status: 'running',
      languages: langs,
    });

    const { ok, failed, stopReason, fatalSummary, fatalHint, pending } =
      await translateAllLanguages(
        title,
        description,
        langs,
        {
          ...settings,
          geminiAutoModel,
          geminiJsonModeByModel,
          geminiExhaustedModels,
        },
        async (info) => {
          await notifyTab(tabId, { type: 'VT_PROGRESS', ...info, languages: langs });
        },
        {
          abort,
          onGeminiModelResolved: (model) => setGeminiAutoModel(model),
          onGeminiJsonModeResolved: (model, jsonMode) =>
            setGeminiModelJsonMode(model, jsonMode),
          onGeminiModelExhausted: (model, untilMs) =>
            setGeminiModelExhausted(model, untilMs),
        },
      );

    const entry: JobLogEntry = {
      id: crypto.randomUUID(),
      videoId,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      dryRun: settings.dryRun,
      ok: ok.map((r) => r.language),
      failed,
    };
    await appendJobLog(entry);

    return {
      ok: true,
      dryRun: settings.dryRun,
      channelId,
      source: { title, description, defaultLanguage: video.snippet.defaultLanguage },
      existingLocalizations: video.localizations ?? {},
      results: ok,
      failed,
      pending,
      stopReason,
      fatalSummary,
      fatalHint,
    };
  } finally {
    if (activeJobAbort === abort) activeJobAbort = null;
  }
}

async function publish(videoId: string, localizations: LocalizationResult[]) {
  const settings = await getSettings();
  if (settings.dryRun) {
    throw new Error(
      'Dry-run is ON — Publish is disabled. Turn off dry-run to publish.',
    );
  }

  const access = await resolveVideoAccess(videoId);
  if (!access.ok) throw new Error(access.error);

  const { channelId, token } = access.resolved;
  const channelPrefs = await getChannelSettings(channelId);
  const merged = mergeSettingsForChannel(settings, channelPrefs);

  let video = access.resolved.video;
  if (video.snippet.channelId !== channelId) {
    throw new Error('Refusing to publish: token channel does not match video channel.');
  }

  if (!video.snippet.defaultLanguage) {
    video = await ensureDefaultLanguage(
      video,
      token,
      merged.defaultSourceLanguage || 'en',
    );
  }
  const fresh = await listVideo(videoId, token);
  if (fresh.snippet.channelId !== channelId) {
    throw new Error('Refusing to publish: video channel no longer matches connected token.');
  }

  const map: Record<string, { title: string; description: string }> = {};
  for (const loc of localizations) {
    map[loc.language] = { title: loc.title, description: loc.description };
  }

  const startedAt = new Date().toISOString();
  try {
    await updateLocalizations(fresh, token, map);
    const entry: JobLogEntry = {
      id: crypto.randomUUID(),
      videoId,
      startedAt,
      finishedAt: new Date().toISOString(),
      dryRun: false,
      ok: localizations.map((l) => l.language),
      failed: [],
    };
    await appendJobLog(entry);
    return { ok: true, published: localizations.map((l) => l.language) };
  } catch (err) {
    const entry: JobLogEntry = {
      id: crypto.randomUUID(),
      videoId,
      startedAt,
      finishedAt: new Date().toISOString(),
      dryRun: false,
      ok: [],
      failed: localizations.map((l) => ({
        language: l.language,
        error: err instanceof Error ? err.message : String(err),
      })),
    };
    await appendJobLog(entry);
    throw err;
  }
}
