import type { ChapterMode, HashtagMode, TitleOver100, TranslateOptions } from './types.js';

/** Timestamp at start of a chapter line: 0:00, 1:23, 1:02:03 */
export const TIMESTAMP_RE = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\b/;

/** YouTube title character limit. */
export const YT_TITLE_MAX = 100;

/**
 * Duration phrases across languages (en/ru/de/es/pt/fr/it/ja/zh/…).
 * Matches e.g. "1.5 Hours", "1,5 часа", "90 min", "2h", "3 Stunden", "1.5 時間".
 */
export const DURATION_RE =
  /(?:\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h\b|часа?|часов|stunden?|horas?|heures?|ore?\b|時間|小时|小時|mins?|minutes?|мин(?:ут[аые]?)?|minuten?|minutos?|分钟?|分)/giu;

export type TitleRemoval = {
  text: string;
  kind: 'shortened' | 'dropped' | 'truncated';
};

export type TitleFitResult = {
  /** Fitted title (≤ max when possible). */
  title: string;
  /** Original untruncated translation. */
  fullTitle: string;
  shortened: boolean;
  removed: TitleRemoval[];
};

export type FitTitleOptions = {
  max?: number;
  protectedTerms?: string[];
  /** When true (default), never drop/shorten the last segment. */
  protectLastSegment?: boolean;
};

type TitlePiece =
  | { kind: 'seg'; text: string; protected: boolean; index: number }
  | { kind: 'sep'; text: string };

export function truncateTitleAtWordBoundary(title: string, max = YT_TITLE_MAX): string {
  if (title.length <= max) return title;
  const sliced = title.slice(0, max);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > max * 0.5) {
    return sliced.slice(0, lastSpace).replace(/[.,;:!?\-–—|·:]+$/u, '').trim();
  }
  return sliced.trim();
}

/** Collapse runs of whitespace; tidy spaces around separators. */
export function compactTitleSeparators(title: string): string {
  let out = title.replace(/\s+/g, ' ').trim();
  out = out.replace(/\s*([|—–·:])\s*/gu, ' $1 ').replace(/\s+-\s+/g, ' - ');
  out = out.replace(/\s+/g, ' ').trim();
  // Collapse duplicate separators like " | | "
  out = out.replace(/(?:\s*[|—–·:]\s*){2,}/gu, (m) => {
    const ch = m.match(/[|—–·:]/u)?.[0] ?? '|';
    return ` ${ch} `;
  });
  return out.replace(/\s+/g, ' ').trim();
}

export function isDurationPhrase(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  DURATION_RE.lastIndex = 0;
  const matches = t.match(DURATION_RE);
  if (!matches) return false;
  const covered = matches.reduce((n, m) => n + m.length, 0);
  return covered >= Math.min(t.length, 2) * 0.4 || /(?:\d+[.,]?\d*)\s*[hH]\b/.test(t);
}

function containsProtectedTerm(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  for (const term of terms) {
    if (!term) continue;
    if (lower.includes(term.toLowerCase())) return true;
  }
  return false;
}

function resplitTitle(title: string): TitlePiece[] {
  const pieces: TitlePiece[] = [];
  let segIndex = 0;
  let last = 0;
  const re = /\s*[|—–·]\s*|\s+-\s+|\s*:\s*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    if (m.index > last) {
      pieces.push({
        kind: 'seg',
        text: title.slice(last, m.index),
        protected: false,
        index: segIndex++,
      });
    }
    pieces.push({ kind: 'sep', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < title.length) {
    pieces.push({
      kind: 'seg',
      text: title.slice(last),
      protected: false,
      index: segIndex++,
    });
  }
  return pieces;
}

function markProtected(
  pieces: TitlePiece[],
  protectedTerms: string[],
  protectLastSegment: boolean,
): void {
  const segs = pieces.filter((p): p is Extract<TitlePiece, { kind: 'seg' }> => p.kind === 'seg');
  const lastIdx = segs.length ? segs[segs.length - 1].index : -1;
  for (const p of pieces) {
    if (p.kind !== 'seg') continue;
    if (p.index === 0) p.protected = true;
    else if (protectLastSegment && p.index === lastIdx) p.protected = true;
    else if (isDurationPhrase(p.text)) p.protected = true;
    else if (containsProtectedTerm(p.text, protectedTerms)) p.protected = true;
  }
}

function joinPieces(pieces: TitlePiece[]): string {
  return pieces
    .map((p) => p.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drop empty segs and tidy orphan separators. */
function tidyPieces(pieces: TitlePiece[]): TitlePiece[] {
  const out: TitlePiece[] = [];
  for (const p of pieces) {
    if (p.kind === 'seg' && !p.text.trim()) continue;
    if (p.kind === 'sep') {
      if (!out.length || out[out.length - 1].kind === 'sep') continue;
      out.push(p);
      continue;
    }
    out.push(p);
  }
  while (out.length && out[out.length - 1].kind === 'sep') out.pop();
  return out;
}

function shortenSegmentAtWordBoundary(text: string, removeAtLeast: number): string | null {
  const trimmed = text.trim();
  if (removeAtLeast <= 0) return trimmed;
  const targetLen = Math.max(0, trimmed.length - removeAtLeast);
  if (targetLen <= 0) return null;
  const sliced = trimmed.slice(0, targetLen);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > targetLen * 0.35) {
    const next = sliced.slice(0, lastSpace).replace(/[.,;:!?\-–—]+$/u, '').trim();
    return next.length > 0 ? next : null;
  }
  // No good word boundary — refuse partial cut (caller may drop whole segment)
  if (sliced.trim().length < trimmed.length * 0.5) return null;
  const next = sliced.trim();
  return next.length > 0 && next.length < trimmed.length ? next : null;
}

/**
 * Segment-aware title fit for the YouTube 100-char limit.
 * Protects first segment, duration phrases, user terms, and optionally the last segment.
 */
export function fitTitle(fullTitle: string, opts: FitTitleOptions = {}): TitleFitResult {
  const max = opts.max ?? YT_TITLE_MAX;
  const protectedTerms = opts.protectedTerms ?? [];
  const protectLastSegment = opts.protectLastSegment !== false;
  const removed: TitleRemoval[] = [];

  if (fullTitle.length <= max) {
    return { title: fullTitle, fullTitle, shortened: false, removed };
  }

  let working = compactTitleSeparators(fullTitle);
  if (working.length <= max) {
    // Whitespace/separator compact only — not a content shorten.
    return { title: working, fullTitle, shortened: false, removed };
  }

  let pieces = tidyPieces(resplitTitle(working));
  markProtected(pieces, protectedTerms, protectLastSegment);

  const rebuild = () => {
    pieces = tidyPieces(pieces);
    markProtected(pieces, protectedTerms, protectLastSegment);
    working = joinPieces(pieces);
  };

  // 1) Shorten least-important unprotected middle segments at word boundary
  const tryShortenPass = () => {
    const segs = pieces.filter(
      (p): p is Extract<TitlePiece, { kind: 'seg' }> => p.kind === 'seg' && !p.protected,
    );
    // Prefer longest generic middle segments
    segs.sort((a, b) => b.text.length - a.text.length);
    for (const seg of segs) {
      if (working.length <= max) return;
      const need = working.length - max;
      const idx = pieces.indexOf(seg);
      if (idx < 0) continue;
      const shortened = shortenSegmentAtWordBoundary(seg.text, need);
      if (shortened && shortened.length < seg.text.trim().length) {
        const cut = seg.text.trim().slice(shortened.length).trim();
        if (cut) removed.push({ text: cut, kind: 'shortened' });
        pieces[idx] = { ...seg, text: shortened };
        rebuild();
      }
    }
  };

  tryShortenPass();

  // 2) Drop whole unprotected segments (longest first)
  while (working.length > max) {
    const segs = pieces.filter(
      (p): p is Extract<TitlePiece, { kind: 'seg' }> => p.kind === 'seg' && !p.protected,
    );
    if (!segs.length) break;
    segs.sort((a, b) => b.text.length - a.text.length);
    const drop = segs[0];
    const idx = pieces.indexOf(drop);
    if (idx < 0) break;
    removed.push({ text: drop.text.trim(), kind: 'dropped' });
    pieces.splice(idx, 1);
    rebuild();
  }

  // 3) Hard-cap fallback at word boundary if protected parts alone exceed max
  if (working.length > max) {
    const before = working;
    working = truncateTitleAtWordBoundary(working, max);
    if (working.length < before.length) {
      removed.push({ text: before.slice(working.length).trim(), kind: 'truncated' });
    }
  }

  return {
    title: working,
    fullTitle,
    shortened: true,
    removed,
  };
}

/**
 * Apply title length policy. Local segment-aware fit is always the safety net;
 * `ai_shorten` creative rewrite happens in the Gemini path before this hard-cap.
 */
export function applyTitleLimit(
  title: string,
  _mode: TitleOver100,
  max = YT_TITLE_MAX,
  opts?: FitTitleOptions,
): string {
  return fitTitle(title, { ...opts, max }).title;
}

/**
 * Build a review diff for strike-through UI by matching fitted title as an
 * ordered subsequence of fullTitle word/separator tokens.
 */
export function titleRemovalDiff(
  fullTitle: string,
  fittedTitle: string,
): { text: string; removed: boolean }[] {
  if (fullTitle === fittedTitle) return [{ text: fullTitle, removed: false }];
  const fullTokens = fullTitle.split(/(\s+|[|—–·:]|(?:\s+-\s+))/u).filter((t) => t.length > 0);
  const fittedTokens = fittedTitle
    .split(/(\s+|[|—–·:]|(?:\s+-\s+))/u)
    .filter((t) => t.length > 0 && !/^\s+$/.test(t));
  let fi = 0;
  const out: { text: string; removed: boolean }[] = [];
  for (const token of fullTokens) {
    if (/^\s+$/.test(token)) {
      out.push({ text: token, removed: false });
      continue;
    }
    if (fi < fittedTokens.length && token === fittedTokens[fi]) {
      out.push({ text: token, removed: false });
      fi += 1;
    } else {
      out.push({ text: token, removed: true });
    }
  }
  return out;
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
