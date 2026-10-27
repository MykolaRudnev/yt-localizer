import type { TitleRemovalInfo, TranslateOptions } from '../types.js';
import { YT_TITLE_MAX } from '../limits.js';
import { fitTitle, isDurationPhrase, splitTitleSegments } from './fit.js';

export type FinalizedTitle = {
  title: string;
  fullTitle: string;
  shortened: boolean;
  removed: TitleRemovalInfo[];
  autoTitle: string;
};

/** Phrases the AI shortener must keep verbatim (first / duration / last segment, user terms). */
export function protectedTitlePhrases(fullTitle: string, options: TranslateOptions): string[] {
  const phrases: string[] = [];
  const protectLast = options.protectLastSegment !== false;
  const segs = splitTitleSegments(fullTitle);
  if (segs[0]) phrases.push(segs[0]);
  for (const seg of segs) {
    if (isDurationPhrase(seg)) phrases.push(seg);
  }
  if (protectLast && segs.length > 1) phrases.push(segs[segs.length - 1]);
  for (const term of options.protectedTerms) {
    if (term && fullTitle.toLowerCase().includes(term.toLowerCase())) phrases.push(term);
  }
  return [...new Set(phrases)];
}

/**
 * Fit a translated title to the YouTube limit. When the AI already proposed a
 * shorter title (`preferredFitted`), it still passes the local safety fit and is
 * compared against the full translation for the review gate.
 */
export function finalizeTitle(
  fullTitle: string,
  options: TranslateOptions,
  preferredFitted?: string,
): FinalizedTitle {
  const fitOpts = {
    protectedTerms: options.protectedTerms,
    protectLastSegment: options.protectLastSegment,
    max: YT_TITLE_MAX,
  };
  if (preferredFitted && preferredFitted !== fullTitle) {
    const safety = fitTitle(preferredFitted, fitOpts);
    const shortened = safety.title !== fullTitle || fullTitle.length > YT_TITLE_MAX;
    return {
      title: safety.title,
      fullTitle,
      shortened: shortened || safety.shortened,
      removed: safety.removed.length
        ? safety.removed
        : shortened
          ? [{ text: '(AI shortened)', kind: 'shortened' }]
          : [],
      autoTitle: safety.title,
    };
  }
  const fitted = fitTitle(preferredFitted ?? fullTitle, fitOpts);
  return {
    title: fitted.title,
    fullTitle,
    shortened: fitted.shortened,
    removed: fitted.removed,
    autoTitle: fitted.title,
  };
}
