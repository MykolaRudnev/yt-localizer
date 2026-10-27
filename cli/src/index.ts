#!/usr/bin/env node
/**
 * yt-localizer <videoId> --langs es,de,pl --engine gemini --dry-run [--auto-approve]
 */
import { translateAllLanguages } from '../../shared/src/pipeline.js';
import { autoApprovedSummary, partitionForPublish } from '../../shared/src/review.js';
import { DEFAULT_SETTINGS } from '../../shared/src/settings.js';
import type { LocalizationResult } from '../../shared/src/types.js';
import {
  ensureDefaultLanguage,
  listVideo,
  updateLocalizations,
} from '../../shared/src/youtube.js';
import { parseArgs, USAGE } from './args.js';
import { getAccessToken, loadSecrets } from './auth.js';

function printResult(r: LocalizationResult, tag: string) {
  console.log(`--- ${r.language}${tag} ---`);
  console.log(r.title);
  if (r.shortened && r.fullTitle && r.fullTitle !== r.title) {
    console.log(`  (full: ${r.fullTitle})`);
  }
  console.log(r.description.slice(0, 200) + (r.description.length > 200 ? '…' : ''));
}

async function main() {
  const { videoId, langs, engine, dryRun, autoApprove } = parseArgs(process.argv);
  if (!videoId || !langs.length) {
    console.log(USAGE);
    process.exit(1);
  }

  const secrets = loadSecrets();
  const token = await getAccessToken(secrets);
  let video = await listVideo(videoId, token);
  if (!video.snippet.defaultLanguage) {
    if (dryRun) {
      video = {
        ...video,
        snippet: { ...video.snippet, defaultLanguage: 'en' },
      };
      console.log('Dry-run: would set defaultLanguage=en');
    } else {
      video = await ensureDefaultLanguage(video, token, 'en');
    }
  }

  const { ok, failed } = await translateAllLanguages(
    video.snippet.title,
    video.snippet.description,
    langs,
    {
      ...DEFAULT_SETTINGS,
      engine,
      geminiApiKey: secrets.geminiApiKey ?? '',
      geminiModel: secrets.geminiModel ?? '',
      deeplApiKey: secrets.deeplApiKey ?? '',
      libreTranslateUrl: secrets.libreTranslateUrl ?? DEFAULT_SETTINGS.libreTranslateUrl,
      libreTranslateApiKey: '',
      protectedTerms: [],
      defaultSourceLanguage: video.snippet.defaultLanguage || 'en',
    },
    (p) => console.log(`[${p.index + 1}/${p.total}] ${p.language}: ${p.status}${p.error ? ' ' + p.error : ''}`),
  );

  // Same review gate as the extension: shortened titles need review unless --auto-approve.
  const { ready, needsReview, autoApproved } = partitionForPublish(ok, { autoApprove });

  console.log('\nResults:');
  for (const r of ready) printResult(r, r.autoApproved ? ' (shortened, auto-approved)' : '');
  for (const r of needsReview) printResult(r, ' (shortened — needs review)');
  if (failed.length) console.log('Failed:', failed);
  const auto = autoApprovedSummary(autoApproved.length);
  if (auto) console.log(`\n${auto}: ${autoApproved.join(', ')}`);
  if (needsReview.length) {
    console.log(
      `\n${needsReview.length} need review (title shortened to fit 100 chars): ${needsReview
        .map((r) => r.language)
        .join(', ')}. Not published — review in the extension, or re-run with --auto-approve.`,
    );
  }

  if (dryRun) {
    console.log('\nDry-run: not publishing. Pass --publish to write localizations.');
    return;
  }

  if (!ready.length) {
    console.log('\nNothing ready to publish.');
    return;
  }
  const map: Record<string, { title: string; description: string }> = {};
  for (const r of ready) {
    map[r.language] = { title: r.title, description: r.description };
  }
  const fresh = await listVideo(videoId, token);
  await updateLocalizations(fresh, token, map);
  console.log(`Published: ${Object.keys(map).join(', ')}${auto ? ` (${auto})` : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
