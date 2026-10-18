import { describe, expect, it } from 'vitest';
import {
  earliestResetMs,
  formatResetLocal,
  isExhausted,
  markExhausted,
  nextPacificMidnightMs,
  pruneExhaustion,
  quotaStopSummary,
} from './quota.js';

describe('nextPacificMidnightMs', () => {
  it('returns a time after now on the next Pacific calendar day', () => {
    // 2024-06-15 15:00:00 UTC = 08:00 PDT
    const now = Date.UTC(2024, 5, 15, 15, 0, 0);
    const next = nextPacificMidnightMs(now);
    expect(next).toBeGreaterThan(now);
    expect(next - now).toBeLessThanOrEqual(24 * 3600_000);
    // Just after midnight Pacific should be a new date key
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const before = fmt.format(new Date(now));
    const after = fmt.format(new Date(next));
    expect(after).not.toBe(before);
    // 1s before next is still "today"
    expect(fmt.format(new Date(next - 1000))).toBe(before);
  });
});

describe('exhaustion map', () => {
  it('marks model until Pacific midnight and prunes after', () => {
    const now = Date.UTC(2024, 5, 15, 15, 0, 0);
    const map = markExhausted({}, 'gemini-2.5-flash', now);
    expect(isExhausted(map, 'gemini-2.5-flash', now)).toBe(true);
    expect(isExhausted(map, 'gemini-2.0-flash-lite', now)).toBe(false);
    const until = map['gemini-2.5-flash'];
    expect(pruneExhaustion(map, until + 1)).toEqual({});
    expect(isExhausted(map, 'gemini-2.5-flash', until + 1)).toBe(false);
  });

  it('earliestResetMs picks soonest expiry', () => {
    const now = 1_000_000;
    const map = { a: now + 5000, b: now + 1000 };
    expect(earliestResetMs(map, now)).toBe(now + 1000);
  });

  it('quotaStopSummary includes done/remaining and local reset time', () => {
    const reset = Date.parse('2024-06-16T07:00:00Z');
    const face = quotaStopSummary(3, 7, reset, reset - 3600_000);
    expect(face.summary).toMatch(/3 done, 7 remaining/);
    expect(face.summary).toMatch(/resets at \d{2}:\d{2}/);
    expect(formatResetLocal(reset, reset - 3600_000)).toMatch(/\d{2}:\d{2}/);
  });
});
