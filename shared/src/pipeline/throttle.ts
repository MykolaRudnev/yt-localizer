import { sleep } from '../async.js';

/** Minimum spacing between Gemini calls (free-tier RPM friendly). */
export type ThrottleState = { lastAt: number };

export async function throttleGemini(
  state: ThrottleState,
  minMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (minMs <= 0) return;
  const wait = state.lastAt + minMs - Date.now();
  if (wait > 0) await sleep(wait, signal);
}

export function markGeminiDone(state: ThrottleState) {
  state.lastAt = Date.now();
}
