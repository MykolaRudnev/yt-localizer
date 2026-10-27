import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Compiled to `cli/dist/cli/src` → repo root is four levels up. */
const REPO_ROOT = resolve(__dirname, '../../../..');
/** `.cli-secrets.json` at the repo root (documented location, gitignored). */
const ROOT_SECRETS = resolve(REPO_ROOT, '.cli-secrets.json');
/** Location used by v1.0–1.1 (`cli/.cli-secrets.json`) — still honoured if present. */
const LEGACY_SECRETS = resolve(REPO_ROOT, 'cli/.cli-secrets.json');

export const SECRETS =
  !existsSync(ROOT_SECRETS) && existsSync(LEGACY_SECRETS) ? LEGACY_SECRETS : ROOT_SECRETS;

export type Secrets = {
  geminiApiKey?: string;
  geminiModel?: string;
  deeplApiKey?: string;
  libreTranslateUrl?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

export function loadSecrets(): Secrets {
  if (!existsSync(SECRETS)) return {};
  return JSON.parse(readFileSync(SECRETS, 'utf8')) as Secrets;
}

export function saveSecrets(s: Secrets) {
  mkdirSync(dirname(SECRETS), { recursive: true });
  writeFileSync(SECRETS, JSON.stringify(s, null, 2), 'utf8');
}

export async function getAccessToken(secrets: Secrets): Promise<string> {
  if (secrets.accessToken && secrets.accessTokenExpiresAt && Date.now() < secrets.accessTokenExpiresAt - 60_000) {
    return secrets.accessToken;
  }
  if (secrets.refreshToken && secrets.oauthClientId && secrets.oauthClientSecret) {
    const body = new URLSearchParams({
      client_id: secrets.oauthClientId,
      client_secret: secrets.oauthClientSecret,
      refresh_token: secrets.refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    secrets.accessToken = data.access_token;
    secrets.accessTokenExpiresAt = Date.now() + data.expires_in * 1000;
    saveSecrets(secrets);
    return data.access_token;
  }
  return loopbackAuth(secrets);
}

async function loopbackAuth(secrets: Secrets): Promise<string> {
  if (!secrets.oauthClientId || !secrets.oauthClientSecret) {
    throw new Error(
      `Missing OAuth in ${SECRETS}. Add oauthClientId + oauthClientSecret (Desktop or Web client with http://127.0.0.1:7890/callback).`,
    );
  }
  const port = 7890;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', secrets.oauthClientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.force-ssl');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('Open this URL to authorize:\n', authUrl.toString());

  const code = await new Promise<string>((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (u.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const c = u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorized. You can close this tab.');
      server.close();
      if (c) resolvePromise(c);
      else reject(new Error('No code'));
    });
    server.listen(port, '127.0.0.1');
  });

  const body = new URLSearchParams({
    code,
    client_id: secrets.oauthClientId,
    client_secret: secrets.oauthClientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  secrets.accessToken = data.access_token;
  secrets.accessTokenExpiresAt = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) secrets.refreshToken = data.refresh_token;
  saveSecrets(secrets);
  return data.access_token;
}
