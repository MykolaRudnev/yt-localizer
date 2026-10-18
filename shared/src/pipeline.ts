import { preflightEngine, translateTitleDescription } from './engines/index.js';
import {
  CircuitBreaker,
  classifyError,
  isAbortError,
  userFacingError,
  type JobStopReason,
} from './errors.js';
import type {
  AppSettings,
  EngineConfig,
  LocalizationResult,
  TranslateOptions,
} from './types.js';

export type LangStatus = 'pending' | 'running' | 'ok' | 'failed';

export type ProgressCb = (info: {
  language: string;
  index: number;
  total: number;
  status: LangStatus;
  error?: string;
  errorDetail?: string;
  stopReason?: JobStopReason;
  fatalSummary?: string;
  fatalHint?: string;
}) => void;

export type TranslateJobResult = {
  ok: LocalizationResult[];
  failed: { language: string; error: string }[];
  stopReason: JobStopReason;
  fatalSummary?: string;
  fatalHint?: string;
  /** Languages never attempted (pending when job stopped). */
  pending: string[];
};

function buildEngineConfig(
  settings: Pick<
    AppSettings,
    | 'engine'
    | 'geminiApiKey'
    | 'geminiModel'
    | 'deeplApiKey'
    | 'libreTranslateUrl'
    | 'libreTranslateApiKey'
  > & { geminiAutoModel?: string },
  onGeminiModelResolved?: (model: string) => void | Promise<void>,
): EngineConfig {
  return {
    engine: settings.engine,
    geminiApiKey: settings.geminiApiKey,
    geminiModel: settings.geminiModel,
    geminiAutoModel: settings.geminiAutoModel,
    deeplApiKey: settings.deeplApiKey,
    libreTranslateUrl: settings.libreTranslateUrl,
    libreTranslateApiKey: settings.libreTranslateApiKey,
    onGeminiModelResolved,
  };
}

export async function translateAllLanguages(
  title: string,
  description: string,
  languages: string[],
  settings: Pick<
    AppSettings,
    | 'engine'
    | 'geminiApiKey'
    | 'geminiModel'
    | 'deeplApiKey'
    | 'libreTranslateUrl'
    | 'libreTranslateApiKey'
    | 'titleOver100'
    | 'hashtagMode'
    | 'chapterMode'
    | 'protectedTerms'
    | 'defaultSourceLanguage'
  > & { geminiAutoModel?: string },
  onProgress?: ProgressCb,
  opts?: {
    signal?: AbortSignal;
    /** When set, aborted on fatal/circuit so in-flight fetches die. */
    abort?: AbortController;
    onGeminiModelResolved?: (model: string) => void | Promise<void>;
    /** Skip preflight (tests). Default runs preflight. */
    skipPreflight?: boolean;
  },
): Promise<TranslateJobResult> {
  const signal = opts?.signal ?? opts?.abort?.signal;
  const config = buildEngineConfig(settings, async (model) => {
    config.geminiAutoModel = model;
    await opts?.onGeminiModelResolved?.(model);
  });

  const abortJob = () => {
    try {
      opts?.abort?.abort();
    } catch {
      // ignore
    }
  };

  if (!opts?.skipPreflight) {
    try {
      await preflightEngine(config, signal);
    } catch (err) {
      if (isAbortError(err)) {
        return {
          ok: [],
          failed: [],
          stopReason: 'aborted',
          pending: [...languages],
        };
      }
      const face = userFacingError(err);
      const detail = err instanceof Error ? err.message : String(err);
      onProgress?.({
        language: '',
        index: 0,
        total: languages.length,
        status: 'failed',
        error: face.summary,
        errorDetail: detail,
        stopReason: 'fatal',
        fatalSummary: face.summary,
        fatalHint: face.hint,
      });
      return {
        ok: [],
        failed: [],
        stopReason: 'fatal',
        fatalSummary: face.summary,
        fatalHint: face.hint,
        pending: [...languages],
      };
    }
  }

  const options: TranslateOptions = {
    protectedTerms: settings.protectedTerms,
    hashtagMode: settings.hashtagMode,
    chapterMode: settings.chapterMode,
    titleOver100: settings.titleOver100,
    signal,
  };

  const ok: LocalizationResult[] = [];
  const failed: { language: string; error: string }[] = [];
  const source = settings.defaultSourceLanguage || 'en';
  const total = languages.length;
  const breaker = new CircuitBreaker(3);
  let stopReason: JobStopReason = null;
  let fatalSummary: string | undefined;
  let fatalHint: string | undefined;
  let stopIndex = languages.length;

  for (let i = 0; i < languages.length; i++) {
    if (signal?.aborted) {
      stopReason = 'aborted';
      stopIndex = i;
      break;
    }

    const language = languages[i];
    onProgress?.({ language, index: i, total, status: 'running' });
    try {
      const result = await translateTitleDescription(
        title,
        description,
        language,
        source,
        config,
        options,
        settings.geminiApiKey,
      );
      ok.push({ language, title: result.title, description: result.description });
      breaker.recordSuccess();
      onProgress?.({ language, index: i, total, status: 'ok' });
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) {
        stopReason = 'aborted';
        stopIndex = i;
        break;
      }

      const detail = err instanceof Error ? err.message : String(err);
      const face = userFacingError(err);
      const kind = classifyError(err);
      failed.push({ language, error: face.summary });
      onProgress?.({
        language,
        index: i,
        total,
        status: 'failed',
        error: face.summary,
        errorDetail: detail,
      });

      if (kind === 'fatal') {
        stopReason = 'fatal';
        fatalSummary = face.summary;
        fatalHint = face.hint;
        stopIndex = i + 1;
        abortJob();
        break;
      }

      if (breaker.recordFailure()) {
        stopReason = 'circuit';
        fatalSummary = `Stopped after ${breaker.consecutiveFailures} languages failed in a row`;
        fatalHint = 'Fix the issue (API key / model / rate limits), then Retry failed.';
        stopIndex = i + 1;
        abortJob();
        break;
      }
    }
  }

  const pending = languages.slice(stopIndex);
  if (stopReason && pending.length) {
    onProgress?.({
      language: '',
      index: stopIndex,
      total,
      status: 'pending',
      stopReason,
      fatalSummary,
      fatalHint,
    });
  }

  return {
    ok,
    failed,
    stopReason,
    fatalSummary,
    fatalHint,
    pending,
  };
}
