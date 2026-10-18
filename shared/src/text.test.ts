import { describe, expect, it } from 'vitest';
import {
  applyTitleLimit,
  extractHashtags,
  findChapterBlocks,
  fitTitle,
  isDurationPhrase,
  prepareForTranslation,
  protectHashtags,
  protectTerms,
  restoreAfterTranslation,
  titleRemovalDiff,
  truncateTitleAtWordBoundary,
  YT_TITLE_MAX,
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

describe('duration phrase detection', () => {
  it.each([
    ['1.5 Hours', true],
    ['1,5 часа', true],
    ['90 min', true],
    ['1 Hour', true],
    ['2h', true],
    ['3 Stunden', true],
    ['1,5 horas', true],
    ['1.5 時間', true],
    ['Focus & Sleep', false],
    ['Dark Fantasy Music', false],
  ])('%s → %s', (text, expected) => {
    expect(isDurationPhrase(text)).toBe(expected);
  });
});

describe('segment-aware fitTitle', () => {
  const musicEn =
    'Dance of the Stone Circle | Dark Fantasy Ambient Soundscape for Deep Concentration Sessions | 1.5 Hours | Focus & Sleep';

  it('protects first segment, duration, and last segment (default)', () => {
    expect(musicEn.length).toBeGreaterThan(YT_TITLE_MAX);
    const result = fitTitle(musicEn);
    expect(result.shortened).toBe(true);
    expect(result.fullTitle).toBe(musicEn);
    expect(result.title.length).toBeLessThanOrEqual(YT_TITLE_MAX);
    expect(result.title.startsWith('Dance of the Stone Circle')).toBe(true);
    expect(result.title).toMatch(/1\.5 Hours/);
    expect(result.title).toMatch(/Focus & Sleep/);
    // Middle generic segment should be the one shortened/dropped
    expect(result.removed.length).toBeGreaterThan(0);
  });

  it('protects duration in ru / de / es / pt / ja titles', () => {
    const samples = [
      'Круг камня | Тёмная фэнтези музыка для концентрации | 1,5 часа | Фокус и сон',
      'Steinkreis-Tanz | Dunkle Fantasy-Musik zur Konzentration | 3 Stunden | Fokus & Schlaf',
      'Danza del círculo | Música fantasy oscura para concentrarse | 1,5 horas | Enfoque y sueño',
      'Dança do círculo | Música fantasy escura para foco | 90 min | Foco e sono',
      'ストーンサークルの舞｜集中のためのダークファンタジー｜1.5 時間｜フォーカスと睡眠',
    ];
    for (const full of samples) {
      // Pad middle if needed so we actually exceed 100
      const padded =
        full.length > YT_TITLE_MAX
          ? full
          : full.replace(
              /(\||—|–|｜)/,
              ' | Very Long Generic Middle Ambient Soundscape Passage For Testing | ',
            );
      const result = fitTitle(padded);
      expect(result.title.length).toBeLessThanOrEqual(YT_TITLE_MAX);
      expect(isDurationPhrase(result.title) || /1[,.]5|90 min|3 Stunden|時間/.test(result.title)).toBe(
        true,
      );
    }
  });

  it('always keeps the first segment', () => {
    const full =
      'BrandName Opening Phrase That Must Stay | filler filler filler filler filler filler filler filler filler filler filler | 2h | End';
    const result = fitTitle(full);
    expect(result.title.startsWith('BrandName Opening Phrase That Must Stay')).toBe(true);
  });

  it('protects user protected terms in middle segments', () => {
    const full =
      'Intro Track | Acme Studio Special Edition Long Descriptive Subtitle That Goes On And On Forever | 1 Hour | Sleep';
    const without = fitTitle(full, { protectedTerms: [] });
    const withTerm = fitTitle(full, { protectedTerms: ['Acme Studio'] });
    expect(withTerm.title).toMatch(/Acme Studio/);
    // Without protection the Acme segment is eligible to drop/shorten
    expect(without.fullTitle).toBe(full);
    expect(withTerm.shortened).toBe(true);
  });

  it('can drop last segment when protectLastSegment is false', () => {
    const full =
      'Short Intro | Extremely Long Generic Middle Segment Filled With Many Many Words About Ambient Soundscapes And Texture | 1 Hour | Focus & Sleep Extra Trailing Words';
    const protectedLast = fitTitle(full, { protectLastSegment: true });
    const unprotectedLast = fitTitle(full, { protectLastSegment: false });
    expect(protectedLast.title).toMatch(/Focus & Sleep/);
    // When last is unprotected it may be dropped in favor of keeping duration + first
    expect(unprotectedLast.title.length).toBeLessThanOrEqual(YT_TITLE_MAX);
    expect(unprotectedLast.title).toMatch(/1 Hour/);
  });

  it('hard-cap fallback when protected parts alone exceed 100', () => {
    const first = 'A'.repeat(60);
    const duration = '1.5 Hours of Continuous Playback';
    const last = 'B'.repeat(60);
    const full = `${first} | ${duration} | ${last}`;
    const result = fitTitle(full, { protectLastSegment: true });
    expect(result.title.length).toBeLessThanOrEqual(YT_TITLE_MAX);
    expect(result.shortened).toBe(true);
    expect(result.removed.some((r) => r.kind === 'truncated' || r.kind === 'shortened' || r.kind === 'dropped')).toBe(
      true,
    );
  });

  it('does not shorten titles already within limit', () => {
    const short = 'Hello | World | 1 Hour';
    const result = fitTitle(short);
    expect(result).toEqual({
      title: short,
      fullTitle: short,
      shortened: false,
      removed: [],
    });
  });

  it('titleRemovalDiff marks dropped segments', () => {
    const full =
      'Keep | Drop This Long Middle Part Entirely From The Title Now With Extra Ambient Soundscape Words Here | 1h | End';
    expect(full.length).toBeGreaterThan(YT_TITLE_MAX);
    const fitted = fitTitle(full);
    expect(fitted.shortened).toBe(true);
    const diff = titleRemovalDiff(fitted.fullTitle, fitted.title);
    expect(diff.some((d) => d.removed)).toBe(true);
    expect(diff.some((d) => !d.removed && d.text.includes('Keep'))).toBe(true);
  });
});

describe('hashtags', () => {
  it('extracts hashtags', () => {
    expect(extractHashtags('Hello #AcmeChannel and #Slavic')).toEqual([
      '#AcmeChannel',
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
  it('masks brand names case-insensitively', () => {
    const { text, map } = protectTerms('Welcome to acme studio channel', ['Acme Studio']);
    expect(text.toLowerCase()).not.toContain('acme studio');
    expect([...map.values()]).toContain('Acme Studio');
  });

  it('round-trips through prepare/restore', () => {
    const title = 'Acme Studio — new video #Myth';
    const desc = 'Watch on https://example.com/@acme and say hi to Acme Studio\n#Myth';
    const prepared = prepareForTranslation(title, desc, {
      protectedTerms: ['Acme Studio'],
      hashtagMode: 'keep',
      chapterMode: 'keep',
      titleOver100: 'truncate',
    });
    expect(prepared.title).not.toMatch(/Acme Studio/i);
    expect(prepared.description).not.toContain('https://');
    const restoredTitle = restoreAfterTranslation(prepared.title, prepared.maps);
    const restoredDesc = restoreAfterTranslation(prepared.description, prepared.maps);
    expect(restoredTitle).toContain('Acme Studio');
    expect(restoredDesc).toContain('https://example.com/@acme');
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
