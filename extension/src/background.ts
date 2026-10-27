/**
 * MV3 service worker entry: wires Chrome events to the background modules.
 * - background/handlers.ts       runtime message router
 * - background/job-store.ts      active job state, persistence, port broadcast
 * - background/translate-job.ts  translate run + auto-publish batches
 * - background/publish.ts        merge-publish to YouTube
 * - background/video-access.ts   channel/token resolution per video
 */
import { DEFAULT_SETTINGS } from '@shared/settings';
import { handleMessage } from './background/handlers';
import {
  KEEP_ALIVE_ALARM,
  loadJob,
  persistJob,
  registerJobPort,
  updateBadge,
} from './background/job-store';
import { recoverInterruptedJob } from './background/translate-job';
import { JOB_PORT, type BackgroundMessage } from './protocol';
import { getActiveJob, saveSettings } from './storage';

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get('settings');
  if (!data.settings) {
    await saveSettings({ ...DEFAULT_SETTINGS });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    void getActiveJob(); // touch storage / keep SW warm
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === JOB_PORT) registerJobPort(port);
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  // Always settle sendResponse so MV3 never leaves the channel hanging.
  const reply = (value: unknown) => {
    try {
      sendResponse(value);
    } catch {
      /* channel already closed */
    }
  };
  handleMessage(message)
    .then(reply)
    .catch((err: unknown) => {
      reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  return true;
});

// Restore job + badge on SW wake
void (async () => {
  const job = await loadJob();
  await updateBadge(job);
  if (job?.phase === 'running') {
    await persistJob(recoverInterruptedJob(job));
  }
})();
