import {
  isJobFinished,
  jobPreviewRows,
  needsDiscardPreviewConfirm,
  shouldEndSessionOnClose,
  shouldReopenExistingJob,
  type TranslateJob,
} from '@shared/job';
import { connectRuntimePort } from '../messaging';
import { JOB_PORT, type JobPortMessage, type StartTranslateResponse } from '../protocol';
import type { JobUiActions, PickerActions } from './actions';
import { fetchJob, sendMsg } from './api';
import { getModalRoot, JOB_MODES, modalMode, removeModal } from './dom';
import { openPicker } from './picker';
import { renderPreview } from './preview-view';
import { renderProgress } from './progress-view';
import { syncResultPanel } from './result-view';
import { removeWidget, syncWidget } from './widget';

/**
 * Content-script session controller: owns the job snapshot, the job port and
 * whether the full modal (expanded) or the floating widget is shown.
 */

const VIDEO_PATH_RE = /\/video\/([^/]+)\/(edit|translations)(?:\/|$|\?)/;

let uiExpanded = false;
let jobPort: chrome.runtime.Port | null = null;
let currentJob: TranslateJob | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

export function getVideoId(): string | null {
  return location.pathname.match(VIDEO_PATH_RE)?.[1] ?? null;
}

export function isUiExpanded(): boolean {
  return uiExpanded;
}

const jobActions: JobUiActions = {
  close: () => void closeOrEndJobUi(),
  newSession: () => void startNewTranslationFromJob(),
  retry: (videoId, languages) => void retryLanguages(videoId, languages),
  applyJob: (job) => onJobUpdate(job),
  backToPreview: () => {
    if (currentJob) renderJobModal(currentJob, { forcePreview: true });
  },
};

const pickerActions: PickerActions = {
  close: () => {
    uiExpanded = false;
    removeModal();
  },
  started: (job) => void onJobStarted(job),
};

function connectJobPort() {
  if (jobPort) return;
  jobPort = connectRuntimePort(JOB_PORT);
  if (!jobPort) return;
  jobPort.onMessage.addListener((msg: JobPortMessage) => {
    if (msg.type === 'JOB_UPDATE' || msg.type === 'PONG') onJobUpdate(msg.job ?? null);
  });
  jobPort.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    jobPort = null;
    // Reconnect while a job may still be running
    if (currentJob?.phase === 'running') {
      setTimeout(() => connectJobPort(), 500);
    }
  });
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    try {
      jobPort?.postMessage({ type: 'PING' });
    } catch {
      /* ignore */
    }
  }, 20_000);
}

/** Keep the widget in sync; clicking it expands the job modal. */
export function syncJobWidget() {
  syncWidget(currentJob, () => {
    if (currentJob) expandUi(currentJob);
  });
}

function onJobUpdate(job: TranslateJob | null) {
  currentJob = job;
  const root = getModalRoot();
  const mode = modalMode(root);
  if (!job) {
    removeWidget();
    if (uiExpanded && root && mode === 'result') {
      // Publish ended the session — keep the result on screen until Close.
      syncResultPanel(root, null);
    } else if (uiExpanded && mode && JOB_MODES.includes(mode)) {
      uiExpanded = false;
      removeModal();
    }
    return;
  }
  if (job.videoId === getVideoId()) {
    if (uiExpanded) renderJobModal(job);
    else syncJobWidget();
  } else if (!uiExpanded) {
    // Job for another video — widget only while still running
    syncJobWidget();
  }
}

/** Route the job to progress / preview / result view. */
function renderJobModal(job: TranslateJob, opts: { forcePreview?: boolean } = {}) {
  const root = getModalRoot();
  // A publish result stays visible until the user leaves it (or a new run starts).
  if (root && modalMode(root) === 'result' && job.phase !== 'running' && !opts.forcePreview) {
    syncResultPanel(root, job);
    return;
  }
  if (isJobFinished(job) && jobPreviewRows(job).length > 0) {
    renderPreview(job, jobActions);
    return;
  }
  renderProgress(job, jobActions);
}

function minimizeUi() {
  uiExpanded = false;
  removeModal();
  syncJobWidget();
}

function expandUi(job: TranslateJob) {
  uiExpanded = true;
  removeWidget();
  renderJobModal(job);
}

/** CLEAR_JOB + tear down widget/modal so SPA reload cannot resurrect chrome. */
async function clearJobSession(): Promise<void> {
  await sendMsg({ type: 'CLEAR_JOB' });
  currentJob = null;
  removeWidget();
  uiExpanded = false;
  removeModal();
}

function confirmDiscardPreview(): boolean {
  return confirm('Close and discard preview? Cached translations are kept for re-use.');
}

/**
 * Running → minimize (job continues). Finished → clear job session (cache kept)
 * so the next open shows the language picker. Confirm if unpublished preview rows.
 * Always reads `currentJob` so progress→done updates are not stale closures.
 */
async function closeOrEndJobUi() {
  const j = currentJob;
  if (!j || !shouldEndSessionOnClose(j)) {
    minimizeUi();
    return;
  }
  if (needsDiscardPreviewConfirm(j) && !confirmDiscardPreview()) return;
  await clearJobSession();
}

async function startNewTranslationFromJob() {
  const j = currentJob;
  if (j?.phase === 'running') {
    const ok = confirm(
      'A translation is still running. Stop it and start a new one? Unfinished languages will be left pending.',
    );
    if (!ok) return;
    await sendMsg({ type: 'STOP_TRANSLATE' });
  } else if (j && shouldEndSessionOnClose(j)) {
    if (needsDiscardPreviewConfirm(j) && !confirmDiscardPreview()) return;
  }
  await clearJobSession();
  await openPickerForCurrentVideo();
}

async function openPickerForCurrentVideo() {
  const videoId = getVideoId();
  if (!videoId) return;
  uiExpanded = true;
  await openPicker(videoId, pickerActions);
}

async function onJobStarted(job: TranslateJob | null) {
  connectJobPort();
  currentJob = job ?? (await fetchJob());
  if (currentJob) expandUi(currentJob);
}

async function retryLanguages(videoId: string, languages: string[]) {
  const res = await sendMsg<StartTranslateResponse>({
    type: 'START_TRANSLATE',
    videoId,
    languages,
    skipExisting: false,
  });
  if (!res?.ok) {
    alert(`YT Localizer: ${res?.error ?? 'Retry failed'}`);
    return;
  }
  await onJobStarted(res.job ?? null);
}

/** Studio pill click: reopen this video's job, or start with the language picker. */
export async function onPillClick() {
  const videoId = getVideoId();
  if (!videoId) return;
  connectJobPort();
  const job = await fetchJob();
  currentJob = job;
  if (job && shouldReopenExistingJob(job, videoId)) {
    expandUi(job);
    return;
  }
  await openPickerForCurrentVideo();
}

export async function bootJobUi() {
  connectJobPort();
  currentJob = await fetchJob();
  if (!uiExpanded) syncJobWidget();
}
