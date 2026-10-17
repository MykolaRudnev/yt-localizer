import type { AppSettings } from '@shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load() {
  const [settingsRes, authRes] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }) as Promise<{
      ok: boolean;
      settings?: AppSettings;
    }>,
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }) as Promise<{
      ok: boolean;
      loggedIn?: boolean;
      email?: string | null;
    }>,
  ]);

  const settings = settingsRes.settings;
  if (!settings) return;

  renderChecklist(settings);
  renderAuth(!!authRes.loggedIn, authRes.email ?? null);
  renderStatus(settings);

  ($('dryRun') as HTMLInputElement).checked = settings.dryRun;
  $('dryRun').onchange = async () => {
    await chrome.runtime.sendMessage({
      type: 'PATCH_SETTINGS',
      partial: { dryRun: ($('dryRun') as HTMLInputElement).checked },
    });
  };

  $('openOptions').onclick = (e) => {
    e.preventDefault();
    void chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
  };

  $('setupLink').onclick = (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: chrome.runtime.getURL('SETUP.md') });
  };
}

function renderChecklist(settings: AppSettings) {
  const items: { ok: boolean; text: string }[] = [
    {
      ok: !!settings.oauthClientId.trim(),
      text: 'OAuth Client ID (SETUP.md §3)',
    },
  ];

  if (settings.engine === 'gemini') {
    items.push({
      ok: !!settings.geminiApiKey.trim(),
      text: 'Gemini API key (SETUP.md §4)',
    });
  } else if (settings.engine === 'deepl') {
    items.push({
      ok: !!settings.deeplApiKey.trim(),
      text: 'DeepL API key (SETUP.md §5)',
    });
  } else {
    items.push({
      ok: !!settings.libreTranslateUrl.trim(),
      text: 'LibreTranslate URL (SETUP.md §6)',
    });
  }

  const box = $('checklist');
  const list = $('checklistItems');
  list.innerHTML = '';
  let anyMissing = false;
  for (const item of items) {
    const li = document.createElement('li');
    li.className = item.ok ? 'ok' : 'missing';
    li.textContent = (item.ok ? '✓ ' : '○ ') + item.text;
    list.append(li);
    if (!item.ok) anyMissing = true;
  }
  box.classList.toggle('hidden', !anyMissing);
}

function renderAuth(loggedIn: boolean, email: string | null) {
  const box = $('authBox');
  if (loggedIn) {
    box.innerHTML = `
      <div class="email">${email ? escapeHtml(email) : 'Signed in with Google'}</div>
      <button type="button" class="linkish" id="logoutBtn">Sign out</button>`;
    $('logoutBtn').onclick = async () => {
      await chrome.runtime.sendMessage({ type: 'LOGOUT' });
      renderAuth(false, null);
    };
  } else {
    box.innerHTML = `<button type="button" id="loginBtn" class="primary">Login with Google</button>`;
    $('loginBtn').onclick = async () => {
      const res = (await chrome.runtime.sendMessage({ type: 'LOGIN' })) as {
        ok: boolean;
        error?: string;
        loggedIn?: boolean;
        email?: string | null;
      };
      if (!res?.ok) {
        alert(res?.error ?? 'Login failed');
        return;
      }
      renderAuth(!!res.loggedIn, res.email ?? null);
    };
  }
}

function renderStatus(settings: AppSettings) {
  const keyOk =
    settings.engine === 'gemini'
      ? !!settings.geminiApiKey.trim()
      : settings.engine === 'deepl'
        ? !!settings.deeplApiKey.trim()
        : !!settings.libreTranslateUrl.trim();
  $('engineStatus').textContent = `${settings.engine}${keyOk ? ' · key set' : ' · key missing'}`;
  $('langCount').textContent = `${settings.selectedLanguages.length} selected`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

load();
