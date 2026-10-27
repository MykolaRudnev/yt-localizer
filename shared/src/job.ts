import type { LocalizationResult } from './types.js';
import { YT_TITLE_MAX } from './limits.js';
import { canAutoApproveTitle, needsTitleReview } from './review.js';

export * from './job-selectors.js';

export type JobPhase = 'running' | 'done' | 'failed' | 'stopped';
export type LangJobStatus =
  | 'pending'
  | 'running'
  | 'ok'
  | 'failed'
  | 'skipped'
  | 'needs_review';

export interface LangJobState {
  code: string;
  status: LangJobStatus;
  engine?: string;
  model?: string;
  note?: string;
  error?: string;
  errorDetail?: string;
  title?: string;
  description?: string;
  /** Untruncated translation. */
  fullTitle?: string;
  /** Auto-fitted title (Reset target). */
  autoTitle?: string;
  shortened?: boolean;
  removed?: LocalizationResult['removed'];
  /** Reused from translation cache (no API call). */
  cached?: boolean;
  /** Already written to YouTube (auto-publish or manual). */
  published?: boolean;
  /** Shortened title accepted automatically (auto-approve option), not by the user. */
  autoApproved?: boolean;
}

export interface TranslateJob {
  id: string;
  videoId: string;
  channelId?: string;
  sourceTitle?: string;
  sourceDescription?: string;
  defaultLanguage?: string;
  languages: string[];
  langStates: Record<string, LangJobState>;
  dryRun: boolean;
  skipExisting: boolean;
  /** Snapshot of channel auto-publish for this job. */
  autoPublish?: boolean;
  /** Auto-approve shortened titles (skip review gate). Toggleable mid-job. */
  autoApprove?: boolean;
  phase: JobPhase;
  startedAt: number;
  finishedAt?: number;
  engine?: string;
  model?: string;
  fatalSummary?: string;
  fatalHint?: string;
  stopReason?: string | null;
  /** Completed (ok + failed + skipped + needs_review) languages. */
  doneCount: number;
  totalCount: number;
}

export type JobAction =
  | {
      type: 'create';
      id: string;
      videoId: string;
      languages: string[];
      dryRun: boolean;
      skipExisting: boolean;
      autoPublish?: boolean;
      autoApprove?: boolean;
      channelId?: string;
      sourceTitle?: string;
      sourceDescription?: string;
      defaultLanguage?: string;
      engine?: string;
      startedAt?: number;
    }
  | {
      type: 'progress';
      language?: string;
      status?: LangJobStatus;
      engine?: string;
      model?: string;
      note?: string;
      error?: string;
      errorDetail?: string;
      title?: string;
      description?: string;
      fullTitle?: string;
      autoTitle?: string;
      shortened?: boolean;
      removed?: LocalizationResult['removed'];
      cached?: boolean;
      published?: boolean;
      fatalSummary?: string;
      fatalHint?: string;
      stopReason?: string | null;
    }
  | {
      type: 'finish';
      phase: Exclude<JobPhase, 'running'>;
      results?: LocalizationResult[];
      failed?: { language: string; error: string; errorDetail?: string }[];
      stopReason?: string | null;
      fatalSummary?: string;
      fatalHint?: string;
      finishedAt?: number;
    }
  | { type: 'patch'; patch: Partial<TranslateJob> }
  | {
      type: 'review';
      language: string;
      action: ReviewAction;
      title?: string;
    }
  | { type: 'set_auto_approve'; enabled: boolean };

export type ReviewAction = 'approve' | 'edit' | 'use_full' | 'reset';

function emptyLang(code: string): LangJobState {
  return { code, status: 'pending' };
}

function recount(job: TranslateJob): TranslateJob {
  let done = 0;
  for (const code of job.languages) {
    const s = job.langStates[code]?.status;
    if (s === 'ok' || s === 'failed' || s === 'skipped' || s === 'needs_review') done += 1;
  }
  return { ...job, doneCount: done, totalCount: job.languages.length };
}

function statusForLocalization(r: LocalizationResult): LangJobStatus {
  return needsTitleReview(r) ? 'needs_review' : 'ok';
}

function titleStatus(title: string): LangJobStatus {
  return title.length <= YT_TITLE_MAX ? 'ok' : 'needs_review';
}

/**
 * Auto-approve invariant: while `job.autoApprove` is ON, no row that fits the
 * limit stays in needs_review. Rows that were auto-approved keep the flag so
 * the UI can badge them and logs can count them.
 */
function applyAutoApprove(job: TranslateJob): TranslateJob {
  if (!job.autoApprove) return job;
  let langStates: Record<string, LangJobState> | null = null;
  for (const code of job.languages) {
    const s = job.langStates[code];
    if (s?.status !== 'needs_review' || !canAutoApproveTitle(s.title)) continue;
    langStates ??= { ...job.langStates };
    langStates[code] = { ...s, status: 'ok', autoApproved: true };
  }
  return langStates ? { ...job, langStates } : job;
}

/** Turning auto-approve OFF sends unpublished auto-approved rows back to review. */
function revokeAutoApprove(job: TranslateJob): TranslateJob {
  const langStates = { ...job.langStates };
  for (const code of job.languages) {
    const s = langStates[code];
    if (!s?.autoApproved || s.published) continue;
    langStates[code] = { ...s, status: 'needs_review', autoApproved: false };
  }
  return { ...job, langStates };
}

/** Recount + enforce auto-approve after every state change. */
function settle(job: TranslateJob): TranslateJob {
  return recount(applyAutoApprove(job));
}

function langFromResult(prev: LangJobState, r: LocalizationResult): LangJobState {
  const status = statusForLocalization(r);
  return {
    ...prev,
    status,
    title: r.title,
    description: r.description,
    fullTitle: r.fullTitle ?? r.title,
    autoTitle: r.autoTitle ?? r.title,
    shortened: r.shortened ?? false,
    removed: r.removed,
  };
}

export function reduceJob(state: TranslateJob | null, action: JobAction): TranslateJob | null {
  switch (action.type) {
    case 'create': {
      const langStates: Record<string, LangJobState> = {};
      for (const code of action.languages) langStates[code] = emptyLang(code);
      return settle({
        id: action.id,
        videoId: action.videoId,
        channelId: action.channelId,
        sourceTitle: action.sourceTitle,
        sourceDescription: action.sourceDescription,
        defaultLanguage: action.defaultLanguage,
        languages: [...action.languages],
        langStates,
        dryRun: action.dryRun,
        skipExisting: action.skipExisting,
        autoPublish: action.autoPublish,
        autoApprove: action.autoApprove,
        phase: 'running',
        startedAt: action.startedAt ?? Date.now(),
        engine: action.engine,
        stopReason: null,
        doneCount: 0,
        totalCount: action.languages.length,
      });
    }
    case 'progress': {
      if (!state) return null;
      const next: TranslateJob = { ...state, langStates: { ...state.langStates } };
      if (action.engine && !action.language) next.engine = action.engine;
      if (action.model && !action.language) next.model = action.model;
      if (action.fatalSummary) next.fatalSummary = action.fatalSummary;
      if (action.fatalHint) next.fatalHint = action.fatalHint;
      if (action.stopReason !== undefined) next.stopReason = action.stopReason;
      if (action.language) {
        const prev = next.langStates[action.language] ?? emptyLang(action.language);
        next.langStates[action.language] = {
          ...prev,
          status: action.status ?? prev.status,
          engine: action.engine ?? prev.engine,
          model: action.model ?? prev.model,
          note: action.note ?? prev.note,
          error: action.error ?? prev.error,
          errorDetail: action.errorDetail ?? prev.errorDetail,
          title: action.title ?? prev.title,
          description: action.description ?? prev.description,
          fullTitle: action.fullTitle ?? prev.fullTitle,
          autoTitle: action.autoTitle ?? prev.autoTitle,
          shortened: action.shortened ?? prev.shortened,
          removed: action.removed ?? prev.removed,
          cached: action.cached ?? prev.cached,
          published: action.published ?? prev.published,
        };
      }
      return settle(next);
    }
    case 'finish': {
      if (!state) return null;
      const next: TranslateJob = {
        ...state,
        langStates: { ...state.langStates },
        phase: action.phase,
        finishedAt: action.finishedAt ?? Date.now(),
        stopReason: action.stopReason ?? state.stopReason,
        fatalSummary: action.fatalSummary ?? state.fatalSummary,
        fatalHint: action.fatalHint ?? state.fatalHint,
      };
      for (const r of action.results ?? []) {
        const prev = next.langStates[r.language] ?? emptyLang(r.language);
        // Preserve needs_review if already set from progress with shortening metadata
        if (prev.status === 'needs_review' && prev.title != null) {
          next.langStates[r.language] = {
            ...prev,
            title: r.title ?? prev.title,
            description: r.description ?? prev.description,
            fullTitle: r.fullTitle ?? prev.fullTitle,
            autoTitle: r.autoTitle ?? prev.autoTitle,
            shortened: r.shortened ?? prev.shortened,
            removed: r.removed ?? prev.removed,
          };
        } else {
          next.langStates[r.language] = langFromResult(prev, r);
        }
      }
      for (const f of action.failed ?? []) {
        const prev = next.langStates[f.language] ?? emptyLang(f.language);
        next.langStates[f.language] = {
          ...prev,
          status: 'failed',
          error: f.error,
          errorDetail: f.errorDetail,
        };
      }
      return settle(next);
    }
    case 'review': {
      if (!state) return null;
      const prev = state.langStates[action.language];
      if (!prev) return state;
      const next: TranslateJob = { ...state, langStates: { ...state.langStates } };
      const auto = prev.autoTitle ?? prev.title ?? '';
      const full = prev.fullTitle ?? prev.title ?? '';

      // Manual review clears the auto-approved flag (reset may re-trigger it).
      const base: LangJobState = { ...prev, autoApproved: false };
      if (action.action === 'approve') {
        next.langStates[action.language] = { ...base, title: auto, status: titleStatus(auto) };
      } else if (action.action === 'reset') {
        next.langStates[action.language] = {
          ...base,
          title: auto,
          status: prev.shortened ? 'needs_review' : 'ok',
        };
      } else if (action.action === 'use_full') {
        next.langStates[action.language] = { ...base, title: full, status: titleStatus(full) };
      } else if (action.action === 'edit') {
        const title = action.title ?? prev.title ?? '';
        // Any edit unblocks when ≤100; over 100 stays blocked
        next.langStates[action.language] = { ...base, title, status: titleStatus(title) };
      }
      return settle(next);
    }
    case 'patch': {
      if (!state) return null;
      return settle({ ...state, ...action.patch, langStates: action.patch.langStates ?? state.langStates });
    }
    case 'set_auto_approve': {
      if (!state) return null;
      const toggled = { ...state, autoApprove: action.enabled };
      return settle(action.enabled ? toggled : revokeAutoApprove(toggled));
    }
    default:
      return state;
  }
}
