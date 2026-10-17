import { translateAllLanguages } from '@shared/pipeline';
import {
  ensureDefaultLanguage,
  listVideo,
  updateLocalizations,
} from '@shared/youtube';
import type { JobLogEntry, LocalizationResult } from '@shared/types';
import { getValidAccessToken } from './oauth';
import { appendJobLog, getSettings } from './storage';

type Msg =
  | { type: 'START_TRANSLATE'; videoId: string }
  | { type: 'PUBLISH'; videoId: string; localizations: LocalizationResult[] }
  | { type: 'GET_SETTINGS' }
  | { type: 'OPEN_OPTIONS' }
  | { type: 'PROGRESS_PING' };

chrome.runtime.onInstalled.addListener(() => {
  console.log('VeilTranslate installed');
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
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
    case 'START_TRANSLATE':
      return startTranslate(message.videoId, tabId);
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

async function startTranslate(videoId: string, tabId?: number) {
  const settings = await getSettings();
  if (!settings.selectedLanguages.length) {
    throw new Error('Select at least one language in Options.');
  }
  if (settings.engine === 'gemini' && !settings.geminiApiKey) {
    throw new Error('Gemini API key missing. Open Options to add it.');
  }
  if (settings.engine === 'deepl' && !settings.deeplApiKey) {
    throw new Error('DeepL API key missing. Open Options to add it.');
  }

  const token = await getValidAccessToken();
  let video = await listVideo(videoId, token);

  if (!video.snippet.defaultLanguage) {
    // Setting defaultLanguage is a write — skip in dry-run and use configured default locally
    if (settings.dryRun) {
      video = {
        ...video,
        snippet: { ...video.snippet, defaultLanguage: settings.defaultSourceLanguage || 'en' },
      };
      await notifyTab(tabId, {
        type: 'VT_STATUS',
        message: `Dry-run: would set defaultLanguage=${video.snippet.defaultLanguage}`,
      });
    } else {
      video = await ensureDefaultLanguage(video, token, settings.defaultSourceLanguage || 'en');
    }
  }

  const title = video.snippet.title;
  const description = video.snippet.description;
  const langs = settings.selectedLanguages.filter((l) => l !== video.snippet.defaultLanguage);

  await notifyTab(tabId, {
    type: 'VT_PROGRESS',
    language: '',
    index: 0,
    total: langs.length,
    status: 'running',
  });

  const { ok, failed } = await translateAllLanguages(
    title,
    description,
    langs,
    settings,
    async (info) => {
      await notifyTab(tabId, { type: 'VT_PROGRESS', ...info });
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
    source: { title, description, defaultLanguage: video.snippet.defaultLanguage },
    existingLocalizations: video.localizations ?? {},
    results: ok,
    failed,
  };
}

async function publish(videoId: string, localizations: LocalizationResult[]) {
  const settings = await getSettings();
  if (settings.dryRun) {
    throw new Error('Dry-run is ON — Publish is disabled. Turn off dry-run in Options to publish.');
  }

  const token = await getValidAccessToken();
  const video = await listVideo(videoId, token);
  if (!video.snippet.defaultLanguage) {
    await ensureDefaultLanguage(video, token, settings.defaultSourceLanguage || 'en');
  }
  const fresh = await listVideo(videoId, token);

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
