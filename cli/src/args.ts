import type { EngineId } from '../../shared/src/types.js';

export type CliArgs = {
  videoId: string | undefined;
  langs: string[];
  engine: EngineId;
  dryRun: boolean;
  /** Publish shortened (fitted) titles without manual review. */
  autoApprove: boolean;
};

export const USAGE =
  'Usage: yt-localizer <videoId> --langs es,de,pl [--engine gemini|deepl|libretranslate] [--dry-run|--publish] [--auto-approve]';

/** Parse `process.argv` (node, script, videoId, ...flags). Dry-run unless `--publish`. */
export function parseArgs(argv: string[]): CliArgs {
  const videoId = argv[2];
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const langs = (get('--langs') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const engine = (get('--engine') ?? 'gemini') as EngineId;
  const dryRun = argv.includes('--dry-run') || !argv.includes('--publish');
  const autoApprove = argv.includes('--auto-approve');
  return { videoId, langs, engine, dryRun, autoApprove };
}
