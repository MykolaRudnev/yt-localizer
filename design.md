# Design system — YT Localizer

One design system for every UI surface: the Studio entry pill, the Studio modal
(picker → progress → review → result), the floating job widget, the toolbar
popup and the options page. Derived from `docs/DESIGN-BRIEF.md`.
Read this file and `extension/src/ui/tokens.css` before touching any UI.

| File | Role |
|---|---|
| `extension/src/ui/tokens.css` | **Single source** of every colour, size, radius, shadow, type and motion value |
| `extension/src/ui/components.css` | Shared components (`.ytl-*`), used by all surfaces |
| `extension/src/ui/icons.ts` | Inline SVG icons (`icon('check')`, `SPINNER`) |
| `extension/src/ui/theme.ts` | Popup/options follow the OS light/dark scheme |
| `extension/src/content/status.ts` | Language-row state → badge (one vocabulary everywhere) |
| `extension/src/content.css` | Studio layout (pill, widget, modal views) |
| `extension/src/popup.css`, `options.css` | Page layout only |
| `extension/src/ui/tokens.test.ts` | Lint: no raw values / Tier 1 ramps / unknown tokens in component CSS |

## 1. Tokens (`--ytl-*`)

Three tiers, all custom properties on `.ytl-root`:

| Tier | What | Examples |
|---|---|---|
| 1 · primitive | Raw ramps and scales | `--ytl-blue-600`, `--ytl-slate-200`, `--ytl-space-3`, `--ytl-radius-md` |
| 2 · semantic | Purpose-based, theme-aware | `--ytl-color-bg-accent`, `--ytl-color-text-muted`, `--ytl-color-border-error` |
| 3 · component | Only where Tier 2 isn't enough | `--ytl-control-height`, `--ytl-row-color-bg-review`, `--ytl-modal-width-lg` |

Naming: `--ytl-{category}-{property}-{role}-{state}`, e.g. `--ytl-color-bg-accent-hover`.

Rules (enforced by `tokens.test.ts`):
- Component CSS never uses Tier 1 **colour** ramps (`blue/slate/amber/red/black`) — only Tier 2/3.
  Dimension scales (`space`, `radius`, `size`, `font-size`, `shadow`) are used directly.
- No raw hex/rgb/oklch, no raw `px` outside `tokens.css` (exception: `@media` breakpoints).
- Every `var(--ytl-…)` must exist in `tokens.css`.
- Values are `px` on purpose: the content UI lives inside Studio, whose root font-size we don't control.

### Colour
- **Accent: clear blue** — `bg-accent` blue-600 `#2563EB`, hover 700, active 800; `text-on-accent` white (≈5.2:1).
  Links `text-link` blue-700 (≈6.7:1). Focus ring blue-500.
- **No green anywhere.** Success / ready / published = blue check icon + text.
- Neutrals: slate. Canvas `#F8FAFC`, surface white, border `#E2E8F0`, text `#0F172A`, muted `#475569`.
- Warning (needs review): amber tint background + amber border + amber-800 text.
- Error: red-600 border / red-700 text / red-50 tint.
- Dark theme: only Tier 2 changes. Content UI follows Studio (`html[dark]`); popup/options follow the OS
  (`data-ytl-theme`, set by `ui/theme.ts`).

### Type
System stack `Inter, "Segoe UI", Roboto, "YouTube Noto", system-ui`; weights 400/500/600 only.

| Token | Size / line | Use |
|---|---|---|
| `font-size-xs` | 11 / 16 | badges, counters, table headers |
| `font-size-sm` | 12 / 16 | helper text, secondary meta |
| `font-size-md` | 13 / 20 | body, inputs, buttons (default) |
| `font-size-lg` | 15 / 22 | section titles, progress % |
| `font-size-xl` | 18 / 24 | modal / page title |

Counts and progress use `font-variant-numeric: tabular-nums`; language codes use the mono stack.

### Spacing, radius, elevation, motion
- Spacing (4-pt): `space-1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 20 · `6` 24 · `8` 32 · `10` 40 (`space-0-5` 2 for hairline gaps).
- Radius: `sm` 4 (inputs-in-cells, marks) · `md` 8 (buttons, inputs, rows) · `lg` 12 (modal, widget, cards) · `full` (chips, badges, switch).
- Elevation: `shadow-1` cards · `shadow-2` entry pill · `shadow-3` modal + widget. Max 3 levels.
- Motion: `duration-fast` 120 ms for colour, `duration-base` 200 ms for progress width; `prefers-reduced-motion` removes transitions.

## 2. Components (`components.css`)

Every selector is `.ytl-root .ytl-…`, so it applies only inside our roots and outranks stray host rules.

| Component | Class | Variants / notes |
|---|---|---|
| Button | `.ytl-btn` | `--primary` (one per surface), `--ghost`, `--danger`, `--lg`, `--icon`, `--block`; loading = `aria-busy="true"` (spinner, label kept) |
| Chip | `.ytl-chip` | Preset toggles; selected = `aria-pressed="true"` |
| Badge | `.ytl-badge` | neutral, `--accent`, `--warning`, `--error`, `--solid` (published) |
| Input / select / textarea | `.ytl-input` `.ytl-select` `.ytl-textarea` | error = `aria-invalid="true"` |
| Search | `.ytl-search` | leading icon + `.ytl-input` + visually-hidden label |
| Field | `.ytl-field` + `__label` + `__hint` | label above, hint below |
| Checkbox / radio | `.ytl-checkbox` `.ytl-radio` | native, accent-tinted |
| Switch | `input.ytl-switch[role=switch]` | inside `.ytl-toggle` row (`__text`, `__hint`, `--compact`) |
| Segmented | `.ytl-segmented` + `__item` + `__count` | radio group (Skip/Overwrite, row filter) |
| Notice | `.ytl-notice` | info (blue), `--warning`, `--error`; always icon + text |
| Progress | `.ytl-progress` + `__fill` | `--sm`; `data-phase="failed|stopped"` turns red |
| Card | `.ytl-card` | popup/options sections |
| Text | `.ytl-eyebrow` `.ytl-muted` `.ytl-code` `.ytl-link` `.ytl-visually-hidden` | |

### State matrix

| Component | default | hover | focus-visible | active | disabled | loading | error |
|---|---|---|---|---|---|---|---|
| Button | ✓ | bg-hover / accent-hover | 2px ring + 2px offset | pressed / accent-active | grey bg + disabled text, `not-allowed` | `aria-busy` spinner | `--danger` |
| Chip | ✓ | border-strong | ring | pressed | ✓ | — | — |
| Input / textarea | ✓ | border-control | accent border + ring | — | ✓ | — | red border (`aria-invalid`) + inline message |
| Switch / checkbox | ✓ | ✓ | ring | — | ✓ | — | — |
| Language row | ✓ | bg-subtle | ring on control | — | — | spinner badge | red tint + left bar + details |
| Widget | running / review / done | border-strong | ring | grabbing | — | spinner | progress red |

### Language row states (`content/status.ts`)

One vocabulary across progress, review and widget — always **icon + text**, never colour alone:

| State | Badge | Row treatment |
|---|---|---|
| pending | neutral · clock · "Pending" | — |
| running | accent · spinner · "Translating" | — |
| ready / cached | accent · check · "Ready" / "Ready · cached" | — |
| review | warning · alert · "Needs review" | amber tint + amber left bar |
| auto | accent · check · "Auto-approved" | light blue left bar |
| published | solid blue · check · "Published" | blue left bar |
| skipped | neutral · minus · "Skipped" | — |
| error | error · x · "Error" | red tint + red left bar + error details |

## 3. Surfaces

**Studio modal** (`#vt-modal-root .vt-panel`): header (eyebrow, title, subtitle, close) →
notices → **sticky toolbar** → scrolling body → **sticky footer** (summary left, actions right,
primary rightmost). Widths: `--sm` 480 (connect, result), `--md` 760 (picker, progress), `--lg` 1120 (review).
- Picker: search + preset chips toolbar; language grid; run options (Skip/Overwrite, Dry-run, Auto-publish, Auto-approve); footer "Translate N languages".
- Progress: % + count + ETA + engine, progress bar, Auto-approve switch; row list with badges; footer Stop / Minimize, or Retry / New session / Close.
- Review: toolbar with code filter, segmented filter All / Needs review / Ready (with counts), Dry-run / Auto-publish / Auto-approve switches (auto-approved count shown);
  table rows with status badge, title input + counter + "Shortened −N" badge + full-title diff with Approve / Use full / Reset;
  footer "N ready · M need review" + **Publish N ready (M need review)**.
- Result: published codes as badges, failures listed with reason; Retry / Back to preview / New session / Close.

**Widget** (`#vt-job-widget`): 280 wide, bottom-right above the pill, draggable, keyboard-focusable
(Enter/Space expands), `aria-live="polite"`; icon + label + sub-line + thin progress.

**Popup** (360 wide): header (wordmark + Options) → Studio hint → setup checklist → current job → channels → status + Dry-run. One primary action.

**Options** (max 720): cards for Google connection, Translation engine (Gemini / DeepL & LibreTranslate / Fallback groups),
Per-channel settings, Translation & publishing, Cache; sticky Save bar.

## 4. Isolation in Studio
- Tokens and components hang off `.ytl-root`; the three content roots (`#veil-translate-btn`, `#vt-job-widget`,
  `#vt-modal-root`) carry that class, never Studio's `:root`.
- Every layout rule in `content.css` is anchored on one of those ids; a root reset blocks Studio's inherited type/colour.
- Studio's own CSS can't style us beyond inherited properties (reset) — we don't use a shadow root, so keep ids/prefixes strict.

## 5. Accessibility
- WCAG 2.2 AA: text ≥ 4.5:1, borders/UI ≥ 3:1, including disabled and dark tokens.
- `:focus-visible` ring on every interactive element; controls ≥ 32 px (`--ytl-control-height`).
- Modal: `role="dialog"` + `aria-modal` + `aria-labelledby="vt-title"`; focus trapped; Esc closes/minimizes;
  Enter = primary (not inside inputs); backdrop click does nothing.
- Real `<button>` / `<input>`; icon-only buttons have `aria-label`; icons are `aria-hidden`.
- Live regions: picker/review footer summary, widget.

## 6. Session chrome (behaviour, unchanged)
- Running job footer: Stop / Minimize. Finished: [Retry N failed] · New session · Close (both end the session via CLEAR_JOB).
- Widget + action badge only while a job runs or a finished job still has open review work.
