/** Modal root / widget DOM plumbing for the Studio content script. */

import { escapeHtml } from '../ui/html';
import { icon } from '../ui/icons';

export const BUTTON_ID = 'veil-translate-btn';
export const MODAL_ID = 'vt-modal-root';
export const WIDGET_ID = 'vt-job-widget';

/** What the modal root currently shows (`data-mode`). */
export type ModalMode = 'picker' | 'connect' | 'progress' | 'preview' | 'result';

/** Class that scopes design tokens + components to our roots (never Studio's :root). */
export const THEME_ROOT_CLASS = 'ytl-root';

/** Modes that belong to a translate job session (vs. the language picker). */
export const JOB_MODES: readonly ModalMode[] = ['progress', 'preview', 'result'];

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

let unbindModalKeys: (() => void) | null = null;
const chromeBoundRoots = new WeakSet<HTMLElement>();

export function appendToPage(el: HTMLElement): void {
  (document.body || document.documentElement).appendChild(el);
}

export function getModalRoot(): HTMLElement | null {
  return document.getElementById(MODAL_ID);
}

export function modalMode(root: HTMLElement | null = getModalRoot()): ModalMode | undefined {
  return root?.dataset.mode as ModalMode | undefined;
}

/** Existing modal root, or a fresh one mounted on the page. */
export function ensureModalRoot(mode?: ModalMode): HTMLElement {
  let root = getModalRoot();
  if (!root) {
    root = document.createElement('div');
    root.id = MODAL_ID;
    root.className = THEME_ROOT_CLASS;
    appendToPage(root);
  }
  if (mode) root.dataset.mode = mode;
  return root;
}

export function removeModal(): void {
  unbindModalKeys?.();
  unbindModalKeys = null;
  getModalRoot()?.remove();
}

function focusables(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null,
  );
}

function trapFocus(e: KeyboardEvent, root: HTMLElement) {
  const panel = root.querySelector<HTMLElement>('.vt-panel');
  if (!panel) return;
  const list = focusables(panel);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Modal closes only via X / Esc / Close — never outside click or scroll. */
export function bindModalChrome(opts: {
  onClose: () => void;
  onEnter?: () => void;
  root: HTMLElement;
}): void {
  unbindModalKeys?.();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
      return;
    }
    if (e.key === 'Enter' && opts.onEnter) {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
      e.preventDefault();
      opts.onEnter();
    }
    if (e.key === 'Tab') trapFocus(e, opts.root);
  };
  document.addEventListener('keydown', onKey, true);
  unbindModalKeys = () => document.removeEventListener('keydown', onKey, true);

  // Root listeners survive repaints (innerHTML) — bind them once per root.
  if (!chromeBoundRoots.has(opts.root)) {
    chromeBoundRoots.add(opts.root);
    // Block backdrop click from doing anything (do not close)
    opts.root.addEventListener('mousedown', (e) => {
      if (e.target === opts.root) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    opts.root.addEventListener(
      'wheel',
      (e) => {
        // Allow scroll inside panel; don't let page steal focus / dismiss
        const panel = opts.root.querySelector('.vt-panel');
        if (panel && !panel.contains(e.target as Node)) {
          e.preventDefault();
        }
      },
      { passive: false },
    );
  }

  const panel = opts.root.querySelector<HTMLElement>('.vt-panel');
  if (panel && !panel.contains(document.activeElement)) focusables(panel)[0]?.focus();
}

/**
 * Shared modal header: eyebrow + title (#vt-title, the dialog label) +
 * optional subtitle + close button (#vt-x).
 */
export function panelHeadHtml(opts: {
  title: string;
  subtitle?: string;
  closeLabel?: string;
}): string {
  const sub = opts.subtitle
    ? `<p class="vt-subtitle" id="vt-subtitle" title="${escapeHtml(opts.subtitle)}">${escapeHtml(opts.subtitle)}</p>`
    : '';
  return `<header class="vt-panel-head">
      <div class="vt-head-text">
        <p class="ytl-eyebrow">YT Localizer</p>
        <h2 class="vt-heading" id="vt-title">${escapeHtml(opts.title)}</h2>
        ${sub}
      </div>
      <button type="button" class="ytl-btn ytl-btn--ghost ytl-btn--icon" id="vt-x" aria-label="${escapeHtml(
        opts.closeLabel ?? 'Close',
      )}" title="${escapeHtml(opts.closeLabel ?? 'Close')} (Esc)">${icon('close')}</button>
    </header>`;
}

/** Typed `querySelector` that throws when a required element is missing. */
export function $req<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`YT Localizer: missing ${selector}`);
  return el;
}
