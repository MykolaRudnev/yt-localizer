import { jobHasOpenWork, type TranslateJob } from '@shared/job';
import { escapeHtml } from '../ui/html';
import type { JobUiActions } from './actions';
import { bindModalChrome } from './dom';

export type PublishOutcome = {
  videoId: string;
  published: string[];
  failed: { language: string; error: string }[];
  error?: string;
};

/** Publish result. Stays on screen while job updates arrive (see `syncResultPanel`). */
export function showResultPanel(
  root: HTMLElement,
  actions: JobUiActions,
  opts: PublishOutcome,
): void {
  root.dataset.mode = 'result';
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
        <button type="button" id="vt-back" hidden>Back to preview</button>
        <button type="button" id="vt-new">New session</button>
        <button type="button" class="primary" id="vt-minimize">Close</button>
      </div>
    </div>`;
  bindModalChrome({ root, onClose: actions.close });
  root.querySelector('#vt-x')!.addEventListener('click', actions.close);
  root.querySelector('#vt-minimize')!.addEventListener('click', actions.close);
  root.querySelector('#vt-new')?.addEventListener('click', actions.newSession);
  root.querySelector('#vt-back')?.addEventListener('click', actions.backToPreview);
  root.querySelector('#vt-retry-failed')?.addEventListener('click', () => {
    actions.retry(opts.videoId, opts.failed.map((f) => f.language));
  });
}

/** Offer "Back to preview" while rows are still unpublished or awaiting review. */
export function syncResultPanel(root: HTMLElement, job: TranslateJob | null): void {
  const back = root.querySelector<HTMLElement>('#vt-back');
  if (back) back.hidden = !job || !jobHasOpenWork(job);
}
