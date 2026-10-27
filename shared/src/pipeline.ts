import {
  deeplSupports,
  GEMINI_FALLBACK_MODEL,
  listGeminiModels,
  normalizeGeminiModelId,
  preflightEngine,
  translateTitleDescription,
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
  anySlotLeft,
  buildEngineConfig,
  buildFallbackSlots,
  buildGeminiModelFallbackList,
  configForSlot,
  deeplUnsupportedFallbackNote,
  slotUsable,
  type FallbackSlot,
  type GeminiHooks,
  type JobSettings,
} from './pipeline/fallback.js';
import { markGeminiDone, throttleGemini } from './pipeline/throttle.js';
import {
  earliestResetMs,
  isExhausted,
  markExhausted,
  pruneExhaustion,
  quotaStopSummary,
  type ExhaustionMap,
} from './quota.js';
import { needsTitleReview } from './review.js';
import type { EngineId, LocalizationResult, TranslateOptions } from './types.js';

export {
  buildFallbackSlots,
  buildGeminiModelFallbackList,
  deeplUnsupportedFallbackNote,
  type FallbackSlot,
  type JobSettings,
} from './pipeline/fallback.js';

export type LangStatus = 'pending' | 'running' | 'ok' | 'failed' | 'needs_review';

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
  /** Present when status is ok / needs_review (must persist immediately). */
  title?: string;
  description?: string;
  fullTitle?: string;
  autoTitle?: string;
  shortened?: boolean;
  removed?: LocalizationResult['removed'];
  /** True when result came from the translation cache. */
  cached?: boolean;
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

export async function translateAllLanguages(
  title: string,
  description: string,
  languages: string[],
  settings: JobSettings,
  onProgress?: ProgressCb,
  opts?: GeminiHooks & {
    signal?: AbortSignal;
    /** When set, aborted on fatal/circuit so in-flight fetches die. */
    abort?: AbortController;
    /** Skip preflight (tests). Default runs preflight. */
    skipPreflight?: boolean;
    /** Override listed Gemini models (tests). */
    geminiModelList?: string[];
    nowMs?: number;
    /** Reuse a cached translation when source hash matches (avoids API call). */
    lookupCache?: (language: string) => LocalizationResult | null | Promise<LocalizationResult | null>;
    /** Called after each successful language (live or cached) for durable persist. */
    onLanguageOk?: (
      result: LocalizationResult,
      meta: { cached: boolean },
    ) => void | Promise<void>;
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

  /** Job never started (no engine / preflight failed): report once, nothing translated. */
  const failBeforeStart = (
    face: { summary: string; hint: string },
    extra: { engine?: EngineId; error?: string; errorDetail?: string; model?: string },
  ): TranslateJobResult => {
    onProgress?.({
      language: '',
      index: 0,
      total: languages.length,
      status: 'failed',
      stopReason: 'fatal',
      fatalSummary: face.summary,
      fatalHint: face.hint,
      ...extra,
    });
    return {
      ok: [],
      failed: [],
      stopReason: 'fatal',
      fatalSummary: face.summary,
      fatalHint: face.hint,
      pending: [...languages],
    };
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
    const summary = 'No translation engine available';
    return failBeforeStart(
      {
        summary,
        hint: 'Add a Gemini or DeepL API key, or configure LibreTranslate in Options.',
      },
      { error: summary, engine: settings.engine },
    );
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
        return failBeforeStart(face, {
          error: face.summary,
          errorDetail: err instanceof Error ? err.message : String(err),
          model: resolvedModel,
          engine: slot.engine,
        });
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
      return failBeforeStart(face, { engine: lastPreflightSlot?.engine ?? primaryEngine });
    }
  }

  const options: TranslateOptions = {
    protectedTerms: settings.protectedTerms,
    hashtagMode: settings.hashtagMode,
    chapterMode: settings.chapterMode,
    titleOver100: settings.titleOver100,
    protectLastSegment: settings.protectLastSegment !== false,
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

    // Cache hit — no API call
    const cached = opts?.lookupCache ? await opts.lookupCache(language) : null;
    if (cached) {
      ok.push(cached);
      breaker.recordSuccess();
      const cacheStatus: LangStatus = needsTitleReview(cached) ? 'needs_review' : 'ok';
      onProgress?.({
        language,
        index: i,
        total,
        status: cacheStatus,
        title: cached.title,
        description: cached.description,
        fullTitle: cached.fullTitle,
        autoTitle: cached.autoTitle ?? cached.title,
        shortened: cached.shortened,
        removed: cached.removed,
        cached: true,
        note: 'cached',
        model: resolvedModel,
        engine: activeEngine,
      });
      await opts?.onLanguageOk?.(cached, { cached: true });
      continue;
    }

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
        const loc: LocalizationResult = {
          language,
          title: result.title,
          description: result.description,
          fullTitle: result.fullTitle,
          autoTitle: result.autoTitle ?? result.title,
          shortened: result.shortened,
          removed: result.removed,
          reviewed: result.reviewed,
        };
        ok.push(loc);
        breaker.recordSuccess();
        const langStatus: LangStatus = needsTitleReview(loc) ? 'needs_review' : 'ok';
        onProgress?.({
          language,
          index: i,
          total,
          status: langStatus,
          title: loc.title,
          description: loc.description,
          fullTitle: loc.fullTitle,
          autoTitle: loc.autoTitle,
          shortened: loc.shortened,
          removed: loc.removed,
          model: usedModel ?? resolvedModel,
          engine: slot.engine,
          note,
        });
        await opts?.onLanguageOk?.(loc, { cached: false });
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
