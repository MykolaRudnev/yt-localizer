import type { HashtagMode, TranslateOptions } from '../types.js';
import { protectChapters } from './chapters.js';

export function extractHashtags(text: string): string[] {
  return text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
}

export function protectHashtags(text: string, mode: HashtagMode): { text: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  if (mode !== 'keep') return { text, map };
  let i = 0;
  const out = text.replace(/#[\p{L}\p{N}_]+/gu, (tag) => {
    const token = `__HT_${i++}__`;
    map.set(token, tag);
    return token;
  });
  return { text: out, map };
}

export function restorePlaceholders(text: string, map: Map<string, string>): string {
  let out = text;
  for (const [token, value] of map) {
    out = out.split(token).join(value);
  }
  return out;
}

export function protectTerms(text: string, terms: string[]): { text: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  let out = text;
  const sorted = [...terms].filter(Boolean).sort((a, b) => b.length - a.length);
  let i = 0;
  for (const term of sorted) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    out = out.replace(re, () => {
      const token = `__PT_${i++}__`;
      map.set(token, term);
      return token;
    });
  }
  return { text: out, map };
}

export function protectUrlsAndHandles(text: string): { text: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  let i = 0;
  let out = text.replace(/https?:\/\/[^\s]+/gi, (m) => {
    const token = `__URL_${i++}__`;
    map.set(token, m);
    return token;
  });
  out = out.replace(/@[A-Za-z0-9._-]+/g, (m) => {
    const token = `__AT_${i++}__`;
    map.set(token, m);
    return token;
  });
  return { text: out, map };
}

export type PreparedTexts = {
  title: string;
  description: string;
  /** Placeholder maps for the title only. */
  titleMaps: Map<string, string>[];
  /** Placeholder maps for the description only (incl. chapter tokens). */
  descriptionMaps: Map<string, string>[];
  /** All maps (title then description) — kept for backward compatibility. */
  maps: Map<string, string>[];
};

/**
 * Replace protected terms / URLs / handles / hashtags / chapter timestamps with
 * placeholders. Title and description are numbered independently, so each must
 * be restored with its own maps (see `restorePrepared`).
 */
export function prepareForTranslation(
  title: string,
  description: string,
  options: TranslateOptions,
): PreparedTexts {
  const protect = (input: string, maps: Map<string, string>[]): string => {
    const pt = protectTerms(input, options.protectedTerms);
    const uh = protectUrlsAndHandles(pt.text);
    const ht = protectHashtags(uh.text, options.hashtagMode);
    maps.push(pt.map, uh.map, ht.map);
    return ht.text;
  };

  const titleMaps: Map<string, string>[] = [];
  const descriptionMaps: Map<string, string>[] = [];
  const t = protect(title, titleMaps);
  const ch = protectChapters(description, options.chapterMode);
  descriptionMaps.push(ch.map);
  const d = protect(ch.text, descriptionMaps);

  return {
    title: t,
    description: d,
    titleMaps,
    descriptionMaps,
    maps: [...titleMaps, ...descriptionMaps],
  };
}

/** Restore translated [title, description] using their own placeholder maps. */
export function restorePrepared(
  prepared: Pick<PreparedTexts, 'titleMaps' | 'descriptionMaps'>,
  translatedTitle: string,
  translatedDescription: string,
): [string, string] {
  return [
    restoreAfterTranslation(translatedTitle, prepared.titleMaps),
    restoreAfterTranslation(translatedDescription, prepared.descriptionMaps),
  ];
}

export function restoreAfterTranslation(text: string, maps: Map<string, string>[]): string {
  let out = text;
  for (const map of maps) {
    out = restorePlaceholders(out, map);
  }
  return out;
}

export function mergeMaps(...maps: Map<string, string>[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const m of maps) {
    for (const [k, v] of m) merged.set(k, v);
  }
  return merged;
}
