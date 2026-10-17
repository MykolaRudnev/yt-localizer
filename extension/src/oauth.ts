import {
  clearAccessToken,
  getAccessToken,
  getAccountEmail,
  getSettings,
  setAccessToken,
  setAccountEmail,
} from './storage';

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
  await fetchAndStoreAccount(token);
  return token;
}

async function fetchAndStoreAccount(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    if (data.email) {
      await setAccountEmail(data.email);
      return data.email;
    }
  } catch {
    // optional — popup can still show "Signed in"
  }
  return null;
}

export async function getAuthState(): Promise<{
  loggedIn: boolean;
  email: string | null;
}> {
  const token = await getAccessToken();
  if (!token) return { loggedIn: false, email: null };
  let email = await getAccountEmail();
  if (!email) email = await fetchAndStoreAccount(token);
  return { loggedIn: true, email };
}

export async function logout(): Promise<void> {
  await clearAccessToken();
}
