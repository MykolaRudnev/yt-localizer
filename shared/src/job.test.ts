import { describe, expect, it } from 'vitest';
import {
  badgeForJob,
  jobEta,
  jobFailed,
  jobPercent,
  jobResults,
  reduceJob,
  shouldReopenExistingJob,
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
    expect(jobResults(job)).toEqual([{ language: 'es', title: 'T', description: 'D' }]);
    expect(jobFailed(job)).toEqual([{ language: 'de', error: 'quota' }]);
    expect(job.doneCount).toBe(2);
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

  it('badge colors: blue running, green done, red failed', () => {
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
    expect(badgeForJob(done).color).toBe('#22c55e');

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
