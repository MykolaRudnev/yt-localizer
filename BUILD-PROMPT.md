Build v1 of "VeilTranslate" in the CURRENT directory exactly per ./SPEC.md. Read SPEC.md fully first.

Requirements:
- Chrome extension, Manifest V3, TypeScript + Vite, output to extension/dist (loadable via "Load unpacked"). Source in /extension.
- Content script on studio.youtube.com /video/<id>/edit and /video/<id>/translations injects a "Translate" button (robust to Studio SPA navigation, MutationObserver).
- Options page: searchable language checklist + presets (Top 10, Top 20, Top 10 RPM = en,de,ja,ko,fr,nl,sv,no,da,it labelled "estimate", Select all), selected count, engine dropdown (Gemini default, DeepL Free, LibreTranslate URL), API keys in chrome.storage.local, title>100 handling, hashtag mode, chapter-line mode, protected terms list (default "Veil of Veles"), default source language "en", dry-run toggle ON by default.
- OAuth via chrome.identity.launchWebAuthFlow, scope youtube.force-ssl; OAuth client ID configurable in options (no hardcoded secrets).
- Flow: videos.list(snippet,localizations) -> set defaultLanguage if empty -> translate per language with retry/backoff + progress -> preview modal (editable table, char warnings >100 title / >5000 desc, Cancel/Publish) -> videos.update(snippet,localizations) MERGING existing localizations and keeping title/description/categoryId/tags/defaultLanguage unchanged -> result OK/failed -> log last 50 jobs in chrome.storage. Never publish without explicit Publish click; in dry-run Publish is disabled.
- Pluggable engines interface translate(texts[], target, source). Gemini: one request per language returning JSON {title, description}, instructed to keep protected terms, URLs, @handles, hashtags (per option), timestamps. Put translation core in a shared module (/shared or extension/src/core) so an optional CLI can reuse it.
- Optional /cli (Node, TS): `yt-translate <videoId> --langs es,de,pl --engine gemini --dry-run` reusing the core; OAuth via local loopback; tokens/keys in a gitignored file. Do it only if time allows after the extension works.
- languages.json with presets.
- README.md (install, build, load unpacked, usage) and SETUP.md (step by step: Google Cloud project, enable YouTube Data API v3, OAuth consent screen External/Testing with Mikki's account as test user, OAuth client "Web application" with redirect https://<extension-id>.chromiumapp.org/, how to find extension id and pin it via "key" in manifest; Gemini free API key from aistudio.google.com; DeepL Free key; LibreTranslate docker).
- .gitignore (node_modules, dist, .env, *.key, tokens). git init and commit. No secrets in git.
- Run npm install and npm run build; fix until the build passes with no TS errors. Add a few unit tests for chapter/hashtag/protected-term handling and title truncation (vitest) and make them pass.
- Do NOT call any live YouTube write API. Do not install global packages.
At the end print a short summary: file tree, build/test result, and anything Mikki must do manually.
