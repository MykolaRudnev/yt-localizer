# Security

## Reporting a vulnerability

Please open a **private** security advisory on GitHub (preferred), or email the maintainer via the address listed on their GitHub profile. Do not file a public issue for secrets or exploit details.

## How secrets are stored

YT Localizer never ships with your keys:

| Secret | Where it lives |
|--------|----------------|
| Google OAuth Client ID | Entered in **Options**; stored in `chrome.storage.local` |
| OAuth access / refresh tokens | `chrome.storage.local` per connected channel |
| Gemini / DeepL / LibreTranslate keys | Options → `chrome.storage.local` |
| CLI secrets | Local `.cli-secrets.json` (gitignored) |

Keys and tokens are **not** committed to the repository. Do not paste real credentials into issues, PRs, or screenshots.

## Safe to publish

- The Manifest V3 `"key"` field is a **public** key used only to pin a stable Chrome extension ID. It is not a secret. Forks should remove it or generate their own (see [SETUP.md](./SETUP.md)).
- Example files such as `.cli-secrets.example.json` use empty placeholders only.

## Scope notes

- The extension requests YouTube OAuth scope `youtube.force-ssl` to read video metadata and update **localizations** (titles/descriptions per language).
- Host permissions include translation API endpoints you configure; review `extension/manifest.json` before installing.
