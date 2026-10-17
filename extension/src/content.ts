import './content.css';
import type { LocalizationResult } from '@shared/types';
import { charWarning } from '@shared/text';

const BUTTON_ID = 'veil-translate-btn';
const VIDEO_PATH_RE = /\/video\/([^/]+)\/(edit|translations)(?:\/|$|\?)/;

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
    btn.textContent = 'Translate';
    btn.addEventListener('click', () => void onTranslateClick());
    document.documentElement.appendChild(btn);
  }
}

async function onTranslateClick() {
  const videoId = getVideoId();
  if (!videoId) return;

  const btn = document.getElementById(BUTTON_ID) as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Translating…';

  const progressRoot = showProgressOverlay();

  const onMsg = (msg: {
    type?: string;
    language?: string;
    index?: number;
    total?: number;
    status?: string;
    message?: string;
  }) => {
    if (msg.type === 'VT_PROGRESS') {
      const el = progressRoot.querySelector('#vt-progress');
      if (el) {
        el.textContent =
          msg.status === 'running'
            ? `Translating ${msg.language || '…'} (${(msg.index ?? 0) + 1}/${msg.total ?? '?'})…`
            : msg.status === 'ok'
              ? `Done ${msg.language} (${(msg.index ?? 0) + 1}/${msg.total})`
              : `Failed ${msg.language}: ${msg.status}`;
      }
    }
    if (msg.type === 'VT_STATUS') {
      const el = progressRoot.querySelector('#vt-progress');
      if (el && msg.message) el.textContent = msg.message;
    }
  };
  chrome.runtime.onMessage.addListener(onMsg);

  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'START_TRANSLATE',
      videoId,
    })) as {
      ok: boolean;
      error?: string;
      dryRun?: boolean;
      source?: { title: string; description: string; defaultLanguage?: string };
      results?: LocalizationResult[];
      failed?: { language: string; error: string }[];
    };

    progressRoot.remove();

    if (!res?.ok) {
      alert(`VeilTranslate: ${res?.error ?? 'Unknown error'}`);
      return;
    }

    const rows = [...(res.results ?? [])];
    const failedNote =
      res.failed && res.failed.length
        ? `Failed: ${res.failed.map((f) => `${f.language} (${f.error})`).join('; ')}`
        : '';

    await showPreviewModal({
      videoId,
      dryRun: !!res.dryRun,
      sourceTitle: res.source?.title ?? '',
      rows,
      failedNote,
    });
  } catch (err) {
    progressRoot.remove();
    alert(`VeilTranslate: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    chrome.runtime.onMessage.removeListener(onMsg);
    btn.disabled = false;
    btn.textContent = 'Translate';
  }
}

function showProgressOverlay(): HTMLElement {
  document.getElementById('vt-modal-root')?.remove();
  const root = document.createElement('div');
  root.id = 'vt-modal-root';
  root.innerHTML = `
    <div class="vt-panel">
      <h2>VeilTranslate</h2>
      <div id="vt-progress">Starting…</div>
    </div>`;
  document.documentElement.appendChild(root);
  return root;
}

async function showPreviewModal(opts: {
  videoId: string;
  dryRun: boolean;
  sourceTitle: string;
  rows: LocalizationResult[];
  failedNote: string;
}): Promise<void> {
  document.getElementById('vt-modal-root')?.remove();
  const root = document.createElement('div');
  root.id = 'vt-modal-root';

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

  root.innerHTML = `
    <div class="vt-panel">
      <h2>Preview translations</h2>
      <div class="vt-meta">
        Video: ${escapeHtml(opts.videoId)} · Source: ${escapeHtml(opts.sourceTitle.slice(0, 80))}
        ${opts.dryRun ? ' · <strong>Dry-run ON</strong> (Publish disabled)' : ''}
        ${opts.failedNote ? `<br/>${escapeHtml(opts.failedNote)}` : ''}
      </div>
      <table>
        <thead><tr><th>Language</th><th>Title</th><th>Description</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="3">No translations</td></tr>'}</tbody>
      </table>
      <div class="vt-actions">
        <button type="button" id="vt-cancel">Cancel</button>
        <button type="button" class="primary" id="vt-publish" ${opts.dryRun || !opts.rows.length ? 'disabled' : ''}>Publish</button>
      </div>
      <div id="vt-result" class="vt-meta"></div>
    </div>`;

  document.documentElement.appendChild(root);

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

  await new Promise<void>((resolve) => {
    const close = () => {
      root.remove();
      resolve();
    };

    root.querySelector('#vt-cancel')!.addEventListener('click', close);

    root.querySelector('#vt-publish')!.addEventListener('click', async () => {
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
        const result = root.querySelector('#vt-result')!;
        if (res?.ok) {
          result.textContent = `OK: ${(res.published ?? []).join(', ')}`;
          setTimeout(close, 1500);
        } else {
          result.textContent = `Failed: ${res?.error ?? 'unknown'}`;
          pubBtn.disabled = false;
          pubBtn.textContent = 'Publish';
        }
      } catch (err) {
        (root.querySelector('#vt-result') as HTMLElement).textContent =
          `Failed: ${err instanceof Error ? err.message : String(err)}`;
        pubBtn.disabled = false;
        pubBtn.textContent = 'Publish';
      }
    });
  });
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
