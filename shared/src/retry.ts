import { sleep } from './async.js';
import { classifyError, isAbortError } from './errors.js';

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; label?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isAbortError(err)) throw err;
      // Only retry transient failures
      if (classifyError(err) === 'fatal') break;
      if (attempt === retries) break;
      const delay = baseMs * 2 ** attempt + Math.floor(Math.random() * 100);
      await sleep(delay, opts.signal);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? `${opts.label ?? 'operation'} failed`));
}
