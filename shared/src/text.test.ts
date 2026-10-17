import { describe, expect, it } from 'vitest';
import {
  applyTitleLimit,
  extractHashtags,
  findChapterBlocks,
  prepareForTranslation,
  protectHashtags,
  protectTerms,
  restoreAfterTranslation,
  truncateTitleAtWordBoundary,
} from './text.js';

describe('title truncation', () => {
  it('leaves short titles alone', () => {
    expect(truncateTitleAtWordBoundary('Hello world')).toBe('Hello world');
  });

  it('truncates at word boundary under 100', () => {
    const long = 'Word '.repeat(30).trim(); // 149 chars
    const out = truncateTitleAtWordBoundary(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('Word')).toBe(true);
    expect(out.includes('  ')).toBe(false);
  });

  it('applyTitleLimit respects truncate mode', () => {
    const title = 'a'.repeat(120);
    expect(applyTitleLimit(title, 'truncate').length).toBeLessThanOrEqual(100);
  });
});

describe('hashtags', () => {
  it('extracts hashtags', () => {
    expect(extractHashtags('Hello #VeilOfVeles and #Slavic')).toEqual([
      '#VeilOfVeles',
      '#Slavic',
    ]);
  });

  it('protects hashtags when mode is keep', () => {
    const { text, map } = protectHashtags('See #KeepMe please', 'keep');
    expect(text).not.toContain('#KeepMe');
    expect([...map.values()]).toContain('#KeepMe');
  });

  it('does not protect when mode is translate', () => {
    const { text, map } = protectHashtags('See #KeepMe please', 'translate');
    expect(text).toContain('#KeepMe');
    expect(map.size).toBe(0);
  });
});

describe('protected terms', () => {
  it('masks Veil of Veles case-insensitively', () => {
    const { text, map } = protectTerms('Welcome to veil of veles channel', ['Veil of Veles']);
    expect(text.toLowerCase()).not.toContain('veil of veles');
    expect([...map.values()]).toContain('Veil of Veles');
  });

  it('round-trips through prepare/restore', () => {
    const title = 'Veil of Veles — new video #Myth';
    const desc = 'Watch on https://example.com/@veil and say hi to Veil of Veles\n#Myth';
    const prepared = prepareForTranslation(title, desc, {
      protectedTerms: ['Veil of Veles'],
      hashtagMode: 'keep',
      chapterMode: 'keep',
      titleOver100: 'truncate',
    });
    expect(prepared.title).not.toMatch(/Veil of Veles/i);
    expect(prepared.description).not.toContain('https://');
    const restoredTitle = restoreAfterTranslation(prepared.title, prepared.maps);
    const restoredDesc = restoreAfterTranslation(prepared.description, prepared.maps);
    expect(restoredTitle).toContain('Veil of Veles');
    expect(restoredDesc).toContain('https://example.com/@veil');
    expect(restoredDesc).toContain('#Myth');
  });
});

describe('chapters', () => {
  it('detects 3+ ascending timestamp lines', () => {
    const desc = [
      'Intro text',
      '0:00 Intro',
      '1:00 Chapter one',
      '2:30 Chapter two',
      'More text',
    ].join('\n');
    const blocks = findChapterBlocks(desc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toHaveLength(3);
    expect(blocks[0].lines[0].timestamp).toBe('0:00');
  });

  it('keeps chapter lines as placeholders when mode is keep', () => {
    const desc = '0:00 A\n1:00 B\n2:00 C\n';
    const prepared = prepareForTranslation('t', desc, {
      protectedTerms: [],
      hashtagMode: 'keep',
      chapterMode: 'keep',
      titleOver100: 'truncate',
    });
    expect(prepared.description).toMatch(/__CHLINE_/);
    const restored = restoreAfterTranslation(prepared.description, prepared.maps);
    expect(restored).toContain('0:00 A');
    expect(restored).toContain('2:00 C');
  });

  it('protects timestamps when translating labels', () => {
    const desc = '0:00 Intro\n1:00 Middle\n2:00 End\n';
    const prepared = prepareForTranslation('t', desc, {
      protectedTerms: [],
      hashtagMode: 'keep',
      chapterMode: 'translate_labels',
      titleOver100: 'truncate',
    });
    expect(prepared.description).toMatch(/__TS_/);
    const restored = restoreAfterTranslation(prepared.description, prepared.maps);
    expect(restored).toContain('0:00');
    expect(restored).toContain('2:00');
  });
});
