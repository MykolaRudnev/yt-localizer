import {
  cachedToResult,
  hashFromTranslateOptions,
  lookupCachedTranslation,
} from '@shared/cache';
import { shouldAutoPublishFlush } from '@shared/autopublish';
import { channelAutoPublish, mergeSettingsForChannel } from '@shared/channels';
import {
  jobAutoApproved,
  jobFailed,
  jobPreviewRows,
  jobResults,
  jobUnpublished,
  markJobPublished,
  reduceJob,
  type TranslateJob,
} from '@shared/job';
import { filterLanguagesForTranslate } from '@shared/langs';
import { translateAllLanguages, type ProgressCb } from '@shared/pipeline';
import { needsTitleReview } from '@shared/review';
import type { AppSettings, LocalizationResult } from '@shared/types';
import { ensureDefaultLanguage } from '@shared/youtube';
import type { StartTranslateResponse } from '../protocol';
import {
  cacheTranslation,
  getChannelSettings,
  getGeminiAutoModel,
  getGeminiExhaustedModels,
  getGeminiJsonModeByModel,
  getSettings,
  getVideoTranslationCache,
  markTranslationsPublished,
  patchChannelSettings,
  setGeminiAutoModel,
  setGeminiModelExhausted,
  setGeminiModelJsonMode,
} from '../storage';
import { logJobRun } from './job-log';
import { peekJob, persistJob, updateJob } from './job-store';
import { publishLocalizations } from './publish';
import { resolveVideoAccess } from './video-access';

let activeJobAbort: AbortController | null = null;
/** In-flight translate promise — prevents overlapping START while running. */
let runningPromise: Promise<void> | null = null;

export function stopTranslate(): void {
  activeJobAbort?.abort();
}

/** Abort only if the in-memory job is still running (used by CLEAR_JOB). */
export function abortIfRunning(): void {
  if (peekJob()?.phase === 'running') activeJobAbort?.abort();
}

function translateSourceHash(settings: AppSettings, title: string, description: string): string {
  return hashFromTranslateOptions(
    title,
    description,
    {
      protectedTerms: settings.protectedTerms,
      hashtagMode: settings.hashtagMode,
      chapterMode: settings.chapterMode,
      titleOver100: settings.titleOver100,
      protectLastSegment: settings.protectLastSegment,
    },
    settings.defaultSourceLanguage || 'en',
  );
}

function assertEngineConfigured(settings: AppSettings) {
  if (settings.engine === 'gemini' && !settings.geminiApiKey) {
    throw new Error('Gemini API key missing. Open Options to add it.');
  }
  if (settings.engine === 'deepl' && !settings.deeplApiKey) {
    throw new Error('DeepL API key missing. Open Options to add it.');
  }
}

/**
 * Starts (or rejects) a job and returns immediately with the job snapshot.
 * Work continues in the SW; progress streams via the vt-job port.
 */
export async function startTranslate(
  videoId: string,
  languagesOverride?: string[],
  skipExistingOverride?: boolean,
): Promise<StartTranslateResponse> {
  const running = peekJob();
  if (runningPromise && running?.phase === 'running') {
    return {
      ok: false,
      error: 'A translation job is already running. Stop it or wait, or use New session.',
      job: running,
    };
  }

  activeJobAbort?.abort();
  const abort = new AbortController();
  activeJobAbort = abort;

  const access = await resolveVideoAccess(videoId);
  if (!access.ok) {
    throw new Error(access.error);
  }
  const { channelId, token } = access.resolved;
  let video = access.resolved.video;

  const global = await getSettings();
  const channelPrefs = await getChannelSettings(channelId);
  const settings = mergeSettingsForChannel(global, channelPrefs);

  const selected = languagesOverride?.length ? languagesOverride : settings.selectedLanguages;
  if (!selected.length) {
    throw new Error('Select at least one language.');
  }
  assertEngineConfigured(settings);

  await patchChannelSettings(channelId, {
    selectedLanguages: selected,
    lastUsedLanguages: selected,
  });

  if (!video.snippet.defaultLanguage) {
    const defaultLanguage = settings.defaultSourceLanguage || 'en';
    video = settings.dryRun
      ? { ...video, snippet: { ...video.snippet, defaultLanguage } }
      : await ensureDefaultLanguage(video, token, defaultLanguage);
  }

  if (video.snippet.channelId !== channelId) {
    throw new Error('Refusing to translate: token channel does not match video channel.');
  }

  const skipExisting = skipExistingOverride ?? settings.skipExisting;
  const langs = filterLanguagesForTranslate(selected, video.localizations, {
    skipExisting,
    defaultLanguage: video.snippet.defaultLanguage,
  });

  if (!langs.length) {
    return { ok: true, skippedAll: true, job: null };
  }

  const title = video.snippet.title;
  const description = video.snippet.description;

  const job = reduceJob(null, {
    type: 'create',
    id: crypto.randomUUID(),
    videoId,
    channelId,
    languages: langs,
    dryRun: settings.dryRun,
    skipExisting,
    autoPublish: channelAutoPublish(channelPrefs) && !settings.dryRun,
    autoApprove: settings.autoApproveReview === true,
    sourceTitle: title,
    sourceDescription: description,
    defaultLanguage: video.snippet.defaultLanguage,
    engine: settings.engine,
  })!;
  await persistJob(job);

  runningPromise = runJob({
    job,
    settings,
    title,
    description,
    sourceHash: translateSourceHash(settings, title, description),
    abort,
  }).finally(() => {
    if (activeJobAbort === abort) activeJobAbort = null;
    runningPromise = null;
  });

  // Don't await runningPromise — return immediately so the message channel stays happy.
  return { ok: true, job, skippedAll: false };
}

type RunContext = {
  job: TranslateJob;
  settings: AppSettings;
  title: string;
  description: string;
  sourceHash: string;
  abort: AbortController;
};

/** Current in-memory job if it is still `jobId` (a new session may have replaced it). */
function currentJob(jobId: string): TranslateJob | null {
  const cur = peekJob();
  return cur && cur.id === jobId ? cur : null;
}

async function runJob(ctx: RunContext): Promise<void> {
  const { job, settings, title, description, sourceHash, abort } = ctx;
  const videoId = job.videoId;
  const autoPublisher = createAutoPublisher(job.id, videoId);

  const onProgress: ProgressCb = async (info) => {
    if (abort.signal.aborted && info.status === 'running') return;
    await updateJob(job.id, {
      type: 'progress',
      language: info.language || undefined,
      status: info.status,
      engine: info.engine,
      model: info.model,
      note: info.note,
      error: info.error,
      errorDetail: info.errorDetail,
      fatalSummary: info.fatalSummary,
      fatalHint: info.fatalHint,
      stopReason: info.stopReason,
      title: info.title,
      description: info.description,
      fullTitle: info.fullTitle,
      autoTitle: info.autoTitle,
      shortened: info.shortened,
      removed: info.removed,
      cached: info.cached,
    });
  };

  const onLanguageOk = async (result: LocalizationResult, meta: { cached: boolean }) => {
    const store = await getVideoTranslationCache(videoId);
    const prevHit = lookupCachedTranslation(store, videoId, result.language, sourceHash);
    const needsReview = needsTitleReview(result);
    // Cache keeps the real review state; auto-approve is applied per job only.
    await cacheTranslation(videoId, {
      language: result.language,
      sourceHash,
      title: result.title,
      description: result.description,
      fullTitle: result.fullTitle ?? result.title,
      autoTitle: result.autoTitle ?? result.title,
      shortened: result.shortened,
      removed: result.removed,
      reviewed: result.reviewed ?? !result.shortened,
      published: prevHit?.published,
    });
    // Ensure job has text even if progress raced
    const cur = currentJob(job.id);
    if (cur) {
      const alreadyLive = prevHit?.published === true && !needsReview;
      let next = reduceJob(cur, {
        type: 'progress',
        language: result.language,
        status: needsReview ? 'needs_review' : 'ok',
        title: result.title,
        description: result.description,
        fullTitle: result.fullTitle ?? result.title,
        autoTitle: result.autoTitle ?? result.title,
        shortened: result.shortened,
        removed: result.removed,
        cached: meta.cached,
        note: meta.cached ? 'cached' : undefined,
        published: alreadyLive,
      });
      if (next && alreadyLive) next = markJobPublished(next, [result.language]);
      if (next) await persistJob(next);
    }
    // Rows still in needs_review are never auto-published (auto-approved rows are).
    await autoPublisher.flush(false);
  };

  try {
    const { ok, failed, stopReason, fatalSummary, fatalHint } = await translateAllLanguages(
      title,
      description,
      job.languages,
      {
        ...settings,
        geminiAutoModel: await getGeminiAutoModel(),
        geminiJsonModeByModel: await getGeminiJsonModeByModel(),
        geminiExhaustedModels: await getGeminiExhaustedModels(),
      },
      onProgress,
      {
        abort,
        onGeminiModelResolved: (model) => setGeminiAutoModel(model),
        onGeminiJsonModeResolved: (model, jsonMode) => setGeminiModelJsonMode(model, jsonMode),
        onGeminiModelExhausted: (model, untilMs) => setGeminiModelExhausted(model, untilMs),
        lookupCache: async (language) => {
          const store = await getVideoTranslationCache(videoId);
          const hit = lookupCachedTranslation(store, videoId, language, sourceHash);
          return hit ? cachedToResult(hit) : null;
        },
        onLanguageOk,
      },
    );

    if (!currentJob(job.id)) return;

    // Final auto-publish flush before finishing (survives stop/fatal/circuit).
    await autoPublisher.flush(true);

    // Session cleared / replaced meanwhile — never resurrect it.
    const latest = currentJob(job.id);
    if (!latest) return;
    const hasPreview = ok.length > 0 || jobPreviewRows(latest).length > 0;
    let phase: 'done' | 'failed' | 'stopped' = 'done';
    if (stopReason === 'aborted') phase = 'stopped';
    else if (stopReason === 'fatal' || stopReason === 'circuit') {
      phase = hasPreview ? 'done' : 'failed';
    } else if (failed.length && !hasPreview) {
      phase = 'failed';
    }

    const finished = reduceJob(latest, {
      type: 'finish',
      phase,
      results: ok.length ? ok : jobPreviewRows(latest),
      failed,
      stopReason,
      fatalSummary,
      fatalHint,
    })!;
    await persistJob(finished);

    await logJobRun({
      videoId,
      startedAt: new Date(latest.startedAt).toISOString(),
      dryRun: settings.dryRun,
      ok: (ok.length ? ok : jobPreviewRows(finished)).map((r) => r.language),
      failed,
      autoApproved: jobAutoApproved(finished),
    });
  } catch (err) {
    if (!currentJob(job.id)) return;
    try {
      await autoPublisher.flush(true);
    } catch {
      /* already surfaced */
    }
    const latest = currentJob(job.id);
    if (!latest) return;
    const partial = jobResults(latest);
    const finished = reduceJob(latest, {
      type: 'finish',
      phase: partial.length ? 'done' : 'failed',
      results: partial,
      failed: jobFailed(latest),
      fatalSummary: err instanceof Error ? err.message : String(err),
      stopReason: 'fatal',
    });
    await persistJob(finished);
  }
}

/** Batches ready rows to YouTube while the job runs (auto-publish ON, dry-run OFF). */
function createAutoPublisher(jobId: string, videoId: string) {
  let lastFlushAt = Date.now();

  return {
    async flush(force: boolean): Promise<void> {
      const cur = currentJob(jobId);
      if (!cur || !cur.autoPublish || cur.dryRun) return;
      const pending = jobUnpublished(cur);
      const due = shouldAutoPublishFlush({
        unpublishedCount: pending.length,
        lastFlushAt,
        now: Date.now(),
        force,
      });
      if (!due) return;
      const languages = pending.map((p) => p.language);
      try {
        await publishLocalizations(videoId, pending, { endSessionWhenDone: false });
        lastFlushAt = Date.now();
        const after = currentJob(jobId);
        if (after) await persistJob(markJobPublished(after, languages));
        await markTranslationsPublished(videoId, languages);
      } catch (err) {
        await updateJob(jobId, {
          type: 'progress',
          fatalSummary: `Auto-publish failed: ${err instanceof Error ? err.message : String(err)}`,
          fatalHint: 'Translations are saved — use Publish in the preview to retry.',
        });
      }
    },
  };
}

/** SW restarted mid-job — mark stopped (can't resume in-flight fetch). */
export function recoverInterruptedJob(job: TranslateJob): TranslateJob {
  return reduceJob(job, {
    type: 'finish',
    phase: 'stopped',
    fatalSummary: 'Extension worker restarted. Progress below was saved; use Retry for remaining.',
    stopReason: 'aborted',
    results: jobResults(job),
    failed: jobFailed(job),
  })!;
}
