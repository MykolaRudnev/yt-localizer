/** Small HTML helpers shared by the content script and popup. */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/** "gemini · gemini-2.5-flash", "deepl", or "" when unknown. */
export function engineLabel(engine?: string, model?: string): string {
  if (!engine) return '';
  if (engine === 'gemini' && model) return `${engine} · ${model}`;
  return engine;
}
