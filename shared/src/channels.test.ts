import { describe, expect, it } from 'vitest';
import {
  isAccessTokenFresh,
  mergeSettingsForChannel,
  orderChannelsForProbe,
  seedChannelSettings,
  selectChannelForVideo,
  tokenMatchesVideoChannel,
} from './channels.js';
import { DEFAULT_SETTINGS, type ConnectedChannel } from './types.js';

function ch(
  id: string,
  extra: Partial<ConnectedChannel> = {},
): ConnectedChannel {
  return {
    id,
    title: `Channel ${id}`,
    thumbnailUrl: '',
    email: `${id}@example.com`,
    accessToken: `tok-${id}`,
    expiresAt: Date.now() + 3_600_000,
    ...extra,
  };
}

describe('selectChannelForVideo / tokenMatchesVideoChannel', () => {
  const channels = {
    UC_A: ch('UC_A'),
    UC_B: ch('UC_B'),
  };

  it('selects the stored token for the video channelId', () => {
    expect(selectChannelForVideo(channels, 'UC_B')?.id).toBe('UC_B');
    expect(selectChannelForVideo(channels, 'UC_B')?.accessToken).toBe('tok-UC_B');
  });

  it('returns null when that channel is not connected', () => {
    expect(selectChannelForVideo(channels, 'UC_MISSING')).toBeNull();
    expect(selectChannelForVideo(channels, null)).toBeNull();
  });

  it('never matches a token from a different channel', () => {
    expect(tokenMatchesVideoChannel(channels.UC_A, 'UC_B')).toBe(false);
    expect(tokenMatchesVideoChannel(channels.UC_A, 'UC_A')).toBe(true);
    expect(tokenMatchesVideoChannel(null, 'UC_A')).toBe(false);
  });
});

describe('orderChannelsForProbe', () => {
  it('puts the active channel first', () => {
    const channels = { UC_A: ch('UC_A'), UC_B: ch('UC_B') };
    expect(orderChannelsForProbe(channels, 'UC_B').map((c) => c.id)).toEqual([
      'UC_B',
      'UC_A',
    ]);
  });
});

describe('isAccessTokenFresh', () => {
  it('treats tokens within 60s of expiry as stale', () => {
    const now = 1_000_000;
    expect(
      isAccessTokenFresh({ accessToken: 'x', expiresAt: now + 30_000 }, now),
    ).toBe(false);
    expect(
      isAccessTokenFresh({ accessToken: 'x', expiresAt: now + 120_000 }, now),
    ).toBe(true);
  });
});

describe('seedChannelSettings / mergeSettingsForChannel', () => {
  it('adds the channel name to protected terms by default', () => {
    const s = seedChannelSettings('Veil of Veles PL');
    expect(s.protectedTerms[0]).toBe('Veil of Veles PL');
    expect(s.protectedTerms).toContain('Veil of Veles');
  });

  it('does not duplicate channel name (case-insensitive)', () => {
    const s = seedChannelSettings('Veil of Veles', {
      protectedTerms: ['veil of veles', 'foo'],
    });
    expect(s.protectedTerms.filter((t) => /veil of veles/i.test(t))).toHaveLength(
      1,
    );
  });

  it('merges per-channel languages/terms over global engine settings', () => {
    const channel = seedChannelSettings('My Channel', {
      selectedLanguages: ['pl', 'de'],
      defaultSourceLanguage: 'pl',
      protectedTerms: ['brand'],
    });
    const merged = mergeSettingsForChannel(DEFAULT_SETTINGS, channel);
    expect(merged.engine).toBe(DEFAULT_SETTINGS.engine);
    expect(merged.geminiApiKey).toBe(DEFAULT_SETTINGS.geminiApiKey);
    expect(merged.selectedLanguages).toEqual(['pl', 'de']);
    expect(merged.defaultSourceLanguage).toBe('pl');
    expect(merged.protectedTerms[0]).toBe('My Channel');
    expect(merged.protectedTerms).toContain('brand');
  });

  it('falls back to global when channel settings are missing', () => {
    expect(mergeSettingsForChannel(DEFAULT_SETTINGS, null)).toBe(DEFAULT_SETTINGS);
  });
});
