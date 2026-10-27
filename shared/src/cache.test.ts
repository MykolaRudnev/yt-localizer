import { describe, expect, it } from 'vitest';
import { mergeLocalizations } from './langs.js';
import {
  AUTO_PUBLISH_BATCH,
  AUTO_PUBLISH_INTERVAL_MS,
  cachedToResult,
  emptyTranslationCache,
  hashTranslationSource,
  lookupCachedTranslation,
  markCachedPublished,
  markCachedReviewed,
  putCachedTranslation,
  shouldAutoPublishFlush,
  translationCacheStats,
} from './cache.js';

const baseHashInput = {
  title: 'Hello',
  description: 'World',
  protectedTerms: ['Brand'],
  hashtagMode: 'keep',
  chapterMode: 'translate_labels',
  titleOver100: 'truncate',
  defaultSourceLanguage: 'en',
};

describe('hashTranslationSource', () => {
  it('is stable for same input and changes when source or options change', () => {
    const a = hashTranslationSource(baseHashInput);
    const b = hashTranslationSource(baseHashInput);
    expect(a).toBe(b);
    expect(hashTranslationSource({ ...baseHashInput, title: 'Hello!' })).not.toBe(a);
    expect(
      hashTranslationSource({ ...baseHashInput, hashtagMode: 'translate' }),
    ).not.toBe(a);
  });
});

describe('translation cache hit/miss', () => {
  it('hits when video+lang+hash match, misses on hash mismatch', () => {
    const hash = hashTranslationSource(baseHashInput);
    let store = emptyTranslationCache();
    store = putCachedTranslation(store, 'vid1', {
      language: 'es',
      sourceHash: hash,
      title: 'Hola',
      description: 'Mundo',
    });

    const hit = lookupCachedTranslation(store, 'vid1', 'es', hash);
    expect(hit).not.toBeNull();
    expect(cachedToResult(hit!)).toEqual({
      language: 'es',
      title: 'Hola',
      description: 'Mundo',
      fullTitle: 'Hola',
      autoTitle: 'Hola',
      shortened: false,
      removed: undefined,
      reviewed: true,
    });

    // Old v1-style entries (no fullTitle) remain readable
    expect(
      cachedToResult({
        language: 'de',
        sourceHash: hash,
        title: 'Hallo',
        description: 'Welt',
        touchedAt: 1,
      }),
    ).toMatchObject({
      language: 'de',
      title: 'Hallo',
      fullTitle: 'Hallo',
      shortened: false,
      reviewed: true,
    });

    const otherHash = hashTranslationSource({ ...baseHashInput, title: 'Changed' });
    expect(lookupCachedTranslation(store, 'vid1', 'es', otherHash)).toBeNull();
    expect(lookupCachedTranslation(store, 'vid1', 'de', hash)).toBeNull();
    expect(lookupCachedTranslation(store, 'other', 'es', hash)).toBeNull();
  });

  it('evicts LRU videos beyond cap', () => {
    let store = emptyTranslationCache();
    for (let i = 0; i < 5; i++) {
      store = putCachedTranslation(
        store,
        `v${i}`,
        {
          language: 'es',
          sourceHash: 'h',
          title: `t${i}`,
          description: 'd',
        },
        1000 + i,
        3,
      );
    }
    expect(Object.keys(store.videos).sort()).toEqual(['v2', 'v3', 'v4']);
    expect(translationCacheStats(store)).toEqual({ videos: 3, entries: 3 });
  });

  it('marks published without losing text', () => {
    const hash = hashTranslationSource(baseHashInput);
    let store = putCachedTranslation(emptyTranslationCache(), 'vid1', {
      language: 'es',
      sourceHash: hash,
      title: 'Hola',
      description: 'Mundo',
    });
    store = markCachedPublished(store, 'vid1', ['es']);
    expect(store.videos.vid1.byLang.es.published).toBe(true);
    expect(store.videos.vid1.byLang.es.title).toBe('Hola');
  });
});

describe('auto-publish batching + merge', () => {
  it('flushes on batch size, interval, or force', () => {
    expect(
      shouldAutoPublishFlush({
        unpublishedCount: AUTO_PUBLISH_BATCH,
        lastFlushAt: 0,
        now: 10,
      }),
    ).toBe(true);
    expect(
      shouldAutoPublishFlush({
        unpublishedCount: 1,
        lastFlushAt: 0,
        now: AUTO_PUBLISH_INTERVAL_MS,
      }),
    ).toBe(true);
    expect(
      shouldAutoPublishFlush({
        unpublishedCount: 1,
        lastFlushAt: 100,
        now: 200,
        force: true,
      }),
    ).toBe(true);
    expect(
      shouldAutoPublishFlush({
        unpublishedCount: 2,
        lastFlushAt: 100,
        now: 200,
      }),
    ).toBe(false);
    expect(
      shouldAutoPublishFlush({
        unpublishedCount: 0,
        lastFlushAt: 0,
        now: 999_999,
        force: true,
      }),
    ).toBe(false);
  });

  it('merges incoming localizations onto refetched existing without deleting others', () => {
    const existing = {
      es: { title: 'Old ES', description: 'old' },
      de: { title: 'DE', description: 'd' },
    };
    const incoming = {
      es: { title: 'New ES', description: 'new' },
      ja: { title: 'JA', description: 'j' },
    };
    expect(mergeLocalizations(existing, incoming)).toEqual({
      es: { title: 'New ES', description: 'new' },
      de: { title: 'DE', description: 'd' },
      ja: { title: 'JA', description: 'j' },
    });
  });
});

describe('cache autoTitle (Reset target) after a user edit', () => {
  it('keeps the auto-fitted title when the reviewed title is an edit', () => {
    let store = putCachedTranslation(emptyTranslationCache(), 'v', {
      language: 'es',
      sourceHash: 'h',
      title: 'Auto fit',
      description: 'd',
      fullTitle: 'Auto fit plus a much longer middle segment',
      shortened: true,
      reviewed: false,
    });
    store = markCachedReviewed(store, 'v', 'es', 'My edit');
    const r = cachedToResult(lookupCachedTranslation(store, 'v', 'es', 'h')!);
    expect(r.title).toBe('My edit');
    expect(r.autoTitle).toBe('Auto fit');
    expect(r.reviewed).toBe(true);
  });
});
