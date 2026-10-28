# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### UI redesign

- One design system for every surface: `--ytl-*` tokens (primitive → semantic → component) in `extension/src/ui/tokens.css`, shared components, inline icons; blue accent, no green; light/dark (Studio theme in the modal, OS theme in popup/options). Documented in [design.md](design.md); `tokens.test.ts` keeps component CSS free of raw values.
- Studio modal: sticky toolbar and footer; review table with *All / Needs review / Ready* filter, language search and status badges (ready, cached, needs review, auto-approved, published, error); **Publish N ready (M need review)** stays visible.
- Floating widget, popup and options rebuilt on the shared components; options grouped into sections with a sticky **Save** bar.
- README screenshots are now captured from the real UI on demo data (`npm run screenshots`).

### Features

- **Auto-approve review items** (default OFF): Options → Global translation options, plus an **Auto-approve shortened titles** toggle in the Studio modal (picker, progress, preview). When ON, rows that would need review are approved with the fitted title, so **Publish** and background **auto-publish** include them immediately; rows show an *auto-approved* badge and the progress header, preview, popup and job log report **N auto-approved**. Titles still over 100 chars are never auto-approved; turning the option OFF mid-session sends unpublished auto-approved rows back to review. With the option OFF, behaviour is unchanged.
- CLI: **`--auto-approve`**. The CLI now applies the same review gate as the extension — shortened titles are listed as *needs review* and not published unless `--auto-approve` is passed.
- `npm run typecheck` script (also run in CI).

### Fixes

- Translations slowed down and stalled as the translation cache grew: the whole cache lived in one `chrome.storage.local` key (10 MB cap) and was rewritten for every language. It is now stored per video (migrated automatically) and the extension requests `unlimitedStorage`.
- A full storage was reported as an engine quota error, marking working Gemini models as exhausted and re-translating the same language; it now stops with **Extension storage is full**.
- The **Auto-approve** toggle could collapse the modal into the widget when the background failed; it now reverts and explains the error.
- Progress kept updating only if the storage write succeeded; the UI is now notified first.

- `npm run build` works on Windows (the build script no longer uses POSIX `VAR=value` env syntax; `vite build --mode <target>`).
- Typecheck errors (`DOM.Iterable` lib missing; untyped `'job' in res` check in the preview).
- Placeholders were numbered separately for title and description but restored with a shared map, so e.g. title `#shorts` + description `#music` could come back as `#shorts` in the description (same for protected terms / URLs / @handles). Title and description now restore with their own maps.
- Preview: typing in a title re-rendered the whole modal on every keystroke (focus and caret lost, unsaved description edits wiped, Dry-run / Auto-publish toggles reset). The preview now updates in place; description drafts and preview toggles survive repaints.
- Manual **Publish** ended the session even when rows were still waiting for review, discarding them; the session now stays open until nothing is left to publish or review, and the result panel offers **Back to preview**. The publish result is no longer removed by the job update that follows it.
- A job cleared (New session / Close) while its final auto-publish flush was running could be written back and reappear.
- Translation cache now remembers the auto-fitted title, so **Reset** after reloading a reviewed cached row restores the auto fit instead of the previous edit.
- CLI looked for `.cli-secrets.json` in `cli/` instead of the documented repo root (old location still honoured).
- CLI build no longer compiles test files into `cli/dist`.

### Refactor (no behaviour change)

- `extension/src/background.ts` split into `background/` (handlers, job store, translate run, publish, video access, job log); `content.ts` split into `content/` (session controller, picker, progress / preview / result views, widget, DOM helpers); typed message protocol in `protocol.ts`.
- `shared/src/text.ts` split into `limits.ts`, `title/fit.ts`, `title/finalize.ts`, `text/placeholders.ts`, `text/chapters.ts` (`text.ts` re-exports them); `engines/index.ts` split into `registry.ts` and `translate.ts`, DeepL / LibreTranslate preflight moved into their engines; pipeline fallback/throttle helpers moved to `pipeline/`; job selectors moved to `job-selectors.ts`; auto-publish policy to `autopublish.ts`; defaults to `settings.ts`.
- Removed duplication (`sleep`, top-10 defaults, `escapeHtml`, DeepL endpoint/headers, preflight error paths) and the unused `TEST_ENGINE` message. Storage keys, manifest key / extension ID and OAuth flow are unchanged. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## [1.1.0] — 2026-10-18

### Features

- **Reviewable segment-aware title shortening** for YouTube’s 100-char limit (suggested by Daniel Lachev): keep `fullTitle`, fit with protected first/duration/last segments + protected terms, badge + strike-through diff, Approve / Use full / Reset
- Shortened rows stay **needs review** until approve or edit; Publish shows ready vs review counts; auto-publish never ships shortened rows silently
- Options: **Protect last segment** (default ON); Title > 100 label clarifies local segment-aware vs AI shorten

### Docs

- CONFIGURATION Title > 100 section, README features + review screenshot

## [1.0.0] — 2026-10-18

First public open-source release.

### Features

- Chrome MV3 extension for YouTube Studio: one-click **Auto Titles & Description** on video edit / translations pages
- Language presets: **Top 10**, **Top 20**, **Top 10 RPM (estimate)**, **Top 20 RPM (estimate)**, All, Last used, or custom selection
- Translation engines: **DeepL Free**, **Gemini** (free-tier friendly with model auto-pick + quota fallback), **LibreTranslate** (self-hosted)
- Preview table before publish; **dry-run** on by default; opt-in **auto-publish**
- Background jobs with progress modal, minimized Studio widget, and toolbar popup status
- Durable translation cache so work is not lost if the modal is closed mid-job
- Multi-channel / multi-account OAuth (per-channel tokens and language settings)
- Optional Node CLI (`yt-localizer`) for the same pipeline outside Chrome
- Skip-existing localizations (or overwrite from the Studio modal)

### Docs & packaging

- MIT license, SETUP / CONFIGURATION / CLI docs, screenshot harness, GitHub Actions CI
