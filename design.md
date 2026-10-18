# Design — VeilTranslate

A locked design system for the VeilTranslate extension UI (Studio modal, status
widget, toolbar popup, options page). Every surface redesign reads this file
before emitting code. Do not regenerate per surface — extend or amend this file
when the system needs to grow.

## Genre
atmospheric

## Macrostructure family
App / tool surfaces only (no marketing pages).

- App pages: Workbench — stacked sections with clear hierarchy, sticky action
  footers, dense but breathable controls. Variation knobs: section label weight,
  chip vs outline presets, progress density.

## Theme
Custom **Veil** — dark Studio-adjacent UI: cool blue-grey neutrals, clear blue
accent (hue ~245), restrained. Never purple gradients, glassmorphism, or
decorative emoji chrome.

- `--color-paper`     oklch(15% 0.014 250)
- `--color-paper-2`   oklch(19% 0.016 250)
- `--color-paper-3`   oklch(23% 0.014 250)
- `--color-ink`       oklch(94% 0.010 250)
- `--color-ink-2`     oklch(78% 0.018 250)
- `--color-muted`     oklch(62% 0.022 250)
- `--color-rule`      oklch(32% 0.018 250)
- `--color-accent`    oklch(68% 0.140 245)
- `--color-accent-ink` oklch(98% 0.010 250)
- `--color-focus`     oklch(74% 0.130 245)
- `--color-warn`      oklch(78% 0.110 85)
- `--color-danger`    oklch(68% 0.140 25)
- `--color-ok`        oklch(70% 0.120 245)
- `--color-info`      oklch(72% 0.080 245)

Light Studio companion (when `html` is not dark):

- `--color-paper`     oklch(97% 0.008 250)
- `--color-paper-2`   oklch(94% 0.010 250)
- `--color-ink`       oklch(22% 0.020 250)
- `--color-muted`     oklch(45% 0.020 250)
- `--color-rule`      oklch(84% 0.012 250)
- `--color-accent`    oklch(48% 0.140 245)

## Typography
- Display: Georgia / Iowan Old Style / Palatino, weight 600, style normal (brand wordmark only)
- Body: Roboto / YouTube Noto / Segoe UI / system-ui, weight 400–500 (native next to Studio)
- Mono: ui-monospace / SFMono-Regular / Menlo (codes, video ids)
- Display tracking: -0.02em on wordmark
- Type scale anchor: modal title ≈ 1.125rem; section labels 0.6875rem uppercase tracked

## Spacing
4-point named scale. Values live in `tokens.css`. Surfaces must use named
tokens (`var(--space-md)` / `var(--vt-space-md)`), never ad-hoc magic numbers
outside the token block.

## Motion
- Easings: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`; `--ease-in-out: cubic-bezier(0.45, 0, 0.55, 1)`
- Reveal pattern: none on chrome; progress width + spinner only
- Reduced-motion fallback: opacity-only ≤ 150ms; spinner animation cancelled

## Microinteractions stance
- Silent success (status colour change, no celebratory toast)
- Hover delay unused (dense tool UI); focus ring 0ms
- Press: 1px translateY on buttons
- Esc while running → minimize (existing behaviour; keep)

## CTA voice
- Primary CTA: solid blue fill, 6px radius, weight 600, ink-on-accent
- Secondary CTA: paper-2 fill, 1px rule border, same radius/padding as primary
- Preset chips: 6px radius (not pills), quiet border; hover deepens rule toward accent

## Per-page allowances
- Studio modal / widget: scoped under `#vt-modal-root`, `#vt-job-widget`, `#veil-translate-btn` only
- Popup / options: page-local `:root` tokens mirroring Veil; no Studio leak concern
- App surfaces MUST NOT use enrichment — function carries the UI
- Do not change messaging, storage, API, session-lifecycle, or RPM preset logic
  beyond the documented session-end clear (CLEAR_JOB + widget/badge removal)

## What surfaces MUST share
- Blue accent and its placement (≤ 5% of any view)
- Display + body pairing
- CTA voice (shape, radius, padding rhythm)
- Section heading rhythm (small tracked label → content)
- Focus-visible ring using `--color-focus`

## What surfaces MAY differ on
- Panel width / density (picker vs job vs options)
- Light vs dark token set driven by Studio `html[dark]`

## Session chrome
- No “New session” link in the modal header
- Finished job footer: secondary “New session” + primary “Close” (both end session via CLEAR_JOB)
- Running job footer: Stop / Minimize only
- Status widget + action badge: only while a job is running (minimized unfinished); fully cleared on session end

## Exports

See `tokens.css` at project root for the canonical token block.
