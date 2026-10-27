import type { TitleOver100, TitleRemovalInfo } from '../types.js';
import { YT_TITLE_MAX } from '../limits.js';

/**
 * Duration phrases across languages (en/ru/de/es/pt/fr/it/ja/zh/…).
 * Matches e.g. "1.5 Hours", "1,5 часа", "90 min", "2h", "3 Stunden", "1.5 時間".
 */
export const DURATION_RE =
  /(?:\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h\b|часа?|часов|stunden?|horas?|heures?|ore?\b|時間|小时|小時|mins?|minutes?|мин(?:ут[аые]?)?|minuten?|minutos?|分钟?|分)/giu;

export type TitleRemoval = TitleRemovalInfo;

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

/** Title segment separators: `|`, `—`, `–`, `·`, ` - `, `:` (with surrounding spaces). */
const SEPARATOR_SOURCE = String.raw`\s*[|—–·]\s*|\s+-\s+|\s*:\s*`;

/** Split a title into trimmed, non-empty segments (separators dropped). */
export function splitTitleSegments(title: string): string[] {
  return title
    .split(new RegExp(SEPARATOR_SOURCE, 'u'))
    .map((s) => s.trim())
    .filter(Boolean);
}

function resplitTitle(title: string): TitlePiece[] {
  const pieces: TitlePiece[] = [];
  let segIndex = 0;
  let last = 0;
  const re = new RegExp(SEPARATOR_SOURCE, 'gu');
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
