import { DEFAULT_SETTINGS, type AppSettings, type JobLogEntry } from '@shared/types';

const SETTINGS_KEY = 'settings';
const JOBS_KEY = 'jobLogs';
const TOKEN_KEY = 'accessToken';
const TOKEN_EXP_KEY = 'accessTokenExpiresAt';

export async function getSettings(): Promise<AppSettings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] as Partial<AppSettings> | undefined) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getAccessToken(): Promise<string | null> {
  const data = await chrome.storage.local.get([TOKEN_KEY, TOKEN_EXP_KEY]);
  const token = data[TOKEN_KEY] as string | undefined;
  const exp = data[TOKEN_EXP_KEY] as number | undefined;
  if (!token) return null;
  if (exp && Date.now() > exp - 60_000) return null;
  return token;
}

export async function setAccessToken(token: string, expiresInSec: number): Promise<void> {
  await chrome.storage.local.set({
    [TOKEN_KEY]: token,
    [TOKEN_EXP_KEY]: Date.now() + expiresInSec * 1000,
  });
}

export async function clearAccessToken(): Promise<void> {
  await chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXP_KEY]);
}

export async function appendJobLog(entry: JobLogEntry): Promise<void> {
  const data = await chrome.storage.local.get(JOBS_KEY);
  const jobs = (data[JOBS_KEY] as JobLogEntry[] | undefined) ?? [];
  jobs.unshift(entry);
  await chrome.storage.local.set({ [JOBS_KEY]: jobs.slice(0, 50) });
}
