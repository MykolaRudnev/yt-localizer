/** Top 10 most popular YouTube languages (matches languages.json presets.top10). */
export const TOP10_CODES = [
  'es',
  'pt',
  'hi',
  'id',
  'ru',
  'ja',
  'ko',
  'de',
  'fr',
  'ar',
] as const;

/** Rough flag emoji for language codes (display only). */
const FLAG_BY_LANG: Record<string, string> = {
  af: '🇿🇦',
  am: '🇪🇹',
  ar: '🇸🇦',
  az: '🇦🇿',
  be: '🇧🇾',
  bg: '🇧🇬',
  bn: '🇧🇩',
  bs: '🇧🇦',
  ca: '🇪🇸',
  cs: '🇨🇿',
  da: '🇩🇰',
  de: '🇩🇪',
  el: '🇬🇷',
  en: '🇬🇧',
  es: '🇪🇸',
  et: '🇪🇪',
  eu: '🇪🇸',
  fa: '🇮🇷',
  fi: '🇫🇮',
  fil: '🇵🇭',
  fr: '🇫🇷',
  gl: '🇪🇸',
  gu: '🇮🇳',
  he: '🇮🇱',
  hi: '🇮🇳',
  hr: '🇭🇷',
  hu: '🇭🇺',
  hy: '🇦🇲',
  id: '🇮🇩',
  is: '🇮🇸',
  it: '🇮🇹',
  ja: '🇯🇵',
  ka: '🇬🇪',
  kk: '🇰🇿',
  km: '🇰🇭',
  kn: '🇮🇳',
  ko: '🇰🇷',
  ky: '🇰🇬',
  lo: '🇱🇦',
  lt: '🇱🇹',
  lv: '🇱🇻',
  mk: '🇲🇰',
  ml: '🇮🇳',
  mn: '🇲🇳',
  mr: '🇮🇳',
  ms: '🇲🇾',
  my: '🇲🇲',
  ne: '🇳🇵',
  nl: '🇳🇱',
  no: '🇳🇴',
  pa: '🇮🇳',
  pl: '🇵🇱',
  pt: '🇧🇷',
  ro: '🇷🇴',
  ru: '🇷🇺',
  si: '🇱🇰',
  sk: '🇸🇰',
  sl: '🇸🇮',
  sq: '🇦🇱',
  sr: '🇷🇸',
  sv: '🇸🇪',
  sw: '🇰🇪',
  ta: '🇮🇳',
  te: '🇮🇳',
  th: '🇹🇭',
  tr: '🇹🇷',
  uk: '🇺🇦',
  ur: '🇵🇰',
  uz: '🇺🇿',
  vi: '🇻🇳',
  'zh-Hans': '🇨🇳',
  'zh-Hant': '🇹🇼',
  zu: '🇿🇦',
};

export function flagForLanguage(code: string): string {
  return FLAG_BY_LANG[code] ?? '🏳️';
}

/**
 * Languages to translate: drop source defaultLanguage; optionally skip ones that
 * already have a localization on the video.
 */
export function filterLanguagesForTranslate(
  selected: string[],
  existingLocalizations: Record<string, unknown> | undefined,
  opts: { skipExisting: boolean; defaultLanguage?: string },
): string[] {
  const existing = existingLocalizations ?? {};
  return selected.filter((code) => {
    if (opts.defaultLanguage && code === opts.defaultLanguage) return false;
    if (opts.skipExisting && Object.prototype.hasOwnProperty.call(existing, code)) {
      return false;
    }
    return true;
  });
}

/** Merge new localizations into existing ones (never deletes others). */
export function mergeLocalizations(
  existing: Record<string, { title: string; description: string }> | undefined,
  incoming: Record<string, { title: string; description: string }>,
): Record<string, { title: string; description: string }> {
  return { ...(existing ?? {}), ...incoming };
}
