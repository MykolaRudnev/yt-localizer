/** Safe Chrome extension messaging — never leave runtime.lastError unchecked. */

const STUDIO_ORIGIN = 'https://studio.youtube.com/';

export function isNoReceiverError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /Receiving end does not exist|Could not establish connection/i.test(msg);
}

/** chrome.runtime.sendMessage with try/catch; returns null if no receiver / SW asleep. */
export async function sendRuntimeMessage<T = unknown>(
  payload: Record<string, unknown>,
): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(payload)) as T;
  } catch (err) {
    if (isNoReceiverError(err)) return null;
    throw err;
  }
}

/** chrome.tabs.sendMessage with try/catch; returns null if content script missing. */
export async function sendTabMessage<T = unknown>(
  tabId: number,
  payload: Record<string, unknown>,
): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, payload)) as T;
  } catch (err) {
    if (isNoReceiverError(err)) return null;
    throw err;
  }
}

/**
 * Connect a port and acknowledge lastError on disconnect so Chrome never logs
 * "Unchecked runtime.lastError".
 */
export function connectRuntimePort(name: string): chrome.runtime.Port | null {
  try {
    const port = chrome.runtime.connect({ name });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
    });
    return port;
  } catch {
    void chrome.runtime.lastError;
    return null;
  }
}

export function isStudioUrl(url: string | undefined | null): boolean {
  return !!url && url.startsWith(STUDIO_ORIGIN);
}

export type StudioProbe =
  | { status: 'ok'; tabId: number }
  | { status: 'not-studio' }
  | { status: 'no-content'; tabId?: number };

/** Ping the content script on the active tab; optionally inject if Studio but silent. */
export async function probeStudioTab(opts?: {
  injectIfMissing?: boolean;
}): Promise<StudioProbe> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isStudioUrl(tab.url)) {
    return { status: 'not-studio' };
  }

  const ping = async () =>
    sendTabMessage<{ ok?: boolean }>(tab.id!, { type: 'VT_PING' });

  let res = await ping();
  if (res?.ok) return { status: 'ok', tabId: tab.id };

  if (opts?.injectIfMissing && chrome.scripting?.executeScript) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content.css'],
        });
      } catch {
        /* CSS may already be present */
      }
      res = await ping();
      if (res?.ok) return { status: 'ok', tabId: tab.id };
    } catch {
      void chrome.runtime.lastError;
    }
  }

  return { status: 'no-content', tabId: tab.id };
}
