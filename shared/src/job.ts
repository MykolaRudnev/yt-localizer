import type { LocalizationResult } from './types.js';

export type JobPhase = 'running' | 'done' | 'failed' | 'stopped';
export type LangJobStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';

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
  /** Reused from translation cache (no API call). */
  cached?: boolean;
  /** Already written to YouTube (auto-publish or manual). */
  published?: boolean;
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
  phase: JobPhase;
  startedAt: number;
  finishedAt?: number;
  engine?: string;
  model?: string;
  fatalSummary?: string;
  fatalHint?: string;
  stopReason?: string | null;
  /** Completed (ok + failed + skipped) languages. */
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
  | { type: 'patch'; patch: Partial<TranslateJob> };

function emptyLang(code: string): LangJobState {
  return { code, status: 'pending' };
}

function recount(job: TranslateJob): TranslateJob {
  let done = 0;
  for (const code of job.languages) {
    const s = job.langStates[code]?.status;
    if (s === 'ok' || s === 'failed' || s === 'skipped') done += 1;
  }
  return { ...job, doneCount: done, totalCount: job.languages.length };
}

export function reduceJob(state: TranslateJob | null, action: JobAction): TranslateJob | null {
  switch (action.type) {
    case 'create': {
      const langStates: Record<string, LangJobState> = {};
      for (const code of action.languages) langStates[code] = emptyLang(code);
      return recount({
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
      let next: TranslateJob = { ...state, langStates: { ...state.langStates } };
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
          cached: action.cached ?? prev.cached,
          published: action.published ?? prev.published,
        };
      }
      return recount(next);
    }
    case 'finish': {
      if (!state) return null;
      let next: TranslateJob = {
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
        next.langStates[r.language] = {
          ...prev,
          status: 'ok',
          title: r.title,
          description: r.description,
        };
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
      return recount(next);
    }
    case 'patch': {
      if (!state) return null;
      return recount({ ...state, ...action.patch, langStates: action.patch.langStates ?? state.langStates });
    }
    default:
      return state;
  }
}

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

/** Unpublished OK rows in a finished job — confirm before discarding the preview. */
export function needsDiscardPreviewConfirm(job: TranslateJob): boolean {
  return isJobFinished(job) && jobUnpublished(job).length > 0;
}

/** Reopen modal for this video instead of starting a fresh picker. */
export function shouldReopenExistingJob(
  job: TranslateJob | null | undefined,
  videoId: string,
): boolean {
  if (!job || job.videoId !== videoId) return false;
  return (
    job.phase === 'running' ||
    job.phase === 'done' ||
    job.phase === 'failed' ||
    job.phase === 'stopped'
  );
}

export function jobResults(job: TranslateJob): LocalizationResult[] {
  const out: LocalizationResult[] = [];
  for (const code of job.languages) {
    const s = job.langStates[code];
    if (s?.status === 'ok' && s.title != null) {
      out.push({ language: code, title: s.title, description: s.description ?? '' });
    }
  }
  return out;
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

/** Successful translations not yet published (for auto-publish flush). */
export function jobUnpublished(job: TranslateJob): LocalizationResult[] {
  return jobResults(job).filter((r) => !job.langStates[r.language]?.published);
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
  if (job.phase === 'done' && jobFailed(job).length === 0) return { text, color: '#22c55e' };
  if (job.phase === 'done' || job.phase === 'failed' || job.phase === 'stopped') {
    return { text, color: jobFailed(job).length ? '#ef4444' : '#22c55e' };
  }
  return { text, color: '#666666' };
}
