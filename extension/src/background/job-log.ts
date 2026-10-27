import type { JobLogEntry } from '@shared/types';
import { appendJobLog } from '../storage';

/** Append a translate / publish run to the job log (`jobLogs`, newest first, capped). */
export async function logJobRun(entry: Omit<JobLogEntry, 'id' | 'finishedAt'> & {
  finishedAt?: string;
}): Promise<void> {
  const { autoApproved, ...rest } = entry;
  await appendJobLog({
    id: crypto.randomUUID(),
    finishedAt: new Date().toISOString(),
    ...rest,
    // Only record the field when something was auto-approved (keeps old log shape otherwise).
    ...(autoApproved?.length ? { autoApproved } : {}),
  });
}
