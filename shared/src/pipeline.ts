import {
  deeplSupports,
  listGeminiModels,
  normalizeGeminiModelId,
  preflightEngine,
  rankEligibleChatModels,
  translateTitleDescription,
  GEMINI_FALLBACK_MODEL,
} from './engines/index.js';
import {
  CircuitBreaker,
  classifyError,
  isAbortError,
  isQuotaExhaustedError,
  userFacingError,
  type JobStopReason,
} from './errors.js';
import {
  earliestResetMs,
  isExhausted,
  markExhausted,
  pruneExhaustion,
  quotaStopSummary,
  type ExhaustionMap,
} from './quota.js';
import { trimSettingsKeys } from './settings.js';
import type {
  AppSettings,
  EngineConfig,
  EngineId,
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
  /** Resolved Gemini model id (shown in progress). */
  model?: string;
  /** Engine that handled / is handling this language. */
  engine?: EngineId;
  /** e.g. "DeepL doesn't support hi → Gemini" for per-language fallback. */
  note?: string;
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

type JobSettings = Pick<
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
> & {
  autoFallbackOnQuota?: boolean;
  geminiThrottleMs?: number;
  geminiAutoModel?: string;
  geminiJsonModeByModel?: Record<string, boolean>;
  geminiExhaustedModels?: ExhaustionMap;
};

export type FallbackSlot =
  | { engine: 'gemini'; model: string }
  | { engine: 'deepl' }
  | { engine: 'libretranslate' };

function engineDisplayName(id: EngineId): string {
  if (id === 'gemini') return 'Gemini';
  if (id === 'deepl') return 'DeepL';
  return 'LibreTranslate';
}

/** Note when DeepL is skipped for an unsupported target and another engine is used. */
export function deeplUnsupportedFallbackNote(
  language: string,
  usedEngine: EngineId,
): string {
  return `DeepL doesn't support ${language} → ${engineDisplayName(usedEngine)}`;
}

function buildEngineConfig(
  settings: JobSettings,
  hooks?: {
    onGeminiModelResolved?: (model: string) => void | Promise<void>;
    onGeminiJsonModeResolved?: (model: string, jsonMode: boolean) => void | Promise<void>;
    onGeminiModelExhausted?: (model: string, untilMs: number) => void | Promise<void>;
  },
): EngineConfig {
  const trimmed = trimSettingsKeys({
    geminiApiKey: settings.geminiApiKey,
    deeplApiKey: settings.deeplApiKey,
    libreTranslateUrl: settings.libreTranslateUrl,
    libreTranslateApiKey: settings.libreTranslateApiKey,
    geminiModel: settings.geminiModel,
  });
  return {
    engine: settings.engine,
    geminiApiKey: trimmed.geminiApiKey,
    geminiModel: trimmed.geminiModel,
    geminiAutoModel: settings.geminiAutoModel?.trim(),
    geminiJsonModeByModel: settings.geminiJsonModeByModel
      ? { ...settings.geminiJsonModeByModel }
      : undefined,
    geminiExhaustedModels: settings.geminiExhaustedModels
      ? { ...settings.geminiExhaustedModels }
      : undefined,
    deeplApiKey: trimmed.deeplApiKey,
    libreTranslateUrl: trimmed.libreTranslateUrl,
    libreTranslateApiKey: trimmed.libreTranslateApiKey,
    onGeminiModelResolved: hooks?.onGeminiModelResolved,
    onGeminiJsonModeResolved: hooks?.onGeminiJsonModeResolved,
    onGeminiModelExhausted: hooks?.onGeminiModelExhausted,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function throttleGemini(
  state: { lastAt: number },
  minMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (minMs <= 0) return;
  const wait = state.lastAt + minMs - Date.now();
  if (wait > 0) await sleep(wait, signal);
}

function markGeminiDone(state: { lastAt: number }) {
  state.lastAt = Date.now();
}

/**
 * Build Gemini model list for fallback: configured model first (if set), then ranked eligible.
 */
export function buildGeminiModelFallbackList(
  listed: string[],
  configured?: string,
  exhausted: ExhaustionMap = {},
  nowMs = Date.now(),
): string[] {
  const ranked = rankEligibleChatModels(listed);
  const pool = ranked.length ? ranked : [GEMINI_FALLBACK_MODEL];
  const trim = configured?.trim();
  let ordered = pool;
  if (trim && trim.toLowerCase() !== 'auto') {
    const id = normalizeGeminiModelId(trim);
    ordered = [id, ...pool.filter((m) => m !== id)];
  }
  return ordered.filter((m) => !isExhausted(exhausted, m, nowMs));
}

export function buildFallbackSlots(opts: {
  primary: EngineId;
  geminiModels: string[];
  hasDeepl: boolean;
  hasLibre: boolean;
  autoFallback: boolean;
}): FallbackSlot[] {
  const slots: FallbackSlot[] = [];
  const pushGemini = () => {
    for (const model of opts.geminiModels) slots.push({ engine: 'gemini', model });
  };
  const pushDeepl = () => {
    if (opts.hasDeepl) slots.push({ engine: 'deepl' });
  };
  const pushLibre = () => {
    if (opts.hasLibre) slots.push({ engine: 'libretranslate' });
  };

  if (!opts.autoFallback) {
    if (opts.primary === 'gemini') pushGemini();
    else if (opts.primary === 'deepl') pushDeepl();
    else pushLibre();
    return slots;
  }

  if (opts.primary === 'gemini') {
    pushGemini();
    pushDeepl();
    pushLibre();
  } else if (opts.primary === 'deepl') {
    pushDeepl();
    pushGemini();
    pushLibre();
  } else {
    pushLibre();
    pushGemini();
    pushDeepl();
  }
  return slots;
}

function configForSlot(base: EngineConfig, slot: FallbackSlot): EngineConfig {
  if (slot.engine === 'gemini') {
    return { ...base, engine: 'gemini', geminiModel: slot.model };
  }
  return { ...base, engine: slot.engine };
}

function slotUsable(
  slot: FallbackSlot,
  language: string,
  exhausted: ExhaustionMap,
  nowMs: number,
): boolean {
  if (slot.engine === 'gemini') return !isExhausted(exhausted, slot.model, nowMs);
  if (slot.engine === 'deepl') return deeplSupports(language);
  return true;
}

function anySlotLeft(
  slots: FallbackSlot[],
  exhausted: ExhaustionMap,
  nowMs: number,
): boolean {
  return slots.some((s) => {
    if (s.engine === 'gemini') return !isExhausted(exhausted, s.model, nowMs);
    return true; // deepl/libre may still help for some languages
  });
}

export async function translateAllLanguages(
  title: string,
  description: string,
  languages: string[],
  settings: JobSettings,
  onProgress?: ProgressCb,
  opts?: {
    signal?: AbortSignal;
    /** When set, aborted on fatal/circuit so in-flight fetches die. */
    abort?: AbortController;
    onGeminiModelResolved?: (model: string) => void | Promise<void>;
    onGeminiJsonModeResolved?: (model: string, jsonMode: boolean) => void | Promise<void>;
    onGeminiModelExhausted?: (model: string, untilMs: number) => void | Promise<void>;
    /** Skip preflight (tests). Default runs preflight. */
    skipPreflight?: boolean;
    /** Override listed Gemini models (tests). */
    geminiModelList?: string[];
    nowMs?: number;
  },
): Promise<TranslateJobResult> {
  const signal = opts?.signal ?? opts?.abort?.signal;
  const nowMs = opts?.nowMs ?? Date.now();
  const autoFallback = settings.autoFallbackOnQuota !== false;
  const throttleMs = settings.geminiThrottleMs ?? 4000;
  const throttleState = { lastAt: 0 };

  let exhausted: ExhaustionMap = pruneExhaustion(
    { ...(settings.geminiExhaustedModels ?? {}) },
    nowMs,
  );

  const config = buildEngineConfig(settings, {
    onGeminiModelResolved: async (model) => {
      config.geminiAutoModel = model;
      await opts?.onGeminiModelResolved?.(model);
    },
    onGeminiJsonModeResolved: async (model, jsonMode) => {
      if (!config.geminiJsonModeByModel) config.geminiJsonModeByModel = {};
      config.geminiJsonModeByModel[model] = jsonMode;
      await opts?.onGeminiJsonModeResolved?.(model, jsonMode);
    },
    onGeminiModelExhausted: async (model, untilMs) => {
      await opts?.onGeminiModelExhausted?.(model, untilMs);
    },
  });
  config.geminiExhaustedModels = { ...exhausted };

  const abortJob = () => {
    try {
      opts?.abort?.abort();
    } catch {
      // ignore
    }
  };

  const markModelExhausted = async (model: string) => {
    exhausted = markExhausted(exhausted, model, nowMs);
    config.geminiExhaustedModels = { ...exhausted };
    await config.onGeminiModelExhausted?.(model, exhausted[model]);
  };

  const hasGemini = Boolean(config.geminiApiKey?.trim());
  const hasDeepl = Boolean(config.deeplApiKey?.trim());
  const hasLibre = Boolean(config.libreTranslateUrl?.trim());

  let geminiModels: string[] = [];
  if (hasGemini && (settings.engine === 'gemini' || autoFallback)) {
    let listed = opts?.geminiModelList;
    if (!listed) {
      try {
        listed = await listGeminiModels(config.geminiApiKey!, signal);
      } catch {
        listed = settings.geminiAutoModel
          ? [settings.geminiAutoModel]
          : [GEMINI_FALLBACK_MODEL];
      }
    }
    // Include exhausted models in the chain; slotUsable skips them at runtime.
    geminiModels = buildGeminiModelFallbackList(
      listed,
      config.geminiModel,
      {},
      nowMs,
    );
    if (!geminiModels.length && settings.geminiAutoModel) {
      geminiModels = [normalizeGeminiModelId(settings.geminiAutoModel)];
    }
  }

  const slots = buildFallbackSlots({
    primary: settings.engine,
    geminiModels,
    hasDeepl,
    hasLibre,
    autoFallback,
  });

  if (!slots.length) {
    const face = {
      summary: 'No translation engine available',
      hint: 'Add a Gemini or DeepL API key, or configure LibreTranslate in Options.',
    };
    onProgress?.({
      language: '',
      index: 0,
      total: languages.length,
      status: 'failed',
      error: face.summary,
      stopReason: 'fatal',
      fatalSummary: face.summary,
      fatalHint: face.hint,
      engine: settings.engine,
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

  const firstGemini = slots.find(
    (s): s is { engine: 'gemini'; model: string } =>
      s.engine === 'gemini' && !isExhausted(exhausted, s.model, nowMs),
  );
  let resolvedModel = firstGemini?.model;
  /** Primary engine for the job (header); per-language may still fall back. */
  let activeEngine: EngineId = settings.engine;
  const primaryEngine = settings.engine;

  // Announce primary immediately so the progress header is never "empty"/Gemini by default.
  onProgress?.({
    language: '',
    index: 0,
    total: languages.length,
    status: 'running',
    model: resolvedModel,
    engine: primaryEngine,
  });

  if (!opts?.skipPreflight) {
    let preflightOk = false;
    let lastPreflightErr: unknown;
    let lastPreflightSlot: FallbackSlot | undefined;
    for (const slot of slots) {
      if (slot.engine === 'gemini' && isExhausted(exhausted, slot.model, nowMs)) continue;
      const slotConfig = configForSlot(config, slot);
      try {
        if (slot.engine === 'gemini') await throttleGemini(throttleState, throttleMs, signal);
        const pre = await preflightEngine(slotConfig, signal);
        if (slot.engine === 'gemini') markGeminiDone(throttleState);
        if (pre.model) resolvedModel = pre.model;
        else if (slot.engine === 'gemini') resolvedModel = slot.model;
        activeEngine = slot.engine;
        preflightOk = true;
        onProgress?.({
          language: '',
          index: 0,
          total: languages.length,
          status: 'running',
          model: resolvedModel,
          engine: activeEngine,
        });
        break;
      } catch (err) {
        if (isAbortError(err)) {
          return {
            ok: [],
            failed: [],
            stopReason: 'aborted',
            pending: [...languages],
          };
        }
        lastPreflightErr = err;
        lastPreflightSlot = slot;
        // Auto-fallback only for quota-exhausted — never hide auth/config errors.
        if (autoFallback && isQuotaExhaustedError(err)) {
          if (slot.engine === 'gemini') await markModelExhausted(slot.model);
          continue;
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
          model: resolvedModel,
          engine: slot.engine,
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
    if (!preflightOk) {
      const face = lastPreflightErr
        ? userFacingError(lastPreflightErr)
        : quotaStopSummary(
            0,
            languages.length,
            earliestResetMs(exhausted, nowMs),
            nowMs,
          );
      onProgress?.({
        language: '',
        index: 0,
        total: languages.length,
        status: 'failed',
        stopReason: 'fatal',
        fatalSummary: face.summary,
        fatalHint: face.hint,
        engine: lastPreflightSlot?.engine ?? primaryEngine,
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

    if (!anySlotLeft(slots, exhausted, nowMs)) {
      const remaining = languages.length - i;
      const face = quotaStopSummary(ok.length, remaining, earliestResetMs(exhausted, nowMs), nowMs);
      stopReason = 'fatal';
      fatalSummary = face.summary;
      fatalHint = face.hint;
      stopIndex = i;
      abortJob();
      break;
    }

    const language = languages[i];
    let langOk = false;
    let lastErr: unknown;
    let usedEngine: EngineId | undefined;
    let usedModel: string | undefined;
    let skippedDeeplUnsupported = false;

    for (const slot of slots) {
      if (!slotUsable(slot, language, exhausted, nowMs)) {
        if (slot.engine === 'deepl' && !deeplSupports(language)) {
          skippedDeeplUnsupported = true;
        }
        continue;
      }

      usedEngine = slot.engine;
      usedModel = slot.engine === 'gemini' ? slot.model : undefined;
      if (usedModel) resolvedModel = usedModel;

      const note =
        skippedDeeplUnsupported && slot.engine !== 'deepl'
          ? deeplUnsupportedFallbackNote(language, slot.engine)
          : undefined;

      onProgress?.({
        language,
        index: i,
        total,
        status: 'running',
        model: usedModel ?? resolvedModel,
        engine: slot.engine,
        note,
      });

      try {
        const slotConfig = configForSlot(config, slot);
        if (slot.engine === 'gemini') await throttleGemini(throttleState, throttleMs, signal);
        const result = await translateTitleDescription(
          title,
          description,
          language,
          source,
          slotConfig,
          options,
        );
        if (slot.engine === 'gemini') markGeminiDone(throttleState);
        if (config.geminiAutoModel) resolvedModel = config.geminiAutoModel;
        ok.push({ language, title: result.title, description: result.description });
        breaker.recordSuccess();
        onProgress?.({
          language,
          index: i,
          total,
          status: 'ok',
          model: usedModel ?? resolvedModel,
          engine: slot.engine,
          note,
        });
        langOk = true;
        break;
      } catch (err) {
        if (isAbortError(err) || signal?.aborted) {
          stopReason = 'aborted';
          stopIndex = i;
          lastErr = err;
          break;
        }
        lastErr = err;

        // Auto-fallback only for quota-exhausted (Gemini model or DeepL 456).
        if (autoFallback && isQuotaExhaustedError(err)) {
          if (slot.engine === 'gemini') await markModelExhausted(slot.model);
          continue;
        }
        break;
      }
    }

    if (stopReason === 'aborted') break;
    if (langOk) continue;

    // Nothing left that can serve remaining work
    if (
      autoFallback &&
      lastErr &&
      isQuotaExhaustedError(lastErr) &&
      !anySlotLeft(slots, exhausted, nowMs)
    ) {
      const remaining = languages.length - i;
      const face = quotaStopSummary(ok.length, remaining, earliestResetMs(exhausted, nowMs), nowMs);
      stopReason = 'fatal';
      fatalSummary = face.summary;
      fatalHint = face.hint;
      stopIndex = i;
      abortJob();
      break;
    }

    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'failed');
    const face = userFacingError(lastErr ?? new Error(detail));
    const kind = lastErr ? classifyError(lastErr) : 'fatal';
    failed.push({ language, error: face.summary });
    onProgress?.({
      language,
      index: i,
      total,
      status: 'failed',
      error: face.summary,
      errorDetail: detail,
      model: usedModel ?? resolvedModel,
      engine: usedEngine,
    });

    // Auth/config fatals stop the job; quota fatals already handled above when no slots left.
    if (kind === 'fatal' && !(autoFallback && isQuotaExhaustedError(lastErr))) {
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
