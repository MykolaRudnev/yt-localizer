import { describe, expect, it } from 'vitest';
import {
  GEMINI_FALLBACK_MODEL,
  normalizeGeminiModelId,
  pickBestFlashModel,
} from './gemini.js';

describe('pickBestFlashModel', () => {
  it('prefers non-lite non-preview newest flash', () => {
    const picked = pickBestFlashModel([
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash-preview-05-20',
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-1.5-pro',
    ]);
    expect(picked).toBe('gemini-2.5-flash');
  });

  it('falls back to alias when no flash', () => {
    expect(pickBestFlashModel(['gemini-1.5-pro', 'embedding-001'])).toBe(
      GEMINI_FALLBACK_MODEL,
    );
  });

  it('strips models/ prefix', () => {
    expect(normalizeGeminiModelId('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });
});
