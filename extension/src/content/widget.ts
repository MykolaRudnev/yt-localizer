import { jobNeedsReview, jobPercent, shouldShowJobWidget, type TranslateJob } from '@shared/job';
import { escapeHtml } from '../ui/html';
import { icon, SPINNER } from '../ui/icons';
import { sendMsg } from './api';
import { appendToPage, THEME_ROOT_CLASS, WIDGET_ID } from './dom';

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
    el.className = THEME_ROOT_CLASS;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-live', 'polite');
    appendToPage(el);
    void placeWidget(el);
    makeDraggable(el, onExpand);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onExpand();
      }
    });
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
  const running = job.phase === 'running';
  const label = running
    ? `Translating ${job.doneCount}/${job.totalCount}`
    : reviewCount > 0
      ? `${reviewCount} need${reviewCount === 1 ? 's' : ''} review`
      : `Done ${job.doneCount}/${job.totalCount}`;
  const sub = running ? `${pct}% · click to expand` : 'Click to open the preview';
  const glyph = running ? SPINNER : reviewCount > 0 ? icon('alert') : icon('check');
  el.dataset.state = running ? 'running' : reviewCount > 0 ? 'review' : 'done';
  el.title = 'YT Localizer — click to expand, drag to move';
  el.innerHTML = `
    <div class="vt-widget-main">
      <span class="vt-widget-icon" aria-hidden="true">${glyph}</span>
      <span class="vt-widget-text">
        <span class="vt-widget-label">${escapeHtml(label)}</span>
        <span class="vt-widget-sub">${escapeHtml(sub)}</span>
      </span>
      <span class="ytl-icon-slot" aria-hidden="true">${icon('expand')}</span>
    </div>
    <div class="ytl-progress ytl-progress--sm"><div class="ytl-progress__fill" style="width:${
      running ? pct : 100
    }%"></div></div>`;
}
