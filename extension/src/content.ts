/**
 * YouTube Studio content script entry: injects the pill button, tracks SPA
 * navigation and answers the popup's VT_PING.
 * - content/session.ts        job session controller (modal vs widget, job port)
 * - content/picker.ts         language picker + connect-channel modal
 * - content/progress-view.ts  running job progress list
 * - content/preview-view.ts   editable preview + Publish (review gate)
 * - content/result-view.ts    publish result
 * - content/widget.ts         minimized floating widget
 */
import './content.css';
import { BUTTON_ID } from './content/dom';
import { bootJobUi, getVideoId, isUiExpanded, onPillClick, syncJobWidget } from './content/session';

declare global {
  interface Window {
    __veilTranslateContentLoaded?: boolean;
  }
}

function ensureButton() {
  const videoId = getVideoId();
  let btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;

  if (!videoId) {
    btn?.remove();
    return;
  }

  if (!btn) {
    btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = 'Auto Titles & Description';
    btn.addEventListener('click', () => void onPillClick());
    (document.body || document.documentElement).appendChild(btn);
  }
}

let lastUrl = location.href;

/** SPA nav: keep running widget only; never resurrect finished sessions. */
function onUrlMaybeChanged() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    ensureButton();
    if (!isUiExpanded()) syncJobWidget();
    return true;
  }
  return false;
}

function watchSpa() {
  ensureButton();
  void bootJobUi();
  const obs = new MutationObserver(() => {
    if (!onUrlMaybeChanged()) ensureButton();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(onUrlMaybeChanged, 1000);
}

// Skip duplicate boot when chrome.scripting re-injects after an extension update.
if (!window.__veilTranslateContentLoaded) {
  window.__veilTranslateContentLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: string }).type === 'VT_PING'
    ) {
      try {
        sendResponse({ ok: true, videoId: getVideoId() });
      } catch {
        /* channel closed */
      }
      return true;
    }
    return false;
  });
  watchSpa();
}
