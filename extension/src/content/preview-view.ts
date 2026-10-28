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
import { icon } from '../ui/icons';
import type { JobUiActions } from './actions';
import { bindAutoApproveToggle, confirmAutoPublish, sendMsg } from './api';
import { $req, bindModalChrome, ensureModalRoot, modalMode, panelHeadHtml } from './dom';
import { AUTO_APPROVE_HINT, AUTO_APPROVE_LABEL } from './labels';
import { showResultPanel, syncResultPanel } from './result-view';
import { langRowState, type RowState, statusBadge } from './status';

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
  /** Toolbar row filter and search (kept across repaints). */
  filter: RowFilter;
  query: string;
};

type RowFilter = 'all' | 'review' | 'ready';

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
      filter: 'all',
      query: '',
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

function rowStateFor(job: TranslateJob, language: string): RowState {
  return langRowState(job.langStates[language]);
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
  const rowState = rowStateFor(job, r.language);
  const w = charWarning(title, description);
  const removedChars = Math.max(0, fullTitle.length - title.length);
  const lang = escapeAttr(r.language);
  const shortenBadge = shortened
    ? `<span class="ytl-badge" title="Fitted to the ${YT_TITLE_MAX}-character YouTube limit">Shortened −${removedChars}</span>`
    : '<span></span>';
  const expander = shortened
    ? `<details class="vt-shorten-details">
        <summary>Show full translation</summary>
        <div class="vt-full-diff">${diffHtml(fullTitle, s?.autoTitle ?? title)}</div>
        <div class="vt-review-actions">
          <button type="button" class="ytl-btn vt-approve" data-lang="${lang}">${icon('check')}Approve</button>
          <button type="button" class="ytl-btn ytl-btn--ghost vt-use-full" data-lang="${lang}">Use full</button>
          <button type="button" class="ytl-btn ytl-btn--ghost vt-reset" data-lang="${lang}">Reset</button>
        </div>
      </details>`
    : '';
  const titleOver = title.length > YT_TITLE_MAX;
  const counterClass = titleOver ? 'vt-counter vt-counter-over' : 'vt-counter';
  return `<tr data-i="${i}" data-lang="${lang}" data-state="${rowState}">
      <td>
        <div class="vt-cell-lang">
          <span class="vt-row-code">${escapeHtml(r.language)}</span>
          <span class="vt-row-badge">${statusBadge(rowState)}</span>
        </div>
      </td>
      <td>
        <div class="vt-cell-stack">
          <input class="ytl-input vt-title" aria-label="Title (${lang})" value="${escapeAttr(title)}" maxlength="${
            // Allow Use full to exceed; maxlength only when not forcing full
            titleOver ? 500 : YT_TITLE_MAX
          }"${titleOver ? ' aria-invalid="true"' : ''} />
          <div class="vt-cell-meta">
            ${shortenBadge}
            <span class="${counterClass}">${title.length}/${YT_TITLE_MAX}</span>
          </div>
          <div class="vt-field-warn vt-title-warn" role="alert" ${w.titleOver ? '' : 'hidden'}>${icon('error', { small: true })}<span>Title &gt; ${YT_TITLE_MAX} (${title.length}) — not published until shortened</span></div>
          ${expander}
        </div>
      </td>
      <td>
        <div class="vt-cell-stack">
          <textarea class="ytl-textarea vt-desc" rows="3" aria-label="Description (${lang})">${escapeHtml(description)}</textarea>
          <div class="vt-field-warn vt-desc-warn" role="alert" ${w.descOver ? '' : 'hidden'}>${icon('error', { small: true })}<span>Description &gt; ${YT_DESCRIPTION_MAX} (${description.length})</span></div>
        </div>
      </td>
    </tr>`;
}

function autoPublishBannerText(job: TranslateJob): string {
  return job.autoApprove
    ? 'Auto-publish is on — ready rows go live as they finish (shortened titles are auto-approved).'
    : 'Auto-publish is on — ready rows go live as they finish (shortened titles wait for review).';
}

function summaryText(job: TranslateJob): string {
  const auto = autoApprovedSummary(jobAutoApproved(job).length);
  return auto ? `(${auto})` : '';
}

function footerSummaryHtml(job: TranslateJob, st: PreviewState): string {
  const counts = jobPublishCounts(job);
  if (st.dryRun) return 'Dry-run — nothing will be published';
  const parts = [`<strong>${counts.ready}</strong> ready`];
  if (counts.needReview) parts.push(`<strong>${counts.needReview}</strong> need review`);
  if (counts.autoApproved) parts.push(`${counts.autoApproved} auto-approved`);
  return parts.join(' · ');
}

function filterCounts(job: TranslateJob): Record<RowFilter, number> {
  const rows = jobPreviewRows(job);
  let review = 0;
  let ready = 0;
  for (const r of rows) {
    const st = rowStateFor(job, r.language);
    if (st === 'review') review++;
    else if (st === 'ready' || st === 'cached' || st === 'auto') ready++;
  }
  return { all: rows.length, review, ready };
}

function rowMatches(tr: HTMLElement, st: PreviewState): boolean {
  const state = tr.dataset.state as RowState;
  if (st.filter === 'review' && state !== 'review') return false;
  if (st.filter === 'ready' && !(state === 'ready' || state === 'cached' || state === 'auto')) {
    return false;
  }
  return !st.query || (tr.dataset.lang ?? '').toLowerCase().includes(st.query);
}

/** Apply the toolbar filter/search to the rows and refresh the filter counts. */
function applyRowFilter(root: HTMLElement, job: TranslateJob, st: PreviewState): void {
  let shown = 0;
  for (const tr of root.querySelectorAll<HTMLElement>('tr[data-lang]')) {
    // Keep the row being edited visible even if its state no longer matches.
    const keep = tr.contains(document.activeElement);
    tr.hidden = !(keep || rowMatches(tr, st));
    if (!tr.hidden) shown++;
  }
  const empty = root.querySelector<HTMLElement>('#vt-rows-empty');
  if (empty) empty.hidden = shown > 0 || !root.querySelector('tr[data-lang]');
  const counts = filterCounts(job);
  root.querySelectorAll<HTMLElement>('[data-filter-count]').forEach((el) => {
    el.textContent = String(counts[el.dataset.filterCount as RowFilter]);
  });
}

function filterItem(st: PreviewState, value: RowFilter, label: string): string {
  return `<label class="ytl-segmented__item"><input type="radio" class="ytl-visually-hidden" name="vt-row-filter" value="${value}" ${
    st.filter === value ? 'checked' : ''
  }/>${label} <span class="ytl-segmented__count" data-filter-count="${value}"></span></label>`;
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
  const publishDisabled = st.dryRun || counts.ready === 0;
  const source = (job.sourceTitle ?? '').slice(0, 90);
  root.innerHTML = `
    <div class="vt-panel vt-panel--lg" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      ${panelHeadHtml({
        title: 'Review translations',
        subtitle: source ? `${source} · ${job.videoId}` : job.videoId,
      })}
      <div class="vt-notices">
        <div class="ytl-notice ytl-notice--warning" id="vt-dry-banner" ${st.dryRun ? '' : 'hidden'}>
          ${icon('alert')}
          <span>Dry-run is on — Publish is disabled. Turn Dry-run off in the toolbar to publish.</span>
        </div>
        <div class="ytl-notice" id="vt-auto-banner" ${st.autoPublish && !st.dryRun ? '' : 'hidden'}>
          ${icon('info')}
          <span id="vt-auto-banner-text">${escapeHtml(autoPublishBannerText(job))}</span>
        </div>
        ${
          stopNote
            ? `<div class="ytl-notice ytl-notice--error" role="alert">${icon('error')}<span>${escapeHtml(stopNote)}</span></div>`
            : ''
        }
        ${
          failedNote
            ? `<div class="ytl-notice ytl-notice--error">${icon('error')}<span>${escapeHtml(failedNote)}</span></div>`
            : ''
        }
      </div>
      <div class="vt-toolbar" role="toolbar" aria-label="Review options">
        <div class="vt-toolbar-row">
          <label class="ytl-search">
            ${icon('search')}
            <span class="ytl-visually-hidden">Filter by language code</span>
            <input type="search" id="vt-row-search" class="ytl-input" placeholder="Filter by language code…" autocomplete="off" value="${escapeAttr(st.query)}" />
          </label>
          <div class="ytl-segmented" role="radiogroup" aria-label="Show rows">
            ${filterItem(st, 'all', 'All')}
            ${filterItem(st, 'review', 'Needs review')}
            ${filterItem(st, 'ready', 'Ready')}
          </div>
        </div>
        <div class="vt-toolbar-row">
          <label class="ytl-toggle ytl-toggle--compact">
            <input type="checkbox" role="switch" class="ytl-switch" id="vt-dry-preview" ${st.dryRun ? 'checked' : ''}/>
            <span>Dry-run</span>
          </label>
          <label class="ytl-toggle ytl-toggle--compact">
            <input type="checkbox" role="switch" class="ytl-switch" id="vt-auto-preview" ${st.autoPublish ? 'checked' : ''}/>
            <span>Auto-publish</span>
          </label>
          <label class="ytl-toggle ytl-toggle--compact" title="${escapeAttr(AUTO_APPROVE_HINT)}">
            <input type="checkbox" role="switch" class="ytl-switch" id="vt-autoapprove-preview" ${job.autoApprove ? 'checked' : ''}/>
            <span>${AUTO_APPROVE_LABEL} <span class="ytl-muted" id="vt-auto-summary">${escapeHtml(summaryText(job))}</span></span>
          </label>
        </div>
      </div>
      <div class="vt-body vt-body--flush">
        ${
          rows.length
            ? `<table class="vt-table">
                <thead><tr><th scope="col">Language</th><th scope="col">Title</th><th scope="col">Description</th></tr></thead>
                <tbody>${rows.map((r, i) => rowHtml(r, i, job, st)).join('')}</tbody>
              </table>
              <div class="vt-state" id="vt-rows-empty" hidden>
                <span class="vt-state-title">No rows match</span>
                <span>Clear the search or switch the filter to All.</span>
              </div>`
            : `<div class="vt-state">
                <span class="vt-state-title">No translations to review</span>
                <span>${failed.length ? 'Every language failed — retry them below.' : 'Nothing finished yet.'}</span>
              </div>`
        }
      </div>
      <footer class="vt-footer">
        <div class="vt-footer-summary" id="vt-pub-summary" aria-live="polite">${footerSummaryHtml(job, st)}</div>
        <div class="vt-footer-actions">
          <button type="button" class="ytl-btn ytl-btn--ghost" id="vt-new">New session</button>
          ${
            failed.length
              ? `<button type="button" class="ytl-btn" id="vt-retry-failed">Retry ${failed.length} failed</button>`
              : ''
          }
          <button type="button" class="ytl-btn" id="vt-minimize">Close</button>
          <button type="button" class="ytl-btn ytl-btn--primary ytl-btn--lg" id="vt-publish" ${
            publishDisabled ? 'disabled' : ''
          }${st.dryRun ? ' title="Dry-run is on"' : ''}>${escapeHtml(publishButtonLabel(counts))}</button>
        </div>
      </footer>
    </div>`;

  applyRowFilter(root, job, st);
  wireRows(root, actions.applyJob);
  wirePreviewChrome(root, job, st, actions);
}

/** In-place update for job changes while the same rows are shown. */
function patchPreview(root: HTMLElement, job: TranslateJob, st: PreviewState): void {
  for (const tr of root.querySelectorAll<HTMLElement>('tr[data-lang]')) {
    const lang = tr.dataset.lang!;
    const s = job.langStates[lang];
    if (!s) continue;
    const rowState = rowStateFor(job, lang);
    if (tr.dataset.state !== rowState) {
      tr.dataset.state = rowState;
      const badge = tr.querySelector('.vt-row-badge');
      if (badge) badge.innerHTML = statusBadge(rowState);
    }
    const input = tr.querySelector<HTMLInputElement>('.vt-title');
    // Never overwrite the field the user is typing in.
    if (input && s.title != null && input.value !== s.title && document.activeElement !== input) {
      input.value = s.title;
      syncRowCounters(tr);
    }
  }
  const autoApprove = root.querySelector<HTMLInputElement>('#vt-autoapprove-preview');
  if (autoApprove) autoApprove.checked = job.autoApprove === true;
  const banner = root.querySelector('#vt-auto-banner-text');
  if (banner) banner.textContent = autoPublishBannerText(job);
  const summary = root.querySelector('#vt-auto-summary');
  if (summary) summary.textContent = summaryText(job);
  const pubSummary = root.querySelector('#vt-pub-summary');
  if (pubSummary) pubSummary.innerHTML = footerSummaryHtml(job, st);
  applyRowFilter(root, job, st);
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
  titleWarn.hidden = !w.titleOver;
  $req(titleWarn, 'span').textContent =
    `Title > ${YT_TITLE_MAX} (${len}) — not published until shortened`;
  titleInput.toggleAttribute('aria-invalid', w.titleOver);
  descWarn.hidden = !w.descOver;
  $req(descWarn, 'span').textContent =
    `Description > ${YT_DESCRIPTION_MAX} (${descInput.value.length})`;
  descInput.toggleAttribute('aria-invalid', w.descOver);
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
    pubBtn.setAttribute('aria-busy', 'true');
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
  bindAutoApproveToggle($req<HTMLInputElement>(root, '#vt-autoapprove-preview'), actions.applyJob);
  root.querySelector('#vt-retry-failed')?.addEventListener('click', () => {
    actions.retry(
      job.videoId,
      failed.map((f) => f.language),
    );
  });
  root.querySelector('#vt-row-search')?.addEventListener('input', (e) => {
    st.query = (e.target as HTMLInputElement).value.toLowerCase().trim();
    applyRowFilter(root, latestJob ?? job, st);
  });
  root.querySelectorAll<HTMLInputElement>('input[name="vt-row-filter"]').forEach((el) => {
    el.addEventListener('change', () => {
      st.filter = el.value as RowFilter;
      applyRowFilter(root, latestJob ?? job, st);
    });
  });
  $req(root, '#vt-publish').addEventListener('click', () => void onPublish());
}
