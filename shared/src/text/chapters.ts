import type { ChapterMode } from '../types.js';

/** Timestamp at start of a chapter line: 0:00, 1:23, 1:02:03 */
export const TIMESTAMP_RE = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\b/;

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
