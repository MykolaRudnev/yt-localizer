import './content.css';
import {
  jobEta,
  jobFailed,
  jobPercent,
  jobResults,
  needsDiscardPreviewConfirm,
  shouldEndSessionOnClose,
  shouldReopenExistingJob,
  shouldShowJobWidget,
  type TranslateJob,
} from '@shared/job';
import { flagForLanguage } from '@shared/langs';
import { charWarning } from '@shared/text';
import type { AppSettings, LocalizationResult } from '@shared/types';
import languagesData from '../../languages.json';
import { connectRuntimePort, sendRuntimeMessage } from './messaging';

declare global {
  interface Window {
    __veilTranslateContentLoaded?: boolean;
  }
}

const BUTTON_ID = 'veil-translate-btn';
const MODAL_ID = 'vt-modal-root';
const WIDGET_ID = 'vt-job-widget';
const VIDEO_PATH_RE = /\/video\/([^/]+)\/(edit|translations)(?:\/|$|\?)/;
const JOB_PORT = 'vt-job';

type LangFile = {
  presets: Record<string, { label: string; codes: string[] }>;
  languages: { code: string; name: string }[];
};

const data = languagesData as LangFile;

/** UI mode: full modal vs minimized widget. */
let uiExpanded = false;
let jobPort: chrome.runtime.Port | null = null;
let currentJob: TranslateJob | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let unbindModalKeys: (() => void) | null = null;
let releaseFocusTrap: (() => void) | null = null;

function getVideoId(): string | null {
  const m = location.pathname.match(VIDEO_PATH_RE);
  return m?.[1] ?? null;
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

function ensureButton() {
  const videoId = getVideoId();
  let btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;

  if (!videoId) {
    btn?.remove();
    return;
  }

  if (!btn) {
    btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = 'Auto Titles & Description';
    btn.addEventListener('click', () => void onPillClick());
    (document.body || document.documentElement).appendChild(btn);
  }
}

async function sendMsg<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  const res = await sendRuntimeMessage<T>(payload);
  if (res == null) throw new Error('Extension background unavailable — try reloading the extension');
  return res;
}

async function getSettings(): Promise<AppSettings> {
  const res = await sendMsg<{ ok: boolean; settings?: AppSettings }>({ type: 'GET_SETTINGS' });
  if (!res?.ok || !res.settings) throw new Error('Could not load settings');
  return res.settings;
}

async function fetchJob(): Promise<TranslateJob | null> {
  const res = await sendMsg<{ ok: boolean; job?: TranslateJob | null }>({ type: 'GET_JOB' });
  return res?.job ?? null;
}

function connectJobPort() {
  if (jobPort) return;
  jobPort = connectRuntimePort(JOB_PORT);
  if (!jobPort) return;
  jobPort.onMessage.addListener((msg: { type?: string; job?: TranslateJob | null }) => {
    if (msg.type === 'JOB_UPDATE' || msg.type === 'PONG') {
      currentJob = msg.job ?? null;
      onJobUpdate(currentJob);
    }
  });
  jobPort.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    jobPort = null;
    // Reconnect while a job may still be running
    if (currentJob?.phase === 'running') {
      setTimeout(() => connectJobPort(), 500);
    }
  });
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    try {
      jobPort?.postMessage({ type: 'PING' });
    } catch {
      /* ignore */
    }
  }, 20_000);
}

function onJobUpdate(job: TranslateJob | null) {
  currentJob = job;
  const videoId = getVideoId();
  if (!job) {
    removeWidget();
    if (uiExpanded && document.getElementById(MODAL_ID)?.dataset.mode === 'job') {
      uiExpanded = false;
      removeModal();
    }
    return;
  }
  if (job && videoId && job.videoId === videoId) {
    if (uiExpanded) renderJobModal(job);
    else syncWidget(job);
  } else {
    // Job for another video — widget only while still running
    if (!uiExpanded) syncWidget(job);
  }
}

function removeModal() {
  unbindModalKeys?.();
  unbindModalKeys = null;
  releaseFocusTrap?.();
  releaseFocusTrap = null;
  document.getElementById(MODAL_ID)?.remove();
}

function minimizeUi() {
  uiExpanded = false;
  removeModal();
  syncWidget(currentJob);
}

function expandUi(job: TranslateJob) {
  uiExpanded = true;
  removeWidget();
  renderJobModal(job);
}

/** CLEAR_JOB + tear down widget/modal so SPA reload cannot resurrect chrome. */
async function clearJobSession(): Promise<void> {
  await sendMsg({ type: 'CLEAR_JOB' });
  currentJob = null;
  removeWidget();
  uiExpanded = false;
  removeModal();
}

/**
 * Running → minimize (job continues). Finished → clear job session (cache kept)
 * so the next open shows the language picker. Confirm if unpublished preview rows.
 * Always reads `currentJob` so progress→done updates are not stale closures.
 */
async function closeOrEndJobUi() {
  const j = currentJob;
  if (!j || !shouldEndSessionOnClose(j)) {
    minimizeUi();
    return;
  }
  if (needsDiscardPreviewConfirm(j)) {
    const ok = confirm(
      'Close and discard preview? Cached translations are kept for re-use.',
    );
    if (!ok) return;
  }
  await clearJobSession();
}

/** Modal closes only via X / Esc / Close — never outside click or scroll. */
function bindModalChrome(opts: {
  onClose: () => void;
  onEnter?: () => void;
  root: HTMLElement;
}): void {
  unbindModalKeys?.();
  releaseFocusTrap?.();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
      return;
    }
    if (e.key === 'Enter' && opts.onEnter) {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
      e.preventDefault();
      opts.onEnter();
    }
    if (e.key === 'Tab') trapFocus(e, opts.root);
  };
  document.addEventListener('keydown', onKey, true);
  unbindModalKeys = () => document.removeEventListener('keydown', onKey, true);

  // Block backdrop click from doing anything (do not close)
  opts.root.addEventListener('mousedown', (e) => {
    if (e.target === opts.root) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  opts.root.addEventListener(
    'wheel',
    (e) => {
      // Allow scroll inside panel; don't let page steal focus / dismiss
      const panel = opts.root.querySelector('.vt-panel');
      if (panel && !panel.contains(e.target as Node)) {
        e.preventDefault();
      }
    },
    { passive: false },
  );

  const panel = opts.root.querySelector('.vt-panel') as HTMLElement | null;
  if (panel) {
    const focusables = () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
    const first = focusables()[0];
    first?.focus();
    releaseFocusTrap = () => {};
  }
}

function trapFocus(e: KeyboardEvent, root: HTMLElement) {
  const panel = root.querySelector('.vt-panel') as HTMLElement | null;
  if (!panel) return;
  const list = [
    ...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

async function onPillClick() {
  const videoId = getVideoId();
  if (!videoId) return;
  connectJobPort();
  const job = await fetchJob();
  currentJob = job;
  if (shouldReopenExistingJob(job, videoId)) {
    expandUi(job!);
    return;
  }
  await openQuickModal();
}

async function confirmNewTranslation(): Promise<boolean> {
  if (currentJob?.phase === 'running') {
    return confirm(
      'A translation is still running. Stop it and start a new one? Unfinished languages will be left pending.',
    );
  }
  if (currentJob && (currentJob.phase === 'done' || currentJob.phase === 'failed' || currentJob.phase === 'stopped')) {
    return confirm('Discard the current job results and start a new translation?');
  }
  return true;
}

async function startNewTranslationFromJob() {
  const j = currentJob;
  if (j?.phase === 'running') {
    if (!(await confirmNewTranslation())) return;
    await sendMsg({ type: 'STOP_TRANSLATE' });
  } else if (j && shouldEndSessionOnClose(j)) {
    if (needsDiscardPreviewConfirm(j)) {
      const ok = confirm(
        'Close and discard preview? Cached translations are kept for re-use.',
      );
      if (!ok) return;
    }
  } else if (j) {
    if (!(await confirmNewTranslation())) return;
  }
  await clearJobSession();
  await openQuickModal();
}

/* ---------- minimized widget ---------- */

function removeWidget() {
  document.getElementById(WIDGET_ID)?.remove();
}

/** Show floating pill only for running jobs; hide otherwise. */
function syncWidget(job: TranslateJob | null) {
  if (!shouldShowJobWidget(job)) {
    removeWidget();
    return;
  }
  ensureWidget(job!);
}

function ensureWidget(job: TranslateJob) {
  if (!shouldShowJobWidget(job)) {
    removeWidget();
    return;
  }
  let el = document.getElementById(WIDGET_ID) as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = WIDGET_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).appendChild(el);
    void placeWidget(el);
    makeDraggable(el);
  }
  paintWidget(el, job);
}

async function placeWidget(el: HTMLElement) {
  const res = await sendMsg<{ ok: boolean; pos?: { x: number; y: number } | null }>({
    type: 'GET_WIDGET_POS',
  });
  if (res?.pos) {
    el.style.left = `${res.pos.x}px`;
    el.style.top = `${res.pos.y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }
}

function makeDraggable(el: HTMLElement) {
  let ox = 0;
  let oy = 0;
  let dragging = false;
  let moved = false;

  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    moved = false;
    const r = el.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved = true;
    const x = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, e.clientX - ox));
    const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e.clientY - oy));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  el.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const x = parseFloat(el.style.left || '0');
    const y = parseFloat(el.style.top || '0');
    void sendMsg({ type: 'SET_WIDGET_POS', x, y });
    if (!moved) {
      // click → expand
      if (currentJob) expandUi(currentJob);
    }
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
}

function paintWidget(el: HTMLElement, job: TranslateJob) {
  const pct = jobPercent(job);
  const label = `Translating ${job.doneCount}/${job.totalCount}`;
  el.innerHTML = `
    <div class="vt-widget-main">
      <span class="vt-widget-icon"><span class="vt-spin" aria-hidden="true"></span></span>
      <span class="vt-widget-label">${escapeHtml(label)}</span>
    </div>
    <div class="vt-widget-bar"><div class="vt-widget-fill" style="width:${pct}%"></div></div>`;
}

/* ---------- connect / picker ---------- */

async function showConnectChannelModal(
  opts: { channelId?: string; channelTitle?: string; error?: string },
): Promise<void> {
  removeModal();
  uiExpanded = true;
  const root = document.createElement('div');
  root.id = MODAL_ID;
  root.dataset.mode = 'connect';
  const name = opts.channelTitle || opts.channelId || 'this channel';
  root.innerHTML = `
    <div class="vt-panel vt-picker" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      <div class="vt-panel-head">
        <h2 id="vt-title">Connect channel</h2>
        <button type="button" class="vt-icon-btn" id="vt-x" aria-label="Close">×</button>
      </div>
      <div class="vt-banner vt-banner-err">
        This video belongs to <strong>${escapeHtml(name)}</strong>, connect it.
      </div>
      <div class="vt-meta">${escapeHtml(opts.error ?? '')}</div>
      <div class="vt-footer">
        <button type="button" id="vt-cancel">Cancel</button>
        <button type="button" class="primary" id="vt-connect">Connect</button>
      </div>
    </div>`;
  (document.body || document.documentElement).appendChild(root);

  const close = () => {
    uiExpanded = false;
    removeModal();
  };
  bindModalChrome({ root, onClose: close });
  root.querySelector('#vt-x')!.addEventListener('click', close);
  root.querySelector('#vt-cancel')!.addEventListener('click', close);
  root.querySelector('#vt-connect')!.addEventListener('click', async () => {
    const connectBtn = root.querySelector('#vt-connect') as HTMLButtonElement;
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    const res = await sendMsg<{ ok: boolean; error?: string }>({
      type: 'CONNECT_CHANNEL',
      expectedChannelId: opts.channelId,
    });
    if (!res?.ok) {
      alert(res?.error ?? 'Connect failed');
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
      return;
    }
    removeModal();
    void openQuickModal();
  });
}

async function openQuickModal() {
  const videoId = getVideoId();
  if (!videoId) return;

  removeModal();
  uiExpanded = true;
  const root = document.createElement('div');
  root.id = MODAL_ID;
  root.dataset.mode = 'picker';
  root.innerHTML = `
    <div class="vt-panel vt-picker" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      <div class="vt-panel-head">
        <h2 id="vt-title">Auto Titles &amp; Description</h2>
        <button type="button" class="vt-icon-btn" id="vt-x" aria-label="Close">×</button>
      </div>
      <div class="vt-meta" id="vt-picker-status">Loading video localizations…</div>
    </div>`;
  (document.body || document.documentElement).appendChild(root);

  const close = () => {
    uiExpanded = false;
    removeModal();
  };
  bindModalChrome({ root, onClose: close });
  root.querySelector('#vt-x')?.addEventListener('click', close);

  try {
    const settings = await getSettings();
    const meta = await sendMsg<{
      ok: boolean;
      error?: string;
      needsConnect?: boolean;
      channelId?: string;
      channelTitle?: string;
      title?: string;
      defaultLanguage?: string;
      existingCodes?: string[];
      channelSettings?: {
        selectedLanguages: string[];
        lastUsedLanguages: string[];
        autoPublish?: boolean;
      };
    }>({ type: 'FETCH_VIDEO_META', videoId });

    if (meta?.needsConnect) {
      removeModal();
      await showConnectChannelModal({
        channelId: meta.channelId,
        channelTitle: meta.channelTitle,
        error: meta.error,
      });
      return;
    }

    if (!meta?.ok) throw new Error(meta?.error ?? 'Failed to load video');

    const existing = new Set(meta.existingCodes ?? []);
    const langSource =
      meta.channelSettings?.selectedLanguages?.length
        ? meta.channelSettings.selectedLanguages
        : settings.selectedLanguages;
    const lastUsedSource =
      meta.channelSettings?.lastUsedLanguages?.length
        ? meta.channelSettings.lastUsedLanguages
        : settings.lastUsedLanguages;
    const selected = new Set(langSource);
    let skipExisting = settings.skipExisting;
    let dryRun = settings.dryRun;
    let autoPublish = meta.channelSettings?.autoPublish === true;
    let searchQ = '';

    const start = async () => {
      const langs = [...selected];
      if (!langs.length) return;
      await sendMsg({ type: 'PATCH_SETTINGS', partial: { skipExisting, dryRun } });
      if (meta.channelId) {
        await sendMsg({
          type: 'PATCH_CHANNEL_SETTINGS',
          channelId: meta.channelId,
          partial: {
            selectedLanguages: langs,
            lastUsedLanguages: langs,
            autoPublish,
          },
        });
      }
      const res = await sendMsg<{ ok: boolean; error?: string; job?: TranslateJob; skippedAll?: boolean }>({
        type: 'START_TRANSLATE',
        videoId,
        languages: langs,
        skipExisting,
      });
      if (!res?.ok) {
        alert(`VeilTranslate: ${res?.error ?? 'Unknown error'}`);
        return;
      }
      connectJobPort();
      currentJob = res.job ?? (await fetchJob());
      if (res.skippedAll) {
        alert(
          'All selected languages already have localizations (Skip existing is on). Switch to Overwrite to re-translate.',
        );
        return;
      }
      if (currentJob) expandUi(currentJob);
    };

    const fillGrid = (grid: HTMLElement) => {
      grid.innerHTML = '';
      for (const lang of data.languages) {
        if (
          searchQ &&
          !lang.name.toLowerCase().includes(searchQ) &&
          !lang.code.toLowerCase().includes(searchQ)
        ) {
          continue;
        }
        const has = existing.has(lang.code);
        const label = document.createElement('label');
        label.className = 'vt-lang-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = lang.code;
        cb.checked = selected.has(lang.code);
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(lang.code);
          else selected.delete(lang.code);
          updateChrome();
        });
        const flag = document.createElement('span');
        flag.className = 'vt-flag';
        flag.textContent = flagForLanguage(lang.code);
        const name = document.createElement('span');
        name.className = 'vt-lang-name';
        name.textContent = `${lang.name} (${lang.code})`;
        label.append(cb, flag, name);
        if (has) {
          const badge = document.createElement('span');
          badge.className = 'vt-badge';
          badge.textContent = 'exists';
          badge.title = 'Already has a localization on this video';
          label.append(badge);
        }
        grid.append(label);
      }
    };

    const updateChrome = () => {
      const countEl = root.querySelector('#vt-sel-count');
      const goBtn = root.querySelector('#vt-go') as HTMLButtonElement | null;
      if (countEl) {
        const n = selected.size;
        const existingInSelection = [...selected].filter((c) => existing.has(c)).length;
        countEl.textContent = `${n} selected${
          existingInSelection ? ` · ${existingInSelection} already localized` : ''
        }`;
      }
      if (goBtn) {
        const n = selected.size;
        goBtn.disabled = !n;
        goBtn.textContent = `Translate ${n} language${n === 1 ? '' : 's'}`;
      }
    };

    const engineShown = engineLabel(settings.engine, settings.geminiModel || undefined);
    const panel = root.querySelector('.vt-panel') as HTMLElement;
    panel.innerHTML = `
      <div class="vt-panel-head">
        <div>
          <span class="vt-brand-mark">VeilTranslate</span>
          <h2 id="vt-title">Auto Titles &amp; Description</h2>
        </div>
        <button type="button" class="vt-icon-btn" id="vt-x" aria-label="Close">×</button>
      </div>
      <div class="vt-section vt-video-info" id="vt-video-info">
        <div class="vt-section-label vt-section-label-inset">Video</div>
        <div class="vt-video-title">${escapeHtml(meta.title?.slice(0, 90) ?? videoId)}</div>
        <div class="vt-meta vt-meta-tight">
          ${meta.defaultLanguage ? `Default language: ${escapeHtml(meta.defaultLanguage)}` : escapeHtml(videoId)}
        </div>
      </div>
      <div class="vt-banner vt-banner-dry" id="vt-dry-banner" style="display:${dryRun ? 'block' : 'none'}">
        Dry-run ON — preview only; Publish will stay disabled until you turn this off.
      </div>
      <div class="vt-banner vt-banner-live" id="vt-auto-banner" style="display:${
        autoPublish && !dryRun ? 'block' : 'none'
      }">
        Auto-publish ON — translations go live as they finish
      </div>
      <div class="vt-section">
        <div class="vt-section-label">Languages</div>
        <div class="vt-chips" id="vt-presets">
          <button type="button" data-preset="top10" class="vt-chip">Top 10</button>
          <button type="button" data-preset="top20" class="vt-chip">Top 20</button>
          <button type="button" data-preset="top10rpm" class="vt-chip" title="Estimate based on typical RPM markets">Top 10 RPM (estimate)</button>
          <button type="button" data-preset="top20rpm" class="vt-chip" title="Estimate based on typical RPM markets">Top 20 RPM (estimate)</button>
          <button type="button" data-preset="all" class="vt-chip">All</button>
          <button type="button" data-preset="last" class="vt-chip">Last used</button>
        </div>
        <input type="search" id="vt-lang-search" class="vt-search" placeholder="Search languages…" aria-label="Search languages" />
        <div class="vt-lang-grid" id="vt-lang-grid"></div>
      </div>
      <div class="vt-picker-footer">
        <span class="vt-count" id="vt-sel-count"></span>
        <div class="vt-mode-row">
          <label class="vt-radio"><input type="radio" name="vt-skip" value="skip" ${
            skipExisting ? 'checked' : ''
          }/> Skip existing</label>
          <label class="vt-radio"><input type="radio" name="vt-skip" value="overwrite" ${
            !skipExisting ? 'checked' : ''
          }/> Overwrite</label>
        </div>
        <label class="vt-check"><input type="checkbox" id="vt-dry" ${
          dryRun ? 'checked' : ''
        }/> Dry-run</label>
        <label class="vt-check"><input type="checkbox" id="vt-auto" ${
          autoPublish ? 'checked' : ''
        }/> Auto-publish</label>
      </div>
      <div class="vt-engine-row" id="vt-engine-row">
        <span class="vt-engine-label">Engine</span>
        <span class="vt-engine-value">${escapeHtml(engineShown || settings.engine)}</span>
      </div>
      <div class="vt-footer">
        <button type="button" id="vt-cancel">Cancel</button>
        <button type="button" class="primary" id="vt-go">Translate</button>
      </div>`;

    const grid = panel.querySelector('#vt-lang-grid') as HTMLElement;
    fillGrid(grid);
    updateChrome();

    const syncAutoBanner = () => {
      const banner = panel.querySelector('#vt-auto-banner') as HTMLElement;
      banner.style.display = autoPublish && !dryRun ? 'block' : 'none';
    };

    bindModalChrome({ root, onClose: close, onEnter: () => void start() });
    panel.querySelector('#vt-x')!.addEventListener('click', close);
    panel.querySelector('#vt-cancel')!.addEventListener('click', close);

    panel.querySelector('#vt-lang-search')!.addEventListener('input', (e) => {
      searchQ = (e.target as HTMLInputElement).value.toLowerCase().trim();
      fillGrid(grid);
    });

    panel.querySelectorAll('[data-preset]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = (el as HTMLElement).dataset.preset!;
        selected.clear();
        if (key === 'all') data.languages.forEach((l) => selected.add(l.code));
        else if (key === 'last') {
          (lastUsedSource?.length ? lastUsedSource : langSource).forEach((c) =>
            selected.add(c),
          );
        } else {
          data.presets[key]?.codes.forEach((c) => selected.add(c));
        }
        fillGrid(grid);
        updateChrome();
      });
    });

    panel.querySelectorAll('input[name="vt-skip"]').forEach((el) => {
      el.addEventListener('change', () => {
        skipExisting =
          (panel.querySelector('input[name="vt-skip"]:checked') as HTMLInputElement)
            .value === 'skip';
      });
    });

    panel.querySelector('#vt-dry')!.addEventListener('change', async (e) => {
      dryRun = (e.target as HTMLInputElement).checked;
      await sendMsg({ type: 'PATCH_SETTINGS', partial: { dryRun } });
      const banner = panel.querySelector('#vt-dry-banner') as HTMLElement;
      banner.style.display = dryRun ? 'block' : 'none';
      syncAutoBanner();
    });

    panel.querySelector('#vt-auto')!.addEventListener('change', async (e) => {
      const cb = e.target as HTMLInputElement;
      if (cb.checked) {
        const ok = await confirmAutoPublish();
        if (!ok) {
          cb.checked = false;
          return;
        }
      }
      autoPublish = cb.checked;
      if (meta.channelId) {
        await sendMsg({
          type: 'PATCH_CHANNEL_SETTINGS',
          channelId: meta.channelId,
          partial: { autoPublish },
        });
      }
      syncAutoBanner();
    });

    panel.querySelector('#vt-go')!.addEventListener('click', () => void start());
  } catch (err) {
    removeModal();
    uiExpanded = false;
    alert(`VeilTranslate: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ---------- job progress / preview modal ---------- */

async function confirmAutoPublish(): Promise<boolean> {
  const ack = await sendMsg<{ ok: boolean; acked?: boolean }>({ type: 'GET_AUTO_PUBLISH_ACK' });
  if (ack?.acked) return true;
  const ok = window.confirm(
    'Auto-publish writes translations to YouTube as they finish (in batches). Dry-run must be OFF. Continue?',
  );
  if (ok) await sendMsg({ type: 'ACK_AUTO_PUBLISH' });
  return ok;
}

function engineLabel(engine?: string, model?: string): string {
  if (!engine) return '';
  if (engine === 'gemini' && model) return `${engine} · ${model}`;
  return engine;
}

function renderJobModal(job: TranslateJob) {
  let root = document.getElementById(MODAL_ID) as HTMLElement | null;
  const results = jobResults(job);
  const failed = jobFailed(job);
  const showPreview = job.phase !== 'running' && results.length > 0;

  if (showPreview) {
    if (!root) {
      root = document.createElement('div');
      root.id = MODAL_ID;
      (document.body || document.documentElement).appendChild(root);
    }
    paintPreview(root, job, results, failed);
    return;
  }

  const existingProgress = root?.dataset.mode === 'job' && root.querySelector('#vt-progress-list');
  if (existingProgress && root && job.phase === 'running') {
    patchProgressDom(root, job);
    return;
  }

  if (!root || root.dataset.mode !== 'job' || !root.querySelector('#vt-progress-list')) {
    removeModal();
    root = document.createElement('div');
    root.id = MODAL_ID;
    root.dataset.mode = 'job';
    (document.body || document.documentElement).appendChild(root);
    buildProgressShell(root, job);
  } else {
    patchProgressDom(root, job);
  }
}

function buildProgressShell(root: HTMLElement, job: TranslateJob) {
  const pct = jobPercent(job);
  const eta = jobEta(job);
  const rows = job.languages.map((code) => langRowHtml(code, job)).join('');
  const headerMsg =
    job.fatalSummary && job.phase !== 'running'
      ? `<div class="vt-banner vt-banner-err" id="vt-fatal"><strong>${escapeHtml(job.fatalSummary)}</strong>${
          job.fatalHint ? `<div class="vt-hint">${escapeHtml(job.fatalHint)}</div>` : ''
        }</div>`
      : `<div id="vt-fatal" hidden></div>`;

  root.innerHTML = `
    <div class="vt-panel vt-job" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      <div class="vt-panel-head">
        <h2 id="vt-title">${job.phase === 'running' ? 'Translating…' : 'Translation job'}</h2>
        <div class="vt-head-actions">
          <button type="button" class="vt-icon-btn" id="vt-x" aria-label="${
            job.phase === 'running' ? 'Minimize' : 'Close'
          }">×</button>
        </div>
      </div>
      <div class="vt-progress-head">
        <div class="vt-progress-meta" id="vt-progress-meta">
          <span data-k="pct">${pct}%</span>
          <span data-k="count">${job.doneCount}/${job.totalCount}</span>
          <span data-k="eta">${eta ? escapeHtml(eta) : ''}</span>
          <span data-k="eng" class="vt-muted">${job.engine ? escapeHtml(engineLabel(job.engine, job.model)) : ''}</span>
        </div>
        <div class="vt-progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="vt-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
      ${
        job.autoPublish && !job.dryRun
          ? `<div class="vt-banner vt-banner-live">Auto-publish ON — translations go live as they finish</div>`
          : ''
      }
      ${headerMsg}
      <div id="vt-progress-list" class="vt-progress-list">${rows}</div>
      <div class="vt-footer sticky" id="vt-job-footer"></div>
    </div>`;

  bindModalChrome({ root, onClose: () => void closeOrEndJobUi() });
  root.querySelector('#vt-x')!.addEventListener('click', () => void closeOrEndJobUi());
  wireJobFooter(root, job);
}

function langRowHtml(code: string, job: TranslateJob): string {
  const s = job.langStates[code];
  const status = s?.status ?? 'pending';
  const eng = s?.note || engineLabel(s?.engine, s?.model);
  const short =
    status === 'pending'
      ? 'pending'
      : status === 'running'
        ? '…'
        : status === 'ok'
          ? s?.published
            ? 'live'
            : s?.cached
              ? 'cached'
              : 'ok'
          : status === 'skipped'
            ? 'skip'
            : 'failed';
  const errBlock =
    status === 'failed' && (s?.error || s?.errorDetail)
      ? `<details open><summary>${escapeHtml(s.error ?? 'Error')}</summary><pre class="vt-err-detail">${escapeHtml(s.errorDetail ?? s.error ?? '')}</pre></details>`
      : '';
  return `<div class="vt-lang-row" data-lang="${escapeAttr(code)}" data-status="${status}">
    <span class="vt-lang-code">${escapeHtml(code)}</span>
    <span class="vt-lang-engine vt-muted" title="${escapeAttr(eng)}">${escapeHtml(eng)}</span>
    <span class="vt-lang-status vt-${status === 'ok' ? 'ok' : status === 'failed' ? 'err' : 'muted'}">${short}</span>
    ${errBlock}
  </div>`;
}

function patchProgressDom(root: HTMLElement, job: TranslateJob) {
  const pct = jobPercent(job);
  const eta = jobEta(job);
  const meta = root.querySelector('#vt-progress-meta');
  if (meta) {
    meta.querySelector('[data-k="pct"]')!.textContent = `${pct}%`;
    meta.querySelector('[data-k="count"]')!.textContent = `${job.doneCount}/${job.totalCount}`;
    meta.querySelector('[data-k="eta"]')!.textContent = eta ?? '';
    meta.querySelector('[data-k="eng"]')!.textContent = job.engine
      ? engineLabel(job.engine, job.model)
      : '';
  }
  const track = root.querySelector('.vt-progress-track') as HTMLElement | null;
  const fill = root.querySelector('.vt-progress-fill') as HTMLElement | null;
  if (track) track.setAttribute('aria-valuenow', String(pct));
  if (fill) fill.style.width = `${pct}%`;

  const title = root.querySelector('#vt-title');
  if (title) title.textContent = job.phase === 'running' ? 'Translating…' : 'Translation job';

  const list = root.querySelector('#vt-progress-list');
  if (list) {
    for (const code of job.languages) {
      const row = list.querySelector(`[data-lang="${CSS.escape(code)}"]`);
      const html = langRowHtml(code, job);
      if (row) {
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        row.replaceWith(wrap.firstElementChild!);
      }
    }
  }

  const xBtn = root.querySelector('#vt-x') as HTMLElement | null;
  if (xBtn) {
    xBtn.setAttribute('aria-label', job.phase === 'running' ? 'Minimize' : 'Close');
  }

  wireJobFooter(root, job);
}

function wireJobFooter(root: HTMLElement, job: TranslateJob) {
  const failed = jobFailed(job);
  const footer = root.querySelector('#vt-job-footer');
  if (!footer) return;
  if (job.phase === 'running') {
    footer.innerHTML = `
      <button type="button" id="vt-stop">Stop</button>
      <button type="button" id="vt-minimize">Minimize</button>`;
  } else {
    footer.innerHTML = `
      ${
        failed.length
          ? `<button type="button" id="vt-retry-failed">Retry ${failed.length} failed</button>`
          : ''
      }
      <button type="button" id="vt-new">New session</button>
      <button type="button" class="primary" id="vt-minimize">Close</button>`;
  }
  footer.querySelector('#vt-minimize')?.addEventListener('click', () => void closeOrEndJobUi());
  footer.querySelector('#vt-new')?.addEventListener('click', () => void startNewTranslationFromJob());
  footer.querySelector('#vt-stop')?.addEventListener('click', () => {
    const btn = footer.querySelector('#vt-stop') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Stopping…';
    void sendMsg({ type: 'STOP_TRANSLATE' });
  });
  footer.querySelector('#vt-retry-failed')?.addEventListener('click', () => {
    void retryLanguages(
      job.videoId,
      failed.map((f) => f.language),
    );
  });
}

function paintPreview(
  root: HTMLElement,
  job: TranslateJob,
  rows: LocalizationResult[],
  failed: { language: string; error: string }[],
) {
  let dryRun = job.dryRun;
  let autoPublish = job.autoPublish === true;

  const paint = () => {
    const tableRows = rows
      .map((r, i) => {
        const w = charWarning(r.title, r.description);
        const st = job.langStates[r.language];
        const badge = st?.published ? ' · live' : st?.cached ? ' · cached' : '';
        return `<tr data-i="${i}">
          <td>${escapeHtml(r.language)}${escapeHtml(badge)}</td>
          <td>
            <input class="vt-title" value="${escapeAttr(r.title)}" />
            <div class="warn vt-title-warn" style="display:${w.titleOver ? 'block' : 'none'}">Title &gt; 100 (${r.title.length})</div>
          </td>
          <td>
            <textarea class="vt-desc" rows="4">${escapeHtml(r.description)}</textarea>
            <div class="warn vt-desc-warn" style="display:${w.descOver ? 'block' : 'none'}">Description &gt; 5000 (${r.description.length})</div>
          </td>
        </tr>`;
      })
      .join('');

    const failedNote = failed.length
      ? `Failed: ${failed.map((f) => `${f.language} (${f.error})`).join('; ')}`
      : '';
    const stopNote =
      job.phase === 'stopped'
        ? 'Stopped. Successful translations below are still editable / publishable.'
        : job.fatalSummary
          ? job.fatalSummary
          : '';
    const unpublished = rows.filter((r) => !job.langStates[r.language]?.published);

    root.dataset.mode = 'job';
    root.innerHTML = `
      <div class="vt-panel vt-job" role="dialog" aria-modal="true" aria-labelledby="vt-title">
        <div class="vt-panel-head">
          <h2 id="vt-title">Preview translations</h2>
          <div class="vt-head-actions">
            <button type="button" class="vt-icon-btn" id="vt-x" aria-label="Close">×</button>
          </div>
        </div>
        <div class="vt-banner vt-banner-dry" style="display:${dryRun ? 'block' : 'none'}">
          Dry-run ON — Publish disabled. Uncheck below to enable publishing.
        </div>
        <div class="vt-banner vt-banner-live" style="display:${
          autoPublish && !dryRun ? 'block' : 'none'
        }">
          Auto-publish ON — translations go live as they finish
        </div>
        ${stopNote ? `<div class="vt-banner vt-banner-err">${escapeHtml(stopNote)}</div>` : ''}
        <div class="vt-meta">
          Video: ${escapeHtml(job.videoId)} · Source: ${escapeHtml((job.sourceTitle ?? '').slice(0, 80))}
          ${failedNote ? `<br/>${escapeHtml(failedNote)}` : ''}
        </div>
        <label class="vt-check vt-dry-inline">
          <input type="checkbox" id="vt-dry-preview" ${dryRun ? 'checked' : ''}/> Dry-run (preview only)
        </label>
        <label class="vt-check vt-dry-inline">
          <input type="checkbox" id="vt-auto-preview" ${autoPublish ? 'checked' : ''}/> Auto-publish
        </label>
        <div class="vt-table-wrap">
          <table>
            <thead><tr><th>Language</th><th>Title</th><th>Description</th></tr></thead>
            <tbody>${tableRows || '<tr><td colspan="3">No translations</td></tr>'}</tbody>
          </table>
        </div>
        <div class="vt-footer sticky">
          <button type="button" id="vt-new">New session</button>
          ${
            failed.length
              ? `<button type="button" id="vt-retry-failed">Retry ${failed.length} failed</button>`
              : ''
          }
          <button type="button" ${
            dryRun || !unpublished.length ? 'class="primary"' : ''
          } id="vt-minimize">Close</button>
          <button type="button" class="primary" id="vt-publish" ${
            dryRun || !unpublished.length ? 'disabled' : ''
          }>Publish${unpublished.length && unpublished.length < rows.length ? ` ${unpublished.length}` : ''}</button>
        </div>
      </div>`;

    root.querySelectorAll('tr[data-i]').forEach((tr) => {
      const titleInput = tr.querySelector('.vt-title') as HTMLInputElement;
      const descInput = tr.querySelector('.vt-desc') as HTMLTextAreaElement;
      const titleWarn = tr.querySelector('.vt-title-warn') as HTMLElement;
      const descWarn = tr.querySelector('.vt-desc-warn') as HTMLElement;
      const update = () => {
        const w = charWarning(titleInput.value, descInput.value);
        titleWarn.style.display = w.titleOver ? 'block' : 'none';
        titleWarn.textContent = `Title > 100 (${titleInput.value.length})`;
        descWarn.style.display = w.descOver ? 'block' : 'none';
        descWarn.textContent = `Description > 5000 (${descInput.value.length})`;
      };
      titleInput.addEventListener('input', update);
      descInput.addEventListener('input', update);
    });

    const onPublish = async () => {
      if (dryRun) return;
      const localizations: LocalizationResult[] = [];
      root.querySelectorAll('tr[data-i]').forEach((tr) => {
        const i = Number((tr as HTMLElement).dataset.i);
        const lang = rows[i].language;
        if (job.langStates[lang]?.published) return;
        const title = (tr.querySelector('.vt-title') as HTMLInputElement).value;
        const description = (tr.querySelector('.vt-desc') as HTMLTextAreaElement).value;
        localizations.push({ language: lang, title, description });
      });
      if (!localizations.length) return;
      const pubBtn = root.querySelector('#vt-publish') as HTMLButtonElement;
      pubBtn.disabled = true;
      pubBtn.textContent = 'Publishing…';
      try {
        const res = await sendMsg<{ ok: boolean; error?: string; published?: string[] }>({
          type: 'PUBLISH',
          videoId: job.videoId,
          localizations,
        });
        showResultPanel(root, {
          published: res?.ok ? (res.published ?? []) : [],
          failed: res?.ok
            ? failed
            : localizations.map((l) => ({
                language: l.language,
                error: res?.error ?? 'unknown',
              })),
          error: res?.ok ? undefined : res?.error,
        });
      } catch (err) {
        showResultPanel(root, {
          published: [],
          failed: rows.map((l) => ({
            language: l.language,
            error: err instanceof Error ? err.message : String(err),
          })),
        });
      }
    };

    bindModalChrome({
      root,
      onClose: () => void closeOrEndJobUi(),
      onEnter: () => {
        const pub = root.querySelector('#vt-publish') as HTMLButtonElement | null;
        if (pub && !pub.disabled) void onPublish();
      },
    });
    root.querySelector('#vt-x')!.addEventListener('click', () => void closeOrEndJobUi());
    root.querySelector('#vt-minimize')!.addEventListener('click', () => void closeOrEndJobUi());
    root.querySelector('#vt-new')?.addEventListener('click', () => void startNewTranslationFromJob());
    root.querySelector('#vt-dry-preview')!.addEventListener('change', async (e) => {
      dryRun = (e.target as HTMLInputElement).checked;
      await sendMsg({ type: 'PATCH_SETTINGS', partial: { dryRun } });
      paint();
    });
    root.querySelector('#vt-auto-preview')!.addEventListener('change', async (e) => {
      const cb = e.target as HTMLInputElement;
      if (cb.checked) {
        const ok = await confirmAutoPublish();
        if (!ok) {
          cb.checked = false;
          return;
        }
      }
      autoPublish = cb.checked;
      if (job.channelId) {
        await sendMsg({
          type: 'PATCH_CHANNEL_SETTINGS',
          channelId: job.channelId,
          partial: { autoPublish },
        });
      }
      paint();
    });
    root.querySelector('#vt-retry-failed')?.addEventListener('click', () => {
      void retryLanguages(
        job.videoId,
        failed.map((f) => f.language),
      );
    });
    root.querySelector('#vt-publish')!.addEventListener('click', () => void onPublish());
  };

  if (!rows.length && failed.length) {
    root.dataset.mode = 'job';
    showResultPanel(root, { published: [], failed });
    return;
  }
  paint();
}

function showResultPanel(
  root: HTMLElement,
  opts: {
    published: string[];
    failed: { language: string; error: string }[];
    error?: string;
  },
) {
  root.innerHTML = `
    <div class="vt-panel vt-job" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      <div class="vt-panel-head">
        <h2 id="vt-title">Result</h2>
        <button type="button" class="vt-icon-btn" id="vt-x" aria-label="Close">×</button>
      </div>
      ${opts.error ? `<p class="vt-err">${escapeHtml(opts.error)}</p>` : ''}
      ${
        opts.published.length
          ? `<p class="vt-ok">OK: ${escapeHtml(opts.published.join(', '))}</p>`
          : ''
      }
      ${
        opts.failed.length
          ? `<p class="vt-err">Failed: ${escapeHtml(
              opts.failed.map((f) => `${f.language} (${f.error})`).join('; '),
            )}</p>`
          : ''
      }
      ${
        !opts.published.length && !opts.failed.length
          ? '<p class="vt-meta">Nothing published.</p>'
          : ''
      }
      <div class="vt-footer sticky">
        ${
          opts.failed.length
            ? `<button type="button" id="vt-retry-failed">Retry ${opts.failed.length} failed</button>`
            : ''
        }
        <button type="button" id="vt-new">New session</button>
        <button type="button" class="primary" id="vt-minimize">Close</button>
      </div>
    </div>`;
  bindModalChrome({ root, onClose: () => void closeOrEndJobUi() });
  root.querySelector('#vt-x')!.addEventListener('click', () => void closeOrEndJobUi());
  root.querySelector('#vt-minimize')!.addEventListener('click', () => void closeOrEndJobUi());
  root.querySelector('#vt-new')?.addEventListener('click', () => void startNewTranslationFromJob());
  root.querySelector('#vt-retry-failed')?.addEventListener('click', () => {
    const vid = getVideoId() || currentJob?.videoId;
    if (vid) void retryLanguages(vid, opts.failed.map((f) => f.language));
  });
}

async function retryLanguages(videoId: string, languages: string[]) {
  const res = await sendMsg<{ ok: boolean; error?: string; job?: TranslateJob }>({
    type: 'START_TRANSLATE',
    videoId,
    languages,
    skipExisting: false,
  });
  if (!res?.ok) {
    alert(`VeilTranslate: ${res?.error ?? 'Retry failed'}`);
    return;
  }
  connectJobPort();
  currentJob = res.job ?? (await fetchJob());
  if (currentJob) expandUi(currentJob);
}

/* ---------- boot ---------- */

async function bootJobUi() {
  connectJobPort();
  const job = await fetchJob();
  currentJob = job;
  if (!uiExpanded) syncWidget(job);
}

let lastUrl = location.href;
function watchSpa() {
  ensureButton();
  void bootJobUi();
  const obs = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      ensureButton();
      // SPA nav: keep running widget only; never resurrect finished sessions
      if (!uiExpanded) syncWidget(currentJob);
    } else {
      ensureButton();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      ensureButton();
      if (!uiExpanded) syncWidget(currentJob);
    }
  }, 1000);
}

// Skip duplicate boot when chrome.scripting re-injects after an extension update.
if (!window.__veilTranslateContentLoaded) {
  window.__veilTranslateContentLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: string }).type === 'VT_PING'
    ) {
      try {
        sendResponse({ ok: true, videoId: getVideoId() });
      } catch {
        /* channel closed */
      }
      return true;
    }
    return false;
  });
  watchSpa();
}
