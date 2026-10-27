import { YT_TITLE_MAX } from './limits.js';
import type { LocalizationResult } from './types.js';

/**
 * Review gate for titles shortened to fit YouTube's 100-char limit.
 * A shortened, not-yet-reviewed title needs Approve / edit before publish —
 * unless auto-approve is ON, in which case the fitted title is accepted as-is.
 */

/** Shortened title still waiting for the user (ignores auto-approve). */
export function needsTitleReview(r: Pick<LocalizationResult, 'shortened' | 'reviewed'>): boolean {
  return !!r.shortened && !r.reviewed;
}

/** Auto-approve may only accept titles that already fit the limit. */
export function canAutoApproveTitle(title: string | undefined | null): boolean {
  return title != null && title.length <= YT_TITLE_MAX;
}

/** Mark a result auto-approved when it would otherwise need review. */
export function autoApproveResult(r: LocalizationResult): LocalizationResult {
  if (!needsTitleReview(r) || !canAutoApproveTitle(r.title)) return r;
  return { ...r, reviewed: true, autoApproved: true };
}

export type PublishPartition = {
  /** Publishable now (never shortened, reviewed, or auto-approved). */
  ready: LocalizationResult[];
  /** Still blocked by the review gate. */
  needsReview: LocalizationResult[];
  /** Languages in `ready` that were auto-approved. */
  autoApproved: string[];
};

/** Split results into publishable vs needs-review, applying auto-approve when enabled. */
export function partitionForPublish(
  results: LocalizationResult[],
  opts: { autoApprove: boolean },
): PublishPartition {
  const out: PublishPartition = { ready: [], needsReview: [], autoApproved: [] };
  for (const raw of results) {
    const r = opts.autoApprove ? autoApproveResult(raw) : raw;
    if (needsTitleReview(r) || !canAutoApproveTitle(r.title)) {
      out.needsReview.push(r);
      continue;
    }
    out.ready.push(r);
    if (r.autoApproved) out.autoApproved.push(r.language);
  }
  return out;
}

export function autoApprovedSummary(count: number): string {
  return count > 0 ? `${count} auto-approved` : '';
}
