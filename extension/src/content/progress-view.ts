import {
  jobAutoApproved,
  jobEta,
  jobFailed,
  jobPercent,
  type TranslateJob,
} from '@shared/job';
import { autoApprovedSummary } from '@shared/review';
import { engineLabel, escapeAttr, escapeHtml } from '../ui/html';
import { icon } from '../ui/icons';
import type { JobUiActions } from './actions';
import { sendMsg, setAutoApprove } from './api';
import {
  $req,
  bindModalChrome,
  ensureModalRoot,
  getModalRoot,
  modalMode,
  panelHeadHtml,
  removeModal,
} from './dom';
import { AUTO_APPROVE_HINT, AUTO_APPROVE_LABEL } from './labels';
import { langRowState, statusBadge } from './status';

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

function langRowHtml(code: string, job: TranslateJob): string {
  const s = job.langStates[code];
  const eng = s?.note || engineLabel(s?.engine, s?.model);
  const rowState = langRowState(s);
  const errBlock =
    s?.status === 'failed' && (s?.error || s?.errorDetail)
      ? `<details open><summary>${escapeHtml(s.error ?? 'Error')}</summary><pre class="vt-err-detail">${escapeHtml(s.errorDetail ?? s.error ?? '')}</pre></details>`
      : '';
  return `<div class="vt-lang-row" role="listitem" data-lang="${escapeAttr(code)}" data-state="${rowState}">
    <span class="vt-row-code">${escapeHtml(code)}</span>
    <span class="vt-row-engine" title="${escapeAttr(eng)}">${escapeHtml(eng)}</span>
    <span class="vt-row-status">${statusBadge(rowState)}</span>
    ${errBlock}
  </div>`;
}

function countText(job: TranslateJob): string {
  const auto = autoApprovedSummary(jobAutoApproved(job).length);
  return `${job.doneCount}/${job.totalCount} done${auto ? ` · ${auto}` : ''}`;
}

function fatalHtml(job: TranslateJob): string {
  if (!job.fatalSummary || job.phase === 'running') return '';
  return `${icon('error')}
    <div class="ytl-notice__body">
      <strong>${escapeHtml(job.fatalSummary)}</strong>
      ${job.fatalHint ? `<span class="ytl-notice__hint">${escapeHtml(job.fatalHint)}</span>` : ''}
    </div>`;
}

function buildProgressShell(root: HTMLElement, job: TranslateJob, actions: JobUiActions) {
  const pct = jobPercent(job);
  const eta = jobEta(job);
  const rows = job.languages.map((code) => langRowHtml(code, job)).join('');
  const running = job.phase === 'running';
  const fatal = fatalHtml(job);

  root.innerHTML = `
    <div class="vt-panel vt-panel--md" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      ${panelHeadHtml({
        title: running ? 'Translating…' : 'Translation job',
        subtitle: job.sourceTitle?.slice(0, 90),
        closeLabel: running ? 'Minimize' : 'Close',
      })}
      <div class="vt-notices">
        ${
          job.autoPublish && !job.dryRun
            ? `<div class="ytl-notice">${icon('info')}<span>Auto-publish is on — translations go live on YouTube as they finish.</span></div>`
            : ''
        }
        <div class="ytl-notice ytl-notice--error" id="vt-fatal" role="alert" ${fatal ? '' : 'hidden'}>${fatal}</div>
      </div>
      <div class="vt-toolbar">
        <div class="vt-toolbar-row">
          <div class="vt-progress-stats" id="vt-progress-meta">
            <span class="vt-progress-pct" data-k="pct">${pct}%</span>
            <span data-k="count">${escapeHtml(countText(job))}</span>
            <span class="ytl-muted" data-k="eta">${eta ? escapeHtml(eta) : ''}</span>
          </div>
          <span class="vt-toolbar-spacer"></span>
          <span class="vt-engine">Engine <span class="ytl-code" data-k="eng">${
            job.engine ? escapeHtml(engineLabel(job.engine, job.model)) : '—'
          }</span></span>
        </div>
        <div class="ytl-progress" id="vt-progress-bar" role="progressbar" aria-label="Translation progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="ytl-progress__fill" data-phase="${job.phase}" style="width:${pct}%"></div>
        </div>
        <label class="ytl-toggle ytl-toggle--compact" title="${escapeAttr(AUTO_APPROVE_HINT)}">
          <input type="checkbox" role="switch" class="ytl-switch" id="vt-autoapprove-job" ${job.autoApprove ? 'checked' : ''}/>
          <span>${AUTO_APPROVE_LABEL}</span>
        </label>
      </div>
      <div class="vt-body vt-body--flush">
        <div id="vt-progress-list" class="vt-progress-list" role="list" aria-label="Languages">${rows}</div>
      </div>
      <footer class="vt-footer">
        <div class="vt-footer-summary" id="vt-job-summary"></div>
        <div class="vt-footer-actions" id="vt-job-footer"></div>
      </footer>
    </div>`;

  bindModalChrome({ root, onClose: actions.close });
  $req(root, '#vt-x').addEventListener('click', actions.close);
  $req(root, '#vt-autoapprove-job').addEventListener('change', (e) => {
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
      : '—';
  }
  root.querySelector('#vt-progress-bar')?.setAttribute('aria-valuenow', String(pct));
  const fill = root.querySelector<HTMLElement>('#vt-progress-bar .ytl-progress__fill');
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.dataset.phase = job.phase;
  }
  const fatal = root.querySelector<HTMLElement>('#vt-fatal');
  if (fatal) {
    const html = fatalHtml(job);
    fatal.innerHTML = html;
    fatal.hidden = !html;
  }

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

  const closeLabel = job.phase === 'running' ? 'Minimize' : 'Close';
  root.querySelector('#vt-x')?.setAttribute('aria-label', closeLabel);
  root.querySelector('#vt-x')?.setAttribute('title', `${closeLabel} (Esc)`);

  wireJobFooter(root, job, actions);
}

function wireJobFooter(root: HTMLElement, job: TranslateJob, actions: JobUiActions) {
  const failed = jobFailed(job);
  const footer = root.querySelector('#vt-job-footer');
  if (!footer) return;
  const summary = root.querySelector('#vt-job-summary');
  if (summary) {
    summary.innerHTML =
      job.phase === 'running'
        ? 'Runs in the background — minimize to keep working in Studio.'
        : failed.length
          ? `<strong>${failed.length}</strong> failed`
          : '';
  }
  if (job.phase === 'running') {
    footer.innerHTML = `
      <button type="button" class="ytl-btn ytl-btn--danger" id="vt-stop">Stop</button>
      <button type="button" class="ytl-btn ytl-btn--primary" id="vt-minimize">Minimize</button>`;
  } else {
    footer.innerHTML = `
      ${
        failed.length
          ? `<button type="button" class="ytl-btn" id="vt-retry-failed">Retry ${failed.length} failed</button>`
          : ''
      }
      <button type="button" class="ytl-btn" id="vt-new">New session</button>
      <button type="button" class="ytl-btn ytl-btn--primary" id="vt-minimize">Close</button>`;
  }
  footer.querySelector('#vt-minimize')?.addEventListener('click', actions.close);
  footer.querySelector('#vt-new')?.addEventListener('click', actions.newSession);
  const stop = footer.querySelector<HTMLButtonElement>('#vt-stop');
  stop?.addEventListener('click', () => {
    stop.disabled = true;
    stop.setAttribute('aria-busy', 'true');
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
