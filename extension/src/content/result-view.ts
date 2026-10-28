import { jobHasOpenWork, type TranslateJob } from '@shared/job';
import { escapeHtml } from '../ui/html';
import { icon } from '../ui/icons';
import type { JobUiActions } from './actions';
import { $req, bindModalChrome, panelHeadHtml } from './dom';

export type PublishOutcome = {
  videoId: string;
  published: string[];
  failed: { language: string; error: string }[];
  error?: string;
};

function codeBadges(codes: string[]): string {
  return codes.map((c) => `<span class="ytl-badge ytl-badge--accent ytl-code">${escapeHtml(c)}</span>`).join('');
}

/** Publish result. Stays on screen while job updates arrive (see `syncResultPanel`). */
export function showResultPanel(
  root: HTMLElement,
  actions: JobUiActions,
  opts: PublishOutcome,
): void {
  const nothing = !opts.published.length && !opts.failed.length;
  const title = opts.failed.length || opts.error ? 'Published with errors' : 'Published';
  root.dataset.mode = 'result';
  root.innerHTML = `
    <div class="vt-panel vt-panel--sm" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      ${panelHeadHtml({ title: nothing ? 'Nothing published' : title })}
      <div class="vt-body">
        <div class="vt-result" role="status">
          ${
            opts.error
              ? `<div class="ytl-notice ytl-notice--error" role="alert">${icon('error')}<span>${escapeHtml(opts.error)}</span></div>`
              : ''
          }
          ${
            opts.published.length
              ? `<div class="ytl-notice">${icon('checkCircle')}
                  <div class="ytl-notice__body">
                    <span><strong>${opts.published.length}</strong> localization${
                      opts.published.length === 1 ? '' : 's'
                    } live on YouTube</span>
                    <div class="vt-result-list">${codeBadges(opts.published)}</div>
                  </div>
                </div>`
              : ''
          }
          ${
            opts.failed.length
              ? `<div class="ytl-notice ytl-notice--error">${icon('error')}
                  <div class="ytl-notice__body">
                    <span><strong>${opts.failed.length}</strong> failed</span>
                    <ul class="vt-result-errors">${opts.failed
                      .map(
                        (f) =>
                          `<li><span class="ytl-code">${escapeHtml(f.language)}</span> · ${escapeHtml(f.error)}</li>`,
                      )
                      .join('')}</ul>
                  </div>
                </div>`
              : ''
          }
          ${nothing ? '<p class="ytl-muted">No localizations were sent to YouTube.</p>' : ''}
        </div>
      </div>
      <footer class="vt-footer">
        <div class="vt-footer-summary"></div>
        <div class="vt-footer-actions">
          ${
            opts.failed.length
              ? `<button type="button" class="ytl-btn" id="vt-retry-failed">Retry ${opts.failed.length} failed</button>`
              : ''
          }
          <button type="button" class="ytl-btn" id="vt-back" hidden>Back to preview</button>
          <button type="button" class="ytl-btn" id="vt-new">New session</button>
          <button type="button" class="ytl-btn ytl-btn--primary" id="vt-minimize">Close</button>
        </div>
      </footer>
    </div>`;
  bindModalChrome({ root, onClose: actions.close });
  $req(root, '#vt-x').addEventListener('click', actions.close);
  $req(root, '#vt-minimize').addEventListener('click', actions.close);
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
