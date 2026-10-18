import {
  cachedToResult,
  hashFromTranslateOptions,
  lookupCachedTranslation,
  shouldAutoPublishFlush,
} from '@shared/cache';
import {
  channelAutoPublish,
  mergeSettingsForChannel,
  orderChannelsForProbe,
  selectChannelForVideo,
  tokenMatchesVideoChannel,
} from '@shared/channels';
import { preflightEngine } from '@shared/engines/index';
import {
  badgeForJob,
  jobFailed,
  jobResults,
  jobUnpublished,
  markJobPublished,
  reduceJob,
  type TranslateJob,
} from '@shared/job';
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
  cacheTranslation,
  clearTranslationCache,
  getActiveChannelId,
  getActiveJob,
  getAutoPublishAcked,
  getChannelSettings,
  getChannels,
  getGeminiAutoModel,
  getGeminiExhaustedModels,
  getGeminiJsonModeByModel,
  getSettings,
  getTranslationCache,
  getTranslationCacheStats,
  getWidgetPos,
  markTranslationsPublished,
  patchChannelSettings,
  patchSettings,
  saveSettings,
  setActiveChannelId,
  setActiveJob,
  setAutoPublishAcked,
  setGeminiAutoModel,
  setGeminiModelExhausted,
  setGeminiModelJsonMode,
  setWidgetPos,
} from './storage';

type Msg =
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
  | { type: 'SAVE_SETTINGS'; settings: typeof DEFAULT_SETTINGS }
  | { type: 'PATCH_SETTINGS'; partial: Partial<typeof DEFAULT_SETTINGS> }
  | { type: 'TEST_ENGINE' }
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
  | { type: 'ACK_AUTO_PUBLISH' };

const KEEP_ALIVE_ALARM = 'vt-keepalive';
const JOB_PORT = 'vt-job';

let activeJobAbort: AbortController | null = null;
let memoryJob: TranslateJob | null = null;
const jobPorts = new Set<chrome.runtime.Port>();
/** In-flight translate promise — prevents overlapping START while running. */
let runningPromise: Promise<void> | null = null;

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get('settings');
  if (!data.settings) {
    await saveSettings({ ...DEFAULT_SETTINGS });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    void getActiveJob(); // touch storage / keep SW warm
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== JOB_PORT) return;
  jobPorts.add(port);
  void (async () => {
    const job = memoryJob ?? (await getActiveJob());
    if (job) port.postMessage({ type: 'JOB_UPDATE', job });
  })();
  port.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type === 'PING') {
      void getActiveJob().then((job) => {
        try {
          port.postMessage({ type: 'PONG', job: memoryJob ?? job });
        } catch {
          /* disconnected */
        }
      });
    }
  });
  port.onDisconnect.addListener(() => {
    jobPorts.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message: Msg, sender, sendResponse) => {
  // Always settle sendResponse so MV3 never leaves the channel hanging.
  handleMessage(message, sender.tab?.id)
    .then((result) => {
      try {
        sendResponse(result);
      } catch {
        /* channel already closed */
      }
    })
    .catch((err: unknown) => {
      try {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {
        /* channel already closed */
      }
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
    case 'SAVE_SETTINGS': {
      await saveSettings(message.settings);
      return { ok: true, settings: await getSettings() };
    }
    case 'PATCH_SETTINGS': {
      const settings = await patchSettings(message.partial);
      return { ok: true, settings };
    }
    case 'TEST_ENGINE': {
      const settings = await getSettings();
      try {
        const result = await preflightEngine({
          engine: settings.engine,
          geminiApiKey: settings.geminiApiKey,
          geminiModel: settings.geminiModel,
          geminiAutoModel: await getGeminiAutoModel(),
          geminiJsonModeByModel: await getGeminiJsonModeByModel(),
          deeplApiKey: settings.deeplApiKey,
          libreTranslateUrl: settings.libreTranslateUrl,
          libreTranslateApiKey: settings.libreTranslateApiKey,
        });
        return {
          ok: true,
          engine: settings.engine,
          model: result.model,
          message: result.model
            ? `OK — ${settings.engine} (model ${result.model})`
            : `OK — ${settings.engine}`,
        };
      } catch (err) {
        return {
          ok: false,
          engine: settings.engine,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'GET_CHANNEL_SETTINGS':
      return {
        ok: true,
        settings: await getChannelSettings(message.channelId),
      };
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
    case 'GET_JOB': {
      const job = memoryJob ?? (await getActiveJob());
      memoryJob = job;
      return { ok: true, job };
    }
    case 'CLEAR_JOB': {
      if (memoryJob?.phase === 'running') {
        activeJobAbort?.abort();
      }
      await persistJob(null);
      return { ok: true };
    }
    case 'GET_WIDGET_POS':
      return { ok: true, pos: await getWidgetPos() };
    case 'SET_WIDGET_POS':
      await setWidgetPos({ x: message.x, y: message.y });
      return { ok: true };
    case 'OPEN_STUDIO_FOR_JOB': {
      const job = memoryJob ?? (await getActiveJob());
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
    case 'START_TRANSLATE':
      return startTranslate(message.videoId, tabId, message.languages, message.skipExisting);
    case 'STOP_TRANSLATE':
      activeJobAbort?.abort();
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
    default:
      return { ok: false, error: 'Unknown message' };
  }
}

async function persistJob(job: TranslateJob | null) {
  memoryJob = job;
  await setActiveJob(job);
  await updateBadge(job);
  broadcastJob(job);
  if (job?.phase === 'running') await ensureKeepAlive(true);
  else await ensureKeepAlive(false);
}

function broadcastJob(job: TranslateJob | null) {
  for (const port of jobPorts) {
    try {
      port.postMessage({ type: 'JOB_UPDATE', job });
    } catch {
      jobPorts.delete(port);
    }
  }
}

async function updateBadge(job: TranslateJob | null) {
  const { text, color } = badgeForJob(job);
  try {
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    /* action may be unavailable in tests */
  }
}

async function ensureKeepAlive(on: boolean) {
  try {
    if (on) {
      await chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
    } else {
      await chrome.alarms.clear(KEEP_ALIVE_ALARM);
    }
  } catch {
    /* alarms permission / unavailable */
  }
}

type ResolvedVideo = {
  video: Awaited<ReturnType<typeof listVideo>>;
  channelId: string;
  token: string;
};

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
    } catch {
      // try next channel
    }
  }

  if (discovered) {
    const match = selectChannelForVideo(channels, discovered.channelId);
    if (match) {
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

/**
 * Starts (or rejects) a job and returns immediately with the job snapshot.
 * Work continues in the SW; progress streams via the vt-job port.
 */
async function startTranslate(
  videoId: string,
  _tabId: number | undefined,
  languagesOverride?: string[],
  skipExistingOverride?: boolean,
) {
  if (runningPromise && memoryJob?.phase === 'running') {
    return {
      ok: false,
      error: 'A translation job is already running. Stop it or wait, or use New translation.',
      job: memoryJob,
    };
  }

  activeJobAbort?.abort();
  const abort = new AbortController();
  activeJobAbort = abort;

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
    return { ok: true, skippedAll: true, job: null };
  }

  const title = video.snippet.title;
  const description = video.snippet.description;
  const autoPublish = channelAutoPublish(channelPrefs) && !settings.dryRun;
  const sourceHash = hashFromTranslateOptions(
    title,
    description,
    {
      protectedTerms: settings.protectedTerms,
      hashtagMode: settings.hashtagMode,
      chapterMode: settings.chapterMode,
      titleOver100: settings.titleOver100,
    },
    settings.defaultSourceLanguage || 'en',
  );

  let job = reduceJob(null, {
    type: 'create',
    id: crypto.randomUUID(),
    videoId,
    channelId,
    languages: langs,
    dryRun: settings.dryRun,
    skipExisting,
    autoPublish,
    sourceTitle: title,
    sourceDescription: description,
    defaultLanguage: video.snippet.defaultLanguage,
    engine: settings.engine,
  });
  await persistJob(job);

  const geminiAutoModel = await getGeminiAutoModel();
  const geminiJsonModeByModel = await getGeminiJsonModeByModel();
  const geminiExhaustedModels = await getGeminiExhaustedModels();

  let lastAutoFlushAt = Date.now();

  const flushAutoPublish = async (force: boolean) => {
    const cur = memoryJob;
    if (!cur || cur.id !== job!.id || !cur.autoPublish || cur.dryRun) return;
    const pending = jobUnpublished(cur);
    if (
      !shouldAutoPublishFlush({
        unpublishedCount: pending.length,
        lastFlushAt: lastAutoFlushAt,
        now: Date.now(),
        force,
      })
    ) {
      return;
    }
    try {
      await publishLocalizations(videoId, pending, { clearJob: false });
      lastAutoFlushAt = Date.now();
      const after = memoryJob;
      if (after && after.id === job!.id) {
        await persistJob(markJobPublished(after, pending.map((p) => p.language)));
      }
      await markTranslationsPublished(
        videoId,
        pending.map((p) => p.language),
      );
    } catch (err) {
      const after = memoryJob;
      if (!after || after.id !== job!.id) return;
      const next = reduceJob(after, {
        type: 'progress',
        fatalSummary: `Auto-publish failed: ${err instanceof Error ? err.message : String(err)}`,
        fatalHint: 'Translations are saved — use Publish in the preview to retry.',
      });
      if (next) await persistJob(next);
    }
  };

  runningPromise = (async () => {
    try {
      const { ok, failed, stopReason, fatalSummary, fatalHint } = await translateAllLanguages(
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
          if (abort.signal.aborted && info.status === 'running') return;
          const cur = memoryJob;
          if (!cur || cur.id !== job!.id) return;
          const next = reduceJob(cur, {
            type: 'progress',
            language: info.language || undefined,
            status: info.status,
            engine: info.engine,
            model: info.model,
            note: info.note,
            error: info.error,
            errorDetail: info.errorDetail,
            fatalSummary: info.fatalSummary,
            fatalHint: info.fatalHint,
            stopReason: info.stopReason,
            title: info.title,
            description: info.description,
            cached: info.cached,
          });
          if (next) await persistJob(next);
        },
        {
          abort,
          onGeminiModelResolved: (model) => setGeminiAutoModel(model),
          onGeminiJsonModeResolved: (model, jsonMode) =>
            setGeminiModelJsonMode(model, jsonMode),
          onGeminiModelExhausted: (model, untilMs) =>
            setGeminiModelExhausted(model, untilMs),
          lookupCache: async (language) => {
            const store = await getTranslationCache();
            const hit = lookupCachedTranslation(store, videoId, language, sourceHash);
            return hit ? cachedToResult(hit) : null;
          },
          onLanguageOk: async (result, meta) => {
            const prevStore = await getTranslationCache();
            const prevHit = lookupCachedTranslation(
              prevStore,
              videoId,
              result.language,
              sourceHash,
            );
            await cacheTranslation(videoId, {
              language: result.language,
              sourceHash,
              title: result.title,
              description: result.description,
              published: prevHit?.published,
            });
            // Ensure job has text even if progress raced
            const cur = memoryJob;
            if (cur && cur.id === job!.id) {
              let next = reduceJob(cur, {
                type: 'progress',
                language: result.language,
                status: 'ok',
                title: result.title,
                description: result.description,
                cached: meta.cached,
                note: meta.cached ? 'cached' : undefined,
                published: prevHit?.published === true,
              });
              if (next && prevHit?.published) {
                next = markJobPublished(next, [result.language]);
              }
              if (next) await persistJob(next);
            }
            await flushAutoPublish(false);
          },
        },
      );

      const cur = memoryJob;
      if (!cur || cur.id !== job!.id) return;

      // Final auto-publish flush before finishing (survives stop/fatal/circuit).
      await flushAutoPublish(true);

      let phase: 'done' | 'failed' | 'stopped' = 'done';
      if (stopReason === 'aborted') phase = 'stopped';
      else if (stopReason === 'fatal' || stopReason === 'circuit') {
        phase = ok.length || jobResults(memoryJob ?? cur).length ? 'done' : 'failed';
      } else if (!ok.length && failed.length && !jobResults(memoryJob ?? cur).length) {
        phase = 'failed';
      }

      const latest = memoryJob ?? cur;
      const finished = reduceJob(latest, {
        type: 'finish',
        phase,
        results: ok.length ? ok : jobResults(latest),
        failed,
        stopReason,
        fatalSummary,
        fatalHint,
      });
      await persistJob(finished);

      const entry: JobLogEntry = {
        id: crypto.randomUUID(),
        videoId,
        startedAt: new Date(cur.startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        dryRun: settings.dryRun,
        ok: (ok.length ? ok : jobResults(finished!)).map((r) => r.language),
        failed,
      };
      await appendJobLog(entry);
    } catch (err) {
      const cur = memoryJob;
      if (!cur || cur.id !== job!.id) return;
      try {
        await flushAutoPublish(true);
      } catch {
        /* already surfaced */
      }
      const partial = jobResults(memoryJob ?? cur);
      const finished = reduceJob(memoryJob ?? cur, {
        type: 'finish',
        phase: partial.length ? 'done' : 'failed',
        results: partial,
        failed: jobFailed(memoryJob ?? cur),
        fatalSummary: err instanceof Error ? err.message : String(err),
        stopReason: 'fatal',
      });
      await persistJob(finished);
    } finally {
      if (activeJobAbort === abort) activeJobAbort = null;
      runningPromise = null;
    }
  })();

  // Don't await runningPromise — return immediately so the message channel stays happy.
  return { ok: true, job, skippedAll: false };
}

async function publish(videoId: string, localizations: LocalizationResult[]) {
  const settings = await getSettings();
  if (settings.dryRun) {
    throw new Error(
      'Dry-run is ON — Publish is disabled. Turn off dry-run to publish.',
    );
  }
  return publishLocalizations(videoId, localizations, { clearJob: true });
}

/**
 * Merge-publish localizations: always re-fetch current video before write so we
 * never delete other languages or clobber snippet fields.
 */
async function publishLocalizations(
  videoId: string,
  localizations: LocalizationResult[],
  opts: { clearJob: boolean },
) {
  if (!localizations.length) {
    return { ok: true, published: [] as string[] };
  }

  const settings = await getSettings();
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
  // Re-fetch immediately before write to merge with latest remote localizations.
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
    const published = localizations.map((l) => l.language);
    const entry: JobLogEntry = {
      id: crypto.randomUUID(),
      videoId,
      startedAt,
      finishedAt: new Date().toISOString(),
      dryRun: false,
      ok: published,
      failed: [],
    };
    await appendJobLog(entry);
    await markTranslationsPublished(videoId, published);
    const job = memoryJob ?? (await getActiveJob());
    if (job?.videoId === videoId) {
      if (opts.clearJob) await persistJob(null);
      else await persistJob(markJobPublished(job, published));
    }
    return { ok: true, published };
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

// Restore job + badge on SW wake
void (async () => {
  memoryJob = await getActiveJob();
  await updateBadge(memoryJob);
  if (memoryJob?.phase === 'running') {
    // SW restarted mid-job — mark stopped (can't resume in-flight fetch)
    memoryJob = reduceJob(memoryJob, {
      type: 'finish',
      phase: 'stopped',
      fatalSummary: 'Extension worker restarted. Progress below was saved; use Retry for remaining.',
      stopReason: 'aborted',
      results: jobResults(memoryJob),
      failed: jobFailed(memoryJob),
    });
    await persistJob(memoryJob);
  }
})();
