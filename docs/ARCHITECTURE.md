# Architecture

YT Localizer is three entry points over one shared core:

```
extension/  Chrome MV3 (service worker + Studio content script + popup + options)
cli/        Node CLI (same pipeline, no chrome.* APIs)
shared/     Pure TypeScript: engines, title fitting, pipeline, job state, cache
```

`shared/` never touches `chrome.*` or the DOM, so everything in it is unit-tested with Vitest and reused by the CLI. Shared imports use `.js` suffixes (NodeNext for the CLI build); the extension imports them through the `@shared/*` alias.

## shared/src

| Module | Responsibility |
|--------|----------------|
| `types.ts` | Domain types (`AppSettings`, `LocalizationResult`, `EngineConfig`, …) |
| `settings.ts` | `DEFAULT_SETTINGS` / `DEFAULT_CHANNEL_SETTINGS`, normalize + trim stored settings |
| `limits.ts` | YouTube limits (`YT_TITLE_MAX`, `YT_DESCRIPTION_MAX`), `charWarning` |
| `title/fit.ts` | Segment-aware `fitTitle`, separators, duration phrases, review diff |
| `title/finalize.ts` | Combine engine output (+ optional AI shorten) into title / fullTitle / removed |
| `text/placeholders.ts` | Protect terms / URLs / handles / hashtags before an engine call and restore after |
| `text/chapters.ts` | Chapter-line detection and protection |
| `text.ts` | Barrel re-exporting the four modules above (backward-compatible import path) |
| `review.ts` | Review gate + auto-approve rules (`needsTitleReview`, `partitionForPublish`, …) |
| `engines/gemini.ts` `deepl.ts` `libre.ts` | Engine implementations + preflight checks |
| `engines/registry.ts` | `createEngine` / `preflightEngine` by `EngineId` |
| `engines/translate.ts` | `translateTitleDescription` (one language, incl. title fit) |
| `pipeline.ts` | `translateAllLanguages`: preflight, per-language fallback, circuit breaker, cache hooks |
| `pipeline/fallback.ts` | Engine/model fallback slots and `JobSettings` |
| `pipeline/throttle.ts` | Gemini call spacing |
| `job.ts` | Job state reducer (`reduceJob`), incl. review and auto-approve actions |
| `job-selectors.ts` | Read-only views of a job (ready / needs review / auto-approved / counts / badge) |
| `cache.ts` | Translation cache (per video, LRU) |
| `autopublish.ts` | Auto-publish batch policy |
| `channels.ts` `langs.ts` `quota.ts` `errors.ts` `retry.ts` `async.ts` `youtube.ts` | Channels, language presets, quota windows, error classification, retry/sleep, YouTube Data API |

## extension/src

| Module | Responsibility |
|--------|----------------|
| `protocol.ts` | Typed runtime messages (`BackgroundMessage`), port messages, responses |
| `storage.ts` | All `chrome.storage` keys (unchanged names — existing data keeps working) |
| `oauth.ts` | `chrome.identity` OAuth per channel |
| `messaging.ts` | Safe `sendMessage` / port helpers |
| `ui/html.ts` | `escapeHtml`, `escapeAttr`, `engineLabel` |
| `background.ts` | Service worker entry: wires Chrome events |
| `background/handlers.ts` | Message router |
| `background/job-store.ts` | Active job: memory + storage + badge + keep-alive + port broadcast |
| `background/translate-job.ts` | Start/stop a translate run, cache writes, auto-publish batches |
| `background/publish.ts` | Merge-publish localizations to YouTube |
| `background/video-access.ts` | Pick the connected channel/token that owns a video |
| `background/job-log.ts` | Job log entries |
| `content.ts` | Content script entry: Studio button, SPA navigation, `VT_PING` |
| `content/session.ts` | Session controller: job port, modal vs widget, close / new session / retry |
| `content/picker.ts` | Language picker + connect-channel modal |
| `content/progress-view.ts` `preview-view.ts` `result-view.ts` | Job modal views |
| `content/widget.ts` | Minimized floating widget |
| `content/dom.ts` `api.ts` `actions.ts` `labels.ts` | Modal plumbing, typed background calls, view→session callbacks, shared copy |
| `options.ts` / `popup.ts` | Options page and toolbar popup |

Views receive a `JobUiActions` object instead of importing the session, so the content-script module graph has no cycles.

## Review gate and auto-approve

1. `title/fit.ts` shortens titles over 100 chars and marks the result `shortened`.
2. `job.ts` puts shortened, unreviewed rows in `needs_review`; only `ok` rows are publishable (`jobResults`, `jobUnpublished`).
3. When the job snapshot has `autoApprove` (from `AppSettings.autoApproveReview`, or toggled mid-job with the `set_auto_approve` action), the reducer moves every `needs_review` row whose title fits into `ok` with `autoApproved: true` after each state change. Manual review clears the flag; turning the option off returns unpublished auto-approved rows to review.
4. The cache stores the real review state, never the auto-approval.
