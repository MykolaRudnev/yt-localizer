import {
  jobAutoApproved,
  jobEta,
  jobFailed,
  jobPercent,
  type LangJobState,
  type TranslateJob,
} from '@shared/job';
import { autoApprovedSummary } from '@shared/review';
import { engineLabel, escapeAttr, escapeHtml } from '../ui/html';
import type { JobUiActions } from './actions';
import { sendMsg, setAutoApprove } from './api';
import { bindModalChrome, ensureModalRoot, getModalRoot, modalMode, removeModal } from './dom';
import { AUTO_APPROVE_HINT, AUTO_APPROVE_LABEL } from './labels';

/** Per-language progress list while a job runs (and after it fails with no preview rows). */
export function renderProgress(job: TranslateJob, actions: JobUiActions): void {
  const root = getModalRoot();
  if (root && modalMode(root) === 'progress' && root.querySelector('#vt-progress-list')) {
    patchProgressDom(root, job, actions);
    return;
  }
  removeModal();
  buildProgressShell(ensureModalRoot('progress'), job, actions);
}

function statusLabel(s: LangJobState | undefined): string {
  switch (s?.status ?? 'pending') {
    case 'pending':
      return 'pending';
    case 'running':
      return '…';
    case 'needs_review':
      return 'review';
    case 'ok':
      if (s?.published) return 'live';
      if (s?.autoApproved) return 'auto-approved';
      return s?.cached ? 'cached' : 'ok';
    case 'skipped':
      return 'skip';
    default:
      return 'failed';
  }
}

function langRowHtml(code: string, job: TranslateJob): string {
  const s = job.langStates[code];
  const status = s?.status ?? 'pending';
  const eng = s?.note || engineLabel(s?.engine, s?.model);
  const errBlock =
    status === 'failed' && (s?.error || s?.errorDetail)
      ? `<details open><summary>${escapeHtml(s.error ?? 'Error')}</summary><pre class="vt-err-detail">${escapeHtml(s.errorDetail ?? s.error ?? '')}</pre></details>`
      : '';
  return `<div class="vt-lang-row" data-lang="${escapeAttr(code)}" data-status="${status}">
    <span class="vt-lang-code">${escapeHtml(code)}</span>
    <span class="vt-lang-engine vt-muted" title="${escapeAttr(eng)}">${escapeHtml(eng)}</span>
    <span class="vt-lang-status vt-${status === 'ok' ? 'ok' : status === 'failed' ? 'err' : 'muted'}">${statusLabel(s)}</span>
    ${errBlock}
  </div>`;
}

function countText(job: TranslateJob): string {
  const auto = autoApprovedSummary(jobAutoApproved(job).length);
  return `${job.doneCount}/${job.totalCount}${auto ? ` · ${auto}` : ''}`;
}

function buildProgressShell(root: HTMLElement, job: TranslateJob, actions: JobUiActions) {
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
          <span data-k="count">${escapeHtml(countText(job))}</span>
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
      <label class="vt-check vt-dry-inline" title="${escapeAttr(AUTO_APPROVE_HINT)}">
        <input type="checkbox" id="vt-autoapprove-job" ${job.autoApprove ? 'checked' : ''}/> ${AUTO_APPROVE_LABEL}
      </label>
      <div id="vt-progress-list" class="vt-progress-list">${rows}</div>
      <div class="vt-footer sticky" id="vt-job-footer"></div>
    </div>`;

  bindModalChrome({ root, onClose: actions.close });
  root.querySelector('#vt-x')!.addEventListener('click', actions.close);
  root.querySelector('#vt-autoapprove-job')!.addEventListener('change', (e) => {
    void setAutoApprove((e.target as HTMLInputElement).checked).then(actions.applyJob);
  });
  wireJobFooter(root, job, actions);
}

function patchProgressDom(root: HTMLElement, job: TranslateJob, actions: JobUiActions) {
  const pct = jobPercent(job);
  const eta = jobEta(job);
  const meta = root.querySelector('#vt-progress-meta');
  if (meta) {
    meta.querySelector('[data-k="pct"]')!.textContent = `${pct}%`;
    meta.querySelector('[data-k="count"]')!.textContent = countText(job);
    meta.querySelector('[data-k="eta"]')!.textContent = eta ?? '';
    meta.querySelector('[data-k="eng"]')!.textContent = job.engine
      ? engineLabel(job.engine, job.model)
      : '';
  }
  root.querySelector('.vt-progress-track')?.setAttribute('aria-valuenow', String(pct));
  const fill = root.querySelector<HTMLElement>('.vt-progress-fill');
  if (fill) fill.style.width = `${pct}%`;

  const title = root.querySelector('#vt-title');
  if (title) title.textContent = job.phase === 'running' ? 'Translating…' : 'Translation job';

  const list = root.querySelector('#vt-progress-list');
  if (list) {
    for (const code of job.languages) {
      const row = list.querySelector(`[data-lang="${CSS.escape(code)}"]`);
      if (!row) continue;
      const wrap = document.createElement('div');
      wrap.innerHTML = langRowHtml(code, job);
      row.replaceWith(wrap.firstElementChild!);
    }
  }

  const autoApprove = root.querySelector<HTMLInputElement>('#vt-autoapprove-job');
  if (autoApprove) autoApprove.checked = job.autoApprove === true;

  root
    .querySelector('#vt-x')
    ?.setAttribute('aria-label', job.phase === 'running' ? 'Minimize' : 'Close');

  wireJobFooter(root, job, actions);
}

function wireJobFooter(root: HTMLElement, job: TranslateJob, actions: JobUiActions) {
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
  footer.querySelector('#vt-minimize')?.addEventListener('click', actions.close);
  footer.querySelector('#vt-new')?.addEventListener('click', actions.newSession);
  const stop = footer.querySelector<HTMLButtonElement>('#vt-stop');
  stop?.addEventListener('click', () => {
    stop.disabled = true;
    stop.textContent = 'Stopping…';
    void sendMsg({ type: 'STOP_TRANSLATE' });
  });
  footer.querySelector('#vt-retry-failed')?.addEventListener('click', () => {
    actions.retry(
      job.videoId,
      failed.map((f) => f.language),
    );
  });
}
