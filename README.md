# VeilTranslate

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/MykolaRudnevHUBER/veil-translate/actions/workflows/ci.yml/badge.svg)](https://github.com/MykolaRudnevHUBER/veil-translate/actions/workflows/ci.yml)

**Translate YouTube titles & descriptions into official localizations — free, local, open source.**

Chrome MV3 extension (+ optional CLI) that adds an **Auto Titles & Description** control on YouTube Studio video pages, translates with DeepL / Gemini / LibreTranslate, lets you preview, then publishes via the official **YouTube Data API v3**.

![Language picker](docs/screenshots/modal-languages.png)

## Features

- **One-click Studio flow** — pick **Top 10**, **Top 20**, **Top 10 RPM**, **Top 20 RPM**, or a custom language set
- **Engines** — DeepL Free (primary), Gemini free-tier fallback (model auto-pick + quota cascading), LibreTranslate (self-hosted)
- **Preview before publish** — edit titles/descriptions in a table; dry-run ON by default
- **Opt-in auto-publish** — or explicit Publish after preview
- **Background jobs** — progress modal, minimized Studio widget, toolbar popup status
- **Translation cache** — closing the modal mid-job does not throw work away
- **Multi-channel / multi-account** — per-channel OAuth tokens and language settings
- **Optional CLI** — same pipeline from the terminal

| Languages | Progress | Preview |
|-----------|----------|---------|
| ![languages](docs/screenshots/modal-languages.png) | ![translating](docs/screenshots/translating.png) | ![preview](docs/screenshots/preview.png) |

| Widget | Popup | Options |
|--------|-------|---------|
| ![widget](docs/screenshots/widget.png) | ![popup](docs/screenshots/popup.png) | ![options](docs/screenshots/options.png) |

## Why

Paid “bulk localization” tools charge monthly for what the YouTube API already supports. VeilTranslate is a thin, auditable layer: your keys stay in `chrome.storage`, translations go through APIs you choose, and publishes use official `videos.update` localizations — no scraping Studio forms.

## Quick start

```bash
git clone https://github.com/MykolaRudnevHUBER/veil-translate.git
cd veil-translate
npm ci
npm test
npm run build
```

1. Follow **[SETUP.md](./SETUP.md)** (YouTube Data API v3 + OAuth Web client + DeepL/Gemini keys).
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`.
3. Options: paste **OAuth Client ID** + at least one translation key.
4. Popup → **Add channel** (account must be an OAuth test user).
5. Open a Studio video → **Auto Titles & Description** → translate with dry-run → preview → Publish.

More detail: [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) · [docs/CLI.md](./docs/CLI.md)

## How it works

```mermaid
flowchart LR
  A[YouTube Studio<br/>video page] --> B[VeilTranslate<br/>content script]
  B --> C[Service worker<br/>job + cache]
  C --> D{Engine}
  D --> E[DeepL Free]
  D --> F[Gemini]
  D --> G[LibreTranslate]
  C --> H[Preview table]
  H --> I[YouTube Data API v3<br/>videos.update localizations]
```

1. Content script injects the Studio control and shows the modal / widget.
2. Background worker runs the shared pipeline (engines in `shared/`).
3. OAuth tokens are scoped per connected channel; the video’s `channelId` selects which token may write.
4. Localizations are **merged** — other languages on the video are never deleted.

## Costs & quotas

| Resource | Typical limit / cost | Notes |
|----------|----------------------|--------|
| YouTube Data API | **10 000 units/day** (default project) | `videos.list` ≈ 1 unit; `videos.update` ≈ **50 units** |
| DeepL API Free | **500 000 characters / month** | Free keys end with `:fx` |
| Gemini (AI Studio) | Free-tier RPM / RPD vary by model | Auto model pick + throttle (default 4s) + quota fallback |
| LibreTranslate | Your hardware / host | No Google/DeepL quota |

A Top 10 batch is usually well within a default YouTube day quota; large “all languages” runs add up quickly because of `videos.update`.

## Privacy

- API keys and OAuth tokens live in **`chrome.storage.local`** (or gitignored `.cli-secrets.json` for the CLI).
- Nothing is sent to a VeilTranslate server — there isn’t one.
- Network calls go to Google (OAuth + YouTube + optional Gemini), DeepL, and/or your LibreTranslate URL.
- See [SECURITY.md](./SECURITY.md).

## FAQ / troubleshooting

| Symptom | Fix |
|---------|-----|
| `invalid_client` | Wrong Client ID, or client type is not **Web application**. Recreate and paste the ID into Options. |
| `redirect_uri_mismatch` | Authorized redirect URI must be exactly `https://<extension-id>.chromiumapp.org/` (trailing slash). Forks: use your own ID after removing/regenerating the manifest `"key"` — see [SETUP.md](./SETUP.md). |
| `access_denied` / test users | OAuth app in **Testing**: add that Google account under **Test users**. |
| Quota exhausted (YouTube / Gemini / DeepL) | Wait for reset, reduce language count, or enable fallback engines. |
| Gemini JSON mode errors | Extension retries without JSON mode; leave model on auto or pick a current flash model. |
| DeepL unsupported language | Falls back to Gemini when a Gemini key is set; see job notes. |
| “Receiving end does not exist” | Refresh the Studio tab so the content script reinjects, then reopen the popup / modal. |
| Publish disabled | Dry-run is ON (default). Turn it off in Options, popup, or the modal when ready. |

## Roadmap

- Chrome Web Store packaging notes
- Richer per-language quality hints
- Optional glossary / term lists beyond protected terms

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Project layout

| Path | Purpose |
|------|---------|
| `extension/` | MV3 source (Vite → `extension/dist`) |
| `extension/dev/` | Mock harness for screenshots |
| `shared/` | Engines + pipeline (extension + CLI) |
| `cli/` | Optional `yt-translate` CLI |
| `languages.json` | Language list + presets |
| `docs/` | Configuration, CLI, screenshots |
| `SETUP.md` | Google Cloud / API key walkthrough |

## Scripts

| Command | Action |
|---------|--------|
| `npm run build` | Build extension + CLI |
| `npm test` | Vitest |
| `npm run screenshots` | Capture `docs/screenshots/*.png` from the mock harness |
| `npm run yt-translate` | Run the CLI |

```bash
# Screenshots (Playwright + system Chrome; fake data only)
npm run screenshots
```

## License

[MIT](./LICENSE) © 2026 Mykola Rudnev
