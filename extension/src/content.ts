import './content.css';
import { flagForLanguage } from '@shared/langs';
import { charWarning } from '@shared/text';
import type { AppSettings, LocalizationResult } from '@shared/types';
import languagesData from '../../languages.json';

const BUTTON_ID = 'veil-translate-btn';
const VIDEO_PATH_RE = /\/video\/([^/]+)\/(edit|translations)(?:\/|$|\?)/;

type LangFile = {
  presets: Record<string, { label: string; codes: string[] }>;
  languages: { code: string; name: string }[];
};

const data = languagesData as LangFile;

function getVideoId(): string | null {
  const m = location.pathname.match(VIDEO_PATH_RE);
  return m?.[1] ?? null;
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
    btn.addEventListener('click', () => void openQuickModal());
    document.documentElement.appendChild(btn);
  }
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

function removeModal() {
  document.getElementById('vt-modal-root')?.remove();
}

function bindKeys(opts: { onEsc: () => void; onEnter?: () => void }): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      opts.onEsc();
      return;
    }
    if (e.key === 'Enter' && opts.onEnter) {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA') return;
      e.preventDefault();
      opts.onEnter();
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

async function getSettings(): Promise<AppSettings> {
  const res = (await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })) as {
    ok: boolean;
    settings?: AppSettings;
  };
  if (!res?.ok || !res.settings) throw new Error('Could not load settings');
  return res.settings;
}

async function openQuickModal() {
  const videoId = getVideoId();
  if (!videoId) return;

  const btn = document.getElementById(BUTTON_ID) as HTMLButtonElement;
  btn.disabled = true;

  removeModal();
  const root = document.createElement('div');
  root.id = 'vt-modal-root';
  root.innerHTML = `
    <div class="vt-panel vt-picker">
      <h2>Auto Titles &amp; Description</h2>
      <div class="vt-meta" id="vt-picker-status">Loading video localizations…</div>
    </div>`;
  document.documentElement.appendChild(root);

  let unbind = bindKeys({
    onEsc: () => {
      unbind();
      removeModal();
      btn.disabled = false;
    },
  });

  try {
    const settings = await getSettings();
    const meta = (await chrome.runtime.sendMessage({
      type: 'FETCH_VIDEO_META',
      videoId,
    })) as {
      ok: boolean;
      error?: string;
      title?: string;
      defaultLanguage?: string;
      existingCodes?: string[];
    };

    if (!meta?.ok) throw new Error(meta?.error ?? 'Failed to load video');

    const existing = new Set(meta.existingCodes ?? []);
    const selected = new Set(settings.selectedLanguages);
    let skipExisting = settings.skipExisting;
    let dryRun = settings.dryRun;
    let searchQ = '';

    const close = () => {
      unbind();
      removeModal();
      btn.disabled = false;
    };

    const start = async () => {
      const langs = [...selected];
      if (!langs.length) return;
      await chrome.runtime.sendMessage({
        type: 'PATCH_SETTINGS',
        partial: {
          selectedLanguages: langs,
          lastUsedLanguages: langs,
          skipExisting,
          dryRun,
        },
      });
      unbind();
      removeModal();
      await runTranslateFlow(videoId, langs, skipExisting, btn);
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

    const panel = root.querySelector('.vt-panel') as HTMLElement;
    panel.innerHTML = `
      <h2>Auto Titles &amp; Description</h2>
      <div class="vt-meta">
        ${escapeHtml(meta.title?.slice(0, 90) ?? videoId)}
        ${meta.defaultLanguage ? ` · default: ${escapeHtml(meta.defaultLanguage)}` : ''}
      </div>
      <div class="vt-banner vt-banner-dry" id="vt-dry-banner" style="display:${dryRun ? 'block' : 'none'}">
        Dry-run ON — preview only; Publish will stay disabled until you turn this off.
      </div>
      <div class="vt-chips" id="vt-presets">
        <button type="button" data-preset="top10" class="vt-chip">Top 10</button>
        <button type="button" data-preset="top20" class="vt-chip">Top 20</button>
        <button type="button" data-preset="top10rpm" class="vt-chip" title="Estimate based on typical RPM markets">Top 10 RPM (estimate)</button>
        <button type="button" data-preset="all" class="vt-chip">All</button>
        <button type="button" data-preset="last" class="vt-chip">Last used</button>
      </div>
      <input type="search" id="vt-lang-search" class="vt-search" placeholder="Search languages…" />
      <div class="vt-lang-grid" id="vt-lang-grid"></div>
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
      </div>
      <div class="vt-actions">
        <button type="button" id="vt-cancel">Cancel</button>
        <button type="button" class="primary" id="vt-go">Translate</button>
      </div>`;

    const grid = panel.querySelector('#vt-lang-grid') as HTMLElement;
    fillGrid(grid);
    updateChrome();

    unbind();
    unbind = bindKeys({ onEsc: close, onEnter: () => void start() });

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
          (settings.lastUsedLanguages?.length
            ? settings.lastUsedLanguages
            : settings.selectedLanguages
          ).forEach((c) => selected.add(c));
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
      await chrome.runtime.sendMessage({
        type: 'PATCH_SETTINGS',
        partial: { dryRun },
      });
      const banner = panel.querySelector('#vt-dry-banner') as HTMLElement;
      banner.style.display = dryRun ? 'block' : 'none';
    });

    panel.querySelector('#vt-cancel')!.addEventListener('click', close);
    panel.querySelector('#vt-go')!.addEventListener('click', () => void start());
  } catch (err) {
    unbind();
    removeModal();
    alert(`VeilTranslate: ${err instanceof Error ? err.message : String(err)}`);
    btn.disabled = false;
  }
}

type LangRowState = 'pending' | 'running' | 'ok' | 'failed';

async function runTranslateFlow(
  videoId: string,
  languages: string[],
  skipExisting: boolean,
  btn: HTMLButtonElement,
) {
  btn.disabled = true;
  const progressRoot = showProgressOverlay(languages);
  let stoppedByUser = false;

  const setRow = (
    lang: string,
    status: LangRowState,
    error?: string,
    errorDetail?: string,
  ) => {
    const row = progressRoot.querySelector(`[data-lang="${CSS.escape(lang)}"]`) as HTMLElement | null;
    if (!row) return;
    row.dataset.status = status;
    const label = row.querySelector('.vt-lang-status') as HTMLElement;
    const short =
      status === 'pending'
        ? 'pending'
        : status === 'running'
          ? '…'
          : status === 'ok'
            ? 'ok'
            : 'failed';
    label.textContent = short;
    label.className = `vt-lang-status vt-${status === 'ok' ? 'ok' : status === 'failed' ? 'err' : 'muted'}`;
    const details = row.querySelector('details') as HTMLDetailsElement | null;
    if (status === 'failed' && (error || errorDetail)) {
      if (details) {
        details.style.display = '';
        const sum = details.querySelector('summary');
        if (sum) sum.textContent = error ?? 'Error';
        const pre = details.querySelector('.vt-err-detail');
        if (pre) pre.textContent = errorDetail ?? error ?? '';
      }
    } else if (details) {
      details.style.display = 'none';
    }
  };

  const onMsg = (msg: {
    type?: string;
    language?: string;
    index?: number;
    total?: number;
    status?: string;
    message?: string;
    error?: string;
    errorDetail?: string;
    languages?: string[];
    stopReason?: string;
    fatalSummary?: string;
    fatalHint?: string;
  }) => {
    if (msg.type === 'VT_PROGRESS') {
      if (msg.languages?.length) {
        // ensure rows exist if background sends full list
        const list = progressRoot.querySelector('#vt-progress-list');
        if (list && !list.children.length) {
          for (const code of msg.languages) {
            list.append(makeLangRow(code));
          }
        }
      }
      const el = progressRoot.querySelector('#vt-progress');
      if (el) {
        if (msg.fatalSummary) {
          el.innerHTML = `<strong class="vt-err">${escapeHtml(msg.fatalSummary)}</strong>${
            msg.fatalHint ? `<div class="vt-hint">${escapeHtml(msg.fatalHint)}</div>` : ''
          }`;
        } else if (msg.status === 'running') {
          el.textContent = `Translating ${msg.language || '…'} (${(msg.index ?? 0) + 1}/${msg.total ?? '?'})…`;
        } else if (msg.status === 'ok') {
          el.textContent = `Done ${msg.language} (${(msg.index ?? 0) + 1}/${msg.total})`;
        } else if (msg.status === 'failed' && msg.language) {
          el.textContent = `Failed ${msg.language}`;
        }
      }
      if (msg.language && msg.status === 'running') setRow(msg.language, 'running');
      if (msg.language && msg.status === 'ok') setRow(msg.language, 'ok');
      if (msg.language && msg.status === 'failed') {
        setRow(msg.language, 'failed', msg.error, msg.errorDetail);
      }
    }
    if (msg.type === 'VT_STATUS') {
      const el = progressRoot.querySelector('#vt-progress');
      if (el && msg.message) el.textContent = msg.message;
    }
  };
  chrome.runtime.onMessage.addListener(onMsg);

  progressRoot.querySelector('#vt-stop')?.addEventListener('click', () => {
    stoppedByUser = true;
    const stopBtn = progressRoot.querySelector('#vt-stop') as HTMLButtonElement;
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping…';
    void chrome.runtime.sendMessage({ type: 'STOP_TRANSLATE' });
  });

  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'START_TRANSLATE',
      videoId,
      languages,
      skipExisting,
    })) as {
      ok: boolean;
      error?: string;
      dryRun?: boolean;
      skippedAll?: boolean;
      source?: { title: string; description: string; defaultLanguage?: string };
      results?: LocalizationResult[];
      failed?: { language: string; error: string }[];
      pending?: string[];
      stopReason?: string | null;
      fatalSummary?: string;
      fatalHint?: string;
    };

    if (!res?.ok) {
      progressRoot.remove();
      alert(`VeilTranslate: ${res?.error ?? 'Unknown error'}`);
      return;
    }

    if (res.skippedAll) {
      progressRoot.remove();
      alert(
        'All selected languages already have localizations (Skip existing is on). Switch to Overwrite to re-translate.',
      );
      return;
    }

    const results = [...(res.results ?? [])];
    const failed = res.failed ?? [];
    const stopReason = res.stopReason ?? null;

    // Fatal/circuit/abort with nothing translated → stay on progress with Retry
    if (
      !results.length &&
      (stopReason === 'fatal' || stopReason === 'circuit' || (stopReason === 'aborted' && !failed.length))
    ) {
      showJobStopped(progressRoot, {
        summary: res.fatalSummary ?? (stoppedByUser || stopReason === 'aborted' ? 'Stopped' : 'Job failed'),
        hint: res.fatalHint ?? (stopReason === 'aborted' ? 'No further requests will be sent.' : ''),
        failed,
        onRetry: () => {
          progressRoot.remove();
          void runTranslateFlow(videoId, languages, skipExisting, btn);
        },
        onClose: () => progressRoot.remove(),
        onRetryFailed: failed.length
          ? () => {
              progressRoot.remove();
              void runTranslateFlow(
                videoId,
                failed.map((f) => f.language),
                false,
                btn,
              );
            }
          : undefined,
      });
      return;
    }

    progressRoot.remove();

    // Partial success (stopped mid-job) still opens preview for successful rows
    await showPreviewModal({
      videoId,
      dryRun: !!res.dryRun,
      sourceTitle: res.source?.title ?? '',
      rows: results,
      failed,
      stopNote:
        stopReason === 'circuit'
          ? res.fatalSummary ?? 'Stopped: 3 languages failed in a row.'
          : stopReason === 'fatal'
            ? `${res.fatalSummary ?? 'Fatal error'}${res.fatalHint ? ` — ${res.fatalHint}` : ''}`
            : stopReason === 'aborted'
              ? 'Stopped by user. Successful translations below are still editable; Publish still requires an explicit click.'
              : undefined,
    });
  } catch (err) {
    progressRoot.remove();
    alert(`VeilTranslate: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    chrome.runtime.onMessage.removeListener(onMsg);
    btn.disabled = false;
  }
}

function makeLangRow(code: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'vt-lang-row';
  row.dataset.lang = code;
  row.dataset.status = 'pending';
  row.innerHTML = `
    <span class="vt-lang-code">${escapeHtml(code)}</span>
    <span class="vt-lang-status vt-muted">pending</span>
    <details style="display:none">
      <summary>Error</summary>
      <pre class="vt-err-detail"></pre>
    </details>`;
  return row;
}

function showProgressOverlay(languages: string[]): HTMLElement {
  removeModal();
  const root = document.createElement('div');
  root.id = 'vt-modal-root';
  root.innerHTML = `
    <div class="vt-panel">
      <h2>Translating…</h2>
      <div id="vt-progress">Checking API key / model…</div>
      <div id="vt-progress-list" class="vt-progress-list"></div>
      <div class="vt-actions">
        <button type="button" id="vt-stop">Stop</button>
      </div>
    </div>`;
  const list = root.querySelector('#vt-progress-list')!;
  for (const code of languages) list.append(makeLangRow(code));
  document.documentElement.appendChild(root);
  return root;
}

function showJobStopped(
  root: HTMLElement,
  opts: {
    summary: string;
    hint: string;
    failed: { language: string; error: string }[];
    onRetry: () => void;
    onClose: () => void;
    onRetryFailed?: () => void;
  },
) {
  const panel = root.querySelector('.vt-panel')!;
  const stopBtn = panel.querySelector('#vt-stop');
  stopBtn?.remove();
  const banner = document.createElement('div');
  banner.className = 'vt-banner vt-banner-err';
  banner.innerHTML = `<strong>${escapeHtml(opts.summary)}</strong>${
    opts.hint ? `<div class="vt-hint">${escapeHtml(opts.hint)}</div>` : ''
  }`;
  const progress = panel.querySelector('#vt-progress');
  if (progress) progress.replaceWith(banner);
  else panel.insertBefore(banner, panel.querySelector('#vt-progress-list'));

  let actions = panel.querySelector('.vt-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'vt-actions';
    panel.append(actions);
  }
  actions.innerHTML = `
    ${opts.onRetryFailed ? `<button type="button" class="primary" id="vt-retry-failed">Retry failed</button>` : ''}
    <button type="button" class="primary" id="vt-retry">Retry</button>
    <button type="button" id="vt-close">Close</button>`;
  actions.querySelector('#vt-retry')?.addEventListener('click', opts.onRetry);
  actions.querySelector('#vt-close')?.addEventListener('click', opts.onClose);
  actions.querySelector('#vt-retry-failed')?.addEventListener('click', () => opts.onRetryFailed?.());
}

async function showPreviewModal(opts: {
  videoId: string;
  dryRun: boolean;
  sourceTitle: string;
  rows: LocalizationResult[];
  failed: { language: string; error: string }[];
  stopNote?: string;
}): Promise<void> {
  removeModal();
  let dryRun = opts.dryRun;
  const root = document.createElement('div');
  root.id = 'vt-modal-root';
  document.documentElement.appendChild(root);

  let resolve!: () => void;
  const done = new Promise<void>((r) => {
    resolve = r;
  });

  let unbindKeys = () => {};
  const finish = () => {
    unbindKeys();
    root.remove();
    resolve();
  };

  const retryFailed = (langs: string[]) => {
    finish();
    const b = document.getElementById(BUTTON_ID) as HTMLButtonElement;
    const vid = getVideoId();
    if (vid) void runTranslateFlow(vid, langs, false, b);
  };

  const onPublish = async () => {
    if (dryRun) return;
    const localizations: LocalizationResult[] = [];
    root.querySelectorAll('tr[data-i]').forEach((tr) => {
      const i = Number((tr as HTMLElement).dataset.i);
      const lang = opts.rows[i].language;
      const title = (tr.querySelector('.vt-title') as HTMLInputElement).value;
      const description = (tr.querySelector('.vt-desc') as HTMLTextAreaElement).value;
      localizations.push({ language: lang, title, description });
    });

    const pubBtn = root.querySelector('#vt-publish') as HTMLButtonElement;
    pubBtn.disabled = true;
    pubBtn.textContent = 'Publishing…';
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'PUBLISH',
        videoId: opts.videoId,
        localizations,
      })) as { ok: boolean; error?: string; published?: string[] };

      showResult(root, {
        published: res?.ok ? (res.published ?? []) : [],
        failed: res?.ok
          ? opts.failed
          : localizations.map((l) => ({
              language: l.language,
              error: res?.error ?? 'unknown',
            })),
        error: res?.ok ? undefined : res?.error,
        onClose: finish,
        onRetry: retryFailed,
      });
    } catch (err) {
      showResult(root, {
        published: [],
        failed: opts.rows.map((l) => ({
          language: l.language,
          error: err instanceof Error ? err.message : String(err),
        })),
        onClose: finish,
        onRetry: retryFailed,
      });
    }
  };

  const paint = () => {
    const tableRows = opts.rows
      .map((r, i) => {
        const w = charWarning(r.title, r.description);
        return `<tr data-i="${i}">
          <td>${escapeHtml(r.language)}</td>
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

    const failedNote = opts.failed.length
      ? `Failed: ${opts.failed.map((f) => `${f.language} (${f.error})`).join('; ')}`
      : '';

    root.innerHTML = `
      <div class="vt-panel">
        <h2>Preview translations</h2>
        <div class="vt-banner vt-banner-dry" style="display:${dryRun ? 'block' : 'none'}">
          Dry-run ON — Publish disabled. Uncheck below to enable publishing.
        </div>
        ${
          opts.stopNote
            ? `<div class="vt-banner vt-banner-err">${escapeHtml(opts.stopNote)}</div>`
            : ''
        }
        <div class="vt-meta">
          Video: ${escapeHtml(opts.videoId)} · Source: ${escapeHtml(opts.sourceTitle.slice(0, 80))}
          ${failedNote ? `<br/>${escapeHtml(failedNote)}` : ''}
        </div>
        <label class="vt-check vt-dry-inline">
          <input type="checkbox" id="vt-dry-preview" ${dryRun ? 'checked' : ''}/> Dry-run (preview only)
        </label>
        <table>
          <thead><tr><th>Language</th><th>Title</th><th>Description</th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="3">No translations</td></tr>'}</tbody>
        </table>
        <div class="vt-actions">
          <button type="button" id="vt-cancel">${opts.failed.length ? 'Close' : 'Cancel'}</button>
          ${
            opts.failed.length
              ? `<button type="button" id="vt-retry-failed">Retry ${opts.failed.length} failed</button>`
              : ''
          }
          <button type="button" class="primary" id="vt-publish" ${
            dryRun || !opts.rows.length ? 'disabled' : ''
          }>Publish</button>
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

    root.querySelector('#vt-dry-preview')!.addEventListener('change', async (e) => {
      dryRun = (e.target as HTMLInputElement).checked;
      await chrome.runtime.sendMessage({
        type: 'PATCH_SETTINGS',
        partial: { dryRun },
      });
      paint();
    });
    root.querySelector('#vt-cancel')!.addEventListener('click', finish);
    root.querySelector('#vt-retry-failed')?.addEventListener('click', () => {
      retryFailed(opts.failed.map((f) => f.language));
    });
    root.querySelector('#vt-publish')!.addEventListener('click', () => void onPublish());
  };

  if (!opts.rows.length && opts.failed.length) {
    root.innerHTML = `<div class="vt-panel"></div>`;
    showResult(root, {
      published: [],
      failed: opts.failed,
      onClose: finish,
      onRetry: retryFailed,
    });
  } else {
    paint();
  }

  unbindKeys = bindKeys({
    onEsc: finish,
    onEnter: () => {
      const pub = root.querySelector('#vt-publish') as HTMLButtonElement | null;
      if (pub && !pub.disabled) void onPublish();
      const retry = root.querySelector('#vt-retry-failed') as HTMLButtonElement | null;
      if (retry) retry.click();
    },
  });

  await done;
}

function showResult(
  root: HTMLElement,
  opts: {
    published: string[];
    failed: { language: string; error: string }[];
    error?: string;
    onClose: () => void;
    onRetry: (langs: string[]) => void;
  },
) {
  const panel = root.querySelector('.vt-panel') ?? root;
  const target = panel.classList?.contains('vt-panel')
    ? panel
    : (() => {
        root.innerHTML = `<div class="vt-panel"></div>`;
        return root.querySelector('.vt-panel')!;
      })();

  target.innerHTML = `
    <h2>Result</h2>
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
    <div class="vt-actions">
      ${
        opts.failed.length
          ? `<button type="button" class="primary" id="vt-retry-failed">Retry ${opts.failed.length} failed</button>`
          : ''
      }
      <button type="button" id="vt-done">Done</button>
    </div>`;

  target.querySelector('#vt-done')?.addEventListener('click', opts.onClose);
  target.querySelector('#vt-retry-failed')?.addEventListener('click', () => {
    opts.onRetry(opts.failed.map((f) => f.language));
  });
}

let lastUrl = location.href;
function watchSpa() {
  ensureButton();
  const obs = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      ensureButton();
    } else {
      ensureButton();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      ensureButton();
    }
  }, 1000);
}

watchSpa();
