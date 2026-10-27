import { jobNeedsReview, jobPercent, shouldShowJobWidget, type TranslateJob } from '@shared/job';
import { escapeHtml } from '../ui/html';
import { sendMsg } from './api';
import { appendToPage, WIDGET_ID } from './dom';

/** Minimized floating job pill (running jobs, or finished with pending reviews). */

export function removeWidget(): void {
  document.getElementById(WIDGET_ID)?.remove();
}

/** Show the widget when the job warrants it; `onExpand` reopens the full modal. */
export function syncWidget(job: TranslateJob | null, onExpand: () => void): void {
  if (!job || !shouldShowJobWidget(job)) {
    removeWidget();
    return;
  }
  let el = document.getElementById(WIDGET_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = WIDGET_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    appendToPage(el);
    void placeWidget(el);
    makeDraggable(el, onExpand);
  }
  paintWidget(el, job);
}

async function placeWidget(el: HTMLElement) {
  const res = await sendMsg<{ ok: boolean; pos?: { x: number; y: number } | null }>({
    type: 'GET_WIDGET_POS',
  });
  if (res?.pos) {
    el.style.left = `${res.pos.x}px`;
    el.style.top = `${res.pos.y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }
}

function makeDraggable(el: HTMLElement, onClick: () => void) {
  let ox = 0;
  let oy = 0;
  let dragging = false;
  let moved = false;

  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    moved = false;
    const r = el.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved = true;
    const x = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, e.clientX - ox));
    const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e.clientY - oy));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  el.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const x = parseFloat(el.style.left || '0');
    const y = parseFloat(el.style.top || '0');
    void sendMsg({ type: 'SET_WIDGET_POS', x, y });
    if (!moved) onClick();
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
}

function paintWidget(el: HTMLElement, job: TranslateJob) {
  const reviewCount = jobNeedsReview(job).length;
  const pct = jobPercent(job);
  const label =
    job.phase === 'running'
      ? `Translating ${job.doneCount}/${job.totalCount}`
      : reviewCount > 0
        ? `${reviewCount} need review`
        : `Done ${job.doneCount}/${job.totalCount}`;
  const spin =
    job.phase === 'running'
      ? `<span class="vt-widget-icon"><span class="vt-spin" aria-hidden="true"></span></span>`
      : `<span class="vt-widget-icon" aria-hidden="true">!</span>`;
  el.innerHTML = `
    <div class="vt-widget-main">
      ${spin}
      <span class="vt-widget-label">${escapeHtml(label)}</span>
    </div>
    <div class="vt-widget-bar"><div class="vt-widget-fill" style="width:${
      job.phase === 'running' ? pct : 100
    }%"></div></div>`;
}
