import type { LangJobState } from '@shared/job';
import { icon, SPINNER } from '../ui/icons';

/**
 * One visual vocabulary for language row states across progress, preview and
 * widget: every state = badge variant + icon + text (never colour alone).
 */
export type RowState =
  | 'pending'
  | 'running'
  | 'ready'
  | 'cached'
  | 'review'
  | 'auto'
  | 'published'
  | 'skipped'
  | 'error';

export function langRowState(s: LangJobState | undefined): RowState {
  switch (s?.status ?? 'pending') {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'needs_review':
      return 'review';
    case 'ok':
      if (s?.published) return 'published';
      if (s?.autoApproved) return 'auto';
      return s?.cached ? 'cached' : 'ready';
    case 'skipped':
      return 'skipped';
    default:
      return 'error';
  }
}

const BADGES: Record<RowState, { variant: string; glyph: string; label: string; title: string }> = {
  pending: { variant: '', glyph: icon('clock', { small: true }), label: 'Pending', title: 'Waiting in queue' },
  running: { variant: 'ytl-badge--accent', glyph: SPINNER, label: 'Translating', title: 'Translation in progress' },
  ready: { variant: 'ytl-badge--accent', glyph: icon('check', { small: true }), label: 'Ready', title: 'Ready to publish' },
  cached: {
    variant: 'ytl-badge--accent',
    glyph: icon('check', { small: true }),
    label: 'Ready · cached',
    title: 'Reused from the translation cache (no API call)',
  },
  review: {
    variant: 'ytl-badge--warning',
    glyph: icon('alert', { small: true }),
    label: 'Needs review',
    title: 'Title was shortened to fit 100 characters — approve, edit or use full',
  },
  auto: {
    variant: 'ytl-badge--accent',
    glyph: icon('check', { small: true }),
    label: 'Auto-approved',
    title: 'Shortened title approved automatically (Auto-approve is ON)',
  },
  published: {
    variant: 'ytl-badge--solid',
    glyph: icon('check', { small: true }),
    label: 'Published',
    title: 'Live on YouTube',
  },
  skipped: { variant: '', glyph: icon('minus', { small: true }), label: 'Skipped', title: 'Skipped' },
  error: { variant: 'ytl-badge--error', glyph: icon('error', { small: true }), label: 'Error', title: 'Translation failed' },
};

/** Badge markup for a row state. */
export function statusBadge(state: RowState, extraClass = ''): string {
  const b = BADGES[state];
  const cls = ['ytl-badge', b.variant, extraClass].filter(Boolean).join(' ');
  return `<span class="${cls}" title="${b.title}">${b.glyph}<span>${b.label}</span></span>`;
}
