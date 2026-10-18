import { jobFailed, jobPercent, type TranslateJob } from '@shared/job';
import type { AppSettings } from '@shared/types';
import {
  connectRuntimePort,
  probeStudioTab,
  sendRuntimeMessage,
} from './messaging';

type ChannelView = {
  id: string;
  title: string;
  thumbnailUrl: string;
  email: string | null;
  hasToken: boolean;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STUDIO_HINT = 'Open/refresh a YouTube Studio tab';

async function load() {
  const studioHint = $('studioHint');
  try {
    const probe = await probeStudioTab({ injectIfMissing: true });
    if (probe.status === 'ok') {
      studioHint.classList.add('hidden');
      studioHint.textContent = '';
    } else {
      studioHint.textContent = STUDIO_HINT;
      studioHint.classList.remove('hidden');
    }
  } catch {
    studioHint.textContent = STUDIO_HINT;
    studioHint.classList.remove('hidden');
  }

  const [settingsRes, authRes, jobRes] = await Promise.all([
    sendRuntimeMessage<{ ok: boolean; settings?: AppSettings }>({
      type: 'GET_SETTINGS',
    }),
    sendRuntimeMessage<{
      ok: boolean;
      loggedIn?: boolean;
      channels?: ChannelView[];
      activeChannelId?: string | null;
    }>({ type: 'GET_AUTH_STATE' }),
    sendRuntimeMessage<{ ok: boolean; job?: TranslateJob | null }>({
      type: 'GET_JOB',
    }),
  ]);

  const settings = settingsRes?.settings;
  if (!settings) return;

  renderChecklist(settings);
  await renderChannels(authRes?.channels ?? [], authRes?.activeChannelId ?? null);
  renderStatus(settings, authRes?.channels ?? [], authRes?.activeChannelId ?? null);
  renderJob(jobRes?.job ?? null);

  const port = connectRuntimePort('vt-job');
  if (port) {
    port.onMessage.addListener((msg: { type?: string; job?: TranslateJob | null }) => {
      if (msg.type === 'JOB_UPDATE' || msg.type === 'PONG') renderJob(msg.job ?? null);
    });
  }

  ($('dryRun') as HTMLInputElement).checked = settings.dryRun;
  $('dryRun').onchange = async () => {
    await sendRuntimeMessage({
      type: 'PATCH_SETTINGS',
      partial: { dryRun: ($('dryRun') as HTMLInputElement).checked },
    });
  };

  $('openOptions').onclick = (e) => {
    e.preventDefault();
    void sendRuntimeMessage({ type: 'OPEN_OPTIONS' });
  };

  $('setupLink').onclick = (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: chrome.runtime.getURL('SETUP.md') });
  };

  $('openStudio').onclick = () => {
    void sendRuntimeMessage({ type: 'OPEN_STUDIO_FOR_JOB' });
  };

  $('addChannelBtn').onclick = async () => {
    const btn = $('addChannelBtn') as HTMLButtonElement;
    btn.disabled = true;
    try {
      const res = await sendRuntimeMessage<{
        ok: boolean;
        error?: string;
        channels?: ChannelView[];
        activeChannelId?: string | null;
      }>({ type: 'ADD_CHANNEL' });
      if (!res?.ok) {
        alert(res?.error ?? 'Add channel failed');
        return;
      }
      await renderChannels(res.channels ?? [], res.activeChannelId ?? null);
      renderStatus(settings, res.channels ?? [], res.activeChannelId ?? null);
    } finally {
      btn.disabled = false;
    }
  };
}

function renderJob(job: TranslateJob | null) {
  const section = $('jobSection');
  if (!job) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  const pct = jobPercent(job);
  const failedN = jobFailed(job).length;
  let status = '';
  if (job.phase === 'running') status = `Translating ${job.doneCount}/${job.totalCount}`;
  else if (failedN) status = `⚠ ${failedN} failed · ${job.doneCount}/${job.totalCount}`;
  else status = `✓ Done ${job.doneCount}/${job.totalCount}`;
  $('jobSummary').innerHTML = `
    <div class="job-line"><span class="muted">Video</span> <code>${escapeHtml(job.videoId)}</code></div>
    <div class="job-line">${escapeHtml(status)} · ${pct}%</div>`;
  $('jobFill').style.width = `${pct}%`;
  $('jobFill').dataset.phase = job.phase;
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

async function renderChannels(channels: ChannelView[], activeChannelId: string | null) {
  const box = $('channelList');
  box.innerHTML = '';

  if (!channels.length) {
    box.innerHTML = `<p class="muted">No channels connected yet.</p>`;
    return;
  }

  for (const ch of channels) {
    const row = document.createElement('div');
    row.className = 'channel-row' + (ch.id === activeChannelId ? ' active' : '');
    const thumb = ch.thumbnailUrl
      ? `<img class="avatar" src="${escapeAttr(ch.thumbnailUrl)}" alt="" width="28" height="28" />`
      : `<span class="avatar placeholder"></span>`;
    row.innerHTML = `
      <label class="channel-main">
        <input type="radio" name="activeChannel" value="${escapeAttr(ch.id)}" ${
          ch.id === activeChannelId ? 'checked' : ''
        } />
        ${thumb}
        <span class="channel-text">
          <span class="channel-title">${escapeHtml(ch.title)}</span>
          <span class="channel-email">${escapeHtml(ch.email ?? ch.id)}</span>
        </span>
      </label>
      <button type="button" class="linkish remove" data-id="${escapeAttr(ch.id)}">Remove</button>`;

    row.querySelector('input')!.addEventListener('change', async () => {
      const res = await sendRuntimeMessage<{
        ok: boolean;
        channels?: ChannelView[];
        activeChannelId?: string | null;
      }>({
        type: 'SET_ACTIVE_CHANNEL',
        channelId: ch.id,
      });
      if (res?.ok) {
        await renderChannels(res.channels ?? [], res.activeChannelId ?? null);
        const settingsRes = await sendRuntimeMessage<{ settings?: AppSettings }>({
          type: 'GET_SETTINGS',
        });
        if (settingsRes?.settings) {
          renderStatus(settingsRes.settings, res.channels ?? [], res.activeChannelId ?? null);
        }
      }
    });

    row.querySelector('.remove')!.addEventListener('click', async () => {
      if (!confirm(`Remove ${ch.title}?`)) return;
      const res = await sendRuntimeMessage<{
        ok: boolean;
        channels?: ChannelView[];
        activeChannelId?: string | null;
      }>({
        type: 'REMOVE_CHANNEL',
        channelId: ch.id,
      });
      if (res?.ok) {
        await renderChannels(res.channels ?? [], res.activeChannelId ?? null);
        const settingsRes = await sendRuntimeMessage<{ settings?: AppSettings }>({
          type: 'GET_SETTINGS',
        });
        if (settingsRes?.settings) {
          renderStatus(settingsRes.settings, res.channels ?? [], res.activeChannelId ?? null);
        }
      }
    });

    box.append(row);
  }
}

function renderStatus(
  settings: AppSettings,
  channels: ChannelView[],
  activeChannelId: string | null,
) {
  const keyOk =
    settings.engine === 'gemini'
      ? !!settings.geminiApiKey.trim()
      : settings.engine === 'deepl'
        ? !!settings.deeplApiKey.trim()
        : !!settings.libreTranslateUrl.trim();
  $('engineStatus').textContent = `${settings.engine}${keyOk ? ' · key set' : ' · key missing'}`;
  $('langCount').textContent = `${settings.selectedLanguages.length} selected`;
  const active = channels.find((c) => c.id === activeChannelId);
  $('activeChannel').textContent = active?.title ?? (channels.length ? '—' : 'none');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

void load();
