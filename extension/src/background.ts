import { filterLanguagesForTranslate } from '@shared/langs';
import { translateAllLanguages } from '@shared/pipeline';
import { DEFAULT_SETTINGS, type JobLogEntry, type LocalizationResult } from '@shared/types';
import {
  ensureDefaultLanguage,
  listVideo,
  updateLocalizations,
} from '@shared/youtube';
import { getAuthState, getValidAccessToken, launchOAuth, logout } from './oauth';
import { appendJobLog, getSettings, patchSettings, saveSettings } from './storage';

type Msg =
  | { type: 'START_TRANSLATE'; videoId: string; languages?: string[]; skipExisting?: boolean }
  | { type: 'PUBLISH'; videoId: string; localizations: LocalizationResult[] }
  | { type: 'FETCH_VIDEO_META'; videoId: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'PATCH_SETTINGS'; partial: Partial<typeof DEFAULT_SETTINGS> }
  | { type: 'GET_AUTH_STATE' }
  | { type: 'LOGIN' }
  | { type: 'LOGOUT' }
  | { type: 'OPEN_OPTIONS' };

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
    case 'GET_AUTH_STATE':
      return { ok: true, ...(await getAuthState()) };
    case 'LOGIN': {
      await launchOAuth();
      return { ok: true, ...(await getAuthState()) };
    }
    case 'LOGOUT':
      await logout();
      return { ok: true, loggedIn: false, email: null };
    case 'FETCH_VIDEO_META':
      return fetchVideoMeta(message.videoId);
    case 'START_TRANSLATE':
      return startTranslate(message.videoId, tabId, message.languages, message.skipExisting);
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

async function fetchVideoMeta(videoId: string) {
  const token = await getValidAccessToken();
  const video = await listVideo(videoId, token);
  return {
    ok: true,
    videoId: video.id,
    title: video.snippet.title,
    description: video.snippet.description,
    defaultLanguage: video.snippet.defaultLanguage,
    existingLocalizations: video.localizations ?? {},
    existingCodes: Object.keys(video.localizations ?? {}),
  };
}

async function startTranslate(
  videoId: string,
  tabId: number | undefined,
  languagesOverride?: string[],
  skipExistingOverride?: boolean,
) {
  const settings = await getSettings();
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

  // Remember last selection
  await patchSettings({
    selectedLanguages: selected,
    lastUsedLanguages: selected,
  });

  const token = await getValidAccessToken();
  let video = await listVideo(videoId, token);

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

  const skipExisting = skipExistingOverride ?? settings.skipExisting;
  const langs = filterLanguagesForTranslate(selected, video.localizations, {
    skipExisting,
    defaultLanguage: video.snippet.defaultLanguage,
  });

  if (!langs.length) {
    return {
      ok: true,
      dryRun: settings.dryRun,
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
    throw new Error(
      'Dry-run is ON — Publish is disabled. Turn off dry-run to publish.',
    );
  }

  const token = await getValidAccessToken();
  let video = await listVideo(videoId, token);
  if (!video.snippet.defaultLanguage) {
    video = await ensureDefaultLanguage(
      video,
      token,
      settings.defaultSourceLanguage || 'en',
    );
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
