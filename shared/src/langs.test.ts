import { describe, expect, it } from 'vitest';
import {
  filterLanguagesForTranslate,
  mergeLocalizations,
  TOP10_CODES,
} from './langs.js';

describe('filterLanguagesForTranslate', () => {
  const existing = {
    es: { title: 'Hola', description: 'Desc' },
    de: { title: 'Hallo', description: 'Desc' },
  };

  it('skips languages that already have a localization when skipExisting is on', () => {
    const out = filterLanguagesForTranslate(['es', 'fr', 'de', 'ja'], existing, {
      skipExisting: true,
      defaultLanguage: 'en',
    });
    expect(out).toEqual(['fr', 'ja']);
  });

  it('keeps existing languages when skipExisting is off (overwrite)', () => {
    const out = filterLanguagesForTranslate(['es', 'fr', 'de'], existing, {
      skipExisting: false,
      defaultLanguage: 'en',
    });
    expect(out).toEqual(['es', 'fr', 'de']);
  });

  it('always drops the video defaultLanguage', () => {
    const out = filterLanguagesForTranslate(['en', 'es', 'fr'], {}, {
      skipExisting: true,
      defaultLanguage: 'en',
    });
    expect(out).toEqual(['es', 'fr']);
  });

  it('handles undefined existing localizations', () => {
    const out = filterLanguagesForTranslate(['es', 'pt'], undefined, {
      skipExisting: true,
    });
    expect(out).toEqual(['es', 'pt']);
  });
});

describe('mergeLocalizations', () => {
  it('merges without deleting unrelated languages', () => {
    const existing = {
      es: { title: 'Old ES', description: 'A' },
      de: { title: 'DE', description: 'B' },
    };
    const incoming = {
      es: { title: 'New ES', description: 'C' },
      fr: { title: 'FR', description: 'D' },
    };
    expect(mergeLocalizations(existing, incoming)).toEqual({
      es: { title: 'New ES', description: 'C' },
      de: { title: 'DE', description: 'B' },
      fr: { title: 'FR', description: 'D' },
    });
  });

  it('works when existing is undefined', () => {
    expect(
      mergeLocalizations(undefined, { ja: { title: 'JP', description: 'x' } }),
    ).toEqual({ ja: { title: 'JP', description: 'x' } });
  });
});

describe('TOP10_CODES', () => {
  it('has ten popular languages including es/pt/hi', () => {
    expect(TOP10_CODES).toHaveLength(10);
    expect(TOP10_CODES).toEqual(
      expect.arrayContaining(['es', 'pt', 'hi', 'ar', 'fr', 'de', 'ru', 'ja', 'id', 'ko']),
    );
  });
});
