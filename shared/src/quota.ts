/** Gemini free-tier daily quotas reset at midnight America/Los_Angeles. */

export type ExhaustionMap = Record<string, number>; // modelId → expiresAtMs

function pacificDateKey(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Next midnight in America/Los_Angeles, as UTC epoch ms. */
export function nextPacificMidnightMs(nowMs = Date.now()): number {
  const today = pacificDateKey(nowMs);
  let lo = nowMs;
  let hi = nowMs + 36 * 3600_000;
  while (hi - lo > 500) {
    const mid = Math.floor((lo + hi) / 2);
    if (pacificDateKey(mid) === today) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function pruneExhaustion(map: ExhaustionMap, nowMs = Date.now()): ExhaustionMap {
  const out: ExhaustionMap = {};
  for (const [id, until] of Object.entries(map)) {
    if (typeof until === 'number' && until > nowMs) out[id] = until;
  }
  return out;
}

export function isExhausted(map: ExhaustionMap, model: string, nowMs = Date.now()): boolean {
  const until = map[model];
  return typeof until === 'number' && until > nowMs;
}

export function markExhausted(
  map: ExhaustionMap,
  model: string,
  nowMs = Date.now(),
): ExhaustionMap {
  return { ...pruneExhaustion(map, nowMs), [model]: nextPacificMidnightMs(nowMs) };
}

/** Earliest reset among exhausted models, or next Pacific midnight if map empty. */
export function earliestResetMs(map: ExhaustionMap, nowMs = Date.now()): number {
  const live = pruneExhaustion(map, nowMs);
  const times = Object.values(live);
  if (!times.length) return nextPacificMidnightMs(nowMs);
  return Math.min(...times);
}

export function formatResetLocal(untilMs: number, nowMs = Date.now()): string {
  const d = new Date(untilMs);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  // If reset is tomorrow relative to local calendar day, note it briefly
  const localDay = new Date(nowMs).toDateString();
  const resetDay = d.toDateString();
  return resetDay === localDay ? `${hh}:${mm}` : `${hh}:${mm} (tomorrow)`;
}

export function quotaStopSummary(
  done: number,
  remaining: number,
  resetMs: number,
  nowMs = Date.now(),
): { summary: string; hint: string } {
  const when = formatResetLocal(resetMs, nowMs);
  return {
    summary: `${done} done, ${remaining} remaining; resets at ${when} local`,
    hint: 'Gemini daily quotas reset at midnight Pacific. Retry after reset, or add DeepL / LibreTranslate.',
  };
}
