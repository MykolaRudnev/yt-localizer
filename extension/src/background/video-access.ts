import {
  orderChannelsForProbe,
  selectChannelForVideo,
  tokenMatchesVideoChannel,
} from '@shared/channels';
import { listVideo } from '@shared/youtube';
import { getValidAccessToken } from '../oauth';
import type { VideoMetaResponse } from '../protocol';
import { getActiveChannelId, getChannelSettings, getChannels } from '../storage';

export type ResolvedVideo = {
  video: Awaited<ReturnType<typeof listVideo>>;
  channelId: string;
  token: string;
};

/**
 * Find a connected channel whose token owns `videoId`. Probes the active
 * channel first; never writes with a token from a different channel.
 */
export async function resolveVideoAccess(videoId: string): Promise<
  | { ok: true; resolved: ResolvedVideo }
  | {
      ok: false;
      needsConnect: true;
      channelId?: string;
      channelTitle?: string;
      error: string;
    }
> {
  const channels = await getChannels();
  const ordered = orderChannelsForProbe(channels, await getActiveChannelId());

  if (!ordered.length) {
    return {
      ok: false,
      needsConnect: true,
      error: 'No YouTube channels connected. Add one in the YT Localizer popup.',
    };
  }

  let discovered: { channelId: string; channelTitle: string } | null = null;

  for (const ch of ordered) {
    try {
      const token = await getValidAccessToken(ch.id);
      const video = await listVideo(videoId, token);
      const videoChannelId = video.snippet.channelId;
      if (!videoChannelId) {
        throw new Error('Video has no channelId in snippet');
      }
      discovered = {
        channelId: videoChannelId,
        channelTitle: video.snippet.channelTitle ?? videoChannelId,
      };

      if (tokenMatchesVideoChannel(ch, videoChannelId)) {
        return {
          ok: true,
          resolved: { video, channelId: videoChannelId, token },
        };
      }
    } catch {
      // try next channel
    }
  }

  if (discovered) {
    const match = selectChannelForVideo(channels, discovered.channelId);
    if (match) {
      const token = await getValidAccessToken(match.id);
      const video = await listVideo(videoId, token);
      if (tokenMatchesVideoChannel(match, video.snippet.channelId)) {
        return {
          ok: true,
          resolved: { video, channelId: match.id, token },
        };
      }
    }
    return {
      ok: false,
      needsConnect: true,
      channelId: discovered.channelId,
      channelTitle: discovered.channelTitle,
      error: `This video belongs to ${discovered.channelTitle}, connect it`,
    };
  }

  return {
    ok: false,
    needsConnect: true,
    error:
      'Could not access this video with any connected channel. Connect the channel that owns it.',
  };
}

export async function fetchVideoMeta(videoId: string): Promise<VideoMetaResponse> {
  const access = await resolveVideoAccess(videoId);
  if (!access.ok) {
    return {
      ok: false,
      needsConnect: true,
      channelId: access.channelId,
      channelTitle: access.channelTitle,
      error: access.error,
    };
  }
  const { video, channelId } = access.resolved;
  const channelSettings = await getChannelSettings(channelId);
  return {
    ok: true,
    videoId: video.id,
    title: video.snippet.title,
    description: video.snippet.description,
    defaultLanguage: video.snippet.defaultLanguage,
    channelId,
    channelTitle: video.snippet.channelTitle ?? channelId,
    existingLocalizations: video.localizations ?? {},
    existingCodes: Object.keys(video.localizations ?? {}),
    channelSettings,
  };
}
