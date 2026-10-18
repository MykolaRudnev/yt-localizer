#!/usr/bin/env node
/**
 * yt-localizer <videoId> --langs es,de,pl --engine gemini --dry-run
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { translateAllLanguages } from '../../shared/src/pipeline.js';
import {
  ensureDefaultLanguage,
  listVideo,
  updateLocalizations,
} from '../../shared/src/youtube.js';
import type { EngineId, LocalizationResult } from '../../shared/src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRETS = resolve(__dirname, '../../../.cli-secrets.json');

type Secrets = {
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

function loadSecrets(): Secrets {
  if (!existsSync(SECRETS)) return {};
  return JSON.parse(readFileSync(SECRETS, 'utf8')) as Secrets;
}

function saveSecrets(s: Secrets) {
  mkdirSync(dirname(SECRETS), { recursive: true });
  writeFileSync(SECRETS, JSON.stringify(s, null, 2), 'utf8');
}

function parseArgs(argv: string[]) {
  const videoId = argv[2];
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const langs = (get('--langs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const engine = (get('--engine') ?? 'gemini') as EngineId;
  const dryRun = argv.includes('--dry-run') || !argv.includes('--publish');
  return { videoId, langs, engine, dryRun };
}

async function getAccessToken(secrets: Secrets): Promise<string> {
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

async function main() {
  const { videoId, langs, engine, dryRun } = parseArgs(process.argv);
  if (!videoId || !langs.length) {
    console.log(`Usage: yt-localizer <videoId> --langs es,de,pl [--engine gemini|deepl|libretranslate] [--dry-run|--publish]`);
    process.exit(1);
  }

  const secrets = loadSecrets();
  const token = await getAccessToken(secrets);
  let video = await listVideo(videoId, token);
  if (!video.snippet.defaultLanguage) {
    if (dryRun) {
      video = {
        ...video,
        snippet: { ...video.snippet, defaultLanguage: 'en' },
      };
      console.log('Dry-run: would set defaultLanguage=en');
    } else {
      video = await ensureDefaultLanguage(video, token, 'en');
    }
  }

  const { ok, failed } = await translateAllLanguages(
    video.snippet.title,
    video.snippet.description,
    langs,
    {
      engine,
      geminiApiKey: secrets.geminiApiKey ?? '',
      geminiModel: secrets.geminiModel ?? '',
      deeplApiKey: secrets.deeplApiKey ?? '',
      libreTranslateUrl: secrets.libreTranslateUrl ?? 'http://localhost:5000',
      libreTranslateApiKey: '',
      titleOver100: 'truncate',
      protectLastSegment: true,
      hashtagMode: 'keep',
      chapterMode: 'translate_labels',
      protectedTerms: [],
      defaultSourceLanguage: video.snippet.defaultLanguage || 'en',
    },
    (p) => console.log(`[${p.index + 1}/${p.total}] ${p.language}: ${p.status}${p.error ? ' ' + p.error : ''}`),
  );

  console.log('\nResults:');
  for (const r of ok) {
    console.log(`--- ${r.language} ---`);
    console.log(r.title);
    console.log(r.description.slice(0, 200) + (r.description.length > 200 ? '…' : ''));
  }
  if (failed.length) console.log('Failed:', failed);

  if (dryRun) {
    console.log('\nDry-run: not publishing. Pass --publish to write localizations.');
    return;
  }

  const map: Record<string, { title: string; description: string }> = {};
  for (const r of ok as LocalizationResult[]) {
    map[r.language] = { title: r.title, description: r.description };
  }
  const fresh = await listVideo(videoId, token);
  await updateLocalizations(fresh, token, map);
  console.log('Published:', Object.keys(map).join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
