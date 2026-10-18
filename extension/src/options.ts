import { listGeminiModels } from '@shared/engines/gemini';
import { DEFAULT_SETTINGS, type AppSettings, type ChannelSettings } from '@shared/types';
import languagesData from '../../languages.json';

type LangFile = {
  presets: Record<string, { label: string; codes: string[] }>;
  languages: { code: string; name: string }[];
};

type ChannelView = {
  id: string;
  title: string;
  thumbnailUrl: string;
  email: string | null;
};

const data = languagesData as LangFile;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function loadGlobal(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<AppSettings> | undefined) };
}

function renderLangList(selected: Set<string>, filter: string) {
  const list = $('langList');
  list.innerHTML = '';
  const q = filter.trim().toLowerCase();
  for (const lang of data.languages) {
    const label = document.createElement('label');
    label.className = 'lang-item';
    if (q && !lang.name.toLowerCase().includes(q) && !lang.code.toLowerCase().includes(q)) {
      label.classList.add('hidden');
    }
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = lang.code;
    cb.checked = selected.has(lang.code);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(lang.code);
      else selected.delete(lang.code);
      updateCount(selected);
    });
    label.append(cb, document.createTextNode(` ${lang.name} (${lang.code})`));
    list.append(label);
  }
  updateCount(selected);
}

function updateCount(selected: Set<string>) {
  $('selectedCount').textContent = `${selected.size} selected`;
}

function readGlobalForm(): AppSettings {
  // Preserve language defaults from storage when saving global-only fields.
  return {
    ...DEFAULT_SETTINGS,
    engine: ($('engine') as HTMLSelectElement).value as AppSettings['engine'],
    geminiApiKey: ($('geminiApiKey') as HTMLInputElement).value.trim(),
    geminiModel: ($('geminiModel') as HTMLInputElement).value.trim(),
    deeplApiKey: ($('deeplApiKey') as HTMLInputElement).value.trim(),
    libreTranslateUrl: ($('libreTranslateUrl') as HTMLInputElement).value.trim(),
    libreTranslateApiKey: ($('libreTranslateApiKey') as HTMLInputElement).value.trim(),
    oauthClientId: ($('oauthClientId') as HTMLInputElement).value.trim(),
    titleOver100: ($('titleOver100') as HTMLSelectElement).value as AppSettings['titleOver100'],
    hashtagMode: ($('hashtagMode') as HTMLSelectElement).value as AppSettings['hashtagMode'],
    chapterMode: ($('chapterMode') as HTMLSelectElement).value as AppSettings['chapterMode'],
    dryRun: ($('dryRun') as HTMLInputElement).checked,
    skipExisting: ($('skipExisting') as HTMLInputElement).checked,
  };
}

function fillGlobalForm(s: AppSettings) {
  ($('oauthClientId') as HTMLInputElement).value = s.oauthClientId;
  ($('engine') as HTMLSelectElement).value = s.engine;
  ($('geminiApiKey') as HTMLInputElement).value = s.geminiApiKey;
  ($('geminiModel') as HTMLInputElement).value = s.geminiModel ?? '';
  ($('deeplApiKey') as HTMLInputElement).value = s.deeplApiKey;
  ($('libreTranslateUrl') as HTMLInputElement).value = s.libreTranslateUrl;
  ($('libreTranslateApiKey') as HTMLInputElement).value = s.libreTranslateApiKey;
  ($('titleOver100') as HTMLSelectElement).value = s.titleOver100;
  ($('hashtagMode') as HTMLSelectElement).value = s.hashtagMode;
  ($('chapterMode') as HTMLSelectElement).value = s.chapterMode;
  ($('dryRun') as HTMLInputElement).checked = s.dryRun;
  ($('skipExisting') as HTMLInputElement).checked = s.skipExisting;
}

function fillChannelForm(s: ChannelSettings) {
  ($('defaultSourceLanguage') as HTMLInputElement).value = s.defaultSourceLanguage;
  ($('protectedTerms') as HTMLTextAreaElement).value = s.protectedTerms.join('\n');
}

function readChannelForm(selected: Set<string>, lastUsed: string[]): ChannelSettings {
  return {
    selectedLanguages: [...selected],
    lastUsedLanguages: lastUsed.length ? lastUsed : [...selected],
    protectedTerms: ($('protectedTerms') as HTMLTextAreaElement).value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    defaultSourceLanguage:
      ($('defaultSourceLanguage') as HTMLInputElement).value.trim() || 'en',
  };
}

function fillModelSelect(models: string[], current: string) {
  const sel = $('geminiModelSelect') as HTMLSelectElement;
  const list = $('geminiModelList') as HTMLDataListElement;
  sel.innerHTML = '';
  list.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Auto (newest flash)';
  sel.append(auto);
  for (const id of models) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    if (id === current) opt.selected = true;
    sel.append(opt);
    const d = document.createElement('option');
    d.value = id;
    list.append(d);
  }
  if (!current) auto.selected = true;
}

async function main() {
  const settings = await loadGlobal();
  fillGlobalForm(settings);

  const selected = new Set<string>();
  let lastUsed: string[] = [];
  let activeChannelId = '';

  const auth = (await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' })) as {
    ok: boolean;
    channels?: ChannelView[];
    activeChannelId?: string | null;
  };
  const channels = auth.channels ?? [];
  const sel = $('channelSelect') as HTMLSelectElement;
  sel.innerHTML = '';
  if (!channels.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— connect a channel in the popup —';
    sel.append(opt);
    $('channelSettingsPanel').classList.add('hidden');
  } else {
    for (const ch of channels) {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = ch.title + (ch.email ? ` (${ch.email})` : '');
      sel.append(opt);
    }
    activeChannelId = auth.activeChannelId ?? channels[0].id;
    sel.value = activeChannelId;
    $('channelSettingsPanel').classList.remove('hidden');
    const chRes = (await chrome.runtime.sendMessage({
      type: 'GET_CHANNEL_SETTINGS',
      channelId: activeChannelId,
    })) as { ok: boolean; settings?: ChannelSettings };
    if (chRes.settings) {
      selected.clear();
      chRes.settings.selectedLanguages.forEach((c) => selected.add(c));
      lastUsed = [...(chRes.settings.lastUsedLanguages ?? selected)];
      fillChannelForm(chRes.settings);
      renderLangList(selected, '');
    }
  }

  try {
    $('redirectUri').textContent = chrome.identity.getRedirectURL();
  } catch {
    // ignore
  }

  sel.addEventListener('change', async () => {
    activeChannelId = sel.value;
    if (!activeChannelId) {
      $('channelSettingsPanel').classList.add('hidden');
      return;
    }
    $('channelSettingsPanel').classList.remove('hidden');
    const chRes = (await chrome.runtime.sendMessage({
      type: 'GET_CHANNEL_SETTINGS',
      channelId: activeChannelId,
    })) as { ok: boolean; settings?: ChannelSettings };
    if (!chRes.settings) return;
    selected.clear();
    chRes.settings.selectedLanguages.forEach((c) => selected.add(c));
    lastUsed = [...(chRes.settings.lastUsedLanguages ?? selected)];
    fillChannelForm(chRes.settings);
    renderLangList(selected, ($('langSearch') as HTMLInputElement).value);
  });

  $('langSearch').addEventListener('input', (e) => {
    renderLangList(selected, (e.target as HTMLInputElement).value);
  });

  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = (btn as HTMLElement).dataset.preset!;
      if (key === 'none') selected.clear();
      else if (key === 'all') data.languages.forEach((l) => selected.add(l.code));
      else if (key === 'last') {
        selected.clear();
        lastUsed.forEach((c) => selected.add(c));
      } else {
        const preset = data.presets[key];
        if (preset) {
          selected.clear();
          preset.codes.forEach((c) => selected.add(c));
        }
      }
      renderLangList(selected, ($('langSearch') as HTMLInputElement).value);
    });
  });

  $('geminiModelSelect').addEventListener('change', () => {
    ($('geminiModel') as HTMLInputElement).value = (
      $('geminiModelSelect') as HTMLSelectElement
    ).value;
  });

  $('loadGeminiModels').addEventListener('click', async () => {
    const key = ($('geminiApiKey') as HTMLInputElement).value.trim();
    const hint = $('geminiModelHint');
    if (!key) {
      hint.textContent = 'Enter a Gemini API key first.';
      return;
    }
    hint.textContent = 'Loading models…';
    try {
      const models = await listGeminiModels(key);
      const current = ($('geminiModel') as HTMLInputElement).value.trim();
      fillModelSelect(models, current);
      hint.textContent = `${models.length} models with generateContent. Pick one or leave Auto.`;
    } catch (err) {
      hint.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  });

  $('save').addEventListener('click', async () => {
    const prev = await loadGlobal();
    const next = {
      ...readGlobalForm(),
      selectedLanguages: prev.selectedLanguages,
      lastUsedLanguages: prev.lastUsedLanguages,
      protectedTerms: prev.protectedTerms,
      defaultSourceLanguage: prev.defaultSourceLanguage,
    };

    if (activeChannelId) {
      lastUsed = [...selected];
      const channelSettings = readChannelForm(selected, lastUsed);
      await chrome.runtime.sendMessage({
        type: 'PATCH_CHANNEL_SETTINGS',
        channelId: activeChannelId,
        partial: channelSettings,
      });
      next.selectedLanguages = channelSettings.selectedLanguages;
      next.lastUsedLanguages = channelSettings.lastUsedLanguages;
      next.protectedTerms = channelSettings.protectedTerms;
      next.defaultSourceLanguage = channelSettings.defaultSourceLanguage;
    }

    await chrome.storage.local.set({ settings: next });
    $('status').textContent = 'Saved.';
    setTimeout(() => {
      $('status').textContent = '';
    }, 2000);
  });
}

main();
