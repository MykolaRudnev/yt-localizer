# Changelog

All notable changes to this project are documented in this file.

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
