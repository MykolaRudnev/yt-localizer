import type { TranslationEngine } from '../types.js';
import { withRetry } from '../retry.js';
import { prepareForTranslation, restorePrepared } from '../text/placeholders.js';

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

/** Free-plan keys end in `:fx` and use the api-free host. */
export function deeplEndpoint(apiKey: string): string {
  return apiKey.trim().endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

function deeplHeaders(key: string): Record<string, string> {
  return {
    Authorization: `DeepL-Auth-Key ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

/** Cheap key check: translate "." to EN. Throws `DeepL <status>: …` on failure. */
export async function preflightDeepl(apiKey: string, signal?: AbortSignal): Promise<void> {
  const key = apiKey.trim();
  const body = new URLSearchParams();
  body.append('text', '.');
  body.append('target_lang', 'EN');
  const res = await fetch(deeplEndpoint(key), {
    method: 'POST',
    headers: deeplHeaders(key),
    body,
    signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepL ${res.status}: ${err.slice(0, 200)}`);
  }
}

export function createDeeplEngine(apiKey: string): TranslationEngine {
  const key = apiKey.trim();
  const endpoint = deeplEndpoint(key);

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
          headers: deeplHeaders(key),
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

      const [outTitle, outDesc] = restorePrepared(prepared, translated[0], translated[1]);
      // Full title kept; segment-aware fit happens in translateTitleDescription.
      return [outTitle, outDesc];
    },
  };
}
