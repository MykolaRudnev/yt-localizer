import { describe, expect, it } from 'vitest';
import {
  badgeForJob,
  isJobFinished,
  jobEta,
  jobFailed,
  jobNeedsReview,
  jobPercent,
  jobPreviewRows,
  jobPublishCounts,
  jobResults,
  jobUnpublished,
  markJobPublished,
  needsDiscardPreviewConfirm,
  reduceJob,
  shouldEndSessionOnClose,
  shouldReopenExistingJob,
  shouldShowJobWidget,
  type TranslateJob,
} from './job.js';

function createJob(langs = ['es', 'de', 'ja']): TranslateJob {
  const job = reduceJob(null, {
    type: 'create',
    id: 'j1',
    videoId: 'vid1',
    languages: langs,
    dryRun: true,
    skipExisting: true,
    engine: 'gemini',
    startedAt: 1_000,
  });
  if (!job) throw new Error('expected job');
  return job;
}

describe('reduceJob', () => {
  it('creates running job with pending languages', () => {
    const job = createJob();
    expect(job.phase).toBe('running');
    expect(job.totalCount).toBe(3);
    expect(job.doneCount).toBe(0);
    expect(job.langStates.es.status).toBe('pending');
  });

  it('tracks per-language progress and engine·model', () => {
    let job = createJob();
    job = reduceJob(job, {
      type: 'progress',
      language: 'es',
      status: 'running',
      engine: 'gemini',
      model: 'gemini-2.5-flash',
    })!;
    expect(job.langStates.es.status).toBe('running');
    expect(job.langStates.es.engine).toBe('gemini');
    expect(job.langStates.es.model).toBe('gemini-2.5-flash');
    expect(job.doneCount).toBe(0);

    job = reduceJob(job, {
      type: 'progress',
      language: 'es',
      status: 'ok',
      title: 'Hola',
      description: 'Desc',
    })!;
    expect(job.doneCount).toBe(1);
    expect(jobPercent(job)).toBe(33);
  });

  it('finish merges results and failed', () => {
    let job = createJob();
    job = reduceJob(job, {
      type: 'finish',
      phase: 'done',
      results: [{ language: 'es', title: 'T', description: 'D' }],
      failed: [{ language: 'de', error: 'quota' }],
      finishedAt: 5_000,
    })!;
    expect(job.phase).toBe('done');
    expect(jobResults(job)).toMatchObject([{ language: 'es', title: 'T', description: 'D' }]);
    expect(jobFailed(job)).toEqual([{ language: 'de', error: 'quota' }]);
    expect(job.doneCount).toBe(2);
  });

  it('keeps partial ok results for preview after fatal/stop (titles stored on progress)', () => {
    let job = createJob(['es', 'de', 'ja']);
    job = reduceJob(job, {
      type: 'progress',
      language: 'es',
      status: 'ok',
      title: 'Hola',
      description: 'Mundo',
      cached: true,
    })!;
    job = reduceJob(job, {
      type: 'progress',
      language: 'de',
      status: 'ok',
      title: 'Hallo',
      description: 'Welt',
    })!;
    // Fatal before ja — finish with whatever we have (simulate catch / circuit)
    job = reduceJob(job, {
      type: 'finish',
      phase: 'done',
      results: jobResults(job),
      failed: [],
      stopReason: 'fatal',
      fatalSummary: 'API blew up',
    })!;
    expect(jobResults(job)).toMatchObject([
      { language: 'es', title: 'Hola', description: 'Mundo' },
      { language: 'de', title: 'Hallo', description: 'Welt' },
    ]);
    expect(job.langStates.es.cached).toBe(true);
    expect(job.phase).toBe('done');
    // Preview publishable = unpublished ok rows
    expect(jobUnpublished(job)).toHaveLength(2);
    job = markJobPublished(job, ['es']);
    expect(jobUnpublished(job).map((r) => r.language)).toEqual(['de']);
  });
});

describe('shouldReopenExistingJob', () => {
  it('reopens running/done/failed/stopped for same video', () => {
    const base = createJob();
    expect(shouldReopenExistingJob(base, 'vid1')).toBe(true);
    expect(shouldReopenExistingJob({ ...base, phase: 'done' }, 'vid1')).toBe(true);
    expect(shouldReopenExistingJob({ ...base, phase: 'failed' }, 'vid1')).toBe(true);
    expect(shouldReopenExistingJob({ ...base, phase: 'stopped' }, 'vid1')).toBe(true);
  });

  it('does not reopen for a different video or missing job', () => {
    const job = createJob();
    expect(shouldReopenExistingJob(job, 'other')).toBe(false);
    expect(shouldReopenExistingJob(null, 'vid1')).toBe(false);
  });

  it('new translation requires explicit discard of existing job', () => {
    // Picker should only open when reopen is false — callers must confirm before clear.
    const job = createJob();
    expect(shouldReopenExistingJob(job, 'vid1')).toBe(true);
    expect(shouldReopenExistingJob(null, 'vid1')).toBe(false);
  });
});

describe('session close lifecycle', () => {
  it('ends session on close only when job is finished (not running)', () => {
    const running = createJob();
    expect(isJobFinished(running)).toBe(false);
    expect(shouldEndSessionOnClose(running)).toBe(false);

    for (const phase of ['done', 'failed', 'stopped'] as const) {
      const finished = { ...running, phase };
      expect(isJobFinished(finished)).toBe(true);
      expect(shouldEndSessionOnClose(finished)).toBe(true);
    }
    expect(shouldEndSessionOnClose(null)).toBe(false);
  });

  it('asks confirm only when finished job has unpublished preview rows', () => {
    let job = createJob(['es', 'de']);
    job = reduceJob(job, {
      type: 'finish',
      phase: 'done',
      results: [{ language: 'es', title: 'Hola', description: 'x' }],
    })!;
    expect(needsDiscardPreviewConfirm(job)).toBe(true);

    job = markJobPublished(job, ['es']);
    expect(needsDiscardPreviewConfirm(job)).toBe(false);

    const failedOnly = reduceJob(createJob(['de']), {
      type: 'finish',
      phase: 'failed',
      failed: [{ language: 'de', error: 'boom' }],
    })!;
    expect(needsDiscardPreviewConfirm(failedOnly)).toBe(false);

    const running = createJob();
    expect(needsDiscardPreviewConfirm(running)).toBe(false);
  });

  it('shows status widget only while job is running (not finished / cleared)', () => {
    const running = createJob();
    expect(shouldShowJobWidget(running)).toBe(true);
    expect(shouldShowJobWidget(null)).toBe(false);

    for (const phase of ['done', 'failed', 'stopped'] as const) {
      expect(shouldShowJobWidget({ ...running, phase })).toBe(false);
    }

    // Session end (CLEAR_JOB → null): widget must stay gone across reload/SPA
    expect(shouldShowJobWidget(null)).toBe(false);
    expect(badgeForJob(null).text).toBe('');
  });
});

describe('review gate + publish counts', () => {
  const longFull =
    'Dance of the Stone Circle | Dark Fantasy Ambient Soundscape for Deep Concentration | 1.5 Hours | Focus & Sleep';

  function shortenedJob(): TranslateJob {
    let job = createJob(['es', 'de']);
    job = reduceJob(job, {
      type: 'progress',
      language: 'es',
      status: 'needs_review',
      title: longFull.slice(0, 90),
      description: 'd',
      fullTitle: longFull,
      autoTitle: longFull.slice(0, 90),
      shortened: true,
    })!;
    job = reduceJob(job, {
      type: 'progress',
      language: 'de',
      status: 'ok',
      title: 'Kurz',
      description: 'd',
      shortened: false,
    })!;
    return reduceJob(job, { type: 'finish', phase: 'done' })!;
  }

  it('blocks shortened rows until approve or edit', () => {
    let job = shortenedJob();
    expect(jobNeedsReview(job).map((r) => r.language)).toEqual(['es']);
    expect(jobResults(job).map((r) => r.language)).toEqual(['de']);
    expect(jobUnpublished(job).map((r) => r.language)).toEqual(['de']);
    expect(jobPublishCounts(job)).toEqual({ ready: 1, needReview: 1 });
    expect(jobPreviewRows(job)).toHaveLength(2);

    job = reduceJob(job, { type: 'review', language: 'es', action: 'approve' })!;
    expect(job.langStates.es.status).toBe('ok');
    expect(jobNeedsReview(job)).toHaveLength(0);
    expect(jobPublishCounts(job).ready).toBe(2);
  });

  it('edit unblocks when ≤100; use full stays blocked when over; reset restores auto', () => {
    let job = shortenedJob();
    job = reduceJob(job, {
      type: 'review',
      language: 'es',
      action: 'edit',
      title: 'Short enough title',
    })!;
    expect(job.langStates.es.status).toBe('ok');
    expect(job.langStates.es.title).toBe('Short enough title');

    job = shortenedJob();
    job = reduceJob(job, { type: 'review', language: 'es', action: 'use_full' })!;
    expect(job.langStates.es.title).toBe(longFull);
    expect(job.langStates.es.status).toBe('needs_review');

    job = reduceJob(job, { type: 'review', language: 'es', action: 'reset' })!;
    expect(job.langStates.es.title).toBe(job.langStates.es.autoTitle);
    expect(job.langStates.es.status).toBe('needs_review');
  });

  it('auto-publish skip: jobUnpublished never includes needs_review', () => {
    const job = shortenedJob();
    expect(jobUnpublished(job).every((r) => r.language !== 'es')).toBe(true);
  });

  it('shows widget when finished with pending reviews', () => {
    const job = shortenedJob();
    expect(shouldShowJobWidget(job)).toBe(true);
    expect(needsDiscardPreviewConfirm(job)).toBe(true);
  });
});

describe('jobEta / badgeForJob', () => {
  it('estimates ETA from average pace', () => {
    let job = createJob(['a', 'b', 'c', 'd']);
    job = reduceJob(job, {
      type: 'progress',
      language: 'a',
      status: 'ok',
      title: 'x',
      description: 'y',
    })!;
    // 1 done in 1000ms from startedAt=1000 → at t=2000, 3 left ≈ 3s
    expect(jobEta(job, 2_000)).toBe('~3s left');
  });

  it('badge colors: blue running/done, red failed; cleared when no job', () => {
    const running = createJob();
    expect(badgeForJob(running).color).toBe('#3b82f6');
    expect(badgeForJob(running).text).toBe('0/3');

    const done = reduceJob(running, {
      type: 'finish',
      phase: 'done',
      results: [
        { language: 'es', title: 'a', description: '' },
        { language: 'de', title: 'b', description: '' },
        { language: 'ja', title: 'c', description: '' },
      ],
    })!;
    expect(badgeForJob(done).color).toBe('#3b82f6');

    const failed = reduceJob(running, {
      type: 'finish',
      phase: 'done',
      results: [{ language: 'es', title: 'a', description: '' }],
      failed: [{ language: 'de', error: 'x' }],
    })!;
    expect(badgeForJob(failed).color).toBe('#ef4444');
    expect(badgeForJob(null).text).toBe('');
  });
});
