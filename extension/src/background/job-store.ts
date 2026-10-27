import { badgeForJob, type JobAction, reduceJob, type TranslateJob } from '@shared/job';
import type { JobPortMessage } from '../protocol';
import { getActiveJob, setActiveJob } from '../storage';

/**
 * Single source of truth for the active translate job in the service worker:
 * in-memory copy, durable storage, toolbar badge, keep-alive alarm and the
 * `vt-job` port broadcast all go through `persistJob`.
 */

export const KEEP_ALIVE_ALARM = 'vt-keepalive';

let memoryJob: TranslateJob | null = null;
const jobPorts = new Set<chrome.runtime.Port>();

/** Last known job without touching storage (may be null after SW restart). */
export function peekJob(): TranslateJob | null {
  return memoryJob;
}

/** Memory first, then storage (SW may have restarted). */
export async function loadJob(): Promise<TranslateJob | null> {
  if (!memoryJob) memoryJob = await getActiveJob();
  return memoryJob;
}

export async function persistJob(job: TranslateJob | null): Promise<void> {
  memoryJob = job;
  await setActiveJob(job);
  await updateBadge(job);
  broadcastJob(job);
  await ensureKeepAlive(job?.phase === 'running');
}

/** Reduce the job with `action` only if it is still the job `jobId` (stale callbacks are dropped). */
export async function updateJob(
  jobId: string,
  action: JobAction,
): Promise<TranslateJob | null> {
  const cur = memoryJob;
  if (!cur || cur.id !== jobId) return null;
  const next = reduceJob(cur, action);
  if (next) await persistJob(next);
  return next;
}

export function postToPort(port: chrome.runtime.Port, msg: JobPortMessage): boolean {
  try {
    port.postMessage(msg);
    return true;
  } catch {
    return false;
  }
}

function broadcastJob(job: TranslateJob | null) {
  for (const port of jobPorts) {
    if (!postToPort(port, { type: 'JOB_UPDATE', job })) jobPorts.delete(port);
  }
}

export function registerJobPort(port: chrome.runtime.Port) {
  jobPorts.add(port);
  void loadJob().then((job) => {
    if (job) postToPort(port, { type: 'JOB_UPDATE', job });
  });
  port.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type === 'PING') {
      void getActiveJob().then((job) => {
        postToPort(port, { type: 'PONG', job: memoryJob ?? job });
      });
    }
  });
  port.onDisconnect.addListener(() => {
    jobPorts.delete(port);
  });
}

export async function updateBadge(job: TranslateJob | null) {
  const { text, color } = badgeForJob(job);
  try {
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    /* action may be unavailable in tests */
  }
}

async function ensureKeepAlive(on: boolean) {
  try {
    if (on) {
      await chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
    } else {
      await chrome.alarms.clear(KEEP_ALIVE_ALARM);
    }
  } catch {
    /* alarms permission / unavailable */
  }
}
