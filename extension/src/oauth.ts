import { clearAccessToken, getAccessToken, getSettings, setAccessToken } from './storage';

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

export async function getValidAccessToken(): Promise<string> {
  const existing = await getAccessToken();
  if (existing) return existing;
  return launchOAuth();
}

export async function launchOAuth(): Promise<string> {
  const settings = await getSettings();
  if (!settings.oauthClientId.trim()) {
    throw new Error('Set OAuth Client ID in VeilTranslate options first.');
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: settings.oauthClientId.trim(),
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: SCOPE,
    prompt: 'consent',
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!responseUrl) {
    await clearAccessToken();
    throw new Error('OAuth cancelled or failed');
  }

  const hash = new URL(responseUrl).hash.replace(/^#/, '');
  const result = new URLSearchParams(hash);
  const token = result.get('access_token');
  const expiresIn = Number(result.get('expires_in') ?? '3600');
  if (!token) {
    throw new Error('No access_token in OAuth response');
  }
  await setAccessToken(token, expiresIn);
  return token;
}
