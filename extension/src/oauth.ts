import { isAccessTokenFresh, publicChannelView } from '@shared/channels';
import type { ConnectedChannel } from '@shared/types';
import { listMineChannel } from '@shared/youtube';
import {
  ensureChannelSettingsSeeded,
  getActiveChannelId,
  getChannel,
  getChannels,
  getSettings,
  removeChannel,
  setActiveChannelId,
  upsertChannel,
} from './storage';

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

export type OAuthLaunchOpts = {
  /** Prefer this Google account (silent refresh / reconnect). */
  loginHint?: string;
  /** Force account picker (Add channel). */
  selectAccount?: boolean;
  interactive?: boolean;
};

type TokenResult = {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
};

async function parseTokenResponse(responseUrl: string): Promise<TokenResult> {
  const url = new URL(responseUrl);
  const hash = url.hash.replace(/^#/, '');
  const query = url.search.replace(/^\?/, '');
  const result = new URLSearchParams(hash || query);
  const token = result.get('access_token');
  const expiresIn = Number(result.get('expires_in') ?? '3600');
  const refreshToken = result.get('refresh_token') ?? undefined;
  if (!token) {
    const err = result.get('error_description') || result.get('error') || 'No access_token';
    throw new Error(err);
  }
  return { accessToken: token, expiresIn, refreshToken };
}

async function launchWebAuth(opts: OAuthLaunchOpts): Promise<TokenResult> {
  const settings = await getSettings();
  if (!settings.oauthClientId.trim()) {
    throw new Error('Set OAuth Client ID in YT Localizer options first.');
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: settings.oauthClientId.trim(),
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: SCOPE,
  });

  if (opts.selectAccount || opts.interactive !== false) {
    params.set('prompt', 'select_account consent');
  } else {
    params.set('prompt', 'none');
  }
  if (opts.loginHint) params.set('login_hint', opts.loginHint);

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const interactive = opts.interactive !== false;
  const responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive });
  if (!responseUrl) throw new Error('OAuth cancelled or failed');
  return parseTokenResponse(responseUrl);
}

async function fetchAccountEmail(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

async function refreshWithStoredRefreshToken(
  channel: ConnectedChannel,
): Promise<TokenResult | null> {
  if (!channel.refreshToken) return null;
  const settings = await getSettings();
  const clientId = settings.oauthClientId.trim();
  if (!clientId) return null;
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: channel.refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      refreshToken: data.refresh_token ?? channel.refreshToken,
    };
  } catch {
    return null;
  }
}

/** Interactive login — always account picker so another Google/Brand account can be added. */
export async function launchOAuth(opts: OAuthLaunchOpts = {}): Promise<ConnectedChannel> {
  const tokens = await launchWebAuth({
    selectAccount: opts.selectAccount !== false,
    interactive: true,
    loginHint: opts.loginHint,
  });
  return persistConnectedChannel(tokens);
}

async function persistConnectedChannel(tokens: TokenResult): Promise<ConnectedChannel> {
  const [mine, email] = await Promise.all([
    listMineChannel(tokens.accessToken),
    fetchAccountEmail(tokens.accessToken),
  ]);
  const channel: ConnectedChannel = {
    id: mine.id,
    title: mine.title,
    thumbnailUrl: mine.thumbnailUrl,
    email,
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    refreshToken: tokens.refreshToken,
  };
  await upsertChannel(channel);
  await ensureChannelSettingsSeeded(channel.id, channel.title);
  return channel;
}

/** Access token for a specific channel; silent re-auth when expired. */
export async function getValidAccessToken(channelId: string): Promise<string> {
  let channel = await getChannel(channelId);
  if (!channel) {
    throw new Error(`Channel ${channelId} is not connected. Add it in the YT Localizer popup.`);
  }

  if (isAccessTokenFresh(channel)) return channel.accessToken;

  const refreshed = await refreshWithStoredRefreshToken(channel);
  if (refreshed) {
    channel = {
      ...channel,
      accessToken: refreshed.accessToken,
      expiresAt: Date.now() + refreshed.expiresIn * 1000,
      refreshToken: refreshed.refreshToken ?? channel.refreshToken,
    };
    await upsertChannel(channel);
    return channel.accessToken;
  }

  // Implicit-flow fallback: silent prompt=none, then interactive.
  try {
    const silent = await launchWebAuth({
      interactive: false,
      loginHint: channel.email ?? undefined,
      selectAccount: false,
    });
    const updated = await persistConnectedChannel(silent);
    if (updated.id !== channelId) {
      // Signed into a different account than expected — keep both, fail this lookup.
      throw new Error(
        `Silent re-auth returned channel ${updated.title}, expected ${channel.title}.`,
      );
    }
    return updated.accessToken;
  } catch {
    const interactive = await launchWebAuth({
      interactive: true,
      loginHint: channel.email ?? undefined,
      selectAccount: true,
    });
    const updated = await persistConnectedChannel(interactive);
    if (updated.id !== channelId) {
      throw new Error(
        `Signed in as ${updated.title}, but this video needs ${channel.title}. Connect the correct account.`,
      );
    }
    return updated.accessToken;
  }
}

export async function getAuthState(): Promise<{
  loggedIn: boolean;
  channels: ReturnType<typeof publicChannelView>[];
  activeChannelId: string | null;
}> {
  const channels = await getChannels();
  const list = Object.values(channels).map(publicChannelView);
  const activeChannelId = (await getActiveChannelId()) ?? list[0]?.id ?? null;
  return {
    loggedIn: list.length > 0,
    channels: list,
    activeChannelId,
  };
}

export async function logout(channelId?: string): Promise<void> {
  if (channelId) {
    await removeChannel(channelId);
    return;
  }
  const channels = await getChannels();
  for (const id of Object.keys(channels)) {
    await removeChannel(id);
  }
  await setActiveChannelId(null);
}

export async function addChannel(): Promise<ConnectedChannel> {
  return launchOAuth({ selectAccount: true, interactive: true });
}
