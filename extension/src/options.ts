import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types';
import languagesData from '../../languages.json';

type LangFile = {
  presets: Record<string, { label: string; codes: string[] }>;
  languages: { code: string; name: string }[];
};

const data = languagesData as LangFile;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load(): Promise<AppSettings> {
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

function readForm(selected: Set<string>): AppSettings {
  return {
    selectedLanguages: [...selected],
    engine: ($('engine') as HTMLSelectElement).value as AppSettings['engine'],
    geminiApiKey: ($('geminiApiKey') as HTMLInputElement).value.trim(),
    deeplApiKey: ($('deeplApiKey') as HTMLInputElement).value.trim(),
    libreTranslateUrl: ($('libreTranslateUrl') as HTMLInputElement).value.trim(),
    libreTranslateApiKey: ($('libreTranslateApiKey') as HTMLInputElement).value.trim(),
    oauthClientId: ($('oauthClientId') as HTMLInputElement).value.trim(),
    titleOver100: ($('titleOver100') as HTMLSelectElement).value as AppSettings['titleOver100'],
    hashtagMode: ($('hashtagMode') as HTMLSelectElement).value as AppSettings['hashtagMode'],
    chapterMode: ($('chapterMode') as HTMLSelectElement).value as AppSettings['chapterMode'],
    protectedTerms: ($('protectedTerms') as HTMLTextAreaElement).value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    defaultSourceLanguage: ($('defaultSourceLanguage') as HTMLInputElement).value.trim() || 'en',
    dryRun: ($('dryRun') as HTMLInputElement).checked,
  };
}

function fillForm(s: AppSettings) {
  ($('oauthClientId') as HTMLInputElement).value = s.oauthClientId;
  ($('engine') as HTMLSelectElement).value = s.engine;
  ($('geminiApiKey') as HTMLInputElement).value = s.geminiApiKey;
  ($('deeplApiKey') as HTMLInputElement).value = s.deeplApiKey;
  ($('libreTranslateUrl') as HTMLInputElement).value = s.libreTranslateUrl;
  ($('libreTranslateApiKey') as HTMLInputElement).value = s.libreTranslateApiKey;
  ($('defaultSourceLanguage') as HTMLInputElement).value = s.defaultSourceLanguage;
  ($('titleOver100') as HTMLSelectElement).value = s.titleOver100;
  ($('hashtagMode') as HTMLSelectElement).value = s.hashtagMode;
  ($('chapterMode') as HTMLSelectElement).value = s.chapterMode;
  ($('protectedTerms') as HTMLTextAreaElement).value = s.protectedTerms.join('\n');
  ($('dryRun') as HTMLInputElement).checked = s.dryRun;
}

async function main() {
  const settings = await load();
  const selected = new Set(settings.selectedLanguages);
  fillForm(settings);
  renderLangList(selected, '');

  try {
    $('redirectUri').textContent = chrome.identity.getRedirectURL();
  } catch {
    // ignore
  }

  $('langSearch').addEventListener('input', (e) => {
    renderLangList(selected, (e.target as HTMLInputElement).value);
  });

  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = (btn as HTMLElement).dataset.preset!;
      if (key === 'none') selected.clear();
      else if (key === 'all') data.languages.forEach((l) => selected.add(l.code));
      else {
        const preset = data.presets[key];
        if (preset) {
          selected.clear();
          preset.codes.forEach((c) => selected.add(c));
        }
      }
      renderLangList(selected, ($('langSearch') as HTMLInputElement).value);
    });
  });

  $('save').addEventListener('click', async () => {
    const next = readForm(selected);
    await chrome.storage.local.set({ settings: next });
    $('status').textContent = 'Saved.';
    setTimeout(() => {
      $('status').textContent = '';
    }, 2000);
  });
}

main();
