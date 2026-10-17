import type { ChapterMode, HashtagMode, TitleOver100, TranslateOptions } from './types.js';

/** Timestamp at start of a chapter line: 0:00, 1:23, 1:02:03 */
export const TIMESTAMP_RE = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\b/;

export function truncateTitleAtWordBoundary(title: string, max = 100): string {
  if (title.length <= max) return title;
  const sliced = title.slice(0, max);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > max * 0.5) {
    return sliced.slice(0, lastSpace).replace(/[.,;:!?\-–—]+$/, '').trim();
  }
  return sliced.trim();
}

export function applyTitleLimit(
  title: string,
  mode: TitleOver100,
  max = 100,
): string {
  if (title.length <= max) return title;
  if (mode === 'truncate') return truncateTitleAtWordBoundary(title, max);
  // ai_shorten is handled by the engine prompt; still hard-cap as safety
  return truncateTitleAtWordBoundary(title, max);
}

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

export interface ChapterBlock {
  start: number;
  end: number;
  lines: { timestamp: string; label: string; seconds: number }[];
}

function parseTimestampSeconds(line: string): number | null {
  const m = line.match(TIMESTAMP_RE);
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const mins = Number(m[2]);
  const secs = Number(m[3]);
  return hours * 3600 + mins * 60 + secs;
}

/** Find blocks of 3+ consecutive chapter lines with ascending timestamps. */
export function findChapterBlocks(description: string): ChapterBlock[] {
  const lines = description.split('\n');
  const blocks: ChapterBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const secs = parseTimestampSeconds(lines[i].trim());
    if (secs === null) {
      i++;
      continue;
    }
    const start = i;
    const chapterLines: ChapterBlock['lines'] = [];
    let prev = -1;
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      const s = parseTimestampSeconds(trimmed);
      if (s === null || s < prev) break;
      const tsMatch = trimmed.match(TIMESTAMP_RE)!;
      const timestamp = tsMatch[0];
      const label = trimmed.slice(timestamp.length).replace(/^[\s\-–—:]+/, '');
      chapterLines.push({ timestamp, label, seconds: s });
      prev = s;
      i++;
    }
    if (chapterLines.length >= 3) {
      blocks.push({ start, end: i, lines: chapterLines });
    }
  }
  return blocks;
}

export function protectChapters(
  description: string,
  mode: ChapterMode,
): { text: string; map: Map<string, string>; chapterLabels: string[] } {
  const map = new Map<string, string>();
  const chapterLabels: string[] = [];
  if (mode === 'keep') {
    const blocks = findChapterBlocks(description);
    if (!blocks.length) return { text: description, map, chapterLabels };
    const lines = description.split('\n');
    let tokenIdx = 0;
    for (const block of blocks) {
      for (let li = block.start; li < block.end; li++) {
        const token = `__CHLINE_${tokenIdx++}__`;
        map.set(token, lines[li]);
        lines[li] = token;
      }
    }
    return { text: lines.join('\n'), map, chapterLabels };
  }

  // translate_labels: protect timestamps only; collect labels for separate translation
  const blocks = findChapterBlocks(description);
  if (!blocks.length) return { text: description, map, chapterLabels };
  const lines = description.split('\n');
  let tokenIdx = 0;
  for (const block of blocks) {
    for (const line of block.lines) {
      chapterLabels.push(line.label);
      const tsToken = `__TS_${tokenIdx}__`;
      map.set(tsToken, line.timestamp);
      const origIdx = lines.findIndex(
        (l, idx) =>
          idx >= block.start &&
          idx < block.end &&
          l.includes(line.timestamp) &&
          !l.startsWith('__'),
      );
      if (origIdx >= 0) {
        lines[origIdx] = `${tsToken} ${line.label}`.trim();
      }
      tokenIdx++;
    }
  }
  return { text: lines.join('\n'), map, chapterLabels };
}

export function prepareForTranslation(
  title: string,
  description: string,
  options: TranslateOptions,
): {
  title: string;
  description: string;
  maps: Map<string, string>[];
} {
  const maps: Map<string, string>[] = [];

  let t = title;
  let d = description;

  for (const [text, setter] of [
    [
      t,
      (v: string) => {
        t = v;
      },
    ],
    [
      d,
      (v: string) => {
        d = v;
      },
    ],
  ] as const) {
    void text;
    void setter;
  }

  const apply = (input: string): string => {
    let out = input;
    const pt = protectTerms(out, options.protectedTerms);
    maps.push(pt.map);
    out = pt.text;
    const uh = protectUrlsAndHandles(out);
    maps.push(uh.map);
    out = uh.text;
    const ht = protectHashtags(out, options.hashtagMode);
    maps.push(ht.map);
    out = ht.text;
    return out;
  };

  t = apply(t);
  const ch = protectChapters(d, options.chapterMode);
  maps.push(ch.map);
  d = apply(ch.text);

  return { title: t, description: d, maps };
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

export function charWarning(title: string, description: string): { titleOver: boolean; descOver: boolean } {
  return {
    titleOver: title.length > 100,
    descOver: description.length > 5000,
  };
}
