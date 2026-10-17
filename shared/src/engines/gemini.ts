import type { TranslateOptions, TranslationEngine } from '../types.js';
import { withRetry } from '../retry.js';
import {
  applyTitleLimit,
  prepareForTranslation,
  restoreAfterTranslation,
} from '../text.js';

function buildPrompt(
  title: string,
  description: string,
  target: string,
  source: string,
  options: TranslateOptions,
): string {
  const rules = [
    `Translate from ${source} to ${target}.`,
    'Return ONLY valid JSON: {"title":"...","description":"..."}',
    'Keep placeholders like __PT_0__, __URL_0__, __AT_0__, __HT_0__, __TS_0__, __CHLINE_0__ exactly as-is.',
    'Keep URLs, @handles, and timestamps unchanged.',
    options.hashtagMode === 'keep'
      ? 'Do not translate hashtags (they are placeholders).'
      : 'You may translate hashtag words if present as plain text.',
    options.chapterMode === 'translate_labels'
      ? 'Translate chapter labels; leave timestamp placeholders untouched.'
      : 'Chapter lines are placeholders — leave them unchanged.',
    options.titleOver100 === 'ai_shorten'
      ? 'Title must be at most 100 characters; shorten creatively if needed.'
      : 'Prefer a natural title; length will be truncated later if needed.',
    'Preserve line breaks in the description.',
  ];
  return `${rules.join('\n')}\n\nTITLE:\n${title}\n\nDESCRIPTION:\n${description}`;
}

export function createGeminiEngine(apiKey: string): TranslationEngine {
  return {
    id: 'gemini',
    async translate(texts, target, source, options) {
      const title = texts[0] ?? '';
      const description = texts[1] ?? '';
      const prepared = prepareForTranslation(title, description, options);
      const prompt = buildPrompt(prepared.title, prepared.description, target, source, options);

      const result = await withRetry(async () => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
        }
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const parsed = JSON.parse(raw) as { title?: string; description?: string };
        if (typeof parsed.title !== 'string' || typeof parsed.description !== 'string') {
          throw new Error('Gemini returned invalid JSON shape');
        }
        return { title: parsed.title, description: parsed.description };
      }, { label: 'gemini' });

      let outTitle = restoreAfterTranslation(result.title, prepared.maps);
      let outDesc = restoreAfterTranslation(result.description, prepared.maps);
      outTitle = applyTitleLimit(outTitle, options.titleOver100);
      return [outTitle, outDesc];
    },
  };
}
