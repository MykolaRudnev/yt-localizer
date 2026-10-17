import { mergeLocalizations } from './langs.js';
import type { YoutubeVideo } from './types.js';

const YT = 'https://www.googleapis.com/youtube/v3';

export async function youtubeFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${YT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export async function listVideo(
  videoId: string,
  accessToken: string,
): Promise<YoutubeVideo> {
  const data = await youtubeFetch<{ items: YoutubeVideo[] }>(
    `/videos?part=snippet,localizations&id=${encodeURIComponent(videoId)}`,
    accessToken,
  );
  const item = data.items?.[0];
  if (!item) throw new Error(`Video not found: ${videoId}`);
  return item;
}

export async function ensureDefaultLanguage(
  video: YoutubeVideo,
  accessToken: string,
  defaultLang: string,
): Promise<YoutubeVideo> {
  if (video.snippet.defaultLanguage) return video;

  const snippet = {
    ...video.snippet,
    defaultLanguage: defaultLang,
  };
  // Keep required fields for update
  await youtubeFetch(`/videos?part=snippet`, accessToken, {
    method: 'PUT',
    body: JSON.stringify({
      id: video.id,
      snippet: {
        title: snippet.title,
        description: snippet.description,
        categoryId: snippet.categoryId,
        tags: snippet.tags,
        defaultLanguage: defaultLang,
        defaultAudioLanguage: snippet.defaultAudioLanguage,
      },
    }),
  });
  return listVideo(video.id, accessToken);
}

export async function updateLocalizations(
  video: YoutubeVideo,
  accessToken: string,
  newLocalizations: Record<string, { title: string; description: string }>,
): Promise<void> {
  const merged = mergeLocalizations(video.localizations, newLocalizations);
  const sn = video.snippet;
  await youtubeFetch(`/videos?part=snippet,localizations`, accessToken, {
    method: 'PUT',
    body: JSON.stringify({
      id: video.id,
      snippet: {
        title: sn.title,
        description: sn.description,
        categoryId: sn.categoryId,
        tags: sn.tags,
        defaultLanguage: sn.defaultLanguage,
        defaultAudioLanguage: sn.defaultAudioLanguage,
      },
      localizations: merged,
    }),
  });
}
