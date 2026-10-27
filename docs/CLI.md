# CLI (`yt-localizer`)

Optional Node CLI that reuses the same translation pipeline and YouTube Data API helpers as the extension.

## Build

```bash
npm ci
npm run build
```

Binary entry (via npm script):

```bash
npm run yt-localizer -- <videoId> --langs es,de,pl [--engine gemini|deepl|libretranslate] [--dry-run|--publish] [--auto-approve]
```

## Secrets file

```bash
cp .cli-secrets.example.json .cli-secrets.json
```

The file lives in the **repository root** (`cli/.cli-secrets.json`, used by v1.1.0 and earlier, is still read when no root file exists).

Fill in placeholders only in the local file (gitignored):

| Field | Required for |
|-------|----------------|
| `oauthClientId` | YouTube OAuth |
| `oauthClientSecret` | Token exchange / refresh (CLI uses a confidential client) |
| `geminiApiKey` / `deeplApiKey` / `libreTranslateUrl` | Chosen engine |
| `refreshToken` / `accessToken` | Written automatically after first login |

Create a Google Cloud OAuth client (Desktop or Web) with redirect:

```
http://127.0.0.1:7890/callback
```

First run opens a browser for consent; tokens are saved back into `.cli-secrets.json`.

## Examples

```bash
# Preview only (default if --publish is omitted)
npm run yt-localizer -- dQw4w9WgXcQ --langs es,de,pl --engine deepl --dry-run

# Publish localizations (merge; does not delete other languages)
npm run yt-localizer -- dQw4w9WgXcQ --langs es,de --engine gemini --publish
```

## Title review (`--auto-approve`)

Titles over 100 characters are fitted with the same segment-aware logic as the extension. Like the extension, a **shortened** title needs review: the CLI prints it as `(shortened — needs review)` together with the full translation and **does not publish it**. Pass `--auto-approve` to accept the fitted titles as-is; they are published with the other rows and reported as `N auto-approved`.

```bash
npm run yt-localizer -- dQw4w9WgXcQ --langs es,de --engine deepl --publish --auto-approve
```

## Notes

- Prefer the Chrome extension for day-to-day Studio workflows (preview UI, cache, multi-channel).
- The CLI does not read `chrome.storage`; it only uses `.cli-secrets.json`.
- Never commit `.cli-secrets.json` or paste its contents into issues.
