import { describe, expect, it } from 'vitest';
import {
  autoApprovedSummary,
  autoApproveResult,
  canAutoApproveTitle,
  needsTitleReview,
  partitionForPublish,
} from './review.js';
import type { LocalizationResult } from './types.js';

const shortened: LocalizationResult = {
  language: 'es',
  title: 'Fitted title',
  description: 'd',
  fullTitle: 'x'.repeat(120),
  shortened: true,
  reviewed: false,
};
const plain: LocalizationResult = { language: 'de', title: 'Kurz', description: 'd', reviewed: true };

describe('review helpers', () => {
  it('needsTitleReview / canAutoApproveTitle', () => {
    expect(needsTitleReview(shortened)).toBe(true);
    expect(needsTitleReview({ ...shortened, reviewed: true })).toBe(false);
    expect(needsTitleReview(plain)).toBe(false);
    expect(canAutoApproveTitle('x'.repeat(100))).toBe(true);
    expect(canAutoApproveTitle('x'.repeat(101))).toBe(false);
    expect(canAutoApproveTitle(undefined)).toBe(false);
  });

  it('autoApproveResult marks only rows that need review and fit', () => {
    expect(autoApproveResult(shortened)).toMatchObject({ reviewed: true, autoApproved: true });
    expect(autoApproveResult(plain)).toBe(plain);
    const over = { ...shortened, title: 'y'.repeat(101) };
    expect(autoApproveResult(over)).toBe(over);
  });

  it('partitionForPublish without auto-approve holds shortened rows back', () => {
    const p = partitionForPublish([shortened, plain], { autoApprove: false });
    expect(p.ready.map((r) => r.language)).toEqual(['de']);
    expect(p.needsReview.map((r) => r.language)).toEqual(['es']);
    expect(p.autoApproved).toEqual([]);
  });

  it('partitionForPublish with auto-approve publishes the fitted title', () => {
    const p = partitionForPublish([shortened, plain], { autoApprove: true });
    expect(p.ready.map((r) => [r.language, r.title])).toEqual([
      ['es', 'Fitted title'],
      ['de', 'Kurz'],
    ]);
    expect(p.needsReview).toEqual([]);
    expect(p.autoApproved).toEqual(['es']);
    expect(autoApprovedSummary(p.autoApproved.length)).toBe('1 auto-approved');
    expect(autoApprovedSummary(0)).toBe('');
  });
});
