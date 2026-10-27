import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';

const argv = (...rest: string[]) => ['node', 'yt-localizer', ...rest];

describe('CLI parseArgs', () => {
  it('defaults to dry-run, gemini, auto-approve OFF', () => {
    expect(parseArgs(argv('vid', '--langs', 'es, de,'))).toEqual({
      videoId: 'vid',
      langs: ['es', 'de'],
      engine: 'gemini',
      dryRun: true,
      autoApprove: false,
    });
  });

  it('--publish and --auto-approve', () => {
    const a = parseArgs(argv('vid', '--langs', 'es', '--engine', 'deepl', '--publish', '--auto-approve'));
    expect(a.engine).toBe('deepl');
    expect(a.dryRun).toBe(false);
    expect(a.autoApprove).toBe(true);
  });

  it('--dry-run wins over --publish', () => {
    expect(parseArgs(argv('vid', '--langs', 'es', '--publish', '--dry-run')).dryRun).toBe(true);
  });
});
