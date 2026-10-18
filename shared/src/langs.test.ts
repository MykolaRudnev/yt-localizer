import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterLanguagesForTranslate,
  mergeLocalizations,
  TOP10_CODES,
  TOP10_RPM_CODES,
  TOP20_RPM_CODES,
} from './langs.js';

const languagesJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../languages.json'), 'utf8'),
) as {
  presets: Record<string, { label: string; codes: string[] }>;
};

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

describe('RPM presets', () => {
  it('Top 10 RPM matches languages.json and is length 10', () => {
    expect(TOP10_RPM_CODES).toHaveLength(10);
    expect([...TOP10_RPM_CODES]).toEqual(languagesJson.presets.top10rpm.codes);
  });

  it('Top 20 RPM extends Top 10 and matches languages.json', () => {
    expect(TOP20_RPM_CODES).toHaveLength(20);
    expect([...TOP20_RPM_CODES].slice(0, 10)).toEqual([...TOP10_RPM_CODES]);
    expect([...TOP20_RPM_CODES]).toEqual(languagesJson.presets.top20rpm.codes);
    expect(languagesJson.presets.top20rpm.label).toMatch(/Top 20 RPM/i);
  });
});
