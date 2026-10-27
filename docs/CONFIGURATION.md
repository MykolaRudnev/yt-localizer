# Configuration

Every Options setting, plus recommended setups. Secrets stay in `chrome.storage.local` (never in git).

Screenshots: [options.png](./screenshots/options.png) · [modal-languages.png](./screenshots/modal-languages.png)

## OAuth

| Setting | Meaning |
|---------|---------|
| **Google OAuth Client ID** | Web application client ID from Google Cloud. Required for **Add channel**. Paste only the Client ID (`….apps.googleusercontent.com`). |
| Redirect URI (read-only hint) | `https://<extension-id>.chromiumapp.org/` — must match Credentials exactly. |

See [SETUP.md](../SETUP.md) for Cloud Console steps and fork guidance on the manifest `"key"`.

## Translation engine (global)

| Setting | Meaning |
|---------|---------|
| **Engine** | Primary engine: `Gemini`, `DeepL Free`, or `LibreTranslate`. |
| **Gemini API key** | From [AI Studio](https://aistudio.google.com/). Used as primary or as fallback. |
| **Gemini model** | Empty / `auto` = newest `*-flash`. Or pick after **Load models**. |
| **DeepL Free API key** | Free plan keys end with `:fx`. |
| **LibreTranslate URL** | Default `http://localhost:5000`. |
| **LibreTranslate API key** | Optional, if your instance requires one. |
| **Auto-fallback on quota** | Default ON. On Gemini daily quota, try next model, then DeepL, then LibreTranslate when configured. |
| **Gemini throttle (ms)** | Default `4000` (~1 request / 4s) to stay under free-tier RPM. |
| **Test engine** | Sends a tiny translation to verify the selected engine. |

### Fallback behavior

- DeepL languages that DeepL does not support → Gemini (if keyed), with a note in the job UI.
- Auth errors on DeepL do **not** silently fall through (you get a clear error).
- Gemini JSON-mode 400s are retried without JSON mode when needed.

## Per-channel settings

Connect channels from the toolbar popup first, then select a channel in Options.

| Setting | Meaning |
|---------|---------|
| **Languages** | Checklist + presets (Top 10 / Top 20 / Top 10 RPM / Top 20 RPM / Last used / All / Clear). Studio modal can override for one job. |
| **Default source language** | BCP-47 / YouTube code (usually `en`). |
| **Protected terms** | One per line; never translated. Channel title is added automatically on connect. |
| **Auto-publish** | OFF by default. When ON **and** dry-run is OFF, writes localizations in batches as languages finish. |

## Translation cache

Successful (and partial) translations are cached so closing the modal does not lose work. **Clear translation cache** wipes stored results (does not revoke OAuth).

## Global translation options

| Setting | Options | Default |
|---------|---------|---------|
| **Title > 100 chars** | Segment-aware shorten (local, free) · Ask AI to shorten | Segment-aware |
| **Protect last segment** | Keep the final title segment (e.g. “Focus & Sleep”) when shortening | ON |
| **Auto-approve review items** | Accept shortened (fitted) titles without clicking Approve | OFF |
| **Hashtags** | Keep · Translate | Keep |
| **Chapter lines** | Translate labels, keep timestamps · Keep as is | Translate labels |
| **Dry-run** | Preview only; Publish disabled | ON on first install |
| **Skip existing** | Do not re-translate languages that already have a localization | ON |

### Title > 100 (reviewable shortening)

YouTube titles are capped at **100 characters**. YT Localizer always keeps the **full translation** (`fullTitle`) and fits a publishable `title`:

1. **Segment-aware shorten (default)** — splits on `|`, `—`, `–`, ` - `, `·`, `:` and protects the first segment, duration phrases (e.g. `1.5 Hours`, `90 min`, `1,5 часа`, `3 Stunden`, `1.5 時間`), your protected terms, and optionally the last segment. Middles are compacted, then shortened or dropped; never cuts inside a protected segment.
2. **Ask AI to shorten** — Gemini rewrites the title while respecting those protected phrases, then the same local safety fit applies. Still goes through review.
3. **Review gate** — every shortened row is **needs review** until you **Approve** (accept auto fit) or **edit** the title (any edit ≤100 unblocks). **Use full** loads the untruncated translation for manual trimming; **Reset** restores the auto fit. Publish is **Publish N ready (M need review)** and only ships ready rows. Auto-publish never publishes shortened rows until reviewed.
4. **Auto-approve review items** (optional, default OFF) — when ON, rows that would need review are approved automatically with the fitted title, so **Publish** and background **auto-publish** include them immediately. Such rows show an **auto-approved** badge; the progress header, preview, popup and job log report **N auto-approved**. Titles that still exceed 100 characters (e.g. after **Use full**) are never auto-approved. Toggle it in **Options → Global translation options** or with the **Auto-approve shortened titles** checkbox in the Studio modal (language picker, progress and preview). Turning it OFF mid-session sends unpublished auto-approved rows back to review. The translation cache keeps the real review state, so auto-approval is never “remembered” once you switch it off.

The Studio modal can temporarily choose **Overwrite** instead of skip for that job. Dry-run can also be toggled in the modal / popup.

## Language presets

Defined in `languages.json`:

| Preset | Intent |
|--------|--------|
| **Top 10** | High-reach consumer languages |
| **Top 20** | Broader reach set |
| **Top 10 RPM (estimate)** | Markets often associated with higher RPM |
| **Top 20 RPM (estimate)** | Wider RPM-oriented set |
| **Last used** | Snapshot from the last Translate click for that channel |
| **All** | Every code in `languages.json` |

RPM presets are **estimates**, not guarantees.

## Dry-run vs auto-publish

| Mode | Behavior |
|------|----------|
| Dry-run ON | Translate + preview only. Publish stays disabled. |
| Dry-run OFF + auto-publish OFF | Translate → preview → explicit **Publish** click. |
| Dry-run OFF + auto-publish ON | Publish batches as languages complete (still uses the owning channel’s token only). |

Localizations are always **merged** — other languages on the video are never deleted.

## Recommended setups

### Cheapest (recommended)

1. Engine: **DeepL Free** + paste DeepL key.
2. Also paste a **Gemini** key (fallback for unsupported langs / DeepL outages).
3. Auto-fallback ON, dry-run ON until you trust the preview.
4. Preset: Top 10 or Top 10 RPM.

### Gemini only

1. Engine: **Gemini**, model empty (auto).
2. Throttle 4000 ms (or higher if you hit RPM limits).
3. Good when you do not want a DeepL account; watch free-tier quotas.

### Self-hosted LibreTranslate

1. Run LibreTranslate locally (or on your server).
2. Engine: **LibreTranslate**, set URL (+ API key if required).
3. Optionally keep Gemini/DeepL keys for fallback.

## Related

- [SETUP.md](../SETUP.md) — Google Cloud + keys
- [docs/CLI.md](./CLI.md) — Node CLI
- [README.md](../README.md) — product overview
