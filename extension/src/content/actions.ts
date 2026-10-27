import type { TranslateJob } from '@shared/job';

/**
 * Callbacks views use to drive the session (implemented by content/session.ts).
 * Views never import the session directly, which keeps the module graph acyclic.
 */
export interface JobUiActions {
  /** Running → minimize; finished → end session (confirm if unpublished work). */
  close(): void;
  /** Discard the current job (with confirm) and open the language picker. */
  newSession(): void;
  /** Start a new job for just these languages. */
  retry(videoId: string, languages: string[]): void;
  /** Apply a job snapshot returned by the background (ports may lag). */
  applyJob(job: TranslateJob | null): void;
  /** Leave the publish result panel and show the preview again. */
  backToPreview(): void;
}

export interface PickerActions {
  close(): void;
  /** Job created by START_TRANSLATE (null when every language was skipped). */
  started(job: TranslateJob | null): void;
}
