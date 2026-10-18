import type { TranslateOptions, TranslationEngine } from '../types.js';
import { withRetry } from '../retry.js';
import {
  applyTitleLimit,
  prepareForTranslation,
  restoreAfterTranslation,
} from '../text.js';

/** DeepL Free supported language codes (subset). */
const DEEPL_LANGS = new Set([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'he', 'hu',
  'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk',
  'sl', 'sv', 'th', 'tr', 'uk', 'vi', 'zh', 'zh-Hans', 'zh-Hant',
]);

function toDeeplCode(code: string): string | null {
  if (code === 'no') return 'NB';
  if (code === 'zh-Hans' || code === 'zh-Hant') return 'ZH';
  const base = code.split('-')[0].toLowerCase();
  if (DEEPL_LANGS.has(base) || DEEPL_LANGS.has(code)) return base.toUpperCase();
  return null;
}

export function deeplSupports(lang: string): boolean {
  return toDeeplCode(lang) !== null;
}

export function createDeeplEngine(apiKey: string): TranslationEngine {
  const endpoint = apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  return {
    id: 'deepl',
    async translate(texts, target, source, options) {
      const deeplTarget = toDeeplCode(target);
      if (!deeplTarget) {
        throw new Error(`DeepL does not support language: ${target}`);
      }
      const deeplSource = toDeeplCode(source) ?? undefined;
      const title = texts[0] ?? '';
      const description = texts[1] ?? '';
      const prepared = prepareForTranslation(title, description, options);

      const translated = await withRetry(async () => {
        const body = new URLSearchParams();
        body.append('text', prepared.title);
        body.append('text', prepared.description);
        body.append('target_lang', deeplTarget);
        if (deeplSource) body.append('source_lang', deeplSource);

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: options.signal,
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`DeepL ${res.status}: ${err.slice(0, 200)}`);
        }
        const data = (await res.json()) as { translations: { text: string }[] };
        if (data.translations.length < 2) throw new Error('DeepL incomplete response');
        return data.translations.map((t) => t.text);
      }, { label: 'deepl', signal: options.signal });

      let outTitle = restoreAfterTranslation(translated[0], prepared.maps);
      let outDesc = restoreAfterTranslation(translated[1], prepared.maps);
      outTitle = applyTitleLimit(outTitle, options.titleOver100);
      return [outTitle, outDesc];
    },
  };
}
