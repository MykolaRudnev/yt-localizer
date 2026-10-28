import type { TranslateJob } from '@shared/job';
import type { AppSettings } from '@shared/types';
import { sendRuntimeMessage } from '../messaging';
import type { BackgroundMessage, JobResponse, SettingsResponse } from '../protocol';

/** Send a typed message to the background; throws if the worker is unreachable. */
export async function sendMsg<T = unknown>(payload: BackgroundMessage): Promise<T> {
  const res = await sendRuntimeMessage<T>(payload);
  if (res == null) throw new Error('Extension background unavailable — try reloading the extension');
  return res;
}

export async function getSettings(): Promise<AppSettings> {
  const res = await sendMsg<SettingsResponse>({ type: 'GET_SETTINGS' });
  if (!res?.ok || !res.settings) throw new Error('Could not load settings');
  return res.settings;
}

export async function fetchJob(): Promise<TranslateJob | null> {
  const res = await sendMsg<JobResponse>({ type: 'GET_JOB' });
  return res?.job ?? null;
}

/** First enable of auto-publish needs a one-time acknowledgement. */
export async function confirmAutoPublish(): Promise<boolean> {
  const ack = await sendMsg<{ ok: boolean; acked?: boolean }>({ type: 'GET_AUTO_PUBLISH_ACK' });
  if (ack?.acked) return true;
  const ok = window.confirm(
    'Auto-publish writes translations to YouTube as they finish (in batches). Dry-run must be OFF. Continue?',
  );
  if (ok) await sendMsg({ type: 'ACK_AUTO_PUBLISH' });
  return ok;
}

/**
 * Persist auto-approve and apply it to the active job; returns the updated job.
 * Throws when the background fails — a failed toggle must not read as "no job"
 * (that tears the modal down).
 */
export async function setAutoApprove(enabled: boolean): Promise<TranslateJob> {
  const res = await sendMsg<JobResponse & { error?: string }>({ type: 'SET_AUTO_APPROVE', enabled });
  if (!res.ok || !res.job) throw new Error(res.error ?? 'Could not change auto-approve');
  return res.job;
}

/** Toggle handler shared by the job views: apply on success, revert + explain on failure. */
export function bindAutoApproveToggle(
  input: HTMLInputElement,
  applyJob: (job: TranslateJob) => void,
): void {
  input.addEventListener('change', () => {
    const enabled = input.checked;
    input.disabled = true;
    setAutoApprove(enabled)
      .then(applyJob)
      .catch((err: unknown) => {
        input.checked = !enabled;
        alert(`YT Localizer: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        input.disabled = false;
      });
  });
}
