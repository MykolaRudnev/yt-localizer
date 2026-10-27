/**
 * Text helpers barrel (kept for backward-compatible imports).
 * - limits.ts              YouTube title/description limits
 * - title/fit.ts           segment-aware title fitting + review diff
 * - text/chapters.ts       chapter-line detection / protection
 * - text/placeholders.ts   placeholder protect/restore around engine calls
 */
export * from './limits.js';
export * from './title/fit.js';
export * from './text/chapters.js';
export * from './text/placeholders.js';
