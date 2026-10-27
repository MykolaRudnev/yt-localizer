/** Auto-publish when this many unpublished langs are ready. */
export const AUTO_PUBLISH_BUCKET = 5;
export const AUTO_PUBLISH_BATCH = AUTO_PUBLISH_BUCKET;

/** Auto-publish if any unpublished langs wait this long. */
export const AUTO_PUBLISH_INTERVAL_MS = 30_000;

/** Whether to flush auto-publish now (batch size, interval, or forced end-of-job). */
export function shouldAutoPublishFlush(opts: {
  unpublishedCount: number;
  lastFlushAt: number;
  now: number;
  force?: boolean;
  batchSize?: number;
  intervalMs?: number;
}): boolean {
  if (opts.unpublishedCount <= 0) return false;
  if (opts.force) return true;
  const batch = opts.batchSize ?? AUTO_PUBLISH_BATCH;
  const interval = opts.intervalMs ?? AUTO_PUBLISH_INTERVAL_MS;
  if (opts.unpublishedCount >= batch) return true;
  if (opts.now - opts.lastFlushAt >= interval) return true;
  return false;
}
