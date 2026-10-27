import { mergeSettingsForChannel } from '@shared/channels';
import { isJobFinished, jobAutoApproved, jobHasOpenWork, markJobPublished } from '@shared/job';
import type { LocalizationResult } from '@shared/types';
import { ensureDefaultLanguage, listVideo, updateLocalizations } from '@shared/youtube';
import type { PublishResponse } from '../protocol';
import { getChannelSettings, getSettings, markTranslationsPublished } from '../storage';
import { logJobRun } from './job-log';
import { loadJob, persistJob } from './job-store';
import { resolveVideoAccess } from './video-access';

/** Manual Publish from the preview (refused while dry-run is ON). */
export async function publish(
  videoId: string,
  localizations: LocalizationResult[],
): Promise<PublishResponse> {
  const settings = await getSettings();
  if (settings.dryRun) {
    throw new Error(
      'Dry-run is ON — Publish is disabled. Turn off dry-run to publish.',
    );
  }
  return publishLocalizations(videoId, localizations, { endSessionWhenDone: true });
}

/**
 * Merge-publish localizations: always re-fetch current video before write so we
 * never delete other languages or clobber snippet fields.
 *
 * `endSessionWhenDone` clears the active job once nothing is left to publish or
 * review; rows still waiting for review keep the session open.
 */
export async function publishLocalizations(
  videoId: string,
  localizations: LocalizationResult[],
  opts: { endSessionWhenDone: boolean },
): Promise<PublishResponse> {
  if (!localizations.length) {
    return { ok: true, published: [] };
  }

  const settings = await getSettings();
  const access = await resolveVideoAccess(videoId);
  if (!access.ok) throw new Error(access.error);

  const { channelId, token } = access.resolved;
  const channelPrefs = await getChannelSettings(channelId);
  const merged = mergeSettingsForChannel(settings, channelPrefs);

  const video = access.resolved.video;
  if (video.snippet.channelId !== channelId) {
    throw new Error('Refusing to publish: token channel does not match video channel.');
  }

  if (!video.snippet.defaultLanguage) {
    await ensureDefaultLanguage(video, token, merged.defaultSourceLanguage || 'en');
  }
  // Re-fetch immediately before write to merge with latest remote localizations.
  const fresh = await listVideo(videoId, token);
  if (fresh.snippet.channelId !== channelId) {
    throw new Error('Refusing to publish: video channel no longer matches connected token.');
  }

  const map: Record<string, { title: string; description: string }> = {};
  for (const loc of localizations) {
    map[loc.language] = { title: loc.title, description: loc.description };
  }

  const startedAt = new Date().toISOString();
  const job = await loadJob();
  const jobForVideo = job?.videoId === videoId ? job : null;
  try {
    await updateLocalizations(fresh, token, map);
    const published = localizations.map((l) => l.language);
    const autoApproved = jobForVideo
      ? jobAutoApproved(jobForVideo).filter((code) => published.includes(code))
      : [];
    await logJobRun({ videoId, startedAt, dryRun: false, ok: published, failed: [], autoApproved });
    await markTranslationsPublished(videoId, published);
    const latest = await loadJob();
    if (latest?.videoId === videoId) {
      const marked = markJobPublished(latest, published);
      const done =
        opts.endSessionWhenDone && isJobFinished(marked) && !jobHasOpenWork(marked);
      await persistJob(done ? null : marked);
    }
    return { ok: true, published };
  } catch (err) {
    await logJobRun({
      videoId,
      startedAt,
      dryRun: false,
      ok: [],
      failed: localizations.map((l) => ({
        language: l.language,
        error: err instanceof Error ? err.message : String(err),
      })),
    });
    throw err;
  }
}
