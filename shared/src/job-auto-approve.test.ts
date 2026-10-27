import { describe, expect, it } from 'vitest';
import {
  jobAutoApproved,
  jobNeedsReview,
  jobPublishCounts,
  jobResults,
  jobUnpublished,
  markJobPublished,
  publishButtonLabel,
  reduceJob,
  shouldShowJobWidget,
  type TranslateJob,
} from './job.js';

const longFull =
  'Dance of the Stone Circle | Dark Fantasy Ambient Soundscape for Deep Concentration | 1.5 Hours | Focus & Sleep';
const fitted = 'Dance of the Stone Circle | 1.5 Hours | Focus & Sleep';

function job(autoApprove?: boolean): TranslateJob {
  let j = reduceJob(null, {
    type: 'create',
    id: 'j1',
    videoId: 'vid1',
    languages: ['es', 'de', 'fr'],
    dryRun: false,
    skipExisting: true,
    autoApprove,
    startedAt: 1000,
  })!;
  j = reduceJob(j, {
    type: 'progress',
    language: 'es',
    status: 'needs_review',
    title: fitted,
    description: 'd',
    fullTitle: longFull,
    autoTitle: fitted,
    shortened: true,
  })!;
  j = reduceJob(j, {
    type: 'progress',
    language: 'de',
    status: 'ok',
    title: 'Kurz',
    description: 'd',
    shortened: false,
  })!;
  return j;
}

describe('auto-approve review items', () => {
  it('OFF (default): shortened rows stay in needs_review exactly as before', () => {
    for (const j of [job(), job(false)]) {
      expect(j.langStates.es.status).toBe('needs_review');
      expect(j.langStates.es.autoApproved).toBeUndefined();
      expect(jobAutoApproved(j)).toEqual([]);
      expect(jobPublishCounts(j)).toEqual({ ready: 1, needReview: 1, autoApproved: 0 });
      expect(publishButtonLabel(jobPublishCounts(j))).toBe('Publish 1 ready (1 need review)');
    }
  });

  it('ON: shortened rows are approved with the fitted title and become publishable', () => {
    const j = job(true);
    expect(j.langStates.es.status).toBe('ok');
    expect(j.langStates.es.autoApproved).toBe(true);
    expect(j.langStates.es.title).toBe(fitted);
    expect(jobNeedsReview(j)).toHaveLength(0);
    expect(jobAutoApproved(j)).toEqual(['es']);
    // Background auto-publish flushes jobUnpublished()
    expect(jobUnpublished(j).map((r) => r.language)).toEqual(['es', 'de']);
    expect(jobResults(j).find((r) => r.language === 'es')?.autoApproved).toBe(true);
    expect(jobPublishCounts(j)).toEqual({ ready: 2, needReview: 0, autoApproved: 1 });
    expect(publishButtonLabel(jobPublishCounts(j))).toBe('Publish 2');
  });

  it('ON: rows arriving later (incl. finish) are auto-approved too', () => {
    let j = job(true);
    j = reduceJob(j, {
      type: 'finish',
      phase: 'done',
      results: [
        {
          language: 'fr',
          title: 'Titre court',
          description: 'd',
          fullTitle: `${longFull} FR`,
          shortened: true,
          reviewed: false,
        },
      ],
    })!;
    expect(j.langStates.fr.status).toBe('ok');
    expect(jobAutoApproved(j)).toEqual(['es', 'fr']);
    expect(shouldShowJobWidget(j)).toBe(false);
  });

  it('never auto-approves a title over the limit', () => {
    let j = job(true);
    j = reduceJob(j, { type: 'review', language: 'es', action: 'use_full' })!;
    expect(j.langStates.es.title).toBe(longFull);
    expect(j.langStates.es.status).toBe('needs_review');
    expect(j.langStates.es.autoApproved).toBe(false);
  });

  it('manual edit clears the auto-approved badge; reset re-applies it', () => {
    let j = job(true);
    j = reduceJob(j, { type: 'review', language: 'es', action: 'edit', title: 'Mine' })!;
    expect(j.langStates.es.status).toBe('ok');
    expect(j.langStates.es.autoApproved).toBe(false);
    expect(jobAutoApproved(j)).toEqual([]);

    j = reduceJob(j, { type: 'review', language: 'es', action: 'reset' })!;
    expect(j.langStates.es.title).toBe(fitted);
    expect(j.langStates.es.status).toBe('ok');
    expect(j.langStates.es.autoApproved).toBe(true);
  });

  it('toggling ON mid-job approves pending reviews; OFF sends unpublished ones back', () => {
    let j = job(false);
    j = reduceJob(j, { type: 'set_auto_approve', enabled: true })!;
    expect(j.autoApprove).toBe(true);
    expect(jobAutoApproved(j)).toEqual(['es']);

    j = reduceJob(j, { type: 'set_auto_approve', enabled: false })!;
    expect(j.autoApprove).toBe(false);
    expect(j.langStates.es.status).toBe('needs_review');
    expect(jobAutoApproved(j)).toEqual([]);
  });

  it('turning OFF keeps already-published auto-approved rows as published', () => {
    let j = markJobPublished(job(true), ['es']);
    j = reduceJob(j, { type: 'set_auto_approve', enabled: false })!;
    expect(j.langStates.es.status).toBe('ok');
    expect(j.langStates.es.published).toBe(true);
    expect(jobNeedsReview(j)).toHaveLength(0);
  });
});
