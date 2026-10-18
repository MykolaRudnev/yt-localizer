import type { TranslateOptions, TranslationEngine } from '../types.js';
import { withRetry } from '../retry.js';
import {
  applyTitleLimit,
  prepareForTranslation,
  restoreAfterTranslation,
} from '../text.js';

export function createLibreTranslateEngine(
  baseUrl: string,
  apiKey?: string,
): TranslationEngine {
  const root = baseUrl.replace(/\/$/, '');

  return {
    id: 'libretranslate',
    async translate(texts, target, source, options) {
      const title = texts[0] ?? '';
      const description = texts[1] ?? '';
      const prepared = prepareForTranslation(title, description, options);
      const targetCode = target.split('-')[0];
      const sourceCode = source.split('-')[0];

      const translateOne = async (q: string) =>
        withRetry(
          async () => {
            const res = await fetch(`${root}/translate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: options.signal,
              body: JSON.stringify({
                q,
                source: sourceCode,
                target: targetCode,
                format: 'text',
                ...(apiKey ? { api_key: apiKey } : {}),
              }),
            });
            if (!res.ok) {
              const err = await res.text();
              throw new Error(`LibreTranslate ${res.status}: ${err.slice(0, 200)}`);
            }
            const data = (await res.json()) as { translatedText: string };
            return data.translatedText;
          },
          { label: 'libretranslate', signal: options.signal },
        );

      let outTitle = restoreAfterTranslation(await translateOne(prepared.title), prepared.maps);
      let outDesc = restoreAfterTranslation(await translateOne(prepared.description), prepared.maps);
      outTitle = applyTitleLimit(outTitle, options.titleOver100);
      return [outTitle, outDesc];
    },
  };
}
