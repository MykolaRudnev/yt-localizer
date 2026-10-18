import {
  DEFAULT_CHANNEL_SETTINGS,
  type AppSettings,
  type ChannelSettings,
  type ConnectedChannel,
} from './types.js';

/** Pick the stored channel entry for a video's channelId, or null if not connected. */
export function selectChannelForVideo(
  channels: Record<string, ConnectedChannel>,
  videoChannelId: string | undefined | null,
): ConnectedChannel | null {
  if (!videoChannelId) return null;
  return channels[videoChannelId] ?? null;
}

/** True when a stored token may be used to write localizations for this video. */
export function tokenMatchesVideoChannel(
  channel: ConnectedChannel | null | undefined,
  videoChannelId: string | undefined | null,
): boolean {
  return !!channel && !!videoChannelId && channel.id === videoChannelId;
}

/** Prefer active channel, then insertion order of the map. */
export function orderChannelsForProbe(
  channels: Record<string, ConnectedChannel>,
  activeChannelId: string | null | undefined,
): ConnectedChannel[] {
  const list = Object.values(channels);
  if (!activeChannelId) return list;
  const active = channels[activeChannelId];
  if (!active) return list;
  return [active, ...list.filter((c) => c.id !== activeChannelId)];
}

export function isAccessTokenFresh(
  channel: Pick<ConnectedChannel, 'accessToken' | 'expiresAt'>,
  now = Date.now(),
): boolean {
  if (!channel.accessToken) return false;
  return now < channel.expiresAt - 60_000;
}

/** Seed per-channel settings; always include the channel title in protected terms. */
export function seedChannelSettings(
  channelTitle: string,
  defaults: Partial<ChannelSettings> = {},
): ChannelSettings {
  const base: ChannelSettings = {
    ...DEFAULT_CHANNEL_SETTINGS,
    ...defaults,
    selectedLanguages: [
      ...(defaults.selectedLanguages ?? DEFAULT_CHANNEL_SETTINGS.selectedLanguages),
    ],
    lastUsedLanguages: [
      ...(defaults.lastUsedLanguages ?? DEFAULT_CHANNEL_SETTINGS.lastUsedLanguages),
    ],
    protectedTerms: [...(defaults.protectedTerms ?? DEFAULT_CHANNEL_SETTINGS.protectedTerms)],
    defaultSourceLanguage:
      defaults.defaultSourceLanguage ?? DEFAULT_CHANNEL_SETTINGS.defaultSourceLanguage,
    autoPublish: defaults.autoPublish ?? DEFAULT_CHANNEL_SETTINGS.autoPublish ?? false,
  };
  const title = channelTitle.trim();
  if (title && !base.protectedTerms.some((t) => t.toLowerCase() === title.toLowerCase())) {
    base.protectedTerms = [title, ...base.protectedTerms];
  }
  return base;
}

/** Merge global engine/options with per-channel language/terms settings. */
export function mergeSettingsForChannel(
  global: AppSettings,
  channel: ChannelSettings | null | undefined,
): AppSettings {
  if (!channel) return global;
  return {
    ...global,
    selectedLanguages: channel.selectedLanguages,
    lastUsedLanguages: channel.lastUsedLanguages,
    protectedTerms: channel.protectedTerms,
    defaultSourceLanguage: channel.defaultSourceLanguage,
  };
}

/** Effective auto-publish for a channel (default OFF). */
export function channelAutoPublish(channel: ChannelSettings | null | undefined): boolean {
  return channel?.autoPublish === true;
}

export function publicChannelView(
  ch: ConnectedChannel,
): Omit<ConnectedChannel, 'accessToken' | 'refreshToken' | 'expiresAt'> & {
  expiresAt: number;
  hasToken: boolean;
} {
  return {
    id: ch.id,
    title: ch.title,
    thumbnailUrl: ch.thumbnailUrl,
    email: ch.email,
    expiresAt: ch.expiresAt,
    hasToken: !!ch.accessToken,
  };
}
