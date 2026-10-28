/**
 * Screenshot entry for the Studio surfaces: renders the real content views with
 * demo data. Pick the surface with `#picker | #progress | #preview | #review | #widget`.
 */
import { DEMO_VIDEO_ID, demoJob, setDemoJob } from './fake-chrome';
import { openPicker } from '../src/content/picker';
import { renderPreview } from '../src/content/preview-view';
import { renderProgress } from '../src/content/progress-view';
import { syncWidget } from '../src/content/widget';

const noop = () => {};
const jobActions = { close: noop, newSession: noop, retry: noop, applyJob: noop, backToPreview: noop };

async function render(shot: string): Promise<void> {
  switch (shot) {
    case 'picker':
      await openPicker(DEMO_VIDEO_ID, { close: noop, started: noop });
      break;
    case 'progress':
      renderProgress(demoJob('running'), jobActions);
      break;
    case 'preview':
      renderPreview(demoJob('done'), jobActions);
      break;
    case 'review': {
      renderPreview(demoJob('done'), jobActions);
      document.querySelector<HTMLInputElement>('input[name="vt-row-filter"][value="review"]')?.click();
      const details = document.querySelector<HTMLDetailsElement>('tr[data-state="review"] .vt-shorten-details');
      if (details) details.open = true;
      break;
    }
    case 'widget': {
      const job = demoJob('running');
      setDemoJob(job);
      syncWidget(job, noop);
      break;
    }
  }
  (document.activeElement as HTMLElement | null)?.blur();
  document.documentElement.dataset.ready = '1';
}

void render(location.hash.slice(1) || 'picker');
