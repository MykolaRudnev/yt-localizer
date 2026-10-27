import type { LocalizationResult } from './types.js';
import type { LangJobState, TranslateJob } from './job.js';

export function isJobFinished(job: TranslateJob | null | undefined): boolean {
  if (!job) return false;
  return job.phase === 'done' || job.phase === 'failed' || job.phase === 'stopped';
}

/**
 * Closing the modal ends a finished session (clear job UI state).
 * Running jobs keep minimize-to-widget behaviour instead.
 */
export function shouldEndSessionOnClose(job: TranslateJob | null | undefined): boolean {
  return isJobFinished(job);
}

/**
 * Floating status widget while running, or when finished with pending reviews.
 */
export function shouldShowJobWidget(job: TranslateJob | null | undefined): boolean {
  if (!job) return false;
  if (job.phase === 'running') return true;
  return isJobFinished(job) && jobNeedsReview(job).length > 0;
}

/** Unpublished OK rows or pending reviews — confirm before discarding the preview. */
export function needsDiscardPreviewConfirm(job: TranslateJob): boolean {
  return (
    isJobFinished(job) &&
    (jobUnpublished(job).length > 0 || jobNeedsReview(job).length > 0)
  );
}

/** Reopen modal for this video instead of starting a fresh picker. */
export function shouldReopenExistingJob(
  job: TranslateJob | null | undefined,
  videoId: string,
): boolean {
  if (!job || job.videoId !== videoId) return false;
  return job.phase === 'running' || isJobFinished(job);
}

function resultFromState(code: string, s: LangJobState): LocalizationResult {
  return {
    language: code,
    title: s.title!,
    description: s.description ?? '',
    fullTitle: s.fullTitle,
    autoTitle: s.autoTitle,
    shortened: s.shortened,
    removed: s.removed,
    reviewed: s.status === 'ok',
    autoApproved: s.autoApproved,
  };
}

function collectRows(
  job: TranslateJob,
  include: (s: LangJobState) => boolean,
): LocalizationResult[] {
  const out: LocalizationResult[] = [];
  for (const code of job.languages) {
    const s = job.langStates[code];
    if (s && s.title != null && include(s)) out.push(resultFromState(code, s));
  }
  return out;
}

/** Ready-to-publish rows (approved / auto-approved / never shortened). */
export function jobResults(job: TranslateJob): LocalizationResult[] {
  return collectRows(job, (s) => s.status === 'ok');
}

/** All preview rows: ready + needs review. */
export function jobPreviewRows(job: TranslateJob): LocalizationResult[] {
  return collectRows(job, (s) => s.status === 'ok' || s.status === 'needs_review');
}

/** Shortened rows still awaiting Approve / edit. */
export function jobNeedsReview(job: TranslateJob): LocalizationResult[] {
  return collectRows(job, (s) => s.status === 'needs_review');
}

/** Languages whose shortened title was auto-approved (still ready, not manually reviewed). */
export function jobAutoApproved(job: TranslateJob): string[] {
  return job.languages.filter((code) => {
    const s = job.langStates[code];
    return s?.status === 'ok' && s.autoApproved === true;
  });
}

export function jobPublishCounts(job: TranslateJob): {
  ready: number;
  needReview: number;
  autoApproved: number;
} {
  return {
    ready: jobUnpublished(job).length,
    needReview: jobNeedsReview(job).length,
    autoApproved: jobAutoApproved(job).length,
  };
}

/** Label for the preview Publish button: "Publish N ready (M need review)". */
export function publishButtonLabel(counts: { ready: number; needReview: number }): string {
  if (counts.needReview > 0) {
    return `Publish ${counts.ready} ready (${counts.needReview} need review)`;
  }
  return counts.ready > 0 ? `Publish ${counts.ready}` : 'Publish';
}

export function jobFailed(job: TranslateJob): { language: string; error: string }[] {
  const out: { language: string; error: string }[] = [];
  for (const code of job.languages) {
    const s = job.langStates[code];
    if (s?.status === 'failed') {
      out.push({ language: code, error: s.error ?? 'failed' });
    }
  }
  return out;
}

/** Successful translations not yet published (excludes needs_review — never auto-published). */
export function jobUnpublished(job: TranslateJob): LocalizationResult[] {
  return jobResults(job).filter((r) => !job.langStates[r.language]?.published);
}

/** Anything left to act on after a publish (unpublished ready rows or pending reviews). */
export function jobHasOpenWork(job: TranslateJob): boolean {
  return jobUnpublished(job).length > 0 || jobNeedsReview(job).length > 0;
}

export function markJobPublished(job: TranslateJob, languages: string[]): TranslateJob {
  const langStates = { ...job.langStates };
  for (const code of languages) {
    const prev = langStates[code];
    if (prev) langStates[code] = { ...prev, published: true };
  }
  return { ...job, langStates };
}

export function jobPercent(job: TranslateJob): number {
  if (!job.totalCount) return 0;
  return Math.min(100, Math.round((job.doneCount / job.totalCount) * 100));
}

/** ETA string from average time per completed language, or null if unknown. */
export function jobEta(job: TranslateJob, now = Date.now()): string | null {
  if (job.phase !== 'running' || job.doneCount <= 0) return null;
  const remaining = job.totalCount - job.doneCount;
  if (remaining <= 0) return null;
  const elapsed = Math.max(1, now - job.startedAt);
  const ms = (elapsed / job.doneCount) * remaining;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `~${sec}s left`;
  const min = Math.round(sec / 60);
  return `~${min}m left`;
}

export function badgeForJob(job: TranslateJob | null): {
  text: string;
  color: string;
} {
  if (!job) return { text: '', color: '#666666' };
  const text = `${job.doneCount}/${job.totalCount}`;
  if (job.phase === 'running') return { text, color: '#3b82f6' };
  if (isJobFinished(job)) {
    return { text, color: jobFailed(job).length ? '#ef4444' : '#3b82f6' };
  }
  return { text, color: '#666666' };
}
