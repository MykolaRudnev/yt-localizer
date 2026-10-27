import {
  jobAutoApproved,
  jobFailed,
  jobPreviewRows,
  jobPublishCounts,
  publishButtonLabel,
  type ReviewAction,
  type TranslateJob,
} from '@shared/job';
import { autoApprovedSummary } from '@shared/review';
import { charWarning, titleRemovalDiff, YT_DESCRIPTION_MAX, YT_TITLE_MAX } from '@shared/text';
import type { LocalizationResult } from '@shared/types';
import type { JobResponse, PublishResponse } from '../protocol';
import { escapeAttr, escapeHtml } from '../ui/html';
import type { JobUiActions } from './actions';
import { confirmAutoPublish, sendMsg, setAutoApprove } from './api';
import { $req, bindModalChrome, ensureModalRoot, modalMode } from './dom';
import { AUTO_APPROVE_HINT, AUTO_APPROVE_LABEL } from './labels';
import { showResultPanel, syncResultPanel } from './result-view';

/**
 * Editable preview of finished translations + Publish.
 *
 * Job updates arrive on every keystroke (title edits go through REVIEW_LANG and
 * are broadcast back), so when the same rows are already on screen the view is
 * patched in place instead of re-rendered — focus, caret and unsaved
 * description edits survive.
 */

type PreviewState = {
  jobId: string;
  dryRun: boolean;
  autoPublish: boolean;
  /** Unsaved description edits by language (descriptions are not stored in the job). */
  descriptionDrafts: Map<string, string>;
};

let state: PreviewState | null = null;
/** Latest job snapshot for event handlers (updated on every render/patch). */
let latestJob: TranslateJob | null = null;

function stateFor(job: TranslateJob): PreviewState {
  if (!state || state.jobId !== job.id) {
    state = {
      jobId: job.id,
      dryRun: job.dryRun,
      autoPublish: job.autoPublish === true,
      descriptionDrafts: new Map(),
    };
  }
  return state;
}

function rowKey(job: TranslateJob): string {
  return jobPreviewRows(job)
    .map((r) => r.language)
    .join(',');
}

export function renderPreview(job: TranslateJob, actions: JobUiActions): void {
  const root = ensureModalRoot();
  latestJob = job;
  const st = stateFor(job);
  if (
    modalMode(root) === 'preview' &&
    root.dataset.jobId === job.id &&
    root.dataset.rows === rowKey(job)
  ) {
    patchPreview(root, job, st);
    return;
  }
  paintPreview(root, job, st, actions);
}

function rowLanguageBadge(job: TranslateJob, language: string): string {
  const s = job.langStates[language];
  if (s?.published) return ' · live';
  if (s?.status === 'needs_review') return ' · needs review';
  if (s?.cached) return ' · cached';
  return '';
}

function diffHtml(fullTitle: string, fittedTitle: string): string {
  return titleRemovalDiff(fullTitle, fittedTitle)
    .map((p) => (p.removed ? `<span class="vt-strike">${escapeHtml(p.text)}</span>` : escapeHtml(p.text)))
    .join('');
}

function rowHtml(r: LocalizationResult, i: number, job: TranslateJob, st: PreviewState): string {
  const s = job.langStates[r.language];
  const title = s?.title ?? r.title;
  const description = st.descriptionDrafts.get(r.language) ?? s?.description ?? r.description;
  const fullTitle = s?.fullTitle ?? r.fullTitle ?? title;
  const shortened = !!(s?.shortened ?? r.shortened);
  const needsReview = s?.status === 'needs_review';
  const w = charWarning(title, description);
  const removedChars = Math.max(0, fullTitle.length - title.length);
  const lang = escapeAttr(r.language);
  const shortenBadge = shortened
    ? `<span class="vt-shortened-badge">shortened −${removedChars} chars</span>`
    : '';
  const autoBadge = `<span class="vt-auto-approved-badge" title="Approved automatically (Auto-approve is ON)"${
    s?.autoApproved && s.status === 'ok' ? '' : ' hidden'
  }>auto-approved</span>`;
  const expander = shortened
    ? `<details class="vt-shorten-details">
        <summary>Show full translation</summary>
        <div class="vt-full-diff">${diffHtml(fullTitle, s?.autoTitle ?? title)}</div>
        <div class="vt-review-actions">
          <button type="button" class="vt-approve" data-lang="${lang}">Approve</button>
          <button type="button" class="vt-use-full" data-lang="${lang}">Use full</button>
          <button type="button" class="vt-reset" data-lang="${lang}">Reset</button>
        </div>
      </details>`
    : '';
  const counterClass = title.length > YT_TITLE_MAX ? 'vt-counter vt-counter-over' : 'vt-counter';
  return `<tr data-i="${i}" data-lang="${lang}" class="${needsReview ? 'vt-needs-review' : ''}">
      <td>${escapeHtml(r.language)}<span class="vt-row-badge">${escapeHtml(rowLanguageBadge(job, r.language))}</span></td>
      <td>
        ${shortenBadge}
        ${autoBadge}
        <input class="vt-title" value="${escapeAttr(title)}" maxlength="${
          // Allow Use full to exceed; maxlength only when not forcing full
          title.length > YT_TITLE_MAX ? 500 : YT_TITLE_MAX
        }" />
        <div class="${counterClass}">${title.length}/${YT_TITLE_MAX}</div>
        ${expander}
        <div class="warn vt-title-warn" style="display:${
          w.titleOver ? 'block' : 'none'
        }">Title &gt; ${YT_TITLE_MAX} (${title.length})</div>
      </td>
      <td>
        <textarea class="vt-desc" rows="4">${escapeHtml(description)}</textarea>
        <div class="warn vt-desc-warn" style="display:${
          w.descOver ? 'block' : 'none'
        }">Description &gt; ${YT_DESCRIPTION_MAX} (${description.length})</div>
      </td>
    </tr>`;
}

function autoPublishBannerText(job: TranslateJob): string {
  return job.autoApprove
    ? 'Auto-publish ON — ready rows go live as they finish (shortened titles are auto-approved)'
    : 'Auto-publish ON — ready rows go live as they finish (shortened titles wait for review)';
}

function summaryText(job: TranslateJob): string {
  const auto = autoApprovedSummary(jobAutoApproved(job).length);
  return auto ? ` · ${auto}` : '';
}

function paintPreview(
  root: HTMLElement,
  job: TranslateJob,
  st: PreviewState,
  actions: JobUiActions,
): void {
  const rows = jobPreviewRows(job);
  const failed = jobFailed(job);
  const counts = jobPublishCounts(job);
  const failedNote = failed.length
    ? `Failed: ${failed.map((f) => `${f.language} (${f.error})`).join('; ')}`
    : '';
  const stopNote =
    job.phase === 'stopped'
      ? 'Stopped. Successful translations below are still editable / publishable.'
      : (job.fatalSummary ?? '');

  root.dataset.mode = 'preview';
  root.dataset.jobId = job.id;
  root.dataset.rows = rowKey(job);
  root.innerHTML = `
    <div class="vt-panel vt-job" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      <div class="vt-panel-head">
        <h2 id="vt-title">Preview translations</h2>
        <div class="vt-head-actions">
          <button type="button" class="vt-icon-btn" id="vt-x" aria-label="Close">×</button>
        </div>
      </div>
      <div class="vt-banner vt-banner-dry" id="vt-dry-banner" style="display:${st.dryRun ? 'block' : 'none'}">
        Dry-run ON — Publish disabled. Uncheck below to enable publishing.
      </div>
      <div class="vt-banner vt-banner-live" id="vt-auto-banner" style="display:${
        st.autoPublish && !st.dryRun ? 'block' : 'none'
      }">${escapeHtml(autoPublishBannerText(job))}</div>
      ${stopNote ? `<div class="vt-banner vt-banner-err">${escapeHtml(stopNote)}</div>` : ''}
      <div class="vt-meta">
        Video: ${escapeHtml(job.videoId)} · Source: ${escapeHtml((job.sourceTitle ?? '').slice(0, 80))}<span id="vt-auto-summary">${escapeHtml(summaryText(job))}</span>
        ${failedNote ? `<br/>${escapeHtml(failedNote)}` : ''}
      </div>
      <label class="vt-check vt-dry-inline">
        <input type="checkbox" id="vt-dry-preview" ${st.dryRun ? 'checked' : ''}/> Dry-run (preview only)
      </label>
      <label class="vt-check vt-dry-inline">
        <input type="checkbox" id="vt-auto-preview" ${st.autoPublish ? 'checked' : ''}/> Auto-publish
      </label>
      <label class="vt-check vt-dry-inline" title="${escapeAttr(AUTO_APPROVE_HINT)}">
        <input type="checkbox" id="vt-autoapprove-preview" ${job.autoApprove ? 'checked' : ''}/> ${AUTO_APPROVE_LABEL}
      </label>
      <div class="vt-table-wrap">
        <table>
          <thead><tr><th>Language</th><th>Title</th><th>Description</th></tr></thead>
          <tbody>${rows.map((r, i) => rowHtml(r, i, job, st)).join('') || '<tr><td colspan="3">No translations</td></tr>'}</tbody>
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
          st.dryRun || counts.ready === 0 ? 'class="primary"' : ''
        } id="vt-minimize">Close</button>
        <button type="button" class="primary" id="vt-publish" ${
          st.dryRun || counts.ready === 0 ? 'disabled' : ''
        }>${escapeHtml(publishButtonLabel(counts))}</button>
      </div>
    </div>`;

  wireRows(root, actions.applyJob);
  wirePreviewChrome(root, job, st, actions);
}

/** In-place update for job changes while the same rows are shown. */
function patchPreview(root: HTMLElement, job: TranslateJob, st: PreviewState): void {
  for (const tr of root.querySelectorAll<HTMLElement>('tr[data-lang]')) {
    const lang = tr.dataset.lang!;
    const s = job.langStates[lang];
    if (!s) continue;
    tr.classList.toggle('vt-needs-review', s.status === 'needs_review');
    const badge = tr.querySelector('.vt-row-badge');
    if (badge) badge.textContent = rowLanguageBadge(job, lang);
    const auto = tr.querySelector<HTMLElement>('.vt-auto-approved-badge');
    if (auto) auto.hidden = !(s.autoApproved && s.status === 'ok');
    const input = tr.querySelector<HTMLInputElement>('.vt-title');
    // Never overwrite the field the user is typing in.
    if (input && s.title != null && input.value !== s.title && document.activeElement !== input) {
      input.value = s.title;
      syncRowCounters(tr);
    }
  }
  const autoApprove = root.querySelector<HTMLInputElement>('#vt-autoapprove-preview');
  if (autoApprove) autoApprove.checked = job.autoApprove === true;
  const banner = root.querySelector('#vt-auto-banner');
  if (banner) banner.textContent = autoPublishBannerText(job);
  const summary = root.querySelector('#vt-auto-summary');
  if (summary) summary.textContent = summaryText(job);
  syncPublishButton(root, job, st);
}

function syncPublishButton(root: HTMLElement, job: TranslateJob, st: PreviewState) {
  const pub = root.querySelector<HTMLButtonElement>('#vt-publish');
  if (!pub || pub.textContent === 'Publishing…') return;
  const counts = jobPublishCounts(job);
  pub.disabled = st.dryRun || counts.ready === 0;
  pub.textContent = publishButtonLabel(counts);
}

function syncRowCounters(tr: Element) {
  const titleInput = $req<HTMLInputElement>(tr, '.vt-title');
  const descInput = $req<HTMLTextAreaElement>(tr, '.vt-desc');
  const titleWarn = $req(tr, '.vt-title-warn');
  const descWarn = $req(tr, '.vt-desc-warn');
  const counter = tr.querySelector<HTMLElement>('.vt-counter');
  const len = titleInput.value.length;
  if (counter) {
    counter.textContent = `${len}/${YT_TITLE_MAX}`;
    counter.classList.toggle('vt-counter-over', len > YT_TITLE_MAX);
  }
  // Allow paste/use-full over 100 by lifting maxlength
  titleInput.maxLength = len > YT_TITLE_MAX ? 500 : YT_TITLE_MAX;
  const w = charWarning(titleInput.value, descInput.value);
  titleWarn.style.display = w.titleOver ? 'block' : 'none';
  titleWarn.textContent = `Title > ${YT_TITLE_MAX} (${len})`;
  descWarn.style.display = w.descOver ? 'block' : 'none';
  descWarn.textContent = `Description > ${YT_DESCRIPTION_MAX} (${descInput.value.length})`;
}

function wireRows(root: HTMLElement, onJob: (job: TranslateJob) => void) {
  for (const tr of root.querySelectorAll<HTMLElement>('tr[data-lang]')) {
    const lang = tr.dataset.lang!;
    const titleInput = $req<HTMLInputElement>(tr, '.vt-title');
    const descInput = $req<HTMLTextAreaElement>(tr, '.vt-desc');
    titleInput.addEventListener('input', () => {
      syncRowCounters(tr);
      // Edit clears the review gate (≤100); the update comes back via the job port.
      void sendMsg<JobResponse>({
        type: 'REVIEW_LANG',
        language: lang,
        action: 'edit',
        title: titleInput.value,
      }).then((res) => {
        if (res?.job) onJob(res.job);
      });
    });
    descInput.addEventListener('input', () => {
      state?.descriptionDrafts.set(lang, descInput.value);
      syncRowCounters(tr);
    });
  }
}

function wirePreviewChrome(
  root: HTMLElement,
  job: TranslateJob,
  st: PreviewState,
  actions: JobUiActions,
) {
  const failed = jobFailed(job);
  const repaint = () => {
    if (latestJob) paintPreview(root, latestJob, st, actions);
  };

  const reviewAction = async (lang: string, action: Exclude<ReviewAction, 'edit'>) => {
    const res = await sendMsg<JobResponse>({ type: 'REVIEW_LANG', language: lang, action });
    if (res?.job) {
      latestJob = res.job;
      actions.applyJob(res.job);
      // Title value changes for use_full / reset — full repaint (focus is on the button).
      repaint();
    }
  };
  const reviewButtons: [string, Exclude<ReviewAction, 'edit'>][] = [
    ['.vt-approve', 'approve'],
    ['.vt-use-full', 'use_full'],
    ['.vt-reset', 'reset'],
  ];
  for (const [selector, action] of reviewButtons) {
    root.querySelectorAll<HTMLElement>(selector).forEach((btn) => {
      btn.addEventListener('click', () => void reviewAction(btn.dataset.lang!, action));
    });
  }

  const onPublish = async () => {
    const cur = latestJob ?? job;
    if (st.dryRun) return;
    const localizations: LocalizationResult[] = [];
    for (const tr of root.querySelectorAll<HTMLElement>('tr[data-lang]')) {
      const lang = tr.dataset.lang!;
      const s = cur.langStates[lang];
      if (!s || s.published || s.status !== 'ok') continue;
      const title = $req<HTMLInputElement>(tr, '.vt-title').value;
      if (title.length > YT_TITLE_MAX) continue;
      const description = $req<HTMLTextAreaElement>(tr, '.vt-desc').value;
      localizations.push({ language: lang, title, description });
    }
    if (!localizations.length) return;
    const pubBtn = $req<HTMLButtonElement>(root, '#vt-publish');
    pubBtn.disabled = true;
    pubBtn.textContent = 'Publishing…';
    try {
      const res = await sendMsg<PublishResponse>({
        type: 'PUBLISH',
        videoId: cur.videoId,
        localizations,
      });
      if (res?.ok) {
        for (const l of localizations) st.descriptionDrafts.delete(l.language);
      }
      showResultPanel(root, actions, {
        videoId: cur.videoId,
        published: res?.ok ? (res.published ?? []) : [],
        failed: res?.ok
          ? failed
          : localizations.map((l) => ({ language: l.language, error: res?.error ?? 'unknown' })),
        error: res?.ok ? undefined : res?.error,
      });
    } catch (err) {
      showResultPanel(root, actions, {
        videoId: cur.videoId,
        published: [],
        failed: localizations.map((l) => ({
          language: l.language,
          error: err instanceof Error ? err.message : String(err),
        })),
      });
    }
    syncResultPanel(root, latestJob);
  };

  bindModalChrome({
    root,
    onClose: actions.close,
    onEnter: () => {
      const pub = root.querySelector<HTMLButtonElement>('#vt-publish');
      if (pub && !pub.disabled) void onPublish();
    },
  });
  $req(root, '#vt-x').addEventListener('click', actions.close);
  $req(root, '#vt-minimize').addEventListener('click', actions.close);
  root.querySelector('#vt-new')?.addEventListener('click', actions.newSession);
  $req(root, '#vt-dry-preview').addEventListener('change', async (e) => {
    st.dryRun = (e.target as HTMLInputElement).checked;
    await sendMsg({ type: 'PATCH_SETTINGS', partial: { dryRun: st.dryRun } });
    repaint();
  });
  $req(root, '#vt-auto-preview').addEventListener('change', async (e) => {
    const cb = e.target as HTMLInputElement;
    if (cb.checked && !(await confirmAutoPublish())) {
      cb.checked = false;
      return;
    }
    st.autoPublish = cb.checked;
    if (job.channelId) {
      await sendMsg({
        type: 'PATCH_CHANNEL_SETTINGS',
        channelId: job.channelId,
        partial: { autoPublish: st.autoPublish },
      });
    }
    repaint();
  });
  $req(root, '#vt-autoapprove-preview').addEventListener('change', (e) => {
    void setAutoApprove((e.target as HTMLInputElement).checked).then(actions.applyJob);
  });
  root.querySelector('#vt-retry-failed')?.addEventListener('click', () => {
    actions.retry(
      job.videoId,
      failed.map((f) => f.language),
    );
  });
  $req(root, '#vt-publish').addEventListener('click', () => void onPublish());
}
