import type { LocalizationResult, TitleRemovalInfo, TranslateOptions } from './types.js';

// Auto-publish policy moved to autopublish.ts; re-exported for backward-compatible imports.
export {
  AUTO_PUBLISH_BATCH,
  AUTO_PUBLISH_BUCKET,
  AUTO_PUBLISH_INTERVAL_MS,
  shouldAutoPublishFlush,
} from './autopublish.js';

/** Cap distinct videos retained in the translation cache (LRU). */
export const CACHE_MAX_VIDEOS = 200;

/**
 * Cache entry schema version. Bumped when new fields are added.
 * Old entries without these fields remain readable (defaults applied in cachedToResult).
 */
export const CACHE_SCHEMA_VERSION = 2;

export type CacheHashInput = {
  title: string;
  description: string;
  protectedTerms: string[];
  hashtagMode: string;
  chapterMode: string;
  titleOver100: string;
  defaultSourceLanguage: string;
  protectLastSegment?: boolean;
};

export type CachedTranslation = {
  language: string;
  sourceHash: string;
  title: string;
  description: string;
  /** Schema version when written (missing = v1). */
  v?: number;
  fullTitle?: string;
  /** Auto-fitted title (Reset target); `title` may hold a user edit. Missing = `title`. */
  autoTitle?: string;
  shortened?: boolean;
  removed?: TitleRemovalInfo[];
  /** User cleared the review gate for a shortened title. */
  reviewed?: boolean;
  published?: boolean;
  touchedAt: number;
};

export type VideoCacheBucket = {
  touchedAt: number;
  /** language → entry (only the matching sourceHash is reusable). */
  byLang: Record<string, CachedTranslation>;
};

export type TranslationCacheStore = {
  videos: Record<string, VideoCacheBucket>;
};

export function emptyTranslationCache(): TranslationCacheStore {
  return { videos: {} };
}

/** Stable hash of source text + options that affect translation output. */
export function hashTranslationSource(input: CacheHashInput): string {
  const payload = JSON.stringify({
    t: input.title,
    d: input.description,
    p: input.protectedTerms,
    h: input.hashtagMode,
    c: input.chapterMode,
    o: input.titleOver100,
    s: input.defaultSourceLanguage,
    // v2: protectLastSegment affects fitted titles
    pl: input.protectLastSegment !== false,
  });
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h) ^ payload.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export function hashFromTranslateOptions(
  title: string,
  description: string,
  options: Pick<
    TranslateOptions,
    'protectedTerms' | 'hashtagMode' | 'chapterMode' | 'titleOver100' | 'protectLastSegment'
  >,
  defaultSourceLanguage: string,
): string {
  return hashTranslationSource({
    title,
    description,
    protectedTerms: options.protectedTerms,
    hashtagMode: options.hashtagMode,
    chapterMode: options.chapterMode,
    titleOver100: options.titleOver100,
    defaultSourceLanguage,
    protectLastSegment: options.protectLastSegment,
  });
}

export function lookupCachedTranslation(
  store: TranslationCacheStore,
  videoId: string,
  language: string,
  sourceHash: string,
): CachedTranslation | null {
  const entry = store.videos[videoId]?.byLang[language];
  if (!entry || entry.sourceHash !== sourceHash) return null;
  return entry;
}

export function putCachedTranslation(
  store: TranslationCacheStore,
  videoId: string,
  entry: Omit<CachedTranslation, 'touchedAt'> & { touchedAt?: number },
  now = Date.now(),
  maxVideos = CACHE_MAX_VIDEOS,
): TranslationCacheStore {
  const videos = { ...store.videos };
  const prev = videos[videoId] ?? { touchedAt: now, byLang: {} };
  const byLang = { ...prev.byLang };
  const prior = byLang[entry.language];
  byLang[entry.language] = {
    language: entry.language,
    sourceHash: entry.sourceHash,
    title: entry.title,
    description: entry.description,
    v: entry.v ?? CACHE_SCHEMA_VERSION,
    fullTitle: entry.fullTitle ?? prior?.fullTitle,
    autoTitle: entry.autoTitle ?? prior?.autoTitle,
    shortened: entry.shortened ?? prior?.shortened,
    removed: entry.removed ?? prior?.removed,
    reviewed: entry.reviewed ?? prior?.reviewed,
    published: entry.published ?? prior?.published,
    touchedAt: entry.touchedAt ?? now,
  };
  videos[videoId] = { touchedAt: now, byLang };
  return { videos: evictLruVideos(videos, maxVideos) };
}

export function markCachedPublished(
  store: TranslationCacheStore,
  videoId: string,
  languages: string[],
  now = Date.now(),
): TranslationCacheStore {
  const bucket = store.videos[videoId];
  if (!bucket) return store;
  const byLang = { ...bucket.byLang };
  for (const lang of languages) {
    if (byLang[lang]) {
      byLang[lang] = { ...byLang[lang], published: true, touchedAt: now };
    }
  }
  return {
    videos: {
      ...store.videos,
      [videoId]: { touchedAt: now, byLang },
    },
  };
}

export function markCachedReviewed(
  store: TranslationCacheStore,
  videoId: string,
  language: string,
  title: string,
  now = Date.now(),
): TranslationCacheStore {
  const bucket = store.videos[videoId];
  if (!bucket?.byLang[language]) return store;
  const byLang = { ...bucket.byLang };
  const prior = byLang[language];
  byLang[language] = {
    ...prior,
    autoTitle: prior.autoTitle ?? prior.title,
    title,
    reviewed: true,
    touchedAt: now,
  };
  return {
    videos: {
      ...store.videos,
      [videoId]: { touchedAt: now, byLang },
    },
  };
}

function evictLruVideos(
  videos: Record<string, VideoCacheBucket>,
  maxVideos: number,
): Record<string, VideoCacheBucket> {
  const ids = Object.keys(videos);
  if (ids.length <= maxVideos) return videos;
  const ordered = ids.sort((a, b) => videos[a].touchedAt - videos[b].touchedAt);
  const drop = ordered.slice(0, ids.length - maxVideos);
  const next = { ...videos };
  for (const id of drop) delete next[id];
  return next;
}

export function translationCacheStats(store: TranslationCacheStore): {
  videos: number;
  entries: number;
} {
  let entries = 0;
  for (const v of Object.values(store.videos)) {
    entries += Object.keys(v.byLang).length;
  }
  return { videos: Object.keys(store.videos).length, entries };
}

/** Convert cache entry to a localization result. Old (v1) entries stay readable. */
export function cachedToResult(entry: CachedTranslation): LocalizationResult {
  const fullTitle = entry.fullTitle ?? entry.title;
  const shortened = entry.shortened ?? false;
  return {
    language: entry.language,
    title: entry.title,
    description: entry.description,
    fullTitle,
    autoTitle: entry.autoTitle ?? entry.title,
    shortened,
    removed: entry.removed,
    reviewed: entry.reviewed ?? !shortened,
  };
}
