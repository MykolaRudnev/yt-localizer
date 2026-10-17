# Spec: "VeilTranslate" — simple YouTube title/description translator (VidAI-lite)

Owner: Mikki (Mykola Rudnev). Built locally with Cursor Agent CLI on Mikki's Ubuntu PC (later also Windows; on Windows everything lives on D:, never C:).
Goal: in YouTube Studio, pick target languages once, then 1 click per video -> translated TITLE + DESCRIPTION published as YouTube localizations via the official YouTube Data API v3. Nothing else for v1 (no subtitles, comments, competitor calendar, AI titles).

## Scope v1 (MVP)
1. Chrome extension (Manifest V3), unpacked install ("Load unpacked") in Mikki's Chrome.
2. Button injected on studio.youtube.com video pages (/video/<id>/edit and /video/<id>/translations): "Translate".
3. Options page:
   - Language picker: searchable checklist + presets "Top 10", "Top 20", "Top 10 RPM", "Select all". Show count of selected languages.
   - Translation engine dropdown + API key fields (stored in chrome.storage.local).
   - Options (copy VidAI's sensible defaults):
     - Title > 100 chars: [Truncate at word boundary] / [Ask AI to shorten] (AI only if LLM engine).
     - Hashtags: [Keep as is] (default) / [Translate].
     - Chapter lines (3+ consecutive lines starting with timestamps ascending): [Translate labels, keep timestamps] (default) / [Keep lines as is].
     - Protected terms list (never translate): e.g. channel name "Veil of Veles", URLs, @handles.
4. Flow on click:
   - Get videoId from URL. OAuth via chrome.identity.launchWebAuthFlow (Google OAuth client, scope https://www.googleapis.com/auth/youtube.force-ssl).
   - videos.list?part=snippet,localizations&id=… -> source title/description + snippet.defaultLanguage.
   - If defaultLanguage empty, set it (default "en", configurable) — required for localizations.
   - Translate title + description into each selected language (batch, retry w/ backoff, show progress per language).
   - Preview modal: table language | title | description (editable), char-count warning >100 title / >5000 desc. Buttons: Cancel / Publish.
   - videos.update?part=snippet,localizations — MERGE with existing localizations (never delete others), keep snippet fields (title, description, categoryId, tags, defaultLanguage) unchanged.
   - Show result: OK languages / failed languages. Log to chrome.storage (last 50 jobs).
   - Dry-run toggle (preview only, no publish) ON by default for first run.
5. Optional tiny CLI (Node or Python) with same core: `yt-translate <videoId> --langs es,de,pl --engine gemini --dry-run` for batch translating old videos. Shares translation module if feasible.

## Translation engines (all free or free tier; pluggable interface translate(texts[], target, source))
- Gemini API free tier (default; best for creative titles, can follow "keep hashtags/timestamps" instructions; one request per language returns JSON {title, description}).
- DeepL API Free (500k chars/month, needs free key; good quality; limited language list — fall back to Gemini for unsupported).
- LibreTranslate (self-host via Docker or public instance URL) — fully free fallback.
- (Avoid unofficial translate.googleapis.com "gtx" endpoint in the shipped version — unofficial/ToS risk; may be offered as an opt-in "unofficial" engine only.)

## Constraints
- Official YouTube Data API only; no scraping Studio internals for writing. Quota: videos.update = 50 units, videos.list = 1, default 10k/day → plenty.
- Google Cloud project + OAuth client ID set up by Mikki (write a step-by-step SETUP.md: enable YouTube Data API v3, OAuth consent screen "External/Testing" with his account as test user, create OAuth client type "Chrome extension" or "Web application" with redirect https://<extension-id>.chromiumapp.org/).
- Never publish without the preview + explicit Publish click.
- Secrets only in chrome.storage.local, never committed. .gitignore for keys.
- Code: TypeScript, Vite (or plain JS if simpler), no backend server.

## Deliverables
- /extension (MV3 source), /cli (optional), README.md (install + use), SETUP.md (Google OAuth + API keys), language list JSON with presets (Top RPM preset: en, de, ja, ko, fr, nl, sv, no, da, it — label as estimate).
- Tested on one unlisted test video in dry-run, then real publish only after Mikki OKs.

## Out of scope v1
Subtitles/captions translation, comment replies, AI titles, competitor calendar, thumbnail tester, payments.
