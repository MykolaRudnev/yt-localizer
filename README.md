# VeilTranslate

Chrome extension (Manifest V3) that adds a **Translate** button on YouTube Studio video pages, translates title + description into selected languages, previews them, then publishes as YouTube **localizations** via the official Data API v3.

## Requirements

- Node.js 20+
- Google Chrome
- Google Cloud project with YouTube Data API v3 + OAuth (see [SETUP.md](./SETUP.md))
- Translation API key (Gemini free tier recommended)

## Install & build

```bash
cd veil-translate
npm install
npm run build
npm test
```

Load unpacked extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `extension/dist`
4. Open the extension **Options** page and configure OAuth client ID, engine keys, and languages

## Usage (extension)

1. In Options: pick languages (presets: Top 10, Top 20, Top 10 RPM estimate, Select all), set engine + keys, leave **Dry-run** on for first tests.
2. Open a Studio video: `https://studio.youtube.com/video/<id>/edit` (or `/translations`).
3. Click the green **Translate** button (bottom-right).
4. Sign in with Google when prompted (YouTube force-ssl scope).
5. Wait for per-language progress → edit the preview table → **Cancel** or **Publish**.
6. Publish is disabled while dry-run is on. Turn dry-run off in Options only when ready to write.

Never publishes without an explicit **Publish** click.

## Optional CLI

After `npm run build`:

```bash
# Create gitignored secrets (never commit)
cp .cli-secrets.example.json .cli-secrets.json
# edit keys + OAuth desktop/web client

npm run yt-translate -- VIDEO_ID --langs es,de,pl --engine gemini --dry-run
```

OAuth uses a local loopback on `http://127.0.0.1:7890/callback`. Tokens are stored in `.cli-secrets.json`.

## Project layout

| Path | Purpose |
|------|---------|
| `extension/` | MV3 source (Vite → `extension/dist`) |
| `shared/` | Translation engines + text helpers (extension + CLI) |
| `cli/` | Optional `yt-translate` Node CLI |
| `languages.json` | Language list + presets |
| `SETUP.md` | Google Cloud / API key walkthrough |

## Scripts

| Command | Action |
|---------|--------|
| `npm run build` | Build extension + CLI |
| `npm test` | Vitest unit tests |
| `npm run dev` | Watch-build extension |

## License

Private / personal use for Veil of Veles channel tooling.
