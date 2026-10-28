/**
 * Fake `chrome` APIs + demo data for the screenshot harness (scripts/screenshots.mjs).
 * The real views, popup and options run against this — fake data only, no network.
 * Import first: it must install `globalThis.chrome` before any UI module runs.
 */
import { reduceJob, type JobAction, type TranslateJob } from '@shared/job';
import { normalizeAppSettings } from '@shared/settings';
import type { ChannelSettings } from '@shared/types';

export const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';

const SOURCE_TITLE = 'The Longest Night of Autumn | Medieval Fantasy Tavern Music | Cozy Halloween Ambience';
const LANGS = ['de', 'fr', 'es', 'it', 'pt-BR', 'ja', 'ko', 'pl', 'tr', 'uk', 'ru', 'hi'];

export const demoSettings = normalizeAppSettings({
  engine: 'gemini',
  geminiApiKey: 'demo-key',
  oauthClientId: 'demo.apps.googleusercontent.com',
  dryRun: false,
  skipExisting: true,
  autoApproveReview: false,
  selectedLanguages: LANGS,
});

const demoChannelSettings: ChannelSettings = {
  selectedLanguages: LANGS,
  lastUsedLanguages: LANGS,
  protectedTerms: ['Hunter’s Path Ambience', 'Focus & Sleep'],
  defaultSourceLanguage: 'en',
  autoPublish: false,
};

const channels = [
  { id: 'UC_demo_main', title: 'Hunter’s Path Ambience', thumbnailUrl: '', email: 'creator@example.com', hasToken: true },
  { id: 'UC_demo_second', title: 'Cozy Rain Studio', thumbnailUrl: '', email: 'brand@example.com', hasToken: true },
];

const TITLES: Record<string, string> = {
  de: 'Die längste Herbstnacht | Mittelalterliche Taverne | Gemütliche Halloween-Atmosphäre',
  fr: 'La plus longue nuit d’automne | Taverne médiévale | Ambiance d’Halloween',
  es: 'La noche más larga del otoño | Taberna medieval | Ambiente acogedor de Halloween',
  it: 'La notte più lunga d’autunno | Taverna medievale | Atmosfera di Halloween',
  'pt-BR': 'A noite mais longa do outono | Taverna medieval | Clima aconchegante de Halloween',
  ja: '秋の最も長い夜 | 中世ファンタジー酒場の音楽 | ハロウィンの雰囲気',
  ko: '가을의 가장 긴 밤 | 중세 판타지 선술집 음악 | 아늑한 할로윈 분위기',
  pl: 'Najdłuższa noc jesieni | Średniowieczna karczma | Przytulny klimat Halloween',
  tr: 'Sonbaharın En Uzun Gecesi | Ortaçağ Meyhane Müziği | Cadılar Bayramı',
  uk: 'Найдовша ніч осені | Середньовічна таверна | Затишна атмосфера Гелловіну',
};
const LONG_FULL: Record<string, string> = {
  ru: 'Самая долгая ночь осени | Средневековая фэнтези-музыка таверны | Уютная атмосфера Хэллоуина у камина',
  hi: 'शरद ऋतु की सबसे लंबी रात | मध्यकालीन फंतासी सराय संगीत | आरामदायक हैलोवीन माहौल और अलाव',
};
const LONG_FIT: Record<string, string> = {
  ru: 'Самая долгая ночь осени | Средневековая музыка таверны | Уютная атмосфера Хэллоуина',
  hi: 'शरद ऋतु की सबसे लंबी रात | सराय संगीत | आरामदायक हैलोवीन माहौल',
};
const DESC = 'Pull up a chair by the hearth — three hours of tavern music for reading, studying and sleep.';

/** Demo job: 'running' (progress view / widget) or 'done' (review table). */
export function demoJob(phase: 'running' | 'done'): TranslateJob {
  let job = reduceJob(null, {
    type: 'create',
    id: `demo-${phase}`,
    videoId: DEMO_VIDEO_ID,
    channelId: 'UC_demo_main',
    languages: LANGS,
    dryRun: false,
    skipExisting: true,
    autoPublish: false,
    autoApprove: false,
    sourceTitle: SOURCE_TITLE,
    sourceDescription: DESC,
    engine: 'gemini',
  } as JobAction)!;
  // Started 90 s ago so the progress view shows a realistic ETA.
  job = { ...job, startedAt: Date.now() - 90_000 };
  const step = (a: Record<string, unknown>) => {
    job = reduceJob(job, { type: 'progress', engine: 'gemini', model: 'gemini-2.5-flash', ...a } as JobAction)!;
  };
  const doneCount = phase === 'running' ? 7 : LANGS.length;
  LANGS.forEach((language, i) => {
    if (i >= doneCount) {
      if (i === doneCount) step({ language, status: 'running' });
      return;
    }
    if (LONG_FULL[language]) {
      step({
        language, status: 'needs_review', title: LONG_FIT[language], autoTitle: LONG_FIT[language],
        fullTitle: LONG_FULL[language], shortened: true, description: DESC,
      });
      return;
    }
    step({
      language, status: 'ok', title: TITLES[language], description: DESC, cached: language === 'it',
      ...(language === 'pl' && phase === 'running'
        ? { status: 'failed', error: 'Gemini 503: model overloaded', errorDetail: '503 UNAVAILABLE — retry later' }
        : {}),
    });
  });
  if (phase === 'done') {
    job = reduceJob(job, { type: 'finish', phase: 'done', results: [], failed: [] } as JobAction)!;
  }
  return job;
}

let currentJob: TranslateJob | null = demoJob('running');
export function setDemoJob(job: TranslateJob | null): void {
  currentJob = job;
}

function reply(msg: { type: string; [k: string]: unknown }): unknown {
  switch (msg.type) {
    case 'GET_SETTINGS':
    case 'PATCH_SETTINGS':
      return { ok: true, settings: demoSettings };
    case 'GET_AUTH_STATE':
      return { ok: true, loggedIn: true, channels, activeChannelId: channels[0].id };
    case 'GET_CHANNEL_SETTINGS':
    case 'PATCH_CHANNEL_SETTINGS':
      return { ok: true, settings: demoChannelSettings };
    case 'GET_JOB':
      return { ok: true, job: currentJob };
    case 'FETCH_VIDEO_META':
      return {
        ok: true, title: SOURCE_TITLE, defaultLanguage: 'en', channelId: 'UC_demo_main',
        existingCodes: ['de', 'fr'], channelSettings: demoChannelSettings,
      };
    case 'GET_TRANSLATION_CACHE_STATS':
      return { ok: true, videos: 14, entries: 812 };
    case 'GET_WIDGET_POS':
      return { ok: true, pos: null };
    case 'GET_AUTO_PUBLISH_ACK':
      return { ok: true, acked: true };
    default:
      return { ok: true };
  }
}

const noopEvent = { addListener() {}, removeListener() {} };

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    id: 'demo',
    lastError: undefined,
    sendMessage: async (msg: { type: string }) => reply(msg),
    connect: () => ({ onMessage: noopEvent, onDisconnect: noopEvent, postMessage() {}, disconnect() {} }),
    getURL: (p: string) => p,
    onMessage: noopEvent,
  },
  storage: {
    local: { get: async () => ({ settings: demoSettings }), set: async () => {}, remove: async () => {} },
  },
  identity: { getRedirectURL: () => 'https://<extension-id>.chromiumapp.org/' },
  // Popup probes the active tab: report a Studio tab with the content script alive.
  tabs: {
    query: async () => [{ id: 1, url: `https://studio.youtube.com/video/${DEMO_VIDEO_ID}/edit` }],
    sendMessage: async () => ({ ok: true }),
    create: async () => ({}),
  },
  scripting: { executeScript: async () => [], insertCSS: async () => {} },
};
