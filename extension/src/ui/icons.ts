/**
 * Inline SVG icons (16×16 grid, stroke = currentColor). Decorative only:
 * always pair with visible text or an aria-label on the control.
 */

function svg(paths: string, extraClass = ''): string {
  return `<svg class="ytl-icon${extraClass ? ` ${extraClass}` : ''}" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const PATHS = {
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  checkCircle: '<circle cx="8" cy="8" r="6.25"/><path d="M5.5 8.25l1.75 1.75 3.25-3.75"/>',
  alert: '<path d="M8 2.25l6 10.5H2z"/><path d="M8 6.75v2.5"/><path d="M8 11.25h.01"/>',
  error: '<circle cx="8" cy="8" r="6.25"/><path d="M10 6l-4 4M6 6l4 4"/>',
  info: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v3.5"/><path d="M8 5h.01"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25l3 3"/>',
  expand: '<path d="M9.5 2.75h3.75V6.5"/><path d="M13 3l-4.5 4.5"/><path d="M6.5 13.25H2.75V9.5"/><path d="M3 13l4.5-4.5"/>',
  clock: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.75V8l2 1.5"/>',
  minus: '<path d="M4 8h8"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** `<svg class="ytl-icon">` markup for innerHTML templates. */
export function icon(name: IconName, opts: { small?: boolean } = {}): string {
  return svg(PATHS[name], opts.small ? 'ytl-icon--sm' : '');
}

/** Spinner span (pure CSS) for running states. */
export const SPINNER = '<span class="ytl-spinner" aria-hidden="true"></span>';
