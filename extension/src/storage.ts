import { DEFAULT_SETTINGS, type AppSettings, type JobLogEntry } from '@shared/types';

const SETTINGS_KEY = 'settings';
const JOBS_KEY = 'jobLogs';
const TOKEN_KEY = 'accessToken';
const TOKEN_EXP_KEY = 'accessTokenExpiresAt';
const ACCOUNT_KEY = 'accountEmail';
const GEMINI_AUTO_MODEL_KEY = 'geminiAutoModel';

export async function getSettings(): Promise<AppSettings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] as Partial<AppSettings> | undefined) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function patchSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await saveSettings(next);
  return next;
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
  await chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXP_KEY, ACCOUNT_KEY]);
}

export async function getAccountEmail(): Promise<string | null> {
  const data = await chrome.storage.local.get(ACCOUNT_KEY);
  return (data[ACCOUNT_KEY] as string | undefined) ?? null;
}

export async function setAccountEmail(email: string): Promise<void> {
  await chrome.storage.local.set({ [ACCOUNT_KEY]: email });
}

export async function appendJobLog(entry: JobLogEntry): Promise<void> {
  const data = await chrome.storage.local.get(JOBS_KEY);
  const jobs = (data[JOBS_KEY] as JobLogEntry[] | undefined) ?? [];
  jobs.unshift(entry);
  await chrome.storage.local.set({ [JOBS_KEY]: jobs.slice(0, 50) });
}

export async function getGeminiAutoModel(): Promise<string | undefined> {
  const data = await chrome.storage.local.get(GEMINI_AUTO_MODEL_KEY);
  const v = data[GEMINI_AUTO_MODEL_KEY] as string | undefined;
  return v?.trim() || undefined;
}

export async function setGeminiAutoModel(model: string): Promise<void> {
  await chrome.storage.local.set({ [GEMINI_AUTO_MODEL_KEY]: model });
}
