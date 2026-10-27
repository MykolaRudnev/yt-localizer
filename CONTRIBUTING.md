# Contributing

Thanks for helping improve YT Localizer.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Load `extension/dist` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

Regenerate docs screenshots (dev only, no live APIs):

```bash
npm run screenshots
```

## Pull requests

1. Keep changes focused — one concern per PR when possible.
2. Add or update Vitest coverage for shared pipeline / settings changes.
3. Do **not** commit API keys, OAuth secrets, tokens, or `.cli-secrets.json`.
4. Prefer English for code comments and user-facing strings.

## Code layout

| Path | Role |
|------|------|
| `extension/` | Chrome MV3 UI + service worker |
| `shared/` | Engines, pipeline, YouTube helpers (extension + CLI) |
| `cli/` | Optional Node CLI |

Module map: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Questions or ideas: open a GitHub issue.
