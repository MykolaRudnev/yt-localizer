# CLI (`yt-translate`)

Optional Node CLI that reuses the same translation pipeline and YouTube Data API helpers as the extension.

## Build

```bash
npm ci
npm run build
```

Binary entry (via npm script):

```bash
npm run yt-translate -- <videoId> --langs es,de,pl [--engine gemini|deepl|libretranslate] [--dry-run|--publish]
```

## Secrets file

```bash
cp .cli-secrets.example.json .cli-secrets.json
```

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
npm run yt-translate -- dQw4w9WgXcQ --langs es,de,pl --engine deepl --dry-run

# Publish localizations (merge; does not delete other languages)
npm run yt-translate -- dQw4w9WgXcQ --langs es,de --engine gemini --publish
```

## Notes

- Prefer the Chrome extension for day-to-day Studio workflows (preview UI, cache, multi-channel).
- The CLI does not read `chrome.storage`; it only uses `.cli-secrets.json`.
- Never commit `.cli-secrets.json` or paste its contents into issues.
